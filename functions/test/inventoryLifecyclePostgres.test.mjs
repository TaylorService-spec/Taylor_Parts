// EOS INSIGHT -- INVENTORY LIFECYCLE (docs/design/eos-insight-inventory-lifecycle.md). Proofs over real PostgreSQL through
// /operations/analysis readInventoryLifecycle:
//   FIGURES  on hand, flow by lifecycle stage, month-end trend, turns, days of supply, stock age, slow movers, scrap rate
//            computed from a known synthetic ledger; relocations are not activity; the trend closes on the on-hand figure.
//   COMPANY  Taylor alone excludes Ventana stock; consolidated is both.
//   REACH    the read is refused without inventory.transaction.read, or without a WAREHOUSE Operational Scope.
//   LEAD     order-to-receipt days, admitted only with the receipt read and the order's own read.
//   INPUT    closed: an unknown field is refused.
import test from "node:test";
import assert from "node:assert/strict";
import { serviceBaselineTenant, DAY } from "./support/serviceBaselineTenant.mjs";
import { assignFinanceCompanies } from "./support/financeCompanyAccess.mjs";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const TENANT = "t-lifecycle";
const AN = "/operations/analysis";

test("inventory lifecycle over PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  const { q, admin, person, call } = await serviceBaselineTenant(t, { urlBase: URL_BASE, tenant: TENANT, prefix: "ilc" });
  const ok = (r, what = "") => { assert.equal(r.status, 200, `${what} ${JSON.stringify(r.body).slice(0, 700)}`); return r.body.result; };
  const refused = (r, status, code, what = "") => { assert.deepEqual([r.status, r.body.code], [status, code], `${what} ${JSON.stringify(r.body).slice(0, 400)}`); };
  const life = (who, input = {}) => call(who, AN, "readInventoryLifecycle", input);

  const pm = await person("uid-pm", ["partsManager", "purchasingManager"], { id: "e-pm", name: "Kai PM" });
  const gm = await person("uid-gm", ["generalManager"], { id: "e-gm", name: "Gale GM" });
  const unscoped = await person("uid-unscoped", ["partsManager"], { id: "e-unscoped", name: "No Scope" });
  const clerk = await person("uid-wa", ["warehouseAssociate"], { id: "e-wa", name: "Wren Warehouse" });
  const tech = await person("uid-tech", ["technician"], { id: "e-tech", name: "Finley Tech", technician: true });

  await q(`INSERT INTO eos_ops.warehouses (id, tenant_id, operating_company_key, name, site_label, status, provenance, created_by, updated_by)
           VALUES ('wh-t',$1,'taylor','Taylor Main','Main','ACTIVE','NATIVE','f','f'), ('wh-v',$1,'ventana','Ventana Depot','Depot','ACTIVE','NATIVE','f','f')`, [TENANT]);
  const BIN = `bin_${"a".repeat(40)}`;
  await q(`INSERT INTO eos_ops.bins (id, tenant_id, warehouse_id, area, aisle, bay, "position", code, status, idempotency_key, created_by, updated_by)
           VALUES ($2,$1,'wh-t','MAIN','A',1,1,'MAIN-A-1-1','ACTIVE','idem-bin-1','f','f')`, [TENANT, BIN]);
  for (const [id, emp, type, scopeId] of [["os-pm-w", "e-pm", "WAREHOUSE", "wh-t"], ["os-pm-q", "e-pm", "REORDER_QUEUE", "taylor"],
    ["os-gm-t", "e-gm", "WAREHOUSE", "wh-t"], ["os-wa-w", "e-wa", "WAREHOUSE", "wh-t"], ["os-wa-q", "e-wa", "REORDER_QUEUE", "taylor"], ["os-gm-v", "e-gm", "WAREHOUSE", "wh-v"]]) {
    await q(`INSERT INTO eos_workforce.employee_operational_scopes (id, tenant_id, employee_id, scope_type, scope_id, effective_from, assigned_by) VALUES ($1,$2,$3,$4,$5,now(),'f')`,
      [id, TENANT, emp, type, scopeId]);
  }
  // The GM reaches Ventana only through an operating-company assignment (company authority, #235).
  await assignFinanceCompanies({ admin, q, tenant: TENANT }, [gm]);
  for (const p of ["P-FAST", "P-SLOW", "P-DEAD"]) {
    await q(`INSERT INTO eos_ops.parts (id, tenant_id, created_by, internal_part_number, name, status, stocking_unit, control_type, stocking_class,
               expiry_tracked, consumable, returnable_core, whole_unit, version, updated_by) VALUES ($1,$2,'f',$1,$3,'ACTIVE','EACH','STANDARD','STOCKED',false,false,false,false,1,'f')`,
      [p, TENANT, `${p} name`]);
  }

  // ── a known ledger (Taylor wh-t unless stated), days before now ──
  const now = Date.now();
  let n = 0;
  const mv = (company, part, lt, li, type, qty, daysAgo) => q(`INSERT INTO eos_ops.inventory_movements (id, tenant_id, operating_company_key, part_id, tracking_mode, location_type, location_id,
      movement_type, quantity_delta, source_kind, source_id, occurred_at, created_by) VALUES ($1,$2,$3,$4,'NONE',$5,$6,$7,$8,'FIXTURE','f',$9,'f')`,
    [`mv-${++n}`, TENANT, company, part, lt, li, type, qty, new Date(now - daysAgo * DAY)]);
  await mv("taylor", "P-FAST", "WAREHOUSE", "wh-t", "RECEIVED", 120, 300);
  for (let k = 0; k < 10; k++) await mv("taylor", "P-FAST", "WAREHOUSE", "wh-t", "WORK_ORDER_CONSUMPTION", -10, 30 * k + 5);
  await mv("taylor", "P-FAST", "WAREHOUSE", "wh-t", "RETURNED", 3, 20);
  await mv("taylor", "P-FAST", "WAREHOUSE", "wh-t", "ADJUSTED", -1, 15);
  await mv("taylor", "P-SLOW", "WAREHOUSE", "wh-t", "RECEIVED", 50, 200);
  await mv("taylor", "P-SLOW", "WAREHOUSE", "wh-t", "SCRAPPED", -2, 190);
  await mv("taylor", "P-SLOW", "WAREHOUSE", "wh-t", "RELOCATION_OUT", -48, 10);   // handling, not activity
  await mv("taylor", "P-SLOW", "BIN", BIN, "RELOCATION_IN", 48, 10);
  await mv("taylor", "P-DEAD", "WAREHOUSE", "wh-t", "RECEIVED", 30, 500);         // before the window: opening balance
  await mv("ventana", "P-FAST", "WAREHOUSE", "wh-v", "RECEIVED", 7, 40);

  // ── one reorder purchase order, received 14 days after it was ordered (dates in the reporting zone) ──
  await q(`INSERT INTO eos_ops.reorder_requests (id, tenant_id, operating_company_key, part_id, warehouse_id, status, requested_quantity, updated_by, provenance, reorder_request_number, requested_by)
           VALUES ('po-1',$1,'taylor','P-FAST','wh-t','ORDERED',10,$2,'NATIVE','RR-2026-900001',$2)`, [TENANT, pm.principalId]);
  await q(`INSERT INTO eos_ops.purchase_orders (id, tenant_id, operating_company_key, part_id, supplier_name, external_po_number, ordered_quantity, ordered_date, unit_price_minor, currency, created_by)
           VALUES ('po-1',$1,'taylor','P-FAST','Acme','EXT-1',10,(($2::timestamptz) AT TIME ZONE 'America/Phoenix')::date,1000,'USD',$3)`,
    [TENANT, new Date(now - 20 * DAY), pm.principalId]);
  await q(`INSERT INTO eos_ops.receiving_orders (id, tenant_id, operating_company_key, source_kind, source_purchase_order_id, source_reorder_request_id, receiving_location_type,
             receiving_location_id, status, idempotency_key, created_by, updated_by, received_at)
           VALUES ('ro-1',$1,'taylor','REORDER_PURCHASE_ORDER','po-1','po-1','WAREHOUSE','wh-t','PUTAWAY_COMPLETE','idem-ro-1','f','f',$2)`, [TENANT, new Date(now - 6 * DAY)]);

  await t.test("FIGURES: a known ledger produces the expected lifecycle figures", async () => {
    const r = ok(await life(pm, { operatingCompanyId: "taylor" }), "taylor");
    assert.equal(r.months.length, 12);
    assert.equal(r.kpis.onHand, 100, "22 fast + 48 slow + 30 dead");
    assert.equal(r.onHandTrend.at(-1), 100, "the month-end trend closes on the on-hand figure");
    assert.equal(r.kpis.issued12, 100);
    assert.equal(r.kpis.received12, 170);
    assert.equal(r.kpis.daysOfSupply, 300, "100 on hand / (30 issued in 90 days / 90)");
    assert.equal(r.kpis.dormantShare, 0.78, "48 slow + 30 dead of 100");
    assert.equal(r.kpis.scrapRate, Math.round((2 / 102) * 10000) / 10000);
    assert.ok(r.kpis.turns > 0);
    const stage = (k) => r.flow.series.find((s) => s.stage === k).values.reduce((a, b) => a + b, 0);
    assert.deepEqual([stage("RECEIVED"), stage("RETURNED"), stage("ISSUED"), stage("SCRAPPED"), stage("TRANSFER_ADJUST")], [170, 3, -100, -2, -1]);
    const reloc = r.flow.byMovementType.filter((x) => x.movementType.startsWith("RELOCATION")).reduce((a, x) => a + x.units, 0);
    assert.equal(reloc, 0, "relocations move stock between locations and net to zero");
    const age = Object.fromEntries(r.age.buckets.map((b) => [b.key, b.units]));
    assert.deepEqual(age, { "0-30": 22, "31-90": 0, "91-180": 0, "181-365": 48, "365+": 30 }, "the relocated stock keeps its age");
    assert.deepEqual(r.slowMovers.rows.map((x) => [x.partId, x.onHand]), [["P-SLOW", 48], ["P-DEAD", 30]]);
    assert.equal(r.slowMovers.namesWithheld, false);
    assert.equal(r.slowMovers.rows[0].name, "P-SLOW name");
  });

  await t.test("LEAD: order-to-receipt days, with the receipt read and the order's own read", async () => {
    const pmView = ok(await life(pm, { operatingCompanyId: "taylor" }));
    assert.deepEqual(pmView.leadTime, { status: "REFUSED", reason: "requires receivingOrder.record.read" }, "no receipt read, no lead time -- analysis grants nothing");
    const r = ok(await life(clerk, { operatingCompanyId: "taylor" }));
    assert.equal(r.leadTime.status, "COMPUTED", JSON.stringify(r.leadTime));
    const withReceipts = r.leadTime.months.filter((m) => m.receipts > 0);
    assert.deepEqual(withReceipts.map((m) => [m.receipts, m.medianDays]), [[1, 14]]);
  });

  await t.test("COMPANY: Taylor alone excludes Ventana; consolidated is both", async () => {
    assert.equal(ok(await life(gm, { operatingCompanyId: "taylor" })).kpis.onHand, 100);
    assert.equal(ok(await life(gm, { operatingCompanyId: "ventana" })).kpis.onHand, 7);
    assert.equal(ok(await life(gm, {})).kpis.onHand, 107);
  });

  await t.test("REACH: no warehouse scope, or no inventory read, is a refusal -- never an empty dashboard", async () => {
    refused(await life(unscoped, { operatingCompanyId: "taylor" }), 403, "WAREHOUSE_SCOPE_REQUIRED", "partsManager without a WAREHOUSE scope");
    refused(await life(tech, { operatingCompanyId: "taylor" }), 403, "INVENTORY_LIFECYCLE_NOT_AUTHORIZED", "a technician holds no inventory.transaction.read");
  });

  await t.test("INPUT: closed -- an unknown field is refused", async () => {
    refused(await life(pm, { operatingCompanyId: "taylor", sql: "select 1" }), 400, "FIELD_NOT_ACCEPTED");
  });
});
