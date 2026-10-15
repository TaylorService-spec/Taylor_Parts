# Firebase coexistence inventory: field-ops-app-vite, route by route

Static read-only analysis of `field-ops-app-vite` at `51c2ab8e` (branch `feature/eos-native-identity`); client code is unchanged at the PR head. Owner direction 2026-10-12: do not enable native login for an experience that cannot complete its business workflows -- this inventory says which those are. Paths are relative to `field-ops-app-vite/src/`.
Scope: static read-only analysis. No build, no tests, no network.

## Method

- Routes come from `App.jsx` (`AppRoutes`, `renderSubnavItem`, `LEGACY_COMPONENTS`) and `navigation/navConfig.js` (`NAV_DOMAINS`, dumped with node).
- I built a transitive import graph of all 946 non-test modules, including lazy `import()`. For each routed component I collected:
  - **Firebase leaves:** modules that import `firebase/firestore`, `firebase/functions` or `httpsCallable`, or `{db|functions|auth}` from `firebase/firebase.js`.
  - **EOS clients:** any `services/*` module that reaches `currentIdToken` in `services/adminPolicyApiClient.js`.
- I then hand-checked each Firebase leaf to see whether it is a live runtime call or a static import only.
  - Example: `metadata/callableListSource.js` is reached through `listViewDefinition.js` only for `isKnownReadCallable`, which is metadata and makes no call.
  - `useMetadataList` / `MetadataRecordPage` pick a list source by entity `readVia`. `account`, `workOrder`, `equipment`, `warehouse`, `supplier`, `contact` and `location` are `EOS_API`. Opportunity and sales-order lists named `CALLABLE` are actually sent to the EOS Commercial API by `COMMERCIAL_EOS_LISTS` in `callableListSource.js`.
  - `useListViewChrome` calls the Firestore `getCountFromServer` only for `CLIENT_DIRECT` entities or when no count is injected. None of the routed lists hit that path.
- I also checked identity fields from `useAuth()`. Under an EOS session (`auth/AuthContext.jsx` + `auth/eosSessionIdentity.js`) these are `role=null`, `operationalRoles=[]`, `displayName=null` and `employmentStatus=null`. `employeeId` comes from `/operations/experience`, and `user.uid` is the EOS subject, not a Firebase uid.

## Facts that apply to every route (the shell)

1. **Navigation authority under an EOS session.** `App()` uses `useExperienceContext` (EOS `resolveMyExperienceContext`, `operationsApiClient`) as the navigation source only when `EOS_NAVIGATION_AUTHORITY_READY` is true.
   - In `config/environments.json` this flag is true only for `platform-sandbox`. It is false for local-emulator, certification, integration and production.
   - Where it is false, an EOS session has `role=null`, which gives `ROLE_NAV_ACCESS[null] = []`, so the user sees **"No access"**. EOS-only login is therefore usable only where this flag is on.
2. **Under the EOS navigation source, an item is visible only if it declares `surfaceAccess`** (`eosGrantsSurface`, navConfig.js:1637). Items with no `surfaceAccess` can never be reached and render the "isn't available to your role" EmptyState. They are:
   - 18 of the 20 Financials items (only `invoices` and `payments` declare it)
   - Reporting `builder` and `saved`
   - Administration `duplicateRules`, `warehouseRacking`, `financialPolicy`, `systemConfiguration`, `salesConfiguration`, `integrations`
   - all three `inventoryRole` items
   - every `navHidden` placeholder
3. **`operationalContext.hasCapability` / `accessVersion` come from Firebase** (`access/useReportCapabilities.js`). It runs a Firestore `onSnapshot(users/{uid})` plus the callable `resolveEffectiveAccessCallable`.
   - With no Firebase user this fails closed: `hasCapability()` is always false and `accessVersion` is null. It does not hang, because `isAccessResolving` treats ERROR as settled.
   - It mounts for **every** signed-in session, so an EOS session fires one failing Firestore listener at app start.
   - Every screen that is handed `hasCapability` from App.jsx loses those gates: ScanWorkspace / WarehouseShell / TechnicianShell scan workflows, PartDetail void and compatibility, AdminWarehouseRacking, AdminDataImport, AdminFinancialPolicy, UserDetail account actions, SavedReports.
