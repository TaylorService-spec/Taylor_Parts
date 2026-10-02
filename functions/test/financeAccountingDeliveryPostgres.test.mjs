// THE ACCOUNTING DELIVERY CONTROL PLANE (Controller FINANCE ACTIVATION 2 NONPROD + TAX EVIDENCE UX + ACCOUNTING DELIVERY
// CONTROL PLANE, 2026-10-02 H–Q; DECISIONS #198; migration 1764470000000). Tests 12–34, against real PostgreSQL, with the
// deterministic test adapter ONLY: no provider, no credential, no network.
//
// Its own database per run. Set POLICY_TEST_DATABASE_URL; without it the database half SKIPS.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import pg from "pg";
import { deterministicAccountingAdapter, TEST_ADAPTER_KEY } from "./support/deterministicAccountingAdapter.mjs";

const require = createRequire(import.meta.url);
const fin = require("../lib/eosFinance/financeFoundation.js");
const pkg = require("../lib/eosFinance/billingPackage.js");
const delivery = require("../lib/eosFinance/accountingDelivery.js");
const http = require("../lib/eosOps/eosOpsHttp.js");

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const T = "t-findeliv";
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
const SRC = new URL("../src/eosFinance/accountingDelivery.ts", import.meta.url);
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/.*$/gm, "");

