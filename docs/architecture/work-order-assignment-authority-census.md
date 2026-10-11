# Work Order Assignment Authority: Census, Target Model and Migration Plan

**Status: CENSUS + TARGET MODEL + MIGRATION PLAN ONLY.** This document adds no runtime code, no
migration, no tests and no Rules change. It changes no production or Firebase data. Every claim is
tied to repository truth at `main` `736b1f17`, cited as `path:line`. Where something was checked and
not found, the document says so and names the search.

**Program context.** Business authority is moving from Firestore to PostgreSQL behind the Render
trusted API (`functions/src/eosApi/server.ts`). Firebase stays as transitional identity only, and
this plan adds no new Firebase dependency. It holds four separations throughout and never collapses
them: **Owner != Accountable != Assignee**, **Credential != Principal != Employee**, **Security Role
!= assignment identity**, and **assignment never changes record ownership** unless a separate
governed ownership action runs. Job Role PostgreSQL authority is **NOT IMPLEMENTED** and this plan
does not depend on it.

---

## 0. Headline findings

1. **The assignment authority is two single-valued fields on the Firestore Work Order document**
   (`fieldops_wos`): `scheduledTechId` (the planning assignee) and `assignedTechId` (the dispatched
   assignee). `functions/src/types/workOrder.ts:107,122`. Three trusted server paths write them.
   Clients cannot (`firestore.rules:506-509`).
2. **The assignee identity is a `fieldops_technicians` document id.** It is not an Employee id, not
   a Principal id and not a Firebase uid. The caller becomes "the technician" only through
   `users/{uid}.technicianId`, a Firebase-credential-keyed document (`functions/src/callerContext.ts:15-22`).
   Nothing in PostgreSQL knows about assignment.
3. **History is weak.** The only durable record is Firestore `auditEvents` with free-text summaries.
   The **initial** assignment (Schedule) records no technician at all. One defect found by reading
   the code (DEF-9, section 4) lets a later `Schedule` **overwrite** the earlier generic transition
   audit event.
4. **There is no team or multi-technician model.** No arrays, crews, helpers or lead/secondary roles
   exist anywhere.
5. **Assignment cannot move to PostgreSQL on its own.** The same Firestore transaction reads the
   assignment, checks lifecycle status, checks conflicts and writes status (section 12). So
   assignment authority has to move **with** Work Order record and lifecycle authority, and that
   migration is DEFERRED (Commercial wave ruling D2 excluded Work Orders). **EMP-RT-05
   `listAssignedWorkForEmployee` therefore has no PostgreSQL source until that wave runs.**
6. **Owner/Accountability conflation: NO.** Work Order ownership is COMPANY class and explicitly
   excludes `assignedTechId` (`functions/src/ownership/ownershipMatrix.ts:199-201`). Work Orders are
   outside the accountability scope. Only naming defects exist (DEF-6).

---

## 1. Current authority

### 1.1 Fact table

| Fact | Source of truth | Writers | Readers | Evidence |
|---|---|---|---|---|
| Planning assignee | `fieldops_wos/{id}.scheduledTechId` | `transitionWorkOrder` action `Schedule` (sets), `Dispatch` (realigns to the dispatched technician), `Unschedule` (deletes). `rescheduleWorkOrder` and `reassignScheduledWorkOrder` (rewrite under SCHEDULED) | `placementPolicy.checkPlacement` overlap query; Dispatch reassignment detection; DispatcherBoard lanes; Dispatch.jsx; seeds | `functions/src/transitionWorkOrder.ts:293-295,377,413-415`; `functions/src/scheduling/schedulingCommands.ts:225-227`; `functions/src/scheduling/placementPolicy.ts:109-122`; `field-ops-app-vite/src/modules/dispatcherBoard/DispatcherBoard.jsx:171-172` |
| Dispatched assignee | `fieldops_wos/{id}.assignedTechId` | `transitionWorkOrder` action `Dispatch` **only** | Technician action gate (`isOwnAssignment`); `updateWorkOrderExecutionData` guard; labor command; install command; field context; consumption source; Rules read predicate; technician dashboards and analytics | `functions/src/transitionWorkOrder.ts:206-208,366`; `functions/src/updateWorkOrderExecutionData.ts:162`; `functions/src/workOrderLabor/workOrderLaborCommand.ts:370`; `functions/src/workOrderInstall/workOrderInstallCommand.ts:239`; `functions/src/getWorkOrderFieldContext.ts:122-126`; `firestore.rules:508` |
| Latest Dispatch reassignment snapshot | `reassignedFromTechId`, `reassignedAt`, `reassignedReason`, `reassignedByUid` (overwritten each time) | `transitionWorkOrder` Dispatch when `assignedTechId != scheduledTechId` | Boards (display) | `functions/src/transitionWorkOrder.ts:380-385`; `functions/src/types/workOrder.ts:136-146` |
| Latest scheduled reassignment/reschedule snapshot | `rescheduledFromTechId`, `rescheduledFromStart/End`, `rescheduledAt`, `rescheduledReason`, `rescheduledByUid` (overwritten; deleted by Unschedule) | `applyScheduleChange` (reschedule/reassign) | Boards (display) | `functions/src/scheduling/schedulingCommands.ts:229-237`; `functions/src/transitionWorkOrder.ts:420-425`; `functions/src/types/workOrder.ts:124-134` |
| Scheduled window | `scheduledStart`, `scheduledEnd` | Schedule / reschedule / Unschedule | Placement policy, boards, `service.workOrder.pastDue.count` | `functions/src/transitionWorkOrder.ts:293-294`; `functions/src/performance/performanceMetricRegistry.ts:202-209` |
| Assignment timestamps | `dispatchedAt` (execution, immutable); `reassignedAt`; `rescheduledAt`; `updatedAt`. **No `assignedAt` or `scheduledAt` exists.** | transitionWorkOrder / scheduling commands | Analytics, timelines | `functions/src/transitionEngine.ts:92-101`; `functions/src/types/workOrder.ts:148-155` |
| Assignment history | Firestore `auditEvents` (client read/write denied), actions `transitionWorkOrder`, `reassignWorkOrderTechnician`, `rescheduleWorkOrder`, `reassignScheduledWorkOrder`, `unscheduleWorkOrder` | Same transactions as the business writes | No product reader of assignment history found | `functions/src/types/access.ts:458-495`; `firestore.rules:1692-1694`; `functions/src/access/auditEventWriter.ts:811-824` |
| Caller -> technician | `users/{uid}.technicianId` | `functions/scripts/assignTechnicianToUser.js` (Admin SDK, manual, project-guarded) | `getCallerContext` (every WO callable); Rules `isOwnTechnician` / `callerTechnicianId`; `useCurrentTechnician` | `functions/src/callerContext.ts:15-22`; `firestore.rules:40-41,323-327`; `field-ops-app-vite/src/hooks/useCurrentTechnician.js:12-13,66-69` |
| Technician record / live status | `fieldops_technicians/{technicianId}` (`status` available/on_job/off_shift) | Client `createTechnician` (auto-id); admin/dispatcher client `status` update; `completeAssignedJob` | `placementPolicy` eligibility; scheduling read service; boards | `field-ops-app-vite/src/domain/jobActions.js:40-41`; `field-ops-app-vite/src/modules/technicians/Technicians.jsx:2`; `firestore.rules:397-418`; `functions/src/scheduling/placementPolicy.ts:80-95` |
| Same-technician serialization | `work_order_tech_locks/{technicianId}` (sentinel, no data) | Schedule/Dispatch/Unschedule; reschedule/reassign; blocked-time create/delete | Same transactions | `functions/src/transitionWorkOrder.ts:54-56,244-257,543-545`; `functions/src/scheduling/schedulingCommands.ts:54,213-224` |
| Technician availability | `technician_working_availability/{technicianId}`, `technician_blocked_time/{blockId}.technicianId` | Scheduling commands | `checkPlacement`, `readTechnicianAvailability` | `functions/src/scheduling/schedulingCommands.ts:401-593`; `firestore.rules:1773-1778` |
| Legacy job assignee | `fieldops_jobs/{id}.technicianId` | `assignJob` client transaction (**no live importer found**; only `createTechnician` from that module is imported) | Rules; `completeAssignedJob` guard | `field-ops-app-vite/src/domain/jobActions.js:89-127`; `firestore.rules:353-395`; `functions/src/completeAssignedJob.ts:270-276` |
| PostgreSQL assignment | **None.** No work-order record table and no assignee column in `eos_ops` | none | none | `functions/migrations/1758067200000_inventory-commitment-and-work-order-replay.sql:163-252` (only `inventory_commitments` and `work_order_inventory_effects`, `work_order_id TEXT` with no FK) |

