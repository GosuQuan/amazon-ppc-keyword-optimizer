"""Point packs and demo recharge. No real payment is collected."""
import os
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..auth import bind_user
from ..workflow.store import RECHARGE_PACKS, change_points, database

router = APIRouter(prefix='/api/billing', tags=['billing'])


class Recharge(BaseModel):
    pack: str


def demo_enabled():
    return os.environ.get('PPC_DEMO_RECHARGE', '1') != '0'


@router.get('/packs')
def packs():
    return {'demoRecharge': demo_enabled(), 'packs': RECHARGE_PACKS,
            'note': '演示入账不会产生真实扣款。正式支付尚未接入。'}


@router.post('/recharge')
def recharge(body: Recharge, user: int = Depends(bind_user)):
    pack = RECHARGE_PACKS.get(body.pack)
    if pack is None:
        raise HTTPException(404, '没有这个积分档位')
    if not demo_enabled():
        raise HTTPException(403, '正式支付尚未接入，当前不能入账')
    now = datetime.now(timezone.utc).isoformat()
    with database() as connection:
        existing = connection.execute(
            'SELECT id FROM recharge_orders WHERE user_id=? AND pack=? AND status=?',
            (user, body.pack, 'demo_no_payment')).fetchone()
        if existing:
            raise HTTPException(409, '该档位已经演示入账，不能重复充值')
    if not change_points(user, 'recharge_' + body.pack, pack['points']):
        raise HTTPException(404, '账号不存在')
    with database() as connection:
        if pack['plan'] == 'enterprise':
            connection.execute("UPDATE users SET account_plan='enterprise' WHERE id=?", (user,))
        connection.execute(
            'INSERT INTO recharge_orders (user_id, pack, points, price_cny, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
            (user, body.pack, pack['points'], pack['priceCny'], 'demo_no_payment', now))
        balance = connection.execute('SELECT ai_credits, account_plan FROM users WHERE id=?', (user,)).fetchone()
    return {'status': 'demo_no_payment', 'pack': body.pack, 'pointsAdded': pack['points'],
            'balance': balance['ai_credits'], 'plan': balance['account_plan'],
            'note': '演示入账，未发生真实支付'}
