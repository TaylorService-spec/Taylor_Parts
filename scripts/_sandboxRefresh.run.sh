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

echo "== [3a/5] verify the build-base contract =="
# MUST RUN BEFORE THE ENVIRONMENT BUILD. verifyBuildBase.mjs deletes dist/ and
# rebuilds it TWICE with the plain npm scripts (npm run build, npm run
# build:firebase) -- neither of which sets an environment, so both resolve to the
# registry default, which is PRODUCTION. Running it after the environment build
# silently replaces the correct artifact with a production-stamped one.
#
# That is what actually caused the 2026-08-19 incident. The environment variable
# was never the problem: step 3 built correctly and this step overwrote it.
( cd field-ops-app-vite && npm run verify:build-base )

echo "== [3b/5] build frontend for platform-sandbox (LAST build before deploy) =="
# The environment is an ARGUMENT, not a shell variable, and buildForEnvironment
# re-reads the emitted version.json and refuses if the artifact is not stamped as
# asked. Nothing may rebuild dist/ after this point.
( cd field-ops-app-vite && node scripts/buildForEnvironment.mjs platform-sandbox )

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
