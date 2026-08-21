# Sandbox refresh -- PowerShell entry point.
#
# WHY THIS EXISTS. `_sandboxRefresh.run.sh` is a bash script, and PowerShell cannot execute a .sh
# file directly: `./scripts/_sandboxRefresh.run.sh` fails with "not recognized as the name of a
# cmdlet". That is a confusing error for a script whose whole job is to be run by a human on this
# machine, and it has already cost one attempt.
#
# THIS IS A LAUNCHER, NOT A SECOND IMPLEMENTATION. It locates bash and hands off. The deploy
# ordering -- build-base BEFORE the environment build, artifact verification before Hosting -- is
# subtle, load-bearing, and the direct cause of the 2026-08-19 incident. A PowerShell
# reimplementation would be a second copy of that ordering, free to drift from the first. There must
# only ever be one.
#
# ASCII ONLY, DELIBERATELY. Windows PowerShell 5.1 reads a .ps1 as ANSI (CP1252) unless it carries a
# UTF-8 BOM. A UTF-8 em dash decodes to three CP1252 characters, the last of which (0x94) is a
# closing curly quote -- so a stray em dash in a COMMENT silently breaks string parsing further down
# the file. That is exactly how the first version of this script failed. Keep every character in
# this file inside plain ASCII.
#
# Usage, from the repo root:
#   .\scripts\Invoke-SandboxRefresh.ps1
#
# Deploys to eos-platform-sandbox ONLY. The underlying script aborts hard, at three separate points,
# if the target ever resolves to production.

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$runbook  = Join-Path $repoRoot 'scripts/_sandboxRefresh.run.sh'

if (-not (Test-Path $runbook)) {
    throw "Runbook not found: $runbook"
}

# Prefer the wrapper in Git's bin/, which sets up the environment the shell scripts expect. usr/bin
# is the fallback. `git` on PATH is the last resort, since Git for Windows keeps bash alongside it.
$candidates = @(
    'D:\Git\bin\bash.exe',
    'C:\Program Files\Git\bin\bash.exe',
    'D:\Git\usr\bin\bash.exe',
    'C:\Program Files\Git\usr\bin\bash.exe'
)

$bash = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $bash) {
    $gitCmd = Get-Command git -ErrorAction SilentlyContinue
    if ($gitCmd) {
        $guess = Join-Path (Split-Path -Parent (Split-Path -Parent $gitCmd.Source)) 'bin\bash.exe'
        if (Test-Path $guess) { $bash = $guess }
    }
}

if (-not $bash) {
    throw "Could not find Git Bash. Install Git for Windows, or run the runbook from a bash shell: bash ./scripts/_sandboxRefresh.run.sh"
}

Write-Host "Using bash: $bash"
Write-Host "Running:    scripts/_sandboxRefresh.run.sh"
Write-Host ""

Push-Location $repoRoot
try {
    # -lc so the login shell resolves node/npm/firebase from PATH the way an interactive Git Bash does.
    & $bash -lc './scripts/_sandboxRefresh.run.sh'
    $code = $LASTEXITCODE
}
finally {
    Pop-Location
}

Write-Host ""
if ($code -ne 0) {
    # Said explicitly, because a half-finished deploy is the dangerous outcome: some functions may
    # already have updated. Re-running is safe (every step is idempotent), but check WHICH batch
    # failed before assuming nothing shipped.
    Write-Host "FAILED (exit $code). Some functions may already have deployed." -ForegroundColor Red
    Write-Host "Check which batch failed above, then re-run. Every step is idempotent." -ForegroundColor Red
    exit $code
}

# A clean exit is NOT evidence the artifact is live. The script prints the deployed version.json;
# that, not this exit code, is the thing to read.
Write-Host "Completed. Compare the deployed 'commit' printed above against the expected commit." -ForegroundColor Green
