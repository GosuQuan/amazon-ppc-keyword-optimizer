"""Input validation and plans. Identity normalization deliberately preserves word boundaries."""
import csv
import io
import math
import re
import unicodedata
from collections import defaultdict
from datetime import date, datetime, timezone
from uuid import uuid4

from fastapi import HTTPException

from ..engine import parser as legacy
from ..engine.pipeline import run_analysis, sanitize


def fail(message):
    raise HTTPException(422, message)


def norm(value):
    return ' '.join(unicodedata.normalize('NFKC', str(value or '')).casefold().split())


def header(value):
    return re.sub(r'[\s_\-()%（）]', '', norm(value))


def now():
    return datetime.now(timezone.utc).isoformat()


def iso_date(value):
    try:
        if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
            raise ValueError('non-canonical date')
        return date.fromisoformat(value)
    except (TypeError, ValueError):
        fail('日期必须为 ISO 日期 YYYY-MM-DD')


def inclusive_days(start, end):
    return (iso_date(end) - iso_date(start)).days + 1


def positive(value, name):
    try:
        value = float(value)
    except (ValueError, TypeError):
        fail(name + '必须为正有限数')
    if not math.isfinite(value) or value <= 0:
        fail(name + '必须为正有限数')
    return value


ALIASES = {
    'account': ['account', 'account name', '账户', '账号'],
    'marketplace': ['marketplace', 'marketplace name', '站点'],
    'currency': ['currency', '币种', '货币'],
    'asin': ['asin', 'advertised asin', '广告商品asin', '推广的asin', '推广的商品asin'],
    'date': ['date', '日期'],
    'start': ['start date', '开始日期'], 'end': ['end date', '结束日期'],
    'campaign': ['campaign', 'campaign name', '广告活动', '广告活动名称'],
    'ad_group': ['ad group', 'ad group name', '广告组', '广告组名称'],
    'keyword': ['keyword', 'keyword text', '关键词', 'targeting', '投放词'],
    'match_type': ['match type', '匹配类型', '匹配方式'],
    'search_term': ['customer search term', 'search term', '搜索词', '客户搜索词'],
    'campaign_id': ['campaign id', '广告活动id'], 'ad_group_id': ['ad group id', '广告组id'],
    'keyword_id': ['keyword id', '关键词id'], 'bid': ['bid', 'keyword bid', '出价', '关键词出价'],
    'entity': ['entity', '实体'],
    'spend': ['spend', 'cost', '花费', '总花费'],
    'sales': ['sales', '7 day total sales', '14 day total sales', '销售额', '7天总销售额', '七天总销售额'],
    'orders': ['orders', '7 day total orders (#)', '7 day total orders', '14 day total orders', '订单', '订单数', '七天总订单数（#）', '七天总订单数'],
    'clicks': ['clicks', '点击量', '点击次数', '点击'],
    'impressions': ['impressions', '展示量', '曝光量'],
    'placement': ['placement', '广告位', '投放位置'],
}


def table(raw):
    text = legacy.decode_bytes(raw)
    rows = list(csv.reader(io.StringIO(text), delimiter=legacy.detect_delim(text.split('\n', 1)[0])))
    rows = [r for r in rows if any(c.strip() for c in r)]
    if len(rows) < 2:
        fail('文件必须包含表头及数据行')
    heads = [header(v) for v in rows[0]]
    if len(set(heads)) != len(heads):
        fail('重复表头存在歧义')
    indices = {}
    for key, aliases in ALIASES.items():
        matches = [i for i, h in enumerate(heads) if h in {header(a) for a in aliases}]
        if len(matches) > 1:
            fail('同义表头存在歧义: ' + key)
        if matches:
            indices[key] = matches[0]
    for h in heads:
        if 'asin' in h and h not in {header(a) for a in ALIASES['asin']}:
            fail('包含无法分配的 ASIN 列，请提供单一广告 ASIN 报告')
    out = []
    for cells in rows[1:]:
        if len(cells) != len(heads):
            fail('CSV/TSV 列数不一致')
        out.append({k: cells[i].strip() for k, i in indices.items()})
    return out, indices, attribution_window(rows[0])


def attribution_window(headers):
    found = set()
    for value in headers:
        text = header(value)
        if '7day' in text or '七天' in text:
            found.add('7d')
        if '14day' in text or '14天' in text or '十四天' in text:
            found.add('14d')
        if '30day' in text or '30天' in text or '三十天' in text:
            found.add('30d')
    if len(found) > 1:
        fail('同一文件包含多个归因窗口：' + '、'.join(sorted(found)))
    return found.pop() if found else 'unspecified'


