"""用户体系 pytest：手机/邮箱注册、登录、JWT、额度扣减、鉴权门。"""
import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _register(target_type, target, password='secret123'):
    r = client.post('/api/auth/send-code', json={'target_type': target_type, 'target': target})
    assert r.status_code == 200
    code = r.json()['code']
    r = client.post('/api/auth/register', json={'target_type': target_type, 'target': target,
                                                'code': code, 'password': password})
    assert r.status_code == 200, r.text
    return r.json()


def test_register_email_and_login():
    d = _register('email', 'pytest.email@example.com')
    assert d['token'] and d['user']['email'] == 'pytest.email@example.com'
    r = client.post('/api/auth/login', json={'account': 'pytest.email@example.com', 'password': 'secret123'})
    assert r.status_code == 200
    assert r.json()['user']['aiCredits'] == 20


def test_register_phone_and_login():
    d = _register('phone', '13800001234')
    assert d['user']['phone'] == '13800001234'
    r = client.post('/api/auth/login', json={'account': '13800001234', 'password': 'secret123'})
    assert r.status_code == 200


def test_register_bad_code():
    client.post('/api/auth/send-code', json={'target_type': 'email', 'target': 'bad.code@example.com'})
    r = client.post('/api/auth/register', json={'target_type': 'email', 'target': 'bad.code@example.com',
                                                'code': '000000', 'password': 'secret123'})
    assert r.status_code == 422


def test_register_duplicate():
    _register('email', 'dup@example.com')
    client.post('/api/auth/send-code', json={'target_type': 'email', 'target': 'dup@example.com'})
    r = client.post('/api/auth/register', json={'target_type': 'email', 'target': 'dup@example.com',
                                                'code': client.post('/api/auth/send-code', json={'target_type': 'email', 'target': 'dup@example.com'}).json()['code'],
                                                'password': 'secret123'})
    assert r.status_code == 409


def test_register_bad_target():
    r = client.post('/api/auth/send-code', json={'target_type': 'phone', 'target': '12345'})
    assert r.status_code == 422


def test_login_wrong_password():
    _register('email', 'wrong.pw@example.com')
    r = client.post('/api/auth/login', json={'account': 'wrong.pw@example.com', 'password': 'nope123'})
    assert r.status_code == 401


def test_me_and_protected_routes():
    d = _register('email', 'me@example.com')
    h = {'Authorization': 'Bearer ' + d['token']}
    assert client.get('/api/auth/me', headers=h).status_code == 200
    assert client.get('/api/auth/me').status_code == 401
    assert client.post('/api/analyze', files={'files': ('a.csv', b'', 'text/csv')}).status_code == 401
    assert client.get('/api/demo').status_code == 401
    assert client.post('/api/selftest').status_code == 401
    assert client.post('/api/ai/chat', json={}).status_code == 401


def test_ai_credit_consumption():
    d = _register('email', 'credit@example.com')
    h = {'Authorization': 'Bearer ' + d['token']}
    # 无外部上游时 ai/chat 返回 502/4xx，但只要不是 401/403 即说明额度门通过且已扣减
    client.post('/api/ai/chat', headers=h, json={'messages': [{'role': 'user', 'content': 'hi'}]})
    me = client.get('/api/auth/me', headers=h).json()
    assert me['aiCredits'] == 19


def test_jwt_tamper_rejected():
    d = _register('email', 'tamper@example.com')
    bad = d['token'][:-4] + 'AAAA'
    r = client.get('/api/auth/me', headers={'Authorization': 'Bearer ' + bad})
    assert r.status_code == 401
