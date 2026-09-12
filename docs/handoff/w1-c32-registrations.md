# W1 C32 — Fulfillment & allocation: registrations

Branch `impl/w1-fulfillment-allocation`, from `33945090d66d2287fe0cdc362c80ad6e4e311067`.

## Migration

**NONE.** The reserved id `1760486400000` is unused and no migration file was created. Nothing in this
change alters stored data: one dead pure function is deleted, one existing test suite is retargeted onto
the derivation production already runs, and two open gaps are pinned. There is no schema, no backfill and
no new field.

## New collections / capabilities / callables / Rules

**NONE.** No new Firestore collection, no new callable, no new capability, no `firestore.rules` change, no
new Firebase runtime dependency. `salesOrder.fulfill` remains `active: false` (unchanged — and it is what
keeps every gap named below latent rather than live).

## Test registration — NO NEW SCRIPT OR WORKFLOW ENTRY IS REQUIRED

Every assertion added by this change lives in an **existing** file that is **already** referenced by both
the npm script and the workflow, so there is no way for it to run nowhere:

| | |
|---|---|
| Test file | `functions/test/allocateSalesOrderAllocation.test.mjs` (retargeted + extended; no new file) |
| npm script | `functions/package.json` → `test:fulfillment` — already lists this file (line 64) |
| Workflow | `.github/workflows/fulfillment-allocation-tests.yml` — already lists this file in both the `pull_request` and `push` path filters, and runs `npm run test:fulfillment` |
| Also triggered by | the same workflow's `functions/src/fulfillment/**` path filter, which covers the edit to `fulfillmentAvailability.ts` |

Verify with: `cd functions && npm run build && node --test test/allocateSalesOrderAllocation.test.mjs`
(15 tests), or the whole gate `npm run test:fulfillment` (174 tests).

Both files (`functions/package.json`, `.github/workflows/**`) are on this wave's SHARED / DO-NOT-EDIT list
and were **not** edited. Adding a new test file would have required editing one of them; folding the
assertions into the already-registered suite avoids that entirely.

## Files changed

- `functions/src/fulfillment/fulfillmentAvailability.ts` — deleted `sumEligibleOnHand()` (the superseded
  `stock_locations` derivation, zero production callers); tombstone comment in its place; corrected one
  stale `stock_locations` reference in the `computePartAvailability` idempotency docblock.
- `functions/test/allocateSalesOrderAllocation.test.mjs` — retargeted onto `sumLedgerEligibleOnHand` with
  ledger-shaped fixtures (typed `location` pair, Model-A `binParentage`, `${kind}:${ref}` pool key); all
  prior cases preserved; new cases for the typed pair, bin custody, movement sign, SERIAL-as-evidence,
  commitment-facts-are-not-movements; two pinned gaps.
- `docs/handoff/w1-c32-registrations.md` — this file.

## Not done, and why

- **Operating-company scoping of allocation.** Real gap, pinned as a test, NOT fixed: DECISIONS #165
  ruling 4 is recorded as NOT CLOSED, and `operatingCompanyId` is ALLOWED-but-never-required on a governed
  warehouse, so a company-scoped pool would have to invent a refuse-or-include answer for company-less
  warehouses. That is new business authority.
- **The CONSUMED commitment arithmetic.** `openWorkOrderReserved` subtracts CONSUMED; `inventoryService`'s
  `openCommitment` does not. DECISIONS #165 names this exact disagreement and explicitly declines to choose.
  Pinned, not decided.
- **The allocation transaction does not take the per-part `inventory_reservation_locks` sentinel** that
  `inventoryService.reserveParts` reads and writes. Reported, not fixed: `reservationLockRef` is private to
  `inventoryService.ts`, which belongs to lane C1 this wave.