4. **AppShell** (`navigation/AppShell.jsx`, AppRail, AppHeader, `modules/search/SiteSearch.jsx` → `workspaceApiClient`, `shared/ui/NotificationControl.jsx` → `useReorderRequests` → `reorderApiClient`) has **no Firebase data dependency**.
   - However, `NotificationControl` gates reorder notifications on the legacy role (`previewHasPermission("reorder.request.read.queue", role, {fallback: role==="admin"||role==="dispatcher"})`). Under an EOS session the bell is silently empty.
   - AppRail shows no role.
5. **App-level hooks are all EOS:** `useCommercialCapabilities` (commercialApiClient), `useMyWorkOrderCapabilities` (workOrderApiClient), `useTruckRegistrySource` (eosOperationsClient) and `access/opportunitySource.js`.
6. **AuthContext** still imports `firebase/auth` and initializes the Firebase app. On an EOS session it never subscribes `onAuthStateChanged`. `logout()` calls `signOut(auth)`, which is harmless.
7. **Login screen:** `auth/EosLogin.jsx` (EOS) when `VITE_EOS_HUMAN_LOGIN=enabled` and the environment is not production; otherwise `auth/Login.jsx` (Firebase Auth).
8. **Dashboard:** under the EOS navigation source, `/dashboard` always renders `MyWorkspace` (EOS). The Firebase-dependent `MyDashboard` and `TechnicianDashboard` are reached only under the legacy source.

## Legend

- **EOS-ONLY:** every read and write goes through EOS API clients, with no Firestore, callable or Firebase-role dependency.
- **PARTIAL:** the core workflow is on EOS, but the named panels or actions need Firebase or the legacy role.
- **FIREBASE-REQUIRED:** the primary data or workflow needs Firestore, callables or a Firebase-path identity field.
- **STATIC:** no data reads at all (honest-state or informational page).
- **PLACEHOLDER:** `PlaceholderPage`.
- **[unreachable-EOS]:** no `surfaceAccess`, so the route can never be shown under the EOS navigation source.

## Administration (`/administration/*`, wrapped by `AdministrationScope.jsx`)

| Route | Component | Classification | Firebase dependencies (file:symbol) | EOS dependencies |
|---|---|---|---|---|
| /administration, /administration/employees, /administration/permission-preview | Navigate → /administration/users | REDIRECT | — | — |
| /administration/overview | AdministrationOverview.jsx | STATIC (container item, visible if any admin child is) | — | deployment manifest only (`domain/deploymentVersionInfo`) |
| /administration/users | AdminUsers.jsx | EOS-ONLY | — | workforceApiClient |
| /administration/users/:employeeId | UserDetail.jsx | PARTIAL | `access/administrationUsersClient.js`: `listRecordChangeHistory` (change history), `readPrincipalAccessState` and `setUserStatus` (account status panel in UserAccessActions.jsx); `access/adminPasswordResetClient.js`: initiate and list callables; `hasCapability` from the Firebase feed (fail-closed) | adminPolicyApiClient (assignRole/revokeRole, grants, explainEffectiveAccess), workforceApiClient, adminControlPlaneClient, workflowAdminClient, workflowRuntimeClient, `usePrincipalCredential` |
| /administration/users/functional-roles | AdminFunctionalRoles.jsx | EOS-ONLY | — | workforceApiClient, adminControlPlaneClient |
| /administration/roles-permissions | AdminRolesPermissions.jsx | PARTIAL | `ApprovalRequests.jsx` → `services/privilegedApprovalClient.js` (privileged-approval callables) | adminControlPlaneClient, workforceApiClient, commercialApiClient |
| /administration/objects | AdminObjects.jsx | EOS-ONLY | (callableListSource is static metadata only) | adminControlPlaneClient, workforceApiClient |
| /administration/permissions | AdminPermissions.jsx | EOS-ONLY | — | adminControlPlaneClient, workforceApiClient |
| /administration/workflows | AdminWorkflows.jsx | EOS-ONLY | — | workflowAdminClient, adminControlPlaneClient, workforceApiClient |
| /administration/qa/principal-inspection (navHidden) | PrincipalQaInspection.jsx | EOS-ONLY | — | adminControlPlaneClient, workforceApiClient |
| /administration/duplicate-rules | AdminDuplicateRules.jsx | STATIC [unreachable-EOS] | — | — |
| /administration/warehouse-racking | AdminWarehouseRacking.jsx | FIREBASE-REQUIRED [unreachable-EOS] | page gate `WAREHOUSE_RACKING_GATE` via Firebase `hasCapability`; `services/operationsQueries.ts:fetchWarehouses` (Firestore); `services/binCommandClient.js` (bin callables) | sub-panels WarehouseMasters, TruckRegistry and TruckLocationScopeBindings use adminPolicyApiClient |
| /administration/financial-policy | AdminFinancialPolicy.jsx | FIREBASE-REQUIRED (gate only) [unreachable-EOS] | page gate `FINANCIAL_POLICY_GATE` via Firebase `hasCapability` | FinanceConfiguration.jsx → adminPolicyApiClient |
| /administration/system-configuration | AdminSystemConfiguration.jsx | EOS-ONLY [unreachable-EOS] | — | adminPolicyApiClient (listSystemConfiguration, etc.) |
| /administration/sales-configuration | AdminSalesConfiguration.jsx | EOS-ONLY [unreachable-EOS] | — | adminPolicyApiClient (sales discount authorities) |
| /administration/data-import | AdminDataImport.jsx | FIREBASE-REQUIRED | `access/dataImportClient.js`: stage, execute and list callables; `hasCapability` (Firebase feed) gates stage and execute | — |
| /administration/email-communications | AdminEmailCommunications.jsx | EOS-ONLY | — | inboundWorkApiClient, workOrderApiClient |
| /administration/integrations | IntegrationsFaq.jsx | STATIC [unreachable-EOS] | — | — |
| /administration/audit-logs | AdminAuditLogs.jsx | STATIC (single Link page) | — | — |
| /administration/vehicles, regions, company-settings | PlaceholderPage | PLACEHOLDER (navHidden) | — | — |
| /admin/diagnostics/inventory-parts-parity (top level, no nav) | inventory/PartsShadowParityDiagnostics.jsx | FIREBASE-REQUIRED | self-gate `role` admin/dispatcher (legacy role is null under EOS); `services/operationsQueries.ts` Firestore reads | catalogApiClient, reorderApiClient |

