"""Exact-request cache boundaries. No live model calls."""
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
