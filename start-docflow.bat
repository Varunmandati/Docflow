@echo off
echo ==============================================
echo   DocFlow Startup Script
echo ==============================================
echo.
echo [1/4] Starting Docker infrastructure (Postgres + Redis)...
docker compose -f backend/docker-compose.yml up -d postgres redis

echo [2/4] Waiting for Postgres to be healthy...
docker exec docflow_postgres pg_isready -U docflow_admin -d docflow > nul 2>&1
if errorlevel 1 (
  echo     Waiting for Postgres...
  timeout /t 8 /nobreak > nul
)

echo [3/4] Starting Fastify API Backend (Port 8080)...
set RUN_INLINE_WORKERS=true
start "DocFlow API Backend" cmd /k "cd backend && set RUN_INLINE_WORKERS=true && npm run dev:api"

echo [4/4] Starting Vite Frontend (Port 3000)...
start "DocFlow Frontend" cmd /k "npm run dev -- --host"

echo.
echo All services started! Please wait 10 seconds for Vite to compile,
echo then open your browser at: http://localhost:3000
echo.
echo IMPORTANT: DO NOT CLOSE THE BLACK TERMINAL WINDOWS!
echo If you close them, the services will stop. Please just MINIMIZE them.
pause