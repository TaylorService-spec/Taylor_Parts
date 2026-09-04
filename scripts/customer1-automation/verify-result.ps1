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
    [int]$ProofTimeoutSec = 900
)

. (Join-Path (Split-Path -Parent $PSCommandPath) '_common.ps1')

$headAfter = (Invoke-Git -Directory $WorktreePath -Arguments @('rev-parse', 'HEAD')).Output[0]

# Committed changes since the session started.
$changed = @()
if ($headAfter -ne $HeadShaBefore) {
    $changed = (Invoke-Git -Directory $WorktreePath `
        -Arguments @('diff', '--name-only', "$HeadShaBefore..$headAfter")).Output | Where-Object { $_ }
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

# Run the declared targeted proofs.
#
# The worker SUGGESTED these. The harness decides. Every command is validated
# against the central policy BEFORE execution -- a rejected command is never
# run, not run-and-then-judged.
$proofResults = @()
$rejectedProofs = @()
foreach ($proof in @($Proofs)) {
    if (-not $proof) { continue }

    $ruling = Test-ProofCommand -Command $proof -Policy $ProofPolicy
    if (-not $ruling.allowed) {
        Write-Step "Proof REJECTED (not executed): $proof -- $($ruling.reason)" 'WARN'
        $rejectedProofs += $ruling
        $proofResults += [pscustomobject]@{
            command  = $proof
            exitCode = $null
            passed   = $false
            executed = $false
            reason   = $ruling.reason
            tail     = ''
        }
        continue
    }

    Write-Step "Proof: $proof"
    Push-Location $WorktreePath
    try {
        $parts = $proof.Trim() -split '\s+'
        $exe = $parts[0]
        $rest = @($parts | Select-Object -Skip 1)
        # Direct invocation, no shell. There is no interpreter to trick.
        $output = & $exe @rest 2>&1
        $code = $LASTEXITCODE
    } catch {
        $output = $_.Exception.Message
        $code = 1
    } finally {
        Pop-Location
    }
    $proofResults += [pscustomobject]@{
        command  = $proof
        exitCode = $code
        passed   = ($code -eq 0)
        executed = $true
        reason   = $ruling.reason
        tail     = (@($output) | Select-Object -Last 20) -join "`n"
    }
}

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
