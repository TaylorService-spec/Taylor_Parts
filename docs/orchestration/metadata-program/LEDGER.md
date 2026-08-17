# EOS Metadata-to-Platform Program — Execution Ledger

> **Generated file — do not hand-edit.** Rendered from `metadata-program/ledger.json` by
> `lib/metadataProgramLedger.mjs`. Edit the JSON, re-render, commit both.

**This is a cache. GitHub and `origin/main` are truth.** A resuming session reads governance,
reads this, reconciles every claim against observed state, corrects what disagrees, and then
continues from the next executable item — without asking what happened.

**Baseline:** origin/main d90db46e (governance boundary merged, PR #1092)

## Surface conformance

| Total routed surfaces | Accounted for | Unaccounted for |
|---|---|---|
| 43 | 31 | 12 |

## Next executable

- **X-RULES-DISCREPANCY** (phase 0) — mobile_locations read path disagrees with Rules → Confirm directly against firestore.rules before trusting either source
- **X-WRITE-ONLY-COLLECTIONS** (phase 0) — Deny-all collections with no governed read path → Record as a capability gap; not a metadata-program blocker
- **A-CONTRACT-TOOLING** (phase 1) — Shared contract source of truth → Implement generated mirror plus parity CI; close the two untested mirror pairs
- **A-CALLABLE-UNBOUNDED** (phase 3) — Unbounded trusted-callable reads → Apply the repo's own limit+1 truncation-honesty convention to the three unbounded callables
- **S-ADM-ROLES** (phase 9) — Roles & Permissions → Inventory only; form is unconditionally disabled
- **S-ADM-USERS** (phase 9) — Users (admin) → Inventory only; no governed directory read exists to migrate
- **S-DASH-MY** (phase 9) — My Dashboard → Later phase; dashboard composition is not list/record metadata
- **S-DASH-OPERATIONS** (phase 9) — Inventory & Supply Overview → Bounded-read remediation
- **S-DASH-OPERATIONS-SCALE** (phase 9) — Operations dashboard loads the operational database client-side → Sequence with A-BOUNDED-READS
- **S-INV-MANUFACTURERS** (phase 9) — Manufacturers → Inventory only - writes are closed in every environment including sandbox

## READY

| id | phase | title | route | issue | PR | head | merge | deploy | next action |
|---|---|---|---|---|---|---|---|---|---|
| S-SVC-DISPATCH-QUEUE | 9 | Dispatch queue | /service/dispatch | — | — | — | — | NOT_APPLICABLE | Classify: queue with governed transition writes, not a list |
| S-SVC-COORDINATED-VISITS | 9 | Coordinated visits | /service/coordinated-visits | — | — | — | — | NOT_APPLICABLE | Confirm synthetic-source status before migrating anything |
| S-SVC-COORDINATED-MISSION | 9 | Coordinated mission | /service/coordinated-mission | — | — | — | — | NOT_APPLICABLE | Same synthetic-source caveat as coordinated visits |
| S-SVC-CONTROL-TOWER | 9 | Service Operations (Control Tower) | /service-operations | — | — | — | — | NOT_APPLICABLE | Bounded-read remediation; dashboard composition is a later phase |
| S-SVC-WO-NEW | 9 | New Work Order wizard | /service/work-orders/new | — | — | — | — | NOT_APPLICABLE | Bounded-read remediation: it reads the whole accounts collection |
| S-ADM-USERS | 9 | Users (admin) | /administration/users | — | — | — | — | NOT_APPLICABLE | Inventory only; no governed directory read exists to migrate |
| S-ADM-ROLES | 9 | Roles & Permissions | /administration/roles-permissions | — | — | — | — | NOT_APPLICABLE | Inventory only; form is unconditionally disabled |
| S-DASH-MY | 9 | My Dashboard | /dashboard | — | — | — | — | NOT_APPLICABLE | Later phase; dashboard composition is not list/record metadata |
| S-DASH-OPERATIONS | 9 | Inventory & Supply Overview | /dashboard/operations | — | — | — | — | NOT_APPLICABLE | Bounded-read remediation |
| S-INV-TRUCK | 9 | Truck inventory | /inventory/truck-inventory | — | — | — | — | NOT_APPLICABLE | Resolve the deployment-status contradiction before touching this surface |
| S-INV-TRANSFERS | 9 | Transfers | /inventory/transfers | — | — | — | — | NOT_APPLICABLE | Bounded-read remediation; lifecycle composite, not a list |
| S-INV-MANUFACTURERS | 9 | Manufacturers | /inventory/manufacturers | — | — | — | — | NOT_APPLICABLE | Inventory only - writes are closed in every environment including sandbox |
| A-CONTRACT-TOOLING | 1 | Shared contract source of truth | — | — | — | — | — | NOT_APPLICABLE | Implement generated mirror plus parity CI; close the two untested mirror pairs |
| A-CALLABLE-UNBOUNDED | 3 | Unbounded trusted-callable reads | — | — | — | — | — | NOT_APPLICABLE | Apply the repo's own limit+1 truncation-honesty convention to the three unbounded callables |
| X-RULES-DISCREPANCY | 0 | mobile_locations read path disagrees with Rules | — | — | — | — | — | NOT_APPLICABLE | Confirm directly against firestore.rules before trusting either source |
| X-WRITE-ONLY-COLLECTIONS | 0 | Deny-all collections with no governed read path | — | — | — | — | — | NOT_APPLICABLE | Record as a capability gap; not a metadata-program blocker |
| S-DASH-OPERATIONS-SCALE | 9 | Operations dashboard loads the operational database client-side | — | — | — | — | — | NOT_APPLICABLE | Sequence with A-BOUNDED-READS |

## MERGE_QUEUED

| id | phase | title | route | issue | PR | head | merge | deploy | next action |
|---|---|---|---|---|---|---|---|---|---|
| P0-LEDGER | 0 | Program execution ledger + resumption model | — | — | #1101 | 3dce271a | — | NOT_APPLICABLE | Merge blocked by harness classifier - see X-MERGE-AUTHORITY; continue independent work |
| D-BUG-STATUS-CASING | 6 | Canonical ACCOUNT_STATUS machine values + display labels | — | #1093 | #1103 | f41045b8 | — | NOT_APPLICABLE | Merge blocked by harness classifier - see X-MERGE-AUTHORITY |
| D-BUG-AR-CONTRACT | 6 | Shared AR view-state contract | — | #1094 | #1102 | 7b87a025 | — | NOT_APPLICABLE | Merge blocked by harness classifier - see X-MERGE-AUTHORITY |

## BLOCKED_PROTECTED

| id | phase | title | route | issue | PR | head | merge | deploy | next action |
|---|---|---|---|---|---|---|---|---|---|
| X-ADMIN-CRM-AUTHORITY | 0 | crm.activity.read via canonical admin authority | — | — | #1100 | — | — | NOT_APPLICABLE | Await Owner authorization; program proceeds around it |
| X-MERGE-AUTHORITY | 0 | Harness merge permission for gh pr merge | — | — | — | — | — | NOT_APPLICABLE | Mark PRs MERGE-QUEUED and continue independent work |
| X-STATUS-DATA-AUDIT | 6 | Account status persisted-data audit before production rollout | — | — | — | — | — | NOT_APPLICABLE | Audit production Account documents for title-case status values |

> **X-ADMIN-CRM-AUTHORITY** blocked — Capability grant / role-matrix change. Sandbox activation is already done; no business role carries crm.activity.read. · requires: Owner authorizes the capability through the admin business role, and decides read-only vs read+create
> **X-MERGE-AUTHORITY** blocked — gh pr merge denied by the harness permission classifier (observed on PR #1092). Architecture PRs are dependencies of every later phase, so a persistent denial serializes the program. · requires: Owner adds a scoped Bash permission rule for gh pr merge, or merges queued PRs
> **X-STATUS-DATA-AUDIT** blocked — AccountForm defaulted new accounts to ACCOUNT_STATUS.PROSPECT, so any account created through the UI before PR #1103 persisted title-case. Sandbox holds two seeded accounts, both uppercase; production document state is unknown from here and was deliberately not claimed. · requires: Owner authorizes a production data read to determine whether a status migration is required

## BLOCKED_DEPENDENCY

| id | phase | title | route | issue | PR | head | merge | deploy | next action |
|---|---|---|---|---|---|---|---|---|---|
| S-CRM-CUSTOMERS | 4 | Customers (Accounts list) | /customers | #1097 | — | — | — | NOT_APPLICABLE | Migrate onto Entity List Metadata v1 once the runtime exists |
| S-CRM-ACCOUNT-RECORD | 6 | Customer/Account detail | /customers/:accountId | — | — | — | — | NOT_APPLICABLE | Migrate onto the page definition runtime |
| S-CRM-OPPORTUNITIES | 9 | Opportunities workspace | /customers/opportunities | #1099 | — | — | — | NOT_APPLICABLE | Needs Opportunity identity before a record page is meaningful |
| S-CRM-SALES-ORDER-RECORD | 9 | Sales Order detail | /customers/opportunities/sales-order/:salesOrderId | — | — | — | — | NOT_APPLICABLE | Migrate onto page runtime; resolve raw-id labels |
| S-SVC-WORK-ORDERS | 8 | Work Orders list | /service | #1098 | — | — | — | NOT_APPLICABLE | The Gate B non-CRM validation target |
| S-SVC-WO-RECORD | 9 | Work Order detail | /service/work-orders/:workOrderId | — | — | — | — | NOT_APPLICABLE | Migrate after Gate B |
| S-SVC-JOB-ASSIGNMENTS | 9 | Job Assignments (legacy jobs list) | /service/job-assignments | — | — | — | — | NOT_APPLICABLE | Migrate or retire — overlaps the Work Orders list |
| S-ADM-EMPLOYEES | 9 | Employees (Technicians list) | /administration | — | — | — | — | NOT_APPLICABLE | Migrate onto list runtime |
| S-ADM-SAVED-REPORTS | 9 | Saved Reports | /reporting/saved | — | — | — | — | NOT_APPLICABLE | Migrate onto list runtime |
| A-CONTRACT-CORE | 1 | Entity/Field/Relationship definition contracts | — | — | — | — | — | NOT_APPLICABLE | Derive from reportCatalog.js prior art; Gate A package |
| A-LIST-METADATA-V1 | 3 | Entity List Metadata v1 runtime | — | #1096 | — | — | — | NOT_APPLICABLE | Build after Gate A contracts land |
| A-PAGE-RUNTIME | 5 | Page definition runtime | — | — | — | — | — | NOT_APPLICABLE | After list runtime proves the contract shape |
| A-REGISTRIES | 2 | Component and action registries | — | — | — | — | — | NOT_APPLICABLE | Action definitions reference governed command paths only |
| G-GATE-A | 3 | Gate A — metadata foundation review package | — | — | — | — | — | NOT_APPLICABLE | Assemble package, mark REVIEW_QUEUED, do NOT wait |
| G-GATE-B | 8 | Gate B — cross-domain validation (Work Orders) | — | #1098 | — | — | — | NOT_APPLICABLE | Do not begin site-wide migration if this exposes a bad abstraction |
| D-BUG-AR-OWNERSHIP | 6 | One authoritative Account AR read owner | — | #1095 | — | — | — | NOT_APPLICABLE | After the contract fix lands |
| S-INV-PARTS | 9 | Parts catalog | /inventory | — | — | — | — | NOT_APPLICABLE | Migrate onto list runtime |
| S-INV-PART-DETAIL | 9 | Part detail | /inventory/:partId | — | — | — | — | NOT_APPLICABLE | Migrate onto page runtime |
| S-INV-PART-MASTER | 9 | Part Master bulk status table | /inventory/part-master | — | — | — | — | NOT_APPLICABLE | Migrate; navHidden, direct-URL only |
| S-INV-WAREHOUSES | 9 | Warehouses | /inventory/warehouses | — | — | — | — | NOT_APPLICABLE | Migrate onto list runtime |
| S-INV-SUPPLIERS | 9 | Suppliers | /purchasing/suppliers | — | — | — | — | NOT_APPLICABLE | Migrate onto list runtime |
| S-INV-EQUIPMENT | 9 | Equipment workspace | /equipment | — | — | — | — | NOT_APPLICABLE | Migrate; already cursor-paginated |
| S-INV-EQUIPMENT-DETAIL | 9 | Equipment detail | /equipment/:equipmentId | — | — | — | — | NOT_APPLICABLE | Migrate onto page runtime |
| S-COM-PURCHASE-ORDERS | 9 | Purchase orders | /purchasing | — | — | — | — | NOT_APPLICABLE | Migrate onto list runtime |
| S-COM-RECEIPTS | 9 | Receipts | /purchasing/receipts | — | — | — | — | NOT_APPLICABLE | Migrate onto list runtime |
| A-BOUNDED-READS | 3 | Bounded-read remediation across list-exempt surfaces | — | — | — | — | — | NOT_APPLICABLE | Generalize the existing cursor prior art rather than inventing a pattern |
| A-INDEX-VALIDATOR | 3 | ListViewDefinition to composite-index validator | — | — | — | — | — | NOT_APPLICABLE | Import indexDriftGuard exports; do not reimplement key normalization |

> **S-CRM-CUSTOMERS** blocked — First consumer of the list runtime; cannot migrate before the runtime exists

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

