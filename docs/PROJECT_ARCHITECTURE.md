# Project Architecture

Authoritative description of Taylor Parts / Field Ops's system design. If code and this document disagree, treat the disagreement as a bug in one of them and reconcile — don't silently pick one.

## Relationship to Product Governance

This document, and the `architecture/` ADRs, describe **how** the platform is built. They exist to satisfy the product decisions defined in `ProductVision.md`, `PlatformConstitution.md`, and `ProductBlueprint.md` — architecture follows product, not the other way around.

Concretely:

- **`ProductVision.md`** sets the platform's long-term scope and multi-tenant/configurable-platform principle; architecture decisions (data model, write paths, module boundaries) are expected to remain compatible with that scope, even when only a subset of it is built today.
- **`PlatformConstitution.md`** sets platform-wide principles (One Source of Truth, Business Domains, Role-Based Experiences, Configurable Platform, etc.); the system-of-record and single-write-path rules in this document are the architectural implementation of those principles, not a separate or competing set of rules.
- **`ProductBlueprint.md`** sets the approved business-domain navigation and business objects; when this document's module/collection boundaries diverge from that blueprint, treat it the same as any other doc/code disagreement above — reconcile, don't silently pick one.

Implementation must satisfy both sets of documents. Where they conflict, that conflict should be identified and resolved explicitly before writing code — see `CLAUDE_CONTEXT.md`'s "Product Authorities" section.

## System of record

- **Main (`field-ops-app-vite`) is the system of record.** Auth-gated (Firebase Auth required). Firestore is the source of truth for all operational data across every model described below.
- **As of Release 2.0, three distinct operational data models coexist on `main`, each with its own write path** — this section names them; `docs/architecture/SYSTEM_AUTHORITIES.md` is the authoritative per-concern ownership map and is not restated here:
  1. **Job / Technician (legacy, still real and in active use)** — `fieldops_jobs`/`fieldops_technicians`, client-direct-write via `domain/jobActions.js`, rules-enforced. Described in full below.
  2. **Work Order Engine** — `fieldops_wos`, Cloud-Function-only writes, its own 11-status lifecycle. See "Work Order Engine" below and `docs/architecture/ADR-002-work-order-engine.md`.
  3. **Customer model** — `accounts`/`contacts`/`locations` (Sprint 2.0.2), client-direct-write via `domain/accounts.js`/`domain/locations.js`/`domain/contacts.js`, rules-enforced, admin/dispatcher only. See "Customer model" below and `BusinessEntityModel.md`.

  Inventory (`inventory_transactions`, append-only ledger), Warehouse, and Procurement follow the same Cloud-Function-write pattern as the Work Order Engine — see `docs/architecture/ADR-003-inventory-trigger-system.md` and `SYSTEM_AUTHORITIES.md` for their specific write paths; not restated here.
- **`JOB_STATUS` is the canonical status enum for the Job/Technician model**: `OPEN → ASSIGNED → IN_PROGRESS → COMPLETE`. Defined once, in `field-ops-app-vite/src/domain/constants.js`. No duplicate or parallel status enum is permitted for this model anywhere in the repo. (The Work Order Engine has its own, separate 11-status `WorkOrderStatus` — a deliberate, scoped exception for a genuinely distinct entity, not a violation of this rule; see ADR-002's "Reasoning" section for why the two are not the same kind of duplication ADR-001 rejected.)
- **All Job state transitions go through the domain layer** (`field-ops-app-vite/src/domain/jobActions.js`):
  - `assignJob(job, technician)` — the only place `OPEN → ASSIGNED` happens. Transactional (`runTransaction`): re-checks technician availability inside the transaction so two dispatchers can't both win the same technician.
  - `updateJobStatus(job, nextStatus)` — handles `ASSIGNED → IN_PROGRESS` and `IN_PROGRESS → COMPLETE`. Also transactional as of Sprint 3.1: re-reads the job and re-validates `canTransitionJob()` inside the transaction, and commits the job + technician writes atomically (fixes a prior partial-write bug where a job could end up `COMPLETE` while its technician stayed stuck at `ON_JOB`).
  - No UI component writes Job/Technician state to Firestore directly. Every write path goes through one of the two functions above.

## Control Tower: read-only intelligence layer

- Control Tower (`field-ops-app-vite/src/modules/controlTower/`) computes **derived-only** operational signals. It **never** mutates Firestore, job state, technician state, or Work Order state.
- Two distinct data sources feed different parts of Control Tower — don't conflate them: the Signal-scoring panels (`AtRiskPanel`/`DispatchQueuePanel`/`OverloadedTechPanel`) still derive their signals by aggregating Jobs by `workOrderId` (the legacy Job/Technician model above); `WorkOrderDetail.jsx`, separately, reads a real `fieldops_wos` document (the Work Order Engine below). Both are real and in use; neither replaces the other yet.
- As of Sprint 3.3, every scoring module (`domain/workOrderScoring.js`, `domain/dispatchScoring.js`, `domain/jobRiskScoring.js`) returns a canonical **Signal** shape, defined in `domain/controlTower/types.js`:
  ```
  { id, score, severity, label, metadata }
  ```
  `severity` is one of `LOW | MEDIUM | HIGH | CRITICAL`. This is the one schema every panel renders against — panels never recompute score/severity themselves.
- Control Tower's UI is **panelized** (Sprint 3.3.4): `ControlTower.jsx` is the composition root (owns the Firestore listeners), and `modules/controlTower/panels/{AtRiskPanel,DispatchQueuePanel,OverloadedTechPanel}.jsx` are pure renderers. Enforced invariants (`domain/controlTower/types.js`'s `assertPanelProps`/`assertValidSignal`, dev-only):
  1. Every panel receives exactly `{ jobs, technicians, workOrders }` — no other prop shape.
  2. No panel calls `useFirestoreCollection` or imports `firebase/*` directly.
  3. No panel inlines scoring/derivation logic — panels call `domain/*.js` and render the result.
  4. Every signal a panel renders conforms to the canonical Signal shape.

