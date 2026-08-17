# EOS Metadata-to-Platform Program — Execution Ledger

> **Generated file — do not hand-edit.** Rendered from `metadata-program/ledger.json` by
> `lib/metadataProgramLedger.mjs`. Edit the JSON, re-render, commit both.

**This is a cache. GitHub and `origin/main` are truth.** A resuming session reads governance,
reads this, reconciles every claim against observed state, corrects what disagrees, and then
continues from the next executable item — without asking what happened.

**Baseline:** origin/main f06801f0 (page composition runtime + index CI bridge merged)

## Surface conformance

| Total routed surfaces | Accounted for | Unaccounted for |
|---|---|---|
| 45 | 42 | 3 |

## Stale blocks — resolve before trusting "nothing executable"

27 item(s) are BLOCKED_DEPENDENCY with every dependency already satisfied.
Each needs a deliberate call: promote it to READY, or re-point it at what it actually needs.

- **S-CRM-ACCOUNT-RECORD** — depends on A-PAGE-COMPONENT (all satisfied) → Migrate onto the page definition runtime
- **S-CRM-OPPORTUNITIES** — depends on D-OPPORTUNITY-IDENTITY, A-LIST-GRID (all satisfied) → Identity is on main; awaiting the list runtime
- **S-CRM-SALES-ORDER-RECORD** — depends on A-PAGE-COMPONENT (all satisfied) → Migrate onto page runtime; resolve raw-id labels
- **S-SVC-WORK-ORDERS** — depends on A-LIST-GRID (all satisfied) → The Gate B non-CRM validation target
- **S-SVC-WO-RECORD** — depends on A-PAGE-COMPONENT (all satisfied) → Migrate after Gate B
- **S-SVC-JOB-ASSIGNMENTS** — depends on A-LIST-GRID (all satisfied) → Migrate or retire — overlaps the Work Orders list
- **S-SVC-DISPATCH-QUEUE** — depends on A-LIST-GRID (all satisfied) → Classify: queue with governed transition writes, not a list
- **S-SVC-COORDINATED-VISITS** — depends on A-LIST-GRID (all satisfied) → Confirm synthetic-source status before migrating anything
- **S-SVC-COORDINATED-MISSION** — depends on A-LIST-GRID (all satisfied) → Same synthetic-source caveat as coordinated visits
- **S-SVC-CONTROL-TOWER** — depends on A-PAGE-COMPONENT (all satisfied) → Bounded-read remediation; dashboard composition is a later phase
- **S-SVC-WO-NEW** — depends on A-LIST-GRID (all satisfied) → Bounded-read remediation: it reads the whole accounts collection
- **S-ADM-EMPLOYEES** — depends on A-LIST-GRID (all satisfied) → Migrate onto list runtime
- **S-ADM-SAVED-REPORTS** — depends on A-LIST-GRID (all satisfied) → Migrate onto list runtime
- **S-ADM-USERS** — depends on A-PAGE-COMPONENT (all satisfied) → Inventory only; no governed directory read exists to migrate
- **S-ADM-ROLES** — depends on A-PAGE-COMPONENT (all satisfied) → Inventory only; form is unconditionally disabled

## Next executable

- **X-ACCOUNT-SEARCH** (phase 6) — Governed Account search → Design a bounded server-side name search; do not restore the client-array provider

## READY

| id | phase | title | route | issue | PR | head | merge | deploy | next action |
|---|---|---|---|---|---|---|---|---|---|
| X-ACCOUNT-SEARCH | 6 | Governed Account search | /customers | — | — | — | — | NOT_APPLICABLE | Design a bounded server-side name search; do not restore the client-array provider |

## MERGED

