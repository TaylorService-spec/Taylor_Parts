[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Register', 'Update', 'Check', 'List', 'Get')]
    [string]$Action,

    [string]$Id,
    [string]$Title,
    [string]$Reference,
    [ValidateSet('waiting', 'needs_review', 'needs_input', 'completed', 'failed', 'timed_out')]
    [string]$Status,
    [string]$Message,
    [ValidateRange(1, 1440)]
    [int]$TimeoutMinutes = 20,
    [string]$StatePath,
    [string]$AlertDirectory,
    [string]$NotificationScript,
    [datetime]$NowUtc = ([datetime]::UtcNow),
    [switch]$IncludeTerminal
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$terminalStatuses = @('needs_review', 'needs_input', 'completed', 'failed', 'timed_out')
$usingDefaultStatePath = [string]::IsNullOrWhiteSpace($StatePath)

if ($usingDefaultStatePath) {
    $dataRoot = if ([string]::IsNullOrWhiteSpace($env:ProgramData)) {
        Join-Path $env:LOCALAPPDATA 'TaylorParts\EosWatchdog'
    } else {
        Join-Path $env:ProgramData 'TaylorParts\EosWatchdog'
    }
    $StatePath = Join-Path $dataRoot 'state.json'
}

if ($usingDefaultStatePath -and [string]::IsNullOrWhiteSpace($NotificationScript)) {
    $bundledNotificationScript = Join-Path $PSScriptRoot 'Notify-EosWatchdog.ps1'
    if (Test-Path -LiteralPath $bundledNotificationScript) {
        $NotificationScript = $bundledNotificationScript
    }
}

if ([string]::IsNullOrWhiteSpace($AlertDirectory)) {
    $AlertDirectory = Join-Path (Split-Path -Parent $StatePath) 'alerts'
}

function ConvertTo-UtcText {
    param([datetime]$Value)
    return $Value.ToUniversalTime().ToString('o')
}

function New-EmptyState {
    return [ordered]@{
        schemaVersion = 1
        items = @()
    }
}

function Read-State {
    if (-not (Test-Path -LiteralPath $StatePath)) {
        return New-EmptyState
    }

    $raw = Get-Content -LiteralPath $StatePath -Raw
    if ([string]::IsNullOrWhiteSpace($raw)) {
        return New-EmptyState
    }

    $state = $raw | ConvertFrom-Json
    if ($null -eq $state.items) {
        throw "Invalid watchdog state: missing items array in $StatePath"
    }
    return $state
}

function Write-State {
    param($State)

    $parent = Split-Path -Parent $StatePath
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    $temporaryPath = "$StatePath.$([guid]::NewGuid().ToString('N')).tmp"
    $State | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $temporaryPath -Encoding UTF8
    Move-Item -LiteralPath $temporaryPath -Destination $StatePath -Force
}

function Find-Item {
    param($State, [string]$ItemId)

    $matches = @($State.items | Where-Object { $_.id -eq $ItemId })
    if ($matches.Count -eq 0) {
        throw "No watchdog item exists with id '$ItemId'."
    }
    return $matches[0]
}

function Write-Alert {
    param($Item)

    New-Item -ItemType Directory -Path $AlertDirectory -Force | Out-Null
    $alert = [ordered]@{
        id = $Item.id
        status = $Item.status
        title = $Item.title
        reference = $Item.reference
        message = $Item.message
        submittedAtUtc = $Item.submittedAtUtc
        dueAtUtc = $Item.dueAtUtc
        alertedAtUtc = ConvertTo-UtcText (Get-Date)
    }
    $alertPath = Join-Path $AlertDirectory "$($Item.id).json"
    $alert | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $alertPath -Encoding UTF8

    if (-not [string]::IsNullOrWhiteSpace($NotificationScript)) {
        if (-not (Test-Path -LiteralPath $NotificationScript)) {
            throw "Notification script not found: $NotificationScript"
        }
        & $NotificationScript -AlertPath $alertPath
    }

    return $alert
}

$mutexName = 'Global\TaylorParts-EosWatchdog-State'
$mutex = [System.Threading.Mutex]::new($false, $mutexName)
$hasLock = $false

try {
    $hasLock = $mutex.WaitOne([timespan]::FromSeconds(15))
    if (-not $hasLock) {
        throw 'Timed out waiting for the EOS watchdog state lock.'
    }

    $state = Read-State
    $now = $NowUtc.ToUniversalTime()

    switch ($Action) {
        'Register' {
            if ([string]::IsNullOrWhiteSpace($Title)) {
                throw '-Title is required for Register.'
            }
            if ([string]::IsNullOrWhiteSpace($Id)) {
                $Id = [guid]::NewGuid().ToString('N')
            }
            if (@($state.items | Where-Object { $_.id -eq $Id }).Count -gt 0) {
                throw "A watchdog item with id '$Id' already exists."
            }

            $item = [ordered]@{
                id = $Id
                title = $Title
                reference = $Reference
                status = 'waiting'
                message = $Message
                submittedAtUtc = ConvertTo-UtcText $now
                dueAtUtc = ConvertTo-UtcText $now.AddMinutes($TimeoutMinutes)
                updatedAtUtc = ConvertTo-UtcText $now
                alertedAtUtc = $null
            }
            $state.items = @($state.items) + @($item)
            Write-State $state
            [pscustomobject]$item | ConvertTo-Json -Depth 5
        }

        'Update' {
            if ([string]::IsNullOrWhiteSpace($Id) -or [string]::IsNullOrWhiteSpace($Status)) {
                throw '-Id and -Status are required for Update.'
            }
            if ($Status -eq 'timed_out') {
                throw "The 'timed_out' status is assigned by Check, not Update."
            }

            $item = Find-Item $state $Id
            if ($item.status -eq 'timed_out') {
                throw "Watchdog item '$Id' has already timed out; register a new submission instead."
            }

            $item.status = $Status
            $item.message = $Message
            $item.updatedAtUtc = ConvertTo-UtcText $now
            Write-State $state

            if (($terminalStatuses -contains $Status) -and $null -eq $item.alertedAtUtc) {
                $item.alertedAtUtc = ConvertTo-UtcText $now
                Write-Alert $item | Out-Null
                Write-State $state
            }
            $item | ConvertTo-Json -Depth 5
        }

        'Check' {
            $alerts = @()
            foreach ($item in @($state.items)) {
                if ($item.status -ne 'waiting') {
                    continue
                }
                $dueAt = [datetime]::Parse($item.dueAtUtc).ToUniversalTime()
                if ($dueAt -gt $now.ToUniversalTime()) {
                    continue
                }

                $item.status = 'timed_out'
                $item.message = 'No EOS status was recorded before the watchdog deadline.'
                $item.updatedAtUtc = ConvertTo-UtcText $now
                $item.alertedAtUtc = ConvertTo-UtcText $now
                $alerts += Write-Alert $item
            }
            Write-State $state
            [pscustomobject]@{
                checkedAtUtc = ConvertTo-UtcText $now
                alertsCreated = $alerts.Count
                alerts = $alerts
            } | ConvertTo-Json -Depth 8
        }

        'Get' {
            if ([string]::IsNullOrWhiteSpace($Id)) {
                throw '-Id is required for Get.'
            }
            Find-Item $state $Id | ConvertTo-Json -Depth 5
        }

        'List' {
            $items = @($state.items)
            if (-not $IncludeTerminal) {
                $items = @($items | Where-Object { $terminalStatuses -notcontains $_.status })
            }
            $items | ConvertTo-Json -Depth 5
        }
    }
}
finally {
    if ($hasLock) {
        $mutex.ReleaseMutex()
    }
    $mutex.Dispose()
}
