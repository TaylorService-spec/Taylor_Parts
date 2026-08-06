---
artifact_type: runbook
gate: W3 receiving activation — scoped two-function deploy
status: READY FOR OPERATOR (corrected 2026-08-06: 20->22 estate, exact SHA, ORDERED source-state) — deploy itself is a SEPARATE Tier-2 authorization (not granted by preparing this)
date: 2026-08-06
owner: Claude Code
source_commit: fb45e6eed77f1a3ad89737ee22618a770e6362b5 (exact reviewed deploy SHA)
scope: functions:receiveInventoryStock, functions:listReceivingLocationOptions — ONLY
---

# W3 receiving activation runbook (operator)

**Deploys EXACTLY two additive callables and nothing else.** Operator runs every command
(authenticated `taylor-parts`). Explicitly OUT OF SCOPE: blanket deploy, `firestore.rules`
deploy, redeploy of `createWorkOrder`/`transitionWorkOrder`, PartsScanner, customerName
denormalization, any access/admin/reset function. If any command would touch anything beyond
the two named callables, STOP.

Set up an evidence dir first: `mkdir -p ~/w3-evidence`

## 1. Pre-deploy inventory + revision capture (the rollback baseline)
```bash
firebase functions:list --project taylor-parts | tee ~/w3-evidence/01-pre-functions-list.txt
gcloud functions list --project=taylor-parts --v2 \
  --format="table(name.basename(),state,updateTime,serviceConfig.uri)" \
  | tee ~/w3-evidence/01-pre-gcloud-v2.txt
```
CONFIRM: the list has **exactly 20** functions (the reconciled baseline — the explicit 20
names are enumerated in §5) and does **NOT** contain `receiveInventoryStock` or
`listReceivingLocationOptions`. If the count is not 20, or either receiving callable is
already present, STOP — re-reconcile first.

## 2. Exact source commit + dependency-lock capture
Deploy from a clean checkout of the EXACT reviewed commit
**`fb45e6eed77f1a3ad89737ee22618a770e6362b5`** — NOT "or later." (`functions/src` is
byte-identical at this commit to current main; deploying any other commit is out of scope
for this authorization.)
Run this as one block. Both guards are FAIL-CLOSED — they `exit 1` (stop the script), they do
not merely print. Do NOT continue to build/test/deploy if either aborts.
```bash
set -euo pipefail
EXPECTED_SHA="fb45e6eed77f1a3ad89737ee22618a770e6362b5"

git -C <repo> fetch origin
git -C <repo> checkout "$EXPECTED_SHA"

HEAD_SHA="$(git -C <repo> rev-parse HEAD)"
printf '%s\n' "$HEAD_SHA" | tee ~/w3-evidence/02-source-commit.txt

# Guard 1 — exact reviewed commit (fail-closed):
if [ "$HEAD_SHA" != "$EXPECTED_SHA" ]; then
  echo "ABORT: HEAD is not the reviewed deploy commit ($HEAD_SHA != $EXPECTED_SHA)" >&2
  exit 1
fi

# Guard 2 — clean deploy checkout, no local modifications (fail-closed):
if [ -n "$(git -C <repo> status --porcelain)" ]; then
  echo "ABORT: deploy checkout is not clean" >&2
  git -C <repo> status --short >&2
  exit 1
fi

sha256sum <repo>/functions/package-lock.json | tee ~/w3-evidence/02-lock-sha.txt
```

## 3. Build / typecheck / focused-test prerequisites (must be green before deploy)
```bash
cd <repo>/functions
npm ci --no-audit --no-fund
npm run build                 # tsc -> lib/
npx tsc --noEmit              # typecheck (expect 0)
# focused receiving suites under the Firestore emulator (from repo root, so firestore.rules loads):
cd <repo>
firebase emulators:exec --only firestore --project demo-w3verify \
  "node --test functions/test/receiveInventoryStockCommand.test.mjs functions/test/receivingCallables.test.mjs functions/test/receivingCallablesExport.test.mjs functions/test/receivingGrantGate.test.mjs functions/test/operationalMovementLedger.test.mjs" \
  | tee ~/w3-evidence/03-tests.txt
```
CONFIRM: build/typecheck exit 0; all receiving suites pass. (Run any single suite in its own
`emulators:exec` if a shared-emulator idempotency-key collision appears — known harness artifact.)