### 1.2 Dispatcher assignment commands

| Command | Input | Status effect | Assignment effect | Authorization | Audit |
|---|---|---|---|---|---|
| `transitionWorkOrder` `Schedule` | `scheduledStart`, `scheduledEnd`, `scheduledTechId` (all required) | READY_TO_DISPATCH -> SCHEDULED | sets `scheduledTechId`; runs full `checkPlacement` (past start, eligibility, blocked time, overlap, working-hours warnings) | role `admin`/`dispatcher` (`transitionEngine.ts:134`) | generic `transitionWorkOrder` event only. **The summary names no technician** (`transitionWorkOrder.ts:561-571`) |
| `transitionWorkOrder` `Dispatch` | `assignedTechId` (required), `reassignReason` (required iff different from `scheduledTechId`) | SCHEDULED -> DISPATCHED | sets `assignedTechId`; realigns `scheduledTechId`; stamps `dispatchedAt`; writes `reassigned*` on reassignment; double-booking and overlap guard against the new technician | `admin`/`dispatcher` (`transitionEngine.ts:135`) | generic event, plus `reassignWorkOrderTechnician` on reassignment (`transitionWorkOrder.ts:594-618`) |
| `transitionWorkOrder` `Unschedule` | `unscheduleReason` required | SCHEDULED -> READY_TO_DISPATCH (the only reverse edge) | deletes `scheduledTechId`, window and `rescheduled*` | `admin`/`dispatcher` (`transitionEngine.ts:133`) | generic event plus `unscheduleWorkOrder` naming prior technician and window (`transitionWorkOrder.ts:573-592`) |
| `rescheduleWorkOrder` | window, optional `scheduledTechId`, `reason`, optional `expectedScheduledStart` | none (must be SCHEDULED) | rewrites `scheduledTechId` + window; `rescheduled*` snapshot | `requireDispatcher` role check (`schedulingCommands.ts:81-90`) | `rescheduleWorkOrder` (`schedulingCommands.ts:245-256`) |
| `reassignScheduledWorkOrder` | `scheduledTechId`, `reason` | none (must be SCHEDULED) | rewrites `scheduledTechId`, keeps window from record | `requireDispatcher` | `reassignScheduledWorkOrder` |
| Client surfaces | Dispatch.jsx `assign()`; DispatcherBoard lane drops; ControlTower WorkOrderActions | via the callables above | none directly | UI mirror only | none |

Client call sites: `field-ops-app-vite/src/modules/dispatch/Dispatch.jsx:111-143`,
`field-ops-app-vite/src/modules/dispatcherBoard/DispatcherBoard.jsx:75-78,255-288,725`,
`field-ops-app-vite/src/modules/controlTower/WorkOrderActions.jsx:146`,
`field-ops-app-vite/src/services/schedulingCommandClient.js:60-78`.

### 1.3 Technician-side consumers of assignment (the assignment gate)

| Consumer | Guard | Evidence |
|---|---|---|
| Accept / Travel / Arrive / WorkStart / Complete | `requiresOwnAssignment`: `wo.assignedTechId === caller.technicianId` | `functions/src/transitionEngine.ts:138-142`; `functions/src/transitionWorkOrder.ts:206-208` |
| Execution capture (qtyUsed, notes, physical consumption) | role technician + `wo.assignedTechId !== caller.technicianId` refuses; terminal refuses | `functions/src/updateWorkOrderExecutionData.ts:127-169` |
| Labor record | `wo.assignedTechId !== technicianId` refuses; request may not carry `technicianId` | `functions/src/workOrderLabor/workOrderLaborCommand.ts:132,162,335-341,370` |
| Install at completion | `actor.technicianId` must equal `wo.assignedTechId` | `functions/src/workOrderInstall/workOrderInstallCommand.ts:239` |
| Field context read | assignment boundary | `functions/src/getWorkOrderFieldContext.ts:122-126,139-151` |
| AI Work Order context authority | mirrors the Rules predicate | `functions/src/ai/workOrderContext.ts:16,59-62` |
| Client read (Rules) | technician reads only `assignedTechId == users/{uid}.technicianId`, so **SCHEDULED work is invisible to its planned technician** | `firestore.rules:506-509` |
| Technician list query | `where("assignedTechId","==",technicianId) limit 100` | `field-ops-app-vite/src/services/workOrderService.ts:126`; `field-ops-app-vite/src/hooks/useAssignedWorkOrders.js:16` |

### 1.4 Reporting and performance consumers

- `getTechnicianExecutionStats(technicianId)` queries `assignedTechId`
  (`field-ops-app-vite/src/analytics/executionAnalyticsService.ts:135-136`). A per-technician rollup
  groups by `assignedTechId` (`:256-260`).
- Team projection groups by `assignedTechId` (`field-ops-app-vite/src/domain/dashboardTeamProjections.js:83`).
- Metric registry: `technician.workOrder.completed.cumulative.count` and
  `technician.workOrder.open.count` take their actuals from the queries above but support only
  `EMPLOYEE` scope (`functions/src/performance/performanceMetricRegistry.ts:327-352`). Goal targets
  use `employeeId` (`field-ops-app-vite/src/domain/dashboardComposition.js:517-519`;
  `field-ops-app-vite/src/modules/technicianDashboard/TechnicianPerformance.jsx:43-44`). See DEF-5.
- `service.workOrder.schedulingConflict.count` uses the overlap primitives
  (`performanceMetricRegistry.ts:232-238`).

### 1.5 Certification world (read-only mention; FROZEN)

