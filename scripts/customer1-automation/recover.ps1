# Startup recovery for the Customer 1 orchestrator.
# Dot-source this AFTER _common.ps1 and checkpoint.ps1.
#
# Every live execution reconciles persisted state with what is actually on each
# lane branch BEFORE selecting any new work. The four cases below are the
# failure modes a mid-sweep Windows reboot actually produced.

Set-StrictMode -Version Latest

function Invoke-C1LaneRecovery {
    <#
        A  pending exists, branch HEAD still at the pre-commit SHA
           -> the commit never happened. Re-verify the working tree under the
              same ownership rule and finish the transaction, or preserve and
              block. Never claim completion for work that is not there.

        B  pending exists and the marked commit IS on the branch
           -> the commit landed, the checkpoint did not. Inspect the commit
              independently, then finalize the missing receipt. Do NOT rerun
              Claude; the work already exists.

        C  no pending receipt, but the branch is ahead of the last persisted head
           -> recover only what the repository itself establishes. Commit prose
              and Claude narrative prove nothing.

        D  persisted head is not an ancestor of the branch
           -> abnormal. Reset nothing, stop this lane, let the other six run.

        Blocking is always per-lane. An unrecoverable lane never halts the sweep.
    #>
    param(
        [Parameter(Mandatory)]$Context,
        [Parameter(Mandatory)]$Lane,
        [Parameter(Mandatory)][string]$WorktreePath,
        [Parameter(Mandatory)][string]$Branch,
        [string[]]$ForbiddenPaths = @(),
        [string]$ResultFileName = '.orchestrator-result.json'
    )

    function New-RecoveryResult {
        param($Status, $Message, $Recovered = @(), [switch]$Blocked)
        [pscustomobject]@{
            laneId    = $Lane.id
            status    = $Status
            message   = $Message
            recovered = @($Recovered)
            blocked   = [bool]$Blocked
        }
    }

    $all = Get-C1PendingTransaction -Context $Context
    $pending = if ($all -and $all.laneId -eq $Lane.id) { $all } else { $null }

    if (-not (Test-Path $WorktreePath)) {
        if ($pending) {
            $ev = Save-C1FailedRecoveryEvidence -Context $Context -ItemId $pending.itemId
            return (New-RecoveryResult 'FAILED_RECOVERY' `
                ("Pending transaction for lane $($Lane.id) references a worktree that no longer exists: $WorktreePath. " +
                 "Evidence preserved at $ev.") @() -Blocked)
        }
        return (New-RecoveryResult 'NOTHING_TO_RECOVER' 'Lane worktree does not exist yet.')
    }

    $head = @((Invoke-Git -Directory $WorktreePath -AllowFail -Arguments @('rev-parse', 'HEAD')).Output |
        Where-Object { $_ -match '^[0-9a-f]{40}$' })
    if ($head.Count -eq 0) {
        return (New-RecoveryResult 'FAILED_RECOVERY' "Cannot read HEAD in $WorktreePath." @() -Blocked)
    }
    $head = $head[0]

    # ------------------------------------------------------------- cases A / B
    if ($pending) {
        $pre = $pending.preCommitHead
        $itemId = $pending.itemId
        $marked = Find-C1MarkedCommit -WorktreePath $WorktreePath -SinceSha $pre -ItemId $itemId

        if ($marked) {
            # CASE B. The commit exists. Judge it on its own merits, not on the
            # fact that a transaction file says it should be fine.
            $paths = @(Get-C1CommitPaths -WorktreePath $WorktreePath -FromSha "$marked^" -ToSha $marked)
            $ruling = Test-C1PathsAcceptable -Paths $paths -OwnedPaths @($Lane.ownedPaths) -ForbiddenPaths $ForbiddenPaths
            if (-not $ruling.acceptable) {
                $ev = Save-C1FailedRecoveryEvidence -Context $Context -ItemId $itemId
                return (New-RecoveryResult 'FAILED_RECOVERY' ("Recovered commit $($marked.Substring(0,8)) touches paths lane $($Lane.id) may not own " +
                    "(forbidden: $($ruling.forbiddenPaths -join ', '); out-of-scope: $($ruling.unownedPaths -join ', ')). " +
                    "Branch preserved. Evidence preserved at $ev.") @() -Blocked)
            }

            $drift = @(Get-C1PathDrift -Actual $paths -Expected @($pending.verifiedChangedPaths))
            if ($drift.Count -gt 0) {
                $ev = Save-C1FailedRecoveryEvidence -Context $Context -ItemId $itemId
                return (New-RecoveryResult 'FAILED_RECOVERY' ("Recovered commit $($marked.Substring(0,8)) does not match the pending transaction " +
                    "(differs on: $($drift -join ', ')). Branch preserved; nothing rerun. Evidence preserved at $ev.") @() -Blocked)
            }

            $receipt = $pending.itemReceipt
            $receipt.headShaAfter = $head
            $receipt.commitSha    = $marked
            $receipt.changedPaths = @($paths)
            $receipt.recovered    = 'COMMIT_WITHOUT_CHECKPOINT'
            $receipt.completedAt  = Get-UtcStamp
            Save-C1ItemReceipt -Context $Context -Receipt $receipt | Out-Null
            Clear-C1PendingTransaction -Context $Context
            return (New-RecoveryResult 'RECOVERED_COMMIT' ("Lane $($Lane.id): commit $($marked.Substring(0,8)) was already made and verifies. " +
                'Checkpoint finalized; the worker was NOT rerun.') @($receipt))
        }

        if ($head -eq $pre) {
            # CASE A. The commit never happened.
            $dirty = @(Get-C1DirtyPaths -WorktreePath $WorktreePath -ResultFileName $ResultFileName)

            if ($dirty.Count -eq 0) {
                Clear-C1PendingTransaction -Context $Context
                return (New-RecoveryResult 'RETRY_NEEDED' ("Lane $($Lane.id): interrupted before commit and the working tree is empty. " +
                    'No completion claimed; the item is available to run again.'))
            }

            $ruling = Test-C1PathsAcceptable -Paths $dirty -OwnedPaths @($Lane.ownedPaths) -ForbiddenPaths $ForbiddenPaths
            if (-not $ruling.acceptable) {
                $ev = Save-C1FailedRecoveryEvidence -Context $Context -ItemId $itemId
                return (New-RecoveryResult 'FAILED_RECOVERY' ("Lane $($Lane.id): interrupted work touches paths it may not own " +
                    "(forbidden: $($ruling.forbiddenPaths -join ', '); out-of-scope: $($ruling.unownedPaths -join ', ')). " +
                    "Nothing committed; tree preserved. Evidence preserved at $ev.") @() -Blocked)
            }

            $drift = @(Get-C1PathDrift -Actual $dirty -Expected @($pending.verifiedChangedPaths))
            if ($drift.Count -gt 0) {
                $ev = Save-C1FailedRecoveryEvidence -Context $Context -ItemId $itemId
                return (New-RecoveryResult 'FAILED_RECOVERY' ("Lane $($Lane.id): working tree no longer matches the pending transaction " +
                    "(differs on: $($drift -join ', ')). Nothing committed; tree preserved. Evidence preserved at $ev.") @() -Blocked)
            }

            # Same paths, same verdict as before the crash: finish the transaction.
            foreach ($p in $dirty) {
                Invoke-Git -Directory $WorktreePath -Arguments @('add', '--', $p) | Out-Null
            }
            New-Item -ItemType Directory -Force -Path $Context.LogsDir | Out-Null
            $msgPath = Join-Path $Context.LogsDir "recover-$itemId.commitmsg.txt"
            Set-Content -LiteralPath $msgPath -Encoding UTF8 -Value $pending.commitMessage
            Invoke-Git -Directory $WorktreePath -Arguments @('commit', '-q', '-F', $msgPath) | Out-Null

            $newHead = (Invoke-Git -Directory $WorktreePath -Arguments @('rev-parse', 'HEAD')).Output[0]
            $receipt = $pending.itemReceipt
            $receipt.headShaAfter = $newHead
            $receipt.commitSha    = $newHead
            $receipt.changedPaths = @($dirty)
            $receipt.recovered    = 'COMMIT_COMPLETED_ON_RECOVERY'
            $receipt.completedAt  = Get-UtcStamp
            Save-C1ItemReceipt -Context $Context -Receipt $receipt | Out-Null
            Clear-C1PendingTransaction -Context $Context
            return (New-RecoveryResult 'COMPLETED_TRANSACTION' ("Lane $($Lane.id): re-verified the interrupted work and completed the commit as " +
                "$($newHead.Substring(0,8)). The worker was NOT rerun.") @($receipt))
        }

        # Pending open, branch moved, no marker: something other than this
        # transaction advanced the branch. Not deterministic, so do not decide.
        $ev = Save-C1FailedRecoveryEvidence -Context $Context -ItemId $itemId
        return (New-RecoveryResult 'FAILED_RECOVERY' ("Lane $($Lane.id): branch moved from $($pre.Substring(0,8)) to $($head.Substring(0,8)) " +
            "but carries no marker for the pending item. Branch preserved; lane stopped. Evidence preserved at $ev.") @() -Blocked)
    }

    # ------------------------------------------------------------- cases C / D
    $lastKnown = Get-C1LastVerifiedSha -Context $Context -LaneId $Lane.id
    if (-not $lastKnown -or $lastKnown -eq $head) {
        return (New-RecoveryResult 'NOTHING_TO_RECOVER' 'Persisted state matches the lane branch.')
    }

    if (-not (Test-C1Ancestor -WorktreePath $WorktreePath -Ancestor $lastKnown -Descendant $head)) {
        # CASE D. Reset nothing. This is an inspection case, not a repair case.
        return (New-RecoveryResult 'FAILED_RECOVERY' ("Lane $($Lane.id): persisted head $($lastKnown.Substring(0,8)) is not an ancestor of branch head " +
            "$($head.Substring(0,8)). Nothing reset; lane stopped for inspection.") @() -Blocked)
    }

    # CASE C. Recover only what the repository establishes as valid lane work.
    $paths = @(Get-C1CommitPaths -WorktreePath $WorktreePath -FromSha $lastKnown -ToSha $head)
    $ruling = Test-C1PathsAcceptable -Paths $paths -OwnedPaths @($Lane.ownedPaths) -ForbiddenPaths $ForbiddenPaths
    if (-not $ruling.acceptable) {
        return (New-RecoveryResult 'FAILED_RECOVERY' ("Lane $($Lane.id): branch is ahead by changes this lane may not own " +
            "(forbidden: $($ruling.forbiddenPaths -join ', '); out-of-scope: $($ruling.unownedPaths -join ', ')). Branch preserved; lane stopped.") @() -Blocked)
    }

    $receipt = New-C1ItemReceipt -RunId 'recovered' -PassId 0 -Attempt 0 -Lane $Lane -Branch $Branch `
        -ItemId "recovered-$($Lane.id)-$($head.Substring(0,8))"
    $receipt.workItem           = '(recovered from branch history)'
    $receipt.purpose            = 'Verified lane commits present on the branch but absent from persisted state.'
    $receipt.headShaBefore      = $lastKnown
    $receipt.headShaAfter       = $head
    $receipt.commitSha          = $head
    $receipt.changedPaths       = @($paths)
    $receipt.ownedPathCheck     = 'PASS'
    $receipt.forbiddenPathCheck = 'PASS'
    $receipt.result             = 'RECOVERED'
    $receipt.recovered          = 'BRANCH_AHEAD_OF_STATE'
    $receipt.completedAt        = Get-UtcStamp
    Save-C1ItemReceipt -Context $Context -Receipt $receipt | Out-Null

    New-RecoveryResult 'RECOVERED_BRANCH_AHEAD' ("Lane $($Lane.id): recovered $($paths.Count) verified path(s) committed between " +
        "$($lastKnown.Substring(0,8)) and $($head.Substring(0,8)).") @($receipt)
}
