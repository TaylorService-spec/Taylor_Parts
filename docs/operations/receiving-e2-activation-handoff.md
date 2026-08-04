# EI Phase-2 Receiving — Gate E2 Activation Handoff (Operator Runbook)

**Status:** Repository-only **preparation**. This runbook does **not** authorize deployment, migration, or
any production write. Each production action below runs **only** under a **separate, explicit Owner
authorization**, from a clean checkout of the exact governed commit. Prepared by the INVENTORY session per
the Owner's *E2 Activation Gate Preparation* authorization, updated after the prerequisite **Gate E2-V**
verifier + rollback tooling merged (PR #555).

**Governed commit (pin):** `41f7280f88f9c1676e7794ba98d2a12d7b989d82` (origin/main after E2-V).
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
| Governed commit | `41f7280f88f9c1676e7794ba98d2a12d7b989d82` |
| Project / region | `taylor-parts` / `us-central1` |
| Rules artifact | `firestore.rules` (root) + byte-identical mirror `field-ops-app-vite/firestore.rules` |
| Rules **content** sha256 | `ec1f0a9b78d937d1eff1aef6c2588b20a0dc77501b392e560b491e7c13b1ccd1` |
| `receiving_orders` Rules block | `allow read, create, update, delete: if false;` (fully backend-private) |
| Callables (exact deploy allowlist) | `receiveInventoryStock`, `listReceivingLocationOptions` |
| Migration/verifier CLI | `functions/scripts/warehouseGovernanceMigrationCli.js` (I-LA3) |
| Backup/restore CLI (E2-V) | `functions/scripts/warehouseBackupRestoreCli.js` |
| Backend verifier CLI (E2-V) | `functions/scripts/receivingE2VerifierCli.js` |
| Rules extract+hash CLI (E2-V) | `functions/scripts/firestoreRulesSourceHashCli.js` |

**Reviewed-tool content hashes** (these exact E2-V tools were reviewed under PR #555; the preflight
verifies them so no unreviewed tool runs against production):

```
7cef791e6bcb8190da4dca1b47b8f3c04ece8f5eed87d8ac8b15a0b9c3c58eb8  functions/scripts/receivingE2VerifierCli.js
c43f861da2ccd71047fdc392361c58b6eb5a3801c59d60c0453190fbc209ed35  functions/scripts/warehouseBackupRestoreCli.js
3115988b0c6babb7bf2063f8a6f7f8410d51c2ddd6007428da5447f0ea96dfe8  functions/scripts/firestoreRulesSourceHashCli.js
c4f28c20dfd0ba0d97c2216b239f37556cbf008f402ecca8154aa5dc9d463310  functions/scripts/verifyReceivingE2Deployment.js
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
git fetch origin && git checkout 41f7280f88f9c1676e7794ba98d2a12d7b989d82 && git status --porcelain   # prints nothing
git rev-parse HEAD                         # 41f7280f88f9c1676e7794ba98d2a12d7b989d82
cd functions && npm ci && npm run build && cd ..
# Reviewed-tool integrity: the E2-V tools must be byte-exactly the versions reviewed in PR #555.
for f in functions/scripts/receivingE2VerifierCli.js functions/scripts/warehouseBackupRestoreCli.js \
         functions/scripts/firestoreRulesSourceHashCli.js functions/scripts/verifyReceivingE2Deployment.js \
         functions/src/warehouseGovernance/warehouseBackupCodec.ts; do
  echo "$(git show HEAD:$f | sha256sum | cut -d' ' -f1)  $f"
done
```

**Expected:** every check matches; working tree clean; build succeeds. Compare the printed tool hashes to
the **Reviewed-tool content hashes** table above (source `.ts`/`.js` blobs). Any mismatch → **STOP** (an
unreviewed tool must never run against production). **PAUSE.**

## Phase 1 — Reconfirm preconditions + capture the hash-bound pre-deploy Functions inventory

```bash
EXPECTED_RULES_SHA=$(git show HEAD:firestore.rules | sha256sum | cut -d" " -f1) && echo "governed rules: $EXPECTED_RULES_SHA" \
 && test "$EXPECTED_RULES_SHA" = ec1f0a9b78d937d1eff1aef6c2588b20a0dc77501b392e560b491e7c13b1ccd1 && echo RULES-PIN-OK \
 && test "$(git show HEAD:field-ops-app-vite/firestore.rules | sha256sum | cut -d" " -f1)" = "$EXPECTED_RULES_SHA" && echo MIRROR-MATCHES-BLOB
grep -nE "receiveInventoryStockCallable as receiveInventoryStock|listReceivingLocationOptionsCallable as listReceivingLocationOptions" functions/src/index.ts
mkdir -p e2-evidence
# COMPLETE pre-deploy Functions inventory (the exact-delta baseline the verifier hash-binds in Phase 8).
gcloud functions list --project taylor-parts --format json > e2-evidence/functions-before.json
grep -E "receiveInventoryStock|listReceivingLocationOptions" e2-evidence/functions-before.json || echo RECEIVING-CALLABLES-ABSENT-OK
PRE_INV_SHA=$(sha256sum e2-evidence/functions-before.json | cut -d" " -f1) && echo "pre-deploy inventory sha256: $PRE_INV_SHA"
```

**Expected:** `RULES-PIN-OK`, `MIRROR-MATCHES-BLOB`, the two export lines,
`RECEIVING-CALLABLES-ABSENT-OK`, and a recorded `$PRE_INV_SHA` (reused in Phase 8). Keep this shell. **PAUSE.**

## Phase 2 — Deploy the Phase-D `receiving_orders` deny-client Rules

> **Combined-content acknowledgement:** `firebase deploy --only firestore:rules` ships the **entire**
> current governed `firestore.rules`, not just the `receiving_orders` block — also the merged Truck
> Registry read/write Rules, the Equipment-D4 client-closed registry, and the INV-CONVERGENCE-E Stage-B
> operational-role parts reads. Capture the production baseline, hash it via the reviewed strict extractor,
> and **HALT at Phase 2.5 for explicit Owner approval of the exact delta** before deploying.

```bash
# 2a. Capture the pre-deploy production Rules baseline (rollback artifact) + its strict content hash.
mkdir -p rollback && TOKEN=$(gcloud auth print-access-token) \
 && REL=$(curl -s -H "Authorization: Bearer $TOKEN" "https://firebaserules.googleapis.com/v1/projects/taylor-parts/releases" | python3 -c "import sys,json; rs=json.load(sys.stdin)['releases']; print([r['rulesetName'] for r in rs if r['name'].endswith('cloud.firestore')][0])") \
 && curl -s -H "Authorization: Bearer $TOKEN" "https://firebaserules.googleapis.com/v1/$REL" > rollback/baseline-ruleset.json \
 && node functions/scripts/firestoreRulesSourceHashCli.js --in rollback/baseline-ruleset.json | tee e2-evidence/pre-deploy-rules-hash.json
# 2b. Baseline diff — the exact delta the deploy will introduce (Owner-reviewed at Phase 2.5).
python3 -c "import json;print(json.load(open('rollback/baseline-ruleset.json'))['source']['files'][0]['content'])" > rollback/firestore.rules
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
# 2d. Verify the deployed ruleset content is byte-exactly the governed blob (strict extractor).
TOKEN=$(gcloud auth print-access-token) \
 && REL=$(curl -s -H "Authorization: Bearer $TOKEN" "https://firebaserules.googleapis.com/v1/projects/taylor-parts/releases" | python3 -c "import sys,json; rs=json.load(sys.stdin)['releases']; print([r['rulesetName'] for r in rs if r['name'].endswith('cloud.firestore')][0])") \
 && curl -s -H "Authorization: Bearer $TOKEN" "https://firebaserules.googleapis.com/v1/$REL" > e2-evidence/post-deploy-ruleset.json \
 && test "$(node functions/scripts/firestoreRulesSourceHashCli.js --in e2-evidence/post-deploy-ruleset.json | python3 -c 'import sys,json;print(json.load(sys.stdin)["contentSha256"])')" = "$EXPECTED_RULES_SHA" && echo LIVE-EQUALS-GOVERNED-BLOB
```

**Expected:** deploy log shows `released rules firestore.rules` and nothing about functions/hosting/indexes;
`LIVE-EQUALS-GOVERNED-BLOB` (live content == `ec1f0a9b…ccd1`, via the reviewed strict extractor). If
missing → **STOP → ROLLBACK (R1)**. **PAUSE.**

## Phase 3 — Pre-migration client-denial go/no-go

Before the irreversible migration, confirm the deployed deny-all is in force: `receiving_orders` must deny
every client (the byte-verified governed ruleset in Phase 2d contains the deny-all; this is the behavioral
confirmation). The **authoritative, recorded** four-observation denial proof is produced by the Phase-8
verifier; this is the pre-migration safety gate. Zero writes (all denied).

```bash
DB="https://firestore.googleapis.com/v1/projects/taylor-parts/databases/(default)/documents"
echo -n "unauth read: ";  curl -s -o /dev/null -w "%{http_code}\n" "$DB/receiving_orders/e2probe"
echo -n "unauth write: "; curl -s -o /dev/null -w "%{http_code}\n" -X PATCH "$DB/receiving_orders/e2probe" -H "Content-Type: application/json" -d '{"fields":{"probe":{"stringValue":"x"}}}'
```

**Expected:** both `403`. Any `2xx` → **STOP → ROLLBACK (R1)** (deny-all not in force; do not migrate). **PAUSE.**

## Phase 4 — Warehouse governance migration: **DRY-RUN** (zero writes)

```bash
node functions/scripts/warehouseGovernanceMigrationCli.js \
  --project taylor-parts --commit 41f7280f88f9c1676e7794ba98d2a12d7b989d82 \
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

## Phase 6 — Backup (rollback artifact) → migration **EXECUTE** → capture expected post-migration state

```bash
# 6a. Pre-migration LOSSLESS backup -> access-controlled rollback dir OUTSIDE the evidence tarball.
node functions/scripts/warehouseBackupRestoreCli.js \
  --project taylor-parts --commit 41f7280f88f9c1676e7794ba98d2a12d7b989d82 \
  --out-dir /secure/local/rollback/warehouses-pre-migration | tee /secure/local/rollback/backup-result.json
# Record the printed snapshotSha256 (rollback binding). Fails closed if the set is un-restorable in one txn.
# 6b. Execute the migration (Owner-approved manifest hash); verifier runs after; evidence only on pass.
node functions/scripts/warehouseGovernanceMigrationCli.js \
  --project taylor-parts --commit 41f7280f88f9c1676e7794ba98d2a12d7b989d82 \
  --execute --acknowledge-production-write \
  --manifest e2-evidence/warehouse-resolution-manifest.json \
  --manifest-sha256 <OWNER_APPROVED_MANIFEST_SHA256> \
  --evidence-dir e2-evidence/warehouse-migration-execute
cat e2-evidence/warehouse-migration-execute/verification.json
# 6c. Capture the Owner-approved EXPECTED post-migration live-state content hash (binds a later rollback).
node functions/scripts/warehouseBackupRestoreCli.js \
  --project taylor-parts --commit 41f7280f88f9c1676e7794ba98d2a12d7b989d82 \
  --out-dir /secure/local/rollback/warehouses-post-migration
# Record the printed liveContentSha256 -> this is R2's --expected-live-sha256.
```

**Expected:** 6a prints a `snapshotSha256`; 6b `verification.json` shows `pass: true`, `counts.governed ==
total`, and `legacy/ambiguous/malformed/activePresent/identityMismatch == 0`; 6c prints a
`liveContentSha256`. Any migration/verifier failure or an un-restorable backup → **STOP → ROLLBACK (R2)**.
Keep the rollback dir access-controlled and **out of** the evidence tarball. **PAUSE.**

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
cp config/receiving-e2-verification.example.json config/receiving-e2-verification.local.json
# Edit governedCommit -> 41f7280…; set the env vars (never committed/logged):
export E2_WEB_API_KEY=...  E2_TEST_EMAIL=...  E2_TEST_PASSWORD=...
node functions/scripts/receivingE2VerifierCli.js \
  --config config/receiving-e2-verification.local.json \
  --evidence-dir e2-evidence/backend-verification \
  --verify-date <YYYY-MM-DD> --confirm-project taylor-parts \
  --pre-deploy-inventory e2-evidence/functions-before.json \
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

- **R1 — Rules (Phase 2/2.5/3):** redeploy the captured baseline; re-verify the live content hash equals
  the baseline hash from Phase 2a. The callables are unaffected (not yet deployed).
  ```bash
  cd rollback && firebase deploy --only firestore:rules --project taylor-parts && cd ..
  ```

- **R2 — Migration (Phase 6):** the migration commits atomically before verification, so a verifier failure
  can leave committed governed records. Restore from the Phase-6a snapshot via the reviewed backup/restore
  CLI — bound to the snapshot hash AND the Owner-approved **expected post-migration** content hash (from
  Phase 6c); it fails closed on identity-set drift OR any same-ID content change since that approved state:
  ```bash
  node functions/scripts/warehouseBackupRestoreCli.js --restore \
    --project taylor-parts --commit 41f7280f88f9c1676e7794ba98d2a12d7b989d82 \
    --snapshot /secure/local/rollback/warehouses-pre-migration/snapshot.json \
    --snapshot-sha256 <PHASE_6a_snapshotSha256> \
    --expected-live-sha256 <PHASE_6c_liveContentSha256> \
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
- `functions-before.json` (+ `$PRE_INV_SHA` recorded) — the hash-bound pre-deploy inventory
- `pre-deploy-rules-hash.json`, `rules-baseline.diff` (Phase 2.5 inputs)
- `rules-deploy-output.txt`, `post-deploy-ruleset.json` (live content == `ec1f0a9b…ccd1`)
- `warehouse-migration-dry-run/dry-run.json`
- `warehouse-migration-execute/verification.json` (`pass: true`, `governed == total`)
- `functions-deploy-output.txt`
- `backend-verification/verification-report.json` (all E2-V assertions pass) — or `backend-verification.FAILED/` on failure
- `checksums.sha256`

**Kept OUTSIDE the tarball** (access-controlled `/secure/local/rollback/`): the pre- and post-migration
`snapshot.json` + `snapshot.sha256` + `content.sha256` rollback artifacts (they hold complete warehouse
document content — never packaged, never committed, never returned).

## After this handoff

Codex technical review of this package → (separately Owner-authorized) E2 execution → evidence import + E2
closure PR → then **Phase F** (Customer readiness flip / frontend cutover / legacy-writer removal /
Hosting), under its own Owner authorization.
