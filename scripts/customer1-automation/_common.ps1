# Shared helpers for the Customer 1 orchestrator.
# Dot-source this; it defines functions and does nothing on its own.

Set-StrictMode -Version Latest

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
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)]$Object
    )
    $json = $Object | ConvertTo-Json -Depth 20
    Set-Content -LiteralPath $Path -Value $json -Encoding UTF8
}

function Write-Step {
    param([string]$Message, [string]$Level = 'INFO')
    $stamp = (Get-Date).ToString('HH:mm:ss')
    Write-Host "[$stamp] [$Level] $Message"
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
        [string]$ExpectedBranch = 'automation/customer1-orchestrator',
        [string]$ExpectedRemoteFragment = 'Taylor_Parts'
    )

    $remote = (Invoke-Git -Directory $Root -Arguments @('remote', 'get-url', 'origin')).Output -join ''
    if ($remote -notmatch [regex]::Escape($ExpectedRemoteFragment)) {
        throw "STOP: repository identity mismatch. origin is '$remote', expected a $ExpectedRemoteFragment remote."
    }

    $branch = (Invoke-Git -Directory $Root -Arguments @('branch', '--show-current')).Output -join ''
    if ($branch -ne $ExpectedBranch) {
        throw "STOP: harness worktree is on branch '$branch', expected '$ExpectedBranch'."
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

function Select-UnownedPaths {
    param([string[]]$Paths, [string[]]$OwnedPatterns)
    @($Paths | Where-Object { -not (Test-PathMatch -Path $_ -Patterns $OwnedPatterns) })
}

function Select-ForbiddenPaths {
    param([string[]]$Paths, [string[]]$ForbiddenPatterns)
    @($Paths | Where-Object { Test-PathMatch -Path $_ -Patterns $ForbiddenPatterns })
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

    $nonExecutable = @('RUNNING', 'BLOCKED', 'COMPLETE', 'WAITING_FOR_OWNER', 'WAITING_FOR_TAYLOR', 'WAITING_FOR_MAIN')
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
