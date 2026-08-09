// Tests for the pure next-eligible work selector (Option A /loop driver core).
// Run: node --test docs/orchestration/lib/selectNextWork.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { selectNextWork, DECISIONS, WORK_STATES } from "./selectNextWork.mjs";

test("picks the highest-priority READY item (lower priority number wins)", () => {
  const r = selectNextWork([
    { id: "a", state: "READY", priority: 5 },
    { id: "b", state: "READY", priority: 1 },
    { id: "c", state: "READY", priority: 3 },
  ]);
  assert.equal(r.decision, DECISIONS.RUN);
  assert.equal(r.item.id, "b");
});

test("ties on priority break by unblocks-count, then declared order", () => {
  const r = selectNextWork([
    { id: "a", state: "READY", priority: 1, unblocks: 0 },
    { id: "b", state: "READY", priority: 1, unblocks: 4 },
    { id: "c", state: "READY", priority: 1, unblocks: 4 },
  ]);
  assert.equal(r.item.id, "b"); // same priority+unblocks as c, but declared first
});

test("resumes in-flight work (RUNNING / SAFE_CHECKPOINT) before starting new READY", () => {
  const running = selectNextWork([
    { id: "new", state: "READY", priority: 1 },
    { id: "mid", state: "RUNNING", priority: 9 },
  ]);
  assert.equal(running.item.id, "mid");

  const checkpointed = selectNextWork([
    { id: "new", state: "READY", priority: 1 },
    { id: "paused", state: "SAFE_CHECKPOINT", priority: 9 },
  ]);
  assert.equal(checkpointed.item.id, "paused");
});

test("TOOL_PERMISSION_BLOCKED stays actionable (mechanics, not a product gate)", () => {
  const r = selectNextWork([
    { id: "perm", state: "TOOL_PERMISSION_BLOCKED", priority: 9 },
    { id: "new", state: "READY", priority: 1 },
  ]);
  assert.equal(r.decision, DECISIONS.RUN);
  assert.equal(r.item.id, "perm"); // ranked ahead of new READY work
});

test("CORRECTION: no READY, but a blocked item exposes repo-safe prerequisite work → PREREQUISITE_AVAILABLE", () => {
  const r = selectNextWork([
    { id: "owner", state: "OWNER_DECISION" },
    {
      id: "blocked-impl",
      state: "BLOCKED_DEPENDENCY",
      blockedOn: "protected-deploy",
      prerequisiteWork: [
        { kind: "readiness-assessment", repoSafe: true },
        { kind: "cutover-deploy", repoSafe: false },
      ],
    },
  ]);
  assert.equal(r.decision, DECISIONS.PREREQUISITE_AVAILABLE);
  assert.equal(r.prerequisites.length, 1);
  assert.equal(r.prerequisites[0].item.id, "blocked-impl");
  assert.deepEqual(r.prerequisites[0].prerequisites.map((p) => p.kind), ["readiness-assessment"]);
});

test("done prerequisites do not re-surface", () => {
  const r = selectNextWork([
    { id: "owner", state: "OWNER_DECISION" },
    {
      id: "blocked-impl",
      state: "BLOCKED_DEPENDENCY",
      prerequisiteWork: [{ kind: "readiness-assessment", repoSafe: true, done: true }],
    },
  ]);
  assert.equal(r.decision, DECISIONS.CHECKPOINT); // nothing executable left
});

test("only genuine gates remain → CHECKPOINT with categorized pending", () => {
  const r = selectNextWork([
    { id: "o", state: "OWNER_DECISION" },
    { id: "p", state: "PROTECTED_ACTION" },
    { id: "b", state: "BLOCKED_DEPENDENCY" }, // no prereq work
    { id: "done", state: "DONE" },
  ]);
  assert.equal(r.decision, DECISIONS.CHECKPOINT);
  assert.equal(r.pending.ownerDecision.length, 1);
  assert.equal(r.pending.protectedAction.length, 1);
  assert.equal(r.pending.blocked.length, 1);
});

test("everything DONE (or empty) → ROADMAP_COMPLETE", () => {
  assert.equal(selectNextWork([]).decision, DECISIONS.ROADMAP_COMPLETE);
  assert.equal(
    selectNextWork([{ id: "x", state: "DONE" }, { id: "y", state: "DONE" }]).decision,
    DECISIONS.ROADMAP_COMPLETE,
  );
});

test("BUDGET_LIMIT is a genuine gate, not actionable", () => {
  const r = selectNextWork([{ id: "cap", state: "BUDGET_LIMIT" }]);
  assert.equal(r.decision, DECISIONS.CHECKPOINT);
  assert.equal(r.pending.budgetLimit.length, 1);
});

test("unknown state is rejected (fail-closed, no silent skip)", () => {
  assert.throws(() => selectNextWork([{ id: "x", state: "NOT_A_STATE" }]), /unknown state/);
});

test("state vocabulary includes ROADMAP_COMPLETE and the Phase-3 resource-wait state", () => {
  assert.equal(WORK_STATES.length, 11);
  assert.ok(WORK_STATES.includes("ROADMAP_COMPLETE"));
  assert.ok(WORK_STATES.includes("READY_BUT_WAITING_RESOURCE"));
});

test("READY_BUT_WAITING_RESOURCE → WAIT_RESOURCE (transient), not a CHECKPOINT gate", () => {
  const r = selectNextWork([{ id: "q", state: "READY_BUT_WAITING_RESOURCE" }]);
  assert.equal(r.decision, DECISIONS.WAIT_RESOURCE);
  assert.equal(r.waitingResource.length, 1);
  // NOT ROADMAP_COMPLETE and NOT CHECKPOINT — the slot will free and it runs.
});

test("a resource wait does not mask a READY item — READY still runs first", () => {
  const r = selectNextWork([
    { id: "q", state: "READY_BUT_WAITING_RESOURCE" },
    { id: "local", state: "READY", priority: 1 },
  ]);
  assert.equal(r.decision, DECISIONS.RUN);
  assert.equal(r.item.id, "local"); // local READY work continues while the remote slot is contended
});

test("resource wait is surfaced alongside (not collapsed into) genuine gates", () => {
  const r = selectNextWork([
    { id: "q", state: "READY_BUT_WAITING_RESOURCE" },
    { id: "o", state: "OWNER_DECISION" },
  ]);
  assert.equal(r.decision, DECISIONS.WAIT_RESOURCE); // transient wait takes precedence over stopping
  assert.equal(r.pending.ownerDecision.length, 1); // but the gate is still reported
});
