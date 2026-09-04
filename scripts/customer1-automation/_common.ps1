# Shared helpers for the Customer 1 orchestrator.
# Dot-source this; it defines functions and does nothing on its own.

Set-StrictMode -Version Latest

# Write-Step used to print straight to the console, which is how run ids and
# SHAs became the operator's primary view of the program. It now lives in
# progress.ps1 and routes to the durable diagnostic log instead. Loading it here
# means every script that already dot-sources _common.ps1 -- including the ones
# invoked in a child scope -- gets the same routing without a single call-site
# change.
. (Join-Path (Split-Path -Parent $PSCommandPath) 'progress.ps1')

function Get-C1Context {
    <#
        Resolves the harness worktree root and the paths of the state files.
        Everything else derives from this, so there is exactly one place that
        knows the layout.
    #>
    $scriptDir = Split-Path -Parent $PSCommandPath
    $root = Resolve-Path (Join-Path $scriptDir '..\..') | Select-Object -ExpandProperty Path
    $automation = Join-Path $root 'docs\customer-1\automation'

    [pscustomobject]@{
        Root       = $root
        Automation = $automation
        LanesFile  = Join-Path $automation 'lanes.json'
        StateFile  = Join-Path $automation 'run-state.json'
        BlockersFile = Join-Path $automation 'blockers.json'
        LedgerFile = Join-Path $root 'docs\customer-1\CUSTOMER_1_LEDGER.json'
        ReportsDir = Join-Path $automation 'reports'
        LogsDir    = Join-Path $automation 'reports\logs'
        # One receipt file per bounded work item. This is the durable record
        # that survives a reboot mid-sweep, and it doubles as the completed-work
        # history that keeps a later worker from rebuilding the same artifact.
        ItemsDir   = Join-Path $automation 'items'
        # Write-ahead receipt for the one interruption window that matters:
        # between "verification passed" and "state checkpoint written".
        PendingFile = Join-Path $automation 'pending-transaction.json'
        # Where a pending transaction goes when recovery could NOT establish what
        # happened. Deleting the only forensic evidence of an ambiguous crash is
        # how an unexplained branch becomes permanently unexplainable.
        RecoveryDir = Join-Path $automation 'reports\recovery'
    }
}

function Read-JsonFile {
    param([Parameter(Mandatory)][string]$Path)
    if (-not (Test-Path $Path)) { throw "Orchestration state missing: $Path" }
    try {
        Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
    } catch {
        throw "Orchestration state is not valid JSON: $Path -- $($_.Exception.Message)"
    }
}

function Write-JsonFile {
    <#
        Atomic by construction. A half-written state file that still parses is
        worse than no state file at all: startup recovery would trust it. Serialize
        fully, write a sibling temp file, flush it, then replace in one operation.

        Same-directory temp is deliberate -- Move-Item is only atomic within a volume.
    #>
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)]$Object
    )
    $json = $Object | ConvertTo-Json -Depth 20
    $dir = Split-Path -Parent $Path
    if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }

    $tmp = "$Path.tmp-$PID-$([guid]::NewGuid().ToString('N').Substring(0,8))"
    try {
        # WriteAllText closes and flushes to the OS before returning.
        [System.IO.File]::WriteAllText($tmp, $json, [System.Text.UTF8Encoding]::new($false))
        Move-Item -LiteralPath $tmp -Destination $Path -Force
    } finally {
        if (Test-Path $tmp) { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
    }
}

function Remove-JsonFile {
    param([Parameter(Mandatory)][string]$Path)
    if (Test-Path $Path) { Remove-Item -LiteralPath $Path -Force }
}

function Invoke-Git {
    <#
        Runs git in a given directory and returns stdout lines. Throws on a
        non-zero exit unless -AllowFail. Never guesses: a failed git command
        that the caller did not expect is a harness malfunction.
    #>
    param(
        [Parameter(Mandatory)][string]$Directory,
        [Parameter(Mandatory)][string[]]$Arguments,
        [switch]$AllowFail
    )
    Push-Location $Directory
    try {
        $out = & git @Arguments 2>&1
        $code = $LASTEXITCODE
    } finally {
        Pop-Location
    }
    if ($code -ne 0 -and -not $AllowFail) {
        throw "git $($Arguments -join ' ') failed in $Directory (exit $code): $out"
    }
    [pscustomobject]@{
        ExitCode = $code
        Output   = @($out | ForEach-Object { "$_" })
    }
}

