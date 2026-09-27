// THE ADMINISTRATION CONTROL PLANE -- offline proofs (no database).
//
//   1. SYSTEM INVARIANTS and the PRECEDENCE RULE are pure and deterministic.
//   2. Tenant verification: a live row explained by ADMIN_GRANTED, or an absent default explained by
//      ADMIN_REVOKED, is NOT drift; a forbidden pair is ALWAYS drift.
//   3. The capability gate: security administration is authorized by admin.securityPolicy.write /
//      admin.roleAssignment.write -- never by the Role name -- and fails closed.
//   4. Each governed mutation writes exactly ONE audit event and ONE decision; a no-op writes none.
//   5. Conditions: validated by the evaluator's own catalog builder; never retired while the grant is
//      held (fail closed); never on an Administration capability.
//   6. The anti-lockout guard.
// The PostgreSQL half (acceptance cases A-D, the reconcile and the baseline) is
// administrationControlPlanePostgres.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { InMemoryPolicyRepository } from "../lib/adminPolicy/inMemoryPolicyRepository.js";
import { bootstrapTenant, bootstrapAdministrator, ensureTenantPrincipal } from "../lib/adminPolicy/tenantBootstrap.js";
import {
  ADMINISTRATION_BOOTSTRAP_GRANTS,
  SECURITY_ADMINISTRATION_CAPABILITY,
  hasSecurityAdministrationCapability,
} from "../lib/adminPolicy/administrationAuthority.js";
import * as commands from "../lib/adminPolicy/policyCommands.js";
import { executeAdminOperation } from "../lib/adminPolicy/adminPolicyApi.js";
import { OPERATIONAL_SCOPE_TYPES } from "../lib/eosWorkforce/operationalScopeVocabulary.js";
import {
  FORBIDDEN_ROLE_CAPABILITY_PAIRS,
  forbiddenPair,
  resolveCell,
  defaultWriterMayInsert,
  PLATFORM_SAFETY_INVARIANTS,
  CONDITION_OPERATIONAL_SCOPE_TYPES,
  conditionIsEvaluableFor,
  ownerPrincipalViolations,
  decisionIndex,
  verifyTenantAuthority,
} from "../lib/adminPolicy/roleCapabilityAdministration.js";
import {
  assertBaselineHonoursSystemInvariants,
  verifyLiveTenantAuthority,
  nonprodAuthorityGrants,
} from "../lib/adminPolicy/roleCapabilityAuthorityBaseline.js";

const OPERATOR = "operator-cp";
const ADMIN_SUBJECT = "uid-cp-admin";
const REASON = "control-plane proof";

const CAPABILITIES = [
  { key: "admin.securityPolicy.write", description: "", objectKey: "rolesPermissions", actionKey: "editSecurityPolicy", actionKind: "ADMIN_ACTION", displayLabel: "Edit Security Policy" },
  { key: "admin.roleAssignment.write", description: "", objectKey: "rolesPermissions", actionKey: "assignRole", actionKind: "ADMIN_ACTION", displayLabel: "Assign Role" },
  { key: "admin.securityPolicy.read", description: "", objectKey: "rolesPermissions", actionKey: "read", actionKind: "READ", displayLabel: "View Security Policy" },
  { key: "workOrder.record.read", description: "", objectKey: "workOrder", actionKey: "read", actionKind: "READ", displayLabel: "View Work Order" },
  { key: "workOrder.lifecycle.dispatch", description: "", objectKey: "workOrder", actionKey: "dispatch", actionKind: "BUSINESS_ACTION", displayLabel: "Dispatch Work Order" },
  { key: "salesAgreement.accept", description: "", objectKey: "salesAgreement", actionKey: "accept", actionKind: "BUSINESS_ACTION", displayLabel: "Accept" },
  { key: "reorder.purchaseOrder.read", description: "", objectKey: "purchaseOrder", actionKey: "read", actionKind: "READ", displayLabel: "View PO" },
  { key: "opportunity.createSalesOrder", description: "", objectKey: "opportunity", actionKey: "createSalesOrder", actionKind: "BUSINESS_ACTION", displayLabel: "Create Sales Order" },
];

/** A seeded, bootstrapped in-memory tenant with one administrator and one plain member. */
async function world() {
  const repo = new InMemoryPolicyRepository();
  repo.registerCapabilities(CAPABILITIES);
  const { tenant } = await bootstrapTenant(repo, { key: "cp-offline", name: "CP", actorUid: OPERATOR });
  const boot = await bootstrapAdministrator(repo, {
    tenantId: tenant.id, externalSubject: ADMIN_SUBJECT, performedBy: OPERATOR, reason: "initial administrator",
  });
  const plain = await ensureTenantPrincipal(repo, {
    tenantId: tenant.id, externalSubject: "uid-cp-plain", actorUid: OPERATOR, actorRoleKeys: ["admin"],
  });
  const plainId = plain.principal?.id ?? plain.id ?? plain.principalId;
  const admin = { tenantId: tenant.id, uid: boot.principal.id, heldRoleKeys: ["admin"] };
  const nobody = { tenantId: tenant.id, uid: plainId, heldRoleKeys: [] };
  const call = (operation, input, subject = ADMIN_SUBJECT) =>
    executeAdminOperation({ repo }, { caller: { externalSubject: subject }, operation, input, requestId: "req-1" });
  return { repo, tenantId: tenant.id, admin, nobody, plainId, call, boot };
}

