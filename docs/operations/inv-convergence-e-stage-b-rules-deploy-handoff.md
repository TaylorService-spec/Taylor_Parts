# INV-CONVERGENCE-E Stage B — Production Rules Deployment & Verification Handoff (Cloud Shell)

**Unit:** Stage B production deployment of the canonical `parts` read broadening (PR-B1, merged) + production verification, preserving rollback. **Operator-executed** in Cloud Shell; prepared by the Inventory session. **This document authorizes NO deployment.** Deployment (and any production persona provisioning) is a separate, separately Owner + ChatGPT authorized gate.

> **DEPLOYMENT READINESS: BLOCKED (Owner decision, 2026-07-26).** The two new positive production branches — active reciprocally-linked **PARTS_MANAGER** and active reciprocally-linked **WAREHOUSE_MANAGER** — are **not yet READY**. PR-B2 emulator evidence proves the Rules logic locally but does **not** independently prove that **both** operational-role branches resolve correctly against the **live production** user/employee linkage model. Each branch must be made READY via exactly one approved path (§3: A — existing governed persona, or B — a separate governed fixture gate) and then **exercised directly in production** before the deployment can be authorized. **No fixture creation is authorized by this handoff.** Deployment stays BLOCKED until both new positive branches are READY and directly verified.

Follows the **F-RULES-1 D2 precedent** (`f-rules-1-d2-deployment-handoff.md`): self-derive the governed hash from the Git/LF source, capture a rollback baseline (extracted source) before deploying, verify the **extracted live source** equals the governed Git/LF source, run a production matrix, package sanitized evidence.

