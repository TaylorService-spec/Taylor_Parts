# EOS SANDBOX REFRESH -- the operator entry point.
#
# Usage, from anywhere:
#   .\sandbox-refresh.ps1                 full refresh -- Functions, then Hosting
#   .\sandbox-refresh.ps1 -HostingOnly    Hosting only -- no Functions deploy
#
# -HostingOnly exists because the two authorities have different release cadences. A release whose
# diff touches no functions/ file still had to redeploy the entire Functions estate to ship a
# frontend: authority that release does not need, and this repository's own documented failure mode
# (a large batch exits non-zero after some functions have already updated). It changes the SCOPE and
# nothing else -- every guard, build verification, artifact stamp and identity gate still runs.
#
# If PowerShell's execution policy blocks it (this does NOT require changing the machine-wide
# policy, and does NOT require Administrator):
#   powershell -ExecutionPolicy Bypass -File .\sandbox-refresh.ps1
#
# ==================== WHY THIS FILE EXISTS ====================
#
# The governed runbook is a bash script, and every attempt to launch it from PowerShell has cost the
# operator a fight with a different part of the same problem: `bash` resolving to the WSL shim
# instead of Git Bash (a different machine, without Windows node/npm/firebase on PATH), Git Bash not
# inheriting the caller's working directory so the script's own relative anchoring resolved against
# D:\Git, and the quoting needed to survive both. Three separate failures, none of them about the
# deployment.
#
# That is an operator UX defect, and the fix is an adapter -- not a second implementation.
#
# ==================== WHAT THIS IS NOT ====================
#
# THIS IS NOT A DEPLOYMENT. It contains no firebase invocation, no deploy ordering, no environment
# resolution and no guard logic. It locates the existing launcher and hands off. The deploy ordering
# in _sandboxRefresh.run.sh -- build-base before the environment build, artifact verification before
# Hosting -- is subtle, load-bearing, and the direct cause of the 2026-08-19 incident. A second copy
# of that ordering would be free to drift from the first. There must only ever be one.
#
# Every governance control still runs, inside the governed script, untouched:
#   _sandboxDeployGuard.mjs      role != production, projectId == eos-platform-sandbox
#   _releaseProvenanceGuard.mjs  HEAD is contained in origin/main and is its tip; tree is clean
#   the toolchain preflight      node/npm/firebase present, named if missing
#
# ==================== ASCII ONLY, DELIBERATELY ====================
#
# Windows PowerShell 5.1 reads a .ps1 as ANSI (CP1252) unless it carries a UTF-8 BOM. A UTF-8 em
# dash decodes to three CP1252 characters, the last of which is a closing curly quote -- so a stray
# em dash in a COMMENT silently breaks string parsing further down the file. Keep every character
# in this file inside plain ASCII.

# [CmdletBinding()] with no positional parameters means an unrecognised argument is a BINDING ERROR,
# not something silently dropped. A typo like -HostingOnl must not fall through to the full refresh
# the operator was trying to avoid -- that is the one dangerous way this feature could fail.
[CmdletBinding()]
param(
    [switch]$HostingOnly
)

$ErrorActionPreference = 'Stop'

# THE REPOSITORY IS FOUND FROM THIS FILE, never from the caller's location. `cd` somewhere else and
# run it by full path and it still targets the repository it lives in -- which is the whole point,
# because "it resolved against the wrong root and cd succeeded anyway" is one of the failures above.
$repoRoot = $PSScriptRoot
$launcher = Join-Path $repoRoot 'scripts/Invoke-SandboxRefresh.ps1'
$runbook  = Join-Path $repoRoot 'scripts/_sandboxRefresh.run.sh'

Write-Host "========================================"
Write-Host "EOS SANDBOX REFRESH"
Write-Host "Repository: $repoRoot"
Write-Host "Target: eos-platform-sandbox"
if ($HostingOnly) {
    Write-Host "Mode:   HOSTING-ONLY (Functions are not built or deployed)"
} else {
    Write-Host "Mode:   FULL (Functions, then Hosting)"
}
Write-Host "========================================"
Write-Host ""

# Missing pieces are named, rather than surfacing four steps later as a confusing bash error.
if (-not (Test-Path $runbook)) {
    Write-Host "========================================"
    Write-Host "SANDBOX REFRESH FAILED"
    Write-Host "Exit code: 2"
    Write-Host "========================================"
    Write-Host "The governed runbook is missing: $runbook" -ForegroundColor Red
    Write-Host "This wrapper only launches it; it cannot deploy on its own." -ForegroundColor Red
    exit 2
}
if (-not (Test-Path $launcher)) {
    Write-Host "========================================"
    Write-Host "SANDBOX REFRESH FAILED"
    Write-Host "Exit code: 2"
    Write-Host "========================================"
    Write-Host "The launcher is missing: $launcher" -ForegroundColor Red
    exit 2
}

# Hand off. Output is NOT captured or filtered -- the governed script's stdout and stderr go
# straight to the console, because the deployed version.json it prints at the end is the thing the
# operator actually has to read. A wrapper that swallowed it would hide the only real evidence.
if ($HostingOnly) { & $launcher -HostingOnly } else { & $launcher }
$code = $LASTEXITCODE

Write-Host ""
if ($code -ne 0) {
    Write-Host "========================================"
    Write-Host "SANDBOX REFRESH FAILED"
    Write-Host "Exit code: $code"
    Write-Host "========================================"
    # EXIT 3 MEANS A GUARD REFUSED BEFORE ANY DEPLOY STEP RAN, so nothing shipped. Saying "some
    # functions may already have deployed" there sends the operator hunting for a partial deploy
    # that never happened -- the opposite of the reassurance it was meant to give.
    if ($code -eq 3) {
        Write-Host "NOTHING WAS DEPLOYED. A pre-flight guard refused the release." -ForegroundColor Yellow
        Write-Host "Fix what the ABORT above names, then re-run." -ForegroundColor Yellow
    } elseif ($HostingOnly) {
        # NO FUNCTIONS RAN, so the usual warning would send the operator hunting for a partial
        # Functions deploy that could not have happened. Saying the wrong reassuring thing is the
        # same defect as saying nothing.
        Write-Host "Hosting-only: NO Functions were built or deployed. Check which step failed above." -ForegroundColor Red
        Write-Host "Every step is idempotent, so re-running is safe." -ForegroundColor Red
    } else {
        # A half-finished deploy IS the dangerous outcome: some functions may already have updated.
        # Re-running is safe (every step is idempotent), but read WHICH batch failed first.
        Write-Host "Some functions may already have deployed. Check which step failed above." -ForegroundColor Red
        Write-Host "Every step is idempotent, so re-running is safe." -ForegroundColor Red
    }
    exit $code
}

Write-Host "========================================"
Write-Host "SANDBOX REFRESH COMPLETE"
Write-Host "========================================"
# A clean exit is NOT evidence the artifact is live. The script printed the deployed version.json;
# that, not this exit code, is the thing to compare against the expected commit.
Write-Host "Compare the deployed 'commit' printed above against the expected commit." -ForegroundColor Green
exit 0
