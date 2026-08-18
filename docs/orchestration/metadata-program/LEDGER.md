# EOS Metadata-to-Platform Program — Execution Ledger

> **Generated file — do not hand-edit.** Rendered from `metadata-program/ledger.json` by
> `lib/metadataProgramLedger.mjs`. Edit the JSON, re-render, commit both.

**This is a cache. GitHub and `origin/main` are truth.** A resuming session reads governance,
reads this, reconciles every claim against observed state, corrects what disagrees, and then
continues from the next executable item — without asking what happened.

**Baseline:** origin/main b7ec0c29 -- 180 entries, every claim reconciled against git. MERGED 99, COMPLETE 21, EXEMPT 16, BLOCKED_DEPENDENCY 29, BLOCKED_PROTECTED 13, READY 1, IMPLEMENTING 1.

## Surface conformance

| Total routed surfaces | Accounted for | Unaccounted for |
|---|---|---|
| 54 | 38 | 16 |

## Stale blocks — resolve before trusting "nothing executable"

18 item(s) are BLOCKED_DEPENDENCY with every dependency already satisfied.
Each needs a deliberate call: promote it to READY, or re-point it at what it actually needs.

- **S-CRM-OPPORTUNITIES** — depends on X-INDEX-SURFACE-CALLABLE-READ (all satisfied) → Blocked on an INDEX-surface callable read path; two further gaps recorded.
- **S-SVC-JOB-ASSIGNMENTS** — depends on X-SURFACE-CLASSIFICATION-COMPOSITES (all satisfied) → Classify as duplicate/redirect/composition alias per routing architecture.
- **S-SVC-DISPATCH-QUEUE** — depends on A-LIST-GRID (all satisfied) → Not a list by construction.
- **S-SVC-COORDINATED-VISITS** — depends on A-LIST-GRID (all satisfied) → Not a list by construction -- a derived grouping has no native rows to read.
- **S-SVC-COORDINATED-MISSION** — depends on A-LIST-GRID (all satisfied) → Not a list by construction -- a derived grouping has no native rows to read.
- **S-SVC-CONTROL-TOWER** — depends on A-PAGE-COMPONENT (all satisfied) → Not a list; bounded-read remediation on the two reads is separately named.
- **S-SVC-WO-NEW** — depends on A-LIST-GRID (all satisfied) → None. Stale next-action text corrected.
- **S-ADM-EMPLOYEES** — depends on X-SURFACE-CLASSIFICATION-COMPOSITES (all satisfied) → Resolve the semantic mismatch: the definition must follow the data model the surface actually reads.
- **S-ADM-SAVED-REPORTS** — depends on A-LIST-GRID (all satisfied) → Not a list by construction; would need a CRUD/action-surface pattern distinct from the list runtime.
- **G-GATE-B** — depends on S-CRM-CUSTOMERS, S-SVC-WORK-ORDERS (all satisfied) → Do not begin site-wide migration if this exposes a bad abstraction
- **S-INV-PART-MASTER** — depends on A-LIST-GRID (all satisfied) → Not a list while the writes live here; the unbounded read is a separate real defect.
- **S-INV-TRANSFERS** — depends on X-TRANSFER-ORDER-NO-REFERENCE (all satisfied) → Blocked on the Transfer Order identity decision; separately a lifecycle composite, not a list.
- **S-COM-PURCHASE-ORDERS** — depends on X-SURFACE-CLASSIFICATION-COMPOSITES (all satisfied) → Record as a COMPOSITE/PROJECTION requirement, not a list.
- **S-COM-RECEIPTS** — depends on X-SURFACE-CLASSIFICATION-COMPOSITES (all satisfied) → Same construction as Purchase Orders; not a single-collection list.
- **A-AUTOMATION-V1** — depends on A-QUERY-MODEL-UNIFIED (all satisfied) → Design after the unified query model - automation CONDITIONS are queries

## Next executable

- **X-SALES-ORDER-NO-UNSCOPED-READ** (phase 6) — No unscoped Sales Order list read exists -- its INDEX surface stays unreachable → A server-side unscoped Sales Order list read must exist before its INDEX surface can migrate.
- **A-ENTITY-MASS-DEFINITION** (phase 7) — Mass-definition of remaining business entities → Employee leaf re-dispatched at e5172508 after the prior lane was lost unpushed; Account search lane running.

## IMPLEMENTING

| id | phase | title | route | issue | PR | head | merge | deploy | next action |
|---|---|---|---|---|---|---|---|---|---|
| A-ENTITY-MASS-DEFINITION | 7 | Mass-definition of remaining business entities | — | — | — | — | — | NOT_APPLICABLE | Employee leaf re-dispatched at e5172508 after the prior lane was lost unpushed; Account search lane running. |

## READY

| id | phase | title | route | issue | PR | head | merge | deploy | next action |
|---|---|---|---|---|---|---|---|---|---|
| X-SALES-ORDER-NO-UNSCOPED-READ | 6 | No unscoped Sales Order list read exists -- its INDEX surface stays unreachable | — | — | — | — | — | NOT_APPLICABLE | A server-side unscoped Sales Order list read must exist before its INDEX surface can migrate. |

## MERGED

