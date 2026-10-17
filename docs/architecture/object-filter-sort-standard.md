# EOS Object Filtering and Sorting Standard — design

Issued: 2026-10-15 (America/Phoenix) · base `a1261486` (= `main`) · branch `work/eos-object-filter-sort-standard`

**Status:** Owner decisions recorded 2026-10-15:
- ND-1 approved; ND-2 approved; ND-3 approved for implementation.
- ND-4: EOS Core company authority, enforced by the Workforce query.
- ND-5 approved.
- ND-6: complaint search disabled by default, pending field-governance review.
- ND-7 approved.

**Phase 1a** (server, Work Orders reference) is in SANDBOX BUILD. No role, grant, Firebase dependency or deployment changes.

### Phase 1a as built (deltas from the design below)

**Code**
- **Server.**
  - `functions/src/eosOps/listQuery.ts` is the shared, pure validator, compiler and keyset module (ND-5).
  - `eosOps/workOrderListQuery.ts` holds the Work Order binding and field groups.
  - `workOrderQueries.ts` adds `listWorkOrders { query }`, keeps the legacy filters, and adds `describeWorkOrderListQuery`.
- **Tests.** `functions/test/support/workOrderListQuerySuite.mjs` runs inside `workOrderDomainCutoverPostgres.test.mjs`, so no workflow edit is needed.

**Company isolation (ND-4)**
- **Behaviour change.** Both the governed path and the legacy filters of the office list are scoped to `resolveCompanyAuthority(...).companyKeys` against `work_orders.operating_company_key`.
  - A caller with no company authority is refused with `COMPANY_AUTHORITY_REQUIRED`.
  - My Work's dispatch queue inherits the scoping. Its section wrapper (`myWork.ts`) already turns that refusal into NOT_AUTHORIZED.
- **Reading of "enforced by the Workforce query".** The company comes from the linked Employee's Workforce home company, which the resolver reads from `eos_workforce.employees`. It does not come from a client-selected company.

**Availability reads (Owner direction 2026-10-17; verified separately from the list)**
- `readTechnicianAvailability` and `findAvailableTechnicianSlots` (`eosOps/workOrderAvailability.ts`) apply the same EOS Core company authority as the G-9 schedule commands and `suggestWorkOrderPlacement`.
- Order: capability first; then no authority → `COMPANY_AUTHORITY_REQUIRED`.
- Only Employees of the caller's companies are read. A named Employee outside them lands in `notFoundEmployeeIds` exactly like an unknown id.
- A company outside reach reads, or is refused, exactly like an unknown company.
- Proof: `functions/test/support/technicianAvailabilityCompanySuite.mjs`, run from `workOrderAvailabilityPostgres.test.mjs`. It covers equivalence of shape and query count, plus independence from Ventana data. A mutation run with the predicates removed fails 5 of 6.
- Customer self-scheduling (`computeTechnicianSlots` with a fixed company) and the legacy Firestore callable are unchanged.

**Field naming (§2.2)**
- Reference fields sort and search by the name the row shows (customer, location, assignee). There are no separate `customerName` / `locationName` field ids.

**Not delivered in 1a**
- **ND-3 index migration.** Writing the migration file was refused by this session's permission policy (migrations are an Owner boundary). The index `(tenant_id, created_at DESC, id DESC)` is specified and is a follow-up for an authorized session. Correctness does not depend on it.
- **Tenant narrowing (§7).** It is a tested hook with no store. Today a tenant cannot change a SYSTEM field's eligibility, so nothing is read.
- **Row projection by field group.** v1's single group has a `null` read requirement, so projection would remove nothing. It arrives with the first restricted group.

**Defects fixed**
- IN values now round-trip the URL (`listUrlState.js`), and old-form links still parse.
- The seed snapshot's `searchable` now comes from a declared `searchable` attribute, not from `filterable`. 9 fields are searchable, each one a field the server search actually matches.

**Owner requirement:** "EOS — Site-wide object filtering and sorting standard" (2026-10-15). Every object list exposes
every governed field that is eligible for filtering and sorting. Eligibility is enforced on the server and intersected with
the employee's field permissions and operating-company authority.

**Governing artifacts this builds on, and does not replace:**
- [ADR-013](ADR-013-object-list-metadata-authority.md): `src/metadata/` is the one object and field authority.
  It defines one filter UI, one sort UI and one URL layer, and a field the viewer may not read is ABSENT.
- [QUERY_CONTRACTS.md](QUERY_CONTRACTS.md): optional fields can hide records from a sorted read.
- [governed-field-groups.md](governed-field-groups.md) and DECISIONS #230: field permission is a capability on a named
  field group.
- DECISIONS #235 (PR #2105, **not merged**): EOS Core company authority, `resolveCompanyAuthority`.
- #172: never show a page-derived count.

---

## 1. Inventory: what exists today

### 1.1 Object and field metadata

| Store | Location | What it holds | Filter/sort attributes |
|---|---|---|---|
| **Canonical registry** (client) | `field-ops-app-vite/src/metadata/entityRegistry.js:77` `ENTITY_REGISTRY` | 28 entities, 400 fields | `filterable`, `sortable`, `operators`, `enumValues`/`enumLabels`, `displayable`, `defaultVisible`, `reportable`, `exportable`, `readCapability`, `sensitivity`, `unsupportedFilterReason`/`unsupportedSortReason` (`metadata/entityDefinition.js:207-247`) |
| List views | `metadata/listViewDefinition.js:202` `makeListViewDefinition` | 21 lists (17 INDEX) | `columns`, `filters` (`makeFilter` :170), `defaultSort`, `tiebreaker`, `savedViews` (`makeSavedView` :189) |
| Query AST (client, unused by lists) | `metadata/query/queryModel.js` | COMPARISON / GROUP / TRAVERSAL predicates; staged validation (metadata → authority → queryability) | operator set :29 |
| **Generated server copy** | `scripts/buildAdminPolicySeedSnapshot.mjs` → `functions/src/adminPolicy/seed/policySeedSnapshot.json` (CI `--check`, `.github/workflows/eos-admin-policy-tests.yml:209`) | 49 objects, 400 fields | `searchable`, `sortable`, `reportable`, `allowedValues`, `sensitivity`. **Drops** `operators`, `filterable`, `enumLabels`, `displayable`, the reasons. **Misderives** `searchable: Boolean(f.filterable)` (`buildAdminPolicySeedSnapshot.mjs:89`) |
| Tenant policy store (Postgres) | `functions/src/adminPolicy/types.ts:242` `ObjectFieldRecord` | SYSTEM fields seeded from the snapshot; CUSTOM fields created by administrators | `searchable`, `sortable`, `reportable`, `allowedValues: string[]` (no labels) |
| Report catalog | `domain/reporting/reportCatalog.js` + server port `functions/src/reporting/reportCatalog.ts` (parity `functions/test/reportCatalogParity.test.mjs`) | 12 objects, 45 fields; its own vocabulary | per-field `report.<obj>.field.<group>.read` |
| v2 field contract | `metadata/v2/fieldDefinitionV2.js:61` | additive; not live | — |

