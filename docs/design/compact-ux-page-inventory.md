# Compact UX — site-wide page inventory and rollout

Status: **INVENTORY, 2026-10-15** at base `a1261486`. Companion to [`compact-ux-standard.md`](compact-ux-standard.md).
Presentation only. Developed under the direction of Rudy DiGiorgio using AI-assisted engineering tools.

**How it was built.** Every routed page was taken from `field-ops-app-vite/src/navigation/navConfig.js` and resolved to its
component through `src/App.jsx` (`renderSubnavItem`). Each component's JSX was read for: header component, prose above the
work area, repeated section headers, prose-only cards, where the primary action sits, and what must stay visible. Word counts
are approximate (±3). Record detail pages (`/customers/:id`, `/equipment/:id`, …) use `RecordIdentity` and are out of scope.

**Group mapping.** The five groups (Home, Work, Records, Insights, Administration) are not in `navConfig.js` yet; the
five-group navigation is Lane A item A6 (pending ND-1). This inventory maps today's domains onto them **for review only** and
changes no navigation:

| Group | Today's domains |
|---|---|
| Home | Dashboard, My Inventory Role homes |
| Work | Service, Service Operations, Rental, Sales pipeline, Inventory operations, Purchasing, Financials operations |
| Records | Customers, Equipment, Parts Catalog, Catalog Admin, Manufacturers, Warehouses, Suppliers, Customer Financials |
| Insights | Analysis, Reporting, the remaining Financials pages |
| Administration | Administration |

**Priority.** **P1** = Administrator, Service, Sales, Inventory or Purchasing workspace **and** notable excess (an intro
≥ ~25 words, two or more prose blocks before data, prose-only cards, or repeated headers with descriptions). **P2** = notable
excess elsewhere. **P3** = already compact, or a placeholder.

**Owner / lane.** "—" = unreserved. Reserved or in-flight surfaces are listed, not edited, by this lane
(`docs/engineering/ACTIVE_WORKSTREAMS.md`).

---

## Findings that shape the rollout

1. **Dead subtitles.** `PageHeader` has no `subtitle` prop, so four pages' intro sentences never render:
   `AdminFinancialPolicy.jsx:32` (~31 words), `AdminSystemConfiguration.jsx:65` (~21), `AdminSalesConfiguration.jsx:74`
   (~25), `FinancialsWorkspace.jsx:193`. This PR deliberately does **not** add a `subtitle` prop (it would add text). The
   rollout moves each to `help` (an InfoTip) or deletes it.
2. **One shared placeholder.** 16 routes render `navigation/PlaceholderPage.jsx` (Notifications, Warranty, Back Orders, Quotes,
   Demand Planning, Vehicles, Regions, Company Settings, eight Reporting domains). One edit compacts all of them.
3. **Scan is shared.** Service → Scan and Inventory → Warehouse Workspace (desktop) are the same `ScanWorkspace`.
   Compacted in this PR.
4. **Repeated headers from label drift.** Nav label vs page title: "Parts Catalog"/"Parts", "Catalog Admin"/"Part Master",
   "Jobs"/"Dispatch", "Dispatcher Board"/"Dispatch & Scheduling", "Inventory & Supply Overview"/"Operations",
   "Employees & Users"/"Users", "Workflows"/"Workflow Assignments". Section titles that repeat the page: Budgets › Budgets,
   Goals › Goals, Invoices › Invoice Collection, Payments › Payment Collection, Users › Workforce, Financial Policy ›
   Financial Policy. Nav labels are Lane A (A3); page titles follow per workspace.
5. **North Star chrome.** Every `WorkspaceIdentity` page opens with the "Enterprise Operations OS" crumb row and a double rule
   before any data. That is ratified North Star grammar; changing it is an Owner design decision, not part of this pass.

---

## Home

