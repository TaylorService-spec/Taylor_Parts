// EOS Operational Data Plane — migration 008's STRUCTURAL proofs: the invoice authority, and the
// header aggregate it makes impossible.
//
// ════════════════════ THESE RUN AGAINST A REAL DATABASE ════════════════════
//
// Same contract as eosOpsPostgres.test.mjs: set POLICY_TEST_DATABASE_URL to run; without it this
// SKIPS rather than fails.
//
// THIS SUITE DOES NOT RESET THE SCHEMA. It migrates UP (idempotent — node-pg-migrate tracks
// applied migrations) and cleans only its OWN rows. That is deliberate: the two suites that do
// reset it are serialized by one registered npm command, and a third resetter that is not in that
// command would race them. See adminPolicyPostgres.test.mjs's "every suite that resets the schema
// is covered by that one command".
//
// ════════════════════ WHAT IS PROVED HERE, AND WHY IT IS STRUCTURAL ════════════════════
//
// "The writers will compute the total correctly" is not a property. "The database refuses to let a
// writer state a total at all" is. Migration 008 removes the header aggregate and generates the
// line arithmetic, so these assert what the SQL boundary itself refuses — not what a command
// remembers to check.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import pg from "pg";
import { insertIssuedInvoice, readInvoiceTotals, readAccountInvoiceTotals, readInvoiceLineAmounts, reconcileMigratedInvoice }
  from "../lib/eosOps/invoiceAuthority.js";
import { deriveInvoiceLineAmounts, sumInvoiceLineAmounts, reconcileInvoiceTotalsAgainstLines }
  from "../lib/eosOps/invoiceTotals.js";

const URL = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";

const TENANT = "tenant-invoice";
// OPAQUE, and deliberately not a real company name. Nothing in this schema may depend on which
// operating companies a deployment happens to have.
const COMPANY = "oc-alpha";
const OTHER_COMPANY = "oc-beta";

let pool = null;
function repoPool() {
  pool ??= new pg.Pool({ connectionString: URL, max: 4 });
  return pool;
}

function migrate(args) {
  return execFileSync(process.execPath, [
    "node_modules/node-pg-migrate/bin/node-pg-migrate.js", ...args, "--migrations-dir", "migrations",
  ], { env: { ...process.env, DATABASE_URL: URL }, encoding: "utf8", stdio: "pipe" });
}

const q = (text, values = []) => repoPool().query(text, values);

async function prepare() {
  migrate(["up"]);
  await q("INSERT INTO eos_policy.tenants (id, key, name) VALUES ($1, $1, $1) ON CONFLICT DO NOTHING", [TENANT]);
  await q("DELETE FROM eos_finance.invoice_lines WHERE tenant_id = $1", [TENANT]);
  await q("DELETE FROM eos_finance.invoices      WHERE tenant_id = $1", [TENANT]);
}

const LINES = [
  { salesOrderLineId: "sol-1", kind: "PART", ref: "L1", businessUnitId: "bu-1", billableQty: 3, unitPriceMinor: 1250, discountMinor: 150, taxMinor: 270 },
  { salesOrderLineId: "sol-2", kind: "PART", ref: "L2", billableQty: 1, unitPriceMinor: 9999, taxMinor: 825 },
];

const invoiceInput = (overrides = {}) => ({
  tenantId: TENANT,
  operatingCompanyKey: COMPANY,
  invoiceNumber: `INV-${Math.random().toString(36).slice(2, 10)}`,
  accountId: "acct-1",
  salesOrderId: "so-1",
  currency: "USD",
  dueDate: new Date("2026-01-31T00:00:00Z"),
  issuedBy: "uid-finance",
  lines: LINES,
  ...overrides,
});

