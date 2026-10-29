"""API 路由：分析、导出、自检、AI 代理（可选）。"""
import json
import os
import urllib.request
import urllib.error
from typing import List, Optional

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse, PlainTextResponse

from .. import auth as AU
from ..engine import parser as P
from ..engine import selftest as ST
from ..engine.demo import demo_records
from ..engine.exporter import EXPORTERS
from ..engine.pipeline import run_analysis, sanitize

router = APIRouter(prefix="/api")

AI_TOKEN_URL = "http://127.0.0.1:18432/get_token"
AI_DEFAULT_UPSTREAM = "https://open.bigmodel.cn/api/paas/v4/chat/completions"
AI_DEFAULT_MODEL = "glm-4-flash"


@router.get("/health")
def health():
    return {"ok": True, "service": "amazon-ppc-optimizer", "version": "0.2.0"}


# ---------- 用户体系 ----------
def require_user(request: Request) -> dict:
    authz = request.headers.get("Authorization", "")
    token = authz[7:] if authz.startswith("Bearer ") else ""
    uid = AU.verify_token(token) if token else None
    user = AU.get_user(uid) if uid else None
    if not user:
        raise HTTPException(401, "未登录或登录已过期")
    return user


auth_router = APIRouter(prefix="/auth")


@auth_router.post("/send-code")
def send_code(body: dict, request: Request):
    if not AU.rate_ok("code:" + (request.client.host if request.client else "?")):
        raise HTTPException(429, "验证码请求过于频繁，请一小时后再试")
    tt = body.get("target_type")
    t = AU.validate_target(tt, body.get("target"))
    if not t:
        raise HTTPException(422, "邮箱或手机号格式不正确")
    code = AU.issue_code(t)
    return {"ok": True, "demo": True, "code": code,
            "note": "演示环境：验证码直接返回；正式环境将通过短信/邮件下发"}


@auth_router.post("/register")
def register(body: dict, request: Request):
    if not AU.rate_ok("reg:" + (request.client.host if request.client else "?")):
        raise HTTPException(429, "注册请求过于频繁，请一小时后再试")
    tt = body.get("target_type")
    t = AU.validate_target(tt, body.get("target"))
    if not t:
        raise HTTPException(422, "邮箱或手机号格式不正确")
    if not AU.check_code(t, str(body.get("code") or "")):
        raise HTTPException(422, "验证码错误或已过期")
    if AU.find_by_account(t):
        raise HTTPException(409, "该账号已注册，请直接登录")
    try:
        user = AU.create_user(tt, t, str(body.get("password") or ""))
    except ValueError as e:
        raise HTTPException(422, str(e))
    return {"token": AU.make_token(user["uid"]), "user": user}


@auth_router.post("/login")
def login(body: dict):
    row = AU.find_by_account(str(body.get("account") or ""))
    if not row or not AU.verify_password(row, str(body.get("password") or "")):
        raise HTTPException(401, "账号或密码错误")
    return {"token": AU.make_token(row["id"]), "user": AU.get_user(row["id"])}


@auth_router.get("/me")
def me(request: Request):
    return require_user(request)


router.include_router(auth_router)


@router.post("/analyze")
async def analyze(request: Request, files: List[UploadFile] = File(...),
                  target: Optional[float] = Form(None), ecvr: Optional[float] = Form(None),
                  min_clicks: Optional[float] = Form(None), aov: Optional[float] = Form(None),
                  up_cap: Optional[float] = Form(None), down_cap: Optional[float] = Form(None),
                  floor: Optional[float] = Form(None), imp_floor: Optional[float] = Form(None)):
    require_user(request)
    params = {"target": target, "ecvr": ecvr, "minClicks": min_clicks, "aovOverride": aov,
              "upCap": up_cap, "downCap": down_cap, "floor": floor, "impFloor": imp_floor}
    records: List[dict] = []
    file_infos: List[dict] = []
    for f in files:
        raw = await f.read()
        try:
            recs = P.parse_upload(raw, f.filename or "文件")
            records.extend(recs)
            file_infos.append({"name": f.filename, "rows": len(recs)})
        except ValueError as e:
            file_infos.append({"name": f.filename, "rows": 0, "error": str(e)})
        except Exception as e:  # noqa: BLE001
            file_infos.append({"name": f.filename, "rows": 0, "error": f"解析失败：{e}"})
    if not records:
        return JSONResponse({"error": "没有解析到有效数据行", "files": file_infos}, status_code=422)
    result = sanitize(run_analysis(records, params))
    result["files"] = file_infos
    return result