## Work Order Engine

- **`fieldops_wos` is a real, persisted Firestore collection** — the Work Order Engine (Epic 1, merged to `main`) replaced the earlier derived/aggregate model entirely for new consumers. Full design and reasoning: `docs/architecture/ADR-002-work-order-engine.md`; per-concern write/read ownership: `SYSTEM_AUTHORITIES.md` (not restated here).
- Its own 11-value `WorkOrderStatus` lifecycle (`CREATED → READY_TO_DISPATCH → SCHEDULED → DISPATCHED → ACCEPTED → EN_ROUTE → ARRIVED → WORK_IN_PROGRESS → COMPLETED → CLOSED`, plus `CANCELLED`) is defined canonically in `functions/src/transitionEngine.ts`, mirrored client-side in `domain/workOrderWorkflow.js`.
- **All `fieldops_wos`/`counters` writes go through exactly two Cloud Functions**: `createWorkOrder()` and `transitionWorkOrder()`. `firestore.rules` denies all direct client writes to both collections unconditionally — no admin/dispatcher exception of any kind.
- **Job↔Work Order relationship is soft-coupled**: `job.workOrderId` is an optional, unenforced reference to a `fieldops_wos` doc ID. No referential integrity, no cascade. `domain/jobActions.js`, `JOB_STATUS`, `Dispatch.jsx`, and `FieldMode.jsx` are untouched by the Work Order Engine.
- `domain/workOrderLifecycle.js` (the pre-Epic-1 Job-grouping aggregate described in earlier revisions of this document) is **deprecated, not deleted** — frozen, with exactly one remaining consumer (`domain/timelineBuilder.js`). No new consumer may call it; new consumers read real `fieldops_wos` docs instead.

## Customer model (Account / Contact / Location)

- **`accounts`/`contacts`/`locations` are real, persisted Firestore collections** (Sprint 2.0.2, merged to `main`) — client-direct-write via `domain/accounts.js`/`domain/locations.js`/`domain/contacts.js`, rules-enforced, admin/dispatcher only (no technician read access). Full entity model, relationships, and the internal-`accounts`/UI-"Customers" naming convention: `BusinessEntityModel.md` (not restated here).
- `WorkOrder.customerId` (on `fieldops_wos`) may point to an `accounts` document's ID — the field is not renamed to `accountId`; this is a deliberate, permanent naming mismatch (see `BusinessEntityModel.md`'s "Naming recommendation" section).

## Known schema limitation: no lifecycle timestamps (Job/Technician model only)

The **legacy Job/Technician schema** only writes `createdAt` (once, at document creation, via `collectionStore.add()`). There is **no `assignedAt`/`startedAt`** per status transition. Every age/recency/risk signal derived in `dispatchScoring.js` and `jobRiskScoring.js` is therefore an **approximation** based on time-since-creation, not precise operational timing. This is documented inline in both files and flagged in the UI (`(approx.)` labels). Fixing this properly requires a schema change to `assignJob()`/`updateJobStatus()`, deliberately deferred — see `FUTURE_ARCHITECTURE_BACKLOG.md`.

**This limitation does not apply to the Work Order Engine**, which persists real execution timestamps (`dispatchedAt`, `acceptedAt`, `enRouteAt`, `arrivedAt`, `workStartedAt`, `completedAt`, `closedAt`) as a deliberate design choice made specifically because Job never tracked this information — see ADR-002's "Reasoning" section.

## Legacy app (removed)

An earlier, non-Vite `field-ops-app/` existed in parallel with `field-ops-app-vite/` due to a mis-scoped Sprint 2 pass that touched both apps. It was confirmed unreferenced by any deploy workflow, build script, or doc, and removed in commit `43fcf3e` (PR #3). Do not recreate a parallel app structure.

## Forbidden patterns (non-negotiable)

- No duplicate `JOB_STATUS` (or equivalent) enum for the Job/Technician model.
- No direct Firestore writes from UI components, for any of the three models above — Job/Technician writes go only through `domain/jobActions.js`; Work Order writes go only through `createWorkOrder()`/`transitionWorkOrder()`; Customer-model writes go only through `domain/accounts.js`/`domain/locations.js`/`domain/contacts.js`.
- No dispatch/assignment logic outside `assignJob()`/`updateJobStatus()`.
- No second Work Order lifecycle competing with `functions/src/transitionEngine.ts`, and no new consumer of the deprecated `domain/workOrderLifecycle.js`.
- No second Control Tower implementation.
- No inline scoring logic in Control Tower panels.
