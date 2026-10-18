// THE SYNTHETIC SUPPLIER PURCHASE ORDER FIXTURE LOADER (Firebase exit B3, DECISIONS #B3, OD-B3-1): fenced (offline), then dry-run default,
// apply once, rerun = NO_CHANGES, a conflicting existing order aborts everything, a received order is not "reset" -- against real PostgreSQL.
// Set POLICY_TEST_DATABASE_URL; without it the database half SKIPS.
import { endPoolAndDrain } from "./support/poolTeardown.mjs";
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
const loader = require("../scripts/loadSupplierPoFixture.js");
const { RECEIVABLE_SUPPLIER_PO_STATUSES } = require("../lib/eosOps/supplierPurchaseOrderReceiving.js");
const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");

const ENV = { EOS_ENVIRONMENT: "nonprod", FIXTURE_DB: "postgres://u:p@localhost:5432/d" };
const GOOD = { environment: "platform-sandbox", databaseUrlEnv: "FIXTURE_DB", tenantKey: "t1", operatingCompanyKey: "sample-co", parts: "PART-A,PART-B,PART-C", principalId: "p1" };

test("the invocation is refused before any connection: environment, production, nonprod label, frozen world, named inputs, flags", () => {
  assert.throws(() => loader.assertFixtureInvocation({}, ENV), /--environment is required/);
  assert.throws(() => loader.assertFixtureInvocation({ ...GOOD, environment: "taylor-parts-production" }, ENV), /production/);
  assert.throws(() => loader.assertFixtureInvocation(GOOD, { FIXTURE_DB: ENV.FIXTURE_DB }), /EOS_ENVIRONMENT/);
  assert.throws(() => loader.assertFixtureInvocation({ ...GOOD, environment: "platform-certification" }, ENV), /frozen/);
  for (const k of ["tenantKey", "operatingCompanyKey", "parts", "principalId"]) {
    const { [k]: _omitted, ...rest } = GOOD;
    assert.throws(() => loader.assertFixtureInvocation(rest, ENV), new RegExp(`--${k} is required`));
  }
  assert.throws(() => loader.assertFixtureInvocation({ ...GOOD, parts: "PART-A" }, ENV), /DISTINCT/);
  assert.throws(() => loader.assertFixtureInvocation({ ...GOOD, parts: "PART-A,PART-A" }, ENV), /DISTINCT/);
  assert.throws(() => loader.assertFixtureInvocation({ ...GOOD, parts: "A,B,C,D" }, ENV), /DISTINCT/);
  assert.throws(() => loader.assertFixtureInvocation({ ...GOOD, surprise: "1" }, ENV), /unknown option/);
  assert.throws(() => loader.assertFixtureInvocation({ ...GOOD, apply: "yes" }, ENV), /flag/);
  assert.equal(loader.assertFixtureInvocation(GOOD, ENV).apply, false, "DRY RUN is the default");
  assert.equal(loader.assertFixtureInvocation({ ...GOOD, apply: "true" }, ENV).apply, true);
});

test("the fixture is deterministic, SYNTHETIC/UAT-labelled and multi-line", () => {
  const a = loader.buildFixturePlan("sample-co", ["PART-A", "PART-B", "PART-C"]);
  assert.deepEqual(a, loader.buildFixturePlan("sample-co", ["PART-A", "PART-B", "PART-C"]));
  assert.deepEqual(a.map((o) => [o.id, o.externalPoNumber, o.lines.length, o.label]),
    [["synthetic-uat-spo-sample-co-001", "SYNTHETIC-UAT-001", 2, "SYNTHETIC/UAT"], ["synthetic-uat-spo-sample-co-002", "SYNTHETIC-UAT-002", 3, "SYNTHETIC/UAT"]]);
  assert.equal(loader.buildFixturePlan("sample-co", ["PART-A", "PART-B"])[1].lines.length, 2);
  assert.ok(a.every((o) => RECEIVABLE_SUPPLIER_PO_STATUSES.includes(o.status)), "the loaded status is one the receiving list shows");
});

const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

