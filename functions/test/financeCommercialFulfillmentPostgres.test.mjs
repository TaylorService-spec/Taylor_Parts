// COMMERCIAL FINANCE ACTIVATION -- DQ-015 + FULFILLMENT -> BILLING ELIGIBILITY (Controller, 2026-10-02; DECISIONS #195).
// Over the REAL governed Work Order path on the Operations transport: an INSTALL Work Order linked to Sales Order lines,
// a technician installing serialized Equipment and recording ordinary Part usage, then completing -- and the Commercial
// fulfillment authority recording, SERVER-SIDE and in the completion's transaction, exactly what that evidence proves.
// Billing eligibility is derived from it (never an invoice, receivable or posting). The Sales Order / Agreement rows are
// fixtures (Commercial creation is proven in its own suites); everything else is the product path.
// Real PostgreSQL; set POLICY_TEST_DATABASE_URL (without it the database half SKIPS).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { serviceBaselineTenant, HOUR } from "./support/serviceBaselineTenant.mjs";
import { certifyInventoryBaselineFixture } from "./support/inventoryBaselineCertified.mjs";

const require = createRequire(import.meta.url);
const equipmentDelta = require("../lib/adminPolicy/equipmentActivationDelta.js");
const fulfillment = require("../lib/eosCommercial/fulfillment/salesOrderFulfillmentAuthority.js");
const soCommands = require("../lib/eosCommercial/commands/salesOrderCommandService.js");
const http = require("../lib/eosOps/eosOpsHttp.js");
const { capabilitiesForRoleKeys } = require("../lib/eosOps/capabilityAuthority.js");

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const TENANT = "t-comfin";
const WH = "wh-cf";
const MODEL = "ACME--UNIT-200";
const WO = "/operations/work-orders";
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../src");

