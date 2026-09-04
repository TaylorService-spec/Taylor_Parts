# Durable item-level state for the Customer 1 orchestrator.
# Dot-source this; it defines functions and does nothing on its own.
#
# WHY THIS EXISTS
#
# Run-level checkpointing lost a whole sweep to a reboot. Verified commits
# existed on lane branches that the persisted state had never heard of, so the
# next run either redid the work or reported a lane as untouched.
#
# Three mechanisms fix that, and they are deliberately boring:
#
#   1. One JSON receipt per bounded work item, written the moment the item ends.
#   2. A write-ahead "pending transaction" covering the one window where a crash
#      is genuinely ambiguous: verification passed, commit may or may not exist,
#      checkpoint not yet written.
#   3. Startup recovery that reads the repository -- never a narrative -- to
#      decide what actually happened.
#
# The commit marker is the load-bearing part. Every harness commit carries a
# trailer naming the item id, so "did my commit land?" is a git question with a
# deterministic answer rather than a guess from prose.

Set-StrictMode -Version Latest

$script:C1CommitMarkerPrefix = 'C1-Item-Id:'

function Get-C1ItemMarker {
    param([Parameter(Mandatory)][string]$ItemId)
    "$script:C1CommitMarkerPrefix $ItemId"
}

function New-C1ItemId {
    param(
        [Parameter(Mandatory)][string]$RunId,
        [Parameter(Mandatory)][string]$LaneId,
        [Parameter(Mandatory)][int]$PassId,
        [Parameter(Mandatory)][int]$Attempt
    )
    "$RunId-p$PassId-$LaneId-a$Attempt"
}

# ------------------------------------------------------------------- receipts

function Save-C1ItemReceipt {
    <#
        Persist one bounded item, atomically, the moment it finishes. This is
        called after EVERY item -- never batched to the end of a sweep.
    #>
    param(
        [Parameter(Mandatory)]$Context,
        [Parameter(Mandatory)]$Receipt
    )
    if (-not (Test-Path $Context.ItemsDir)) {
        New-Item -ItemType Directory -Force -Path $Context.ItemsDir | Out-Null
    }
    Write-JsonFile (Join-Path $Context.ItemsDir "$($Receipt.itemId).json") $Receipt
    $Receipt
}

function Get-C1ItemReceipts {
    <#
        Every persisted item receipt, oldest first. Ordering is by completedAt
        then filename, so a lane's history reads chronologically.
    #>
    param(
        [Parameter(Mandatory)]$Context,
        [string]$LaneId
    )
    if (-not (Test-Path $Context.ItemsDir)) { return @() }

    # Ordered by when the receipt was WRITTEN, not by the timestamp inside it.
    # completedAt has one-second resolution, so two items finishing in the same
    # second tie and fall back to a string sort on itemId -- which put a later
    # item before an earlier one and made "the last head this lane persisted"
    # wrong. File write order is the real completion order and is monotonic.
    $files = @(Get-ChildItem -LiteralPath $Context.ItemsDir -Filter '*.json' -File -ErrorAction SilentlyContinue |
        Sort-Object -Property LastWriteTimeUtc, Name)

    $all = foreach ($f in $files) {
        try { Get-Content -LiteralPath $f.FullName -Raw -Encoding UTF8 | ConvertFrom-Json }
        catch { Write-Step "Ignoring unreadable item receipt $($f.Name): $($_.Exception.Message)" 'WARN' }
    }

    $rows = @($all | Where-Object { $_ })
    if ($LaneId) { $rows = @($rows | Where-Object { $_.laneId -eq $LaneId }) }
    @($rows)
}

function Get-C1LastVerifiedSha {
    <#
        The newest branch head this harness has actually persisted for a lane.
        Startup recovery compares the real branch against this, so a lane with no
        history yet correctly returns nothing rather than a fabricated baseline.
    #>
    param(
        [Parameter(Mandatory)]$Context,
        [Parameter(Mandatory)][string]$LaneId
    )
    $rows = @(Get-C1ItemReceipts -Context $Context -LaneId $LaneId |
        Where-Object { $_.headShaAfter -and $_.headShaAfter -match '^[0-9a-f]{40}$' })
    if ($rows.Count -eq 0) { return $null }
    $rows[-1].headShaAfter
}

