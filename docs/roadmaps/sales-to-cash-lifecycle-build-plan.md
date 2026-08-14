# Sales→Cash Lifecycle Build Plan (Owner-directed 2026-08-13)

Derived from the end-to-end lifecycle audit (`docs/orchestration/site-work/lifecycle-audit.md`). Owner directive: **do all of them, in the right order.** This doc is the GOVERNING CONTRACT for the build — every builder reads the settled decisions here first.

## Settled design decisions (do NOT re-litigate; these govern every item below)
1. **`fulfilledQty` = governed completed/accepted fulfillment, with PARTIAL fulfillment ACCUMULATED** — never inferred from allocation or dispatch. It is written by an explicit governed completion/acceptance event and adds up across partial fulfillments.
2. **Actual part OVERAGE → explicit governed exception / additional-part path** — never silently capped, clamped-away, or fabricated. If actual usage exceeds plan, that is recorded through a governed exception, not hidden.
3. **WON → makes an Opportunity ELIGIBLE for an explicit governed "Create Sales Order" action** — NOT auto-created. No Firestore trigger auto-mints the SO; a human invokes a governed action.

## Continuous build path
sell → convert → allocate → create service work → plan parts → dispatch → execute → consume actuals → complete → fulfill SO → bill → AR → equipment/custody closure

## Priority order (execute top-down; report at each phase boundary; stop before any protected boundary)

### P0 — live integrity (fix now, Tier-1, repo-only)
- **P0.1** Fix `consumeParts` (`functions/src/inventoryService.ts`) to consume the governed ACTUAL usage (`qtyUsed`) instead of blindly `qtyPlanned`, and RELEASE the unused remainder (reserved − consumed) so no reservation is stranded. Honors decision #2: do NOT fabricate/clamp overage silently — the overage (used>planned) additional-part path is a separate build (P1/own item), but consumption of actuals for used≤planned lands here and must not silently discard field-recorded usage.
- **P0.2** Add a terminal-status guard to `setWorkOrderPartsPlan` (`functions/src/workOrderPartsPlan/setWorkOrderPartsPlan.ts`) — reject plan writes when `wo.status` is terminal (COMPLETED/CLOSED/CANCELLED), mirroring the round-3 C2 `updateWorkOrderExecutionData` terminal guard.

### P1 — unblock the fulfillment→billing spine (build)
- **P1.1** WO completion → SO `fulfilledQty` write-back (governed, accumulates partials per decision #1). Wire WO completion to record accepted fulfillment against the linked SO's lines.
- **P1.2** SO allocation/order quantities → Service WO parts-plan continuity (`createServiceForSalesOrder`): carry orderedQty/allocatedQty onto the WO's parts plan so a dispatched WO has real planned parts (closes the cycle-7 documented follow-on + the data-loss-across-seam symptom).
- **P1.3** Explicit governed WON → "Create Sales Order" action (decision #3): a governed action that seeds an SO from a WON Opportunity (carrying account/lines/quantities), invoked explicitly — not auto-triggered.

### P1 — harden Sales→Cash before activation
- **P1.4** `createSalesOrder`: verify source Opportunity existence / state (WON) / account match.
- **P1.5** Prevent duplicate SO creation from one WON Opportunity.
- **P1.6** Durable Opportunity ↔ Sales Order lineage/back-link.
- **P1.7** Fix duplicate-ref allocation WITHIN one `allocateSalesOrder` call (per-ref pool decrement across sibling lines + correct write mapping).
- **P1.8** `issueInvoice`: read the governed SO and enforce billing eligibility instead of trusting client-supplied commercial facts.

### P2 — complete operational lifecycle
- **P2.1** Governed rescheduling (SCHEDULED → re-time path).
- **P2.2** Completion → billing-eligibility / billing-action producer (compute `BILL_NOW`-eligibility from completed WO / fulfilled SO).
- **P2.3** Technician-status dispatch eligibility resolved consistently across UI + server.

### P2/P3 — complete physical/customer lifecycle
- **P3.1** Completion → Equipment/custody persistence (create Equipment, link serialized asset, transfer custody on install completion).
- **P3.2** Make the Ventana exit condition (install-complete AND sale-closed) reachable from real persisted lifecycle evidence (resolves the D-5 sale-close + P1a availability signals).

## Execution notes
- Repo-only, incremental; each item = one governed build with focused tests. Worktree-isolated builders follow [[reference_worktree_fleet_shared_infra_hazard]] (no git-stash, unique emulator port, no monitor).
- STOP before protected boundaries: firestore.rules changes (Tier-2), capability grants / role changes, production deploy/Hosting/Functions, migration/prod-write, spending, identity.
- Capabilities stay `active:false` (fail-closed) — this build makes the seams correct BEFORE activation; activation itself is a separate Owner-gated step.
- Larger builds (P1.1/P1.2/P1.3, P2.2, P3.x) get a short spec grounded in the settled decisions before implementation; report at each phase boundary.

## Status
- P0: DONE (#945,#946). P1: DONE — spine #952 (P1.2+P1.1) + #947 (P1.3) + #950 (P1.4-6) + #949 (P1.7) + #951 (P1.8). Fulfillment->billing spine built, seams hardened, all active:false.
- NEXT: re-audit the built chain (10 lifecycle-seam agents) to verify P1 closed its seams + find residual/new gaps, THEN P2 (rescheduling / billing-eligibility producer / tech-status dispatch consistency).
