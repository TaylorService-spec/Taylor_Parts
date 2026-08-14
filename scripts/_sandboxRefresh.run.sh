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
( cd field-ops-app-vite && VITE_ENVIRONMENT_ID=platform-sandbox VITE_BASE=/ npx vite build )

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
