// FINANCING-PROVIDER FINANCED SALES (Owner rulings #200 + #201, 2026-10-02; DECISIONS #200 / #201; migration 1764480000000).
// Proofs A–W (#201 §9) against real PostgreSQL: one Taylor commercial sale whose commercial customer is unchanged, paid by a
// customer contribution (its receivable at ordinary billing eligibility) and a financed amount owed by the financing provider
// (a FUNDING_RECEIVABLE only once SIGNED + APPROVED provider documentation entitles Taylor) -- never overlapping.
//
// Its own database per run. Set POLICY_TEST_DATABASE_URL; without it the database half SKIPS.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import pg from "pg";

const require = createRequire(import.meta.url);
const fin = require("../lib/eosFinance/financeFoundation.js");
const pkg = require("../lib/eosFinance/billingPackage.js");
const fs = require("../lib/eosFinance/financedSale.js");
const http = require("../lib/eosOps/eosOpsHttp.js");
const delivery = require("../lib/eosFinance/accountingDelivery.js");
import { deterministicAccountingAdapter, TEST_ADAPTER_KEY } from "./support/deterministicAccountingAdapter.mjs";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const T = "t-finsale";
const sys = { tenantId: T, principalId: "finance-system" };
const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}
const refusedWith = async (p, code) => {
  await assert.rejects(p, (e) => { assert.equal(e.code, code, `${e.code}: ${e.message}`); return true; });
};

