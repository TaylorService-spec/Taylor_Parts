---
artifact_type: review
gate: W3 — Close the inventory write-loop (readiness package)
wave: W3
status: Backend complete — activation deferred to Issue #15; scanner integration deferred to parallel owner
date: 2026-08-05
owner: Claude Code
base_commit: 28d695e (origin/main)
spec: docs/specifications/enterprise-inventory-receiving-phase2.md
tier: activation is Tier-2/3 (Blaze + Functions deploy) — repo-only readiness here
---

# W3 — Inventory write-loop readiness package

**Repository-only.** No Functions deployed, no Blaze enabled, `PartsScanner.jsx` untouched,
no competing scanner built, scope not broadened. This package documents what already exists
and hands off the two deferred boundaries with evidence.

## 1. Exact existing backend inventory (on `main` @ 28d695e)

**`functions/src/inventoryReceiving/`** (11 files, ~85 KB TS):
`receivingTypes.ts` · `receivingValidation.ts` · `receivingRepository.ts` ·
`receivingLocationResolver.ts` · `receiveInventoryStockCommand.ts` ·
`receiveInventoryStockComposition.ts` · `receivingCallables.ts` ·
`receivingCallableWiring.ts`.
**`functions/src/inventoryLedger/`**: `operationalMovementTypes.ts` ·
`operationalMovementValidation.ts` · `operationalMovementRepository.ts`.

