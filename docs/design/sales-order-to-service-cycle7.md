# Sales Order → Service / Dispatch (Cycle 7)

Status: **BUILT (repo-only, fail-closed, undeployed/ungranted).** A committed Sales Order creates governed
Service demand through the **existing** Work Order authority — never by writing Work Order state directly.

## Authority boundary (Owner C7)
- **Sales Order** owns commercial commitment, ordered quantities, fulfillment requirement.
- **Work Order / Service** owns field execution; **Dispatch** owns scheduling/assignment.
- The Sales Order does **not** author Work Order state, technician/truck assignment, or the dispatch schedule.
  `createServiceForSalesOrder` (capability `salesOrder.service`, active:false) produces a Work Order via the
  **governed Work Order core** (`createWorkOrderRecord`, extracted from the `createWorkOrder` callable — ADR-009,
  behavior-identical for the callable), so both paths create Work Orders through the same authority. Dispatch/
  Scheduling then pick the Work Order up through their own governed surfaces.

## Demand lineage — the no-double-count invariant (Owner C7)
A Work Order created to fulfill a Sales Order carries **`salesOrderId`** (+ `salesOrderLineRefs`); the Sales
Order records the resulting `serviceWorkOrderIds`. Trace is bidirectional: SO line → allocation → Work Order →
reservation/consumption.

**The same parts demand is counted ONCE, by origin.** `allocateSalesOrder`'s ATP =
`eligible ON_HAND − open WO reservations − other active SO allocations`, where **open WO reservations now
EXCLUDE reservations from Work Orders linked to an active Sales Order** (`openWorkOrderReserved(rows,
excludeWorkOrderIds)`; the callable reads the SO-linked WO ids). So an SO-origin unit is counted via the Sales
Order allocation and **not again** via its derived Work Order's reservation. Standalone (non-SO) Work Order
reservations still count. Proven by `demandLineage.test.mjs`: SO allocates PRT-1001×2, its WO reserves 2 ⇒
total committed = **2, not 4**.

This preserves lineage **without a competing inventory authority** — allocation is recorded only on
`sales_orders`; the Work Order reservation lives in the existing WO-keyed inventory ledger; the lineage link
(`salesOrderId`) is what keeps them from double-counting.

## Parts / service path (equipment stays honest)
Parts and service flow end-to-end (allocate → create Service). Serialized-equipment availability remains
UNKNOWN / fail-closed (equipment-availability contract) — the SO→Service seam does not pretend equipment is
allocated; it creates the coordinated Service Work Order and the equipment lines surface their honest
dependency.

## Files
`createWorkOrder.ts` (extract `createWorkOrderRecord` core + optional `salesOrderId` lineage) ·
`salesOrder/createServiceForSalesOrder.ts` (the seam) · `fulfillment/fulfillmentAvailability.ts` +
`allocateSalesOrder.ts` (lineage exclusion) · index export · permissionCatalog (both mirrors)
`salesOrder.service` active:false · resolver A3 allowlist · tests `demandLineage` (3) + fulfillment (13) · CI.
No Rules change. Protected activation (`salesOrder.service` grant · deploy) stays Owner/operator-gated.

## Not built here / next
C7 creates ONE coordinated Work Order per Sales Order; **C8** assesses multi-equipment coordination
(per-equipment accountability + one coordinated visit) — first testing whether existing Work Order
relationships (a parent/coordination link) suffice before inventing any Job/Visit authority. Wiring the Work
Order's parts plan to the released SO quantities (so the WO reserves exactly the SO-origin parts at dispatch)
is a natural follow-on; the lineage link already makes it non-double-counting.
