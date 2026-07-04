# ADR-001: Inventory, job event persistence, and phase-based lifecycle removed from MVP architecture

## Status

Accepted

## Context

PR #10 (`sprint-4-operational-core`) implemented a real, Firestore-backed
inventory system (`fieldops_inventory`), a persisted job event log
(`fieldops_job_events`), and an additive `job.phase` field with its own
transition state machine (`domain/jobPhaseWorkflow.js`), layered on top
of the existing `JOB_STATUS`/`canTransitionJob()` lifecycle.

By the time this PR was reviewed, the project had settled on a different
set of architectural defaults (see `docs/CLAUDE_CONTEXT.md`'s
"Non-negotiable rules"):

- `fieldops_jobs` is the single execution source of truth.
- No duplicate lifecycle model alongside `JOB_STATUS`.
- Aggregates and derived state are computed on read, not cached in a
  second collection that can drift (this is why the Activity Timeline
  and dispatch priority ranking are both derived-only, with no persisted
  collection backing them).
- UI-visible travel/work state is not persisted.
- Inventory is deferred until a proper transaction engine is designed,
  rather than building a first-pass inventory model ahead of that design.

PR #10 predates these decisions being made explicit, which is why it
conflicts with them despite being technically sound, well-tested, and
transparent about its own tradeoffs (it documents, correctly, that its
Firestore rules require a manual deploy step this repo has no CI for).

An evidence-based, file-by-file audit of the branch (reading every
changed file's actual diff, not just commit messages) found exactly one
piece that doesn't depend on any of the retired subsystems:
`domain/dispatchScoring.js`'s `AVAILABILITY` enum and
`getTechnicianAvailability()` — a pure function that derives a
technician's availability from the existing `job.status`/`technicianId`
fields already on `fieldops_jobs`, with no new collection and no
persisted state.

## Decision

**Accepted, cherry-picked into `sprint-4-availability-classifier`:**
- `domain/dispatchScoring.js` — `AVAILABILITY` enum + `getTechnicianAvailability()`.

**Rejected, not brought forward from `sprint-4-operational-core`:**
- `fieldops_inventory` collection / `services/inventoryService.js`
- `fieldops_job_events` collection / `services/jobEventService.js`
- `JOB_PHASE` enum / `domain/jobPhaseWorkflow.js`
- `services/jobService.js` (phase-tracking composition layer built on the three items above)
- `modules/opsDebug/OperationalDebugView.jsx` (a UI harness that only exercises the rejected services)
- The `firestore.rules` additions permitting the two rejected collections

PR #10 itself is closed, unmerged, superseded by this ADR and by
`sprint-4-availability-classifier`.

## Reasoning

- Firestore (`fieldops_jobs`) remains the only execution source of truth — no second lifecycle model (`job.phase`) running in parallel with `JOB_STATUS`.
- Inventory will be redesigned as a transaction engine, not retrofitted onto a v1 built before that design existed.
- UI-visible state (travel started, work started, etc.) stays ephemeral/derived, not persisted.
- No persisted event stream (`fieldops_job_events`) until there's a broader eventing strategy that this project has deliberately not committed to yet.

## Consequences

- The reusable technician-availability classifier ships via a small, focused PR instead of being tied to the rejected subsystems.
- Any future inventory or persisted-event work starts from a clean design rather than resuming `sprint-4-operational-core`'s code — that branch is retained in git history (not deleted) as a reference for what a first attempt looked like, but should not be resumed directly.
