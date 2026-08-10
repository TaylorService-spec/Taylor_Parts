import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveWakeStatus, projectWakeBoard, isAuthorized, isTriggered, WAKE_STATES, WAKE_STATUS } from "./wakeState.mjs";

test("READY (not yet authorized) is NOT authorized work — READY is never authorization", () => {
  assert.equal(isAuthorized({ wakeState: "READY" }), false);
  assert.equal(deriveWakeStatus({ wakeState: "READY" }), "NO_AUTHORIZED_WORK");
});

test("THE DISTINCTION: authorized+routed but not triggered → WAITING_FOR_TRIGGER (not 'no work')", () => {
  assert.equal(deriveWakeStatus({ wakeState: "AUTHORIZED", triggerMechanism: "NO_WAKE_MECHANISM" }), "WAITING_FOR_TRIGGER");
  assert.equal(deriveWakeStatus({ wakeState: "ROUTED", triggerMechanism: "NO_WAKE_MECHANISM" }), "WAITING_FOR_TRIGGER");
  assert.equal(isAuthorized({ wakeState: "AUTHORIZED" }), true);
});

test("trigger stages and failure surface distinctly", () => {
  assert.equal(deriveWakeStatus({ wakeState: "TRIGGERED", triggerMechanism: "AUTOMATIC_TRIGGER" }), "TRIGGERED_PENDING");
  assert.equal(isTriggered({ wakeState: "TRIGGERED" }), true);
  assert.equal(deriveWakeStatus({ wakeState: "ACTIVE" }), "IN_FLIGHT");
  assert.equal(deriveWakeStatus({ wakeState: "COMPLETED" }), "AWAITING_CONSUMPTION");
  assert.equal(deriveWakeStatus({ wakeState: "TRIGGERED", triggerMechanism: "FAILED" }), "TRIGGER_FAILED");
});

test("projectWakeBoard surfaces the authorized-but-waiting flag and counts", () => {
  const board = projectWakeBoard([
    { workId: "a", wakeState: "AUTHORIZED", triggerMechanism: "NO_WAKE_MECHANISM" },
    { workId: "b", wakeState: "ACTIVE", triggerMechanism: "AUTOMATIC_TRIGGER" },
    { workId: "c", wakeState: "READY" },
  ]);
  assert.equal(board.authorizedButWaitingForTrigger, true);
  assert.equal(board.byStatus.WAITING_FOR_TRIGGER, 1);
  assert.equal(board.byStatus.IN_FLIGHT, 1);
  assert.equal(board.byStatus.NO_AUTHORIZED_WORK, 1);
  assert.equal(board.byWakeState.AUTHORIZED, 1);
  assert.equal(board.byTrigger.NO_WAKE_MECHANISM, 1);
  assert.match(board.note, /WAITING_FOR_TRIGGER/);
});

test("no authorized items → no waiting flag (honest: authorized-waiting ≠ drained)", () => {
  const board = projectWakeBoard([{ workId: "x", wakeState: "READY" }]);
  assert.equal(board.authorizedButWaitingForTrigger, false);
  assert.equal(board.note, null);
  assert.ok(WAKE_STATES.includes("CONSUMED") && WAKE_STATUS.includes("WAITING_FOR_TRIGGER"));
});