| id | phase | title | route | issue | PR | head | merge | deploy | next action |
|---|---|---|---|---|---|---|---|---|---|
| P0-LEDGER | 0 | Program execution ledger + resumption model | — | — | #1113 | 3dce271a | 1f1f1a4d | NOT_APPLICABLE | Merged to origin/main; verified by mergeSha |
| S-CRM-CUSTOMERS | 4 | Customers (Accounts list) | /customers | #1097 | #1138 | — | abfd3ee7 | NOT_APPLICABLE | Merged. The accounts composite index is declared and pending deploy. |
| S-CRM-ACCOUNT-RECORD | 6 | Customer/Account detail | /customers/:accountId | — | #1181 | — | 57694e5d | NOT_APPLICABLE | Definition merged. Wiring AccountDetail onto it, and the two recorded page gaps, are separate lanes. |
| X-INDEX-SURFACE-CALLABLE-READ | 6 | No INDEX surface can read a CALLABLE entity -- useMetadataList has no readVia branch | — | — | #1229 | — | f7a61306 | NOT_APPLICABLE | Blocked no further at the runtime; the remaining gap is definition-level. |
| X-ENTITY-SINGLE-READCALLABLE | 6 | An entity declares one readCallable, but INDEX and RELATED need different ones | — | — | #1231 | — | 0f774fcd | NOT_APPLICABLE | Opportunity INDEX is now reachable. Sales Order INDEX needs a server-side unscoped read. |
| X-OPPORTUNITY-CUSTOMER-COLUMN-SHOWED-ID | 6 | The Opportunities pipeline fell back to a raw account id -- LIVE, not latent | — | — | #1226 | — | 631170b5 | NOT_APPLICABLE | None. |
| S-SVC-WORK-ORDERS | 8 | Work Orders list | /service | #1098 | #1141 | — | 47f46feb | NOT_APPLICABLE | Definitions merged. Surface rewiring is the next slice; no aggregate blocker was found. |
| A-CONTRACT-CORE | 1 | Entity/Field/Relationship definition contracts | — | — | #1106 | 28338738 | 3a07e4d8 | NOT_APPLICABLE | Merged to origin/main; verified by mergeSha |
| A-LIST-METADATA-V1 | 3 | Entity List Metadata v1 runtime | — | #1096 | #1115 | bd787211 | 2c673e16 | NOT_APPLICABLE | Merged to origin/main; verified by mergeSha |
| A-PAGE-RUNTIME | 5 | Page definition contract (PageDefinition/PageRegion) | — | — | #1118 | 656023c8 | 9d10440e | NOT_APPLICABLE | Merged to origin/main; verified by mergeSha |
| A-REGISTRIES | 2 | Component and action registries | — | — | #1116 | ead08eeb | fb4257a0 | NOT_APPLICABLE | Merged to origin/main; verified by mergeSha |
| G-GATE-A | 3 | Gate A — metadata foundation review package | — | — | #1119 | bad4c0b0 | 64736d50 | NOT_APPLICABLE | Merged to origin/main; verified by mergeSha |
| D-BUG-STATUS-CASING | 6 | Canonical ACCOUNT_STATUS machine values + display labels | — | #1093 | #1103 | f41045b8 | bb72103e | NOT_APPLICABLE | Merged to origin/main; verified by mergeSha |
| D-BUG-AR-CONTRACT | 6 | Shared AR view-state contract | — | #1094 | #1102 | 7b87a025 | b65066ff | NOT_APPLICABLE | Merged to origin/main; verified by mergeSha |
| D-BUG-AR-OWNERSHIP | 6 | One authoritative Account AR read owner | — | #1095 | #1114 | 7824cf4f | 390d5149 | NOT_APPLICABLE | Merged to origin/main; verified by mergeSha |
| X-PARTID-IDENTITY-CONFLICT | 6 | part.js and the production join evidence disagree on which field is the Part's reference | — | — | #1257 | — | eb04007c | NOT_APPLICABLE | None. part.js needs no change. |
| S-INV-WAREHOUSES | 9 | Warehouses | /inventory/warehouses | — | #1233 | — | 4cf132ad | NOT_APPLICABLE | None. |
| X-WAREHOUSES-VIEW-ID-AS-NAME | 6 | warehousesView fell back to the document id as the display name | — | — | #1233 | — | 4cf132ad | NOT_APPLICABLE | None. |
| X-LIST-COLUMN-RENDERER-UNCONSUMED | 6 | column.renderer is resolved by listPresentation and consumed by nothing | — | — | #1236 | — | 82eb0217 | NOT_APPLICABLE | None. |
| X-DEAD-WAREHOUSE-READ-PATH | 6 | useWarehouses and warehousesView are now dead code | — | — | #1235 | — | 8d618dcf | NOT_APPLICABLE | None. Only the hook was dead. |
| S-INV-SUPPLIERS | 9 | Suppliers | /purchasing/suppliers | — | #1236 | — | 82eb0217 | NOT_APPLICABLE | None. |
| X-SUPPLIERS-VIEW-ID-AS-NAME | 6 | suppliersView fell back to the document id as the display name -- LIVE | — | — | #1236 | — | 82eb0217 | NOT_APPLICABLE | None. |
| S-INV-TRUCK | 9 | Truck inventory | /inventory/truck-inventory | — | #1109 | b7d8d2e8 | 39524862 | NOT_APPLICABLE | Merged to origin/main; verified by mergeSha |
| X-TRANSFER-ORDERS-UNBOUNDED-READ | 6 | fetchTransferOrderDocs is a fully unbounded collection read | — | — | #1248 | — | 9c30e311 | NOT_APPLICABLE | None. |
| S-INV-MANUFACTURERS | 9 | Manufacturers | /inventory/manufacturers | — | #1233 | — | 4cf132ad | NOT_APPLICABLE | None. |
| S-INV-EQUIPMENT | 9 | Equipment workspace | /equipment | — | #1246 | — | 0f019b4f | NOT_APPLICABLE | None for the tab. The other two tabs remain a stub and a create form. |
| X-EQUIPMENT-VIEW-ID-AS-NAME | 6 | resolveName fell back to the document id -- the FOURTH instance of the same escape clause | — | — | #1246 | — | 0f019b4f | NOT_APPLICABLE | None. |
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
| X-ACCOUNT-SEARCH | 6 | Governed Account search | /customers | — | #1177 | — | 12885cfe | NOT_APPLICABLE | Merged. Case-insensitive and substring search remain named gaps, not silent ones. |
| G-FIELD-ARCH-V2 | 6 | Field Architecture v2 | — | — | #1147 | — | 379ef835 | NOT_APPLICABLE | Gate cleared. Mass entity definition may resume. |
| A-RECORD-PROVENANCE | 6 | Record provenance platform invariant | — | — | #1149 | — | 64564bb3 | NOT_APPLICABLE | Merged. The origin seam (createdVia/initiatedBy/sourceExecutionId) awaits reconciliation with the audit event architecture before anything writes it. |
| A-QUERY-MODEL-UNIFIED | 7 | Unified EOS query model (shared dependency) | — | — | #1151 | — | 80588e61 | NOT_APPLICABLE | Merged. Automation v1, EQL v1 and Bulk Data v1 are unblocked; migrating the list runtime onto the AST is a separate slice. |
| X-CONTACT-PROVENANCE-GAP | 6 | Contact write paths do not agree on provenance | — | — | #1157 | — | c97694a7 | NOT_APPLICABLE | Future writes converged. Historical backfill remains a separate decision requiring evidence. |
| X-SALES-ORDER-NO-REFERENCE | 6 | Sales Order has no business reference; its header renders a document id | — | — | — | — | 7b200b34 | NOT_APPLICABLE | Creation, header and definition all merged. Backfill remains protected under X-SALES-ORDER-NUMBER-BACKFILL. |
| X-SALES-ORDER-HEADER | 6 | SalesOrderDetail header renders a document id | /customers/opportunities/sales-order/:salesOrderId | — | #1162 | — | 7b200b34 | NOT_APPLICABLE | Merged. SalesOrderActions.jsx still interpolates a document id into dialog copy - see X-SALES-ORDER-ACTION-COPY. |
| S-CRM-SALES-ORDER-DEFINITION | 6 | Sales Order entity + list definitions | — | — | #1161 | — | 5568028d | NOT_APPLICABLE | Merged. Two projection gaps documented rather than silently fixed. |
| X-SALES-ORDER-ACTION-COPY | 6 | SalesOrderActions renders a document id in confirmation copy | /customers/opportunities/sales-order/:salesOrderId | — | #1170 | — | dd325ac9 | NOT_APPLICABLE | Merged. The id-as-label class now has five corrected instances and no known open ones. |
| A-SHARED-RESOURCE-SERIALIZATION | 6 | Shared-resource ownership in the writer-lane model | — | — | #1165 | — | 94040c1e | NOT_APPLICABLE | Merged: canDispatch fails closed on contention; registrationGaps checks both directions. |
| S-INV-PART-DEFINITION | 6 | Part entity + list definitions (leaf lane) | — | — | #1168 | — | 621dfc3a | NOT_APPLICABLE | Leaf merged and registered via the integration lane. |
| S-INV-EQUIPMENT-DEFINITION | 6 | Equipment entity + list definitions (leaf lane) | — | — | #1168 | — | 621dfc3a | NOT_APPLICABLE | Leaf merged and registered via the integration lane. |
| A-METADATA-INTEGRATION-LANE | 6 | Integration lane for Part + Equipment shared registration | — | — | #1168 | — | 621dfc3a | NOT_APPLICABLE | Batch integrated. Reusable pattern for the next leaf batch. |
| S-ADM-EMPLOYEES-DEFINITION | 6 | Employee entity + list definition | — | — | #1176 | — | 42db3840 | NOT_APPLICABLE | Merged and registered. Three composites declared and pending deploy. |
| S-COM-PURCHASE-ORDER-DEFINITION | 6 | Purchase Order entity + list definitions (leaf lane) | — | — | #1181 | — | 57694e5d | NOT_APPLICABLE | Merged and registered via the integration lane. |
| S-CRM-LOCATION-DEFINITION | 6 | Location entity + list definition (leaf lane) | — | — | #1181 | — | 57694e5d | NOT_APPLICABLE | Merged and registered via the integration lane. |
| X-ACCOUNT-PAGE-GAPS | 6 | Account page: Locations section and Commercial Profile fields | /customers/:accountId | — | #1187 | — | f18b0e83 | NOT_APPLICABLE | Both gaps closed. Wiring is the remaining lane. |
| X-LOCATION-REFERENCE-UPGRADE | 6 | Upgrade locationId from STRING to REFERENCE on equipment and salesOrder | — | — | #1183 | — | d6e29a5d | NOT_APPLICABLE | Merged. Index demands verified unchanged and pinned by test. |
| X-ACCOUNT-PAGE-WIRING | 6 | Wire AccountDetail onto the Account record PageDefinition | /customers/:accountId | — | #1191 | — | ac1a979f | NOT_APPLICABLE | Partial wiring merged. Related lists and field groups need renderer support first. |
| S-INV-WAREHOUSE-SUPPLIER-DEFINITIONS | 6 | Warehouse + Supplier entity definitions | — | — | #1189 | — | 63b5059e | NOT_APPLICABLE | Merged and registered. Two composites declared and pending deploy. |
| A-RECORD-PAGE-RENDERER-GAPS | 6 | MetadataRecordPage: related-list wiring, FIELD_GROUP renderer, single-section DENIED | — | — | #1194 | — | 27b109bb | NOT_APPLICABLE | All three gaps closed. Account completion wiring dispatched. |
| S-INV-TRANSFER-MANUFACTURER-DEFINITIONS | 6 | Transfer Order + Manufacturer definitions (leaf lane) | — | — | #1196 | — | ed448c75 | NOT_APPLICABLE | Manufacturer merged. Transfer Order held on X-TRANSFER-ORDER-NO-REFERENCE. |
| X-ACCOUNT-PAGE-WIRING-COMPLETE | 6 | Complete the Account page wiring now the renderer supports it | /customers/:accountId | — | #1198 | — | f42491de | NOT_APPLICABLE | No section newly wired. Three prerequisites identified and recorded. |
| X-TRANSFER-ORDER-NO-REFERENCE | 6 | Transfer Order has no identity of either kind | — | — | #1258 | — | 00df6438 | NOT_APPLICABLE | None. |
| A-CALLABLE-LIST-SOURCE | 6 | RELATED_LIST cannot read a CALLABLE-readVia entity | — | — | #1200 | — | 6c6480d8 | NOT_APPLICABLE | Merged. Opportunities and Sales Orders are now wirable; that lane is dispatched. |
| X-SECTION-CAPABILITY-GRANULARITY | 6 | A section capability cannot express a partially-gated composition | — | — | #1209 | — | 18aae32c | NOT_APPLICABLE | None. Adoption is gated on the FieldGroup consumer. |
| X-CAPABILITY-PARTS-FIELDGROUP-UNCONSUMED | 6 | FieldGroup does not honor withheld parts -- capabilityParts must not be adopted on a FIELD_GROUP yet | — | — | #1213 | — | f013d965 | NOT_APPLICABLE | None. |
| X-RELATED-LIST-ACTIONS | 6 | MetadataListGrid has no row actions or focus handoff | — | — | #1211 | — | bd2e733e | NOT_APPLICABLE | Wiring Contacts/Locations onto it is a separate lane. |
| A-ACCOUNT-WIRE-CONTACTS-LOCATIONS | 6 | Contacts and Locations wired through metadata | /customers/:accountId | — | #1217 | — | 70b74afc | NOT_APPLICABLE | None. |
| X-LIST-BOOLEAN-FORMATTING | 6 | cellValue() had no BOOLEAN branch -- boolean columns rendered blank either way | — | — | #1217 | — | 70b74afc | NOT_APPLICABLE | None. |
| X-LIST-REFERENCE-RENDERS-ID | 6 | REFERENCE columns render the raw document id -- ten of them across the repo | — | — | #1221 | — | 175aff37 | NOT_APPLICABLE | Supply a real resolveReference when an INDEX surface is wired. |
| X-LIST-CURRENCY-AND-MISTYPED-DATE | 6 | CURRENCY_MINOR renders minor units, and invoice.dueDate is typed NUMBER | — | — | #1219 | — | a0b2f570 | NOT_APPLICABLE | None. |
| X-MONEY-FORMATTER-DISAGREEMENT | 6 | Two money formatters disagree on non-2-exponent currencies | — | — | #1225 | — | 4ded53f9 | NOT_APPLICABLE | None. |
| X-MANUFACTURER-ID-AS-COLUMN | 6 | manufacturerIndexList declares the document id as a visible column | — | — | #1219 | — | a0b2f570 | NOT_APPLICABLE | None. |
| X-REGISTRY-VALIDATOR-NEVER-RUN | 6 | validateRegistryReferences is never run over real definitions | — | — | #1215 | — | 8e68218e | NOT_APPLICABLE | None. |
| X-PAGE-REGISTRY-REFERENCES-UNCONSUMED | 6 | pageRegistryReferences was also unconsumed -- and the wrong validator passes silently | — | — | #1215 | — | 8e68218e | NOT_APPLICABLE | None. |
| X-OPPORTUNITY-STALE-ROUTE | 6 | opportunity.js declared a rowNavigationTo route that never existed | — | — | #1207 | — | 1d50d875 | NOT_APPLICABLE | Restore a rowNavigationTo only when a real per-Opportunity route exists. |
| A-ENTITY-BILLING-DEFINITIONS | 6 | Invoice and Payment entity definitions | — | — | #1206 | — | 653973cb | NOT_APPLICABLE | None. |
| A-ENTITY-STOCK-LOCATION-DEFINITION | 6 | Stock Location entity definition | — | — | #1223 | — | 773b72e7 | NOT_APPLICABLE | None. |
| A-ENTITY-TERRITORY-MOBILE-DEFINITIONS | 6 | SalesTerritory and MobileLocation entity definitions | — | — | #1251 | — | 56fc09d9 | NOT_APPLICABLE | truck.js locationId can now become a REFERENCE to mobileLocation. |
| A-DEFERRED-REFERENCE-UPGRADES | 6 | Two deferred REFERENCE fields closed once their targets existed | — | — | #1253 | — | 07435b9a | NOT_APPLICABLE | None. |
| X-INVENTORY-TRANSACTION-NO-IDENTITY | 6 | Inventory Transaction has neither a name nor a reference -- definition held, not merged | — | — | #1258 | — | 00df6438 | NOT_APPLICABLE | None. |
| X-PROCUREMENT-ENTITIES-NO-IDENTITY | 6 | ReceivingOrder and ReorderRequest have no labelable identity -- definitions held, not merged | — | — | #1258 | — | 00df6438 | NOT_APPLICABLE | None. |
| A-ENTITY-FLEET-CATALOG-DEFINITIONS | 6 | Truck and EquipmentModel entity definitions | — | — | #1206 | — | 653973cb | NOT_APPLICABLE | None. |
| A-ACCOUNT-WIRE-CALLABLE-LISTS-2 | 6 | Opportunities and Sales Orders wired through metadata | /customers/:accountId | — | #1207 | — | 1d50d875 | NOT_APPLICABLE | None. |
| X-LIST-TIMESTAMP-FORMATTING | 6 | cellValue() has no TIMESTAMP branch -- a date column renders as an epoch number | — | — | #1204 | — | 6998306f | NOT_APPLICABLE | None. |
| X-LIST-ROW-NAVIGATION | 6 | rowNavigationTo is declared by every list definition and consumed by nothing | — | — | #1204 | — | 6998306f | NOT_APPLICABLE | None. |
| A-LIST-TIMESTAMP-AND-NAVIGATION | 6 | Format TIMESTAMP cells and give related-list rows their declared navigation | — | — | #1204 | — | 6998306f | NOT_APPLICABLE | None. |
| A-IDENTITY-MODES | 6 | Three identity modes: HUMAN_NAME, BUSINESS_REFERENCE, SYSTEM_ONLY | — | — | #1256 | — | 316bdb43 | NOT_APPLICABLE | None. |
| A-TEXT-QUERY-SEMANTICS | 6 | Distinct text operators, and a declared operator that is not executable must fail loudly | — | — | #1257 | — | eb04007c | NOT_APPLICABLE | A backend must exist before TEXT_CONTAINS/TEXT_SEARCH can execute. |
| A-OPERATIONAL-NUMBERING | 6 | Server-authoritative TO/RO/RR numbering with inert backfill tooling | — | — | #1259 | — | 4e4dbd3c | NOT_APPLICABLE | None. Reorder Request wiring is tracked separately. |
| A-HELD-DEFINITIONS-IDENTITY | 6 | Four held definitions land with declared identity modes | — | — | #1258 | — | 00df6438 | NOT_APPLICABLE | None. |
| A-OPERATIONAL-NUMBERING-IMPL | 6 | TO/RO/RR allocators, contention-tested, with fail-closed backfill tooling | — | — | #1259 | — | 4e4dbd3c | NOT_APPLICABLE | Production backfill remains a separate protected authorization. |
| X-REGISTRY-COVERAGE-DRIFT | 6 | The registry tripwire silently narrowed from 24 definitions to 20 | — | — | #1261 | — | b7ec0c29 | NOT_APPLICABLE | None. |

