# INV-CONVERGENCE-E Stage B — Production Rules Deployment & Verification Handoff (Cloud Shell)

**Unit:** Stage B production deployment of the canonical `parts` read broadening (PR-B1, merged) + production verification, preserving rollback. **Operator-executed** in Cloud Shell; prepared by the Inventory session. **This document authorizes NO deployment.** Deployment (and any production persona provisioning) is a separate, separately Owner + ChatGPT authorized gate.

Follows the **F-RULES-1 D2 precedent** (`f-rules-1-d2-deployment-handoff.md`): self-derive every hash from the git blob, capture a rollback baseline before deploying, byte-verify the live ruleset equals the governed blob, run a production matrix, package sanitized evidence.

**Governing inputs (all merged):** Stage B design (PR #431) · PR-B1 Rules implementation (PR #432, merge `60dc845`) · PR-B2 clean-checkout emulator evidence (PR #433, merge `8043518`) · `docs/specifications/inv-convergence-e-stage-b-operational-role-parts-rules.md` · `docs/audits/inv-convergence-e-stage-b-pr-b2/`.

---

## 0. Baseline, governed commit, and Rules hash

- **Deploy commit (pinned):** `804351831d2d5a90c97481a57373a5960e42ab75` (current `origin/main`; the PR-B2 evidence merge). The governed `firestore.rules` blob is **byte-identical** to PR-B1 merge `60dc845` — the PR-B2 merge changed only `docs/**` + `.gitattributes`, no Rules bytes.
- **Governed root `firestore.rules` git-blob SHA-256 (canonical — derive, never hand-copy):**
  `cf6681c61f7c93a6b5b5385212518636b855b24a751225564429e0f8932bc381`
  Derive on the operator's Linux checkout with `git show HEAD:firestore.rules | sha256sum` (equivalently `git cat-file blob HEAD:firestore.rules | sha256sum`). Root and mirror `field-ops-app-vite/firestore.rules` produce the **same** blob hash → byte-identical.

> **⚠ OPEN ITEM for Owner + ChatGPT — hash reconciliation (must confirm before deploy).**
> The Stage B PR-B1/PR-B2 evidence (and the deploy-authorization gate text) pinned the governed root Rules SHA-256 as
> `02663e0a730c3e70339f35b78245306ac4a14781b896be67d618f720fb1aa139`.
> That value is the **Windows working-copy hash** (CRLF, 101,639 bytes) produced by the authoring machine's autocrlf checkout. The **raw stored git blob is LF** (100,003 bytes) and hashes to
> `cf6681c61f7c93a6b5b5385212518636b855b24a751225564429e0f8932bc381`,
> which is exactly what a **Linux Cloud Shell** `git clone`/`git show` materializes and what `firebase deploy` uploads and the live-ruleset fetch returns. The two hashes describe the **same governed content** under different line-ending encodings (byte-identity of root vs mirror holds under both). **This handoff pins the Linux/Cloud-Shell git-blob hash `cf6681c6…` as canonical for all deploy-side comparisons**, because `02663e0a…` will never appear in Cloud Shell. No Rules bytes are changed to reconcile this (that would be an unauthorized change); the reconciliation is documentary. **Do not proceed to deploy until Owner + ChatGPT confirm `cf6681c6…` is the value the deploy gate should verify against.**

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
| 5 | active reciprocally-linked PARTS_MANAGER | ALLOW | **REQUIRES GOVERNED FIXTURE** | positive proof of the NEW grant. Do **not** create here. If Owner confirms an existing pre-approved active reciprocally-linked PARTS_MANAGER test principal → **READY**; else the deploy gate decides between (a) governed provisioning via the approved provisioning path (separate authorization) or (b) the APPROVED SUBSTITUTE below |
| 6 | active reciprocally-linked WAREHOUSE_MANAGER | ALLOW | **REQUIRES GOVERNED FIXTURE** | same as #5 for WAREHOUSE_MANAGER |
| 7 | PARTS_ASSOCIATE-only | DENY | **N/A WITH APPROVED SUBSTITUTE** | negative check; PR-B2 emulator DENY proof + read-only inspection. If a PARTS_ASSOCIATE test principal already exists → **READY** (low-risk negative check) |
| 8 | technician without permitted operational role | DENY | **READY** | pre-approved technician test principal |
| 9 | suspended employee (holds otherwise-permitted role) | DENY | **NOT SAFE TO CREATE** | do not suspend a real employee; substitute = PR-B2 emulator DENY proof + read-only inspection |
| 10 | broken reciprocal linkage | DENY | **NOT SAFE TO CREATE** | do not corrupt linkage; substitute = PR-B2 emulator DENY proof + read-only inspection |
| 11 | stale accessVersion + otherwise-valid live PARTS_MANAGER | ALLOW | **NOT SAFE TO CREATE** | do not manipulate accessVersion; substitute = PR-B2 emulator ALLOW proof (accessVersion not consulted) + (if #5 READY) read-only confirmation the same principal reads regardless of accessVersion |
| 12 | malformed / missing user or employee document | DENY | **NOT SAFE TO CREATE** | do not fabricate malformed identity; substitute = PR-B2 emulator DENY proof + read-only Rules inspection |

**APPROVED SUBSTITUTE VERIFICATION METHOD (for every REQUIRES-FIXTURE / NOT-SAFE / N/A persona above):** rely on (a) the committed PR-B2 emulator proof for that exact principal (`docs/audits/inv-convergence-e-stage-b-pr-b2/stage-b-matrix-summary.txt`), (b) read-only inspection of the relevant production identity data shape (never acting as, never mutating), and (c) production negative-path checks that cannot mutate identity data (a denied read/write returns 403 before any change). **No persona is created or mutated.**

The MINIMUM safe production signal set is: **admin ALLOW + dispatcher ALLOW (no-regression) + technician DENY (no accidental broadening) + signed-out DENY**, plus, where a PARTS_MANAGER/WAREHOUSE_MANAGER principal is Owner-confirmed to exist, a positive ALLOW for the new grant. Everything else is covered by the PR-B2 emulator proof + read-only inspection. **The deploy gate must record which personas were exercised live vs. by approved substitute.**

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
git clone --branch docs/inv-convergence-e-stage-b-deploy-handoff https://github.com/TaylorService-spec/Taylor_Parts.git sb && cd sb \
 && git checkout 804351831d2d5a90c97481a57373a5960e42ab75 \
 && EXPECTED_RULES_SHA=$(git show HEAD:firestore.rules | sha256sum | cut -d" " -f1) \
 && echo "governed blob: $EXPECTED_RULES_SHA" \
 && test "$(sha256sum firestore.rules | cut -d" " -f1)" = "$EXPECTED_RULES_SHA" && echo TREE-MATCHES-BLOB \
 && test "$(git show HEAD:field-ops-app-vite/firestore.rules | sha256sum | cut -d" " -f1)" = "$EXPECTED_RULES_SHA" && echo MIRROR-MATCHES-BLOB
```
**Expected:** `governed blob: cf6681c61f7c93a6b5b5385212518636b855b24a751225564429e0f8932bc381`, then `TREE-MATCHES-BLOB` and `MIRROR-MATCHES-BLOB`. On Linux the working tree equals the blob, so all three agree. If `governed blob:` is not `cf6681c6…`, **STOP** (see the §0 open item; do not substitute `02663e0a…`). Keep this shell — `$EXPECTED_RULES_SHA` is reused in Step 6. **PAUSE.**

## Step 2 — Confirm no Functions/index/data are in scope (pre-deploy inventory)

```bash
TOKEN=$(gcloud auth print-access-token) \
 && curl -s -H "Authorization: Bearer $TOKEN" "https://cloudfunctions.googleapis.com/v2/projects/taylor-parts/locations/-/functions" \
      | python3 -c "import sys,json; d=json.load(sys.stdin); print('FUNCTIONS_COUNT', len(d.get('functions',[]))); [print('FN', f['name'].split('/')[-1]) for f in d.get('functions',[])]" | tee predeploy-functions-inventory.txt
```
**Expected:** the current Functions list — recorded as the pre-deploy baseline for the post-deploy comparison (Step 7). No change is made to Functions. **PAUSE.**

## Step 3 — Capture the production Rules baseline (rollback artifact)

```bash
mkdir -p rollback sb-evidence \
 && TOKEN=$(gcloud auth print-access-token) \
 && REL=$(curl -s -H "Authorization: Bearer $TOKEN" "https://firebaserules.googleapis.com/v1/projects/taylor-parts/releases" | python3 -c "import sys,json; rs=json.load(sys.stdin)['releases']; print([r['rulesetName'] for r in rs if r['name'].endswith('cloud.firestore')][0])") \
 && curl -s -H "Authorization: Bearer $TOKEN" "https://firebaserules.googleapis.com/v1/$REL" | python3 -c "import sys,json; sys.stdout.write(json.load(sys.stdin)['source']['files'][0]['content'])" > rollback/firestore.rules \
 && printf '{"firestore":{"rules":"firestore.rules"}}\n' > rollback/firebase.json \
 && head -1 rollback/firestore.rules \
 && sha256sum rollback/firestore.rules | tee sb-evidence/pre-deploy-production-rules.sha256 \
 && cp rollback/firestore.rules sb-evidence/pre-deploy-production.rules
```
**Expected:** first line `rules_version = '2';` and a sha256 (the PRE-Stage-B live production baseline — record it; it reflects the current admin/dispatcher-only `parts` read predicate and will differ from `cf6681c6…`). If empty/malformed, **STOP — do not deploy without a preserved baseline.** `rollback/` is now an independently deployable artifact. **PAUSE.**

## Step 4 — Confirm the baseline is the pre-Stage-B predicate (sanity)

```bash
grep -n "match /parts/{partId}" -A3 rollback/firestore.rules
```
**Expected:** the live baseline shows `allow read: if isAdminOrDispatcher();` (admin/dispatcher only) — i.e., the new operational-role branches are **not** yet live. If the baseline already contains the PARTS_MANAGER/WAREHOUSE_MANAGER branches, the change is already deployed — **STOP and report** (no deploy needed). **PAUSE.**

## Step 5 — Deploy ONLY Firestore Rules

```bash
firebase deploy --only firestore:rules --project taylor-parts 2>&1 | tee sb-evidence/deploy-output.txt
```
**Expected:** `firestore: released rules firestore.rules to cloud.firestore` … `Deploy complete!` — nothing about functions/hosting/indexes. **PAUSE.**

## Step 6 — Verify the live ruleset equals the governed blob

```bash
TOKEN=$(gcloud auth print-access-token) \
 && REL=$(curl -s -H "Authorization: Bearer $TOKEN" "https://firebaserules.googleapis.com/v1/projects/taylor-parts/releases" | python3 -c "import sys,json; rs=json.load(sys.stdin)['releases']; print([r['rulesetName'] for r in rs if r['name'].endswith('cloud.firestore')][0])") \
 && curl -s -H "Authorization: Bearer $TOKEN" "https://firebaserules.googleapis.com/v1/$REL" | python3 -c "import sys,json; sys.stdout.write(json.load(sys.stdin)['source']['files'][0]['content'])" > sb-evidence/post-deploy-production.rules \
 && sha256sum sb-evidence/post-deploy-production.rules | tee sb-evidence/post-deploy-production-rules.sha256 \
 && test "$(sha256sum sb-evidence/post-deploy-production.rules | cut -d" " -f1)" = "$EXPECTED_RULES_SHA" && echo LIVE-EQUALS-GOVERNED-BLOB
```
**Expected:** the post-deploy live hash, then `LIVE-EQUALS-GOVERNED-BLOB` (== `cf6681c6…`). If the check line is missing, **STOP → ROLLBACK.** The release lock may be released only after this line prints. **PAUSE.**

## Step 7 — Post-deploy Functions inventory comparison

```bash
TOKEN=$(gcloud auth print-access-token) \
 && curl -s -H "Authorization: Bearer $TOKEN" "https://cloudfunctions.googleapis.com/v2/projects/taylor-parts/locations/-/functions" \
      | python3 -c "import sys,json; d=json.load(sys.stdin); print('FUNCTIONS_COUNT', len(d.get('functions',[]))); [print('FN', f['name'].split('/')[-1]) for f in d.get('functions',[])]" | tee postdeploy-functions-inventory.txt \
 && diff predeploy-functions-inventory.txt postdeploy-functions-inventory.txt && echo FUNCTIONS-UNCHANGED
```
**Expected:** `FUNCTIONS-UNCHANGED`. If the inventory differs, **STOP and report** (this deploy must not touch Functions). **PAUSE.**

## Step 8 — Production persona verification matrix

Run §4 for every available/authorized persona (per the §3 readiness table; existing pre-approved principals only). Record HTTP status per (persona, operation) into `sb-evidence/production-matrix.md` — **labels and statuses only, no tokens/UIDs/emails/raw records.** Assertions:

- ALLOW reads only for admin, dispatcher, and (where exercised live) valid PARTS_MANAGER / WAREHOUSE_MANAGER / stale-accessVersion-PM.
- DENY reads for signed-out, technician, and every persona covered by approved substitute.
- Every write DENY; every adjacent-collection read/write DENY.

Any unexpected ALLOW (unauthorized reader, any successful write, any adjacent-collection access), any expected-reader DENY, or any Rules mismatch ⇒ **STOP → ROLLBACK.** **PAUSE.**

## Step 9 — Package sanitized evidence

```bash
cd sb-evidence \
 && sha256sum * > SHA256SUMS.txt \
 && ( grep -riE "token|password|secret|bearer|@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|eyJ[A-Za-z0-9_-]{10,}" . | grep -v SHA256SUMS.txt && echo "SENSITIVE-FOUND -- REDACT BEFORE EXPORT" || echo SENSITIVE-SCAN-CLEAN ) \
 && cd .. && tar czf inv-convergence-e-stage-b-deploy-evidence.tgz sb-evidence && sha256sum inv-convergence-e-stage-b-deploy-evidence.tgz
```
**Expected:** `SENSITIVE-SCAN-CLEAN`; tarball + its sha256 (record it). Download for the Inventory-session evidence import PR. Evidence includes: predeploy/postdeploy live `.rules` + their SHA-256, deploy output, pre/post Functions inventory + `FUNCTIONS-UNCHANGED`, `LIVE-EQUALS-GOVERNED-BLOB` confirmation, the production matrix, and a note recording which personas were live vs. approved-substitute. **No credential, token, UID, email, or raw record in committed evidence.** **DONE — report back with the tarball + both production Rules SHA-256 values (pre + post) + the matrix result.**

---

## ROLLBACK (only on a stop/rollback condition — restores the pre-Stage-B baseline)

```bash
cd ~/sb/rollback && firebase deploy --only firestore:rules --project taylor-parts && sha256sum firestore.rules
```
Then re-run Step 6's fetch and confirm the live ruleset hash equals the **Step 3 baseline** hash. Report immediately either way.

- **Rollback target:** restore the prior production `parts` read predicate `allow read: if isAdminOrDispatcher();`.
- **Rollback method:** redeploy the captured Step 3 predeploy live-Rules artifact (`rollback/`), or a reviewed prior governed Rules commit. **Rules only. No data change.** Restores admin/dispatcher-only reads.
- **No data rollback** is ever involved (read-only grant; no writes changed).

## Stop conditions (abort → run ROLLBACK → report)

- `governed blob:` ≠ `cf6681c6…`, or root/mirror not byte-identical (Step 1).
- The §0 hash open item is not resolved by Owner + ChatGPT before deploy.
- Predeploy live baseline empty/malformed or not captured (Step 3).
- Baseline already contains the new branches (Step 4) — no deploy needed.
- Deploy output mentions functions/hosting/indexes, or deploy fails (Step 5).
- `LIVE-EQUALS-GOVERNED-BLOB` missing (Step 6).
- Functions inventory changed (Step 7).
- Any unauthorized `parts` read ALLOW, any expected-reader DENY, any successful client write, any adjacent-collection access (Step 8).
- Any attempt would require creating/mutating a production user/employee/role/claim/accessVersion (prohibited) — STOP and request a separate governed provisioning authorization instead.
- Sensitive data present in evidence (Step 9).

## Rollback conditions

Trigger rollback immediately on: any unauthorized ALLOW, any expected-reader DENY, any adjacent-collection broadening, any live-vs-governed Rules mismatch, or incomplete/again-unverifiable evidence.

## After this handoff (separately Owner-authorized)

Evidence import + Stage B deploy-closure PR (docs/audits) → then, only after production verification is accepted, **C1 (PartsList cutover)** becomes eligible for its own separate gate. **C1 remains BLOCKED until this deploy + production verification gate closes.**

## Non-authorizations (explicit)

This document authorizes **no deployment**. No production Rules deploy, no Functions/index/Hosting/data deploy, no production data access beyond read-only verification, no creation/mutation of any production identity data, no fixture creation, no C1/C2, no static-catalog or adapter change. Decisions #43–#46 unchanged.