def same_window(windows):
    specified = {name: value for name, value in windows.items() if value != 'unspecified'}
    if len(set(specified.values())) > 1:
        detail = '、'.join(f'{name}={value}' for name, value in specified.items())
        fail('归因窗口不一致：' + detail)
    if specified and len(specified) != len(windows):
        return '部分报告未标注归因窗口，无法证明与已标注报告一致'
    return None


def check_context(rows, columns, context, warnings, label):
    for key in ('account', 'marketplace', 'currency', 'asin'):
        if key in columns:
            values = {norm(row.get(key)) for row in rows}
            if values != {norm(context[key])}:
                fail(f'{label}: {key} 含多值、空值或与指定上下文不一致')
        else:
            warnings.append(f'{label}: {key} 未由报告验证，采用显式上下文')


def metric(value, name):
    try:
        value = float(str(value).replace(',', ''))
    except (ValueError, TypeError):
        fail('指标无效: ' + name)
    if not math.isfinite(value) or value < 0:
        fail('指标必须为非负有限数: ' + name)
    return value


def parse_search(raw, context):
    rows, columns, window = table(raw)
    warnings = []
    check_context(rows, columns, context, warnings, 'search_terms')
    required = {'search_term', 'campaign', 'ad_group', 'keyword', 'match_type', 'spend', 'sales', 'orders', 'clicks'}
    if not required.issubset(columns):
        fail('搜索词报告缺少列: ' + ', '.join(sorted(required - set(columns))))
    records, seen, keys, dates = [], set(), set(), []
    for row in rows:
        fingerprint = tuple(sorted(row.items()))
        if fingerprint in seen:
            warnings.append('重复指标行已去重')
            continue
        seen.add(fingerprint)
        if not all(row[k].strip() for k in ('search_term', 'campaign', 'ad_group', 'keyword', 'match_type')):
            fail('搜索词、关键词、匹配类型及范围不可为空')
        for field in ('spend', 'sales', 'orders', 'clicks', 'impressions'):
            if field in columns:
                row[field] = metric(row[field], field)
        start = row.get('start') or row.get('date')
        end = row.get('end') or row.get('date')
        if start or end:
            if not start or not end or iso_date(start) > iso_date(end):
                fail('报告周期无效')
            dates.extend([start, end])
        key = tuple(norm(row[k]) for k in ('campaign', 'ad_group', 'keyword', 'match_type', 'search_term')) + (start, end)
        if key in keys:
            fail('同维度同周期指标行存在重复实体歧义')
        keys.add(key)
        # Invoke legacy parsing, then restore authoritative metrics (legacy infers spend from CPC).
        encoded = io.StringIO()
        writer = csv.writer(encoded)
        writer.writerow(['Campaign', 'Ad Group', 'Keyword', 'Match Type', 'Search Term', 'Clicks', 'Spend', 'Sales', 'Orders', 'Impressions'])
        writer.writerow([row['campaign'], row['ad_group'], row['keyword'], row['match_type'], row['search_term'], row['clicks'], row['spend'], row['sales'], row['orders'], row.get('impressions', 0)])
        parsed = legacy.parse_text(encoded.getvalue())
        parsed_rows = list(csv.reader(io.StringIO(encoded.getvalue())))
        rec = parsed[0] if parsed else legacy.row_to_record(parsed_rows[1], legacy.map_headers(parsed_rows[0]))
        rec.update(spend=row['spend'], sales=row['sales'], orders=row['orders'], clk=row['clicks'])
        records.append(rec)
    if not records:
        fail('没有可分析数据')
    period = {'start': min(dates), 'end': max(dates)} if dates and all((r.get('date') or (r.get('start') and r.get('end'))) for r in rows) else None
    return records, warnings, period, window


def entity_key(campaign, group, keyword, match):
    return norm(campaign), norm(group), norm(keyword), legacy.norm_match(match)


