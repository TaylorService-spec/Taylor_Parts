// FINANCE FOUNDATION -- the company-scoped operational financial subledger core (Controller FINANCE TARGET MODEL ACCEPTANCE
// + FOUNDATION IMPLEMENTATION, 2026-10-01; DECISIONS #145, #190, #191; migration 1764420000000).
//
// Proves, against real PostgreSQL, the 18 Controller acceptance points: one operating company per fact (never CONSOLIDATED,
// fail closed), external vs internal counterparties, per-company profiles, a Saratoga-style financing counterparty that
// never replaces the customer, immutable idempotent facts, reversal / correction without mutation, single-company and
// single-counterparty obligations, no over-application, the acquisition-cost adapter (idempotent; no zero-cost truth), and
// per-company provider-neutral accounting destinations -- and that the foundation imports no Firebase.
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

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const T = "t-finance";
const actor = { tenantId: T, principalId: "p-finance-test" };
const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}
const refusedWith = async (p, code) => {
  await assert.rejects(p, (e) => { assert.equal(e.code, code, `${e.code}: ${e.message}`); return true; });
};

test("18. the finance foundation imports no Firebase (static)", () => {
  const src = readFileSync(new URL("../src/eosFinance/financeFoundation.ts", import.meta.url), "utf8");
  assert.equal(/firebase/i.test(src.replace(/no Firebase[^\n]*/gi, "")), false, "no Firebase import or reference in the foundation");
  const mig = readFileSync(new URL("../migrations/1764420000000_finance-foundation.sql", import.meta.url), "utf8");
  assert.equal(/quickbooks|business central|dynamics|netsuite|xero|sage/i.test(mig), false, "no accounting vendor is assumed");
});

