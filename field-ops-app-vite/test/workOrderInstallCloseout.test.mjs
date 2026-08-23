// Finishing an installation job: the ordering, the middle state, and the offline seam.
//
// Two trusted calls that cannot share a transaction. Everything here is about the consequences of
// that: which order they run in, what the technician is told when only the first one worked, and what
// a device is allowed to claim before it has spoken to the server at all.
import test from "node:test";
import assert from "node:assert/strict";
import {
  CLOSEOUT_STATE, SYNC_OUTCOME, CLOSEOUT_FAILURE, COMPLETION_PENDING_MESSAGE, SYNC_PLAN,
  deriveCloseoutIntentId, interpretInstallStep, deriveCompletionStep, deriveCloseoutState,
  deriveResumePlan, captureOfflineIntent, describePendingIntent, interpretSync,
} from "../src/domain/workOrderInstallCloseout.js";

const installed = (over = {}) => ({
  outcome: { outcome: "installed", equipmentId: "eq_1", completionRequired: true, workOrderStatus: "WORK_IN_PROGRESS", ...over },
});
const refused = (details) => ({ error: { code: "failed-precondition", details, message: "raw" } });

// ── INTENT IDENTITY ───────────────────────────────────────────────────────────────────────────

test("the same intent yields the same key -- a retry replays", () => {
  assert.equal(deriveCloseoutIntentId("wo1", "sa1", "tok"), deriveCloseoutIntentId("wo1", "sa1", "tok"));
});

test("a DIFFERENT machine yields a different key", () => {
  // If the key ignored the asset, correcting a mis-scan and resubmitting would REPLAY the first
  // request and hand back the Equipment for the wrong machine, reported as success.
  const a = deriveCloseoutIntentId("wo1", "sa1", "tok");
  assert.notEqual(deriveCloseoutIntentId("wo1", "sa2", "tok"), a);
  assert.notEqual(deriveCloseoutIntentId("wo2", "sa1", "tok"), a);
});

test("the key contains only characters the command accepts", () => {
  assert.match(deriveCloseoutIntentId("wo:1/x", "sa 1", "tok:2"), /^[A-Za-z0-9_-]+$/);
});

test("an incomplete intent mints no key -- including offline", () => {
  assert.equal(deriveCloseoutIntentId(null, "sa", "t"), null);
  assert.equal(deriveCloseoutIntentId("wo", null, "t"), null);
  assert.equal(deriveCloseoutIntentId("wo", "sa", null), null);
});

// ── READING THE INSTALL STEP ─────────────────────────────────────────────────────────────────

test("installed and replayed are both success", () => {
  assert.equal(interpretInstallStep(installed()).ok, true);
  assert.equal(interpretInstallStep(installed({ outcome: "replayed" })).ok, true);
});

test("ALREADY INSTALLED FOR THIS JOB IS SUCCESS, not a failure", () => {
  // The machine is at the customer. Reporting it as an error would leave a technician retrying an
  // installation that already happened.
  const step = interpretInstallStep(installed({ outcome: "already_installed_for_this_work_order" }));
  assert.equal(step.ok, true);
  assert.equal(step.alreadyInstalled, true);
  assert.equal(step.equipmentId, "eq_1");
});

test("each refusal carries its own message, not a raw backend string", () => {
  for (const code of Object.values(CLOSEOUT_FAILURE)) {
    const step = interpretInstallStep(refused(code));
    assert.equal(step.ok, false);
    assert.equal(step.code, code);
    assert.notEqual(step.message, "raw", `${code} fell through to the raw message`);
    assert.ok(step.message.length > 10);
  }
});

// ── THE ORDER ─────────────────────────────────────────────────────────────────────────────────

test("COMPLETION IS NEVER ATTEMPTED WHEN THE INSTALL FAILED", () => {
  // The whole consistency model. A completed job whose installation failed is impossible because
  // this returns false.
  assert.equal(deriveCompletionStep(interpretInstallStep(refused(CLOSEOUT_FAILURE.ASSET_NOT_INSTALLABLE))).complete, false);
  assert.equal(deriveCompletionStep(null).complete, false);
});

test("completion is skipped when the server says the job is already complete", () => {
  // transitionWorkOrder is deliberately not idempotent, so completing a completed job fails for a
  // reason that is not a problem. Better never to ask.
  const step = interpretInstallStep(installed({ outcome: "already_installed_for_this_work_order", completionRequired: false }));
  assert.equal(deriveCompletionStep(step).complete, false);
});

test("completion runs after a successful install", () => {
  assert.equal(deriveCompletionStep(interpretInstallStep(installed())).complete, true);
});

// ── THE MIDDLE STATE ──────────────────────────────────────────────────────────────────────────

test("install ok + completion failed is INSTALLED_COMPLETION_PENDING, and the install is retained", () => {
  // The state that actually happens, named rather than reported as a generic failure -- a technician
  // told only "failed" will install again.
  const s = deriveCloseoutState({
    installStep: interpretInstallStep(installed()),
    completionAttempted: true, completionError: new Error("network"),
  });
  assert.equal(s.state, CLOSEOUT_STATE.INSTALLED_COMPLETION_PENDING);
  assert.equal(s.message, COMPLETION_PENDING_MESSAGE);
  assert.equal(s.equipmentId, "eq_1");
  assert.equal(s.installRetained, true, "the machine is at the customer; the record must not be undone");
});