def parse_bulk(raw, context, warnings):
    if raw is None:
        return {}
    rows, columns, _window = table(raw)
    check_context(rows, columns, context, warnings, 'bulk')
    if 'entity' not in columns:
        fail('bulk 必须包含 Entity 列且仅 Keyword 实体提供 bid/IDs')
    result, ids = {}, set()
    for row in rows:
        if norm(row.get('entity')) not in ('keyword', '关键词'):
            continue
        if not all(row.get(k) for k in ('campaign', 'ad_group', 'keyword', 'match_type')):
            fail('Keyword 实体缺少名称或匹配类型')
        key = entity_key(row['campaign'], row['ad_group'], row['keyword'], row['match_type'])
        if key in result or (row.get('keyword_id') and row['keyword_id'] in ids):
            fail('重复 Keyword 实体存在歧义')
        if key[3] not in ('broad', 'phrase', 'exact'):
            fail('bulk Keyword 匹配类型不可识别')
        row['bid'] = positive(row['bid'], 'bulk Bid') if row.get('bid') else None
        result[key] = row
        if row.get('keyword_id'):
            ids.add(row['keyword_id'])
    parents, campaigns, parent_ids = {}, {}, {}
    for key, row in result.items():
        pair = (row.get('campaign_id', ''), row.get('ad_group_id', ''))
        for field in ('campaign_id', 'ad_group_id', 'keyword_id'):
            if row.get(field) and not row[field].isascii():
                fail('ID 必须为 Amazon 数字标识: ' + field)
            if row.get(field) and not row[field].isdigit():
                fail('ID 必须为 Amazon 数字标识: ' + field)
        if key[:2] in parents and parents[key[:2]] != pair:
            fail('同广告活动/广告组名称映射多个 IDs，实体歧义')
        if key[0] in campaigns and campaigns[key[0]] != pair[0]:
            fail('同广告活动名称映射多个 Campaign IDs')
        if all(pair) and pair in parent_ids and parent_ids[pair] != key[:2]:
            fail('同父 IDs 映射多个名称，实体歧义')
        parents[key[:2]] = pair
        campaigns[key[0]] = pair[0]
        if all(pair):
            parent_ids[pair] = key[:2]
    return result


def metrics(records):
    result = {k: sum(r[source] for r in records) for k, source in [('spend', 'spend'), ('sales', 'sales'), ('orders', 'orders'), ('clicks', 'clk')]}
    if not all(math.isfinite(v) for v in result.values()):
        fail('指标汇总溢出，必须为有限数')
    result['acos'] = result['spend'] / result['sales'] * 100 if result['sales'] else None
    if result['acos'] is not None and not math.isfinite(result['acos']):
        fail('ACOS 计算溢出')
    return result


def numeric_rows(rows, columns, label):
    required = {'campaign', 'spend', 'sales', 'orders', 'clicks'}
    if not required.issubset(columns):
        fail(label + '缺少列: ' + ', '.join(sorted(required - set(columns))))
    kept, seen, keys = [], set(), set()
    warning = None
    for row in rows:
        fingerprint = tuple(sorted((key, row.get(key, '')) for key in columns))
        if fingerprint in seen:
            warning = '重复指标行已去重'
            continue
        seen.add(fingerprint)
        for field in ('spend', 'sales', 'orders', 'clicks', 'impressions'):
            if field in columns:
                row[field] = metric(row[field], field)
        identity = tuple(norm(row.get(field, '')) for field in ('campaign', 'ad_group', 'placement', 'asin'))
        if identity in keys:
            fail(label + '存在同范围指标冲突')
        keys.add(identity)
        kept.append(row)
    rows[:] = kept
    return warning


def report_metrics(rows):
    return metrics([{'spend': row['spend'], 'sales': row['sales'], 'orders': row['orders'], 'clk': row['clicks']} for row in rows])


def parse_products(raw, context):
    if raw is None:
        return None, []
    rows, columns, window = table(raw)
    warnings = []
    for key in ('account', 'marketplace', 'currency'):
        if key in columns:
            values = {norm(row.get(key)) for row in rows}
            if values != {norm(context[key])}:
                fail(f'advertised_products: {key} 含多值、空值或与指定上下文不一致')
        else:
            warnings.append(f'advertised_products: {key} 未由报告验证，采用显式上下文')
    if 'asin' not in columns or 'ad_group' not in columns:
        fail('推广商品报告必须包含广告组和 Advertised ASIN')
    duplicate = numeric_rows(rows, columns, '推广商品报告')
    if duplicate:
        warnings.append(duplicate)
    grouped = {}
    for row in rows:
        if not row['asin'] or not row['campaign'] or not row['ad_group']:
            fail('推广商品报告的活动、广告组或 ASIN 为空')
        key = (norm(row['campaign']), norm(row['ad_group']))
        item = grouped.setdefault(key, {'campaign': row['campaign'], 'ad_group': row['ad_group'], 'asins': set()})
        item['asins'].add(row['asin'])
    groups = []
    for item in grouped.values():
        matched = len(item['asins']) == 1 and norm(next(iter(item['asins']))) == norm(context['asin'])
        groups.append({'campaign': item['campaign'], 'ad_group': item['ad_group'], 'asins': sorted(item['asins']),
                       'allocatable': matched})
    return {'metrics': report_metrics(rows), 'attribution_window': window, 'included_in_plan_metrics': False,
            'ad_groups': groups, '_index': grouped}, warnings


