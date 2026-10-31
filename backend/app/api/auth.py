"""Registration and login routes."""
import hmac
import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from ..auth import hash_password, make_token, normalize_email, validate_password, verify_token
from ..workflow.store import database

router = APIRouter(prefix='/api/auth', tags=['auth'])


class Credentials(BaseModel):
    email: str
    password: str


def _public_user(row):
    if isinstance(row, dict):
        return row
    return {'id': row['id'], 'email': row['email'], 'created_at': row['created_at'], 'aiCredits': row['ai_credits']}


@router.post('/register')
def register(body: Credentials):
    email = normalize_email(body.email)
    password = validate_password(body.password)
    salt = secrets.token_hex(16)
    now = datetime.now(timezone.utc).isoformat()
    with database() as connection:
        if connection.execute('SELECT id FROM users WHERE email=?', (email,)).fetchone():
            raise HTTPException(409, '该邮箱已注册')
        cursor = connection.execute(
            'INSERT INTO users (email, password_hash, salt, created_at, ai_credits) VALUES (?, ?, ?, ?, 20)',
            (email, hash_password(password, salt), salt, now))
        user = _public_user({'id': cursor.lastrowid, 'email': email, 'created_at': now, 'aiCredits': 20})
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
        row = connection.execute('SELECT id, email, created_at, ai_credits FROM users WHERE id=?', (uid,)).fetchone()
    if row is None:
        raise HTTPException(401, '登录已失效，请重新登录')
    return _public_user(row)
