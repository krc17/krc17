<#
.SYNOPSIS
    One-time setup for the Engineering Team Dashboard on Windows.

.DESCRIPTION
    Creates a private Python virtual environment, installs the dependencies,
    seeds dashboard.env from the example, and (unless -NoAutoStart) registers a
    scheduled task that starts the wall when the display user signs in.

    IMPORTANT for an unattended wall: the display is a full-screen browser, and
    a browser needs a signed-in desktop session. The logon task alone therefore
    only relights the wall once someone signs in. For the wall to come back on
    its own after a Windows Update reboot or a power cut, the display PC must be
    set to sign in automatically. Pass -EnableAutoLogon to configure that, or
    follow the printed instructions to do it by hand. Nothing is installed
    machine-wide; only -EnableAutoLogon needs admin rights.

.PARAMETER NoAutoStart
    Skip the logon scheduled task. Use this if you would rather start the
    dashboard by hand from "Start Dashboard.bat".

.PARAMETER WallUser
    The account the TV signs in as. Defaults to the current user. The logon
    task and (if used) auto sign-in are configured for this account.

.PARAMETER EnableAutoLogon
    Configure Windows to sign WallUser in automatically at boot, so the wall
    returns on its own after a reboot. Requires admin rights and prompts for
    the account password. NOTE: this stores the password in the registry; on a
    shared or sensitive machine prefer Sysinternals Autologon, which encrypts
    it. The script prints both options.

.PARAMETER Force
    Rebuild the virtual environment from scratch.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\windows\Install-Dashboard.ps1

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\windows\Install-Dashboard.ps1 -EnableAutoLogon
#>

[CmdletBinding()]
param(
    [switch]$NoAutoStart,
    [string]$WallUser = $env:USERNAME,
    [switch]$EnableAutoLogon,
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

# Seed the example content on a first install so the wall looks alive, but only
# into folders that are empty. Anything the team has already put here -- the
# project board, posted documents -- is never touched, so re-running Install or
# unzipping a new build cannot overwrite their work.
$samples = Join-Path $AppRoot 'samples'
if (Test-Path $samples) {
    foreach ($folder in 'projects', 'team-updates', 'meeting-takeaways') {
        $src = Join-Path $samples $folder
        $dst = Join-Path $AppRoot "data\$folder"
        if (-not (Test-Path $src)) { continue }
        $existing = @(Get-ChildItem $dst -File -ErrorAction SilentlyContinue)
        if ($existing.Count -eq 0) {
            Copy-Item (Join-Path $src '*') $dst -ErrorAction SilentlyContinue
            Write-Note "Seeded example content into data\$folder"
        }
    }
}

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
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $WallUser
    # 40s delay: let the network and any mapped shares come up before we poll them.
    $trigger.Delay = 'PT40S'
    $taskSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
    $taskSettings.ExecutionTimeLimit = 'PT0S'   # a wall display runs indefinitely

    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
        -Settings $taskSettings -Description 'Engineering team wall dashboard' -Force | Out-Null
    Write-Ok "Scheduled task '$TaskName' registered for $WallUser (runs at sign-in)"
}

# --------------------------------------------------------------------------- #
# 4b. Auto sign-in - the piece that makes a reboot relight the wall by itself
# --------------------------------------------------------------------------- #
# The logon task needs a desktop session to open the browser. Without auto
# sign-in the TV sits at the lock screen after a reboot until a human logs in.
$WinlogonKey = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'

function Test-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-AutoLogonState {
    try {
        return (Get-ItemProperty -Path $WinlogonKey -Name 'AutoAdminLogon' -ErrorAction Stop).AutoAdminLogon
    } catch { return $null }
}

if ($NoAutoStart) {
    # No logon task means auto sign-in is moot; say nothing.
} elseif ($EnableAutoLogon) {
    Write-Step 'Configuring automatic sign-in'
    if (-not (Test-Administrator)) {
        Write-Host @"

  -EnableAutoLogon needs an elevated shell (it writes a machine-wide setting).
  Re-run this from an Administrator PowerShell, or set auto sign-in by hand:
  run  netplwiz , untick "Users must enter a user name and password", Apply.

"@ -ForegroundColor Yellow
    } else {
        $secure = Read-Host "Password for $WallUser (stored so the wall can sign in after a reboot)" -AsSecureString
        $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
        try {
            $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
        } finally {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
        }
        Set-ItemProperty -Path $WinlogonKey -Name 'AutoAdminLogon' -Value '1'
        Set-ItemProperty -Path $WinlogonKey -Name 'DefaultUserName' -Value $WallUser
        Set-ItemProperty -Path $WinlogonKey -Name 'DefaultDomainName' -Value $env:USERDOMAIN
        Set-ItemProperty -Path $WinlogonKey -Name 'DefaultPassword' -Value $plain
        $plain = $null
        Write-Ok "Auto sign-in enabled for $env:USERDOMAIN\$WallUser"
        Write-Note 'The password is stored in the registry. To store it encrypted'
        Write-Note 'instead, clear it and use Sysinternals Autologon (see below).'
    }
} else {
    if ((Get-AutoLogonState) -ne '1') {
        Write-Host @"

  REBOOT SURVIVAL - one manual step left
  --------------------------------------
  After a reboot (Windows Update installs them overnight) the TV shows a lock
  screen until someone signs in. For the wall to return on its own, set the
  display PC to sign in automatically. Pick one:

    - Easiest:  run  netplwiz , untick "Users must enter a user name and
      password", click Apply, enter the account password once.
    - Safer (password encrypted): Sysinternals Autologon -
      https://learn.microsoft.com/sysinternals/downloads/autologon
    - One command here:  re-run this script from an Administrator PowerShell
      with  -EnableAutoLogon

  Also set the power plan to never sleep the display (Start Dashboard already
  requests this, but confirm it under Settings > Power).

"@ -ForegroundColor Yellow
    } else {
        Write-Ok 'Automatic sign-in is already enabled - the wall will return after a reboot'
    }
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