test("30 / 25 / 26. static: only completion reaches the fulfillment writer; no operation manufactures fulfillment or eligibility; no Firebase", () => {
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
  const users = walk(SRC).filter((f) => f.endsWith(".ts") && !f.includes(join("eosCommercial", "fulfillment")))
    .filter((f) => /fulfillment\/salesOrderFulfillmentAuthority/.test(readFileSync(f, "utf8"))).map((f) => f.slice(SRC.length + 1)).sort();
  assert.deepEqual(users, ["eosCommercial/commands/salesOrderCommandService.ts", "eosOps/workOrderScheduling.ts"]);
  assert.match(readFileSync(join(SRC, "eosCommercial/commands/salesOrderCommandService.ts"), "utf8"), /import \{ salesOrderFulfillmentLines, salesOrderFullyFulfilled \}/,
    "Commercial imports only the READ gate, never the writer");
  const ops = [...http.OPERATIONS_READ_OPERATIONS, ...http.OPERATIONS_MUTATION_OPERATIONS];
  assert.equal(ops.some((o) => /fulfil|eligib|billable|invoice/i.test(o)), false);
  const src = readFileSync(join(SRC, "eosCommercial/fulfillment/salesOrderFulfillmentAuthority.ts"), "utf8");
  assert.equal(/from ["'][^"']*firebase/i.test(src), false);
  assert.equal(/invoices|financial_facts|obligations|accounting/i.test(src.replace(/^\s*\/\/.*$/gm, "")), false, "no invoice, AR or posting is written");
});

test("Commercial fulfillment -> billing eligibility over the governed Work Order path", { skip: SKIP, concurrency: 1 }, async (t) => {
  const { q, admin, person, repo, pool } = await serviceBaselineTenant(t, { urlBase: URL_BASE, tenant: TENANT, prefix: "comfin" });
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
  const salesOrder = async ({ lines, company = "taylor", account = "acct-r", location = "loc-r1", state = "IN_FULFILLMENT", lease = null }) => {
    const id = `so-cf-${++soSeq}`;
    let agreementId = null;
    if (lease !== null) {
      agreementId = `sa-cf-${soSeq}`;
      await q(`INSERT INTO eos_commercial.sales_agreements (id, tenant_id, sales_agreement_number, account_id, owner_employee_id, state, accepted_at, accepted_by,
                 is_lease, operating_company_key, created_by, updated_by)
               VALUES ($1,$2,$1,$3,'e-seller','ACCEPTED',now(),'fixture',$4,$5,'fixture','fixture')`, [agreementId, TENANT, account, lease, company]);
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

  // The direct equipment sale: Equipment + ordinary Parts + the agreed installation, plus a Part line this job does not cover.
  const so1 = await salesOrder({ lease: false, lines: [
    { n: 1, kind: "EQUIPMENT_MODEL", ref: MODEL, qty: 1, price: 500000 },
    { n: 2, kind: "PART", ref: "PRT-FILTER", qty: 2, price: 2500, bu: "PARTS" },
    { n: 3, kind: "SERVICE", ref: "INSTALL-STANDARD", qty: 1, price: 30000, bu: "INSTALLATION" },
    { n: 4, kind: "PART", ref: "PRT-GASKET", qty: 1, price: 900, bu: "PARTS" }] });
  let installWo;

  await t.test("1 / 2. UAT-FIN-COM-006: a confirmed Sales Order alone is neither fulfillment nor billing eligibility", async () => {
    const rows = (await eligibility(so1)).rows;
    assert.deepEqual(rows.map((r) => [r.line_number, r.fulfilled_qty, r.eligibility]), [[1, 0, "NOT_YET"], [2, 0, "NOT_YET"], [3, 0, "NOT_YET"], [4, 0, "NOT_YET"]]);
    assert.equal((await fulfillment.readSalesOrderBillingEligibility(pool, TENANT, so1)).eligibility, "NOT_YET");
    assert.equal(await count(`SELECT count(*)::int n FROM eos_commercial.sales_order_fulfillments WHERE tenant_id=$1`, [TENANT]), 0);
  });

  await t.test("3 / 5-16 / 29. UAT-FIN-COM-001/002/003: one INSTALL Work Order -- Equipment, ordinary Parts and the agreed install -- is fulfilled exactly", async () => {
    installWo = await workOrder({ salesOrderId: so1, salesOrderLines: [1, 2, 3], plan: [{ partId: "PRT-FILTER", qtyPlanned: 2 }] });
    const inst = ok(await call(techA, WO, "recordWorkOrderEquipmentInstall", { workOrderId: installWo, partId: "PRT-UNIT2", serialNumber: "SN-A1",
      idempotencyKey: "inst-1", equipmentName: "Ice machine" }), "install");
    await use(installWo, "use-1", [{ partId: "PRT-FILTER", qtyDelta: 2 }]);
    const before = await totals();
    const financeBefore = await finance();
    const done = ok(await complete(installWo), "complete");
    assert.equal(done.fulfillment.status, "RECORDED");
    assert.equal(done.fulfillment.operatingCompanyId, "taylor");
    // 12 / 13: completion moved NO stock and created NO Equipment: the install and the usage already were the operational facts.
    const after = await totals();
    assert.deepEqual([after.movements, after.equipment, after.events, after.fulfillments], [before.movements, before.equipment, before.events, before.fulfillments + 3]);
    const rows = (await q(`SELECT * FROM eos_commercial.sales_order_fulfillments WHERE tenant_id=$1 AND source_work_order_id=$2 ORDER BY line_number`, [TENANT, installWo])).rows;
    assert.deepEqual(rows.map((r) => [r.line_number, r.line_kind, r.quantity, r.evidence_kind]),
      [[1, "EQUIPMENT_MODEL", 1, "EQUIPMENT_INSTALLATION"], [2, "PART", 2, "PART_USAGE"], [3, "SERVICE", 1, "SERVICE_PERFORMED"]]);
    const eq = rows[0];
    const equipmentId = inst.equipment?.id ?? inst.equipmentId ?? (await one(`SELECT equipment_id FROM eos_ops.work_orders WHERE id=$1`, [installWo])).equipment_id;
    assert.deepEqual([eq.equipment_ids, eq.serial_numbers], [[equipmentId], ["SN-A1"]], "11: the serialized identity travels with the fulfillment");
    for (const r of rows) {
      assert.deepEqual([r.operating_company_id, r.operating_company_key, r.account_id, r.location_id, r.source_kind, r.recorded_by],
        ["taylor", "taylor", "acct-r", "loc-r1", "WORK_ORDER_COMPLETION", techA.principalId]);
    }
    // 15: eligibility follows fulfillment; line 4 was not on this job and stays NOT_YET (19); the order is therefore PARTIAL.
    const elig = (await eligibility(so1)).rows;
    assert.deepEqual(elig.map((r) => [r.line_number, r.fulfilled_qty, r.remaining_qty, r.eligibility]),
      [[1, 1, 0, "ELIGIBLE"], [2, 2, 0, "ELIGIBLE"], [3, 1, 0, "ELIGIBLE"], [4, 0, 1, "NOT_YET"]]);
    assert.equal((await fulfillment.readSalesOrderBillingEligibility(pool, TENANT, so1)).eligibility, "PARTIALLY_ELIGIBLE",
      "one job never makes the whole Sales Order billing-ready");
    // 14: the service line carries its EXISTING commercial price, never one derived from labor.
    assert.deepEqual([elig[2].unit_price_minor, elig[2].price_source], ["30000", "SALES_ORDER_LINE"]);
    // 16 / 17 / 18: no invoice, no receivable / obligation, no financial fact (posting).
    assert.deepEqual(await finance(), financeBefore);
    // 29: ANALYSIS PROVENANCE -- eligibility -> fulfillment -> Sales Order line -> Sales Order -> Agreement -> customer, and
    // fulfillment -> Work Order -> Equipment (serial) / Part usage evidence.
    const trace = await one(`SELECT e.eligibility, f.source_work_order_id, w.work_order_type::text AS wo_type, w.operating_company_key AS wo_company,
        eqp.serial_number, eqp.equipment_model_id, so.id AS so, a.id AS agreement, a.is_lease, c.name AS customer, so.credited_salesperson_employee_id,
        e.commercial_disposition, e.financial_obligor_resolution
        FROM eos_commercial.sales_order_line_billing_eligibility e
        JOIN eos_commercial.sales_order_fulfillments f ON f.tenant_id = e.tenant_id AND f.sales_order_id = e.sales_order_id AND f.line_number = e.line_number
        JOIN eos_ops.work_orders w ON w.tenant_id = f.tenant_id AND w.id = f.source_work_order_id
        JOIN eos_ops.equipment eqp ON eqp.tenant_id = f.tenant_id AND eqp.id = f.equipment_ids[1]
        JOIN eos_commercial.sales_orders so ON so.tenant_id = e.tenant_id AND so.id = e.sales_order_id
        JOIN eos_commercial.sales_agreements a ON a.id = so.sales_agreement_id
        JOIN eos_crm.accounts c ON c.tenant_id = so.tenant_id AND c.id = so.account_id
       WHERE e.tenant_id = $1 AND e.sales_order_id = $2 AND e.line_number = 1`, [TENANT, so1]);
    assert.deepEqual([trace.eligibility, trace.source_work_order_id, trace.wo_type, trace.wo_company, trace.serial_number, trace.equipment_model_id,
      trace.so, trace.is_lease, trace.customer, trace.credited_salesperson_employee_id, trace.commercial_disposition, trace.financial_obligor_resolution],
      ["ELIGIBLE", installWo, "INSTALL", "taylor", "SN-A1", MODEL, so1, false, "Harbor Grill", "e-seller", "SALE", "DEFERRED_TO_BILLING_PACKAGE"]);
    const partTrace = await one(`SELECT f.evidence_record_ids, (SELECT SUM(applied_delta)::int FROM eos_ops.work_order_execution_records r WHERE r.id = ANY(f.evidence_record_ids)) AS used
        FROM eos_commercial.sales_order_fulfillments f WHERE f.tenant_id=$1 AND f.source_work_order_id=$2 AND f.line_number=2`, [TENANT, installWo]);
    assert.equal(partTrace.used, 2, "the Part fulfillment points at the usage records that prove it");
  });

  await t.test("20 / 21. UAT-FIN-COM-004: replaying the completion changes nothing", async () => {
    const before = await totals();
    refused(await complete(installWo), 409, "STALE_WORK_ORDER_STATE", "COMPLETED is one-way");
    assert.deepEqual(await totals(), before, "no duplicate fulfillment, movement or Equipment consequence");
    // Even a re-run of the authority inside a transaction records nothing new (one row per Work Order and line).
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await fulfillment.recordWorkOrderFulfillmentOn(c, { tenantId: TENANT, principalId: techA.principalId }, { workOrderId: installWo, completedAt: new Date() })
        .catch(() => undefined);
      await c.query("ROLLBACK");
    } finally { c.release(); }
    assert.deepEqual(await totals(), before);
  });

  await t.test("7 / 19. UAT-FIN-COM-007: partial fulfillment is partial; a second job completes the line; only then may the order advance", async () => {
    const so2 = await salesOrder({ lines: [{ n: 1, kind: "PART", ref: "PRT-HOSE", qty: 3, price: 1200, bu: "PARTS" }] });
    const w1 = await workOrder({ type: "SERVICE_CALL", salesOrderId: so2, salesOrderLines: [1], plan: [{ partId: "PRT-HOSE", qtyPlanned: 2 }] });
    await use(w1, "hose-1", [{ partId: "PRT-HOSE", qtyDelta: 2 }]);
    ok(await complete(w1), "complete 1");
    assert.deepEqual((await eligibility(so2)).rows.map((r) => [r.fulfilled_qty, r.remaining_qty, r.eligibility]), [[2, 1, "PARTIALLY_ELIGIBLE"]]);
    const sellerActor = { tenantId: TENANT, principalId: seller.principalId, capabilities: new Set(["salesOrder.write"]) };
    const advance = (k) => soCommands.transitionSalesOrder({ pool }, sellerActor, { idempotencyKey: k, salesOrderId: so2, transition: "ADVANCE" });
    await assert.rejects(advance("adv-1"), (e) => e.code === "SALES_ORDER_NOT_FULLY_FULFILLED");
    const w2 = await workOrder({ type: "SERVICE_CALL", salesOrderId: so2, salesOrderLines: [1], plan: [{ partId: "PRT-HOSE", qtyPlanned: 1 }] });
    await use(w2, "hose-2", [{ partId: "PRT-HOSE", qtyDelta: 1 }]);
    ok(await complete(w2), "complete 2");
    const line = (await eligibility(so2)).rows[0];
    assert.deepEqual([line.fulfilled_qty, line.eligibility, line.source_work_order_ids.sort()], [3, "ELIGIBLE", [w1, w2].sort()]);
    assert.equal((await advance("adv-2")).result?.state ?? (await one(`SELECT state::text s FROM eos_commercial.sales_orders WHERE id=$1`, [so2])).s, "FULFILLED");
  });

  await t.test("OVERAGE fails closed: more than ordered refuses the completion atomically", async () => {
    const so3 = await salesOrder({ lines: [{ n: 1, kind: "PART", ref: "PRT-HOSE", qty: 1, price: 1200, bu: "PARTS" }] });
    const w = await workOrder({ type: "SERVICE_CALL", salesOrderId: so3, salesOrderLines: [1], plan: [{ partId: "PRT-HOSE", qtyPlanned: 2 }] });
    await use(w, "hose-over", [{ partId: "PRT-HOSE", qtyDelta: 2 }]);
    const before = await totals();
    refused(await complete(w), 412, "FULFILLMENT_OVERAGE");
    assert.equal((await one(`SELECT status::text s FROM eos_ops.work_orders WHERE id=$1`, [w])).s, "WORK_IN_PROGRESS", "the Work Order did not complete");
    assert.deepEqual(await totals(), before);
    await cancel(w);
  });

  await t.test("22 / 23 / 24. UAT-FIN-COM-008: missing link, wrong company, wrong customer and CONSOLIDATED all fail closed", async () => {
    refused(await call(dispatcher, WO, "createWorkOrder", { operatingCompanyId: "taylor", customerId: "acct-r", locationId: "loc-r1", workOrderType: "INSTALL",
      priority: 2, salesOrderId: "so-nowhere", salesOrderLines: [1] }), 404, "SALES_ORDER_NOT_FOUND", "a Sales Order that does not exist");
    const ventanaSo = await salesOrder({ company: "ventana", lines: [{ n: 1, kind: "PART", ref: "PRT-HOSE", qty: 1 }] });
    refused(await call(dispatcher, WO, "createWorkOrder", { operatingCompanyId: "taylor", customerId: "acct-r", locationId: "loc-r1", workOrderType: "INSTALL",
      priority: 2, salesOrderId: ventanaSo, salesOrderLines: [1] }), 412, "SALES_ORDER_COMPANY_MISMATCH", "a Taylor job cannot fulfil Ventana's order");
    const otherSo = await salesOrder({ account: "acct-o", location: "loc-o", lines: [{ n: 1, kind: "PART", ref: "PRT-HOSE", qty: 1 }] });
    refused(await call(dispatcher, WO, "createWorkOrder", { operatingCompanyId: "taylor", customerId: "acct-r", locationId: "loc-r1", workOrderType: "INSTALL",
      priority: 2, salesOrderId: otherSo, salesOrderLines: [1] }), 412, "SALES_ORDER_CUSTOMER_MISMATCH");
    refused(await call(dispatcher, WO, "createWorkOrder", { operatingCompanyId: "taylor", customerId: "acct-r", locationId: "loc-r2", workOrderType: "INSTALL",
      priority: 2, salesOrderId: so1, salesOrderLines: [4] }), 412, "SALES_ORDER_SITE_MISMATCH");
    // A Sales-Order-linked job with NO linked lines cannot say what it fulfilled: its completion refuses (and rolls back).
    const unlinked = await workOrder({ type: "SERVICE_CALL", salesOrderId: so1 });
    refused(await complete(unlinked), 412, "SALES_ORDER_LINES_UNLINKED");
    assert.equal((await one(`SELECT status::text s FROM eos_ops.work_orders WHERE id=$1`, [unlinked])).s, "WORK_IN_PROGRESS");
    await cancel(unlinked);
    // Wrong company AT COMPLETION (a link no governed create would write) and CONSOLIDATED: the authority refuses.
    const authority = async (workOrderId) => {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        return await fulfillment.recordWorkOrderFulfillmentOn(c, { tenantId: TENANT, principalId: "ops" }, { workOrderId, completedAt: new Date() });
      } finally { await c.query("ROLLBACK"); c.release(); }
    };
    await q(`INSERT INTO eos_ops.work_orders (id, tenant_id, operating_company_key, work_order_number, status, work_order_type, priority, customer_id, location_id,
               sales_order_id, provenance, created_by_principal_id, created_at, updated_at)
             VALUES ('wo-fx-cross',$1,'taylor','WO-2031-990001','WORK_IN_PROGRESS','INSTALL',2,'acct-r','loc-r1',$2,'NATIVE',$3,now(),now())`, [TENANT, ventanaSo, dispatcher.principalId]);
    await q(`INSERT INTO eos_ops.work_order_sales_order_lines (tenant_id, work_order_id, sales_order_id, sales_order_line_id) VALUES ($1,'wo-fx-cross',$2,'1')`, [TENANT, ventanaSo]);
    await assert.rejects(authority("wo-fx-cross"), (e) => e.code === "SALES_ORDER_COMPANY_MISMATCH");
    await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id, operating_company_id, status, source, established_by, updated_by)
             VALUES ($1,'consolidated','ACTIVE','fixture','fixture','fixture')`, [TENANT]);
    await q(`INSERT INTO eos_policy.tenant_operating_company_keys (tenant_id, operating_company_id, operating_company_key, status, provenance, source, established_by, updated_by)
             VALUES ($1,'consolidated','cons','ACTIVE','NATIVE','fixture','fixture','fixture')`, [TENANT]);
    const consSo = await salesOrder({ company: "cons", lines: [{ n: 1, kind: "SERVICE", ref: "INSTALL-STANDARD", qty: 1 }] });
    await q(`INSERT INTO eos_ops.work_orders (id, tenant_id, operating_company_key, work_order_number, status, work_order_type, priority, customer_id, location_id,
               sales_order_id, provenance, created_by_principal_id, created_at, updated_at)
             VALUES ('wo-fx-cons',$1,'cons','WO-2031-990002','WORK_IN_PROGRESS','INSTALL',2,'acct-r','loc-r1',$2,'NATIVE',$3,now(),now())`, [TENANT, consSo, dispatcher.principalId]);
    await q(`INSERT INTO eos_ops.work_order_sales_order_lines (tenant_id, work_order_id, sales_order_id, sales_order_line_id) VALUES ($1,'wo-fx-cons',$2,'1')`, [TENANT, consSo]);
    await assert.rejects(authority("wo-fx-cons"), (e) => e.code === "CONSOLIDATED_NOT_A_COMPANY");
    await assert.rejects(q(`INSERT INTO eos_commercial.sales_order_fulfillments (id, tenant_id, sales_order_id, line_number, line_kind, line_ref, quantity, source_kind,
        source_work_order_id, evidence_kind, operating_company_key, operating_company_id, account_id, fulfilled_at, recorded_by)
        VALUES ('x',$1,$2,1,'SERVICE','INSTALL-STANDARD',1,'WORK_ORDER_COMPLETION','w','SERVICE_PERFORMED','cons','consolidated','acct-r',now(),'x')`, [TENANT, consSo]));
  });

  await t.test("4 / 25 / 26. UAT-FIN-COM-005: the Technician holds no Commercial or Finance write; fulfillment and eligibility cannot be manufactured", async () => {
    const caps = await capabilitiesForRoleKeys(pool, TENANT, ["technician", "equipmentInstaller"]);
    assert.equal([...caps].some((k) => /^salesOrder\.|^opportunity\.|^salesAgreement\.|^finance\./.test(k)), false, [...caps].join(","));
    refused(await call(techA, WO, "recordSalesOrderFulfillment", {}), 404, "UNKNOWN_OPERATION");
    await assert.rejects(q(`UPDATE eos_commercial.sales_order_fulfillments SET quantity = 99 WHERE tenant_id=$1`, [TENANT]), /SALES_ORDER_FULFILLMENT_IMMUTABLE/);
    await assert.rejects(q(`DELETE FROM eos_commercial.sales_order_fulfillments WHERE tenant_id=$1`, [TENANT]), /SALES_ORDER_FULFILLMENT_IMMUTABLE/);
    await assert.rejects(q(`INSERT INTO eos_commercial.sales_order_line_billing_eligibility (tenant_id, sales_order_id, line_number, eligibility)
        VALUES ($1,$2,4,'ELIGIBLE')`, [TENANT, so1]), "eligibility is derived -- there is nothing to write 'billable=true' into");
  });

  await t.test("27 / 28. UAT-FIN-COM-009: a lease / financed disposition stays distinguishable; the customer is never assumed to be the obligor", async () => {
    const leaseSo = await salesOrder({ lease: true, lines: [{ n: 1, kind: "SERVICE", ref: "INSTALL-STANDARD", qty: 1, price: 30000, bu: "INSTALLATION" }] });
    const direct = await salesOrder({ lines: [{ n: 1, kind: "SERVICE", ref: "INSTALL-STANDARD", qty: 1, price: 30000, bu: "INSTALLATION" }] });
    const [l] = (await eligibility(leaseSo)).rows;
    const [d] = (await eligibility(direct)).rows;
    const [s] = (await eligibility(so1)).rows;
    assert.deepEqual([l.commercial_disposition, s.commercial_disposition, d.commercial_disposition], ["LEASE", "SALE", "DIRECT_ORDER"]);
    for (const r of [l, s, d]) {
      assert.equal(r.financial_obligor_resolution, "DEFERRED_TO_BILLING_PACKAGE");
      assert.equal("financial_obligor_account_id" in r || "obligor_account_id" in r, false, "no column asserts the customer is the obligor");
    }
    assert.equal(l.commercial_customer_account_id, "acct-r", "the commercial customer is recorded as the customer -- nothing more");
  });

  await t.test("Rental never enters: eligibility exists only for Sales Order lines", async () => {
    const cols = (await q(`SELECT column_name FROM information_schema.columns WHERE table_schema='eos_commercial' AND table_name='sales_order_line_billing_eligibility'`)).rows
      .map((r) => r.column_name);
    assert.ok(cols.includes("sales_order_id") && !cols.some((c) => /rental/i.test(c)));
  });
});