| id | phase | title | route | issue | PR | head | merge | deploy | next action |
|---|---|---|---|---|---|---|---|---|---|
| P0-LEDGER | 0 | Program execution ledger + resumption model | — | — | #1113 | 3dce271a | 1f1f1a4d | NOT_APPLICABLE | Merged to origin/main; verified by mergeSha |
| S-CRM-CUSTOMERS | 4 | Customers (Accounts list) | /customers | #1097 | #1138 | — | abfd3ee7 | NOT_APPLICABLE | Merged. The accounts composite index is declared and pending deploy. |
| A-CONTRACT-CORE | 1 | Entity/Field/Relationship definition contracts | — | — | #1106 | 28338738 | 3a07e4d8 | NOT_APPLICABLE | Merged to origin/main; verified by mergeSha |
| A-LIST-METADATA-V1 | 3 | Entity List Metadata v1 runtime | — | #1096 | #1115 | bd787211 | 2c673e16 | NOT_APPLICABLE | Merged to origin/main; verified by mergeSha |
| A-PAGE-RUNTIME | 5 | Page definition contract (PageDefinition/PageRegion) | — | — | #1118 | 656023c8 | 9d10440e | NOT_APPLICABLE | Merged to origin/main; verified by mergeSha |
| A-REGISTRIES | 2 | Component and action registries | — | — | #1116 | ead08eeb | fb4257a0 | NOT_APPLICABLE | Merged to origin/main; verified by mergeSha |
| G-GATE-A | 3 | Gate A — metadata foundation review package | — | — | #1119 | bad4c0b0 | 64736d50 | NOT_APPLICABLE | Merged to origin/main; verified by mergeSha |
| D-BUG-STATUS-CASING | 6 | Canonical ACCOUNT_STATUS machine values + display labels | — | #1093 | #1103 | f41045b8 | bb72103e | NOT_APPLICABLE | Merged to origin/main; verified by mergeSha |
| D-BUG-AR-CONTRACT | 6 | Shared AR view-state contract | — | #1094 | #1102 | 7b87a025 | b65066ff | NOT_APPLICABLE | Merged to origin/main; verified by mergeSha |
| D-BUG-AR-OWNERSHIP | 6 | One authoritative Account AR read owner | — | #1095 | #1114 | 7824cf4f | 390d5149 | NOT_APPLICABLE | Merged to origin/main; verified by mergeSha |
| S-INV-TRUCK | 9 | Truck inventory | /inventory/truck-inventory | — | #1109 | b7d8d2e8 | 39524862 | NOT_APPLICABLE | Merged to origin/main; verified by mergeSha |
| A-CONTRACT-TOOLING | 1 | Shared contract source of truth | — | — | #1110 | a9ed84c9 | c01c0531 | NOT_APPLICABLE | Merged to origin/main; verified by mergeSha |
| A-BOUNDED-READS | 3 | Bounded-read remediation across list-exempt surfaces | — | — | #1132 | — | 6fee1296 | NOT_APPLICABLE | Merged to origin/main; verified by mergeSha |
| A-CALLABLE-UNBOUNDED | 3 | Unbounded trusted-callable reads | — | — | #1107 | fb5f933a | 12e64a89 | NOT_APPLICABLE | Merged to origin/main; verified by mergeSha |
| X-RULES-DISCREPANCY | 0 | mobile_locations read path disagrees with Rules | — | — | #1108 | 82017110 | 5b72c837 | NOT_APPLICABLE | Merged to origin/main; verified by mergeSha |
| X-INVENTORY-ANALYTICS-CAPABILITY | 3 | getInventoryAnalytics: bounded read + capability-catalog authorization | — | — | #1111 | 888ca6fc | 6896888b | NOT_APPLICABLE | Merged to origin/main; verified by mergeSha |
| A-PERMISSION-CATALOG-GENERATION | 1 | Bring permissionCatalog.ts under generation | — | — | #1117 | 22f48184 | 1cbd170e | NOT_APPLICABLE | Merged to origin/main; verified by mergeSha |
| A-METADATA-SPEC | 1 | Metadata Architecture specification | — | — | #1112 | a458d881 | abedeff5 | NOT_APPLICABLE | Merged to origin/main; verified by mergeSha |
| A-LIST-RUNTIME | 3 | List runtime component consuming ListViewDefinition | — | — | #1126 | 1121e888 | dafa60df | NOT_APPLICABLE | Merged to origin/main; verified by mergeSha |
| A-INDEX-CI-BRIDGE | 3 | CI gate: declared list filters must have declared indexes | — | — | #1134 | — | 5b87e262 | NOT_APPLICABLE | Merged to origin/main; verified by mergeSha |
| A-PAGE-RENDERER | 5 | Record page renderer consuming PageDefinition | — | — | #1128 | 54dc7a47 | cdf79f1b | NOT_APPLICABLE | Merged to origin/main; verified by mergeSha |
| D-OPPORTUNITY-IDENTITY | 9 | Opportunity human identity (name + immutable reference) | — | #1099 | #1120 | e6526d85 | 3fdf1ccf | NOT_APPLICABLE | Merged to origin/main; verified by mergeSha |
| D-OPPORTUNITY-NAME-AND-WIRING | 9 | Wire Opportunity identity into the governed create path and surfaces | — | #1099 | #1123 | 58f269e2 | f7c1df5b | NOT_APPLICABLE | Merged to origin/main; verified by mergeSha |
| D-SALES-ORDER-OPP-IDENTITY | 9 | Sales Order detail still renders sourceOpportunityId raw | — | #1099 | #1124 | ce827015 | a9c48a1d | NOT_APPLICABLE | Merged to origin/main; verified by mergeSha |
| A-LIST-GRID | 3 | List grid component consuming the query core | — | — | #1130 | — | 582d1a3c | NOT_APPLICABLE | Merged to origin/main; verified by mergeSha |
| A-PAGE-COMPONENT | 5 | Record page React component consuming the composition plan | — | — | #1135 | — | 774ea795 | NOT_APPLICABLE | Merged to origin/main; verified by mergeSha |
| A-LIST-COMPONENT | 3 | List React component rendering the presentation model | — | — | #1136 | — | 2fff78b1 | NOT_APPLICABLE | Merged to origin/main; verified by mergeSha |
| A-BOUNDED-READS-REMAINING | 3 | Remaining unbounded PURE LIST reads | — | — | #1133 | — | 2a7847d1 | NOT_APPLICABLE | Merged to origin/main; verified by mergeSha |
| A-INDEX-FILTER-COMBINATIONS | 6 | Index derivation across filter COMBINATIONS | — | — | #1139 | — | 04567b43 | NOT_APPLICABLE | Merged; three accounts composites declared and pending deploy |

