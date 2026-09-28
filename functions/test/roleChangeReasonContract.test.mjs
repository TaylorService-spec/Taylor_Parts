// THE HUMAN ROLE-CHANGE REASON CONTRACT (Pass 10 ruling, 2026-09-27).
//
// Human Administration API requests to assignRole / revokeRole must carry an explicit, non-empty business reason.
// A request id alone is NOT a reason: it stays request provenance, appended to a stated reason exactly as it is for
// every policy-editing operation. The rule is enforced at the Administration API boundary (the dispatcher asks the
// command for a stated reason, decided right after its capability gate, REASON_REQUIRED otherwise). The command's own
// reason stays optional for operator scripts and bootstrap, which call it directly with their own explicit reasons.
//
// Found by the Pass 10 archaeology: nonprod audit held four reason-less assignRole/revokeRole events.
import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryPolicyRepository } from "../lib/adminPolicy/inMemoryPolicyRepository.js";
import { executeAdminOperation } from "../lib/adminPolicy/adminPolicyApi.js";
import { assignRole, revokeRole } from "../lib/adminPolicy/policyCommands.js";
import { bootstrapAdministrator, bootstrapTenant, ensureTenantPrincipal } from "../lib/adminPolicy/tenantBootstrap.js";

const OPERATOR = "operator-reason";
const ADMIN_SUBJECT = "uid-reason-admin";
const CAPABILITIES = [
  { key: "admin.securityPolicy.write", description: "", objectKey: "rolesPermissions", actionKey: "editSecurityPolicy", actionKind: "ADMIN_ACTION", displayLabel: "Edit Security Policy" },
  { key: "admin.roleAssignment.write", description: "", objectKey: "rolesPermissions", actionKey: "assignRole", actionKind: "ADMIN_ACTION", displayLabel: "Assign Roles" },
];

async function world() {
  const repo = new InMemoryPolicyRepository();
  repo.registerCapabilities(CAPABILITIES);
  const { tenant } = await bootstrapTenant(repo, { key: "reason-contract", name: "Reason", actorUid: OPERATOR });
  const boot = await bootstrapAdministrator(repo, {
    tenantId: tenant.id, externalSubject: ADMIN_SUBJECT, performedBy: OPERATOR, reason: "initial administrator",
  });
  const made = await ensureTenantPrincipal(repo, {
    tenantId: tenant.id, externalSubject: "uid-reason-target", actorUid: OPERATOR, actorRoleKeys: ["admin"],
  });
  const targetId = made.principal?.id ?? made.id ?? made.principalId;
  const roleId = (await repo.getRoleByKey(tenant.id, "salesperson")).id;
  const call = (operation, input, requestId = undefined) =>
    executeAdminOperation({ repo }, { caller: { externalSubject: ADMIN_SUBJECT }, operation, input, requestId });
  const admin = { tenantId: tenant.id, uid: boot.principal.id, heldRoleKeys: ["admin"] };
  return { repo, tenantId: tenant.id, targetId, roleId, call, admin };
}

const audits = async (repo, tenantId) => repo.listAuditEvents(tenantId, 10000);
const activeAssignments = async (repo, tenantId, principalId) =>
  (await repo.listAssignmentsForPrincipal(tenantId, principalId)).filter((a) => a.status === "active");

const REFUSAL = (what) => new RegExp(`REASON_REQUIRED: ${what} requires a reason`);
const MISSING_REASONS = [
  ["missing", {}],
  ["null", { reason: null }],
  ["empty", { reason: "" }],
  ["whitespace-only", { reason: "   \t " }],
];

// ════════════════════ ASSIGN ROLE ════════════════════

test("assignRole via the Administration API: a stated reason proceeds, and the audit records it", async () => {
  const { repo, tenantId, targetId, roleId, call } = await world();
  const out = await call("assignRole", { principalId: targetId, roleId, reason: "TEST: staffing the sales desk" });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal((await activeAssignments(repo, tenantId, targetId)).length, 1);
  const ev = (await audits(repo, tenantId)).find((e) => e.action === "assignRole");
  assert.equal(ev.reason, "TEST: staffing the sales desk");
});

for (const [label, extra] of MISSING_REASONS) {
  test(`assignRole via the Administration API: a ${label} reason is REASON_REQUIRED, and nothing is written`, async () => {
    const { repo, tenantId, targetId, roleId, call } = await world();
    const before = (await audits(repo, tenantId)).length;
    const out = await call("assignRole", { principalId: targetId, roleId, ...extra });
    assert.deepEqual([out.ok, out.code], [false, "INVALID_INPUT"], JSON.stringify(out));
    assert.match(out.message, REFUSAL("assigning a Security Role"));
    assert.equal((await activeAssignments(repo, tenantId, targetId)).length, 0);
    assert.equal((await audits(repo, tenantId)).length, before, "a refusal writes no audit event");
  });
}

test("assignRole via the Administration API: a request id alone is NOT a reason", async () => {
  const { repo, tenantId, targetId, roleId, call } = await world();
  const out = await call("assignRole", { principalId: targetId, roleId }, "req-no-reason");
  assert.deepEqual([out.ok, out.code], [false, "INVALID_INPUT"], JSON.stringify(out));
  assert.match(out.message, REFUSAL("assigning a Security Role"));
  const blank = await call("assignRole", { principalId: targetId, roleId, reason: "  " }, "req-blank-reason");
  assert.match(blank.message, REFUSAL("assigning a Security Role"));
  assert.equal((await activeAssignments(repo, tenantId, targetId)).length, 0);
});