def parse_placements(raw, context):
    if raw is None:
        return None, []
    rows, columns, window = table(raw)
    warnings = []
    for key in ('account', 'marketplace', 'currency'):
        if key in columns:
            values = {norm(row.get(key)) for row in rows}
            if values != {norm(context[key])}:
                fail(f'placements: {key} 含多值、空值或与指定上下文不一致')
        else:
            warnings.append(f'placements: {key} 未由报告验证，采用显式上下文')
    if 'placement' not in columns:
        fail('广告位报告必须包含 Placement')
    duplicate = numeric_rows(rows, columns, '广告位报告')
    if duplicate:
        warnings.append(duplicate)
    summarized = []
    for row in rows:
        if not row['campaign'] or not row['placement']:
            fail('广告位报告的活动或广告位为空')
        summarized.append({'campaign': row['campaign'], 'placement': row['placement'], 'spend': row['spend'],
                           'sales': row['sales'], 'orders': row['orders'], 'clicks': row['clicks']})
    return {'metrics': report_metrics(rows), 'attribution_window': window, 'included_in_plan_metrics': False,
            'rows': summarized}, warnings


def apply_product_scope(actions, products, warnings):
    if not products:
        return
    missing = set()
    for action in actions:
        key = (norm(action['campaign']), norm(action['ad_group']))
        item = products['_index'].get(key)
        if item is None:
            missing.add(action['ad_group'])
            continue
        if len(item['asins']) > 1:
            action['blocking_reasons'].append('广告组包含多个 ASIN，搜索词结果无法分配到当前商品')
            action['exportable'] = False
        elif norm(next(iter(item['asins']))) != norm(action.get('_asin', '')):
            action['blocking_reasons'].append('推广商品报告中的广告组不属于当前 ASIN')
            action['exportable'] = False
    for name in sorted(missing):
        warnings.append('广告组未出现在推广商品报告，ASIN 归属未验证：' + name)


def evidence_card(period, search_metrics, search_window, products, placements):
    def entry(key, report, included):
        if not report:
            return {'key': key, 'uploaded': False, 'included_in_plan_metrics': False, 'spend': None, 'attribution_window': None}
        return {'key': key, 'uploaded': True, 'included_in_plan_metrics': included,
                'spend': report['metrics']['spend'], 'attribution_window': report.get('attribution_window')}
    search = {'metrics': search_metrics, 'attribution_window': search_window}
    reports = [entry('search_terms', search, True), entry('advertised_products', products, False), entry('placements', placements, False)]
    excluded = [item['spend'] for item in reports if item['uploaded'] and not item['included_in_plan_metrics']]
    return {'baseline_period': period, 'plan_spend': search_metrics['spend'], 'reports': reports,
            'companion_spend_excluded': round(sum(excluded), 2),
            'combination_rule': '只采用搜索词花费；推广商品和广告位不得相加'}


