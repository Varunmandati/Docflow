@echo off
netstat -ano | findstr ":3002" | findstr "LISTENING" >nul
if not errorlevel 1 echo IN_USE
if errorlevel 1 echo FREE
