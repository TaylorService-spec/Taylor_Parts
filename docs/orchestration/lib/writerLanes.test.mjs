// Writer-lane isolation — regression checks for the collision that caused this module.
//
// These assert INTENDED orchestration behavior. Each corresponds to a failure that
// actually occurred or was one step away: two writers in one checkout, a lane with no
// worktree, a PR number recorded before GitHub confirmed it, and a destructive action
// taken on a subagent's say-so.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeLane, validateLane, validateLaneSet, reconcileLanes,
  isControllerOnly, CONTROLLER_ONLY_ACTIONS, RECOVERY_ORDER,
} from "./writerLanes.mjs";

const writer = (over = {}) => makeLane({
  taskId: "X-TASK", kind: "WRITER", branch: "feat/x", worktree: "/wt/x",
  baseSha: "78aa6376", owner: "agent-1", status: "WORKING", ...over,
});

const codes = (list) => list.map((p) => p.code);

test("a fully specified writer lane validates", () => {
  assert.deepEqual(validateLane(writer()), []);
});

test("a WRITER with no worktree fails — the dispatch must fail, not the recovery", () => {
  // The exact condition that caused the collision: a write-capable agent sharing the
  // controller's checkout.
  assert.ok(codes(validateLane(writer({ worktree: null }))).includes("NO_WORKTREE"));
});

test("a WRITER must record the base it was dispatched from", () => {
  // Without it, "did unrelated commits appear?" is unanswerable after the fact — which is
  // precisely the check the controller has to perform on handoff.
  assert.ok(codes(validateLane(writer({ baseSha: null }))).includes("NO_BASE"));
});

test("a WRITER must name an owner — a lane with no owner has no accountable writer", () => {
  assert.ok(codes(validateLane(writer({ owner: null }))).includes("NO_OWNER"));
});

test("a SCOUT needs no worktree, because it mutates nothing", () => {
  const scout = makeLane({ taskId: "X-SCOUT", kind: "SCOUT", status: "WORKING" });
  assert.deepEqual(validateLane(scout), []);
});

test("two ACTIVE writers cannot share a worktree", () => {
  const problems = validateLaneSet([
    writer({ taskId: "A", branch: "feat/a" }),
    writer({ taskId: "B", branch: "feat/b" }),
  ]);
  assert.ok(codes(problems).includes("SHARED_WORKTREE"));
});

test("two ACTIVE lanes cannot share a branch", () => {
  const problems = validateLaneSet([
    writer({ taskId: "A", worktree: "/wt/a" }),
    writer({ taskId: "B", worktree: "/wt/b" }),
  ]);
  assert.ok(codes(problems).includes("SHARED_BRANCH"));
});

test("a MERGED lane owns nothing — history may reuse a name without conflict", () => {
  // Otherwise the check becomes noisy enough to ignore, which is how a real collision
  // gets missed among false ones.
  const problems = validateLaneSet([
    writer({ taskId: "A", status: "MERGED" }),
    writer({ taskId: "B", status: "WORKING" }),
  ]);
  assert.ok(!codes(problems).includes("SHARED_WORKTREE"));
  assert.ok(!codes(problems).includes("SHARED_BRANCH"));
});

test("one task cannot have two active lanes", () => {
  const problems = validateLaneSet([
    writer({ branch: "feat/x1", worktree: "/wt/x1" }),
    writer({ branch: "feat/x2", worktree: "/wt/x2" }),
  ]);
  assert.ok(codes(problems).includes("DUPLICATE_TASK"));
});

test("PR_OPEN requires a verified number and head — not a predicted one", () => {
  // A PR number recorded from a failed command put a phantom PR in this program's ledger
  // once already.
  const problems = validateLane(writer({ status: "PR_OPEN" }));
  assert.ok(codes(problems).includes("PR_UNVERIFIED"));
  assert.ok(codes(problems).includes("NO_HEAD"));
});

test("an abandoned lane must say why — silence hides whether work was preserved", () => {
  assert.ok(codes(validateLane(writer({ status: "ABANDONED" }))).includes("NO_REASON"));
});

test("a recorded PR whose GitHub head is another branch is a disagreement", () => {
  // The mechanical half of "do not accept 'agent says done' as proof of branch integrity".
  const lane = writer({ status: "PR_OPEN", pr: 42, headSha: "aaaaaaaa" });
  const out = reconcileLanes([lane], { 42: { headRef: "feat/somewhere-else", headSha: "aaaaaaaa" } });
  assert.ok(codes(out).includes("PR_WRONG_BRANCH"));
});

test("a PR that GitHub does not report at all is a disagreement, not an absence", () => {
  const lane = writer({ status: "PR_OPEN", pr: 99, headSha: "aaaaaaaa" });
  assert.ok(codes(reconcileLanes([lane], {})).includes("PR_NOT_FOUND"));
});

test("a PR whose head moved under a recorded lane is reported", () => {
  const lane = writer({ status: "PR_OPEN", pr: 7, headSha: "aaaaaaaa" });
  const out = reconcileLanes([lane], { 7: { headRef: "feat/x", headSha: "bbbbbbbb" } });
  assert.ok(codes(out).includes("PR_MOVED"));
});

test("an agreeing PR produces no disagreement", () => {
  const lane = writer({ status: "PR_OPEN", pr: 7, headSha: "aaaaaaaa" });
  assert.deepEqual(reconcileLanes([lane], { 7: { headRef: "feat/x", headSha: "aaaaaaaa" } }), []);
});

