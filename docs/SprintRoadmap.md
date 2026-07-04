# Sprint Roadmap

This roadmap was requested as a 5-phase plan. Worth being upfront: this project is **already well past most of these phases** — see `docs/SPRINT_STATUS.md` for the sprint-by-sprint history. Presenting this as a from-scratch future plan would be misleading, so each phase below is annotated with its real, current status rather than left as an untouched aspiration.

## Phase 1: Core data model (jobs, work orders, techs, inventory)

**Status: done**, in layers:
- Jobs (`fieldops_jobs`, `JOB_STATUS` enum), Technicians (`fieldops_technicians`, `TECH_STATUS` enum) — since the original Vite migration.
- Work Orders — derived grouping by `workOrderId`, formalized as a real aggregation engine in Sprint 3.4 (`domain/workOrderLifecycle.js`). No populated real Work Order documents exist yet (see `docs/FUTURE_ARCHITECTURE_BACKLOG.md`).
- Inventory — a real, transactional data model (`fieldops_inventory`, warehouse/truck locations, available/reserved quantities) landed in Sprint 4 (`services/inventoryService.js`). A separate, demo-only, in-memory inventory model also exists from Sprint 3.6 (`demo/InventoryContext.jsx`) and is intentionally untouched/kept for the shareable demo.

## Phase 2: Dispatch system UI

**Status: done.** `modules/dispatch/Dispatch.jsx` has existed since early sprints; Sprint 3.6 added status/priority chips (reusing the existing risk-scoring engine) and hero-job highlighting. The underlying dispatch *intelligence* (technician ranking, workload balance, urgency scoring) was built in Sprints 3.2–3.3 (`domain/dispatchScoring.js`) and extended with a simple availability classifier in Sprint 4.

## Phase 3: Technician mobile experience

**Status: done.** `modules/mobile/FieldMode.jsx` — significantly upgraded in Sprint 3.6 into a mobile-first single-active-job view with a large-button flow (Start Travel → Arrived → Start Work → Use Part → Complete Job).

## Phase 4: Inventory + parts tracking

**Status: done**, same two-layer split as Phase 1: the demo-only truck/warehouse inventory (Sprint 3.6, tied to the shareable-demo hero story) and the real, transactional inventory + parts-reservation system (Sprint 4, `services/inventoryService.js` + `job.partsRequired`/`partsReserved`). Sprint 4 also added a persisted job event log (`fieldops_job_events`) tracking part reservation/consumption per job.

## Phase 5: Optimization + automation

**Status: not started, deliberately.** Every sprint through Sprint 4 has explicitly scoped dispatch suggestions as **rule-based only** ("no ML or advanced optimization" — stated hard rule in both Sprint 3.6 and Sprint 4). This phase is real, open future work:

- Route optimization — not built, explicitly out of scope so far.
- Predictive maintenance / analytics — not built, explicitly out of scope so far.
- Any ML-driven dispatch scoring — not built; the current scoring (`domain/dispatchScoring.js`) is a fixed weighted formula (urgency/availability/workload/affinity), not a learned model.

## Known operational gap blocking full Phase 1/4 activation

Sprint 4's real inventory system requires updated Firestore security rules (`field-ops-app-vite/firestore.rules`) to be deployed — as of this writing, that deploy has not been run (see `docs/Deployment.md`). Until it is, inventory/job-event writes fail with permission errors even though the code is complete and merged.
