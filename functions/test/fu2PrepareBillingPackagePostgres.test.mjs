// FU-2, over real PostgreSQL -- the governed REBILL trigger and the server-derived ISSUE eligibility (DECISIONS #F-1b addendum; no migration).
// Through the governed transport (/operations/finance):
//   REBILL        an approved VOID retires the order's package; `prepareBillingPackage { salesOrderId, idempotencyKey }` (finance.invoice.issue -- the key issuing uses) prepares a NEW
//                 package version with a NEW receivable, which issues under a NEW invoice number; the voided invoice keeps its number. The read says which voided invoices can be rebilled.
//   AUTHORITY     a non-holder is refused; a foreign-company order reads exactly like a missing one; an order not ELIGIBLE in full is refused; every refusal leaves ZERO trace.
//   REPLAY        the same key returns the recorded package and writes nothing; the same key for another order is IDEMPOTENCY_KEY_REUSED; ONE audit row per applied command.
//   CONCURRENCY   two prepares of one voided order give ONE new package version.
//   ISSUABLE      every receivable the register lists carries `issuable`; wherever it says false, issueInvoice refuses with exactly its reason (a financed sale included), and wherever
//                 it says true, issueInvoice issues. The predicate and the refusal never disagree.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { serviceBaselineTenant } from "./support/serviceBaselineTenant.mjs";
import { assignFinanceCompanies } from "./support/financeCompanyAccess.mjs";

const require = createRequire(import.meta.url);
const pkg = require("../lib/eosFinance/billingPackage.js");
const sa = require("../lib/eosCommercial/commands/salesAgreementCommandService.js");
const financed = require("../lib/eosFinance/financedSale.js");

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const TENANT = "t-fu2";
const FIN = "/operations/finance";

