// Cycle Count -- pure outcome/error wording. Run: node --test test/cycleCountActionResult.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { mapCycleCountActionError, isRetryableCycleCountError, describeCycleCountOutcome, CYCLE_COUNT_REFUSAL_CODES } from "../src/domain/cycleCountActionResult.js";

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

// U3 (ISO inventory): EVERY governed refusal the server's cycle count commands send has its own words here -- a code the screen does not word falls back to
// a generic sentence (COUNT_STALE was shown as "not currently permitted"). This pins the screen against the server's own code list.
test("every governed refusal code the server sends is worded; COUNT_STALE says what happened and what to do", () => {
  const src = ["../../functions/src/eosOps/cycleCountOperations.ts", "../../functions/src/eosOps/cycleCountRepository.ts"]
    .map((p) => readFileSync(new URL(p, import.meta.url), "utf8")).join("\n");
  const sent = new Set([...src.matchAll(/(?:refuse|CycleCountRepositoryError)\(\s*"([A-Z][A-Z_]+)"/g)].map((m) => m[1]));
  assert.ok(sent.has("COUNT_STALE") && sent.has("COMPANY_AUTHORITY_REQUIRED") && sent.size >= 15, [...sent].join());
  const unworded = [...sent].filter((c) => !CYCLE_COUNT_REFUSAL_CODES.includes(c));
  assert.deepEqual(unworded, [], "a server refusal with no wording of its own");
  const stale = mapCycleCountActionError(err("failed-precondition", "COUNT_STALE"));
  assert.match(stale, /Stock moved at this location after the count opened/);
  assert.match(stale, /Cancel this line and count it again/);
  assert.doesNotMatch(stale, /not currently permitted/);
});
