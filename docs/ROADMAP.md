# Roadmap

Forward-looking plan. For what's already shipped, see `SPRINT_STATUS.md`. For system design, see `PROJECT_ARCHITECTURE.md`. For product direction, see `ProductVision.md`. For capability-level maturity planning, see [`PlatformCapabilityModel.md`](PlatformCapabilityModel.md).

## Product Release Roadmap

This is the platform's release-level roadmap, tracked by Product version (see `ProductVision.md`/`ProductBlueprint.md`). It complements — not replaces — the sprint/epic implementation roadmap below and in `SPRINT_STATUS.md`; a Product version spans many sprints/epics. Per [`PlatformCapabilityModel.md`](PlatformCapabilityModel.md)'s "Release Planning" section, future releases should also be expressible in capability-maturity terms (e.g. "Dispatch Management: Level 3 → 4"), not only as a list of unrelated shipped features.

### Planned governance documents (recommended authoring order)

1. **[`PlatformCapabilityModel.md`](PlatformCapabilityModel.md)** — complete.
2. **[`DeploymentModeStrategy.md`](DeploymentModeStrategy.md)** — complete. Development/Demo/Managed Hosted/Enterprise Integration deployment modes.
3. **[`PlatformOperatingModel.md`](PlatformOperatingModel.md)** — complete. Governance responsibilities, Product/Architecture ownership, release/change/configuration management, customer onboarding lifecycle, versioning philosophy, AI-assisted development workflow.
4. **[`IntegrationArchitecture.md`](IntegrationArchitecture.md)** — complete. System boundaries, operational-vs-analytical systems, supported integration patterns, import/export strategy, API philosophy, AI integration strategy, customer-owned integrations (Snowflake/ETL/BI/ERP/Accounting/CRM/AI). Fourth and final planned governance artifact — all four are now written.

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
| 2.0.2 | Customer Foundation | **Complete and live (PR #44)** |
| 2.0.3 | Work Order Experience (Service Workspace) | **Complete and live -- UI only (PR #46)** |
| 2.0.4 | *(reframed twice this session — see note below; superseded by the governance documentation roadmap above)* | Paused |

**Sprint 2.0.2 — Customer Foundation: complete.** Delivered `accounts`/`locations`/`contacts` Firestore collections (rules deployed to production), a client-direct-write domain layer, a reusable Global Search component (Accounts provider only), and Customer/Location/Contact UI wired into Release 2.0's routing (`/customers`, `/customers/:accountId`). Live-verified: admin/dispatcher can create Customers, open Customer Detail, add Locations and Contacts, and find a Customer via Global Search; technicians cannot see the Customers nav item and a direct link to `/customers/:accountId` redirects to `/dashboard` with no permission-denied errors. See [`BusinessEntityModel.md`](BusinessEntityModel.md) for the full object model, relationships, and the Location first-class-vs-embedded recommendation this sprint implemented.

**Sprint 2.0.3 — Work Order Experience (Service Workspace): complete and live, UI only.** Delivered the real Service > Work Orders workspace (list, search, status grouping), a 4-step Work Order creation wizard, and a Work Order Detail route (`/service/work-orders/:workOrderId`), all live-verified in production. The legacy `fieldops_jobs` screen was relocated (not deleted) to Service > Job Assignments. **Real Work Order creation is not yet functional**: `createWorkOrder()`/`transitionWorkOrder()` are not deployed live (blocked on the Firebase Blaze plan upgrade, issue #15) — the wizard calls them exactly as it will once deployed, and shows a clear user-facing message ("Work Order creation service is not currently available in this environment.") rather than failing silently or with a raw error. This is a real, external blocker, not a code gap.

**Sprint 2.0.4 — paused, reframed twice this session.** Originally scoped as "Cloud Functions Deployment Readiness" (a full plan was written and approved, and real emulator validation caught and fixed a genuine `createWorkOrder.ts` bug — recovered independently via PR #49). Then the user clarified Blaze is not being adopted right now, as a standing decision, not a temporary blocker — that framing was abandoned before any deploy happened. A second framing ("Spark-Compatible Work Order Enablement," rebuilding Work Order writes as client-direct Firestore writes) was drafted and explicitly rejected before any code was written, to avoid permanently redesigning the platform around a temporary plan constraint given the long-term paid-customer/Snowflake/ETL/BI/ERP vision. **The real next step was documentation, not a numbered sprint**: see the "Planned governance documents" list above — [`DeploymentModeStrategy.md`](DeploymentModeStrategy.md) formalizes deployment modes (Development/Demo/Managed Hosted/Enterprise Integration) as a permanent concept, so this question has a durable answer instead of a third reframing. See `CLAUDE_CONTEXT.md`'s "Sprint 2.0.4 direction" section for the full history.

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
