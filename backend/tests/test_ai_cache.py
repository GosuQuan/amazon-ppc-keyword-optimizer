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
    assert client.get('/api/auth/me').json()['aiCredits'] == before
    def http_error(request, **kwargs):
        raise urllib.error.HTTPError(request.full_url, 429, 'limit', {}, io.BytesIO(b'{}'))
    monkeypatch.setattr(routes.urllib.request, 'urlopen', http_error)
    rejected = client.post('/api/ai/chat', json={'messages': [{'content': 'limited'}]})
    assert rejected.status_code == 429
    assert client.get('/api/auth/me').json()['aiCredits'] == before - 10


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
