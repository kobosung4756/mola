@echo off
rem molanote launcher. scripts\start.ps1 installs what is missing the first time
rem (Node.js, the npm packages), then opens the app in the browser without a console window.
rem The app stops by itself a few seconds after its last browser tab is closed.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start.ps1"