test("invoice authority — structural proofs", { skip: SKIP, concurrency: 1 }, async (t) => {
  await prepare();

  await t.test("the header has NO totals columns at all", async () => {
    // The aggregate that could disagree with its lines does not exist to be written.
    const { rows } = await q(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'eos_finance' AND table_name = 'invoices'`,
    );
    const columns = rows.map((r) => r.column_name);
    for (const forbidden of ["subtotal_minor", "discount_minor", "tax_minor", "total_minor", "outstanding_minor", "applied_minor", "state"]) {
      assert.ok(!columns.includes(forbidden), `invoices must not store ${forbidden}`);
    }
  });

  await t.test("line arithmetic is GENERATED — a writer cannot supply it", async () => {
    const { rows } = await q(
      `SELECT column_name, is_generated FROM information_schema.columns
        WHERE table_schema = 'eos_finance' AND table_name = 'invoice_lines'
          AND column_name IN ('subtotal_minor','taxable_base_minor','line_total_minor')
        ORDER BY column_name`,
    );
    assert.equal(rows.length, 3);
    for (const r of rows) assert.equal(r.is_generated, "ALWAYS", `${r.column_name} must be generated`);

    const { invoiceId } = await insertIssuedInvoice(repoPool(), invoiceInput());
    // Postgres refuses the statement outright. This is the guarantee: not "the command core is
    // careful", but "the arithmetic cannot be stated by a caller".
    await assert.rejects(
      q(`UPDATE eos_finance.invoice_lines SET line_total_minor = 1 WHERE invoice_id = $1`, [invoiceId]),
      /generated column|can only be updated to DEFAULT/i,
    );
  });

  await t.test("the invoice total is the view's sum of the lines, and matches the shared derivation", async () => {
    const { invoiceId, totals } = await insertIssuedInvoice(repoPool(), invoiceInput());
    const derived = sumInvoiceLineAmounts(LINES.map((l) => deriveInvoiceLineAmounts(l)));
    assert.equal(totals.lineCount, 2);
    assert.equal(totals.subtotalMinor, derived.subtotalMinor);
    assert.equal(totals.discountMinor, derived.discountMinor);
    assert.equal(totals.taxableBaseMinor, derived.taxableBaseMinor);
    assert.equal(totals.taxMinor, derived.taxMinor);
    assert.equal(totals.totalMinor, derived.totalMinor);

    // And the stored lines, summed, are the same answer — read back from the database, not the input.
    const stored = await readInvoiceLineAmounts(repoPool(), { tenantId: TENANT, invoiceId });
    assert.equal(reconcileInvoiceTotalsAgainstLines(derived, stored).status, "IN_SYNC");
  });

  await t.test("the total follows the lines — deleting one changes it, with nothing to re-maintain", async () => {
    const { invoiceId, totals } = await insertIssuedInvoice(repoPool(), invoiceInput());
    await q(`DELETE FROM eos_finance.invoice_lines WHERE invoice_id = $1 AND sales_order_line_id = 'sol-2'`, [invoiceId]);
    const after = await readInvoiceTotals(repoPool(), { tenantId: TENANT, invoiceId });
    const onlyFirst = sumInvoiceLineAmounts([deriveInvoiceLineAmounts(LINES[0])]);
    assert.equal(after.totals.totalMinor, onlyFirst.totalMinor);
    assert.notEqual(after.totals.totalMinor, totals.totalMinor);
    assert.equal(after.totals.lineCount, 1);
  });

  await t.test("the operating company is required and never defaulted", async () => {
    await assert.rejects(
      q(`INSERT INTO eos_finance.invoices (id, tenant_id, invoice_number, account_id, sales_order_id, currency, due_date, issued_by)
         VALUES ('inv-nocompany', $1, 'INV-X', 'a', 's', 'USD', now(), 'u')`, [TENANT]),
      /operating_company_key/,
      "a row with no operating company must be refused, not given one",
    );
    await assert.rejects(
      insertIssuedInvoice(repoPool(), invoiceInput({ operatingCompanyKey: "  " })),
      /operatingCompanyKey is required/,
    );
  });

  await t.test("the invoice is addressable as a tenant-scoped, currency-carrying reference target", async () => {
    // ════════ WHAT `payment_applications` REFERENCES, AND WHAT IT MUST NOT ════════
    //
    // OWNER RULING: Invoice and Payment are one financial bounded context in `eos_finance`, so an
    // application settles a REAL invoice rather than an opaque string. The FK it uses is composite
    // -- (tenant_id, id, currency) -- which needs this UNIQUE constraint to exist as a target.
    const { rows } = await q(
      `SELECT c.conname,
              -- ::text and ordered BY NAME: attname is the pg "name" type, which the driver hands
              -- back as a raw '{a,b}' string rather than an array, and attnum order is the table's
              -- column order, not the constraint's. The claim here is WHICH columns the constraint
              -- covers, so it is compared as a sorted set.
              (SELECT array_agg(a.attname::text ORDER BY a.attname::text)
                 FROM unnest(c.conkey) k JOIN pg_attribute a
                   ON a.attrelid = c.conrelid AND a.attnum = k) AS cols
         FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'eos_finance' AND t.relname = 'invoices' AND c.conname = 'invoices_currency_identity'`,
    );
    assert.equal(rows.length, 1, "the reference target exists");
    assert.deepEqual(rows[0].cols, ["currency", "id", "tenant_id"]);

    // IDENTITY IS STILL OPAQUE. The constraint above is a uniqueness statement about columns that
    // are already unique; it puts no account, company, tenant, year, owner or location INTO the
    // identity. The primary key is `id` alone and nothing else.
    const pk = await q(
      `SELECT (SELECT array_agg(a.attname::text ORDER BY a.attname::text)
                 FROM unnest(c.conkey) k JOIN pg_attribute a
                   ON a.attrelid = c.conrelid AND a.attnum = k) AS cols
         FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'eos_finance' AND t.relname = 'invoices' AND c.contype = 'p'`,
    );
    assert.deepEqual(pk.rows[0].cols, ["id"], "identity is one opaque minted key, never a composite of business facts");
  });

  await t.test("the invoice number is unique per company, not globally", async () => {
    const number = "INV-SHARED-001";
    await insertIssuedInvoice(repoPool(), invoiceInput({ invoiceNumber: number }));
    await assert.rejects(
      insertIssuedInvoice(repoPool(), invoiceInput({ invoiceNumber: number })),
      /invoice_number_unique_per_company/,
    );
    // A DIFFERENT company may hold the same number: the counter it comes from is per-company
    // (invoiceNumbering.ts keys it `invoices_${companyId}`), so global uniqueness would assert a
    // numbering authority the allocator does not have.
    const other = await insertIssuedInvoice(repoPool(), invoiceInput({ invoiceNumber: number, operatingCompanyKey: OTHER_COMPANY }));
    assert.ok(other.invoiceId);
  });

  await t.test("an invoice with no lines is refused by the repository, since SQL cannot refuse it", async () => {
    await assert.rejects(insertIssuedInvoice(repoPool(), invoiceInput({ lines: [] })), /at least one line/);
  });

  await t.test("header and lines commit together — a failing LINE rolls the header back", async () => {
    const before = (await q(`SELECT count(*)::INT AS n FROM eos_finance.invoices WHERE tenant_id = $1`, [TENANT])).rows[0].n;
    // A second line whose amounts are individually valid safe integers but whose GENERATED
    // subtotal overflows BIGINT. The failure therefore lands on the LINE insert, after the header
    // has already been written inside the same transaction — which is exactly the crash window a
    // header-then-lines write without a transaction would leave open. A surviving header would
    // read through `invoice_totals` as a zero-total invoice: a silent wrong number.
    await assert.rejects(insertIssuedInvoice(repoPool(), invoiceInput({
      accountId: "acct-rollback",
      lines: [
        { ...LINES[0] },
        { salesOrderLineId: "sol-big", kind: "PART", ref: "L3", billableQty: 2000, unitPriceMinor: 9_000_000_000_000_000, taxMinor: 0 },
      ],
    })), /out of range|overflow/i);
    const after = (await q(`SELECT count(*)::INT AS n FROM eos_finance.invoices WHERE tenant_id = $1`, [TENANT])).rows[0].n;
    assert.equal(after, before, "a refused issuance leaves no partial invoice behind");
    assert.equal(
      (await q(`SELECT count(*)::INT AS n FROM eos_finance.invoices WHERE tenant_id = $1 AND account_id = 'acct-rollback'`, [TENANT])).rows[0].n,
      0,
      "no orphan header",
    );
  });

  await t.test("a void is all-or-nothing — no unattributable erasure", async () => {
    const { invoiceId } = await insertIssuedInvoice(repoPool(), invoiceInput());
    await assert.rejects(
      q(`UPDATE eos_finance.invoices SET voided_at = now() WHERE id = $1`, [invoiceId]),
      /invoice_void_is_complete/,
      "a void with no reason and no actor must be refused",
    );
    await q(`UPDATE eos_finance.invoices SET voided_at = now(), void_reason = 'test', voided_by = 'uid-finance' WHERE id = $1`, [invoiceId]);
    const row = await readInvoiceTotals(repoPool(), { tenantId: TENANT, invoiceId });
    assert.equal(row.isVoid, true);
  });

  await t.test("a line's discount may not exceed its own subtotal", async () => {
    const { invoiceId } = await insertIssuedInvoice(repoPool(), invoiceInput());
    await assert.rejects(
      q(`UPDATE eos_finance.invoice_lines SET discount_minor = 9999999 WHERE invoice_id = $1`, [invoiceId]),
      /invoice_line_discount_within_subtotal/,
    );
  });

  await t.test("the account-scoped read is the one scope the deployed read path uses", async () => {
    await q("DELETE FROM eos_finance.invoice_lines WHERE tenant_id = $1", [TENANT]);
    await q("DELETE FROM eos_finance.invoices      WHERE tenant_id = $1", [TENANT]);
    await insertIssuedInvoice(repoPool(), invoiceInput({ accountId: "acct-A" }));
    await insertIssuedInvoice(repoPool(), invoiceInput({ accountId: "acct-A" }));
    await insertIssuedInvoice(repoPool(), invoiceInput({ accountId: "acct-B" }));
    const a = await readAccountInvoiceTotals(repoPool(), { tenantId: TENANT, accountId: "acct-A" });
    assert.equal(a.length, 2);
    for (const row of a) assert.equal(row.accountId, "acct-A");
    assert.equal((await readAccountInvoiceTotals(repoPool(), { tenantId: TENANT, accountId: "acct-B" })).length, 1);
    assert.equal((await readAccountInvoiceTotals(repoPool(), { tenantId: TENANT, accountId: "acct-none" })).length, 0);
  });

  await t.test("migration reconciliation runs against the REAL target rows", async () => {
    const { invoiceId, totals } = await insertIssuedInvoice(repoPool(), invoiceInput({ accountId: "acct-recon" }));
    const sourceLineAmounts = LINES.map((l) => deriveInvoiceLineAmounts(l));
    const fromLines = sumInvoiceLineAmounts(sourceLineAmounts);

    const faithful = reconcileMigratedInvoice({
      invoiceId,
      sourceStoredTotals: fromLines,
      sourceLineAmounts,
      targetTotals: totals,
    });
    assert.equal(faithful.status, "IN_SYNC");
    assert.equal(faithful.sourceInternallyConsistent, true);

    // The same target, against a source whose stored header was already wrong: the copy is still
    // faithful, and the source's own defect is reported separately rather than carried across.
    const inflated = reconcileMigratedInvoice({
      invoiceId,
      sourceStoredTotals: { ...fromLines, totalMinor: fromLines.totalMinor + 1 },
      sourceLineAmounts,
      targetTotals: totals,
    });
    assert.equal(inflated.status, "IN_SYNC");
    assert.equal(inflated.sourceInternallyConsistent, false);
  });

  await q("DELETE FROM eos_finance.invoice_lines WHERE tenant_id = $1", [TENANT]);
  await q("DELETE FROM eos_finance.invoices      WHERE tenant_id = $1", [TENANT]);
  await pool?.end();
  pool = null;
});
