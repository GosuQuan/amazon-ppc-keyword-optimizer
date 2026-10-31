"""Registration and login routes."""
import hmac
import secrets
import os
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from ..auth import hash_password, make_token, normalize_email, validate_password, verify_token
from ..workflow.store import MODEL_COSTS, POINT_COSTS, STARTING_POINTS, database, point_events

router = APIRouter(prefix='/api/auth', tags=['auth'])


@router.get('/pricing')
def pricing():
    return {'startingPoints': STARTING_POINTS, 'serviceCosts': POINT_COSTS, 'modelCosts': MODEL_COSTS,
            'note': '积分不是人民币或广告费。企业价只降低模型调用积分，不包含广告投放或人工服务。'}


class Credentials(BaseModel):
    email: str
    password: str
    enterpriseCode: Optional[str] = None


def _public_user(row):
    if isinstance(row, dict):
        points = row.get('points', row.get('ai_credits', row.get('aiCredits')))
        return {'id': row['id'], 'email': row['email'], 'created_at': row['created_at'],
                'plan': row.get('plan') or row.get('account_plan') or 'individual',
                'points': points, 'aiCredits': points}
    points = row['ai_credits']
    return {'id': row['id'], 'email': row['email'], 'created_at': row['created_at'],
            'plan': row['account_plan'] if 'account_plan' in row.keys() else 'individual',
            'points': points, 'aiCredits': points}


@router.post('/register')
def register(body: Credentials):
    email = normalize_email(body.email)
    password = validate_password(body.password)
    code = (body.enterpriseCode or '').strip()
    plan = 'individual'
    if code:
        expected = os.environ.get('PPC_ENTERPRISE_CODE', '')
        if not expected or not hmac.compare_digest(code, expected):
            raise HTTPException(400, '企业开通码不正确')
        plan = 'enterprise'
    salt = secrets.token_hex(16)
    now = datetime.now(timezone.utc).isoformat()
    starting = STARTING_POINTS[plan]
    with database() as connection:
        if connection.execute('SELECT id FROM users WHERE email=?', (email,)).fetchone():
            raise HTTPException(409, '该邮箱已注册')
        cursor = connection.execute(
            'INSERT INTO users (email, password_hash, salt, created_at, ai_credits, account_plan) VALUES (?, ?, ?, ?, ?, ?)',
            (email, hash_password(password, salt), salt, now, starting, plan))
        user = _public_user({'id': cursor.lastrowid, 'email': email, 'created_at': now, 'ai_credits': starting, 'account_plan': plan})
    return {'token': make_token(user['id']), 'user': user}


@router.post('/login')
def login(body: Credentials):
    email = normalize_email(body.email)
    password = body.password if isinstance(body.password, str) else ''
    with database() as connection:
        row = connection.execute('SELECT * FROM users WHERE email=?', (email,)).fetchone()
    if row is None or not hmac.compare_digest(hash_password(password, row['salt']), row['password_hash']):
        raise HTTPException(401, '邮箱或密码不正确')
    return {'token': make_token(row['id']), 'user': _public_user(row)}


@router.get('/me')
def me(authorization: str = Header(None)):
    if not authorization or not authorization.lower().startswith('bearer '):
        raise HTTPException(401, '请先登录')
    uid = verify_token(authorization[7:].strip())
    if uid is None:
        raise HTTPException(401, '登录已失效，请重新登录')
    with database() as connection:
        row = connection.execute('SELECT id, email, created_at, ai_credits, account_plan FROM users WHERE id=?', (uid,)).fetchone()
    if row is None:
        raise HTTPException(401, '登录已失效，请重新登录')
    user = _public_user(row)
    user['recentPoints'] = point_events(uid)
    return user
