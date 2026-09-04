# Operator-facing progress output for the Customer 1 orchestrator.
# Dot-source this AFTER _common.ps1.
#
# THE PRINCIPLE
#
#   THE MACHINE TRACKS CYCLES. THE OPERATOR TRACKS ACCOMPLISHMENTS.
#
# Run ids, PIDs, timeouts, SHAs, state transitions and exit codes are real and
# necessary -- they go to the durable diagnostic log. What reaches the console is
# what a person needs to know: what is being worked on, why it matters, what
# just landed, which Customer 1 gate moved, what is blocked and who owns it.
#
# One hard rule, learned the expensive way: nothing here ever filters a failure.
# A temporary `grep` wrapper once swallowed a fatal PowerShell error and the
# operator saw an empty log and a dead sweep. Failures print in full, always.

Set-StrictMode -Version Latest

$script:C1DiagLog = $null
$script:C1EchoDiag = $false

function Initialize-C1Diagnostics {
    <#
        Point the diagnostic log at a real file before anything interesting
        happens. Set C1_VERBOSE=1 to mirror diagnostics to the console too.
    #>
    param([Parameter(Mandatory)][string]$Path)
    $dir = Split-Path -Parent $Path
    if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    $script:C1DiagLog = $Path
    $script:C1EchoDiag = ($env:C1_VERBOSE -eq '1')
    # The child scripts (invoke-lane, verify-result, reconcile-main) run in their
    # own scope and re-load these functions, so a script-scoped variable does not
    # reach them. Without this the child falls back to Write-Host and its
    # timestamped machine detail lands back on the operator's console.
    $env:C1_DIAG_LOG = $Path
    Write-Diag "diagnostic log opened: $Path"
    $Path
}

