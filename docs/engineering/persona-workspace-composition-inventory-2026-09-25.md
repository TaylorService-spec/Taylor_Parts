---
artifact_type: inventory
unit: Phase C PREPARATION -- persona workspace composition inventory (16 canonical Job Roles)
status: HOLD -- preparation only; Phase C is not open (waits on Phase A live evidence and the Phase B freeze)
base: main 09d63c4e
evidence_class: REPO-DERIVED throughout. Nothing in this document was observed live.
authorizes: nothing -- no UI, navigation, grant, role, route or data change
---

# Persona workspace composition inventory (2026-09-25)

**Every claim here is REPO-DERIVED.** Surfaces are computed from source and the recorded grant baseline,
not read from a running system. Where a claim depends on live state the repo cannot show (Firebase
`users/{uid}` documents, for example), it is marked **UNVERIFIED**.

Owner direction for Phase C (quoted for scope): *"Assemble existing screens into the 16 employee
experiences. Keep Retail Sales and National Accounts Sales distinct Job Roles. One integration writer
owns App.jsx/navConfig/AppShell. Do not invent business figures or expose actions the server refuses."*

This inventory exists so Phase C **assembles** screens instead of rebuilding them. It changes no code.

---

## 0. Method and inputs

| Input | Used for |
|---|---|
| `functions/src/eosWorkforce/jobRoleVocabulary.ts` `CANONICAL_JOB_ROLES` | the 16 Job Roles |
| `config/sandboxRoleIdentityRegistry.json` | canonical login per Job Role, ruled `expectedSecurityRoles` (finance: `accountingManager`, reporting: `reportViewer`, general-employee: none) |
| `docs/testing/persona-business-connection-census.md` + `functions/scripts/fixtures/personaAuthorityDimensions.v1.json` | Security Roles, Work Eligibility and Operational Scope held by each persona |
| `functions/src/adminPolicy/seed/roleCapabilityAuthorityBaseline.json` (413 grants, rebuild total, recorded nonprod 2026-09-24) | Role -> capability |
| `functions/src/eosOps/experienceAuthority.ts` `EXPERIENCE_SURFACES` / `grantedSurfaceKeys` | capability (+ WE/scope predicate) -> surface |
| `field-ops-app-vite/src/navigation/navConfig.js` `NAV_SURFACE_ACCESS`, `NAV_SURFACE_GAPS`, `NAV_CONTAINERS` | surface -> destination |
| `field-ops-app-vite/src/App.jsx` `renderSubnavItem` + `<Routes>` | destination -> component, plus detail routes |
| `config/environments.json` | `EOS_NAVIGATION_AUTHORITY_READY` is `true` **only** in `platform-sandbox` |
| `firestore.rules`, `functions/src/**` callables | whether a screen's backend honors a PG-only persona |
| client import-graph scan (static, depth 4, tests excluded) | each screen's transport: Render PG / Firebase callable / direct Firestore |

**How the surfaces were derived.** `grantedSurfaceKeys` was re-implemented over the baseline grants and
each persona's Work Eligibility and Scope. The result was then checked against the per-persona counts
pinned in `functions/test/personaBusinessAccessRegression.test.mjs` (`EXPECTED_SURFACE_COUNTS`), and it
matches for every persona the test covers. The two deltas below are explained by live state the test
manifest does not carry:

| Persona | Pinned (manifest) | Derived (live dimensions) | Why they differ |
|---|---|---|---|
| owner-executive | 21 | **22** | The census shows the Owner/Executive **Employee** holds `REORDER_QUEUE:taylor`. After the Owner/Admin split that Employee links to the `owner` Principal, so `inventory.reorderQueue` resolves. This depends on that scope row surviving the relink (UNVERIFIED). |
| warehouse-associate | 7 | **8** | Phase 3 assigned `inventoryPutAwayOperator` (`inventory.placement.record`) to this Principal. The test manifest predates that assignment, so it still pins `warehouse.picking` as earnable by nobody. |

Other manifest-vs-registry divergences, none of which change a count: finance is `controller` in the
manifest and `accountingManager` in the registry (their capability sets are identical); parts-associate
has `REORDER_QUEUE` in the manifest and no scope live (it holds no `reorder.request.read`, so there is no
effect); general-employee is `generalEmployee` in the manifest and holds no Role in the registry (0
capabilities either way).

---

## 1. Headline -- reachability per Job Role (DERIVED, platform-sandbox, EOS navigation source)

**Why the navigation and the data disagree.** Under the EOS source, navigation is earned from
**PostgreSQL** capabilities. Almost every screen behind those doors reads **Firebase**:

- **Firestore Rules** gate on `users/{uid}.role in {admin, dispatcher}`, `isTechnician()`, or
  `employees/{id}.operationalRoles`. Examples: `fieldops_wos` read, `accounts` read, `parts` read,
  `equipment` read.
- **Callables** gate on the Firestore effective-access feed (`resolveEffectiveAccess`), for example
  `listOpportunityContext`, or on the FIN-004 Firestore loader (`listFinancialFacts`).

The registry states that the canonical chain creates **no Firebase business authority**. Census D-25 /
`personaE2EScenarios.v1.json` record `GOVERNED_PERSONA_HAS_NO_CLIENT_ROLE`. So a PG-only persona is
**shown doors whose data the server refuses**.

