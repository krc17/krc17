<#
.SYNOPSIS
    Removes the autostart task, the virtual environment and the shortcut.

.DESCRIPTION
    Your content in data\ and your dashboard.env are never touched — pass
    -RemoveData only if you really want the folders cleared too.
#>

[CmdletBinding()]
param([switch]$RemoveData)

$ErrorActionPreference = 'SilentlyContinue'
$AppRoot = Split-Path -Parent $PSScriptRoot
$TaskName = 'EngineeringTeamDashboard'

& (Join-Path $PSScriptRoot 'Stop-Dashboard.ps1')

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Removed the scheduled task '$TaskName'." -ForegroundColor Green
}

$shortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Team Dashboard.lnk'
if (Test-Path $shortcut) {
    Remove-Item $shortcut -Force
    Write-Host 'Removed the desktop shortcut.' -ForegroundColor Green
}

$venv = Join-Path $AppRoot '.venv'
if (Test-Path $venv) {
    Remove-Item $venv -Recurse -Force
    Write-Host 'Removed the virtual environment.' -ForegroundColor Green
}

Remove-Item (Join-Path $env:LOCALAPPDATA 'TeamDashboard') -Recurse -Force

if ($RemoveData) {
    Remove-Item (Join-Path $AppRoot 'data') -Recurse -Force
    Write-Host 'Removed data\ as requested.' -ForegroundColor Yellow
} else {
    Write-Host 'Left data\ and dashboard.env in place.' -ForegroundColor DarkGray
}