## BLOCKED_PROTECTED

| id | phase | title | route | issue | PR | head | merge | deploy | next action |
|---|---|---|---|---|---|---|---|---|---|
| X-ADMIN-CRM-AUTHORITY | 0 | crm.activity.read via canonical admin authority | — | — | #1100 | — | — | NOT_APPLICABLE | Await Owner authorization; program proceeds around it |
| X-PART-MASTER-UNBOUNDED-READ | 6 | fetchPartMasterList is unbounded and doubles as a name-resolution directory | — | — | — | — | — | NOT_APPLICABLE | Owner decision; consolidated package already prepared. |
| X-DISPATCH-QUEUE-UNBOUNDED-LISTENERS | 6 | Both Dispatch Queue reads are unbounded live listeners shared across many surfaces | — | — | — | — | — | NOT_APPLICABLE | Owner decision; consolidated package already prepared. |
| X-STATUS-DATA-AUDIT | 6 | Account status persisted-data audit before production rollout | — | — | — | — | — | NOT_APPLICABLE | Audit production Account documents for title-case status values |
| X-TRUCK-PROD-LIVE-RISK | 0 | URGENT: production may already expose truck write controls | — | — | — | — | — | UNKNOWN | Authorized operator verifies the live production bundle and the deployed callable set |
| X-INVENTORY-ANALYTICS-AGGREGATE | 3 | Authoritative aggregation for netted inventory figures (server and client) | — | — | — | — | — | NOT_APPLICABLE | Owner decision on a governed per-part availability projection |
| X-NO-GOVERNED-READ-COLLECTIONS | 9 | BLOCKED-NO-GOVERNED-READ: six collections have no read authority at all | — | — | — | — | — | NOT_APPLICABLE | No metadata work possible; each needs a governed read service under normal capability governance |
| X-ACCOUNT-TAG-CATALOG | 6 | Governed Account tag facet / catalog projection | /customers | — | — | — | — | NOT_APPLICABLE | Needs an authoritative tag source before a facet can be honest |
| X-WORK-ORDER-BOARD-SCOPE | 6 | Work Order boards: bounded queue or complete queue? | /dispatch | — | — | — | — | NOT_APPLICABLE | Needs a decision on what a dispatch board is allowed to show before it can be bounded |
| X-SALES-ORDER-NUMBER-BACKFILL | 6 | Backfill salesOrderNumber onto legacy Sales Orders | — | — | — | — | — | NOT_APPLICABLE | Tooling merged and inert. Production execution awaits the established protected authorization. |
| X-EQUIPMENT-PROVENANCE-GAP | 6 | Equipment stores epoch-number timestamps and no actor | — | — | — | — | — | NOT_APPLICABLE | Blocked on a Rules change: equipmentWritableKeys/equipmentEditableKeys must admit createdBy/updatedBy before any client can write them. |
| X-REORDER-REQUEST-NO-SERVER-CREATE | 6 | reorder_requests has no server-side create path, so RR numbers cannot be allocated | — | — | — | — | — | NOT_APPLICABLE | Owner decision: add a governed create callable, or change Rules to require one. |
| X-TEXT-SEARCH-BACKEND | 6 | No backend can execute TEXT_CONTAINS or TEXT_SEARCH | — | — | — | — | — | NOT_APPLICABLE | Owner decision; consolidated package already prepared. |

