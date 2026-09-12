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
import { stepsNewerThan } from "./support/migrationSchema.mjs";

/** This migration's own timestamp prefix -- what "migrations newer than mine" is measured from. */
const MIGRATION_PREFIX = "1759017600000";

const URL = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";

// This suite's own tenant, so it can never disturb another suite's rows.
const TENANT = "tenant-c12-cash";
// A second tenant, so "an application cannot settle another tenant's invoice" is provable rather
// than merely asserted about a tenant id that matches nothing.
const OTHER_TENANT = "tenant-c12-cash-other";
// OPAQUE, and deliberately not a real company name. Nothing in this schema may depend on which
// operating companies a deployment happens to have.
const COMPANY = "oc-alpha";
// A second set of books, for the cross-company refusal. Opaque, like the first.
const OTHER_COMPANY = "oc-beta";

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
  for (const t of [TENANT, OTHER_TENANT]) {
    await query("INSERT INTO eos_policy.tenants (id, key, name) VALUES ($1, $1, $1) ON CONFLICT DO NOTHING", [t]);
  }
  // ════════════ WHY THIS SUITE NOW SEEDS INVOICES ════════════
  //
  // OWNER RULING: Invoice and Payment are one financial bounded context in `eos_finance`, so
  // `payment_applications.invoice_id` is a REAL foreign key rather than an opaque string. An
  // application therefore needs an obligation that exists -- which is the point, and which means
  // these fixtures are no longer free-floating ids.
  //
  // Seeded ONCE and deliberately NOT cleaned between tests: `clean()` truncates only the two
  // financial-fact tables, and an invoice is a stable reference target here, not a fact under test.
  // (The invoice authority's own proofs live in invoiceAuthorityPostgres.test.mjs, under its own
  // tenant.)
  await invoice("inv-1");
  await invoice("inv-2");
  await invoice("inv-3");
  await invoice("inv-eur", { currency: "EUR" });
  await invoice("inv-other-company", { company: OTHER_COMPANY });
  await invoice("inv-other-tenant", { tenantId: OTHER_TENANT });
  prepared = true;
}

// TRUNCATE, not DELETE: both tables refuse row-level DELETE by design (they are append-only), and
// TRUNCATE does not fire row triggers. That the cleanup has to be written this way is itself a
// demonstration of the property under test.
async function clean() {
  await query("TRUNCATE eos_finance.payment_applications, eos_finance.payments");
}

// A real obligation for an application to settle. Every NOT NULL column of the invoice authority is
// supplied; none of them is under test here.
const invoice = (id, over = {}) => query(
  `INSERT INTO eos_finance.invoices
     (id, tenant_id, operating_company_key, invoice_number, account_id, sales_order_id, currency, due_date, issued_by)
   VALUES ($1, $2, $3, $4, 'acct-1', 'so-1', $5, now(), 'principal-1')
   ON CONFLICT (id) DO NOTHING`,
  [id, over.tenantId ?? TENANT, over.company ?? COMPANY, over.number ?? `INV-${id}`, over.currency ?? "USD"],
);

const receipt = (id, amountMinor, over = {}) => query(
  `INSERT INTO eos_finance.payments
     (id, tenant_id, operating_company_key, account_id, currency, amount_minor, received_at, recorded_by)
   VALUES ($1, $2, $3, $4, $5, $6, now(), 'principal-1')`,
  [id, over.tenantId ?? TENANT, over.company ?? COMPANY, over.accountId ?? "acct-1",
    over.currency ?? "USD", amountMinor],
);

const application = (id, paymentId, appliedMinor, over = {}) => query(
  `INSERT INTO eos_finance.payment_applications
     (id, tenant_id, payment_id, invoice_id, currency, applied_amount_minor, created_by)
   VALUES ($1, $2, $3, $4, $5, $6, 'principal-1')`,
  [id, over.tenantId ?? TENANT, paymentId, over.invoiceId ?? "inv-1",
    over.currency ?? "USD", appliedMinor],
);

