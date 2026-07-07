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

- **Main (`field-ops-app-vite`) is the system of record.** Auth-gated (Firebase Auth required). Firestore is the source of truth for all job/technician/work-order state.
- **`JOB_STATUS` is the canonical status enum**: `OPEN → ASSIGNED → IN_PROGRESS → COMPLETE`. Defined once, in `field-ops-app-vite/src/domain/constants.js`. No duplicate or parallel status enum is permitted anywhere in the repo.
- **All job state transitions go through the domain layer** (`field-ops-app-vite/src/domain/jobActions.js`):
  - `assignJob(job, technician)` — the only place `OPEN → ASSIGNED` happens. Transactional (`runTransaction`): re-checks technician availability inside the transaction so two dispatchers can't both win the same technician.
  - `updateJobStatus(job, nextStatus)` — handles `ASSIGNED → IN_PROGRESS` and `IN_PROGRESS → COMPLETE`. Also transactional as of Sprint 3.1: re-reads the job and re-validates `canTransitionJob()` inside the transaction, and commits the job + technician writes atomically (fixes a prior partial-write bug where a job could end up `COMPLETE` while its technician stayed stuck at `ON_JOB`).
  - No UI component writes to Firestore directly. Every write path goes through one of the two functions above.

## Control Tower: read-only intelligence layer

- Control Tower (`field-ops-app-vite/src/modules/controlTower/`) aggregates Jobs by `workOrderId` and computes **derived-only** operational signals. It **never** mutates Firestore, job state, or technician state.
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

## Work Order model

- Work Orders are the parent grouping of Jobs. Jobs carry a `workOrderId` field.
- There is a `domain/workOrders.js` with a `workOrdersStore`, but as of this writing **no UI creates or reads actual Firestore `workOrders` documents** — Control Tower derives "work orders" by grouping jobs client-side on `workOrderId`. Treat `workOrders` props passed to Control Tower panels as this derived grouping, not a raw collection read, until/unless a real work-order UI is built.
- Work Orders are never mutated by Control Tower.

## Known schema limitation: no lifecycle timestamps

The current schema only writes `createdAt` (once, at document creation, via `collectionStore.add()`). There is **no `assignedAt`/`startedAt`** per status transition. Every age/recency/risk signal derived in `dispatchScoring.js` and `jobRiskScoring.js` is therefore an **approximation** based on time-since-creation, not precise operational timing. This is documented inline in both files and flagged in the UI (`(approx.)` labels). Fixing this properly requires a schema change to `assignJob()`/`updateJobStatus()`, deliberately deferred — see `FUTURE_ARCHITECTURE_BACKLOG.md`.

## Legacy app (removed)

An earlier, non-Vite `field-ops-app/` existed in parallel with `field-ops-app-vite/` due to a mis-scoped Sprint 2 pass that touched both apps. It was confirmed unreferenced by any deploy workflow, build script, or doc, and removed in commit `43fcf3e` (PR #3). Do not recreate a parallel app structure.

## Forbidden patterns (non-negotiable)

- No duplicate `JOB_STATUS` (or equivalent) enums.
- No direct Firestore writes from UI components.
- No dispatch/assignment logic outside `assignJob()`/`updateJobStatus()`.
- No second Control Tower implementation.
- No inline scoring logic in Control Tower panels.
