// INV-1 Phase 0, PR 0.1 -- unit tests for the pure inventory-effect
// detection engine (functions/src/inventoryEffectDetection.ts).
//
// The module under test is pure (no Firestore, no firebase-admin, no wall
// clock), so this is a plain Node assert test against the compiled lib/
// output -- matching this repo's pure-logic test convention
// (transitionEngine.test.mjs, compactClaims.test.mjs).
//
// Prerequisite: `npm run build` in functions/ first.
// Run: node test/inventoryEffectDetection.test.mjs  (or npm run test:inventoryEffectDetection)
//
// NO test here connects to any Firebase project, emulator, or network.

import assert from "node:assert/strict";
import {
  TRIGGER_STATES,
  TRIGGER_EFFECT,
  FORWARD_STATUS_ORDER,
  lifecycleEvidenceFor,
  detectWorkOrderInventoryEffects,
  detectBatchInventoryEffects,
} from "../lib/inventoryEffectDetection.js";
import { TRANSITIONS } from "../lib/transitionEngine.js";

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

// Presence-only timestamp stand-in: the detector must treat ANY non-null
// value as present; it must never interpret the value. A plain marker
// object proves no Timestamp dependency exists.
const TS = { present: true };

function wo(overrides = {}) {
  return { workOrderId: "WO-TEST-1", status: "CREATED", ...overrides };
}
function sync(overrides = {}) {
  return { exists: true, processedStates: {}, failures: {}, ...overrides };
}
const NO_SYNC = { exists: false };

function itemFor(result, state) {
  assert.equal(result.valid, true, `expected valid result, got ${JSON.stringify(result)}`);
  const item = result.items.find((i) => i.state === state);
  assert.ok(item, `no item for state ${state}`);
  return item;
}

console.log("inventoryEffectDetection.test.mjs");

// ---------------------------------------------------------------------------
// 0. Structural guards: vocabulary stays in lockstep with the engine
// ---------------------------------------------------------------------------

check("FORWARD_STATUS_ORDER agrees with transitionEngine.TRANSITIONS forward chain", () => {
  // Every adjacent pair in the forward order must be a legal transition,
  // proving the detector's chain is derived from, not drifting from, the
  // canonical table.
  for (let i = 0; i < FORWARD_STATUS_ORDER.length - 1; i++) {
    const from = FORWARD_STATUS_ORDER[i];
    const to = FORWARD_STATUS_ORDER[i + 1];
    assert.ok(
      TRANSITIONS[from].includes(to),
      `${from} -> ${to} is not a legal transition in transitionEngine`
    );
  }
  // And the chain covers every non-CANCELLED status exactly once.
  const nonCancelled = Object.keys(TRANSITIONS).filter((s) => s !== "CANCELLED");
  assert.equal(FORWARD_STATUS_ORDER.length, nonCancelled.length);
  assert.deepEqual([...FORWARD_STATUS_ORDER].sort(), nonCancelled.sort());
});

check("trigger states and effects mirror inventoryService STATE_TRIGGERS", () => {
  assert.deepEqual([...TRIGGER_STATES], ["DISPATCHED", "COMPLETED", "CANCELLED"]);
  assert.deepEqual(TRIGGER_EFFECT, {
    DISPATCHED: "RESERVE",
    COMPLETED: "CONSUME_AND_FINALIZE",
    CANCELLED: "RELEASE",
  });
});

// ---------------------------------------------------------------------------
// 1. All four classifications, per state
// ---------------------------------------------------------------------------

check("PROCESSED: canonical marker for every trigger state", () => {
  for (const state of TRIGGER_STATES) {
    const woInput =
      state === "CANCELLED" ? wo({ status: "CANCELLED" }) : wo({ status: state });
    const r = detectWorkOrderInventoryEffects(
      woInput,
      sync({ processedStates: { [state]: true }, finalized: state === "COMPLETED" ? true : undefined })
    );
    const item = itemFor(r, state);
    assert.equal(item.classification, "PROCESSED");
    assert.equal(item.reasonCode, "PROCESSED_MARKER_PRESENT");
    assert.equal(item.retryCandidate, false);
    assert.equal(item.operatorReviewRequired, false);
    assert.deepEqual(item.warnings, []);
  }
});

