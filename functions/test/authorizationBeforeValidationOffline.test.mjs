// P1 API-01 -- AUTHORIZATION BEFORE VALIDATION, proved without a database.
//
// UAT-R2 (Codex): a General Employee holding NO capability got input / precondition errors (26 x 400, 1 x 412) instead of an authorization refusal
// on 27 operations, which tells an unauthorized caller the operation's shape and preconditions. The rule these tests pin, per operation:
//
//   * a caller who does not hold the operation's capability is refused FORBIDDEN, with the operation's own established code, whatever the input
//     (empty, malformed, unknown fields, wrong types) -- and, where the command can decide it without a record, without touching the database;
//   * a caller who DOES hold it and sends the same bad input still gets the unchanged INVALID_INPUT / precondition answer (ordering only changed);
//   * a caller holding only the OTHER of two alternative keys (review approve/reject, goal create/supersede) is still refused by the key their input names.
//
// Scope, record-reach and lifecycle checks that NEED the input stay after validation; they are not what this file is about.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const reorder = require("../lib/eosOps/reorderLifecycleCommands.js");
const reports = require("../lib/eosOps/reportOperations.js");
const goals = require("../lib/eosOps/performanceGoalAuthoring.js");
const { EOS_CYCLE_COUNT_OPERATIONS } = require("../lib/eosOps/cycleCountOperations.js");
const { EOS_RELOCATION_OPERATIONS } = require("../lib/eosOps/stockRelocationOperations.js");
const { EOS_PLACEMENT_OPERATIONS } = require("../lib/eosOps/binPlacementOperations.js");
const { EOS_ACQUIRE_OPERATIONS } = require("../lib/eosOps/serializedAssetAcquireOperations.js");
const { EOS_WORK_ORDER_OPERATIONS } = require("../lib/eosOps/workOrderOperations.js");
const { executeAdminOperation } = require("../lib/adminPolicy/adminPolicyApi.js");
const { InMemoryPolicyRepository } = require("../lib/adminPolicy/inMemoryPolicyRepository.js");

const TENANT = "tenant-a";
const PRINCIPAL = "principal-1";

// ---- inputs: the empty probe Codex sent, and a malformed one (unknown fields + wrong types for every id/shape these commands read) ----
const EMPTY = Object.freeze({});
const MALFORMED = Object.freeze({
  bogus: true, workOrderId: 123, sheetId: 123, partId: 123, definitionId: 123, reorderRequestId: 123, decision: "MAYBE", location: "not-an-object",
  locationId: 123, idempotencyKey: 123, expectedStatus: "NOT_A_STATUS", name: 123, definition: "not-an-object", metricId: 123,
});
const INPUTS = Object.freeze([["empty input", EMPTY], ["malformed input", MALFORMED]]);

// ---- a pool that answers the inventory-baseline gate and records every other statement; WO / reorder / admin must not need it at all ----
function fakePool() {
  const statements = [];
  const answer = async (sql) => {
    statements.push(String(sql));
    if (/inventory_baseline_cutovers/.test(sql)) return { rows: [{ n: 2 }] };
    return { rows: [] };
  };
  return { statements, query: answer, connect: async () => ({ query: answer, release() {} }) };
}
const throwingPool = () => ({
  query: async () => { throw new Error("a caller without the capability must not reach the database"); },
  connect: async () => { throw new Error("a caller without the capability must not reach the database"); },
});

const actorWith = (...keys) => Object.freeze({ tenantId: TENANT, principalId: PRINCIPAL, capabilities: new Set(keys) });
const refusedWith = async (fn) => {
  try { await fn(); } catch (err) { return err; }
  return assert.fail("expected a refusal, got a result");
};

// ---- the 27 operations: [operation, capability held by the authorized caller, established refusal code, caller factory] ----
// `run(actor, input, pool)` invokes the command exactly as the transport does.
const ACTIVE = { postgresState: "ACTIVE" };
const wo = (op) => (actor, input, pool) => EOS_WORK_ORDER_OPERATIONS[op](
  { pool, reader: {}, now: () => new Date("2026-10-22T00:00:00Z") },
  { actor, operational: { ...actor, conditionallyHeld: new Set(), scopedHeld: [], entitlements: () => Promise.resolve([]) } }, input);