def build_plan(raw, bulk_raw, context, target, budget, products_raw=None, placements_raw=None):
    for key, value in context.items():
        if not value.strip():
            fail(key + '不能为空')
        context[key] = value.strip()
    target, budget = positive(target, 'target_acos'), positive(budget, 'daily_budget')
    records, warnings, period, search_window = parse_search(raw, context)
    entities = parse_bulk(bulk_raw, context, warnings)
    groups = defaultdict(list)
    for record in records:
        groups[entity_key(record['camp'], record['adg'], record['kw'], record['mt'])].append(record)
    metrics(records)  # Reject aggregate overflow before invoking the legacy engine.
    coverage = defaultdict(set)
    for record in records:
        coverage[norm(record['st'])].add((norm(record['camp']), norm(record['adg']), norm(record['kw']), record['mt']))
    for term, locations in coverage.items():
        if len(locations) > 1:
            warnings.append('重复覆盖仅提示，不据此自动否定：' + term)
    actions = []
    for key, group in groups.items():
        analysis = sanitize(run_analysis(group, {'target': target}))
        source = entities.get(key, {})
        for old in analysis['actions']:
            if not old['delta'] and '暂停' not in old['act']:
                continue
            kind = 'pause' if '暂停' in old['act'] and old['newBid'] is None else 'bid'
            bid = source.get('bid')
            observed = metrics(group)
            proposed = None
            if bid and kind == 'bid':
                if observed['orders'] > 0 and observed['clicks'] > 0:
                    ceiling = target / 100 * observed['sales'] / observed['clicks']
                    proposed = round(min(bid * 1.30, max(bid * .50, ceiling)), 2)
                else:
                    proposed = round(bid * .50, 2)
                if proposed < .02:
                    kind, proposed = 'pause', None
                elif abs(proposed - bid) < .005:
                    continue
            action = make_action(kind, old['kw'], old['camp'], old['adg'], old['mt'], bid, proposed, old['reason'] + '；按真实出价向盈利上限调整，单次最多上调 30% 或下调 50%', old['prio'], observed, source)
            actions.append(action)
        # Scoped exact negatives only; roots and conflict-derived negatives remain advisory.
        for old in analysis['negatives']:
            if not old['camp'] or not old['adg'] or old.get('source') == '互搏检测':
                warnings.append('亏损词根无确定范围或重复覆盖：仅提示，不自动否定')
                continue
            protected = any(norm(r['camp']) == norm(old['camp']) and norm(r['adg']) == norm(old['adg']) and norm(r['st']) == norm(old['word']) and r['orders'] > 0 for r in records)
            a = make_action('negative', old['word'], old['camp'], old['adg'], 'negativeExact', None, None, old['reason'], 'P1', {'clicks': old['clk'], 'spend': old['spend']}, source)
            if protected:
                a['blocking_reasons'].append('同组存在该搜索词的有订单记录，保护优质词')
                a['exportable'] = False
            actions.append(a)
        # Harvest recommendation uses the source's explicitly known real bid; no estimated bid.
        for old in analysis['harvest']:
            dest_key = entity_key(old['camp'], old['adg'], old['st'], 'exact')
            if dest_key in entities or dest_key in groups:
                warnings.append('已有精准覆盖：' + old['st'] + '，仅提示')
                continue
            actions.append(make_action('harvest', old['st'], old['camp'], old['adg'], 'exact', source.get('bid'), source.get('bid'), '优质搜索词建议新增精准投放；出价采用来源真实 Bid', 'P2', {'spend': old['spend'], 'sales': old['sales'], 'orders': old['orders']}, source))
    # Dedupe generated recommendations across keyword sources, preserving strict destination identity.
    unique = {}
    for a in actions:
        key = (a['kind'], norm(a['campaign']), norm(a['ad_group']), norm(a['keyword']), a['match_type'])
        if key in unique:
            warnings.append('重复覆盖动作合并，需人工确认：' + a['keyword'])
            unique[key]['exportable'] = False
            unique[key]['blocking_reasons'].append('多个来源生成相同动作，存在实体歧义')
        else:
            unique[key] = a
    campaigns = sorted({r['camp'] for r in records})
    allocations = []
    remaining = round(budget, 2)
    for i, campaign in enumerate(campaigns):
        amount = round(budget / len(campaigns), 2) if i < len(campaigns) - 1 else remaining
        remaining = round(remaining - amount, 2)
        allocations.append({'campaign': campaign, 'daily_budget': amount, 'reason': 'MVP 按活动均分；仅建议，不执行预算更新'})
    actions = list(unique.values())
    products, product_warnings = parse_products(products_raw, context)
    placements, placement_warnings = parse_placements(placements_raw, context)
    warnings.extend(product_warnings + placement_warnings)
    for action in actions:
        action['_asin'] = context['asin']
    apply_product_scope(actions, products, warnings)
    for action in actions:
        action.pop('_asin', None)
    if products or placements:
        warnings.append('推广商品与广告位指标单独列示，未并入搜索词花费')
    window_warning = same_window({'search_terms': search_window,
                                  **({'advertised_products': products['attribution_window']} if products else {}),
                                  **({'placements': placements['attribution_window']} if placements else {})})
    if window_warning:
        warnings.append(window_warning)
    if products:
        products.pop('_index', None)
    warnings.extend(['TSV 为待 Amazon 当前模板校验草稿，未获真实模板认证', '执行记录仅为用户手工登记；不验证 Amazon 实际执行'])
    return {'id': uuid4().hex, 'created_at': now(), 'context': context, 'status': 'pending', 'metrics': metrics(records),
            'warnings': list(dict.fromkeys(warnings)), 'actions': actions,
            'reports': {'search_terms': {'metrics': metrics(records), 'attribution_window': search_window, 'included_in_plan_metrics': True},
                        'advertised_products': products, 'placements': placements},
            'budget': {'daily_total': budget, 'allocations': allocations, 'advisory': True},
            'execution': None, 'review': None, 'exports': [], 'baseline_period': period, 'target_acos': target,
            'evidence': evidence_card(period, metrics(records), search_window, products, placements)}


