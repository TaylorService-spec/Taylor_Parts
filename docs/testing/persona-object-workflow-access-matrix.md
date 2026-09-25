# Persona Business-Need / Object / Workflow Access Matrix

**Classification: PROPOSED CONTRACT — NOT A GRANT.** Nothing in this document or in
`functions/scripts/fixtures/personaBusinessNeeds.v1.json` grants, revokes, widens or narrows any
authority. It states what each business persona **needs**, so a later explicit Owner ruling can compare
need against the measured grant. No Security Role, grant, Employee fixture, credential, migration or
nonprod row was changed to produce it.

- Lane: BF — Persona Business-Need / Object / Workflow Matrix
- Base: `origin/main` @ `b6a36b15`
- Measured: 2026-09-24, read-only, nonprod PostgreSQL `dpg-dah48qht0dsc73egnml0-a` (SELECT only)
- Nonprod mutations: **NONE**. Production mutations: **NONE**.

---

## 1. The authority model this matrix is written against

```
Object -> Action/Capability -> Security Role grant and/or DIRECT Principal grant -> effective capability
then narrowed by: Work Eligibility -> Operational Scope -> Record Relationship/Assignment/Ownership
                  -> Domain Preconditions -> Workflow Preconditions
```

Six distinctions are load-bearing and are never collapsed anywhere below:

| | |
|---|---|
| Authentication Identity | ≠ Principal |
| Principal | ≠ Employee |
| Security Role | ≠ Job Role |
| Work Eligibility | ≠ Security Role |
| Operational Scope | ≠ Security Role assignment scope |
| Owner / Accountable / Assignee / Approver | four different people |

**A Workflow may NARROW Object authority. A Workflow must NEVER CREATE Object authority.** §9 is the
proof, executed rather than asserted.

### 1.1 Two capability vocabularies, deliberately not interchangeable

This is the single most common source of a wrong reading of this matrix.

| vocabulary | where | count | resolver |
|---|---|---|---|
| Firestore **permission ids** | `functions/src/access/permissionCatalog.ts` | **151** (41 active, **110 registered `active: false`**) | `resolveEffectivePermission.ts` |
| eos_policy **capability keys** | `eos_policy.capabilities` | **76** (26 Objects × action cells) | `effectiveObjectAccess.ts` / `authorizeObjectAction` |

They overlap and neither contains the other.

- **PostgreSQL-only** (absent from `permissionCatalog.ts`): `admin.securityPolicy.read`, all six
  `workflowDefinition.*`, `workOrder.lifecycle.dispatch` / `.complete` / `.cancel`,
  `inventory.workOrderConsumption.record`, `inventory.manufacturer.read`, `finance.invoice.read`,
  `finance.payment.read`, `reorder.request.read`, `inventory.cycleCount.close`.
- **Catalog-only** (absent from `eos_policy.capabilities`): all 39 `report.*`, all 5 `performance.*`,
  all 4 `service.inboundWork.*`, both `coverage.*`, both `financialPolicy.*`, `admin.dataImport.stage`,
  `equipment.compatibility.import` / `.verify` / `.correct`, `salesOrder.fulfill` / `.service`,
  `inventory.location.bin.manage` / `.read`, `inventory.returns.intake`, all 5 `finance.visibility.*`,
  `reorder.purchaseOrder.void`, and the four `reorder.request` execution verbs
  (`startPurchasing`, `postPurchasingUpdate`, `recordPurchaseOrder`, `markReceived`).

This split has a direct consequence for §10 D-02: `ADMIN_ALL_PERMISSIONS` derives admin's grant from
`PERMISSION_CATALOG`, so the in-repo "admin and owner hold everything" rule **cannot reach any
PostgreSQL-only key**. `objectSecurityAuthority.ts`'s own header names this class of problem as what it
replaced — *"those two disagreed about 47 of ~70 capability keys"* — and the split it describes as
fixed is still present between these two stores.

### 1.2 The Object registry is in the database, not in TypeScript

`functions/src/adminPolicy/objectSecurityAuthority.ts` declares **zero** Objects. It is a projection
engine over `readonly CapabilityRecord[]` supplied by the caller; the Object/action vocabulary lives in
`eos_policy.capabilities` (`object_key`, `action_key`, `action_kind`, `display_label`), made `NOT NULL`
by migration `1761350400000` under `UNIQUE INDEX capabilities_object_action_unique (object_key,
action_key)`. Its write contract is `(objectKey, actionKey)` and never a raw capability key, *"because
exposing the key as the primary contract would let a caller name a capability that governs something
else entirely."*

**Measured: `eos_policy.objects` holds 39 rows and only 26 of them carry a capability.** The 13 that
carry none are `commissions`, `contact`, `equipment`(read side), `location`, `marketingInitiatives`,
`mobileLocation`, `partAlias`, `purchaseOrderVoid`, `salesTerritory`, `supplier`,
`supplierCatalogItem`, `technicianTimeNonWork`, `truck` — plus `workflowInstance`, registered
deliberately with no capability because *"execution security must be designed together with
target-Object enforcement rather than back-filled to populate a matrix."* An action with no grantee
renders as an **empty row, never omitted**, which is exactly how the three Work Order lifecycle actions
appear today.

Note the two namespaces deliberately do **not** line up: `rolesPermissions.read` =
`admin.securityPolicy.read`; `part.read` = `inventory.catalog.read`; `transferOrder.read` =
`warehouse.transferOrder.read`; `equipmentModel.read` = `equipment.compatibility.view`.

---

## 2. Measured baseline (2026-09-24, nonprod)

### 2.1 eos_policy

| table | rows |
|---|---|
| capabilities | **76** |
| role_capabilities | **387** |
| principal_capabilities | **0** (the direct-grant path exists and is unused) |
| roles | **49** (48 in-repo catalog + `zz_nonprod_acceptance`, the only `CUSTOM` origin) |
| objects | **39** (26 carry a capability) |
| object_fields | 390 |
| role_object_permissions | **256** across 34 roles — `can_delete = false` on **all 256** |
| role_field_permission_overrides | **0** |
| capability_grant_conditions | **0** (relation live, created by migration `1762214400000`) |
| principals | 30 (all `status=active`) |
| user_role_assignments | 43 — every one `scope_type='global'`, `scope_value=''` |
| employee_principal_links | 29 |
| workflows / workflow_versions | 5 / 5 — **every version DRAFT, none PUBLISHED** |
| workflow_steps / workflow_actions / workflow_role_bindings | 36 / 48 / **112** |
| workflow_instances | **0** |
| audit_events | 191 |

Grant provenance of the 387 (`functions/src/adminPolicy/seed/roleCapabilityAuthorityBaseline.json`):
**MIGRATION_BACKED 329 · CANONICAL_CATALOG 53 · NONPROD_ACTIVATION 5 · FIXTURE_ONLY 0 ·
UNEXPLAINED 0.**

**32 of the 49 role keys have ZERO active principal holders** — including `controller`,
`accountingManager`, `financeManager`, `reportViewer`, `reportFinanceViewer`, `reportAuthor`,
`salesManager`, `operationsManager`, `generalEmployee`. **19 roles carry ZERO capabilities.**

### 2.2 Ten capabilities have ZERO role holders and are unreachable by anybody

`inventory.cycleCount.close`, `inventory.workOrderConsumption.record`, `reorder.request.assign`,
`reorder.request.read.queue`, `workflowDefinition.bindRole`, `workflowDefinition.create`,
`workflowDefinition.edit`, `workflowDefinition.publish`, `workflowDefinition.version` — and
`workOrder.lifecycle.complete`, held by `technician` **only** (not admin, not owner).

Five are the deliberate Workflow Definition hold. Two are not: `reorder.request.assign` and
`reorder.request.read.queue` are the Reorder Queue's own authorities and nobody holds either.

### 2.3 eos_workforce

- `employees` **17** — ACTIVE 15, CONTRACTOR 1, ON_LEAVE 1
- `employee_work_eligibility` **7 rows, all active** — SERVICE_TECHNICIAN 3 (Finley, Gray, Oakley),
  PARTS_OPERATIONS 2 (Logan, Kai), WAREHOUSE_OPERATIONS 2 (Noor, Morgan)
- `employee_operational_scopes` **6 rows, all active** — REORDER_QUEUE/`taylor` 3 (Emerson, Avery, Kai,
  all seeded by `migration:1761696000000`), WAREHOUSE/`SC-WH-MAIN` 2 (Noor, Morgan),
  WAREHOUSE/`SC-WH-SERVICE` 1 (Morgan)
- `job_roles` **0** and `employee_job_role_assignments` **0** — the Job Role layer is entirely empty
- `employee_reporting_relationships` 16

### 2.4 Business data

`eos_ops.parts` **0** · work_orders 13 · purchase_orders 2 · reorder_requests 2 · warehouses 2 ·
`eos_commercial.opportunities` **0** · sales_agreements **0** · sales_orders **0** ·
`eos_finance.invoices` **0** · payments **0** · `eos_crm.accounts` 3 · contacts 6.

Every wired catalog command refuses `DOMAIN_NOT_ACTIVATED` until a COPY, and the object key is **`part`**
(singular), so all 19 `part`-object read grants resolve to an empty set.

### 2.5 The contextual/conditional narrowing layer is built and INERT

| activation boundary | state |
|---|---|
| `eosOps/contextualActionAuthority.ACTION_CONTEXT_POLICIES` | `new Map()` — **ZERO entries** |
| `eosOps/conditionalEntitlement.SHIPPED_GRANT_CONDITIONS` | `grantConditionCatalog([])` — **empty, frozen** |
| `eos_policy.capability_grant_conditions` | live relation, **0 rows** |

So **no capability id anywhere carries a contextual predicate in deployed code at the entitlement
layer**, and an action with no policy is UNCONDITIONED and returns ALLOWED without a single workforce
query. Two exceptions are live and matter to this matrix:

1. `eosOps/workOrderLifecycle.LIFECYCLE_CONTEXT_PREDICATES` is a **separate** registry and **is**
   consumed: `workOrder.lifecycle.complete` declares
   `{ kind: "RECORD_ASSIGNMENT", relation: "ASSIGNED_EMPLOYEE" }`, and `authorizeLifecycleEdge` →
   `authorizeObjectAction` is the path `transitionWorkOrder` actually calls.
2. The legacy TypeScript conditions: `isOwnAssignment` on `reorder.purchaseOrder.void` (admin,
   dispatcher, owner) and `operationalRoleActive`/`PARTS_ASSOCIATE` on 7 `technician` ids.

The three implemented `ContextPredicateKind`s are exactly **`WORK_ELIGIBILITY`**,
**`OPERATIONAL_SCOPE`**, **`RECORD_ASSIGNMENT`**. There is **no ownership Kind and no requester Kind**;
`RECORD_ASSIGNMENT` admits only `ASSIGNED_EMPLOYEE`, and anything else throws. The refusal vocabulary is
7 values: `ALLOWED`, `CAPABILITY_MISSING`, `EMPLOYEE_LINK_REQUIRED`, `WORK_ELIGIBILITY_MISSING`,
`OUTSIDE_OPERATIONAL_SCOPE`, `NOT_ASSIGNED`, `WORK_ELIGIBILITY_UNMAPPED`. **Capability is checked
first, always** — evaluating record context first would leak business facts — and an unknown predicate
**denies**, because an unprovable gate must never open.

---

## 3. Persona roster — measured identity binding

Sixteen personas, each bound to a measured Employee / Principal / Role triple. `job_title` is free text
on the Employee record: it is **presentation only**, because `job_roles` holds 0 rows.

