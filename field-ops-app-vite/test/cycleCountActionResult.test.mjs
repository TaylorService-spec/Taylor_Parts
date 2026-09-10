// Cycle Count -- pure outcome/error wording. Run: node --test test/cycleCountActionResult.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { mapCycleCountActionError, isRetryableCycleCountError, describeCycleCountOutcome } from "../src/domain/cycleCountActionResult.js";

const err = (code, detail) => ({ code: `functions/${code}`, ...(detail ? { details: { code: detail } } : {}) });

test("the server's domain code decides the words, before the HTTP code", () => {
  assert.match(mapCycleCountActionError(err("permission-denied", "SEPARATION_OF_DUTIES")), /cannot approve or reject its own material variance/);
  assert.match(mapCycleCountActionError(err("permission-denied", "PERMISSION_DENIED")), /not authorized/);
  assert.match(mapCycleCountActionError(err("failed-precondition", "LOCATION_INVALID")), /bin conversion/);
  assert.match(mapCycleCountActionError(err("failed-precondition", "SHEET_STATUS_INVALID")), /no longer allows/);
  assert.match(mapCycleCountActionError(err("failed-precondition", "REASON_REQUIRED")), /reason is required/);
});

test("without a domain code the HTTP code is used; an unknown one is honest", () => {
  assert.match(mapCycleCountActionError(err("unavailable")), /safe to try again/);
  assert.match(mapCycleCountActionError({ code: "weird" }), /could not be completed/);
});

test("only technical failures are retryable", () => {
  assert.equal(isRetryableCycleCountError(err("unavailable")), true);
  assert.equal(isRetryableCycleCountError(err("deadline-exceeded")), true);
  assert.equal(isRetryableCycleCountError(err("internal", "CYCLE_COUNT_INTEGRITY")), true);
  assert.equal(isRetryableCycleCountError(err("failed-precondition", "STATUS_INVALID")), false);
  assert.equal(isRetryableCycleCountError(err("permission-denied", "SEPARATION_OF_DUTIES")), false);
  assert.equal(isRetryableCycleCountError(err("already-exists", "IDEMPOTENCY_CONFLICT")), false);
});

test("outcome wording distinguishes a replay from a change", () => {
  assert.equal(describeCycleCountOutcome("submit", "applied"), "Count recorded.");
  assert.equal(describeCycleCountOutcome("reconcile", "replayed", "REJECT"), "Already rejected (no change made).");
  assert.equal(describeCycleCountOutcome("reconcile", "applied", "APPROVE"), "Count approved.");
});
