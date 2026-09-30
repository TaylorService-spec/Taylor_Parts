// WORK ORDER OPERATIONAL AGGREGATES -- the three governed PostgreSQL reads that replace the last Firestore Work Order
// aggregate reads (executionAnalyticsService.ts): technician execution stats, the consumption snapshot, and the
// technician volume breakdown. Owner ruling, Work Order cutover completion pass (2026-09-30).
//
// Proves: each Firebase definition as kept (or where it could not be), technicians identified by EMPLOYEE, the
// office gate (workOrder.record.read held unconditionally) and the own-stats path (Employee link + the entitled
// per-record decision), consumption = recorded execution actuals (never a plan, never stock), tenant isolation,
// and a stable, deterministic order. And that the active-set predicate is ONE definition every aggregate uses.
//
// Real PostgreSQL. Set POLICY_TEST_DATABASE_URL; without it the database half SKIPS.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const analytics = require("../lib/eosOps/workOrderAnalytics.js");
const operations = require("../lib/eosOps/workOrderOperations.js");
const ctx = require("../lib/eosOps/contextualAuthorization.js");
const model = require("../lib/eosOps/conditionalEntitlement.js");

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const SOURCE = readFileSync(resolve(FUNCTIONS_DIR, "src/eosOps/workOrderAnalytics.ts"), "utf8");
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

// ════════════════════ OFFLINE ════════════════════

test("the three reserved operation names are wired to this module, unrenamed, and listed as reads", () => {
  for (const name of ["readTechnicianExecutionStats", "readWorkOrderConsumptionSnapshot", "readTechnicianVolumeBreakdown"]) {
    assert.equal(operations.EOS_WORK_ORDER_OPERATIONS[name], analytics[name], `${name} is not this module's implementation`);
    assert.ok(operations.WORK_ORDER_READ_OPERATIONS.includes(name), `${name} is not a read`);
  }
});

test("THE ACTIVE SET is one predicate: every Work Order population in the module is filtered through it", () => {
  const code = strip(SOURCE);
  const populations = code.match(/\$\{SCHEMA\}\.work_orders w\b/g) ?? [];
  const filtered = code.match(/\$\{activeWorkOrderPredicate\("w"\)\}/g) ?? [];
  assert.ok(populations.length >= 3, "each aggregate reads work_orders");
  assert.equal(filtered.length, populations.length, "a work_orders population without the active-set predicate");
  assert.equal(/work_order_quarantine/.test(code), false, "the quarantine exclusion is wired by the integrator, in the predicate");
  assert.equal(analytics.activeWorkOrderPredicate("w"), "TRUE");
  assert.throws(() => analytics.activeWorkOrderPredicate("w; DROP"), /not a SQL alias/);
});

test("nothing here reads Firestore, an Inventory ledger, or a legacy technician identity", () => {
  const code = strip(SOURCE);
  assert.equal(/firebase-admin|firebase-functions|getFirestore|fieldops_wos|fieldops_technicians/.test(code), false);
  assert.equal(/inventory_commitments|inventory_transactions|stock_|ledger/.test(code), false, "consumption is recorded actuals, not stock");
  assert.equal(/technicianId|caller\.role|operationalRoles|customClaims/.test(code), false);
  assert.equal(/\b(INSERT|UPDATE|DELETE)\b/.test(code), false, "an aggregate read writes nothing");
});

// ════════════════════ AGAINST REAL POSTGRESQL ════════════════════

const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}
const T = "t-woan";
const T2 = "t-woan-other";
const MIN = 60_000;
const T0 = Date.parse("2026-09-01T15:00:00.000Z");
const at = (minutes) => new Date(T0 + minutes * MIN).toISOString();