@router.get("/demo")
def demo(request: Request, target: Optional[float] = None, ecvr: Optional[float] = None,
         min_clicks: Optional[float] = None, aov: Optional[float] = None):
    require_user(request)
    params = {"target": target, "ecvr": ecvr, "minClicks": min_clicks, "aovOverride": aov}
    records = demo_records()
    result = sanitize(run_analysis(records, params))
    result["files"] = [{"name": "示例数据（后端内置：无线充电器品类）", "rows": len(records)}]
    return result


@router.post("/export/{kind}")
def export_csv(kind: str, request: Request, payload: dict):
    require_user(request)
    result = payload.get("result")
    if not result:
        raise HTTPException(422, "缺少 result 数据")
    if kind == "newwords":
        from ..engine.exporter import new_word_rows
        payload["result"]["aiExpansions"] = payload.get("aiExpansions")
        rows = new_word_rows(result.get("harvest", []), result.get("combos", []))
        text = EXPORTERS[kind]({"harvest": result.get("harvest", []), "combos": result.get("combos", []),
                                "aiExpansions": payload.get("aiExpansions")})
        return PlainTextResponse(text, media_type="text/csv; charset=utf-8",
                                 headers={"Content-Disposition": f'attachment; filename="{kind}.csv"'})
    if kind not in EXPORTERS:
        raise HTTPException(404, f"未知导出类型 {kind}")
    text = EXPORTERS[kind](result)
    return PlainTextResponse(text, media_type="text/csv; charset=utf-8",
                             headers={"Content-Disposition": f'attachment; filename="{kind}.csv"'})


@router.post("/selftest")
def selftest(request: Request):
    require_user(request)
    return ST.run_selftest()


def _bearer_for(body: dict) -> Optional[str]:
    key = str(body.get("api_key") or os.environ.get("AI_API_KEY") or "").strip()
    if key:
        return key if key.lower().startswith("bearer ") else "Bearer " + key
    try:
        with urllib.request.urlopen(AI_TOKEN_URL, timeout=6) as r:
            tok = r.read().decode("utf-8", "replace").strip()
        if tok:
            return tok if tok.lower().startswith("bearer") else "Bearer " + tok
    except Exception:  # noqa: BLE001
        pass
    return None


@router.post("/ai/chat")
def ai_chat(request: Request, body: dict):
    user = require_user(request)
    if not AU.consume_ai_credit(user["uid"]):
        raise HTTPException(403, "专家 AI 额度已用完（免费层含 20 次），升级或联系获取更多额度")
    upstream = str(body.get("base_url") or AI_DEFAULT_UPSTREAM).strip()
    payload = {"model": str(body.get("model") or AI_DEFAULT_MODEL),
               "messages": body.get("messages") or [],
               "temperature": body.get("temperature", 0.3)}
    if "max_tokens" in body:
        payload["max_tokens"] = body["max_tokens"]
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(upstream, data=data, method="POST",
                                 headers={"Content-Type": "application/json"})
    auth = _bearer_for(body)
    if auth:
        req.add_header("Authorization", auth)
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            return JSONResponse(json.loads(r.read().decode("utf-8", "replace")))
    except urllib.error.HTTPError as e:
        return JSONResponse(json.loads((e.read() or b"{}").decode("utf-8", "replace")), status_code=e.code)
    except Exception as e:  # noqa: BLE001
        return JSONResponse({"error": f"upstream failed: {e}"}, status_code=502)
