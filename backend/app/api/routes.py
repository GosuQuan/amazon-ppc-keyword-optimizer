"""API 路由：分析、导出、自检、AI 代理（可选）。"""
import json
import logging
import os
import time
import urllib.request
import urllib.error
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse, PlainTextResponse

from .. import ai_cache, ai_usage, cost_ledger
from ..auth import bind_user
from ..engine import parser as P
from ..engine import selftest as ST
from ..engine.demo import demo_records
from ..engine.exporter import EXPORTERS
from ..engine.pipeline import run_analysis, sanitize

router = APIRouter(prefix="/api")

AI_TOKEN_URL = "http://127.0.0.1:18432/get_token"
AI_DEFAULT_UPSTREAM = "https://api.scnet.cn/api/llm/v1/chat/completions"
AI_DEFAULT_MODEL = "GLM-5.3-Flash"


@router.get("/health")
def health():
    return {"ok": True, "service": "amazon-ppc-optimizer", "version": "0.1.0"}


@router.post("/analyze")
async def analyze(files: List[UploadFile] = File(...), user: int = Depends(bind_user),
                  target: Optional[float] = Form(None), ecvr: Optional[float] = Form(None),
                  min_clicks: Optional[float] = Form(None), aov: Optional[float] = Form(None),
                  up_cap: Optional[float] = Form(None), down_cap: Optional[float] = Form(None),
                  floor: Optional[float] = Form(None), imp_floor: Optional[float] = Form(None)):
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
def demo(target: Optional[float] = None, ecvr: Optional[float] = None, user: int = Depends(bind_user),
         min_clicks: Optional[float] = None, aov: Optional[float] = None):
    params = {"target": target, "ecvr": ecvr, "minClicks": min_clicks, "aovOverride": aov}
    records = demo_records()
    result = sanitize(run_analysis(records, params))
    result["files"] = [{"name": "示例数据（后端内置：无线充电器品类）", "rows": len(records)}]
    return result


@router.post("/export/{kind}")
async def export_csv(kind: str, payload: dict, user: int = Depends(bind_user)):
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
def selftest():
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
def ai_chat(body: dict, user: int = Depends(bind_user)):
    configured = str(os.environ.get("AI_BASE_URL") or AI_DEFAULT_UPSTREAM).strip()
    upstream = str(body.get("base_url") or configured).strip()
    if upstream.rstrip('/') != configured.rstrip('/') and not str(body.get("api_key") or '').strip():
        raise HTTPException(400, "自定义接口必须提供独立密钥，不能使用本机保存的密钥。")
    model = str(body.get("model") or os.environ.get("AI_MODEL") or AI_DEFAULT_MODEL)
    payload = {"model": model,
               "messages": body.get("messages") or [],
               "temperature": body.get("temperature", 0.3)}
    if "bigmodel.cn" in upstream and model.lower().startswith("glm-5.3"):
        payload["thinking"] = {"type": "enabled"}
    if "max_tokens" in body:
        payload["max_tokens"] = body["max_tokens"]
    cached = ai_cache.get(upstream, payload, user)
    if cached is not None:
        response = JSONResponse(cached)
        response.headers['X-PPC-Cache'] = 'hit'
        return response
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(upstream, data=data, method="POST",
                                 headers={"Content-Type": "application/json"})
    auth = _bearer_for(body)
    if auth:
        req.add_header("Authorization", auth)
    started = time.perf_counter()
    status = None
    success = False
    usage = None
    attempted = False
    try:
        attempted = True
        with urllib.request.urlopen(req, timeout=300) as r:
            status = getattr(r, 'status', 200)
            result = json.loads(r.read().decode("utf-8", "replace"))
            usage = result.get('usage') if isinstance(result, dict) else None
            response = JSONResponse(result)
            success = status is not None and 200 <= status < 300
            if success:
                ai_cache.put(upstream, payload, result, user)
                response.headers['X-PPC-Cache'] = 'miss'
            return response
    except urllib.error.HTTPError as e:
        status = e.code
        # Only extract usage; never persist error bodies or messages.
        try:
            result = json.loads(e.read().decode('utf-8', 'replace'))
            usage = result.get('usage') if isinstance(result, dict) else None
        except Exception:  # noqa: BLE001
            pass
        finally:
            e.close()
        return JSONResponse({"error": {"code": e.code, "message": "模型服务拒绝请求，请检查接口配置、密钥、模型和额度。"}}, status_code=e.code)
    except Exception:  # noqa: BLE001
        return JSONResponse({"error": "模型服务连接失败或响应格式无效，请稍后重试。"}, status_code=502)
    finally:
        if not attempted:
            return
        try:
            ai_usage.record_call(upstream=upstream, model=model, status=status,
                                 success=success, duration_ms=(time.perf_counter() - started) * 1000,
                                 usage=usage, user_id=user)
        except Exception:  # noqa: BLE001
            logging.getLogger(__name__).error('AI usage ledger write failed')


@router.get('/ai/usage')
def get_ai_usage(user: int = Depends(bind_user)):
    data = ai_usage.get_usage(user)
    data['summary']['cache_hits'] = ai_cache.hits(user)
    return data


@router.get('/cost')
def get_cost(user: int = Depends(bind_user)):
    return cost_ledger.summary(ai_usage.get_usage(user)['summary'], user)


@router.post('/cost/review')
def add_review(body: dict, user: int = Depends(bind_user)):
    try:
        return cost_ledger.record_review(body.get('minutes'), body.get('note'), user)
    except ValueError as error:
        raise HTTPException(400, str(error)) from error
