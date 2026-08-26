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

# ============================ THE PHASE LEDGER ============================
#
# WHY A LEDGER AND NOT JUST `set -e`.
#
# `set -e` answers "did a phase FAIL". It cannot answer "did a phase RUN". Those are different
# questions and only the first one was being asked, which leaves one way for this gate to print PASS
# over an incomplete run: a phase that never executes at all. A commented-out invocation, a phase
# moved inside a conditional that turns out false, an early `exit 0` added while debugging, or an
# edit that shifts the script under a running shell -- none of those are failures, so none of them
# trip `set -e`, and the banner at the bottom would print exactly as it does on a clean run.
#
# That last case is not hypothetical. A certification run of this gate died at exit 127 with
# "sweep: command not found" pointing at a blank line, because the file was edited while bash was
# executing it: bash reads a script incrementally by BYTE OFFSET, so inserting lines ahead of the
# cursor makes it resume mid-line and run a fragment of a comment. `set -e` caught that one and no
# banner printed -- but it was caught by luck (the fragment happened not to be a valid command),
# not by design. A fragment that parsed would have skipped phases silently.
#
# So every required phase now RECORDS ITSELF, and the banner is a function that refuses to print
# until every name on the required list has been recorded. The gate can still fail the old way; it
# can no longer pass a way it did not earn.
GATE_REQUIRED_PHASES="identity repo-guards create-reach sweep dynamic crash-stress reachability scanner"
GATE_COMPLETED_PHASES=""

# Record a phase as COMPLETED. Called after the phase's work, never before it -- a marker set up
# front would record intent rather than completion, which is the bug this exists to prevent.
gate_phase_complete() {
  GATE_COMPLETED_PHASES="${GATE_COMPLETED_PHASES} $1"
}

# The ONLY way this script may report success. Verifies the ledger, then prints.
gate_pass_banner() {
  local missing=""
  local phase
  for phase in ${GATE_REQUIRED_PHASES}; do
    case " ${GATE_COMPLETED_PHASES} " in
      *" ${phase} "*) ;;
      *) missing="${missing} ${phase}" ;;
    esac
  done
  if [ -n "${missing}" ]; then
    echo ""
    echo "!! GATE INCOMPLETE -- these required phases never completed:${missing}"
    echo "!! Refusing to report PASS over a run that did not happen."
    exit 9
  fi
  echo ""
  echo "SANDBOX REGRESSION GATE: PASS -- deployed ${DEPLOYED_SHA} accepted."
  echo "   phases completed:${GATE_COMPLETED_PHASES}"
}

# A gate that exits before its banner must not look like one that was merely quiet. Any exit that
# is not the banner's own says so, on the way out, with the code.
gate_on_exit() {
  local code=$?
  if [ "${code}" -ne 0 ]; then
    echo ""
    echo "!! SANDBOX REGRESSION GATE: FAILED (exit ${code})"
    echo "!! completed phases:${GATE_COMPLETED_PHASES:- none}"
    echo "!! NOT an accepted refresh."
  fi
}
trap gate_on_exit EXIT

