[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [ValidateRange(1, 20)]
    [int]$IntervalMinutes = 1,
    [string]$TaskName = 'Taylor Parts EOS Work Continuity Watchdog',
    [string]$StatePath,
    [string]$NotificationScript,
    [switch]$RunWhetherLoggedOff
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$watchdogPath = Join-Path $PSScriptRoot 'EosWatchdog.ps1'
if (-not (Test-Path -LiteralPath $watchdogPath)) {
    throw "Watchdog script not found: $watchdogPath"
}

$arguments = @(
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy', 'Bypass',
    '-File', ('"{0}"' -f $watchdogPath),
    '-Action', 'Check'
)
if (-not [string]::IsNullOrWhiteSpace($StatePath)) {
    $arguments += @('-StatePath', ('"{0}"' -f $StatePath))
}
if (-not [string]::IsNullOrWhiteSpace($NotificationScript)) {
    $arguments += @('-NotificationScript', ('"{0}"' -f $NotificationScript))
}

$taskAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ($arguments -join ' ')
$taskTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes)
$taskSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew
$logonType = if ($RunWhetherLoggedOff) { 'S4U' } else { 'Interactive' }
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType $logonType -RunLevel Limited

if ($PSCmdlet.ShouldProcess($TaskName, "Register a watchdog check every $IntervalMinutes minute(s)")) {
    Register-ScheduledTask -TaskName $TaskName -Action $taskAction -Trigger $taskTrigger `
        -Settings $taskSettings -Principal $principal -Description `
        'Checks durable EOS work records and emits alerts when the 20-minute deadline expires.' -Force
}