// ════════════════════ THIS SUITE LEAVES THE DATABASE AS IT FOUND IT ════════════════════
//
// It now seeds real `eos_finance.invoices` rows, because an application settles a real obligation.
// Those rows are NOT this suite's to leave lying around: the Invoice migration's down deliberately
// REFUSES while any invoice exists ("issued invoices are financial records"), so a surviving fixture
// makes every later suite's legitimate migration peel impossible -- and the failure surfaces
// somewhere else entirely, as a stranger's reversibility test reporting a refusal about invoices it
// never created.
//
// Scoped to this suite's own two tenants, never a schema drop: a financial-data suite that drops
// schemas can destroy somebody else's rows if it is ever pointed at the wrong URL.
test.after(async () => {
  if (!URL || !prepared) return;
  await query("TRUNCATE eos_finance.payment_applications, eos_finance.payments");
  await query("DELETE FROM eos_finance.invoices WHERE tenant_id = ANY($1)", [[TENANT, OTHER_TENANT]]);
});

test("the cash-application tables exist in eos_finance, beside the Invoice authority", { skip: SKIP }, async () => {
  await prepare();
  const { rows } = await query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'eos_finance' AND table_name IN ('payments','payment_applications')
      ORDER BY table_name`,
  );
  assert.deepEqual(rows.map((r) => r.table_name), ["payment_applications", "payments"]);

  // ONE bounded context: the obligation and the cash that settles it are in the SAME schema, which
  // is what makes the foreign key below possible at all.
  const invoices = await query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'eos_finance' AND table_name IN ('invoices','invoice_lines') ORDER BY 1`,
  );
  assert.deepEqual(invoices.rows.map((r) => r.table_name), ["invoice_lines", "invoices"]);

  // And NOT in the operational data plane -- see eosOpsPostgres.test.mjs for the full two-sided
  // boundary proof.
  const leaked = await query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'eos_ops' AND table_name IN ('payments','payment_applications','invoices')`,
  );
  assert.deepEqual(leaked.rows, [], "money invariants are not quantity invariants");
});

// ============================ the central claim, in the catalog ============================

test("NO applied/unapplied/outstanding column exists on either table -- the number has nowhere to go stale", { skip: SKIP }, async () => {
  await prepare();
  const { rows } = await query(
    `SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'eos_finance'
        AND table_name IN ('payments','payment_applications')
        AND column_name IN ('applied_minor','unapplied_minor','outstanding_minor','balance_minor')`,
  );
  assert.deepEqual(rows, [], "a stored aggregate writable independently of its rows is a second accounting authority");

  // And the derivation is reachable as a view.
  const views = await query(
    `SELECT table_name FROM information_schema.views
      WHERE table_schema = 'eos_finance' ORDER BY table_name`,
  );
  const names = views.rows.map((r) => r.table_name);
  assert.ok(names.includes("payment_balances"));
  assert.ok(names.includes("invoice_application_totals"));
});

test("payment_balances derives applied and unapplied from the application facts alone", { skip: SKIP }, async () => {
  await prepare();
  await clean();
  await receipt("pay_1", 10000);
  const empty = await query("SELECT * FROM eos_finance.payment_balances WHERE payment_id = 'pay_1'");
  assert.equal(Number(empty.rows[0].applied_minor), 0);
  assert.equal(Number(empty.rows[0].unapplied_minor), 10000, "an unapplied receipt is a legitimate position, not an error");

  await application("app_1", "pay_1", 4000, { invoiceId: "inv-1" });
  await application("app_2", "pay_1", 2500, { invoiceId: "inv-2" });
  const spread = await query("SELECT * FROM eos_finance.payment_balances WHERE payment_id = 'pay_1'");
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
       FROM eos_finance.invoice_application_totals WHERE tenant_id = $1 ORDER BY invoice_id`, [TENANT],
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
    `INSERT INTO eos_finance.payments (id, tenant_id, account_id, currency, amount_minor, received_at, recorded_by)
     VALUES ('pay_x', $1, 'acct-1', 'USD', 100, now(), 'principal-1')`, [TENANT],
  );
  assert.ok(err, "the insert must fail");
  assert.equal(err.code, "23502", "not_null_violation");
  assert.match(err.message, /operating_company_key/);

  // And an empty string is not a company either -- a blank key is a claim nobody made.
  const blank = await refusal(
    `INSERT INTO eos_finance.payments
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
  // Deliberately aimed at a EUR INVOICE, so the invoice-side FK is satisfied and the only thing
  // that can fail is the receipt-side one. Naming a USD invoice here would leave which of the two
  // foreign keys reports the violation up to an ordering Postgres does not specify.
  const err = await refusal(
    `INSERT INTO eos_finance.payment_applications
       (id, tenant_id, payment_id, invoice_id, currency, applied_amount_minor, created_by)
     VALUES ('app_x', $1, 'pay_1', 'inv-eur', 'EUR', 100, 'principal-1')`, [TENANT],
  );
  assert.equal(err?.code, "23503", "foreign_key_violation -- structurally unrepresentable, not merely policed");
  assert.equal(err?.constraint, "payment_application_matches_receipt");
});

// ============================ the invoice is a REAL obligation ============================

test("an application cannot settle an invoice that does not exist", { skip: SKIP }, async () => {
  // ════════════ WHAT THE OWNER RULING CHANGED ════════════
  //
  // `invoice_id` used to be an opaque governed key, on the stated grounds that the Invoice
  // authority had no Postgres home. It has one, in this very schema. So an application now
  // IDENTIFIES an obligation rather than asserting one, and a settlement of nothing is refused by
  // the database instead of by whichever writer remembered to look.
  await prepare();
  await clean();
  await receipt("pay_1", 10000);
  const err = await refusal(
    `INSERT INTO eos_finance.payment_applications
       (id, tenant_id, payment_id, invoice_id, currency, applied_amount_minor, created_by)
     VALUES ('app_x', $1, 'pay_1', 'inv-nonexistent', 'USD', 100, 'principal-1')`, [TENANT],
  );
  assert.ok(err, "the insert must fail");
  // Both doors are shut -- the FK and the trigger's defensive read -- and Postgres does not specify
  // which is reached first. Either sentence is correct; the row does not exist either way.
  assert.match(
    err.message,
    /payment_application_settles_invoice|invoice inv-nonexistent not found/,
    "an application that settles nothing is unapplied cash wearing an allocation's clothes",
  );
  const after = await query("SELECT count(*)::int AS n FROM eos_finance.payment_applications WHERE tenant_id = $1", [TENANT]);
  assert.equal(after.rows[0].n, 0, "the refused row left nothing behind");
});

test("an application cannot settle ANOTHER TENANT'S invoice -- the reference is tenant-scoped", { skip: SKIP }, async () => {
  await prepare();
  await clean();
  await receipt("pay_1", 10000);
  const err = await refusal(
    `INSERT INTO eos_finance.payment_applications
       (id, tenant_id, payment_id, invoice_id, currency, applied_amount_minor, created_by)
     VALUES ('app_x', $1, 'pay_1', 'inv-other-tenant', 'USD', 100, 'principal-1')`, [TENANT],
  );
  assert.ok(err, "tenant isolation is structural here, not a filter a reader must remember");
  assert.match(err.message, /payment_application_settles_invoice|invoice inv-other-tenant not found/);
});

test("USD cash cannot settle a EUR invoice -- the currency travels through the reference", { skip: SKIP }, async () => {
  await prepare();
  await clean();
  await receipt("pay_1", 10000, { currency: "USD" });
  const err = await refusal(
    `INSERT INTO eos_finance.payment_applications
       (id, tenant_id, payment_id, invoice_id, currency, applied_amount_minor, created_by)
     VALUES ('app_x', $1, 'pay_1', 'inv-eur', 'USD', 100, 'principal-1')`, [TENANT],
  );
  assert.equal(err?.code, "23503", "foreign_key_violation");
  assert.equal(err?.constraint, "payment_application_settles_invoice",
    "the receipt FK is satisfied -- it is the INVOICE's currency that does not agree");
});

test("an unapplied receipt is still a first-class position -- no invoice is required", { skip: SKIP }, async () => {
  // The FK constrains applications, never receipts. Money that arrived and has not been allocated
  // is a legitimate financial position, and the ruling did not make it representable only by
  // inventing an invoice for it.
  await prepare();
  await clean();
  await receipt("pay_unapplied", 25000);
  const { rows } = await query(
    "SELECT applied_minor, unapplied_minor, application_count FROM eos_finance.payment_balances WHERE payment_id = 'pay_unapplied'",
  );
  assert.equal(Number(rows[0].applied_minor), 0);
  assert.equal(Number(rows[0].unapplied_minor), 25000);
  assert.equal(Number(rows[0].application_count), 0, "no application row at all -- that IS unapplied cash");
});

test("an invoice cannot be deleted out from under the cash applied to it", { skip: SKIP }, async () => {
  await prepare();
  await clean();
  await receipt("pay_1", 10000);
  await application("app_1", "pay_1", 4000, { invoiceId: "inv-1" });
  const err = await refusal("DELETE FROM eos_finance.invoices WHERE id = 'inv-1'");
  assert.ok(err, "ON DELETE RESTRICT, exactly as invoice_lines already uses");
  assert.equal(err.code, "23503");
});

// ============================ operating-company authority, fail closed ============================

test("cash received into one company's books cannot settle another company's invoice", { skip: SKIP }, async () => {
  // The application carries no company of its own -- a second copy of one fact is the only way two
  // copies can disagree -- so it inherits the RECEIPT's. The invoice FK makes a SECOND company
  // reachable through the same row, and the books that received the cash are the books that may
  // settle the obligation (ruling D-15). Nothing is inferred or reconciled: the two stated
  // authorities must agree, or the write is refused.
  await prepare();
  await clean();
  await receipt("pay_1", 10000, { company: COMPANY });
  const err = await refusal(
    `INSERT INTO eos_finance.payment_applications
       (id, tenant_id, payment_id, invoice_id, currency, applied_amount_minor, created_by)
     VALUES ('app_x', $1, 'pay_1', 'inv-other-company', 'USD', 100, 'principal-1')`, [TENANT],
  );
  assert.ok(err, "a cross-company application must be refused");
  assert.match(err.message, /cross-company application: receipt pay_1 is held by oc-alpha but invoice inv-other-company is on the books of oc-beta/);

  // And the same receipt applies cleanly to an invoice on its OWN books -- the rule refuses the
  // mismatch, it does not refuse applications.
  await application("app_ok", "pay_1", 100, { invoiceId: "inv-1" });
  const balance = await query("SELECT applied_minor FROM eos_finance.payment_balances WHERE payment_id = 'pay_1'");
  assert.equal(Number(balance.rows[0].applied_minor), 100);
});

test("an application cannot reference a receipt that does not exist, or one in another tenant", { skip: SKIP }, async () => {
  await prepare();
  await clean();
  await receipt("pay_1", 10000);
  assert.equal((await refusal(
    `INSERT INTO eos_finance.payment_applications
       (id, tenant_id, payment_id, invoice_id, currency, applied_amount_minor, created_by)
     VALUES ('app_x', $1, 'pay_nonexistent', 'inv-1', 'USD', 100, 'principal-1')`, [TENANT],
  ))?.constraint, "payment_application_matches_receipt");
});

test("an application with no invoice id is refused -- there is no invoice this schema may substitute", { skip: SKIP }, async () => {
  await prepare();
  await clean();
  await receipt("pay_1", 10000);
  assert.equal((await refusal(
    `INSERT INTO eos_finance.payment_applications
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
  const filled = await query("SELECT unapplied_minor FROM eos_finance.payment_balances WHERE payment_id = 'pay_1'");
  assert.equal(Number(filled.rows[0].unapplied_minor), 0);

  const err = await refusal(
    `INSERT INTO eos_finance.payment_applications
       (id, tenant_id, payment_id, invoice_id, currency, applied_amount_minor, created_by)
     VALUES ('app_3', $1, 'pay_1', 'inv-3', 'USD', 1, 'principal-1')`, [TENANT],
  );
  assert.ok(err, "one minor unit past the receipt must fail");
  assert.match(err.message, /over-application: payment pay_1 is applied 10001 but received only 10000/);

  // The refused row left nothing behind.
  const after = await query("SELECT applied_minor FROM eos_finance.payment_balances WHERE payment_id = 'pay_1'");
  assert.equal(Number(after.rows[0].applied_minor), 10000);
});

