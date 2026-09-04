<#
    Regression suite for the Customer 1 orchestrator FRAMEWORK.

    Everything here runs against a throwaway sandbox repository and a FAKE Claude
    worker. No real lane session is ever started, no Customer 1 domain work is
    touched, and no production surface is contacted. That is deliberate: proving
    the harness must not cost real worker sessions.

    The sandbox is a genuine git setup, not a mock:
      <temp>/Taylor_Parts.git   bare origin (the name satisfies the identity guard)
      <temp>/harness            harness worktree on automation/customer1-sandbox
      <temp>/lanes/<id>         lane worktrees the harness creates itself

    pwsh -File scripts/customer1-automation/test-framework.ps1
#>
[CmdletBinding()]
param([switch]$KeepSandbox)

# ---------------------------------------------------------------- HOST GUARD
#
# PowerShell 7+ only, checked BEFORE anything is dot-sourced, read, or written.
#
# invoke-lane.ps1 launches the worker through ProcessStartInfo.ArgumentList,
# which does not exist in Windows PowerShell 5.1. Under 5.1 the run got all the
# way through legacy bootstrap, reconciliation and a main merge before dying at
# the process launch with "The property 'ArgumentList' cannot be found on this
# object" -- persistent state mutated, no worker ever started. 5.1 also treats
# native stderr differently, which stopped the regression suite on a harmless
# git warning.
#
# Deliberately inline and dependency-free: it must run and report on the very
# host it is rejecting, so it cannot rely on anything this repository defines.
if ($PSVersionTable.PSVersion.Major -lt 7) {
    $msg = @"
STOP: this orchestrator requires PowerShell 7 or newer.

  Detected: $($PSVersionTable.PSEdition) $($PSVersionTable.PSVersion) ($($PSVersionTable.PSVersion.Major).x)
  Required: PowerShell 7.0+ (pwsh)

Windows PowerShell 5.1 lacks ProcessStartInfo.ArgumentList, which is how the
harness passes worker arguments without them being re-split, and it handles
native-command stderr differently.

Nothing has been read or written. Re-run with pwsh, for example:

  pwsh -File $PSCommandPath
"@
    Write-Host $msg -ForegroundColor Red
    throw 'STOP: unsupported PowerShell host (requires 7+).'
}

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $PSCommandPath
$repoRoot = Resolve-Path (Join-Path $here '..\..') | Select-Object -ExpandProperty Path

. (Join-Path $here '_common.ps1')
. (Join-Path $here 'checkpoint.ps1')
. (Join-Path $here 'recover.ps1')
. (Join-Path $here 'bootstrap-legacy.ps1')

$script:failures = 0
$script:checks = 0

function Check {
    param([string]$Name, [scriptblock]$Test)
    $script:checks++
    try {
        $ok = & $Test
        if ($ok) { Write-Host ("  PASS  {0}" -f $Name) -ForegroundColor Green }
        else { $script:failures++; Write-Host ("  FAIL  {0}" -f $Name) -ForegroundColor Red }
    } catch {
        $script:failures++
        Write-Host ("  FAIL  {0} -- {1}" -f $Name, $_.Exception.Message) -ForegroundColor Red
    }
}

function Section { param([string]$Title) Write-Host ''; Write-Host "== $Title" -ForegroundColor Cyan }

# ---------------------------------------------------------------- sandbox

