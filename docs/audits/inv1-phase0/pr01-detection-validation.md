# INV-1 Phase 0 — PR 0.1 Detection Engine Validation

**Gate:** INV-1 Phase 0, PR 0.1 (Owner-authorized 2026-07-22; Phase 0 sequence approved with PR 0.2/0.3 and Gates 0.4a/0.4b separately gated).
**Governing chain:** `docs/implementation-plans/enterprise-inventory-architecture.md` Phase 0, adopted per `docs/DECISIONS.md` #37.
**Scope:** pure detection only. This PR contains **no execution or retry capability, no Firestore reads/writes, no deployment, no Rules change, no Functions-export change, and no production operation.**

## 1. Detection contract

Module: `functions/src/inventoryEffectDetection.ts` (compiled to `lib/`, consumed later by PR 0.2 operator tooling).

- `detectWorkOrderInventoryEffects(workOrder, syncStatus) → DetectionOutcome`
- `detectBatchInventoryEffects(entries[]) → DetectionOutcome[]` (independent outcomes, order preserved)

Pure and deterministic: no firebase-admin import (verified: zero `require()` calls in the compiled JS), no wall clock, no global state, never throws on data-shaped problems — structurally invalid input returns a typed `DetectionValidationError` (`INVALID_WORK_ORDER_ID` | `INVALID_INPUT_SHAPE`).

## 2. Input model (plain-data projections; PR 0.2 maps Firestore docs to these)

- `WorkOrderEvidenceInput`: `workOrderId`; `status` (unknown-tolerant); `executionTimestamps` (presence-only — any non-null value counts, values never interpreted); `inventorySnapshotItemCount` (descriptive pass-through only).
- `SyncStatusEvidenceInput`: `exists`; `processedStates`; `failures`; `finalized`.

## 3. Effect model (verified against current code, not documentation)

Mirrors `functions/src/inventoryService.ts` `STATE_TRIGGERS` exactly:

| Trigger state | Effect | Canonical processed evidence | Canonical failure evidence |
|---|---|---|---|
| DISPATCHED | RESERVE | `processedStates.DISPATCHED === true` | `failures.DISPATCHED.retryNeeded === true` |
| COMPLETED | CONSUME_AND_FINALIZE | `processedStates.COMPLETED === true` (+ `finalized: true` cross-check) | `failures.COMPLETED.retryNeeded === true` |
| CANCELLED | RELEASE | `processedStates.CANCELLED === true` | `failures.CANCELLED.retryNeeded === true` |

## 4. Classification precedence (fail-safe, per authorization §5)

1. canonical processed marker → **PROCESSED**
2. recorded retry-needed failure → **RECORDED_FAILURE** (outranks lifecycle evidence: the failure record is direct proof the trigger ran and failed, valid even when legacy lifecycle evidence is incomplete)
3. lifecycle evidence implying the state → **SILENT_MISS**
4. otherwise → **NOT_EXPECTED**

Conflicting evidence never re-classifies silently — it emits warnings (`PROCESSED_AND_FAILURE_CONFLICT`, `FAILURE_WITHOUT_RETRY_FLAG`, `PROCESSED_MARKER_MALFORMED`, `FAILURE_ENTRY_MALFORMED`, `FINALIZED_FLAG_MISSING`, `FINALIZED_WITHOUT_PROCESSED_MARKER`) and forces `operatorReviewRequired`.

## 5. Lifecycle evidence used (strength order: TIMESTAMP > STATUS > IMPLIED_BY_LATER)

Verified against `functions/src/transitionEngine.ts` (`TRANSITIONS`, `ACTION_TIMESTAMP_FIELD`) and `functions/src/types/workOrder.ts`:

- **DISPATCHED**: `dispatchedAt`; else current status at/after DISPATCHED on the forward chain; else any later immutable execution timestamp (`acceptedAt`/`enRouteAt`/`arrivedAt`/`workStartedAt`/`completedAt`).
- **COMPLETED**: `completedAt`; else status ∈ {COMPLETED, CLOSED}.
- **CANCELLED**: terminal status only — Cancel has **no dedicated timestamp** (it reuses `closedAt`, which Close also writes), so `closedAt` is **never** used as evidence for any state.
- A `CANCELLED` current status alone gives **no** DISPATCHED evidence (cancel-before-dispatch is legal); dispatch evidence must come from timestamps.
- The detector's `FORWARD_STATUS_ORDER` is asserted against `transitionEngine.TRANSITIONS` in the unit tests, so lifecycle drift fails tests rather than misclassifying.

