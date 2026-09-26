@echo off
setlocal
echo ==============================================
echo   DocFlow Startup Script
echo ==============================================
echo.

echo [1/6] Cleaning up stale DocFlow processes on ports 8090/3002/3000...
for %%P in (8090 3002 3000) do (
  for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%%P" ^| findstr "LISTENING"') do (
    taskkill /PID %%p /F >nul 2>&1
  )
)
echo   Waiting for ports to be released...
timeout /t 3 /nobreak >nul

set WAITED=0
:wait_ports_free
:: Check all three ports for LISTENING status
netstat -ano | findstr ":8090" | findstr "LISTENING" >nul
if not errorlevel 1 goto ports_wait
netstat -ano | findstr ":3002" | findstr "LISTENING" >nul
if not errorlevel 1 goto ports_wait
netstat -ano | findstr ":3000" | findstr "LISTENING" >nul
if not errorlevel 1 goto ports_wait
:: If we reach here, all three are not found (free)
goto ports_free

:ports_wait
set /a WAITED+=1
if %WAITED% GEQ 30 goto ports_timeout
timeout /t 1 /nobreak >nul
goto wait_ports_free

:ports_timeout
echo.
echo   ERROR: Ports 8090, 3002, or 3000 did not free up in time.
echo   Please manually kill any processes using these ports and run again.
echo.
pause
exit /b 1

:ports_free
echo   Ports cleared.

echo [2/6] Checking Docker daemon...
docker info >nul 2>&1
if not errorlevel 1 goto docker_ok

echo   Docker is not running. Starting Docker Desktop...
if exist "%ProgramFiles%\Docker\Docker\Docker Desktop.exe" (
  start "" "%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
) else if exist "%ProgramFiles(x86)%\Docker\Docker\Docker Desktop.exe" (
  start "" "%ProgramFiles(x86)%\Docker\Docker\Docker Desktop.exe"
) else if exist "%LocalAppData%\Docker\Docker Desktop.exe" (
  start "" "%LocalAppData%\Docker\Docker Desktop.exe"
) else if exist "C:\Program Files\Docker\Docker\Docker Desktop.exe" (
  start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
) else (
  start "" "C:\Users\varun\AppData\Local\Programs\DockerDesktop\Docker Desktop.exe"
)
set WAITED=0
:wait_docker
docker info >nul 2>&1
if not errorlevel 1 goto docker_ok
set /a WAITED+=1
if %WAITED% GEQ 90 goto docker_timeout
timeout /t 2 /nobreak >nul
goto wait_docker

:docker_timeout
echo.
echo   ERROR: Docker Desktop did not start in time.
echo   Please open Docker Desktop manually and wait until the
echo   whale icon shows "Engine running", then re-run this script.
echo.
pause
exit /b 1

:docker_ok
echo   Docker daemon is up.

echo [3/6] Starting Docker infrastructure (Postgres + Redis)...
docker compose -f backend/docker-compose.yml up -d postgres redis
if errorlevel 1 goto compose_failed

echo   Waiting for Postgres + Redis to become healthy...
set WAITED=0
:wait_infra
set PG_OK=no
set RD_OK=no
for /f "delims=" %%s in ('docker inspect --format "{{.State.Health.Status}}" docflow_postgres 2^>nul') do if "%%s"=="healthy" set PG_OK=yes
for /f "delims=" %%s in ('docker inspect --format "{{.State.Health.Status}}" docflow-redis 2^>nul') do if "%%s"=="healthy" set RD_OK=yes
if "%PG_OK%%RD_OK%"=="yesyes" goto infra_ready
set /a WAITED+=1
if %WAITED% GEQ 60 goto infra_ready
timeout /t 2 /nobreak >nul
goto wait_infra

:infra_ready
echo   Postgres: %PG_OK%   Redis: %RD_OK%

echo [4/6] Starting Fastify API Backend (Port 8090)...
set "RUN_INLINE_WORKERS=true"
start "DocFlow API Backend" cmd /k "cd backend && npm run dev:api"

echo   Waiting for backend health check...
set WAITED=0
:wait_backend
curl -s -o nul -w "%%{http_code}" http://localhost:8090/v1/health > "%TEMP%\docflow_health.txt" 2>nul
set /p HEALTH=<"%TEMP%\docflow_health.txt"
if "%HEALTH%"=="200" goto backend_ready
set /a WAITED+=1
if %WAITED% GEQ 45 goto backend_ready
timeout /t 2 /nobreak >nul
goto wait_backend

:backend_ready
echo   Backend health: %HEALTH%

echo [5/6] Starting Torrent Server (Port 3002) with auto-restart...
start "DocFlow Torrent Server" cmd /k "cd streamtor && run-torrent.bat"

echo   Waiting for Torrent Server to become healthy...
set WAITED=0
:wait_torrent
curl -s -o nul -w "%%{http_code}" -H "X-Internal-Token: 08cbb3de27a426630f08c605ea2e1abeec68363f294c3f673f09781f0812da82" http://127.0.0.1:3002/api/torrents > "%TEMP%\docflow_torrent_health.txt" 2>nul
set /p TORRENT_HEALTH=<"%TEMP%\docflow_torrent_health.txt"
if "%TORRENT_HEALTH%"=="200" goto torrent_ready
set /a WAITED+=1
if %WAITED% GEQ 30 goto torrent_timeout
timeout /t 2 /nobreak >nul
goto wait_torrent

:torrent_timeout
echo.
echo   ERROR: Torrent Server did not become healthy in time.
echo   Please check streamtor console output.
echo.
pause
exit /b 1

:torrent_ready
echo   Torrent Server is healthy.
start "DocFlow Frontend" cmd /k "npm run dev -- --host"

echo   Waiting for Vite to compile...
set WAITED=0
:wait_vite
curl -s -o nul -w "%%{http_code}" http://localhost:3000/ > "%TEMP%\docflow_vite.txt" 2>nul
set /p VITE=<"%TEMP%\docflow_vite.txt"
if "%VITE%"=="200" goto vite_ready
set /a WAITED+=1
if %WAITED% GEQ 30 goto vite_ready
timeout /t 2 /nobreak >nul
goto wait_vite

:vite_ready
echo.
echo ==============================================
echo   All services started!
echo   Open your browser at: http://localhost:3000
echo.
echo   TIP: If you see a blank WHITE page, press Ctrl+Shift+R
echo   (hard refresh) once - Vite sometimes serves stale cached
echo   modules right after a restart.
echo ==============================================
echo.
echo IMPORTANT: DO NOT CLOSE THE BLACK TERMINAL WINDOWS!
echo If you close them, the services will stop. Just MINIMIZE them.
pause

:compose_failed
echo.
echo   ERROR: docker compose failed. Check that Docker Engine is running.
echo.
pause
exit /b 1