const cc = (op) => (actor, input, pool) => EOS_CYCLE_COUNT_OPERATIONS[op]({ pool, ...ACTIVE }, actor, input);

const OPERATIONS = Object.freeze([
  // /operations/inventory
  ["reviewReorderRequest", "reorder.request.approve", "CAPABILITY_REQUIRED", (a, i, p) => reorder.reviewReorderRequest({ pool: p }, a, i)],
  ["markReorderReceived", "reorder.request.markReceived", "CAPABILITY_REQUIRED", (a, i, p) => reorder.markReorderReceived({ pool: p }, a, i)],
  ["createSavedReportDefinition", "report.definition.create", "CAPABILITY_REQUIRED", (a, i, p) => reports.createSavedReportDefinition({ pool: p }, a, i)],
  ["deleteSavedReportDefinition", "report.definition.delete", "CAPABILITY_REQUIRED", (a, i, p) => reports.deleteSavedReportDefinition({ pool: p }, a, i)],
  ["createPerformanceGoalDraft", "performance.goal.create", "CAPABILITY_REQUIRED", (a, i, p) => goals.createPerformanceGoalDraft({ pool: p }, a, i)],
  // /operations/cycle-count
  ["createCycleCountSheet", "inventory.cycleCount.create", "CAPABILITY_MISSING", cc("createCycleCountSheet")],
  ["submitCycleCountLine", "inventory.cycleCount.submit", "CAPABILITY_MISSING", cc("submitCycleCountLine")],
  ["reconcileCycleCountLine", "inventory.cycleCount.reconcile", "CAPABILITY_MISSING", cc("reconcileCycleCountLine")],
  ["closeCycleCountSheet", "inventory.cycleCount.close", "CAPABILITY_MISSING", cc("closeCycleCountSheet")],
  ["cancelCycleCountSheet", "inventory.cycleCount.cancel", "CAPABILITY_MISSING", cc("cancelCycleCountSheet")],
  // /operations/relocation, /placement, /serialized-asset
  ["relocateStock", "inventory.stock.relocate", "CAPABILITY_MISSING", (a, i, p) => EOS_RELOCATION_OPERATIONS.relocateStock({ pool: p, ...ACTIVE }, a, i)],
  ["recordPutAway", "inventory.placement.record", "CAPABILITY_MISSING", (a, i, p) => EOS_PLACEMENT_OPERATIONS.recordPutAway({ pool: p, ...ACTIVE }, a, i)],
  ["acquireSerializedAsset", "inventory.serializedAsset.acquire", "PERMISSION_DENIED", (a, i, p) => EOS_ACQUIRE_OPERATIONS.acquireSerializedAsset({ pool: p, ...ACTIVE }, a, i)],
  // /operations/work-orders
  ["readWorkOrder", "workOrder.record.read", "CAPABILITY_MISSING", wo("readWorkOrder")],
  ["markWorkOrderReady", "workOrder.lifecycle.ready", "CAPABILITY_MISSING", wo("markWorkOrderReady")],
  ["scheduleWorkOrder", "workOrder.lifecycle.schedule", "CAPABILITY_MISSING", wo("scheduleWorkOrder")],
  ["dispatchWorkOrder", "workOrder.lifecycle.dispatch", "CAPABILITY_MISSING", wo("dispatchWorkOrder")],
  ["acceptWorkOrder", "workOrder.transition", "CAPABILITY_MISSING", wo("acceptWorkOrder")],
  ["completeWorkOrder", "workOrder.lifecycle.complete", "CAPABILITY_MISSING", wo("completeWorkOrder")],
  ["closeWorkOrder", "workOrder.lifecycle.close", "CAPABILITY_MISSING", wo("closeWorkOrder")],
  ["cancelWorkOrder", "workOrder.lifecycle.cancel", "CAPABILITY_MISSING", wo("cancelWorkOrder")],
  ["recordWorkOrderExecution", "workOrder.execution.record", "CAPABILITY_MISSING", wo("recordWorkOrderExecution")],
]);