## Service / Work Orders (`/service/*`, `/service-operations`, `/dashboard`)

| Route | Component | Classification | Firebase dependencies (file:symbol) | EOS dependencies |
|---|---|---|---|---|
| /dashboard (index) | DashboardIndex → workspace/MyWorkspace.jsx under the EOS source | EOS-ONLY | (legacy source: MyDashboard → receivingCallableClient, privilegedApprovalClient, performanceGoalClient, financeReadCallableClient; TechnicianDashboard → useCurrentTechnician Firestore, performanceGoalClient. Not reached under the EOS source) | workspaceApiClient, workOrderApiClient, analysisApiClient, workflowRuntimeClient |
| /dashboard/operations | operations/Operations.jsx | PARTIAL | Procurement panel: `operationsQueries.ts:fetchSuppliers`, `fetchSupplierCatalog` (Firestore `suppliers`, `supplier_catalog`); the code says the refusal is shown inside that panel only | eosOperationsClient (inventory health, warehouses, transfers), reorderApiClient (`fetchProcurementPurchaseOrders`), catalogApiClient, workOrderApiClient |
| /dashboard/notifications | PlaceholderPage | PLACEHOLDER (navHidden) | — | — |
| /service-operations | controlTower/ControlTower.jsx | EOS-ONLY | — | crmApiClient, workOrderApiClient |
| /service/control-tower | Navigate → /service-operations | REDIRECT | — | — |
| /service (index) | workOrders/WorkOrdersList.jsx | EOS-ONLY | (useListViewChrome Firestore count not taken: workOrder is `EOS_API`) | workOrderApiClient, crmApiClient, commercialApiClient, equipmentApiClient |
| /service/work-orders/new | workOrders/WorkOrderWizard.jsx | EOS-ONLY | — (route gated by EOS `service.workOrders` + `workOrder.create` from `useMyWorkOrderCapabilities`) | crmApiClient, workOrderApiClient, equipmentApiClient |
| /service/work-orders/:workOrderId | workOrders/WorkOrderDetailPage.jsx | PARTIAL (read OK, dispatcher actions lost) | `controlTower/WorkOrderActions.jsx` → `domain/workOrderWorkflow.js:getAllowedActions(status, role)` needs the legacy role, so Dispatch/Schedule/Cancel/Unschedule never render; the parts-plan edit gate now reads EOS `readMyWorkOrderCapabilities` (Firebase hook removed, 2026-10-15) | workOrderApiClient, crmApiClient, equipmentApiClient, catalogApiClient, commercialApiClient |
| /service/inbound-work | service/InboundWorkWorkspace.jsx | EOS-ONLY | — | inboundWorkApiClient, crmApiClient, workOrderApiClient, equipmentApiClient |
| /service/job-assignments | jobs/Jobs.jsx | PARTIAL (minor) | "New Work Order" button gated by `previewHasPermission("workOrder.create", role, admin/dispatcher fallback)`, which is the legacy role | workOrderApiClient |
| /service/dispatch | dispatch/Dispatch.jsx | EOS-ONLY | — (uses a hard-coded `"dispatcher"` in getAllowedActions, not the session role) | workOrderApiClient |
| /service/coordinated-visits | service/CoordinatedVisitsWorkspace.jsx | EOS-ONLY | — | commercialApiClient |
| /service/coordinated-mission | mobile/CoordinatedMissionView.jsx | EOS-ONLY | — | commercialApiClient |
| /service/technician-workspace | phone: technician/TechnicianShell.jsx; desktop: mobile/FieldMode.jsx | FIREBASE-REQUIRED | `hooks/useCurrentTechnician.js` (Firestore `users/{uid}` → `technicians/{id}`). FieldMode hard-stops on `technicianError` ("technician profile could not be loaded"); TechnicianShell embeds FieldMode. `mobile/PartsScanner.jsx` → `domain/scanActions.js` needs `role === "technician"` to record part usage. The scan tab inherits the ScanWorkspace dependencies below | workOrderApiClient (assigned WOs, transitions), equipmentApiClient, eosOperationsClient, catalogApiClient |
| /service/scan | scan/ScanWorkspace.jsx | FIREBASE-REQUIRED | workflows from `access/scanWorkflows.js:deriveScanWorkflows(hasCapability)` (Firebase feed, so only Look Up survives); LookupScan → `inventoryBalanceCallableClient.js:getPartBalance`; MultiScanReceiving → `receivingCallableClient.js`; `offline/warehouseCommandBindings.js` → `returnCommandClient.js`; `useCurrentTechnician` (Firestore) | eosOperationsClient (transfer, count, put-away, move, pick), workOrderApiClient, catalogApiClient, equipmentApiClient |
| /service/dispatcher-board | dispatcherBoard/DispatcherBoard.jsx | FIREBASE-REQUIRED (identity) | `role !== "admin" && role !== "dispatcher"` refuses the whole board (DispatcherBoard.jsx:503); Unschedule uses `getAllowedActions(..., role)` | crmApiClient, workOrderApiClient |
| /service/scheduling, /service/dispatch-scheduling (navHidden) | SchedulingWorkspace.jsx, DispatchSchedulingWorkspace.jsx | EOS-ONLY [unreachable-EOS] | — | workOrderApiClient |
| /service/warranty | PlaceholderPage | PLACEHOLDER | — | — |

