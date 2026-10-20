// Performance goal authoring, from the browser (G-1; DECISIONS #G-1): the transport client is fail-closed and decides nothing.
//   * malformed input is refused CLIENT-SIDE without a call;
//   * a GOVERNED refusal carries the command's own sentence; any other failure is a bounded outcome with NO server text;
//   * a malformed answer is UNAVAILABLE, never a partially trusted result;
//   * the idempotencyKey travels verbatim; no tenant, author, approver, status or version is ever sent (the server owns them);
//   * the operations are on the client's allow-list, and the client names no capability to decide on.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createGoalAuthoringClient, goalFailure, newIdempotencyKey, GOAL_AUTHORING_OPERATIONS, GOAL_OUTCOME } from "../src/services/eosGoalAuthoringClient.js";

const recorder = (responses) => {
  const calls = [];
  const call = async (operation, input) => {
    calls.push({ operation, input });
    const r = responses[operation];
    if (r instanceof Error) throw r;
    return typeof r === "function" ? r(input) : r;
  };
  return { call, calls };
};
const failure = (code, message = "server words", reason = null) => ({ ok: false, code, message, reason });
const DRAFT = { metricId: "service.workOrder.pastDue.count", targetScopeType: "FIRM", targetValue: 5, unit: "COUNT", direction: "AT_MOST", effectiveFrom: "2026-11-01", idempotencyKey: "k-1" };

