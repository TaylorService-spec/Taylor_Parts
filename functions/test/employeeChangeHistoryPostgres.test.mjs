// EMP-RT-H1: listEmployeeChangeHistory, the governed PostgreSQL Employee change history, against a real postgres:16.
//
// The suite migrates its OWN disposable database. Grants are delivered through the EXISTING Employee capability-grant
// reconciliation and actors are resolved through the EXISTING operational context resolver. History rows are produced
// by the REAL governed commands -- never inserted by hand -- except the deliberately foreign audit rows the allow-list
// must exclude.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import pg from "pg";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const historyRead = require("../lib/eosWorkforce/reads/employeeChangeHistoryRead.js");
const profile = require("../lib/eosWorkforce/commands/employeeProfileCommand.js");
const reporting = require("../lib/eosWorkforce/commands/reportingRelationshipCommands.js");
const edit = require("../lib/eosWorkforce/commands/employeeEditCommand.js");
const lifecycle = require("../lib/eosWorkforce/commands/employeeLifecycleCommand.js");
const jobRoles = require("../lib/eosWorkforce/commands/employeeJobRoleCommands.js");
const jobRoleSeed = require("../lib/eosWorkforce/migration/jobRoleCatalogSeed.js");
const companies = require("../lib/eosWorkforce/migration/tenantOperatingCompanies.js");
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