## Parts / Inventory / Purchasing

| Route | Component | Classification | Firebase dependencies (file:symbol) | EOS dependencies |
|---|---|---|---|---|
| /inventory (index) | inventory/PartsList.jsx | PARTIAL | `hooks/useEmployeeDirectory.js` (Firestore `employees`, actor names); `shared/reorder/ManagerQueuePanel.jsx` → `EmployeeAssignmentPicker` → `hooks/useAssignableEmployees.js` (Firestore `employees`); `hooks/useManufacturerCatalog.js` → `manufacturerReadCallableClient.js:getManufacturerCatalog` | catalogApiClient, reorderApiClient |
| /inventory/:partId | inventory/PartDetail.jsx | PARTIAL | `hooks/useInventoryActions.js` (Firestore `inventoryActions`); useEmployeeDirectory; useAssignableEmployees; manufacturer callable; void-PO and compatibility gated by Firebase `hasCapability`; `shared/inventory/RequestReorderControl.jsx` manual-quantity path needs `role==="admin"` or `operationalRoles` | catalogApiClient, reorderApiClient, workOrderApiClient, crmApiClient |
| /inventory/part-master | inventory/PartMasterList.jsx | EOS-ONLY | — (count injected; callableListSource is static only) | catalogApiClient, commercialApiClient |
| /inventory/manufacturers (navHidden) | inventory/Manufacturers.jsx | STATIC | — | — |
| /inventory/warehouse-workspace | phone: warehouse/WarehouseShell.jsx; desktop: ScanWorkspace | FIREBASE-REQUIRED | same as /service/scan (Firebase `hasCapability`, balance, receiving and return callables, useCurrentTechnician) | eosOperationsClient, workOrderApiClient, catalogApiClient, equipmentApiClient |
| /inventory/warehouses | inventory/Warehouses.jsx | EOS-ONLY | — (warehouse entity `EOS_API`) | eosOperationsClient, reorderApiClient, crmApiClient, commercialApiClient |
| /inventory/truck-inventory | TruckInventoryConnected → inventory/TruckInventory.jsx | EOS-ONLY | — | `useTruckRegistrySource` → eosOperationsClient |
| /inventory/transfers | inventory/Transfers.jsx | EOS-ONLY | — | eosOperationsClient |
| /inventory/reorder-queue | inventoryRole/PartsManagerHome.jsx | PARTIAL | assignment picker → `useAssignableEmployees.js` (Firestore `employees`), so "assign to Parts Associate" breaks | reorderApiClient, catalogApiClient |
| /inventory/receiving | inventory/Receiving.jsx | PARTIAL | supplier-PO journey: `receivingCallableClient.js:fetchReceivablePurchaseOrders` / `submitCanonicalReceive` (callables) | reorder journey: reorderApiClient (+ reorderReceivingClient); acquire: serializedAssetAcquireCallableClient (EOS despite its name), eosOperationsClient, catalogApiClient |
| /inventory/cycle-counts | inventory/CycleCounts.jsx | EOS-ONLY | — (note: `needsAnotherReviewer(l, user.uid)` compares to the EOS subject, a display hint only; uncertain whether the ids match) | eosOperationsClient |
| /inventory/back-orders | PlaceholderPage | PLACEHOLDER | — | — |
| /inventory-role/manager, /warehouse, /mine | PartsManagerHome, WarehouseManagerHome, PartsAssociateHome | FIREBASE-REQUIRED (reachability) [unreachable-EOS] | visibility only via `operationalRoleAccess` (Firestore `operationalRoles`); WarehouseManagerHome also `useInventoryActions.js` (Firestore) | reorderApiClient, catalogApiClient |
| /purchasing (index) | purchasing/PurchaseOrders.jsx | PARTIAL (minor) | `useEmployeeDirectory.js` (Firestore, requester and actor names) | reorderApiClient |
| /purchasing/suppliers | purchasing/Suppliers.jsx | EOS-ONLY | — (supplier entity `EOS_API`) | reorderApiClient, eosOperationsClient, crmApiClient |
| /purchasing/receipts | purchasing/Receipts.jsx | EOS-ONLY | — | reorderApiClient |
| /purchasing/quotes, /demand-planning | PlaceholderPage | PLACEHOLDER | — | — |

