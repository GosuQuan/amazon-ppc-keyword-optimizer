"""AI usage ledger boundaries. Network and the developer's ledger are not used."""
import io
import json
import sqlite3
import urllib.error

import pytest
from fastapi.testclient import TestClient

from app.api import routes
from app.main import app

client = TestClient(app)
SECRET = 'SECRET_PROMPT SECRET_KEY SECRET_BODY SECRET_REASON SECRET_QUERY'


class Upstream:
    def __init__(self, body, status=200):
        self.status = status
        self.body = body.encode() if isinstance(body, str) else body

    def read(self):
        return self.body

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def install(monkeypatch, handler):
    monkeypatch.setenv('AI_BASE_URL', 'https://provider.example/v1/chat/completions')
    monkeypatch.setenv('AI_API_KEY', 'server-test-key')
    monkeypatch.setattr(routes.urllib.request, 'urlopen', handler)


def db_blob(tmp_path):
    return (tmp_path / 'ai-usage.sqlite3').read_bytes()


def test_success_records_hostname_zero_and_tokens(monkeypatch, tmp_path):
    def upstream(request, **kwargs):
        assert 'SECRET_QUERY' not in request.full_url
        return Upstream(json.dumps({
            'choices': [{'message': {'content': 'ok', 'reasoning_content': 'SECRET_REASON'}}],
            'usage': {'prompt_tokens': 0, 'completion_tokens': 4, 'total_tokens': 4},
            'echo': 'SECRET_BODY',
        }))
    install(monkeypatch, upstream)
    response = client.post('/api/ai/chat', json={
        'messages': [{'content': 'SECRET_PROMPT'}], 'api_key': 'SECRET_KEY',
    })
    assert response.status_code == 200
    usage = client.get('/api/ai/usage').json()
    record = usage['records'][0]
    assert record['provider'] == 'provider.example'
    assert record['success'] is True
    assert record['status'] == 200
    assert record['prompt_tokens'] == 0
    assert record['total_tokens'] == 4
    assert record['cost'] is None
    assert record['duration_ms'] >= 0
    assert usage['summary'] == {
        'calls': 1, 'successes': 1, 'failures': 0, 'cost': None,
        'prompt_tokens': 0, 'completion_tokens': 4, 'total_tokens': 4,
        'reasoning_tokens': None, 'reasoning_known_calls': 0,
        'prompt_known_calls': 1, 'completion_known_calls': 1, 'usage_known_calls': 1,
        'cache_hits': 0,
    }
    stored = db_blob(tmp_path).decode('utf-8', 'replace')
    assert 'SECRET_' not in stored
    assert 'chat/completions' not in stored


def test_reasoning_tokens_are_separate_and_not_secret(monkeypatch, tmp_path):
    install(monkeypatch, lambda request, **kwargs: Upstream(json.dumps({
        'choices': [{'message': {'content': 'ok', 'reasoning_content': 'SECRET_REASON'}}],
        'usage': {'prompt_tokens': 337, 'completion_tokens': 7728, 'total_tokens': 8065,
                  'completion_tokens_details': {'reasoning_tokens': 7177}},
    })))
    assert client.post('/api/ai/chat', json={'messages': [{'content': 'SECRET_PROMPT'}]}).status_code == 200
    usage = client.get('/api/ai/usage').json()
    record = usage['records'][0]
    assert record['completion_tokens'] == 7728
    assert record['reasoning_tokens'] == 7177
    assert usage['summary']['reasoning_tokens'] == 7177
    assert usage['summary']['reasoning_known_calls'] == 1
    assert 'SECRET_REASON' not in db_blob(tmp_path).decode('utf-8', 'replace')


@pytest.mark.parametrize('usage', [None, [], {'prompt_tokens': True, 'completion_tokens': 1.5, 'total_tokens': '4'}])
def test_invalid_usage_stays_null(monkeypatch, usage):
    body = {'choices': [{'message': {'content': 'ok'}}]}
    if usage is not None:
        body['usage'] = usage
    install(monkeypatch, lambda request, **kwargs: Upstream(json.dumps(body)))
    assert client.post('/api/ai/chat', json={'messages': []}).status_code == 200
    record = client.get('/api/ai/usage').json()['records'][0]
    assert record['prompt_tokens'] is None
    assert record['completion_tokens'] is None
    assert record['reasoning_tokens'] is None
    assert record['total_tokens'] is None