for (const [operation, capability, code, run] of OPERATIONS) {
  for (const [label, input] of INPUTS) {
    test(`${operation}: a caller without ${capability} is refused FORBIDDEN ${code} on ${label}, before validation`, async () => {
      const pool = fakePool();
      const err = await refusedWith(() => run(actorWith(), input, pool));
      assert.equal(err.category, "FORBIDDEN", `${operation}: ${err.code} ${err.message}`);
      assert.equal(err.code, code);
      // The only statements a refused caller may cause are the activation/baseline gate and the denial audit -- never a read of the input's target.
      const strays = pool.statements.filter((s) => !/inventory_baseline_cutovers|audit_events|protected|BEGIN|ROLLBACK|COMMIT/i.test(s));
      assert.deepEqual(strays, [], `${operation} touched the database for an unauthorized caller`);
    });
  }

  test(`${operation}: a caller holding ${capability} sending malformed input still gets the unchanged validation / precondition answer`, async () => {
    const err = await refusedWith(() => run(actorWith(capability), MALFORMED, fakePool()));
    // markReorderReceived is a closed door while receiving is active: its precondition answer is the unchanged one for a holder.
    const expected = operation === "markReorderReceived" ? "PRECONDITION_FAILED" : "INVALID_INPUT";
    assert.equal(err.category, expected, `${operation}: ${err.code} ${err.message}`);
    assert.notEqual(err.code, code, "the holder must not be answered with the authorization refusal");
  });
}

test("the work-order operations refuse an unauthorized caller without touching the database at all", async () => {
  for (const [operation, , , run] of OPERATIONS.filter(([name]) => /WorkOrder/.test(name))) {
    for (const [, input] of INPUTS) {
      const err = await refusedWith(() => run(actorWith(), input, throwingPool()));
      assert.equal(err.category, "FORBIDDEN", operation);
    }
  }
});

// ---- alternative keys: the key the input names still decides a holder of only the other one ----
test("reviewReorderRequest: a REJECT-only holder is refused an APPROVED decision, an APPROVE-only holder a REJECTED one, and both still validate bad input", async () => {
  const rejectOnly = actorWith("reorder.request.reject");
  const approveOnly = actorWith("reorder.request.approve");
  assert.equal((await refusedWith(() => reorder.reviewReorderRequest({ pool: fakePool() }, rejectOnly, { reorderRequestId: "r1", decision: "APPROVED" }))).code, "CAPABILITY_REQUIRED");
  assert.equal((await refusedWith(() => reorder.reviewReorderRequest({ pool: fakePool() }, approveOnly, { reorderRequestId: "r1", decision: "REJECTED" }))).code, "CAPABILITY_REQUIRED");
  assert.equal((await refusedWith(() => reorder.reviewReorderRequest({ pool: fakePool() }, rejectOnly, MALFORMED))).category, "INVALID_INPUT");
  assert.equal((await refusedWith(() => reorder.reviewReorderRequest({ pool: fakePool() }, actorWith(), { decision: "REJECTED" }))).message, "this command requires reorder.request.reject");
});

test("createPerformanceGoalDraft: a create-only holder cannot supersede, and a supersede-only holder still validates bad input", async () => {
  const createOnly = actorWith("performance.goal.create");
  const supersedeOnly = actorWith("performance.goal.supersede");
  assert.equal((await refusedWith(() => goals.createPerformanceGoalDraft({ pool: fakePool() }, createOnly, { supersedesGoalId: "g1", idempotencyKey: "k1" }))).code, "CAPABILITY_REQUIRED");
  assert.equal((await refusedWith(() => goals.createPerformanceGoalDraft({ pool: fakePool() }, supersedeOnly, MALFORMED))).category, "INVALID_INPUT");
});

// ---- the same ordering on the siblings that share each fix ----
test("sibling saved-report commands (rename, duplicate) and work-order edges (unschedule, technician runtime) refuse before validation too", async () => {
  for (const run of [
    () => reports.renameSavedReportDefinition({ pool: fakePool() }, actorWith(), MALFORMED),
    () => reports.duplicateSavedReportDefinition({ pool: fakePool() }, actorWith(), MALFORMED),
    () => wo("unscheduleWorkOrder")(actorWith(), MALFORMED, throwingPool()),
    () => wo("startWorkOrderTravel")(actorWith(), MALFORMED, throwingPool()),
    () => wo("arriveAtWorkOrder")(actorWith(), MALFORMED, throwingPool()),
    () => wo("startWorkOrderWork")(actorWith(), MALFORMED, throwingPool()),
  ]) assert.equal((await refusedWith(run)).category, "FORBIDDEN");
});