## Sales / CRM / Commercial (`/customers/*`), Equipment, Rental

| Route | Component | Classification | Firebase dependencies (file:symbol) | EOS dependencies |
|---|---|---|---|---|
| /customers (index) | accounts/AccountsList.jsx | EOS-ONLY | — (account `EOS_API`, so no Firestore count) | crmApiClient, workforceApiClient, workspaceApiClient |
| /customers/:accountId | accounts/AccountDetail.jsx | PARTIAL | `metadata/definitions/accountPageComponents.js:useAccountPageCapabilityDecisions` (Firestore `users/{uid}` + `resolveEffectiveAccessCallable`), which denies the AR and Activity sections; `hooks/useAccountAr.js` → `financeReadCallableClient.js:listAccountInvoiceAr`; `useCrmActivities`/`useCrmActivityActions` → `crmActivityCallableClient.js` (`getCrmActivities`, `createCrmActivity`); `ServiceActivitySection` → `importedServiceHistorySource.js` (callable); `isAdmin = role === "admin"` hides the paymentTerms/taxStatus edit pencils | crmApiClient (account, contacts, locations, writes), commercialApiClient (opportunity and SO sections, capability via useCommercialCapabilities), workOrderApiClient, equipmentApiClient, `useGovernedEmployeeDirectory` (workforceApiClient) |
| /customers/contacts, locations, equipment, service-history | Navigate → /customers | REDIRECT | — | — |
| /customers/opportunities | OpportunityListConnected → sales/OpportunityList.jsx | EOS-ONLY | — | commercialApiClient, workforceApiClient, crmApiClient |
| /customers/opportunities/:opportunityId | sales/OpportunityDetail.jsx | EOS-ONLY | — | commercialApiClient, catalogApiClient, workforceApiClient |
| /customers/opportunities/sales-order/:salesOrderId | sales/SalesOrderDetail.jsx | EOS-ONLY | — (record page uses field groups only) | commercialApiClient, crmApiClient, equipmentApiClient |
| /customers/opportunities/sales-agreement/:salesAgreementId | sales/SalesAgreementDetail.jsx | EOS-ONLY | — | commercialApiClient, crmApiClient, catalogApiClient |
| /customers/sales-orders | sales/SalesOrdersList.jsx | EOS-ONLY | — (`listSalesOrderIndex` is sent to the Commercial EOS API) | commercialApiClient, crmApiClient |
| /customers/sales-agreements | sales/SalesAgreementsList.jsx | EOS-ONLY | — | commercialApiClient |
| /equipment | equipment/EquipmentWorkspace.jsx | EOS-ONLY | — | equipmentApiClient, crmApiClient, catalogApiClient |
| /equipment/:equipmentId | equipment/EquipmentDetail.jsx | EOS-ONLY | — | equipmentApiClient, catalogApiClient, crmApiClient |
| /rental | rental/RentalWorkspace.jsx | EOS-ONLY | — | rentalApiClient, financeApiClient |

