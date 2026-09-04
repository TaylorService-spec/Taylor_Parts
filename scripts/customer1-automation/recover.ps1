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
        [string]$ResultFileName = '.orchestrator-result.json',
        # Supplied by the supervisor so a crash before the blockers write can be
        # finished here. Recovery restores the blockers the interrupted item
        # raised; without them the lane's wait state would be reconstructed from
        # nothing and the Owner's question would be silently dropped.
        $BlockersDoc = $null,
        [string]$MainRef = 'origin/main'
    )

    function New-RecoveryResult {
        param($Status, $Message, $Recovered = @(), [switch]$Blocked, [switch]$PendingReadyToClear)
        [pscustomobject]@{
            laneId    = $Lane.id
            status    = $Status
            message   = $Message
            recovered = @($Recovered)
            blocked   = [bool]$Blocked
            # Recovery reconstructs the lane state and the blockers IN MEMORY; the
            # supervisor owns writing lanes.json and blockers.json. So recovery
            # must not clear the pending transaction itself -- doing so released
            # the recovery guard while the recovered state was still only in
            # memory, and a crash in that gap lost the blockers and the wait state
            # with no evidence left that anything was unfinished.
            #
            # This flag says "the transaction is settled; clear it once you have
            # persisted everything". Ambiguous recovery never sets it.
            pendingReadyToClear = [bool]$PendingReadyToClear
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

            # What the transaction said this commit would contain. Phase 1 records
            # it as verifiedChangedPaths; by phase 2 the final receipt carries the
            # verified set. Either way the commit must match, or the situation is
            # not the one the transaction described.
            $expectedPaths = if ($pending.PSObject.Properties['verifiedChangedPaths']) {
                @($pending.verifiedChangedPaths)
            } elseif ($pending.PSObject.Properties['finalReceipt'] -and $pending.finalReceipt) {
                @($pending.finalReceipt.changedPaths)
            } else { @() }

            $drift = @(Get-C1PathDrift -Actual $paths -Expected $expectedPaths)
            if ($drift.Count -gt 0) {
                $ev = Save-C1FailedRecoveryEvidence -Context $Context -ItemId $itemId
                return (New-RecoveryResult 'FAILED_RECOVERY' ("Recovered commit $($marked.Substring(0,8)) does not match the pending transaction " +
                    "(differs on: $($drift -join ', ')). Branch preserved; nothing rerun. Evidence preserved at $ev.") @() -Blocked)
            }

            # Phase 2 means the harness had already finished verifying and had
            # assembled the whole checkpoint before it died. Replay that exactly.
            $phase = if ($pending.PSObject.Properties['phase']) { $pending.phase } else { 'PRE_COMMIT' }

            $receipt = if ($phase -eq 'COMMITTED_PENDING_CHECKPOINT' -and $pending.PSObject.Properties['finalReceipt']) {
                $pending.finalReceipt
            } else {
                # Phase 1: the commit landed but verification never completed, so
                # the in-flight receipt still has a null result. Rebuild from the
                # immutable claim snapshot rather than persisting a null or
                # re-reading Claude's stdout, which is gone.
                $r = $pending.itemReceipt
                $snap = if ($pending.PSObject.Properties['claimSnapshot']) { $pending.claimSnapshot } else { $null }
                if ($snap) {
                    if (-not $r.workItem) { $r.workItem = $snap.workItem }
                    if (-not $r.purpose) { $r.purpose = $snap.purpose }
                    if (-not $r.nextSuggestedItem) { $r.nextSuggestedItem = $snap.nextSuggestedItem }
                    if (@($r.proofResults).Count -eq 0) { $r.proofResults = @($snap.proofResults) }
                }
                # The commit is proven to exist and to be within the lane's
                # ownership, but the post-commit verdict never ran. RECOVERED is
                # the honest result; DONE would be manufactured.
                $r.result = 'RECOVERED'
                $r
            }

            # The recovered item ends AT ITS OWN COMMIT.
            #
            # Setting headShaAfter to the branch head would silently attribute any
            # later commit to this transaction and mark that unverified head as
            # the lane's last verified SHA. Later commits are reconciled below, on
            # their own evidence.
            $receipt.headShaAfter = $marked
            $receipt.commitSha    = $marked
            $receipt.changedPaths = @($paths)
            $receipt.recovered    = if ($phase -eq 'COMMITTED_PENDING_CHECKPOINT') { 'CHECKPOINT_INTERRUPTED' } else { 'COMMIT_WITHOUT_CHECKPOINT' }
            $receipt.completedAt  = Get-UtcStamp

            # Restore the blockers and the wait state this item implied, so a
            # crash before the lanes/blockers write does not lose them.
            $restoredBlockers = @()
            if ($phase -eq 'COMMITTED_PENDING_CHECKPOINT' -and $pending.PSObject.Properties['normalizedBlockers']) {
                $restoredBlockers = @($pending.normalizedBlockers)
            } elseif ($pending.PSObject.Properties['claimSnapshot'] -and $pending.claimSnapshot) {
                $n = 0
                foreach ($bc in @($pending.claimSnapshot.blockerClaims)) {
                    $n++
                    $restoredBlockers += New-C1LaneBlocker -Lane $Lane -RunId $pending.runId `
                        -PassId $(if ($pending.PSObject.Properties['passId']) { [int]$pending.passId } else { 0 }) `
                        -Suffix "w$n" -WorkItem $receipt.workItem `
                        -Category $bc.category -Question $bc.question -Why $bc.whyAutomationCannotDecide `
                        -Scope $bc.blockingScope -Remaining $bc.remainingExecutableWork
                }
            }

            $receipt.blockersRaised = @()
            if ($BlockersDoc) {
                foreach ($rb in $restoredBlockers) {
                    # Dedupe makes this idempotent: replaying a checkpoint that
                    # partially landed adds nothing twice.
                    $added = Add-C1Blocker -BlockersDoc $BlockersDoc -Blocker $rb
                    if ($receipt.blockersRaised -notcontains $added.blocker.id) {
                        $receipt.blockersRaised += $added.blocker.id
                    }
                }
            }

            Save-C1ItemReceipt -Context $Context -Receipt $receipt | Out-Null

            if ($phase -eq 'COMMITTED_PENDING_CHECKPOINT' -and $pending.PSObject.Properties['intendedLaneState'] -and $pending.intendedLaneState) {
                $Lane.state = $pending.intendedLaneState
            }
            $Lane.currentWorkItem = $receipt.workItem
            $Lane.lastRun = $receipt.runId
            $Lane.lastResult = $receipt.result

            # NOT cleared here. The supervisor clears it after lanes.json and
            # blockers.json are on disk.

            # Anything committed AFTER the marked commit is a separate question,
            # answered by the ordinary branch-ahead rule on its own evidence.
            $trailing = $null
            if ($head -ne $marked) {
                $trailing = Resolve-C1BranchAhead -Context $Context -Lane $Lane -WorktreePath $WorktreePath `
                    -Branch $Branch -FromSha $marked -ToSha $head -ForbiddenPaths $ForbiddenPaths -MainRef $MainRef
            }

            $msg = "Lane $($Lane.id): commit $($marked.Substring(0,8)) was already made and verifies. " +
                   'Checkpoint finalized; the worker was NOT rerun.'
            if ($trailing) {
                $msg += " $($trailing.message)"
                if ($trailing.blocked) {
                    # The transaction itself settled, but the trailing range did
                    # not. Keep the evidence: this lane needs a human.
                    return (New-RecoveryResult 'FAILED_RECOVERY' $msg (@($receipt) + @($trailing.recovered)) -Blocked)
                }
                return (New-RecoveryResult 'RECOVERED_COMMIT' $msg (@($receipt) + @($trailing.recovered)) -PendingReadyToClear)
            }
            return (New-RecoveryResult 'RECOVERED_COMMIT' $msg @($receipt) -PendingReadyToClear)
        }

        if ($head -eq $pre) {
            # CASE A. The commit never happened.
            $dirty = @(Get-C1DirtyPaths -WorktreePath $WorktreePath -ResultFileName $ResultFileName)

            if ($dirty.Count -eq 0) {
                # Nothing happened at all: no commit, no changes. The transaction
                # is settled, but the clear still belongs to the supervisor so
                # that "recovery never clears" holds without exception.
                return (New-RecoveryResult 'RETRY_NEEDED' ("Lane $($Lane.id): interrupted before commit and the working tree is empty. " +
                    'No completion claimed; the item is available to run again.') @() -PendingReadyToClear)
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
            $snap = if ($pending.PSObject.Properties['claimSnapshot']) { $pending.claimSnapshot } else { $null }
            if ($snap) {
                if (-not $receipt.workItem) { $receipt.workItem = $snap.workItem }
                if (-not $receipt.purpose) { $receipt.purpose = $snap.purpose }
                if (-not $receipt.nextSuggestedItem) { $receipt.nextSuggestedItem = $snap.nextSuggestedItem }
                if (@($receipt.proofResults).Count -eq 0) { $receipt.proofResults = @($snap.proofResults) }
            }
            $receipt.headShaAfter = $newHead
            $receipt.commitSha    = $newHead
            $receipt.changedPaths = @($dirty)
            $receipt.recovered    = 'COMMIT_COMPLETED_ON_RECOVERY'
            # Never null. The work is proven present; the original post-commit
            # verdict is not, so RECOVERED rather than a manufactured DONE.
            $receipt.result       = 'RECOVERED'
            $receipt.completedAt  = Get-UtcStamp

            $receipt.blockersRaised = @()
            if ($BlockersDoc -and $snap) {
                $n = 0
                foreach ($bc in @($snap.blockerClaims)) {
                    $n++
                    $rb = New-C1LaneBlocker -Lane $Lane -RunId $pending.runId `
                        -PassId $(if ($pending.PSObject.Properties['passId']) { [int]$pending.passId } else { 0 }) `
                        -Suffix "w$n" -WorkItem $receipt.workItem `
                        -Category $bc.category -Question $bc.question -Why $bc.whyAutomationCannotDecide `
                        -Scope $bc.blockingScope -Remaining $bc.remainingExecutableWork
                    $added = Add-C1Blocker -BlockersDoc $BlockersDoc -Blocker $rb
                    if ($receipt.blockersRaised -notcontains $added.blocker.id) {
                        $receipt.blockersRaised += $added.blocker.id
                    }
                }
            }

            Save-C1ItemReceipt -Context $Context -Receipt $receipt | Out-Null
            $Lane.currentWorkItem = $receipt.workItem
            $Lane.lastRun = $receipt.runId
            $Lane.lastResult = $receipt.result
            # Cleared by the supervisor, after lanes.json and blockers.json land.
            return (New-RecoveryResult 'COMPLETED_TRANSACTION' ("Lane $($Lane.id): re-verified the interrupted work and completed the commit as " +
                "$($newHead.Substring(0,8)). The worker was NOT rerun.") @($receipt) -PendingReadyToClear)
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
    $r = Resolve-C1BranchAhead -Context $Context -Lane $Lane -WorktreePath $WorktreePath -Branch $Branch `
        -FromSha $lastKnown -ToSha $head -ForbiddenPaths $ForbiddenPaths -MainRef $MainRef
    if ($r.blocked) {
        return (New-RecoveryResult 'FAILED_RECOVERY' $r.message @() -Blocked)
    }
    if ($r.PSObject.Properties['integrationOnly'] -and $r.integrationOnly) {
        # Nothing was lost and nothing needs reconstructing; the branch simply
        # carries upstream code the harness merged in.
        return (New-RecoveryResult 'RECOVERED_INTEGRATION' $r.message @($r.recovered))
    }
    New-RecoveryResult 'RECOVERED_BRANCH_AHEAD' $r.message @($r.recovered)
}

function Resolve-C1BranchAhead {
    <#
        Reconcile one commit range that persisted state does not account for,
        strictly on repository evidence.

        Shared by the ordinary branch-ahead case and by the tail of a recovered
        transaction. That sharing is the point: commits made after a recovered
        harness commit must be judged on their own merits, never inherited by the
        transaction that happened to precede them.
    #>
    param(
        [Parameter(Mandatory)]$Context,
        [Parameter(Mandatory)]$Lane,
        [Parameter(Mandatory)][string]$WorktreePath,
        [Parameter(Mandatory)][string]$Branch,
        [Parameter(Mandatory)][string]$FromSha,
        [Parameter(Mandatory)][string]$ToSha,
        [string[]]$ForbiddenPaths = @(),
        [string]$MainRef = 'origin/main'
    )
    # Judge LANE-AUTHORED commits only.
    #
    # A plain two-dot diff across an upstream merge reports everything main
    # changed as though the lane had done it, so a lane that had merely
    # reconciled with main failed its own ownership check. Upstream commits are
    # excluded from the range, and integration merges contribute no paths.
    $authored = @(Get-C1LaneAuthoredCommits -WorktreePath $WorktreePath -FromSha $FromSha -ToSha $ToSha -MainRef $MainRef)
    $domain = @($authored | Where-Object { -not $_.isIntegration })
    $integrations = @($authored | Where-Object { $_.isIntegration })
    $paths = @($domain | ForEach-Object { @($_.paths) } | Where-Object { $_ } | Select-Object -Unique)

    $ruling = Test-C1PathsAcceptable -Paths $paths -OwnedPaths @($Lane.ownedPaths) -ForbiddenPaths $ForbiddenPaths
    if (-not $ruling.acceptable) {
        return [pscustomobject]@{
            blocked   = $true
            recovered = @()
            message   = ("Lane $($Lane.id): commits between $($FromSha.Substring(0,8)) and $($ToSha.Substring(0,8)) " +
                         "change paths this lane may not own (forbidden: $($ruling.forbiddenPaths -join ', '); " +
                         "out-of-scope: $($ruling.unownedPaths -join ', ')). Branch preserved; lane stopped.")
        }
    }

    if ($domain.Count -eq 0) {
        # The branch moved, but not by lane work -- an upstream integration, or
        # nothing this lane authored. There is no item to reconstruct and nothing
        # is wrong.
        #
        # A receipt is still written, for one reason: it advances the lane's last
        # verified SHA. Without it every subsequent start would re-discover the
        # same merge and re-report it forever, and persisted state would never
        # catch up to the branch.
        $what = if ($integrations.Count -gt 0) {
            "$($integrations.Count) upstream integration merge(s) ($(@($integrations | ForEach-Object { $_.sha.Substring(0,8) }) -join ', '))"
        } else { 'no lane-authored commits' }

        $ir = New-C1ItemReceipt -RunId 'recovered' -PassId 0 -Attempt 0 -Lane $Lane -Branch $Branch `
            -ItemId "integration-$($Lane.id)-$($ToSha.Substring(0,8))"
        $ir.workItem           = '(upstream integration, not lane work)'
        $ir.purpose            = "Records that the branch advanced to $($ToSha.Substring(0,8)) by $what."
        $ir.headShaBefore      = $FromSha
        $ir.headShaAfter       = $ToSha
        $ir.commitSha          = $ToSha
        $ir.changedPaths       = @()
        $ir.ownedPathCheck     = 'PASS'
        $ir.forbiddenPathCheck = 'PASS'
        $ir.result             = 'RECOVERED'
        $ir.recovered          = 'MAIN_INTEGRATION'
        $ir.completedAt        = Get-UtcStamp
        Save-C1ItemReceipt -Context $Context -Receipt $ir | Out-Null

        return [pscustomobject]@{
            blocked         = $false
            recovered       = @($ir)
            integrationOnly = $true
            message         = "Lane $($Lane.id): branch advanced by $what; no lane work to recover."
        }
    }

    $receipt = New-C1ItemReceipt -RunId 'recovered' -PassId 0 -Attempt 0 -Lane $Lane -Branch $Branch `
        -ItemId "recovered-$($Lane.id)-$($ToSha.Substring(0,8))"
    $receipt.workItem           = '(recovered from branch history)'
    $receipt.purpose            = 'Verified lane commits present on the branch but absent from persisted state.'
    $receipt.headShaBefore      = $FromSha
    $receipt.headShaAfter       = $ToSha
    $receipt.commitSha          = $ToSha
    $receipt.changedPaths       = @($paths)
    $receipt.ownedPathCheck     = 'PASS'
    $receipt.forbiddenPathCheck = 'PASS'
    $receipt.result             = 'RECOVERED'
    $receipt.recovered          = 'BRANCH_AHEAD_OF_STATE'
    $receipt.completedAt        = Get-UtcStamp
    Save-C1ItemReceipt -Context $Context -Receipt $receipt | Out-Null

    [pscustomobject]@{
        blocked   = $false
        recovered = @($receipt)
        message   = ("Lane $($Lane.id): independently recovered $($paths.Count) verified path(s) committed between " +
                     "$($FromSha.Substring(0,8)) and $($ToSha.Substring(0,8)).")
    }
}