test("assignRole via the Administration API: request id + stated reason keeps the stated reason (id is provenance)", async () => {
  const { repo, tenantId, targetId, roleId, call } = await world();
  const out = await call("assignRole", { principalId: targetId, roleId, reason: "TEST: covering a leave" }, "req-with-reason");
  assert.equal(out.ok, true, JSON.stringify(out));
  const ev = (await audits(repo, tenantId)).find((e) => e.action === "assignRole");
  assert.equal(ev.reason, "TEST: covering a leave [request req-with-reason]");
});

test("the authority gate still decides FIRST: an unauthorized caller without a reason is FORBIDDEN, not REASON_REQUIRED", async () => {
  const { tenantId, targetId, roleId, repo } = await world();
  const stranger = await ensureTenantPrincipal(repo, {
    tenantId, externalSubject: "uid-reason-stranger", actorUid: OPERATOR, actorRoleKeys: ["admin"],
  });
  assert.ok(stranger);
  const out = await executeAdminOperation({ repo },
    { caller: { externalSubject: "uid-reason-stranger" }, operation: "assignRole", input: { principalId: targetId, roleId } });
  assert.deepEqual([out.ok, out.code], [false, "FORBIDDEN"], JSON.stringify(out));
});

// ════════════════════ REVOKE ROLE ════════════════════

async function assigned() {
  const w = await world();
  const made = await w.call("assignRole", { principalId: w.targetId, roleId: w.roleId, reason: "TEST: fixture assignment" });
  assert.equal(made.ok, true, JSON.stringify(made));
  return { ...w, assignmentId: made.data.id };
}

test("revokeRole via the Administration API: a stated reason proceeds, and the audit records it", async () => {
  const { repo, tenantId, targetId, assignmentId, call } = await assigned();
  const out = await call("revokeRole", { assignmentId, reason: "TEST: left the sales desk" });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal((await activeAssignments(repo, tenantId, targetId)).length, 0);
  const ev = (await audits(repo, tenantId)).find((e) => e.action === "revokeRole");
  assert.equal(ev.reason, "TEST: left the sales desk");
});

for (const [label, extra] of MISSING_REASONS) {
  test(`revokeRole via the Administration API: a ${label} reason is REASON_REQUIRED, and nothing is written`, async () => {
    const { repo, tenantId, targetId, assignmentId, call } = await assigned();
    const before = (await audits(repo, tenantId)).length;
    const out = await call("revokeRole", { assignmentId, ...extra });
    assert.deepEqual([out.ok, out.code], [false, "INVALID_INPUT"], JSON.stringify(out));
    assert.match(out.message, REFUSAL("removing a Security Role"));
    assert.equal((await activeAssignments(repo, tenantId, targetId)).length, 1, "the assignment is untouched");
    assert.equal((await audits(repo, tenantId)).length, before);
  });
}

test("revokeRole via the Administration API: a request id alone is NOT a reason", async () => {
  const { repo, tenantId, targetId, assignmentId, call } = await assigned();
  const out = await call("revokeRole", { assignmentId }, "req-no-reason");
  assert.deepEqual([out.ok, out.code], [false, "INVALID_INPUT"], JSON.stringify(out));
  assert.match(out.message, REFUSAL("removing a Security Role"));
  assert.equal((await activeAssignments(repo, tenantId, targetId)).length, 1);
});

test("revokeRole via the Administration API: request id + stated reason keeps the stated reason", async () => {
  const { repo, tenantId, assignmentId, call } = await assigned();
  const out = await call("revokeRole", { assignmentId, reason: "TEST: role ended" }, "req-revoke");
  assert.equal(out.ok, true, JSON.stringify(out));
  const ev = (await audits(repo, tenantId)).find((e) => e.action === "revokeRole");
  assert.equal(ev.reason, "TEST: role ended [request req-revoke]");
});

// ════════════════════ SYSTEM / BOOTSTRAP PATHS ARE UNCHANGED ════════════════════

test("direct command callers (operator scripts, bootstrap) are NOT coupled to the human API contract", async () => {
  const { repo, tenantId, targetId, roleId, admin } = await world();
  // The command's own reason stays optional: a direct caller that does not ask for a stated reason proceeds.
  const made = await assignRole(repo, admin, { principalId: targetId, roleId });
  assert.equal(made.status, "active");
  const revoked = await revokeRole(repo, admin, { assignmentId: made.id });
  assert.equal(revoked.status, "disabled");
  // ...and the explicit opt-in is exactly what the API sets.
  await assert.rejects(() => assignRole(repo, admin, { principalId: targetId, roleId, requireStatedReason: true }),
    REFUSAL("assigning a Security Role"));
});

test("tenant and administrator bootstrap still work with no Administration API reason in play", async () => {
  const { repo, tenantId } = await world();
  const admins = (await repo.listRoles(tenantId)).find((r) => r.key === "admin");
  assert.ok(admins, "bootstrapTenant seeded the Roles and bootstrapAdministrator staffed the first Administrator");
});
