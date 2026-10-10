// THE PROTECTED OWNER INVARIANT, against a real PostgreSQL (Controller ruling 2026-09-27).
//
// Found in nonprod during the Pass 10 R1 verification: an Owner revoked their OWN owner assignment through
// ordinary revokeRole, because (1) revokeRole had no Owner rule at all, (2) the protected-role guard pooled
// owner + admin tenant-wide, so any Administrator "kept the tenant in", and (3) the anti-lockout set left out
// admin.administratorRole.assign (R1), which after migration 1763078400000 only the Owner holds.
//
// The ruling: the protected Owner is NOT an ordinary Security Role assignment. Ordinary role administration
// (admin.roleAssignment.write, admin.securityPolicy.write, R1) may neither appoint nor remove it; no ordinary
// role-assignment command may leave a tenant with zero active protected Owners (per role -- Administrators never
// substitute); and R1 takes part in anti-lockout. Owner succession is a separate lifecycle, not built here.
//
// Each proof names the requirement letter of the ruling it answers (A-I).

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { seedProtectedOwner } from "./support/protectedOwnerFixture.mjs";

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
const { explainEffectiveAccess } = require("../lib/eosOps/effectiveAccessExplanation.js");

const OP = "operator-po";
const R1 = "admin.administratorRole.assign";
const SPW = "admin.securityPolicy.write";
const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

test("the protected Owner and the anti-lockout set are defined once, by key AND protected flag", () => {
  assert.equal(authority.PROTECTED_OWNER_ROLE_KEY, "owner");
  assert.equal(authority.isProtectedOwnerRole({ key: "owner", protected: true }), true);
  assert.equal(authority.isProtectedOwnerRole({ key: "owner", protected: false }), false, "a tenant-created look-alike is not the Owner");
  assert.equal(authority.isProtectedOwnerRole({ key: "admin", protected: true }), false);
  assert.equal(authority.isProtectedOwnerRole(undefined), false);
  // F: R1 participates in anti-lockout, but stays OUT of the governing (policy-editing) set.
  assert.deepEqual([...commands.ANTI_LOCKOUT_CAPABILITIES].sort(), [...ADMINISTRATION_GOVERNING_CAPABILITIES, R1].sort());
  assert.equal(ADMINISTRATION_GOVERNING_CAPABILITIES.includes(R1), false);
});

