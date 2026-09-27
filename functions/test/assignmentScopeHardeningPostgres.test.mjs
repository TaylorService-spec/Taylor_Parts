// ASSIGNMENT SCOPE HARDENING (layer 4) -- Pass 9 S1/S2/S3/S7 regressions, against PostgreSQL.
//
// Source: round4-analysis/pass9-security-review.md. These are the PROVED probes that test the lane SC assignment
// scope runtime ITSELF (not the Functional Role layer); each failed before its fix and passes after it.
//
//   S1  a scoped / stale assignment is never tenant-wide on the Administration read gates
//   S2  no Administration key is granted to a Role with scoped holders; a scoped holder may not widen its own Role;
//       assignRole's scope check runs under the governance lock
//   S3  the operator actor resolution (and the assignability report) count GLOBAL, non-stale assignments only
//   S7  a scoped holder gets the same refusal for an out-of-scope Employee as for a missing id
//
// The Functional Role cases (S4, S5, S6) live in administrationScopeSecurityPostgres.test.mjs (lane FR).
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import pg from "pg";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");
const { bootstrapTenant, bootstrapAdministrator, ensureTenantPrincipal } = require("../lib/adminPolicy/tenantBootstrap.js");
const { executeAdminOperation } = require("../lib/adminPolicy/adminPolicyApi.js");
const capabilityAuthority = require("../lib/eosOps/capabilityAuthority.js");
const composition = require("../lib/eosOps/entitledActionAuthority.js");
const workforce = require("../lib/eosWorkforce/workforceHttp.js");
const actorAuthority = require("../lib/eosWorkforce/commands/employeeAdministrationAuthority.js");
const assignabilityReport = require("../lib/eosWorkforce/migration/partsAssignabilityExclusionReport.js");
const { isAdministrationCapability } = require("../lib/adminPolicy/assignmentScopeRuntime.js");
const { ADMINISTRATION_READ_CAPABILITY_KEYS } = require("../lib/adminPolicy/administrationSurfaceAuthority.js");

const OP = "operator-scope-hardening";
const R = "a governed reason for the scope hardening regression";
const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) { const c = new pg.Client({ connectionString: url }); await c.connect(); try { return await fn(c); } finally { await c.end(); } }