const auditCount = async (repo, tenantId) => (await repo.listAuditEvents(tenantId, 10000)).length;

// ════════════════════ 1. invariants and precedence ════════════════════

test("the system invariants: OWNER_GOVERNANCE pairs + PLATFORM_SAFETY rules, nothing else immutable", () => {
  // Pass 8 Owner rule: only PLATFORM_SAFETY and OWNER_GOVERNANCE may be immutable. 19 ruling-A keys +
  // reorder.request.assign; the superseded queue key and the technician PO cells are NOT immutable.
  assert.equal(FORBIDDEN_ROLE_CAPABILITY_PAIRS.length, 20);
  assert.ok(FORBIDDEN_ROLE_CAPABILITY_PAIRS.every((p) => p.roleKey === "owner" && p.invariantClass === "OWNER_GOVERNANCE"));
  assert.ok(forbiddenPair("owner", "salesAgreement.accept"), "ruling A: maker/checker");
  assert.ok(forbiddenPair("owner", "reorder.request.assign"), "coordination, not oversight");
  assert.equal(forbiddenPair("owner", "reorder.request.read.queue"), null, "LEGACY_BASELINE_ARTIFACT -- not immutable");
  assert.equal(forbiddenPair("technician", "reorder.purchaseOrder.read"), null, "LEGACY_BASELINE_ARTIFACT -- the ruling withholds CONDITION activation");
  assert.equal(conditionIsEvaluableFor("reorder.purchaseOrder.read"), false, "...which the condition allow-list preserves");
  assert.deepEqual(PLATFORM_SAFETY_INVARIANTS.map((i) => i.key),
    ["ANTI_LOCKOUT", "ADMIN_NOT_CONDITIONABLE", "NEVER_WIDEN_ON_RETIRE", "APPEND_ONLY_AUDIT"]);
  assert.deepEqual([...CONDITION_OPERATIONAL_SCOPE_TYPES], [...OPERATIONAL_SCOPE_TYPES], "restated scope vocabulary equals the Workforce one");
  assert.equal(forbiddenPair("admin", "salesAgreement.accept"), null);
  assert.equal(forbiddenPair("technician", "workOrder.record.read"), null);
  assert.doesNotThrow(() => assertBaselineHonoursSystemInvariants());
  assert.throws(() => assertBaselineHonoursSystemInvariants([{ roleKey: "owner", capabilityKey: "equipment.install" }]),
    /SYSTEM INVARIANT forbids: owner\/equipment\.install/);
});

test("THE PRECEDENCE RULE: SYSTEM_INVARIANT > current ADMIN decision > SYSTEM_DEFAULT", () => {
  const cell = (roleKey, capabilityKey, decision, isSystemDefault) => resolveCell({ roleKey, capabilityKey, decision, isSystemDefault });
  // Invariant beats an admin grant and a default.
  assert.deepEqual(cell("owner", "equipment.install", "ADMIN_GRANTED", true), { shouldHold: false, source: "SYSTEM_INVARIANT" });
  // Admin decisions beat the default, in both directions.
  assert.deepEqual(cell("dispatcher", "opportunity.write", "ADMIN_REVOKED", true), { shouldHold: false, source: "ADMIN_REVOKED" });
  assert.deepEqual(cell("salesManager", "salesAgreement.accept", "ADMIN_GRANTED", false), { shouldHold: true, source: "ADMIN_GRANTED" });
  // No decision: the default stands.
  assert.deepEqual(cell("dispatcher", "opportunity.write", null, true), { shouldHold: true, source: "SYSTEM_DEFAULT" });
  assert.deepEqual(cell("dispatcher", "opportunity.write", null, false), { shouldHold: false, source: "NONE" });
  // A default writer never inserts over a revoke or a forbidden pair.
  const decisions = decisionIndex([{ roleKey: "dispatcher", capabilityKey: "salesAgreement.accept", decision: "ADMIN_REVOKED" }]);
  assert.deepEqual(defaultWriterMayInsert(decisions, "dispatcher", "salesAgreement.accept"), { allowed: false, source: "ADMIN_REVOKED" });
  assert.deepEqual(defaultWriterMayInsert(decisions, "owner", "salesAgreement.accept"), { allowed: false, source: "SYSTEM_INVARIANT" });
  assert.deepEqual(defaultWriterMayInsert(decisions, "admin", "salesAgreement.accept"), { allowed: true, source: "SYSTEM_DEFAULT" });
  assert.throws(() => decisionIndex([
    { roleKey: "a", capabilityKey: "x", decision: "ADMIN_GRANTED" }, { roleKey: "a", capabilityKey: "x", decision: "ADMIN_REVOKED" },
  ]), /two current Administration decisions/);
});

