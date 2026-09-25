// LANE BT -- the GOVERNED PostgreSQL Employee ADMINISTRATION capability, against a real postgres:16.
//
// The subject: createEmployee (the Employee's governed birth), and the Employee <-> Principal link
// commands (link / unlink / relink), whose revoke and move carry MANDATORY expected-current-value
// protection. Before this lane the only thing that could INSERT an Employee was a fixture seed.
//
// The suite migrates its OWN disposable database. Roles, grants, Principals and Employees exist ONLY
// there. Grants are delivered through the EXISTING Role-catalog reconciliation and actors are resolved
// through the EXISTING resolvers -- never a hand-built capability set, because a fabricated one would
// make the command's own gate decorative.
//
// THE DENIALS ARE THE POINT. Nothing here fixes a refusal by granting the capability to the refused
// persona: generalManager is the unauthorized persona throughout and stays that way.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import pg from "pg";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const creation = require("../lib/eosWorkforce/commands/employeeCreationCommand.js");
const linkCmd = require("../lib/eosWorkforce/commands/employeePrincipalLinkCommands.js");
const profileCmd = require("../lib/eosWorkforce/commands/employeeProfileCommand.js");
const jobRoleCmd = require("../lib/eosWorkforce/commands/employeeJobRoleCommands.js");
const jobRoleSeed = require("../lib/eosWorkforce/migration/jobRoleCatalogSeed.js");
const actorAuthority = require("../lib/eosWorkforce/commands/employeeAdministrationAuthority.js");
const linkRead = require("../lib/eosWorkforce/reads/employeePrincipalLinkRead.js");
const historyRead = require("../lib/eosWorkforce/reads/employeeChangeHistoryRead.js");
const companies = require("../lib/eosWorkforce/migration/tenantOperatingCompanies.js");
const grants = require("../lib/eosWorkforce/migration/employeeCapabilityGrants.js");
const http = require("../lib/eosWorkforce/workforceHttp.js");
const cli = require("../scripts/administerEmployeeCli.js");
const { resolveOperationalContext } = require("../lib/eosOps/capabilityAuthority.js");
const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");

const dbUrlFor = (name) => { const u = new URL(URL_BASE); u.pathname = `/${name}`; return u.toString(); };
async function withClient(url, fn) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try { return await fn(client); } finally { await client.end(); }
}

const REASON = "lane BT acceptance: administering this Employee through the governed command";

