# EI Phase-2 Receiving — Gate E2 Activation Handoff (Operator Runbook)

**Status:** Repository-only **preparation**. This runbook does **not** authorize deployment,
migration, or any production write. Each production action below runs **only** under a **separate,
explicit Owner authorization**, from a clean checkout of the exact governed commit. It is prepared by
the INVENTORY session per the Owner's *E2 Activation Gate Preparation* authorization (2026-08-03).

**Governed commit (pin):** `903a48479a8aaf72747e5ddb8ce9a63059d4c05b` (origin/main head at preparation).
**Project (pin):** `taylor-parts` (the only authorized project). **Region (pin):** `us-central1`.

This gate deploys and verifies the **backend** for Receiving: the `receiving_orders` deny-client Rules,
the governed Warehouse migration, and exactly the two receiving callables. It performs **no receipt**,
**no inventory mutation**, and **no Customer readiness flip / UI cutover / Hosting** — those are Phase F,
under their own separate Owner authorization. `inventory.stock.receive` is already granted (repo-only) to
`{admin, dispatcher, owner}` (PR #553); this gate does **not** change any grant and does **not** grant
`PARTS_ASSOCIATE`.

---

## Pinned facts (derive hashes; never hand-copy)

| Item | Value |
|---|---|
| Governed commit | `903a48479a8aaf72747e5ddb8ce9a63059d4c05b` |
| Project | `taylor-parts` |
| Region | `us-central1` |
| Rules artifact | `firestore.rules` (root) + byte-identical mirror `field-ops-app-vite/firestore.rules` |
| Rules **content** sha256 (deploy-verification) | `ec1f0a9b78d937d1eff1aef6c2588b20a0dc77501b392e560b491e7c13b1ccd1` |
| `receiving_orders` Rules block | `firestore.rules` — `allow read, create, update, delete: if false;` (fully backend-private) |
| Migration/verifier CLI | `functions/scripts/warehouseGovernanceMigrationCli.js` (I-LA3, merged; inert on import) |
| Callables (exact deploy allowlist) | `receiveInventoryStock`, `listReceivingLocationOptions` |

Derive the Rules content hash exactly as the deploy uploads it (byte-identical to a Linux/Cloud Shell
tree; a Windows worktree's CRLF would differ — always derive from the git blob):

```bash
git show HEAD:firestore.rules | sha256sum        # expect ec1f0a9b…ccd1
git show HEAD:field-ops-app-vite/firestore.rules | sha256sum   # must equal the above (mirror parity)
```

---

## Hard boundaries (this gate)

- Deploy **only** `firestore:rules`, then **only** `functions:receiveInventoryStock,functions:listReceivingLocationOptions`.
- **No** broad `firebase deploy`, **no** `firebase deploy --only functions`, **no** hosting/indexes/storage/extensions.
- **No** Rules or source edits during the run. **No** `PARTS_ASSOCIATE` grant. **No** Truck changes.
- Migration runs **dry-run first** (zero writes); **execute** only after a **separate Owner approval of
  the exact manifest + its sha256**.
- **No receipt execution / inventory mutation.** Backend verification is discovery + denial only.
- **STOP** before any Customer readiness flip, UI cutover, legacy-writer removal, or Hosting.

## NOT authorized by this runbook

Rules deployment · migration execution or any production write · Functions deployment · receipt
execution or inventory mutation · Customer readiness flip / UI cutover / legacy-writer removal / Hosting
· PARTS_ASSOCIATE grant · Truck changes. Each requires a new, explicit Owner authorization after this
package receives Codex technical clearance.

## Global stop conditions (abort → run the matching ROLLBACK → report)

Main drift (HEAD ≠ governed commit) · project mismatch (≠ `taylor-parts`) · Rules content hash mismatch
(live ≠ `ec1f0a9b…ccd1`) · baseline-diff shows an unexpected Rules delta beyond the acknowledged set ·
failed client-denial proof (any receiving_orders access succeeds) · migration dry-run/execute/verifier
failure · warehouse live-set or pre-state drift between dry-run and execute · unexpected deployed target
(anything beyond the two callables) · a callable does **not** deny unauthenticated callers · any need for
broader production access · sensitive data in evidence.

Run each phase as one block; **pause and compare with the expected output** before continuing.

---

## Phase 0 — Preflight (clean exact-head checkout, tools, build)

```bash
node -v                                   # v20.x (matches functions/package.json engines)
gcloud config get-value project           # taylor-parts
firebase projects:list                    # shows access to taylor-parts
git fetch origin && git checkout 903a48479a8aaf72747e5ddb8ce9a63059d4c05b && git status --porcelain   # prints nothing
git rev-parse HEAD                         # 903a48479a8aaf72747e5ddb8ce9a63059d4c05b
cd functions && npm ci && npm run build && cd ..
```

**Expected:** every check matches; working tree clean; build succeeds (no predeploy hook exists, so the
build is required before any deploy). If HEAD ≠ the governed commit or the tree is dirty, **STOP**. **PAUSE.**

## Phase 1 — Reconfirm repository + production preconditions

```bash
# Rules parity: repo tree == blob == mirror (all derived from the blob).
EXPECTED_RULES_SHA=$(git show HEAD:firestore.rules | sha256sum | cut -d" " -f1) && echo "governed rules: $EXPECTED_RULES_SHA" \
 && test "$EXPECTED_RULES_SHA" = ec1f0a9b78d937d1eff1aef6c2588b20a0dc77501b392e560b491e7c13b1ccd1 && echo RULES-PIN-OK \
 && test "$(git show HEAD:field-ops-app-vite/firestore.rules | sha256sum | cut -d" " -f1)" = "$EXPECTED_RULES_SHA" && echo MIRROR-MATCHES-BLOB
# Callables are exported (repository proof); they are NOT yet deployed (production proof below in Phase 7).
grep -nE "receiveInventoryStockCallable as receiveInventoryStock|listReceivingLocationOptionsCallable as listReceivingLocationOptions" functions/src/index.ts
# Pre-deploy production function inventory — the two receiving callables must be ABSENT (first-time deploy → recovery = delete-only).
gcloud functions list --project taylor-parts --format json > /tmp/functions-before.json
grep -E "receiveInventoryStock|listReceivingLocationOptions" /tmp/functions-before.json || echo RECEIVING-CALLABLES-ABSENT-OK
```

**Expected:** `RULES-PIN-OK`, `MIRROR-MATCHES-BLOB`, the two export lines, and
`RECEIVING-CALLABLES-ABSENT-OK`. Keep this shell (`$EXPECTED_RULES_SHA` is reused). **PAUSE.**

## Phase 2 — Deploy the Phase-D `receiving_orders` deny-client Rules

> **Combined-content acknowledgement (Owner must confirm):** `firebase deploy --only firestore:rules`
> ships the **entire** current governed `firestore.rules`, not just the `receiving_orders` block. Beyond
> Phase-D receiving, the file at this commit also carries the merged Truck Registry read/write Rules,
> the Equipment-D4 client-closed registry, and the INV-CONVERGENCE-E Stage-B operational-role parts
> reads. Capture the production baseline and **diff it** (below); escalate any delta the Owner has not
> acknowledged **before** deploying.

```bash
# 2a. Capture the pre-deploy production Rules baseline (independently deployable rollback artifact).
mkdir -p rollback e2-evidence && TOKEN=$(gcloud auth print-access-token) \
 && REL=$(curl -s -H "Authorization: Bearer $TOKEN" "https://firebaserules.googleapis.com/v1/projects/taylor-parts/releases" | python3 -c "import sys,json; rs=json.load(sys.stdin)['releases']; print([r['rulesetName'] for r in rs if r['name'].endswith('cloud.firestore')][0])") \
 && curl -s -H "Authorization: Bearer $TOKEN" "https://firebaserules.googleapis.com/v1/$REL" | python3 -c "import sys,json; sys.stdout.write(json.load(sys.stdin)['source']['files'][0]['content'])" > rollback/firestore.rules \
 && printf '{"firestore":{"rules":"firestore.rules"}}\n' > rollback/firebase.json \
 && sha256sum rollback/firestore.rules | tee e2-evidence/pre-deploy-production-rules.sha256 \
 && cp rollback/firestore.rules e2-evidence/pre-deploy-production.rules
# 2b. Baseline diff — review the delta the deploy will introduce (must be Owner-acknowledged).
diff <(cat rollback/firestore.rules) <(git show HEAD:firestore.rules) || echo "REVIEW-DELTA-ABOVE"
# Confirm the governed file to be deployed carries the receiving_orders deny-all block.
git show HEAD:firestore.rules | grep -nE "match /receiving_orders|allow read, create, update, delete: if false"
```

**Expected:** a non-empty baseline written; its sha256 recorded (differs from the repo hash — that is the
PRE-E2 baseline). The diff shows **only** Owner-acknowledged blocks and includes the `receiving_orders`
deny-all match. If the baseline is empty/malformed, **STOP — do not deploy without a preserved
baseline.** If the diff shows an unacknowledged change, **STOP and escalate.** **PAUSE.**

```bash
# 2c. Deploy ONLY Firestore Rules.
firebase deploy --only firestore:rules --project taylor-parts 2>&1 | tee e2-evidence/rules-deploy-output.txt
```

**Expected:** `firestore: released rules firestore.rules to cloud.firestore` … `Deploy complete!` —
nothing about functions/hosting/indexes. **PAUSE.**

```bash
# 2d. Verify the deployed ruleset is byte-exactly the governed blob.
TOKEN=$(gcloud auth print-access-token) \
 && REL=$(curl -s -H "Authorization: Bearer $TOKEN" "https://firebaserules.googleapis.com/v1/projects/taylor-parts/releases" | python3 -c "import sys,json; rs=json.load(sys.stdin)['releases']; print([r['rulesetName'] for r in rs if r['name'].endswith('cloud.firestore')][0])") \
 && curl -s -H "Authorization: Bearer $TOKEN" "https://firebaserules.googleapis.com/v1/$REL" | python3 -c "import sys,json; sys.stdout.write(json.load(sys.stdin)['source']['files'][0]['content'])" > e2-evidence/post-deploy-production.rules \
 && test "$(sha256sum e2-evidence/post-deploy-production.rules | cut -d' ' -f1)" = "$EXPECTED_RULES_SHA" && echo LIVE-EQUALS-GOVERNED-BLOB
```

**Expected:** `LIVE-EQUALS-GOVERNED-BLOB` (live == `ec1f0a9b…ccd1`). If missing, **STOP → ROLLBACK (R1).** **PAUSE.**

## Phase 3 — Verify `receiving_orders` client-denial (authenticated + unauthenticated)

`receiving_orders` is deny-all at the Rules layer (`if false`), so **every** client access — read or
write, authenticated (any role, including admin) or not — must be denied; the only writer is the
Admin-SDK-backed callable (deployed in Phase 7). These probes create nothing (all attempts are denied),
so no cleanup is required. Use a throwaway document id `e2probe` that is never created.

```bash
DB="https://firestore.googleapis.com/v1/projects/taylor-parts/databases/(default)/documents"
# 3a. UNAUTHENTICATED read + write — expect PERMISSION_DENIED (403) for both.
curl -s -o /dev/null -w "unauth read: %{http_code}\n"  "$DB/receiving_orders/e2probe"
curl -s -o /dev/null -w "unauth write: %{http_code}\n" -X PATCH "$DB/receiving_orders/e2probe" \
  -H "Content-Type: application/json" -d '{"fields":{"probe":{"stringValue":"x"}}}'
# 3b. AUTHENTICATED (a dedicated NON-production test account; password supplied via env, never committed).
#     Even an authenticated privileged principal must be denied by the deny-all rule.
ID_TOKEN=$(curl -s "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=$E2_WEB_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$E2_TEST_EMAIL\",\"password\":\"$E2_TEST_PASSWORD\",\"returnSecureToken\":true}" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['idToken'])")
curl -s -o /dev/null -w "auth read: %{http_code}\n"  -H "Authorization: Bearer $ID_TOKEN" "$DB/receiving_orders/e2probe"
curl -s -o /dev/null -w "auth write: %{http_code}\n" -H "Authorization: Bearer $ID_TOKEN" -X PATCH "$DB/receiving_orders/e2probe" \
  -H "Content-Type: application/json" -d '{"fields":{"probe":{"stringValue":"x"}}}'
{ echo "receiving_orders client-denial (all four expect 403):";
  echo "  unauth read/write + auth read/write"; } | tee e2-evidence/receiving-orders-denial.txt
```

**Expected:** **all four** print `403`. Any `200/2xx` (an access succeeded) → **STOP → ROLLBACK (R1)** —
the deny-all is not in force. `$E2_WEB_API_KEY` / `$E2_TEST_EMAIL` / `$E2_TEST_PASSWORD` come only from
the operator env and are never written to evidence. **PAUSE.**

## Phase 4 — Warehouse governance migration: **DRY-RUN** (zero writes)

Dry-run is the default (no `--execute`): it classifies the live `warehouses` set and emits sanitized
evidence listing the counts and the **ambiguous** fingerprints the Owner must resolve. It performs
**zero** writes and requires no manifest.

```bash
node functions/scripts/warehouseGovernanceMigrationCli.js \
  --project taylor-parts \
  --commit 903a48479a8aaf72747e5ddb8ce9a63059d4c05b \
  --evidence-dir e2-evidence/warehouse-migration-dry-run
cat e2-evidence/warehouse-migration-dry-run/dry-run.json
```

**Expected:** `{ ok: true, mode: "dry-run", evidenceDir: … }`; `dry-run.json` reports
`counts: { total, governed, derive, ambiguous }` and, for any ambiguous records, their ids/fingerprints.
Classification (ratified I-LA C2 matrix): **GOVERNED** = already a §3A record (no-op); **DERIVE** =
unambiguous (missing `status` → derive from legacy `active`; missing `active` → `ACTIVE`; a valid
`status` with no contradiction); **AMBIGUOUS** = `status`⊕`active` contradiction or a malformed
`status` (requires an Owner-authored manifest entry). **Return `dry-run.json` to the Owner.** **PAUSE — Owner checkpoint next.**

## Phase 5 — OWNER CHECKPOINT: resolution-manifest approval (separate authorization)

> **This is a hard stop for a separate Owner authorization.** The Owner reviews `dry-run.json` and, for
> the ambiguous set **only**, authors the resolution manifest and approves its exact sha256. Do not
> proceed to Phase 6 without it.

Manifest schema (Owner-authored; **one entry per ambiguous id, and no others**):

```json
{
  "projectId": "taylor-parts",
  "governedCommit": "903a48479a8aaf72747e5ddb8ce9a63059d4c05b",
  "entries": [
    { "warehouseId": "<ambiguous-id>", "intendedStatus": "ACTIVE|INACTIVE", "preStateFingerprint": "<fingerprint from dry-run.json>" }
  ]
}
```

The CLI validates the manifest fail-closed against the plan: `missing_entry` / `extra_entry` /
`duplicate` / `invalid_status` / `wrong_project` / `wrong_commit` / `stale_prestate`. **If
`ambiguous == 0`**, the Owner still approves a manifest with `"entries": []` (the CLI requires
`--manifest` + `--manifest-sha256` for `--execute`; an empty ambiguous set demands empty entries). The
Owner supplies the manifest file and its hash:

```bash
sha256sum e2-evidence/warehouse-resolution-manifest.json   # the Owner-approved value; passed to --manifest-sha256
```

**HALT here** until the Owner returns: (a) the exact manifest content, (b) its sha256, (c) an explicit
"execute the migration" authorization at this governed commit.

## Phase 6 — Migration **EXECUTE** + governed verification (after Owner manifest approval)

```bash
# 6a. Rollback artifact: full pre-migration snapshot of every warehouse doc (Admin-SDK read).
node -e 'const a=require("firebase-admin");a.initializeApp();a.firestore().collection("warehouses").get().then(s=>{const o={};s.forEach(d=>o[d.id]=d.data());require("node:fs").writeFileSync("e2-evidence/warehouses-pre-migration.json",JSON.stringify(o,null,2));console.log("snapshot docs:",s.size);})'
# 6b. Execute — bound to the Owner-approved manifest hash; all-or-nothing in one transaction; fails
#     closed on live-set drift or pre-state drift; verifier runs after; evidence published only on pass.
node functions/scripts/warehouseGovernanceMigrationCli.js \
  --project taylor-parts \
  --commit 903a48479a8aaf72747e5ddb8ce9a63059d4c05b \
  --execute --acknowledge-production-write \
  --manifest e2-evidence/warehouse-resolution-manifest.json \
  --manifest-sha256 <OWNER_APPROVED_MANIFEST_SHA256> \
  --evidence-dir e2-evidence/warehouse-migration-execute
cat e2-evidence/warehouse-migration-execute/verification.json
```

**Expected:** `{ ok: true, mode: "execute", evidenceDir: … }`; `verification.json` shows
`pass: true`, `counts.governed == total`, and `legacy/ambiguous/malformed/activePresent/identityMismatch
== 0` — **every** warehouse is now a governed §3A record with no legacy `active`. Any of: `manifest hash
mismatch`, `LIVE_SET_DRIFT`, `STALE_PRESTATE`, `post-migration verification failed` → **the CLI writes
nothing / publishes no evidence; STOP → ROLLBACK (R2).** **PAUSE.**

## Phase 7 — Deploy **only** the two receiving callables (exact allowlist)

```bash
firebase deploy --project taylor-parts \
  --only functions:receiveInventoryStock,functions:listReceivingLocationOptions 2>&1 | tee e2-evidence/functions-deploy-output.txt
```

> Prohibited: `firebase deploy`, `firebase deploy --only functions`, or any wildcard/broad target. Only
> the explicit two-name allowlist above is authorized. This deploys no Hosting/Rules/indexes and deletes
> no unlisted function.

**Expected:** both functions deploy successfully @ `us-central1`; nothing else touched. **PAUSE.**

## Phase 8 — Backend verification **without executing a real receipt**

Prove the two callables are deployed and enforcing their first-line guard — **discovery + denial only.**
Authorization fails before any business logic, so these calls perform **zero** writes and **no** receipt.

```bash
# 8a. Discovery — both present @ us-central1.
gcloud functions list --project taylor-parts --format json > /tmp/functions-after.json
for fn in receiveInventoryStock listReceivingLocationOptions; do
  python3 -c "import sys,json;d=json.load(open('/tmp/functions-after.json'));m=[f for f in d if f.get('name','').endswith('/$fn')];print('$fn:', 'PRESENT@'+m[0].get('region','?') if m else 'MISSING')"
done
# 8b. Unauthenticated invocation of each callable → the callable protocol must return UNAUTHENTICATED
#     (no Authorization header, well-formed callable envelope). Zero writes.
BASE="https://us-central1-taylor-parts.cloudfunctions.net"
for fn in receiveInventoryStock listReceivingLocationOptions; do
  echo -n "$fn unauth: "; curl -s -X POST "$BASE/$fn" -H "Content-Type: application/json" -d '{"data":{}}' \
    | python3 -c "import sys,json;e=json.load(sys.stdin).get('error',{});print(e.get('status','NO-ERROR'))"
done | tee e2-evidence/callables-unauth-denial.txt
# 8c. Confirm zero receiving_orders were created during verification.
node -e 'const a=require("firebase-admin");a.initializeApp();a.firestore().collection("receiving_orders").limit(1).get().then(s=>console.log("receiving_orders present:",s.size))'
```

**Expected:** both discovery lines `PRESENT@us-central1`; both unauth lines `UNAUTHENTICATED`;
`receiving_orders present: 0` (this gate wrote none). A callable that returns `NO-ERROR` (accepted an
unauthenticated call) → **STOP → ROLLBACK (R3).**

> **Optional (still no receipt), only if the Owner wants a positive read proof:** an authorized principal
> (`admin`/`dispatcher`/`owner` with an active `roleAssignment`) may call `listReceivingLocationOptions`
> — it is **read-only** and returns the sanitized ACTIVE-warehouse option list with **zero** mutation. A
> positive `receiveInventoryStock` is **out of scope** (it is a real receipt) and must not be run here. **PAUSE.**

## Phase 9 — Package evidence and STOP (before Customer readiness activation)

```bash
cd e2-evidence \
 && (grep -riE "token|password|secret|bearer|apikey|api_key" . | grep -v checksums.sha256 || echo SENSITIVE-SCAN-CLEAN) \
 && sha256sum $(find . -type f ! -name checksums.sha256 | sort) > checksums.sha256 \
 && cd .. && tar czf receiving-e2-evidence.tgz e2-evidence && sha256sum receiving-e2-evidence.tgz
```

**Expected:** `SENSITIVE-SCAN-CLEAN`; tarball + sha256 printed (record it). **DONE — return the tarball
plus both production Rules sha256 values (pre + post) and the migration `verification.json`.** Do **not**
proceed to Customer readiness activation, UI cutover, legacy-writer removal, or Hosting — that is **Phase
F**, a separate repository + Hosting gate under its own Owner authorization. (Customer LF1b's
readiness-false transport adapter already landed via PR #552; readiness stays `false` throughout E2.)

---

## ROLLBACK boundaries

- **R1 — Rules (Phase 2/3):** redeploy the captured baseline, then re-verify the live hash equals the
  baseline hash from Phase 2a.
  ```bash
  cd rollback && firebase deploy --only firestore:rules --project taylor-parts && cd ..
  ```
  The callables are unaffected by a Rules rollback (they are not yet deployed at Phase 2/3).

- **R2 — Migration (Phase 6):** the migration commits atomically **before** verification runs, so a
  verifier failure can leave committed governed records. Restore every warehouse from the Phase-6a
  pre-migration snapshot via the Admin SDK, then re-run the Phase-4 dry-run and confirm `governed ==` the
  original governed count and the ambiguous/derive sets match the pre-migration classification. Escalate
  to the Owner with the snapshot path before any retry.

- **R3 — Callables (Phase 7/8):** first-time deploy → recovery is **delete exactly these two**, returning
  to the exported-but-undeployed state (no client path exists; readiness is `false`).
  ```bash
  for fn in receiveInventoryStock listReceivingLocationOptions; do
    firebase functions:delete "$fn" --project taylor-parts --region us-central1 --force
  done
  ```
  Verify against `/tmp/functions-before.json`. Do **not** delete or modify any other function.

## Evidence schema (sanitized — no tokens/keys/passwords/PII)

`receiving-e2-evidence.tgz` → `e2-evidence/`:
- `pre-deploy-production.rules` + `pre-deploy-production-rules.sha256` (rollback baseline)
- `rules-deploy-output.txt`, `post-deploy-production.rules` (live == `ec1f0a9b…ccd1`)
- `receiving-orders-denial.txt` (four 403s)
- `warehouse-migration-dry-run/dry-run.json` (counts + ambiguous fingerprints)
- `warehouses-pre-migration.json` (rollback snapshot)
- `warehouse-migration-execute/verification.json` (`pass: true`, `governed == total`)
- `functions-deploy-output.txt`, `callables-unauth-denial.txt` (two `UNAUTHENTICATED`)
- `checksums.sha256`

## Owner authorization checkpoints (summary)

1. **This preparation** — repository-only; produces this runbook for Codex review. *(current)*
2. **E2 execution start** — a new, explicit Owner authorization to run Phases 1–9 at the governed commit.
3. **Phase 5 manifest approval** — a separate Owner authorization of the exact resolution-manifest content
   + sha256 before the migration `--execute`.

## After this handoff

Codex technical review of this package → (separately Owner-authorized) E2 execution → evidence import +
E2 closure PR → then **Phase F** (Customer readiness flip / frontend cutover / legacy-writer removal /
Hosting), under its own Owner authorization.