| # | Job Role | Login (registry) | Security Roles (PG) | Firebase-side authority | Surfaces | Destinations (incl. `dashboard/my`) | Screens whose backend honors this persona | Verdict |
|---|---|---|---|---|---|---|---|---|
| 1 | owner-executive | `eos-owner@` | `owner` (50) | none (registry: no Firebase Role doc) | 22 | 26 | Administration suite (Users, Roles & Permissions, Objects, Workflows, Permission Preview) on Render; Sales Agreements list (PG, 0 rows); `/my-profile` | **PARTIAL** -- administration only |
| 2 | office-administration | `admin@` | `admin` (69) | legacy sbx account; `users.role = admin` expected, **UNVERIFIED** | 24 | 31 | all, **if** the legacy Firebase role holds | **USABLE (conditional)** |
| 3 | general-manager | `bailey.fixture@` | `generalManager` (32) | none | 15 | 19 | Users (Render workforce); Sales Agreements (PG, empty); `/my-profile` | **PARTIAL** |
| 4 | office-manager | `casey.fixture@` | `officeManager` (4) | none | 2 | 5 | `/my-profile` only | **DOORS, DATA REFUSED** |
| 5 | service-manager | `devon.fixture@` | `fieldManager` (16) | none | 12 | 17 | `/my-profile` only | **DOORS, DATA REFUSED** |
| 6 | service-coordinator-dispatcher | `dispatcher@` | `dispatcher` (31) + `REORDER_QUEUE:taylor` | legacy sbx account; `users.role = dispatcher` expected, **UNVERIFIED** | 13 | 20 | all, **if** the legacy Firebase role holds | **USABLE (conditional)** |
| 7 | service-technician | `finley.fixture@` | `technician` (4) + WE `SERVICE_TECHNICIAN` | none (no `users.technicianId`) | 2 | 7 | `/my-profile` only | **DOORS, DATA REFUSED** |
| 8 | parts-associate | `logan.fixture@` | `partsAssociate` + `inventoryReceivingClerk` (13) + WE `PARTS_OPERATIONS` | none | 8 | 14 | `/my-profile` only | **DOORS, DATA REFUSED** |
| 9 | parts-manager | `kai.fixture@` | `partsManager` + `purchasingManager` (22) + `PARTS_OPERATIONS` + `REORDER_QUEUE:taylor` | none | 13 | 17 | `/my-profile` only | **DOORS, DATA REFUSED** |
| 10 | warehouse-associate | `noor.fixture@` | `warehouseAssociate` + `inventoryCycleCountCounter` + `inventoryPutAwayOperator` (13) + `WAREHOUSE_OPERATIONS` + `WAREHOUSE:SC-WH-MAIN` | none | 8 | 11 | `/my-profile` only | **DOORS, DATA REFUSED** |
| 11 | warehouse-manager | `morgan.fixture@` | `warehouseManager` + `inventoryCycleCountReconciler` + `inventoryBinAdministrator` (15) + `WAREHOUSE_OPERATIONS` + 2 warehouses | none | 11 | 13 | `/my-profile` only | **DOORS, DATA REFUSED** |
| 12 | retail-sales | `harper.fixture@` | `salesperson` (17) | none | 8 | 10 | Sales Agreements list (PG, 0 rows); `/my-profile` | **DOORS, DATA REFUSED** (one empty PG list) |
| 13 | national-accounts-sales | `jules.fixture@` | `salesperson` (17) | none | 8 | 10 | same as retail-sales | **DOORS, DATA REFUSED** (identical to #12) |
| 14 | finance-accounting | `acctmgr@` | `accountingManager` (17) | legacy `sbx-acctmgr` users doc + Firebase `financeManager` assignment (2026-08-19 manifest); FIN-004 reach **UNVERIFIED** | 11 | 13 | `/my-profile`; Financials Invoices/Payments **only if** FIN-004 reach resolves in Firestore | **UNVERIFIED**, likely refused |
| 15 | reporting-analyst | `reporting@` | `reportViewer` (1: `reportDefinition.read`) | none | **0** | 0 | none -- the "No access" page, and `/my-profile` is unreachable behind it | **NO ACCESS** (unintended) |
| 16 | general-employee | `restricted@` | none | legacy account, no business role | **0** | 0 | none -- "No access" | **NO ACCESS** (by design, negative control) |

Capability counts are distinct capabilities across the persona's Roles, taken from the baseline.

**Summary (DERIVED):**

- **2 of 16** have a usable workspace end to end: office-administration and the dispatcher. Both are
  conditional, and both rely on a **legacy sbx-era Firebase role** rather than the governed chain.
- **2** are partial through Render-backed screens: owner-executive (administration) and general-manager
  (Users).
- **10** are shown a navigation whose screens the Firebase backends would refuse (finance is unverified).
- **2** get "No access": reporting-analyst (a gap) and general-employee (correct).

---

## 2. Screen catalog -- the components Phase C assembles (REPO-DERIVED)

Transport key:

- **R-PG**: Render API over PostgreSQL. Authorized by the PG capability, so it honors every persona.
- **FB-CALL**: Firebase callable, authorized by the Firestore effective-access feed or a Firestore loader.
- **FB-DOC**: direct Firestore read, authorized by Rules on `users/{uid}.role` or `operationalRoles`.
- **NONE**: no backend.

### 2a. Destinations with a surface (36 mapped + the `dashboard/my` container)

| Destination | Route | Component (file under `field-ops-app-vite/src/`) | Transport | Surface(s) that open it |
|---|---|---|---|---|
| dashboard/my | `/dashboard` | `modules/dashboard/MyDashboard.jsx`, or `modules/technicianDashboard/TechnicianDashboard.jsx` when FIELD_WORK (`domain/dashboardComposition.js`) | FB-CALL + FB-DOC per module | container: any visible child |
| dashboard/operationsDashboard | `/dashboard/operations` | `modules/operations/Operations.jsx` | FB-DOC | inventory.balances, inventory.catalog |
| customers/customers | `/customers` | `modules/accounts/AccountsList.jsx` (detail `/customers/:accountId` `AccountDetail.jsx`) | FB-CALL + FB-DOC (`accounts`: `isAdminOrDispatcher`) | crm.accounts |
| customers/opportunities | `/customers/opportunities` | `modules/sales/OpportunityList.jsx` (detail `OpportunityDetail.jsx`) | FB-CALL (`listOpportunityContext` -> `resolveEffectiveAccess`) | commercial.opportunities |
| customers/salesOrders | `/customers/sales-orders` | `modules/sales/SalesOrdersList.jsx` (detail `SalesOrderDetail.jsx`) | FB-CALL + FB-DOC | commercial.salesOrders |
| customers/salesAgreements | `/customers/sales-agreements` | `modules/sales/SalesAgreementsList.jsx` | **R-PG** (`commercialApiClient` `listSalesAgreements`); **detail** `SalesAgreementDetail.jsx` is FB-CALL | commercial.agreements |
| serviceOperations/serviceOperations | `/service-operations` | `modules/controlTower/ControlTower.jsx` | FB-DOC (`fieldops_wos`) + FB-CALL | service.workOrders |
| service/workOrders | `/service` | `modules/workOrders/WorkOrdersList.jsx` | FB-DOC (`fieldops_wos`: admin/dispatcher/own-tech) | service.workOrders |
| service/jobAssignments | `/service/job-assignments` | `modules/jobs/Jobs.jsx` | FB-DOC + FB-CALL | service.workOrders |
| service/dispatch | `/service/dispatch` | `modules/dispatch/Dispatch.jsx` | FB-DOC + FB-CALL | service.dispatch |
| service/dispatcherBoard | `/service/dispatcher-board` | `modules/dispatcherBoard/DispatcherBoard.jsx` | FB-DOC + FB-CALL (scheduling commands) | service.dispatch |
| service/coordinatedVisits | `/service/coordinated-visits` | `modules/service/CoordinatedVisitsWorkspace.jsx` | FB-CALL (`listCoordinatedOperations`) | service.coordinatedVisits |
| service/technicianWorkspace | `/service/technician-workspace` | phone `modules/technician/TechnicianShell.jsx` / desktop `modules/mobile/FieldMode.jsx` | FB-CALL + FB-DOC (`users.technicianId`) | field.myWorkOrders |
| service/coordinatedMission | `/service/coordinated-mission` | `modules/mobile/CoordinatedMissionView.jsx` | FB-CALL | field.myWorkOrders |
| service/scan | `/service/scan` | `modules/scan/ScanWorkspace.jsx` | FB-CALL + FB-DOC | receiving.checkIn, warehouse.picking, field.myWorkOrders |
| equipment/equipment | `/equipment` | `modules/equipment/EquipmentWorkspace.jsx` (detail `EquipmentDetail.jsx`) | FB-CALL + FB-DOC (`equipment`: `isAdminOrDispatcher`) | equipment.register |
| inventory/parts | `/inventory` | `modules/inventory/PartsList.jsx` (detail `/inventory/:partId` `PartDetail.jsx`) | FB-DOC (`parts`: admin/dispatcher/PARTS_MANAGER/WAREHOUSE_MANAGER opRole) + FB-CALL | inventory.catalog |
| inventory/partMaster | `/inventory/part-master` | `modules/inventory/PartMasterList.jsx` | FB-CALL + FB-DOC | inventory.catalogAdmin |
| inventory/warehouseWorkspace | `/inventory/warehouse-workspace` | phone `modules/warehouse/WarehouseShell.jsx` / desktop `ScanWorkspace.jsx` | FB-CALL + FB-DOC | warehouse.picking |
| inventory/warehouses | `/inventory/warehouses` | `modules/inventory/Warehouses.jsx` | FB-CALL + FB-DOC | warehouse.management |
| inventory/truckInventory | `/inventory/truck-inventory` | `modules/inventory/TruckInventory.jsx` (management gated on the Firebase `role`) | FB-DOC | inventory.balances |
| inventory/transfers | `/inventory/transfers` | `modules/inventory/Transfers.jsx` | FB-CALL + FB-DOC | inventory.transfers |
| inventory/receiving | `/inventory/receiving` | `modules/inventory/Receiving.jsx` | FB-CALL + FB-DOC | receiving.checkIn |
| inventory/reorderQueue | `/inventory/reorder-queue` | `modules/inventoryRole/PartsManagerHome.jsx` (`title="Reorder Queue"`) | FB-DOC (`reorder_requests`) + FB-CALL | inventory.reorderQueue |
| inventory/cycleCounts | `/inventory/cycle-counts` | `modules/inventory/CycleCounts.jsx` | FB-CALL + FB-DOC | inventory.cycleCount.count / .review |
| purchasing/purchaseOrders | `/purchasing` | `modules/purchasing/PurchaseOrders.jsx` | FB-DOC | purchasing.purchaseOrders |
| purchasing/receipts | `/purchasing/receipts` | `modules/purchasing/Receipts.jsx` | FB-DOC | receiving.checkIn |
| financials/invoices | `/financials/invoices` | `modules/financials/FinancialsInvoices.jsx` (detail `FinancialsInvoiceDetail.jsx`) | FB-CALL (`financeReadCallableClient`, FIN-004 Firestore loader) | financials.invoices |
| financials/payments | `/financials/payments` | `modules/financials/FinancialsPayments.jsx` (detail `FinancialsPaymentDetail.jsx`) | FB-CALL | financials.payments |
| administration/overview | `/administration/overview` | `modules/administration/AdministrationOverview.jsx` | NONE (menu) | container over 6 admin children |
| administration/users | `/administration/users` | `modules/administration/AdminUsers.jsx` (detail `UserDetail.jsx`) | **R-PG** (workforce + adminPolicy) | administration.users |
| administration/rolesPermissions | `/administration/roles-permissions` | `modules/administration/AdminRolesPermissions.jsx` | **R-PG** (+ one FB-CALL `privilegedApprovalClient`) | administration.rolesPermissions |
| administration/objects | `/administration/objects` | `modules/administration/AdminObjects.jsx` | **R-PG** | administration.objects |
| administration/workflows | `/administration/workflows` | `modules/administration/AdminWorkflows.jsx` | **R-PG** | administration.workflows |
| administration/permissionPreview | `/administration/permission-preview` | `modules/administration/AdminPermissionPreview.jsx` | **R-PG** (`getPrincipalEffectiveAccess`) | administration.permissionPreview |
| administration/dataImport | `/administration/data-import` | `modules/administration/AdminDataImport.jsx` (gated on the Firebase id `admin.dataImport.stage`) | FB-CALL | administration.dataImport |
| administration/auditLogs | `/administration/audit-logs` | **`AdministrationUnavailable`** -- no screen | NONE | administration.auditLogs |
| (outside nav) | `/my-profile` | `modules/employees/MyEmployeeProfile.jsx` | **R-PG** (workforce) | any persona past "No access" |

**Render PG consumers in the whole client:** `SalesAgreementsList` (commercial), the Administration
screens and `MyEmployeeProfile` (adminPolicy / workforce), and `useExperienceContext` (operations). No
Work Order, Inventory, Reorder, Catalog, Purchasing or Finance screen reads PG.

### 2b. Detail routes that are NOT emitted under the EOS source

| Route | Component | Why it is dark (App.jsx `AppRoutes`) |
|---|---|---|
| `/service/work-orders/new` | `modules/workOrders/WorkOrderWizard.jsx` | Emitted only when `previewHasPermission("workOrder.create", navRole, {fallback: navRole in admin/dispatcher})`. Under EOS, `navRole === null`, so the route is emitted for **nobody**, admin included. |
| `/service/work-orders/:workOrderId` | `modules/workOrders/WorkOrderDetailPage.jsx` | same gate |

---

## 3. Per-Job-Role workspace (DERIVED)

`/my-profile` (R-PG) is available to every persona with at least one surface, and is not repeated below.
"Refused" means the screen's Firebase backend would refuse this persona given no Firebase business
authority. That is a DERIVED expectation, not something observed.

### 3.1 owner-executive -- `owner`, 22 surfaces

- **Earns:** Customers, Opportunities, Sales Orders, Sales Agreements; Service Operations, Work Orders,
  Job Assignments, Coordinated Visits; Equipment; Parts, Catalog Admin, Stock/Truck, Transfers, Reorder
  Queue; Purchase Orders; Invoices, Payments; Administration (Overview, Users, Roles & Permissions,
  Objects, Workflows, Permission Preview, Audit Logs); Inventory & Supply Overview.
- **Honored:** the Administration suite (R-PG) and Sales Agreements (R-PG, empty).
- **Refused:** every Service, Inventory, Purchasing, CRM, Opportunity, Sales Order, Equipment and Finance
  screen. The only Firebase-side identity is an authenticated uid with no Role doc.
- **Gaps:** Audit Logs is a door with no screen. `employees.directory` (North Star) is not a catalog
  surface. The Work Order detail and wizard are dark (§2b).
- **Withheld by design:** Owner does not earn `service.dispatch`, `receiving.checkIn` or
  `administration.dataImport` (the owner-exclusion contract).

### 3.2 office-administration -- `admin`, 24 surfaces

- **Earns:** everything the Owner earns except Reorder Queue, plus Dispatch and Dispatcher Board,
  Receiving and Receipts, Scan, and Data Import.
- **Honored:** all screens, **conditional** on `admin@` still carrying the legacy `users.role = admin`
  (UNVERIFIED). PG-only capabilities that admin holds (for example `workOrder.lifecycle.dispatch`) are
  still exercised through Firebase screens that never ask PG.
- **Gaps:** Audit Logs (no screen), the Work Order detail and wizard (dark under EOS), and the 49
  unmapped destinations (§4).

### 3.3 general-manager -- `generalManager`, 15 surfaces

- **Earns:** Customers, Opportunities, Sales Orders, Sales Agreements; Service Operations, Work Orders,
  Job Assignments; Parts, Catalog Admin, Stock/Truck, Transfers; Purchase Orders; Invoices, Payments;
  Administration Overview, Users, Audit Logs.
- **Honored:** Users (R-PG) and Sales Agreements (R-PG, empty).
- **Refused:** all the others.
- **Gaps:** `employees.directory` (North Star) has no surface. Audit Logs has no screen.

### 3.4 office-manager -- `officeManager`, 2 surfaces

- **Earns:** Customers, plus Work Orders / Job Assignments / Service Operations (through
  `workOrder.create`).
- **Refused:** all of them (`accounts` and `fieldops_wos` Rules).
- **Gaps:** `crm.contacts` (North Star) is a VOCABULARY gap -- no `contact.*` capability exists. The
  CRM PG writer is FROZEN (`/crm/customer` returns 503).

### 3.5 service-manager -- `fieldManager`, 12 surfaces

- **Earns:** Service Operations, Work Orders, Job Assignments, Dispatch, Dispatcher Board, Coordinated
  Visits; Customers, Sales Orders; Parts, Catalog Admin, Stock/Truck; Invoices, Payments; Audit Logs.
- **Refused:** all of them.
- **Action mismatch:** PG grants `fieldManager` `workOrder.lifecycle.dispatch` / `.cancel` (activation
  slice S6), but Dispatch and the Dispatcher Board read `fieldops_wos` under `isAdminOrDispatcher()`, so
  the dispatch authority PG granted cannot be used from any existing screen.
- **Gaps:** `service.scheduling` is a VOCABULARY gap. The Scheduling and Dispatch-Scheduling screens exist
  but are unmapped.

### 3.6 service-coordinator-dispatcher -- `dispatcher`, 13 surfaces

- **Earns:** Service Operations, Work Orders, Job Assignments, Dispatch, Dispatcher Board, Coordinated
  Visits, Scan; Customers, Opportunities, Sales Orders, Sales Agreements; Parts, Stock/Truck, Transfers,
  Receiving, Reorder Queue; Purchase Orders, Receipts.
- **Honored:** all screens, **conditional** on legacy `users.role = dispatcher` on `dispatcher@`
  (UNVERIFIED).
- **Gaps:** Work Order detail and wizard (dark under EOS), Inbound Work (unmapped), Scheduling.
- **Note:** census D-18 -- the dispatcher holds the full commercial sell-side spine, which is a
  separation-of-duties question outside this inventory.

### 3.7 service-technician -- `technician` + `SERVICE_TECHNICIAN`, 2 surfaces

- **Earns:** Technician Workspace, Coordinated Mission, Scan (`field.myWorkOrders`), plus Work Orders /
  Job Assignments / Service Operations (through `workOrder.transition`). The dashboard is
  `TechnicianDashboard`, because FIELD_WORK applies and no operations surface is held.
- **Refused:** all of them. `fieldops_wos` needs `isTechnician() && isOwnTechnician()`, which reads
  `users/{uid}.role/technicianId`, and neither exists for `finley.fixture@`.
- **Gaps:** the team-level Work Orders list is shown to a technician because `service.workOrders` is
  earned by `workOrder.transition` (the regression test records this as intended). Phase C may prefer to
  keep the technician's workspace to the field surfaces. That is presentation, not access.

### 3.8 parts-associate -- `partsAssociate` + `inventoryReceivingClerk`, 8 surfaces

- **Earns:** Parts, Stock/Truck, Inventory & Supply Overview, Receiving, Receipts, Scan; Customers, Sales
  Orders; Work Orders / Job Assignments / Service Operations; Invoices, Payments.
- **Refused:** all of them.
- **Gaps:** `inventoryRole/mine` (`PartsAssociateHome.jsx`, "My Purchasing") has **no governed door**:
  it is the legacy `operationalRoles` domain, and a NAV_SURFACE_GAP by design. There is no scope, so no
  Reorder Queue (correct: the role holds no `reorder.request.read`).

### 3.9 parts-manager -- `partsManager` + `purchasingManager`, 13 surfaces

- **Earns:** Reorder Queue (through the REORDER_QUEUE scope; `reorder.request.read.queue` has 0 holders,
  per census D-07), Purchase Orders; Parts, Catalog Admin, Stock/Truck, Transfers; Customers, Sales
  Orders; Work Orders; Invoices, Payments; Administration Overview and Audit Logs.
- **Refused:** all of them. `reorder_requests` Rules need `isActiveOperationalRole("PARTS_MANAGER")`.
- **Gaps:** Suppliers is a VOCABULARY gap (Firestore-authoritative). `inventoryRole/manager`
  (`PartsManagerHome`) is the same component that Reorder Queue already reuses. Assignment has no
  holder (`reorder.request.assign` = 0 holders).

### 3.10 warehouse-associate -- `warehouseAssociate` + counter + put-away, 8 surfaces

- **Earns:** Warehouse Workspace (picking, via put-away), Warehouses, Cycle Counts (count), Scan,
  Transfers, Parts, Stock/Truck, Inventory & Supply Overview, Purchase Orders, Sales Orders.
- **Refused:** all of them.
- **Gaps:** relocate is not held (`inventoryStockRelocationOperator` is unassigned, as ruled). The test
  manifest is stale about picking (§0).

### 3.11 warehouse-manager -- `warehouseManager` + reconciler + bin admin, 11 surfaces

- **Earns:** Warehouses, Cycle Counts (review), Transfers, Parts, Catalog Admin, Stock/Truck, Purchase
  Orders, Customers, Sales Orders; Administration Overview and Audit Logs.
- **Refused:** all of them.
- **Gaps:** `inventoryBinAdministrator` holds 0 capabilities, so Warehouse Racking
  (`AdminWarehouseRacking.jsx`) stays unmapped (`inventory.location.bin.*` is not registered).
  `inventoryRole/warehouse` (`WarehouseManagerHome.jsx`) has no governed door. `inventory.cycleCount.close`
  has 0 holders (census D-17).

### 3.12 retail-sales -- `salesperson`, 8 surfaces (see §5)

- **Earns:** Customers, Opportunities, Sales Orders, Sales Agreements, Invoices, Payments, Parts,
  Stock/Truck (plus the Overview).
- **Honored:** only the Sales Agreements list (R-PG), and `eos_commercial.sales_agreements` holds 0 rows,
  so it is empty. Its detail page writes through a Firebase callable.
- **Refused:** Opportunities (`listOpportunityContext`), Customers, Sales Orders and Finance.
- **Action mismatch:** PG grants `opportunity.write`, `salesAgreement.accept` and
  `opportunity.createSalesOrder`, but the create/transition affordances are gated by the Firebase feed
  (`useOpportunityCapabilities`). They are therefore hidden, not shown-then-refused -- they are simply
  unusable.
- **Gaps:** `dashboard.myPipeline` (North Star) is NOT_A_DESTINATION: it is composed in `MyDashboard`
  from modules whose data is Firebase.

### 3.13 national-accounts-sales -- `salesperson`, 8 surfaces

Identical to 3.12 in every column. See §5.

### 3.14 finance-accounting -- `accountingManager`, 11 surfaces

- **Earns:** Invoices, Payments; Customers, Opportunities, Sales Orders; Parts, Stock/Truck, Transfers;
  Purchase Orders; Administration Overview and Audit Logs.
- **Invoices and Payments:** these call `listFinancialFacts` / the finance read callables, whose reach
  is loaded from Firestore (FIN-004). Whether `acctmgr@`'s Firebase `financeManager` assignment yields
  reach is UNVERIFIED.
- **Other screens:** refused by Rules (`isAdminOrDispatcher`).
- **Gaps:** 18 built Financials screens (Overview, Billing Queue, AR, ...) are unmapped -- "Frame-0 IA
  with no authority". `eos_finance` holds 0 rows and has no Render route. `finance.visibility.*` is not in
  PG.

### 3.15 reporting-analyst -- `reportViewer`, 0 surfaces

- Holds `reportDefinition.read`, but **no surface is declared on it**. Report Builder and Saved Reports
  are NAV_SURFACE_GAPS, gated by the Firebase feed over `report.*` ids that PG does not declare.
- **Result:** the "No access" page. This is a gap, not a ruling. Closing it needs a server surface **and**
  a PG-backed report screen. Report execution and saved reports are Firebase-only today.

### 3.16 general-employee -- no Security Role, 0 surfaces

"No access" by design: this is the P16 negative control. Note that this persona also cannot reach
`/my-profile`, because the "No access" branch returns before the routes render. Whether an Employee with
no authority should see their own profile is an Owner product question.

---

## 4. Cross-cutting

### 4.1 Destinations with no surfaceAccess (invisible to every persona under the EOS source)

There are 86 destinations: **36 are mapped**, **1 is a container** (`dashboard/my`), and **49 are
unmapped** (all listed in `NAV_SURFACE_GAPS`).

| Group | Destinations | Existing component? | Blocker kind |
|---|---|---|---|
| Service | inboundWork, scheduling\*, dispatchScheduling\*, warranty\* | `InboundWorkWorkspace`, `SchedulingWorkspace`, `DispatchSchedulingWorkspace`; warranty = placeholder | Firebase-only ids / VOCABULARY (`service.scheduling`) |
| Inventory | manufacturers\*, backOrders\* | `Manufacturers` (Rules-closed to all); back orders = stub | no usable backend |
| My Inventory Role | manager, warehouse, mine | `PartsManagerHome`, `WarehouseManagerHome`, `PartsAssociateHome` | **legacy `operationalRoles` construct -- must not get a surface** |
| Purchasing | suppliers, quotes\*, demandPlanning\* | `Suppliers`; the others are placeholders | VOCABULARY (`supplier.*`) |
| Financials | 18 of 20 (all except invoices, payments) | 18 built `Financials*.jsx` | no authority (FIN-001/FIN-004) |
| Reporting | builder, savedReports, 8 domain pages\* | `ReportBuilder`, `SavedReports`; domain pages are placeholders | `report.*` not in PG |
| Administration | duplicateRules, warehouseRacking, financialPolicy, emailCommunications, integrations, vehicles\*, regions\*, companySettings\* | `AdminDuplicateRules`, `AdminWarehouseRacking`, `AdminFinancialPolicy`, `AdminEmailCommunications`, `IntegrationsFaq` | no registered capability |
| Dashboard | notifications\* | placeholder (the bell is the live surface) | not a destination |

\* = `navHidden`.

### 4.2 Screens no persona can reach (DERIVED)

1. All 49 destinations in 4.1.
2. `WorkOrderWizard` and `WorkOrderDetailPage` under EOS (§2b).
3. Built components that no route imports (static import graph from `main.jsx`):
   - `modules/sales/SalesWorkspace.jsx` -- the pipeline workspace with a Channel column
   - `modules/sales/SalesAgreementPanel.jsx`
   - `modules/accounts/AccountOpportunitiesSection.jsx`
   - `modules/accounts/AccountSalesOrdersSection.jsx`
   - `modules/controlTower/WorkOrderDetail.jsx`
   - `modules/controlTower/panels/PartsOverviewPanel.jsx`
   - `modules/inventory/mobile/*Section.jsx` (6 files)
   - `modules/inventory/truckManagement/TruckManagementPreview.jsx`
   - `modules/jobs/NewJobModal.jsx`
   - `modules/administration/ObjectSecurityActionList.jsx`
4. `warehouse.picking` was earnable by nobody in the test manifest. Live, it is warehouse-associate's
   (§0).

### 4.3 Doors shown with nothing honorable behind them (the Phase C risk)

| Pattern | Who | Evidence |
|---|---|---|
| Surface earned from PG; screen reads Firebase and refuses | the 10 personas marked DOORS, DATA REFUSED or UNVERIFIED in §1, plus the non-admin screens of the owner (#1) and GM (#3) | §1; Rules `isAdminOrDispatcher` / `isOwnTechnician` / `isActiveOperationalRole`; callables via `resolveEffectiveAccess` |
| Door renders `AdministrationUnavailable` | everyone earning `administration.auditLogs`: owner, admin, GM, service-manager, parts-manager, warehouse-manager, finance | App.jsx `auditLogs` branch |
| Administration Overview earned only through Audit Logs | service-manager, parts-manager, warehouse-manager, finance | the container over one child that has no screen |
| PG list, Firebase detail and writes | Sales Agreements, for every holder of `salesAgreement.read` | `SalesAgreementsList` = R-PG; `SalesAgreementDetail` = FB-CALL |
| PG grants an action no screen can use | fieldManager dispatch/cancel; salesperson accept/createSalesOrder | §3.5, §3.12 |
| In-screen affordances gated on the Firebase `role` | TruckInventory `canManage`, MyDashboard `adminDecisions`, Scan `deps.role` | App.jsx `TruckInventoryConnected`; `dashboardComposition.js:483` |

**"Actions shown that the server refuses" is mostly avoided structurally.** In-screen affordances read
the fail-closed Firebase feed, so a PG-only persona sees them *hidden*. The live defect is the inverse: a
**door shown, then its data refused**. Phase C must not treat nav visibility as action authority.
`operationalContext.hasCapability` is still the Firebase `resolveEffectiveAccess` feed, even under the
EOS source.

### 4.4 Minimal integration-owned nav edits Phase C will need (DESCRIBED, NOT MADE)

These belong to the single integration writer for `App.jsx` / `navConfig.js` / `AppShell`.

1. **Work Order detail and wizard under EOS.** Re-gate `/service/work-orders/new` and `/:workOrderId` on
   the EOS surface (`service.workOrders`) when `isEosNavigationSource`, instead of
   `previewHasPermission(..., navRole=null)`. Without this, no persona can open a Work Order in
   platform-sandbox. This is navigation only: the backend still decides.
2. **Audit Logs door.** Either stop offering `administration/auditLogs` until a screen exists, or build
   the screen. Removing the `NAV_SURFACE_ACCESS` row alone violates the tested invariant that every
   server surface is reachable, so this needs a paired server-catalog decision. **Owner decision.**
3. **Per-Job-Role landing.** Today every persona lands on `dashboard/my`. A Job-Role landing (for
   example technician -> Technician Workspace) needs `jobRole` in the experience context:
   `resolveExperienceContext` returns `securityRoleKeys`, `employeeId`, WE, scopes and surfaces, and **no
   Job Role**. The server addition would be presentation only, and must never gate.
4. **Workspace grouping, presentation only.** Group or trim destinations per Job Role inside `AppShell`
   (for example hide the team Work Orders list from the technician rail). Grouping must stay a subset of
   granted surfaces and grant nothing new. `SERVICE_NAV_GROUPS` / `buildNavGroups` are the existing
   mechanism.
5. **Reporting.** No nav edit can close this alone. It needs a server surface on `reportDefinition.read`,
   a `NAV_SURFACE_ACCESS` row, removal of the `reporting/*` gap entries, and a PG-backed report screen.
   Record it as blocked.
6. **Leave alone:** `inventoryRole/*` (legacy -- surface its content through existing governed doors,
   as Reorder Queue already does with `PartsManagerHome`), the 18 Financials pages (no authority; do
   not invent figures), and Contacts, Scheduling and Suppliers (VOCABULARY gaps).
7. **Precondition that is not a nav edit.** For 10 of the 16 personas the assembled workspace will be
   refused unless the screens' **data paths** move to Render PG, or the personas receive Firebase-side
   authority. The registry forbids the second option for the canonical chain. That is migration work,
   not assembly, and it is the real gate on Phase C. **Owner decision.**

---

## 5. Retail Sales vs National Accounts Sales

| Dimension | Today (REPO-DERIVED) |
|---|---|
| Job Role | **Distinct:** `retail-sales` vs `national-accounts-sales` (canonical vocabulary; one current assignment each) |
| Security Role | **Identical:** `salesperson`, by design (`roleHierarchy.PLACEMENT_GAPS`: "which market a deal belongs to is a property of the DEAL") |
| Surfaces / destinations | **Identical:** 8 / 10 |
| Distinguishing record data | `salesChannel` on Opportunity and Sales Order (`NATIONAL_ACCOUNTS`, `RETAIL`, `STRATEGIC_ACCOUNTS`). Shown as a badge in `OpportunityList` and a field in `SalesOrderDetail`; selectable in `NewOpportunityForm`. `eos_commercial` holds 0 rows, so nothing carries it in PG. |
| Channel filtering | **None.** No list filters by channel. `domain/commercialCoverage.js` models channel coverage and is a pure domain module with no consumer UI (the "deferred coverage model"). |
| Where the Job Role is displayed | `modules/employees/EmployeeProfileSections.jsx` (`/my-profile`) and `EmployeeJobRoleControl.jsx` (Admin > Users > detail) |

**Existing content Phase C can reuse to make the two feel distinct, with no new authority:**

- `OpportunityList` (it already receives `viewerUid`, for "my opportunities").
- The orphaned `SalesWorkspace.jsx` pipeline, which has a Channel column.
- The `MyDashboard` modules `myOpportunities` / `myBooked` / `accountPortfolio`.
- `SalesAgreementsList` and `SalesAgreementDetail` -- National Accounts is the agreement-heavy persona.

**Would be new:**

- A default channel filter or sort keyed off the viewer's Job Role (presentation only; the records stay
  readable either way).
- An account segment / "my accounts" view.
- A National Accounts landing that leads with agreements.

**Must not be built:** a per-channel Security Role (for example a `nationalAccountsSalesperson` Role), or
channel-scoped *visibility*, without an Owner ruling on the coverage model. Either one would change
authority, not presentation.

---

## 6. Do-not-rebuild list (reuse these components)

| Workspace | Reuse (file under `field-ops-app-vite/src/modules/`) |
|---|---|
| All | `dashboard/MyDashboard.jsx` + `domain/dashboardComposition.js` (already EOS-aware); `employees/MyEmployeeProfile.jsx`; `navigation/AppShell` grouping (`SERVICE_NAV_GROUPS`, `FINANCIALS_NAV_GROUPS`, `buildNavGroups`) |
| Owner / Admin | `administration/AdministrationOverview.jsx`, `AdminUsers.jsx`, `UserDetail.jsx`, `EmployeeJobRoleControl.jsx`, `AdminRolesPermissions.jsx`, `AdminObjects.jsx`, `AdminWorkflows.jsx`, `AdminPermissionPreview.jsx`, `AdminDataImport.jsx` |
| General Manager | the above Users screens + the Sales/CRM set + `operations/Operations.jsx` |
| Office Manager / Office Admin | `accounts/AccountsList.jsx`, `accounts/AccountDetail.jsx`, `workOrders/WorkOrdersList.jsx` |
| Service Manager / Dispatcher | `controlTower/ControlTower.jsx`, `dispatch/Dispatch.jsx`, `dispatcherBoard/DispatcherBoard.jsx`, `jobs/Jobs.jsx`, `service/CoordinatedVisitsWorkspace.jsx`, `workOrders/WorkOrderDetailPage.jsx`, `workOrders/WorkOrderWizard.jsx`, `scheduling/SchedulingWorkspace.jsx` (unmapped), `service/InboundWorkWorkspace.jsx` (unmapped) |
| Service Technician | `technicianDashboard/TechnicianDashboard.jsx`, `technician/TechnicianShell.jsx`, `mobile/FieldMode.jsx`, `mobile/CoordinatedMissionView.jsx`, `scan/ScanWorkspace.jsx` |
| Parts Associate / Manager | `inventory/PartsList.jsx`, `inventory/PartDetail.jsx`, `inventory/Receiving.jsx`, `inventoryRole/PartsManagerHome.jsx` (already reused as Reorder Queue), `inventoryRole/PartsAssociateHome.jsx`, `inventory/PartMasterList.jsx`, `purchasing/PurchaseOrders.jsx`, `purchasing/Receipts.jsx`, `purchasing/Suppliers.jsx` |
| Warehouse Associate / Manager | `warehouse/WarehouseShell.jsx`, `scan/ScanWorkspace.jsx`, `inventory/CycleCounts.jsx`, `inventory/Transfers.jsx`, `inventory/Warehouses.jsx`, `inventory/TruckInventory.jsx`, `inventoryRole/WarehouseManagerHome.jsx`, `administration/AdminWarehouseRacking.jsx` (unmapped) |
| Retail / National Accounts Sales | `sales/OpportunityList.jsx`, `sales/OpportunityDetail.jsx`, `sales/NewOpportunityForm.jsx`, `sales/SalesOrdersList.jsx`, `sales/SalesOrderDetail.jsx`, `sales/SalesAgreementsList.jsx`, `sales/SalesAgreementDetail.jsx`, `sales/SalesWorkspace.jsx` (orphaned -- wire, don't rewrite), `accounts/AccountOpportunitiesSection.jsx` / `AccountSalesOrdersSection.jsx` (orphaned) |
| Finance / Accounting | `financials/FinancialsInvoices.jsx`, `FinancialsPayments.jsx`, and the detail pages; the other 18 `Financials*.jsx` exist but have no authority -- keep hidden |
| Reporting Analyst | `reporting/ReportBuilder.jsx`, `reporting/SavedReports.jsx` (Firebase-backed; blocked, §3.15) |
| General Employee | none. "No access" is the correct experience; `/my-profile` reachability is an open question (§3.16) |

---

## 7. Open items for the Owner (surfaced, not decided)

1. **Data-path precondition (§4.4 item 7).** Move screen reads to Render PG, or accept that 10 persona
   workspaces are doors whose data is refused until then.
2. **Audit Logs:** a door with no screen, reached by 7 personas.
3. **Reporting Analyst:** holds `reportDefinition.read` and earns nothing.
4. **General Employee and `/my-profile`.**
5. **Whether the technician rail should show the team Work Orders list** that `workOrder.transition`
   earns.
6. **Stale repo facts noted in passing.** The registry still says `reporting@` `accountExists: false`,
   while the Persona Foundation session record says it was created 2026-09-25. That record is not a
   repo artifact, so this document does not rely on it.
