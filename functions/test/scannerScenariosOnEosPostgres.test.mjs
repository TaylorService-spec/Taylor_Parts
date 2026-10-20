// SCAN-PORT -- THE THIRTEEN SANDBOX SCANNER SCENARIOS, ON EOS, IN CI, ON A DISPOSABLE POSTGRESQL.
//
// scripts/runSandboxScannerScenarios.mjs ran thirteen scenarios as real personas against the deployed FIREBASE callables of a
// live sandbox, with real passwords. Those callables are retired (Firebase exit F3b and after), so the script could no longer
// run, and a scenario that needs a live environment and a credential is not a regression test. This file is the port: every
// scenario drives the REAL EOS Operations / Catalog transport handlers over a database it builds and drops itself. No live
// environment, no credential, no Firebase.
//
// Fixtures are built the way the activation journeys build them (support/serviceBaselineTenant.mjs): the authority baseline,
// the prepared Parts/Purchasing, Inventory/Warehouse and Truck grant deltas through Administration, the Warehouse / Bin / Truck
// masters through the governed Administration commands, Employees with their Work Eligibility and Operational Scopes.
//
// (The brief said "twelve"; the script holds thirteen -- the census test below counts them, so a fourteenth cannot be missed.)
//
// PERSONA MAPPING (Firebase script persona -> EOS persona, by what the EOS authority actually grants):
//   partsAssociate (lookups)        -> Parts Associate (partsAssociate + inventoryReceivingClerk + inventoryLookupReader)
//   partsAssociate (put-away/count) -> Warehouse Associate. On EOS the Parts Associate holds NO put-away / count / transfer authority
//                                      (Owner decision PA-1 is open); that refusal is asserted in SCN-6, SCN-7, SCN-8 and SCN-10, not papered over.
//   partsManager (reconciles a count)-> Warehouse Manager. The script had the Parts Manager dispose of the count (SCN-10); on EOS the
//                                      reconcile Role is the Warehouse Manager's (inventoryCycleCountReconciler), which holds NO counter
//                                      authority -- the reconcile-only refusal is asserted on that same persona. The Parts Manager's
//                                      own refusal to open a count is asserted too.
//   warehouseManager                -> Warehouse Manager (+ transfer receiver, count reconciler, returns intake clerk)
//   partsManager                    -> Parts Manager (+ purchasing manager)
//   technician / serviceTechnician  -> two Technicians, each scoped to ONE truck
//
// SCENARIO MAP (script scenario -> EOS operation)
//    1 Part-code lookup            readPartBalance (read-only)
//    2 Barcode / alias lookup      Catalog createPartAlias + lookupScannedPart
//    3 Serialized lookup           Equipment listAvailableEquipmentUnits + readPartBalance (NOT_COUNTED_BY_QUANTITY)
//    4 Balance / location          readPartBalance (UNKNOWN is not 0; a truck is not warehouse stock) + listInventoryLocations
//    5 Multi-line partial receiving receiveSupplierPurchaseOrder (LIVE on EOS; the Firebase run asserted a readiness refusal)
//    6 Put-away                    recordPutAway
//    7 Pick / stage                recordPutAway with pickedForWorkOrderId
//    8 Warehouse transfer          createTransfer / dispatchTransfer / receiveTransfer
//    9 Truck handoff               createTransfer to a MOBILE location
//   10 Cycle count                 createCycleCountSheet / openCycleCountLine / submitCycleCountLine / reconcileCycleCountLine
//   11 Return intake               recordReturnIntake
//   12 Technician reachability     readPartBalance + lookupScannedPart reach; no warehouse act inherited
//   13 Technician incoming         listTransferOrders (the server derives the truck) + receiveTransfer
//
// Input (wedge / camera) is a CLIENT concern and is proven in field-ops-app-vite/test/scannerScenarioInput.test.jsx.
// Real PostgreSQL. Set POLICY_TEST_DATABASE_URL; without it the database half SKIPS (the census does not need it).
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { serviceBaselineTenant } from "./support/serviceBaselineTenant.mjs";
import { certifyInventoryBaselineFixture } from "./support/inventoryBaselineCertified.mjs";
import { applyStockReservationMigration } from "./support/stockReservationMigration.mjs";

const require = createRequire(import.meta.url);
const partsDelta = require("../lib/adminPolicy/partsPurchasingReceivingDelta.js");
const inventoryDelta = require("../lib/adminPolicy/inventoryWarehouseActivationDelta.js");
const truckDelta = require("../lib/adminPolicy/truckInventoryActivationDelta.js");
const { executeAdminOperation } = require("../lib/adminPolicy/adminPolicyApi.js");
const { createMobileLocationScopeBindingAdministration } = require("../lib/eosOps/mobileLocationScopeBindingAdministration.js");
const { createWarehouseBinAdministration, isWarehouseAdminOperation } = require("../lib/eosOps/warehouseBinAdministration.js");
const { createTruckRegistryAdministration, isTruckRegistryAdminOperation } = require("../lib/eosOps/truckRegistryAdministration.js");
const workforceHttp = require("../lib/eosWorkforce/workforceHttp.js");
const { executeCatalogOperation } = require("../lib/catalogMaster/catalogHttp.js");

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const TENANT = "t-scan";
const PREFIX = "scn";
const WH = "taylor-main";
const WH2 = "taylor-transfer-fixture";
const PART = "PRT-1001";        // standard, stocked
const PART_B = "PRT-1002";      // standard, NO movement evidence at all
const SERIAL_PART = "PRT-2001"; // serialized whole unit
const RCV_A = "PRT-RCV-A";
const RCV_B = "PRT-RCV-B";
const MODEL = "ACME--UNIT-100";
const INV = "/operations/inventory", PLC = "/operations/placement", TRF = "/operations/transfer", CC = "/operations/cycle-count", EQ = "/operations/equipment";
const W = (id) => ({ type: "WAREHOUSE", locationId: id });
const M = (id) => ({ type: "MOBILE", locationId: id });

// ───────────────────────────── the census (offline) ─────────────────────────────

