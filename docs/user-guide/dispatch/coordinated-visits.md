# Coordinated Visits (Service / Dispatch)

**Who this is for:** dispatchers and admins coordinating a multi-unit equipment job.

**Where:** **Service → Dispatch → Coordinated Visits** (`/service/coordinated-visits`).

> The page currently shows a **synthetic sample** coordinated visit (the C713×5 scenario) so you can see how
> coordination reads. The live coordinated-operations feed connects in a later release. Nothing on this page
> changes any data — it is read-only.

## What a coordinated visit is

When one order sends several pieces of equipment to the same customer and site, each unit is installed/serviced
on its **own Work Order** (so each is individually accountable), but they are **coordinated as one visit**. This
page groups those Work Orders together so you can see the whole obligation at once.

## Reading the queue

Each row is one coordinated visit: **customer**, **location**, **progress** (e.g. `3/5`, and `· 1 blocked` if a
unit is stuck), **remaining** units, and a **readiness** pill. Visits that need attention sort to the top.

On narrower screens the lower-priority columns (Location, Remaining) are hidden to keep the important ones
readable — they are still in the detail panel.

## Reading a visit's detail

Select a row to open its detail:

- **Customer / Location / Coordinated obligation / Readiness** — the shared context and the overall state.
- **Completion progress** — e.g. *"3 of 5 complete · 1 blocked · 2 remaining."* Partial completion is shown
  honestly: **4 of 5 done with 1 blocked is not a complete visit.**
- **Related Work Orders / equipment units** — one row per unit: the equipment, its status, its **scheduled
  window / technician / truck where those are known** (otherwise *"Unscheduled / Unassigned"*), and any
  **material blocker**.

## Material blockers

If a unit is blocked on a part, the row names the short part. If the replenishment/purchasing system is not
connected, you'll see *"replenishment status not connected (routed to Inventory / Purchasing)"* — the app will
**not** invent an ETA it doesn't have. Follow up through Inventory / Purchasing for the part's status.

## What this page does not do

It does not schedule, dispatch, or complete work, and it does not create a "job" or "visit" record — the Sales
Order already coordinates the Work Orders. Use the existing Scheduling and Dispatch screens for those actions.
