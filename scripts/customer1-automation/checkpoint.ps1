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

function Invoke-C1FaultPoint {
    <#
        Deliberate crash seam for the regression suite, so the interruption tests
        exercise REAL half-written on-disk state rather than a state a test
        fabricated and hoped was accurate.

        Fail-closed by construction: the only thing it can ever do is throw. It
        cannot skip a check, bypass a gate, or commit anything, so an environment
        variable set by accident stops the run rather than weakening it.
    #>
    param([Parameter(Mandatory)][string]$Name)
    if ($env:C1_FAULT_INJECT -and $env:C1_FAULT_INJECT -eq $Name) {
        throw "C1_FAULT_INJECT: deliberate crash at fault point '$Name'."
    }
}

function Save-C1ItemReceipt {
    <#
        Persist one bounded item, atomically, the moment it finishes. This is
        called after EVERY item -- never batched to the end of a sweep.

        A receipt with a null result is unusable: completed-history, the pass
        board and exhaustion all read it. New-C1ItemReceipt starts result null,
        so a recovery path that forgot to set one would otherwise persist a
        receipt nobody can interpret. RECOVERED is the honest floor -- the work
        exists on the branch, and we decline to guess that it was DONE.
    #>
    param(
        [Parameter(Mandatory)]$Context,
        [Parameter(Mandatory)]$Receipt
    )
    if (-not $Receipt.result) {
        Write-Step "Item $($Receipt.itemId) had no result; recording RECOVERED rather than persisting a null." 'WARN'
        $Receipt.result = 'RECOVERED'
    }
    if (-not (Test-Path $Context.ItemsDir)) {
        New-Item -ItemType Directory -Force -Path $Context.ItemsDir | Out-Null
    }
    Write-JsonFile (Join-Path $Context.ItemsDir "$($Receipt.itemId).json") $Receipt
    $Receipt
}

function New-C1ClaimSnapshot {
    <#
        The immutable worker evidence a crash recovery needs, captured at commit
        time and stored inside the write-ahead transaction.

        Claude's stdout is not a recovery source: the process is gone, the log is
        prose, and re-reading it would be guessing. Everything required to
        reconstruct the final checkpoint deterministically is copied here.
    #>
    param($Claim, [string]$ClaimedResult, [string[]]$ExpectedPaths = @(), $ProofResults = @())

    $blockerClaims = @()
    if ($Claim -and $Claim.PSObject.Properties['blockers']) {
        foreach ($b in @($Claim.blockers)) {
            if (-not $b) { continue }
            $blockerClaims += [pscustomobject]@{
                category                  = if ($b.PSObject.Properties['category']) { $b.category } else { 'GOVERNANCE' }
                question                  = if ($b.PSObject.Properties['question']) { $b.question } else { '(unstated)' }
                whyAutomationCannotDecide = if ($b.PSObject.Properties['whyAutomationCannotDecide']) { $b.whyAutomationCannotDecide } else { '' }
                blockingScope             = if ($b.PSObject.Properties['blockingScope']) { $b.blockingScope } else { '' }
                remainingExecutableWork   = if ($b.PSObject.Properties['remainingExecutableWork']) { $b.remainingExecutableWork } else { '' }
            }
        }
    }

    [pscustomobject]@{
        claimedResult     = $ClaimedResult
        workItem          = if ($Claim -and $Claim.PSObject.Properties['workItem']) { $Claim.workItem } else { $null }
        purpose           = if ($Claim -and $Claim.PSObject.Properties['purpose']) { $Claim.purpose } else { $null }
        summary           = if ($Claim -and $Claim.PSObject.Properties['summary']) { $Claim.summary } else { $null }
        nextSuggestedItem = if ($Claim -and $Claim.PSObject.Properties['nextSuggestedItem']) { $Claim.nextSuggestedItem } else { $null }
        expectedPaths     = @($ExpectedPaths)
        proofResults      = @($ProofResults)
        blockerClaims     = @($blockerClaims)
    }
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
    # Anything with a COMMIT counts, whatever the result said.
    #
    # Work reconstructed by the legacy bootstrap, recovered after a crash, or
    # committed by an item that then hit an Owner blocker all exist on the branch
    # just as surely as work this harness watched being made. Telling a worker
    # otherwise is telling it to build the thing again.
    # An upstream integration carries a commit but is not work anyone did in this
    # lane. Listing it as "already completed" would be noise in the worker's
    # prompt at best and misleading at worst.
    $done = @(Get-C1ItemReceipts -Context $Context -LaneId $LaneId |
        Where-Object { $_.workItem -and $_.recovered -ne 'MAIN_INTEGRATION' -and
                       ($_.commitSha -or $_.result -in @('DONE', 'PARTIAL', 'RECOVERED')) })

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
    <#
        FAILS CLOSED. An unreadable pending transaction is crash evidence that
        cannot be read -- which is NOT the same thing as no crash evidence.
        Swallowing the parse error turned "I do not know what happened" into "no
        transaction was in flight", and the supervisor would then select new work
        on a lane whose true state was unknown.

        The file is preserved untouched and the run stops.
    #>
    param([Parameter(Mandatory)]$Context)
    if (-not (Test-Path $Context.PendingFile)) { return $null }
    try { Get-Content -LiteralPath $Context.PendingFile -Raw -Encoding UTF8 | ConvertFrom-Json }
    catch {
        throw ("STOP: pending-transaction.json exists but cannot be parsed: $($Context.PendingFile) -- " +
               "$($_.Exception.Message). This is unreadable crash evidence, not an absent transaction. " +
               'The file has been left exactly as found. No new work will be selected until it is resolved.')
    }
}

