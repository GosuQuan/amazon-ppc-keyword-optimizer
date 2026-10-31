"""Workflow contract tests, isolated from main registration and legacy endpoints."""
import csv
import io
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.workflow import router


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv('PPC_DB_PATH', str(tmp_path / 'workflow.sqlite3'))
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def report(**changes):
    row = dict(Date='2026-01-01', ASIN='B001', Currency='USD', Campaign='Camp',
               **{'Ad Group': 'Group', 'Keyword': 'red shoe', 'Match Type': 'Exact',
                  'Customer Search Term': 'red shoe', 'Clicks': '30', 'Spend': '60',
                  'Sales': '30', 'Orders': '1'})
    row.update(changes)
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=list(row))
    writer.writeheader()
    writer.writerow(row)
    return output.getvalue()


BULK = ('Entity,Campaign,Ad Group,Keyword Text,Match Type,Bid,Campaign ID,Ad Group ID,Keyword ID\n'
        'Keyword,Camp,Group,red shoe,Exact,2.00,11,22,33\n')


def create(client, text=None, bulk=BULK, products=None, placements=None, **data):
    fields = dict(account='acct', marketplace='US', currency='USD', asin='B001')
    fields.update(data)
    files = {'search_terms': ('search.csv', text or report(), 'text/csv')}
    if bulk is not None:
        files['bulk'] = ('bulk.csv', bulk, 'text/csv')
    if products is not None:
        files['advertised_products'] = ('products.csv', products, 'text/csv')
    if placements is not None:
        files['placements'] = ('placements.csv', placements, 'text/csv')
    return client.post('/api/workflow/plans', data=fields, files=files)


def test_full_loop_persistence_and_idempotent_export(client):
    response = create(client)
    assert response.status_code == 200, response.text
    plan = response.json()
    url = '/api/workflow/plans/' + plan['id']
    assert plan['metrics']['spend'] == 60
    assert client.post(url + '/export').status_code == 422
    action = next(a for a in plan['actions'] if a['kind'] == 'bid')
    assert action['current_bid'] == 2
    assert action['proposed_bid'] < 2
    assert action['exportable']
    assert action['evidence_basis'] == 'observed_history'
    assert action['forecast'] is None
    plan = client.patch(url + '/actions/' + action['id'], json={'status': 'approved'}).json()
    assert plan['export_readiness']['ready'] is True
    assert plan['export_readiness']['template_validated'] is False
    assert plan['export_readiness']['download_executes_ads'] is False
    first = client.post(url + '/export')
    assert first.status_code == 200, first.text
    assert '33' in first.text and 'Update' in first.text
    assert client.post(url + '/export').content == first.content
    exported = client.get(url).json()
    assert exported['export_readiness']['already_exported'] is True
    assert exported['execution'] is None
    assert exported['exports'][0]['template_validated'] is False
    assert client.get(url).json()['exports'][0]['action_ids'] == [action['id']]
    assert client.get('/api/workflow/plans').json()[0]['id'] == plan['id']
    executed = client.post(url + '/execution', json={'executed_at': '2026-01-10', 'notes': 'Manual upload'})
    assert executed.status_code == 200, executed.text
    reviewed = client.post(url + '/review', data={'period_start': '2026-01-11', 'period_end': '2026-01-20'},
                           files={'search_terms': ('after.csv', report(Date='2026-01-15', Spend='30'), 'text/csv')})
    assert reviewed.status_code == 200, reviewed.text
    comparison = reviewed.json()['review']['comparison']
    assert reviewed.json()['review']['delta']['spend'] == -30
    assert comparison['daily_normalized'] is False
    assert comparison['baseline_days'] == 1
    assert comparison['declared_review_days'] == 10
    assert comparison['observed_report_days'] == 1
    assert comparison['advertising_savings'] is None
    assert reviewed.json()['review']['non_causal_note']
    fresh = FastAPI()
    fresh.include_router(router)
    assert TestClient(fresh).get(url).json()['status'] == 'reviewed'


