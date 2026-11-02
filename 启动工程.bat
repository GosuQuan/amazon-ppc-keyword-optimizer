@echo off
chcp 65001 >nul
title 亚马逊投流关键词优化工具 - 前后端工程版
cd /d "%~dp0backend"
set PYTHONPATH=%~dp0.deps;%PYTHONPATH%
rem 默认前端：react（React 版在根路径，原生版在 /classic）
rem 想换回原生版做默认，把下面一行改成 set PPC_DEFAULT_APP=classic
set PPC_DEFAULT_APP=react
echo ==============================================
echo   亚马逊投流关键词优化工具 · 前后端工程版
echo   默认前端: React 版 http://127.0.0.1:8790/
echo   原生版: http://127.0.0.1:8790/classic/login.html
echo   API 文档: http://127.0.0.1:8790/docs
echo   停止服务: 关闭本窗口即可
echo ==============================================
echo 浏览器将在 3 秒后自动打开工作台...
start "" cmd /c "timeout /t 3 /nobreak >nul & start http://127.0.0.1:8790/"
python -m uvicorn app.main:app --host 127.0.0.1 --port 8790
echo.
echo 服务已停止。
pause
