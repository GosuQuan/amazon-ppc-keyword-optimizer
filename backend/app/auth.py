"""用户体系：SQLite 存储、手机/邮箱注册（演示验证码）、登录签发 JWT。

演示说明：未接入短信/SMTP 服务商，验证码在发送接口响应中直接返回（demo 模式），
并在前端明示「演示环境」。生产化时替换 send_code 的投递通道即可，其余不变。
"""
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import time
from pathlib import Path
from typing import Any, Dict, Optional

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("PPC_DATA_DIR") or (BASE_DIR / "data"))
DATA_DIR.mkdir(exist_ok=True)
DB_PATH = DATA_DIR / "app.db"
SECRET_PATH = DATA_DIR / "secret.key"

EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$")
PHONE_RE = re.compile(r"^1[3-9]\d{9}$")

CODE_TTL = 600          # 验证码 10 分钟
TOKEN_TTL = 7 * 86400   # token 7 天
FREE_AI_CREDITS = 20    # 免费层专家 AI 挖掘次数（额度化定价）


def db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _secret() -> bytes:
    if SECRET_PATH.exists():
        return bytes.fromhex(SECRET_PATH.read_text().strip())
    s = secrets.token_hex(32)
    SECRET_PATH.write_text(s)
    return bytes.fromhex(s)


_SECRET = _secret()


def init_db() -> None:
    with db() as c:
        c.execute("""CREATE TABLE IF NOT EXISTS users(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE,
            phone TEXT UNIQUE,
            pw_hash TEXT NOT NULL,
            salt TEXT NOT NULL,
            ai_credits INTEGER NOT NULL DEFAULT 20,
            created_at INTEGER NOT NULL)""")
        c.execute("""CREATE TABLE IF NOT EXISTS codes(
            target TEXT PRIMARY KEY,
            code TEXT NOT NULL,
            expires_at INTEGER NOT NULL,
            used INTEGER NOT NULL DEFAULT 0)""")


def hash_pw(password: str, salt_hex: str) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), 120_000).hex()


def _b64u(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def make_token(uid: int) -> str:
    header = _b64u(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    payload = _b64u(json.dumps({"uid": uid, "exp": int(time.time()) + TOKEN_TTL}, separators=(",", ":")).encode())
    sig = _b64u(hmac.new(_SECRET, f"{header}.{payload}".encode(), hashlib.sha256).digest())
    return f"{header}.{payload}.{sig}"


def verify_token(token: str) -> Optional[int]:
    try:
        header, payload, sig = token.split(".")
        expect = _b64u(hmac.new(_SECRET, f"{header}.{payload}".encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, expect):
            return None
        data = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        if data.get("exp", 0) < time.time():
            return None
        return int(data["uid"])
    except Exception:  # noqa: BLE001
        return None


def validate_target(target_type: str, target: str) -> Optional[str]:
    """返回规范化后的 target；不合法返回 None。"""
    t = (target or "").strip().lower()
    if target_type == "email":
        return t if EMAIL_RE.match(t) else None
    if target_type == "phone":
        return target.strip() if PHONE_RE.match(target.strip()) else None
    return None


def issue_code(target: str) -> str:
    code = f"{secrets.randbelow(1_000_000):06d}"
    now = int(time.time())
    with db() as c:
        c.execute("INSERT INTO codes(target,code,expires_at,used) VALUES(?,?,?,0) "
                  "ON CONFLICT(target) DO UPDATE SET code=excluded.code,expires_at=excluded.expires_at,used=0",
                  (target, code, now + CODE_TTL))
    return code


def check_code(target: str, code: str) -> bool:
    now = int(time.time())
    with db() as c:
        row = c.execute("SELECT code,expires_at,used FROM codes WHERE target=?", (target,)).fetchone()
        if not row:
            return False
        if row["used"] or row["expires_at"] < now or row["code"] != str(code).strip():
            return False
        c.execute("UPDATE codes SET used=1 WHERE target=?", (target,))
    return True


def create_user(target_type: str, target: str, password: str) -> Dict[str, Any]:
    if len(password) < 6:
        raise ValueError("密码至少 6 位")
    salt = secrets.token_hex(16)
    pw = hash_pw(password, salt)
    now = int(time.time())
    with db() as c:
        cur = c.execute(
            "INSERT INTO users(email,phone,pw_hash,salt,ai_credits,created_at) VALUES(?,?,?,?,?,?)",
            (target if target_type == "email" else None,
             target if target_type == "phone" else None,
             pw, salt, FREE_AI_CREDITS, now))
        uid = cur.lastrowid
    return get_user(uid)


def get_user(uid: int) -> Optional[Dict[str, Any]]:
    with db() as c:
        row = c.execute("SELECT id,email,phone,ai_credits,created_at FROM users WHERE id=?", (uid,)).fetchone()
        if not row:
            return None
        return {"uid": row["id"], "email": row["email"], "phone": row["phone"],
                "aiCredits": row["ai_credits"],
                "displayName": row["email"] or (row["phone"][:3] + "****" + row["phone"][-4:] if row["phone"] else f"用户{row['id']}")}


def find_by_account(account: str) -> Optional[Dict[str, sqlite3.Row]]:
    a = (account or "").strip().lower()
    with db() as c:
        return c.execute("SELECT * FROM users WHERE email=? OR phone=?", (a, account.strip())).fetchone()


def verify_password(user_row: sqlite3.Row, password: str) -> bool:
    return hmac.compare_digest(hash_pw(password, user_row["salt"]), user_row["pw_hash"])


def consume_ai_credit(uid: int) -> bool:
    with db() as c:
        row = c.execute("SELECT ai_credits FROM users WHERE id=?", (uid,)).fetchone()
        if not row or row["ai_credits"] <= 0:
            return False
        c.execute("UPDATE users SET ai_credits=ai_credits-1 WHERE id=?", (uid,))
    return True


# ---- 简易 IP 限流（内存）：验证码 10 次/小时/IP，注册 10 次/小时/IP ----
RATE_ENABLED = os.environ.get("PPC_RATE_LIMIT", "1") != "0"
_rl: Dict[str, list] = {}


def rate_ok(key: str, limit: int = 10, window: int = 3600) -> bool:
    if not RATE_ENABLED:
        return True
    now = time.time()
    arr = [t for t in _rl.get(key, []) if now - t < window]
    if len(arr) >= limit:
        _rl[key] = arr
        return False
    arr.append(now)
    _rl[key] = arr
    return True


init_db()
