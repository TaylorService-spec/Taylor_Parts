# One-time legacy state bootstrap for the Customer 1 orchestrator.
# Dot-source this AFTER _common.ps1 and checkpoint.ps1.
#
# WHY THIS EXISTS
#
# The item-receipt system is being introduced AFTER real lane work already
# exists. The stable lane branches carry commits made by the previous runner,
# and none of them have an items/*.json receipt.
#
# Without this, a lane with genuine history reports NOTHING_TO_RECOVER and hands
# the next worker an EMPTY completed-item list -- which is precisely the
# instruction to go and rebuild the census, matrix or validator that is already
# sitting on the branch.
#
# EVIDENCE ORDER, strongest first:
#
#   1. run-state.json historical item records (workItem, lane, headShaAfter,
#      changed paths, result) -- the previous runner's own structured records.
#   2. Actual branch ancestry and the changed paths of each commit.
#   3. Commit subjects, carried ONLY as human labels. A commit subject is never
#      proof that an item is DONE and never closes a gate.
#
# Nothing here upgrades a gate. Nothing here writes the ledger.

Set-StrictMode -Version Latest

function Get-C1LaneCommits {
    <#
        Commits on the lane branch that are not on main, oldest first, with their
        subject and changed paths. This is the repository's own account of what
        the lane did -- the only account that counts.
    #>
    param(
        [Parameter(Mandatory)][string]$WorktreePath,
        [string]$MainRef = 'origin/main'
    )
    $base = @((Invoke-Git -Directory $WorktreePath -AllowFail `
        -Arguments @('merge-base', $MainRef, 'HEAD')).Output | Where-Object { $_ -match '^[0-9a-f]{40}$' })
    if ($base.Count -eq 0) { return @() }

    $shas = @((Invoke-Git -Directory $WorktreePath -AllowFail `
        -Arguments @('rev-list', '--reverse', "$($base[0])..HEAD")).Output | Where-Object { $_ -match '^[0-9a-f]{40}$' })

    $out = foreach ($sha in $shas) {
        $subject = (Invoke-Git -Directory $WorktreePath -AllowFail `
            -Arguments @('log', '-1', '--format=%s', $sha)).Output -join ''
        $body = (Invoke-Git -Directory $WorktreePath -AllowFail `
            -Arguments @('log', '-1', '--format=%B', $sha)).Output -join "`n"
        [pscustomobject]@{
            sha     = $sha
            subject = $subject
            # A commit the new harness made already carries its item id, so a
            # partially-migrated lane is not re-bootstrapped.
            itemId  = if ($body -match '(?m)^\s*C1-Item-Id:\s*(\S+)\s*$') { $Matches[1] } else { $null }
            paths   = @(Get-C1CommitPaths -WorktreePath $WorktreePath -FromSha "$sha^" -ToSha $sha)
        }
    }
    @($out)
}

function Get-C1LegacyHistoryItems {
    <#
        Historical item records for one lane, oldest first, from the previous
        runner's run-state.json. Shapes varied across runs, so every field is
        read defensively.
    #>
    param(
        [Parameter(Mandatory)]$StateDoc,
        [Parameter(Mandatory)][string]$LaneId
    )
    $out = foreach ($run in @($StateDoc.runs)) {
        if (-not $run.PSObject.Properties['items']) { continue }
        foreach ($it in @($run.items)) {
            if (-not $it) { continue }
            if (-not $it.PSObject.Properties['laneId'] -or $it.laneId -ne $LaneId) { continue }
            [pscustomobject]@{
                runId        = if ($run.PSObject.Properties['runId']) { $run.runId } else { 'legacy' }
                workItem     = if ($it.PSObject.Properties['workItem']) { $it.workItem } else { $null }
                result       = if ($it.PSObject.Properties['result']) { $it.result } else { $null }
                headShaAfter = if ($it.PSObject.Properties['headShaAfter']) { $it.headShaAfter } else { $null }
                changedPaths = if ($it.PSObject.Properties['changedPaths']) { @($it.changedPaths) } else { @() }
                branch       = if ($it.PSObject.Properties['branch']) { $it.branch } else { $null }
            }
        }
    }
    @($out)
}

