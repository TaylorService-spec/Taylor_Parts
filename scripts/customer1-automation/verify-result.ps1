<#
.SYNOPSIS
    Independently verify what a lane session actually did to the repository.

.DESCRIPTION
    Claude narrative output is not proof. This script ignores the narrative and
    reads the repository: which commits appeared, which paths changed, whether
    anything landed outside the lane's ownership, whether a governed authority
    path was touched, whether declared expected files exist, and whether the
    declared targeted proofs pass.

    The verdict may DOWNGRADE the worker's claimed result. It never upgrades it.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$WorktreePath,
    [Parameter(Mandatory)][string]$HeadShaBefore,
    [string[]]$OwnedPaths = @(),
    [string[]]$ForbiddenPaths = @(),
    [string[]]$ExpectedFiles = @(),
    [string[]]$Proofs = @(),
    [Parameter(Mandatory)]$ProofPolicy,
    [string]$ClaimedResult = 'NO_WORK',
    [int]$ProofTimeoutSec = 900,
    # Proof results computed earlier, before the harness commit. The orchestrator
    # proves the work first so the write-ahead transaction can record a real
    # verification result; passing them back in avoids running each proof twice.
    # An empty array is a legitimate "no proofs declared" -- $null means "not
    # supplied, run them here" (the standalone path this script still supports).
    $ProofResults = $null
)

. (Join-Path (Split-Path -Parent $PSCommandPath) '_common.ps1')

$headAfter = (Invoke-Git -Directory $WorktreePath -Arguments @('rev-parse', 'HEAD')).Output[0]

# Committed changes since the session started.
#
# The @() is load-bearing: a commit touching exactly ONE file yields a bare
# string, and `.Count` on a scalar throws under StrictMode Latest. A one-file
# item is the common case for this program, not an edge case.
$changed = @()
if ($headAfter -ne $HeadShaBefore) {
    $changed = @((Invoke-Git -Directory $WorktreePath `
        -Arguments @('diff', '--name-only', "$HeadShaBefore..$headAfter")).Output | Where-Object { $_ })
}

# Anything left uncommitted is an unexpected modification: a work item must stop
# at a mergeable boundary, not a dirty tree.
$dirty = @((Invoke-Git -Directory $WorktreePath -Arguments @('status', '--porcelain')).Output |
    Where-Object { $_ -and $_ -notmatch '\.orchestrator-result\.json$' })

$outOfScope = Select-UnownedPaths -Paths @($changed) -OwnedPatterns $OwnedPaths
$forbidden  = Select-ForbiddenPaths -Paths @($changed) -ForbiddenPatterns $ForbiddenPaths

$missingExpected = @($ExpectedFiles | Where-Object {
    -not (Test-Path (Join-Path $WorktreePath $_))
})

# The declared targeted proofs.
#
# The worker SUGGESTED these. The harness decides. Every command is validated
# against the central policy BEFORE execution -- a rejected command is never
# run, not run-and-then-judged.
#
# The orchestrator normally runs them pre-commit and passes the results in here.
# When it does not, this script runs them itself, which keeps verify-result.ps1
# usable on its own for a one-off inspection.
$proofResults = if ($null -ne $ProofResults) {
    @($ProofResults)
} else {
    @(Invoke-C1Proofs -WorktreePath $WorktreePath -Proofs $Proofs -ProofPolicy $ProofPolicy)
}

$rejectedProofs = @($proofResults | Where-Object { -not $_.executed })
$failedProofs = @($proofResults | Where-Object { -not $_.passed })

$violations = @()
if ($forbidden.Count -gt 0)       { $violations += "touched governed authority path(s): $($forbidden -join ', ')" }
if ($outOfScope.Count -gt 0)      { $violations += "changed path(s) outside lane ownership: $($outOfScope -join ', ')" }
if ($dirty.Count -gt 0)           { $violations += "left $($dirty.Count) uncommitted change(s)" }
if ($missingExpected.Count -gt 0) { $violations += "expected file(s) missing: $($missingExpected -join ', ')" }
if ($rejectedProofs.Count -gt 0)  { $violations += "$($rejectedProofs.Count) proof command(s) rejected unexecuted by policy: $(($rejectedProofs | ForEach-Object { "'$($_.command)' ($($_.reason))" }) -join '; ')" }
if ($failedProofs.Count -gt 0)    { $violations += "$($failedProofs.Count) declared proof(s) failed" }

# Verdict. A forbidden-path touch is the one violation that is a harness-level
# security concern, not merely a failed work item.
$verdict = $ClaimedResult
$securityViolation = ($forbidden.Count -gt 0)

if ($securityViolation) {
    $verdict = 'FAILED_TECHNICAL'
} elseif ($violations.Count -gt 0) {
    $verdict = if ($changed.Count -gt 0) { 'PARTIAL' } else { 'FAILED_TECHNICAL' }
} elseif ($changed.Count -eq 0 -and $ClaimedResult -eq 'DONE') {
    # Claimed done, changed nothing. Downgrade rather than believe it.
    $verdict = 'NO_WORK'
}

[pscustomobject]@{
    headShaBefore     = $HeadShaBefore
    headShaAfter      = $headAfter
    changedPaths      = @($changed)
    outOfScopePaths   = @($outOfScope)
    forbiddenPaths    = @($forbidden)
    uncommitted       = @($dirty)
    missingExpected   = @($missingExpected)
    proofResults      = @($proofResults)
    rejectedProofs    = @($rejectedProofs)
    violations        = @($violations)
    securityViolation = $securityViolation
    claimedResult     = $ClaimedResult
    verdict           = $verdict
}
