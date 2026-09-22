// WORK ORDER COPY ONCE + VERIFY, against a real postgres:16.
//
// The claims under test are the ones that decide whether a migration can be trusted: it refuses on every
// precondition it cannot prove, it writes all thirteen or none, an exact replay writes nothing, and VERIFY
// reports tampering rather than repairing it.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
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

const TENANT = "t-copy";
const COMPANY_ID = "taylor";
// DELIBERATELY DIFFERENT from the company id, mirroring nonprod where employees carry 'taylor' and
// eos_ops carries 'sample-co-synthetic'. If a string shortcut ever creeps in, these tests fail.
const COMPANY_KEY = "sample-co-synthetic";
const KEY_AUTHORITY = new Map([[COMPANY_ID, COMPANY_KEY]]);

const source = (i, over = {}) => ({
  id: `wo-${String(i).padStart(2, "0")}`,
  data: {
    woNumber: `WO-2026-0000${String(i).padStart(2, "0")}`,
    status: "SCHEDULED", type: "SERVICE_CALL", priority: 2,
    customerId: "acct-1", locationId: "loc-1", ...over,
  },
});

function planFor(records, { manifestIds = null, keyAuthority = KEY_AUTHORITY } = {}) {
  const snapshot = dry.buildSourceSnapshot("eos-platform-sandbox", "fieldops_wos", records, sha256);
  const evidence = {
    technicians: new Map([["tech-ok", { employeeId: "emp-1" }]]), employees: new Set(["emp-1"]),
    salesOrders: new Map(), accounts: new Set(["acct-1"]), locations: new Set(["loc-1"]),
    equipment: new Set(), resolutionManifest: null, targetWorkOrderIds: new Set(),
  };
  const first = dry.runDryRun({ snapshot, records, evidence });
  const businessIds = new Set(first.records.filter((r) => r.recordClass === "BUSINESS").map((r) => r.workOrderId));
  const fixtureIds = new Set(first.records.filter((r) => r.recordClass !== "BUSINESS").map((r) => r.workOrderId));
  const ids = manifestIds ?? [...businessIds];
  const manifest = dry.validateResolutionManifest({
    snapshotBodySha256: snapshot.bodySha256, decisionId: "OWNER-TEST", decidedAt: "2026-09-22T00:00:00.000Z",
    records: ids.map((id) => ({ workOrderId: id, operatingCompanyId: COMPANY_ID, decisionReason: "owner ruling" })),
  }, { snapshotBodySha256: snapshot.bodySha256, businessIds, fixtureIds });
  const report = dry.runDryRun({ snapshot, records, evidence: { ...evidence, resolutionManifest: manifest } });
  return {
    snapshot, report, manifest,
    plan: copy.buildCopyPlan({ report, records, manifest, operatingCompanyKeyByCompanyId: keyAuthority }),
  };
}

