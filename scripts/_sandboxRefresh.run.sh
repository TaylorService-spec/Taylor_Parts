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
# DEPLOYED IN SMALL NAMED BATCHES, not one `--only functions` call.
#
# A large single batch transiently fails a SUBSET of the estate for reasons unrelated
# to IAM or org policy, and the failure mode is the bad one: the command exits
# non-zero after some functions have already updated, so the estate is left
# half-new. Named batches make a failure specific, and make the retry cheap and
# obvious -- rerun the one batch, not all eighty.
#
# `|| true` is deliberately NOT used. A failed batch must stop the script, because
# continuing to Hosting would ship a frontend that calls callables that are not there.
deploy_batch() {
  local label="$1"; shift
  echo "-- functions batch: ${label}"
  firebase deploy --only "$1" --project eos-platform-sandbox --force
}

deploy_batch "scanner: identity + balance reads" \
  "functions:resolveScannedPartIdentifier,functions:getPartBalance"
deploy_batch "scanner: bin registry" \
  "functions:createBin,functions:deactivateBin,functions:reactivateBin,functions:resolveBin,functions:listBins"
deploy_batch "scanner: placement + returns" \
  "functions:recordPutAway,functions:recordReturnIntake"
deploy_batch "receiving: canonical multi-line reads" \
  "functions:getPurchaseOrderReceivingProgress,functions:listReceivablePurchaseOrders"
# Everything else, after the scanner set is known good.
deploy_batch "remaining estate" "functions"

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
EXPECTED="$(git rev-parse --short HEAD)"
echo "expected commit: ${EXPECTED}"
echo "deployed version.json:"
curl -s https://eos-platform-sandbox.web.app/version.json
echo
echo "Compare 'commit' above to expected -- the ENVIRONMENT is the authority here, not this"
echo "script's exit code. A clean exit does not mean the artifact is live."

echo
echo "== [5b/5] verify the scanner callables are ACTIVE (read-only) =="
# Export is not deployment and deployment is not readiness. This asks the live estate.
node scripts/verifySandboxFunctions.mjs --project eos-platform-sandbox \
  receiveInventoryStock getPurchaseOrderReceivingProgress listReceivablePurchaseOrders \
  resolveScannedPartIdentifier getPartBalance getAvailableEquipment getLocationDisplay \
  createBin deactivateBin reactivateBin resolveBin listBins recordPutAway \
  recordReturnIntake dispatchTransferOrder receiveTransferOrder createCycleCount submitCycleCount

echo
echo "== Rules / indexes =="
# COMPUTED, not asserted from memory. An earlier version of this script carried a
# hardcoded "unchanged vs 9758ed2" note, which is the kind of claim that silently stops
# being true. This diffs the two files against the commit the sandbox is actually serving.
DEPLOYED_SHA="$(curl -s https://eos-platform-sandbox.web.app/version.json \
  | sed -n 's/.*"commit"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
if [ -n "${DEPLOYED_SHA}" ] && git cat-file -e "${DEPLOYED_SHA}^{commit}" 2>/dev/null; then
  if git diff --quiet "${DEPLOYED_SHA}" HEAD -- firestore.rules firestore.indexes.json; then
    echo "UNCHANGED vs ${DEPLOYED_SHA} -- no Rules or index deploy is required."
  else
    echo "CHANGED vs ${DEPLOYED_SHA}:"
    git diff --stat "${DEPLOYED_SHA}" HEAD -- firestore.rules firestore.indexes.json
    echo "A Rules/index deploy is a SEPARATE protected action. STOP and get it authorized."
  fi
else
  echo "Could not resolve the deployed commit locally -- verify Rules parity by hand."
fi
