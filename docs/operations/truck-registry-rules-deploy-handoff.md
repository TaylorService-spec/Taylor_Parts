# EI Truck Registry — Production Firestore Rules Deployment & Verification Handoff (Cloud Shell)

**Unit:** Gate C production deployment of the merged EI Truck Registry Firestore Rules blocks (`trucks`, `mobile_locations`, `location_truck_claims`) — plus the acknowledged combined whole-file content — with production verification, preserving rollback. **Operator-executed** in Cloud Shell; prepared by the Inventory session. **This document authorizes NO deployment.** Deployment is a separate, separately Owner-authorized gate (Tier 2, Delegation Charter). No fixture creation, no live smoke testing, and no Functions deployment are authorized by this handoff.

Follows the **F-RULES-1 D2 / INV-CONVERGENCE-E Stage B precedent** (`f-rules-1-d2-deployment-handoff.md`, `inv-convergence-e-stage-b-rules-deploy-handoff.md`): self-derive the governed hash from the Git/LF source, capture a rollback baseline (extracted live source) **before** deploying, verify the extracted live source equals the governed Git/LF source, run a production deny/allow matrix with disposable fixtures, package sanitized checksummed evidence.

**Governing inputs (all merged):** Decision #60 (Truck Registry write service) · `docs/DECISIONS.md` #60 · ADR-010 · the EI-P1d-2-2b read gate (PR #511) + Truck Registry write service (PR #512) that merged these Rules blocks · Gate B callables (PR #513, exported/undeployed) · this evidence directory `docs/audits/truck-registry-rules-deployment/`.

---

## 0. Baseline, governed commit, and Rules hash

- **Deploy commit (pinned at deploy time):** current `origin/main`. The governed `firestore.rules` blob is **byte-identical** across this docs-only handoff PR (it changes only `docs/**`), so the Rules bytes equal those merged at `3b6caa2`.
- **Canonical governed deployment hash — the Git/LF stored-source SHA-256** (self-derived by the operator, do not trust a copy):

  `bb1492b98cba95cb30ac23f7078f0fdba24befa64fa604da27d84ddc9ebac907`

  This is the SHA-256 of the **LF-normalized Rules source content stored in Git**, produced by `git show <DEPLOY_COMMIT>:firestore.rules | sha256sum` (equivalently `git cat-file blob <DEPLOY_COMMIT>:firestore.rules | sha256sum`). Root and mirror `field-ops-app-vite/firestore.rules` produce the **same** hash → byte-identical (verify with `git diff --no-index` of the two extracted sources).

### 0.1 Hash terminology (two distinct artifact classes — do not conflate)