## BLOCKED_PROTECTED

| id | phase | title | route | issue | PR | head | merge | deploy | next action |
|---|---|---|---|---|---|---|---|---|---|
| X-ADMIN-CRM-AUTHORITY | 0 | crm.activity.read via canonical admin authority | — | — | #1100 | — | — | NOT_APPLICABLE | Await Owner authorization; program proceeds around it |
| X-STATUS-DATA-AUDIT | 6 | Account status persisted-data audit before production rollout | — | — | — | — | — | NOT_APPLICABLE | Audit production Account documents for title-case status values |
| X-TRUCK-PROD-LIVE-RISK | 0 | URGENT: production may already expose truck write controls | — | — | — | — | — | UNKNOWN | Authorized operator verifies the live production bundle and the deployed callable set |
| X-INVENTORY-ANALYTICS-AGGREGATE | 3 | Authoritative aggregation for netted inventory figures (server and client) | — | — | — | — | — | NOT_APPLICABLE | Owner decision on a governed per-part availability projection |
| X-NO-GOVERNED-READ-COLLECTIONS | 9 | BLOCKED-NO-GOVERNED-READ: six collections have no read authority at all | — | — | — | — | — | NOT_APPLICABLE | No metadata work possible; each needs a governed read service under normal capability governance |
| X-ACCOUNT-TAG-CATALOG | 6 | Governed Account tag facet / catalog projection | /customers | — | — | — | — | NOT_APPLICABLE | Needs an authoritative tag source before a facet can be honest |