check("RECORDED_FAILURE: retryNeeded failure for every trigger state", () => {
  for (const state of TRIGGER_STATES) {
    const r = detectWorkOrderInventoryEffects(
      wo({ status: state === "CANCELLED" ? "CANCELLED" : state }),
      sync({ failures: { [state]: { error: "boom", at: TS, retryNeeded: true } } })
    );
    const item = itemFor(r, state);
    assert.equal(item.classification, "RECORDED_FAILURE");
    assert.equal(item.reasonCode, "RETRY_NEEDED_FAILURE_RECORDED");
    assert.equal(item.retryCandidate, true);
    assert.equal(item.evidence.retryNeeded, true);
  }
});

check("SILENT_MISS: lifecycle evidence with no marker at all", () => {
  const r = detectWorkOrderInventoryEffects(
    wo({ status: "DISPATCHED", executionTimestamps: { dispatchedAt: TS } }),
    NO_SYNC
  );
  const item = itemFor(r, "DISPATCHED");
  assert.equal(item.classification, "SILENT_MISS");
  assert.equal(item.reasonCode, "EXPECTED_BY_TIMESTAMP_NO_MARKER");
  assert.equal(item.retryCandidate, true);
  assert.equal(item.operatorReviewRequired, true);
  assert.ok(r.warnings.includes("SYNC_STATUS_ABSENT"));
});

check("NOT_EXPECTED: no lifecycle evidence, no false positives", () => {
  const r = detectWorkOrderInventoryEffects(wo({ status: "CREATED" }), sync());
  for (const state of TRIGGER_STATES) {
    const item = itemFor(r, state);
    assert.equal(item.classification, "NOT_EXPECTED");
    assert.equal(item.reasonCode, "LIFECYCLE_EVIDENCE_ABSENT");
    assert.equal(item.retryCandidate, false);
    assert.equal(item.operatorReviewRequired, false);
  }
});

// ---------------------------------------------------------------------------
// 2. Precedence rules
// ---------------------------------------------------------------------------

check("precedence: processed beats recorded failure (conflict warned)", () => {
  const r = detectWorkOrderInventoryEffects(
    wo({ status: "DISPATCHED", executionTimestamps: { dispatchedAt: TS } }),
    sync({
      processedStates: { DISPATCHED: true },
      failures: { DISPATCHED: { error: "x", at: TS, retryNeeded: true } },
    })
  );
  const item = itemFor(r, "DISPATCHED");
  assert.equal(item.classification, "PROCESSED");
  assert.ok(item.warnings.includes("PROCESSED_AND_FAILURE_CONFLICT"));
  assert.equal(item.operatorReviewRequired, true);
});

check("precedence: recorded failure beats lifecycle-derived silent miss", () => {
  const r = detectWorkOrderInventoryEffects(
    wo({ status: "COMPLETED", executionTimestamps: { dispatchedAt: TS, completedAt: TS } }),
    sync({ failures: { COMPLETED: { error: "x", at: TS, retryNeeded: true } } })
  );
  assert.equal(itemFor(r, "COMPLETED").classification, "RECORDED_FAILURE");
});

check("precedence: retryNeeded failure counts even without lifecycle evidence (legacy-safe)", () => {
  const r = detectWorkOrderInventoryEffects(
    wo({ status: "CREATED" }), // no lifecycle evidence for DISPATCHED at all
    sync({ failures: { DISPATCHED: { error: "x", at: TS, retryNeeded: true } } })
  );
  const item = itemFor(r, "DISPATCHED");
  assert.equal(item.classification, "RECORDED_FAILURE");
  assert.equal(item.retryCandidate, true);
});

// ---------------------------------------------------------------------------
// 3. Lifecycle evidence derivation (timestamps > status > implied-by-later)
// ---------------------------------------------------------------------------

check("dispatch evidence: own timestamp is strongest", () => {
  assert.equal(
    lifecycleEvidenceFor(wo({ executionTimestamps: { dispatchedAt: TS } }), "DISPATCHED", "CREATED"),
    "TIMESTAMP"
  );
});

