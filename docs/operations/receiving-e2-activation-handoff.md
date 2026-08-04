# EI Phase-2 Receiving — Gate E2 Activation Handoff (Operator Runbook)

**Status:** Repository-only **preparation**. This runbook does **not** authorize deployment, migration, or
any production write. Each production action below runs **only** under a **separate, explicit Owner
authorization**, from a clean checkout of the exact governed commit. Prepared by the INVENTORY session per
the Owner's *E2 Activation Gate Preparation* authorization, updated after the prerequisite **Gate E2-V**
verifier + rollback tooling merged (PR #555).

**Governed commit (pin):** `$E2_COMMIT` — the PR #554 merge commit (`origin/main` after this PR merges),
bound in Phase 0.
**Project (pin):** `taylor-parts`. **Region (pin):** `us-central1`.

This gate deploys and verifies the **backend** for Receiving: the `receiving_orders` deny-client Rules, the
governed Warehouse migration, and exactly the two receiving callables. It performs **no receipt**, **no
inventory mutation**, and **no Customer readiness flip / UI cutover / Hosting** — those are Phase F, under
their own separate Owner authorization. `inventory.stock.receive` is already granted (repo-only) to
`{admin, dispatcher, owner}` (PR #553); this gate changes no grant and does **not** grant
`PARTS_ASSOCIATE`.

All production verification uses the committed, offline-unit-tested **Gate E2-V** tooling (fail-closed;
sanitized evidence) — no ad-hoc checks.

---

## Pinned facts (derive hashes; never hand-copy)

| Item | Value |
|---|---|
| Governed commit | **PR #554 merge commit** (`origin/main` after this PR merges — the commit at which this runbook and all E2/E2-V tooling coexist); Phase 0 checks it out and binds it as `$E2_COMMIT` |
| Project / region | `taylor-parts` / `us-central1` |
| Rules artifact | `firestore.rules` (root) + byte-identical mirror `field-ops-app-vite/firestore.rules` |
| Rules **content** sha256 | `ec1f0a9b78d937d1eff1aef6c2588b20a0dc77501b392e560b491e7c13b1ccd1` |
| `receiving_orders` Rules block | `allow read, create, update, delete: if false;` (fully backend-private) |
| Callables (exact deploy allowlist) | `receiveInventoryStock`, `listReceivingLocationOptions` |
| Migration/verifier CLI | `functions/scripts/warehouseGovernanceMigrationCli.js` (I-LA3) |
| Backup/restore CLI (E2-V) | `functions/scripts/warehouseBackupRestoreCli.js` |
| Backend verifier CLI + core (E2-V) | `functions/scripts/receivingE2VerifierCli.js` + `verifyReceivingE2Deployment.js` |
| Rules extract+hash CLI (E2-V) | `functions/scripts/firestoreRulesSourceHashCli.js` |
| Functions-inventory sanitizer CLI (E2-V) | `functions/scripts/functionsInventorySanitizeCli.js` |

**Reviewed-tool content hashes** (git-blob sha256 at the governed commit; the preflight verifies them so no
unreviewed tool runs against production — the receivingE2VerifierCli + verifier core carry the `--rules-only`
Phase-3 gate, and the sanitizer is the P1-3 inventory transform, both reviewed under PR #554):

```
b7a3081e97162b3cfed6718161c69f73bf334cdc88857d6c778d28b05ec70dd5  functions/scripts/receivingE2VerifierCli.js
55141c85ef7ed328711c1174fae036dbc3c3c494cdccd1d8ea8fcfc271ca51fc  functions/scripts/verifyReceivingE2Deployment.js
c43f861da2ccd71047fdc392361c58b6eb5a3801c59d60c0453190fbc209ed35  functions/scripts/warehouseBackupRestoreCli.js
3115988b0c6babb7bf2063f8a6f7f8410d51c2ddd6007428da5447f0ea96dfe8  functions/scripts/firestoreRulesSourceHashCli.js
4efe8607e9aff3ffc2b43cbced2cfaf1ff23672812b107766437fdd9d558a007  functions/scripts/functionsInventorySanitizeCli.js
00bb77a309c9f409016e93bca6959c480e2bd0177370f75c03cc78c3df29a119  functions/src/warehouseGovernance/warehouseBackupCodec.ts
```

Derive the Rules content hash exactly as the deploy uploads it (a Windows worktree's CRLF would differ —
always derive from the git blob):

```bash
git show HEAD:firestore.rules | sha256sum        # expect ec1f0a9b…ccd1
git show HEAD:field-ops-app-vite/firestore.rules | sha256sum   # must equal the above (mirror parity)
```

---

## Hard boundaries (this gate)

- Deploy **only** `firestore:rules`, then **only** `functions:receiveInventoryStock,functions:listReceivingLocationOptions`.
- **No** broad `firebase deploy`, **no** `firebase deploy --only functions`, **no** hosting/indexes/storage/extensions.
- **No** Rules or source edits during the run. **No** `PARTS_ASSOCIATE` grant. **No** Truck changes.
- Migration runs **dry-run first** (zero writes); **execute** only after a **separate Owner approval of the
  exact manifest + its sha256**.
- Rules deploy proceeds only after a **separate Owner approval of the exact observed baseline→governed
  delta** (Phase 2.5).
- **No receipt execution / inventory mutation.** Backend verification is discovery + delta + denial only.
- The rollback snapshot is an **access-controlled artifact kept OUTSIDE the sanitized evidence tarball**.
- **STOP** before any Customer readiness flip, UI cutover, legacy-writer removal, or Hosting.

## NOT authorized by this runbook

Rules deployment · migration execution or any production write · Functions deployment · receipt execution
or inventory mutation · Customer readiness flip / UI cutover / legacy-writer removal / Hosting ·
PARTS_ASSOCIATE grant · Truck changes. Each requires a new, explicit Owner authorization after this
package receives Codex technical clearance.

## Owner authorization checkpoints (three hard stops)

1. **E2 execution start** — authorize running Phases 1–9 at the governed commit.
2. **Phase 2.5 — combined-content Rules delta** — approve the exact observed baseline→governed delta before
   the Rules deploy.
3. **Phase 5 — resolution-manifest** — approve the exact migration manifest + sha256 before `--execute`.

## Global stop conditions (abort → matching ROLLBACK → report)

Main drift (HEAD ≠ governed commit) · project mismatch · reviewed-tool hash mismatch · Rules content hash
mismatch (live ≠ `ec1f0a9b…ccd1`) · unapproved Rules delta · verifier CLI non-zero exit (any denial not
403, any callable accepting unauthenticated, any unexpected/changed/removed deployed target, receiving_orders
changed) · migration dry-run/execute/verifier failure · warehouse live-set or pre-state drift · backup
un-restorable / restore drift or content-gate failure · sensitive data in evidence · any need for broader
production access.

Run each phase as one block; **pause and compare with the expected output** before continuing.

---

## Phase 0 — Preflight (clean exact-head checkout, tools, build, reviewed-tool integrity)

```bash
node -v                                   # v20.x
gcloud config get-value project           # taylor-parts
firebase projects:list                    # shows access to taylor-parts
# Check out the PR #554 merge commit (origin/main after this PR merges) and bind it.
git fetch origin && git checkout origin/main && git status --porcelain   # prints nothing
E2_COMMIT=$(git rev-parse HEAD) && echo "E2_COMMIT: $E2_COMMIT"   # the governed commit for this run
cd functions && npm ci && npm run build && cd ..
# Reviewed-tool integrity: the E2/E2-V tools must be byte-exactly the versions reviewed in PR #554.
for f in functions/scripts/receivingE2VerifierCli.js functions/scripts/verifyReceivingE2Deployment.js \
         functions/scripts/warehouseBackupRestoreCli.js functions/scripts/firestoreRulesSourceHashCli.js \
         functions/scripts/functionsInventorySanitizeCli.js functions/src/warehouseGovernance/warehouseBackupCodec.ts; do
  echo "$(git show HEAD:$f | sha256sum | cut -d' ' -f1)  $f"
done
```

**Expected:** `origin/main` reflects the merged PR #554; working tree clean; build succeeds; `$E2_COMMIT`
recorded. Compare the printed tool hashes to the **Reviewed-tool content hashes** table above. Any mismatch
→ **STOP** (an unreviewed tool must never run against production). **PAUSE.**

## Phase 1 — Reconfirm preconditions + capture the hash-bound pre-deploy Functions inventory

```bash
EXPECTED_RULES_SHA=$(git show HEAD:firestore.rules | sha256sum | cut -d" " -f1) && echo "governed rules: $EXPECTED_RULES_SHA" \
 && test "$EXPECTED_RULES_SHA" = ec1f0a9b78d937d1eff1aef6c2588b20a0dc77501b392e560b491e7c13b1ccd1 && echo RULES-PIN-OK \
 && test "$(git show HEAD:field-ops-app-vite/firestore.rules | sha256sum | cut -d" " -f1)" = "$EXPECTED_RULES_SHA" && echo MIRROR-MATCHES-BLOB
grep -nE "receiveInventoryStockCallable as receiveInventoryStock|listReceivingLocationOptionsCallable as listReceivingLocationOptions" functions/src/index.ts
mkdir -p e2-evidence /secure/local/rollback
# COMPLETE RAW pre-deploy inventory -> access-controlled operator dir OUTSIDE the evidence tarball (may
# carry env-var/service-account/URI/label metadata; never packaged, never committed).
gcloud functions list --project taylor-parts --format json > /secure/local/rollback/functions-before.raw.json
# SANITIZED normalized inventory (exactly name/region/state/entryPoint/runtime/updateTime) -> evidence +
# the verifier's --pre-deploy-inventory input (the reviewed transform drops all other operational fields).
node functions/scripts/functionsInventorySanitizeCli.js \
  --in /secure/local/rollback/functions-before.raw.json \
  --out e2-evidence/functions-before.sanitized.json
grep -E "receiveInventoryStock|listReceivingLocationOptions" e2-evidence/functions-before.sanitized.json || echo RECEIVING-CALLABLES-ABSENT-OK
PRE_INV_SHA=$(sha256sum e2-evidence/functions-before.sanitized.json | cut -d" " -f1) && echo "pre-deploy inventory sha256: $PRE_INV_SHA"
```

**Expected:** `RULES-PIN-OK`, `MIRROR-MATCHES-BLOB`, the two export lines,
`RECEIVING-CALLABLES-ABSENT-OK`, and a recorded `$PRE_INV_SHA` over the **sanitized** inventory (reused in
Phase 8). The raw inventory stays in `/secure/local/rollback/` (never packaged). Keep this shell. **PAUSE.**

## Phase 2 — Deploy the Phase-D `receiving_orders` deny-client Rules

> **Combined-content acknowledgement:** `firebase deploy --only firestore:rules` ships the **entire**
> current governed `firestore.rules`, not just the `receiving_orders` block — also the merged Truck
> Registry read/write Rules, the Equipment-D4 client-closed registry, and the INV-CONVERGENCE-E Stage-B
> operational-role parts reads. Capture the production baseline, hash it via the reviewed strict extractor,
> and **HALT at Phase 2.5 for explicit Owner approval of the exact delta** before deploying.

```bash
# 2a. Capture the pre-deploy production Rules baseline (rollback artifact) + its strict content hash.
#     Release selector: EXACTLY one release named the canonical resource -- reject zero/multiple/suffix.
mkdir -p rollback && TOKEN=$(gcloud auth print-access-token) \
 && REL=$(curl -s -H "Authorization: Bearer $TOKEN" "https://firebaserules.googleapis.com/v1/projects/taylor-parts/releases" | python3 -c "import sys,json; rs=json.load(sys.stdin)['releases']; m=[r for r in rs if r['name']=='projects/taylor-parts/releases/cloud.firestore']; assert len(m)==1, f'expected exactly one cloud.firestore release, got {len(m)}'; print(m[0]['rulesetName'])") \
 && curl -s -H "Authorization: Bearer $TOKEN" "https://firebaserules.googleapis.com/v1/$REL" > rollback/baseline-ruleset.json \
 && node functions/scripts/firestoreRulesSourceHashCli.js --in rollback/baseline-ruleset.json | tee e2-evidence/pre-deploy-rules-hash.json
BASELINE_RULES_SHA=$(python3 -c 'import sys,json;print(json.load(open("e2-evidence/pre-deploy-rules-hash.json"))["contentSha256"])') && echo "baseline rules sha256: $BASELINE_RULES_SHA"
# Build a self-contained, source-bound rollback config so R1 deploys EXACTLY the captured baseline
# (never the governed working tree via parent firebase.json discovery).
python3 -c "import json;open('rollback/firestore.rules','w').write(json.load(open('rollback/baseline-ruleset.json'))['source']['files'][0]['content'])"
printf '{"firestore":{"rules":"firestore.rules"}}\n' > rollback/firebase.json
# 2b. Baseline diff — the exact delta the deploy will introduce (Owner-reviewed at Phase 2.5).
diff rollback/firestore.rules <(git show HEAD:firestore.rules) > e2-evidence/rules-baseline.diff || echo "REVIEW-DELTA in e2-evidence/rules-baseline.diff"
git show HEAD:firestore.rules | grep -nE "match /receiving_orders|allow read, create, update, delete: if false"
```

**Expected:** `firestoreRulesSourceHashCli` prints `{ ok: true, contentSha256: … }` for the baseline (the
PRE-E2 production content — differs from the governed hash); `e2-evidence/rules-baseline.diff` shows the
exact delta and includes the `receiving_orders` deny-all block. If the strict extractor errors (structure
not exactly one `firestore.rules` file), **STOP**. **PAUSE — Owner checkpoint next.**

## Phase 2.5 — OWNER CHECKPOINT: combined-content Rules delta approval (separate authorization)

> **Hard stop for a separate Owner authorization.** Return `e2-evidence/pre-deploy-rules-hash.json`
> (baseline content hash), the governed hash `ec1f0a9b…ccd1`, and `e2-evidence/rules-baseline.diff` (the
> sanitized exact delta). The Owner must **explicitly approve that exact combined-content delta** before
> any Rules deploy. E2 execution-start authorization is **not** advance approval of an unknown Rules delta.

**HALT** until the Owner returns an explicit "deploy these exact Rules" approval for this delta.

```bash
# 2c. Deploy ONLY Firestore Rules (after Owner delta approval).
firebase deploy --only firestore:rules --project taylor-parts 2>&1 | tee e2-evidence/rules-deploy-output.txt
# 2d. Verify the deployed ruleset content is byte-exactly the governed blob (strict extractor + exact release).
TOKEN=$(gcloud auth print-access-token) \
 && REL=$(curl -s -H "Authorization: Bearer $TOKEN" "https://firebaserules.googleapis.com/v1/projects/taylor-parts/releases" | python3 -c "import sys,json; rs=json.load(sys.stdin)['releases']; m=[r for r in rs if r['name']=='projects/taylor-parts/releases/cloud.firestore']; assert len(m)==1, f'expected exactly one cloud.firestore release, got {len(m)}'; print(m[0]['rulesetName'])") \
 && curl -s -H "Authorization: Bearer $TOKEN" "https://firebaserules.googleapis.com/v1/$REL" > e2-evidence/post-deploy-ruleset.json \
 && test "$(node functions/scripts/firestoreRulesSourceHashCli.js --in e2-evidence/post-deploy-ruleset.json | python3 -c 'import sys,json;print(json.load(sys.stdin)["contentSha256"])')" = "$EXPECTED_RULES_SHA" && echo LIVE-EQUALS-GOVERNED-BLOB
```

**Expected:** deploy log shows `released rules firestore.rules` and nothing about functions/hosting/indexes;
`LIVE-EQUALS-GOVERNED-BLOB` (live content == `ec1f0a9b…ccd1`, via the reviewed strict extractor). If
missing → **STOP → ROLLBACK (R1)**. **PAUSE.**

## Phase 3 — Pre-migration client-denial gate (authenticated + unauthenticated, recorded, fail-closed)

This is the **final behavioral safety gate before the irreversible migration.** Run the committed E2-V
verifier in `--rules-only` mode: it proves `receiving_orders` denies **all four** client accesses —
**unauthenticated read/write AND authenticated read/write** (using the governed E2 test persona, same
bounded credential handling as the full verifier) — each exactly **403**, plus `receiving_orders` unchanged
(no successful write). It records sanitized results and **exits non-zero on any non-403** (no callables or
Functions inventory required, so it runs here, before migration).

```bash
cp config/receiving-e2-verification.example.json config/receiving-e2-verification.local.json  # set governedCommit -> $E2_COMMIT
export E2_WEB_API_KEY=...  E2_TEST_EMAIL=...  E2_TEST_PASSWORD=...   # operator env only; never committed/logged
node functions/scripts/receivingE2VerifierCli.js --rules-only \
  --config config/receiving-e2-verification.local.json \
  --evidence-dir e2-evidence/pre-migration-rules-denial \
  --verify-date <YYYY-MM-DD> --confirm-project taylor-parts
cat e2-evidence/pre-migration-rules-denial/verification-report.json
```

**Expected:** `{ ok: true, pass: true, mode: "rules-only" }`; the report shows all four rules-denial
observations `403` and `receiving_orders` unchanged. A non-zero exit publishes
`e2-evidence/pre-migration-rules-denial.FAILED/` — **STOP → ROLLBACK (R1); do NOT migrate.** **PAUSE.**

## Phase 4 — Warehouse governance migration: **DRY-RUN** (zero writes)

```bash
node functions/scripts/warehouseGovernanceMigrationCli.js \
  --project taylor-parts --commit $E2_COMMIT \
  --evidence-dir e2-evidence/warehouse-migration-dry-run
cat e2-evidence/warehouse-migration-dry-run/dry-run.json
```

**Expected:** `{ ok: true, mode: "dry-run" }`; `dry-run.json` reports `counts {total, governed, derive,
ambiguous}` and any ambiguous ids/fingerprints. Classification (I-LA C2): **GOVERNED** (no-op), **DERIVE**
(unambiguous), **AMBIGUOUS** (contradiction/malformed → needs a manifest entry). **Return `dry-run.json`.** **PAUSE.**

## Phase 5 — OWNER CHECKPOINT: resolution-manifest approval (separate authorization)

> The Owner reviews `dry-run.json` and, for the ambiguous set **only**, authors the resolution manifest
> (schema: `{ projectId, governedCommit, entries: [{ warehouseId, intendedStatus, preStateFingerprint }] }`;
> if `ambiguous == 0`, `entries: []`) and approves its exact sha256. The migration CLI validates it
> fail-closed (`missing/extra/duplicate/invalid_status/wrong_project/wrong_commit/stale_prestate`).

```bash
sha256sum e2-evidence/warehouse-resolution-manifest.json   # the Owner-approved value → --manifest-sha256
```

**HALT** until the Owner returns the manifest content, its sha256, and an explicit "execute the migration"
authorization at this governed commit.

## Phase 6 — Backup (rollback artifact) → migration **EXECUTE** → **always** capture post-attempt state

The migration commits atomically **before** its verifier runs, so a production write may have committed even
when the migration exits non-zero. This phase therefore **always** captures the actual post-attempt
live-state hash (read-only) so a rollback can be bound to real observed state — the expected post-migration
hash is captured **after** the attempt, never pre-approved before it exists.

```bash
# 6a. Pre-migration LOSSLESS backup -> access-controlled rollback dir OUTSIDE the evidence tarball.
node functions/scripts/warehouseBackupRestoreCli.js \
  --project taylor-parts --commit $E2_COMMIT \
  --out-dir /secure/local/rollback/warehouses-pre-migration | tee /secure/local/rollback/backup-result.json
# Record the printed snapshotSha256 (rollback binding). Fails closed if the set is un-restorable in one txn.

# 6b. Execute the migration (Owner-approved manifest hash) — PRESERVE its exit status (do not abort the shell).
node functions/scripts/warehouseGovernanceMigrationCli.js \
  --project taylor-parts --commit $E2_COMMIT \
  --execute --acknowledge-production-write \
  --manifest e2-evidence/warehouse-resolution-manifest.json \
  --manifest-sha256 <OWNER_APPROVED_MANIFEST_SHA256> \
  --evidence-dir e2-evidence/warehouse-migration-execute ; MIG_EXIT=$? ; echo "migration exit: $MIG_EXIT"

# 6c. ALWAYS capture the post-attempt live-state (read-only) — a write may have committed even if 6b failed.
node functions/scripts/warehouseBackupRestoreCli.js \
  --project taylor-parts --commit $E2_COMMIT \
  --out-dir /secure/local/rollback/warehouses-post-attempt | tee /secure/local/rollback/post-attempt-result.json
# The printed liveContentSha256 is the observed post-attempt state hash (R2's --expected-live-sha256).
```

**If `MIG_EXIT == 0`** (migration + verifier passed): `e2-evidence/warehouse-migration-execute/verification.json`
shows `pass: true`, `counts.governed == total`, and `legacy/ambiguous/malformed/activePresent/identityMismatch
== 0`. Proceed to Phase 7.

**If `MIG_EXIT != 0`** (a write may have committed): **STOP.** Return the observed post-attempt
`liveContentSha256` (from 6c) and the pre-migration `snapshotSha256` (from 6a) to the Owner, and request an
**explicit rollback authorization** for that exact observed state. Run **ROLLBACK (R2)** only after that
authorization — R2 binds to the observed post-attempt hash, not a pre-approved value. Keep the rollback dir
access-controlled and **out of** the evidence tarball. **PAUSE.**

## Phase 7 — Deploy **only** the two receiving callables (exact allowlist)

```bash
firebase deploy --project taylor-parts \
  --only functions:receiveInventoryStock,functions:listReceivingLocationOptions 2>&1 | tee e2-evidence/functions-deploy-output.txt
```

> Prohibited: `firebase deploy`, `firebase deploy --only functions`, or any wildcard/broad target. Only the
> explicit two-name allowlist is authorized; deploys no Hosting/Rules/indexes; deletes no unlisted function.

**Expected:** both functions deploy @ `us-central1`; nothing else touched. **PAUSE.**

## Phase 8 — Backend verification **without executing a real receipt** (E2-V verifier)

Run the reviewed, fail-closed verifier. It proves — with **zero writes and no receipt** — the exact
deployment delta (only the two callables added @ region, every pre-existing function unchanged), the
recorded `receiving_orders` client-denial (unauth + authenticated → 403), callable unauthenticated-denial
(UNAUTHENTICATED), and `receiving_orders` unchanged vs a pre-probe baseline. It publishes sanitized evidence
only on a fully passing run; on failure it publishes a sanitized `…​.FAILED` report and exits non-zero.

```bash
# (config.local.json + env vars already set in Phase 3.)
node functions/scripts/receivingE2VerifierCli.js \
  --config config/receiving-e2-verification.local.json \
  --evidence-dir e2-evidence/backend-verification \
  --verify-date <YYYY-MM-DD> --confirm-project taylor-parts \
  --pre-deploy-inventory e2-evidence/functions-before.sanitized.json \
  --pre-deploy-inventory-sha256 "$PRE_INV_SHA"
cat e2-evidence/backend-verification/verification-report.json
```

**Expected:** `{ ok: true, pass: true }`; `verification-report.json` shows every assertion passed
(discovery ×2, deployment-delta, rules-denial ×4 all 403, callable-denial ×2 UNAUTHENTICATED,
receiving_orders unchanged). A non-zero exit publishes `e2-evidence/backend-verification.FAILED/` — **STOP
→ ROLLBACK (R3)**. The test-persona credentials come only from the env and never reach evidence. **PAUSE.**

## Phase 9 — Package evidence and STOP (before Customer readiness activation)

```bash
cd e2-evidence \
 && (grep -riE "token|password|secret|bearer|apikey|api_key|idToken|refreshToken" . || echo SENSITIVE-SCAN-CLEAN) \
 && test -z "$(grep -riE 'token|password|secret|bearer|apikey|api_key|idToken|refreshToken' . )" \
 && sha256sum $(find . -type f ! -name checksums.sha256 | sort) > checksums.sha256 \
 && cd .. && tar czf receiving-e2-evidence.tgz e2-evidence && sha256sum receiving-e2-evidence.tgz
```

**Expected:** `SENSITIVE-SCAN-CLEAN` (a match makes the `test -z` fail the pipeline — **hard stop**, do not
package); tarball + sha256 printed. The **rollback snapshots stay in `/secure/local/rollback/`, NOT in the
tarball.** **DONE — return the tarball, both Rules content hashes (pre + post), the migration
`verification.json`, and the backend `verification-report.json`.** Do **not** proceed to Customer readiness
activation — that is **Phase F**, a separate gate. (Customer LF1b's readiness-false transport adapter
already landed via PR #552; readiness stays `false` throughout E2.)

---

## ROLLBACK boundaries

- **R1 — Rules (Phase 2/2.5/3):** redeploy the **captured baseline**, bound to the rollback config's own
  source file via `--config` (never the governed working tree — `--config` roots Rules-source resolution at
  the rollback dir, not a parent `firebase.json`). Then re-fetch and prove the live content hash equals the
  baseline hash recorded in Phase 2a; fail closed otherwise. The callables are unaffected (not yet deployed).
  ```bash
  firebase deploy --only firestore:rules --project taylor-parts --config rollback/firebase.json
  TOKEN=$(gcloud auth print-access-token) \
   && REL=$(curl -s -H "Authorization: Bearer $TOKEN" "https://firebaserules.googleapis.com/v1/projects/taylor-parts/releases" | python3 -c "import sys,json; rs=json.load(sys.stdin)['releases']; m=[r for r in rs if r['name']=='projects/taylor-parts/releases/cloud.firestore']; assert len(m)==1; print(m[0]['rulesetName'])") \
   && curl -s -H "Authorization: Bearer $TOKEN" "https://firebaserules.googleapis.com/v1/$REL" > rollback/post-rollback-ruleset.json \
   && test "$(node functions/scripts/firestoreRulesSourceHashCli.js --in rollback/post-rollback-ruleset.json | python3 -c 'import sys,json;print(json.load(sys.stdin)["contentSha256"])')" = "$BASELINE_RULES_SHA" && echo ROLLBACK-EQUALS-BASELINE
  ```
  If `ROLLBACK-EQUALS-BASELINE` is not printed → the live Rules do not match the captured baseline: **HALT
  and escalate** (do not proceed).

- **R2 — Migration (Phase 6, only after explicit Owner rollback authorization):** restore from the Phase-6a
  pre-migration snapshot via the reviewed backup/restore CLI — bound to the snapshot hash AND the **observed
  post-attempt** content hash captured in Phase 6c (the state the Owner authorized rolling back). It fails
  closed on identity-set drift OR any same-ID content change since that observed state (so a concurrent
  change after capture blocks the restore):
  ```bash
  node functions/scripts/warehouseBackupRestoreCli.js --restore \
    --project taylor-parts --commit $E2_COMMIT \
    --snapshot /secure/local/rollback/warehouses-pre-migration/snapshot.json \
    --snapshot-sha256 <PHASE_6a_snapshotSha256> \
    --expected-live-sha256 <PHASE_6c_observed_liveContentSha256> \
    --acknowledge-production-write --owner-rollback-authorization <OWNER_ROLLBACK_TOKEN>
  ```
  Escalate to the Owner with the rollback dir path before any retry.

- **R3 — Callables (Phase 7/8):** first-time deploy → recovery is **delete exactly these two**, returning
  to the exported-but-undeployed state (no client path; readiness `false`). Verify against
  `e2-evidence/functions-before.json`.
  ```bash
  for fn in receiveInventoryStock listReceivingLocationOptions; do
    firebase functions:delete "$fn" --project taylor-parts --region us-central1 --force
  done
  ```

## Evidence schema (sanitized — no tokens/keys/passwords/PII; rollback snapshots excluded)

`receiving-e2-evidence.tgz` → `e2-evidence/`:
- `functions-before.sanitized.json` (+ `$PRE_INV_SHA`) — the **sanitized** hash-bound pre-deploy inventory (allowlisted fields only)
- `pre-deploy-rules-hash.json`, `rules-baseline.diff` (Phase 2.5 inputs)
- `pre-migration-rules-denial/verification-report.json` (Phase 3: four 403s + unchanged) — or `…​.FAILED/`
- `rules-deploy-output.txt`, `post-deploy-ruleset.json` (live content == `ec1f0a9b…ccd1`)
- `warehouse-migration-dry-run/dry-run.json`
- `warehouse-migration-execute/verification.json` (`pass: true`, `governed == total`)
- `functions-deploy-output.txt`
- `backend-verification/verification-report.json` (all E2-V assertions pass) — or `backend-verification.FAILED/` on failure
- `checksums.sha256`

**Kept OUTSIDE the tarball** (access-controlled `/secure/local/rollback/`): the **raw** Functions inventory
(`functions-before.raw.json`) and the pre-/post-attempt warehouse `snapshot.json` + `snapshot.sha256` +
`content.sha256` rollback artifacts — they hold unbounded operational metadata / complete warehouse document
content and are never packaged, committed, or returned.

## After this handoff

Codex technical review of this package → (separately Owner-authorized) E2 execution → evidence import + E2
closure PR → then **Phase F** (Customer readiness flip / frontend cutover / legacy-writer removal /
Hosting), under its own Owner authorization.
