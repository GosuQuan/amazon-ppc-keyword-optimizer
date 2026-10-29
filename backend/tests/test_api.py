"""API 端到端测试：注册登录 → 上传样例报表 → 分析/自检/健康检查。"""
import io
import os

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)
FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "sample.csv")


@pytest.fixture(scope="module")
def token():
    email = "api.e2e@example.com"
    r = client.post("/api/auth/send-code", json={"target_type": "email", "target": email})
    code = r.json()["code"]
    r = client.post("/api/auth/register", json={"target_type": "email", "target": email,
                                                "code": code, "password": "secret123"})
    return r.json()["token"]


def _h(token):
    return {"Authorization": "Bearer " + token}


def test_health():
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["ok"] is True


def test_analyze_sample_csv(token):
    with open(FIXTURE, "rb") as f:
        r = client.post("/api/analyze", headers=_h(token),
                        files={"files": ("sample.csv", f, "text/csv")},
                        data={"target": "25", "ecvr": "10", "minClicks": "8"})
    assert r.status_code == 200
    d = r.json()
    assert d["kpi"]["rows"] == 63
    assert d["kpi"]["stCount"] > 0
    assert d["actions"], "应产生优化动作"
    kws = [a["kw"] for a in d["actions"]]
    assert "thermos flask" in kws  # 样例中的亏损词
    assert any(n["type"] == "词组否定" for n in d["negatives"])
    assert any(c["locs"] >= 2 for c in d["conflicts"])


def test_analyze_requires_auth():
    with open(FIXTURE, "rb") as f:
        r = client.post("/api/analyze", files={"files": ("sample.csv", f, "text/csv")})
    assert r.status_code == 401


def test_analyze_bad_file_422(token):
    r = client.post("/api/analyze", headers=_h(token),
                    files={"files": ("bad.csv", b"", "text/csv")})
    assert r.status_code == 422
    assert "error" in r.json()


def test_selftest_endpoint(token):
    r = client.post("/api/selftest", headers=_h(token))
    assert r.status_code == 200
    d = r.json()
    assert d["total"] >= 25
    assert d["passed"] == d["total"], f"自检未全绿：{[x for x in d['results'] if not x['passed']]}"


def test_static_frontend_served():
    r = client.get("/")
    assert r.status_code == 200
    assert "亚马逊投流关键词优化工具" in r.text
