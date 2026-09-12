// EOS Operational Data Plane — migration 008's OFFLINE proofs: the AR cash-application authority.
//
// The structural half of these claims (NOT NULL, the composite FK, the over-application trigger,
// append-only, the derived views) is proved against a real postgres:16 in
// eosOpsCashApplicationPostgres.test.mjs. What is proved HERE is what does not need a database to
// be wrong: that the SQL text declares NO stored applied/unapplied/outstanding aggregate anywhere,
// that it invents no currency or company vocabulary, that it models no authority it does not own,
// and that the TypeScript domain layer derives the same balances the views do.
//
// THE CENTRAL CLAIM, stated once so it can be found: a stored aggregate that can be written
// independently of the rows it summarises is a second accounting authority. This migration removes
// the column rather than adding a reconciler for it, and the first test below is what holds that.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  CashApplicationAuthorityError,
  assertApplicationFits,
  deriveAppliedMinor,
  deriveReceiptBalance,
  deriveUnappliedMinor,
  requireGovernedKey,
  requireOperatingCompanyKey,
  requirePositiveMinorUnits,
} from "../lib/eosOps/cashApplicationAuthority.js";

const MIGRATIONS_DIR = "migrations";
const MIGRATION_FILE = "1759017600000_ar-cash-application-authority.sql";
const migrationSource = readFileSync(join(MIGRATIONS_DIR, MIGRATION_FILE), "utf8");

/** SQL with comment lines removed -- a header that DISCUSSES a forbidden shape is not that shape. */
function executableSql(source) {
  return source.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");
}

const SQL = executableSql(migrationSource);

// ============================ the migration is additive and correctly ordered ============================

test("008 is the NEXT migration and edits none of its predecessors", () => {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  // ORDER, NOT POSITION. This asserted that 008 "sorts last". Eleven additive migrations landed
  // together at the W1 integration and only one of them can be last, so every lane that wrote this
  // sentence about its own migration was asserting something that stops being true the moment a
  // sibling lands. The claim that actually matters is ADDITIVE ORDER: this migration is present, and
  // it applies after 007 -- the last migration that existed when it was written -- so it never
  // renumbers or reorders a predecessor. A twelfth migration is then simply a twelfth migration.
  assert.ok(files.includes(MIGRATION_FILE), "the migration is on disk under its own id");
  assert.ok(MIGRATION_FILE > "1757980800000_operating-company-and-serialized-custody.sql",
    "it applies after 007 -- additive, never renumbered in front of a predecessor");
  assert.equal(files[6], "1757980800000_operating-company-and-serialized-custody.sql");
  assert.equal(files[4], "1757808000000_eos-ops-foundation.sql");

  // node-pg-migrate's own format, the same two sections every predecessor uses.
  assert.match(migrationSource, /^-- Up Migration/);
  assert.match(migrationSource, /\n-- Down Migration\n/);

  // Additive: it names no predecessor's table in an ALTER/DROP.
  for (const predecessor of ["inventory_movements", "serialized_custody", "cycle_count_sheets", "cycle_count_lines"]) {
    assert.equal(
      new RegExp(`(ALTER|DROP)\\s+TABLE\\s+(IF EXISTS\\s+)?${predecessor}\\b`).test(SQL), false,
      `008 must not alter or drop ${predecessor}`,
    );
  }
});

// ============================ the central claim: no stored aggregate ============================

test("NO applied / unapplied / outstanding balance is ever declared as a COLUMN", () => {
  // Column declarations only: the views below legitimately PROJECT `applied_minor`, and the whole
  // point is that the projection is the only place the name appears as data.
  const createTables = [...SQL.matchAll(/CREATE TABLE (\w+) \(([\s\S]*?)\n\);/g)];
  assert.equal(createTables.length, 2, "exactly two tables: payments and payment_applications");

  for (const [, table, body] of createTables) {
    for (const banned of ["applied_minor", "unapplied_minor", "outstanding_minor", "balance_minor"]) {
      assert.equal(
        new RegExp(`^\\s+${banned}\\s`, "m").test(body), false,
        `${table} declares a stored ${banned} column -- that is the second accounting authority 008 exists to remove`,
      );
    }
  }

  // And the derivation exists, as a plain view -- not a materialized one, which is a stored
  // aggregate with a refresh schedule.
  assert.match(SQL, /CREATE VIEW payment_balances AS/);
  assert.match(SQL, /CREATE VIEW invoice_application_totals AS/);
  assert.equal(/MATERIALIZED VIEW/i.test(SQL), false, "a materialized view reintroduces the stale aggregate");
});

