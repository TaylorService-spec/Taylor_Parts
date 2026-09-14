// WAVE C1 against a real postgres:16 -- Commercial schema parity, business numbering and command receipts.
//
// Its OWN database. It stops at migration 021 to create the identity-only commercial rows current nonprod holds (plus
// one whose Account is not in eos_crm), then applies 022 and proves: every verified business fact is representable,
// integrity holds where a value is present, the Account key governs new rows without asserting old ones, numbering is
// tenant/series/UTC-year scoped, concurrency-safe and rollback-safe, and receipts refuse duplicate commands.
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
const { allocateCommercialNumber } = require("../lib/eosCommercial/commercialNumbering.js");
const { createCommercialRecord } = require("../lib/eosCommercial/commercialOwnershipRepository.js");

const DB_NAME = `c1_parity_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const dbUrl = () => {
  const u = new URL(URL_BASE);
  u.pathname = `/${DB_NAME}`;
  return u.toString();
};
const migrate = (...args) =>
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", ...args, "--migrations-dir", "migrations"], {
    cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrl() }, stdio: "pipe",
  });
async function withClient(url, fn) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}
const sha = (s) => createHash("sha256").update(s).digest("hex");

test("commercial schema parity, numbering and receipts, in PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${DB_NAME}`));
  migrate("21");
  const pool = new pg.Pool({ connectionString: dbUrl(), max: 12 });
  t.after(async () => {
    await pool.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`));
  });
  const q = (text, values = []) => pool.query(text, values);
  const code = (c) => (e) => e.code === c;

  // ── the world before 022: the shape current nonprod holds ──
  await q(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ('t1','t1','T1'), ('t2','t2','T2')`);
  await q(`INSERT INTO eos_crm.accounts (id, tenant_id, name, status, created_by, updated_by) VALUES
    ('acct-1','t1','Account One','ACTIVE','seed','seed'), ('acct-2','t2','Account Two','ACTIVE','seed','seed')`);
  for (const [id, tenant] of [["p1", "t1"], ["p2", "t2"]]) {
    await q(`INSERT INTO eos_policy.principals (id, external_subject, identity_provider) VALUES ($1,$1,'proof')`, [id]);
    await q(`INSERT INTO eos_policy.tenant_memberships (id, tenant_id, principal_id) VALUES ($1,$2,$3)`, [`m-${id}`, tenant, id]);
  }
  const spineOpp = await createCommercialRecord(pool, "t1", "seed", { kind: "OPPORTUNITY", recordNumber: "SYN-NP-OPP-0001", accountId: "acct-1", ownerEmployeeId: "e-owner", createdBy: "seed" });
  const spineSa = await createCommercialRecord(pool, "t1", "seed", { kind: "SALES_AGREEMENT", recordNumber: "SYN-NP-SA-0001", accountId: "acct-1", ownerEmployeeId: "e-owner", createdBy: "seed", opportunityId: spineOpp.id });
  const spineSo = await createCommercialRecord(pool, "t1", "seed", { kind: "SALES_ORDER", recordNumber: "SYN-NP-SO-0001", accountId: "acct-1", ownerEmployeeId: "e-owner", operatingCompanyId: "taylor", createdBy: "seed", opportunityId: spineOpp.id, salesAgreementId: spineSa.id });
  // A pre-022 row whose Account was never loaded into eos_crm.
  await q(`INSERT INTO eos_commercial.opportunities (id, tenant_id, opportunity_number, account_id, owner_employee_id, created_by, updated_by)
    VALUES ('opp-legacy','t1','OPP-LEGACY','firestore-only-account','e-owner','legacy','legacy')`);

  await t.test("(25) 022 applies over current-shaped data: nothing invented, nothing asserted retroactively", async () => {
    migrate();
    const applied = (await q(`SELECT name FROM public.pgmigrations ORDER BY run_on, id`)).rows.map((r) => r.name);
    assert.equal(applied.at(-1), "1759449600000_commercial-schema-parity-numbering-receipts");
    assert.ok(!applied.some((n) => n.includes("employee-principal-link-employee-fk")), "(21) the deferred Employee FK ran");
    const opp = (await q(`SELECT stage, sales_channel, outcome, closed_at, expected_value, next_action, credited_salesperson_employee_id, edit_version FROM eos_commercial.opportunities WHERE id = $1`, [spineOpp.id])).rows[0];
    assert.deepEqual(opp, { stage: null, sales_channel: null, outcome: null, closed_at: null, expected_value: null, next_action: null, credited_salesperson_employee_id: null, edit_version: "1" });
    assert.equal((await q(`SELECT state FROM eos_commercial.sales_agreements WHERE id = $1`, [spineSa.id])).rows[0].state, null);
    assert.equal((await q(`SELECT state FROM eos_commercial.sales_orders WHERE id = $1`, [spineSo.id])).rows[0].state, null);
    assert.equal((await q(`SELECT count(*)::int n FROM eos_commercial.opportunities WHERE id = 'opp-legacy'`)).rows[0].n, 1, "the NOT VALID key rejected history");
    const fks = (await q(`SELECT conname, convalidated FROM pg_constraint WHERE conname LIKE '%_account_fk' ORDER BY 1`)).rows;
    assert.deepEqual(fks, [
      { conname: "opportunities_account_fk", convalidated: false },
      { conname: "sales_agreements_account_fk", convalidated: false },
      { conname: "sales_orders_account_fk", convalidated: false },
    ]);
  });

  await t.test("the Account key governs every NEW row, including an Account in another tenant", async () => {
    const insert = (id, tenant, account) => q(`INSERT INTO eos_commercial.opportunities (id, tenant_id, opportunity_number, account_id, owner_employee_id, created_by, updated_by) VALUES ($1,$2,$1,$3,'e','x','x')`, [id, tenant, account]);
    await assert.rejects(insert("opp-unknown-account", "t1", "firestore-only-account"), /opportunities_account_fk/);
    await assert.rejects(insert("opp-foreign-account", "t1", "acct-2"), /opportunities_account_fk/, "(8) an Account of another tenant was accepted");
    await insert("opp-known-account", "t1", "acct-1");
  });

  await t.test("(1) an Opportunity represents every verified business fact, with its lines", async () => {
    await q(`UPDATE eos_commercial.opportunities SET sales_channel='NATIONAL_ACCOUNTS', stage='DECISION', outcome='WON', closed_at=now(),
      need='Replace walk-in freezer', expected_value=18500.50, expected_close_at='2026-10-01T00:00:00Z', next_action='Send revised quote',
      credited_salesperson_employee_id='e-credit', edit_version=edit_version+1, updated_by='p1', updated_at=now() WHERE id=$1`, [spineOpp.id]);
    await q(`INSERT INTO eos_commercial.opportunity_lines (tenant_id, opportunity_id, line_number, kind, ref, qty) VALUES
      ('t1',$1,1,'EQUIPMENT_MODEL','model-a',1), ('t1',$1,2,'PART','part-b',4), ('t1',$1,3,'SERVICE','svc-install',1)`, [spineOpp.id]);
    const row = (await q(`SELECT sales_channel, stage, outcome, need, expected_value::text, next_action, credited_salesperson_employee_id, edit_version FROM eos_commercial.opportunities WHERE id=$1`, [spineOpp.id])).rows[0];
    assert.deepEqual(row, { sales_channel: "NATIONAL_ACCOUNTS", stage: "DECISION", outcome: "WON", need: "Replace walk-in freezer", expected_value: "18500.50", next_action: "Send revised quote", credited_salesperson_employee_id: "e-credit", edit_version: "2" });
    assert.equal((await q(`SELECT count(*)::int n FROM eos_commercial.opportunity_lines WHERE opportunity_id=$1`, [spineOpp.id])).rows[0].n, 3);
    await assert.rejects(q(`UPDATE eos_commercial.opportunities SET outcome=NULL WHERE id=$1`, [spineOpp.id]), /opportunities_closed_exactly_when_decided/);
    await assert.rejects(q(`UPDATE eos_commercial.opportunities SET stage='WON' WHERE id=$1`, [spineOpp.id]), /invalid input value for enum/);
    await assert.rejects(q(`UPDATE eos_commercial.opportunities SET expected_value='NaN' WHERE id=$1`, [spineOpp.id]), /opportunities_expected_value_finite/);
    await assert.rejects(q(`UPDATE eos_commercial.opportunities SET next_action='   ' WHERE id=$1`, [spineOpp.id]), /opportunities_next_action_not_blank/);
    await assert.rejects(q(`UPDATE eos_commercial.opportunities SET edit_version=0 WHERE id=$1`, [spineOpp.id]), /opportunities_edit_version_positive/);
  });

  await t.test("(2) a Sales Agreement represents every verified business fact, with its lines", async () => {
    await q(`UPDATE eos_commercial.sales_agreements SET state='ACCEPTED', currency='USD', credited_salesperson_employee_id='e-credit', location_id='loc-1',
      customer_po='PO-77', is_lease=false, fulfillment_intent='INSTALL', shipping_instructions='Dock B', ship_via='Freight', special_instructions='Call ahead',
      shipping_minor=15000, install_charge_minor=50000, tax_minor=8123, down_payment_minor=100000, trade_in_minor=0, accepted_at=now(), accepted_by='p1' WHERE id=$1`, [spineSa.id]);
    await q(`INSERT INTO eos_commercial.sales_agreement_lines (tenant_id, sales_agreement_id, line_number, kind, ref, business_unit, quantity, unit_price_minor, condition, warranty, estimated_arrival_at) VALUES
      ('t1',$1,1,'EQUIPMENT_MODEL','model-a','EQUIPMENT_SALES',1,1250000,'NEW','5 years','2026-11-01T00:00:00Z'),
      ('t1',$1,2,'SERVICE','svc-install','INSTALLATION',1,NULL,NULL,NULL,NULL)`, [spineSa.id]);
    assert.equal((await q(`SELECT count(*)::int n FROM eos_commercial.sales_agreement_lines WHERE sales_agreement_id=$1`, [spineSa.id])).rows[0].n, 2);
    await assert.rejects(q(`UPDATE eos_commercial.sales_agreements SET accepted_at=NULL WHERE id=$1`, [spineSa.id]), /sales_agreements_accepted_exactly_when_accepted/);
    await assert.rejects(q(`UPDATE eos_commercial.sales_agreements SET currency='EUR' WHERE id=$1`, [spineSa.id]), /sales_agreements_currency_usd/);
    await assert.rejects(q(`UPDATE eos_commercial.sales_agreements SET tax_minor=-1 WHERE id=$1`, [spineSa.id]), /sales_agreements_charges_minor_units/, "(7)");
    await assert.rejects(q(`INSERT INTO eos_commercial.sales_agreements (id, tenant_id, sales_agreement_number, account_id, opportunity_id, owner_employee_id, created_by, updated_by)
      VALUES ('sa-dup','t1','SA-DUP','acct-1',$1,'e','x','x')`, [spineOpp.id]), /sales_agreements_one_per_opportunity/, "a second Agreement for one Opportunity");
  });

  await t.test("(3) a Sales Order represents every verified commercial fact, with its lines", async () => {
    await q(`UPDATE eos_commercial.sales_orders SET state='CONFIRMED', sales_channel='RETAIL', currency='USD', credited_salesperson_employee_id='e-credit',
      booked_at=now(), location_id='loc-1', customer_po='PO-77', notes='Call ahead' WHERE id=$1`, [spineSo.id]);
    await q(`INSERT INTO eos_commercial.sales_order_lines (tenant_id, sales_order_id, line_number, kind, ref, business_unit, ordered_qty, unit_price_minor) VALUES
      ('t1',$1,1,'EQUIPMENT_MODEL','model-a','EQUIPMENT_SALES',1,1250000), ('t1',$1,2,'PART','part-b','PARTS',4,NULL)`, [spineSo.id]);
    assert.equal((await q(`SELECT count(*)::int n FROM eos_commercial.sales_order_lines WHERE sales_order_id=$1`, [spineSo.id])).rows[0].n, 2);
    for (const state of ["IN_FULFILLMENT", "FULFILLED", "CLOSED", "CANCELLED"]) await q(`UPDATE eos_commercial.sales_orders SET state=$2 WHERE id=$1`, [spineSo.id, state]);
    const dup = (number, opp, sa) => q(`INSERT INTO eos_commercial.sales_orders (id, tenant_id, sales_order_number, account_id, opportunity_id, sales_agreement_id, owner_employee_id, operating_company_key, created_by, updated_by)
      VALUES ($1,'t1',$1,'acct-1',$2,$3,'e','taylor','x','x')`, [number, opp, sa]);
    await assert.rejects(dup("SO-DUP-OPP", spineOpp.id, null), /sales_orders_one_per_opportunity/);
    await assert.rejects(dup("SO-DUP-SA", null, spineSa.id), /sales_orders_one_per_agreement/);
  });

  await t.test("(5) D2 execution fields and (4) legacy defects are absent from the schema", async () => {
    const columns = (await q(`SELECT table_name || '.' || column_name AS c FROM information_schema.columns WHERE table_schema='eos_commercial'`)).rows.map((r) => r.c);
    for (const absent of [
      "sales_order_lines.allocated_qty", "sales_order_lines.fulfilled_qty", "sales_order_lines.billed_qty", "sales_orders.fulfillment_readiness",
      "sales_orders.allocated_at", "sales_orders.service_work_order_ids", "sales_orders.operational_blocked", "sales_orders.additional_work_pending",
      "sales_order_lines.selected_serial_ids", "opportunities.name", "opportunities.created_at_millis", "opportunities.updated_at_millis",
      "opportunities.closed_at_millis", "opportunities.sales_order_id", "opportunities.sales_agreement_id", "sales_agreements.sales_order_id",
      "sales_orders.source_opportunity_number", "sales_agreements.subtotal_minor", "sales_agreements.total_minor", "sales_agreements.balance_minor",
      "sales_agreement_lines.extended_minor", "opportunities.accountable_person_source", "sales_agreements.accountable_person_source",
      "sales_orders.accountable_person_source",
    ]) {
      assert.ok(!columns.includes(absent), `${absent} was added`);
    }
    assert.ok(!columns.some((c) => /job_role/.test(c)), "(22) a Job Role column appeared");
  });

  await t.test("(6)(7)(8) line, money and tenant integrity", async () => {
    const line = (tenant, parent, n, qty, price) => q(`INSERT INTO eos_commercial.sales_order_lines (tenant_id, sales_order_id, line_number, kind, ref, business_unit, ordered_qty, unit_price_minor) VALUES ($1,$2,$3,'PART','p','PARTS',$4,$5)`, [tenant, parent, n, qty, price]);
    await assert.rejects(line("t1", spineSo.id, 9, 0, 1), /ordered_qty/);
    await assert.rejects(line("t1", spineSo.id, 9, 1, -5), /unit_price_minor/);
    await assert.rejects(line("t1", spineSo.id, 9, 1, 12.5), /invalid input syntax for type bigint/, "a fractional minor-unit price");
    await assert.rejects(line("t1", spineSo.id, 0, 1, 1), /line_number/);
    await assert.rejects(line("t1", spineSo.id, 1, 1, 1), /sales_order_lines_pkey/, "a duplicate line number");
    await assert.rejects(line("t2", spineSo.id, 9, 1, 1), /sales_order_lines_tenant_id_sales_order_id_fkey/, "a line attached to another tenant's order");
    await assert.rejects(q(`INSERT INTO eos_commercial.opportunity_lines (tenant_id, opportunity_id, line_number, kind, ref, qty) VALUES ('t1',$1,9,'PART',' padded ',1)`, [spineOpp.id]), /ref/);
    await assert.rejects(q(`INSERT INTO eos_commercial.opportunity_lines (tenant_id, opportunity_id, line_number, kind, ref, qty) VALUES ('t1',$1,9,'SERIALIZED','x',1)`, [spineOpp.id]), /invalid input value for enum/);
  });

  const withTx = async (fn) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const out = await fn(client);
      await client.query("COMMIT");
      return out;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  };

  await t.test("(9)(10)(11)(12) numbering: exact formats, tenant-, series- and UTC-year-scoped", async () => {
    const at = new Date("2026-12-31T23:30:00Z");
    const a = await withTx((c) => allocateCommercialNumber(c, "t1", "OPPORTUNITY", at));
    const b = await withTx((c) => allocateCommercialNumber(c, "t1", "OPPORTUNITY", at));
    assert.deepEqual([a.number, b.number], ["OPP-2026-000001", "OPP-2026-000002"]);
    assert.equal((await withTx((c) => allocateCommercialNumber(c, "t1", "SALES_AGREEMENT", at))).number, "SA-2026-000001", "(11) series share a counter");
    assert.equal((await withTx((c) => allocateCommercialNumber(c, "t1", "SALES_ORDER", at))).number, "SO-2026-000001");
    assert.equal((await withTx((c) => allocateCommercialNumber(c, "t2", "OPPORTUNITY", at))).number, "OPP-2026-000001", "(10) tenants share a counter");
    // 23:30 on Dec 31 UTC is 2026 even where local time is already 2027; 00:30 on Jan 1 UTC is 2027.
    assert.equal((await withTx((c) => allocateCommercialNumber(c, "t1", "OPPORTUNITY", new Date("2027-01-01T00:30:00Z")))).number, "OPP-2027-000001", "(12)");
    await q(`UPDATE eos_commercial.number_counters SET last_value = 999999 WHERE tenant_id='t1' AND series='SALES_ORDER' AND year=2026`);
    assert.equal((await withTx((c) => allocateCommercialNumber(c, "t1", "SALES_ORDER", at))).number, "SO-2026-1000000", "no ceiling, exactly like the Firestore formatter");
  });

  await t.test("(13) concurrent allocation in separate transactions never commits a duplicate number", async () => {
    const at = new Date("2030-06-01T00:00:00Z");
    const numbers = await Promise.all(Array.from({ length: 40 }, () => withTx(async (c) => {
      const n = await allocateCommercialNumber(c, "t1", "SALES_ORDER", at);
      await c.query("SELECT pg_sleep(0.005)");
      return n.number;
    })));
    assert.equal(new Set(numbers).size, 40, "a number was handed to two transactions");
    assert.deepEqual([...numbers].sort(), Array.from({ length: 40 }, (_, i) => `SO-2030-${String(i + 1).padStart(6, "0")}`));
  });

  await t.test("(14) a rolled-back transaction leaves no committed counter advancement, even while another waits on it", async () => {
    const at = new Date("2031-01-15T00:00:00Z");
    await withTx((c) => allocateCommercialNumber(c, "t1", "OPPORTUNITY", at));
    const holder = await pool.connect();
    await holder.query("BEGIN");
    const held = await allocateCommercialNumber(holder, "t1", "OPPORTUNITY", at);
    assert.equal(held.number, "OPP-2031-000002");
    const waiter = withTx((c) => allocateCommercialNumber(c, "t1", "OPPORTUNITY", at));
    await new Promise((r) => setTimeout(r, 150));
    await holder.query("ROLLBACK");
    holder.release();
    assert.equal((await waiter).number, "OPP-2031-000002", "the rolled-back number was consumed");
    await assert.rejects(withTx(async (c) => {
      await allocateCommercialNumber(c, "t1", "OPPORTUNITY", at);
      throw new Error("create failed after allocation");
    }), /create failed/);
    assert.equal((await q(`SELECT last_value FROM eos_commercial.number_counters WHERE tenant_id='t1' AND series='OPPORTUNITY' AND year=2031`)).rows[0].last_value, "2");
  });

  await t.test("(15)(16) command receipts: one committed receipt per tenant, principal, operation and key", async () => {
    const receipt = (id, tenant, principal, operation, key) => q(`INSERT INTO eos_commercial.command_receipts (id, tenant_id, principal_id, operation, idempotency_key_hash, target_family, target_id, result)
      VALUES ($1,$2,$3,$4,$5,'opportunity','opp-x','{"replayed":false}')`, [id, tenant, principal, operation, sha(key)]);
    await receipt("r1", "t1", "p1", "opportunity.create", "k1");
    await assert.rejects(receipt("r2", "t1", "p1", "opportunity.create", "k1"), /command_receipts_one_per_key/, "(15) a duplicate command key was accepted");
    await receipt("r3", "t1", "p1", "opportunity.transition", "k1"); // another operation
    await receipt("r4", "t2", "p2", "opportunity.create", "k1"); // another tenant and principal
    await assert.rejects(receipt("r5", "t2", "p1", "opportunity.create", "k9"), /command_receipts_member_fk/, "(16) a principal outside the tenant");
    await assert.rejects(q(`INSERT INTO eos_commercial.command_receipts (id, tenant_id, principal_id, operation, idempotency_key_hash, result) VALUES ('r6','t1','p1','opportunity.create','raw-key','{}')`), /idempotency_key_hash/, "a raw key was stored");
    await assert.rejects(q(`INSERT INTO eos_commercial.command_receipts (id, tenant_id, principal_id, operation, idempotency_key_hash, target_family, result) VALUES ('r7','t1','p1','opportunity.update',$1,'opportunity','{}')`, [sha("k7")]), /command_receipts_target_complete/);
  });

  await t.test("(21) no foreign key onto the Employee authority was introduced", async () => {
    assert.equal((await q(`SELECT count(*)::int n FROM pg_constraint WHERE contype='f' AND confrelid='eos_workforce.employees'::regclass`)).rows[0].n, 0);
  });

  await t.test("the down migration refuses while C1 facts are recorded", async () => {
    await assert.rejects(
      Promise.resolve().then(() => execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "down", "--migrations-dir", "migrations"], { cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrl() }, stdio: "pipe" })),
      (e) => /refuses to drop Commercial schema parity/.test(String(e.stderr ?? e.message)),
    );
  });
});