| Page | Route | Component | Excess observed | Pri | Owner |
|---|---|---|---|---|---|
| My Dashboard | `/dashboard` | `workspace/MyWorkspace.jsx:168`, `dashboard/MyDashboard.jsx:672` | Up to 5 RuledSections + a frame label per module; 27-word "counted independently" note; a not-enabled tile per unavailable module | P2 | **Lane A** (My Work) |
| Inventory & Supply Overview | `/dashboard/operations` | `operations/Operations.jsx:198` | Hand-rolled `<h2>Operations</h2>` (≠ nav label); ~78-word epic/ledger paragraph before any panel | P2 | — |
| Notifications (hidden) | `/dashboard/notifications` | `navigation/PlaceholderPage.jsx` | Placeholder sentence (26 words) | P3 | — |
| Parts Manager | `/inventory-role/manager` | `inventoryRole/PartsManagerHome.jsx:103` | 31-word intro + 15- and 16-word notes | P1 | — |
| Warehouse Manager | `/inventory-role/warehouse` | `inventoryRole/WarehouseManagerHome.jsx:328` | Same 31-word intro; 17- and ~20-word notes | P1 | — |
| My Purchasing | `/inventory-role/mine` | `inventoryRole/PartsAssociateHome.jsx:69` | Compact (6-word subtitle) | P3 | — |

## Work

