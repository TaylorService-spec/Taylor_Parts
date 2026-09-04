<#
.SYNOPSIS
    Run exactly one bounded, non-interactive Claude Code session for a lane.

.DESCRIPTION
    The prompt is delivered on stdin. stdout, stderr and the process exit code
    are captured to disk in full. The session is killed if it exceeds the
    timeout, and a heartbeat reports measurable progress while it runs.

    This script does not judge the session. It returns what the process did.
    verify-result.ps1 decides what actually happened in the repository.

    ARGUMENT TOKENIZATION

    Start-Process joins -ArgumentList with spaces and lets the child re-parse the
    result, so an allowed-tool rule like `Bash(git status:*)` arrived as two argv
    tokens and the CLI rejected the fragment. Manually adding quotes only moved
    the problem around. ProcessStartInfo.ArgumentList applies the real Windows
    argument-escaping rules per element, so one element is always one argv token,
    spaces and all. That is the whole fix.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$LaneId,
    [Parameter(Mandatory)][string]$WorktreePath,
    [Parameter(Mandatory)][string]$PromptPath,
    [Parameter(Mandatory)][string]$LogDir,
    [Parameter(Mandatory)][string]$ClaudeExe,
    [string]$PermissionMode = 'acceptEdits',
    [int]$TimeoutSec = 3600,
    [string]$ResultFileName = '.orchestrator-result.json',
    [string[]]$DisallowedTools = @(),
    [string[]]$AllowedTools = @(),
    [switch]$StrictMcpConfig,
    [switch]$ReadOnly,
    # Heartbeat cadence. Zero disables it (the regression tests do this so a
    # sub-second fake worker does not print progress noise).
    [int]$HeartbeatSec = 45,
    $HeartbeatLane,
    [string]$HeartbeatWorkItem
)

. (Join-Path (Split-Path -Parent $PSCommandPath) '_common.ps1')
. (Join-Path (Split-Path -Parent $PSCommandPath) 'checkpoint.ps1')

if (-not (Test-Path $ClaudeExe)) {
    throw "STOP: Claude Code executable not found at '$ClaudeExe'. Update config.claudeExe in lanes.json."
}
if (-not (Test-Path $WorktreePath)) { throw "Lane worktree not found: $WorktreePath" }
if (-not (Test-Path $PromptPath))   { throw "Prompt file not found: $PromptPath" }

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$stdoutPath = Join-Path $LogDir "lane-$LaneId.stdout.log"
$stderrPath = Join-Path $LogDir "lane-$LaneId.stderr.log"
$argvPath   = Join-Path $LogDir "lane-$LaneId.argv.txt"

# A stale result file from a previous session would be read as this session's
# claim. Remove it before starting.
$resultPath = Join-Path $WorktreePath $ResultFileName
if (Test-Path $resultPath) { Remove-Item -LiteralPath $resultPath -Force }

if ($PermissionMode -in @('bypassPermissions', 'dontAsk')) {
    throw "STOP: permission mode '$PermissionMode' is not permitted for lane workers."
}

$argv = [System.Collections.Generic.List[string]]::new()
$argv.Add('-p')
$argv.Add('--permission-mode'); $argv.Add($PermissionMode)

# The firebase MCP server is connected at user scope with firestore and auth
# toolsets -- a live production-mutation surface a lane worker must never
# inherit. --strict-mcp-config with no --mcp-config yields zero MCP servers.
if ($StrictMcpConfig) { $argv.Add('--strict-mcp-config') }

# Read-only probes (preflight) get no write or execution tools at all.
$deny = @($DisallowedTools)
if ($ReadOnly) { $deny += @('Edit', 'Write', 'NotebookEdit', 'Bash', 'Task', 'Agent') }
$deny = @($deny | Where-Object { $_ } | Sort-Object -Unique)
if ($deny.Count -gt 0) {
    $argv.Add('--disallowed-tools')
    foreach ($d in $deny) { $argv.Add($d) }
}

# acceptEdits auto-approves file edits but NOT Bash. The allowlist names the
# narrow set of read-only commands a worker legitimately needs while working.
# It deliberately contains NO git write verb: the harness commits lane work only
# after verifying it, and a worker that could commit would be committing
# unverified changes ahead of the gate. Enforced here, not just in config, so a
# future edit to lanes.json cannot quietly restore the permission.
$allow = @($AllowedTools | Where-Object { $_ })
$gitWrites = @($allow | Where-Object { $_ -match '(?i)Bash\(\s*git\s+(add|commit|push|merge|rebase|reset|checkout|restore|clean|tag|worktree)' })
if ($gitWrites.Count -gt 0) {
    throw ("STOP: worker allowed-tools contains git write permission(s): $($gitWrites -join ', '). " +
           'The harness owns commits; a worker may never create one.')
}
if (-not $ReadOnly -and $allow.Count -gt 0) {
    $argv.Add('--allowed-tools')
    foreach ($a in $allow) { $argv.Add($a) }
}