test("a single application larger than the whole receipt is refused", { skip: SKIP }, async () => {
  await prepare();
  await clean();
  await receipt("pay_1", 500);
  const err = await refusal(
    `INSERT INTO eos_finance.payment_applications
       (id, tenant_id, payment_id, invoice_id, currency, applied_amount_minor, created_by)
     VALUES ('app_1', $1, 'pay_1', 'inv-1', 'USD', 501, 'principal-1')`, [TENANT],
  );
  assert.match(err.message, /over-application/);
});

test("an application's amount cannot be RAISED past the receipt -- nor changed at all", { skip: SKIP }, async () => {
  // ════════════ WHAT THIS TEST USED TO PROVE, AND WHY IT NOW PROVES MORE ════════════
  //
  // It asserted that raising `applied_amount_minor` past the receipt total trips the
  // over-application trigger -- which left the far more dangerous direction, LOWERING it, passing
  // silently. Lowering an application un-applies money while every derived balance stays perfectly
  // consistent with a history that never happened.
  //
  // Append-only now means append-only: no UPDATE of an application is possible in either
  // direction. The old claim is subsumed, not dropped -- the write is still refused, by a rule that
  // does not have to guess which edits were the harmful ones.
  await prepare();
  await clean();
  await receipt("pay_1", 1000);
  await application("app_1", "pay_1", 400);

  const raised = await refusal("UPDATE eos_finance.payment_applications SET applied_amount_minor = 1001 WHERE id = 'app_1'");
  assert.match(raised.message, /payment_applications is append-only/);
  const lowered = await refusal("UPDATE eos_finance.payment_applications SET applied_amount_minor = 1 WHERE id = 'app_1'");
  assert.match(lowered.message, /payment_applications is append-only/,
    "lowering is the dangerous direction, and it was the one that used to pass");

  // Repointing the settled obligation, and re-attributing the cash, are the same class of rewrite.
  const repointed = await refusal("UPDATE eos_finance.payment_applications SET invoice_id = 'inv-2' WHERE id = 'app_1'");
  assert.match(repointed.message, /payment_applications is append-only/,
    "moving cash between invoices with no fact recording that it moved");

  // The fact is untouched by every attempt.
  const after = await query(
    "SELECT invoice_id, applied_amount_minor FROM eos_finance.payment_applications WHERE id = 'app_1'",
  );
  assert.equal(after.rows[0].invoice_id, "inv-1");
  assert.equal(Number(after.rows[0].applied_amount_minor), 400);
});

