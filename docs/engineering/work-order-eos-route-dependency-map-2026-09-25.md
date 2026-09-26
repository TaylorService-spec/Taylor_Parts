# Work Order record routes under EOS navigation: dependency map (2026-09-25)

Lane PC-WO2. Scope: `/service/work-orders/:workOrderId` (detail) and `/service/work-orders/new`
(create). Guard: `field-ops-app-vite/src/navigation/workOrderRouteAccess.js`.

**Status: both routes are held closed under the EOS source.** The guard emits a route only when
(a) the EOS experience authority grants `service.workOrders` AND `service.dispatch`, and (b) that
route's backend readiness constant is `EOS_POSTGRES_ACTIVE`. Both constants
(`WORK_ORDER_RECORD_READ_EOS_BACKEND`, `WORK_ORDER_CREATE_EOS_BACKEND`) are committed as
`FIREBASE_ROLE_GATED`. Nothing is exposed until a cutover change flips one. The legacy
navigation source does not change.

Evidence labels: **DERIVED** means read from code in this tree. **PRIOR-LIVE** means a
committed record of an earlier live read. Nothing was run against a live system for this
document.

---

## 1. Detail read: `/service/work-orders/:workOrderId`

| Layer | What is there today |
|---|---|
| Component | `modules/workOrders/WorkOrderDetailPage.jsx` |
| Primary read | `hooks/useWorkOrder.js`: `onSnapshot(doc(db, "fieldops_wos", id))` |
| Rule | `firestore.rules:506-508`: `allow read: if isAdminOrDispatcher() \|\| (isTechnician() && isOwnTechnician(resource.data.assignedTechId))` |
| Rule helpers | `isAdminOrDispatcher()` at `firestore.rules:22-24` uses `userRole()` at `:18-20`, which is `get(users/{uid}).data.role` |
| Secondary reads (unconditional on mount) | `useAccount` (accounts, rule `:1288` isAdminOrDispatcher), `useLocation` (locations, `:1293`), `useEquipmentDoc` (equipment, `:1456`), `useFirestoreCollection("fieldops_technicians")` (`:401`, isAdminOrDispatcher or own technician record) |
| Advisory reads (do not block the page) | `useWorkOrderReadinessContext` calls the `getWorkOrderReadinessContext` callable. `useWorkOrderPartsPlanCapability` calls `resolveEffectiveAccessCallable` and subscribes to `users/{uid}.accessVersion` |
| Actions on the page | `WorkOrderActions` uses `getAllowedActions(status, role, false)` (`domain/workOrderWorkflow.js:58-63`: admin/dispatcher only) with `role` from `AuthContext`, which reads `users/{uid}.role` in `auth/employeeSession.js:50-52`. The `transitionWorkOrder` callable refuses at `functions/src/transitionWorkOrder.ts:209-212` with `permission-denied` `Role "<role>" may not perform action ...` |
| EOS/PG replacement present | `eos_ops.work_orders` with assignments, schedule history and transitions (migration `1761004800000_work-order-object-authority.sql`, whose header says "NOTHING IS ACTIVATED"). There is also a copy/dry-run toolkit (`functions/src/eosOps/migration/workOrderMigration*.ts`) and a parity matrix. `workOrder.record.read` is in the catalog |
| Missing | (1) No PostgreSQL **read** authority: no `functions/src` code evaluates `workOrder.record.read` against `eos_ops.work_orders`. (2) No EOS transport: `OPERATIONS_ROUTE_BY_OPERATION` in `functions/src/eosOps/eosOpsHttp.ts` holds only `/operations/inventory` and `/operations/experience`. (3) No nonprod COPY of `fieldops_wos` recorded. (4) The client hook, the related Account/Location/Equipment/Technician reads and `WorkOrderActions` are all Firestore- or role-bound |
| Flip condition | Set `WORK_ORDER_RECORD_READ_EOS_BACKEND = EOS_POSTGRES_ACTIVE` in the same change that points `useWorkOrder` and the related reads at an EOS transport backed by the PG read authority, after COPY/VERIFY |
| Deletion condition for the Firebase path | Delete when no client reads `fieldops_wos`, and `firestore.rules` `match /fieldops_wos` is then removed. The rule helpers `isAdminOrDispatcher`, `isTechnician` and `isOwnTechnician` stay until their last other consumer is gone |

## 2. Create: `/service/work-orders/new`