check("dispatch evidence: status at/after DISPATCHED on the forward chain", () => {
  for (const status of ["DISPATCHED", "ACCEPTED", "EN_ROUTE", "ARRIVED", "WORK_IN_PROGRESS", "COMPLETED", "CLOSED"]) {
    assert.equal(lifecycleEvidenceFor(wo(), "DISPATCHED", status), "STATUS", status);
  }
  for (const status of ["CREATED", "READY_TO_DISPATCH", "SCHEDULED"]) {
    assert.equal(lifecycleEvidenceFor(wo(), "DISPATCHED", status), "NONE", status);
  }
});

check("dispatch evidence: later execution timestamp implies dispatch (legacy record)", () => {
  const evidence = lifecycleEvidenceFor(
    wo({ executionTimestamps: { workStartedAt: TS } }),
    "DISPATCHED",
    null // status unusable
  );
  assert.equal(evidence, "IMPLIED_BY_LATER");
});

check("closedAt is never lifecycle evidence (Cancel and Close both write it)", () => {
  const woInput = wo({ executionTimestamps: { closedAt: TS } });
  assert.equal(lifecycleEvidenceFor(woInput, "DISPATCHED", null), "NONE");
  assert.equal(lifecycleEvidenceFor(woInput, "COMPLETED", null), "NONE");
  assert.equal(lifecycleEvidenceFor(woInput, "CANCELLED", null), "NONE");
});

check("cancel evidence: terminal status only", () => {
  assert.equal(lifecycleEvidenceFor(wo(), "CANCELLED", "CANCELLED"), "STATUS");
  assert.equal(lifecycleEvidenceFor(wo(), "CANCELLED", "CLOSED"), "NONE");
  assert.equal(
    lifecycleEvidenceFor(wo({ executionTimestamps: { dispatchedAt: TS, closedAt: TS } }), "CANCELLED", null),
    "NONE"
  );
});

check("CANCELLED current status alone gives NO dispatch evidence (cancel-before-dispatch)", () => {
  const r = detectWorkOrderInventoryEffects(wo({ status: "CANCELLED" }), NO_SYNC);
  assert.equal(itemFor(r, "DISPATCHED").classification, "NOT_EXPECTED");
  const cancelled = itemFor(r, "CANCELLED");
  assert.equal(cancelled.classification, "SILENT_MISS");
  assert.equal(cancelled.reasonCode, "EXPECTED_BY_STATUS_NO_MARKER");
});

check("cancellation after reservation: both DISPATCHED and CANCELLED expected", () => {
  const r = detectWorkOrderInventoryEffects(
    wo({ status: "CANCELLED", executionTimestamps: { dispatchedAt: TS, closedAt: TS } }),
    sync({ processedStates: { DISPATCHED: true } })
  );
  assert.equal(itemFor(r, "DISPATCHED").classification, "PROCESSED");
  assert.equal(itemFor(r, "CANCELLED").classification, "SILENT_MISS"); // release never ran
  assert.equal(itemFor(r, "COMPLETED").classification, "NOT_EXPECTED");
});

check("status advanced past the state but immutable timestamp present (timestamp wins as reason)", () => {
  const r = detectWorkOrderInventoryEffects(
    wo({ status: "CLOSED", executionTimestamps: { dispatchedAt: TS, completedAt: TS, closedAt: TS } }),
    sync() // sync doc exists but nothing processed
  );
  assert.equal(itemFor(r, "DISPATCHED").reasonCode, "EXPECTED_BY_TIMESTAMP_NO_MARKER");
  assert.equal(itemFor(r, "COMPLETED").reasonCode, "EXPECTED_BY_TIMESTAMP_NO_MARKER");
});

check("completion evidence via status only (legacy record without completedAt)", () => {
  const r = detectWorkOrderInventoryEffects(wo({ status: "CLOSED" }), sync());
  const item = itemFor(r, "COMPLETED");
  assert.equal(item.classification, "SILENT_MISS");
  assert.equal(item.reasonCode, "EXPECTED_BY_STATUS_NO_MARKER");
});

// ---------------------------------------------------------------------------
// 4. Work Order lifecycle sweep: current status in each relevant state
// ---------------------------------------------------------------------------

