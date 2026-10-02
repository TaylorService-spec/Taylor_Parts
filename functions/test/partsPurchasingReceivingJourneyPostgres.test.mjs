// PARTS / PURCHASING / RECEIVING -- the completion journey (Controller PARTS / PURCHASING / RECEIVING RULINGS, 2026-10-01).
//
// On a BASELINE-EQUAL tenant (support/serviceBaselineTenant.mjs), with the Reorder authority exactly as nonprod holds it
// (measured 2026-10-01) PLUS this package's prepared Administration delta (partsPurchasingReceivingDelta.ts: Parts
// Associate create, Supplier read, Warehouse master administration), all applied THROUGH ADMINISTRATION; real-shaped
// warehouse masters and bins established through the new governed Administration commands; the personas' Employee links,
// PARTS_OPERATIONS eligibility, REORDER_QUEUE and WAREHOUSE operational scopes. Over the REAL Operations transport
// (POST /operations/inventory) and the Administration API:
//
//   1. THE JOURNEY: Parts Associate raises the need -> duplicate protection -> Parts Manager approves -> assignment from
//      the EOS target read -> purchasing -> update -> Supplier from PostgreSQL -> PO -> receiving location from PostgreSQL
//      -> full receipt -> movement + custody + cost + RECEIVED -> employee-visible PostgreSQL on-hand and receipt ->
//      audit -> idempotent retry.
//   2. Every ruled negative: concurrency, idempotency, scope, destination, company, personas, unsupported receipts.
//
// Real PostgreSQL. Set POLICY_TEST_DATABASE_URL; without it the database half SKIPS.
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { serviceBaselineTenant } from "./support/serviceBaselineTenant.mjs";

const require = createRequire(import.meta.url);
const authority = require("../lib/eosOps/reorderAssignmentAuthority.js");
const delta = require("../lib/adminPolicy/partsPurchasingReceivingDelta.js");
const { executeAdminOperation } = require("../lib/adminPolicy/adminPolicyApi.js");
const { createWarehouseBinAdministration, isWarehouseAdminOperation } = require("../lib/eosOps/warehouseBinAdministration.js");
const { createMobileLocationScopeBindingAdministration } = require("../lib/eosOps/mobileLocationScopeBindingAdministration.js");

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const TENANT = "t-parts";
const INV = "/operations/inventory";

// The Reorder authority nonprod holds today (census pp0, 2026-10-01), per Role.
const LIVE_REORDER_GRANTS = {
  partsManager: ["reorder.purchaseOrder.void", "reorder.request.approve", "reorder.request.assign", "reorder.request.cancel",
    "reorder.request.create.manual", "reorder.request.read", "reorder.request.reject"],
  partsAssociate: ["reorder.request.markReceived", "reorder.request.postPurchasingUpdate", "reorder.request.read",
    "reorder.request.recordPurchaseOrder", "reorder.request.startPurchasing"],
};

test("static: the prepared Administration delta is exactly the ruled grants; no approval for the Parts Associate; no DQ-036b", () => {
  assert.deepEqual(delta.PARTS_PURCHASING_RECEIVING_GRANTS.map((g) => [g.roleKey, g.capabilityKey]), [
    ["partsAssociate", "reorder.request.create.manual"],
    ["partsManager", "supplier.record.read"],
    ["partsAssociate", "supplier.record.read"],
    ["purchasingManager", "supplier.record.read"],
    ["dispatcher", "supplier.record.read"],
    ["operationalConfigurationAdministrator", "warehouse.record.manage"],
  ]);
  for (const o of delta.partsPurchasingReceivingOperations()) {
    assert.equal(o.operation, "grantObjectActionToRole");
    assert.ok(o.input.objectKey && o.input.actionKey && o.input.reason.length > 20, JSON.stringify(o.input));
  }
  assert.equal(delta.PARTS_PURCHASING_RECEIVING_GRANTS.some((g) => g.roleKey === "partsAssociate" && /approve|reject|cancel|assign/.test(g.capabilityKey)), false);
  assert.equal(delta.PARTS_PURCHASING_RECEIVING_GRANTS.some((g) => g.capabilityKey === "inventory.serializedAsset.acquire"), false, "DQ-F: DQ-036b HELD");
  assert.equal(delta.PARTS_PURCHASING_RECEIVING_GRANTS.some((g) => g.capabilityKey === "warehouse.record.manage" && /parts|warehouse(Associate|Manager)/.test(g.roleKey)), false,
    "no operational Parts / Warehouse Role receives warehouse-master configuration authority");
});

