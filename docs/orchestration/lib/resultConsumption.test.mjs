import { test } from "node:test";
import assert from "node:assert/strict";
import { createAgentResult, disposeResult, isAwaitingInterpretation } from "./agentResult.mjs";
import {
  partitionAwaiting, interpretationWorkItems, hasUnconsumedInterpretationWork,
  selectNextWorkIncludingResults,
} from "./resultConsumption.mjs";

const REG = { registeredWorkstreams: ["UX", "Product/Design"] };

const freshResult = (over = {}) => createAgentResult({
  resultId: "R-1", requestId: "REQ-1", routedBackTo: "UX", status: "COMPLETE", ...over,
});

test("a fresh COMPLETE result defaults to AWAITING_INTERPRETATION", () => {
  const r = freshResult();
  assert.equal(r.disposition, "AWAITING_INTERPRETATION");
  assert.equal(isAwaitingInterpretation(r), true);
});

test("historical result (no disposition field) is NOT awaiting — never resurrected", () => {
  const historical = { resultId: "OLD", requestId: "REQ-0", routedBackTo: "UX", status: "COMPLETE" };
  assert.equal(isAwaitingInterpretation(historical), false);
  assert.equal(hasUnconsumedInterpretationWork([historical], REG), false);
});

test("FAILED / contaminated / retracted results are not awaiting interpretation", () => {
  assert.equal(isAwaitingInterpretation(freshResult({ status: "FAILED" })), false);
  assert.equal(isAwaitingInterpretation(freshResult({ contaminated: true })), false);
  assert.equal(isAwaitingInterpretation(freshResult({ retracted: true })), false);
});

test("a valid unconsumed result routed to a registered workstream PREVENTS a false terminal checkpoint", () => {
  // Backlog is fully drained — the exact condition that produced the observed defect.
  const drained = [];
  const results = [freshResult()];
  // Without the correction the selector sees an empty backlog and returns ROADMAP_COMPLETE.
  const decision = selectNextWorkIncludingResults(drained, results, REG);
  assert.equal(decision.decision, "RUN");
  assert.equal(decision.item.id, "interpret:R-1");
  assert.equal(decision.item.workstream, "UX");
});

test("disposing of the result (CONSUMED) clears the actionable state — honest checkpoint returns", () => {
  const consumed = disposeResult(freshResult(), "CONSUMED");
  assert.equal(isAwaitingInterpretation(consumed), false);
  // Nothing awaiting and a genuine gate present -> honest CHECKPOINT, not RUN.
  const gated = [{ id: "g1", state: "OWNER_DECISION" }];
  const decision = selectNextWorkIncludingResults(gated, [consumed], REG);
  assert.equal(decision.decision, "CHECKPOINT");
});

test("with nothing awaiting and an empty backlog, ROADMAP_COMPLETE is still reachable (DRAINED is legitimate)", () => {
  const decision = selectNextWorkIncludingResults([], [disposeResult(freshResult(), "REJECTED")], REG);
  assert.equal(decision.decision, "ROADMAP_COMPLETE");
});

test("a result routed to an UNregistered workstream is surfaced as unroutable, not silently dropped", () => {
  const r = freshResult({ routedBackTo: "Finance" }); // not in REG
  const { awaiting, unroutable } = partitionAwaiting([r], REG);
  assert.equal(awaiting.length, 0);
  assert.equal(unroutable.length, 1);
  assert.equal(unroutable[0].resultId, "R-1");
  // and it does not fabricate a work item
  assert.equal(interpretationWorkItems([r], REG).length, 0);
});

test("in-flight backlog work still takes precedence over new interpretation work", () => {
  const running = [{ id: "w-running", state: "RUNNING" }];
  const decision = selectNextWorkIncludingResults(running, [freshResult()], REG);
  assert.equal(decision.decision, "RUN");
  assert.equal(decision.item.id, "w-running"); // RUNNING (rank 0) beats READY interpret item
});

test("disposeResult rejects an unknown disposition", () => {
  assert.throws(() => disposeResult(freshResult(), "MADE_UP"), /unknown disposition/);
});
