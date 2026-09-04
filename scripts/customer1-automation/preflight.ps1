<#
.SYNOPSIS
    Determine what a lane worker actually receives when launched through
    noninteractive `claude -p`.

.DESCRIPTION
    Inspection and reporting only. This script never installs, modifies, or
    removes a plugin, skill, hook, setting, or MCP server.

    The distinction that matters: a lane worktree is a CLEAN checkout of
    origin/main. It gets user-scoped capability (machine-wide) and
    project-scoped capability (committed to the branch). It does NOT get
    anything that exists only as an untracked file in some other checkout --
    including, until it is committed, this orchestrator itself.

.PARAMETER Probe
    Additionally run ONE read-only `claude -p` session to prove headless
    configuration visibility. The probe prompt is read-only and the session is
    launched with write and execution tools disabled.

.PARAMETER Json
    Emit the preflight object instead of the formatted report.
#>
[CmdletBinding()]
param(
    [switch]$Probe,
    [switch]$Json,
    [int]$ProbeTimeoutSec = 180
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $PSCommandPath
. (Join-Path $here '_common.ps1')

$ctx = Get-C1Context
$lanesDoc = Read-JsonFile $ctx.LanesFile
$cfg = $lanesDoc.config

$userClaude = Join-Path $env:USERPROFILE '.claude'
$userConfig = Join-Path $env:USERPROFILE '.claude.json'

function Read-JsonIfPresent {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return $null }
    try { Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json } catch { $null }
}

function Read-JsonAsHashtable {
    <#
        ~/.claude.json contains project keys differing only by case, which
        ConvertFrom-Json rejects outright. -AsHashtable tolerates it.

        Returns { ok, data, error }. A read failure must never be reported as
        "nothing configured" -- for a safety preflight that is fail-open, and
        the whole point of this check is the opposite.
    #>
    param([string]$Path)
    if (-not (Test-Path $Path)) {
        return [pscustomobject]@{ ok = $false; data = $null; error = 'file not present' }
    }
    try {
        $d = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json -AsHashtable
        [pscustomobject]@{ ok = $true; data = $d; error = $null }
    } catch {
        [pscustomobject]@{ ok = $false; data = $null; error = $_.Exception.Message }
    }
}

# ------------------------------------------------------------- USER SCOPE
$userSettings = Read-JsonIfPresent (Join-Path $userClaude 'settings.json')
$installed = Read-JsonIfPresent (Join-Path $userClaude 'plugins\installed_plugins.json')

$enabledPlugins = @()
if ($userSettings -and $userSettings.PSObject.Properties['enabledPlugins']) {
    $enabledPlugins = @($userSettings.enabledPlugins.PSObject.Properties |
        Where-Object { $_.Value } | ForEach-Object { $_.Name })
}

$installedPlugins = @()
if ($installed -and $installed.PSObject.Properties['plugins']) {
    $installedPlugins = @($installed.plugins.PSObject.Properties | ForEach-Object {
        $inst = @($_.Value)[0]
        [pscustomobject]@{
            name    = $_.Name
            scope   = $inst.scope
            version = $inst.version
            enabled = ($enabledPlugins -contains $_.Name)
        }
    })
}

$userSkills = @()
$userSkillDir = Join-Path $userClaude 'skills'
if (Test-Path $userSkillDir) {
    $userSkills = @(Get-ChildItem $userSkillDir -Directory -ErrorAction SilentlyContinue | ForEach-Object { $_.Name })
}

$userHooks = @()
if ($userSettings -and $userSettings.PSObject.Properties['hooks']) {
    $userHooks = @($userSettings.hooks.PSObject.Properties | ForEach-Object { $_.Name })
}

# ---------------------------------------------------------- PROJECT SCOPE
# Committed == available in a clean lane worktree. Untracked == not available.
function Get-TrackedFiles {
    param([string]$PathSpec)
    @((Invoke-Git -Directory $ctx.Root -Arguments @('ls-files', $PathSpec) -AllowFail).Output | Where-Object { $_ })
}

