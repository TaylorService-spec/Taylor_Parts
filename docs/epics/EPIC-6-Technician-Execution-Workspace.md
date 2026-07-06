# Epic 6 — Technician Execution Workspace

**Renumbered from the requested "Epic 3."** `docs/CLAUDE_CONTEXT.md` already uses "Epic 3" throughout to refer to the merged Inventory Analytics Engine (PR #17, `functions/src/inventoryAnalyticsService.ts`) — no file collision exists (`docs/epics/` didn't exist before this document), but reusing "Epic 3" for this workspace would create real semantic ambiguity against already-documented history. The repo's epic sequence so far: Epic 1 (Work Order Engine), Epic 1.1 (Inventory Visual Layer), Epic 2 (Work Order Interactive UI, phases 2A–2C), Epic 2D (Inventory Trigger System), Epic 3 (Inventory Analytics Engine), Epic 4 (Warehouse + Fulfillment), Epic 5 (Procurement + Supplier Management). "Epic 6" is the next number nothing else has claimed.

**Status:** Planning only. No code, branches, PRs, Firestore, or Cloud Function changes made as part of producing this document.

---

## 1. Executive Summary

The technician-facing mobile experience (`modules/mobile/FieldMode.jsx`) has never been migrated to the Work Order platform (`fieldops_wos`, introduced by Epic 1). It still runs entirely on the pre-Epic-1 Job model (`fieldops_jobs`/`JOB_STATUS`, written via `domain/jobActions.js`'s `updateJobStatus()`). Every other operational surface in this app — Control Tower, the Dispatcher Board, dispatcher-side lifecycle actions — has already moved to the Work Order model; the technician side has not.

Epic 6's purpose is to bring the technician execution experience onto the same Work Order platform: reading real `fieldops_wos` documents instead of `fieldops_jobs`, and calling the same `transitionWorkOrder()` Cloud Function (via the already-defined `Accept`/`Travel`/`Arrive`/`WorkStart`/`Complete` actions) instead of `updateJobStatus()`. This is a like-for-like platform migration of an existing, working experience — not a new feature — and it surfaces a real prerequisite gap (documented in Section 8) that has to be resolved before any of it can function: there is currently no way for a signed-in technician account to prove, to Firestore's security rules, which Work Orders are theirs.

## 2. Current State

### 2.1 Current technician experience (`FieldMode.jsx`)

`field-ops-app-vite/src/modules/mobile/FieldMode.jsx` (181 lines). Confirmed entirely Job-based — no import of `services/workOrderService.ts`, `hooks/useWorkOrders.js`, or `domain/workOrderWorkflow.js` exists anywhere in the file.

What it does today:
- **Active Job display**: filters `fieldops_jobs` docs to `JOB_STATUS.ASSIGNED`/`IN_PROGRESS`, sorts a hardcoded demo "hero" job first (`demo/heroConfig.js`'s `isHeroActiveJob`), takes the first as the active job.
- **Up Next list**: remaining assigned/in-progress jobs, read-only rows (customer + description).
- **Travel-stage buttons** ("Start Travel" → "Arrived" → "Start Work"): purely local `useState` (`travelStageByJob`) — never written to Firestore, never part of `JOB_STATUS`. The file's own header comment calls this out explicitly as demo-only.
- **"Start Work" / "Complete Job" buttons**: the only two real Firestore writes, via `domain/jobActions.js`'s `updateJobStatus(job, JOB_STATUS.IN_PROGRESS | JOB_STATUS.COMPLETE)`.
- **Part-picker / truck stock / used-parts summary**: backed entirely by `demo/InventoryContext.jsx`'s in-memory `useInventory()` context — no Firestore collection backs any of it; state resets on page reload.
- **Hero-job spotlighting**: cosmetic-only, tied to a hardcoded demo customer name.

`docs/SprintRoadmap.md` marks this Job-based mobile flow as a completed deliverable in its own right ("Phase 3: Technician mobile experience — Status: done"), not as a stopgap awaiting a Work Order migration. There is no existing roadmap entry proposing the replacement this epic describes.

### 2.2 Current Work Order implementation

- **Data model**: `functions/src/types/workOrder.ts` / `field-ops-app-vite/src/types/workOrder.ts` (mirrored, not shared). 11-value `WorkOrderStatus`, `assignedTechId`, `inventorySnapshot`, execution timestamps (`dispatchedAt`/`acceptedAt`/`enRouteAt`/`arrivedAt`/`workStartedAt`/`completedAt`/`closedAt`).
- **Write path**: exactly two Cloud Functions, `createWorkOrder` and `transitionWorkOrder` (`functions/src/createWorkOrder.ts`, `functions/src/transitionWorkOrder.ts`), called client-side via `field-ops-app-vite/src/services/workOrderService.ts`. `firestore.rules` denies all direct client writes to `fieldops_wos`/`counters` unconditionally.
- **Lifecycle authority**: `functions/src/transitionEngine.ts` (canonical), mirrored client-side in `domain/workOrderWorkflow.js`. Both expose `getAllowedActions(status, role, isOwnAssignment)` and a full `ACTION_TO_STATUS`/`ACTION_PERMISSIONS` table. See `docs/architecture/ADR-002-work-order-engine.md`'s "Work Order Lifecycle Authority" section.
- **Read path today**: `services/workOrderService.ts`'s `subscribeToWorkOrders()` is an **unfiltered** `onSnapshot(collection(db, "fieldops_wos"))` listener, with a header comment explicitly deferring a "technician-scoped, status-filtered query" as future work. `getWorkOrder(id)` (single-document read) also exists.

### 2.3 Current dispatcher integration

Two dispatcher-facing surfaces, both already on the Work Order model:
- **Control Tower** (`modules/controlTower/ControlTower.jsx` + `WorkOrderDetail.jsx` + `WorkOrderActions.jsx`): renders real `fieldops_wos` docs; dispatcher lifecycle actions (`MarkReady`/`Schedule`/`Dispatch`/`Close`/`Cancel`) go through `getAllowedActions()` → `transitionWorkOrder()`.
- **Dispatcher Board** (`modules/dispatcherBoard/`): 3-pane queue/preview/technician-board UI, drag-and-drop dispatch, Technician Recommendation Engine (`domain/technicianRecommendationEngine.ts`, per `docs/architecture/ADR-004-technician-recommendation-engine.md`).

Both use `useWorkOrders()`'s unfiltered listener — which works for them specifically because their role (`admin`/`dispatcher`) satisfies `firestore.rules`' `isAdminOrDispatcher()` check unconditionally, regardless of document content. See Section 2.4 for why this doesn't carry over to a technician-scoped view.

### 2.4 Existing lifecycle actions relevant to technicians (defined, zero UI)

`ActionName` already includes 5 technician actions, fully defined in both `functions/src/transitionEngine.ts` and its client mirror `domain/workOrderWorkflow.js`:

| Action | From status | To status | Permission |
|---|---|---|---|
| `Accept` | `DISPATCHED` | `ACCEPTED` | `technician`, `requiresOwnAssignment: true` |
| `Travel` | `ACCEPTED` | `EN_ROUTE` | `technician`, `requiresOwnAssignment: true` |
| `Arrive` | `EN_ROUTE` | `ARRIVED` | `technician`, `requiresOwnAssignment: true` |
| `WorkStart` | `ARRIVED` | `WORK_IN_PROGRESS` | `technician`, `requiresOwnAssignment: true` |
| `Complete` | `WORK_IN_PROGRESS` | `COMPLETED` | `technician`, `requiresOwnAssignment: true` |

`getAllowedActions(status, role, isOwnAssignment)` is already parameterized to support all five — it simply has no caller anywhere that passes `role: "technician"`. `modules/controlTower/WorkOrderActions.jsx` (the only existing component that calls `getAllowedActions()`/`transitionWorkOrder()`) is explicitly, deliberately dispatcher-only: its own header comment states "FieldMode.jsx (technician mobile) is explicitly OUT OF SCOPE... a separate migration epic, not touched here," it hardcodes `isOwnAssignment = false`, and it renders a read-only status label (not action buttons) for every status a technician action would apply to (`ACCEPTED`/`EN_ROUTE`/`ARRIVED`/`WORK_IN_PROGRESS`).

### 2.5 Existing inventory visualization on Work Orders

`WorkOrder.inventorySnapshot` (`InventorySnapshotItem[]`) is optional, non-authoritative, purely descriptive — explicitly documented as never read or written by `createWorkOrder()`/`transitionWorkOrder()`. `WorkOrderDetail.jsx` renders it in two sections:
- **Planned Parts**: items with `qtyPlanned` set, enriched via `data/partsCatalog.ts`'s `getCatalogItem()` for name/category/unit.
- **Used Parts**: items with `qtyUsed` set — currently always empty; the UI itself renders literal placeholder text `"(future: populated during execution phase)"` when none exist.

`functions/src/inventoryService.ts`'s `consumeParts()` (the real ledger-writing trigger, fired server-side on the `Complete`→`COMPLETED` transition) consumes `qtyPlanned`, not `qtyUsed` — its own header comment states `qtyUsed` "has no populate path anywhere in this app yet." **This means real parts consumption already happens automatically, server-side, tied to the `Complete` action** (via `inventory_transactions`, Epic 2D's ledger) — it does not depend on, and is not affected by, any technician-recorded "used parts" UI. Any Epic 6 "record used parts" feature would be pure UI/display enrichment on `inventorySnapshot`, with no ledger authority, exactly as Epic 1.1 already established for planned parts.

### 2.6 What already exists vs. what still depends on legacy Jobs

| Concern | Status |
|---|---|
| Work Order data model, write path, lifecycle authority | Exists, real, in production use (dispatcher side) |
| Technician-permitted actions (`Accept`/`Travel`/`Arrive`/`WorkStart`/`Complete`) | Defined in the lifecycle authority, zero UI callers |
| Technician-facing screen | **Still 100% legacy Job-based** (`FieldMode.jsx`) |
| Technician→Work-Order read access | **Not currently functional** — see Section 8 |
| Parts usage recording | Not implemented anywhere (planned parts are display-only; used parts have no writer) |

## 3. Goals

The technician should be able to:
- View assigned Work Orders (real `fieldops_wos` documents, not `fieldops_jobs`).
- Understand priority (`WorkOrder.priority`, already a real field).
- Progress through the lifecycle via the 5 already-defined actions (`Accept`/`Travel`/`Arrive`/`WorkStart`/`Complete`), calling the existing `transitionWorkOrder()` Cloud Function — no new write path.
- Review planned parts (`inventorySnapshot`, already rendered elsewhere in the app for dispatchers — same data, technician-facing view).
- Record used parts, **UI-only, non-authoritative** if no backend ledger-linked write path is introduced in this epic (matching the disclaimer already present on the planned-parts view: "Visual only -- no inventory engine connected yet").
- Complete Work Orders (the `Complete` action, already defined).

## 4. Out of Scope

Explicitly excluded from Epic 6:
- Route optimization
- GPS / live location tracking
- Push notifications
- Offline mode
- Inventory synchronization (i.e. a real ledger-linked used-parts write path — Section 3's "used parts" goal is UI-only unless a future epic adds this)
- Scheduling engine
- AI recommendations
- Customer portal

## 5. Phase Breakdown

### Phase 6.1 — Technician Dashboard

**Objectives:** A landing view for a signed-in technician showing a summary (today's assigned Work Order count, current status breakdown) — the technician-side analog of Control Tower's stat grid, scoped to one technician's own Work Orders.

**Files expected to change:** New module directory (e.g. `modules/technicianWorkspace/`, name TBD at implementation time — not created by this planning doc). No existing file needs modification to add a new, additive screen (same pattern as Epic 2C's `dispatcherBoard/` addition — see `docs/architecture/SYSTEM_AUTHORITIES.md`).

**Dependencies:** Phase 6.1 cannot function until the prerequisite in Section 8 (technician↔auth linkage) is resolved, since it needs a technician-scoped Work Order query.

**Acceptance criteria:** A technician can sign in and see a real-data summary of their own Work Orders, with zero Job-model data involved.

### Phase 6.2 — Assigned Work Order Queue

**Objectives:** List view of the technician's own assigned Work Orders (real `fieldops_wos`, filtered by `assignedTechId`), replacing `FieldMode.jsx`'s current `fieldops_jobs`-based "Up Next" list.

**Files expected to change:** New component(s) in the Phase 6.1 module directory. Requires a new technician-scoped query function (e.g. alongside `services/workOrderService.ts`'s existing exports) — `subscribeToWorkOrders()` itself is not reusable as-is (Section 8).

**Dependencies:** Section 8's technician↔auth linkage; a new Firestore composite index if the new query combines `assignedTechId` equality with a status filter or sort (to be determined at implementation time, not specified here).

**Acceptance criteria:** The queue shows only the signed-in technician's own Work Orders, ordered sensibly (e.g. by priority/scheduled time), and updates live as assignments change.

### Phase 6.3 — Execution Workspace

**Objectives:** Detail view for a single selected Work Order — the technician-facing analog of `WorkOrderDetail.jsx`, showing status, priority, customer, planned parts, and current lifecycle state.

**Files expected to change:** New component(s), likely adapting `WorkOrderDetail.jsx`'s pure-rendering pieces (status/priority/timestamp display, `inventorySnapshot` planned-parts rendering) rather than reusing that file directly, since it currently imports the dispatcher-only `WorkOrderActions.jsx` and expects Control-Tower-shaped props.

**Dependencies:** Phase 6.2 (a queue to select a Work Order from).

**Acceptance criteria:** Selecting a Work Order shows its real, current state with no legacy Job data anywhere in the view.

### Phase 6.4 — Lifecycle Actions

**Objectives:** Wire the 5 already-defined technician actions (`Accept`/`Travel`/`Arrive`/`WorkStart`/`Complete`) to real buttons, gated by `getAllowedActions(status, "technician", isOwnAssignment)`, calling `transitionWorkOrder()` — the same Cloud Function every other action in this app already uses.

**Files expected to change:** A new technician-facing action-button component (new file — `modules/controlTower/WorkOrderActions.jsx` is dispatcher-only by design and should not be repurposed; a parallel component following its established pattern is more consistent with this repo's history than modifying a component another module already depends on).

**Dependencies:** Phase 6.3. No change to `transitionEngine.ts`, `workOrderWorkflow.js`, or `transitionWorkOrder.ts` — all 5 actions and their permissions already exist.

**Acceptance criteria:** A technician can progress a Work Order through `DISPATCHED → ACCEPTED → EN_ROUTE → ARRIVED → WORK_IN_PROGRESS`, with every transition verified server-side exactly as dispatcher actions already are, and with `requiresOwnAssignment` actually enforced (unlike `WorkOrderActions.jsx`'s hardcoded `false`).

### Phase 6.5 — Parts Usage

**Objectives:** UI to review planned parts (reusing the existing `inventorySnapshot`/`getCatalogItem()` display pattern from `WorkOrderDetail.jsx`) and record used parts.

**Files expected to change:** New component(s) in the execution workspace. Per Section 4/Goals, if no backend/ledger work is added in this epic, "recording used parts" writes only to the non-authoritative `inventorySnapshot.qtyUsed` field (still with no existing writer — a new, narrowly-scoped Cloud Function or direct write mechanism would need to be decided at implementation time, since `transitionWorkOrder.ts` does not currently accept or persist this field).

**Dependencies:** Phase 6.3. Decision needed at implementation time on the write mechanism for `qtyUsed` (out of scope for this planning document to decide — see Section 8).

**Acceptance criteria:** A technician can see planned parts for their Work Order; if a used-parts write mechanism is built, it never affects `inventory_transactions` (the real ledger) or `consumeParts()`'s existing behavior.

### Phase 6.6 — Completion Workflow

**Objectives:** The `Complete` action's UI, including any confirmation/summary step before calling `transitionWorkOrder(id, "Complete", ...)`.

**Files expected to change:** Part of the Phase 6.4 action component.

**Dependencies:** Phase 6.4.

**Acceptance criteria:** Completing a Work Order transitions it to `COMPLETED`, triggers the existing server-side `consumeParts()` ledger write exactly as it already does today for any `Complete` action, and the technician sees confirmation.

### Phase 6.7 — UI Polish

**Objectives:** Loading states, empty states, accessibility, mobile-first responsive layout (the actual usage context for this screen, unlike the desktop-first Dispatcher Board) — matching the bar this project held Epic 2C's Dispatcher Board to (see `docs/architecture/ADR-004-technician-recommendation-engine.md`'s "v1 Realistic" framing and the Phase 2C polish pass referenced in `SYSTEM_AUTHORITIES.md`).

**Files expected to change:** All Phase 6.1–6.6 components.

**Dependencies:** Phases 6.1–6.6 complete.

**Acceptance criteria:** No blank/unexplained empty states; usable on an actual mobile device (this workspace's real target, unlike the desktop-first Dispatcher Board).

## 6. Component Inventory

**Existing components/modules that can plausibly be reused (adapted, not necessarily verbatim):**
- `domain/workOrderWorkflow.js`'s `getAllowedActions()` — directly reusable, already parameterized for technician role.
- `services/workOrderService.ts`'s `transitionWorkOrder()` and `getWorkOrder()` — directly reusable.
- `domain/workOrderScoring.js`'s `computeWorkOrderSignalFromDoc()` — pure function, no dispatcher-specific assumptions.
- `hooks/useFirestoreCollection.js` — generic pattern, though a technician-scoped query needs a new hook or an extended version (it currently takes a bare collection path, not a query).
- `WorkOrderDetail.jsx`'s rendering logic for `inventorySnapshot`/timestamps — presentation-only, adaptable.
- `data/partsCatalog.ts`'s `getCatalogItem()` — already used for planned-parts display, no changes needed.

**Existing components that are dispatcher-specific and do not fit a technician view as-is:**
- `modules/controlTower/WorkOrderActions.jsx` — hardcodes dispatcher role assumptions.
- `modules/dispatcherBoard/*` (all 6 files) — board/kanban UI for managing all technicians' workload, not a single technician's own view; uses the unfiltered `useWorkOrders()` listener.
- `hooks/useWorkOrders.js` — wraps the unfiltered listener; not usable for technician role per Section 8.

**Legacy Job components that `FieldMode.jsx` currently depends on, and that should eventually disappear once Epic 6 fully replaces it (not proposed for deletion now, per this document's constraints):**
- `demo/InventoryContext.jsx`
- `demo/heroConfig.js`
- `domain/jobActions.js`'s `updateJobStatus()` call site inside `FieldMode.jsx` specifically (the function itself is still the real Job/Technician write path used elsewhere, e.g. `Dispatch.jsx`, and is out of this epic's scope to remove)
- `FieldMode.jsx` itself, once a Work-Order-based replacement is live

## 7. Data Dependencies

**Existing hooks:** `hooks/useFirestoreCollection.js`, `hooks/useWorkOrders.js` (not directly usable for technician role, see Section 8), `hooks/useSessionActivityFeed.js` (dispatcher-board-specific, not relevant here), `auth/AuthContext.jsx`'s `useAuth()` (provides `role`, not `technicianId` — see Section 8).

**Existing services:** `services/workOrderService.ts` (`createWorkOrder`, `transitionWorkOrder`, `getWorkOrder`, `subscribeToWorkOrders`). No `workOrderQueries.ts` exists on `main` (a file by that name exists only on the separate, unmerged `epic-2-work-order-interactive-ui` branch — do not assume it's available).

**Existing Work Order APIs:** The two Cloud Functions (`createWorkOrder`, `transitionWorkOrder`), both already deployed-in-code (not necessarily live-deployed — per `CLAUDE_CONTEXT.md`, Cloud Functions deploy status should be re-verified live, not assumed from this document).

**Existing inventory APIs:** `functions/src/inventoryService.ts`'s `reserveParts`/`releaseParts`/`consumeParts` (ledger writers, triggered automatically by Work Order status transitions — not directly callable by a technician UI and not proposed to be). `data/partsCatalog.ts`'s `getCatalogItem()` (client-side metadata lookup, read-only).

**Current technician data model limitations:**
- Technician docs (`fieldops_technicians`) have exactly three fields: `name`, `phone`, `status`. No certifications, skills, territory, or any profile data beyond this (already established in `docs/architecture/ADR-004-technician-recommendation-engine.md`'s "v1 Realistic" reality check).
- **No linkage exists between a Firebase Auth user (`users/{uid}`) and a technician document (`fieldops_technicians/{techId}`).** `firestore.rules`' `isOwnTechnician(technicianId)` helper reads `userData().technicianId`, but no code path anywhere in this repo ever writes a `technicianId` field onto a `users/{uid}` document. `docs/DataModel.md` already flags this as an open gap.

## 8. Risks

**Blocking risk — technician↔auth linkage does not exist.** `firestore.rules`' `isOwnTechnician()` check depends on `users/{uid}.technicianId`, which nothing in this codebase currently writes. Without this, there is no way for a technician-scoped Firestore rule or query to know which Work Orders belong to the signed-in user. This blocks Phase 6.2 (and everything after it) until resolved. This document does not propose how to resolve it (per this epic's own constraint not to invent solutions) — it is flagged as a prerequisite decision for whoever scopes the implementation.

**Blocking risk — `subscribeToWorkOrders()` cannot be reused for technician role.** It is an unfiltered `onSnapshot(collection(...))` listener. Firestore rejects list/collection queries outright (`permission-denied`, not partial results) when the security rule depends on a per-document field (`resource.data.assignedTechId`) that the query itself doesn't constrain via a matching `where()` clause. A new, `assignedTechId`-scoped query is required; it will likely need a new Firestore composite index (the existing code comment references this need generically without specifying one).

**Migration risk — two parallel technician-relevant models will coexist during the transition.** Until `FieldMode.jsx` is fully replaced, `fieldops_jobs`/`JOB_STATUS` (Job model) and `fieldops_wos`/`WorkOrderStatus` (Work Order model) will both represent "what a technician is doing" simultaneously, for different screens. This is the same soft-coupled, unenforced relationship (`job.workOrderId`) already documented in `docs/architecture/ADR-002-work-order-engine.md` as an accepted, known gap — Epic 6 does not change that relationship, it adds a second technician-facing surface on top of it.

**Data risk — no existing writer for `qtyUsed`.** Any "record used parts" feature (Phase 6.5) has no existing backend field/writer to extend; a new write mechanism is a real design decision this document does not make.

**Organizational risk — `docs/SprintRoadmap.md` currently marks the Job-based technician flow as "done."** Anyone consulting that roadmap without also reading this document could reasonably assume no further technician-side work is planned. Worth reconciling when Epic 6 is actually scheduled.

**Unresolved question — Cloud Functions live-deploy status.** Per `CLAUDE_CONTEXT.md`'s standing rule, deploy state should be re-verified live (not assumed) before any implementation phase begins; `transitionWorkOrder`/`createWorkOrder` have historically only been verified against the local emulator.

## 9. Acceptance Criteria (Epic Completion Checklist)

- [ ] A signed-in technician can view only their own assigned Work Orders (real `fieldops_wos` data).
- [ ] The technician↔auth linkage gap (Section 8) is resolved before Phase 6.2 begins.
- [ ] All 5 technician lifecycle actions (`Accept`/`Travel`/`Arrive`/`WorkStart`/`Complete`) are wired to `transitionWorkOrder()`, gated by `getAllowedActions()` with `requiresOwnAssignment` actually enforced.
- [ ] Planned parts are visible on the technician's execution view, reusing the existing `inventorySnapshot` data.
- [ ] No change was made to `transitionEngine.ts`, `workOrderWorkflow.js`, `firestore.rules`' write rules, or any existing dispatcher-facing component's behavior.
- [ ] `FieldMode.jsx` is not modified until a replacement is ready to ship (avoids a broken interim state for technicians already using it).
- [ ] Build, typecheck, and lint all pass at each phase.

## 10. Future Follow-on Work

Documented as future epics only — none of the following are scoped, designed, or started by this document:
- **Inventory Management**: a real, ledger-linked used-parts write path (Phase 6.5 leaves this as UI-only unless a future epic adds backend authority).
- **Fleet Management**: vehicle/truck-level tracking beyond the current in-memory demo truck-stock model.
- **Route Optimization**: explicitly out of scope for Epic 6 (Section 4); no existing hook anywhere in this codebase.
- **Notifications**: push/SMS/email alerts for technicians (dispatch, status changes, etc.).
- **Offline Mode**: explicitly out of scope for Epic 6 (Section 4).
- **Reporting**: technician-level performance/completion reporting, distinct from the existing Operations dashboard (which is executive/monitoring-only, not technician-facing — see `docs/architecture/SYSTEM_AUTHORITIES.md`'s Operations row).
