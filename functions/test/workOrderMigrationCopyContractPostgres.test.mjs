// WORK ORDER COPY CONTRACT, against a real postgres:16.
//
// What the COPY writes, byte for byte: every contracted fact, the historical instants (never the copy
// time), the current assignment through governed identity, the surviving reschedule, the cancellation
// transition, the Parts Plan, and ONE run record carrying the source fingerprints. Then VERIFY: every
// classification it can return is produced here by a real divergence, and none is repaired.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import pg from "pg";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const dry = require("../lib/eosOps/migration/workOrderMigrationDryRun.js");
const copy = require("../lib/eosOps/migration/workOrderMigrationCopy.js");

const sha256 = (t) => createHash("sha256").update(t, "utf8").digest("hex");
const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}
const fsTs = (iso, extraNanos = 0) => {
  const ms = Date.parse(iso);
  const seconds = Math.floor(ms / 1000);
  return { seconds, nanoseconds: (ms - seconds * 1000) * 1e6 + extraNanos, toMillis: () => ms, toDate: () => new Date(ms) };
};

const TENANT = "t-woc";
const DECISION = "OWNER-WOC-TEST";
const RUN_CLOCK = new Date("2026-09-26T12:00:00.000Z");
const COPIED_AT = "2026-09-26T12:00:00.000000Z";
const TECHNICIANS = new Map([
  ["tech-1", { employeeId: "emp-1" }], ["tech-2", { employeeId: "emp-2" }],
  // Resolves in the SOURCE (Firestore employees), but the target's eos_workforce never received emp-3.
  ["tech-3", { employeeId: "emp-3" }],
]);

const base = (n, over) => ({
  woNumber: `WO-2026-00010${n}`, type: "SERVICE_CALL", priority: 2, customerId: "acct-1", locationId: "loc-1",
  createdAt: fsTs("2026-04-01T09:00:00.123Z", 456000), updatedAt: fsTs("2026-04-03T10:00:00.000Z"), ...over,
});
const POPULATION = () => [
  // A: dispatched after a REASSIGNMENT, with every authored fact.
  { id: "wo-a", data: base(1, {
    status: "DISPATCHED", severity: "EQUIPMENT_DOWN", complaint: "walk-in not cooling", diagnosis: "failed relay",
    estimatedDurationMinutes: 90,
    scheduledStart: fsTs("2026-04-02T08:00:00.000Z", 7000), scheduledEnd: fsTs("2026-04-02T10:00:00.000Z"),
    assignedTechId: "tech-1", scheduledTechId: "tech-1", dispatchedAt: fsTs("2026-04-02T07:00:00.000Z"),
    reassignedFromTechId: "tech-2", reassignedAt: fsTs("2026-04-02T07:00:00.000Z"), reassignedReason: "tech-2 out sick",
    reassignedByUid: "uid-dispatcher",
  }) },
  // B: scheduled, RESCHEDULED to a new technician by an actor with no Principal.
  { id: "wo-b", data: base(2, {
    status: "SCHEDULED", scheduledTechId: "tech-2",
    scheduledStart: "2026-04-06T08:00:00Z", scheduledEnd: "2026-04-06T10:00:00Z",
    rescheduledFromTechId: "tech-1", rescheduledFromStart: "2026-04-05T08:00:00Z", rescheduledFromEnd: "2026-04-05T10:00:00Z",
    rescheduledAt: "2026-04-03T09:00:00+02:00", rescheduledReason: "customer asked", rescheduledByUid: "uid-nobody",
  }) },
  // C: completed; same-technician dispatch; every lifecycle stamp; a Parts Plan.
  { id: "wo-c", data: base(3, {
    status: "COMPLETED", resolution: "replaced relay", assignedTechId: "tech-1", scheduledTechId: "tech-1",
    dispatchedAt: fsTs("2026-04-02T07:00:00.000Z"), acceptedAt: fsTs("2026-04-02T07:05:00.000Z"),
    enRouteAt: fsTs("2026-04-02T07:10:00.000Z"), arrivedAt: fsTs("2026-04-02T07:40:00.000Z"),
    workStartedAt: fsTs("2026-04-02T07:45:00.000Z"), completedAt: fsTs("2026-04-02T09:30:00.250Z"),
    partsPlanUpdatedAt: fsTs("2026-04-01T12:00:00.000Z"), laborHours: 2,
    inventorySnapshot: [{ partId: "PRT-1", sku: "PRT-1", qtyPlanned: 2, qtyUsed: 2 }, { partId: "PRT-2", qtyPlanned: 1 }],
  }) },
  // D: cancelled -- closedAt is the cancellation instant.
  { id: "wo-d", data: base(4, { status: "CANCELLED", type: "SERVICE", closedAt: "2026-04-05T12:00:00Z" }) },
  // E: closed, terminal, technician unresolved -> no assignment row, reference kept.
  { id: "wo-e", data: base(5, {
    status: "CLOSED", assignedTechId: "tech-gone", completedAt: "2026-04-04T11:00:00Z", closedAt: "2026-04-05T11:00:00Z",
    severity: "URGENT",
  }) },
  // F: created; a created instant written with an offset.
  { id: "wo-f", data: base(6, { status: "CREATED", createdAt: "2026-04-01T14:30:00.5+05:30", updatedAt: "2026-04-01T09:00:00.5Z" }) },
];

