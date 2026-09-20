// LEGACY REORDER ASSIGNMENT COPY ONCE / VERIFY, against a real postgres:16.
//
// The tooling's job is to REFUSE more often than it writes, so most of this suite is about what it will not copy
// and what it will not invent.
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
const copy = require("../lib/eosOps/migration/reorderAssignmentMigrationCopy.js");
const plan = require("../lib/eosOps/migration/reorderAssignmentMigration.js");
const authority = require("../lib/eosOps/reorderAssignmentAuthority.js");
const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");

const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

test("legacy Reorder assignment copy: exact Employee or refuse, truthful provenance, executor kept apart", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `rra_mig_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
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

  const fixture = (tenantId) => ({ tenantId, uid: "uid-fixture" });
  const principal = async (tenantId, subject) => repo.transact(fixture(tenantId), async (tx) => {
    const p = await tx.createPrincipal({ externalSubject: subject, identityProvider: "firebase" });
    await tx.createTenantMembership(p.id);
    return p.id;
  });
  const employee = (id, tenant = "t1") => q(
    `INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id, updated_at)
     VALUES ($1, $2, 'ACTIVE', 'taylor', '2020-01-01T00:00:00Z')`, [id, tenant]);
  let n = 0;
  const link = (employeeId, principalId, tenant = "t1", status = "active") => q(
    `INSERT INTO eos_policy.employee_principal_links (id, tenant_id, principal_id, employee_id, operating_company_id, link_source, asserted_by, assertion_reason, status)
     VALUES ($1, $2, $3, $4, 'taylor', 'OPERATOR_ASSERTED', 'f', 'test', $5)`,
    [`epl-${++n}`, tenant, principalId, employeeId, status]);

  const pAlice = await principal("t1", "uid-alice");
  const pBob = await principal("t1", "uid-bob");
  const pManager = await principal("t1", "uid-manager");
  const pNoLink = await principal("t1", "uid-nolink");
  const pT2 = await principal("t2", "uid-t2");
  const executor = await principal("t1", "uid-executor");
  await employee("e-alice"); await link("e-alice", pAlice);
  await employee("e-bob");   await link("e-bob", pBob);
  await employee("e-t2", "t2"); await link("e-t2", pT2, "t2");

  // The governed command requires the qualification, so any Employee this suite assigns THROUGH it must hold one.
  // The COPY path deliberately does not re-check qualification: it migrates an assignment that already exists.
  const qualify = (employeeId) => q(
    `INSERT INTO eos_workforce.employee_work_eligibility (id, tenant_id, employee_id, qualification_code, effective_from, assigned_by)
     VALUES ($1, 't1', $2, 'WAREHOUSE_OPERATIONS', now(), 'fixture')`, [`ewe-${employeeId}`, employeeId]);
  await qualify("e-alice");
  await qualify("e-bob");

  const src = (reorderRequestId, assignedToUserId, assignedBy = "uid-manager") => ({ reorderRequestId, assignedToUserId, assignedBy });

  // The governed assign command now targets a real Reorder row (the domain cutover moved the object
  // into eos_ops), so the one subtest that assigns THROUGH the command needs its Reorder to exist.
  // The COPY path deliberately still does not: it migrates assignments whose Reorder may not have
  // been copied yet, and inventing a Reorder to satisfy an assignment would invert the dependency.
  await q(`INSERT INTO eos_ops.warehouses (id, tenant_id, operating_company_key, name, site_label, status, provenance, created_by, updated_by)
           VALUES ('wh-1', 't1', 'sample-co', 'WH', 'Sampleton', 'ACTIVE', 'NATIVE', 'fixture', 'fixture')`);
  await q(`INSERT INTO eos_ops.reorder_requests
             (id, tenant_id, operating_company_key, part_id, warehouse_id, status, requested_quantity,
              requested_by, updated_by, provenance, recommendation_status, quantity_source)
           VALUES ('rr-race', 't1', 'sample-co', 'PART-1', 'wh-1', 'READY_FOR_PARTS_MANAGER', 1,
                   'fixture', 'fixture', 'NATIVE', 'BELOW_MIN', 'MANUAL')`);

  await t.test("DRY RUN classifies every source row and writes nothing", async () => {
    const before = (await q(`SELECT count(*)::int n FROM eos_ops.reorder_request_assignments`)).rows[0].n;
    const result = await copy.dryRunReorderAssignmentMigration(pool, {
      tenantId: "t1",
      source: [
        src("rr-ok", "uid-alice"),
        src("rr-no-principal", "uid-nobody"),
        src("rr-no-link", "uid-nolink"),
        src("rr-cross", "uid-t2"),
        src("rr-blank", ""),
        src("rr-nonstring", 42),
      ],
    });
    assert.equal(result.applied, false);
    assert.deepEqual(result.rows.map((r) => [r.reorderRequestId, r.disposition]), [
      ["rr-blank", "REMEDIATION_REQUIRED"],
      ["rr-cross", "CROSS_TENANT"],
      ["rr-no-link", "PRINCIPAL_EMPLOYEE_LINK_NOT_FOUND"],
      ["rr-no-principal", "UID_PRINCIPAL_NOT_FOUND"],
      ["rr-nonstring", "REMEDIATION_REQUIRED"],
      ["rr-ok", "EXACT_EMPLOYEE_ASSIGNMENT"],
    ]);
    assert.deepEqual([...result.blockedReorderIds], ["rr-blank", "rr-cross", "rr-no-link", "rr-no-principal", "rr-nonstring"]);
    assert.equal((await q(`SELECT count(*)::int n FROM eos_ops.reorder_request_assignments`)).rows[0].n, before);
  });

  await t.test("AMBIGUITY is never resolved by choosing", async () => {
    // A second ACTIVE link is refused by the schema's one-active-per-principal rule, so ambiguity is proved
    // against the classifier's own view -- the shape a broken source would present.
    const view = {
      tenantId: "t1",
      byUid: new Map([["uid-two", { principalId: "p-two", tenantId: "t1", activeEmployeeIds: ["e-alice", "e-bob"] }]]),
      employees: new Set(["e-alice", "e-bob"]),
      currentAssignments: new Map(),
    };
    const result = plan.planReorderAssignmentMigration([src("rr-two", "uid-two")], view);
    assert.equal(result.rows[0].disposition, "MULTIPLE_EMPLOYEE_LINKS");
    assert.equal(result.rows[0].assignedEmployeeId, null, "an ambiguous source must not pick one");
    assert.equal(result.copyable.length, 0);
  });

  await t.test("COPY refuses the WHOLE run while any assignee is unresolved", async () => {
    const result = await copy.copyReorderAssignmentsOnce(pool, {
      tenantId: "t1", performedByPrincipalId: executor,
      source: [src("rr-ok", "uid-alice"), src("rr-no-principal", "uid-nobody")],
    });
    assert.equal(result.applied, false);
    assert.match(result.refusal, /did not resolve/);
    // Not even the resolvable row was written: a partial copy is two answers to "who is assigned".
    assert.equal((await q(`SELECT count(*)::int n FROM eos_ops.reorder_request_assignments`)).rows[0].n, 0);
  });

  await t.test("COPY ONCE writes the Employee, MIGRATED provenance and an exact historical assignor", async () => {
    const result = await copy.copyReorderAssignmentsOnce(pool, {
      tenantId: "t1", performedByPrincipalId: executor,
      source: [src("rr-1", "uid-alice", "uid-manager"), src("rr-2", "uid-bob", "uid-manager")],
    });
    assert.deepEqual([result.applied, result.inserted, result.refusal], [true, 2, null]);
    const rows = (await q(`SELECT reorder_request_id, assigned_employee_id, provenance, assigned_by_principal_id
                             FROM eos_ops.reorder_request_assignments ORDER BY reorder_request_id`)).rows;
    assert.deepEqual(rows.map((r) => [r.reorder_request_id, r.assigned_employee_id, r.provenance, r.assigned_by_principal_id]), [
      ["rr-1", "e-alice", "MIGRATED", pManager],
      ["rr-2", "e-bob", "MIGRATED", pManager],
    ]);
    // The EXECUTOR is an audit event and appears in no assignment column.
    const audit = (await q(`SELECT action, actor_uid, after FROM eos_policy.audit_events WHERE action = $1`, [copy.MIGRATION_COPY_ACTION])).rows;
    assert.equal(audit.length, 1);
    assert.equal(audit[0].actor_uid, executor);
    assert.equal(audit[0].after.inserted, 2);
    assert.ok(!rows.some((r) => r.assigned_by_principal_id === executor), "the executor was recorded as a historical assignor");
  });

  await t.test("an UNRESOLVED historical assignor is NULL and NON-BLOCKING", async () => {
    const result = await copy.copyReorderAssignmentsOnce(pool, {
      tenantId: "t1", performedByPrincipalId: executor,
      source: [src("rr-3", "uid-alice", "uid-long-gone")],
    });
    assert.deepEqual([result.applied, result.inserted], [true, 1]);
    const row = (await q(`SELECT provenance, assigned_by_principal_id FROM eos_ops.reorder_request_assignments WHERE reorder_request_id = 'rr-3'`)).rows[0];
    // Truthfully unknown -- never the executor, never a fabricated Principal, never the uid.
    assert.deepEqual([row.provenance, row.assigned_by_principal_id], ["MIGRATED", null]);
    assert.equal(result.plan.assignorCounts.UNRESOLVED_PROVENANCE, 1);
    // And the CURRENT business assignee is still exact: provenance never blocks the assignment.
    assert.equal((await authority.readAssignedEmployee(pool, "t1", "rr-3")).assignedEmployeeId, "e-alice");
  });

  await t.test("a governed assignment is never silently replaced", async () => {
    // Same Employee -> ALREADY_GOVERNED, skipped.
    const same = await copy.dryRunReorderAssignmentMigration(pool, { tenantId: "t1", source: [src("rr-1", "uid-alice")] });
    assert.equal(same.rows[0].disposition, "ALREADY_GOVERNED");
    assert.equal(same.copyable.length, 0);
    // A DISAGREEING governed assignee is a blocker, not a replacement.
    const differs = await copy.dryRunReorderAssignmentMigration(pool, { tenantId: "t1", source: [src("rr-1", "uid-bob")] });
    assert.equal(differs.rows[0].disposition, "REMEDIATION_REQUIRED");
    assert.ok(differs.blockedReorderIds.includes("rr-1"));
    const copied = await copy.copyReorderAssignmentsOnce(pool, { tenantId: "t1", performedByPrincipalId: executor, source: [src("rr-1", "uid-bob")] });
    assert.equal(copied.applied, false);
    assert.equal((await authority.readAssignedEmployee(pool, "t1", "rr-1")).assignedEmployeeId, "e-alice", "the governed assignment changed");
  });


  await t.test("the AUTHORITATIVE plan is built inside the copy transaction, not carried in from a dry run", async () => {
    // A dry run taken BEFORE a governed assignment exists would say rr-race is copyable. If the copy trusted that
    // plan it would either overwrite the governed assignment or fail on the unique index; instead it re-plans
    // inside its own transaction and sees the row that appeared in between.
    const source = [src("rr-race", "uid-alice")];
    const stale = await copy.dryRunReorderAssignmentMigration(pool, { tenantId: "t1", source });
    assert.equal(stale.copyable.length, 1, "the dry run must consider it copyable before the race");

    // Someone assigns through the governed command in between.
    await authority.assignReorderRequestToEmployee({ pool }, {
      tenantId: "t1", principalId: pManager, capabilities: new Set([authority.REORDER_REQUEST_ASSIGN]),
    }, { reorderRequestId: "rr-race", employeeId: "e-bob" });

    const result = await copy.copyReorderAssignmentsOnce(pool, { tenantId: "t1", performedByPrincipalId: executor, source });
    // Re-planned inside the transaction: the governed assignee now DISAGREES with the source, so it blocks.
    assert.equal(result.applied, false);
    assert.equal(result.plan.rows[0].disposition, "REMEDIATION_REQUIRED",
      "the copy planned against a stale view instead of its own transaction");
    assert.equal((await authority.readAssignedEmployee(pool, "t1", "rr-race")).assignedEmployeeId, "e-bob",
      "the governed assignment was overwritten");
  });

  await t.test("the migration EXECUTOR is validated inside the transaction before it becomes audit provenance", async () => {
    const source = [src("rr-exec", "uid-alice")];
    const auditsBefore = (await q(`SELECT count(*)::int n FROM eos_policy.audit_events WHERE action = $1`, [copy.MIGRATION_COPY_ACTION])).rows[0].n;

    // An id nobody can account for must never become "who ran this import".
    const strangers = ["p-not-a-principal", "", "  ", "uid-alice"];
    for (const who of strangers) {
      const refused = await copy.copyReorderAssignmentsOnce(pool, { tenantId: "t1", performedByPrincipalId: who, source });
      assert.equal(refused.applied, false, `executor ${JSON.stringify(who)} was accepted`);
      assert.match(refused.refusal, /migration executor/);
    }
    // A real Principal of ANOTHER tenant is not an executor here either.
    const foreign = await copy.copyReorderAssignmentsOnce(pool, { tenantId: "t1", performedByPrincipalId: pT2, source });
    assert.equal(foreign.applied, false);
    // A disabled Principal is refused even though it is a member.
    await q(`UPDATE eos_policy.principals SET status = 'disabled' WHERE id = $1`, [executor]);
    const disabled = await copy.copyReorderAssignmentsOnce(pool, { tenantId: "t1", performedByPrincipalId: executor, source });
    assert.equal(disabled.applied, false);
    await q(`UPDATE eos_policy.principals SET status = 'active' WHERE id = $1`, [executor]);

    // Nothing was written, and no audit event claimed an unaccountable executor.
    assert.equal((await q(`SELECT count(*)::int n FROM eos_ops.reorder_request_assignments WHERE reorder_request_id = 'rr-exec'`)).rows[0].n, 0);
    assert.equal((await q(`SELECT count(*)::int n FROM eos_policy.audit_events WHERE action = $1`, [copy.MIGRATION_COPY_ACTION])).rows[0].n, auditsBefore);

    // The validated executor succeeds.
    const ok = await copy.copyReorderAssignmentsOnce(pool, { tenantId: "t1", performedByPrincipalId: executor, source });
    assert.deepEqual([ok.applied, ok.inserted], [true, 1]);
  });

  await t.test("VERIFY proves the copy, and no Firebase uid reached governed assignment state", async () => {
    const source = [src("rr-1", "uid-alice"), src("rr-2", "uid-bob"), src("rr-3", "uid-alice", "uid-long-gone"),
      src("rr-exec", "uid-alice")];
    const verified = await copy.verifyReorderAssignmentMigration(pool, { tenantId: "t1", source });
    assert.deepEqual([verified.passed, verified.findings], [true, []]);
    assert.equal(verified.checked, 4);
    // STRUCTURAL, not string equality: the authority has no uid-shaped column, and the honestly-unknown historical
    // assignor is counted rather than treated as a violation.
    assert.deepEqual([...verified.uidShapedColumns], []);
    assert.equal(verified.unresolvedProvenance, 1, "rr-3 records an unknown historical assignor");

    // A governed id that HAPPENS to equal some Firebase external_subject is NOT evidence a uid was stored: two
    // opaque namespaces may share characters. Proved by making the collision real and asserting VERIFY still passes.
    await q(`INSERT INTO eos_policy.principals (id, identity_provider, external_subject, status)
             VALUES ('p-collision', 'firebase', $1, 'active')`, ["e-alice"]);
    const collided = await copy.verifyReorderAssignmentMigration(pool, { tenantId: "t1", source });
    assert.equal(collided.passed, true, "a raw-value collision was mistaken for a stored uid");
    assert.deepEqual([...collided.uidShapedColumns], []);

    // VERIFY must FAIL when the governed state disagrees with the source.
    await q(`UPDATE eos_ops.reorder_request_assignments SET effective_to = now(), ended_by_principal_id = $1, ended_at = now()
              WHERE reorder_request_id = 'rr-2' AND effective_to IS NULL`, [executor]);
    const broken = await copy.verifyReorderAssignmentMigration(pool, { tenantId: "t1", source });
    assert.equal(broken.passed, false);
    assert.ok(broken.findings.some((f) => f.reorderRequestId === "rr-2" && /no current governed assignment/.test(f.problem)));
  });

  await t.test("the tooling writes nothing outside the copy, and the classifier is pure", async () => {
    const { readFileSync } = require("node:fs");
    const pure = readFileSync(`${FUNCTIONS_DIR}/src/eosOps/migration/reorderAssignmentMigration.ts`, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(pure, /\bpg\b|pool|client\.query|SELECT |INSERT |UPDATE |DELETE |Date\.now|new Date/);
    // No fuzzy matching is even possible: the classifier never receives a name, an email or a role.
    assert.doesNotMatch(pure, /displayName|email|jobRole|securityRole|operationalRoles|similar|fuzzy/i);
    const copySrc = readFileSync(`${FUNCTIONS_DIR}/src/eosOps/migration/reorderAssignmentMigrationCopy.ts`, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(copySrc, /require\(\s*["'][^"']*fire(base|store)[^"']*["']\s*\)|from\s+["'][^"']*fire(base|store)[^"']*["']/i);
    // The ONLY table it writes is the assignment authority and the audit trail.
    const writes = [...copySrc.matchAll(/INSERT INTO\s+([a-z_.]+)/g)].map((m) => m[1]).sort();
    assert.deepEqual([...new Set(writes)], ["eos_ops.reorder_request_assignments", "eos_policy.audit_events"]);
    assert.doesNotMatch(copySrc, /UPDATE\s+eos_|DELETE FROM/, "the copy modifies existing rows");
  });
});
