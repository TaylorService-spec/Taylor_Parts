# Sprint Status

Snapshot as of 2026-07-03. This file is a point-in-time record, not a live dashboard — re-verify against `git log`/`gh pr list` before relying on it, especially PR merge state.

## Completed / merged

| Sprint | Branch | PR | Status | Summary |
|---|---|---|---|---|
| Vite migration | `claude/field-ops-app-vite-migration` | #1, #2 | Merged | Migrated the field ops app to Vite + React; initial Control Tower dashboard. |
| Sprint 2 (integration) | `integration/sprint2-control-tower` | #3 | Merged | Work Order → Jobs hierarchy, readiness scoring, technician workload view. Also removed the obsolete parallel `field-ops-app/` (never deployed, confirmed unreferenced by CI/docs). |
| Sprint 3.1 | `sprint-3.1-transactional-completion` | #4 | Merged | Made `updateJobStatus()` transactional (`runTransaction`, mirroring `assignJob()`), fixing a partial-write bug that could strand a technician at `ON_JOB` after their job completed. |
| Sprint 3.2 | `sprint-3.2-dispatch-intelligence` | #5 | Merged | Added the first dispatch intelligence layer: `dispatchScoring.js`, `jobRiskScoring.js`, and three Control Tower panels (inline, pre-refactor). |

## In review

| Sprint | Branch | PR | Status | Summary |
|---|---|---|---|---|
| Sprint 3.3 | `sprint-3.3-signal-schema` | #6 | **Open, CLEAN/MERGEABLE, CI green** — frozen, no further commits | Six-commit refactor: canonical Signal schema (`domain/controlTower/types.js`), weighted/explainable dispatch scoring, layered/explainable risk scoring, Control Tower panel split, unified severity badges + noise reduction, panel guardrails/invariants. |

Verified via `gh pr view 6` as of this writing: `state: OPEN`, `mergeable: MERGEABLE`, `mergeStateStatus: CLEAN`, both `build` checks `SUCCESS`. Not yet merged — do not assume it has landed in `main`.

## In progress

| Sprint | Branch | Status |
|---|---|---|
| Sprint 3.4 | `sprint-3.4-workorder-lifecycle` | Branched fresh from `main` (pre-3.3, since #6 hasn't merged yet). Scope not yet defined at time of writing. |

## Discipline notes for whoever picks this up

- Sprint 3.3 is **frozen**: confirmed mergeable, no more commits go on that branch. If more Sprint-3.3-shaped work turns up, it's a new sprint branch.
- Sprint 3.4 was intentionally cut from `main` rather than waiting for #6 to merge — this mirrors how 3.2 was cut before 3.1 merged. It is independent of #6's contents; check for merge-order implications before assuming anything about how they'll combine.
- Always re-verify PR/branch state before recommending next steps — see `DEVELOPMENT_STANDARDS.md`'s PR discipline section.