## Finance (`/financials/*`)

| Route | Component | Classification | Firebase dependencies (file:symbol) | EOS dependencies |
|---|---|---|---|---|
| /financials (overview) | FinancialsOverview.jsx | FIREBASE-REQUIRED [unreachable-EOS] | `hooks/useFinancialFacts.js` → `financeReadCallableClient.js:listFinancialFacts` | financeApiClient (one panel) |
| /financials/invoices | FinancialsInvoices.jsx | FIREBASE-REQUIRED | listFinancialFacts callable | crmApiClient (account names) |
| /financials/invoices/:invoiceId | FinancialsInvoiceDetail.jsx | FIREBASE-REQUIRED | listFinancialFacts callable; useEmployeeDirectory (Firestore) | crmApiClient |
| /financials/payments | FinancialsPayments.jsx | FIREBASE-REQUIRED | listFinancialFacts callable | crmApiClient |
| /financials/payments/:paymentId | FinancialsPaymentDetail.jsx | FIREBASE-REQUIRED | listFinancialFacts callable | crmApiClient |
| /financials/accounts-receivable | FinancialsAccountsReceivable.jsx | FIREBASE-REQUIRED [unreachable-EOS] | listFinancialFacts; useEmployeeDirectory | crmApiClient |
| /financials/customer-financials | FinancialsCustomerFinancials.jsx | FIREBASE-REQUIRED [unreachable-EOS] | listFinancialFacts | crmApiClient |
| /financials/company-performance | FinancialsCompanyPerformance.jsx | FIREBASE-REQUIRED [unreachable-EOS] | listFinancialFacts | — |
| /financials/employee-performance | FinancialsEmployeePerformance.jsx | FIREBASE-REQUIRED [unreachable-EOS] | listFinancialFacts; useEmployeeDirectory | — |
| /financials/billing-queue, credits-adjustments, sales-to-goal, cost-to-budget, forecasting, profitability, budgets, goals, reconciliation, intercompany, audit, reports, governance (13) | Financials*.jsx | STATIC (honest "unwired" states) [unreachable-EOS] | — | — |

## Analysis / Reports

| Route | Component | Classification | Firebase dependencies (file:symbol) | EOS dependencies |
|---|---|---|---|---|
| /analysis | analysis/AnalysisWorkspace.jsx | EOS-ONLY | — | analysisApiClient |
| /reporting/builder | reporting/ReportBuilder.jsx | FIREBASE-REQUIRED [unreachable-EOS] | `domain/reporting/reportExecutionSeam.js:runReport`, `savedReportService.js` (callables) | — |
| /reporting/saved | reporting/SavedReports.jsx | FIREBASE-REQUIRED [unreachable-EOS] | `savedReportService.js` (callables); Firebase `hasCapability` | — |
| /reporting (index), service, inventory, purchasing, warehouse, employees, customers, financial | PlaceholderPage | PLACEHOLDER (navHidden) | — | — |

## Account / Profile, public, catch-alls

