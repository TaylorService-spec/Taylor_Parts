# Lifecycle Audit — Pass 4 (post missing-part fixes) — 2026-08-14

10 read-only agents re-audited the sale→delivery chain after the fixes #962 (missing-part / write-back qtyUsed??qtyPlanned = completion accepts planned, Owner Option A), #963 (allocation netting kind-scope), #964 (WON per-line qty), #965 (CI wiring + 3 stale-test fixes). Prior: `lifecycle-reaudit-post-p1.md`.

## HEADLINE: the capstone is UNCONDITIONALLY CLOSED for the normal (single-line) PART path ✅
A4-9 (definitive) + A4-6 traced end-to-end on REAL code: `SO.ref=partId → WO.inventorySnapshot.partId → acceptance.ref → SO line (ref,kind) match` is consistent; a completed PART-line WO (with or without recorded qtyUsed) credits `fulfilledQty`, auto-advances IN_FULFILLMENT→FULFILLED, and becomes billing-eligible with no manual step. Override path, multi-WO additive accumulation, overage fail-closed all confirmed. The core P1 goal is achieved.

Clean verifications: A4-1 (WON qty fully closed), A4-3 (allocation netting complete), A4-5 (write-back sound, no regression), A4-7 (equipment isolated), A4-8 (invoice conservation holds, no over-bill).

## New findings — two themes

### Theme A: credit-outruns-physical-inventory (consequence of Option A)
- **A-1 (HIGH) — BD-14 × #962: fulfillment credited for un-allocated parts.** BD-14 (WO creatable before allocation → `qtyPlanned = orderedQty` unbacked) was deferred as visibility-only. But #962's restored fallback now credits that unbacked `qtyPlanned` straight into `fulfilledQty` at Complete → an SO line can reach FULFILLED/billable for a PART never allocated, never reserved, and that may fail to consume (shortfall logged+swallowed). Upgrades BD-14 to a billing-integrity gap. Files: `createServiceForSalesOrder.ts:77`, `transitionWorkOrder.ts:254-262`, `inventoryService.ts`. **DECISION: close BD-14 (gate Service/WO creation on allocation having run so qtyPlanned is always backed) or accept the divergence.**
- **A-2 (MED) — fulfilled-credit outruns async consumption.** The `fulfilledQty`+FULFILLED write commits synchronously in the Complete txn; `consumeParts` runs post-commit and can still fail (reservation shortfall) → SO FULFILLED/billable but ledger never decremented (only `retryNeeded`). Distinct from the already-FIXED ledger-detection entries (#914/#916) which cover on-hand visibility, not the SO-billing-ahead angle. Files: `transitionWorkOrder.ts:273-306`, `inventoryService.ts`.

### Theme B: duplicate-ref same-kind PART lines (a SUPPORTED/tested scenario — P1.7/BD-6/BD-10)
Root cause: `createServiceForSalesOrder` (P1.2) seeds ONE `inventorySnapshot` row per SO line with no per-partId dedup, but two downstream consumers assume ≤1 row per (kind,ref).
- **B-1 (HIGH) — reserveParts over-reserves.** `reserveParts` computes `availabilityByPart` once per sku, then checks EACH row against the same un-decremented value (doesn't sum qtyPlanned across rows sharing a sku). Two duplicate-ref PART lines (qtyPlanned 5 each) → reserves 10 against a 5-unit pool → RESERVED exceeds on-hand, can drive on-hand negative. Compounded by BD-14 (BACKORDERED sibling still gets qtyPlanned=orderedQty). Files: `inventoryService.ts:130-148`, `createServiceForSalesOrder.ts:62-79`.
- **B-2 (HIGH) — write-back false-overage DEADLOCK.** `transitionWorkOrder` sums a WO's PART rows into one acceptance per partId; `applyFulfillmentAcceptance` matches by `(ref,kind)` via `findIndex` (FIRST match only), NOT lineId — so the SUMMED qty is checked against only the FIRST SO line's remainingQty and throws false OVERAGE. Complete is terminal/non-retriable (Option A) → the WO can NEVER complete. Same class BD-4 fixed for invoices via lineId; the write-back core was never converted. Files: `salesOrderFulfillmentWriteBack.ts:74`, `transitionWorkOrder.ts:251-263`. **Fix: match the write-back by lineId (carry lineId through salesOrderLineRefs/inventorySnapshot), mirroring the invoice #960 lineId fix; and/or dedupe/aggregate by partId consistently.**

### Minor
- **M-1 (LOW) — OPP-QTY-INT.** #964 requires line `qty>0` but not INTEGER, while SO creation requires integer `orderedQty` (`posInt`) → a WON Opportunity with a fractional qty (2.5) is a new permanent dead-end. One-liner: add `Number.isInteger` to the two Opportunity-side qty checks.

## Known-seams (intentional, re-confirmed): billing-eligibility `operationalBlocked`/`additionalWorkPending` read-but-never-written (defaults permissive, Finance greenfield); BD-13 (raw CONFIRMED→IN_FULFILLMENT write, harmless); P2.1 reschedule; P2.2 BILL_NOW producer; P2.3 tech-status; P3.x equipment/Ventana.

## Recommendation
The capstone is closed for the common case — the spine works. The next fixes: **B-1/B-2 (duplicate-ref: lineId matching + per-partId aggregation)** are clear bug-fixes (B-2 is a hard deadlock for multi-same-part SOs). **A-1/A-2 (credit-vs-physical)** need the BD-14 decision (gate on allocation) + an async-consume→SO reconciliation stance. **M-1** integer-qty is a one-liner. All repo-only, active:false.
