@echo off
for %%P in (8090 3002 3000) do (
  for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%%P" ^| findstr "LISTENING"') do (
    echo KILLED PID %%p
  )
)