- **Source-content hash** — SHA-256 of the extracted `firestore.rules` LF source bytes (from Git, or extracted from a live ruleset's source file). Only source-content hashes are compared for equivalence, and the deployed one must equal `bb1492b9…`.
- **API-artifact hash** — SHA-256 of a **complete** Firebase Rules API JSON response saved verbatim. Captured for provenance **only**; **never** compared to a source-content hash. Always label it as such.
- If the authoring machine is Windows, a CRLF working-copy hash will differ from the Git/LF source hash by line-ending encoding only. **Deploy-side verification MUST use the Git/LF source hash `bb1492b9…`.** Identify the byte representation before stating any hash.

## 1. Hard boundaries

- **Rules only.** `firebase deploy --only firestore:rules --project taylor-parts`. NO Functions, NO Hosting, NO indexes, NO data.
- No IAM widened, no service-account keys, single operator, Cloud Shell.
- No production records created except **disposable** verification fixtures (Admin SDK), removed in Step 9.
- Merge/deploy authority ≠ this handoff. Deployment requires a **separate explicit Owner authorization**.

## 2. Combined whole-file content (Owner-acknowledged — P2-A, this deploy)

A whole-file Rules deploy ships the ENTIRE governed file. Against the newest recorded live baseline (`inv-convergence-e-c2`, 2026-07-27), the accumulated **undeployed** client-facing delta is **eight** blocks, all of which the Owner has acknowledged may deploy together:

**Truck Registry (Gate C target):**
| Collection | read | create/update/delete |
|---|---|---|
| `mobile_locations/{locationId}` | `isAdminOrDispatcher()` | `false` |
| `trucks/{truckId}` | `isAdminOrDispatcher()` | `false` |
| `location_truck_claims/{locationId}` | `false` | `false` |

**D4 equipment-compatibility (merged 2026-07-28, `1bae134`; fully client-closed — additive-deny, no client path):**
`equipment_models` · `equipment_model_aliases` · `equipment_part_compatibility` · `equipment_compatibility_sources` · `equipment_compatibility_operations` — each `allow read, write: if false;`.

All eight are **new collections** (previously default-deny). No existing collection's rules and no helper change. Strictly additive.

## 3. Live baseline is a HARD GATE (P2-B)

The repository snapshot is **NOT** authoritative live state. Before deploying, the operator MUST fetch the **current live** ruleset via the Firebase Rules API, save it as the rollback baseline (extracted source + full API artifact + sha256), and diff it against the governed file. **Deploy is gated on this capture succeeding and the diff being exactly the acknowledged combined content (§2) — nothing else.** If the diff shows any unexpected block, STOP and report.

## 4. Full production verification matrix (real client REST, password-auth ID tokens, disposable fixtures)

Seed exactly one Admin-SDK fixture doc per readable collection, mint short-lived password-auth ID tokens for one admin, one dispatcher, one technician principal, and probe:

| Collection | admin read | dispatcher read | technician read | unauth read | any client write (all principals) |
|---|---|---|---|---|---|
| `trucks` | ALLOW | ALLOW | DENY | DENY | DENY |
| `mobile_locations` | ALLOW | ALLOW | DENY | DENY | DENY |
| `location_truck_claims` | DENY | DENY | DENY | DENY | DENY |
| each D4 block (§2) | DENY | DENY | DENY | DENY | DENY |

This mirrors the merged emulator suites (`truckRegistryRules` 20/20, `truckRegistryWriteRules` 10/10, and the D4 rules suites) exactly. Every allow/deny is the **deployed** Rules' behavior.

---

> **Mandatory-cleanup invariant (P2 — Codex).** Every fixture and temporary Auth user is created
> with the single deterministic prefix `trc_gatec_` and its own on-disk manifest, so **Step 9
> (Mandatory cleanup) removes them by prefix in ONE idempotent pass and MUST run on EVERY exit
> path — success, any stop condition, and after ROLLBACK — BEFORE the final report.** Set the
> trap once at the start of the run so no failure can bypass it:
>
> ```bash
> mkdir -p ~/trc && cd ~/trc && mkdir -p evidence
> export TRC_PREFIX="trc_gatec_$(date +%s)"          # deterministic fixture/user prefix
> # Guaranteed cleanup on ANY exit (success, error, or after rollback):
> trap 'bash ~/trc/step9_cleanup.sh || echo "CLEANUP-FAILED -- MANUAL REMOVAL REQUIRED for prefix $TRC_PREFIX"' EXIT
> ```

## Step 1 — Clone the pinned commit and self-derive the governed hash
```bash
cd ~/trc && rm -rf repo && git clone --depth 1 https://github.com/TaylorService-spec/Taylor_Parts repo && cd repo \
 && EXPECTED_RULES_SHA=bb1492b98cba95cb30ac23f7078f0fdba24befa64fa604da27d84ddc9ebac907 \
 && GOV=$(git show HEAD:firestore.rules | sha256sum | cut -d" " -f1) \
 && echo "governed Git/LF source sha256: $GOV" \
 && test "$GOV" = "$EXPECTED_RULES_SHA" && echo GOVERNED-HASH-OK \
 && diff <(git show HEAD:firestore.rules) <(git show HEAD:field-ops-app-vite/firestore.rules) >/dev/null && echo ROOT-MIRROR-IDENTICAL \
 && DEPLOY_COMMIT=$(git rev-parse HEAD) && echo "DEPLOY_COMMIT=$DEPLOY_COMMIT"
```
**Expected:** `GOVERNED-HASH-OK` and `ROOT-MIRROR-IDENTICAL`. If either fails → STOP (do not deploy).

## Step 2 — Confirm no Functions/index/data are in scope (pre-deploy Functions inventory)
```bash
cd ~/trc && TOKEN=$(gcloud auth print-access-token) \
 && curl -s -H "Authorization: Bearer $TOKEN" "https://cloudfunctions.googleapis.com/v2/projects/taylor-parts/locations/-/functions" \
      | python3 -c "import sys,json; d=json.load(sys.stdin); print('FUNCTIONS_COUNT', len(d.get('functions',[]))); [print('FN', f['name'].split('/')[-1]) for f in d.get('functions',[])]" | sort | tee evidence/predeploy-functions-inventory.txt >/dev/null \
 && echo "recorded predeploy Functions inventory"
```
The deploy command targets `firestore:rules` ONLY; this inventory is compared in Step 7 and MUST be unchanged (the exported-but-undeployed Truck Registry callables must NOT appear).

## Step 3 — Capture the live Rules baseline as EXTRACTED SOURCE + full API artifact (rollback artifact — P2-B HARD GATE)
```bash
cd ~/trc && mkdir -p rollback && TOKEN=$(gcloud auth print-access-token) \
 && REL=$(curl -s -H "Authorization: Bearer $TOKEN" "https://firebaserules.googleapis.com/v1/projects/taylor-parts/releases" | python3 -c "import sys,json; rs=json.load(sys.stdin)['releases']; print([r['rulesetName'] for r in rs if r['name'].endswith('cloud.firestore')][0])") \
 && curl -s -H "Authorization: Bearer $TOKEN" "https://firebaserules.googleapis.com/v1/$REL" > evidence/pre-deploy-production-rules-api.json \
 # extract ONLY the firestore.rules source content bytes (no JSON quoting, no added newline):
 && python3 -c "import sys,json; fs=json.load(open('evidence/pre-deploy-production-rules-api.json'))['source']['files']; f=[x for x in fs if x.get('name','').endswith('firestore.rules')] or fs; sys.stdout.write(f[0]['content'])" > rollback/firestore.rules \
 && cp rollback/firestore.rules evidence/pre-deploy-production.rules \
 && printf '{"firestore":{"rules":"firestore.rules"}}\n' > rollback/firebase.json \
 && echo -n "predeploy EXTRACTED SOURCE sha256: " && sha256sum rollback/firestore.rules | tee evidence/pre-deploy-production-rules.sha256 \
 && echo -n "predeploy API-ARTIFACT sha256 (provenance only): " && sha256sum evidence/pre-deploy-production-rules-api.json | tee evidence/pre-deploy-production-rules-api.json.sha256 \
 # HARD-GATE DIFF: the ONLY blocks in governed-not-in-baseline must be the acknowledged §2 set:
 && echo "== governed-not-in-live baseline match blocks ==" \
 && diff <(grep -E "match /" repo/firestore.rules) <(grep -E "match /" rollback/firestore.rules) | grep -E "^<" | sed 's/^< *//'
```
**Expected:** first line of `rollback/firestore.rules` is `rules_version = '2';`; the governed-not-in-baseline match-block list is **exactly** the §2 set — the 3 Truck blocks + the 5 D4 blocks — **and nothing else**. If the extracted source is empty/malformed, or the diff shows ANY block outside §2, **STOP — do not deploy.** `rollback/` (extracted source + `firebase.json`) is now an independently deployable artifact. **PAUSE.**

## Step 4 — Validate the rollback baseline source (predicate + compile)
```bash
cd ~/trc \
 && ! grep -qE "match /(trucks|mobile_locations|location_truck_claims|equipment_models|equipment_model_aliases|equipment_part_compatibility|equipment_compatibility_sources|equipment_compatibility_operations)/" rollback/firestore.rules \
 && echo "TARGET-BLOCKS-ABSENT-IN-BASELINE (rollback provably restores the pre-Gate-C state)" \
 && ( cd rollback && firebase deploy --only firestore:rules --project taylor-parts --dry-run && echo BASELINE-COMPILE-OK )
```
**Expected:** `TARGET-BLOCKS-ABSENT-IN-BASELINE` and `BASELINE-COMPILE-OK` (a dry-run compile of the rollback source). If any target block is already present in the live baseline, the change may already be deployed — **STOP and report** (no deploy needed). **PAUSE.**

## Step 5 — Deploy ONLY Firestore Rules
```bash
cd ~/trc/repo && firebase deploy --only firestore:rules --project taylor-parts 2>&1 | tee ../evidence/deploy-output.txt
```
**Expected:** `firestore: released rules firestore.rules to cloud.firestore` … `Deploy complete!` — nothing about functions/hosting/indexes. If the output mentions functions/hosting/indexes, or the deploy fails → STOP → ROLLBACK. **PAUSE.**

## Step 6 — Verify the live ruleset EXTRACTED SOURCE equals the governed Git/LF source
```bash
cd ~/trc && TOKEN=$(gcloud auth print-access-token) \
 && REL=$(curl -s -H "Authorization: Bearer $TOKEN" "https://firebaserules.googleapis.com/v1/projects/taylor-parts/releases" | python3 -c "import sys,json; rs=json.load(sys.stdin)['releases']; print([r['rulesetName'] for r in rs if r['name'].endswith('cloud.firestore')][0])") \
 && curl -s -H "Authorization: Bearer $TOKEN" "https://firebaserules.googleapis.com/v1/$REL" > evidence/post-deploy-production-rules-api.json \
 && python3 -c "import sys,json; fs=json.load(open('evidence/post-deploy-production-rules-api.json'))['source']['files']; f=[x for x in fs if x.get('name','').endswith('firestore.rules')] or fs; sys.stdout.write(f[0]['content'])" > evidence/post-deploy-production.rules \
 && POST=$(sha256sum evidence/post-deploy-production.rules | cut -d" " -f1) \
 && echo "POSTDEPLOY EXTRACTED SOURCE sha256: $POST" | tee evidence/post-deploy-production.rules.sha256 \
 && echo -n "postdeploy API-ARTIFACT sha256 (provenance only): " && sha256sum evidence/post-deploy-production-rules-api.json | tee evidence/post-deploy-production-rules-api.json.sha256 \
 && test "$POST" = "$EXPECTED_RULES_SHA" && echo LIVE-EXTRACTED-SOURCE-EQUALS-GOVERNED
```
**Required:** `LIVE-EXTRACTED-SOURCE-EQUALS-GOVERNED` (extracted **source** hash == governed `bb1492b9…`). The API-artifact hash is retained **separately, labeled**, and is never compared to a source hash. If missing → STOP → ROLLBACK. **PAUSE.**

## Step 7 — Post-deploy Functions inventory comparison (MUST be unchanged)
```bash
cd ~/trc && TOKEN=$(gcloud auth print-access-token) \
 && curl -s -H "Authorization: Bearer $TOKEN" "https://cloudfunctions.googleapis.com/v2/projects/taylor-parts/locations/-/functions" \
      | python3 -c "import sys,json; d=json.load(sys.stdin); print('FUNCTIONS_COUNT', len(d.get('functions',[]))); [print('FN', f['name'].split('/')[-1]) for f in d.get('functions',[])]" | sort | tee evidence/postdeploy-functions-inventory.txt >/dev/null \
 && diff evidence/predeploy-functions-inventory.txt evidence/postdeploy-functions-inventory.txt && echo FUNCTIONS-UNCHANGED
```
**Expected:** `FUNCTIONS-UNCHANGED`. If it differs → STOP and report (this deploy must not touch Functions). **PAUSE.**

## Step 8 — Production verification matrix (disposable fixtures; every fixture/user carries `$TRC_PREFIX`)
Execute `verification-matrix.md` (§4) with real client REST + short-lived password-auth ID tokens for one admin, one dispatcher, one technician, plus unauthenticated. **Client writes (create/update/delete) are attempted for ALL FOUR principals** on `trucks` and `mobile_locations` (rows 5a–5d, 10a–10d) and on `location_truck_claims` + the D4 blocks — every one must DENY. Seed each fixture doc id and each temp Auth user's display/email local-part with `$TRC_PREFIX` and append every created id/uid to `~/trc/created-manifest.txt` as you go, so Step 9 can remove them deterministically even if this step aborts midway. Record labels-and-statuses-only results (no tokens/UIDs/emails/raw records) as `evidence/smoke-results.json`. Any deviation → STOP → ROLLBACK (cleanup still runs via the trap).

## Step 9 — MANDATORY cleanup (runs on EVERY path via the Step-0 trap) + package sanitized evidence
Author `~/trc/step9_cleanup.sh` at the start of the run so the trap can call it. It removes, **idempotently and by `$TRC_PREFIX` / the manifest**, every fixture doc and temp Auth user, and clears any smoke password — and it is safe to run when nothing was created:
```bash
cat > ~/trc/step9_cleanup.sh <<'CLEAN'
#!/usr/bin/env bash
set -uo pipefail
: "${TRC_PREFIX:?}"
# Delete fixture docs (by recorded id) and temp Auth users (by recorded uid); both idempotent.
if [ -f ~/trc/created-manifest.txt ]; then
  while read -r kind ref; do
    case "$kind" in
      DOC)  firebase firestore:delete "$ref" --project taylor-parts --yes >/dev/null 2>&1 || true ;;
      USER) firebase auth:delete "$ref" --project taylor-parts >/dev/null 2>&1 || true ;;
    esac
  done < ~/trc/created-manifest.txt
fi
# Belt-and-suspenders: remove any residual Auth users whose email local-part carries the prefix.
firebase auth:export ~/trc/_users.json --project taylor-parts >/dev/null 2>&1 || true
python3 - "$TRC_PREFIX" <<'PY' 2>/dev/null || true
import json,sys,subprocess,os
pfx=sys.argv[1]; p=os.path.expanduser("~/trc/_users.json")
u=json.load(open(p)).get("users",[]) if os.path.exists(p) else []
for x in u:
    if pfx in (x.get("email","")+x.get("displayName","")):
        subprocess.run(["firebase","auth:delete",x["localId"],"--project","taylor-parts"])
PY
unset TRC_SMOKE_PASSWORD 2>/dev/null || true
rm -f ~/trc/_users.json
echo "CLEANUP-DONE for $TRC_PREFIX"
CLEAN
chmod +x ~/trc/step9_cleanup.sh
```
After the trap has run cleanup, package evidence:
```bash
cd ~/trc/evidence && sha256sum * > checksums.sha256 \
 && ( grep -riE "token|password|secret|bearer|@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|eyJ[A-Za-z0-9_-]{10,}" . | grep -v checksums.sha256 && echo "SENSITIVE-FOUND -- REDACT BEFORE EXPORT" || echo SENSITIVE-SCAN-CLEAN )
```
Fill `deployment-report.md`. A `.gitattributes` (`* -text`) preserves evidence bytes exactly. **Confirm `CLEANUP-DONE` and `SENSITIVE-SCAN-CLEAN` before reporting.**

---

## ROLLBACK (only on a stop/rollback condition — restores the pre-deploy baseline; cleanup still runs via the trap)
```bash
cd ~/trc/rollback && firebase deploy --only firestore:rules --project taylor-parts && sha256sum firestore.rules
```
Then re-run Step 6's fetch + extraction and confirm the postdeploy **extracted source** hash equals the **Step 3 predeploy extracted-source baseline** hash. **Rules only, no data change.** Report immediately either way. The Step-0 `trap` still runs Step 9 cleanup on exit.

## Stop conditions (abort → run ROLLBACK if already deployed → cleanup runs via trap → report)
- Step 1 `GOVERNED-HASH-OK`/`ROOT-MIRROR-IDENTICAL` fails.
- Step 3 baseline capture fails/empty, or the governed-not-in-baseline diff shows ANY block outside §2.
- Step 4 a target block is already present in the baseline, or `BASELINE-COMPILE-OK` fails.
- Step 5 deploy output mentions functions/hosting/indexes, or deploy fails.
- Step 6 `LIVE-EXTRACTED-SOURCE-EQUALS-GOVERNED` missing.
- Step 7 Functions inventory changed.
- Any Step 8 matrix row fails (any unexpected ALLOW, any successful client write by any principal, any DENY where ALLOW expected).
- Sensitive data present in evidence (Step 9).
In every case, **cleanup (Step 9) still runs via the Step-0 trap before the final report.**

## After this handoff (separately Owner-authorized)
Gate D (Truck Registry Admin UI) and Gate A (real governed inventory predicate) remain deferred.

## Non-authorizations (explicit)
This handoff authorizes NO deployment, NO Functions deployment, NO production data mutation beyond disposable Step 8 fixtures, NO Admin UI, NO inventory predicate, and NO Issue #100 change. Deployment requires a separate explicit Owner authorization.
