# P1 Fulfillment→Billing Spine — Implementation Spec (Owner-ratified 2026-08-13)

Governing contract: `docs/roadmaps/sales-to-cash-lifecycle-build-plan.md` (settled decisions #1–#3). Audit source: `docs/orchestration/site-work/lifecycle-audit.md`. All capabilities stay `active:false` (fail-closed) — this builds correctness before activation. No `firestore.rules` changes (all writes go through trusted Admin-SDK transactions into `sales_orders`/`fieldops_wos`/`opportunities`, which already deny direct client writes).

## Owner-ratified design choices (this session)
- **Fulfillment measurement (per line type):** PART lines → derive fulfilledQty from governed `inventorySnapshot[].qtyUsed` (the actuals P0.1 honors). EQUIPMENT_MODEL/SERVICE lines → explicit technician-declared `fulfillmentAccepted[]` at Complete (no inventorySnapshot exists for them). An explicit `fulfillmentAccepted` entry OVERRIDES the derived parts value.
- **Overage:** fulfilledQty is additive and NEVER exceeds orderedQty. If an acceptance would exceed a line's remainingQty, the write-back **fails closed** (clear error) — no silent cap, no fabrication, NO interim placeholder array. The real overage/additional-part governed path is a separate future build (decision #2). (Cannot arise in this slice: `mergeQtyUsed` clamps qtyUsed ≤ qtyPlanned, seeded from the SO line.)
- **SO-creation paths:** keep BOTH — the new governed `createSalesOrderFromOpportunity` (server-derived, hardened) AND the existing direct `createSalesOrder` (hardened separately in P1.4–1.6).
- **Build order:** P1.2 → P1.1 (coupled, one PR) → P1.3 (separate PR).

## Current-state facts (governing)
- SO line: `{kind, ref, orderedQty, allocatedQty, fulfilledQty}` (`salesOrderCommands.ts:65-102`), `fulfilledQty` init 0, never written elsewhere.
- `IN_FULFILLMENT→FULFILLED` gate = `allLinesFulfilled` (`fulfilledQty===orderedQty` per line, `salesOrderLifecycle.ts:61,72-74`).
- `createServiceForSalesOrder.ts:65,76`: `salesOrderLineRefs` = bare `string[]` (no qty/kind) — the P1.2 gap; blocks per-line write-back.
- One SO → at most one Service WO today (`createServiceForSalesOrder.ts:60-64`); design write-back ADDITIVE (forward-compatible with future multi-WO/SO, C8).
- WO Complete: `transitionWorkOrder.ts` action `Complete`→`COMPLETED` (`transitionEngine.ts`); `COMPLETED` is one-way (only →CLOSED), so Complete is structurally once-per-WO → no new idempotency key needed for write-back.
- Actuals: `WorkOrder.inventorySnapshot[] {sku,partId?,qtyPlanned?,qtyUsed?}`, written only by `updateWorkOrderExecutionData` (`mergeQtyUsed`), keyed by `sku`.
- `billingEligibility.ts:46` reads fulfilledQty and does `min(orderedQty,fulfilledQty)` for billing totals only (does not mutate) → the write-back must not pre-clamp fulfilledQty down.

## P1.2 — SO order/allocation qty → Service WO parts-plan continuity
Files: `salesOrder/createServiceForSalesOrder.ts`, `createWorkOrder.ts`, `types/workOrder.ts`.
- New shared type `SalesOrderLineRef { ref; kind; orderedQty; allocatedQty }` (home in `types/workOrder.ts`); change `salesOrderLineRefs?: string[]` → `SalesOrderLineRef[]` on the WO doc + `createWorkOrderRecord` input.
- `createServiceForSalesOrder`: build `salesOrderLineRefs` as quantity+kind-bearing objects. For PART lines (`kind==="PART"`), also seed `inventorySnapshot` `{partId: ref, qtyPlanned: allocatedQty||orderedQty, sku}` where **sku is resolved from Part Master** (mirror `setWorkOrderPartsPlan`'s resolvePart; fail closed PART_NOT_FOUND/SKU_UNRESOLVED — never fabricate sku=partId). EQUIPMENT_MODEL/SERVICE lines: `salesOrderLineRefs` entry only, no inventorySnapshot.
- Existing plain `createWorkOrder` onCall unaffected (never passes these fields). Transaction stays all-or-nothing (existing serviceWorkOrderIds guard = idempotency).
- Tests: PART+SERVICE SO → WO has 2 line-refs + 1 inventorySnapshot row (resolved sku, correct qtyPlanned); unresolvable PART ref → fail-closed, no WO; EQUIPMENT-only → line-refs populated, no inventorySnapshot.

## P1.1 — WO completion → SO fulfilledQty write-back
Files: new `salesOrder/salesOrderFulfillmentWriteBack.ts` (pure), `transitionWorkOrder.ts`, `types/workOrder.ts`.
- Pure `applyFulfillmentAcceptance(currentLines, acceptances) → {nextLines, appliedByRef, rejectedOverage?}`: additive increment of fulfilledQty per `(ref,kind)` match (NOT bare-ref — avoids the P1.7 find()-by-ref bug class); never decrements; **throws/flags fail-closed if acceptance.qty > remainingQty** (no silent cap).
- `transitionWorkOrder`, inside the existing Complete transaction, when `action==="Complete"` AND `wo.salesOrderId`: read SO (read-phase, before writes), build acceptances — PART lines from summed `inventorySnapshot.qtyUsed` (matched sku↔ref), EQUIPMENT/SERVICE from `fulfillmentAccepted[]` input (explicit override wins for PARTS too) — call the pure fn, `tx.update(soRef,{lines,updatedAt})`, stage an Audit Event (traceability, not the idempotency gate). Entirely no-op when `salesOrderId` absent.
- `TransitionWorkOrderInput` gains Complete-only optional `fulfillmentAccepted?: {ref,kind,qty}[]` (validated only for Complete).
- Idempotency: structural (COMPLETED once-per-WO via canTransition); cross-WO accumulation serializes on the shared soRef transaction conflict.
- Tests (pure): partial accumulation across two calls; over-remaining → fail-closed, never fulfilledQty>orderedQty; no `(ref,kind)` match → not applied to a wrong line. Tests (emulator): Complete on SO-linked WO with qtyUsed → matching PART line fulfilledQty += summed qtyUsed; non-SO-linked WO Complete writes no sales_orders doc; retry Complete on COMPLETED WO → failed-precondition, fulfilledQty unchanged.

## P1.3 — Governed WON → Create Sales Order action (+ builds in P1.4/1.5/1.6 for THIS path)
Files: new `opportunity/createSalesOrderFromOpportunity.ts`; register capability `opportunity.createSalesOrder` `active:false` in the permission catalog (BOTH frontend+backend mirrors + parity test — see round-4 J).
- onCall (human-invoked, NO trigger — decision #3). Input `{opportunityId, ownerEmployeeId, salesChannel, locationId?, customerPO?, idempotencyKey}` — lines/qty/account are NOT client-supplied; read from the Opportunity doc.
- Transaction: read Opportunity → verify `outcome==="WON"` (else failed-precondition) [P1.4] → verify no existing SO with `sourceOpportunityId==opportunityId` (query in-txn) [P1.5] → `buildCreateSalesOrder` (reuse as-is) with server-derived accountId+lines+sourceOpportunityId → `tx.update(opportunityRef,{salesOrderId})` [P1.6], all atomic. Opportunity line `qty` missing → fail-closed (do not default).
- Idempotency: standard idempotencyKey→audit-id replay AND the sourceOpportunityId dedup query (complementary).
- Tests: not-WON → rejected; WON no-prior-SO → SO created (correct sourceOpportunityId/account/lines) + Opportunity back-link atomic; WON with existing SO → rejected (even concurrent); key replay → replayed:true, no 2nd SO.

## Notes for the P1-harden phase (P1.4–1.8, next)
- P1.4/1.5/1.6 above are satisfied FOR the createSalesOrderFromOpportunity path. The existing direct `createSalesOrder` callable still needs the same hardening (verify/dedup/back-link) — separate items.
- P1.7 (allocateSalesOrder duplicate-ref within one call) and P1.8 (issueInvoice reads governed SO + billing eligibility) remain for the harden phase.
- Future Tier-2 flag: activating (granting) any of these capabilities is a separate Owner-gated authority step; the Rules file itself doesn't move for this build.

## Status
- P1.2+P1.1: building. P1.3: building.
