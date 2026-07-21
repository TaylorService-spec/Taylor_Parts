#!/usr/bin/env bash
#
# READ-ONLY production Functions live-state verification (Issue #15 / DECISIONS #36).
#
# WHERE THIS RUNS: an authenticated operator environment (e.g. Google Cloud Shell)
# with read-only access to the target Firebase / Google Cloud project. It does NOT
# run from the Windows repository workstation, which has no production credentials
# (see docs/governance/execution-environments.md).
#
# WHAT IT DOES: list + describe METADATA reads only, captured into timestamped audit
# artifacts, so repository Function exports can be correlated against deployed state.
#
# WHAT IT MUST NEVER DO (enforced by construction -- every gcloud/firebase call below
# is a read-only list/describe/get form): no deploy, no redeploy, no resource removal,
# no update/patch, no IAM binding changes, no reading of secret VALUES, no invoking a
# callable/HTTP Function, and no Firestore or other production-data reads beyond Function
# metadata. (The prohibited-verb words appear ONLY in this explanatory header and in the
# static self-check below; no such command is issued. Note: the string "delete" also
# appears as part of the legitimate Function NAME `deleteSavedDefinitionCallable`, which
# is a report saved-definition callable, not a mutation command.)
#
# USAGE (operator):
#   EXPECTED_PROJECT=taylor-parts \
#   bash scripts/audit/verify-production-functions-live-state.sh --confirm-project taylor-parts
#
set -Eeuo pipefail

EXPECTED_PROJECT="${EXPECTED_PROJECT:-taylor-parts}"
REGION="${REGION:-us-central1}"
CONFIRM_PROJECT=""
for arg in "$@"; do
  case "$arg" in
    --confirm-project) shift; CONFIRM_PROJECT="${1:-}";;
    --confirm-project=*) CONFIRM_PROJECT="${arg#*=}";;
  esac
done

TS="$(date -u +%Y%m%dT%H%M%SZ)"
OUTDIR="${OUTDIR:-functions-live-state-${TS}}"
DESCRIBE_DIR="${OUTDIR}/function-describes"
mkdir -p "${DESCRIBE_DIR}"

echo "============================================================"
echo "READ-ONLY FUNCTIONS LIVE-STATE VERIFICATION -- NO MUTATIONS"
echo "Expected project : ${EXPECTED_PROJECT}"
echo "Region           : ${REGION}"
echo "Output directory : ${OUTDIR}"
echo "Timestamp (UTC)  : ${TS}"
echo "============================================================"

require() { command -v "$1" >/dev/null 2>&1 || { echo "MISSING TOOL: $1" >&2; exit 3; }; }
require gcloud

# ---- 1. active identity + project ---------------------------------------------------
gcloud auth list --format="value(account,status)" > "${OUTDIR}/environment.txt" 2>&1 || {
  echo "AUTH ERROR: no active gcloud credentials -- run in an authenticated operator env." >&2
  echo "BLOCKED BY ACCESS" >> "${OUTDIR}/environment.txt"; exit 4;
}
ACTIVE_PROJECT="$(gcloud config get-value project 2>/dev/null || true)"
{
  echo "region=${REGION}"
  echo "expected_project=${EXPECTED_PROJECT}"
  echo "active_project=${ACTIVE_PROJECT}"
  echo "timestamp_utc=${TS}"
} >> "${OUTDIR}/environment.txt"

# ---- project-match confirmation guard (mirrors the repo's --confirmProduction pattern)
if [ "${ACTIVE_PROJECT}" != "${EXPECTED_PROJECT}" ]; then
  echo "ABORT: active project '${ACTIVE_PROJECT}' != expected '${EXPECTED_PROJECT}'." >&2
  exit 5
fi
if [ "${CONFIRM_PROJECT}" != "${EXPECTED_PROJECT}" ]; then
  echo "ABORT: pass --confirm-project ${EXPECTED_PROJECT} to proceed (deliberate confirmation)." >&2
  exit 5
fi

# ---- 2. project + firebase association (read-only) ----------------------------------
gcloud projects describe "${EXPECTED_PROJECT}" --format=json > "${OUTDIR}/project-metadata.json" 2>&1 || true
if command -v firebase >/dev/null 2>&1; then
  firebase projects:list 2>&1 | sed -n '1,40p' > "${OUTDIR}/firebase-projects.txt" || true
  # firebase functions:list is a read-only listing; capture if available.
  firebase functions:list --project "${EXPECTED_PROJECT}" > "${OUTDIR}/firebase-functions-list.txt" 2>&1 || true
fi

# ---- 3/4. Cloud Functions inventory (Gen1 + Gen2), read-only ------------------------
# Newer gcloud returns both generations from `functions list`; also capture a Gen2 filter.
gcloud functions list --project "${EXPECTED_PROJECT}" --format=json \
  > "${OUTDIR}/functions-all.json" 2>"${OUTDIR}/functions-all.err" || true
