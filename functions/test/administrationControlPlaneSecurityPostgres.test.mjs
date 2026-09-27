// THE ADMINISTRATION CONTROL PLANE UNDER ATTACK -- Pass 8 security review, made permanent.
//
// Every PROVED probe of /round4-analysis/pass8-security-review.md is a regression here, and FAILED
// against e896819f (the reviewed head):
//   D1  a condition on a flat-gated capability was ignored (dispatcher read the audit history)
//   D2  two administrators revoking each other concurrently left ZERO administrators
//   D3  a grant insert racing a condition retire left the grant HELD with a RETIRED condition
//   D4  the anti-lockout guard counted a DISABLED principal as a holder
//   D5  Owner self-assigned admin and reached the ruling-A exclusions
//   D9  an expired direct exception was "re-granted" (audited) while staying expired
//   D10 the supersede stamp could be backdated to a foreign-tenant decision; TRUNCATE bypassed immutability
// and Pass 10 P10-2: under REPEATABLE READ a raw retire read an older snapshot and lifted a held grant's condition.
// plus D6 (requiresCondition at runtime), D8 (reconcile vs revoke), D11 (idempotent concurrent grants),
// and Pass 8 section 2 (tenant isolation) and section 3 (concurrency: deterministic final state, one
// current decision, complete audit, no duplicate effective rows, no lost revoke, anti-lockout).
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
const capabilityAuthority = require("../lib/eosOps/capabilityAuthority.js");
const composition = require("../lib/eosOps/entitledActionAuthority.js");
const { explainEffectiveAccess } = require("../lib/eosOps/effectiveAccessExplanation.js");
const { reconcileInventoryCapabilityGrants } = require("../lib/eosOps/migration/inventoryCapabilityGrantMigration.js");

const OP = "operator-cp-sec";
const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