| Layer | What is there today |
|---|---|
| Component | `modules/workOrders/WorkOrderWizard.jsx` |
| Load reads | `useAccountPicker` (`hooks/useAccountPicker.js:38`, accounts, rule `:1288`), `useLocationsForAccount` (locations, `:1293`), `EquipmentPicker` → `useEquipmentForAccount` (equipment, `:1456`) |
| Primary action | `services/workOrderService.ts` → `httpsCallable("createWorkOrder")` |
| Callable check | `functions/src/createWorkOrder.ts:144-146`: `getCallerContext(uid)` (`callerContext.ts:15-21`, Admin SDK read of `users/{uid}.role`), then `throw new HttpsError("permission-denied", "Only admin/dispatcher may create Work Orders.")` unless the role is `admin` or `dispatcher`. It writes to Firestore `fieldops_wos` and `counters` |
| EOS/PG replacement present | `functions/src/eosOps/workOrderCreateCommand.ts` is the native PG create. It authorizes on `workOrder.create` from the Principal's capabilities, refuses server-authored fields and allocates numbers via `workOrderNumbering.ts` (migration `1761177600000`) |
| Missing | (1) **No consumer**: nothing outside its own file and tests imports `workOrderCreateCommand`. (2) No EOS transport route for it. (3) The wizard's pickers read Firestore accounts/locations/equipment, so a PG create also needs PG-served pickers (CRM/customer and equipment authorities). (4) Operating-company key binding: Ventana fails closed `OPERATING_COMPANY_KEY_NOT_BOUND` by design |
| Flip condition | Set `WORK_ORDER_CREATE_EOS_BACKEND = EOS_POSTGRES_ACTIVE` in the same change that routes the wizard's submit and its pickers through an EOS transport to the PG command |
| Deletion condition for the Firebase path | Delete the `createWorkOrder` callable, its `getCallerContext` role check and the client `createWorkOrderCallable` once no route submits to them and `fieldops_wos` is no longer the create target |

Read and create are **separate readiness values**. A PG read can go live before the PG create,
or the other way round, and each flips its own constant.

---

## 3. Per-persona derivation (canonical registry, `config/sandboxRoleIdentityRegistry.json`)

Holders of `workOrder.lifecycle.dispatch` are exactly admin, dispatcher and fieldManager
(`roleCapabilityAuthorityBaseline.json`), so these are the only personas the surface condition
admits. All other canonical personas get neither route under EOS, whatever the readiness.

| Persona | uid | `users/{uid}.role` | Evidence |
|---|---|---|---|
| administrator `admin@` | `ZVu3lHTP…` | `admin` | PRIOR-LIVE: `docs/audits/sandbox-a7-personas-20260806` (provisioned `--securityRole admin` by `provisionEmployeeAccess.js`, which writes `userUpdates: { role }` at `:540`) and the 2026-08-20 sweep (`docs/assessments/discovery-2026-08-20-sandbox-sweep.md` §2). Not re-read since |
| dispatcher `dispatcher@` (PRESERVED) | `PEiRkebI…` | `dispatcher` | PRIOR-LIVE: same two records (`sbx-dispatcher`, `--securityRole dispatcher`) |
| serviceManager `devon.fixture@` (Security Role `fieldManager`) | `oQPfzG2A…` | **absent** | DERIVED: fixture accounts are created by `functions/scripts/sampleCompany/sandboxAuthDirectory.js:297`, which uses `firebase-admin/auth` only and never Firestore (a test asserts this). The registry requires that "no Firebase business authority is created". The persona census marks Firestore-side state `BLOCKED_MEASUREMENT` (not measured) |

Refusals once a route is reachable (that is, if a readiness constant were flipped without a
backend change):

- **admin@ / dispatcher@: works on the Firebase path.** Detail: `isAdminOrDispatcher()` passes at
  `firestore.rules:507`, the page loads and actions are offered. Create: the role check at
  `createWorkOrder.ts:145` passes and a **Firestore** Work Order is written. These users are
  served, but by the Firebase authority, not EOS.
- **serviceManager (devon.fixture): unusable.**
  - Detail: `useWorkOrder` gets `permission-denied` from `firestore.rules:507-508`. `userRole()`
    reads a users document that does not exist, so `isAdminOrDispatcher()` and `isTechnician()`
    both fail. The page shows the `loadErrorMessage` error state. The accounts, locations,
    equipment and technicians reads are denied the same way (`:1288`, `:1293`, `:1456`, `:401`).
    `WorkOrderActions` offers nothing, because `role` is null.
  - Create: the customer picker is denied at `firestore.rules:1288`, so no customer can be picked.
    A direct submit would get `HttpsError('permission-denied', 'Only admin/dispatcher may create
    Work Orders.')` from `createWorkOrder.ts:146`, because `caller.role` is null.

This is the defect the readiness gate prevents: the EOS authority admits a persona that the
backend refuses.

### Read-only operator check (NOT RUN)

In the `eos-platform-sandbox` Firestore console (read only, no write), open these documents:

1. `users/oQPfzG2AUgWOo8Tm0LJvurj8dXi2`. Expected: **document does not exist**, or it exists
   with no `role`. Either result confirms the service-manager refusal.