test("Finance foundation over PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `finf_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
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

  // ── fixtures: a tenant, two operating companies (+ an inactive one), organizations, a supplier ──
  await q(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ($1,$1,$1)`, [T]);
  for (const [company, status] of [["taylor", "ACTIVE"], ["ventana", "ACTIVE"], ["dormantco", "INACTIVE"]]) {
    await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id, operating_company_id, status, source, established_by, updated_by)
             VALUES ($1,$2,$3,'fixture','fixture','fixture')`, [T, company, status]);
    await q(`INSERT INTO eos_policy.tenant_operating_company_keys (tenant_id, operating_company_id, operating_company_key, status, provenance, source, established_by, updated_by)
             VALUES ($1,$2,$2,$3,'NATIVE','fixture','fixture','fixture')`, [T, company, status]);
  }
  const account = async (id, rels) => {
    await q(`INSERT INTO eos_crm.accounts (id, tenant_id, name, status, created_by, updated_by) VALUES ($1,$2,$1,'ACTIVE','fixture','fixture')`, [id, T]);
    for (const r of rels) await q(`INSERT INTO eos_crm.account_relationship_types (tenant_id, account_id, relationship_type) VALUES ($1,$2,$3)`, [T, id, r]);
  };
  await account("acct-customer-a", ["CUSTOMER"]);
  await account("acct-dealer", ["CUSTOMER", "VENDOR"]);           // one organization in two relationships
  await account("acct-acme-supply", ["VENDOR"]);
  await account("acct-saratoga", ["FINANCING_PROVIDER"]);
  await q(`INSERT INTO eos_ops.suppliers (tenant_id, supplier_id, name, normalized_key, status, version, created_by, updated_by)
           VALUES ($1,'sup-acme','Acme Supply','acme supply','ACTIVE',1,'fixture','fixture')`, [T]);

  const fact = (over = {}) => ({ operatingCompanyId: "taylor", factClass: "COMMITMENT", factType: "SALES_ORDER_COMMITMENT", sourceDomain: "COMMERCIAL",
    sourceRecordId: "so-1", amountMinor: 125000, currency: "USD", basis: "SALES_ORDER_LINE_PRICE", effectiveAt: new Date("2026-10-01T12:00:00Z"),
    idempotencyKey: `k-${randomUUID()}`, ...over });

  await t.test("1-3 / 17. a fact needs exactly one ACTIVE operating company; unresolved and CONSOLIDATED fail closed", async () => {
    await refusedWith(fin.recordFinancialFact(pool, actor, fact({ operatingCompanyId: null })), "OPERATING_COMPANY_UNRESOLVED");
    await refusedWith(fin.recordFinancialFact(pool, actor, fact({ operatingCompanyId: "" })), "OPERATING_COMPANY_UNRESOLVED");
    await refusedWith(fin.recordFinancialFact(pool, actor, fact({ operatingCompanyId: "nowhere" })), "OPERATING_COMPANY_UNRESOLVED");
    await refusedWith(fin.recordFinancialFact(pool, actor, fact({ operatingCompanyId: "dormantco" })), "OPERATING_COMPANY_UNRESOLVED");
    await refusedWith(fin.recordFinancialFact(pool, actor, fact({ operatingCompanyId: "consolidated" })), "CONSOLIDATED_NOT_A_COMPANY");
    await refusedWith(fin.recordFinancialFact(pool, actor, fact({ operatingCompanyId: "CONSOLIDATED" })), "CONSOLIDATED_NOT_A_COMPANY");
    // Even a tenant that registered a company literally named "consolidated" cannot own a fact with it: the table refuses.
    await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id, operating_company_id, status, source, established_by, updated_by)
             VALUES ($1,'consolidated','ACTIVE','fixture','fixture','fixture')`, [T]);
    await assert.rejects(q(`INSERT INTO eos_finance.financial_facts (id, tenant_id, operating_company_id, fact_class, fact_type, source_domain, source_record_id,
        amount_minor, currency, basis, effective_at, idempotency_key, request_fingerprint, created_by)
        VALUES ('ff-x',$1,'consolidated','COMMITMENT','X_Y','D','r',1,'USD','b',now(),'k-cons','f','t')`, [T]), /financial_fact_not_consolidated/);
    await assert.rejects(q(`INSERT INTO eos_finance.obligations (id, tenant_id, operating_company_id, counterparty_id, kind, currency, source_domain, source_record_id, idempotency_key, created_by, updated_by)
        VALUES ('o-x',$1,'consolidated','none','RECEIVABLE','USD','D','r','k','t','t')`, [T]), /obligation_not_consolidated|foreign key/);
    await q(`DELETE FROM eos_policy.tenant_operating_companies WHERE tenant_id = $1 AND operating_company_id = 'consolidated'`, [T]);
    const ok = await fin.recordFinancialFact(pool, actor, fact());
    assert.equal(ok.outcome, "recorded");
    assert.equal(ok.fact.operatingCompanyId, "taylor");
    assert.equal(ok.fact.factClass, "COMMITMENT", "a commitment is its own class -- never revenue, receivable or posting");
  });

  let customer, saratoga, acme, dealer, taylorCp, ventanaCp;
  await t.test("4-5. external counterparties resolve through the organization; internal ones through the operating company", async () => {
    customer = await fin.ensureExternalCounterparty(pool, actor, "acct-customer-a");
    assert.deepEqual([customer.kind, customer.crmAccountId, customer.operatingCompanyId], ["EXTERNAL_ORGANIZATION", "acct-customer-a", null]);
    assert.equal((await fin.ensureExternalCounterparty(pool, actor, "acct-customer-a")).id, customer.id, "idempotent: one counterparty per organization");
    await refusedWith(fin.ensureExternalCounterparty(pool, actor, "acct-nobody"), "ORGANIZATION_NOT_FOUND");
    taylorCp = await fin.ensureInternalCounterparty(pool, actor, "taylor");
    ventanaCp = await fin.ensureInternalCounterparty(pool, actor, "ventana");
    assert.deepEqual([ventanaCp.kind, ventanaCp.operatingCompanyId, ventanaCp.crmAccountId], ["INTERNAL_OPERATING_COMPANY", "ventana", null]);
    await refusedWith(fin.ensureInternalCounterparty(pool, actor, "consolidated"), "CONSOLIDATED_NOT_A_COMPANY");
    assert.equal(Number((await q(`SELECT count(*)::int n FROM eos_crm.accounts WHERE tenant_id=$1 AND id IN ('taylor','ventana')`, [T])).rows[0].n), 0,
      "Taylor and Ventana are never CRM Accounts merely to be counterparties");
    // The backing-identity CHECK refuses a mixed or empty counterparty.
    await assert.rejects(q(`INSERT INTO eos_finance.financial_counterparties (id, tenant_id, kind, crm_account_id, operating_company_id, created_by)
        VALUES ('fcp-bad',$1,'EXTERNAL_ORGANIZATION','acct-dealer','taylor','t')`, [T]), /financial_counterparty_backing_identity/);
    // Supplier is a profile LINKED to its organization (not a second organization).
    await refusedWith(fin.linkSupplierToOrganization(pool, actor, { supplierId: "sup-acme", crmAccountId: "acct-customer-a" }), "ORGANIZATION_NOT_VENDOR");
    assert.equal((await fin.linkSupplierToOrganization(pool, actor, { supplierId: "sup-acme", crmAccountId: "acct-acme-supply" })).outcome, "LINKED");
    assert.equal((await fin.linkSupplierToOrganization(pool, actor, { supplierId: "sup-acme", crmAccountId: "acct-acme-supply" })).outcome, "NO_CHANGE");
    await refusedWith(fin.linkSupplierToOrganization(pool, actor, { supplierId: "sup-acme", crmAccountId: "acct-dealer" }), "SUPPLIER_ALREADY_LINKED");
    acme = await fin.counterpartyForSupplier(pool, actor, "sup-acme");
    assert.equal(acme.crmAccountId, "acct-acme-supply");
    dealer = await fin.ensureExternalCounterparty(pool, actor, "acct-dealer");
    assert.deepEqual(await fin.organizationRelationships(pool, T, "acct-dealer"), ["CUSTOMER", "VENDOR"], "one organization, two relationships, one counterparty");
  });

  await t.test("6. the same organization holds distinct profiles with Taylor and Ventana", async () => {
    await fin.setCounterpartyCompanyProfile(pool, actor, { counterpartyId: dealer.id, operatingCompanyId: "taylor", paymentTerms: "NET_30", accountingReference: "T-CUST-0042" });
    await fin.setCounterpartyCompanyProfile(pool, actor, { counterpartyId: dealer.id, operatingCompanyId: "ventana", paymentTerms: "COD", accountingReference: "V-DLR-7" });
    const tp = await fin.readCounterpartyCompanyProfile(pool, T, dealer.id, "taylor");
    const vp = await fin.readCounterpartyCompanyProfile(pool, T, dealer.id, "ventana");
    assert.deepEqual([tp.paymentTerms, tp.accountingReference, vp.paymentTerms, vp.accountingReference], ["NET_30", "T-CUST-0042", "COD", "V-DLR-7"]);
    await refusedWith(fin.setCounterpartyCompanyProfile(pool, actor, { counterpartyId: dealer.id, operatingCompanyId: "consolidated" }), "CONSOLIDATED_NOT_A_COMPANY");
    await refusedWith(fin.setCounterpartyCompanyProfile(pool, actor, { counterpartyId: taylorCp.id, operatingCompanyId: "taylor" }), "COUNTERPARTY_IS_SELF");
    assert.equal((await fin.setCounterpartyCompanyProfile(pool, actor, { counterpartyId: taylorCp.id, operatingCompanyId: "ventana", paymentTerms: "NET_60" })).paymentTerms, "NET_60",
      "Ventana's relationship with Taylor as a counterparty");
  });

  let funding;
  await t.test("7. a Saratoga-style financing counterparty owns the obligation without replacing the customer", async () => {
    saratoga = await fin.ensureExternalCounterparty(pool, actor, "acct-saratoga");
    // The financed obligation is Taylor's FUNDING_RECEIVABLE from Saratoga; the customer stays on the originating record.
    funding = await fin.openObligation(pool, actor, { operatingCompanyId: "taylor", counterpartyId: saratoga.id, kind: "FUNDING_RECEIVABLE", currency: "USD",
      sourceDomain: "COMMERCIAL", sourceRecordId: "so-financed-1", originationAmountMinor: 900000, basis: "FINANCED_AMOUNT",
      effectiveAt: new Date("2026-10-01T15:00:00Z"), idempotencyKey: "obl-fund-so-financed-1" });
    assert.equal(funding.balance.counterpartyId, saratoga.id);
    assert.equal(customer.crmAccountId, "acct-customer-a", "the commercial customer keeps its own identity");
    assert.notEqual(saratoga.id, customer.id, "obligor and customer are different parties");
    // Only an organization governed as a FINANCING_PROVIDER can be a funding obligor -- the customer cannot.
    await refusedWith(fin.openObligation(pool, actor, { operatingCompanyId: "taylor", counterpartyId: customer.id, kind: "FUNDING_RECEIVABLE", currency: "USD",
      sourceDomain: "COMMERCIAL", sourceRecordId: "so-financed-2", originationAmountMinor: 1000, basis: "FINANCED_AMOUNT", effectiveAt: new Date(),
      idempotencyKey: "obl-fund-bad" }), "FUNDING_COUNTERPARTY_NOT_FINANCING_PROVIDER");
    // A customer-paid portion is an ordinary RECEIVABLE from the customer on the same Sales Order.
    const deposit = await fin.openObligation(pool, actor, { operatingCompanyId: "taylor", counterpartyId: customer.id, kind: "RECEIVABLE", currency: "USD",
      sourceDomain: "COMMERCIAL", sourceRecordId: "so-financed-1", originationAmountMinor: 50000, basis: "CUSTOMER_PAID_PORTION", effectiveAt: new Date(),
      idempotencyKey: "obl-recv-so-financed-1" });
    assert.notEqual(deposit.obligationId, funding.obligationId);
  });

  await t.test("8. idempotency: the same key + same content replays; different content conflicts", async () => {
    const k = "k-idem-1";
    const a = await fin.recordFinancialFact(pool, actor, fact({ idempotencyKey: k }));
    const b = await fin.recordFinancialFact(pool, actor, fact({ idempotencyKey: k }));
    assert.deepEqual([a.outcome, b.outcome, b.fact.id], ["recorded", "replayed", a.fact.id]);
    await refusedWith(fin.recordFinancialFact(pool, actor, fact({ idempotencyKey: k, amountMinor: 1 })), "IDEMPOTENCY_CONFLICT");
    assert.equal(Number((await q(`SELECT count(*)::int n FROM eos_finance.financial_facts WHERE tenant_id=$1 AND idempotency_key=$2`, [T, k])).rows[0].n), 1);
    await refusedWith(fin.recordFinancialFact(pool, actor, fact({ amountMinor: 0 })), "AMOUNT_INVALID");
  });

  await t.test("9-10. reversal and correction preserve the original fact; facts are append-only", async () => {
    const original = (await fin.recordFinancialFact(pool, actor, fact({ factType: "PURCHASE_ORDER_COMMITMENT", sourceDomain: "PURCHASING", sourceRecordId: "po-9", amountMinor: 4100 }))).fact;
    const rev = await fin.reverseFinancialFact(pool, actor, { factId: original.id, reason: "PO cancelled", idempotencyKey: "rev-po-9" });
    assert.deepEqual([rev.fact.amountMinor, rev.fact.reversesFactId, rev.fact.sourceRecordId, rev.fact.reason], [-4100n, original.id, "po-9", "PO cancelled"]);
    assert.deepEqual(await fin.readFinancialFact(pool, T, original.id), original, "the original is untouched");
    await refusedWith(fin.reverseFinancialFact(pool, actor, { factId: original.id, reason: "again", idempotencyKey: "rev-po-9-b" }), "FACT_ALREADY_REVERSED");
    assert.equal(Number((await q(`SELECT count(*)::int n FROM eos_finance.financial_facts WHERE tenant_id=$1 AND reverses_fact_id=$2`, [T, original.id])).rows[0].n), 1,
      "a fact is reversed at most once");
    await refusedWith(fin.reverseFinancialFact(pool, actor, { factId: original.id, reason: "", idempotencyKey: "rev-x" }), "REASON_REQUIRED");
    // CORRECT = reverse + replacement, linked to the original and its source record.
    const priced = (await fin.recordFinancialFact(pool, actor, fact({ factType: "PURCHASE_ORDER_COMMITMENT", sourceDomain: "PURCHASING", sourceRecordId: "po-10", amountMinor: 4100 }))).fact;
    const corr = await fin.correctFinancialFact(pool, actor, { factId: priced.id, reason: "price was 39.00", idempotencyKey: "corr-po-10", replacement: { amountMinor: 3900 } });
    assert.deepEqual([corr.reversal.reversesFactId, corr.reversal.amountMinor, corr.replacement.correctsFactId, corr.replacement.amountMinor, corr.replacement.sourceRecordId],
      [priced.id, -4100n, priced.id, 3900n, "po-10"]);
    assert.deepEqual(await fin.readFinancialFact(pool, T, priced.id), priced, "correction does not mutate the original");
    // Append-only at the database.
    await assert.rejects(q(`UPDATE eos_finance.financial_facts SET amount_minor = 1 WHERE tenant_id=$1 AND id=$2`, [T, priced.id]));
    await assert.rejects(q(`DELETE FROM eos_finance.financial_facts WHERE tenant_id=$1 AND id=$2`, [T, priced.id]));
    // A reversal must be the exact opposite; a replacement without a reversal is refused.
    await assert.rejects(q(`INSERT INTO eos_finance.financial_facts (id, tenant_id, operating_company_id, fact_class, fact_type, source_domain, source_record_id,
        amount_minor, currency, basis, effective_at, idempotency_key, request_fingerprint, reverses_fact_id, reason, created_by)
        VALUES ('ff-bad-rev',$1,'taylor','COMMITMENT','SALES_ORDER_COMMITMENT','COMMERCIAL','so-1',-1,'USD','b',now(),'k-bad-rev','f',$2,'x','t')`,
      [T, (await fin.recordFinancialFact(pool, actor, fact())).fact.id]), /REVERSAL_MISMATCH/);
  });

  await t.test("11-13. an obligation belongs to one company and one counterparty; balances derive; settlement cannot over-apply", async () => {
    const recv = await fin.openObligation(pool, actor, { operatingCompanyId: "ventana", counterpartyId: dealer.id, kind: "RECEIVABLE", currency: "USD",
      sourceDomain: "COMMERCIAL", sourceRecordId: "so-v-1", originationAmountMinor: 10000, basis: "SALES_ORDER", effectiveAt: new Date(), idempotencyKey: "obl-v-1" });
    assert.deepEqual([recv.balance.operatingCompanyId, recv.balance.counterpartyId, recv.balance.outstandingMinor, recv.balance.status], ["ventana", dealer.id, 10000n, "OPEN"]);
    assert.equal((await fin.openObligation(pool, actor, { operatingCompanyId: "ventana", counterpartyId: dealer.id, kind: "RECEIVABLE", currency: "USD",
      sourceDomain: "COMMERCIAL", sourceRecordId: "so-v-1", originationAmountMinor: 10000, basis: "SALES_ORDER", effectiveAt: recv.origination.effectiveAt, idempotencyKey: "obl-v-1" })).outcome, "replayed");
    // Company and counterparty are identity: never rewritten.
    await assert.rejects(q(`UPDATE eos_finance.obligations SET operating_company_id='taylor' WHERE tenant_id=$1 AND id=$2`, [T, recv.obligationId]), /OBLIGATION_IMMUTABLE/);
    await assert.rejects(q(`UPDATE eos_finance.obligations SET counterparty_id=$3 WHERE tenant_id=$1 AND id=$2`, [T, recv.obligationId, customer.id]), /OBLIGATION_IMMUTABLE/);
    // A fact of another company or counterparty cannot attach to it.
    await assert.rejects(q(`INSERT INTO eos_finance.financial_facts (id, tenant_id, operating_company_id, counterparty_id, fact_class, fact_type, source_domain, source_record_id,
        amount_minor, currency, basis, effective_at, idempotency_key, request_fingerprint, obligation_id, created_by)
        VALUES ('ff-cross',$1,'taylor',$2,'SETTLEMENT','SETTLEMENT','FINANCE','pmt',1,'USD','b',now(),'k-cross','f',$3,'t')`, [T, dealer.id, recv.obligationId]), /OBLIGATION_FACT_MISMATCH/);
    const s1 = await fin.recordSettlement(pool, actor, { obligationId: recv.obligationId, amountMinor: 4000, basis: "PAYMENT", effectiveAt: new Date(), idempotencyKey: "set-v-1a", sourceDomain: "FINANCE", sourceRecordId: "pmt-1" });
    assert.deepEqual([s1.balance.settledMinor, s1.balance.outstandingMinor, s1.balance.status], [4000n, 6000n, "PARTIAL"]);
    await refusedWith(fin.recordSettlement(pool, actor, { obligationId: recv.obligationId, amountMinor: 6001, basis: "PAYMENT", effectiveAt: new Date(), idempotencyKey: "set-v-1b", sourceDomain: "FINANCE", sourceRecordId: "pmt-2" }), "SETTLEMENT_OVER_APPLIED");
    const s2 = await fin.recordSettlement(pool, actor, { obligationId: recv.obligationId, amountMinor: 6000, basis: "PAYMENT", effectiveAt: new Date(), idempotencyKey: "set-v-1c", sourceDomain: "FINANCE", sourceRecordId: "pmt-3" });
    assert.deepEqual([s2.balance.outstandingMinor, s2.balance.status], [0n, "SETTLED"]);
    // Reversing a settlement re-opens the balance (status follows the facts).
    const rev = await fin.reverseFinancialFact(pool, actor, { factId: s2.settlement.id, reason: "payment bounced", idempotencyKey: "rev-set-v-1c" });
    const after = await fin.readObligationBalance(pool, T, recv.obligationId);
    assert.deepEqual([rev.fact.amountMinor, after.outstandingMinor, after.status], [-6000n, 6000n, "PARTIAL"]);
    // Intercompany: Taylor owes Ventana / Ventana is owed by Taylor -- two records, one per company, linked by correlation only.
    const ic = randomUUID();
    const vSide = await fin.openObligation(pool, actor, { operatingCompanyId: "ventana", counterpartyId: taylorCp.id, kind: "INTERCOMPANY_RECEIVABLE", currency: "USD",
      sourceDomain: "COMMERCIAL", sourceRecordId: "so-v-to-t", originationAmountMinor: 300000, basis: "INTERCOMPANY_SALE", effectiveAt: new Date(), idempotencyKey: "ic-v", correlationId: ic });
    const tSide = await fin.openObligation(pool, actor, { operatingCompanyId: "taylor", counterpartyId: ventanaCp.id, kind: "INTERCOMPANY_PAYABLE", currency: "USD",
      sourceDomain: "PURCHASING", sourceRecordId: "po-t-from-v", originationAmountMinor: 300000, basis: "INTERCOMPANY_PURCHASE", effectiveAt: new Date(), idempotencyKey: "ic-t", correlationId: ic });
    assert.notEqual(vSide.obligationId, tSide.obligationId);
    assert.deepEqual([vSide.origination.correlationId, tSide.origination.correlationId], [ic, ic]);
    await refusedWith(fin.openObligation(pool, actor, { operatingCompanyId: "taylor", counterpartyId: taylorCp.id, kind: "INTERCOMPANY_PAYABLE", currency: "USD",
      sourceDomain: "PURCHASING", sourceRecordId: "po-self", originationAmountMinor: 1, basis: "X", effectiveAt: new Date(), idempotencyKey: "ic-self" }), "COUNTERPARTY_IS_SELF");
    await refusedWith(fin.openObligation(pool, actor, { operatingCompanyId: "taylor", counterpartyId: dealer.id, kind: "INTERCOMPANY_PAYABLE", currency: "USD",
      sourceDomain: "PURCHASING", sourceRecordId: "po-ext", originationAmountMinor: 1, basis: "X", effectiveAt: new Date(), idempotencyKey: "ic-ext" }), "OBLIGATION_COUNTERPARTY_KIND");
    await refusedWith(fin.openObligation(pool, actor, { operatingCompanyId: "taylor", counterpartyId: ventanaCp.id, kind: "PAYABLE", currency: "USD",
      sourceDomain: "PURCHASING", sourceRecordId: "po-int", originationAmountMinor: 1, basis: "X", effectiveAt: new Date(), idempotencyKey: "pay-int" }), "OBLIGATION_COUNTERPARTY_KIND");
  });

  await t.test("14-15. acquisition-cost adapter: priced receipt -> one fact, replay -> nothing new; unpriced -> exception, never zero cost", async () => {
    const receipt = async (id, lines) => {
      await q(`INSERT INTO eos_ops.receiving_orders (id, tenant_id, operating_company_key, source_kind, source_purchase_order_id, receiving_location_type,
                 receiving_location_id, status, idempotency_key, received_at, created_by, updated_by)
               VALUES ($1,$2,'taylor','PURCHASE_ORDER',$3,'WAREHOUSE','taylor-main','CHECKED_IN',$1,'2026-10-01T09:00:00Z','fixture','fixture')`, [id, T, `po-${id}`]);
      for (const l of lines) {
        await q(`INSERT INTO eos_ops.receiving_order_lines (id, tenant_id, receiving_order_id, line_id, part_id, tracking_mode, expected_quantity, received_quantity)
                 VALUES ($1,$2,$3,$4,$5,'NONE',$6,$6)`, [`${id}-${l.line}`, T, id, l.line, l.part, l.qty]);
        if (l.price != null) {
          await q(`INSERT INTO eos_finance.inventory_acquisition_costs (id, tenant_id, cost_basis, operating_company_id, purchase_order_id, purchase_order_line_id,
                     purchase_order_source_type, supplier_id, supplier_name, part_id, received_quantity, unit_price_minor, extended_cost_minor, currency,
                     receiving_id, receiving_line_id, received_at, receiving_location_type, receiving_location_id, created_by)
                   VALUES ($1,$2,'PURCHASE_ORDER_LINE_PRICE','taylor',$3,$4,'PURCHASE_ORDER','sup-acme','Acme Supply',$5,$6,$7,$8,'USD',$9,$4,'2026-10-01T09:00:00Z','WAREHOUSE','taylor-main','fixture')`,
            [`acq-${id}-${l.line}`, T, `po-${id}`, l.line, l.part, l.qty, l.price, l.price * l.qty, id]);
        }
      }
    };
    await receipt("rcv-priced", [{ line: "L1", part: "PRT-1001", qty: 6, price: 4100 }]);
    const first = await fin.projectReceiptAcquisitionCost(pool, actor, { receivingId: "rcv-priced" });
    assert.equal(first.facts.length, 1);
    const f = first.facts[0];
    assert.deepEqual([f.outcome, f.fact.factClass, f.fact.factType, f.fact.amountMinor, f.fact.operatingCompanyId, f.fact.counterpartyId, f.fact.idempotencyKey],
      ["recorded", "COST_EVIDENCE", "ACQUISITION_COST", 24600n, "taylor", acme.id, "acq:acq-rcv-priced-L1"]);
    const replay = await fin.projectReceiptAcquisitionCost(pool, actor, { receivingId: "rcv-priced" });
    assert.deepEqual([replay.facts[0].outcome, replay.facts[0].fact.id], ["replayed", f.fact.id]);
    assert.equal(Number((await q(`SELECT count(*)::int n FROM eos_finance.financial_facts WHERE tenant_id=$1 AND source_record_id='rcv-priced'`, [T])).rows[0].n), 1,
      "same receipt replay -> no duplicate financial fact");
    // Unpriced: no fact (never a zero cost), one governed COST_EVIDENCE_MISSING exception, idempotent.
    await receipt("rcv-mixed", [{ line: "L1", part: "PRT-1001", qty: 2, price: 4100 }, { line: "L2", part: "PRT-1002", qty: 3, price: null }]);
    const mixed = await fin.projectReceiptAcquisitionCost(pool, actor, { receivingId: "rcv-mixed" });
    assert.deepEqual([mixed.facts.length, mixed.missingCostEvidence], [1, [{ receivingLineId: "L2", partId: "PRT-1002", receivedQuantity: 3 }]]);
    await fin.projectReceiptAcquisitionCost(pool, actor, { receivingId: "rcv-mixed" });
    assert.equal(Number((await q(`SELECT count(*)::int n FROM eos_finance.financial_facts WHERE tenant_id=$1 AND source_record_id='rcv-mixed'`, [T])).rows[0].n), 1);
    assert.equal(Number((await q(`SELECT count(*)::int n FROM eos_finance.financial_facts WHERE tenant_id=$1 AND source_line='L2' AND source_record_id='rcv-mixed'`, [T])).rows[0].n), 0,
      "missing cost never becomes a fact");
    const ex = (await q(`SELECT condition, operating_company_id, part_id, received_quantity FROM eos_finance.cost_evidence_exceptions WHERE tenant_id=$1 AND receiving_id='rcv-mixed'`, [T])).rows;
    assert.deepEqual(ex, [{ condition: "COST_EVIDENCE_MISSING", operating_company_id: "taylor", part_id: "PRT-1002", received_quantity: 3 }]);
    assert.equal(Number((await q(`SELECT count(*)::int n FROM eos_finance.financial_facts WHERE tenant_id=$1 AND amount_minor = 0`, [T])).rows[0].n), 0, "no zero-cost truth exists");
    // The source evidence is untouched (single source of cost).
    assert.equal(Number((await q(`SELECT count(*)::int n FROM eos_finance.inventory_acquisition_costs WHERE tenant_id=$1`, [T])).rows[0].n), 2);
  });

  await t.test("16. Taylor and Ventana resolve different, provider-neutral accounting destinations", async () => {
    assert.equal(await fin.resolveAccountingDestination(pool, T, "taylor"), null, "not configured is null -- never another company's");
    const td = await fin.configureAccountingDestination(pool, actor, { operatingCompanyId: "taylor", displayName: "Taylor books", providerKey: "provider-a", externalCompanyRef: "T-001", activate: true });
    const vd = await fin.configureAccountingDestination(pool, actor, { operatingCompanyId: "ventana", displayName: "Ventana books", providerKey: "provider-b", externalCompanyRef: "V-001", activate: true });
    const rt = await fin.resolveAccountingDestination(pool, T, "taylor");
    const rv = await fin.resolveAccountingDestination(pool, T, "ventana");
    assert.deepEqual([rt.id, rv.id], [td.id, vd.id]);
    assert.notEqual(rt.providerKey, rv.providerKey, "nothing requires the two companies to share a destination or provider");
    await refusedWith(fin.configureAccountingDestination(pool, actor, { operatingCompanyId: "taylor", displayName: "x", password: "secret" }), "FIELD_NOT_ACCEPTED");
    await refusedWith(fin.resolveAccountingDestination(pool, T, "consolidated"), "CONSOLIDATED_NOT_A_COMPANY");
    // Re-activation replaces the company's active destination; there is always at most one.
    const td2 = await fin.configureAccountingDestination(pool, actor, { operatingCompanyId: "taylor", displayName: "Taylor books v2", providerKey: "provider-a", activate: true });
    assert.equal((await fin.resolveAccountingDestination(pool, T, "taylor")).id, td2.id);
    const cols = (await q(`SELECT column_name FROM information_schema.columns WHERE table_schema='eos_finance' AND table_name='accounting_destinations'`)).rows.map((r) => r.column_name);
    assert.equal(cols.some((c) => /secret|password|token|credential|api_key/.test(c)), false, "no credential column exists");
  });
});