def export_readiness(plan):
    approved = [action for action in plan.get('actions') or [] if action.get('status') == 'approved']
    blocked = []
    for action in approved:
        reasons = [str(reason) for reason in (action.get('blocking_reasons') or []) if str(reason).strip()]
        if action.get('exportable') is not True and not reasons:
            reasons.append('动作未标记为可导出')
        if action.get('exportable') is not True or reasons:
            blocked.append({'id': action.get('id'), 'keyword': action.get('keyword'), 'reasons': reasons or ['不可导出']})
    exported = bool(plan.get('exports'))
    validated = bool(exported and plan['exports'][0].get('template_validated') is True)
    return {'approved': len(approved), 'blocked': blocked,
            'ready': bool(approved) and not blocked,
            'already_exported': exported, 'template_validated': validated, 'download_executes_ads': False,
            'note': '下载草稿不会修改广告后台；模板尚未与当前亚马逊站点文件完成验收'}


def make_action(kind, keyword, campaign, group, match, bid, proposed, reason, priority, evidence, source):
    blocked = []
    for field in ('campaign_id', 'ad_group_id'):
        if not source.get(field):
            blocked.append('缺少 ' + field)
    if kind in ('bid', 'pause') and not source.get('keyword_id'):
        blocked.append('更新缺少 keyword_id')
    if kind in ('bid', 'pause', 'harvest') and bid is None:
        blocked.append('缺少真实 bulk Bid，禁止使用估算 bid')
    if kind in ('bid', 'harvest') and (proposed is None or not math.isfinite(proposed) or proposed <= 0):
        blocked.append('缺少明确有效的新出价')
    if kind in ('bid', 'pause') and match not in ('exact', 'phrase', 'broad'):
        blocked.append('Keyword 匹配类型不可更新')
    return {'id': uuid4().hex, 'kind': kind, 'keyword': keyword, 'campaign': campaign, 'ad_group': group,
            'match_type': match, 'current_bid': bid, 'proposed_bid': proposed, 'reason': reason,
            'evidence': evidence, 'evidence_basis': 'observed_history', 'forecast': None,
            'priority': priority, 'status': 'pending', 'exportable': not blocked,
            'blocking_reasons': blocked, 'entity_ids': {k: source.get(k) for k in ('campaign_id', 'ad_group_id', 'keyword_id')}}


def render_export(plan):
    approved = [a for a in plan['actions'] if a['status'] == 'approved']
    if not approved:
        fail('没有已批准动作')
    if any(not a['exportable'] or a['blocking_reasons'] for a in approved):
        fail('已批准动作中含未验证行、缺 IDs 或估算 bid；请撤销这些动作')
    columns = ['Product', 'Entity', 'Operation', 'Campaign ID', 'Ad Group ID', 'Keyword ID', 'Keyword Text', 'Match Type', 'Bid', 'State']
    output = io.StringIO(newline='')
    writer = csv.writer(output, delimiter='\t', lineterminator='\n')
    writer.writerow(columns)
    for a in approved:
        ids = a['entity_ids']
        writer.writerow(['Sponsored Products', 'Negative Keyword' if a['kind'] == 'negative' else 'Keyword',
                         'Update' if a['kind'] in ('bid', 'pause') else 'Create', ids['campaign_id'], ids['ad_group_id'],
                         ids['keyword_id'] if a['kind'] in ('bid', 'pause') else '', a['keyword'], a['match_type'],
                         a['proposed_bid'] if a['kind'] in ('bid', 'harvest') else '', 'paused' if a['kind'] == 'pause' else 'enabled'])
    return output.getvalue(), [a['id'] for a in approved]
