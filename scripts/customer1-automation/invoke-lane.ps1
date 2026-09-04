<#
.SYNOPSIS
    Run exactly one bounded, non-interactive Claude Code session for a lane.

.DESCRIPTION
    The prompt is delivered on stdin. stdout, stderr and the process exit code
    are captured to disk. The session is killed if it exceeds the timeout.

    This script does not judge the session. It returns what the process did.
    verify-result.ps1 decides what actually happened in the repository.
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
    [switch]$ReadOnly
)

. (Join-Path (Split-Path -Parent $PSCommandPath) '_common.ps1')

if (-not (Test-Path $ClaudeExe)) {
    throw "STOP: Claude Code executable not found at '$ClaudeExe'. Update config.claudeExe in lanes.json."
}
if (-not (Test-Path $WorktreePath)) { throw "Lane worktree not found: $WorktreePath" }
if (-not (Test-Path $PromptPath))   { throw "Prompt file not found: $PromptPath" }

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$stdoutPath = Join-Path $LogDir "lane-$LaneId.stdout.log"
$stderrPath = Join-Path $LogDir "lane-$LaneId.stderr.log"

# A stale result file from a previous session would be read as this session's
# claim. Remove it before starting.
$resultPath = Join-Path $WorktreePath $ResultFileName
if (Test-Path $resultPath) { Remove-Item -LiteralPath $resultPath -Force }

if ($PermissionMode -in @('bypassPermissions', 'dontAsk')) {
    throw "STOP: permission mode '$PermissionMode' is not permitted for lane workers."
}

$args = @('-p', '--permission-mode', $PermissionMode)

# The firebase MCP server is connected at user scope with firestore and auth
# toolsets -- a live production-mutation surface a lane worker must never
# inherit. --strict-mcp-config with no --mcp-config yields zero MCP servers.
if ($StrictMcpConfig) { $args += '--strict-mcp-config' }

# Read-only probes (preflight) get no write or execution tools at all.
$deny = @($DisallowedTools)
if ($ReadOnly) { $deny += @('Edit', 'Write', 'NotebookEdit', 'Bash', 'Task', 'Agent') }
$deny = @($deny | Where-Object { $_ } | Sort-Object -Unique)
if ($deny.Count -gt 0) { $args += @('--disallowed-tools') + $deny }

# acceptEdits auto-approves file edits but NOT Bash, so an unattended worker
# cannot commit its own work -- it has no one to ask. Name the narrow set of
# commands a worker legitimately needs. This is an allowlist, not a bypass:
# everything unnamed is still refused, and bypassPermissions stays forbidden.
$allow = @($AllowedTools | Where-Object { $_ })
if (-not $ReadOnly -and $allow.Count -gt 0) { $args += @('--allowed-tools') + $allow }

Write-Step "Lane $LaneId : starting Claude session (timeout ${TimeoutSec}s). Args: $($args -join ' ')"
$started = Get-UtcStamp

$proc = Start-Process -FilePath $ClaudeExe `
    -ArgumentList $args `
    -WorkingDirectory $WorktreePath `
    -RedirectStandardInput $PromptPath `
    -RedirectStandardOutput $stdoutPath `
    -RedirectStandardError $stderrPath `
    -NoNewWindow -PassThru

$timedOut = $false
if (-not $proc.WaitForExit($TimeoutSec * 1000)) {
    $timedOut = $true
    Write-Step "Lane $LaneId : timeout after ${TimeoutSec}s; terminating session." 'WARN'
    try { $proc.Kill($true) } catch { try { $proc.Kill() } catch { } }
    $proc.WaitForExit(30000) | Out-Null
}

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
    stdoutPath = $stdoutPath
    stderrPath = $stderrPath
    resultPath = if (Test-Path $resultPath) { $resultPath } else { $null }
    claim      = $claim
}