> **X-ADMIN-CRM-AUTHORITY** blocked — Capability grant / role-matrix change. Sandbox activation is already done; no business role carries crm.activity.read. · requires: Owner authorizes the capability through the admin business role, and decides read-only vs read+create
> **X-PART-MASTER-UNBOUNDED-READ** blocked — fetchPartMasterList is unbounded with no truncation disclosure AND doubles as a canonical name-resolution directory for ~10 surfaces. A cap breaks name resolution app-wide; no cap leaves an unbounded read. The consolidated decision package recommends splitting the directory role from the list role, and explicitly warns the LIST half must not be bounded until substring search is resolved, because three of those surfaces depend on full-catalog client-side substring matching today. · requires: Whether to split fetchPartMasterList into an id-scoped directory primitive and a bounded disclosed list read, and the ordering against X-TEXT-SEARCH-BACKEND. See docs/orchestration/metadata-program/shared-read-scoping-decisions.md.
> **X-DISPATCH-QUEUE-UNBOUNDED-LISTENERS** blocked — subscribeToWorkOrders and the generic useFirestoreCollection are unbounded live listeners shared by six surfaces, and the decision package establishes those six need DIFFERENT answers -- board-scope, an aggregate/board split, a paginated disclosed list, a date-window query, a generous-cap roster, and a direct getDoc for a lookup that never needed a collection read. One cap would be wrong for most of them. · requires: Per-consumer scope for the six Dispatch consumers, including whether Control Tower's aggregate counts are split from its board display. Bounding a shared aggregate factory would falsify totals, which the bounded-read rule forbids.
> **X-STATUS-DATA-AUDIT** blocked — AccountForm defaulted new accounts to ACCOUNT_STATUS.PROSPECT, so any account created through the UI before PR #1103 persisted title-case. Sandbox holds two seeded accounts, both uppercase; production document state is unknown from here and was deliberately not claimed. · requires: Owner authorizes a production data read to determine whether a status migration is required
> **X-TRUCK-PROD-LIVE-RISK** blocked — Truck write readiness is a COMPILE-TIME constant baked into a Hosting bundle. PR #1109 fails the repository declaration closed, but if a previously released production bundle carries the old true, production users may see enabled truck-management write controls right now. Only a Hosting release built from the corrected config changes what is live. Separately, whether the eight callables are actually deployed to taylor-parts is unverified in either direction. · requires: Owner authorizes a live production check of (a) the served bundle's readiness value and (b) the deployed Functions set, then decides whether a Hosting release is required
> **X-INVENTORY-ANALYTICS-AGGREGATE** blocked — INVESTIGATED against ruling section 4's preference order; no unblocked option exists for the CROSS-PART case. (A) No materialized summary exists - repo-wide search found no per-part availability document or collection. (B) A server-side aggregate cannot express it: Firestore's getAggregateFromServer has no GROUP BY, so it can sum one part's ledger but cannot produce availability for all parts in one query. (C) An explicitly scoped complete query DOES exist and is already used - inventoryService.getAvailableQuantity() scans inventory_transactions where partId == X, which is provably complete FOR THAT PART. It does not generalize: N parts means N queries. (D) A new governed projection is therefore the only path for the dashboard, and that means schema plus trigger maintenance plus deployment. · requires: Owner authorizes a governed per-part availability projection (schema + maintenance + deploy), or accepts an explicitly scoped analytic surface instead of a whole-catalog dashboard
> **X-NO-GOVERNED-READ-COLLECTIONS** blocked — payments, payment_applications, invoice_adjustments, refunds, part_supplier_items and part_aliases are all allow read, write: if false in firestore.rules, and exhaustive search of functions/src found NO exported callable that reads any of them - only writers. part_supplier_items has a pure projection contract explicitly not activated. Metadata is presentation and composition, not authority, so it cannot make an unreadable collection readable. · requires: Owner authorizes building and activating a governed read service per collection, when the business capability requires it
> **X-ACCOUNT-TAG-CATALOG** blocked — No authoritative Account tag catalog exists; the old facet was built by scanning every account in the browser · requires: Whether tags become governed reference data with a catalog, or remain free-form labels with no global facet. A facet rebuilt from the current page would present 'the tags on these fifty rows' as 'the tags that exist'.
> **X-WORK-ORDER-BOARD-SCOPE** blocked — Dispatch, Control Tower and Dispatcher Board share one unfiltered work-order listener and bucket it client-side; bounding the input makes the columns a partial queue presented as the whole one · requires: Either (a) the board scope is genuinely bounded - a date window, an assigned-technician set, or open-states-only - which makes a bounded read HONEST rather than partial, or (b) the board needs a governed aggregate for its column counts the way Customers did, or (c) a new /work-orders list route is created for the browsing case and the boards keep their own scope. (a) is likely correct for a dispatch board, which nobody reads beyond the current week - but what that window IS is a business decision.
> **X-SALES-ORDER-NUMBER-BACKFILL** blocked — Assigning business references to existing production Sales Orders mutates production data · requires: Owner authorization to execute the migration against production, after a dry run reports the affected record count and any collisions.
> **X-EQUIPMENT-PROVENANCE-GAP** blocked — firestore.rules gates equipment writes with STRICT hasOnly() allowlists - equipmentWritableKeys (create) and equipmentEditableKeys (update) - and neither admits createdBy or updatedBy. Adding the fields client-side without a Rules change would make EVERY equipment create and update fail permission-denied, not silently drop the fields. · requires: Authorize a Tier-2 firestore.rules change adding createdBy to equipmentWritableKeys and updatedBy to equipmentEditableKeys, plus the Rules deploy that makes it effective. Rules deployment is a protected action; the repo change and the deploy are separate gates.
> **X-REORDER-REQUEST-NO-SERVER-CREATE** blocked — The client writes reorder_requests documents DIRECTLY, gated only by firestore.rules -- there is no Cloud Function create path. A business reference must be server-authoritative, so RR-YYYY-###### cannot be allocated at creation today. The allocator is built and tested to the same standard as the other two and is deliberately UNWIRED rather than half-wired to look finished. · requires: Whether to introduce a governed server-side create path for reorder requests, or to change firestore.rules to require one. A Rules change is always a protected Tier-2 action, and the lane correctly did not touch firestore.rules.
> **X-TEXT-SEARCH-BACKEND** blocked — The query contract can now EXPRESS substring search and correctly refuses to execute it. No backend can serve TEXT_CONTAINS or TEXT_SEARCH truthfully. Firestore prefix/range behaviour is not equivalent to substring CONTAINS, so this cannot be closed by engineering within the current stack. · requires: How substring search is served: an external/governed search index, an accepted narrowing of the product's search semantics, or leaving affected surfaces unmigrated. The ruling explicitly forbids selecting a paid vendor merely to clear this gate, and forbids faking it by filtering one bounded client page.

