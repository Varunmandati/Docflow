@echo off
rem Stops the backend, frontend and database containers started by start.cmd.
title DocFlow Stopper
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-dev.ps1"
echo.
pause