// ======================================== /admin/policy ========================================

async function adminWorld() {
  const repo = new InMemoryPolicyRepository();
  await repo.transact({ tenantId: TENANT, uid: "setup" }, async (tx) => { await tx.createTenant({ key: "a", name: "a" }); });
  const make = (subject) => repo.transact({ tenantId: TENANT, uid: "setup" }, async (tx) => {
    const principal = await tx.createPrincipal({ externalSubject: subject, identityProvider: "firebase" });
    await tx.createTenantMembership(principal.id);
    return principal;
  });
  const nobody = await make("subject-nobody");
  const holder = await make("subject-holder");
  const keys = ["admin.securityPolicy.write", "admin.roleAssignment.write", "workflowDefinition.create", "workflowDefinition.publish"];
  const caps = repo.registerCapabilities(keys.map((key) => ({
    key, description: key, objectKey: key.split(".")[0], actionKey: key.split(".")[2] ?? key.split(".")[1], actionKind: "BUSINESS_ACTION", displayLabel: key,
  })));
  await repo.transact({ tenantId: TENANT, uid: "setup" }, async (tx) => {
    for (const c of caps) await tx.grantPrincipalCapability({ principalId: holder.id, capabilityId: c.id, grantedBy: "setup", grantedAt: "2026-09-24T00:00:00.000Z" });
  });
  return { repo, nobody, holder };
}
const adminCall = (repo, subject, operation, input) =>
  executeAdminOperation({ repo }, { caller: { externalSubject: subject, identityProvider: "firebase" }, operation, input });

for (const operation of ["createRole", "assignRole", "grantCompanyAuthority", "createWorkflowDraft", "publishWorkflowVersion"]) {
  for (const [label, input] of INPUTS) {
    test(`/admin/policy ${operation}: a principal without the capability is refused FORBIDDEN on ${label}, before validation`, async () => {
      const { repo } = await adminWorld();
      const result = await adminCall(repo, "subject-nobody", operation, input);
      assert.equal(result.ok, false);
      assert.equal(result.code, "FORBIDDEN", `${operation}: ${result.message}`);
    });
  }
  test(`/admin/policy ${operation}: a holder sending empty input still gets INVALID_INPUT`, async () => {
    const { repo } = await adminWorld();
    const result = await adminCall(repo, "subject-holder", operation, EMPTY);
    assert.equal(result.ok, false);
    assert.equal(result.code, "INVALID_INPUT", `${operation}: ${result.message}`);
  });
}

