// INV-YYYY-###### allocator against real PostgreSQL (Owner ruling 4, preparation only). The counter table is created
// by migration 1764700000000 (F-1a), which must equal the module's own INVOICE_NUMBER_COUNTERS_DDL.
//   * concurrent issues for one company and year serialize and never duplicate;
//   * a rolled-back issuance consumes no number;
//   * option B: each operating company has its own sequence -- two companies can both hold INV-2026-000001, and the
//     existing invoice_number_unique_per_company constraint refuses a second one within a company;
//   * the year rolls over; legacy INV-###### numbers coexist.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import pg from "pg";
import { endPoolAndDrain } from "./support/poolTeardown.mjs";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const a = require("../lib/eosFinance/invoiceNumberAllocator.js");

const dbUrlFor = (name) => { const u = new URL(URL_BASE); u.pathname = `/${name}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

test("invoice number allocator over PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `invnum_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let pool;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => {
    await endPoolAndDrain(pool);
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations"], {
    maxBuffer: 256 * 1024 * 1024, cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrlFor(name) }, stdio: "pipe" });
  pool = new pg.Pool({ connectionString: dbUrlFor(name), max: 8 });
  // F-1a: migration 1764700000000 creates the counter; it must be the module's own DDL (same columns, in order), checked against a scratch copy.
  await pool.query(`CREATE SCHEMA scratch_ddl`);
  await pool.query(a.INVOICE_NUMBER_COUNTERS_DDL.replace("eos_finance.invoice_number_counters", "scratch_ddl.invoice_number_counters"));
  const cols = async (schema) => (await pool.query(`SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'invoice_number_counters' ORDER BY ordinal_position`, [schema])).rows;
  assert.deepEqual(await cols("eos_finance"), await cols("scratch_ddl"), "the migration's counter table equals INVOICE_NUMBER_COUNTERS_DDL");
  await pool.query(`DROP SCHEMA scratch_ddl CASCADE`);
  await pool.query(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ('t1','t1','T1'), ('t2','t2','T2')`);
  const AT = new Date("2026-06-01T12:00:00Z");
  const inTx = async (fn) => {
    const c = await pool.connect();
    try { await c.query("BEGIN"); const r = await fn(c); await c.query("COMMIT"); return r; }
    catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; } finally { c.release(); }
  };
  const issue = (tenant, key, at = AT) => inTx((c) => a.allocateInvoiceNumber(c, tenant, key, at));

  await t.test("sequential issues count up from 000001 per company", async () => {
    assert.equal((await issue("t1", "taylor")).number, "INV-2026-000001");
    assert.equal((await issue("t1", "taylor")).number, "INV-2026-000002");
  });

  await t.test("OPTION B: each operating company has its own sequence; tenants never share one", async () => {
    assert.equal((await issue("t1", "ventana")).number, "INV-2026-000001", "Ventana starts at 1 beside Taylor's 2");
    assert.equal((await issue("t2", "taylor")).number, "INV-2026-000001", "another tenant's Taylor starts at 1");
    assert.equal((await issue("t1", "taylor")).number, "INV-2026-000003");
  });

  await t.test("CONCURRENCY: 25 parallel issues for one company and year are 25 distinct, gap-free numbers", async () => {
    const got = await Promise.all(Array.from({ length: 25 }, () => issue("t1", "conc")));
    const seqs = got.map((g) => g.sequence).sort((x, y) => x - y);
    assert.deepEqual(seqs, Array.from({ length: 25 }, (_, i) => i + 1));
    assert.equal(new Set(got.map((g) => g.number)).size, 25);
  });

  await t.test("the second issuer WAITS on the first's row lock and gets the next value, never the same one", async () => {
    const c1 = await pool.connect(); const c2 = await pool.connect();
    try {
      await c1.query("BEGIN"); await c2.query("BEGIN");
      const first = await a.allocateInvoiceNumber(c1, "t1", "lock", AT);
      let secondDone = false;
      const second = a.allocateInvoiceNumber(c2, "t1", "lock", AT).then((r) => { secondDone = true; return r; });
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(secondDone, false, "blocked while the first transaction holds the counter row");
      await c1.query("COMMIT");
      const s = await second; await c2.query("COMMIT");
      assert.deepEqual([first.number, s.number], ["INV-2026-000001", "INV-2026-000002"]);
    } finally { c1.release(); c2.release(); }
  });

  await t.test("ROLLBACK consumes no number", async () => {
    await assert.rejects(inTx(async (c) => { await a.allocateInvoiceNumber(c, "t1", "rb", AT); throw new Error("issuance failed"); }), /issuance failed/);
    assert.equal((await issue("t1", "rb")).number, "INV-2026-000001", "the aborted increment left with its transaction");
  });

  await t.test("YEAR ROLLOVER starts a new sequence at the UTC year boundary", async () => {
    assert.equal((await issue("t1", "yr", new Date("2026-12-31T23:59:59Z"))).number, "INV-2026-000001");
    assert.equal((await issue("t1", "yr", new Date("2027-01-01T00:00:00Z"))).number, "INV-2027-000001");
    assert.equal((await issue("t1", "yr", new Date("2026-12-31T23:59:59Z"))).number, "INV-2026-000002", "the 2026 counter continues");
  });

  await t.test("the existing per-company constraint is the structural proof; legacy numbers coexist", async () => {
    const insert = (id, key, number) => pool.query(`INSERT INTO eos_finance.invoices (id, tenant_id, operating_company_key, invoice_number, account_id,
        sales_order_id, currency, due_date, issued_by) VALUES ($1,'t1',$2,$3,'acct','so','USD',now(),'test')`, [id, key, number]);
    await insert("i-t", "taylor", "INV-2026-000001");
    await insert("i-v", "ventana", "INV-2026-000001");
    await insert("i-legacy", "taylor", "INV-000001");
    await assert.rejects(insert("i-dup", "taylor", "INV-2026-000001"), (e) => e.code === "23505", "a second INV-2026-000001 within one company is refused");
  });

  await t.test("refuses a blank operating-company key before touching the counter", async () => {
    await assert.rejects(issue("t1", " "), (e) => e.code === "OPERATING_COMPANY_KEY_REQUIRED");
    assert.equal((await pool.query(`SELECT count(*)::int n FROM eos_finance.invoice_number_counters WHERE btrim(operating_company_key) = ''`)).rows[0].n, 0);
  });
});