function Clear-C1PendingTransaction {
    <#
        Only ever called after a transaction is genuinely settled: a successful
        deterministic recovery, or a normal checkpoint finalization. Ambiguous
        recovery archives instead -- see Save-C1FailedRecoveryEvidence.
    #>
    param([Parameter(Mandatory)]$Context)
    Remove-JsonFile $Context.PendingFile
}

function Save-C1FailedRecoveryEvidence {
    <#
        Atomically move an unsettled pending transaction out of the live slot and
        into the recovery archive, so the run can continue on other lanes without
        destroying the record of what could not be established.

        Returns the archived path, which belongs in the blocker.
    #>
    param(
        [Parameter(Mandatory)]$Context,
        [string]$ItemId = 'unknown'
    )
    if (-not (Test-Path $Context.PendingFile)) { return $null }

    if (-not (Test-Path $Context.RecoveryDir)) {
        New-Item -ItemType Directory -Force -Path $Context.RecoveryDir | Out-Null
    }
    $safeId = ($ItemId -replace '[^A-Za-z0-9._-]', '-')
    $dest = Join-Path $Context.RecoveryDir ("pending-failed-{0}-{1}.json" -f (Get-Date).ToString('yyyyMMdd-HHmmss'), $safeId)
    Move-Item -LiteralPath $Context.PendingFile -Destination $dest -Force
    Write-Step "Preserved unsettled pending transaction at $dest" 'WARN'
    $dest
}

function Get-C1BlockerFingerprint {
    <#
        Stable identity for a blocker, independent of run and pass number.

        Blocker ids embed the run and pass, so the same Owner question came back
        as a brand-new blocker on every sweep and was announced again each time.
        The operator learns to ignore the console, which defeats having one.
    #>
    param(
        [Parameter(Mandatory)][string]$Lane,
        [string]$Category,
        [string]$Question,
        [string]$BlockingScope
    )
    function Norm { param([string]$s) (($s -replace '\s+', ' ').Trim().ToLowerInvariant()) }
    "$($Lane.ToUpperInvariant())|$(Norm $Category)|$(Norm $Question)|$(Norm $BlockingScope)"
}

function New-C1LaneBlocker {
    <#
        One shape for every harness-raised blocker, so dedupe has something
        consistent to fingerprint.
    #>
    param(
        [Parameter(Mandatory)]$Lane,
        [Parameter(Mandatory)][string]$RunId,
        [int]$PassId = 0,
        [string]$Suffix = 'x',
        [string]$WorkItem = '(harness)',
        [Parameter(Mandatory)][string]$Category,
        [Parameter(Mandatory)][string]$Question,
        [string]$Why,
        [string]$Scope,
        [string]$Remaining
    )
    [pscustomobject]@{
        id = "BLK-$RunId-p$PassId-$($Lane.id)-$Suffix"
        lane = $Lane.id
        workItem = $WorkItem
        category = $Category
        question = $Question
        whyAutomationCannotDecide = $Why
        blockingScope = $Scope
        remainingExecutableWork = $Remaining
        createdAt = Get-UtcStamp
        status = 'OPEN'
    }
}