@pytest.mark.parametrize('field,value', [('Spend', '-1'), ('Spend', 'NaN'), ('Clicks', 'inf'), ('Sales', '-2')])
def test_invalid_metrics(client, field, value):
    assert create(client, report(**{field: value})).status_code == 422


@pytest.mark.parametrize('field,value', [('target_acos', '0'), ('daily_budget', '-1'), ('target_acos', 'nan'), ('asin', ' ')])
def test_invalid_context_and_parameters(client, field, value):
    assert create(client, **{field: value}).status_code == 422


def test_context_mixture_and_duplicate_rows(client):
    text = report()
    assert create(client, text + report(ASIN='B002').splitlines()[1] + '\n').status_code == 422
    assert create(client, report(Currency='EUR')).status_code == 422
    duplicate = create(client, text + text.splitlines()[1] + '\n')
    assert duplicate.status_code == 200
    assert duplicate.json()['metrics']['spend'] == 60
    assert any('重复' in w for w in duplicate.json()['warnings'])
    assert create(client, text + report(Spend='61').splitlines()[1] + '\n').status_code == 422


def test_budget_split_ignores_spend(client):
    text = table_csv(
        ['Date', 'ASIN', 'Currency', 'Campaign', 'Ad Group', 'Keyword', 'Match Type', 'Customer Search Term', 'Clicks', 'Spend', 'Sales', 'Orders'],
        [['2026-01-01', 'B001', 'USD', 'Low', 'Group', 'shoe', 'Exact', 'shoe', '30', '10', '30', '1'],
         ['2026-01-01', 'B001', 'USD', 'High', 'Group', 'shoe', 'Exact', 'shoe', '30', '90', '30', '1']])
    plan = create(client, text, bulk=None, daily_budget='50').json()
    budget = plan['budget']
    assert budget['allocation_method'] == 'equal_split'
    assert budget['performance_based'] is False
    assert budget['executes_budget_changes'] is False
    amounts = {item['campaign']: item['daily_budget'] for item in budget['allocations']}
    assert amounts['High'] == amounts['Low'] == 25
    assert round(sum(amounts.values()), 2) == 50
    assert not any(action['kind'] == 'budget' for action in plan['actions'])


def test_missing_bid_ids_and_boundary_matching(client):
    for bulk in [None, BULK.replace(',33\n', ',\n'), BULK.replace('red shoe', 'redshoe')]:
        plan = create(client, bulk=bulk).json()
        a = next(a for a in plan['actions'] if a['kind'] == 'bid')
        assert not a['exportable']
        url = '/api/workflow/plans/' + plan['id']
        blocked = client.patch(url + '/actions/' + a['id'], json={'status': 'approved'}).json()
        assert blocked['export_readiness']['ready'] is False
        assert blocked['export_readiness']['blocked'][0]['reasons']
        assert client.post(url + '/export').status_code == 422
    assert create(client, bulk=BULK + BULK.splitlines()[1] + '\n').status_code == 422


def test_review_and_execution_failure_paths(client):
    plan = create(client).json()
    url = '/api/workflow/plans/' + plan['id']
    assert client.post(url + '/execution', json={'executed_at': '2026-01-10', 'notes': ''}).status_code == 422
    assert client.post(url + '/review', data={'period_start': '2026-01-11', 'period_end': '2026-01-20'}, files={'search_terms': ('r.csv', report(), 'text/csv')}).status_code == 422
    assert client.patch(url + '/actions/nope', json={'status': 'approved'}).status_code == 404
    assert client.patch(url + '/actions/' + plan['actions'][0]['id'], json={'status': 'invalid'}).status_code == 422
    assert client.get('/api/workflow/plans/missing').status_code == 404