**The only server-side query precedent with validation is the report pipeline.** `functions/src/reporting/reportQueryValidation.ts`
is a parity-tested port of the client validator. It is fail-closed on unknown keys, objects, fields, operators and value types.

### 1.2 Field-level permissions (the "R" of CRED)

- **Live mechanism:** governed field groups, `functions/src/eosOps/governedFieldGroups.ts`.
  - A field group is a capability. A field that no group declares is never projected.
  - Helpers: `fieldAccessFor` :123 and `projectForCaller` :149.
  - It is pure, and its input is the resolved capability set from `eosOps/capabilityAuthority.ts:241,302,393`.
  - **One adopter:** `eosOps/partSupplierTerms.ts:102`.
- **Not enforced:** the role C/R/E/D grid and field overrides.
  - These live in `adminPolicy/effectiveObjectAccess.ts:269,305,378`, which has no production caller.
  - The UI labels them "Legacy matrix — not enforced" (`AdminPolicySurfaces.jsx:349-469`).
- **Client side:**
  - `MetadataListControls.jsx:71-80` hides fields whose `readCapability` the viewer lacks. This is inert: 0 of 400 fields declare one.
  - `metadata/listUrlState.js:172` drops an unreadable URL filter as `NOT_AUTHORIZED`.
- **No list kernel redacts fields.** For example, the Work Order list returns `complaint`, `customerName` and `locationName` to every holder of
  `workOrder.record.read` (`eosOps/workOrderQueries.ts:107-122`).

### 1.3 Picklists

- **No central picklist registry.** Value sets live in:
  - client vocabularies (`domain/constants.js`, `domain/*Vocabulary.js`, `domain/workOrderStatus.js`, …), consumed by metadata `enumValues`/`enumLabels`;
  - server mirrors (`eosCrm/accountVocabulary.ts`, `eosOps/workOrderLifecycle.ts:51`, …);
  - Postgres enums and CHECK constraints (`functions/migrations/1761004800000_work-order-object-authority.sql:50-57`);
  - tenant custom-field `allowedValues`.
- **Parity is pinned only in places.** One example: `functions/test/crmAuthority.test.mjs:428-440` for Account.
- **The validator** requires `enumValues` on ENUM fields and forbids a label equal to its value (`entityDefinition.js:433-452`).

### 1.4 Filter and sort today

- **Client runtime.**
  - `listRuntime.buildQueryDescriptor` (`metadata/listRuntime.js:76-204`) refuses undeclared filters and operators.
  - It appends the tie-breaker in the same direction as the last sort (:168-171).
  - The URL holds `f=field:OP:value`, `sort=field:DIR` and `q`, never a cursor (`metadata/listUrlState.js:98-112`).
- **Server kernels.** No shared validator, sort allowlist or query builder exists.
  - Every EOS Core list has a **fixed** `ORDER BY`. The one exception is the Workforce roster, which sorts **in memory** (`eosAdministration/workforceRoster.ts:183-191,217`).
  - Keyset cursors exist per domain:
    - Commercial: versioned and family-bound, `eosCommercial/reads/commercialReadKernel.ts:221-258`.
    - CRM: `eosCrm/crmAuthorityKernel.ts:211-259`.
    - Workforce: `eosWorkforce/reads/employeeReadKernel.ts:235-264`.
    - Equipment: ad hoc, `eosOps/equipmentOperations.ts:133-143`.
    - A ratchet fences Commercial and Workforce from sharing code (`employeeReadKernel.ts:3-5`).
  - Unknown input keys are refused by most kernels (`acceptOnly`, `requireAllowlistedInput`), but **ignored** by `listObligations`, `listSettlements` and `listRentalAgreements`.

### 1.5 Saved views

- **Static only.** They are declared in definitions (`makeSavedView`).
  - `selectView` copies a view's criteria into the URL (`hooks/useListViewChrome.js:84-98`).
  - The active view is derived from the filters only, not the sort.
- **No per-user store.** That store is #209 HELD (ND-6). The `view` URL param exists, and nothing sets it.

### 1.6 Administration → Objects → Fields

- **Catalog:** `AdminPolicySurfaces.jsx` `ObjectsSurface` :482, `FieldTable` :667.
  - The table shows type, origin, required, sensitivity and lifecycle. It **never shows** searchable, sortable or reportable.
- **Editing:**
  - CUSTOM fields only: `EditFieldForm` :743, `CreateFieldForm` :835.
  - SYSTEM fields are refused server-side (`adminPolicy/policyCommands.ts:338,357`).
  - A custom field "does not store values" yet (:897-899).
- **Endpoint:** `POST /admin/policy` (`adminPolicy/adminPolicyHttp.ts:132`).
  - Read gate: `admin.securityPolicy.read`.
  - Mutations: `editSecurityPolicy`.

### 1.7 Company authority

- **The resolver is not on `main`.** `resolveCompanyAuthority(db, tenantId, principalId)` exists only on PR #2105 (`work/eos-analysis-company-isolation`).
  - It returns `{ companies, companyKeys, gap }`.
  - It fails closed on identity ambiguity, and global roles imply no company.
  - Callers: Analysis and My Work only.
- **The Work Order list is tenant-wide** (`workOrderQueries.ts:239`).
  - `operating_company_key` is `NOT NULL` on the row (`…object-authority.sql:66`) and is never filtered.
  - DECISIONS #235's residual list names the dispatch queue as tenant-wide.