function Assert-HarnessIdentity {
    <#
        PROGRAM-LEVEL STOP CONDITION check. Any failure here aborts the whole
        run; these are not lane blockers.
    #>
    param(
        [Parameter(Mandatory)][string]$Root,
        # A FAMILY, not one name. The guard's job is "this is a sanctioned
        # harness worktree" -- not main, not a lane branch, not an arbitrary
        # checkout. One hardcoded name was too narrow: the program needs both an
        # orchestrator worktree and a separate clean controller, and git cannot
        # check out one branch in two worktrees at once. Framework repair happens
        # on its own branch too, and must be able to dry-run itself.
        #
        # Lane branches are customer1/<x>-work and match NEITHER pattern, which is
        # the property that actually matters here.
        [string[]]$ExpectedBranchPattern = @('automation/customer1-*', 'fix/customer1-*'),
        [string]$ExpectedRemoteFragment = 'Taylor_Parts'
    )

    $remote = (Invoke-Git -Directory $Root -Arguments @('remote', 'get-url', 'origin')).Output -join ''
    if ($remote -notmatch [regex]::Escape($ExpectedRemoteFragment)) {
        throw "STOP: repository identity mismatch. origin is '$remote', expected a $ExpectedRemoteFragment remote."
    }

    $branch = (Invoke-Git -Directory $Root -Arguments @('branch', '--show-current')).Output -join ''
    $matched = @($ExpectedBranchPattern | Where-Object { $branch -like $_ })
    if ($matched.Count -eq 0) {
        throw "STOP: harness worktree is on branch '$branch', expected one matching: $($ExpectedBranchPattern -join ', ')."
    }
    # Belt-and-braces: never operate the harness directly on an integration branch.
    if ($branch -in @('main', 'master')) {
        throw "STOP: the harness must never run from branch '$branch'."
    }

    [pscustomobject]@{ Remote = $remote; Branch = $branch }
}

function Get-MainSha {
    param(
        [Parameter(Mandatory)][string]$Directory,
        [string]$MainRef = 'origin/main'
    )
    $r = Invoke-Git -Directory $Directory -Arguments @('rev-parse', $MainRef) -AllowFail
    if ($r.ExitCode -ne 0 -or -not $r.Output -or $r.Output[0] -notmatch '^[0-9a-f]{40}$') {
        throw "STOP: cannot determine authoritative main ($MainRef)."
    }
    $r.Output[0]
}

function Test-PathMatch {
    <#
        True when a repo-relative path matches any pattern. Patterns are either
        exact paths or globs; '**' and '*' both match across path separators,
        which is the behaviour we want for ownership prefixes.
    #>
    param(
        [Parameter(Mandatory)][string]$Path,
        [string[]]$Patterns
    )
    if (-not $Patterns) { return $false }
    $normalized = $Path -replace '\\', '/'
    foreach ($p in $Patterns) {
        $pattern = ($p -replace '\\', '/') -replace '\*\*', '*'
        if ($normalized -like $pattern) { return $true }
    }
    return $false
}

# CONVENTION, and it matters in both directions.
#
# These two return a real empty collection even with zero results, because their
# callers ASSIGN the result and then read .Count -- which throws on $null under
# StrictMode. The leading comma defeats PowerShell's unroll-on-output.
#
# The cost is that `@(Select-UnownedPaths ...)` would wrap the empty array in
# ANOTHER array and report Count 1. So these are never called inside @(). Every
# OTHER collection helper in this harness does the opposite: it returns plainly
# and every call site wraps with @(). Mixing the two idioms is what made an empty
# result look like one pending change.
#
# Wrapping the result in an outer
# single-element array defeats the unroll; PowerShell then hands back the inner
# array intact, empty or not.
function Select-UnownedPaths {
    param([string[]]$Paths, [string[]]$OwnedPatterns)
    ,@($Paths | Where-Object { -not (Test-PathMatch -Path $_ -Patterns $OwnedPatterns) })
}

function Select-ForbiddenPaths {
    param([string[]]$Paths, [string[]]$ForbiddenPatterns)
    ,@($Paths | Where-Object { Test-PathMatch -Path $_ -Patterns $ForbiddenPatterns })
}

