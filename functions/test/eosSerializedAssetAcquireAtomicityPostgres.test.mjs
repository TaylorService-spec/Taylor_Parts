// DQ-019 -- acquire-existing-unit is ALL OR NOTHING on PostgreSQL.
//
// validate authority / scope / state -> establish custody + provenance -> record the +1 ADJUSTED serial ledger
// movement -> commit, in ONE transaction. Proven against a real database with failures INJECTED at each write by
// test-only triggers created in the disposable database (never a migration, never a production object):
//   * success: custody + provenance + exactly one +1 ADJUSTED SERIAL movement + one audit, all agreeing;
//   * unauthorized (no capability; capability outside scope): nothing written;
//   * invalid serialized state (the unit is already in custody): refused, nothing written;
//   * ledger failure -- at the INSERT, and at COMMIT through a deferred constraint trigger: custody and provenance
//     are absent too;
//   * custody failure: nothing written;
//   * retry / idempotency: the same key gives the same result, one custody row, one movement -- including a retry
//     after an injected failure;
//   * inconsistent evidence (provenance whose ledger fact is missing; a ledger fact with no provenance) fails closed;
//   * a CONCURRENT duplicate: two simultaneous acquisitions of one serial -> exactly one custody and one movement; the
//     other is replayed (same intent) or refused (different intent) -- never a raw database error.
// Writes ONLY to a database it creates under POLICY_TEST_DATABASE_URL and drops at the end.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { certifyInventoryBaselineFixture } from "./support/inventoryBaselineCertified.mjs";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");
const { bootstrapTenant, bootstrapAdministrator, ensureTenantPrincipal } = require("../lib/adminPolicy/tenantBootstrap.js");
const { acquireEosSerializedAsset, AcquireOperationError, ACQUISITION_MOVEMENT_SOURCE_KIND } = require("../lib/eosOps/serializedAssetAcquireOperations.js");
const { serializedAssetDocId } = require("../lib/serializedAsset/serializedAssetRegistration.js");

const OP = "operator-acq-atomicity";
const CAP = "inventory.serializedAsset.acquire";
const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