## BLOCKED_DEPENDENCY

| id | phase | title | route | issue | PR | head | merge | deploy | next action |
|---|---|---|---|---|---|---|---|---|---|
| S-CRM-OPPORTUNITIES | 9 | Opportunities workspace | /customers/opportunities | #1099 | #1226 | — | 631170b5 | NOT_APPLICABLE | Blocked on an INDEX-surface callable read path; two further gaps recorded. |
| S-CRM-SALES-ORDER-RECORD | 9 | Sales Order detail | /customers/opportunities/sales-order/:salesOrderId | — | — | — | — | NOT_APPLICABLE | Migrate onto page runtime; resolve raw-id labels |
| S-SVC-WO-RECORD | 9 | Work Order detail | /service/work-orders/:workOrderId | — | — | — | — | NOT_APPLICABLE | Migrate after Gate B |
| S-SVC-JOB-ASSIGNMENTS | 9 | Job Assignments (legacy jobs list) | /service/job-assignments | — | — | — | — | NOT_APPLICABLE | Classify as duplicate/redirect/composition alias per routing architecture. |
| S-SVC-DISPATCH-QUEUE | 9 | Dispatch queue | /service/dispatch | — | — | — | — | NOT_APPLICABLE | Not a list by construction. |
| S-SVC-COORDINATED-VISITS | 9 | Coordinated visits | /service/coordinated-visits | — | — | — | — | NOT_APPLICABLE | Not a list by construction -- a derived grouping has no native rows to read. |
| S-SVC-COORDINATED-MISSION | 9 | Coordinated mission | /service/coordinated-mission | — | — | — | — | NOT_APPLICABLE | Not a list by construction -- a derived grouping has no native rows to read. |
| S-SVC-CONTROL-TOWER | 9 | Service Operations (Control Tower) | /service-operations | — | — | — | — | NOT_APPLICABLE | Not a list; bounded-read remediation on the two reads is separately named. |
| S-SVC-WO-NEW | 9 | New Work Order wizard | /service/work-orders/new | — | — | — | — | NOT_APPLICABLE | None. Stale next-action text corrected. |
| S-ADM-EMPLOYEES | 9 | Employees (Technicians list) | /administration | — | #1239 | — | ef712328 | NOT_APPLICABLE | Resolve the semantic mismatch: the definition must follow the data model the surface actually reads. |
| S-ADM-SAVED-REPORTS | 9 | Saved Reports | /reporting/saved | — | — | — | — | NOT_APPLICABLE | Not a list by construction; would need a CRUD/action-surface pattern distinct from the list runtime. |
| S-ADM-USERS | 9 | Users (admin) | /administration/users | — | — | — | — | NOT_APPLICABLE | Needs a general-purpose unscoped Users directory read plus activation of its gating capability. |
| S-ADM-ROLES | 9 | Roles & Permissions | /administration/roles-permissions | — | #1243 | — | d1dadca2 | NOT_APPLICABLE | Needs a Role/principal entity and a trusted read before it can be a list at all. |
| S-DASH-OPERATIONS | 9 | Inventory & Supply Overview | /dashboard/operations | — | — | — | — | NOT_APPLICABLE | Needs an authoritative aggregate before its reads can be bounded |
| G-GATE-B | 8 | Gate B — cross-domain validation (Work Orders) | — | #1098 | — | — | — | NOT_APPLICABLE | Do not begin site-wide migration if this exposes a bad abstraction |
| S-INV-PARTS | 9 | Parts catalog | /inventory | — | #1241 | — | 3bfc30df | NOT_APPLICABLE | Blocked on free-text search in the query model; also likely misclassified as a list. |
| X-QUERY-MODEL-NO-FREE-TEXT | 6 | The query model has no free-text operator, so no substring-search surface can migrate | — | — | #1257 | — | eb04007c | NOT_APPLICABLE | Parts stays blocked until a backend can serve substring honestly, or the product changes its semantics. |
| S-INV-PART-DETAIL | 9 | Part detail | /inventory/:partId | — | — | — | — | NOT_APPLICABLE | Migrate onto page runtime |
| S-INV-PART-MASTER | 9 | Part Master bulk status table | /inventory/part-master | — | — | — | — | NOT_APPLICABLE | Not a list while the writes live here; the unbounded read is a separate real defect. |
| S-INV-TRANSFERS | 9 | Transfers | /inventory/transfers | — | #1239 | — | ef712328 | NOT_APPLICABLE | Blocked on the Transfer Order identity decision; separately a lifecycle composite, not a list. |
| S-INV-EQUIPMENT-DETAIL | 9 | Equipment detail | /equipment/:equipmentId | — | — | — | — | NOT_APPLICABLE | Migrate onto page runtime |
| S-COM-PURCHASE-ORDERS | 9 | Purchase orders | /purchasing | — | #1241 | — | 3bfc30df | NOT_APPLICABLE | Record as a COMPOSITE/PROJECTION requirement, not a list. |
| S-COM-RECEIPTS | 9 | Receipts | /purchasing/receipts | — | — | — | — | NOT_APPLICABLE | Same construction as Purchase Orders; not a single-collection list. |
| S-DASH-OPERATIONS-SCALE | 9 | Operations dashboard loads the operational database client-side | — | — | — | — | — | NOT_APPLICABLE | Same authoritative-aggregate dependency as S-DASH-OPERATIONS |
| A-AUTOMATION-V1 | 7 | Automation Architecture v1 | — | — | — | — | — | NOT_APPLICABLE | Design after the unified query model - automation CONDITIONS are queries |
| A-EQL-V1 | 7 | EQL / Governed Query Architecture v1 | — | — | — | — | — | NOT_APPLICABLE | Design the surface syntax AFTER the shared query model it compiles into |
| A-BULK-DATA-V1 | 7 | Bulk Data Architecture v1 (import + export) | — | — | — | — | — | NOT_APPLICABLE | Design after the query model - an export IS a governed query with a different sink |
| A-ADMIN-METADATA-CONFIG | 7 | Admin metadata configuration / page designer | — | — | — | — | — | NOT_APPLICABLE | Design after entities are defined - there is nothing to configure until there is metadata to configure |
| X-EQL-TEXT-SEMANTICS | 6 | EQL must preserve the text-operator distinctions | — | — | — | — | — | NOT_APPLICABLE | When EQL is built, compile PREFIX and CONTAINS to different operators. |

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
| S-DASH-MY | 9 | My Dashboard | /dashboard | — | — | — | — | NOT_APPLICABLE | None. Corrected: nothing to migrate, and the recorded dependency never applied. |
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
| X-SURFACE-CLASSIFICATION-COMPOSITES | 6 | Several surfaces classified A_ENTITY_LIST are actually lifecycle composites | — | — | — | — | — | NOT_APPLICABLE | None. Reclassification applied to every audited entry. |
| A-BOUNDED-READ-INVENTORY | 6 | Eight unbounded reads inventoried; one bounded, seven deliberately not | — | — | #1248 | — | 9c30e311 | NOT_APPLICABLE | None. The three still-open ones are recorded separately. |
| X-WRITE-ONLY-COLLECTIONS | 0 | Deny-all collections with no governed read path | — | — | — | — | — | NOT_APPLICABLE | None - recorded as a durable capability gap |
| X-LANE-DURABILITY | 6 | A background agent outlives its dispatching context; absence of a branch is not death | — | — | — | — | — | NOT_APPLICABLE | Corrected. Check for running agents before concluding a lane is lost. |
| X-FIELD-TYPE-RENDERER-AUDIT | 6 | Audit of every declared FIELD_TYPE against cellValue's branches | — | — | — | — | — | NOT_APPLICABLE | None. Findings split into the three entries below. |
| X-ACTION-REGISTRY-EMPTY-IN-PRODUCTION | 6 | actionRegistry.register() is never called in application source | — | — | #1261 | — | b7ec0c29 | NOT_APPLICABLE | None until a definition declares an action id; the tripwire will catch it. |
| X-UNCONSUMED-DECLARATION-PATTERN | 6 | Metadata declares things nothing reads -- seven instances in one session | — | — | — | — | — | NOT_APPLICABLE | None. Recorded as a program-level pattern to check for, not a single defect. |
| X-ACCOUNT-WIRE-CALLABLE-LISTS | 6 | Re-evaluate Opportunities and Sales Orders after the CALLABLE gap closed | /customers/:accountId | — | #1202 | — | — | NOT_APPLICABLE | None. Both sections re-evaluated; neither wired, for new reasons recorded separately. |
| X-MAIN-RED-UNREBASED-MERGE | 6 | origin/main went red: #1204 merged without rebasing onto #1202 | — | — | #1205 | — | — | NOT_APPLICABLE | None. Recorded as an integration-practice finding. |
| X-FALSE-LOCAL-GREEN | 6 | npm test reported green from a grepped log line while the process had failed | — | — | — | — | — | NOT_APPLICABLE | None. Elevated to a standing controller rule. |
| X-ENTITIES-WITHOUT-IDENTITY-PATTERN | 6 | Four entities have no labelable identity, all waiting on one numbering decision | — | — | #1258 | — | 00df6438 | NOT_APPLICABLE | None. Settled by the Owner ruling. |
| X-GENERAL-NUMBERING-RULE | 6 | Number what people must identify; do not number every internal record | — | — | — | — | — | NOT_APPLICABLE | None. Standing rule. |
| X-SHARED-READ-SCOPING-PACKAGE | 6 | Consolidated shared-read scoping decision package, both blockers together | — | — | #1257 | — | eb04007c | NOT_APPLICABLE | Owner ruling on both, when they become the critical path. |

> **X-MERGE-AUTHORITY** blocked — gh pr merge denied by the harness permission classifier (observed on PR #1092). Architecture PRs are dependencies of every later phase, so a persistent denial serializes the program. · requires: Owner adds a scoped Bash permission rule for gh pr merge, or merges queued PRs

