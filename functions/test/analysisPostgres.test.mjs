// ANALYSIS & REPORTING (EOS CONTROLLER -- NEXT 3 MAJOR ROADMAP BLOCKS, Package C, 2026-10-03; DECISIONS #208).
// Proofs over real PostgreSQL through /operations/analysis (C16):
//   STATIC    read-only, no Firebase, no AI import; every AVAILABLE measure has a basis, formula, sources and a REGISTERED read.
//   PROV      a figure lists its contributing records, each with its own governed drill-through read (which works).
//   MISSING   a missing price is MISSING_PRICE (excluded, never zero); targets / forecast ABSENT; margin STRUCTURALLY_UNKNOWN.
//   COMPANY   Taylor and Ventana separate; CONSOLIDATED is the per-currency projection over both, owning nothing.
//   DRILL     finance / sales / service / purchasing / inventory / rental figures drill to their records.
//   PERSONA   each persona sees only the measures its EXISTING reads allow; a Retail seller sees RETAIL only; refusals are 403.
//   ACTIONS   an exception offers its governed action only to a caller who already holds that capability.
//   COMPARE   period measures compare to the prior comparable window; variance and deterministic insights follow.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { serviceBaselineTenant } from "./support/serviceBaselineTenant.mjs";

const require = createRequire(import.meta.url);
const fin = require("../lib/eosFinance/financeFoundation.js");
const measures = require("../lib/eosAnalysis/measures.js");

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const TENANT = "t-analysis";
const AN = "/operations/analysis";
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