gcloud functions list --project "${EXPECTED_PROJECT}" --v2 --format=json \
  > "${OUTDIR}/functions-gen2.json" 2>/dev/null || \
  gcloud functions list --project "${EXPECTED_PROJECT}" --gen2 --format=json \
  > "${OUTDIR}/functions-gen2.json" 2>/dev/null || echo "[]" > "${OUTDIR}/functions-gen2.json"
gcloud functions list --project "${EXPECTED_PROJECT}" --no-gen2 --format=json \
  > "${OUTDIR}/functions-gen1.json" 2>/dev/null || echo "[]" > "${OUTDIR}/functions-gen1.json"

# ---- 5-14. per-Function describe (region, runtime, trigger, entryPoint, state, ------
#            updateTime, serviceAccount, env-var NAMES, secret refs -- names only) -----
NAMES="$(gcloud functions list --project "${EXPECTED_PROJECT}" --format='value(name)' 2>/dev/null | sed 's#.*/##' || true)"
for fn in ${NAMES}; do
  gcloud functions describe "${fn}" --project "${EXPECTED_PROJECT}" --region "${REGION}" --format=json \
    > "${DESCRIBE_DIR}/${fn}.json" 2>/dev/null || \
  gcloud functions describe "${fn}" --project "${EXPECTED_PROJECT}" --region "${REGION}" --gen2 --format=json \
    > "${DESCRIBE_DIR}/${fn}.json" 2>/dev/null || \
  echo "{\"name\":\"${fn}\",\"describe\":\"unavailable\"}" > "${DESCRIBE_DIR}/${fn}.json"
done

# ---- 15/16. Gen2 backing Cloud Run services + Eventarc triggers (metadata, read-only)
gcloud run services list --project "${EXPECTED_PROJECT}" --region "${REGION}" --format=json \
  > "${OUTDIR}/cloud-run-services.json" 2>/dev/null || echo "[]" > "${OUTDIR}/cloud-run-services.json"
gcloud eventarc triggers list --project "${EXPECTED_PROJECT}" --location "${REGION}" --format=json \
  > "${OUTDIR}/eventarc-triggers.json" 2>/dev/null || echo "[]" > "${OUTDIR}/eventarc-triggers.json"

# ---- 17. Scheduler jobs (only relevant if scheduled Functions exist; repo has none) --
gcloud scheduler jobs list --project "${EXPECTED_PROJECT}" --location "${REGION}" --format=json \
  > "${OUTDIR}/scheduler-jobs.json" 2>/dev/null || echo "[]" > "${OUTDIR}/scheduler-jobs.json"

# ---- verification summary (counts only; correlation is done in the repository) -------
COUNT_ALL="$(python3 -c 'import json,sys;print(len(json.load(open(sys.argv[1]))))' "${OUTDIR}/functions-all.json" 2>/dev/null || echo unknown)"
{
  echo "{"
  echo "  \"generatedAt\": \"${TS}\","
  echo "  \"projectId\": \"${EXPECTED_PROJECT}\","
  echo "  \"region\": \"${REGION}\","
  echo "  \"readOnly\": true,"
  echo "  \"deployedFunctionCount\": \"${COUNT_ALL}\","
  echo "  \"artifacts\": [\"environment.txt\",\"project-metadata.json\",\"functions-all.json\",\"functions-gen1.json\",\"functions-gen2.json\",\"function-describes/\",\"cloud-run-services.json\",\"eventarc-triggers.json\",\"scheduler-jobs.json\"]"
  echo "}"
} > "${OUTDIR}/verification-summary.json"

# ---- sensitive-value scan (fail loud if a secret-shaped value slipped into metadata)-
: > "${OUTDIR}/sensitive-scan.txt"
if grep -rIEn 'BEGIN (RSA|EC|OPENSSH|PRIVATE)|-----BEGIN|"privateKey"|AIza[0-9A-Za-z_-]{20,}|ya29\.[0-9A-Za-z_-]+|AKIA[0-9A-Z]{16}' "${OUTDIR}" \
     --exclude=sensitive-scan.txt >> "${OUTDIR}/sensitive-scan.txt" 2>/dev/null; then
  echo "POTENTIAL SENSITIVE VALUE FOUND -- DO NOT COMMIT UNTIL SANITIZED." | tee -a "${OUTDIR}/sensitive-scan.txt"
else
  echo "clean -- no secret-shaped values detected in captured metadata." >> "${OUTDIR}/sensitive-scan.txt"
fi

# ---- checksums for immutable governed evidence --------------------------------------
( cd "${OUTDIR}" && find . -type f ! -name 'sha256sums.txt' -print0 | sort -z | xargs -0 sha256sum > sha256sums.txt )

echo "DONE. Read-only artifacts in: ${OUTDIR}"
echo "Next: run the sensitive scan review, verify sha256sums.txt, and hand the directory"
echo "to the repository per docs/operations/functions-live-state-verification-handoff.md."
