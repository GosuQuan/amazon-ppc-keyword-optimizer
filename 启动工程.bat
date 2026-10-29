@echo off
chcp 65001 >nul
title 亚马逊投流关键词优化工具 - 前后端工程版
cd /d "%~dp0backend"
echo ==============================================
echo   亚马逊投流关键词优化工具 · 前后端工程版
echo   工具页: http://127.0.0.1:8787/
echo   API 文档: http://127.0.0.1:8787/docs
echo   停止服务: 关闭本窗口即可
echo ==============================================
echo 浏览器将在 3 秒后自动打开工具页...
start "" cmd /c "timeout /t 3 /nobreak >nul & start http://127.0.0.1:8787/"
python -m uvicorn app.main:app --host 127.0.0.1 --port 8787
echo.
echo 服务已停止。
pause
