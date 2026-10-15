@echo off
title HR Contact Collection Agent - Backend API
echo Starting HR Contact Agent Backend on http://127.0.0.1:8000...
cd /d %~dp0
if not exist backend\.env (
    copy backend\.env.example backend\.env
)
set PYTHONPATH=backend
if exist .venv\Scripts\uvicorn.exe (
    .\.venv\Scripts\uvicorn.exe app.main:app --reload --host 127.0.0.1 --port 8000
) else (
    uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
)
pause