> **X-ADMIN-CRM-AUTHORITY** blocked — Capability grant / role-matrix change. Sandbox activation is already done; no business role carries crm.activity.read. · requires: Owner authorizes the capability through the admin business role, and decides read-only vs read+create
> **X-STATUS-DATA-AUDIT** blocked — AccountForm defaulted new accounts to ACCOUNT_STATUS.PROSPECT, so any account created through the UI before PR #1103 persisted title-case. Sandbox holds two seeded accounts, both uppercase; production document state is unknown from here and was deliberately not claimed. · requires: Owner authorizes a production data read to determine whether a status migration is required
> **X-TRUCK-PROD-LIVE-RISK** blocked — Truck write readiness is a COMPILE-TIME constant baked into a Hosting bundle. PR #1109 fails the repository declaration closed, but if a previously released production bundle carries the old true, production users may see enabled truck-management write controls right now. Only a Hosting release built from the corrected config changes what is live. Separately, whether the eight callables are actually deployed to taylor-parts is unverified in either direction. · requires: Owner authorizes a live production check of (a) the served bundle's readiness value and (b) the deployed Functions set, then decides whether a Hosting release is required
> **X-INVENTORY-ANALYTICS-AGGREGATE** blocked — INVESTIGATED against ruling section 4's preference order; no unblocked option exists for the CROSS-PART case. (A) No materialized summary exists - repo-wide search found no per-part availability document or collection. (B) A server-side aggregate cannot express it: Firestore's getAggregateFromServer has no GROUP BY, so it can sum one part's ledger but cannot produce availability for all parts in one query. (C) An explicitly scoped complete query DOES exist and is already used - inventoryService.getAvailableQuantity() scans inventory_transactions where partId == X, which is provably complete FOR THAT PART. It does not generalize: N parts means N queries. (D) A new governed projection is therefore the only path for the dashboard, and that means schema plus trigger maintenance plus deployment. · requires: Owner authorizes a governed per-part availability projection (schema + maintenance + deploy), or accepts an explicitly scoped analytic surface instead of a whole-catalog dashboard
> **X-NO-GOVERNED-READ-COLLECTIONS** blocked — payments, payment_applications, invoice_adjustments, refunds, part_supplier_items and part_aliases are all allow read, write: if false in firestore.rules, and exhaustive search of functions/src found NO exported callable that reads any of them - only writers. part_supplier_items has a pure projection contract explicitly not activated. Metadata is presentation and composition, not authority, so it cannot make an unreadable collection readable. · requires: Owner authorizes building and activating a governed read service per collection, when the business capability requires it
> **X-ACCOUNT-TAG-CATALOG** blocked — No authoritative Account tag catalog exists; the old facet was built by scanning every account in the browser · requires: Whether tags become governed reference data with a catalog, or remain free-form labels with no global facet. A facet rebuilt from the current page would present 'the tags on these fifty rows' as 'the tags that exist'.

## BLOCKED_DEPENDENCY

