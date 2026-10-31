"""Credential routing and upstream error boundaries; no live network calls."""
import io
import json
import urllib.error

from fastapi.testclient import TestClient
from app.main import app
from app.api import routes

client = TestClient(app)


def test_server_key_only_goes_to_configured_endpoint(monkeypatch):
    monkeypatch.setenv('AI_BASE_URL', 'https://provider.example/chat/completions')
    monkeypatch.setenv('AI_API_KEY', 'server-test-key')
    def forbidden(*args, **kwargs):
        raise AssertionError('Rejected request must never access network')
    monkeypatch.setattr(routes.urllib.request, 'urlopen', forbidden)
    response = client.post('/api/ai/chat', json={'base_url': 'https://other.example/chat/completions', 'messages': []})
    assert response.status_code == 400


def test_configured_key_and_explicit_key_are_separate(monkeypatch):
    monkeypatch.setenv('AI_BASE_URL', 'https://provider.example/chat/completions')
    monkeypatch.setenv('AI_API_KEY', 'server-test-key')
    seen = []
    def upstream(request, **kwargs):
        seen.append((request.full_url, request.get_header('Authorization')))
        return io.BytesIO(json.dumps({'choices': [{'message': {'content': 'OK'}}]}).encode())
    monkeypatch.setattr(routes.urllib.request, 'urlopen', upstream)
    assert client.post('/api/ai/chat', json={'messages': []}).status_code == 200
    assert client.post('/api/ai/chat', json={'base_url': 'https://other.example/chat/completions', 'api_key': 'browser-test-key', 'messages': []}).status_code == 200
    assert seen == [('https://provider.example/chat/completions', 'Bearer server-test-key'), ('https://other.example/chat/completions', 'Bearer browser-test-key')]


def test_non_json_upstream_error_is_safe(monkeypatch):
    monkeypatch.setenv('AI_API_KEY', 'server-test-key')
    def upstream(request, **kwargs):
        raise urllib.error.HTTPError(request.full_url, 429, 'limit', {}, io.BytesIO(b'<html>private details</html>'))
    monkeypatch.setattr(routes.urllib.request, 'urlopen', upstream)
    response = client.post('/api/ai/chat', json={'messages': []})
    assert response.status_code == 429
    assert response.json()['error']['code'] == 429
    assert 'private details' not in response.text
