"""Keep ledgers isolated and authenticate module-level API clients."""
import sys

import pytest
from fastapi.testclient import TestClient

from app import ai_cache
from app.main import app


@pytest.fixture(autouse=True)
def isolate_ai_usage_db(monkeypatch, tmp_path):
    database = tmp_path / 'ai-usage.sqlite3'
    monkeypatch.setenv('AI_USAGE_DB_PATH', str(database))
    monkeypatch.setenv('PPC_DB_PATH', str(database))
    monkeypatch.setenv('AUTH_SECRET', 'test-secret')
    ai_cache.clear()
    registered = TestClient(app).post('/api/auth/register', json={'email': 'ledger@example.com', 'password': 'password1'})
    assert registered.status_code == 200, registered.text
    token = registered.json()['token']
    for module in list(sys.modules.values()):
        candidate = getattr(module, 'client', None)
        if isinstance(candidate, TestClient):
            candidate.headers['Authorization'] = 'Bearer ' + token
