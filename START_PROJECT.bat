@echo off
REM DocFlow Project Startup Script for Windows
REM Run this to start all services

echo.
echo =========================================
echo   DocFlow Project - Startup Script
echo =========================================
echo.

REM Check if Redis is running
echo [1/4] Checking Redis...
redis-cli ping >nul 2>&1
if errorlevel 1 (
    echo ❌ Redis is NOT running. Please start Redis:
    echo    redis-server
    echo.
    pause
    exit /b 1
) else (
    echo ✅ Redis is running
)

echo.
echo [2/4] Backend API will start on: http://localhost:8080
echo [3/4] Backend Worker will process jobs
echo [4/4] Frontend will start on: http://localhost:5173
echo.

echo =========================================
echo Open 3 terminal windows and run:
echo =========================================
echo.
echo Terminal 1 (Backend API):
echo   cd backend
echo   npm run dev:api
echo.
echo Terminal 2 (Backend Worker):
echo   cd backend
echo   npm run dev:worker
echo.
echo Terminal 3 (Frontend):
echo   npm run dev
echo.
echo Then open: http://localhost:5173
echo.
echo =========================================
echo.
pause
