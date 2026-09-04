<#
.SYNOPSIS
    Classify how origin/main has moved relative to a lane, and integrate it when
    that is safe.

.DESCRIPTION
    Emits one of:
      NO_ADVANCE          main unchanged since the lane last reconciled
      NO_OVERLAP          main changed files the lane has not touched
      SAFE_OVERLAP        overlap confined to paths the lane owns
      SEMANTIC_COLLISION  overlap outside owned paths, or the merge conflicts
      AUTHORITY_COLLISION main touched a governed authority path

    Valid lane work is never discarded because main moved. On any collision the
    merge is aborted and the lane branch is left exactly as it was.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$LaneId,
    [Parameter(Mandatory)][string]$WorktreePath,
    [string]$Branch,
    [string]$LastReconciledMain,
    [string[]]$OwnedPaths = @(),
    [string[]]$ForbiddenPaths = @(),
    [string]$MainRef = 'origin/main',
    [switch]$Apply
)

. (Join-Path (Split-Path -Parent $PSCommandPath) '_common.ps1')
. (Join-Path (Split-Path -Parent $PSCommandPath) 'checkpoint.ps1')

function New-Result {
    param($Classification, $MainSha, $Overlap, $Integrated, $Message)
    [pscustomobject]@{
        laneId         = $LaneId
        classification = $Classification
        mainSha        = $MainSha
        mainChanged    = @()
        laneChanged    = @()
        overlap        = @($Overlap)
        integrated     = [bool]$Integrated
        message        = $Message
    }
}

if (-not (Test-Path $WorktreePath)) {
    return New-Result 'NO_ADVANCE' $null @() $false "Lane worktree does not exist yet; nothing to reconcile."
}

$mainSha = Get-MainSha -Directory $WorktreePath -MainRef $MainRef

if ($LastReconciledMain -and $LastReconciledMain -eq $mainSha) {
    return New-Result 'NO_ADVANCE' $mainSha @() $false "main is unchanged at $($mainSha.Substring(0,8))."
}

# What main changed since this lane last reconciled. With no prior reconcile
# point there is nothing to compare, so treat it as a clean start.
$mainChanged = @()
if ($LastReconciledMain) {
    $mainChanged = (Invoke-Git -Directory $WorktreePath `
        -Arguments @('diff', '--name-only', "$LastReconciledMain..$mainSha") -AllowFail).Output |
        Where-Object { $_ }
}

# What this lane changed, relative to its merge base with main.
$laneChanged = @()
if ($Branch) {
    $base = (Invoke-Git -Directory $WorktreePath -Arguments @('merge-base', $MainRef, 'HEAD') -AllowFail)
    if ($base.ExitCode -eq 0 -and $base.Output) {
        $laneChanged = (Invoke-Git -Directory $WorktreePath `
            -Arguments @('diff', '--name-only', "$($base.Output[0])..HEAD") -AllowFail).Output |
            Where-Object { $_ }
    }
}

$overlap = @($mainChanged | Where-Object { $laneChanged -contains $_ })

# An authority path moving on main is never reconciled by guessing, whether or
# not this lane touched it.
$authorityMoved = Select-ForbiddenPaths -Paths @($mainChanged) -ForbiddenPatterns $ForbiddenPaths
if ($authorityMoved.Count -gt 0) {
    $r = New-Result 'AUTHORITY_COLLISION' $mainSha $overlap $false `
        "main moved a governed authority path: $($authorityMoved -join ', '). Automation must not reconcile this."
    $r.mainChanged = @($mainChanged); $r.laneChanged = @($laneChanged)
    return $r
}

$classification = if ($overlap.Count -eq 0) {
    'NO_OVERLAP'
} elseif ((Select-UnownedPaths -Paths $overlap -OwnedPatterns $OwnedPaths).Count -eq 0) {
    'SAFE_OVERLAP'
} else {
    'SEMANTIC_COLLISION'
}

$integrated = $false
$message = "main advanced to $($mainSha.Substring(0,8)); classified $classification."

if ($Apply -and $classification -in @('NO_OVERLAP', 'SAFE_OVERLAP')) {
    # Stamp the integration so history reads honestly: the harness pulling main
    # in, not lane work. This is EVIDENCE, not a control -- the classifier that
    # keeps such a merge out of legacy bootstrap is structural, because the merges
    # that stranded lanes were made before any marker existed.
    $mergeMsg = @"
chore(customer-1): integrate $MainRef into lane $LaneId

Upstream reconciliation performed by the Customer 1 orchestrator. This commit
carries no lane work: every path in it comes from $MainRef.

$(Get-C1ReconcileMarker -MainSha $mainSha)
"@
    $merge = Invoke-Git -Directory $WorktreePath -Arguments @('merge', '--no-edit', '-m', $mergeMsg, $MainRef) -AllowFail
    if ($merge.ExitCode -eq 0) {
        $integrated = $true
        $message += ' Integrated cleanly.'
    } else {
        # A textual conflict means the overlap was not as safe as the path
        # analysis suggested. Leave the lane untouched and escalate.
        Invoke-Git -Directory $WorktreePath -Arguments @('merge', '--abort') -AllowFail | Out-Null
        $classification = 'SEMANTIC_COLLISION'
        $message = "main advanced to $($mainSha.Substring(0,8)); merge conflicted and was aborted. Lane branch is unchanged."
    }
}

$r = New-Result $classification $mainSha $overlap $integrated $message
$r.mainChanged = @($mainChanged)
$r.laneChanged = @($laneChanged)
return $r
