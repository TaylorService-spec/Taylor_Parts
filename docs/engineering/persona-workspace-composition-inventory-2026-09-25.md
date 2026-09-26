---
artifact_type: inventory
unit: Phase C PREPARATION -- persona WORKSPACE COMPOSITION MAP (16 canonical Job Roles, 11 groupings)
status: HOLD -- preparation only; Phase C is not open (waits on Phase A live evidence and the Phase B freeze)
base: main 09d63c4e (open PRs referenced: #1972, #1980, #1981 -- all HELD, none merged)
evidence_class: REPO-DERIVED throughout. Nothing in this document was observed live.
authorizes: nothing -- no UI, navigation, grant, role, route or data change
---

# Persona workspace composition map (2026-09-25)

**Every claim is REPO-DERIVED.** Where a claim depends on live state the repo cannot show (Firebase
`users/{uid}` documents, for example) it is marked **UNVERIFIED**. Persona Foundation is COMPLETE and is
not reopened here (baseline 40 objects / 79 capabilities / 413 grants / 0 drift / 51).

Owner direction for Phase C (scope): *"Assemble existing screens into the 16 employee experiences. Keep
Retail Sales and National Accounts Sales distinct Job Roles. One integration writer owns
App.jsx/navConfig/AppShell. Do not invent business figures or expose actions the server refuses."*
Archaeology baseline: nothing here proposes rebuilding an existing capability; BUILD_NEW is not a class.

## 0. Method, classes and standing facts

| Input | Used for |
|---|---|
| `functions/src/eosWorkforce/jobRoleVocabulary.ts` `CANONICAL_JOB_ROLES` | the 16 Job Roles |
| `config/sandboxRoleIdentityRegistry.json`; `docs/testing/persona-business-connection-census.md`; `functions/scripts/fixtures/personaAuthorityDimensions.v1.json` | login, Security Roles, Work Eligibility (WE), Operational Scope per persona |
| `functions/src/adminPolicy/seed/roleCapabilityAuthorityBaseline.json` (413 grants) | Role -> PG capability |
| `functions/src/eosOps/experienceAuthority.ts` (`EXPERIENCE_SURFACES`, `EXPERIENCE_SURFACE_GAPS`) | capability -> surface |
| `field-ops-app-vite/src/navigation/navConfig.js` (`NAV_SURFACE_ACCESS`, `NAV_SURFACE_GAPS`), `App.jsx` | surface -> destination -> component |
| `field-ops-app-vite/src/domain/dashboardComposition.js` | dashboard modules and their gates |
| `field-ops-app-vite/src/modules/scan/*Scan.jsx` (all `shared/ui/ScanInput` consumers) | scanners |
| `functions/src/eosApi/server.ts` | Render domains: Administration, `/crm/`, `/commercial/`, `/workforce/`, `/operations/` only |
| client import-graph scan (static, depth 4) | transport per screen |

Surfaces were re-derived from the baseline and match `personaBusinessAccessRegression.test.mjs`
`EXPECTED_SURFACE_COUNTS` except owner-executive (22 vs 21: `REORDER_QUEUE:taylor` scope survives the
Owner/Admin relink, UNVERIFIED) and warehouse-associate (8 vs 7: Phase 3 `inventoryPutAwayOperator`
postdates the manifest).

**Transport key.** **R-PG** Render over PostgreSQL (honors every persona by PG capability) · **FB-CALL**
Firebase callable authorized by `resolveEffectiveAccess` (`functions/src/access/effectiveAccessFeed.ts`,
Firestore) or a Firestore loader · **FB-DOC** direct Firestore read under Rules (`users/{uid}.role`,
`isOwnTechnician`, `employees/{id}.operationalRoles`) · **NONE** no backend.

**Classes.**

| Class | Meaning |
|---|---|
| KEEP | Exists and its backend honors this persona today, or the current behavior is correct by design. |
| INTEGRATE | Screen/backend exist; only composition is missing (orphaned component, unmapped door onto an existing read, landing, grouping). |
| VERIFY | Outcome depends on live state, a HELD PR, or an Owner decision the repo cannot settle. |
| REPAIR | Exists but is refused or unusable for this persona under EOS (data path is Firebase, vocabulary not registered, gate wrong). |
| TRUE_GAP | Repo evidence that the business capability does not exist (no domain, no backend). |

**Standing facts carried into every row.**

| # | Fact | Evidence |
|---|---|---|
| F1 | **Menu earned from PG, data read from Firebase.** Navigation under EOS is earned from PG capabilities; almost every screen behind a door is FB-DOC/FB-CALL, and the canonical chain grants no Firebase business authority (`GOVERNED_PERSONA_HAS_NO_CLIENT_ROLE`). Result: doors shown, data refused. | §2; census D-25 |
| F2 | **#1980 (HELD):** Work Order detail + wizard routes held behind a pure guard (`navigation/workOrderRouteAccess.js`): EOS requires `service.workOrders` AND `service.dispatch` = {admin, dispatcher, fieldManager}. Owner decisions open: (a) detail for `workOrder.record.read` holders (technician); (b) create-only door for officeManager/parts/GM/owner. Data still `fieldops_wos` + `createWorkOrder`. | PR #1980 |
| F3 | **#1972 (HELD):** Commercial writes fenced. `COMMERCIAL_WRITER_AUTHORITY = { firestore: OPEN, postgres: INACTIVE }`; all 10 `/commercial/sales` mutations -> 503 `COMMERCIAL_WRITER_INACTIVE`; 3 list reads stay open (`listOpportunities`, `listSalesOrders`, `listSalesAgreements`). | PR #1972 |
| F4 | **Sales Agreements index = PARTIAL_AUTHORITY.** List is R-PG (`listSalesAgreements`, 0 rows in `eos_commercial`); detail + writes are FB-CALL. | `SalesAgreementsList.jsx` / `SalesAgreementDetail.jsx` |
| F5 | **Finance reader is temporary (#1981, HELD).** `listFinancialFacts` is a Firestore FIN-004 reader; A' is accuracy-only; replacement is an `eos_finance` aggregate via Render (delete conditions in PR). `eos_finance` has no Render route. | PR #1981; `server.ts` |
| F6 | **Reporting is reachable by nobody under EOS.** `reportViewer` holds `reportDefinition.read`; no surface is declared on it; Report Builder / Saved Reports are gated by Firebase `report.*` ids. | `navConfig.js` `NAV_SURFACE_GAPS["reporting/*"]` |
| F7 | **PG server modules exist but have no Render route**: `eosOps/workOrderLifecycle.ts`, `workOrderCreateCommand.ts`, `workOrderAssignmentAuthority.ts`, `coordinatedVisitPostgresRead.ts`, `cycleCountRepository.ts`, `warehouseBinRepository.ts`, `purchasingRepository.ts`, `supplierCatalogRepository.ts`, `truckFleetRepository.ts`, `reorderAssignmentAuthority.ts`, `invoiceAuthority.ts`, `cashApplicationAuthority.ts`, `manufacturerAuthority.ts`. These are the "PostgreSQL-ready" dependencies below; exposing them is migration work, not composition. | `functions/src/eosOps/`; `server.ts` domains |
| F8 | In-screen affordances read the fail-closed Firebase feed (`operationalContext.hasCapability`), so PG-only personas see actions **hidden**, not shown-then-refused. Nav visibility is never action authority. | `useOpportunityCapabilities`; `dashboardComposition.js` |

---

## 1. Job Role -> primary grouping, and reachability (DERIVED, platform-sandbox)

| Grouping | Job Role(s) | Login | Security Roles (PG caps) | Surf / Dest | Backend honors | Grouping status |
|---|---|---|---|---|---|---|
| SERVICE OPERATIONS | service-manager | `devon.fixture@` | `fieldManager` (16) | 12 / 17 | `/my-profile` only | Doors refused; PG dispatch/cancel unusable |
| | service-coordinator-dispatcher | `dispatcher@` | `dispatcher` (31) + `REORDER_QUEUE:taylor` | 13 / 20 | all, if legacy `users.role=dispatcher` holds (UNVERIFIED) | Usable (conditional) |
| TECHNICIAN | service-technician | `finley.fixture@` | `technician` (4) + WE `SERVICE_TECHNICIAN` | 2 / 7 | `/my-profile` only | Doors refused (no `users.technicianId`) |
| WAREHOUSE / INVENTORY | warehouse-associate | `noor.fixture@` | `warehouseAssociate` + counter + put-away (13) + `WAREHOUSE:SC-WH-MAIN` | 8 / 11 | `/my-profile` only | Doors refused |
| | warehouse-manager | `morgan.fixture@` | `warehouseManager` + reconciler + bin admin (15) + 2 warehouses | 11 / 13 | `/my-profile` only | Doors refused |
| PARTS | parts-associate | `logan.fixture@` | `partsAssociate` + `inventoryReceivingClerk` (13) + WE `PARTS_OPERATIONS` | 8 / 14 | `/my-profile` only | Doors refused |
| | parts-manager | `kai.fixture@` | `partsManager` + `purchasingManager` (22) + `REORDER_QUEUE:taylor` | 13 / 17 | `/my-profile` only | Doors refused |
| RETAIL SALES | retail-sales | `harper.fixture@` | `salesperson` (17) | 8 / 10 | Agreements list (R-PG, empty) | One empty PG list; writes fenced |
| NATIONAL ACCOUNTS SALES | national-accounts-sales | `jules.fixture@` | `salesperson` (17) | 8 / 10 | same as retail | Identical authority to retail |
| FINANCE / ACCOUNTING | finance-accounting | `acctmgr@` | `accountingManager` (17) | 11 / 13 | Invoices/Payments only if FIN-004 reach resolves (UNVERIFIED) | Temporary reader; likely refused |
| REPORTING | reporting-analyst | `reporting@` | `reportViewer` (1) | **0 / 0** | none ("No access") | Reachable by nobody |
| MANAGEMENT / OWNER | owner-executive | `eos-owner@` | `owner` (50) | 22 / 26 | Administration suite (R-PG), Agreements list | Partial -- administration only |
| | general-manager | `bailey.fixture@` | `generalManager` (32) | 15 / 19 | Users (R-PG), Agreements list | Partial |
| OFFICE / ADMINISTRATION | office-administration | `admin@` | `admin` (69) | 24 / 31 | all, if legacy `users.role=admin` holds (UNVERIFIED) | Usable (conditional) |
| | office-manager | `casey.fixture@` | `officeManager` (4) | 2 / 5 | `/my-profile` only | Doors refused |
| GENERAL EMPLOYEE | general-employee | `restricted@` | none | 0 / 0 | none ("No access") | Correct (P16 negative control) |

Summary: **2/16** usable end to end (both on a legacy sbx Firebase role), **2** partial via R-PG,
**10** doors-refused (finance unverified), **2** "No access" (reporting = gap; general-employee = correct).

---

## 2. Screen catalog (destination key -> route -> component -> transport)

| Destination | Route | Component (`field-ops-app-vite/src/modules/`) | Transport | Surface(s) |
|---|---|---|---|---|
| dashboard/my | `/dashboard` | `dashboard/MyDashboard.jsx` or `technicianDashboard/TechnicianDashboard.jsx` (FIELD_WORK) | FB per module | container |
| dashboard/operationsDashboard | `/dashboard/operations` | `operations/Operations.jsx` | FB-DOC | inventory.balances, inventory.catalog |
| customers/customers | `/customers` (+`/:accountId`) | `accounts/AccountsList.jsx`, `AccountDetail.jsx` | FB-CALL + FB-DOC (`isAdminOrDispatcher`) | crm.accounts |
| customers/opportunities | `/customers/opportunities` | `sales/OpportunityList.jsx`, `OpportunityDetail.jsx`, `NewOpportunityForm.jsx` | FB-CALL (`listOpportunityContext`) | commercial.opportunities |
| customers/salesOrders | `/customers/sales-orders` | `sales/SalesOrdersList.jsx`, `SalesOrderDetail.jsx` | FB-CALL + FB-DOC | commercial.salesOrders |
| customers/salesAgreements | `/customers/sales-agreements` | `sales/SalesAgreementsList.jsx` (detail `SalesAgreementDetail.jsx`) | **R-PG** list / FB-CALL detail | commercial.agreements |
| serviceOperations | `/service-operations` | `controlTower/ControlTower.jsx` (+`panels/AtRiskPanel`, `WorkOrderAttentionPanel`) | FB-DOC + FB-CALL | service.workOrders |
| service/workOrders | `/service` | `workOrders/WorkOrdersList.jsx` | FB-DOC (`fieldops_wos`) | service.workOrders |
| service/jobAssignments | `/service/job-assignments` | `jobs/Jobs.jsx` | FB-DOC + FB-CALL | service.workOrders |
| service/dispatch | `/service/dispatch` | `dispatch/Dispatch.jsx` | FB-DOC + FB-CALL | service.dispatch |
| service/dispatcherBoard | `/service/dispatcher-board` | `dispatcherBoard/DispatcherBoard.jsx` | FB-DOC + FB-CALL (`schedulingCommandClient`) | service.dispatch |
| service/coordinatedVisits | `/service/coordinated-visits` | `service/CoordinatedVisitsWorkspace.jsx` | FB-CALL (`listCoordinatedOperations`) | service.coordinatedVisits |
| service/technicianWorkspace | `/service/technician-workspace` | `technician/TechnicianShell.jsx` / `mobile/FieldMode.jsx` | FB-CALL + FB-DOC (`users.technicianId`) | field.myWorkOrders |
| service/coordinatedMission | `/service/coordinated-mission` | `mobile/CoordinatedMissionView.jsx` | FB-CALL | field.myWorkOrders |
| service/scan | `/service/scan` | `scan/ScanWorkspace.jsx` | FB-CALL + FB-DOC | receiving.checkIn, warehouse.picking, field.myWorkOrders |
| equipment/equipment | `/equipment` | `equipment/EquipmentWorkspace.jsx`, `EquipmentDetail.jsx` | FB-CALL + FB-DOC | equipment.register |
| inventory/parts | `/inventory` (+`/:partId`) | `inventory/PartsList.jsx`, `PartDetail.jsx` | FB-DOC (`parts`: opRole) + FB-CALL | inventory.catalog |
| inventory/partMaster | `/inventory/part-master` | `inventory/PartMasterList.jsx` | FB-CALL + FB-DOC | inventory.catalogAdmin |
| inventory/warehouseWorkspace | `/inventory/warehouse-workspace` | `warehouse/WarehouseShell.jsx` / `ScanWorkspace.jsx` | FB-CALL + FB-DOC | warehouse.picking |
| inventory/warehouses | `/inventory/warehouses` | `inventory/Warehouses.jsx` | FB-CALL + FB-DOC | warehouse.management |
| inventory/truckInventory | `/inventory/truck-inventory` | `inventory/TruckInventory.jsx` (`canManage` on Firebase `role`) | FB-DOC | inventory.balances |
| inventory/transfers | `/inventory/transfers` | `inventory/Transfers.jsx` | FB-CALL + FB-DOC | inventory.transfers |
| inventory/receiving | `/inventory/receiving` | `inventory/Receiving.jsx` | FB-CALL (`receivingCallableClient`) | receiving.checkIn |
| inventory/reorderQueue | `/inventory/reorder-queue` | `inventoryRole/PartsManagerHome.jsx` | FB-DOC (`reorder_requests`) + FB-CALL | inventory.reorderQueue |
| inventory/cycleCounts | `/inventory/cycle-counts` | `inventory/CycleCounts.jsx` | FB-CALL (`cycleCountCommandClient`) | inventory.cycleCount.count/.review |
| purchasing/purchaseOrders | `/purchasing` | `purchasing/PurchaseOrders.jsx` | FB-DOC | purchasing.purchaseOrders |
| purchasing/receipts | `/purchasing/receipts` | `purchasing/Receipts.jsx` | FB-DOC | receiving.checkIn |
| financials/invoices | `/financials/invoices` | `financials/FinancialsInvoices.jsx` (+detail) | FB-CALL (FIN-004) | financials.invoices |
| financials/payments | `/financials/payments` | `financials/FinancialsPayments.jsx` (+detail) | FB-CALL | financials.payments |
| administration/overview | `/administration/overview` | `administration/AdministrationOverview.jsx` | NONE (menu) | container |
| administration/users | `/administration/users` | `AdminUsers.jsx`, `UserDetail.jsx`, `EmployeeJobRoleControl.jsx` | **R-PG** | administration.users |
| administration/rolesPermissions | `/administration/roles-permissions` | `AdminRolesPermissions.jsx` | **R-PG** (+1 FB-CALL) | administration.rolesPermissions |
| administration/objects, /workflows, /permissionPreview | `/administration/...` | `AdminObjects.jsx`, `AdminWorkflows.jsx`, `AdminPermissionPreview.jsx` | **R-PG** | administration.* |
| administration/dataImport | `/administration/data-import` | `AdminDataImport.jsx` (Firebase id `admin.dataImport.stage`) | FB-CALL | administration.dataImport |
| administration/auditLogs | `/administration/audit-logs` | **`AdministrationUnavailable`** | NONE | administration.auditLogs |
| (outside nav) | `/my-profile` | `employees/MyEmployeeProfile.jsx` | **R-PG** | any persona past "No access" |
| (dark under EOS) | `/service/work-orders/new`, `/:workOrderId` | `workOrders/WorkOrderWizard.jsx`, `WorkOrderDetailPage.jsx` | FB | F2 (#1980) |

**Scanners** (every `ScanInput` consumer is a mode of `scan/ScanWorkspace.jsx`): `LookupScan`,
`TransferScan`, `CycleCountScan`, `PutAwayScan`, `MoveStockScan`, `PickScan`, `ReturnIntakeScan`. All
call Firebase callables (`binCommandClient` -> `recordPutAway`/`resolveBinToken`/`listBins`,
`transferCommandClient`, `cycleCountCommandClient`, `stockMovementClient`, `returnCommandClient`,
`partAliasCallableClient`); `binCallables.ts` authorizes via `resolveEffectiveAccess`.

---

## 3. Workspace composition map, by grouping

Cells name destination keys from §2. "Dash" = `dashboardComposition.js` module keys. IDs in the last row
point to the register in §4. `/my-profile` (R-PG) is in every workspace with >=1 surface and is omitted.

### 3.1 SERVICE OPERATIONS

| Dimension | service-manager (`fieldManager`) | service-coordinator-dispatcher (`dispatcher`) |
|---|---|---|
| Screens | serviceOperations, service/workOrders, jobAssignments, dispatch, dispatcherBoard, coordinatedVisits; customers, salesOrders; inventory/parts, partMaster, truckInventory; financials/invoices, payments; admin/auditLogs | serviceOperations, workOrders, jobAssignments, dispatch, dispatcherBoard, coordinatedVisits, service/scan; customers, opportunities, salesOrders, salesAgreements; parts, truckInventory, transfers, receiving, reorderQueue; purchaseOrders, receipts |
| Commands | dispatch/assign/schedule via `schedulingCommandClient`; `transitionWorkOrder`; WO create (wizard, dark) | same + receiving, transfer, reorder callables |
| Reads | `fieldops_wos`, `listCoordinatedOperations`, `accounts` | same + `reorder_requests`, POs |
| Dashboards | Dash `serviceAttention`, `workOrdersByStatus`, `technicianAvailability`, `technicianComparison`, `teamGoals` | same + `reorderQueue`, `receivingQueue` |
| Scanners | none | ScanWorkspace (receiving/lookup) |
| Queues | Dispatch queue, Dispatcher Board unassigned lane | same + Reorder Queue, receiving queue |
| Exceptions | ControlTower `AtRiskPanel`, `WorkOrderAttentionPanel` | same |
| Actions (PG-granted) | `workOrder.lifecycle.dispatch`, `.cancel`, `workOrder.create` | full WO lifecycle + commercial sell-side spine (census D-18) |
| Authority deps | surfaces service.workOrders/.dispatch/.coordinatedVisits | same + receiving.checkIn, inventory.reorderQueue |
| Firebase-era deps | Rules `isAdminOrDispatcher` on `fieldops_wos`; callables via `resolveEffectiveAccess` | legacy `users.role=dispatcher` (UNVERIFIED) |
| PG-ready deps | `workOrderLifecycle.ts`, `workOrderAssignmentAuthority.ts`, `coordinatedVisitPostgresRead.ts` (no Render route) | same + `reorderAssignmentAuthority.ts` |
| Missing composition | WO detail door (F2); Scheduling + Inbound Work unmapped; Job-Role landing | WO detail door (F2, held); Scheduling, Inbound Work |
| TRUE missing | Warranty claims (SV-11) | same |
| Register | SV-01..SV-11 | SV-01..SV-11 |

### 3.2 TECHNICIAN

| Dimension | service-technician (`technician` + WE `SERVICE_TECHNICIAN`) |
|---|---|
| Screens | dashboard/my = TechnicianDashboard; service/technicianWorkspace, coordinatedMission, scan; service/workOrders, jobAssignments, serviceOperations (earned by `workOrder.transition`) |
| Commands | `transitionWorkOrder`; `workOrderLaborCallableClient`, `workOrderInstallCallableClient`, `completionService`, `equipmentInstallCallableClient` |
| Reads | own `fieldops_wos` (`isOwnTechnician`), `workOrderReadinessContextClient`, truck stock |
| Dashboards | Dash `myAssignedWork`, `unverifiedSubmissions`, `myGoals`, `myPerformanceAllTime`, `technicianQualityMetrics` |
| Scanners | `LookupScan`, `ReturnIntakeScan` (via ScanWorkspace) |
| Queues | My assigned work |
| Exceptions | `unverifiedSubmissions` |
| Actions (PG-granted) | `workOrder.transition`, `workOrder.record.read` (own) |
| Authority deps | surface field.myWorkOrders (WE predicate) |
| Firebase-era deps | `users/{uid}.role` + `technicianId` -- absent for `finley.fixture@` |
| PG-ready deps | `workOrderLifecycle.ts` (transition), `truckFleetRepository.ts` (no Render route) |
| Missing composition | technician landing = Technician Workspace; trim team WO list from rail (presentation only) |
| TRUE missing | none proven (time entry has 0 repo hits -- need not established, §4.12) |
| Register | TC-01..TC-07 |

### 3.3 WAREHOUSE / INVENTORY

| Dimension | warehouse-associate | warehouse-manager |
|---|---|---|
| Screens | inventory/warehouseWorkspace, warehouses, cycleCounts (count), service/scan, transfers, parts, truckInventory, operationsDashboard, purchaseOrders, salesOrders | warehouses, cycleCounts (review), transfers, parts, partMaster, truckInventory, purchaseOrders, customers, salesOrders, admin/auditLogs |
| Commands | `recordPutAway`, pick, transfer, cycle-count line submit, `stockMovementClient` (relocate not held) | cycle-count review/reconcile, bin create/rename/deactivate (`binCommandClient`), transfers |
| Reads | `listBins`, `resolveBinToken`, `inventoryBalanceCallableClient`, `locationDisplayReadCallableClient` | same + count sheets |
| Dashboards | Dash `governedStockPosition`, `stockForecast` | same |
| Scanners | `PutAwayScan`, `PickScan`, `CycleCountScan`, `TransferScan`, `MoveStockScan`, `LookupScan` | `CycleCountScan`, `LookupScan` |
| Queues | pending-work (ScanWorkspace `onPendingWorkChange`), transfer list | cycle-count review queue |
| Exceptions | count variances | variance review; `inventory.cycleCount.close` 0 holders (D-17) |
| Actions (PG-granted) | `inventory.placement.record`, `inventory.cycleCount.count` | `inventory.cycleCount.review`/reconcile; bin admin = 0 caps |
| Firebase-era deps | callables via `resolveEffectiveAccess`; Rules opRole | same; `WarehouseManagerHome` (`operationalRoles`) |
| PG-ready deps | `warehouseBinRepository.ts`, `cycleCountRepository.ts`, `inventoryCommitmentRepository.ts` | same |
| Missing composition | orphaned `inventory/mobile/*Section.jsx` (6) | Warehouse Racking unmapped; `WarehouseManagerHome` content via governed doors |
| TRUE missing | none | none (Back Orders: projection exists, WH-10) |
| Register | WH-01..WH-11 | WH-01..WH-11 |

### 3.4 PARTS

| Dimension | parts-associate | parts-manager |
|---|---|---|
| Screens | inventory/parts, truckInventory, operationsDashboard, receiving, purchasing/receipts, service/scan; customers, salesOrders; workOrders; financials/invoices, payments | reorderQueue, purchaseOrders; parts, partMaster, truckInventory, transfers; customers, salesOrders; workOrders; invoices, payments; admin/auditLogs |
| Commands | receive stock (`receivingCallableClient`), `serializedAssetAcquireCallableClient` | reorder decide/convert (`reorderCallableClient`), PO create, `partMasterCommandClient` |
| Reads | `parts`, receipts | `reorder_requests`, POs, part master |
| Dashboards | Dash `receivingQueue` | Dash `reorderQueue`, `stockForecast` |
| Scanners | ScanWorkspace (receiving/lookup) | none |
| Queues | Receiving queue | Reorder Queue (`reorder.request.read.queue`/`.assign` 0 holders, D-07) |
| Exceptions | `Receiving.jsx` receipt exceptions | `PurchaseOrders.jsx` exceptions |
| Actions (PG-granted) | `inventory.receive`, receiving-clerk set | `reorder.*`, `purchaseOrder.*` (purchasingManager) |
| Firebase-era deps | Rules `parts` opRole; `PartsAssociateHome` (`operationalRoles`) | Rules `isActiveOperationalRole("PARTS_MANAGER")` on `reorder_requests` |
| PG-ready deps | Catalog alias authority BUILT/INERT; `eos_ops.parts` = 0 until COPY | `purchasingRepository.ts`, `supplierCatalogRepository.ts`, `reorderAssignmentAuthority.ts` (Reorder cutover #1961 HELD) |
| Missing composition | "My Purchasing" content via governed doors | Suppliers screen unmapped (vocabulary) |
| TRUE missing | none | Purchasing Quotes, Demand Planning (PT-09, PT-10) |
| Register | PT-01..PT-11 | PT-01..PT-11 |

### 3.5 RETAIL SALES (distinct Job Role; same Security Role as 3.6 by design)

| Dimension | retail-sales (`salesperson`) |
|---|---|
| Screens | customers, opportunities, salesOrders, salesAgreements; financials/invoices, payments; parts, truckInventory |
| Commands | opportunity create/transition, create SO, accept agreement (`opportunityCommandClient`, `salesOrderCommandClient`, `salesAgreementCommandClient` -- FB); PG mutations fenced (F3) |
| Reads | `listOpportunityContext` (FB), `listSalesAgreements` (R-PG), accounts (FB) |
| Dashboards | Dash `myOpportunities`, `ordersRequiringAction`, `myBooked`, `accountPortfolio`, `myGoals` |
| Scanners / Queues | none / orders requiring action |
| Exceptions | none dedicated |
| Actions (PG-granted) | `opportunity.write`, `salesAgreement.accept`, `opportunity.createSalesOrder` -- hidden (F8), fenced (F3) |
| Firebase-era deps | `resolveEffectiveAccess`; Rules `isAdminOrDispatcher` on `accounts` |
| PG-ready deps | Render `/commercial/` reads: `listOpportunities`, `listSalesOrders`, `listSalesAgreements` (0 rows) |
| Missing composition | default `salesChannel = RETAIL` filter; wire orphaned `SalesWorkspace.jsx` (Channel column) |
| TRUE missing | none proven (counter/POS sale: 0 repo hits, need unconfirmed, §4.12) |
| Register | CS-01..CS-09, RS-01..RS-02 |

### 3.6 NATIONAL ACCOUNTS SALES (distinct Job Role)

| Dimension | national-accounts-sales (`salesperson`) |
|---|---|
| Screens / Commands / Reads / Actions / Firebase / PG deps | identical to 3.5 (same Role, 8 surfaces / 10 destinations) |
| Dashboards | same modules; `accountPortfolio` is the natural lead |
| Missing composition | agreements-led landing (`SalesAgreementsList` first); default `salesChannel = NATIONAL_ACCOUNTS` filter; coverage view from `domain/commercialCoverage.js` (no consumer UI) over `coverage/coverageReadCallables.ts` |
| TRUE missing | none proven (contract pricing: 0 repo hits; account hierarchy only in `domain/commercialProfile.js`; need unconfirmed, §4.12) |
| Must not build | a per-channel Security Role or channel-scoped visibility without an Owner coverage ruling |
| Register | CS-01..CS-09, NA-01..NA-03 |

### 3.7 FINANCE / ACCOUNTING

| Dimension | finance-accounting (`accountingManager`) |
|---|---|
| Screens | financials/invoices, payments (+details); customers, opportunities, salesOrders; parts, truckInventory, transfers; purchaseOrders; admin/auditLogs |
| Commands | none exposed (read-side) |
| Reads | `listFinancialFacts` / `financeReadCallableClient` (FIN-004 Firestore, temporary, F5) |
| Dashboards | Dash `firmBilled`, `firmCollected`, `firmBooked`, `costImpact` -- GATED (no `finance.visibility.*` surface) |
| Queues / Exceptions | `FinancialsBillingQueue.jsx`, `FinancialsReconciliation.jsx`, `FinancialsAccountsReceivable.jsx` -- built, unmapped |
| Actions (PG-granted) | `finance.invoice.read`, payment read |
| Firebase-era deps | FIN-004 loader; `acctmgr@` Firebase `financeManager` assignment (UNVERIFIED) |
| PG-ready deps | `invoiceAuthority.ts`, `cashApplicationAuthority.ts`, `invoiceTotals.ts`; `eos_finance` 0 rows, no Render route |
| Missing composition | 18 built `Financials*.jsx` stay hidden until authority (do not invent figures) |
| TRUE missing | none (screens and domain exist; authority missing) |
| Register | FN-01..FN-06 |

### 3.8 REPORTING

| Dimension | reporting-analyst (`reportViewer`, 1 cap `reportDefinition.read`) |
|---|---|
| Screens | none reachable -- "No access"; `reporting/ReportBuilder.jsx`, `SavedReports.jsx` exist, unmapped |
| Commands / Reads | report execution + saved reports via Firebase (`functions/src/reporting/reportCatalog.ts`) |
| Dashboards / Scanners / Queues / Exceptions | none |
| Authority deps | needs a server surface on `reportDefinition.read` + `NAV_SURFACE_ACCESS` row + removal of `reporting/*` gaps |
| Firebase-era deps | Firebase capability feed over `report.*` ids not in `eos_policy.capabilities` |
| PG-ready deps | none (no PG report read) |
| Missing composition | the door itself; `/my-profile` unreachable behind "No access" |
| TRUE missing | none proven for Builder/Saved; 8 domain report pages are placeholders (RP-03 VERIFY) |
| Register | RP-01..RP-04 |

### 3.9 MANAGEMENT / OWNER

| Dimension | owner-executive (`owner`) | general-manager (`generalManager`) |
|---|---|---|
| Screens | Administration suite (overview, users, rolesPermissions, objects, workflows, permissionPreview, auditLogs); customers, opportunities, salesOrders, salesAgreements; serviceOperations, workOrders, jobAssignments, coordinatedVisits; equipment; parts, partMaster, truckInventory, transfers, reorderQueue; purchaseOrders; invoices, payments; operationsDashboard | admin overview, users, auditLogs; sales set; serviceOperations, workOrders, jobAssignments; parts, partMaster, truckInventory, transfers; purchaseOrders; invoices, payments |
| Commands | policy/role/grant administration (R-PG); Job Role assignment (`EmployeeJobRoleControl`) | employee administration (R-PG) |
| Reads | `adminPolicyApiClient`, `workforceApiClient` (R-PG); rest FB | same subset |
| Dashboards | Dash `adminDecisions` (GATED), `firm*` (GATED), `teamGoals`, `workOrdersByStatus` | same |
| Queues / Exceptions | role-request decisions (`adminDecisions`, GATED); ControlTower `AtRiskPanel` | same |
| Actions (PG-granted) | 50 caps; owner-exclusion contract withholds dispatch, receiving, dataImport | 32 caps |
| Firebase-era deps | no Firebase Role doc: every non-admin screen refused | same |
| PG-ready deps | Render admin + workforce + commercial reads; `listEmployees` (EMP-RT-01) | same |
| Missing composition | Audit Logs screen over existing `readPolicyAuditHistory`; employee directory door; WO create-only door (F2 b) | same |
| TRUE missing | none | none |
| Register | MO-01..MO-09 | MO-01..MO-09 |

### 3.10 OFFICE / ADMINISTRATION

| Dimension | office-administration (`admin`) | office-manager (`officeManager`) |
|---|---|---|
| Screens | everything the Owner earns except reorderQueue, plus dispatch, dispatcherBoard, receiving, receipts, scan, dataImport | customers; workOrders, jobAssignments, serviceOperations (via `workOrder.create`) |
| Commands | all admin (R-PG); Data Import staging (FB-CALL) | WO create (wizard dark, F2 b) |
| Reads | R-PG admin; FB elsewhere | `accounts`, `fieldops_wos` (FB, refused) |
| Dashboards | Dash `adminDecisions` (on Firebase `role`) | Dash none earned beyond container |
| Queues / Exceptions | as owner + dispatch | none |
| Firebase-era deps | legacy `users.role=admin` (UNVERIFIED) | none held |
| PG-ready deps | Render admin + workforce; `workOrderCreateCommand.ts` | `workOrderCreateCommand.ts` (no Render route) |
| Missing composition | 8 unmapped admin destinations (below); Vehicles over truck registry | contacts (vocabulary) |
| TRUE missing | Regions, Company Settings, Integrations, Notification history (OA-08..OA-10) | none |
| Register | OA-01..OA-10 | OA-01..OA-10 |

### 3.11 GENERAL EMPLOYEE

| Dimension | general-employee (no Security Role) |
|---|---|
| Screens | none -- "No access" (correct: holds nothing) |
| Everything else | none; `/my-profile` unreachable because the "No access" branch returns before routes render |
| TRUE missing | none proven (time entry: 0 repo hits, need unconfirmed, §4.12) |
| Register | GE-01..GE-02 |

---

## 4. Classification register (every proposed workspace item)

### 4.1 SERVICE OPERATIONS
| ID | Item | Class | Evidence / condition |
|---|---|---|---|
| SV-01 | ControlTower + AtRisk/Attention panels | REPAIR | FB-DOC `fieldops_wos` under `isAdminOrDispatcher`; PG-only fieldManager refused |
| SV-02 | Work Orders list, Job Assignments | REPAIR | same Rules; `workOrderLifecycle.ts` has no Render route (F7) |
| SV-03 | WO detail + wizard routes | VERIFY | #1980 HELD; guard admits {admin, dispatcher, fieldManager}; data still FB |
| SV-04 | Dispatch + Dispatcher Board | REPAIR | fieldManager's PG `workOrder.lifecycle.dispatch`/`.cancel` unusable from FB screens |
| SV-05 | Coordinated Visits | REPAIR | FB-CALL; PG seam `coordinatedVisitPostgresRead.ts` exists, unexposed |
| SV-06 | Scheduling / Dispatch Scheduling workspaces | REPAIR | screens exist; `NAV_SURFACE_GAPS`: `dispatchSchedule` retired, no distinct surface |
| SV-07 | Inbound Work workspace | REPAIR | `service.inboundWork.read` is Firebase-only, not in `eos_policy` |
| SV-08 | Service dashboard modules (serviceAttention, workOrdersByStatus, technicianAvailability/Comparison, teamGoals) | VERIFY | composition EOS-aware; data FB |
| SV-09 | Dispatcher workspace end to end | VERIFY | depends on legacy `users.role=dispatcher` on `dispatcher@` |
| SV-10 | Job-Role landing (service-manager -> ControlTower) | INTEGRATE | needs Job Role in `resolveExperienceContext` (returns none today); presentation only |
| SV-11 | Warranty claims | TRUE_GAP | `NAV_SURFACE_GAPS["service/warranty"]`: "No warranty domain, no capability, no backend" (warranty fields exist on equipment/WO only) |

### 4.2 TECHNICIAN
| ID | Item | Class | Evidence / condition |
|---|---|---|---|
| TC-01 | TechnicianDashboard | REPAIR | FB-DOC keyed on `users.technicianId` (absent) |
| TC-02 | TechnicianShell / FieldMode | REPAIR | same |
| TC-03 | Coordinated Mission | REPAIR | FB-CALL |
| TC-04 | Scan: Lookup, ReturnIntake | REPAIR | callables via `resolveEffectiveAccess` |
| TC-05 | Labor / install / completion commands | REPAIR | `workOrderLabor`/`Install` callables, FB |
| TC-06 | Team WO list + WO detail on technician rail | VERIFY | #1980 Owner decision (a); regression test records list as intended |
| TC-07 | Technician landing = Technician Workspace | INTEGRATE | `dashboardComposition` already selects TechnicianDashboard; rail trim is presentation |

### 4.3 WAREHOUSE / INVENTORY
| ID | Item | Class | Evidence / condition |
|---|---|---|---|
| WH-01 | WarehouseShell + Put-away / Pick scan | VERIFY | Phase 3 granted `inventory.placement.record` in nonprod, but `binCommandClient` header says bin/placement capabilities `active:false`; callable path is FB feed |
| WH-02 | Transfer / MoveStock scan, Transfers screen | REPAIR | FB callables; relocate unassigned by ruling |
| WH-03 | Cycle Counts (count/review) + CycleCountScan | REPAIR | FB callables; `cycleCountRepository.ts` unexposed |
| WH-04 | `inventory.cycleCount.close` | VERIFY | 0 holders (D-17) -- Owner grant decision |
| WH-05 | Warehouses | REPAIR | FB-CALL + FB-DOC |
| WH-06 | Warehouse Racking (`AdminWarehouseRacking.jsx`) | REPAIR | `inventory.location.bin.*` not registered; bin admin holds 0 caps |
| WH-07 | `WarehouseManagerHome` content | INTEGRATE | legacy `operationalRoles` domain must get no surface; route content through governed doors (as Reorder Queue did) |
| WH-08 | Operations dashboard + stock dashboard modules | VERIFY | FB-DOC; `stockForecast` is derived info (Decision #161) |
| WH-09 | orphaned `inventory/mobile/*Section.jsx`, `TruckManagementPreview.jsx` | INTEGRATE | built; no route imports them |
| WH-10 | Back Orders | VERIFY | nav says "no backend", but `fulfillment/allocationProjection.ts` projects back-orders |
| WH-11 | Manufacturers | REPAIR | "Rules-closed for every persona"; `manufacturerAuthority.ts` exists |

### 4.4 PARTS
| ID | Item | Class | Evidence / condition |
|---|---|---|---|
| PT-01 | Parts list/detail | REPAIR | Rules `parts` on opRole/admin/dispatcher |
| PT-02 | Part Master (catalog admin) | VERIFY | alias authority BUILT/INERT; `eos_ops.parts` = 0 until coordinated COPY |
| PT-03 | Receiving + Receipts + receiving queue | REPAIR | FB callable/FB-DOC |
| PT-04 | Reorder Queue (`PartsManagerHome`) | REPAIR | Rules `isActiveOperationalRole`; Reorder cutover #1961 HELD |
| PT-05 | `reorder.request.read.queue` / `.assign` holders | VERIFY | 0 holders (D-07) -- Owner grant decision |
| PT-06 | Purchase Orders (+exceptions) | REPAIR | FB-DOC; canonical PO empty in nonprod; `purchasingRepository.ts` unexposed |
| PT-07 | Suppliers | REPAIR | screen exists; no `supplier.*` capability; `supplierCatalogRepository.ts` exists |
| PT-08 | `PartsAssociateHome` ("My Purchasing") | INTEGRATE | legacy construct; compose via governed doors |
| PT-09 | Purchasing Quotes | TRUE_GAP | `NAV_SURFACE_GAPS`: "No quote domain exists"; 0 hits for supplierQuote/rfq |
| PT-10 | Demand Planning | TRUE_GAP | "No demand-planning domain exists"; only `navConfig.js` matches (`stockForecast` is adjacent, not planning) |
| PT-11 | Parts dashboard modules (`reorderQueue`, `receivingQueue`) | VERIFY | FB data |

### 4.5 COMMERCIAL (shared by RETAIL SALES and NATIONAL ACCOUNTS SALES)
| ID | Item | Class | Evidence / condition |
|---|---|---|---|
| CS-01 | Sales Agreements index | VERIFY | PARTIAL_AUTHORITY (F4): R-PG list, 0 rows; detail FB |
| CS-02 | Opportunities list/detail/new | REPAIR | `listOpportunityContext` via `resolveEffectiveAccess`; Render `listOpportunities` exists |
| CS-03 | Sales Orders | REPAIR | FB; Render `listSalesOrders` exists |
| CS-04 | Customers / AccountDetail | REPAIR | Rules `isAdminOrDispatcher` on `accounts`; CRM PG writer FROZEN |
| CS-05 | Commercial writes (create/transition/accept) | VERIFY | #1972 fence HELD: PG INACTIVE, Firestore OPEN; one-writer cutover pending |
| CS-06 | Sales dashboard modules | VERIFY | FB data |
| CS-07 | orphaned `AccountOpportunitiesSection` / `AccountSalesOrdersSection` / `SalesAgreementPanel` | INTEGRATE | built, unrouted |
| CS-08 | orphaned `SalesWorkspace.jsx` pipeline | INTEGRATE | built, unrouted; wire, don't rewrite |
| CS-09 | Contacts | REPAIR | `EXPERIENCE_SURFACE_GAPS["crm.contacts"]` VOCABULARY; `eosCrm/contactAuthority.ts` command exists |

### 4.6 RETAIL SALES / 4.7 NATIONAL ACCOUNTS SALES (kept distinct)
| ID | Item | Class | Evidence / condition |
|---|---|---|---|
| RS-01 | Default `salesChannel = RETAIL` filter/sort | INTEGRATE | `salesChannel` on Opportunity/SO; no list filters it today |
| RS-02 | Retail landing (pipeline-led: `myOpportunities`) | INTEGRATE | needs Job Role in experience context (SV-10) |
| NA-01 | Agreements-led landing | INTEGRATE | depends on CS-01 |
| NA-02 | Default `salesChannel = NATIONAL_ACCOUNTS` filter | INTEGRATE | same field as RS-01 |
| NA-03 | Coverage view (`domain/commercialCoverage.js`) | VERIFY | pure domain, no UI; Owner coverage-model ruling required before any scoping |

### 4.8 FINANCE / ACCOUNTING
| ID | Item | Class | Evidence / condition |
|---|---|---|---|
| FN-01 | Invoices / Payments (+details) | VERIFY | temporary Firestore reader (F5, #1981 HELD); `acctmgr@` reach UNVERIFIED |
| FN-02 | 18 other `Financials*.jsx` (Billing Queue, AR, Reconciliation, ...) | REPAIR | `NAV_SURFACE_GAPS["financials/*"]`: no authority (FIN-001/FIN-004); keep hidden |
| FN-03 | `firm*` / `costImpact` dashboard modules | REPAIR | GATED: no `finance.visibility.*` surface |
| FN-04 | Financial Policy admin | REPAIR | no registered capability |
| FN-05 | PG finance read (`eos_finance` via Render) | REPAIR | `invoiceAuthority.ts` exists; 0 rows, no Render route |
| FN-06 | Finance landing (Invoices first) | INTEGRATE | presentation only |

### 4.9 REPORTING
| ID | Item | Class | Evidence / condition |
|---|---|---|---|
| RP-01 | Reporting door for `reportDefinition.read` | REPAIR | holds the cap; no surface declared (F6) |
| RP-02 | Report Builder / Saved Reports | REPAIR | built; Firebase `report.*` ids not in PG |
| RP-03 | 8 domain report pages | VERIFY | navHidden placeholders; `reporting/reportCatalog.ts` may define them |
| RP-04 | `/my-profile` behind "No access" | VERIFY | Owner product question (shared with GE-02) |

### 4.10 MANAGEMENT / OWNER
| ID | Item | Class | Evidence / condition |
|---|---|---|---|
| MO-01 | Administration suite (Overview, Roles & Permissions, Objects, Workflows) | KEEP | R-PG |
| MO-02 | Permission Preview | KEEP | R-PG `getPrincipalEffectiveAccess` |
| MO-03 | Users + `EmployeeJobRoleControl` | KEEP | R-PG workforce |
| MO-04 | Audit Logs screen | INTEGRATE | `readPolicyAuditHistory` exists in `adminPolicyApi.ts` and client allow-list; door renders `AdministrationUnavailable` |
| MO-05 | Employee directory door | INTEGRATE | `listEmployees` (EMP-RT-01, `employeeDirectoryReads.ts`) R-PG; `employees.directory` not a surface |
| MO-06 | Cross-domain Service/Inventory/Finance screens | REPAIR | no Firebase Role doc (F1) |
| MO-07 | WO create-only door (owner, GM) | VERIFY | #1980 Owner decision (b) |
| MO-08 | `adminDecisions` dashboard | REPAIR | gated on Firebase `role`; `admin.roleAssignment.write` earns no surface |
| MO-09 | Owner/GM landing (ControlTower + admin) | INTEGRATE | presentation only |

### 4.11 OFFICE / ADMINISTRATION and GENERAL EMPLOYEE
| ID | Item | Class | Evidence / condition |
|---|---|---|---|
| OA-01 | Administration suite for `admin@` | KEEP | R-PG |
| OA-02 | All FB screens for `admin@` | VERIFY | legacy `users.role=admin` UNVERIFIED |
| OA-03 | Data Import | VERIFY | Firebase id `admin.dataImport.stage`; ruled nonprod tooling |
| OA-04 | office-manager Customers | REPAIR | Rules `isAdminOrDispatcher` |
| OA-05 | office-manager WO create | VERIFY | #1980 decision (b) |
| OA-06 | Duplicate Rules, Email Communications | REPAIR | screens exist; no registered capability / Firebase-only id |
| OA-07 | Vehicles | INTEGRATE | `truckRegistry/*` commands + callables and `truckFleetRepository.ts` exist; destination is a hidden placeholder |
| OA-08 | Regions, Company Settings | TRUE_GAP | "Hidden placeholder, no backend"; `companySettings` matches only `navConfig.js` |
| OA-09 | Integrations | TRUE_GAP | "No integrations domain exists" (`IntegrationsFaq.jsx` is static FAQ) |
| OA-10 | Notification history | TRUE_GAP | "for the full notification history, which is not built yet"; 0 hits for a history read |
| GE-01 | "No access" for general-employee | KEEP | P16 negative control |
| GE-02 | `/my-profile` for a no-authority Employee | VERIFY | Owner product question |

### 4.12 Evidence-of-absence, need NOT established (not classified, not counted)

| Candidate | Grouping | Repo evidence |
|---|---|---|
| Retail counter / POS sale | RETAIL SALES | 0 hits for counterSale / pointOfSale |
| Contract pricing / price lists | NATIONAL ACCOUNTS | 0 hits for priceList / contractPricing |
| Time entry / timesheets | TECHNICIAN, GENERAL EMPLOYEE | 0 hits for timesheet / timeClock / clockIn |

These become TRUE_GAP only on an Owner statement that the business needs them.

### 4.13 Counts

| Class | Count | IDs |
|---|---|---|
| KEEP | 5 | MO-01, MO-02, MO-03, OA-01, GE-01 |
| INTEGRATE | 16 | SV-10, TC-07, WH-07, WH-09, PT-08, CS-07, CS-08, RS-01, RS-02, NA-01, NA-02, FN-06, MO-04, MO-05, MO-09, OA-07 |
| VERIFY | 23 | SV-03, SV-08, SV-09, TC-06, WH-01, WH-04, WH-08, WH-10, PT-02, PT-05, PT-11, CS-01, CS-05, CS-06, NA-03, FN-01, RP-03, RP-04, MO-07, OA-02, OA-03, OA-05, GE-02 |
| REPAIR | 35 | SV-01, SV-02, SV-04..07, TC-01..05, WH-02, WH-03, WH-05, WH-06, WH-11, PT-01, PT-03, PT-04, PT-06, PT-07, CS-02..04, CS-09, FN-02..05, RP-01, RP-02, MO-06, MO-08, OA-04, OA-06 |
| TRUE_GAP | 6 | SV-11, PT-09, PT-10, OA-08, OA-09, OA-10 |
| **Total** | **85** | |

---

## 5. Integration-owned edits Phase C will need (DESCRIBED, NOT MADE)

Single integration writer for `App.jsx` / `navConfig.js` / `AppShell`. Grouping stays a subset of granted
surfaces and grants nothing (`SERVICE_NAV_GROUPS`, `FINANCIALS_NAV_GROUPS`, `buildNavGroups`).

1. **WO routes** -- land #1980 after Owner decisions (a)/(b) (SV-03, TC-06, MO-07, OA-05).
2. **Audit Logs** -- compose a screen over `readPolicyAuditHistory` (MO-04) rather than remove the door.
3. **Job-Role landing / grouping** -- needs `jobRole` in `resolveExperienceContext` (presentation only,
   never a gate) (SV-10, TC-07, RS-02, NA-01, FN-06, MO-09).
4. **Reporting** -- server surface on `reportDefinition.read` + nav row + gap removal + a PG report read
   (RP-01, RP-02). No nav edit alone closes it.
5. **Leave alone** -- `inventoryRole/*` as destinations (compose content via governed doors), the 18
   Financials pages (no authority), Contacts / Scheduling / Suppliers (vocabulary).
6. **The real gate (not a nav edit)** -- for 10 of 16 personas the composed workspace is refused until the
   screens' data paths move to Render PG (F7 modules exposed, one-writer cutovers), or the personas gain
   Firebase authority, which the registry forbids. **Owner decision.**

## 6. Open items for the Owner (surfaced, not decided)

1. Data-path precondition (§5.6) -- accept doors-refused until PG reads, or sequence the F7 exposures.
2. #1980 decisions (a) technician detail and (b) create-only door.
3. Reporting-analyst holds `reportDefinition.read` and earns nothing.
4. General employee (and reporting) and `/my-profile`.
5. Grants with 0 holders: `inventory.cycleCount.close`, `reorder.request.read.queue`, `reorder.request.assign`.
6. Whether §4.12 candidates are business needs.
7. Stale repo fact: the registry still says `reporting@` `accountExists: false`; Persona Foundation
   records it as created 2026-09-25 (not a repo artifact; not relied on here).