| id | phase | title | route | issue | PR | head | merge | deploy | next action |
|---|---|---|---|---|---|---|---|---|---|
| S-CRM-ACCOUNT-RECORD | 6 | Customer/Account detail | /customers/:accountId | — | — | — | — | NOT_APPLICABLE | Migrate onto the page definition runtime |
| S-CRM-OPPORTUNITIES | 9 | Opportunities workspace | /customers/opportunities | #1099 | — | — | — | NOT_APPLICABLE | Identity is on main; awaiting the list runtime |
| S-CRM-SALES-ORDER-RECORD | 9 | Sales Order detail | /customers/opportunities/sales-order/:salesOrderId | — | — | — | — | NOT_APPLICABLE | Migrate onto page runtime; resolve raw-id labels |
| S-SVC-WORK-ORDERS | 8 | Work Orders list | /service | #1098 | — | — | — | NOT_APPLICABLE | The Gate B non-CRM validation target |
| S-SVC-WO-RECORD | 9 | Work Order detail | /service/work-orders/:workOrderId | — | — | — | — | NOT_APPLICABLE | Migrate after Gate B |
| S-SVC-JOB-ASSIGNMENTS | 9 | Job Assignments (legacy jobs list) | /service/job-assignments | — | — | — | — | NOT_APPLICABLE | Migrate or retire — overlaps the Work Orders list |
| S-SVC-DISPATCH-QUEUE | 9 | Dispatch queue | /service/dispatch | — | — | — | — | NOT_APPLICABLE | Classify: queue with governed transition writes, not a list |
| S-SVC-COORDINATED-VISITS | 9 | Coordinated visits | /service/coordinated-visits | — | — | — | — | NOT_APPLICABLE | Confirm synthetic-source status before migrating anything |
| S-SVC-COORDINATED-MISSION | 9 | Coordinated mission | /service/coordinated-mission | — | — | — | — | NOT_APPLICABLE | Same synthetic-source caveat as coordinated visits |
| S-SVC-CONTROL-TOWER | 9 | Service Operations (Control Tower) | /service-operations | — | — | — | — | NOT_APPLICABLE | Bounded-read remediation; dashboard composition is a later phase |
| S-SVC-WO-NEW | 9 | New Work Order wizard | /service/work-orders/new | — | — | — | — | NOT_APPLICABLE | Bounded-read remediation: it reads the whole accounts collection |
| S-ADM-EMPLOYEES | 9 | Employees (Technicians list) | /administration | — | — | — | — | NOT_APPLICABLE | Migrate onto list runtime |
| S-ADM-SAVED-REPORTS | 9 | Saved Reports | /reporting/saved | — | — | — | — | NOT_APPLICABLE | Migrate onto list runtime |
| S-ADM-USERS | 9 | Users (admin) | /administration/users | — | — | — | — | NOT_APPLICABLE | Inventory only; no governed directory read exists to migrate |
| S-ADM-ROLES | 9 | Roles & Permissions | /administration/roles-permissions | — | — | — | — | NOT_APPLICABLE | Inventory only; form is unconditionally disabled |
| S-DASH-MY | 9 | My Dashboard | /dashboard | — | — | — | — | NOT_APPLICABLE | Later phase; dashboard composition is not list/record metadata |
| S-DASH-OPERATIONS | 9 | Inventory & Supply Overview | /dashboard/operations | — | — | — | — | NOT_APPLICABLE | Needs an authoritative aggregate before its reads can be bounded |
| G-GATE-B | 8 | Gate B — cross-domain validation (Work Orders) | — | #1098 | — | — | — | NOT_APPLICABLE | Do not begin site-wide migration if this exposes a bad abstraction |
| S-INV-PARTS | 9 | Parts catalog | /inventory | — | — | — | — | NOT_APPLICABLE | Migrate onto list runtime |
| S-INV-PART-DETAIL | 9 | Part detail | /inventory/:partId | — | — | — | — | NOT_APPLICABLE | Migrate onto page runtime |
| S-INV-PART-MASTER | 9 | Part Master bulk status table | /inventory/part-master | — | — | — | — | NOT_APPLICABLE | Migrate; navHidden, direct-URL only |
| S-INV-WAREHOUSES | 9 | Warehouses | /inventory/warehouses | — | — | — | — | NOT_APPLICABLE | Migrate onto list runtime |
| S-INV-SUPPLIERS | 9 | Suppliers | /purchasing/suppliers | — | — | — | — | NOT_APPLICABLE | Migrate onto list runtime |
| S-INV-TRANSFERS | 9 | Transfers | /inventory/transfers | — | — | — | — | NOT_APPLICABLE | Bounded-read remediation; lifecycle composite, not a list |
| S-INV-MANUFACTURERS | 9 | Manufacturers | /inventory/manufacturers | — | — | — | — | NOT_APPLICABLE | Inventory only - writes are closed in every environment including sandbox |
| S-INV-EQUIPMENT | 9 | Equipment workspace | /equipment | — | — | — | — | NOT_APPLICABLE | Migrate; already cursor-paginated |
| S-INV-EQUIPMENT-DETAIL | 9 | Equipment detail | /equipment/:equipmentId | — | — | — | — | NOT_APPLICABLE | Migrate onto page runtime |
| S-COM-PURCHASE-ORDERS | 9 | Purchase orders | /purchasing | — | — | — | — | NOT_APPLICABLE | Migrate onto list runtime |
| S-COM-RECEIPTS | 9 | Receipts | /purchasing/receipts | — | — | — | — | NOT_APPLICABLE | Migrate onto list runtime |
| S-DASH-OPERATIONS-SCALE | 9 | Operations dashboard loads the operational database client-side | — | — | — | — | — | NOT_APPLICABLE | Same authoritative-aggregate dependency as S-DASH-OPERATIONS |

## EXEMPT

