"""Login and per-user workflow isolation."""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.auth import router as auth_router
from app.api.workflow import router as workflow_router


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv('PPC_DB_PATH', str(tmp_path / 'app.sqlite3'))
    monkeypatch.setenv('AUTH_SECRET', 'test-secret')
    app = FastAPI()
    app.include_router(auth_router)
    app.include_router(workflow_router)
    return TestClient(app)


def register(client, email):
    response = client.post('/api/auth/register', json={'email': email, 'password': 'password1'})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body['user']['email'] == email
    assert 'password' not in response.text
    return body['token']


def test_me_returns_only_the_authenticated_user(client):
    token = register(client, 'a@example.com')
    register(client, 'b@example.com')
    me = client.get('/api/auth/me', headers={'Authorization': 'Bearer ' + token})
    assert me.status_code == 200
    assert me.json()['email'] == 'a@example.com'
    assert 'password' not in me.text


def test_login_rejects_bad_password_and_missing_token(client):
    register(client, 'a@example.com')
    assert client.post('/api/auth/login', json={'email': 'missing@example.com', 'password': 'password1'}).status_code == 401
    wrong = client.post('/api/auth/login', json={'email': 'a@example.com', 'password': 'wrong-password'})
    assert wrong.status_code == 401
    assert wrong.json()['detail'] == '邮箱或密码不正确'
    assert client.get('/api/workflow/plans').status_code == 401
    assert client.post('/api/auth/register', json={'email': 'a@example.com', 'password': 'short'}).status_code == 400


def test_plans_are_isolated_by_user(client):
    token_a = register(client, 'a@example.com')
    token_b = register(client, 'b@example.com')
    search = 'Date,ASIN,Currency,Campaign,Ad Group,Keyword,Match Type,Customer Search Term,Clicks,Spend,Sales,Orders\n2026-01-01,B001,USD,Camp,Group,shoe,Exact,shoe,30,60,30,1\n'
    created = client.post('/api/workflow/plans', headers={'Authorization': 'Bearer ' + token_a},
                          data={'account': 'acct', 'marketplace': 'US', 'currency': 'USD', 'asin': 'B001', 'target_acos': '25', 'daily_budget': '50'},
                          files={'search_terms': ('search.csv', search, 'text/csv')})
    assert created.status_code == 200, created.text
    plan_id = created.json()['id']
    own = client.get('/api/workflow/plans', headers={'Authorization': 'Bearer ' + token_a})
    other = client.get('/api/workflow/plans', headers={'Authorization': 'Bearer ' + token_b})
    hidden = client.get('/api/workflow/plans/' + plan_id, headers={'Authorization': 'Bearer ' + token_b})
    assert [item['id'] for item in own.json()] == [plan_id]
    assert other.json() == []
    assert hidden.status_code == 404