test("a receipt cannot be reduced below what is applied -- nor edited at all", { skip: SKIP }, async () => {
  // Same strengthening. The narrow rule ("not below the applied total") let a receipt's
  // `account_id` and `operating_company_key` be rewritten freely, re-attributing received cash to
  // another customer or another set of books after the fact -- with the amount untouched, so no
  // balance check anywhere would notice.
  await prepare();
  await clean();
  await receipt("pay_1", 10000);
  await application("app_1", "pay_1", 7000);

  // Reducing the amount trips TWO guards -- the append-only rule and the older
  // `receipt_amount_covers_applications` invariant -- and Postgres fires BEFORE-row triggers in
  // name order, so which sentence comes back is a detail of that ordering rather than a property.
  // Both refusals are correct; the row is unchanged either way. The narrower guard is deliberately
  // RETAINED rather than removed: it costs nothing and still states its invariant if the
  // append-only rule is ever revisited by a later, explicit decision.
  const reduced = await refusal("UPDATE eos_finance.payments SET amount_minor = 6999 WHERE id = 'pay_1'");
  assert.ok(reduced, "the amount must not be editable");
  assert.match(reduced.message, /payments is append-only|cannot be reduced to 6999 -- 7000 is already applied/);

  // These three pass the older guard cleanly (they do not lower the amount) and are refused ONLY by
  // append-only -- which is exactly the hole that existed before: re-attributing received cash to
  // another customer or another set of books, with the amount untouched, so no balance check
  // anywhere would notice.
  for (const [what, sql] of [
    ["the amount, down to exactly the applied total", "UPDATE eos_finance.payments SET amount_minor = 7000 WHERE id = 'pay_1'"],
    ["the customer", "UPDATE eos_finance.payments SET account_id = 'acct-someone-else' WHERE id = 'pay_1'"],
    ["the books", "UPDATE eos_finance.payments SET operating_company_key = 'oc-beta' WHERE id = 'pay_1'"],
  ]) {
    const err = await refusal(sql);
    assert.ok(err, `${what} must not be editable`);
    assert.match(err.message, /payments is append-only/, what);
  }

  // Every stated fact survives.
  const row = await query("SELECT amount_minor, account_id, operating_company_key FROM eos_finance.payments WHERE id = 'pay_1'");
  assert.equal(Number(row.rows[0].amount_minor), 10000);
  assert.equal(row.rows[0].account_id, "acct-1");
  assert.equal(row.rows[0].operating_company_key, COMPANY);
});