test("verification: decisions explain; forbidden, unexplained and self-contradicting state is drift", () => {
  const systemDefault = [
    { roleKey: "dispatcher", capabilityKey: "opportunity.write" },
    { roleKey: "dispatcher", capabilityKey: "workOrder.transition" },
    { roleKey: "admin", capabilityKey: "x.y" },
  ];
  const live = [
    { roleKey: "dispatcher", capabilityKey: "workOrder.transition" },
    { roleKey: "admin", capabilityKey: "x.y" },
    { roleKey: "salesManager", capabilityKey: "salesAgreement.accept" },
  ];
  const clean = verifyTenantAuthority({ systemDefault, live, decisions: [
    { roleKey: "dispatcher", capabilityKey: "opportunity.write", decision: "ADMIN_REVOKED" },
    { roleKey: "salesManager", capabilityKey: "salesAgreement.accept", decision: "ADMIN_GRANTED" },
  ] });
  assert.deepEqual(clean.drift, [], "an Administration-explained tenant is NOT drift");
  assert.deepEqual(clean.explainedByAdminRevoke, [{ roleKey: "dispatcher", capabilityKey: "opportunity.write" }]);
  assert.deepEqual(clean.explainedByAdminGrant, [{ roleKey: "salesManager", capabilityKey: "salesAgreement.accept" }]);

  // Without the decisions, the SAME live state is drift in both directions (AN2 unchanged).
  const bare = verifyTenantAuthority({ systemDefault, live, decisions: [] });
  assert.deepEqual(bare.drift.map((d) => d.kind).sort(), ["MISSING_DEFAULT", "UNEXPLAINED_EXTRA"]);

  // A forbidden pair is drift whatever a decision says, and a decision the store contradicts is drift.
  const bad = verifyTenantAuthority({
    systemDefault,
    live: [...live, { roleKey: "owner", capabilityKey: "equipment.install" }, { roleKey: "dispatcher", capabilityKey: "opportunity.write" }],
    decisions: [
      { roleKey: "owner", capabilityKey: "equipment.install", decision: "ADMIN_GRANTED" },
      { roleKey: "dispatcher", capabilityKey: "opportunity.write", decision: "ADMIN_REVOKED" },
      { roleKey: "officeManager", capabilityKey: "workOrder.record.read", decision: "ADMIN_GRANTED" },
    ],
  });
  assert.deepEqual(bad.drift.map((d) => `${d.kind}:${d.roleKey}/${d.capabilityKey}`).sort(), [
    "ADMIN_GRANTED_MISSING:officeManager/workOrder.record.read",
    "ADMIN_REVOKED_PRESENT:dispatcher/opportunity.write",
    "FORBIDDEN_PRESENT:owner/equipment.install",
    "UNEXPLAINED_EXTRA:salesManager/salesAgreement.accept",
  ]);

  // The environment-level wrapper uses the repository baseline as the default.
  const baseline = nonprodAuthorityGrants();
  const whole = verifyLiveTenantAuthority({ live: baseline, decisions: [], environment: "nonprod" });
  assert.deepEqual(whole.drift, [], "the nonprod baseline verifies against itself");
});

// ════════════════════ 2. the capability gate ════════════════════

test("the gate is the CAPABILITY, never the Role name, and it fails closed", async () => {
  assert.deepEqual({ ...SECURITY_ADMINISTRATION_CAPABILITY },
    { editSecurityPolicy: "admin.securityPolicy.write", assignRole: "admin.roleAssignment.write" });
  assert.equal(hasSecurityAdministrationCapability(null, "assignRole"), false);
  assert.equal(hasSecurityAdministrationCapability(["admin.roleAssignment.write"], "assignRole"), false, "an array is not a resolved Set");
  assert.equal(hasSecurityAdministrationCapability(new Set(["admin.roleAssignment.write"]), "assignRole"), true);
  // Definition = admin; assignment = admin + owner. generalManager is DELIBERATELY absent: the
  // 2026-08-21 Owner ruling (generalManagerNoAdmin) conflicts with the old Role-name invariant, and
  // the conflict is reported, not resolved in code.
  assert.deepEqual(ADMINISTRATION_BOOTSTRAP_GRANTS.map((g) => `${g.roleKey}/${g.capabilityKey}`), [
    "admin/admin.securityPolicy.write", "admin/admin.roleAssignment.write", "owner/admin.roleAssignment.write",
    // Owner ruling R1 (2026-09-26): Owner staffs the designated Administrator Role (administratorStaffingPostgres).
    "owner/admin.administratorRole.assign",
  ]);

  const { repo, tenantId, admin, nobody } = await world();
  const input = { objectKey: "workOrder", actionKey: "dispatch", roleKey: "dispatcher", reason: REASON };
  // A caller claiming the Role NAME `admin` but whose effective set lacks the capability is refused.
  await assert.rejects(() => commands.grantObjectActionToRole(repo, { ...admin, capabilities: new Set() }, input),
    /"admin\.securityPolicy\.write" is required/);
  await assert.rejects(() => commands.grantObjectActionToRole(repo, nobody, input), /"admin\.securityPolicy\.write" is required/);
  await assert.rejects(() => commands.setGrantCondition(repo, nobody, { ...input, condition: {} }), /"admin\.securityPolicy\.write" is required/);
  await assert.rejects(() => commands.retireGrantCondition(repo, nobody, input), /"admin\.securityPolicy\.write" is required/);
  await assert.rejects(() => commands.assignRole(repo, nobody, { principalId: admin.uid, roleId: "x" }), /"admin\.roleAssignment\.write" is required/);
  // ...and a principal holding NO admin Role but a custom Role carrying the capability is admitted.
  const clerk = await commands.createRole(repo, admin, { key: "securityClerk", name: "Security Clerk" });
  await commands.grantObjectActionToRole(repo, admin, { objectKey: "rolesPermissions", actionKey: "editSecurityPolicy", roleKey: "securityClerk", reason: REASON });
  const clerkActor = { tenantId, uid: "uid-clerk", heldRoleKeys: ["securityClerk"] };
  const granted = await commands.grantObjectActionToRole(repo, clerkActor, input);
  assert.ok(granted.id, "the capability, held through a non-admin Role, authorizes");
  assert.ok(clerk.id);
});