test("FU-2 rebill trigger and Issue eligibility over PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  const { q, admin, person, pool, call } = await serviceBaselineTenant(t, { urlBase: URL_BASE, tenant: TENANT, prefix: "fu2" });
  const one = async (sql, v = []) => (await q(sql, v)).rows[0];
  const count = async (sql, v = []) => Number((await one(sql, v)).n);
  const ok = (r, what = "") => { assert.equal(r.status, 200, `${what} ${JSON.stringify(r.body).slice(0, 700)}`); return r.body.result; };
  const refused = (r, status, code, what = "") => { assert.deepEqual([r.status, r.body.code], [status, code], `${what} ${JSON.stringify(r.body).slice(0, 500)}`); return r.body; };
  const fn = (who, operation, input) => call(who, FIN, operation, input);
  const sys = { tenantId: TENANT, principalId: "finance-system" };
  let sk = 0;
  const key = (k) => `${k}-${++sk}`;
  const YEAR = Number((await one(`SELECT extract(year FROM now() AT TIME ZONE 'UTC')::int AS n`)).n);
  const number = (n) => `INV-${YEAR}-${String(n).padStart(6, "0")}`;
  const businessToday = async (company) => (await one(`SELECT to_char(eos_policy.operating_company_business_date($1,$2,now()),'YYYY-MM-DD') d`, [TENANT, company])).d;
  const plusDays = (day, n) => { const [y, m, d] = day.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };

  // ── roles: exactly the void request key and the void approval key (the approval key is granted to nobody by the migration) ──
  const customRole = async (roleKey, caps) => {
    const made = await admin("createRole", { key: roleKey, name: roleKey, reason: "local test tenant only (FU-2)" });
    assert.equal(made.ok, true, JSON.stringify(made).slice(0, 300));
    for (const cap of caps) {
      await q(`INSERT INTO eos_policy.role_capabilities (id,tenant_id,role_id,capability_id,granted_by,created_by,updated_by)
               SELECT 'rc_' || substr(md5($1 || r.id || c.id), 1, 24), $1, r.id, c.id, 'fu2-test', 'fu2-test', 'fu2-test'
                 FROM eos_policy.roles r, eos_policy.capabilities c WHERE r.tenant_id = $1 AND r.key = $2 AND c.key = $3
               ON CONFLICT (tenant_id, role_id, capability_id) DO NOTHING`, [TENANT, roleKey, cap]);
    }
  };
  await customRole("fu2Requester", ["finance.adjustment.record"]);
  await customRole("fu2Approver", ["finance.invoice.void.approve"]);

  // ── people ──
  const ctrl = await person("uid-ctrl", ["controller"], { id: "e-ctrl", name: "Sage Controller" });
  const ctrlV = await person("uid-ctrlv", ["controller"], { id: "e-ctrlv", name: "Vera Ventana-Controller" });
  const reqA = await person("uid-reqa", ["fu2Requester"], { id: "e-req-a", name: "Rita Requester" });
  const appA = await person("uid-appa", ["fu2Approver"], { id: "e-app-a", name: "Alan Approver" });
  const salesP = await person("uid-sales", ["salesperson"], { id: "e-sales", name: "Riley Retail" });
  const techP = await person("uid-tech", ["technician"], { id: "e-tech", name: "Finley Tech", technician: true });
  await assignFinanceCompanies({ admin, q, tenant: TENANT }, [ctrl, reqA, appA]);
  await assignFinanceCompanies({ admin, q, tenant: TENANT }, [ctrlV], ["ventana"]);

  // ── customers and commercial helpers ──
  await q(`INSERT INTO eos_crm.accounts (id, tenant_id, name, status, created_by, updated_by) VALUES ('acct-a',$1,'Harbor Grill','ACTIVE','f','f'),
           ('acct-b',$1,'Other Diner','ACTIVE','f','f'), ('acct-lessor-a',$1,'Lessor A','ACTIVE','f','f')`, [TENANT]);
  await q(`INSERT INTO eos_crm.account_relationship_types (tenant_id, account_id, relationship_type) VALUES ($1,'acct-a','CUSTOMER'), ($1,'acct-b','CUSTOMER'), ($1,'acct-lessor-a','FINANCING_PROVIDER')`, [TENANT]);
  await q(`INSERT INTO eos_policy.tenant_sales_channels (tenant_id, sales_channel, status, source, established_by, updated_by) VALUES ($1,'RETAIL','ACTIVE','f','f','f') ON CONFLICT DO NOTHING`, [TENANT]);
  const seller = await person("uid-seller", [], { id: "e-seller", name: "Sam Seller" });
  const sellerActor = { tenantId: TENANT, principalId: seller.principalId, capabilities: new Set(["salesAgreement.create", "salesAgreement.updateDraft", "salesAgreement.accept", "salesOrder.write"]) };
  const deps = { pool, catalog: { async verifyReferences(_db, _t, refs) { return refs.map(() => "FOUND"); } } };
  let gn = 0;
  /** A direct sale: an accepted Agreement, its Sales Order and (unless `fulfil` is false) the fulfillment that makes it ELIGIBLE in full; made READY by the first preparation. */
  const directPackage = async ({ account = "acct-a", price = 40000, tax = 0, companyKey = "taylor", fulfil = true, prepare: prepareNow = true } = {}) => {
    const opp = `opp-fu2-${++gn}`;
    await q(`INSERT INTO eos_commercial.opportunities (id, tenant_id, opportunity_number, account_id, owner_employee_id, sales_channel, stage, operating_company_key,
               credited_salesperson_employee_id, created_by, updated_by) VALUES ($1,$2,$1,$3,'e-seller','RETAIL','DECISION',$4,'e-seller','f','f')`, [opp, TENANT, account, companyKey]);
    const ag = await sa.createSalesAgreement(deps, sellerActor, { idempotencyKey: `sa-${gn}`, opportunityId: opp, ownerEmployeeId: "e-seller", isLease: false,
      taxEvidence: { status: "DETERMINED", amountMinor: tax, currency: "USD" },
      lines: [{ kind: "SERVICE", ref: "SVC-X", quantity: 1, unitPrice: price, businessUnitId: "SERVICE" }] });
    const agreementId = (ag.result ?? ag).salesAgreementId;
    await sa.acceptSalesAgreement(deps, sellerActor, { idempotencyKey: `acc-${gn}`, salesAgreementId: agreementId });
    const so = `so-fu2-${gn}`;
    await q(`INSERT INTO eos_commercial.sales_orders (id, tenant_id, sales_order_number, account_id, owner_employee_id, operating_company_key, state, sales_channel, currency, sales_agreement_id, created_by, updated_by)
             VALUES ($1,$2,$1,$3,'e-seller',$4,'IN_FULFILLMENT','RETAIL','USD',$5,'f','f')`, [so, TENANT, account, companyKey, agreementId]);
    await q(`INSERT INTO eos_commercial.sales_order_lines (tenant_id, sales_order_id, line_number, kind, ref, business_unit, ordered_qty, unit_price_minor) VALUES ($1,$2,1,'SERVICE','SVC-X','INSTALLATION',1,$3)`, [TENANT, so, price]);
    if (!fulfil) return { so, packageId: null, obligation: null };
    await q(`INSERT INTO eos_commercial.sales_order_fulfillments (id, tenant_id, sales_order_id, line_number, line_kind, line_ref, quantity, source_kind, source_work_order_id, evidence_kind, operating_company_key, operating_company_id, account_id, fulfilled_at, recorded_by)
             VALUES ($1,$2,$3,1,'SERVICE','SVC-X',1,'WORK_ORDER_COMPLETION',$4,'SERVICE_PERFORMED',$5,$5,$6,now(),'f')`, [`ful-${so}`, TENANT, so, `wo-${so}`, companyKey, account]);
    if (!prepareNow) return { so, packageId: null, obligation: null };
    const out = await pkg.prepareBillingPackage(pool, sys, { salesOrderId: so });
    assert.equal(out.status, "READY");
    const obligation = (await one(`SELECT id FROM eos_finance.obligations WHERE tenant_id=$1 AND source_record_id=$2 AND kind='RECEIVABLE'`, [TENANT, out.packageId]))?.id ?? null;
    return { so, packageId: out.packageId, obligation };
  };
  const issueOn = async (packageId, company = "taylor", who = ctrl) =>
    ok(await fn(who, "issueInvoice", { billingPackageId: packageId, idempotencyKey: key("iss"), dueOn: plusDays(await businessToday(company), 30), dueReason: "stated" }), "issue").invoice;
  const issued = async (opts = {}) => { const p = await directPackage(opts); return { ...p, invoice: await issueOn(p.packageId, opts.companyKey ?? "taylor") }; };
  const voidInvoice = async (inv) => {
    const reqd = ok(await fn(reqA, "requestInvoiceCorrection", { idempotencyKey: key("req"), kind: "VOID", invoiceId: inv.id, reason: "Billed to the wrong customer" }), "void request").correction;
    const done = ok(await fn(appA, "decideInvoiceCorrection", { correctionId: reqd.id, decision: "APPROVE", amountMinor: Number(reqd.amountMinor), reason: "Reviewed", idempotencyKey: key("dec") }), "void approve").correction;
    assert.equal(done.status, "APPLIED");
  };
  const register = async () => ok(await fn(ctrl, "listObligations", { operatingCompanyId: "taylor", kind: "RECEIVABLE" }), "register").items;
  const rowOfInvoice = async (invoiceId) => (await register()).find((r) => r.invoice?.id === invoiceId);
  /** What a refused command must leave untouched. */
  const trace = async () => ({
    packages: await count(`SELECT count(*)::int n FROM eos_finance.billing_packages WHERE tenant_id=$1`, [TENANT]),
    pkgLines: await count(`SELECT count(*)::int n FROM eos_finance.billing_package_lines WHERE tenant_id=$1`, [TENANT]),
    obligations: await count(`SELECT count(*)::int n FROM eos_finance.obligations WHERE tenant_id=$1`, [TENANT]),
    facts: await count(`SELECT count(*)::int n FROM eos_finance.financial_facts WHERE tenant_id=$1`, [TENANT]),
    handoffs: await count(`SELECT count(*)::int n FROM eos_finance.accounting_handoffs WHERE tenant_id=$1`, [TENANT]),
    invoices: await count(`SELECT count(*)::int n FROM eos_finance.invoices WHERE tenant_id=$1`, [TENANT]),
    audits: await count(`SELECT count(*)::int n FROM eos_policy.audit_events WHERE tenant_id=$1 AND action='finance.billingPackage.prepare'`, [TENANT]),
  });
  const prepare = (who, input) => fn(who, "prepareBillingPackage", input);

  let V1; // the voided sale and its rebill
  let rebillKey;
  await t.test("VOID -> PREPARE -> ISSUE: the rebill gets a NEW invoice number; the voided number is kept; the read offers the rebill only while it can be prepared", async () => {
    V1 = await issued({ price: 3000 });
    const V1_NUMBER = V1.invoice.invoiceNumber;
    assert.equal(V1_NUMBER, number(1));
    // before the void: not a voided invoice, so there is nothing to rebill; the invoiced receivable is not issuable again
    const before = await rowOfInvoice(V1.invoice.id);
    assert.equal(before.rebill, null);
    assert.deepEqual(before.issuable, { eligible: false, reason: "INVOICE_ALREADY_ISSUED" });
    await voidInvoice(V1.invoice);
    const voided = await rowOfInvoice(V1.invoice.id);
    assert.ok(voided.invoice.voidedAt, "the register says the invoice is void");
    assert.deepEqual(voided.issuable, { eligible: false, reason: "BILLING_PACKAGE_NOT_READY" }, "the void retired the package, which the command names before the void receivable");
    assert.deepEqual(voided.rebill, { eligible: true, reason: null }, "the order is ELIGIBLE in full and has no current package");
    assert.equal((await one(`SELECT status FROM eos_finance.billing_packages WHERE id=$1`, [V1.packageId])).status, "SUPERSEDED", "the void retired the package");

    const t0 = await trace();
    rebillKey = key("prep");
    const r = ok(await prepare(ctrl, { salesOrderId: V1.so, idempotencyKey: rebillKey }), "prepare");
    assert.equal(r.outcome, "recorded");
    assert.deepEqual([r.version, r.status, r.readinessExceptions], [2, "READY", []]);
    assert.notEqual(r.packageId, V1.packageId, "a NEW package, even with identical content");
    assert.equal((await one(`SELECT supersedes_package_id FROM eos_finance.billing_packages WHERE id=$1`, [r.packageId])).supersedes_package_id, V1.packageId);
    const t1 = await trace();
    assert.deepEqual([t1.packages - t0.packages, t1.audits - t0.audits, t1.invoices - t0.invoices], [1, 1, 0], "one package version, ONE audit row, no invoice yet");
    const audit = await one(`SELECT actor_uid, target_kind, target_id, after FROM eos_policy.audit_events WHERE tenant_id=$1 AND action='finance.billingPackage.prepare' AND after->>'idempotencyKey'=$2`, [TENANT, rebillKey]);
    assert.deepEqual([audit.actor_uid, audit.target_kind, audit.target_id, audit.after.salesOrderId, audit.after.version], [ctrl.principalId, "billing_package", r.packageId, V1.so, 2]);

    // the read moves with it: the voided row no longer offers a rebill; the new receivable is issuable
    assert.deepEqual((await rowOfInvoice(V1.invoice.id)).rebill, { eligible: false, reason: "BILLING_PACKAGE_ALREADY_PREPARED" });
    const fresh = (await register()).find((x) => x.sourceRecordId === r.packageId);
    assert.deepEqual(fresh.issuable, { eligible: true, reason: null });
    assert.equal(fresh.invoice, null);

    // issue the rebill: a NEW number; the voided invoice keeps its own
    const rebilled = await issueOn(r.packageId);
    V1.rebilled = rebilled;
    assert.equal(rebilled.invoiceNumber, number(2));
    assert.notEqual(rebilled.invoiceNumber, V1_NUMBER);
    const old = await one(`SELECT invoice_number, voided_at IS NOT NULL AS v FROM eos_finance.invoices WHERE id=$1`, [V1.invoice.id]);
    assert.deepEqual([old.invoice_number, old.v], [V1_NUMBER, true], "the voided invoice keeps its number");
    assert.equal(await count(`SELECT count(*)::int n FROM eos_finance.invoices WHERE tenant_id=$1 AND sales_order_id=$2`, [TENANT, V1.so]), 2);
    assert.equal(await count(`SELECT count(*)::int n FROM eos_finance.invoices WHERE tenant_id=$1 AND invoice_number=$2`, [TENANT, V1_NUMBER]), 1, "the number is never reused");
  });

  await t.test("REPLAY: the same key returns the recorded package and writes nothing; the same key for another order is refused", async () => {
    const before = await trace();
    const again = ok(await prepare(ctrl, { salesOrderId: V1.so, idempotencyKey: rebillKey }), "replay");
    assert.deepEqual([again.outcome, again.version, again.status], ["replayed", 2, "READY"]);
    assert.equal(again.packageId, (await one(`SELECT id FROM eos_finance.billing_packages WHERE tenant_id=$1 AND sales_order_id=$2 AND version=2`, [TENANT, V1.so])).id, "the recorded package");
    assert.deepEqual(await trace(), before, "a replay writes nothing");
    const other = await issued({ account: "acct-b", price: 700 });
    const b2 = await trace();
    refused(await prepare(ctrl, { salesOrderId: other.so, idempotencyKey: rebillKey }), 409, "IDEMPOTENCY_KEY_REUSED");
    assert.deepEqual(await trace(), b2);
    // REBILL ONLY: a NEW key on an order that already holds a current package is refused, never a second version
    refused(await prepare(ctrl, { salesOrderId: V1.so, idempotencyKey: key("prep") }), 409, "BILLING_PACKAGE_ALREADY_PREPARED");
    assert.deepEqual(await trace(), b2, "no second package version");
  });

  await t.test("REBILL ONLY: a live READY package is never re-versioned, even when its evidence changed; a never-invoiced order is not a rebill -- zero trace", async () => {
    // a live READY package (never invoiced), then the order's evidence changes: the ordinary preparation WOULD supersede it; this command refuses
    const live = await directPackage({ price: 600, account: "acct-b" });
    await q(`UPDATE eos_commercial.sales_order_lines SET unit_price_minor = unit_price_minor + 1 WHERE tenant_id=$1 AND sales_order_id=$2`, [TENANT, live.so]);
    // a fulfilled order that has no package and no invoice at all
    const bare = await directPackage({ price: 650, account: "acct-b", prepare: false });
    const before = await trace();
    refused(await prepare(ctrl, { salesOrderId: live.so, idempotencyKey: key("prep") }), 409, "BILLING_PACKAGE_ALREADY_PREPARED", "changed evidence under a live package");
    refused(await prepare(ctrl, { salesOrderId: bare.so, idempotencyKey: key("prep") }), 412, "NOT_LATEST_VOIDED_INVOICE", "never invoiced: not a rebill");
    assert.deepEqual(await trace(), before, "no package, line, receivable, fact, handoff or audit row");
    assert.equal((await one(`SELECT status FROM eos_finance.billing_packages WHERE id=$1`, [live.packageId])).status, "READY", "the live package was not superseded");
    assert.equal(await count(`SELECT count(*)::int n FROM eos_finance.billing_packages WHERE tenant_id=$1 AND sales_order_id=$2`, [TENANT, bare.so]), 0);
    // the read agrees: neither order has a voided invoice, so neither shows a rebill
    const rows = await register();
    assert.ok(rows.filter((r) => r.sourceSalesOrder?.id === live.so).every((r) => r.rebill === null));
  });

  await t.test("REFUSED, ZERO TRACE: a non-holder, a foreign company, a missing order, an order not ELIGIBLE, a closed input", async () => {
    const unfulfilled = await directPackage({ fulfil: false, price: 900 });
    const ventana = await directPackage({ companyKey: "ventana", account: "acct-b", price: 500 });
    const before = await trace();
    for (const who of [salesP, techP, reqA, appA]) refused(await prepare(who, { salesOrderId: V1.so, idempotencyKey: key("prep") }), 403, "CAPABILITY_REQUIRED", "a non-holder");
    const foreign = refused(await prepare(ctrlV, { salesOrderId: V1.so, idempotencyKey: key("prep") }), 404, "SALES_ORDER_NOT_FOUND", "Ventana-only Finance on a Taylor order");
    const missing = refused(await prepare(ctrlV, { salesOrderId: "so-does-not-exist", idempotencyKey: key("prep") }), 404, "SALES_ORDER_NOT_FOUND");
    assert.equal(foreign.message, missing.message, "foreign reads exactly like missing");
    refused(await prepare(ctrl, { salesOrderId: "so-does-not-exist", idempotencyKey: key("prep") }), 404, "SALES_ORDER_NOT_FOUND");
    refused(await prepare(ctrl, { salesOrderId: unfulfilled.so, idempotencyKey: key("prep") }), 412, "SALES_ORDER_NOT_ELIGIBLE", "no fulfillment: not ELIGIBLE in full");
    refused(await prepare(ctrl, { salesOrderId: V1.so }), 400, "IDEMPOTENCY_KEY_REQUIRED");
    refused(await prepare(ctrl, { idempotencyKey: key("prep") }), 400, "SALES_ORDER_ID_REQUIRED");
    refused(await prepare(ctrl, { salesOrderId: V1.so, idempotencyKey: key("prep"), operatingCompanyId: "ventana" }), 400, "FIELD_NOT_ACCEPTED");
    assert.deepEqual(await trace(), before, "no package, line, receivable, fact, handoff, invoice or audit row");
    // Ventana's own Finance is past the company check on Ventana's order; the order holds a live package, so it is not a rebill
    refused(await prepare(ctrlV, { salesOrderId: ventana.so, idempotencyKey: key("prep") }), 409, "BILLING_PACKAGE_ALREADY_PREPARED");
    assert.deepEqual(await trace(), before);
  });

  await t.test("CONCURRENCY: two prepares of one voided order give ONE new package version", async () => {
    const V2 = await issued({ price: 1500 });
    await voidInvoice(V2.invoice);
    const before = await trace();
    const results = await Promise.all([prepare(ctrl, { salesOrderId: V2.so, idempotencyKey: key("prep") }), prepare(ctrl, { salesOrderId: V2.so, idempotencyKey: key("prep") })]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409], "one prepares; the other waits for the order lock and is then refused");
    const loser = results.find((r) => r.status === 409);
    assert.equal(loser.body.code, "BILLING_PACKAGE_ALREADY_PREPARED");
    assert.equal(results.find((r) => r.status === 200).body.result.outcome, "recorded");
    assert.equal((await trace()).packages - before.packages, 1, "ONE new package version");
    assert.deepEqual((await q(`SELECT version, status FROM eos_finance.billing_packages WHERE tenant_id=$1 AND sales_order_id=$2 ORDER BY version`, [TENANT, V2.so])).rows.map((r) => `${r.version}:${r.status}`), ["1:SUPERSEDED", "2:READY"]);
    assert.equal((await trace()).audits - before.audits, 1, "ONE audit row");
  });

  await t.test("VOID AGAIN: a rebill that is voided too can be rebilled again; only the LATEST voided invoice of the order offers it", async () => {
    await voidInvoice(V1.rebilled);
    assert.deepEqual((await rowOfInvoice(V1.invoice.id)).rebill, { eligible: false, reason: "NOT_LATEST_VOIDED_INVOICE" });
    assert.deepEqual((await rowOfInvoice(V1.rebilled.id)).rebill, { eligible: true, reason: null });
    const third = ok(await prepare(ctrl, { salesOrderId: V1.so, idempotencyKey: key("prep") }), "third prepare");
    assert.deepEqual([third.outcome, third.version, third.status], ["recorded", 3, "READY"]);
    const inv3 = await issueOn(third.packageId);
    assert.ok(![V1.invoice.invoiceNumber, V1.rebilled.invoiceNumber].includes(inv3.invoiceNumber), "a third, new number");
    assert.equal(await count(`SELECT count(*)::int n FROM eos_finance.invoices WHERE tenant_id=$1 AND sales_order_id=$2`, [TENANT, V1.so]), 3);
    // the first rebill key still replays, and answers the LIVE row: that package has since been retired by the second void
    const before = await trace();
    const replay = ok(await prepare(ctrl, { salesOrderId: V1.so, idempotencyKey: rebillKey }), "replay after the package moved on");
    assert.deepEqual([replay.outcome, replay.version, replay.status], ["replayed", 2, "SUPERSEDED"]);
    assert.deepEqual(await trace(), before);
  });

  await t.test("REBILL PARITY: for every voided invoice the register lists, the command rebills exactly where the read offers it, and refuses with the read's reason where it does not", async () => {
    // V4: voided, nothing prepared -> offered. V5: rebilled and voided AGAIN -> the older voided row is not the latest, the newer one is offered.
    const V4 = await issued({ price: 910 });
    await voidInvoice(V4.invoice);
    const V5 = await issued({ price: 920 });
    await voidInvoice(V5.invoice);
    const p5 = ok(await prepare(ctrl, { salesOrderId: V5.so, idempotencyKey: key("prep") }), "V5 prepare");
    const inv5b = await issueOn(p5.packageId);
    await voidInvoice(inv5b);
    const voidedRows = (await register()).filter((r) => r.rebill !== null);
    const byOrder = new Map();
    for (const r of voidedRows) byOrder.set(r.sourceSalesOrder.id, [...(byOrder.get(r.sourceSalesOrder.id) ?? []), r]);
    assert.ok([V1.so, V4.so, V5.so].every((so) => byOrder.has(so)), "the fixtures are listed");
    const seen = new Set();
    for (const [so, rows] of byOrder) {
      const offered = rows.filter((r) => r.rebill.eligible);
      assert.ok(offered.length <= 1, `${so}: at most one voided invoice per order offers the rebill`);
      const attempt = await prepare(ctrl, { salesOrderId: so, idempotencyKey: key("prep") });
      if (offered.length === 1) {
        assert.equal(attempt.status, 200, `${so} is offered, so it rebills: ${JSON.stringify(attempt.body).slice(0, 300)}`);
        seen.add("REBILLED");
      } else {
        assert.notEqual(attempt.status, 200, `${so} is not offered, so it is refused`);
        for (const r of rows) assert.equal(attempt.body.code, r.rebill.reason, `${so}: the read's reason is the command's refusal`);
        seen.add(rows[0].rebill.reason);
      }
    }
    for (const expected of ["REBILLED", "BILLING_PACKAGE_ALREADY_PREPARED"]) assert.ok(seen.has(expected), `the sweep exercised ${expected}`);
    const v5 = byOrder.get(V5.so);
    assert.deepEqual(v5.map((r) => String(r.rebill.reason)).sort(), ["NOT_LATEST_VOIDED_INVOICE", "null"], "V5 shows both: the older voided row is not the latest, the newer one is offered");
  });

  await t.test("ISSUABLE never disagrees with issueInvoice: false -> refused with exactly the reason (a financed sale included); true -> issues", async () => {
    // a direct sale ready to issue
    const ready = await directPackage({ price: 2100, account: "acct-b" });
    // a package superseded under its receivable (the F-1a fixture)
    const superseded = await directPackage({ price: 500, account: "acct-b" });
    await q(`UPDATE eos_finance.billing_packages SET status='SUPERSEDED', status_changed_at=now() WHERE tenant_id=$1 AND id=$2`, [TENANT, superseded.packageId]);
    // a FINANCED sale: the customer's contribution is a RECEIVABLE on the package -- the row the screen used to offer Issue on
    const i = ++gn, ag = `sa-fu2-fin-${i}`, so = `so-fu2-fin-${i}`;
    await q(`INSERT INTO eos_commercial.sales_agreements (id, tenant_id, sales_agreement_number, account_id, owner_employee_id, state, accepted_at, accepted_by,
               is_lease, operating_company_key, currency, shipping_minor, install_charge_minor, tax_minor, down_payment_minor, trade_in_minor, created_by, updated_by,
               tax_evidence_status, tax_evidence_currency, tax_evidence_recorded_by, tax_evidence_recorded_at)
             VALUES ($1,$2,$1,'acct-a','e-seller','ACCEPTED',now(),'f',true,'taylor','USD',1000,0,2000,1000,0,'f','f','DETERMINED','USD','f',now())`, [ag, TENANT]);
    await q(`INSERT INTO eos_commercial.sales_orders (id, tenant_id, sales_order_number, account_id, owner_employee_id, operating_company_key, state, sales_channel,
               currency, sales_agreement_id, location_id, created_by, updated_by)
             VALUES ($1,$2,$1,'acct-a','e-seller','taylor','IN_FULFILLMENT','RETAIL','USD',$3,NULL,'f','f')`, [so, TENANT, ag]);
    await q(`INSERT INTO eos_commercial.sales_order_lines (tenant_id, sales_order_id, line_number, kind, ref, business_unit, ordered_qty, unit_price_minor)
             VALUES ($1,$2,1,'SERVICE','INSTALL-STANDARD','INSTALLATION',1,30000)`, [TENANT, so]);
    await q(`INSERT INTO eos_commercial.sales_order_fulfillments (id, tenant_id, sales_order_id, line_number, line_kind, line_ref, quantity, source_kind,
               source_work_order_id, evidence_kind, operating_company_key, operating_company_id, account_id, fulfilled_at, recorded_by, equipment_ids, serial_numbers)
             VALUES ($1,$2,$3,1,'SERVICE','INSTALL-STANDARD',1,'WORK_ORDER_COMPLETION',$4,'SERVICE_PERFORMED','taylor','taylor','acct-a',now(),'f','{}','{}')`, [`ful-${so}`, TENANT, so, `wo-${so}`]);
    const arr = await financed.recordFinancingArrangement(pool, sys, { salesAgreementId: ag, financingProviderAccountId: "acct-lessor-a", arrangementKind: "LEASE", customerContributionMinor: 1000, idempotencyKey: key("fin") });
    assert.equal(arr.status, "APPLIED");
    const finOut = await pkg.prepareBillingPackage(pool, sys, { salesOrderId: so });
    assert.equal(finOut.status, "READY");
    assert.equal(finOut.consequence.contributionReceivable.amountMinor, "1000", "fixture: the financed package opened the customer's contribution RECEIVABLE");

    const rows = (await register()).filter((r) => r.sourceDomain === "BILLING_PACKAGE");
    assert.ok(rows.length >= 6, "the register lists the fixtures");
    const byPackage = new Map(rows.map((r) => [r.sourceRecordId, r]));
    assert.deepEqual(byPackage.get(finOut.packageId).issuable, { eligible: false, reason: "UNSUPPORTED_FINANCIAL_OBLIGOR" }, "the register tells the screen a financed sale is not issuable");
    assert.deepEqual(byPackage.get(superseded.packageId).issuable, { eligible: false, reason: "BILLING_PACKAGE_NOT_READY" });
    assert.deepEqual(byPackage.get(ready.packageId).issuable, { eligible: true, reason: null });
    // the billing queue (un-invoiced receivables) carries the same field
    const queue = ok(await fn(ctrl, "listObligations", { operatingCompanyId: "taylor", kind: "RECEIVABLE", invoiced: false }), "queue").items;
    assert.deepEqual(queue.find((r) => r.sourceRecordId === finOut.packageId).issuable, { eligible: false, reason: "UNSUPPORTED_FINANCIAL_OBLIGOR" });

    // EVERY listed receivable: the command agrees with the read
    const reasons = new Set();
    for (const row of rows) {
      const attempt = await fn(ctrl, "issueInvoice", { billingPackageId: row.sourceRecordId, idempotencyKey: key("iss"), dueOn: plusDays(await businessToday("taylor"), 30), dueReason: "stated" });
      if (row.issuable.eligible) {
        assert.equal(attempt.status, 200, `${row.id} is issuable, so it issues: ${JSON.stringify(attempt.body).slice(0, 300)}`);
        reasons.add("ISSUED");
      } else {
        assert.notEqual(attempt.status, 200, `${row.id} is not issuable, so it is refused`);
        assert.equal(attempt.body.code, row.issuable.reason, `${row.id}: the read's reason is the command's refusal`);
        reasons.add(row.issuable.reason);
      }
    }
    for (const expected of ["ISSUED", "UNSUPPORTED_FINANCIAL_OBLIGOR", "BILLING_PACKAGE_NOT_READY", "INVOICE_ALREADY_ISSUED"]) {
      assert.ok(reasons.has(expected), `the sweep exercised ${expected}`);
    }
  });
});
