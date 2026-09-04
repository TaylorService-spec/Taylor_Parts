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

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $PSCommandPath
$repoRoot = Resolve-Path (Join-Path $here '..\..') | Select-Object -ExpandProperty Path

. (Join-Path $here '_common.ps1')
. (Join-Path $here 'checkpoint.ps1')
. (Join-Path $here 'recover.ps1')

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
    param([string]$Mode = 'work', [int]$ExitCode = 0, [string[]]$ExtraArgs = @())
    $env:FAKE_CLAUDE_ARGV = $argvOut
    $env:FAKE_CLAUDE_CALLS = $callsOut
    $env:FAKE_CLAUDE_BEHAVIOR = $fakeBehavior
    $env:FAKE_CLAUDE_MODE = $Mode
    $env:FAKE_CLAUDE_EXIT = "$ExitCode"
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
    }
}

function Reset-FakeCounters { Remove-Item -LiteralPath $argvOut, $callsOut -Force -ErrorAction SilentlyContinue }

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
    Section 'D. Human-readable progress (§12, §14, §17)'

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
    Section 'E. Crash recovery (§5, §6)'

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
        ($r.status -eq 'COMPLETED_TRANSACTION') -and
        ((Invoke-Git -Directory $wtA -Arguments @('rev-parse', 'HEAD')).Output[0] -ne $head) -and
        (-not (Test-Path $sbx.PendingFile))
    }

    Check '11. interrupted AFTER the final checkpoint: nothing is duplicated' {
        $countBefore = @(Get-C1ItemReceipts -Context $sbx -LaneId 'A').Count
        $r = Invoke-C1LaneRecovery -Context $sbx -Lane $laneA -WorktreePath $wtA -Branch 'customer1/a-work' -ForbiddenPaths $forbidden
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
        $ok = ($r.status -eq 'FAILED_RECOVERY') -and $r.blocked -and
              ((Invoke-Git -Directory $wtB -Arguments @('rev-parse', 'HEAD')).Output[0] -eq $head)
        Remove-Item -LiteralPath (Join-Path $sbx.ItemsDir 'divergetest-B.json') -Force
        $ok
    }

    # ------------------------------------------------------------------------
    Section 'F. Retry policy (§10)'

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
    Section 'G. Continuous mode and safe-work exhaustion (§8, §9)'

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
    Section 'H. DryRun is inert (§22)'

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
