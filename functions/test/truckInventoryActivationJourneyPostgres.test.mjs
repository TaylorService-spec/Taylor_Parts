// TRUCK INVENTORY ACTIVATION -- the PostgreSQL journey (Controller TRUCK INVENTORY ACTIVATION AUTHORIZED, 2026-10-01;
// OD-T1 .. OD-T7, Packages A-H).
//
// On a BASELINE-EQUAL tenant (support/serviceBaselineTenant.mjs), with the Equipment delta and the prepared Truck delta applied
// THROUGH ADMINISTRATION (truckInventoryActivationDelta.ts), every call over the REAL transports:
//
//   registry (Operational Configuration Administrator) -> MOBILE location + truck -> warehouse binding -> Employee MOBILE
//   scope -> Warehouse dispatches a governed Transfer into the truck -> the Technician receives it -> truck stock reads ->
//   the Technician consumes on its assigned Work Order (WORK_ORDER_CONSUMPTION, atomically, idempotently) -> the
//   Technician installs a serialized whole unit from the truck -> scanner lookup (alias) -> cycle-count stale refusal.
//
// And the ruled negatives -- wrong truck, wrong company, unassigned / ineligible / unscoped / revoked scope, inactive
// location, insufficient stock, replay, concurrency, receipt into MOBILE, persona refusals -- with stock proven coherent.
//
// Real PostgreSQL. Set POLICY_TEST_DATABASE_URL; without it the database half SKIPS.
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { HOUR, serviceBaselineTenant } from "./support/serviceBaselineTenant.mjs";
import { certifyInventoryBaselineFixture } from "./support/inventoryBaselineCertified.mjs";

const require = createRequire(import.meta.url);
const equipmentDelta = require("../lib/adminPolicy/equipmentActivationDelta.js");
const truckDelta = require("../lib/adminPolicy/truckInventoryActivationDelta.js");
const { executeAdminOperation } = require("../lib/adminPolicy/adminPolicyApi.js");
const { createMobileLocationScopeBindingAdministration } = require("../lib/eosOps/mobileLocationScopeBindingAdministration.js");
const { createWarehouseBinAdministration, isWarehouseAdminOperation } = require("../lib/eosOps/warehouseBinAdministration.js");
const { createTruckRegistryAdministration, isTruckRegistryAdminOperation } = require("../lib/eosOps/truckRegistryAdministration.js");
const workforceHttp = require("../lib/eosWorkforce/workforceHttp.js");
const { executeCatalogOperation } = require("../lib/catalogMaster/catalogHttp.js");
const aliasWriter = require("../lib/catalogMaster/postgresPartAliasWriter.js");
const cycle = require("../lib/eosOps/cycleCountOperations.js");
const { insertReceivingOrder } = require("../lib/eosOps/purchasingRepository.js");

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const TENANT = "t-truck";
const PREFIX = "trk";
const WH = "taylor-main";
const MODEL = "ACME--UNIT-100";
const WO = "/operations/work-orders", TR = "/operations/transfer", INV = "/operations/inventory";
const M = (id) => ({ type: "MOBILE", locationId: id });
const W = (id) => ({ type: "WAREHOUSE", locationId: id });