test("census: every scenario of the superseded Firebase runner is ported to a named test here", () => {
  const script = readFileSync(new URL("../../scripts/runSandboxScannerScenarios.mjs", import.meta.url), "utf8");
  const numbers = [...new Set([...script.matchAll(/-- (\d+)\. /g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
  assert.deepEqual(numbers, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13], "the runner's scenarios changed -- port the new one");
  const self = readFileSync(new URL(import.meta.url), "utf8");
  for (const n of numbers) assert.ok(self.includes(`t.test("SCN-${n} `), `scenario ${n} has no SCN-${n} test`);
  assert.match(script, /SUPERSEDED/, "the Firebase script must say it is superseded");
});

// ───────────────────────────── the world ─────────────────────────────

test("SCAN-PORT: the scanner scenarios on EOS (real PostgreSQL, real transports)", { skip: SKIP, concurrency: 1 }, async (t) => {
  const { q, admin, person, repo, pool, http } = await serviceBaselineTenant(t, { urlBase: URL_BASE, tenant: TENANT, prefix: PREFIX });
  await applyStockReservationMigration(pool);
  const ADMIN_SUBJECT = `uid-${PREFIX}-admin`;
  const one = async (sql, v = []) => (await q(sql, v)).rows[0];
  const call = async (who, route, operation, input = {}) => {
    const res = await http.handleOperationsRequest({ reader: repo, pool, workOrderPostgresState: "ACTIVE",
      verifyToken: async (token) => ({ externalSubject: token, identityProvider: "firebase" }) },
    { method: "POST", url: route, headers: { authorization: `Bearer ${who.subject}` }, body: JSON.stringify({ operation, input }) });
    return { status: res.status, body: JSON.parse(res.body) };
  };
  const ok = (r, what = "") => { assert.equal(r.status, 200, `${what} ${JSON.stringify(r.body)}`); return r.body.result; };
  const refused = (r, status, codes, what = "") => {
    assert.equal(r.status, status, `${what} ${JSON.stringify(r.body)}`);
    assert.ok([].concat(codes).includes(r.body.code), `${what}: code ${r.body.code} not in ${codes} ${JSON.stringify(r.body)}`);
  };
  const adminOk = (r, what = "") => { assert.equal(r.ok, true, `${what} ${JSON.stringify(r).slice(0, 400)}`); return r.data; };
  const configuration = (() => {
    const bindings = createMobileLocationScopeBindingAdministration(pool);
    const warehouses = createWarehouseBinAdministration(pool);
    const trucks = createTruckRegistryAdministration(pool);
    return (operation, actor, input, reason) => (isWarehouseAdminOperation(operation) ? warehouses
      : isTruckRegistryAdminOperation(operation) ? trucks : bindings)(operation, actor, input, reason);
  })();
  const adminAs = (who, operation, input) => executeAdminOperation({ repo, configuration },
    { caller: { externalSubject: who.subject, identityProvider: "firebase", requestedTenantId: null }, operation, input, requestId: `r-${randomUUID()}` });
  const workforce = async (who, operation, input) => {
    const res = await workforceHttp.handleWorkforceRequest({ reader: repo, pool, allowedOrigins: [],
      verifyToken: async (token) => ({ externalSubject: token, identityProvider: "firebase" }) },
    { method: "POST", url: "/workforce/employees", headers: { authorization: `Bearer ${who.subject}` }, body: JSON.stringify({ operation, input }) });
    return { status: res.status, body: JSON.parse(res.body) };
  };
  const catalog = (who, operation, input) => executeCatalogOperation({ reader: repo, pool },
    { caller: { externalSubject: who.subject, identityProvider: "firebase", requestedTenantId: null }, operation, input });

  // The state a scenario must be able to prove unchanged.
  const count = async (sql, v = []) => Number((await one(sql, v)).n);
  const movements = () => count(`SELECT count(*)::int n FROM eos_ops.inventory_movements WHERE tenant_id = $1`, [TENANT]);
  const commitments = () => count(`SELECT count(*)::int n FROM eos_ops.inventory_commitments WHERE tenant_id = $1`, [TENANT]);
  const placements = () => count(`SELECT count(*)::int n FROM eos_ops.bin_placements WHERE tenant_id = $1`, [TENANT]);
  const totalOf = (partId) => count(`SELECT COALESCE(sum(quantity_delta),0)::int n FROM eos_ops.inventory_movements WHERE tenant_id = $1 AND part_id = $2 AND tracking_mode = 'NONE'`, [TENANT, partId]);
  const warehouseLedger = (partId) => count(`SELECT COALESCE(sum(quantity_delta),0)::int n FROM eos_ops.inventory_movements
      WHERE tenant_id = $1 AND part_id = $2 AND tracking_mode = 'NONE' AND location_type::text IN ('WAREHOUSE','BIN')`, [TENANT, partId]);
  const truckLedger = (partId, id) => count(`SELECT COALESCE(sum(quantity_delta),0)::int n FROM eos_ops.inventory_movements
      WHERE tenant_id = $1 AND part_id = $2 AND location_type::text = 'MOBILE' AND location_id = $3`, [TENANT, partId, id]);
  const balanceOf = async (who, partId) => ok(await call(who, INV, "readPartBalance", { partId }), `balance ${partId}`);

  // ── AUTHORITY: the prepared deltas, exactly as the activation windows issue them, through Administration ──
  if (!(await repo.getRoleByKey(TENANT, "operationalConfigurationAdministrator"))) {
    adminOk(await admin("createRole", { key: "operationalConfigurationAdministrator", name: "Operational Configuration Administrator", reason: "DQ-033" }));
  }
  for (const { operation, input } of partsDelta.partsPurchasingReceivingOperations()) adminOk(await admin(operation, input), operation);
  for (const { operation, input } of inventoryDelta.inventoryWarehouseGrantOperations()) adminOk(await admin(operation, input), `${operation} ${input.roleKey}`);
  for (const { operation, input } of truckDelta.truckInventoryActivationOperations()) adminOk(await admin(operation, input), `${operation} ${input.roleKey}`);

  // ── people, as the nonprod personas hold their Security Roles ──
  const LOOKUP = "inventoryLookupReader";
  const config = await person("uid-config", ["operationalConfigurationAdministrator"], { id: "e-config", name: "Cass Config" });
  const pa = await person("uid-pa", ["partsAssociate", "inventoryReceivingClerk", LOOKUP], { id: "e-pa", name: "Pat Parts" });
  const pm = await person("uid-pm", ["partsManager", "purchasingManager", LOOKUP], { id: "e-pm", name: "Morgan PM" });
  const wa = await person("uid-wa", ["warehouseAssociate", "inventoryCycleCountCounter", "inventoryPutAwayOperator", "inventoryStockRelocationOperator",
    "inventoryTransferOperator", LOOKUP], { id: "e-wa", name: "Wren WA" });
  const wm = await person("uid-wm", ["warehouseManager", "inventoryBinAdministrator", "inventoryCycleCountReconciler", "inventoryTransferReceiver",
    "inventoryReturnsIntakeClerk", LOOKUP], { id: "e-wm", name: "Wes WM" });
  const techA = await person("uid-tech-a", ["technician", LOOKUP], { id: "e-tech-a", name: "Finley Tech", technician: true });
  const techB = await person("uid-tech-b", ["technician", LOOKUP], { id: "e-tech-b", name: "Gray Tech", technician: true });

  // ── masters through the governed Administration commands (never by writing rows around the authority) ──
  for (const [id, name] of [[WH, "Taylor Main Warehouse"], [WH2, "Taylor Transfer Fixture (local only)"]]) {
    adminOk(await adminAs(config, "createWarehouse", { warehouseId: id, name, siteLabel: name, operatingCompanyId: "taylor", reason: "scanner scenario master" }), id);
  }
  const bin = async (warehouseId, aisle, bay, name) => adminOk(await adminAs(config, "createBin",
    { warehouseId, area: "MAIN", aisle, bay, position: 1, name, idempotencyKey: `bin-${warehouseId}-${aisle}${bay}`, reason: "scanner scenario rack" }), name).binId;
  const BIN_ID = await bin(WH, "A", 1, "Shelf A1");
  const STAGE_BIN_ID = await bin(WH, "B", 1, "Staging B1");
  const OTHER_BIN_ID = await bin(WH2, "C", 1, "Other warehouse C1");
  const codeOf = async (binId) => (await one(`SELECT code FROM eos_ops.bins WHERE tenant_id = $1 AND id = $2`, [TENANT, binId])).code;
  const BIN_CODE = await codeOf(BIN_ID), STAGE_CODE = await codeOf(STAGE_BIN_ID), OTHER_CODE = await codeOf(OTHER_BIN_ID);
  assert.ok(BIN_CODE && STAGE_CODE && OTHER_CODE && new Set([BIN_CODE, STAGE_CODE, OTHER_CODE]).size === 3, "the server derived three distinct bin codes");

  // ── eligibility + scope (the Workforce writer's rows; fixture inserts, as the journeys do) ──
  const elig = (e, code) => q(`INSERT INTO eos_workforce.employee_work_eligibility (id,tenant_id,employee_id,qualification_code,effective_from,assigned_by)
      VALUES ($1,$2,$3,$4,now(),'fixture')`, [`we-${e}-${code}`, TENANT, e, code]);
  const scope = (e, type, id) => q(`INSERT INTO eos_workforce.employee_operational_scopes (id,tenant_id,employee_id,scope_type,scope_id,effective_from,assigned_by)
      VALUES ($1,$2,$3,$4,$5,now(),'fixture')`, [`os-${e}-${type}-${id}`, TENANT, e, type, id]);
  for (const e of ["e-wa", "e-wm"]) await elig(e, "WAREHOUSE_OPERATIONS");
  await scope("e-wa", "WAREHOUSE", WH);
  await scope("e-wm", "WAREHOUSE", WH);
  await scope("e-wm", "WAREHOUSE", WH2);
  await scope("e-pa", "WAREHOUSE", WH); // the Parts Associate as nonprod holds it: a warehouse scope, NO Warehouse Operations eligibility

  // ── trucks: two for the Technicians (each its own), one spare van that holds stock for the "no van stock" proof ──
  const reason = "scanner scenario truck";
  for (const n of [1, 2, 3]) {
    adminOk(await adminAs(config, "createMobileLocation", { locationId: `mob-trk-${n}`, displayLabel: `Truck ${n} stock`, operatingCompanyId: "taylor", reason }));
    adminOk(await adminAs(config, "createTruck", { truckId: `trk-${n}`, vehicleNumber: `T-10${n}`, displayLabel: `Taylor Truck ${n}`, homeWarehouseId: WH, mobileLocationId: `mob-trk-${n}`, reason }));
    adminOk(await adminAs(config, "setMobileLocationScopeBinding", { locationId: `mob-trk-${n}`, warehouseId: WH, reason }));
  }
  const adminWho = { subject: ADMIN_SUBJECT };
  ok(await workforce(adminWho, "assignEmployeeOperationalScope", { employeeId: "e-tech-a", scopeType: "MOBILE", scopeId: "mob-trk-1", reason: "truck assignment" }), "tech A -> truck 1");
  ok(await workforce(adminWho, "assignEmployeeOperationalScope", { employeeId: "e-tech-b", scopeType: "MOBILE", scopeId: "mob-trk-2", reason: "truck assignment" }), "tech B -> truck 2");

  // ── catalog + stock ──
  await q(`INSERT INTO eos_ops.equipment_models (id, tenant_id, manufacturer_id, manufacturer_name, model_number, display_name, status, source_authority, version, created_by, updated_by)
           VALUES ($1,$2,'ACME','Acme','UNIT-100','Acme Unit 100','ACTIVE','fixture',1,'fixture','fixture')`, [MODEL, TENANT]);
  const part = (id, control = "STANDARD", wholeUnit = false, modelId = null) => q(`INSERT INTO eos_ops.parts (id, tenant_id, created_by, internal_part_number, name, status,
      stocking_unit, control_type, stocking_class, expiry_tracked, consumable, returnable_core, whole_unit, equipment_model_id, version, updated_by)
      VALUES ($1,$2,'fixture',$1,$1,'ACTIVE','EACH',$3,'STOCKED',false,false,false,$4,$5,1,'fixture')`, [id, TENANT, control, wholeUnit, modelId]);
  await part(PART); await part(PART_B); await part(RCV_A); await part(RCV_B); await part(SERIAL_PART, "SERIALIZED", true, MODEL);
  let mv = 0;
  await q(`INSERT INTO eos_ops.inventory_movements (id, tenant_id, operating_company_key, part_id, tracking_mode, location_type, location_id, movement_type,
             quantity_delta, source_kind, source_id, created_by)
           VALUES ($1,$2,'taylor',$3,'NONE','WAREHOUSE',$4,'RECEIVED',20,'FIXTURE','fixture','fixture')`, [`mov-scn-${++mv}`, TENANT, PART, WH]);
  for (const serial of ["SN-A1", "SN-A2"]) {
    await q(`INSERT INTO eos_ops.serialized_custody (id, tenant_id, part_id, serial_number, status, location_type, location_id, operating_company_key, updated_by)
             VALUES ($1,$2,$3,$4,'AVAILABLE','WAREHOUSE',$5,'taylor','fixture')`, [`cst-${serial}`, TENANT, SERIAL_PART, serial, WH]);
    await q(`INSERT INTO eos_ops.inventory_movements (id, tenant_id, operating_company_key, part_id, tracking_mode, location_type, location_id, movement_type,
               quantity_delta, serial_number, source_kind, source_id, created_by)
             VALUES ($1,$2,'taylor',$3,'SERIAL','WAREHOUSE',$4,'RECEIVED',1,$5,'FIXTURE','fixture','fixture')`, [`mov-scn-${++mv}`, TENANT, SERIAL_PART, WH, serial]);
  }
  await certifyInventoryBaselineFixture(q, TENANT);

  // The spare van holds real stock, put there by a governed transfer: warehouse operator creates and dispatches, the warehouse manager receives.
  const VAN_QTY = 3;
  const van = ok(await call(wa, TRF, "createTransfer", { partId: PART, quantity: VAN_QTY, origin: W(WH), destination: M("mob-trk-3"), idempotencyKey: "scn-van-seed" }), "van create");
  ok(await call(wa, TRF, "dispatchTransfer", { transferOrderId: van.transferOrderId }), "van dispatch");
  ok(await call(wm, TRF, "receiveTransfer", { transferOrderId: van.transferOrderId }), "van receive");
  assert.equal(await truckLedger(PART, "mob-trk-3"), VAN_QTY, "the spare van holds stock");

  // ═════════════ SCN-1 ═════════════
  await t.test("SCN-1 part-code lookup: the authoritative balance of the scanned code is returned, and a lookup is READ-ONLY", async () => {
    const snapshot = async () => ({ movements: await movements(), commitments: await commitments(), placements: await placements(), balance: await balanceOf(pa, PART) });
    const before = await snapshot();
    const r = await balanceOf(pa, PART);
    assert.equal(r.partId, PART);
    assert.equal(r.trackingMode, "NONE");
    assert.deepEqual([r.onHand.state, r.onHand.value], ["KNOWN", await warehouseLedger(PART)], "the figure is the ledger's, not a made-up number");
    assert.deepEqual(await snapshot(), before, "a lookup writes nothing and changes no figure");
    refused(await call(pa, INV, "readPartBalance", { partId: "PRT-NOT-A-PART" }), 404, "NOT_FOUND", "an unknown code is NOT_FOUND, never a zero");
    refused(await call(pa, INV, "readPartBalance", {}), 400, "INVALID_INPUT", "nothing scanned is not 'nothing found'");
  });

  // ═════════════ SCN-2 ═════════════
  await t.test("SCN-2 barcode / alias lookup: a registered alias resolves (wedge whitespace and all); unknown is truthful; blank is refused", async () => {
    // Each format a scanner reads, registered through the governed Catalog command, resolved through the scanner contract.
    const aliases = [["BARCODE_OTHER", "0123456789012"], ["UPC", "012345678905"], ["BARCODE_OTHER", "BC-SCN-7731"]];
    for (const [aliasType, rawValue] of aliases) {
      const made = await catalog(pm, "createPartAlias", { partId: PART, aliasType, rawValue });
      assert.equal(made.ok, true, `${aliasType} ${rawValue} ${JSON.stringify(made)}`);
    }
    for (const [, rawValue] of aliases) {
      const r = await catalog(pa, "lookupScannedPart", { rawValue: `  ${rawValue}  ` }); // a wedge's surrounding whitespace
      assert.equal(r.ok, true, `${rawValue} ${JSON.stringify(r)}`);
      assert.deepEqual([r.result.alias.result, r.result.alias.partId, r.result.aliasDenied, r.result.parts.map((p) => p.id)], ["FOUND", PART, false, [PART]], rawValue);
    }
    const byCode = await catalog(pa, "lookupScannedPart", { rawValue: "prt-1001", partCode: "prt-1001" });
    assert.deepEqual(byCode.result.parts.map((p) => p.id), [PART], "a typed part code resolves case-insensitively");
    const unknown = await catalog(pa, "lookupScannedPart", { rawValue: "BC-NOT-REGISTERED-0001" });
    assert.equal(unknown.ok, true, JSON.stringify(unknown));
    assert.deepEqual([unknown.result.alias.result, unknown.result.alias.partId, unknown.result.parts], ["NOT_FOUND", undefined, []], "NOT_FOUND with no fallback partId");
    for (const input of [{ rawValue: "   " }, { rawValue: "x".repeat(300) }, { rawValue: "0123456789012", collection: "users" }]) {
      const r = await catalog(pa, "lookupScannedPart", input);
      assert.deepEqual([r.ok, r.code], [false, "INVALID_INPUT"], "a blank, oversize or widened request is refused, never NOT_FOUND");
    }
  });

  // ═════════════ SCN-3 ═════════════
  await t.test("SCN-3 serialized lookup: units are read by identity, the quantity is never aggregated, and the caller cannot force a confident zero", async () => {
    const units = ok(await call(pa, EQ, "listAvailableEquipmentUnits", { partId: SERIAL_PART }), "serialized identity read").units;
    assert.deepEqual(units.map((u) => [u.serialNumber, u.status, u.locationType, u.warehouseId]), [["SN-A1", "AVAILABLE", "WAREHOUSE", WH], ["SN-A2", "AVAILABLE", "WAREHOUSE", WH]]);
    assert.deepEqual(ok(await call(pa, EQ, "listAvailableEquipmentUnits", { serialNumber: "SN-A1" }), "by serial").units.map((u) => u.serialNumber), ["SN-A1"], "a scanned serial finds its unit");
    const bal = await balanceOf(pa, SERIAL_PART);
    assert.equal(bal.trackingMode, "SERIAL");
    for (const figure of [bal.onHand, bal.reserved, bal.available]) assert.deepEqual([figure.state, figure.value], ["NOT_COUNTED_BY_QUANTITY", null], "no fabricated quantity");
    // The server decides the tracking mode from the Part -- the request cannot say a serialized shelf is empty.
    refused(await call(pa, INV, "readPartBalance", { partId: SERIAL_PART, serialTracked: false }), 400, "INVALID_INPUT", "serialTracked is not the caller's to state");
    refused(await call(pa, INV, "readPartBalance", { partId: PART, serialTracked: true }), 400, "INVALID_INPUT");
    assert.deepEqual(ok(await call(pa, INV, "readInventoryOnHand", { partIds: [SERIAL_PART] }), "on hand").totals, [{ partId: SERIAL_PART, onHand: 2 }], "a unit counts once");
  });

  // ═════════════ SCN-4 ═════════════
  await t.test("SCN-4 balance / location: UNKNOWN is not zero, a truck's stock is not warehouse stock, locations are named by the governed read", async () => {
    const unknown = await balanceOf(pa, PART_B);
    assert.deepEqual([unknown.onHand.state, unknown.onHand.value, unknown.available.state], ["UNKNOWN", null, "UNKNOWN"], "no evidence reads UNKNOWN, never 0");
    const bal = await balanceOf(pa, PART);
    assert.equal(await truckLedger(PART, "mob-trk-3"), VAN_QTY);
    assert.equal(bal.onHand.value, await warehouseLedger(PART), "the balance is the warehouse's; the van's stock is absent from it");
    assert.ok(bal.byLocation.every((l) => bal.scopedWarehouseIds.includes(l.warehouseId)), "a breakdown names warehouses, never a truck");
    const stock = ok(await call(wm, INV, "readTruckStock", { mobileLocationId: "mob-trk-3" }), "the van's own stock read");
    assert.deepEqual([stock.reach, stock.quantities], ["WAREHOUSE_SCOPE", [{ partId: PART, onHand: VAN_QTY }]]);
    const locs = ok(await call(wa, INV, "listInventoryLocations", { warehouseId: WH }), "locations").items;
    assert.ok(locs.some((l) => l.type === "WAREHOUSE" && l.locationId === WH));
    assert.ok(locs.some((l) => l.type === "BIN" && l.locationId === BIN_ID && l.code === BIN_CODE), "a bin is displayed by its derived code");
    assert.equal(locs.some((l) => l.locationId === OTHER_BIN_ID), false, "another warehouse's rack is not in this warehouse's list");
  });
  await t.test("SCN-4 'available' nets open HARD reservations (S1b): a claim at the warehouse lowers available, never on-hand, and unallocated demand does not", async () => {
    const ledger = require("../lib/eosOps/inventoryCommitmentRepository.js");
    await q(`INSERT INTO eos_ops.stock_reservation_activation (tenant_id, operating_company_key, activated_by, reason) VALUES ($1,'taylor','fixture','scenario activation')`, [TENANT]);
    await q(`INSERT INTO eos_crm.accounts (id, tenant_id, name, status, created_by, updated_by) VALUES ('cust-scn-4',$1,'Cust','ACTIVE','f','f')`, [TENANT]);
    await q(`INSERT INTO eos_ops.work_orders (id, tenant_id, operating_company_key, status, work_order_type, priority, customer_id, location_id,
               provenance, created_by_principal_id, created_at, updated_at)
             VALUES ('wo-scn-4',$1,'taylor','WORK_IN_PROGRESS'::eos_ops.ops_work_order_status,'SERVICE_CALL',2,'cust-scn-4','loc-1','NATIVE',$2,now(),now())`,
      [TENANT, pa.principalId]);
    const at = (bal) => bal.byLocation.find((l) => l.warehouseId === WH);
    const before = at(await balanceOf(pa, PART));
    assert.deepEqual([before.reserved.state, before.reserved.value], ["KNOWN", 0], "activated, and nothing claimed yet");
    const ctx = { tenantId: TENANT, operatingCompanyKey: "taylor", warehouseId: WH, source: { kind: "WORK_ORDER", workOrderId: "wo-scn-4" }, actorId: "system", idempotencyKey: "scn4-res" };
    await ledger.reserve(pool, ctx, [{ partId: PART, quantity: 2 }]);
    const claimed = await balanceOf(pa, PART);
    const held = at(claimed);
    assert.deepEqual([held.quantity, held.reserved.value, held.available.value], [before.quantity, 2, before.quantity - 2], "available is netted by the hard reservation; on-hand is not");
    assert.ok(["KNOWN", "SCOPE_PARTIAL"].includes(claimed.reserved.state), "never a wrong number: the headline is the claim or SCOPE_PARTIAL");
    await ledger.cancel(pool, { tenantId: TENANT, operatingCompanyKey: "taylor", source: ctx.source, actorId: "system", idempotencyKey: "scn4-cancel" }, { reason: "scenario cleanup" });
    assert.equal(at(await balanceOf(pa, PART)).available.value, before.quantity, "released: the unit is available again");
  });

  // ═════════════ SCN-5 ═════════════
  await t.test("SCN-5 multi-line partial receiving: LIVE on EOS -- partial receipts over time, replay, over-receipt, and who may receive", async () => {
    const order = async (id, lines) => {
      await q(`INSERT INTO eos_ops.supplier_purchase_orders (id, tenant_id, operating_company_key, supplier_id, external_po_number, status, version, created_by, updated_by)
               VALUES ($1,$2,'taylor',NULL,$1,'SENT',0,'fixture','fixture')`, [id, TENANT]);
      for (const [lineId, partId, qty] of lines) {
        await q(`INSERT INTO eos_ops.supplier_purchase_order_lines (tenant_id, purchase_order_id, line_id, part_id, ordered_quantity) VALUES ($1,$2,$3,$4,$5)`, [TENANT, id, lineId, partId, qty]);
      }
      return id;
    };
    const request = (poId, lines, idempotencyKey) => ({ source: { type: "PURCHASE_ORDER", purchaseOrderId: poId }, receivingLocation: W(WH), lines, idempotencyKey });
    const po = await order("po-scn-1", [["L1", RCV_A, 10], ["L2", RCV_B, 4]]);
    assert.ok(ok(await call(pa, INV, "listReceivableSupplierPurchaseOrders", {}), "receivable list").purchaseOrders.some((p) => p.purchaseOrderId === po));

    // The Firebase run asserted a READINESS refusal for every persona. On EOS receiving is live: these personas are refused by CAPABILITY.
    for (const [label, who, key] of [["parts manager", pm, "scn5-pm"], ["warehouse manager", wm, "scn5-wm"], ["technician", techA, "scn5-tech"]]) {
      const before = await movements();
      refused(await call(who, INV, "receiveSupplierPurchaseOrder", request(po, [{ lineId: "L1", partId: RCV_A, receivedQuantity: 1 }], key)), 403, "FORBIDDEN", label);
      assert.equal(await movements(), before, `${label}: a refusal writes nothing`);
    }

    const first = ok(await call(pa, INV, "receiveSupplierPurchaseOrder", request(po, [{ lineId: "L1", partId: RCV_A, receivedQuantity: 4 }], "scn5-first")), "first partial receipt");
    assert.deepEqual([first.outcome, first.derivedState, first.storedStatus], ["applied", "PARTIALLY_RECEIVED", "SENT"]);
    assert.deepEqual(first.lines.map((l) => [l.lineId, l.receivedNow, l.remainingQuantity]), [["L1", 4, 6], ["L2", 0, 4]], "the untouched line still shows its full remainder");
    const afterFirst = await movements();
    assert.equal(ok(await call(pa, INV, "receiveSupplierPurchaseOrder", request(po, [{ lineId: "L1", partId: RCV_A, receivedQuantity: 4 }], "scn5-first")), "replay").outcome, "replayed");
    assert.equal(await movements(), afterFirst, "a re-sent receipt is not recorded twice");

    const second = ok(await call(pa, INV, "receiveSupplierPurchaseOrder",
      request(po, [{ lineId: "L1", partId: RCV_A, receivedQuantity: 6 }, { lineId: "L2", partId: RCV_B, receivedQuantity: 4 }], "scn5-second")), "completing receipt");
    assert.deepEqual([second.outcome, second.derivedState, second.storedStatus], ["applied", "RECEIVED", "RECEIVED"]);
    assert.deepEqual([await warehouseLedger(RCV_A), await warehouseLedger(RCV_B)], [10, 4]);
    const bal = await balanceOf(pa, RCV_A);
    assert.deepEqual([bal.onHand.state, bal.onHand.value], ["KNOWN", 10], "received stock is on hand");

    const small = await order("po-scn-2", [["L1", RCV_A, 3]]);
    const before = await movements();
    refused(await call(pa, INV, "receiveSupplierPurchaseOrder", request(small, [{ lineId: "L1", partId: RCV_A, receivedQuantity: 5 }], "scn5-over")), 412, "PRECONDITION_FAILED", "over-receipt");
    assert.equal(await movements(), before, "an over-receipt leaves no trace");
  });

  // ═════════════ SCN-6 ═════════════
  await t.test("SCN-6 put-away: recorded by the bin's code, STOWING MOVES NO CUSTODY, a bin is only meaningful in its own warehouse, replay is idempotent", async () => {
    const before = { movements: await movements(), placements: await placements(), balance: await balanceOf(pa, PART), total: await totalOf(PART) };
    const stow = { warehouseId: WH, binCode: BIN_CODE, partId: PART, quantity: 3, idempotencyKey: "scn6-put" };
    const r = ok(await call(wa, PLC, "recordPutAway", stow), "put-away");
    assert.deepEqual([r.outcome, r.binCode], ["recorded", BIN_CODE]);
    assert.equal(await placements(), before.placements + 1, "one placement recorded");
    assert.equal(await movements(), before.movements, "STOWING MOVES NO CUSTODY: not one ledger row (DECISIONS #116)");
    assert.deepEqual(await balanceOf(pa, PART), before.balance, "...and the balance is untouched");
    assert.equal(await totalOf(PART), before.total);
    // A bin is only meaningful in its own warehouse: another warehouse's rack, by id or by code, is not this warehouse's.
    refused(await call(wa, PLC, "recordPutAway", { warehouseId: WH, binId: OTHER_BIN_ID, partId: PART, quantity: 1, idempotencyKey: "scn6-wrongwh" }), 412, "BIN_WRONG_WAREHOUSE");
    refused(await call(wa, PLC, "recordPutAway", { warehouseId: WH, binCode: OTHER_CODE, partId: PART, quantity: 1, idempotencyKey: "scn6-wrongcode" }), 404, "BIN_NOT_FOUND");
    // Racking is never created by scanning at it.
    refused(await call(wa, PLC, "recordPutAway", { warehouseId: WH, binId: `bin_${"0".repeat(40)}`, partId: PART, quantity: 1, idempotencyKey: "scn6-unknown" }), 404, "BIN_NOT_FOUND");
    // A well-formed code that no bin of this warehouse holds (shape /^[A-Z0-9][A-Z0-9.\-_]{0,31}$/ passes) is a missing bin, nothing else.
    refused(await call(wa, PLC, "recordPutAway", { warehouseId: WH, binCode: `${BIN_CODE}-NEVER`, partId: PART, quantity: 1, idempotencyKey: "scn6-unknown-code" }), 404, "BIN_NOT_FOUND");
    assert.equal(await placements(), before.placements + 1, "no refused stow recorded anything");
    assert.equal(ok(await call(wa, PLC, "recordPutAway", stow), "replay").outcome, "replayed", "a re-sent stow must not record twice");
    assert.equal(await placements(), before.placements + 1);
    // PA-1 (Owner decision open): the Parts Associate holds no put-away authority on EOS, so the Firebase script's persona could not run this.
    refused(await call(pa, PLC, "recordPutAway", { ...stow, idempotencyKey: "scn6-pa" }), 403, "CAPABILITY_MISSING", "parts associate");
    refused(await call(techA, PLC, "recordPutAway", { ...stow, idempotencyKey: "scn6-tech" }), 403, "CAPABILITY_MISSING", "technician");
  });

  // ═════════════ SCN-7 ═════════════
  await t.test("SCN-7 pick / stage: staged against a work order, PICKING RESERVES NOTHING", async () => {
    const before = { reserved: (await balanceOf(pa, PART)).reserved, commitments: await commitments(), movements: await movements() };
    assert.deepEqual([before.reserved.state, before.reserved.value], ["KNOWN", 0]);
    const r = ok(await call(wa, PLC, "recordPutAway", { warehouseId: WH, binCode: STAGE_CODE, partId: PART, quantity: 2, pickedForWorkOrderId: "WO-SCN-7", idempotencyKey: "scn7-pick" }), "pick/stage");
    assert.equal(r.outcome, "recorded");
    assert.equal((await one(`SELECT picked_for_work_order_id w FROM eos_ops.bin_placements WHERE tenant_id = $1 AND id = $2`, [TENANT, r.placementIds[0]])).w, "WO-SCN-7", "staged against the work order");
    assert.deepEqual((await balanceOf(pa, PART)).reserved, before.reserved, "reserved is unchanged: commitment is a work-order lifecycle effect, never a pick");
    assert.equal(await commitments(), before.commitments, "no commitment row was written");
    assert.equal(await movements(), before.movements);
    // PA-1: the Parts Associate cannot stage a pick either (no put-away authority on EOS).
    refused(await call(pa, PLC, "recordPutAway", { warehouseId: WH, binCode: STAGE_CODE, partId: PART, quantity: 2, pickedForWorkOrderId: "WO-SCN-7", idempotencyKey: "scn7-pa" }), 403, "CAPABILITY_MISSING", "parts associate pick");
    assert.equal(await commitments(), before.commitments);
  });

  // ═════════════ SCN-8 ═════════════
  await t.test("SCN-8 warehouse transfer: the existing authority, operator and receiver are different people, same-location is refused, stock is conserved", async () => {
    const total = await totalOf(PART);
    const input = { partId: PART, quantity: 1, origin: W(WH), destination: W(WH2), idempotencyKey: "scn8-xfer" };
    const created = ok(await call(wa, TRF, "createTransfer", input), "create");
    assert.match(created.transferOrderNumber, /^TO-\d{4}-\d{6}$/);
    assert.equal(ok(await call(wa, TRF, "createTransfer", input), "replay").outcome, "replayed");
    refused(await call(wa, TRF, "createTransfer", { ...input, quantity: 2 }), 409, "IDEMPOTENCY_CONFLICT", "same key, different transfer");
    refused(await call(wa, TRF, "createTransfer", { ...input, destination: W(WH), idempotencyKey: "scn8-same" }), 400, "SAME_LOCATION", "origin must differ from destination");
    for (const [op, body] of [["createTransfer", { ...input, idempotencyKey: "scn8-pa" }], ["dispatchTransfer", { transferOrderId: created.transferOrderId }]]) {
      refused(await call(pa, TRF, op, body), 403, "CAPABILITY_MISSING", `parts floor ${op}: transfer is not part of the parts-floor grant`);
    }
    ok(await call(wa, TRF, "dispatchTransfer", { transferOrderId: created.transferOrderId }), "dispatch");
    refused(await call(wa, TRF, "receiveTransfer", { transferOrderId: created.transferOrderId }), 403, "CAPABILITY_MISSING", "the operator does not receive (the designed split)");
    ok(await call(wm, TRF, "receiveTransfer", { transferOrderId: created.transferOrderId }), "receive at the destination");
    assert.equal(await totalOf(PART), total, "quantity is conserved across the transfer");
    assert.equal(await count(`SELECT COALESCE(sum(quantity_delta),0)::int n FROM eos_ops.inventory_movements WHERE tenant_id = $1 AND part_id = $2 AND location_id = $3`, [TENANT, PART, WH2]), 1, "it arrived");
  });

  // ═════════════ SCN-9 ═════════════
  await t.test("SCN-9 truck handoff: a handoff IS a transfer to the truck's location; an unregistered truck fails closed", async () => {
    const total = await totalOf(PART);
    const before = await truckLedger(PART, "mob-trk-3");
    const h = ok(await call(wa, TRF, "createTransfer", { partId: PART, quantity: 1, origin: W(WH), destination: M("mob-trk-3"), idempotencyKey: "scn9-hand" }), "handoff create");
    ok(await call(wa, TRF, "dispatchTransfer", { transferOrderId: h.transferOrderId }), "handoff dispatch");
    ok(await call(wm, TRF, "receiveTransfer", { transferOrderId: h.transferOrderId }), "handoff receive");
    assert.equal(await truckLedger(PART, "mob-trk-3"), before + 1);
    assert.equal(await totalOf(PART), total, "conserved");
    const ghost = await call(wa, TRF, "createTransfer", { partId: PART, quantity: 1, origin: W(WH), destination: M("truck-not-real"), idempotencyKey: "scn9-unknown" });
    assert.ok([400, 404].includes(ghost.status) && ["DESTINATION_INVALID", "LOCATION_NOT_FOUND"].includes(ghost.body.code), `an unregistered destination fails closed ${JSON.stringify(ghost.body)}`);
    assert.equal(await totalOf(PART), total, "and nothing moved");
    refused(await call(techA, TRF, "createTransfer", { partId: PART, quantity: 1, origin: W(WH), destination: M("mob-trk-1"), idempotencyKey: "scn9-tech" }), 403, "CAPABILITY_MISSING", "a technician never creates a handoff");
  });

  // ═════════════ SCN-10 ═════════════
  await t.test("SCN-10 cycle count: blind line, COUNTING IS NOT ADJUSTING, a different Role disposes, neither the manager nor the parts manager may count", async () => {
    const sheet = ok(await call(wa, CC, "createCycleCountSheet", { location: W(WH), idempotencyKey: "scn10-sheet" }), "counter starts a sheet").sheet;
    const sheetId = sheet.sheetId;
    const opened = ok(await call(wa, CC, "openCycleCountLine", { sheetId, partId: PART }), "open").line;
    assert.equal(opened.expectedQuantity, undefined, "a line opens BLIND: no expected value in the response");
    const ledgerBefore = await movements(), balanceBefore = await balanceOf(pa, PART);
    const submitted = ok(await call(wa, CC, "submitCycleCountLine", { sheetId, partId: PART, countedQuantity: 99 }), "counter submits").line;
    assert.equal(submitted.status, "COUNTED");
    assert.equal(typeof submitted.expectedQuantity, "number", "the expected value is revealed only after the count is submitted");
    assert.equal(await movements(), ledgerBefore, "COUNTING IS NOT ADJUSTING: a submitted count moves no stock");
    assert.deepEqual(await balanceOf(pa, PART), balanceBefore);
    const seen = ok(await call(wm, CC, "getCycleCountSheet", { sheetId }), "reviewer reads the sheet");
    assert.ok(seen.lines.some((l) => l.partId === PART && l.status === "COUNTED"), "a reviewer on another device sees the counted line");
    refused(await call(wa, CC, "reconcileCycleCountLine", { sheetId, partId: PART, decision: "REJECT", reason: "scenario" }), 403, "CAPABILITY_MISSING", "a counter cannot dispose of a line");
    // The reviewer REJECTS: it proves the path without adjusting stock.
    const disposed = ok(await call(wm, CC, "reconcileCycleCountLine", { sheetId, partId: PART, decision: "REJECT", reason: "scanner scenario -- not a real count" }), "reviewer rejects").line;
    assert.equal(disposed.status, "REJECTED");
    assert.equal(disposed.ledgerMovementId, undefined, "a rejection has no ledger effect");
    assert.equal(await movements(), ledgerBefore);
    for (const [label, who, key] of [["warehouse manager (reconcile only)", wm, "scn10-wm"], ["parts manager", pm, "scn10-pm"], ["parts associate (PA-1)", pa, "scn10-pa"], ["technician", techA, "scn10-tech"]]) {
      refused(await call(who, CC, "createCycleCountSheet", { location: W(WH), idempotencyKey: key }), 403, "CAPABILITY_MISSING", `${label} may not open a count`);
    }
  });

  // ═════════════ SCN-11 ═════════════
  await t.test("SCN-11 return intake: lands awaiting disposition, A RETURN RESTORES NOTHING, a typo is never coerced, only the intake clerk takes returns", async () => {
    const before = { movements: await movements(), balance: await balanceOf(pa, PART) };
    const input = { operatingCompanyId: "taylor", warehouseId: WH, partId: PART, source: "WORK_ORDER", sourceReference: "WO-SCN-11", condition: "OPENED", quantity: 2, idempotencyKey: "scn11-ret" };
    const r = ok(await call(wm, INV, "recordReturnIntake", input), "return intake");
    assert.deepEqual([r.outcome, r.state], ["recorded", "AWAITING_DISPOSITION"]);
    assert.equal(await movements(), before.movements, "A RETURN RESTORES NOTHING: no ledger row (DECISIONS #118)");
    assert.deepEqual(await balanceOf(pa, PART), before.balance, "...so the sellable balance is unchanged");
    assert.equal(ok(await call(wm, INV, "recordReturnIntake", input), "replay").outcome, "replayed");
    refused(await call(wm, INV, "recordReturnIntake", { ...input, quantity: 3 }), 409, "CONFLICT", "same key, different return");
    refused(await call(wm, INV, "recordReturnIntake", { ...input, condition: "SLIGHTLY_BENT", idempotencyKey: "scn11-bad" }), 400, "INVALID_INPUT", "a typo must never be coerced to UNKNOWN");
    refused(await call(pa, INV, "recordReturnIntake", { ...input, idempotencyKey: "scn11-pa" }), 403, "FORBIDDEN", "the parts floor cannot take returns");
    assert.equal(await count(`SELECT count(*)::int n FROM eos_ops.inventory_returns WHERE tenant_id = $1`, [TENANT]), 1, "one return, one row");
  });

  // ═════════════ SCN-12 ═════════════
  await t.test("SCN-12 technician scanner reachability: lookups reach the technician, and the shared Scan workspace confers no warehouse act", async () => {
    const bal = await balanceOf(techA, PART);
    assert.equal(bal.partId, PART, "field lookup reaches the technician");
    const scan = await catalog(techA, "lookupScannedPart", { rawValue: "0123456789012" });
    assert.deepEqual([scan.ok, scan.result.alias.result, scan.result.alias.partId], [true, "FOUND", PART], "and so does the barcode resolver");
    const before = await movements();
    for (const [route, op, input] of [
      [PLC, "recordPutAway", { warehouseId: WH, binCode: BIN_CODE, partId: PART, quantity: 1, idempotencyKey: "scn12-put" }],
      [CC, "createCycleCountSheet", { location: W(WH), idempotencyKey: "scn12-count" }],
      [TRF, "createTransfer", { partId: PART, quantity: 1, origin: W(WH), destination: W(WH2), idempotencyKey: "scn12-xfer" }],
      [TRF, "dispatchTransfer", { transferOrderId: "to-none" }],
    ]) {
      const r = await call(techA, route, op, input);
      assert.equal(r.status, 403, `a technician must not ${op}: ${JSON.stringify(r.body)}`);
    }
    assert.equal(await movements(), before, "no warehouse operation was inherited");
  });

  // ═════════════ SCN-13 ═════════════
  await t.test("SCN-13 technician incoming transfers: the server derives the truck, each technician sees exactly its own, receiving completes it", async () => {
    refused(await call(techA, INV, "listTransferOrders", { truckId: "mob-trk-2" }), 400, "INVALID_INPUT", "the caller cannot name a truck");
    refused(await call(pa, INV, "listTransferOrders", {}), 403, "FORBIDDEN", "no receive authority, no list");
    assert.deepEqual(ok(await call(techA, INV, "listTransferOrders", {}), "nothing yet").items, []);
    const roster = ok(await call(techA, INV, "listTruckRoster", {}), "own truck");
    assert.deepEqual([roster.scope, roster.trucks.map((x) => x.truckId)], ["OWN", ["trk-1"]], "the technician's own truck resolves, named by the server");

    const send = async (truck, key) => {
      const c = ok(await call(wa, TRF, "createTransfer", { partId: PART, quantity: 1, origin: W(WH), destination: M(truck), idempotencyKey: key }), `${key} create`);
      ok(await call(wa, TRF, "dispatchTransfer", { transferOrderId: c.transferOrderId }), `${key} dispatch`);
      return c.transferOrderId;
    };
    const toMine = await send("mob-trk-1", "scn13-mine");
    const toOther = await send("mob-trk-2", "scn13-other");
    const listA = ok(await call(techA, INV, "listTransferOrders", {}), "tech A list").items;
    assert.deepEqual(listA.map((i) => [i.transferOrderId, i.status, i.canReceive]), [[toMine, "IN_TRANSIT", true]], "exactly its own incoming transfer; another truck's is not visible");
    assert.deepEqual(ok(await call(techB, INV, "listTransferOrders", {}), "tech B list").items.map((i) => i.transferOrderId), [toOther]);
    refused(await call(techB, TRF, "receiveTransfer", { transferOrderId: toMine }), 403, "OUTSIDE_OPERATIONAL_SCOPE", "another truck's technician cannot receive it");

    assert.equal(ok(await call(techA, TRF, "receiveTransfer", { transferOrderId: toMine }), "receive").outcome, "applied", "received through the existing command");
    assert.equal(ok(await call(techA, TRF, "receiveTransfer", { transferOrderId: toMine }), "replay").outcome, "replayed");
    const after = ok(await call(techA, INV, "listTransferOrders", {}), "after").items;
    assert.deepEqual(after.filter((i) => i.canReceive), [], "a completed transfer leaves the receivable list");
    assert.equal(after.find((i) => i.transferOrderId === toMine).status, "COMPLETED");
    assert.deepEqual(ok(await call(techA, INV, "readTruckStock", { mobileLocationId: "mob-trk-1" }), "truck stock").quantities, [{ partId: PART, onHand: 1 }]);
    refused(await call(techA, INV, "readTruckStock", { mobileLocationId: "mob-trk-2" }), 404, "NOT_FOUND", "another technician's truck is not disclosed");
    // Put the other truck's stock where it was going, so no transfer is left in transit.
    ok(await call(techB, TRF, "receiveTransfer", { transferOrderId: toOther }), "tech B receives its own");
  });

  await t.test("the scenarios leave a coherent ledger: no negative quantity at any location", async () => {
    const bad = await count(`SELECT count(*)::int n FROM (SELECT 1 FROM eos_ops.inventory_movements WHERE tenant_id = $1 AND tracking_mode = 'NONE'
      GROUP BY part_id, location_type, location_id HAVING sum(quantity_delta) < 0) x`, [TENANT]);
    assert.equal(bad, 0);
  });
});