test("COPY ONCE and VERIFY", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `wocopy_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
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

  const bindCompany = (status = "ACTIVE") => q(
    `INSERT INTO eos_policy.tenant_operating_companies
       (tenant_id, operating_company_id, status, source, established_by, updated_by)
     VALUES ($1,$2,$3,'test','fixture','fixture')
     ON CONFLICT (tenant_id, operating_company_id) DO UPDATE SET status = EXCLUDED.status`,
    [TENANT, COMPANY_ID, status]);

  // ════════ guards ════════

  await t.test("SOURCE DRIFT refuses before anything is written", () => {
    assert.throws(() => copy.assertNoSourceDrift("a".repeat(64), "b".repeat(64)), (e) => {
      assert.equal(e.code, "SOURCE_DRIFT"); return true;
    });
    assert.doesNotThrow(() => copy.assertNoSourceDrift("a".repeat(64), "a".repeat(64)));
  });

  await t.test("an absent target schema refuses, and the tool creates none", () => {
    const state = { migrationCount: 36, lastMigration: copy.REQUIRED_LAST_MIGRATION, relations: new Set(["work_orders"]), tenantExists: true };
    assert.throws(() => copy.assertTargetSchemaReady(state), (e) => {
      assert.equal(e.code, "TARGET_SCHEMA_NOT_READY");
      assert.match(e.message, /work_order_parts_plan/);
      return true;
    });
    const src = readFileSync(resolve(FUNCTIONS_DIR, "src/eosOps/migration/workOrderMigrationCopy.ts"), "utf8");
    assert.equal(/CREATE TABLE|CREATE SCHEMA|ALTER TABLE/i.test(src), false, "COPY must never create schema");
  });

  await t.test("a wrong migration version refuses", () => {
    const relations = new Set(copy.REQUIRED_TARGET_RELATIONS);
    assert.throws(() => copy.assertTargetSchemaReady(
      { migrationCount: 34, lastMigration: "1760140800000_reorder-assignment-identity", relations, tenantExists: true }),
      (e) => { assert.equal(e.code, "TARGET_MIGRATIONS_NOT_APPLIED"); return true; });
    assert.throws(() => copy.assertTargetSchemaReady(
      { migrationCount: 36, lastMigration: copy.REQUIRED_LAST_MIGRATION, relations, tenantExists: false }),
      (e) => { assert.equal(e.code, "TENANT_NOT_FOUND"); return true; });
  });

  await t.test("the REAL target passes the readiness check once migrated", async () => {
    const state = await copy.readTargetSchemaState(pool, TENANT);
    assert.equal(state.migrationCount, copy.REQUIRED_MIGRATION_COUNT);
    assert.equal(state.lastMigration, copy.REQUIRED_LAST_MIGRATION);
    assert.doesNotThrow(() => copy.assertTargetSchemaReady(state));
  });

  // ════════ operating company ════════

  await t.test("a MISSING governed binding refuses the whole COPY", async () => {
    await q(`DELETE FROM eos_policy.tenant_operating_companies WHERE tenant_id = $1`, [TENANT]);
    await assert.rejects(() => copy.resolveOperatingCompanyKey(pool, TENANT, COMPANY_ID, KEY_AUTHORITY),
      (e) => { assert.equal(e.code, "OPERATING_COMPANY_BINDING_MISSING"); return true; });
  });

  await t.test("an INACTIVE binding refuses", async () => {
    await bindCompany("INACTIVE");
    await assert.rejects(() => copy.resolveOperatingCompanyKey(pool, TENANT, COMPANY_ID, KEY_AUTHORITY),
      (e) => { assert.equal(e.code, "OPERATING_COMPANY_BINDING_INACTIVE"); return true; });
  });

  await t.test("operatingCompanyId is NOT assumed equal to operating_company_key", async () => {
    await bindCompany("ACTIVE");
    // With an ACTIVE binding but NO key authority, it still refuses -- string equality is not a resolution.
    await assert.rejects(() => copy.resolveOperatingCompanyKey(pool, TENANT, COMPANY_ID, new Map()),
      (e) => {
        assert.equal(e.code, "OPERATING_COMPANY_KEY_UNRESOLVED");
        assert.match(e.message, /String equality is refused/);
        return true;
      });
    const bound = await copy.resolveOperatingCompanyKey(pool, TENANT, COMPANY_ID, KEY_AUTHORITY);
    assert.equal(bound.operatingCompanyId, "taylor");
    assert.equal(bound.operatingCompanyKey, "sample-co-synthetic");
    assert.notEqual(bound.operatingCompanyId, bound.operatingCompanyKey, "the two vocabularies differ, by construction");
  });

  // ════════ the plan ════════

  const THIRTEEN = [
    ...Array.from({ length: 8 }, (_, i) => source(i + 1, { type: undefined, status: "CANCELLED" })),
    ...Array.from({ length: 4 }, (_, i) => source(i + 9, { type: "SERVICE" })),
    source(13, { type: "SERVICE_CALL", status: "COMPLETED", completedAt: "2026-05-01T10:00:00.000Z",
                 assignedTechId: "tech-gone", equipmentId: null,
                 inventorySnapshot: [{ partId: "PRT-1001", sku: "PRT-1001", qtyPlanned: 2, qtyUsed: 0 }] }),
  ];

  await t.test("the plan normalizes type, preserves identity, and never allocates a number", () => {
    const { plan } = planFor(THIRTEEN);
    assert.equal(plan.length, 13);
    const byId = new Map(plan.map((p) => [p.workOrderId, p]));
    assert.equal(byId.get("wo-01").sourceType, null);
    assert.equal(byId.get("wo-01").targetType, "SERVICE_CALL");
    assert.equal(byId.get("wo-01").typeResolution, "OWNER_LEGACY_DEFAULT");
    assert.equal(byId.get("wo-09").sourceType, "SERVICE");
    assert.equal(byId.get("wo-09").targetType, "SERVICE_CALL");
    assert.equal(byId.get("wo-09").typeResolution, "OWNER_LEGACY_SERVICE_NORMALIZATION");
    assert.equal(byId.get("wo-13").typeResolution, "SOURCE_EXACT");
    for (const p of plan) {
      assert.equal(p.woNumber, THIRTEEN.find((s) => s.id === p.workOrderId).data.woNumber, "woNumber preserved exactly");
      assert.equal(p.operatingCompanyKey, COMPANY_KEY);
    }
    const src = readFileSync(resolve(FUNCTIONS_DIR, "src/eosOps/migration/workOrderMigrationCopy.ts"), "utf8");
    assert.equal(/allocateWorkOrderNumber|nextWoNumber/.test(src), false, "no native numbering may be invoked");
  });

  await t.test("a TERMINAL unresolved assignment invents no Employee, and keeps the legacy reference", () => {
    const { plan } = planFor(THIRTEEN);
    const p = plan.find((x) => x.workOrderId === "wo-13");
    assert.equal(p.assignmentDisposition, "TERMINAL_ASSIGNMENT_HISTORICAL_ONLY");
    assert.equal(p.assignmentEmployeeId, null, "no Employee is invented");
    assert.equal(p.legacyTechnicianReference, "tech-gone", "the legacy reference survives as evidence");
  });

  await t.test("Parts Plan is REFERENCE PRESERVATION, not catalog validation", () => {
    const { plan } = planFor(THIRTEEN);
    const p = plan.find((x) => x.workOrderId === "wo-13");
    assert.deepEqual(p.partsPlan, [{ partId: "PRT-1001", qtyPlanned: 2 }]);
    assert.equal(p.partsPlanDisposition, "REFERENCE_PRESERVATION_CATALOG_NOT_VALIDATED",
      "the evidence must not claim the Part reference was validated against an empty catalog");
  });

  await t.test("an excluded fixture can never enter the plan", () => {
    const withFixture = [...THIRTEEN, {
      id: "wo-sbx-001",
      data: { woNumber: "WO-2026-SBX001", scenarioId: "SBX-SCN-001", type: "SERVICE", status: "COMPLETED" },
    }];
    const { plan } = planFor(withFixture);
    assert.equal(plan.length, 13, "the fixture is not planned");
    assert.equal(plan.some((p) => p.workOrderId === "wo-sbx-001"), false);
  });

  // ════════ copy ════════

  await t.test("DRY RUN mode writes NOTHING to PostgreSQL", async () => {
    const { plan } = planFor(THIRTEEN);
    const out = await copy.copyOnce(pool, { tenantId: TENANT, runId: "run-dry", plan, decisionId: "OWNER-TEST" });
    assert.equal(out.applied, false);
    assert.equal(out.inserted, 0);
    const { rows } = await q(`SELECT count(*)::int AS n FROM eos_ops.work_orders`);
    assert.equal(rows[0].n, 0, "a preview must leave the database as it found it");
  });

  await t.test("ONE record failing rolls ALL THIRTEEN back", async () => {
    const broken = THIRTEEN.map((s) => (s.id === "wo-07" ? source(7, { type: undefined, status: "CANCELLED", locationId: "" }) : s));
    const { plan } = planFor(broken);
    // An empty location violates work_orders_location_is_stated. The whole transaction must roll back.
    await assert.rejects(() => copy.copyOnce(pool, { tenantId: TENANT, runId: "run-fail", plan, decisionId: "OWNER-TEST", apply: true }));
    const { rows } = await q(`SELECT count(*)::int AS n FROM eos_ops.work_orders`);
    assert.equal(rows[0].n, 0, "no partial migration may survive");
  });

  await t.test("the happy path copies all 13, with provenance MIGRATED", async () => {
    const { plan } = planFor(THIRTEEN);
    const out = await copy.copyOnce(pool, { tenantId: TENANT, runId: "run-1", plan, decisionId: "OWNER-TEST", apply: true });
    assert.equal(out.applied, true);
    assert.equal(out.inserted, 13);
    assert.equal(out.conflicts, 0);
    assert.equal(out.partsPlanRowsInserted, 1);
    const { rows } = await q(
      `SELECT count(*)::int AS n, count(*) FILTER (WHERE provenance::text = 'MIGRATED')::int AS migrated,
              count(*) FILTER (WHERE operating_company_key = $1)::int AS keyed
         FROM eos_ops.work_orders WHERE tenant_id = $2`, [COMPANY_KEY, TENANT]);
    assert.deepEqual(rows[0], { n: 13, migrated: 13, keyed: 13 });
    const { rows: plans } = await q(`SELECT count(*)::int AS n FROM eos_ops.work_order_parts_plan WHERE tenant_id = $1`, [TENANT]);
    assert.equal(plans[0].n, 1);
  });

  await t.test("VERIFY passes against the same bound plan", async () => {
    const { plan } = planFor(THIRTEEN);
    const report = await copy.verifyCopy(pool, TENANT, plan);
    assert.equal(report.ok, true, JSON.stringify(report.mismatches));
    assert.equal(report.checked, 13);
    assert.deepEqual(report.missing, []);
  });

  await t.test("an EXACT replay writes nothing further", async () => {
    const { plan } = planFor(THIRTEEN);
    const out = await copy.copyOnce(pool, { tenantId: TENANT, runId: "run-2", plan, decisionId: "OWNER-TEST", apply: true });
    assert.equal(out.inserted, 0, "a replay must produce zero additional rows");
    assert.equal(out.alreadyPresentEquivalent, 13);
    const { rows } = await q(`SELECT count(*)::int AS n FROM eos_ops.work_orders WHERE tenant_id = $1`, [TENANT]);
    assert.equal(rows[0].n, 13);
  });

  await t.test("the same id is NOT equivalence -- a tampered row is a CONFLICT and refuses the whole COPY", async () => {
    await q(`UPDATE eos_ops.work_orders SET status = 'DISPATCHED' WHERE tenant_id = $1 AND id = 'wo-05'`, [TENANT]);
    const { plan } = planFor(THIRTEEN);
    const collisions = await copy.recheckTargetCollisions(pool, TENANT, plan);
    assert.equal(collisions.get("wo-05"), "TARGET_CONFLICT");
    assert.equal(collisions.get("wo-04"), "ALREADY_PRESENT_EQUIVALENT");
    await assert.rejects(
      () => copy.copyOnce(pool, { tenantId: TENANT, runId: "run-3", plan, decisionId: "OWNER-TEST", apply: true }),
      (e) => { assert.equal(e.code, "TARGET_CONFLICT"); assert.match(e.message, /never overwrites/); return true; });
  });

  await t.test("VERIFY DETECTS the tampering and repairs nothing", async () => {
    const { plan } = planFor(THIRTEEN);
    const report = await copy.verifyCopy(pool, TENANT, plan);
    assert.equal(report.ok, false);
    const m = report.mismatches.find((x) => x.workOrderId === "wo-05" && x.field === "status");
    assert.ok(m, "the status mismatch must be reported");
    assert.equal(m.expected, "CANCELLED");
    assert.equal(m.found, "DISPATCHED");
    // Still tampered: VERIFY is read-only.
    const { rows } = await q(`SELECT status::text AS s FROM eos_ops.work_orders WHERE tenant_id = $1 AND id = 'wo-05'`, [TENANT]);
    assert.equal(rows[0].s, "DISPATCHED", "VERIFY must not repair what it finds");
  });

  await t.test("the COPY tool touches no Firestore", () => {
    const src = readFileSync(resolve(FUNCTIONS_DIR, "src/eosOps/migration/workOrderMigrationCopy.ts"), "utf8");
    assert.equal(/firebase-admin|firebase-functions|getFirestore/.test(src), false);
  });
});
