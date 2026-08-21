#!/usr/bin/env bash
# SANDBOX REFRESH REGRESSION GATE -- run AFTER a deploy, against the DEPLOYED build.
#
# A deployed build is not an accepted sandbox refresh until this passes.
#
# WHY THIS EXISTS. Deployment verification answers "did the bytes land" -- it reads /version.json and
# confirms the commit. It cannot answer "does the thing work", and the two have already diverged in
# this project: a deploy that verified clean still shipped a stylesheet that had silently dropped 63
# live CSS rules, because nothing that ran at deploy time renders a page.
#
# So this gate runs the SAME certification instruments that closed the local axes, pointed at the
# deployed origin through CERT_BASE. Same tools, same thresholds, different target -- a gate that can
# only be pointed at localhost certifies the developer's machine, not the build users will get.
#
# Usage:
#   ./scripts/_sandboxRegressionGate.sh [origin]
# Default origin is the sandbox Hosting site. Every step exits non-zero on failure and the script
# uses `set -e`, so a partial pass cannot be mistaken for an accepted refresh.
set -euo pipefail

ORIGIN="${1:-https://eos-platform-sandbox.web.app}"
export CERT_BASE="${ORIGIN}/Taylor_Parts/field-ops"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

echo "== sandbox regression gate =="
echo "   target: ${CERT_BASE}"

# 1. DEPLOYMENT IDENTITY FIRST. Everything below is meaningless if it is certifying the previous
#    build, and "the deploy command exited 0" is not evidence of what is actually being served.
echo "== [1/6] deployed identity =="
DEPLOYED="$(curl -fsS "${ORIGIN}/version.json")"
echo "$DEPLOYED"
DEPLOYED_SHA="$(printf '%s' "$DEPLOYED" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>process.stdout.write(JSON.parse(d).commit||""))')"
LOCAL_SHA="$(git rev-parse --short=8 HEAD)"
if [ "$DEPLOYED_SHA" != "$LOCAL_SHA" ]; then
  echo "!! deployed ${DEPLOYED_SHA} != local HEAD ${LOCAL_SHA} -- refusing to certify a build that is not this one."
  exit 1
fi

# 2. REPO-SIDE GUARDS. Cheap, and they catch the classes that render fine and are still wrong --
#    orphaned CSS classes, a created record that cannot be reached, an id rendered where a name
#    belongs, and a detector that has stopped being able to fail.
echo "== [2/6] repo guards (css coverage, create-reach invariant, identity, detector trust) =="
( cd field-ops-app-vite && npm test )

# 3. STRUCTURAL + RESPONSIVE SWEEP against the deployed build. certify.mjs exits non-zero if any
#    visit went unmeasured, so a partial sweep cannot pass this gate.
echo "== [3/6] structural + responsive sweep (5 widths) =="
# NOTE: a single invocation, deliberately. An earlier draft wrote `run-sweep || run-sweep-again`,
# which means a FAILING sweep silently re-runs and can pass on the retry -- turning the one check
# that reports incomplete coverage into a check that hides it. There is no retry here on purpose.
( cd field-ops-app-vite && node ".claude/skills/run-field-ops-app-vite/certify.mjs" admin 1440,1024,768,375,320 )

# 4. PERSONA REACHABILITY. The representative three, not all fifteen -- the fixture-only identities
#    belong to targeted suites, and sweeping them here buys duplicate coverage at real cost.
echo "== [4/6] persona reachability (representative set) =="
for p in ineligibleDispatcher technicianMultiRole eligiblePartsManager; do
  ( cd field-ops-app-vite && node ".claude/skills/run-field-ops-app-vite/reachability.mjs" "$p" 1440 )
done

# 5. THE JOURNEY THAT REGRESSED. A created record must be reachable; a static invariant cannot see an
#    index that was never deployed, which is exactly the risk a fresh environment carries.
echo "== [5/6] create -> reach =="
( cd field-ops-app-vite && node ".claude/skills/run-field-ops-app-vite/createReach.mjs" admin )

# 6. SCANNER SCENARIOS. Six must succeed and six must REFUSE; a refusal that passes by succeeding is
#    a release failure, which is why the runner compares against each case's declared expectation.
echo "== [6/6] scanner scenarios =="
node scripts/runSandboxScannerScenarios.mjs

echo
echo "SANDBOX REGRESSION GATE: PASS -- deployed ${DEPLOYED_SHA} accepted."
