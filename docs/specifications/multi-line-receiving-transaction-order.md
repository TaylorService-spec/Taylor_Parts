# Multi-line receiving — transaction order and concurrency proof

**Required by:** Phase C authorization §D — "Before writing code, document every Firestore read and
write in exact order."
**Baseline:** `main` at `87fe2c97`.
**Status:** design of record for `receiveInventoryStock`'s Phase C evolution.

---

## 1. The concurrency question, answered before anything else

§D ends: *"If Firestore query/transaction behavior cannot guarantee concurrency safety, stop and
present the conflict rather than adding a best-effort check."* Assertion 20 requires that concurrent
receipts cannot exceed remaining quantity.

**The naive design is genuinely unsafe, and it must be said plainly.**

Remaining quantity is derived by reading prior receipts. In Firestore, a **query inside a
transaction does not lock the predicate** — there are no predicate locks and no phantom protection.
Two concurrent receipts against one PO line with 5 remaining would each query prior receipts, each
fail to see the other's uncommitted receipt, each compute `remaining = 5`, each validate, and both
commit. **10 received against 5 ordered.**

No amount of re-reading or re-checking inside the transaction fixes this. The query is the wrong
instrument.

### The proof that does work

Firestore transactions are optimistic: the commit **aborts** if any document *read* in the
transaction was modified by another committed transaction in the meantime. That is a document-level
guarantee, and it is exactly strong enough — provided every competing receipt touches one common
document.

So **every canonical receipt reads AND writes the purchase-order document.**

```
T1: read PO@v3 → query receipts → remaining 5 → validate 5 → write receipt + write PO@v4 → COMMIT
T2: read PO@v3 → query receipts → remaining 5 → validate 5 → write receipt + write PO@v4 → ABORT
    (PO changed since read) → RETRY
T2': read PO@v4 → query receipts (now sees T1's committed receipt) → remaining 0
     → validate 5 → REJECTED, over-receipt
```

The query never had to be safe. The **PO document is the serialization point**, and correctness comes
from the document-level guarantee Firestore actually offers rather than from the predicate-level one
it does not.

The write is a `version` increment plus `updatedAt` — **never a cumulative received quantity**
(Phase C decision 2 forbids storing that). A monotonic version is a concurrency token, and §B asks
for `expectedVersion` preconditions anyway.

`purchase_orders` is `allow create, update, delete: if false` in `firestore.rules:1272` — Admin-SDK
only. A trusted write needs **no Rules change**.

### Legacy is already safe, by a different mechanism

Legacy `reorder_purchase_orders` receipts stay **full-quantity only** (unchanged behaviour). Their
serialization already exists: the command reads *and writes* `reorder_requests` (ORDERED → RECEIVED),
so two concurrent legacy receipts conflict on that document today. Nothing about legacy changes, and
its `allow update: if false` immutability is preserved — **the legacy PO document is still never
written.**

**Partial receipt is a canonical-PO capability only.** That is not a limitation smuggled in; it
follows from the legacy document being immutable by contract.

---

## 2. Authority discrimination — no ambiguous lookup

§C forbids ambiguous collection lookup. The request already carries the discriminator:

```
RECEIVING_SOURCE_TYPES = ["REORDER_PURCHASE_ORDER"]        // today
                       + ["PURCHASE_ORDER"]                 // Phase C
```

`source.type` is explicit, validated against a closed set, and fails closed on anything else. There
is no sniffing, no "try one collection then the other", and no path where a request could reach the
wrong authority.

| `source.type` | Collection | Partial receipt | PO document written |
|---|---|---|---|
| `REORDER_PURCHASE_ORDER` | `reorder_purchase_orders` | **No** — full only | **Never** (immutable) |
| `PURCHASE_ORDER` | `purchase_orders` | **Yes** | version + status |

---

## 3. Exact read/write order

Firestore requires all reads before any write. The existing command already buffers every write and
flushes at the end; Phase C keeps that structure and inserts its reads into the read phase.

### READ PHASE — in order

| # | Read | Purpose | Notes |
|---|---|---|---|
| R1 | `deps.authorize(txn, actor, "inventory.stock.receive")` | Capability, commit-time authoritative | Read through the txn so a concurrent revocation conflicts the commit |
| R2 | PO document — `purchase_orders/{id}` **or** `reorder_purchase_orders/{id}` | The order being received | Chosen by `source.type` (§2). **This read is the concurrency anchor for canonical.** |
| R3 | `reorder_requests/{id}` | Legacy linkage + status | **Legacy only.** Canonical POs have no reorder request |
| R4 | Prior committed receipts — `receiving_orders where source.purchaseOrderId == {id}` | Cumulative received per line | **Canonical only.** Single-field equality — **no composite index required.** Unsafe alone; made safe by R2+W5 (§1) |
| R5 | Part authority, per distinct `partId` | Active + tracking mode | Existing `deps.resolvePart`, once per part, deduplicated |
| R6 | Destination location | ACTIVE warehouse | Existing `deps.resolveLocationActive`; unchanged |
| R7 | Receiving-order idempotency document | Replay detection | Existing |
| R8 | Ledger idempotency documents, per line | Per-line replay | Existing |
| R9 | Serialized-asset documents, per serial | Identity conflict | Existing; `create` is the uniqueness check |
| R10 | Receiving-order number counter | Reference allocation | Existing; **read-then-write, so it is a write boundary** — allocated only on a genuine apply, never on replay |

### VALIDATION — after all reads, before any write

