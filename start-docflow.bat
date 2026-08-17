@echo off
echo ==============================================
echo   DocFlow Startup Script
echo ==============================================
echo.

echo [0/4] Cleaning up stale DocFlow processes on ports 8080/3002/3000...
for %%P in (8080 3002 3000) do (
  for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%%P" ^| findstr "LISTENING"') do (
    taskkill /PID %%p /F >nul 2>&1
  )
)
timeout /t 2 /nobreak >nul
echo.

echo [1/4] Starting Docker infrastructure (Postgres + Redis)...
docker compose -f backend/docker-compose.yml up -d postgres redis

echo [2/4] Starting Fastify API Backend (Port 8080)...
set "RUN_INLINE_WORKERS=true"
start "DocFlow API Backend" cmd /k "cd backend && npm run dev:api"

echo [3/4] Starting Torrent Server (Port 3002) with auto-restart...
start "DocFlow Torrent Server" cmd /k "cd streamtor && run-torrent.bat"

echo [4/4] Starting Vite Frontend (Port 3000)...
start "DocFlow Frontend" cmd /k "npm run dev -- --host"

echo.
echo All services started! Please wait 10 seconds for Vite to compile,
echo then open your browser at: http://localhost:3000
echo.
echo IMPORTANT: DO NOT CLOSE THE BLACK TERMINAL WINDOWS!
echo If you close them, the services will stop. Please just MINIMIZE them.
pause