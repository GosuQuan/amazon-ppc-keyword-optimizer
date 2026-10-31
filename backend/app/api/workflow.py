"""Workflow API. Register this router alongside the existing legacy router."""
import json
from pathlib import Path
from typing import Literal, Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel

from ..workflow import service as S
from ..workflow.store import database, load, save

router = APIRouter(prefix='/api/workflow', tags=['workflow'])


class ActionStatus(BaseModel):
    status: Literal['approved', 'rejected', 'pending']


class Execution(BaseModel):
    executed_at: str
    notes: str


@router.post('/plans')
async def create_plan(search_terms: UploadFile = File(...), bulk: Optional[UploadFile] = File(None),
                      advertised_products: Optional[UploadFile] = File(None), placements: Optional[UploadFile] = File(None),
                      account: str = Form(...), marketplace: str = Form(...), currency: str = Form(...),
                      asin: str = Form(...), target_acos: float = Form(25), daily_budget: float = Form(50)):
    plan = S.build_plan(await search_terms.read(), await bulk.read() if bulk else None,
                        {'account': account, 'marketplace': marketplace, 'currency': currency, 'asin': asin}, target_acos, daily_budget,
                        await advertised_products.read() if advertised_products else None,
                        await placements.read() if placements else None)
    with database() as connection:
        save(connection, plan)
    return with_readiness(plan)


def with_readiness(plan):
    plan['export_readiness'] = S.export_readiness(plan)
    return plan


@router.post('/demo')
def run_demo():
    sample = Path(__file__).resolve().parents[3] / 'examples' / '亚马逊搜索词报告-示例.csv'
    if not sample.is_file():
        raise HTTPException(404, '找不到示例报表')
    plan = S.build_plan(sample.read_bytes(), None,
                        {'account': 'sample', 'marketplace': 'US', 'currency': 'USD', 'asin': 'B0SAMPLE01'}, 25, 50)
    with database() as connection:
        save(connection, plan)
    plan['demo_trace'] = [
        'POST /api/workflow/demo',
        f'读取 {sample.name}，共生成方案 {plan["id"]}',
        '上下文：账户 sample，站点 US，币种 USD，ASIN B0SAMPLE01；目标 ACOS 25%，每日预算 50',
        '没有上传 Bulk，所以没有真实出价和实体 ID，动作会保留但不可导出',
        f'花费 {plan["metrics"]["spend"]}，销售额 {plan["metrics"]["sales"]}，订单 {plan["metrics"]["orders"]}，ACOS {plan["metrics"]["acos"]}',
        f'动作 {len(plan["actions"])} 条',
    ]
    return with_readiness(plan)


@router.get('/plans')
def list_plans():
    with database() as connection:
        plans = [json.loads(row[0]) for row in connection.execute('SELECT document FROM plans ORDER BY created_at DESC')]
    return [{'id': p['id'], 'created_at': p['created_at'], 'context': p['context'], 'status': p['status'],
             'metrics': p['metrics'], 'action_count': len(p['actions']),
             'approved_count': sum(a['status'] == 'approved' for a in p['actions'])} for p in plans]


@router.get('/plans/{plan_id}')
def get_plan(plan_id: str):
    with database() as connection:
        return with_readiness(load(connection, plan_id))


@router.patch('/plans/{plan_id}/actions/{action_id}')
def update_action(plan_id: str, action_id: str, body: ActionStatus):
    with database() as connection:
        plan = load(connection, plan_id)
        action = next((a for a in plan['actions'] if a['id'] == action_id), None)
        if action is None:
            raise HTTPException(404, '动作不存在')
        if plan['exports'] and action['status'] != body.status:
            raise HTTPException(409, '计划已导出，审核快照已冻结；请创建新计划')
        action['status'] = body.status
        plan.setdefault('audit', []).append({'at': S.now(), 'action_id': action_id, 'status': body.status})
        if not plan['exports']:
            plan['status'] = 'approved' if any(a['status'] == 'approved' for a in plan['actions']) else 'pending'
        save(connection, plan)
    return with_readiness(plan)


