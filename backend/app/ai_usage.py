"""Minimal metadata-only AI call ledger, independent of workflow documents."""
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

TOKEN_FIELDS = ('prompt_tokens', 'completion_tokens', 'total_tokens')


@contextmanager
def database():
    path = Path(os.environ.get('AI_USAGE_DB_PATH') or os.environ.get('PPC_DB_PATH')
                or Path(__file__).resolve().parents[1] / 'data' / 'workflow.sqlite3')
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(str(path), timeout=20)
    connection.row_factory = sqlite3.Row
    try:
        # Decimal text preserves arbitrarily large JSON integers without SQLite overflow.
        connection.execute('''CREATE TABLE IF NOT EXISTS ai_usage (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            provider TEXT, model TEXT NOT NULL, status INTEGER,
            success INTEGER NOT NULL, duration_ms INTEGER NOT NULL,
            prompt_tokens TEXT, completion_tokens TEXT, total_tokens TEXT,
            created_at TEXT NOT NULL
        )''')
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def record_call(*, upstream, model, status, success, duration_ms, usage=None):
    usage = usage if isinstance(usage, dict) else {}
    tokens = []
    for field in TOKEN_FIELDS:
        value = usage.get(field)
        tokens.append(str(value) if type(value) is int and value >= 0 else None)
    with database() as connection:
        connection.execute('''INSERT INTO ai_usage
            (provider, model, status, success, duration_ms,
             prompt_tokens, completion_tokens, total_tokens, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)''',
            (urlsplit(upstream).hostname, model[:256], status, int(success),
             max(0, int(duration_ms)), *tokens, datetime.now(timezone.utc).isoformat()))


def get_usage():
    with database() as connection:
        # One read snapshot keeps summary and recent entries consistent.
        connection.execute('BEGIN')
        records = [dict(row) for row in connection.execute(
            'SELECT * FROM ai_usage ORDER BY id DESC LIMIT 50')]
        summary = dict(calls=0, successes=0, failures=0, cost=None)
        known_fields = ('prompt_known_calls', 'completion_known_calls', 'usage_known_calls')
        for token, known in zip(TOKEN_FIELDS, known_fields):
            summary[token] = None
            summary[known] = 0
        for row in connection.execute('SELECT success, prompt_tokens, completion_tokens, total_tokens FROM ai_usage'):
            summary['calls'] += 1
            summary['successes' if row['success'] else 'failures'] += 1
            for token, known in zip(TOKEN_FIELDS, known_fields):
                if row[token] is not None:
                    summary[token] = (summary[token] or 0) + int(row[token])
                    summary[known] += 1
    for record in records:
        record['success'] = bool(record['success'])
        record['cost'] = None
        for field in TOKEN_FIELDS:
            if record[field] is not None:
                record[field] = int(record[field])
    return {'summary': summary, 'records': records}