test("Parts / Purchasing / Receiving over the Operations transport", { skip: SKIP, concurrency: 1 }, async (t) => {
  const { q, admin, person, repo, pool, call } = await serviceBaselineTenant(t, { urlBase: URL_BASE, tenant: TENANT, prefix: "ppr" });
  const one = async (sql, v = []) => (await q(sql, v)).rows[0];
  const inv = (who, operation, input) => call(who, INV, operation, input);
  const ok = (r, what = "") => { assert.equal(r.status, 200, `${what} ${JSON.stringify(r.body)}`); return r.body.result; };
  const refused = (r, status, code, what = "") => assert.deepEqual([r.status, r.body.code], [status, code], `${what} ${JSON.stringify(r.body)}`);
  const grant = async (roleKey, key, reason) => {
    const c = await one(`SELECT object_key, action_key FROM eos_policy.capabilities WHERE key = $1`, [key]);
    const r = await admin("grantObjectActionToRole", { roleKey, objectKey: c.object_key, actionKey: c.action_key, reason });
    assert.equal(r.ok, true, `${roleKey} ${key} ${JSON.stringify(r).slice(0, 200)}`);
  };
  const wh = createWarehouseBinAdministration(pool), mb = createMobileLocationScopeBindingAdministration(pool);
  const configuration = (op, a, i, r) => (isWarehouseAdminOperation(op) ? wh : mb)(op, a, i, r);
  const adminAs = (who, operation, input) => executeAdminOperation({ repo, configuration },
    { caller: { externalSubject: who.subject, identityProvider: "firebase" }, operation, input, requestId: `r-${randomUUID()}` });

  // ── the nonprod Reorder authority as measured, then this package's prepared delta -- all through Administration ──
  for (const [roleKey, keys] of Object.entries(LIVE_REORDER_GRANTS)) for (const key of keys) await grant(roleKey, key, "nonprod Reorder authority as measured 2026-10-01");
  if (!(await repo.getRoleByKey(TENANT, "operationalConfigurationAdministrator"))) {
    const r = await admin("createRole", { key: "operationalConfigurationAdministrator", name: "Operational Configuration Administrator", reason: "DQ-033 narrow configuration Role" });
    assert.equal(r.ok, true, JSON.stringify(r).slice(0, 200));
  }
  for (const { operation, input } of delta.partsPurchasingReceivingOperations()) {
    const r = await admin(operation, input);
    assert.equal(r.ok, true, `${operation} ${input.roleKey} ${JSON.stringify(r).slice(0, 300)}`);
  }

  // ── the people ──
  const pa = await person("uid-parts-associate", ["partsAssociate", "inventoryReceivingClerk"], { id: "e-pa", name: "Pat Parts" });
  const pm = await person("uid-parts-manager", ["partsManager", "purchasingManager"], { id: "e-pm", name: "Morgan Parts-Manager" });
  const wa = await person("uid-warehouse-associate", ["warehouseAssociate"], { id: "e-wa", name: "Wren Warehouse" });
  const wm = await person("uid-warehouse-manager", ["warehouseManager"], { id: "e-wm", name: "Wes Warehouse-Manager" });
  const tech = await person("uid-tech", ["technician"], { id: "e-tech", name: "Tess Technician", technician: true });
  const retail = await person("uid-retail", ["salesperson"], { id: "e-retail", name: "Harper Retail" });
  const national = await person("uid-national", ["salesperson"], { id: "e-national", name: "Jules National" });
  const nobody = await person("uid-general", [], { id: "e-general", name: "Gen Employee" });
  const config = await person("uid-config-admin", ["operationalConfigurationAdministrator"], { id: "e-config", name: "Cora Config" });
  const owner = await person("uid-owner", [], { id: "e-owner", name: "Owen Owner" });
  await repo.transact({ tenantId: TENANT, uid: "fixture" }, async (tx) => {
    const accessVersion = await tx.bumpAccessVersion(owner.principalId);
    return tx.createAssignment({ principalId: owner.principalId, roleId: (await repo.getRoleByKey(TENANT, "owner")).id, scopeType: "global", scopeValue: null,
      status: "active", grantedBy: "fixture", grantedAt: new Date().toISOString(), accessVersionAtGrant: accessVersion });
  });

  await t.test("WAREHOUSE ADMINISTRATION (DQ-E): the configuration administrator establishes warehouse masters and bins; operational roles cannot", async () => {
    const draft = { warehouseId: "wh-phx", name: "Phoenix Parts", siteLabel: "Phoenix", operatingCompanyId: "taylor", reason: "establish the governed warehouse master" };
    for (const who of [pm, pa, wa, wm, owner]) {
      const r = await adminAs(who, "createWarehouse", draft);
      assert.equal(r.ok, false, `${who.subject} holds no warehouse-master authority`);
    }
    assert.equal((await adminAs(config, "createWarehouse", { ...draft, warehouseId: "wh-main" })).ok, false, "a fixture identity is never a real master");
    assert.equal((await adminAs(config, "createWarehouse", { ...draft, warehouseId: "synthetic-np-wh-taylor-acceptance" })).ok, false, "nor the synthetic acceptance warehouse");
    assert.equal((await adminAs(config, "createWarehouse", { ...draft, operatingCompanyId: "acme" })).ok, false, "an ungoverned company is refused, never inferred");
    assert.equal((await adminAs(config, "createWarehouse", { ...draft, operatingCompanyKey: "taylor" })).ok, false, "a key is never accepted from the caller");
    const { reason: _r, ...noReason } = draft;
    assert.equal((await adminAs(config, "createWarehouse", noReason)).ok, false, "a reason is required");
    for (const [id, name, company] of [["wh-phx", "Phoenix Parts", "taylor"], ["wh-tuc", "Tucson Parts", "taylor"], ["wh-ventana-1", "Ventana Depot", "ventana"], ["wh-closed", "Closed Site", "taylor"]]) {
      const r = await adminAs(config, "createWarehouse", { warehouseId: id, name, siteLabel: name.split(" ")[0], operatingCompanyId: company, reason: "establish the governed warehouse master" });
      assert.equal(r.ok, true, JSON.stringify(r).slice(0, 300));
    }
    assert.equal((await adminAs(config, "createWarehouse", { ...draft })).ok, false, "a duplicate identity is refused");
    assert.equal((await adminAs(config, "setWarehouseStatus", { warehouseId: "wh-closed", status: "INACTIVE", reason: "site closed" })).ok, true);
    assert.equal((await adminAs(config, "updateWarehouse", { warehouseId: "wh-phx", siteLabel: "Phoenix (Main)", reason: "site label correction" })).ok, true);
    assert.equal((await adminAs(config, "updateWarehouse", { warehouseId: "wh-phx", operatingCompanyId: "ventana", reason: "x" })).ok, false, "a warehouse never changes company");
    assert.equal((await adminAs(config, "createBin", { warehouseId: "wh-phx", area: "MAIN", aisle: "1", bay: 1, position: 1, idempotencyKey: "bin-bad", reason: "x" })).ok, false,
      "a non-canonical racking value is refused");
    const bin = await adminAs(config, "createBin", { warehouseId: "wh-phx", area: "MAIN", aisle: "A", bay: 1, position: 1, name: "Fans", idempotencyKey: "bin-phx-a1", reason: "rack A1" });
    assert.equal(bin.ok, true, JSON.stringify(bin).slice(0, 300));
    assert.equal((await adminAs(config, "createBin", { warehouseId: "wh-closed", area: "MAIN", aisle: "A", bay: 1, position: 1, idempotencyKey: "bin-closed", reason: "x" })).ok, false, "no bins in an inactive warehouse");
    const relabel = await adminAs(config, "relabelBin", { binId: bin.data.binId, area: "MAIN", aisle: "A", bay: 1, position: 2, reason: "racking survey" });
    assert.equal(relabel.ok, true, JSON.stringify(relabel).slice(0, 300));
    assert.equal(relabel.data.binId, bin.data.binId, "a relabel never changes the bin's identity");
    const list = await adminAs(config, "listWarehouses", {});
    assert.deepEqual(list.data.items.map((w) => [w.warehouseId, w.operatingCompanyId, w.status]).sort(),
      [["wh-closed", "taylor", "INACTIVE"], ["wh-phx", "taylor", "ACTIVE"], ["wh-tuc", "taylor", "ACTIVE"], ["wh-ventana-1", "ventana", "ACTIVE"]]);
    const bins = await adminAs(config, "listWarehouseBins", { warehouseId: "wh-phx" });
    assert.equal(bins.data.items.length, 1);
    const audits = (await q(`SELECT action FROM eos_policy.audit_events WHERE tenant_id = $1 AND (action LIKE 'warehouse.%' OR action LIKE 'bin.%')`, [TENANT])).rows.map((r) => r.action);
    for (const a of ["warehouse.created", "warehouse.changed", "warehouse.statusChanged", "bin.created", "bin.relabelled"]) assert.ok(audits.includes(a), `${a} in ${audits.join(",")}`);
  });

  // ── operational scope (the governed Workforce writer exists; fixture rows here), eligibility, governed Parts, Supplier ──
  for (const e of ["e-pa", "e-pm"]) {
    await q(`INSERT INTO eos_workforce.employee_work_eligibility (id, tenant_id, employee_id, qualification_code, effective_from, assigned_by)
             VALUES ($1, $2, $3, $4, now(), 'fixture')`, [`ewe-${e}`, TENANT, e, authority.REORDER_ASSIGNMENT_QUALIFICATION]);
    await q(`INSERT INTO eos_workforce.employee_operational_scopes (id, tenant_id, employee_id, scope_type, scope_id, effective_from, assigned_by)
             VALUES ($1, $2, $3, 'REORDER_QUEUE', 'taylor', now(), 'fixture'), ($4, $2, $3, 'WAREHOUSE', 'wh-phx', now(), 'fixture')`, [`os-q-${e}`, TENANT, e, `os-w-${e}`]);
  }
  await q(`INSERT INTO eos_workforce.employee_operational_scopes (id, tenant_id, employee_id, scope_type, scope_id, effective_from, assigned_by)
           VALUES ('os-w-wa', $1, 'e-wa', 'WAREHOUSE', 'wh-phx', now(), 'fixture'), ('os-w-pa-closed', $1, 'e-pa', 'WAREHOUSE', 'wh-closed', now(), 'fixture')`, [TENANT]);
  const part = (id, controlType = "STANDARD", status = "ACTIVE") => q(`INSERT INTO eos_ops.parts (id, tenant_id, created_by, internal_part_number, name, status, stocking_unit,
      control_type, stocking_class, expiry_tracked, consumable, returnable_core, whole_unit, version, updated_by)
      VALUES ($1,$2,'fixture',$1,$1,$3,'EACH',$4,'STOCKED',false,false,false,false,1,'fixture')`, [id, TENANT, status, controlType]);
  for (const p of ["PRT-FAN", "PRT-VALVE", "PRT-COIL", "PRT-RELAY", "PRT-PROBE", "PRT-FILTER", "PRT-BELT", "PRT-DUP", "PRT-HINGE"]) await part(p);
  await part("PRT-COMP", "SERIALIZED");
  await part("PRT-COMP2", "SERIALIZED");
  await part("PRT-OBSOLETE", "STANDARD", "INACTIVE");
  await q(`INSERT INTO eos_ops.suppliers (tenant_id, supplier_id, name, normalized_key, status, version, vendor_number, contact_name, phone, created_by, updated_by)
           VALUES ($1,'SUP-DESERT','Desert Refrigeration Supply','desert refrigeration supply','ACTIVE',1,'V-1001','Dana Desert','602-555-0100','fixture','fixture')`, [TENANT]);

  let n = 0;
  const key = (s) => `k-${s}-${++n}`;
  const need = (over = {}) => ({ partId: "PRT-FAN", warehouseId: "wh-phx", requestedQuantity: 6, recommendationStatus: "BELOW_MIN", quantitySource: "MANUAL", idempotencyKey: key("rr"), ...over });
  const status = async (id) => (await one(`SELECT status::text s FROM eos_ops.reorder_requests WHERE tenant_id = $1 AND id = $2`, [TENANT, id])).s;
  const receipt = (id, partId, qty, over = {}) => ({ source: { type: "REORDER_PURCHASE_ORDER", reorderRequestId: id, purchaseOrderId: id },
    receivingLocation: { type: "WAREHOUSE", locationId: "wh-phx" }, lines: [{ lineId: "L1", partId, receivedQuantity: qty }], idempotencyKey: `rcv-${id}`, ...over });
  const onHand = async (who, partIds) => ok(await inv(who, "readInventoryOnHand", { partIds }), "on-hand");
  const toOrdered = async (partId, qty = 4) => {
    const rr = ok(await inv(pa, "createReorderRequest", need({ partId, requestedQuantity: qty })), `create ${partId}`).reorderRequestId;
    ok(await inv(pm, "reviewReorderRequest", { reorderRequestId: rr, decision: "APPROVED" }), "approve");
    ok(await inv(pm, "assignReorderRequest", { reorderRequestId: rr, employeeId: "e-pa" }), "assign");
    ok(await inv(pa, "startPurchasingOnReorder", { reorderRequestId: rr }), "start");
    ok(await inv(pa, "recordReorderPurchaseOrder", { reorderRequestId: rr, supplier: { kind: "EXTERNAL_ORGANIZATION", supplierId: "SUP-DESERT" }, externalPoNumber: `PO-${partId}`,
      orderedQuantity: qty, orderedDate: "2026-10-01", expectedArrivalDate: "2026-10-08" }), "PO");
    return rr;
  };

  await t.test("JOURNEY: the Parts Associate raises the need and receives it; the employee sees the PostgreSQL on-hand and the receipt", async () => {
    const before = await onHand(pa, ["PRT-FAN"]);
    assert.deepEqual([before.scopedWarehouseIds, before.totals], [["wh-closed", "wh-phx"], []], "nothing on hand yet");
    const created = ok(await inv(pa, "createReorderRequest", need()), "the Parts Associate raises the request (DQ-A)");
    const rr = created.reorderRequestId;
    assert.match(created.reorderRequestNumber, /^RR-\d{4}-\d{6}$/, "a governed RR number (G5)");
    assert.deepEqual([created.status, created.replayed], ["PENDING_REVIEW", false]);
    const dup = await inv(pa, "createReorderRequest", need());
    refused(dup, 409, "CONFLICT", "a second open request for the same Part + warehouse (DQ-B)");
    assert.deepEqual([dup.body.details?.existingReorderRequestId, dup.body.details?.existingReorderRequestNumber], [rr, created.reorderRequestNumber], "names the request to continue");
    refused(await inv(pa, "reviewReorderRequest", { reorderRequestId: rr, decision: "APPROVED" }), 403, "FORBIDDEN", "the Parts Associate cannot approve");
    ok(await inv(pm, "reviewReorderRequest", { reorderRequestId: rr, decision: "APPROVED", reviewNotes: "below minimum" }), "the Parts Manager approves");
    const targets = ok(await inv(pm, "listReorderAssignmentTargets", {}), "EOS assignment targets");
    assert.deepEqual(targets.items.map((x) => x.employeeId).sort(), ["e-pa", "e-pm"], "exactly the PARTS_OPERATIONS Employees the command accepts");
    assert.ok(!JSON.stringify(targets).match(/uid-|externalSubject/), "no login identity is disclosed");
    ok(await inv(pm, "assignReorderRequest", { reorderRequestId: rr, employeeId: "e-pa" }), "assign");
    ok(await inv(pa, "startPurchasingOnReorder", { reorderRequestId: rr, purchasingNotes: "calling suppliers" }), "start");
    ok(await inv(pa, "postPurchasingUpdate", { reorderRequestId: rr, purchasingNotes: "Desert has 6", vendorContacted: true, expectedAvailabilityDate: "2026-10-08" }), "update");
    const suppliers = ok(await inv(pa, "listSuppliers", {}), "Supplier master from PostgreSQL");
    assert.deepEqual(suppliers.items.map((s) => [s.supplierId, s.name, s.status, s.vendorNumber, s.contactName]),
      [["SUP-DESERT", "Desert Refrigeration Supply", "ACTIVE", "V-1001", "Dana Desert"]]);
    // DECISIONS #193 (2026-10-02): the Parts Associate PICKS the supplier BY NAME from the governed selection; the identity
    // behind the name is what the PO stores -- never text the employee typed.
    const choices = ok(await inv(pa, "listPurchaseOrderSupplierOptions", { reorderRequestId: rr }), "governed supplier selection");
    const desert = choices.items.find((o) => o.name === "Desert Refrigeration Supply");
    assert.deepEqual([desert.kind, desert.supplierId], ["EXTERNAL_ORGANIZATION", "SUP-DESERT"]);
    ok(await inv(pa, "recordReorderPurchaseOrder", { reorderRequestId: rr, supplier: { kind: desert.kind, supplierId: desert.supplierId }, externalPoNumber: "PO-77001",
      orderedQuantity: 6, orderedDate: "2026-10-01", expectedArrivalDate: "2026-10-08", unitPriceMinor: 4100, currency: "USD" }), "record PO");
    const options = ok(await inv(pa, "listReceivingLocationOptions", { reorderRequestId: rr }), "receiving destinations from PostgreSQL");
    assert.equal(options.receivable, true);
    assert.deepEqual(options.options.map((o) => [o.type, o.warehouseId]), [["WAREHOUSE", "wh-phx"], ["BIN", "wh-phx"]], "only the Reorder's own warehouse and its bins");
    assert.equal(ok(await inv(pa, "receiveReorderStock", receipt(rr, "PRT-FAN", 6)), "full physical receipt").outcome, "applied");
    assert.equal(await status(rr), "RECEIVED");
    const after = await onHand(pa, ["PRT-FAN"]);
    assert.deepEqual(after.totals, [{ partId: "PRT-FAN", onHand: 6 }], "the receipt is immediately visible as PostgreSQL on-hand");
    assert.deepEqual(after.rows.map((r) => [r.locationType, r.locationId, r.warehouseId, r.onHand]), [["WAREHOUSE", "wh-phx", "wh-phx", 6]]);
    const receipts = ok(await inv(pa, "listReceipts", { reorderRequestId: rr }), "receipt list");
    assert.equal(receipts.items.length, 1);
    const detail = ok(await inv(pa, "readReceipt", { receiptId: receipts.items[0].receiptId }), "receipt detail");
    assert.deepEqual([detail.sourceKind, detail.warehouseId, detail.lines[0].partId, detail.lines[0].receivedQuantity], ["REORDER_PURCHASE_ORDER", "wh-phx", "PRT-FAN", 6]);
    assert.match(detail.receivingOrderNumber, /^RO-/);
    const cost = await one(`SELECT count(*)::int n, max(operating_company_id) co FROM eos_finance.inventory_acquisition_costs WHERE tenant_id = $1`, [TENANT]);
    assert.deepEqual(cost, { n: 1, co: "taylor" }, "acquisition cost evidence (R3)");
    const audits = (await q(`SELECT action FROM eos_policy.audit_events WHERE tenant_id = $1 AND target_id = $2`, [TENANT, rr])).rows.map((r) => r.action);
    for (const a of ["create", "review", "assign", "recordPurchaseOrder"]) assert.ok(audits.some((x) => x.includes(a)), `audited ${a}: ${audits.join(",")}`);
    assert.equal(ok(await inv(pa, "receiveReorderStock", receipt(rr, "PRT-FAN", 6)), "receipt replay").outcome, "replayed");
    assert.deepEqual((await onHand(pa, ["PRT-FAN"])).totals, [{ partId: "PRT-FAN", onHand: 6 }], "no double count on retry");
  });

  await t.test("CREATE INTEGRITY: idempotency, concurrent duplicates, terminal requests free future demand, scope, warehouse, part, company", async () => {
    const k1 = key("idem");
    const a = ok(await inv(pa, "createReorderRequest", need({ partId: "PRT-VALVE", idempotencyKey: k1 })), "create");
    const b = ok(await inv(pa, "createReorderRequest", need({ partId: "PRT-VALVE", idempotencyKey: k1 })), "same key + same request");
    assert.deepEqual([b.reorderRequestId, b.reorderRequestNumber, b.replayed], [a.reorderRequestId, a.reorderRequestNumber, true]);
    refused(await inv(pa, "createReorderRequest", need({ partId: "PRT-VALVE", idempotencyKey: k1, requestedQuantity: 9 })), 409, "CONFLICT", "same key + different payload");
    const { idempotencyKey: _k, ...noKey } = need({ partId: "PRT-COIL" });
    refused(await inv(pa, "createReorderRequest", noKey), 400, "INVALID_INPUT", "a create states its idempotency key");
    const both = await Promise.all([inv(pa, "createReorderRequest", need({ partId: "PRT-DUP" })), inv(pm, "createReorderRequest", need({ partId: "PRT-DUP" }))]);
    assert.deepEqual(both.map((r) => r.status).sort(), [200, 409], JSON.stringify(both.map((r) => r.body.code)));
    assert.equal((await one(`SELECT count(*)::int n FROM eos_ops.reorder_requests WHERE tenant_id = $1 AND part_id = 'PRT-DUP'`, [TENANT])).n, 1, "concurrent creates: one open request");
    const won = both.find((r) => r.status === 200).body.result.reorderRequestId;
    ok(await inv(pm, "reviewReorderRequest", { reorderRequestId: won, decision: "REJECTED", reviewNotes: "stock arrived another way" }), "reject");
    ok(await inv(pa, "createReorderRequest", need({ partId: "PRT-DUP" })), "new demand after a terminal request");
    refused(await inv(pa, "createReorderRequest", need({ partId: "PRT-HINGE", warehouseId: "wh-tuc" })), 403, "FORBIDDEN", "a warehouse outside scope (G4)");
    refused(await inv(pa, "createReorderRequest", need({ partId: "PRT-HINGE", warehouseId: "wh-closed" })), 412, "PRECONDITION_FAILED", "an inactive warehouse");
    refused(await inv(pa, "createReorderRequest", need({ partId: "PRT-HINGE", warehouseId: "wh-nowhere" })), 404, "NOT_FOUND", "an unknown warehouse");
    refused(await inv(pa, "createReorderRequest", need({ partId: "PRT-NOWHERE" })), 404, "NOT_FOUND", "an unknown part");
    refused(await inv(pa, "createReorderRequest", need({ partId: "PRT-OBSOLETE" })), 412, "PRECONDITION_FAILED", "an inactive part");
    refused(await inv(pa, "createReorderRequest", { ...need({ partId: "PRT-HINGE" }), operatingCompanyId: "ventana" }), 400, "INVALID_INPUT", "a caller-supplied company");
    const numbers = (await q(`SELECT reorder_request_number n FROM eos_ops.reorder_requests WHERE tenant_id = $1`, [TENANT])).rows.map((r) => r.n);
    assert.ok(numbers.every((x) => /^RR-\d{4}-\d{6}$/.test(x)) && new Set(numbers).size === numbers.length, `unique governed numbers: ${numbers.join(",")}`);
  });

  await t.test("MANAGEMENT SCOPE (G8): review / assign / cancel only inside the REORDER_QUEUE reach for the request's company -- answered as missing outside it", async () => {
    const r = ok(await inv(pa, "createReorderRequest", need({ partId: "PRT-RELAY" })), "create").reorderRequestId;
    const endReach = () => q(`UPDATE eos_workforce.employee_operational_scopes SET effective_to = now(), ended_at = now(), ended_by = 'fixture' WHERE tenant_id = $1 AND employee_id = 'e-pm' AND scope_type = 'REORDER_QUEUE' AND effective_to IS NULL`, [TENANT]);
    const restoreReach = () => q(`INSERT INTO eos_workforce.employee_operational_scopes (id, tenant_id, employee_id, scope_type, scope_id, effective_from, assigned_by)
                                 VALUES ($1, $2, 'e-pm', 'REORDER_QUEUE', 'taylor', now(), 'fixture')`, [`os-q-pm-${randomUUID()}`, TENANT]);
    await endReach();
    try {
      refused(await inv(pm, "reviewReorderRequest", { reorderRequestId: r, decision: "APPROVED" }), 404, "NOT_FOUND", "review outside reach");
      refused(await inv(pm, "cancelReorderRequest", { reorderRequestId: r, cancellationReason: "x" }), 404, "NOT_FOUND", "cancel outside reach");
    } finally { await restoreReach(); }
    ok(await inv(pm, "reviewReorderRequest", { reorderRequestId: r, decision: "APPROVED" }), "review in reach");
    await endReach();
    try {
      refused(await inv(pm, "assignReorderRequest", { reorderRequestId: r, employeeId: "e-pa" }), 404, "NOT_FOUND", "assign outside reach");
    } finally { await restoreReach(); }
    ok(await inv(pm, "cancelReorderRequest", { reorderRequestId: r, cancellationReason: "covered by a transfer" }), "cancel in reach");
  });

  await t.test("RECEIVING NEGATIVES: destination (DQ-C), scope, unsupported quantities, wrong item, voided / cancelled, duplicate, concurrent, serialized", async () => {
    const r = await toOrdered("PRT-PROBE", 4);
    const pre = (await onHand(pa, ["PRT-PROBE"])).totals;
    refused(await inv(pa, "receiveReorderStock", receipt(r, "PRT-PROBE", 4, { idempotencyKey: `d-${r}`, receivingLocation: { type: "WAREHOUSE", locationId: "wh-closed" } })), 412, "PRECONDITION_FAILED", "an inactive warehouse");
    refused(await inv(pa, "receiveReorderStock", receipt(r, "PRT-PROBE", 4, { idempotencyKey: `t-${r}`, receivingLocation: { type: "WAREHOUSE", locationId: "wh-tuc" } })), 412, "PRECONDITION_FAILED", "a warehouse other than the Reorder's");
    refused(await inv(pa, "receiveReorderStock", receipt(r, "PRT-PROBE", 4, { idempotencyKey: `b-${r}`, receivingLocation: { type: "BIN", locationId: "bin-nowhere" } })), 412, "PRECONDITION_FAILED", "an unknown bin");
    refused(await inv(wa, "receiveReorderStock", receipt(r, "PRT-PROBE", 4)), 403, "FORBIDDEN", "WAREHOUSE scope alone is not receiving authority");
    refused(await inv(pm, "receiveReorderStock", receipt(r, "PRT-PROBE", 4)), 403, "FORBIDDEN", "the Parts Manager does not receive merely as Manager");
    refused(await inv(pa, "receiveReorderStock", receipt(r, "PRT-PROBE", 5, { idempotencyKey: `o-${r}` })), 412, "PRECONDITION_FAILED", "over-receipt");
    refused(await inv(pa, "receiveReorderStock", receipt(r, "PRT-PROBE", 3, { idempotencyKey: `p-${r}` })), 412, "PRECONDITION_FAILED", "partial / short receipt (unsupported)");
    const wrong = await inv(pa, "receiveReorderStock", receipt(r, "PRT-FILTER", 4, { idempotencyKey: `w-${r}` }));
    assert.ok(wrong.status >= 400 && wrong.status < 500, `wrong item ${JSON.stringify(wrong.body)}`);
    assert.deepEqual((await onHand(pa, ["PRT-PROBE"])).totals, pre, "no refused receipt moved stock");
    const binId = (await one(`SELECT id FROM eos_ops.bins WHERE tenant_id = $1 AND warehouse_id = 'wh-phx'`, [TENANT])).id;
    ok(await inv(pa, "receiveReorderStock", receipt(r, "PRT-PROBE", 4, { idempotencyKey: `bin-${r}`, receivingLocation: { type: "BIN", locationId: binId } })), "receipt into its own bin");
    assert.deepEqual((await onHand(pa, ["PRT-PROBE"])).rows.map((x) => [x.locationType, x.warehouseId, x.onHand]), [["BIN", "wh-phx", 4]], "a bin rolls up to its warehouse");
    refused(await inv(pa, "receiveReorderStock", receipt(r, "PRT-PROBE", 4, { idempotencyKey: `again-${r}` })), 412, "PRECONDITION_FAILED", "duplicate receipt under a new key");
    const v = await toOrdered("PRT-FILTER", 2);
    ok(await inv(pm, "voidReorderPurchaseOrder", { reorderRequestId: v, voidReason: "supplier cancelled" }), "void");
    refused(await inv(pa, "receiveReorderStock", receipt(v, "PRT-FILTER", 2)), 412, "PRECONDITION_FAILED", "voided PO");
    refused(await inv(pm, "voidReorderPurchaseOrder", { reorderRequestId: v, voidReason: "again" }), 412, "PRECONDITION_FAILED", "second void");
    const c = ok(await inv(pa, "createReorderRequest", need({ partId: "PRT-BELT" })), "create").reorderRequestId;
    ok(await inv(pm, "reviewReorderRequest", { reorderRequestId: c, decision: "APPROVED" }), "approve");
    ok(await inv(pm, "cancelReorderRequest", { reorderRequestId: c, cancellationReason: "transfer instead" }), "cancel");
    const cr = await inv(pa, "receiveReorderStock", receipt(c, "PRT-BELT", 6));
    assert.ok(cr.status >= 400 && cr.status < 500, `cancelled request ${JSON.stringify(cr.body)}`);
    const cc = await toOrdered("PRT-BELT", 2);
    const both = await Promise.all([inv(pa, "receiveReorderStock", receipt(cc, "PRT-BELT", 2, { idempotencyKey: `c1-${cc}` })), inv(pa, "receiveReorderStock", receipt(cc, "PRT-BELT", 2, { idempotencyKey: `c2-${cc}` }))]);
    assert.equal(both.filter((x) => x.status === 200).length, 1, JSON.stringify(both.map((x) => [x.status, x.body.code])));
    const s1 = await toOrdered("PRT-COMP", 2);
    const noSerial = await inv(pa, "receiveReorderStock", receipt(s1, "PRT-COMP", 2));
    assert.ok(noSerial.status >= 400 && noSerial.status < 500, `serials required ${JSON.stringify(noSerial.body)}`);
    ok(await inv(pa, "receiveReorderStock", receipt(s1, "PRT-COMP", 2, { idempotencyKey: `s-${s1}`, lines: [{ lineId: "L1", partId: "PRT-COMP", receivedQuantity: 2, serialNumbers: ["CMP-1", "CMP-2"] }] })), "serialized receipt");
    assert.equal((await one(`SELECT count(*)::int n FROM eos_ops.serialized_custody WHERE tenant_id = $1 AND part_id = 'PRT-COMP'`, [TENANT])).n, 2, "custody per unit");
    assert.equal((await one(`SELECT count(*)::int n FROM eos_ops.inventory_movements WHERE tenant_id = $1 AND part_id = 'PRT-COMP'`, [TENANT])).n, 2, "movement per unit");
    assert.deepEqual((await onHand(pa, ["PRT-COMP"])).totals, [{ partId: "PRT-COMP", onHand: 2 }]);
    const s2 = await toOrdered("PRT-COMP2", 2);
    const before2 = (await one(`SELECT count(*)::int n FROM eos_ops.serialized_custody WHERE tenant_id = $1`, [TENANT])).n;
    const dupSerial = await inv(pa, "receiveReorderStock", receipt(s2, "PRT-COMP2", 2, { idempotencyKey: `s2-${s2}`, lines: [{ lineId: "L1", partId: "PRT-COMP2", receivedQuantity: 2, serialNumbers: ["CMP2-1", "CMP2-1"] }] }));
    assert.ok(dupSerial.status >= 400 && dupSerial.status < 500, `duplicate serial ${JSON.stringify(dupSerial.body)}`);
    assert.equal((await one(`SELECT count(*)::int n FROM eos_ops.serialized_custody WHERE tenant_id = $1`, [TENANT])).n, before2, "atomic refusal: nothing written");
  });

  await t.test("VISIBILITY: on-hand and receipts follow the caller's governed warehouse scope -- no cross-warehouse / cross-company leakage, fail closed", async () => {
    // Stock in another company's warehouse, as a ledger row the read must never show to an out-of-scope caller.
    await q(`INSERT INTO eos_ops.inventory_movements (id, tenant_id, operating_company_key, part_id, tracking_mode, location_type, location_id, movement_type, quantity_delta, source_kind, source_id, idempotency_key, created_by)
             VALUES ('mv-ventana-1', $1, 'ventana', 'PRT-FAN', 'NONE', 'WAREHOUSE', 'wh-ventana-1', 'ADJUSTED', 9, 'CYCLE_COUNT', 'fx', 'fx-ventana-1', 'fixture')`, [TENANT]);
    const mine = await onHand(pa, ["PRT-FAN"]);
    assert.deepEqual(mine.totals, [{ partId: "PRT-FAN", onHand: 6 }], "only in-scope stock; the Ventana 9 is invisible");
    assert.deepEqual((await onHand(pa, null).catch(() => ({ rows: [] }))).rows.filter((x) => x.warehouseId === "wh-ventana-1"), []);
    assert.deepEqual(ok(await inv(pa, "readInventoryOnHand", { warehouseId: "wh-ventana-1" }), "out of scope").rows, [], "asking for another company's warehouse returns nothing");
    for (const who of [nobody, owner]) {
      const r = await inv(who, "readInventoryOnHand", {});
      assert.ok(r.status === 403 || (r.status === 200 && r.body.result.rows.length === 0), `${who.subject} sees nothing: ${JSON.stringify(r.body).slice(0, 200)}`);
    }
    refused(await inv(tech, "readInventoryOnHand", {}), 403, "FORBIDDEN", "technician holds no inventory read");
    const anyReceipt = (await one(`SELECT id FROM eos_ops.receiving_orders WHERE tenant_id = $1 LIMIT 1`, [TENANT])).id;
    refused(await inv(pm, "readReceipt", { receiptId: anyReceipt }), 403, "FORBIDDEN", "the Parts Manager holds no receipt read");
    refused(await inv(tech, "listSuppliers", {}), 403, "FORBIDDEN", "technician holds no Supplier read");
  });

  await t.test("NEGATIVE PERSONAS: no Parts operational management from Owner status, sales, technician, general employee, warehouse scope or configuration authority", async () => {
    const r = ok(await inv(pa, "createReorderRequest", need({ partId: "PRT-COIL" })), "create").reorderRequestId;
    for (const [who, what] of [[tech, "technician"], [retail, "retail sales"], [national, "national accounts sales"], [nobody, "general employee"], [owner, "Owner"], [wa, "warehouse associate"], [wm, "warehouse manager"], [config, "configuration administrator"]]) {
      refused(await inv(who, "reviewReorderRequest", { reorderRequestId: r, decision: "APPROVED" }), 403, "FORBIDDEN", `${what} approve`);
      refused(await inv(who, "assignReorderRequest", { reorderRequestId: r, employeeId: "e-pa" }), 403, "FORBIDDEN", `${what} assign`);
      refused(await inv(who, "recordReorderPurchaseOrder", { reorderRequestId: r, supplier: { kind: "EXTERNAL_ORGANIZATION", supplierId: "SUP-DESERT" }, externalPoNumber: "x", orderedQuantity: 1, orderedDate: "2026-10-01" }), 403, "FORBIDDEN", `${what} record PO`);
      assert.equal((await inv(who, "receiveReorderStock", receipt(r, "PRT-COIL", 6))).status, 403, `${what} receive`);
    }
    for (const who of [tech, retail, national, nobody, wa, config]) {
      refused(await inv(who, "createReorderRequest", need({ partId: "PRT-HINGE" })), 403, "FORBIDDEN", `${who.subject} create`);
    }
  });
});
