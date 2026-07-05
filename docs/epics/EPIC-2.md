# Epic 2 — Work Order Interactive UI

Written at the start of the `epic-2-work-order-interactive-ui` branch, before any implementation. Epic 1 (`docs/architecture/ADR-002-work-order-engine.md`) built the backend contract and a read-only Control Tower migration; every part of this doc describes work that was explicitly deferred out of that epic, not new scope invented here.

## Scope

Give dispatchers and technicians the ability to actually **drive** a Work Order through its lifecycle from the UI, using the backend that already exists (`createWorkOrder`/`transitionWorkOrder` Cloud Functions, `domain/workOrderWorkflow.js`'s `getAllowedActions()`) but has no caller yet:

- Dispatcher: create a Work Order, then Schedule → Dispatch it (and Close/Cancel when applicable).
- Technician: Accept → Travel → Arrive → Work Start → Complete a Work Order assigned to them.
- Resolve the current UI naming collision where the nav tab labeled "Work Orders" (`App.jsx`'s `jobs` key → `modules/jobs/Jobs.jsx`) is actually Job CRUD (`createJob()`), not Work Order CRUD — confirmed live in the shipped nav bar, not a hypothetical risk.

Everything here is **UI + wiring**, not new backend logic — `transitionEngine.ts`'s state machine, `firestore.rules`' deny-all-client-writes posture, and the two Cloud Functions are all already correct and already tested (17/17 in the Epic 1 emulator pass). This epic calls them; it does not change them.

## Platform Glossary

Canonical definitions for terms this project has, more than once, let drift into meaning two different things at once (Work Order, Inventory). Written here because Epic 2 is exactly the kind of work — new UI, new components, new contributors reading the code cold — where that drift bites hardest. If a term isn't here, don't assume; check `docs/architecture/ADR-001-*`/`ADR-002-*` before inventing a new one.

| Term | Canonical meaning | Not to be confused with |
|---|---|---|
| **Job** | A technician execution unit, `fieldops_jobs`, `JOB_STATUS` (`open/assigned/in_progress/complete`), written only via `domain/jobActions.js`. | The nav tab currently labeled "Work Orders" (`Jobs.jsx`) — it manages Jobs, not Work Orders. This is the exact confusion Phase 4 resolves. |
| **Work Order** | A real, persisted dispatch-level contract, `fieldops_wos`, its own 11-value `WorkOrderStatus`, written only via `createWorkOrder`/`transitionWorkOrder` Cloud Functions. Soft-linked to Jobs via `job.workOrderId` (optional, unenforced). | The pre-Epic-1 meaning of "Work Order" — a derived aggregate over a group of Jobs (`domain/workOrderLifecycle.js`'s old, now-frozen, `computeWorkOrderState(jobs)`). That meaning is retired for all new code. |
| **Technician** | A `fieldops_technicians` doc, `TECH_STATUS` (`available/on_job/off_shift`), assigned to Jobs via `job.technicianId` and to Work Orders via `workOrder.assignedTechId` — two separate fields, two separate assignment events, not synchronized. | — |
| **Role** (Admin / Dispatcher / Technician) | `users/{uid}.role`, read via `auth/AuthContext.jsx`'s `useAuth()`. The only three values `ROLES` (`domain/constants.js`) defines. | A job-level or WO-level field — role lives on the user doc, never on a Job or Work Order doc. |
| **Action** (e.g. `Schedule`, `Dispatch`, `Accept`) | The vocabulary `transitionWorkOrder()` accepts (`ActionName`) — never a raw target status. Resolved server-side to a `WorkOrderStatus` via `ACTION_TO_STATUS`. | A Job status transition — Jobs transition via `updateJobStatus(job, nextStatus)`, a status directly, not an action name. The two systems use deliberately different vocabularies. |
| **Parts Catalog** | `data/partsCatalog.ts` — a static, read-only SKU → name/category/cost/unit reference table, generated from a CSV. Not Firestore-backed, not authoritative, exists purely to enrich Work Order display. | **Inventory** (below) — the two are unrelated systems that happen to both involve "parts." |
| **Inventory** (as in `demo/InventoryContext.jsx`, `modules/inventory/Inventory.jsx`) | An in-memory-only warehouse/truck stock transfer simulation for the Sprint 3.6 demo. No Firestore collection backs it; state resets on reload. | **Parts Catalog** (above) or any future real inventory/transaction engine (explicitly deferred, see Out of scope). |
| **Control Tower** | `modules/controlTower/ControlTower.jsx` — the read-only operational dashboard. Owns every Firestore listener its child panels/`WorkOrderDetail.jsx` need; no panel fetches independently. | — |
| **Signal** | The canonical `{ id, score, severity, label, metadata }` envelope (`domain/controlTower/types.js`) every Control Tower panel renders. | Raw domain output (e.g. `explainWorkOrder()`'s return shape) — Signals wrap that output, they aren't it. |

## Module map

| File | Change |
|---|---|
| `field-ops-app-vite/src/modules/controlTower/WorkOrderDetail.jsx` | Replace the `Phase 2 TODO` comment block with real action buttons, gated by `getAllowedActions(workOrder.status, role, isOwnAssignment)`. |
| `field-ops-app-vite/src/modules/workOrders/CreateWorkOrderForm.jsx` (new) | Dispatcher-facing form calling `services/workOrderService.ts`'s `createWorkOrder()`. |
| `field-ops-app-vite/src/modules/workOrders/ScheduleWorkOrderModal.jsx` (new) | Captures `scheduledStart`/`scheduledEnd`/`scheduledTechId` for the `Schedule` action (`transitionWorkOrder(id, "Schedule", {...})`) — these are caller-supplied fields per `transitionWorkOrder.ts`, not something a plain button click can satisfy alone. |
| `field-ops-app-vite/src/modules/workOrders/DispatchWorkOrderModal.jsx` (new) | Captures `assignedTechId` for the `Dispatch` action, same reason as above. |
| `field-ops-app-vite/src/modules/mobile/FieldMode.jsx` | Add technician-facing Accept/Travel/Arrive/WorkStart/Complete actions for Work Orders assigned to the signed-in technician (`technicianId` from `useAuth()`). This file currently only handles Job execution — needs a new Work Order query (`assignedTechId == technicianId`, see Data dependencies). |
| `field-ops-app-vite/src/App.jsx` | Resolve the naming collision — rename the `jobs` NAV entry's label away from "Work Orders" (it's Job CRUD), and/or add a distinct, real Work Order management tab. Exact resolution is a Phase 4 (Domain Language Alignment & Polish) decision, not pre-decided here. |
| `field-ops-app-vite/src/modules/jobs/Jobs.jsx` | Copy fix: `<h2>Work Orders</h2>` / `"Add Work Order"` button text is wrong given `fieldops_wos` is now a real, distinct entity — this screen creates Jobs, not Work Orders. |

## Component hierarchy

```
ControlTower.jsx
  └─ WorkOrderDetail.jsx (existing, read-only today)
       └─ [NEW] WorkOrderActions.jsx
            ├─ ScheduleWorkOrderModal.jsx   (dispatcher, action = Schedule)
            ├─ DispatchWorkOrderModal.jsx   (dispatcher, action = Dispatch)
            └─ plain buttons for Close/Cancel/Accept/Travel/Arrive/WorkStart/Complete
                (no modal needed -- these actions take no extra input)

[NEW top-level entry point, exact placement is a Phase 1 decision]
  └─ CreateWorkOrderForm.jsx (dispatcher, calls createWorkOrder())

FieldMode.jsx (existing)
  └─ [NEW] a Work Order-scoped section/tab, parallel to its existing Job-scoped view
       └─ same action buttons as WorkOrderDetail's technician-facing subset
            (Accept/Travel/Arrive/WorkStart/Complete only -- reuses
            WorkOrderActions.jsx rather than duplicating the button logic)
```

`WorkOrderActions.jsx` is deliberately one shared component between `WorkOrderDetail.jsx` (dispatcher-facing) and `FieldMode.jsx` (technician-facing) rather than two separate implementations — both need the exact same `getAllowedActions()` gating, and this repo's established pattern (`domain/*.js` computes, components render) argues against duplicating that logic across two button trees.

### Hard rule: no page component calls a Cloud Function directly

Every dispatcher and technician action, with no exception, flows through:

```
Page component (WorkOrderDetail.jsx / FieldMode.jsx / CreateWorkOrderForm.jsx / a modal)
  → WorkOrderActions.jsx (gating: getAllowedActions() decides what's even offered)
  → services/workOrderService.ts (the ONLY file that imports httpsCallable/getFunctions
     for Work Orders -- already true as of Epic 1, stays true here)
  → createWorkOrder / transitionWorkOrder (Cloud Functions)
```

No page component may import `httpsCallable`/`getFunctions` or call a Work Order Cloud Function itself. This mirrors the existing, already-enforced rule for Jobs (`domain/jobActions.js` is the only write path — no component calls Firestore directly), extended to Work Orders' Cloud-Function write path. A code review finding a `httpsCallable(functions, "createWorkOrder"|"transitionWorkOrder")` call anywhere outside `services/workOrderService.ts` is a defect, not a style nit.

## Data dependencies

Already built in Epic 1, no changes needed, just callers:
- `services/workOrderService.ts`: `createWorkOrder(input)`, `transitionWorkOrder(workOrderId, action, extra?)`, `getWorkOrder(id)`, `subscribeToWorkOrders(onChange)`.
- `domain/workOrderWorkflow.js`: `getAllowedActions(status, role, isOwnAssignment)`, `canTransitionWorkOrder(current, next)` — the client-side gating mirror of `functions/src/transitionEngine.ts`.
- `auth/AuthContext.jsx`'s `useAuth()`: `role`, `technicianId` — needed to compute `isOwnAssignment` (`workOrder.assignedTechId === technicianId`) and to decide which action buttons a given signed-in user should even see.

**New this epic:**
- A technician-scoped Work Order query for `FieldMode.jsx` (`where("assignedTechId", "==", technicianId)`) — per Epic 1's `ADR-002` note, this needs a composite index (`fieldops_wos`: `assignedTechId` ASC, `status` ASC) that was deliberately *not* added in Epic 1 because nothing queried it yet. Adding the index is this epic's responsibility once the query exists.

**Hard blocking dependency, not this epic's to fix:**
- The `createWorkOrder`/`transitionWorkOrder` Cloud Functions are **not deployed to production yet** — blocked on the `taylor-parts` project's Blaze plan upgrade ([issue #15](https://github.com/TaylorService-spec/Taylor_Parts/issues/15)). This epic's UI can be built and code-reviewed against the emulator, but it cannot be smoke-tested against real production, and must not be merged-and-assumed-working until #15 is resolved and a real deploy is verified (same "never assume deploy state" discipline as every rules change in this repo).

## Out of scope

Carried forward unchanged from Epic 1.1's boundaries (`docs/epics` inherits, doesn't relitigate, `ADR-002`'s scope fence):

- Inventory transactions, stock deduction, `partsReserved`/`partsConsumed`/`inventoryTransactions[]`/`warehouseId` — still deferred, still a future epic.
- Any change to `fieldops_jobs`, `JOB_STATUS`, `domain/jobActions.js`, `Dispatch.jsx`'s existing Job-dispatch flow — Work Order actions are additive alongside Job execution, not a replacement for it.
- Any change to `transitionEngine.ts`'s state machine, the permission matrix, or `firestore.rules` — Epic 1's backend is considered correct and frozen; this epic only adds callers.
- A scheduling/calendar UI (drag-and-drop, availability conflict detection, etc.) — `ScheduleWorkOrderModal.jsx` is a plain form capturing three fields, not a scheduling engine.
- Notifications/alerts when a Work Order is dispatched to a technician — out of scope until this epic's core loop works.
- Bulk actions (multi-select Work Orders, bulk dispatch) — one-at-a-time only.

## Audit & Analytics Strategy (Deferred)

The system currently does **NOT** implement an event stream.

All auditability and operational timelines are derived **exclusively** from WorkOrder state transition timestamps persisted in `fieldops_wos` (`dispatchedAt`/`acceptedAt`/`enRouteAt`/`arrivedAt`/`workStartedAt`/`completedAt`/`closedAt`, each written once, immutably, by `transitionWorkOrder.ts`), reconstructable via `transitionEngine.ts`'s deterministic transition table.

**No secondary event log or UI-layer tracking is considered authoritative.**

A "Work Order Creation Event Log (UI only)" was proposed during this epic (tracking WO Created / Save Draft vs. Create & Continue / timestamp / role) and explicitly deferred: a UI-only, non-persisted log cannot actually deliver audit trails, dispatcher analytics, or SLA tracking — all three need data that survives a page refresh and is visible across sessions/devices, which "UI only" cannot provide. Building it anyway would either stay decoratively useless or quietly grow into unreviewed persisted writes later.

This is the same call already made in `docs/architecture/ADR-001-retired-operational-core-branch.md` for `fieldops_job_events`: *no persisted event stream until there's a broader eventing strategy this project has deliberately not committed to yet.*

**A true eventing system is deferred to a future epic (Epic X)** — scoped with the same rigor as Epic 1's backend (new collection, write path, `firestore.rules`, a real design decision) if and when it's actually taken up, not folded in as a small addition to this one.

## Acceptance criteria per phase

### Phase 1 — Dispatcher creation
- Admin/dispatcher can create a Work Order from the UI with `customerId`, `locationId`, `priority`, `type`, optional `complaint`/`severity` — calls the real `createWorkOrder()` callable, no direct Firestore write.
- The created WO's `woNumber` is shown back to the user immediately (from the callable's response, not a follow-up read).
- A technician account cannot see or reach the create form at all (nav/route gating, not just a disabled button) — matches `ROLE_NAV_ACCESS`'s existing pattern.
- Verified against the Functions emulator (real production Functions deploy is blocked by issue #15 — emulator verification is the acceptance bar for this phase, not a live prod check).

### Phase 2 — Dispatcher lifecycle actions (Schedule, Dispatch, Close, Cancel)
- `WorkOrderDetail.jsx` shows exactly the actions `getAllowedActions(workOrder.status, "dispatcher", false)` returns for the current status — no stale/invalid buttons ever render.
- Schedule and Dispatch actions collect their required extra fields (`scheduledStart`/`scheduledEnd`/`scheduledTechId`; `assignedTechId`) via modal before calling `transitionWorkOrder()` — cannot be submitted empty.
- An invalid transition is structurally impossible from the UI (no button exists for it), not just server-rejected-and-shown-as-an-error.
- Cancel is available from every non-terminal status and unavailable once `COMPLETED`/`CLOSED`/`CANCELLED`, matching `transitionEngine.ts`'s literal table exactly.

### Phase 3 — Technician execution actions (Accept, Travel, Arrive, Work Start, Complete)
- A technician only ever sees action buttons for Work Orders where `assignedTechId === their own technicianId` — verified by attempting to view/act on a WO assigned to a different technician and confirming no action is offered (not just server-blocked).
- `FieldMode.jsx`'s new Work Order section reuses `WorkOrderActions.jsx` rather than reimplementing the button/gating logic a second time.
- The technician-scoped Firestore query has its required composite index deployed and confirmed (not just committed to `firestore.indexes.json` — deployed and verified, per this repo's standing "deploy state is never assumed" rule).

### Phase 4 — Domain Language Alignment & Polish
- The "Work Orders" nav label / `Jobs.jsx` copy naming collision is resolved — either renamed or genuinely repointed at Work Order management — with a clear decision recorded (not left ambiguous for a future session to rediscover, the way this epic's authoring session had to rediscover it via grep).
- No dead/duplicate code left behind from Phases 1-3 (e.g. no orphaned modal component if a phase's UI approach changed mid-epic).

## Open questions (not pre-decided, flagged for whoever picks this up)

- Where does `CreateWorkOrderForm.jsx` actually live in the nav — a new tab, or folded into the resolved `Jobs.jsx`/Work Orders tab from Phase 4? Phase 1 can ship without answering this (e.g. temporarily reachable from Control Tower), but Phase 4 must resolve it.
- Should `FieldMode.jsx` show Jobs and Work Orders in one unified list, or as separate sections/tabs? Affects Phase 3's UI shape, not its data layer.
