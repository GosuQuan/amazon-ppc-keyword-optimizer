"""Email login and workflow ownership. Passwords are stored only as salted hashes."""
import hashlib
import hmac
import json
import os
import re
import secrets
import time
from base64 import urlsafe_b64decode, urlsafe_b64encode
from contextvars import ContextVar
from pathlib import Path

from fastapi import HTTPException, Request

EMAIL_RE = re.compile(r'^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$')
_user = ContextVar('workflow_user_id', default=None)


def _secret() -> bytes:
    configured = os.environ.get('AUTH_SECRET', '').strip()
    if configured:
        return configured.encode()
    path = Path(os.environ.get('PPC_DB_PATH') or Path(__file__).resolve().parents[1] / 'data' / 'workflow.sqlite3')
    key_path = path.parent / 'auth-secret.key'
    key_path.parent.mkdir(parents=True, exist_ok=True)
    if key_path.exists():
        return key_path.read_text(encoding='utf-8').strip().encode()
    value = secrets.token_hex(32)
    key_path.write_text(value, encoding='utf-8')
    return value.encode()


def _token_part(raw: bytes) -> str:
    return urlsafe_b64encode(raw).decode().rstrip('=')


def make_token(user_id: int) -> str:
    payload = _token_part(json.dumps({'uid': user_id, 'exp': int(time.time()) + 7 * 86400}, separators=(',', ':')).encode())
    signature = _token_part(hmac.new(_secret(), payload.encode(), hashlib.sha256).digest())
    return payload + '.' + signature


def verify_token(token: str):
    try:
        payload, signature = token.split('.')
        expected = _token_part(hmac.new(_secret(), payload.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(signature, expected):
            return None
        padded = payload + '=' * (-len(payload) % 4)
        data = json.loads(urlsafe_b64decode(padded.encode()))
        if data.get('exp', 0) < time.time():
            return None
        return int(data['uid'])
    except Exception:
        return None


def hash_password(password: str, salt_hex: str) -> str:
    return hashlib.pbkdf2_hmac('sha256', password.encode(), bytes.fromhex(salt_hex), 120_000).hex()


def normalize_email(email: str) -> str:
    value = str(email or '').strip().lower()
    if not EMAIL_RE.match(value):
        raise HTTPException(400, '请输入有效邮箱')
    return value


def validate_password(password: str) -> str:
    if not isinstance(password, str) or len(password) < 8 or len(password) > 200:
        raise HTTPException(400, '密码至少 8 位')
    return password


def bind_user(request: Request) -> int:
    authorization = request.headers.get('authorization', '')
    if not authorization.lower().startswith('bearer '):
        raise HTTPException(401, '请先登录')
    user_id = verify_token(authorization[7:].strip())
    if user_id is None:
        raise HTTPException(401, '登录已失效，请重新登录')
    _user.set(user_id)
    return user_id


def user_id() -> int:
    value = _user.get()
    if value is None:
        raise HTTPException(401, '请先登录')
    return value
