# =============================================================================
# DocFlow - stops what start.cmd started (backend, frontend, database containers)
# =============================================================================
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backend = Join-Path $root 'backend'
$rootPath = $root.Replace('\', '\\')

Write-Host '==> Stopping backend + frontend dev servers...' -ForegroundColor Cyan
$mine = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $cl = $_.CommandLine
    if (-not $cl) { return $false }
    if ($cl -notmatch $rootPath) { return $false }
    return ($cl -match 'tsx watch' -or $cl -match 'vite' -or $cl -match 'npm run dev')
}
foreach ($p in $mine) {
    Write-Host "    killing pid $($p.ProcessId): $($p.Name)"
    try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop } catch { Write-Host "    failed: $_" }
}

Write-Host '==> Stopping Postgres + Redis containers...' -ForegroundColor Cyan
Push-Location $backend
try { docker compose stop } finally { Pop-Location }

Write-Host ''
Write-Host 'DocFlow stopped. Run start.cmd to start it again.' -ForegroundColor Green