### 1.8 Shared compact components

- **On `main`:**
  - `shared/ui/primitives/PageHeader.jsx`, `shared/ui/EmptyState.jsx`, `HonestState.jsx`.
  - `StatusPill.jsx` and `primitives/StatusIndicator.jsx`. There is no `StatusBadge`.
- **In flight on Lane UX** (`D:/eos-ux-compact`, not merged):
  - `primitives/InfoTip.jsx`, `primitives/Toolbar.jsx`, a revised `PageHeader.jsx`, `form/Field.jsx` help, and `docs/design/compact-ux-standard.md`.
- This design **consumes** those components and edits none of them.

---

## 2. Coverage matrix and omissions

### 2.1 Object-by-object (all 28 registered objects)

- **Method.** Columns 3–9 were generated by importing `ENTITY_REGISTRY` and every `definitions/*.js` list. "Server serves" and "Applied" come from reading
  each source and kernel.
- **Column meanings.**
  - "Neither" counts readable, non-ID, non-address fields that are neither filterable nor sortable.
  - "No reason" counts non-filterable fields with no recorded `unsupportedFilterReason`.

| Object | readVia | Fields | Filterable / Sortable (declared) | List offers: filters · sorts | Server serves today | Applied | Neither | No reason |
|---|---|---|---|---|---|---|---|---|
| **workOrder** | EOS_API | 10 (server row has 20 summary fields) | 2 / 4 | status, customerId · woNumber, status, scheduledStart, createdAt | statuses, customerId, assignee, equipment, plannedPart, schedule window, search; **fixed sort**, 200 cap, no cursor | filter server; **sort and paging client-side over ≤200 rows** | 5 | 8 |
| account | EOS_API | 21 | 3 / 5 | status · name | status, nameStartsWith, search; name ASC keyset | server; any other sort **throws** (`crmListSource.js:23-26`) | 13 | 14 |
| contact | EOS_API | 6 | 1 / 1 | accountId · name | accountId; name keyset | server | 4 | 5 |
| location | EOS_API | 9 | 1 / 3 | accountId · name | accountId; name keyset | server | 5 | 8 |
| equipment | EOS_API | 13 | 2 / 4 | accountId, status · name, status | accountId, location, serial, status, search; name keyset | status and account server; rest **client over ≤5×200** (`equipmentListSource.js:26,57`) | 8 | 11 |
| supplier | EOS_API | 16 | 1 / 5 | status · name, status | fixed | **client** (runtime passed `{}`, `Suppliers.jsx:81`) | 10 | 15 |
| warehouse | EOS_API | 4 | 1 / 2 | status · name, status | fixed | filter client; sort in source | 1 | 3 |
| supplierCatalogItem | EOS_API | 16 | 0 / 0 | — (no list) | field groups (only redacting kernel) | — | 16 | 16 |
| opportunity | CALLABLE | 10 | 2 / 4 | stage · number, stage, value, close | accountId, stage; number DESC keyset | page-local, client over complete read | 5 | 8 |
| salesOrder | CALLABLE | 13 | 2 / 2 | state · number, state | accountId, state; number DESC keyset | **filter and sort not forwarded** (`callableListSource.js:241`) | 10 | 11 |
| salesAgreement | CALLABLE | 24 | 1 / 2 | — (page-local) | accountId, state; keyset | client | 22 | 23 |
| manufacturer | CALLABLE | 9 | 1 / 4 | status · name, status | term; name | client | 4 | 8 |
| equipmentModel | CALLABLE | 15 | 3 / 5 | — | — | — | 8 | 12 |
| invoice | CALLABLE | 20 | 1 / 2 | — (Financials page-local) | company, period; cap 200 | mixed | 17 | 19 |
| employee | CLIENT_DIRECT | 22 | 2 / 4 | employmentStatus, operationalRoles · displayName, status | Workforce kernels: status; id keyset; roster sorts in memory | roster server filter and sort, client pages | 14 | 20 |
| part | CLIENT_DIRECT | 27 | 2 / 6 | status, stockingClass · number, status | catalog API, cursor, count | server | 15 | 10 |
| reorderRequest | CLIENT_DIRECT | 37 | 1 / 4 | status · createdAt | statuses, partId; keyset | client | 32 | 36 |
| transferOrder | CLIENT_DIRECT | 15 | 1 / 4 | status · status, createdAt | status; cap 500 | client | 10 | 14 |
| truck | CLIENT_DIRECT | 13 | 2 / 4 | status, homeWarehouseId · label, status | none | client | 7 | 11 |
| mobileLocation | CLIENT_DIRECT | 9 | 1 / 3 | active · label, updatedAt | — | Firestore | 4 | 8 |
| purchaseOrder | CLIENT_DIRECT | 10 | 0 / 4 | — · number, supplier, dates | reorder API | client | 5 | 10 |
| inventoryAction, inventoryTransaction, purchaseOrderVoid | CLIENT_DIRECT | 8 / 15 / 6 | 0 / 1 each | — | movements: partIds; keyset | — | 6 / 13 / 4 | 8 / 15 / 6 |
| partAlias, payment, receivingOrder, salesTerritory | UNKNOWN | 16 / 12 / 18 / 6 | ≤2 / ≤5 | — | — | — | 11 / 12 / 15 / 6 | 14 / 12 / 18 / 6 |
| **Total** | | **400** | **32 / 82** | 17 INDEX lists | — | — | **282** | **349** |

**Pages outside the metadata layer.** These filter and sort the rows they loaded, client-side:
- Inbound Work (`InboundWorkWorkspace.jsx:666`), Coordinated Visits, Jobs, Dispatch, Control Tower, Rental (`RentalWorkspace.jsx:41,75,96,117`);
- Available Equipment, Equipment Register, Parts Catalog (`PartsList.jsx:421,688`), Truck Inventory, Transfers, Receiving, Receipts;
- Purchase Orders, Reorder oversight, Financials, Truck Registry, Warehouse Masters, Roles and Permissions.

The Dispatcher Board is owned by Lane Scheduling and is out of this lane's scope.

### 2.2 Work Orders field by field (the reference object)

