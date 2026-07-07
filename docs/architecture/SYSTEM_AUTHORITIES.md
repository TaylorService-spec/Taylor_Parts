# System Authorities

A quick-reference map of "who owns what" — not a replacement for the ADRs (`docs/architecture/ADR-*.md`), which explain *why*; this is just a fast answer to "where should I change this?" so a human or an AI assistant doesn't have to rediscover it (or worse, build a second, competing implementation because the first one wasn't found).

**Verify before trusting.** This doc is hand-maintained and can drift, the same way any doc can (see `CLAUDE_CONTEXT.md`'s intro paragraph and rule 9 for two concrete times a doc/spec claimed something that wasn't true in code). If a row here disagrees with what you find in the actual file, the code wins — update this table to match, don't assume the table is right and the code is wrong.

## Product Authority

This table is an *architecture* ownership map — it answers "where should I change this code?" It does not own product decisions. For "why does this exist" or "should this feature exist at all," the authority is the Product governance set, not this file:

| Concern | Authority |
|---|---|
| Product vision, mission, long-term scope | `../ProductVision.md` |
| Platform-wide product principles | `../PlatformConstitution.md` |
| Business capabilities and maturity | `../PlatformCapabilityModel.md` |
| Business-domain navigation, business objects | `../ProductBlueprint.md` |
| UX/product-level working principles | `../GuidingPrinciples.md` |
| Multi-device/mobile strategy | `../MobileStrategy.md` |
| Enterprise business object model (Account/Contact/Location/Work Order/etc., core-vs-future entities, Firestore collection recommendations) | `../BusinessEntityModel.md` |

This section explains ownership only — see those documents themselves for their actual content, and `../CLAUDE_CONTEXT.md`'s "Product Authorities" section for when to consult them.

## Architecture Authority

| Concern | Authority |
|---|---|
| Work Order lifecycle (state machine + permissions) | `functions/src/transitionEngine.ts` (canonical), mirrored client-side in `domain/workOrderWorkflow.js` |
| Work Order writes | `services/workOrderService.ts` → `createWorkOrder`/`transitionWorkOrder` Cloud Functions. `firestore.rules` denies all direct client writes to `fieldops_wos`/`counters` unconditionally |
| Work Order reads | `services/workOrderService.ts` (`getWorkOrder`, `subscribeToWorkOrders`) + `hooks/useWorkOrders.js`. (No separate `workOrderQueries.ts` exists on `main` — a file by that name exists only on the unmerged `epic-2-work-order-interactive-ui` branch; don't assume it's live.) |
| Technician-scoped Work Order reads | `services/workOrderService.ts`'s `subscribeAssignedWorkOrders()` + `hooks/useAssignedWorkOrders.js` (PT-002) — a separate, additional query (`where("assignedTechId", "==", technicianId)`), never a modification of the dispatcher-side `subscribeToWorkOrders()` above |
| Technician identity mapping | `users/{uid}.technicianId` → `fieldops_technicians/{id}`, populated only via `functions/scripts/assignTechnicianToUser.js` (Admin SDK, manual — PT-001). No automatic mapping exists; `users/{userId}` has `allow write: if false` unconditionally, so this can never be a client-side write |
| Work Order execution data (`qtyUsed`, `executionLog`, `lastUpdated`) | `functions/src/updateWorkOrderExecutionData.ts` (Epic 6 Phase 6.3) — a Cloud Function, exclusively. These fields are written ONLY via Admin SDK inside this callable; `firestore.rules`' `fieldops_wos` rule is NOT changed to allow them (Admin SDK bypasses rules entirely, so no client-side rule exception is needed or should ever be added). Never touches `status`/`assignedTechId`/any lifecycle timestamp — entirely separate from `transitionWorkOrder()`/`transitionEngine.ts` |
| Job / Technician writes | `domain/jobActions.js` (`assignJob`/`updateJobStatus`/`createJob`/`createTechnician`) — the only writer of `fieldops_jobs`/`fieldops_technicians` |
| Inventory ledger (stock movement) | `functions/src/inventoryService.ts` → `inventory_transactions` (append-only: RESERVED/RELEASED/CONSUMED). `data/partsCatalog.ts` is metadata-only, no stock authority |
| Inventory analytics / forecasting | `functions/src/inventoryAnalyticsService.ts` (pure, read-only), client-mirrored in `domain/inventoryAnalyticsEngine.ts` |
| Warehouse (bin-level stock, transfers, reconciliation) | `functions/src/warehouseService.ts` (writes) / `warehouseReconciliationService.ts` (read-only comparison), client-mirrored in `domain/warehouseReconciliationEngine.ts` |
| Procurement (suppliers, purchase orders, draft proposals) | `functions/src/procurementService.ts` (writes) / `supplierService.ts` (reads) / `procurementBridge.ts` (draft generation, never auto-creates), client-mirrored in `domain/procurementDraftEngine.ts` |
| Operations dashboard reads | `services/operationsQueries.ts` — one-shot reads only, admin/dispatcher-gated by `firestore.rules` |
| Firestore security rules | `firestore.rules` (root) **and** `field-ops-app-vite/firestore.rules` (client-repo mirror) — both must be kept in sync; there are two files, not one |
| Navigation | **As of Sprint 2.0.1 (Release 2.0):** `navigation/navConfig.js` — the business-domain/sub-nav tree, consumed by real `react-router-dom` routes in `App.jsx` and `navigation/AppShell.jsx`. Superseded `App.jsx`'s old flat `NAV` array (removed). `modules/registry/moduleRegistry.ts` remains descriptive-only metadata, still not imported anywhere — see below. (PR #22 previously built and then fully removed a `src/app/`/`src/navigation/` routing scaffold as a scope-convergence decision, not a permanent ban on routing — see `docs/Architecture.md`'s "SPA routing" section for why Sprint 2.0.1 reintroduces it.) |
| Role-based screen access | `domain/constants.js`'s `ROLE_NAV_ACCESS` |
| Module metadata (labels/descriptions only) | `modules/registry/moduleRegistry.ts` — explicitly **not** a routing or navigation authority, has zero effect on the running app, not imported anywhere. See its own header comment |
| Work Order type contract | `field-ops-app-vite/src/types/workOrder.ts` ↔ `functions/src/types/workOrder.ts` — mirrored, not shared (no monorepo tooling exists to unify them); change both together |
| Dispatcher-facing Work Order actions | `modules/controlTower/WorkOrderActions.jsx`, rendered from `WorkOrderDetail.jsx`, gated by `domain/workOrderWorkflow.js`'s `getAllowedActions()` |
| Technician-facing Work Order actions | `modules/technicianDashboard/TechnicianWorkOrderActions.jsx` (Epic 6 Phase 6.2) — a separate component from the dispatcher's `WorkOrderActions.jsx` above, not a modification of it. Also gated by `getAllowedActions()`, called with `isOwnAssignment` hardcoded `true` (every Work Order reaching it already came from a technician-scoped query) |
| Technician mobile/landing flow | Two separate things, don't conflate them: `modules/mobile/FieldMode.jsx` — **still entirely `fieldops_jobs`/`JOB_STATUS`-based**, not on the Work Order model at all, untouched by Epic 6; and `modules/technicianDashboard/TechnicianDashboard.jsx` (Epic 6 Phases 6.1–6.3) — the new Work-Order-based technician landing page, reachable alongside FieldMode in technician nav, not a replacement for it |
