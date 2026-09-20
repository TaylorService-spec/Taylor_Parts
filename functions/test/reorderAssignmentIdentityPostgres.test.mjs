// REORDER ASSIGNMENT IDENTITY: the governed Employee assignment, against a real postgres:16.
//
// The seam this closes is an IDENTITY one, so most of this suite is about identities that must NOT work: a Firebase
// uid, a Principal id and an external subject are each refused where an Employee id is required, and none of them
// can satisfy the own-assignment predicate by resembling one.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import pg from "pg";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const authority = require("../lib/eosOps/reorderAssignmentAuthority.js");
const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");

const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

test("Reorder assignment names an EMPLOYEE, never a Principal and never a Firebase uid", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `reorder_assign_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
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

  // THE REORDER OBJECT NOW LIVES HERE. When this suite was written the Reorder was a Firestore
  // document and `reorder_request_id` could only be opaque; the domain cutover moved the object, so
  // assignment targets a real governed row and refuses one this tenant does not have.
  await q(`INSERT INTO eos_ops.warehouses (id, tenant_id, operating_company_key, name, site_label, status, provenance, created_by, updated_by)
           VALUES ('wh-1', 't1', 'sample-co', 'WH', 'Sampleton', 'ACTIVE', 'NATIVE', 'fixture', 'fixture'),
                  ('wh-2', 't2', 'sample-co', 'WH', 'Sampleton', 'ACTIVE', 'NATIVE', 'fixture', 'fixture')`);
  const reorder = (id, tenant = "t1", status = "READY_FOR_PARTS_MANAGER") => q(
    `INSERT INTO eos_ops.reorder_requests
       (id, tenant_id, operating_company_key, part_id, warehouse_id, status, requested_quantity,
        requested_by, updated_by, provenance, recommendation_status, quantity_source)
     VALUES ($1, $2, 'sample-co', 'PART-1', $3, $4, 1, 'fixture', 'fixture', 'NATIVE', 'BELOW_MIN', 'MANUAL')`,
    [id, tenant, tenant === "t1" ? "wh-1" : "wh-2", status]);
  for (const id of ["rr-1", "rr-legacy", "rr-native", "rr-q", "rr-q2", "rr-x"]) await reorder(id);
  await reorder("rr-foreign", "t2");

  const fixture = (tenantId) => ({ tenantId, uid: "uid-fixture" });
  const principal = async (tenantId, subject) => repo.transact(fixture(tenantId), async (tx) => {
    const p = await tx.createPrincipal({ externalSubject: subject, identityProvider: "firebase" });
    await tx.createTenantMembership(p.id);
    return p.id;
  });
  const employee = (id, tenant = "t1", status = "ACTIVE") => q(
    `INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id, updated_at)
     VALUES ($1, $2, $3, 'taylor', '2020-01-01T00:00:00Z')`, [id, tenant, status]);
  let n = 0;
  const link = async (employeeId, principalId, tenant = "t1") => q(
    `INSERT INTO eos_policy.employee_principal_links (id, tenant_id, principal_id, employee_id, operating_company_id, link_source, asserted_by, assertion_reason)
     VALUES ($1, $2, $3, $4, 'taylor', 'OPERATOR_ASSERTED', 'fixture', 'test')`,
    [`epl-${++n}`, tenant, principalId, employeeId]);

  const actorPrincipal = await principal("t1", "uid-manager");
  const assigneePrincipal = await principal("t1", "uid-assignee");
  const otherPrincipal = await principal("t1", "uid-other");
  const t2Principal = await principal("t2", "uid-t2");
  await employee("e-assignee");  await link("e-assignee", assigneePrincipal);
  await employee("e-other");     await link("e-other", otherPrincipal);
  await employee("e-unlinked");
  await employee("e-onleave", "t1", "ON_LEAVE"); await link("e-onleave", actorPrincipal);
  await employee("e-t2", "t2");  await link("e-t2", t2Principal, "t2");

  // Every Employee the existing proofs assign must now hold the qualification the OPERATION requires.
  const qualify = (employeeId, tenant = "t1") => q(
    `INSERT INTO eos_workforce.employee_work_eligibility (id, tenant_id, employee_id, qualification_code, effective_from, assigned_by)
     VALUES ($1, $2, $3, 'WAREHOUSE_OPERATIONS', now(), 'fixture')`, [`ewe-${employeeId}`, tenant, employeeId]);
  for (const id of ["e-assignee", "e-other", "e-unlinked", "e-onleave"]) await qualify(id);
  await qualify("e-t2", "t2");

  const jobRoleFor = async (employeeId) => {
    await q(`INSERT INTO eos_workforce.job_roles (tenant_id, id, display_name, status, created_by, updated_by)
             VALUES ('t1', 'parts-warehouse', 'Parts / Warehouse', 'ACTIVE', 'f', 'f') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO eos_workforce.employee_job_role_assignments (id, tenant_id, employee_id, job_role_id, effective_from, assigned_by)
             VALUES ($1, 't1', $2, 'parts-warehouse', now(), 'fixture')`, [`ejr-${employeeId}`, employeeId]);
  };

  const actor = { tenantId: "t1", principalId: actorPrincipal, capabilities: new Set([authority.REORDER_REQUEST_ASSIGN]) };
  const deps = { pool };
  const RR = "rr-1";

  await t.test("(3)(4) the assignment records the EMPLOYEE, and the Principal only as the actor", async () => {
    const result = await authority.assignReorderRequestToEmployee(deps, actor, { reorderRequestId: RR, employeeId: "e-assignee", reason: "queue triage" });
    assert.deepEqual([result.outcome, result.assignedEmployeeId], ["ASSIGNED", "e-assignee"]);
    const row = (await q(`SELECT * FROM eos_ops.reorder_request_assignments WHERE reorder_request_id = $1`, [RR])).rows[0];
    assert.equal(row.assigned_employee_id, "e-assignee", "the assignee must be the Employee");
    assert.equal(row.assigned_by_principal_id, actorPrincipal, "the actor is recorded independently");
    assert.notEqual(row.assigned_employee_id, assigneePrincipal, "a Principal id must never be the assignee");
    // The audit names the EOS Principal as actor and the request as target.
    const audit = (await q(`SELECT action, actor_uid, after FROM eos_policy.audit_events WHERE target_id = $1`, [RR])).rows[0];
    assert.deepEqual([audit.action, audit.actor_uid, audit.after.assignedEmployeeId], ["reorderRequest.assign", actorPrincipal, "e-assignee"]);
    assert.equal((await authority.readAssignedEmployee(pool, "t1", RR)).assignedEmployeeId, "e-assignee");
  });

  await t.test("(1)(2)(13) a uid, an external subject or a Principal id offered as the assignee is refused", async () => {
    for (const bad of [assigneePrincipal, "uid-assignee", "firebase-uid-assignee"]) {
      await assert.rejects(
        authority.assignReorderRequestToEmployee(deps, actor, { reorderRequestId: "rr-x", employeeId: bad }),
        (e) => e.code === "EMPLOYEE_NOT_FOUND", `${bad} was accepted as an Employee`);
    }
    // (13) No authority-bearing or legacy field is accepted at all -- refused, not ignored.
    for (const field of ["tenantId", "principalId", "capabilities", "assignedToUserId", "uid", "securityRole",
      "operationalRoles", "jobRoleId", "currentAssignee", "authorized"]) {
      await assert.rejects(
        authority.assignReorderRequestToEmployee(deps, actor, { reorderRequestId: "rr-x", employeeId: "e-assignee", [field]: "x" }),
        (e) => e.code === "INPUT_FIELD_NOT_ACCEPTED", `${field} was accepted`);
    }
  });

  await t.test("(5)(6)(7) the Employee must exist in the ACTOR's tenant", async () => {
    await assert.rejects(authority.assignReorderRequestToEmployee(deps, actor, { reorderRequestId: "rr-x", employeeId: "e-t2" }),
      (e) => e.code === "EMPLOYEE_NOT_FOUND", "a foreign-tenant Employee was assignable");
    await assert.rejects(authority.assignReorderRequestToEmployee(deps, actor, { reorderRequestId: "rr-x", employeeId: "e-nope" }),
      (e) => e.code === "EMPLOYEE_NOT_FOUND");
    assert.equal((await q(`SELECT count(*)::int n FROM eos_ops.reorder_request_assignments WHERE reorder_request_id = 'rr-x'`)).rows[0].n, 0);
  });

  await t.test("(8) the governed assignability policy is applied at assignment time", async () => {
    // Non-ACTIVE employment, and an Employee with no active governed login, are both refused.
    await assert.rejects(authority.assignReorderRequestToEmployee(deps, actor, { reorderRequestId: "rr-x", employeeId: "e-onleave" }),
      (e) => e.code === "EMPLOYEE_NOT_ASSIGNABLE");
    await assert.rejects(authority.assignReorderRequestToEmployee(deps, actor, { reorderRequestId: "rr-x", employeeId: "e-unlinked" }),
      (e) => e.code === "EMPLOYEE_NOT_ASSIGNABLE");
    // A REVOKED link is not a login either.
    await q(`UPDATE eos_policy.employee_principal_links SET status = 'revoked' WHERE employee_id = 'e-other'`);
    await assert.rejects(authority.assignReorderRequestToEmployee(deps, actor, { reorderRequestId: "rr-x", employeeId: "e-other" }),
      (e) => e.code === "EMPLOYEE_NOT_ASSIGNABLE");
    await q(`UPDATE eos_policy.employee_principal_links SET status = 'active' WHERE employee_id = 'e-other'`);
  });

  await t.test("(9) the capability is required, and being the assignee supplies none", async () => {
    const noCap = { ...actor, capabilities: new Set() };
    await assert.rejects(authority.assignReorderRequestToEmployee(deps, noCap, { reorderRequestId: "rr-x", employeeId: "e-assignee" }),
      (e) => e.code === "CAPABILITY_REQUIRED" && e.category === "FORBIDDEN");
    // The assignee themself, holding no capability, cannot reassign their own work.
    const assigneeActor = { tenantId: "t1", principalId: assigneePrincipal, capabilities: new Set() };
    await assert.rejects(authority.assignReorderRequestToEmployee(deps, assigneeActor, { reorderRequestId: RR, employeeId: "e-other" }),
      (e) => e.code === "CAPABILITY_REQUIRED");
  });

  await t.test("(10)(11)(12)(14) own-assignment compares EMPLOYEE to EMPLOYEE, resolved server-side", async () => {
    // (10)(11) The assigned Employee's Principal matches; a different Employee's Principal does not.
    assert.equal(await authority.isCallerTheAssignedEmployee(pool, "t1", assigneePrincipal, RR), true);
    assert.equal(await authority.isCallerTheAssignedEmployee(pool, "t1", otherPrincipal, RR), false);
    // (12) A Principal with no active Employee link refuses rather than matching.
    const unlinkedPrincipal = await principal("t1", "uid-unlinked");
    assert.equal(await authority.isCallerTheAssignedEmployee(pool, "t1", unlinkedPrincipal, RR), false);
    await q(`UPDATE eos_policy.employee_principal_links SET status = 'revoked' WHERE employee_id = 'e-assignee'`);
    assert.equal(await authority.isCallerTheAssignedEmployee(pool, "t1", assigneePrincipal, RR), false, "a revoked link still matched");
    await q(`UPDATE eos_policy.employee_principal_links SET status = 'active' WHERE employee_id = 'e-assignee'`);
    // (14) A Firebase uid, an external subject and the Employee id itself cannot satisfy the predicate by
    // resembling a Principal id -- the chain is Principal -> link -> Employee, and nothing else enters it.
    for (const impostor of ["uid-assignee", "firebase-uid-assignee", "e-assignee"]) {
      assert.equal(await authority.isCallerTheAssignedEmployee(pool, "t1", impostor, RR), false, `${impostor} satisfied the predicate`);
    }
    // Tenant isolation: the same Principal asking in another tenant gets nothing.
    assert.equal(await authority.isCallerTheAssignedEmployee(pool, "t2", assigneePrincipal, RR), false);
  });

  await t.test("reassignment ends the prior assignment; the same Employee is NO_CHANGE; history is kept", async () => {
    const again = await authority.assignReorderRequestToEmployee(deps, actor, { reorderRequestId: RR, employeeId: "e-assignee" });
    assert.equal(again.outcome, "NO_CHANGE");
    const moved = await authority.assignReorderRequestToEmployee(deps, actor, { reorderRequestId: RR, employeeId: "e-other" });
    assert.equal(moved.outcome, "REASSIGNED");
    const rows = (await q(`SELECT assigned_employee_id, effective_to IS NULL AS current FROM eos_ops.reorder_request_assignments
                            WHERE reorder_request_id = $1 ORDER BY effective_from, id`, [RR])).rows;
    assert.deepEqual(rows.map((r) => [r.assigned_employee_id, r.current]), [["e-assignee", false], ["e-other", true]]);
    // The predicate follows the CURRENT assignment, not the historical one.
    assert.equal(await authority.isCallerTheAssignedEmployee(pool, "t1", assigneePrincipal, RR), false);
    assert.equal(await authority.isCallerTheAssignedEmployee(pool, "t1", otherPrincipal, RR), true);
    // History is immutable and undeletable.
    await assert.rejects(q(`DELETE FROM eos_ops.reorder_request_assignments WHERE reorder_request_id = $1`, [RR]), /keeps history/);
  });

  await t.test("(15) an audit failure rolls the assignment back atomically", async () => {
    const before = (await q(`SELECT id, assigned_employee_id, effective_to FROM eos_ops.reorder_request_assignments ORDER BY id`)).rows;
    await q(`CREATE FUNCTION test_refuse_assign_audit() RETURNS trigger AS $$ BEGIN
               IF NEW.action = 'reorderRequest.assign' THEN RAISE EXCEPTION 'injected'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
    await q(`CREATE TRIGGER test_refuse_assign_audit BEFORE INSERT ON eos_policy.audit_events FOR EACH ROW EXECUTE FUNCTION test_refuse_assign_audit()`);
    try {
      await assert.rejects(authority.assignReorderRequestToEmployee(deps, actor, { reorderRequestId: RR, employeeId: "e-assignee" }),
        (e) => e.code === "COMMAND_FAILED" && !/injected/.test(e.message));
    } finally {
      await q(`DROP TRIGGER test_refuse_assign_audit ON eos_policy.audit_events`);
      await q(`DROP FUNCTION test_refuse_assign_audit()`);
    }
    assert.deepEqual((await q(`SELECT id, assigned_employee_id, effective_to FROM eos_ops.reorder_request_assignments ORDER BY id`)).rows, before,
      "a failed assignment left a row behind, or ended the prior one");
  });


  await t.test("QUALIFICATION is enforced by the COMMAND, not only by the picker", async () => {
    // The defect this proves closed: a caller holding reorder.request.assign could bypass the picker entirely and
    // submit any ACTIVE, linked Employee. The command now consumes the SAME authority the read does.
    await employee("e-unqualified");
    const unqualifiedPrincipal = await principal("t1", "uid-unqualified");
    await link("e-unqualified", unqualifiedPrincipal);
    // ACTIVE + active governed link + NO WAREHOUSE_OPERATIONS -> refused, invoking the command directly.
    await assert.rejects(
      authority.assignReorderRequestToEmployee(deps, actor, { reorderRequestId: "rr-q", employeeId: "e-unqualified" }),
      (e) => e.code === "EMPLOYEE_NOT_ASSIGNABLE" && /WAREHOUSE_OPERATIONS/.test(e.message));
    assert.equal((await q(`SELECT count(*)::int n FROM eos_ops.reorder_request_assignments WHERE reorder_request_id = 'rr-q'`)).rows[0].n, 0);

    // Job Role alone does not qualify.
    await jobRoleFor("e-unqualified");
    await assert.rejects(
      authority.assignReorderRequestToEmployee(deps, actor, { reorderRequestId: "rr-q", employeeId: "e-unqualified" }),
      (e) => e.code === "EMPLOYEE_NOT_ASSIGNABLE", "a Job Role conferred qualification");
    // Nor does a Security Role: the assignee's own Principal holds one, and it creates no qualification.
    await q(`INSERT INTO eos_policy.roles (id, tenant_id, key, name, origin, protected, created_by, updated_by)
             VALUES ('role-wh', 't1', 'warehouseManager', 'warehouseManager', 'CUSTOM', false, 'f', 'f')`);
    await assert.rejects(
      authority.assignReorderRequestToEmployee(deps, actor, { reorderRequestId: "rr-q", employeeId: "e-unqualified" }),
      (e) => e.code === "EMPLOYEE_NOT_ASSIGNABLE");

    // Granting the qualification -- and nothing else -- makes the SAME Employee assignable.
    await qualify("e-unqualified");
    assert.equal((await authority.assignReorderRequestToEmployee(deps, actor, { reorderRequestId: "rr-q", employeeId: "e-unqualified" })).outcome, "ASSIGNED");
    // ENDING it makes them unassignable again: the predicate is current, not historical.
    await q(`UPDATE eos_workforce.employee_work_eligibility SET effective_to = now(), ended_by = 'f', ended_at = now()
              WHERE employee_id = 'e-unqualified' AND effective_to IS NULL`);
    await assert.rejects(
      authority.assignReorderRequestToEmployee(deps, actor, { reorderRequestId: "rr-q2", employeeId: "e-unqualified" }),
      (e) => e.code === "EMPLOYEE_NOT_ASSIGNABLE");
    // The qualification is NOT a caller input: it cannot be chosen, renamed or turned off.
    for (const field of ["qualificationCode", "qualification", "skipQualification", "warehouseId"]) {
      await assert.rejects(
        authority.assignReorderRequestToEmployee(deps, actor, { reorderRequestId: "rr-q", employeeId: "e-assignee", [field]: "x" }),
        (e) => e.code === "INPUT_FIELD_NOT_ACCEPTED", `${field} was accepted`);
    }
  });

  await t.test("PROVENANCE: a native row must name its actor; only a MIGRATED row may record an unknown one", async () => {
    // A live command always writes NATIVE with the calling Principal.
    const row = (await q(`SELECT provenance, assigned_by_principal_id FROM eos_ops.reorder_request_assignments
                           WHERE reorder_request_id = $1 AND effective_to IS NULL`, [RR])).rows[0];
    assert.deepEqual([row.provenance, row.assigned_by_principal_id], ["NATIVE", actorPrincipal]);

    // A NATIVE row with no actor is refused by the database, not merely by the command.
    await assert.rejects(q(
      `INSERT INTO eos_ops.reorder_request_assignments (id, tenant_id, reorder_request_id, assigned_employee_id, effective_from, provenance, assigned_by_principal_id)
       VALUES ('rra-bad', 't1', 'rr-native-null', 'e-assignee', now(), 'NATIVE', NULL)`), /native_actor_present/);

    // A MIGRATED row MAY record an unknown historical assignor -- truthfully, as NULL.
    await q(`INSERT INTO eos_ops.reorder_request_assignments (id, tenant_id, reorder_request_id, assigned_employee_id, effective_from, provenance, assigned_by_principal_id)
             VALUES ('rra-legacy', 't1', 'rr-legacy', 'e-assignee', now(), 'MIGRATED', NULL)`);
    const legacy = (await q(`SELECT provenance, assigned_by_principal_id FROM eos_ops.reorder_request_assignments WHERE id = 'rra-legacy'`)).rows[0];
    assert.deepEqual([legacy.provenance, legacy.assigned_by_principal_id], ["MIGRATED", null]);
    // The business assignee is still exact -- an unknown historical actor never makes the CURRENT assignee unknown.
    assert.equal((await authority.readAssignedEmployee(pool, "t1", "rr-legacy")).assignedEmployeeId, "e-assignee");

    // A claimed actor must be a REAL same-tenant member: structural, not a shape check.
    await assert.rejects(q(
      `INSERT INTO eos_ops.reorder_request_assignments (id, tenant_id, reorder_request_id, assigned_employee_id, effective_from, provenance, assigned_by_principal_id)
       VALUES ('rra-fake', 't1', 'rr-fake', 'e-assignee', now(), 'MIGRATED', 'p-not-a-member')`), (e) => e.code === "23503");
    // A foreign-tenant Principal cannot be the actor either.
    await assert.rejects(q(
      `INSERT INTO eos_ops.reorder_request_assignments (id, tenant_id, reorder_request_id, assigned_employee_id, effective_from, provenance, assigned_by_principal_id)
       VALUES ('rra-foreign', 't1', 'rr-foreign', 'e-assignee', now(), 'MIGRATED', $1)`, [t2Principal]), (e) => e.code === "23503");

    // Provenance is immutable: a migrated row cannot later claim to be native, or the reverse.
    await assert.rejects(q(`UPDATE eos_ops.reorder_request_assignments SET provenance = 'NATIVE' WHERE id = 'rra-legacy'`), /keeps history/);
    // MIGRATION EXECUTION is a different question, recorded as an audit event by the copy tool -- never here.
    const cols = (await q(`SELECT column_name FROM information_schema.columns
                            WHERE table_schema = 'eos_ops' AND table_name = 'reorder_request_assignments'`)).rows.map((r) => r.column_name);
    assert.deepEqual(cols.filter((c) => /migration|executed|imported|run_id|batch/.test(c)), [],
      "migration-execution provenance must not live on the assignment row");
  });

  await t.test("(16)(17) no dual write, no fallback, and no uid may be stored", async () => {
    const src = readFileSync(join(FUNCTIONS_DIR, "src/eosOps/reorderAssignmentAuthority.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    // It performs no Firestore write and loads no Firebase module: there is no second writer to disagree with.
    assert.doesNotMatch(src, /require\(\s*["'][^"']*fire(base|store)[^"']*["']\s*\)|from\s+["'][^"']*fire(base|store)[^"']*["']/i);
    assert.doesNotMatch(src, /assignedToUserId|\.collection\(|firestore/i, "the command touches the legacy assignment field");
    // The schema itself cannot hold a uid.
    const cols = (await q(`SELECT column_name FROM information_schema.columns
                            WHERE table_schema = 'eos_ops' AND table_name = 'reorder_request_assignments'`)).rows.map((r) => r.column_name);
    assert.deepEqual(cols.filter((c) => /uid|external_subject|user_id/.test(c)), [], "a uid-shaped column exists");
    assert.ok(cols.includes("assigned_employee_id") && cols.includes("assigned_by_principal_id"));
    // The EXISTING capability is reused rather than a new one invented.
    assert.equal(authority.REORDER_REQUEST_ASSIGN, "reorder.request.assign");
    const catalog = readFileSync(join(FUNCTIONS_DIR, "src/access/permissionCatalog.ts"), "utf8");
    assert.ok(catalog.includes('id: "reorder.request.assign"'), "the capability must already exist in the catalog");
    assert.doesNotMatch(catalog, /reorder\.request\.assign\.employee/, "a second assign capability was invented");
  });
});
