---
artifact_type: runbook
gate: W3 receiving activation — scoped two-function deploy
status: READY FOR OPERATOR — deploy itself is a SEPARATE Tier-2 authorization (not granted by preparing this)
date: 2026-08-06
owner: Claude Code
source_commit: fb45e6e (origin/main)
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
CONFIRM: the list has **21** functions and does **NOT** contain `receiveInventoryStock` or
`listReceivingLocationOptions`. If either is already present, STOP — re-reconcile first.

## 2. Exact source commit + dependency-lock capture
Deploy from a clean checkout of `origin/main` at **`fb45e6e`** (or a later main — record the
actual SHA):
```bash
git -C <repo> fetch origin && git -C <repo> checkout origin/main
git -C <repo> rev-parse HEAD | tee ~/w3-evidence/02-source-commit.txt        # expect fb45e6e or later
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

## 5. Post-deploy inventory comparison
```bash
firebase functions:list --project taylor-parts | tee ~/w3-evidence/05-post-functions-list.txt
diff <(grep -oE '[A-Za-z]+Callable|createWorkOrder|transitionWorkOrder|updateWorkOrderExecutionData|completeAssignedJob|receiveInventoryStock|listReceivingLocationOptions' ~/w3-evidence/01-pre-functions-list.txt | sort -u) \
     <(grep -oE '[A-Za-z]+Callable|createWorkOrder|transitionWorkOrder|updateWorkOrderExecutionData|completeAssignedJob|receiveInventoryStock|listReceivingLocationOptions' ~/w3-evidence/05-post-functions-list.txt | sort -u)
```
CONFIRM the ONLY difference is **+`receiveInventoryStock`** and **+`listReceivingLocationOptions`**
(now 23 total). Every previously-deployed function is unchanged.

## 6. Callable existence / configuration verification
```bash
gcloud functions list --project=taylor-parts --v2 \
  --format="table(name.basename(),state,updateTime,serviceConfig.uri)" \
  | tee ~/w3-evidence/06-post-gcloud-v2.txt
```
CONFIRM both new functions are `ACTIVE`, `GEN_2`, `us-central1`, `nodejs20`, with run.app URIs,
and that **no other function's `updateTime` changed** (i.e. the deploy touched only the two).

## 7. Authorized live tests (Owner-operated, against production)
> PREREQ: the calling actor must have the `inventory.stock.receive` capability **granted live**.
> If it is NOT granted, the "applied" test instead returns `permission-denied` — a VALID
> fail-closed result, not a deploy failure; granting is a SEPARATE, not-authorized-here step.
> You also need one real `reorder_requests`/`reorder_purchase_orders` at `PURCHASING_IN_PROGRESS`
> to receive against (or a receivable test fixture). Never paste uids/tokens/raw docs into evidence.

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
Because both are new/additive, deletion returns the estate to the pre-deploy 21-function baseline.
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
  21-function revision set (§1). Note what was NOT done (no other deploy, no Rules, no redeploy,
  no grant change).

---
**This runbook does not deploy anything.** Execution requires a separate, explicit Owner
Tier-2 deploy authorization. If the applied-receipt test needs the `inventory.stock.receive`
grant and it isn't live, granting is its own separate authorization — not covered here.
