// F-1a, over real PostgreSQL -- issue an invoice on EOS (DECISIONS #F-1a; migration 1764700000000). Through the governed transport (/operations/finance):
//   APPLIED     a READY direct-sale package + its receivable -> ONE invoice (INV-YYYY-000001), its lines and the package's tax frozen, amount due == the
//               receivable's originated amount, the receivable's due date set once, ONE audit row; the reads carry the number and issue date.
//   REPLAY      the same key + request writes nothing (no invoice, no number, no audit); the same key with a different request is IDEMPOTENCY_KEY_REUSED;
//               a second invoice for the same package is refused.
//   COMPANY     a foreign-company package reads as nonexistent (identical to a missing one); a non-holder is refused; both before any write.
//   REFUSED     a HELD package (tax not determined) or a superseded one is refused with ZERO trace (no invoice, no counter row, no audit row).
//   NUMBERING   sequential per (company, year), independent between companies and years, fresh tenant/year starts at 000001 (never seeded), no gap and no
//               duplicate under concurrency.
//   DUE DATE    from the customer's governed terms; later needs a reason; earlier refused; with no terms the issuer states date and reason.
//   CASH        settlements stay the only cash record: a settlement applied to the invoiced receivable moves its outstanding; the invoice is unchanged.
//   DATABASE    the database itself refuses an invoice that does not equal its receivable, and a changed receivable due date.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { serviceBaselineTenant } from "./support/serviceBaselineTenant.mjs";
import { assignFinanceCompanies } from "./support/financeCompanyAccess.mjs";

const require = createRequire(import.meta.url);
const fin = require("../lib/eosFinance/financeFoundation.js");
const pkg = require("../lib/eosFinance/billingPackage.js");
const sa = require("../lib/eosCommercial/commands/salesAgreementCommandService.js");
const allocator = require("../lib/eosFinance/invoiceNumberAllocator.js");

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const TENANT = "t-f1a";
const FIN = "/operations/finance";