**Deploy-wired:** `functions/src/index.ts:120-121` exports
`receiveInventoryStockCallable as receiveInventoryStock` and
`listReceivingLocationOptionsCallable as listReceivingLocationOptions` — the callables are
wired for deployment (not deployed; Blaze-gated, Issue #15).

## 2. Receive → ledger contract and invariants

**Callable:** `receiveInventoryStock(request)` (`onCall`, v2).
**Request `data`** (validated by `validateReceiveRequest`, all fields structurally checked):
```
{ source: { type: "REORDER_PURCHASE_ORDER", reorderRequestId, purchaseOrderId },
  receivingLocation: { type, locationId },
  lines: [ { lineId, partId, trackingMode: "NONE", expectedQuantity, receivedQuantity, status: "RECEIVED" } ],
  idempotencyKey }
```
**Response:** `{ outcome: "applied" | "replayed", receivingId, fingerprint }`.

**Invariants (from `receivingTypes.ts` + the command):**
- **Actor is server-derived.** `requireAuth` takes the UID from the verified auth context
  ONLY — never `request.data`.
- **Governed authorization read THROUGH the transaction.** `inventory.stock.receive`
  capability + the actor's active `roleAssignments`/`accessVersion` are read inside the
  commit txn, so a concurrent revocation conflicts the commit (fail-closed).
- **First slice is deliberately narrow:** exactly one `NONE`-tracked line, created directly
  at `PUTAWAY_COMPLETE` version 1, with `expectedQuantity == receivedQuantity ==
  PO.orderedQuantity` (authoritative from `reorder_purchase_orders.orderedQuantity`).
  `SERIAL`/`LOT` fail closed (deferred). Source `REORDER_PURCHASE_ORDER` only.
- **Bounded public error matrix** (`mapReceiveError`): `invalid-argument` /
  `failed-precondition` (idempotency conflict, malformed stored state) / `unauthenticated`
  / `internal` — no raw Firestore path/value/code/reason ever leaks.
- **Ledger:** the operational-movement ledger append is the stock effect; audit is an
  append-only `receiveInventoryStock` AuditAction with a bounded, sanitized summary.

## 3. Idempotency evidence

- Every write is keyed by a caller-supplied `idempotencyKey` → deterministic doc id
  (`receivingOrderDocId(idempotencyKey)`).
- Re-submitting the **same** key returns `outcome: "replayed"` with the SAME `receivingId`
  and `fingerprint` — the effect is applied at most once. A **different** payload under the
  same key raises `IdempotencyConflictError` → `failed-precondition` (never a silent
  double-apply). `fingerprint` pins the applied content for replay verification.
- (Test evidence: §6.)

## 4. Scanner integration contract (for the PARALLEL OWNER — do not implement here)

The parallel session owns `PartsScanner.jsx`. To wire it to the write-loop, its owner calls
the existing callable — **no backend change needed**:

1. Ensure the user is signed in (actor is derived server-side).
2. `httpsCallable(functions, "receiveInventoryStock")({ source, receivingLocation, lines, idempotencyKey })`
   with the shape in §2. Use a **stable** `idempotencyKey` per physical receipt (e.g. derived
   from the reorderRequestId + line) so a double-scan/retry is a safe replay, not a duplicate.
3. Populate a receiving location from `listReceivingLocationOptions()` (empty request →
   options list) rather than free-typing a locationId.
4. Handle the response `{ outcome, receivingId, fingerprint }` — treat `applied` and
   `replayed` as success; surface `failed-precondition`/`invalid-argument` as user-facing
   errors, never raw.
5. First slice supports one `NONE`-tracked line at `expectedQuantity == receivedQuantity ==
   orderedQuantity`; SERIAL/LOT are not yet available (fail closed) — the scanner UI should
   not offer them yet.

This contract is stable and versioned by the spec; the owner integrates against it on their
own branch. **No change to `PartsScanner.jsx` is proposed or made here.**

## 5. Activation / deploy / rollback / live-verification package (Issue #15, HELD)

**Prerequisites (protected, NOT authorized here):** Blaze enabled; Owner authorization for a
Functions deploy. `inventory.stock.receive` grant to {admin, dispatcher, owner} already
merged repo-only (per DECISIONS / EI Phase-2 records).

**Deploy:** `firebase deploy --only functions:receiveInventoryStock,functions:listReceivingLocationOptions --project taylor-parts`
(the two wired callables). Do NOT blanket-deploy all functions.
**Rollback:** callables are additive and idempotent; roll back by redeploying the prior
Functions release (Firebase retains versions) or deleting the two callables. No data written
by a deploy itself; the ledger is append-only and idempotent, so a re-run is safe.
**Live verification (Owner-operated/authorized):** invoke `receiveInventoryStock` once with a
real reorder PO at `PURCHASING_IN_PROGRESS`/`ORDERED`; confirm `applied`; re-invoke with the
same `idempotencyKey` → `replayed` (no double stock); confirm the audit entry; confirm a
non-granted principal is denied. Record in DECISIONS.md.

## 6. Test & idempotency evidence

~15 repo-only suites cover the backend (`functions/test/`): receiving foundation, command,
resolver integration, callables (+ emulator), callables export, capability registration,
grant gate (+ emulator), location-options service (+ emulator), location resolver,
operational-movement ledger, receiving_orders Rules, and an E2 deployment verifier.

**Run result (repo-only, this session, base 28d695e):**
- `tsc` build ✓ (produced `lib/`), `tsc --noEmit` typecheck ✓ (exit 0).
- Receiving/ledger suites run under the **Firestore emulator** (`firebase emulators:exec
  --only firestore`, admin-SDK writes targeting the emulator): **all 10 pass** — 9 in a
  batched run, and `receiveInventoryStockCommand.test.mjs` confirmed **1/1 pass in an
  isolated fresh emulator** (batching all 10 against one shared emulator causes
  idempotency-key contention across suites — a harness artifact, not a defect; each suite
  is designed to run in its own clean emulator).
- The additional `*Emulator.test.mjs` suites + `verifyReceivingE2Deployment.test.mjs`
  require the emulator/live wiring and were validated in the prior EI Phase-2 gates
  (see DECISIONS.md / the EI Phase-2 records) — not re-run here to avoid redundant setup.
- **Idempotency specifically confirmed:** the command suite (which exercises the
  applied/replayed/conflict paths) passes cleanly against a real emulator Firestore.

## 7. Gap assessment & W3 disposition

**No material code gap found.** The receive → ledger backend is complete, typechecks,
builds, passes its suites, and is idempotent, fail-closed, governed (capability read through
the txn), and deploy-wired (`functions/src/index.ts`). Its authorization grant
(`inventory.stock.receive` → {admin, dispatcher, owner}) is merged repo-only.

**W3 disposition (per Owner direction 2026-08-05):**
> **Backend complete; activation deferred to Issue #15 (Blaze + Functions deploy, protected);
> scanner integration deferred to the parallel owner via the §4 contract.**

No code was written for W3 — the backend already exists and is sound; this package is the
evidence. Two clean handoffs remain, each its own gate:
1. **Activation** — the §5 deploy/rollback/live-verify package, gated on Blaze (#15) + Owner
   authorization. I do not deploy or enable Blaze.
2. **Scanner integration** — the §4 contract for the parallel owner of `PartsScanner.jsx`,
   which I did not touch and for which I built no competing scanner.

No deploy, no Blaze, no production, no `PartsScanner.jsx` change, no scope broadening.