Write-Step "Lane $LaneId : starting Claude session (timeout ${TimeoutSec}s). argv: $(($argv | ForEach-Object { "[$_]" }) -join ' ')"
Set-Content -LiteralPath $argvPath -Encoding UTF8 -Value @($argv)
$started = Get-UtcStamp
$startClock = Get-Date

$psi = [System.Diagnostics.ProcessStartInfo]::new()
$psi.FileName = $ClaudeExe
$psi.WorkingDirectory = $WorktreePath
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
$psi.RedirectStandardInput = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
# One element in, one argv token out. No manual quoting, no re-splitting.
foreach ($a in $argv) { $psi.ArgumentList.Add($a) }

$proc = [System.Diagnostics.Process]::new()
$proc.StartInfo = $psi
[void]$proc.Start()

# Both streams read asynchronously. Reading one to the end while the other fills
# its pipe buffer is the classic way to deadlock a redirected child.
$stdoutTask = $proc.StandardOutput.ReadToEndAsync()
$stderrTask = $proc.StandardError.ReadToEndAsync()

# A worker that dies before reading its prompt closes the pipe under us. That is
# a worker failure to be classified and retried, never a supervisor crash -- the
# whole sweep must not die because one session exited early.
try {
    $proc.StandardInput.Write((Get-Content -LiteralPath $PromptPath -Raw -Encoding UTF8))
    $proc.StandardInput.Close()
} catch {
    Write-Diag "lane $LaneId : worker closed stdin before the prompt was delivered ($($_.Exception.Message))." 'WARN'
}

$timedOut = $false
$deadline = $startClock.AddSeconds($TimeoutSec)
$nextBeat = if ($HeartbeatSec -gt 0) { $startClock.AddSeconds($HeartbeatSec) } else { [datetime]::MaxValue }

while (-not $proc.HasExited) {
    if ((Get-Date) -ge $deadline) {
        $timedOut = $true
        Write-Step "Lane $LaneId : timeout after ${TimeoutSec}s; terminating session." 'WARN'
        try { $proc.Kill($true) } catch { try { $proc.Kill() } catch { } }
        $proc.WaitForExit(30000) | Out-Null
        break
    }
    if ((Get-Date) -ge $nextBeat) {
        # Measurable facts only: elapsed wall clock, and how many files have
        # actually changed on disk. Never inferred from the worker's prose.
        $changed = 0
        try { $changed = @(Get-C1DirtyPaths -WorktreePath $WorktreePath -ResultFileName $ResultFileName).Count } catch { }
        if ($HeartbeatLane) {
            Write-C1Heartbeat -Lane $HeartbeatLane -WorkItem $HeartbeatWorkItem `
                -Elapsed ((Get-Date) - $startClock) -FilesChanged $changed
        }
        $nextBeat = (Get-Date).AddSeconds($HeartbeatSec)
    }
    Start-Sleep -Milliseconds 500
}

$proc.WaitForExit()
$stdout = $stdoutTask.GetAwaiter().GetResult()
$stderr = $stderrTask.GetAwaiter().GetResult()

# Durable and COMPLETE. Nothing here is filtered -- a fatal message on stderr
# that no timestamp prefix matches is exactly the output that once vanished.
Set-Content -LiteralPath $stdoutPath -Value $stdout -Encoding UTF8
Set-Content -LiteralPath $stderrPath -Value $stderr -Encoding UTF8
Write-Diag "lane $LaneId stdout ($($stdout.Length) chars) -> $stdoutPath"
if ($stderr) { Write-Diag "lane $LaneId stderr: $stderr" 'ERROR' }

$exitCode = if ($timedOut) { -1 } else { $proc.ExitCode }

# The worker's own account of what it did. This is a CLAIM, never proof.
$claim = $null
if (Test-Path $resultPath) {
    try {
        $claim = Get-Content -LiteralPath $resultPath -Raw -Encoding UTF8 | ConvertFrom-Json
    } catch {
        Write-Step "Lane $LaneId : result file is not valid JSON; ignoring the claim." 'WARN'
    }
}

Write-Step "Lane $LaneId : session ended (exit $exitCode)."

[pscustomobject]@{
    laneId     = $LaneId
    startedAt  = $started
    endedAt    = Get-UtcStamp
    exitCode   = $exitCode
    timedOut   = $timedOut
    stdout     = $stdout
    stderr     = $stderr
    stdoutPath = $stdoutPath
    stderrPath = $stderrPath
    argvPath   = $argvPath
    resultPath = if (Test-Path $resultPath) { $resultPath } else { $null }
    claim      = $claim
}