function Get-C1CompletedWorkSummary {
    <#
        Compact "already built this" context for a later worker prompt.

        Deliberately NOT a transcript. The worker gets item titles and the last
        suggested next step -- enough to avoid rebuilding the same scope matrix,
        census or validator, and nothing more.
    #>
    param(
        [Parameter(Mandatory)]$Context,
        [Parameter(Mandatory)][string]$LaneId,
        [int]$Max = 25
    )
    $done = @(Get-C1ItemReceipts -Context $Context -LaneId $LaneId |
        Where-Object { $_.result -in @('DONE', 'PARTIAL') -and $_.workItem })

    $titles = @($done | ForEach-Object { $_.workItem } | Select-Object -Unique)
    if ($titles.Count -gt $Max) { $titles = @($titles | Select-Object -Last $Max) }

    $next = $null
    if ($done.Count -gt 0) {
        $last = $done[-1]
        if ($last.PSObject.Properties['nextSuggestedItem']) { $next = $last.nextSuggestedItem }
    }

    [pscustomobject]@{
        completedTitles   = @($titles)
        nextSuggestedItem = $next
    }
}

# -------------------------------------------------------- pending transaction

function Save-C1PendingTransaction {
    <#
        Write-ahead receipt. Persisted BEFORE the harness commit, so a crash
        during the commit leaves evidence of exactly what was supposed to happen.
    #>
    param(
        [Parameter(Mandatory)]$Context,
        [Parameter(Mandatory)]$Transaction
    )
    Write-JsonFile $Context.PendingFile $Transaction
    $Transaction
}

function Get-C1PendingTransaction {
    param([Parameter(Mandatory)]$Context)
    if (-not (Test-Path $Context.PendingFile)) { return $null }
    try { Get-Content -LiteralPath $Context.PendingFile -Raw -Encoding UTF8 | ConvertFrom-Json }
    catch {
        Write-Step "Pending transaction file is unreadable; treating as ambiguous recovery." 'WARN'
        $null
    }
}

function Clear-C1PendingTransaction {
    param([Parameter(Mandatory)]$Context)
    Remove-JsonFile $Context.PendingFile
}

# -------------------------------------------------------------- git forensics

function Find-C1MarkedCommit {
    <#
        Locate the commit carrying an item's marker trailer, searching only the
        range the transaction could possibly have created.

        Returns the SHA or $null. Commit prose is never trusted for this -- the
        marker is written by the harness, not by a worker.
    #>
    param(
        [Parameter(Mandatory)][string]$WorktreePath,
        [Parameter(Mandatory)][string]$SinceSha,
        [Parameter(Mandatory)][string]$ItemId
    )
    $marker = Get-C1ItemMarker -ItemId $ItemId
    # --fixed-strings means the pattern is literal, so it must NOT be regex-escaped.
    # Regex.Escape turns the space in "C1-Item-Id: <id>" into "\ ", which then
    # never matches anything as a literal.
    $r = Invoke-Git -Directory $WorktreePath -AllowFail -Arguments @(
        'log', '--format=%H', '--fixed-strings', "--grep=$marker", "$SinceSha..HEAD"
    )
    if ($r.ExitCode -ne 0) { return $null }
    $hit = @($r.Output | Where-Object { $_ -match '^[0-9a-f]{40}$' })
    if ($hit.Count -eq 0) { return $null }
    $hit[0]
}