- **Abbreviations:** F = filterable, S = sortable, Q = covered by text search.
- **Proposed operators** use the type defaults in §3.3.
- **Columns** are `eos_ops.work_orders` (`…object-authority.sql:59-117`, plus `rental_agreement_id` from `1764520000000_rental.sql:341`), the open assignment and the joins in `SUMMARY_SELECT` (`workOrderQueries.ts:92-105`).

| Field (metadata id) | Source | Type | Metadata today | Server today | UI today | **Proposed** | Why |
|---|---|---|---|---|---|---|---|
| woNumber | `work_order_number` | STRING | S | Q (ILIKE) | prefix search box (`WorkOrdersList.jsx:226`) | F (EQUALS, TEXT_PREFIX) · S · Q | business identity |
| status | `status` enum | ENUM | F (EQ, IN) · S | F | F + chips; S client | F · S (lifecycle order = Postgres enum order) | — |
| type | `work_order_type` | ENUM | — | — | column | **F** · not S | classification; keeps the recorded `NO_CANONICAL_ORDER` |
| priority | `priority` 1–4 | ENUM | — | — | column | **F · S** | ranked scale. The Firestore index-cost reason (`workOrder.js:274-277`) no longer applies |
| severity | `severity` enum, nullable | ENUM | *undeclared* | returned | — | **add**: F (+IS_NULL) · S | ranked scale |
| customerId | `customer_id` | REFERENCE | F (EQ) | F | customer picker | F (EQ, IN) | governed account picker |
| customerName | join `eos_crm.accounts.name` | STRING | *undeclared*; gap `CUSTOMER_NAME_NOT_SORTABLE_ON_RELATED_LISTS` | Q | rendered | **add**: S · Q | the gap was Firestore-only. Postgres joins it today, so no denormalization is needed |
| locationId / locationName | `location_id` / join `account_locations.name` | REFERENCE / STRING | F none | — | rendered | F (EQ, only with a customer filter) · name S · Q | location picker is account-scoped (`listAccountLocations`) |
| equipmentId | `equipment_id` | REFERENCE | — | F | — | **F** (EQ, IS_NULL) | governed `listEquipment` picker |
| assignedTechId | open assignment `assignee_employee_id` | REFERENCE | — | F | column | **F** (EQ, IS_NULL = "Unassigned") · S by assignee name | governed technician list |
| plannedPart (relationship) | `EXISTS work_order_parts_plan` | — | — | F | — | **F** (EQ) | a relationship backed by a governed query that already exists |
| scheduledStart | `scheduled_start` | TIMESTAMP | S; gap `…SCHEDULED_SORT_HIDES_UNSCHEDULED` | window F; fixed sort | S (with warning) | F (range, IS_NULL = "Unscheduled") · S | close the gap: Postgres keeps NULLs (NULLS LAST) and never drops rows |
| scheduledEnd | `scheduled_end` | TIMESTAMP | *undeclared* | window | — | **add**: F · S | — |
| estimatedDurationMinutes | `estimated_duration_minutes` | NUMBER | *undeclared* | detail only | — | **add**: F · S | — |
| createdAt / updatedAt | `created_at` / `updated_at` | TIMESTAMP | S / *undeclared* | — | S client | F (range) · S | — |
| dispatchedAt … closedAt (7) | lifecycle timestamps | TIMESTAMP | *undeclared* | detail only | — | **add**: F (range, IS_NULL) · S | e.g. "completed last week" |
| partsPlanUpdatedAt | `parts_plan_updated_at` | TIMESTAMP | *undeclared* | — | — | **add**: F · S | — |
| company | `operating_company_key` | ENUM (per caller) | *undeclared* | returned, never filtered | — | **add**: F (IN) · S. Values are the caller's authorized companies only | needs #235. Never lists a company the caller cannot reach |
| provenance | `provenance` NATIVE / MIGRATED | ENUM | *undeclared* | returned | — | **add**: F | — |
| complaint | `complaint` | TEXT | *undeclared* | returned, not searched | — | **add**: Q only (**ND-6**) | long text: no sort, no structured filter |
| diagnosis / resolution | text | TEXT | *undeclared* | detail only | — | not list-visible; not Q in v1 (**ND-6**) | technician-authored text |
| salesOrderId | `sales_order_id` | REFERENCE | *undeclared* | returned | — | **add**: F (IS_NULL / IS_NOT_NULL only) | the Commercial picker is not this lane's |
| rentalAgreementId | `rental_agreement_id` | REFERENCE | *undeclared* | not returned | — | **refused**; gap recorded | the `/operations/rental` company isolation is a P0 residual of #235 |
| created/updated by principal | `*_principal_id` | ID | — | — | — | never | principal identity, not a person label (DECISIONS #106) |
| id, tenant, idempotency keys | — | ID | — | — | — | never | machine fields |

**Result: Work Orders goes from 2 filterable and 4 sortable fields to 26 and 21, plus text search over number, customer, location and
complaint.** Every refusal has a recorded reason. The counts include the seven lifecycle timestamps and the `plannedPart` relationship.

### 2.3 Omission causes (why fields are missing today)

| # | Cause | Evidence | Objects | Fix |
|---|---|---|---|---|
| C1 | **Firestore index economics carried into EOS_API objects.** Refusals reason about composite indexes and `orderBy` dropping rows; neither applies to Postgres. | `workOrder.js:112-116,132-134,274-277`; 4 `NEEDS_INDEX` reasons on EOS_API fields | workOrder, account, equipment, supplier, warehouse | re-derive eligibility from the server binding (§3.2) |
| C2 | **Server kernels take no sort.** Every list has a fixed `ORDER BY`. | `workOrderQueries.ts:249`; the §1.4 table | all EOS_API / CALLABLE | shared server query compiler with a sort allowlist (§5) |
| C3 | **Client sources do not forward, or throw.** | `callableListSource.js:241` sends `{limit}`; `crmListSource.js:19-26`; `workOrderListSource.js:28-37` | salesOrder, opportunity, account, workOrder | source sends the validated query; the server decides |
| C4 | **Metadata under-declares the server row.** | WO: 10 fields declared vs 20 summary fields / 30 columns | workOrder, others | declare every governed field; eligibility is a separate attribute |
| C5 | **"Reference names not projected"** is a Firestore constraint; Postgres joins them. | gap `CUSTOMER_NAME_NOT_SORTABLE_ON_RELATED_LISTS`; `workOrderQueries.ts:104,248` already searches `acct.name` | workOrder and related lists | join-backed sort fields, declared per binding |
| C6 | **No field authority to intersect.** Field `readCapability` is declared on 0/400 fields; field groups have one adopter. Restricted fields were therefore left out rather than governed. | §1.2 | all | the field-group intersection in §4.2 |
| C7 | **No reason recorded** for 349 non-filterable fields. | §2.1 | all | validator requires a reason for every non-eligible readable field (§3.4) |
| C8 | **Page-local lists outside metadata** filter and sort loaded rows. | §2.1 footnote | ~20 pages | migrate per family (§6, Phase 3) |
| C9 | **Firestore-backed (CLIENT_DIRECT) objects.** | `readVia` column | employee, part, reorder, transfer, truck, PO, … | standardize when each gets its EOS read; no new Firebase work |
| C10 | **Defects.** IN values do not survive the URL: `String(array)` at `listUrlState.js:103` is parsed back as one string at :164. "Open work" and status-group chips break on reload or share (`workOrderListSource.js:31` spreads the string into characters). The saved-view highlight ignores sort. | §1.5 | every IN filter | fixed in Phase 1b |
| C11 | **Snapshot misderivation.** `searchable = Boolean(filterable)` (`buildAdminPolicySeedSnapshot.mjs:89`), and the snapshot drops operators. | §1.1 | all | snapshot carries the real attributes (Phase 1a) |

---

## 3. Proposed metadata contract

### 3.1 The five Owner attributes map onto existing metadata (two additions)

| Owner attribute | Existing structure | Change |
|---|---|---|
| **filterable** | `FieldDefinition.filterable` + `operators` (`entityDefinition.js:214-216`) | none. Operators are now validated against the **type default set** (§3.3) and the server binding |
| **sortable** | `FieldDefinition.sortable` | none |
| **searchable** | *none on the field* (the snapshot fakes it) | **ADD** `searchable: boolean` (default false). Allowed on STRING/TEXT/REFERENCE-name fields only. The snapshot carries it; it replaces the `Boolean(filterable)` derivation |
| **listVisible** | `displayable` (may appear as a column) + `defaultVisible` (shown by default) | none. `listVisible` **is** `displayable`. A second name for one fact would be the ADR-013 duplication |
| **savedViewEligible** | *none* | **ADD** `savedViewEligible: boolean`. It **defaults to derived**: `(filterable ∨ sortable) ∧ sensitivity ∉ {CONFIDENTIAL, RESTRICTED}`. It may be set to `false` explicitly. The validator **refuses `true` on a CONFIDENTIAL or RESTRICTED field**: a shared view would persist a filter value on that field, such as "cost > 500" |

No new field registry. `ENTITY_REGISTRY` stays the single definition (ADR-013). Its generated server copy, the seed
snapshot, gains `filterable`, `operators`, `searchable` and `savedViewEligible` and stops misderiving `searchable`.
`ObjectFieldRecord` (`types.ts:242`) gains `filterable` and `savedViewEligible` to match.

### 3.2 Four layers, intersected. Each layer can only narrow.

```
effective(field, caller) =  PLATFORM BINDING         server code: what the kernel can execute (column/join expr, type, operator ceiling)
                          ∩ GOVERNED METADATA        ENTITY_REGISTRY → snapshot: filterable / sortable / searchable / operators
                          ∩ TENANT CONFIGURATION     Administration → Objects → Fields: may turn eligibility OFF, never on beyond the two above
                          ∩ CALLER AUTHORITY         record capability ∧ field-group read ∧ company authority
```

1. **Platform binding.** A server-side, per-object map in TypeScript: `fieldId → { sql, type, nullable, operators, sort?, search? }`.
   - Only the server knows columns and joins, so only the server can promise an operator.
   - A field with metadata and no binding is ineligible.
   - A parity test fails when metadata claims something the binding cannot serve, or the binding serves a field metadata does not declare.
   - This follows the `reportCatalog.ts` / `reportCatalogParity.test.mjs` pattern.
2. **Governed metadata.** The existing client definition, consumed by the server through the generated snapshot.
   - It is **not** a client request: the server reads its own checked-in copy.
3. **Tenant configuration.** It narrows only (§7).
4. **Caller authority.** Resolved per request on the server (§4.2). It is never sent by the client.

### 3.3 Operators by type (the server ceiling)

The operators reuse the `FIELD_OPERATOR` names and the `queryModel.js:29` names.

| Type | Filter operators | Sort | Search |
|---|---|---|---|
| ENUM | EQUALS, NOT_EQUALS, IN, NOT_IN (+ IS_NULL / IS_NOT_NULL when nullable) | only when the enum is a ranked scale (declared) | — |
| STRING | EQUALS, TEXT_PREFIX, TEXT_CONTAINS (+ null ops) | yes (`lower()` collation) | if `searchable` |
| TEXT | TEXT_CONTAINS | no | if `searchable` |
| NUMBER, CURRENCY_MINOR | EQUALS, GREATER_*, LESS_* (+ null ops) | yes | — |
| DATE, TIMESTAMP | GREATER_OR_EQUAL, LESS_THAN (a range = two conditions) (+ null ops) | yes | — |
| BOOLEAN | EQUALS | no | — |
| REFERENCE | EQUALS, IN (+ null ops); values come from a **governed picker**, never typed ids | via a declared name binding only | via the name binding |
| ENUM_SET | ARRAY_CONTAINS, ARRAY_CONTAINS_ANY | no | — |
| ADDRESS, ID | none | no | no |

**Relationships.** A filter that crosses a relationship is offered only when the binding names an existing governed join or
`EXISTS`, such as `plannedPart` or `customerName`. A generic `TRAVERSAL` stays refused. OR groups are out of v1: conditions are
ANDed (YAGNI; `queryModel.js` already reserves `GROUP` for later).

### 3.4 Validator additions (`entityDefinition.js` `validateFieldDefinition`)

- `searchable` is allowed only on STRING, TEXT or name-bound REFERENCE fields.
- `savedViewEligible: true` is refused on CONFIDENTIAL and RESTRICTED fields.
- Declared operators must be a subset of the type ceiling in §3.3.
- **Every readable, displayable field that is not filterable or not sortable must state a reason.** This closes C7, and the coverage test
  stops treating "no reason" as acceptable debt.
- New reason `NOT_BOUND`: governed, with no server binding yet.
  - `NEEDS_INDEX` stays for Firestore-backed objects only.
  - The validator refuses `NEEDS_INDEX` on an `EOS_API` entity.

### 3.5 The wire contract (one shape for every governed list)

**Request:**

```jsonc
// request: added to each list operation's input; legacy params keep working (§6 Phase 1a)
{ "query": {
    "v": 1,
    "filters": [ { "field": "status", "op": "IN", "value": ["SCHEDULED", "DISPATCHED"] },
                 { "field": "completedAt", "op": "GREATER_OR_EQUAL", "value": "2026-10-01T00:00:00Z" } ],
    "sort":    [ { "field": "priority", "dir": "ASC" }, { "field": "scheduledStart", "dir": "ASC" } ],
    "search":  "harbor",
    "limit":   50,
    "cursor":  "<opaque>" } }
```

**Response:**

```jsonc
// response
{ "items": [...], "hasMore": true, "nextCursor": "<opaque>",
  "applied": { "filters": [...], "sort": [...], "search": "harbor" } }   // echo of what the SERVER applied
```

Field ids are the **metadata ids** (`woNumber`, `assignedTechId`), not column names. Existing URLs, static saved views and the
`f=`/`sort=` encoding stay valid. A sibling read, `describeListQuery`, returns the caller's effective eligibility in one call per list mount:
- the fields, with operators;
- the sort fields;
- the picklist **values** the caller may use;
- the search coverage.

Labels stay on the client vocabulary (`enumLabels`). Custom-field values are their own labels.

**No total count in v1.** Lists report `hasMore` only, which is consistent with #172. A complete count is a separate authority (**ND-2**).

---

## 4. Server enforcement

### 4.1 Validation (every request, before SQL)

**Fail-closed rules:**
- The query must be an object, with the keys `v, filters, sort, search, limit, cursor` only. An unknown key is refused.
- At most 10 filters, 2 sort clauses, 50 IN values and a search string of 100 characters.
- `limit` is between 1 and 200. The existing caps are `WORK_ORDER_LIST_MAX` and `requirePageSize`.
- Each `field` must be a string present in the caller's **effective** set (§3.2). Each `op` must be in that field's effective operators.
- Each `value` must match the field type:
  - enum and picklist values must be members of the caller's allowed set;
  - instants are ISO-8601;
  - ids follow the `ID_SHAPE` rule;
  - IN values are arrays of that type.
- The same field and operator pair may not repeat, except a range (`≥` with `<`).

**Rules that keep restricted data from leaking:**
- **An unknown field and an unreadable field get the same refusal**: `LIST_QUERY_FIELD_NOT_AVAILABLE`, with one message. The message names the
  field only as the caller sent it, never its label, group or reason. Distinguishing the two would disclose that a restricted field exists.
- **Value errors** never echo the value (`LIST_QUERY_VALUE_INVALID`).
- **A reference value is not existence-checked.** That check would be an oracle. The company and tenant predicates already make a foreign id
  match nothing.
- **Search covers only fields the caller may read.** The kernel builds the OR over `searchable ∩ readable` per request, so a hidden
  column can never make a row match.
- **Sort is refused on an unreadable field**, because the order alone would leak values.
- **No counts.** The response has nothing beyond `hasMore`.

**Refusals are 400 `INVALID_INPUT`.** The client's `DroppedCriteriaNotice` already explains a narrowed list. This uses the existing
`WorkOrderLifecycleError` category map (`eosOpsHttp.ts:721-724`).

### 4.2 Authority intersection (order of evaluation)

1. **Authentication and actor:** as today (`executeWorkOrderOperation`, `eosOpsHttp.ts:746-794`). Conditioned grants are withheld (`capabilityAuthority.ts:393`).
2. **Record capability:** `workOrder.record.read` held unconditionally (`workOrderQueries.ts:200`). This step is unchanged.
3. **Company authority:** `resolveCompanyAuthority(...)` (#2105).
   - Empty companies → `COMPANY_AUTHORITY_REQUIRED`, exactly as #235 does for Analysis.
   - Otherwise SQL adds `w.operating_company_key = ANY($companyKeys)`.
   - A `company` filter may only narrow inside that set.
4. **Field authority:** a Work Order field-group definition (`defineFieldGroups`).
   - **v1 declares every list field in one group whose `read` requirement is `null`**, that is, governed by the record gate.
   - That **grants nothing new and changes no role**. It installs the mechanism, so a future Owner-approved restricted group, such as
     technician-authored text, removes those fields from columns, filters, sort and search in one place.
   - `projectForCaller` also projects each row, so the list and its filters can never disagree about what a caller may read.
5. **Validation:** §4.1, against the effective set from steps 3–4.
6. **One parameterized SQL statement.** Tenant, quarantine (`notQuarantined`) and company predicates come first, then filters. Sort and keyset run
   **before** `LIMIT`. Filters and sort therefore apply to the whole matching set, never to the loaded rows.

### 4.3 Deterministic pagination

- **Order:** `ORDER BY <clauses>, w.id <dir of last clause>`. NULLs sort **last in both directions** (**ND-7**), which matches the server's
  existing `NULLS LAST`.
- **Keyset, never offset.**
  - The cursor is versioned and object-bound, following the Commercial pattern (`commercialReadKernel.ts:221-241`).
  - It carries the last row's sort values and `id`, plus a **fingerprint of the normalized query** (filters, sort, search, company set).
  - A cursor replayed with different criteria, or after the caller's company authority changed, is refused (`CURSOR_INVALID`) and
    never silently restarts.
  - Nullable sort keys compile to `(col IS NULL, col, id)` comparisons, expanded per direction.
- **SQL safety.** SQL fragments come only from the server binding. Values are always bind parameters, and `LIMIT` is an integer after
  validation. This is the existing practice: `workOrderQueries.ts:250`.

### 4.4 What stays out of the generic compiler

- **Domain fences stay.** The Commercial ↔ Workforce no-shared-code ratchet stays (`employeeReadKernel.ts:3-5`). The compiler is a pure
  function, `(binding, effective, query) → { sql, params }`, that each kernel calls from its own module, the way `governedFieldGroups.ts`
  is consumed. Proposed home: `functions/src/eosOps/listQuery/`. The Owner or coordinator confirms whether the fence admits a
  shared pure module (**ND-5**).
- **Finance keeps its stricter per-key company rule** (`financeCompanyAccess.ts`). Its lists adopt the standard only with that rule.

---

## 5. Compact filter and sort UX

**Placement.** One `Toolbar` row (Lane UX primitive) under the `PageHeader`. Nothing new is added to the header.

```
[ 🔍 Search work orders…  ⓘ ]  [ Filter · 2 ]  [ Sort: Priority ↑, then Scheduled ]   Open work · Unassigned · …(views)
 Status is Scheduled or Dispatched ✕   Completed on or after Oct 1 ✕   Clear all
```

**Controls:**
- **Search.** The ⓘ is `InfoTip`. It lists exactly what search covers, taken from `describeListQuery`, for example "Number, customer, location."
  There are no "starts with" placeholders.
- **Filter** opens a popover (a bottom sheet under 768 px; coordinate with Lane A A4).
  - **Field selector:** a searchable combobox (ARIA 1.2 combobox + listbox, type-ahead).
    - It shows **every eligible field**, with common ones first, then all fields A–Z.
    - Ineligible-but-readable fields are not listed. A footer `InfoTip`, "Why can't I filter by some fields?", lists them with their
      `UNSUPPORTED_TEXT` reason.
    - Unreadable fields are absent everywhere (ADR-013 rule 4).
  - **Operator:** a select that shows only the field's effective operators, with a sensible default (enum → "is any of", date →
    "on or after").
  - **Value editor by type:**
    - enum → a checklist from the governed picklist, with labels from the vocabulary;
    - date → native `<input type="date">` pairs;
    - number → number input;
    - reference → the existing governed picker, such as the customer picker (`WorkOrdersList.jsx:118`).
  - Multiple conditions stack as rows joined by a visible "and". **Apply** writes the URL once.
- **Chips** show active conditions. Each is a button that reopens its condition, plus a labelled remove ✕. The existing
  `ActiveCriteria` and `DroppedCriteriaNotice` (`MetadataListControls.jsx:224,292`) are kept.
- **Sort** opens a popover: a field combobox over eligible sort fields, an ↑/↓ toggle, and an optional "then by". The tie-breaker is
  never shown. Header clicks keep working (`MetadataListGrid.jsx:120-127`) and set the primary clause.
- **Saved views** keep the existing chips (`ListViewHeader.jsx`).
  - The highlight compares sort as well as filters.
  - "+ Save view" stays hidden until #209 is released.
- **States.**
  - `HonestState` FILTER_ZERO / SEARCH_ZERO.
  - "More matching work orders" when `hasMore`. There is never a number.
  - A polite live region announces "Results updated."
- **No explanatory prose on the page.** Secondary explanations live only in `InfoTip` / `FieldHelp`.

All of this replaces the existing `AddFilter` and `SortControl` **inside `MetadataListControls.jsx`**. ADR-013 keeps one filter UI and
one sort UI, so every metadata list gets it at once.

---

## 6. Implementation phases and PR boundaries

The cost rule applies: each PR is verified locally first and pushed once. The phases are ordered by dependency, and each PR is
independently safe to merge. Merging still needs Owner authorization each time.

| Phase | PR | Contents | Gate |
|---|---|---|---|
| 0 | *this doc* | design + registry entry | **Owner approves §3–§4 (ND-1…ND-7)** |
| 1a | **Server, WO reference, back-compatible** | `functions/src/eosOps/listQuery/` (pure compiler + validator + keyset cursor), WO binding + field groups (null requirement), `listWorkOrders` accepts `query` **alongside** the legacy params (myWork `dispatchQueue` `myWork.ts:215` and `useWorkOrderSearch.js:38` stay untouched), `describeWorkOrderListQuery` op, company predicate (**needs #2105 merged**, ND-4), snapshot generator carries the new attributes, parity + PG tests | Lane D review; Owner merge. Merging auto-deploys Render nonprod |
| 1a′ | (same PR, Owner-gated item) | additive sort indexes, e.g. `(tenant_id, created_at DESC, id)`. **This is a migration** (ND-3), deferrable: current per-tenant volume is small | Owner |
| 1b | **Client, after 1a is live** (the #2102 → #2099 lesson) | WO metadata declares all §2.2 fields with reasons; `workOrderListSource` sends `query` + cursor and **deletes** the client-side sort, offset paging and 200-row refusal (`workOrderListSource.js:39-94`); new controls in `MetadataListControls.jsx`; IN URL fix (C10) with back-compat parse of the comma form; saved-view highlight includes sort; validator additions (§3.4) | Lane D; Owner merge (Vercel) |
| 2 | Coverage ratchet | test that every EOS_API INDEX list's offered filters and sorts ⊆ its binding, and every readable field is eligible or carries a reason; the `listIndexCoverage.mjs` analogue for Postgres | with 1b if small |
| 3 | **Extend per kernel family**, one PR each, owner-coordinated | CRM (account, contact, location) · Equipment · Ops inventory (reorder, transfer, cycle count, inbound) · Workforce (employee, roster to SQL sort) · Commercial (opportunity, salesOrder, salesAgreement: **Commercial reads are not this lane's**; coordinate) · Finance (with `financeCompanyAccess`) · Rental (**blocked** on the #235 rental P0) | each family's owner + Lane D |
| 4 | **Administration → Objects → Fields eligibility** | §7. Needs a migration (columns on `object_fields`) and a new policy command | Owner (migration + Administration surface) |
| — | Saved-view store | #209 HELD | Owner releases #209 |

Firestore-backed objects (C9) adopt the standard as part of their own Firebase-exit cutover. No Firebase code is added for this.

---

## 7. Administration → Objects → Fields

- **What it shows.** `FieldTable` (`AdminPolicySurfaces.jsx:667`) gains read-only columns. For each list attribute it shows the
  **platform ceiling** and the **tenant setting**: Filterable, Sortable, Searchable, Column, Saved views. Each shows `On`, `Off (tenant)`
  or `Not supported`, with the reason in an `InfoTip`.
- **What an administrator can change.** A new narrow-only command, `setFieldListEligibility`, on SYSTEM **and** CUSTOM fields.
  - It may turn an attribute **off**, or restore it to the ceiling.
  - Turning one on beyond the ceiling is refused (`ELIGIBILITY_EXCEEDS_PLATFORM`).
  - It **cannot** change `displayable` into visibility of an unreadable field. Visibility is a capability, granted only in Security Roles.
  - It does not touch the existing protection of SYSTEM definitions (`policyCommands.ts:357`). It writes a separate per-tenant
    eligibility override, not the definition.
- **Authority.** It uses the existing object-metadata gate (`editSecurityPolicy`, as `updateObjectMetadata` does), so **no new capability
  and no grant change** is needed. The change is audited like every policy command.
- **Effect.** It is read by `describeListQuery` and the validator at layer 3 (§3.2). A tenant change applies on the next request, and
  cursors stop working because the fingerprint changed.
- **Custom fields.** These stay out until custom-field values are stored. Today they store none (`AdminPolicySurfaces.jsx:897-899`).

---

## 8. Regression and security test plan

**Server: unit (pure compiler and validator)**
- Unknown field, unreadable field, and a field outside tenant eligibility → identical code and message (snapshot the body).
- An operator outside the type ceiling or outside effective operators → refused. A type-mismatched value → refused, and the value is not echoed.
- Enum value outside the caller's set (including another company's key) → refused. IN > 50, filters > 10, sort > 2, limit 0 / 201 / "50x" → refused.
- An injection corpus in `field`, `op`, `dir` and `value` (quotes, `;`, `--`, `)`, unicode) → refused or bound. A snapshot of compiled SQL contains no
  caller text.
- Cursor: tampered, wrong version, wrong object, a different query fingerprint, or a changed company set → `CURSOR_INVALID`.
- **Mutation proof:** inject a binding with no metadata, or metadata with no binding → the parity test fails.

**Server: real PostgreSQL** (`functions/test/*Postgres.test.mjs`, the CI job that already runs for #2099)
- **Filters before pagination.** 250 seeded WOs, where the only matches sit beyond row 200 of the default order → returned on page 1.
- **Global sort.** Paging every page under each sortable field in both directions equals one `ORDER BY` over the whole set. No duplicates or
  gaps, including ties and NULLs, and with rows inserted between pages.
- **Tenant isolation.** A second tenant's rows never appear under any filter, sort, search or cursor.
- **Company isolation** (with #2105). A Taylor-only caller never sees a Ventana WO:
  - filtering by a Ventana customer id → zero rows, with no error that differs from an empty result;
  - search matching only Ventana → empty;
  - sort order is identical with and without Ventana rows present;
  - the `company` picklist omits Ventana;
  - no authority → `COMPANY_AUTHORITY_REQUIRED`.
- **Quarantined WOs** never appear (`notQuarantined`).
- **Field groups.** A test-only restricted group removes the field from `describe`, refuses its filter and sort identically to an unknown field,
  excludes it from search matching, and withholds it in rows.
- **Back-compat.** The legacy `{statuses, customerId, search, …}` inputs return exactly what they return today, including the `myWork` dispatch
  queue and `useWorkOrderSearch`.

**Client** (vitest)
- URL round trip of IN and range criteria. The legacy comma-form URLs still parse. Dropped criteria are reported.
- Static saved views (`open`, the status-group chips) still select and highlight after a reload. The highlight respects sort.
- The field selector lists exactly `describe`'s eligible fields. Its keyboard and ARIA combobox semantics work. The ineligible explanation is reachable.
- Operator lists per type. Picklists use labels, never machine values.
- No count rendered. `hasMore` copy only.
- Visual: 375 px sheet and desktop popover, via the Lane UX visual harness.

**Governance**
- The snapshot generator's `--check` covers the new attributes.
- The validator refuses `savedViewEligible: true` on CONFIDENTIAL fields and `NEEDS_INDEX` on EOS_API fields.
- A coverage test shows every readable field as eligible or reasoned.

---

## 9. Owner decisions needed

| ND | Decision | Recommendation |
|---|---|---|
| ND-1 | Approve the contract: four narrowing layers (§3.2), `searchable` + `savedViewEligible` added, `listVisible` = `displayable` | approve |
| ND-2 | No total counts on standardized lists in v1 (`hasMore` only) | approve; a count needs its own complete-count authority (#172) |
| ND-3 | Additive Postgres sort indexes in Phase 1a (a migration) | approve as part of 1a, or defer until volume warrants |
| ND-4 | Work Order list company isolation: the security lane delivers it, or the Filtering lane includes it in 1a with the #2105 resolver. Either way, 1a waits for #2105 | security lane owns the predicate; 1a consumes it |
| ND-5 | A shared pure `listQuery` module is consumed by each kernel family, across the Commercial/Workforce no-shared-code fence | allow pure, I/O-free shared code; kernels keep their own transports and errors |
| ND-6 | Work Order text search covers number, customer, location and **complaint**; diagnosis and resolution stay out | include complaint (My Work search already matches it, `myWork.ts:295`) |
| ND-7 | NULLs sort last in both directions | approve; it matches the server today |

---

## 10. Dependencies and coordination

- **Security lane (#2105 / DECISIONS #235).** The company resolver is consumed, not edited. Phase 1a merges after #2105.
  This lane does not edit `companyAuthority.ts`, `analysis.ts`, `myWork.ts`, `rental.ts` or the Commercial reads.
- **Lane UX.** `Toolbar`, `InfoTip` / `FieldHelp`, `PageHeader` and `EmptyState` are consumed after they merge. Phase 1b waits for them, or ships
  behind the existing primitives and switches over when they land.
- **Lane A.** The phone sort sheet (A4) and the saved-view chip semantics (A2) overlap §5. The chip toggle work stays Lane A's, and this lane
  consumes it.
- **Lane Scheduling.** The dispatcher board is untouched. It reads `useWorkOrders` (unfiltered), which keeps the legacy input.

*Developed under the direction of Rudy DiGiorgio using AI-assisted engineering tools.*