| P | persona | Employee | job_title | emp status | Security Roles (measured) | Work Eligibility | Operational Scope |
|---|---|---|---|---|---|---|---|
| P01 | Owner / Executive | *(none — see D-01)* | — | — | `owner` (principal `dca03ad1…`, **no Employee link**) | — | — |
| P02 | Administrator | `synthetic-np-emp-owner-executive` (Avery) | Owner / Executive | ACTIVE | `admin` | — | REORDER_QUEUE:`taylor` |
| P03 | General Manager | `synthetic-np-emp-general-manager` (Bailey) | General Manager | ACTIVE | `generalManager` | — | — |
| P04 | Service Manager | `synthetic-np-emp-service-manager` (Devon) | Service Manager | ACTIVE | `fieldManager` | — | — |
| P05 | Dispatcher | `synthetic-np-emp-dispatcher` (Emerson) | Service Dispatcher | ACTIVE | `dispatcher` | **—** | REORDER_QUEUE:`taylor` |
| P06 | Technician — ASSIGNED | `synthetic-np-emp-service-technician-a` (Finley) | Service Technician | ACTIVE | `technician` | SERVICE_TECHNICIAN | — |
| P07 | Technician — UNASSIGNED | `synthetic-np-emp-service-technician-b` (Gray) | Service Technician | ACTIVE | `technician` | SERVICE_TECHNICIAN | — |
| P08 | Parts Associate | `synthetic-np-emp-parts-associate` (Logan) | Parts Associate | ACTIVE | `partsAssociate`, `inventoryReceivingClerk` | PARTS_OPERATIONS | **none** |
| P09 | Parts Manager / Purchasing | `synthetic-np-emp-parts-manager` (Kai) | Parts Manager | ACTIVE | `partsManager`, `purchasingManager` | PARTS_OPERATIONS | REORDER_QUEUE:`taylor` |
| P10 | Warehouse Associate | `synthetic-np-emp-warehouse-associate` (Noor) | Warehouse Associate | ACTIVE | `warehouseAssociate`, `inventoryCycleCountCounter` | WAREHOUSE_OPERATIONS | WAREHOUSE:`SC-WH-MAIN` |
| P11 | Warehouse Manager | `synthetic-np-emp-warehouse-manager` (Morgan) | Warehouse Manager | ACTIVE | `warehouseManager`, `inventoryBinAdministrator`, `inventoryCycleCountReconciler` | WAREHOUSE_OPERATIONS | WAREHOUSE:`SC-WH-MAIN`, `SC-WH-SERVICE` |
| P12 | Retail Sales | `synthetic-np-emp-retail-sales-a` (Harper), `-b` (Indigo) | Retail Sales Representative | ACTIVE | `salesperson` | — | — |
| P13 | National Accounts Sales | `synthetic-np-emp-national-accounts-sales` (Jules) | National Accounts Manager | ACTIVE | `salesperson` | — | — |
| P14 | Finance / Accounting | *(none)* | — | — | `controller` / `accountingManager` / `financeManager` — **0 holders each** | — | — |
| P15 | Reporting / read-only | *(none)* | — | — | `reportViewer` / `reportFinanceViewer` / `reportAuthor` — **0 holders, 0 capabilities each** | — | — |
| P16 | Restricted / negative control | `synthetic-np-emp-records-clerk` (Quinn) — Employee layer only | Records Clerk | ACTIVE | **none** (0 principals) | — | — |

**P01 and P02 are one Employee in the fixture, not two.** `personaE2EScenarios.v1.json.canonicalPersonas`
records "Administrator" as `MERGED` into `owner-executive`, on the reasoning that *the `admin`
compatibility Role IS the Administrator authority* and a second Principal holding the same Role would
prove nothing new about authority. The P01/P02 split below is therefore the **proposed** contract,
which is precisely the Owner-vs-Administrator question §12 answers. The same fixture records
Finance / Accounting as **BLOCKED** (`SAMPLE_COMPANY_V3_REQUIRED` + `FINANCIALS_DOMAIN_BLOCKED`) and
Reporting / Read-Only as **BLOCKED** (`SAMPLE_COMPANY_V3_REQUIRED` + `REPORTING_DOMAIN_BLOCKED`).

Two further measured Employees carry no Principal and are themselves **proofs rather than gaps**:
**Quinn** (records-clerk, ACTIVE, 0 principals) is the *Employee ≠ Principal* control, and **Peyton**
(`synthetic-np-emp-technician-on-leave`, ON_LEAVE, 0 principals, and the only technician-titled Employee
with **no** SERVICE_TECHNICIAN eligibility row) is the *employment status governs eligibility* control.

Every Principal in the tenant is a synthetic fixture. Fourteen Employees carry a **pair** of Principals
— one Firebase-uid identity that signs in, one `synthetic-np-principal-*` that cannot — pointing at the
same Employee. That is why 30 Principals map to 29 links over 17 Employees; Avery is the only Employee
with a single Principal.

---

## 4. The A–N matrix

**J (Workflow Administration)** legend: `NONE` / `READ` / `DEFINE-EDIT` / `VERSION` / `BIND ROLE` /
`PUBLISH`. Measured: `workflowDefinition.read` → `admin`, `owner` only; all five `workflowDefinition`
mutations → **ZERO holders** by standing Owner hold. **No persona's J may exceed READ today, and the
proposed contract does not ask for more.**

**K (workflow execution on business records)** = the `workflow_role_bindings` rows the persona's Roles
carry. **No `owner` row appears in any of the 112 bindings.**

**M (application/navigation surfaces)** carries a defect that applies to **every** persona and is
stated once here rather than sixteen times: `field-ops-app-vite/src/navigation/navConfig.js` decides
navigation from `users/{uid}.role ∈ {admin, dispatcher, technician}` (`ROLES`, `constants.js:360`),
and the Sample Company login activation writes no such Firestore doc. So **every governed persona can
authenticate and call the EOS API and none of them can navigate the client**
(`GOVERNED_PERSONA_HAS_NO_CLIENT_ROLE`). The M column below therefore states the **governed
experience surface** each persona earns in `eosOps/experienceAuthority.ts` (29 entries: 28 surfaces +
1 container), which is the authority the client is meant to resolve against — not what the current
client renders. See D-25.

