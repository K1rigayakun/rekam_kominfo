Set-StrictMode -Version Latest
$ErrorActionPreference = "Continue"

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
  npm run dev -- --host 0.0.0.0 --port 5173
} -ArgumentList $web

$mediaWeb = Join-Path $root "apps/media-web"
Write-Host "[REKAM] Starting media-web on http://0.0.0.0:5174"
$mediaWebJob = Start-Job -Name "rekam-media-web" -ScriptBlock {
  param($path)
  Set-Location $path
  npm run dev -- --host 0.0.0.0 --port 5174
} -ArgumentList $mediaWeb

Write-Host "[REKAM] Starting media worker (BullMQ)"
$mediaJob = Start-Job -Name "rekam-media-worker" -ScriptBlock {
  param($path)
  Set-Location $path
  npm run queue:media
} -ArgumentList $backend

Write-Host "[REKAM] Starting export worker (BullMQ)"
$exportJob = Start-Job -Name "rekam-export-worker" -ScriptBlock {
  param($path)
  Set-Location $path
  npm run queue:export
} -ArgumentList $backend

Write-Host "[REKAM] Starting integrity worker (BullMQ)"
$integrityJob = Start-Job -Name "rekam-integrity-worker" -ScriptBlock {
  param($path)
  Set-Location $path
  npm run queue:integrity
} -ArgumentList $backend

Write-Host "[REKAM] Press Ctrl+C to stop all dev processes."
Write-Host "[REKAM] Use the Network URL from Vite to open the web app from another device on the same LAN."

try {
  while ($true) {
    Receive-Job -Job $backendJob,$webJob,$mediaWebJob,$mediaJob,$exportJob,$integrityJob
    if ($backendJob.State -in @("Failed", "Stopped", "Completed") -or $webJob.State -in @("Failed", "Stopped", "Completed") -or $mediaWebJob.State -in @("Failed", "Stopped", "Completed")) {
      break
    }
    Start-Sleep -Seconds 2
  }
}
finally {
  Stop-Job -Job $backendJob,$webJob,$mediaWebJob,$mediaJob,$exportJob,$integrityJob -ErrorAction SilentlyContinue
  Remove-Job -Job $backendJob,$webJob,$mediaWebJob,$mediaJob,$exportJob,$integrityJob -Force -ErrorAction SilentlyContinue
}
