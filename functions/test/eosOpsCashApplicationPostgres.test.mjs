// EOS Operational Data Plane — migration 008's STRUCTURAL proofs, against a real database.
//
// ════════════════════ THESE RUN AGAINST A REAL DATABASE ════════════════════
//
// Same contract as eosOpsPostgres.test.mjs and eosOpsOperatingCompanyCustodyPostgres.test.mjs: set
// POLICY_TEST_DATABASE_URL to run; without it this SKIPS rather than fails.
//
// UNLIKE those suites, this file does NOT reset the schema. It runs `node-pg-migrate up` (a no-op
// when the schema is already current) and scopes every row it writes to its own tenant, which it
// TRUNCATEs between tests. Two reasons, and the second is the load-bearing one:
//
//   1. adminPolicyPostgres.test.mjs's "every suite that resets the schema is covered by that one
//      command" test requires any file containing a schema-drop to be registered in
//      package.json's `test:adminPolicyPostgres`. package.json is a shared file this lane does not
//      edit, so this suite is built not to need that registration. (The registration it WOULD need
//      is recorded in docs/handoff/w1-c12-registrations.md regardless.)
//   2. A financial-data suite that drops schemas is a financial-data suite that can destroy
//      somebody else's rows if it is ever pointed at the wrong URL. Scoped cleanup cannot.
//
// The claims proved here are STRUCTURAL on purpose. "The command will check the total first" is not
// a property; "the database refuses the row" is.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import pg from "pg";

const URL = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";

// This suite's own tenant, so it can never disturb another suite's rows.
const TENANT = "tenant-c12-cash";
// OPAQUE, and deliberately not a real company name. Nothing in this schema may depend on which
// operating companies a deployment happens to have.
const COMPANY = "oc-alpha";

function migrate(args) {
  return execFileSync(process.execPath, [
    "node_modules/node-pg-migrate/bin/node-pg-migrate.js", ...args, "--migrations-dir", "migrations",
  ], { env: { ...process.env, DATABASE_URL: URL }, encoding: "utf8", stdio: "pipe" });
}

async function query(text, values = []) {
  const client = new pg.Client({ connectionString: URL });
  await client.connect();
  try { return await client.query(text, values); } finally { await client.end(); }
}

/** The error a statement raised, or null if it unexpectedly succeeded. */
async function refusal(text, values = []) {
  try {
    await query(text, values);
    return null;
  } catch (err) {
    return err;
  }
}

let prepared = false;
async function prepare() {
  if (prepared) return;
  migrate(["up"]);
  await query("INSERT INTO eos_policy.tenants (id, key, name) VALUES ($1, $1, $1) ON CONFLICT DO NOTHING", [TENANT]);
  prepared = true;
}

// TRUNCATE, not DELETE: both tables refuse row-level DELETE by design (they are append-only), and
// TRUNCATE does not fire row triggers. That the cleanup has to be written this way is itself a
// demonstration of the property under test.
async function clean() {
  await query("TRUNCATE eos_ops.payment_applications, eos_ops.payments");
}

const receipt = (id, amountMinor, over = {}) => query(
  `INSERT INTO eos_ops.payments
     (id, tenant_id, operating_company_key, account_id, currency, amount_minor, received_at, recorded_by)
   VALUES ($1, $2, $3, $4, $5, $6, now(), 'principal-1')`,
  [id, over.tenantId ?? TENANT, over.company ?? COMPANY, over.accountId ?? "acct-1",
    over.currency ?? "USD", amountMinor],
);

const application = (id, paymentId, appliedMinor, over = {}) => query(
  `INSERT INTO eos_ops.payment_applications
     (id, tenant_id, payment_id, invoice_id, currency, applied_amount_minor, created_by)
   VALUES ($1, $2, $3, $4, $5, $6, 'principal-1')`,
  [id, over.tenantId ?? TENANT, paymentId, over.invoiceId ?? "inv-1",
    over.currency ?? "USD", appliedMinor],
);

