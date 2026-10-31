"""Local review-time ledger. Model price and advertising savings stay unknown."""
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path


@contextmanager
def database():
    path = Path(os.environ.get('AI_USAGE_DB_PATH') or os.environ.get('PPC_DB_PATH')
                or Path(__file__).resolve().parents[1] / 'data' / 'workflow.sqlite3')
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(str(path), timeout=20)
    connection.row_factory = sqlite3.Row
    try:
        connection.execute('''CREATE TABLE IF NOT EXISTS review_time (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            minutes INTEGER NOT NULL,
            note TEXT NOT NULL,
            created_at TEXT NOT NULL,
            user_id INTEGER NOT NULL DEFAULT 0
        )''')
        columns = {row['name'] for row in connection.execute('PRAGMA table_info(review_time)')}
        if 'user_id' not in columns:
            connection.execute('ALTER TABLE review_time ADD COLUMN user_id INTEGER NOT NULL DEFAULT 0')
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def record_review(minutes, note, user_id):
    if type(minutes) is not int or isinstance(minutes, bool) or not 1 <= minutes <= 1440:
        raise ValueError('审核耗时须为 1 到 1440 的整数分钟')
    text = str(note or '').strip()
    if len(text) > 200:
        raise ValueError('备注不能超过 200 字')
    with database() as connection:
        connection.execute('INSERT INTO review_time (minutes, note, created_at, user_id) VALUES (?, ?, ?, ?)',
                           (minutes, text, datetime.now(timezone.utc).isoformat(), int(user_id)))
    return summary({}, user_id)


def summary(model, user_id):
    model = model or {}
    with database() as connection:
        total = connection.execute('SELECT COUNT(*), COALESCE(SUM(minutes), 0) FROM review_time WHERE user_id=?', (int(user_id),)).fetchone()
        rows = [dict(row) for row in connection.execute(
            'SELECT id, minutes, note, created_at FROM review_time WHERE user_id=? ORDER BY id DESC LIMIT 20', (int(user_id),))]
    return {
        'model_calls': model.get('calls', 0),
        'known_total_tokens': model.get('total_tokens'),
        'model_cost': None,
        'review_count': total[0],
        'review_minutes': total[1],
        'reviews': rows,
        'advertising_savings': None,
        'note': '模型费用尚未核实；广告花费变化不是已节省金额',
    }