test("Truck Inventory activation over the governed transports", { skip: SKIP, concurrency: 1 }, async (t) => {
  const { q, admin, person, repo, pool, http } = await serviceBaselineTenant(t, { urlBase: URL_BASE, tenant: TENANT, prefix: PREFIX });
  const ADMIN_SUBJECT = `uid-${PREFIX}-admin`;
  const one = async (sql, v = []) => (await q(sql, v)).rows[0];
  const call = async (who, route, operation, input = {}) => {
    const res = await http.handleOperationsRequest({ reader: repo, pool, workOrderPostgresState: "ACTIVE",
      verifyToken: async (token) => ({ externalSubject: token, identityProvider: "firebase" }) },
    { method: "POST", url: route, headers: { authorization: `Bearer ${who.subject}` }, body: JSON.stringify({ operation, input }) });
    return { status: res.status, body: JSON.parse(res.body) };
  };
  const configuration = (() => {
    const bindings = createMobileLocationScopeBindingAdministration(pool);
    const warehouses = createWarehouseBinAdministration(pool);
    const trucks = createTruckRegistryAdministration(pool);
    return (operation, actor, input, reason) => (isWarehouseAdminOperation(operation) ? warehouses
      : isTruckRegistryAdminOperation(operation) ? trucks : bindings)(operation, actor, input, reason);
  })();
  const adminAs = (who, operation, input) => executeAdminOperation({ repo, configuration },
    { caller: { externalSubject: who.subject, identityProvider: "firebase" }, operation, input, requestId: `r-${randomUUID()}` });
  const workforce = async (who, operation, input) => {
    const res = await workforceHttp.handleWorkforceRequest({ reader: repo, pool, allowedOrigins: [],
      verifyToken: async (token) => ({ externalSubject: token, identityProvider: "firebase" }) },
    { method: "POST", url: "/workforce/employees", headers: { authorization: `Bearer ${who.subject}` }, body: JSON.stringify({ operation, input }) });
    return { status: res.status, body: JSON.parse(res.body) };
  };
  const catalog = async (who, operation, input) => executeCatalogOperation({ reader: repo, pool },
    { caller: { externalSubject: who.subject, identityProvider: "firebase", requestedTenantId: null }, operation, input });
  const ok = (r, what = "") => { assert.equal(r.status, 200, `${what} ${JSON.stringify(r.body)}`); return r.body.result; };
  const refused = (r, status, codes, what = "") => {
    assert.equal(r.status, status, `${what} ${JSON.stringify(r.body)}`);
    assert.ok([].concat(codes).includes(r.body.code), `${what}: code ${r.body.code} not in ${codes} ${JSON.stringify(r.body)}`);
  };
  const adminOk = (r, what = "") => { assert.equal(r.ok, true, `${what} ${JSON.stringify(r).slice(0, 400)}`); return r.data; };
  const adminRefused = (r, code, what = "") => assert.deepEqual([r.ok, r.code], [false, code], `${what} ${JSON.stringify(r).slice(0, 400)}`);
  const grants = async () => Number((await one(`SELECT count(*)::int n FROM eos_policy.role_capabilities WHERE tenant_id = $1`, [TENANT])).n);
  const holders = async (key) => (await q(`SELECT r.key FROM eos_policy.role_capabilities rc JOIN eos_policy.roles r ON r.id = rc.role_id
      JOIN eos_policy.capabilities c ON c.id = rc.capability_id WHERE rc.tenant_id = $1 AND c.key = $2 ORDER BY 1`, [TENANT, key])).rows.map((r) => r.key);
  const onHand = async (partId, type, id) => Number((await one(
    `SELECT COALESCE(SUM(quantity_delta),0)::int AS n FROM eos_ops.inventory_movements WHERE tenant_id=$1 AND part_id=$2 AND location_type=$3 AND location_id=$4`,
    [TENANT, partId, type, id])).n);
  const anyNegative = async () => Number((await one(`SELECT count(*)::int n FROM (SELECT 1 FROM eos_ops.inventory_movements WHERE tenant_id=$1
      AND tracking_mode='NONE' GROUP BY part_id, location_type, location_id HAVING sum(quantity_delta) < 0) x`, [TENANT])).n);

  // ── AUTHORITY: Equipment (already live) then the prepared Truck delta, exactly as the window issues it ──
  for (const { operation, input } of equipmentDelta.equipmentActivationOperations()) adminOk(await admin(operation, input), operation);
  // The live nonprod state before this package: the DQ-033 Role exists (created through Administration) holding
  // warehouse.record.manage; inventoryLookupReader exists.
  if (!(await repo.getRoleByKey(TENANT, "operationalConfigurationAdministrator"))) {
    adminOk(await admin("createRole", { key: "operationalConfigurationAdministrator", name: "Operational Configuration Administrator", reason: "DQ-033" }));
    adminOk(await admin("grantObjectActionToRole", { roleKey: "operationalConfigurationAdministrator", objectKey: "warehouse", actionKey: "manage", reason: "DQ-E" }));
  }
  assert.ok(await repo.getRoleByKey(TENANT, "inventoryLookupReader"), "the lookup composition exists in the seed");
  // Live nonprod transfer Roles (Inventory / Warehouse activation): operator = create / dispatch / cancel, receiver = receive.
  for (const [roleKey, actionKey] of [["inventoryTransferOperator", "create"], ["inventoryTransferOperator", "dispatch"], ["inventoryTransferOperator", "cancel"],
    ["inventoryTransferReceiver", "receive"]]) {
    if (!(await holders(`inventory.transfer.${actionKey}`)).includes(roleKey)) {
      adminOk(await admin("grantObjectActionToRole", { roleKey, objectKey: "transferOrder", actionKey, reason: "live nonprod transfer Roles" }), `${roleKey} ${actionKey}`);
    }
  }
  const before = await grants();
  for (const { operation, input } of truckDelta.truckInventoryActivationOperations()) adminOk(await admin(operation, input), `${operation} ${input.roleKey}`);
  assert.equal((await grants()) - before, 7, "the Truck delta is exactly seven grants");
  assert.deepEqual(await holders("inventory.truckRegistry.manage"), ["operationalConfigurationAdministrator"]);
  assert.deepEqual(await holders("inventory.location.scopeBinding.manage"), ["operationalConfigurationAdministrator"]);
  assert.ok((await holders("inventory.catalog.alias.read")).includes("inventoryLookupReader"));
  assert.equal((await holders("inventory.catalog.alias.read")).includes("owner"), false, "Owner does not resolve aliases by title");
  assert.equal((await holders("inventory.truckRegistry.manage")).includes("owner"), false, "Owner stays outside configuration authority");
  assert.deepEqual((await holders("inventory.workOrderConsumption.record")).filter((k) => k !== "admin"), ["technician"]);

  // ── people ──
  const techA = await person("uid-tech-a", ["technician", "equipmentInstaller", "inventoryLookupReader"], { id: "e-tech-a", name: "Finley Tech", technician: true });
  const techB = await person("uid-tech-b", ["technician", "equipmentInstaller", "inventoryLookupReader"], { id: "e-tech-b", name: "Gray Tech", technician: true });
  const techNoElig = await person("uid-tech-x", ["technician"], { id: "e-tech-x", name: "Rowan Helper" });
  const dispatcher = await person("uid-dispatch", ["dispatcher"], { id: "e-dispatch", name: "Emerson Dispatch" });
  const wa = await person("uid-wa", ["warehouseAssociate", "inventoryTransferOperator", "inventoryLookupReader"], { id: "e-wa", name: "Noor WA" });
  const wm = await person("uid-wm", ["warehouseManager", "inventoryTransferReceiver", "operationalConfigurationAdministrator", "inventoryLookupReader"], { id: "e-wm", name: "Morgan WM" });
  const pm = await person("uid-pm", ["partsManager"], { id: "e-pm", name: "Kai PM" });
  const general = await person("uid-general", [], { id: "e-general", name: "Gen Employee" });
  const adminWho = { subject: ADMIN_SUBJECT };
  for (const id of ["e-wa", "e-wm"]) {
    await q(`INSERT INTO eos_workforce.employee_work_eligibility (id,tenant_id,employee_id,qualification_code,effective_from,assigned_by,reason)
             VALUES ($1,$2,$3,'WAREHOUSE_OPERATIONS',now(),'fixture','fixture')`, [`we-wo-${id}`, TENANT, id]);
  }

  // ── masters: warehouses, catalog, customer + site, stock ──
  await q(`INSERT INTO eos_ops.warehouses (id, tenant_id, operating_company_key, name, site_label, status, provenance, created_by, updated_by)
           VALUES ($1,$2,'taylor','Taylor Main','Taylor Main','ACTIVE','NATIVE','fixture','fixture'),
                  ('ventana-wh',$2,'ventana','Ventana Depot','Ventana Depot','ACTIVE','NATIVE','fixture','fixture')`, [WH, TENANT]);
  await q(`INSERT INTO eos_ops.equipment_models (id, tenant_id, manufacturer_id, manufacturer_name, model_number, display_name, status, source_authority, version, created_by, updated_by)
           VALUES ($1,$2,'ACME','Acme','UNIT-100','Acme Unit 100','ACTIVE','fixture',1,'fixture','fixture')`, [MODEL, TENANT]);
  const part = (id, control, wholeUnit = false, modelId = null) => q(`INSERT INTO eos_ops.parts (id, tenant_id, created_by, internal_part_number, name, status, stocking_unit,
      control_type, stocking_class, expiry_tracked, consumable, returnable_core, whole_unit, equipment_model_id, version, updated_by)
      VALUES ($1,$2,'fixture',$1,$1,'ACTIVE','EACH',$3,'STOCKED',false,false,false,$4,$5,1,'fixture')`, [id, TENANT, control, wholeUnit, modelId]);
  await part("PRT-FILTER", "STANDARD");
  await part("PRT-GASKET", "STANDARD");
  await part("PRT-UNIT", "SERIALIZED", true, MODEL);
  let mv = 0;
  const receive = (partId, qty, type = "WAREHOUSE", loc = WH, company = "taylor") => q(`INSERT INTO eos_ops.inventory_movements (id, tenant_id, operating_company_key, part_id,
      tracking_mode, location_type, location_id, movement_type, quantity_delta, source_kind, source_id, created_by)
      VALUES ($1,$2,$3,$4,'NONE',$5,$6,'RECEIVED',$7,'FIXTURE','fixture','fixture')`, [`mov-fx-${++mv}`, TENANT, company, partId, type, loc, qty]);
  await receive("PRT-FILTER", 10);
  await receive("PRT-GASKET", 1);
  await q(`INSERT INTO eos_ops.serialized_custody (id, tenant_id, part_id, serial_number, status, location_type, location_id, operating_company_key, updated_by)
           VALUES ('cst-SN-T1',$1,'PRT-UNIT','SN-T1','AVAILABLE','WAREHOUSE',$2,'taylor','fixture')`, [TENANT, WH]);
  await q(`INSERT INTO eos_ops.inventory_movements (id, tenant_id, operating_company_key, part_id, tracking_mode, location_type, location_id,
             movement_type, quantity_delta, serial_number, source_kind, source_id, created_by)
           VALUES ('mov-fx-sn',$1,'taylor','PRT-UNIT','SERIAL','WAREHOUSE',$2,'RECEIVED',1,'SN-T1','FIXTURE','fixture','fixture')`, [TENANT, WH]);
  await q(`INSERT INTO eos_crm.accounts (id, tenant_id, name, status, created_by, updated_by) VALUES ('acct-r',$1,'acct-r','ACTIVE','fixture','fixture')`, [TENANT]);
  await q(`INSERT INTO eos_crm.account_locations (id, tenant_id, account_id, name, created_by, updated_by) VALUES ('loc-r1',$1,'acct-r','loc-r1','fixture','fixture')`, [TENANT]);
  await certifyInventoryBaselineFixture(q, TENANT);

  await t.test("OD-T7 REGISTRY: the Operational Configuration Administrator creates and links trucks through Administration", async () => {
    const reason = "Truck activation journey";
    // Without the registry capability: the Administrator, the Dispatcher, the Technician and the Owner-less general employee.
    for (const who of [adminWho, dispatcher, techA, general]) {
      adminRefused(await adminAs(who, "createMobileLocation", { locationId: "mob-nope", displayLabel: "Nope", operatingCompanyId: "taylor", reason }), "FORBIDDEN", who.subject);
    }
    adminRefused(await adminAs(wm, "createMobileLocation", { locationId: "mob-trk-1", displayLabel: "Truck 1", operatingCompanyId: "taylor" }), "INVALID_INPUT", "reason required");
    adminRefused(await adminAs(wm, "createMobileLocation", { locationId: "mob-x", displayLabel: "X", operatingCompanyId: "nobody", reason }), "CONFLICT", "ungoverned company");
    for (const [loc, label, co] of [["mob-trk-1", "Truck 1 stock", "taylor"], ["mob-trk-2", "Truck 2 stock", "taylor"], ["mob-trk-v", "Ventana truck stock", "ventana"]]) {
      adminOk(await adminAs(wm, "createMobileLocation", { locationId: loc, displayLabel: label, operatingCompanyId: co, reason }), loc);
    }
    adminOk(await adminAs(wm, "createTruck", { truckId: "trk-1", vehicleNumber: "T-101", displayLabel: "Taylor Truck 1", homeWarehouseId: WH, mobileLocationId: "mob-trk-1", reason }));
    adminOk(await adminAs(wm, "createTruck", { truckId: "trk-2", vehicleNumber: "T-102", displayLabel: "Taylor Truck 2", homeWarehouseId: WH, reason }));
    adminOk(await adminAs(wm, "linkTruck", { truckId: "trk-2", mobileLocationId: "mob-trk-2", reason }));
    adminRefused(await adminAs(wm, "linkTruck", { truckId: "trk-2", mobileLocationId: "mob-trk-1", reason }), "CONFLICT", "already linked");
    adminOk(await adminAs(wm, "createTruck", { truckId: "trk-v", vehicleNumber: "V-1", displayLabel: "Ventana Truck", homeWarehouseId: "ventana-wh", mobileLocationId: "mob-trk-v", reason }));
    const st = adminOk(await adminAs(wm, "changeTruckStatus", { truckId: "trk-2", status: "IDLE", reason }));
    assert.equal(st.truck.status, "IDLE");
    adminOk(await adminAs(wm, "changeTruckStatus", { truckId: "trk-2", status: "ACTIVE", reason }));
    adminRefused(await adminAs(wm, "changeTruckStatus", { truckId: "trk-2", status: "OUT_OF_SERVICE", reason }), "INVALID_INPUT", "deactivation is the guarded path");
    const list = adminOk(await adminAs(wm, "listTrucks", {}));
    assert.deepEqual(list.trucks.map((x) => x.truckId).sort(), ["trk-1", "trk-2", "trk-v"]);
    const audits = Number((await one(`SELECT count(*)::int n FROM eos_policy.audit_events WHERE tenant_id=$1 AND action LIKE 'truck.%' OR (tenant_id=$1 AND action = 'mobileLocation.created')`, [TENANT])).n);
    assert.ok(audits >= 8, `every registry change is audited (${audits})`);
  });

  await t.test("OD-T2 BINDING: the same Role binds trucks to their own company's warehouse (DQ-029)", async () => {
    const reason = "Truck scope binding";
    adminRefused(await adminAs(adminWho, "setMobileLocationScopeBinding", { locationId: "mob-trk-1", warehouseId: WH, reason }), "FORBIDDEN", "Administrator without the Role");
    adminOk(await adminAs(wm, "setMobileLocationScopeBinding", { locationId: "mob-trk-1", warehouseId: WH, reason }));
    adminOk(await adminAs(wm, "setMobileLocationScopeBinding", { locationId: "mob-trk-2", warehouseId: WH, reason }));
    adminRefused(await adminAs(wm, "setMobileLocationScopeBinding", { locationId: "mob-trk-v", warehouseId: WH, reason }), "CONFLICT", "cross-company binding");
  });

  await t.test("OD-T1 SCOPE: Employee MOBILE scope through the existing scope writer; company and target revalidated", async () => {
    const scope = (who, employeeId, scopeId) => workforce(who, "assignEmployeeOperationalScope", { employeeId, scopeType: "MOBILE", scopeId, reason: "truck assignment" });
    ok(await scope(adminWho, "e-tech-a", "mob-trk-1"), "tech A -> truck 1");
    ok(await scope(adminWho, "e-tech-b", "mob-trk-2"), "tech B -> truck 2");
    ok(await scope(adminWho, "e-tech-x", "mob-trk-1"), "an ineligible helper may ride along; eligibility still gates the operations");
    refused(await scope(adminWho, "e-tech-b", "mob-trk-v"), 412, ["MOBILE_LOCATION_COMPANY_MISMATCH"], "Taylor employee on a Ventana truck");
    refused(await scope(adminWho, "e-tech-b", "mob-none"), 404, ["MOBILE_LOCATION_NOT_FOUND"], "no such truck location");
    refused(await scope(techA, "e-tech-b", "mob-trk-1"), 403, ["CAPABILITY_REQUIRED"], "a Technician cannot assign trucks");
    // Many employees per truck is legitimate: two current scopes over mob-trk-1.
    assert.equal(Number((await one(`SELECT count(*)::int n FROM eos_workforce.employee_operational_scopes WHERE tenant_id=$1 AND scope_type='MOBILE' AND scope_id='mob-trk-1' AND effective_to IS NULL`, [TENANT])).n), 2);
  });

  let T1;
  await t.test("D TRANSFER: Warehouse dispatches into the truck; ONLY that truck's scoped Technician (or the warehouse path) receives", async () => {
    ok(await workforce(adminWho, "assignEmployeeOperationalScope", { employeeId: "e-wa", scopeType: "WAREHOUSE", scopeId: WH, reason: "warehouse scope" }), "warehouse scope");
    ok(await workforce(adminWho, "assignEmployeeOperationalScope", { employeeId: "e-wm", scopeType: "WAREHOUSE", scopeId: WH, reason: "warehouse scope" }), "warehouse scope");
    refused(await call(techA, TR, "createTransfer", { partId: "PRT-FILTER", origin: W(WH), destination: M("mob-trk-1"), quantity: 4, idempotencyKey: "tr-tech-create" }),
      403, "CAPABILITY_MISSING", "a Technician never creates a transfer");
    T1 = ok(await call(wa, TR, "createTransfer", { partId: "PRT-FILTER", origin: W(WH), destination: M("mob-trk-1"), quantity: 4, idempotencyKey: "tr-1" })).transferOrderId;
    ok(await call(wa, TR, "dispatchTransfer", { transferOrderId: T1 }), "dispatch");
    refused(await call(techB, TR, "receiveTransfer", { transferOrderId: T1 }), 403, "OUTSIDE_OPERATIONAL_SCOPE", "another truck's Technician");
    refused(await call(techNoElig, TR, "receiveTransfer", { transferOrderId: T1 }), 403, ["WORK_ELIGIBILITY_MISSING", "OUTSIDE_OPERATIONAL_SCOPE"], "no SERVICE_TECHNICIAN eligibility");
    refused(await call(dispatcher, TR, "receiveTransfer", { transferOrderId: T1 }), 403, "CAPABILITY_MISSING", "dispatcher");
    const inbound = ok(await call(techA, INV, "listTransferOrders", {}));
    assert.deepEqual(inbound.items.map((i) => [i.transferOrderId, i.canReceive]), [[T1, true]], "the Technician sees exactly its inbound transfer");
    assert.deepEqual(ok(await call(techB, INV, "listTransferOrders", {})).items, [], "and no one else's");
    const r = ok(await call(techA, TR, "receiveTransfer", { transferOrderId: T1 }));
    assert.equal(r.outcome, "applied");
    assert.equal(ok(await call(techA, TR, "receiveTransfer", { transferOrderId: T1 })).outcome, "replayed");
    assert.equal(await onHand("PRT-FILTER", "MOBILE", "mob-trk-1"), 4);
    assert.equal(await onHand("PRT-FILTER", "WAREHOUSE", WH), 6);
    // The warehouse path is unchanged: the Warehouse Manager (WAREHOUSE scope over the bound warehouse) receives into truck 2.
    const T2 = ok(await call(wa, TR, "createTransfer", { partId: "PRT-GASKET", origin: W(WH), destination: M("mob-trk-1"), quantity: 1, idempotencyKey: "tr-2" })).transferOrderId;
    ok(await call(wa, TR, "dispatchTransfer", { transferOrderId: T2 }));
    ok(await call(wm, TR, "receiveTransfer", { transferOrderId: T2 }), "warehouse receiver into a bound truck");
    // Serialized whole unit to the truck, received by its Technician.
    const T3 = ok(await call(wa, TR, "createTransfer", { partId: "PRT-UNIT", origin: W(WH), destination: M("mob-trk-1"), quantity: 1, serialNumbers: ["SN-T1"], idempotencyKey: "tr-3" })).transferOrderId;
    ok(await call(wa, TR, "dispatchTransfer", { transferOrderId: T3 }));
    ok(await call(techA, TR, "receiveTransfer", { transferOrderId: T3 }));
    assert.deepEqual(await one(`SELECT status::text s, location_type::text t, location_id l FROM eos_ops.serialized_custody WHERE tenant_id=$1 AND serial_number='SN-T1'`, [TENANT]),
      { s: "AVAILABLE", t: "MOBILE", l: "mob-trk-1" });
  });

  await t.test("C READS: a Technician sees its own truck and nothing else; the Dispatcher reads the roster, not stock", async () => {
    const mine = ok(await call(techA, INV, "listTruckRoster", {}));
    assert.equal(mine.scope, "OWN");
    assert.deepEqual(mine.trucks.map((x) => x.truckId), ["trk-1"]);
    const roster = ok(await call(dispatcher, INV, "listTruckRoster", {}));
    assert.equal(roster.scope, "TENANT");
    assert.deepEqual(roster.trucks.map((x) => x.truckId).sort(), ["trk-1", "trk-2", "trk-v"]);
    assert.deepEqual(roster.trucks.find((x) => x.truckId === "trk-1").scopedEmployeeIds, ["e-tech-a", "e-tech-x"]);
    const stock = ok(await call(techA, INV, "readTruckStock", { mobileLocationId: "mob-trk-1" }));
    assert.equal(stock.reach, "MOBILE_SCOPE");
    assert.deepEqual(stock.quantities, [{ partId: "PRT-FILTER", onHand: 4 }, { partId: "PRT-GASKET", onHand: 1 }]);
    assert.deepEqual(stock.serializedUnits.map((u) => u.serialNumber), ["SN-T1"]);
    refused(await call(techA, INV, "readTruckStock", { mobileLocationId: "mob-trk-2" }), 404, "NOT_FOUND", "another Technician's truck is not disclosed");
    refused(await call(techB, INV, "readTruckStock", { mobileLocationId: "mob-trk-1" }), 404, "NOT_FOUND");
    refused(await call(dispatcher, INV, "readTruckStock", { mobileLocationId: "mob-trk-1" }), 404, "NOT_FOUND", "dispatcher has no warehouse scope");
    assert.equal(ok(await call(wm, INV, "readTruckStock", { mobileLocationId: "mob-trk-1" })).reach, "WAREHOUSE_SCOPE");
    const position = ok(await call(techA, INV, "readInventoryOnHand", {}));
    assert.deepEqual(position.scopedWarehouseIds, []);
    assert.deepEqual([...new Set(position.rows.map((r) => r.locationId))], ["mob-trk-1"], "on-hand: the truck only, never the warehouse");
    const locs = ok(await call(techA, INV, "listInventoryLocations", {}));
    assert.deepEqual(locs.items.map((i) => [i.type, i.locationId]), [["MOBILE", "mob-trk-1"]]);
    assert.ok(ok(await call(wa, INV, "listInventoryLocations", {})).items.some((i) => i.type === "MOBILE" && i.locationId === "mob-trk-2"),
      "a warehouse operator resolves the trucks bound to its warehouse (transfer destinations)");
  });

  // ── Work Orders ──
  const ROUND_THE_CLOCK = Object.fromEntries(["0", "1", "2", "3", "4", "5", "6"].map((d) => [d, [{ start: "00:00", end: "24:00" }]]));
  for (const employeeId of ["e-tech-a", "e-tech-b"]) {
    ok(await call(dispatcher, WO, "setTechnicianWorkingHours", { employeeId, timeZone: "UTC", weeklyHours: ROUND_THE_CLOCK, reason: "fixture availability" }), "hours");
  }
  let slot = 0;
  const workOrder = async ({ type = "SERVICE_CALL", tech = techA, emp = "e-tech-a", plan = [] } = {}) => {
    const id = ok(await call(dispatcher, WO, "createWorkOrder", { operatingCompanyId: "taylor", customerId: "acct-r", locationId: "loc-r1", workOrderType: type, priority: 2 }), "create").workOrderId;
    ok(await call(dispatcher, WO, "markWorkOrderReady", { workOrderId: id }), "ready");
    ok(await call(dispatcher, WO, "setWorkOrderPartsPlan", { workOrderId: id, plan }), "plan");
    const start = Date.now() + 2 * 24 * HOUR + (++slot) * 2 * HOUR;
    ok(await call(dispatcher, WO, "scheduleWorkOrder", { workOrderId: id, employeeId: emp, scheduledStart: start, scheduledEnd: start + HOUR }), "schedule");
    ok(await call(dispatcher, WO, "dispatchWorkOrder", { workOrderId: id }), "dispatch");
    ok(await call(tech, WO, "acceptWorkOrder", { workOrderId: id }), "accept");
    for (const op of ["startWorkOrderTravel", "arriveAtWorkOrder", "startWorkOrderWork"]) ok(await call(tech, WO, op, { workOrderId: id }), op);
    return id;
  };
  const cancel = async (id) => ok(await call(dispatcher, WO, "cancelWorkOrder", { workOrderId: id, expectedStatus: "WORK_IN_PROGRESS", note: "fixture case done" }), "cancel");
  const use = (who, workOrderId, key, partUsage, consumeFrom = M("mob-trk-1")) =>
    call(who, WO, "recordWorkOrderExecution", { workOrderId, idempotencyKey: key, partUsage, ...(consumeFrom ? { consumeFrom } : {}) });

  await t.test("E CONSUMPTION: usage from the scoped truck posts WORK_ORDER_CONSUMPTION atomically; every ruled refusal holds", async () => {
    const woA = await workOrder({ plan: [{ partId: "PRT-FILTER", qtyPlanned: 3 }, { partId: "PRT-GASKET", qtyPlanned: 5 }, { partId: "PRT-UNIT", qtyPlanned: 1 }] });
    const r = ok(await use(techA, woA, "use-1", [{ partId: "PRT-FILTER", qtyDelta: 2 }]));
    assert.equal(r.inventoryBoundary, "TRUCK_CONSUMPTION");
    assert.ok(r.usage[0].movementId, "the line names its ledger row");
    const mvRow = await one(`SELECT movement_type, quantity_delta, location_type::text lt, location_id, source_kind, source_id FROM eos_ops.inventory_movements WHERE tenant_id=$1 AND id=$2`, [TENANT, r.usage[0].movementId]);
    assert.deepEqual(mvRow, { movement_type: "WORK_ORDER_CONSUMPTION", quantity_delta: -2, lt: "MOBILE", location_id: "mob-trk-1", source_kind: "WORK_ORDER_TRUCK_CONSUMPTION", source_id: woA });
    assert.equal(await onHand("PRT-FILTER", "MOBILE", "mob-trk-1"), 2);
    // Replay: same key, same request -> the original outcome, nothing moves.
    assert.equal(ok(await use(techA, woA, "use-1", [{ partId: "PRT-FILTER", qtyDelta: 2 }])).outcome, "REPLAYED");
    assert.equal(await onHand("PRT-FILTER", "MOBILE", "mob-trk-1"), 2, "a replay never consumes twice");
    refused(await use(techA, woA, "use-1", [{ partId: "PRT-FILTER", qtyDelta: 1 }]), 409, "IDEMPOTENCY_KEY_REUSED");
    // Wrong truck / unassigned / ineligible / dispatcher / wrong location type.
    refused(await use(techA, woA, "neg-truck", [{ partId: "PRT-FILTER", qtyDelta: 1 }], M("mob-trk-2")), 403, "OUTSIDE_OPERATIONAL_SCOPE", "wrong truck");
    refused(await use(techA, woA, "neg-ventana", [{ partId: "PRT-FILTER", qtyDelta: 1 }], M("mob-trk-v")), 403, "OUTSIDE_OPERATIONAL_SCOPE", "wrong company's truck");
    refused(await use(techB, woA, "neg-unassigned", [{ partId: "PRT-FILTER", qtyDelta: 1 }], M("mob-trk-2")), 403, "NOT_ASSIGNED", "unassigned Technician");
    refused(await use(dispatcher, woA, "neg-dispatch", [{ partId: "PRT-FILTER", qtyDelta: 1 }]), 403, "CAPABILITY_MISSING", "dispatcher");
    refused(await use(techA, woA, "neg-wh", [{ partId: "PRT-FILTER", qtyDelta: 1 }], W(WH)), 400, "CONSUME_FROM_NOT_MOBILE", "warehouse issue is not a Technician act");
    // Insufficient stock (truck holds 1 gasket), serialized parts, a correction below what was consumed.
    refused(await use(techA, woA, "neg-qty", [{ partId: "PRT-GASKET", qtyDelta: 3 }]), 412, "INSUFFICIENT_TRUCK_STOCK", "never negative");
    refused(await use(techA, woA, "neg-serial", [{ partId: "PRT-UNIT", qtyDelta: 1 }]), 412, "SERIALIZED_CONSUMPTION_NOT_SUPPORTED");
    refused(await use(techA, woA, "neg-correct", [{ partId: "PRT-FILTER", qtyDelta: -1 }], null), 412, "USAGE_BELOW_CONSUMED");
    // An inactive truck location, then a revoked scope: each closes the path for the NEXT operation.
    await q(`UPDATE eos_ops.mobile_locations SET active = false WHERE tenant_id=$1 AND location_id='mob-trk-1'`, [TENANT]);
    refused(await use(techA, woA, "neg-inactive", [{ partId: "PRT-FILTER", qtyDelta: 1 }]), 412, "MOBILE_LOCATION_INACTIVE");
    await q(`UPDATE eos_ops.mobile_locations SET active = true WHERE tenant_id=$1 AND location_id='mob-trk-1'`, [TENANT]);
    ok(await workforce(adminWho, "endEmployeeOperationalScope", { employeeId: "e-tech-a", scopeType: "MOBILE", scopeId: "mob-trk-1", reason: "truck change" }), "end scope");
    refused(await use(techA, woA, "neg-revoked", [{ partId: "PRT-FILTER", qtyDelta: 1 }]), 403, "OUTSIDE_OPERATIONAL_SCOPE", "revoked scope");
    assert.equal(await onHand("PRT-FILTER", "MOBILE", "mob-trk-1"), 2, "and the history stands: nothing already recorded changed");
    ok(await workforce(adminWho, "assignEmployeeOperationalScope", { employeeId: "e-tech-a", scopeType: "MOBILE", scopeId: "mob-trk-1", reason: "back on truck 1" }));
    assert.equal(await anyNegative(), 0);
    assert.equal(await onHand("PRT-FILTER", "MOBILE", "mob-trk-1"), 2, "every refusal moved nothing");

    // CONCURRENCY: two different requests for the last units race -- exactly one consumes; never negative.
    const raced = await Promise.all([
      use(techA, woA, "race-a", [{ partId: "PRT-GASKET", qtyDelta: 1 }]),
      use(techA, woA, "race-b", [{ partId: "PRT-GASKET", qtyDelta: 1 }]),
    ]);
    assert.deepEqual(raced.map((x) => x.status).sort(), [200, 412], JSON.stringify(raced.map((x) => x.body)));
    assert.equal(await onHand("PRT-GASKET", "MOBILE", "mob-trk-1"), 0);
    // Same-key race: one record, one movement.
    const same = await Promise.all([1, 2].map(() => use(techA, woA, "race-same", [{ partId: "PRT-FILTER", qtyDelta: 1 }])));
    assert.ok(same.some((x) => x.status === 200), JSON.stringify(same.map((x) => x.body)));
    assert.equal(await onHand("PRT-FILTER", "MOBILE", "mob-trk-1"), 1, "the same key consumed once");
    assert.equal(await anyNegative(), 0);
    await cancel(woA);
  });

  await t.test("F INSTALL FROM TRUCK: the scoped, assigned installer installs a whole unit from its truck; others cannot", async () => {
    const wo = await workOrder({ type: "INSTALL" });
    const listed = ok(await call(techA, WO, "listInstallableEquipmentForWorkOrder", { workOrderId: wo }));
    assert.deepEqual(listed.units.map((u) => [u.serialNumber, u.locationType, u.locationLabel]), [["SN-T1", "MOBILE", "Truck 1 stock"]]);
    const res = ok(await call(techA, WO, "recordWorkOrderEquipmentInstall", { workOrderId: wo, partId: "PRT-UNIT", serialNumber: "SN-T1", idempotencyKey: "inst-1", equipmentName: "Unit from truck" }));
    assert.equal(res.outcome, "installed");
    assert.deepEqual(await one(`SELECT movement_type, quantity_delta, location_type::text lt, location_id FROM eos_ops.inventory_movements WHERE tenant_id=$1 AND id=$2`, [TENANT, res.movementId]),
      { movement_type: "WORK_ORDER_CONSUMPTION", quantity_delta: -1, lt: "MOBILE", location_id: "mob-trk-1" });
    assert.equal((await one(`SELECT location_type::text t FROM eos_ops.serialized_custody WHERE tenant_id=$1 AND serial_number='SN-T1'`, [TENANT])).t, "EQUIPMENT");
    assert.equal(ok(await call(techA, WO, "recordWorkOrderEquipmentInstall", { workOrderId: wo, partId: "PRT-UNIT", serialNumber: "SN-T1", idempotencyKey: "inst-1", equipmentName: "Unit from truck" })).outcome, "replayed");
    ok(await call(techA, WO, "completeWorkOrder", { workOrderId: wo }), "complete");
  });

  await t.test("OD-T5 RECEIPT INTO A TRUCK IS REFUSED -- by the writer and by the table", async () => {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await assert.rejects(insertReceivingOrder(c, TENANT, "fixture", "taylor", { id: "rcv-x", receivedAt: new Date(), sourceKind: "PURCHASE_ORDER",
        purchaseOrderId: "po-x", receivingLocation: { type: "MOBILE", id: "mob-trk-1" }, status: "CHECKED_IN", idempotencyKey: "rcv-x",
        lines: [{ lineId: "l1", partId: "PRT-FILTER", trackingMode: "NONE", expectedQuantity: 1, receivedQuantity: 1 }] }), (e) => e.code === "RECEIPT_TO_MOBILE_REFUSED");
      await c.query("ROLLBACK");
    } finally { c.release(); }
    await assert.rejects(q(`INSERT INTO eos_ops.receiving_orders (id, tenant_id, operating_company_key, source_kind, source_purchase_order_id, receiving_location_type,
        receiving_location_id, status, idempotency_key, received_at, created_by, updated_by)
        VALUES ('rcv-sql',$1,'taylor','PURCHASE_ORDER','po-sql','MOBILE','mob-trk-1','CHECKED_IN','rcv-sql',now(),'fixture','fixture')`, [TENANT]),
      /receiving_destination_not_mobile/);
  });

  await t.test("G SCANNER: the lookup composition resolves an alias in the corrected contract; catalog-only callers see aliasDenied", async () => {
    const created = await aliasWriter.createPartAlias({ pool }, { tenantId: TENANT, principalId: pm.principalId, capabilities: new Set(["inventory.catalog.manage"]) },
      { partId: "PRT-FILTER", aliasType: "UPC", rawValue: "012345678905" });
    assert.ok(created);
    const byAlias = await catalog(techA, "lookupScannedPart", { rawValue: "012345678905" });
    assert.equal(byAlias.ok, true, JSON.stringify(byAlias));
    assert.equal(byAlias.result.aliasDenied, false);
    assert.equal(byAlias.result.alias.result, "FOUND");
    assert.deepEqual(byAlias.result.parts.map((p) => [p.id, p.data.partId, p.data.internalPartNumber]), [["PRT-FILTER", "PRT-FILTER", "PRT-FILTER"]]);
    const byCode = await catalog(dispatcher, "lookupScannedPart", { rawValue: "prt-filter", partCode: "prt-filter" });
    assert.equal(byCode.ok, true, JSON.stringify(byCode));
    assert.deepEqual([byCode.result.aliasDenied, byCode.result.alias, byCode.result.parts.map((p) => p.id)], [true, null, ["PRT-FILTER"]],
      "catalog read without alias read: own-code half only, and it says so");
    const denied = await catalog(general, "lookupScannedPart", { rawValue: "012345678905" });
    assert.deepEqual([denied.ok, denied.code], [false, "FORBIDDEN"]);
    const extra = await catalog(techA, "lookupScannedPart", { rawValue: "x", manufacturerId: "y" });
    assert.deepEqual([extra.ok, extra.code], [false, "INVALID_INPUT"]);
  });

  await t.test("H CYCLE COUNT: a variance measured before stock moved is refused as stale under the shared lock", async () => {
    const caps = (extra) => new Set(["inventory.cycleCount.create", "inventory.cycleCount.submit", "inventory.cycleCount.reconcile", "inventory.cycleCount.close", ...extra]);
    const actorOf = (who) => ({ tenantId: TENANT, principalId: who.principalId, capabilities: caps([]) });
    const deps = { pool, postgresState: "ACTIVE" };
    const sheet = await cycle.createEosCycleCountSheet(deps, actorOf(wa), { location: W(WH), idempotencyKey: "cc-1" });
    const sheetId = sheet.sheet?.sheetId ?? sheet.sheetId;
    await cycle.openEosCycleCountLine(deps, actorOf(wa), { sheetId, partId: "PRT-FILTER" });
    const expected = await onHand("PRT-FILTER", "WAREHOUSE", WH);
    await cycle.submitEosCycleCountLine(deps, actorOf(wa), { sheetId, partId: "PRT-FILTER", countedQuantity: expected - 1 });
    // Stock moves out of the counted location after the snapshot.
    const T = ok(await call(wa, TR, "createTransfer", { partId: "PRT-FILTER", origin: W(WH), destination: M("mob-trk-2"), quantity: 1, idempotencyKey: "tr-cc" })).transferOrderId;
    ok(await call(wa, TR, "dispatchTransfer", { transferOrderId: T }));
    await assert.rejects(cycle.reconcileEosCycleCountLine(deps, actorOf(wm), { sheetId, partId: "PRT-FILTER", decision: "APPROVE", reason: "count variance" }),
      (e) => e.code === "COUNT_STALE");
    assert.equal(await onHand("PRT-FILTER", "WAREHOUSE", WH), expected - 1, "the stale variance was not posted on top of the transfer");
    assert.equal(await anyNegative(), 0);
  });
});
