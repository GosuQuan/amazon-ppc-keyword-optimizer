"""FastAPI 入口：挂载 API 路由与前端静态资源。"""
import os

def _load_local_env() -> None:
    """Load the repository .env without overriding existing process variables or logging values."""
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), ".env")
    if not os.path.isfile(path):
        return
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_local_env()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .api.routes import router
from .api.workflow import router as workflow_router

app = FastAPI(title="亚马逊投流关键词优化工具 API", version="0.2.0")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)
app.include_router(router)
app.include_router(workflow_router)

_FRONTEND = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "frontend")
if os.path.isdir(_FRONTEND):
    app.mount("/", StaticFiles(directory=_FRONTEND, html=True), name="frontend")
