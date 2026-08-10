import { test } from "node:test";
import assert from "node:assert/strict";
import { classifySignal, projectSignalBoard, requiresOwnerAuthorization, SIGNAL_SOURCES, DISCOVERY_BOUNDARIES } from "./signalSupervisor.mjs";

test("duplicate signal → IGNORE, no AI call", () => {
  const c = classifySignal({ source: "GITHUB_EVENT", key: "pr-900", needsReview: true }, { seenKeys: new Set(["pr-900"]) });
  assert.equal(c.classification, "IGNORE");
  assert.equal(c.aiNeeded, false);
});

test("already-resolved / unchanged state → IGNORE, no AI", () => {
  assert.equal(classifySignal({ source: "CONTROL_PLANE_EVENT", resolved: true }).classification, "IGNORE");
  const unchanged = classifySignal({ source: "CONTROL_PLANE_EVENT", stateHash: "h", priorStateHash: "h", needsReview: true });
  assert.equal(unchanged.classification, "IGNORE");
  assert.equal(unchanged.aiNeeded, false);
});

test("known-expected activity → RECORD, no AI", () => {
  const c = classifySignal({ source: "GITHUB_EVENT", expected: true, needsReview: true });
  assert.equal(c.classification, "RECORD");
  assert.equal(c.aiNeeded, false);
});

test("mechanical/validation-only → QUEUE (deterministic), no AI", () => {
  const c = classifySignal({ source: "CONTROL_PLANE_EVENT", mechanicalOnly: true });
  assert.equal(c.classification, "QUEUE");
  assert.equal(c.aiNeeded, false);
});

test("genuine reasoning need → REVIEW_REQUIRED, aiNeeded true, carries review-class hint", () => {
  const c = classifySignal({ source: "GITHUB_EVENT", key: "pr-901", needsReview: true, reviewClassHint: "INDEPENDENT_AI" });
  assert.equal(c.classification, "REVIEW_REQUIRED");
  assert.equal(c.aiNeeded, true);
  assert.equal(c.reviewClassHint, "INDEPENDENT_AI");
});

test("owner-attention → never routed around the Owner; no AI", () => {
  const c = classifySignal({ source: "CONTROL_PLANE_EVENT", ownerAttention: true });
  assert.equal(c.classification, "OWNER_ATTENTION");
  assert.equal(c.aiNeeded, false);
});

test("social/business signal → classified + recorded, NO unauthorized outreach", () => {
  for (const source of ["SOCIAL_SIGNAL", "BUSINESS_SIGNAL"]) {
    const c = classifySignal({ source, needsReview: true }); // even if it claims needsReview, discovery is recorded only
    assert.equal(c.classification, "RECORD");
    assert.equal(c.aiNeeded, false);
    assert.ok(c.discoveryBoundary);
  }
  // the boundary is explicit and enforced by a helper
  assert.equal(requiresOwnerAuthorization("CONTACT"), true);
  assert.equal(requiresOwnerAuthorization("SPEND"), true);
  assert.equal(requiresOwnerAuthorization("RECORD"), false);
  assert.match(DISCOVERY_BOUNDARIES["signal discovery"], /permission to contact/);
});

test("urgent → surfaced immediately; latency defaults to IMMEDIATE", () => {
  const c = classifySignal({ source: "OPERATIONAL_SIGNAL", urgent: true });
  assert.equal(c.classification, "URGENT");
  assert.equal(c.latencyExpectation, "IMMEDIATE");
});

test("default latency by source; explicit expectation honored", () => {
  assert.equal(classifySignal({ source: "TIMER" }).latencyExpectation, "HOURLY");
  assert.equal(classifySignal({ source: "GITHUB_EVENT" }).latencyExpectation, "MINUTES");
  assert.equal(classifySignal({ source: "GITHUB_EVENT", latencyExpectation: "DAILY" }).latencyExpectation, "DAILY");
});

test("projectSignalBoard: separates AI-needed from token-free", () => {
  const board = projectSignalBoard([
    classifySignal({ source: "GITHUB_EVENT", key: "a", needsReview: true }),
    classifySignal({ source: "GITHUB_EVENT", resolved: true }),
    classifySignal({ source: "CONTROL_PLANE_EVENT", mechanicalOnly: true }),
  ]);
  assert.equal(board.total, 3);
  assert.equal(board.aiNeeded, 1);
  assert.equal(board.tokenFree, 2);
  assert.ok(SIGNAL_SOURCES.includes("OPERATIONAL_SIGNAL"));
});
