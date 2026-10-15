@echo off
title HR Contact Collection Agent - Dashboard
echo Starting Dashboard on http://127.0.0.1:8085 (or access directly at http://127.0.0.1:8000/dashboard)...
cd /d %~dp0\dashboard
python -m http.server 8085
pause