function planFor(records, { keyAuthority = new Map([["taylor", "sample-co-synthetic"]]) } = {}) {
  const snapshot = dry.buildSourceSnapshot("eos-platform-sandbox", "fieldops_wos", records, sha256);
  const evidence = {
    technicians: TECHNICIANS, employees: new Set(["emp-1", "emp-2", "emp-3"]), salesOrders: new Map(),
    accounts: new Set(["acct-1"]), locations: new Set(["loc-1"]), equipment: new Set(),
    resolutionManifest: null, targetWorkOrderIds: new Set(),
  };
  const first = dry.runDryRun({ snapshot, records, evidence });
  const businessIds = new Set(first.records.filter((r) => r.recordClass === "BUSINESS").map((r) => r.workOrderId));
  const manifest = dry.validateResolutionManifest({
    snapshotBodySha256: snapshot.bodySha256, decisionId: DECISION, decidedAt: "2026-09-26T00:00:00.000Z",
    records: [...businessIds].map((id) => ({ workOrderId: id, operatingCompanyId: "taylor", decisionReason: "owner ruling" })),
  }, { snapshotBodySha256: snapshot.bodySha256, businessIds, fixtureIds: new Set() });
  const report = dry.runDryRun({ snapshot, records, evidence: { ...evidence, resolutionManifest: manifest } });
  const input = { report, records, manifest, operatingCompanyKeyByCompanyId: keyAuthority };
  const out = copy.buildCopyPlanReport(input);
  return { snapshot, report, plan: out.planned, refused: out.refused };
}