| # | Check | Failure |
|---|---|---|
| V1 | Request shape, exact keys, closed source type | `SOURCE_NOT_RECEIVABLE` |
| V2 | PO exists and is receivable (`SENT`/`APPROVED` canonical; `ORDERED` legacy) | `SOURCE_NOT_RECEIVABLE` |
| V3 | `expectedVersion` matches (canonical) | `VERSION_CONFLICT` |
| V4 | Every submitted line belongs to the PO | `RECEIPT_LINE_UNKNOWN` |
| V5 | No duplicate submitted line id | `RECEIPT_LINE_DUPLICATE` |
| V6 | Quantity is a positive finite number | `RECEIPT_QUANTITY_INVALID` |
| V7 | Quantity ≤ **remaining** (never ordered) | `RECEIPT_OVER_RECEIPT` |
| V8 | Line not already satisfied | `RECEIPT_OVER_RECEIPT` |
| V9 | Serial count == quantity, all distinct | `RECEIPT_SERIAL_*` |
| V10 | Part active, tracking mode supported | `PART_INVALID` |
| V11 | Destination ACTIVE | `DESTINATION_INVALID` |

**Any failure throws before the first write.** Assertions 21 and 22 depend on this ordering, not on
cleanup.

### REPLAY — before allocation, before writes

If the receiving-order idempotency document exists **and** every ledger effect agrees, return the
prior result. **No counter is allocated and nothing is written on a replay** (§D.6).

Same key + different target or payload → fails closed on fingerprint mismatch.

### WRITE PHASE — buffered, flushed at commit

| # | Write | Condition |
|---|---|---|
| W1 | Receiving-order number counter | Apply only |
| W2 | `receiving_orders/{rcv_hash}` — immutable receipt | Apply only |
| W3 | `inventory_transactions` — one `RECEIVED` per line | Apply only. **No new ledger vocabulary** |
| W4 | `serialized_assets` — one per serial, `create` | Apply, SERIAL lines only |
| W5 | **`purchase_orders/{id}` — `version` + `updatedAt`, and `status`→`RECEIVED` iff every line has zero remaining** | **Canonical only. Required on EVERY canonical receipt — this is what makes §1's proof hold.** A partial receipt leaves `status` at `SENT` |
| W6 | `reorder_requests/{id}` — ORDERED → RECEIVED | **Legacy only** |
| W7 | `auditEvents/{id}` — one immutable event | Apply only |

**The legacy PO document is written at no point.** Its immutability contract is intact.

---

## 4. Derived vs stored, kept apart

| Concept | Where | Values |
|---|---|---|
| **Derived receiving progress** | computed from receipts, never stored | `NOT_RECEIVED` / `PARTIALLY_RECEIVED` / `RECEIVED` |
| **Stored procurement lifecycle** | `purchase_orders.status` | `DRAFT` / `APPROVED` / `SENT` / `RECEIVED` / `CANCELLED` |

A partial receipt moves the **derived** state to `PARTIALLY_RECEIVED` and leaves the **stored**
status at `SENT`. Stored `RECEIVED` is written only when every line has zero remaining.

---

## 5. Reconciliation finding — `procurementService` must NOT be exported as-is

§A says make the canonical authority available through a trusted boundary, and **"do not broaden
authority merely because the service is being exported."**

`functions/src/procurementService.ts` has **zero** capability enforcement, **zero** audit, **zero**
idempotency, and takes **no actor** — verified by grep: no `capability`, `audit`, `idempotenc`,
`actorUid`, or `resolveEffectiveAccess` anywhere in the file.

Exporting `createPurchaseOrder` or `updatePurchaseOrderStatus` as callables would give any
authenticated caller an ungoverned endpoint to mint and advance purchase orders. That is the exact
broadening §A forbids.

**Phase C therefore exports no purchasing write.** What it does instead:

- **Receiving reads** `purchase_orders` inside the already-governed receiving transaction, which
  enforces `inventory.stock.receive`, audits, and is idempotent.
- **The PO lifecycle write (W5) happens inside that same governed transaction**, so it inherits the
  capability, the audit event, and the idempotency — rather than being a new ungoverned surface.

**Recorded as future work:** governed `createPurchaseOrder` / `approvePurchaseOrder` /
`sendPurchaseOrder` commands, each needing an actor, a capability, an audit event and an
idempotency key before any callable is exported. Until then a canonical PO can only be created by a
trusted server-side caller, which is the correct fail-closed position.

---

## 6. What this design does not do

No Rules change. No index change (R4 is single-field equality by construction). No new ledger
vocabulary. No location or bin authority. No close-short. No amendment. No returns. No supplier
migration. No second receiving service — one core, two transports (§G).

---

## 7. A locking fact found by running it in CI

The derivation read (R4) is a **transaction query** over `receiving_orders`. In the Firestore
**emulator**, transaction locking is coarser than production: that query contends with any other
suite writing the same collection. It surfaced as `ABORTED: Transaction lock timeout` in the
*serialized-asset* suite running after the canonical one in the same job — **not** as a failure of the
canonical assertions, which passed.

Two things follow, and they are different:

- **In CI**, the canonical suite runs in its **own job with its own emulator**. That removes the
  cross-suite contention, and it also makes the concurrency assertions trustworthy: they must contend
  with *each other*, not with an unrelated suite.
- **In production**, Firestore takes locks on the documents an indexed equality query actually reads.
  `where source.purchaseOrderId == X` reads only that order's receipts, so contention is bounded per
  purchase order rather than per collection. That bound is a property of the query being a
  single-field equality — the same property that keeps it index-free — so it is worth preserving if
  the derivation is ever extended.

This does not change the §1 proof. Correctness never depended on the query's locking behaviour; it
depends on the purchase-order document being read and written by every competing receipt.