test("PROTECTED OWNER INVARIANT (Controller ruling 2026-09-27), in PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `powner_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
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
    const { tenant } = await bootstrapTenant(repo, { key: `po-${key}`, name: key, actorUid: OP });
    T[key] = tenant.id;
    await bootstrapAdministrator(repo, { tenantId: tenant.id, externalSubject: `admin-${key}1`, performedBy: OP, reason: "boot" });
    for (const cap of ["admin.securityPolicy.read", "admin.principalAccess.read", "audit.event.read"]) {
      await q(`INSERT INTO eos_policy.role_capabilities (id,tenant_id,role_id,capability_id,granted_by,created_by,updated_by)
               SELECT 'rc-fx-' || md5($1 || c.id), $1, r.id, c.id, 'fixture','fixture','fixture'
                 FROM eos_policy.roles r, eos_policy.capabilities c WHERE r.tenant_id=$1 AND r.key='admin' AND c.key=$2
               ON CONFLICT DO NOTHING`, [tenant.id, cap]);
    }
  }
  const deps = { repo, explainEffectiveAccess: (tenantId, principalId) => explainEffectiveAccess(repo, pool, { tenantId, principalId }) };
  const call = (subject, operation, input = {}) => executeAdminOperation(deps,
    { caller: { externalSubject: subject, identityProvider: "firebase" }, operation, input, requestId: `po-${operation}` });
  const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.data; };
  const refused = (r, code, pattern) => {
    assert.deepEqual([r.ok, r.code], [false, code], JSON.stringify(r));
    if (pattern) assert.match(r.message, pattern);
  };
  const roleId = async (tenant, key) => (await repo.getRoleByKey(tenant, key)).id;
  const principalOf = async (subject) => (await repo.getPrincipalBySubject("firebase", subject)).id;
  const member = async (tenant, subject) => {
    const made = await ensureTenantPrincipal(repo, { tenantId: tenant, externalSubject: subject, actorUid: OP, actorRoleKeys: ["admin"] });
    return made.principal?.id ?? made.id ?? made.principalId;
  };
  const auditCount = async (tenant) => Number((await q(`SELECT count(*)::int n FROM eos_policy.audit_events WHERE tenant_id=$1`, [tenant])).rows[0].n);
  const activeOwners = async (tenant) => Number((await q(
    `SELECT count(*)::int n FROM eos_policy.user_role_assignments a JOIN eos_policy.roles r ON r.id=a.role_id
      WHERE a.tenant_id=$1 AND r.key='owner' AND a.status='active'`, [tenant])).rows[0].n);
  const assignmentOf = async (tenant, principalId, key) => (await q(
    `SELECT a.* FROM eos_policy.user_role_assignments a JOIN eos_policy.roles r ON r.id=a.role_id
      WHERE a.tenant_id=$1 AND a.principal_id=$2 AND r.key=$3 AND a.status='active'`, [tenant, principalId, key])).rows[0] ?? null;
  const explained = async (tenant, principalId) => explainEffectiveAccess(repo, pool, { tenantId: tenant, principalId });

  // Tenant A: ONE protected Owner (seeded as bootstrap seeds the first Administrator), the bootstrap Administrator,
  // a GM granted admin.roleAssignment.write (ordinary assignment authority without security policy), and a plain member.
  const adminA1 = await principalOf("admin-a1");
  const ownerA = await member(T.a, "owner-a");
  const ownerAssignmentA = await seedProtectedOwner(repo, { tenantId: T.a, principalId: ownerA });
  const gmA = await member(T.a, "gm-a");
  ok(await call("admin-a1", "assignRole", { principalId: gmA, roleId: await roleId(T.a, "generalManager"), reason: "fixture gm" }));
  ok(await call("admin-a1", "grantObjectActionToRole", { objectKey: "rolesPermissions", actionKey: "assignRole", roleKey: "generalManager", reason: "fixture: GM may assign" }));
  const plainA = await member(T.a, "plain-a");
  const ownerRoleA = await roleId(T.a, "owner");
  const adminRoleA = await roleId(T.a, "admin");

  await t.test("premise: one active protected Owner holding R1 and not admin.securityPolicy.write; the Administrator holds R1 by standing", async () => {
    assert.equal(await activeOwners(T.a), 1);
    const owner = await explained(T.a, ownerA);
    assert.equal(owner.capabilities.includes(R1), true);
    assert.equal(owner.capabilities.includes(SPW), false);
    // DECISIONS #223 amends R1: protected Administrators staff Administrators too -- never the protected Owner (B, below).
    assert.equal((await explained(T.a, adminA1)).capabilities.includes(R1), true);
  });

  await t.test("A: the Owner cannot revoke their OWN protected Owner assignment -- refused, nothing written", async () => {
    const before = await auditCount(T.a);
    refused(await call("owner-a", "revokeRole", { assignmentId: ownerAssignmentA.id, reason: "step down" }), "CONFLICT", /LAST_PROTECTED_OWNER/);
    assert.equal(await auditCount(T.a), before, "a refusal writes no audit event");
    assert.notEqual(await assignmentOf(T.a, ownerA, "owner"), null);
  });

  await t.test("B: the Administrator cannot revoke the protected Owner (admin.securityPolicy.write is insufficient)", async () => {
    const before = await auditCount(T.a);
    refused(await call("admin-a1", "revokeRole", { assignmentId: ownerAssignmentA.id, reason: "remove owner" }), "CONFLICT", /LAST_PROTECTED_OWNER/);
    // ... nor a holder of admin.roleAssignment.write alone.
    refused(await call("gm-a", "revokeRole", { assignmentId: ownerAssignmentA.id, reason: "remove owner" }), "CONFLICT", /LAST_PROTECTED_OWNER/);
    assert.equal(await auditCount(T.a), before);
    assert.equal(await activeOwners(T.a), 1);
  });

  await t.test("C: ordinary role assignment refuses to appoint the protected Owner -- Administrator, GM, Owner (even via R1), any target", async () => {
    const before = await auditCount(T.a);
    for (const actor of ["admin-a1", "gm-a", "owner-a"]) {
      refused(await call(actor, "assignRole", { principalId: plainA, roleId: ownerRoleA, reason: "appoint" }), "FORBIDDEN", /PROTECTED_OWNER_MEMBERSHIP/);
    }
    // ... and the Owner re-appointing themselves is the same refusal (decided before SELF_ADMINISTRATION).
    refused(await call("owner-a", "assignRole", { principalId: ownerA, roleId: ownerRoleA, reason: "self" }), "FORBIDDEN", /PROTECTED_OWNER_MEMBERSHIP/);
    assert.equal(await auditCount(T.a), before);
    assert.equal(await activeOwners(T.a), 1);
    assert.equal(await assignmentOf(T.a, plainA, "owner"), null);
  });

  await t.test("D + E: the last Owner cannot be removed even while SEVERAL Administrators exist -- Administrators never substitute", async () => {
    const extra = [];
    for (const s of ["adm-x", "adm-y"]) {
      const p = await member(T.a, s);
      extra.push(ok(await call("admin-a1", "assignRole", { principalId: p, roleId: adminRoleA, reason: "extra administrator" })));
    }
    const admins = Number((await q(`SELECT count(*)::int n FROM eos_policy.user_role_assignments WHERE tenant_id=$1 AND role_id=$2 AND status='active'`,
      [T.a, adminRoleA])).rows[0].n);
    assert.equal(admins, 3, "three protected Administrator assignments are active");
    for (const actor of ["admin-a1", "adm-x", "owner-a"]) {
      refused(await call(actor, "revokeRole", { assignmentId: ownerAssignmentA.id, reason: "the admins keep the tenant in" }), "CONFLICT", /LAST_PROTECTED_OWNER/);
    }
    assert.equal(await activeOwners(T.a), 1);
    for (const a of extra) ok(await call("admin-a1", "revokeRole", { assignmentId: a.id, reason: "fixture cleanup" }));
  });

  await t.test("with a SECOND Owner the removal is still refused -- by the membership rule, not only the last-owner count", async () => {
    const owner2 = await member(T.a, "owner-a2");
    const second = await seedProtectedOwner(repo, { tenantId: T.a, principalId: owner2 });
    assert.equal(await activeOwners(T.a), 2);
    for (const [actor, target] of [["owner-a", ownerAssignmentA.id], ["owner-a2", second.id], ["admin-a1", second.id], ["gm-a", second.id]]) {
      refused(await call(actor, "revokeRole", { assignmentId: target, reason: "remove an owner" }), "FORBIDDEN", /PROTECTED_OWNER_MEMBERSHIP/);
    }
    assert.equal(await activeOwners(T.a), 2);
    // Fixture teardown outside ordinary administration (the same layer that seeded it).
    await q(`UPDATE eos_policy.user_role_assignments SET status='disabled' WHERE id=$1`, [second.id]);
    assert.equal(await activeOwners(T.a), 1);
  });

  await t.test("F: R1 takes part in anti-lockout -- its last holder's grant cannot be revoked; with a second holder it can", async () => {
    const before = await auditCount(T.a);
    refused(await call("admin-a1", "revokeObjectActionFromRole", { objectKey: "rolesPermissions", actionKey: "assignAdministratorRole", roleKey: "owner", reason: "withdraw R1" }),
      "CONFLICT", /WOULD_REMOVE_LAST_ADMINISTRATION_PATH/);
    assert.equal(await auditCount(T.a), before);
    assert.equal((await explained(T.a, ownerA)).capabilities.includes(R1), true);
    // A second governed R1 holder: a custom Role carrying R1, held globally by a member.
    ok(await call("admin-a1", "createRole", { key: "recoveryDesk", name: "Recovery Desk", reason: "fixture" }));
    ok(await call("admin-a1", "grantObjectActionToRole", { objectKey: "rolesPermissions", actionKey: "assignAdministratorRole", roleKey: "recoveryDesk", reason: "fixture" }));
    const desk = await member(T.a, "desk-a");
    const deskAssignment = ok(await call("admin-a1", "assignRole", { principalId: desk, roleId: await roleId(T.a, "recoveryDesk"), reason: "fixture" }));
    ok(await call("admin-a1", "revokeObjectActionFromRole", { objectKey: "rolesPermissions", actionKey: "assignAdministratorRole", roleKey: "owner", reason: "withdraw R1 with another holder" }));
    // ... and now the desk is the last R1 path: removing its assignment is refused.
    refused(await call("admin-a1", "revokeRole", { assignmentId: deskAssignment.id, reason: "remove the last R1 holder" }), "CONFLICT", /WOULD_REMOVE_LAST_ADMINISTRATION_PATH/);
    // Restore the Owner's R1, then the desk may go.
    ok(await call("admin-a1", "grantObjectActionToRole", { objectKey: "rolesPermissions", actionKey: "assignAdministratorRole", roleKey: "owner", reason: "restore" }));
    ok(await call("admin-a1", "revokeRole", { assignmentId: deskAssignment.id, reason: "fixture cleanup" }));
    assert.equal((await explained(T.a, ownerA)).capabilities.includes(R1), true);
  });

  await t.test("G + H: the Owner still staffs AND removes the Administrator for another principal through R1, with provenance", async () => {
    const made = ok(await call("owner-a", "assignRole", { principalId: plainA, roleId: adminRoleA, reason: "staff the administrator" }));
    const ev = (await q(`SELECT * FROM eos_policy.audit_events WHERE tenant_id=$1 ORDER BY occurred_at DESC LIMIT 1`, [T.a])).rows[0];
    assert.deepEqual([ev.action, ev.target_id], ["assignRole", made.id]);
    assert.deepEqual(ev.after.authorizedBy, { capabilityKey: R1, ownerRuling: "R1 (2026-09-26)" });
    ok(await call("owner-a", "revokeRole", { assignmentId: made.id, reason: "recover" }));
    const ev2 = (await q(`SELECT * FROM eos_policy.audit_events WHERE tenant_id=$1 ORDER BY occurred_at DESC LIMIT 1`, [T.a])).rows[0];
    assert.deepEqual([ev2.action, ev2.target_id], ["revokeRole", made.id]);
    assert.deepEqual(ev2.after.authorizedBy, { capabilityKey: R1, ownerRuling: "R1 (2026-09-26)" });
    assert.equal((await explained(T.a, ownerA)).capabilities.includes(SPW), false, "R1 still confers no security-policy authority");
    // The rest of R1's bounds are unchanged: no self-Administrator, no scoped Administrator.
    refused(await call("owner-a", "assignRole", { principalId: ownerA, roleId: adminRoleA, reason: "self" }), "FORBIDDEN", /SELF_ADMINISTRATION/);
    refused(await call("owner-a", "assignRole", { principalId: plainA, roleId: adminRoleA, scopeType: "operatingCompany", scopeValue: "taylor", reason: "scoped" }),
      "FORBIDDEN", /PRIVILEGE_ESCALATION/);
  });

  await t.test("I: the Administrator still performs ordinary (non-Owner) role administration", async () => {
    const made = ok(await call("admin-a1", "assignRole", { principalId: plainA, roleId: await roleId(T.a, "salesperson"), reason: "ordinary staffing" }));
    ok(await call("admin-a1", "revokeRole", { assignmentId: made.id, reason: "ordinary removal" }));
    const gmMade = ok(await call("gm-a", "assignRole", { principalId: plainA, roleId: await roleId(T.a, "salesperson"), reason: "gm staffing" }));
    ok(await call("gm-a", "revokeRole", { assignmentId: gmMade.id, reason: "gm removal" }));
  });

  await t.test("tenant isolation: another tenant's protected Owner assignment cannot be reached from tenant A", async () => {
    const ownerB = await member(T.b, "owner-b");
    const ownerAssignmentB = await seedProtectedOwner(repo, { tenantId: T.b, principalId: ownerB });
    for (const actor of ["admin-a1", "owner-a"]) {
      const r = await call(actor, "revokeRole", { assignmentId: ownerAssignmentB.id, reason: "cross-tenant" });
      assert.equal(r.ok, false, JSON.stringify(r));
    }
    assert.notEqual(await assignmentOf(T.b, ownerB, "owner"), null);
  });

  await t.test("the command layer refuses too, not only the transport", async () => {
    const adminActor = { tenantId: T.a, uid: adminA1, heldRoleKeys: ["admin"] };
    await assert.rejects(() => commands.revokeRole(repo, adminActor, { assignmentId: ownerAssignmentA.id, reason: "x" }), /LAST_PROTECTED_OWNER/);
    await assert.rejects(() => commands.assignRole(repo, adminActor, { principalId: plainA, roleId: ownerRoleA, reason: "x" }), /PROTECTED_OWNER_MEMBERSHIP/);
    assert.equal(await activeOwners(T.a), 1);
  });
});
