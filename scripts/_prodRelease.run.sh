#!/usr/bin/env bash
# PRODUCTION RELEASE RUNBOOK -- taylor-parts.
#
# Deliberately NOT a copy of _sandboxRefresh.run.sh with the project id swapped.
# Sandbox is disposable and production is not, so the differences are the point:
#
#   * every destructive or ambiguous step requires saying "taylor-parts" out loud
#   * NO --force on the Functions deploy (sandbox uses it; production must not
#     silently delete a Function that has merely gone missing from the source)
#   * Firestore Rules are NOT deployed here at all -- they are Tier 2 and carry
#     their own authorization and verification path (see the note in step 5)
#   * the live state is captured BEFORE anything changes, so a rollback has
#     something to roll back TO rather than a guess
#
# Requires: firebase CLI logged in with deploy access to taylor-parts, node/npm
# on PATH. Run from anywhere; the script locates the repo itself.
#
#   ./scripts/_prodRelease.run.sh --confirm taylor-parts
#
# ------------------------------------------------------------------------------
# WHAT THIS SCRIPT WILL NOT DO, and why you should not "fix" that:
#
#   - It will not deploy firestore.rules. A Rules change is a Tier-2 protected
#     action with a separate approval and a separate verification (the
#     verify-rules-deploy skill). Bundling it into a release script is how a Rules
#     change ships without anyone deciding to ship it.
#   - It will not run with --force. If the Functions deploy reports that it would
#     delete something, STOP and find out why. In production, "delete the Function
#     that is no longer in the source" and "delete the Function whose source
#     failed to compile" look identical to the CLI.
#   - It will not skip the artifact guard. That guard exists because on
#     2026-08-19 a sandbox refresh published a PRODUCTION-configured artifact and
#     nothing noticed: the build succeeded, the base check passed, and the deploy
#     targeted the right project. Only the artifact was wrong.
# ------------------------------------------------------------------------------
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

PROJECT_ID="taylor-parts"
ENVIRONMENT_ID="taylor-parts-production"

# ---- 0. explicit confirmation ------------------------------------------------
if [ "${1:-}" != "--confirm" ] || [ "${2:-}" != "$PROJECT_ID" ]; then
  echo "REFUSING: production release requires explicit confirmation."
  echo "  ./scripts/_prodRelease.run.sh --confirm $PROJECT_ID"
  exit 1
fi

echo "== [0/7] what is live BEFORE this release =="
# Captured first so a rollback has a target. Production's SPA catch-all returns
# index.html for any unmatched path, so an ABSENT version.json arrives as HTML
# with status 200 -- content is checked, never the status code.
echo "-- current production hosting --"
CURRENT="$(curl -fsS --max-time 20 "https://${PROJECT_ID}.web.app/version.json" 2>/dev/null || true)"
if printf '%s' "$CURRENT" | head -c 1 | grep -q '{'; then
  printf '%s\n' "$CURRENT"
else
  echo "  NO READABLE version.json (SPA catch-all returned HTML)."
  echo "  The live build predates the version manifest. Record the current asset"
  echo "  bundle hash below as the rollback identity instead:"
  curl -fsS --max-time 20 "https://${PROJECT_ID}.web.app/" 2>/dev/null \
    | grep -oE '/assets/index-[^"]*\.js' | head -1 | sed 's/^/    /' || echo "    (could not read)"
fi
echo "-- release candidate --"
echo "    commit $(git rev-parse --short HEAD) on $(git rev-parse --abbrev-ref HEAD)"

# ---- 1. the tree must be clean and pushed ------------------------------------
echo "== [1/7] release-candidate integrity =="
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "REFUSING: the working tree has uncommitted changes."
  echo "  A production release must be reproducible from a commit that exists in the remote."
  git status --short --untracked-files=no
  exit 1
fi
git fetch --quiet origin
if ! git merge-base --is-ancestor HEAD origin/main; then
  echo "REFUSING: HEAD is not an ancestor of origin/main."
  echo "  Production ships reviewed, merged code -- not a branch and not a local commit."
  exit 1
fi
echo "  OK: clean tree, and HEAD is contained in origin/main."

# ---- 2. tests, before anything is built for release --------------------------
echo "== [2/7] verification =="
( cd functions && npm run build && npm run test:access )
( cd field-ops-app-vite && npm test && npx vitest run && npm run typecheck )

# ---- 3. build-base contract (destroys dist -- MUST precede the real build) ----
echo "== [3/7] build-base contract =="
# verifyBuildBase.mjs deletes dist/ and rebuilds it twice with the plain npm
# scripts, which resolve to the registry default. It must therefore run BEFORE the
# environment build, never after -- that ordering mistake is what caused the
# 2026-08-19 sandbox incident.
( cd field-ops-app-vite && npm run verify:build-base )

# ---- 4. the release build (LAST build; nothing may rebuild dist after this) ---
echo "== [4/7] build frontend for $ENVIRONMENT_ID =="
( cd field-ops-app-vite && node scripts/buildForEnvironment.mjs "$ENVIRONMENT_ID" )

echo "== [4b/7] verify the ARTIFACT belongs to this project =="
node scripts/verifyDeployArtifact.mjs --projectId "$PROJECT_ID" --confirmProduction "$PROJECT_ID"

# ---- 5. Rules: check only, never deploy --------------------------------------
echo "== [5/7] Firestore Rules posture (CHECK ONLY) =="
echo "  This script does NOT deploy firestore.rules. If the committed Rules differ"
echo "  from what is live, that is a Tier-2 change requiring its own authorization"
echo "  and the verify-rules-deploy checklist. Deploying application code against"
echo "  Rules that were never reviewed is the failure this separation prevents."
echo "  Committed firestore.rules sha: $(git rev-parse --short HEAD:firestore.rules 2>/dev/null || echo 'n/a')"

# ---- 6. deploy ---------------------------------------------------------------
echo "== [6/7] deploy Functions -> $PROJECT_ID (NO --force) =="
echo "  If this reports it would DELETE a Function, abort and investigate."
( cd functions && npm run build )
firebase deploy --only functions --project "$PROJECT_ID"

echo "== [6b/7] deploy Hosting -> $PROJECT_ID =="
node scripts/verifyDeployArtifact.mjs --projectId "$PROJECT_ID" --confirmProduction "$PROJECT_ID"
firebase deploy --only hosting --project "$PROJECT_ID"

# ---- 7. prove what actually shipped ------------------------------------------
echo "== [7/7] verify the deployed revision =="
echo "  expected commit: $(git rev-parse --short HEAD)"
echo "  deployed version.json:"
curl -fsS --max-time 30 "https://${PROJECT_ID}.web.app/version.json" || echo "  (unreadable)"
echo
echo "  Confirm ALL of the following before calling this released:"
echo "    - commit matches the expected commit above"
echo "    - environmentId is $ENVIRONMENT_ID"
echo "    - environmentRole is production"
echo "  A mismatch on the LAST one is the 2026-08-19 failure mode and means the"
echo "  wrong artifact shipped. Roll back to the identity captured in step 0."