function Add-C1Blocker {
    <#
        Append a blocker, or fold it into the identical OPEN one that already
        exists. Returns { blocker, isNew }; only a new blocker is announced.
    #>
    param(
        [Parameter(Mandatory)]$BlockersDoc,
        [Parameter(Mandatory)]$Blocker
    )
    $fp = Get-C1BlockerFingerprint -Lane $Blocker.lane -Category $Blocker.category `
        -Question $Blocker.question -BlockingScope $Blocker.blockingScope

    if (-not $Blocker.PSObject.Properties['fingerprint']) {
        $Blocker | Add-Member -NotePropertyName fingerprint -NotePropertyValue $fp
    } else { $Blocker.fingerprint = $fp }

    $existing = @($BlockersDoc.blockers | Where-Object {
        $_.status -eq 'OPEN' -and
        $_.PSObject.Properties['fingerprint'] -and $_.fingerprint -eq $fp
    })

    if ($existing.Count -gt 0) {
        $hit = $existing[0]
        if ($hit.PSObject.Properties['lastSeenAt']) { $hit.lastSeenAt = Get-UtcStamp }
        else { $hit | Add-Member -NotePropertyName lastSeenAt -NotePropertyValue (Get-UtcStamp) }
        if ($hit.PSObject.Properties['seenCount']) { $hit.seenCount = [int]$hit.seenCount + 1 }
        else { $hit | Add-Member -NotePropertyName seenCount -NotePropertyValue 2 }
        Write-Step "Blocker already open as $($hit.id); not duplicating." 'WARN'
        return [pscustomobject]@{ blocker = $hit; isNew = $false }
    }

    $BlockersDoc.blockers += $Blocker
    [pscustomobject]@{ blocker = $Blocker; isNew = $true }
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

$script:C1ReconcileMarkerPrefix = 'C1-Reconcile-Main:'

function Get-C1ReconcileMarker {
    param([Parameter(Mandatory)][string]$MainSha)
    "$script:C1ReconcileMarkerPrefix $MainSha"
}

function Test-C1IntegrationMerge {
    <#
        Is this commit an integration of upstream INTO a lane, rather than lane
        work?

        It matters because such a merge's first-parent diff contains everything
        main changed -- harness-owned paths included. Legacy bootstrap read one as
        unauthorized pre-receipt lane work and would have blocked the lane
        permanently over a merge the harness had just made itself.

        Judged STRUCTURALLY, from the repository, on three facts:

          1. it has more than one parent;
          2. a non-first parent is an ancestor of the main ref, so it integrated
             upstream rather than some unrelated branch;
          3. its combined diff (`diff-tree --cc`) is EMPTY, meaning it took every
             path cleanly from one side or the other and contributed nothing of
             its own.

        Fact 3 is what keeps real work visible. An "evil merge" carrying its own
        edits has a non-empty combined diff and is NOT excluded, and neither is a
        domain merge of a feature branch (fact 2). Work must never become
        invisible merely because it arrived through a merge.

        Structural rather than marker-based on purpose: the merges stranding lanes
        today were made before any marker existed. New reconciliations are also
        stamped with a C1-Reconcile-Main trailer, but only as legible evidence --
        nothing depends on it.
    #>
    param(
        [Parameter(Mandatory)][string]$WorktreePath,
        [Parameter(Mandatory)][string]$Sha,
        [string]$MainRef = 'origin/main'
    )
    $parents = @((Invoke-Git -Directory $WorktreePath -AllowFail `
        -Arguments @('rev-list', '--parents', '-n', '1', $Sha)).Output -split '\s+' | Where-Object { $_ })
    if ($parents.Count -lt 3) { return $false }   # sha + at least two parents

    $mergedIn = @($parents | Select-Object -Skip 2)
    $fromUpstream = $false
    foreach ($p in $mergedIn) {
        if ((Invoke-Git -Directory $WorktreePath -AllowFail `
                -Arguments @('merge-base', '--is-ancestor', $p, $MainRef)).ExitCode -eq 0) {
            $fromUpstream = $true; break
        }
    }
    if (-not $fromUpstream) { return $false }

    # A clean integration shows no combined diff at all.
    $cc = @((Invoke-Git -Directory $WorktreePath -AllowFail `
        -Arguments @('diff-tree', '--cc', '--name-only', '--no-commit-id', $Sha)).Output |
        Where-Object { $_ -and $_ -notmatch '^[0-9a-f]{40}$' })
    ($cc.Count -eq 0)
}

function Get-C1LaneAuthoredCommits {
    <#
        Commits in a range that the LANE authored, oldest first, each classified.

        Two exclusions matter:

          - `--not <MainRef>` drops upstream commits. A two-dot range spanning a
            merge otherwise sweeps in every commit main has made, and judging
            those against a lane's ownership fails by construction.
          - integration merges are FLAGGED, not silently dropped, so each caller
            decides what to do with them.
    #>
    param(
        [Parameter(Mandatory)][string]$WorktreePath,
        [Parameter(Mandatory)][string]$FromSha,
        [Parameter(Mandatory)][string]$ToSha,
        [string]$MainRef = 'origin/main'
    )
    $shas = @((Invoke-Git -Directory $WorktreePath -AllowFail `
        -Arguments @('rev-list', '--reverse', "$FromSha..$ToSha", '--not', $MainRef)).Output |
        Where-Object { $_ -match '^[0-9a-f]{40}$' })

    $out = foreach ($sha in $shas) {
        $isIntegration = Test-C1IntegrationMerge -WorktreePath $WorktreePath -Sha $sha -MainRef $MainRef
        [pscustomobject]@{
            sha           = $sha
            subject       = (Invoke-Git -Directory $WorktreePath -AllowFail -Arguments @('log', '-1', '--format=%s', $sha)).Output -join ''
            isIntegration = $isIntegration
            # An integration merge's first-parent diff is "everything main did".
            # That is never lane-authored change.
            paths         = if ($isIntegration) { @() } else { @(Get-C1CommitPaths -WorktreePath $WorktreePath -FromSha "$sha^" -ToSha $sha) }
        }
    }
    @($out)
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
