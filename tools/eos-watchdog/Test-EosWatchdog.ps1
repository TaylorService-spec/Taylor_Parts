$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('eos-watchdog-' + [guid]::NewGuid().ToString('N'))
$statePath = Join-Path $testRoot 'state.json'
$alertPath = Join-Path $testRoot 'alerts'
$watchdog = Join-Path $PSScriptRoot 'EosWatchdog.ps1'

function Invoke-WatchdogJson {
    param([hashtable]$WatchdogArguments)
    $WatchdogArguments.StatePath = $statePath
    $WatchdogArguments.AlertDirectory = $alertPath
    $output = & $watchdog @WatchdogArguments
    return ($output | Out-String | ConvertFrom-Json)
}

function Assert-Equal {
    param($Actual, $Expected, [string]$Label)
    if ($Actual -ne $Expected) {
        throw "$Label expected '$Expected' but got '$Actual'."
    }
}

try {
    $registered = Invoke-WatchdogJson @{ Action = 'Register'; Id = 'normal'; Title = 'Normal work' }
    Assert-Equal $registered.status 'waiting' 'Registered status'

    $updated = Invoke-WatchdogJson @{ Action = 'Update'; Id = 'normal'; Status = 'needs_input'; Message = 'Owner decision required' }
    Assert-Equal $updated.status 'needs_input' 'Updated status'
    if (-not (Test-Path -LiteralPath (Join-Path $alertPath 'normal.json'))) {
        throw 'needs_input did not create an alert.'
    }

    $expired = Invoke-WatchdogJson @{ Action = 'Register'; Id = 'expired'; Title = 'Expired work'; TimeoutMinutes = 1 }
    $check = Invoke-WatchdogJson @{ Action = 'Check'; NowUtc = [datetime]::Parse($expired.dueAtUtc).AddSeconds(1) }
    Assert-Equal $check.alertsCreated 1 'Timeout alert count'
    $expiredItem = Invoke-WatchdogJson @{ Action = 'Get'; Id = 'expired' }
    Assert-Equal $expiredItem.status 'timed_out' 'Expired status'

    $secondCheck = Invoke-WatchdogJson @{ Action = 'Check' }
    Assert-Equal $secondCheck.alertsCreated 0 'Idempotent second check'

    Write-Output 'PASS: EOS watchdog register, update, timeout, alert, and idempotence checks.'
}
finally {
    if (Test-Path -LiteralPath $testRoot) {
        Remove-Item -LiteralPath $testRoot -Recurse -Force
    }
}