| id | phase | title | route | issue | PR | head | merge | deploy | next action |
|---|---|---|---|---|---|---|---|---|---|
| S-CRM-RETIRED | 0 | Retired CRM paths (contacts/locations/equipment/service-history) | /customers/{contacts,locations,equipment,service-history} | — | — | — | — | NOT_APPLICABLE | None |
| S-SVC-DISPATCHER-BOARD | 9 | Dispatcher board | /service/dispatcher-board | — | — | — | — | NOT_APPLICABLE | Bounded-read remediation only |
| S-SVC-SCHEDULING | 9 | Scheduling (weekly technician x day) | /service/scheduling | — | — | — | — | NOT_APPLICABLE | Bounded-read remediation only |
| S-SVC-DISPATCH-SCHEDULING | 9 | Dispatch board (technician x time axis) | /service/dispatch-scheduling | — | — | — | — | NOT_APPLICABLE | Bounded-read remediation only |
| S-SVC-TECH-WORKSPACE | 9 | Technician workspace (Field Mode) | /service/technician-workspace | — | — | — | — | NOT_APPLICABLE | None |
| S-SVC-WARRANTY | 0 | Warranty | /service/warranty | — | — | — | — | NOT_APPLICABLE | None |
| S-ADM-REPORT-BUILDER | 9 | Report Builder | /reporting/builder | — | — | — | — | NOT_APPLICABLE | Treat as prior art input to Gate A, not a migration target |
| S-ADM-OVERVIEW | 9 | Administration overview | /administration/overview | — | — | — | — | NOT_APPLICABLE | None |
| S-ADM-PLACEHOLDERS | 0 | Unbuilt placeholder routes (18) | /reporting/*, /administration/{vehicles,regions,company-settings,permission-preview,audit-logs}, /dashboard/notifications, /financials, /purchasing/{quotes,demand-planning}, /inventory/back-orders, /service/warranty | — | — | — | — | NOT_APPLICABLE | None until built |
| S-INV-RECEIVING | 9 | Receiving | /inventory/receiving | — | — | — | — | NOT_APPLICABLE | None - a workflow, not a list |
| S-INV-CYCLE-COUNTS | 9 | Cycle counts | /inventory/cycle-counts | — | — | — | — | NOT_APPLICABLE | None - scan-driven workflow |
| S-INV-ROLE-HOMES | 9 | Operational role homes | /inventory-role/{manager,warehouse,mine} | — | — | — | — | NOT_APPLICABLE | None - role-scoped queues |
| S-DIAG-PARITY | 0 | Parts shadow parity diagnostics | /admin/diagnostics/inventory-parts-parity | — | — | — | — | NOT_APPLICABLE | None |
| A-INDEX-VALIDATOR | 3 | ListViewDefinition to composite-index validator | — | — | — | — | — | NOT_APPLICABLE | None - see A-INDEX-CI-BRIDGE |
| A-MIRROR-PARITY-COVERAGE | 1 | Mirror parity enforcement for governedBusinessRoles + shadowParityHarness | — | — | #1104 | — | — | NOT_APPLICABLE | None - superseded |

## COMPLETE

| id | phase | title | route | issue | PR | head | merge | deploy | next action |
|---|---|---|---|---|---|---|---|---|---|
| P0-INV-CRM | 0 | CRM/Sales surface inventory | — | — | — | — | — | NOT_APPLICABLE | Folded into surface entries below |
| P0-INV-SERVICE | 0 | Service/Work Order/Dispatch surface inventory | — | — | — | — | — | NOT_APPLICABLE | Folded into surface entries below |
| P0-INV-ADMIN | 0 | Administration/Reporting/Dashboard surface inventory | — | — | — | — | — | NOT_APPLICABLE | Folded into surface entries below |
| P0-INV-INVENTORY | 0 | Inventory/warehouse surface inventory | — | — | — | — | — | NOT_APPLICABLE | Folded into entries below |
| P0-INV-COMMERCIAL | 0 | Commercial (Sales Order/Purchasing/AR) surface inventory | — | — | — | — | — | NOT_APPLICABLE | Folded into entries below |
| P0-AUDIT-CONTRACTS | 0 | Shared-contract / mirror tooling investigation | — | — | — | — | — | NOT_APPLICABLE | Folded into entries below |
| P0-AUDIT-QUERY | 0 | Query pattern, pagination prior art and index coverage audit | — | — | — | — | — | NOT_APPLICABLE | Folded into entries below |
| X-MERGE-AUTHORITY | 0 | Harness merge permission for gh pr merge | — | — | — | — | — | NOT_APPLICABLE | Resolved: merges are executing |
| X-WRITE-ONLY-COLLECTIONS | 0 | Deny-all collections with no governed read path | — | — | — | — | — | NOT_APPLICABLE | None - recorded as a durable capability gap |

> **X-MERGE-AUTHORITY** blocked — gh pr merge denied by the harness permission classifier (observed on PR #1092). Architecture PRs are dependencies of every later phase, so a persistent denial serializes the program. · requires: Owner adds a scoped Bash permission rule for gh pr merge, or merges queued PRs

