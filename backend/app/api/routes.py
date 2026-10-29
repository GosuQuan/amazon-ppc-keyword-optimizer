"""API 路由：分析、导出、自检、AI 代理（可选）。"""
import json
import os
import urllib.request
import urllib.error
from typing import List, Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse, PlainTextResponse

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
    return {"ok": True, "service": "amazon-ppc-optimizer", "version": "0.1.0"}


@router.post("/analyze")
async def analyze(files: List[UploadFile] = File(...),
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
def demo(target: Optional[float] = None, ecvr: Optional[float] = None,
         min_clicks: Optional[float] = None, aov: Optional[float] = None):
    params = {"target": target, "ecvr": ecvr, "minClicks": min_clicks, "aovOverride": aov}
    records = demo_records()
    result = sanitize(run_analysis(records, params))
    result["files"] = [{"name": "示例数据（后端内置：无线充电器品类）", "rows": len(records)}]
    return result


@router.post("/export/{kind}")
async def export_csv(kind: str, payload: dict):
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
def ai_chat(body: dict):
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
