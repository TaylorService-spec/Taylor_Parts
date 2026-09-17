// EMP-RT-W1A (#1931): the governed PostgreSQL Employee profile command against a real postgres:16.
//
// The suite migrates its OWN disposable database. Roles, grants, Principals and Employees exist ONLY there; grants are
// delivered through the EXISTING Role-catalog reconciliation and actors are resolved through the EXISTING operational
// context resolver -- never hand-built capability sets. Offline refusals are employeeProfileCommand.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import pg from "pg";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const command = require("../lib/eosWorkforce/commands/employeeProfileCommand.js");
const grants = require("../lib/eosWorkforce/migration/employeeCapabilityGrants.js");
const { resolveOperationalContext } = require("../lib/eosOps/capabilityAuthority.js");
const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");

const dbUrlFor = (name) => { const u = new URL(URL_BASE); u.pathname = `/${name}`; return u.toString(); };
async function withClient(url, fn) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try { return await fn(client); } finally { await client.end(); }
}

const PROFILE_SELECT = `SELECT employee_number, display_name, first_name, job_title, work_email, address_city, address_postal_code,
  to_char(hire_date, 'YYYY-MM-DD') AS hire_date, updated_at FROM eos_workforce.employees WHERE id = $1`;

test("updateEmployeeProfile over the real Workforce and policy authorities", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `emp_profile_cmd_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let pool;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => {
    await pool?.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations"], {
    cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrlFor(name) }, stdio: "pipe",
  });
  pool = new pg.Pool({ connectionString: dbUrlFor(name), max: 8 });
  const q = (text, values = []) => pool.query(text, values);
  const repo = new PostgresPolicyRepository(pool);
  await q(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ('t1','t1','T1'), ('t2','t2','T2')`);

  const fixture = (tenantId) => ({ tenantId, uid: "uid-fixture-admin" });
  const roleIds = {};
  for (const tenantId of ["t1", "t2"]) {
    for (const key of ["admin", "generalManager"]) {
      roleIds[`${tenantId}:${key}`] = (await repo.transact(fixture(tenantId), (tx) => tx.createRole({ key, name: key, description: null, origin: "CUSTOM", protected: false }))).id;
    }
    await grants.reconcileEmployeeCapabilityGrants(pool, { tenantId, apply: true, actor: "employee-capability-grants:test" });
  }
  const makePrincipal = async (tenantId, subject, roleKey) => {
    const principalId = await repo.transact(fixture(tenantId), async (tx) => {
      const p = await tx.createPrincipal({ externalSubject: subject, identityProvider: "firebase" });
      await tx.createTenantMembership(p.id);
      return p.id;
    });
    await repo.transact(fixture(tenantId), async (tx) => {
      const accessVersion = await tx.bumpAccessVersion(principalId);
      return tx.createAssignment({ principalId, roleId: roleIds[`${tenantId}:${roleKey}`], scopeType: "global", scopeValue: null, status: "active", grantedBy: "fixture", grantedAt: new Date().toISOString(), accessVersionAtGrant: accessVersion });
    });
    return { principalId, subject };
  };
  const resolveActor = async (principal) => {
    const ctx = await resolveOperationalContext(repo, pool, { identityProvider: "firebase", externalSubject: principal.subject, requestedTenantId: null });
    return { tenantId: ctx.principalContext.tenantId, principalId: ctx.principalContext.uid, capabilities: ctx.capabilities };
  };
  const employee = (id, tenant = "t1", extra = {}) => {
    const cols = Object.keys(extra);
    return q(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id, updated_at${cols.map((c) => `, ${c}`).join("")})
              VALUES ($1, $2, 'ACTIVE', 'taylor', '2020-01-01T00:00:00Z'${cols.map((_, i) => `, $${i + 3}`).join("")})`, [id, tenant, ...Object.values(extra)]);
  };
  const profile = async (id) => (await q(PROFILE_SELECT, [id])).rows[0];
  const audits = async (id) => (await q(`SELECT action, actor_uid, before, after, reason FROM eos_policy.audit_events WHERE target_kind = 'employee' AND target_id = $1 ORDER BY occurred_at, id`, [id])).rows;

  const admin = await makePrincipal("t1", "firebase-uid-admin", "admin");
  const gm = await makePrincipal("t1", "firebase-uid-gm", "generalManager");
  const t2Admin = await makePrincipal("t2", "firebase-uid-t2-admin", "admin");
  await employee("e-edit", "t1", { display_name: "Robert Jones", first_name: "Robert", job_title: "Tech", employee_number: "TAZ-0001" });
  await employee("e-other", "t1", { employee_number: "TAZ-0002" });
  await employee("e-t2", "t2", { display_name: "Foreign", employee_number: "TAZ-0009" });
  // e-linked is linked to the admin Principal: the Principal id must never stand in for the Employee id.
  await employee("e-linked", "t1", { display_name: "Admin Person" });
  await q(`INSERT INTO eos_policy.employee_principal_links (id, tenant_id, principal_id, employee_id, operating_company_id, link_source, asserted_by, assertion_reason)
           VALUES ('epl-admin', 't1', $1, 'e-linked', 'taylor', 'OPERATOR_ASSERTED', 'fixture-operator', 'test fixture')`, [admin.principalId]);

  const deps = { pool };
  const adminActor = await resolveActor(admin);
  assert.ok(adminActor.capabilities.has("admin.employeeProfile.write"), "the fixture admin did not resolve the write capability");

  await t.test("UPDATED: normalized values, only changed columns, updated_at, one audit event naming the Principal", async () => {
    const res = await command.updateEmployeeProfile(deps, adminActor, {
      employeeId: "e-edit",
      reason: "HR correction",
      changes: { jobTitle: "  Service Lead ", firstName: "Robert", workEmail: "bob@example.com", "address.city": "Phoenix", "address.postalCode": "", hireDate: "2019-05-06" },
    });
    assert.equal(res.outcome, "UPDATED");
    assert.deepEqual(res.changedFields, ["jobTitle", "workEmail", "address.city", "hireDate"]);
    const row = await profile("e-edit");
    assert.deepEqual({ ...row, updated_at: undefined }, {
      employee_number: "TAZ-0001", display_name: "Robert Jones", first_name: "Robert", job_title: "Service Lead", work_email: "bob@example.com",
      address_city: "Phoenix", address_postal_code: null, hire_date: "2019-05-06", updated_at: undefined,
    });
    assert.ok(row.updated_at > new Date("2020-01-02"), "updated_at was not advanced");
    const trail = await audits("e-edit");
    assert.equal(trail.length, 1);
    assert.equal(trail[0].action, "employee.profile.update");
    assert.equal(trail[0].actor_uid, admin.principalId);
    assert.notEqual(trail[0].actor_uid, admin.subject, "a provider subject was recorded as the actor");
    assert.equal(trail[0].reason, "HR correction");
    assert.deepEqual(trail[0].before, { jobTitle: "Tech", workEmail: null, "address.city": null, hireDate: null });
    assert.deepEqual(trail[0].after, { jobTitle: "Service Lead", workEmail: "bob@example.com", "address.city": "Phoenix", hireDate: "2019-05-06" });
    const other = await profile("e-other");
    assert.equal(other.job_title, null, "another Employee was written");
  });

  await t.test("NO_CHANGE: an identical submission writes nothing, bumps nothing, audits nothing", async () => {
    const before = await profile("e-edit");
    const res = await command.updateEmployeeProfile(deps, adminActor, { employeeId: "e-edit", changes: { jobTitle: "Service Lead", "address.postalCode": null, hireDate: "2019-05-06" } });
    assert.deepEqual(res, { outcome: "NO_CHANGE", employeeId: "e-edit", changedFields: [], auditEventId: null });
    assert.deepEqual(await profile("e-edit"), before);
    assert.equal((await audits("e-edit")).length, 1);
  });

  await t.test("clearing is a change; employee number is unique case-insensitively per tenant, never globally", async () => {
    await assert.rejects(command.updateEmployeeProfile(deps, adminActor, { employeeId: "e-edit", changes: { employeeNumber: "taz-0002" } }), (e) => e.code === "EMPLOYEE_NUMBER_TAKEN" && e.category === "CONFLICT");
    assert.equal((await profile("e-edit")).employee_number, "TAZ-0001");
    const recased = await command.updateEmployeeProfile(deps, adminActor, { employeeId: "e-edit", changes: { employeeNumber: "taz-0001" } });
    assert.deepEqual(recased.changedFields, ["employeeNumber"], "its own number in another case is not a conflict");
    const foreignNumber = await command.updateEmployeeProfile(deps, adminActor, { employeeId: "e-other", changes: { employeeNumber: "TAZ-0009" } });
    assert.equal(foreignNumber.outcome, "UPDATED", "a number held only in another tenant was refused");
    const cleared = await command.updateEmployeeProfile(deps, adminActor, { employeeId: "e-edit", changes: { workEmail: "  " } });
    assert.deepEqual([cleared.outcome, (await profile("e-edit")).work_email], ["UPDATED", null]);
  });

  await t.test("capability: a General Manager (employee.record.read only) is refused and nothing is written", async () => {
    const gmActor = await resolveActor(gm);
    assert.ok(gmActor.capabilities.has("employee.record.read"));
    const before = await profile("e-edit");
    await assert.rejects(command.updateEmployeeProfile(deps, gmActor, { employeeId: "e-edit", changes: { jobTitle: "GM was here" } }), (e) => e.code === "CAPABILITY_REQUIRED");
    assert.deepEqual(await profile("e-edit"), before);
  });

  await t.test("tenant isolation: a foreign-tenant Employee is NOT_FOUND in both directions; the rows are untouched", async () => {
    await assert.rejects(command.updateEmployeeProfile(deps, adminActor, { employeeId: "e-t2", changes: { jobTitle: "cross" } }), (e) => e.code === "EMPLOYEE_NOT_FOUND");
    const t2Actor = await resolveActor(t2Admin);
    await assert.rejects(command.updateEmployeeProfile(deps, t2Actor, { employeeId: "e-edit", changes: { jobTitle: "cross" } }), (e) => e.code === "EMPLOYEE_NOT_FOUND");
    // An actor context naming a tenant the Principal is not a member of is refused, even with the capability in hand.
    await assert.rejects(command.updateEmployeeProfile(deps, { ...adminActor, tenantId: "t2" }, { employeeId: "e-t2", changes: { jobTitle: "cross" } }), (e) => e.code === "ACTOR_NOT_TENANT_MEMBER");
    assert.equal((await profile("e-t2")).job_title, null);
    assert.notEqual((await profile("e-edit")).job_title, "cross");
  });

  await t.test("Employee id vs Principal id: neither the Principal id nor the provider subject resolves to the linked Employee", async () => {
    for (const substitute of [admin.principalId, admin.subject]) {
      await assert.rejects(command.updateEmployeeProfile(deps, adminActor, { employeeId: substitute, changes: { jobTitle: "via principal" } }), (e) => e.code === "EMPLOYEE_NOT_FOUND", substitute);
    }
    assert.equal((await profile("e-linked")).job_title, null);
    const direct = await command.updateEmployeeProfile(deps, adminActor, { employeeId: "e-linked", changes: { jobTitle: "Administrator" } });
    assert.equal(direct.outcome, "UPDATED");
  });

  await t.test("inactive membership and inactive Principal are refused inside the transaction", async () => {
    const temp = await makePrincipal("t1", "firebase-uid-temp-admin", "admin");
    const tempActor = await resolveActor(temp);
    await q(`UPDATE eos_policy.tenant_memberships SET status = 'disabled' WHERE principal_id = $1`, [temp.principalId]);
    await assert.rejects(command.updateEmployeeProfile(deps, tempActor, { employeeId: "e-other", changes: { jobTitle: "stale session" } }), (e) => e.code === "ACTOR_NOT_TENANT_MEMBER");
    await q(`UPDATE eos_policy.tenant_memberships SET status = 'active' WHERE principal_id = $1`, [temp.principalId]);
    await q(`UPDATE eos_policy.principals SET status = 'disabled' WHERE id = $1`, [temp.principalId]);
    await assert.rejects(command.updateEmployeeProfile(deps, tempActor, { employeeId: "e-other", changes: { jobTitle: "stale session" } }), (e) => e.code === "ACTOR_NOT_TENANT_MEMBER");
    assert.equal((await profile("e-other")).job_title, null);
  });

  await t.test("atomicity: an audit failure rolls back the profile update", async () => {
    const before = await profile("e-other");
    const auditsBefore = (await audits("e-other")).length;
    await q(`CREATE FUNCTION test_refuse_profile_audit() RETURNS trigger AS $$ BEGIN
               IF NEW.action = 'employee.profile.update' THEN RAISE EXCEPTION 'injected audit failure'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
    await q(`CREATE TRIGGER test_refuse_profile_audit BEFORE INSERT ON eos_policy.audit_events FOR EACH ROW EXECUTE FUNCTION test_refuse_profile_audit()`);
    try {
      await assert.rejects(command.updateEmployeeProfile(deps, adminActor, { employeeId: "e-other", changes: { jobTitle: "must not persist" } }), (e) => e.code === "COMMAND_FAILED" && !/injected/.test(e.message));
    } finally {
      await q(`DROP TRIGGER test_refuse_profile_audit ON eos_policy.audit_events`);
      await q(`DROP FUNCTION test_refuse_profile_audit()`);
    }
    assert.deepEqual(await profile("e-other"), before);
    assert.equal((await audits("e-other")).length, auditsBefore);
  });

  // ════════════════════ mutation controls ════════════════════
  // Each check above is load-bearing: a compiled copy of the command with ONE guard weakened must let the matching
  // refusal through. If a mutant still refuses, the scenario was not actually proving that guard.
  await t.test("mutation controls: tenant predicate, capability check and Employee-vs-Principal identity are each load-bearing", async () => {
    const LIB = join(FUNCTIONS_DIR, "lib", "eosWorkforce");
    const kernelSrc = readFileSync(join(LIB, "commands", "employeeCommandKernel.js"), "utf8");
    const mutant = (label, from, to) => {
      assert.ok(kernelSrc.includes(from), `${label}: mutation anchor not found -- the kernel changed, update the control`);
      const dir = mkdtempSync(join(tmpdir(), `emp-profile-mutant-${label}-`));
      cpSync(LIB, join(dir, "eosWorkforce"), { recursive: true });
      writeFileSync(join(dir, "eosWorkforce", "commands", "employeeCommandKernel.js"), kernelSrc.replace(from, to));
      return require(join(dir, "eosWorkforce", "commands", "employeeProfileCommand.js"));
    };
    const LOCK = "WHERE tenant_id = $1 AND id = $2 FOR UPDATE";

    const noTenant = mutant("tenant", LOCK, "WHERE $1::text IS NOT NULL AND id = $2 FOR UPDATE");
    const leaked = await noTenant.updateEmployeeProfile(deps, adminActor, { employeeId: "e-t2", changes: { jobTitle: "mutant" } }).then(() => "accepted", (e) => e.code);
    assert.notEqual(leaked, "EMPLOYEE_NOT_FOUND", "without the tenant predicate the foreign Employee was still refused: the isolation test is vacuous");

    const noCapability = mutant("capability", "if (!actor.capabilities.has(exports.EMPLOYEE_PROFILE_WRITE))", "if (false)");
    const gmActor = await resolveActor(gm);
    const escalated = await noCapability.updateEmployeeProfile(deps, gmActor, { employeeId: "e-other", changes: { jobTitle: "mutant gm" } }).then((r) => r.outcome, (e) => e.code);
    assert.equal(escalated, "UPDATED", "without the capability check the General Manager was still refused: the capability test is vacuous");

    const principalLookup = mutant("identity", LOCK,
      "WHERE tenant_id = $1 AND (id = $2 OR id = (SELECT employee_id FROM eos_policy.employee_principal_links WHERE tenant_id = $1 AND principal_id = $2 LIMIT 1)) FOR UPDATE");
    const substituted = await principalLookup.updateEmployeeProfile(deps, adminActor, { employeeId: admin.principalId, changes: { jobTitle: "mutant principal" } }).then(() => "accepted", (e) => e.code);
    assert.notEqual(substituted, "EMPLOYEE_NOT_FOUND", "a Principal-id lookup mutant was still refused: the identity test is vacuous");
  });
});
