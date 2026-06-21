Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $root "apps/backend"
$web = Join-Path $root "apps/web"

Write-Host "[REKAM] Starting backend on http://0.0.0.0:3000"
$backendJob = Start-Job -Name "rekam-backend" -ScriptBlock {
  param($path)
  Set-Location $path
  npm run dev
} -ArgumentList $backend

Write-Host "[REKAM] Starting web on http://0.0.0.0:5173"
$webJob = Start-Job -Name "rekam-web" -ScriptBlock {
  param($path)
  Set-Location $path
  npm run dev -- --host 0.0.0.0
} -ArgumentList $web

Write-Host "[REKAM] Press Ctrl+C to stop both dev processes."
Write-Host "[REKAM] Use the Network URL from Vite to open the web app from another device on the same LAN."

try {
  while ($true) {
    Receive-Job -Job $backendJob,$webJob
    if ($backendJob.State -in @("Failed", "Stopped", "Completed") -or $webJob.State -in @("Failed", "Stopped", "Completed")) {
      break
    }
    Start-Sleep -Seconds 2
  }
}
finally {
  Stop-Job -Job $backendJob,$webJob -ErrorAction SilentlyContinue
  Remove-Job -Job $backendJob,$webJob -Force -ErrorAction SilentlyContinue
}
