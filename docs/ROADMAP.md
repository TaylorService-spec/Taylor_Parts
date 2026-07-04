# Roadmap

Forward-looking plan. For what's already shipped, see `SPRINT_STATUS.md`. For system design, see `PROJECT_ARCHITECTURE.md`.

## Near-term

- **Sprint 3.3 merge** — land PR #6 once ready; re-verify mergeability against `main` first (don't assume).
- **Sprint 3.4 (`sprint-3.4-workorder-lifecycle`, in progress)** — scope to be defined. Branch name suggests work-order lifecycle management (e.g. explicit work-order status transitions, or wiring the currently-unused `domain/workOrders.js`/`workOrdersStore` into an actual UI). Confirm scope before large implementation.

## Candidate future sprints (not yet scheduled)

- **Real Work Order documents.** Currently Control Tower derives "work orders" purely by grouping jobs on `workOrderId` client-side; the `workOrders` Firestore collection (`domain/workOrders.js`) has no populated documents and no UI creates them. A future sprint could build actual Work Order CRUD (customer, priority, scheduledDate) and wire it into `assignJob()`/dispatch scoring's "work-order priority" factor, which today is only a continuity proxy (see `FUTURE_ARCHITECTURE_BACKLOG.md`).
- **Lifecycle timestamps.** Add `assignedAt`/`startedAt` to the job schema, written inside `assignJob()`/`updateJobStatus()`'s existing transactions. This would let `jobRiskScoring.js` replace its `createdAt`-only age approximation with true per-status timing. Explicitly deferred in Sprints 3.2/3.3 to keep those sprints' write-surface at zero.
- **Technician scheduling / shift management.** `TECH_STATUS.OFF_SHIFT` exists in the enum but nothing in the current UI sets or clears it — worth a dedicated sprint if shift-based dispatch becomes a priority.

## Explicitly out of scope until named otherwise

- A second Control Tower implementation, in any form.
- Any Firestore write path for jobs/technicians outside `assignJob()`/`updateJobStatus()`.
- Reintroducing `field-ops-app/` (the pre-Vite app) or an equivalent parallel app.