function Get-C1CommitPaths {
    param(
        [Parameter(Mandatory)][string]$WorktreePath,
        [Parameter(Mandatory)][string]$FromSha,
        [Parameter(Mandatory)][string]$ToSha
    )
    @((Invoke-Git -Directory $WorktreePath -AllowFail `
        -Arguments @('diff', '--name-only', "$FromSha..$ToSha")).Output | Where-Object { $_ })
}

function Test-C1Ancestor {
    param(
        [Parameter(Mandatory)][string]$WorktreePath,
        [Parameter(Mandatory)][string]$Ancestor,
        [Parameter(Mandatory)][string]$Descendant
    )
    (Invoke-Git -Directory $WorktreePath -AllowFail `
        -Arguments @('merge-base', '--is-ancestor', $Ancestor, $Descendant)).ExitCode -eq 0
}

function Test-C1PathsAcceptable {
    <#
        The single ownership judgement used by both live verification and
        recovery. Recovery must apply exactly the same rule as the live path --
        a commit that would have been refused when made is not made acceptable
        by having survived a crash.
    #>
    param(
        [string[]]$Paths,
        [string[]]$OwnedPaths,
        [string[]]$ForbiddenPaths
    )
    $forbidden = Select-ForbiddenPaths -Paths @($Paths) -ForbiddenPatterns $ForbiddenPaths
    $unowned   = Select-UnownedPaths   -Paths @($Paths) -OwnedPatterns $OwnedPaths
    [pscustomobject]@{
        acceptable     = ($forbidden.Count -eq 0 -and $unowned.Count -eq 0)
        forbiddenPaths = @($forbidden)
        unownedPaths   = @($unowned)
    }
}

function Get-C1PathDrift {
    <#
        Symmetric difference between what a transaction expected to change and
        what is actually there. Any drift at all means the situation is not the
        one the transaction described, so recovery must refuse rather than
        approximate.
    #>
    param([string[]]$Actual, [string[]]$Expected)
    @(@(@($Actual) | Where-Object { @($Expected) -notcontains $_ }) +
       @(@($Expected) | Where-Object { @($Actual) -notcontains $_ }) | Select-Object -Unique)
}

function Get-C1DirtyPaths {
    <#
        Repo-relative paths of everything uncommitted, excluding the worker's own
        result receipt. Handles renames (the arrow form) and quoted paths.
    #>
    param(
        [Parameter(Mandatory)][string]$WorktreePath,
        [string]$ResultFileName = '.orchestrator-result.json'
    )
    @((Invoke-Git -Directory $WorktreePath -AllowFail -Arguments @('status', '--porcelain', '-uall')).Output |
        Where-Object { $_ } |
        ForEach-Object { ($_ -replace '^.{2,3}', '').Trim().Trim('"') } |
        ForEach-Object { if ($_ -match ' -> ') { ($_ -split ' -> ')[-1] } else { $_ } } |
        Where-Object { $_ -and $_ -ne $ResultFileName })
}

function New-C1ItemReceipt {
    <#
        The full durable shape for one bounded item. Every field the operator or
        a later recovery needs is here, and none of it is derived from a Claude
        narrative. Fields start null and fill in as the item progresses, so a
        receipt written at any point is still structurally complete.
    #>
    param(
        [Parameter(Mandatory)][string]$RunId,
        [Parameter(Mandatory)][int]$PassId,
        [Parameter(Mandatory)][int]$Attempt,
        [Parameter(Mandatory)]$Lane,
        [Parameter(Mandatory)][string]$Branch,
        [string]$ItemId
    )
    [pscustomobject]@{
        schemaVersion           = 1
        itemId                  = if ($ItemId) { $ItemId } else { New-C1ItemId -RunId $RunId -LaneId $Lane.id -PassId $PassId -Attempt $Attempt }
        runId                   = $RunId
        passId                  = $PassId
        attempt                 = $Attempt
        laneId                  = $Lane.id
        laneName                = $Lane.name
        gates                   = @($Lane.gates)
        workItem                = $null
        purpose                 = $null
        branch                  = $Branch
        mainSha                 = $null
        headShaBefore           = $null
        headShaAfter            = $null
        commitSha               = $null
        changedPaths            = @()
        proofCommands           = @()
        proofResults            = @()
        ownedPathCheck          = $null
        forbiddenPathCheck      = $null
        reconcileClassification = $null
        workerExitCode          = $null
        result                  = $null
        violations              = @()
        blockersRaised          = @()
        nextSuggestedItem       = $null
        recovered               = $null
        startedAt               = Get-UtcStamp
        completedAt             = $null
    }
}