$trackedClaude = Get-TrackedFiles '.claude'
$trackedClaudeMd = @(Get-TrackedFiles 'CLAUDE.md') + @(Get-TrackedFiles '**/CLAUDE.md')
$projectSkills = @($trackedClaude | Where-Object { $_ -like '.claude/skills/*/SKILL.md' } |
    ForEach-Object { ($_ -split '/')[2] })
$projectAgents = @($trackedClaude | Where-Object { $_ -like '.claude/agents/*' } |
    ForEach-Object { Split-Path -Leaf $_ })
$projectHookFiles = @($trackedClaude | Where-Object { $_ -like '.claude/hooks/*' })

$projectSettings = Read-JsonIfPresent (Join-Path $ctx.Root '.claude\settings.json')
$projectSettingsTracked = $trackedClaude -contains '.claude/settings.json'
$projectHookEvents = @()
$projectDeny = @()
if ($projectSettings) {
    if ($projectSettings.PSObject.Properties['hooks']) {
        $projectHookEvents = @($projectSettings.hooks.PSObject.Properties | ForEach-Object { $_.Name })
    }
    if ($projectSettings.PSObject.Properties['permissions'] -and
        $projectSettings.permissions.PSObject.Properties['deny']) {
        $projectDeny = @($projectSettings.permissions.deny)
    }
}

$localSettingsPresent = Test-Path (Join-Path $ctx.Root '.claude\settings.local.json')

# ------------------------------------------------------------------- MCP
$globalRead = Read-JsonAsHashtable $userConfig
$mcpReadable = $globalRead.ok
$mcpServers = @()
if ($globalRead.ok -and $globalRead.data.ContainsKey('mcpServers')) {
    $mcpServers = @($globalRead.data['mcpServers'].Keys | ForEach-Object {
        [pscustomobject]@{ name = $_; scope = 'user'; command = "$($globalRead.data['mcpServers'][$_].command)" }
    })
}
$projectRead = Read-JsonAsHashtable (Join-Path $ctx.Root '.mcp.json')
if ($projectRead.ok -and $projectRead.data.ContainsKey('mcpServers')) {
    $mcpServers += @($projectRead.data['mcpServers'].Keys | ForEach-Object {
        [pscustomobject]@{ name = $_; scope = 'project'; command = "$($projectRead.data['mcpServers'][$_].command)" }
    })
}

# Account-level connectors (claude.ai Gmail / Calendar / Drive) are not in any
# config file. `claude mcp list` is the only enumeration that sees them.
$mcpFromCli = @()
try {
    $cliOut = & $cfg.claudeExe 'mcp' 'list' 2>&1
    $mcpFromCli = @($cliOut | ForEach-Object { "$_" } |
        Where-Object { $_ -match '^\s*(.+?):\s+(.+?)\s+-\s+' } |
        ForEach-Object { ($_ -split ':')[0].Trim() })
} catch {
    $mcpReadable = $false
}

# ------------------------------------------ WORKTREE-LOCAL-ONLY (the trap)
# Untracked files here exist for THIS session and for nobody else. A lane
# worktree branched from origin/main will not have them.
$untracked = @((Invoke-Git -Directory $ctx.Root -Arguments @('status', '--porcelain', '-uall') -AllowFail).Output |
    Where-Object { $_ -match '^\?\? ' } | ForEach-Object { ($_ -replace '^\?\? ', '').Trim() })