test("a zero or negative amount is not a financial fact", { skip: SKIP }, async () => {
  await prepare();
  await clean();
  assert.equal((await refusal(
    `INSERT INTO eos_finance.payments
       (id, tenant_id, operating_company_key, account_id, currency, amount_minor, received_at, recorded_by)
     VALUES ('pay_z', $1, $2, 'acct-1', 'USD', 0, now(), 'principal-1')`, [TENANT, COMPANY],
  ))?.constraint, "payment_amount_positive");

  await receipt("pay_1", 1000);
  assert.equal((await refusal(
    `INSERT INTO eos_finance.payment_applications
       (id, tenant_id, payment_id, invoice_id, currency, applied_amount_minor, created_by)
     VALUES ('app_z', $1, 'pay_1', 'inv-1', 'USD', -100, 'principal-1')`, [TENANT],
  ))?.constraint, "payment_application_amount_positive");
});

// ============================ append-only ============================

test("neither a receipt nor an application can be deleted OR updated -- a correction is a new fact", { skip: SKIP }, async () => {
  // The declaration and the enforcement now agree. A table that refuses DELETE and permits UPDATE
  // is not append-only: its history can be rewritten in place, which is worse than deletion,
  // because a deletion at least leaves a gap somebody can notice.
  await prepare();
  await clean();
  await receipt("pay_1", 1000);
  await application("app_1", "pay_1", 400);

  const app = await refusal("DELETE FROM eos_finance.payment_applications WHERE id = 'app_1'");
  assert.match(app.message, /payment_applications is append-only/);
  assert.match(app.message, /never by delete of an existing one/);
  const pay = await refusal("DELETE FROM eos_finance.payments WHERE id = 'pay_1'");
  assert.match(pay.message, /payments is append-only/);

  const appUpdate = await refusal("UPDATE eos_finance.payment_applications SET created_by = 'someone-else' WHERE id = 'app_1'");
  assert.match(appUpdate.message, /payment_applications is append-only/);
  assert.match(appUpdate.message, /never by update of an existing one/);
  const payUpdate = await refusal("UPDATE eos_finance.payments SET external_ref = 'CHK-9999' WHERE id = 'pay_1'");
  assert.match(payUpdate.message, /payments is append-only/,
    "refused outright rather than column-by-column -- an allow-list is a standing invitation to grow");

  // Both facts survive every attempt.
  const balance = await query("SELECT applied_minor FROM eos_finance.payment_balances WHERE payment_id = 'pay_1'");
  assert.equal(Number(balance.rows[0].applied_minor), 400);

  // A CORRECTION IS A NEW FACT, and that path is open: a further application allocates more of the
  // same receipt without editing anything that already happened.
  await application("app_2", "pay_1", 300, { invoiceId: "inv-2" });
  const corrected = await query("SELECT applied_minor, application_count FROM eos_finance.payment_balances WHERE payment_id = 'pay_1'");
  assert.equal(Number(corrected.rows[0].applied_minor), 700);
  assert.equal(Number(corrected.rows[0].application_count), 2);
});