## 6. Reason codes (stable, machine-readable)

`PROCESSED_MARKER_PRESENT`, `RETRY_NEEDED_FAILURE_RECORDED`, `EXPECTED_BY_TIMESTAMP_NO_MARKER`, `EXPECTED_BY_STATUS_NO_MARKER`, `EXPECTED_BY_LATER_EVIDENCE_NO_MARKER`, `LIFECYCLE_EVIDENCE_ABSENT`; validation: `INVALID_WORK_ORDER_ID`, `INVALID_INPUT_SHAPE`. Warning codes are enumerated in §4 plus `UNKNOWN_STATUS_VALUE`, `STATUS_ABSENT`, `SYNC_STATUS_ABSENT`, `UNRECOGNIZED_PROCESSED_STATE_KEY`, `UNRECOGNIZED_FAILURE_STATE_KEY`.

## 7. Output contract (per item)

`workOrderId`, `state`, `effect`, `classification`, `reasonCode`, `evidence` (`processedMarker`, `failureRecorded`, `retryNeeded`, `lifecycleEvidence`, `finalizedFlag`, `inventorySnapshotItemCount`), `retryCandidate` (RECORDED_FAILURE and SILENT_MISS), `operatorReviewRequired` (every SILENT_MISS; any item warning; NOT_EXPECTED items under degraded status evidence), `warnings[]`. Result-level: exactly one item per trigger state in fixed order + WO-level warnings.

## 8. Edge cases covered (all tested)

No/empty/populated snapshot (never changes expectation — `triggerInventoryEffects` marks a state processed even for empty snapshots); absent sync doc; partially populated sync doc; processed present; retryNeeded failure present; failure with `retryNeeded: false`/absent; every current lifecycle status (full sweep table); status advanced past a state with immutable timestamp present; cancellation after reservation (both DISPATCHED and CANCELLED expected); completion via status only (legacy, no `completedAt`); malformed/unknown/absent status (warned, timestamps still drive evidence, NOT_EXPECTED items forced to operator review); missing/null timestamp map; conflicting processed+failure evidence; markers under non-trigger keys (warned); malformed marker values; legacy records missing modern fields; batch with invalid entries isolated.

## 9. Tests and results

- New: `functions/test/inventoryEffectDetection.test.mjs` — **38 passed, 0 failed** (`npm run test:inventoryEffectDetection`, wired into `functions/package.json`). Plain Node assert test against compiled `lib/` (repo pure-logic convention); no emulator, no network, no Firebase project identifier, no credential.
- Regression: `npm run test:transitionEngine` — **24 passed, 0 failed**. `npm run test:workOrderEngineFunctions` — result recorded in the PR description. `npm run build` (tsc) clean.
- No test connects to production; no production identifier or credential required anywhere in this PR.

## 10. Known limitations (documented, deliberate)

1. **CANCELLED release detection depends on terminal status** — a hypothetical legacy record cancelled without status evidence is undetectable (no dedicated Cancel timestamp exists in the schema; PR 0.1 does not change schemas).
2. **`closedAt` ambiguity** means a COMPLETED expectation cannot be derived from `closedAt` alone; legacy records with only `closedAt` classify NOT_EXPECTED (with status-degradation review flags where applicable).
3. The detector reports; it does not inspect the ledger itself (`inventory_transactions` cross-checks are a possible later enhancement, deliberately out of PR 0.1 scope).
4. `RECORDED_FAILURE` retry candidacy does not judge whether a retry would succeed (e.g. reserve may still legitimately fail on insufficient availability) — that is operator/Gate 0.4b territory.

## 11. PR 0.1 / PR 0.2 boundary

PR 0.1 ends at the pure classification result. PR 0.2 (separately authorized, not started) owns: Firestore document → input projection, the read-only audit script, evidence artifacts per `docs/governance/audit-artifact-standard.md`, and the retry script that re-invokes the existing idempotent `triggerInventoryEffects`. This module never calls `triggerInventoryEffects`, never authorizes anything, and contains no execution path.