function Invoke-C1LegacyBootstrap {
    <#
        Reconstruct item receipts for work that predates the receipt system.

        Runs once per lane: a lane that already has any receipt is left alone.
        Every reconstructed receipt is validated against the lane's ownership and
        the forbidden-path set exactly as live verification would. A commit that
        would have been refused when made is not accepted now because it is old.

        If any lane commit fails that validation, the lane is NOT bootstrapped:
        the branch is preserved and the ambiguity is reported. Pretending a lane
        has no history is the one outcome this must never produce.

        Returns { status, message, recovered[], blocked }.
    #>
    param(
        [Parameter(Mandatory)]$Context,
        [Parameter(Mandatory)]$Lane,
        [Parameter(Mandatory)][string]$WorktreePath,
        [Parameter(Mandatory)][string]$Branch,
        [Parameter(Mandatory)]$StateDoc,
        [string[]]$ForbiddenPaths = @(),
        [string]$MainRef = 'origin/main'
    )

    function New-BootstrapResult {
        param($Status, $Message, $Recovered = @(), [switch]$Blocked)
        [pscustomobject]@{
            laneId    = $Lane.id
            status    = $Status
            message   = $Message
            recovered = @($Recovered)
            blocked   = [bool]$Blocked
        }
    }

    if (@(Get-C1ItemReceipts -Context $Context -LaneId $Lane.id).Count -gt 0) {
        return (New-BootstrapResult 'ALREADY_BOOTSTRAPPED' "Lane $($Lane.id) already has item receipts.")
    }
    if (-not (Test-Path $WorktreePath)) {
        return (New-BootstrapResult 'NOTHING_TO_BOOTSTRAP' 'Lane worktree does not exist yet.')
    }

    $commits = @(Get-C1LaneCommits -WorktreePath $WorktreePath -MainRef $MainRef)
    if ($commits.Count -eq 0) {
        return (New-BootstrapResult 'NOTHING_TO_BOOTSTRAP' "Lane $($Lane.id) branch carries no commits beyond main.")
    }

    # Validate the whole branch first. Bootstrapping half a lane would leave a
    # completed-item list that is worse than none: confidently incomplete.
    $allPaths = @($commits | ForEach-Object { @($_.paths) } | Where-Object { $_ } | Select-Object -Unique)
    $ruling = Test-C1PathsAcceptable -Paths $allPaths -OwnedPaths @($Lane.ownedPaths) -ForbiddenPaths $ForbiddenPaths
    if (-not $ruling.acceptable) {
        return (New-BootstrapResult 'FAILED_BOOTSTRAP' ("Lane $($Lane.id) has pre-receipt commits touching paths it may not own " +
            "(forbidden: $($ruling.forbiddenPaths -join ', '); out-of-scope: $($ruling.unownedPaths -join ', ')). " +
            'Branch preserved; nothing reconstructed. This lane has history that must be reconciled by hand.') @() -Blocked)
    }

    $history = @(Get-C1LegacyHistoryItems -StateDoc $StateDoc -LaneId $Lane.id)
    $recovered = @()
    $matched = @{}

    # --- evidence 1: historical records that name a commit actually on this branch
    foreach ($h in $history) {
        if (-not $h.headShaAfter -or $h.headShaAfter -notmatch '^[0-9a-f]{40}$') { continue }
        $hit = @($commits | Where-Object { $_.sha -eq $h.headShaAfter })
        if ($hit.Count -eq 0) { continue }
        if ($matched.ContainsKey($h.headShaAfter)) { continue }
        $matched[$h.headShaAfter] = $true

        $r = New-C1ItemReceipt -RunId $h.runId -PassId 0 -Attempt 0 -Lane $Lane -Branch $Branch `
            -ItemId "legacy-$($Lane.id)-$($h.headShaAfter.Substring(0,8))"
        $r.workItem = if ($h.workItem) { $h.workItem } else { "(legacy) $($hit[0].subject)" }
        $r.purpose = 'Reconstructed from the previous runner''s run-state record and verified against the branch.'
        $r.headShaAfter = $h.headShaAfter
        $r.commitSha = $h.headShaAfter
        $r.changedPaths = @($hit[0].paths)
        $r.ownedPathCheck = 'PASS'
        $r.forbiddenPathCheck = 'PASS'
        # NOT the historical DONE. A reconstructed receipt records that the work
        # exists on the branch, never that a gate closed.
        $r.result = 'RECOVERED'
        $r.recovered = 'LEGACY_PRE_RECEIPT'
        $r.completedAt = Get-UtcStamp
        Save-C1ItemReceipt -Context $Context -Receipt $r | Out-Null
        $recovered += $r
    }

    # --- evidence 2+3: remaining branch commits, subject carried as a LABEL only
    foreach ($c in $commits) {
        if ($matched.ContainsKey($c.sha)) { continue }
        if ($c.itemId) { continue }   # already a receipt-era commit

        $r = New-C1ItemReceipt -RunId 'legacy' -PassId 0 -Attempt 0 -Lane $Lane -Branch $Branch `
            -ItemId "legacy-$($Lane.id)-$($c.sha.Substring(0,8))"
        $r.workItem = "(legacy) $($c.subject)"
        $r.purpose = 'Reconstructed from branch history. The commit subject is a label, not evidence of completion.'
        $r.headShaAfter = $c.sha
        $r.commitSha = $c.sha
        $r.changedPaths = @($c.paths)
        $r.ownedPathCheck = 'PASS'
        $r.forbiddenPathCheck = 'PASS'
        $r.result = 'RECOVERED'
        $r.recovered = 'LEGACY_PRE_RECEIPT'
        $r.completedAt = Get-UtcStamp
        Save-C1ItemReceipt -Context $Context -Receipt $r | Out-Null
        $recovered += $r
    }

    if ($recovered.Count -eq 0) {
        return (New-BootstrapResult 'NOTHING_TO_BOOTSTRAP' "Lane $($Lane.id) has no pre-receipt work to reconstruct.")
    }

    New-BootstrapResult 'BOOTSTRAPPED' ("Lane $($Lane.id): reconstructed $($recovered.Count) pre-receipt item(s) from branch history. " +
        'No gate status was changed.') $recovered
}