def test_huge_token_count_is_preserved(monkeypatch):
    huge = 10 ** 30
    install(monkeypatch, lambda request, **kwargs: Upstream(json.dumps({
        'choices': [{'message': {'content': 'ok'}}],
        'usage': {'prompt_tokens': huge, 'completion_tokens': 0, 'total_tokens': huge},
    })))
    assert client.post('/api/ai/chat', json={'messages': []}).status_code == 200
    summary = client.get('/api/ai/usage').json()['summary']
    assert summary['prompt_tokens'] == huge
    assert summary['total_tokens'] == huge


def test_http_and_connection_failures_are_counted_once(monkeypatch):
    def http_error(request, **kwargs):
        raise urllib.error.HTTPError(request.full_url, 429, 'limit', {}, io.BytesIO(b'{"usage":{"total_tokens":-1},"detail":"SECRET_BODY"}'))
    install(monkeypatch, http_error)
    assert client.post('/api/ai/chat', json={'messages': [{'content': 'SECRET_PROMPT'}]}).status_code == 429
    def offline(request, **kwargs):
        raise urllib.error.URLError('offline')
    monkeypatch.setattr(routes.urllib.request, 'urlopen', offline)
    assert client.post('/api/ai/chat', json={'messages': []}).status_code == 502
    def bad_json(request, **kwargs):
        return Upstream('not-json')
    monkeypatch.setattr(routes.urllib.request, 'urlopen', bad_json)
    assert client.post('/api/ai/chat', json={'messages': []}).status_code == 502
    usage = client.get('/api/ai/usage').json()
    assert usage['summary']['calls'] == 3
    assert usage['summary']['failures'] == 3
    assert [row['status'] for row in usage['records']] == [200, None, 429]
    assert usage['records'][2]['total_tokens'] is None
    assert 'SECRET_' not in json.dumps(usage)


def test_rejected_custom_endpoint_is_not_recorded(monkeypatch):
    called = []
    install(monkeypatch, lambda request, **kwargs: called.append(request) or Upstream('{}'))
    response = client.post('/api/ai/chat', json={'base_url': 'https://other.example/chat?token=SECRET_QUERY', 'messages': []})
    assert response.status_code == 400
    assert called == []
    assert client.get('/api/ai/usage').json()['summary']['calls'] == 0


def test_recent_fifty_and_full_summary(monkeypatch):
    from app import ai_usage
    for index in range(55):
        ai_usage.record_call(upstream='https://provider.example/secret-path?q=SECRET_QUERY', model='m' * 300,
                             status=200, success=True, duration_ms=1, user_id=1,
                             usage={'total_tokens': 2} if index % 2 == 0 else None)
    usage = client.get('/api/ai/usage').json()
    assert usage['summary']['calls'] == 55
    assert usage['summary']['usage_known_calls'] == 28
    assert usage['summary']['total_tokens'] == 56
    assert len(usage['records']) == 50
    assert usage['records'][0]['id'] == 55
    assert len(usage['records'][0]['model']) == 256
    assert 'SECRET_QUERY' not in json.dumps(usage)


def test_ledger_coexists_and_write_failure_keeps_response(monkeypatch, tmp_path):
    path = tmp_path / 'ai-usage.sqlite3'
    with sqlite3.connect(path) as connection:
        connection.execute('CREATE TABLE workflow_documents (id INTEGER)')
    install(monkeypatch, lambda request, **kwargs: Upstream('{"choices":[{"message":{"content":"ok"}}]}'))

    def broken(**kwargs):
        raise sqlite3.OperationalError('disk full')
    monkeypatch.setattr(routes.ai_usage, 'record_call', broken)
    assert client.post('/api/ai/chat', json={'messages': []}).status_code == 200
    with sqlite3.connect(path) as connection:
        assert connection.execute("SELECT name FROM sqlite_master WHERE name='workflow_documents'").fetchone()