"North Star" is **not** a landing page: in this repository it is a per-surface design and acceptance
**standard** (`docs/north-star/VISUAL-SYSTEM.md`, DECISIONS #122/#123/#126/#127/#130). A scenario
asserting "persona X lands on its North Star" would assert something the product does not have.

---

### P01 — Owner / Executive · role `owner` (47 capabilities, 21 object rows, `privileged`)

| | |
|---|---|
| **A READ** | `account`, `auditLog`, `equipmentModel`, `inventoryAction`, `inventoryTransaction`, `invoice`, `manufacturer`, `opportunity`, `part`, `payment`, `purchaseOrder`, `reorderRequest`, `salesAgreement`, `salesOrder`, `serializedAssets`, `transferOrder`, `warehouse`, `workflowDefinition` — and **must also read** `employee`, `receivingOrder`, `rolesPermissions`, `workOrder`, which it currently cannot (D-03) |
| **B CREATE** | `account`, `inventoryAction`, `invoice`, `payment`, `purchaseOrder`, `reorderRequest`, `salesAgreement`, `salesOrder`, `transferOrder`, `workOrder` |
| **C EDIT** | `account`, `employee`, `inventoryAction`, `inventoryTransaction`, `invoice`, `opportunity`, `part`, `payment`, `receivingOrder`, `rolesPermissions`, `salesAgreement`, `salesOrder`, `transferOrder`, `workOrder` |
| **D ACTIONS** | read the audit log (`audit.event.read`); read the security-policy configuration (`admin.securityPolicy.read`); read one Principal's effective access (`admin.principalAccess.read`); read a workflow definition (`workflowDefinition.read`); `finance.invoice.issue`, `finance.payment.apply`, `finance.adjustment.record`, `finance.refund.record`, `finance.visibility.consolidated`; author, approve, supersede and retire performance goals |
| **E MUST NOT** | **Complete a Work Order.** Completion asserts the work was done and is bound to the assigned Employee; an Owner who could complete anybody's job is a second, unbound way to make that assertion. **Dispatch or cancel a Work Order** — the five-row ruling of 2026-09-23 excluded `owner` explicitly, and that exclusion is correct. No operational Work Eligibility, no warehouse Operational Scope, no `field.myWorkOrders`, and not both cycle-count submitter and reconciler |
| **F Functional Roles** | none beyond `owner` |
| **G Work Eligibility** | **NONE — and that is a proof.** The broadest Security Role in the tenant must confer no operational qualification (`ADMIN_IMPLIES_NO_WORK_ELIGIBILITY`) |
| **H Operational Scope** | **NONE required** |
| **I Assignment / ownership** | none required, except `isOwnAssignment` on `reorder.purchaseOrder.void` |
| **J Workflow Admin** | **READ.** DEFINE-EDIT / VERSION / BIND ROLE / PUBLISH stay at ZERO, Owner-held |
| **K Workflow execution** | **NONE** — measured, and proposed to stay NONE. The Owner authorizes the definition; executing somebody's transition is a different act |
| **L Admin surfaces** | all 7: `overview`, `objects`, `rolesPermissions`, `users`, `workflows`, `permissionPreview`, `auditLogs` |
| **M Experience surfaces** | `crm.accounts`, `commercial.opportunities`, `commercial.salesOrders`, `inventory.catalog`, `inventory.catalogAdmin`, `inventory.balances`, `inventory.transfers`, `inventory.reorderQueue`, `purchasing.purchaseOrders`, `financials.invoices`, `financials.payments`, `service.workOrders`, `administration.*`. **Not** `field.myWorkOrders`, `inventory.cycleCount.*`, `warehouse.*` |
| **N Rationale** | The proprietor must be able to see every part of the business, and to see who can do what. Seeing is not doing: the Owner authorizes the model and does not execute inside it |

**Defects:** D-01 `IDENTITY_DEFECT` · D-02 `SECURITY_ROLE_DEFECT` · D-03 `OBJECT_AUTHORITY_DEFECT`.

---

### P02 — Administrator · role `admin` (66 capabilities, 34 object rows, `protected`, `privileged`)

| | |
|---|---|
| **A READ** | all 34 objects admin carries a row for — the widest read in the tenant, and the only Role among the twelve examined that can read `workOrder` |
| **B CREATE** | `account`, `employee`, `inventoryAction`, `invoice`, `payment`, `purchaseOrder`, `reorderRequest`, `salesAgreement`, `salesOrder`, `transferOrder`, `workOrder` |
| **C EDIT** | the 14 objects admin holds edit on, incl. `rolesPermissions`, `employee`, `opportunity`, `part`, `receivingOrder` |
| **D ACTIONS** | **security-policy administration, which is the whole persona:** `admin.roleAssignment.write`, `admin.userStatus.write`, `admin.accessRequest.decide`, `admin.credentialReset.initiate`, `admin.employeeProfile.write`, `admin.employeeJobRole.write`, `admin.employeeWorkEligibility.write`, `admin.employeeOperationalScope.write`, `admin.securityPolicy.read`, `admin.principalAccess.read`, `admin.dataImport.stage` / `.execute`, `customer.governedField.write` |
| **E MUST NOT** | **Complete a Work Order** — measured: admin does **not** hold `workOrder.lifecycle.complete`, and that absence is `INTENTIONAL_DENIAL`, to be preserved. No operational Work Eligibility. Recorded SoD exception to revisit: admin holds cycle-count `create`, `submit` **and** `reconcile`, so an admin can reconcile a count they submitted (D-20) |
| **F Functional Roles** | none — admin derives the whole `permissionCatalog`. Note this derivation reaches **no** PostgreSQL-only key (§1.1) |
| **G Work Eligibility** | **NONE** |
| **H Operational Scope** | **NONE required.** Measured: Avery holds REORDER_QUEUE:`taylor`, seeded by `migration:1761696000000`. Proposed: withdraw |
| **I Assignment / ownership** | required for `reorder.purchaseOrder.void` — even an Administrator must be the recorded assignee, because `firestore.rules` double-gates Void with `isAdminOrDispatcher() AND request.auth.uid == resource.data.assignedToUserId` |
| **J Workflow Admin** | **READ** |
| **K Workflow execution** | bound in all 5 workflows — and **correctly not** bound to `Accept`, `Travel`, `Arrive`, `WorkStart`, `Complete`, which are `technician`-only. The binding set already honours the completion SoD |
| **L Admin surfaces** | all 7 |
| **M Experience surfaces** | every surface whose capability path admin holds; **not** `field.myWorkOrders` (no eligibility), **not** `inventory.cycleCount.*` or `warehouse.*` (no WAREHOUSE scope) |
| **N Rationale** | Administrator is **security-policy administration**, not business authority. It decides who may do what; it does not assert that work happened |

---

### P03 — General Manager · role `generalManager` (31 capabilities, 15 object rows)

| | |
|---|---|
| **A READ** | `account`, `auditLog`, `employee`, `equipmentModel`, `invoice`, `payment`, `opportunity`, `salesAgreement`, `salesOrder`, `part`, `manufacturer`, `serializedAssets`, `inventoryAction`, `inventoryTransaction`, `reorderRequest`, `purchaseOrder`, `warehouse`, `transferOrder` |
| **B CREATE** | `account`, `workOrder`, `purchaseOrder`, `salesAgreement`, `salesOrder`, `invoice`, `payment`, `inventoryAction`, `transferOrder` |
| **C EDIT** | `account`, `opportunity`, `part`, `salesAgreement`, `salesOrder`, `invoice`, `payment`, `inventoryTransaction`, `transferOrder` |
| **D ACTIONS** | issue invoice, apply payment, record adjustment, record refund, consolidated financial reach, read the audit log, read employee records, convert Opportunity → Sales Order, author/approve/supersede/retire performance goals |
| **E MUST NOT** | **any `admin.*` capability.** Measured and pinned: `generalManager` resolves zero `admin.*`. The canonical CRUD workbook granted GM create/read/edit/delete on Users and Roles & Permissions; implementing that literally would make a non-privileged Role hold `admin.roleAssignment.write` — a self-escalation path, since a GM could grant themselves `owner` through the ordinary path rather than the privileged two-person one. Also must not complete a Work Order, and must hold no operational Work Eligibility |
| **F Functional Roles** | none |
| **G Work Eligibility** | NONE |
| **H Operational Scope** | NONE |
| **I Assignment / ownership** | none |
| **J Workflow Admin** | **NONE**, and proposed to stay NONE |
| **K Workflow execution** | **NONE measured** — `generalManager` appears in none of the 112 bindings, so the GM holds `workOrder.transition` and `salesOrder.write` and can execute no transition (D-08) |
| **L Admin surfaces** | `overview`, `auditLogs` |
| **M Experience surfaces** | `crm.accounts`, `commercial.opportunities`, `commercial.salesOrders`, `inventory.catalog`, `inventory.catalogAdmin`, `inventory.balances`, `inventory.transfers`, `purchasing.purchaseOrders`, `financials.invoices`, `financials.payments`, `service.workOrders`, `administration.users` (via `employee.record.read`), `administration.auditLogs` |
| **N Rationale** | The highest broad **business** Role and deliberately not security administration. Business oversight across every branch; access administration stays with Owner and Administrator |

---

### P04 — Service Manager · role `fieldManager` (13 capabilities, 10 object rows)

| | |
|---|---|
| **A READ** | `account`, `auditLog`, `part`, `manufacturer`, `serializedAssets`, `inventoryTransaction`, `invoice`, `payment`, `salesOrder`, coordinated visits |
| **B CREATE** | Work Order |
| **C EDIT** | `part` (catalog curation via `inventory.catalog.manage`) |
| **D ACTIONS** | `workOrder.create`, `workOrder.transition`, curate the Part/Manufacturer catalog, `fulfillment.coordinatedVisit.read`, read the audit log, author/approve/supersede/retire service-team performance goals |
| **E MUST NOT** | `inventory.catalog.activate` — creating and correcting reference data is a different authority from changing its lifecycle status, which stays with `inventoryCatalogAdministrator`. No `admin.*`. No financial execution (`finance.invoice.issue`, `payment.apply`, `adjustment.record`, `refund.record` — measured absent, keep). Must not complete a Work Order |
| **F Functional Roles** | none required; `equipmentCatalogAdministrator` optional per employee |
| **G Work Eligibility** | **NONE.** A Service Manager schedules field work; they do not perform it. If a particular Service Manager also works in the field, SERVICE_TECHNICIAN is granted to that **Employee**, never to the Role |
| **H Operational Scope** | NONE |
| **I Assignment / ownership** | none for oversight |
| **J Workflow Admin** | **NONE** |
| **K Workflow execution** | **NONE measured** — the Service Manager can neither `MarkReady`, `Schedule`, `Dispatch` nor `Close` |
| **L Admin surfaces** | `overview`, `auditLogs` |
| **M Experience surfaces** | `service.workOrders`, `service.coordinatedVisits`, `crm.accounts`, `inventory.catalog`, `inventory.catalogAdmin`, `inventory.balances`, `commercial.salesOrders`, `financials.invoices`, `financials.payments`, `administration.auditLogs` |
| **N Rationale** | Runs the service department: opens work, moves it forward, watches the board, and fixes a wrong Part record rather than escalating it. **The measured authority does not match that job** — see D-04 |

---

### P05 — Dispatcher · role `dispatcher` (29 capabilities, 14 object rows)

| | |
|---|---|
| **A READ** | `account`, `workOrder`, `reorderRequest`, `purchaseOrder`, `warehouse`, `stockLocation`, `transferOrder`, `part`, `manufacturer`, `inventoryTransaction`, `inventoryAction`, inventory analytics, `opportunity`, `salesOrder`, `salesAgreement`, coordinated visits |
| **B CREATE** | `account`, `workOrder`, Reorder Request (**manual and system**), `purchaseOrder`, `inventoryAction`, `salesAgreement`, `salesOrder` |
| **C EDIT** | `account`, `opportunity`, `salesOrder`, `salesAgreement` |
| **D ACTIONS** | **`workOrder.lifecycle.dispatch` and `workOrder.lifecycle.cancel`** — the two capabilities that define this persona; `inventory.stock.receive`; the full Reorder Request verb set incl. `approve`, `reject`, `cancel`; `reorder.purchaseOrder.void` **only when the recorded assignee** |
| **E MUST NOT** | `customer.governedField.write` (Issue #175, withheld from dispatcher — keep). `audit.event.read` — measured absent; reading the audit log is management visibility and Dispatch is not management (keep). Any `admin.*` — *"the Users directory is visible to more people than another person's account status and Role assignments should be"* (Owner ruling 2026-09-06 §3). Any `finance.*` — measured absent, keep. **Complete** a Work Order. **And the commercial spine** — below |
| **F Functional Roles** | `crmActivityContributor` already held by its own governed assignment; `serviceInboundWorkReviewer` proposed per employee |
| **G Work Eligibility** | **NONE — deliberately.** The dispatcher persona holds `reorder.request.read` **and** a REORDER_QUEUE scope and still has no PARTS_OPERATIONS qualification. Any action declaring a `WORK_ELIGIBILITY` predicate must refuse them. That is the `CAPABILITY_WITHOUT_ELIGIBILITY` proof and must be preserved |
| **H Operational Scope** | REORDER_QUEUE:`taylor` — required, because Dispatch triages the shared queue |
| **I Assignment / ownership** | required for `reorder.purchaseOrder.void` |
| **J Workflow Admin** | **NONE** |
| **K Workflow execution** | `workOrder` v1: `MarkReady`, `Schedule`, `Unschedule`, `Dispatch`, `Close`, and all 8 `CancelFrom*`. `partsPurchasing` v1: `approve`, `reject`. **Not** `Accept`/`Travel`/`Arrive`/`WorkStart`/`Complete` |
| **L Admin surfaces** | `overview` only |
| **M Experience surfaces** | `service.workOrders`, `service.dispatch`, `service.coordinatedVisits`, `crm.accounts`, `inventory.catalog`, `inventory.balances`, `inventory.transfers`, `inventory.reorderQueue`, `purchasing.purchaseOrders`, `receiving.checkIn`. **Not** `warehouse.management` — no WAREHOUSE scope |
| **N Rationale** | Dispatch owns the board: it decides which technician goes where and when, and it triages the reorder queue. It does not own the money and it does not own the customer master |

**Separation-of-duties finding (D-18).** `dispatcher` holds `opportunity.write`,
`opportunity.createSalesOrder`, `salesOrder.write`, `salesOrder.fulfill`, `salesOrder.service`, and all
four `salesAgreement.*`. No Taylor responsibility requires a Dispatcher to accept a Sales Agreement or
convert an Opportunity. These reached Dispatch through
`SHARED_ADMIN_DISPATCHER_BASE_PERMISSIONS`, a shared list, not a business ruling. Pre-classified
`DO_NOT_GRANT — violates separation of duties`; recommended for **withdrawal**, which is a reviewed
Owner decision and not this lane's to make.

---

### P06 — Service Technician, ASSIGNED · role `technician` (3 capabilities, 3 object rows)

| | |
|---|---|
| **A READ** | `purchaseOrder`, `reorderRequest` — and **must also read** `workOrder`, which it currently cannot (D-05). Proposed baseline adds part identity, part alias, stock balance and bin display |
| **B CREATE** | nothing required at baseline. `purchaseOrder` create exists on the Object row and is **not** matched by a capability (D-06) |
| **C EDIT** | their own Work Order's lifecycle state, and nothing else |
| **D ACTIONS** | `workOrder.transition` — the only **unconditioned** technician permission, because the specific forward/backward direction is decided by `transitionEngine.ts`'s own `ACTION_PERMISSIONS` table and the fixed ConditionKind set has no action-direction predicate; **`workOrder.lifecycle.complete`**, narrowed by `RECORD_ASSIGNMENT / ASSIGNED_EMPLOYEE`; `reorder.request.read` |
| **E MUST NOT** | dispatch or cancel a Work Order. Approve, reject, cancel or **void** a Reorder Request or Purchase Order — `reorder.purchaseOrder.void` is deliberately not granted to `technician` at all, and *"no operational role gets Approve/Reject/Cancel/Void."* Read the shared reorder queue. Read a Customer record. Read the audit log. Correct **another** person's labor |
| **F Functional Roles** | see §5. Proposed **REQUIRED_FOR_EVERY_TECH**: `technicianLaborRecorder`, `inventoryLookupReader`. **ASSIGN_PER_EMPLOYEE**: `equipmentInstaller`, `workOrderPartsPlanner`, `inventoryTransferReceiver`. **NEVER**: `workOrderLaborCorrector` |
| **G Work Eligibility** | **SERVICE_TECHNICIAN — required.** `field.myWorkOrders` is earned by `workOrder.transition` **plus** this qualification; the capability alone does not open it, *"because the governed model says field work needs the SERVICE_TECHNICIAN qualification, and that is a different authority from the Role"* |
| **H Operational Scope** | **NONE — and REORDER_QUEUE is deliberately withheld.** Technician A reaches their **own** reorder request through an active assignment and must still be refused the shared queue. That is the `ASSIGNMENT_IS_NOT_SCOPE` proof |
| **I Assignment / ownership** | **REQUIRED, and it is the whole persona.** `RECORD_ASSIGNMENT / ASSIGNED_EMPLOYEE`, compared Employee-id to Employee-id server-side via the Principal's ACTIVE governed Employee link. A Principal with no active link is refused `EMPLOYEE_LINK_REQUIRED`, never matched. The relation reads `eos_ops.work_order_assignments.assignee_employee_id` with `effective_to IS NULL` baked in, because an ENDED assignment is not a current one |
| **J Workflow Admin** | **NONE** |
| **K Workflow execution** | `workOrder` v1: `Accept`, `Travel`, `Arrive`, `WorkStart`, `Complete` — **all five with `requires_own_assignment = true`.** The workflow narrows the persona to their own record; it grants nothing |
| **L Admin surfaces** | **none** — not even `auditLogs` |
| **M Experience surfaces** | `field.myWorkOrders` — the only one earned today. Proposed: `inventory.catalog` and `inventory.balances` via `inventoryLookupReader` |
| **N Rationale** | A technician does the work and says when it is done. Everything they touch is a record they are assigned. Nothing about their authority is a statement about anybody else's work |

---

### P07 — Service Technician, UNASSIGNED · role `technician`

Identical to P06 on **A–H, J, L, M** — same Role, same 3 capabilities, same SERVICE_TECHNICIAN
qualification, no scope. The **only** difference is **I**, and that is the point: Gray is seeded
identically to Finley *"so that every difference between them is a RECORD relationship and never a
qualification."*

| | |
|---|---|
| **E MUST NOT** | complete, accept, travel to, arrive at or start work on a Work Order they are not assigned |
| **I Assignment** | **NONE — the negative control.** Expected refusals: `workOrder.lifecycle.complete` → `NOT_ASSIGNED` (predicate `RECORD_ASSIGNMENT`); the five `workOrder` workflow actions → `notOwnAssignment` |
| **K Workflow execution** | bound to the same five actions and **refused on all five**, because a missing assignee is a **refusal, not a pass** — *"treating an absent value as a match is how an own-assignment gate becomes a no-op on exactly the records that never got assigned"* |
| **N Rationale** | Proves the assignment gate is real. A technician with every qualification and the exactly correct Role still reaches nothing they are not assigned |

---

### P08 — Parts Associate · roles `partsAssociate` + `inventoryReceivingClerk` (10 + 1 capabilities, 9 object rows)

| | |
|---|---|
| **A READ** | `account`, `part`, `manufacturer`, `serializedAssets`, `inventoryTransaction`, `invoice`, `payment`, `salesOrder` — and **must also read** `workOrder`, which it currently cannot (D-05) |
| **B CREATE** | Work Order (counter job); receive stock against a receiving order |
| **C EDIT** | Work Order lifecycle state |
| **D ACTIONS** | `workOrder.create`, `workOrder.transition`, `inventory.stock.receive`, catalog and stock lookup, read invoice/payment for a counter sale |
| **E MUST NOT** | **read the shared Reorder Queue.** Measured: `partsAssociate` holds **no** `reorder.*` capability, and Logan holds **no** Operational Scope of any kind. **That double absence is a proof, not a gap.** Also must not: assign a Reorder Request; approve, reject or cancel one; **void** a Purchase Order — explicitly not extended to PARTS_ASSOCIATE *"even though it is already the assignee"*; curate the canonical catalog (`inventory.catalog.manage`); issue an invoice; reconcile a cycle count |
| **F Functional Roles** | `inventoryReceivingClerk` held — receiving is a distinct authority from parts counter work. `inventoryLookupReader` and `inventoryPutAwayOperator` are recorded `COMPOSE_BY_DEFAULT` into `partsAssociate`; `inventoryReturnsIntakeClerk` is `KEEP_STANDALONE` |
| **G Work Eligibility** | **PARTS_OPERATIONS — required**, and held. Registered in its own right by migration `1761696000000` and deliberately **not** mapped onto WAREHOUSE_OPERATIONS: *"that is a different kind of work, and the ruling forbids the substitution"* |
| **H Operational Scope** | **NONE, deliberately.** Shared-queue oversight is the Parts Manager's responsibility, not the associate's. Do **not** grant REORDER_QUEUE to make a scenario pass |
| **I Assignment / ownership** | **REQUIRED** for every execution step on a Reorder Request: assigned work only, never the queue |
| **J Workflow Admin** | **NONE** |
| **K Workflow execution** | `partsPurchasing` v1: `startPurchasing` (**`requires_own_assignment = true`**), `postPurchasingUpdate`, `recordPurchaseOrder`, `markReceived`. **None of those four has a matching eos_policy capability** — §9 shows why they still create nothing |
| **L Admin surfaces** | none |
| **M Experience surfaces** | `inventory.catalog`, `inventory.balances`, `receiving.checkIn`, `service.workOrders`. **Not** `inventory.reorderQueue` |
| **N Rationale** | The associate executes the purchasing work **assigned to them** and receives what arrives. Watching the whole queue and deciding who works what is the manager's job. Separating assigned execution from shared oversight is the entire design of this persona |

---

### P09 — Parts Manager / Purchasing · roles `partsManager` + `purchasingManager` (16 + 13 capabilities, 11 object rows)

| | |
|---|---|
| **A READ** | `account`, `auditLog`, `part`, `manufacturer`, `serializedAssets`, `inventoryTransaction`, `inventoryAction`, `reorderRequest`, `purchaseOrder`, `transferOrder`, `invoice`, `payment`, `salesOrder` |
| **B CREATE** | Reorder Request (manual), **Purchase Order**, Work Order, Invoice |
| **C EDIT** | `part` (catalog curation), `invoice`, Work Order lifecycle |
| **D ACTIONS** | `reorder.request.read` on the shared queue; `reorder.request.create.manual`; **`reorder.purchaseOrder.create`** and `.read`; `reorder.request.startPurchasing` / `postPurchasingUpdate` / `recordPurchaseOrder` / `markReceived`; `inventory.catalog.manage`; `audit.event.read`; `finance.invoice.issue`; author and approve performance goals |
| **E MUST NOT** | **record a financial adjustment.** Measured: `partsManager` holds `finance.adjustment.record` while holding neither `finance.payment.apply` nor `finance.refund.record` — an asymmetry with no Taylor responsibility behind it (D-19). Also must not: administer Security Roles; `inventory.catalog.activate` (admin only); reconcile a cycle count |
| **F Functional Roles** | the composition **is** the answer: `partsManager` (queue + manual request + catalog curation + audit read + invoice issue) **plus** `purchasingManager` (`reorder.purchaseOrder.create` / `.read`, `warehouse.transferOrder.read`, `inventory.action.read`). Neither alone is a purchasing persona. `inventoryLookupReader` is recorded `COMPOSE_BY_DEFAULT` into `partsManager` |
| **G Work Eligibility** | **PARTS_OPERATIONS — required**, and held. Reorder assignment is fixed by the operation to `PARTS_OPERATIONS` — *"not a caller input and not configurable: a client that could choose the qualification could choose one nobody needs"* |
| **H Operational Scope** | **REORDER_QUEUE:`taylor` — required**, and held. This is the persona that legitimately holds it. `REORDER_QUEUE` answers *which queue may they see*; PARTS_OPERATIONS answers *may they be given this category of work*; the two are never collapsed |
| **I Assignment / ownership** | required for `reorder.purchaseOrder.void` only |
| **J Workflow Admin** | **NONE** |
| **K Workflow execution** | `partsPurchasing` v1: `approve`, `reject`, `assign`, `cancelFromReady`, `cancelFromAssigned`, `cancelFromPurchasing`, `postPurchasingUpdate`, `recordPurchaseOrder`, `markReceived`, `voidPurchaseOrder` |
| **L Admin surfaces** | `overview`, `auditLogs` |
| **M Experience surfaces** | `inventory.reorderQueue`, `purchasing.purchaseOrders`, `inventory.catalog`, `inventory.catalogAdmin`, `inventory.balances`, `crm.accounts`, `financials.invoices`, `financials.payments`, `service.workOrders`, `administration.auditLogs` |
| **N Rationale** | Owns the shared queue and the supplier relationship: decides what gets bought, who works it, and when it is received. Purchasing authority is composed from two Roles on purpose, so *"may raise a request"* and *"may commit the company to a supplier"* stay separable per employee |

**Purchasing composition, confirmed as measured.** `reorder.purchaseOrder.read` has **11** holders —
`accountingManager, admin, controller, dispatcher, financeManager, generalManager, operationsManager,
owner, purchasingManager, warehouseAssociate, warehouseManager`. `reorder.purchaseOrder.create` has
**5** — `admin, dispatcher, generalManager, owner, purchasingManager`. **`technician` is absent from
both.** `partsManager` itself does not hold `.create`; it comes from `purchasingManager`.

The technician's two Purchase Order cells are **withheld by standing ruling**, and the withholding is
named as data: `functions/src/eosOps/grantConditionPolicy.ts` declares

```ts
export const WITHHELD_CONDITIONED_CELLS: readonly string[] = Object.freeze([
  "reorder.purchaseOrder.read",
  "reorder.purchaseOrder.create",
]);
```

— exactly two cells, both on `ROLE:technician`, both `WORK_ELIGIBILITY(PARTS_OPERATIONS)`-shaped,
enforced at **two** points: `actionContextRegistry` throws for these keys in **any** registry including
a test one, and `assertNoWithheldGrantConditions` guards the production grant entry point. The reason is
stated: an action-level predicate *"would impose the technician's condition on the ELEVEN Roles the
Owner left unconditioned … a narrowing of grants nobody asked to narrow."* The underlying Kind,
`operationalRoleActive`, is classified `BUSINESS_ELIGIBILITY_SCOPE` and **must never become a
PostgreSQL Condition** — `capability_grant_conditions` = 0 rows, measured.

---

### P10 — Warehouse Associate · roles `warehouseAssociate` + `inventoryCycleCountCounter` (8 + 3 capabilities, 8 object rows)

| | |
|---|---|
| **A READ** | `inventoryAction`, `inventoryTransaction`, `manufacturer`, `part`, `purchaseOrder`, `salesOrder`, `serializedAssets`, `transferOrder` — **all eight read-only** |
| **B CREATE** | a cycle count |
| **C EDIT** | **nothing.** The `warehouseAssociate` Object matrix carries zero edit rows |
| **D ACTIONS** | `inventory.cycleCount.create`, `.submit`, `.cancel`; record placement and pick within their warehouse; read their own performance goal |
| **E MUST NOT** | **`inventory.cycleCount.reconcile`.** The person who counted must not be the person who accepts the variance — the pair is declared `SOD_EXCLUSIVE` (DECISIONS #111). Measured: this persona holds neither `reconcile` nor any edit row anywhere. Also must not: raise a Reorder Request; create, dispatch or cancel a Transfer Order; curate the catalog; read a Customer record; read the audit log; author anybody's performance goal |
| **F Functional Roles** | `inventoryCycleCountCounter` held (`KEEP_STANDALONE`). `inventoryLookupReader` and `inventoryPutAwayOperator` are recorded `COMPOSE_BY_DEFAULT` into `warehouseAssociate`; `inventoryStockRelocationOperator` and `inventoryTransferReceiver` are `KEEP_STANDALONE`, per employee |
| **G Work Eligibility** | **WAREHOUSE_OPERATIONS — required**, and held |
| **H Operational Scope** | **WAREHOUSE:`SC-WH-MAIN` only.** `SC-WH-SERVICE` is **deliberately withheld** so one persona proves both the positive and the negative without a second login: same Role, same capability, same qualification, different warehouse → `OUTSIDE_OPERATIONAL_SCOPE` |
| **I Assignment / ownership** | none — a counter counts what is in their warehouse, not what is assigned to them |
| **J Workflow Admin** | **NONE** |
| **K Workflow execution** | **NONE** |
| **L Admin surfaces** | none |
| **M Experience surfaces** | `inventory.cycleCount.count` (earned: capability + WAREHOUSE_OPERATIONS + WAREHOUSE scope), `inventory.balances`, `inventory.catalog`, `warehouse.picking`. **Not** `inventory.cycleCount.review` |
| **N Rationale** | Counts and moves physical stock in the one warehouse they are scoped to. Read-only everywhere else, because touching a number is a different authority from reporting one |

---

### P11 — Warehouse Manager · roles `warehouseManager` + `inventoryBinAdministrator` + `inventoryCycleCountReconciler` (12 + 0 + 1 capabilities, 11 object rows)

| | |
|---|---|
| **A READ** | `account`, `auditLog`, `inventoryAction`, `inventoryTransaction`, `manufacturer`, `part`, `purchaseOrder`, `salesOrder`, `serializedAssets`, `transferOrder` — and **must also read** `reorderRequest`, which it currently cannot (D-07/D-05) |
| **B CREATE** | **Reorder Request (manual)** |
| **C EDIT** | `part` (catalog curation) |
| **D ACTIONS** | **`inventory.cycleCount.reconcile`** — accept or refuse the variance; `reorder.request.create.manual` **at location scope only**; `inventory.catalog.manage`; administer bins; `audit.event.read`; author and approve warehouse-location performance goals |
| **E MUST NOT** | **`inventory.cycleCount.create` / `.submit` / `.cancel`.** Measured: this persona holds none of the three — the counter Role is Noor's. **This is the separation of duties, held by two different Employees, and it is measured rather than asserted.** Also declared `SOD_EXCLUSIVE`: `inventoryBinAdministrator` ↔ `inventoryPutAwayOperator`. Must not: create or void a Purchase Order; administer Security Roles; issue an invoice; read the shared reorder queue |
| **F Functional Roles** | `inventoryCycleCountReconciler` (the reconciling authority, deliberately its own Role holding exactly one capability) and `inventoryBinAdministrator` — both `KEEP_STANDALONE`. `inventoryLookupReader` is `COMPOSE_BY_DEFAULT` into `warehouseManager` |
| **G Work Eligibility** | **WAREHOUSE_OPERATIONS — required**, and held |
| **H Operational Scope** | **WAREHOUSE:`SC-WH-MAIN` and `SC-WH-SERVICE`** — the reconciling manager covers both sites, and two current rows for one Employee prove several warehouses may be held at once. `scopesByPermission` additionally restricts `reorder.request.create.manual` and `inventory.transaction.read` on this Role to a `location`-scoped assignment, so a manager scoped to `wh-north` is refused `wh-south` by the same value match. **Scope is declared on the binding, not the capability** — `inventory.transaction.read` is carried by 18 Roles, every other one legitimately global |
| **I Assignment / ownership** | none |
| **J Workflow Admin** | **NONE** |
| **K Workflow execution** | **NONE measured** |
| **L Admin surfaces** | `overview`, `auditLogs` |
| **M Experience surfaces** | `inventory.cycleCount.review`, `warehouse.management`, `warehouse.picking`, `inventory.balances`, `inventory.catalog`, `inventory.catalogAdmin`, `inventory.transfers`, `purchasing.purchaseOrders`, `administration.auditLogs`. **Not** `inventory.cycleCount.count` |
| **N Rationale** | Runs one or more warehouses: accepts the variance somebody else counted, keeps the bin map right, and raises replenishment for the sites they cover. Counting and accepting the count are two jobs, and this persona holds exactly one of them |

**Measured gap (D-15):** `inventoryBinAdministrator` carries **ZERO** capabilities in `eos_policy` —
`inventory.location.bin.manage` and `.read` are not among the 76. Morgan's bin administration is inert.

---

### P12 — Retail Sales · role `salesperson` (17 capabilities, 9 object rows)

| | |
|---|---|
| **A READ** | `account`, `opportunity`, `salesAgreement`, `salesOrder`, `invoice`, `payment`, `part`, `manufacturer`, `inventoryTransaction` |
| **B CREATE** | `account`, `salesAgreement`, `salesOrder` |
| **C EDIT** | `account`, `opportunity`, `salesAgreement`, `salesOrder` |
| **D ACTIONS** | `opportunity.write`, `opportunity.createSalesOrder`, `salesAgreement.create` / `.updateDraft` / `.accept` / `.read`, `salesOrder.write`, `customer.record.create` / `.update`, `performance.goal.read`, `finance.visibility.self` |
| **E MUST NOT** | `customer.governedField.write` — governed commercial fields (payment terms, tax status, credit) are Finance's. `audit.event.read` — measured absent, and it is the **single** difference from `salesManager` at the object layer. No financial execution: no invoice issue, no payment apply, no adjustment, no refund. No `finance.visibility.team` or `.consolidated`. **No performance-goal write verb** — *"if both Roles held the write verbs, a salesperson could author their own quota"* |
| **F Functional Roles** | `crmActivityContributor` is recorded `COMPOSE_BY_DEFAULT` into `salesperson` |
| **G Work Eligibility** | **NONE.** Selling is not operational field/parts/warehouse work |
| **H Operational Scope** | **NONE** |
| **I Assignment / ownership** | **REQUIRED, and it is the real discriminator** — account ownership plus `finance.visibility.self`, never a Role difference |
| **J Workflow Admin** | **NONE** |
| **K Workflow execution** | `salesOpportunity` v1: all 13 actions (`advanceToQualifying` → `advanceToSolution` → `advanceToQuoting` → `advanceToCustomerReview` → `advanceToDecision` → `win`, plus every `loseFrom*`). `salesAgreement` v1: `accept`, `decline` |
| **L Admin surfaces** | `overview` only |
| **M Experience surfaces** | `crm.accounts`, `commercial.opportunities`, `commercial.salesOrders`, `inventory.catalog`, `inventory.balances`, `financials.invoices`, `financials.payments`. Declared **gaps** their fixture North Star names and the vocabulary cannot express: `crm.contacts`, `commercial.agreements`, `dashboard.myPipeline` |
| **N Rationale** | Sells to walk-in and local trade customers, owns their own accounts and their own pipeline, and sees their own commercial numbers and nobody else's |

**Recorded governance gap carried forward, not closed here.** `salesAgreement.accept` is held by
`salesperson`, and *"there is no approval-limit or discount-authority model in this repo, so acceptance
is all-or-nothing per role and a Salesperson may bind the same terms a General Manager can. That is a
real governance gap to close deliberately."*

---

### P13 — National Accounts Sales · role `salesperson` (17 capabilities) — **identical**

**A–H, J, K, L, M are byte-identical to P12, and that is the deliverable, not an omission.**

| | |
|---|---|
| **E MUST NOT** | hold a Security Role that differs from Retail Sales. Explicitly: **do not create a `nationalAccountsSalesperson` Role.** *"A Role per channel multiplies every time a channel is added, and there are already three."* |
| **I Assignment / ownership** | the **only** legitimate differentiator, in four forms: (1) `salesChannel` on the record — `SALES_CHANNELS = ["NATIONAL_ACCOUNTS", "RETAIL", "STRATEGIC_ACCOUNTS"]`, declared identically on `Opportunity` and `SalesOrder`; (2) account ownership and segmentation; (3) Job Role, for presentation and org position; (4) reporting and `finance.visibility.*` reach |
| **N Rationale** | Which market a deal belongs to is a property of the **deal**, not of the person. If a national-accounts salesperson must be unable to see retail deals, that is channel-scoped visibility — a record-population and reporting model, never a fake Security Role difference |

---

### P14 — Finance / Accounting · roles `controller` / `accountingManager` / `financeManager` (17 capabilities each, 13 object rows each, **0 holders each**)

| | |
|---|---|
| **A READ** | `account`, `auditLog`, `invoice`, `payment`, `opportunity`, `salesOrder`, `purchaseOrder`, `transferOrder`, `part`, `manufacturer`, `serializedAssets`, `inventoryAction`, `inventoryTransaction`, and the financial policy profile |
| **B CREATE** | `invoice`, `payment` |
| **C EDIT** | `invoice`, `payment`; `account` for `accountingManager` / `financeManager` — **not** for `controller`, the sole discriminator among the three anywhere in the policy model |
| **D READ authority** | `finance.invoice.read`, `finance.payment.read`, `finance.read` (the AR fact-family gate), `financialPolicy.profile.read`, `audit.event.read`, `finance.visibility.consolidated` (the **reach** — either the gate or the reach alone reads nothing; both are required) |
| **D EXECUTION authority** | `finance.invoice.issue`, `finance.payment.apply`, `finance.adjustment.record`, `finance.refund.record` — **four distinct capability ids, deliberately separable** |
| **E MUST NOT** | **`financialPolicy.profile.configure`.** Supplying or approving an accounting policy does not confer EOS configuration authority: the money Roles may **see** which costing method and recognition point govern their numbers and may not change them — configuration stays with admin/owner. Also must not: administer Security Roles; dispatch or complete a Work Order; curate the Part catalog |
| **F Functional Roles** | `reportFinanceViewer` proposed ASSIGN_PER_EMPLOYEE, for the 5 sensitive commercial field reads |
| **G Work Eligibility** | **NONE** |
| **H Operational Scope** | **NONE.** Financial reach is `finance.visibility.*`, a different axis from Operational Scope, and the two must never be substituted |
| **I Assignment / ownership** | none |
| **J Workflow Admin** | **NONE** |
| **K Workflow execution** | **NONE measured, and NONE proposed.** Finance books what happened; it does not advance somebody's business record |
| **L Admin surfaces** | `overview`, `auditLogs` |
| **M Experience surfaces** | `financials.invoices`, `financials.payments`, `crm.accounts`, `commercial.opportunities`, `commercial.salesOrders`, `purchasing.purchaseOrders`, `inventory.balances`, `administration.auditLogs` |
| **N Rationale** | Finance sees everything about the money and executes a narrow, named set of acts against it. **Read is broad by design; execution is narrow by design** — and that is exactly what the measurement shows |

**FINANCE READ vs EXECUTION, measured:**

| capability | holders | kind |
|---|---|---|
| `finance.invoice.read` | **14** | READ |
| `finance.payment.read` | **14** | READ |
| `finance.invoice.issue` | **7** | EXECUTION |
| `finance.adjustment.record` | **7** | EXECUTION |
| `finance.payment.apply` | **6** | EXECUTION |
| `finance.refund.record` | **6** | EXECUTION |

The separation is real and registered as six distinct ids: read is held twice as widely as execution.
Two problems sit on top of it — **no Principal holds any finance Role**, and
`eos_finance.invoices` / `payments` are both **0 rows**, so nothing about finance is exercisable.
`accountingManager` and `financeManager` are byte-identical; `controller` differs by one object-level
`can_edit` on `account`. That is recorded `INTENTIONAL_OVERLAP`: the business runs those positions over
the same responsibilities, and *"manufacturing a difference purely so the titles diverge would encode a
distinction the business has not made."*

---

### P15 — Reporting / read-only · roles `reportViewer` / `reportFinanceViewer` / `reportAuthor` (**0 eos_policy capabilities, 0 holders**)

| | |
|---|---|
| **A READ — least privilege, proposed** | `report.definition.read`, the four object reads `report.customer.read`, `report.contact.read`, `report.location.read`, `report.equipment.read`, and the **ordinary** field reads only: customer `name`/`status`/`relationshipTypes`/`tags`/`createdAt`; contact `name`/`role`/`customer`; location `name`/`address`/`customer`; equipment `name`/`status`/`identity`/`dates`/`customer`/`location`/`createdAt` |
| **B CREATE** | **nothing** |
| **C EDIT** | **nothing** |
| **D ACTIONS** | run a saved report definition and read its output. Nothing else |
| **E MUST NOT** | **the 10 sensitive field reads** — customer `billingAddress`, `externalIds`, `paymentTerms`, `taxStatus`, `accountOwner`, `notes`; contact `email`, `phone`; location `accessNotes`; equipment `notes`. **The 4 `report.definition` mutations** (`create`, `rename`, `duplicate`, `delete`) — authoring is `reportAuthor`, a separate Role assigned per employee. Every write on every business object. Any `admin.*`. Any lifecycle or workflow action |
| **F Functional Roles** | `reportFinanceViewer` (5 sensitive commercial field reads) and `reportAuthor` (3 definition mutations) are **both** ASSIGN_PER_EMPLOYEE and neither is baseline |
| **G Work Eligibility** | **NONE** |
| **H Operational Scope** | **NONE** |
| **I Assignment / ownership** | none — but row scope applies: a definition may be scoped to `ownAssignment`, which narrows the rows returned and grants nothing |
| **J Workflow Admin** | **NONE** |
| **K Workflow execution** | **NONE** |
| **L Admin surfaces** | `overview` only |
| **M Experience surfaces** | the reporting destinations only — client-gated on `REPORT_WAVE1_OBJECT_READ_CAPABILITIES` (`reporting/builder`) and `[report.definition.read]` (`reporting/savedReports`) |
| **N Rationale** | The cheapest and strongest negative control in the matrix: a persona whose **every** write is denied. Least privilege here means the ordinary fields and nothing sensitive, and reading a definition without being able to author one |

**Measured, and it is a hard block (D-10):** there are **ZERO `report.*` capabilities in
`eos_policy.capabilities`.** All 39 `report.*` ids exist only in `permissionCatalog.ts`, all registered
`active: false`, where `owner` is the **only** Role holding any of them; `reportViewer` /
`reportFinanceViewer` / `reportAuthor` carry 27 / 5 / 3 ids there and **0** capabilities in the governed
PostgreSQL model. The Reporting persona is not implementable in the governed model today.

---

### P16 — Restricted / no-authority negative control · role `generalEmployee` (**0 permissions by construction**)

| | |
|---|---|
| **A READ** | **nothing** |
| **B CREATE** | **nothing** |
| **C EDIT** | **nothing** |
| **D ACTIONS** | **nothing** |
| **E MUST NOT** | everything. Every object read, every create, every edit, every lifecycle action, every workflow action, every Administration surface, every navigation destination must refuse. `generalEmployee` carries zero permissions deliberately: *"grants no broad domain access by title alone is satisfied by an empty grant set, not by a narrowed-but-nonempty one"* |
| **F Functional Roles** | **none, and that is the persona** |
| **G Work Eligibility** | **NONE** |
| **H Operational Scope** | **NONE** |
| **I Assignment / ownership** | **NONE** |
| **J Workflow Admin** | **NONE** |
| **K Workflow execution** | **NONE** — bound to no action in any of the 112 bindings |
| **L Admin surfaces** | `overview` **only**, because `overview` requires no capability — it renders four static links and the deployment manifest. But `overview` is a **disjunction**: it is readable iff at least one non-overview surface is, so for this persona it too refuses. Every other Administration surface refuses outright |
| **M Experience surfaces** | **none** |
| **N Rationale** | The floor. If this persona can reach anything, the model has a hole. Its value is entirely in what it proves cannot happen |

**Measured (D-13):** no Principal holds `generalEmployee`, so the negative control cannot be exercised
at the login layer. The closest live analogue is the **disabled** `zz_nonprod_acceptance` assignment on
principal `639c1970…` — the only `disabled` assignment in the tenant. At the **Employee** layer the
control does exist and is real: **Quinn Fixture** (`synthetic-np-emp-records-clerk`, ACTIVE, 0
Principals, 0 Roles, 0 eligibility, 0 scopes) is the *Employee ≠ Principal* proof.

---

## 5. Technician functional-role split

Baseline `technician` authority, measured: **3 capabilities** — `workOrder.transition`,
`workOrder.lifecycle.complete` (narrowed by `RECORD_ASSIGNMENT / ASSIGNED_EMPLOYEE`), and
`reorder.request.read`. Object rows: `purchaseOrder`(C,R,–), `reorderRequest`(–,R,–),
`workOrder`(–,–,E).

**There is a governing decision file, and this section is written against it.**
`functions/scripts/governance/functionalRoleComposition.mjs` holds `FUNCTIONAL_ROLE_DECISIONS` (13
entries, projected into `docs/governance/role-capability-contract.json`) with the vocabulary
`COMPOSE_BY_DEFAULT` / `KEEP_STANDALONE` / `RETIRE_CANDIDATE`, under this rule:

> *"A business Role must not become an irreversible bundle of every authority its job title might ever
> need. 'Parts Manager' does not mean every parts permission. So the default answer here is
> KEEP_STANDALONE. **COMPOSE_BY_DEFAULT has to be earned: the work must be normal for EVERY employee
> holding that business role, not merely common.**"*

| functional Role | capability | eos_policy | recorded decision | **proposed for technician** |
|---|---|---|---|---|
| `technicianLaborRecorder` | `workOrder.labor.record` | role 0 caps; key **not registered** | **no entry recorded** | **REQUIRED_FOR_EVERY_TECH** |
| `inventoryLookupReader` | `inventory.balance.read`, `inventory.catalog.alias.read`, `inventory.serializedAsset.read`, `inventory.location.display.read` | role holds **1 of 4** (`serializedAsset.read`) | **COMPOSE_BY_DEFAULT** into `partsAssociate`, `partsManager`, `warehouseAssociate`, `warehouseManager` — **technician is not in that list** | **REQUIRED_FOR_EVERY_TECH** (extends the recorded set) |
| `equipmentInstaller` | `equipment.install` | role 0 caps; key held by `admin` only | **no entry recorded** | **ASSIGN_PER_EMPLOYEE** |
| `workOrderPartsPlanner` | `workOrder.parts.plan` | role 0 caps; key not registered in eos_policy | **KEEP_STANDALONE** | **ASSIGN_PER_EMPLOYEE** (agrees) |
| `inventoryTransferReceiver` | `inventory.transfer.receive` | role 0 caps; key held by `admin` only | **KEEP_STANDALONE** — *"Receive-only Transfer acceptance (e.g. a technician's truck). Functional grant, never implied by a technician title."* | **ASSIGN_PER_EMPLOYEE** (agrees) |
| `workOrderLaborCorrector` | `workOrder.labor.correct` | role 0 caps; key not registered | *(not a technician role)* | **NEVER to a technician** |

**The two REQUIRED_FOR_EVERY_TECH proposals are genuinely new and are stated as proposals, not as
restatements of a ruling:**

- **`technicianLaborRecorder`** — a technician who cannot record labor cannot be paid for the job and
  the job cannot be billed. Every Taylor technician records labor on every job; there is no Taylor
  technician for whom it is optional, which is exactly the *"normal for EVERY employee"* bar the
  governance file sets. **But no entry is recorded for this key at all**, and the file's default answer
  is `KEEP_STANDALONE`, so this needs a ratified entry rather than an assumption. Its own header already
  insists on the surrounding distinction: *"NEITHER IS THE `technician` COMPATIBILITY ROLE. Job title
  is not authorization."*
- **`inventoryLookupReader`** — diagnosing a machine and fitting the right part requires looking a part
  up by alias and seeing whether it is on the truck. It is READ-ONLY, *"notably NOT
  `inventory.catalog.manage`"*, and confers no movement authority. The recorded decision already makes
  it `COMPOSE_BY_DEFAULT` for four Roles; adding `technician` is a **fifth** composition and therefore a
  reviewed extension.

`equipmentInstaller` has **no recorded entry either**, and its own definition carries the reason it must
stay separate from `inventorySerializedAssetAcquirer`: *"Combined in one Role, a single person could
declare a unit into existence out of nothing … and then install it at a customer, with no second party
anywhere in the chain."* It confers no acquire, receiving, transfer, catalog or customer-reassignment
authority, and no equipment **recovery** authority — recovery is an unimplemented authority the file
records as `EQUIPMENT RECOVERY AUTHORITY GAP`.

**All six functional Roles are inert today.** Four are in the 19-role zero-capability list;
`inventoryLookupReader` carries 1 of its 4; three of the six capability keys
(`workOrder.labor.record`, `workOrder.labor.correct`, `workOrder.parts.plan`) are not among the 76
registered eos_policy capabilities at all, and in `permissionCatalog.ts` all three are
`active: false`. This is `DOMAIN_NOT_ACTIVATED` before it is a grant question.

---

## 6. Parts Associate vs Parts Manager

| | Parts Associate (P08) | Parts Manager / Purchasing (P09) |
|---|---|---|
| Security Roles | `partsAssociate`, `inventoryReceivingClerk` | `partsManager`, `purchasingManager` |
| Work Eligibility | PARTS_OPERATIONS | PARTS_OPERATIONS |
| **Operational Scope** | **NONE** | **REORDER_QUEUE:`taylor`** |
| reorder capabilities | **none** | `request.read`, `request.create.manual`, `purchaseOrder.create`, `purchaseOrder.read` |
| the queue | **assigned work only** | **whole queue** |
| `reorder.request.assign` | must not hold | should hold — **0 holders measured** |
| `reorder.purchaseOrder.void` | must not hold, even as assignee | holds, narrowed by `isOwnAssignment` |
| `finance.invoice.issue` | must not hold | holds |

The separation is made by **two independent authorities, not one**. Logan holds the PARTS_OPERATIONS
qualification (so they may be **given** parts work) and holds **no** REORDER_QUEUE scope (so they may
not **see the shared queue**). Those answer two different questions and are never collapsed:
qualification is *what kind of work*, scope is *where they may work*, an assignment is *this one
record*. Technician A reaching their own reorder request through an active assignment while still being
refused the queue is the same proof from the other side.

**Do not grant `reorder.request.read.queue` or a REORDER_QUEUE scope to `partsAssociate` to make a
persona scenario pass. The absence is the assertion.**

---

## 7. Warehouse separation of duties — counter vs reconciler

| | Counter (P10, Noor) | Reconciler (P11, Morgan) |
|---|---|---|
| functional Role | `inventoryCycleCountCounter` | `inventoryCycleCountReconciler` |
| capabilities | `inventory.cycleCount.create`, `.submit`, `.cancel` | `inventory.cycleCount.reconcile` |
| eos_policy holders | `admin`, `inventoryCycleCountCounter` | `admin`, `inventoryCycleCountReconciler` |
| Object edit rows | **zero** | `part` only |
| WAREHOUSE scope | `SC-WH-MAIN` | `SC-WH-MAIN` **and** `SC-WH-SERVICE` |
| governance | `KEEP_STANDALONE` | `KEEP_STANDALONE` |

The duties are separated **four times over**, and every one is measured rather than asserted: the
capabilities are distinct ids with distinct holder sets; the holder sets are disjoint except for
`admin`; the two functional Roles are declared an exclusive pair in
`SOD_EXCLUSIVE_PAIRS` (DECISIONS #111); and they are held by **two different Employees**. Neither
surface is earned by capability alone — `inventory.cycleCount.count` and `.review` each require the
capability **plus** WAREHOUSE_OPERATIONS **plus** a WAREHOUSE scope. A second exclusive pair guards the
bin side: `inventoryBinAdministrator` ↔ `inventoryPutAwayOperator`, which is why
`inventoryPutAwayOperator` is composed into the associate Roles and **not** the manager ones.

Two findings sit on it. `admin` holds `create`, `submit` **and** `reconcile`, so an administrator can
reconcile a count they submitted — a **recorded** consequence of the "admin holds the entire catalog"
ruling, which says in terms that *"if internal controls should override the ruling for those specific
ids, they belong in an explicit exclusion list here — not as an accident of the list being out of
date."* And **`inventory.cycleCount.close` has ZERO holders**, so no persona can close a reconciled
count.

---

## 8. Retail vs National Accounts

The two personas **must not differ by Security Role**, and measured they do not: Harper, Indigo and
Jules all hold exactly `salesperson` — 17 capabilities, 9 object rows, identical C/R/E. The four
legitimate discriminators are:

1. **Record population** — `salesChannel` on the Opportunity and the Sales Order, from
   `SALES_CHANNELS = ["NATIONAL_ACCOUNTS", "RETAIL", "STRATEGIC_ACCOUNTS"]`, declared identically in
   `opportunityLifecycle.ts:27`, `salesOrderLifecycle.ts:18` and the frontend mirror
   `field-ops-app-vite/src/domain/opportunityLifecycle.js:13`.
2. **Account ownership and segmentation** — which accounts the person owns.
3. **Job Role** — presentation and org-chart position, never authorization.
4. **Reporting and financial reach** — `finance.visibility.self` / `.team` / `.consolidated`.

This is a **stated** design decision, not an inference. `roleHierarchy.PLACEMENT_GAPS` records it:

> *"National Accounts vs Retail Sales — shown as separate columns under Sales Manager. Deliberately NOT
> modelled as Roles: which market a deal belongs to is a property of the DEAL (SALES_CHANNELS on
> Opportunity and Sales Order), not of the person. A Role per channel multiplies every time a channel is
> added, and there are already three. If a national-accounts salesperson must be unable to see retail
> deals, that is channel-scoped visibility — the deferred coverage model, not this hierarchy."*

**Both designed discriminators are currently unmeasurable.** `job_roles` = 0 rows and
`employee_job_role_assignments` = 0 rows, so Jules's "National Accounts Manager" and Harper's "Retail
Sales Representative" are free-text `job_title` values carrying no authority.
`eos_commercial.opportunities` / `sales_agreements` / `sales_orders` = 0 rows, so no record exists to
carry a channel. The correct remedies are the Job Role catalog and C5 record population — never a
`nationalAccountsSalesperson` Role.

Two further measured facts for the Owner. `salesManager` differs from `salesperson` by **exactly one**
object permission — `auditLog` read — plus the five performance-goal **write** verbs and
`finance.visibility.team` instead of `.self`; the sales *manager* holds no elevated **commercial**
authority over the sales *person*. And the fixture's own North Star for the national-accounts persona
names `commercial.agreements`, which is one of the five declared `EXPERIENCE_SURFACE_GAPS`: *"the
national-accounts persona's North Star names a surface the governed vocabulary cannot express."*

---

## 9. WORKFLOW_NEVER_WIDENS — the proof

The claim: **a Workflow may narrow Object authority and may never create it.** Six independent pieces of
evidence, the third of which is executed rather than argued.

**(1) Structural — the two questions are answered by two files that do not consult each other.**

```
OBJECT/FIELD AUTHORITY   what data may I access or change?    effectiveObjectAccess.ts
WORKFLOW AUTHORITY       what business action may I perform?   workflowEngine.ts
```

`workflowEngine.ts` imports `PolicyReader` and workflow record types only. It never imports
`effectiveObjectAccess.ts`, and `effectiveObjectAccess.ts` never imports `workflowEngine.ts` or calls
`listWorkflowRoleBindings` — verified by grep across `functions/src`. The file says why in its own
header: *"being allowed to `Start Purchasing` does NOT mean reading every Purchase Order field; holding
`PurchaseOrder.Read` does NOT mean being allowed to `Void Purchase Order`. So this file never consults
Object/Field CRED, and the CRED resolver never consults a workflow binding."*

**(2) Type-level — a workflow decision cannot be spent as a grant.** `decideWorkflowAction` returns
`{ allowed: true, action, toStepKey }` or `{ allowed: false, refusal }`. There is no capability set, no
permission id, no CRED quadruple and no object key in the success shape. There is nothing in the return
value an Object resolver could consume even if one tried.

**(3) Executed — `functions/test/adminPolicyReorderSeparation.test.mjs`, run on this branch: 10 tests,
10 pass, 0 fail.** No emulator required (grepped: neither `FIRESTORE_EMULATOR_HOST` nor
`FIREBASE_AUTH_EMULATOR_HOST` appears in it). It asserts the four implications that must not hold,
against the real resolver and the real workflow engine over a store:

- *a WORKFLOW ACTION does not imply Reorder Request / Edit* — `partsManager` is bound to `approve`, the
  decision is `allowed: true`, and the same principal resolves `reorderRequest` Edit `false`, field Edit
  `false`, field **Read** `false`.
- *Reorder Request / Edit does not imply a workflow action* — full CRED on `reorderRequest`, and
  `approve` refuses `notBoundToRole`. *"Full CRED buys no transition."*
- *Purchase Order / Edit does not imply a reorder workflow action* — the cross-object case the legacy
  matrix actually produced; refuses `notBoundToRole`.
- *Purchase Order authority confers nothing over Reorder Request data, and the reverse.*

A further 61 of 62 assertions pass (1 skipped, 0 fail) across `experienceAuthority.test.mjs`,
`conditionKindInventory.test.mjs`, `administrationReadAuthority.test.mjs` and
`adminPolicyWorkflow.test.mjs`.

**(4) Schema-level.** `eos_policy.workflow_role_bindings` is declared under the comment *"THE WORKFLOW
AUTHORITY, and it grants no data access whatsoever."* Its columns are
`(workflow_version_id, action_key, role_id)`. `action_key` is a **workflow action**, not a capability
key, and there is no column that could name one. No migration and no command derives a
`role_capabilities` row from a binding.

**(5) The decisive live case.** `partsAssociate` is bound to `startPurchasing`, `postPurchasingUpdate`,
`recordPurchaseOrder` and `markReceived` in `partsPurchasing` v1 — and `partsAssociate` holds **no
`reorder.*` capability whatsoever** in `eos_policy`, and Logan holds **no Operational Scope**. If a
binding created authority, this persona would have gained four Reorder execution authorities from
configuration alone. It has not. None of those four action keys has a registered eos_policy capability
at all, which is a separate defect (D-09) and is precisely why the binding cannot be standing in for
one.

**(6) Runtime.** `decideWorkflowAction` and `allowedWorkflowActions` are imported by **tests only**.
The four `functions/src` consumers of `workflowEngine.ts` — `workflowCommands.ts`,
`applyWorkflowSeed.ts`, `policyCommands.ts` and the Administration API — import only
`loadWorkflowVersionDefinition` and `validateWorkflowVersion`, i.e. definition management. And the data
agrees: **all 5 workflow versions are DRAFT, none PUBLISHED, and `workflow_instances` = 0 rows**, so
`decideWorkflowAction` would return `unknownInstance` for every attempt in the tenant today.

**Where a Workflow does narrow, correctly.** Six of the 48 actions carry
`requires_own_assignment = true`: `partsPurchasing.startPurchasing` and `workOrder.Accept` / `Travel` /
`Arrive` / `WorkStart` / `Complete`. A missing assignee is a **refusal, not a pass**. The assignee is
read server-side from the business record and cannot be supplied by a caller, *"which is what makes
`requiresOwnAssignment` an authorization check rather than a self-attested claim."* The engine's own
five-step order — stored current step, action exists in the pinned version, `from` matches, a held Role
is bound, own-assignment satisfied — reads the current step **from the store, never from the request**,
and an instance stays pinned to the version it began under. And the narrowing is checked **after**
authority: `authorizeObjectAction` returns `CAPABILITY_MISSING` before it reads anything at all, so an
unauthorized caller causes zero record reads and learns nothing about whether the record exists.

One deliberate non-problem, recorded so it is not "fixed" later: an action nobody may perform is not a
validation error, *"a definition may be published before its Roles exist, and refusing that would force
Roles to be invented to satisfy a validator."*

---

## 10. Gap classification

| # | finding | classification |
|---|---|---|
| **D-01** | **No Employee maps to the `owner` Role.** The only `owner`-holding principal (`dca03ad1-9278-49e6-b4f9-d09d3f587dc4`) has **no Employee link**, so every `WORK_ELIGIBILITY`, `OPERATIONAL_SCOPE` and `RECORD_ASSIGNMENT` predicate refuses it `EMPLOYEE_LINK_REQUIRED`. The Employee titled "Owner / Executive" (Avery) holds **`admin`**, not `owner`, has a NULL `display_name`, and is the only Employee with a single Principal | `IDENTITY_DEFECT` + `EMPLOYEE_CONTEXT_DEFECT` |
| **D-02** | **`owner` holds 47 capabilities, `admin` holds 66 — a 19-capability gap, of which 17 are a genuine divergence and 2 are correct.** `OWNER_PERMISSIONS = [...ADMIN_ROLE.permissions, ...reports]`, pinned by test, so `owner ⊇ admin` over the `permissionCatalog` vocabulary. **17 of the 19 ARE catalog ids** and should therefore be owner's: `customer.governedField.write`, `admin.dataImport.execute`, `opportunity.createSalesOrder`, `salesAgreement.accept`, `inventory.catalog.activate`, `equipment.install`, `equipment.model.manage`, `inventory.placement.record`, `inventory.stock.receive`, `inventory.stock.relocate`, `inventory.transfer.cancel`/`.dispatch`/`.receive`, and all four `inventory.cycleCount.*`. **The remaining 2 — `workOrder.lifecycle.dispatch` and `.cancel` — are PostgreSQL-only keys the in-repo derivation cannot reach, and the five-row Owner ruling of 2026-09-23 excluded `owner` from them explicitly.** Those two are `INTENTIONAL_DENIAL` and correct | `SECURITY_ROLE_DEFECT` (17 ids) |
| **D-03** | **`owner` has `can_edit = true` with `can_read = false`** on `employee`, `receivingOrder`, `rolesPermissions`, `workOrder`. `admin` reads all four. Owner can edit the Roles & Permissions matrix and cannot read it; can create and edit Work Orders and cannot read one. Every Owner-facing screen gated on a read renders empty | `OBJECT_AUTHORITY_DEFECT` |
| **D-04** | **The Service Manager (`fieldManager`) cannot dispatch or cancel a Work Order.** `workOrder.lifecycle.dispatch` and `.cancel` are `{admin, dispatcher}` only, by the five-row ruling whose operative sentence is *"do not grant lifecycle capabilities to any additional Roles"*. `fieldManager` is also bound to **no** workflow action, so it can neither `MarkReady`, `Schedule`, `Dispatch` nor `Close`. The business need is real; the standing ruling forbids the grant | `OBJECT_AUTHORITY_DEFECT` — requires an explicit Owner amendment to the five-row set, not a lane decision |
| **D-05** | **Edit or create without read, at the Object layer — 5 roles, 8 rows.** `technician`→`workOrder`(–,–,E); `partsAssociate`→`workOrder`(C,–,E); `partsManager`→`workOrder`(C,–,E); `warehouseManager`→`reorderRequest`(C,–,–); plus D-03's four on `owner`. Among the twelve roles examined, only `admin` can read `workOrder` | `OBJECT_AUTHORITY_DEFECT` |
| **D-06** | **`technician` holds `purchaseOrder`(create, read) at the Object CRED layer** while holding **neither** `reorder.purchaseOrder.create` **nor** `.read` at the capability layer. The two conditioned cells were correctly **withheld** from `eos_policy` (named in `WITHHELD_CONDITIONED_CELLS`, guarded at two enforcement points, and `capability_grant_conditions` = 0 rows) — but the Object CRED layer **retained** the authority the capability layer refused. The two layers disagree | `OBJECT_AUTHORITY_DEFECT` — parity defect between the two authority layers |
| **D-07** | **The Reorder Queue's own two authorities have ZERO holders.** `reorder.request.read.queue` → 0, so the Reorder Queue surface's first grant path is unreachable by anybody and only the second path (`reorder.request.read` + REORDER_QUEUE scope) works. `reorder.request.assign` → 0, although the in-repo `partsManager` declares it, so **no persona can assign a Reorder Request** | `OBJECT_AUTHORITY_DEFECT` |
| **D-08** | **Six business Roles are bound to no workflow action at all**: `owner`, `generalManager`, `fieldManager`, `warehouseManager`, `purchasingManager` and the three finance Roles. `owner` appears in **0 of 112** bindings. Roles holding `workOrder.transition` or `salesOrder.write` can execute no transition | `WORKFLOW_AUTHORITY_DEFECT` |
| **D-09** | **Workflow actions with no capability behind them.** `partsPurchasing` v1 binds `startPurchasing`, `postPurchasingUpdate`, `recordPurchaseOrder`, `markReceived`, `approve`, `reject`, `voidPurchaseOrder`; only 7 `reorder.*` capabilities exist in `eos_policy` and **none of those seven action names is among them**. They exist in `permissionCatalog.ts` (15 active `reorder.*` ids) and not in the governed model | `DOMAIN_NOT_ACTIVATED` |
| **D-10** | **ZERO `report.*` capabilities exist in `eos_policy`.** `reportViewer` / `reportFinanceViewer` / `reportAuthor` carry 27 / 5 / 3 Firestore permission ids, all `active: false`, and **0** governed capabilities. P15 is not implementable in the governed model | `OBJECT_AUTHORITY_DEFECT` + `DOMAIN_NOT_ACTIVATED` |
| **D-11** | **The recorded "`commercial.salesAgreements` has no `salesAgreement.*` capability" gap is STALE.** Measured: all four `salesAgreement.*` keys **are** registered in `eos_policy.capabilities` (Object `salesAgreement`: create/read/edit/accept) with **22 grants over 6 roles**. Retire the entry | stale gap — retire |
| **D-12** | **No Principal holds any finance Role** (`controller`, `accountingManager`, `financeManager` → 0 holders each), and `eos_finance.invoices` / `payments` = 0 rows. The fixture itself records Finance as BLOCKED (`SAMPLE_COMPANY_V3_REQUIRED` + `FINANCIALS_DOMAIN_BLOCKED`) | `TEST_FIXTURE_DEFECT` + `CREDENTIAL_CATALOG_DEFECT` + `DOMAIN_NOT_ACTIVATED` |
| **D-13** | **No Principal holds `generalEmployee`**, so the P16 negative control cannot be exercised at the login layer. The Employee-layer control (Quinn, 0 Principals) does exist | `TEST_FIXTURE_DEFECT` |
| **D-14** | **REORDER_QUEUE scope mismatch between fixture and live.** `personaAuthorityDimensions.v1.json` declares REORDER_QUEUE:`sample-co-synthetic` for `parts-associate`, `parts-manager`, `dispatcher`. Live nonprod holds REORDER_QUEUE:**`taylor`** for `dispatcher`, `owner-executive`, `parts-manager` — a different `scope_id` **and** a different holder set, seeded by `migration:1761696000000` (2026-09-23 19:09) rather than by the admin principal (2026-09-24 04:24). `parts-associate` has no scope row at all | `TEST_FIXTURE_DEFECT` + `OPERATIONAL_SCOPE_DEFECT` |
| **D-15** | **19 roles carry ZERO capabilities**, so their functional authority is inert: `inventoryBinAdministrator` (`inventory.location.bin.*` unregistered), `workOrderPartsPlanner`, `technicianLaborRecorder`, `equipmentInstaller`, `inventoryTransferReceiver`, `inventoryReturnsIntakeClerk`, `inventoryPutAwayOperator`, `equipmentCatalogAdministrator`, `crmActivityContributor`, `serviceInboundWorkReviewer`, `emailIntakeAdministrator`, `performanceGoalSubject`, `workOrderLaborCorrector`, `inventorySerializedAssetAcquirer`, `generalEmployee`, `reportViewer`, `reportFinanceViewer`, `reportAuthor`, `zz_nonprod_acceptance` | `DOMAIN_NOT_ACTIVATED` |
| **D-16** | **`eos_ops.parts` = 0 rows.** The object key is `part` (singular) and 19 roles hold `part` read, all resolving to an empty set. Every wired catalog command refuses until a COPY | `DOMAIN_NOT_ACTIVATED` |
| **D-17** | **`inventory.cycleCount.close` and `inventory.workOrderConsumption.record` have ZERO holders.** A reconciled count cannot be closed by anybody, and no persona can record consumption against a Work Order | `OBJECT_AUTHORITY_DEFECT` |
| **D-18** | **`dispatcher` holds the full commercial sell-side spine** — `opportunity.write`, `.createSalesOrder`, `salesOrder.write`/`.fulfill`/`.service`, all four `salesAgreement.*`. Reached Dispatch through `SHARED_ADMIN_DISPATCHER_BASE_PERMISSIONS`, a shared list, not a business ruling | `SECURITY_ROLE_DEFECT` — separation of duties |
| **D-19** | **`partsManager` holds `finance.adjustment.record`** while holding neither `finance.payment.apply` nor `finance.refund.record`. Invoicing a counter sale is defensible; recording a financial adjustment is Finance's act | `SECURITY_ROLE_DEFECT` — separation of duties |
| **D-20** | **`admin` holds cycle-count `create`, `submit` AND `reconcile`**, so an administrator can reconcile a count they submitted. A **recorded** consequence of the "admin holds the entire catalog" ruling, carried deliberately with an explicit invitation to add an exclusion list | `INTENTIONAL_DENIAL` — recorded exception, not a defect |
| **D-21** | **`administrationSurfaceAuthority.ts`'s header still states that `administration.workflows` is "readable by nobody"**, and migration `1762128000000` subsequently granted `workflowDefinition.read` to `admin` and `owner`. The comment is stale; the mapping table is correct | documentation drift — no authority impact |
| **D-22** | **The contextual/conditional layer is composed and INERT.** `ACTION_CONTEXT_POLICIES` is an empty Map, `SHIPPED_GRANT_CONDITIONS` is `grantConditionCatalog([])`, and `eos_policy.capability_grant_conditions` holds 0 rows. `contextualAuthorization.ts` is imported by nothing under `functions/src` — its only importer is its own PostgreSQL test. The one live narrowing path is `workOrderLifecycle.LIFECYCLE_CONTEXT_PREDICATES` → `authorizeLifecycleEdge`, consumed by `transitionWorkOrder` | `SCOPE_OF_PROOF` — carried, not a new defect |
| **D-23** | **`job_roles` = 0 rows and `employee_job_role_assignments` = 0 rows.** Job Role is the designed carrier of the Retail vs National Accounts distinction and of org presentation, and it is entirely empty; free-text `job_title` is doing the work instead | `EMPLOYEE_CONTEXT_DEFECT` |
| **D-24** | **`accountingManager` and `financeManager` are byte-identical** (17 capabilities, 13 object rows, identical C/R/E); `controller` differs by exactly one object-level `account` edit | `INTENTIONAL_DENIAL` — recorded `INTENTIONAL_OVERLAP` |
| **D-25** | **No governed persona can navigate the client.** `navConfig.isNavItemVisible` falls through to `ROLE_NAV_ACCESS[users/{uid}.role]` with `ROLES = admin \| dispatcher \| technician` only, and the Sample Company login activation writes no such Firestore doc (`GOVERNED_PERSONA_HAS_NO_CLIENT_ROLE`). Every governed persona can authenticate and call the EOS API and none can reach a destination. Additionally, `NAV_SURFACE_GAPS` declares **27 keys** with no governed surface — the whole `inventoryRole/*` domain is *"THIS DOMAIN IS THE LEGACY CONSTRUCT ITSELF"*, and every Financials destination other than Invoices and Payments *"is Frame-0 information architecture with no authority behind it"* | `EXPERIENCE_NAV_DEFECT` |
| **D-26** | **Five `EXPERIENCE_SURFACE_GAPS`** name persona North Stars the governed vocabulary cannot express: `crm.contacts`, `commercial.agreements` (the national-accounts persona's), `dashboard.myPipeline`, `service.scheduling`, `purchasing.suppliers`. `employees.directory` — the owner-executive and general-manager North Star — is not a catalog surface key either | `EXPERIENCE_NAV_DEFECT` |
| **D-27** | **13 of the 39 governed Objects carry no capability at all**, so they appear in `role_object_permissions` (admin holds rows on `commissions`, `contact`, `location`, `marketingInitiatives`, `mobileLocation`, `partAlias`, `purchaseOrderVoid`, `salesTerritory`, `supplier`, `supplierCatalogItem`, `technicianTimeNonWork`, `truck`) while no capability governs an action on them. `workflowInstance` is the deliberate thirteenth | `OBJECT_AUTHORITY_DEFECT` for the 12; `INTENTIONAL_DENIAL` for `workflowInstance` |
| **D-28** | **`GOVERNED_QUALIFICATION_CODES` comment/code mismatch.** `contextualAuthorization.ts` comments that `PARTS_ASSOCIATE` *"is now here, registered in its own right by migration 1761696000000"*, while the Set contains `PARTS_OPERATIONS`. A policy naming `PARTS_ASSOCIATE` would be refused `WORK_ELIGIBILITY_UNMAPPED`. The code is right and the comment is wrong | documentation drift |
| **D-29** | **`salesAgreement.accept` has no approval-limit or discount-authority model**, so acceptance is all-or-nothing per Role and a Salesperson may bind the same terms a General Manager can. Recorded in the Role definition as *"a real governance gap to close deliberately"* | `OBJECT_AUTHORITY_DEFECT` — carried |
| **D-30** | **Equipment recovery has no authority at all.** `equipmentInstaller` confers no recovery, and the definition records `EQUIPMENT RECOVERY AUTHORITY GAP`: a serialized asset can be installed at a customer and there is no governed act that takes it back | `OBJECT_AUTHORITY_DEFECT` |

---

## 11. Proposed changes, pre-classified

**Nothing below is applied. Every row is a proposal for an explicit Owner ruling.**

### REQUIRED_BUSINESS_AUTHORITY

| proposal | persona | note |
|---|---|---|
| Restore `owner ⊇ admin` for the **17** catalog ids `owner` is missing (D-02) | P01 | The in-repo contract already guarantees it and is pinned by test; PostgreSQL is what diverged. A parity repair, not a widening. The other 2 (`workOrder.lifecycle.dispatch`/`.cancel`) stay withheld — the Owner excluded them explicitly |
| Grant `owner` the missing **read** on `employee`, `receivingOrder`, `rolesPermissions`, `workOrder` (D-03) | P01 | Grant the read; do not remove the edit |
| Grant the missing `workOrder` **read** to `technician`, `partsAssociate`, `partsManager`, and `reorderRequest` read to `warehouseManager` (D-05) | P06–P09, P11 | A Role that may change a record it cannot read is incoherent on every surface |
| Grant `workOrder.lifecycle.dispatch` and `.cancel` to `fieldManager` (D-04) | P04 | **Collides with the standing five-row ruling of 2026-09-23.** Requires an Owner amendment stated as a sixth and seventh row, not an afternoon's convenience |
| Grant `reorder.request.assign` to `partsManager` (D-07) | P09 | The in-repo catalog already declares it; PostgreSQL has 0 holders, so no persona can assign a Reorder Request |
| Grant `inventory.cycleCount.close` to `inventoryCycleCountReconciler` (D-17) | P11 | A reconciled count nobody can close is an open loop |
| Register and grant `workOrder.labor.record` → `technicianLaborRecorder`, composed into **every** technician | P06, P07 | A technician who cannot record labor cannot be paid or billed. **No composition entry exists for this key; the governance file's default is `KEEP_STANDALONE`, so this needs a ratified entry** |
| Register the 3 missing `inventoryLookupReader` keys, attach all 4, and add `technician` as a **fifth** `COMPOSE_BY_DEFAULT` target | P06, P07 | Read-only; confers no stock movement. Extends a recorded decision that today names 4 Roles and not `technician` |
| Bind `generalManager` and `fieldManager` to the workflow actions their capabilities already imply (D-08) | P03, P04 | A binding is not a grant, so this widens nothing; it makes held authority executable |
| Establish an approval-limit / discount-authority model behind `salesAgreement.accept` (D-29) | P12, P13, P03 | Carried as a stated governance gap, not invented here |
| Define an equipment **recovery** authority (D-30) | P06 | There is no governed act that takes an installed serialized asset back |

### TEST_FIXTURE_ONLY

| proposal | persona |
|---|---|
| Create a Principal holding `owner`, linked to an Employee, and correct Avery's persona binding + NULL `display_name` (D-01) | P01 |
| Create Principals for `controller` / `accountingManager` / `financeManager` (D-12) | P14 |
| Create a Principal holding `generalEmployee` as the live negative control (D-13) | P16 |
| Reconcile the REORDER_QUEUE `scope_id` and holder set between fixture and live (D-14) | P05, P08, P09 |
| Populate `job_roles` and assign one current Job Role per Employee (D-23) | P12, P13, all |
| Retire the stale `salesAgreement.*`-not-registered gap entry (D-11) | P12, P13 |
| Correct the stale "readable by nobody" comment (D-21) and the `PARTS_ASSOCIATE` comment (D-28) | P01, P02, P08 |
| Record composition decisions for `equipmentInstaller` and `technicianLaborRecorder`, which have none | P06, P07 |

### DO_NOT_GRANT — contextual authority supplies it

| proposal | why |
|---|---|
| Do **not** implement `operationalRoleActive` as a PostgreSQL Condition to restore technician's withheld Reorder/PO cells | Ruled `BUSINESS_ELIGIBILITY_SCOPE`. Work Eligibility + Operational Scope already answer it. `capability_grant_conditions` = 0 rows and must stay 0 for this Kind; `WITHHELD_CONDITIONED_CELLS` is enforced at two points |
| Do **not** implement `employmentActive`, `statusEquals` or `statusIn` | `MOVED` to `eos_workforce.employees.employment_status`, and `DEAD` respectively |
| Do **not** grant a technician a queue-wide Reorder read to reach their own request | `RECORD_ASSIGNMENT` already reaches it; a queue read would reach everyone else's too |
| Do **not** widen `workOrder.lifecycle.complete` beyond `technician` | The `RECORD_ASSIGNMENT / ASSIGNED_EMPLOYEE` predicate is the authority; a second holder is a second unbound way to assert the work was done |
| Do **not** add an ownership or requester `ContextPredicateKind` to express a persona need | Three Kinds are implemented and *"there is no generic 'owner' column"*. Inventing a fourth to make a persona pass is how a narrowing layer becomes a grant layer |

### DO_NOT_GRANT — domain inactive

| proposal | why |
|---|---|
| Do **not** grant any `report.*` authority to P15 yet (D-10) | Zero `report.*` capabilities exist in `eos_policy`. Register the vocabulary first; a grant against an unregistered key is unadministrable and would be stranded |
| Do **not** grant the four `reorder` execution actions to `partsAssociate` (D-09) | The capabilities are not registered. Registering the vocabulary is the prior step, and it is a reviewed migration |
| Do **not** activate any catalog authority against `part` until the COPY (D-16) | `eos_ops.parts` = 0 rows; every wired command refuses `DOMAIN_NOT_ACTIVATED` |
| Do **not** build the Retail/National Accounts distinction until C5 populates the commercial families | 0 opportunities, 0 agreements, 0 orders — there is no record to carry a `salesChannel` |
| Do **not** grant `inventory.location.bin.*` to `inventoryBinAdministrator` yet (D-15) | The keys are unregistered in `eos_policy` |
| Do **not** point a navigation destination at a capability somebody happens to hold to make it render (D-25, D-26) | A gap whose door closes on the evidence is honest; one pointed at a convenient key is not |

### DO_NOT_GRANT — violates separation of duties

| proposal | why |
|---|---|
| **Withdraw** the commercial spine from `dispatcher` (D-18) | No Taylor responsibility requires a Dispatcher to accept a Sales Agreement or convert an Opportunity |
| **Withdraw** `finance.adjustment.record` from `partsManager` (D-19) | Adjusting the books is Finance's act, and the Role holds neither `payment.apply` nor `refund.record` beside it |
| Never grant `inventory.cycleCount.reconcile` to `inventoryCycleCountCounter`, or `create`/`submit`/`cancel` to `inventoryCycleCountReconciler` | Declared `SOD_EXCLUSIVE` (DECISIONS #111). The counter must not accept their own variance |
| Never compose `inventoryPutAwayOperator` into `warehouseManager` or `partsManager` | Declared `SOD_EXCLUSIVE` against `inventoryBinAdministrator` |
| Never grant `workOrderLaborCorrector` to a `technician` | Correcting recorded labor is supervisory; a technician who can correct their own can unrecord what they asserted |
| Never combine `equipmentInstaller` with `inventorySerializedAssetAcquirer` on one person | *"A single person could declare a unit into existence out of nothing … and then install it at a customer, with no second party anywhere in the chain"* |
| Never grant any `admin.*` capability to `generalManager` | A non-privileged Role holding `admin.roleAssignment.write` is a self-escalation path to `owner` |
| Never grant `financialPolicy.profile.configure` to the money Roles | They may see which costing method governs their numbers; changing it is EOS configuration |
| Never grant the performance-goal **write** verbs to `salesperson` | A salesperson would author their own quota |
| Never create a `nationalAccountsSalesperson` Role | The channel is a property of the deal, not the person |
| Do not grant `reorder.purchaseOrder.void` to any operational role, even when already the assignee | Explicitly not extended to PARTS_ASSOCIATE; Void stays admin/dispatcher/owner + own-assignment |
| Do not give `admin` or `owner` a REORDER_QUEUE Operational Scope | An administrator needs no operational queue scope; Avery's migration-seeded row should be withdrawn |
| Do not grant any Work Eligibility to `owner` or `admin` | `ADMIN_IMPLIES_NO_WORK_ELIGIBILITY` is a proof the fixture exists to carry |
| Do not grant `audit.event.read` to `dispatcher` or `salesperson` | Reading the audit log is management visibility; neither is management |

---

## 12. Owner vs Administrator — the settled separation, honoured

| authority | capability | surfaces it governs | holders |
|---|---|---|---|
| **policy CONFIGURATION** — the Role × Object × action matrix, which is nobody's effective access | `admin.securityPolicy.read` | `rolesPermissions`, `objects` | `admin`, `owner` |
| **one Principal's EFFECTIVE ACCESS** — "what would this person be able to do" | `admin.principalAccess.read` | `users`, **`permissionPreview`** | `admin`, `owner` |
| workflow definitions | `workflowDefinition.read` | `workflows` | `admin`, `owner` |
| audit history | `audit.event.read` | `auditLogs` | 12 roles |
| nothing | — | `overview` (a **disjunction** over the other six) | anyone who reaches at least one other surface |

`rolesPermissions` and `objects` share one key because *"they are one authority seen from two sides —
a second key would be two names for one thing."* `permissionPreview` does **not** share it, because
*"what the surface actually does is what decides its key"*: Permission Preview reads and evaluates a
**Principal's** effective access, so its subject is the `principal` Object whose own read is
`admin.principalAccess.read`. The two keys stand at exactly `{admin, owner}` today, so **no principal
can presently observe the difference** — which is the argument for keeping them distinct now rather
than the day one is granted without the other. They also have different provenance:
`admin.securityPolicy.read` was granted by migration `1762041600000`; `admin.principalAccess.read` by
the compatibility Role's own curated list. **This matrix does not re-decide that separation.**

The 14 Administration **write** keys are provably disjoint from the 4 read keys:
`admin.accessRequest.decide`, `admin.credentialReset.initiate`, `admin.dataImport.execute`,
`admin.employeeJobRole.write`, `admin.employeeOperationalScope.write`, `admin.employeeProfile.write`,
`admin.employeeWorkEligibility.write`, `admin.roleAssignment.write`, `admin.userStatus.write`, and the
five `workflowDefinition` mutations. A Role that may **look at** a workflow definition must not thereby
be able to publish one, and the `UNIQUE (object_key, action_key)` index plus a flat capability set with
no implication between keys is what guarantees it by construction.

**Owner is business authority; Administrator is security-policy administration.** Measured, the two are
not currently distinguished that way at all: `admin` holds 66 capabilities and `owner` 47, `owner` is
missing 17 that `admin` has and should hold (D-02), no Employee maps to `owner` (D-01), and the persona
fixture merges Administrator **into** Owner / Executive on the ground that `admin` *is* the
Administrator authority. Restoring the in-repo `owner ⊇ admin` contract is the prior step to expressing
the distinction; the distinction itself is then made by **what is assigned to the Employee**, which is
where governance is meant to live.
