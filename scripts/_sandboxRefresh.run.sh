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

# ---------------------------------------------------------------------------------------------
# TOOLCHAIN PREFLIGHT -- fail here, with a name, rather than four steps in.
#
# On Windows a bare `bash` frequently resolves to the WSL shim in
# %LOCALAPPDATA%MicrosoftWindowsApps, NOT to Git Bash. WSL is a different machine with a
# different PATH: the Windows Node/npm/firebase install is simply not in it, so this script gets
# several steps into a deploy and then dies on "node: command not found" -- long after it has
# already started doing work, and with a message that blames the wrong thing.
#
# From PowerShell, use the launcher -- it finds the right bash and passes the release root:
#
#     .\scripts\Invoke-SandboxRefresh.ps1
#
# To run this script directly, use Git's bin/ WRAPPER:
#
#     & "D:/Git/bin/bash.exe" scripts/_sandboxRefresh.run.sh
#
# ============================ bin/bash.exe, NOT usr/bin/bash.exe ============================
#
# THIS DISTINCTION IS NOT COSMETIC, and this comment used to get it wrong -- it named
# usr/bin/bash.exe, which cost a live refresh attempt on 2026-08-26.
#
#   D:/Git/bin/bash.exe      a WRAPPER. It sets up the MSYS environment, so /usr/bin is on PATH
#                            and the coreutils every shell script assumes actually exist.
#   D:/Git/usr/bin/bash.exe  the RAW binary. Launched from PowerShell it inherits PowerShell's
#                            PATH and nothing else -- no /usr/bin, so no `dirname`, no `uname`.
#
# The failure that produces is misleading rather than obvious: `dirname: command not found`,
# then a root that resolved to nothing, then a module-not-found naming a path with an empty
# root (`\\scripts\\releaseRoot.mjs`). Every message blames the path; none names the shell.
#
# Root resolution below no longer depends on `dirname` at all, and the preflight now probes for
# coreutils so a wrong-shell invocation is REFUSED BY NAME instead of failing four lines later.
#
# (adjust the path if Git is installed elsewhere; `where.exe bash` lists every candidate).
# `dirname` is the CANARY, not a dependency -- nothing below calls it any more. It is the
# cheapest proof that this shell has /usr/bin on PATH, i.e. that it is a real Git Bash and not
# the raw usr/bin/bash.exe binary carrying PowerShell's PATH. Probing it here turns a confusing
# mid-script failure into a named refusal before anything is built.
for tool in node npm firebase dirname; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "ABORT: '$tool' is not on PATH in this shell." >&2
    echo "" >&2
    echo "  shell : $(uname -s 2>/dev/null || echo unknown)  ($BASH)" >&2
    echo "" >&2
    echo "  On Windows, a bare 'bash' usually starts WSL, which does not share the Windows PATH." >&2
    echo "  Use Git Bash instead -- from PowerShell:" >&2
    echo "" >&2
    echo "      & \"D:/Git/bin/bash.exe\" $0" >&2
    echo "" >&2
    echo "  Nothing has been built, deployed or changed." >&2
    exit 2
  fi
done

