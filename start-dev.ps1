# =============================================================================
# DocFlow - single-click dev launcher (called by start.cmd)
#
#   1. Starts Docker Desktop if its engine isn't up
#   2. Starts Postgres + Redis (backend/docker-compose.yml)
#   3. Starts the backend API + inline worker in its own window
#   4. Starts the frontend dev server in its own window
#   5. Waits for the API health check, then opens the app in your browser
#
# Nothing here changes your code or data - it only starts the services the
# README already documents.
# =============================================================================
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backend = Join-Path $root 'backend'

function Write-Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "    OK  $msg" -ForegroundColor Green }
function Write-Bad($msg)  { Write-Host "    !!  $msg" -ForegroundColor Red }

# --- 1. Docker engine -------------------------------------------------------
Write-Step 'Checking Docker engine...'
$dockerUp = $false
try { docker info 2>$null | Out-Null; $dockerUp = ($LASTEXITCODE -eq 0) } catch { $dockerUp = $false }

if (-not $dockerUp) {
    $dd = 'C:\Users\varun\AppData\Local\Programs\DockerDesktop\Docker Desktop.exe'
    if (Test-Path $dd) {
        Write-Step 'Starting Docker Desktop (first boot can take ~60s)...'
        Start-Process -FilePath $dd | Out-Null
    } else {
        Write-Bad 'Docker Desktop not found. Install Docker, then re-run start.cmd'
        exit 1
    }
    for ($i = 0; $i -lt 36; $i++) {
        try { docker info 2>$null | Out-Null; if ($LASTEXITCODE -eq 0) { break } } catch {}
        Start-Sleep -Seconds 5
    }
    try { docker info 2>$null | Out-Null } catch { $global:LASTEXITCODE = 1 }
    if ($LASTEXITCODE -ne 0) {
        Write-Bad 'Docker engine did not come up. Open Docker Desktop and re-run start.cmd'
        exit 1
    }
}
Write-Ok 'Docker engine is running'

# --- 2. Postgres + Redis ----------------------------------------------------
Write-Step 'Starting Postgres + Redis containers...'
Push-Location $backend
try {
    # NB: no 2>"&1" redirect here - PowerShell 5.1 turns redirected native stderr
    # into a terminating error when $ErrorActionPreference is 'Stop'.
    docker compose up -d postgres redis
    if ($LASTEXITCODE -ne 0) {
        Write-Bad 'docker compose up failed - see the error above.'
        exit 1
    }
} finally { Pop-Location }

$deadline = (Get-Date).AddSeconds(90)
do {
    $pg = $false; $rd = $false
    try { $pg = [bool](Get-NetTCPConnection -LocalPort 5435 -State Listen -ErrorAction SilentlyContinue) } catch {}
    try { $rd = [bool](Get-NetTCPConnection -LocalPort 6379 -State Listen -ErrorAction SilentlyContinue) } catch {}
    if ($pg -and $rd) { break }
    Start-Sleep -Seconds 3
} while ((Get-Date) -lt $deadline)

if (-not ($pg -and $rd)) {
    Write-Bad 'Postgres (5435) / Redis (6379) did not come up - check Docker Desktop.'
    exit 1
}
Write-Ok 'Postgres (5435) and Redis (6379) are listening'

# --- 3. Backend (API + inline worker) --------------------------------------
Write-Step 'Starting backend on http://localhost:8090 ...'
$backendAlive = $false
try { $backendAlive = [bool](Get-NetTCPConnection -LocalPort 8090 -State Listen -ErrorAction SilentlyContinue) } catch {}
if ($backendAlive) {
    Write-Ok 'Backend already running - reusing it'
} else {
    Start-Process -FilePath 'cmd.exe' -ArgumentList '/k', "cd /d `"$backend`" && npm run dev:api" -WindowStyle Normal | Out-Null
    $deadline = (Get-Date).AddSeconds(90)
    do {
        Start-Sleep -Seconds 3
        try { $backendAlive = [bool](Get-NetTCPConnection -LocalPort 8090 -State Listen -ErrorAction SilentlyContinue) } catch {}
    } while (-not $backendAlive -and (Get-Date) -lt $deadline)
    if (-not $backendAlive) {
        Write-Bad 'Backend did not start. Check the "DocFlow Backend" window for errors.'
        exit 1
    }
    Write-Ok 'Backend is listening'
}

# --- 4. Frontend ------------------------------------------------------------
Write-Step 'Starting frontend on http://localhost:3000 ...'
$feAlive = $false
try { $feAlive = [bool](Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) } catch {}
if ($feAlive) {
    Write-Ok 'Frontend already running - reusing it'
} else {
    Start-Process -FilePath 'cmd.exe' -ArgumentList '/k', "cd /d `"$root`" && npm run dev" -WindowStyle Normal | Out-Null
    $deadline = (Get-Date).AddSeconds(60)
    do {
        Start-Sleep -Seconds 3
        try { $feAlive = [bool](Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) } catch {}
    } while (-not $feAlive -and (Get-Date) -lt $deadline)
    if (-not $feAlive) {
        Write-Bad 'Frontend did not start. Check the "DocFlow Frontend" window for errors.'
        exit 1
    }
    Write-Ok 'Frontend is listening'
}

# --- 5. Health check + browser ---------------------------------------------
Write-Step 'Waiting for API health check...'
$healthy = $false
$deadline = (Get-Date).AddSeconds(60)
do {
    try {
        $resp = Invoke-RestMethod -Uri 'http://127.0.0.1:8090/v1/health' -TimeoutSec 5 -ErrorAction Stop
        $healthy = ($resp.status -eq 'ok')
    } catch { $healthy = $false }
    if (-not $healthy) { Start-Sleep -Seconds 3 }
} while (-not $healthy -and (Get-Date) -lt $deadline)

if ($healthy) {
    Write-Ok ("API healthy - db: {0}, redis: {1}, worker: {2}" -f $resp.checks.database, $resp.checks.redis, $resp.checks.worker)
} else {
    Write-Bad 'API started but health check is failing - see the "DocFlow Backend" window.'
}

Write-Step 'Opening http://localhost:3000 in your browser...'
Start-Process 'http://localhost:3000'

Write-Host ''
Write-Host 'DocFlow is running:' -ForegroundColor Green
Write-Host '    App      http://localhost:3000'
Write-Host '    API      http://localhost:8090   (health: /v1/health)'
Write-Host '    Postgres 127.0.0.1:5435   Redis 127.0.0.1:6379'
Write-Host ''
Write-Host 'To stop: close the Backend/Frontend windows, then run stop.cmd'