ORIGIN="${1:-https://eos-platform-sandbox.web.app}"
# CERT_BASE IS NOT KNOWN UNTIL THE ENVIRONMENT IS ASKED. This line used to hardcode
# "${ORIGIN}/Taylor_Parts/field-ops" -- the path the LOCAL dev server uses. The deployed build is
# built with base "/", so that URL still returns 200 (Firebase rewrites every path to index.html)
# and the app then boots on a route its router does not recognise. Nothing 404s; the gate simply
# certifies a page that is not the app.
#
# It failed loudly and correctly -- the sweep reported NAV_REDIRECTED on 270 of 270 visits -- and I
# read the tail of the log instead of that line, and spent a cycle diagnosing load. The answer was
# already printed.
#
# Same defect class as the hardcoded BASE_PATH inside certify.mjs, fixed there and left here: the
# fourth time in this program a fix landed in one sibling and not the other.
#
# The deployed artifact SELF-DESCRIBES its base in version.json, so ask it rather than assume.
DEPLOYED_BASE="$(curl -fsS "${ORIGIN}/version.json" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{let b=JSON.parse(d).base||"/";if(b==="/")b="";else if(b.endsWith("/"))b=b.slice(0,-1);process.stdout.write(b)})')"
export CERT_BASE="${ORIGIN}${DEPLOYED_BASE}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# THE ROOT MUST BE REAL, AND SAYING SO BEATS A MYSTERY PATH.
#
# The first live quick-gate run failed resolving a path whose ROOT WAS EMPTY -- the error named
# a missing \scripts\_certificationRoutes.mjs rather than the reason, because an unresolved root
# silently becomes the caller's cwd, or nothing at all. Both gates run from operator shells and
# from 125 worktrees; neither may quietly certify whatever directory it happened to land in.
if [ -z "${REPO_ROOT:-}" ] || [ ! -f "${REPO_ROOT}/scripts/_certificationRoutes.mjs" ]; then
  echo "ABORT: could not resolve the repository root for this gate." >&2
  echo "       resolved to: '${REPO_ROOT:-<empty>}'" >&2
  echo "       Run the gate by its own absolute path from a checkout:" >&2
  echo "         bash /path/to/repo/scripts/_sandboxRegressionGate.sh" >&2
  exit 2
fi
EOS_GATE_ROOT_CHECKED=1
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
# WHAT THIS ACTUALLY NEEDS TO ASSERT: that the deployed bytes are the current CLIENT SURFACE --
# not that the repo HEAD hash matches. Those differ whenever a commit lands that cannot change the
# artifact, and this gate's own harness lives in field-ops-app-vite/.claude/, which never ships.
# Strict hash equality would fail a perfectly valid certification and, worse, create a loop: a
# tooling fix could only be gate-clean after a deploy that the tooling fix does not affect.
#
# So: the deployed commit must be reachable from HEAD (never a build from some other line of
# development), and nothing that CAN change the artifact may differ between it and HEAD.
if ! git merge-base --is-ancestor "$DEPLOYED_SHA" HEAD 2>/dev/null; then
  echo "!! deployed ${DEPLOYED_SHA} is not an ancestor of HEAD -- refusing to certify a build from another line."
  exit 1
fi
CLIENT_PATHS="field-ops-app-vite/src field-ops-app-vite/index.html field-ops-app-vite/vite.config.js field-ops-app-vite/package.json functions/src firestore.rules firestore.indexes.json"
DRIFT="$(git diff --name-only "$DEPLOYED_SHA"..HEAD -- $CLIENT_PATHS)"
if [ -n "$DRIFT" ]; then
  echo "!! the deployed build is stale -- these artifact-affecting paths changed since ${DEPLOYED_SHA}:"
  echo "$DRIFT" | sed "s/^/     /"
  echo "!! redeploy before certifying."
  exit 1
fi
echo "   deployed ${DEPLOYED_SHA} is an ancestor of HEAD (${LOCAL_SHA}) with no artifact-affecting drift."
gate_phase_complete identity

# 2. REPO-SIDE GUARDS. Cheap, and they catch the classes that render fine and are still wrong --
#    orphaned CSS classes, a created record that cannot be reached, an id rendered where a name
#    belongs, and a detector that has stopped being able to fail.
echo "== [2/6] repo guards (css coverage, create-reach invariant, identity, detector trust) =="
( cd field-ops-app-vite && npm test )
gate_phase_complete repo-guards

# ORDER MATTERS HERE, and this used to run LAST.
#
# As the final step it executed after roughly 450 harness page-loads, and it intermittently timed
# out waiting for a control that demonstrably exists -- the same journey passed 6/6 three times
# standalone against the same deployed build, minutes apart. A journey test placed at the end of a
# long sweep measures the accumulated load of the harness as much as the application.
#
# Moved BEFORE the sweeps so it measures what it is for. This is not the failure being tidied away:
# the step is unchanged and still fails the whole gate if the journey breaks. What changed is that
# it no longer inherits a confound the application had nothing to do with.