test("the receipt's applied total is defined in exactly one place -- a SUM over the fact rows", () => {
  const sums = [...SQL.matchAll(/sum\(applied_amount_minor\)/gi)];
  assert.equal(sums.length, 2, "one SUM per view; no third definition of 'how much is applied'");
  assert.match(SQL, /p\.amount_minor - COALESCE\(a\.applied_minor, 0\) AS unapplied_minor/);
});

// ============================ it models no authority it does not own ============================

test("invoice_id IS a real foreign key -- the Invoice authority is in this schema", () => {
  // ════════════ WHAT CHANGED, AND WHY THIS IS NOT A WEAKENING ════════════
  //
  // This test used to assert `REFERENCES invoices` NEVER appears. That assertion was correct for
  // the premise it was written under -- "the Invoice authority's Postgres home does not exist yet"
  // -- and it is the OPPOSITE of correct now that 1758931200000 puts `eos_finance.invoices` in the
  // same integrated database. The rule the old assertion stood for was "model no authority you do
  // not own", not "never use a foreign key". With the authority present and owned by the same
  // bounded context, the honest form of that rule is a real reference.
  //
  // The proof is therefore INVERTED, not deleted, and it is strictly stronger: it now requires the
  // reference, requires it to be tenant-scoped and currency-carrying, and STILL forbids the copy.
  assert.match(
    SQL,
    /CONSTRAINT payment_application_settles_invoice\s*\n\s*FOREIGN KEY \(tenant_id, invoice_id, currency\)\s*\n\s*REFERENCES invoices \(tenant_id, id, currency\) ON DELETE RESTRICT/,
    "an application must identify a REAL invoice, in its own tenant, in its own currency",
  );
  // Still no COPY of another authority's master table -- including invoices, which this migration
  // references but must never create. Creating one here would fork the authority in two.
  assert.equal(/CREATE TABLE (invoices|accounts|companies)\b/i.test(SQL), false, "no copy of another authority's master");
  assert.match(SQL, /invoice_id\s+TEXT NOT NULL,/);
  assert.match(SQL, /account_id\s+TEXT NOT NULL,/);
});

