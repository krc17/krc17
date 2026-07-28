<#
.SYNOPSIS
    One-time setup for the Engineering Team Dashboard on Windows.

.DESCRIPTION
    Creates a private Python virtual environment, installs the dependencies,
    seeds dashboard.env from the example, and (unless -NoAutoStart) registers a
    scheduled task so the wall comes back up on its own after a reboot or a
    power cut. Nothing is installed machine-wide and no admin rights are needed.

.PARAMETER NoAutoStart
    Skip the logon scheduled task. Use this if you would rather start the
    dashboard by hand from "Start Dashboard.bat".

.PARAMETER Force
    Rebuild the virtual environment from scratch.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\windows\Install-Dashboard.ps1
#>

[CmdletBinding()]
param(
    [switch]$NoAutoStart,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$AppRoot = Split-Path -Parent $PSScriptRoot
$VenvDir = Join-Path $AppRoot '.venv'
$TaskName = 'EngineeringTeamDashboard'

function Write-Step { param([string]$Message) Write-Host "`n==> $Message" -ForegroundColor Cyan }
function Write-Ok   { param([string]$Message) Write-Host "    $Message" -ForegroundColor Green }
function Write-Note { param([string]$Message) Write-Host "    $Message" -ForegroundColor DarkGray }

# --------------------------------------------------------------------------- #
# 1. Find a usable Python
# --------------------------------------------------------------------------- #
Write-Step 'Looking for Python 3.11 or newer'

function Resolve-Python {
    $candidates = @()
    if (Get-Command py -ErrorAction SilentlyContinue) {
        $candidates += ,@('py', @('-3', '--version'), @('-3'))
    }
    foreach ($name in 'python', 'python3') {
        if (Get-Command $name -ErrorAction SilentlyContinue) {
            $candidates += ,@($name, @('--version'), @())
        }
    }

    foreach ($candidate in $candidates) {
        $exe, $probeArgs, $launchArgs = $candidate
        try {
            $raw = (& $exe @probeArgs 2>&1) -join ' '
        } catch { continue }

        if ($raw -match '(\d+)\.(\d+)\.(\d+)') {
            $version = [version]("{0}.{1}.{2}" -f $Matches[1], $Matches[2], $Matches[3])
            if ($version -ge [version]'3.11.0') {
                return [pscustomobject]@{ Exe = $exe; Args = $launchArgs; Version = $version }
            }
        }
    }
    return $null
}

$python = Resolve-Python
if (-not $python) {
    Write-Host @"

  No suitable Python was found.

  Install it once, then re-run this script:

    winget install --id Python.Python.3.12 --source winget

  or download it from https://www.python.org/downloads/windows/
  (tick "Add python.exe to PATH" in the installer).

"@ -ForegroundColor Yellow
    exit 1
}
Write-Ok "Python $($python.Version) via '$($python.Exe)'"

# --------------------------------------------------------------------------- #
# 2. Virtual environment + dependencies
# --------------------------------------------------------------------------- #
if ($Force -and (Test-Path $VenvDir)) {
    Write-Step 'Removing the existing virtual environment (-Force)'
    Remove-Item $VenvDir -Recurse -Force
}

$venvPython = Join-Path $VenvDir 'Scripts\python.exe'
if (-not (Test-Path $venvPython)) {
    Write-Step 'Creating the virtual environment'
    $venvArgs = @($python.Args) + @('-m', 'venv', $VenvDir)
    & $python.Exe @venvArgs
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the virtual environment.' }
    Write-Ok $VenvDir
} else {
    Write-Note "Virtual environment already present at $VenvDir"
}

Write-Step 'Installing dependencies (this takes a minute the first time)'
& $venvPython -m pip install --upgrade pip --quiet --disable-pip-version-check
& $venvPython -m pip install -r (Join-Path $AppRoot 'requirements.txt') --quiet --disable-pip-version-check
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
Write-Ok 'Dependencies installed'

# --------------------------------------------------------------------------- #
# 3. Configuration + content folders
# --------------------------------------------------------------------------- #
Write-Step 'Preparing configuration'
$envFile = Join-Path $AppRoot 'dashboard.env'
if (-not (Test-Path $envFile)) {
    Copy-Item (Join-Path $AppRoot 'dashboard.env.example') $envFile
    Write-Ok "Created dashboard.env - edit it to set your timezone and calendar"
} else {
    Write-Note 'dashboard.env already exists, leaving it alone'
}

foreach ($folder in 'meeting-takeaways', 'team-updates', 'projects', 'blackboard') {
    $path = Join-Path $AppRoot "data\$folder"
    if (-not (Test-Path $path)) { New-Item -ItemType Directory -Path $path -Force | Out-Null }
}
Write-Ok 'Content folders ready'

# --------------------------------------------------------------------------- #
# 4. Autostart at logon
# --------------------------------------------------------------------------- #
if ($NoAutoStart) {
    Write-Step 'Skipping autostart (-NoAutoStart)'
} else {
    Write-Step 'Registering the logon task'
    $startScript = Join-Path $PSScriptRoot 'Start-Dashboard.ps1'
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' `
        -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$startScript`""
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
    # 40s delay: let the network and any mapped shares come up before we poll them.
    $trigger.Delay = 'PT40S'
    $taskSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
    $taskSettings.ExecutionTimeLimit = 'PT0S'   # a wall display runs indefinitely

    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
        -Settings $taskSettings -Description 'Engineering team wall dashboard' -Force | Out-Null
    Write-Ok "Scheduled task '$TaskName' registered for $env:USERNAME"
}

# --------------------------------------------------------------------------- #
# 5. Desktop shortcut
# --------------------------------------------------------------------------- #
Write-Step 'Creating a desktop shortcut'
try {
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Team Dashboard.lnk'))
    $shortcut.TargetPath = Join-Path $AppRoot 'Start Dashboard.bat'
    $shortcut.WorkingDirectory = $AppRoot
    $shortcut.IconLocation = "$env:SystemRoot\System32\imageres.dll,174"
    $shortcut.Description = 'Open the engineering team wall dashboard'
    $shortcut.Save()
    Write-Ok 'Desktop shortcut created'
} catch {
    Write-Note "Could not create the shortcut: $($_.Exception.Message)"
}

Write-Host @"

  Setup complete.

  Next:
    1. Edit  dashboard.env  - set DASHBOARD_TZ and, if you want events,
       paste your calendar's ICS link into CALENDAR_ICS_URLS.
    2. Double-click "Start Dashboard.bat" (or the desktop shortcut) to
       launch it full-screen on the TV.

  Drop files into:
    data\meeting-takeaways   Word / PDF / Markdown -> Team Meeting Takeaways
    data\team-updates        one file per project or person -> Team Updates
    data\projects            projects.yaml -> the Kanban board

"@ -ForegroundColor Cyan