test("createEmployee and the Employee <-> Principal link commands over the real Workforce and policy authorities", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `emp_admin_cmd_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
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
  const deps = { pool };
  await q(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ('t1','t1','T1'), ('t2','t2','T2')`);

  const fixture = (tenantId) => ({ tenantId, uid: "uid-fixture-admin" });
  const roleIds = {};
  for (const tenantId of ["t1", "t2"]) {
    for (const key of ["admin", "generalManager"]) {
      roleIds[`${tenantId}:${key}`] = (await repo.transact(fixture(tenantId), (tx) => tx.createRole({ key, name: key, description: null, origin: "CUSTOM", protected: false }))).id;
    }
    await grants.reconcileEmployeeCapabilityGrants(pool, { tenantId, apply: true, actor: "employee-capability-grants:test" });
    // 'taylor' is the ONLY operating company authorized for either tenant; 'ventana' is known to the
    // code and authorized for neither, which is what makes the tenant-scoped refusal real.
    await companies.reconcileTenantOperatingCompanies(pool, { tenantId, companyIds: ["taylor"], source: "test-evidence", actor: "tenant-operating-companies:test", apply: true });
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
  /** The transport's resolver: Roles only, exactly as every shipped operation resolves. */
  const resolveActor = async (principal) => {
    const ctx = await resolveOperationalContext(repo, pool, { identityProvider: "firebase", externalSubject: principal.subject, requestedTenantId: null });
    return { tenantId: ctx.principalContext.tenantId, principalId: ctx.principalContext.uid, capabilities: ctx.capabilities, entitlements: ctx.entitlements };
  };

  const admin = await makePrincipal("t1", "uid-admin", "admin");
  const gm = await makePrincipal("t1", "uid-gm", "generalManager");
  const directGrantee = await makePrincipal("t1", "uid-direct", "generalManager");
  const t2Admin = await makePrincipal("t2", "uid-t2-admin", "admin");
  const pJane = await makePrincipal("t1", "uid-jane", "generalManager");
  const pBob = await makePrincipal("t1", "uid-bob", "generalManager");
  const pSpare = await makePrincipal("t1", "uid-spare", "generalManager");
  const pDisabled = await makePrincipal("t1", "uid-disabled", "generalManager");
  const pForeign = await makePrincipal("t2", "uid-foreign", "generalManager");
  await q(`UPDATE eos_policy.principals SET status = 'disabled' WHERE id = $1`, [pDisabled.principalId]);

  // The DIRECT grant (eos_policy.principal_capabilities): the standing Owner ruling is that it counts.
  // generalManager does NOT hold admin.employeeProfile.write, so this Principal's only path to the
  // capability is the direct grant -- which is exactly what makes the proof non-vacuous.
  await q(
    `INSERT INTO eos_policy.principal_capabilities (id, tenant_id, principal_id, capability_id, granted_by, granted_at, created_by, created_at, updated_by, updated_at)
     SELECT 'pc-direct-1', 't1', $1, c.id, 'fixture', now(), 'fixture', now(), 'fixture', now()
       FROM eos_policy.capabilities c WHERE c.key = 'admin.employeeProfile.write'`, [directGrantee.principalId]);

  const adminActor = await resolveActor(admin);
  const gmActor = await resolveActor(gm);
  const t2AdminActor = await resolveActor(t2Admin);
  const directActor = await resolveActor(directGrantee);

  const employeeRow = async (id) => (await q(
    `SELECT id, tenant_id, employment_status::text AS employment_status, operating_company_id, employee_number, display_name,
            first_name, job_title, work_email, address_city, to_char(hire_date, 'YYYY-MM-DD') AS hire_date
       FROM eos_workforce.employees WHERE id = $1`, [id])).rows[0];
  const auditsFor = async (id) => (await q(
    `SELECT action, actor_uid, before, after, reason FROM eos_policy.audit_events
      WHERE target_kind = 'employee' AND target_id = $1 ORDER BY occurred_at, id`, [id])).rows;
  const linkRows = async (employeeId) => (await q(
    `SELECT id, principal_id, status, link_source, asserted_by, assertion_reason, operating_company_id
       FROM eos_policy.employee_principal_links WHERE employee_id = $1 ORDER BY created_at, id`, [employeeId])).rows;

  /** Every authority dimension a governed Employee administration command must leave alone. */
  const authoritySnapshot = async () => ({
    roleAssignments: (await q(`SELECT principal_id, role_id, status FROM eos_policy.user_role_assignments ORDER BY 1, 2`)).rows,
    roleCapabilities: (await q(`SELECT count(*)::int n FROM eos_policy.role_capabilities`)).rows[0].n,
    principalCapabilities: (await q(`SELECT principal_id, capability_id FROM eos_policy.principal_capabilities ORDER BY 1, 2`)).rows,
    principals: (await q(`SELECT id, status::text, identity_provider, external_subject FROM eos_policy.principals ORDER BY id`)).rows,
    memberships: (await q(`SELECT principal_id, tenant_id, status::text FROM eos_policy.tenant_memberships ORDER BY 1, 2`)).rows,
    roles: (await q(`SELECT count(*)::int n FROM eos_policy.roles`)).rows[0].n,
    capabilities: (await q(`SELECT count(*)::int n FROM eos_policy.capabilities`)).rows[0].n,
    jobRoleAssignments: (await q(`SELECT count(*)::int n FROM eos_workforce.employee_job_role_assignments`)).rows[0].n,
    workEligibility: (await q(`SELECT count(*)::int n FROM eos_workforce.employee_work_eligibility`)).rows[0].n,
    operationalScopes: (await q(`SELECT count(*)::int n FROM eos_workforce.employee_operational_scopes`)).rows[0].n,
    reporting: (await q(`SELECT count(*)::int n FROM eos_workforce.employee_reporting_relationships`)).rows[0].n,
  });
  const same = (a, b) => assert.deepEqual(a, b);

  // ════════════════════ create ════════════════════

  await t.test("an authorized Principal CREATES an Employee: one row, one audit event, and NOT ONE unit of authority", async () => {
    const before = await authoritySnapshot();
    const result = await creation.createEmployee(deps, adminActor, {
      employeeId: "emp-jane", employmentStatus: "ACTIVE", operatingCompanyId: "taylor",
      profile: { displayName: "Jane Doe", firstName: "Jane", employeeNumber: "TAZ-1001", workEmail: "jane@example.com", hireDate: "2026-09-01" },
      reason: "new hire, per signed offer 2026-09-25",
    });
    assert.deepEqual([result.outcome, result.employeeId, result.employmentStatus, result.operatingCompanyId, [...result.grantedAuthority]],
      ["CREATED", "emp-jane", "ACTIVE", "taylor", []]);
    assert.deepEqual([...result.profileFields], ["employeeNumber", "displayName", "firstName", "workEmail", "hireDate"]);
    const row = await employeeRow("emp-jane");
    assert.deepEqual(
      [row.tenant_id, row.employment_status, row.operating_company_id, row.display_name, row.first_name, row.employee_number, row.work_email, row.hire_date],
      ["t1", "ACTIVE", "taylor", "Jane Doe", "Jane", "TAZ-1001", "jane@example.com", "2026-09-01"]);
    // Nothing was fabricated: the fields the caller did not state are NULL, not guessed.
    assert.deepEqual([row.job_title, row.address_city], [null, null]);

    // ONE audit event, naming the EOS Principal -- never a Firebase uid -- with before = null.
    const events = await auditsFor("emp-jane");
    assert.equal(events.length, 1);
    assert.deepEqual([events[0].action, events[0].actor_uid, events[0].before, events[0].reason],
      ["employee.record.create", admin.principalId, null, "new hire, per signed offer 2026-09-25"]);
    assert.deepEqual(events[0].after, {
      employmentStatus: "ACTIVE", operatingCompanyId: "taylor", employeeNumber: "TAZ-1001",
      displayName: "Jane Doe", firstName: "Jane", workEmail: "jane@example.com", hireDate: "2026-09-01",
    });
    assert.equal(events[0].actor_uid.startsWith("uid-"), false, "the audit names an external subject rather than a Principal");

    // CREATING AN EMPLOYEE CREATES NO AUTHORITY. Every dimension is byte-identical, and the new
    // Employee has no Security Role, no Job Role, no qualification, no scope, no manager and no login.
    same(await authoritySnapshot(), before);
    assert.equal((await linkRows("emp-jane")).length, 0);
    const access = await linkRead.readEmployeePrincipalLink(deps, adminActor, { employeeId: "emp-jane" });
    assert.deepEqual([access.userAccess, access.link], ["UNLINKED", null]);
  });

  await t.test("an UNAUTHORIZED Principal is REFUSED and writes nothing -- the denial is the point, and no grant is invented to remove it", async () => {
    const before = await authoritySnapshot();
    assert.equal(gmActor.capabilities.has("admin.employeeProfile.write"), false, "the unauthorized persona holds the capability");
    assert.equal(gmActor.capabilities.has("employee.record.read"), true, "the unauthorized persona is not authorized for anything at all");
    await assert.rejects(
      creation.createEmployee(deps, gmActor, { employeeId: "emp-refused", employmentStatus: "ACTIVE", operatingCompanyId: "taylor", reason: "should never be created" }),
      (e) => e.code === "CAPABILITY_REQUIRED" && e.category === "FORBIDDEN" && /admin\.employeeProfile\.write/.test(e.message));
    assert.equal(await employeeRow("emp-refused"), undefined);
    assert.equal((await auditsFor("emp-refused")).length, 0);
    same(await authoritySnapshot(), before);
    // The same refusal for the link commands, and for the profile writer.
    for (const call of [
      () => linkCmd.linkEmployeePrincipal(deps, gmActor, { employeeId: "emp-jane", linkedPrincipalId: pJane.principalId, reason: REASON }),
      () => linkCmd.unlinkEmployeePrincipal(deps, gmActor, { employeeId: "emp-jane", expectedCurrentPrincipalId: pJane.principalId, reason: REASON }),
      () => linkCmd.relinkEmployeePrincipal(deps, gmActor, { employeeId: "emp-jane", expectedCurrentPrincipalId: pJane.principalId, newPrincipalId: pBob.principalId, reason: REASON }),
    ]) await assert.rejects(call, (e) => e.code === "CAPABILITY_REQUIRED");
    assert.equal((await linkRows("emp-jane")).length, 0);
  });

  await t.test("a DIRECT Principal grant COUNTS: the Role set alone refuses this Principal, the direct grant admits it", async () => {
    // Non-vacuity: the transport's Role-only resolution does NOT carry the capability for this Principal.
    assert.equal(directActor.capabilities.has("admin.employeeProfile.write"), false);
    const resolved = await actorAuthority.resolveEmployeeAdministrationActor(pool, { tenantId: "t1", principalId: directGrantee.principalId });
    assert.deepEqual([[...resolved.heldRoleKeys], [...resolved.directCapabilityKeys]], [["generalManager"], ["admin.employeeProfile.write"]]);
    assert.equal(resolved.capabilities.has("admin.employeeProfile.write"), true);
    // Through the operator resolution AND through the transport actor: the command augments either one.
    const viaTransportActor = await creation.createEmployee(deps, directActor, {
      employeeId: "emp-direct", employmentStatus: "CONTRACTOR", operatingCompanyId: "taylor", reason: "created by a directly granted Principal",
    });
    assert.equal(viaTransportActor.outcome, "CREATED");
    assert.equal((await auditsFor("emp-direct"))[0].actor_uid, directGrantee.principalId);
    // And an unreadable / absent direct grant is never read as "allowed": the gm Principal has none.
    const gmResolved = await actorAuthority.resolveEmployeeAdministrationActor(pool, { tenantId: "t1", principalId: gm.principalId });
    assert.deepEqual([...gmResolved.directCapabilityKeys], []);
    assert.equal(gmResolved.capabilities.has("admin.employeeProfile.write"), false);
  });

  await t.test("the administering actor is REFUSED, never narrowed: unknown, disabled, non-member -- and argv-supplied authority is refused by name", async () => {
    for (const request of [
      { tenantId: "t1", principalId: "p-does-not-exist" },
      { tenantId: "t1", principalId: pDisabled.principalId },
      { tenantId: "t2", principalId: admin.principalId },
      { tenantId: "t1", principalId: "" },
    ]) {
      await assert.rejects(actorAuthority.resolveEmployeeAdministrationActor(pool, request),
        (e) => e.category === "FORBIDDEN" && ["ADMINISTRATOR_NOT_ACTIVE_MEMBER", "ADMINISTRATOR_REQUIRED"].includes(e.code), JSON.stringify(request));
    }
    await assert.rejects(
      actorAuthority.resolveEmployeeAdministrationActor(pool, { tenantId: "t1", principalId: admin.principalId, capabilities: new Set(["admin.employeeProfile.write"]) }),
      (e) => e.code === "AUTHORITY_ARGUMENT_REFUSED");
    await assert.rejects(
      actorAuthority.resolveEmployeeAdministrationActor(pool, { tenantId: "t1", principalId: gm.principalId, heldRoleKeys: ["admin"] }),
      (e) => e.code === "AUTHORITY_ARGUMENT_REFUSED");
  });

  await t.test("a DUPLICATE Employee id is REFUSED, not absorbed -- in this tenant and in another -- and appends no second audit event", async () => {
    const before = await authoritySnapshot();
    const events = (await auditsFor("emp-jane")).length;
    // Same tenant, identical facts: still a refusal. A create is not a declaration of state.
    await assert.rejects(creation.createEmployee(deps, adminActor, {
      employeeId: "emp-jane", employmentStatus: "ACTIVE", operatingCompanyId: "taylor", reason: "resubmitted creation of an existing Employee",
    }), (e) => e.code === "EMPLOYEE_ALREADY_EXISTS" && e.category === "CONFLICT");
    // Same tenant, DIFFERENT facts: the same refusal, and the stored row is untouched -- never an upsert.
    await assert.rejects(creation.createEmployee(deps, adminActor, {
      employeeId: "emp-jane", employmentStatus: "TERMINATED", operatingCompanyId: "taylor",
      profile: { displayName: "Overwritten" }, reason: "an upsert attempt dressed as a creation",
    }), (e) => e.code === "EMPLOYEE_ALREADY_EXISTS");
    assert.deepEqual([(await employeeRow("emp-jane")).display_name, (await employeeRow("emp-jane")).employment_status], ["Jane Doe", "ACTIVE"]);
    // ANOTHER TENANT's administrator, same id: employees.id is the GLOBAL primary key, so the id is
    // taken -- and the refusal discloses nothing about the other tenant beyond that.
    await assert.rejects(creation.createEmployee(deps, t2AdminActor, {
      employeeId: "emp-jane", employmentStatus: "ACTIVE", operatingCompanyId: "taylor", reason: "cross-tenant creation of a taken id",
    }), (e) => e.code === "EMPLOYEE_ALREADY_EXISTS");
    assert.equal((await employeeRow("emp-jane")).tenant_id, "t1");
    assert.equal((await auditsFor("emp-jane")).length, events, "a refused creation appended an audit event");
    same(await authoritySnapshot(), before);
    // An employee NUMBER another Employee of the tenant holds is its own refusal, before any row lands.
    await assert.rejects(creation.createEmployee(deps, adminActor, {
      employeeId: "emp-number-clash", employmentStatus: "ACTIVE", operatingCompanyId: "taylor",
      profile: { employeeNumber: "taz-1001" }, reason: "an employee number another Employee holds",
    }), (e) => e.code === "EMPLOYEE_NUMBER_TAKEN" && e.category === "CONFLICT");
    assert.equal(await employeeRow("emp-number-clash"), undefined);
  });

  await t.test("CROSS-TENANT: another tenant's administrator cannot read, change or link this tenant's Employee", async () => {
    // t2Admin holds admin.employeeProfile.write -- in t2. The Employee simply does not exist for it.
    assert.equal(t2AdminActor.capabilities.has("admin.employeeProfile.write"), true);
    for (const call of [
      () => profileCmd.updateEmployeeProfile(deps, t2AdminActor, { employeeId: "emp-jane", changes: { jobTitle: "Stolen" } }),
      () => linkCmd.linkEmployeePrincipal(deps, t2AdminActor, { employeeId: "emp-jane", linkedPrincipalId: pForeign.principalId, reason: REASON }),
      () => linkCmd.unlinkEmployeePrincipal(deps, t2AdminActor, { employeeId: "emp-jane", expectedCurrentPrincipalId: pJane.principalId, reason: REASON }),
      () => linkCmd.relinkEmployeePrincipal(deps, t2AdminActor, { employeeId: "emp-jane", expectedCurrentPrincipalId: pJane.principalId, newPrincipalId: pForeign.principalId, reason: REASON }),
    ]) await assert.rejects(call, (e) => e.code === "EMPLOYEE_NOT_FOUND" && e.category === "NOT_FOUND");
    assert.deepEqual([(await employeeRow("emp-jane")).job_title, (await linkRows("emp-jane")).length], [null, 0]);
    // A t2 Employee with the same shape is administered normally by t2's administrator, so the refusals
    // above are about the TENANT and not about the tenant having no authority at all.
    assert.equal((await creation.createEmployee(deps, t2AdminActor, {
      employeeId: "emp-t2-own", employmentStatus: "ACTIVE", operatingCompanyId: "taylor", reason: "t2 administers its own Employee",
    })).outcome, "CREATED");
    assert.equal((await employeeRow("emp-t2-own")).tenant_id, "t2");
  });

  await t.test("the operating company must be AUTHORIZED and ACTIVE for the tenant; a code-recognised id is not enough", async () => {
    await assert.rejects(creation.createEmployee(deps, adminActor, {
      employeeId: "emp-bad-company", employmentStatus: "ACTIVE", operatingCompanyId: "ventana", reason: "a company this tenant is not authorized for",
    }), (e) => e.code === "OPERATING_COMPANY_NOT_AUTHORIZED_FOR_TENANT" && e.category === "PRECONDITION_FAILED");
    await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id, operating_company_id, status, source, established_by, updated_by)
             VALUES ('t1', 'retired-co', 'INACTIVE', 'test', 'test', 'test')`);
    await assert.rejects(creation.createEmployee(deps, adminActor, {
      employeeId: "emp-inactive-company", employmentStatus: "ACTIVE", operatingCompanyId: "retired-co", reason: "an inactive company link for this tenant",
    }), (e) => e.code === "OPERATING_COMPANY_INACTIVE");
    assert.deepEqual([await employeeRow("emp-bad-company"), await employeeRow("emp-inactive-company")], [undefined, undefined]);
  });

  // ════════════════════ the profile writer over a created Employee ════════════════════

  await t.test("the profile UPDATE works over a created Employee, and an identical resubmission is NO_CHANGE with NO second audit event", async () => {
    const changed = await profileCmd.updateEmployeeProfile(deps, adminActor, {
      employeeId: "emp-jane", changes: { jobTitle: "Service Technician", "address.city": "Phoenix" }, reason: "title and city correction",
    });
    assert.deepEqual([changed.outcome, [...changed.changedFields]], ["UPDATED", ["jobTitle", "address.city"]]);
    const afterFirst = await auditsFor("emp-jane");
    assert.deepEqual(afterFirst.map((e) => e.action), ["employee.record.create", "employee.profile.update"]);
    // IDEMPOTENT / NO CHANGE writes NOTHING and audits NOTHING.
    const again = await profileCmd.updateEmployeeProfile(deps, adminActor, {
      employeeId: "emp-jane", changes: { jobTitle: "Service Technician", "address.city": "Phoenix" }, reason: "resubmitted identical edit",
    });
    assert.deepEqual([again.outcome, [...again.changedFields], again.auditEventId], ["NO_CHANGE", [], null]);
    assert.equal((await auditsFor("emp-jane")).length, afterFirst.length, "a no-change edit appended an audit event");
  });

  // ════════════════════ the Employee <-> Principal link ════════════════════

  await t.test("LINKING preserves the Principal's authority exactly, creates no Role and no grant, and a resubmission is NO_CHANGE with no second audit event", async () => {
    const before = await authoritySnapshot();
    const linked = await linkCmd.linkEmployeePrincipal(deps, adminActor, {
      employeeId: "emp-jane", linkedPrincipalId: pJane.principalId, reason: "Jane's EOS login, confirmed by the operator",
    });
    assert.deepEqual([linked.outcome, linked.linkedPrincipalId, linked.revokedLinkId], ["LINKED", pJane.principalId, null]);
    const rows = await linkRows("emp-jane");
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].status, rows[0].link_source, rows[0].asserted_by, rows[0].assertion_reason, rows[0].operating_company_id],
      ["active", "OPERATOR_ASSERTED", admin.principalId, "Jane's EOS login, confirmed by the operator", "taylor"]);
    // THE PRINCIPAL'S AUTHORITY IS UNCHANGED, measured rather than asserted: its Roles, its grants, its
    // status, its identity and its membership are byte-identical, and no Role or capability was created.
    same(await authoritySnapshot(), before);
    // The Employee's own facts are untouched too -- a link is not an Employee edit.
    const row = await employeeRow("emp-jane");
    assert.deepEqual([row.employment_status, row.operating_company_id, row.job_title], ["ACTIVE", "taylor", "Service Technician"]);
    // Exactly one link audit event, and its before/after say UNLINKED -> LINKED.
    const events = await auditsFor("emp-jane");
    const establish = events.filter((e) => e.action === "employee.principalLink.establish");
    assert.equal(establish.length, 1);
    assert.deepEqual([establish[0].before.userAccess, establish[0].after.userAccess, establish[0].after.linkedPrincipalId],
      ["UNLINKED", "LINKED", pJane.principalId]);

    // IDEMPOTENT: the same Principal again is NO_CHANGE -- no second row, no second audit event.
    const repeat = await linkCmd.linkEmployeePrincipal(deps, adminActor, {
      employeeId: "emp-jane", linkedPrincipalId: pJane.principalId, reason: "resubmitted identical link request",
    });
    assert.deepEqual([repeat.outcome, repeat.linkId, repeat.auditEventId], ["NO_CHANGE", rows[0].id, null]);
    assert.equal((await linkRows("emp-jane")).length, 1);
    assert.equal((await auditsFor("emp-jane")).length, events.length, "a no-change link appended an audit event");
    // The governed read now resolves the login, and only under admin.principalAccess.read.
    const access = await linkRead.readEmployeePrincipalLink(deps, adminActor, { employeeId: "emp-jane" });
    assert.deepEqual([access.userAccess, access.link.principalId, access.link.linkSource], ["LINKED", pJane.principalId, "OPERATOR_ASSERTED"]);
  });

  await t.test("one Employee is one login and one login is one Employee: a second link, a taken Principal, a disabled Principal and a foreign Principal all refuse", async () => {
    const before = await authoritySnapshot();
    // A DIFFERENT Principal for an Employee that already has one: refused by name, and it names the
    // command that CAN move it -- the one that requires the expected current value.
    await assert.rejects(linkCmd.linkEmployeePrincipal(deps, adminActor, { employeeId: "emp-jane", linkedPrincipalId: pBob.principalId, reason: "a second login for one Employee" }),
      (e) => e.code === "EMPLOYEE_ALREADY_LINKED" && e.category === "CONFLICT" && /relinkEmployeePrincipal/.test(e.message));
    // The SAME Principal for a second Employee: refused, because "who did this" would become a choice.
    await assert.rejects(linkCmd.linkEmployeePrincipal(deps, adminActor, { employeeId: "emp-direct", linkedPrincipalId: pJane.principalId, reason: "one login for two Employees" }),
      (e) => e.code === "PRINCIPAL_ALREADY_LINKED" && e.category === "CONFLICT");
    // A disabled Principal, and a Principal of another tenant: neither is an active member here.
    for (const principalId of [pDisabled.principalId, pForeign.principalId, "p-does-not-exist"]) {
      await assert.rejects(linkCmd.linkEmployeePrincipal(deps, adminActor, { employeeId: "emp-direct", linkedPrincipalId: principalId, reason: "a Principal that is not an active member" }),
        (e) => e.code === "PRINCIPAL_NOT_ACTIVE_MEMBER" && e.category === "PRECONDITION_FAILED", principalId);
    }
    assert.equal((await linkRows("emp-direct")).length, 0);
    assert.equal((await linkRows("emp-jane")).length, 1);
    same(await authoritySnapshot(), before);
  });

  await t.test("a STALE expectedCurrentPrincipalId is REFUSED for unlink and for relink; the correct value succeeds; relink is ONE atomic move with ONE audit event", async () => {
    const before = await authoritySnapshot();
    const events = (await auditsFor("emp-jane")).length;
    // STALE: the caller states a Principal that is not the one in force.
    for (const call of [
      () => linkCmd.unlinkEmployeePrincipal(deps, adminActor, { employeeId: "emp-jane", expectedCurrentPrincipalId: pBob.principalId, reason: "a stale expected current value" }),
      () => linkCmd.relinkEmployeePrincipal(deps, adminActor, { employeeId: "emp-jane", expectedCurrentPrincipalId: pBob.principalId, newPrincipalId: pSpare.principalId, reason: "a stale expected current value" }),
    ]) await assert.rejects(call, (e) => e.code === "EMPLOYEE_PRINCIPAL_LINK_STALE" && e.category === "CONFLICT");
    // An Employee with NO link is the same refusal: "the row you read is not the row you are changing".
    await assert.rejects(linkCmd.unlinkEmployeePrincipal(deps, adminActor, { employeeId: "emp-direct", expectedCurrentPrincipalId: pBob.principalId, reason: "no link is in force at all" }),
      (e) => e.code === "EMPLOYEE_PRINCIPAL_LINK_STALE");
    assert.deepEqual((await linkRows("emp-jane")).map((r) => [r.principal_id, r.status]), [[pJane.principalId, "active"]]);
    assert.equal((await auditsFor("emp-jane")).length, events, "a refused link change appended an audit event");
    same(await authoritySnapshot(), before);

    // A relink with the CURRENT value is a no-op, and a no-op writes and audits nothing.
    const noChange = await linkCmd.relinkEmployeePrincipal(deps, adminActor, {
      employeeId: "emp-jane", expectedCurrentPrincipalId: pJane.principalId, newPrincipalId: pJane.principalId, reason: "relink to the Principal already in force",
    });
    assert.deepEqual([noChange.outcome, noChange.auditEventId], ["NO_CHANGE", null]);
    assert.equal((await auditsFor("emp-jane")).length, events);

    // THE MOVE. One transaction: the old row is revoked (kept as history) and the new row appended.
    const moved = await linkCmd.relinkEmployeePrincipal(deps, adminActor, {
      employeeId: "emp-jane", expectedCurrentPrincipalId: pJane.principalId, newPrincipalId: pBob.principalId,
      reason: "Jane's login replaced after an identity provider migration",
    });
    assert.deepEqual([moved.outcome, moved.linkedPrincipalId], ["RELINKED", pBob.principalId]);
    const rows = await linkRows("emp-jane");
    assert.deepEqual(rows.map((r) => [r.principal_id, r.status]), [[pJane.principalId, "revoked"], [pBob.principalId, "active"]]);
    // HISTORY, NOT DELETION: the revoked row keeps the provenance of the establishment it recorded.
    assert.equal(rows[0].assertion_reason, "Jane's EOS login, confirmed by the operator");
    const relinkEvents = (await auditsFor("emp-jane")).filter((e) => e.action === "employee.principalLink.relink");
    assert.equal(relinkEvents.length, 1, "the atomic move appended more or fewer than one audit event");
    assert.deepEqual([relinkEvents[0].before.linkedPrincipalId, relinkEvents[0].after.linkedPrincipalId], [pJane.principalId, pBob.principalId]);
    // The Principal that lost the link keeps every unit of its own authority.
    same(await authoritySnapshot(), before);

    // REVOKE, with the now-current value. It is NOT idempotent: repeating it states a value no longer in force.
    const revoked = await linkCmd.unlinkEmployeePrincipal(deps, adminActor, {
      employeeId: "emp-jane", expectedCurrentPrincipalId: pBob.principalId, reason: "Jane left; her EOS login is revoked",
    });
    assert.deepEqual([revoked.outcome, revoked.linkedPrincipalId, revoked.revokedLinkId], ["REVOKED", null, rows[1].id]);
    assert.deepEqual((await linkRows("emp-jane")).map((r) => r.status), ["revoked", "revoked"]);
    await assert.rejects(linkCmd.unlinkEmployeePrincipal(deps, adminActor, { employeeId: "emp-jane", expectedCurrentPrincipalId: pBob.principalId, reason: "repeating a revoke that already happened" }),
      (e) => e.code === "EMPLOYEE_PRINCIPAL_LINK_STALE");
    // A revoked link does not block a later re-link: the unique indexes are partial on 'active'.
    assert.equal((await linkCmd.linkEmployeePrincipal(deps, adminActor, { employeeId: "emp-jane", linkedPrincipalId: pJane.principalId, reason: "Jane returned; her login is re-established" })).outcome, "LINKED");
    assert.deepEqual((await linkRows("emp-jane")).map((r) => r.status), ["revoked", "revoked", "active"]);
    // Revoking took nothing away from the Principal either.
    same(await authoritySnapshot(), before);
  });

  await t.test("the governed change history reports the creation and the link changes WITHOUT disclosing which Principal", async () => {
    const page = await historyRead.listEmployeeChangeHistory(deps, adminActor, { employeeId: "emp-jane", limit: 50 });
    const actions = page.items.map((i) => i.action);
    assert.deepEqual([...new Set(actions)].sort(),
      ["employee.principalLink.establish", "employee.principalLink.relink", "employee.principalLink.revoke", "employee.profile.update", "employee.record.create"]);
    const create = page.items.find((i) => i.action === "employee.record.create");
    assert.deepEqual([create.before, create.after], [null, { employmentStatus: "ACTIVE", operatingCompanyId: "taylor" }]);
    // The audit ROW carries the Principal id; the READ, whose capability is employee.record.read, does not.
    for (const item of page.items.filter((i) => i.action.startsWith("employee.principalLink."))) {
      assert.deepEqual(Object.keys(item.after ?? {}), item.after === null ? [] : ["userAccess"]);
      assert.deepEqual(Object.keys(item.before ?? {}), item.before === null ? [] : ["userAccess"]);
    }
    assert.doesNotMatch(JSON.stringify(page), new RegExp(pJane.principalId), "the change history disclosed a Principal id");
  });

  // ════════════════════ Job Roles stay separate ════════════════════

  await t.test("JOB ROLES REMAIN SEPARATE: a created Employee has none, createEmployee cannot assign one, and assigning one uses the OTHER capability and disturbs nothing", async () => {
    await jobRoleSeed.seedJobRoleCatalog(pool, { tenantId: "t1", actor: "job-role-catalog-seed:test", apply: true });
    // The created Employee has NO Job Role, and there is no input that would have given it one.
    assert.equal((await q(`SELECT count(*)::int n FROM eos_workforce.employee_job_role_assignments WHERE employee_id = 'emp-jane'`)).rows[0].n, 0);
    await assert.rejects(creation.createEmployee(deps, adminActor, {
      employeeId: "emp-with-role", employmentStatus: "ACTIVE", operatingCompanyId: "taylor", jobRoleId: "retail-sales", reason: "a Job Role smuggled into a creation",
    }), (e) => e.code === "INPUT_FIELD_NOT_ACCEPTED" && /jobRoleId/.test(e.message));
    assert.equal(await employeeRow("emp-with-role"), undefined);

    // The EXISTING Job Role command, under its OWN capability, is what assigns one.
    const beforeLinks = await linkRows("emp-jane");
    const beforeProfile = await employeeRow("emp-jane");
    const assigned = await jobRoleCmd.assignEmployeeJobRole(deps, adminActor, { employeeId: "emp-jane", jobRoleId: "service-technician", reason: "business function, per the Owner-ruled catalog" });
    assert.equal(assigned.outcome, "ASSIGNED");
    // It requires admin.employeeJobRole.write and NOT admin.employeeProfile.write: the directly granted
    // Principal holds the profile capability only, and is refused.
    await assert.rejects(jobRoleCmd.assignEmployeeJobRole(deps, directActor, { employeeId: "emp-direct", jobRoleId: "retail-sales" }),
      (e) => e.code === "CAPABILITY_REQUIRED" && /admin\.employeeJobRole\.write/.test(e.message));
    // And the Job Role assignment moved neither the link nor the profile.
    assert.deepEqual(await linkRows("emp-jane"), beforeLinks);
    assert.deepEqual(await employeeRow("emp-jane"), beforeProfile);
  });

  // ════════════════════ the transport, and the operator wrapper ════════════════════

  await t.test("transport: the four commands are served for a verified caller, an authority field in the body refuses, and no Firebase module loads", async () => {
    const world = { reader: repo, pool, allowedOrigins: [], verifyToken: async () => ({ externalSubject: admin.subject, identityProvider: "firebase" }) };
    const call = async (operation, input) => {
      const res = await http.handleWorkforceRequest(world, { method: "POST", url: "/workforce/employees", headers: { authorization: "Bearer t" }, body: JSON.stringify({ operation, input }) });
      return { status: res.status, body: JSON.parse(res.body) };
    };
    const created = await call("createEmployee", { employeeId: "emp-http", employmentStatus: "ACTIVE", operatingCompanyId: "taylor", reason: "created over the governed transport" });
    assert.deepEqual([created.status, created.body.result.outcome], [200, "CREATED"]);
    const linked = await call("linkEmployeePrincipal", { employeeId: "emp-http", linkedPrincipalId: pSpare.principalId, reason: "the login for the transport-created Employee" });
    assert.deepEqual([linked.status, linked.body.result.outcome], [200, "LINKED"]);
    const stale = await call("relinkEmployeePrincipal", { employeeId: "emp-http", expectedCurrentPrincipalId: pBob.principalId, newPrincipalId: pDisabled.principalId, reason: "a stale expected value over the transport" });
    assert.deepEqual([stale.status, stale.body.code], [409, "EMPLOYEE_PRINCIPAL_LINK_STALE"]);
    const revoked = await call("unlinkEmployeePrincipal", { employeeId: "emp-http", expectedCurrentPrincipalId: pSpare.principalId, reason: "revoked over the governed transport" });
    assert.deepEqual([revoked.status, revoked.body.result.outcome], [200, "REVOKED"]);
    // A body that STATES authority is refused before the token is verified -- including `principalId`,
    // which is why the link commands never call their target that.
    for (const field of ["capabilities", "heldRoleKeys", "principalId", "tenantId", "securityRole"]) {
      const res = await call("createEmployee", { employeeId: "emp-x", employmentStatus: "ACTIVE", operatingCompanyId: "taylor", reason: "authority stated in a body", [field]: "x" });
      assert.deepEqual([res.status, res.body.code], [400, "AUTHORITY_FIELD_NOT_ACCEPTED"], field);
    }
    assert.equal(await employeeRow("emp-x"), undefined);
    const probe = spawnSync(process.execPath, ["-e", `const M=require("module");const l=M._load;M._load=function(r,...a){if(/firebase/i.test(r)){process.exit(97)}return l.call(this,r,...a)};require("./lib/eosWorkforce/commands/employeeCreationCommand.js");require("./lib/eosWorkforce/commands/employeePrincipalLinkCommands.js");require("./lib/eosWorkforce/commands/employeeAdministrationAuthority.js");require("./lib/eosWorkforce/workforceHttp.js")`], { cwd: FUNCTIONS_DIR });
    assert.equal(probe.status, 0, "a Firebase module loaded with the Employee administration authority");
  });

  await t.test("the operator wrapper: a dry run writes NOTHING, --apply drives the SAME governed command, and it refuses a Principal the gate refuses", async () => {
    const deps2 = {
      resolveEmployeeAdministrationActor: actorAuthority.resolveEmployeeAdministrationActor,
      commands: {
        createEmployee: creation.createEmployee,
        updateEmployeeProfile: profileCmd.updateEmployeeProfile,
        linkEmployeePrincipal: linkCmd.linkEmployeePrincipal,
        unlinkEmployeePrincipal: linkCmd.unlinkEmployeePrincipal,
        relinkEmployeePrincipal: linkCmd.relinkEmployeePrincipal,
      },
    };
    const run = (patch) => cli.administerEmployeeRun(pool, {
      environmentId: "platform-sandbox", tenantKey: "t1", performedBy: "operator", adminPrincipalId: admin.principalId,
      command: "createEmployee",
      input: { employeeId: "emp-cli", employmentStatus: "ACTIVE", operatingCompanyId: "taylor", reason: "created through the operator wrapper" },
      apply: false, ...patch,
    }, deps2);

    const planned = await run({});
    assert.deepEqual([planned.outcome, planned.result, planned.apply, planned.adminRoleKeys], ["PLANNED", null, false, ["admin"]]);
    assert.equal(await employeeRow("emp-cli"), undefined, "a dry run wrote a row");
    assert.equal((await auditsFor("emp-cli")).length, 0, "a dry run wrote an audit event");

    const applied = await run({ apply: true });
    assert.equal(applied.outcome, "CREATED");
    assert.equal((await employeeRow("emp-cli")).tenant_id, "t1");
    assert.equal((await auditsFor("emp-cli")).length, 1);
    // The wrapper adds no authority of its own: the unauthorized Principal is refused through the
    // command's gate, and the tenant is resolved by key rather than created.
    await assert.rejects(run({ adminPrincipalId: gm.principalId, apply: true, input: { employeeId: "emp-cli-2", employmentStatus: "ACTIVE", operatingCompanyId: "taylor", reason: "the wrapper must not widen authority" } }),
      (e) => e.code === "CAPABILITY_REQUIRED");
    assert.equal(await employeeRow("emp-cli-2"), undefined);
    await assert.rejects(run({ tenantKey: "no-such-tenant" }), (e) => e.code === "TENANT_NOT_FOUND");
    // The DIRECTLY granted Principal administers through the wrapper too.
    const viaDirect = await run({ adminPrincipalId: directGrantee.principalId, apply: true, input: { employeeId: "emp-cli-direct", employmentStatus: "ACTIVE", operatingCompanyId: "taylor", reason: "created by a directly granted Principal" } });
    assert.deepEqual([viaDirect.outcome, viaDirect.adminRoleKeys, viaDirect.adminDirectCapabilityKeys], ["CREATED", ["generalManager"], ["admin.employeeProfile.write"]]);
  });
});
