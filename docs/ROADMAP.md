# Roadmap

Forward-looking plan. For what's already shipped, see `SPRINT_STATUS.md`. For system design, see `PROJECT_ARCHITECTURE.md`. For product direction, see `ProductVision.md`.

## Product Release Roadmap

This is the platform's release-level roadmap, tracked by Product version (see `ProductVision.md`/`ProductBlueprint.md`). It complements — not replaces — the sprint/epic implementation roadmap below and in `SPRINT_STATUS.md`; a Product version spans many sprints/epics.

| Version | Name | Status |
|---|---|---|
| Version 1 | Platform Foundation | Completed |
| Version 2 | Platform Experience | Current |
| Version 3 | Enterprise Operations | Planned |
| Version 4 | Enterprise Intelligence | Future |

### Version 2 (Platform Experience) sprint breakdown

| Sprint | Name | Status |
|---|---|---|
| 2.0.1 | Navigation Foundation | Complete (PR #41) |
| 2.0.2 | Customer Foundation | Next (renamed from "Work Order Experience"; implementation order revised — see below) |
| 2.0.3 | Work Order Experience (Service Workspace) | Planned, after 2.0.2 |

**Sprint 2.0.2 — Customer Foundation** (renamed and reordered per product review of the Service Workspace design proposal): establishes the core business-entity model (Accounts/Customers, Contacts, Locations, and the other entities in [`BusinessEntityModel.md`](BusinessEntityModel.md)) and the Customer lookup/creation workflow, *before* the Work Order creation wizard is built on top of it — the wizard's first two steps (Customer, Location) were found to have no underlying entity/collection/rules to build on. See [`BusinessEntityModel.md`](BusinessEntityModel.md) for the full object model, relationships, Firestore collection recommendations, and the Location first-class-vs-embedded recommendation this sprint implements.

**Sprint 2.0.3 — Work Order Experience (Service Workspace)** (the sprint originally scoped as "2.0.2"): the Service Workspace layout, Work Order creation wizard, and Work Order Detail page/routing, built on top of Sprint 2.0.2's entity model. Real Work Order creation UI using `fieldops_wos` (via `services/workOrderService.ts`'s `createWorkOrder()`), a Work Order Detail page, clickable Work Order IDs, and a technician-assignment entry point. Not in scope: unrelated dispatch/inventory/reporting features. See `CLAUDE_CONTEXT.md`'s "Next up" section for the finding that motivated this (the current "Work Orders" screen creates legacy `fieldops_jobs` records, not real Work Orders).

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
