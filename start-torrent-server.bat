@echo off
REM Torrent Streaming Server Startup Script
REM This starts the standalone torrent server on port 3001

echo ╔═══════════════════════════════════════════╗
echo ║   DocFlow Torrent Streaming Server        ║
echo ║   Starting on port 3001...                ║
echo ╚═══════════════════════════════════════════╝
echo.

REM Check if we're in the correct directory
if not exist "torrent-server.js" (
    echo Error: torrent-server.js not found in current directory
    echo Please run this script from the project root directory
    pause
    exit /b 1
)

REM Check if node_modules exists
if not exist "node_modules" (
    echo Installing dependencies...
    call npm install
    if errorlevel 1 (
        echo Failed to install dependencies
        pause
        exit /b 1
    )
)

REM Start the torrent server
echo Starting torrent server...
node torrent-server.js

pause