test("32. static: no scheduling, no network, no provider, no credential, no Firebase; the test adapter is never registered at runtime", () => {
  const code = stripComments(readFileSync(SRC, "utf8"));
  assert.equal(/setTimeout|setInterval|setImmediate|node-cron|\bcron\b|schedule\(|enqueue|pubsub/i.test(code), false, "nothing schedules a delivery or retry");
  assert.equal(/fetch\(|https?:\/\/|from ["']node:(http|https|net|tls)["']|axios|got\(/i.test(code), false, "no network");
  assert.equal(/quickbooks|netsuite|\bsage\b|dynamics|xero|intuit/i.test(code), false, "no provider is assumed");
  assert.equal(/credential|api[_-]?key|secret|password|bearer|oauth/i.test(code), false, "no credential");
  assert.equal(/firebase/i.test(code), false, "no Firebase");
  assert.deepEqual(Object.keys(delivery.PRODUCTION_ACCOUNTING_ADAPTERS), [], "the production adapter registry is EMPTY");
  const mig = readFileSync(new URL("../migrations/1764470000000_accounting-delivery-control-plane.sql", import.meta.url), "utf8").replace(/^\s*--.*$/gm, "");
  assert.equal(/quickbooks|netsuite|\bsage\b|dynamics|xero|credential|api_key|secret|password|token/i.test(mig), false, "no provider-specific schema or credential");
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]));
  for (const f of walk(new URL("../src", import.meta.url).pathname).filter((f) => f.endsWith(".ts"))) {
    assert.equal(/deterministicAccountingAdapter|eos-deterministic-test/.test(readFileSync(f, "utf8")), false, `${f}: no runtime module registers the test adapter`);
  }
});

test("31. static: no transport operation reaches delivery, retry, acknowledgement or exceptions (no Sales / Technician authority)", () => {
  const ops = [...http.OPERATIONS_READ_OPERATIONS, ...http.OPERATIONS_MUTATION_OPERATIONS];
  assert.equal(ops.some((o) => /deliver|handoff|attempt|acknowledg|accountingException|retryAccounting/i.test(o)), false);
});

test("Accounting delivery control plane over PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `fdel_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
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

  // ── fixtures: a tenant, two operating companies, a customer organization, Sales Orders, READY packages ──
  await q(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ($1,$1,$1)`, [T]);
  for (const company of ["taylor", "ventana"]) {
    await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id, operating_company_id, status, source, established_by, updated_by)
             VALUES ($1,$2,'ACTIVE','fixture','fixture','fixture')`, [T, company]);
    await q(`INSERT INTO eos_policy.tenant_operating_company_keys (tenant_id, operating_company_id, operating_company_key, status, provenance, source, established_by, updated_by)
             VALUES ($1,$2,$2,'ACTIVE','NATIVE','fixture','fixture','fixture')`, [T, company]);
  }
  await q(`INSERT INTO eos_crm.accounts (id, tenant_id, name, status, created_by, updated_by) VALUES ('acct-harbor',$1,'Harbor Grill','ACTIVE','fixture','fixture')`, [T]);
  const customer = await fin.ensureExternalCounterparty(pool, sys, "acct-harbor");

  let seq = 0;
  /** A READY direct-sale package with DETERMINED tax, and its receivable + handoff established through the real path. */
  const readyPackage = async ({ company = "taylor", price = 25000, tax = 1850 } = {}) => {
    const n = ++seq;
    const so = `so-del-${n}`;
    await q(`INSERT INTO eos_commercial.sales_orders (id, tenant_id, sales_order_number, account_id, owner_employee_id, operating_company_key, state, sales_channel, currency, created_by, updated_by)
             VALUES ($1,$2,$3,'acct-harbor','e-seller',$4,'IN_FULFILLMENT','RETAIL','USD','fixture','fixture')`, [so, T, `SO-2026-${String(800 + n).padStart(6, "0")}`, company]);
    await q(`INSERT INTO eos_commercial.sales_order_lines (tenant_id, sales_order_id, line_number, kind, ref, business_unit, ordered_qty, unit_price_minor)
             VALUES ($1,$2,1,'SERVICE','INSTALL-STANDARD','INSTALLATION',1,$3)`, [T, so, price]);
    const id = `bpk-del-${n}`;
    await q(`INSERT INTO eos_finance.billing_packages (id, tenant_id, source_kind, sales_order_id, version, status, operating_company_id, operating_company_key,
               commercial_customer_account_id, counterparty_id, obligor_basis, commercial_disposition, currency, subtotal_minor, shipping_minor, install_charge_minor,
               tax_minor, total_minor, down_payment_minor, trade_in_minor, balance_minor, content_fingerprint, prepared_by, tax_evidence_status)
             VALUES ($1,$2,'SALES_ORDER',$3,1,'READY',$4,$4,'acct-harbor',$5,'DIRECT_SALE_CUSTOMER','SALE','USD',$6,0,0,$7,$8,0,0,$8,$9,'fixture','DETERMINED')`,
      [id, T, so, company, customer.id, price, tax, price + tax, `fp-${n}`]);
    await q(`INSERT INTO eos_finance.billing_package_lines (package_id, tenant_id, line_number, sales_order_id, sales_order_line_number, kind, ref, business_unit,
               ordered_qty, fulfilled_qty, billable_qty, eligibility, unit_price_minor, extended_minor, price_source, fulfillment_ids)
             VALUES ($1,$2,1,$3,1,'SERVICE','INSTALL-STANDARD','INSTALLATION',1,1,1,'ELIGIBLE',$4,$4,'SALES_ORDER_LINE','{ful-1}')`, [id, T, so, price]);
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const consequence = await pkg.establishPackageReceivableOn(c, sys, id);
      await c.query("COMMIT");
      return { packageId: id, salesOrderId: so, obligationId: consequence.receivable.obligationId, handoffId: consequence.handoff.id, total: price + tax };
    } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
  };
  const handoff = (id) => one(`SELECT * FROM eos_finance.accounting_handoffs WHERE tenant_id=$1 AND id=$2`, [T, id]);
  const attempts = async (id) => (await q(`SELECT * FROM eos_finance.accounting_handoff_attempts WHERE tenant_id=$1 AND handoff_id=$2 ORDER BY attempt_number`, [T, id])).rows;
  const truth = async (p) => ({
    pkgRow: await one(`SELECT status, total_minor, tax_minor, content_fingerprint FROM eos_finance.billing_packages WHERE id=$1`, [p.packageId]),
    balance: await one(`SELECT status, originated_minor::text, settled_minor::text, outstanding_minor::text FROM eos_finance.obligation_balances WHERE tenant_id=$1 AND obligation_id=$2`, [T, p.obligationId]),
    facts: await one(`SELECT count(*)::int n, coalesce(sum(amount_minor),0)::text s FROM eos_finance.financial_facts WHERE tenant_id=$1`, [T]),
    invoices: (await one(`SELECT count(*)::int n FROM eos_finance.invoices WHERE tenant_id=$1`, [T])).n,
  });
  let keySeq = 0;
  const key = () => `req-${++keySeq}`;
  const deliver = (adapter, h, k = key()) => delivery.deliverAccountingHandoff({ pool, adapters: adapter ? { [adapter.key]: adapter } : undefined }, sys, { handoffId: h, idempotencyKey: k });
  const retry = (adapter, h, reason = "destination back online", k = key()) =>
    delivery.retryAccountingHandoffDelivery({ pool, adapters: { [adapter.key]: adapter } }, sys, { handoffId: h, reason, idempotencyKey: k });

  // Before any destination exists: the handoff is PENDING_DESTINATION.
  const pending = await readyPackage();

  await t.test("13. a PENDING_DESTINATION handoff cannot be delivered; no attempt is recorded", async () => {
    assert.equal((await handoff(pending.handoffId)).status, "PENDING_DESTINATION");
    await refusedWith(deliver(deterministicAccountingAdapter(["ACK"]), pending.handoffId), "HANDOFF_NOT_DELIVERABLE");
    assert.equal((await attempts(pending.handoffId)).length, 0);
  });

  // Company-specific destinations, each naming the deterministic test adapter.
  const taylorDest = await fin.configureAccountingDestination(pool, sys, { operatingCompanyId: "taylor", displayName: "Taylor test ledger", providerKey: TEST_ADAPTER_KEY, externalCompanyRef: "TAYLOR-TEST", activate: true });
  const ventanaDest = await fin.configureAccountingDestination(pool, sys, { operatingCompanyId: "ventana", displayName: "Ventana test ledger", providerKey: TEST_ADAPTER_KEY, externalCompanyRef: "VENTANA-TEST", activate: true });
  await pkg.refreshAccountingHandoffs(pool, sys);

  await t.test("12. the exact states: PENDING_DESTINATION -> READY_FOR_DELIVERY on configuration; every illegal transition fails closed", async () => {
    const h = await handoff(pending.handoffId);
    assert.deepEqual([h.status, h.accounting_destination_id, h.readiness_exceptions], ["READY_FOR_DELIVERY", taylorDest.id, []]);
    const p = await readyPackage();
    for (const to of ["ACKNOWLEDGED", "REJECTED", "FAILED_RETRYABLE", "FAILED_FINAL", "PENDING_DESTINATION"]) {
      await assert.rejects(q(`UPDATE eos_finance.accounting_handoffs SET status=$2 WHERE id=$1`, [p.handoffId, to]), /TRANSITION_REFUSED|destination_states|acknowledgement_shape|failure_shape/, `READY -> ${to}`);
    }
    await assert.rejects(q(`UPDATE eos_finance.accounting_handoffs SET status='DELIVERY_IN_PROGRESS' WHERE id=$1`, [p.handoffId]), /exactly one new attempt/,
      "entering delivery without recording an attempt is refused");
    await assert.rejects(q(`UPDATE eos_finance.accounting_handoffs SET payload_fingerprint='x' WHERE id=$1`, [p.handoffId]), /ACCOUNTING_HANDOFF_IMMUTABLE/);
    await assert.rejects(q(`DELETE FROM eos_finance.accounting_handoffs WHERE id=$1`, [p.handoffId]), /ACCOUNTING_HANDOFF_IMMUTABLE/);
    await assert.rejects(q(`UPDATE eos_finance.accounting_handoffs SET accounting_destination_id=$2 WHERE id=$1`, [p.handoffId, ventanaDest.id]), /TRANSITION_REFUSED/,
      "a READY handoff's destination is fixed");
  });

  await t.test("14. the payload contract: versioned, provider-neutral, derived from the package + receivable, deterministic", async () => {
    const p = await readyPackage({ price: 25000, tax: 1850 });
    const a = await delivery.buildAccountingPayload(pool, T, p.handoffId);
    const b = await delivery.buildAccountingPayload(pool, T, p.handoffId);
    assert.equal(a.fingerprint, b.fingerprint, "the same truth fingerprints the same");
    assert.match(a.fingerprint, /^[0-9a-f]{64}$/);
    assert.deepEqual(a.payload.contract, { name: "eos.accounting.operational-billing-package", version: 1 });
    assert.equal(a.payload.semantics, "OPERATIONAL_BILLING_PACKAGE_NOT_AN_ACCOUNTING_INVOICE");
    assert.deepEqual(a.payload.billingPackage.amounts, { subtotalMinor: "25000", shippingMinor: "0", installChargeMinor: "0", taxMinor: "1850",
      totalMinor: "26850", downPaymentMinor: "0", tradeInMinor: "0", balanceMinor: "26850" }, "integer minor units as strings");
    assert.equal(a.payload.billingPackage.taxEvidence, "DETERMINED");
    assert.deepEqual(a.payload.receivable, { obligationId: p.obligationId, amountMinor: "26850", currency: "USD" });
    assert.deepEqual(a.payload.customer, { counterpartyId: customer.id, kind: "EXTERNAL_ORGANIZATION", crmAccountId: "acct-harbor", name: "Harbor Grill" });
    assert.deepEqual([a.payload.operatingCompany.id, a.payload.destination.id, a.payload.destination.externalCompanyRef], ["taylor", taylorDest.id, "TAYLOR-TEST"]);
    assert.equal(a.payload.billingPackage.lines.length, 1);
    assert.equal(Object.isFrozen(a.payload) && Object.isFrozen(a.payload.receivable), true, "handed over frozen");
    assert.equal(/invoiceNumber|glAccount|ledgerAccount|quickbooks|netsuite|xero|credential|secret/i.test(JSON.stringify(a.payload)), false, "no provider or accounting vocabulary");
    assert.equal(delivery.canonicalJson({ b: 1, a: { d: 2, c: 3 } }), '{"a":{"c":3,"d":2},"b":1}');
  });

  await t.test("18 / 19 / 20. acknowledgement stores the provider reference; a replay returns the attempt; no duplicate delivery", async () => {
    const p = await readyPackage();
    const before = await truth(p);
    const adapter = deterministicAccountingAdapter(["ACK"]);
    const k = key();
    const r = await deliver(adapter, p.handoffId, k);
    assert.deepEqual([r.outcome, r.attemptNumber, r.attemptOutcome, r.handoffStatus], ["delivered", 1, "ACKNOWLEDGED", "ACKNOWLEDGED"]);
    assert.match(r.providerDocumentReference, /^TEST-[0-9A-F]{12}$/);
    const h = await handoff(p.handoffId);
    assert.deepEqual([h.status, h.provider_document_reference, h.attempt_count, h.failure_reason], ["ACKNOWLEDGED", r.providerDocumentReference, 1, null]);
    assert.ok(h.provider_acknowledged_at && h.last_attempt_at);
    // 19: the same request replays -- the adapter is not called again.
    const again = await deliver(adapter, p.handoffId, k);
    assert.deepEqual([again.outcome, again.attemptId, again.providerDocumentReference], ["replayed", r.attemptId, r.providerDocumentReference]);
    assert.equal(adapter.deliveries.length, 1, "delivered exactly once");
    // 20: a new request, and a retry, are refused -- ACKNOWLEDGED is terminal.
    await refusedWith(deliver(adapter, p.handoffId), "HANDOFF_NOT_DELIVERABLE");
    await refusedWith(retry(adapter, p.handoffId), "HANDOFF_NOT_RETRYABLE");
    assert.equal((await attempts(p.handoffId)).length, 1);
    assert.deepEqual(await truth(p), before, "acknowledgement changed no package, receivable, fact or invoice");
    await assert.rejects(q(`UPDATE eos_finance.accounting_handoffs SET provider_document_reference='OTHER' WHERE id=$1`, [p.handoffId]), /TRANSITION_REFUSED/,
      "an acknowledgement is recorded once");
    await assert.rejects(q(`UPDATE eos_finance.accounting_handoffs SET status='SUPERSEDED', provider_document_reference=NULL, provider_acknowledged_at=NULL WHERE id=$1`, [p.handoffId]),
      /TRANSITION_REFUSED/, "an ACKNOWLEDGED handoff is never superseded in place");
  });

  await t.test("16 / 17. the adapter cannot alter EOS truth: a frozen payload, and acknowledged amounts are ignored", async () => {
    const p1 = await readyPackage();
    const before1 = await truth(p1);
    const mutating = deterministicAccountingAdapter(["MUTATE"]);
    const r1 = await deliver(mutating, p1.handoffId);
    assert.deepEqual([r1.attemptOutcome, r1.failureCode], ["FAILED_RETRYABLE", "ADAPTER_DELIVERY_ERROR"], "rewriting the frozen payload throws; nothing is acknowledged");
    assert.deepEqual(await truth(p1), before1);
    const stored = (await attempts(p1.handoffId))[0];
    assert.equal(stored.payload.receivable.amountMinor, String(p1.total), "the recorded payload is EOS's own");

    const p2 = await readyPackage({ price: 40000, tax: 0 });
    const before2 = await truth(p2);
    const r2 = await deliver(deterministicAccountingAdapter(["ACK_WITH_AMOUNT"]), p2.handoffId);
    assert.equal(r2.attemptOutcome, "ACKNOWLEDGED");
    assert.deepEqual(await truth(p2), before2, "a provider's amounts never reach EOS");
    assert.equal(before2.balance.outstanding_minor, "40000", "a determined-zero tax package delivers its exact total");
  });

  await t.test("21 / 26. a retryable failure waits for a GOVERNED retry (never automatic), which reuses the provider de-duplication key", async () => {
    const p = await readyPackage();
    const adapter = deterministicAccountingAdapter(["RETRYABLE", "THROW", "ACK"]);
    const r1 = await deliver(adapter, p.handoffId);
    assert.deepEqual([r1.attemptOutcome, r1.handoffStatus, r1.failureCode, r1.exceptionId], ["FAILED_RETRYABLE", "FAILED_RETRYABLE", "DESTINATION_UNAVAILABLE", null]);
    await refusedWith(deliver(adapter, p.handoffId), "HANDOFF_NOT_DELIVERABLE");
    await refusedWith(retry(adapter, p.handoffId, "   "), "REASON_REQUIRED");
    assert.equal(adapter.deliveries.length, 1, "nothing re-attempted on its own");
    const r2 = await retry(adapter, p.handoffId, "destination recovered");
    assert.deepEqual([r2.attemptNumber, r2.attemptOutcome, r2.failureCode], [2, "FAILED_RETRYABLE", "ADAPTER_DELIVERY_ERROR"], "26: an adapter that throws is retryable");
    const r3 = await retry(adapter, p.handoffId, "second try");
    assert.deepEqual([r3.attemptNumber, r3.attemptOutcome], [3, "ACKNOWLEDGED"]);
    const rows = await attempts(p.handoffId);
    assert.deepEqual(rows.map((a) => [a.initiation, a.retry_of_attempt_id]), [["INITIAL", null], ["GOVERNED_RETRY", rows[0].id], ["GOVERNED_RETRY", rows[1].id]]);
    assert.deepEqual(rows.map((a) => a.retry_reason), [null, "destination recovered", "second try"]);
    assert.equal(new Set(adapter.deliveries.map((d) => d.key)).size, 1, "every attempt presents the SAME provider de-duplication key");
    assert.equal(new Set(rows.map((a) => a.payload_fingerprint)).size, 1, "the same payload each time");
    assert.equal((await handoff(p.handoffId)).attempt_count, 3);
  });

  await t.test("23 / 24. a rejection preserves the receivable and opens an actionable exception; resolved once", async () => {
    const p = await readyPackage();
    const before = await truth(p);
    const r = await deliver(deterministicAccountingAdapter(["REJECT"]), p.handoffId);
    assert.deepEqual([r.attemptOutcome, r.handoffStatus, r.failureCode], ["REJECTED", "REJECTED", "CUSTOMER_NOT_MAPPED"]);
    assert.deepEqual(await truth(p), before, "the receivable stands, unchanged");
    assert.equal(before.balance.status, "OPEN");
    const x = await one(`SELECT * FROM eos_finance.accounting_handoff_exceptions WHERE id=$1`, [r.exceptionId]);
    assert.deepEqual([x.kind, x.reason_code, x.required_action, x.status, x.operating_company_id, x.detail],
      ["PROVIDER_REJECTED", "CUSTOMER_NOT_MAPPED", "CORRECT_AND_SUPERSEDE_PACKAGE", "OPEN", "taylor", "the customer has no provider account"]);
    await refusedWith(retry(deterministicAccountingAdapter(["ACK"]), p.handoffId), "HANDOFF_NOT_RETRYABLE");
    await refusedWith(deliver(deterministicAccountingAdapter(["ACK"]), p.handoffId), "HANDOFF_NOT_DELIVERABLE");
    await refusedWith(delivery.resolveAccountingHandoffException(pool, sys, { exceptionId: r.exceptionId, resolution: "" }), "RESOLUTION_REQUIRED");
    await delivery.resolveAccountingHandoffException(pool, sys, { exceptionId: r.exceptionId, resolution: "customer mapped in the provider; package to be corrected" });
    await refusedWith(delivery.resolveAccountingHandoffException(pool, sys, { exceptionId: r.exceptionId, resolution: "again" }), "ACCOUNTING_EXCEPTION_NOT_OPEN");
    await assert.rejects(q(`UPDATE eos_finance.accounting_handoff_exceptions SET resolution='rewritten' WHERE id=$1`, [r.exceptionId]), /ACCOUNTING_EXCEPTION_IMMUTABLE/);
    // A corrected package may supersede a REJECTED handoff (the database permits exactly that move).
    await q(`UPDATE eos_finance.accounting_handoffs SET status='SUPERSEDED', failure_reason=NULL WHERE id=$1`, [p.handoffId]);
    assert.equal((await handoff(p.handoffId)).status, "SUPERSEDED");
  });

  await t.test("22 / 25. final failures and uninterpretable answers fail CLOSED: final, reviewed, never retried", async () => {
    for (const [step, code] of [["FINAL", "DESTINATION_REFUSED_PERMANENTLY"], ["GARBAGE", "PROVIDER_RESPONSE_UNINTERPRETABLE"],
      ["ACK_WRONG_FINGERPRINT", "ACKNOWLEDGEMENT_PAYLOAD_MISMATCH"]]) {
      const p = await readyPackage();
      const before = await truth(p);
      const r = await deliver(deterministicAccountingAdapter([step]), p.handoffId);
      assert.deepEqual([r.attemptOutcome, r.handoffStatus, r.failureCode, r.providerDocumentReference], ["FAILED_FINAL", "FAILED_FINAL", code, null], step);
      const x = await one(`SELECT kind, required_action, status FROM eos_finance.accounting_handoff_exceptions WHERE id=$1`, [r.exceptionId]);
      assert.deepEqual(x, { kind: "DELIVERY_FAILED_FINAL", required_action: "REVIEW_DESTINATION_CONFIGURATION", status: "OPEN" }, step);
      await refusedWith(retry(deterministicAccountingAdapter(["ACK"]), p.handoffId), "HANDOFF_NOT_RETRYABLE");
      assert.deepEqual(await truth(p), before, step);
    }
  });

  await t.test("27. company-specific destinations: a company's handoff goes only to its own destination", async () => {
    const v = await readyPackage({ company: "ventana" });
    assert.equal((await handoff(v.handoffId)).accounting_destination_id, ventanaDest.id);
    const adapter = deterministicAccountingAdapter(["ACK"]);
    const r = await deliver(adapter, v.handoffId);
    const [a] = await attempts(v.handoffId);
    assert.deepEqual([r.attemptOutcome, a.operating_company_id, a.accounting_destination_id, adapter.deliveries[0].payload.destination.externalCompanyRef],
      ["ACKNOWLEDGED", "ventana", ventanaDest.id, "VENTANA-TEST"]);
    // A Taylor handoff pointed (while pending) at Ventana's destination refuses to deliver -- nothing is attempted.
    await q(`UPDATE eos_finance.accounting_destinations SET status='INACTIVE' WHERE id=$1`, [taylorDest.id]);
    const t2 = await readyPackage({ company: "taylor" });
    assert.equal((await handoff(t2.handoffId)).status, "PENDING_DESTINATION");
    await q(`UPDATE eos_finance.accounting_handoffs SET status='READY_FOR_DELIVERY', accounting_destination_id=$2, readiness_exceptions='{}' WHERE id=$1`, [t2.handoffId, ventanaDest.id]);
    await refusedWith(deliver(deterministicAccountingAdapter(["ACK"]), t2.handoffId), "DESTINATION_COMPANY_MISMATCH");
    assert.equal((await attempts(t2.handoffId)).length, 0);
    assert.equal((await handoff(t2.handoffId)).status, "READY_FOR_DELIVERY");
    // 15: an inactive destination fails closed too.
    const t3 = await readyPackage({ company: "ventana" });
    await q(`UPDATE eos_finance.accounting_destinations SET status='INACTIVE' WHERE id=$1`, [ventanaDest.id]);
    await refusedWith(deliver(deterministicAccountingAdapter(["ACK"]), t3.handoffId), "ACCOUNTING_DESTINATION_INACTIVE");
    await q(`UPDATE eos_finance.accounting_destinations SET status='ACTIVE' WHERE id IN ($1,$2)`, [taylorDest.id, ventanaDest.id]);
  });

  await t.test("28. no adapter is available in production: delivery refuses, nothing is attempted", async () => {
    const p = await readyPackage();
    await refusedWith(deliver(null, p.handoffId), "ADAPTER_NOT_AVAILABLE");
    await refusedWith(delivery.deliverAccountingHandoff({ pool, adapters: { "some-other": { ...deterministicAccountingAdapter(), key: "some-other" } } }, sys,
      { handoffId: p.handoffId, idempotencyKey: key() }), "ADAPTER_NOT_AVAILABLE");
    assert.equal((await attempts(p.handoffId)).length, 0);
    assert.equal((await handoff(p.handoffId)).status, "READY_FOR_DELIVERY");
  });

  await t.test("29. attempts are durable and append-only; one in flight per handoff", async () => {
    const p = await readyPackage();
    await deliver(deterministicAccountingAdapter(["ACK"]), p.handoffId);
    const [a] = await attempts(p.handoffId);
    await assert.rejects(q(`UPDATE eos_finance.accounting_handoff_attempts SET payload='{}'::jsonb WHERE id=$1`, [a.id]), /ACCOUNTING_ATTEMPT_IMMUTABLE/);
    await assert.rejects(q(`UPDATE eos_finance.accounting_handoff_attempts SET outcome='REJECTED', failure_code='X', provider_document_reference=NULL WHERE id=$1`, [a.id]),
      /ACCOUNTING_ATTEMPT_IMMUTABLE/, "an outcome is recorded once");
    await assert.rejects(q(`DELETE FROM eos_finance.accounting_handoff_attempts WHERE id=$1`, [a.id]), /ACCOUNTING_ATTEMPT_IMMUTABLE/);
    const cols = Object.keys(a);
    for (const c of ["payload", "payload_fingerprint", "payload_contract_version", "delivery_idempotency_key", "initiated_by", "started_at", "outcome_at"]) assert.ok(cols.includes(c), c);
    const idx = await one(`SELECT indexdef FROM pg_indexes WHERE indexname='accounting_attempt_one_in_progress'`);
    assert.match(idx.indexdef, /WHERE \(outcome = 'IN_PROGRESS'::text\)/);
  });

  await t.test("30. a handoff in delivery or acknowledged blocks package supersession; open exceptions close with a correction", async () => {
    const retire = async (packageId) => {
      const c = await pool.connect();
      try { await c.query("BEGIN"); await pkg.retirePackageReceivableOn(c, sys, packageId, "corrected"); await c.query("COMMIT"); }
      catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
    };
    const acked = await readyPackage();
    await deliver(deterministicAccountingAdapter(["ACK"]), acked.handoffId);
    const before = await truth(acked);
    await refusedWith(retire(acked.packageId), "ACCOUNTING_HANDOFF_DELIVERED");
    assert.deepEqual(await truth(acked), before, "the acknowledged receivable is not voided");
    assert.equal((await handoff(acked.handoffId)).status, "ACKNOWLEDGED");

    const rejected = await readyPackage();
    const r = await deliver(deterministicAccountingAdapter(["REJECT"]), rejected.handoffId);
    await retire(rejected.packageId);
    assert.equal((await handoff(rejected.handoffId)).status, "SUPERSEDED");
    assert.equal((await truth(rejected)).balance.status, "VOID", "the corrected package's old receivable is voided by reversing facts");
    const x = await one(`SELECT status, resolution, resolved_by FROM eos_finance.accounting_handoff_exceptions WHERE id=$1`, [r.exceptionId]);
    assert.deepEqual(x, { status: "RESOLVED", resolution: "SUPERSEDED_BY_CORRECTED_PACKAGE", resolved_by: sys.principalId });
  });

  await t.test("33 / 34. delivery records no financial fact (Analysis provenance intact) and creates no invoice or GL", async () => {
    const facts = await q(`SELECT fact_class, fact_type, source_domain, basis, count(*)::int n FROM eos_finance.financial_facts WHERE tenant_id=$1 GROUP BY 1,2,3,4 ORDER BY 1,2`, [T]);
    assert.equal(facts.rows.every((r) => r.fact_class === "OBLIGATION" && r.source_domain === "BILLING_PACKAGE" && r.basis === "OPERATIONAL_BILLING_PACKAGE"), true,
      `only the receivables' own facts exist: ${JSON.stringify(facts.rows)}`);
    const packages = (await one(`SELECT count(*)::int n FROM eos_finance.billing_packages WHERE tenant_id=$1`, [T])).n;
    const originations = (await one(`SELECT count(*)::int n FROM eos_finance.financial_facts WHERE tenant_id=$1 AND reverses_fact_id IS NULL`, [T])).n;
    const reversals = (await one(`SELECT count(*)::int n FROM eos_finance.financial_facts WHERE tenant_id=$1 AND reverses_fact_id IS NOT NULL`, [T])).n;
    assert.deepEqual([originations, reversals], [packages, 1], "one origination per package, one reversal for the corrected one -- delivery added none");
    assert.equal((await one(`SELECT count(*)::int n FROM eos_finance.invoices WHERE tenant_id=$1`, [T])).n, 0);
    const tables = (await q(`SELECT table_name FROM information_schema.tables WHERE table_schema='eos_finance'`)).rows.map((r) => r.table_name);
    assert.equal(tables.some((n) => /gl_|journal|ledger_entr|posting/.test(n)), false, "no GL structure");
  });
});