// ============================ idempotent replay ============================

test("the same application replayed under one idempotency key is refused, not double-applied", { skip: SKIP }, async () => {
  await prepare();
  await clean();
  await receipt("pay_1", 10000);
  const apply = (id) => query(
    `INSERT INTO eos_finance.payment_applications
       (id, tenant_id, payment_id, invoice_id, currency, applied_amount_minor, idempotency_key, created_by)
     VALUES ($1, $2, 'pay_1', 'inv-1', 'USD', 4000, 'retry-key-1', 'principal-1')`, [id, TENANT],
  );
  await apply("app_1");
  const err = await refusal(
    `INSERT INTO eos_finance.payment_applications
       (id, tenant_id, payment_id, invoice_id, currency, applied_amount_minor, idempotency_key, created_by)
     VALUES ('app_2', $1, 'pay_1', 'inv-1', 'USD', 4000, 'retry-key-1', 'principal-1')`, [TENANT],
  );
  assert.equal(err?.code, "23505", "unique_violation");

  // NULL keys do not collide with each other -- the index is partial.
  await application("app_3", "pay_1", 1000);
  await application("app_4", "pay_1", 1000);
  const balance = await query("SELECT applied_minor FROM eos_finance.payment_balances WHERE payment_id = 'pay_1'");
  assert.equal(Number(balance.rows[0].applied_minor), 6000);
});

