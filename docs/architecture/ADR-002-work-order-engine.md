# ADR-002: Work Order Engine v1.2 — a persisted Work Order lifecycle, as a scoped exception to ADR-001

## Status

Accepted

## Context

Before this change, "Work Order" was not a real Firestore entity. `domain/workOrderLifecycle.js`'s `computeWorkOrderState(jobs)` aggregated a 4-value `WORK_ORDER_STATE` (READY/BLOCKED/IN_PROGRESS/COMPLETED) purely by grouping `fieldops_jobs` docs by a decorative `job.workOrderId` string field — nothing was ever written to a `fieldops_wos`-style collection, and a Work Order's "state" was always just an aggregate over its child Jobs' `JOB_STATUS` values.

[ADR-001](./ADR-001-retired-operational-core-branch.md) established, in the context of rejecting PR #10, that this project's default is: `fieldops_jobs`/`JOB_STATUS` is the single execution source of truth, no duplicate/parallel lifecycle model for the same entity, no persisted UI/travel state, and aggregates are computed on read rather than cached in a second collection that can drift.

A detailed, "locked" external spec was received for a production Work Order Engine (Epic 1): a real, persisted `fieldops_wos` collection with its own 11-state lifecycle (`CREATED` → `READY_TO_DISPATCH` → `SCHEDULED` → `DISPATCHED` → `ACCEPTED` → `EN_ROUTE` → `ARRIVED` → `WORK_IN_PROGRESS` → `COMPLETED` → `CLOSED`, plus `CANCELLED`), including persisted execution timestamps (`dispatchedAt`, `acceptedAt`, `enRouteAt`, `arrivedAt`, `workStartedAt`, `completedAt`, `closedAt`). Taken at face value, this looks exactly like what ADR-001 argued against — a second, persisted lifecycle model.

It was checked against `.claude/skills/review-external-snippet`'s checklist before any code was written, specifically because: it proposed Cloud Functions and TypeScript (neither existed in this repo), and "Work Order" already meant something else here. The user reviewed the conflict directly and made an explicit, informed decision to proceed as a **scoped exception**, not as a reversal of ADR-001's reasoning.

## Decision

- **`fieldops_wos`** becomes a new, real, persisted collection — the source of truth for Work Order state, replacing the old derived/aggregate model entirely for new consumers.
- **`domain/workOrderLifecycle.js` is deprecated, not deleted.** Its four original exports (`computeWorkOrderState`, `isActiveWorkOrder`, `isCompletedWorkOrder`, `explainWorkOrderState`) stay byte-identical and frozen, serving exactly one remaining consumer: `domain/timelineBuilder.js`, whose call site only has a jobs array (no WO doc) and is out of scope for this migration. **No new consumer may ever call these four** — if `timelineBuilder.js` is migrated later, delete them outright rather than extending them. New consumers use additive, **map-only** exports (`mapWoStatusToLifecycleState`, `explainWorkOrder`) that derive purely from a real WO doc's `status` field, never from a jobs array.
- **Scope is backend contract + read-path UI migration only.** `modules/controlTower/ControlTower.jsx` and `WorkOrderDetail.jsx` now read real `fieldops_wos` docs. New interactive create/schedule/dispatch/accept/travel/complete UI is **explicitly deferred to Phase 2** — not silently implied as "later," an actual open item.
- **Job↔WO relationship: soft-coupled.** `job.workOrderId` is now documented as an optional, unenforced reference to a `fieldops_wos` **doc ID** (not its human-readable `woNumber`). No referential integrity, no cascade, no schema change on the Job side. A WO does not depend on a Job existing; `domain/jobActions.js` (`createJob`/`assignJob`/`updateJobStatus`), `JOB_STATUS`, `Dispatch.jsx`, and `FieldMode.jsx` are all completely untouched by this work.
- **Cloud Functions (2nd-gen `onCall`) and TypeScript are new infrastructure**, first introduced in this repo, scoped narrowly to `functions/` plus two client files (`types/workOrder.ts`, `services/workOrderService.ts`) and one plain-JS file (`domain/workOrderWorkflow.js`). No existing `.js`/`.jsx` file was converted to TypeScript.
- **All `fieldops_wos`/`counters` writes go through exactly two callables**: `createWorkOrder()` and `transitionWorkOrder()`. `firestore.rules` denies all direct client writes to both collections **unconditionally — no admin/dispatcher exception of any kind** (mirrors the existing `users/{uid}: allow write: if false` precedent). There is no future path for an "admin UI" to grow a direct-write shortcut around the Cloud Functions.
- **Cancellation**: the pasted spec's transition table had no incoming edges to `CANCELLED` at all — a gap. Resolved as an explicit literal table entry (not a special-cased runtime check) for every non-terminal status; `COMPLETED`/`CLOSED` are not cancellable. Permission for `Cancel` = Admin/Dispatcher only.

