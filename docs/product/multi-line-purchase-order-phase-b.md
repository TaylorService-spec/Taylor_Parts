# Multi-line purchase order — Phase B decision package

**Authorized by:** Owner, 2026-08-20 (Phase B: repository inspection, compatibility design,
documentation, and pure-contract tests only).
**Baseline reconciled:** `main` at `aa986534`.
**Nothing in this package changes the live receiving command, any live write shape, Rules, indexes,
or data.**

---

## 0. Headline — the constraint is document IDENTITY, not field shape

Phase A's reconciliation reported that receiving accepts one line, one part, full quantity. That was
true and it was the *shallow* half of the problem. Reading the write path changes the design
completely:

**`reorder_purchase_orders` cannot become multi-line. Not "should not" — cannot.**

```
firestore.rules:1049   match /reorder_purchase_orders/{requestId} {
firestore.rules:1065     allow create: if (isAdminOrDispatcher() || PARTS_ASSOCIATE)
firestore.rules:1073       && request.resource.data.reorderRequestId == requestId
firestore.rules:1068       && request.resource.data.keys().hasOnly([ ...exactly 10 keys... ])
firestore.rules:1092     allow update, delete: if false;
```

Four facts, each independently decisive:

1. **The document ID *is* the reorder request ID.** A PO is not merely *about* one part — it is
   *identified by* a single-part reorder request. A multi-line PO spanning three parts has no
   reorder request to be named after.
2. **The field set is pinned by `keys().hasOnly([...])`.** A `lines[]` array cannot be added
   without a Rules change — a Phase B stop boundary and a Tier-2 gate.
3. **`allow update, delete: if false`.** The document is immutable after creation. A
   `receivedQuantity` that accumulates cannot live on it via any client path.
4. **It is client-created**, inside a client `runTransaction` (`domain/reorderPurchaseOrders.js`),
   atomically with the `reorder_requests` ORDERED transition, cross-checked both ways by
   `existsAfter`/`getAfter`. There is no server command to extend.

`domain/reorderPurchaseOrders.js` states the consequence plainly: *"the Purchase Order's document ID
IS the reorderRequestId… a second attempt at the same ID is evaluated as an `update`, which that
collection's rule denies unconditionally."* Duplicate prevention **is** the identity binding.

**And there is already a second, dormant answer.** `purchase_orders` exists — multi-line, with a
status machine — and is inert.

---

## 1. Evidence table