check("full status sweep produces expected DISPATCHED/COMPLETED/CANCELLED expectations", () => {
  const expectations = {
    CREATED: [false, false, false],
    READY_TO_DISPATCH: [false, false, false],
    SCHEDULED: [false, false, false],
    DISPATCHED: [true, false, false],
    ACCEPTED: [true, false, false],
    EN_ROUTE: [true, false, false],
    ARRIVED: [true, false, false],
    WORK_IN_PROGRESS: [true, false, false],
    COMPLETED: [true, true, false],
    CLOSED: [true, true, false],
    CANCELLED: [false, false, true], // no timestamps: dispatch unknown
  };
  for (const [status, [dispatched, completed, cancelled]] of Object.entries(expectations)) {
    const r = detectWorkOrderInventoryEffects(wo({ status }), NO_SYNC);
    assert.equal(
      itemFor(r, "DISPATCHED").classification === "SILENT_MISS",
      dispatched,
      `DISPATCHED @ ${status}`
    );
    assert.equal(
      itemFor(r, "COMPLETED").classification === "SILENT_MISS",
      completed,
      `COMPLETED @ ${status}`
    );
    assert.equal(
      itemFor(r, "CANCELLED").classification === "SILENT_MISS",
      cancelled,
      `CANCELLED @ ${status}`
    );
  }
});

// ---------------------------------------------------------------------------
// 5. Marker / sync-status edge cases
// ---------------------------------------------------------------------------

check("absent inventory_sync_status doc: SILENT_MISS + WO-level warning when expected", () => {
  const r = detectWorkOrderInventoryEffects(wo({ status: "DISPATCHED" }), NO_SYNC);
  assert.equal(itemFor(r, "DISPATCHED").classification, "SILENT_MISS");
  assert.ok(r.warnings.includes("SYNC_STATUS_ABSENT"));
});

check("absent sync doc with nothing expected: no SYNC_STATUS_ABSENT noise", () => {
  const r = detectWorkOrderInventoryEffects(wo({ status: "CREATED" }), NO_SYNC);
  assert.ok(!r.warnings.includes("SYNC_STATUS_ABSENT"));
});

check("partially populated sync status (one state processed, others untouched)", () => {
  const r = detectWorkOrderInventoryEffects(
    wo({ status: "COMPLETED", executionTimestamps: { dispatchedAt: TS, completedAt: TS } }),
    sync({ processedStates: { DISPATCHED: true } })
  );
  assert.equal(itemFor(r, "DISPATCHED").classification, "PROCESSED");
  assert.equal(itemFor(r, "COMPLETED").classification, "SILENT_MISS");
  assert.equal(itemFor(r, "CANCELLED").classification, "NOT_EXPECTED");
});

check("failure present but retryNeeded false: warned, classified by lifecycle", () => {
  const r = detectWorkOrderInventoryEffects(
    wo({ status: "DISPATCHED", executionTimestamps: { dispatchedAt: TS } }),
    sync({ failures: { DISPATCHED: { error: "x", at: TS, retryNeeded: false } } })
  );
  const item = itemFor(r, "DISPATCHED");
  assert.equal(item.classification, "SILENT_MISS");
  assert.ok(item.warnings.includes("FAILURE_WITHOUT_RETRY_FLAG"));
  assert.equal(item.operatorReviewRequired, true);
});

check("failure without retry flag and no lifecycle evidence: NOT_EXPECTED + warned", () => {
  const r = detectWorkOrderInventoryEffects(
    wo({ status: "CREATED" }),
    sync({ failures: { DISPATCHED: { error: "x", at: TS } } })
  );
  const item = itemFor(r, "DISPATCHED");
  assert.equal(item.classification, "NOT_EXPECTED");
  assert.ok(item.warnings.includes("FAILURE_WITHOUT_RETRY_FLAG"));
  assert.equal(item.operatorReviewRequired, true);
});

check("malformed processed marker (truthy but not true): not canonical, warned", () => {
  const r = detectWorkOrderInventoryEffects(
    wo({ status: "DISPATCHED", executionTimestamps: { dispatchedAt: TS } }),
    sync({ processedStates: { DISPATCHED: "yes" } })
  );
  const item = itemFor(r, "DISPATCHED");
  assert.equal(item.classification, "SILENT_MISS");
  assert.ok(item.warnings.includes("PROCESSED_MARKER_MALFORMED"));
});