## Reasoning

**Why this doesn't repeat PR #10's mistake.** The distinguishing test ADR-001 implicitly set was: no duplicate lifecycle *for the same entity*. PR #10's `job.phase` was a second status field layered onto the *same* Job doc, running in parallel with `JOB_STATUS`. This is different: `fieldops_wos` is a *new entity* with its own genuinely distinct concerns (dispatch-level contract lifecycle — accept, travel, arrive — that Job was never meant to represent), not a second status field bolted onto `fieldops_jobs`. `JOB_STATUS`/`job.phase` stay exactly as ADR-001 left them; nothing about Job's execution model changed.

**Why persisted execution timestamps are an accepted exception here, specifically.** ADR-001's "no persisted UI/travel state" principle was about not caching state that Job could otherwise expose live/derived. Work Order's execution timestamps (`dispatchedAt`, `acceptedAt`, etc.) have no equivalent derivable source — Job never tracked "did the technician start traveling yet." This is new information, not a duplicate of anything Job already computes. It is nonetheless a genuine, conscious exception to ADR-001's general preference for derived-over-persisted state, made because the locked spec explicitly required it and the entity is new — not a precedent to reach for casually next time.

**Why Cloud Functions instead of client `runTransaction` + rules (the existing `jobActions.js` pattern).** The Work Order permission matrix needs a role/ownership check at write time (does this action's target status match the caller's role, and — for technician actions — does the WO's `assignedTechId` match the caller's own `technicianId`, looked up via a second document read) combined against an 11-state transition table. Expressing that fully in `firestore.rules` would grow the ruleset into an equivalent, harder-to-audit state machine. Centralizing it in one server-side TypeScript module (`functions/src/transitionEngine.ts`) keeps the whole state machine visible in one place and independently unit-testable without a live Firestore connection.

## Consequences

- **New deploy surface.** `firebase deploy --only functions` joins the already-manual `firestore:rules` deploy step (`docs/Deployment.md`) — this repo has no CI for either, and now has two manual deploy steps instead of one. Both are explicitly called out in the PR description; neither should be assumed to be live without checking.
- **Two intentional duplications, both commented in both directions to stay findable:**
  - `functions/src/transitionEngine.ts` ↔ `field-ops-app-vite/src/domain/workOrderWorkflow.js` (the state machine + permission matrix, server-side and client-side — defense-in-depth, required by the spec).
  - `functions/src/types/workOrder.ts` ↔ `field-ops-app-vite/src/types/workOrder.ts` (the type contract, since no shared/monorepo tooling exists to unify them).
  If this pattern needs a third instance, it's worth building real shared tooling instead of a third manual-sync comment.
- **Phase 2 is real, tracked, deferred work** — dispatcher-facing create/schedule/dispatch forms and technician-facing accept/travel/arrive/complete actions do not exist yet. `domain/workOrderWorkflow.js`'s `getAllowedActions()` has no caller yet; `WorkOrderDetail.jsx` has a marked TODO block for where the action buttons go.
- **No referential integrity between `fieldops_jobs.workOrderId` and `fieldops_wos`** is an accepted, known gap — an orphaned reference (pointing at a WO doc that never existed, or was since removed) is now possible and is not detected or surfaced by this pass.
- **Verification is emulator-based**, not manual click-through, since no new interactive UI exists this pass to click through: Firebase Local Emulator Suite (auth+firestore+functions), a seeded verification script exercising both callables through the client SDK (so `firestore.rules`' denial is actually exercised, not just the callable logic), and `@firebase/rules-unit-testing` assertions for the rules themselves.