// ======================================== the exemption family keeps ITS gate (security review of #2217) ========================================
//
// The self-approval exemption family is gated on the verified protected Owner (exemptionAdministration.requireGrantAuthority), NOT on admin.securityPolicy.write, which
// the Owner does not hold. The early authority gate must apply the same decision the command applies next, through every door: dispatch, preview and the mandatory-preview commit.
const core = require("../lib/access/secondaryApprovalExemptionCore.js");
const SELF_OBJ = "selfApprovalExemption";
const FAMILY_CAPS = [...core.SELF_APPROVAL_EXEMPT_KEY_LIST].map((key, i) => ({ id: `cap-fam-${i}`, key, objectKey: SELF_OBJ, actionKey: key.split(".").pop(), actionKind: "BUSINESS_ACTION" }));
const ADMIN_CAPS = [
  { id: "cap-sp", key: "admin.securityPolicy.write", objectKey: "rolesPermissions", actionKey: "write", actionKind: "BUSINESS_ACTION" },
  { id: "cap-ra", key: "admin.roleAssignment.write", objectKey: "roleAssignment", actionKey: "write", actionKind: "BUSINESS_ACTION" },
];
/** Three principals: the verified protected Owner (holds roleAssignment.write only), an Administrator (holds both), and a plain member who holds nothing. */
function gateRepo() {
  const roles = [{ id: "r-owner", key: "owner", protected: true }, { id: "r-admin", key: "admin", protected: true }, { id: "r-plain", key: "plain", protected: false }];
  const roleOf = { "p-owner": "r-owner", "p-admin": "r-admin", "p-plain": "r-plain" };
  const principals = { "sub-owner": "p-owner", "sub-admin": "p-admin", "sub-plain": "p-plain" };
  const grantsByRole = { "r-owner": ["cap-ra"], "r-admin": ["cap-sp", "cap-ra"], "r-plain": [] };
  return {
    getPrincipalBySubject: async (_idp, sub) => (principals[sub] ? { id: principals[sub], status: "active", externalSubject: sub } : null),
    getPrincipal: async (id) => ({ id, status: "active" }),
    listMembershipsForPrincipal: async (id) => [{ tenantId: TENANT, principalId: id, status: "active" }],
    getMembership: async () => ({ status: "active" }),
    getTenant: async () => ({ id: TENANT, status: "active" }),
    getLinkedEmployeeAccessFact: async () => ({ employeeId: "e-1", employmentStatus: "ACTIVE" }),
    listAssignmentsForPrincipal: async (_t, uid) => [{ id: `a-${uid}`, roleId: roleOf[uid], status: "active", scopeType: "global", accessVersionAtGrant: 1 }],
    getAccessVersion: async () => ({ accessVersion: 1 }),
    listRoles: async () => roles,
    listObjects: async () => [],
    listObjectPermissions: async () => [],
    listFieldOverrides: async () => [],
    listCapabilities: async () => [...FAMILY_CAPS, ...ADMIN_CAPS],
    listRoleCapabilities: async (_t, ids) => ids.flatMap((roleId) => (grantsByRole[roleId] ?? []).map((capabilityId) => ({ roleId, capabilityId }))),
    listPrincipalCapabilities: async () => [],
    listGrantConditions: async () => [],
    getObjectByKey: async () => ({ key: SELF_OBJ }),
    getRoleByKey: async () => roles[2],
    transact: async () => { throw new Error("the stub never opens a transaction"); },
  };
}
const FAMILY = { roleKey: "plain", objectKey: SELF_OBJ, actionKey: "exemptFinancials", reason: "Owner decision" };
const ORDINARY = { roleKey: "plain", objectKey: "workOrder", actionKey: "read", reason: "r" };
const DIGEST = "a".repeat(64);
const isGateDenial = (r) => r.ok === false && r.code === "FORBIDDEN";
const runAdmin = (repo, subject, operation, input, extra = {}) =>
  executeAdminOperation({ repo, ...extra }, { caller: { externalSubject: subject, identityProvider: "firebase" }, operation, input });

for (const [label, mandatory] of [["dispatch", false], ["commit under the mandatory preview", true]]) {
  // the committer stand-in runs the command against the repo the API handed it
  const doors = (repo) => (mandatory ? { previewMandatory: true, commitAuthorityChange: (req) => req.run(repo) } : {});
  const wrap = (i) => (mandatory ? { ...i, previewDigest: DIGEST } : i);

  test(`exemption family via ${label}: the verified protected Owner is NOT refused by the early gate (it reaches the store, which the stub then stops)`, async () => {
    for (const operation of ["grantObjectActionToRole", "revokeObjectActionFromRole"]) {
      const repo = gateRepo();
      const r = await runAdmin(repo, "sub-owner", operation, wrap(FAMILY), doors(repo));
      assert.equal(isGateDenial(r), false, `${operation}: ${r.code} ${r.message}`);
    }
  });

  test(`exemption family via ${label}: a non-Owner (with or without admin.securityPolicy.write) gets ExemptionAdministrationDenied, as on main`, async () => {
    for (const subject of ["sub-admin", "sub-plain"]) {
      const repo = gateRepo();
      const r = await runAdmin(repo, subject, "grantObjectActionToRole", wrap(FAMILY), doors(repo));
      assert.equal(r.code, "FORBIDDEN", subject);
      assert.match(r.message, /only the governed protected Owner/, `${subject}: ${r.message}`);
    }
  });

  test(`non-exemption authority change via ${label}: a non-holder gets the established capability refusal, the Owner (no securityPolicy.write) too, the Administrator passes`, async () => {
    for (const subject of ["sub-plain", "sub-owner"]) {
      const repo = gateRepo();
      const r = await runAdmin(repo, subject, "grantObjectActionToRole", wrap(ORDINARY), doors(repo));
      assert.equal(r.code, "FORBIDDEN", subject);
      assert.doesNotMatch(r.message, /only the governed protected Owner/);
    }
    const repo = gateRepo();
    assert.equal(isGateDenial(await runAdmin(repo, "sub-admin", "grantObjectActionToRole", wrap(ORDINARY), doors(repo))), false);
  });
}

