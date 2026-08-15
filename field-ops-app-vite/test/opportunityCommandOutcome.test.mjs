import test from "node:test";
import assert from "node:assert/strict";
import {
  outcomeFromErrorCode,
  outcomeFromCreateResult,
  outcomeFromTransitionResult,
} from "../src/domain/opportunityCommandOutcome.js";

test("outcomeFromErrorCode: known codes map to a safe, human, denied/invalid/error kind", () => {
  assert.equal(outcomeFromErrorCode("permission-denied").kind, "denied");
  assert.equal(outcomeFromErrorCode("unauthenticated").kind, "denied");
  assert.equal(outcomeFromErrorCode("invalid-argument").kind, "invalid");
  assert.equal(outcomeFromErrorCode("not-found").kind, "notFound");
  assert.equal(outcomeFromErrorCode("failed-precondition").kind, "invalid");
  assert.equal(outcomeFromErrorCode("internal").kind, "error");
});

test("outcomeFromErrorCode: an unknown/absent code falls back to a safe generic error, never a raw code", () => {
  const o = outcomeFromErrorCode("something-weird");
  assert.equal(o.kind, "error");
  assert.doesNotMatch(o.message, /something-weird/);
});

test("outcomeFromCreateResult: an applied create reports 'applied' with the new opportunityId", () => {
  const o = outcomeFromCreateResult({ success: true, replayed: false, opportunityId: "OPP-1", stage: "IDENTIFIED" });
  assert.equal(o.kind, "applied");
  assert.equal(o.opportunityId, "OPP-1");
  assert.equal(o.stage, "IDENTIFIED");
});

test("outcomeFromCreateResult: a replayed retry reports 'replayed', never a fabricated second success", () => {
  const o = outcomeFromCreateResult({ success: true, replayed: true, opportunityId: "OPP-1", stage: "IDENTIFIED" });
  assert.equal(o.kind, "replayed");
  assert.equal(o.message, "Already recorded (no change).");
});

test("outcomeFromCreateResult: a malformed result is honestly an error, never invented as success", () => {
  assert.equal(outcomeFromCreateResult(null).kind, "error");
  assert.equal(outcomeFromCreateResult({}).kind, "error");
});

test("outcomeFromTransitionResult: an applied transition reports the new stage/outcome", () => {
  const o = outcomeFromTransitionResult({ success: true, replayed: false, opportunityId: "OPP-1", stage: "QUALIFYING", outcome: null });
  assert.equal(o.kind, "applied");
  assert.equal(o.stage, "QUALIFYING");
  assert.equal(o.outcome, null);
});

test("outcomeFromTransitionResult: a replayed retry reports 'replayed' with the CURRENT (not re-derived) state", () => {
  const o = outcomeFromTransitionResult({ success: true, replayed: true, opportunityId: "OPP-1", stage: "DECISION", outcome: "WON" });
  assert.equal(o.kind, "replayed");
  assert.equal(o.outcome, "WON");
});

test("outcomeFromTransitionResult: a malformed result is honestly an error", () => {
  assert.equal(outcomeFromTransitionResult(undefined).kind, "error");
});
