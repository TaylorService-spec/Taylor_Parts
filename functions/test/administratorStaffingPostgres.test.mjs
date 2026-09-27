// OWNER RULING R1 (2026-09-26) -- Owner staffs and recovers the DESIGNATED Administrator Security Role, and
// nothing else, through ONE bounded capability: admin.administratorRole.assign (migration 1763078400000).
//
// Proves, against PostgreSQL through the real Administration API:
//   * Owner (admin.roleAssignment.write + admin.administratorRole.assign, NOT admin.securityPolicy.write) assigns
//     the Administrator Role to ANOTHER principal and removes it -- each change audited exactly once, naming R1;
//   * self-assignment and self-removal are refused;
//   * every OTHER Role carrying admin.securityPolicy.write (a custom Role, even one NAMED "Administrator") is
//     still refused, both directions; a scoped Administrator is refused; a direct admin.* grant is refused;
//   * Owner cannot grant/revoke capabilities, condition a grant, or edit the Administrator Role's definition,
//     and holds no admin.securityPolicy.write afterwards (explainEffectiveAccess, the write gates);
//   * anti-lockout: the last effective security administrator cannot be removed, including two concurrent
//     removals of the last two;
//   * tenant isolation; a holder of admin.roleAssignment.write WITHOUT the R1 capability is refused; revoking the
//     R1 grant from owner is ordinary Administration and takes effect;
//   * the capability is neither conditionable nor scopable, and anti-lockout never counts it.
//
// Writes ONLY to a database it creates under POLICY_TEST_DATABASE_URL and drops at the end.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");
const { bootstrapTenant, bootstrapAdministrator, ensureTenantPrincipal } = require("../lib/adminPolicy/tenantBootstrap.js");
const { executeAdminOperation } = require("../lib/adminPolicy/adminPolicyApi.js");
const commands = require("../lib/adminPolicy/policyCommands.js");
const authority = require("../lib/adminPolicy/administrationAuthority.js");
const { ADMINISTRATION_GOVERNING_CAPABILITIES } = require("../lib/adminPolicy/roleCapabilityAdministration.js");
const { isAdministrationCapability } = require("../lib/adminPolicy/assignmentScopeRuntime.js");
const { explainEffectiveAccess } = require("../lib/eosOps/effectiveAccessExplanation.js");

const OP = "operator-r1";
const R1 = "admin.administratorRole.assign";
const SPW = "admin.securityPolicy.write";
const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

test("the capability is defined once, bounded, and is not a governing Administration capability", () => {
  assert.equal(authority.ADMINISTRATOR_STAFFING_CAPABILITY, R1);
  assert.equal(ADMINISTRATION_GOVERNING_CAPABILITIES.includes(R1), false, "anti-lockout must never count the R1 capability");
  assert.equal(isAdministrationCapability(R1), true, "an admin.* key: refused at any scope, like every Administration key");
  assert.deepEqual(authority.ADMINISTRATION_BOOTSTRAP_GRANTS.filter((g) => g.capabilityKey === R1).map((g) => g.roleKey), ["owner"]);
  assert.equal(authority.isDesignatedAdministratorRole({ key: "admin", protected: true }), true);
  assert.equal(authority.isDesignatedAdministratorRole({ key: "admin", protected: false }), false);
  assert.equal(authority.isDesignatedAdministratorRole({ key: "administrator", protected: true }), false);
});

test("Owner ruling R3: the existing capability-granting task Roles remain Security Roles, unrenamed", async () => {
  // R3: Security Role = authority, Functional Role = responsibility. The task Roles older prose called "functional"
  // stay Security Roles under their existing keys -- no rename, no reclassification. Each still carries its grants in
  // the governed authority baseline.
  const { readFileSync } = await import("node:fs");
  const baseline = JSON.parse(readFileSync(resolve(FUNCTIONS_DIR, "src/adminPolicy/seed/roleCapabilityAuthorityBaseline.json"), "utf8"));
  const granting = new Set(baseline.grants.map((g) => g.roleKey));
  for (const key of ["inventoryCatalogAdministrator", "inventoryCreateExecutor", "inventoryCycleCountCounter",
    "inventoryCycleCountReconciler", "inventoryLookupReader", "inventoryPutAwayOperator", "inventoryReceivingClerk",
    "inventoryStockRelocationOperator", "inventoryTransferOperator"]) {
    assert.equal(granting.has(key), true, `${key} must remain a capability-granting Security Role (R3)`);
  }
});