test("exemption family via previewAuthorityChange: the protected Owner previews (the simulated command passes the early gate); a non-Owner is refused before any simulation", async () => {
  let ran = false;
  const simulator = (repo) => async (req) => {
    ran = true;
    try { await req.run(repo); return { outcome: "WOULD_APPLY", busy: false, report: {} }; } catch (err) { return { outcome: "WOULD_REFUSE", error: err, busy: false, report: {} }; }
  };
  const owner = gateRepo();
  const r = await runAdmin(owner, "sub-owner", "previewAuthorityChange", { change: { operation: "grantObjectActionToRole", input: FAMILY } }, { previewAuthorityChange: simulator(owner) });
  assert.equal(r.ok, true, `${r.code} ${r.message}`);
  assert.equal(ran, true);
  assert.doesNotMatch(String(r.data.refusal?.message ?? ""), /only the governed protected Owner|not authorized/, "the Owner is not refused by any gate");
  ran = false;
  const plain = gateRepo();
  const d = await runAdmin(plain, "sub-plain", "previewAuthorityChange", { change: { operation: "grantObjectActionToRole", input: FAMILY } }, { previewAuthorityChange: simulator(plain) });
  assert.equal(d.code, "FORBIDDEN");
  assert.equal(ran, false, "refused before any simulation");
});

test("assignment changes keep the plain capability gate whatever stray objectKey they carry (the Owner holds roleAssignment.write; a plain member does not)", async () => {
  const stray = { principalId: "p-x", roleId: "r-plain", reason: "r", objectKey: SELF_OBJ };
  const plain = await runAdmin(gateRepo(), "sub-plain", "assignRole", stray);
  assert.equal(plain.code, "FORBIDDEN");
  assert.doesNotMatch(plain.message, /only the governed protected Owner/);
  assert.equal(isGateDenial(await runAdmin(gateRepo(), "sub-owner", "assignRole", stray)), false);
});

// ======================================== readWorkOrder: a key held only as a conditioned or scoped grant still passes the early gate ========================================
test("readWorkOrder: a caller holding workOrder.record.read ONLY as a conditioned grant, or ONLY as a scoped grant, passes the early gate (the entitled decision then decides the record)", async () => {
  const base = { tenantId: TENANT, principalId: PRINCIPAL, capabilities: new Set(), entitlements: () => Promise.resolve([]) };
  const call = (operational) => EOS_WORK_ORDER_OPERATIONS.readWorkOrder({ pool: throwingPool(), reader: {} }, { actor: actorWith(), operational }, { bogus: true });
  // held NOWHERE: the early gate refuses
  assert.equal((await refusedWith(() => call({ ...base, conditionallyHeld: new Set(), scopedHeld: [] }))).code, "CAPABILITY_MISSING");
  // conditioned or scoped holders get past it: the answer is the unchanged validation refusal for the unknown field, not an authorization one
  for (const held of [
    { ...base, conditionallyHeld: new Set(["workOrder.record.read"]), scopedHeld: [] },
    { ...base, conditionallyHeld: new Set(), scopedHeld: [{ capabilityKey: "workOrder.record.read", scopeType: "operatingCompany", scopeValue: "taylor", sourceRole: "r", condition: null }] },
  ]) {
    const err = await refusedWith(() => call(held));
    assert.equal(err.code, "INPUT_FIELD_NOT_ACCEPTED");
    assert.equal(err.category, "INVALID_INPUT");
  }
});