check("malformed failure entry (non-object): warned, not treated as failure", () => {
  const r = detectWorkOrderInventoryEffects(
    wo({ status: "DISPATCHED", executionTimestamps: { dispatchedAt: TS } }),
    sync({ failures: { DISPATCHED: "broken" } })
  );
  const item = itemFor(r, "DISPATCHED");
  assert.equal(item.classification, "SILENT_MISS");
  assert.ok(item.warnings.includes("FAILURE_ENTRY_MALFORMED"));
});

check("unrecognized marker keys produce WO-level warnings", () => {
  const r = detectWorkOrderInventoryEffects(
    wo({ status: "DISPATCHED" }),
    sync({ processedStates: { ARRIVED: true, DISPATCHED: true }, failures: { WORK_IN_PROGRESS: { retryNeeded: true } } })
  );
  assert.ok(r.warnings.includes("UNRECOGNIZED_PROCESSED_STATE_KEY"));
  assert.ok(r.warnings.includes("UNRECOGNIZED_FAILURE_STATE_KEY"));
  assert.equal(itemFor(r, "DISPATCHED").classification, "PROCESSED");
});

check("finalize cross-checks on COMPLETED", () => {
  // processed but finalized missing
  let r = detectWorkOrderInventoryEffects(
    wo({ status: "COMPLETED", executionTimestamps: { completedAt: TS } }),
    sync({ processedStates: { COMPLETED: true } })
  );
  let item = itemFor(r, "COMPLETED");
  assert.equal(item.classification, "PROCESSED");
  assert.ok(item.warnings.includes("FINALIZED_FLAG_MISSING"));
  // finalized without processed marker
  r = detectWorkOrderInventoryEffects(
    wo({ status: "COMPLETED", executionTimestamps: { completedAt: TS } }),
    sync({ finalized: true })
  );
  item = itemFor(r, "COMPLETED");
  assert.equal(item.classification, "SILENT_MISS");
  assert.ok(item.warnings.includes("FINALIZED_WITHOUT_PROCESSED_MARKER"));
  // canonical happy pair: no warnings
  r = detectWorkOrderInventoryEffects(
    wo({ status: "COMPLETED", executionTimestamps: { completedAt: TS } }),
    sync({ processedStates: { COMPLETED: true }, finalized: true })
  );
  item = itemFor(r, "COMPLETED");
  assert.equal(item.classification, "PROCESSED");
  assert.deepEqual(item.warnings, []);
});

// ---------------------------------------------------------------------------
// 6. Snapshot edge cases (never change expectation -- trigger marks processed
//    even for empty snapshots)
// ---------------------------------------------------------------------------

check("no snapshot / empty snapshot: expectation unchanged, count surfaced", () => {
  for (const count of [null, 0, 3]) {
    const r = detectWorkOrderInventoryEffects(
      wo({ status: "DISPATCHED", inventorySnapshotItemCount: count }),
      NO_SYNC
    );
    const item = itemFor(r, "DISPATCHED");
    assert.equal(item.classification, "SILENT_MISS");
    assert.equal(item.evidence.inventorySnapshotItemCount, count);
  }
});

// ---------------------------------------------------------------------------
// 7. Legacy / malformed Work Order inputs
// ---------------------------------------------------------------------------

check("unknown status value: warned; timestamps still drive evidence; NOT_EXPECTED items flagged for review", () => {
  const r = detectWorkOrderInventoryEffects(
    wo({ status: "SOMETHING_ELSE", executionTimestamps: { dispatchedAt: TS } }),
    sync()
  );
  assert.ok(r.warnings.includes("UNKNOWN_STATUS_VALUE"));
  assert.equal(itemFor(r, "DISPATCHED").classification, "SILENT_MISS");
  const completed = itemFor(r, "COMPLETED");
  assert.equal(completed.classification, "NOT_EXPECTED");
  assert.equal(completed.operatorReviewRequired, true); // degraded status = review the "not expected"
});

