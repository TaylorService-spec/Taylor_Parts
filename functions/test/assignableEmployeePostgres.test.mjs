// Step G: the governed assignable-Employee read, against a real postgres:16.
//
// It replaces a legacy Firestore query that fused three questions into one predicate. The point of this suite is
// that the three are now INDEPENDENTLY LOAD-BEARING: removing any one of them removes the Employee from the answer,
// and none of them is ever derived from another.
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
const reads = require("../lib/eosWorkforce/reads/assignableEmployeeReads.js");
const eligibility = require("../lib/eosWorkforce/commands/employeeWorkEligibilityCommands.js");
const scopes = require("../lib/eosWorkforce/commands/employeeOperationalScopeCommands.js");
const jobRoles = require("../lib/eosWorkforce/commands/employeeJobRoleCommands.js");
const http = require("../lib/eosWorkforce/workforceHttp.js");
const grants = require("../lib/eosWorkforce/migration/employeeCapabilityGrants.js");
const { resolveOperationalContext } = require("../lib/eosOps/capabilityAuthority.js");
const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");

const dbUrlFor = (name) => { const u = new URL(URL_BASE); u.pathname = `/${name}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

test("assignable Employees: qualification, lifecycle and account, each independently load-bearing", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `assignable_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
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
    roleIds[tenantId] = (await repo.transact(fixture(tenantId), (tx) => tx.createRole({ key: "admin", name: "admin", description: null, origin: "CUSTOM", protected: false }))).id;
    await grants.reconcileEmployeeCapabilityGrants(pool, { tenantId, apply: true, actor: "grants:test" });
  }
  const makeActor = async (tenantId, subject) => {
    const principalId = await repo.transact(fixture(tenantId), async (tx) => {
      const p = await tx.createPrincipal({ externalSubject: subject, identityProvider: "firebase" });
      await tx.createTenantMembership(p.id);
      return p.id;
    });
    await repo.transact(fixture(tenantId), async (tx) => {
      const v = await tx.bumpAccessVersion(principalId);
      return tx.createAssignment({ principalId, roleId: roleIds[tenantId], scopeType: "global", scopeValue: null, status: "active", grantedBy: "f", grantedAt: new Date().toISOString(), accessVersionAtGrant: v });
    });
    const ctx = await resolveOperationalContext(repo, pool, { identityProvider: "firebase", externalSubject: subject, requestedTenantId: null });
    return { tenantId: ctx.principalContext.tenantId, principalId: ctx.principalContext.uid, capabilities: ctx.capabilities };
  };
  const employee = (id, tenant = "t1", status = "ACTIVE") => q(
    `INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id, updated_at, display_name)
     VALUES ($1, $2, $3, 'taylor', '2020-01-01T00:00:00Z', $1)`, [id, tenant, status]);
  const warehouse = (id, tenant = "t1") => q(
    `INSERT INTO eos_ops.warehouses (id, tenant_id, operating_company_key, name, site_label, status, provenance, created_by, updated_by)
     VALUES ($1, $2, 'taylor', $1, 'AZ', 'ACTIVE', 'NATIVE', 'f', 'f')`, [id, tenant]);
  // The link's foreign key requires a REAL tenant-member Principal: a login you could actually assign work to.
  let linkN = 0;
  const link = async (employeeId, tenant = "t1") => {
    const n = ++linkN;
    const principalId = await repo.transact(fixture(tenant), async (tx) => {
      const pr = await tx.createPrincipal({ externalSubject: `uid-linked-${n}`, identityProvider: "firebase" });
      await tx.createTenantMembership(pr.id);
      return pr.id;
    });
    return q(
      `INSERT INTO eos_policy.employee_principal_links (id, tenant_id, principal_id, employee_id, operating_company_id, link_source, asserted_by, assertion_reason)
       VALUES ($1, $2, $3, $4, 'taylor', 'OPERATOR_ASSERTED', 'fixture', 'test')`,
      [`epl-${n}`, tenant, principalId, employeeId]);
  };

  const admin = await makeActor("t1", "uid-admin");
  const t2Admin = await makeActor("t2", "uid-t2-admin");
  const deps = { pool };
  const ids = async (input) => (await reads.listAssignableEmployees(deps, admin, input)).items.map((i) => i.employeeId).sort();

  await warehouse("wh-main");
  await warehouse("wh-north");
  await warehouse("wh-t2", "t2");

  // The full candidate: ACTIVE, qualified, linked, scoped to wh-main.
  await employee("e-full");           await link("e-full");
  // Each of the following is missing EXACTLY ONE predicate.
  await employee("e-unqualified");    await link("e-unqualified");
  await employee("e-unlinked");
  await employee("e-onleave", "t1", "ON_LEAVE"); await link("e-onleave");
  await employee("e-noscope");        await link("e-noscope");
  // Another tenant's Employee, qualified and linked there.
  await employee("e-t2", "t2");       await link("e-t2", "t2");

  for (const id of ["e-full", "e-onleave", "e-noscope"]) {
    await eligibility.assignEmployeeWorkEligibility(deps, admin, { employeeId: id, qualificationCode: "WAREHOUSE_OPERATIONS" });
  }
  await eligibility.assignEmployeeWorkEligibility(deps, admin, { employeeId: "e-unlinked", qualificationCode: "WAREHOUSE_OPERATIONS" });
  await eligibility.assignEmployeeWorkEligibility(deps, t2Admin, { employeeId: "e-t2", qualificationCode: "WAREHOUSE_OPERATIONS" });
  await scopes.assignEmployeeOperationalScope(deps, admin, { employeeId: "e-full", scopeType: "WAREHOUSE", scopeId: "wh-main" });

  await t.test("QUALIFICATION is load-bearing: no current qualification, not assignable", async () => {
    assert.deepEqual(await ids({ qualificationCode: "WAREHOUSE_OPERATIONS" }), ["e-full", "e-noscope"]);
    // e-unqualified has lifecycle and account but no qualification.
    assert.ok(!(await ids({ qualificationCode: "WAREHOUSE_OPERATIONS" })).includes("e-unqualified"));
    // ENDING the qualification removes the Employee: an ended qualification is not a qualification.
    await eligibility.endEmployeeWorkEligibility(deps, admin, { employeeId: "e-noscope", qualificationCode: "WAREHOUSE_OPERATIONS" });
    assert.deepEqual(await ids({ qualificationCode: "WAREHOUSE_OPERATIONS" }), ["e-full"]);
    await eligibility.assignEmployeeWorkEligibility(deps, admin, { employeeId: "e-noscope", qualificationCode: "WAREHOUSE_OPERATIONS" });
    // A DIFFERENT qualification is a different question, and nobody holds it.
    assert.deepEqual(await ids({ qualificationCode: "SERVICE_TECHNICIAN" }), []);
  });

  await t.test("LIFECYCLE is load-bearing, and the policy is ACTIVE alone -- exactly the legacy rule", async () => {
    assert.deepEqual([...reads.ASSIGNABLE_EMPLOYMENT_STATUSES], ["ACTIVE"]);
    // e-onleave is qualified and linked; only its lifecycle differs.
    assert.ok(!(await ids({ qualificationCode: "WAREHOUSE_OPERATIONS" })).includes("e-onleave"));
    for (const status of ["ON_LEAVE", "INACTIVE", "TERMINATED", "RETIRED", "CONTRACTOR"]) {
      await q(`UPDATE eos_workforce.employees SET employment_status = $1::eos_workforce.workforce_employment_status WHERE id = 'e-onleave'`, [status]);
      assert.ok(!(await ids({ qualificationCode: "WAREHOUSE_OPERATIONS" })).includes("e-onleave"), `${status} became assignable`);
    }
    await q(`UPDATE eos_workforce.employees SET employment_status = 'ACTIVE' WHERE id = 'e-onleave'`);
    assert.ok((await ids({ qualificationCode: "WAREHOUSE_OPERATIONS" })).includes("e-onleave"));
    await q(`UPDATE eos_workforce.employees SET employment_status = 'ON_LEAVE' WHERE id = 'e-onleave'`);
  });

  await t.test("ACCOUNT is load-bearing, and requireLinkedPrincipal defaults to true as the legacy query did", async () => {
    assert.ok(!(await ids({ qualificationCode: "WAREHOUSE_OPERATIONS" })).includes("e-unlinked"));
    assert.ok((await ids({ qualificationCode: "WAREHOUSE_OPERATIONS", requireLinkedPrincipal: false })).includes("e-unlinked"));
  });

  await t.test("SCOPE is load-bearing ONLY when the workflow names a warehouse, and is never inferred", async () => {
    // With no warehouse named, qualification alone answers -- e-noscope appears despite covering no warehouse.
    assert.deepEqual(await ids({ qualificationCode: "WAREHOUSE_OPERATIONS" }), ["e-full", "e-noscope"]);
    // Naming a warehouse adds the third predicate.
    assert.deepEqual(await ids({ qualificationCode: "WAREHOUSE_OPERATIONS", warehouseId: "wh-main" }), ["e-full"]);
    // A DIFFERENT warehouse refuses everybody: scope is per target, never "any warehouse".
    assert.deepEqual(await ids({ qualificationCode: "WAREHOUSE_OPERATIONS", warehouseId: "wh-north" }), []);
    // ANOTHER TENANT'S warehouse resolves to nobody, never to that tenant's Employees.
    assert.deepEqual(await ids({ qualificationCode: "WAREHOUSE_OPERATIONS", warehouseId: "wh-t2" }), []);
    // Scope ALONE grants nothing: an Employee scoped to wh-main without the qualification is still not assignable.
    await scopes.assignEmployeeOperationalScope(deps, admin, { employeeId: "e-unqualified", scopeType: "WAREHOUSE", scopeId: "wh-main" });
    assert.deepEqual(await ids({ qualificationCode: "WAREHOUSE_OPERATIONS", warehouseId: "wh-main" }), ["e-full"]);
  });

  await t.test("JOB ROLE alone makes nobody assignable, and the read never consults it", async () => {
    await jobRoles.createJobRole(deps, admin, { jobRoleId: "parts-warehouse", displayName: "Parts / Warehouse" });
    await jobRoles.assignEmployeeJobRole(deps, admin, { employeeId: "e-unqualified", jobRoleId: "parts-warehouse" });
    assert.ok(!(await ids({ qualificationCode: "WAREHOUSE_OPERATIONS" })).includes("e-unqualified"),
      "a Job Role conferred assignability");
    const src = require("node:fs").readFileSync(`${FUNCTIONS_DIR}/src/eosWorkforce/reads/assignableEmployeeReads.ts`, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(src, /job_roles|jobRole/, "the read consults Job Role");
    assert.doesNotMatch(src, /operationalRoles|PARTS_ASSOCIATE/, "the read consults the legacy authority");
  });

  await t.test("TENANCY: another tenant's qualified Employee is never returned, in either direction", async () => {
    assert.ok(!(await ids({ qualificationCode: "WAREHOUSE_OPERATIONS" })).includes("e-t2"));
    const fromT2 = (await reads.listAssignableEmployees(deps, t2Admin, { qualificationCode: "WAREHOUSE_OPERATIONS" })).items.map((i) => i.employeeId);
    assert.deepEqual(fromT2, ["e-t2"]);
  });

  await t.test("CAPABILITY and INPUT: the read requires employee.record.read and refuses unknown or authority input", async () => {
    const noCap = { ...admin, capabilities: new Set() };
    await assert.rejects(reads.listAssignableEmployees(deps, noCap, { qualificationCode: "WAREHOUSE_OPERATIONS" }),
      (e) => e.code === "CAPABILITY_REQUIRED");
    for (const code of ["PARTS_ASSOCIATE", "TECHNICIAN", "", null, undefined]) {
      await assert.rejects(reads.listAssignableEmployees(deps, admin, { qualificationCode: code }),
        (e) => e.code === "WORK_ELIGIBILITY_CODE_INVALID", `qualificationCode ${JSON.stringify(code)} accepted`);
    }
    for (const extra of ["tenantId", "principalId", "capabilities", "operationalRoles", "jobRoleId"]) {
      await assert.rejects(reads.listAssignableEmployees(deps, admin, { qualificationCode: "WAREHOUSE_OPERATIONS", [extra]: "x" }),
        (e) => e.code === "INPUT_FIELD_NOT_ACCEPTED", `accepted ${extra}`);
    }
    await assert.rejects(reads.listAssignableEmployees(deps, admin, { qualificationCode: "WAREHOUSE_OPERATIONS", warehouseId: "a/b" }),
      (e) => e.code === "WAREHOUSE_ID_INVALID");
  });

  await t.test("the transport serves it as a read, and it is bounded and deterministic", async () => {
    assert.ok(http.WORKFORCE_READ_OPERATIONS.includes("listAssignableEmployees"));
    assert.ok(!http.WORKFORCE_COMMAND_OPERATIONS.includes("listAssignableEmployees"), "a read was registered as a command");
    const page = await reads.listAssignableEmployees(deps, admin, { qualificationCode: "WAREHOUSE_OPERATIONS", limit: 1 });
    assert.equal(page.items.length, 1);
    assert.ok(page.truncated && page.nextCursor, "a bounded page must offer a cursor");
    const next = await reads.listAssignableEmployees(deps, admin, { qualificationCode: "WAREHOUSE_OPERATIONS", limit: 1, cursor: page.nextCursor });
    assert.notDeepEqual(next.items.map((i) => i.employeeId), page.items.map((i) => i.employeeId));
    assert.equal(page.scopedToWarehouseId, null);
  });
});
