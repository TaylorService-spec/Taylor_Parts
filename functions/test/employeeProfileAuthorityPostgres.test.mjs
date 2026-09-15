// EMPLOYEE PROFILE, READ AUTHORITY AND REPORTING RELATIONSHIP against a real postgres:16 (Owner rulings A-F).
//
// Each suite migrates its OWN disposable database. Roles, grants, Principals, Employees and snapshots below exist ONLY in
// those databases. Grants are delivered through the EXISTING Role-catalog grant reconciliation, never by hand.
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
const http = require("../lib/eosWorkforce/workforceHttp.js");
const commands = require("../lib/eosWorkforce/commands/reportingRelationshipCommands.js");
const grants = require("../lib/eosWorkforce/migration/employeeCapabilityGrants.js");
const snapshotLib = require("../lib/eosWorkforce/migration/employeeProfileSnapshot.js");
const cutover = require("../lib/eosWorkforce/migration/employeeProfileCutover.js");
const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");

const LIFECYCLE = ["ACTIVE", "ON_LEAVE", "INACTIVE", "TERMINATED", "RETIRED", "CONTRACTOR"];
const MIGRATION = "1759838400000_employee-profile-and-reporting-authority";

const dbUrlFor = (name) => { const u = new URL(URL_BASE); u.pathname = `/${name}`; return u.toString(); };
async function withClient(url, fn) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try { return await fn(client); } finally { await client.end(); }
}
const migrator = (url) => (...args) => execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", ...args, "--migrations-dir", "migrations"], {
  cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
});
async function freshWorld(t, prefix, upThroughTimestamp = null) {
  let pool;
  const name = `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => {
    await pool?.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  const url = dbUrlFor(name);
  // The schema suite pins THROUGH this lane's migration: a later migration (e.g. catalog 027) must not become the one its down proof reverses.
  if (upThroughTimestamp) migrator(url)("up", upThroughTimestamp, "--timestamp");
  else migrator(url)("up");
  pool = new pg.Pool({ connectionString: url, max: 8 });
  const q = (text, values = []) => pool.query(text, values);
  await q(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ('t1','t1','T1'), ('t2','t2','T2')`);
  return { url, pool, q, run: migrator(url), repo: new PostgresPolicyRepository(pool) };
}
const employee = (q, id, tenant = "t1", status = "ACTIVE", extra = {}) => {
  const cols = Object.keys(extra);
  return q(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id${cols.map((c) => `, ${c}`).join("")})
            VALUES ($1, $2, $3, 'taylor'${cols.map((_, i) => `, $${i + 4}`).join("")})`, [id, tenant, status, ...Object.values(extra)]);
};
const code = (err) => err?.code;

// ════════════════════ schema ════════════════════

test("migration: vocabulary without grants, typed nullable profile facts, no forbidden column, a refusing down", { skip: SKIP, concurrency: 1 }, async (t) => {
  const { q, run } = await freshWorld(t, "emp_schema", "1759838400000");

  await t.test("the three keys are registered as vocabulary and no migration grants anything", async () => {
    const rows = (await q(`SELECT id, key FROM eos_policy.capabilities WHERE key IN ('employee.record.read','admin.principalAccess.read','admin.employeeProfile.write') ORDER BY key`)).rows;
    assert.deepEqual(rows, [
      { id: "cap_admin_employeeProfile_write", key: "admin.employeeProfile.write" },
      { id: "cap_admin_principalAccess_read", key: "admin.principalAccess.read" },
      { id: "cap_employee_record_read", key: "employee.record.read" },
    ]);
    assert.equal((await q(`SELECT count(*)::int n FROM eos_policy.role_capabilities`)).rows[0].n, 0);
  });

  await t.test("profile facts are typed and nullable; nothing credential-, role- or eligibility-shaped exists in eos_workforce", async () => {
    const cols = (await q(`SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = 'eos_workforce' ORDER BY table_name, ordinal_position`)).rows;
    const emp = Object.fromEntries(cols.filter((c) => c.table_name === "employees").map((c) => [c.column_name, c]));
    for (const c of ["employee_number", "display_name", "first_name", "middle_name", "last_name", "preferred_name", "job_title", "work_email", "work_phone", "mobile_phone",
      "address_street", "address_unit", "address_city", "address_state", "address_postal_code"]) {
      assert.deepEqual([emp[c]?.data_type, emp[c]?.is_nullable], ["text", "YES"], c);
    }
    for (const c of ["hire_date", "separation_date"]) assert.deepEqual([emp[c]?.data_type, emp[c]?.is_nullable], ["date", "YES"], c);
    for (const c of cols) assert.doesNotMatch(c.column_name, /operational|role|uid|firebase|subject|provider|principal|eligib|technician|address$/, `${c.table_name}.${c.column_name}`);
  });

  await t.test("employee_number: case-insensitive unique per tenant, never global, nulls unconstrained, shape enforced", async () => {
    await employee(q, "e-n1", "t1", "ACTIVE", { employee_number: "TAZ-0042" });
    await assert.rejects(employee(q, "e-n2", "t1", "ACTIVE", { employee_number: "taz-0042" }), (e) => code(e) === "23505");
    await employee(q, "e-n3", "t2", "ACTIVE", { employee_number: "taz-0042" });
    await employee(q, "e-n4"); await employee(q, "e-n5");
    await assert.rejects(employee(q, "e-n6", "t1", "ACTIVE", { employee_number: " bad number" }), (e) => code(e) === "23514");
    await assert.rejects(employee(q, "e-n7", "t1", "ACTIVE", { first_name: "" }), (e) => code(e) === "23514");
    await assert.rejects(employee(q, "e-n8", "t1", "ACTIVE", { work_email: "not-an-email" }), (e) => code(e) === "23514");
    await employee(q, "e-n9", "t1", "ACTIVE", { hire_date: "2021-03-04", separation_date: "2020-01-01" }); // no ordering rule: the source has none
  });

  await t.test("reporting relationship: same tenant, not self, one current, history kept", async () => {
    await employee(q, "e-r-emp"); await employee(q, "e-r-mgr"); await employee(q, "e-r-mgr2"); await employee(q, "e-r-t2", "t2");
    const ins = (id, emp, mgr, tenant = "t1") => q(`INSERT INTO eos_workforce.employee_reporting_relationships (id, tenant_id, employee_id, manager_employee_id, effective_from, established_by, source)
      VALUES ($1, $2, $3, $4, now(), 'p-x', 'GOVERNED_COMMAND')`, [id, tenant, emp, mgr]);
    await assert.rejects(ins("r-self", "e-r-emp", "e-r-emp"), (e) => code(e) === "23514");
    await assert.rejects(ins("r-cross", "e-r-emp", "e-r-t2"), (e) => code(e) === "23503");
    await ins("r-1", "e-r-emp", "e-r-mgr");
    await assert.rejects(ins("r-2", "e-r-emp", "e-r-mgr2"), (e) => code(e) === "23505", "a second current manager was accepted");
    await assert.rejects(q(`DELETE FROM eos_workforce.employee_reporting_relationships WHERE id='r-1'`), /DELETE is refused/);
    await assert.rejects(q(`UPDATE eos_workforce.employee_reporting_relationships SET manager_employee_id='e-r-mgr2' WHERE id='r-1'`), /only permitted change ends/);
    await q(`UPDATE eos_workforce.employee_reporting_relationships SET effective_to=now(), ended_by='p-x', ended_at=now() WHERE id='r-1'`);
    await assert.rejects(q(`UPDATE eos_workforce.employee_reporting_relationships SET reason='late' WHERE id='r-1'`), /ended relationship is immutable/);
    await ins("r-2", "e-r-emp", "e-r-mgr2");
    assert.equal((await q(`SELECT count(*)::int n FROM eos_workforce.employee_reporting_relationships WHERE employee_id='e-r-emp'`)).rows[0].n, 2);
  });

  await t.test("down REFUSES while profile facts, relationships or grants exist", async () => {
    assert.throws(() => run("down", "1"), (err) => /refuses to reverse/.test(String(err.stderr)));
    const latest = (await q(`SELECT name FROM public.pgmigrations ORDER BY run_on DESC, id DESC LIMIT 1`)).rows[0].name;
    assert.equal(latest, MIGRATION);
  });
});

// ════════════════════ runtime ════════════════════

test("employee.record.read, admin.principalAccess.read and the reporting writer over the real authorities", { skip: SKIP, concurrency: 1 }, async (t) => {
  const { pool, q, repo } = await freshWorld(t, "emp_runtime");
  const TOKENS = new Map();
  const verifyToken = async (token) => {
    const subject = TOKENS.get(token);
    if (!subject) throw new Error("invalid token");
    return { externalSubject: subject, identityProvider: "firebase" };
  };
  const deps = { reader: repo, pool, verifyToken, allowedOrigins: [] };
  const fixture = (tenantId) => ({ tenantId, uid: "uid-fixture-admin" });

  // ── Roles named by the Role catalog's keys; grants come ONLY from the existing reconciliation ──
  const roleIds = {};
  for (const tenantId of ["t1", "t2"]) {
    for (const key of ["admin", "owner", "generalManager", "dispatcher", "salesperson", "technician", "partsManager", "warehouseManager"]) {
      const role = await repo.transact(fixture(tenantId), (tx) => tx.createRole({ key, name: key, description: null, origin: "CUSTOM", protected: false }));
      roleIds[`${tenantId}:${key}`] = role.id;
    }
  }
  const makeActor = async (tenantId, subject, roleKey) => {
    const principalId = await repo.transact(fixture(tenantId), async (tx) => {
      const p = await tx.createPrincipal({ externalSubject: subject, identityProvider: "firebase" });
      await tx.createTenantMembership(p.id);
      return p.id;
    });
    if (roleKey) {
      await repo.transact(fixture(tenantId), async (tx) => {
        const accessVersion = await tx.bumpAccessVersion(principalId);
        return tx.createAssignment({ principalId, roleId: roleIds[`${tenantId}:${roleKey}`], scopeType: "global", scopeValue: null, status: "active", grantedBy: "fixture", grantedAt: new Date().toISOString(), accessVersionAtGrant: accessVersion });
      });
    }
    TOKENS.set(`tok-${subject}`, subject);
    return { principalId, token: `tok-${subject}`, subject, tenantId };
  };
  const call = async (actor, operation, input, headers = {}) => {
    const res = await http.handleWorkforceRequest(deps, {
      method: "POST", url: "/workforce/employees", headers: { authorization: `Bearer ${actor.token}`, ...headers },
      body: JSON.stringify(input === undefined ? { operation } : { operation, input }),
    });
    return { status: res.status, body: JSON.parse(res.body), raw: res.body };
  };

  await t.test("grants: the Role-catalog reconciliation yields exactly Administrator, Owner and General Manager; rerun adds nothing", async () => {
    const dry = await grants.reconcileEmployeeCapabilityGrants(pool, { tenantId: "t1", actor: "employee-capability-grants:test" });
    assert.equal(dry.appliedAdditions, 0);
    assert.equal((await q(`SELECT count(*)::int n FROM eos_policy.role_capabilities`)).rows[0].n, 0, "a dry run wrote");
    const applied = await grants.reconcileEmployeeCapabilityGrants(pool, { tenantId: "t1", apply: true, actor: "employee-capability-grants:test" });
    assert.deepEqual(applied.unresolved, []);
    const held = (await q(`SELECT r.key AS role, c.key AS capability FROM eos_policy.role_capabilities rc JOIN eos_policy.roles r ON r.id = rc.role_id JOIN eos_policy.capabilities c ON c.id = rc.capability_id WHERE rc.tenant_id='t1' ORDER BY 1, 2`)).rows;
    assert.deepEqual(held, [
      { role: "admin", capability: "admin.employeeProfile.write" }, { role: "admin", capability: "admin.principalAccess.read" }, { role: "admin", capability: "employee.record.read" },
      { role: "generalManager", capability: "employee.record.read" },
      { role: "owner", capability: "admin.employeeProfile.write" }, { role: "owner", capability: "admin.principalAccess.read" }, { role: "owner", capability: "employee.record.read" },
    ]);
    const rerun = await grants.reconcileEmployeeCapabilityGrants(pool, { tenantId: "t1", apply: true, actor: "employee-capability-grants:test" });
    assert.equal(rerun.appliedAdditions, 0);
    assert.equal((await q(`SELECT count(*)::int n FROM eos_policy.role_capabilities WHERE tenant_id='t2'`)).rows[0].n, 0, "a tenant-scoped run granted another tenant");
    await grants.reconcileEmployeeCapabilityGrants(pool, { tenantId: "t2", apply: true, actor: "employee-capability-grants:test" });
  });

  const admin = await makeActor("t1", "firebase-uid-admin", "admin");
  const gm = await makeActor("t1", "firebase-uid-gm", "generalManager");
  const others = {};
  for (const key of ["dispatcher", "salesperson", "technician", "partsManager", "warehouseManager"]) others[key] = await makeActor("t1", `firebase-uid-${key}`, key);
  const t2Admin = await makeActor("t2", "firebase-uid-t2-admin", "admin");

  for (const s of LIFECYCLE) await employee(q, `e-${s.toLowerCase()}`, "t1", s);
  await employee(q, "e-full", "t1", "ACTIVE", {
    employee_number: "TAZ-0001", display_name: "Robert Jones", first_name: "Robert", middle_name: "Q", last_name: "Jones", preferred_name: "Bob",
    job_title: "Service Lead", work_email: "bob@example.com", work_phone: "555-0100", mobile_phone: "555-0101",
    address_street: "1 Main St", address_unit: "Suite 2", address_city: "Phoenix", address_state: "AZ", address_postal_code: "85001",
    hire_date: "2019-05-06",
  });
  await employee(q, "e-display-only", "t1", "ACTIVE", { display_name: "Dana Display", first_name: "Dana", last_name: "Other" });
  await employee(q, "e-first-last", "t1", "ACTIVE", { first_name: "Fiona", last_name: "Last" });
  await employee(q, "e-manager", "t1", "ACTIVE", { display_name: "Maria Manager" });
  await employee(q, "e-t2", "t2");
  await q(`INSERT INTO eos_policy.employee_principal_links (id, tenant_id, principal_id, employee_id, operating_company_id, link_source, asserted_by, assertion_reason)
           VALUES ('epl-gm','t1',$1,'e-full','taylor','OPERATOR_ASSERTED','fixture-operator','test fixture')`, [gm.principalId]);
  const commandActor = async (actor) => {
    const { resolveOperationalContext } = require("../lib/eosOps/capabilityAuthority.js");
    const ctx = await resolveOperationalContext(repo, pool, { identityProvider: "firebase", externalSubject: actor.subject, requestedTenantId: null });
    return { tenantId: ctx.principalContext.tenantId, principalId: ctx.principalContext.uid, capabilities: ctx.capabilities };
  };

  await t.test("EMP-RT-01 readEmployee: every lifecycle status, typed profile facts, derived display name, userAccess only", async () => {
    for (const s of LIFECYCLE) {
      const res = await call(gm, "readEmployee", { employeeId: `e-${s.toLowerCase()}` });
      assert.deepEqual([res.status, res.body.result?.employmentStatus, res.body.result?.displayName, res.body.result?.userAccess], [200, s, null, "UNLINKED"], s);
    }
    const full = (await call(gm, "readEmployee", { employeeId: "e-full" })).body.result;
    assert.deepEqual({ ...full, createdAt: undefined, updatedAt: undefined }, {
      employeeId: "e-full", employmentStatus: "ACTIVE", operatingCompanyId: "taylor", employeeNumber: "TAZ-0001", displayName: "Bob",
      name: { displayName: "Robert Jones", firstName: "Robert", middleName: "Q", lastName: "Jones", preferredName: "Bob" },
      jobTitle: "Service Lead", contact: { workEmail: "bob@example.com", workPhone: "555-0100", mobilePhone: "555-0101" },
      address: { street: "1 Main St", unit: "Suite 2", city: "Phoenix", state: "AZ", postalCode: "85001" },
      hireDate: "2019-05-06", separationDate: null, currentManager: null, createdAt: undefined, updatedAt: undefined, userAccess: "LINKED",
    });
    assert.equal((await call(gm, "readEmployee", { employeeId: "e-display-only" })).body.result.displayName, "Dana Display");
    assert.equal((await call(gm, "readEmployee", { employeeId: "e-first-last" })).body.result.displayName, "Fiona Last");
    const res = await call(gm, "readEmployee", { employeeId: "e-full" });
    assert.ok(!res.raw.includes(gm.principalId), "employee.record.read leaked the linked Principal id");
    assert.doesNotMatch(res.raw, /principal|provider|subject|firebase|role|membership|accountStatus|disabled|operational/i);
  });

  await t.test("EMP-RT-01: capability required; foreign tenant 404; directory bounded, filtered, deterministic", async () => {
    for (const actor of Object.values(others)) {
      const res = await call(actor, "readEmployee", { employeeId: "e-full" });
      assert.deepEqual([res.status, res.body.code], [403, "CAPABILITY_REQUIRED"], actor.subject);
      assert.equal((await call(actor, "listEmployees")).status, 403);
    }
    const foreign = await call(gm, "readEmployee", { employeeId: "e-t2" });
    assert.deepEqual([foreign.status, foreign.body.code], [404, "EMPLOYEE_NOT_FOUND"]);
    const all = await call(gm, "listEmployees", { limit: 200 });
    const ids = all.body.result.items.map((i) => i.employeeId);
    assert.ok(!ids.includes("e-t2"));
    assert.deepEqual(ids, [...ids].sort());
    for (const s of LIFECYCLE) assert.ok(ids.includes(`e-${s.toLowerCase()}`), s);
    assert.deepEqual(Object.keys(all.body.result.items[0]).sort(), ["displayName", "employeeId", "employeeNumber", "employmentStatus", "jobTitle", "operatingCompanyId"]);
    const former = await call(gm, "listEmployees", { employmentStatus: ["TERMINATED", "RETIRED"] });
    assert.deepEqual(former.body.result.items.map((i) => i.employeeId), ["e-retired", "e-terminated"]);
    const seen = [];
    let cursor;
    do {
      const page = await call(gm, "listEmployees", { limit: 3, ...(cursor ? { cursor } : {}) });
      assert.equal(page.status, 200, JSON.stringify(page.body));
      assert.ok(page.body.result.items.length <= 3);
      seen.push(...page.body.result.items.map((i) => i.employeeId));
      cursor = page.body.result.nextCursor;
    } while (cursor);
    assert.deepEqual(seen, ids);
    const bad = await call(gm, "listEmployees", { employmentStatus: "FORMER" });
    assert.deepEqual([bad.status, bad.body.code], [400, "FILTER_INVALID"]);
  });

  await t.test("EMP-RT-02 readEmployeePrincipalLink requires admin.principalAccess.read; employee.record.read alone is refused", async () => {
    const byGm = await call(gm, "readEmployeePrincipalLink", { employeeId: "e-full" });
    assert.deepEqual([byGm.status, byGm.body.code], [403, "CAPABILITY_REQUIRED"]);
    const byAdmin = await call(admin, "readEmployeePrincipalLink", { employeeId: "e-full" });
    assert.equal(byAdmin.status, 200, JSON.stringify(byAdmin.body));
    assert.deepEqual({ ...byAdmin.body.result.link, linkedAt: undefined }, {
      linkId: "epl-gm", principalId: gm.principalId, principalDisplayName: null, principalStatus: "active", membershipStatus: "active",
      linkSource: "OPERATOR_ASSERTED", linkedAt: undefined, assertedBy: "fixture-operator",
    });
    assert.doesNotMatch(byAdmin.raw, /firebase-uid-gm|external|provider|roleAssignment|heldRole/i, "the link read leaked credential or Role facts");
    const unlinked = await call(admin, "readEmployeePrincipalLink", { employeeId: "e-active" });
    assert.deepEqual([unlinked.body.result.userAccess, unlinked.body.result.link], ["UNLINKED", null]);
    const foreign = await call(t2Admin, "readEmployeePrincipalLink", { employeeId: "e-full" });
    assert.deepEqual([foreign.status, foreign.body.code], [404, "EMPLOYEE_NOT_FOUND"]);
  });

  await t.test("reporting writer: admin.employeeProfile.write required; establish, no-op, change, end -- history preserved", async () => {
    const gmActor = await commandActor(gm);
    await assert.rejects(commands.establishReportingRelationship({ pool }, gmActor, { employeeId: "e-active", managerEmployeeId: "e-manager" }), (e) => e.code === "CAPABILITY_REQUIRED");
    const adminActor = await commandActor(admin);
    const first = await commands.establishReportingRelationship({ pool }, adminActor, { employeeId: "e-active", managerEmployeeId: "e-manager", reason: "org chart" });
    assert.equal(first.outcome, "ESTABLISHED");
    const again = await commands.establishReportingRelationship({ pool }, adminActor, { employeeId: "e-active", managerEmployeeId: "e-manager" });
    assert.deepEqual([again.outcome, again.relationshipId], ["NO_CHANGE", first.relationshipId]);
    const changed = await commands.establishReportingRelationship({ pool }, adminActor, { employeeId: "e-active", managerEmployeeId: "e-full" });
    assert.deepEqual([changed.outcome, changed.endedRelationshipId], ["CHANGED", first.relationshipId]);
    const history = (await q(`SELECT id, manager_employee_id, effective_to IS NULL AS current, established_by, ended_by, source FROM eos_workforce.employee_reporting_relationships WHERE employee_id='e-active' ORDER BY established_at, id`)).rows;
    assert.equal(history.length, 2, "history was deleted or rewritten");
    assert.deepEqual(history.map((h) => [h.manager_employee_id, h.current, h.established_by, h.source]), [["e-manager", false, admin.principalId, "GOVERNED_COMMAND"], ["e-full", true, admin.principalId, "GOVERNED_COMMAND"]]);
    assert.equal(history[0].ended_by, admin.principalId);
    await assert.rejects(commands.establishReportingRelationship({ pool }, adminActor, { employeeId: "e-active", managerEmployeeId: "e-active" }), (e) => e.code === "REPORTING_SELF_MANAGER");
    await assert.rejects(commands.establishReportingRelationship({ pool }, adminActor, { employeeId: "e-active", managerEmployeeId: "e-t2" }), (e) => e.code === "MANAGER_NOT_FOUND");
    await assert.rejects(commands.establishReportingRelationship({ pool }, adminActor, { employeeId: "e-t2", managerEmployeeId: "e-manager" }), (e) => e.code === "EMPLOYEE_NOT_FOUND");
    const ended = await commands.endReportingRelationship({ pool }, adminActor, { employeeId: "e-active", reason: "left team" });
    assert.equal(ended.outcome, "ENDED");
    await assert.rejects(commands.endReportingRelationship({ pool }, adminActor, { employeeId: "e-active" }), (e) => e.code === "REPORTING_RELATIONSHIP_NOT_FOUND");
    assert.equal((await q(`SELECT count(*)::int n FROM eos_workforce.employee_reporting_relationships WHERE employee_id='e-active'`)).rows[0].n, 2);
    const audits = (await q(`SELECT action, actor_uid FROM eos_policy.audit_events WHERE target_kind='employee' AND target_id='e-active' ORDER BY occurred_at, id`)).rows;
    assert.deepEqual(audits.map((a) => a.action).sort(), ["employee.reportingRelationship.end", "employee.reportingRelationship.establish", "employee.reportingRelationship.establish"]);
    assert.ok(audits.every((a) => a.actor_uid === admin.principalId));
  });

  await t.test("EMP-RT-06 listManagedEmployees: current direct reports only, bounded, foreign tenant 404; readEmployee shows the current manager", async () => {
    const adminActor = await commandActor(admin);
    for (const e of ["e-on_leave", "e-inactive", "e-terminated", "e-retired"]) {
      await commands.establishReportingRelationship({ pool }, adminActor, { employeeId: e, managerEmployeeId: "e-manager" });
    }
    await commands.endReportingRelationship({ pool }, adminActor, { employeeId: "e-retired" });
    const res = await call(gm, "listManagedEmployees", { managerEmployeeId: "e-manager", limit: 2 });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.result.items.map((i) => i.employeeId), ["e-inactive", "e-on_leave"]);
    const rest = await call(gm, "listManagedEmployees", { managerEmployeeId: "e-manager", limit: 2, cursor: res.body.result.nextCursor });
    assert.deepEqual([rest.body.result.items.map((i) => i.employeeId), rest.body.result.nextCursor], [["e-terminated"], null]);
    assert.equal((await call(others.dispatcher, "listManagedEmployees", { managerEmployeeId: "e-manager" })).status, 403);
    assert.deepEqual((await call(gm, "listManagedEmployees", { managerEmployeeId: "e-t2" })).body.code, "EMPLOYEE_NOT_FOUND");
    const report = (await call(gm, "readEmployee", { employeeId: "e-on_leave" })).body.result;
    assert.deepEqual([report.currentManager.managerEmployeeId, report.currentManager.displayName], ["e-manager", "Maria Manager"]);
  });

  await t.test("EMP-RT-07 self view carries the profile facts and current manager with no selector and no capability", async () => {
    const res = await call(gm, "readMyEmployeeProfile");
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual([res.body.result.employee.employeeId, res.body.result.employee.jobTitle, res.body.result.employee.displayName], ["e-full", "Service Lead", "Bob"]);
    assert.doesNotMatch(res.raw, /operational|jobRole|Job Role/i);
  });
});

// ════════════════════ the profile migration ════════════════════

test("employee profile COPY ONCE / VERIFY / RECONCILE over a real database", { skip: SKIP, concurrency: 1 }, async (t) => {
  const { pool, q } = await freshWorld(t, "emp_cutover");
  const UID = "firebaseUidAbcdefghijklmnop12";
  for (const id of ["e-a", "e-b", "e-mgr", "e-conflict-holder"]) await employee(q, id);
  await q(`UPDATE eos_workforce.employees SET employee_number='OTHER-9' WHERE id='e-conflict-holder'`);
  const snapshot = (overrides = {}) => ({
    format: "EOS_EMPLOYEE_PROFILE_SNAPSHOT", version: 1, source: { firebaseProjectId: "eos-platform-sandbox", exportedAt: "2026-09-10T12:00:00.000Z" },
    employees: [
      { id: "e-a", data: { displayName: " Alice A ", firstName: "Alice", employeeNumber: "A-1", hireDate: "2020-02-29", address: { city: "Tempe", state: "" },
        managerEmployeeId: "e-mgr", userId: UID, operationalRoles: ["TECHNICIAN"], securityRole: "technician", employmentStatus: "ON_LEAVE", ...overrides } },
      { id: "e-b", data: { displayName: "Bea", managerEmployeeId: "e-missing" } },
      { id: "e-mgr", data: { displayName: "Mgr", jobTitle: "Manager" } },
      { id: "e-not-in-pg", data: { displayName: "Ghost", managerEmployeeId: "e-mgr" } },
    ],
  });
  const load = (raw) => snapshotLib.censusEmployeeProfileSnapshot(snapshotLib.parseEmployeeProfileSnapshot(raw));
  const withClientDo = async (fn) => { const c = await pool.connect(); try { return await fn(c); } finally { c.release(); } };

  let first;
  await t.test("census is copy-ready, counts uid pointers and operationalRoles, and carries neither into the canonical form", async () => {
    const { census, canonical } = load(snapshot());
    assert.equal(census.copyReady, true, JSON.stringify(census.blockers));
    assert.deepEqual([census.legacyAccountPointers, census.operationalRolesNotMigrated], [1, 1]);
    assert.ok(!JSON.stringify(canonical).includes(UID));
    assert.doesNotMatch(JSON.stringify(canonical.profiles), /TECHNICIAN|technician|operational/);
    assert.deepEqual(census.reconciliation, [{ id: "e-b", field: "managerEmployeeId", code: "MANAGER_NOT_IN_SNAPSHOT" }]);
  });

  await t.test("copy writes profiles and resolvable managers once; reconciliation is reported, not guessed", async () => {
    const { census, canonical } = load(snapshot());
    first = await withClientDo((c) => cutover.copyEmployeeProfiles(c, { tenantId: "t1", performedBy: "op", canonical, canonicalDigest: census.canonicalDigest }));
    assert.deepEqual([first.outcome, first.profiles, first.reportingRelationships], ["COPIED", { updated: 3, unchanged: 0 }, { inserted: 1, unchanged: 0 }]);
    const codes = first.reconciliation.map((r) => `${r.id}:${r.code}`).sort();
    assert.deepEqual(codes, ["e-a:EMPLOYMENT_STATUS_DIFFERS", "e-not-in-pg:EMPLOYEE_NOT_IN_POSTGRES", "e-not-in-pg:MANAGER_RELATIONSHIP_NOT_RESOLVABLE"]);
    const a = (await q(`SELECT display_name, first_name, employee_number, to_char(hire_date,'YYYY-MM-DD') hire, address_city, address_state, employment_status::text s FROM eos_workforce.employees WHERE id='e-a'`)).rows[0];
    assert.deepEqual(a, { display_name: "Alice A", first_name: "Alice", employee_number: "A-1", hire: "2020-02-29", address_city: "Tempe", address_state: null, s: "ACTIVE" });
    const rel = (await q(`SELECT manager_employee_id, established_by, source, effective_from FROM eos_workforce.employee_reporting_relationships WHERE employee_id='e-a'`)).rows;
    assert.deepEqual(rel.map((r) => [r.manager_employee_id, r.established_by, r.source, r.effective_from.toISOString()]), [["e-mgr", "employee-profile-cutover:op", "LEGACY_PROFILE_MIGRATION", "2026-09-10T12:00:00.000Z"]]);
    assert.equal((await q(`SELECT count(*)::int n FROM eos_workforce.employees WHERE id='e-not-in-pg'`)).rows[0].n, 0, "the copy created an Employee");
  });

  await t.test("a Firebase uid is provenance only: it appears in no PostgreSQL row", async () => {
    const dump = JSON.stringify([
      (await q(`SELECT * FROM eos_workforce.employees`)).rows, (await q(`SELECT * FROM eos_workforce.employee_reporting_relationships`)).rows,
      (await q(`SELECT * FROM eos_policy.audit_events`)).rows,
    ]);
    assert.ok(!dump.includes(UID), "a Firebase uid was written to PostgreSQL");
  });

  await t.test("rerun of the same snapshot is a no-op; verify reconciles", async () => {
    const { census, canonical } = load(snapshot());
    const audits = (await q(`SELECT count(*)::int n FROM eos_policy.audit_events`)).rows[0].n;
    const again = await withClientDo((c) => cutover.copyEmployeeProfiles(c, { tenantId: "t1", performedBy: "op", canonical, canonicalDigest: census.canonicalDigest }));
    assert.deepEqual([again.outcome, again.profiles.updated, again.reportingRelationships.inserted], ["NO_CHANGES", 0, 0]);
    assert.equal((await q(`SELECT count(*)::int n FROM eos_policy.audit_events`)).rows[0].n, audits);
    const verify = await withClientDo((c) => cutover.verifyEmployeeProfiles(c, { tenantId: "t1", canonical }));
    assert.equal(verify.reconciled, true, JSON.stringify(verify));
  });

  await t.test("drift is refused and nothing is written: a changed profile, or a different current manager", async () => {
    const before = JSON.stringify((await q(`SELECT * FROM eos_workforce.employees ORDER BY id`)).rows);
    const changed = load(snapshot({ firstName: "Alicia" }));
    await assert.rejects(withClientDo((c) => cutover.copyEmployeeProfiles(c, { tenantId: "t1", performedBy: "op", canonical: changed.canonical, canonicalDigest: changed.census.canonicalDigest })), (e) => e.code === "DRIFT_DETECTED");
    const mgr = load(snapshot({ managerEmployeeId: "e-b" }));
    await assert.rejects(withClientDo((c) => cutover.copyEmployeeProfiles(c, { tenantId: "t1", performedBy: "op", canonical: mgr.canonical, canonicalDigest: mgr.census.canonicalDigest })), (e) => e.code === "DRIFT_DETECTED");
    assert.equal(JSON.stringify((await q(`SELECT * FROM eos_workforce.employees ORDER BY id`)).rows), before);
    const verify = await withClientDo((c) => cutover.verifyEmployeeProfiles(c, { tenantId: "t1", canonical: changed.canonical }));
    assert.deepEqual(verify.profiles.mismatched, [{ id: "e-a", fields: ["first_name"] }]);
  });

  await t.test("an employee number already held by another Employee refuses; invalid source values are census blockers", async () => {
    await employee(q, "e-late");
    const raw = snapshot();
    raw.employees.push({ id: "e-late", data: { employeeNumber: "other-9" } });
    const { census, canonical } = load(raw);
    await assert.rejects(withClientDo((c) => cutover.copyEmployeeProfiles(c, { tenantId: "t1", performedBy: "op", canonical, canonicalDigest: census.canonicalDigest })), (e) => e.code === "EMPLOYEE_NUMBER_CONFLICT");
    const bad = load({ ...snapshot(), employees: [
      { id: "x1", data: { hireDate: "2021-02-30", workEmail: "nope", employeeNumber: "N-1" } },
      { id: "x2", data: { employeeNumber: "n-1", firstName: 42, address: "1 Main St" } },
    ] }).census;
    assert.equal(bad.copyReady, false);
    assert.deepEqual(bad.blockers.map((b) => `${b.id}:${b.field}:${b.code}`).sort(), [
      "x1:employeeNumber:EMPLOYEE_NUMBER_DUPLICATE", "x1:hireDate:CALENDAR_DATE_INVALID", "x1:workEmail:EMAIL_SHAPE_INVALID",
      "x2:address.city:ADDRESS_NOT_A_MAP", "x2:address.postalCode:ADDRESS_NOT_A_MAP", "x2:address.state:ADDRESS_NOT_A_MAP", "x2:address.street:ADDRESS_NOT_A_MAP",
      "x2:address.unit:ADDRESS_NOT_A_MAP", "x2:employeeNumber:EMPLOYEE_NUMBER_DUPLICATE", "x2:firstName:NOT_A_STRING",
    ]);
  });
});
