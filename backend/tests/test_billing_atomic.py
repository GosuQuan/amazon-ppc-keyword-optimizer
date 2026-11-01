"""Demo recharge must credit at most once and roll back all changes on failure."""
from concurrent.futures import ThreadPoolExecutor
import sqlite3

import pytest
from fastapi import HTTPException
from app.api.billing import Recharge, recharge
from app.workflow.store import database


@pytest.fixture
def user(monkeypatch, tmp_path):
    monkeypatch.setenv('PPC_DB_PATH', str(tmp_path / 'billing.sqlite'))
    monkeypatch.setenv('PPC_DEMO_RECHARGE', '1')
    with database() as conn:
        cursor = conn.execute("INSERT INTO users (email,password_hash,salt,created_at,ai_credits) VALUES ('test@example.test','x','x','now',100)")
        return cursor.lastrowid


def test_concurrent_recharge_is_credited_once(user):
    def call(_):
        try:
            return recharge(Recharge(pack='ultra'), user=user)['status']
        except HTTPException as exc:
            return exc.status_code
    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(call, range(6)))
    assert results.count('demo_no_payment') == 1
    assert results.count(409) == 5
    with database() as conn:
        row = conn.execute('SELECT ai_credits, account_plan FROM users WHERE id=?', (user,)).fetchone()
        assert (row['ai_credits'], row['account_plan']) == (20100, 'enterprise')
        assert conn.execute('SELECT count(*) FROM recharge_orders').fetchone()[0] == 1
        assert conn.execute('SELECT count(*) FROM point_events').fetchone()[0] == 1


def test_order_failure_rolls_back_balance_and_plan(user):
    with database() as conn:
        conn.execute("CREATE TRIGGER fail_order BEFORE INSERT ON recharge_orders BEGIN SELECT RAISE(ABORT, 'test failure'); END")
    with pytest.raises(sqlite3.IntegrityError):
        recharge(Recharge(pack='ultra'), user=user)
    with database() as conn:
        row = conn.execute('SELECT ai_credits, account_plan FROM users WHERE id=?', (user,)).fetchone()
        assert (row['ai_credits'], row['account_plan']) == (100, 'individual')
        assert conn.execute('SELECT count(*) FROM recharge_orders').fetchone()[0] == 0
        assert conn.execute('SELECT count(*) FROM point_events').fetchone()[0] == 0