| Surface | Current source | Singular assumption | Multi-line impact | Compatibility risk | Required change | Phase | Test coverage |
|---|---|---|---|---|---|---|---|
| **PO creation** | `domain/reorderPurchaseOrders.js` (client `runTransaction`) | Doc id == `reorderRequestId`; one `partId`, one `orderedQuantity` | Cannot express >1 line | **None if untouched** | None — leave as legacy | — | existing client tests |
| **PO create Rules** | `firestore.rules:1065-1091` | `keys().hasOnly` 10 keys; `partId` pinned to the request's | New keys rejected | **Rules change = Tier-2 + stop boundary** | None in B/C | D+ | `partMasterRules`-style rules tests |
| **PO immutability** | `firestore.rules:1092` | `update, delete: if false` | Cumulative received qty cannot live here | Admin SDK bypasses Rules, so a *trusted* update is possible — but would break the "immutable PO" contract readers rely on | Keep immutable; accumulate elsewhere | — | — |
| **Receiving source read** | `receiveInventoryStockCommand.ts:147-158` | Reads `po.partId`, `po.orderedQuantity` | Must read lines | Live + deployed | Normalize, don't rewrite | C | emulator |
| **Receiving validation** | `receivingValidation.ts:77,87,88` | `lines.length !== 1`; expected==received==ordered | Blocks partial + multi | Live + deployed | Relax to per-line remaining | C | emulator |
| **Receipt record** | `receivingRepository.ts:53` `rcv_<sha256(idempotencyKey)>` | — | **Already receipt-identified, not PO-identified** | **None — this is the lever** | None | — | emulator |
| **Receipt status** | `receivingTypes.ts:20` created at `PUTAWAY_COMPLETE` | Single terminal write | Naming mismatch (Owner-acknowledged) | Cosmetic today | Record only | — | — |
| **Request transition** | `receiveInventoryStockCommand.ts:300-302` | ORDERED → RECEIVED unconditionally | **This is what forbids a second receipt** | Live | Transition only when fully satisfied | C | emulator |
| **Void sidecar** | `firestore.rules:1111`, `reorder_purchase_order_voids` | Append-only, id == PO id | — | None | Precedent to reuse | — | existing |
| **Dormant multi-line PO** | `procurementService.ts:59-77`, `types/procurement.ts:26-47` | None — `items[]`, `totalCost`, status machine | **Already multi-line** | Not exported → inert; no numbering; no receiving link | Candidate canonical home | C/D | none today |
| **`purchase_orders` Rules** | `firestore.rules:1271-1274` | `read: isAdminOrDispatcher`; `create/update/delete: if false` | Server-only writes already permitted | **None — trusted writes need no Rules change** | None | — | rules tests |
| **PO metadata definition** | `metadata/definitions/purchaseOrder.js:77-91` | Header states 1:1 single-part explicitly; no filters declared | Definition would need lines | Low — declarative | Update when canonical lands | D | definition contract tests |
| **PO list/detail UI** | `modules/purchasing/PurchaseOrders.jsx`, `Receipts.jsx` | Row per PO == row per part | Row per line | Low | Render lines | D | vitest |
| **Status derivation** | `domain/purchaseOrdersView.js:70-76` | PO ORDERED ⟺ request ORDERED | Partial receipt breaks the biconditional | **Medium — silent mis-labelling** | Derive from lines | C/D | pure |
| **Reads by id** | `hooks/usePurchaseOrdersByIds.js` | `documentId()` only, never `partId` | Unchanged | None | None | — | existing |
| **Reporting** | `reportCatalog.ts:94` `obj("purchaseOrder", …, "reorder_purchase_orders")` | Object bound to the legacy collection | Reports read legacy shape | Low — additive | Add canonical object later | D | catalog parity |
| **Indexes** | `firestore.indexes.json` | **Zero** composite indexes on `reorder_purchase_orders` or `receiving_orders` | New queries must avoid composites | **Index change = stop boundary** | Design queries index-free | C | — |
| **Ledger** | `operationalMovementTypes.ts:12` | `RECEIVED` exists; per-line events already staged | Already per-line | None | None | — | emulator |
| **Serialized assets** | `serializedAssetRegistration.ts` | Deterministic `(partId, serialNo)`; create *is* uniqueness | Already per-unit | None | None | — | emulator |
| **Capability** | `inventory.stock.receive` ACTIVE, granted | — | Unchanged | None | None | — | catalog tests |
| **Legacy auth surface** | `access/legacyAuthorizationSurface.ts` | `reorder_purchase_orders` catalogued | New collection needs an entry | CI-enforced | Register canonical | C | CI drift check |

---

## 2. Canonical design

### 2.1 The decision this rests on

Because identity — not field shape — is the constraint, there are only two coherent homes for a
multi-line PO, and they are not close:

| | Option | Assessment |
|---|---|---|
| **A** | Add lines to `reorder_purchase_orders` | **Not viable.** Requires a Rules change to `keys().hasOnly`, breaks `update: if false`, and cannot resolve the doc-id-is-request-id binding at all |
| **B** | **Adopt `purchase_orders` as the canonical multi-line supplier PO**, normalize `reorder_purchase_orders` into it for reads and receipts | Viable. Multi-line already; Rules already server-only-write; no Rules or index change needed |

**Recommended: B.** It is the only one that does not require crossing a stop boundary, and it uses a
collection that already exists for exactly this purpose rather than inventing a third.

What B is *not*: it is **not a second receiving service**. Receiving stays `receiveInventoryStock`,
the single trusted authority. It is not a second *inventory* or *ledger* authority either. It is one
purchasing collection replacing the identity role another cannot perform.

### 2.2 Field names, from current source

Reconciled against `types/procurement.ts` and the receiving contract. Illustrative names from the
brief are **not** adopted where source already has one.