2. `users/PEiRkebIGRPcEau7yBBV0D77Dho1`. Expected: `role == "dispatcher"`, `employeeId == "sbx-dispatcher"`.
3. `users/ZVu3lHTP1NQhj0Am04zTAGou0dx1`. Expected: `role == "admin"`, `employeeId == "sbx-admin"`.

If (1) unexpectedly shows `role: admin|dispatcher`, the Firebase path would serve that persona.
The gate still stays closed, because EOS personas must not depend on a Firebase role.

---


**Why the repair is not a Firebase role document.** Firebase is transitional, and the target is
zero Firebase, auth included. Writing `users/{uid}.role` for the service manager would make the
Firebase path serve that persona, and it would add a Firebase business authority that the
registry forbids (`config/sandboxRoleIdentityRegistry.json`: "no Firebase business authority is
created"). It would also give a second answer to "who may read or create a Work Order". The
repair is the PostgreSQL authority mapped in sections 4 and 5. Firebase routing does not
represent canonical EOS personas, and this document does not try to make it.

---

## 4. DETAIL READ: full EOS dependency map

Detail read is its own authority, and nothing here is inferred from create (section 5).

### 4.1 PostgreSQL object authority (present, INERT)

Migration `functions/migrations/1761004800000_work-order-object-authority.sql` creates these
tables in schema `eos_ops`. Its header says "NOTHING IS ACTIVATED. No copy has run, no route
serves these tables, no client reads them."

| Table | Columns that matter for detail read |
|---|---|
| `work_orders` | `id`, `tenant_id`, `operating_company_key` (NOT NULL), `work_order_number` (`WO-YYYY-NNNNNN`), `status` (11-value enum `ops_work_order_status`), `work_order_type`, `priority` 1-4, `severity`, `customer_id`, `location_id`, `equipment_id` (FK `eos_ops.equipment`), `sales_order_id`, `scheduled_start/end`, `estimated_duration_minutes`, the lifecycle stamps `dispatched_at` through `closed_at`, `complaint`, `diagnosis`, `resolution`, `parts_plan_updated_at`, `provenance` (NATIVE/MIGRATED), `created_by_principal_id` / `updated_by_principal_id` (FK `eos_policy.tenant_memberships`), `created_at`, `updated_at` |
| `work_order_assignments` | `work_order_id`, `assignee_employee_id` (FK `eos_workforce.employees`: an **Employee**, not a technician document or uid), `source`, `reason`, `effective_from/to`, `assigned_by_principal_id`, `ended_by_principal_id`. There is one open interval per Work Order (`work_order_assignments_one_current`), and the `work_order_assignments_current_by_employee` index is the own-record lookup |
| `work_order_schedule_history` | the schedule changes |
| `work_order_transitions` | `from_status`, `to_status`, `action`, `actor_principal_id` (the lifecycle log) |
| `work_order_sales_order_lines` | Sales Order line lineage |

`customer_id` and `location_id` are TEXT with no foreign key to `eos_crm`. The detail page's
customer, site and equipment panels therefore need their own PostgreSQL reads (see 4.8).

**Read projection: NONE.** No `functions/src` module SELECTs a Work Order for display. The only
reads of `eos_ops.work_orders` outside migration tooling are single-column `status` locks inside
the write commands (`workOrderAssignmentAuthority.ts:153`, `workOrderLifecycle.ts:317`,
`workOrderPartsPlanAuthority.ts:206`). `coordinatedVisitPostgresRead.ts` is a list projection for
coordinated visits, gated by `fulfillment.coordinatedVisit.read`. It is not wired, and it is not
a detail read.

**Data: none copied.** `eosOps/migration/workOrderMigrationCopy.ts` and `…DryRun.ts` exist, along
with a field parity matrix. No nonprod COPY of `fieldops_wos` is recorded.

### 4.2 Capability `workOrder.record.read`

It is registered by migration `1762300800000_authority-activation-and-reporting-read.sql:263`
(`workOrder / read / READ`: "Confers no transition, no dispatch, no cancel, no completion and no
creation"). Current holders, all MIGRATION_BACKED by `migration:1762300800000` in
`functions/src/adminPolicy/seed/roleCapabilityAuthorityBaseline.json` (nonprod, 413 grants):

> admin, dispatcher, fieldManager, generalManager, operationsManager, owner, partsAssociate,
> partsManager, shopAssociate, shopManager, technician

**officeManager does not hold it**, but it does hold `workOrder.create` (see 5.1).

**The grant carries no scope.** `role_capabilities` answers WHAT, never WHICH
(`workOrderLifecycle.ts` header, `conditionalEntitlement.ts` "PUT SCOPE ON THE GRANT ROW").
Read literally, the PG grant gives `technician` **every** Work Order. That is wider than Firebase,
where `firestore.rules:508` gives a technician only their own. A PG read authority that evaluated
the flat capability alone would widen technician access on cutover. See 4.3.

### 4.3 Record-assignment semantics: the technician own-record rule

| | Firebase (today) | PostgreSQL (target) |
|---|---|---|
| Rule | `firestore.rules:507-508`: `isAdminOrDispatcher() \|\| (isTechnician() && isOwnTechnician(resource.data.assignedTechId))` | none yet for read |
| "Own" means | `users/{uid}.technicianId == fieldops_wos.assignedTechId` (`firestore.rules:40-42`). The relation depends on a **credential** (a Firestore users document), not on a person | an open `eos_ops.work_order_assignments` interval whose `assignee_employee_id` is the Employee linked to the caller's Principal through the ACTIVE `eos_policy.employee_principal_links` row |
| Evaluator | Rules engine | `eosOps/contextualAuthorization.ts` `RECORD_ASSIGNMENT` / `ASSIGNED_EMPLOYEE`. It is already wired for `recordKind: "workOrder"` (`ASSIGNMENT_RELATIONS` at `:226-232`, employee link at `:258`). It is used today by `workOrder.lifecycle.complete` (`workOrderLifecycle.ts` `LIFECYCLE_CONTEXT_PREDICATES`) |
| Per-Role attachment | implicit in the rule | `eosOps/conditionalEntitlement.ts`: an entitlement triple (grantor Role, capability, condition). `SHIPPED_GRANT_CONDITIONS` is **empty** (`:202`) |

**Authorization v2 `isOwnAssignment` is the wrong evaluator for this.** By accepted ruling
(2026-09-19, `functions/test/conditionKindInventory.test.mjs`), `isOwnAssignment` is the only
ConditionKind with a PG evaluator (`adminPolicy/conditionedCapability.ts`). It compares
**Principal to Principal** (`target.assignedToPrincipalId === actorPrincipalId`), and its three
live grants are on `reorder.purchaseOrder.void`. A Work Order assignee is an **Employee**
(`work_order_assignments.assignee_employee_id`), so the governed Work Order predicate is
`RECORD_ASSIGNMENT` (Employee to Employee through the principal link). Adding `isOwnAssignment`
to `workOrder.record.read` would conflict with the migration's "the assignee is an EMPLOYEE and
the actor is a PRINCIPAL" separation, and it would trip the inventory test. Do not add it.

**What own-only detail read needs (MISSING):** one conditional-entitlement row,
`(technician, workOrder.record.read, RECORD_ASSIGNMENT/ASSIGNED_EMPLOYEE, recordKind workOrder)`,
in `SHIPPED_GRANT_CONDITIONS`. This narrows an existing grant. It never widens one, because the
module can only refuse a caller the flat set already admitted. It is still an authorization-model
change, so it needs an Owner ruling. The owner persona has no Employee link, so any
`RECORD_ASSIGNMENT` path refuses it with `EMPLOYEE_LINK_REQUIRED`. That matters only if the Owner
puts owner on an own-only path.

### 4.4 Persona paths

| Path | Firebase today | PG target |
|---|---|---|
| **Technician (own record)** | `TechnicianDashboard` → `useAssignedWorkOrders(technicianId)` with `technicianId` from `useCurrentTechnician()` (`users/{uid}.technicianId`) → `TechnicianWorkOrderDetail`, plus the `getWorkOrderFieldContext` callable (`callerRole` from `users/{uid}.role`, `getWorkOrderFieldContext.ts:148`). It does **not** use `/service/work-orders/:id` | the same Render detail read, admitted only through `RECORD_ASSIGNMENT` (4.3). The technician's own-list read ("my open assignments") is a **separate** read over `work_order_assignments_current_by_employee`, outside this route's scope |
| **Service manager** (Security Role `fieldManager`) | **denied**: no users document, so `firestore.rules:507-508` fails (section 3) | holds `workOrder.record.read` unconditioned, so detail-all through the Render read with no Firebase dependency |
| **Dispatcher** | served by `isAdminOrDispatcher()` from `users/{uid}.role == "dispatcher"` (a Firebase authority) | holds `workOrder.record.read` unconditioned, so detail-all |
| **Admin** | served by `users/{uid}.role == "admin"` | same as dispatcher |

### 4.5 Render read route (NONE today; proposed shape)

`functions/src/eosOps/eosOpsHttp.ts` has a closed operation list (`OPERATIONS_READ_OPERATIONS`)
with two reads on two routes, `/operations/inventory` and `/operations/experience`
(`OPERATIONS_ROUTE_BY_OPERATION:54-56`). Nothing serves a Work Order. **Proposal (not built):**

- **Route** `/operations/work-orders`, a new honestly-named route in the same transport. Do not
  add it to `/operations/inventory`: the closed map exists so that neither route grows the
  other's surface.
- **Operation** `readWorkOrderRecord` added to `OPERATIONS_READ_OPERATIONS`. Input:
  `{ workOrderId }` only. The tenant, Principal and Employee are resolved server-side, and no
  scope, assignee or "own" flag is accepted (see the caller-controlled-bypass parity defect).
- **Order of checks:** verified identity → EOS Principal/tenant → `workOrder.record.read` in the
  capability set (FORBIDDEN otherwise, before the record is touched) → the conditional
  entitlement (`RECORD_ASSIGNMENT` for a Role whose only grant is conditioned) → SELECT.
  "Capability FIRST", as in `contextualAuthorization.ts`: evaluating the record first would leak
  its existence to a caller with no authority.
- **Response:** the `work_orders` row, the current assignment (Employee id and display name,
  with no credential fields), recent transitions and `schedule_history`. It carries **no action
  list**: the actions stay per-capability (`workOrder.lifecycle.*`, `workOrder.transition`) and
  are resolved separately, so read never implies action.
- **Refusals:** `NOT_FOUND` and `NOT_ASSIGNED` return the same public response to a caller
  without read-all, so the id space is not enumerable.
- **Lives in:** a new `eosOps/workOrderRecordRead.ts` (the SQL, one module), with the transport
  holding no SQL, per the `eosOpsHttp.ts` header.

### 4.6 Client data hook

| Today | Replacement (proposed) |
|---|---|
| `hooks/useWorkOrder.js`: `onSnapshot(doc(db, "fieldops_wos", id))`, a live listener | `useEosWorkOrderRecord(workOrderId)` calling `/operations/work-orders` through the same authenticated client the experience context uses. It keeps the hook's existing `{workOrder, loading, error, retry}` contract so `WorkOrderDetailPage` changes one import. **Live updates are lost**: Render is request/response, so the hook needs either refetch after each action or an explicit poll/push decision. That is a product decision, recorded in section 7 |
| Related reads: `useAccount`, `useLocation`, `useEquipmentDoc`, `useFirestoreCollection("fieldops_technicians")` | PG-served customer (eos_crm), location, equipment (`eos_ops.equipment`) and assignee Employee. **Each needs its own authority**. Until they exist the page cannot be fully PG-backed. The CRM transport is gated by `CRM_WRITER_AUTHORITY` (`crm/crmWriterState.ts`, currently `postgres: "INACTIVE"`), so the customer panel is blocked by CRM cutover |
| `WorkOrderActions` / `getAllowedActions(status, role)` using `users/{uid}.role` | actions derived from PG capabilities (`workOrder.lifecycle.dispatch/cancel/complete`, `workOrder.transition`), fed to the page separately. The page must render read-only for a reader with no action capability |
| Advisory `useWorkOrderReadinessContext`, `useWorkOrderPartsPlanCapability` | stay advisory. They must not block the page |

### 4.7 Cutover flag and server read state

- **Client (exists, #1980):** `WORK_ORDER_RECORD_READ_EOS_BACKEND` in
  `field-ops-app-vite/src/navigation/workOrderRouteAccess.js:101`, committed
  `FIREBASE_ROLE_GATED`. Only the exact `EOS_POSTGRES_ACTIVE` opens the route, and only for
  sessions the EOS surfaces already admit.
- **Server (MISSING, proposed):** a committed code constant
  `WORK_ORDER_READ_AUTHORITY = { postgres: "INACTIVE" | "ACTIVE" }` in
  `eosOps/workOrderAuthorityState.ts`, modelled on `crm/crmWriterState.ts` and
  `catalogMaster/catalogWriterState.ts`. It is not an environment variable and not a Firestore
  flag: either would be a second place the answer lives. `readWorkOrderRecord` refuses 503
  `POSTGRES_WORK_ORDER_READ_INACTIVE` until ACTIVE, because an un-copied PG table is not an
  authoritative answer. Order: COPY/VERIFY → server `ACTIVE` → client constant `EOS_POSTGRES_ACTIVE`
  in the same change that swaps the hook. **Read ACTIVE is only coherent once PG is also the
  Work Order writer** (5.7). Before that, PG rows go stale at the first Firestore
  transition. This couples read activation to write activation for **every** Work Order writer
  (`transitionWorkOrder`, `completeAssignedJob`, `updateWorkOrderExecutionData`, scheduling,
  parts plan, labor, install, consumption), not only create.

### 4.8 Firebase deletion condition (detail read)

Delete the Firebase detail path when **all** of these hold:

1. No client module reads `fieldops_wos`. That covers `useWorkOrder`, `useAssignedWorkOrders`,
   `useSchedulingData`, `usePartWorkOrderDemand`, `useSessionActivityFeed` and the rest. This
   route alone does not retire the collection.
2. No server module reads `fieldops_wos`. Today 27 non-test `functions/src` files name it,
   including `getWorkOrderFieldContext`, `salesOrderReadService`, `coordinatedVisitReadService`,
   `reportCatalog` and the AI context builders.
3. The PG read state is ACTIVE and the client constant is `EOS_POSTGRES_ACTIVE`.
4. Then remove `match /fieldops_wos` (`firestore.rules:506-509`). This is a protected Rules
   change and needs Owner authorization. Remove `isTechnician` / `isOwnTechnician` only after
   their last other consumer is gone, and `isAdminOrDispatcher` / `userRole` last, since they
   also gate accounts, locations, equipment and technicians.

---

## 5. CREATE: full EOS dependency map

Create is its own authority, and nothing here is inferred from detail read (section 4).

### 5.1 Capability `workOrder.create`: who holds it

| Source | Holders |
|---|---|
| **PG baseline** (`roleCapabilityAuthorityBaseline.json`, all MIGRATION_BACKED by `migration:1761523200000`) | admin, dispatcher, fieldManager, generalManager, **officeManager**, operationsManager, owner, partsAssociate, partsManager, shopAssociate, shopManager (11) |
| **Legacy callable** (`functions/src/createWorkOrder.ts:145-147`) | `users/{uid}.role` ∈ {admin, dispatcher} only. Every other PG holder is refused `permission-denied` |
| **Legacy seam callers** of the shared `createWorkOrderRecord` core | `inboundWork/inboundDecisionCommands.ts:167` (accept an inbound request) and `salesOrder/createServiceForSalesOrder.ts:202` (Sales → Service). Each has its own gate |

Observation: officeManager holds create but not `workOrder.record.read`, so it could create a
Work Order it cannot read back. Migration 1762300800000's edit-without-read reconciliation
counted `workOrder.transition`, not `workOrder.create`. Surfaced here and not changed.

### 5.2 Required fields

| Field | Legacy `createWorkOrder.ts` `assertValidInput` | PG `eosOps/workOrderCreateCommand.ts` | Gap |
|---|---|---|---|
| customerId | required | required (`CUSTOMER_REQUIRED`) | PG has no FK to eos_crm, so the customer is unverified |
| locationId | required | required (`LOCATION_REQUIRED`) | same, no FK |
| priority | 1-4 required | 1-4 required | none |
| type | `type` **or** `complaint` required | `workOrderType` **required**, from the governed set | PG is stricter: a complaint-only legacy create is refused. The field name also differs (`type` vs `workOrderType`) |
| severity, complaint | optional | optional | none |
| equipmentId | optional. Checked in the transaction: `assertEquipmentAllowedForType` (INSTALL refuses a unit) and `assertEquipmentIntegrity` (the unit's account and location must match) | optional. Id shape plus FK existence only | **PG lacks the type rule and the account/location integrity check** |
| salesOrderId | seam callers only | accepted | the PG command has no `salesOrderLineRefs`, `inventorySnapshot`, `inboundWorkRequestId`, `externalReference` or `authorizationNumber`, which the seam callers set |
| idempotencyKey | optional, a replay marker via the audit event id | **not accepted** (`INPUT_FIELD_NOT_ACCEPTED`) | **PG has no double-submit protection** |
| server-authored fields (id, number, status, tenant, company, createdBy, timestamps) | not accepted | explicitly **refused** (`SERVER_AUTHORED_FIELD_REJECTED`) | none |

### 5.3 Render writer (NONE today; proposed)

`workOrderCreateCommand.createWorkOrder` has **no consumer** outside its own file and tests. The
`eosOpsHttp.ts` operation list is **reads only** (`OPERATIONS_READ_OPERATIONS`), and there is no
mutation list. **Proposal (not built):**

- A separate closed mutation list, `OPERATIONS_MUTATION_OPERATIONS = ["createWorkOrder"]`, on
  its own route (e.g. `POST /operations/work-orders/create`). Keep it separate from the read
  route so that a read-route change can never add a write.
- Composition: identity → Principal/tenant/capabilities → **operating company from the
  authorized command context** (see 5.6) → `createWorkOrder(deps, actor, input)`.
- Before exposing it, close the 5.2 gaps: an idempotency key, the equipment type and integrity
  rules, and the complaint-or-type decision.

### 5.4 Audit

| | Legacy | PG |
|---|---|---|
| Record | Firestore audit event `createWorkOrder` (`stageAuditEvent` / `stageAuditEventWithId`) in the same transaction, with `actorUid` = **Firebase uid** | `work_order_transitions` opening row (`from_status NULL → CREATED`, `action 'create'`, `actor_principal_id`) in the same transaction |
| Missing | none | no `eos_policy.audit_events` row. Other eosOps commands write one (`reorderAssignmentAuthority.ts:217`; `eosWorkforce/commands/employeeCommandKernel.ts:135`). Per the accountability ruling, PostgreSQL is the audit authority. **Decide whether the transition row is sufficient or an audit_events row is also required.** Recommended: write both, the way the reorder command does |

### 5.5 Ownership

Legacy writes **no creator on the record**. The creator exists only in the audit event
(`actorUid`), and the document has no company. PG stamps `created_by_principal_id` (NOT NULL
for NATIVE, FK `tenant_memberships`) and `updated_by_principal_id`. The actor is a
**Principal**, never an Employee or a uid. The record is created **unassigned**
(`workOrderCreateCommand.ts:113`), so creating confers no assignment and no own-record read.

### 5.6 Operating company

PG requires `actor.operatingCompanyId` from the authorized context and resolves the key through
`operatingCompanyBinding.resolveOperatingCompanyKeyForCompany`. It never infers the company from
the customer, location, creator, tenant or type. Ventana is ACTIVE but unkeyed, so it fails
closed with `OPERATING_COMPANY_KEY_NOT_BOUND` by design. **MISSING:** the transport has no
operating-company source. Something must state which company the session acts for (an
experience-context selection or a single-company default), and that is an Owner/architecture
choice. Legacy has no operating company at all.

### 5.7 Dispatch relationship

Create and dispatch are separate capabilities, and neither implies the other.
`workOrder.create` puts a record in `CREATED` status, unassigned. Assignment and dispatch are
`workOrder.lifecycle.dispatch` (`workOrderAssignmentAuthority.ts` `WORK_ORDER_ASSIGN`), held
by admin, dispatcher (NONPROD_ACTIVATION) and fieldManager (MIGRATION_BACKED). Eight of the 11
create holders cannot dispatch what they create. That is coherent, because the business
schedules after creating. The #1980 route guard today opens the wizard only to dispatch holders
(`service.dispatch`). A create-grained surface is Owner decision D-2.

### 5.8 Client hook

| Today | Replacement (proposed) |
|---|---|
| `WorkOrderWizard.jsx` → `services/workOrderService.ts:35` `httpsCallable("createWorkOrder")`, with a stable `idempotencyKey` per wizard mount (`:108-114`) | `createEosWorkOrder(input)` POSTing to the Render create route. It must keep the stable idempotency key (so the PG command must accept one) and rename `type` → `workOrderType` |
| Pickers `useAccountPicker` / `useLocationsForAccount` / `useEquipmentForAccount` read Firestore (Rules `:1288`, `:1293`, `:1456`, all `isAdminOrDispatcher`) | PG-served pickers (eos_crm accounts and locations, `eos_ops.equipment`). The customer picker is blocked by CRM cutover (`CRM_WRITER_AUTHORITY.postgres = INACTIVE`) |

### 5.9 Cutover flag and one-writer state

- **Client (exists, #1980):** `WORK_ORDER_CREATE_EOS_BACKEND`
  (`workOrderRouteAccess.js:103`), committed `FIREBASE_ROLE_GATED`.
- **Server (MISSING, proposed):** `WORK_ORDER_WRITER_AUTHORITY = { firestore: OPEN|FROZEN|RETIRED,
  postgres: INACTIVE|ACTIVE }`, with the same state machine as `crmWriterState.ts`
  (OPEN/INACTIVE → FROZEN/INACTIVE → FROZEN/ACTIVE → RETIRED/ACTIVE; OPEN/ACTIVE incoherent;
  nothing leaves ACTIVE). **One writer**: while `firestore` is OPEN, the Render create route
  refuses `POSTGRES_WORK_ORDER_WRITER_INACTIVE`. While `firestore` is FROZEN, the guard is the
  **first act** of the `createWorkOrder` callable **and** of the shared `createWorkOrderRecord`
  core, so the inbound-accept and Sales → Service seams freeze too. Freezing only the callable
  would leave two live create writers.
- **Scope warning:** the writer state cannot be create-only. A Work Order created in PG has to
  be transitioned, scheduled, completed and costed in PG, and every one of those writers
  (section 4.7 list) still targets `fieldops_wos`. Either the writer state covers all Work
  Order writers in one window, or PG create stays INACTIVE until they move. A PG create with
  Firestore lifecycle writers would split the record across two authorities.

### 5.10 Firebase deletion condition (create)

Delete when **all** of these hold:

1. `WORK_ORDER_WRITER_AUTHORITY` is RETIRED/ACTIVE.
2. No client calls `createWorkOrderCallable` (`services/workOrderService.ts:35`).
3. `inboundDecisionCommands` and `createServiceForSalesOrder` create through the PG command.
4. Then delete the `createWorkOrder` callable, its export in `functions/src/index.ts`, its
   `getCallerContext` role check (`createWorkOrder.ts:145`) and `createWorkOrderRecord`.
5. Retire the Firestore `counters` allocator only after the PG allocator (migration
   `1761177600000`, `workOrderNumbering.ts`) has been seeded **above** the highest migrated
   legacy number, so numbers never collide.

---

## 6. PROPOSED AUTHORITY MATRIX

**PROPOSAL — this is not a grant change.** No `role_capabilities`, `SHIPPED_GRANT_CONDITIONS`,
Firebase or catalog row is changed by this document. "Current PG" is read from
`roleCapabilityAuthorityBaseline.json` (nonprod, measured 2026-09-24). Persona → Security Role
mappings come from `functions/scripts/fixtures/personaBusinessNeeds.v1.json` P01-P16 and
`config/sandboxRoleIdentityRegistry.json`.

| Persona (Security Role) | PG `record.read` | PG `create` | PG `lifecycle.dispatch` | Firebase today (detail / create) | **Proposed detail-own** | **Proposed detail-all** | **Proposed create** |
|---|---|---|---|---|---|---|---|
| administrator (`admin`) | yes | yes | yes (NONPROD_ACTIVATION) | yes / yes (users.role) | — | **yes** | **yes** |
| dispatcher (`dispatcher`) | yes | yes | yes (NONPROD_ACTIVATION) | yes / yes (users.role) | — | **yes** | **yes** |
| serviceManager (`fieldManager`) | yes | yes | yes | **no / no** (no users doc) | — | **yes** | **yes** |
| serviceTechnician (`technician`) | yes (**unscoped** grant) | no | no (`complete` only) | own only / no | **yes, via RECORD_ASSIGNMENT entitlement** | **no** (never unscoped) | no |
| ownerExecutive (`owner`) | yes | yes | no | no / no | — (no Employee link) | D-1 | D-2 |
| generalManager | yes | yes | no | no / no | — | D-1 | D-2 |
| partsManager (+`purchasingManager`) | yes | yes | no | no / no | — | D-1 | D-2 |
| partsAssociate (+`inventoryReceivingClerk`) | yes | yes | no | no / no | — | D-1 | D-2 |
| officeManager | **no** | yes | no | no / no | — | D-1 (would need a new grant) | D-2 (create without read-back unless D-1 is also granted) |
| warehouseManager, warehouseAssociate, retailSales, nationalAccountsSales, financeAccounting, reportingAnalyst, generalEmployee | no | no | no | no / no | no | no | no |
| (no canonical persona) operationsManager, shopManager, shopAssociate | yes | yes | no | n/a | — | D-1 | D-2 |

The first three rows are Firebase-admin/dispatcher parity plus the dispatch holder, and they need
**no grant change**: they already hold both capabilities unconditioned. The technician row needs
one **narrowing** entitlement so the PG read does not widen past `firestore.rules:508`. Every
"D-" cell is a question for the Owner, and this document does not answer it.

## 7. Owner decisions (separate; one is not inferred from the other)

**D-1: DETAIL personas.** Beyond admin, dispatcher and serviceManager, which `workOrder.record.read`
holders get the detail route, and at what reach?

- Technician: approve the own-only `RECORD_ASSIGNMENT` conditional entitlement (a narrowing),
  or keep the technician on `TechnicianWorkOrderDetail` only.
- owner, generalManager, partsManager, partsAssociate (and operations/shop): detail-all
  read-only (no actions), an Operational-Scope-limited read, or none. Granting any of them
  needs a surface earned by `workOrder.record.read` (the catalog has none) and a page that
  renders read-only.
- officeManager: grant `workOrder.record.read` or not. This is a grant change.
- Also decide: live updates on the Render read (refetch, poll or push).

**D-2: CREATE personas.** Beyond admin, dispatcher and serviceManager, which `workOrder.create`
holders get the wizard?

- owner, generalManager, officeManager, partsManager, partsAssociate (and operations/shop):
  these need a create-grained surface earned by `workOrder.create` alone. Create does not give
  dispatch (5.7).
- Also decide: the operating-company source for the create context (5.6), the complaint-only
  create (5.2), and whether a `transition` row is enough audit or an `audit_events` row is also
  required (5.4).

Granting D-2 does not imply D-1, and granting D-1 does not imply D-2. A persona who can create a
Work Order but not read it back (officeManager today), or the reverse (technician), is a
legitimate outcome that the Owner must choose explicitly.

## 8. Missing pieces (consolidated)

1. The PG Work Order detail read module and the `/operations/work-orders` route (4.5).
2. The technician own-only conditional entitlement (4.3). Needs an Owner ruling.
3. The server read state and writer authority state, `workOrderAuthorityState.ts` (4.7, 5.9).
4. Nonprod COPY/VERIFY of `fieldops_wos` (tooling exists, not run).
5. PG-served customer, location, equipment and assignee reads for the page and the pickers.
   The customer ones are blocked by CRM cutover.
6. A PG action/capability feed that replaces `getAllowedActions(role)` in `WorkOrderActions`.
7. PG create gaps: idempotency key, equipment type and integrity rules, complaint-or-type,
   seam fields, an audit_events row (5.2, 5.4).
8. A Render mutation list and create route (5.3), plus an operating-company source (5.6).
9. Migration of every other `fieldops_wos` writer before read or write ACTIVE is coherent
   (4.7, 5.9).
10. A surface catalog entry for D-1 and/or D-2 if the Owner grants either.