def test_review_rejects_context_overlap_and_freezes_export(client):
    plan = create(client).json()
    url = '/api/workflow/plans/' + plan['id']
    a = next(a for a in plan['actions'] if a['exportable'])
    client.patch(url + '/actions/' + a['id'], json={'status': 'approved'})
    client.post(url + '/export')
    assert client.patch(url + '/actions/' + a['id'], json={'status': 'rejected'}).status_code == 409
    assert client.post(url + '/execution', json={'executed_at': '2026-01-01', 'notes': ''}).status_code == 422
    assert client.post(url + '/execution', json={'executed_at': '2026-01-10', 'notes': ''}).status_code == 200
    for start, end, text in [
        ('2026-01-01', '2026-01-10', report()),
        ('2026-01-11', '2026-01-20', report(Date='2026-01-15', ASIN='B002')),
        ('2026-01-11', '2026-01-20', report(Date='2026-01-15', Currency='EUR')),
        ('2026-01-11', '2026-01-20', report(Date='2026-01-21')),
    ]:
        result = client.post(url + '/review', data={'period_start': start, 'period_end': end},
                             files={'search_terms': ('r.csv', text, 'text/csv')})
        assert result.status_code == 422, result.text


def test_pause_exports_paused_and_bulk_metrics_ignored(client):
    bulk = BULK.replace('2.00', '0.01')
    plan = create(client, report(Orders='0', Sales='0'), bulk=bulk).json()
    # Legacy sees CPC=2, so forced pause conditions come from profitable ceiling instead.
    plan = create(client, report(Orders='1', Sales='0.01'), bulk=bulk).json()
    action = next(a for a in plan['actions'] if a['kind'] == 'pause')
    url = '/api/workflow/plans/' + plan['id']
    client.patch(url + '/actions/' + action['id'], json={'status': 'approved'})
    response = client.post(url + '/export')
    assert response.status_code == 200
    assert '\tpaused\n' in response.text
    with_metrics = BULK.replace('Keyword ID\n', 'Keyword ID,Spend,Sales\n').replace(',33\n', ',33,9999,9999\n')
    assert create(client, bulk=with_metrics).json()['metrics']['spend'] == 60


def seven_day_search():
    return table_csv(
        ['Date', 'ASIN', 'Currency', 'Campaign', 'Ad Group', 'Keyword', 'Match Type', 'Customer Search Term', 'Clicks', 'Spend', '7 Day Total Sales', '7 Day Total Orders (#)'],
        [['2026-01-01', 'B001', 'USD', 'Camp', 'Group', 'red shoe', 'Exact', 'red shoe', '30', '60', '30', '1']])


def table_csv(headers, rows):
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(headers)
    writer.writerows(rows)
    return output.getvalue()


def test_companion_reports_stay_separate_and_link_single_asin(client):
    products = table_csv(
        ['Campaign', 'Ad Group', 'Advertised ASIN', 'Clicks', 'Spend', '7 Day Total Sales', '7 Day Total Orders (#)', 'Currency'],
        [['Camp', 'Group', 'B001', '10', '999', '20', '1', 'USD']])
    placements = table_csv(
        ['Campaign', 'Placement', 'Clicks', 'Spend', '7 Day Total Sales', '7 Day Total Orders (#)', 'Currency'],
        [['Camp', 'Top of Search on Amazon', '5', '50', '10', '1', 'USD']])
    response = create(client, seven_day_search(), products=products, placements=placements)
    assert response.status_code == 200, response.text
    plan = response.json()
    assert plan['metrics']['spend'] == 60
    assert plan['reports']['advertised_products']['metrics']['spend'] == 999
    assert plan['reports']['placements']['metrics']['spend'] == 50
    assert plan['reports']['advertised_products']['included_in_plan_metrics'] is False
    assert plan['reports']['placements']['included_in_plan_metrics'] is False
    assert plan['reports']['advertised_products']['ad_groups'][0]['allocatable'] is True
    evidence = plan['evidence']
    assert evidence['plan_spend'] == 60
    assert evidence['companion_spend_excluded'] == 1049
    assert evidence['baseline_period'] == {'start': '2026-01-01', 'end': '2026-01-01'}
    assert [item['included_in_plan_metrics'] for item in evidence['reports']] == [True, False, False]
    assert '不得相加' in evidence['combination_rule']
    assert any(a['exportable'] for a in plan['actions'])