test("governed Employee change history over the real Workforce and policy authorities", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `emp_history_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
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
    for (const key of ["admin", "generalManager", "nothing"]) {
      roleIds[`${tenantId}:${key}`] = (await repo.transact(fixture(tenantId), (tx) => tx.createRole({ key, name: key, description: null, origin: "CUSTOM", protected: false }))).id;
    }
    await grants.reconcileEmployeeCapabilityGrants(pool, { tenantId, apply: true, actor: "employee-capability-grants:test" });
    await companies.reconcileTenantOperatingCompanies(pool, { tenantId, companyIds: ["taylor", "ventana"], source: "test-evidence", actor: "tenant-operating-companies:test", apply: true });
    await jobRoleSeed.seedJobRoleCatalog(pool, { tenantId, actor: "job-role-catalog-seed:test", apply: true });
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

  const admin = await makePrincipal("t1", "firebase-uid-admin", "admin");
  await q(`UPDATE eos_policy.principals SET display_name = 'Avery Admin' WHERE id = $1`, [admin.principalId]);
  const gm = await makePrincipal("t1", "firebase-uid-gm", "generalManager");
  const nobody = await makePrincipal("t1", "firebase-uid-nothing", "nothing");
  const t2Admin = await makePrincipal("t2", "firebase-uid-t2-admin", "admin");
  await employee("e-subject", "t1", { display_name: "Robert Jones", first_name: "Robert", job_title: "Tech", employee_number: "TAZ-0001" });
  await employee("e-manager", "t1", { display_name: "Mary Manager", preferred_name: "Mary" });
  await employee("e-manager-2", "t1", { first_name: "Sam", last_name: "Second" });
  await employee("e-quiet", "t1", { display_name: "Nobody Changed Me" });
  await employee("e-t2", "t2", { display_name: "Foreign" });

  const deps = { pool };
  const adminActor = await resolveActor(admin);
  const gmActor = await resolveActor(gm);
  assert.ok(adminActor.capabilities.has("admin.principalAccess.read") && adminActor.capabilities.has("employee.record.read"));
  assert.ok(gmActor.capabilities.has("employee.record.read") && !gmActor.capabilities.has("admin.principalAccess.read"));
  const storedOrder = async (id) => (await q(`SELECT id FROM eos_policy.audit_events WHERE tenant_id = 't1' AND target_kind = 'employee' AND target_id = $1
    AND action LIKE 'employee.%' ORDER BY occurred_at DESC, id DESC`, [id])).rows.map((r) => r.id);

  await t.test("real commands produce history for profile, reporting (incl. the combined Save), lifecycle and Job Role; newest first; values projected and named", async () => {
    await profile.updateEmployeeProfile(deps, adminActor, { employeeId: "e-subject", changes: { jobTitle: "Service Lead", workEmail: "bob@example.com" }, reason: "promotion" });
    await reporting.establishReportingRelationship(deps, adminActor, { employeeId: "e-subject", managerEmployeeId: "e-manager" });
    await edit.saveEmployeeEdit(deps, adminActor, { employeeId: "e-subject", changes: { mobilePhone: "555-0100" }, manager: { action: "ESTABLISH", managerEmployeeId: "e-manager-2" } });
    await lifecycle.changeEmploymentStatus(deps, adminActor, { employeeId: "e-subject", employmentStatus: "ON_LEAVE", reason: "leave" });
    await lifecycle.changeOperatingCompany(deps, adminActor, { employeeId: "e-subject", operatingCompanyId: "ventana" });
    await jobRoles.assignEmployeeJobRole(deps, adminActor, { employeeId: "e-subject", jobRoleId: "retail-sales" });
    await jobRoles.assignEmployeeJobRole(deps, adminActor, { employeeId: "e-subject", jobRoleId: "service-manager" });
    await reporting.endReportingRelationship(deps, adminActor, { employeeId: "e-subject" });

    const page = await historyRead.listEmployeeChangeHistory(deps, adminActor, { employeeId: "e-subject" });
    assert.deepEqual([page.employeeId, page.truncated, page.nextCursor], ["e-subject", false, null]);
    assert.deepEqual(page.items.map((i) => i.eventId), await storedOrder("e-subject"), "not newest first by (occurred_at, id)");
    assert.deepEqual(page.items.map((i) => i.action).sort(), [
      "employee.employmentStatus.change", "employee.jobRole.assign", "employee.jobRole.assign", "employee.operatingCompany.change",
      "employee.profile.update", "employee.profile.update", "employee.reportingRelationship.end", "employee.reportingRelationship.establish",
      "employee.reportingRelationship.establish",
    ]);
    for (const i of page.items) {
      assert.deepEqual(Object.keys(i).sort(), ["action", "after", "before", "changedBy", "eventId", "occurredAt", "reason"]);
      assert.deepEqual(i.changedBy, { displayName: "Avery Admin" });
      assert.ok(!JSON.stringify(i).includes(admin.principalId) && !JSON.stringify(i).includes(admin.subject), "a Principal id or subject leaked");
      assert.ok(!/relationshipId|assignmentId/.test(JSON.stringify(i)), "an internal row id leaked");
    }
    const byAction = (a) => page.items.filter((i) => i.action === a);
    const firstProfile = byAction("employee.profile.update").find((i) => i.reason === "promotion");
    assert.deepEqual([firstProfile.before, firstProfile.after], [{ jobTitle: "Tech", workEmail: null }, { jobTitle: "Service Lead", workEmail: "bob@example.com" }]);
    const established = byAction("employee.reportingRelationship.establish");
    assert.deepEqual(established.map((i) => [i.before, i.after]).map((v) => JSON.stringify(v)).sort(), [
      [null, { managerEmployeeId: "e-manager", managerDisplayName: "Mary" }],
      [{ managerEmployeeId: "e-manager", managerDisplayName: "Mary" }, { managerEmployeeId: "e-manager-2", managerDisplayName: "Sam Second" }],
    ].map((v) => JSON.stringify(v)).sort());
    const ended = byAction("employee.reportingRelationship.end")[0];
    assert.deepEqual([ended.before, ended.after], [{ managerEmployeeId: "e-manager-2", managerDisplayName: "Sam Second" }, null]);
    const status = byAction("employee.employmentStatus.change")[0];
    assert.deepEqual([status.before, status.after, status.reason], [{ employmentStatus: "ACTIVE" }, { employmentStatus: "ON_LEAVE" }, "leave"]);
    const company = byAction("employee.operatingCompany.change")[0];
    assert.deepEqual([company.before, company.after, company.reason], [{ operatingCompanyId: "taylor" }, { operatingCompanyId: "ventana" }, null]);
    assert.deepEqual(byAction("employee.jobRole.assign").map((i) => [i.before, i.after]).map((v) => JSON.stringify(v)).sort(), [
      [null, { jobRoleId: "retail-sales", jobRoleDisplayName: "Retail Sales" }],
      [{ jobRoleId: "retail-sales", jobRoleDisplayName: "Retail Sales" }, { jobRoleId: "service-manager", jobRoleDisplayName: "Service Manager" }],
    ].map((v) => JSON.stringify(v)).sort());
    assert.ok(page.items.every((i) => !Number.isNaN(Date.parse(i.occurredAt))));
    assert.deepEqual((await historyRead.listEmployeeChangeHistory(deps, adminActor, { employeeId: "e-quiet" })).items, [], "an unchanged Employee has history");
  });

  await t.test("paging: bounded keyset pages cover every row exactly once, even when events share a timestamp; cursor bound to the Employee", async () => {
    // Two audit events at the SAME instant from one real command pair would be luck; force the tie by sharing `at`.
    const tie = await q(`SELECT occurred_at FROM eos_policy.audit_events WHERE target_id = 'e-subject' ORDER BY occurred_at DESC LIMIT 1`);
    await q(`UPDATE eos_policy.audit_events SET occurred_at = $1 WHERE target_id = 'e-subject' AND action = 'employee.jobRole.assign'`, [tie.rows[0].occurred_at]);
    const all = await storedOrder("e-subject");
    const seen = [];
    let cursor;
    let pages = 0;
    do {
      const page = await historyRead.listEmployeeChangeHistory(deps, adminActor, { employeeId: "e-subject", limit: 2, ...(cursor ? { cursor } : {}) });
      assert.ok(page.items.length <= 2);
      seen.push(...page.items.map((i) => i.eventId));
      assert.equal(page.truncated, page.nextCursor !== null);
      cursor = page.nextCursor;
      pages++;
    } while (cursor && pages < 20);
    assert.deepEqual(seen, all);
    assert.equal(pages, Math.ceil(all.length / 2));
    const first = await historyRead.listEmployeeChangeHistory(deps, adminActor, { employeeId: "e-subject", limit: 2 });
    await assert.rejects(historyRead.listEmployeeChangeHistory(deps, adminActor, { employeeId: "e-quiet", cursor: first.nextCursor }), (e) => e.code === "CURSOR_INVALID");
    await assert.rejects(historyRead.listEmployeeChangeHistory(deps, adminActor, { employeeId: "e-subject", limit: 201 }), (e) => e.code === "PAGE_SIZE_INVALID");
  });

  await t.test("non-Employee audit actions are excluded, even on target_kind 'employee' for this Employee", async () => {
    const before = await historyRead.listEmployeeChangeHistory(deps, adminActor, { employeeId: "e-subject", limit: 200 });
    assert.ok((await q(`SELECT count(*)::int n FROM eos_policy.audit_events WHERE action = 'tenant.operatingCompanies.reconcile'`)).rows[0].n > 0);
    await jobRoles.createJobRole(deps, adminActor, { jobRoleId: "field-trainer", displayName: "Field Trainer" });
    assert.ok((await q(`SELECT count(*)::int n FROM eos_policy.audit_events WHERE action LIKE 'jobRole.catalog.%'`)).rows[0].n > 0);
    const foreign = [
      ["tenant.operatingCompanies.reconcile", "employee"], ["jobRole.catalog.update", "employee"], ["updateEmployeeProfile", "employee"],
      ["employee.secret.peek", "employee"], ["employee.profile.update", "principal"],
    ];
    for (const [action, kind] of foreign) {
      await q(`INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, occurred_at)
               VALUES ($1, 't1', $2, $3, $4, 'e-subject', '{"x":1}', '{"x":2}', now() + interval '1 day')`, [`audit_foreign_${randomUUID()}`, action, admin.principalId, kind]);
    }
    // The same Employee id in ANOTHER tenant's audit trail is not this Employee's history.
    await q(`INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after)
             VALUES ('audit_other_tenant', 't2', 'employee.profile.update', $1, 'employee', 'e-subject', '{"jobTitle":"x"}', '{"jobTitle":"y"}')`, [t2Admin.principalId]);
    // An unknown key inside an allowed action is dropped, never passed through.
    await q(`INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, occurred_at)
             VALUES ('audit_extra_key', 't1', 'employee.employmentStatus.change', $1, 'employee', 'e-quiet', '{"employmentStatus":"ACTIVE","ssn":"123"}', '{"employmentStatus":"INACTIVE","principalId":"p"}', now())`, [admin.principalId]);
    const after = await historyRead.listEmployeeChangeHistory(deps, adminActor, { employeeId: "e-subject", limit: 200 });
    assert.deepEqual(after.items.map((i) => i.eventId), before.items.map((i) => i.eventId));
    const quiet = await historyRead.listEmployeeChangeHistory(deps, adminActor, { employeeId: "e-quiet" });
    assert.deepEqual([quiet.items[0].before, quiet.items[0].after], [{ employmentStatus: "ACTIVE" }, { employmentStatus: "INACTIVE" }]);
  });

  await t.test("changedBy: null without admin.principalAccess.read; a name with it; null when no name is recorded", async () => {
    const gmPage = await historyRead.listEmployeeChangeHistory(deps, gmActor, { employeeId: "e-subject" });
    assert.ok(gmPage.items.length > 0);
    assert.ok(gmPage.items.every((i) => i.changedBy === null));
    await profile.updateEmployeeProfile(deps, adminActor, { employeeId: "e-quiet", changes: { jobTitle: "Named" } });
    await q(`UPDATE eos_policy.principals SET display_name = NULL WHERE id = $1`, [admin.principalId]);
    const unnamed = await historyRead.listEmployeeChangeHistory(deps, adminActor, { employeeId: "e-quiet" });
    assert.ok(unnamed.items.every((i) => i.changedBy === null));
    await q(`UPDATE eos_policy.principals SET display_name = 'Avery Admin' WHERE id = $1`, [admin.principalId]);
  });

  await t.test("refusals: foreign-tenant Employee and Principal id 404; missing employee.record.read 403; inactive membership / Principal 403", async () => {
    await assert.rejects(historyRead.listEmployeeChangeHistory(deps, adminActor, { employeeId: "e-t2" }), (e) => e.code === "EMPLOYEE_NOT_FOUND" && e.category === "NOT_FOUND");
    for (const substitute of [admin.principalId, admin.subject, "e-missing"]) {
      await assert.rejects(historyRead.listEmployeeChangeHistory(deps, adminActor, { employeeId: substitute }), (e) => e.code === "EMPLOYEE_NOT_FOUND", substitute);
    }
    const nobodyActor = await resolveActor(nobody);
    assert.ok(!nobodyActor.capabilities.has("employee.record.read"));
    await assert.rejects(historyRead.listEmployeeChangeHistory(deps, nobodyActor, { employeeId: "e-subject" }), (e) => e.code === "CAPABILITY_REQUIRED" && e.category === "FORBIDDEN");
    const temp = await makePrincipal("t1", "firebase-uid-history-temp", "admin");
    const tempActor = await resolveActor(temp);
    await q(`UPDATE eos_policy.tenant_memberships SET status = 'disabled' WHERE principal_id = $1`, [temp.principalId]);
    await assert.rejects(historyRead.listEmployeeChangeHistory(deps, tempActor, { employeeId: "e-subject" }), (e) => e.code === "ACTOR_NOT_TENANT_MEMBER");
    await q(`UPDATE eos_policy.tenant_memberships SET status = 'active' WHERE principal_id = $1`, [temp.principalId]);
    await q(`UPDATE eos_policy.principals SET status = 'disabled' WHERE id = $1`, [temp.principalId]);
    await assert.rejects(historyRead.listEmployeeChangeHistory(deps, tempActor, { employeeId: "e-subject" }), (e) => e.code === "ACTOR_NOT_TENANT_MEMBER");
    // The t2 admin sees t2's Employee and its own tenant's audit row only.
    const t2 = await historyRead.listEmployeeChangeHistory(deps, await resolveActor(t2Admin), { employeeId: "e-t2" });
    assert.deepEqual(t2.items, []);
  });

  await t.test("read-only: nothing is written, not even an audit event; the transaction itself refuses writes", async () => {
    const snapshot = async () => (await q(`SELECT (SELECT count(*) FROM eos_policy.audit_events)::int a, (SELECT max(updated_at) FROM eos_workforce.employees) u,
      (SELECT count(*) FROM eos_workforce.employee_reporting_relationships)::int r, (SELECT count(*) FROM eos_workforce.employee_job_role_assignments)::int j`)).rows[0];
    const before = await snapshot();
    await historyRead.listEmployeeChangeHistory(deps, adminActor, { employeeId: "e-subject", limit: 3 });
    await historyRead.listEmployeeChangeHistory(deps, gmActor, { employeeId: "e-quiet" });
    assert.deepEqual(await snapshot(), before);
    const statements = [];
    const spyPool = { connect: async () => { const c = await pool.connect(); return { query: (text, v) => { statements.push(text); return c.query(text, v); }, release: () => c.release() }; } };
    await historyRead.listEmployeeChangeHistory({ pool: spyPool }, adminActor, { employeeId: "e-subject" });
    assert.equal(statements[0], "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    assert.ok(statements.slice(1).every((s) => !/\b(INSERT|UPDATE|DELETE)\b/.test(s) || s === "COMMIT"));
  });

  await t.test("transport: served on /workforce/employees; 403/404 mapped; authority fields refused; no Firebase module loads", async () => {
    const worldFor = (principal) => ({ reader: repo, pool, allowedOrigins: [], verifyToken: async () => ({ externalSubject: principal.subject, identityProvider: "firebase" }) });
    const call = async (principal, input) => {
      const res = await http.handleWorkforceRequest(worldFor(principal), { method: "POST", url: "/workforce/employees", headers: { authorization: "Bearer t" }, body: JSON.stringify({ operation: "listEmployeeChangeHistory", input }) });
      return { status: res.status, body: JSON.parse(res.body) };
    };
    const ok = await call(admin, { employeeId: "e-subject", limit: 2 });
    assert.deepEqual([ok.status, ok.body.result.items.length, ok.body.result.truncated], [200, 2, true]);
    assert.equal(ok.body.result.items[0].changedBy.displayName, "Avery Admin");
    assert.equal((await call(gm, { employeeId: "e-subject" })).body.result.items[0].changedBy, null);
    assert.deepEqual([(await call(nobody, { employeeId: "e-subject" })).status, (await call(nobody, { employeeId: "e-subject" })).body.code], [403, "CAPABILITY_REQUIRED"]);
    assert.deepEqual([(await call(admin, { employeeId: "e-t2" })).status, (await call(admin, { employeeId: admin.principalId })).status], [404, 404]);
    assert.equal((await call(admin, { employeeId: "e-subject", principalId: admin.principalId })).body.code, "AUTHORITY_FIELD_NOT_ACCEPTED");
    const probe = spawnSync(process.execPath, ["-e", `const M=require("module");const l=M._load;M._load=function(r,...a){if(/firebase/i.test(r)){process.exit(97)}return l.call(this,r,...a)};require("./lib/eosWorkforce/reads/employeeChangeHistoryRead.js");require("./lib/eosWorkforce/workforceHttp.js")`], { cwd: FUNCTIONS_DIR });
    assert.equal(probe.status, 0, "a Firebase module loaded with the Employee change history read");
  });
});