## 4. Scoped two-function deploy
```bash
firebase deploy --only functions:receiveInventoryStock,functions:listReceivingLocationOptions \
  --project taylor-parts | tee ~/w3-evidence/04-deploy.txt
```
CONFIRM the deploy summary lists **only** those two function names. If it proposes creating,
updating, or deleting ANY other function, ABORT (answer "No" / Ctrl-C).

## 5. Post-deploy inventory comparison (complete 20 → 22)
The pre-deploy estate is EXACTLY these **20** functions (the reconciled baseline, from §1):
```
assignTruckDriverCallable          changeTruckHomeWarehouseCallable   changeTruckStatusCallable
completeAssignedJob                createSavedDefinitionCallable      createTruckCallable
createWorkOrder                    deactivateTruckCallable            deleteSavedDefinitionCallable
duplicateSavedDefinitionCallable   getSavedDefinitionCallable         listSavedDefinitionsCallable
reactivateTruckCallable            reassignTruckDriverCallable        renameSavedDefinitionCallable
resolveEffectiveAccessCallable     runReportDefinitionCallable        transitionWorkOrder
unassignTruckDriverCallable        updateWorkOrderExecutionData
```
```bash
firebase functions:list --project taylor-parts | tee ~/w3-evidence/05-post-functions-list.txt
# Additions only (must be exactly the two receiving callables):
comm -13 <(grep -oE '[A-Za-z]+Callable|createWorkOrder|transitionWorkOrder|updateWorkOrderExecutionData|completeAssignedJob' ~/w3-evidence/01-pre-functions-list.txt | sort -u) \
         <(grep -oE '[A-Za-z]+Callable|createWorkOrder|transitionWorkOrder|updateWorkOrderExecutionData|completeAssignedJob|receiveInventoryStock|listReceivingLocationOptions' ~/w3-evidence/05-post-functions-list.txt | sort -u)
```
CONFIRM post-deploy the list is EXACTLY those same 20 **plus** `receiveInventoryStock` and
`listReceivingLocationOptions` = **22 total**. Each of the original 20 is still present and
unchanged (name / version / trigger / location / memory / runtime identical to §1); nothing
removed. The additions must be ONLY the two receiving callables.

## 6. Callable existence / configuration verification
Each asserted field is verified by the command that ACTUALLY surfaces it. `gcloud ... describe`
per function surfaces generation/region/memory/runtime/state/URI; `firebase functions:list`
supplies the `v2` version label and the `callable` trigger label (gcloud represents callables
as plain HTTPS functions and does not print the word "callable"). Run describe for BOTH new
functions:
```bash
for FN in receiveInventoryStock listReceivingLocationOptions; do
  gcloud functions describe "$FN" --gen2 --region=us-central1 --project=taylor-parts \
    --format="yaml(name, environment, state, buildConfig.runtime, serviceConfig.availableMemory, serviceConfig.uri)" \
    | tee ~/w3-evidence/06-describe-"$FN".txt
done
# version + trigger labels come from the firebase functions:list capture (§5):
grep -E "receiveInventoryStock|listReceivingLocationOptions" ~/w3-evidence/05-post-functions-list.txt \
  | tee ~/w3-evidence/06-firebase-version-trigger.txt
```
CONFIRM each new function shows these EXACT fields (each maps to the command that reports it):

| Field | Expected value | Verified by (field it prints) |
|-------|----------------|-------------------------------|
| Version | `v2` | `firebase functions:list` — Version column |
| Generation | `GEN_2` | `gcloud describe` — `environment: GEN_2` |
| Trigger | `callable` | `firebase functions:list` — Trigger column |
| Location / Region | `us-central1` | `gcloud describe` — `name: …/locations/us-central1/…` (and the `--region` used) |
| Memory | `256` (MB) | `gcloud describe` — `serviceConfig.availableMemory: 256Mi` |
| Runtime | `nodejs20` | `gcloud describe` — `buildConfig.runtime: nodejs20` |
| State | `ACTIVE` | `gcloud describe` — `state: ACTIVE` |
| Service URI | a `…-uc.a.run.app` HTTPS URI (record it) | `gcloud describe` — `serviceConfig.uri` |

