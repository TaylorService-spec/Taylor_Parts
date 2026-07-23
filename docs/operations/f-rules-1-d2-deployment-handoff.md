# F-RULES-1 Gate D2 — Hardened Rules Deployment Handoff (Cloud Shell)

**Gate:** D2 — deploy the current governed `firestore.rules`, verify the technician self-write closure in production, preserve rollback. **Operator-executed**; prepared by the Customer session per the Owner's D2 authorization. Governing: Decision #39 · PR-C validation · D1 activation report (`../audits/f-rules-1/d1-activation/`).

**Combined-content acknowledgement (Owner-confirmed):** this deploy ships the ENTIRE current Rules file — the F-RULES-1 technician hardening (start-only direct transition, status-only, completion/self-availability denied, audit client-deny) **plus** Inventory's client-closed blocks (`parts`, `manufacturers`, `part_aliases`, `part_supplier_items`). Pre-verified at `75289cc`: byte-identical mirror, full regression **498/0 (15 suites)** incl. strict 43/43, partMaster 16/16, partAlias 8/8, partSupplierItem 8/8. Governed Rules **git-blob** sha256 (derive, never hand-copy: `git show HEAD:firestore.rules | sha256sum`): `b37c666fff0018375df11afa5078f8499e10fea9df7a862d5c373e112f5903fd`. (Correction note: an earlier handoff revision recorded a Windows-worktree CRLF hash; every check below now derives from the git blob, which is byte-identical to a Linux/Cloud Shell working tree and to what `firebase deploy` uploads.)

**Hard boundaries:** deploy ONLY `firestore:rules` · no Functions/hosting/indexes/extensions · no Rules edits during the run · fixtures strictly `d2smoke`-prefixed · D3 not begun.

**Stop conditions (abort → run the ROLLBACK block → report):** deploy fails · direct completion allowed · direct start denied · self-availability allowed · callable completion fails · cascade/audit incomplete · Inventory deny-all not preserved · any non-`d2smoke` record touched · sensitive data in evidence.

Run each step as one block; **pause and compare with the expected output**.

## Step 1 — Clone the handoff branch and install

```bash
git clone --branch ops/f-rules-1-d2-handoff https://github.com/TaylorService-spec/Taylor_Parts.git d2 && cd d2 && EXPECTED_RULES_SHA=$(git show HEAD:firestore.rules | sha256sum | cut -d" " -f1) && echo "governed blob: $EXPECTED_RULES_SHA" && test "$(sha256sum firestore.rules | cut -d" " -f1)" = "$EXPECTED_RULES_SHA" && echo TREE-MATCHES-BLOB && test "$(git show HEAD:field-ops-app-vite/firestore.rules | sha256sum | cut -d" " -f1)" = "$EXPECTED_RULES_SHA" && echo MIRROR-MATCHES-BLOB && cd functions && npm ci >/dev/null && cd ..
```
**Expected:** `governed blob: b37c666fff0018375df11afa5078f8499e10fea9df7a862d5c373e112f5903fd` then `TREE-MATCHES-BLOB` and `MIRROR-MATCHES-BLOB` (all derived from the repository blob at your checkout — if any line is missing, STOP). Keep this shell session: `$EXPECTED_RULES_SHA` is reused in Step 4. **PAUSE.**

## Step 2 — Capture the production Rules baseline (rollback artifact)

```bash
mkdir -p rollback d2-evidence && TOKEN=$(gcloud auth print-access-token) && REL=$(curl -s -H "Authorization: Bearer $TOKEN" "https://firebaserules.googleapis.com/v1/projects/taylor-parts/releases" | python3 -c "import sys,json; rs=json.load(sys.stdin)['releases']; print([r['rulesetName'] for r in rs if r['name'].endswith('cloud.firestore')][0])") && curl -s -H "Authorization: Bearer $TOKEN" "https://firebaserules.googleapis.com/v1/$REL" | python3 -c "import sys,json; sys.stdout.write(json.load(sys.stdin)['source']['files'][0]['content'])" > rollback/firestore.rules && printf '{"firestore":{"rules":"firestore.rules"}}\n' > rollback/firebase.json && head -1 rollback/firestore.rules && sha256sum rollback/firestore.rules | tee d2-evidence/pre-deploy-production-rules.sha256 && cp rollback/firestore.rules d2-evidence/pre-deploy-production.rules
```
**Expected:** first line `rules_version = '2';` and a sha256 (the PRE-D2 production baseline — record it; it will differ from the repo hash). If the file is empty or malformed, **STOP — do not deploy without a preserved baseline**. The `rollback/` directory is now an independently deployable artifact. **PAUSE.**

