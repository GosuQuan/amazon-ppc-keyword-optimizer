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
            reasoning_tokens TEXT,
            created_at TEXT NOT NULL, user_id INTEGER NOT NULL DEFAULT 0
        )''')
        columns = {row['name'] for row in connection.execute('PRAGMA table_info(ai_usage)')}
        if 'user_id' not in columns:
            connection.execute('ALTER TABLE ai_usage ADD COLUMN user_id INTEGER NOT NULL DEFAULT 0')
        if 'reasoning_tokens' not in columns:
            connection.execute('ALTER TABLE ai_usage ADD COLUMN reasoning_tokens TEXT')
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def record_call(*, upstream, model, status, success, duration_ms, usage=None, user_id):
    usage = usage if isinstance(usage, dict) else {}
    tokens = []
    for field in TOKEN_FIELDS:
        value = usage.get(field)
        tokens.append(str(value) if type(value) is int and value >= 0 else None)
    details = usage.get('completion_tokens_details')
    reasoning = details.get('reasoning_tokens') if isinstance(details, dict) else None
    reasoning = str(reasoning) if type(reasoning) is int and reasoning >= 0 else None
    with database() as connection:
        connection.execute('''INSERT INTO ai_usage
            (provider, model, status, success, duration_ms,
             prompt_tokens, completion_tokens, total_tokens, reasoning_tokens, created_at, user_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
            (urlsplit(upstream).hostname, model[:256], status, int(success),
             max(0, int(duration_ms)), *tokens, reasoning, datetime.now(timezone.utc).isoformat(), int(user_id)))


def get_usage(user_id):
    with database() as connection:
        # One read snapshot keeps summary and recent entries consistent.
        connection.execute('BEGIN')
        records = [dict(row) for row in connection.execute(
            'SELECT * FROM ai_usage WHERE user_id=? ORDER BY id DESC LIMIT 50', (int(user_id),))]
        summary = dict(calls=0, successes=0, failures=0, cost=None)
        counted = (*TOKEN_FIELDS, 'reasoning_tokens')
        known_fields = ('prompt_known_calls', 'completion_known_calls', 'usage_known_calls', 'reasoning_known_calls')
        for token, known in zip(counted, known_fields):
            summary[token] = None
            summary[known] = 0
        for row in connection.execute('SELECT success, prompt_tokens, completion_tokens, total_tokens, reasoning_tokens FROM ai_usage WHERE user_id=?', (int(user_id),)):
            summary['calls'] += 1
            summary['successes' if row['success'] else 'failures'] += 1
            for token, known in zip(counted, known_fields):
                if row[token] is not None:
                    summary[token] = (summary[token] or 0) + int(row[token])
                    summary[known] += 1
    for record in records:
        record.pop('user_id', None)
        record['success'] = bool(record['success'])
        record['cost'] = None
        for field in (*TOKEN_FIELDS, 'reasoning_tokens'):
            if record[field] is not None:
                record[field] = int(record[field])
    return {'summary': summary, 'records': records}