| Brief's name | Source name | Note |
|---|---|---|
| `vendorId` | **`supplierId`** | `PurchaseOrder.supplierId`; Supplier Master is the authority. "Vendor" appears only as an *alias type* |
| `lines` | **`items`** | `PurchaseOrder.items: PurchaseOrderLineItem[]` already exists |
| `lineId` | **`lineId`** | Matches `ReceivingLineValue.lineId` |
| `orderedQuantity` | **`quantity`** on the item; `orderedQuantity` on the *receiving* contract | Kept distinct — they are different contracts |
| `state` | **`status`** | Every collection here uses `status` |
| `warehouseId` | *(defer)* | Receiving resolves a `LocationRef` at receipt time and accepts `WAREHOUSE` only. A PO-level warehouse is **not** authoritative today — see §3 |
| `unitOfMeasure` | **`stockingUnit`** | Part Master's term (`partInput.stockingUnit`). The Part is the authority; duplicating it onto the line invites drift |
| `receivedQuantity` / `remainingQuantity` | **derived, not stored** | See §2.3 |

### 2.3 Received and remaining are DERIVED, never stored on the PO

This is the load-bearing design decision.

`receiving_orders` is already identified by `rcv_<sha256(idempotencyKey)>` — **receipt identity, not
PO identity.** A PO can already have many receipt documents; what prevents it today is the
unconditional `reorder_requests` ORDERED → RECEIVED transition, not the receipt model.

So cumulative received quantity is the **sum of committed receipts**, computed from the receipt
records, not a counter mutated on the PO. That gives, for free:

- no lost update on the PO under concurrent receipts;
- no need to make an immutable document mutable;
- an auditable derivation — every quantity traces to a receipt with an actor, a timestamp, a ledger
  event and an audit id;
- **the `reorder_purchase_order_voids` precedent**: this codebase already records facts about an
  immutable PO in a separate append-only collection.

`remainingQuantity = quantity − Σ committed receipts for that line`, and it can never go negative
because over-receipt is rejected before any write (§3).

**Whether normalized fields are virtual or persisted:** virtual. Nothing is written back to a legacy
document, and the read model derives on demand.

---

## 3. Legacy compatibility — zero backfill

| Requirement | Design |
|---|---|
| **Legacy detection** | A document in `reorder_purchase_orders` **is** legacy, by collection. No sniffing, no version flag, no ambiguity |
| **Canonical one-line normalization** | `{ id: requestId, supplierId: (unresolved — see §4.2), status, items: [ { lineId, partId: po.partId, quantity: po.orderedQuantity } ] }` |
| **Deterministic legacy line id** | **`lineId = "L1"`**, fixed. A legacy PO has exactly one line by construction, so a hash adds no uniqueness and costs legibility. Deterministic across every read, every receipt and every replay |
| **Read compatibility** | Existing readers keep reading `reorder_purchase_orders` unchanged. The normalizer is *additive* — a new read path, not a replacement |
| **Write compatibility** | The legacy client write path is untouched. It keeps producing legacy documents for as long as reorder-driven purchasing exists |
| **Receipt compatibility** | A receipt names `purchaseOrderId` + `lineId`. For a legacy PO that is `(requestId, "L1")` — which is exactly what today's single-line receipt already means |
| **Status compatibility** | Legacy status stays `ORDERED`/absent. Derived line/PO state is computed, never written back |
| **Reporting compatibility** | `reportCatalog`'s `purchaseOrder` object stays bound to `reorder_purchase_orders`. A canonical object is added later, additively |
| **When migration becomes necessary** | **Never, for correctness.** Only if reorder-driven purchasing is retired and legacy documents must be folded into one collection for reporting convenience |
| **Mixed coexistence** | Permanent and expected. The normalizer is total over both shapes; nothing branches on "is this the new world yet" |

**No legacy document is rewritten during a read.** The normalizer is pure and returns a value.

---

## 4. Unresolved decisions — Owner input required before Phase C

These are purchasing **policy**, not implementation. Per the brief I am not inventing them.

### 4.1 — Line and PO state vocabulary *(blocks the state model)*