$harnessFiles = @('docs/customer-1/automation/PROGRAM.md', $ctx.LanesFile, $ctx.StateFile, $ctx.BlockersFile) |
    ForEach-Object { ($_ -replace [regex]::Escape($ctx.Root + '\'), '') -replace '\\', '/' }
$harnessUntracked = @($untracked | Where-Object {
    Test-PathMatch -Path $_ -Patterns @($cfg.harnessOwnedPaths)
})

# The question that actually matters is not "is it untracked in THIS worktree"
# -- a lane worktree is branched from the base ref, so that is the only tree
# whose contents reach a worker. Publishing to a side branch does not change
# this; only a merge to the base ref does.
$probeFiles = @(
    'docs/customer-1/automation/PROGRAM.md',
    'docs/customer-1/automation/lanes.json',
    '.claude/skills/customer1-program/SKILL.md'
)
$missingOnBase = @($probeFiles | Where-Object {
    # './' prefix: git on Windows mangles 'rev:.claude/...' into a path.
    (Invoke-Git -Directory $ctx.Root -Arguments @('cat-file', '-e', "$($cfg.mainRef):./$_") -AllowFail).ExitCode -ne 0
})

# ------------------------------------------------------------ REQUIREMENTS
$missingRequired = @()
$missingOptional = @()

if ($missingOnBase.Count -gt 0) {
    $missingRequired += [pscustomobject]@{
        capability = "Orchestrator framework on $($cfg.mainRef)"
        detail = "$($missingOnBase.Count) of $($probeFiles.Count) probe file(s) are absent from $($cfg.mainRef): $($missingOnBase -join ', '). A lane worktree is branched from $($cfg.mainRef), so a worker would not see PROGRAM.md, the lane charters, or the customer1-program skill. Publishing to a side branch does not change this -- only a merge does."
        blocksLanes = 'ALL'
        mitigation = 'Non-blocking in practice: the harness inlines the full lane charter into the worker prompt, so a lane runs correctly without them. Merging the framework branch removes the gap entirely.'
    }
}

if (-not (Test-Path $cfg.claudeExe)) {
    $missingRequired += [pscustomobject]@{
        capability = 'Claude Code CLI'; detail = "Not found at $($cfg.claudeExe)."; blocksLanes = 'ALL'; mitigation = 'Update config.claudeExe.'
    }
}

if (-not $projectSettingsTracked) {
    $missingRequired += [pscustomobject]@{
        capability = 'Committed project permission deny-list'
        detail = '.claude/settings.json is not tracked, so lane worktrees inherit no project deny rules.'
        blocksLanes = 'ALL'; mitigation = 'Commit .claude/settings.json.'
    }
}

# Fail closed: unreadable config is treated as "servers may exist", never as none.
$mcpPresent = ($mcpServers.Count -gt 0) -or ($mcpFromCli.Count -gt 0) -or (-not $mcpReadable)
if ($mcpPresent -and -not $cfg.strictMcpConfig) {
    $missingRequired += [pscustomobject]@{
        capability = 'MCP isolation'
        detail = "MCP servers are present or undeterminable and would be visible to lane workers, including production-capable tooling."
        blocksLanes = 'ALL'; mitigation = 'Set config.strictMcpConfig = true.'
    }
}

foreach ($sk in @('customer1-program')) {
    if ($projectSkills -notcontains $sk) {
        $missingOptional += [pscustomobject]@{
            capability = "project skill '$sk'"
            detail = 'Not committed; unavailable in a clean lane worktree. The worker prompt is self-contained, so this is informational.'
        }
    }
}
if ($trackedClaudeMd.Count -eq 0) {
    $missingOptional += [pscustomobject]@{
        capability = 'committed CLAUDE.md'
        detail = 'No CLAUDE.md is tracked. Repo conventions reach the worker via the SessionStart hook and the prompt instead.'
    }
}

# -------------------------------------------------------------- THE PROBE
$probeResult = $null
if ($Probe) {
    $probeDir = Join-Path $ctx.LogsDir ('preflight-' + (Get-Date).ToString('yyyyMMdd-HHmmss'))
    New-Item -ItemType Directory -Force -Path $probeDir | Out-Null
    $promptPath = Join-Path $probeDir 'probe.prompt.txt'

    @"
READ-ONLY CAPABILITY PROBE. Do not create, edit, or delete any file. Do not run
any command. Do not use any tool. Answer only from your own configuration.

Reply with ONLY a JSON object, no prose, no code fence:

{
  "skills": ["<every skill name you can see>"],
  "plugins": ["<every plugin or plugin-provided skill namespace you can see>"],
  "mcpServers": ["<every MCP server you can see, or empty if none>"],
  "agents": ["<every subagent type you can see>"],
  "ponytailVisible": true|false,
  "cwd": "<your working directory>"
}
"@ | Set-Content -LiteralPath $promptPath -Encoding UTF8

    Write-Step 'Running ONE read-only headless probe (no write tools, no MCP).'
    $probeResult = & (Join-Path $here 'invoke-lane.ps1') `
        -LaneId 'PREFLIGHT' -WorktreePath $ctx.Root -PromptPath $promptPath -LogDir $probeDir `
        -ClaudeExe $cfg.claudeExe -PermissionMode 'plan' -TimeoutSec $ProbeTimeoutSec `
        -StrictMcpConfig:([bool]$cfg.strictMcpConfig) -ReadOnly

    # Parse what the headless session said it could see.
    try {
        $raw = Get-Content -LiteralPath $probeResult.stdoutPath -Raw -Encoding UTF8
        $probeSeen = ($raw -replace '(?s)^.*?(\{.*\}).*?$', '$1') | ConvertFrom-Json
    } catch { $probeSeen = $null }
    $probeResult | Add-Member -NotePropertyName seen -NotePropertyValue $probeSeen -Force

    # A worker that still sees MCP despite isolation is a harness security
    # failure, not a config nit. Surface it as blocking.
    if ($probeSeen -and @($probeSeen.mcpServers).Count -gt 0 -and $cfg.strictMcpConfig) {
        $missingRequired += [pscustomobject]@{
            capability = 'MCP isolation (VERIFIED FAILING)'
            detail = "strictMcpConfig is on but the headless session still saw: $(@($probeSeen.mcpServers) -join ', ')."
            blocksLanes = 'ALL'
            mitigation = 'Do not run a live lane until this is resolved.'
        }
    }
}

$result = [pscustomobject]@{
    generatedAt = Get-UtcStamp
    harnessRoot = $ctx.Root
    userScoped = [pscustomobject]@{
        settingsPath = (Join-Path $userClaude 'settings.json')
        plugins = $installedPlugins
        skills = $userSkills
        hookEvents = $userHooks
        env = if ($userSettings -and $userSettings.PSObject.Properties['env']) { $userSettings.env } else { $null }
    }
    projectScoped = [pscustomobject]@{
        settingsTracked = $projectSettingsTracked
        settingsLocalPresent = $localSettingsPresent
        claudeMdTracked = @($trackedClaudeMd)
        skills = @($projectSkills)
        agents = @($projectAgents)
        hookFiles = @($projectHookFiles)
        hookEvents = @($projectHookEvents)
        denyRuleCount = @($projectDeny).Count
    }
    mcpServers = @($mcpServers)
    mcpServersLive = @($mcpFromCli)
    mcpConfigReadable = $mcpReadable
    mcpConfigError = $globalRead.error
    mcpIsolationEnabled = [bool]$cfg.strictMcpConfig
    worktreeLocalOnly = @($harnessUntracked)
    harnessMissingOnBase = @($missingOnBase)
    missingRequired = @($missingRequired)
    missingOptional = @($missingOptional)
    probe = $probeResult
}

if ($Json) { return ($result | ConvertTo-Json -Depth 12) }

# ---------------------------------------------------------------- REPORT
$w = { param($t) Write-Host ''; Write-Host $t -ForegroundColor Cyan }

& $w 'USER-SCOPED CAPABILITIES'
foreach ($p in $installedPlugins) {
    Write-Host ("  plugin  {0,-45} {1,-8} {2}" -f $p.name, $p.version, $(if ($p.enabled) { 'ENABLED' } else { 'installed, disabled' }))
}
foreach ($s in $userSkills) { Write-Host "  skill   $s" }
Write-Host "  hooks   $(if ($userHooks) { $userHooks -join ', ' } else { '(none at user scope)' })"

& $w 'PROJECT-SCOPED CAPABILITIES (committed -> reaches a clean lane worktree)'
Write-Host "  .claude/settings.json tracked : $projectSettingsTracked  ($(@($projectDeny).Count) deny rules)"
Write-Host "  settings.local.json present   : $localSettingsPresent"
Write-Host "  CLAUDE.md tracked             : $(if ($trackedClaudeMd) { $trackedClaudeMd -join ', ' } else { '(none)' })"
Write-Host "  skills   : $(if ($projectSkills) { $projectSkills -join ', ' } else { '(none)' })"
Write-Host "  agents   : $(if ($projectAgents) { $projectAgents -join ', ' } else { '(none)' })"
Write-Host "  hooks    : $(if ($projectHookEvents) { $projectHookEvents -join ', ' } else { '(none)' }) via $(@($projectHookFiles).Count) file(s)"

& $w 'MCP SERVERS'
if (-not $mcpReadable) {
    Write-Host "  config unreadable ($($globalRead.error)) -- treated as SERVERS MAY EXIST" -ForegroundColor Yellow
}
if ($mcpServers.Count -eq 0 -and $mcpReadable) { Write-Host '  (none in config files)' }
foreach ($m in $mcpServers) { Write-Host ("  config  {0,-28} scope={1}  {2}" -f $m.name, $m.scope, $m.command) }
foreach ($m in $mcpFromCli) { Write-Host ("  live    {0}" -f $m) }
Write-Host "  isolation for lane workers (--strict-mcp-config): $([bool]$cfg.strictMcpConfig) -> worker sees ZERO MCP servers"

& $w 'HEADLESS/P-MODE AVAILABILITY'
if (-not $Probe) {
    Write-Host '  (not probed; re-run with -Probe)'
} elseif ($probeResult) {
    Write-Host "  exit code : $($probeResult.exitCode)  timedOut: $($probeResult.timedOut)"
    Write-Host "  stdout    : $($probeResult.stdoutPath)"
    $seen = $probeResult.seen
    if ($seen) {
        Write-Host "  cwd seen by worker    : $($seen.cwd)"
        Write-Host "  skills visible        : $(@($seen.skills).Count)"
        Write-Host "  plugins visible       : $(@($seen.plugins) -join ', ')"
        Write-Host "  MCP servers visible   : $(if (@($seen.mcpServers).Count -eq 0) { 'NONE (isolation confirmed)' } else { @($seen.mcpServers) -join ', ' })"
        Write-Host "  ponytail visible      : $($seen.ponytailVisible)"
    } else {
        Write-Host '  (probe produced no parseable capability JSON)' -ForegroundColor Yellow
    }
}

& $w 'WORKTREE-LOCAL-ONLY CAPABILITIES'
Write-Host "  untracked in THIS worktree            : $($harnessUntracked.Count) file(s)"
Write-Host "  absent from $($cfg.mainRef) (what a lane sees) : $(if ($missingOnBase.Count -eq 0) { 'none - framework reaches lane worktrees' } else { "$($missingOnBase.Count)/$($probeFiles.Count) probe files" })"
foreach ($f in $missingOnBase) { Write-Host "      absent on base: $f" }

& $w 'MISSING OPTIONAL CAPABILITIES'
if ($missingOptional.Count -eq 0) { Write-Host '  (none)' }
foreach ($m in $missingOptional) { Write-Host "  $($m.capability): $($m.detail)" }

& $w 'MISSING REQUIRED CAPABILITIES'
if ($missingRequired.Count -eq 0) { Write-Host '  (none)' -ForegroundColor Green }
foreach ($m in $missingRequired) {
    Write-Host "  [$($m.blocksLanes)] $($m.capability)" -ForegroundColor Yellow
    Write-Host "      $($m.detail)"
    Write-Host "      mitigation: $($m.mitigation)"
}

Write-Host ''
$result
