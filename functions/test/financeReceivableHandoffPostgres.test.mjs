// FINANCE ACTIVATION 2 -- OPERATIONAL RECEIVABLE + TAX EVIDENCE + ACCOUNTING HANDOFF BOUNDARY (Controller / Owner rulings,
// 2026-10-02; DECISIONS #197). Tax evidence on the governed Agreement writer; a READY direct-sale Billing Package establishing
// the EOS operational receivable through the existing Finance foundation; the provider-neutral accounting handoff. Not an
// accounting invoice, not GL, not recognition, nothing delivered. Real PostgreSQL; set POLICY_TEST_DATABASE_URL.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { serviceBaselineTenant, HOUR } from "./support/serviceBaselineTenant.mjs";
import { certifyInventoryBaselineFixture } from "./support/inventoryBaselineCertified.mjs";

const require = createRequire(import.meta.url);
const equipmentDelta = require("../lib/adminPolicy/equipmentActivationDelta.js");
const fulfillment = require("../lib/eosCommercial/fulfillment/salesOrderFulfillmentAuthority.js");
const pkg = require("../lib/eosFinance/billingPackage.js");
const fin = require("../lib/eosFinance/financeFoundation.js");
const sa = require("../lib/eosCommercial/commands/salesAgreementCommandService.js");
const http = require("../lib/eosOps/eosOpsHttp.js");
const { capabilitiesForRoleKeys } = require("../lib/eosOps/capabilityAuthority.js");

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const TENANT = "t-finar";
const WH = "wh-cf";
const MODEL = "ACME--UNIT-200";
const WO = "/operations/work-orders";
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../src");