test("O / L. static: provider-neutral (no Saratoga in schema or code), no repossession / provider-collection model, no transport operation", () => {
  const strip = (s) => s.replace(/^\s*--.*$/gm, "").replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const mig = strip(readFileSync(new URL("../migrations/1764480000000_financing-arrangements.sql", import.meta.url), "utf8"));
  const code = strip(readFileSync(new URL("../src/eosFinance/financedSale.ts", import.meta.url), "utf8"));
  for (const [name, src] of [["migration", mig], ["financedSale.ts", code]]) {
    assert.equal(/saratoga/i.test(src), false, `${name}: the provider is never hardcoded`);
    assert.equal(/repossess|collection|delinquen|recover/i.test(src), false, `${name}: the provider's collection / repossession is not modelled`);
    assert.equal(/firebase/i.test(src), false, `W. ${name}: no Firebase`);
    assert.equal(/fetch\(|https?:\/\/|from ["']node:(http|https|net|tls)["']/i.test(src), false, `T. ${name}: no network`);
  }
  const ops = [...http.OPERATIONS_READ_OPERATIONS, ...http.OPERATIONS_MUTATION_OPERATIONS];
  assert.equal(ops.some((o) => /financ|funding/i.test(o)), false, "no transport operation records or moves financing");
});

test("Financed sales over PostgreSQL (Owner ruling #200)", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `fsal_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  const url = dbUrlFor(name);
  let pool;
  t.after(async () => {
    await pool?.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations", "--no-check-order"],
    { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
  pool = new pg.Pool({ connectionString: url, max: 6 });
  const q = (sql, v = []) => pool.query(sql, v);
  const one = async (sql, v = []) => (await q(sql, v)).rows[0];

  // ── fixtures: Taylor, a customer, two governed financing providers (generic -- neither is special), a plain org ──
  await q(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ($1,$1,$1)`, [T]);
  for (const company of ["taylor", "ventana"]) {
    await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id, operating_company_id, status, source, established_by, updated_by) VALUES ($1,$2,'ACTIVE','f','f','f')`, [T, company]);
    await q(`INSERT INTO eos_policy.tenant_operating_company_keys (tenant_id, operating_company_id, operating_company_key, status, provenance, source, established_by, updated_by)
             VALUES ($1,$2,$2,'ACTIVE','NATIVE','f','f','f')`, [T, company]);
  }
  const account = async (id, rels) => {
    await q(`INSERT INTO eos_crm.accounts (id, tenant_id, name, status, created_by, updated_by) VALUES ($1,$2,$1,'ACTIVE','f','f')`, [id, T]);
    for (const r of rels) await q(`INSERT INTO eos_crm.account_relationship_types (tenant_id, account_id, relationship_type) VALUES ($1,$2,$3)`, [T, id, r]);
  };
  await account("acct-harbor", ["CUSTOMER"]);
  await account("acct-lessor-a", ["FINANCING_PROVIDER"]);
  await account("acct-lessor-b", ["FINANCING_PROVIDER"]);
  await account("acct-plain", ["CUSTOMER"]);

  let n = 0;
  /** An ACCEPTED Agreement (DETERMINED tax) + its Sales Order fully fulfilled: subtotal 30000, shipping 1000, tax 2000 -> total 33000. */
  const sale = async ({ down = 0, tradeIn = 0, price = 30000, tax = 2000, shipping = 1000, company = "taylor", evidence = "SERVICE_PERFORMED" } = {}) => {
    const i = ++n, ag = `sa-f-${i}`, so = `so-f-${i}`;
    await q(`INSERT INTO eos_commercial.sales_agreements (id, tenant_id, sales_agreement_number, account_id, owner_employee_id, state, accepted_at, accepted_by,
               is_lease, operating_company_key, currency, shipping_minor, install_charge_minor, tax_minor, down_payment_minor, trade_in_minor, created_by, updated_by,
               tax_evidence_status, tax_evidence_currency, tax_evidence_recorded_by, tax_evidence_recorded_at)
             VALUES ($1,$2,$1,'acct-harbor','e-seller','ACCEPTED',now(),'f',true,$3,'USD',$4,0,$5,$6,$7,'f','f','DETERMINED','USD','f',now())`,
      [ag, T, company, shipping, tax, down, tradeIn]);
    await q(`INSERT INTO eos_commercial.sales_orders (id, tenant_id, sales_order_number, account_id, owner_employee_id, operating_company_key, state, sales_channel,
               currency, sales_agreement_id, location_id, created_by, updated_by)
             VALUES ($1,$2,$1,'acct-harbor','e-seller',$3,'IN_FULFILLMENT','RETAIL','USD',$4,NULL,'f','f')`, [so, T, company, ag]);
    await q(`INSERT INTO eos_commercial.sales_order_lines (tenant_id, sales_order_id, line_number, kind, ref, business_unit, ordered_qty, unit_price_minor)
             VALUES ($1,$2,1,'SERVICE','INSTALL-STANDARD','INSTALLATION',1,$3)`, [T, so, price]);
    // An installation's fulfillment names the installed equipment (the shape the database requires).
    const installed = evidence === "EQUIPMENT_INSTALLATION";
    await q(`INSERT INTO eos_commercial.sales_order_fulfillments (id, tenant_id, sales_order_id, line_number, line_kind, line_ref, quantity, source_kind,
               source_work_order_id, evidence_kind, operating_company_key, operating_company_id, account_id, fulfilled_at, recorded_by, equipment_ids, serial_numbers)
             VALUES ($1,$2,$3,1,'SERVICE','INSTALL-STANDARD',1,'WORK_ORDER_COMPLETION',$4,$6,$5,$5,'acct-harbor',now(),'f',$7,$8)`,
      [`ful-${i}`, T, so, `wo-${i}`, company, evidence, installed ? [`eq-${i}`] : [], installed ? [`SN-${i}`] : []]);
    return { agreementId: ag, salesOrderId: so };
  };
  let k = 0;
  const key = () => `k-${++k}`;
  const arrange = (agreementId, over = {}) => fs.recordFinancingArrangement(pool, sys, { salesAgreementId: agreementId, financingProviderAccountId: "acct-lessor-a",
    arrangementKind: "LEASE", customerContributionMinor: 0, idempotencyKey: key(), ...over });
  const move = (arrangementId, toStatus, extra = {}) => fs.transitionFinancingArrangement(pool, sys, { arrangementId, toStatus, reason: `to ${toStatus}`, idempotencyKey: key(), ...extra });
  const evidence = (arrangementId, signed, approved, extra = {}) => fs.recordFinancingApprovalEvidence(pool, sys, { arrangementId,
    documentReference: `DOC-${arrangementId.slice(-6)}-${signed ? "S" : "u"}${approved ? "A" : "n"}`, signed, approved, idempotencyKey: key(), ...extra });
  const entitle = async (id) => {
    await move(id, "APPROVED");
    const ev = await evidence(id, true, true);
    return move(id, "FUNDING_ENTITLED", { evidenceId: ev.evidenceId });
  };
  const prepare = (salesOrderId) => pkg.prepareBillingPackage(pool, sys, { salesOrderId });
  const obligations = async (packageId) => (await q(`SELECT o.kind, o.status, o.operating_company_id, b.outstanding_minor::text AS outstanding, cp.kind AS cp_kind, cp.crm_account_id
      FROM eos_finance.obligations o JOIN eos_finance.obligation_balances b ON b.obligation_id = o.id JOIN eos_finance.financial_counterparties cp ON cp.id = o.counterparty_id
      WHERE o.tenant_id=$1 AND o.source_domain='BILLING_PACKAGE' AND o.source_record_id=$2 ORDER BY o.kind`, [T, packageId])).rows;
  const packageRow = (id) => one(`SELECT * FROM eos_finance.billing_packages WHERE id=$1`, [id]);
  const customerAR = async () => (await q(`SELECT o.kind, b.originated_minor::text AS amount, o.source_record_id FROM eos_finance.obligations o
      JOIN eos_finance.obligation_balances b ON b.obligation_id=o.id JOIN eos_finance.financial_counterparties cp ON cp.id=o.counterparty_id
      WHERE o.tenant_id=$1 AND cp.crm_account_id='acct-harbor' AND o.status <> 'VOID'`, [T])).rows;

  await t.test("arrangement validation: governed provider, never the customer, explicit contribution; V. provider-neutral", async () => {
    const s0 = await sale();
    await refusedWith(arrange(s0.agreementId, { financingProviderAccountId: "acct-plain" }), "FINANCING_PROVIDER_NOT_GOVERNED");
    await refusedWith(arrange(s0.agreementId, { financingProviderAccountId: "acct-harbor" }), "FINANCING_PROVIDER_IS_CUSTOMER");
    await refusedWith(arrange(s0.agreementId, { customerContributionMinor: undefined }), "CUSTOMER_CONTRIBUTION_INVALID");
    await refusedWith(arrange(s0.agreementId, { arrangementKind: "RENTAL" }), "ARRANGEMENT_KIND_INVALID");
    await refusedWith(arrange(s0.agreementId, { fundedBy: "x" }), "FIELD_NOT_ACCEPTED");
    const r = await arrange(s0.agreementId, { financingProviderAccountId: "acct-lessor-b", arrangementKind: "FINANCING" });
    assert.equal(r.status, "APPLIED", "V: any governed provider organization works");
    await refusedWith(arrange(s0.agreementId), "FINANCING_ARRANGEMENT_EXISTS");
  });

  await t.test("A / B / C / D. APPROVED, delivery, installation and customer acceptance create NO provider receivable", async () => {
    for (const evidenceKind of ["SERVICE_PERFORMED", "EQUIPMENT_INSTALLATION"]) {
      // The Agreement is ACCEPTED (customer acceptance) and the Sales Order is fulfilled (delivery / installation evidence).
      const s0 = await sale({ evidence: evidenceKind });
      const a = await arrange(s0.agreementId, { providerReference: `APP-${evidenceKind}` });
      await move(a.arrangementId, "APPROVED");
      const out = await prepare(s0.salesOrderId);
      assert.deepEqual([out.status, out.consequence.financing, out.consequence.fundingReceivable, out.consequence.handoff],
        ["READY", "HELD_UNTIL_FUNDING_ENTITLEMENT", null, null], evidenceKind);
      assert.equal((await obligations(out.packageId)).filter((o) => o.kind === "FUNDING_RECEIVABLE").length, 0, `${evidenceKind}: no provider receivable`);
      assert.equal((await one(`SELECT status FROM eos_commercial.financing_arrangements WHERE id=$1`, [a.arrangementId])).status, "APPROVED", "nothing moved it");
    }
  });

  await t.test("E / F / G. only SIGNED + APPROVED provider documentation permits FUNDING_ENTITLED", async () => {
    const s0 = await sale();
    const a = await arrange(s0.agreementId);
    await move(a.arrangementId, "APPROVED");
    await refusedWith(move(a.arrangementId, "FUNDING_ENTITLED"), "EVIDENCE_ID_REQUIRED");
    const signedOnly = await evidence(a.arrangementId, true, false);
    const approvedOnly = await evidence(a.arrangementId, false, true);
    assert.deepEqual([signedOnly.entitles, approvedOnly.entitles], [false, false]);
    await refusedWith(move(a.arrangementId, "FUNDING_ENTITLED", { evidenceId: signedOnly.evidenceId }), "FUNDING_EVIDENCE_INSUFFICIENT");
    await refusedWith(move(a.arrangementId, "FUNDING_ENTITLED", { evidenceId: approvedOnly.evidenceId }), "FUNDING_EVIDENCE_INSUFFICIENT");
    await refusedWith(evidence(a.arrangementId, "yes", true), "EVIDENCE_FLAGS_REQUIRED");
    await refusedWith(evidence(a.arrangementId, true, true, { fileContent: "x" }), "FIELD_NOT_ACCEPTED");
    // The database refuses entitlement without signed + approved evidence, even bypassing the service.
    await assert.rejects(q(`UPDATE eos_commercial.financing_arrangements SET status='FUNDING_ENTITLED', entitlement_evidence_id=$2 WHERE id=$1`,
      [a.arrangementId, signedOnly.evidenceId]), /FUNDING_EVIDENCE_INSUFFICIENT/);
    // Another arrangement's evidence never entitles this one.
    const other = await sale(); const oa = await arrange(other.agreementId); await move(oa.arrangementId, "APPROVED");
    const foreign = await evidence(oa.arrangementId, true, true);
    await refusedWith(move(a.arrangementId, "FUNDING_ENTITLED", { evidenceId: foreign.evidenceId }), "FUNDING_EVIDENCE_INSUFFICIENT");
    const both = await evidence(a.arrangementId, true, true, { documentSha256: "a".repeat(64), correlationId: "SO-REF" });
    const r = await move(a.arrangementId, "FUNDING_ENTITLED", { evidenceId: both.evidenceId });
    assert.equal(r.status, "FUNDING_ENTITLED", "G");
    const ev = await one(`SELECT * FROM eos_commercial.financing_approval_evidence WHERE id=$1`, [both.evidenceId]);
    assert.deepEqual([ev.arrangement_id, ev.financing_provider_account_id, ev.signed, ev.approved, ev.recorded_by, ev.correlation_id, ev.document_sha256],
      [a.arrangementId, "acct-lessor-a", true, true, sys.principalId, "SO-REF", "a".repeat(64)], "provenance: arrangement, provider, flags, recorder, correlation");
    assert.ok(ev.recorded_at && ev.document_reference);
    await assert.rejects(q(`UPDATE eos_commercial.financing_approval_evidence SET approved=false WHERE id=$1`, [both.evidenceId]), /append-only/);
    await refusedWith(evidence(a.arrangementId, true, true), "FINANCING_EVIDENCE_NOT_ACCEPTED");
  });

  await t.test("H / I / J / K / L / M. contribution receivable at READY; ONE provider FUNDING_RECEIVABLE at entitlement; no overlap; replay-safe", async () => {
    const s0 = await sale({ down: 8000 });
    const a = await arrange(s0.agreementId, { customerContributionMinor: 8000, providerReference: "PROV-APP-1001" });
    const out = await prepare(s0.salesOrderId);
    const p = await packageRow(out.packageId);
    assert.deepEqual([p.commercial_customer_account_id, p.operating_company_id, p.total_minor, p.customer_contribution_minor, p.financed_amount_minor],
      ["acct-harbor", "taylor", "33000", "8000", "25000"], "K: 33000 = 8000 + 25000; the customer stays the customer; Taylor sells");
    // J: the customer's contribution is owed now -- it does not wait for the provider.
    assert.deepEqual((await obligations(out.packageId)).map((o) => [o.kind, o.outstanding, o.crm_account_id]), [["RECEIVABLE", "8000", "acct-harbor"]]);
    assert.equal(out.consequence.financing, "HELD_UNTIL_FUNDING_ENTITLEMENT");
    const ent = await entitle(a.arrangementId);
    assert.equal(ent.consequences[0].fundingReceivable.amountMinor, "25000", "I");
    const obs = await obligations(out.packageId);
    assert.deepEqual(obs.map((o) => [o.kind, o.outstanding, o.crm_account_id]),
      [["FUNDING_RECEIVABLE", "25000", "acct-lessor-a"], ["RECEIVABLE", "8000", "acct-harbor"]], "H: exactly one provider receivable");
    assert.equal(obs.reduce((t2, o) => t2 + BigInt(o.outstanding), 0n), 33000n, "L: never overlapping");
    // M: replays create nothing new.
    for (let i = 0; i < 2; i++) assert.equal((await prepare(s0.salesOrderId)).outcome, "replayed");
    const c = await pool.connect();
    try { await c.query("BEGIN"); const again = await fs.financedConsequenceOn(c, sys, out.packageId); await c.query("COMMIT");
      assert.deepEqual([again.fundingReceivable.outcome, again.contributionReceivable.outcome], ["replayed", "replayed"]); }
    finally { c.release(); }
    assert.equal((await obligations(out.packageId)).length, 2);
    await assert.rejects(fin.openObligation(pool, sys, { operatingCompanyId: "taylor", counterpartyId: p.financing_provider_counterparty_id, kind: "FUNDING_RECEIVABLE",
      currency: "USD", sourceDomain: "BILLING_PACKAGE", sourceRecordId: out.packageId, originationAmountMinor: 25000, basis: "X", effectiveAt: new Date(), idempotencyKey: "dup-fr" }));
    assert.deepEqual((await customerAR()).filter((r) => r.source_record_id === out.packageId).map((r) => r.amount), ["8000"], "no customer A/R for the financed 25000");
    // A zero contribution: no customer receivable at all, ever.
    const z = await sale(); const za = await arrange(z.agreementId);
    const zo = await prepare(z.salesOrderId); await entitle(za.arrangementId);
    assert.deepEqual((await obligations(zo.packageId)).map((o) => [o.kind, o.outstanding]), [["FUNDING_RECEIVABLE", "33000"]]);
  });

  await t.test("N. FUNDED is distinct from FUNDING_ENTITLED; funded never converts to customer A/R; no provider collection model", async () => {
    const s0 = await sale();
    const a = await arrange(s0.agreementId);
    const out = await prepare(s0.salesOrderId);
    await entitle(a.arrangementId);
    assert.equal((await one(`SELECT status FROM eos_commercial.financing_arrangements WHERE id=$1`, [a.arrangementId])).status, "FUNDING_ENTITLED", "entitled is not funded");
    assert.equal((await q(`SELECT count(*)::int n FROM eos_finance.financial_facts WHERE source_record_id=$1 AND fact_class='SETTLEMENT'`, [out.packageId])).rows[0].n, 0,
      "entitlement records no payment");
    await move(a.arrangementId, "FUNDED");
    for (const to of ["DECLINED", "CANCELLED", "APPROVED", "APPLIED"]) await refusedWith(move(a.arrangementId, to), "FINANCING_TRANSITION_REFUSED");
    assert.deepEqual((await customerAR()).filter((r) => r.source_record_id === out.packageId), []);
    const c = await pool.connect();
    try { await c.query("BEGIN"); await refusedWith(pkg.retirePackageReceivableOn(c, sys, out.packageId, "x"), "FINANCED_PACKAGE_FUNDING_ENTITLED"); }
    finally { await c.query("ROLLBACK"); c.release(); }
  });

  await t.test("O / P. a pre-entitlement decline HOLDS (never silently direct) and may be EXPLICITLY restructured -- to another provider or a direct sale", async () => {
    // Decline -> HELD; no customer receivable for the total appears on its own.
    const s1 = await sale({ down: 3000 });
    const a1 = await arrange(s1.agreementId, { customerContributionMinor: 3000 });
    const first = await prepare(s1.salesOrderId);
    const declined = await move(a1.arrangementId, "DECLINED");
    assert.deepEqual([declined.consequences[0].status, declined.consequences[0].readinessExceptions], ["HELD", ["FINANCING_NOT_AVAILABLE"]], "P");
    assert.deepEqual(await obligations(first.packageId).then((r) => r.map((o) => o.status)), ["VOID"], "the superseded package's contribution receivable is voided, history kept");
    assert.equal((await prepare(s1.salesOrderId)).status, "HELD", "still held: nothing converts silently");
    assert.deepEqual((await customerAR()).filter((r) => r.amount === "33000"), [], "P: no silent direct-sale receivable");
    // O(1): explicit restructure to DIRECT_SALE.
    await refusedWith(fs.restructureFinancedSale(pool, sys, { salesAgreementId: s1.agreementId, toKind: "DIRECT_SALE", reason: "", idempotencyKey: key() }), "REASON_REQUIRED");
    const rd = await fs.restructureFinancedSale(pool, sys, { salesAgreementId: s1.agreementId, toKind: "DIRECT_SALE", reason: "customer pays Taylor directly", idempotencyKey: key() });
    const direct = rd.consequences[0];
    assert.deepEqual([direct.status, direct.totalMinor], ["READY", "33000"]);
    const dp = await packageRow(direct.packageId);
    assert.deepEqual([dp.commercial_disposition, dp.obligor_basis, dp.financing_arrangement_id], ["SALE", "DIRECT_SALE_CUSTOMER", null]);
    assert.deepEqual((await obligations(direct.packageId)).map((o) => [o.kind, o.outstanding, o.crm_account_id]), [["RECEIVABLE", "33000", "acct-harbor"]]);
    const hist = await one(`SELECT status, restructure_id FROM eos_commercial.financing_arrangements WHERE id=$1`, [a1.arrangementId]);
    assert.deepEqual([hist.status, hist.restructure_id], ["DECLINED", rd.restructureId], "the declined arrangement stays, marked as restructured");
    // O(2): a cancelled arrangement restructured to ANOTHER provider.
    const s2 = await sale();
    const a2 = await arrange(s2.agreementId);
    await move(a2.arrangementId, "CANCELLED");
    const rf = await fs.restructureFinancedSale(pool, sys, { salesAgreementId: s2.agreementId, toKind: "FINANCING_ARRANGEMENT", reason: "second provider",
      idempotencyKey: key(), newArrangement: { financingProviderAccountId: "acct-lessor-b", arrangementKind: "FINANCING", customerContributionMinor: 0 } });
    assert.ok(rf.arrangementId);
    assert.deepEqual([rf.consequences[0].status, rf.consequences[0].consequence.financing], ["READY", "HELD_UNTIL_FUNDING_ENTITLEMENT"]);
    await entitle(rf.arrangementId);
    assert.deepEqual((await obligations(rf.consequences[0].packageId)).map((o) => [o.kind, o.crm_account_id]), [["FUNDING_RECEIVABLE", "acct-lessor-b"]]);
    await refusedWith(fs.restructureFinancedSale(pool, sys, { salesAgreementId: s2.agreementId, toKind: "DIRECT_SALE", reason: "x", idempotencyKey: key() }),
      "FINANCING_RESTRUCTURE_REFUSED");
    await assert.rejects(q(`DELETE FROM eos_commercial.financing_restructures WHERE id=$1`, [rf.restructureId]), /append-only/);
    // Restructure only from a declined / cancelled arrangement -- never an open one.
    const s3 = await sale(); await arrange(s3.agreementId);
    await refusedWith(fs.restructureFinancedSale(pool, sys, { salesAgreementId: s3.agreementId, toKind: "DIRECT_SALE", reason: "x", idempotencyKey: key() }), "FINANCING_RESTRUCTURE_REFUSED");
  });

  await t.test("Q. an entitled or funded arrangement cannot use the pre-funding restructure", async () => {
    for (const funded of [false, true]) {
      const s0 = await sale(); const a = await arrange(s0.agreementId); await prepare(s0.salesOrderId); await entitle(a.arrangementId);
      if (funded) await move(a.arrangementId, "FUNDED");
      await refusedWith(fs.restructureFinancedSale(pool, sys, { salesAgreementId: s0.agreementId, toKind: "DIRECT_SALE", reason: "x", idempotencyKey: key() }), "FINANCING_RESTRUCTURE_REFUSED");
      await refusedWith(move(a.arrangementId, "CANCELLED"), "FINANCING_TRANSITION_REFUSED");
    }
  });

  await t.test("R (#203). a financed trade-in is now GOVERNED: total = cash contribution + trade-in credit + financed amount", async () => {
    const tr = await sale({ tradeIn: 3000 });
    await arrange(tr.agreementId);
    const out = await prepare(tr.salesOrderId);
    const p = await packageRow(out.packageId);
    assert.deepEqual([out.status, p.total_minor, p.trade_in_minor, p.customer_contribution_minor, p.financed_amount_minor], ["READY", "33000", "3000", "0", "30000"],
      "the trade-in buys down what the provider finances -- never cash, never a discount");
    const mis = await sale({ down: 5000 }); await arrange(mis.agreementId, { customerContributionMinor: 4000 });
    assert.deepEqual((await prepare(mis.salesOrderId)).readinessExceptions, ["FINANCING_CONTRIBUTION_MISMATCH"]);
    const all = await sale({ down: 33000 }); await arrange(all.agreementId, { customerContributionMinor: 33000 });
    assert.deepEqual((await prepare(all.salesOrderId)).readinessExceptions, ["FINANCED_AMOUNT_INVALID"]);
    const ok = await sale(); await arrange(ok.agreementId);
    assert.equal((await prepare(ok.salesOrderId)).status, "READY");
  });

  await t.test("S / T. the financed accounting handoff carries BOTH parties (payload v2); deterministic adapter only", async () => {
    const dest = await fin.configureAccountingDestination(pool, sys, { operatingCompanyId: "taylor", displayName: "Taylor test ledger", providerKey: TEST_ADAPTER_KEY, activate: true });
    const s0 = await sale({ down: 8000 });
    const a = await arrange(s0.agreementId, { customerContributionMinor: 8000, providerReference: "PROV-APP-2002" });
    const out = await prepare(s0.salesOrderId);
    assert.equal(out.consequence.handoff, null, "no handoff before entitlement");
    const ent = await entitle(a.arrangementId);
    const h = ent.consequences[0].handoff;
    assert.equal(h.status, "READY_FOR_DELIVERY");
    const built = await delivery.buildAccountingPayload(pool, T, h.id);
    const comp = built.payload.composition;
    assert.equal(built.payload.contract.version, 2);
    assert.deepEqual([comp.kind, comp.currency, comp.totalCommercialMinor], ["FINANCED_SALE", "USD", "33000"]);
    assert.deepEqual([comp.commercialCustomer.crmAccountId, comp.commercialCustomer.contributionMinor, comp.commercialCustomer.receivable.kind, comp.commercialCustomer.receivable.amountMinor],
      ["acct-harbor", "8000", "RECEIVABLE", "8000"]);
    assert.deepEqual([comp.financingProvider.crmAccountId, comp.financingProvider.financedAmountMinor, comp.financingProvider.receivable.kind,
      comp.financingProvider.providerReference, comp.financingProvider.fundingStatus, comp.financingProvider.approvalEvidence.signed, comp.financingProvider.approvalEvidence.approved],
      ["acct-lessor-a", "25000", "FUNDING_RECEIVABLE", "PROV-APP-2002", "FUNDING_ENTITLED", true, true]);
    assert.deepEqual([built.payload.billingPackage.id, built.payload.billingPackage.salesOrderId, built.payload.operatingCompany.id], [out.packageId, s0.salesOrderId, "taylor"]);
    assert.equal("receivable" in built.payload || "customer" in built.payload, false, "v2 does not carry the direct-sale single-party shape");
    const adapter = deterministicAccountingAdapter(["ACK"]);
    const r = await delivery.deliverAccountingHandoff({ pool, adapters: { [adapter.key]: adapter } }, sys, { handoffId: h.id, idempotencyKey: key() });
    assert.equal(r.attemptOutcome, "ACKNOWLEDGED");
    assert.equal((await one(`SELECT payload_contract_version FROM eos_finance.accounting_handoff_attempts WHERE id=$1`, [r.attemptId])).payload_contract_version, 2);
    assert.equal((await q(`SELECT count(*)::int n FROM eos_finance.billing_packages WHERE sales_order_id=$1`, [s0.salesOrderId])).rows[0].n, 1, "ONE commercial sale");
    void dest;
  });

  await t.test("U. direct sales are unchanged: same package content, customer receivable for the total, v1 handoff; a bare lease flag stays held", async () => {
    const i = ++n;
    await q(`INSERT INTO eos_commercial.sales_agreements (id, tenant_id, sales_agreement_number, account_id, owner_employee_id, state, accepted_at, accepted_by,
               is_lease, operating_company_key, currency, shipping_minor, install_charge_minor, tax_minor, down_payment_minor, trade_in_minor, created_by, updated_by,
               tax_evidence_status, tax_evidence_currency, tax_evidence_recorded_by, tax_evidence_recorded_at)
             VALUES ($1,$2,$1,'acct-harbor','e-seller','ACCEPTED',now(),'f',false,'taylor','USD',0,0,500,0,0,'f','f','DETERMINED','USD','f',now())`, [`sa-d-${i}`, T]);
    await q(`INSERT INTO eos_commercial.sales_orders (id, tenant_id, sales_order_number, account_id, owner_employee_id, operating_company_key, state, sales_channel, currency, sales_agreement_id, created_by, updated_by)
             VALUES ($1,$2,$1,'acct-harbor','e-seller','taylor','IN_FULFILLMENT','RETAIL','USD',$3,'f','f')`, [`so-d-${i}`, T, `sa-d-${i}`]);
    await q(`INSERT INTO eos_commercial.sales_order_lines (tenant_id, sales_order_id, line_number, kind, ref, business_unit, ordered_qty, unit_price_minor) VALUES ($1,$2,1,'SERVICE','INSTALL-STANDARD','INSTALLATION',1,10000)`, [T, `so-d-${i}`]);
    await q(`INSERT INTO eos_commercial.sales_order_fulfillments (id, tenant_id, sales_order_id, line_number, line_kind, line_ref, quantity, source_kind, source_work_order_id, evidence_kind, operating_company_key, operating_company_id, account_id, fulfilled_at, recorded_by)
             VALUES ($1,$2,$3,1,'SERVICE','INSTALL-STANDARD',1,'WORK_ORDER_COMPLETION','wo-d','SERVICE_PERFORMED','taylor','taylor','acct-harbor',now(),'f')`, [`ful-d-${i}`, T, `so-d-${i}`]);
    const d = await prepare(`so-d-${i}`);
    const p = await packageRow(d.packageId);
    assert.deepEqual([d.status, p.commercial_disposition, p.obligor_basis, p.financing_arrangement_id, p.customer_contribution_minor, p.financed_amount_minor],
      ["READY", "SALE", "DIRECT_SALE_CUSTOMER", null, null, null]);
    assert.deepEqual((await obligations(d.packageId)).map((o) => [o.kind, o.outstanding, o.crm_account_id]), [["RECEIVABLE", "10500", "acct-harbor"]]);
    const built = await delivery.buildAccountingPayload(pool, T, d.consequence.handoff.id);
    assert.deepEqual([built.payload.contract.version, built.payload.receivable.amountMinor, "composition" in built.payload], [1, "10500", false], "v1 unchanged");
    assert.equal((await prepare(`so-d-${i}`)).outcome, "replayed", "a direct package's content fingerprint is unchanged");
    const lease = await sale();
    assert.deepEqual((await prepare(lease.salesOrderId)).readinessExceptions, ["UNSUPPORTED_FINANCIAL_OBLIGOR"]);
  });

  await t.test("company separation: a Ventana financed sale is Ventana's", async () => {
    const s0 = await sale({ company: "ventana" });
    const a = await arrange(s0.agreementId);
    const out = await prepare(s0.salesOrderId);
    await entitle(a.arrangementId);
    assert.deepEqual((await obligations(out.packageId)).map((o) => o.operating_company_id), ["ventana"]);
  });
});
