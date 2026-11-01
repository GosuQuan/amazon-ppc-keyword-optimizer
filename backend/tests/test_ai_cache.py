"""Exact-request cache boundaries. No live model calls."""
import io
import json

from fastapi.testclient import TestClient

from app.api import routes
from app.main import app
from tests.test_ai_usage import Upstream, install

client = TestClient(app)


def test_identical_request_hits_cache_without_second_ledger_row(monkeypatch):
    calls = []

    def upstream(request, **kwargs):
        calls.append(request.full_url)
        return Upstream(json.dumps({'choices': [{'message': {'content': 'ok'}}], 'usage': {'total_tokens': 3}}))

    install(monkeypatch, upstream)
    body = {'messages': [{'role': 'user', 'content': 'same'}], 'temperature': 0.3}
    first = client.post('/api/ai/chat', json=body)
    second = client.post('/api/ai/chat', json=body)
    assert first.status_code == second.status_code == 200
    assert first.headers['x-ppc-cache'] == 'miss'
    assert second.headers['x-ppc-cache'] == 'hit'
    assert second.json()['choices'][0]['message']['content'] == 'ok'
    assert calls == ['https://provider.example/v1/chat/completions']
    usage = client.get('/api/ai/usage').json()
    assert usage['summary']['calls'] == 1
    assert usage['summary']['total_tokens'] == 3
    assert usage['summary']['cache_hits'] == 1


def test_message_temperature_and_errors_do_not_reuse_cache(monkeypatch):
    calls = []

    def upstream(request, **kwargs):
        calls.append(1)
        content = json.loads(request.data.decode())
        if content['messages'][0]['content'] == 'fail':
            raise TimeoutError('offline')
        return Upstream(json.dumps({'choices': [{'message': {'content': content['messages'][0]['content']}}]}))

    install(monkeypatch, upstream)
    assert client.post('/api/ai/chat', json={'messages': [{'content': 'one'}]}).headers['x-ppc-cache'] == 'miss'
    assert client.post('/api/ai/chat', json={'messages': [{'content': 'two'}], 'temperature': 0.9}).headers['x-ppc-cache'] == 'miss'
    assert client.post('/api/ai/chat', json={'messages': [{'content': 'fail'}]}).status_code == 502
    assert client.post('/api/ai/chat', json={'messages': [{'content': 'fail'}]}).status_code == 502
    assert len(calls) == 4


def test_cache_separates_credentials_and_endpoint_ports(monkeypatch):
    calls = []
    def upstream(request, **kwargs):
        calls.append(1)
        return Upstream(json.dumps({'choices': [{'message': {'content': str(len(calls))}}]}))
    install(monkeypatch, upstream)
    base = {'messages': [{'role': 'user', 'content': 'isolation'}], 'api_key': 'key-a'}
    first = client.post('/api/ai/chat', json=base)
    repeat = client.post('/api/ai/chat', json=base)
    other_key = client.post('/api/ai/chat', json={**base, 'api_key': 'key-b'})
    other_port = client.post('/api/ai/chat', json={**base, 'base_url': 'https://provider.example:8443/v1/chat/completions'})
    assert [r.headers['x-ppc-cache'] for r in (first, repeat, other_key, other_port)] == ['miss', 'hit', 'miss', 'miss']
    assert len(calls) == 3
    assert all('key-a' not in key and 'key-b' not in key for key in routes.ai_cache._entries)


def test_cache_is_not_shared_between_users(monkeypatch):
    calls = []
    install(monkeypatch, lambda request, **kwargs: calls.append(1) or Upstream('{"choices":[{"message":{"content":"ok"}}]}'))
    body = {'messages': [{'content': 'same'}]}
    assert client.post('/api/ai/chat', json=body).headers['x-ppc-cache'] == 'miss'
    assert client.post('/api/ai/chat', json=body).headers['x-ppc-cache'] == 'hit'
    other = client.post('/api/auth/register', json={'email': 'other@example.com', 'password': 'password1'})
    other_headers = {'Authorization': 'Bearer ' + other.json()['token']}
    second = client.post('/api/ai/chat', json=body, headers=other_headers)
    assert second.headers['x-ppc-cache'] == 'miss'
    assert len(calls) == 2
    assert client.get('/api/ai/usage').json()['summary']['cache_hits'] == 1
    assert client.get('/api/ai/usage', headers=other_headers).json()['summary']['cache_hits'] == 0