# 3. THE JOURNEY THAT REGRESSED. A created record must be reachable; a static invariant cannot see an
#    index that was never deployed, which is exactly the risk a fresh environment carries.
echo "== [3/6] create -> reach =="
( cd field-ops-app-vite && node ".claude/skills/run-field-ops-app-vite/createReach.mjs" admin )
gate_phase_complete create-reach

# THE ROUTE LIST IS DERIVED BEFORE IT IS SWEPT.
#
# .certification/routes.json is a required input of certify.mjs and reachability.mjs, is written by
# nothing in the repository, and is excluded by .gitignore -- so this gate died with ENOENT on a
# fresh worktree, three steps in, after everything before it had passed. Deriving it here means the
# gate runs from a clean checkout and the sweep cannot drift out of step with the nav it certifies.
node "${REPO_ROOT:-.}/scripts/_certificationRoutes.mjs"

# 4. STRUCTURAL + RESPONSIVE SWEEP against the deployed build. certify.mjs exits non-zero if any
#    visit went unmeasured, so a partial sweep cannot pass this gate.
echo "== [4/6] structural + responsive sweep (5 widths) =="
# NOTE: a single invocation, deliberately. An earlier draft wrote `run-sweep || run-sweep-again`,
# which means a FAILING sweep silently re-runs and can pass on the retry -- turning the one check
# that reports incomplete coverage into a check that hides it. There is no retry here on purpose.
( cd field-ops-app-vite && node ".claude/skills/run-field-ops-app-vite/certify.mjs" admin 1440,1024,768,375,320 )
gate_phase_complete sweep

# 4b. DYNAMIC DETAIL ROUTES. The step above sweeps routes.json -- 54 NAV destinations, none of
#     them a record page, because a detail URL does not exist until a record does. It reported ZERO
#     raw-id findings across 270 visits while SalesOrderDetail was rendering a Firestore document id
#     as visible content. A clean sweep and a broken page looked identical from the outside.
#
#     Records are RESOLVED through the governed lists, never pinned by id, so this survives a
#     reseed. An entity that cannot be resolved is a FIXTURE_PRECONDITION failure and exits
#     non-zero -- "no record to open" is exactly the state that hid the Opportunity defect.
echo "== [4b/6] dynamic detail routes (record pages) =="
( cd field-ops-app-vite && node ".claude/skills/run-field-ops-app-vite/certifyDynamic.mjs" admin 1440,375 )
gate_phase_complete dynamic

# 4c. CRASH STRESS. Every step above LOADS A ROUTE AND MEASURES IT. None of them clicks anything,
#     goes back, reloads a detail, or navigates away while a read is in flight -- which is where
#     state and lifecycle defects live, and is why a user hit the root error boundary twice while
#     every automated check was green.
#
#     Every crash signal is fatal here: boundary text, pageerror, unhandledrejection, a React
#     "UI Crash:" console entry, and any unexpected console.error. The second pass runs THROTTLED,
#     because a race that needs 700ms to appear is invisible on a fast connection and perfectly
#     reproducible on a phone.
echo "== [4c/6] crash stress (interactions + races) =="
( cd field-ops-app-vite && node ".claude/skills/run-field-ops-app-vite/crashStress.mjs" admin )
( cd field-ops-app-vite && node ".claude/skills/run-field-ops-app-vite/crashStress.mjs" admin slow )
gate_phase_complete crash-stress

# 5. PERSONA REACHABILITY. The representative three, not all fifteen -- the fixture-only identities
#    belong to targeted suites, and sweeping them here buys duplicate coverage at real cost.
echo "== [5/6] persona reachability (representative set) =="
for p in ineligibleDispatcher technicianMultiRole eligiblePartsManager; do
  ( cd field-ops-app-vite && node ".claude/skills/run-field-ops-app-vite/reachability.mjs" "$p" 1440 )
done
gate_phase_complete reachability

# 6. SCANNER SCENARIOS. Six must succeed and six must REFUSE; a refusal that passes by succeeding is
#    a release failure, which is why the runner compares against each case's declared expectation.
echo "== [6/6] scanner scenarios =="
node scripts/runSandboxScannerScenarios.mjs
gate_phase_complete scanner

gate_pass_banner