test("the Administration control plane holds under attack and under concurrency", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `cpsec_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
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

  // Two tenants, each seeded and bootstrapped (the bootstrap grants the governing capabilities).
  const T = {};
  for (const key of ["a", "b"]) {
    const { tenant } = await bootstrapTenant(repo, { key: `cpsec-${key}`, name: key, actorUid: OP });
    T[key] = tenant.id;
    await bootstrapAdministrator(repo, { tenantId: tenant.id, externalSubject: `admin-${key}1`, performedBy: OP, reason: "boot" });
    // The Administration READS the proofs use, held by admin as system defaults (fixture rows).
    for (const cap of ["admin.securityPolicy.read", "admin.principalAccess.read", "audit.event.read"]) {
      await q(`INSERT INTO eos_policy.role_capabilities (id,tenant_id,role_id,capability_id,granted_by,created_by,updated_by)
               SELECT 'rc-fx-' || md5($1 || c.id), $1, r.id, c.id, 'fixture','fixture','fixture'
                 FROM eos_policy.roles r, eos_policy.capabilities c WHERE r.tenant_id=$1 AND r.key='admin' AND c.key=$2
               ON CONFLICT DO NOTHING`, [tenant.id, cap]);
    }
  }
  const call = (subject, operation, input, deps = { repo }) => executeAdminOperation(deps,
    { caller: { externalSubject: subject, identityProvider: "firebase" }, operation, input, requestId: `r-${operation}` });
  const roleId = async (tenant, key) => (await repo.getRoleByKey(tenant, key)).id;
  const principalOf = async (subject) => (await repo.getPrincipalBySubject("firebase", subject)).id;
  const person = async (tenant, subject, roleKeys, adminSubject) => {
    const made = await ensureTenantPrincipal(repo, { tenantId: tenant, externalSubject: subject, actorUid: OP, actorRoleKeys: ["admin"] });
    const principalId = made.principal?.id ?? made.id ?? made.principalId;
    for (const key of roleKeys) {
      const r = await call(adminSubject, "assignRole", { principalId, roleId: await roleId(tenant, key), reason: "fixture staffing" });
      assert.equal(r.ok, true, JSON.stringify(r));
    }
    return principalId;
  };
  const auditCount = async (tenant) => Number((await q(`SELECT count(*)::int n FROM eos_policy.audit_events WHERE tenant_id=$1`, [tenant])).rows[0].n);
  const cellState = async (tenant, roleKey, capabilityKey) => {
    const held = Number((await q(`SELECT count(*)::int n FROM eos_policy.role_capabilities rc JOIN eos_policy.roles r ON r.id=rc.role_id
      JOIN eos_policy.capabilities c ON c.id=rc.capability_id WHERE rc.tenant_id=$1 AND r.key=$2 AND c.key=$3`, [tenant, roleKey, capabilityKey])).rows[0].n);
    const current = (await q(`SELECT decision FROM eos_policy.role_capability_decisions WHERE tenant_id=$1 AND role_key=$2 AND capability_key=$3 AND superseded_at IS NULL`,
      [tenant, roleKey, capabilityKey])).rows.map((r) => r.decision);
    return { held, current };
  };

  const adminA1 = await principalOf("admin-a1");
  const adminA2 = await person(T.a, "admin-a2", ["admin"], "admin-a1");
  const ownerA = await person(T.a, "owner-a", ["owner"], "admin-a1");
  const dispA = await person(T.a, "disp-a", ["dispatcher"], "admin-a1");
  const techB = await person(T.b, "tech-b", ["technician"], "admin-b1");

  // ════════════════════ D1 ════════════════════
  await t.test("D1: a conditioned-only capability is NEVER in a flat set -- the audit read stays FORBIDDEN", async () => {
    assert.equal((await call("disp-a", "readPolicyAuditHistory", { limit: 1 })).code, "FORBIDDEN");
    // Through the command: the capability is not on the allow-list, so the condition is refused outright.
    const viaCommand = await call("admin-a1", "grantObjectActionToRole", { objectKey: "auditLog", actionKey: "read", roleKey: "dispatcher",
      reason: "narrow", condition: { paths: [[{ kind: "WORK_ELIGIBILITY", qualificationCode: "SERVICE_TECHNICIAN" }]] }, requiresCondition: true });
    assert.deepEqual([viaCommand.ok, viaCommand.code], [false, "INVALID_INPUT"]);
    assert.match(viaCommand.message, /CONDITION_NOT_SUPPORTED/);
    // Behind Administration's back (raw rows): the grant + an unsatisfiable condition. The PROVED defect
    // was ok:true here; the flat read gate now withholds the conditioned-only key.
    await q(`INSERT INTO eos_policy.capability_grant_conditions (id,tenant_id,grant_scope,grantor_key,capability_key,condition,established_by,updated_by)
             VALUES ('gc-d1',$1,'ROLE','dispatcher','audit.event.read','{"paths":[[{"kind":"WORK_ELIGIBILITY","qualificationCode":"NO_SUCH_QUALIFICATION"}]]}'::jsonb,'x','x')`, [T.a]);
    await q(`INSERT INTO eos_policy.role_capabilities (id,tenant_id,role_id,capability_id,granted_by,created_by,updated_by)
             SELECT 'rc-d1',$1,r.id,c.id,'x','x','x' FROM eos_policy.roles r, eos_policy.capabilities c WHERE r.tenant_id=$1 AND r.key='dispatcher' AND c.key='audit.event.read'`, [T.a]);
    const after = await call("disp-a", "readPolicyAuditHistory", { limit: 1 });
    assert.deepEqual([after.ok, after.code], [false, "FORBIDDEN"], "a condition was ignored by a flat-set gate");
    // The runtime context: withheld from `capabilities`, reported in `conditionallyHeld`.
    const ctx = await capabilityAuthority.resolveOperationalContext(repo, pool,
      { identityProvider: "firebase", externalSubject: "disp-a", requestedTenantId: null }, composition.postgresGrantConditionProvider(pool));
    assert.equal(ctx.capabilities.has("audit.event.read"), false);
    assert.equal(ctx.conditionallyHeld.has("audit.event.read"), true);
    // Clean up (fixture): drop the raw grant, then the condition (now allowed: not held).
    await q(`DELETE FROM eos_policy.role_capabilities WHERE id='rc-d1'`);
    await q(`UPDATE eos_policy.capability_grant_conditions SET status='RETIRED' WHERE id='gc-d1'`);
  });

  // ════════════════════ D2 / section 3 last-holder ════════════════════
  await t.test("D2: two administrators revoking each other concurrently -- exactly one succeeds, one admin remains", async () => {
    const adminRole = await roleId(T.a, "admin");
    const a1 = (await repo.listAssignmentsForPrincipal(T.a, adminA1)).find((a) => a.roleId === adminRole && a.status === "active");
    const a2 = (await repo.listAssignmentsForPrincipal(T.a, adminA2)).find((a) => a.roleId === adminRole && a.status === "active");
    const [r1, r2] = await Promise.all([
      call("admin-a1", "revokeRole", { assignmentId: a2.id, reason: "race" }),
      call("admin-a2", "revokeRole", { assignmentId: a1.id, reason: "race" }),
    ]);
    assert.equal([r1, r2].filter((r) => r.ok).length, 1, `${JSON.stringify(r1)} / ${JSON.stringify(r2)}`);
    const n = Number((await q(`SELECT count(*)::int n FROM eos_policy.user_role_assignments WHERE tenant_id=$1 AND role_id=$2 AND status='active'`, [T.a, adminRole])).rows[0].n);
    assert.equal(n, 1, "the tenant kept exactly one administrator");
    // Restore a second administrator for the proofs below (the survivor staffs it).
    const survivor = r1.ok ? "admin-a1" : "admin-a2";
    const revoked = r1.ok ? adminA2 : adminA1;
    const back = await call(survivor, "assignRole", { principalId: revoked, roleId: adminRole, reason: "restore" });
    assert.equal(back.ok, true, JSON.stringify(back));
  });

  // ════════════════════ D3 ════════════════════
  await t.test("D3: a grant insert racing a condition retire can never leave the grant held with its condition RETIRED", async () => {
    const setUp = await call("admin-a1", "setGrantCondition", { objectKey: "workOrder", actionKey: "read", roleKey: "officeManager",
      condition: { paths: [[{ kind: "RECORD_ASSIGNMENT", relation: "ASSIGNED_EMPLOYEE" }]], recordKind: "workOrder" }, reason: "prep" });
    assert.equal(setUp.ok, true, JSON.stringify(setUp));
    const office = await roleId(T.a, "officeManager");
    const cap = (await q(`SELECT id FROM eos_policy.capabilities WHERE key='workOrder.record.read'`)).rows[0].id;
    const c1 = await pool.connect();
    const c2 = await pool.connect();
    try {
      await c1.query("BEGIN");
      await c1.query(`INSERT INTO eos_policy.role_capabilities (id,tenant_id,role_id,capability_id,granted_by,created_by,updated_by)
                      VALUES ('rc_race',$1,$2,$3,'x','x','x')`, [T.a, office, cap]);
      // The retire now WAITS on the grant-cell lock the insert holds...
      const retire = c2.query(`UPDATE eos_policy.capability_grant_conditions SET status='RETIRED'
                                WHERE tenant_id=$1 AND grant_scope='ROLE' AND grantor_key='officeManager' AND capability_key='workOrder.record.read'`, [T.a])
        .then(() => "retired", (e) => e.message);
      await new Promise((r) => setTimeout(r, 300));
      await c1.query("COMMIT");
      // ...and, once the grant committed, sees it and refuses.
      assert.match(await retire, /CONDITION_RETIREMENT_WOULD_WIDEN/);
    } finally { c1.release(); c2.release(); }
    const status = (await q(`SELECT status FROM eos_policy.capability_grant_conditions WHERE tenant_id=$1 AND grantor_key='officeManager'`, [T.a])).rows[0].status;
    assert.equal(status, "ACTIVE", "held => still conditioned");
    // Command path: retire while held is refused inside the cell lock.
    const cmd = await call("admin-a1", "retireGrantCondition", { objectKey: "workOrder", actionKey: "read", roleKey: "officeManager", reason: "try" });
    assert.deepEqual([cmd.ok, cmd.code], [false, "CONFLICT"]);
  });

  // ════════════════════ D4 ════════════════════
  await t.test("D4: a DISABLED administrator is not a holder -- the last usable admin cannot revoke itself", async () => {
    const adminRole = await roleId(T.b, "admin");
    const b2 = await person(T.b, "admin-b2", ["admin"], "admin-b1");
    await q(`UPDATE eos_policy.principals SET status='disabled' WHERE id=$1`, [b2]);
    const b1 = await principalOf("admin-b1");
    const mine = (await repo.listAssignmentsForPrincipal(T.b, b1)).find((a) => a.roleId === adminRole && a.status === "active");
    const r = await call("admin-b1", "revokeRole", { assignmentId: mine.id, reason: "leave" });
    assert.deepEqual([r.ok, r.code], [false, "CONFLICT"], JSON.stringify(r));
    assert.match(r.message, /WOULD_REMOVE_LAST_ADMINISTRATION_PATH/);
    assert.equal((await call("admin-b1", "listRoles", {})).ok, true, "B1 still administers");
  });

  // ════════════════════ D5 ════════════════════
  await t.test("D5: Owner cannot self-assign admin, cannot appoint any OTHER security administrator Role, cannot reach ruling-A keys", async () => {
    const adminRole = await roleId(T.a, "admin");
    const self = await call("owner-a", "assignRole", { principalId: ownerA, roleId: adminRole, reason: "self" });
    assert.deepEqual([self.ok, self.code], [false, "FORBIDDEN"]);
    assert.match(self.message, /SELF_ADMINISTRATION/);
    // Owner ruling R1 (2026-09-26): Owner MAY staff the DESIGNATED Administrator Role for another principal through
    // admin.administratorRole.assign (administratorStaffingPostgres proves it in full). D5(b) still refuses every
    // OTHER Role carrying admin.securityPolicy.write.
    const made = await call("admin-a1", "createRole", { key: "d5SecurityClerk", name: "D5 security clerk", reason: "fixture" });
    assert.equal(made.ok, true, JSON.stringify(made));
    const g = await call("admin-a1", "grantObjectActionToRole", { objectKey: "rolesPermissions", actionKey: "editSecurityPolicy", roleKey: "d5SecurityClerk", reason: "fixture" });
    assert.equal(g.ok, true, JSON.stringify(g));
    const other = await call("owner-a", "assignRole", { principalId: dispA, roleId: await roleId(T.a, "d5SecurityClerk"), reason: "appoint" });
    assert.deepEqual([other.ok, other.code], [false, "FORBIDDEN"]);
    assert.match(other.message, /PRIVILEGE_ESCALATION/);
    const ctx = await capabilityAuthority.capabilitiesForRoleKeys(pool, T.a,
      (await repo.listAssignmentsForPrincipal(T.a, ownerA)).filter((a) => a.status === "active").map(() => "owner"));
    assert.equal(ctx.has("admin.securityPolicy.write"), false);
    const direct = await call("admin-a1", "grantObjectActionToPrincipal", { objectKey: "salesAgreement", actionKey: "accept", principalId: ownerA, reason: "x" });
    assert.deepEqual([direct.ok, direct.code], [false, "CONFLICT"]);
    assert.match(direct.message, /SYSTEM_INVARIANT/);
  });

  // ════════════════════ D6 ════════════════════
  await t.test("D6: a grant decided requiresCondition can never be held without an ACTIVE condition", async () => {
    const g = await call("admin-a1", "grantObjectActionToRole", { objectKey: "workOrder", actionKey: "read", roleKey: "fieldManager",
      condition: { paths: [[{ kind: "RECORD_ASSIGNMENT", relation: "ASSIGNED_EMPLOYEE" }]], recordKind: "workOrder" }, requiresCondition: true, reason: "must be conditioned" });
    assert.equal(g.ok, true, JSON.stringify(g));
    // Behind Administration's back: drop the grant, retire the (now un-held) condition, re-insert the grant.
    await q(`DELETE FROM eos_policy.role_capabilities rc USING eos_policy.roles r, eos_policy.capabilities c
              WHERE rc.role_id=r.id AND rc.capability_id=c.id AND rc.tenant_id=$1 AND r.key='fieldManager' AND c.key='workOrder.record.read'`, [T.a]);
    await q(`UPDATE eos_policy.capability_grant_conditions SET status='RETIRED' WHERE tenant_id=$1 AND grantor_key='fieldManager' AND capability_key='workOrder.record.read'`, [T.a]);
    await assert.rejects(() => q(`INSERT INTO eos_policy.role_capabilities (id,tenant_id,role_id,capability_id,granted_by,created_by,updated_by)
      SELECT 'rc-d6',$1,r.id,c.id,'x','x','x' FROM eos_policy.roles r, eos_policy.capabilities c WHERE r.tenant_id=$1 AND r.key='fieldManager' AND c.key='workOrder.record.read'`, [T.a]),
    /CONDITION_REQUIRED/);
  });

  // ════════════════════ P10-2 ════════════════════
  // Pass 10 P10-2: the never-widen trigger's count(*) runs after the cell lock, but under REPEATABLE READ /
  // SERIALIZABLE it reads the transaction's OLDER snapshot and missed a grant the lock holder had just committed.
  // Every snapshot-dependent cell check now refuses outside READ COMMITTED (ROLE and PRINCIPAL cells, and the
  // requires-condition check on a Role grant insert).
  await t.test("P10-2: a REPEATABLE READ raw retire (ROLE and PRINCIPAL cells) and a REPEATABLE READ conditioned insert are refused", async () => {
    const cond = { paths: [[{ kind: "RECORD_ASSIGNMENT", relation: "ASSIGNED_EMPLOYEE" }]], recordKind: "workOrder" };
    const cap = (await q(`SELECT id FROM eos_policy.capabilities WHERE key='workOrder.record.read'`)).rows[0].id;
    const made = await call("admin-a1", "createRole", { key: "p10RepeatableRead", name: "P10 repeatable read", reason: "fixture" });
    assert.equal(made.ok, true, JSON.stringify(made));
    const rrRole = await roleId(T.a, "p10RepeatableRead");
    const set = await call("admin-a1", "setGrantCondition", { objectKey: "workOrder", actionKey: "read", roleKey: "p10RepeatableRead", condition: cond, reason: "prep" });
    assert.equal(set.ok, true, JSON.stringify(set));
    await q(`INSERT INTO eos_policy.capability_grant_conditions (id,tenant_id,grant_scope,grantor_key,capability_key,condition,established_by,updated_by)
             VALUES ('gc-p10-principal',$1,'PRINCIPAL',$2,'workOrder.record.read',$3::jsonb,'x','x')`, [T.a, dispA, JSON.stringify(cond)]);
    const status = async (scope, grantor) => (await q(`SELECT status FROM eos_policy.capability_grant_conditions
      WHERE tenant_id=$1 AND grant_scope=$2 AND grantor_key=$3 ORDER BY status`, [T.a, scope, grantor])).rows.map((r) => r.status);

    // The PROVED race: an older snapshot, a grant committed behind it, then the retire.
    const race = async (scope, grantor, insertGrant) => {
      const rr = await pool.connect();
      try {
        await rr.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
        await rr.query("SELECT 1 FROM eos_policy.capabilities LIMIT 1"); // the snapshot is taken here
        await insertGrant(); // committed by another session, behind the snapshot
        const outcome = await rr.query(`UPDATE eos_policy.capability_grant_conditions SET status='RETIRED'
          WHERE tenant_id=$1 AND grant_scope=$2 AND grantor_key=$3 AND status='ACTIVE'`, [T.a, scope, grantor]).then(() => "RETIRED", (e) => e.message);
        await rr.query("ROLLBACK");
        return outcome;
      } finally { rr.release(); }
    };
    const roleOutcome = await race("ROLE", "p10RepeatableRead", () => q(`INSERT INTO eos_policy.role_capabilities (id,tenant_id,role_id,capability_id,granted_by,created_by,updated_by)
      VALUES ('rc-p10-rr',$1,$2,$3,'x','x','x')`, [T.a, rrRole, cap]));
    assert.match(roleOutcome, /CONDITION_RETIREMENT_REQUIRES_READ_COMMITTED/);
    assert.deepEqual(await status("ROLE", "p10RepeatableRead"), ["ACTIVE"], "held => still conditioned (ROLE)");
    const principalOutcome = await race("PRINCIPAL", dispA, () => q(`INSERT INTO eos_policy.principal_capabilities (id,tenant_id,principal_id,capability_id,granted_by,created_by,updated_by)
      VALUES ('pc-p10-rr',$1,$2,$3,'x','x','x')`, [T.a, dispA, cap]));
    assert.match(principalOutcome, /CONDITION_RETIREMENT_REQUIRES_READ_COMMITTED/);
    assert.deepEqual(await status("PRINCIPAL", dispA), ["ACTIVE"], "held => still conditioned (PRINCIPAL)");
    // SERIALIZABLE is refused the same way, even with no race at all.
    await assert.rejects(async () => {
      const c = await pool.connect();
      try {
        await c.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
        await c.query(`UPDATE eos_policy.capability_grant_conditions SET status='RETIRED' WHERE id='gc-p10-principal'`);
      } finally { await c.query("ROLLBACK").catch(() => {}); c.release(); }
    }, /CONDITION_RETIREMENT_REQUIRES_READ_COMMITTED/);
    // READ COMMITTED still decides on the facts: held => refused; revoked => the retire is allowed.
    await assert.rejects(() => q(`UPDATE eos_policy.capability_grant_conditions SET status='RETIRED' WHERE id='gc-p10-principal'`), /CONDITION_RETIREMENT_WOULD_WIDEN/);
    await q(`DELETE FROM eos_policy.principal_capabilities WHERE id='pc-p10-rr'`);
    await q(`UPDATE eos_policy.capability_grant_conditions SET status='RETIRED' WHERE id='gc-p10-principal'`);
    assert.deepEqual(await status("PRINCIPAL", dispA), ["RETIRED"]);

    // The insert side (D6 class): fieldManager x workOrder.record.read is decided requiresCondition (D6). A fresh
    // ACTIVE condition, an older snapshot, the condition retired behind it (un-held, so allowed), then the insert.
    const again = await call("admin-a1", "setGrantCondition", { objectKey: "workOrder", actionKey: "read", roleKey: "fieldManager", condition: cond, reason: "re-arm" });
    assert.equal(again.ok, true, JSON.stringify(again));
    const rr = await pool.connect();
    let insertOutcome;
    try {
      await rr.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
      await rr.query("SELECT 1 FROM eos_policy.capability_grant_conditions LIMIT 1");
      await q(`UPDATE eos_policy.capability_grant_conditions SET status='RETIRED' WHERE tenant_id=$1 AND grant_scope='ROLE' AND grantor_key='fieldManager'
                AND capability_key='workOrder.record.read' AND status='ACTIVE'`, [T.a]);
      insertOutcome = await rr.query(`INSERT INTO eos_policy.role_capabilities (id,tenant_id,role_id,capability_id,granted_by,created_by,updated_by)
        SELECT 'rc-p10-ins',$1,r.id,c.id,'x','x','x' FROM eos_policy.roles r, eos_policy.capabilities c
         WHERE r.tenant_id=$1 AND r.key='fieldManager' AND c.key='workOrder.record.read'`, [T.a]).then(() => "INSERTED", (e) => e.message);
      await rr.query("ROLLBACK");
    } finally { rr.release(); }
    assert.match(insertOutcome, /CONDITION_CHECK_REQUIRES_READ_COMMITTED/);
    assert.equal((await cellState(T.a, "fieldManager", "workOrder.record.read")).held, 0, "a requires-condition grant is never held unconditioned");
  });

  // ════════════════════ D8 / section 3 REVOKE vs RECONCILE ════════════════════
  await t.test("D8: a reconcile racing a revoke never re-inserts it; a raw insert of a revoked pair is refused", async () => {
    // dispatcher holds salesAgreement.accept by the catalog; revoke it while a reconcile runs.
    await reconcileInventoryCapabilityGrants(pool, { tenantId: T.a, apply: true, actor: "catalog", capabilityKeys: ["salesAgreement.accept"], roleKeys: ["dispatcher"] });
    assert.equal((await cellState(T.a, "dispatcher", "salesAgreement.accept")).held, 1);
    const [revoke, reconcile] = await Promise.all([
      call("admin-a1", "revokeObjectActionFromRole", { objectKey: "salesAgreement", actionKey: "accept", roleKey: "dispatcher", reason: "no selling" }),
      reconcileInventoryCapabilityGrants(pool, { tenantId: T.a, apply: true, actor: "catalog", capabilityKeys: ["salesAgreement.accept"], roleKeys: ["dispatcher"] }),
    ]);
    assert.equal(revoke.ok, true, JSON.stringify(revoke));
    void reconcile;
    const again = await reconcileInventoryCapabilityGrants(pool, { tenantId: T.a, apply: true, actor: "catalog", capabilityKeys: ["salesAgreement.accept"], roleKeys: ["dispatcher"] });
    assert.deepEqual(again.rows.map((r) => r.status), ["ADMIN_REVOKED"]);
    assert.deepEqual(await cellState(T.a, "dispatcher", "salesAgreement.accept"), { held: 0, current: ["ADMIN_REVOKED"] }, "no lost revoke");
    await assert.rejects(() => q(`INSERT INTO eos_policy.role_capabilities (id,tenant_id,role_id,capability_id,granted_by,created_by,updated_by)
      SELECT 'rc-d8',$1,r.id,c.id,'x','x','x' FROM eos_policy.roles r, eos_policy.capabilities c WHERE r.tenant_id=$1 AND r.key='dispatcher' AND c.key='salesAgreement.accept'`, [T.a]),
    /ADMIN_REVOKED/);
  });

  // ════════════════════ D9 ════════════════════
  await t.test("D9: re-granting an expired direct exception REFRESHES it -- the audited grant is effective", async () => {
    const cap = (await q(`SELECT id FROM eos_policy.capabilities WHERE key='workOrder.record.read'`)).rows[0].id;
    await q(`INSERT INTO eos_policy.principal_capabilities (id,tenant_id,principal_id,capability_id,granted_by,created_by,updated_by,exception_reason,expires_at)
             VALUES ('pc-d9',$1,$2,$3,'x','x','x','temp',now() - interval '1 minute')`, [T.a, dispA, cap]);
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const r = await call("admin-a1", "grantObjectActionToPrincipal", { objectKey: "workOrder", actionKey: "read", principalId: dispA, reason: "renew", expiresAt: future });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(Date.parse(r.data.expiresAt) > Date.now(), true);
    assert.equal((await repo.listPrincipalCapabilities(T.a, dispA)).length, 1);
    const cleanup = await call("admin-a1", "revokeObjectActionFromPrincipal", { objectKey: "workOrder", actionKey: "read", principalId: dispA, reason: "done" });
    assert.equal(cleanup.ok, true);
  });

  // ════════════════════ D10 ════════════════════
  await t.test("D10: the supersede stamp cannot be forged; governed history cannot be TRUNCATEd", async () => {
    const cur = (await q(`SELECT * FROM eos_policy.role_capability_decisions WHERE tenant_id=$1 AND superseded_at IS NULL LIMIT 1`, [T.a])).rows[0];
    const other = (await q(`SELECT * FROM eos_policy.role_capability_decisions WHERE id <> $1 LIMIT 1`, [cur.id])).rows[0];
    await assert.rejects(() => q(`UPDATE eos_policy.role_capability_decisions SET superseded_at='1970-01-01', superseded_by=$2 WHERE id=$1`, [cur.id, other.id]),
      /append-only/);
    await assert.rejects(() => q(`UPDATE eos_policy.role_capability_decisions SET superseded_at=now(), superseded_by=$2 WHERE id=$1`, [cur.id, other.id]),
      /append-only/);
    for (const table of ["audit_events", "role_capability_decisions", "capability_grant_conditions"]) {
      await assert.rejects(() => q(`TRUNCATE eos_policy.${table} CASCADE`), /TRUNCATE is refused/, table);
    }
  });

  // ════════════════════ section 3 ════════════════════
  await t.test("CONCURRENCY: GRANT vs GRANT (identical) is one row, one decision, one audit event", async () => {
    const before = await auditCount(T.a);
    const results = await Promise.all([1, 2, 3].map(() => call("admin-a1", "grantObjectActionToRole",
      { objectKey: "workOrder", actionKey: "dispatch", roleKey: "shopManager", reason: "same grant" })));
    assert.ok(results.every((r) => r.ok), JSON.stringify(results.filter((r) => !r.ok)));
    assert.deepEqual(await cellState(T.a, "shopManager", "workOrder.lifecycle.dispatch"), { held: 1, current: ["ADMIN_GRANTED"] });
    assert.equal(await auditCount(T.a) - before, 1, "exactly one mutation happened");
    assert.equal(new Set(results.map((r) => r.data.id)).size, 1, "every caller got the one row");
  });

  await t.test("CONCURRENCY: GRANT vs REVOKE ends deterministic -- held iff the current decision is ADMIN_GRANTED; audit complete", async () => {
    const cell = { objectKey: "workOrder", actionKey: "cancel", roleKey: "shopManager" };
    for (let round = 0; round < 5; round += 1) {
      const before = await auditCount(T.a);
      const decisionsBefore = Number((await q(`SELECT count(*)::int n FROM eos_policy.role_capability_decisions WHERE tenant_id=$1 AND role_key='shopManager' AND capability_key='workOrder.lifecycle.cancel'`, [T.a])).rows[0].n);
      const rs = await Promise.all([
        call("admin-a1", "grantObjectActionToRole", { ...cell, reason: `g${round}` }),
        call("admin-a2", "revokeObjectActionFromRole", { ...cell, reason: `r${round}` }),
      ]);
      assert.ok(rs.every((r) => r.ok), JSON.stringify(rs));
      const state = await cellState(T.a, "shopManager", "workOrder.lifecycle.cancel");
      assert.equal(state.current.length, 1, "one current decision");
      assert.equal(state.held, state.current[0] === "ADMIN_GRANTED" ? 1 : 0, `round ${round}: effective row agrees with the decision`);
      const decisionsAfter = Number((await q(`SELECT count(*)::int n FROM eos_policy.role_capability_decisions WHERE tenant_id=$1 AND role_key='shopManager' AND capability_key='workOrder.lifecycle.cancel'`, [T.a])).rows[0].n);
      assert.equal(await auditCount(T.a) - before, decisionsAfter - decisionsBefore, "every decision has exactly its audit event");
    }
  });

  await t.test("CONCURRENCY: SET vs RETIRE on an un-held cell ends with one row, consistent status, both audited", async () => {
    const cell = { objectKey: "workOrder", actionKey: "read", roleKey: "shopAssociate" };
    const cond = { paths: [[{ kind: "RECORD_ASSIGNMENT", relation: "ASSIGNED_EMPLOYEE" }]], recordKind: "workOrder" };
    assert.equal((await call("admin-a1", "setGrantCondition", { ...cell, condition: cond, reason: "seed" })).ok, true);
    const rs = await Promise.all([
      call("admin-a1", "setGrantCondition", { ...cell, condition: { ...cond, paths: [[{ kind: "WORK_ELIGIBILITY", qualificationCode: "SERVICE_TECHNICIAN" }]], recordKind: undefined }, reason: "set" }),
      call("admin-a2", "retireGrantCondition", { ...cell, reason: "retire" }),
    ]);
    assert.ok(rs.every((r) => r.ok), JSON.stringify(rs));
    const rows = (await q(`SELECT status FROM eos_policy.capability_grant_conditions WHERE tenant_id=$1 AND grantor_key='shopAssociate' AND capability_key='workOrder.record.read'`, [T.a])).rows;
    assert.equal(rows.length, 1, "one condition row per cell");
  });

  // ════════════════════ section 2: tenant isolation ════════════════════
  await t.test("TENANT ISOLATION: every control-plane operation is confined to the caller's tenant", async () => {
    const aBefore = await auditCount(T.a);
    const aDecisions = Number((await q(`SELECT count(*)::int n FROM eos_policy.role_capability_decisions WHERE tenant_id=$1`, [T.a])).rows[0].n);
    // Grant / revoke / condition by tenant B's admin touch ONLY tenant B, even for Role keys both tenants have.
    assert.equal((await call("admin-b1", "grantObjectActionToRole", { objectKey: "workOrder", actionKey: "dispatch", roleKey: "shopManager", reason: "b" })).ok, true);
    assert.equal((await call("admin-b1", "setGrantCondition", { objectKey: "workOrder", actionKey: "read", roleKey: "shopAssociate",
      condition: { paths: [[{ kind: "RECORD_ASSIGNMENT", relation: "ASSIGNED_EMPLOYEE" }]], recordKind: "workOrder" }, reason: "b" })).ok, true);
    assert.equal((await call("admin-b1", "revokeObjectActionFromRole", { objectKey: "workOrder", actionKey: "dispatch", roleKey: "shopManager", reason: "b" })).ok, true);
    assert.equal((await call("admin-b1", "retireGrantCondition", { objectKey: "workOrder", actionKey: "read", roleKey: "shopAssociate", reason: "b" })).ok, true);
    assert.equal(await auditCount(T.a), aBefore, "tenant A's audit untouched");
    assert.equal(Number((await q(`SELECT count(*)::int n FROM eos_policy.role_capability_decisions WHERE tenant_id=$1`, [T.a])).rows[0].n), aDecisions);
    assert.deepEqual(await cellState(T.a, "shopManager", "workOrder.lifecycle.dispatch"), { held: 1, current: ["ADMIN_GRANTED"] }, "A's cell unchanged");
    // Foreign ids: assignment, Role id, Principal (direct grant target and Employee-shaped id), explain.
    const aAssign = (await repo.listAssignmentsForPrincipal(T.a, dispA))[0];
    for (const [operation, input] of [
      ["revokeRole", { assignmentId: aAssign.id, reason: "x" }],
      ["assignRole", { principalId: dispA, roleId: await roleId(T.a, "admin"), reason: "x" }],
      ["assignRole", { principalId: techB, roleId: await roleId(T.a, "dispatcher"), reason: "x" }],
      ["grantObjectActionToPrincipal", { objectKey: "workOrder", actionKey: "read", principalId: dispA, reason: "x" }],
      ["grantObjectActionToPrincipal", { objectKey: "workOrder", actionKey: "read", principalId: "emp_00000000000000000000000000", reason: "x" }],
      ["explainEffectiveAccess", { principalId: dispA }],
    ]) {
      const r = await call("admin-b1", operation, input, { repo, explainEffectiveAccess: (tenantId, principalId) => explainEffectiveAccess(repo, pool, { tenantId, principalId }) });
      assert.equal(r.ok, false, `${operation} reached tenant A: ${JSON.stringify(r)}`);
    }
    // Reads: decision history, audit history (filtered by an A principal), Role holders.
    const history = await call("admin-b1", "listRoleCapabilityDecisionHistory", { limit: 500 });
    assert.ok(history.data.every((d) => d.tenantId === T.b));
    const audit = await call("admin-b1", "readPolicyAuditHistory", { principalId: adminA1, limit: 500 });
    assert.equal(audit.ok, true);
    assert.deepEqual(audit.data.filter((e) => e.tenantId !== T.b), []);
    assert.equal(audit.data.length, 0, "tenant A's actor has no events in tenant B");
    const holders = await call("admin-b1", "getSecurityRoleDetail", { roleKey: "dispatcher" });
    assert.ok(!holders.data.holders.some((h) => h.principalId === dispA));
    // The condition relation is tenant-keyed: B's rows never bind A's principals.
    const aCtx = await capabilityAuthority.resolveOperationalContext(repo, pool,
      { identityProvider: "firebase", externalSubject: "disp-a", requestedTenantId: null }, composition.postgresGrantConditionProvider(pool));
    assert.equal(aCtx.principalContext.tenantId, T.a);
    // Cross-tenant FK: a decision can never name another tenant's audit event.
    const bEvent = (await q(`SELECT id FROM eos_policy.audit_events WHERE tenant_id=$1 LIMIT 1`, [T.b])).rows[0].id;
    await assert.rejects(() => q(`INSERT INTO eos_policy.role_capability_decisions (id,tenant_id,role_key,capability_key,decision,reason,actor_principal_id,audit_event_id)
      VALUES ('d-x',$1,'dispatcher','audit.event.read','ADMIN_GRANTED','x','x',$2)`, [T.a, bEvent]), /foreign key/);
  });

  await t.test("AUDIT FILTERS: server-side, tenant-scoped, parameterized", async () => {
    const byCap = await call("admin-a1", "readPolicyAuditHistory", { capabilityKey: "salesAgreement.accept", limit: 50 });
    assert.equal(byCap.ok, true, JSON.stringify(byCap));
    assert.ok(byCap.data.length >= 1);
    assert.ok(byCap.data.every((e) => (e.after?.capabilityKey ?? e.before?.capabilityKey) === "salesAgreement.accept"));
    const byRole = await call("admin-a1", "readPolicyAuditHistory", { roleKey: "admin", limit: 500 });
    assert.ok(byRole.data.some((e) => e.action === "assignRole"), "assignment events match the Role by id");
    const future = await call("admin-a1", "readPolicyAuditHistory", { from: "2999-01-01T00:00:00Z", limit: 50 });
    assert.deepEqual(future.data, []);
    const injected = await call("admin-a1", "readPolicyAuditHistory", { objectKey: "x') OR true --", limit: 50 });
    assert.deepEqual([injected.ok, injected.data.length], [true, 0]);
    const bad = await call("admin-a1", "readPolicyAuditHistory", { from: "not a date" });
    assert.deepEqual([bad.ok, bad.code], [false, "INVALID_INPUT"]);
  });
});
