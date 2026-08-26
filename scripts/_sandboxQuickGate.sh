#!/usr/bin/env bash
# SANDBOX QUICK GATE -- deploy sanity in minutes, against the DEPLOYED build.
#
# ============================ WHAT THIS IS FOR ============================
#
# _sandboxRegressionGate.sh is the ACCEPTANCE gate: 60 routes x 5 widths, the full repo suite,
# crash stress, persona reachability and the 40/40 scanner. It takes tens of minutes, and it should
# -- an accepted refresh is worth that. But it is far too slow to answer the question that actually
# comes up most: "did this deploy land, and is the pilot surface still standing?"
#
# Answered slowly, that question gets skipped. So this is the fast subset, and its whole design
# rule is that it must never be MISTAKEN for the full gate. It says so on the way in, on the way
# out, and in its exit banner.
#
# ============================ WHAT IT DELIBERATELY DOES NOT DO ============================
#
#   * The repo suites (241 of them). CI runs those on every PR and on main; running them again here
#     buys nothing and costs most of the wall clock.
#   * Crash stress, persona reachability, the scanner scenarios. These catch real defects and none
#     of them is fast.
#   * Four of the five widths. 1440 and 375 are the two that bracket the layout; the three between
#     them almost never fail alone.
#
# A quick pass therefore means "nothing obviously broke". It does not mean the refresh is accepted,
# and this script exits saying exactly that.
#
# Usage:
#   ./scripts/_sandboxQuickGate.sh [origin]
#
# On Windows run it under GIT BASH, which inherits the Windows PATH -- a bare `bash` usually starts
# WSL, which is a different machine without node/npx on PATH:
#
#     & "D:/Git/usr/bin/bash.exe" scripts/_sandboxQuickGate.sh
#
set -euo pipefail

ORIGIN="${1:-https://eos-platform-sandbox.web.app}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
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
  echo "         bash /path/to/repo/scripts/_sandboxQuickGate.sh" >&2
  exit 2
fi
EOS_GATE_ROOT_CHECKED=1
APP_DIR="${REPO_ROOT}/field-ops-app-vite"
SKILL_DIR="${APP_DIR}/.claude/skills/run-field-ops-app-vite"

for tool in node npx curl; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "ABORT: '$tool' is not on PATH in this shell." >&2
    echo "       On Windows use Git Bash: & \"D:/Git/usr/bin/bash.exe\" $0" >&2
    exit 2
  fi
done

echo "quick gate -- NOT the acceptance gate. Target: ${ORIGIN}"
echo

# ---------------------------------------------------------------------------------------------
echo "== [1/3] deployed identity =="
#
# EVERYTHING BELOW IS MEANINGLESS IF THIS IS THE PREVIOUS BUILD. The full gate learned this the
# expensive way and refuses to certify a deployed SHA that is not an ancestor of HEAD; the same
# reasoning applies to a two-minute check, and costs one request.
DEPLOYED="$(curl -fsS "${ORIGIN}/version.json")"
read -r SHA ENV_ID ENV_ROLE DEPLOYED_BASE <<EOF
$(printf '%s' "$DEPLOYED" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const v=JSON.parse(d);let b=v.base||"/";if(b==="/")b="";else if(b.endsWith("/"))b=b.slice(0,-1);process.stdout.write([v.commit,v.environmentId,v.environmentRole,b||"(root)"].join(" "))})')
EOF
echo "   commit ${SHA}  env ${ENV_ID}/${ENV_ROLE}  base ${DEPLOYED_BASE}"

# A QUICK GATE MUST STILL REFUSE PRODUCTION. It only reads, but a green result against the wrong
# origin is a false assurance about the environment somebody is about to change.
if [ "${ENV_ROLE}" = "production" ] || [ "${ENV_ID}" = "taylor-parts-production" ]; then
  echo "!! REFUSING: ${ORIGIN} reports environmentRole=${ENV_ROLE}. This gate is sandbox-only." >&2
  exit 3
fi

if git -C "${REPO_ROOT}" rev-parse --verify --quiet "${SHA}" >/dev/null 2>&1; then
  if git -C "${REPO_ROOT}" merge-base --is-ancestor "${SHA}" HEAD 2>/dev/null; then
    echo "   deployed commit is an ancestor of HEAD -- certifying this line"
  else
    echo "!! deployed ${SHA} is not an ancestor of HEAD -- this build came from another line." >&2
    exit 4
  fi
else
  # A shallow clone or a commit not fetched yet is not a reason to fail; it IS a reason to say so.
  echo "   (commit ${SHA} not present locally -- ancestry unverified)"
fi
[ "${DEPLOYED_BASE}" = "(root)" ] && DEPLOYED_BASE=""
export CERT_BASE="${ORIGIN}${DEPLOYED_BASE}"
echo

# ---------------------------------------------------------------------------------------------
echo "== [2/3] pilot surfaces (2 widths) =="
#
# The route list is DERIVED, never hand-written -- see scripts/_certificationRoutes.mjs for why the
# full list stopped existing on fresh checkouts. The pilot subset is then filtered out of it, so a
# renamed or removed destination shrinks this list rather than silently sweeping a stale path.
node "${REPO_ROOT}/scripts/_certificationRoutes.mjs"

PILOT_FILE="${APP_DIR}/.certification/routes.pilot.json"
node -e '
const { readFileSync, writeFileSync } = require("node:fs");
const all = JSON.parse(readFileSync(process.argv[1], "utf8"));
// The pilot family plus the two surfaces it links into. Named by ROUTE, so a nav relabel does not
// quietly drop one.
const WANT = ["/service", "/service/job-assignments", "/service/dispatcher-board",
              "/service/scheduling", "/customers", "/customers/sales-orders"];
const picked = WANT.map((r) => all.find((x) => x.route === r)).filter(Boolean);
const missing = WANT.filter((r) => !all.some((x) => x.route === r));
if (missing.length) {
  console.error("ABORT: pilot routes no longer exist in navConfig: " + missing.join(", "));
  console.error("       Update the WANT list rather than sweeping a shorter one.");
  process.exit(2);
}
writeFileSync(process.argv[2], JSON.stringify(picked, null, 1));
console.log("   pilot subset: " + picked.length + " of " + all.length + " destinations");
' "${APP_DIR}/.certification/routes.json" "${PILOT_FILE}"

( cd "${APP_DIR}" && node "${SKILL_DIR}/certify.mjs" admin 1440,375 ".certification/routes.pilot.json" )
echo

# ---------------------------------------------------------------------------------------------
echo "== [3/3] dynamic detail + RAW_ID =="
#
# The sweep above visits NAV destinations. A record page has no URL until a record exists, so it can
# never appear in a route list -- and that gap once let a sweep report zero raw-id findings across
# 270 visits while a detail page was printing a Firestore document id as visible content. This step
# reaches one representative record through the app's own governed list, exactly as a user would.
( cd "${APP_DIR}" && node "${SKILL_DIR}/certifyDynamic.mjs" admin 1440,375 )
echo

echo "==============================================================================="
echo " QUICK GATE PASSED -- commit ${SHA} on ${ENV_ID}"
echo ""
echo " THIS IS NOT scripts/_sandboxRegressionGate.sh."
echo " Not run here: the 241 repo suites, three of five widths, crash stress,"
echo " persona reachability, and the 40/40 scanner scenarios."
echo ""
echo " An accepted sandbox refresh still requires the full gate."
echo "==============================================================================="