test("DQ-019: acquire-existing-unit atomicity, idempotency and concurrency", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `acqatom_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let pool;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => {
    await pool?.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations", "--no-check-order"],
    { cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrlFor(name) }, stdio: "pipe" });
  pool = new pg.Pool({ connectionString: dbUrlFor(name), max: 8 });
  const q = (s, v = []) => pool.query(s, v);
  const repo = new PostgresPolicyRepository(pool);
  const n = async (sql, v = []) => Number((await q(sql, v)).rows[0].n);

  const { tenant } = await bootstrapTenant(repo, { key: "acqatom", name: "acqatom", actorUid: OP });
  await certifyInventoryBaselineFixture((sql, v) => pool.query(sql, v), tenant.id); // the writer gate (inventoryBaselineGate.ts)
  const T = tenant.id;
  await bootstrapAdministrator(repo, { tenantId: T, externalSubject: "admin", performedBy: OP, reason: "boot" });

  // World: one governed company, two ACTIVE warehouses, one ACTIVE serialized part.
  await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id, operating_company_id, status, source, established_by, updated_by) VALUES ($1, 'co', 'ACTIVE', 't', $2, $2)`, [T, OP]);
  await q(`INSERT INTO eos_policy.tenant_operating_company_keys (tenant_id, operating_company_id, operating_company_key, status, provenance, source, established_by, updated_by) VALUES ($1, 'co', 'key', 'ACTIVE', 'NATIVE', 't', $2, $2)`, [T, OP]);
  for (const id of ["WH-A", "WH-B"]) {
    await q(`INSERT INTO eos_ops.warehouses (id, tenant_id, operating_company_key, name, site_label, status, provenance, created_by, updated_by) VALUES ($1, $2, 'key', $1, 's', 'ACTIVE', 'NATIVE', $3, $3)`, [id, T, OP]);
  }
  await q(`INSERT INTO eos_ops.parts (id, tenant_id, created_by, internal_part_number, name, status, stocking_unit, control_type, stocking_class,
             expiry_tracked, consumable, returnable_core, whole_unit, version, updated_by)
           VALUES ('P-SER', $1, 'seed', 'P-SER', 'acq part', 'ACTIVE', 'EACH', 'SERIALIZED', 'STOCKED', false, false, false, false, 1, 'seed')`, [T]);

  // One ACTIVE Employee with Warehouse Operations eligibility and WH-A scope ONLY. Authority differs between actors
  // solely by the capability set handed to the command.
  const made = await ensureTenantPrincipal(repo, { tenantId: T, externalSubject: "p-acq", actorUid: OP, actorRoleKeys: ["admin"] });
  const principalId = made.principal?.id ?? made.id ?? made.principalId;
  await q(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id) VALUES ('emp-acq', $1, 'ACTIVE', 'co')`, [T]);
  await q(`INSERT INTO eos_policy.employee_principal_links (id, tenant_id, principal_id, employee_id, operating_company_id, link_source, status, asserted_by, assertion_reason)
           VALUES ('epl-acq', $1, $2, 'emp-acq', 'co', 'OPERATOR_ASSERTED', 'active', $3, 'fixture')`, [T, principalId, OP]);
  await q(`INSERT INTO eos_workforce.employee_work_eligibility (id, tenant_id, employee_id, qualification_code, effective_from, assigned_by) VALUES ('we-acq', $1, 'emp-acq', 'WAREHOUSE_OPERATIONS', now(), $2)`, [T, OP]);
  await q(`INSERT INTO eos_workforce.employee_operational_scopes (id, tenant_id, employee_id, scope_type, scope_id, effective_from, assigned_by) VALUES ('os-acq', $1, 'emp-acq', 'WAREHOUSE', 'WH-A', now(), $2)`, [T, OP]);

  const deps = { pool, postgresState: "ACTIVE" };
  const holder = { tenantId: T, principalId, capabilities: new Set([CAP]) };
  const nobody = { tenantId: T, principalId, capabilities: new Set() };
  const req = (serial, over = {}) => ({ partId: "P-SER", serialNo: serial, locationId: "WH-A", reason: "OPENING_BALANCE", idempotencyKey: `k-${serial}`, ...over });
  const acquire = (input, actor = holder) => acquireEosSerializedAsset(deps, actor, input);
  const refusedWith = async (promise, code) => {
    const err = await promise.then(() => null, (e) => e);
    assert.ok(err, `expected a refusal ${code}`);
    assert.ok(err instanceof AcquireOperationError, `a governed refusal, not a raw error: ${err?.stack ?? err}`);
    assert.equal(err.code, code, err.message);
    return err;
  };

  /** Everything an acquisition of `serial` could have written. */
  const facts = async (serial) => ({
    custody: await n(`SELECT count(*) AS n FROM eos_ops.serialized_custody WHERE tenant_id = $1 AND serial_number = $2`, [T, serial]),
    provenance: await n(`SELECT count(*) AS n FROM eos_ops.serialized_asset_acquisitions WHERE tenant_id = $1 AND serial_number = $2`, [T, serial]),
    movements: await n(`SELECT count(*) AS n FROM eos_ops.inventory_movements WHERE tenant_id = $1 AND serial_number = $2`, [T, serial]),
    audits: await n(`SELECT count(*) AS n FROM eos_policy.audit_events WHERE tenant_id = $1 AND action = 'serializedAsset.acquire' AND target_id = $2`, [T, serializedAssetDocId("P-SER", serial)]),
  });
  const NOTHING = { custody: 0, provenance: 0, movements: 0, audits: 0 };
  const ONE = { custody: 1, provenance: 1, movements: 1, audits: 1 };

  // Test-only failure injection: triggers in THIS disposable database, keyed on a serial so nothing else is touched.
  await q(`CREATE FUNCTION public.test_inject_failure() RETURNS trigger LANGUAGE plpgsql AS $$
           BEGIN RAISE EXCEPTION 'TEST_INJECTED_FAILURE: % on %', TG_WHEN, TG_TABLE_NAME; END $$`);
  await q(`CREATE TRIGGER test_fail_ledger_insert BEFORE INSERT ON eos_ops.inventory_movements
           FOR EACH ROW WHEN (NEW.serial_number = 'SN-FAIL-LEDGER') EXECUTE FUNCTION public.test_inject_failure()`);
  await q(`CREATE CONSTRAINT TRIGGER test_fail_ledger_commit AFTER INSERT ON eos_ops.inventory_movements
           DEFERRABLE INITIALLY DEFERRED
           FOR EACH ROW WHEN (NEW.serial_number = 'SN-FAIL-COMMIT') EXECUTE FUNCTION public.test_inject_failure()`);
  await q(`CREATE TRIGGER test_fail_custody_insert BEFORE INSERT ON eos_ops.serialized_custody
           FOR EACH ROW WHEN (NEW.serial_number = 'SN-FAIL-CUSTODY') EXECUTE FUNCTION public.test_inject_failure()`);
  // Widens the race window: the first acquisition of SN-RACE-* sleeps INSIDE its transaction, after its unit reads.
  await q(`CREATE FUNCTION public.test_slow_custody() RETURNS trigger LANGUAGE plpgsql AS $$
           BEGIN PERFORM pg_sleep(0.75); RETURN NEW; END $$`);
  await q(`CREATE TRIGGER test_slow_custody_insert BEFORE INSERT ON eos_ops.serialized_custody
           FOR EACH ROW WHEN (NEW.serial_number LIKE 'SN-RACE-%') EXECUTE FUNCTION public.test_slow_custody()`);

  await t.test("success: custody + provenance + exactly ONE +1 ADJUSTED serial movement + one audit, all agreeing", async () => {
    const out = await acquire(req("SN-OK"));
    assert.deepEqual([out.outcome, out.state, out.locationId], ["acquired", "AVAILABLE", "WH-A"]);
    assert.deepEqual(await facts("SN-OK"), ONE);
    const a = (await q(`SELECT id, ledger_movement_id, provenance FROM eos_ops.serialized_asset_acquisitions WHERE tenant_id = $1 AND serial_number = 'SN-OK'`, [T])).rows[0];
    const m = (await q(`SELECT id, movement_type::text AS mt, quantity_delta AS d, tracking_mode::text AS tm, location_id, source_kind, source_id
                          FROM eos_ops.inventory_movements WHERE tenant_id = $1 AND serial_number = 'SN-OK'`, [T])).rows[0];
    assert.deepEqual({ ...m, id: undefined, source_id: undefined },
      { id: undefined, mt: "ADJUSTED", d: 1, tm: "SERIAL", location_id: "WH-A", source_kind: ACQUISITION_MOVEMENT_SOURCE_KIND, source_id: undefined });
    assert.equal(a.ledger_movement_id, m.id, "the provenance names ITS ledger fact");
    assert.equal(m.source_id, a.id, "the ledger fact names ITS acquisition");
    assert.equal(a.provenance, "NON_PO_ACQUISITION");
  });

  await t.test("unauthorized: no capability -> refused, nothing written", async () => {
    await refusedWith(acquire(req("SN-NOAUTH"), nobody), "PERMISSION_DENIED");
    assert.deepEqual(await facts("SN-NOAUTH"), NOTHING);
  });

  await t.test("unauthorized: the capability OUTSIDE operational scope -> refused, nothing written", async () => {
    await refusedWith(acquire(req("SN-NOSCOPE", { locationId: "WH-B" })), "OUTSIDE_OPERATIONAL_SCOPE");
    assert.deepEqual(await facts("SN-NOSCOPE"), NOTHING);
  });

  await t.test("invalid serialized state: a unit already in custody (from a receipt) -> refused, nothing written", async () => {
    await q(`INSERT INTO eos_ops.serialized_custody (id, tenant_id, operating_company_key, part_id, serial_number, status, location_type, location_id, updated_by)
             VALUES ('ser-rcv', $1, 'key', 'P-SER', 'SN-RCV', 'AVAILABLE', 'WAREHOUSE', 'WH-A', 'u')`, [T]);
    await refusedWith(acquire(req("SN-RCV")), "ALREADY_EXISTS_CONFLICT");
    assert.deepEqual(await facts("SN-RCV"), { custody: 1, provenance: 0, movements: 0, audits: 0 }, "only the receipt's own custody row");
  });

  await t.test("ledger failure AT THE INSERT rolls back custody and provenance too", async () => {
    const err = await acquire(req("SN-FAIL-LEDGER")).then(() => null, (e) => e);
    assert.match(String(err?.message), /TEST_INJECTED_FAILURE: BEFORE on inventory_movements/);
    assert.deepEqual(await facts("SN-FAIL-LEDGER"), NOTHING);
  });

  await t.test("ledger failure AT COMMIT (deferred constraint) rolls back custody and provenance too", async () => {
    const err = await acquire(req("SN-FAIL-COMMIT")).then(() => null, (e) => e);
    assert.match(String(err?.message), /TEST_INJECTED_FAILURE: AFTER on inventory_movements/);
    assert.deepEqual(await facts("SN-FAIL-COMMIT"), NOTHING);
  });

  await t.test("custody failure: nothing written", async () => {
    const err = await acquire(req("SN-FAIL-CUSTODY")).then(() => null, (e) => e);
    assert.match(String(err?.message), /TEST_INJECTED_FAILURE: BEFORE on serialized_custody/);
    assert.deepEqual(await facts("SN-FAIL-CUSTODY"), NOTHING);
  });

  await t.test("retry after an injected failure acquires exactly once", async () => {
    await q(`DROP TRIGGER test_fail_ledger_insert ON eos_ops.inventory_movements`);
    assert.equal((await acquire(req("SN-FAIL-LEDGER"))).outcome, "acquired");
    assert.deepEqual(await facts("SN-FAIL-LEDGER"), ONE);
  });

  await t.test("retry / idempotency: the same key gives the same result, one custody row, one movement", async () => {
    const first = await acquire(req("SN-RETRY"));
    const second = await acquire(req("SN-RETRY"));
    const third = await acquire(req("SN-RETRY"));
    assert.equal(first.outcome, "acquired");
    for (const r of [second, third]) {
      assert.equal(r.outcome, "replayed");
      assert.deepEqual({ ...r, outcome: undefined }, { ...first, outcome: undefined }, "the same result");
    }
    assert.deepEqual(await facts("SN-RETRY"), ONE, "no second custody, asset, increment or audit");
    const onHand = await n(`SELECT COALESCE(sum(quantity_delta), 0) AS n FROM eos_ops.inventory_movements WHERE tenant_id = $1 AND serial_number = 'SN-RETRY'`, [T]);
    assert.equal(onHand, 1, "serial on-hand is exactly one");
    await refusedWith(acquire(req("SN-RETRY", { reason: "LEGACY_MIGRATION" })), "ALREADY_EXISTS_CONFLICT");
    await refusedWith(acquire(req("SN-RETRY", { provenanceNote: "a different story" })), "ALREADY_EXISTS_CONFLICT");
    assert.deepEqual(await facts("SN-RETRY"), ONE);
  });

  await t.test("inconsistent evidence fails closed: provenance whose ledger fact is missing", async () => {
    await q(`INSERT INTO eos_ops.serialized_custody (id, tenant_id, operating_company_key, part_id, serial_number, status, location_type, location_id, updated_by)
             VALUES ('ser-bad1', $1, 'key', 'P-SER', 'SN-BAD-NOLEDGER', 'AVAILABLE', 'WAREHOUSE', 'WH-A', 'u')`, [T]);
    await q(`INSERT INTO eos_ops.serialized_asset_acquisitions (id, tenant_id, part_id, serial_number, warehouse_id, operating_company_key, reason, idempotency_key, ledger_movement_id, acquired_by)
             VALUES ('acq-bad1', $1, 'P-SER', 'SN-BAD-NOLEDGER', 'WH-A', 'key', 'OPENING_BALANCE', 'k-SN-BAD-NOLEDGER', 'mov-missing', 'u')`, [T]);
    await refusedWith(acquire(req("SN-BAD-NOLEDGER")), "ACQUIRE_INTEGRITY");
    assert.deepEqual(await facts("SN-BAD-NOLEDGER"), { custody: 1, provenance: 1, movements: 0, audits: 0 }, "nothing repaired, nothing added");
  });

  await t.test("inconsistent evidence fails closed: an acquisition ledger fact with no provenance", async () => {
    await q(`INSERT INTO eos_ops.inventory_movements (id, tenant_id, operating_company_key, part_id, tracking_mode, location_type, location_id,
               movement_type, quantity_delta, serial_number, source_kind, source_id, idempotency_key, created_by)
             VALUES ('mov-orphan', $1, 'key', 'P-SER', 'SERIAL', 'WAREHOUSE', 'WH-A', 'ADJUSTED', 1, 'SN-BAD-ORPHAN', $2, 'acq-none', $3, 'u')`,
      [T, ACQUISITION_MOVEMENT_SOURCE_KIND, `serializedAssetAcquisition:${serializedAssetDocId("P-SER", "SN-BAD-ORPHAN")}`]);
    await refusedWith(acquire(req("SN-BAD-ORPHAN")), "ACQUIRE_INTEGRITY");
    assert.deepEqual(await facts("SN-BAD-ORPHAN"), { custody: 0, provenance: 0, movements: 1, audits: 0 }, "no custody added on top of it");
  });

  await t.test("CONCURRENT duplicate, same intent: exactly one custody and one movement; the other is REPLAYED", async () => {
    const results = await Promise.allSettled([acquire(req("SN-RACE-1")), acquire(req("SN-RACE-1"))]);
    assert.deepEqual(results.map((r) => r.status), ["fulfilled", "fulfilled"], JSON.stringify(results.map((r) => r.reason?.stack)));
    assert.deepEqual(results.map((r) => r.value.outcome).sort(), ["acquired", "replayed"]);
    assert.deepEqual(await facts("SN-RACE-1"), ONE);
  });

  await t.test("CONCURRENT duplicate, different intent: exactly one custody and one movement; the other is REFUSED", async () => {
    const results = await Promise.allSettled([
      acquire(req("SN-RACE-2", { idempotencyKey: "k-race-2-a" })),
      acquire(req("SN-RACE-2", { idempotencyKey: "k-race-2-b", reason: "LEGACY_MIGRATION" })),
    ]);
    const won = results.filter((r) => r.status === "fulfilled");
    const lost = results.filter((r) => r.status === "rejected");
    assert.equal(won.length, 1);
    assert.equal(won[0].value.outcome, "acquired");
    assert.equal(lost.length, 1);
    assert.ok(lost[0].reason instanceof AcquireOperationError, `a governed refusal, not a raw error: ${lost[0].reason?.stack}`);
    assert.equal(lost[0].reason.code, "ALREADY_EXISTS_CONFLICT");
    assert.deepEqual(await facts("SN-RACE-2"), ONE);
  });

  await t.test("CONCURRENT burst of the same request: still exactly one of everything", async () => {
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => acquire(req("SN-RACE-3"))));
    assert.ok(results.every((r) => r.status === "fulfilled"), JSON.stringify(results.map((r) => r.reason?.message)));
    assert.equal(results.filter((r) => r.value.outcome === "acquired").length, 1);
    assert.deepEqual(await facts("SN-RACE-3"), ONE);
  });
});