test("the four operations are the server's, and are on the client's allow-list", () => {
  const reorderApi = readFileSync(new URL("../src/services/reorderApiClient.js", import.meta.url), "utf8");
  const names = (list) => reorderApi.slice(reorderApi.indexOf(`export const ${list} =`)).split("]);")[0];
  const reads = names("REORDER_READ_OPERATIONS");
  const writes = names("REORDER_COMMAND_OPERATIONS");
  assert.ok(reads.includes(`"${GOAL_AUTHORING_OPERATIONS.options}"`));
  for (const op of [GOAL_AUTHORING_OPERATIONS.create, GOAL_AUTHORING_OPERATIONS.approve, GOAL_AUTHORING_OPERATIONS.retire]) assert.ok(writes.includes(`"${op}"`), op);
  // And the client names no capability: the gate is the server's (and the screen's, from the shell).
  const src = readFileSync(new URL("../src/services/eosGoalAuthoringClient.js", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(src, /performance\.goal\./);
  assert.doesNotMatch(src, /firebase/i, "no Firebase anywhere in the authoring seam");
});

test("failures: a governed refusal carries its sentence; anything else is a bounded outcome with no text", () => {
  assert.deepEqual(goalFailure(failure("FORBIDDEN", "the author of a goal version may not approve it", "SELF_APPROVAL_FORBIDDEN")),
    { ok: false, outcome: GOAL_OUTCOME.DENIED, reason: "SELF_APPROVAL_FORBIDDEN", message: "the author of a goal version may not approve it" });
  assert.equal(goalFailure(failure("PRECONDITION_FAILED")).outcome, GOAL_OUTCOME.CONFLICT);
  assert.equal(goalFailure(failure("CONFLICT")).outcome, GOAL_OUTCOME.CONFLICT);
  assert.equal(goalFailure(failure("NOT_FOUND")).outcome, GOAL_OUTCOME.NOT_FOUND);
  assert.equal(goalFailure(failure("INVALID_INPUT")).outcome, GOAL_OUTCOME.INVALID);
  assert.equal(goalFailure(failure("NOT_SIGNED_IN")).outcome, GOAL_OUTCOME.UNAUTHENTICATED);
  for (const code of ["INTERNAL", "UNREACHABLE", "NOT_CONFIGURED", "UNKNOWN_OPERATION", undefined]) {
    const f = goalFailure(failure(code, "SELECT * FROM secret_table"));
    assert.equal(f.outcome, GOAL_OUTCOME.UNAVAILABLE);
    assert.equal("message" in f, false, "a failure the platform did not govern never shows server text");
  }
  assert.equal("message" in goalFailure(failure("FORBIDDEN", "")), false, "an empty sentence is not shown");
});

test("createDraft sends the target, the caller's key verbatim and optional fields only when stated -- never an author, a tenant, a status or a version", async () => {
  const { call, calls } = recorder({ createPerformanceGoalDraft: { ok: true, result: { outcome: "applied", goalId: "goal_1", status: "DRAFT", version: 1 } } });
  const client = createGoalAuthoringClient({ call });
  const out = await client.createDraft(DRAFT);
  assert.deepEqual([out.ok, out.replayed, out.goal.goalId], [true, false, "goal_1"]);
  assert.deepEqual(calls, [{ operation: "createPerformanceGoalDraft", input: {
    metricId: "service.workOrder.pastDue.count", targetScopeType: "FIRM", targetValue: 5, unit: "COUNT", direction: "AT_MOST", effectiveFrom: "2026-11-01", idempotencyKey: "k-1" } }]);
  // A replacement names its predecessor; a currency target carries its currency and an end date.
  await client.createDraft({ ...DRAFT, targetScopeType: "OPERATING_COMPANY", targetScopeId: "taylor", unit: "CURRENCY_MINOR", currency: "USD", effectiveTo: "2026-12-31", supersedesGoalId: "goal_0", idempotencyKey: "k-2" });
  assert.deepEqual(calls[1].input, { metricId: "service.workOrder.pastDue.count", targetScopeType: "OPERATING_COMPANY", targetScopeId: "taylor", targetValue: 5, unit: "CURRENCY_MINOR",
    direction: "AT_MOST", effectiveFrom: "2026-11-01", idempotencyKey: "k-2", currency: "USD", effectiveTo: "2026-12-31", supersedesGoalId: "goal_0" });
  for (const forbidden of ["tenantId", "createdBy", "createdByUid", "status", "version", "goalId", "actorUid", "approvedBy"]) assert.ok(!(forbidden in calls[0].input), forbidden);
  // A replayed answer is flagged.
  const replayed = createGoalAuthoringClient({ call: recorder({ createPerformanceGoalDraft: { ok: true, result: { outcome: "replayed", goalId: "goal_1", status: "DRAFT", version: 1 } } }).call });
  assert.equal((await replayed.createDraft(DRAFT)).replayed, true);
});

test("createDraft refuses malformed input WITHOUT a call", async () => {
  const { call, calls } = recorder({});
  const client = createGoalAuthoringClient({ call });
  for (const bad of [
    { ...DRAFT, metricId: "" }, { ...DRAFT, targetScopeType: undefined }, { ...DRAFT, targetValue: 1.5 }, { ...DRAFT, targetValue: -1 }, { ...DRAFT, targetValue: "5" },
    { ...DRAFT, unit: undefined }, { ...DRAFT, direction: undefined }, { ...DRAFT, effectiveFrom: "11/01/2026" }, { ...DRAFT, effectiveFrom: undefined },
    { ...DRAFT, idempotencyKey: "" }, { ...DRAFT, idempotencyKey: undefined },
  ]) {
    const out = await client.createDraft(bad);
    assert.deepEqual([out.ok, out.outcome], [false, GOAL_OUTCOME.INVALID], JSON.stringify(bad));
  }
  assert.equal(calls.length, 0);
});

test("approve and retire need a goal, a stated reason and a key; the reason is sent trimmed; the answer must be the status asked for", async () => {
  const { call, calls } = recorder({
    approvePerformanceGoal: { ok: true, result: { outcome: "applied", goalId: "goal_1", status: "APPROVED", version: 2, supersededGoalId: "goal_0", predecessorClosedAt: "2026-11-30" } },
    retirePerformanceGoal: { ok: true, result: { outcome: "applied", goalId: "goal_1", status: "RETIRED", closedAt: "2026-12-20" } },
  });
  const client = createGoalAuthoringClient({ call });
  const a = await client.approve({ goalId: "goal_1", reason: "  Agreed with operations ", idempotencyKey: "k-a" });
  assert.deepEqual([a.ok, a.result.supersededGoalId], [true, "goal_0"]);
  assert.deepEqual(calls[0], { operation: "approvePerformanceGoal", input: { goalId: "goal_1", reason: "Agreed with operations", idempotencyKey: "k-a" } });
  const r = await client.retire({ goalId: "goal_1", reason: "Stopped measuring", idempotencyKey: "k-r" });
  assert.deepEqual([r.ok, r.result.closedAt], [true, "2026-12-20"]);
  const before = calls.length;
  for (const bad of [{ goalId: "", reason: "r", idempotencyKey: "k" }, { goalId: "g", reason: "   ", idempotencyKey: "k" }, { goalId: "g", reason: undefined, idempotencyKey: "k" }, { goalId: "g", reason: "r", idempotencyKey: "" }]) {
    assert.equal((await client.approve(bad)).outcome, GOAL_OUTCOME.INVALID);
    assert.equal((await client.retire(bad)).outcome, GOAL_OUTCOME.INVALID);
  }
  assert.equal(calls.length, before, "no call for malformed input");
  // A malformed or wrong-status answer is UNAVAILABLE, never trusted.
  const odd = createGoalAuthoringClient({ call: recorder({ approvePerformanceGoal: { ok: true, result: { status: "DRAFT" } }, retirePerformanceGoal: { ok: true, result: null } }).call });
  assert.equal((await odd.approve({ goalId: "g", reason: "r", idempotencyKey: "k" })).outcome, GOAL_OUTCOME.UNAVAILABLE);
  assert.equal((await odd.retire({ goalId: "g", reason: "r", idempotencyKey: "k" })).outcome, GOAL_OUTCOME.UNAVAILABLE);
});

test("a refusal and a transport failure keep their meaning; a throw is UNAVAILABLE", async () => {
  const refused = createGoalAuthoringClient({ call: recorder({ approvePerformanceGoal: failure("FORBIDDEN", "the author of a goal version may not approve it", "SELF_APPROVAL_FORBIDDEN") }).call });
  const out = await refused.approve({ goalId: "g", reason: "r", idempotencyKey: "k" });
  assert.deepEqual([out.ok, out.outcome, out.reason, out.message], [false, GOAL_OUTCOME.DENIED, "SELF_APPROVAL_FORBIDDEN", "the author of a goal version may not approve it"]);
  const thrown = createGoalAuthoringClient({ call: recorder({ retirePerformanceGoal: new Error("socket hang up") }).call });
  const t = await thrown.retire({ goalId: "g", reason: "r", idempotencyKey: "k" });
  assert.deepEqual([t.ok, t.outcome, "message" in t], [false, GOAL_OUTCOME.UNAVAILABLE, false]);
});

test("loadOptions and listVersions: a malformed answer is UNAVAILABLE; the versions come from the existing read", async () => {
  const good = { principalId: "p1", verbs: { create: true, supersede: false, approve: true, retire: false }, metrics: [], companies: [], warehouses: [], employeeIds: [] };
  const ok = createGoalAuthoringClient({ call: recorder({ listGoalAuthoringOptions: { ok: true, result: good } }).call });
  const loaded = await ok.loadOptions();
  assert.deepEqual([loaded.ok, loaded.options.principalId], [true, "p1"]);
  for (const result of [null, {}, { ...good, metrics: "x" }, { ...good, verbs: null }, { ...good, employeeIds: undefined }]) {
    const bad = createGoalAuthoringClient({ call: recorder({ listGoalAuthoringOptions: { ok: true, result } }).call });
    assert.equal((await bad.loadOptions()).outcome, GOAL_OUTCOME.UNAVAILABLE, JSON.stringify(result));
  }
  assert.equal((await createGoalAuthoringClient({ call: recorder({ listGoalAuthoringOptions: failure("FORBIDDEN") }).call }).loadOptions()).outcome, GOAL_OUTCOME.DENIED);

  const seen = [];
  const reads = { fetchPerformanceGoalVersions: async (target) => { seen.push(target); return { result: { versions: [{ goalId: "g1" }] } }; } };
  const c = createGoalAuthoringClient({ call: recorder({}).call, reads });
  const v = await c.listVersions({ metricId: "m", targetScopeType: "FIRM", targetScopeId: null });
  assert.deepEqual([v.ok, v.versions, seen.length], [true, [{ goalId: "g1" }], 1]);
  assert.equal((await createGoalAuthoringClient({ call: recorder({}).call, reads: { fetchPerformanceGoalVersions: async () => ({ errorStatus: "denied" }) } }).listVersions({})).outcome, GOAL_OUTCOME.DENIED);
  assert.equal((await createGoalAuthoringClient({ call: recorder({}).call, reads: { fetchPerformanceGoalVersions: async () => ({ errorStatus: "unavailable" }) } }).listVersions({})).outcome, GOAL_OUTCOME.UNAVAILABLE);
  assert.equal((await createGoalAuthoringClient({ call: recorder({}).call, reads: { fetchPerformanceGoalVersions: async () => ({ result: { versions: "x" } }) } }).listVersions({})).outcome, GOAL_OUTCOME.UNAVAILABLE);
});

test("newIdempotencyKey is unique per attempt and carries its prefix", () => {
  const keys = new Set(Array.from({ length: 50 }, () => newIdempotencyKey("goal-create")));
  assert.equal(keys.size, 50);
  assert.ok([...keys].every((k) => k.startsWith("goal-create-") && k.length <= 200));
});