// ════════════════════ 3. audit and decisions ════════════════════

test("grant and revoke: ONE audit event + ONE decision each; a no-op writes neither; reason is required", async () => {
  const { repo, tenantId, admin } = await world();
  const input = { objectKey: "workOrder", actionKey: "dispatch", roleKey: "dispatcher" };
  await assert.rejects(() => commands.grantObjectActionToRole(repo, admin, input), /REASON_REQUIRED/);
  await assert.rejects(() => commands.grantObjectActionToRole(repo, admin, { ...input, reason: "   " }), /REASON_REQUIRED/);

  let before = await auditCount(repo, tenantId);
  await commands.grantObjectActionToRole(repo, admin, { ...input, reason: REASON });
  assert.equal(await auditCount(repo, tenantId) - before, 1, "exactly one audit event");
  let decisions = await repo.listRoleCapabilityDecisions(tenantId, { currentOnly: false });
  assert.equal(decisions.length, 1);
  const [event] = (await repo.listAuditEvents(tenantId, 1));
  assert.equal(decisions[0].auditEventId, event.id, "the decision names its audit event");
  assert.equal(decisions[0].decision, "ADMIN_GRANTED");
  assert.equal(event.before.held, false);
  assert.equal(event.after.held, true);
  assert.equal(event.after.decision, "ADMIN_GRANTED");
  assert.equal(event.reason, REASON);
  assert.equal(event.actorUid, admin.uid);

  before = await auditCount(repo, tenantId);
  await commands.grantObjectActionToRole(repo, admin, { ...input, reason: REASON });
  assert.equal(await auditCount(repo, tenantId) - before, 0, "an identical re-grant is not a mutation");

  await commands.revokeObjectActionFromRole(repo, admin, { ...input, reason: "withdrawn" });
  assert.equal(await auditCount(repo, tenantId) - before, 1);
  decisions = await repo.listRoleCapabilityDecisions(tenantId, { currentOnly: false });
  assert.equal(decisions.length, 2, "history is kept");
  assert.equal(decisions.filter((d) => d.supersededAt === null).length, 1, "one CURRENT decision per cell");
  assert.equal(decisions.find((d) => d.supersededAt === null).decision, "ADMIN_REVOKED");
  assert.equal(decisions.find((d) => d.supersededAt !== null).supersededBy, decisions.find((d) => d.supersededAt === null).id);

  before = await auditCount(repo, tenantId);
  assert.equal(await commands.revokeObjectActionFromRole(repo, admin, { ...input, reason: "again" }), null);
  assert.equal(await auditCount(repo, tenantId) - before, 0, "revoking what is not held is a no-op");
});

test("a SYSTEM INVARIANT pair is refused, and so is a capability that does not exist", async () => {
  const { repo, tenantId, admin } = await world();
  const before = await auditCount(repo, tenantId);
  await assert.rejects(() => commands.grantObjectActionToRole(repo, admin,
    { objectKey: "salesAgreement", actionKey: "accept", roleKey: "owner", reason: REASON }), /SYSTEM_INVARIANT: owner may never hold salesAgreement\.accept/);
  await assert.rejects(() => commands.grantObjectActionToRole(repo, admin,
    { objectKey: "workOrder", actionKey: "frobnicate", roleKey: "dispatcher", reason: REASON }), /no governed action/);
  assert.equal(await auditCount(repo, tenantId), before, "a refusal writes nothing");
});

// ════════════════════ 4. conditions ════════════════════

const ASSIGNED = { paths: [[{ kind: "RECORD_ASSIGNMENT", relation: "ASSIGNED_EMPLOYEE" }]], recordKind: "workOrder" };