test("F-1a issue invoice over PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  const { q, admin, person, pool, call } = await serviceBaselineTenant(t, { urlBase: URL_BASE, tenant: TENANT, prefix: "f1a" });
  const one = async (sql, v = []) => (await q(sql, v)).rows[0];
  const count = async (sql, v = []) => Number((await one(sql, v)).n);
  const ok = (r, what = "") => { assert.equal(r.status, 200, `${what} ${JSON.stringify(r.body).slice(0, 600)}`); return r.body.result; };
  const refused = (r, status, code, what = "") => { assert.deepEqual([r.status, r.body.code], [status, code], `${what} ${JSON.stringify(r.body).slice(0, 400)}`); return r.body; };
  const fn = (who, operation, input) => call(who, FIN, operation, input);
  const sys = { tenantId: TENANT, principalId: "finance-system" };
  let sk = 0;
  const key = (k) => `${k}-${++sk}`;
  const YEAR = Number((await one(`SELECT extract(year FROM now() AT TIME ZONE 'UTC')::int AS n`)).n);
  const number = (company, n) => `INV-${YEAR}-${String(n).padStart(6, "0")}`;

  // ── people: Finance (both companies), Finance (Ventana only), and two who must not issue ──
  const ctrl = await person("uid-ctrl", ["controller"], { id: "e-ctrl", name: "Sage Controller" });
  const ctrlV = await person("uid-ctrlv", ["controller"], { id: "e-ctrlv", name: "Vera Ventana-Controller" });
  const salesP = await person("uid-sales", ["salesperson"], { id: "e-sales", name: "Riley Retail" });
  const techP = await person("uid-tech", ["technician"], { id: "e-tech", name: "Finley Tech", technician: true });
  await assignFinanceCompanies({ admin, q, tenant: TENANT }, [ctrl]);
  await assignFinanceCompanies({ admin, q, tenant: TENANT }, [ctrlV], ["ventana"]);

  // ── customers ──
  await q(`INSERT INTO eos_crm.accounts (id, tenant_id, name, status, created_by, updated_by) VALUES ('acct-a',$1,'Harbor Grill','ACTIVE','f','f'),
           ('acct-b',$1,'Other Diner','ACTIVE','f','f'), ('acct-c',$1,'Third Cafe','ACTIVE','f','f')`, [TENANT]);
  await q(`INSERT INTO eos_crm.account_relationship_types (tenant_id, account_id, relationship_type) VALUES ($1,'acct-a','CUSTOMER'), ($1,'acct-b','CUSTOMER'), ($1,'acct-c','CUSTOMER')`, [TENANT]);

  // ── commercial helpers: a direct sale made READY (or HELD) the governed way ──
  await q(`INSERT INTO eos_policy.tenant_sales_channels (tenant_id, sales_channel, status, source, established_by, updated_by) VALUES ($1,'RETAIL','ACTIVE','f','f','f') ON CONFLICT DO NOTHING`, [TENANT]);
  const seller = await person("uid-seller", [], { id: "e-seller", name: "Sam Seller" });
  const sellerActor = { tenantId: TENANT, principalId: seller.principalId, capabilities: new Set(["salesAgreement.create", "salesAgreement.updateDraft", "salesAgreement.accept", "salesOrder.write"]) };
  const deps = { pool, catalog: { async verifyReferences(_db, _t, refs) { return refs.map(() => "FOUND"); } } };
  let gn = 0;
  const directPackage = async ({ account = "acct-a", price = 40000, tax = 0, companyKey = "taylor", determined = true } = {}) => {
    const opp = `opp-f1a-${++gn}`;
    await q(`INSERT INTO eos_commercial.opportunities (id, tenant_id, opportunity_number, account_id, owner_employee_id, sales_channel, stage, operating_company_key,
               credited_salesperson_employee_id, created_by, updated_by) VALUES ($1,$2,$1,$3,'e-seller','RETAIL','DECISION',$4,'e-seller','f','f')`, [opp, TENANT, account, companyKey]);
    const ag = await sa.createSalesAgreement(deps, sellerActor, { idempotencyKey: `sa-${gn}`, opportunityId: opp, ownerEmployeeId: "e-seller", isLease: false,
      taxEvidence: determined ? { status: "DETERMINED", amountMinor: tax, currency: "USD" } : { status: "NOT_DETERMINED" },
      lines: [{ kind: "SERVICE", ref: "SVC-X", quantity: 1, unitPrice: price, businessUnitId: "SERVICE" }] });
    const agreementId = (ag.result ?? ag).salesAgreementId;
    await sa.acceptSalesAgreement(deps, sellerActor, { idempotencyKey: `acc-${gn}`, salesAgreementId: agreementId });
    const so = `so-f1a-${gn}`;
    await q(`INSERT INTO eos_commercial.sales_orders (id, tenant_id, sales_order_number, account_id, owner_employee_id, operating_company_key, state, sales_channel, currency, sales_agreement_id, created_by, updated_by)
             VALUES ($1,$2,$1,$3,'e-seller',$4,'IN_FULFILLMENT','RETAIL','USD',$5,'f','f')`, [so, TENANT, account, companyKey, agreementId]);
    await q(`INSERT INTO eos_commercial.sales_order_lines (tenant_id, sales_order_id, line_number, kind, ref, business_unit, ordered_qty, unit_price_minor) VALUES ($1,$2,1,'SERVICE','SVC-X','INSTALLATION',1,$3)`, [TENANT, so, price]);
    await q(`INSERT INTO eos_commercial.sales_order_fulfillments (id, tenant_id, sales_order_id, line_number, line_kind, line_ref, quantity, source_kind, source_work_order_id, evidence_kind, operating_company_key, operating_company_id, account_id, fulfilled_at, recorded_by)
             VALUES ($1,$2,$3,1,'SERVICE','SVC-X',1,'WORK_ORDER_COMPLETION',$4,'SERVICE_PERFORMED',$5,$5,$6,now(),'f')`, [`ful-${so}`, TENANT, so, `wo-${so}`, companyKey, account]);
    const out = await pkg.prepareBillingPackage(pool, sys, { salesOrderId: so });
    const obligation = (await one(`SELECT id FROM eos_finance.obligations WHERE tenant_id=$1 AND source_record_id=$2 AND kind='RECEIVABLE'`, [TENANT, out.packageId]))?.id ?? null;
    return { so, packageId: out.packageId, status: out.status, obligation };
  };
  /** What a refused command must leave untouched. */
  const trace = async () => ({
    invoices: await count(`SELECT count(*)::int n FROM eos_finance.invoices WHERE tenant_id=$1`, [TENANT]),
    lines: await count(`SELECT count(*)::int n FROM eos_finance.invoice_lines WHERE tenant_id=$1`, [TENANT]),
    counters: await count(`SELECT COALESCE(sum(last_value),0)::int n FROM eos_finance.invoice_number_counters WHERE tenant_id=$1`, [TENANT]),
    counterRows: await count(`SELECT count(*)::int n FROM eos_finance.invoice_number_counters WHERE tenant_id=$1`, [TENANT]),
    audits: await count(`SELECT count(*)::int n FROM eos_policy.audit_events WHERE tenant_id=$1 AND action='finance.invoice.issue'`, [TENANT]),
    dues: await count(`SELECT count(*)::int n FROM eos_finance.obligations WHERE tenant_id=$1 AND due_on IS NOT NULL`, [TENANT]),
  });
  const businessToday = async (company) => (await one(`SELECT to_char(eos_policy.operating_company_business_date($1,$2,now()),'YYYY-MM-DD') d`, [TENANT, company])).d;
  const plusDays = (day, n) => { const [y, m, d] = day.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
  const issue = (who, input) => fn(who, "issueInvoice", { idempotencyKey: key("iss"), ...input });

  await t.test("FRESH: before any issue there is no counter and no invoice (the series is never seeded)", async () => {
    assert.deepEqual(await trace(), { invoices: 0, lines: 0, counters: 0, counterRows: 0, audits: 0, dues: 0 });
  });

  let first;
  await t.test("APPLIED: one invoice, frozen from the package, the package's tax, amount due == the receivable, one audit row", async () => {
    first = await directPackage({ price: 40000, tax: 3200 });
    assert.equal(first.status, "READY");
    assert.ok(first.obligation, "fixture: the READY package opened its receivable");
    const before = await trace();
    const input = { billingPackageId: first.packageId, idempotencyKey: "k-first", dueOn: plusDays(await businessToday("taylor"), 45), dueReason: "Customer pays on a 45 day cycle" };
    const r = ok(await issue(ctrl, input), "issue");
    assert.equal(r.outcome, "issued");
    const inv = r.invoice;
    assert.equal(inv.invoiceNumber, number("taylor", 1), "the first number of a fresh tenant, company and year is 000001");
    assert.equal(inv.accountingReference, null, "the provider's reference is a separate field, never written here");
    assert.deepEqual([inv.subtotalMinor, inv.taxMinor, inv.totalMinor, inv.amountDueMinor, inv.tradeInCreditMinor], ["40000", "3200", "43200", "43200", "0"], "the package's amounts and tax, exactly");
    assert.equal(inv.billingPackageId, first.packageId);
    assert.equal(inv.obligationId, first.obligation);
    const bal = await one(`SELECT originated_minor::text AS o, outstanding_minor::text AS out FROM eos_finance.obligation_balances WHERE tenant_id=$1 AND obligation_id=$2`, [TENANT, first.obligation]);
    assert.equal(bal.o, inv.amountDueMinor, "amount due == what the receivable originated; outstanding is read from the receivable");
    assert.equal(inv.dueBasis, "NO_TERMS_ENTERED", "no governed terms for this customer: the issuer stated date and reason");
    assert.equal((await one(`SELECT to_char(due_on,'YYYY-MM-DD') d FROM eos_finance.obligations WHERE tenant_id=$1 AND id=$2`, [TENANT, first.obligation])).d, inv.dueOn, "aging begins at the invoice's due date");
    const after = await trace();
    assert.deepEqual([after.invoices - before.invoices, after.lines - before.lines, after.counters - before.counters, after.audits - before.audits, after.dues - before.dues], [1, 1, 1, 1, 1]);
    const audit = await one(`SELECT actor_uid, target_kind, target_id, before, after, reason FROM eos_policy.audit_events WHERE tenant_id=$1 AND action='finance.invoice.issue'`, [TENANT]);
    assert.deepEqual([audit.actor_uid, audit.target_kind, audit.target_id, audit.before, audit.reason], [ctrl.principalId, "invoice", inv.id, null, "Customer pays on a 45 day cycle"]);
    assert.equal(audit.after.invoiceNumber, inv.invoiceNumber);
    assert.equal(audit.after.amountDueMinor, "43200");
    // The row carries identity and amounts only: no free text but the governed reason.
    assert.deepEqual(Object.keys(audit.after).filter((k) => /notes|description|instructions/i.test(k)), []);
  });

  await t.test("REPLAY: the same key and request writes nothing; the same key with a different request is refused; a second invoice for the package is refused", async () => {
    const before = await trace();
    const again = ok(await fn(ctrl, "issueInvoice", { billingPackageId: first.packageId, idempotencyKey: "k-first", dueOn: plusDays(await businessToday("taylor"), 45), dueReason: "Customer pays on a 45 day cycle" }), "replay");
    assert.equal(again.outcome, "replayed");
    assert.equal(again.invoice.invoiceNumber, number("taylor", 1));
    assert.deepEqual(await trace(), before, "a replay allocates no number and writes no row or audit");
    refused(await fn(ctrl, "issueInvoice", { billingPackageId: first.packageId, idempotencyKey: "k-first", dueOn: plusDays(await businessToday("taylor"), 50), dueReason: "different" }), 409, "IDEMPOTENCY_KEY_REUSED");
    refused(await issue(ctrl, { billingPackageId: first.packageId, dueOn: plusDays(await businessToday("taylor"), 45), dueReason: "x" }), 409, "INVOICE_ALREADY_ISSUED");
    assert.deepEqual(await trace(), before, "neither refusal left a trace");
  });

  await t.test("COMPANY AND AUTHORITY: a foreign-company package reads as nonexistent; a non-holder is refused; neither writes", async () => {
    const ventanaPkg = await directPackage({ companyKey: "ventana", account: "acct-b", price: 1000 });
    assert.equal(ventanaPkg.status, "READY");
    const before = await trace();
    const foreign = refused(await issue(ctrlV, { billingPackageId: first.packageId, dueOn: plusDays(await businessToday("taylor"), 45), dueReason: "x" }), 404, "BILLING_PACKAGE_NOT_FOUND", "Ventana-only Finance on a Taylor package");
    const missing = refused(await issue(ctrlV, { billingPackageId: "bpk-does-not-exist" }), 404, "BILLING_PACKAGE_NOT_FOUND");
    assert.equal(foreign.message, missing.message, "foreign reads exactly like missing");
    refused(await issue(ctrl, { billingPackageId: "bpk-does-not-exist" }), 404, "BILLING_PACKAGE_NOT_FOUND");
    for (const who of [salesP, techP]) refused(await issue(who, { billingPackageId: ventanaPkg.packageId }), 403, "CAPABILITY_REQUIRED", "a non-holder");
    assert.deepEqual(await trace(), before);
    // The advice the screen reads: Taylor+Ventana for the controller, Ventana only for the other.
    const adv = (r) => Object.fromEntries(ok(r, "access").companies.map((c) => [c.operatingCompanyId, c.actions.issue]));
    assert.deepEqual(adv(await fn(ctrl, "readMyFinanceCompanyAccess", {})), { taylor: true, ventana: true });
    assert.deepEqual(adv(await fn(ctrlV, "readMyFinanceCompanyAccess", {})), { ventana: true });
    // Ventana's own Finance issues Ventana's package; the series is per company (000001 again).
    const v = ok(await issue(ctrlV, { billingPackageId: ventanaPkg.packageId, dueOn: plusDays(await businessToday("ventana"), 30), dueReason: "stated" }), "ventana issue");
    assert.equal(v.invoice.invoiceNumber, number("ventana", 1), "Taylor and Ventana each start at 000001");
  });

  await t.test("REFUSED, ZERO TRACE: unknown tax, a package that is not READY, an unsupported shape", async () => {
    const held = await directPackage({ determined: false, account: "acct-c" });
    assert.equal(held.status, "HELD");
    assert.equal(held.obligation, null);
    const superseded = await directPackage({ account: "acct-c", price: 500 });
    await q(`UPDATE eos_finance.billing_packages SET status='SUPERSEDED', status_changed_at=now() WHERE tenant_id=$1 AND id=$2`, [TENANT, superseded.packageId]);
    const before = await trace();
    refused(await issue(ctrl, { billingPackageId: held.packageId }), 412, "TAX_NOT_DETERMINED", "unknown tax is never zero");
    refused(await issue(ctrl, { billingPackageId: superseded.packageId, dueOn: plusDays(await businessToday("taylor"), 30), dueReason: "x" }), 412, "BILLING_PACKAGE_NOT_READY");
    refused(await issue(ctrl, { billingPackageId: held.packageId, approverId: "someone" }), 400, "FIELD_NOT_ACCEPTED", "there is no approver step");
    assert.deepEqual(await trace(), before, "no invoice, no counter row, no audit row, no due date");
  });

  await t.test("NUMBERING: sequential per company and year, a fresh year starts at 000001 (never seeded), no gap and no duplicate under concurrency", async () => {
    const a = await directPackage({ account: "acct-b", price: 100 });
    const b = await directPackage({ account: "acct-b", price: 200 });
    const due = plusDays(await businessToday("taylor"), 10);
    const results = await Promise.all([issue(ctrl, { billingPackageId: a.packageId, dueOn: due, dueReason: "x" }), issue(ctrl, { billingPackageId: b.packageId, dueOn: due, dueReason: "x" })]);
    const nums = results.map((r) => ok(r, "concurrent").invoice.invoiceNumber).sort();
    assert.deepEqual(nums, [number("taylor", 2), number("taylor", 3)], "no gap, no duplicate: the next two Taylor numbers (so the refusals above consumed none)");
    assert.equal(await count(`SELECT (count(*) - count(DISTINCT (operating_company_key, invoice_number)))::int n FROM eos_finance.invoices WHERE tenant_id=$1`, [TENANT]), 0, "uniqueness: no two invoices of a company share a number");
    // The allocator's year rule on its own transaction: a fresh (company, year) is 000001, then 000002; another year restarts; rolled back so it leaves nothing.
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const n = (d, k = "taylor") => allocator.allocateInvoiceNumber(c, TENANT, k, new Date(d)).then((x) => x.number);
      assert.equal(await n("2031-01-05T00:00:00Z"), "INV-2031-000001");
      assert.equal(await n("2031-12-31T23:59:59Z"), "INV-2031-000002");
      assert.equal(await n("2032-01-01T00:00:00Z"), "INV-2032-000001", "a new UTC year restarts");
      assert.equal(await n("2031-06-01T00:00:00Z", "ventana"), "INV-2031-000001", "another company has its own series");
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
    assert.equal(await count(`SELECT count(*)::int n FROM eos_finance.invoice_number_counters WHERE tenant_id=$1 AND year >= 2031`, [TENANT]), 0, "the probe left no counter behind");
  });

  await t.test("DUE DATE: from the customer's governed terms; later needs a reason; earlier is refused; no terms means the issuer states date and reason", async () => {
    const cp = await fin.ensureExternalCounterparty(pool, sys, "acct-c");
    await fin.setCounterpartyCompanyProfile(pool, sys, { counterpartyId: cp.id, operatingCompanyId: "taylor", paymentTermsNetDays: 30 });
    const today = await businessToday("taylor");
    const p1 = await directPackage({ account: "acct-c", price: 300 });
    const before = await trace();
    refused(await issue(ctrl, { billingPackageId: p1.packageId, dueOn: plusDays(today, 29), dueReason: "earlier" }), 400, "DUE_DATE_EARLIER_THAN_TERMS");
    refused(await issue(ctrl, { billingPackageId: p1.packageId, dueOn: plusDays(today, 40) }), 400, "DUE_REASON_REQUIRED");
    assert.deepEqual(await trace(), before, "the refusals left no trace");
    const extended = ok(await issue(ctrl, { billingPackageId: p1.packageId, dueOn: plusDays(today, 40), dueReason: "Customer requested quarter-end" }), "extended").invoice;
    assert.deepEqual([extended.dueOn, extended.dueBasis, extended.dueReason], [plusDays(today, 40), "TERMS_EXTENDED", "Customer requested quarter-end"]);
    const p2 = await directPackage({ account: "acct-c", price: 400 });
    const byTerms = ok(await issue(ctrl, { billingPackageId: p2.packageId }), "terms").invoice;
    assert.deepEqual([byTerms.dueOn, byTerms.dueBasis, byTerms.dueReason], [plusDays(today, 30), "TERMS", null], "terms alone decide, no reason");
    // No terms (acct-a has none): the issuer must state the date.
    const p3 = await directPackage({ account: "acct-a", price: 500 });
    refused(await issue(ctrl, { billingPackageId: p3.packageId }), 400, "DUE_DATE_REQUIRED");
  });

  await t.test("READS: the number and issue date are on the existing reads; the queue lists only receivables with no invoice", async () => {
    const detail = ok(await fn(ctrl, "readObligation", { obligationId: first.obligation }), "detail");
    assert.equal(detail.invoice.invoiceNumber, number("taylor", 1));
    assert.ok(Number.isFinite(Date.parse(detail.invoice.issuedAt)));
    const listed = ok(await fn(ctrl, "listObligations", { operatingCompanyId: "taylor", kind: "RECEIVABLE" }), "list").items;
    assert.equal(listed.find((o) => o.id === first.obligation).invoice.invoiceNumber, number("taylor", 1));
    const queue = ok(await fn(ctrl, "listObligations", { operatingCompanyId: "taylor", kind: "RECEIVABLE", invoiced: false }), "queue").items;
    assert.ok(queue.length > 0 && queue.every((o) => o.invoice === null), "only receivables with no invoice");
    assert.ok(!queue.some((o) => o.id === first.obligation));
    const done = ok(await fn(ctrl, "listObligations", { operatingCompanyId: "taylor", kind: "RECEIVABLE", invoiced: true }), "invoiced").items;
    assert.ok(done.length > 0 && done.every((o) => o.invoice !== null));
    refused(await fn(ctrl, "listObligations", { operatingCompanyId: "taylor", invoiced: "no" }), 400, "INVOICED_INVALID");
    // A reader outside Ventana never sees Ventana's invoice number.
    const ventanaRows = ok(await fn(ctrl, "listObligations", { operatingCompanyId: "ventana", kind: "RECEIVABLE", invoiced: true }), "ventana").items;
    assert.ok(ventanaRows.length === 1 && ventanaRows[0].invoice.invoiceNumber === number("ventana", 1));
  });

  await t.test("CASH: settlements stay the only cash record -- applying one moves the receivable's outstanding and leaves the invoice as issued", async () => {
    const cp = await fin.ensureExternalCounterparty(pool, sys, "acct-a");
    const s = ok(await fn(ctrl, "recordSettlement", { operatingCompanyId: "taylor", counterparty: { kind: "EXTERNAL_ORGANIZATION", crmAccountId: "acct-a" }, kind: "CUSTOMER_PAYMENT",
      amountMinor: 10000, currency: "USD", sourceReference: "CHK-1", idempotencyKey: key("stl") }), "record").settlement;
    ok(await fn(ctrl, "applySettlement", { settlementId: s.id, applications: [{ obligationId: first.obligation, amountMinor: 10000 }], idempotencyKey: key("app") }), "apply");
    assert.ok(cp);
    const detail = ok(await fn(ctrl, "readObligation", { obligationId: first.obligation }), "detail");
    assert.deepEqual([detail.originatedMinor, detail.settledMinor, detail.outstandingMinor], ["43200", "10000", "33200"]);
    assert.equal(detail.invoice.invoiceNumber, number("taylor", 1), "the invoice is unchanged");
    assert.equal(await count(`SELECT count(*)::int n FROM eos_finance.invoices WHERE tenant_id=$1 AND id=(SELECT id FROM eos_finance.invoices WHERE obligation_id=$2)`, [TENANT, first.obligation]), 1);
  });

  await t.test("DATABASE: an invoice that is not its receivable's amount cannot commit; a receivable's due date cannot be changed once set", async () => {
    const p = await directPackage({ account: "acct-b", price: 700 });
    const ins = async (unit) => {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        await c.query(`INSERT INTO eos_finance.invoices (id, tenant_id, operating_company_key, invoice_number, account_id, sales_order_id, currency, due_date, issued_by,
            obligation_id, billing_package_id, due_basis, due_reason, idempotency_key, request_fingerprint)
          VALUES ('inv-raw', $1, 'taylor', 'INV-9999-000001', 'acct-b', $2, 'USD', now(), 'raw', $3, $4, 'NO_TERMS_ENTERED', 'raw', 'raw-key', 'raw-fp')`, [TENANT, p.so, p.obligation, p.packageId]);
        await c.query(`INSERT INTO eos_finance.invoice_lines (id, tenant_id, invoice_id, sales_order_line_id, line_kind, line_ref, billable_qty, unit_price_minor, tax_minor)
          VALUES ('invl-raw', $1, 'inv-raw', 'x', 'SERVICE', 'SVC-X', 1, $2, 0)`, [TENANT, unit]);
        await c.query("COMMIT");
        return null;
      } catch (e) {
        await c.query("ROLLBACK").catch(() => undefined);
        return e;
      } finally {
        c.release();
      }
    };
    const wrong = await ins(699);
    assert.match(String(wrong?.message), /INVOICE_OBLIGATION_MISMATCH/, "699 != the receivable's 700");
    assert.equal(await count(`SELECT count(*)::int n FROM eos_finance.invoices WHERE tenant_id=$1 AND id='inv-raw'`, [TENANT]), 0);
    const right = await ins(700);
    assert.equal(right, null, "the matching amount commits");
    await q(`DELETE FROM eos_finance.invoice_lines WHERE tenant_id=$1 AND invoice_id='inv-raw'`, [TENANT]);
    await q(`DELETE FROM eos_finance.invoices WHERE tenant_id=$1 AND id='inv-raw'`, [TENANT]);
    // 1:1: a second invoice for an already-invoiced receivable (or package) is refused by the database itself.
    const dup = await pool.connect();
    try {
      await assert.rejects(dup.query(`INSERT INTO eos_finance.invoices (id, tenant_id, operating_company_key, invoice_number, account_id, sales_order_id, currency, due_date, issued_by,
          obligation_id, billing_package_id, due_basis, due_reason, idempotency_key, request_fingerprint)
        VALUES ('inv-dup', $1, 'taylor', 'INV-9999-000002', 'acct-a', $2, 'USD', now(), 'raw', $3, 'bpk-other', 'NO_TERMS_ENTERED', 'raw', 'dup-key', 'dup-fp')`, [TENANT, first.so, first.obligation]),
      (e) => e.code === "23505", "one invoice per receivable");
    } finally {
      dup.release();
    }
    // due_on: set once from NULL (done by issuing); then immutable.
    await assert.rejects(q(`UPDATE eos_finance.obligations SET due_on = due_on + 1 WHERE tenant_id=$1 AND id=$2`, [TENANT, first.obligation]), /OBLIGATION_IMMUTABLE/);
    await assert.rejects(q(`UPDATE eos_finance.obligations SET due_on = NULL WHERE tenant_id=$1 AND id=$2`, [TENANT, first.obligation]), /OBLIGATION_IMMUTABLE/);
  });
});
