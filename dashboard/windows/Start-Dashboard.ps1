<#
.SYNOPSIS
    Starts the dashboard server and opens it full-screen on the TV.

.DESCRIPTION
    Reads dashboard.env, launches the backend hidden in the background, waits
    for it to answer its health check, then opens a dedicated Edge (or Chrome)
    window in kiosk mode. The browser runs on its own profile so kiosk mode is
    never ignored because a normal Edge window happens to be open, and so the
    team's browsing history stays out of the wall display.

.PARAMETER NoBrowser
    Start the server only. Useful when the TV is driven by another machine.

.PARAMETER Windowed
    Open a normal resizable window instead of kiosk mode - handy while you are
    still setting things up.
#>

[CmdletBinding()]
param(
    [switch]$NoBrowser,
    [switch]$Windowed
)

$ErrorActionPreference = 'Stop'
$AppRoot = Split-Path -Parent $PSScriptRoot
$VenvPython = Join-Path $AppRoot '.venv\Scripts\pythonw.exe'
# uvicorn writes its normal output to stderr, so that stream is the real log.
$LogFile = Join-Path $AppRoot 'dashboard.log'
$StdOutFile = Join-Path $AppRoot 'dashboard.stdout.log'
$PidFile = Join-Path $AppRoot '.dashboard.pid'
$BrowserProfile = Join-Path $env:LOCALAPPDATA 'TeamDashboard\browser-profile'

if (-not (Test-Path $VenvPython)) {
    Write-Host "Not set up yet. Run windows\Install-Dashboard.ps1 first." -ForegroundColor Yellow
    if ($Host.Name -eq 'ConsoleHost') { Read-Host 'Press Enter to close' }
    exit 1
}

# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #
function Import-EnvFile {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return }
    foreach ($line in Get-Content $Path) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
        $split = $trimmed.IndexOf('=')
        if ($split -lt 1) { continue }
        $name = $trimmed.Substring(0, $split).Trim()
        $value = $trimmed.Substring($split + 1).Trim().Trim('"')
        [Environment]::SetEnvironmentVariable($name, $value, 'Process')
    }
}

Import-EnvFile (Join-Path $AppRoot 'dashboard.env')

$listenHost = if ($env:DASHBOARD_HOST) { $env:DASHBOARD_HOST } else { '127.0.0.1' }
$port = if ($env:DASHBOARD_PORT) { [int]$env:DASHBOARD_PORT } else { 8770 }

# Use the literal IPv4 loopback, never the name "localhost". Windows resolves
# localhost to ::1 first, and uvicorn bound to 127.0.0.1 is not listening on
# IPv6 -- the request then burns its whole timeout before falling back, so the
# health check never succeeds and the browser never opens.
$url = "http://127.0.0.1:$port/"

# --------------------------------------------------------------------------- #
# Server
# --------------------------------------------------------------------------- #
function Test-DashboardUp {
    try {
        # ${url} braces are required: "$url`a..." would emit a BEL character.
        $response = Invoke-WebRequest -Uri "${url}api/health" -TimeoutSec 5 -UseBasicParsing
        return $response.StatusCode -eq 200
    } catch { return $false }
}