def test_mismatched_or_mixed_attribution_windows_fail(client):
    products = table_csv(
        ['Campaign', 'Ad Group', 'Advertised ASIN', 'Clicks', 'Spend', '14 Day Total Sales', '14 Day Total Orders', 'Currency'],
        [['Camp', 'Group', 'B001', '1', '1', '1', '1', 'USD']])
    assert create(client, seven_day_search(), products=products).status_code == 422
    mixed = report(**{'14 Day Total Sales': '30'})
    assert create(client, mixed).status_code == 422


def test_multi_asin_ad_group_blocks_actions(client):
    products = table_csv(
        ['Campaign', 'Ad Group', 'Advertised ASIN', 'Clicks', 'Spend', 'Sales', 'Orders', 'Currency'],
        [['Camp', 'Group', 'B001', '1', '10', '1', '1', 'USD'], ['Camp', 'Group', 'B002', '1', '10', '1', '1', 'USD']])
    response = create(client, products=products)
    assert response.status_code == 200, response.text
    plan = response.json()
    assert plan['metrics']['spend'] == 60
    assert all(not a['exportable'] and any('多个 ASIN' in b for b in a['blocking_reasons']) for a in plan['actions'])
    action = plan['actions'][0]
    url = '/api/workflow/plans/' + plan['id']
    client.patch(url + '/actions/' + action['id'], json={'status': 'approved'})
    assert client.post(url + '/export').status_code == 422


def test_shipped_chinese_example_report_runs(client):
    path = Path(__file__).resolve().parents[2] / 'examples' / '亚马逊搜索词报告-示例.csv'
    response = create(client, path.read_text(encoding='utf-8-sig'), bulk=None)
    assert response.status_code == 200, response.text
    plan = response.json()
    assert plan['metrics']['clicks'] > 0
    assert plan['metrics']['spend'] > 0
    assert plan['actions']
    assert all(not action['exportable'] for action in plan['actions'])


def test_real_bid_above_ceiling_is_decreased_not_increased(client):
    text = report(Clicks='10', Spend='1', Sales='100', Orders='2')
    plan = create(client, text, bulk=BULK.replace('2.00', '5.00')).json()
    action = next(a for a in plan['actions'] if a['kind'] == 'bid')
    assert action['current_bid'] == 5
    assert action['proposed_bid'] == 2.5
    assert '真实出价' in action['reason']


def test_missing_asin_warns_and_negative_protects_good_term(client):
    original = report()
    rows = list(csv.reader(io.StringIO(original)))
    index = rows[0].index('ASIN')
    for row in rows:
        row.pop(index)
    buffer = io.StringIO()
    csv.writer(buffer).writerows(rows)
    response = create(client, buffer.getvalue())
    assert response.status_code == 200
    assert any('asin 未由报告验证' in w for w in response.json()['warnings'])
    bad = report(**{'Match Type': 'Broad', 'Orders': '0', 'Sales': '0'})
    good = report(**{'Keyword': 'other source', 'Match Type': 'Broad', 'Spend': '1', 'Sales': '100', 'Orders': '2'})
    response = create(client, bad + good.splitlines()[1] + '\n')
    assert response.status_code == 200, response.text
    negatives = [a for a in response.json()['actions'] if a['kind'] == 'negative' and a['keyword'] == 'red shoe']
    assert negatives
    assert all(not a['exportable'] and any('保护' in b for b in a['blocking_reasons']) for a in negatives)
