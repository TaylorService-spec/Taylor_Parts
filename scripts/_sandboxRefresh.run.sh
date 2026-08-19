#!/usr/bin/env bash
# One-cycle sandbox refresh runbook (interim tooling; NOT the canonical
# rebuild.mjs, which is a separate follow-up per Owner). Run from the repo
# root: `./scripts/_sandboxRefresh.run.sh`. Aborts hard if the target ever
# resolves to production. Sandbox-only; never taylor-parts.
#
# Requires the `firebase` CLI logged in with deploy access to
# eos-platform-sandbox, and `node`/`npm` on PATH. Intentionally NOT run by
# any agent session -- deploy is a human-triggered action.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

echo "== [0/5] structural safety guard =="
node scripts/_sandboxDeployGuard.mjs   # asserts role!=production, projectId==eos-platform-sandbox!=taylor-parts

echo "== [1/5] build functions lib =="
( cd functions && npm run build )

echo "== [2/5] deploy Functions -> eos-platform-sandbox =="
node scripts/_sandboxDeployGuard.mjs
firebase deploy --only functions --project eos-platform-sandbox --force

echo "== [3/5] build frontend for platform-sandbox =="
# MUST use build:firebase, NOT `VITE_BASE=/`. Under Git Bash / MSYS on Windows a
# bare `/` argument is rewritten to a Windows path before the process ever sees
# it, so VITE_BASE arrived as the MSYS root and the build stamped base "/Git/".
# Every asset URL in that artifact 404s against Hosting, which serves at "/".
# `build:firebase` passes `--base=/` as a single --flag=value token, which MSYS
# leaves alone, and it is the same script CI uses. Verified by verify:build-base.
# The environment is passed as an ARGUMENT, never through the shell.
#
# The previous form -- `VITE_ENVIRONMENT_ID=platform-sandbox npm run build:firebase`
# -- works in a plain bash shell and SILENTLY DOES NOT WORK when this script is
# invoked from PowerShell via Git Bash on Windows: the variable is lost in the
# PowerShell -> bash.exe -> npm.cmd -> vite chain. On 2026-08-19 that shipped a
# build stamped `taylor-parts-production` to the SANDBOX, so the sandbox URL
# served a client configured for the production Firebase project.
#
# It was invisible (build succeeded, base check passed, deploy targeted the right
# project) and not reproducible in bash -- the machine that verifies disagreed with
# the machine that deploys. buildForEnvironment.mjs sets it on the child process
# directly and then asserts the artifact came out stamped as asked.
( cd field-ops-app-vite && node scripts/buildForEnvironment.mjs platform-sandbox )

echo "== [3b/5] verify the built asset base BEFORE publishing it =="
# Cheap and load-bearing: a wrong base is invisible until the deployed page loads
# and every script tag 404s. Fail here rather than in front of a user.
( cd field-ops-app-vite && npm run verify:build-base )

echo "== [3c/5] verify the ARTIFACT belongs to this project =="
# The last check before anything ships. _sandboxDeployGuard.mjs above proves the
# TARGET is not production; this proves the ARTIFACT is not production either.
# Those are different questions, and on 2026-08-19 only the first was being asked.
node scripts/verifyDeployArtifact.mjs --projectId eos-platform-sandbox

echo "== [4/5] deploy Hosting -> eos-platform-sandbox =="
node scripts/_sandboxDeployGuard.mjs
firebase deploy --only hosting --project eos-platform-sandbox

echo "== [5/5] verify deployed revision (D2) =="
echo "expected commit: $(git rev-parse --short HEAD)"
echo "deployed version.json:"
curl -s https://eos-platform-sandbox.web.app/version.json
echo
echo "Compare 'commit' above to expected. NOTE: Rules/indexes are UNCHANGED vs the"
echo "currently-deployed sandbox SHA (9758ed2->HEAD), so no Rules deploy is required."