Two vocabularies exist and neither covers partial receipt:

- `PurchaseOrderStatus` = `DRAFT | APPROVED | SENT | RECEIVED | CANCELLED`
  (`VALID_TRANSITIONS`: DRAFT→APPROVED→SENT→RECEIVED, CANCELLED from any non-terminal)
- `REORDER_REQUEST_STATUS` = `… ORDERED | RECEIVED | CANCELLED | VOIDED`

Answers to the brief's questions, with what is authoritative today:

| Question | Today | Needs a decision? |
|---|---|---|
| Never received | `SENT` (PO) / `ORDERED` (request) | No |
| **Partially received** | **No state exists** | **YES** — new value, or derived-only? |
| Fully received | `RECEIVED` | No |
| Can a line be closed short? | No such concept | **YES** |
| Can a PO close with remaining quantity? | No | **YES** |
| Who approves an exception? | No authority exists | **YES** |
| Is over-receipt always rejected? | Yes — implicitly, by `receivedQuantity !== orderedQuantity` | Confirm as an explicit rule |
| Returned/rejected deliveries | `RETURNED` ledger type exists, source `RMA`; no PO linkage | **YES** |
| Reopened / amended PO | Impossible — PO is immutable, statuses terminal | **YES** |

**My recommendation, for your decision:** make partial state **derived, not stored** —
`NOT_RECEIVED | PARTIALLY_RECEIVED | RECEIVED` computed from receipts, with `CANCELLED` remaining a
real stored status. That adds no new stored vocabulary, cannot drift from the receipts, and needs no
migration. Closing short, exception approval, and amendment would then be genuinely new authorities,
best deferred to their own slice rather than smuggled into Phase C.

### 4.2 — `supplierId` on legacy documents

Legacy POs carry **`supplierName` (a string), not `supplierId`.** `reorderPurchaseOrderSupplierMigration.ts`
and `…MigrationExecute.ts` exist to resolve names to Supplier Master ids — a migration that is **not
executed** and which Phase B must not run.

So a normalized legacy PO has **no reliable `supplierId`**. Options: leave it null and honestly
un-linked; resolve opportunistically at read time (a per-read lookup — rejected, it is an N+1);
or run the existing migration (out of scope here).

**Recommendation: null, stated.** A legacy PO's supplier is a name; saying so is honest and costs
nothing that matters for receiving, which never reads the supplier.

### 4.3 — Warehouse on the PO

The brief's shape has `warehouseId` on the PO. Today, the receiving *location* is chosen at receipt
time and validated ACTIVE through the transaction. Putting a warehouse on the PO would create a
second, staler answer to "where does this go".

**Recommendation: do not add it.** Receipt-time selection is already correct and already governed.

---

## 5. Receipt model

Designed separately from the PO, as directed — and it largely **already exists**.

| Element | Source today | Change needed |
|---|---|---|
| Receipt identity | `rcv_<sha256(idempotencyKey)>` | **None** — already receipt-scoped |
| PO reference | `source.purchaseOrderId` + `source.reorderRequestId` | **None** |
| Line references | `lines[].lineId` | Must reference the *PO's* lineId (today it is receipt-local) |
| Observed quantities | `lines[].receivedQuantity` | **None** |
| Serialized identities | `lines[].serialNumbers[]`, exactly `receivedQuantity` distinct | **None** |
| Warehouse | `receivingLocation: LocationRef` | **None** |
| Actor | server-derived `ReceivingActor` | **None** |
| Timestamps | server-authored | **None** |
| Idempotency | key → deterministic id + fingerprint | **None** |
| Payload hash | `fingerprint` | **None** |
| Ledger/audit refs | `RECEIVED` per line + one audit event | **None** |
| Replay | `applied` / `replayed` | **None** |

**Multiple receipts over time need exactly one behavioural change:** stop transitioning the reorder
request to `RECEIVED` unconditionally, and transition only when every line is satisfied. That is a
Phase C change to `receiveInventoryStockCommand.ts:300-302` and nothing else.

---

## 6. Migration and rollback