test("Work Order operational aggregates", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `woan_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let pool;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => {
    await pool?.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations", "--no-check-order"],
    { cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrlFor(name) }, stdio: "pipe" });
  pool = new pg.Pool({ connectionString: dbUrlFor(name), max: 4 });
  const q = (sql, v = []) => pool.query(sql, v);

  const principal = async (tenant, pid) => {
    await q(`INSERT INTO eos_policy.principals (id,external_subject,identity_provider,status) VALUES ($1,$2,'eos','active')
             ON CONFLICT (id) DO NOTHING`, [pid, `sub-${pid}`]);
    await q(`INSERT INTO eos_policy.tenant_memberships (id,tenant_id,principal_id,status) VALUES ($1,$2,$3,'active')`, [`mem-${tenant}-${pid}`, tenant, pid]);
  };
  const employee = (tenant, eid, fields = {}) => q(
    `INSERT INTO eos_workforce.employees (id,tenant_id,employment_status,operating_company_id,employee_number,display_name,preferred_name,first_name,last_name)
     VALUES ($1,$2,'ACTIVE','taylor',$1,$3,$4,$5,$6)`,
    [eid, tenant, fields.display ?? null, fields.preferred ?? null, fields.first ?? null, fields.last ?? null]);
  const link = (pid, eid) => q(
    `INSERT INTO eos_policy.employee_principal_links
       (id,tenant_id,principal_id,employee_id,operating_company_id,link_source,status,asserted_by,assertion_reason)
     VALUES ($1,$2,$3,$4,'taylor','OPERATOR_ASSERTED','active','fixture','analytics fixture')`, [`lnk-${pid}`, T, pid, eid]);

  for (const tenant of [T, T2]) {
    await q(`INSERT INTO eos_policy.tenants (id,key,name) VALUES ($1,$1,$1)`, [tenant]);
    await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id,operating_company_id,status,source,established_by,updated_by)
             VALUES ($1,'taylor','ACTIVE','fixture','fixture','fixture')`, [tenant]);
    await principal(tenant, "prn-dispatcher");
  }
  for (const p of ["prn-tech-a", "prn-tech-b", "prn-unlinked", "prn-nobody"]) await principal(T, p);
  await employee(T, "emp-a", { preferred: "Ana" });
  await employee(T, "emp-b", { display: "Ben Ortiz" });
  await employee(T, "emp-inv", { first: "Ivy", last: "Nolan" });
  await employee(T, "emp-idle");
  await employee(T2, "emp-other");
  await link("prn-tech-a", "emp-a");
  await link("prn-tech-b", "emp-b");

  let seq = 0;
  /** A Work Order with its lifecycle moments and (optionally) an OPEN assignment -- inserted, not driven. */
  const wo = async (tenant, status, { assignee = null, started = null, completed = null, closedAt = null } = {}) => {
    const id = `wo-${String(++seq).padStart(3, "0")}`;
    await q(`INSERT INTO eos_ops.work_orders
               (id, tenant_id, operating_company_key, work_order_number, status, work_order_type, priority, customer_id, location_id,
                work_started_at, completed_at, closed_at, provenance, created_by_principal_id, created_at, updated_at)
             VALUES ($1,$2,'taylor',$3,$4,'SERVICE_CALL',2,'acct-1','loc-1',$5,$6,$7,'NATIVE','prn-dispatcher',$8,$8)`,
      [id, tenant, `WO-2026-${String(seq).padStart(6, "0")}`, status, started, completed, closedAt, at(-600)]);
    if (assignee) await assign(tenant, id, assignee);
    return id;
  };
  const assign = (tenant, id, employeeId, { closed = false } = {}) => q(
    `INSERT INTO eos_ops.work_order_assignments
       (id, tenant_id, work_order_id, assignee_employee_id, source, effective_from, assigned_by_principal_id,
        effective_to, end_source, end_reason, ended_by_principal_id, provenance)
     VALUES ($1,$2,$3,$4,'SCHEDULE',$5,'prn-dispatcher',$6,$7,$8,$9,'NATIVE')`,
    [`asg-${randomUUID()}`, tenant, id, employeeId, at(-500),
     closed ? at(-400) : null, closed ? "UNSCHEDULE" : null, closed ? "fixture" : null, closed ? "prn-dispatcher" : null]);
  let keySeq = 0;
  const usage = (tenant, id, partId, delta) => q(
    `INSERT INTO eos_ops.work_order_execution_records
       (id, tenant_id, work_order_id, kind, part_id, requested_delta, applied_delta, note, idempotency_key,
        request_fingerprint, recorded_by_principal_id, recorded_at)
     VALUES ($1,$2,$3,'PART_USAGE',$4,$5,$5,NULL,$6,'fp','prn-dispatcher',$7)`,
    [`woe-${randomUUID()}`, tenant, id, partId, delta, `k${++keySeq}#part:${partId}`, at(keySeq)]);
  const note = (tenant, id) => q(
    `INSERT INTO eos_ops.work_order_execution_records
       (id, tenant_id, work_order_id, kind, part_id, requested_delta, applied_delta, note, idempotency_key,
        request_fingerprint, recorded_by_principal_id, recorded_at)
     VALUES ($1,$2,$3,'NOTE',NULL,NULL,NULL,'a note is not usage',$4,'fp','prn-dispatcher',$5)`,
    [`woe-${randomUUID()}`, tenant, id, `k${++keySeq}#note`, at(keySeq)]);

  // ── emp-a: six Work Orders on an OPEN assignment ──
  const a1 = await wo(T, "COMPLETED", { assignee: "emp-a", started: at(0), completed: at(60) });
  await usage(T, a1, "part-x", 3);
  await usage(T, a1, "part-y", 1);
  await usage(T, a1, "part-y", -1); // corrected back to zero: no usage
  await note(T, a1);
  const a2 = await wo(T, "CLOSED", { assignee: "emp-a", started: at(0), completed: at(120), closedAt: at(200) });
  await usage(T, a2, "part-x", 2);
  const a3 = await wo(T, "WORK_IN_PROGRESS", { assignee: "emp-a", started: at(0) });
  await usage(T, a3, "part-z", 5);
  await wo(T, "COMPLETED", { assignee: "emp-a", completed: at(90) }); // completed, no start: MISSING evidence
  await wo(T, "CANCELLED", { assignee: "emp-a" });
  // Reassigned: emp-b's assignment ENDED, emp-a's is OPEN -- it is emp-a's.
  const moved = await wo(T, "COMPLETED", { started: at(10), completed: at(40) });
  await assign(T, moved, "emp-b", { closed: true });
  await assign(T, moved, "emp-a");
  // ── emp-b ──
  const b1 = await wo(T, "COMPLETED", { assignee: "emp-b", started: at(0), completed: at(15) });
  await usage(T, b1, "part-x", 1);
  const b2 = await wo(T, "DISPATCHED", { assignee: "emp-b" });
  await usage(T, b2, "part-m", 4);
  await q(`INSERT INTO eos_ops.work_order_parts_plan (tenant_id, work_order_id, part_id, qty_planned, planned_by, updated_by)
           VALUES ($1,$2,'part-w',10,'fixture','fixture')`, [T, b2]); // PLANNED, never used: not consumption
  // ── emp-inv: one valid pair, one INVERTED pair ──
  await wo(T, "COMPLETED", { assignee: "emp-inv", started: at(0), completed: at(30) });
  await wo(T, "CLOSED", { assignee: "emp-inv", started: at(100), completed: at(50), closedAt: at(300) });
  // ── unassigned: usage still counts toward consumption; no technician volume ──
  const u1 = await wo(T, "READY_TO_DISPATCH");
  await usage(T, u1, "part-q", 4);
  // ── ANOTHER TENANT: must move nothing ──
  const other = await wo(T2, "COMPLETED", { assignee: "emp-other", started: at(0), completed: at(5) });
  await usage(T2, other, "part-x", 100);

  // ── personas ──
  const baselineRead = new Set(["workOrder.record.read"]);
  const DQ016 = model.grantConditionCatalog([{ grantor: { kind: "ROLE", roleKey: "persona" }, capabilityKey: "workOrder.record.read",
    condition: { paths: [[{ kind: "RECORD_ASSIGNMENT", relation: "ASSIGNED_EMPLOYEE" }]], recordKind: "workOrder" } }]);
  /** The caller exactly as the transport composes it: the flat set (conditioned keys withheld) + the entitled actor. */
  const caller = (principalId, caps, conditions = model.SHIPPED_GRANT_CONDITIONS) => {
    const ent = model.entitlementsFrom([...caps].map((capabilityKey) => ({ grantor: { kind: "ROLE", roleKey: "persona" }, capabilityKey })), conditions);
    const flat = new Set(ent.filter((e) => e.condition === null).map((e) => e.capabilityKey));
    return {
      actor: { tenantId: T, principalId, capabilities: flat },
      operational: { tenantId: T, principalId, capabilities: flat,
        conditionallyHeld: new Set(ent.filter((e) => e.condition !== null).map((e) => e.capabilityKey)), entitlements: () => ent },
    };
  };
  const office = caller("prn-dispatcher", baselineRead);
  const techA = caller("prn-tech-a", baselineRead, DQ016);
  const techB = caller("prn-tech-b", baselineRead, DQ016);
  const unlinked = caller("prn-unlinked", baselineRead, DQ016);
  const nobody = caller("prn-nobody", new Set());
  const deps = { pool, reader: ctx.postgresContextualReader(pool), postgresState: "ACTIVE" };
  const refusal = (code, category) => (e) => { assert.equal(e.code, code); if (category) assert.equal(e.category, category); return true; };

  const EMP_A = {
    employeeId: "emp-a", displayName: "Ana",
    totalWorkOrdersCompleted: 4,             // a1, a2 (since CLOSED), the start-less one, the reassigned one
    totalPartsConsumed: 10,                  // a1: x3 (+ y corrected to 0), a2: x2, a3: z5
    averageCompletionTimeMs: 70 * MIN,       // (60 + 120 + 30) / 3
    completionEvidence: { valid: 3, inverted: 0, missing: 1 },
    workOrderVolumeByStatus: { CANCELLED: 1, CLOSED: 1, COMPLETED: 3, WORK_IN_PROGRESS: 1 },
  };

  await t.test("STATS: the Firebase definitions over the Employee's OPEN assignments (office reads any Employee)", async () => {
    assert.deepEqual(await analytics.readTechnicianExecutionStats(deps, office, { employeeId: "emp-a" }), EMP_A);
  });

  await t.test("STATS: one inverted pair withdraws the average (null), and is counted -- never abs(), never dropped", async () => {
    const s = await analytics.readTechnicianExecutionStats(deps, office, { employeeId: "emp-inv" });
    assert.equal(s.averageCompletionTimeMs, null);
    assert.deepEqual(s.completionEvidence, { valid: 1, inverted: 1, missing: 0 });
    assert.equal(s.displayName, "Ivy Nolan");
    assert.equal(s.totalWorkOrdersCompleted, 2);
  });

  await t.test("STATS: an Employee with no Work Orders reads zeros and no average; an unknown one is NOT_FOUND", async () => {
    assert.deepEqual(await analytics.readTechnicianExecutionStats(deps, office, { employeeId: "emp-idle" }), {
      employeeId: "emp-idle", displayName: null, totalWorkOrdersCompleted: 0, totalPartsConsumed: 0, averageCompletionTimeMs: null,
      completionEvidence: { valid: 0, inverted: 0, missing: 0 }, workOrderVolumeByStatus: {},
    });
    await assert.rejects(analytics.readTechnicianExecutionStats(deps, office, { employeeId: "emp-ghost" }), refusal("EMPLOYEE_NOT_FOUND", "NOT_FOUND"));
  });

  await t.test("STATS, OWN: a conditioned technician reads their own figures through their Employee link -- the same numbers", async () => {
    assert.deepEqual(await analytics.readTechnicianExecutionStats(deps, techA, {}), EMP_A);
    assert.deepEqual(await analytics.readTechnicianExecutionStats(deps, techA, { employeeId: "emp-a" }), EMP_A);
    const b = await analytics.readTechnicianExecutionStats(deps, techB, {});
    assert.equal(b.employeeId, "emp-b");
    assert.deepEqual(b.workOrderVolumeByStatus, { COMPLETED: 1, DISPATCHED: 1 }, "the reassigned-away Work Order is not emp-b's");
  });

  await t.test("STATS, REFUSED: another Employee, no link, no capability -- and the capability is checked first", async () => {
    await assert.rejects(analytics.readTechnicianExecutionStats(deps, techA, { employeeId: "emp-b" }), refusal("NOT_OWN_EMPLOYEE", "FORBIDDEN"));
    await assert.rejects(analytics.readTechnicianExecutionStats(deps, unlinked, {}), refusal("EMPLOYEE_LINK_REQUIRED", "FORBIDDEN"));
    await assert.rejects(analytics.readTechnicianExecutionStats(deps, nobody, {}), refusal("CAPABILITY_MISSING", "FORBIDDEN"));
    await assert.rejects(analytics.readTechnicianExecutionStats(deps, nobody, { employeeId: "emp-a" }), refusal("CAPABILITY_MISSING", "FORBIDDEN"));
    await assert.rejects(analytics.readTechnicianExecutionStats(deps, office, {}), refusal("EMPLOYEE_REQUIRED", "INVALID_INPUT"),
      "an unlinked office caller must name the Employee");
    await assert.rejects(analytics.readTechnicianExecutionStats(deps, office, { technicianId: "tech-1" }), refusal("INPUT_FIELD_NOT_ACCEPTED", "INVALID_INPUT"));
    await assert.rejects(analytics.readTechnicianExecutionStats(deps, office, { employeeId: "a/b" }), refusal("EMPLOYEE_ID_INVALID", "INVALID_INPUT"));
  });

  await t.test("CONSUMPTION: recorded actuals per Part -- total and distinct Work Orders; plans, notes and zeroed corrections are not usage", async () => {
    assert.deepEqual(await analytics.readWorkOrderConsumptionSnapshot(deps, office, {}), {
      parts: [
        { partId: "part-x", totalQuantityUsed: 6, frequency: 3 },
        { partId: "part-z", totalQuantityUsed: 5, frequency: 1 },
        { partId: "part-m", totalQuantityUsed: 4, frequency: 1 }, // tie at 4: by partId
        { partId: "part-q", totalQuantityUsed: 4, frequency: 1 }, // unassigned Work Order: still consumption
      ],
      mostConsumedPartId: "part-x",
      basis: "RECORDED_EXECUTION_ACTUALS",
    });
  });

  await t.test("VOLUME: per OPEN-assignment Employee -- completed (completed_at set) vs not; busiest first; unassigned excluded", async () => {
    assert.deepEqual(await analytics.readTechnicianVolumeBreakdown(deps, office, {}), {
      items: [
        { employeeId: "emp-a", displayName: "Ana", activeCount: 2, completedCount: 4 }, // a3 + the CANCELLED one are "active" (Firebase rule)
        { employeeId: "emp-inv", displayName: "Ivy Nolan", activeCount: 0, completedCount: 2 },
        { employeeId: "emp-b", displayName: "Ben Ortiz", activeCount: 1, completedCount: 1 },
      ],
    });
  });

  await t.test("OFFICE AGGREGATES require workOrder.record.read held UNCONDITIONALLY -- a conditioned technician is refused", async () => {
    for (const read of [analytics.readWorkOrderConsumptionSnapshot, analytics.readTechnicianVolumeBreakdown]) {
      await assert.rejects(read(deps, techA, {}), refusal("CAPABILITY_MISSING", "FORBIDDEN"));
      await assert.rejects(read(deps, nobody, {}), refusal("CAPABILITY_MISSING", "FORBIDDEN"));
      await assert.rejects(read(deps, office, { tenantId: T2 }), refusal("INPUT_FIELD_NOT_ACCEPTED", "INVALID_INPUT"));
    }
  });

  await t.test("DETERMINISTIC: the same database answers the same bytes, and no aggregate wrote anything", async () => {
    const count = async () => (await q(`SELECT
        (SELECT count(*)::int FROM eos_ops.work_orders) AS w, (SELECT count(*)::int FROM eos_ops.work_order_execution_records) AS r,
        (SELECT count(*)::int FROM eos_ops.work_order_assignments) AS a`)).rows[0];
    const before = await count();
    const run = async () => JSON.stringify([
      await analytics.readTechnicianExecutionStats(deps, office, { employeeId: "emp-a" }),
      await analytics.readTechnicianExecutionStats(deps, techA, {}),
      await analytics.readWorkOrderConsumptionSnapshot(deps, office, {}),
      await analytics.readTechnicianVolumeBreakdown(deps, office, {}),
    ]);
    assert.equal(await run(), await run());
    assert.deepEqual(await count(), before);
  });
});
