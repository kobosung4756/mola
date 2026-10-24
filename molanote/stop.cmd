@echo off
rem Stops molanote if it is still running (normally it stops by itself when its tab is closed).
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 4173 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }"
echo molanote stopped.
timeout /t 2 >nul