@router.post('/plans/{plan_id}/export')
def export_plan(plan_id: str):
    with database() as connection:
        plan = load(connection, plan_id)
        if plan['exports']:
            text = plan['exports'][0]['tsv']
        else:
            text, ids = S.render_export(plan)
            plan['exports'].append({'id': S.uuid4().hex, 'created_at': S.now(), 'action_ids': ids,
                                    'context': dict(plan['context']), 'actions': [dict(a) for a in plan['actions'] if a['status'] == 'approved'],
                                    'tsv': text, 'template_validated': False})
            plan['status'] = 'exported'
            save(connection, plan)
    return Response(text.encode('utf-8-sig'), media_type='text/tab-separated-values',
                    headers={'Content-Disposition': f'attachment; filename="sp-draft-{plan_id}.tsv"',
                             'X-Template-Validation': 'draft-unverified'})


@router.post('/plans/{plan_id}/execution')
def record_execution(plan_id: str, body: Execution):
    executed = S.iso_date(body.executed_at)
    if executed > S.date.today():
        S.fail('执行日期不能在未来')
    with database() as connection:
        plan = load(connection, plan_id)
        if not plan['exports']:
            S.fail('必须先批准并导出快照，再登记执行')
        if plan['baseline_period'] and executed <= S.iso_date(plan['baseline_period']['end']):
            S.fail('执行日期必须晚于基线报告结束日期')
        record = {'executed_at': body.executed_at, 'notes': body.notes, 'export_id': plan['exports'][0]['id']}
        if plan['execution']:
            old = plan['execution']
            if any(old[k] != record[k] for k in record):
                raise HTTPException(409, '执行记录已固定，不可覆盖')
            return with_readiness(plan)
        record['recorded_at'] = S.now()
        plan['execution'] = record
        plan['status'] = 'executed'
        save(connection, plan)
    return with_readiness(plan)


@router.post('/plans/{plan_id}/review')
async def review_plan(plan_id: str, search_terms: UploadFile = File(...), period_start: str = Form(...), period_end: str = Form(...)):
    start, end = S.iso_date(period_start), S.iso_date(period_end)
    if start > end:
        S.fail('复盘开始日期晚于结束日期')
    raw = await search_terms.read()
    with database() as connection:
        plan = load(connection, plan_id)
        if not plan['execution']:
            S.fail('复盘必须先登记执行')
        if start <= S.iso_date(plan['execution']['executed_at']):
            S.fail('复盘周期必须严格晚于执行日期')
        baseline = plan['baseline_period']
        if not baseline:
            S.fail('基线缺少完整日期，无法验证周期是否重叠')
        if start <= S.iso_date(baseline['end']):
            S.fail('复盘周期与基线重叠')
        records, warnings, period, _window = S.parse_search(raw, plan['context'])
        if not period or S.iso_date(period['start']) < start or S.iso_date(period['end']) > end:
            S.fail('复盘报告缺少完整日期或日期超出指定周期')
        # ASIN/currency cannot be proven for a review lacking those columns.
        _, columns, _window = S.table(raw)
        if not {'asin', 'currency'}.issubset(columns):
            S.fail('复盘必须含 ASIN 与 Currency 列以验证相同上下文')
        after = S.metrics(records)
        before = plan['metrics']
        review = {'period_start': period_start, 'period_end': period_end, 'context': dict(plan['context']),
                  'before': before, 'after': after,
                  'delta': {k: after[k] - before[k] if after[k] is not None and before[k] is not None else None for k in before},
                  'warnings': warnings, 'non_causal_note': '前后周期差异仅为描述性对比，受季节、流量、归因延迟及周期长度影响，不能证明动作产生因果效果。'}
        if plan['review'] and {k: v for k, v in plan['review'].items() if k != 'created_at'} != review:
            raise HTTPException(409, '复盘记录已固定，不可覆盖')
        if not plan['review']:
            review['created_at'] = S.now()
            plan['review'] = review
            plan['status'] = 'reviewed'
            save(connection, plan)
    return with_readiness(plan)
