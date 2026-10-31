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
    try:
        connection.execute('CREATE TABLE IF NOT EXISTS plans (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, document TEXT NOT NULL)')
        connection.commit()
        connection.execute('BEGIN IMMEDIATE')
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def save(connection, plan):
    connection.execute('INSERT OR REPLACE INTO plans VALUES (?, ?, ?)',
                       (plan['id'], plan['created_at'], json.dumps(plan, ensure_ascii=False, allow_nan=False)))


def load(connection, identifier):
    row = connection.execute('SELECT document FROM plans WHERE id=?', (identifier,)).fetchone()
    if row is None:
        from fastapi import HTTPException
        raise HTTPException(404, '计划不存在')
    return json.loads(row[0])