test("both steps succeeding is DONE", () => {
  const s = deriveCloseoutState({
    installStep: interpretInstallStep(installed()), completionAttempted: true, completionError: null,
  });
  assert.equal(s.state, CLOSEOUT_STATE.DONE);
});

test("a failed install is FAILED and names no equipment", () => {
  const s = deriveCloseoutState({
    installStep: interpretInstallStep(refused(CLOSEOUT_FAILURE.ASSET_INSTALLED_ELSEWHERE)),
    completionAttempted: false, completionError: null,
  });
  assert.equal(s.state, CLOSEOUT_STATE.FAILED);
  assert.equal(s.equipmentId, null);
  assert.equal(s.code, CLOSEOUT_FAILURE.ASSET_INSTALLED_ELSEWHERE);
});

test("RESUMING OFFERS COMPLETION ONLY -- never a second installation", () => {
  const s = deriveCloseoutState({
    installStep: interpretInstallStep(installed()), completionAttempted: true, completionError: new Error("x"),
  });
  const plan = deriveResumePlan(s);
  assert.equal(plan.resumable, true);
  assert.equal(plan.action, "COMPLETE_ONLY");
  assert.match(plan.label, /Complete/i);
  assert.doesNotMatch(plan.label, /install/i, "the resume action must not invite a second install");
  assert.match(plan.note, /already recorded/i);
});

test("nothing else is resumable", () => {
  for (const s of [{ state: CLOSEOUT_STATE.DONE }, { state: CLOSEOUT_STATE.FAILED }, { state: CLOSEOUT_STATE.IDLE }, null]) {
    assert.equal(deriveResumePlan(s).resumable, false);
  }
});

// ── THE OFFLINE SEAM ──────────────────────────────────────────────────────────────────────────

test("an offline intent captures everything needed and claims NOTHING", () => {
  const intent = captureOfflineIntent({
    workOrderId: "wo1", serialNo: "SN-1", notes: "levelled", attemptToken: "tok", capturedAtLocal: 1234,
  });
  assert.equal(intent.state, CLOSEOUT_STATE.PENDING_SYNC);
  assert.ok(intent.intentId);
  assert.equal(intent.serialNo, "SN-1");
  assert.equal(intent.capturedAtLocal, 1234);
  // The words the server owns are absent from the captured record entirely.
  assert.equal("installed" in intent, false);
  assert.equal("completed" in intent, false);
});

test("A PENDING INTENT MAY NEVER SAY INSTALLED OR COMPLETED", () => {
  // A device that has not spoken to the server does not know whether the technician still holds the
  // capability, whether the work order still exists, or whether somebody else installed that unit.
  const d = describePendingIntent(captureOfflineIntent({ workOrderId: "wo1", serialNo: "SN-1", attemptToken: "t" }));
  assert.equal(d.claimsInstalled, false);
  assert.equal(d.claimsCompleted, false);
  assert.doesNotMatch(d.label, /installed|completed/i);
  assert.match(d.detail, /not installed or completed until the server confirms/i);
});

test("only a PENDING_SYNC intent is describable as pending", () => {
  assert.equal(describePendingIntent({ state: CLOSEOUT_STATE.DONE }), null);
  assert.equal(describePendingIntent(null), null);
});

test("the sync plan re-resolves AUTHORITY AND STATE before it executes anything", () => {
  // The order is the safety: an intent captured while authorized must not execute after that
  // authority is gone.
  const execute = SYNC_PLAN.indexOf("record the installation");
  assert.ok(SYNC_PLAN.indexOf("re-resolve equipment.install") < execute);
  assert.ok(SYNC_PLAN.indexOf("re-read the work order") < execute);
  assert.ok(SYNC_PLAN.indexOf("re-read the serialized asset") < execute);
  assert.ok(SYNC_PLAN.indexOf("verify state and authority") < execute);
  assert.ok(SYNC_PLAN.indexOf("complete the work order") > execute, "completion must follow the install");
});

test("sync outcomes distinguish refused, conflict and needs-attention", () => {
  const sync = (details) => interpretSync({ installStep: interpretInstallStep(refused(details)) });
  assert.equal(sync(CLOSEOUT_FAILURE.PERMISSION_DENIED).outcome, SYNC_OUTCOME.REFUSED);
  assert.equal(sync(CLOSEOUT_FAILURE.NOT_ASSIGNED_TECHNICIAN).outcome, SYNC_OUTCOME.REFUSED);
  assert.equal(sync(CLOSEOUT_FAILURE.ASSET_INSTALLED_ELSEWHERE).outcome, SYNC_OUTCOME.CONFLICT);
  assert.equal(sync(CLOSEOUT_FAILURE.WORK_ORDER_STATE_INVALID).outcome, SYNC_OUTCOME.NEEDS_ATTENTION);
});

test("a sync is SYNCED only when BOTH steps finished", () => {
  const both = interpretSync({ installStep: interpretInstallStep(installed()), completionAttempted: true, completionError: null });
  assert.equal(both.outcome, SYNC_OUTCOME.SYNCED);
  // Installed but not completed is NOT synced -- calling it synced would hide an open job.
  const half = interpretSync({ installStep: interpretInstallStep(installed()), completionAttempted: true, completionError: new Error("x") });
  assert.equal(half.outcome, SYNC_OUTCOME.NEEDS_ATTENTION);
  assert.equal(half.equipmentId, "eq_1");
});

test("an unrecognised answer is NEEDS_ATTENTION, never SYNCED", () => {
  assert.equal(interpretSync({}).outcome, SYNC_OUTCOME.NEEDS_ATTENTION);
});
