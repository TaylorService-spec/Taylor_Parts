// THE EOS OPERATIONAL BILLING PACKAGE (Controller 2026-10-02; DECISIONS #196) over the governed Work Order path: Commercial
// fulfillment -> billing eligibility -> the package, prepared server-side in the completion transaction. Not an invoice, not
// a receivable, not a posting, nothing sent. Sales Order / Agreement rows are fixtures (Commercial creation is proven
// elsewhere). Real PostgreSQL; set POLICY_TEST_DATABASE_URL (without it the database half SKIPS).
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
const http = require("../lib/eosOps/eosOpsHttp.js");
const { capabilitiesForRoleKeys } = require("../lib/eosOps/capabilityAuthority.js");

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const TENANT = "t-bpkg";
const WH = "wh-cf";
const MODEL = "ACME--UNIT-200";
const WO = "/operations/work-orders";
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../src");

test("13-17 / 27. static: no operation creates or edits a package; no invoice / posting / provider / credential; no Firebase", () => {
  const ops = [...http.OPERATIONS_READ_OPERATIONS, ...http.OPERATIONS_MUTATION_OPERATIONS];
  assert.equal(ops.some((o) => /package|billing|invoice|billable/i.test(o)), false);
  const src = readFileSync(join(SRC, "eosFinance/billingPackage.ts"), "utf8");
  const code = src.replace(/^\s*\/\/.*$/gm, "");
  assert.equal(/from ["'][^"']*firebase/i.test(src), false);
  assert.equal(/INSERT INTO eos_finance\.(invoices|financial_facts)|fetch\(|https?:\/\/|credential|quickbooks|netsuite|sage|xero|dynamics/i.test(code), false,
    "no invoice, no direct fact write, no network call, credential or provider-specific code (the receivable goes through openObligationOn, #197)");
});

test("Operational Billing Package over the governed path", { skip: SKIP, concurrency: 1 }, async (t) => {
  const { q, admin, person, repo, pool } = await serviceBaselineTenant(t, { urlBase: URL_BASE, tenant: TENANT, prefix: "bpkg" });
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

  const sys = { tenantId: TENANT, principalId: "finance-recovery" };
  const packages = (soId) => q(`SELECT * FROM eos_finance.billing_packages WHERE tenant_id=$1 AND sales_order_id=$2 ORDER BY version`, [TENANT, soId]);
  const pkgLines = (id) => q(`SELECT * FROM eos_finance.billing_package_lines WHERE package_id=$1 ORDER BY line_number`, [id]);
  const serviceJob = async (soId, lines = [1]) => {
    const w = await workOrder({ type: "SERVICE_CALL", salesOrderId: soId, salesOrderLines: lines });
    return ok(await complete(w), "complete");
  };
  const SVC = (n = 1, price = 30000) => ({ n, kind: "SERVICE", ref: "INSTALL-STANDARD", qty: 1, price, bu: "INSTALLATION" });

  let direct, directPackage;
  await t.test("3 / 5-12 / 26. UAT-FIN-BPK-001: a fully eligible direct sale produces ONE READY package -- lines, prices, totals, company, customer, counterparty, lineage", async () => {
    direct = await salesOrder({ lease: false, charges: { shipping: 5000, install: 0, tax: 4100, down: 10000, tradeIn: 0 }, lines: [
      { n: 1, kind: "EQUIPMENT_MODEL", ref: MODEL, qty: 1, price: 500000 },
      { n: 2, kind: "PART", ref: "PRT-FILTER", qty: 2, price: 2500, bu: "PARTS" }, SVC(3)] });
    const wo = await workOrder({ salesOrderId: direct, salesOrderLines: [1, 2, 3], plan: [{ partId: "PRT-FILTER", qtyPlanned: 2 }] });
    ok(await call(techA, WO, "recordWorkOrderEquipmentInstall", { workOrderId: wo, partId: "PRT-UNIT2", serialNumber: "SN-A1", idempotencyKey: "inst", equipmentName: "Ice machine" }), "install");
    await use(wo, "use", [{ partId: "PRT-FILTER", qtyDelta: 2 }]);
    const done = ok(await complete(wo), "complete");
    assert.deepEqual([done.billingPackage.outcome, done.billingPackage.status, done.billingPackage.version, done.billingPackage.readinessExceptions],
      ["recorded", "READY", 1, []]);
    const [p] = (await packages(direct)).rows;
    directPackage = p;
    // 8: totals reconcile to the lines and the Agreement's governed charges, in minor units.
    assert.deepEqual([p.subtotal_minor, p.shipping_minor, p.install_charge_minor, p.tax_minor, p.total_minor, p.down_payment_minor, p.trade_in_minor, p.balance_minor],
      ["535000", "5000", "0", "4100", "544100", "10000", "0", "534100"]);
    const lines = (await pkgLines(p.id)).rows;
    assert.deepEqual(lines.map((l) => [l.sales_order_line_number, l.kind, l.billable_qty, l.unit_price_minor, l.extended_minor, l.price_source]),
      [[1, "EQUIPMENT_MODEL", 1, "500000", "500000", "SALES_ORDER_LINE"], [2, "PART", 2, "2500", "5000", "SALES_ORDER_LINE"], [3, "SERVICE", 1, "30000", "30000", "SALES_ORDER_LINE"]]);
    assert.equal(lines.reduce((s, l) => s + BigInt(l.extended_minor), 0n), BigInt(p.subtotal_minor));
    // 9-12: currency, company, customer, counterparty for the supported direct sale.
    const cp = await one(`SELECT kind, crm_account_id FROM eos_finance.financial_counterparties WHERE tenant_id=$1 AND id=$2`, [TENANT, p.counterparty_id]);
    assert.deepEqual([p.currency, p.operating_company_id, p.commercial_customer_account_id, p.commercial_disposition, p.obligor_basis, cp.kind, cp.crm_account_id],
      ["USD", "taylor", "acct-r", "SALE", "DIRECT_SALE_CUSTOMER", "EXTERNAL_ORGANIZATION", "acct-r"]);
    // 26: lineage -- package -> line -> fulfillment -> Sales Order line -> order -> Agreement -> customer; -> Work Order -> Equipment serial.
    const trace = await one(`SELECT f.source_work_order_id, f.serial_numbers[1] AS serial, eqp.equipment_model_id, sol.unit_price_minor, so.id AS so, a.id AS agreement, c.name AS customer,
        e.eligibility FROM eos_finance.billing_package_lines bl
        JOIN eos_commercial.sales_order_fulfillments f ON f.id = ANY(bl.fulfillment_ids)
        JOIN eos_commercial.sales_order_line_billing_eligibility e ON e.tenant_id = bl.tenant_id AND e.sales_order_id = bl.sales_order_id AND e.line_number = bl.sales_order_line_number
        JOIN eos_commercial.sales_order_lines sol ON sol.tenant_id = bl.tenant_id AND sol.sales_order_id = bl.sales_order_id AND sol.line_number = bl.sales_order_line_number
        JOIN eos_commercial.sales_orders so ON so.tenant_id = bl.tenant_id AND so.id = bl.sales_order_id
        JOIN eos_commercial.sales_agreements a ON a.id = so.sales_agreement_id
        JOIN eos_crm.accounts c ON c.tenant_id = so.tenant_id AND c.id = so.account_id
        JOIN eos_ops.equipment eqp ON eqp.tenant_id = f.tenant_id AND eqp.id = f.equipment_ids[1]
       WHERE bl.package_id = $1 AND bl.line_number = 1`, [p.id]);
    assert.deepEqual([trace.source_work_order_id, trace.serial, trace.equipment_model_id, trace.unit_price_minor, trace.so, trace.customer, trace.eligibility],
      [wo, "SN-A1", MODEL, "500000", direct, "Harbor Grill", "ELIGIBLE"]);
    // 13-16: not an invoice, not a posting, not a receivable, nothing sent.
    // DECISIONS #197: the READY direct sale establishes exactly ONE operational receivable (its origination fact is the foundation
    // invariant); still no invoice.
    assert.deepEqual(await one(`SELECT (SELECT count(*)::int FROM eos_finance.invoices WHERE tenant_id=$1) i,
        (SELECT count(*)::int FROM eos_finance.financial_facts WHERE tenant_id=$1 AND fact_class NOT IN ('COST_EVIDENCE','OBLIGATION')) f,
        (SELECT count(*)::int FROM eos_finance.obligations WHERE tenant_id=$1 AND source_record_id = $2) o`, [TENANT, p.id]), { i: 0, f: 0, o: 1 });
    assert.equal(p.accounting_destination_id, null, "no destination configured -- and nothing is sent either way");
  });

  await t.test("4 / 25. UAT-FIN-BPK-002: replay returns the same package; content is immutable", async () => {
    const again = await pkg.prepareBillingPackage(pool, sys, { salesOrderId: direct });
    assert.deepEqual([again.outcome, again.packageId], ["replayed", directPackage.id]);
    assert.deepEqual(await pkg.prepareEligibleBillingPackages(pool, sys), [], "a READY package needs no recovery");
    assert.equal((await packages(direct)).rows.length, 1);
    await assert.rejects(q(`UPDATE eos_finance.billing_packages SET total_minor = 1 WHERE id=$1`, [directPackage.id]), /BILLING_PACKAGE_IMMUTABLE/);
    await assert.rejects(q(`UPDATE eos_finance.billing_package_lines SET unit_price_minor = 1 WHERE package_id=$1`, [directPackage.id]), /BILLING_PACKAGE_IMMUTABLE/);
    await assert.rejects(q(`DELETE FROM eos_finance.billing_packages WHERE id=$1`, [directPackage.id]), /BILLING_PACKAGE_IMMUTABLE/);
  });

  await t.test("1 / 2. UAT-FIN-BPK-003/004: a non-eligible or partially eligible Sales Order gets no package", async () => {
    const none = await salesOrder({ lease: false, charges: { tax: 0 }, lines: [SVC(1)] });
    assert.deepEqual(await pkg.prepareBillingPackage(pool, sys, { salesOrderId: none }), { outcome: "NOT_ELIGIBLE", salesOrderId: none, eligibility: "NOT_YET" });
    const partial = await salesOrder({ lease: false, charges: { tax: 0 }, lines: [SVC(1), SVC(2)] });
    const done = await serviceJob(partial, [1]);
    assert.deepEqual([done.billingPackage.outcome, done.billingPackage.eligibility], ["NOT_ELIGIBLE", "PARTIALLY_ELIGIBLE"]);
    assert.equal((await packages(partial)).rows.length, 0, "partial-billing policy is deferred: no package");
  });

  await t.test("22 / 25. UAT-FIN-BPK-005: missing tax evidence HOLDS the package (never zero); new evidence supersedes it, history intact", async () => {
    const so = await salesOrder({ lease: false, charges: { shipping: 0, install: 0 }, lines: [SVC(1)] });
    const done = await serviceJob(so);
    assert.deepEqual([done.billingPackage.status, done.billingPackage.readinessExceptions, done.billingPackage.totalMinor], ["HELD", ["TAX_NOT_DETERMINED"], null]);
    const [held] = (await packages(so)).rows;
    assert.deepEqual([held.tax_minor, held.total_minor, held.subtotal_minor], [null, null, "30000"]);
    // The governed tax arrives (fixture: Commercial tax determination is a later authority); re-evaluation writes version 2.
    await q(`UPDATE eos_commercial.sales_agreements SET tax_minor = 2460, tax_evidence_status = 'DETERMINED', tax_evidence_currency = 'USD',
               tax_evidence_recorded_by = 'fixture', tax_evidence_recorded_at = now()
             WHERE tenant_id=$1 AND id = (SELECT sales_agreement_id FROM eos_commercial.sales_orders WHERE id=$2)`, [TENANT, so]);
    const [r] = await pkg.prepareEligibleBillingPackages(pool, sys);
    assert.deepEqual([r.outcome, r.version, r.status, r.totalMinor], ["superseded", 2, "READY", "32460"]);
    assert.equal(r.consequence.receivable.outcome, "recorded", "the READY version establishes its receivable (DECISIONS #197)");
    const all = (await packages(so)).rows;
    assert.deepEqual(all.map((p) => [p.version, p.status, p.total_minor, p.supersedes_package_id]), [[1, "SUPERSEDED", null, null], [2, "READY", "32460", held.id]]);
    assert.deepEqual(all[0].readiness_exceptions, ["TAX_NOT_DETERMINED"], "the superseded version keeps exactly what it said");
    const direct2 = await salesOrder({ lines: [SVC(1)] });
    const d = await serviceJob(direct2);
    assert.deepEqual([d.billingPackage.status, d.billingPackage.readinessExceptions], ["HELD", ["TAX_NOT_DETERMINED"]], "a direct order has no governed tax source");
  });

  await t.test("21. UAT-FIN-BPK-006: a missing price is explicit, never zero", async () => {
    const so = await salesOrder({ lease: false, charges: { tax: 0 }, lines: [{ n: 1, kind: "SERVICE", ref: "INSTALL-STANDARD", qty: 1, price: null, bu: "INSTALLATION" }] });
    const done = await serviceJob(so);
    assert.deepEqual([done.billingPackage.status, done.billingPackage.readinessExceptions], ["HELD", ["PRICE_EVIDENCE_MISSING"]]);
    const [p] = (await packages(so)).rows;
    assert.deepEqual([p.subtotal_minor, p.total_minor, (await pkgLines(p.id)).rows[0].extended_minor], [null, null, null]);
  });

  await t.test("23 / 28. UAT-FIN-BPK-007: a lease / financed disposition is HELD, never billed as a direct sale to the customer", async () => {
    const so = await salesOrder({ lease: true, charges: { tax: 0 }, lines: [SVC(1)] });
    const done = await serviceJob(so);
    assert.deepEqual([done.billingPackage.status, done.billingPackage.readinessExceptions], ["HELD", ["UNSUPPORTED_FINANCIAL_OBLIGOR"]]);
    const [p] = (await packages(so)).rows;
    assert.deepEqual([p.commercial_disposition, p.counterparty_id, p.obligor_basis], ["LEASE", null, "UNRESOLVED"]);
  });

  await t.test("19 / 20 / 24. UAT-FIN-BPK-008: wrong / CONSOLIDATED company fails closed; Rental cannot enter", async () => {
    // Fulfillment fixtures to make orders ELIGIBLE without a Work Order of their (unbound) company.
    const eligibleFixture = async (company) => {
      const so = await salesOrder({ company, lease: false, charges: { tax: 0 }, lines: [SVC(1)] });
      await q(`INSERT INTO eos_commercial.sales_order_fulfillments (id, tenant_id, sales_order_id, line_number, line_kind, line_ref, quantity, source_kind, source_work_order_id,
          evidence_kind, operating_company_key, operating_company_id, account_id, fulfilled_at, recorded_by)
          VALUES ($1,$2,$3,1,'SERVICE','INSTALL-STANDARD',1,'WORK_ORDER_COMPLETION','wo-fixture','SERVICE_PERFORMED',$4,'taylor','acct-r',now(),'fixture')`,
        [`sof-fx-${so}`, TENANT, so, company]);
      return so;
    };
    const unbound = await eligibleFixture("nobody");
    await assert.rejects(pkg.prepareBillingPackage(pool, sys, { salesOrderId: unbound }), (e) => e.code === "OPERATING_COMPANY_UNRESOLVED");
    await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id, operating_company_id, status, source, established_by, updated_by) VALUES ($1,'consolidated','ACTIVE','fixture','fixture','fixture')`, [TENANT]);
    await q(`INSERT INTO eos_policy.tenant_operating_company_keys (tenant_id, operating_company_id, operating_company_key, status, provenance, source, established_by, updated_by)
             VALUES ($1,'consolidated','cons','ACTIVE','NATIVE','fixture','fixture','fixture')`, [TENANT]);
    const cons = await eligibleFixture("cons");
    await assert.rejects(pkg.prepareBillingPackage(pool, sys, { salesOrderId: cons }), (e) => e.code === "CONSOLIDATED_NOT_A_COMPANY");
    assert.equal((await q(`SELECT 1 FROM eos_finance.billing_packages WHERE sales_order_id = ANY($1)`, [[unbound, cons]])).rows.length, 0);
    await assert.rejects(q(`INSERT INTO eos_finance.billing_packages (id, tenant_id, source_kind, sales_order_id, version, status, readiness_exceptions, operating_company_id,
        operating_company_key, commercial_customer_account_id, obligor_basis, commercial_disposition, currency, content_fingerprint, prepared_by)
        VALUES ('x',$1,'RENTAL_AGREEMENT','ra-1',1,'HELD','{X}','taylor','taylor','acct-r','UNRESOLVED','SALE','USD','f','x')`, [TENANT]), /billing_packages_source_kind_check|check constraint/);
  });

  await t.test("17 / 18. UAT-FIN-BPK-009: no Sales or Service employee holds package authority; no client can manufacture amounts", async () => {
    for (const roles of [["salesperson"], ["technician", "equipmentInstaller"], ["dispatcher"]]) {
      const caps = await capabilitiesForRoleKeys(pool, TENANT, roles);
      assert.equal([...caps].some((k) => /^finance\.(invoice\.issue|adjustment|payment\.apply|refund)/.test(k)), false, roles.join("+"));
    }
    refused(await call(techA, WO, "prepareBillingPackage", { salesOrderId: direct, totalMinor: 1 }), 404, "UNKNOWN_OPERATION");
    await assert.rejects(q(`INSERT INTO eos_finance.billing_packages (id, tenant_id, source_kind, sales_order_id, version, status, operating_company_id, operating_company_key,
        commercial_customer_account_id, obligor_basis, commercial_disposition, currency, subtotal_minor, tax_minor, total_minor, content_fingerprint, prepared_by)
        VALUES ('y',$1,'SALES_ORDER',$2,9,'READY','taylor','taylor','acct-r','DIRECT_SALE_CUSTOMER','SALE','USD',1,0,999,'f','x')`, [TENANT, direct]),
      "a READY package without a counterparty, or with totals that do not reconcile, cannot exist");
  });
});