test("8 / 9 / 30 / 31 / 32. static: no tax provider / rate / jurisdiction; provider-neutral, no network, no credential; no Firebase", () => {
  for (const f of ["eosFinance/billingPackage.ts", "eosCommercial/commands/salesAgreementCommandService.ts"]) {
    const code = readFileSync(join(SRC, f), "utf8").replace(/^\s*(\/\/|\*).*$/gm, "");
    assert.equal(/taxRate|tax_rate|jurisdiction|avalara|vertex|taxjar|fetch\(|https?:\/\//i.test(code), false, `${f}: no tax engine, rate or provider call`);
    assert.equal(/from ["'][^"']*firebase/i.test(code), false, `${f}: no Firebase`);
  }
  const mig = readFileSync(new URL("../migrations/1764460000000_receivable-tax-evidence-accounting-handoff.sql", import.meta.url), "utf8");
  assert.equal(/quickbooks|netsuite|sage|dynamics|xero|credential|api_key|secret|password|token/i.test(mig.replace(/^\s*--.*$/gm, "")), false, "no provider-specific schema or credential");
  const ops = [...http.OPERATIONS_READ_OPERATIONS, ...http.OPERATIONS_MUTATION_OPERATIONS];
  assert.equal(ops.some((o) => /receivable|obligation|handoff|package|invoice/i.test(o)), false, "21: no operation manufactures a receivable, package or handoff");
});

test("Finance Activation 2: tax evidence -> READY package -> EOS receivable -> accounting handoff", { skip: SKIP, concurrency: 1 }, async (t) => {
  const { q, admin, person, repo, pool } = await serviceBaselineTenant(t, { urlBase: URL_BASE, tenant: TENANT, prefix: "finar" });
  const one = async (sql, v = []) => (await q(sql, v)).rows[0];
  const count = async (sql, v = []) => Number((await one(sql, v)).n);
  const call = async (who, route, operation, input = {}) => {
    const res = await http.handleOperationsRequest({ reader: repo, pool, workOrderPostgresState: "ACTIVE",
      verifyToken: async (token) => ({ externalSubject: token, identityProvider: "firebase" }) },
    { method: "POST", url: route, headers: { authorization: `Bearer ${who.subject}` }, body: JSON.stringify({ operation, input }) });
    return { status: res.status, body: JSON.parse(res.body) };
  };
  const ok = (r, what = "") => { assert.equal(r.status, 200, `${what} ${JSON.stringify(r.body)}`); return r.body.result; };
  const refused = (r, status, code, what = "") => assert.deepEqual([r.status, r.body.code], [status, code], `${what} ${JSON.stringify(r.body)}`);

  for (const ch of ["RETAIL", "NATIONAL_ACCOUNTS"]) {
    await q(`INSERT INTO eos_policy.tenant_sales_channels (tenant_id, sales_channel, status, source, established_by, updated_by)
             VALUES ($1,$2,'ACTIVE','fixture','fixture','fixture')`, [TENANT, ch]);
  }
  for (const { operation, input } of equipmentDelta.equipmentActivationOperations()) {
    const r = await admin(operation, input);
    assert.equal(r.ok, true, `${operation} ${JSON.stringify(r).slice(0, 200)}`);
  }
  const techA = await person("uid-tech-a", ["technician", "equipmentInstaller"], { id: "e-tech-a", name: "Finley Tech", technician: true });
  const dispatcher = await person("uid-dispatch", ["dispatcher"], { id: "e-dispatch", name: "Emerson Dispatch" });
  const seller = await person("uid-seller", [], { id: "e-seller", name: "Riley Retail" });

  await q(`INSERT INTO eos_crm.accounts (id, tenant_id, name, status, created_by, updated_by) VALUES ('acct-r',$1,'Harbor Grill','ACTIVE','fixture','fixture'),
           ('acct-o',$1,'Other Diner','ACTIVE','fixture','fixture')`, [TENANT]);
  await q(`INSERT INTO eos_crm.account_locations (id, tenant_id, account_id, name, created_by, updated_by) VALUES ('loc-r1',$1,'acct-r','Downtown','fixture','fixture'),
           ('loc-r2',$1,'acct-r','Airport','fixture','fixture'), ('loc-o',$1,'acct-o','Main','fixture','fixture')`, [TENANT]);
  await q(`INSERT INTO eos_ops.warehouses (id, tenant_id, operating_company_key, name, site_label, status, provenance, created_by, updated_by)
           VALUES ($1,$2,'taylor','Taylor Main','Taylor Main','ACTIVE','NATIVE','fixture','fixture')`, [WH, TENANT]);
  await q(`INSERT INTO eos_ops.equipment_models (id, tenant_id, manufacturer_id, manufacturer_name, model_number, display_name, status, source_authority, version, created_by, updated_by)
           VALUES ($1,$2,'ACME','Acme','UNIT-200','Acme Unit 200','ACTIVE','fixture',1,'fixture','fixture')`, [MODEL, TENANT]);
  await q(`INSERT INTO eos_ops.parts (id, tenant_id, created_by, internal_part_number, name, status, stocking_unit, control_type, stocking_class,
             expiry_tracked, consumable, returnable_core, whole_unit, equipment_model_id, version, updated_by)
           VALUES ('PRT-UNIT2',$1,'fixture','PRT-UNIT2','Acme Unit 200','ACTIVE','EACH','SERIALIZED','STOCKED',false,false,false,true,$2,1,'fixture')`, [TENANT, MODEL]);
  for (const p of ["PRT-FILTER", "PRT-GASKET", "PRT-HOSE"]) {
    await q(`INSERT INTO eos_ops.parts (id, tenant_id, created_by, internal_part_number, name, status, stocking_unit, control_type, stocking_class,
               expiry_tracked, consumable, returnable_core, whole_unit, version, updated_by)
             VALUES ($1,$2,'fixture',$1,$1,'ACTIVE','EACH','STANDARD','STOCKED',false,false,false,false,1,'fixture')`, [p, TENANT]);
  }
  for (const [i, serial] of ["SN-A1", "SN-A2"].entries()) {
    await q(`INSERT INTO eos_ops.serialized_custody (id, tenant_id, part_id, serial_number, status, location_type, location_id, operating_company_key, updated_by)
             VALUES ($1,$2,'PRT-UNIT2',$3,'AVAILABLE','WAREHOUSE',$4,'taylor','fixture')`, [`cst-${serial}`, TENANT, serial, WH]);
    await q(`INSERT INTO eos_ops.inventory_movements (id, tenant_id, operating_company_key, part_id, tracking_mode, location_type, location_id,
               movement_type, quantity_delta, serial_number, source_kind, source_id, created_by)
             VALUES ($1,$2,'taylor','PRT-UNIT2','SERIAL','WAREHOUSE',$3,'RECEIVED',1,$4,'FIXTURE','fixture','fixture')`, [`mov-fx-${i}`, TENANT, WH, serial]);
  }
  await certifyInventoryBaselineFixture(q, TENANT);
  const ROUND = Object.fromEntries(["0", "1", "2", "3", "4", "5", "6"].map((d) => [d, [{ start: "00:00", end: "24:00" }]]));
  ok(await call(dispatcher, WO, "setTechnicianWorkingHours", { employeeId: "e-tech-a", timeZone: "UTC", weeklyHours: ROUND, reason: "fixture" }), "hours");

  // ── Sales Order fixtures: the accepted Commercial truth fulfillment is measured against ──
  let soSeq = 0;
  const salesOrder = async ({ lines, company = "taylor", account = "acct-r", location = "loc-r1", state = "IN_FULFILLMENT", lease = null, charges = {} }) => {
    const id = `so-cf-${++soSeq}`;
    let agreementId = null;
    if (lease !== null) {
      agreementId = `sa-cf-${soSeq}`;
      await q(`INSERT INTO eos_commercial.sales_agreements (id, tenant_id, sales_agreement_number, account_id, owner_employee_id, state, accepted_at, accepted_by,
                 is_lease, operating_company_key, currency, shipping_minor, install_charge_minor, tax_minor, down_payment_minor, trade_in_minor, created_by, updated_by,
                 tax_evidence_status, tax_evidence_currency, tax_evidence_recorded_by, tax_evidence_recorded_at)
               VALUES ($1,$2,$1,$3,'e-seller','ACCEPTED',now(),'fixture',$4,$5,'USD',$6,$7,$8,$9,$10,'fixture','fixture',$11,$12,$13,$14)`,
        // DECISIONS #197: a stated tax is a DETERMINED governed value (0 included); no tax is NOT_DETERMINED.
        [agreementId, TENANT, account, lease, company, charges.shipping ?? null, charges.install ?? null, charges.tax ?? null, charges.down ?? null, charges.tradeIn ?? null,
          charges.tax === undefined ? "NOT_DETERMINED" : "DETERMINED", charges.tax === undefined ? null : "USD", charges.tax === undefined ? null : "fixture",
          charges.tax === undefined ? null : new Date()]);
    }
    await q(`INSERT INTO eos_commercial.sales_orders (id, tenant_id, sales_order_number, account_id, owner_employee_id, operating_company_key, state, sales_channel,
               currency, credited_salesperson_employee_id, accountable_employee_id, location_id, sales_agreement_id, created_by, updated_by)
             VALUES ($1,$2,$3,$4,'e-seller',$5,$6,'RETAIL','USD','e-seller','e-seller',$7,$8,'fixture','fixture')`,
      [id, TENANT, `SO-2026-${String(900 + soSeq).padStart(6, "0")}`, account, company, state, location, agreementId]);
    for (const l of lines) {
      await q(`INSERT INTO eos_commercial.sales_order_lines (tenant_id, sales_order_id, line_number, kind, ref, business_unit, ordered_qty, unit_price_minor)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [TENANT, id, l.n, l.kind, l.ref, l.bu ?? "EQUIPMENT_SALES", l.qty, l.price ?? null]);
    }
    return id;
  };
  let slot = 0;
  const workOrder = async ({ type = "INSTALL", salesOrderId, salesOrderLines, plan = [], customerId = "acct-r", locationId = "loc-r1" }) => {
    const id = ok(await call(dispatcher, WO, "createWorkOrder", { operatingCompanyId: "taylor", customerId, locationId, workOrderType: type, priority: 2,
      ...(salesOrderId ? { salesOrderId } : {}), ...(salesOrderLines ? { salesOrderLines } : {}) }), "create").workOrderId;
    ok(await call(dispatcher, WO, "markWorkOrderReady", { workOrderId: id }), "ready");
    ok(await call(dispatcher, WO, "setWorkOrderPartsPlan", { workOrderId: id, plan }), "plan");
    const start = Date.now() + 2 * 24 * HOUR + (++slot) * 2 * HOUR;
    ok(await call(dispatcher, WO, "scheduleWorkOrder", { workOrderId: id, employeeId: "e-tech-a", scheduledStart: start, scheduledEnd: start + HOUR }), "schedule");
    ok(await call(dispatcher, WO, "dispatchWorkOrder", { workOrderId: id }), "dispatch");
    for (const op of ["acceptWorkOrder", "startWorkOrderTravel", "arriveAtWorkOrder", "startWorkOrderWork"]) ok(await call(techA, WO, op, { workOrderId: id }), op);
    return id;
  };
  const use = async (workOrderId, key, partUsage) => ok(await call(techA, WO, "recordWorkOrderExecution", { workOrderId, idempotencyKey: key, partUsage }), "usage");
  const complete = (id) => call(techA, WO, "completeWorkOrder", { workOrderId: id });
  const cancel = async (id) => ok(await call(dispatcher, WO, "cancelWorkOrder", { workOrderId: id, expectedStatus: "WORK_IN_PROGRESS", note: "case done" }), "cancel");
  const eligibility = (soId) => q(`SELECT * FROM eos_commercial.sales_order_line_billing_eligibility WHERE tenant_id=$1 AND sales_order_id=$2 ORDER BY line_number`, [TENANT, soId]);
  const totals = async () => one(`SELECT (SELECT count(*)::int FROM eos_ops.inventory_movements WHERE tenant_id=$1) AS movements,
      (SELECT count(*)::int FROM eos_ops.equipment WHERE tenant_id=$1) AS equipment, (SELECT count(*)::int FROM eos_ops.equipment_events WHERE tenant_id=$1) AS events,
      (SELECT count(*)::int FROM eos_commercial.sales_order_fulfillments WHERE tenant_id=$1) AS fulfillments`, [TENANT]);
  const finance = () => one(`SELECT (SELECT count(*)::int FROM eos_finance.financial_facts WHERE tenant_id=$1) AS facts,
      (SELECT count(*)::int FROM eos_finance.obligations WHERE tenant_id=$1) AS obligations, (SELECT count(*)::int FROM eos_finance.invoices WHERE tenant_id=$1) AS invoices`, [TENANT]);

  const sys = { tenantId: TENANT, principalId: "finance-system" };
  const packages = (soId) => q(`SELECT * FROM eos_finance.billing_packages WHERE tenant_id=$1 AND sales_order_id=$2 ORDER BY version`, [TENANT, soId]);
  const receivableOf = (packageId) => one(`SELECT * FROM eos_finance.obligations WHERE tenant_id=$1 AND source_domain='BILLING_PACKAGE' AND source_record_id=$2`, [TENANT, packageId]);
  const handoffOf = (packageId) => one(`SELECT * FROM eos_finance.accounting_handoffs WHERE tenant_id=$1 AND billing_package_id=$2`, [TENANT, packageId]);
  const SVC = (n = 1, price = 30000) => ({ n, kind: "SERVICE", ref: "INSTALL-STANDARD", qty: 1, price, bu: "INSTALLATION" });
  const serviceJob = async (soId) => {
    const w = await workOrder({ type: "SERVICE_CALL", salesOrderId: soId, salesOrderLines: [1] });
    return { wo: w, done: ok(await complete(w), "complete") };
  };

  // ── TAX EVIDENCE through the governed Agreement writer (the Commercial command service) ──
  const commercialDeps = { pool, catalog: { async verifyReferences(_db, _t, refs) { return refs.map(() => "FOUND"); } } };
  const seller2 = { tenantId: TENANT, principalId: seller.principalId, capabilities: new Set(["salesAgreement.create", "salesAgreement.updateDraft", "salesAgreement.accept"]) };
  let oppSeq = 0;
  const opportunity = async () => {
    const id = `opp-ar-${++oppSeq}`;
    await q(`INSERT INTO eos_commercial.opportunities (id, tenant_id, opportunity_number, account_id, owner_employee_id, sales_channel, stage, operating_company_key,
               credited_salesperson_employee_id, created_by, updated_by) VALUES ($1,$2,$1,'acct-r','e-seller','RETAIL','DECISION','taylor','e-seller','fixture','fixture')`, [id, TENANT]);
    return id;
  };
  const LINES = [{ kind: "SERVICE", ref: "INSTALL-STANDARD", quantity: 1, unitPrice: 30000, businessUnitId: "SERVICE" }];
  const agreement = async (extra) => (await sa.createSalesAgreement(commercialDeps, seller2, { idempotencyKey: `sa-${++oppSeq}-${Date.now()}`, opportunityId: await opportunity(),
    ownerEmployeeId: "e-seller", isLease: false, lines: LINES, ...extra }).then((r) => r.result ?? r)).salesAgreementId;
  const evidenceOf = (id) => one(`SELECT tax_evidence_status, tax_minor, tax_evidence_currency, tax_evidence_recorded_by FROM eos_commercial.sales_agreements WHERE id=$1`, [id]);
  const code = (c) => (e) => e.code === c;

  await t.test("1-7. UAT-FIN-AR-002/003/004: tax evidence -- omitted is NOT_DETERMINED (never 0), determined 0 and positive are evidence, invalid / mismatched refused, legacy 0 is not promoted", async () => {
    const omitted = await agreement({});
    assert.deepEqual(await evidenceOf(omitted), { tax_evidence_status: "NOT_DETERMINED", tax_minor: "0", tax_evidence_currency: null, tax_evidence_recorded_by: null },
      "1: the writer's stored 0 is NOT evidence -- the state says NOT_DETERMINED");
    const bare = await agreement({ taxMinor: 4100 });
    assert.equal((await evidenceOf(bare)).tax_evidence_status, "NOT_DETERMINED", "a bare taxMinor is a commercial input, never evidence");
    const zero = await agreement({ taxEvidence: { status: "DETERMINED", amountMinor: 0, currency: "USD" } });
    assert.deepEqual(await evidenceOf(zero), { tax_evidence_status: "DETERMINED", tax_minor: "0", tax_evidence_currency: "USD", tax_evidence_recorded_by: seller.principalId },
      "3: an explicitly determined zero");
    const positive = await agreement({ taxEvidence: { status: "DETERMINED", amountMinor: 2460, currency: "USD" } });
    assert.deepEqual([(await evidenceOf(positive)).tax_evidence_status, (await evidenceOf(positive)).tax_minor], ["DETERMINED", "2460"], "4");
    for (const bad of [{ status: "DETERMINED", amountMinor: -1, currency: "USD" }, { status: "DETERMINED", amountMinor: 1.5, currency: "USD" },
      { status: "DETERMINED", currency: "USD" }, { status: "MAYBE" }]) {
      await assert.rejects(agreement({ taxEvidence: bad }), code("TAX_EVIDENCE_INVALID"), "5: " + JSON.stringify(bad));
    }
    await assert.rejects(agreement({ taxEvidence: { status: "DETERMINED", amountMinor: 100, currency: "EUR" } }), code("TAX_CURRENCY_MISMATCH"), "6");
    await assert.rejects(agreement({ taxMinor: 99, taxEvidence: { status: "DETERMINED", amountMinor: 100, currency: "USD" } }), code("TAX_EVIDENCE_CONFLICT"));
    await assert.rejects(q(`UPDATE eos_commercial.sales_agreements SET tax_evidence_status='DETERMINED', tax_evidence_currency='EUR', tax_evidence_recorded_by='x',
        tax_evidence_recorded_at=now() WHERE id=$1`, [omitted]), /sales_agreement_tax_evidence_shape/, "6: the database refuses a currency mismatch too");
    // Draft edits: evidence moves only by an explicit statement; a changed bare amount is no longer evidenced.
    await sa.updateSalesAgreementDraft(commercialDeps, seller2, { idempotencyKey: `u-${Date.now()}`, salesAgreementId: omitted,
      taxEvidence: { status: "DETERMINED", amountMinor: 700, currency: "USD" } });
    assert.deepEqual([(await evidenceOf(omitted)).tax_evidence_status, (await evidenceOf(omitted)).tax_minor], ["DETERMINED", "700"]);
    await sa.updateSalesAgreementDraft(commercialDeps, seller2, { idempotencyKey: `u2-${Date.now()}`, salesAgreementId: omitted, taxMinor: 800 });
    assert.equal((await evidenceOf(omitted)).tax_evidence_status, "NOT_DETERMINED");
    // 7: a pre-evidence Agreement (the migration default) keeps its stored 0 and is LEGACY_UNVERIFIED -- never a determined zero.
    await q(`INSERT INTO eos_commercial.sales_agreements (id, tenant_id, sales_agreement_number, account_id, owner_employee_id, state, operating_company_key, currency, tax_minor, created_by, updated_by)
             VALUES ('sa-legacy',$1,'sa-legacy','acct-r','e-seller','DRAFT','taylor','USD',0,'fixture','fixture')`, [TENANT]);
    assert.deepEqual([(await evidenceOf("sa-legacy")).tax_evidence_status, (await evidenceOf("sa-legacy")).tax_minor], ["LEGACY_UNVERIFIED", "0"]);
  });

  await t.test("2 / 7. UAT-FIN-AR-004 / 010: a package never turns NOT_DETERMINED or legacy-ambiguous tax into zero", async () => {
    const nd = await salesOrder({ lease: false, lines: [SVC(1)] });
    const a = (await serviceJob(nd)).done;
    assert.deepEqual([a.billingPackage.status, a.billingPackage.readinessExceptions, a.billingPackage.consequence], ["HELD", ["TAX_NOT_DETERMINED"], null]);
    const [p] = (await packages(nd)).rows;
    assert.deepEqual([p.tax_minor, p.total_minor, p.tax_evidence_status], [null, null, "NOT_DETERMINED"]);
    assert.equal(await receivableOf(p.id), undefined, "no receivable for a HELD package");
    const legacy = await salesOrder({ lease: false, lines: [SVC(1)] });
    await q(`UPDATE eos_commercial.sales_agreements SET tax_evidence_status='LEGACY_UNVERIFIED', tax_minor=0 WHERE id=(SELECT sales_agreement_id FROM eos_commercial.sales_orders WHERE id=$1)`, [legacy]);
    const b = (await serviceJob(legacy)).done;
    assert.deepEqual([b.billingPackage.status, b.billingPackage.readinessExceptions], ["HELD", ["TAX_NOT_DETERMINED"]]);
    assert.equal((await packages(legacy)).rows[0].tax_evidence_status, "LEGACY_UNVERIFIED");
  });

  let readyPkg, readySo, readyWo;
  await t.test("10-14 / 24-26 / 28 / 29 / 34 / 36. UAT-FIN-AR-001/007: a READY direct sale establishes exactly one receivable = the package total; handoff explicit without a destination", async () => {
    readySo = await salesOrder({ lease: false, charges: { shipping: 5000, install: 0, tax: 2460 }, lines: [SVC(1)] });
    const { wo, done } = await serviceJob(readySo);
    readyWo = wo;
    assert.equal(done.billingPackage.status, "READY");
    const c = done.billingPackage.consequence;
    assert.equal(c.receivable.outcome, "recorded");
    assert.deepEqual([c.handoff.status, c.handoff.readinessExceptions], ["PENDING_DESTINATION", ["ACCOUNTING_DESTINATION_MISSING"]], "29: explicit, never lost");
    readyPkg = (await packages(readySo)).rows[0];
    const ar = await receivableOf(readyPkg.id);
    assert.equal(ar.id, c.receivable.obligationId);
    const cp = await one(`SELECT kind, crm_account_id FROM eos_finance.financial_counterparties WHERE id=$1`, [ar.counterparty_id]);
    assert.deepEqual([ar.kind, ar.operating_company_id, ar.counterparty_id, cp.kind, cp.crm_account_id, ar.currency, ar.status],
      ["RECEIVABLE", readyPkg.operating_company_id, readyPkg.counterparty_id, "EXTERNAL_ORGANIZATION", "acct-r", readyPkg.currency, "OPEN"]);
    // 11 / 24: the amount is the package total, and the balance derives from the facts.
    const bal = await fin.readObligationBalance(pool, TENANT, ar.id);
    assert.deepEqual([String(bal.originatedMinor), String(bal.settledMinor), String(bal.outstandingMinor), readyPkg.total_minor], ["37460", "0", "37460", "37460"]);
    // 25 / 26 / L: no invoice; no fact other than the foundation's obligation origination (no revenue / GL fact).
    const facts = (await q(`SELECT fact_class, fact_type, amount_minor::text, correlation_id, source_domain FROM eos_finance.financial_facts WHERE tenant_id=$1 AND obligation_id=$2`, [TENANT, ar.id])).rows;
    assert.deepEqual(facts, [{ fact_class: "OBLIGATION", fact_type: "RECEIVABLE_ORIGINATED", amount_minor: "37460", correlation_id: readySo, source_domain: "BILLING_PACKAGE" }]);
    assert.equal(await count(`SELECT count(*)::int n FROM eos_finance.invoices WHERE tenant_id=$1`, [TENANT]), 0);
    assert.equal(await count(`SELECT count(*)::int n FROM eos_finance.financial_facts WHERE tenant_id=$1 AND fact_class IN ('SETTLEMENT','COMMITMENT')`, [TENANT]), 0);
    // 28 / 34: the handoff stands without a destination; the provider document / acknowledgement / failure stay empty.
    const h = await handoffOf(readyPkg.id);
    assert.deepEqual([h.obligation_id, h.accounting_destination_id, h.payload_kind, h.payload_version, h.payload_fingerprint, h.provider_document_reference,
      h.provider_acknowledged_at, h.failure_reason, h.attempt_count], [ar.id, null, "OPERATIONAL_BILLING_PACKAGE", 1, readyPkg.content_fingerprint, null, null, null, 0]);
    // 36 / S: Analysis provenance -- receivable -> package -> line -> eligibility -> fulfillment -> SO line -> SO -> customer; -> Work Order.
    const trace = await one(`SELECT o.kind, bp.version, bp.tax_evidence_status, bp.commercial_disposition, bl.kind AS line_kind, e.eligibility, f.source_work_order_id, so.id AS so,
        c.name AS customer, h.status AS handoff FROM eos_finance.obligations o
        JOIN eos_finance.billing_packages bp ON bp.id = o.source_record_id
        JOIN eos_finance.billing_package_lines bl ON bl.package_id = bp.id
        JOIN eos_commercial.sales_order_line_billing_eligibility e ON e.tenant_id = bl.tenant_id AND e.sales_order_id = bl.sales_order_id AND e.line_number = bl.sales_order_line_number
        JOIN eos_commercial.sales_order_fulfillments f ON f.id = ANY(bl.fulfillment_ids)
        JOIN eos_commercial.sales_orders so ON so.id = bp.sales_order_id
        JOIN eos_crm.accounts c ON c.tenant_id = so.tenant_id AND c.id = so.account_id
        JOIN eos_finance.accounting_handoffs h ON h.billing_package_id = bp.id
       WHERE o.id = $1`, [ar.id]);
    assert.deepEqual([trace.kind, trace.version, trace.tax_evidence_status, trace.commercial_disposition, trace.line_kind, trace.eligibility, trace.source_work_order_id, trace.so, trace.customer, trace.handoff],
      ["RECEIVABLE", 1, "DETERMINED", "SALE", "SERVICE", "ELIGIBLE", wo, readySo, "Harbor Grill", "PENDING_DESTINATION"]);
  });

  await t.test("15 / 16 / 33. UAT-FIN-AR-005: package, Work Order and recovery replays never duplicate the receivable or the handoff", async () => {
    const again = await pkg.prepareBillingPackage(pool, sys, { salesOrderId: readySo });
    assert.deepEqual([again.outcome, again.packageId, again.consequence.receivable.outcome, again.consequence.receivable.obligationId],
      ["replayed", readyPkg.id, "replayed", (await receivableOf(readyPkg.id)).id]);
    refused(await complete(readyWo), 409, "STALE_WORK_ORDER_STATE");
    assert.deepEqual(await pkg.establishReceivablesForReadyPackages(pool, sys), [], "recovery: nothing missing");
    assert.equal(await count(`SELECT count(*)::int n FROM eos_finance.obligations WHERE tenant_id=$1 AND source_record_id=$2`, [TENANT, readyPkg.id]), 1);
    assert.equal(await count(`SELECT count(*)::int n FROM eos_finance.accounting_handoffs WHERE tenant_id=$1 AND billing_package_id=$2`, [TENANT, readyPkg.id]), 1);
    assert.equal(await count(`SELECT count(*)::int n FROM eos_finance.financial_facts WHERE tenant_id=$1 AND obligation_id=$2`, [TENANT, (await receivableOf(readyPkg.id)).id]), 1);
    await assert.rejects(q(`INSERT INTO eos_finance.obligations (id, tenant_id, operating_company_id, counterparty_id, kind, currency, source_domain, source_record_id, idempotency_key, created_by, updated_by)
        VALUES ('obl-dup',$1,'taylor',$2,'RECEIVABLE','USD','BILLING_PACKAGE',$3,'dup','x','x')`, [TENANT, readyPkg.counterparty_id, readyPkg.id]), /obligation_one_per_billing_package/,
      "the database refuses a second receivable for one package");
  });

  await t.test("Recovery: a READY package from before this activation gets its receivable once", async () => {
    const so = await salesOrder({ lease: false, charges: { tax: 0 }, lines: [SVC(1, 12000)] });
    await q(`INSERT INTO eos_commercial.sales_order_fulfillments (id, tenant_id, sales_order_id, line_number, line_kind, line_ref, quantity, source_kind, source_work_order_id,
        evidence_kind, operating_company_key, operating_company_id, account_id, fulfilled_at, recorded_by)
        VALUES ($1,$2,$3,1,'SERVICE','INSTALL-STANDARD',1,'WORK_ORDER_COMPLETION','wo-legacy','SERVICE_PERFORMED','taylor','taylor','acct-r',now(),'fixture')`, [`sof-r-${so}`, TENANT, so]);
    // A package that became READY BEFORE this activation carries no receivable (nonprod has exactly such a package). Emulated
    // faithfully: the READY row as the pre-activation code wrote it (no tax-evidence column value, no obligation, no handoff).
    const cpId = readyPkg.counterparty_id;
    await q(`INSERT INTO eos_finance.billing_packages (id, tenant_id, source_kind, sales_order_id, version, status, operating_company_id, operating_company_key,
        commercial_customer_account_id, counterparty_id, obligor_basis, commercial_disposition, currency, subtotal_minor, tax_minor, total_minor, content_fingerprint, prepared_by)
        VALUES ('bpk-pre-activation',$1,'SALES_ORDER',$2,1,'READY','taylor','taylor','acct-r',$3,'DIRECT_SALE_CUSTOMER','SALE','USD',12000,0,12000,'pre','fixture')`, [TENANT, so, cpId]);
    const r1 = await pkg.establishReceivablesForReadyPackages(pool, sys);
    assert.deepEqual(r1.map((x) => [x.packageId, x.receivable.outcome]), [["bpk-pre-activation", "recorded"]], "the missing receivable is established once");
    assert.equal(String((await fin.readObligationBalance(pool, TENANT, (await receivableOf("bpk-pre-activation")).id)).outstandingMinor), "12000");
    assert.deepEqual(await pkg.establishReceivablesForReadyPackages(pool, sys), [], "a second recovery establishes nothing");
  });

  await t.test("17 / 18. UAT-FIN-AR-006: a lease / financed disposition creates no customer receivable; Rental cannot enter", async () => {
    const so = await salesOrder({ lease: true, charges: { tax: 0 }, lines: [SVC(1)] });
    const { done } = await serviceJob(so);
    assert.deepEqual([done.billingPackage.status, done.billingPackage.readinessExceptions, done.billingPackage.consequence], ["HELD", ["UNSUPPORTED_FINANCIAL_OBLIGOR"], null]);
    const [p] = (await packages(so)).rows;
    assert.equal(await receivableOf(p.id), undefined);
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await assert.rejects(pkg.establishPackageReceivableOn(c, sys, p.id), code("BILLING_PACKAGE_NOT_READY"));
    } finally { await c.query("ROLLBACK"); c.release(); }
    assert.equal(await count(`SELECT count(*)::int n FROM eos_finance.obligations WHERE tenant_id=$1 AND source_domain <> 'BILLING_PACKAGE'`, [TENANT]), 0, "18: no Rental / other-source receivable");
  });

  await t.test("19 / 20 / 21. CONSOLIDATED and an unresolved company fail closed; no client can manufacture a receivable or a handoff", async () => {
    const cp = readyPkg.counterparty_id;
    for (const [company, expected] of [["consolidated", "CONSOLIDATED_NOT_A_COMPANY"], ["nobody-co", "OPERATING_COMPANY_UNRESOLVED"]]) {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        await assert.rejects(fin.openObligationOn(c, sys, { operatingCompanyId: company, counterpartyId: cp, kind: "RECEIVABLE", currency: "USD", sourceDomain: "BILLING_PACKAGE",
          sourceRecordId: `x-${company}`, originationAmountMinor: 1, basis: "x", effectiveAt: new Date(), idempotencyKey: `x-${company}` }), code(expected));
      } finally { await c.query("ROLLBACK"); c.release(); }
    }
    refused(await call(techA, WO, "createReceivable", { amountMinor: 1 }), 404, "UNKNOWN_OPERATION");
    await assert.rejects(q(`UPDATE eos_finance.accounting_handoffs SET obligation_id = 'x' WHERE billing_package_id=$1`, [readyPkg.id]), /ACCOUNTING_HANDOFF_IMMUTABLE/);
    await assert.rejects(q(`UPDATE eos_finance.accounting_handoffs SET provider_document_reference = 'INV-1' WHERE billing_package_id=$1`, [readyPkg.id]),
      "a provider reference cannot be written before a delivery package exists");
  });

  await t.test("22 / 23. Sales and Technician employees hold no Finance write", async () => {
    for (const roles of [["salesperson"], ["salesManager"], ["technician", "equipmentInstaller"]]) {
      const caps = await capabilitiesForRoleKeys(pool, TENANT, roles);
      assert.equal([...caps].some((k) => /^finance\.(invoice\.issue|adjustment|payment\.apply|refund)/.test(k)), false, roles.join("+"));
    }
  });

  await t.test("27 / 35. UAT-FIN-AR-008: a configured company destination is associated; Taylor and Ventana stay company-specific; a later destination attaches to a pending handoff", async () => {
    const taylorDest = await fin.configureAccountingDestination(pool, sys, { operatingCompanyId: "taylor", displayName: "Taylor accounting (UAT)", activate: true });
    const ventanaDest = await fin.configureAccountingDestination(pool, sys, { operatingCompanyId: "ventana", displayName: "Ventana accounting (UAT)", activate: true });
    // The earlier PENDING_DESTINATION handoff gains Taylor's destination -- nothing sent.
    assert.ok((await pkg.refreshAccountingHandoffs(pool, sys)).attached >= 1);
    const h0 = await handoffOf(readyPkg.id);
    assert.deepEqual([h0.status, h0.accounting_destination_id, h0.readiness_exceptions, h0.provider_document_reference], ["READY_FOR_DELIVERY", taylorDest.id, [], null]);
    // A new Taylor READY package: READY_FOR_DELIVERY at once, with Taylor's destination.
    const so = await salesOrder({ lease: false, charges: { tax: 1000 }, lines: [SVC(1)] });
    const { done } = await serviceJob(so);
    assert.deepEqual([done.billingPackage.consequence.handoff.status, (await handoffOf(done.billingPackage.packageId)).accounting_destination_id], ["READY_FOR_DELIVERY", taylorDest.id]);
    // A Ventana READY package (fulfilled by fixture) -> Ventana's own destination.
    const vso = await salesOrder({ company: "ventana", lease: false, charges: { tax: 0 }, lines: [SVC(1)] });
    await q(`INSERT INTO eos_commercial.sales_order_fulfillments (id, tenant_id, sales_order_id, line_number, line_kind, line_ref, quantity, source_kind, source_work_order_id,
        evidence_kind, operating_company_key, operating_company_id, account_id, fulfilled_at, recorded_by)
        VALUES ($1,$2,$3,1,'SERVICE','INSTALL-STANDARD',1,'WORK_ORDER_COMPLETION','wo-ventana','SERVICE_PERFORMED','ventana','ventana','acct-r',now(),'fixture')`, [`sof-v-${vso}`, TENANT, vso]);
    const v = await pkg.prepareBillingPackage(pool, sys, { salesOrderId: vso });
    const vh = await handoffOf(v.packageId);
    const var_ = await receivableOf(v.packageId);
    assert.deepEqual([v.status, vh.operating_company_id, vh.accounting_destination_id, var_.operating_company_id], ["READY", "ventana", ventanaDest.id, "ventana"]);
    assert.notEqual(vh.accounting_destination_id, taylorDest.id);
  });

  await t.test("F. supersession: a READY package's receivable is VOIDED with reversing facts, never edited; the new version gets its own", async () => {
    const so = await salesOrder({ lease: false, charges: { tax: 500, shipping: 0 }, lines: [SVC(1, 10000)] });
    const { done } = await serviceJob(so);
    const v1 = done.billingPackage.packageId;
    const ar1 = await receivableOf(v1);
    await q(`UPDATE eos_commercial.sales_agreements SET shipping_minor = 2000 WHERE id=(SELECT sales_agreement_id FROM eos_commercial.sales_orders WHERE id=$1)`, [so]); // fixture: changed governed evidence
    const v2 = await pkg.prepareBillingPackage(pool, sys, { salesOrderId: so });
    assert.deepEqual([v2.outcome, v2.version, v2.totalMinor], ["superseded", 2, "12500"]);
    const voided = await fin.readObligationBalance(pool, TENANT, ar1.id);
    assert.deepEqual([voided.status, String(voided.originatedMinor), String(voided.outstandingMinor)], ["VOID", "0", "0"]);
    const f1 = (await q(`SELECT amount_minor::text, reverses_fact_id IS NOT NULL AS reversal FROM eos_finance.financial_facts WHERE obligation_id=$1 ORDER BY created_at`, [ar1.id])).rows;
    assert.deepEqual(f1, [{ amount_minor: "10500", reversal: false }, { amount_minor: "-10500", reversal: true }], "the original origination is kept; a reversal answers it");
    const ar2 = await receivableOf(v2.packageId);
    assert.deepEqual([ar2.status, String((await fin.readObligationBalance(pool, TENANT, ar2.id)).outstandingMinor)], ["OPEN", "12500"]);
    assert.equal((await handoffOf(v1)).status, "SUPERSEDED");
  });
});
