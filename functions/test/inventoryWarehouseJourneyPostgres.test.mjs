// INVENTORY CONTROL / WAREHOUSE -- the reconciliation journey (Controller BEGIN INVENTORY CONTROL / WAREHOUSE JOURNEY,
// 2026-10-01). Proves the EXISTING PostgreSQL writers end to end -- nothing here is new business behavior.
//
// On a BASELINE-EQUAL tenant (support/serviceBaselineTenant.mjs) with the Parts / Purchasing / Receiving authority as
// nonprod now holds it, every grant through ADMINISTRATION, the governed Taylor warehouse `taylor-main` + bins through the
// Warehouse Administration, Employee links + WAREHOUSE_OPERATIONS eligibility + WAREHOUSE scopes. Every inventory writer
// is driven over the REAL Operations transport with its activation state INJECTED as ACTIVE (the test-injection seam the
// deployed server never supplies -- production still reads the governed INACTIVE constants):
//
//   receiving result (Reorder PO) -> put-away (WAREHOUSE -> BIN relocation that records the placement) -> on-hand by bin
//   -> placement-only stow -> relocation BIN -> BIN -> transfer (warehouse -> warehouse, local second-warehouse fixture)
//   -> cycle count + governed adjustment -> serialized custody (receipt units, relocation, transfer) -> non-PO acquire
//   -> employee-visible PostgreSQL stock / history, and the ruled negatives.
//
// Real PostgreSQL. Set POLICY_TEST_DATABASE_URL; without it the database half SKIPS.
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { serviceBaselineTenant } from "./support/serviceBaselineTenant.mjs";

const require = createRequire(import.meta.url);
const delta = require("../lib/adminPolicy/partsPurchasingReceivingDelta.js");
const inventoryDelta = require("../lib/adminPolicy/inventoryWarehouseActivationDelta.js");
const cutover = require("../lib/eosOps/migration/inventoryBaselineCutover.js");
const { MOVEMENT_DIRECTION, MOVEMENT_SOURCE_TYPE } = require("../lib/inventoryLedger/operationalMovementTypes.js");
const { executeAdminOperation } = require("../lib/adminPolicy/adminPolicyApi.js");
const { createWarehouseBinAdministration, isWarehouseAdminOperation } = require("../lib/eosOps/warehouseBinAdministration.js");
const { createMobileLocationScopeBindingAdministration } = require("../lib/eosOps/mobileLocationScopeBindingAdministration.js");

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const TENANT = "t-inventory";
const WH = "taylor-main";
// A LOCAL-ONLY second Taylor warehouse: a transfer needs two custody warehouses, and nonprod holds exactly one real one.
const WH2 = "taylor-transfer-fixture";
// THE PRODUCTION CONSTANTS. The five Inventory writers are { firestore: FROZEN, postgres: ACTIVE } in code (Controller
// INVENTORY / WAREHOUSE COMPLETION RULINGS, 2026-10-01); nothing is injected for them here. They still FAIL CLOSED until the
// tenant's legacy baseline is CERTIFIED -- step 0 proves the gate and then certifies through the governed cutover.
const ACTIVE = { workOrderPostgresState: "ACTIVE" };

const LIVE_REORDER_GRANTS = {
  partsManager: ["reorder.purchaseOrder.void", "reorder.request.approve", "reorder.request.assign", "reorder.request.cancel",
    "reorder.request.create.manual", "reorder.request.read", "reorder.request.reject"],
  partsAssociate: ["reorder.request.markReceived", "reorder.request.postPurchasingUpdate", "reorder.request.read",
    "reorder.request.recordPurchaseOrder", "reorder.request.startPurchasing"],
};