Verify the full table for BOTH `receiveInventoryStock` and `listReceivingLocationOptions`. Also
confirm from §5's pre/post `functions:list` diff that **no other function changed** (the deploy
touched only the two).

## 7. Authorized live tests (Owner-operated, against production)
> PREREQ: the calling actor must have the `inventory.stock.receive` capability **granted live**.
> If it is NOT granted, the "applied" test instead returns `permission-denied` — a VALID
> fail-closed result, not a deploy failure; granting is a SEPARATE, not-authorized-here step.
> SOURCE-STATE PREREQ (ORDERED / ORDERED): the source `reorder_requests/{id}` must be at
> status **`ORDERED`**, with its linked **`reorder_purchase_orders/{id}` present (an ORDERED
> purchase order)** — a receipt applies against an ORDERED PO, not one still in
> `PURCHASING_IN_PROGRESS`. Use a real ORDERED reorder request or a receivable ORDERED test
> fixture. Never paste uids/tokens/raw docs into evidence.

1. **Location options:** call `listReceivingLocationOptions({})` → returns a sanitized options
   list, no error. Save sanitized result to `~/w3-evidence/07a-options.txt`.
2. **One applied receipt:** call `receiveInventoryStock` with the payload below → `outcome: "applied"`,
   a `receivingId`, a `ledgerEventId`.
   ```
   { source: { type: "REORDER_PURCHASE_ORDER", reorderRequestId: <id>, purchaseOrderId: <id /* == reorderRequestId */> },
     receivingLocation: { type: "WAREHOUSE", locationId: <from step 1> },
     lines: [ { lineId: <id>, partId: <id>, expectedQuantity: <n>, receivedQuantity: <n> } ],
     idempotencyKey: <stable key for this receipt> }
   ```
   (Line carries ONLY lineId/partId/expectedQuantity/receivedQuantity — trackingMode/status are server-authored.)
3. **Same-key replay:** call again with the SAME `idempotencyKey` → `outcome: "replayed"`, SAME
   `receivingId` (no double stock).
4. **Unauthorized denial:** call `receiveInventoryStock` as a principal WITHOUT the grant →
   `permission-denied`.
5. **Audit + ledger verification:** confirm the `receiving_orders/{receivingId}` doc exists
   (`PUTAWAY_COMPLETE`, version 1), the operational-movement ledger append exists, and a
   `receiveInventoryStock` AuditAction entry exists (sanitized). Record confirmations (not raw docs).
   Save to `~/w3-evidence/07b-verify.txt`.

## 8. Emergency disable (ONLY the two new functions)
Because both are new/additive, deletion returns the estate to the pre-deploy 20-function baseline.
```bash
firebase functions:delete receiveInventoryStock listReceivingLocationOptions \
  --project taylor-parts --force
```
Do NOT delete any other function. This is an emergency disable, not a source rollback — the
repo source is unchanged, so a later re-deploy from the same commit restores them.

## 9. Evidence paths + DECISIONS.md
- Evidence: `~/w3-evidence/01..07*` (sanitized). Attach/summarize on the Issue #15 tracking item.
- Append a `docs/DECISIONS.md` entry: date; decision = "deployed receiveInventoryStock +
  listReceivingLocationOptions (only)"; source commit + package-lock sha; pre/post functions:list
  delta (+2, others unchanged); the 5 live-test results; rollback baseline = the pre-deploy
  20-function revision set (§1). Note what was NOT done (no other deploy, no Rules, no redeploy,
  no grant change).

---
**This runbook does not deploy anything.** Execution requires a separate, explicit Owner
Tier-2 deploy authorization. If the applied-receipt test needs the `inventory.stock.receive`
grant and it isn't live, granting is its own separate authorization — not covered here.