test("conditions: validated like the runtime reads them; retiring one while the grant is held is REFUSED", async () => {
  const { repo, tenantId, admin, call } = await world();
  const cell = { objectKey: "workOrder", actionKey: "read", roleKey: "technician" };
  // Only the evaluator's governed shapes are storable.
  for (const bad of [{ paths: [] }, { paths: [[]] }, { paths: [[{ kind: "SELF" }]] }, { paths: [[{ kind: "TEAM" }]] },
    { paths: [[{ kind: "RECORD_ASSIGNMENT", relation: "ASSIGNED_EMPLOYEE" }]], recordKind: "anything" }, "ALL", null]) {
    await assert.rejects(() => commands.setGrantCondition(repo, admin, { ...cell, condition: bad, reason: REASON }), /CONDITION_INVALID/,
      JSON.stringify(bad));
  }
  // Administration capabilities cannot be conditioned -- their gate reads the flat set.
  await assert.rejects(() => commands.setGrantCondition(repo, admin,
    { objectKey: "rolesPermissions", actionKey: "assignRole", roleKey: "owner", condition: ASSIGNED, reason: REASON }), /CONDITION_NOT_SUPPORTED/);
  // THE ALLOW-LIST (Pass 8 D1): a capability a flat gate reads may not carry a condition at all.
  await assert.rejects(() => commands.setGrantCondition(repo, admin,
    { objectKey: "salesAgreement", actionKey: "accept", roleKey: "salesManager", reason: REASON,
      condition: { paths: [[{ kind: "WORK_ELIGIBILITY", qualificationCode: "SERVICE_TECHNICIAN" }]] } }), /CONDITION_NOT_SUPPORTED/);
  // Governed parameters only.
  await assert.rejects(() => commands.setGrantCondition(repo, admin, { ...cell, reason: REASON,
    condition: { paths: [[{ kind: "WORK_ELIGIBILITY", qualificationCode: "NO_SUCH_QUALIFICATION" }]] } }), /CONDITION_INVALID/);
  await assert.rejects(() => commands.setGrantCondition(repo, admin, { ...cell, reason: REASON,
    condition: { paths: [[{ kind: "OPERATIONAL_SCOPE", scopeType: "GALAXY" }]] } }), /CONDITION_INVALID/);

  // Grant WITH the condition in one transaction: one audit event, a requiresCondition decision.
  let before = await auditCount(repo, tenantId);
  await commands.grantObjectActionToRole(repo, admin, { ...cell, condition: ASSIGNED, requiresCondition: true, reason: REASON });
  assert.equal(await auditCount(repo, tenantId) - before, 1);
  const [condition] = await repo.listGrantConditions(tenantId);
  assert.deepEqual(condition.condition, ASSIGNED);
  assert.equal((await repo.listRoleCapabilityDecisions(tenantId))[0].requiresCondition, true);

  // requiresCondition with no condition anywhere is refused.
  await assert.rejects(() => commands.grantObjectActionToRole(repo, admin,
    { objectKey: "workOrder", actionKey: "dispatch", roleKey: "technician", requiresCondition: true, reason: REASON }), /CONDITION_REQUIRED/);

  // FAIL CLOSED: retire refused while held -- through the command, the API (409) and the store.
  await assert.rejects(() => commands.retireGrantCondition(repo, admin, { ...cell, reason: REASON }), /CONDITION_RETIREMENT_WOULD_WIDEN/);
  const refused = await call("retireGrantCondition", { ...cell, reason: REASON });
  assert.deepEqual([refused.ok, refused.code], [false, "CONFLICT"]);
  await assert.rejects(() => repo.transact({ tenantId, uid: "raw" }, (tx) => tx.retireGrantCondition("ROLE", "technician", "workOrder.record.read")),
    /CONDITION_RETIREMENT_WOULD_WIDEN/);
  assert.equal((await repo.listGrantConditions(tenantId)).length, 1, "still ACTIVE");

  // Revoke first -> the condition stays ACTIVE and inert; now retire is allowed and audited once.
  await commands.revokeObjectActionFromRole(repo, admin, { ...cell, reason: REASON });
  assert.equal((await repo.listGrantConditions(tenantId)).length, 1, "a revoke never lifts a condition");
  before = await auditCount(repo, tenantId);
  const retired = await commands.retireGrantCondition(repo, admin, { ...cell, reason: REASON });
  assert.equal(retired.status, "RETIRED");
  assert.equal(await auditCount(repo, tenantId) - before, 1);
  assert.equal((await repo.listGrantConditions(tenantId)).length, 0);
  assert.equal((await repo.listGrantConditions(tenantId, { activeOnly: false })).length, 1, "RETIRED rows are kept as evidence");
});

test("a condition on an existing HELD grant narrows it and is audited with before/after", async () => {
  const { repo, tenantId, admin } = await world();
  const cell = { objectKey: "workOrder", actionKey: "read", roleKey: "technician" };
  await commands.grantObjectActionToRole(repo, admin, { ...cell, reason: REASON });
  const before = await auditCount(repo, tenantId);
  await commands.setGrantCondition(repo, admin, { ...cell, condition: ASSIGNED, reason: REASON });
  await commands.setGrantCondition(repo, admin, { ...cell, condition: ASSIGNED, reason: REASON }); // identical: no-op
  assert.equal(await auditCount(repo, tenantId) - before, 1);
  const [event] = await repo.listAuditEvents(tenantId, 1);
  assert.equal(event.action, "setGrantCondition");
  assert.equal(event.before, null);
  assert.deepEqual(event.after.condition, ASSIGNED);
});

// ════════════════════ 5. anti-lockout ════════════════════