check("status absent entirely (legacy): warned, timestamps-only derivation", () => {
  const r = detectWorkOrderInventoryEffects(
    { workOrderId: "WO-LEGACY", executionTimestamps: { acceptedAt: TS } },
    NO_SYNC
  );
  assert.ok(r.warnings.includes("STATUS_ABSENT"));
  const item = itemFor(r, "DISPATCHED");
  assert.equal(item.classification, "SILENT_MISS");
  assert.equal(item.reasonCode, "EXPECTED_BY_LATER_EVIDENCE_NO_MARKER");
});

check("missing timestamps map / null map tolerated", () => {
  for (const executionTimestamps of [undefined, null]) {
    const r = detectWorkOrderInventoryEffects(
      wo({ status: "DISPATCHED", executionTimestamps }),
      sync()
    );
    assert.equal(itemFor(r, "DISPATCHED").classification, "SILENT_MISS");
  }
});

check("non-status status types (number, object) treated as unknown, never throw", () => {
  for (const status of [42, {}, true]) {
    const r = detectWorkOrderInventoryEffects(wo({ status }), sync());
    assert.equal(r.valid, true);
    assert.ok(r.warnings.includes("UNKNOWN_STATUS_VALUE"));
  }
});

// ---------------------------------------------------------------------------
// 8. Input validation (typed errors, never thrown exceptions)
// ---------------------------------------------------------------------------

check("invalid workOrderId: typed validation error", () => {
  for (const bad of ["", undefined, null, 42]) {
    const r = detectWorkOrderInventoryEffects({ workOrderId: bad }, sync());
    assert.equal(r.valid, false);
    assert.equal(r.reasonCode, "INVALID_WORK_ORDER_ID");
  }
});

check("invalid input shapes: typed validation error", () => {
  assert.equal(detectWorkOrderInventoryEffects(null, sync()).valid, false);
  const r = detectWorkOrderInventoryEffects(wo(), { processedStates: {} }); // no boolean exists
  assert.equal(r.valid, false);
  assert.equal(r.reasonCode, "INVALID_INPUT_SHAPE");
  assert.equal(r.workOrderId, "WO-TEST-1");
});

// ---------------------------------------------------------------------------
// 9. Batch wrapper
// ---------------------------------------------------------------------------

check("batch: independent outcomes, order preserved, bad entries isolated", () => {
  const outcomes = detectBatchInventoryEffects([
    { workOrder: wo({ workOrderId: "WO-A", status: "DISPATCHED" }), syncStatus: sync({ processedStates: { DISPATCHED: true } }) },
    null,
    { workOrder: wo({ workOrderId: "WO-B", status: "CANCELLED" }), syncStatus: NO_SYNC },
  ]);
  assert.equal(outcomes.length, 3);
  assert.equal(outcomes[0].valid, true);
  assert.equal(outcomes[0].workOrderId, "WO-A");
  assert.equal(outcomes[1].valid, false);
  assert.equal(outcomes[2].valid, true);
  assert.equal(
    outcomes[2].items.find((i) => i.state === "CANCELLED").classification,
    "SILENT_MISS"
  );
});

// ---------------------------------------------------------------------------
// 10. Determinism + output shape
// ---------------------------------------------------------------------------

check("deterministic: identical inputs produce deeply equal outputs", () => {
  const input = () => [
    wo({ status: "CLOSED", executionTimestamps: { dispatchedAt: TS, completedAt: TS } }),
    sync({ processedStates: { DISPATCHED: true }, failures: { COMPLETED: { error: "x", at: TS, retryNeeded: true } } }),
  ];
  const a = detectWorkOrderInventoryEffects(...input());
  const b = detectWorkOrderInventoryEffects(...input());
  assert.deepEqual(a, b);
});

check("result always carries exactly one item per trigger state, in order", () => {
  const r = detectWorkOrderInventoryEffects(wo(), sync());
  assert.deepEqual(
    r.items.map((i) => i.state),
    ["DISPATCHED", "COMPLETED", "CANCELLED"]
  );
  for (const item of r.items) {
    assert.equal(item.workOrderId, "WO-TEST-1");
    assert.equal(item.effect, TRIGGER_EFFECT[item.state]);
    assert.equal(typeof item.retryCandidate, "boolean");
    assert.equal(typeof item.operatorReviewRequired, "boolean");
    assert.ok(Array.isArray(item.warnings));
  }
});

console.log(`\ninventoryEffectDetection: ${passed} passed, 0 failed`);
