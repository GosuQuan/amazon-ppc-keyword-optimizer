"""SQLite document store; each mutation runs inside one write transaction."""
import json
import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path


@contextmanager
def database():
    path = Path(os.environ.get('PPC_DB_PATH') or Path(__file__).resolve().parents[2] / 'data' / 'workflow.sqlite3')
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(str(path), timeout=20)
    connection.row_factory = sqlite3.Row
    try:
        connection.execute('CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, salt TEXT NOT NULL, created_at TEXT NOT NULL)')
        connection.execute('CREATE TABLE IF NOT EXISTS plans (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, document TEXT NOT NULL, user_id INTEGER NOT NULL DEFAULT 0)')
        columns = {row['name'] for row in connection.execute('PRAGMA table_info(plans)')}
        if 'user_id' not in columns:
            connection.execute('ALTER TABLE plans ADD COLUMN user_id INTEGER NOT NULL DEFAULT 0')
        connection.commit()
        connection.execute('BEGIN IMMEDIATE')
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def save(connection, plan, user_id):
    connection.execute('INSERT OR REPLACE INTO plans (id, created_at, document, user_id) VALUES (?, ?, ?, ?)',
                       (plan['id'], plan['created_at'], json.dumps(plan, ensure_ascii=False, allow_nan=False), user_id))


def load(connection, identifier, user_id):
    row = connection.execute('SELECT document FROM plans WHERE id=? AND user_id=?', (identifier, user_id)).fetchone()
    if row is None:
        from fastapi import HTTPException
        raise HTTPException(404, '计划不存在')
    return json.loads(row[0])