def test_connection_failure_refunds_credit_but_http_error_does_not(monkeypatch):
    import urllib.error
    before = client.get('/api/auth/me').json()['aiCredits']
    def offline(request, **kwargs):
        raise urllib.error.URLError('offline')
    install(monkeypatch, offline)
    failed = client.post('/api/ai/chat', json={'messages': [{'content': 'offline'}]})
    assert failed.status_code == 502
    assert '已退回' in failed.text
    assert '上游计费状态未知' in failed.text
    assert client.get('/api/auth/me').json()['aiCredits'] == before
    def http_error(request, **kwargs):
        raise urllib.error.HTTPError(request.full_url, 429, 'limit', {}, io.BytesIO(b'{}'))
    monkeypatch.setattr(routes.urllib.request, 'urlopen', http_error)
    rejected = client.post('/api/ai/chat', json={'messages': [{'content': 'limited'}]})
    assert rejected.status_code == 429
    assert client.get('/api/auth/me').json()['aiCredits'] == before - 10


def test_direct_timeout_refunds_platform_points_and_reports_unknown_provider_cost(monkeypatch):
    def timed_out(request, **kwargs):
        raise TimeoutError('upstream timed out')
    install(monkeypatch, timed_out)
    before = client.get('/api/auth/me').json()['points']
    response = client.post('/api/ai/chat', json={'messages': [{'content': 'direct timeout'}]})
    assert response.status_code == 502
    assert '平台积分已退回' in response.text
    assert '上游计费状态未知' in response.text
    assert client.get('/api/auth/me').json()['points'] == before


def test_failed_refund_does_not_claim_credit_was_returned(monkeypatch):
    import urllib.error
    def offline(request, **kwargs):
        raise urllib.error.URLError('offline')
    install(monkeypatch, offline)
    original = routes.change_points
    def fail_refund(user, service, amount):
        return False if amount > 0 else original(user, service, amount)
    monkeypatch.setattr(routes, 'change_points', fail_refund)
    response = client.post('/api/ai/chat', json={'messages': [{'content': 'refund failure'}]})
    assert response.status_code == 502
    assert '未能确认退回' in response.text
    assert '上游计费状态未知' in response.text
    assert '已退回' not in response.text


def test_credit_is_spent_only_on_upstream_calls(monkeypatch):
    calls = []
    install(monkeypatch, lambda request, **kwargs: calls.append(1) or Upstream('{"choices":[{"message":{"content":"ok"}}]}'))
    body = {'messages': [{'content': 'credit'}]}
    assert client.get('/api/auth/me').json()['points'] == 1000
    assert client.post('/api/ai/chat', json=body).headers['x-ppc-cache'] == 'miss'
    assert client.get('/api/auth/me').json()['points'] == 990
    assert client.post('/api/ai/chat', json=body).headers['x-ppc-cache'] == 'hit'
    assert client.get('/api/auth/me').json()['points'] == 990
    from app.workflow.store import database
    with database() as connection:
        connection.execute('UPDATE users SET ai_credits=0')
    blocked = client.post('/api/ai/chat', json={'messages': [{'content': 'another'}]})
    assert blocked.status_code == 402
    assert len(calls) == 1


def test_disabled_cache_and_rejected_endpoint(monkeypatch):
    calls = []
    monkeypatch.setenv('AI_CACHE_SECONDS', '0')
    install(monkeypatch, lambda request, **kwargs: calls.append(1) or Upstream('{"choices":[{"message":{"content":"ok"}}]}'))
    body = {'messages': [{'content': 'one'}]}
    assert client.post('/api/ai/chat', json=body).headers['x-ppc-cache'] == 'miss'
    assert client.post('/api/ai/chat', json=body).headers['x-ppc-cache'] == 'miss'
    assert len(calls) == 2
    response = client.post('/api/ai/chat', json={'base_url': 'https://other.example/chat?token=SECRET_QUERY', 'messages': body['messages']})
    assert response.status_code == 400
    assert len(calls) == 2
    assert 'SECRET_QUERY' not in json.dumps(client.get('/api/ai/usage').json())