test("account_id stays opaque -- no cross-schema FK was invented off the back of the invoice one", () => {
  // The Account authority is NOT in eos_finance. Referencing it would be exactly the unmaintained
  // copy the invoice ruling removed, reintroduced for a case where the authority really is
  // elsewhere. One ruling, one reference -- not a licence to wire up every id-shaped column.
  assert.equal(/REFERENCES\s+accounts\b/i.test(SQL), false, "no invented accounts table");
  for (const elsewhere of ["sales_orders", "operating_companies", "companies", "locations", "warehouses", "parts"]) {
    assert.equal(new RegExp(`REFERENCES\\s+${elsewhere}\\b`, "i").test(SQL), false,
      `${elsewhere} is not this schema's authority to reference`);
  }
  // The only two REFERENCES clauses this migration may carry, plus the tenant scope every table has.
  const refs = [...SQL.matchAll(/REFERENCES\s+([a-z_.]+)\s*\(/gi)].map((m) => m[1].toLowerCase()).sort();
  assert.deepEqual(refs, ["eos_policy.tenants", "eos_policy.tenants", "invoices", "payments"]);
});

test("the financial tables live in eos_finance, never in eos_ops", () => {
  // OWNER RULING: Invoice and Payment are ONE financial bounded context, and neither belongs in the
  // operational data plane. `eos_ops` invariants are quantity invariants; these are money
  // invariants.
  assert.match(SQL, /SET search_path = eos_finance, public;/);
  assert.equal(/eos_ops/.test(SQL), false, "no financial object may be created in or read from eos_ops");
  // This migration EXTENDS the schema; it does not establish it. The Invoice migration does.
  assert.equal(/CREATE SCHEMA/i.test(SQL), false,
    "1758931200000 establishes eos_finance; a second CREATE SCHEMA here would hide its absence");
});

test("no deployment-specific vocabulary anywhere, and no DEFAULT on the operating company", () => {
  for (const forbidden of [/\btaylor\b/i, /\bventana\b/i]) {
    assert.equal(forbidden.test(migrationSource), false, "the schema must not name one deployment's companies");
  }
  const declaration = SQL.match(/operating_company_key\s+TEXT NOT NULL,/);
  assert.ok(declaration, "operating_company_key is TEXT NOT NULL");
  assert.equal(/operating_company_key[^,]*DEFAULT/i.test(SQL), false, "a DEFAULT would manufacture an authority nobody stated");
  // Opaque, not an enum: an enum here would hard-code a tenant's commercial structure (007's rule).
  assert.equal(/CREATE TYPE ops_operating_company/i.test(SQL), false);
  // And no closed currency vocabulary -- which currencies a deployment transacts in is not this
  // schema's decision.
  assert.equal(/CREATE TYPE \w*currency\w*/i.test(SQL), false);
});

test("an application carries no second copy of the receipt's company or account", () => {
  const match = SQL.match(/CREATE TABLE payment_applications \(([\s\S]*?)\n\);/);
  assert.ok(match, "payment_applications is declared");
  const body = match[1];
  assert.equal(/^\s+operating_company_key\s/m.test(body), false, "the receipt states the company; a copy could only ever disagree");
  assert.equal(/^\s+account_id\s/m.test(body), false, "the receipt states the account; a copy could only ever disagree");
  // currency IS carried, and only because the composite FK makes it structural rather than policed.
  assert.match(body, /^\s+currency\s+TEXT NOT NULL,/m);
  assert.match(
    body,
    /FOREIGN KEY \(tenant_id, payment_id, currency\)\s*\n\s*REFERENCES payments \(tenant_id, id, currency\)/,
  );
});

// ============================ the guards exist, and are the ones claimed ============================

test("the cross-row invariant is enforced by a trigger that locks the receipt row", () => {
  assert.match(SQL, /CREATE FUNCTION assert_application_within_receipt\(\) RETURNS trigger/);
  assert.match(
    SQL,
    /FROM eos_finance\.payments p\s*\n\s*WHERE p\.tenant_id = NEW\.tenant_id AND p\.id = NEW\.payment_id\s*\n\s*FOR UPDATE;/,
    "without FOR UPDATE two concurrent applications both read a stale total and both pass",
  );
  assert.match(SQL, /CREATE TRIGGER payment_application_within_receipt\s*\n\s*AFTER INSERT OR UPDATE ON payment_applications/);
  // The other door on the same invariant.
  assert.match(SQL, /CREATE TRIGGER receipt_amount_covers_applications\s*\n\s*BEFORE UPDATE ON payments/);
});

test("both financial-fact tables are append-only against UPDATE *and* DELETE", () => {
  // ════════════ THE HOLE THIS TEST NOW CLOSES ════════════
  //
  // This asserted `BEFORE DELETE ON` and passed while UPDATE was wide open. A table that refuses
  // DELETE and permits UPDATE is not append-only: its history can be rewritten in place, which is
  // worse than deletion because a deletion at least leaves a gap. `invoice_id` could be repointed
  // at another obligation, `applied_amount_minor` lowered, `account_id` or `operating_company_key`
  // re-attributed -- each leaving every derived balance perfectly correct about a history that
  // never happened. A correction is a NEW financial fact, not a mutation of an old one.
  assert.match(SQL, /CREATE FUNCTION refuse_financial_fact_mutation\(\) RETURNS trigger/);
  assert.equal(/refuse_financial_fact_delete/.test(SQL), false,
    "the DELETE-only name is gone with the DELETE-only behaviour");
  for (const trigger of ["payments_append_only", "payment_applications_append_only"]) {
    assert.match(SQL, new RegExp(`CREATE TRIGGER ${trigger}\\s*\\n\\s*BEFORE UPDATE OR DELETE ON`),
      `${trigger} must fire on UPDATE as well as DELETE`);
  }
  // And no allow-list crept in: the refusal is unconditional, never "except these columns".
  assert.equal(/OF \w+ ON (payments|payment_applications)/.test(SQL), false,
    "a column allow-list would be a standing invitation to decide, one field at a time, which " +
    "financial facts are rewritable");
});

test("an application may not settle an invoice on another company's books", () => {
  // Operating-company authority, explicit and fail closed. The application carries no company of
  // its own (a second copy is the only way two copies can disagree); it inherits the receipt's, and
  // the new invoice FK makes a SECOND company reachable through the same row. The books that
  // received the cash are the books that may settle the obligation.
  assert.match(SQL, /SELECT i\.operating_company_key INTO invoice_company/);
  assert.match(SQL, /IF receipt_company IS NULL OR invoice_company <> receipt_company THEN/);
  // A NULL on either side is refused, never waved through: "we could not tell" must not read as
  // "it matched". The invoice's absence gets its own sentence because the FK and this trigger may
  // be reached in either order.
  assert.match(SQL, /IF invoice_company IS NULL THEN\s*\n\s*RAISE EXCEPTION 'invoice % not found for tenant %'/);
  assert.match(SQL, /cross-company application/);
  // Still no company column ON the application -- the rule is enforced by comparing the two stated
  // authorities, never by storing a third.
  const body = SQL.match(/CREATE TABLE payment_applications \(([\s\S]*?)\n\);/)[1];
  assert.equal(/^\s+operating_company_key\s/m.test(body), false);
});

test("the down migration removes everything the up migration created", () => {
  const down = migrationSource.slice(migrationSource.indexOf("\n-- Down Migration\n"));
  for (const created of ["payment_applications", "payments", "payment_balances", "invoice_application_totals"]) {
    assert.match(down, new RegExp(`DROP (TABLE|VIEW) IF EXISTS ${created};`));
  }
  for (const fn of ["refuse_financial_fact_mutation", "assert_receipt_covers_applications", "assert_application_within_receipt"]) {
    assert.match(down, new RegExp(`DROP FUNCTION IF EXISTS ${fn}\\(\\);`));
  }
  // Referencing side first, or the DROP fails.
  assert.ok(
    down.indexOf("DROP TABLE IF EXISTS payment_applications;") < down.indexOf("DROP TABLE IF EXISTS payments;"),
  );
  // And it does NOT drop eos_finance: this migration EXTENDS a schema 1758931200000 established,
  // and 1758931200000's own down removes it -- after this one, since node-pg-migrate unwinds
  // newest-first. Dropping it here would take the Invoice authority with it.
  assert.equal(/DROP SCHEMA/i.test(down), false, "the schema goes with the migration that created it");
});

// ============================ the domain layer derives what the views derive ============================

const RECEIPT = Object.freeze({
  id: "pay_1", tenantId: "tenant-a", operatingCompanyKey: "oc-alpha",
  accountId: "acct-1", currency: "USD", amountMinor: 10000,
});
const app = (over = {}) => ({
  id: "app_1", tenantId: "tenant-a", paymentId: "pay_1",
  invoiceId: "inv-1", currency: "USD", appliedAmountMinor: 4000, ...over,
});

test("applied is a sum of facts and unapplied is the remainder -- neither is ever stored", () => {
  assert.equal(deriveAppliedMinor([]), 0);
  assert.equal(deriveAppliedMinor([app(), app({ id: "app_2", appliedAmountMinor: 1500 })]), 5500);

  const balance = deriveReceiptBalance(RECEIPT, [app(), app({ id: "app_2", invoiceId: "inv-2", appliedAmountMinor: 1500 })]);
  assert.deepEqual({ ...balance }, {
    paymentId: "pay_1", amountMinor: 10000, appliedMinor: 5500, unappliedMinor: 4500, applicationCount: 2,
  });
  // Positive unapplied cash is a legitimate position, not an error.
  assert.equal(deriveUnappliedMinor(RECEIPT, [app()]), 6000);
  assert.equal(deriveUnappliedMinor(RECEIPT, [app({ appliedAmountMinor: 10000 })]), 0);

  // The module exposes no way to write either number back.
  assert.equal(Object.isFrozen(balance), true);
});

test("one receipt applies across MANY invoices -- the shape the Firestore core could only promise", () => {
  const spread = [
    app({ id: "a1", invoiceId: "inv-1", appliedAmountMinor: 2500 }),
    app({ id: "a2", invoiceId: "inv-2", appliedAmountMinor: 2500 }),
    app({ id: "a3", invoiceId: "inv-3", appliedAmountMinor: 2500 }),
  ];
  assert.equal(deriveReceiptBalance(RECEIPT, spread).appliedMinor, 7500);
  assert.equal(deriveReceiptBalance(RECEIPT, spread).unappliedMinor, 2500);
});

test("an application belonging to another receipt is refused, never quietly summed", () => {
  assert.throws(
    () => deriveReceiptBalance(RECEIPT, [app({ paymentId: "pay_2" })]),
    (e) => e instanceof CashApplicationAuthorityError && e.code === "FOREIGN_APPLICATION",
  );
  assert.throws(
    () => deriveReceiptBalance(RECEIPT, [app({ tenantId: "tenant-b" })]),
    (e) => e.code === "FOREIGN_APPLICATION",
  );
});

test("over-application fails closed before the database has to refuse it", () => {
  assertApplicationFits(RECEIPT, [app()], { currency: "USD", appliedAmountMinor: 6000, invoiceId: "inv-2" });
  assert.throws(
    () => assertApplicationFits(RECEIPT, [app()], { currency: "USD", appliedAmountMinor: 6001, invoiceId: "inv-2" }),
    (e) => e.code === "OVER_APPLICATION",
  );
  assert.throws(
    () => assertApplicationFits(RECEIPT, [], { currency: "EUR", appliedAmountMinor: 1, invoiceId: "inv-2" }),
    (e) => e.code === "CURRENCY_MISMATCH",
  );
});

test("governed keys and minor-unit amounts are validated by SHAPE and never manufactured", () => {
  assert.equal(requireGovernedKey("inv-1", "invoiceId"), "inv-1");
  for (const bad of [undefined, null, "", "   ", 7, {}]) {
    assert.throws(() => requireGovernedKey(bad, "invoiceId"), (e) => e.code === "KEY_REQUIRED");
  }
  assert.equal(requirePositiveMinorUnits(1, "amountMinor"), 1);
  for (const bad of [0, -1, 1.5, "100", NaN, Number.MAX_SAFE_INTEGER + 2]) {
    assert.throws(() => requirePositiveMinorUnits(bad, "amountMinor"), (e) => e.code === "AMOUNT_INVALID");
  }
  // Re-exported, not re-implemented: one operating-company rule for the whole EOS operational/financial layer.
  assert.equal(requireOperatingCompanyKey("oc-alpha"), "oc-alpha");
  assert.throws(() => requireOperatingCompanyKey(""), /never defaulted, inferred or manufactured/);
});

test("the module stores nothing and reaches nothing -- no pg, no Firestore, no clock", () => {
  const source = readFileSync("src/eosOps/cashApplicationAuthority.ts", "utf8");
  for (const forbidden of [/from "pg"/, /firebase-admin/, /getFirestore/, /Date\.now\(/, /new Date\(/]) {
    assert.equal(forbidden.test(source), false, `${forbidden} has no place in a pure derivation module`);
  }
});
