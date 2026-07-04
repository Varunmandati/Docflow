@echo off
echo ==============================================
echo   DocFlow - Stop All Services
echo ==============================================
echo.
echo Closing all DocFlow services...

REM Kill all node processes first
taskkill /F /IM node.exe >nul 2>&1

REM Now close the cmd.exe windows by their title (opened by start-docflow.bat)
for %%T in ("Mock Redis" "DocFlow Torrent Server" "DocFlow API Backend" "DocFlow Frontend") do (
    for /f "tokens=2" %%P in ('tasklist /FI "WINDOWTITLE eq %%~T*" /FI "IMAGENAME eq cmd.exe" /NH 2^>nul ^| findstr /I "cmd"') do (
        taskkill /PID %%P /F >nul 2>&1
    )
)

REM Fallback: force-close any cmd windows with those titles using PowerShell
powershell -Command "Get-Process cmd -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -match 'Mock Redis|DocFlow Torrent|DocFlow API|DocFlow Frontend' } | Stop-Process -Force" >nul 2>&1

echo.
echo All DocFlow services and windows have been closed.
echo.
pause
