# Lifecycle Re-Audit (post-P1) — 2026-08-14

10 read-only agents re-audited the sale→delivery chain AFTER the P0/P1 build (PRs #945–952), verifying each seam's new code and hunting build defects/regressions. Prior audit: `lifecycle-audit.md`. Spec: `docs/design/p1-fulfillment-billing-spine-spec.md`.

**Headline: the P1 spine passes CI but does NOT actually work for PART lines** — an identity-key mismatch makes the fulfilledQty write-back a silent no-op for parts (the majority kind). Found independently by TWO auditors (invoice + conservation). CI was green because the one emulator test's fixture coincidentally used `ref === sku`. This is why audit-after-build matters.

## P0-URGENT build defects (P1 is incorrect until these land)
- **BD-1 (CRITICAL, corroborated ×2) — partId/sku identity mismatch.** `transitionWorkOrder.ts:238-245` derives PART fulfillment acceptances keyed by `item.sku` (internalPartNumber), but SO PART lines key on `ref === partId` (`createServiceForSalesOrder.ts`; `types/workOrder.ts`: "never sku = partId"). `applyFulfillmentAcceptance` matches strictly on `(ref,kind)` → PART acceptances always land in `unmatched`, silently dropped. → `fulfilledQty` for parts never advances → `IN_FULFILLMENT→FULFILLED` and billing eligibility wedge forever. The emulator test masks it (fixture `ref==='IPN-1'`==`sku`). **Fix:** key PART acceptances by `partId` (matching the SO line), AND use `qtyUsed ?? qtyPlanned` fallback (subsumes BD-9), AND fix the test to use real `partId ≠ sku`. Files: `transitionWorkOrder.ts`, `salesOrderFulfillmentWriteBackEmulator.test.mjs`.
- **BD-9 — consumeParts vs write-back unset-qtyUsed divergence.** consumeParts consumes `qtyUsed ?? qtyPlanned` (unset→planned) but the write-back treats unset qtyUsed as 0 (skip) → inventory depletes while fulfilledQty stays 0. Folded into BD-1's fix (same `?? qtyPlanned` fallback). File: `transitionWorkOrder.ts` / `inventoryService.ts`.
- **BD-7 — P1.1 write-back tests not in CI.** `salesOrderFulfillmentWriteBack.test.mjs` + emulator variant are wired into no workflow (path filters miss them). **Fix:** wire into the sales-order/work-order workflow + package.json script. (Would have caught BD-1 IF the test were meaningful — so BD-1's test fix is also required.)

## HIGH build defects
- **BD-2 — SO state never advances (dead-end moved one step).** After BD-1 is fixed and fulfilledQty accumulates, nothing calls `transitionSalesOrder` to advance `IN_FULFILLMENT→FULFILLED` (zero callers, zero UI). Billing is unblocked (eligibility reads fulfilledQty, not state), but `SO.state` sits at IN_FULFILLMENT forever. **DECISION NEEDED:** auto-advance within the Complete transaction when `allLinesFulfilled` becomes true, vs a separate explicit governed producer (sibling of P2.2). Files: `transitionWorkOrder.ts` (if auto) or new producer.
- **BD-3 — issueInvoice duplicate billing (no billed-qty tracking).** `issueInvoice` caps `billableQty` at `min(orderedQty,fulfilledQty)` but never writes billed qty back to the SO; a 2nd call with a different idempotencyKey re-bills already-billed qty. **Fix:** track/decrement invoiced qty on the SO (new `billedQty`/`invoicedQty` per line) and enforce against it. Files: `invoiceCommands.ts`, `invoiceCallables.ts`, `salesOrderCommands.ts` (schema).
- **BD-4 — issueInvoice SO-line lookup by bare ref (no kind).** `soLinesByRef = new Map(so.lines.map(l=>[l.ref,l]))` — same-ref cross-kind lines collide (the exact P1.7 bug class, reintroduced in P1.8). Money-conservation break at billing. **Fix:** match by `(ref,kind)`. File: `invoiceCommands.ts`.
- **BD-5 — direct createSalesOrder no line fidelity.** P1.4-6 verifies WON/account/dedup but not that client `lines` match the Opportunity → lineage forgeable with unrelated lines. **Fix:** when `sourceOpportunityId` set, cross-validate lines vs the Opportunity. File: `salesOrderCallables.ts`.
- **BD-6 — duplicate-ref SERVICE lines wrongly pooled.** `Object.fromEntries` keeps-last + P1.7's per-ref decrement wrongly constrains SERVICE (should be unconstrained) → false PARTIAL/BACKORDERED, order-dependent. **Fix:** don't apply pool decrement to SERVICE. Files: `allocateSalesOrder.ts`, `allocationProjection.ts`.
- **BD-8 — Opportunity can reach WON with zero lines → permanent dead-end.** `createOpportunity` defaults `lines:[]`, WON transition never checks line count; then P1.3's derive throws forever, no reopen. **Fix:** require ≥1 line to reach WON (or at create). Files: `opportunityCommands.ts`/`opportunityLifecycle.ts`.

## MED
- **BD-4b — issueInvoice duplicate-ref within one call over-bills** (per-line eligibility checked independently, not accumulated). Fold into BD-4/BD-3 fix. File: `invoiceCommands.ts`.
- **BD-10 — availability pool keyed by ref not (kind,ref).** Latent (masked by equipment=UNKNOWN); close before equipment availability activates. Fold into BD-6. Files: `allocateSalesOrder.ts`, `allocationProjection.ts`.
- **BD-11 — createSalesOrderFromOpportunity idempotency not scoped to opportunityId.** Reused key across two opps returns mislabeled result. Inherited pattern; scope the audit id by opportunityId. File: `createSalesOrderFromOpportunity.ts`.
- **BD-13 (intentional) — CONFIRMED→IN_FULFILLMENT raw tx.update bypasses governed transition.** Asymmetric with BD-2's governed leg; reconcile when BD-2 is built. File: `createServiceForSalesOrder.ts`.
- **BD-14 (intentional) — qtyPlanned = orderedQty when allocatedQty=0.** WO creatable before allocation runs → bypasses netted allocation. Accept or gate on allocation. File: `createServiceForSalesOrder.ts`.

## LOW
- **BD-15 — coordinatedVisit/coordinatedFieldMission stale `string[]` typing** for salesOrderLineRefs (P1.2 changed runtime shape to objects). Harmless pass-through; fix typing. Files: `coordinatedVisit.ts`, `coordinatedFieldMission.ts`.

## Verified SOLID (no regressions)
P0.1 consumeParts release logic (in isolation), P0.2 setWorkOrderPartsPlan terminal guard, P1.2 sku-resolution/fail-closed + EQUIPMENT/SERVICE exclusion, P1.3 WON/dedup/backlink referential integrity, P1.7 duplicate-ref PART allocation, P1.8 minor-units arithmetic, tech-lock concurrency, completion→equipment isolation (unentangled). Known-seams (P2.1 reschedule, P2.2 billing producer, P2.3 tech-status, P3.x equipment/Ventana) re-confirmed intentional.

## Recommended fix order
1. **BD-1 (+BD-9, +BD-7 test-and-wire)** — makes P1 actually work for parts. Blocking everything downstream.
2. **BD-2** — needs the Owner decision (auto-advance vs producer), then build.
3. **BD-3/BD-4/BD-4b** — invoice conservation (duplicate billing + kind-aware match).
4. **BD-5, BD-6/BD-10, BD-8** — line fidelity, service pooling, zero-line dead-end.
5. **BD-11, BD-13, BD-14, BD-15** — MED/LOW cleanups.