test("the last path to a governing Administration capability is never removed", async () => {
  const { repo, tenantId, admin, boot } = await world();
  await assert.rejects(() => commands.revokeObjectActionFromRole(repo, admin,
    { objectKey: "rolesPermissions", actionKey: "editSecurityPolicy", roleKey: "admin", reason: REASON }),
  /WOULD_REMOVE_LAST_ADMINISTRATION_PATH/);
  // The last admin ASSIGNMENT is refused by the (older) protected-Role guard, which still stands.
  await assert.rejects(() => commands.revokeRole(repo, admin, { assignmentId: boot.assignmentId }), /last active administering assignment/);
  // With a SECOND holder of the capability (a direct grant), the Role grant may go.
  const second = await ensureTenantPrincipal(repo, { tenantId, externalSubject: "uid-cp-second", actorUid: OPERATOR, actorRoleKeys: ["admin"] });
  const secondId = second.principal?.id ?? second.id ?? second.principalId;
  await commands.grantObjectActionToPrincipal(repo, admin, { objectKey: "rolesPermissions", actionKey: "editSecurityPolicy", principalId: secondId, reason: "governed direct exception (fixture)" });
  await commands.revokeObjectActionFromRole(repo, admin,
    { objectKey: "rolesPermissions", actionKey: "editSecurityPolicy", roleKey: "admin", reason: REASON });
  // The admin Role no longer carries it, so the admin principal is now REFUSED -- the Role name
  // authorizes nothing. The second principal administers through its direct grant...
  await assert.rejects(() => commands.revokeObjectActionFromPrincipal(repo, admin,
    { objectKey: "rolesPermissions", actionKey: "editSecurityPolicy", principalId: secondId, reason: REASON }), /"admin\.securityPolicy\.write" is required/);
  const secondActor = { tenantId, uid: secondId, heldRoleKeys: [] };
  // ...and that direct grant is now the last path, so IT is protected.
  await assert.rejects(() => commands.revokeObjectActionFromPrincipal(repo, secondActor,
    { objectKey: "rolesPermissions", actionKey: "editSecurityPolicy", principalId: secondId, reason: REASON }), /WOULD_REMOVE_LAST_ADMINISTRATION_PATH/);
});

// ════════════════════ 6. the API surface ════════════════════

test("the control-plane reads show source, condition and holders; direct grants are DIRECT_EXCEPTION", async () => {
  const { repo, tenantId, admin, plainId, call } = await world();
  // The read gate is admin.securityPolicy.read, like every other security-policy read. Held by the admin
  // Role as a SYSTEM DEFAULT here (a fixture row): an administrator may not grant a Role it holds.
  const adminRole = await repo.getRoleByKey(tenantId, "admin");
  const readCap = (await repo.listCapabilities()).find((c) => c.key === "admin.securityPolicy.read");
  await repo.transact({ tenantId, uid: "migration:x" }, (tx) => tx.grantRoleCapability({ roleId: adminRole.id, capabilityId: readCap.id, grantedBy: "migration:x", grantedAt: new Date().toISOString() }));
  await commands.grantObjectActionToRole(repo, admin, { objectKey: "workOrder", actionKey: "read", roleKey: "technician", condition: ASSIGNED, reason: REASON });
  await commands.grantObjectActionToPrincipal(repo, admin, { objectKey: "workOrder", actionKey: "read", principalId: plainId, reason: "governed direct exception (fixture)" });
  // A pre-existing default grant (no decision) reads as SYSTEM_DEFAULT.
  const dispatcher = await repo.getRoleByKey(tenantId, "dispatcher");
  const dispatch = (await repo.listCapabilities()).find((c) => c.key === "workOrder.lifecycle.dispatch");
  await repo.transact({ tenantId, uid: "migration:x" }, (tx) => tx.grantRoleCapability({ roleId: dispatcher.id, capabilityId: dispatch.id, grantedBy: "migration:x", grantedAt: new Date().toISOString() }));

  const matrix = await call("getObjectActionGrantMatrix", { objectKey: "workOrder" });
  assert.equal(matrix.ok, true, JSON.stringify(matrix));
  const read = matrix.data.actions.find((a) => a.actionKey === "read");
  assert.deepEqual(read.roles, [{ roleKey: "technician", held: true, source: "ADMIN_GRANTED", condition: ASSIGNED }]);
  assert.deepEqual(read.principals.map((p) => [p.principalId, p.source]), [[plainId, "DIRECT_EXCEPTION"]]);
  // Owner appears as SYSTEM_INVARIANT: the five-row lifecycle ruling excludes it, so the UI renders
  // that cell as not grantable rather than as an empty checkbox.
  assert.deepEqual(matrix.data.actions.find((a) => a.actionKey === "dispatch").roles, [
    { roleKey: "dispatcher", held: true, source: "SYSTEM_DEFAULT", condition: null },
    { roleKey: "owner", held: false, source: "SYSTEM_INVARIANT", condition: null },
  ]);

  const detail = await call("getSecurityRoleDetail", { roleKey: "admin" });
  assert.equal(detail.ok, true);
  assert.deepEqual(detail.data.holders.map((h) => h.principalId), [admin.uid]);
  const editRow = detail.data.actions.find((a) => a.capabilityKey === "admin.securityPolicy.write");
  assert.equal(editRow.held, true);
  assert.equal(editRow.source, "SYSTEM_DEFAULT", "bootstrap grants are system defaults, not decisions");

  const history = await call("listRoleCapabilityDecisionHistory", { roleKey: "technician" });
  assert.equal(history.ok, true);
  assert.equal(history.data.length, 1);

  // A mutation through the API: the reason must be STATED; the request id alone is not one.
  const noReason = await call("grantObjectActionToRole", { objectKey: "workOrder", actionKey: "dispatch", roleKey: "technician" });
  assert.deepEqual([noReason.ok, noReason.code], [false, "INVALID_INPUT"]);
  const withReason = await call("grantObjectActionToRole", { objectKey: "workOrder", actionKey: "dispatch", roleKey: "technician", reason: "ruling" });
  assert.equal(withReason.ok, true);
  const [event] = await repo.listAuditEvents(tenantId, 1);
  assert.equal(event.reason, "ruling [request req-1]");
  // An unauthorized principal is FORBIDDEN on every control-plane mutation.
  for (const operation of ["grantObjectActionToRole", "revokeObjectActionFromRole", "setGrantCondition", "retireGrantCondition"]) {
    const res = await call(operation, { objectKey: "workOrder", actionKey: "dispatch", roleKey: "technician", condition: ASSIGNED, reason: "x" }, "uid-cp-plain");
    assert.deepEqual([res.ok, res.code], [false, "FORBIDDEN"], operation);
  }
});

