@echo off
REM Run this once to set up the dashboard on a Windows PC.
title Engineering Team Dashboard - Setup
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0windows\Install-Dashboard.ps1" %*
pause
