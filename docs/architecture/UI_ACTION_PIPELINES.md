# UI Action Pipelines

This repo has exactly **two** sanctioned paths from a UI action to a Firestore write. Written while both are fresh (Epic 1's Work Order backend just shipped; Epic 2 is about to add its first real callers) so the distinction doesn't have to be rediscovered from scattered comments later. If you're adding a new mutating UI action anywhere in this app, it must be a caller of one of these two pipelines — not a third one.

## Pipeline 1 — Job / Technician (direct Firestore, rules-enforced)

```
Page component (Jobs.jsx / Dispatch.jsx / FieldMode.jsx / Technicians.jsx)
  → domain/jobActions.js
       createJob() / createTechnician() / assignJob() / updateJobStatus()
  → firebase/collectionStore.js (createJob/createTechnician only --
     jobsStore/techniciansStore's .add(), which routes through
     lib/firebaseSafe.js's safeAddDoc)
     -- OR --
     runTransaction(db, ...) directly (assignJob/updateJobStatus --
     these bypass collectionStore for their transactional writes)
  → Firestore (fieldops_jobs / fieldops_technicians)
       enforced by firestore.rules: isSignedIn() gates read/write,
       plus a narrow technician self-service carve-out
       (isOwnTechnician(), field-level .affectedKeys().hasOnly([...]))
```

**Where enforcement lives:** entirely in `firestore.rules`, plus `jobActions.js`'s own manual checks (`auth.currentUser`, `isWriteBlocked()` from `config/env.js`, `canTransitionJob()` from `domain/jobWorkflow.js`, optimistic-concurrency re-checks inside `assignJob()`'s transaction). No Cloud Function is involved anywhere in this pipeline — it doesn't exist for Jobs.

**Why this shape is correct for Jobs:** the permission model is simple (signed-in users can read/write, with one narrow field-scoped technician carve-out) and the state machine is small (`OPEN → ASSIGNED → IN_PROGRESS → COMPLETE`, no role/ownership cross-check beyond what the rules' `isOwnTechnician()` already expresses cleanly). Firestore rules can fully express this without becoming an unreadable state machine themselves.

**No other file may write to `fieldops_jobs`/`fieldops_technicians`.** A `setDoc`/`updateDoc`/`addDoc` call against either collection anywhere outside `jobActions.js`/`collectionStore.js` is a defect.

## Pipeline 2 — Work Order (Cloud Function, rules deny all direct client writes)

```
Page component (WorkOrderDetail.jsx / FieldMode.jsx's WO section /
  CreateWorkOrderForm.jsx / ScheduleWorkOrderModal.jsx / DispatchWorkOrderModal.jsx)
  → WorkOrderActions.jsx
       (gating only: getAllowedActions(status, role, isOwnAssignment)
       from domain/workOrderWorkflow.js decides what's even offered --
       this component never talks to Firestore or Functions itself)
  → services/workOrderService.ts
       createWorkOrder() / transitionWorkOrder()
       (the ONLY file in the client that imports httpsCallable/getFunctions
       for Work Orders)
  → functions/src/createWorkOrder.ts / transitionWorkOrder.ts (Cloud Functions,
       Admin SDK -- bypasses firestore.rules by design)
       enforcement here: role check (getCallerContext()), canTransition()
       (transitionEngine.ts's literal table), getAllowedActions() re-checked
       server-side, action-based input (never a raw target status)
  → Firestore (fieldops_wos / counters)
       firestore.rules: allow create, update, delete: if false --
       unconditional, no admin/dispatcher exception, for both collections
```

**Where enforcement lives:** primarily server-side, inside the two Cloud Functions — `firestore.rules` only expresses "clients cannot write here at all," not any part of the state machine or permission matrix. Read access *is* still rules-enforced (`isAdminOrDispatcher()` / `isTechnician() && isOwnTechnician(...)`).

**Reads are a separate file from writes, as of Pre-Phase 2's Read Architecture pass.** `services/workOrderQueries.ts` is the ONLY file that reads Work Orders from Firestore (`getWorkOrder`, `subscribeToWorkOrder`, `subscribeToWorkOrders`, `subscribeToDispatcherQueue`) — `services/workOrderService.ts` has no Firestore import at all anymore, only the two `httpsCallable` writes. Hooks (`useWorkOrder`, `useWorkOrders`, `useDispatcherQueue`) wrap `workOrderQueries.ts`'s functions; no page or component may import Firestore APIs (`getDoc`/`onSnapshot`/etc.) directly for Work Order reads, the same way no page component may call `httpsCallable` directly for writes.

**Why this shape is correct for Work Orders, and Jobs' shape wouldn't be** (see `docs/architecture/ADR-002-work-order-engine.md`'s Reasoning section for the full argument): the permission check depends on a second document lookup (`users/{uid}` → `technicianId` → compare to `workOrder.assignedTechId`) combined with an 11-status transition table and a 9-action permission matrix. Expressing that fully in `firestore.rules` would grow the ruleset into an equivalent, harder-to-audit state machine written in a language that isn't built for it. Centralizing it in `transitionEngine.ts` keeps the whole thing in one auditable, unit-testable module.

**No page component may call `httpsCallable`/`getFunctions` directly**, and no page component may attempt a direct Firestore write against `fieldops_wos`/`counters` — the rules would reject it anyway, but the hard rule exists so that failure is never reached: this is a code-review defect, not a runtime error to catch. (See `docs/epics/EPIC-2.md`'s "Hard rule: no page component calls a Cloud Function directly" for the Epic 2-specific restatement of this.)

## Deciding which pipeline a new feature belongs to

Ask, in order:

1. **Does the write target `fieldops_jobs`/`fieldops_technicians`?** → Pipeline 1. Extend `jobActions.js`; do not add a Cloud Function for it.
2. **Does the write target `fieldops_wos`/`counters`?** → Pipeline 2. Extend `transitionEngine.ts`'s tables and the two Cloud Functions; do not add a direct Firestore write path for it, even a rules-gated one.
3. **Is it a genuinely new collection, not Jobs and not Work Orders?** → Neither pipeline automatically applies. Make the same call Epic 1 made explicitly (see `ADR-002`'s Reasoning section): if the permission/state logic is simple enough for `firestore.rules` to express cleanly, Pipeline 1's shape (rules + a single domain-layer write module) is the lighter-weight default; if it needs cross-document permission checks or a real state machine, Pipeline 2's shape (Cloud Function + deny-all rules) is the one to copy. Don't invent a third shape without writing the reasoning down the way `ADR-002` did.

## What this document is not

Not a description of *what* either pipeline's business logic does (that's `domain/jobWorkflow.js` and `functions/src/transitionEngine.ts` themselves, plus `ADR-002`) — this is purely the shape of "how does a UI click become a Firestore write," so a new contributor can place a new action correctly without re-deriving the architecture from scratch.