// ============================ the migration is reversible ============================

test("the down migration removes every object this migration created, and up restores them", { skip: SKIP }, async () => {
  await prepare();
  await clean();
  // ════════════ THE UNWIND DEPTH IS DERIVED, NEVER A LITERAL ════════════
  //
  // A bare `down` reverses whichever migration is currently NEWEST -- this lane's own only while
  // this lane's own is last, which is true on a branch cut from main and false the moment a sibling
  // lands. Peel exactly the migrations that sort after this one first, so the precondition holds
  // however many later migrations exist. Zero of them today; the point is that it stays correct at
  // the next integration without anybody editing this number.
  const newer = stepsNewerThan(MIGRATION_PREFIX);
  if (newer > 0) migrate(["down", String(newer)]);
  migrate(["down"]);
  const gone = await query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'eos_finance' AND table_name IN ('payments','payment_applications')`,
  );
  assert.deepEqual(gone.rows, []);
  const fns = await query(
    `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'eos_finance'
        AND p.proname IN ('assert_application_within_receipt','assert_receipt_covers_applications','refuse_financial_fact_mutation')`,
  );
  assert.deepEqual(fns.rows, [], "the trigger functions go with the tables");

  // eos_finance itself SURVIVES this migration's reversal: it was established by the Invoice
  // migration, which has not been reversed, and the Invoice authority is still standing in it.
  const invoicesStanding = await query(
    `SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_schema = 'eos_finance' AND table_name IN ('invoices','invoice_lines')`,
  );
  assert.equal(invoicesStanding.rows[0].n, 2,
    "reversing the cash-application migration must not take the Invoice authority with it");

  migrate(["up"]);
  const back = await query(
    `SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_schema = 'eos_finance' AND table_name IN ('payments','payment_applications')`,
  );
  assert.equal(back.rows[0].n, 2);
  // The fixtures this suite seeds were dropped with the tables; re-seed for any later run.
  prepared = false;
  await prepare();
});
