"""Review-time cost ledger boundaries. No model calls or invented savings."""
import pytest
from fastapi.testclient import TestClient

from app.ai_usage import record_call
from app.main import app

client = TestClient(app)


def test_review_minutes_accumulate_without_pricing_or_savings():
    assert client.post('/api/cost/review', json={'minutes': 15, 'note': '核对阻断项'}).status_code == 200
    assert client.post('/api/cost/review', json={'minutes': 5, 'note': ''}).status_code == 200
    record_call(upstream='https://provider.example/v1/chat?token=SECRET', model='GLM-5.3-Flash',
                status=200, success=True, duration_ms=10, usage={'total_tokens': 30}, user_id=1)
    body = client.get('/api/cost').json()
    assert body['review_count'] == 2
    assert body['review_minutes'] == 20
    assert body['model_calls'] == 1
    assert body['known_total_tokens'] == 30
    assert body['model_cost'] is None
    assert body['advertising_savings'] is None
    assert 'SECRET' not in str(body)


@pytest.mark.parametrize('minutes', [0, -1, 1.5, True, '15', 1441])
def test_invalid_minutes_are_rejected(minutes):
    response = client.post('/api/cost/review', json={'minutes': minutes, 'note': 'x'})
    assert response.status_code == 400
    assert client.get('/api/cost').json()['review_count'] == 0


def test_review_notes_belong_to_the_logged_in_user():
    assert client.post('/api/cost/review', json={'minutes': 15, 'note': '仅自己可见'}).status_code == 200
    other = client.post('/api/auth/register', json={'email': 'other@example.com', 'password': 'password1'})
    hidden = client.get('/api/cost', headers={'Authorization': 'Bearer ' + other.json()['token']})
    assert hidden.status_code == 200
    assert hidden.json()['review_count'] == 0
    assert '仅自己可见' not in hidden.text


def test_long_note_is_rejected():
    response = client.post('/api/cost/review', json={'minutes': 1, 'note': '注' * 201})
    assert response.status_code == 400
    assert client.get('/api/cost').json()['review_count'] == 0