test("WORK ORDER COPY CONTRACT", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `woccontract_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let pool;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => {
    await pool?.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations"], {
    cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrlFor(name) }, stdio: "pipe",
  });
  pool = new pg.Pool({ connectionString: dbUrlFor(name), max: 6 });
  const q = (text, values = []) => pool.query(text, values);
  await q(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ($1,$1,$1)`, [TENANT]);
  for (const emp of ["emp-1", "emp-2"]) {
    await q(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id) VALUES ($1,$2,'ACTIVE','taylor')`, [emp, TENANT]);
  }
  await q(`INSERT INTO eos_policy.principals (id, external_subject, identity_provider, status) VALUES ('p-dispatcher','uid-dispatcher','firebase','active')`);
  await q(`INSERT INTO eos_policy.tenant_memberships (id, tenant_id, principal_id) VALUES ('m-dispatcher',$1,'p-dispatcher')`, [TENANT]);

  const TS = (col) => `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
  const one = async (sql, values) => (await q(sql, values)).rows[0];
  const count = async (table) => (await one(`SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = $1`, [TENANT])).n;

  const { plan, refused } = planFor(POPULATION());

  await t.test("the population plans with nothing refused", () => {
    assert.deepEqual(refused, []);
    assert.equal(plan.length, 6);
  });

  // ════════ identity failure ════════

  await t.test("an assignee the target cannot hold REFUSES the whole COPY -- nothing is written", async () => {
    const withGhost = planFor([...POPULATION(), { id: "wo-g", data: base(7, {
      status: "DISPATCHED", assignedTechId: "tech-3", scheduledTechId: "tech-3", dispatchedAt: fsTs("2026-04-02T07:00:00.000Z"),
    }) }]);
    assert.deepEqual(withGhost.refused, [], "the source resolves tech-3 to emp-3; only the TARGET lacks it");
    await assert.rejects(
      () => copy.copyOnce(pool, { tenantId: TENANT, runId: "run-ghost", plan: withGhost.plan, decisionId: DECISION, apply: true, now: RUN_CLOCK }),
      (e) => {
        assert.equal(e.code, "UNRESOLVED_IDENTITY");
        assert.match(e.message, /wo-g -> emp-3/);
        assert.deepEqual(e.details.map((d) => d.workOrderId), ["wo-g"]);
        return true;
      });
    assert.equal(await count("eos_ops.work_orders"), 0, "fail closed: no Work Order and no dangling assignee");
    assert.equal(await count("eos_policy.audit_events"), 0);
  });

  // ════════ dry run determinism ════════

  let dryOutcome;
  await t.test("a DRY RUN writes nothing, and repeating it gives the same answer", async () => {
    const a = await copy.copyOnce(pool, { tenantId: TENANT, runId: "run-dry-1", plan, decisionId: DECISION });
    const b = await copy.copyOnce(pool, { tenantId: TENANT, runId: "run-dry-1", plan: planFor(POPULATION()).plan, decisionId: DECISION });
    const norm = (o) => ({ ...o, collisions: [...o.collisions] });
    assert.deepEqual(norm(a), norm(b), "same source + same target = the same dry outcome");
    assert.equal(a.applied, false);
    assert.equal(a.copiedAt, null, "no clock on a dry run");
    assert.equal(a.inserted, 0);
    assert.deepEqual([...a.collisions.values()], Array(6).fill("TARGET_ABSENT"));
    assert.deepEqual(a.unresolvedActors, [{ workOrderId: "wo-b", field: "rescheduledByUid" }]);
    for (const table of ["eos_ops.work_orders", "eos_ops.work_order_assignments", "eos_ops.work_order_schedule_history",
      "eos_ops.work_order_transitions", "eos_ops.work_order_parts_plan", "eos_policy.audit_events"]) {
      assert.equal(await count(table), 0, `${table} untouched by a preview`);
    }
    dryOutcome = a;
  });

  // ════════ apply ════════

  let outcome;
  await t.test("APPLY writes every contracted row, once, in one transaction", async () => {
    outcome = await copy.copyOnce(pool, {
      tenantId: TENANT, runId: "run-1", plan, decisionId: DECISION, apply: true, performedBy: "operator.rudy", now: RUN_CLOCK,
    });
    assert.equal(outcome.planDigest, dryOutcome.planDigest, "the applied plan is the previewed plan");
    assert.equal(outcome.copiedAt, COPIED_AT);
    assert.deepEqual({
      inserted: outcome.inserted, assignments: outcome.assignmentsInserted, schedule: outcome.scheduleHistoryInserted,
      transitions: outcome.transitionsInserted, parts: outcome.partsPlanRowsInserted,
    }, { inserted: 6, assignments: 3, schedule: 1, transitions: 1, parts: 2 });
  });

  await t.test("COPY PRESERVATION: authored facts, severity, duration and links land exactly", async () => {
    const a = await one(`SELECT complaint, diagnosis, resolution, severity::text AS severity, priority, estimated_duration_minutes,
                                 work_order_type::text AS type, operating_company_key, customer_id, location_id, provenance::text AS provenance,
                                 created_by_principal_id, updated_by_principal_id
                            FROM eos_ops.work_orders WHERE tenant_id = $1 AND id = 'wo-a'`, [TENANT]);
    assert.deepEqual(a, {
      complaint: "walk-in not cooling", diagnosis: "failed relay", resolution: null, severity: "EQUIPMENT_DOWN", priority: 2,
      estimated_duration_minutes: 90, type: "SERVICE_CALL", operating_company_key: "sample-co-synthetic",
      customer_id: "acct-1", location_id: "loc-1", provenance: "MIGRATED",
      created_by_principal_id: null, updated_by_principal_id: null,
    });
    const c = await one(`SELECT resolution FROM eos_ops.work_orders WHERE tenant_id = $1 AND id = 'wo-c'`, [TENANT]);
    assert.equal(c.resolution, "replaced relay");
    const e = await one(`SELECT severity FROM eos_ops.work_orders WHERE tenant_id = $1 AND id = 'wo-e'`, [TENANT]);
    assert.equal(e.severity, null, "an out-of-vocabulary severity is not coerced");
  });

  await t.test("TIMESTAMP PRESERVATION: historical instants to the microsecond -- never the copy time", async () => {
    const rows = (await q(`SELECT id, ${TS("created_at")} AS created, ${TS("updated_at")} AS updated,
                                  ${TS("scheduled_start")} AS ss, ${TS("dispatched_at")} AS dispatched, ${TS("accepted_at")} AS accepted,
                                  ${TS("en_route_at")} AS en_route, ${TS("arrived_at")} AS arrived, ${TS("work_started_at")} AS started,
                                  ${TS("completed_at")} AS completed, ${TS("closed_at")} AS closed, ${TS("parts_plan_updated_at")} AS ppu
                             FROM eos_ops.work_orders WHERE tenant_id = $1 ORDER BY id`, [TENANT])).rows;
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    assert.equal(by["wo-a"].created, "2026-04-01T09:00:00.123456Z");
    assert.equal(by["wo-a"].updated, "2026-04-03T10:00:00.000000Z");
    assert.equal(by["wo-a"].ss, "2026-04-02T08:00:00.000007Z", "sub-millisecond precision survives");
    assert.equal(by["wo-f"].created, "2026-04-01T09:00:00.500000Z", "an offset instant is normalized, not shifted");
    assert.deepEqual([by["wo-c"].dispatched, by["wo-c"].accepted, by["wo-c"].en_route, by["wo-c"].arrived, by["wo-c"].started, by["wo-c"].completed],
      ["2026-04-02T07:00:00.000000Z", "2026-04-02T07:05:00.000000Z", "2026-04-02T07:10:00.000000Z",
       "2026-04-02T07:40:00.000000Z", "2026-04-02T07:45:00.000000Z", "2026-04-02T09:30:00.250000Z"]);
    assert.equal(by["wo-c"].ppu, "2026-04-01T12:00:00.000000Z");
    assert.equal(by["wo-e"].closed, "2026-04-05T11:00:00.000000Z");
    assert.equal(by["wo-d"].closed, null, "a CANCELLED record does not claim a close");
    for (const r of rows) assert.notEqual(r.created, COPIED_AT, `${r.id} must not carry the copy instant as its creation`);
    const cancel = (await q(`SELECT to_status::text AS s, from_status, action, ${TS("occurred_at")} AS at, actor_principal_id, provenance::text AS p
                               FROM eos_ops.work_order_transitions WHERE tenant_id = $1`, [TENANT])).rows;
    assert.deepEqual(cancel, [{ s: "CANCELLED", from_status: null, action: "cancel", at: "2026-04-05T12:00:00.000000Z", actor_principal_id: null, p: "MIGRATED" }]);
  });

  await t.test("ASSIGNMENT PRESERVATION: one current row per resolvable Work Order, Employees only, stated basis", async () => {
    const rows = (await q(`SELECT work_order_id, assignee_employee_id, source, reason, ${TS("effective_from")} AS from_,
                                  effective_to, assigned_by_principal_id, provenance::text AS provenance
                             FROM eos_ops.work_order_assignments WHERE tenant_id = $1 ORDER BY work_order_id`, [TENANT])).rows;
    assert.deepEqual(rows.map((r) => [r.work_order_id, r.assignee_employee_id, r.from_, r.effective_to]), [
      ["wo-a", "emp-1", "2026-04-02T07:00:00.000000Z", null],
      ["wo-b", "emp-2", "2026-04-03T07:00:00.000000Z", null],
      ["wo-c", "emp-1", COPIED_AT, null],
    ]);
    assert.ok(rows.every((r) => r.source === "MIGRATION" && r.provenance === "MIGRATED" && r.assigned_by_principal_id === null));
    assert.match(rows[0].reason, /legacy:assignedTechId=tech-1 basis:REASSIGNED_AT/);
    assert.match(rows[1].reason, /legacy:scheduledTechId=tech-2 basis:RESCHEDULED_AT/);
    assert.match(rows[2].reason, /basis:MIGRATION_INSTANT/, "the row SAYS its start is the migration instant");
    assert.equal(rows.some((r) => r.work_order_id === "wo-e"), false, "the unresolved terminal technician gets no invented Employee");
    const sched = await one(`SELECT ${TS("previous_start")} AS ps, ${TS("new_start")} AS ns, ${TS("changed_at")} AS at, reason, changed_by_principal_id
                               FROM eos_ops.work_order_schedule_history WHERE tenant_id = $1 AND work_order_id = 'wo-b'`, [TENANT]);
    assert.deepEqual(sched, { ps: "2026-04-05T08:00:00.000000Z", ns: "2026-04-06T08:00:00.000000Z", at: "2026-04-03T07:00:00.000000Z",
      reason: "customer asked", changed_by_principal_id: null });
  });

  await t.test("PROVENANCE: one run record -- source ids and fingerprints, run id, copy instant apart from created_at", async () => {
    const ev = (await q(`SELECT id, action, actor_uid, target_kind, target_id, after, ${TS("occurred_at")} AS at
                           FROM eos_policy.audit_events WHERE tenant_id = $1`, [TENANT])).rows;
    assert.equal(ev.length, 1);
    const [e] = ev;
    assert.equal(e.id, outcome.provenanceAuditEventId);
    assert.equal(e.action, "work_order.migration.copy");
    assert.equal(e.actor_uid, "operator.rudy");
    assert.equal(e.target_kind, "work_order_snapshot");
    assert.equal(e.target_id, plan[0].snapshotBodySha256);
    assert.equal(e.at, COPIED_AT);
    assert.equal(e.after.runId, "run-1");
    assert.equal(e.after.decisionId, DECISION);
    assert.equal(e.after.copiedAt, COPIED_AT);
    assert.equal(e.after.planDigest, outcome.planDigest);
    const recs = Object.fromEntries(e.after.records.map((r) => [r.workOrderId, r]));
    assert.deepEqual(Object.keys(recs).sort(), ["wo-a", "wo-b", "wo-c", "wo-d", "wo-e", "wo-f"]);
    for (const p of plan) assert.equal(recs[p.workOrderId].sourceSha256, p.sourceSha256, `${p.workOrderId} fingerprint`);
    assert.equal(recs["wo-a"].legacyAssignment.reassignedFromTechId, "tech-2", "history the target cannot hold survives here");
    assert.equal(recs["wo-a"].legacyAssignment.reassignedBy, "p-dispatcher", "a uid is recorded only as what it resolved to");
    assert.equal(recs["wo-b"].legacyAssignment.rescheduledBy, "UNRESOLVED");
    assert.equal(recs["wo-e"].legacyTechnicianReference, "tech-gone");
    assert.equal(recs["wo-e"].severityRaw, "URGENT");
    assert.equal(recs["wo-d"].sourceType, "SERVICE", "the raw type survives normalization");
    assert.equal(JSON.stringify(e.after).includes("uid-"), false, "no Firebase uid is written");
    const planned = await one(`SELECT ${TS("planned_at")} AS at, planned_by FROM eos_ops.work_order_parts_plan WHERE tenant_id = $1 AND part_id = 'PRT-1'`, [TENANT]);
    assert.deepEqual(planned, { at: COPIED_AT, planned_by: `migration:${DECISION}` });
  });

  await t.test("VERIFY: every row MATCH, child counts agree, nothing unexpected", async () => {
    const r = await copy.verifyCopy(pool, TENANT, plan);
    assert.equal(r.ok, true, JSON.stringify(r.mismatches, null, 1));
    assert.deepEqual(r.rows.map((x) => x.classification), Array(6).fill("MATCH"));
    assert.equal(r.byClassification.MATCH, 6);
    assert.deepEqual(r.counts.assignments, { expected: 3, found: 3 });
    assert.deepEqual(r.counts.scheduleHistory, { expected: 1, found: 1 });
    assert.deepEqual(r.counts.transitions, { expected: 1, found: 1 });
    assert.deepEqual(r.counts.partsPlan, { expected: 2, found: 2 });
    assert.deepEqual(r.counts.salesOrderLines, { expected: 0, found: 0 });
    assert.deepEqual(r.unexpectedTargetIds, []);
  });

  await t.test("REPLAY: an exact re-run writes nothing -- no rows and no second run record", async () => {
    const again = await copy.copyOnce(pool, { tenantId: TENANT, runId: "run-2", plan: planFor(POPULATION()).plan, decisionId: DECISION, apply: true, now: new Date("2026-09-27T00:00:00Z") });
    assert.equal(again.inserted, 0);
    assert.equal(again.alreadyPresentEquivalent, 6);
    assert.equal(again.provenanceAuditEventId, null);
    assert.equal(await count("eos_policy.audit_events"), 1);
    assert.equal(await count("eos_ops.work_order_assignments"), 3);
  });

  // ════════ verifier mismatch detection -- each divergence inside a rolled-back transaction ════════

  const inRollback = async (fn) => {
    const c = await pool.connect();
    try { await c.query("BEGIN"); return await fn(c); } finally { await c.query("ROLLBACK"); c.release(); }
  };
  const rowOf = (report, id) => report.rows.find((x) => x.workOrderId === id);

  await t.test("TARGET_DIVERGED: an edited authored fact, and a shifted created_at", async () => {
    await inRollback(async (c) => {
      await c.query(`UPDATE eos_ops.work_orders SET complaint = 'edited', created_at = created_at + interval '1 microsecond' WHERE tenant_id = $1 AND id = 'wo-a'`, [TENANT]);
      const r = await copy.verifyCopy(c, TENANT, plan);
      assert.equal(r.ok, false);
      const row = rowOf(r, "wo-a");
      assert.equal(row.classification, "TARGET_DIVERGED");
      assert.deepEqual(row.findings.map((f) => f.field).sort(), ["complaint", "createdAt"]);
      assert.equal(row.findings.find((f) => f.field === "createdAt").found, "2026-04-01T09:00:00.123457Z");
      assert.equal(r.byClassification.MATCH, 5);
    });
  });

  await t.test("TARGET_DIVERGED: a missing target row", async () => {
    const r = await copy.verifyCopy(pool, TENANT, [...plan, { ...plan[0], workOrderId: "wo-zz" }]);
    assert.deepEqual(r.missing, ["wo-zz"]);
    assert.equal(rowOf(r, "wo-zz").classification, "TARGET_DIVERGED");
  });

  await t.test("CHILD_ROW_MISMATCH: a closed assignment, an extra transition, a lost Parts Plan line", async () => {
    await inRollback(async (c) => {
      await c.query(`UPDATE eos_ops.work_order_assignments SET effective_to = effective_from, end_source = 'MIGRATION'
                      WHERE tenant_id = $1 AND work_order_id = 'wo-a'`, [TENANT]);
      await c.query(`INSERT INTO eos_ops.work_order_transitions (id, tenant_id, work_order_id, to_status, action, occurred_at, provenance)
                     VALUES ('wot-x', $1, 'wo-f', 'READY_TO_DISPATCH', 'markReady', '2026-04-02T00:00:00Z', 'MIGRATED')`, [TENANT]);
      await c.query(`DELETE FROM eos_ops.work_order_parts_plan WHERE tenant_id = $1 AND work_order_id = 'wo-c' AND part_id = 'PRT-2'`, [TENANT]);
      const r = await copy.verifyCopy(c, TENANT, plan);
      assert.equal(r.ok, false);
      assert.deepEqual(["wo-a", "wo-c", "wo-f"].map((id) => [rowOf(r, id).classification, rowOf(r, id).findings.map((f) => f.field)]), [
        ["CHILD_ROW_MISMATCH", ["assignments"]], ["CHILD_ROW_MISMATCH", ["partsPlan"]], ["CHILD_ROW_MISMATCH", ["transitions"]],
      ]);
      assert.deepEqual(r.counts.partsPlan, { expected: 2, found: 1 });
    });
  });

  await t.test("SOURCE_CHANGED: the source moved after the copy (its fingerprint no longer matches the run record)", async () => {
    const moved = POPULATION().map((r) => (r.id === "wo-a" ? { ...r, data: { ...r.data, complaint: "walk-in not cooling (updated)" } } : r));
    const r = await copy.verifyCopy(pool, TENANT, planFor(moved).plan);
    const row = rowOf(r, "wo-a");
    assert.equal(row.classification, "SOURCE_CHANGED");
    assert.deepEqual(row.findings.map((f) => f.field).sort(), ["complaint", "source.sha256"]);
    assert.equal(rowOf(r, "wo-b").classification, "MATCH", "an unchanged record still matches");
  });

  await t.test("UNRESOLVED_IDENTITY: a planned assignee that is no Employee of this tenant", async () => {
    const ghost = plan.map((p) => (p.workOrderId === "wo-c" ? { ...p, assignment: { ...p.assignment, employeeId: "emp-ghost" } } : p));
    const r = await copy.verifyCopy(pool, TENANT, ghost);
    assert.equal(rowOf(r, "wo-c").classification, "UNRESOLVED_IDENTITY");
    assert.ok(rowOf(r, "wo-c").findings.some((f) => f.field === "assignment.employee"));
  });

  await t.test("MISSING_REQUIRED_FIELD and UNKNOWN: refused records are VERIFY failures, never silently absent", async () => {
    const withRefusals = planFor([...POPULATION(),
      { id: "wo-m", data: base(8, { status: "CREATED", createdAt: undefined }) },
      { id: "wo-u", data: base(9, { status: "CREATED", executionLog: [{ note: "n", at: fsTs("2026-04-02T00:00:00Z"), byTechnicianId: "tech-1" }] }) },
    ]);
    assert.deepEqual(withRefusals.refused.map((x) => x.workOrderId), ["wo-m", "wo-u"]);
    const r = await copy.verifyCopy(pool, TENANT, withRefusals.plan, { refused: withRefusals.refused });
    assert.equal(r.ok, false);
    assert.equal(rowOf(r, "wo-m").classification, "MISSING_REQUIRED_FIELD");
    assert.equal(rowOf(r, "wo-u").classification, "UNKNOWN");
    assert.equal(r.counts.refused, 2);
    assert.equal(r.byClassification.MATCH, 6);
  });

  await t.test("UNKNOWN: two run records claiming one Work Order are an unexplained provenance", async () => {
    await inRollback(async (c) => {
      await c.query(`INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, after)
                     VALUES ('audit-dup', $1, 'work_order.migration.copy', 'x', 'work_order_snapshot', 'x', $2::jsonb)`,
        [TENANT, JSON.stringify({ runId: "run-dup", copiedAt: COPIED_AT, records: [{ workOrderId: "wo-f", sourceSha256: "x" }] })]);
      const r = await copy.verifyCopy(c, TENANT, plan);
      assert.equal(rowOf(r, "wo-f").classification, "UNKNOWN");
    });
  });

  await t.test("a MIGRATED row outside the population fails VERIFY", async () => {
    const r = await copy.verifyCopy(pool, TENANT, plan.filter((p) => p.workOrderId !== "wo-f"));
    assert.deepEqual(r.unexpectedTargetIds, ["wo-f"]);
    assert.equal(r.ok, false);
  });

  // ════════ existing rows are compared, never overwritten ════════

  await t.test("EXISTING-ROW NO-OVERWRITE: a divergent target row refuses the COPY and survives untouched", async () => {
    await q(`UPDATE eos_ops.work_orders SET diagnosis = 'target-side edit' WHERE tenant_id = $1 AND id = 'wo-a'`, [TENANT]);
    const details = await copy.recheckTargetCollisionDetails(pool, TENANT, plan);
    assert.equal(details.get("wo-a").result, "TARGET_CONFLICT");
    assert.deepEqual(details.get("wo-a").findings.map((f) => f.field), ["diagnosis"]);
    assert.equal(details.get("wo-b").result, "ALREADY_PRESENT_EQUIVALENT");
    for (const apply of [false, true]) {
      await assert.rejects(
        () => copy.copyOnce(pool, { tenantId: TENANT, runId: "run-3", plan, decisionId: DECISION, apply, now: RUN_CLOCK }),
        (e) => { assert.equal(e.code, "TARGET_CONFLICT"); assert.match(e.message, /wo-a \[diagnosis\]/); assert.match(e.message, /never overwrites/); return true; });
    }
    const after = await one(`SELECT diagnosis FROM eos_ops.work_orders WHERE tenant_id = $1 AND id = 'wo-a'`, [TENANT]);
    assert.equal(after.diagnosis, "target-side edit", "the COPY never repairs");
    const v = await copy.verifyCopy(pool, TENANT, plan);
    assert.equal(rowOf(v, "wo-a").classification, "TARGET_DIVERGED");
    await q(`UPDATE eos_ops.work_orders SET diagnosis = 'failed relay' WHERE tenant_id = $1 AND id = 'wo-a'`, [TENANT]);
  });

  await t.test("a NEW record beside present-equivalent ones inserts only itself and leaves the others as they were", async () => {
    const before = (await q(`SELECT id, ${TS("updated_at")} AS u FROM eos_ops.work_orders WHERE tenant_id = $1 ORDER BY id`, [TENANT])).rows;
    const grown = planFor([...POPULATION(), { id: "wo-h", data: base(9, { status: "CREATED" }) }]);
    assert.deepEqual(grown.refused, []);
    const out = await copy.copyOnce(pool, { tenantId: TENANT, runId: "run-4", plan: grown.plan, decisionId: DECISION, apply: true, now: new Date("2026-09-28T00:00:00Z") });
    assert.equal(out.inserted, 1);
    assert.equal(out.alreadyPresentEquivalent, 6);
    const after = (await q(`SELECT id, ${TS("updated_at")} AS u FROM eos_ops.work_orders WHERE tenant_id = $1 AND id <> 'wo-h' ORDER BY id`, [TENANT])).rows;
    assert.deepEqual(after, before, "no existing row was rewritten");
    const v = await copy.verifyCopy(pool, TENANT, grown.plan);
    assert.equal(v.ok, true, JSON.stringify(v.mismatches));
    assert.equal(await count("eos_policy.audit_events"), 2, "the second run records only what it wrote");
  });
});