if (Test-DashboardUp) {
    Write-Host "Dashboard already running on port $port." -ForegroundColor DarkGray
} else {
    Write-Host "Starting the dashboard server on $listenHost`:$port ..." -ForegroundColor Cyan

    # pythonw + a redirected log keeps a console window off the TV.
    $arguments = @(
        '-m', 'uvicorn', 'backend.app:app',
        '--host', $listenHost,
        '--port', $port,
        '--log-level', 'info',
        '--no-access-log'
    )
    $server = Start-Process -FilePath $VenvPython -ArgumentList $arguments `
        -WorkingDirectory $AppRoot -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput $StdOutFile -RedirectStandardError $LogFile
    $server.Id | Set-Content $PidFile

    $deadline = (Get-Date).AddSeconds(45)
    while ((Get-Date) -lt $deadline) {
        if ($server.HasExited) {
            Write-Host "`nThe server exited immediately. Last lines of ${LogFile}:" -ForegroundColor Red
            if (Test-Path $LogFile) { Get-Content $LogFile -Tail 20 }
            if ($Host.Name -eq 'ConsoleHost') { Read-Host 'Press Enter to close' }
            exit 1
        }
        if (Test-DashboardUp) { break }
        Start-Sleep -Milliseconds 500
    }

    if (-not (Test-DashboardUp)) {
        # The health check is a convenience, not a gate. If the process is alive
        # we still open the display -- a slow first start must not cost the wall
        # its browser, which is exactly what an early exit here used to do.
        if ($server.HasExited) {
            Write-Host "The server exited. Check $LogFile" -ForegroundColor Red
            if ($Host.Name -eq 'ConsoleHost') { Read-Host 'Press Enter to close' }
            exit 1
        }
        Write-Host "Health check did not answer, but the server process is alive." -ForegroundColor Yellow
        Write-Host "Opening the display anyway - if it is blank, check $LogFile" -ForegroundColor Yellow
    } else {
        Write-Host "Server is up (PID $($server.Id))." -ForegroundColor Green
    }
}

if ($NoBrowser) {
    Write-Host "Open $url on the display machine." -ForegroundColor Cyan
    exit 0
}

# --------------------------------------------------------------------------- #
# Kiosk browser
# --------------------------------------------------------------------------- #
function Resolve-Browser {
    # ${env:ProgramFiles(x86)} needs the braces - the parentheses are not part of
    # a bare $env: variable name, so "$env:ProgramFiles(x86)" resolves wrongly.
    $programFiles = $env:ProgramFiles
    $programFilesX86 = ${env:ProgramFiles(x86)}

    $paths = @(
        "$programFilesX86\Microsoft\Edge\Application\msedge.exe",
        "$programFiles\Microsoft\Edge\Application\msedge.exe",
        "$programFiles\Google\Chrome\Application\chrome.exe",
        "$programFilesX86\Google\Chrome\Application\chrome.exe"
    )
    foreach ($path in $paths) {
        if ($path -notmatch '^\\' -and (Test-Path $path)) { return $path }
    }
    return $null
}

$browser = Resolve-Browser
if (-not $browser) {
    Write-Host 'No Edge or Chrome found - opening in the default browser instead.' -ForegroundColor Yellow
    Start-Process $url
    exit 0
}

New-Item -ItemType Directory -Path $BrowserProfile -Force | Out-Null

$browserArgs = @(
    "--user-data-dir=`"$BrowserProfile`""   # own profile: kiosk flags always apply
    '--no-first-run'
    '--no-default-browser-check'
    '--disable-session-crashed-bubble'      # no "restore pages?" bar after a power cut
    '--disable-infobars'
    '--hide-crash-restore-bubble'
    '--noerrdialogs'
    '--disable-pinch'                       # stop two-finger zoom on the wall
    '--overscroll-history-navigation=0'     # stop swipe-to-go-back
    '--disable-features=TranslateUI,ChromeWhatsNewUI'
    '--autoplay-policy=no-user-gesture-required'
)

if ($Windowed) {
    $browserArgs += "--app=$url"
} else {
    $browserArgs += @('--kiosk', $url, '--edge-kiosk-type=fullscreen', '--kiosk-idle-timeout-minutes=0')
}

Write-Host 'Opening the wall display...' -ForegroundColor Cyan
Start-Process -FilePath $browser -ArgumentList $browserArgs

# Keep the screen awake while the dashboard is on the wall.
try {
    powercfg /change monitor-timeout-ac 0 2>&1 | Out-Null
    powercfg /change standby-timeout-ac 0 2>&1 | Out-Null
} catch {
    Write-Host 'Could not change the power timeouts - set "never sleep" manually.' -ForegroundColor DarkGray
}

Write-Host @"

  Dashboard is live at $url

  Press Ctrl+W (or Alt+F4) on the TV to close kiosk mode.
  The server keeps running - stop it with windows\Stop-Dashboard.ps1

"@ -ForegroundColor Green