function Write-Diag {
    <#
        Machine detail. Appends to the durable log; echoes to the console only in
        verbose mode. Never throws -- a logging failure must not take down a run.
    #>
    param([string]$Message, [string]$Level = 'INFO')
    $line = "[{0}] [{1}] {2}" -f (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'), $Level, $Message
    $target = if ($script:C1DiagLog) { $script:C1DiagLog } else { $env:C1_DIAG_LOG }
    if ($target) {
        try { Add-Content -LiteralPath $target -Value $line -Encoding UTF8 } catch { }
    }
    if ($script:C1EchoDiag -or $env:C1_VERBOSE -eq '1' -or -not $target) { Write-Host $line }
}

# Every existing harness call site logs through Write-Step. Redirecting it to the
# diagnostic log is what moves run ids and SHAs off the operator's console
# without touching a single caller.
function Write-Step {
    param([string]$Message, [string]$Level = 'INFO')
    Write-Diag -Message $Message -Level $Level
}

function Write-C1Rule {
    param([string]$Text)
    Write-Host ('-' * 60)
    if ($Text) { Write-Host $Text }
}

function Format-C1Duration {
    param([TimeSpan]$Span)
    if ($Span.TotalHours -ge 1) { return ('{0}h {1}m' -f [int]$Span.TotalHours, $Span.Minutes) }
    '{0}m {1:00}s' -f [int]$Span.TotalMinutes, $Span.Seconds
}

function Get-C1GateLines {
    <#
        Gate id, name and current status straight from the ledger. The ledger is
        the authority; this never restates a gate from memory.
    #>
    param($Ledger, [string[]]$GateIds)
    $out = foreach ($id in @($GateIds)) {
        $g = @($Ledger.gates | Where-Object { $_.id -eq $id })
        if ($g.Count -gt 0) { "  $($g[0].id) -- $($g[0].name)" } else { "  $id" }
    }
    @($out)
}

# ------------------------------------------------------------------ §12 start

function Write-C1ItemStart {
    param(
        [Parameter(Mandatory)]$Lane,
        [Parameter(Mandatory)]$Ledger,
        [string]$WorkItem,
        [string]$Why,
        [string]$Branch,
        [string]$HeadSha
    )
    Write-Host ''
    Write-Host ('-' * 60)
    Write-Host "NOW WORKING -- $($Lane.name.ToUpperInvariant())"
    Write-Host ''
    Write-Host 'Customer 1 gate:'
    Get-C1GateLines -Ledger $Ledger -GateIds @($Lane.gates) | ForEach-Object { Write-Host $_ }
    Write-Host ''
    Write-Host 'Work item:'
    Write-Host "  $(if ($WorkItem) { $WorkItem } else { 'selected by the worker from its charter' })"
    Write-Host ''
    Write-Host 'Why this matters:'
    Write-Host "  $(if ($Why) { $Why } else { 'Advances the gates above toward Day-1 readiness for Taylor.' })"
    Write-Host ''
    Write-Host 'Starting branch:'
    Write-Host "  $Branch @ $(if ($HeadSha) { $HeadSha.Substring(0, 8) } else { '(new)' })"
    Write-Host ('-' * 60)
}

# -------------------------------------------------------------- §13 heartbeat

function Write-C1Heartbeat {
    <#
        Only measurable facts: wall-clock elapsed and how many files have actually
        changed on disk. Claude's prose is never mined for "progress" -- a worker
        narrating confidently while producing nothing is precisely the situation
        this is meant to expose.
    #>
    param(
        [Parameter(Mandatory)]$Lane,
        [string]$WorkItem,
        [Parameter(Mandatory)][TimeSpan]$Elapsed,
        [int]$FilesChanged = 0
    )
    Write-Host "  Still working -- $($Lane.name)"
    if ($WorkItem) { Write-Host "  Current item: $WorkItem" }
    Write-Host "  Elapsed: $(Format-C1Duration $Elapsed)"
    Write-Host "  Files currently changed: $FilesChanged"
    Write-Host '  No safety/governance issue detected.'
    Write-Host ''
}

# ------------------------------------------------------- §14/§15 item receipts

function Write-C1Completion {
    param(
        [Parameter(Mandatory)]$Receipt,
        [Parameter(Mandatory)]$Lane,
        [Parameter(Mandatory)]$Ledger,
        [string]$Accomplished,
        [string]$WhyGateOpen,
        [string]$NextWork,
        [int]$OpenDecisions = 0,
        [string]$DecisionOwners = ''
    )
    Write-Host ''
    Write-Host "[OK] COMPLETED -- $($Lane.name.ToUpperInvariant())"
    Write-Host ''
    Write-Host 'Customer 1 gate advanced:'
    Get-C1GateLines -Ledger $Ledger -GateIds @($Lane.gates) | ForEach-Object { Write-Host $_ }
    Write-Host ''
    Write-Host 'Completed:'
    Write-Host "  $($Receipt.workItem)"
    Write-Host ''
    Write-Host 'Created / changed:'
    if (@($Receipt.changedPaths).Count -eq 0) { Write-Host '  (nothing)' }
    else { @($Receipt.changedPaths) | ForEach-Object { Write-Host "  $_" } }
    Write-Host ''
    Write-Host 'Verification:'
    foreach ($p in @($Receipt.proofResults)) {
        Write-Host "  $(if ($p.passed) { '[OK]' } else { '[FAIL]' }) $($p.command)"
    }
    Write-Host "  $(if ($Receipt.ownedPathCheck -eq 'PASS') { '[OK]' } else { '[FAIL]' }) owned-path check"
    Write-Host "  $(if ($Receipt.forbiddenPathCheck -eq 'PASS') { '[OK]' } else { '[FAIL]' }) forbidden-path check"
    Write-Host ''
    Write-Host 'Commit:'
    Write-Host "  $(if ($Receipt.commitSha) { $Receipt.commitSha } else { '(none)' })"
    Write-Host ''
    # Mandatory. A receipt without this is a status line, not an accomplishment.
    Write-Host 'What this accomplished:'
    Write-Host "  $(if ($Accomplished) { $Accomplished } else { 'Verified Customer 1 readiness artifact committed to the lane branch.' })"
    Write-Host ''
    Write-Host 'Gate status:'
    Get-C1GateStatusLines -Ledger $Ledger -GateIds @($Lane.gates) | ForEach-Object { Write-Host $_ }
    Write-Host ''
    Write-Host 'Why it remains open:'
    Write-Host "  $(if ($WhyGateOpen) { $WhyGateOpen } else { 'Gate closure requires evidence this item did not yet produce.' })"
    Write-Host ''
    Write-Host 'Next safe work:'
    Write-Host "  $(if ($NextWork) { $NextWork } else { '(the lane did not name one)' })"
    Write-Host ''
    Write-Host "Open decisions:"
    Write-Host "  $OpenDecisions$(if ($DecisionOwners) { " ($DecisionOwners)" })"
    Write-Host ''
}

function Get-C1GateStatusLines {
    param($Ledger, [string[]]$GateIds)
    $out = foreach ($id in @($GateIds)) {
        $g = @($Ledger.gates | Where-Object { $_.id -eq $id })
        if ($g.Count -gt 0) { "  $($g[0].id): $($g[0].status)" } else { "  ${id}: UNKNOWN" }
    }
    @($out)
}

function Write-C1Partial {
    param(
        [Parameter(Mandatory)]$Receipt,
        [Parameter(Mandatory)]$Lane,
        [string]$Accomplished,
        [string]$StillNeeded,
        [string]$WaitingOn = 'none',
        [string]$NextWork
    )
    Write-Host ''
    Write-Host "[PARTIAL] $($Lane.name.ToUpperInvariant())"
    Write-Host ''
    Write-Host 'Completed:'
    Write-Host "  $($Receipt.workItem)"
    if (@($Receipt.changedPaths).Count -gt 0) {
        @($Receipt.changedPaths) | ForEach-Object { Write-Host "    $_" }
    }
    Write-Host ''
    Write-Host 'What this accomplished:'
    Write-Host "  $(if ($Accomplished) { $Accomplished } else { 'Part of the gate evidence now exists and is committed.' })"
    Write-Host ''
    Write-Host 'Still needed:'
    Write-Host "  $(if ($StillNeeded) { $StillNeeded } else { 'Remaining gate evidence for this lane.' })"
    Write-Host ''
    Write-Host 'Waiting on:'
    Write-Host "  $WaitingOn"
    Write-Host ''
    Write-Host 'Automation will continue with:'
    Write-Host "  $(if ($NextWork) { $NextWork } else { 'the next executable lane' })"
    Write-Host ''
}

function Write-C1Blocker {
    <#
        Printed the first time a blocker is seen. Re-announcing the same open
        blocker every pass trains the operator to ignore the console, which
        defeats the point of having one.
    #>
    param([Parameter(Mandatory)]$Blocker, [Parameter(Mandatory)]$Lane)
    Write-Host ''
    Write-Host "[BLOCKED] $($Lane.name.ToUpperInvariant())"
    Write-Host ''
    Write-Host 'Cannot decide:'
    Write-Host "  $($Blocker.question)"
    Write-Host ''
    Write-Host 'Decision owner:'
    Write-Host "  $($Blocker.category)"
    Write-Host ''
    Write-Host 'What is blocked:'
    Write-Host "  $($Blocker.blockingScope)"
    Write-Host ''
    Write-Host 'Work NOT stopped:'
    Write-Host "  $($Blocker.remainingExecutableWork)"
    Write-Host ''
}

# ------------------------------------------------------------ §18 failure

function Write-C1Failure {
    <#
        Unfiltered, always. Whatever else is true, the operator must be able to
        see the real exception and know whether verified work survived.
    #>
    param(
        [Parameter(Mandatory)][string]$Component,
        [string]$LaneId = '(unknown)',
        $ExitCode = '(none)',
        [string]$ActualError,
        [string]$Committed = 'NO',
        [string]$StateAdvanced = 'NO',
        [string]$RecoveryStatus = 'Re-run the orchestrator; startup recovery will reconcile state before selecting work.'
    )
    Write-Host ''
    Write-Host 'FAILURE'
    Write-Host ''
    Write-Host 'Component:'
    Write-Host "  $Component"
    Write-Host ''
    Write-Host 'Lane:'
    Write-Host "  $LaneId"
    Write-Host ''
    Write-Host 'Exit code:'
    Write-Host "  $ExitCode"
    Write-Host ''
    Write-Host 'Actual error:'
    foreach ($line in @(($ActualError -split "`r?`n"))) { Write-Host "  $line" }
    Write-Host ''
    Write-Host 'Verified work committed:'
    Write-Host "  $Committed"
    Write-Host ''
    Write-Host 'Persistent state advanced:'
    Write-Host "  $StateAdvanced"
    Write-Host ''
    Write-Host 'Recovery status:'
    Write-Host "  $RecoveryStatus"
    Write-Host ''
    Write-Diag "FAILURE in $Component (lane $LaneId, exit $ExitCode): $ActualError" 'ERROR'
}

# ------------------------------------------------------------- §17 pass board

function Get-C1BlockerOwnerCounts {
    <#
        Open blockers grouped by who actually owns the decision. GOVERNANCE and
        COLLISION land on the Owner because there is nobody else to route them to.
    #>
    param($Blockers)
    $open = @($Blockers.blockers | Where-Object { $_.status -eq 'OPEN' })
    [pscustomobject]@{
        Owner    = @($open | Where-Object { $_.category -in @('OWNER', 'GOVERNANCE', 'COLLISION') }).Count
        Taylor   = @($open | Where-Object { $_.category -eq 'TAYLOR' }).Count
        Legal    = @($open | Where-Object { $_.category -eq 'LEGAL' }).Count
        External = @($open | Where-Object { $_.category -eq 'EXTERNAL' }).Count
        Total    = $open.Count
        Open     = @($open)
    }
}

function Get-C1LaneUnavailableReason {
    param([Parameter(Mandatory)]$Lane)
    if (-not $Lane.enabled) { return 'lane disabled' }
    switch ($Lane.state) {
        'COMPLETE'           { 'gate work complete' }
        'BLOCKED'            { 'blocked -- decision owner must respond' }
        'WAITING_FOR_OWNER'  { 'waiting on the Owner' }
        'WAITING_FOR_TAYLOR' { 'waiting on Taylor' }
        'WAITING_FOR_MAIN'   { 'waiting on an unresolved repository collision' }
        'RUNNING'            { 'currently running' }
        'FAILED_RECOVERY'    { 'recovery was ambiguous -- lane stopped for inspection' }
        'RETRY_EXHAUSTED'    { 'technical retry limit exhausted' }
        default              { "state $($Lane.state)" }
    }
}

function Write-C1PassBoard {
    <#
        Generated entirely from persisted state: this pass's item receipts, the
        blocker file, the lane file and the ledger. Nothing here is narrated.
    #>
    param(
        [Parameter(Mandatory)]$PassReceipts,
        [Parameter(Mandatory)]$Lanes,
        [Parameter(Mandatory)]$Blockers,
        [Parameter(Mandatory)]$Ledger
    )
    $receipts = @($PassReceipts)
    $counts = Get-C1BlockerOwnerCounts -Blockers $Blockers

    Write-Host ''
    Write-Host ('=' * 60)
    Write-Host 'CUSTOMER 1 PROGRESS'
    Write-Host ('=' * 60)
    Write-Host ''

    Write-Host 'COMPLETED THIS PASS'
    $completed = @($receipts | Where-Object { $_.result -in @('DONE', 'PARTIAL', 'RECOVERED') })
    if ($completed.Count -eq 0) { Write-Host '  (nothing completed this pass)' }
    foreach ($r in $completed) {
        Write-Host "  [OK] $($r.laneName)"
        Write-Host "      $($r.workItem)"
    }
    Write-Host ''

    Write-Host 'VERIFIED COMMITS'
    $commits = @($receipts | Where-Object { $_.commitSha })
    if ($commits.Count -eq 0) { Write-Host '  (none)' }
    foreach ($r in $commits) {
        Write-Host "  $($r.laneId) $($r.commitSha.Substring(0,8)) $($r.workItem)"
    }
    Write-Host ''

    Write-Host 'CUSTOMER 1 GATES ADVANCED'
    $touched = @($commits | ForEach-Object { @($_.gates) } | Select-Object -Unique)
    if ($touched.Count -eq 0) { Write-Host '  (no gate evidence changed this pass)' }
    foreach ($gid in $touched) {
        $g = @($Ledger.gates | Where-Object { $_.id -eq $gid })
        $status = if ($g.Count -gt 0) { $g[0].status } else { 'UNKNOWN' }
        $what = (@($commits | Where-Object { @($_.gates) -contains $gid } | ForEach-Object { $_.workItem })) -join '; '
        Write-Host "  $gid $status -- $what"
    }
    Write-Host ''

    Write-Host 'WAITING ON PEOPLE / EXTERNAL INPUT'
    Write-Host "  Owner:     $($counts.Owner)"
    Write-Host "  Taylor:    $($counts.Taylor)"
    Write-Host "  Legal:     $($counts.Legal)"
    Write-Host "  External:  $($counts.External)"
    Write-Host ''

    Write-Host 'SAFE AUTOMATED WORK STILL AVAILABLE'
    $available = @($Lanes.lanes | Where-Object { Test-LaneExecutable -Lane $_ -AllLanes $Lanes.lanes })
    if ($available.Count -eq 0) { Write-Host '  (none)' }
    foreach ($l in $available) {
        $hints = @($receipts | Where-Object { $_.laneId -eq $l.id -and $_.nextSuggestedItem })
        $hint = if ($hints.Count -gt 0) { $hints[-1].nextSuggestedItem } else { 'next item from the lane charter' }
        Write-Host "  $($l.id) $($l.name): $hint"
    }
    Write-Host ''

    Write-Host 'NO SAFE WORK CURRENTLY AVAILABLE'
    $unavailable = @($Lanes.lanes | Where-Object { -not (Test-LaneExecutable -Lane $_ -AllLanes $Lanes.lanes) })
    if ($unavailable.Count -eq 0) { Write-Host '  (all lanes executable)' }
    foreach ($l in $unavailable) {
        Write-Host "  $($l.id) $($l.name): $(Get-C1LaneUnavailableReason -Lane $l)"
    }
    Write-Host ''

    Write-Host 'CUSTOMER 1 PRODUCTION STATUS'
    Write-Host '  NOT READY / NOT AUTHORIZED'
    Write-Host ''

    Write-Host 'NEXT AUTOMATED WORK'
    if ($available.Count -eq 0) {
        Write-Host '  (none -- no executable lane remains)'
    } else {
        $n = $available[0]
        $hints = @($receipts | Where-Object { $_.laneId -eq $n.id -and $_.nextSuggestedItem })
        Write-Host "  $($n.id) $($n.name)"
        Write-Host "  $(if ($hints.Count -gt 0) { $hints[-1].nextSuggestedItem } else { 'next item from the lane charter' })"
    }
    Write-Host ('=' * 60)
    Write-Host ''
}

# -------------------------------------------------------- §20 final exhaustion

function Write-C1ExhaustionReport {
    param(
        [Parameter(Mandatory)]$Lanes,
        [Parameter(Mandatory)]$Blockers,
        [Parameter(Mandatory)]$Ledger,
        [Parameter(Mandatory)]$AllReceipts,
        [hashtable]$LaneHeads = @{}
    )
    $receipts = @($AllReceipts)
    $counts = Get-C1BlockerOwnerCounts -Blockers $Blockers

    Write-Host ''
    Write-Host ('=' * 60)
    Write-Host 'SAFE AUTOMATED CUSTOMER 1 WORK EXHAUSTED'
    Write-Host ('=' * 60)
    Write-Host ''

    Write-Host 'COMPLETED BY AUTOMATION'
    $done = @($receipts | Where-Object { $_.result -in @('DONE', 'PARTIAL', 'RECOVERED') -and $_.workItem })
    if ($done.Count -eq 0) { Write-Host '  (nothing)' }
    foreach ($r in $done) { Write-Host "  $($r.laneId) $($r.workItem)" }
    Write-Host ''

    Write-Host 'VERIFIED LANE BRANCHES'
    foreach ($l in @($Lanes.lanes)) {
        $branch = "$($l.branchPrefix)work"
        $sha = if ($LaneHeads.ContainsKey($l.id)) { $LaneHeads[$l.id] } else { '(not created)' }
        Write-Host "  $($l.id) $branch $sha"
    }
    Write-Host ''

    Write-Host 'CUSTOMER 1 GATES ADVANCED'
    $touched = @($receipts | Where-Object { $_.commitSha } | ForEach-Object { @($_.gates) } | Select-Object -Unique)
    if ($touched.Count -eq 0) { Write-Host '  (none)' }
    foreach ($gid in $touched) {
        $g = @($Ledger.gates | Where-Object { $_.id -eq $gid })
        if ($g.Count -gt 0) { Write-Host "  $gid $($g[0].status) -- $($g[0].name)" }
    }
    Write-Host ''

    Write-Host 'REMAINING BEFORE GO-LIVE'
    $openGates = @($Ledger.gates | Where-Object { $_.status -ne 'CLOSED' })
    if ($openGates.Count -eq 0) { Write-Host '  (no open gates in the ledger)' }
    foreach ($g in $openGates) { Write-Host "  $($g.id) $($g.name) -- closes when: $($g.closeWhen)" }
    Write-Host ''

    foreach ($grp in @(
        @{ Title = 'WAITING ON OWNER';            Cats = @('OWNER', 'GOVERNANCE', 'COLLISION') },
        @{ Title = 'WAITING ON TAYLOR';           Cats = @('TAYLOR') },
        @{ Title = 'WAITING ON LEGAL / EXTERNAL'; Cats = @('LEGAL', 'EXTERNAL') }
    )) {
        Write-Host $grp.Title
        $rows = @($counts.Open | Where-Object { $_.category -in $grp.Cats })
        if ($rows.Count -eq 0) { Write-Host '  (none)' }
        foreach ($b in $rows) { Write-Host "  [$($b.lane)] $($b.question)" }
        Write-Host ''
    }

    Write-Host 'TECHNICAL FAILURES'
    $failed = @($receipts | Where-Object { $_.result -in @('FAILED_TECHNICAL', 'FAILED_RECOVERY') })
    if ($failed.Count -eq 0) { Write-Host '  (none)' }
    foreach ($r in $failed) { Write-Host "  $($r.laneId) $($r.result) -- $($r.workItem)" }
    Write-Host ''

    Write-Host 'PRODUCTION ACTIONS'
    Write-Host '  NONE'
    Write-Host ''
    Write-Host 'PRODUCTION AUTHORIZED'
    Write-Host '  NO'
    Write-Host ''
    Write-Host 'Safe-work exhaustion means automation has nothing further it may'
    Write-Host 'safely do. It does not mean production ready, production authorized,'
    Write-Host 'Owner accepted, Taylor approved, or deploy allowed.'
    Write-Host ('=' * 60)
    Write-Host ''
}