test("Owner ruling R1: Owner staffs the designated Administrator Role for another principal, and nothing else", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `r1staff_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let pool;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => {
    await pool?.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  const url = dbUrlFor(name);
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations", "--no-check-order"],
    { cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
  pool = new pg.Pool({ connectionString: url, max: 16 });
  const q = (s, v = []) => pool.query(s, v);
  const repo = new PostgresPolicyRepository(pool);

  const T = {};
  for (const key of ["a", "b"]) {
    const { tenant } = await bootstrapTenant(repo, { key: `r1-${key}`, name: key, actorUid: OP });
    T[key] = tenant.id;
    await bootstrapAdministrator(repo, { tenantId: tenant.id, externalSubject: `admin-${key}1`, performedBy: OP, reason: "boot" });
    for (const cap of ["admin.securityPolicy.read", "admin.principalAccess.read", "audit.event.read"]) {
      await q(`INSERT INTO eos_policy.role_capabilities (id,tenant_id,role_id,capability_id,granted_by,created_by,updated_by)
               SELECT 'rc-fx-' || md5($1 || c.id), $1, r.id, c.id, 'fixture','fixture','fixture'
                 FROM eos_policy.roles r, eos_policy.capabilities c WHERE r.tenant_id=$1 AND r.key='admin' AND c.key=$2
               ON CONFLICT DO NOTHING`, [tenant.id, cap]);
    }
    await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id,operating_company_id,status,source,established_by,updated_by)
             VALUES ($1,'taylor','ACTIVE','fixture','fixture','fixture')`, [tenant.id]);
  }
  const deps = { repo, explainEffectiveAccess: (tenantId, principalId) => explainEffectiveAccess(repo, pool, { tenantId, principalId }) };
  const call = (subject, operation, input = {}) => executeAdminOperation(deps,
    { caller: { externalSubject: subject, identityProvider: "firebase" }, operation, input, requestId: `r-${operation}` });
  const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.data; };
  const refused = (r, code, pattern) => {
    assert.deepEqual([r.ok, r.code], [false, code], JSON.stringify(r));
    if (pattern) assert.match(r.message, pattern);
  };
  const roleId = async (tenant, key) => (await repo.getRoleByKey(tenant, key)).id;
  const principalOf = async (subject) => (await repo.getPrincipalBySubject("firebase", subject)).id;
  const person = async (tenant, subject, roleKeys = [], adminSubject = null) => {
    const made = await ensureTenantPrincipal(repo, { tenantId: tenant, externalSubject: subject, actorUid: OP, actorRoleKeys: ["admin"] });
    const principalId = made.principal?.id ?? made.id ?? made.principalId;
    for (const key of roleKeys) ok(await call(adminSubject, "assignRole", { principalId, roleId: await roleId(tenant, key), reason: "fixture staffing" }));
    return principalId;
  };
  const auditCount = async (tenant) => Number((await q(`SELECT count(*)::int n FROM eos_policy.audit_events WHERE tenant_id=$1`, [tenant])).rows[0].n);
  const lastAudit = async (tenant) => (await q(`SELECT action, actor_uid, target_id, after FROM eos_policy.audit_events
    WHERE tenant_id=$1 ORDER BY occurred_at DESC, id DESC LIMIT 1`, [tenant])).rows[0];
  const activeAssignment = async (tenant, principalId, roleKey) => {
    const rid = await roleId(tenant, roleKey);
    return (await repo.listAssignmentsForPrincipal(tenant, principalId)).find((a) => a.roleId === rid && a.status === "active") ?? null;
  };
  const explained = async (principalId) => ok(await call("admin-a1", "explainEffectiveAccess", { principalId }));

  const adminA1 = await principalOf("admin-a1");
  const ownerA = await person(T.a, "owner-a", ["owner"], "admin-a1");
  const dispA = await person(T.a, "disp-a", ["dispatcher"], "admin-a1");
  const techA = await person(T.a, "tech-a", ["technician"], "admin-a1");
  const adminRoleA = await roleId(T.a, "admin");

  await t.test("premise: Owner holds admin.roleAssignment.write and the R1 capability, and NOT admin.securityPolicy.write", async () => {
    const owner = await explained(ownerA);
    assert.equal(owner.capabilities.includes(R1), true);
    assert.equal(owner.capabilities.includes("admin.roleAssignment.write"), true);
    assert.equal(owner.capabilities.includes(SPW), false);
    const admin = await explained(adminA1);
    assert.equal(admin.capabilities.includes(R1), false, "admin needs no R1 capability: it holds admin.securityPolicy.write");
  });

  await t.test("Owner assigns the Administrator Role to another principal -- allowed, audited exactly once, naming R1", async () => {
    const before = await auditCount(T.a);
    const made = ok(await call("owner-a", "assignRole", { principalId: dispA, roleId: adminRoleA, reason: "staff the administrator" }));
    assert.equal(made.roleId, adminRoleA);
    assert.equal(await auditCount(T.a), before + 1, "exactly one audit event");
    const ev = await lastAudit(T.a);
    assert.deepEqual([ev.action, ev.actor_uid, ev.target_id], ["assignRole", ownerA, made.id]);
    assert.deepEqual(ev.after.authorizedBy, { capabilityKey: R1, ownerRuling: "R1 (2026-09-26)" });
    assert.equal((await explained(dispA)).capabilities.includes(SPW), true, "the staffed principal is a security administrator");
    // Idempotent: the same assignment again is a no-op -- no second row, no second event.
    ok(await call("owner-a", "assignRole", { principalId: dispA, roleId: adminRoleA, reason: "again" }));
    assert.equal(await auditCount(T.a), before + 1);
    // ...and Owner still holds no admin.securityPolicy.write.
    assert.equal((await explained(ownerA)).capabilities.includes(SPW), false);
  });

  await t.test("Owner removes the Administrator Role from another principal -- allowed, audited exactly once, naming R1", async () => {
    const assignment = await activeAssignment(T.a, dispA, "admin");
    const before = await auditCount(T.a);
    ok(await call("owner-a", "revokeRole", { assignmentId: assignment.id, reason: "recover" }));
    assert.equal(await auditCount(T.a), before + 1);
    const ev = await lastAudit(T.a);
    assert.deepEqual([ev.action, ev.target_id], ["revokeRole", assignment.id]);
    assert.deepEqual(ev.after.authorizedBy, { capabilityKey: R1, ownerRuling: "R1 (2026-09-26)" });
    assert.equal(await activeAssignment(T.a, dispA, "admin"), null);
  });

  await t.test("self-assignment is refused", async () => {
    refused(await call("owner-a", "assignRole", { principalId: ownerA, roleId: adminRoleA, reason: "self" }), "FORBIDDEN", /SELF_ADMINISTRATION/);
  });

  await t.test("self-removal on the R1 path is refused", async () => {
    // Reachable only through a request-resolved capability set that lacks admin.securityPolicy.write while the actor
    // holds the Administrator Role; proved at the command, where the actor is exactly that shape.
    const staffer = ok(await call("admin-a1", "createRole", { key: "staffer", name: "Staffer", reason: "fixture" }));
    ok(await call("admin-a1", "grantObjectActionToRole", { objectKey: "rolesPermissions", actionKey: "assignAdministratorRole", roleKey: "staffer", reason: "fixture" }));
    ok(await call("admin-a1", "grantObjectActionToRole", { objectKey: "rolesPermissions", actionKey: "assignRole", roleKey: "staffer", reason: "fixture" }));
    const stf = await person(T.a, "stf-a", ["staffer", "admin"], "admin-a1");
    const mine = await activeAssignment(T.a, stf, "admin");
    const actor = { tenantId: T.a, uid: stf, heldRoleKeys: ["staffer"], capabilities: new Set(["admin.roleAssignment.write", R1]) };
    await assert.rejects(() => commands.revokeRole(repo, actor, { assignmentId: mine.id, reason: "self" }), /SELF_ADMINISTRATION/);
    assert.notEqual(await activeAssignment(T.a, stf, "admin"), null);
    assert.equal(staffer.key, "staffer");
    // Clean up: an administrator (not R1) removes it.
    ok(await call("admin-a1", "revokeRole", { assignmentId: mine.id, reason: "fixture" }));
  });

  await t.test("any OTHER Role carrying admin.securityPolicy.write is refused -- even one NAMED Administrator", async () => {
    ok(await call("admin-a1", "createRole", { key: "securityAdministrator2", name: "Administrator", reason: "fixture" }));
    ok(await call("admin-a1", "grantObjectActionToRole", { objectKey: "rolesPermissions", actionKey: "editSecurityPolicy", roleKey: "securityAdministrator2", reason: "fixture" }));
    const custom = await roleId(T.a, "securityAdministrator2");
    const before = await auditCount(T.a);
    refused(await call("owner-a", "assignRole", { principalId: dispA, roleId: custom, reason: "appoint" }), "FORBIDDEN", /PRIVILEGE_ESCALATION/);
    // Removal of a custom security-administrator assignment an administrator made is refused to Owner too.
    const made = ok(await call("admin-a1", "assignRole", { principalId: techA, roleId: custom, reason: "fixture" }));
    const mid = await auditCount(T.a);
    refused(await call("owner-a", "revokeRole", { assignmentId: made.id, reason: "remove" }), "FORBIDDEN", /PRIVILEGE_ESCALATION/);
    assert.equal(await auditCount(T.a), mid, "a refusal writes no audit event");
    assert.equal(mid, before + 1);
    ok(await call("admin-a1", "revokeRole", { assignmentId: made.id, reason: "fixture" }));
  });

  await t.test("a scoped Administrator assignment is refused", async () => {
    refused(await call("owner-a", "assignRole", { principalId: dispA, roleId: adminRoleA, scopeType: "operatingCompany", scopeValue: "taylor", reason: "scoped" }),
      "FORBIDDEN", /PRIVILEGE_ESCALATION/);
    // And by an administrator, the platform rule still refuses it (lane SC).
    refused(await call("admin-a1", "assignRole", { principalId: dispA, roleId: adminRoleA, scopeType: "operatingCompany", scopeValue: "taylor", reason: "scoped" }),
      "INVALID_INPUT", /SCOPE_AMBIGUOUS_ADMINISTRATION/);
  });

  await t.test("Owner cannot grant, revoke, condition, directly grant, or edit the Administrator Role definition", async () => {
    const before = await auditCount(T.a);
    for (const [operation, input] of [
      ["grantObjectActionToRole", { objectKey: "rolesPermissions", actionKey: "editSecurityPolicy", roleKey: "dispatcher", reason: "x" }],
      ["grantObjectActionToRole", { objectKey: "customer", actionKey: "read", roleKey: "admin", reason: "x" }],
      ["revokeObjectActionFromRole", { objectKey: "rolesPermissions", actionKey: "editSecurityPolicy", roleKey: "admin", reason: "x" }],
      ["grantObjectActionToPrincipal", { objectKey: "rolesPermissions", actionKey: "editSecurityPolicy", principalId: dispA, reason: "x" }],
      ["grantObjectActionToPrincipal", { objectKey: "rolesPermissions", actionKey: "assignAdministratorRole", principalId: dispA, reason: "x" }],
      ["setGrantCondition", { objectKey: "workOrder", actionKey: "read", roleKey: "admin", reason: "x",
        condition: { paths: [[{ kind: "RECORD_ASSIGNMENT", relation: "ASSIGNED_EMPLOYEE" }]], recordKind: "workOrder" } }],
      ["updateRole", { roleId: adminRoleA, name: "Renamed by Owner", reason: "x" }],
      ["createRole", { key: "ownerMadeRole", name: "Owner made", reason: "x" }],
    ]) {
      const r = await call("owner-a", operation, input);
      assert.deepEqual([r.ok, r.code], [false, "FORBIDDEN"], `${operation} ${JSON.stringify(input)} -> ${JSON.stringify(r)}`);
    }
    assert.equal(await auditCount(T.a), before);
    const owner = await explained(ownerA);
    assert.equal(owner.capabilities.includes(SPW), false, "Owner gains no admin.securityPolicy.write");
    assert.equal((await repo.getRoleByKey(T.a, "admin")).name !== "Renamed by Owner", true);
  });

  await t.test("Owner ruling A still holds at the principal: Owner cannot staff the Administrator onto an owner holder", async () => {
    const owner2 = await person(T.a, "owner-a2", ["owner"], "admin-a1");
    // The measured admin Role carries the ruling-A admin-only keys; this bootstrapped tenant's does not until the
    // fixture gives it one (a system-default row, as in nonprod).
    await q(`INSERT INTO eos_policy.role_capabilities (id,tenant_id,role_id,capability_id,granted_by,created_by,updated_by)
             SELECT 'rc-fx-ruleA', $1, r.id, c.id, 'fixture','fixture','fixture'
               FROM eos_policy.roles r, eos_policy.capabilities c WHERE r.tenant_id=$1 AND r.key='admin' AND c.key='admin.dataImport.execute'`, [T.a]);
    refused(await call("owner-a", "assignRole", { principalId: owner2, roleId: adminRoleA, reason: "x" }), "CONFLICT", /SYSTEM_INVARIANT/);
  });

  await t.test("a holder of admin.roleAssignment.write WITHOUT the R1 capability is refused, both directions", async () => {
    ok(await call("admin-a1", "createRole", { key: "roleAssigner", name: "Role assigner", reason: "fixture" }));
    ok(await call("admin-a1", "grantObjectActionToRole", { objectKey: "rolesPermissions", actionKey: "assignRole", roleKey: "roleAssigner", reason: "fixture" }));
    await person(T.a, "ra-a", ["roleAssigner"], "admin-a1");
    refused(await call("ra-a", "assignRole", { principalId: dispA, roleId: adminRoleA, reason: "x" }), "FORBIDDEN", /PRIVILEGE_ESCALATION/);
    const staffed = ok(await call("admin-a1", "assignRole", { principalId: dispA, roleId: adminRoleA, reason: "fixture" }));
    refused(await call("ra-a", "revokeRole", { assignmentId: staffed.id, reason: "x" }), "FORBIDDEN", /PRIVILEGE_ESCALATION/);
    // Ordinary roles are unaffected: the role assigner still staffs a dispatcher.
    ok(await call("ra-a", "assignRole", { principalId: techA, roleId: await roleId(T.a, "dispatcher"), reason: "ordinary staffing" }));
    ok(await call("admin-a1", "revokeRole", { assignmentId: staffed.id, reason: "fixture" }));
  });

  await t.test("the R1 grant is ordinary Administration: revoked from owner, Owner is refused; re-granted, allowed", async () => {
    ok(await call("admin-a1", "revokeObjectActionFromRole", { objectKey: "rolesPermissions", actionKey: "assignAdministratorRole", roleKey: "owner", reason: "withdraw" }));
    refused(await call("owner-a", "assignRole", { principalId: dispA, roleId: adminRoleA, reason: "x" }), "FORBIDDEN", /PRIVILEGE_ESCALATION/);
    ok(await call("admin-a1", "grantObjectActionToRole", { objectKey: "rolesPermissions", actionKey: "assignAdministratorRole", roleKey: "owner", reason: "restore" }));
    const made = ok(await call("owner-a", "assignRole", { principalId: dispA, roleId: adminRoleA, reason: "x" }));
    ok(await call("owner-a", "revokeRole", { assignmentId: made.id, reason: "x" }));
  });

  await t.test("the capability is neither conditionable nor scopable", async () => {
    refused(await call("admin-a1", "setGrantCondition", { objectKey: "rolesPermissions", actionKey: "assignAdministratorRole", roleKey: "owner", reason: "x",
      condition: { paths: [[{ kind: "RECORD_ASSIGNMENT", relation: "ASSIGNED_EMPLOYEE" }]], recordKind: "workOrder" } }), "INVALID_INPUT", /CONDITION_NOT_SUPPORTED/);
    refused(await call("admin-a1", "grantObjectActionToPrincipal", { objectKey: "rolesPermissions", actionKey: "assignAdministratorRole", principalId: techA, reason: "x",
      condition: { paths: [[{ kind: "RECORD_ASSIGNMENT", relation: "ASSIGNED_EMPLOYEE" }]], recordKind: "workOrder" } }), "INVALID_INPUT", /CONDITION_NOT_SUPPORTED/);
    // A Role carrying it may only be assigned globally.
    refused(await call("admin-a1", "assignRole", { principalId: techA, roleId: await roleId(T.a, "staffer"), scopeType: "operatingCompany", scopeValue: "taylor", reason: "x" }),
      "INVALID_INPUT", /SCOPE_AMBIGUOUS_ADMINISTRATION/);
    const scopes = ok(await call("admin-a1", "listSupportedAssignmentScopes", { roleKey: "owner" }));
    for (const s of scopes.roles[0].assignableScopes) assert.equal(s.assignable, false, JSON.stringify(s));
  });

  await t.test("tenant isolation: another tenant's Role, principal or assignment is refused", async () => {
    const adminRoleB = await roleId(T.b, "admin");
    const adminB1 = await principalOf("admin-b1");
    refused(await call("owner-a", "assignRole", { principalId: dispA, roleId: adminRoleB, reason: "x" }), "INVALID_INPUT", /role not found/);
    refused(await call("owner-a", "assignRole", { principalId: adminB1, roleId: adminRoleA, reason: "x" }), "INVALID_INPUT", /not an active member/);
    const b1 = await activeAssignment(T.b, adminB1, "admin");
    const r = await call("owner-a", "revokeRole", { assignmentId: b1.id, reason: "x" });
    assert.equal(r.ok, false, JSON.stringify(r));
    assert.notEqual(await activeAssignment(T.b, adminB1, "admin"), null);
  });

  await t.test("anti-lockout: Owner cannot remove the last effective security administrator", async () => {
    await person(T.b, "owner-b", ["owner"], "admin-b1");
    const adminB1 = await principalOf("admin-b1");
    const mine = await activeAssignment(T.b, adminB1, "admin");
    const before = await auditCount(T.b);
    const r = await call("owner-b", "revokeRole", { assignmentId: mine.id, reason: "remove the last" });
    assert.equal(r.ok, false, JSON.stringify(r));
    assert.match(r.message, /last active administering assignment|WOULD_REMOVE_LAST_ADMINISTRATION_PATH/);
    assert.equal(await auditCount(T.b), before);
    assert.notEqual(await activeAssignment(T.b, adminB1, "admin"), null);
  });

  await t.test("anti-lockout under concurrency: two Owners removing the last two administrators -- exactly one succeeds", async () => {
    await person(T.b, "owner-b2", ["owner"], "admin-b1");
    const disp = await person(T.b, "disp-b", [], null);
    const adminRoleB = await roleId(T.b, "admin");
    ok(await call("owner-b", "assignRole", { principalId: disp, roleId: adminRoleB, reason: "second administrator" }));
    const adminB1 = await principalOf("admin-b1");
    const x = await activeAssignment(T.b, adminB1, "admin");
    const y = await activeAssignment(T.b, disp, "admin");
    const [r1, r2] = await Promise.all([
      call("owner-b", "revokeRole", { assignmentId: x.id, reason: "race" }),
      call("owner-b2", "revokeRole", { assignmentId: y.id, reason: "race" }),
    ]);
    assert.equal([r1, r2].filter((r) => r.ok).length, 1, `${JSON.stringify(r1)} / ${JSON.stringify(r2)}`);
    const n = Number((await q(`SELECT count(*)::int n FROM eos_policy.user_role_assignments WHERE tenant_id=$1 AND role_id=$2 AND status='active'`,
      [T.b, adminRoleB])).rows[0].n);
    assert.equal(n, 1, "exactly one administrator remains");
  });
});