# THE RELEASE ROOT IS DECIDED ONCE, EXPLICITLY, AND PROVEN.
#
# This was `dirname "$0"` alone, which makes WHICHEVER COPY OF THIS SCRIPT YOU RAN the release
# root. There are 125 worktrees in this repository and every one of them carries a copy. The
# PowerShell launcher then invoked bash as `-lc './scripts/_sandboxRefresh.run.sh'` -- a RELATIVE
# path resolved by a LOGIN shell whose profile is free to change directory -- so the answer to
# "which repository is being released" depended on which copy was clicked and what a shell profile
# did on the way past.
#
# scripts/releaseRoot.mjs now decides it from --release-root, then EOS_RELEASE_ROOT, then the script
# location, validates the result is a real EOS checkout, and REFUSES an agent worktree outright.
# RESOLVED WITHOUT `dirname`, DELIBERATELY. This was `$(dirname "$0")`, and `dirname` is an
# external coreutils binary that does not exist when this file is run by D:/Git/usr/bin/bash.exe
# from PowerShell. The command substitution then yields an EMPTY string, the root silently
# becomes nothing, and the first thing to notice is a module-not-found several lines later.
# Parameter expansion is a shell builtin: it cannot be missing.
# BOTH SEPARATORS, because $0 does not arrive in one shape. It is Windows-native
# (D:\repo\scripts\x.sh) as often as POSIX -- node's path.join hands the gate suite exactly that
# shape -- and a forward-slash-only strip resolves such a path to ".", which is how the first
# version of this fix broke test/sandboxGatePhases.test.mjs. `dirname` handled both; so must this.
#
# The backslash lives in a variable rather than inline: quoting a literal backslash inside a
# ${var%pattern} expansion is where this goes wrong, and a named variable is unambiguous.
_EOS_BS='\'
case "$0" in
  *"$_EOS_BS"*) _EOS_DIR="${0%"$_EOS_BS"*}" ;;
  */*)          _EOS_DIR="${0%/*}" ;;
  *)            _EOS_DIR="." ;;
esac
SCRIPT_ROOT="$(cd "$_EOS_DIR/.." && pwd)"

# ---------------------------------------------------------------------------------------------
# RELEASE MODE -- parsed here, and UNKNOWN FLAGS ARE REFUSED.
#
# The default (no flag) is the full refresh: Functions, then Hosting, exactly as before. Nothing
# about it changes.
#
# `--hosting-only` exists because the two authorities have different release cadences. A release
# whose diff touches no `functions/` file still had to redeploy the ENTIRE Functions estate to ship
# a frontend, which is unnecessary authority for that release and carries this repository's own
# documented failure mode: a large batch exits non-zero after some functions have already updated,
# leaving the estate half-new. Redeploying identical code is not free.
#
# THIS FAILS CLOSED, DELIBERATELY. An unrecognised flag is REFUSED rather than ignored, because the
# dangerous version of this feature is a typo -- `--hostingonly`, `--hosting_only` -- silently
# falling through to the full deploy the operator was trying to avoid. Silence would make the flag
# look effective while the estate deployed anyway.
#
# `--release-root` and `--allow-commit` are recognised here only so they can be PASSED THROUGH:
# releaseRoot.mjs and _releaseProvenanceGuard.mjs each scan "$@" for their own flag and ignore the
# rest, which is why the whole argument list is still forwarded to both.
HOSTING_ONLY=0
_args=("$@")
_i=0
while [ $_i -lt ${#_args[@]} ]; do
  case "${_args[$_i]}" in
    --hosting-only)
      HOSTING_ONLY=1
      ;;
    --release-root|--allow-commit|--fallback)
      # Takes a value; skip it so the value is never itself parsed as a flag.
      _i=$((_i + 1))
      ;;
    *)
      echo "ABORT: unrecognised release flag: ${_args[$_i]}" >&2
      echo "" >&2
      echo "  Supported:" >&2
      echo "    (no flag)        full refresh -- Functions, then Hosting" >&2
      echo "    --hosting-only   Hosting only -- no Functions deploy" >&2
      echo "" >&2
      echo "  Nothing has been built, deployed or changed." >&2
      exit 2
      ;;
  esac
  _i=$((_i + 1))
done

if [ "$HOSTING_ONLY" -eq 1 ]; then
  RELEASE_MODE="HOSTING-ONLY"
else
  RELEASE_MODE="FULL (Functions + Hosting)"
fi

REPO_ROOT="$(node "$SCRIPT_ROOT/scripts/releaseRoot.mjs" "$@" --fallback "$SCRIPT_ROOT")" || exit 4
cd "$REPO_ROOT"

echo "== [0/5] structural safety guard =="
node scripts/_sandboxDeployGuard.mjs   # asserts role!=production, projectId==eos-platform-sandbox!=taylor-parts
# WHAT the release was built from, not only where it is going. platform-sandbox was once deployed
# from an unmerged branch head whose tree happened to be byte-identical to the main commit that
# followed -- safe by luck, unprovable by process. See scripts/releaseProvenance.mjs.
node scripts/_releaseProvenanceGuard.mjs "$@"
# THE APPROVED COMMIT IS NAMED ONCE and carried to every later check, rather than each step asking
# git again -- "ask git again" is what let the approved commit and the built commit diverge.
APPROVED_COMMIT="$(git rev-parse HEAD)"

echo
echo "Release root:   ${REPO_ROOT}"
echo "Release commit: ${APPROVED_COMMIT}"
echo "origin/main:    $(git rev-parse origin/main)"
echo "Target:         eos-platform-sandbox"
echo "Release mode:   ${RELEASE_MODE}"
echo

if [ "$HOSTING_ONLY" -eq 1 ]; then
  echo "== [1/5] build functions lib == SKIPPED (hosting-only)"
  # SKIPPING THIS IS PROVEN, NOT ASSUMED. `functions && npm run build` emits functions/lib, which is
  # deploy input for the Functions estate and nothing else: no file under field-ops-app-vite/src
  # imports from functions/, and neither vite.config.js nor the app's package.json references it.
  # The Hosting artifact therefore cannot differ because this step did or did not run.
  echo "== [2/5] deploy Functions == SKIPPED (hosting-only)"
  echo "   No Functions authority is exercised by this release."
  echo "   Verify with: git diff --stat <deployed-sha> HEAD -- functions/"
else

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

fi  # end of the Functions phase -- skipped entirely in hosting-only mode

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

# NOTHING BETWEEN STEP 0 AND HERE LOOKED AGAIN. The provenance guard ran before Functions were
# built, Functions were deployed, and the frontend was built -- three long steps in which HEAD can
# move, a branch can be switched, or another agent can commit into the same checkout. This proves
# the tree that produced the artifact is still the tree that was approved, and that the artifact
# itself is stamped with it.
echo "== [3d/5] release identity (approved = HEAD = origin/main = artifact) =="
node scripts/_releaseIdentityGate.mjs --root "${REPO_ROOT}" --approved "${APPROVED_COMMIT}" --artifact ""

echo "== [4/5] deploy Hosting -> eos-platform-sandbox =="
node scripts/_sandboxDeployGuard.mjs
firebase deploy --only hosting --project eos-platform-sandbox

echo "== [5/5] verify deployed revision (D2) =="
# THE ENVIRONMENT IS THE AUTHORITY, and now it is also a GATE. This printed the deployed
# version.json beside an expected commit and asked the reader to compare, while saying in its own
# words that "a clean exit does not mean the artifact is live". That is documentation, not a check:
# it could not fail, so it never did.
node scripts/_releaseIdentityGate.mjs \
  --root "${REPO_ROOT}" \
  --approved "${APPROVED_COMMIT}" \
  --remote https://eos-platform-sandbox.web.app

echo
echo "== [5b/5] verify the scanner callables (read-only) =="
# Export is not deployment and deployment is not readiness. This asks the live estate.
#
# TWO CHECKERS, BECAUSE THEY NEED DIFFERENT TOOLS AND PROVE DIFFERENT THINGS.
#
# gcloud gives the stronger answer -- EXISTS, is ACTIVE, and runs the expected runtime -- so it is
# preferred when the SDK is installed. But it is NOT installed on every operator's machine, and on
# 2026-08-21 this step printed eighteen "FAIL: query failed" lines after a completely successful
# deploy, every one of them caused by `spawnSync gcloud ENOENT`. A verification step that reports
# FAILED after a good deploy is worse than none: the next real failure gets ignored as noise.
#
# The firebase fallback needs no extra tooling (the CLI is already required to deploy) and answers
# the weaker question -- IS IT DEPLOYED. It says so in those words rather than implying more.
SCANNER_CALLABLES="receiveInventoryStock getPurchaseOrderReceivingProgress listReceivablePurchaseOrders
  resolveScannedPartIdentifier getPartBalance getAvailableEquipment getLocationDisplay
  createBin deactivateBin reactivateBin resolveBin listBins recordPutAway
  recordReturnIntake dispatchTransferOrder receiveTransferOrder createCycleCount submitCycleCount"

if command -v gcloud >/dev/null 2>&1; then
  echo "(using gcloud: EXISTS + ACTIVE + runtime)"
  # shellcheck disable=SC2086
  node scripts/verifySandboxFunctions.mjs --project eos-platform-sandbox $SCANNER_CALLABLES
else
  echo "(gcloud not installed -- falling back to the firebase CLI: PRESENCE only)"
  # shellcheck disable=SC2086
  node scripts/verifyDeployedCallablesFirebase.mjs --project eos-platform-sandbox $SCANNER_CALLABLES
fi

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
