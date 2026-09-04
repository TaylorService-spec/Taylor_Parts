<#
.SYNOPSIS
    Write a dated markdown report for one orchestrator run.

.DESCRIPTION
    Called by run-program.ps1 with the in-memory run record, or standalone to
    regenerate the report for the most recent recorded run.

    Reports are transient evidence. They are written to
    docs/customer-1/automation/reports/ and are NOT committed by default;
    commit one only when it is a receipt worth keeping.
#>
[CmdletBinding()]
param(
    $Run,
    $Blockers,
    $Lanes,
    [string]$RunId,
    [string]$OutDir
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path (Split-Path -Parent $PSCommandPath) '_common.ps1')

$ctx = Get-C1Context
if (-not $Blockers) { $Blockers = Read-JsonFile $ctx.BlockersFile }
if (-not $Lanes)    { $Lanes = Read-JsonFile $ctx.LanesFile }

if (-not $Run) {
    $state = Read-JsonFile $ctx.StateFile
    $runs = @($state.runs)
    if ($runs.Count -eq 0) { throw 'No recorded runs. Nothing to report.' }
    $Run = if ($RunId) { $runs | Where-Object { $_.runId -eq $RunId } | Select-Object -First 1 }
           else { $runs[-1] }
    if (-not $Run) { throw "Run '$RunId' not found in run-state.json." }
}

if (-not $OutDir) { $OutDir = $ctx.ReportsDir }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$path = Join-Path $OutDir "$($Run.runId).md"

function Stamp {
    # ConvertFrom-Json coerces ISO strings to DateTime; put them back.
    param($Value)
    if ($Value -is [datetime]) { $Value.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ') } else { "$Value" }
}

function Bullets {
    param($Items, [string]$Empty = '_none_')
    if (-not $Items -or @($Items).Count -eq 0) { return $Empty }
    (@($Items) | ForEach-Object { "- $_" }) -join "`n"
}

$items = @($Run.items)
$done    = @($items | Where-Object { $_.result -eq 'DONE' })
$partial = @($items | Where-Object { $_.result -eq 'PARTIAL' })
$failed  = @($items | Where-Object { $_.result -eq 'FAILED_TECHNICAL' })
$changed = @($items | ForEach-Object { $_.changedPaths } | Where-Object { $_ } | Sort-Object -Unique)

$proofLines = foreach ($i in $items) {
    foreach ($p in @($i.proofs)) {
        "lane $($i.laneId): ``$($p.command)`` -> exit $($p.exitCode) ($(if ($p.passed) { 'PASS' } else { 'FAIL' }))"
    }
}

$reconciled = foreach ($i in $items) {
    if ($i.reconcile) { "lane $($i.laneId): $($i.reconcile.classification) -- $($i.reconcile.message)" }
}

$open = @($Blockers.blockers | Where-Object { $_.status -eq 'OPEN' })
function BlockersOf { param([string[]]$Cats) @($open | Where-Object { $Cats -contains $_.category } | ForEach-Object { "**$($_.id)** (lane $($_.lane)) $($_.question) -- _blocks:_ $($_.blockingScope)" }) }

$laneTable = foreach ($l in @($Lanes.lanes)) {
    "| $($l.id) | $($l.name) | $($l.state) | $(if ($l.lastResult) { $l.lastResult } else { '--' }) | $(if ($l.currentWorkItem) { $l.currentWorkItem } else { '--' }) |"
}

$nextQueue = @(Get-ExecutableLanes -Lanes $Lanes.lanes | ForEach-Object { "$($_.id) -- $($_.name) (priority $($_.priority), state $($_.state))" })

$md = @"
# Customer 1 orchestrator run -- $($Run.runId)

$(if ($Run.dryRun) { '**DRY RUN. No Claude process was invoked and no file was changed.**' } else { '' })

| | |
| --- | --- |
| Run ID | ``$($Run.runId)`` |
| Started | $(Stamp $Run.startedAt) |
| Ended | $(Stamp $Run.endedAt) |
| Branch | ``$($Run.branch)`` |
| main SHA at start | ``$($Run.mainShaStart)`` |
| main SHA at end | ``$($Run.mainShaEnd)`` |
| Claude sessions invoked | **$($Run.claudeSessions)** |
| Max items | $($Run.maxItems) |

## Lanes attempted

$(Bullets @($Run.lanesAttempted))

## Items

| Lane | Work item | Result | Changed files |
| --- | --- | --- | ---: |
$((@($items | ForEach-Object { "| $($_.laneId) | $(if ($_.workItem) { $_.workItem } else { '--' }) | $($_.result) | $(@($_.changedPaths).Count) |" })) -join "`n")

- Completed (DONE): **$($done.Count)**
- Partial: **$($partial.Count)**
- Technical failures: **$($failed.Count)**

## Changed files

$(Bullets $changed)

## Tests and proofs

$(Bullets $proofLines)

## main advances reconciled

$(Bullets $reconciled)

## PRs prepared

$(Bullets @($items | Where-Object { $_.result -eq 'DONE' } | ForEach-Object { "lane $($_.laneId): branch ``$($_.branch)`` at ``$($_.headShaAfter)`` -- not pushed, not merged" }))

## Owner questions

$(Bullets (BlockersOf @('OWNER')))

## Taylor questions

$(Bullets (BlockersOf @('TAYLOR')))

## Governance blockers

$(Bullets (BlockersOf @('GOVERNANCE','LEGAL','COLLISION')))

## Technical failures

$(Bullets @($failed | ForEach-Object { "lane $($_.laneId): $($_.violations -join '; ')" }))

## Lane state

| Lane | Name | State | Last result | Current item |
| --- | --- | --- | --- | --- |
$($laneTable -join "`n")

## Remaining executable work / recommended next queue

$(Bullets $nextQueue '_No executable lanes. That is a legitimate terminal state, not a failure._')

## Production actions

$(if (@($Run.productionActions).Count -eq 0) { '**None. No deployment, no production write, no production identity change, no destructive command.**' } else { Bullets @($Run.productionActions) })
"@

Set-Content -LiteralPath $path -Value $md -Encoding UTF8
Write-Step "Report written: $path"
$path