$sandbox = Join-Path ([System.IO.Path]::GetTempPath()) ("c1fw-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
$originDir = Join-Path $sandbox 'Taylor_Parts.git'
$harnessDir = Join-Path $sandbox 'harness'
$lanesDir = Join-Path $sandbox 'lanes'
$fakeDir = Join-Path $sandbox 'fake'
$fakeExe = Join-Path $fakeDir 'fake-claude.cmd'
$fakeBehavior = Join-Path $fakeDir 'behavior.ps1'
$argvOut = Join-Path $fakeDir 'argv.txt'
$callsOut = Join-Path $fakeDir 'calls.txt'

# NOT named $Args -- that is an automatic variable and never binds positionally.
function Git-In { param([string]$Dir, [string[]]$GitArgs) (Invoke-Git -Directory $Dir -Arguments $GitArgs).Output }

function New-Sandbox {
    New-Item -ItemType Directory -Force -Path $sandbox, $fakeDir, $lanesDir | Out-Null

    & git init --bare --initial-branch=main $originDir --quiet 2>&1 | Out-Null
    & git clone $originDir $harnessDir --quiet 2>&1 | Out-Null
    Git-In $harnessDir @('config', 'user.email', 'harness@example.invalid') | Out-Null
    Git-In $harnessDir @('config', 'user.name', 'C1 Test Harness') | Out-Null

    # Real framework code, plus the minimum Customer 1 state it reads.
    New-Item -ItemType Directory -Force -Path (Join-Path $harnessDir 'scripts\customer1-automation') | Out-Null
    Copy-Item (Join-Path $here '*.ps1') (Join-Path $harnessDir 'scripts\customer1-automation') -Force

    $autoSrc = Join-Path $repoRoot 'docs\customer-1\automation'
    $autoDst = Join-Path $harnessDir 'docs\customer-1\automation'
    New-Item -ItemType Directory -Force -Path $autoDst, (Join-Path $autoDst 'lanes'), (Join-Path $autoDst 'items'), (Join-Path $autoDst 'reports') | Out-Null
    Copy-Item (Join-Path $autoSrc 'lanes\*.md') (Join-Path $autoDst 'lanes') -Force
    Copy-Item (Join-Path $repoRoot 'docs\customer-1\CUSTOMER_1_LEDGER.json') (Join-Path $harnessDir 'docs\customer-1') -Force

    # Two lanes is enough to prove rotation, ordering and exhaustion, and keeps
    # the suite fast. Their real ownership rules are preserved.
    $lanes = Read-JsonFile (Join-Path $autoSrc 'lanes.json')
    $lanes.lanes = @($lanes.lanes | Where-Object { $_.id -in @('A', 'B') })
    foreach ($l in $lanes.lanes) { $l.state = 'READY'; $l.lastReconciledMain = $null; $l.lastRun = $null; $l.lastResult = $null }
    $lanes.config.worktreeRoot = $lanesDir
    $lanes.config.claudeExe = $fakeExe
    $lanes.config.claudeTimeoutSec = 60
    Write-JsonFile (Join-Path $autoDst 'lanes.json') $lanes

    Write-JsonFile (Join-Path $autoDst 'blockers.json') ([pscustomobject]@{ schemaVersion = 1; blockers = @() })
    Write-JsonFile (Join-Path $autoDst 'run-state.json') ([pscustomobject]@{ schemaVersion = 1; lastRunId = $null; runs = @() })

    Git-In $harnessDir @('add', '-A') | Out-Null
    Git-In $harnessDir @('commit', '-q', '-m', 'sandbox: customer 1 framework under test') | Out-Null
    Git-In $harnessDir @('push', '-q', 'origin', 'main') | Out-Null
    Git-In $harnessDir @('checkout', '-q', '-b', 'automation/customer1-sandbox') | Out-Null

    New-FakeClaude
}

function New-FakeClaude {
    <#
        The fake worker is a .cmd so it is a real executable target for
        ProcessStartInfo, and its shift-loop records each argv token on its own
        line. If argument boundaries were ever lost again, `Bash(git status:*)`
        would show up here as two lines and the argv check would fail.
    #>
    $cmd = @(
        '@echo off'
        ':loop'
        'if "%~1"=="" goto done'
        'echo %~1>>"%FAKE_CLAUDE_ARGV%"'
        'shift'
        'goto loop'
        ':done'
        'pwsh -NoProfile -ExecutionPolicy Bypass -File "%FAKE_CLAUDE_BEHAVIOR%"'
        'exit /b %FAKE_CLAUDE_EXIT%'
    )
    Set-Content -LiteralPath $fakeExe -Value $cmd -Encoding ascii

    $behavior = @'
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$lane = Split-Path -Leaf (Get-Location).Path
Add-Content -LiteralPath $env:FAKE_CLAUDE_CALLS -Value "$lane $(Get-Date -Format o)"
$calls = @(Get-Content -LiteralPath $env:FAKE_CLAUDE_CALLS | Where-Object { $_ -like "$lane *" }).Count
$owned = if ($lane -eq 'A') { 'docs/customer-1/scope' } else { 'docs/customer-1/data' }

function Save-Result { param($Obj) $Obj | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath '.orchestrator-result.json' -Encoding UTF8 }

switch ($env:FAKE_CLAUDE_MODE) {
    'crash' {
        [Console]::Error.WriteLine('FATAL: fake worker exploded with no timestamp prefix whatsoever')
        exit 0
    }
    'forbidden' {
        Set-Content -LiteralPath 'firestore.rules' -Value '// worker tried to widen its own authority' -Encoding UTF8
        Save-Result ([pscustomobject]@{ workItem = 'F-1 forbidden probe'; result = 'DONE'; summary = 'touched a governed path'; expectedFiles = @('firestore.rules'); proofs = @(); blockers = @(); nextSuggestedItem = 'none' })
        exit 0
    }
    'nowork' {
        Save-Result ([pscustomobject]@{ workItem = "$lane-idle"; result = 'NO_WORK'; summary = 'nothing safe left.'; expectedFiles = @(); proofs = @(); blockers = @(); nextSuggestedItem = 'none' })
        exit 0
    }
    'editthendie' {
        # Edits an owned file, then dies without any result receipt.
        New-Item -ItemType Directory -Force -Path $owned | Out-Null
        Set-Content -LiteralPath "$owned/half-written.md" -Value '# half a thought' -Encoding UTF8
        [Console]::Error.WriteLine('FATAL: worker died mid-item')
        exit 0
    }
    'editthenmalformed' {
        # Edits an owned file, exits zero, but the receipt is not valid JSON.
        New-Item -ItemType Directory -Force -Path $owned | Out-Null
        Set-Content -LiteralPath "$owned/malformed-claim.md" -Value '# looks fine on disk' -Encoding UTF8
        Set-Content -LiteralPath '.orchestrator-result.json' -Value '{ "workItem": "truncated' -Encoding UTF8
        exit 0
    }
    'editvalidthennonzero' {
        # Perfectly valid work and a valid receipt -- but the process exits nonzero.
        New-Item -ItemType Directory -Force -Path $owned | Out-Null
        Set-Content -LiteralPath "$owned/valid-but-crashed.md" -Value '# valid content' -Encoding UTF8
        Save-Result ([pscustomobject]@{
            workItem = "$lane-crash-after-valid"; result = 'DONE'
            summary = 'Wrote a file and then the process fell over.'
            expectedFiles = @("$owned/valid-but-crashed.md"); proofs = @(); blockers = @(); nextSuggestedItem = 'none'
        })
        exit 0
    }
    'blockedowner' {
        # Blocked on the Owner with NO safe remaining work in this lane.
        Save-Result ([pscustomobject]@{
            workItem = "$lane-owner-question"; result = 'BLOCKED_OWNER'
            summary = 'Needs an Owner ruling before anything else in this lane can proceed.'
            expectedFiles = @(); proofs = @()
            blockers = @(@{
                category = 'OWNER'
                question = 'Which pricing basis applies to the Day-1 contract?'
                whyAutomationCannotDecide = 'Commercial terms are an Owner decision.'
                blockingScope = 'All remaining lane work.'
                remainingExecutableWork = 'none'
            })
            nextSuggestedItem = 'none'
        })
        exit 0
    }
    'noworkdirty' {
        # Contract violation: "I did nothing" while leaving an owned file behind.
        New-Item -ItemType Directory -Force -Path $owned | Out-Null
        Set-Content -LiteralPath "$owned/nowork-but-dirty.md" -Value '# left behind' -Encoding UTF8
        Save-Result ([pscustomobject]@{
            workItem = "$lane-claims-nothing"; result = 'NO_WORK'
            summary = 'Claims nothing was done, yet a file is sitting there.'
            expectedFiles = @(); proofs = @(); blockers = @(); nextSuggestedItem = 'none'
        })
        exit 0
    }
    'failedtechdirty' {
        New-Item -ItemType Directory -Force -Path $owned | Out-Null
        Set-Content -LiteralPath "$owned/failedtech-but-dirty.md" -Value '# left behind' -Encoding UTF8
        Save-Result ([pscustomobject]@{
            workItem = "$lane-self-reported-failure"; result = 'FAILED_TECHNICAL'
            summary = 'Reports its own technical failure but leaves changes behind.'
            expectedFiles = @(); proofs = @(); blockers = @(); nextSuggestedItem = 'none'
        })
        exit 0
    }
    'blockednextonly' {
        # The trap: NO remaining executable work, but a nextSuggestedItem that
        # describes what to do AFTER the Owner answers. That must not make the
        # lane executable.
        Save-Result ([pscustomobject]@{
            workItem = "$lane-owner-gated"; result = 'BLOCKED_OWNER'
            summary = 'Blocked pending an Owner ruling on Day-1 scope.'
            expectedFiles = @(); proofs = @()
            blockers = @(@{
                category = 'OWNER'
                question = 'Which EOS families are in Day-1 scope?'
                whyAutomationCannotDecide = 'Scope is an Owner decision.'
                blockingScope = 'All remaining lane work.'
                remainingExecutableWork = 'none'
            })
            nextSuggestedItem = 'Update the matrix after Owner chooses Day-1 scope'
        })
        exit 0
    }
    'workblocked' {
        # Commits real owned work AND raises an Owner blocker with no safe work
        # left. Used by the crash-window tests: the recovered checkpoint must
        # restore the commit, the blocker AND the wait state.
        New-Item -ItemType Directory -Force -Path $owned | Out-Null
        $f = "$owned/blocked-item-$([guid]::NewGuid().ToString('N').Substring(0,6)).md"
        Set-Content -LiteralPath $f -Value '# committed, then blocked' -Encoding UTF8
        Save-Result ([pscustomobject]@{
            workItem = "$lane-committed-then-blocked"; result = 'BLOCKED_OWNER'
            summary = 'Committed the drafted section, then hit an Owner decision.'
            purpose = 'Proves a crash cannot lose the blocker or the wait state.'
            expectedFiles = @($f); proofs = @()
            blockers = @(@{
                category = 'OWNER'
                question = 'Which contract template governs Day-1 support?'
                whyAutomationCannotDecide = 'Contract choice is an Owner decision.'
                blockingScope = 'All remaining lane work.'
                remainingExecutableWork = 'none'
            })
            nextSuggestedItem = 'none'
        })
        exit 0
    }
    'partialnocommit' {
        # PARTIAL, but nothing changed on disk and nothing can proceed.
        Save-Result ([pscustomobject]@{
            workItem = "$lane-partial-empty"; result = 'PARTIAL'
            summary = 'Reports partial progress without changing anything.'
            expectedFiles = @(); proofs = @(); blockers = @()
            nextSuggestedItem = 'none'
        })
        exit 0
    }
    'blockedtaylor' {
        Save-Result ([pscustomobject]@{
            workItem = "$lane-taylor-question"; result = 'BLOCKED_TAYLOR'
            summary = 'Needs a Taylor fact before anything else in this lane can proceed.'
            expectedFiles = @(); proofs = @()
            blockers = @(@{
                category = 'TAYLOR'
                question = 'Which warehouse is the Day-1 receiving location?'
                whyAutomationCannotDecide = 'Only Taylor knows their own operation.'
                blockingScope = 'All remaining lane work.'
                remainingExecutableWork = 'none'
            })
            nextSuggestedItem = 'none'
        })
        exit 0
    }
    default {
        # 'work' and 'workonce': produce one real, owned artifact.
        if ($env:FAKE_CLAUDE_MODE -eq 'workonce' -and $calls -gt 1) {
            Save-Result ([pscustomobject]@{ workItem = "$lane-idle"; result = 'NO_WORK'; summary = 'nothing safe left.'; expectedFiles = @(); proofs = @(); blockers = @(); nextSuggestedItem = 'none' })
            exit 0
        }
        New-Item -ItemType Directory -Force -Path $owned | Out-Null
        # Unique per invocation. Rewriting an identical file produces no diff, and
        # the harness would correctly record NO_WORK -- which would silently make
        # the continuous-mode test measure nothing.
        $f = "$owned/item-$calls-$([guid]::NewGuid().ToString('N').Substring(0,6)).md"
        Set-Content -LiteralPath $f -Value "# $lane item $calls`n`nSandbox artifact." -Encoding UTF8
        Save-Result ([pscustomobject]@{
            workItem = "$lane-0${calls} sandbox bounded item $calls"
            result = 'DONE'
            summary = "Created $f as verifiable lane evidence."
            purpose = 'Proves the harness commits verified lane work.'
            whyGateStillOpen = 'The remaining gate evidence has not been produced yet.'
            expectedFiles = @($f)
            proofs = @('git status --porcelain')
            blockers = @()
            nextSuggestedItem = "$lane next bounded item"
        })
        exit 0
    }
}
'@
    Set-Content -LiteralPath $fakeBehavior -Value $behavior -Encoding UTF8
}

function Invoke-Sandbox {
    <#
        Run the sandboxed orchestrator with a chosen fake-worker scenario and
        return its console output plus the exception, if any.
    #>
    param([string]$Mode = 'work', [int]$ExitCode = 0, [string[]]$ExtraArgs = @(), [string]$Fault = '')
    $env:FAKE_CLAUDE_ARGV = $argvOut
    $env:FAKE_CLAUDE_CALLS = $callsOut
    $env:FAKE_CLAUDE_BEHAVIOR = $fakeBehavior
    $env:FAKE_CLAUDE_MODE = $Mode
    $env:FAKE_CLAUDE_EXIT = "$ExitCode"
    # Crash the supervisor at a named point, so the interruption tests inspect
    # REAL half-written state rather than state a test fabricated and hoped was
    # accurate.
    if ($Fault) { $env:C1_FAULT_INJECT = $Fault }
    else { Remove-Item Env:\C1_FAULT_INJECT -ErrorAction SilentlyContinue }
    if (-not (Test-Path $callsOut)) { New-Item -ItemType File -Force -Path $callsOut | Out-Null }

    $script = Join-Path $harnessDir 'scripts\customer1-automation\run-program.ps1'
    $out = & pwsh -NoProfile -ExecutionPolicy Bypass -File $script -NoReport @ExtraArgs 2>&1
    [pscustomobject]@{ Output = (@($out) | ForEach-Object { "$_" }) -join "`n"; ExitCode = $LASTEXITCODE }
}

function Get-SandboxContext {
    [pscustomobject]@{
        Root = $harnessDir
        Automation = (Join-Path $harnessDir 'docs\customer-1\automation')
        LanesFile = (Join-Path $harnessDir 'docs\customer-1\automation\lanes.json')
        StateFile = (Join-Path $harnessDir 'docs\customer-1\automation\run-state.json')
        BlockersFile = (Join-Path $harnessDir 'docs\customer-1\automation\blockers.json')
        LedgerFile = (Join-Path $harnessDir 'docs\customer-1\CUSTOMER_1_LEDGER.json')
        ReportsDir = (Join-Path $harnessDir 'docs\customer-1\automation\reports')
        LogsDir = (Join-Path $harnessDir 'docs\customer-1\automation\reports\logs')
        ItemsDir = (Join-Path $harnessDir 'docs\customer-1\automation\items')
        PendingFile = (Join-Path $harnessDir 'docs\customer-1\automation\pending-transaction.json')
        RecoveryDir = (Join-Path $harnessDir 'docs\customer-1\automation\reports\recovery')
    }
}

function Reset-FakeCounters { Remove-Item -LiteralPath $argvOut, $callsOut -Force -ErrorAction SilentlyContinue }

function Complete-C1TestRecovery {
    <#
        Do what run-program.ps1 does once recovery returns: persist, then release
        the guard. Recovery deliberately no longer clears the pending transaction
        itself, so a test that calls it directly has to finish the job the same
        way the supervisor does -- otherwise the test is asserting against a state
        the real program never reaches.
    #>
    param([Parameter(Mandatory)]$Recovery, $Context)
    if (-not $Context) { $Context = Get-SandboxContext }
    if ($Recovery.PSObject.Properties['pendingReadyToClear'] -and $Recovery.pendingReadyToClear) {
        Clear-C1PendingTransaction -Context $Context
    }
    $Recovery
}

Write-Host 'CUSTOMER 1 FRAMEWORK REGRESSION SUITE'
Write-Host "sandbox: $sandbox"

try {
    New-Sandbox
    $sbx = Get-SandboxContext

    # ------------------------------------------------------------------------
    Section 'A. Empty-collection unroll (canary fix A)'

    Check '1. Select-UnownedPaths returns a real empty collection, not $null' {
        $r = Select-UnownedPaths -Paths @('docs/customer-1/scope/x.md') -OwnedPatterns @('docs/customer-1/scope/**')
        ($null -ne $r) -and ($r -is [array]) -and ($r.Count -eq 0)
    }
    Check '2. Select-ForbiddenPaths returns a real empty collection, not $null' {
        $r = Select-ForbiddenPaths -Paths @('docs/customer-1/scope/x.md') -ForbiddenPatterns @('firestore.rules')
        ($null -ne $r) -and ($r -is [array]) -and ($r.Count -eq 0)
    }

    # ------------------------------------------------------------------------
    Section 'B. Worker holds no git write permission (canary fix B)'

    $cfg = (Read-JsonFile $sbx.LanesFile).config
    Check '3. config grants the worker no Bash(git add:*)' {
        @($cfg.claudeAllowedTools | Where-Object { $_ -match '(?i)git\s+add' }).Count -eq 0
    }
    Check '4. config grants the worker no Bash(git commit:*)' {
        @($cfg.claudeAllowedTools | Where-Object { $_ -match '(?i)git\s+commit' }).Count -eq 0
    }
    Check '4b. invoke-lane REFUSES to start if a git write permission reappears' {
        $err = $null
        try {
            & (Join-Path $harnessDir 'scripts\customer1-automation\invoke-lane.ps1') `
                -LaneId 'A' -WorktreePath $harnessDir -PromptPath $fakeBehavior -LogDir (Join-Path $sandbox 'lg') `
                -ClaudeExe $fakeExe -AllowedTools @('Bash(git commit:*)') -HeartbeatSec 0
        } catch { $err = $_.Exception.Message }
        $err -and $err -match 'git write permission'
    }

    # ------------------------------------------------------------------------
    Section 'C. First sweep: argv, prompt, stable branch, checkpoint ordering'

    Reset-FakeCounters
    $run1 = Invoke-Sandbox -Mode 'work' -ExitCode 0 -ExtraArgs @('-MaxItems', '2')
    $argv = @(Get-Content -LiteralPath $argvOut -ErrorAction SilentlyContinue)
    $receipts = @(Get-C1ItemReceipts -Context $sbx)

    if ($receipts.Count -eq 0 -or $argv.Count -eq 0) {
        # Without this the whole suite cascades into unrelated failures and the
        # real cause stays hidden -- the exact mistake this framework repair is about.
        Write-Host '  --- first sweep produced no item receipts; raw output follows ---' -ForegroundColor Yellow
        Write-Host $run1.Output
        Write-Host '  --- end raw output ---' -ForegroundColor Yellow
    }

    Check '5. worker prompt never tells Claude to run git add or git commit' {
        $prompts = @(Get-ChildItem -Path $sbx.LogsDir -Recurse -Filter '*.prompt.txt')
        $prompts.Count -gt 0 -and @($prompts | Where-Object {
            $t = Get-Content -LiteralPath $_.FullName -Raw
            ($t -match '(?i)git\s+add') -or ($t -match '(?i)git\s+commit')
        }).Count -eq 0
    }
    Check '5b. worker prompt states the harness owns commits' {
        $p = @(Get-ChildItem -Path $sbx.LogsDir -Recurse -Filter '*.prompt.txt')[0]
        (Get-Content -LiteralPath $p.FullName -Raw) -match 'DO NOT RUN GIT'
    }
    Check '6. an allowed-tool containing spaces arrives as ONE argv token' {
        ($argv -contains 'Bash(git status:*)') -and ($argv -notcontains 'Bash(git') -and ($argv -notcontains 'status:*)')
    }
    Check '6b. --strict-mcp-config is passed to every worker' { $argv -contains '--strict-mcp-config' }
    Check '6c. no --mcp-config is ever passed (zero MCP servers)' { $argv -notcontains '--mcp-config' }

    Check '7. a lane uses ONE stable branch, not a branch per item' {
        $a = @($receipts | Where-Object { $_.laneId -eq 'A' })
        $names = @($a | ForEach-Object { $_.branch } | Select-Object -Unique)
        $names.Count -eq 1 -and $names[0] -eq 'customer1/a-work'
    }
    Check '8. state is checkpointed after item 1 BEFORE item 2 starts' {
        $ordered = @($receipts | Sort-Object startedAt)
        $ordered.Count -ge 2 -and
        ([datetime]$ordered[0].completedAt) -le ([datetime]$ordered[1].startedAt)
    }
    Check '8b. every receipt carries the full durable shape' {
        $r = $receipts[0]
        foreach ($f in @('itemId','runId','passId','laneId','laneName','gates','workItem','branch','mainSha',
                         'headShaBefore','headShaAfter','commitSha','changedPaths','proofCommands','proofResults',
                         'ownedPathCheck','forbiddenPathCheck','reconcileClassification','workerExitCode','result',
                         'blockersRaised','nextSuggestedItem','startedAt','completedAt')) {
            if (-not $r.PSObject.Properties[$f]) { return $false }
        }
        $true
    }
    Check '8c. the harness -- not the worker -- created the commit' {
        $r = @($receipts | Where-Object { $_.commitSha })[0]
        $msg = (Invoke-Git -Directory (Join-Path $lanesDir $r.laneId) -Arguments @('log', '-1', '--format=%B', $r.commitSha)).Output -join "`n"
        $msg -match 'Committed by the harness' -and $msg -match 'C1-Item-Id:'
    }
    Check '9. no pending transaction is left behind after a clean item' {
        -not (Test-Path $sbx.PendingFile)
    }

    # ------------------------------------------------------------------------
    Section 'D. Human-readable progress (Sections 12, 14, 17)'

    Check '18. item-start output names lane, gate, work item and why it matters' {
        ($run1.Output -match 'NOW WORKING') -and ($run1.Output -match 'Customer 1 gate:') -and
        ($run1.Output -match 'C1-') -and ($run1.Output -match 'Work item:') -and ($run1.Output -match 'Why this matters:')
    }
    Check '19. completion output carries verification, commit and what-this-accomplished' {
        ($run1.Output -match 'COMPLETED --') -and ($run1.Output -match 'What this accomplished:') -and
        ($run1.Output -match 'Verification:') -and ($run1.Output -match 'Commit:') -and
        ($run1.Output -match 'Gate status:') -and ($run1.Output -match 'Why it remains open:') -and
        ($run1.Output -match 'Next safe work:')
    }
    Check '20. end-of-pass board is generated from persisted state' {
        $sha = @($receipts | Where-Object { $_.commitSha })[0].commitSha.Substring(0, 8)
        ($run1.Output -match 'CUSTOMER 1 PROGRESS') -and ($run1.Output -match 'VERIFIED COMMITS') -and
        ($run1.Output -match [regex]::Escape($sha)) -and ($run1.Output -match 'WAITING ON PEOPLE') -and
        ($run1.Output -match 'NOT READY / NOT AUTHORIZED')
    }
    Check '20b. run ids and timestamps are NOT the primary console output' {
        # They belong in the diagnostic log, which must exist and hold them.
        $diag = @(Get-ChildItem -Path $sbx.LogsDir -Recurse -Filter 'diagnostic.log')
        $diag.Count -gt 0 -and ((Get-Content -LiteralPath $diag[0].FullName -Raw) -match 'run-\d{8}-\d{6}')
    }

    # ------------------------------------------------------------------------
    Section 'E. Crash recovery (Sections 5, 6)'

    $laneA = @((Read-JsonFile $sbx.LanesFile).lanes | Where-Object { $_.id -eq 'A' })[0]
    $wtA = Join-Path $lanesDir 'A'
    $forbidden = @((Read-JsonFile $sbx.LanesFile).config.forbiddenPaths) + @((Read-JsonFile $sbx.LanesFile).config.harnessOwnedPaths)

    Check '10. interrupted AFTER commit, BEFORE checkpoint: commit recovered, worker NOT rerun' {
        $head = (Invoke-Git -Directory $wtA -Arguments @('rev-parse', 'HEAD')).Output[0]
        $parent = (Invoke-Git -Directory $wtA -Arguments @('rev-parse', 'HEAD^')).Output[0]
        $paths = @(Get-C1CommitPaths -WorktreePath $wtA -FromSha $parent -ToSha $head)
        $itemId = ((Invoke-Git -Directory $wtA -Arguments @('log', '-1', '--format=%B', $head)).Output -join "`n" -split 'C1-Item-Id:')[1].Trim().Split("`n")[0].Trim()

        $rc = New-C1ItemReceipt -RunId 'crashtest' -PassId 1 -Attempt 0 -Lane $laneA -Branch 'customer1/a-work' -ItemId $itemId
        $rc.workItem = 'interrupted item'
        Save-C1PendingTransaction -Context $sbx -Transaction ([pscustomobject]@{
            schemaVersion = 1; itemId = $itemId; runId = 'crashtest'; passId = 1; laneId = 'A'
            branch = 'customer1/a-work'; worktree = $wtA; preCommitHead = $parent
            verifiedChangedPaths = @($paths); expectedPaths = @($paths); verificationResult = 'PASS'
            proofResults = @(); commitMarker = (Get-C1ItemMarker -ItemId $itemId); commitMessage = 'unused'
            itemReceipt = $rc; createdAt = (Get-UtcStamp)
        }) | Out-Null

        $before = @(Get-Content -LiteralPath $callsOut).Count
        $r = Invoke-C1LaneRecovery -Context $sbx -Lane $laneA -WorktreePath $wtA -Branch 'customer1/a-work' -ForbiddenPaths $forbidden
        $r = Complete-C1TestRecovery -Recovery $r -Context $sbx
        $after = @(Get-Content -LiteralPath $callsOut).Count

        ($r.status -eq 'RECOVERED_COMMIT') -and ($before -eq $after) -and
        (Test-Path (Join-Path $sbx.ItemsDir "$itemId.json")) -and (-not (Test-Path $sbx.PendingFile))
    }

    Check '9b. interrupted BEFORE commit with an empty tree: no false completion, retry allowed' {
        $head = (Invoke-Git -Directory $wtA -Arguments @('rev-parse', 'HEAD')).Output[0]
        $rc = New-C1ItemReceipt -RunId 'crashtest2' -PassId 1 -Attempt 0 -Lane $laneA -Branch 'customer1/a-work' -ItemId 'crashtest2-A'
        Save-C1PendingTransaction -Context $sbx -Transaction ([pscustomobject]@{
            schemaVersion = 1; itemId = 'crashtest2-A'; runId = 'crashtest2'; passId = 1; laneId = 'A'
            branch = 'customer1/a-work'; worktree = $wtA; preCommitHead = $head
            verifiedChangedPaths = @('docs/customer-1/scope/never-written.md'); expectedPaths = @()
            verificationResult = 'PASS'; proofResults = @(); commitMarker = (Get-C1ItemMarker -ItemId 'crashtest2-A')
            commitMessage = 'unused'; itemReceipt = $rc; createdAt = (Get-UtcStamp)
        }) | Out-Null

        $r = Invoke-C1LaneRecovery -Context $sbx -Lane $laneA -WorktreePath $wtA -Branch 'customer1/a-work' -ForbiddenPaths $forbidden
        $r = Complete-C1TestRecovery -Recovery $r -Context $sbx
        $newHead = (Invoke-Git -Directory $wtA -Arguments @('rev-parse', 'HEAD')).Output[0]
        ($r.status -eq 'RETRY_NEEDED') -and ($newHead -eq $head) -and
        (-not (Test-Path (Join-Path $sbx.ItemsDir 'crashtest2-A.json'))) -and (-not (Test-Path $sbx.PendingFile))
    }

    Check '9c. interrupted BEFORE commit with verified work present: transaction is completed' {
        $head = (Invoke-Git -Directory $wtA -Arguments @('rev-parse', 'HEAD')).Output[0]
        $rel = 'docs/customer-1/scope/interrupted.md'
        New-Item -ItemType Directory -Force -Path (Join-Path $wtA 'docs/customer-1/scope') | Out-Null
        Set-Content -LiteralPath (Join-Path $wtA $rel) -Value '# interrupted but verified' -Encoding UTF8

        $rc = New-C1ItemReceipt -RunId 'crashtest3' -PassId 1 -Attempt 0 -Lane $laneA -Branch 'customer1/a-work' -ItemId 'crashtest3-A'
        $rc.workItem = 'interrupted-but-verified item'
        Save-C1PendingTransaction -Context $sbx -Transaction ([pscustomobject]@{
            schemaVersion = 1; itemId = 'crashtest3-A'; runId = 'crashtest3'; passId = 1; laneId = 'A'
            branch = 'customer1/a-work'; worktree = $wtA; preCommitHead = $head
            verifiedChangedPaths = @($rel); expectedPaths = @($rel); verificationResult = 'PASS'
            proofResults = @(); commitMarker = (Get-C1ItemMarker -ItemId 'crashtest3-A')
            commitMessage = "docs(customer-1): interrupted-but-verified item`n`n$(Get-C1ItemMarker -ItemId 'crashtest3-A')"
            itemReceipt = $rc; createdAt = (Get-UtcStamp)
        }) | Out-Null

        $r = Invoke-C1LaneRecovery -Context $sbx -Lane $laneA -WorktreePath $wtA -Branch 'customer1/a-work' -ForbiddenPaths $forbidden
        $r = Complete-C1TestRecovery -Recovery $r -Context $sbx
        ($r.status -eq 'COMPLETED_TRANSACTION') -and
        ((Invoke-Git -Directory $wtA -Arguments @('rev-parse', 'HEAD')).Output[0] -ne $head) -and
        (-not (Test-Path $sbx.PendingFile))
    }

    Check '11. interrupted AFTER the final checkpoint: nothing is duplicated' {
        $countBefore = @(Get-C1ItemReceipts -Context $sbx -LaneId 'A').Count
        $r = Invoke-C1LaneRecovery -Context $sbx -Lane $laneA -WorktreePath $wtA -Branch 'customer1/a-work' -ForbiddenPaths $forbidden
        $r = Complete-C1TestRecovery -Recovery $r -Context $sbx
        $countAfter = @(Get-C1ItemReceipts -Context $sbx -LaneId 'A').Count
        ($r.status -eq 'NOTHING_TO_RECOVER') -and ($countBefore -eq $countAfter)
    }

    Check '12. branch ahead of state with deterministic evidence IS recovered' {
        $rel = 'docs/customer-1/scope/ahead.md'
        Set-Content -LiteralPath (Join-Path $wtA $rel) -Value '# committed outside the harness' -Encoding UTF8
        Invoke-Git -Directory $wtA -Arguments @('add', '--', $rel) | Out-Null
        Invoke-Git -Directory $wtA -Arguments @('commit', '-q', '-m', 'lane work with no receipt') | Out-Null
        $head = (Invoke-Git -Directory $wtA -Arguments @('rev-parse', 'HEAD')).Output[0]

        $r = Invoke-C1LaneRecovery -Context $sbx -Lane $laneA -WorktreePath $wtA -Branch 'customer1/a-work' -ForbiddenPaths $forbidden
        $r = Complete-C1TestRecovery -Recovery $r -Context $sbx
        ($r.status -eq 'RECOVERED_BRANCH_AHEAD') -and (-not $r.blocked) -and
        ((Get-C1LastVerifiedSha -Context $sbx -LaneId 'A') -eq $head)
    }

    Check '13. ambiguous branch-ahead does NOT manufacture success' {
        $rel = 'docs/customer-1/commercial/not-lane-a.md'
        New-Item -ItemType Directory -Force -Path (Join-Path $wtA 'docs/customer-1/commercial') | Out-Null
        Set-Content -LiteralPath (Join-Path $wtA $rel) -Value '# outside lane A ownership' -Encoding UTF8
        Invoke-Git -Directory $wtA -Arguments @('add', '--', $rel) | Out-Null
        Invoke-Git -Directory $wtA -Arguments @('commit', '-q', '-m', 'unowned change with convincing prose') | Out-Null
        $head = (Invoke-Git -Directory $wtA -Arguments @('rev-parse', 'HEAD')).Output[0]

        $r = Invoke-C1LaneRecovery -Context $sbx -Lane $laneA -WorktreePath $wtA -Branch 'customer1/a-work' -ForbiddenPaths $forbidden
        $r = Complete-C1TestRecovery -Recovery $r -Context $sbx
        ($r.status -eq 'FAILED_RECOVERY') -and $r.blocked -and
        # the branch is preserved, not reset
        ((Invoke-Git -Directory $wtA -Arguments @('rev-parse', 'HEAD')).Output[0] -eq $head)
    }

    Check '13b. persisted state ahead of the branch stops the lane, resets nothing' {
        $wtB = Join-Path $lanesDir 'B'
        $laneB = @((Read-JsonFile $sbx.LanesFile).lanes | Where-Object { $_.id -eq 'B' })[0]
        $head = (Invoke-Git -Directory $wtB -Arguments @('rev-parse', 'HEAD')).Output[0]
        # A receipt claiming a head that is not on this branch at all.
        $rc = New-C1ItemReceipt -RunId 'divergetest' -PassId 9 -Attempt 0 -Lane $laneB -Branch 'customer1/b-work' -ItemId 'divergetest-B'
        $rc.headShaAfter = '0123456789012345678901234567890123456789'
        $rc.result = 'DONE'; $rc.completedAt = Get-UtcStamp
        Save-C1ItemReceipt -Context $sbx -Receipt $rc | Out-Null

        $r = Invoke-C1LaneRecovery -Context $sbx -Lane $laneB -WorktreePath $wtB -Branch 'customer1/b-work' -ForbiddenPaths $forbidden
        $r = Complete-C1TestRecovery -Recovery $r -Context $sbx
        $ok = ($r.status -eq 'FAILED_RECOVERY') -and $r.blocked -and
              ((Invoke-Git -Directory $wtB -Arguments @('rev-parse', 'HEAD')).Output[0] -eq $head)
        Remove-Item -LiteralPath (Join-Path $sbx.ItemsDir 'divergetest-B.json') -Force
        $ok
    }

    # ------------------------------------------------------------------------
    Section 'F. Retry policy (Section 10)'

    # Lane A is now blocked by the ambiguous-recovery fixture above, which is
    # itself the correct behaviour. Restore it so the retry tests can run.
    Invoke-Git -Directory $wtA -Arguments @('reset', '--hard', 'HEAD~1') | Out-Null

    Reset-FakeCounters
    $crash = Invoke-Sandbox -Mode 'crash' -ExitCode 1 -ExtraArgs @('-MaxItems', '1', '-LaneId', 'A', '-MaxTransientRetries', '2')
    $crashCalls = @(Get-Content -LiteralPath $callsOut -ErrorAction SilentlyContinue).Count

    Check '14. a transient worker failure retries exactly to the configured maximum' {
        # initial attempt + 2 retries = 3 sessions, never more.
        $crashCalls -eq 3
    }
    Check '21. non-timestamped worker stderr survives to the console AND the durable log' {
        $diag = @(Get-ChildItem -Path $sbx.LogsDir -Recurse -Filter 'diagnostic.log' | Sort-Object LastWriteTime -Descending)
        $inLog = @($diag | Where-Object { (Get-Content -LiteralPath $_.FullName -Raw) -match 'FATAL: fake worker exploded' }).Count -gt 0
        $inConsole = $crash.Output -match 'FATAL: fake worker exploded'
        $inLog -and $inConsole
    }
    Check '21b. failure output states whether work was committed and state advanced' {
        ($crash.Output -match 'FAILURE') -and ($crash.Output -match 'Verified work committed:') -and
        ($crash.Output -match 'Persistent state advanced:') -and ($crash.Output -match 'Recovery status:')
    }

    Reset-FakeCounters
    $forbid = Invoke-Sandbox -Mode 'forbidden' -ExitCode 0 -ExtraArgs @('-MaxItems', '1', '-LaneId', 'B')
    $forbidCalls = @(Get-Content -LiteralPath $callsOut -ErrorAction SilentlyContinue).Count

    Check '15. a governed-path violation is NEVER retried' {
        $forbidCalls -eq 1
    }
    Check '15b. a governed-path violation halts the run instead of committing' {
        $wtB = Join-Path $lanesDir 'B'
        $stillDirty = @(Get-C1DirtyPaths -WorktreePath $wtB) -contains 'firestore.rules'
        ($forbid.Output -match 'security boundary violation') -and $stillDirty
    }

    # Leave no forbidden fixture behind for later checks.
    Remove-Item -LiteralPath (Join-Path $lanesDir 'B\firestore.rules') -Force -ErrorAction SilentlyContinue

    # ------------------------------------------------------------------------
    Section 'G. Continuous mode and safe-work exhaustion (Sections 8, 9)'

    Reset-FakeCounters
    # Reset lane state so both lanes are executable again for the continuous run.
    $ld = Read-JsonFile $sbx.LanesFile
    foreach ($l in $ld.lanes) { $l.state = 'READY' }
    Write-JsonFile $sbx.LanesFile $ld

    $cont = Invoke-Sandbox -Mode 'workonce' -ExitCode 0 -ExtraArgs @('-UntilExhausted', '-MaxPasses', '6')
    $state = Read-JsonFile $sbx.StateFile
    $lastRun = @($state.runs)[-1]

    Check '16. -UntilExhausted repeats passes while verified progress exists' {
        $lastRun.passes -ge 2
    }
    Check '17. -UntilExhausted stops on genuine no-progress exhaustion, not a pass count' {
        $lastRun.exhausted -eq $true -and $lastRun.passes -lt 6
    }
    Check '17b. exhaustion prints the final report and refuses to imply readiness' {
        ($cont.Output -match 'SAFE AUTOMATED CUSTOMER 1 WORK EXHAUSTED') -and
        ($cont.Output -match 'PRODUCTION ACTIONS') -and ($cont.Output -match 'PRODUCTION AUTHORIZED') -and
        ($cont.Output -match 'It does not mean production ready')
    }
    Check '17c. continuous mode needs no cycle.sh, nohup, tail or grep' {
        # Match executable code only. The header comment legitimately NAMES the
        # external loop this replaces; mentioning it is not depending on it.
        # Block comments first: stripping '#'-prefixed lines would eat the '#>'
        # terminator and leave the whole header behind.
        $code = (Get-Content -LiteralPath (Join-Path $here 'run-program.ps1') -Raw) -replace '(?s)<#.*?#>', ''
        $code = @($code -split "`r?`n" | Where-Object { $_ -notmatch '^\s*#' }) -join "`n"
        $declaresSwitch = $code -match '\[switch\]\$UntilExhausted'
        $noShellLoop = ($code -notmatch 'cycle\.sh') -and ($code -notmatch 'nohup') -and
                       ($code -notmatch '\bbash\b') -and ($code -notmatch '\bStart-Process\b')
        $noShellScripts = @(Get-ChildItem -Path $here -Filter '*.sh' -ErrorAction SilentlyContinue).Count -eq 0
        $declaresSwitch -and $noShellLoop -and $noShellScripts
    }

    # ------------------------------------------------------------------------
    Section 'H. DryRun is inert (Section 22)'

    $before = @{
        lanes = (Get-FileHash $sbx.LanesFile).Hash
        state = (Get-FileHash $sbx.StateFile).Hash
        blockers = (Get-FileHash $sbx.BlockersFile).Hash
        items = @(Get-ChildItem -Path $sbx.ItemsDir -Filter '*.json' -ErrorAction SilentlyContinue).Count
        headA = (Invoke-Git -Directory $wtA -Arguments @('rev-parse', 'HEAD')).Output[0]
    }
    Reset-FakeCounters
    $dry = Invoke-Sandbox -Mode 'work' -ExitCode 0 -ExtraArgs @('-DryRun')
    $dryCalls = @(Get-Content -LiteralPath $callsOut -ErrorAction SilentlyContinue).Count

    Check '22. DryRun starts zero Claude workers' { $dryCalls -eq 0 }
    Check '22b. DryRun makes zero commits' {
        (Invoke-Git -Directory $wtA -Arguments @('rev-parse', 'HEAD')).Output[0] -eq $before.headA
    }
    Check '22c. DryRun writes zero persistent state' {
        ((Get-FileHash $sbx.LanesFile).Hash -eq $before.lanes) -and
        ((Get-FileHash $sbx.StateFile).Hash -eq $before.state) -and
        ((Get-FileHash $sbx.BlockersFile).Hash -eq $before.blockers) -and
        (@(Get-ChildItem -Path $sbx.ItemsDir -Filter '*.json' -ErrorAction SilentlyContinue).Count -eq $before.items)
    }
    Check '22d. DryRun performs zero production actions' {
        $lastState = Read-JsonFile $sbx.StateFile
        @(@($lastState.runs) | ForEach-Object { @($_.productionActions) } | Where-Object { $_ }).Count -eq 0
    }

    # ------------------------------------------------------------------------

    # ------------------------------------------------------------------------
    Section 'J. A failed worker can never reach the commit path (review 2)'

    function Reset-SandboxLanes {
        # Both lanes selectable again, and no leftover dirt from a prior fixture.
        $d = Read-JsonFile $sbx.LanesFile
        foreach ($l in $d.lanes) { $l.state = 'READY'; $l.lastResult = $null; $l.lastRun = $null }
        Write-JsonFile $sbx.LanesFile $d
        foreach ($id in @('A', 'B')) {
            $w = Join-Path $lanesDir $id
            if (Test-Path $w) { Invoke-Git -Directory $w -AllowFail -Arguments @('clean', '-fdq') | Out-Null }
        }
    }

    function Get-LaneHead { param($Id) (Invoke-Git -Directory (Join-Path $lanesDir $Id) -Arguments @('rev-parse', 'HEAD')).Output[0] }

    Reset-SandboxLanes
    $headA = Get-LaneHead 'A'
    Reset-FakeCounters
    $die = Invoke-Sandbox -Mode 'editthendie' -ExitCode 1 -ExtraArgs @('-MaxItems', '1', '-LaneId', 'A', '-MaxTransientRetries', '2')

    Check 'R2-2A. worker edits an owned file then exits nonzero with no receipt -> ZERO commit' {
        (Get-LaneHead 'A') -eq $headA
    }
    Check 'R2-3. a dirty transient failure starts exactly ONE worker and preserves the file' {
        $calls = @(Get-Content -LiteralPath $callsOut -ErrorAction SilentlyContinue).Count
        $preserved = @(Get-C1DirtyPaths -WorktreePath (Join-Path $lanesDir 'A')) -contains 'docs/customer-1/scope/half-written.md'
        $calls -eq 1 -and $preserved
    }
    Check 'R2-3b. the dirty failed lane is marked FAILED_RECOVERY, not retried' {
        $l = @((Read-JsonFile $sbx.LanesFile).lanes | Where-Object { $_.id -eq 'A' })[0]
        $l.state -eq 'FAILED_RECOVERY'
    }

    Reset-SandboxLanes
    $headA = Get-LaneHead 'A'
    Reset-FakeCounters
    $mal = Invoke-Sandbox -Mode 'editthenmalformed' -ExitCode 0 -ExtraArgs @('-MaxItems', '1', '-LaneId', 'A')

    Check 'R2-2B. malformed result JSON with exit 0 -> ZERO commit' {
        (Get-LaneHead 'A') -eq $headA
    }

    Reset-SandboxLanes
    $headA = Get-LaneHead 'A'
    Reset-FakeCounters
    $vnz = Invoke-Sandbox -Mode 'editvalidthennonzero' -ExitCode 3 -ExtraArgs @('-MaxItems', '1', '-LaneId', 'A')

    Check 'R2-2C. valid work and valid receipt but nonzero exit -> ZERO commit' {
        (Get-LaneHead 'A') -eq $headA
    }
    Check 'R2-2D. no pending transaction is ever written for a failed session' {
        -not (Test-Path $sbx.PendingFile)
    }

    # ------------------------------------------------------------------------
    Section 'K. Unexpected dirty branch (review 2 item 1)'

    Reset-SandboxLanes
    $wtA2 = Join-Path $lanesDir 'A'
    $headA = Get-LaneHead 'A'
    Invoke-Git -Directory $wtA2 -Arguments @('checkout', '-q', '-B', 'customer1/a-stray') | Out-Null
    Set-Content -LiteralPath (Join-Path $wtA2 'docs/customer-1/scope/stray.md') -Value '# uncommitted on a stray branch' -Encoding UTF8
    $strayHead = (Invoke-Git -Directory $wtA2 -Arguments @('rev-parse', 'HEAD')).Output[0]
    Reset-FakeCounters
    $stray = Invoke-Sandbox -Mode 'work' -ExitCode 0 -ExtraArgs @('-MaxItems', '1', '-LaneId', 'A')

    Check 'R2-1. an unexpected dirty branch produces ZERO commits and starts ZERO workers' {
        $calls = @(Get-Content -LiteralPath $callsOut -ErrorAction SilentlyContinue).Count
        $nowHead = (Invoke-Git -Directory $wtA2 -Arguments @('rev-parse', 'HEAD')).Output[0]
        $branchNow = (Invoke-Git -Directory $wtA2 -Arguments @('branch', '--show-current')).Output -join ''
        $stillDirty = @(Get-C1DirtyPaths -WorktreePath $wtA2) -contains 'docs/customer-1/scope/stray.md'
        $calls -eq 0 -and $nowHead -eq $strayHead -and $branchNow -eq 'customer1/a-stray' -and $stillDirty
    }
    Check 'R2-1b. the lane is stopped as FAILED_RECOVERY with an explanatory blocker' {
        $l = @((Read-JsonFile $sbx.LanesFile).lanes | Where-Object { $_.id -eq 'A' })[0]
        $b = @((Read-JsonFile $sbx.BlockersFile).blockers | Where-Object { $_.status -eq 'OPEN' -and $_.question -match 'unexpected branch' })
        $l.state -eq 'FAILED_RECOVERY' -and $b.Count -gt 0
    }

    # Put lane A back on its stable branch for the remaining checks.
    Invoke-Git -Directory $wtA2 -AllowFail -Arguments @('checkout', '-q', '--', '.') | Out-Null
    Invoke-Git -Directory $wtA2 -AllowFail -Arguments @('clean', '-fdq') | Out-Null
    Invoke-Git -Directory $wtA2 -Arguments @('checkout', '-q', 'customer1/a-work') | Out-Null
    Invoke-Git -Directory $wtA2 -AllowFail -Arguments @('branch', '-D', 'customer1/a-stray') | Out-Null

    # ------------------------------------------------------------------------
    Section 'L. Terminal lane states are not selectable (review 2 item 4)'

    Check 'R2-4A. a FAILED_RECOVERY lane is not executable' {
        $d = Read-JsonFile $sbx.LanesFile
        $l = @($d.lanes | Where-Object { $_.id -eq 'A' })[0]
        $l.state = 'FAILED_RECOVERY'
        -not (Test-LaneExecutable -Lane $l -AllLanes $d.lanes)
    }
    Check 'R2-4B. a RETRY_EXHAUSTED lane is not executable' {
        $d = Read-JsonFile $sbx.LanesFile
        $l = @($d.lanes | Where-Object { $_.id -eq 'A' })[0]
        $l.state = 'RETRY_EXHAUSTED'
        -not (Test-LaneExecutable -Lane $l -AllLanes $d.lanes)
    }
    Check 'R2-4C. BLOCKED_PARTIAL stays executable -- it may still have safe work' {
        $d = Read-JsonFile $sbx.LanesFile
        $l = @($d.lanes | Where-Object { $_.id -eq 'A' })[0]
        $l.state = 'BLOCKED_PARTIAL'
        Test-LaneExecutable -Lane $l -AllLanes $d.lanes
    }
    Check 'R2-4D. a FAILED_RECOVERY lane is not selected on the next pass' {
        $d = Read-JsonFile $sbx.LanesFile
        foreach ($l in $d.lanes) { $l.state = if ($l.id -eq 'A') { 'FAILED_RECOVERY' } else { 'READY' } }
        Write-JsonFile $sbx.LanesFile $d
        Reset-FakeCounters
        Invoke-Sandbox -Mode 'nowork' -ExitCode 0 -ExtraArgs @('-MaxItems', '2') | Out-Null
        # Only lane B may have been asked.
        @(Get-Content -LiteralPath $callsOut -ErrorAction SilentlyContinue | Where-Object { $_ -like 'A *' }).Count -eq 0
    }

    # ------------------------------------------------------------------------
    Section 'M. Safe-work exhaustion semantics (review 2 item 5)'

    Reset-SandboxLanes
    Reset-FakeCounters
    $own = Invoke-Sandbox -Mode 'blockedowner' -ExitCode 0 -ExtraArgs @('-UntilExhausted', '-MaxPasses', '5')
    $ownRun = @((Read-JsonFile $sbx.StateFile).runs)[-1]

    Check 'R2-5A. only Owner blockers -> EXHAUSTED (a blocker is not executable work)' {
        $ownRun.exhausted -eq $true -and $ownRun.passes -lt 5
    }
    Check 'R2-6A. a lane blocked on the Owner with no safe work waits for the Owner' {
        $l = @((Read-JsonFile $sbx.LanesFile).lanes | Where-Object { $_.lastResult -eq 'BLOCKED_OWNER' })
        $l.Count -gt 0 -and @($l | Where-Object { $_.state -eq 'WAITING_FOR_OWNER' }).Count -eq $l.Count
    }

    Reset-SandboxLanes
    Reset-FakeCounters
    $tay = Invoke-Sandbox -Mode 'blockedtaylor' -ExitCode 0 -ExtraArgs @('-UntilExhausted', '-MaxPasses', '5')
    $tayRun = @((Read-JsonFile $sbx.StateFile).runs)[-1]

    Check 'R2-5B. only Taylor blockers -> EXHAUSTED' { $tayRun.exhausted -eq $true }
    Check 'R2-6B. a lane blocked on Taylor with no safe work waits for Taylor' {
        @((Read-JsonFile $sbx.LanesFile).lanes | Where-Object { $_.state -eq 'WAITING_FOR_TAYLOR' }).Count -gt 0
    }
    Check 'R2-10. an identical blocker is not duplicated across passes' {
        $open = @((Read-JsonFile $sbx.BlockersFile).blockers |
            Where-Object { $_.status -eq 'OPEN' -and $_.question -match 'Day-1 receiving location' })
        # One fingerprint per lane, however many passes asked it.
        $lanes = @($open | ForEach-Object { $_.lane } | Select-Object -Unique)
        $open.Count -eq $lanes.Count -and $open.Count -gt 0
    }
    Check 'R2-10b. a repeated blocker is announced to the operator only once' {
        # Count the BLOCKED announcement blocks, not every mention of the question
        # text -- the end-of-run report legitimately lists it again under
        # "WAITING ON TAYLOR". One announcement per distinct blocker, however many
        # passes re-asked it.
        $announcements = ([regex]::Matches($tay.Output, 'Cannot decide:')).Count
        $distinct = @((Read-JsonFile $sbx.BlockersFile).blockers |
            Where-Object { $_.status -eq 'OPEN' -and $_.question -match 'Day-1 receiving location' }).Count
        $distinct -gt 0 -and $announcements -eq $distinct
    }

    Check 'R2-5C. a retry-exhausted lane counts as exhausted, not as pending work' {
        $d = Read-JsonFile $sbx.LanesFile
        foreach ($l in $d.lanes) { $l.state = 'RETRY_EXHAUSTED'; $l.lastResult = 'FAILED_TECHNICAL' }
        Write-JsonFile $sbx.LanesFile $d
        Reset-FakeCounters
        Invoke-Sandbox -Mode 'nowork' -ExitCode 0 -ExtraArgs @('-UntilExhausted', '-MaxPasses', '4') | Out-Null
        $r = @((Read-JsonFile $sbx.StateFile).runs)[-1]
        $calls = @(Get-Content -LiteralPath $callsOut -ErrorAction SilentlyContinue).Count
        $r.exhausted -eq $true -and $calls -eq 0
    }
    Check 'R2-5D. one real next safe item -> NOT exhausted on that pass' {
        Reset-SandboxLanes
        Reset-FakeCounters
        Invoke-Sandbox -Mode 'workonce' -ExitCode 0 -ExtraArgs @('-UntilExhausted', '-MaxPasses', '6') | Out-Null
        $r = @((Read-JsonFile $sbx.StateFile).runs)[-1]
        # A pass that committed real work cannot be the exhausting pass, so
        # reaching exhaustion must have taken more than one pass.
        $r.passes -ge 2 -and $r.exhausted -eq $true
    }

    # ------------------------------------------------------------------------
    Section 'N. Recovery evidence and fail-closed (review 2 items 7, 8)'

    Check 'R2-7. an unreadable pending transaction FAILS CLOSED and selects no work' {
        Reset-SandboxLanes
        Set-Content -LiteralPath $sbx.PendingFile -Value '{ "itemId": "truncated' -Encoding UTF8
        Reset-FakeCounters
        $r = Invoke-Sandbox -Mode 'work' -ExitCode 0 -ExtraArgs @('-MaxItems', '2')
        $calls = @(Get-Content -LiteralPath $callsOut -ErrorAction SilentlyContinue).Count
        $stillThere = Test-Path $sbx.PendingFile
        $named = $r.Output -match 'pending-transaction\.json'
        $ok = $calls -eq 0 -and $stillThere -and $named -and ($r.Output -match 'FAILURE')
        Remove-Item -LiteralPath $sbx.PendingFile -Force
        $ok
    }

    Check 'R2-8. failed recovery ARCHIVES the pending transaction instead of deleting it' {
        $laneA2 = @((Read-JsonFile $sbx.LanesFile).lanes | Where-Object { $_.id -eq 'A' })[0]
        $wt = Join-Path $lanesDir 'A'
        $head = (Invoke-Git -Directory $wt -Arguments @('rev-parse', 'HEAD')).Output[0]
        $rc = New-C1ItemReceipt -RunId 'evidence' -PassId 1 -Attempt 0 -Lane $laneA2 -Branch 'customer1/a-work' -ItemId 'evidence-A'
        Save-C1PendingTransaction -Context $sbx -Transaction ([pscustomobject]@{
            schemaVersion = 1; itemId = 'evidence-A'; runId = 'evidence'; passId = 1; laneId = 'A'
            branch = 'customer1/a-work'; worktree = $wt; preCommitHead = $head
            # Drift: the transaction expects a file that is not there.
            verifiedChangedPaths = @('docs/customer-1/scope/expected-but-absent.md')
            expectedPaths = @(); verificationResult = 'PASS'; proofResults = @()
            commitMarker = (Get-C1ItemMarker -ItemId 'evidence-A'); commitMessage = 'unused'
            itemReceipt = $rc; createdAt = (Get-UtcStamp)
        }) | Out-Null
        Set-Content -LiteralPath (Join-Path $wt 'docs/customer-1/scope/something-else.md') -Value '# drift' -Encoding UTF8

        $r = Invoke-C1LaneRecovery -Context $sbx -Lane $laneA2 -WorktreePath $wt -Branch 'customer1/a-work' -ForbiddenPaths $forbidden
        $r = Complete-C1TestRecovery -Recovery $r -Context $sbx
        $archived = @(Get-ChildItem -Path $sbx.RecoveryDir -Filter 'pending-failed-*evidence-A.json' -ErrorAction SilentlyContinue)
        $ok = ($r.status -eq 'FAILED_RECOVERY') -and $r.blocked -and
              ($archived.Count -eq 1) -and (-not (Test-Path $sbx.PendingFile)) -and
              ($r.message -match 'Evidence preserved at')
        Invoke-Git -Directory $wt -AllowFail -Arguments @('clean', '-fdq') | Out-Null
        $ok
    }

    # ------------------------------------------------------------------------
    Section 'O. Legacy pre-receipt bootstrap (review 2 item 9)'

    Check 'R2-9. pre-receipt lane work is reconstructed and reaches the next worker prompt' {
        # A lane branch with real commits, an old-style run-state record, and no
        # items/*.json receipts at all -- the exact state this framework inherits.
        $wt = Join-Path $lanesDir 'B'
        $laneB2 = @((Read-JsonFile $sbx.LanesFile).lanes | Where-Object { $_.id -eq 'B' })[0]

        Set-Content -LiteralPath (Join-Path $wt 'docs/customer-1/data/legacy-census.md') -Value '# built by the previous runner' -Encoding UTF8
        Invoke-Git -Directory $wt -Arguments @('add', '--', 'docs/customer-1/data/legacy-census.md') | Out-Null
        Invoke-Git -Directory $wt -Arguments @('commit', '-q', '-m', 'docs(customer-1): B-01 Source census instrument') | Out-Null
        $legacySha = (Invoke-Git -Directory $wt -Arguments @('rev-parse', 'HEAD')).Output[0]

        # Erase every receipt for lane B so the lane genuinely looks pre-receipt.
        Get-ChildItem -Path $sbx.ItemsDir -Filter '*.json' | ForEach-Object {
            $j = Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json
            if ($j.laneId -eq 'B') { Remove-Item -LiteralPath $_.FullName -Force }
        }

        $state = Read-JsonFile $sbx.StateFile
        $state.runs = @($state.runs) + [pscustomobject]@{
            runId = 'legacy-run-1'
            items = @([pscustomobject]@{
                laneId = 'B'; workItem = 'B-01 Source census instrument for C1-DATA-01'
                result = 'DONE'; headShaAfter = $legacySha
                changedPaths = @('docs/customer-1/data/legacy-census.md'); branch = 'customer1/b-work'
            })
        }
        Write-JsonFile $sbx.StateFile $state

        $boot = Invoke-C1LegacyBootstrap -Context $sbx -Lane $laneB2 -WorktreePath $wt `
            -Branch 'customer1/b-work' -StateDoc (Read-JsonFile $sbx.StateFile) -ForbiddenPaths $forbidden

        $rec = @(Get-C1ItemReceipts -Context $sbx -LaneId 'B')
        $titled = @($rec | Where-Object { $_.workItem -match 'Source census instrument' })
        $hist = Get-C1CompletedWorkSummary -Context $sbx -LaneId 'B'

        ($boot.status -eq 'BOOTSTRAPPED') -and ($titled.Count -gt 0) -and
        (@($titled | Where-Object { $_.recovered -eq 'LEGACY_PRE_RECEIPT' }).Count -eq $titled.Count) -and
        # Reconstructed work is RECOVERED, never DONE: it never closes a gate.
        (@($rec | Where-Object { $_.recovered -eq 'LEGACY_PRE_RECEIPT' -and $_.result -eq 'DONE' }).Count -eq 0) -and
        (@($hist.completedTitles) -join ' ') -match 'Source census instrument'
    }

    Check 'R2-9b. the recovered legacy title actually reaches the worker prompt' {
        Reset-SandboxLanes
        Reset-FakeCounters
        Invoke-Sandbox -Mode 'nowork' -ExitCode 0 -ExtraArgs @('-MaxItems', '2', '-LaneId', 'B') | Out-Null
        $prompts = @(Get-ChildItem -Path $sbx.LogsDir -Recurse -Filter '*.prompt.txt' | Sort-Object LastWriteTime -Descending)
        $prompts.Count -gt 0 -and
        ((Get-Content -LiteralPath $prompts[0].FullName -Raw) -match 'ALREADY COMPLETED BY THIS LANE') -and
        ((Get-Content -LiteralPath $prompts[0].FullName -Raw) -match 'Source census instrument')
    }
    Check 'R2-9c. bootstrap changes no gate status in the ledger' {
        $before = (Get-FileHash $sbx.LedgerFile).Hash
        $laneB2 = @((Read-JsonFile $sbx.LanesFile).lanes | Where-Object { $_.id -eq 'B' })[0]
        Invoke-C1LegacyBootstrap -Context $sbx -Lane $laneB2 -WorktreePath (Join-Path $lanesDir 'B') `
            -Branch 'customer1/b-work' -StateDoc (Read-JsonFile $sbx.StateFile) -ForbiddenPaths $forbidden | Out-Null
        (Get-FileHash $sbx.LedgerFile).Hash -eq $before
    }

    # ------------------------------------------------------------------------
    Section 'P. Heartbeat makes no premature safety claim (review 2 item 11)'

    Check 'R2-11. the heartbeat never claims a safety check passed before it ran' {
        $src = Get-Content -LiteralPath (Join-Path $here 'progress.ps1') -Raw
        ($src -notmatch 'No safety/governance issue detected') -and
        ($src -match 'Safety/governance verification runs before any commit')
    }

    # ------------------------------------------------------------------------
    Section 'Q. NO_WORK / FAILED_TECHNICAL may never commit (review 3 item 1)'

    Reset-SandboxLanes
    $headA = Get-LaneHead 'A'
    Reset-FakeCounters
    $nwd = Invoke-Sandbox -Mode 'noworkdirty' -ExitCode 0 -ExtraArgs @('-MaxItems', '1', '-LaneId', 'A')

    Check 'R3-1A. NO_WORK with an owned dirty file -> ZERO commit, file preserved, lane stopped' {
        $noCommit = (Get-LaneHead 'A') -eq $headA
        $preserved = @(Get-C1DirtyPaths -WorktreePath (Join-Path $lanesDir 'A')) -contains 'docs/customer-1/scope/nowork-but-dirty.md'
        $l = @((Read-JsonFile $sbx.LanesFile).lanes | Where-Object { $_.id -eq 'A' })[0]
        $noCommit -and $preserved -and $l.state -eq 'FAILED_RECOVERY'
    }
    Check 'R3-1A2. the NO_WORK-with-dirty-tree contradiction is not retried' {
        @(Get-Content -LiteralPath $callsOut -ErrorAction SilentlyContinue).Count -eq 1
    }

    Reset-SandboxLanes
    $headA = Get-LaneHead 'A'
    Reset-FakeCounters
    $ftd = Invoke-Sandbox -Mode 'failedtechdirty' -ExitCode 0 -ExtraArgs @('-MaxItems', '1', '-LaneId', 'A')

    Check 'R3-1B. FAILED_TECHNICAL with an owned dirty file -> ZERO commit, file preserved' {
        $noCommit = (Get-LaneHead 'A') -eq $headA
        $preserved = @(Get-C1DirtyPaths -WorktreePath (Join-Path $lanesDir 'A')) -contains 'docs/customer-1/scope/failedtech-but-dirty.md'
        $l = @((Read-JsonFile $sbx.LanesFile).lanes | Where-Object { $_.id -eq 'A' })[0]
        $noCommit -and $preserved -and $l.state -eq 'FAILED_RECOVERY' -and
        @(Get-Content -LiteralPath $callsOut -ErrorAction SilentlyContinue).Count -eq 1
    }

    Reset-SandboxLanes
    $headA = Get-LaneHead 'A'
    Reset-FakeCounters
    $cnw = Invoke-Sandbox -Mode 'nowork' -ExitCode 0 -ExtraArgs @('-MaxItems', '1', '-LaneId', 'A')

    Check 'R3-1C. a CLEAN NO_WORK is the ordinary no-work outcome, not a failure' {
        $l = @((Read-JsonFile $sbx.LanesFile).lanes | Where-Object { $_.id -eq 'A' })[0]
        (Get-LaneHead 'A') -eq $headA -and $l.state -eq 'IDLE' -and $l.lastResult -eq 'NO_WORK' -and
        (-not (Test-Path $sbx.PendingFile))
    }

    Check 'R3-1D. NO_WORK and FAILED_TECHNICAL are absent from the committable set' {
        $code = Get-Content -LiteralPath (Join-Path $here 'run-program.ps1') -Raw
        # The eligibility list is the gate; assert it literally excludes both.
        ($code -match "committableResults = @\('DONE', 'PARTIAL', 'BLOCKED_OWNER'") -and
        ($code -match "neverCommitResults = @\('NO_WORK', 'FAILED_TECHNICAL'\)") -and
        ($code -match '\$claimedResult -in \$committableResults')
    }

    # ------------------------------------------------------------------------
    Section 'R. remainingExecutableWork controls blocked execution (review 3 item 2)'

    Check 'R3-2A. nextSuggestedItem alone does NOT make a blocked lane executable' {
        # remainingExecutableWork = "none", but nextSuggestedItem names post-decision work.
        $claim = [pscustomobject]@{
            result = 'BLOCKED_OWNER'
            blockers = @([pscustomobject]@{ category = 'OWNER'; remainingExecutableWork = 'none' })
            nextSuggestedItem = 'Update the matrix after Owner chooses Day-1 scope'
        }
        -not (Test-C1HasRemainingWork -Claim $claim)
    }
    Check 'R3-2B. a blocker naming real parallel work DOES keep the lane executable' {
        $claim = [pscustomobject]@{
            result = 'BLOCKED_OWNER'
            blockers = @([pscustomobject]@{ category = 'OWNER'; remainingExecutableWork = 'The exclusions appendix can still be drafted.' })
            nextSuggestedItem = 'none'
        }
        Test-C1HasRemainingWork -Claim $claim
    }
    Check 'R3-2C. negative phrasings all normalize to "no remaining work"' {
        $negatives = @('none', 'None.', 'nothing', 'n/a', 'N/A', '', '  ', 'no safe work remains',
                       'Waiting for the Owner', 'nothing further', 'None identified', 'not applicable',
                       'No remaining work in this lane')
        $bad = @($negatives | Where-Object {
            Test-C1HasRemainingWork -Claim ([pscustomobject]@{
                blockers = @([pscustomobject]@{ category = 'OWNER'; remainingExecutableWork = $_ })
            })
        })
        $bad.Count -eq 0
    }
    Check 'R3-2D. Test-C1HasRemainingWork never reads nextSuggestedItem' {
        $code = Get-Content -LiteralPath (Join-Path $here '_common.ps1') -Raw
        $fn = [regex]::Match($code, '(?s)function Test-C1HasRemainingWork \{.*?\n\}').Value
        $fn -and ($fn -notmatch "PSObject\.Properties\['nextSuggestedItem'\]") -and ($fn -match 'remainingExecutableWork')
    }

    Reset-SandboxLanes
    Reset-FakeCounters
    $nxt = Invoke-Sandbox -Mode 'blockednextonly' -ExitCode 0 -ExtraArgs @('-UntilExhausted', '-MaxPasses', '5')
    $nxtRun = @((Read-JsonFile $sbx.StateFile).runs)[-1]
    $nxtCalls = @(Get-Content -LiteralPath $callsOut -ErrorAction SilentlyContinue).Count

    Check 'R3-2E. BLOCKED_OWNER + "none" + a post-decision nextSuggestedItem -> WAITING_FOR_OWNER' {
        @((Read-JsonFile $sbx.LanesFile).lanes | Where-Object { $_.state -eq 'WAITING_FOR_OWNER' }).Count -gt 0
    }
    Check 'R3-2F. that lane gets ZERO further worker sessions on the next pass' {
        # Two lanes, one session each on pass 1, then nothing.
        $nxtCalls -eq 2
    }
    Check 'R3-2G. and it is eligible for safe-work exhaustion' {
        $nxtRun.exhausted -eq $true -and $nxtRun.passes -lt 5
    }

    # ------------------------------------------------------------------------
    Section 'S. A zero-commit PARTIAL is not endless progress (review 3 item 3)'

    Reset-SandboxLanes
    Reset-FakeCounters
    $pnc = Invoke-Sandbox -Mode 'partialnocommit' -ExitCode 0 -ExtraArgs @('-UntilExhausted', '-MaxPasses', '6')
    $pncRun = @((Read-JsonFile $sbx.StateFile).runs)[-1]
    $pncCalls = @(Get-Content -LiteralPath $callsOut -ErrorAction SilentlyContinue).Count

    Check 'R3-3A. PARTIAL with zero commit and no remaining work still reaches SAFE_WORK_EXHAUSTED' {
        $pncRun.exhausted -eq $true -and $pncRun.passes -lt 6
    }
    Check 'R3-3B. it does not burn a session per pass forever' {
        # One session per lane on the first pass; nothing after that.
        $pncCalls -eq 2
    }
    Check 'R3-3C. an empty PARTIAL parks the lane instead of leaving it selectable' {
        $l = @((Read-JsonFile $sbx.LanesFile).lanes | Where-Object { $_.lastResult -eq 'PARTIAL' })
        $l.Count -gt 0 -and @($l | Where-Object { $_.state -eq 'BLOCKED_PARTIAL' }).Count -eq 0
    }
    Check 'R3-3D. a PARTIAL that DID commit still counts as progress and stays executable' {
        Reset-SandboxLanes
        Reset-FakeCounters
        Invoke-Sandbox -Mode 'workonce' -ExitCode 0 -ExtraArgs @('-UntilExhausted', '-MaxPasses', '6') | Out-Null
        $r = @((Read-JsonFile $sbx.StateFile).runs)[-1]
        # Real commits on pass 1 mean pass 1 cannot be the exhausting pass.
        $r.passes -ge 2 -and $r.exhausted -eq $true
    }

    # ------------------------------------------------------------------------
    Section 'T. Crash windows around finalization (review 4 items 1, 6, 7)'

    function Get-LaneObj { param($Id) @((Read-JsonFile $sbx.LanesFile).lanes | Where-Object { $_.id -eq $Id })[0] }

    function Invoke-CrashWindow {
        <#
            Crash a real run at a named fault point, then finish the item through
            recovery alone. Returns everything the assertions need.
        #>
        param([string]$Fault)
        Reset-SandboxLanes
        Remove-Item -LiteralPath $sbx.PendingFile -Force -ErrorAction SilentlyContinue
        Get-ChildItem -Path $sbx.ItemsDir -Filter '*.json' -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -like '*-A-*' } | Remove-Item -Force
        Reset-FakeCounters

        $crash = Invoke-Sandbox -Mode 'workblocked' -ExitCode 0 -Fault $Fault -ExtraArgs @('-MaxItems', '1', '-LaneId', 'A')
        $callsAfterCrash = @(Get-Content -LiteralPath $callsOut -ErrorAction SilentlyContinue).Count
        $headAfterCrash = Get-LaneHead 'A'

        # Recovery only. No supervisor, so no possibility of a new worker.
        # The two Write-JsonFile calls mirror exactly what run-program.ps1 does
        # once recovery reports something recovered.
        $lanesDoc = Read-JsonFile $sbx.LanesFile
        $laneObj = @($lanesDoc.lanes | Where-Object { $_.id -eq 'A' })[0]
        $blockersDoc = Read-JsonFile $sbx.BlockersFile
        $rec = Invoke-C1LaneRecovery -Context $sbx -Lane $laneObj -WorktreePath (Join-Path $lanesDir 'A') `
            -Branch 'customer1/a-work' -ForbiddenPaths $forbidden -BlockersDoc $blockersDoc
        Write-JsonFile $sbx.LanesFile $lanesDoc
        Write-JsonFile $sbx.BlockersFile $blockersDoc
        if ($rec.PSObject.Properties['pendingReadyToClear'] -and $rec.pendingReadyToClear) {
            Clear-C1PendingTransaction -Context $sbx
        }

        [pscustomobject]@{
            crash           = $crash
            callsAfterCrash = $callsAfterCrash
            callsAfterRecov = @(Get-Content -LiteralPath $callsOut -ErrorAction SilentlyContinue).Count
            headAfterCrash  = $headAfterCrash
            headAfterRecov  = Get-LaneHead 'A'
            recovery        = $rec
            lane            = $laneObj
            receipts        = @(Get-C1ItemReceipts -Context $sbx -LaneId 'A')
            blockers        = @((Read-JsonFile $sbx.BlockersFile).blockers | Where-Object { $_.status -eq 'OPEN' })
        }
    }

    $wA = Invoke-CrashWindow -Fault 'AFTER_COMMIT'
    Check 'R4-7A. crash after commit, before receipt: item finished by recovery, no new worker' {
        $wA.recovery.status -eq 'RECOVERED_COMMIT' -and
        $wA.callsAfterRecov -eq $wA.callsAfterCrash -and
        $wA.headAfterRecov -eq $wA.headAfterCrash -and
        @($wA.receipts | Where-Object { $_.commitSha -eq $wA.headAfterCrash }).Count -eq 1
    }
    Check 'R4-3. a recovered receipt ALWAYS has a non-null result' {
        @($wA.receipts | Where-Object { -not $_.result }).Count -eq 0 -and
        @($wA.receipts | Where-Object { $_.recovered -and $_.result }).Count -gt 0
    }
    Check 'R4-3b. recovered work appears in completed-history context' {
        $h = Get-C1CompletedWorkSummary -Context $sbx -LaneId 'A'
        (@($h.completedTitles) -join ' ') -match 'committed-then-blocked'
    }
    Check 'R4-1A. the blocker survives a crash before the blockers write' {
        @($wA.blockers | Where-Object { $_.question -match 'contract template governs Day-1 support' }).Count -eq 1
    }
    Check 'R4-1B. the recovered receipt records the blocker id it raised' {
        $r = @($wA.receipts | Where-Object { $_.commitSha -eq $wA.headAfterCrash })[0]
        $ids = @($r.blockersRaised)
        $ids.Count -gt 0 -and
        @($wA.blockers | Where-Object { $_.id -eq $ids[0] }).Count -eq 1
    }

    $wB = Invoke-CrashWindow -Fault 'AFTER_RECEIPT'
    Check 'R4-7B. crash after receipt, before lanes.json: finished by recovery, no new worker' {
        $wB.callsAfterRecov -eq $wB.callsAfterCrash -and
        $wB.headAfterRecov -eq $wB.headAfterCrash -and
        $wB.recovery.status -in @('RECOVERED_COMMIT', 'NOTHING_TO_RECOVER') -and
        (Get-LaneObj 'A').state -eq 'WAITING_FOR_OWNER'
    }
    Check 'R4-7B2. no duplicate receipt for the same commit' {
        @($wB.receipts | Where-Object { $_.commitSha -eq $wB.headAfterCrash }).Count -eq 1
    }

    $wC = Invoke-CrashWindow -Fault 'AFTER_LANES'
    Check 'R4-7C. crash after lanes.json, before blockers.json: blocker restored' {
        $wC.callsAfterRecov -eq $wC.callsAfterCrash -and
        @($wC.blockers | Where-Object { $_.question -match 'contract template governs Day-1 support' }).Count -eq 1 -and
        (Get-LaneObj 'A').state -eq 'WAITING_FOR_OWNER'
    }

    $wD = Invoke-CrashWindow -Fault 'AFTER_BLOCKERS'
    Check 'R4-7D. crash after blockers.json, before pending clear: pending was still present' {
        # The whole point of clearing last: at this window the guard still existed.
        $wD.callsAfterRecov -eq $wD.callsAfterCrash -and
        $wD.recovery.status -eq 'RECOVERED_COMMIT' -and
        @($wD.receipts | Where-Object { $_.commitSha -eq $wD.headAfterCrash }).Count -eq 1 -and
        (Get-LaneObj 'A').state -eq 'WAITING_FOR_OWNER'
    }
    Check 'R4-1. pending-transaction.json is cleared LAST, after every durable write' {
        $code = Get-Content -LiteralPath (Join-Path $here 'run-program.ps1') -Raw
        $iReceipt  = $code.IndexOf('Save-C1ItemReceipt -Context $ctx -Receipt $receipt | Out-Null')
        $iLanes    = $code.IndexOf('Write-JsonFile $ctx.LanesFile $lanesDoc' + "`r`n" + '        Invoke-C1FaultPoint ''AFTER_LANES''')
        if ($iLanes -lt 0) { $iLanes = $code.IndexOf("Invoke-C1FaultPoint 'AFTER_LANES'") }
        $iBlockers = $code.IndexOf("Invoke-C1FaultPoint 'AFTER_BLOCKERS'")
        $iClear    = $code.IndexOf('Clear-C1PendingTransaction -Context $ctx' + "`r`n" + '        Invoke-C1FaultPoint')
        if ($iClear -lt 0) { $iClear = $code.IndexOf("Invoke-C1FaultPoint 'AFTER_PENDING_CLEAR'") }
        $iReceipt -gt 0 -and $iLanes -gt $iReceipt -and $iBlockers -gt $iLanes -and $iClear -gt $iBlockers
    }

    $wE = Invoke-CrashWindow -Fault 'AFTER_PENDING_CLEAR'
    Check 'R4-7E. crash after the pending clear: nothing left to recover for that item' {
        $wE.callsAfterRecov -eq $wE.callsAfterCrash -and
        $wE.recovery.status -eq 'NOTHING_TO_RECOVER' -and
        @($wE.receipts | Where-Object { $_.commitSha -eq $wE.headAfterCrash }).Count -eq 1
    }

    Check 'R4-6. a normal BLOCKED_OWNER item persists blockersRaised in its receipt' {
        Reset-SandboxLanes
        Reset-FakeCounters
        Invoke-Sandbox -Mode 'blockedowner' -ExitCode 0 -ExtraArgs @('-MaxItems', '1', '-LaneId', 'B') | Out-Null
        $r = @(Get-C1ItemReceipts -Context $sbx -LaneId 'B' | Where-Object { $_.result -eq 'BLOCKED_OWNER' })
        $open = @((Read-JsonFile $sbx.BlockersFile).blockers | Where-Object { $_.status -eq 'OPEN' })
        $r.Count -gt 0 -and @($r[-1].blockersRaised).Count -eq 1 -and
        @($open | Where-Object { $_.id -eq @($r[-1].blockersRaised)[0] }).Count -eq 1 -and
        (Get-LaneObj 'B').state -eq 'WAITING_FOR_OWNER'
    }

    # ------------------------------------------------------------------------
    Section 'U. A recovered commit does not bless later HEAD (review 4 item 4)'

    Check 'R4-4A. a later OWNED commit is reconciled separately, not folded in' {
        Reset-SandboxLanes
        Remove-Item -LiteralPath $sbx.PendingFile -Force -ErrorAction SilentlyContinue
        Get-ChildItem -Path $sbx.ItemsDir -Filter '*.json' -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -like '*-A-*' -or $_.Name -like 'recovered-A-*' -or $_.Name -like 'legacy-A-*' } | Remove-Item -Force
        Reset-FakeCounters

        # Crash right after the commit, leaving pending in place.
        Invoke-Sandbox -Mode 'workblocked' -ExitCode 0 -Fault 'AFTER_COMMIT' -ExtraArgs @('-MaxItems', '1', '-LaneId', 'A') | Out-Null
        $marked = Get-LaneHead 'A'

        # Then a further owned commit lands on the branch before recovery runs.
        $wt = Join-Path $lanesDir 'A'
        Set-Content -LiteralPath (Join-Path $wt 'docs/customer-1/scope/later-owned.md') -Value '# landed after the marked commit' -Encoding UTF8
        Invoke-Git -Directory $wt -Arguments @('add', '--', 'docs/customer-1/scope/later-owned.md') | Out-Null
        Invoke-Git -Directory $wt -Arguments @('commit', '-q', '-m', 'later owned lane work') | Out-Null
        $laterHead = Get-LaneHead 'A'

        $laneObj = Get-LaneObj 'A'
        $bd = Read-JsonFile $sbx.BlockersFile
        $rec = Invoke-C1LaneRecovery -Context $sbx -Lane $laneObj -WorktreePath $wt `
            -Branch 'customer1/a-work' -ForbiddenPaths $forbidden -BlockersDoc $bd

        $receipts = @(Get-C1ItemReceipts -Context $sbx -LaneId 'A')
        $markedReceipt = @($receipts | Where-Object { $_.commitSha -eq $marked })
        $laterReceipt = @($receipts | Where-Object { $_.commitSha -eq $laterHead })

        ($rec.status -eq 'RECOVERED_COMMIT') -and
        ($markedReceipt.Count -eq 1) -and
        # THE DEFECT: headShaAfter must stop at the marked commit.
        ($markedReceipt[0].headShaAfter -eq $marked) -and
        ($markedReceipt[0].headShaAfter -ne $laterHead) -and
        # The later commit is recovered on its own evidence, as its own receipt.
        ($laterReceipt.Count -eq 1) -and
        ($laterReceipt[0].recovered -eq 'BRANCH_AHEAD_OF_STATE')
    }

    Check 'R4-4B. a later UNOWNED commit fails closed instead of becoming verified state' {
        Reset-SandboxLanes
        Remove-Item -LiteralPath $sbx.PendingFile -Force -ErrorAction SilentlyContinue
        Get-ChildItem -Path $sbx.ItemsDir -Filter '*.json' -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -like '*-A-*' -or $_.Name -like 'recovered-A-*' -or $_.Name -like 'legacy-A-*' } | Remove-Item -Force
        Reset-FakeCounters

        Invoke-Sandbox -Mode 'workblocked' -ExitCode 0 -Fault 'AFTER_COMMIT' -ExtraArgs @('-MaxItems', '1', '-LaneId', 'A') | Out-Null
        $marked = Get-LaneHead 'A'

        $wt = Join-Path $lanesDir 'A'
        New-Item -ItemType Directory -Force -Path (Join-Path $wt 'docs/customer-1/commercial') | Out-Null
        Set-Content -LiteralPath (Join-Path $wt 'docs/customer-1/commercial/not-lane-a.md') -Value '# outside lane A' -Encoding UTF8
        Invoke-Git -Directory $wt -Arguments @('add', '--', 'docs/customer-1/commercial/not-lane-a.md') | Out-Null
        Invoke-Git -Directory $wt -Arguments @('commit', '-q', '-m', 'unowned change after the marked commit') | Out-Null
        $laterHead = Get-LaneHead 'A'

        $laneObj = Get-LaneObj 'A'
        $bd = Read-JsonFile $sbx.BlockersFile
        $rec = Invoke-C1LaneRecovery -Context $sbx -Lane $laneObj -WorktreePath $wt `
            -Branch 'customer1/a-work' -ForbiddenPaths $forbidden -BlockersDoc $bd

        $receipts = @(Get-C1ItemReceipts -Context $sbx -LaneId 'A')
        $markedReceipt = @($receipts | Where-Object { $_.commitSha -eq $marked })
        $laterReceipt = @($receipts | Where-Object { $_.commitSha -eq $laterHead })
        $ok = ($rec.status -eq 'FAILED_RECOVERY') -and $rec.blocked -and
              # the marked transaction still recovers, bounded to its own commit
              ($markedReceipt.Count -eq 1) -and ($markedReceipt[0].headShaAfter -eq $marked) -and
              # the unowned range never becomes verified state
              ($laterReceipt.Count -eq 0) -and
              # and nothing was reset
              ((Get-LaneHead 'A') -eq $laterHead)
        Invoke-Git -Directory $wt -Arguments @('reset', '--hard', '-q', $marked) | Out-Null
        $ok
    }

    # ------------------------------------------------------------------------
    Section 'V. Legacy bootstrap is crash-resumable (review 4 item 5)'

    Check 'R4-5. an interrupted bootstrap resumes and represents every legacy commit' {
        $wt = Join-Path $lanesDir 'B'
        $laneB3 = Get-LaneObj 'B'

        # Three pre-receipt commits, and no lane-B receipts at all.
        Get-ChildItem -Path $sbx.ItemsDir -Filter '*.json' -ErrorAction SilentlyContinue | ForEach-Object {
            $j = Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json
            if ($j.laneId -eq 'B') { Remove-Item -LiteralPath $_.FullName -Force }
        }
        $shas = @()
        foreach ($i in 1, 2, 3) {
            $rel = "docs/customer-1/data/legacy-$i-$([guid]::NewGuid().ToString('N').Substring(0,6)).md"
            Set-Content -LiteralPath (Join-Path $wt $rel) -Value "# legacy artifact $i" -Encoding UTF8
            Invoke-Git -Directory $wt -Arguments @('add', '--', $rel) | Out-Null
            Invoke-Git -Directory $wt -Arguments @('commit', '-q', '-m', "docs(customer-1): B-legacy-$i previous runner work") | Out-Null
            $shas += (Invoke-Git -Directory $wt -Arguments @('rev-parse', 'HEAD')).Output[0]
        }

        $stateDoc = Read-JsonFile $sbx.StateFile

        # Simulate a bootstrap that died after writing the FIRST receipt: run the
        # real thing, then delete all but one of its receipts.
        Invoke-C1LegacyBootstrap -Context $sbx -Lane $laneB3 -WorktreePath $wt `
            -Branch 'customer1/b-work' -StateDoc $stateDoc -ForbiddenPaths $forbidden | Out-Null
        $written = @(Get-ChildItem -Path $sbx.ItemsDir -Filter 'legacy-B-*.json' | Sort-Object Name)
        if ($written.Count -lt 3) { return $false }
        $written | Select-Object -Skip 1 | Remove-Item -Force

        # Restart: bootstrap must notice the gap rather than say "already done".
        $again = Invoke-C1LegacyBootstrap -Context $sbx -Lane $laneB3 -WorktreePath $wt `
            -Branch 'customer1/b-work' -StateDoc $stateDoc -ForbiddenPaths $forbidden

        $rec = @(Get-C1ItemReceipts -Context $sbx -LaneId 'B' | Where-Object { $_.recovered -eq 'LEGACY_PRE_RECEIPT' })
        $coveredShas = @($rec | ForEach-Object { $_.commitSha } | Select-Object -Unique)
        $missing = @($shas | Where-Object { $coveredShas -notcontains $_ })

        ($again.status -eq 'BOOTSTRAPPED') -and
        ($missing.Count -eq 0) -and
        # exactly one receipt per legacy commit, no duplicates
        ($rec.Count -eq $coveredShas.Count) -and
        (@($rec | Where-Object { $_.result -ne 'RECOVERED' }).Count -eq 0)
    }

    Check 'R4-5b. a fully-covered lane reports ALREADY_BOOTSTRAPPED and adds nothing' {
        $wt = Join-Path $lanesDir 'B'
        $laneB3 = Get-LaneObj 'B'
        $before = @(Get-C1ItemReceipts -Context $sbx -LaneId 'B').Count
        $ledgerBefore = (Get-FileHash $sbx.LedgerFile).Hash
        $r = Invoke-C1LegacyBootstrap -Context $sbx -Lane $laneB3 -WorktreePath $wt `
            -Branch 'customer1/b-work' -StateDoc (Read-JsonFile $sbx.StateFile) -ForbiddenPaths $forbidden
        ($r.status -eq 'ALREADY_BOOTSTRAPPED') -and
        (@(Get-C1ItemReceipts -Context $sbx -LaneId 'B').Count -eq $before) -and
        ((Get-FileHash $sbx.LedgerFile).Hash -eq $ledgerBefore)
    }

    Check 'R4-2. the pending transaction carries the evidence needed to finalize' {
        # Crash before the commit so phase 1 is on disk, then read it.
        Reset-SandboxLanes
        Remove-Item -LiteralPath $sbx.PendingFile -Force -ErrorAction SilentlyContinue
        Reset-FakeCounters
        Invoke-Sandbox -Mode 'workblocked' -ExitCode 0 -Fault 'AFTER_COMMIT' -ExtraArgs @('-MaxItems', '1', '-LaneId', 'A') | Out-Null
        if (-not (Test-Path $sbx.PendingFile)) { return $false }
        $p = Get-Content -LiteralPath $sbx.PendingFile -Raw | ConvertFrom-Json

        $hasPhase2 = $p.phase -eq 'COMMITTED_PENDING_CHECKPOINT' -and $p.commitSha -and
                     $p.finalReceipt -and $p.finalReceipt.result -and
                     $p.intendedLaneState -eq 'WAITING_FOR_OWNER' -and
                     @($p.normalizedBlockers).Count -eq 1
        $snap = $p.finalReceipt
        $hasEvidence = $snap.workItem -and @($snap.blockersRaised).Count -eq 1
        $ok = $hasPhase2 -and $hasEvidence
        Remove-Item -LiteralPath $sbx.PendingFile -Force -ErrorAction SilentlyContinue
        $ok
    }

    # ------------------------------------------------------------------------
    Section 'W. Recovery releases the guard last (review 5)'

    Check 'R5. a crash DURING recovery is itself recoverable, then recovery completes' {
        # Set up a real interrupted item: commit made, pending phase 2 on disk,
        # nothing else persisted.
        Reset-SandboxLanes
        Remove-Item -LiteralPath $sbx.PendingFile -Force -ErrorAction SilentlyContinue
        Get-ChildItem -Path $sbx.ItemsDir -Filter '*.json' -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -like '*-A-*' -or $_.Name -like 'recovered-A-*' -or $_.Name -like 'legacy-A-*' } |
            Remove-Item -Force
        Reset-FakeCounters

        Invoke-Sandbox -Mode 'workblocked' -ExitCode 0 -Fault 'AFTER_COMMIT' -ExtraArgs @('-MaxItems', '1', '-LaneId', 'A') | Out-Null
        $callsAfterFirst = @(Get-Content -LiteralPath $callsOut -ErrorAction SilentlyContinue).Count
        $headAfterFirst = Get-LaneHead 'A'
        if (-not (Test-Path $sbx.PendingFile)) { return $false }

        # SECOND CRASH: recovery runs and returns, then the process dies before
        # the recovered lane state and blockers are persisted. Under the old
        # ordering recovery had already deleted the pending file by this point,
        # and everything it reconstructed would be gone with nothing left to say
        # so.
        $second = Invoke-Sandbox -Mode 'workblocked' -ExitCode 0 -Fault 'AFTER_RECOVERY_RETURN' -ExtraArgs @('-MaxItems', '1', '-LaneId', 'A')
        $callsAfterSecond = @(Get-Content -LiteralPath $callsOut -ErrorAction SilentlyContinue).Count

        $guardSurvived = Test-Path $sbx.PendingFile
        $noRerun       = $callsAfterSecond -eq $callsAfterFirst
        $noNewCommit   = (Get-LaneHead 'A') -eq $headAfterFirst

        # THIRD START: recovery completes normally. Lane A finishes in
        # WAITING_FOR_OWNER, which is non-executable, so no worker is selected.
        $third = Invoke-Sandbox -Mode 'workblocked' -ExitCode 0 -ExtraArgs @('-MaxItems', '1', '-LaneId', 'A')
        $callsAfterThird = @(Get-Content -LiteralPath $callsOut -ErrorAction SilentlyContinue).Count

        $receipts = @(Get-C1ItemReceipts -Context $sbx -LaneId 'A' | Where-Object { $_.commitSha -eq $headAfterFirst })
        $lane     = @((Read-JsonFile $sbx.LanesFile).lanes | Where-Object { $_.id -eq 'A' })[0]
        $blockers = @((Read-JsonFile $sbx.BlockersFile).blockers |
            Where-Object { $_.status -eq 'OPEN' -and $_.question -match 'contract template governs Day-1 support' })

        $guardSurvived -and $noRerun -and $noNewCommit -and
        # receipt durable, exactly one, no duplicate commit
        ($receipts.Count -eq 1) -and ($receipts[0].result) -and
        # lanes durable
        ($lane.state -eq 'WAITING_FOR_OWNER') -and
        # blockers durable, preserved exactly once across three starts
        ($blockers.Count -eq 1) -and
        # still no worker rerun, and the branch never moved again
        ($callsAfterThird -eq $callsAfterFirst) -and
        ((Get-LaneHead 'A') -eq $headAfterFirst) -and
        # and ONLY NOW is the guard gone
        (-not (Test-Path $sbx.PendingFile))
    }

    Check 'R5b. recovery itself never clears a pending transaction' {
        # The clear belongs to the supervisor, after it has persisted lanes and
        # blockers. Ambiguous recovery still archives evidence rather than
        # clearing it as success.
        $code = Get-Content -LiteralPath (Join-Path $here 'recover.ps1') -Raw
        ($code -notmatch 'Clear-C1PendingTransaction') -and ($code -match 'PendingReadyToClear')
    }

    Check 'R5c. the supervisor clears pending only after both state writes' {
        $code = Get-Content -LiteralPath (Join-Path $here 'run-program.ps1') -Raw
        $iLanes    = $code.IndexOf('Write-JsonFile $ctx.LanesFile $lanesDoc' + "`r`n" + '            Write-JsonFile $ctx.BlockersFile $blockersDoc')
        if ($iLanes -lt 0) { $iLanes = $code.IndexOf('Recovery restored receipts, blockers and a lane state in memory') }
        $iClear = $code.IndexOf('if ($rec.PSObject.Properties[''pendingReadyToClear''] -and $rec.pendingReadyToClear)')
        $iLanes -gt 0 -and $iClear -gt $iLanes
    }

    Check 'R5d. ambiguous recovery still archives rather than clearing as success' {
        $laneA4 = @((Read-JsonFile $sbx.LanesFile).lanes | Where-Object { $_.id -eq 'A' })[0]
        $wt = Join-Path $lanesDir 'A'
        $head = Get-LaneHead 'A'
        $rc = New-C1ItemReceipt -RunId 'ambig' -PassId 1 -Attempt 0 -Lane $laneA4 -Branch 'customer1/a-work' -ItemId 'ambig-A'
        Save-C1PendingTransaction -Context $sbx -Transaction ([pscustomobject]@{
            schemaVersion = 1; phase = 'PRE_COMMIT'; itemId = 'ambig-A'; runId = 'ambig'; passId = 1; laneId = 'A'
            branch = 'customer1/a-work'; worktree = $wt; preCommitHead = $head
            verifiedChangedPaths = @('docs/customer-1/scope/never-existed.md'); expectedPaths = @()
            verificationResult = 'PASS'; proofResults = @(); commitMarker = (Get-C1ItemMarker -ItemId 'ambig-A')
            commitMessage = 'unused'; itemReceipt = $rc
            claimSnapshot = (New-C1ClaimSnapshot -Claim $null -ClaimedResult 'DONE')
            createdAt = (Get-UtcStamp)
        }) | Out-Null
        Set-Content -LiteralPath (Join-Path $wt 'docs/customer-1/scope/something-different.md') -Value '# drift' -Encoding UTF8

        $bd = Read-JsonFile $sbx.BlockersFile
        $r = Invoke-C1LaneRecovery -Context $sbx -Lane $laneA4 -WorktreePath $wt `
            -Branch 'customer1/a-work' -ForbiddenPaths $forbidden -BlockersDoc $bd

        $archived = @(Get-ChildItem -Path $sbx.RecoveryDir -Filter 'pending-failed-*ambig-A.json' -ErrorAction SilentlyContinue)
        $ok = ($r.status -eq 'FAILED_RECOVERY') -and $r.blocked -and
              (-not $r.pendingReadyToClear) -and ($archived.Count -eq 1)
        Invoke-Git -Directory $wt -AllowFail -Arguments @('clean', '-fdq') | Out-Null
        $ok
    }

    # ------------------------------------------------------------------------
    Section 'X. PowerShell host requirement (canary defect 1)'

    $winPs = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

    Check 'R6-1. every entry point guards the host BEFORE it touches anything' {
        $entries = @('run-program.ps1', 'test-framework.ps1', 'test-proof-policy.ps1', 'preflight.ps1')
        $bad = @($entries | Where-Object {
            $src = Get-Content -LiteralPath (Join-Path $here $_) -Raw
            $iGuard = $src.IndexOf('STOP: unsupported PowerShell host')
            $iWork  = $src.IndexOf('. (Join-Path')       # first dot-source = first real work
            ($iGuard -lt 0) -or ($iWork -ge 0 -and $iGuard -gt $iWork)
        })
        $bad.Count -eq 0
    }

    if (Test-Path $winPs) {
        $before = @{
            lanes    = (Get-FileHash $sbx.LanesFile).Hash
            state    = (Get-FileHash $sbx.StateFile).Hash
            blockers = (Get-FileHash $sbx.BlockersFile).Hash
            items    = @(Get-ChildItem -Path $sbx.ItemsDir -Filter '*.json' -ErrorAction SilentlyContinue).Count
        }
        Reset-FakeCounters
        $wpsOut = & $winPs -NoProfile -ExecutionPolicy Bypass `
            -File (Join-Path $harnessDir 'scripts\customer1-automation\run-program.ps1') -DryRun 2>&1
        $wpsExit = $LASTEXITCODE
        $wpsText = (@($wpsOut) | ForEach-Object { "$_" }) -join "`n"

        Check 'R6-2. Windows PowerShell 5.1 is refused, with an actionable message' {
            ($wpsText -match 'requires PowerShell 7 or newer') -and
            ($wpsText -match 'ProcessStartInfo.ArgumentList') -and
            ($wpsText -match 'pwsh -File')
        }
        Check 'R6-3. the refusal happens BEFORE any persistent mutation' {
            ((Get-FileHash $sbx.LanesFile).Hash -eq $before.lanes) -and
            ((Get-FileHash $sbx.StateFile).Hash -eq $before.state) -and
            ((Get-FileHash $sbx.BlockersFile).Hash -eq $before.blockers) -and
            (@(Get-ChildItem -Path $sbx.ItemsDir -Filter '*.json' -ErrorAction SilentlyContinue).Count -eq $before.items) -and
            (@(Get-Content -LiteralPath $callsOut -ErrorAction SilentlyContinue).Count -eq 0)
        }
        Check 'R6-4. the refusal is a failure, not a silent no-op' { $wpsExit -ne 0 }
    } else {
        Check 'R6-2. Windows PowerShell 5.1 is refused (SKIPPED: powershell.exe absent)' { $true }
    }

    # ------------------------------------------------------------------------
    Section 'Y. Reconciliation merge vs legacy bootstrap (canary defect 2)'

    function Add-SandboxMainCommit {
        <#
            Advance the sandbox's main with BOTH an ordinary path and a
            harness-owned path, which is what makes a later integration merge
            look like a lane touching files it must not.
        #>
        param([string]$Tag)
        $mainWork = Join-Path $sandbox "mainwork-$Tag"
        & git clone $originDir $mainWork --quiet 2>&1 | Out-Null
        Git-In $mainWork @('config', 'user.email', 'main@example.invalid') | Out-Null
        Git-In $mainWork @('config', 'user.name', 'Upstream') | Out-Null
        New-Item -ItemType Directory -Force -Path (Join-Path $mainWork 'docs\design') | Out-Null
        Set-Content -LiteralPath (Join-Path $mainWork "docs\design\upstream-$Tag.md") -Value "# upstream $Tag" -Encoding UTF8
        Set-Content -LiteralPath (Join-Path $mainWork "scripts\customer1-automation\UPSTREAM_NOTE_$Tag.md") -Value "# harness-owned upstream change $Tag" -Encoding UTF8
        Git-In $mainWork @('add', '-A') | Out-Null
        Git-In $mainWork @('commit', '-q', '-m', "upstream: ordinary and harness-owned change $Tag") | Out-Null
        Git-In $mainWork @('push', '-q', 'origin', 'main') | Out-Null
        $sha = (Invoke-Git -Directory $mainWork -Arguments @('rev-parse', 'HEAD')).Output[0]
        Invoke-Git -Directory $harnessDir -AllowFail -Arguments @('fetch', 'origin', '--quiet') | Out-Null
        Invoke-Git -Directory (Join-Path $lanesDir 'B') -AllowFail -Arguments @('fetch', 'origin', '--quiet') | Out-Null
        $sha
    }

    Check 'R6-5. an integration merge is NOT reconstructed as legacy lane work' {
        # --- 1. legacy lane commits in owned paths
        $wt = Join-Path $lanesDir 'B'
        Reset-SandboxLanes
        Get-ChildItem -Path $sbx.ItemsDir -Filter '*.json' -ErrorAction SilentlyContinue | ForEach-Object {
            $j = Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json
            if ($j.laneId -eq 'B') { Remove-Item -LiteralPath $_.FullName -Force }
        }
        $laneShas = @()
        foreach ($i in 1, 2) {
            $rel = "docs/customer-1/data/legacy-recon-$i.md"
            Set-Content -LiteralPath (Join-Path $wt $rel) -Value "# legacy $i" -Encoding UTF8
            Invoke-Git -Directory $wt -Arguments @('add', '--', $rel) | Out-Null
            Invoke-Git -Directory $wt -Arguments @('commit', '-q', '-m', "docs(customer-1): B-legacy-recon-$i") | Out-Null
            $laneShas += (Invoke-Git -Directory $wt -Arguments @('rev-parse', 'HEAD')).Output[0]
        }

        # --- 2. bootstrap them successfully
        $laneB = @((Read-JsonFile $sbx.LanesFile).lanes | Where-Object { $_.id -eq 'B' })[0]
        $boot1 = Invoke-C1LegacyBootstrap -Context $sbx -Lane $laneB -WorktreePath $wt `
            -Branch 'customer1/b-work' -StateDoc (Read-JsonFile $sbx.StateFile) -ForbiddenPaths $forbidden
        if ($boot1.status -ne 'BOOTSTRAPPED') { return $false }
        $receiptsAfterBoot = @(Get-C1ItemReceipts -Context $sbx -LaneId 'B')

        # --- 3. advance main with ordinary AND harness-owned paths
        $newMain = Add-SandboxMainCommit -Tag 'r6'

        # --- 4. let reconcile-main integrate main into the lane.
        #        LastReconciledMain empty mirrors the real first reconcile, which
        #        is exactly how the production merge came to contain harness paths.
        $rec = & (Join-Path $harnessDir 'scripts\customer1-automation\reconcile-main.ps1') `
            -LaneId 'B' -WorktreePath $wt -Branch 'customer1/b-work' `
            -LastReconciledMain '' -OwnedPaths @($laneB.ownedPaths) -ForbiddenPaths $forbidden `
            -MainRef 'origin/main' -Apply
        if (-not $rec.integrated) { return $false }
        $mergeSha = (Invoke-Git -Directory $wt -Arguments @('rev-parse', 'HEAD')).Output[0]

        # Persist the reconcile point exactly as run-program.ps1 now does the
        # moment a merge lands. Without it, the next reconcile sees main's
        # harness-owned change as a fresh authority move and refuses -- correct
        # behaviour, but not what this test is about.
        $ld = Read-JsonFile $sbx.LanesFile
        @($ld.lanes | Where-Object { $_.id -eq 'B' })[0].lastReconciledMain = $rec.mainSha
        Write-JsonFile $sbx.LanesFile $ld

        # the merge really does carry harness-owned paths on its first parent
        $mergePaths = @(Get-C1CommitPaths -WorktreePath $wt -FromSha "$mergeSha^" -ToSha $mergeSha)
        $carriesForbidden = @(Select-ForbiddenPaths -Paths $mergePaths -ForbiddenPatterns $forbidden).Count -gt 0
        if (-not $carriesForbidden) { return $false }

        # --- 5/6. restart: run bootstrap + recovery again, as startup does
        $laneB2 = @((Read-JsonFile $sbx.LanesFile).lanes | Where-Object { $_.id -eq 'B' })[0]
        $boot2 = Invoke-C1LegacyBootstrap -Context $sbx -Lane $laneB2 -WorktreePath $wt `
            -Branch 'customer1/b-work' -StateDoc (Read-JsonFile $sbx.StateFile) -ForbiddenPaths $forbidden
        $bd = Read-JsonFile $sbx.BlockersFile
        $rec2 = Invoke-C1LaneRecovery -Context $sbx -Lane $laneB2 -WorktreePath $wt `
            -Branch 'customer1/b-work' -ForbiddenPaths $forbidden -BlockersDoc $bd
        $receiptsAfter = @(Get-C1ItemReceipts -Context $sbx -LaneId 'B')

        # --- 7. startup must not misclassify, duplicate, block or reset
        $notFailed     = $boot2.status -ne 'FAILED_BOOTSTRAP' -and -not $boot2.blocked
        $notReconstructed = @($receiptsAfter | Where-Object { $_.commitSha -eq $mergeSha -and $_.recovered -eq 'LEGACY_PRE_RECEIPT' }).Count -eq 0
        $noDuplicates  = @($receiptsAfter | Where-Object { $_.recovered -eq 'LEGACY_PRE_RECEIPT' }).Count -eq @($receiptsAfterBoot | Where-Object { $_.recovered -eq 'LEGACY_PRE_RECEIPT' }).Count
        $notBlocked    = -not $rec2.blocked
        $noForbidUse   = ($boot2.message -notmatch 'may not own') -and ($rec2.message -notmatch 'may not own')

        # --- 8. lane work and the merge are intact
        $headIntact    = (Invoke-Git -Directory $wt -Arguments @('rev-parse', 'HEAD')).Output[0] -eq $mergeSha
        $laneWorkIntact = @($laneShas | Where-Object {
            (Invoke-Git -Directory $wt -AllowFail -Arguments @('merge-base', '--is-ancestor', $_, 'HEAD')).ExitCode -eq 0
        }).Count -eq $laneShas.Count

        $notFailed -and $notReconstructed -and $noDuplicates -and $notBlocked -and
        $noForbidUse -and $headIntact -and $laneWorkIntact
    }

    Check 'R6-6. after the restart a real next worker can still be selected' {
        # --- 9. the lane is executable and a worker actually runs and commits.
        $wt = Join-Path $lanesDir 'B'
        $headBefore = (Invoke-Git -Directory $wt -Arguments @('rev-parse', 'HEAD')).Output[0]
        Reset-SandboxLanes
        Reset-FakeCounters
        $run = Invoke-Sandbox -Mode 'work' -ExitCode 0 -ExtraArgs @('-MaxItems', '1', '-LaneId', 'B')
        $calls = @(Get-Content -LiteralPath $callsOut -ErrorAction SilentlyContinue | Where-Object { $_ -like 'B *' }).Count
        $headAfter = (Invoke-Git -Directory $wt -Arguments @('rev-parse', 'HEAD')).Output[0]
        ($calls -eq 1) -and ($headAfter -ne $headBefore) -and
        ($run.Output -notmatch 'may not own') -and ($run.Output -notmatch 'FAILURE')
    }

    Check 'R6-7. a DOMAIN merge carrying real work stays visible' {
        # The exclusion must be narrow. A merge of a side branch -- not upstream --
        # is lane work and must never disappear from bootstrap.
        $wt = Join-Path $lanesDir 'B'
        Invoke-Git -Directory $wt -Arguments @('checkout', '-q', '-b', 'tmp/side') | Out-Null
        Set-Content -LiteralPath (Join-Path $wt 'docs/customer-1/data/side-work.md') -Value '# real side work' -Encoding UTF8
        Invoke-Git -Directory $wt -Arguments @('add', '--', 'docs/customer-1/data/side-work.md') | Out-Null
        Invoke-Git -Directory $wt -Arguments @('commit', '-q', '-m', 'docs(customer-1): side work') | Out-Null
        Invoke-Git -Directory $wt -Arguments @('checkout', '-q', 'customer1/b-work') | Out-Null
        Invoke-Git -Directory $wt -Arguments @('merge', '--no-ff', '--no-edit', '-q', 'tmp/side') | Out-Null
        $domainMerge = (Invoke-Git -Directory $wt -Arguments @('rev-parse', 'HEAD')).Output[0]

        $isIntegration = Test-C1IntegrationMerge -WorktreePath $wt -Sha $domainMerge -MainRef 'origin/main'
        $sideCommit = (Invoke-Git -Directory $wt -Arguments @('rev-parse', 'tmp/side')).Output[0]
        $sideVisible = Test-C1IntegrationMerge -WorktreePath $wt -Sha $sideCommit -MainRef 'origin/main'

        Invoke-Git -Directory $wt -AllowFail -Arguments @('branch', '-D', 'tmp/side') | Out-Null
        # Neither the merge of a side branch nor the work on it is treated as an
        # upstream integration.
        (-not $isIntegration) -and (-not $sideVisible)
    }

    Check 'R6-8. an integration merge is recognised structurally, without a marker' {
        # The merges stranding lanes today predate the C1-Reconcile-Main trailer,
        # so recognition must not depend on it.
        $wt = Join-Path $lanesDir 'C'
        if (-not (Test-Path $wt)) {
            Invoke-Git -Directory $harnessDir -Arguments @('worktree', 'add', '-B', 'customer1/c-work', $wt, 'origin/main') | Out-Null
        }
        Invoke-Git -Directory $wt -AllowFail -Arguments @('fetch', 'origin', '--quiet') | Out-Null
        New-Item -ItemType Directory -Force -Path (Join-Path $wt 'docs/customer-1/security') | Out-Null
        Set-Content -LiteralPath (Join-Path $wt 'docs/customer-1/security/c-work.md') -Value '# lane C work' -Encoding UTF8
        Invoke-Git -Directory $wt -Arguments @('add', '-A') | Out-Null
        Invoke-Git -Directory $wt -Arguments @('commit', '-q', '-m', 'docs(customer-1): C work') | Out-Null

        Add-SandboxMainCommit -Tag 'r6b' | Out-Null
        Invoke-Git -Directory $wt -AllowFail -Arguments @('fetch', 'origin', '--quiet') | Out-Null
        # A bare git merge with NO marker at all -- exactly the production shape.
        Invoke-Git -Directory $wt -Arguments @('merge', '--no-edit', '-q', 'origin/main') | Out-Null
        $bare = (Invoke-Git -Directory $wt -Arguments @('rev-parse', 'HEAD')).Output[0]

        $body = (Invoke-Git -Directory $wt -Arguments @('log', '-1', '--format=%B', $bare)).Output -join "`n"
        (Test-C1IntegrationMerge -WorktreePath $wt -Sha $bare -MainRef 'origin/main') -and
        ($body -notmatch 'C1-Reconcile-Main')
    }

    Check 'R6-9. lastReconciledMain is persisted BEFORE the worker launches' {
        # Crash immediately after the reconcile persist and confirm the merge point
        # survived in lanes.json with no worker having run.
        Reset-SandboxLanes
        $d = Read-JsonFile $sbx.LanesFile
        foreach ($l in $d.lanes) { $l.lastReconciledMain = $null }
        Write-JsonFile $sbx.LanesFile $d
        Add-SandboxMainCommit -Tag 'r6c' | Out-Null
        Reset-FakeCounters

        Invoke-Sandbox -Mode 'work' -ExitCode 0 -Fault 'AFTER_RECONCILE_PERSIST' -ExtraArgs @('-MaxItems', '1', '-LaneId', 'A') | Out-Null
        $laneA = @((Read-JsonFile $sbx.LanesFile).lanes | Where-Object { $_.id -eq 'A' })[0]
        $calls = @(Get-Content -LiteralPath $callsOut -ErrorAction SilentlyContinue).Count
        # The reconcile point is durable, and no worker ever started.
        ($laneA.lastReconciledMain) -and ($laneA.lastReconciledMain -match '^[0-9a-f]{40}$') -and ($calls -eq 0)
    }

    # ------------------------------------------------------------------------
    Section 'Z. Externally-killed supervisor leaves an unexplained dirty lane'

    Check 'R7. an unexplained dirty lane is refused, twice, without duplicating anything' {
        # The exact incident: the SUPERVISOR is killed while a worker has already
        # changed the lane worktree, before any receipt, pending transaction or
        # commit exists. Nothing on disk explains the files, and the branch is the
        # correct one -- so neither the unexpected-branch guard nor ordinary
        # recovery has anything to say about them.
        Reset-SandboxLanes
        Remove-Item -LiteralPath $sbx.PendingFile -Force -ErrorAction SilentlyContinue
        Reset-FakeCounters

        $wt = Join-Path $lanesDir 'A'
        $headBefore = Get-LaneHead 'A'

        # A worker's leavings: one untracked file AND one tracked modification.
        $untracked = 'docs/customer-1/scope/PARTIAL-interrupted.md'
        New-Item -ItemType Directory -Force -Path (Join-Path $wt 'docs/customer-1/scope') | Out-Null
        Set-Content -LiteralPath (Join-Path $wt $untracked) -Value "# half-written, nobody checkpointed this" -Encoding UTF8

        # Pick a real tracked file inside lane A's ownership to modify.
        $trackedRel = @((Invoke-Git -Directory $wt -Arguments @('ls-files', 'docs/customer-1/scope')).Output |
            Where-Object { $_ -and $_ -ne $untracked })
        $haveTracked = $trackedRel.Count -gt 0
        if ($haveTracked) {
            $tp = Join-Path $wt ($trackedRel[0] -replace '/', '\')
            Add-Content -LiteralPath $tp -Value "`n<!-- interrupted edit -->" -Encoding UTF8
        }

        $hashesBefore = @{}
        foreach ($r in @($untracked) + @(if ($haveTracked) { $trackedRel[0] } else { @() })) {
            $hashesBefore[$r] = (Get-FileHash -LiteralPath (Join-Path $wt ($r -replace '/', '\')) -Algorithm SHA256).Hash
        }

        # Count only receipts that CLAIM WORK. A MAIN_INTEGRATION receipt from an
        # earlier fixture's upstream merge is legitimate framework behaviour, and
        # counting it would look like the interrupted item being adopted.
        function Get-WorkReceiptCount {
            @(Get-C1ItemReceipts -Context $sbx -LaneId 'A' |
                Where-Object { $_.result -in @('DONE', 'PARTIAL') }).Count
        }
        function Test-NoReceiptMentions {
            param([string]$Path)
            @(Get-C1ItemReceipts -Context $sbx -LaneId 'A' |
                Where-Object { @($_.changedPaths) -contains $Path }).Count -eq 0
        }
        $receiptsBefore = Get-WorkReceiptCount
        $callsBefore = @(Get-Content -LiteralPath $callsOut -ErrorAction SilentlyContinue).Count

        # ---- RESTART 1
        $r1 = Invoke-Sandbox -Mode 'work' -ExitCode 0 -ExtraArgs @('-MaxItems', '2')
        $callsA1 = @(Get-Content -LiteralPath $callsOut -ErrorAction SilentlyContinue | Where-Object { $_ -like 'A *' }).Count
        $laneA1 = @((Read-JsonFile $sbx.LanesFile).lanes | Where-Object { $_.id -eq 'A' })[0]
        $blockers1 = @((Read-JsonFile $sbx.BlockersFile).blockers |
            Where-Object { $_.status -eq 'OPEN' -and $_.question -match 'uncheckpointed worktree changes' })
        $receiptsAfter1 = Get-WorkReceiptCount

        $bytesIntact1 = $true
        foreach ($k in $hashesBefore.Keys) {
            $p = Join-Path $wt ($k -replace '/', '\')
            if (-not (Test-Path $p)) { $bytesIntact1 = $false; continue }
            if ((Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash -ne $hashesBefore[$k]) { $bytesIntact1 = $false }
        }

        $pass1 =
            ($callsA1 -eq 0) -and                                   # zero workers on the affected lane
            $bytesIntact1 -and                                      # dirty files byte-identical
            ((Get-LaneHead 'A') -eq $headBefore) -and               # no commit created
            ($receiptsAfter1 -eq $receiptsBefore) -and              # no fabricated work receipt
            (Test-NoReceiptMentions $untracked) -and                # nothing adopted the partial file
            (-not (Test-Path $sbx.PendingFile)) -and                # no manufactured pending transaction
            ($laneA1.state -eq 'FAILED_RECOVERY') -and              # lane refused
            ($blockers1.Count -eq 1) -and                           # exactly one blocker
            ($blockers1[0].category -eq 'GOVERNANCE')

        # A healthy lane must still be selectable and actually run.
        $callsB1 = @(Get-Content -LiteralPath $callsOut -ErrorAction SilentlyContinue | Where-Object { $_ -like 'B *' }).Count
        $healthy1 = $callsB1 -ge 1

        # ---- RESTART 2, nothing changed in between
        $r2 = Invoke-Sandbox -Mode 'work' -ExitCode 0 -ExtraArgs @('-MaxItems', '2')
        $callsA2 = @(Get-Content -LiteralPath $callsOut -ErrorAction SilentlyContinue | Where-Object { $_ -like 'A *' }).Count
        $blockers2 = @((Read-JsonFile $sbx.BlockersFile).blockers |
            Where-Object { $_.status -eq 'OPEN' -and $_.question -match 'uncheckpointed worktree changes' })
        $receiptsAfter2 = Get-WorkReceiptCount

        $bytesIntact2 = $true
        foreach ($k in $hashesBefore.Keys) {
            $p = Join-Path $wt ($k -replace '/', '\')
            if (-not (Test-Path $p)) { $bytesIntact2 = $false; continue }
            if ((Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash -ne $hashesBefore[$k]) { $bytesIntact2 = $false }
        }

        $pass2 =
            ($callsA2 -eq 0) -and                                   # still zero workers on lane A
            $bytesIntact2 -and                                      # bytes still identical
            ($blockers2.Count -eq 1) -and                           # blocker deduped, not re-added
            ($receiptsAfter2 -eq $receiptsBefore) -and              # still no receipt
            ((Get-LaneHead 'A') -eq $headBefore)

        # Clean up only the fixture, by exact path -- never a broad git clean.
        Remove-Item -LiteralPath (Join-Path $wt $untracked) -Force -ErrorAction SilentlyContinue
        if ($haveTracked) {
            Invoke-Git -Directory $wt -AllowFail -Arguments @('checkout', '--', $trackedRel[0]) | Out-Null
        }

        $pass1 -and $healthy1 -and $pass2
    }

    Check 'R7b. the correct-branch case is distinct from the unexpected-branch guard' {
        # Both refuse, but for different reasons, and neither may swallow the other.
        $code = Get-Content -LiteralPath (Join-Path $here 'run-program.ps1') -Raw
        ($code -match 'unexplained-dirty') -and                      # new startup guard
        ($code -match 'dirty-branch') -and                           # existing unexpected-branch guard
        ($code -match 'uncheckpointed worktree changes')
    }

    Check 'R7c. the guard adopts nothing: no commit, reset, clean, stash or fabricated receipt' {
        $code = Get-Content -LiteralPath (Join-Path $here 'run-program.ps1') -Raw
        $block = [regex]::Match($code, '(?s)UNEXPLAINED DIRTY LANE.*?\n        \}\r?\n    \}').Value
        $block -and
        ($block -notmatch '\bgit.{0,40}(add|commit|reset|clean|stash|checkout)\b') -and
        ($block -notmatch 'Save-C1ItemReceipt') -and
        ($block -notmatch 'Save-C1PendingTransaction')
    }
    Section 'I. Repository-level guarantees'

    Check '23. every orchestrator PowerShell script parses' {
        $bad = 0
        foreach ($f in @(Get-ChildItem -Path $here -Filter '*.ps1')) {
            $t = $null; $e = $null
            [System.Management.Automation.Language.Parser]::ParseFile($f.FullName, [ref]$t, [ref]$e) | Out-Null
            if ($e.Count -gt 0) { $bad++; Write-Host "        $($f.Name): $($e[0].Message)" }
        }
        $bad -eq 0
    }
    Check '23b. morning-report still renders from the new item-receipt shape' {
        # The receipts replaced the old ad-hoc item objects. If a field the report
        # reads went missing, StrictMode turns that into a run-ending exception at
        # the very end of a sweep -- after all the work is done.
        $rep = & pwsh -NoProfile -ExecutionPolicy Bypass `
            -File (Join-Path $harnessDir 'scripts\customer1-automation\morning-report.ps1') 2>&1
        $LASTEXITCODE -eq 0 -and @(Get-ChildItem -Path $sbx.ReportsDir -Filter '*.md').Count -gt 0
    }
    Check '24. the proof-policy self-test still passes' {
        & pwsh -NoProfile -ExecutionPolicy Bypass -File (Join-Path $here 'test-proof-policy.ps1') | Out-Null
        $LASTEXITCODE -eq 0
    }
    Check '25. no GitHub-hosted Windows Action is added by this framework change' {
        $changed = @((Invoke-Git -Directory $repoRoot -AllowFail -Arguments @('diff', '--name-only', 'origin/main...HEAD')).Output |
            Where-Object { $_ })
        @($changed | Where-Object { $_ -like '.github/workflows/*' }).Count -eq 0
    }
    Check '25b. maxConcurrentClaude is still exactly one' {
        (Read-JsonFile (Join-Path $repoRoot 'docs\customer-1\automation\lanes.json')).config.maxConcurrentClaude -eq 1
    }

} finally {
    if ($KeepSandbox) {
        Write-Host ''
        Write-Host "sandbox kept at $sandbox"
    } else {
        # Lane worktrees hold git locks; remove the tree, not the repo's registry.
        Remove-Item -LiteralPath $sandbox -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host ''
if ($script:failures -eq 0) {
    Write-Host "FRAMEWORK REGRESSION SUITE: PASS ($script:checks checks, 0 failures)" -ForegroundColor Green
    exit 0
} else {
    Write-Host "FRAMEWORK REGRESSION SUITE: FAIL ($script:failures of $script:checks)" -ForegroundColor Red
    exit 1
}