test("migration 008 applies and the cash-application tables exist", { skip: SKIP }, async () => {
  await prepare();
  const { rows } = await query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'eos_ops' AND table_name IN ('payments','payment_applications')
      ORDER BY table_name`,
  );
  assert.deepEqual(rows.map((r) => r.table_name), ["payment_applications", "payments"]);
});

// ============================ the central claim, in the catalog ============================

test("NO applied/unapplied/outstanding column exists on either table -- the number has nowhere to go stale", { skip: SKIP }, async () => {
  await prepare();
  const { rows } = await query(
    `SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'eos_ops'
        AND table_name IN ('payments','payment_applications')
        AND column_name IN ('applied_minor','unapplied_minor','outstanding_minor','balance_minor')`,
  );
  assert.deepEqual(rows, [], "a stored aggregate writable independently of its rows is a second accounting authority");

  // And the derivation is reachable as a view.
  const views = await query(
    `SELECT table_name FROM information_schema.views
      WHERE table_schema = 'eos_ops' ORDER BY table_name`,
  );
  const names = views.rows.map((r) => r.table_name);
  assert.ok(names.includes("payment_balances"));
  assert.ok(names.includes("invoice_application_totals"));
});

test("payment_balances derives applied and unapplied from the application facts alone", { skip: SKIP }, async () => {
  await prepare();
  await clean();
  await receipt("pay_1", 10000);
  const empty = await query("SELECT * FROM eos_ops.payment_balances WHERE payment_id = 'pay_1'");
  assert.equal(Number(empty.rows[0].applied_minor), 0);
  assert.equal(Number(empty.rows[0].unapplied_minor), 10000, "an unapplied receipt is a legitimate position, not an error");

  await application("app_1", "pay_1", 4000, { invoiceId: "inv-1" });
  await application("app_2", "pay_1", 2500, { invoiceId: "inv-2" });
  const spread = await query("SELECT * FROM eos_ops.payment_balances WHERE payment_id = 'pay_1'");
  assert.equal(Number(spread.rows[0].applied_minor), 6500);
  assert.equal(Number(spread.rows[0].unapplied_minor), 3500);
  assert.equal(Number(spread.rows[0].application_count), 2, "ONE receipt across MANY invoices, by construction");
});

test("invoice_application_totals states what this authority applied to an invoice id, per invoice", { skip: SKIP }, async () => {
  await prepare();
  await clean();
  await receipt("pay_1", 10000);
  await receipt("pay_2", 5000);
  await application("app_1", "pay_1", 4000, { invoiceId: "inv-1" });
  await application("app_2", "pay_2", 1500, { invoiceId: "inv-1" });
  await application("app_3", "pay_1", 2000, { invoiceId: "inv-2" });

  const { rows } = await query(
    `SELECT invoice_id, applied_minor, application_count
       FROM eos_ops.invoice_application_totals WHERE tenant_id = $1 ORDER BY invoice_id`, [TENANT],
  );
  // MANY receipts onto ONE invoice, which the Firestore shape also allows but never sums anywhere.
  assert.deepEqual(rows.map((r) => [r.invoice_id, Number(r.applied_minor), Number(r.application_count)]), [
    ["inv-1", 5500, 2],
    ["inv-2", 2000, 1],
  ]);
});

// ============================ the operating-company authority ============================

test("a receipt without an operating company cannot be inserted -- NOT NULL, no default", { skip: SKIP }, async () => {
  await prepare();
  await clean();
  const err = await refusal(
    `INSERT INTO eos_ops.payments (id, tenant_id, account_id, currency, amount_minor, received_at, recorded_by)
     VALUES ('pay_x', $1, 'acct-1', 'USD', 100, now(), 'principal-1')`, [TENANT],
  );
  assert.ok(err, "the insert must fail");
  assert.equal(err.code, "23502", "not_null_violation");
  assert.match(err.message, /operating_company_key/);

  // And an empty string is not a company either -- a blank key is a claim nobody made.
  const blank = await refusal(
    `INSERT INTO eos_ops.payments
       (id, tenant_id, operating_company_key, account_id, currency, amount_minor, received_at, recorded_by)
     VALUES ('pay_y', $1, '   ', 'acct-1', 'USD', 100, now(), 'principal-1')`, [TENANT],
  );
  assert.equal(blank?.constraint, "payment_company_present");
});

// ============================ the composite FK ============================

test("an application cannot claim a currency its receipt does not hold", { skip: SKIP }, async () => {
  await prepare();
  await clean();
  await receipt("pay_1", 10000, { currency: "USD" });
  const err = await refusal(
    `INSERT INTO eos_ops.payment_applications
       (id, tenant_id, payment_id, invoice_id, currency, applied_amount_minor, created_by)
     VALUES ('app_x', $1, 'pay_1', 'inv-1', 'EUR', 100, 'principal-1')`, [TENANT],
  );
  assert.equal(err?.code, "23503", "foreign_key_violation -- structurally unrepresentable, not merely policed");
  assert.equal(err?.constraint, "payment_application_matches_receipt");
});

test("an application cannot reference a receipt that does not exist, or one in another tenant", { skip: SKIP }, async () => {
  await prepare();
  await clean();
  await receipt("pay_1", 10000);
  assert.equal((await refusal(
    `INSERT INTO eos_ops.payment_applications
       (id, tenant_id, payment_id, invoice_id, currency, applied_amount_minor, created_by)
     VALUES ('app_x', $1, 'pay_nonexistent', 'inv-1', 'USD', 100, 'principal-1')`, [TENANT],
  ))?.constraint, "payment_application_matches_receipt");
});

test("an application with no invoice id is refused -- there is no invoice this schema may substitute", { skip: SKIP }, async () => {
  await prepare();
  await clean();
  await receipt("pay_1", 10000);
  assert.equal((await refusal(
    `INSERT INTO eos_ops.payment_applications
       (id, tenant_id, payment_id, invoice_id, currency, applied_amount_minor, created_by)
     VALUES ('app_x', $1, 'pay_1', '  ', 'USD', 100, 'principal-1')`, [TENANT],
  ))?.constraint, "payment_application_invoice_present");
});

// ============================ the cross-row invariant ============================

test("applications may fill a receipt exactly, and the one that tips over is refused", { skip: SKIP }, async () => {
  await prepare();
  await clean();
  await receipt("pay_1", 10000);
  await application("app_1", "pay_1", 6000, { invoiceId: "inv-1" });
  await application("app_2", "pay_1", 4000, { invoiceId: "inv-2" });
  const filled = await query("SELECT unapplied_minor FROM eos_ops.payment_balances WHERE payment_id = 'pay_1'");
  assert.equal(Number(filled.rows[0].unapplied_minor), 0);

  const err = await refusal(
    `INSERT INTO eos_ops.payment_applications
       (id, tenant_id, payment_id, invoice_id, currency, applied_amount_minor, created_by)
     VALUES ('app_3', $1, 'pay_1', 'inv-3', 'USD', 1, 'principal-1')`, [TENANT],
  );
  assert.ok(err, "one minor unit past the receipt must fail");
  assert.match(err.message, /over-application: payment pay_1 is applied 10001 but received only 10000/);

  // The refused row left nothing behind.
  const after = await query("SELECT applied_minor FROM eos_ops.payment_balances WHERE payment_id = 'pay_1'");
  assert.equal(Number(after.rows[0].applied_minor), 10000);
});

test("a single application larger than the whole receipt is refused", { skip: SKIP }, async () => {
  await prepare();
  await clean();
  await receipt("pay_1", 500);
  const err = await refusal(
    `INSERT INTO eos_ops.payment_applications
       (id, tenant_id, payment_id, invoice_id, currency, applied_amount_minor, created_by)
     VALUES ('app_1', $1, 'pay_1', 'inv-1', 'USD', 501, 'principal-1')`, [TENANT],
  );
  assert.match(err.message, /over-application/);
});

test("RAISING an application's amount past the receipt is refused too, not only inserting one", { skip: SKIP }, async () => {
  await prepare();
  await clean();
  await receipt("pay_1", 1000);
  await application("app_1", "pay_1", 400);
  const err = await refusal("UPDATE eos_ops.payment_applications SET applied_amount_minor = 1001 WHERE id = 'app_1'");
  assert.match(err.message, /over-application/);
});

test("a receipt cannot be reduced below what is already applied", { skip: SKIP }, async () => {
  await prepare();
  await clean();
  await receipt("pay_1", 10000);
  await application("app_1", "pay_1", 7000);

  const err = await refusal("UPDATE eos_ops.payments SET amount_minor = 6999 WHERE id = 'pay_1'");
  assert.match(err.message, /cannot be reduced to 6999 -- 7000 is already applied/);

  // Down to exactly the applied total is allowed -- that is a receipt fully consumed, not a lie.
  await query("UPDATE eos_ops.payments SET amount_minor = 7000 WHERE id = 'pay_1'");
  const balance = await query("SELECT unapplied_minor FROM eos_ops.payment_balances WHERE payment_id = 'pay_1'");
  assert.equal(Number(balance.rows[0].unapplied_minor), 0);
});

test("a zero or negative amount is not a financial fact", { skip: SKIP }, async () => {
  await prepare();
  await clean();
  assert.equal((await refusal(
    `INSERT INTO eos_ops.payments
       (id, tenant_id, operating_company_key, account_id, currency, amount_minor, received_at, recorded_by)
     VALUES ('pay_z', $1, $2, 'acct-1', 'USD', 0, now(), 'principal-1')`, [TENANT, COMPANY],
  ))?.constraint, "payment_amount_positive");

  await receipt("pay_1", 1000);
  assert.equal((await refusal(
    `INSERT INTO eos_ops.payment_applications
       (id, tenant_id, payment_id, invoice_id, currency, applied_amount_minor, created_by)
     VALUES ('app_z', $1, 'pay_1', 'inv-1', 'USD', -100, 'principal-1')`, [TENANT],
  ))?.constraint, "payment_application_amount_positive");
});

// ============================ append-only ============================

test("neither a receipt nor an application can be deleted -- a correction is a new fact", { skip: SKIP }, async () => {
  await prepare();
  await clean();
  await receipt("pay_1", 1000);
  await application("app_1", "pay_1", 400);

  const app = await refusal("DELETE FROM eos_ops.payment_applications WHERE id = 'app_1'");
  assert.match(app.message, /payment_applications is append-only/);
  const pay = await refusal("DELETE FROM eos_ops.payments WHERE id = 'pay_1'");
  assert.match(pay.message, /payments is append-only/);

  // Both facts survive the attempt.
  const balance = await query("SELECT applied_minor FROM eos_ops.payment_balances WHERE payment_id = 'pay_1'");
  assert.equal(Number(balance.rows[0].applied_minor), 400);
});

// ============================ idempotent replay ============================

test("the same application replayed under one idempotency key is refused, not double-applied", { skip: SKIP }, async () => {
  await prepare();
  await clean();
  await receipt("pay_1", 10000);
  const apply = (id) => query(
    `INSERT INTO eos_ops.payment_applications
       (id, tenant_id, payment_id, invoice_id, currency, applied_amount_minor, idempotency_key, created_by)
     VALUES ($1, $2, 'pay_1', 'inv-1', 'USD', 4000, 'retry-key-1', 'principal-1')`, [id, TENANT],
  );
  await apply("app_1");
  const err = await refusal(
    `INSERT INTO eos_ops.payment_applications
       (id, tenant_id, payment_id, invoice_id, currency, applied_amount_minor, idempotency_key, created_by)
     VALUES ('app_2', $1, 'pay_1', 'inv-1', 'USD', 4000, 'retry-key-1', 'principal-1')`, [TENANT],
  );
  assert.equal(err?.code, "23505", "unique_violation");

  // NULL keys do not collide with each other -- the index is partial.
  await application("app_3", "pay_1", 1000);
  await application("app_4", "pay_1", 1000);
  const balance = await query("SELECT applied_minor FROM eos_ops.payment_balances WHERE payment_id = 'pay_1'");
  assert.equal(Number(balance.rows[0].applied_minor), 6000);
});

// ============================ the migration is reversible ============================

test("the down migration removes every object 008 created, and up restores them", { skip: SKIP }, async () => {
  await prepare();
  await clean();
  migrate(["down"]);
  const gone = await query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'eos_ops' AND table_name IN ('payments','payment_applications')`,
  );
  assert.deepEqual(gone.rows, []);
  const fns = await query(
    `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'eos_ops'
        AND p.proname IN ('assert_application_within_receipt','assert_receipt_covers_applications','refuse_financial_fact_delete')`,
  );
  assert.deepEqual(fns.rows, [], "the trigger functions go with the tables");

  migrate(["up"]);
  const back = await query(
    `SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_schema = 'eos_ops' AND table_name IN ('payments','payment_applications')`,
  );
  assert.equal(back.rows[0].n, 2);
});
