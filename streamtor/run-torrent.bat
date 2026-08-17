@echo off
cd /d "%~dp0"

:restart
echo [%date% %time%] Checking port 3002...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3002" ^| findstr "LISTENING"') do (
  taskkill /PID %%p /F >nul 2>&1
)
echo [%date% %time%] Starting torrent server (port 3002)...
npx tsx server.ts
echo [%date% %time%] Torrent server exited (code %errorlevel%). Restarting in 3 seconds...
timeout /t 3 /nobreak >nul
goto restart
