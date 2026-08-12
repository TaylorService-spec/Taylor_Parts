# Taylor Site Master Audit — Issue #802

Consolidated by Agent Master via 3 specialist read-only audit passes (Frontend/UX/Product; Backend/IAM/Security; Business-process/Docs alignment) for ChatGPT prioritization, delivery week beginning 2026-08-12. All findings are evidence-based (file:line) from partial-depth passes under a constrained research budget — treat as a strong starting inventory, not exhaustive coverage. Unreviewed areas are called out per section so follow-up passes know where to look next.

## PRODUCT / UX / DISPATCH / INVENTORY / SALES / EQUIPMENT (frontend)

1. **[INVENTORY][defect]** Transfer can fabricate stock. `field-ops-app-vite/src/demo/InventoryContext.jsx:31-41` — `transferPart` clamps the warehouse decrement at 0 but credits the truck with the full requested quantity, inventing stock when requested qty exceeds on-hand. Fix: clamp truck credit to `Math.min(quantity, prev[partId] ?? 0)`.
2. **[INVENTORY/UX][defect]** No stock-bound validation on transfer form. `field-ops-app-vite/src/modules/inventory/Inventory.jsx:46-51` — only checks `qty > 0`, never checks against on-hand warehouse quantity (feeds #1). Fix: disable submit / inline error when qty exceeds stock.
3. **[DISPATCH/UX][defect]** Blocking native `alert()` for assignment failures, inconsistent with app's inline `FormError` pattern. `field-ops-app-vite/src/modules/dispatch/Dispatch.jsx:87-92`.
4. **[DISPATCH][defect]** No busy/duplicate-submit guard on assignment select — race condition risk. `field-ops-app-vite/src/modules/dispatch/Dispatch.jsx:83-93,135-150`.
5. **[DISPATCH/PRODUCT][gap]** "Priority" badge is a derived risk score only; no dispatcher-settable manual priority/override exists (acknowledged in code comment). `field-ops-app-vite/src/modules/dispatch/Dispatch.jsx:47-59`.
6. **[SALES][gap]** Entire Sales/Opportunity workspace is read-only, synthetic sample data, with only a small inline banner communicating this — top-level nav destination with no live create/edit/advance capability. `field-ops-app-vite/src/modules/sales/SalesWorkspace.jsx:24-29,395-434`.
7. **[EQUIPMENT/UX][defect]** No cross-field validation between installed date and warranty-expiry date (can save warranty expiring before install). `field-ops-app-vite/src/modules/equipment/EquipmentCreateModal.jsx:200-210`.
8. **[INVENTORY/EQUIPMENT][follow-up]** Residual TODO markers in `field-ops-app-vite/src/hooks/useReorderRequests.js`, `src/shared/ui/ActionRail.jsx`, `NotificationPanel.jsx` need triage to confirm no unfinished user-facing capability.

Not yet read in depth (recommend follow-up): `PartMasterList.jsx`, `Receiving.jsx`, `Transfers.jsx`, `TruckInventory.jsx`, `EquipmentEditModal.jsx`, `EquipmentTimeline.jsx`, `DispatcherBoard.jsx`, `WorkOrderQueue.jsx`.

## IAM / SECURITY / QA (backend: functions/, firestore.rules)

firestore.rules reviewed in depth: lines 1–1382 of 1798 (users, fieldops_jobs/technicians, employees, reorder_requests/purchase_orders/voids, inventory_transactions, warehouses/stock_locations/transfer_orders, trucks, accounts). No `allow read/write: if true` style holes found in that range. **Not yet reviewed**: lines ~1383–1798 (equipment, part master, reporting, finance collections) — priority follow-up.

1. **[QA][low]** `functions/scripts/assignTechnicianToUser.js:38-64` writes `users/{uid}.technicianId` (a field firestore.rules trusts for authorization via `isOwnTechnician()`) with no format/existence validation and no test file. Requires real GCP service-account credentials to run; not reachable by any client path.
2. **[QA][low]** Five Admin-SDK data-seeding/persona-activation scripts (`seedSandboxBaseline.js`, `seedOperationsDemoData.js`, `seedSandboxCoordinatedInstall.js`, `seedSandboxTransactional.js`, `activateSandboxPersonas.js`) bypass firestore.rules and have no matching test file, unlike most sibling scripts.
3. **[IAM][medium]** `functions/src/index.ts:68-231` — many exported callables (accessCommand, truckRegistry, supplierMaster, partMaster, manufacturer, partSupplierItem, reporting, finance) rely on a documented-but-not-tooling-enforced convention ("export != deploy", "register != grant") as their real gate, rather than a CI/deploy-time check. Blast radius is large if the convention is ever violated (privileged callables include grantRole/revokeRole, invoice issuance, truck deactivation), though today's path is fail-closed by the permission catalog. Recommend an automated deploy-time check.
4. **[IAM][low/informational]** `firestore.rules:1056-1058,1114-1116` — `reorder_purchase_orders`/`_voids` PARTS_ASSOCIATE reads do a live per-document `get()` against the linked `reorder_requests` doc on every read (cost/latency scaling concern at volume, not a correctness bug). Consider denormalizing `assignedToUserId`.
5. **[QA][low]** Several CLI wrapper scripts (`warehouseBackupRestoreCli.js`, `warehouseGovernanceMigrationCli.js`, `truckBackendVerifierCli.js`, `truckFunctionsVerifierCli.js`, `truckRegistryVerifierCli.js`) have tests for their underlying module but not for the CLI/argv-parsing layer itself.

Not yet reviewed: firestore.rules tail (equipment/part-master/reporting/finance blocks), `functions/src/finance/*`, `functions/src/reporting/*`, `functions/src/access/adminCredentialCommands.ts`, and a systematic diff of every `functions/src/**/*.ts` against `functions/test/` to enumerate untested modules precisely.

## Documentation / spec-vs-code alignment (cross-domain)

1. **[EQUIPMENT][doc-stale]** `docs/specifications/equipment-and-installed-asset-management.md:19-21` still states "SPECIFICATION-APPROVED... authorizes NO implementation" (dated 2026-07-15), but the feature is substantially built and live: 10 components under `field-ops-app-vite/src/modules/equipment/`, domain/hook layers, and a live rules block at `firestore.rules:1501-1541`. Update the spec's status header or add a superseding implementation-plan/closure doc.
2. **[EQUIPMENT/IAM][spec-code gap]** Spec's AC8 (`docs/specifications/equipment-and-installed-asset-management.md:104-106,135`) requires technician self-scoped equipment access via assigned Work Orders; the shipped rule (`field-ops-app-vite/firestore.rules:1502`, comment at :1356-1366) fully denies technicians all equipment reads, deliberately deferred to a future unit ("E17"). Spec should mark AC8 explicitly deferred so QA doesn't test against an AC that cannot currently pass.
3. **[INVENTORY][open, carried forward]** `PartsScanner.jsx` (`field-ops-app-vite/src/modules/mobile/PartsScanner.jsx`) remains unwired to `receiveInventoryStock`/`httpsCallable` (zero references, verified via grep) despite the backend (`functions/src/inventoryReceiving/`) being deployed live, per `docs/reviews/w3-inventory-write-loop-readiness.md:15,90-125` (dated 2026-08-05, now over a week old). Recommend tracking as an explicit open backlog item.
4. **[verified OK, no gap]** Reorder-request-cancellation spec vs. `field-ops-app-vite/src/domain/inventoryReorderRequests.js:277`, `reorderPurchaseOrders.js:137`, `PartDetail.jsx:159-226`, `firestore.rules:898-996` — consistent. Technician-self-write spec vs. `functions/src/completeAssignedJob.ts` + its test — implemented as specified.
5. **[EQUIPMENT][informational, correct-as-is]** `equipmentWrites.js:150-159` — move/retire/reactivate correctly stubbed (`trustedActionUnavailable`) pending Issue #15, matching spec language; not a defect.

Not yet cross-checked: SALES- and IAM-specific docs (`enterprise-access-*`, `sandbox-persona-authorization-matrix.md`) against code — recommended follow-up.

## Summary for prioritization

- Highest blast-radius items: #IAM-3 (callable authorization convention not tooling-enforced) and #INVENTORY-1/#INVENTORY-2 (transfer can fabricate stock — direct data-integrity defect reachable via normal UI).
- Fastest wins: #DISPATCH-3 (alert→inline error), #EQUIPMENT-7 (date cross-validation), #DOC-1 (stale spec header edit).
- Product-scope decisions needed from Owner/ChatGPT: #DISPATCH-5 (manual priority), #SALES-6 (Sales workspace live-vs-preview framing), #DOC-2 (AC8 deferral).
- Follow-up audit passes recommended before calling #802 closed: firestore.rules tail (equipment/part-master/reporting/finance), finance/reporting functions, SALES/IAM doc cross-check, and the frontend files listed as not-yet-read above.