`functions/scripts/certificationWorld/data/workforceLoad.mjs:118-121` authors
`fieldops_technicians` with `technicianId: e.employeeId` and `employeeId: e.employeeId`. That is
fixture authoring. It is **not** evidence of a mapping rule, and this plan neither reads nor changes
it.

---

## 2. Identity

### 2.1 Canonical assignee identity today

The canonical assignee identity is the **`fieldops_technicians` document id**, stored in
`assignedTechId` / `scheduledTechId`. `functions/src/scheduling/types.ts:41` says so ("Document id
IS the technicianId"), and so does the client projection comment
(`field-ops-app-vite/src/domain/accountWorkOrders.js:106`, "fieldops_technicians doc id | null").
Every scheduling artifact is keyed the same way: availability doc id, blocked-time `technicianId`,
lock doc id.

The id is **not** issued by any identity authority:
- A client `techniciansStore.add(...)` mints it as a Firestore auto-id
  (`field-ops-app-vite/src/domain/jobActions.js:40-41`, imported by `modules/technicians/Technicians.jsx:2`).
- Seeds author it (`tech-sbx-01`, `tech-sbx-02`, `tech-sbx-other` in
  `functions/scripts/seedSandboxTransactional.js:262-421`).

### 2.2 How the caller becomes "the technician"

```
Firebase ID token -> uid (Credential)
  -> Firestore users/{uid}.technicianId          (callerContext.ts:15-22; Rules callerTechnicianId firestore.rules:323-327)
       -> compared by string equality to fieldops_wos.assignedTechId
```

- `users/{uid}.technicianId` is written only by `functions/scripts/assignTechnicianToUser.js`
  (manual, Admin SDK). Its header says: "No automatic mapping exists."
- `users/{uid}.role` gives the Security Role bucket (`admin|dispatcher|technician`) through the same
  document. The **action gate** uses that role, while the **identity** comes from `technicianId`.
  So the Security Role is not the assignee identity today, and the target model keeps it that way.
- The PostgreSQL `principalContext` / `eos_policy.employee_principal_links` path is **not consulted**
  by any Work Order command (search: `getCallerContext` call sites in `functions/src`).

### 2.3 Technician <-> Employee <-> Principal mapping

| Link | Exists? | Where | Enforced? |
|---|---|---|---|
| uid -> technicianId | yes | `users/{uid}.technicianId` | admin-authored, no FK |
| uid -> employeeId | yes, **independently** | `users/{uid}.employeeId` (`field-ops-app-vite/src/auth/employeeSession.js:53`) | admin-authored, no FK |
| technicianId -> employeeId | **no governed link** | only as an optional field on fixture technicians (`workforceLoad.mjs:121`); not read by runtime | none |
| Employee <-> Principal | yes (PG) | `eos_policy.employee_principal_links` (`functions/migrations/1758412800000_employee-principal-linkage.sql:115-173`, one active link per employee and per principal); employee FK deferred (`functions/migrations/deferred/1759190400000_employee-principal-link-employee-fk.sql`) | DB constraints |
| Principal <-> uid | yes (PG) | `(identity_provider, external_subject)` (`functions/migrations/1757548800000_tenant-and-identity.sql`) | DB constraints |
| Employee (PG) | yes | `eos_workforce.employees (id, tenant_id, employment_status, operating_company_id)` with `UNIQUE (tenant_id, id)` (`functions/migrations/1759104000000_employee-business-authority.sql:289-306`); **no `technician_id` by ruling** (`:250-252`) | DB constraints |

Standing rulings that bind the resolution. A technician id is **never** an Employee id by
coincidence: 11 of 13 sandbox technician ids equal employee ids and 2 do not
(`functions/migrations/1758412800000_employee-principal-linkage.sql:75-90`;
`scripts/employeeTruckCrosswalk.lib.mjs:18-37`;
`functions/src/employeeIdentity/employeePrincipalLinkPlan.ts:38`). Orphan technicians are named and
never minted (`employeePrincipalLinkPlan.ts:320-333`).

### 2.4 Identity defects

- **DEF-1: The Credential document is the business-identity resolver.** The Firebase-uid-keyed
  `users/{uid}` is the only server source of "who is the technician" for every Work Order command
  (`functions/src/callerContext.ts:15-22`). This breaks Credential != Principal != Employee.
- **DEF-2: Two unreconciled mappings on one credential.** `users/{uid}.technicianId` and
  `users/{uid}.employeeId` are authored separately (`assignTechnicianToUser.js`; employee
  provisioning). Nothing checks that they name the same person.
- **DEF-3: The assignee id has no identity authority.** It is a client-minted auto-id or a
  seed-authored string (section 2.1). It is not an Employee.
- **DEF-4: Technician id compared to an Employee id (truck).**
  `trucks.assignedDriverEmployeeId` holds an Employee id (validated active Employee,
  `functions/src/truckRegistry/truckRegistryCommands.ts:193,278-283`). It is compared by equality to
  `users/{uid}.technicianId` in `functions/src/workOrderConsumption/consumptionSourceService.ts:61,76`,
  `functions/src/inventoryTransfer/transferReceivableRead.ts:92-96` and
  `functions/src/cycleCount/cycleCountSheetCallables.ts:221-225`. It is correct only where the ids
  happen to coincide.
- **DEF-5: EMPLOYEE-scoped goals over technician-keyed actuals.** See section 1.4. The goal target
  is `employeeId` but the actual is computed from `assignedTechId`, so the equivalence is implicit.
- **DEF-7: Misdocumented id kind.** `functions/src/fulfillment/coordinatedVisitReadService.ts:75`
  calls `assignedTechId`/`scheduledTechId` "raw UID". They are technician document ids. A migration
  reader must not resolve them as uids.

Search for uid-as-assignee: no code writes a Firebase uid into `assignedTechId`/`scheduledTechId`
(all writers in section 1.2 take the id from input validated against `fieldops_technicians`). The
uid is still the **key** of the resolution (DEF-1). Actor fields `reassignedByUid` /
`rescheduledByUid` and audit `actorUid` are uids, which the target model replaces with Principal ids.

---

## 3. Lifecycle

### 3.1 State machine (ADR-002) and assignment

`functions/src/transitionEngine.ts:39-51`:

```
CREATED -> READY_TO_DISPATCH -> SCHEDULED -> DISPATCHED -> ACCEPTED -> EN_ROUTE -> ARRIVED -> WORK_IN_PROGRESS -> COMPLETED -> CLOSED
                     ^______________| (Unschedule, ND-18: only reverse edge)
(any non-terminal) -> CANCELLED
```

| WO status | Planning assignee (`scheduledTechId`) | Dispatched assignee (`assignedTechId`) |
|---|---|---|
| CREATED, READY_TO_DISPATCH | absent (Unschedule deletes it) | absent |
| SCHEDULED | present, mutable by reschedule/reassign | absent |
| DISPATCHED .. WORK_IN_PROGRESS | equal to `assignedTechId` (realigned at Dispatch, `transitionWorkOrder.ts:377`) | present, **immutable**. No command changes it |
| COMPLETED, CLOSED | retained | retained (`updateWorkOrderExecutionData.ts:165-166`: "The assignment remains on the document after a transition") |
| CANCELLED | retained as it was at cancel time (a SCHEDULED cancel leaves only `scheduledTechId`) | retained if dispatched |

### 3.2 Assignment transitions

| Transition | Path | Reason required | Allowed from |
|---|---|---|---|
| Initial planned assignment | `Schedule` | no | READY_TO_DISPATCH |
| Planned reassignment (window kept) | `reassignScheduledWorkOrder` | yes | SCHEDULED (`schedulingCommands.ts:193-198`) |
| Planned reassignment with re-time | `rescheduleWorkOrder` + `scheduledTechId` | yes | SCHEDULED |
| Dispatch to planned technician | `Dispatch` | no | SCHEDULED |
| Dispatch-time reassignment | `Dispatch` with different technician | yes (`transitionWorkOrder.ts:301-309`) | SCHEDULED |
| Unassignment | `Unschedule` (clears the planned assignee) | yes | SCHEDULED only |
| Post-dispatch reassignment | **none exists** | n/a | DISPATCHED onward has no reverse edge (`transitionEngine.ts:36-38`); only Cancel |
| Post-dispatch unassignment | **none exists** | n/a | n/a |

Dispatch is legal only from SCHEDULED, so an assignment always passes through a planned assignee.
That means "planned" and "dispatched" are **one person-axis in two lifecycle phases**, not two
independent facts. H20 forces them equal from Dispatch onward.

### 3.3 Guards, and asymmetries worth knowing before a port

- Double-booking: a technician may not be dispatched while `assignedTechId` is theirs on another WO
  in DISPATCHED..WORK_IN_PROGRESS (`functions/src/workOrderAvailability.ts:32-38`;
  `transitionWorkOrder.ts:314-327`).
- Overlap: same `scheduledTechId` with an intersecting window in a schedule-blocking status
  (`workOrderAvailability.ts:60-64`).
- **Dispatch does not run `checkPlacement`** for a reassigned technician. It re-runs overlap and
  double-booking only, with no eligibility and no blocked-time check (`transitionWorkOrder.ts:311-364`
  compared with `placementPolicy.ts:73-132`).
- **Dispatch locks only the new technician** (`transitionWorkOrder.ts:247-249`). It does not lock the
  prior `scheduledTechId` whose slot it releases, even though Unschedule locks on release
  (`:250-257`).
- Eligibility is `fieldops_technicians.status` in a governed set (`placementPolicy.ts:80-95`). It is
  not Employee lifecycle, skills, certification or Job Role, which do not exist
  (`placementPolicy.ts:84-89`).
- Assignment writes also flip `fieldops_technicians.status` (on_job/available) **only** on the
  legacy `fieldops_jobs` path (`jobActions.js:117-123`; `completeAssignedJob.ts:315-316`). The WO
  engine does not touch technician status.

---

## 4. History

### What exists

| Event | Recorded facts | Structured? | Evidence |
|---|---|---|---|
| Schedule (initial assignment) | actorUid, role, action, status A->B. **No technician, no window** | no | `transitionWorkOrder.ts:561-571` |
| Dispatch (same technician) | as above. **No technician** | no | same |
| Dispatch reassignment | extra event: prior tech, new tech, reason, actor, time, in `summary` prose | no (prose) | `transitionWorkOrder.ts:608-617` |
| Reschedule / reassign scheduled | prior tech + window, new tech + window, reason, warnings, in prose | no (prose) | `schedulingCommands.ts:245-256` |
| Unschedule | prior tech + window + reason, in prose | no (prose) | `transitionWorkOrder.ts:582-591` |
| Denormalized snapshots | latest reassignment / reschedule only; overwritten; Unschedule deletes `rescheduled*` | yes, latest only | `types/workOrder.ts:124-146` |
| Retention | `auditEvents` has no TTL or retention configuration (search `ttl|retention` in `firebase.json`, `firestore.indexes.json`: none) and client access is fully closed | n/a | `firestore.rules:1692-1694` |

### Gaps and defects

- **No assignment history table or collection.** Reconstruction depends on parsing prose.
- **The initial assignee and the dispatched same-technician assignee are never recorded in audit.**
  Only the current document says who it is.
- **DEF-8:** actor identity in history is a Firebase uid (`actorUid`, `reassignedByUid`,
  `rescheduledByUid`), not a Principal.
- **DEF-9 (found by code reading; not reproduced by a test here): a later generic transition audit
  event can overwrite an earlier one.** The generic event id is deterministic on
  `(workOrderId, action)` (`functions/src/workOrderTransitionMath.ts:16-19`). Its header argues this
  is collision-free because the table "is a DAG with no cycles" (`:5-8`). ND-18 later added the cycle
  SCHEDULED -> READY_TO_DISPATCH -> SCHEDULED (`transitionEngine.ts:42`). `stageAuditEventWithId`
  stages `writer.set` (`auditEventWriter.ts:822`), and `transitionWorkOrder` does not read the id
  first. So Schedule -> Unschedule -> Schedule replaces the first `Schedule` event, and a second
  `Unschedule` replaces the first generic `Unschedule` event. The dedicated `unscheduleWorkOrder`
  event survives because it uses a generated id (`stageAuditEvent`). This is a history-integrity
  defect in the current Firestore authority. This lane does not fix it (no runtime changes). It
  matters for export: pre-migration audit history is not a complete record of assignment changes.
- Truck driver assignment history is likewise not persisted
  (`functions/migrations/1758326400000_truck-and-mobile-location-registry.sql:153-157`;
  `functions/src/truckRegistry/operationalReferenceProbe.ts:195`).

---

## 5. Multi-technician / team semantics

**Absent.** Evidence:
- The only assignee fields are the two single-valued strings `assignedTechId?: string` and
  `scheduledTechId?: string` (`functions/src/types/workOrder.ts:107,122`). No array field.
- Search over `functions/src` and `field-ops-app-vite/src` (excluding tests) for
  `crew|helper|secondaryTech|additionalTech|assignedTechIds|leadTech|technicianIds` found no Work
  Order assignment concept. The only hits are "crew's hours" in labor-capability prose
  (`functions/src/access/permissionCatalog.ts:125`) and `technicianIds` as a **read filter** on
  `readTechnicianAvailability` (`functions/src/scheduling/schedulingReadService.ts:74-81`).
- The conflict engine, locks and Rules predicate all assume exactly one technician per Work Order.
- Labor entries are per technician per WO (`workOrderLaborCommand.ts:386`). A second technician
  could record labor only if assigned, and one assignee field makes that impossible today.

Conclusion: current semantics are **one assignee per Work Order**. Teams are an open business
decision (OD-2), not a migration fact.

---

## 6. Vehicle / truck interaction

- **Assignment does not consult trucks.** No Schedule/Dispatch/reschedule/reassign path reads
  `trucks` (see `transitionWorkOrder.ts` and `schedulingCommands.ts`, which have no truck import).
- **Execution does, through DEF-4.** Consumption source options, transfer receivables and technician
  cycle-count sheets find "the technician's truck" as
  `trucks.assignedDriverEmployeeId == users/{uid}.technicianId`.
- Truck driver authority: `trucks.assignedDriverEmployeeId` (Firestore), one truck per Employee
  (`truckRegistryCommands.ts:278-283`), no history.
- PostgreSQL `eos_ops.trucks` deliberately has **no driver column** until Employee identity is
  settled (`functions/migrations/1758326400000_truck-and-mobile-location-registry.sql:160-170`;
  `functions/src/eosOps/migration/truckFleetMigrationSource.ts:57,502`).
- Blocked time kind "truck service" is an availability fact on the technician, not a truck link
  (`docs/architecture/SYSTEM_AUTHORITIES.md:37`).

Target consequence: Work Order assignment and truck-driver assignment are **separate relationships**
that share one endpoint (Employee). The target does not join them. A future "technician's truck"
read would join `work_order_assignments.assignee_employee_id` to a future
`trucks.assigned_driver_employee_id` by Employee id, which removes DEF-4 structurally.

---

## 7. Capabilities

### Existing ids (no invention)

| Id | Where | Used by assignment today? |
|---|---|---|
| `workOrder.create`, `workOrder.transition`, `workOrder.cancel` | `functions/src/access/permissionCatalog.ts:93-112` | **Not enforced** by `transitionWorkOrder`, which gates on `users/{uid}.role` via `ACTION_PERMISSIONS`. Granted in governed/compatibility Roles (`functions/src/access/governedBusinessRoles.ts:216-236`; `functions/src/access/compatibilityRoles.ts:283-299`) |
| `workOrder.labor.record` / `.correct`, `workOrder.parts.plan` | `permissionCatalog.ts:125-147` (active:false) | labor/parts, not assignment |
| `workOrder.lifecycle.dispatch` / `.cancel` / `.complete` | `eos_policy` vocabulary migration 006 `functions/migrations/1757894400000_operational-capability-vocabulary.sql:48-56,97-105` | vocabulary only. MarkReady/Schedule/Unschedule/Accept/Travel/Arrive/WorkStart are **explicitly excluded** (`:56`) |
| Scheduling commands | none, by **Owner ruling 2026-08-27** ("no new capability family is registered") | `transitionEngine.ts:130-132`; `schedulingCommands.ts:83-85`; `SYSTEM_AUTHORITIES.md:36` |
| Work Order read | **none exists** | `functions/src/ai/workOrderContext.ts:18-21` |

### Gaps (stated, not filled)

- There is no capability for planned assignment, reschedule, planned reassignment or unschedule
  (by ruling).
- There is no capability for reading one's own assigned work, which EMP-RT-05 needs.
- There is no capability for reading another Employee's assigned work (a dispatcher view).
- On the Render/PG path, authorization comes from `principalContext` (PG), not `users.role`. So the
  2026-08-27 "role bucket, no capability" ruling has **no PG equivalent**. See OD-6.

---

## 8. Target PostgreSQL model

### 8.1 Design rules drawn from the evidence

1. One person-axis with lifecycle phases (section 3.2). The planned vs dispatched distinction is the
   **Work Order status**, not a second assignee column.
2. One current assignee per Work Order (section 5). Uniqueness is on the **current** row only, and
   history is preserved as rows.
3. The assignee is an **Employee** (`eos_workforce.employees`). It is never a uid, never a
   `fieldops_technicians` id, never a Principal and never a Security Role.
4. The actor is a **Principal** (`eos_policy` membership), never a uid.
5. The scheduled window is a **scheduling** fact and stays on the Work Order record, not on the
   assignment row. Assignment history must not become a second schedule authority.
6. Same-tenant composite foreign keys everywhere, following the
   `employee_principal_links` / `user_role_assignments` precedent
   (`1758412800000_employee-principal-linkage.sql:32-42`).

### 8.2 Table (proposal, not a migration)

```sql
-- eos_ops.work_order_assignments  (proposal; next free migration slot at implementation time)
CREATE TABLE eos_ops.work_order_assignments (
    id                        TEXT PRIMARY KEY,
    tenant_id                 TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    work_order_id             TEXT NOT NULL,
    assignee_employee_id      TEXT NOT NULL,
    -- how this row began; each value is an existing command, plus the one-time import
    source                    TEXT NOT NULL CHECK (source IN
                                ('SCHEDULE','DISPATCH_REASSIGN','RESCHEDULE','REASSIGN_SCHEDULED','MIGRATION')),
    reason                    TEXT,
    effective_from            TIMESTAMPTZ NOT NULL,
    assigned_by_principal_id  TEXT NOT NULL,
    -- closing columns: written once, NULL -> value, never rewritten
    effective_to              TIMESTAMPTZ,
    end_source                TEXT CHECK (end_source IN
                                ('DISPATCH_REASSIGN','RESCHEDULE','REASSIGN_SCHEDULED','UNSCHEDULE')),
    end_reason                TEXT,
    ended_by_principal_id     TEXT,
    recorded_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT wo_assignment_work_order_fk
        FOREIGN KEY (tenant_id, work_order_id) REFERENCES eos_ops.work_orders (tenant_id, id),   -- requires PG Work Order (section 12)
    CONSTRAINT wo_assignment_employee_fk
        FOREIGN KEY (tenant_id, assignee_employee_id) REFERENCES eos_workforce.employees (tenant_id, id),
    CONSTRAINT wo_assignment_assigned_by_fk
        FOREIGN KEY (tenant_id, assigned_by_principal_id) REFERENCES eos_policy.tenant_memberships (tenant_id, principal_id),
    CONSTRAINT wo_assignment_ended_by_fk
        FOREIGN KEY (tenant_id, ended_by_principal_id) REFERENCES eos_policy.tenant_memberships (tenant_id, principal_id),
    CONSTRAINT wo_assignment_close_is_whole CHECK (
        (effective_to IS NULL AND end_source IS NULL AND ended_by_principal_id IS NULL AND end_reason IS NULL)
     OR (effective_to IS NOT NULL AND end_source IS NOT NULL AND ended_by_principal_id IS NOT NULL)),
    CONSTRAINT wo_assignment_interval CHECK (effective_to IS NULL OR effective_to >= effective_from),
    CONSTRAINT wo_assignment_reason_where_required CHECK (
        source NOT IN ('DISPATCH_REASSIGN','RESCHEDULE','REASSIGN_SCHEDULED') OR length(btrim(reason)) > 0),
    CONSTRAINT wo_assignment_end_reason_where_required CHECK (
        end_source IS NULL OR end_source NOT IN ('UNSCHEDULE','DISPATCH_REASSIGN','REASSIGN_SCHEDULED') OR length(btrim(end_reason)) > 0)
);

-- one CURRENT assignee per Work Order (section 5); history rows are unconstrained
CREATE UNIQUE INDEX work_order_assignments_one_current
    ON eos_ops.work_order_assignments (tenant_id, work_order_id) WHERE effective_to IS NULL;
-- EMP-RT-05
CREATE INDEX work_order_assignments_current_by_employee
    ON eos_ops.work_order_assignments (tenant_id, assignee_employee_id) WHERE effective_to IS NULL;
-- history per Work Order
CREATE INDEX work_order_assignments_history
    ON eos_ops.work_order_assignments (tenant_id, work_order_id, effective_from);
```

Notes on the shape:
- **No `role`/`is_primary` column.** There is no evidence for teams (section 5). It can be added
  later without rewriting existing rows (OD-2).
- **No `phase` column.** The Work Order status carries phase (section 3.2). A same-technician
  Dispatch writes **no** assignment row, because the assignee did not change. A Dispatch to a
  different technician closes the current row (`end_source='DISPATCH_REASSIGN'`) and opens a new one
  in one transaction.
- **`Unschedule`** closes the current row and opens none. Unassignment is an interval end, not a
  delete.
- **Row immutability:** the command layer writes rows insert-only, with a single `NULL -> value`
  close. A trigger or grant pattern enforcing that is an implementation choice for the migration PR.
  History is never deleted.
- **Double-booking and overlap stay command-level checks** (they depend on status and windows, which
  a unique index cannot express). The per-technician Firestore sentinel becomes a per-Employee
  transaction-scoped PostgreSQL advisory lock inside the same transaction.
- **Eligibility** at assignment time comes from the Employee authority. The policy is OD-5. It is
  **not** `fieldops_technicians.status`.
- **Audit:** the assignment rows are themselves the append-only assignment history, which fits the
  ruling that accountability audit authority is PostgreSQL. The migrated writer stages no Firestore
  `AuditAction`. Idempotency and replay use the domain's receipts pattern
  (`command_receipts` = idempotency only).

### 8.3 How EMP-RT-05 `listAssignedWorkForEmployee` reads it

```sql
SELECT wo.id, wo.wo_number, wo.status, wo.scheduled_start, wo.scheduled_end, a.effective_from, a.source
  FROM eos_ops.work_order_assignments a
  JOIN eos_ops.work_orders wo ON wo.tenant_id = a.tenant_id AND wo.id = a.work_order_id
 WHERE a.tenant_id = $tenant AND a.assignee_employee_id = $employee AND a.effective_to IS NULL
   AND wo.status = ANY($statuses)          -- default set is OD-1
 ORDER BY wo.scheduled_start NULLS LAST, wo.id
 LIMIT $page;
```

- Tenant comes from `principalContext`, never from the request.
- Self access: the caller's Principal has an active `employee_principal_links` row to `$employee`.
  Other-employee access needs a capability that does not exist yet (section 7, OD-6).
- It reads `wo.status` and the window from the **PG Work Order**. That is the reason EMP-RT-05
  depends on the Work Order wave (section 12).

### 8.4 Explicit non-writes

**Assignment never writes `owner_employee_id` or `accountable_employee_id`, on any table.** The
assignment writer:
- has no statement touching those columns, and a static test in the implementation PR should assert
  their absence from the assignment repository source;
- runs no ownership handoff and no accountability handoff (`accountability_handoffs`,
  `functions/migrations/1759276800000_commercial-accountability-authority.sql:165-213`, stays
  untouched);
- adds no Work Order owner storage. Work Order ownership stays COMPANY class and ownerless until its
  own governed decision (`ownershipMatrix.ts:248-253`).

---

## 9. Migration plan

No step below runs as part of this lane. Every step that touches a non-local environment needs its
own authorization. **No production mutation without explicit Owner authorization. No dual write.
No sync service. No permanent Firestore copy.**

| # | Step | Content | Gate |
|---|---|---|---|
| 1 | Census | This document | review |
| 2 | Prerequisites | PG Work Order record + lifecycle authority exists behind Render (section 12); Employee authority populated in target tenant; employee<->principal links active for acting dispatchers and technicians; capability decision OD-6 ruled | Owner |
| 3 | **Freeze** | Make every Firestore assignment writer incapable, in the same freeze as the WO record writers: `transitionWorkOrder` (Schedule/Dispatch/Unschedule and, through the shared transaction, all transitions), `rescheduleWorkOrderCallable`, `reassignScheduledWorkOrderCallable`, and `assignTechnicianToUser.js` for the target project. The client boards show a maintenance state. Blocked-time/availability writers freeze too, because placement depends on them | Owner, per environment |
| 4 | **Export** (MIGRATION-ONLY exporter) | A read-only script under `functions/scripts/` (outside the Firebase-exit scan roots `field-ops-app-vite/src`, `functions/src`, `integrations`; `scripts/firebaseExitGuard.mjs:309-311`), header-marked **`FIREBASE_EXIT_MIGRATION_ONLY`** and following the Owner migration-only exporter exception pattern: pure analyzer plus a thin reader, `--projectId` required, production needs `--confirmProduction` (`functions/scripts/projectTargetGuard.js`, as used by `assignTechnicianToUser.js`), SELECT-only equivalent (Firestore `get` only), output to a local evidence file. Reads `fieldops_wos` assignment fields + snapshots, `fieldops_technicians`, `users` (only `technicianId`/`employeeId` fields), `auditEvents` for the five assignment actions (archived as evidence, **not** imported as facts). The marker makes the exporter deletable as a unit when the exit completes | Owner (production read-only census separately authorized) |
| 5 | Resolve | Pure mapping: technician id -> Employee id under the rules in 9.1; classify every Work Order | automated, deterministic |
| 6 | **Copy once** | Insert one current `work_order_assignments` row per non-terminal assigned WO (and per terminal WO per OD-4), `source='MIGRATION'`, `effective_from` = best recorded instant per 9.2, `assigned_by_principal_id` = the authorized migration operator Principal. No prose history import (OD-3) | Owner; refuses if any blocker in 9.1 |
| 7 | **Verify** | Count parity per status; every PG current row's Employee resolves in-tenant; no WO has two current rows (index); every non-terminal Firestore assignment has exactly one PG row; zero rows reference an `owner_employee_id`/`accountable_employee_id` column (structural); checksum over (work_order_id, assignee_employee_id) | automated evidence |
| 8 | **Reconcile** | Every refused or quarantined row is listed with its reason and is resolved by Owner-authored crosswalk entries or explicit decisions, then steps 5-7 are re-run. Never by inference | Owner |
| 9 | **Activate PG writer** | Assignment commands (inside the PG Work Order commands) behind capability ids from OD-6, initially active:false, then granted | Owner grant |
| 10 | **Compose transport** | Render routes for the WO wave, plus `listAssignedWorkForEmployee` (EMP-RT-05) | review |
| 11 | **Disable Firestore assignment writers** | Remove or fail-closed the callables (explicit unsupported result, never a silent no-op); remove technician-side Firestore guards as their commands move; Rules for `fieldops_wos` stay deny-write | review + deploy authorization |
| 12 | **Unfreeze** | Only PG authority is mutable. Bounded read-only overlap only | Owner |

Cutover invariant, as in the Commercial wave: **never both Firebase and Render/PG mutation
authority enabled for the same operation.** The Firestore writer must be incapable before the PG
writer is enabled.

### 9.1 Technician id -> Employee resolution rules

Input: the technician id in `assignedTechId` (DISPATCHED onward) or `scheduledTechId` (SCHEDULED),
per section 3.1.

**Admissible evidence (in order; the first one present decides, and conflicts refuse):**
1. An **Owner-authored crosswalk entry** `technicianId -> employeeId` for the tenant (a reviewed
   config file, the same governance as `config/ownership/operating-company-roots.*.json`).
2. An explicit `fieldops_technicians/{id}.employeeId` field, **only if OD-7 admits it**, and only
   when that Employee exists in `eos_workforce.employees` for the tenant.

**Inadmissible, always** (standing rulings #185/#187 and migration 008 section on technician ids):
id coincidence (technician id == employee id), name or phone match, a Firebase uid, Principal
existence alone, Security Role, and certification-world fixture authoring.

**Corroborating only (never decides alone):** `users/{uid}` carrying both `technicianId` and
`employeeId` (DEF-2). Whether it may decide is OD-7.

**Classification and blockers:**

| Class | Condition | Effect |
|---|---|---|
| RESOLVED | exactly one admissible Employee, exists in tenant | import |
| ORPHAN_TECHNICIAN | no admissible Employee (e.g. `tech-sbx-01`, `tech-sbx-02`, `tech-sbx-other` in sandbox seeds) | **blocks** if the WO is non-terminal; terminal handled by OD-4 |
| AMBIGUOUS | two sources disagree, or two technician ids resolve to one Employee on overlapping active work | **blocks** |
| DANGLING_TECHNICIAN | id names no `fieldops_technicians` document | **blocks** if non-terminal |
| UNREADABLE | empty, whitespace, non-string or path-shaped stored value (the MI-λ distinction: unreadable is not absent) | **blocks** if non-terminal; never silently treated as unassigned |
| INCONSISTENT_PHASE | DISPATCHED..COMPLETED with `scheduledTechId != assignedTechId` (possible for pre-H20 data), or SCHEDULED with `assignedTechId` present, or READY_TO_DISPATCH with `scheduledTechId` present | **blocks**; reported with both values |
| EMPLOYEE_NOT_ELIGIBLE | resolved Employee fails OD-5 policy on a non-terminal WO | **blocks** |
| WORK_ORDER_NOT_MIGRATED | WO has no PG record | **blocks** (section 12) |

Snapshot fields (`reassignedFromTechId`, `rescheduledFromTechId`) are history. They do not block,
and they are exported to evidence only (OD-3).

### 9.2 `effective_from` for imported rows

Use the recorded instant only: `dispatchedAt` for DISPATCHED onward when no later
`reassignedAt`/`rescheduledAt` exists, otherwise the latest of those. For SCHEDULED, use
`rescheduledAt` if present, else the Work Order `updatedAt` **marked as an upper bound in evidence**.
Never invent an instant. If nothing is recorded, use the migration instant and set
`source='MIGRATION'`, which says exactly that.

---

## 10. Owner / Accountability interaction

**Answer: NO. Assignment does not change record ownership or accountability today, and the target
model keeps it that way.**

Evidence:
- The Work Order owner class is COMPANY. "The responsible operating company owns the job; the
  technician performs it ... it is why assignedTechId is deliberately NOT an ownerField"
  (`functions/src/ownership/ownershipMatrix.ts:199-201`). `ownerFields: []` (`:243-248`). The legacy
  job row repeats "assignedTechId remains ASSIGNMENT" (`:271`).
- Accountability scope is a literal three families (Opportunity, Sales Agreement, Sales Order).
  Work Orders are NOT APPLICABLE (`functions/src/responsibility/accountabilityFamilyScope.ts:1-56`).
  Storage refuses to overload assignment fields (`functions/src/responsibility/accountablePersonStorage.ts:28`).
- An acceptance test proves an assignment field moving leaves both owner and accountable untouched
  (`functions/test/commercialAccountabilityAcceptance.test.mjs:298-306,401-404`).
- No Work Order assignment writer touches any owner or accountable field. Searching the writers in
  section 1.2 for `owner|accountable` found no such write.
- Commercial ownership handoff has no assignment field (search `assignedTechId|technicianId` in
  `functions/src/ownership/ownershipHandoffCommand.ts`: none).

Conflation defects (naming only; no data conflation):
- **DEF-6:** the assignment guard is called "ownership" in code and audit vocabulary:
  `functions/src/completeAssignedJob.ts:267` ("Ownership: authoritative assignment field"),
  `functions/src/updateWorkOrderExecutionData.ts:159` ("Rule 4: ownership -- assignedTechId"),
  `isOwnAssignment` / `requiresOwnAssignment` (`transitionEngine.ts:106-108`), and audit scope type
  `ownAssignment` (`completeAssignedJob.ts:324`). The PG implementation should call these
  "assignee guard" / "self-assignment" so that the word *ownership* keeps its governed meaning.

---

## 11. Open decisions (genuine business-policy choices only)

**OD-1: Does a technician's "assigned work" include SCHEDULED (planned) work?**
- Evidence: today a technician can read only `assignedTechId` work, so planned work is invisible
  until Dispatch (`firestore.rules:506-509`; `workOrderService.ts:126`). Dispatchers see both.
- Options: (a) dispatched onward only (today's behavior); (b) SCHEDULED included, read-only;
  (c) caller-selectable filter with default (a).
- Recommendation: **(a) as the migrated default**, so the cutover changes no behavior. Allow (c)
  later as a separate product decision.

**OD-2: Is a Work Order assigned to one technician or to a team?**
- Evidence: single assignee everywhere (section 5).
- Options: (a) single assignee (today); (b) primary + helpers with a role column; (c) crew entity.
- Recommendation: **(a)** for the migration. The schema admits (b) additively later.

**OD-3: What assignment history is imported?**
- Evidence: history is prose in `auditEvents`. Initial assignments are unrecorded, and DEF-9 can
  overwrite entries (section 4).
- Options: (a) current assignment only, with full audit export archived as evidence;
  (b) parse prose into historical rows; (c) (a) plus snapshot fields as one historical row each.
- Recommendation: **(a)**. Parsing prose would turn text into governed facts, and the source is
  incomplete by construction.

**OD-4: Terminal Work Orders: import the assignee, and how?**
- Evidence: the assignee is retained after COMPLETED/CLOSED/CANCELLED (section 3.1). Performance
  metrics count completed work by assignee (section 1.4). Orphan technicians exist in sandbox.
- Options: (a) import terminal assignments as current rows (the row is not closed by completion),
  and quarantine unresolvable ones in a separate evidence table without an Employee FK;
  (b) import non-terminal only, leaving completed-work history in the archived export;
  (c) block the migration until every terminal row resolves.
- Recommendation: **(a)**, with the MI-λ "declare and quarantine" precedent: unresolved history is
  kept visible and never forced onto an Employee.

**OD-5: Who is eligible to be assigned?**
- Evidence: today eligibility is `fieldops_technicians.status` in a governed set
  (`placementPolicy.ts:80-95`). There is no skills or Job Role authority. The Commercial
  accountability eligibility policy is ACTIVE + CONTRACTOR, but that ruling was for accountability
  only.
- Options: (a) Employee exists in tenant with `employment_status` in {ACTIVE, CONTRACTOR};
  (b) ACTIVE only; (c) any Employee, with the lifecycle status as a warning.
- Recommendation: **(a)**, stated as its own policy id, separate from the accountability policy.

**OD-6: Capabilities for assignment on the PG path.**
- Evidence: the 2026-08-27 ruling kept scheduling role-based with no new capability family. The PG
  path authorizes through `principalContext`, which has no `users.role`. `workOrder.transition`
  exists; migration 006 excludes Schedule/Unschedule; no WO read capability exists (section 7).
- Options: (a) map all assignment commands onto existing `workOrder.transition`, and self-read onto
  the employee-principal link with no capability; (b) register a narrow family
  (`workOrder.assignment.write`, `workOrder.assignment.read.own`, `workOrder.assignment.read.any`);
  (c) reuse `workOrder.lifecycle.dispatch` for Dispatch and (a) for the rest.
- Recommendation: **(a)** for writes, which honors the 2026-08-27 ruling. A new read capability for
  **other** employees' work needs an explicit Owner choice, because no existing id fits.

**OD-7: Is a `users/{uid}` document carrying both `technicianId` and `employeeId` admissible evidence
of technician -> Employee identity?**
- Evidence: both fields are admin-authored on the credential document (DEF-2). The rulings forbid uid
  coincidence as proof but do not address two explicit admin-authored mappings on the same
  credential. `fieldops_technicians.employeeId` appears only in fixture authoring.
- Options: (a) inadmissible; only an Owner-authored crosswalk decides; (b) admissible when both
  mappings exist and nothing contradicts them; (c) corroborating only.
- Recommendation: **(c)**. The resolver pre-fills proposed crosswalk entries from it for Owner
  approval, and never decides alone.

**OD-8: Sequencing of EMP-RT-05.**
- Evidence: section 12. EMP-RT-05 has no PG source until the Work Order wave. An interim Render read
  of Firestore would be a new Firebase business dependency.
- Options: (a) EMP-RT-05 stays BLOCKED/deferred until the Work Order wave; (b) schedule a Work Order
  wave now (record + lifecycle + scheduling + assignment together); (c) ship EMP-RT-05 as an
  explicit "not available" state in Employee v4.1.
- Recommendation: **(c) now, then (b)** when the Owner lifts the D2 deferral. Reject any interim
  Firestore-backed Render read.

---

## 12. Dependencies

**Work Order record authority is DEFERRED.** Commercial wave ruling D2 (option a) excluded Work
Orders, inventory execution, finance invoicing and catalog. `domainMigrationWaveModel.waves` is
empty (`docs/architecture/firebase-exit-manifest.json`). The Work Order files remain in the Firebase
exit baseline (`docs/architecture/firebase-exit-baseline.json:149-150,280,293,327,385`).

**Can assignment authority move independently of Work Order record authority? NO.** Evidence that
the facts are one transactional unit today:

1. **Lifecycle and assignment are written in the same transaction and document write.** Dispatch sets
   `status`, `assignedTechId`, `scheduledTechId` and `dispatchedAt` in one `tx.update`
   (`transitionWorkOrder.ts:216-219,366-378,546`). Unschedule does the same when deleting the
   assignee (`:413-415`).
2. **Assignment guards read status and other Work Orders inside the transaction.** Double-booking
   queries `fieldops_wos` by `assignedTechId` and filters by status
   (`transitionWorkOrder.ts:314-327`; `workOrderAvailability.ts:32-38`). Overlap queries by
   `scheduledTechId` + window + status (`placementPolicy.ts:109-122`).
3. **Technician lifecycle authorization reads the assignment in the same transaction as the
   transition** (`transitionWorkOrder.ts:192-214`).
4. **Execution, labor and install guards read the assignment and status atomically with their
   writes** (`updateWorkOrderExecutionData.ts:141-169`; `workOrderLaborCommand.ts:370`;
   `workOrderInstallCommand.ts:239`).
5. **Rules and client reads key the Work Order read on the assignee** (`firestore.rules:508`;
   `workOrderService.ts:126`).
6. **The scheduling commands require `status === 'SCHEDULED'` and rewrite the window on the WO
   document** (`schedulingCommands.ts:193-198,225-240`).

Moving only assignment to PostgreSQL would need cross-store transactions or a dual write, and both
are forbidden. **Assignment authority must move in the same wave as Work Order record + lifecycle +
scheduling authority**, including availability/blocked-time (keyed on the same technician identity)
and the per-technician lock.

**Can proceed independently now (no runtime authority change):**
- this census, and Owner rulings on OD-1..OD-8;
- a read-only measurement of technician -> Employee resolvability, extending
  `scripts/employeeTruckCrosswalk.lib.mjs` (migration-only, local evidence file), to size the
  section 9.1 blockers before the wave is scheduled;
- Owner authoring of the technician -> Employee crosswalk.

**Other dependencies:**
- `eos_workforce.employees` populated per tenant, and the deferred employee FK on
  `employee_principal_links` applied (`functions/migrations/deferred/1759190400000_*`).
- A PG Work Order table with `UNIQUE (tenant_id, id)` as the FK target.
- DEF-4 (truck lookup by technician id) must be fixed as part of, or before, the inventory
  execution migration. It is not in this wave's scope, but it uses the same identity the assignment
  migration resolves.
- DEF-9 (overwrite of generic transition audit events) should be recorded as a known defect of
  the Firestore authority. The PG model does not inherit it, because assignment rows are
  insert-only with generated ids.
- Certification world stays FROZEN. Its fixtures are not a migration source or a rule source.

---

## Appendix: defect register

| Id | Defect | Evidence | Severity for migration |
|---|---|---|---|
| DEF-1 | Firebase credential doc is the technician-identity resolver | `callerContext.ts:15-22` | high: replaced by Principal -> Employee |
| DEF-2 | `users/{uid}.technicianId` and `.employeeId` unreconciled | `assignTechnicianToUser.js`; `employeeSession.js:53` | high: OD-7 |
| DEF-3 | Assignee id is a client/seed-minted technician doc id | `jobActions.js:40-41`; `seedSandboxTransactional.js:262-421` | high: 9.1 resolution |
| DEF-4 | `trucks.assignedDriverEmployeeId == technicianId` | `consumptionSourceService.ts:61,76`; `transferReceivableRead.ts:92-96`; `cycleCountSheetCallables.ts:221-225` | medium: outside this wave, same identity |
| DEF-5 | EMPLOYEE-scoped goals over technician-keyed actuals | `dashboardComposition.js:517-519`; `executionAnalyticsService.ts:136` | medium: resolved by Employee-keyed assignment |
| DEF-6 | Assignment guard named "ownership" | `completeAssignedJob.ts:267,324`; `updateWorkOrderExecutionData.ts:159` | low: naming |
| DEF-7 | `assignedTechId` documented as "raw UID" | `coordinatedVisitReadService.ts:75` | low: misleads exporters |
| DEF-8 | Actor identity in history is a uid; initial assignee unrecorded | `transitionWorkOrder.ts:561-571` | medium: OD-3 |
| DEF-9 | Generic transition audit id collides after ND-18 cycle; `set` overwrites | `workOrderTransitionMath.ts:5-8,16-19`; `transitionEngine.ts:42`; `auditEventWriter.ts:822` | medium: history integrity (code reading; not test-reproduced) |