test("static: Analysis is read-only, Firebase-free and AI-free; every measure is fully defined", () => {
  for (const f of readdirSync(join(SRC, "eosAnalysis"))) {
    const s = strip(readFileSync(join(SRC, "eosAnalysis", f), "utf8"));
    assert.doesNotMatch(s, /firebase|firestore/i, `${f}: no Firebase`);
    assert.doesNotMatch(s, /from\s+["'][^"']*\/ai\//, `${f}: EOS Core analysis imports nothing from ai/`);
    assert.doesNotMatch(s, /\b(INSERT\s+INTO|UPDATE\s+\w+\.\w+\s+SET|DELETE\s+FROM)\b/i, `${f}: analysis writes nothing`);
  }
  const ids = new Set();
  for (const m of measures.MEASURES) {
    assert.equal(ids.has(m.id), false, `one definition per measure: ${m.id}`); ids.add(m.id);
    assert.ok(Object.values(measures.BASIS).includes(m.basis), `${m.id}: a governed basis`);
    assert.ok(m.readCapabilities.length > 0, `${m.id}: decided on an existing read`);
    if (m.availability === "AVAILABLE") {
      assert.ok(m.formula && m.formula !== "—" && m.sourceFacts.length > 0 && typeof m.rows === "function", `${m.id}: formula + source facts + query`);
      if (m.timeBasis === "PERIOD") assert.ok(m.periodEvent, `${m.id}: the governed event that places a record in a period`);
    } else {
      assert.ok(m.absenceReason && m.rows === null, `${m.id}: an absent measure states why, and computes nothing`);
    }
  }
});

test("analysis over PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  const { q, admin, person, pool, call, repo } = await serviceBaselineTenant(t, { urlBase: URL_BASE, tenant: TENANT, prefix: "anl" });
  const one = async (sql, v = []) => (await q(sql, v)).rows[0];
  const ok = (r, what = "") => { assert.equal(r.status, 200, `${what} ${JSON.stringify(r.body).slice(0, 700)}`); return r.body.result; };
  const refused = (r, status, code, what = "") => { assert.deepEqual([r.status, r.body.code], [status, code], `${what} ${JSON.stringify(r.body).slice(0, 400)}`); return r.body; };
  const an = (who, operation, input = {}) => call(who, AN, operation, input);
  const ws = (who, input) => an(who, "readAnalysisWorkspace", input);
  const measureIn = (w, id) => w.measures.find((m) => m.id === id);
  const sys = { tenantId: TENANT, principalId: "analysis-fixture" };

  // ── personas (Security Roles exactly as governed; Analysis grants nothing) ──
  for (const ch of ["RETAIL", "NATIONAL_ACCOUNTS"]) {
    await q(`INSERT INTO eos_policy.tenant_sales_channels (tenant_id, sales_channel, status, source, established_by, updated_by) VALUES ($1,$2,'ACTIVE','f','f','f')`, [TENANT, ch]);
  }
  const gm = await person("uid-gm", ["generalManager"], { id: "e-gm", name: "Gale GM" });
  const ctrl = await person("uid-ctrl", ["controller"], { id: "e-ctrl", name: "Sage Controller" });
  const dispatcher = await person("uid-dispatch", ["dispatcher"], { id: "e-dispatch", name: "Emerson Dispatch" });
  const pm = await person("uid-pm", ["partsManager", "purchasingManager"], { id: "e-pm", name: "Kai PM" });
  const tech = await person("uid-tech", ["technician"], { id: "e-tech", name: "Finley Tech", technician: true });
  const analyst = await person("uid-analyst", ["reportViewer"], { id: "e-analyst", name: "Riley Analyst" });
  const retail = await person("uid-retail", [], { id: "e-retail", name: "Robin Retail" });
  const r = await admin("assignRole", { principalId: retail.principalId, roleId: (await repo.getRoleByKey(TENANT, "salesperson")).id,
    scopeType: "salesChannel", scopeValue: "RETAIL", reason: "retail seller" });
  assert.equal(r.ok, true, JSON.stringify(r).slice(0, 300));

  // ── facts (governed records, SAMPLE) ──
  const lastMonth = new Date(); lastMonth.setUTCDate(1); lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 1); lastMonth.setUTCHours(19, 0, 0, 0);
  const now = new Date(Date.now() - 60_000);
  await q(`INSERT INTO eos_crm.accounts (id, tenant_id, name, status, created_by, updated_by) VALUES ('acct-t',$1,'Taylor Customer','ACTIVE','f','f'), ('acct-v',$1,'Ventana Customer','ACTIVE','f','f'),
           ('acct-l',$1,'Sample Lessor','ACTIVE','f','f')`, [TENANT]);
  await q(`INSERT INTO eos_crm.account_relationship_types (tenant_id, account_id, relationship_type) VALUES ($1,'acct-t','CUSTOMER'), ($1,'acct-v','CUSTOMER'), ($1,'acct-l','FINANCING_PROVIDER')`, [TENANT]);
  await q(`INSERT INTO eos_crm.account_locations (id, tenant_id, account_id, name, created_by, updated_by) VALUES ('loc-t',$1,'acct-t','Main','f','f')`, [TENANT]);
  const cpT = (await fin.ensureExternalCounterparty(pool, sys, "acct-t")).id;
  const cpV = (await fin.ensureExternalCounterparty(pool, sys, "acct-v")).id;
  const cpL = (await fin.ensureExternalCounterparty(pool, sys, "acct-l")).id;
  const obl = (company, counterpartyId, kind, amount, dueOn, k) => fin.openObligation(pool, sys, { operatingCompanyId: company, counterpartyId, kind, currency: "USD",
    sourceDomain: "FIXTURE", sourceRecordId: `src-${k}`, originationAmountMinor: amount, basis: "FIXTURE", effectiveAt: new Date(), idempotencyKey: `obl-${k}`, dueOn });
  const overdue = (await obl("taylor", cpT, "RECEIVABLE", 40000, "2026-01-15", "t1")).obligationId;
  await obl("taylor", cpT, "RECEIVABLE", 10000, null, "t2");
  await obl("ventana", cpV, "RECEIVABLE", 7000, null, "v1");
  await obl("taylor", cpL, "FUNDING_RECEIVABLE", 30000, null, "f1");
  // Money received: one settlement this period, one in the prior comparable window (business dates in the company's zone).
  for (const [id, at, amount] of [["stl-now", now, 25000], ["stl-prior", lastMonth, 10000]]) {
    await q(`INSERT INTO eos_finance.settlements (id, tenant_id, operating_company_id, counterparty_id, kind, direction, amount_minor, currency, business_date, source_reference,
               idempotency_key, request_fingerprint, recorded_by) VALUES ($1,$2,'taylor',$3,'CUSTOMER_PAYMENT','RECEIPT',$4,'USD',
               eos_policy.operating_company_business_date($2,'taylor',$5::timestamptz),$1,$1,'fp','f')`, [id, TENANT, cpT, amount, at]);
  }
  // Sales: Retail and National Accounts orders booked this period; one National line has no price.
  await q(`INSERT INTO eos_commercial.opportunities (id, tenant_id, opportunity_number, account_id, owner_employee_id, sales_channel, operating_company_key, created_by, updated_by)
           VALUES ('opp-r',$1,'OPP-R','acct-t','e-retail','RETAIL','taylor','f','f'), ('opp-n',$1,'OPP-N','acct-t','e-retail','NATIONAL_ACCOUNTS','taylor','f','f')`, [TENANT]);
  await q(`INSERT INTO eos_commercial.sales_orders (id, tenant_id, sales_order_number, account_id, owner_employee_id, operating_company_key, sales_channel, currency, state, booked_at, created_by, updated_by)
           VALUES ('so-r',$1,'SO-R','acct-t','e-retail','taylor','RETAIL','USD','CONFIRMED',$2,'f','f'), ('so-n',$1,'SO-N','acct-t','e-retail','taylor','NATIONAL_ACCOUNTS','USD','CONFIRMED',$2,'f','f'),
                  ('so-r0',$1,'SO-R0','acct-t','e-retail','taylor','RETAIL','USD','CONFIRMED',$3,'f','f')`, [TENANT, now, lastMonth]);
  await q(`INSERT INTO eos_commercial.sales_order_lines (tenant_id, sales_order_id, line_number, kind, ref, business_unit, ordered_qty, unit_price_minor)
           VALUES ($1,'so-r',1,'SERVICE','svc',  'SERVICE',2,15000), ($1,'so-n',1,'SERVICE','svc','SERVICE',1,NULL), ($1,'so-r0',1,'SERVICE','svc','SERVICE',1,5000)`, [TENANT]);
  // Service: a Work Order opened and completed this period, one open.
  for (const [id, status, done] of [["WO-2026-900001", "COMPLETED", now], ["WO-2026-900002", "CREATED", null]]) {
    await q(`INSERT INTO eos_ops.work_orders (id, tenant_id, operating_company_key, work_order_number, status, work_order_type, priority, customer_id, location_id, provenance, created_at, updated_at, completed_at, created_by_principal_id)
             VALUES ($1,$2,'taylor',$1,$3::eos_ops.ops_work_order_status,'SERVICE_CALL',2,'acct-t','loc-t','NATIVE',$4,$4,$5,$6)`, [id, TENANT, status, now, done, gm.principalId]);
    await q(`INSERT INTO eos_ops.work_order_transitions (id, tenant_id, work_order_id, from_status, to_status, action, occurred_at, provenance, actor_principal_id)
             VALUES ($1,$2,$3,NULL,'CREATED','create',$4,'NATIVE',$5)`, [`wot-${id}`, TENANT, id, now, gm.principalId]);
  }
  // Purchasing: one priced and one unpriced purchase order this period (a PO is its reorder request's order).
  await q(`INSERT INTO eos_ops.warehouses (id, tenant_id, operating_company_key, name, site_label, status, provenance, created_by, updated_by)
           VALUES ('wh-t',$1,'taylor','Taylor Main','Main','ACTIVE','NATIVE','f','f'), ('wh-v',$1,'ventana','Ventana Depot','Depot','ACTIVE','NATIVE','f','f')`, [TENANT]);
  // Operational Scope exactly as the record reads require it: warehouse scope (inventory) and the Reorder queue (purchasing).
  for (const [id, emp, type, scopeId] of [["os-gm-t", "e-gm", "WAREHOUSE", "wh-t"], ["os-gm-v", "e-gm", "WAREHOUSE", "wh-v"], ["os-pm-q", "e-pm", "REORDER_QUEUE", "taylor"]]) {
    await q(`INSERT INTO eos_workforce.employee_operational_scopes (id, tenant_id, employee_id, scope_type, scope_id, effective_from, assigned_by) VALUES ($1,$2,$3,$4,$5,now(),'f')`,
      [id, TENANT, emp, type, scopeId]);
  }
  for (const p of ["P-1", "P-2"]) {
    await q(`INSERT INTO eos_ops.parts (id, tenant_id, created_by, internal_part_number, name, status, stocking_unit, control_type, stocking_class,
               expiry_tracked, consumable, returnable_core, whole_unit, version, updated_by) VALUES ($1,$2,'f',$1,$1,'ACTIVE','EACH','STANDARD','STOCKED',false,false,false,false,1,'f')`, [p, TENANT]);
  }
  for (const [id, part] of [["po-1", "P-1"], ["po-2", "P-2"]]) {
    await q(`INSERT INTO eos_ops.reorder_requests (id, tenant_id, operating_company_key, part_id, warehouse_id, status, requested_quantity, updated_by, provenance, reorder_request_number, requested_by)
             VALUES ($1,$2,'taylor',$3,'wh-t','ORDERED',3,$5,'NATIVE',$4,$5)`, [id, TENANT, part, `RR-2026-90000${id.slice(-1)}`, pm.principalId]);
  }
  await q(`INSERT INTO eos_ops.purchase_orders (id, tenant_id, operating_company_key, part_id, supplier_name, external_po_number, ordered_quantity, ordered_date, unit_price_minor, currency, created_by)
           VALUES ('po-1',$1,'taylor','P-1','Acme','EXT-1',3,eos_policy.operating_company_business_date($1,'taylor',$2::timestamptz),2000,'USD',$3),
                  ('po-2',$1,'taylor','P-2','Acme','EXT-2',1,eos_policy.operating_company_business_date($1,'taylor',$2::timestamptz),NULL,NULL,$3)`, [TENANT, now, pm.principalId]);
  // Inventory: stock in the ledger (Taylor and Ventana).
  await q(`INSERT INTO eos_ops.inventory_movements (id, tenant_id, operating_company_key, part_id, tracking_mode, location_type, location_id, movement_type, quantity_delta, source_kind, source_id, created_by)
           VALUES ('mv-1',$1,'taylor','P-1','NONE','WAREHOUSE','wh-t','RECEIVED',8,'FIXTURE','f','f'), ('mv-2',$1,'ventana','P-1','NONE','WAREHOUSE','wh-v','RECEIVED',3,'FIXTURE','f','f')`, [TENANT]);

  // Rental: one Taylor fleet unit, on rent since 10 days ago (the event log is the analytic fact).
  await q(`INSERT INTO eos_ops.serialized_custody (id, tenant_id, part_id, serial_number, status, location_type, location_id, operating_company_key, updated_by)
           VALUES ('cst-r1',$1,'P-1','RU-1','AVAILABLE','WAREHOUSE','wh-t','taylor','f')`, [TENANT]);
  await q(`INSERT INTO eos_rental.fleet_units (id, tenant_id, part_id, serial_number, owner_operating_company_key, availability, display_name, designated_by, designated_at)
           VALUES ('rfu-1',$1,'P-1','RU-1','taylor','AVAILABLE','Rental RU-1','f', now() - interval '40 days')`, [TENANT]);
  await q(`INSERT INTO eos_rental.fleet_unit_events (id, tenant_id, fleet_unit_id, event_type, from_availability, to_availability, owner_operating_company_key, actor_principal_id, occurred_at)
           VALUES ('rfe-1',$1,'rfu-1','DESIGNATED',NULL,'AVAILABLE','taylor','f', now() - interval '40 days'),
                  ('rfe-2',$1,'rfu-1','RESERVED','AVAILABLE','ON_RENT','taylor','f', now() - interval '10 days')`, [TENANT]);

  await t.test("RENTAL drill: fleet figures and time-weighted utilization trace to the fleet unit and its event log", async () => {
    const fleet = ok(await an(gm, "readMeasureAnalysis", { measureId: "rental.fleet.units", operatingCompanyId: "taylor" })).measure;
    assert.deepEqual([fleet.value.value, fleet.provenance.sources[0].drill.operation, fleet.provenance.sources[0].drill.input], [1, "readFleetUnit", { fleetUnitId: "rfu-1" }]);
    const util = ok(await an(gm, "readMeasureAnalysis", { measureId: "rental.utilization.timeWeighted", operatingCompanyId: "taylor", periodType: "T12M" })).measure;
    assert.ok(util.value.value > 0.2 && util.value.value < 0.3, `10 of ~40 unit-days on rent: ${util.value.value}`);
    assert.deepEqual(util.drivers.byDimension.map((d) => d.key).sort(), ["AVAILABLE", "ON_RENT"]);
    refused(await an(pm, "readMeasureAnalysis", { measureId: "rental.fleet.units", operatingCompanyId: "taylor" }), 403, "MEASURE_NOT_AUTHORIZED", "no rental read, no rental figure");
  });

  await t.test("CATALOG: every measure's read capability is REGISTERED; the catalog says what each persona may see", async () => {
    const keys = new Set((await q(`SELECT key FROM eos_policy.capabilities`)).rows.map((x) => x.key));
    for (const m of measures.MEASURES) for (const k of m.readCapabilities) assert.ok(keys.has(k), `${m.id}: ${k} is a registered capability`);
    const cat = ok(await an(ctrl, "readAnalysisCatalog"));
    assert.equal(cat.aiRequired, false);
    assert.equal(cat.areas.find((a) => a.key === "finance").available, true);
    const techCat = ok(await an(tech, "readAnalysisCatalog"));
    assert.equal(techCat.areas.find((a) => a.key === "finance").available, false, "a Technician holds no Finance read");
  });

  await t.test("PROV + COMPANY: figures trace to their records; Taylor and Ventana separate; CONSOLIDATED is a projection", async () => {
    const taylor = ok(await ws(ctrl, { area: "finance", operatingCompanyId: "taylor" }));
    const ventana = ok(await ws(ctrl, { area: "finance", operatingCompanyId: "ventana" }));
    const cons = ok(await ws(ctrl, { area: "finance", operatingCompanyId: "consolidated" }));
    const recv = (w) => measureIn(w, "finance.receivables.open");
    assert.deepEqual([recv(taylor).value.value, recv(ventana).value.value, recv(cons).value.value], ["50000", "7000", "57000"]);
    assert.equal(cons.scope.projection, "CONSOLIDATED_REPORTING_PROJECTION");
    assert.deepEqual(recv(cons).drivers.byCompany.map((d) => [d.key, d.money.USD]), [["taylor", "50000"], ["ventana", "7000"]]);
    assert.equal(recv(taylor).basis, "EOS_OPERATIONAL_ACTUAL");
    const full = ok(await an(ctrl, "readMeasureAnalysis", { measureId: "finance.receivables.overdue", operatingCompanyId: "taylor" })).measure;
    assert.equal(full.provenance.contributingRecords, 1);
    const src = full.provenance.sources[0];
    assert.deepEqual([src.recordId, src.drill.operation, src.drill.input.obligationId], [overdue, "readObligation", overdue]);
    const drilled = ok(await call(ctrl, src.drill.route, src.drill.operation, src.drill.input), "drill-through");
    assert.equal(drilled.id, overdue, "the drill reaches the originating record through its own governed read");
    assert.match(full.provenance.definition.formula, /due_on/);
  });

  await t.test("MISSING != ZERO: an unpriced line is MISSING_PRICE; targets and forecast ABSENT; margin STRUCTURALLY_UNKNOWN; accounting actual ABSENT", async () => {
    const w = ok(await ws(gm, { area: "salesNational", operatingCompanyId: "taylor" }));
    const booked = measureIn(w, "sales.orders.booked");
    assert.deepEqual([booked.quality.state, booked.aggregate.missingAmount, booked.value.value], ["MISSING_PRICE", 1, null], "the unpriced order is excluded and flagged, never a zero");
    assert.equal(measureIn(w, "plan.forecast").status, "ABSENT");
    const exec = ok(await ws(gm, { area: "executive", operatingCompanyId: "taylor" }));
    assert.equal(measureIn(exec, "plan.targetBudget").status, "ABSENT");
    assert.equal(measureIn(exec, "finance.margin.gross").status, "STRUCTURALLY_UNKNOWN");
    assert.match(measureIn(exec, "finance.margin.gross").reason, /FIN-BLOCK-003/);
    assert.equal(measureIn(exec, "purchasing.orders.placed").status, "REFUSED", "the GM holds no REORDER_QUEUE scope -- the purchase-order figure is refused, not shown");
    const po = measureIn(ok(await ws(pm, { area: "purchasing", operatingCompanyId: "taylor" })), "purchasing.orders.placed");
    assert.deepEqual([po.quality.state, po.aggregate.money.USD, po.aggregate.missingAmount], ["MISSING_PRICE", "6000", 1]);
    assert.equal(measureIn(ok(await ws(ctrl, { area: "finance" })), "accounting.actual").status, "ABSENT");
  });

  await t.test("COMPARE: a period measure compares with the prior comparable window; variance and insights are deterministic", async () => {
    const w = ok(await ws(ctrl, { area: "finance", operatingCompanyId: "taylor", periodType: "MTD" }));
    const recd = measureIn(w, "finance.settlements.received");
    assert.equal(recd.value.value, "25000");
    assert.deepEqual([recd.comparison.value.value, recd.comparison.variance.byCurrency.USD.delta, recd.comparison.variance.byCurrency.USD.percent], ["10000", "15000", 150]);
    assert.ok(w.insights.some((i) => i.kind === "INCREASED_VS_PRIOR" && i.measureId === "finance.settlements.received"));
    assert.equal(measureIn(w, "finance.receivables.open").comparison.notComparableReason !== undefined, true, "a point-in-time measure says it has no history snapshot");
    assert.equal(w.aiRequired, false);
  });

  await t.test("DRILL per domain: sales / service / purchasing / inventory figures reach their own governed reads", async () => {
    const sales = ok(await an(gm, "readMeasureAnalysis", { measureId: "sales.orders.booked", operatingCompanyId: "taylor", channel: "RETAIL" })).measure;
    assert.deepEqual(sales.provenance.sources.map((s) => [s.recordId, s.drill.operation]), [["so-r", "getSalesOrderDetail"]]);
    assert.equal(sales.value.value, "30000");
    const service = ok(await an(dispatcher, "readMeasureAnalysis", { measureId: "service.workOrders.completed", operatingCompanyId: "taylor" })).measure;
    assert.deepEqual(service.provenance.sources.map((s) => [s.recordId, s.drill.operation]), [["WO-2026-900001", "readWorkOrder"]]);
    const wo = ok(await call(dispatcher, service.provenance.sources[0].drill.route, "readWorkOrder", service.provenance.sources[0].drill.input), "WO drill");
    assert.ok(wo);
    const purchasing = ok(await an(pm, "readMeasureAnalysis", { measureId: "purchasing.orders.placed", operatingCompanyId: "taylor" })).measure;
    assert.deepEqual(purchasing.provenance.sources.map((s) => s.drill.operation).sort(), ["readReorderRequest", "readReorderRequest"]);
    const inv = ok(await an(gm, "readMeasureAnalysis", { measureId: "inventory.onHand.quantity", operatingCompanyId: "consolidated" })).measure;
    assert.deepEqual([inv.value.value, inv.drivers.byCompany.map((d) => [d.key, d.quantity])], [11, [["taylor", 8], ["ventana", 3]]]);
    assert.deepEqual(inv.provenance.sources[0].drill.input, { partIds: ["P-1"] });
  });

  await t.test("PERSONA: each persona sees only what its existing reads allow; the Retail seller sees RETAIL only", async () => {
    const rw = ok(await ws(retail, { area: "salesRetail", operatingCompanyId: "taylor" }));
    const booked = measureIn(rw, "sales.orders.booked");
    assert.deepEqual([booked.status, booked.channels, booked.value.value], ["COMPUTED", ["RETAIL"], "30000"]);
    refused(await ws(retail, { area: "salesNational", operatingCompanyId: "taylor" }), 403, "ANALYSIS_AREA_NOT_AUTHORIZED", "a Retail seller is refused National Accounts");
    refused(await an(retail, "readMeasureAnalysis", { measureId: "sales.orders.booked", operatingCompanyId: "taylor", channel: "NATIONAL_ACCOUNTS" }), 403, "MEASURE_NOT_AUTHORIZED");
    refused(await ws(retail, { area: "finance" }), 403, "ANALYSIS_AREA_NOT_AUTHORIZED", "Sales holds no Finance analysis by being Sales");
    refused(await ws(tech, { area: "finance" }), 403, "ANALYSIS_AREA_NOT_AUTHORIZED", "a Technician reaches no Finance analysis");
    // REACH: the Technician holds reorder.request.read (its own requests) but no REORDER_QUEUE scope -- so the company-wide
    // purchasing figures are REFUSED exactly as the Reorder queue itself refuses them; an aggregate never exceeds the reads.
    const techPurchasing = ok(await ws(tech, { area: "purchasing", operatingCompanyId: "taylor" }));
    for (const id of ["purchasing.orders.placed", "purchasing.reorders.open"]) {
      assert.deepEqual([measureIn(techPurchasing, id).status, /REORDER_QUEUE/.test(measureIn(techPurchasing, id).reason)], ["REFUSED", true], id);
    }
    const noScope = measureIn(ok(await ws(ctrl, { area: "executive", operatingCompanyId: "taylor" })), "inventory.cycleCount.variances");
    assert.equal(noScope.status, "REFUSED", "no cycle-count read / warehouse scope, no count-difference figure");
    refused(await ws(analyst, { area: "finance" }), 403, "ANALYSIS_AREA_NOT_AUTHORIZED", "the report catalog read confers no business data");
    const cat = ok(await an(analyst, "readAnalysisCatalog"), "the Reporting Analyst reads the measure catalog");
    assert.ok(cat.areas.every((a) => a.available === false));
    const ctrlService = measureIn(ok(await ws(ctrl, { area: "executive", operatingCompanyId: "taylor" })), "service.workOrders.completed");
    assert.equal(ctrlService.status, "REFUSED", "on a mixed workspace a measure outside the persona's reads is REFUSED, never shown");
  });

  await t.test("ACTIONS: an exception links its record and offers the governed action only to a holder; analysis grants nothing", async () => {
    const c = ok(await ws(ctrl, { area: "finance", operatingCompanyId: "taylor" }));
    const od = c.exceptions.find((e) => e.kind === "OVERDUE_RECEIVABLE");
    assert.deepEqual([od.recordId, od.drill.operation, od.action.operation, od.action.capability, od.action.available], [overdue, "readObligation", "recordSettlement", "finance.settlement.record", true]);
    const p = ok(await ws(pm, { area: "purchasing", operatingCompanyId: "taylor" }));
    assert.equal(p.exceptions.find((e) => e.kind === "OVERDUE_RECEIVABLE"), undefined, "the purchasing area raises no finance exception");
    const pmFinance = ok(await ws(pm, { area: "finance", operatingCompanyId: "taylor" }));
    const pmOd = pmFinance.exceptions.find((e) => e.kind === "OVERDUE_RECEIVABLE");
    assert.equal(pmOd.action.available, false, "partsManager reads payments but holds no settlement authority -- the action is not offered");
    refused(await call(pm, "/operations/finance", "recordSettlement", { operatingCompanyId: "taylor", counterparty: { kind: "EXTERNAL_ORGANIZATION", crmAccountId: "acct-t" },
      kind: "CUSTOMER_PAYMENT", amountMinor: 1, currency: "USD", sourceReference: "x", idempotencyKey: "an-x" }), 403, "CAPABILITY_REQUIRED", "and the governed route still refuses it");
    const before = await one(`SELECT count(*)::int n FROM eos_policy.role_capabilities WHERE tenant_id = $1`, [TENANT]);
    ok(await ws(gm, { area: "executive" }));
    assert.equal((await one(`SELECT count(*)::int n FROM eos_policy.role_capabilities WHERE tenant_id = $1`, [TENANT])).n, before.n, "analysis writes no grant");
  });

  await t.test("INPUT: unknown area / company / period / measure / fields are refused", async () => {
    refused(await ws(gm, { area: "nope" }), 400, "AREA_UNKNOWN");
    refused(await ws(gm, { area: "finance", operatingCompanyId: "acme" }), 400, "OPERATING_COMPANY_UNKNOWN");
    refused(await ws(gm, { area: "finance", periodType: "WEEK" }), 400, "PERIOD_TYPE_INVALID");
    refused(await an(gm, "readMeasureAnalysis", { measureId: "nope" }), 404, "MEASURE_UNKNOWN");
    refused(await ws(gm, { area: "finance", sql: "x" }), 400, "FIELD_NOT_ACCEPTED");
  });
});
