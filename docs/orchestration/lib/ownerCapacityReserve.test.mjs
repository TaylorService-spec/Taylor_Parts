import test from "node:test";
import assert from "node:assert/strict";
import {
  assessOwnerCapacity, capacityAction, ownerReserveStopReason, CAPACITY_STATE, OWNER_RESERVE,
} from "./ownerCapacityReserve.mjs";
import { hardStopReason } from "./autonomyPolicy.mjs";

test("plenty of capacity is OK", () => {
  const a = assessOwnerCapacity({ weeklyUsedFraction: 0.2, sessionUsedFraction: 0.1 });
  assert.equal(a.state, CAPACITY_STATE.OK);
  assert.equal(a.mayConsume, true);
});

test("DEFECT GUARD: EOS stops at 75% so the Owner keeps 25%", () => {
  const a = assessOwnerCapacity({ weeklyUsedFraction: 0.75 });
  assert.equal(a.state, CAPACITY_STATE.REACHED);
  assert.equal(a.mayConsume, false);
  assert.match(a.reason, /holding 25%/);
});

test("the WORSE of the two windows governs — §4.1 preserves 25% of each", () => {
  // Weekly is fine, session is exhausted. The session must win.
  const a = assessOwnerCapacity({ weeklyUsedFraction: 0.10, sessionUsedFraction: 0.90 });
  assert.equal(a.state, CAPACITY_STATE.REACHED);
  assert.equal(a.governingWindow, "session");
});

test("approaching the reserve winds down rather than stopping abruptly", () => {
  const a = assessOwnerCapacity({ weeklyUsedFraction: 0.62 }); // 0.75 * 0.8 = 0.60
  assert.equal(a.state, CAPACITY_STATE.APPROACHING);
  assert.equal(capacityAction(a).action, "WIND_DOWN");
  assert.match(capacityAction(a).guidance, /do not start a new child/);
});

test("DEFECT GUARD: reaching the reserve SUSPENDS — it is not a failure", () => {
  // §4.1 is explicit that capacity exhaustion is recoverable, not terminal.
  const act = capacityAction(assessOwnerCapacity({ weeklyUsedFraction: 0.8 }));
  assert.equal(act.action, "SUSPEND");
  assert.equal(act.terminal, false);
  assert.deepEqual(act.steps, [
    "CHECKPOINT", "PERSIST_COMPLETED", "PERSIST_REMAINING", "SUSPEND", "RESUME_WHEN_CAPACITY_RETURNS",
  ]);
});

test("unobservable capacity is surfaced, never silently treated as healthy", () => {
  const a = assessOwnerCapacity({});
  assert.equal(a.state, CAPACITY_STATE.UNOBSERVABLE);
  assert.equal(a.conservative, true);
  assert.match(a.reason, /never silently treated as healthy/);
  assert.equal(capacityAction(a).action, "CONTINUE_CONSERVATIVE");
});

test("unobservable does not hard-stop — EOS must still run where usage is not exposed", () => {
  // The opposite failure: a runtime that never exposes usage would otherwise disable EOS entirely.
  assert.equal(assessOwnerCapacity({}).mayConsume, true);
});

test("a single observable window is enough to judge", () => {
  assert.equal(assessOwnerCapacity({ sessionUsedFraction: 0.9 }).state, CAPACITY_STATE.REACHED);
  assert.equal(assessOwnerCapacity({ weeklyUsedFraction: 0.1 }).state, CAPACITY_STATE.OK);
});

test("garbage values are ignored rather than trusted", () => {
  for (const bad of [NaN, -1, "0.5", null, undefined, Infinity]) {
    const a = assessOwnerCapacity({ weeklyUsedFraction: bad });
    assert.equal(a.state, CAPACITY_STATE.UNOBSERVABLE, `expected unobservable for ${String(bad)}`);
  }
});

test("headroom reports what is actually left to spend", () => {
  const a = assessOwnerCapacity({ weeklyUsedFraction: 0.5 });
  assert.ok(Math.abs(a.headroom - 0.25) < 1e-9, "0.75 spendable minus 0.5 used");
});

test("the stop reason only fires when the reserve is actually reached", () => {
  assert.equal(ownerReserveStopReason(assessOwnerCapacity({ weeklyUsedFraction: 0.9 })), "OWNER_RESERVE_REACHED");
  assert.equal(ownerReserveStopReason(assessOwnerCapacity({ weeklyUsedFraction: 0.1 })), null);
  assert.equal(ownerReserveStopReason(assessOwnerCapacity({})), null);
});

test("the reserve fraction is 25% as ratified", () => {
  assert.equal(OWNER_RESERVE.reserveFraction, 0.25);
});

test("never throws on malformed input", () => {
  assert.doesNotThrow(() => assessOwnerCapacity());
  assert.doesNotThrow(() => capacityAction());
  assert.doesNotThrow(() => capacityAction(null));
  assert.doesNotThrow(() => ownerReserveStopReason(null));
});

// --- integration: the reserve and stagnation must actually gate hardStopReason ---

test("INTEGRATION: hardStopReason returns OWNER_RESERVE_REACHED at the floor", () => {
  const r = hardStopReason({ ownerCapacity: { weeklyUsedFraction: 0.8 } });
  assert.equal(r, "OWNER_RESERVE_REACHED");
});

test("INTEGRATION: healthy capacity does not stop the run", () => {
  assert.equal(hardStopReason({ ownerCapacity: { weeklyUsedFraction: 0.2 } }), null);
});

test("INTEGRATION: hardStopReason detects stagnation", () => {
  const T = 1_700_000_000_000;
  const at = (m) => T + m * 60_000;
  const r = hardStopReason({
    progressWindow: {
      now: at(30),
      events: [
        { kind: "SEARCH", at: at(0), fingerprint: "a" },
        { kind: "FILE_REREAD", at: at(5), fingerprint: "b" },
        { kind: "LOG_POLL", at: at(10), fingerprint: "c" },
        { kind: "SEARCH", at: at(20), fingerprint: "d" },
        { kind: "CONCLUSION_RESTATED", at: at(28), fingerprint: "e" },
      ],
      repoStateHash: "same",
      lastRepoStateHash: "same",
    },
  });
  assert.equal(r, "STAGNATION_DETECTED");
});

test("INTEGRATION: a productive window does not stop the run", () => {
  const T = 1_700_000_000_000;
  const at = (m) => T + m * 60_000;
  const r = hardStopReason({
    progressWindow: {
      now: at(6),
      events: [
        { kind: "SEARCH", at: at(0), fingerprint: "a" },
        { kind: "CODE_CHANGED", at: at(1) },
        { kind: "COMMIT_CREATED", at: at(2) },
        { kind: "PR_CREATED", at: at(3) },
        { kind: "CHILD_COMPLETED", at: at(4) },
      ],
    },
  });
  assert.equal(r, null);
});

test("INTEGRATION: omitting the new context preserves original behaviour", () => {
  assert.equal(hardStopReason({}), null);
  assert.equal(hardStopReason({ protectedBoundaryReached: true }), "PROTECTED_ACTION");
  assert.equal(hardStopReason({ minutesElapsed: 95 }), "WORK_WINDOW_ELAPSED");
});
