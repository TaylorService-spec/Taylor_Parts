# Assessment — Multi-Equipment Coordination (Cycle 8, roadmap #14)

Owner-directed assessment: can EOS give **per-equipment accountability** for a multi-unit order (e.g. C713×5)
while delivering **one coordinated customer visit**, using **existing** authorities — before inventing any
Job / Visit / WorkOrderGroup authority (§8, register #14)? **Conclusion: yes — the Sales Order is the
coordinator; no new canonical authority is required today.**

## The coordination question
`C713 × 5` = ONE Sales Order · ONE line (qty 5) — commercially. Operationally the business wants five
independently accountable equipment executions AND (where the real visit supports it) one coordinated
delivery/install. The tension the Owner flagged: preserve per-unit accountability *without* forcing five
independent schedules / truck-loads / visits / context re-entries.

## Existing relationships that already coordinate (established in Cycle 7)
1. **`salesOrderId` on the Work Order** (C7 demand lineage) — every Work Order created to fulfill a Sales
   Order carries it. **A set of Work Orders sharing one `salesOrderId` IS a coordinated group** with no new
   authority: the Sales Order is the parent/coordination link.
2. **Shared customer + location** — a Sales Order's `accountId` + `locationId` flow onto every derived Work
   Order, so the group already shares customer and site context (no re-entry).
3. **Scheduling/Dispatch surfaces already exist** — the weekly Scheduling workspace + Dispatcher board operate
   over Work Orders; a coordinated visit = the SO-grouped Work Orders sharing a scheduled window /
   technician / truck, surfaced by grouping on `salesOrderId`. No second scheduling model.
4. **Per-Work-Order execution + completion + exception** already exist (Work Order lifecycle) — so per-unit
   accountability is native: **one Work Order per serialized unit**, each with its own execution/completion/
   exception/history, all sharing the `salesOrderId`.

## Recommended model (no new authority)
```
Sales Order  (commercial: 1 line, qty 5)
   │  salesOrderId (coordination link)
   ├── Work Order — unit A   (own execution/completion/exception/history)
   ├── Work Order — unit B
   ├── … (one per serialized unit)
   coordinated by: shared salesOrderId + customer + location + (shared scheduled window / tech / truck)
```
- **Per-equipment accountability** = one Work Order per serialized unit, each independently executed/completed.
- **One coordinated visit** = the `salesOrderId`-group surfaced together in Dispatch/Scheduling with a shared
  window/technician/truck (a grouping/read concern over existing Work Orders — not a new object).
- **Partial completion is native**: 4 units' Work Orders COMPLETE + 1 BLOCKED ⇒ the SO reads 4/5 fulfilled,
  ATTENTION — no fake whole-visit COMPLETE/INCOMPLETE. The SO's `serviceWorkOrderIds` + each WO's status give
  the honest rollup.

## What blocks the *implementation* (not the model)
Creating **one Work Order per serialized unit** requires knowing **which serialized assets** fulfill the line
— i.e. the **serialized-equipment allocation**, which is the parallel dependency
(`equipment-availability-contract-assessment.md`: availability substrate not-yet-connected + ordered-model↔
serial mapping unresolved). Until that lands, `createServiceForSalesOrder` creates **ONE coordinated Work
Order per Sales Order** (C7); per-unit expansion activates when serialized allocation does. **The coordination
authority question is settled now (no new authority); only the per-unit fan-out waits on the equipment
foundation.**

## Decision
**Do NOT invent a Job / Visit / WorkOrderGroup authority.** The Sales Order (`salesOrderId` link) + shared
customer/location + existing Scheduling/Dispatch are sufficient to coordinate per-equipment Work Orders. Should
future evidence show these genuinely cannot express a required coordination fact, return with evidence/options
then — not preemptively. Coordinated-visit *scheduling* (shared window/tech/truck across a `salesOrderId`
group) is a Scheduling/Dispatch read/grouping increment, buildable independently of serialized allocation.

## Next
- Coordinated-visit grouping (Dispatch/Scheduling read over `salesOrderId`-grouped Work Orders) — buildable now.
- Per-unit Work Order fan-out — activates with serialized-equipment allocation (parallel dependency).
- Then C9 field execution / completion → Finance seam.
