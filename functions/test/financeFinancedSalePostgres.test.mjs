// FINANCING-PROVIDER FINANCED SALES (Owner ruling #200, 2026-10-02; DECISIONS #200; migration 1764480000000).
// Proofs A–O against real PostgreSQL: one Taylor commercial sale whose commercial customer is unchanged, paid by a customer
// contribution (0 or positive) and a financed amount owed by the financing provider (a FUNDING_RECEIVABLE, once the
// governed funding entitlement is reached) -- never overlapping, never customer A/R for the financed portion.
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
  const sale = async ({ down = 0, tradeIn = 0, price = 30000, tax = 2000, shipping = 1000, company = "taylor" } = {}) => {
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
    await q(`INSERT INTO eos_commercial.sales_order_fulfillments (id, tenant_id, sales_order_id, line_number, line_kind, line_ref, quantity, source_kind,
               source_work_order_id, evidence_kind, operating_company_key, operating_company_id, account_id, fulfilled_at, recorded_by)
             VALUES ($1,$2,$3,1,'SERVICE','INSTALL-STANDARD',1,'WORK_ORDER_COMPLETION',$4,'SERVICE_PERFORMED',$5,$5,'acct-harbor',now(),'f')`,
      [`ful-${i}`, T, so, `wo-${i}`, company]);
    return { agreementId: ag, salesOrderId: so };
  };
  let k = 0;
  const key = () => `k-${++k}`;
  const arrange = (agreementId, over = {}) => fs.recordFinancingArrangement(pool, sys, { salesAgreementId: agreementId, financingProviderAccountId: "acct-lessor-a",
    arrangementKind: "LEASE", customerContributionMinor: 0, idempotencyKey: key(), ...over });
  const move = (arrangementId, toStatus, extra = {}) => fs.transitionFinancingArrangement(pool, sys, { arrangementId, toStatus, reason: `to ${toStatus}`, idempotencyKey: key(), ...extra });
  const entitle = async (id) => { await move(id, "APPROVED"); return move(id, "FUNDING_ENTITLED", { fundingEntitlementBasis: "SAMPLE: provider funding milestone met" }); };
  const prepare = (salesOrderId) => pkg.prepareBillingPackage(pool, sys, { salesOrderId });
  const obligations = async (packageId) => (await q(`SELECT o.kind, o.status, o.operating_company_id, b.outstanding_minor::text AS outstanding, cp.kind AS cp_kind, cp.crm_account_id
      FROM eos_finance.obligations o JOIN eos_finance.obligation_balances b ON b.obligation_id = o.id JOIN eos_finance.financial_counterparties cp ON cp.id = o.counterparty_id
      WHERE o.tenant_id=$1 AND o.source_domain='BILLING_PACKAGE' AND o.source_record_id=$2 ORDER BY o.kind`, [T, packageId])).rows;
  const packageRow = (id) => one(`SELECT * FROM eos_finance.billing_packages WHERE id=$1`, [id]);
  const customerAR = async () => (await q(`SELECT o.kind, b.originated_minor::text AS amount, o.source_record_id FROM eos_finance.obligations o
      JOIN eos_finance.obligation_balances b ON b.obligation_id=o.id JOIN eos_finance.financial_counterparties cp ON cp.id=o.counterparty_id
      WHERE o.tenant_id=$1 AND cp.crm_account_id='acct-harbor' AND o.status <> 'VOID'`, [T])).rows;

  await t.test("arrangement validation: governed provider, never the customer, explicit contribution, provider-neutral", async () => {
    const s = await sale();
    await refusedWith(arrange(s.agreementId, { financingProviderAccountId: "acct-plain" }), "FINANCING_PROVIDER_NOT_GOVERNED");
    await refusedWith(arrange(s.agreementId, { financingProviderAccountId: "acct-harbor" }), "FINANCING_PROVIDER_IS_CUSTOMER");
    await refusedWith(arrange(s.agreementId, { customerContributionMinor: undefined }), "CUSTOMER_CONTRIBUTION_INVALID");
    await refusedWith(arrange(s.agreementId, { customerContributionMinor: -1 }), "CUSTOMER_CONTRIBUTION_INVALID");
    await refusedWith(arrange(s.agreementId, { arrangementKind: "RENTAL" }), "ARRANGEMENT_KIND_INVALID");
    await refusedWith(arrange(s.agreementId, { fundedBy: "x" }), "FIELD_NOT_ACCEPTED");
    // O: any governed provider works -- a second, unrelated provider organization is equally valid.
    const r = await arrange(s.agreementId, { financingProviderAccountId: "acct-lessor-b", arrangementKind: "FINANCING" });
    assert.equal(r.status, "APPLIED");
    await refusedWith(arrange(s.agreementId), "FINANCING_ARRANGEMENT_EXISTS");
  });

  await t.test("A / B / C / F / M. zero contribution: one package, customer unchanged, provider funds, NOTHING until funding entitlement", async () => {
    const s = await sale({ down: 0 });
    const a = await arrange(s.agreementId, { customerContributionMinor: 0, providerReference: "PROV-APP-1001" });
    const out = await prepare(s.salesOrderId);
    assert.deepEqual([out.outcome, out.status, out.totalMinor], ["recorded", "READY", "33000"]);
    assert.deepEqual(out.consequence, { financing: "HELD_UNTIL_FUNDING_ENTITLEMENT", arrangementStatus: "APPLIED", fundingReceivable: null, contributionReceivable: null });
    const p = await packageRow(out.packageId);
    const customerCp = await fin.ensureExternalCounterparty(pool, sys, "acct-harbor");
    const providerCp = await fin.ensureExternalCounterparty(pool, sys, "acct-lessor-a");
    assert.equal(p.commercial_customer_account_id, "acct-harbor", "A: the customer stays the commercial customer");
    assert.equal(p.counterparty_id, customerCp.id, "A: the customer remains the customer counterparty");
    assert.equal(p.financing_provider_counterparty_id, providerCp.id, "B: the provider is the financing provider");
    assert.equal(p.operating_company_id, "taylor", "C: Taylor is the seller");
    assert.deepEqual([p.commercial_disposition, p.obligor_basis, p.customer_contribution_minor, p.financed_amount_minor, p.financing_arrangement_id],
      ["FINANCED_SALE", "FINANCING_PROVIDER_FUNDED", "0", "33000", a.arrangementId], "F: a zero contribution; the provider finances the whole total");
    assert.equal((await q(`SELECT count(*)::int n FROM eos_finance.billing_packages WHERE sales_order_id=$1`, [s.salesOrderId])).rows[0].n, 1, "ONE sale, ONE package");
    assert.equal((await one(`SELECT commercial_disposition FROM eos_commercial.sales_order_line_billing_eligibility WHERE sales_order_id=$1`, [s.salesOrderId])).commercial_disposition,
      "FINANCED_SALE", "the derived Commercial eligibility names it too");
    // M: APPROVED is not entitlement.
    await move(a.arrangementId, "APPROVED");
    assert.deepEqual(await obligations(out.packageId), [], "M: approval establishes nothing");
    const replay = await prepare(s.salesOrderId);
    assert.deepEqual([replay.outcome, replay.consequence.financing], ["replayed", "HELD_UNTIL_FUNDING_ENTITLEMENT"]);
    await refusedWith(move(a.arrangementId, "FUNDING_ENTITLED"), "FUNDING_ENTITLEMENT_BASIS_REQUIRED");
    const ent = await move(a.arrangementId, "FUNDING_ENTITLED", { fundingEntitlementBasis: "SAMPLE: provider funding milestone met" });
    assert.equal(ent.consequences[0].financing, "ESTABLISHED");
    // D / E: the financed portion is owed by the provider -- the customer has NO receivable at all.
    assert.deepEqual(await obligations(out.packageId), [{ kind: "FUNDING_RECEIVABLE", status: "OPEN", operating_company_id: "taylor", outstanding: "33000",
      cp_kind: "EXTERNAL_ORGANIZATION", crm_account_id: "acct-lessor-a" }]);
    assert.deepEqual((await customerAR()).filter((r) => r.source_record_id === out.packageId), [], "E: no financed A/R for the customer");
    const again = await prepare(s.salesOrderId);
    assert.deepEqual([again.outcome, again.consequence.fundingReceivable.outcome], ["replayed", "replayed"], "idempotent");
    assert.equal((await obligations(out.packageId)).length, 1);
    const facts = (await q(`SELECT fact_type, basis, amount_minor::text FROM eos_finance.financial_facts WHERE source_record_id=$1`, [out.packageId])).rows;
    assert.deepEqual(facts, [{ fact_type: "FUNDING_RECEIVABLE_ORIGINATED", basis: "FINANCED_SALE_FINANCED_AMOUNT", amount_minor: "33000" }]);
    const hist = await fs.readFinancingArrangement(pool, T, a.arrangementId);
    assert.deepEqual(hist.events.map((e) => e.to_status), ["APPLIED", "APPROVED", "FUNDING_ENTITLED"]);
    assert.equal(hist.arrangement.provider_reference, "PROV-APP-1001");
  });

  await t.test("D / G / H / I / J / K. positive contribution: financed = total - contribution; two receivables, two parties, no overlap", async () => {
    const s = await sale({ down: 8000 });
    const a = await arrange(s.agreementId, { customerContributionMinor: 8000 });
    await entitle(a.arrangementId); // entitled BEFORE the package exists: the package establishes on READY
    const out = await prepare(s.salesOrderId);
    const p = await packageRow(out.packageId);
    assert.deepEqual([p.total_minor, p.customer_contribution_minor, p.financed_amount_minor], ["33000", "8000", "25000"], "G / H: 33000 = 8000 + 25000");
    assert.equal(BigInt(p.total_minor), BigInt(p.customer_contribution_minor) + BigInt(p.financed_amount_minor), "I");
    const obs = await obligations(out.packageId);
    assert.deepEqual(obs.map((o) => [o.kind, o.outstanding, o.crm_account_id]),
      [["FUNDING_RECEIVABLE", "25000", "acct-lessor-a"], ["RECEIVABLE", "8000", "acct-harbor"]], "D / K: Taylor's claims are against two distinct parties");
    assert.equal(obs.reduce((n2, o) => n2 + BigInt(o.outstanding), 0n), 33000n, "J: together exactly the total -- never overlapping");
    const facts = (await q(`SELECT fact_type, basis FROM eos_finance.financial_facts WHERE source_record_id=$1 ORDER BY fact_type`, [out.packageId])).rows;
    assert.deepEqual(facts.map((f) => f.basis).sort(), ["FINANCED_SALE_CUSTOMER_CONTRIBUTION", "FINANCED_SALE_FINANCED_AMOUNT"]);
    // K: the customer's payments to the provider are not Taylor records -- there is no obligation from the customer to the provider.
    assert.equal((await q(`SELECT count(*)::int n FROM eos_finance.obligations o JOIN eos_finance.financial_counterparties cp ON cp.id=o.counterparty_id
        WHERE o.tenant_id=$1 AND cp.crm_account_id='acct-lessor-a' AND o.kind <> 'FUNDING_RECEIVABLE'`, [T])).rows[0].n, 0);
    // The database refuses a second receivable of the same kind for the package.
    const customerCp = await fin.ensureExternalCounterparty(pool, sys, "acct-harbor");
    await assert.rejects(fin.openObligation(pool, sys, { operatingCompanyId: "taylor", counterpartyId: customerCp.id, kind: "RECEIVABLE", currency: "USD",
      sourceDomain: "BILLING_PACKAGE", sourceRecordId: out.packageId, originationAmountMinor: 33000, basis: "X", effectiveAt: new Date(), idempotencyKey: "dup-ar" }));
    assert.equal((await obligations(out.packageId)).length, 2, "still exactly two");
    // The direct-sale path refuses a financed package outright (no duplicate customer A/R for the total).
    const c = await pool.connect();
    try { await c.query("BEGIN"); await refusedWith(pkg.establishPackageReceivableOn(c, sys, out.packageId), "UNSUPPORTED_FINANCIAL_OBLIGOR"); }
    finally { await c.query("ROLLBACK"); c.release(); }
  });

  await t.test("composition guards: contribution must be the Agreement's down payment; trade-in held; contribution >= total held; database invariant", async () => {
    const mis = await sale({ down: 5000 });
    await arrange(mis.agreementId, { customerContributionMinor: 4000 });
    const m = await prepare(mis.salesOrderId);
    assert.deepEqual([m.status, m.readinessExceptions], ["HELD", ["FINANCING_CONTRIBUTION_MISMATCH"]], "never billed twice or under-billed");
    const tr = await sale({ tradeIn: 3000 });
    await arrange(tr.agreementId);
    assert.deepEqual((await prepare(tr.salesOrderId)).readinessExceptions, ["FINANCING_TRADE_IN_UNGOVERNED"]);
    const all = await sale({ down: 33000 });
    await arrange(all.agreementId, { customerContributionMinor: 33000 });
    assert.deepEqual((await prepare(all.salesOrderId)).readinessExceptions, ["FINANCED_AMOUNT_INVALID"]);
    const ok = await sale();
    await arrange(ok.agreementId);
    const r = await prepare(ok.salesOrderId);
    await assert.rejects(q(`UPDATE eos_finance.billing_packages SET financed_amount_minor = 1 WHERE id=$1`, [r.packageId]), /BILLING_PACKAGE_IMMUTABLE/);
  });

  await t.test("M / 12. before funding: decline or cancel HOLDS (re-evaluated to HELD); nothing becomes customer A/R", async () => {
    for (const to of ["DECLINED", "CANCELLED"]) {
      const s = await sale({ down: 2000 });
      const a = await arrange(s.agreementId, { customerContributionMinor: 2000 });
      const first = await prepare(s.salesOrderId);
      assert.equal(first.status, "READY");
      const r = await move(a.arrangementId, to);
      assert.deepEqual([r.consequences[0].outcome, r.consequences[0].status, r.consequences[0].readinessExceptions], ["superseded", "HELD", ["FINANCING_NOT_AVAILABLE"]], to);
      assert.deepEqual(await obligations(first.packageId), [], `${to}: no receivable of either kind`);
      assert.deepEqual(await obligations(r.consequences[0].packageId), []);
      await refusedWith(move(a.arrangementId, "APPROVED"), "FINANCING_TRANSITION_REFUSED");
    }
  });

  await t.test("L / 9 / 12. after funding: terminal; never converts to customer A/R; no Taylor collection or repossession path", async () => {
    const s = await sale();
    const a = await arrange(s.agreementId);
    const out = await prepare(s.salesOrderId);
    await entitle(a.arrangementId);
    await move(a.arrangementId, "FUNDED", { providerReference: "PROV-FUND-77" });
    for (const to of ["DECLINED", "CANCELLED", "APPROVED", "FUNDING_ENTITLED", "APPLIED"]) {
      await refusedWith(move(a.arrangementId, to, to === "FUNDING_ENTITLED" ? { fundingEntitlementBasis: "x" } : {}), "FINANCING_TRANSITION_REFUSED");
    }
    await assert.rejects(q(`UPDATE eos_commercial.financing_arrangements SET status='CANCELLED' WHERE id=$1`, [a.arrangementId]), /TRANSITION_REFUSED/);
    await assert.rejects(q(`UPDATE eos_commercial.financing_arrangements SET commercial_customer_account_id='acct-plain' WHERE id=$1`, [a.arrangementId]), /IMMUTABLE/);
    await assert.rejects(q(`UPDATE eos_commercial.financing_arrangements SET provider_reference='OTHER' WHERE id=$1`, [a.arrangementId]), /recorded once/);
    await assert.rejects(q(`DELETE FROM eos_commercial.financing_arrangement_events WHERE arrangement_id=$1`, [a.arrangementId]), /append-only/);
    assert.deepEqual((await customerAR()).filter((r) => r.source_record_id === out.packageId), [], "the funded amount is never customer A/R");
    // A funding-entitled / funded financed package is not silently re-versioned (that would void the provider's receivable).
    const c = await pool.connect();
    try { await c.query("BEGIN"); await refusedWith(pkg.retirePackageReceivableOn(c, sys, out.packageId, "x"), "FINANCED_PACKAGE_FUNDING_ENTITLED"); }
    finally { await c.query("ROLLBACK"); c.release(); }
    assert.equal((await obligations(out.packageId))[0].status, "OPEN");
  });

  await t.test("N. direct sales are unchanged: same package content, customer receivable for the total, handoff; a bare lease flag stays held", async () => {
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
    assert.ok(d.consequence.handoff, "the direct sale's accounting handoff is unchanged");
    assert.equal((await prepare(`so-d-${i}`)).outcome, "replayed", "a direct package's content fingerprint is unchanged by the financed fields");
    // A bare lease flag with no governed arrangement stays HELD as before.
    const lease = await sale();
    assert.deepEqual((await prepare(lease.salesOrderId)).readinessExceptions, ["UNSUPPORTED_FINANCIAL_OBLIGOR"]);
  });

  await t.test("company separation: a Ventana financed sale is Ventana's; Consolidated never", async () => {
    const s = await sale({ company: "ventana" });
    const a = await arrange(s.agreementId);
    await entitle(a.arrangementId);
    const out = await prepare(s.salesOrderId);
    assert.deepEqual((await obligations(out.packageId)).map((o) => o.operating_company_id), ["ventana"]);
  });
});
