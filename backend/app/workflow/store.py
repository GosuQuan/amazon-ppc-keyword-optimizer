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
        connection.execute('CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, salt TEXT NOT NULL, created_at TEXT NOT NULL, ai_credits INTEGER NOT NULL DEFAULT 20)')
        user_columns = {row['name'] for row in connection.execute('PRAGMA table_info(users)')}
        if 'ai_credits' not in user_columns:
            connection.execute('ALTER TABLE users ADD COLUMN ai_credits INTEGER NOT NULL DEFAULT 20')
        if 'account_plan' not in user_columns:
            connection.execute("ALTER TABLE users ADD COLUMN account_plan TEXT NOT NULL DEFAULT 'individual'")
        connection.execute('''CREATE TABLE IF NOT EXISTS recharge_orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            pack TEXT NOT NULL,
            points INTEGER NOT NULL,
            price_cny REAL NOT NULL,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL
        )''')
        connection.execute('''CREATE TABLE IF NOT EXISTS point_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            service TEXT NOT NULL,
            points INTEGER NOT NULL,
            balance_after INTEGER NOT NULL,
            created_at TEXT NOT NULL
        )''')
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


STARTING_POINTS = {'individual': 1000, 'enterprise': 20000}
POINT_COSTS = {
    'workflow_plan': 5,
    'demo_plan': 1,
    'legacy_analyze': 5,
    'legacy_demo': 1,
    'export_draft': 2,
}
MODEL_COSTS = {
    'individual': {'flash': 10, 'other': 25},
    'enterprise': {'flash': 6, 'other': 15},
}
RECHARGE_PACKS = {
    'pro': {'title': 'Pro 积分包', 'priceCny': 9.9, 'points': 1500, 'plan': None,
            'basis': '价格量级对齐 YICOPY 工具 Pro：¥9.90、1500 算力、一次到账。本包不是 YICOPY 的产品或收款。'},
    'max': {'title': 'Max 积分包', 'priceCny': 49.9, 'points': 10000, 'plan': None,
            'basis': '价格量级对齐 YICOPY 工具 Max：¥49.90、10000 算力、一次到账。'},
    'ultra': {'title': 'Ultra 企业池', 'priceCny': 3000, 'points': 20000, 'plan': 'enterprise',
            'basis': '起价量级对齐 YICOPY Ultra：¥3000/月起。演示入账会切换企业模型积分，不代表已付款或已签约。'},
}


def model_point_cost(account_plan, model):
    plan = 'enterprise' if account_plan == 'enterprise' else 'individual'
    kind = 'flash' if 'flash' in str(model or '').lower() else 'other'
    return MODEL_COSTS[plan][kind], plan, kind


def user_plan(user_id):
    with database() as connection:
        row = connection.execute('SELECT account_plan FROM users WHERE id=?', (int(user_id),)).fetchone()
    return row['account_plan'] if row and row['account_plan'] else 'individual'


def apply_points(connection, user_id, service, amount):
    """Apply a signed point change on an open transaction. Negative amounts cannot overdraw."""
    from datetime import datetime, timezone
    amount = int(amount)
    if amount < 0:
        cursor = connection.execute(
            'UPDATE users SET ai_credits=ai_credits+? WHERE id=? AND ai_credits>=?',
            (amount, int(user_id), -amount))
        if cursor.rowcount != 1:
            return False
    else:
        cursor = connection.execute('UPDATE users SET ai_credits=ai_credits+? WHERE id=?', (amount, int(user_id)))
        if cursor.rowcount != 1:
            return False
    balance = connection.execute('SELECT ai_credits FROM users WHERE id=?', (int(user_id),)).fetchone()['ai_credits']
    connection.execute(
        'INSERT INTO point_events (user_id, service, points, balance_after, created_at) VALUES (?, ?, ?, ?, ?)',
        (int(user_id), str(service)[:80], amount, balance, datetime.now(timezone.utc).isoformat()))
    return True


def change_points(user_id, service, amount):
    with database() as connection:
        return apply_points(connection, user_id, service, amount)


def point_events(user_id, limit=20):
    with database() as connection:
        rows = connection.execute(
            'SELECT service, points, balance_after, created_at FROM point_events WHERE user_id=? ORDER BY id DESC LIMIT ?',
            (int(user_id), int(limit)))
        return [dict(row) for row in rows]


def save(connection, plan, user_id):
    connection.execute('INSERT OR REPLACE INTO plans (id, created_at, document, user_id) VALUES (?, ?, ?, ?)',
                       (plan['id'], plan['created_at'], json.dumps(plan, ensure_ascii=False, allow_nan=False), user_id))


def load(connection, identifier, user_id):
    row = connection.execute('SELECT document FROM plans WHERE id=? AND user_id=?', (identifier, user_id)).fetchone()
    if row is None:
        from fastapi import HTTPException
        raise HTTPException(404, '计划不存在')
    return json.loads(row[0])
