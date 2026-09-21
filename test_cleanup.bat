@echo off
setlocal
echo Testing cleanup for port 3002
for %%P in (3002) do (
  echo Checking port %%P
  for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%%P" ^| findstr "LISTENING"') do (
    echo Found PID %%p for port %%P
    taskkill /PID %%p /F
    echo Killed %%p
  )
)
end