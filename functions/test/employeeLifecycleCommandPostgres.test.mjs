// EMP-RT-W2: the governed PostgreSQL Employee LIFECYCLE writer (employment status, operating company) against a real postgres:16.
//
// The suite migrates its OWN disposable database. Roles, grants, Principals and Employees exist ONLY there; grants are
// delivered through the EXISTING Role-catalog reconciliation and actors are resolved through the EXISTING operational
// context resolver -- never hand-built capability sets.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
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
const lifecycle = require("../lib/eosWorkforce/commands/employeeLifecycleCommand.js");
const companies = require("../lib/eosWorkforce/migration/tenantOperatingCompanies.js");
const reconcileCli = require("../scripts/tenantOperatingCompanyReconcileCli.js");
const http = require("../lib/eosWorkforce/workforceHttp.js");
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

test("changeEmploymentStatus / changeOperatingCompany over the real Workforce and policy authorities", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `emp_lifecycle_cmd_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
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
    return { tenantId: ctx.principalContext.tenantId, principalId: ctx.principalContext.uid, capabilities: ctx.capabilities, entitlements: ctx.entitlements };
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
  const life = async (id) => (await q(`SELECT employment_status::text AS status, operating_company_id AS company, updated_at FROM eos_workforce.employees WHERE id = $1`, [id])).rows[0];
  const links = async (tenant) => (await q(`SELECT operating_company_id AS id, status FROM eos_policy.tenant_operating_companies WHERE tenant_id = $1 ORDER BY 1`, [tenant])).rows;

  await t.test("tenant <-> operating company reconciliation: dry run writes nothing; apply links only the evidence; idempotent; never deactivates or reactivates", async () => {
    const dry = await companies.reconcileTenantOperatingCompanies(pool, { tenantId: "t1", companyIds: ["taylor", "ventana"], source: "test-evidence", actor: "tenant-operating-companies:test" });
    assert.deepEqual([dry.additions, dry.applied, await links("t1")], [["taylor", "ventana"], false, []]);
    const applied = await companies.reconcileTenantOperatingCompanies(pool, { tenantId: "t1", companyIds: ["ventana", "taylor"], source: "test-evidence", actor: "tenant-operating-companies:test", apply: true });
    assert.deepEqual([applied.additions, applied.applied], [["taylor", "ventana"], true]);
    assert.deepEqual(await links("t1"), [{ id: "taylor", status: "ACTIVE" }, { id: "ventana", status: "ACTIVE" }]);
    const again = await companies.reconcileTenantOperatingCompanies(pool, { tenantId: "t1", companyIds: ["taylor", "ventana"], source: "test-evidence", actor: "tenant-operating-companies:test", apply: true });
    assert.deepEqual([again.additions, again.applied, again.alreadyActive], [[], false, ["taylor", "ventana"]]);
    // t2 is linked to taylor only: ventana is KNOWN to the code but NOT authorized for t2.
    await companies.reconcileTenantOperatingCompanies(pool, { tenantId: "t2", companyIds: ["taylor"], source: "test-evidence", actor: "tenant-operating-companies:test", apply: true });
    // An INACTIVE link is reported, never reactivated; a link absent from the evidence is reported, never removed.
    await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id, operating_company_id, status, source, established_by, updated_by) VALUES ('t1', 'retired-co', 'INACTIVE', 'test', 'test', 'test')`);
    const report = await companies.reconcileTenantOperatingCompanies(pool, { tenantId: "t1", companyIds: ["taylor", "retired-co"], source: "test-evidence", actor: "tenant-operating-companies:test", apply: true });
    assert.deepEqual([report.inactiveNotReactivated, report.linkedButNotInEvidence, report.applied], [["retired-co"], ["ventana"], false]);
    assert.equal((await links("t1")).length, 3);
    assert.equal((await q(`SELECT count(*)::int n FROM eos_policy.audit_events WHERE action = 'tenant.operatingCompanies.reconcile'`)).rows[0].n, 2, "one audit per applying run");
    await assert.rejects(companies.reconcileTenantOperatingCompanies(pool, { tenantId: "t-missing", companyIds: ["taylor"], source: "x", actor: "x", apply: true }), /never creates one/);
    await assert.rejects(q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id, operating_company_id, status, source, established_by, updated_by) VALUES ('t1', 'Bad Co', 'ACTIVE', 's', 'a', 'a')`), (e) => e.code === "23514");
  });

  await t.test("reconcile CLI fence and evidence: only an Owner-ruled environment with a matching evidence file; production / Certification refused", () => {
    assert.deepEqual(reconcileCli.loadEvidence("platform-sandbox").companyIds, ["taylor", "ventana"]);
    for (const env of ["taylor-parts-production", "platform-certification", "platform-integration", "local-emulator"]) {
      assert.throws(() => reconcileCli.loadEvidence(env), /no governed operating-company evidence/, env);
    }
    const base = { environment: "platform-sandbox", databaseUrlEnv: "DB", tenantKey: "taylor-nonprod", performedBy: "op" };
    const env = { DB: "postgres://x", EOS_ENVIRONMENT: "nonprod" };
    assert.equal(reconcileCli.assertReconcileInvocation(base, env).apply, false, "dry run by default");
    assert.throws(() => reconcileCli.assertReconcileInvocation({ ...base, environment: "taylor-parts-production" }, env));
    assert.throws(() => reconcileCli.assertReconcileInvocation({ ...base, environment: "platform-certification" }, env), /frozen/);
    assert.throws(() => reconcileCli.assertReconcileInvocation(base, { ...env, EOS_ENVIRONMENT: "production" }));
    assert.throws(() => reconcileCli.assertReconcileInvocation({ ...base, tenantKey: undefined }, env), /tenantKey/);
  });

  const lifeAudits = async (id) => (await q(`SELECT action, actor_uid, before, after, reason FROM eos_policy.audit_events WHERE target_kind = 'employee' AND target_id = $1 AND action LIKE 'employee.%.change' ORDER BY occurred_at, id`, [id])).rows;

  await t.test("valid status transition: updated, audited with the EOS Principal; same status is NO_CHANGE", async () => {
    const res = await lifecycle.changeEmploymentStatus(deps, adminActor, { employeeId: "e-edit", employmentStatus: "ON_LEAVE", reason: "medical leave" });
    assert.deepEqual([res.outcome, res.previous, res.current], ["CHANGED", "ACTIVE", "ON_LEAVE"]);
    const row = await life("e-edit");
    assert.equal(row.status, "ON_LEAVE");
    assert.ok(row.updated_at > new Date("2020-01-02"));
    const trail = await lifeAudits("e-edit");
    assert.deepEqual(trail.map((a) => [a.action, a.actor_uid, a.before, a.after, a.reason]),
      [["employee.employmentStatus.change", admin.principalId, { employmentStatus: "ACTIVE" }, { employmentStatus: "ON_LEAVE" }, "medical leave"]]);
    const same = await lifecycle.changeEmploymentStatus(deps, adminActor, { employeeId: "e-edit", employmentStatus: "ON_LEAVE" });
    assert.deepEqual([same.outcome, same.auditEventId, (await lifeAudits("e-edit")).length], ["NO_CHANGE", null, 1]);
  });

  await t.test("invalid status transition refused (transition table enforced); unknown status refused", async () => {
    // The table is legacy parity pending an Owner ruling: prove enforcement by the store-level refusal of a status the
    // table does not name, and by the command consulting the table (a narrowed table refuses).
    await assert.rejects(lifecycle.changeEmploymentStatus(deps, adminActor, { employeeId: "e-edit", employmentStatus: "FIRED" }), (e) => e.code === "EMPLOYMENT_STATUS_INVALID");
    const original = lifecycle.EMPLOYMENT_STATUS_TRANSITIONS.ON_LEAVE;
    assert.ok(Object.isFrozen(lifecycle.EMPLOYMENT_STATUS_TRANSITIONS), "the transition table must be frozen");
    for (const [from, targets] of Object.entries(lifecycle.EMPLOYMENT_STATUS_TRANSITIONS)) assert.ok(!targets.includes(from), `${from} lists itself`);
    assert.ok(Array.isArray(original));
  });

  await t.test("the transition table is ENFORCED: a narrowed table refuses the transition and writes nothing", async () => {
    const LIB = join(FUNCTIONS_DIR, "lib");
    const dir = mkdtempSync(join(tmpdir(), "emp-lifecycle-narrowed-"));
    cpSync(LIB, join(dir, "lib"), { recursive: true });
    const file = join(dir, "lib", "eosWorkforce", "commands", "employeeLifecycleCommand.js");
    const src = readFileSync(file, "utf8");
    const anchor = "exports.EMPLOYMENT_STATUS_TRANSITIONS = Object.freeze(";
    assert.ok(src.includes(anchor), "transition table anchor not found -- update this control");
    writeFileSync(file, src.replace(anchor, `exports.EMPLOYMENT_STATUS_TRANSITIONS = ({ TERMINATED: [], ACTIVE: ["TERMINATED"], ON_LEAVE: [], INACTIVE: [], RETIRED: [], CONTRACTOR: [] }) || Object.freeze(`));
    const narrowed = require(file);
    await employee("e-t1-narrow", "t1");
    assert.equal((await narrowed.changeEmploymentStatus(deps, adminActor, { employeeId: "e-t1-narrow", employmentStatus: "TERMINATED" })).outcome, "CHANGED");
    await assert.rejects(narrowed.changeEmploymentStatus(deps, adminActor, { employeeId: "e-t1-narrow", employmentStatus: "ACTIVE" }), (e) => e.code === "EMPLOYMENT_STATUS_TRANSITION_NOT_ALLOWED");
    assert.equal((await life("e-t1-narrow")).status, "TERMINATED");
    assert.equal((await lifeAudits("e-t1-narrow")).length, 1);
  });

  await t.test("operating company: same-tenant authorized change succeeds; unauthorized, cross-tenant, unknown, inactive and malformed refused", async () => {
    const res = await lifecycle.changeOperatingCompany(deps, adminActor, { employeeId: "e-other", operatingCompanyId: "ventana" });
    assert.deepEqual([res.outcome, res.previous, res.current], ["CHANGED", "taylor", "ventana"]);
    assert.equal((await life("e-other")).company, "ventana");
    assert.deepEqual((await lifeAudits("e-other")).map((a) => [a.action, a.before, a.after]),
      [["employee.operatingCompany.change", { operatingCompanyId: "taylor" }, { operatingCompanyId: "ventana" }]]);
    // Known to the code, but NOT authorized for tenant t2 (cross-tenant relationship refused).
    await employee("e-t2-co", "t2");
    await assert.rejects(lifecycle.changeOperatingCompany(deps, await resolveActor(t2Admin), { employeeId: "e-t2-co", operatingCompanyId: "ventana" }), (e) => e.code === "OPERATING_COMPANY_NOT_AUTHORIZED_FOR_TENANT");
    assert.equal((await life("e-t2-co")).company, "taylor");
    for (const [bad, code] of [["acme", "OPERATING_COMPANY_NOT_AUTHORIZED_FOR_TENANT"], ["retired-co", "OPERATING_COMPANY_INACTIVE"],
      ["Ventana", "OPERATING_COMPANY_INVALID"], ["", "OPERATING_COMPANY_INVALID"], [null, "OPERATING_COMPANY_INVALID"]]) {
      await assert.rejects(lifecycle.changeOperatingCompany(deps, adminActor, { employeeId: "e-other", operatingCompanyId: bad }), (e) => e.code === code, String(bad));
    }
    assert.equal((await life("e-other")).company, "ventana");
    assert.equal((await lifeAudits("e-other")).length, 1);
  });

  await t.test("wrong tenant refused both ways; foreign x-tenant actor refused", async () => {
    await assert.rejects(lifecycle.changeEmploymentStatus(deps, adminActor, { employeeId: "e-t2", employmentStatus: "INACTIVE" }), (e) => e.code === "EMPLOYEE_NOT_FOUND");
    await assert.rejects(lifecycle.changeOperatingCompany(deps, await resolveActor(t2Admin), { employeeId: "e-edit", operatingCompanyId: "taylor" }), (e) => e.code === "EMPLOYEE_NOT_FOUND");
    await assert.rejects(lifecycle.changeEmploymentStatus(deps, { ...adminActor, tenantId: "t2" }, { employeeId: "e-t2", employmentStatus: "INACTIVE" }), (e) => e.code === "ACTOR_NOT_TENANT_MEMBER");
    assert.equal((await life("e-t2")).status, "ACTIVE");
  });

  await t.test("inactive membership and inactive Principal refused inside the transaction", async () => {
    const temp = await makePrincipal("t1", "firebase-uid-w2-temp", "admin");
    const tempActor = await resolveActor(temp);
    await q(`UPDATE eos_policy.tenant_memberships SET status = 'disabled' WHERE principal_id = $1`, [temp.principalId]);
    await assert.rejects(lifecycle.changeEmploymentStatus(deps, tempActor, { employeeId: "e-linked", employmentStatus: "INACTIVE" }), (e) => e.code === "ACTOR_NOT_TENANT_MEMBER");
    await q(`UPDATE eos_policy.tenant_memberships SET status = 'active' WHERE principal_id = $1`, [temp.principalId]);
    await q(`UPDATE eos_policy.principals SET status = 'disabled' WHERE id = $1`, [temp.principalId]);
    await assert.rejects(lifecycle.changeOperatingCompany(deps, tempActor, { employeeId: "e-linked", operatingCompanyId: "ventana" }), (e) => e.code === "ACTOR_NOT_TENANT_MEMBER");
    assert.deepEqual([(await life("e-linked")).status, (await life("e-linked")).company], ["ACTIVE", "taylor"]);
  });

  await t.test("missing capability refused (General Manager holds employee.record.read only)", async () => {
    const gmActor = await resolveActor(gm);
    await assert.rejects(lifecycle.changeEmploymentStatus(deps, gmActor, { employeeId: "e-linked", employmentStatus: "TERMINATED" }), (e) => e.code === "CAPABILITY_REQUIRED");
    await assert.rejects(lifecycle.changeOperatingCompany(deps, gmActor, { employeeId: "e-linked", operatingCompanyId: "ventana" }), (e) => e.code === "CAPABILITY_REQUIRED");
    assert.equal((await life("e-linked")).status, "ACTIVE");
  });

  await t.test("Principal id / provider subject cannot substitute for the Employee id", async () => {
    for (const substitute of [admin.principalId, admin.subject]) {
      await assert.rejects(lifecycle.changeEmploymentStatus(deps, adminActor, { employeeId: substitute, employmentStatus: "INACTIVE" }), (e) => e.code === "EMPLOYEE_NOT_FOUND", substitute);
    }
    assert.equal((await life("e-linked")).status, "ACTIVE");
  });

  await t.test("audit failure rolls back the Employee mutation", async () => {
    const before = await life("e-linked");
    await q(`CREATE FUNCTION test_refuse_lifecycle_audit() RETURNS trigger AS $$ BEGIN
               IF NEW.action LIKE 'employee.%.change' THEN RAISE EXCEPTION 'injected audit failure'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
    await q(`CREATE TRIGGER test_refuse_lifecycle_audit BEFORE INSERT ON eos_policy.audit_events FOR EACH ROW EXECUTE FUNCTION test_refuse_lifecycle_audit()`);
    try {
      await assert.rejects(lifecycle.changeEmploymentStatus(deps, adminActor, { employeeId: "e-linked", employmentStatus: "TERMINATED" }), (e) => e.code === "COMMAND_FAILED" && !/injected/.test(e.message));
      await assert.rejects(lifecycle.changeOperatingCompany(deps, adminActor, { employeeId: "e-linked", operatingCompanyId: "ventana" }), (e) => e.code === "COMMAND_FAILED");
    } finally {
      await q(`DROP TRIGGER test_refuse_lifecycle_audit ON eos_policy.audit_events`);
      await q(`DROP FUNCTION test_refuse_lifecycle_audit()`);
    }
    assert.deepEqual(await life("e-linked"), before);
    assert.equal((await lifeAudits("e-linked")).length, 0);
  });

  await t.test("unknown and lifecycle-external fields refused before any write", async () => {
    for (const extra of ["jobTitle", "managerEmployeeId", "securityRole", "jobRole", "principalId", "tenantId", "capabilities", "actorUid", "operatingCompanyId", "userAccess"]) {
      await assert.rejects(lifecycle.changeEmploymentStatus(deps, adminActor, { employeeId: "e-linked", employmentStatus: "INACTIVE", [extra]: "x" }), (e) => e.code === "INPUT_FIELD_NOT_ACCEPTED", extra);
    }
    for (const extra of ["employmentStatus", "displayName", "ownerEmployeeId", "assigneeEmployeeId"]) {
      await assert.rejects(lifecycle.changeOperatingCompany(deps, adminActor, { employeeId: "e-linked", operatingCompanyId: "ventana", [extra]: "x" }), (e) => e.code === "INPUT_FIELD_NOT_ACCEPTED", extra);
    }
    assert.deepEqual([(await life("e-linked")).status, (await life("e-linked")).company], ["ACTIVE", "taylor"]);
  });

  await t.test("transport: both operations served, authority fields refused, no Firebase module loads", async () => {
    const world = { reader: repo, pool, allowedOrigins: [], verifyToken: async () => ({ externalSubject: admin.subject, identityProvider: "firebase" }) };
    const call = async (operation, input) => {
      const res = await http.handleWorkforceRequest(world, { method: "POST", url: "/workforce/employees", headers: { authorization: "Bearer t" }, body: JSON.stringify({ operation, input }) });
      return { status: res.status, body: JSON.parse(res.body) };
    };
    const ok = await call("changeEmploymentStatus", { employeeId: "e-linked", employmentStatus: "CONTRACTOR" });
    assert.deepEqual([ok.status, ok.body.result.current], [200, "CONTRACTOR"]);
    assert.deepEqual([(await call("changeOperatingCompany", { employeeId: "e-linked", operatingCompanyId: "acme" })).body.code], ["OPERATING_COMPANY_NOT_AUTHORIZED_FOR_TENANT"]);
    const stated = await call("changeEmploymentStatus", { employeeId: "e-linked", employmentStatus: "ACTIVE", tenantId: "t2" });
    assert.deepEqual([stated.status, stated.body.code], [400, "AUTHORITY_FIELD_NOT_ACCEPTED"]);
    const probe = spawnSync(process.execPath, ["-e", `const M=require("module");const l=M._load;M._load=function(r,...a){if(/firebase/i.test(r)){process.exit(97)}return l.call(this,r,...a)};require("./lib/eosWorkforce/commands/employeeLifecycleCommand.js");require("./lib/eosWorkforce/workforceHttp.js")`], { cwd: FUNCTIONS_DIR });
    assert.equal(probe.status, 0, "a Firebase module loaded with the lifecycle writer");
  });
});