| | |
|---|---|
| **Zero-backfill plan** | The normalizer is total over both shapes. No document is read-repaired, rewritten, or version-stamped |
| **Optional later canonicalization** | Only if reorder-driven purchasing is retired. Would copy legacy POs into `purchase_orders` preserving `id`, with `lineId "L1"` — deterministic, therefore re-runnable |
| **Dry-run** | Mandatory: report affected population and per-document normalization *without writing*, matching `reorderPurchaseOrderSupplierMigration.ts`'s existing analyse/execute split |
| **Affected population** | Every `reorder_purchase_orders` document. Exact count is a **live read** — not taken in Phase B |
| **Fingerprint / drift** | Reuse the receiving fingerprint discipline: hash the normalized value; a changed fingerprint between dry-run and execute aborts |
| **Rollback** | Nothing to roll back while zero-backfill holds — no legacy document is modified. For the optional canonicalization: canonical documents are additive and deletable; legacy remains authoritative until explicitly retired |
| **Counter / index implications** | **No composite index exists on either collection and none is required.** Derivation reads receipts by `source.purchaseOrderId` — a single-field equality query, deliberately, so no index is needed. No numbering counter is introduced; a canonical PO keeps the legacy id |
| **Deployment order** | 1) normalizer + derivation (pure, inert) → 2) receiving reads through the normalizer, behaviour unchanged for single-line → 3) partial receipt enabled → 4) UI. Each independently revertible |
| **Mixed client/server** | An old client sends today's single-line payload, which stays valid — the normalizer's one-line case *is* the legacy case. A new client against an old server fails closed on the unknown shape rather than partially applying |

---

## 7. Phase C — exact scope

**In scope**

1. Pure normalizer: legacy PO → canonical one-line; canonical PO → itself.
2. Pure derivation: cumulative received, remaining, line state, aggregate PO state from receipts.
3. `receiveInventoryStockCommand` reads its source **through the normalizer** (no behaviour change
   for a legacy single-line full receipt).
4. Per-line validation against **remaining**, not ordered: partial permitted, over-receipt rejected.
5. Accept ≥1 line, all lines belonging to the named PO; unknown or duplicate `lineId` rejected.
6. Transition the request only when every line is satisfied.
7. Truthful per-line receipt.
8. All-or-none per PO receipt. A blocked line fails the batch and is named.

**Out of scope** — multi-PO atomic receiving; put-away; location registry; new ledger events; Rules;
indexes; deployment; grants; migration execution; anything in §4 that is still undecided.

---

## 8. Risk register

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | Rules `keys().hasOnly` blocks any legacy PO field addition | **High** | Design adds nothing to legacy documents |
| R2 | Partial receipt breaks `purchaseOrdersView`'s PO⟺request biconditional, mis-labelling a partially-received PO | **High** | Derive from receipts; pure tests pin it; UI is Phase D |
| R3 | Concurrent receipts double-count | **High** | Derived-not-stored; existing per-line ledger idempotency; all-or-none |
| R4 | Legacy `supplierName` has no id | Medium | §4.2 — null and stated; migration exists but is not run |
| R5 | Adopting `purchase_orders` reads as "a second PO authority" | Medium | Legacy stays authoritative for reorder-driven purchasing; canonical is a read/receipt target, not a competitor |
| R6 | `PUTAWAY_COMPLETE` implies physical put-away it cannot prove | Medium | Owner-acknowledged; recorded, not relied upon |
| R7 | A derivation query needs a composite index | Medium | Single-field equality by design; verified none exists today |
| R8 | An undecided §4 policy gets assumed during Phase C | **High** | Phase C is blocked on §4.1 |
| R9 | `legacyAuthorizationSurface` drift check fails on a new collection | Low | CI-enforced; register in Phase C |

---

## 9. What Phase B did not do

No Rules change. No index change. No live write-shape change. No change to
`receiveInventoryStock`. No deployment, grant, activation, or migration. `PART_IDENTIFIER_TRANSPORT_READY`
untouched. No new ledger event. No location or put-away authority.

**Phase C is blocked on §4.1** (partial-receipt state vocabulary) and should not begin until it is
answered.