test("loader on PostgreSQL: dry run writes nothing; apply loads once; rerun is NO_CHANGES; a conflict aborts everything", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `spofx_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let pool;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => {
    await endPoolAndDrain(pool);
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations"], { maxBuffer: 256 * 1024 * 1024,
    cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrlFor(name) }, stdio: "pipe" });
  pool = new pg.Pool({ connectionString: dbUrlFor(name), max: 4 });
  const q = (s, v = []) => pool.query(s, v);
  const repo = new PostgresPolicyRepository(pool);

  await q(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ('t1','t1','T1')`);
  const principalId = await repo.transact({ tenantId: "t1", uid: "uid-fixture" }, async (tx) => {
    const p = await tx.createPrincipal({ externalSubject: "uid-operator", identityProvider: "firebase" });
    await tx.createTenantMembership(p.id);
    return p.id;
  });
  await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id, operating_company_id, status, source, established_by, updated_by) VALUES ('t1','taylor','ACTIVE','f','f','f')`);
  await q(`INSERT INTO eos_policy.tenant_operating_company_keys (tenant_id, operating_company_id, operating_company_key, status, provenance, source, established_by, updated_by)
           VALUES ('t1','taylor','sample-co','ACTIVE','NATIVE','f','f','f')`);
  const part = (id, status = "ACTIVE") => q(
    `INSERT INTO eos_ops.parts (id, tenant_id, created_by, internal_part_number, name, status, stocking_unit, control_type, stocking_class, expiry_tracked, consumable, returnable_core, whole_unit, version, updated_by)
     VALUES ($1,'t1','fixture',$1,$1,$2,'EACH','STANDARD','STOCKED',false,false,false,false,1,'fixture')`, [id, status]);
  await part("PART-A"); await part("PART-B"); await part("PART-C"); await part("PART-OFF", "INACTIVE");

  const base = { tenantKey: "t1", companyKey: "sample-co", partIds: ["PART-A", "PART-B", "PART-C"], principalId, apply: false };
  const counts = async () => ({
    orders: (await q(`SELECT count(*)::int n FROM eos_ops.supplier_purchase_orders`)).rows[0].n,
    lines: (await q(`SELECT count(*)::int n FROM eos_ops.supplier_purchase_order_lines`)).rows[0].n,
    audits: (await q(`SELECT count(*)::int n FROM eos_policy.audit_events WHERE action = $1`, [loader.AUDIT_ACTION])).rows[0].n,
  });
  const refusal = async (fn) => { try { await fn(); } catch (err) { return err; } assert.fail("expected a refusal"); };

  // DRY RUN is the default and writes nothing.
  const dry = await loader.loadSupplierPoFixture(pool, base);
  assert.deepEqual([dry.mode, dry.outcome, dry.wouldInsert.length, dry.inserted.length], ["DRY_RUN", "DRY_RUN", 2, 0]);
  assert.deepEqual(await counts(), { orders: 0, lines: 0, audits: 0 });

  // Refusals leave nothing behind: an inactive Part, an unknown company, an unknown tenant, an unknown principal.
  assert.match((await refusal(() => loader.loadSupplierPoFixture(pool, { ...base, apply: true, partIds: ["PART-A", "PART-OFF"] }))).message, /not ACTIVE/);
  assert.match((await refusal(() => loader.loadSupplierPoFixture(pool, { ...base, apply: true, companyKey: "nope-co" }))).message, /not ACTIVE for this tenant/);
  assert.match((await refusal(() => loader.loadSupplierPoFixture(pool, { ...base, apply: true, tenantKey: "nope" }))).message, /no tenant/);
  assert.match((await refusal(() => loader.loadSupplierPoFixture(pool, { ...base, apply: true, principalId: "nobody" }))).message, /principalId/);
  assert.deepEqual(await counts(), { orders: 0, lines: 0, audits: 0 });

  // APPLY loads both multi-line orders, labelled, with ONE audit event.
  const applied = await loader.loadSupplierPoFixture(pool, { ...base, apply: true });
  assert.deepEqual([applied.outcome, applied.inserted.length, applied.present.length], ["APPLIED", 2, 0]);
  assert.deepEqual(await counts(), { orders: 2, lines: 5, audits: 1 });
  const rows = (await q(`SELECT id, external_po_number, status, version, created_by, operating_company_key FROM eos_ops.supplier_purchase_orders ORDER BY id`)).rows;
  assert.deepEqual(rows.map((r) => [r.id, r.external_po_number, r.status, r.version, r.created_by, r.operating_company_key]),
    [["synthetic-uat-spo-sample-co-001", "SYNTHETIC-UAT-001", "SENT", 0, loader.WRITER, "sample-co"], ["synthetic-uat-spo-sample-co-002", "SYNTHETIC-UAT-002", "SENT", 0, loader.WRITER, "sample-co"]]);
  const audit = (await q(`SELECT actor_uid, after, reason FROM eos_policy.audit_events WHERE action = $1`, [loader.AUDIT_ACTION])).rows[0];
  assert.equal(audit.actor_uid, principalId);
  assert.equal(audit.after.label, "SYNTHETIC/UAT");
  assert.deepEqual(audit.after.inserted, rows.map((r) => r.id));

  // IDEMPOTENT: a rerun inserts nothing and audits nothing -- even after an order has been received (status moved on, not "reset").
  await q(`UPDATE eos_ops.supplier_purchase_orders SET status = 'RECEIVED', version = 2 WHERE id = 'synthetic-uat-spo-sample-co-001'`);
  const again = await loader.loadSupplierPoFixture(pool, { ...base, apply: true });
  assert.deepEqual([again.outcome, again.inserted.length, again.present.length], ["NO_CHANGES", 0, 2]);
  assert.deepEqual(await counts(), { orders: 2, lines: 5, audits: 1 });
  assert.equal((await q(`SELECT status FROM eos_ops.supplier_purchase_orders WHERE id = 'synthetic-uat-spo-sample-co-001'`)).rows[0].status, "RECEIVED");

  // A CONFLICT (same id, different lines) aborts the whole load and overwrites nothing.
  await q(`UPDATE eos_ops.supplier_purchase_order_lines SET ordered_quantity = 99 WHERE purchase_order_id = 'synthetic-uat-spo-sample-co-002' AND line_id = 'L1'`);
  assert.match((await refusal(() => loader.loadSupplierPoFixture(pool, { ...base, apply: true }))).message, /CONFLICT/);
  assert.equal((await q(`SELECT ordered_quantity q FROM eos_ops.supplier_purchase_order_lines WHERE purchase_order_id = 'synthetic-uat-spo-sample-co-002' AND line_id = 'L1'`)).rows[0].q, 99);
  assert.deepEqual(await counts(), { orders: 2, lines: 5, audits: 1 });
});
