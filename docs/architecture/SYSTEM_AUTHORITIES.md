# System Authorities

A quick-reference map of "who owns what" — not a replacement for the ADRs (`docs/architecture/ADR-*.md`), which explain *why*; this is just a fast answer to "where should I change this?" so a human or an AI assistant doesn't have to rediscover it (or worse, build a second, competing implementation because the first one wasn't found).

**Verify before trusting.** This doc is hand-maintained and can drift, the same way any doc can (see `CLAUDE_CONTEXT.md`'s intro paragraph and rule 9 for two concrete times a doc/spec claimed something that wasn't true in code). If a row here disagrees with what you find in the actual file, the code wins — update this table to match, don't assume the table is right and the code is wrong.

| Concern | Authority |
|---|---|
| Work Order lifecycle (state machine + permissions) | `functions/src/transitionEngine.ts` (canonical), mirrored client-side in `domain/workOrderWorkflow.js` |
| Work Order writes | `services/workOrderService.ts` → `createWorkOrder`/`transitionWorkOrder` Cloud Functions. `firestore.rules` denies all direct client writes to `fieldops_wos`/`counters` unconditionally |
| Work Order reads | `services/workOrderService.ts` (`getWorkOrder`, `subscribeToWorkOrders`) + `hooks/useWorkOrders.js`. (No separate `workOrderQueries.ts` exists on `main` — a file by that name exists only on the unmerged `epic-2-work-order-interactive-ui` branch; don't assume it's live.) |
| Job / Technician writes | `domain/jobActions.js` (`assignJob`/`updateJobStatus`/`createJob`/`createTechnician`) — the only writer of `fieldops_jobs`/`fieldops_technicians` |
| Inventory ledger (stock movement) | `functions/src/inventoryService.ts` → `inventory_transactions` (append-only: RESERVED/RELEASED/CONSUMED). `data/partsCatalog.ts` is metadata-only, no stock authority |
| Inventory analytics / forecasting | `functions/src/inventoryAnalyticsService.ts` (pure, read-only), client-mirrored in `domain/inventoryAnalyticsEngine.ts` |
| Warehouse (bin-level stock, transfers, reconciliation) | `functions/src/warehouseService.ts` (writes) / `warehouseReconciliationService.ts` (read-only comparison), client-mirrored in `domain/warehouseReconciliationEngine.ts` |
| Procurement (suppliers, purchase orders, draft proposals) | `functions/src/procurementService.ts` (writes) / `supplierService.ts` (reads) / `procurementBridge.ts` (draft generation, never auto-creates), client-mirrored in `domain/procurementDraftEngine.ts` |
| Operations dashboard reads | `services/operationsQueries.ts` — one-shot reads only, admin/dispatcher-gated by `firestore.rules` |
| Firestore security rules | `firestore.rules` (root) **and** `field-ops-app-vite/firestore.rules` (client-repo mirror) — both must be kept in sync; there are two files, not one |
| Navigation | `App.jsx`'s `NAV` array — the only live navigation source of truth. (`modules/registry/moduleRegistry.ts` is descriptive metadata only — see below — and `src/app/`/`src/navigation/` routing scaffolding was built and then fully removed on PR #22; neither exists on `main`) |
| Role-based screen access | `domain/constants.js`'s `ROLE_NAV_ACCESS` |
| Module metadata (labels/descriptions only) | `modules/registry/moduleRegistry.ts` — explicitly **not** a routing or navigation authority, has zero effect on the running app, not imported anywhere. See its own header comment |
| Work Order type contract | `field-ops-app-vite/src/types/workOrder.ts` ↔ `functions/src/types/workOrder.ts` — mirrored, not shared (no monorepo tooling exists to unify them); change both together |
| Dispatcher-facing Work Order actions | `modules/controlTower/WorkOrderActions.jsx`, rendered from `WorkOrderDetail.jsx`, gated by `domain/workOrderWorkflow.js`'s `getAllowedActions()` |
| Technician mobile flow | `modules/mobile/FieldMode.jsx` — **still entirely `fieldops_jobs`/`JOB_STATUS`-based**, not on the Work Order model at all. Migrating it is a separate, unstarted epic — don't assume it uses `transitionWorkOrder()` |