test("assignment scope hardening (Pass 9 S1/S2/S3/S7): scoped holdings never reach tenant-wide authority", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `schard_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
  let pool;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => { await pool?.end(); await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)); });
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations", "--no-check-order"],
    { cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrlFor(name) }, stdio: "pipe" });
  pool = new pg.Pool({ connectionString: dbUrlFor(name), max: 16 });
  const q = (s, v = []) => pool.query(s, v);
  const repo = new PostgresPolicyRepository(pool);
  const { tenant } = await bootstrapTenant(repo, { key: "schard-a", name: "a", actorUid: OP });
  const T = tenant.id;
  await bootstrapAdministrator(repo, { tenantId: T, externalSubject: "admin-a", performedBy: OP, reason: "boot" });
  await q(`INSERT INTO eos_policy.role_capabilities (id,tenant_id,role_id,capability_id,granted_by,created_by,updated_by)
           SELECT 'rc-fx-' || md5($1 || c.id), $1, r.id, c.id, 'fixture','fixture','fixture'
             FROM eos_policy.roles r, eos_policy.capabilities c WHERE r.tenant_id=$1 AND r.key='admin'
              AND c.key IN ('admin.principalAccess.read','audit.event.read')
           ON CONFLICT DO NOTHING`, [T]);
  for (const company of ["taylor", "ventana"]) {
    await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id,operating_company_id,status,source,established_by,updated_by)
             VALUES ($1,$2,'ACTIVE','fixture','fixture','fixture')`, [T, company]);
  }
  const call = (subject, operation, input = {}) => executeAdminOperation({ repo },
    { caller: { externalSubject: subject, identityProvider: "firebase" }, operation, input, requestId: `r-${operation}` });
  const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.data; };
  const roleIdOf = async (key) => (await repo.getRoleByKey(T, key)).id;
  const wf = (subject, operation, input = {}) => workforce.executeWorkforceOperation({ reader: repo, pool },
    { caller: { externalSubject: subject, identityProvider: "firebase", requestedTenantId: null }, operation, input });
  const person = async (subject) => {
    const made = await ensureTenantPrincipal(repo, { tenantId: T, externalSubject: subject, actorUid: OP, actorRoleKeys: ["admin"] });
    return made.principal?.id ?? made.id ?? made.principalId;
  };
  const defineRole = async (key, grants, admin = "admin-a") => {
    ok(await call(admin, "createRole", { key, name: key, reason: R }));
    for (const [objectKey, actionKey] of grants) ok(await call(admin, "grantObjectActionToRole", { objectKey, actionKey, roleKey: key, reason: R }));
  };
  const assign = (subject, principalId, roleId, scopeType, scopeValue) => call(subject, "assignRole",
    { principalId, roleId, reason: R, ...(scopeType ? { scopeType } : {}), ...(scopeValue !== undefined ? { scopeValue } : {}) });
  /** A raw scoped (or stale) row, as a legacy writer or an older build might have left it. */
  const rawAssignment = async (principalId, roleKey, scopeType, scopeValue, version = 0) => q(
    `INSERT INTO eos_policy.user_role_assignments (id,tenant_id,principal_id,role_id,scope_type,scope_value,status,granted_by,granted_at,access_version_at_grant,created_by,updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,'active','raw',now(),$7,'raw','raw')`,
    [`ura-${randomUUID()}`, T, principalId, await roleIdOf(roleKey), scopeType, scopeValue, version]);
  const context = (subject) => capabilityAuthority.resolveOperationalContext(repo, pool,
    { identityProvider: "firebase", externalSubject: subject, requestedTenantId: null }, composition.postgresGrantConditionProvider(pool));

  for (const [id, company] of [["e-t1", "taylor"], ["e-v1", "ventana"], ["e-hr", "taylor"], ["e-hr2", "taylor"]]) {
    await q(`INSERT INTO eos_workforce.employees (id,tenant_id,employment_status,operating_company_id,employee_number) VALUES ($1,$2,'ACTIVE',$3,$1)`, [id, T, company]);
  }
  const admin2 = await person("admin2-a");
  ok(await assign("admin-a", admin2, await roleIdOf("admin")));

  await defineRole("companyAuditor", [["employee", "read"], ["auditLog", "read"], ["workflowDefinition", "read"]]);
  await defineRole("companyReader", [["employee", "read"]]);
  const scoped = await person("scoped-a");
  await rawAssignment(scoped, "companyAuditor", "operatingCompany", "taylor");

  await t.test("the Administration capability set is defined once and covers every Administration surface read key", () => {
    for (const key of ADMINISTRATION_READ_CAPABILITY_KEYS) assert.equal(isAdministrationCapability(key), true, key);
    for (const key of ["audit.event.read", "workflowDefinition.read", "workflowDefinition.publish", "admin.securityPolicy.write"]) {
      assert.equal(isAdministrationCapability(key), true, key);
    }
    for (const key of ["employee.record.read", "workOrder.transition"]) assert.equal(isAdministrationCapability(key), false, key);
  });

  // ════════════════════ S1 ════════════════════
  await t.test("S1: a SCOPED holder of audit.event.read / workflowDefinition.read is refused the tenant-wide Administration reads", async () => {
    const ctx = await context("scoped-a");
    assert.equal(ctx.capabilities.has("audit.event.read"), false);
    const audit = await call("scoped-a", "readPolicyAuditHistory", {});
    assert.deepEqual([audit.ok, audit.code], [false, "FORBIDDEN"], JSON.stringify(audit));
    const wfl = await call("scoped-a", "listWorkflows", {});
    assert.deepEqual([wfl.ok, wfl.code], [false, "FORBIDDEN"]);
    const eff = ok(await call("admin-a", "getPrincipalEffectiveAccess", { principalId: scoped }));
    const keys = eff.effective.map((c) => c.capabilityKey);
    for (const key of ["audit.event.read", "workflowDefinition.read", "employee.record.read"]) assert.equal(keys.includes(key), false, key);
    assert.deepEqual(eff.roles, [], "a scoped Role is not an effective (global) Role");
  });

  await t.test("S1: a STALE global assignment is not effective on the Administration read gate either", async () => {
    const stale = await person("stale-a");
    await rawAssignment(stale, "companyAuditor", "global", null, 999);
    const audit = await call("stale-a", "readPolicyAuditHistory", {});
    assert.deepEqual([audit.ok, audit.code], [false, "FORBIDDEN"]);
  });

  // ════════════════════ S2 ════════════════════
  const reader = await person("reader-a");
  ok(await assign("admin-a", reader, await roleIdOf("companyReader"), "operatingCompany", "taylor"));
  await t.test("S2: an Administration key granted to a Role with an ACTIVE scoped holder is REFUSED, and the holder stays refused", async () => {
    for (const [objectKey, actionKey] of [["principal", "read"], ["auditLog", "read"], ["workflowDefinition", "read"]]) {
      const g = await call("admin-a", "grantObjectActionToRole", { objectKey, actionKey, roleKey: "companyReader", reason: R });
      assert.equal(g.ok, false, `${objectKey}/${actionKey}: ${JSON.stringify(g)}`);
      assert.match(g.message, /SCOPE_AMBIGUOUS_ADMINISTRATION/);
    }
    assert.equal((await call("reader-a", "listTenantPrincipals", {})).ok, false);
    // A non-Administration key is still grantable to it.
    ok(await call("admin-a", "grantObjectActionToRole", { objectKey: "account", actionKey: "read", roleKey: "companyReader", reason: R }));
  });

  await t.test("S2: a Role carrying audit.event.read or workflowDefinition.read cannot be ASSIGNED with a scope", async () => {
    const p = await person("scoped-b");
    const r = await assign("admin-a", p, await roleIdOf("companyAuditor"), "operatingCompany", "taylor");
    assert.equal(r.ok, false);
    assert.match(r.message, /SCOPE_AMBIGUOUS_ADMINISTRATION/);
  });

  await t.test("S2: a principal holding a Role only through a SCOPED assignment may not widen that Role (self-grant)", async () => {
    ok(await assign("admin-a", admin2, await roleIdOf("companyReader"), "operatingCompany", "taylor"));
    const g = await call("admin2-a", "grantObjectActionToRole", { objectKey: "employee", actionKey: "assignJobRole", roleKey: "companyReader", reason: R });
    assert.equal(g.ok, false);
    assert.match(g.message, /SELF_ADMINISTRATION/);
  });

  await t.test("S2: a scoped assignRole racing an Administration grant never leaves both committed (checks run under the governance lock)", async () => {
    for (let i = 0; i < 4; i += 1) {
      const key = `raceRole${i}`;
      await defineRole(key, [["employee", "read"]]);
      const p = await person(`race-${i}`);
      const [a, g] = await Promise.all([
        assign("admin-a", p, await roleIdOf(key), "operatingCompany", "taylor"),
        call("admin2-a", "grantObjectActionToRole", { objectKey: "auditLog", actionKey: "read", roleKey: key, reason: R }),
      ]);
      assert.ok(!(a.ok && g.ok), `both committed on iteration ${i}: a scoped Role now carries Administration authority`);
      assert.ok(a.ok || g.ok, "one of the two must succeed");
    }
  });

  // ════════════════════ S3 ════════════════════
  await t.test("S3: the operator actor resolution counts GLOBAL, non-stale assignments only", async () => {
    const actor = await actorAuthority.resolveEmployeeAdministrationActor(pool, { tenantId: T, principalId: scoped });
    assert.deepEqual([...actor.heldRoleKeys], []);
    assert.equal(actor.capabilities.has("employee.record.read"), false);
    assert.equal(actor.capabilities.has("audit.event.read"), false);
    const stale = (await q(`SELECT id FROM eos_policy.principals WHERE external_subject = 'stale-a'`)).rows[0].id;
    const staleActor = await actorAuthority.resolveEmployeeAdministrationActor(pool, { tenantId: T, principalId: stale });
    assert.deepEqual([...staleActor.heldRoleKeys], []);
    const globalActor = await actorAuthority.resolveEmployeeAdministrationActor(pool, { tenantId: T, principalId: admin2 });
    assert.ok(globalActor.heldRoleKeys.includes("admin"), "a global holder is unchanged");
  });

  await t.test("S3: the parts-assignability report reads GLOBAL, non-stale Roles only", async () => {
    await q(`INSERT INTO eos_policy.employee_principal_links (id,tenant_id,principal_id,employee_id,operating_company_id,link_source,asserted_by,assertion_reason)
             VALUES ('epl-scoped',$1,$2,'e-t1','taylor','OPERATOR_ASSERTED','fx','fixture')`, [T, scoped]);
    const facts = await assignabilityReport.buildGovernedEmployeeFacts(pool, T);
    assert.deepEqual(facts.get("e-t1").securityRoleKeys, [], "the scoped companyAuditor assignment is not a tenant-wide Role");
  });

  // ════════════════════ S7 ════════════════════
  await t.test("S7: a scoped holder cannot tell an out-of-scope Employee from a missing one; a global holder is unchanged", async () => {
    const inside = await wf("reader-a", "readEmployee", { employeeId: "e-t1" });
    assert.equal(inside.ok, true, JSON.stringify(inside));
    const outside = await wf("reader-a", "readEmployee", { employeeId: "e-v1" });
    const missing = await wf("reader-a", "readEmployee", { employeeId: "e-nope" });
    assert.deepEqual([outside.ok, outside.code, outside.status, outside.message], [false, missing.code, missing.status, missing.message]);
    assert.equal(missing.code, "EMPLOYEE_NOT_FOUND");
    const mgr = await wf("reader-a", "listManagedEmployees", { managerEmployeeId: "e-v1" });
    const mgrMissing = await wf("reader-a", "listManagedEmployees", { managerEmployeeId: "e-nope" });
    assert.deepEqual([mgr.code, mgr.status], [mgrMissing.code, mgrMissing.status]);
    // A global holder: reads the ventana Employee, and a missing id is still NOT_FOUND.
    await defineRole("globalEmployeeReader", [["employee", "read"]]);
    const globalReader = await person("global-reader-a");
    ok(await assign("admin-a", globalReader, await roleIdOf("globalEmployeeReader")));
    assert.equal((await wf("global-reader-a", "readEmployee", { employeeId: "e-v1" })).ok, true);
    assert.equal((await wf("global-reader-a", "readEmployee", { employeeId: "e-nope" })).code, "EMPLOYEE_NOT_FOUND");
  });
});
