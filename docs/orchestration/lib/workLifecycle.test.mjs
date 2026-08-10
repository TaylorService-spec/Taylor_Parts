import { test } from "node:test";
import assert from "node:assert/strict";
import {
  routeWork, validateWorkAssignment, recordTrigger, advanceWork, recordActivity,
  computeEscalation, withEscalation, summarizeAssignment,
  isAcknowledged, isActive, WORK_LIFECYCLE,
} from "./workLifecycle.mjs";

const routed = (over = {}) => routeWork({ workId: "W-1", responsibleParty: "UX", resultDestination: "Design", assignedAt: 1000, ...over });

test("ROUTE writes ASSIGNED only — it proves nothing about pickup", () => {
  const w = routed();
  assert.equal(w.lifecycle, "ASSIGNED");
  assert.equal(w.acknowledgedAt, null);
  assert.equal(w.triggerOutcome, "NOT_ATTEMPTED");
  assert.equal(isAcknowledged(w), false);
  assert.deepEqual(validateWorkAssignment(w), []);
});

test("TRIGGER never advances the lifecycle — a wake attempt is not an acknowledgement", () => {
  const woken = recordTrigger(routed(), "WOKEN", 1100);
  assert.equal(woken.lifecycle, "ASSIGNED");     // still ASSIGNED — worker hasn't confirmed
  assert.equal(isAcknowledged(woken), false);
  // The honest FUTURE_SEAM: a standing worker that can't be externally woken.
  const seam = recordTrigger(routed(), "NO_WAKE_MECHANISM", 1100);
  assert.equal(seam.triggerOutcome, "NO_WAKE_MECHANISM");
  assert.equal(seam.lifecycle, "ASSIGNED");
});

test("only the worker advances ASSIGNED→ACKNOWLEDGED→ACTIVE→COMPLETED→CONSUMED, one hop, stamped from evidence", () => {
  let w = routed();
  w = advanceWork(w, "ACKNOWLEDGED", 2000); assert.equal(w.acknowledgedAt, 2000);
  w = advanceWork(w, "ACTIVE", 3000);       assert.equal(w.startedAt, 3000); assert.equal(w.lastActivityAt, 3000);
  w = advanceWork(w, "COMPLETED", 4000);    assert.equal(w.completedAt, 4000);
  w = advanceWork(w, "CONSUMED", 5000);     assert.equal(w.consumedAt, 5000);
  assert.equal(w.lifecycle, "CONSUMED");
  // no skipping
  assert.throws(() => advanceWork(routed(), "ACTIVE", 1), /illegal/);       // ASSIGNED can't jump to ACTIVE
  assert.throws(() => advanceWork(routed(), "COMPLETED", 1), /illegal/);
});

test("timestamps are never fabricated — an unknown transition time stays null", () => {
  const w = advanceWork(routed(), "ACKNOWLEDGED"); // no atMs supplied
  assert.equal(w.lifecycle, "ACKNOWLEDGED");
  assert.equal(w.acknowledgedAt, null);
});

test("WAITING_FOR_PICKUP comes from an EXPLICIT expectation, never elapsed time alone", () => {
  // No expectation set -> never escalates, however old.
  assert.equal(computeEscalation(routed(), 9_999_999), "NONE");
  // With an explicit expectedAckBy, an un-acknowledged assignment past it is WAITING_FOR_PICKUP.
  const w = routed({ expectedAckBy: 2000 });
  assert.equal(computeEscalation(w, 1999), "NONE");
  assert.equal(computeEscalation(w, 2001), "WAITING_FOR_PICKUP");
  // Acknowledged before the deadline -> no pickup escalation.
  assert.equal(computeEscalation(advanceWork(w, "ACKNOWLEDGED", 1500), 9999), "NONE");
});

test("POSSIBLY_STALLED requires ACTIVE + explicit stallAfter + stale activity (not a failure verdict)", () => {
  let w = routed({ stallAfter: 500 });
  w = advanceWork(advanceWork(w, "ACKNOWLEDGED", 2000), "ACTIVE", 3000); // lastActivityAt=3000
  assert.equal(computeEscalation(w, 3400), "NONE");        // within stall window
  assert.equal(computeEscalation(w, 3600), "POSSIBLY_STALLED");
  // a heartbeat resets the clock
  assert.equal(computeEscalation(recordActivity(w, 3600), 3900), "NONE");
});

test("summarizeAssignment reports the most recent DURABLE timestamp for the Who's-Doing-What view", () => {
  const s = summarizeAssignment(withEscalation(advanceWork(routed({ expectedAckBy: 500 }), "ACKNOWLEDGED", 2000), 3000));
  assert.equal(s.responsibleParty, "UX");
  assert.equal(s.resultDestination, "Design");
  assert.equal(s.lifecycle, "ACKNOWLEDGED");
  assert.equal(s.lastDurableAt, 2000);
});

test("the lifecycle is worker-agnostic (Claude/ChatGPT/Design/UX/Codex/human)", () => {
  for (const party of ["Claude", "ChatGPT", "Design", "UX", "Codex", "Human:operator"]) {
    assert.deepEqual(validateWorkAssignment(routed({ responsibleParty: party })), []);
  }
  assert.deepEqual([...WORK_LIFECYCLE], ["ASSIGNED", "ACKNOWLEDGED", "ACTIVE", "COMPLETED", "CONSUMED"]);
});