**Governing inputs (all merged):** Stage B design (PR #431) · PR-B1 Rules implementation (PR #432, merge `60dc845`) · PR-B2 clean-checkout emulator evidence (PR #433, merge `8043518`) · `docs/specifications/inv-convergence-e-stage-b-operational-role-parts-rules.md` · `docs/audits/inv-convergence-e-stage-b-pr-b2/`.

---

## 0. Baseline, governed commit, and Rules hash

- **Deploy commit (pinned):** `804351831d2d5a90c97481a57373a5960e42ab75` (current `origin/main`; the PR-B2 evidence merge). The governed `firestore.rules` blob is **byte-identical** to PR-B1 merge `60dc845` — the PR-B2 merge changed only `docs/**` + `.gitattributes`, no Rules bytes.
- **Canonical governed deployment hash (Owner-approved, 2026-07-26) — the Git/LF stored-source SHA-256:**
  `cf6681c61f7c93a6b5b5385212518636b855b24a751225564429e0f8932bc381`
  This is the SHA-256 of the **LF-normalized Rules source content stored in Git**, produced by `git show <DEPLOY_COMMIT>:firestore.rules | sha256sum` (equivalently `git cat-file blob <DEPLOY_COMMIT>:firestore.rules | sha256sum`). Root and mirror `field-ops-app-vite/firestore.rules` produce the **same** hash → byte-identical.

### 0.1 Hash reconciliation (Owner decision — recorded additively)

Two hashes describe the **same governed textual Rules content** under different line-ending byte encodings:

| Hash | Byte representation | Role |
|---|---|---|
| `cf6681c61f7c93a6b5b5385212518636b855b24a751225564429e0f8932bc381` | **Git/LF stored source** (100,003 bytes) | **CANONICAL deployment hash.** Cloud Shell and all deploy-side verification MUST use this value. |
| `02663e0a730c3e70339f35b78245306ac4a14781b896be67d618f720fb1aa139` | **Windows CRLF working-copy** (101,639 bytes) | **Historical** — the PR-B1/PR-B2 evidence bytes on the authoring machine. Retained as-is; **not** used for deploy-side verification. |

Governance rules (apply going forward):
- Both hashes represent the **same governed textual Rules content**; they differ **only** by line-ending encoding.
- `02663e0a…` is the **Windows CRLF working-copy hash**; `cf6681c6…` is the **canonical stored-Git/LF deployment hash**.
- **Cloud Shell and deploy-side verification must use `cf6681c6…`.**
- **Historical PR-B2 evidence must not be rewritten** — the `02663e0a…` value stays in the PR-B1/PR-B2 audit records exactly as recorded.
- This reconciliation is recorded **additively** here and in `docs/SPRINT_STATUS.md`.
- **Future Rules evidence must identify the byte representation (Git/LF source vs. CRLF working-copy) before stating any hash.**

Deploy-side verification always operates on **extracted LF source content bytes**, never on a raw Firebase Rules API JSON response (see §0.2 and Steps 3 & 6). Do not hash a full API JSON body and compare it to the repository source file — those are different artifact types.

### 0.2 Hash terminology (two distinct artifact classes)

- **Source-content hash** — SHA-256 of the extracted `firestore.rules` LF source bytes (from Git, or extracted from a live ruleset's source file). Only source-content hashes are compared for equivalence, and they must equal `cf6681c6…`.
- **API-artifact hash** — SHA-256 of a **complete** Firebase Rules API JSON response saved verbatim. Captured and retained for provenance **only**; it is **never** compared to a source-content hash. Always label API-artifact hashes as such.

- **Authorized Rules semantic change (the ONLY one this deployment carries):**
  ```
  match /parts/{partId} {
    allow read: if isAdminOrDispatcher()
      || isActiveOperationalRole("PARTS_MANAGER")
      || isActiveOperationalRole("WAREHOUSE_MANAGER");
    allow create, update, delete: if false;
  }
  ```
  All other Rules behavior is unchanged (the deploy ships the whole current governed `firestore.rules`; only the `parts` read predicate differs from the currently-live production ruleset).

## 1. Hard boundaries

Deploy **ONLY** `firestore:rules`. **No** Functions, Hosting, indexes, or extensions. **No** Rules edits during the run. **No** Firestore data mutation. **No** creation or mutation of any production user, employee, role, claim, or accessVersion. **No fixture creation is authorized by this handoff.** No C1/C2. Single operator, release lock held throughout.

## 2. Release lock / single-operator requirement

`firestore.rules` is a **shared** file (Customer + Inventory both change it). Before capturing the rollback baseline, take the shared-Rules release lock (announce in the ops channel; confirm no other Rules deploy is in flight) and **hold it through the post-deploy byte-verify (Step 6)**. Only one operator runs this sequence. If another Rules change is mid-flight, **STOP**.

## 3. Production persona readiness assessment

This handoff does **not** assume the 12 verification personas exist in production, and **authorizes creating none**. Confirmed pre-approved production test principals (from the I-1 deployment) are **admin, dispatcher, technician** only.

| # | Persona | Expected `parts` read | Readiness | Method (no identity mutation) |
|---|---|---|---|---|
| 1 | signed out | DENY | **READY** | anonymous probe (no token) |
| 2 | authenticated, no application access | DENY | **N/A WITH APPROVED SUBSTITUTE** | PR-B2 emulator DENY proof + read-only Rules inspection (read requires `isSignedIn()` + role/employee); do not fabricate a no-access prod account |
| 3 | admin | ALLOW | **READY** | pre-approved admin test principal |
| 4 | dispatcher | ALLOW | **READY** | pre-approved dispatcher test principal |
| 5 | active reciprocally-linked PARTS_MANAGER | ALLOW | **BLOCKED — must become READY (Path A or B) then be exercised DIRECTLY** | positive proof of a NEW branch; substitute is NOT sufficient. Resolve via §3.1 Path A (existing governed persona) or Path B (separate governed fixture gate). Must be exercised directly in production and return ALLOW before deployment authorization. Do **not** create here. |
| 6 | active reciprocally-linked WAREHOUSE_MANAGER | ALLOW | **BLOCKED — must become READY (Path A or B) then be exercised DIRECTLY** | same as #5 for WAREHOUSE_MANAGER — its own distinct branch; **may not** be substituted by the PARTS_MANAGER result. Resolve via §3.1 Path A or B; exercise directly; ALLOW required before deployment authorization. |
| 7 | PARTS_ASSOCIATE-only | DENY | **N/A WITH APPROVED SUBSTITUTE** | negative check; PR-B2 emulator DENY proof + read-only inspection. If a PARTS_ASSOCIATE test principal already exists → **READY** (low-risk negative check) |
| 8 | technician without permitted operational role | DENY | **READY** | pre-approved technician test principal |
| 9 | suspended employee (holds otherwise-permitted role) | DENY | **NOT SAFE TO CREATE** | do not suspend a real employee; substitute = PR-B2 emulator DENY proof + read-only inspection |
| 10 | broken reciprocal linkage | DENY | **NOT SAFE TO CREATE** | do not corrupt linkage; substitute = PR-B2 emulator DENY proof + read-only inspection |
| 11 | stale accessVersion + otherwise-valid live PARTS_MANAGER | ALLOW | **NOT SAFE TO CREATE** | do not manipulate accessVersion; substitute = PR-B2 emulator ALLOW proof (accessVersion not consulted) + (if #5 READY) read-only confirmation the same principal reads regardless of accessVersion |
| 12 | malformed / missing user or employee document | DENY | **NOT SAFE TO CREATE** | do not fabricate malformed identity; substitute = PR-B2 emulator DENY proof + read-only Rules inspection |

### 3.1 Resolving the two new positive branches (BLOCKING prerequisite)

Both **PARTS_MANAGER** (#5) and **WAREHOUSE_MANAGER** (#6) must independently become READY via **exactly one** of the following approved paths, and then be **exercised directly in production**. **Neither may substitute for the other** — each named Rules branch (`isActiveOperationalRole("PARTS_MANAGER")` and `isActiveOperationalRole("WAREHOUSE_MANAGER")`) must be exercised and return the expected ALLOW.

- **Path A — EXISTING GOVERNED PERSONA.** Use an existing production test principal whose **current** state already satisfies: existing authenticated test account · existing `users` document · existing reciprocally-linked `employees` document · `employmentStatus == "ACTIVE"` · `operationalRoles` includes the required role · **no identity or access mutation needed**. Record only a **sanitized readiness label + evidence result** — never email, UID, employee ID, token, or raw document.
- **Path B — SEPARATE GOVERNED FIXTURE GATE.** If no existing governed persona satisfies the state, prepare a **separate Owner-reviewed fixture plan** covering: why the fixture is required · the exact existing test identity to be used · the proposed employee linkage · the proposed operational role · lifecycle and cleanup · audit record · rollback · confirmation that **no real employee's access is changed**. **No fixture creation is authorized by this handoff (PR #434);** Path B is its own gate.

Until BOTH branches are READY (via A or B) **and** directly verified in production returning ALLOW, **deployment readiness is BLOCKED**.

### 3.2 Deploy-gate persona classification

**Must be exercised DIRECTLY in production before deployment-gate closure (6):** signed out · admin · dispatcher · active reciprocally-linked PARTS_MANAGER · active reciprocally-linked WAREHOUSE_MANAGER · technician without a permitted operational role.

**May use APPROVED SUBSTITUTE evidence where creating the state would be unsafe (6):** authenticated without application access · PARTS_ASSOCIATE-only · suspended employee · broken reciprocal linkage · stale accessVersion · malformed or missing documents.

**APPROVED SUBSTITUTE VERIFICATION METHOD (substitute personas only):** for each, the evidence must identify (a) the **emulator test reference** — the committed PR-B2 proof for that exact principal (`docs/audits/inv-convergence-e-stage-b-pr-b2/stage-b-matrix-summary.txt`); (b) **read-only production inspection** of the relevant identity data shape where available (never acting as, never mutating); (c) **why direct production construction is unsafe or unnecessary**; and (d) **confirmation no identity data was mutated**. Production negative-path checks (a denied read/write returns 403 before any change) never mutate data.

**The production deployment cannot be declared verified unless both new positive role branches are exercised directly and return the expected ALLOW.** The deploy gate must record, per persona, whether it was exercised live or by approved substitute.

## 4. Full production verification matrix

For **every available/authorized persona**, verify each operation (all non-mutating: reads are read-only; writes are **denied-write probes** that return 403 *before* any mutation, so they never change data):

- `parts` list read · single `parts` read · `parts` create · `parts` update · `parts` delete
- `manufacturers` read · `manufacturers` write
- `part_aliases` read · `part_aliases` write
- `part_supplier_items` read · `part_supplier_items` write

**Expected read ALLOW:** admin, dispatcher, valid active PARTS_MANAGER, valid active WAREHOUSE_MANAGER, stale-accessVersion principal whose live employee record otherwise satisfies PARTS_MANAGER.
**Expected all other `parts` reads:** DENY.
**Expected all client `parts` create/update/delete:** DENY (every persona).
**Expected all adjacent-collection (`manufacturers`/`part_aliases`/`part_supplier_items`) read + write:** DENY (every persona).

Probe mechanism: obtain each available persona's ID token (existing pre-approved principals only), then issue authenticated production Firestore REST calls (`GET .../documents/parts`, `GET .../documents/parts/{id}`, and `POST/PATCH/DELETE` denied-write probes against a throwaway doc id / an existing seed id that is never actually written because the rule denies). Record HTTP status per (persona, operation): 200 = ALLOW, 403 = DENY. **Any 200 on a write, any 200 on an unauthorized read, or any adjacent-collection 200 ⇒ STOP → ROLLBACK.**

---

## Step 1 — Clone the pinned commit and self-derive the governed hash

```bash
git clone https://github.com/TaylorService-spec/Taylor_Parts.git sb && cd sb \
 && DEPLOY_COMMIT=804351831d2d5a90c97481a57373a5960e42ab75 \
 && git checkout "$DEPLOY_COMMIT" \
 && git show "$DEPLOY_COMMIT:firestore.rules" > governed-root.rules \
 && git show "$DEPLOY_COMMIT:field-ops-app-vite/firestore.rules" > governed-mirror.rules \
 && cmp governed-root.rules governed-mirror.rules && echo ROOT-MIRROR-IDENTICAL \
 && sha256sum governed-root.rules governed-mirror.rules \
 && EXPECTED_RULES_SHA=$(sha256sum governed-root.rules | cut -d" " -f1) \
 && echo "governed Git/LF source hash: $EXPECTED_RULES_SHA"
```
**Expected:** `ROOT-MIRROR-IDENTICAL` (cmp exit 0), then both `sha256sum` lines equal to
`cf6681c61f7c93a6b5b5385212518636b855b24a751225564429e0f8932bc381`, then
`governed Git/LF source hash: cf6681c6…`. Both `governed-root.rules` and `governed-mirror.rules` are **extracted Git/LF source** (from `git show`), so this is a **source-content hash** (§0.2), not a working-copy or API-artifact hash. If `cmp` fails, or either hash is not `cf6681c6…`, **STOP** (do not substitute the historical `02663e0a…` Windows-CRLF value). Keep this shell — `$EXPECTED_RULES_SHA` and `$DEPLOY_COMMIT` are reused below. **PAUSE.**

## Step 2 — Confirm no Functions/index/data are in scope (pre-deploy inventory)

```bash
TOKEN=$(gcloud auth print-access-token) \
 && curl -s -H "Authorization: Bearer $TOKEN" "https://cloudfunctions.googleapis.com/v2/projects/taylor-parts/locations/-/functions" \
      | python3 -c "import sys,json; d=json.load(sys.stdin); print('FUNCTIONS_COUNT', len(d.get('functions',[]))); [print('FN', f['name'].split('/')[-1]) for f in d.get('functions',[])]" | tee predeploy-functions-inventory.txt
```
**Expected:** the current Functions list — recorded as the pre-deploy baseline for the post-deploy comparison (Step 7). No change is made to Functions. **PAUSE.**

## Step 3 — Capture the production Rules baseline as EXTRACTED SOURCE + full API artifact (rollback artifact)

Capture the rollback baseline as **extracted `firestore.rules` source bytes** (not merely an API JSON artifact), and separately retain the **complete live Rules API artifact** with its own labeled artifact hash.

```bash
mkdir -p rollback sb-evidence \
 && TOKEN=$(gcloud auth print-access-token) \
 && REL=$(curl -s -H "Authorization: Bearer $TOKEN" "https://firebaserules.googleapis.com/v1/projects/taylor-parts/releases" | python3 -c "import sys,json; rs=json.load(sys.stdin)['releases']; print([r['rulesetName'] for r in rs if r['name'].endswith('cloud.firestore')][0])") \
 && curl -s -H "Authorization: Bearer $TOKEN" "https://firebaserules.googleapis.com/v1/$REL" > sb-evidence/predeploy-live-rules-api.json \
 # 1) EXTRACT ONLY the firestore.rules source file's content bytes -- no JSON quoting, no added trailing newline:
 && python3 -c "import sys,json; fs=json.load(open('sb-evidence/predeploy-live-rules-api.json'))['source']['files']; f=[x for x in fs if x.get('name','').endswith('firestore.rules')] or fs; sys.stdout.write(f[0]['content'])" > rollback/firestore.rules \
 && cp rollback/firestore.rules sb-evidence/predeploy-live-firestore.rules \
 && printf '{"firestore":{"rules":"firestore.rules"}}\n' > rollback/firebase.json \
 && head -1 rollback/firestore.rules \
 # 2) SOURCE-content hash of the extracted predeploy source (rollback baseline):
 && echo -n "predeploy EXTRACTED SOURCE sha256: " && sha256sum rollback/firestore.rules | tee sb-evidence/predeploy-live-firestore.rules.sha256 \
 # 3) API-ARTIFACT hash of the complete JSON response (provenance only -- NEVER compared to a source hash):
 && echo -n "predeploy API-ARTIFACT sha256: " && sha256sum sb-evidence/predeploy-live-rules-api.json | tee sb-evidence/predeploy-live-rules-api.json.sha256
```
**Expected:** first line `rules_version = '2';`; a `predeploy EXTRACTED SOURCE sha256` (the PRE-Stage-B live baseline source hash — reflects the current admin/dispatcher-only `parts` read predicate; it will differ from `cf6681c6…`); and a separately-labeled `predeploy API-ARTIFACT sha256`. If the extracted source is empty/malformed, **STOP — do not deploy without a preserved source baseline.** `rollback/` (extracted **source** + `firebase.json`) is now an independently deployable artifact. **PAUSE.**

## Step 4 — Validate the rollback baseline source (predicate + compile)

```bash
echo "== parts block ==" && grep -n "match /parts/{partId}" -A3 rollback/firestore.rules \
 && grep -q "allow read: if isAdminOrDispatcher();" rollback/firestore.rules && echo PRIOR-PREDICATE-PRESENT \
 && ! grep -q 'isActiveOperationalRole("PARTS_MANAGER")' rollback/firestore.rules \
 && ! grep -q 'isActiveOperationalRole("WAREHOUSE_MANAGER")' rollback/firestore.rules \
 && echo NEW-BRANCHES-ABSENT-IN-BASELINE
# Optional dry-run compile validation of the rollback source where supported:
# ( cd rollback && firebase deploy --only firestore:rules --project taylor-parts --dry-run )
```
**Expected:** the parts block, then `PRIOR-PREDICATE-PRESENT` and `NEW-BRANCHES-ABSENT-IN-BASELINE` — i.e., the baseline `parts` read is `allow read: if isAdminOrDispatcher();` and contains **neither** new operational-role branch (so a rollback provably restores admin/dispatcher-only reads). Where a Rules dry-run/compile validation is supported, run it against the rollback source and confirm it validates. If `PRIOR-PREDICATE-PRESENT` is missing, or either new branch is already present in the live baseline, the change may already be deployed — **STOP and report** (no deploy needed). **PAUSE.**

## Step 5 — Deploy ONLY Firestore Rules

```bash
firebase deploy --only firestore:rules --project taylor-parts 2>&1 | tee sb-evidence/deploy-output.txt
```
**Expected:** `firestore: released rules firestore.rules to cloud.firestore` … `Deploy complete!` — nothing about functions/hosting/indexes. **PAUSE.**

## Step 6 — Verify the live ruleset EXTRACTED SOURCE equals the governed Git/LF source

Do **not** hash the complete Rules API JSON response and compare it to the repository source. Instead: (1) fetch the active `cloud.firestore` release, (2) resolve its ruleset name, (3) fetch that ruleset, (4) locate the source file representing `firestore.rules`, (5) extract **only its content bytes** (no JSON quoting, no added trailing newline), (6) save those extracted LF source bytes, (7) hash the extracted **source**, (8) compare to the governed Git/LF source hash. Separately retain the complete API artifact with its own **API-artifact** hash.

```bash
TOKEN=$(gcloud auth print-access-token) \
 # (1)(2) active cloud.firestore release -> ruleset name
 && REL=$(curl -s -H "Authorization: Bearer $TOKEN" "https://firebaserules.googleapis.com/v1/projects/taylor-parts/releases" | python3 -c "import sys,json; rs=json.load(sys.stdin)['releases']; print([r['rulesetName'] for r in rs if r['name'].endswith('cloud.firestore')][0])") \
 # (3) fetch that ruleset -- retain the COMPLETE API artifact verbatim
 && curl -s -H "Authorization: Bearer $TOKEN" "https://firebaserules.googleapis.com/v1/$REL" > sb-evidence/postdeploy-live-rules-api.json \
 # (4)(5)(6) locate the firestore.rules source file, extract ONLY its content bytes, save as LF source
 && python3 -c "import sys,json; fs=json.load(open('sb-evidence/postdeploy-live-rules-api.json'))['source']['files']; f=[x for x in fs if x.get('name','').endswith('firestore.rules')] or fs; sys.stdout.write(f[0]['content'])" > sb-evidence/postdeploy-live-firestore.rules \
 # (7) SOURCE-content hash of the extracted live source
 && POSTDEPLOY_EXTRACTED_SOURCE_SHA256=$(sha256sum sb-evidence/postdeploy-live-firestore.rules | cut -d" " -f1) \
 && echo "POSTDEPLOY EXTRACTED SOURCE sha256: $POSTDEPLOY_EXTRACTED_SOURCE_SHA256" | tee sb-evidence/postdeploy-live-firestore.rules.sha256 \
 # API-ARTIFACT hash (provenance only -- NEVER compared to a source hash)
 && echo -n "postdeploy API-ARTIFACT sha256: " && sha256sum sb-evidence/postdeploy-live-rules-api.json | tee sb-evidence/postdeploy-live-rules-api.json.sha256 \
 # (8) source-equivalence assertion
 && test "$POSTDEPLOY_EXTRACTED_SOURCE_SHA256" = "$EXPECTED_RULES_SHA" \
 && test "$POSTDEPLOY_EXTRACTED_SOURCE_SHA256" = "cf6681c61f7c93a6b5b5385212518636b855b24a751225564429e0f8932bc381" \
 && echo LIVE-EXTRACTED-SOURCE-EQUALS-GOVERNED-GIT-LF
```
**Required assertion:** `POSTDEPLOY_EXTRACTED_SOURCE_SHA256 == GOVERNED_GIT_LF_SHA256 == cf6681c61f7c93a6b5b5385212518636b855b24a751225564429e0f8932bc381`, printed as `LIVE-EXTRACTED-SOURCE-EQUALS-GOVERNED-GIT-LF`. The `postdeploy API-ARTIFACT sha256` is retained **separately and labeled as an API-artifact hash** — it is provenance only and is **never** compared to the source hash. If the source-equivalence line is missing, **STOP → ROLLBACK.** The release lock may be released only after this line prints. **PAUSE.**

## Step 7 — Post-deploy Functions inventory comparison

```bash
TOKEN=$(gcloud auth print-access-token) \
 && curl -s -H "Authorization: Bearer $TOKEN" "https://cloudfunctions.googleapis.com/v2/projects/taylor-parts/locations/-/functions" \
      | python3 -c "import sys,json; d=json.load(sys.stdin); print('FUNCTIONS_COUNT', len(d.get('functions',[]))); [print('FN', f['name'].split('/')[-1]) for f in d.get('functions',[])]" | tee postdeploy-functions-inventory.txt \
 && diff predeploy-functions-inventory.txt postdeploy-functions-inventory.txt && echo FUNCTIONS-UNCHANGED
```
**Expected:** `FUNCTIONS-UNCHANGED`. If the inventory differs, **STOP and report** (this deploy must not touch Functions). **PAUSE.**

## Step 8 — Production persona verification matrix

Run §4 for every persona in the §3.2 **must-exercise-directly** set, plus each **substitute** persona's approved evidence. Record HTTP status per (persona, operation) into `sb-evidence/production-matrix.md` — **labels and statuses only, no tokens/UIDs/emails/raw records** — and note, per persona, whether it was exercised **live** or by **approved substitute**. Assertions:

- **Directly exercised (required live):** signed-out **DENY** · admin **ALLOW** · dispatcher **ALLOW** · active PARTS_MANAGER **ALLOW** · active WAREHOUSE_MANAGER **ALLOW** · technician-without-role **DENY**.
- **Both new positive branches must be exercised DIRECTLY and return ALLOW** — `isActiveOperationalRole("PARTS_MANAGER")` via persona #5 and `isActiveOperationalRole("WAREHOUSE_MANAGER")` via persona #6, **independently** (one may not stand in for the other). If either is not directly exercised, the deployment **cannot be declared verified** ⇒ **ROLLBACK**.
- **Substitute personas:** DENY (or the documented outcome) confirmed via the §3.2 approved-substitute evidence (emulator reference + read-only inspection + no-mutation confirmation).
- Every `parts` write **DENY**; every adjacent-collection read/write **DENY** — for every persona.

Any unexpected ALLOW (unauthorized reader, any successful write, any adjacent-collection access), any expected-reader DENY (including a PARTS_MANAGER or WAREHOUSE_MANAGER expected-ALLOW returning DENY), or any Rules mismatch ⇒ **STOP → ROLLBACK.** **PAUSE.**

## Step 9 — Package sanitized evidence

```bash
cd sb-evidence \
 && sha256sum * > SHA256SUMS.txt \
 && ( grep -riE "token|password|secret|bearer|@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|eyJ[A-Za-z0-9_-]{10,}" . | grep -v SHA256SUMS.txt && echo "SENSITIVE-FOUND -- REDACT BEFORE EXPORT" || echo SENSITIVE-SCAN-CLEAN ) \
 && cd .. && tar czf inv-convergence-e-stage-b-deploy-evidence.tgz sb-evidence && sha256sum inv-convergence-e-stage-b-deploy-evidence.tgz
```
**Expected:** `SENSITIVE-SCAN-CLEAN`; tarball + its sha256 (record it). Download for the Inventory-session evidence import PR. Evidence includes, each clearly labeled by artifact class: **extracted source** files (`predeploy-live-firestore.rules`, `postdeploy-live-firestore.rules`) + their **source-content** SHA-256; **complete API artifacts** (`predeploy-live-rules-api.json`, `postdeploy-live-rules-api.json`) + their **API-artifact** SHA-256 (provenance only, not equivalence); deploy output; pre/post Functions inventory + `FUNCTIONS-UNCHANGED`; the `LIVE-EXTRACTED-SOURCE-EQUALS-GOVERNED-GIT-LF` confirmation; the production matrix with per-persona live-vs-substitute notes. **No credential, token, UID, email, or raw record in committed evidence.** **DONE — report back with the tarball + both predeploy/postdeploy extracted-source SHA-256 + both API-artifact SHA-256 (labeled) + the matrix result.**

---

## ROLLBACK (only on a stop/rollback condition — restores the pre-Stage-B baseline)

```bash
cd ~/sb/rollback && firebase deploy --only firestore:rules --project taylor-parts && sha256sum firestore.rules
```
Then re-run Step 6's fetch + **extraction**, and confirm the postdeploy **extracted source** hash equals the **Step 3 predeploy extracted-source baseline** hash. Report immediately either way.

- **Rollback target:** restore the prior production `parts` read predicate `allow read: if isAdminOrDispatcher();`.
- **Rollback source:** the Step 3 captured **extracted source bytes** (`rollback/firestore.rules`), validated in Step 4 (prior predicate present, both new branches absent, compile/dry-run where supported), or a reviewed prior governed Rules commit. **Rules only. No data change.** Restores admin/dispatcher-only reads.
- **No data rollback** is ever involved (read-only grant; no writes changed).

## Stop conditions (abort → run ROLLBACK → report)

- `ROOT-MIRROR-IDENTICAL` fails or the governed Git/LF source hash ≠ `cf6681c6…` (Step 1).
- Predeploy live baseline **extracted source** empty/malformed or not captured, or its API artifact/hash not retained (Step 3).
- Rollback source fails validation: prior predicate absent, either new branch present, or compile/dry-run fails (Step 4) — change may already be deployed; STOP and report.
- Deploy output mentions functions/hosting/indexes, or deploy fails (Step 5).
- `LIVE-EXTRACTED-SOURCE-EQUALS-GOVERNED-GIT-LF` missing, or the deployed **extracted-source** hash differs from the governed Git/LF hash (Step 6).
- Functions inventory changed (Step 7).
- Either new positive branch (PARTS_MANAGER, WAREHOUSE_MANAGER) not exercised **directly**, or its expected ALLOW returns DENY (Step 8).
- Any unauthorized `parts` read ALLOW, admin/dispatcher read regression, any successful client write, any adjacent-collection access (Step 8).
- Any step would require creating/mutating a production user/employee/role/claim/accessVersion (prohibited) — STOP and request a separate governed provisioning authorization (§3.1 Path B) instead.
- Sensitive data present in evidence (Step 9).

## Rollback conditions (trigger rollback immediately on any of)

- any unauthorized ALLOW;
- **PARTS_MANAGER** expected ALLOW returns DENY;
- **WAREHOUSE_MANAGER** expected ALLOW returns DENY;
- admin or dispatcher read regression;
- any `parts` client write succeeds;
- any adjacent canonical collection (`manufacturers`/`part_aliases`/`part_supplier_items`) becomes accessible;
- the deployed **extracted-source** hash differs from the governed Git/LF hash (`cf6681c6…`);
- Functions inventory changes;
- deployment scope expands beyond Firestore Rules;
- evidence is incomplete or contains sensitive information.

## After this handoff (separately Owner-authorized)

Evidence import + Stage B deploy-closure PR (docs/audits) → then, only after production verification is accepted, **C1 (PartsList cutover)** becomes eligible for its own separate gate. **C1 remains BLOCKED until this deploy + production verification gate closes.**

## Non-authorizations (explicit)

This document authorizes **no deployment**. No production Rules deploy, no Functions/index/Hosting/data deploy, no production data access beyond read-only verification, no creation/mutation of any production identity data, no fixture creation, no C1/C2, no static-catalog or adapter change. Decisions #43–#46 unchanged.