## Step 3 — Deploy ONLY Firestore Rules

```bash
firebase deploy --only firestore:rules --project taylor-parts 2>&1 | tee d2-evidence/deploy-output.txt
```
**Expected:** `firestore: released rules firestore.rules to cloud.firestore` … `Deploy complete!` — nothing about functions/hosting/indexes. **PAUSE.**

## Step 4 — Verify the deployed ruleset equals the repository file

```bash
TOKEN=$(gcloud auth print-access-token) && REL=$(curl -s -H "Authorization: Bearer $TOKEN" "https://firebaserules.googleapis.com/v1/projects/taylor-parts/releases" | python3 -c "import sys,json; rs=json.load(sys.stdin)['releases']; print([r['rulesetName'] for r in rs if r['name'].endswith('cloud.firestore')][0])") && curl -s -H "Authorization: Bearer $TOKEN" "https://firebaserules.googleapis.com/v1/$REL" | python3 -c "import sys,json; sys.stdout.write(json.load(sys.stdin)['source']['files'][0]['content'])" > d2-evidence/post-deploy-production.rules && test "$(sha256sum d2-evidence/post-deploy-production.rules | cut -d" " -f1)" = "$(git show HEAD:firestore.rules | sha256sum | cut -d" " -f1)" && echo LIVE-EQUALS-GOVERNED-BLOB && sha256sum d2-evidence/post-deploy-production.rules
```
**Expected:** `LIVE-EQUALS-GOVERNED-BLOB` followed by the hash (must equal Step 1's `governed blob` value, `b37c666…903fd`) — the live ruleset is byte-exactly the governed repository blob. If the check line is missing, STOP → ROLLBACK. **PAUSE.**

## Step 5 — Post-deploy production verification (seed → run)

```bash
export D2_SMOKE_PASSWORD="$(openssl rand -base64 18)" && cd functions && node scripts/d2SmokeRulesVerification.js seed && node scripts/d2SmokeRulesVerification.js run
```
**Expected (all 22):** wrong-tech direct start denied · direct start (status-only) **allowed** · job in_progress · **direct completion denied** · job unchanged · **self-availability denied** · callable 200 + contract · job→complete · technician→available · applied audit at key · replay `idempotentReplay true` · no duplicate cascade · exactly one applied audit · client **read denied** ×4 (parts/manufacturers/part_aliases/part_supplier_items) · client **create denied** ×4 — ending **`D2 SMOKE PASS: 22 passed, 0 failed`**. Any FAIL → STOP → cleanup (Step 7) → ROLLBACK → report. **PAUSE.**

## Step 6 — Package evidence

```bash
cp d2-smoke-evidence/d2-smoke-results.json ../d2-evidence/ && cd ../d2-evidence && sha256sum * > checksums.sha256 && (grep -riE "token|password|secret|bearer" . | grep -v checksums.sha256 || echo SENSITIVE-SCAN-CLEAN) && cd .. && tar czf f-rules-1-d2-evidence.tgz d2-evidence && sha256sum f-rules-1-d2-evidence.tgz
```
**Expected:** `SENSITIVE-SCAN-CLEAN`; tarball + its sha256 printed (record it). Download `f-rules-1-d2-evidence.tgz` for the Customer session import. **PAUSE.**

## Step 7 — Cleanup fixtures

```bash
cd functions && node scripts/d2SmokeRulesVerification.js cleanup && unset D2_SMOKE_PASSWORD
```
**Expected:** `d2smoke fixture documents and auth users removed (audit events retained, append-only)`. **DONE — report back with the tarball + both production Rules sha256 values (pre + post).**

## ROLLBACK (only on a stop condition — restores the pre-D2 baseline)

```bash
cd ~/d2/rollback && firebase deploy --only firestore:rules --project taylor-parts && sha256sum firestore.rules
```
Then re-run Step 4's fetch to confirm the live ruleset hash equals the baseline hash from Step 2. Report immediately either way. The callable stays live (D1 is unaffected by a Rules rollback); the frontend needs no change (the trusted path works under either ruleset).

## After this handoff (Customer session, separately)

Evidence import + D2 closure PR (same pattern as D1) → then **Gate D3** (production smoke / final verification), separately Owner-authorized.
