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

## 4. Owner decisions (separate; not taken here; one is not inferred from the other)

**D-1: Detail read for `workOrder.record.read` holders (technician, parts and shop associates,
managers without dispatch).**

- *If granted:* this needs a surface earned by `workOrder.record.read` (the catalog has none) and
  a detail page whose actions are not dispatcher-only. On the Firebase path a technician can read
  only their own assigned Work Orders (`firestore.rules:508`), and parts/shop associates cannot
  read any. So the grant is only meaningful on the PG read path, and it needs a scoping decision
  (all records, or assigned/scoped ones).
- *If refused:* technicians keep their own-assignment surface (TechnicianWorkOrderDetail), and
  other readers keep the list surface only.

**D-2: Create for `workOrder.create` holders without dispatch** (officeManager, partsAssociate,
partsManager, shopAssociate, shopManager, generalManager, operationsManager, owner).

- *If granted:* this needs a create-grained surface and the PG create path. The Firebase callable
  refuses all of these roles at `createWorkOrder.ts:146`. Owner is also employee-unlinked, so any
  employee-scoped predicate refuses it `EMPLOYEE_LINK_REQUIRED`.
- *If refused:* create stays with admin, dispatcher and fieldManager.

Granting D-2 does not imply D-1, and granting D-1 does not imply D-2. A person who can create a
Work Order but cannot read it back, or the reverse, is a legitimate outcome that the Owner must
choose explicitly.
