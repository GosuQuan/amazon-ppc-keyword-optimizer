"""Keep AI usage tests from writing into the developer's local ledger."""
import pytest

from app import ai_cache


@pytest.fixture(autouse=True)
def isolate_ai_usage_db(monkeypatch, tmp_path):
    monkeypatch.setenv('AI_USAGE_DB_PATH', str(tmp_path / 'ai-usage.sqlite3'))
    ai_cache.clear()
