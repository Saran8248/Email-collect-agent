@echo off
title HR Contact Collection Agent - Dashboard
echo Starting Dashboard on http://127.0.0.1:8080...
cd /d %~dp0\dashboard
python -m http.server 8080
pause