test("destructive actions are controller-only, as one shared list", () => {
  // Referenced by both the dispatch prompt and the review check, so the two cannot drift.
  for (const action of ["force-push", "hard-reset", "history-rewrite"]) {
    assert.ok(isControllerOnly(action), action);
  }
  assert.ok(!isControllerOnly("commit"));
  assert.ok(CONTROLLER_ONLY_ACTIONS.includes("overwrite-remote-branch"));
});

test("recovery preserves before it cleans, and tries a fresh branch before any rewrite", () => {
  // The ordering IS the rule: contamination is not solved by destroying the evidence.
  const order = [...RECOVERY_ORDER];
  assert.ok(order.indexOf("preserve") < order.indexOf("abandon-contaminated-lane"));
  assert.ok(order.indexOf("fresh-branch-or-worktree") < order.indexOf("abandon-contaminated-lane"));
  assert.ok(order.indexOf("run-tests") < order.indexOf("abandon-contaminated-lane"));
  assert.equal(order[0], "inspect");
});

// --- shared-resource serialization -------------------------------------------
//
// Isolation is not enough: two lanes can own separate worktrees and still contend on the
// registry, the workflow and the index file. That nearly happened — two lanes dispatched
// as disjoint were both routed at the same registration files, and avoided colliding only
// because one did not need a new test file.

import {
  canDispatch, sharedResourceOwners, undeclaredSharedEdits, outOfScopeFiles,
  registrationGaps, LOGICAL_RESOURCES,
} from "./writerLanes.mjs";

const claiming = (taskId, resources, over = {}) => makeLane({
  taskId, kind: "WRITER", branch: `feat/${taskId}`, worktree: `/wt/${taskId}`,
  baseSha: "94040c1e", owner: `agent-${taskId}`, status: "WORKING",
  sharedResources: resources, ...over,
});

test("dispatch FAILS CLOSED when a shared resource is already owned", () => {
  // The check belongs at dispatch. Discovering contention after two agents have written
  // is recovery, and recovery is the expensive path this model exists to avoid.
  const active = [claiming("A", ["METADATA_REGISTRATION"])];
  const problems = canDispatch(claiming("B", ["METADATA_REGISTRATION"]), active);
  assert.ok(codes(problems).includes("RESOURCE_OWNED"));
});

test("dispatch succeeds when shared resources are disjoint", () => {
  const active = [claiming("A", ["METADATA_REGISTRATION"])];
  assert.deepEqual(canDispatch(claiming("B", ["INDEX_DECLARATIONS"]), active), []);
});

test("a lane does not block itself on redispatch", () => {
  const lane = claiming("A", ["METADATA_REGISTRATION"]);
  assert.deepEqual(canDispatch(lane, [lane]), []);
});

test("a MERGED lane releases its claims", () => {
  // Keeping them would block every successor on work that has already landed.
  const done = claiming("A", ["METADATA_REGISTRATION"], { status: "MERGED" });
  assert.equal(sharedResourceOwners([done]).size, 0);
  assert.deepEqual(canDispatch(claiming("B", ["METADATA_REGISTRATION"]), [done]), []);
});

test("editing a shared resource the lane never claimed is a handoff defect", () => {
  const lane = claiming("A", ["METADATA_REGISTRATION"]);
  const undeclared = undeclaredSharedEdits(lane, ["METADATA_REGISTRATION", "INDEX_DECLARATIONS"]);
  assert.deepEqual(undeclared, ["INDEX_DECLARATIONS"]);
});

test("scope leakage is reported per file, not merely as a boolean", () => {
  // The controller needs to see WHICH file left the lane.
  const lane = claiming("A", [], { writeScope: ["src/metadata/definitions/part.js"] });
  const out = outOfScopeFiles(lane, ["src/metadata/definitions/part.js", "package.json"]);
  assert.deepEqual(out, ["package.json"]);
});

test("a directory in writeScope covers the files beneath it", () => {
  const lane = claiming("A", [], { writeScope: ["functions/scripts"] });
  assert.deepEqual(outOfScopeFiles(lane, ["functions/scripts/backfill.mjs"]), []);
});

test("registration completeness is checked in BOTH directions", () => {
  // An omitted entry and an extra entry are both coverage defects. A one-way containment
  // check would pass while half a batch was invisible.
  const gaps = registrationGaps({ accepted: ["part", "equipment"], registered: ["part", "ghost"] });
  assert.deepEqual(gaps.missing, ["equipment"]);
  assert.deepEqual(gaps.orphaned, ["ghost"]);
  assert.equal(gaps.complete, false);
});

test("a complete batch reports complete", () => {
  const gaps = registrationGaps({ accepted: ["part", "equipment"], registered: ["equipment", "part"] });
  assert.equal(gaps.complete, true);
  assert.deepEqual(gaps.missing, []);
  assert.deepEqual(gaps.orphaned, []);
});

test("logical resources stay a small named set rather than an open string space", () => {
  // Over-generalizing locks before a real shared family exists produces ceremony, not
  // safety.
  assert.ok(LOGICAL_RESOURCES.includes("METADATA_REGISTRATION"));
  assert.ok(LOGICAL_RESOURCES.includes("INDEX_DECLARATIONS"));
  assert.ok(LOGICAL_RESOURCES.length <= 8);
});
