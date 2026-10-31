@echo off
chcp 65001 >nul
title 亚马逊投流关键词优化工具 - 前后端工程版
cd /d "%~dp0backend"
set PYTHONPATH=%~dp0.deps;%PYTHONPATH%
echo ==============================================
echo   亚马逊投流关键词优化工具 · 前后端工程版
echo   旧工具页: http://127.0.0.1:8790/
echo   优化工作台: http://127.0.0.1:8790/workflow.html
echo   API 文档: http://127.0.0.1:8790/docs
echo   停止服务: 关闭本窗口即可
echo ==============================================
echo 浏览器将在 3 秒后自动打开工作台...
start "" cmd /c "timeout /t 3 /nobreak >nul & start http://127.0.0.1:8790/workflow.html"
python -m uvicorn app.main:app --host 127.0.0.1 --port 8790
echo.
echo 服务已停止。
pause