| Page | Route | Component | Excess observed | Pri | Owner |
|---|---|---|---|---|---|
| Work Orders | `/service` | `workOrders/WorkOrdersList.jsx:216` | Compact; readiness notice must stay | P3 | — |
| Inbound Work | `/service/inbound-work` | `service/InboundWorkWorkspace.jsx:684` | Compact | P3 | — |
| Job Assignments | `/service/job-assignments` | `jobs/Jobs.jsx:159` | Compact | P3 | — |
| Jobs | `/service/dispatch` | `dispatch/Dispatch.jsx:159` | Hand-rolled `<h2>Dispatch</h2>` (≠ "Jobs"); card per job | P3 | — |
| Dispatcher Board | `/service/dispatcher-board` | `dispatcherBoard/DispatcherBoard.jsx:516` | ~72-word always-visible rules paragraph; ~78-word "Board Rules" footer; "This Session" header | **P1** | **Scheduling lane — coordinate** (owns the board and its compact redesign; `modules/dispatcherBoard/*`, `domain/dispatchBoardGeometry.js`) |
| Scheduling (hidden) | `/service/scheduling` | `scheduling/SchedulingWorkspace.jsx:168` | Compact | P3 | **Scheduling lane — coordinate** |
| Dispatch Board (hidden) | `/service/dispatch-scheduling` | `dispatch/DispatchSchedulingWorkspace.jsx:195` | 27-word instruction | P3 | **Scheduling lane — coordinate** |
| Coordinated Visits | `/service/coordinated-visits` | `service/CoordinatedVisitsWorkspace.jsx:203` | Compact; Sample Data banner must stay | P3 | — |
| Coordinated Mission | `/service/coordinated-mission` | `mobile/CoordinatedMissionView.jsx:129` | Compact | P3 | — |
| Technician Workspace | `/service/technician-workspace` | `mobile/FieldMode.jsx:226`, `technician/TechnicianShell.jsx` | Compact | P3 | — |
| **Scan** | `/service/scan` | `scan/ScanWorkspace.jsx:329` | 34-word intro; desktop grid of cards; card-in-card refusal panel | **P1 — done in this PR** | — |
| Warranty (hidden) | `/service/warranty` | `PlaceholderPage.jsx` | Placeholder | P3 | — |
| Service Operations | `/service-operations` | `controlTower/ControlTower.jsx:156` | Compact; title repeats nav domain and item | P3 | — |
| Rental | `/rental` | `rental/RentalWorkspace.jsx:186` | ~11 headed blocks each with a description; empty tables as cards with one sentence | P2 | — |
| Opportunities | `/customers/opportunities` | `sales/OpportunityList.jsx:201` | Compact | P3 | — |
| Sales Orders | `/customers/sales-orders` | `sales/SalesOrdersList.jsx:133` | Compact | P3 | — |
| Sales Agreements | `/customers/sales-agreements` | `sales/SalesAgreementsList.jsx:186` | Compact | P3 | — |
| **Warehouse Workspace** | `/inventory/warehouse-workspace` | desktop = `ScanWorkspace`; phone `warehouse/WarehouseShell.jsx` | Same as Scan | **P1 — done (desktop) in this PR** | — |
| Truck Inventory | `/inventory/truck-inventory` | `inventory/TruckInventory.jsx:275` | 26-word intro | P1 | — |
| Transfers | `/inventory/transfers` | `inventory/Transfers.jsx:144` | 18-word intro | P3 | — |
| Reorder Queue | `/inventory/reorder-queue` | `PartsManagerHome.jsx:103` | Same as Parts Manager | P1 | — |
| Receiving | `/inventory/receiving` | `inventory/Receiving.jsx:127` | 22-word purpose line; 38-word exception card; 30-word "not connected yet" card | P1 | — |
| Cycle Counts | `/inventory/cycle-counts` | `inventory/CycleCounts.jsx:102` | 44-word intro + summary line | P1 | — |
| Back Orders (hidden) | `/inventory/back-orders` | `PlaceholderPage.jsx` | Placeholder | P3 | — |
| Purchase Orders | `/purchasing` | `purchasing/PurchaseOrders.jsx:176` | 38-word intro | P1 | — |
| Receipts | `/purchasing/receipts` | `purchasing/Receipts.jsx:79` | 29-word intro + count line; three header variants | P1 | — |
| Quotes, Demand Planning (hidden) | `/purchasing/quotes`, `/demand-planning` | `PlaceholderPage.jsx` | Placeholder | P3 | — |
| Billing Queue | `/financials/billing-queue` | `financials/FinancialsBillingQueue.jsx:38` | 20-word custody line + 20-word section meta | P2 | Finance lane |
| Invoices | `/financials/invoices` | `FinancialsInvoices.jsx:115` | Section "Invoice Collection" repeats title | P3 | Finance lane |
| Accounts Receivable | `/financials/accounts-receivable` | `FinancialsAccountsReceivable.jsx:104` | Two 20–30-word truth bands + two notes | P2 | Finance lane (#2101 open) |
| Payments | `/financials/payments` | `FinancialsPayments.jsx:108` | 62-word "future authority" band; section repeats title | P2 | Finance lane |
| Credits & Adjustments | `/financials/credits-adjustments` | `FinancialsCreditsAdjustments.jsx:45` | 22-word section meta | P2 | Finance lane |

## Records

| Page | Route | Component | Excess observed | Pri | Owner |
|---|---|---|---|---|---|
| Customers | `/customers` | `accounts/AccountsList.jsx:202` | Compact | P3 | — |
| Equipment | `/equipment` | `equipment/EquipmentWorkspace.jsx:74` | 24-word description + 14- and 13-word tab notes | P2 | **Lane C** (equipment) |
| Parts Catalog | `/inventory` | `inventory/PartsList.jsx:997` | Four rail notes (12–22 words); in-page second header repeats the count; title "Parts" ≠ nav | P1 | — |
| Catalog Admin | `/inventory/part-master` | `inventory/PartMasterList.jsx:336` | 30-word intro; title "Part Master" ≠ nav | P1 | — |
| Manufacturers (hidden) | `/inventory/manufacturers` | `inventory/Manufacturers.jsx:221` | 28-word intro | P1 | — |
| Warehouses | `/inventory/warehouses` | `inventory/Warehouses.jsx:162` | 25-word intro + status line + 16-word footnote | P1 | — |
| Suppliers | `/purchasing/suppliers` | `purchasing/Suppliers.jsx:169` | 27-word intro + 14-word footnote | P1 | — |
| Customer Financials | `/financials/customer-financials` | `FinancialsCustomerFinancials.jsx:87` | 24-word intro; five h2s; four "not applicable" sentences | P2 | Finance lane |

## Insights

| Page | Route | Component | Excess observed | Pri | Owner |
|---|---|---|---|---|---|
| Analysis | `/analysis` | `analysis/AnalysisWorkspace.jsx:180` | 22-word description; one panel + header per measure | P2 | Security lane (#2105 touches Analysis reads) |
| Report Builder | `/reporting/builder` | `reporting/ReportBuilder.jsx:127` | Hand-rolled `<h2>`; 30-word intro; six h3 steps | P2 | — |
| Saved Reports | `/reporting/saved` | `reporting/SavedReports.jsx:125` | Hand-rolled `<h2>`; 15-word intro | P3 | — |
| Reporting domains ×8 (hidden) | `/reporting/*` | `PlaceholderPage.jsx` | Eight identical 25-word placeholders | P3 | — |
| Financials Overview | `/financials` | `FinancialsOverview.jsx:68` | 48-word truth band, five cross-link notes, then an embedded second page (~9 panels, 38-word header) | P2 | Finance lane |
| Sales to Goal | `/financials/sales-to-goal` | `FinancialsSalesToGoal.jsx:29` | 21-word intro; ~50-word state detail | P2 | Finance lane |
| Cost to Budget | `/financials/cost-to-budget` | `FinancialsCostToBudget.jsx:25` | 59-word truth band | P2 | Finance lane |
| Forecasting | `/financials/forecasting` | `FinancialsForecasting.jsx:25` | 19-word intro | P2 | Finance lane |
| Gross Margin & Profitability | `/financials/profitability` | `FinancialsProfitability.jsx:34` | 52-word truth band; "Never on This Page" section | P2 | Finance lane |
| Budget Management | `/financials/budgets` | `FinancialsBudgets.jsx:35` | Section repeats title | P2 | Finance lane |
| Goal Management | `/financials/goals` | `FinancialsGoals.jsx:35` | Section repeats title | P2 | Finance lane |
| Company & BU Performance | `/financials/company-performance` | `FinancialsCompanyPerformance.jsx:82` | 19-word intro | P2 | Finance lane |
| Salesperson & Employee Performance | `/financials/employee-performance` | `FinancialsEmployeePerformance.jsx:101` | Two intro lines; three h2s | P2 | Finance lane |
| Reconciliation & Exceptions | `/financials/reconciliation` | `FinancialsReconciliation.jsx:26` | 34-word intro + two 34-word truth bands | P2 | Finance lane |
| Intercompany | `/financials/intercompany` | `FinancialsIntercompany.jsx:33` | 21-word intro | P2 | Finance lane |
| Financial Audit & History | `/financials/audit` | `FinancialsAudit.jsx:34` | 17-word intro | P2 | Finance lane |
| Reporting & Exports | `/financials/reports` | `FinancialsReports.jsx:43` | 28-word intro | P2 | Finance lane |
| Financial Settings & Governance | `/financials/governance` | `FinancialsGovernance.jsx:123` | 22-word intro; five h2 row lists (already use tips) | P2 | Finance lane (#2104 proposed) |

## Administration

| Page | Route | Component | Excess observed | Pri | Owner |
|---|---|---|---|---|---|
| **Overview** | `/administration/overview` | `administration/AdministrationOverview.jsx` | Hand-rolled `<h2>`; 26-word intro; ~150 words of destination descriptions; version panel in sentences | **P1 — done in this PR** | — |
| Employees & Users | `/administration/users` | `administration/AdminUsers.jsx:69` | 18-word intro; h2 "Workforce" under h1 "Users"; collapsed ~90-word explainer | P1 | — (#2046 open on UserDetail, not this file) |
| Roles | `/administration/roles-permissions` | `AdminRolesPermissions.jsx:205`, `AdminPolicySurfaces.jsx:168` | ~250 words of intro prose (80-word legend), nine section headers, six mostly-prose panels | **P1 (worst)** | — |
| Objects | `/administration/objects` | `AdminObjects.jsx:354` | 49-word legend; two ~25-word warnings (stay); Diagnostics panel with three headed blocks | P1 | — |
| Permissions | `/administration/permissions` | `AdminPermissions.jsx:27` | 25-word intro | P1 | — |
| Workflows | `/administration/workflows` | `AdminWorkflows.jsx` → `WorkflowAssignments.jsx:203` / `AdminWorkflowBuilder.jsx:131` | Three or four 14–23-word lines; "No workflow selected" prose panel | P1 | **Reserved** (Workflow Assignments/Builder workstream) |
| Principal Inspection (hidden) | `/administration/qa/principal-inspection` | `PrincipalQaInspection.jsx:73` | QA tool, 33-word intro | P3 | — |
| Vehicles, Regions, Company Settings (hidden) | `/administration/*` | `PlaceholderPage.jsx` | Placeholder | P3 | — |
| Duplicate Rules | `/administration/duplicate-rules` | `AdminDuplicateRules.jsx:110` | Eyebrow repeats the rail; 20-word intro; two section descriptions | P1 | — |
| Warehouse Racking | `/administration/warehouse-racking` | `AdminWarehouseRacking.jsx:365` | 27-word intro; seven SectionHeaders each with a sentence | P1 | — |
| Financial Policy | `/administration/financial-policy` | `AdminFinancialPolicy.jsx:30`, `FinancialPolicyWorkspace.jsx:376` | Dead subtitle; section repeats title; six 14–22-word section descriptions | P1 | Finance lane (#2104 proposed) |
| System Configuration | `/administration/system-configuration` | `AdminSystemConfiguration.jsx:65` | Dead subtitle; 30-word section description | P1 | — |
| Sales Configuration | `/administration/sales-configuration` | `AdminSalesConfiguration.jsx:74` | Dead subtitle; 35-word section description | P1 | — |
| Data Import | `/administration/data-import` | `AdminDataImport.jsx:308` | 27-word intro; eight step panels each with a hint | P1 | **Lane C** (data import) |
| Email & Communications | `/administration/email-communications` | `AdminEmailCommunications.jsx:795` | One paragraph per tab (Overview 32 words) | P1 | — |
| Integrations | `/administration/integrations` | `IntegrationsFaq.jsx:116` | Whole page is explanation: hero, principles strip, checklist, 15-entry FAQ, no data | P1 | — (content decision: see rollout) |
| Audit Logs | `/administration/audit-logs` | `AdminAuditLogs.jsx:12` | Page is a 37-word pointer card | P1 | **#1965 open** (wires real audit history; compaction follows it) |
| Functional Roles | `/administration/users/functional-roles` | `AdminFunctionalRoles.jsx:247` | Hand-rolled `<h1>`; 38-word intro | P1 | — |

## Must stay visible (found across the site; standard §6)

`NOT_YET_ACTIVATED` readiness notices (Work Orders, Inbound Work); Sample Data banners (Opportunities, Coordinated
Visits/Mission); disabled-action reasons (New Opportunity, New Part, Financials New Budget/Goal, Add rule); fail-closed and
denied states (Manufacturers, Receiving, Scan "Not Available to You", Administration `NotConfiguredNotice`); `role="alert"`
errors; authorization refusals ("Accepting a job is not part of your role", "Changing email configuration is not part of your
role", "Dispatch Board is not available to you"); Financials "future authority" and truth-band labels (the label stays; long
explanations under it may move to a tip).

---

## Rollout — one PR per workspace, each with before/after frames

| PR | Scope | Pages | Coordination |
|---|---|---|---|
| **1 (this PR)** | Standard, components, proof | Administration Overview; Scan (= Warehouse Workspace desktop) | — |
| 2 | Shared surfaces (highest leverage) | `PlaceholderPage` (16 routes); dead `subtitle` props → `help` or removed (4 pages) | — |
| 3 | Administration — access | Roles, Objects, Permissions, Employees & Users, Functional Roles | Users after #2046 lands |
| 4 | Administration — configuration | Duplicate Rules, Warehouse Racking, System and Sales Configuration, Email & Communications, Integrations | Integrations: Owner to choose "FAQ in a tip/disclosure" vs "move to the user guide" |
| 5 | Inventory | Parts Manager / Warehouse Manager / Reorder Queue (one component), Truck Inventory, Receiving, Cycle Counts, Parts Catalog, Catalog Admin, Manufacturers, Warehouses | — |
| 6 | Purchasing | Purchase Orders, Receipts, Suppliers | — |
| 7 | Service | Jobs header, Inventory & Supply Overview | The scheduling board is the Scheduling lane (below) |
| 8 | Sales & Rental | Rental (empty tables collapse to one line) | — |
| 9 | Insights | Report Builder, Analysis | Analysis after #2105 |
| Handoff | Not this lane | Dispatcher Board, Scheduling and Dispatch Board (**Scheduling lane**, `work/eos-employee-shift-schedule`: reuses the shared components, standard §9); My Dashboard (Lane A); nav-label drift (Lane A A3); Financials pages and Financial Policy (Finance lane); Data Import and Equipment (Lane C); Workflows (reserved); Audit Logs (after #1965) | Hand each the standard + components |

Each rollout PR: shared components only, no reads or permissions changed, wording moved not deleted, before/after frames at
1440 and 375 from `test/__visual__/renderCompactUx.test.jsx`, and an assertion in `test/compactUxStandard.test.jsx` that the
page's warnings and refusals are still outside any tip.