test("Inventory / Warehouse over the Operations transport (writers injected ACTIVE)", { skip: SKIP, concurrency: 1 }, async (t) => {
  const { q, admin, person, repo, pool, http } = await serviceBaselineTenant(t, { urlBase: URL_BASE, tenant: TENANT, prefix: "inv" });
  const one = async (sql, v = []) => (await q(sql, v)).rows[0];
  const call = async (who, route, operation, input = {}) => {
    const res = await http.handleOperationsRequest({ reader: repo, pool, ...ACTIVE,
      verifyToken: async (token) => ({ externalSubject: token, identityProvider: "firebase" }) },
    { method: "POST", url: route, headers: { authorization: `Bearer ${who.subject}` }, body: JSON.stringify({ operation, input }) });
    return { status: res.status, body: JSON.parse(res.body) };
  };
  const ok = (r, what = "") => { assert.equal(r.status, 200, `${what} ${JSON.stringify(r.body)}`); return r.body.result; };
  // A refusal: the HTTP status, and the code -- the writers answer a SPECIFIC code (CROSS_WAREHOUSE, IDEMPOTENCY_CONFLICT,
  // CAPABILITY_MISSING, ...), the Reorder commands a category; either names the refusal.
  const refused = (r, status, codes, what = "") => {
    assert.equal(r.status, status, `${what} ${JSON.stringify(r.body)}`);
    assert.ok([].concat(codes).includes(r.body.code), `${what}: code ${r.body.code} not in ${codes} ${JSON.stringify(r.body)}`);
  };
  const grant = async (roleKey, key) => {
    const c = await one(`SELECT object_key, action_key FROM eos_policy.capabilities WHERE key = $1`, [key]);
    const r = await admin("grantObjectActionToRole", { roleKey, objectKey: c.object_key, actionKey: c.action_key, reason: "inventory reconciliation fixture" });
    assert.equal(r.ok, true, `${roleKey} ${key} ${JSON.stringify(r).slice(0, 200)}`);
  };
  const wh = createWarehouseBinAdministration(pool), mb = createMobileLocationScopeBindingAdministration(pool);
  const configuration = (op, a, i, r) => (isWarehouseAdminOperation(op) ? wh : mb)(op, a, i, r);
  const adminAs = (who, operation, input) => executeAdminOperation({ repo, configuration },
    { caller: { externalSubject: who.subject, identityProvider: "firebase" }, operation, input, requestId: `r-${randomUUID()}` });

  // ── authority: the live Reorder grants + the APPLIED Parts delta (nonprod 2026-10-01), then the PROPOSED inventory delta ──
  for (const [roleKey, keys] of Object.entries(LIVE_REORDER_GRANTS)) for (const key of keys) await grant(roleKey, key);
  await admin("createRole", { key: "operationalConfigurationAdministrator", name: "Operational Configuration Administrator", reason: "DQ-033" });
  for (const { operation, input } of delta.partsPurchasingReceivingOperations()) assert.equal((await admin(operation, input)).ok, true);
  // The PREPARED Inventory / Warehouse delta (inventoryWarehouseActivationDelta.ts), exactly as the activation window issues it:
  // DQ-036b acquire to the four ruled Roles, and the designed Transfer operator / receiver split.
  for (const { operation, input } of inventoryDelta.inventoryWarehouseGrantOperations()) {
    assert.equal((await admin(operation, input)).ok, true, `${operation} ${input.roleKey} ${input.objectKey}.${input.actionKey}`);
  }

  // ── people, as the nonprod personas hold their Security Roles today (+ the proposed operator assignments) ──
  const pa = await person("uid-pa", ["partsAssociate", "inventoryReceivingClerk"], { id: "e-pa", name: "Pat Parts" });
  const pm = await person("uid-pm", ["partsManager", "purchasingManager"], { id: "e-pm", name: "Morgan PM" });
  const wa = await person("uid-wa", ["warehouseAssociate", "inventoryCycleCountCounter", "inventoryPutAwayOperator", "inventoryStockRelocationOperator", "inventoryTransferOperator"], { id: "e-wa", name: "Wren WA" });
  const wm = await person("uid-wm", ["warehouseManager", "inventoryBinAdministrator", "inventoryCycleCountReconciler", "inventoryTransferReceiver"], { id: "e-wm", name: "Wes WM" });
  const tech = await person("uid-tech", ["technician"], { id: "e-tech", name: "Tess Tech", technician: true });
  const retail = await person("uid-retail", ["salesperson"], { id: "e-retail", name: "Harper Retail" });
  const national = await person("uid-national", ["salesperson"], { id: "e-national", name: "Jules National" });
  const general = await person("uid-general", [], { id: "e-general", name: "Gen Employee" });
  const owner = await person("uid-owner", [], { id: "e-owner", name: "Owen Owner" });
  await repo.transact({ tenantId: TENANT, uid: "fixture" }, async (tx) => {  // the protected Owner Role, as a fixture assignment
    const accessVersion = await tx.bumpAccessVersion(owner.principalId);
    return tx.createAssignment({ principalId: owner.principalId, roleId: (await repo.getRoleByKey(TENANT, "owner")).id, scopeType: "global", scopeValue: null,
      status: "active", grantedBy: "fixture", grantedAt: new Date().toISOString(), accessVersionAtGrant: accessVersion });
  });
  const dispatcher = await person("uid-dispatcher", ["dispatcher"], { id: "e-dispatcher", name: "Dana Dispatch" });
  const office = await person("uid-office", ["officeManager", "operationalConfigurationAdministrator"], { id: "e-office", name: "Olive Office" });
  const config = office;

  // ── masters through the governed Warehouse Administration (DQ-E) ──
  for (const [id, name, co] of [[WH, "Taylor Main Warehouse", "taylor"], [WH2, "Taylor Transfer Fixture (local only)", "taylor"], ["ventana-wh", "Ventana Depot", "ventana"], ["taylor-closed", "Closed", "taylor"]]) {
    assert.equal((await adminAs(config, "createWarehouse", { warehouseId: id, name, siteLabel: name, operatingCompanyId: co, reason: "fixture master" })).ok, true, id);
  }
  const bin = async (w, aisle, bay, name) => (await adminAs(config, "createBin", { warehouseId: w, area: "MAIN", aisle, bay, position: 1, name, idempotencyKey: `bin-${w}-${aisle}${bay}`, reason: "rack" })).data.binId;
  const BIN_A = await bin(WH, "A", 1, "Shelf A1"), BIN_B = await bin(WH, "A", 2, "Shelf A2"), BIN_OFF = await bin(WH, "B", 1, "Retired");
  const BIN_W2 = await bin(WH2, "A", 1, "Fixture A1"), BIN_V = await bin("ventana-wh", "A", 1, "Ventana A1");
  assert.equal((await adminAs(config, "setBinStatus", { binId: BIN_OFF, status: "INACTIVE", reason: "retired shelf" })).ok, true);
  assert.equal((await adminAs(config, "setWarehouseStatus", { warehouseId: "taylor-closed", status: "INACTIVE", reason: "closed" })).ok, true);

  // ── eligibility + scope (the Workforce writer's rows; fixture inserts) ──
  const elig = (e, code) => q(`INSERT INTO eos_workforce.employee_work_eligibility (id,tenant_id,employee_id,qualification_code,effective_from,assigned_by) VALUES ($1,$2,$3,$4,now(),'fixture')`, [`we-${e}-${code}`, TENANT, e, code]);
  const scope = (e, type, id) => q(`INSERT INTO eos_workforce.employee_operational_scopes (id,tenant_id,employee_id,scope_type,scope_id,effective_from,assigned_by) VALUES ($1,$2,$3,$4,$5,now(),'fixture')`, [`os-${e}-${type}-${id}`, TENANT, e, type, id]);
  for (const e of ["e-pa", "e-pm"]) { await elig(e, "PARTS_OPERATIONS"); await scope(e, "REORDER_QUEUE", "taylor"); }
  for (const e of ["e-wa", "e-wm", "e-pa"]) { await elig(e, "WAREHOUSE_OPERATIONS"); await scope(e, "WAREHOUSE", WH); }
  await scope("e-wm", "WAREHOUSE", WH2);
  await scope("e-wa", "WAREHOUSE", "taylor-closed"); // so the INACTIVE-warehouse refusals are reached past scope
  await scope("e-owner", "WAREHOUSE", WH); // Owner HAS scope but no eligibility: scope alone is never authority
  await scope("e-dispatcher", "WAREHOUSE", WH);

  const part = (id, controlType = "STANDARD", status = "ACTIVE") => q(`INSERT INTO eos_ops.parts (id, tenant_id, created_by, internal_part_number, name, status, stocking_unit,
      control_type, stocking_class, expiry_tracked, consumable, returnable_core, whole_unit, version, updated_by)
      VALUES ($1,$2,'fixture',$1,$1,$3,'EACH',$4,'STOCKED',false,false,false,$5,1,'fixture')`, [id, TENANT, status, controlType, controlType === "SERIALIZED"]);
  for (const p of ["PRT-FAN", "PRT-COIL"]) await part(p);
  await part("PRT-COMP", "SERIALIZED");
  await part("PRT-UNIT", "SERIALIZED");
  await part("PRT-OLD", "STANDARD", "INACTIVE");
  await q(`INSERT INTO eos_ops.suppliers (tenant_id, supplier_id, name, normalized_key, status, version, created_by, updated_by)
           VALUES ($1,'SUP-1','Desert Supply','desert supply','ACTIVE',1,'fixture','fixture')`, [TENANT]);

  let n = 0;
  const key = (s) => `k-${s}-${++n}`;
  const INV = "/operations/inventory", REL = "/operations/relocation", PLC = "/operations/placement", TRF = "/operations/transfer", CC = "/operations/cycle-count", ACQ = "/operations/serialized-asset";
  const onHand = async (who, partIds) => ok(await call(who, INV, "readInventoryOnHand", { partIds }), "on-hand");
  const at = (rows, type, id) => rows.filter((r) => r.locationType === type && r.locationId === id).reduce((s, r) => s + r.onHand, 0);
  const ledger = async (partId) => (await q(`SELECT location_type t, location_id l, sum(quantity_delta)::int n FROM eos_ops.inventory_movements WHERE tenant_id=$1 AND part_id=$2 AND operating_company_key='taylor' GROUP BY 1,2 HAVING sum(quantity_delta)<>0 ORDER BY 1,2`, [TENANT, partId])).rows;
  const total = async (partId) => (await one(`SELECT coalesce(sum(quantity_delta),0)::int n FROM eos_ops.inventory_movements WHERE tenant_id=$1 AND part_id=$2 AND operating_company_key='taylor'`, [TENANT, partId])).n;

  // ── RECEIVING RESULT: the proven Reorder receipt, into the WAREHOUSE (stock waiting for put-away) ──
  const received = async (partId, qty, serials) => {
    const rr = ok(await call(pa, INV, "createReorderRequest", { partId, warehouseId: WH, requestedQuantity: qty, recommendationStatus: "BELOW_MIN", quantitySource: "MANUAL", idempotencyKey: key("rr") }), "create").reorderRequestId;
    ok(await call(pm, INV, "reviewReorderRequest", { reorderRequestId: rr, decision: "APPROVED" }), "approve");
    ok(await call(pm, INV, "assignReorderRequest", { reorderRequestId: rr, employeeId: "e-pa" }), "assign");
    ok(await call(pa, INV, "startPurchasingOnReorder", { reorderRequestId: rr }), "start");
    ok(await call(pa, INV, "recordReorderPurchaseOrder", { reorderRequestId: rr, supplierName: "Desert Supply", externalPoNumber: `PO-${partId}`, orderedQuantity: qty, orderedDate: "2026-10-01", expectedArrivalDate: "2026-10-08" }), "PO");
    ok(await call(pa, INV, "receiveReorderStock", { source: { type: "REORDER_PURCHASE_ORDER", reorderRequestId: rr, purchaseOrderId: rr },
      receivingLocation: { type: "WAREHOUSE", locationId: WH }, lines: [{ lineId: "L1", partId, receivedQuantity: qty, ...(serials ? { serialNumbers: serials } : {}) }], idempotencyKey: key("rcv") }), "receive");
  };
  await received("PRT-FAN", 10);
  await received("PRT-COMP", 3, ["CMP-1", "CMP-2", "CMP-3"]);

  await t.test("0. BASELINE CUTOVER: writers fail closed until the governed COPY certifies the legacy baseline", async () => {
    // Before certification every Inventory writer answers NOT_ACTIVATED -- the flipped constants alone open nothing.
    for (const [route, op, input] of [
      [REL, "relocateStock", { partId: "PRT-FAN", source: { type: "WAREHOUSE", locationId: WH }, destination: { type: "BIN", locationId: BIN_A }, quantity: 1, idempotencyKey: key("pre") }],
      [PLC, "recordPutAway", { warehouseId: WH, partId: "PRT-FAN", binId: BIN_A, quantity: 1, idempotencyKey: key("pre") }],
      [TRF, "createTransfer", { partId: "PRT-FAN", quantity: 1, origin: { type: "WAREHOUSE", locationId: WH }, destination: { type: "WAREHOUSE", locationId: WH2 }, idempotencyKey: key("pre") }],
      [CC, "createCycleCountSheet", { location: { type: "BIN", locationId: BIN_A }, idempotencyKey: key("pre") }],
      [ACQ, "acquireSerializedAsset", { partId: "PRT-UNIT", serialNo: "PRE-1", locationId: WH, reason: "OPENING_BALANCE", idempotencyKey: key("pre") }],
    ]) refused(await call(op === "acquireSerializedAsset" ? pa : wa, route, op, input), 503, "NOT_ACTIVATED", `${op} before certification`);

    // The LEGACY snapshot: one real legacy warehouse PROVEN to be taylor-main (same governed company), fixture rows,
    // truck rows, an unmapped warehouse, and serialized custody -- the shape the fenced exporter produces.
    const at0 = 1_727_000_000_000;
    const tx = (id, over = {}) => { const type = over.type ?? "RECEIVED"; return { id, data: { type, direction: MOVEMENT_DIRECTION[type], partId: "PRT-COIL", trackingMode: "NONE", quantity: 5,
      location: { type: "WAREHOUSE", locationId: "legacy-taylor-yard" }, sourceObject: { type: MOVEMENT_SOURCE_TYPE[type], id: `src-${id}` },
      actor: { kind: "USER", id: "legacy-user-1" }, occurredAt: at0, ...over } }; };
    const snapshot = {
      sha256: "a".repeat(64),
      warehouses: [{ id: "legacy-taylor-yard", data: { name: "Taylor Yard", operatingCompanyId: "taylor" } },
                   { id: "legacy-ventana", data: { name: "Ventana", operatingCompanyId: "ventana" } }],
      inventoryTransactions: [
        tx("lt-1"), tx("lt-2", { type: "RELOCATION_OUT", quantity: 2 }),
        tx("lt-3", { partId: "PRT-UNIT", trackingMode: "SERIAL", quantity: 1, serialNo: "LEG-UNIT-1" }),
        tx("lt-fixture", { location: { type: "WAREHOUSE", locationId: "wh-main" } }),
        tx("lt-truck", { location: { type: "MOBILE", locationId: "truck-7" } }),
        tx("lt-unmapped", { location: { type: "WAREHOUSE", locationId: "legacy-unknown-site" } }),
      ],
      serializedAssets: [
        { id: "sa-1", data: { serialNo: "LEG-UNIT-1", partId: "PRT-UNIT", currentLocationType: "WAREHOUSE", currentLocationId: "legacy-taylor-yard", inventoryState: "AVAILABLE" } },
        { id: "sa-installed", data: { serialNo: "LEG-INST-1", partId: "PRT-UNIT", currentLocationType: "WAREHOUSE", currentLocationId: "legacy-taylor-yard", inventoryState: "INSTALLED" } },
      ],
      cycleCounts: [], transferOrders: [],
    };
    const manifest = (extraExcluded = []) => cutover.validateManifest({
      format: "EOS_INVENTORY_BASELINE_MANIFEST", version: 1, ruling: "Controller INVENTORY / WAREHOUSE COMPLETION RULINGS (2026-10-01)",
      warehouseIdentity: [{ legacyWarehouseId: "legacy-taylor-yard", eosWarehouseId: WH, evidence: "Owner-confirmed master record: the Taylor yard IS taylor-main" }],
      excludedLegacyWarehouses: extraExcluded });
    // A fixture can never be a mapping SOURCE, and a mapping must be unambiguous.
    assert.throws(() => cutover.validateManifest({ ...manifest(), warehouseIdentity: [{ legacyWarehouseId: "wh-main", eosWarehouseId: WH, evidence: "x" }] }), /MANIFEST_FIXTURE_MAPPED|fixture/);
    const performedBy = owner.principalId;
    const input = (m) => ({ tenantId: TENANT, snapshot, manifest: m, performedBy });

    const census = await cutover.censusInventoryBaseline(pool, input(manifest()));
    const code = (id) => census.findings.find((f) => f.id === id);
    assert.equal(code("lt-fixture").disposition, "EXCLUDED_FIXTURE");
    assert.equal(code("lt-truck").disposition, "DEFERRED_TRUCK");
    assert.deepEqual([code("lt-unmapped").disposition, code("lt-unmapped").code], ["REFUSED", "UNMAPPED_WAREHOUSE"], "an unproven warehouse is STOPPED, never invented");
    assert.equal(code("sa-installed").disposition, "DEFERRED_EQUIPMENT");
    assert.equal(census.blocking, 1);

    // COPY writes what is proven; VERIFY refuses to certify while a blocking refusal stands.
    const copied = await cutover.copyInventoryBaselineOnce(pool, input(manifest()));
    assert.deepEqual([copied.outcome, copied.movementsInserted, copied.custodyInserted], ["APPLIED", 3, 1]);
    assert.equal((await cutover.copyInventoryBaselineOnce(pool, input(manifest()))).outcome, "NO_CHANGES", "replay-safe");
    await assert.rejects(cutover.certifyInventoryBaseline(pool, input(manifest())), { code: "BASELINE_NOT_VERIFIED" });
    refused(await call(wa, REL, "relocateStock", { partId: "PRT-FAN", source: { type: "WAREHOUSE", locationId: WH }, destination: { type: "BIN", locationId: BIN_A }, quantity: 1, idempotencyKey: key("pre") }), 503, "NOT_ACTIVATED", "still closed");

    // The operator classifies the unmapped site (here: a declared retired legacy site) -> VERIFIED -> CERTIFIED.
    const governed = manifest([{ legacyWarehouseId: "legacy-unknown-site", reason: "retired legacy site with no Taylor stock (fixture in this proof)" }]);
    const v = await cutover.verifyInventoryBaseline(pool, input(governed));
    assert.equal(v.verdict, "VERIFIED", JSON.stringify(v.plan.findings.filter((f) => f.disposition === "REFUSED" || f.disposition === "HELD")));
    assert.equal((await cutover.certifyInventoryBaseline(pool, input(governed))).outcome, "CERTIFIED");
    assert.equal((await cutover.certifyInventoryBaseline(pool, input(governed))).outcome, "CERTIFIED", "re-certifying the same evidence is a no-op");
    await assert.rejects(cutover.certifyInventoryBaseline(pool, input(manifest([{ legacyWarehouseId: "legacy-unknown-site", reason: "different words" }]))), { code: "CERTIFICATION_CONFLICT" });
    await assert.rejects(q(`DELETE FROM eos_ops.inventory_baseline_cutovers WHERE tenant_id = $1`, [TENANT]), /APPEND_ONLY/);

    // The copied baseline is employee-visible PostgreSQL stock and custody, at taylor-main, company taylor.
    assert.equal(at((await onHand(wa, ["PRT-COIL"])).rows, "WAREHOUSE", WH), 3);
    assert.deepEqual(await one(`SELECT location_id l, operating_company_key c, status::text s FROM eos_ops.serialized_custody WHERE tenant_id=$1 AND serial_number='LEG-UNIT-1'`, [TENANT]), { l: WH, c: "taylor", s: "AVAILABLE" });

    // PLAN-ONLY gates: a v2 legacy cycle-count sheet and an open legacy transfer at a real location both STOP certification;
    // a legacy unit colliding with receipt-created PostgreSQL custody is never overwritten.
    const target = await (async () => { const c = await pool.connect(); try { return await cutover.readTargetState(c, TENANT); } finally { c.release(); } })();
    const gated = cutover.planInventoryBaseline({ ...snapshot,
      cycleCounts: [{ id: "cc-v2", data: { schemaVersion: 2, status: "OPEN" } }],
      transferOrders: [{ id: "to-open", data: { status: "IN_TRANSIT", origin: { type: "WAREHOUSE", locationId: "legacy-taylor-yard" }, destination: { type: "WAREHOUSE", locationId: "legacy-ventana" } } }],
      serializedAssets: [{ id: "sa-clash", data: { serialNo: "CMP-3", partId: "PRT-COMP", currentLocationType: "BIN", currentLocationId: BIN_B, inventoryState: "AVAILABLE" } }],
    }, governed, target);
    const g = (id) => gated.findings.find((f) => f.id === id);
    assert.equal(g("cycle_counts").disposition, "REFUSED");
    assert.deepEqual([g("to-open").disposition, g("to-open").code], ["REFUSED", "OPEN_LEGACY_TRANSFER"]);
    assert.deepEqual([g("sa-clash").disposition, g("sa-clash").code], ["REFUSED", "CUSTODY_CONFLICT_EOS_AUTHORITATIVE"], "receipt-created custody stays authoritative");
  });

  await t.test("A. STOCK VISIBILITY: warehouse / bin rows, totals, serialized quantity, history, scope + company isolation", async () => {
    const fan = await onHand(wa, ["PRT-FAN"]);
    assert.deepEqual(fan.totals, [{ partId: "PRT-FAN", onHand: 10 }]);
    assert.equal(at(fan.rows, "WAREHOUSE", WH), 10);
    assert.deepEqual((await onHand(wa, ["PRT-COMP"])).totals, [{ partId: "PRT-COMP", onHand: 3 }], "a serialized unit counts once");
    const hist = ok(await call(wa, INV, "readInventoryMovements", { partIds: ["PRT-FAN"] }), "history");
    assert.ok(hist.items.some((m) => m.movementType === "RECEIVED" && m.quantityDelta === 10));
    await q(`INSERT INTO eos_ops.inventory_movements (id, tenant_id, operating_company_key, part_id, tracking_mode, location_type, location_id, movement_type, quantity_delta, source_kind, source_id, idempotency_key, created_by)
             VALUES ('mv-v', $1, 'ventana', 'PRT-FAN', 'NONE', 'BIN', $2, 'ADJUSTED', 7, 'CYCLE_COUNT', 'fx', 'fx-v', 'fixture')`, [TENANT, BIN_V]);
    assert.deepEqual((await onHand(wa, ["PRT-FAN"])).totals, [{ partId: "PRT-FAN", onHand: 10 }], "Ventana stock is invisible to a Taylor-scoped employee");
    assert.deepEqual(ok(await call(wa, INV, "readInventoryOnHand", { warehouseId: "ventana-wh" }), "x").rows, [], "naming another company's warehouse returns nothing");
    refused(await call(tech, INV, "readInventoryOnHand", {}), 403, "FORBIDDEN", "technician");
  });

  await t.test("B. PUT-AWAY: received stock WAREHOUSE -> governed bin (relocation that records the placement); placement-only stow; negatives", async () => {
    const r = ok(await call(wa, REL, "relocateStock", { partId: "PRT-FAN", source: { type: "WAREHOUSE", locationId: WH }, destination: { type: "BIN", locationId: BIN_A }, quantity: 6, recordPlacement: true, idempotencyKey: key("put") }), "put-away");
    assert.equal(r.outcome, "relocated");
    const rows = (await onHand(wa, ["PRT-FAN"])).rows;
    assert.deepEqual([at(rows, "WAREHOUSE", WH), at(rows, "BIN", BIN_A)], [4, 6], "on-hand by bin, conserved");
    assert.equal((await one(`SELECT count(*)::int n FROM eos_ops.bin_placements WHERE tenant_id=$1 AND bin_id=$2 AND part_id='PRT-FAN'`, [TENANT, BIN_A])).n, 1, "the placement record");
    assert.ok((await q(`SELECT action FROM eos_policy.audit_events WHERE tenant_id=$1 AND action='stockRelocation.relocate'`, [TENANT])).rows.length >= 1);
    // serialized put-away keeps custody per unit
    ok(await call(wa, REL, "relocateStock", { partId: "PRT-COMP", source: { type: "WAREHOUSE", locationId: WH }, destination: { type: "BIN", locationId: BIN_A }, serialNumbers: ["CMP-1"], recordPlacement: true, idempotencyKey: key("put-s") }), "serial put-away");
    assert.deepEqual(await one(`SELECT location_type t, location_id l FROM eos_ops.serialized_custody WHERE tenant_id=$1 AND serial_number='CMP-1'`, [TENANT]), { t: "BIN", l: BIN_A });
    // placement-only stow (DQ-038: an event, no ledger)
    const before = await total("PRT-FAN");
    ok(await call(wa, PLC, "recordPutAway", { warehouseId: WH, partId: "PRT-FAN", binId: BIN_A, quantity: 2, idempotencyKey: key("plc") }), "placement");
    assert.equal(await total("PRT-FAN"), before, "a placement writes no ledger");
    // negatives
    refused(await call(wa, REL, "relocateStock", { partId: "PRT-FAN", source: { type: "WAREHOUSE", locationId: WH }, destination: { type: "BIN", locationId: BIN_W2 }, quantity: 1, idempotencyKey: key("x") }), 412, ["CROSS_WAREHOUSE"], "a bin of another warehouse (cross-warehouse is a transfer)");
    const offBin = await call(wa, REL, "relocateStock", { partId: "PRT-FAN", source: { type: "WAREHOUSE", locationId: WH }, destination: { type: "BIN", locationId: BIN_OFF }, quantity: 1, idempotencyKey: key("x") });
    assert.ok(offBin.status >= 400 && offBin.status < 500, `inactive bin ${JSON.stringify(offBin.body)}`);
    const noBin = await call(wa, REL, "relocateStock", { partId: "PRT-FAN", source: { type: "WAREHOUSE", locationId: WH }, destination: { type: "BIN", locationId: "bin_" + "0".repeat(40) }, quantity: 1, idempotencyKey: key("x") });
    assert.ok(noBin.status >= 400 && noBin.status < 500, `unknown bin ${JSON.stringify(noBin.body)}`);
    refused(await call(wa, REL, "relocateStock", { partId: "PRT-FAN", source: { type: "WAREHOUSE", locationId: WH }, destination: { type: "BIN", locationId: BIN_A }, quantity: 0, idempotencyKey: key("x") }), 400, "INVALID", "quantity 0");
    const big = await call(wa, REL, "relocateStock", { partId: "PRT-FAN", source: { type: "WAREHOUSE", locationId: WH }, destination: { type: "BIN", locationId: BIN_A }, quantity: 99, idempotencyKey: key("x") });
    assert.ok(big.status === 409 || big.status === 412, `insufficient ${JSON.stringify(big.body)}`);
    const unknownPart = await call(wa, REL, "relocateStock", { partId: "PRT-NOWHERE", source: { type: "WAREHOUSE", locationId: WH }, destination: { type: "BIN", locationId: BIN_A }, quantity: 1, idempotencyKey: key("x") });
    assert.ok(unknownPart.status >= 400 && unknownPart.status < 500, `unknown part ${JSON.stringify(unknownPart.body)}`);
    refused(await call(wa, REL, "relocateStock", { partId: "PRT-FAN", source: { type: "BIN", locationId: BIN_V }, destination: { type: "BIN", locationId: BIN_A }, quantity: 1, idempotencyKey: key("x") }), 412, "CROSS_WAREHOUSE", "another company's bin (a different custody warehouse)");
    refused(await call(wa, REL, "relocateStock", { partId: "PRT-FAN", source: { type: "WAREHOUSE", locationId: WH }, destination: { type: "BIN", locationId: BIN_A }, quantity: 1, operatingCompanyKey: "ventana", idempotencyKey: key("x") }), 400, "INVALID", "caller-supplied company");
    // placement negatives
    refused(await call(wa, PLC, "recordPutAway", { warehouseId: WH, partId: "PRT-FAN", binId: BIN_W2, quantity: 1, idempotencyKey: key("x") }), 412, "BIN_WRONG_WAREHOUSE", "placement: bin of another warehouse");
    refused(await call(wa, PLC, "recordPutAway", { warehouseId: WH2, partId: "PRT-FAN", binId: BIN_W2, quantity: 1, idempotencyKey: key("x") }), 403, ["FORBIDDEN", "OUTSIDE_OPERATIONAL_SCOPE"], "placement: warehouse outside scope");
    const pUnknown = await call(wa, PLC, "recordPutAway", { warehouseId: WH, partId: "PRT-NOWHERE", binId: BIN_A, quantity: 1, idempotencyKey: key("x") });
    assert.ok(pUnknown.status >= 400 && pUnknown.status < 500, `placement: unknown Part ${JSON.stringify(pUnknown.body)}`);
    const pInactive = await call(wa, PLC, "recordPutAway", { warehouseId: WH, partId: "PRT-OLD", binId: BIN_A, quantity: 1, idempotencyKey: key("x") });
    assert.ok(pInactive.status >= 400 && pInactive.status < 500, `placement: inactive Part ${JSON.stringify(pInactive.body)}`);
    const pSerial = await call(wa, PLC, "recordPutAway", { warehouseId: WH2, partId: "PRT-COMP", binId: BIN_W2, serialNumbers: ["CMP-2"], idempotencyKey: key("x") });
    assert.ok(pSerial.status >= 400 && pSerial.status < 500, `placement: a serial in custody elsewhere ${JSON.stringify(pSerial.body)}`);
    const pForge = await call(wa, PLC, "recordPutAway", { warehouseId: WH, partId: "PRT-FAN", binId: BIN_A, quantity: 1, operatingCompanyKey: "ventana", idempotencyKey: key("x") });
    assert.ok(pForge.status >= 400 && pForge.status < 500, `placement: caller-supplied company ${JSON.stringify(pForge.body)}`);
  });

  await t.test("C. RELOCATION: BIN -> BIN conserves; replay; conflict; concurrency; serialized custody", async () => {
    const k = key("rel");
    const input = { partId: "PRT-FAN", source: { type: "BIN", locationId: BIN_A }, destination: { type: "BIN", locationId: BIN_B }, quantity: 2, idempotencyKey: k };
    assert.equal(ok(await call(wa, REL, "relocateStock", input), "relocate").outcome, "relocated");
    assert.equal(ok(await call(wa, REL, "relocateStock", input), "replay").outcome, "replayed");
    refused(await call(wa, REL, "relocateStock", { ...input, quantity: 3 }), 409, "IDEMPOTENCY_CONFLICT", "same key, different payload");
    const rows = (await onHand(wa, ["PRT-FAN"])).rows;
    assert.deepEqual([at(rows, "BIN", BIN_A), at(rows, "BIN", BIN_B), at(rows, "WAREHOUSE", WH)], [4, 2, 4]);
    assert.equal(await total("PRT-FAN"), 10, "quantity conserved");
    const both = await Promise.all([1, 2].map(() => call(wa, REL, "relocateStock", { partId: "PRT-FAN", source: { type: "BIN", locationId: BIN_A }, destination: { type: "BIN", locationId: BIN_B }, quantity: 3, idempotencyKey: key("race") })));
    assert.deepEqual(both.map((r) => r.status).sort(), [200, 409].includes(both[1].status) ? both.map((r) => r.status).sort() : [200, 412], JSON.stringify(both.map((r) => r.body.code)));
    assert.equal(both.filter((r) => r.status === 200).length, 1, "only one of two competing moves of 3 from 4");
    assert.ok((await ledger("PRT-FAN")).every((r) => r.n > 0), "no negative location");
    ok(await call(wa, REL, "relocateStock", { partId: "PRT-COMP", source: { type: "BIN", locationId: BIN_A }, destination: { type: "BIN", locationId: BIN_B }, serialNumbers: ["CMP-1"], idempotencyKey: key("rel-s") }), "serial move");
    assert.deepEqual(await one(`SELECT location_id l FROM eos_ops.serialized_custody WHERE tenant_id=$1 AND serial_number='CMP-1'`, [TENANT]), { l: BIN_B });
    const twice = await call(wa, REL, "relocateStock", { partId: "PRT-COMP", source: { type: "BIN", locationId: BIN_A }, destination: { type: "BIN", locationId: BIN_B }, serialNumbers: ["CMP-1"], idempotencyKey: key("rel-s2") });
    assert.ok(twice.status >= 400 && twice.status < 500, `a unit not at the source cannot move ${JSON.stringify(twice.body)}`);
    assert.equal((await one(`SELECT count(*)::int n FROM eos_ops.serialized_custody WHERE tenant_id=$1 AND serial_number='CMP-1'`, [TENANT])).n, 1, "one unit, one location");
  });

  let transferId;
  await t.test("D. TRANSFER: warehouse -> warehouse REQUESTED -> IN_TRANSIT -> COMPLETED; scope per act; replay; negatives", async () => {
    const k = key("trf");
    const input = { partId: "PRT-FAN", quantity: 2, origin: { type: "BIN", locationId: BIN_B }, destination: { type: "WAREHOUSE", locationId: WH2 }, idempotencyKey: k };
    const c = ok(await call(wa, TRF, "createTransfer", input), "create");
    transferId = c.transferOrderId;
    assert.match(c.transferOrderNumber, /^TO-\d{4}-\d{6}$/);
    assert.equal(ok(await call(wa, TRF, "createTransfer", input), "replay").outcome, "replayed");
    refused(await call(wa, TRF, "createTransfer", { ...input, quantity: 1 }), 409, "IDEMPOTENCY_CONFLICT", "same key, different payload");
    refused(await call(wa, TRF, "createTransfer", { ...input, destination: { type: "BIN", locationId: BIN_A }, idempotencyKey: key("x") }), 412, "SAME_CUSTODY_PARENT", "same custody warehouse is a relocation");
    const short = await call(wa, TRF, "createTransfer", { ...input, quantity: 50, idempotencyKey: key("x") });
    assert.ok(short.status === 409 || short.status === 412, `insufficient ${JSON.stringify(short.body)}`);
    ok(await call(wa, TRF, "dispatchTransfer", { transferOrderId: transferId }), "dispatch");
    refused(await call(wa, TRF, "receiveTransfer", { transferOrderId: transferId }), 403, "CAPABILITY_MISSING", "the Transfer OPERATOR does not receive (designed split)");
    refused(await call(wm, TRF, "dispatchTransfer", { transferOrderId: transferId }), 403, "CAPABILITY_MISSING", "the Transfer RECEIVER does not dispatch");
    ok(await call(wm, TRF, "receiveTransfer", { transferOrderId: transferId }), "receive at destination");
    assert.equal(at((await onHand(wm, ["PRT-FAN"])).rows, "WAREHOUSE", WH2), 2);
    assert.equal(await total("PRT-FAN"), 10, "quantity conserved across the transfer");
    const audits = (await q(`SELECT action FROM eos_policy.audit_events WHERE tenant_id=$1 AND action LIKE 'transfer.%'`, [TENANT])).rows.map((r) => r.action);
    for (const a of ["transfer.create", "transfer.dispatch", "transfer.receive"]) assert.ok(audits.includes(a), a);
    // serialized transfer keeps custody
    const s = ok(await call(wa, TRF, "createTransfer", { partId: "PRT-COMP", quantity: 1, serialNumbers: ["CMP-2"], origin: { type: "WAREHOUSE", locationId: WH }, destination: { type: "WAREHOUSE", locationId: WH2 }, idempotencyKey: key("trf-s") }), "serial transfer");
    ok(await call(wa, TRF, "dispatchTransfer", { transferOrderId: s.transferOrderId }), "dispatch s");
    assert.equal((await one(`SELECT status::text s FROM eos_ops.serialized_custody WHERE tenant_id=$1 AND serial_number='CMP-2'`, [TENANT])).s, "IN_TRANSIT");
    ok(await call(wm, TRF, "receiveTransfer", { transferOrderId: s.transferOrderId }), "receive s");
    assert.deepEqual(await one(`SELECT status::text s, location_id l FROM eos_ops.serialized_custody WHERE tenant_id=$1 AND serial_number='CMP-2'`, [TENANT]), { s: "AVAILABLE", l: WH2 });
  });

  await t.test("D2. TRANSFER LEDGER INTEGRITY: stock moved away between create and dispatch must not go negative", async () => {
    const c = ok(await call(wa, TRF, "createTransfer", { partId: "PRT-FAN", quantity: 3, origin: { type: "WAREHOUSE", locationId: WH }, destination: { type: "WAREHOUSE", locationId: WH2 }, idempotencyKey: key("trf-neg") }), "create");
    const atWh = at((await onHand(wa, ["PRT-FAN"])).rows, "WAREHOUSE", WH);
    ok(await call(wa, REL, "relocateStock", { partId: "PRT-FAN", source: { type: "WAREHOUSE", locationId: WH }, destination: { type: "BIN", locationId: BIN_B }, quantity: atWh, idempotencyKey: key("drain") }), "drain the origin");
    const d = await call(wa, TRF, "dispatchTransfer", { transferOrderId: c.transferOrderId });
    assert.ok(d.status === 409 || d.status === 412, `dispatch without stock at the origin must refuse: ${JSON.stringify(d.body)}`);
    assert.ok((await ledger("PRT-FAN")).every((r) => r.n > 0), `no negative location: ${JSON.stringify(await ledger("PRT-FAN"))}`);
    ok(await call(wa, TRF, "cancelTransfer", { transferOrderId: c.transferOrderId }), "cancel the stranded request");
  });

  await t.test("E. CYCLE COUNT: blind count -> variance -> separate reconciler approves -> governed ADJUSTED; serial variance refused", async () => {
    const sheet = ok(await call(wa, CC, "createCycleCountSheet", { location: { type: "BIN", locationId: BIN_A }, idempotencyKey: key("cc") }), "sheet").sheet;
    ok(await call(wa, CC, "openCycleCountLine", { sheetId: sheet.sheetId ?? sheet.id, partId: "PRT-FAN" }), "open");
    const sheetId = sheet.sheetId ?? sheet.id;
    const expected = at((await onHand(wa, ["PRT-FAN"])).rows, "BIN", BIN_A);
    ok(await call(wa, CC, "submitCycleCountLine", { sheetId, partId: "PRT-FAN", countedQuantity: expected - 1 }), "count");
    refused(await call(wa, CC, "reconcileCycleCountLine", { sheetId, partId: "PRT-FAN", decision: "APPROVE", reason: "x" }), 403, "CAPABILITY_MISSING", "the counter holds no reconcile");
    ok(await call(wm, CC, "reconcileCycleCountLine", { sheetId, partId: "PRT-FAN", decision: "APPROVE", reason: "one fan damaged and scrapped" }), "approve variance");
    assert.equal(at((await onHand(wa, ["PRT-FAN"])).rows, "BIN", BIN_A), expected - 1, "the governed adjustment is on-hand");
    const adj = await one(`SELECT quantity_delta d, source_kind k, operating_company_key c FROM eos_ops.inventory_movements WHERE tenant_id=$1 AND movement_type='ADJUSTED' AND source_kind='CYCLE_COUNT_LINE'`, [TENANT]);
    assert.deepEqual(adj, { d: -1, k: "CYCLE_COUNT_LINE", c: "taylor" });
    const s2 = ok(await call(wa, CC, "createCycleCountSheet", { location: { type: "BIN", locationId: BIN_B }, idempotencyKey: key("cc2") }), "sheet2").sheet;
    const s2id = s2.sheetId ?? s2.id;
    ok(await call(wa, CC, "openCycleCountLine", { sheetId: s2id, partId: "PRT-COMP" }), "open serial");
    ok(await call(wa, CC, "submitCycleCountLine", { sheetId: s2id, partId: "PRT-COMP", countedSerialNumbers: [] }), "count serial short");
    const sv = await call(wm, CC, "reconcileCycleCountLine", { sheetId: s2id, partId: "PRT-COMP", decision: "APPROVE", reason: "missing" });
    assert.ok(sv.status >= 400 && sv.status < 500, `serial variance is not reconcilable ${JSON.stringify(sv.body)}`);
    refused(await call(wa, CC, "createCycleCountSheet", { location: { type: "WAREHOUSE", locationId: "ventana-wh" }, idempotencyKey: key("x") }), 403, "OUTSIDE_OPERATIONAL_SCOPE", "outside scope");
  });

  await t.test("F. SERIALIZED ACQUIRE (DQ-036b): a unit entering stock outside a PO; receipt units are not re-acquired", async () => {
    const input = { partId: "PRT-UNIT", serialNo: "UNIT-1", locationId: WH, reason: "OPENING_BALANCE", idempotencyKey: key("acq") };
    ok(await call(pa, ACQ, "acquireSerializedAsset", input), "acquire");
    ok(await call(pa, ACQ, "acquireSerializedAsset", input), "replay");
    assert.equal((await one(`SELECT count(*)::int n FROM eos_ops.inventory_movements WHERE tenant_id=$1 AND serial_number='UNIT-1'`, [TENANT])).n, 1, "no duplicate movement on replay");
    refused(await call(pa, ACQ, "acquireSerializedAsset", { ...input, reason: "LEGACY_MIGRATION" }), 409, ["ALREADY_EXISTS_CONFLICT", "IDEMPOTENCY_CONFLICT"], "same key, different payload");
    const again = await call(pa, ACQ, "acquireSerializedAsset", { partId: "PRT-COMP", serialNo: "CMP-3", locationId: WH, reason: "OPENING_BALANCE", idempotencyKey: key("acq2") });
    assert.equal(again.status, 409, `a unit that arrived by receipt is never re-acquired ${JSON.stringify(again.body)}`);
    const atBin = await call(pa, ACQ, "acquireSerializedAsset", { partId: "PRT-UNIT", serialNo: "UNIT-2", locationId: BIN_A, reason: "OPENING_BALANCE", idempotencyKey: key("acq3") });
    assert.ok(atBin.status >= 400 && atBin.status < 500, "acquire lands on a WAREHOUSE");
    refused(await call(tech, ACQ, "acquireSerializedAsset", { ...input, idempotencyKey: key("x") }), 403, "PERMISSION_DENIED", "technician");
    assert.deepEqual((await onHand(wa, ["PRT-UNIT"])).totals, [{ partId: "PRT-UNIT", onHand: 2 }], "the copied legacy unit + the acquired unit");
    refused(await call(pa, ACQ, "acquireSerializedAsset", { partId: "PRT-UNIT", serialNo: "UNIT-9", locationId: "taylor-closed", reason: "OPENING_BALANCE", idempotencyKey: key("acq-closed") }), 403, ["OUTSIDE_OPERATIONAL_SCOPE", "PERMISSION_DENIED"], "an out-of-scope (and inactive) warehouse");
  });

  await t.test("G. EOS READS (warehouse list / locations / transfer orders) + extra ledger-integrity negatives", async () => {
    const whs = ok(await call(wa, INV, "listInventoryWarehouses", {}), "warehouses").items;
    assert.deepEqual(whs.map((w) => [w.warehouseId, w.operatingCompanyId, w.status]).sort(), [["taylor-closed", "taylor", "INACTIVE"], [WH, "taylor", "ACTIVE"]],
      "the caller's scoped governed warehouses from eos_ops.warehouses -- never Ventana, never a fixture");
    const locs = ok(await call(wa, INV, "listInventoryLocations", { warehouseId: WH }), "locations").items;
    assert.ok(locs.some((l) => l.type === "WAREHOUSE" && l.locationId === WH) && locs.some((l) => l.type === "BIN" && l.locationId === BIN_A && l.code));
    assert.deepEqual(ok(await call(wa, INV, "listInventoryLocations", { warehouseId: "ventana-wh" }), "x").items, [], "no cross-company location");
    const gen = await call(general, INV, "listInventoryWarehouses", {});
    assert.ok(gen.status === 403 || (gen.status === 200 && gen.body.result.items.length === 0), `general employee sees no warehouse ${JSON.stringify(gen.body)}`);
    const transfers = ok(await call(wm, INV, "listTransferOrders", {}), "transfers").items;
    assert.ok(transfers.length >= 2 && transfers.every((x) => /^TO-/.test(x.transferOrderNumber)));
    refused(await call(tech, INV, "listTransferOrders", {}), 403, "FORBIDDEN", "technician sees no transfer orders");
    // inactive warehouse: placement and relocation refuse new work there
    const pClosed = await call(wa, PLC, "recordPutAway", { warehouseId: "taylor-closed", partId: "PRT-FAN", binCode: "A-1-1", quantity: 1, idempotencyKey: key("closed") });
    assert.ok(pClosed.status >= 400 && pClosed.status < 500, `placement into an inactive warehouse ${JSON.stringify(pClosed.body)}`);
    // inactive Part cannot be relocated
    const rOld = await call(wa, REL, "relocateStock", { partId: "PRT-OLD", source: { type: "WAREHOUSE", locationId: WH }, destination: { type: "BIN", locationId: BIN_A }, quantity: 1, idempotencyKey: key("old") });
    assert.ok(rOld.status >= 400 && rOld.status < 500, `inactive Part ${JSON.stringify(rOld.body)}`);
    // CONCURRENT DISPATCH: the same transfer dispatched twice at once applies once; two transfers competing for the same
    // stock at dispatch cannot both take it.
    const stock = at((await onHand(wa, ["PRT-FAN"])).rows, "BIN", BIN_B);
    assert.ok(stock >= 2, `fixture stock at BIN_B: ${stock}`);
    const mk = async (qty) => ok(await call(wa, TRF, "createTransfer", { partId: "PRT-FAN", quantity: qty, origin: { type: "BIN", locationId: BIN_B }, destination: { type: "WAREHOUSE", locationId: WH2 }, idempotencyKey: key("cd") }), "create").transferOrderId;
    const one1 = await mk(1);
    const same = await Promise.all([1, 2].map(() => call(wa, TRF, "dispatchTransfer", { transferOrderId: one1 })));
    assert.deepEqual(same.map((r) => r.status), [200, 200]);
    assert.deepEqual(same.map((r) => r.body.result.outcome).sort(), ["applied", "replayed"]);
    const left = at((await onHand(wa, ["PRT-FAN"])).rows, "BIN", BIN_B);
    const [a, b] = [await mk(left), await mk(left)];
    const race = await Promise.all([a, b].map((id) => call(wa, TRF, "dispatchTransfer", { transferOrderId: id })));
    assert.equal(race.filter((r) => r.status === 200).length, 1, JSON.stringify(race.map((r) => [r.status, r.body.code])));
    assert.ok((await ledger("PRT-FAN")).every((r) => r.n > 0), "no negative location after the race");
  });

  await t.test("NEGATIVE PERSONAS: no inventory-changing act from title, Owner status, scope alone, sales, technician, dispatcher, configuration", async () => {
    const acts = [
      [REL, "relocateStock", { partId: "PRT-FAN", source: { type: "BIN", locationId: BIN_B }, destination: { type: "BIN", locationId: BIN_A }, quantity: 1, idempotencyKey: key("n") }],
      [PLC, "recordPutAway", { warehouseId: WH, partId: "PRT-FAN", binId: BIN_A, quantity: 1, idempotencyKey: key("n") }],
      [TRF, "createTransfer", { partId: "PRT-FAN", quantity: 1, origin: { type: "BIN", locationId: BIN_B }, destination: { type: "WAREHOUSE", locationId: WH2 }, idempotencyKey: key("n") }],
      [CC, "createCycleCountSheet", { location: { type: "BIN", locationId: BIN_B }, idempotencyKey: key("n") }],
    ];
    const before = (await q(`SELECT count(*)::int n FROM eos_ops.inventory_movements WHERE tenant_id=$1`, [TENANT])).rows[0].n;
    for (const [who, label] of [[tech, "technician"], [retail, "retail"], [national, "national"], [general, "general"], [owner, "owner"], [dispatcher, "dispatcher"], [office, "office/config"], [pm, "parts manager"]]) {
      for (const [route, op, input] of acts) {
        const r = await call(who, route, op, input);
        assert.equal(r.status, 403, `${label} ${op}: ${JSON.stringify(r.body)}`);
      }
    }
    assert.equal((await q(`SELECT count(*)::int n FROM eos_ops.inventory_movements WHERE tenant_id=$1`, [TENANT])).rows[0].n, before, "nothing moved");
  });
});
