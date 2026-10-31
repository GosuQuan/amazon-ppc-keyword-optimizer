"""Keep AI usage tests from writing into the developer's local ledger."""
import pytest


@pytest.fixture(autouse=True)
def isolate_ai_usage_db(monkeypatch, tmp_path):
    monkeypatch.setenv('AI_USAGE_DB_PATH', str(tmp_path / 'ai-usage.sqlite3'))
