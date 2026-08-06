---
artifact_type: review
gate: W4 — Reconcile to ONE Work Order model (orphan-retirement slice)
wave: W4
status: Complete — awaiting Codex review + Owner approval at section boundary
date: 2026-08-05
owner: Claude Code
base_commit: 33ed8cf (origin/main)
branch: feature/w4-one-work-order-model
ruling: R1 (fieldops_wos canonical; retire legacy jobs-based orphans ONLY after verified zero-consumer)
---

# W4 — Legacy jobs-based Work Order orphan retirement

Per **R1**: `fieldops_wos` is the single canonical Work Order model; the legacy jobs-based
lifecycle is retired **only after verified zero-consumer/parity checks**. This slice retires
the verified orphans. **No destructive data migration** (R1) — no Firestore data touched.

## Retired (all re-verified zero-consumer across src + test on 33ed8cf)

**Whole dead files deleted:**
- `domain/workOrders.js` — its only export `workOrdersStore` (the non-canonical `workOrders`
  collection store, explicitly named in R1) had 0 consumers; nothing imported the file.
- `domain/workOrderValidation.js` — 0 imports anywhere.

**Orphaned exports removed from live files:**
- `domain/workOrderLifecycle.js`: `isActiveWorkOrder`, `isCompletedWorkOrder`,
  `explainWorkOrderState` (+ the private `countByStatus` helper they alone used).
- `domain/workOrderScoring.js`: `computeWorkOrderSignal` (the jobs-aggregate signal), plus
  its now-unused `explainWorkOrderState` import.

**Cascade handled:** removing `computeWorkOrderSignal` orphaned its only dependency
`explainWorkOrderState`, which was removed in the same pass (verified no other consumer).

## Kept (verified LIVE consumers — the one canonical path)

- `computeWorkOrderState()` → `domain/timelineBuilder.js` (its call site has only a jobs
  array, no WO doc; out of scope for the v1.2 migration, per R1's "migrate consumers" — a
  data-migration concern, not a retirement).
- `mapWoStatusToLifecycleState()` + `explainWorkOrder()` (real-`fieldops_wos`-doc maps) →
  `domain/workOrderScoring.js`'s `computeWorkOrderSignalFromDoc()` →
  `modules/controlTower/WorkOrderDetail.jsx`.

## Comment truth pass

Four **comment** references to the deleted files were corrected in place (no imports were
ever involved): `jobActions.js`, `dispatchScoring.js`, `timelineBuilder.js` (all cited the
retired `workOrders.js`), and `eventValidation.js` (cited the retired `workOrderValidation.js`).

## Verification

Behavior-neutral (every retired symbol/file was 0-consumer): `npm run lint` 0 errors ·
`typecheck` 0 · `build` 0 (402 ms) · node tests 0 failures · component tests 485 passed /
33 files. No `firestore.rules`, no data migration, no route/UI behavior change.

## Explicitly deferred (NOT in this work-order-scoped slice)

- **Adjacent verified-dead files** (0 imports each, but NOT jobs-based work-order code):
  `domain/eventValidation.js` and `modules/registry/moduleRegistry.ts` — candidates for a
  separate small dead-code sweep, out of R1's work-order scope.
- **Human-readable IDs** (the W4 blueprint bullet: opaque customer/location IDs → names) —
  a distinct, larger slice; not part of this orphan retirement.
