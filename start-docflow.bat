@echo off
echo ==============================================
echo   DocFlow Ultimate Startup Script
echo ==============================================
echo.
echo [1/5] Killing stuck servers...
taskkill /F /IM node.exe > nul 2>&1

echo [2/5] Starting Mock Redis Server (Port 6379)...
start "Mock Redis" cmd /k "node mock-redis.js"

echo [3/5] Starting Torrent Server...
start "DocFlow Torrent Server" cmd /k "node torrent-server.js"

echo [4/5] Starting Fastify API Backend (Port 8080)...
start "DocFlow API Backend" cmd /k "cd backend && npm run dev:api"

echo [5/5] Starting Vite Frontend (Port 3000)...
start "DocFlow Frontend" cmd /k "npm run dev"

echo.
echo All servers started! Please wait 10 seconds for Vite to compile, 
echo then open your browser at: http://localhost:3000
echo.
echo IMPORTANT: DO NOT CLOSE THE BLACK TERMINAL WINDOWS! 
echo If you close them, the services will stop. Please just MINIMIZE them.
pause