function Test-ProofCommand {
    <#
        Decide whether a worker-suggested proof command may execute.

        A worker may SUGGEST a proof. It may not authorize one. The policy is
        always loaded from the HARNESS worktree, never from the lane worktree,
        so a lane cannot widen its own permissions from inside a work item.

        Order matters: structure, then denylist, then positive allowlist. The
        allowlist is the actual gate -- the denylist is belt-and-braces for
        anything that slips through a loose allow pattern.

        Returns { command, allowed, reason }.
    #>
    param(
        [string]$Command,
        [Parameter(Mandatory)]$Policy
    )

    function Deny { param($Why) [pscustomobject]@{ command = $Command; allowed = $false; reason = $Why } }

    if ([string]::IsNullOrWhiteSpace($Command)) { return (Deny 'empty command') }

    $cmd = $Command.Trim()

    if ($cmd.Length -gt $Policy.maxCommandLength) {
        return (Deny "command exceeds $($Policy.maxCommandLength) characters")
    }

    # Structure first: no chaining, no substitution, no redirection. This is
    # what stops "npm test && rm -rf /" from ever reaching the allowlist.
    foreach ($meta in @($Policy.rejectMetacharacters)) {
        if ($cmd.Contains($meta)) {
            return (Deny "contains shell metacharacter '$($meta -replace "`n", '\n' -replace "`r", '\r')'")
        }
    }

    $lower = $cmd.ToLowerInvariant()
    foreach ($bad in @($Policy.deny)) {
        if ($lower.Contains($bad.ToLowerInvariant())) {
            return (Deny "matches denied construct '$bad'")
        }
    }

    foreach ($pattern in @($Policy.allow)) {
        if ($cmd -cmatch $pattern) {
            return [pscustomobject]@{ command = $Command; allowed = $true; reason = "matches allow pattern '$pattern'" }
        }
    }

    Deny 'not on the approved proof allowlist'
}

function Invoke-C1Proofs {
    <#
        Validate and run the worker's suggested proof commands, in the lane
        worktree, BEFORE anything is committed.

        Order matters. Proving the work and then committing it means the pending
        transaction can carry a real verification result; committing first and
        proving afterwards would leave a commit standing on an unproven claim.

        Every command is checked against the central policy first. A rejected
        command is never executed -- not executed-then-judged.
    #>
    param(
        [Parameter(Mandatory)][string]$WorktreePath,
        [string[]]$Proofs = @(),
        [Parameter(Mandatory)]$ProofPolicy
    )
    $results = @()
    foreach ($proof in @($Proofs)) {
        if (-not $proof) { continue }

        $ruling = Test-ProofCommand -Command $proof -Policy $ProofPolicy
        if (-not $ruling.allowed) {
            Write-Step "Proof REJECTED (not executed): $proof -- $($ruling.reason)" 'WARN'
            $results += [pscustomobject]@{
                command = $proof; exitCode = $null; passed = $false
                executed = $false; reason = $ruling.reason; tail = ''
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
        $results += [pscustomobject]@{
            command = $proof; exitCode = $code; passed = ($code -eq 0)
            executed = $true; reason = $ruling.reason
            tail = (@($output) | Select-Object -Last 20) -join "`n"
        }
    }
    @($results)
}

function New-RunId {
    'run-' + (Get-Date).ToString('yyyyMMdd-HHmmss')
}

function Get-UtcStamp {
    (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
}

function Test-LaneExecutable {
    <#
        A lane is executable when it is enabled, not in a terminal or waiting
        state, and every lane it depends on is COMPLETE.

        BLOCKED_PARTIAL is executable on purpose: part of the lane is blocked
        and the rest is not, which is the normal condition for this program.
    #>
    param(
        [Parameter(Mandatory)]$Lane,
        [Parameter(Mandatory)]$AllLanes
    )
    if (-not $Lane.enabled) { return $false }

    # FAILED_RECOVERY and RETRY_EXHAUSTED are terminal for automation until a
    # human intervenes. Leaving them selectable meant the next pass cheerfully
    # started a worker on a lane whose state could not be established, or one
    # that had already burned its retry budget.
    $nonExecutable = @(
        'RUNNING', 'BLOCKED', 'COMPLETE',
        'WAITING_FOR_OWNER', 'WAITING_FOR_TAYLOR', 'WAITING_FOR_MAIN',
        'WAITING_FOR_LEGAL', 'WAITING_FOR_EXTERNAL', 'WAITING_FOR_GOVERNANCE',
        'FAILED_RECOVERY', 'RETRY_EXHAUSTED'
    )
    if ($nonExecutable -contains $Lane.state) { return $false }

    foreach ($depId in @($Lane.dependencies)) {
        $dep = $AllLanes | Where-Object { $_.id -eq $depId }
        if (-not $dep -or $dep.state -ne 'COMPLETE') { return $false }
    }
    return $true
}

function Get-ExecutableLanes {
    <#
        Dependency ordering first, then priority. Returns lanes in the order the
        orchestrator should attempt them.
    #>
    param([Parameter(Mandatory)]$Lanes)
    @($Lanes |
        Where-Object { Test-LaneExecutable -Lane $_ -AllLanes $Lanes } |
        Sort-Object @{ Expression = { @($_.dependencies).Count } }, @{ Expression = { $_.priority } })
}