| Route | Component | Classification | Firebase dependencies (file:symbol) | EOS dependencies |
|---|---|---|---|---|
| /my-profile | employees/MyEmployeeProfile.jsx | EOS-ONLY | — (shows "No role resolved" because the legacy role is null) | workforceApiClient |
| /account/security (only when `eosHumanLoginEnabled()`) | account/AccountSecurity.jsx | EOS-ONLY | — | `auth/eosLoginClient.js` |
| customer self-schedule token URL (pre-auth) | selfScheduling/CustomerSchedulingPage.jsx | EOS-ONLY (public token) | — | selfSchedulingApiClient |
| / and * | Navigate → /dashboard | REDIRECT | — | — |
| (unauthenticated) | auth/EosLogin.jsx or auth/Login.jsx | EosLogin is EOS; Login is Firebase Auth | Login: `signInWithEmailAndPassword` | eosLoginClient |
| unrouted | technicians/Technicians.jsx, inventory/Inventory.jsx (LEGACY_COMPONENTS with no nav item) | n/a | Technicians → `domain/jobActions.js`, `useFirestoreCollection`, `collectionStore` (Firestore) | — |

## Totals (routes, excluding redirects; inventory-role counts as 3 and scheduling/dispatch-scheduling as 2)

| Classification | Count | Of which [unreachable-EOS] |
|---|---|---|
| EOS-ONLY (with data) | 40 | 4 (system-config, sales-config, scheduling, dispatch-scheduling) |
| PARTIAL | 11 | 0 |
| FIREBASE-REQUIRED | 22 | 12 (warehouse-racking, financial-policy, 3 inventory-role, finance overview/AR/customer/company/employee, report builder, saved reports) |
| STATIC (no data) | 18 | 16 (all but admin overview and audit-logs) |
| PLACEHOLDER | 16 | 16 |

The **reachable** EOS-only set under the EOS navigation source is 36 screens. The **reachable** Firebase-required set is 10: technician-workspace, scan, warehouse-workspace, dispatcher-board, data-import, parity diagnostics (direct URL), financials invoices and invoice detail, financials payments and payment detail.

## Recommendation

Precondition for any EOS-only login: the build must have `EOS_NAVIGATION_AUTHORITY_READY=true`, which today is `platform-sandbox` only. Without it the session lands on "No access".

**Could be offered under EOS-only login without breaking the business workflow:**
- **Sales/CRM/Commercial.** Accounts list, Opportunities (list and detail), Sales Orders (list and detail), Sales Agreements (list and detail).
  - Account detail is usable for the account, contacts, locations, opportunities and sales orders, but loses AR, CRM activity, imported service history and the admin-only governed-field edit.
- **Equipment** (workspace and detail), **Rental**, **Analysis**.
- **Service intake and planning.** Work Orders list, New Work Order, Inbound Work, Dispatch, Service Operations (Control Tower), Coordinated Visits and Mission.
  - Work Order detail is read-only in practice, so dispatchers would lose lifecycle buttons.
- **Inventory and Purchasing (back-office, desktop).** Part Master, Warehouses, Truck Inventory, Transfers, Cycle Counts, Suppliers, Receipts.
  - Usable with degraded name enrichment: Parts list and detail, Purchase Orders, and the Receiving reorder-PO journey.
- **Administration control plane.** Users, Functional Roles, Objects, Permissions, Workflows, Principal QA, Email Communications.
  - Roles & Permissions works except the privileged-approval panel. User detail role assignment works, but change history, account status and password reset need callables.
- **My Workspace dashboard, My Profile, Account Security.**

**Not offerable under EOS-only login:**
- Technician Workspace, Scan and Warehouse Workspace (Firestore technician profile, Firebase capability feed, balance, receiving and return callables, `role==="technician"`).
- Dispatcher Board (legacy-role refusal).
- All Financials data pages (`listFinancialFacts` / `listAccountInvoiceAr` callables).
- Report Builder and Saved Reports (callables).
- Data Import (callables).
- Warehouse Racking.
- The inventory-role homes (Firestore operationalRoles).
- Parts parity diagnostics.

**Smallest shell fixes that would widen the EOS-only set:**
1. Replace `useReportCapabilities` (the Firebase feed behind `operationalContext.hasCapability`) with an EOS capability read.
2. Replace the legacy-role checks: `getAllowedActions(status, role)` in `controlTower/WorkOrderActions.jsx`, the `DispatcherBoard.jsx:503` gate, the `Jobs.jsx` create button, `NotificationControl` and `scanActions` `role==="technician"`.
3. Replace `useCurrentTechnician` with the EOS employeeId.
4. Move the employee directory to `useGovernedEmployeeDirectory`.