test("no Firebase and no Role-name authorization in the control-plane modules", () => {
  for (const file of ["src/adminPolicy/roleCapabilityAdministration.ts", "src/adminPolicy/administrationCapabilityGate.ts"]) {
    const code = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const forbidden of [/firebase/i, /firestore/i, /customClaims/, /\bSELECT\b|\bINSERT\b/]) assert.doesNotMatch(code, forbidden, file);
  }
  const gate = readFileSync("src/adminPolicy/administrationCapabilityGate.ts", "utf8").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(gate, /["']admin["']|["']owner["']|["']generalManager["']/, "the gate names no Role");
  const commandsSource = readFileSync("src/adminPolicy/policyCommands.ts", "utf8");
  for (const fn of ["grantObjectActionToRole", "revokeObjectActionFromRole", "setGrantCondition", "retireGrantCondition",
    "grantObjectActionToPrincipal", "revokeObjectActionFromPrincipal", "assignRole", "revokeRole"]) {
    const start = commandsSource.indexOf(`export async function ${fn}(`);
    const body = commandsSource.slice(start, commandsSource.indexOf("\n}\n", start));
    assert.match(body, /requireSecurityAdministrationCapability\(/, `${fn} is capability-gated`);
    assert.doesNotMatch(body, /requireAdministrationAuthority\(/, `${fn} still checks a Role name`);
  }
});

// ════════════════════ 7. Pass 8 review regressions (offline half) ════════════════════

test("D5 Owner escalation: no self-administration; Owner cannot confer security-policy authority; ruling A at the PRINCIPAL", async () => {
  const { repo, tenantId, admin, plainId } = await world();
  const ownerRole = await repo.getRoleByKey(tenantId, "owner");
  const adminRole = await repo.getRoleByKey(tenantId, "admin");
  // An Owner principal, staffed by the administrator.
  const ownerMade = await ensureTenantPrincipal(repo, { tenantId, externalSubject: "uid-cp-owner", actorUid: OPERATOR, actorRoleKeys: ["admin"] });
  const ownerId = ownerMade.principal?.id ?? ownerMade.id ?? ownerMade.principalId;
  await commands.assignRole(repo, admin, { principalId: ownerId, roleId: ownerRole.id, reason: REASON });
  const ownerActor = { tenantId, uid: ownerId, heldRoleKeys: ["owner"] };

  // (a) self-assignment of ANY Role, and a direct self-grant, are refused.
  await assert.rejects(() => commands.assignRole(repo, ownerActor, { principalId: ownerId, roleId: adminRole.id, reason: REASON }), /SELF_ADMINISTRATION/);
  await assert.rejects(() => commands.assignRole(repo, admin, { principalId: admin.uid, roleId: ownerRole.id, reason: REASON }), /SELF_ADMINISTRATION/);
  await assert.rejects(() => commands.grantObjectActionToPrincipal(repo, admin,
    { objectKey: "workOrder", actionKey: "read", principalId: admin.uid, reason: REASON }), /SELF_ADMINISTRATION/);
  // ...and so is widening a Role the actor holds.
  await assert.rejects(() => commands.grantObjectActionToRole(repo, admin,
    { objectKey: "workOrder", actionKey: "read", roleKey: "admin", reason: REASON }), /SELF_ADMINISTRATION/);
  // (b) Owner (admin.roleAssignment.write only) may not assign a Role conferring admin.securityPolicy.write.
  await assert.rejects(() => commands.assignRole(repo, ownerActor, { principalId: plainId, roleId: adminRole.id, reason: REASON }), /PRIVILEGE_ESCALATION/);
  // (c) ruling A at the principal: an owner holder may not reach an excluded key by a custom Role...
  await commands.createRole(repo, admin, { key: "acceptDesk", name: "Accept Desk" });
  const desk = await repo.getRoleByKey(tenantId, "acceptDesk");
  await commands.grantObjectActionToRole(repo, admin, { objectKey: "salesAgreement", actionKey: "accept", roleKey: "acceptDesk", reason: REASON });
  await assert.rejects(() => commands.assignRole(repo, admin, { principalId: ownerId, roleId: desk.id, reason: REASON }), /SYSTEM_INVARIANT/);
  // ...nor by a direct grant...
  await assert.rejects(() => commands.grantObjectActionToPrincipal(repo, admin,
    { objectKey: "salesAgreement", actionKey: "accept", principalId: ownerId, reason: REASON }), /SYSTEM_INVARIANT/);
  // ...nor by widening a Role an owner holder already holds.
  await commands.createRole(repo, admin, { key: "ownerDesk", name: "Owner Desk" });
  const ownerDesk = await repo.getRoleByKey(tenantId, "ownerDesk");
  await commands.assignRole(repo, admin, { principalId: ownerId, roleId: ownerDesk.id, reason: REASON });
  await assert.rejects(() => commands.grantObjectActionToRole(repo, admin,
    { objectKey: "salesAgreement", actionKey: "accept", roleKey: "ownerDesk", reason: REASON }), /SYSTEM_INVARIANT/);
  // The drift report sees a principal-level holding written behind Administration's back.
  const v = verifyTenantAuthority({ systemDefault: [], live: [{ roleKey: "acceptDesk", capabilityKey: "salesAgreement.accept" }],
    decisions: [], principals: [{ principalId: ownerId, roleKeys: ["owner", "acceptDesk"], directCapabilityKeys: [] }] });
  assert.deepEqual(v.forbiddenPrincipalHoldings, [{ principalId: ownerId, capabilityKey: "salesAgreement.accept" }]);
  assert.ok(v.drift.some((d) => d.kind === "FORBIDDEN_PRINCIPAL_HOLDING"));
  assert.deepEqual(ownerPrincipalViolations(["owner"], ["reorder.request.assign", "workOrder.record.read"]), ["reorder.request.assign"]);
});

test("D9 an EXPIRED direct exception is refreshed, never audited as granted while it stays expired; D11 revoke needs a reason", async () => {
  const { repo, tenantId, admin, plainId } = await world();
  const cap = (await repo.listCapabilities()).find((c) => c.key === "workOrder.record.read");
  await repo.transact({ tenantId, uid: OPERATOR }, (tx) => tx.grantPrincipalCapability({ principalId: plainId, capabilityId: cap.id,
    grantedBy: OPERATOR, grantedAt: new Date().toISOString(), exceptionReason: "temp", expiresAt: new Date(Date.now() - 1000).toISOString() }));
  assert.equal((await repo.listPrincipalCapabilities(tenantId, plainId)).length, 0, "expired confers nothing");
  const future = new Date(Date.now() + 86_400_000).toISOString();
  const refreshed = await commands.grantObjectActionToPrincipal(repo, admin,
    { objectKey: "workOrder", actionKey: "read", principalId: plainId, reason: "renewed cover", expiresAt: future });
  assert.equal(refreshed.expiresAt, future);
  assert.equal(refreshed.exceptionReason, "renewed cover");
  assert.equal((await repo.listPrincipalCapabilities(tenantId, plainId)).length, 1, "the audited grant is effective");
  await assert.rejects(() => commands.revokeObjectActionFromPrincipal(repo, admin,
    { objectKey: "workOrder", actionKey: "read", principalId: plainId }), /REASON_REQUIRED/);
});

test("listSupportedConditionKinds: the enforced vocabulary; audit history filters server-side", async () => {
  const { repo, tenantId, admin, call } = await world();
  const adminRole = await repo.getRoleByKey(tenantId, "admin");
  const readCap = (await repo.listCapabilities()).find((c) => c.key === "admin.securityPolicy.read");
  await repo.transact({ tenantId, uid: "migration:x" }, (tx) => tx.grantRoleCapability({ roleId: adminRole.id, capabilityId: readCap.id, grantedBy: "migration:x", grantedAt: new Date().toISOString() }));
  const kinds = await call("listSupportedConditionKinds", {});
  assert.equal(kinds.ok, true, JSON.stringify(kinds));
  const byKind = Object.fromEntries(kinds.data.kinds.map((k) => [k.kind, k]));
  assert.deepEqual(Object.keys(byKind).sort(), ["ALL", "BUSINESS_UNIT", "COMPANY", "OPERATIONAL_SCOPE", "RECORD_ASSIGNMENT", "SELF", "TEAM", "WORK_ELIGIBILITY"]);
  for (const k of kinds.data.kinds) assert.deepEqual(Object.keys(k).sort(), ["capabilities", "kind", "parameters", "reason", "recordKinds", "supported"]);
  assert.deepEqual([byKind.RECORD_ASSIGNMENT.supported, byKind.RECORD_ASSIGNMENT.recordKinds], [true, ["workOrder"]]);
  assert.deepEqual(byKind.RECORD_ASSIGNMENT.capabilities.map((c) => c.capabilityKey), ["workOrder.record.read"]);
  assert.deepEqual([byKind.TEAM.supported, typeof byKind.TEAM.reason], [false, "string"]);
  assert.ok(byKind.WORK_ELIGIBILITY.parameters.qualificationCode.includes("SERVICE_TECHNICIAN"));

  // Audit history, filtered server-side.
  await commands.grantObjectActionToRole(repo, admin, { objectKey: "workOrder", actionKey: "read", roleKey: "technician", reason: REASON });
  await commands.grantObjectActionToRole(repo, admin, { objectKey: "workOrder", actionKey: "dispatch", roleKey: "dispatcher", reason: REASON });
  const filtered = await repo.queryAuditEvents(tenantId, { capabilityKey: "workOrder.record.read", limit: 50 });
  assert.deepEqual(filtered.map((e) => e.after.capabilityKey), ["workOrder.record.read"]);
  assert.deepEqual((await repo.queryAuditEvents(tenantId, { roleKey: "dispatcher", limit: 50 })).map((e) => e.action), ["grantObjectActionToRole"]);
  assert.equal((await repo.queryAuditEvents(tenantId, { objectKey: "workOrder", limit: 50 })).length, 2);
  assert.equal((await repo.queryAuditEvents(tenantId, { objectKey: "workOrder", from: "2999-01-01T00:00:00.000Z", limit: 50 })).length, 0);
  assert.equal((await repo.queryAuditEvents(tenantId, { principalId: admin.uid, limit: 500 })).length >= 2, true);
});
