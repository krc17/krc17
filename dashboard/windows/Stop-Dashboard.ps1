<#
.SYNOPSIS
    Stops the dashboard server and closes the kiosk browser window.
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'SilentlyContinue'
$AppRoot = Split-Path -Parent $PSScriptRoot
$PidFile = Join-Path $AppRoot '.dashboard.pid'
$BrowserProfile = Join-Path $env:LOCALAPPDATA 'TeamDashboard\browser-profile'

if (Test-Path $PidFile) {
    $serverPid = (Get-Content $PidFile | Select-Object -First 1) -as [int]
    if ($serverPid) {
        $process = Get-Process -Id $serverPid -ErrorAction SilentlyContinue
        if ($process) {
            Stop-Process -Id $serverPid -Force
            Write-Host "Stopped the dashboard server (PID $serverPid)." -ForegroundColor Green
        }
    }
    Remove-Item $PidFile -Force
} else {
    Write-Host 'No PID file - the server may not have been started from this script.' -ForegroundColor DarkGray
}

# Close only the kiosk window, identified by its dedicated profile directory.
Get-CimInstance Win32_Process -Filter "Name='msedge.exe' OR Name='chrome.exe'" |
    Where-Object { $_.CommandLine -like "*$BrowserProfile*" } |
    ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force
        Write-Host "Closed the kiosk browser (PID $($_.ProcessId))." -ForegroundColor Green
    }
