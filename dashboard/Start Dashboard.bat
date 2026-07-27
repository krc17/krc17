@echo off
REM Double-click entry point for the engineering team wall dashboard.
REM Starts the server if it isn't already running, then opens the TV display.
title Engineering Team Dashboard
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0windows\Start-Dashboard.ps1" %*
if errorlevel 1 pause
