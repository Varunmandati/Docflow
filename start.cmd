@echo off
rem ===========================================================================
rem  DocFlow - double-click this file to start everything.
rem  Starts Docker databases, the backend, and the frontend, then opens the app.
rem ===========================================================================
title DocFlow Launcher
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-dev.ps1"
echo.
pause
