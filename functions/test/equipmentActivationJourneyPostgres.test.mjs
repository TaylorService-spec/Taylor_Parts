// EQUIPMENT ACTIVATION -- the PostgreSQL journey (Controller EQUIPMENT ACTIVATION AUTHORIZED, 2026-10-01; OD-1 .. OD-5).
//
// On a BASELINE-EQUAL tenant (support/serviceBaselineTenant.mjs), with the prepared Equipment delta applied THROUGH
// ADMINISTRATION (equipmentActivationDelta.ts), every call over the REAL Operations transport:
//
//   serialized whole unit in WAREHOUSE / BIN custody (ledger-coherent) -> customer + site (CRM) -> register create / update
//   (Office Manager) -> INSTALL Work Order -> assigned Technician (equipmentInstaller) -> installation: ledger
//   WORK_ORDER_CONSUMPTION -1 at the source, custody EQUIPMENT, the Equipment record, work_orders.equipment_id, the
//   INSTALLED event -- in ONE transaction -> Service references the Equipment afterwards.
//
// And the ruled negatives: replay / conflicting replay / duplicate install / concurrency / wrong company, customer, site,
// Work Order type and state / unassigned Technician / unauthorized personas / truck source -- with source stock and
// custody proven coherent after EVERY refusal.
//
// Real PostgreSQL. Set POLICY_TEST_DATABASE_URL; without it the database half SKIPS.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { HOUR, serviceBaselineTenant } from "./support/serviceBaselineTenant.mjs";
import { certifyInventoryBaselineFixture } from "./support/inventoryBaselineCertified.mjs";

const require = createRequire(import.meta.url);
const equipmentDelta = require("../lib/adminPolicy/equipmentActivationDelta.js");

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const TENANT = "t-equipment";
const WH = "taylor-main";
const BIN = "bin_" + "a".repeat(40);
const MODEL = "ACME--UNIT-100";
const EQ = "/operations/equipment", WO = "/operations/work-orders";

test("Equipment activation over the Operations transport", { skip: SKIP, concurrency: 1 }, async (t) => {
  const { q, admin, person, repo, pool, http } = await serviceBaselineTenant(t, { urlBase: URL_BASE, tenant: TENANT, prefix: "eqp" });
  const one = async (sql, v = []) => (await q(sql, v)).rows[0];
  const call = async (who, route, operation, input = {}, extra = {}) => {
    const res = await http.handleOperationsRequest({ reader: repo, pool, workOrderPostgresState: "ACTIVE", ...extra,
      verifyToken: async (token) => ({ externalSubject: token, identityProvider: "firebase" }) },
    { method: "POST", url: route, headers: { authorization: `Bearer ${who.subject}` }, body: JSON.stringify({ operation, input }) });
    return { status: res.status, body: JSON.parse(res.body) };
  };
  const ok = (r, what = "") => { assert.equal(r.status, 200, `${what} ${JSON.stringify(r.body)}`); return r.body.result; };
  const refused = (r, status, codes, what = "") => {
    assert.equal(r.status, status, `${what} ${JSON.stringify(r.body)}`);
    assert.ok([].concat(codes).includes(r.body.code), `${what}: code ${r.body.code} not in ${codes} ${JSON.stringify(r.body)}`);
  };
  const grants = async () => Number((await one(`SELECT count(*)::int n FROM eos_policy.role_capabilities WHERE tenant_id = $1`, [TENANT])).n);
  const holders = async (key) => (await q(`SELECT r.key FROM eos_policy.role_capabilities rc JOIN eos_policy.roles r ON r.id = rc.role_id
      JOIN eos_policy.capabilities c ON c.id = rc.capability_id WHERE rc.tenant_id = $1 AND c.key = $2 ORDER BY 1`, [TENANT, key])).rows.map((r) => r.key);

  // ── the sales channels this tenant sells through (the Lane GA value source for a salesChannel scope) ──
  for (const ch of ["RETAIL", "NATIONAL_ACCOUNTS"]) {
    await q(`INSERT INTO eos_policy.tenant_sales_channels (tenant_id, sales_channel, status, source, established_by, updated_by)
             VALUES ($1, $2, 'ACTIVE', 'fixture', 'fixture', 'fixture')`, [TENANT, ch]);
  }

  // ── AUTHORITY: the prepared delta, exactly as the activation window issues it, through Administration ──
  const before = await grants();
  for (const { operation, input } of equipmentDelta.equipmentActivationOperations()) {
    const r = await admin(operation, input);
    assert.equal(r.ok, true, `${operation} ${JSON.stringify(input).slice(0, 120)} ${JSON.stringify(r).slice(0, 300)}`);
  }
  const added = (await grants()) - before;

  // ── people, as the nonprod personas hold their Security Roles (+ the delta's assignments) ──
  const techA = await person("uid-tech-a", ["technician", "equipmentInstaller"], { id: "e-tech-a", name: "Finley Tech", technician: true });
  const techB = await person("uid-tech-b", ["technician", "equipmentInstaller"], { id: "e-tech-b", name: "Gray Tech", technician: true });
  const techPlain = await person("uid-tech-c", ["technician"], { id: "e-tech-c", name: "Oakley Contract", technician: true });
  const dispatcher = await person("uid-dispatch", ["dispatcher"], { id: "e-dispatch", name: "Emerson Dispatch" });
  const serviceManager = await person("uid-sm", ["fieldManager"], { id: "e-sm", name: "Devon SM" });
  const office = await person("uid-office", ["officeManager", "equipmentRegisterManager"], { id: "e-office", name: "Casey Office" });
  const pa = await person("uid-pa", ["partsAssociate", "inventoryReceivingClerk"], { id: "e-pa", name: "Logan PA" });
  const pm = await person("uid-pm", ["partsManager", "purchasingManager"], { id: "e-pm", name: "Kai PM" });
  const wa = await person("uid-wa", ["warehouseAssociate"], { id: "e-wa", name: "Noor WA" });
  const wm = await person("uid-wm", ["warehouseManager"], { id: "e-wm", name: "Morgan WM" });
  const general = await person("uid-general", [], { id: "e-general", name: "Gen Employee" });
  const owner = await person("uid-owner", [], { id: "e-owner", name: "Owen Owner" });
  await repo.transact({ tenantId: TENANT, uid: "fixture" }, async (tx) => {  // the protected Owner Role, as a fixture assignment
    const accessVersion = await tx.bumpAccessVersion(owner.principalId);
    return tx.createAssignment({ principalId: owner.principalId, roleId: (await repo.getRoleByKey(TENANT, "owner")).id, scopeType: "global", scopeValue: null,
      status: "active", grantedBy: "fixture", grantedAt: new Date().toISOString(), accessVersionAtGrant: accessVersion });
  });
  const seller = async (subject, channel, id) => {
    const p = await person(subject, [], { id, name: subject });  // the live global commercialSharedContext confers no Equipment read
    const r = await admin("assignRole", { principalId: p.principalId, roleId: (await repo.getRoleByKey(TENANT, "salesperson")).id,
      scopeType: "salesChannel", scopeValue: channel, reason: "seller in one channel" });
    assert.equal(r.ok, true, JSON.stringify(r).slice(0, 300));
    return p;
  };
  const retail = await seller("uid-retail", "RETAIL", "e-retail");
  const national = await seller("uid-national", "NATIONAL_ACCOUNTS", "e-national");

  // ── masters: CRM customers + sites, commercial work per channel, the warehouse, the catalog ──
  const account = (id, status) => q(`INSERT INTO eos_crm.accounts (id, tenant_id, name, status, created_by, updated_by) VALUES ($1,$2,$1,$3,'fixture','fixture')`, [id, TENANT, status]);
  const site = (id, acct) => q(`INSERT INTO eos_crm.account_locations (id, tenant_id, account_id, name, created_by, updated_by) VALUES ($1,$2,$3,$1,'fixture','fixture')`, [id, TENANT, acct]);
  await account("acct-r", "ACTIVE"); await site("loc-r1", "acct-r"); await site("loc-r2", "acct-r");
  await account("acct-n", "ACTIVE"); await site("loc-n", "acct-n");
  await account("acct-x", "INACTIVE"); await site("loc-x", "acct-x");
  let opp = 0;
  const opportunity = (acct, channel) => q(`INSERT INTO eos_commercial.opportunities (id, tenant_id, opportunity_number, account_id, owner_employee_id, sales_channel, created_by, updated_by)
      VALUES ($1,$2,$1,$3,'e-retail',$4,'fixture','fixture')`, [`opp-${++opp}`, TENANT, acct, channel]);
  await opportunity("acct-r", "RETAIL");
  await opportunity("acct-n", "NATIONAL_ACCOUNTS");

  await q(`INSERT INTO eos_ops.warehouses (id, tenant_id, operating_company_key, name, site_label, status, provenance, created_by, updated_by)
           VALUES ($1,$2,'taylor','Taylor Main','Taylor Main','ACTIVE','NATIVE','fixture','fixture'),
                  ('ventana-wh',$2,'ventana','Ventana Depot','Ventana Depot','ACTIVE','NATIVE','fixture','fixture')`, [WH, TENANT]);
  await q(`INSERT INTO eos_ops.bins (id, tenant_id, warehouse_id, area, aisle, bay, position, code, status, idempotency_key, created_by, updated_by)
           VALUES ($1,$2,$3,'MAIN','A',1,1,'MAIN-A-1-1','ACTIVE','bin-fixture','fixture','fixture')`, [BIN, TENANT, WH]);
  await q(`INSERT INTO eos_ops.equipment_models (id, tenant_id, manufacturer_id, manufacturer_name, model_number, display_name, status, source_authority, version, created_by, updated_by)
           VALUES ($1,$2,'ACME','Acme','UNIT-100','Acme Unit 100','ACTIVE','fixture',1,'fixture','fixture'),
                  ('ACME--UNIT-OLD',$2,'ACME','Acme','UNIT-OLD','Acme Unit Old','RETIRED','fixture',1,'fixture','fixture')`, [MODEL, TENANT]);
  const part = (id, wholeUnit, modelId = null) => q(`INSERT INTO eos_ops.parts (id, tenant_id, created_by, internal_part_number, name, status, stocking_unit,
      control_type, stocking_class, expiry_tracked, consumable, returnable_core, whole_unit, equipment_model_id, version, updated_by)
      VALUES ($1,$2,'fixture',$1,$1,'ACTIVE','EACH','SERIALIZED','STOCKED',false,false,false,$3,$4,1,'fixture')`, [id, TENANT, wholeUnit, modelId]);
  await part("PRT-UNIT", true, MODEL);
  await part("PRT-COMP", false);
  // A unit: custody + its ledger receipt (+1 at the same location), unless `ledger` is false (an incoherent unit).
  let mv = 0;
  const unit = async (partId, serial, type, location, company = "taylor", ledger = true) => {
    await q(`INSERT INTO eos_ops.serialized_custody (id, tenant_id, part_id, serial_number, status, location_type, location_id, operating_company_key, updated_by)
             VALUES ($1,$2,$3,$4,'AVAILABLE',$5,$6,$7,'fixture')`, [`cst-${serial}`, TENANT, partId, serial, type, location, company]);
    if (ledger) {
      await q(`INSERT INTO eos_ops.inventory_movements (id, tenant_id, operating_company_key, part_id, tracking_mode, location_type, location_id,
                 movement_type, quantity_delta, serial_number, source_kind, source_id, created_by)
               VALUES ($1,$2,$3,$4,'SERIAL',$5,$6,'RECEIVED',1,$7,'FIXTURE','fixture','fixture')`, [`mov-fx-${++mv}`, TENANT, company, partId, type, location, serial]);
    }
  };
  await unit("PRT-UNIT", "SN-1", "WAREHOUSE", WH);
  await unit("PRT-UNIT", "SN-2", "BIN", BIN);
  await unit("PRT-UNIT", "SN-3", "MOBILE", "truck-1");
  await unit("PRT-UNIT", "SN-4", "WAREHOUSE", "ventana-wh", "ventana");
  await unit("PRT-UNIT", "SN-5", "WAREHOUSE", WH, "taylor", false);
  await unit("PRT-COMP", "SN-C1", "WAREHOUSE", WH);
  await unit("PRT-UNIT", "SN-6", "BIN", BIN);

  // ── Work Orders: created by the Service Office, driven to the state a case needs ──
  const ROUND_THE_CLOCK = Object.fromEntries(["0", "1", "2", "3", "4", "5", "6"].map((d) => [d, [{ start: "00:00", end: "24:00" }]]));
  for (const employeeId of ["e-tech-a", "e-tech-b", "e-tech-c"]) {
    ok(await call(dispatcher, WO, "setTechnicianWorkingHours", { employeeId, timeZone: "UTC", weeklyHours: ROUND_THE_CLOCK, reason: "fixture availability" }), "hours");
  }
  let slot = 0;
  const workOrder = async ({ type = "INSTALL", customerId = "acct-r", locationId = "loc-r1", tech = techA, emp = "e-tech-a", to = "WORK_IN_PROGRESS", equipmentId } = {}) => {
    const id = ok(await call(dispatcher, WO, "createWorkOrder", { operatingCompanyId: "taylor", customerId, locationId, workOrderType: type, priority: 2,
      ...(equipmentId ? { equipmentId } : {}) }), "create").workOrderId;
    if (to === "CREATED") return id;
    ok(await call(dispatcher, WO, "markWorkOrderReady", { workOrderId: id }), "ready");
    ok(await call(dispatcher, WO, "setWorkOrderPartsPlan", { workOrderId: id, plan: [] }), "plan");
    const start = Date.now() + 2 * 24 * HOUR + (++slot) * 2 * HOUR;
    ok(await call(dispatcher, WO, "scheduleWorkOrder", { workOrderId: id, employeeId: emp, scheduledStart: start, scheduledEnd: start + HOUR }), "schedule");
    if (to === "SCHEDULED") return id;
    ok(await call(dispatcher, WO, "dispatchWorkOrder", { workOrderId: id }), "dispatch");
    ok(await call(tech, WO, "acceptWorkOrder", { workOrderId: id }), "accept");
    for (const op of ["startWorkOrderTravel", "arriveAtWorkOrder", "startWorkOrderWork"]) ok(await call(tech, WO, op, { workOrderId: id }), op);
    return id;
  };
  // A technician holds ONE active Work Order at a time (DOUBLE_BOOKED), so every case releases its own.
  const cancel = async (id, from = "WORK_IN_PROGRESS") => ok(await call(dispatcher, WO, "cancelWorkOrder", { workOrderId: id, expectedStatus: from, note: "fixture case done" }), "cancel");
  const complete = async (id, tech = techA) => ok(await call(tech, WO, "completeWorkOrder", { workOrderId: id }), "complete");

  // ── the coherence probe, run after every refusal: nothing moved that should not have ──
  const totals = async () => one(`SELECT
      (SELECT count(*)::int FROM eos_ops.inventory_movements WHERE tenant_id = $1) AS movements,
      (SELECT count(*)::int FROM eos_ops.equipment WHERE tenant_id = $1) AS equipment,
      (SELECT count(*)::int FROM eos_ops.equipment_events WHERE tenant_id = $1) AS events,
      (SELECT count(*)::int FROM eos_ops.serialized_custody WHERE tenant_id = $1 AND status = 'INSTALLED') AS installed,
      (SELECT count(*)::int FROM eos_ops.work_orders WHERE tenant_id = $1 AND equipment_id IS NOT NULL) AS linked`, [TENANT]);
  const net = async (serial, type, location) => Number((await one(`SELECT COALESCE(SUM(quantity_delta),0)::int n FROM eos_ops.inventory_movements
      WHERE tenant_id = $1 AND serial_number = $2 AND location_type = $3 AND location_id = $4`, [TENANT, serial, type, location])).n);
  const custodyOf = async (serial) => one(`SELECT status::text AS status, location_type::text AS location_type, location_id FROM eos_ops.serialized_custody
      WHERE tenant_id = $1 AND serial_number = $2`, [TENANT, serial]);
  const assertUntouched = async (snapshot, what) => {
    assert.deepEqual(await totals(), snapshot, `${what}: nothing written`);
    assert.deepEqual(await custodyOf("SN-6"), { status: "AVAILABLE", location_type: "BIN", location_id: BIN }, `${what}: SN-6 custody`);
    assert.equal(await net("SN-6", "BIN", BIN), 1, `${what}: SN-6 ledger`);
  };

  await t.test("1. AUTHORITY: the delta lands through Administration -- and only what was ruled", async () => {
    assert.equal(added, 9, "equipment.install x1 + equipment.record.read x7 + equipment.record.manage x1");
    assert.deepEqual(await holders("equipment.install"), ["admin", "equipmentInstaller"].sort(), "admin is the catalog compatibility Role; the installer Role is the operational one");
    assert.deepEqual(await holders("equipment.record.read"), [...equipmentDelta.EQUIPMENT_READ_ROLES].sort());
    assert.deepEqual(await holders("equipment.record.manage"), ["equipmentRegisterManager"]);
    const managerRole = await one(`SELECT r.id FROM eos_policy.roles r WHERE r.tenant_id = $1 AND r.key = 'equipmentRegisterManager'`, [TENANT]);
    const composition = (await q(`SELECT c.key FROM eos_policy.role_capabilities rc JOIN eos_policy.capabilities c ON c.id = rc.capability_id
        WHERE rc.tenant_id = $1 AND rc.role_id = $2`, [TENANT, managerRole.id])).rows.map((r) => r.key);
    assert.deepEqual(composition, ["equipment.record.manage"], "the narrow Role carries nothing else");
    for (const role of ["warehouseAssociate", "warehouseManager", "technician"]) {
      assert.ok(!(await holders("equipment.record.read")).includes(role), `${role} holds no register read`);
    }
    for (const key of ["equipment.install", "equipment.record.manage"]) assert.ok(!(await holders(key)).includes("owner"), `Owner holds no ${key}`);
    // Object Security represents all three on the `equipment` Object.
    const caps = (await q(`SELECT key, object_key, action_key, action_kind FROM eos_policy.capabilities WHERE object_key = 'equipment' ORDER BY key`)).rows;
    assert.deepEqual(caps.map((c) => `${c.key}=${c.object_key}.${c.action_key}:${c.action_kind}`),
      ["equipment.install=equipment.install:BUSINESS_ACTION", "equipment.record.manage=equipment.manage:EDIT", "equipment.record.read=equipment.read:READ"]);
    // ADMINISTRATION CONFORMANCE, read back THROUGH Administration (the Object Security surface): the equipment Object
    // carries all three actions, and every ruled holder is an ordinary ADMIN_GRANTED cell an administrator can change.
    const objects = await admin("listObjectsWithActions", {});
    assert.equal(objects.ok, true, JSON.stringify(objects).slice(0, 300));
    const eqObject = objects.data.find((o) => o.key === "equipment");
    assert.ok(eqObject, "the equipment Object is registered for this tenant");
    assert.deepEqual(eqObject.actions.map((a) => a.actionKey).sort(), ["install", "manage", "read"]);
    const matrix = await admin("getObjectActionGrantMatrix", { objectKey: "equipment" });
    assert.equal(matrix.ok, true, JSON.stringify(matrix).slice(0, 300));
    const cell = (actionKey, roleKey) => matrix.data.actions.find((a) => a.actionKey === actionKey)?.roles.find((r) => r.roleKey === roleKey);
    for (const roleKey of equipmentDelta.EQUIPMENT_READ_ROLES) assert.equal(cell("read", roleKey)?.source, "ADMIN_GRANTED", `read ${roleKey}`);
    assert.equal(cell("manage", "equipmentRegisterManager")?.source, "ADMIN_GRANTED");
    assert.equal(cell("install", "equipmentInstaller")?.source, "ADMIN_GRANTED");
    for (const [actionKey, roleKey] of [["read", "warehouseAssociate"], ["read", "technician"], ["manage", "owner"], ["install", "owner"], ["manage", "technician"]]) {
      assert.notEqual(cell(actionKey, roleKey)?.source, "ADMIN_GRANTED", `${roleKey} ${actionKey}`);
    }
  });

  await t.test("2. FAIL CLOSED: register NOT_ACTIVATED when the constant is not ACTIVE; install NOT_ACTIVATED before the baseline is certified", async () => {
    refused(await call(serviceManager, EQ, "listEquipment", {}, { equipmentPostgresState: "INACTIVE" }), 503, "NOT_ACTIVATED", "register inactive");
    const wo = await workOrder();
    const snap = await totals();
    refused(await call(techA, WO, "recordWorkOrderEquipmentInstall", { workOrderId: wo, partId: "PRT-UNIT", serialNumber: "SN-6", idempotencyKey: "pre-cert", equipmentName: "Unit" }),
      503, "NOT_ACTIVATED", "install before certification");
    await assertUntouched(snap, "pre-certification");
    await cancel(wo);
    await certifyInventoryBaselineFixture(q, TENANT);
  });

  let registered;
  await t.test("3. REGISTER CREATE: the Office Manager registers a customer machine; the relationships fail closed", async () => {
    const input = { operatingCompanyId: "taylor", accountId: "acct-r", customerLocationId: "loc-r2", name: "Walk-in Cooler", equipmentModelId: MODEL,
      serialNumber: "CUST-1", assetTag: "AT-1", installedOn: "2024-05-01", idempotencyKey: "reg-1" };
    assert.deepEqual(ok(await call(office, EQ, "listEquipmentOperatingCompanies", {})).items.map((c) => c.operatingCompanyId), ["taylor", "ventana"]);
    refused(await call(dispatcher, EQ, "listEquipmentOperatingCompanies", {}), 403, "CAPABILITY_MISSING", "the choice is the manager's");
    const created = ok(await call(office, EQ, "createEquipment", input), "create");
    assert.equal(created.outcome, "created");
    registered = created.equipment;
    assert.equal(registered.version, 1);
    assert.deepEqual([registered.accountId, registered.customerLocation.id, registered.operatingCompanyKey, registered.equipmentModelId, registered.installedFrom],
      ["acct-r", "loc-r2", "taylor", MODEL, null]);
    assert.deepEqual(created.events.map((e) => [e.eventType, e.source, e.actorPrincipalId]), [["CREATED", "EOS_COMMAND", office.principalId]]);
    const replay = ok(await call(office, EQ, "createEquipment", input), "replay");
    assert.equal(replay.outcome, "replayed");
    assert.equal(replay.equipment.id, registered.id);
    const snap = await totals();
    refused(await call(office, EQ, "createEquipment", { ...input, name: "Different" }), 409, "IDEMPOTENCY_CONFLICT", "conflicting replay");
    refused(await call(office, EQ, "createEquipment", { ...input, idempotencyKey: "reg-dup" }), 409, "DUPLICATE_SERIAL", "same model + serial");
    refused(await call(office, EQ, "createEquipment", { ...input, serialNumber: "CUST-9", customerLocationId: "loc-n", idempotencyKey: "reg-site" }), 412, "CUSTOMER_SITE_MISMATCH", "another customer's site");
    refused(await call(office, EQ, "createEquipment", { ...input, serialNumber: "CUST-9", accountId: "acct-x", customerLocationId: "loc-x", idempotencyKey: "reg-inactive" }), 412, "CUSTOMER_NOT_ACTIVE", "inactive customer");
    refused(await call(office, EQ, "createEquipment", { ...input, serialNumber: "CUST-9", accountId: "acct-missing", idempotencyKey: "reg-missing" }), 404, "CUSTOMER_NOT_FOUND", "unknown customer");
    refused(await call(office, EQ, "createEquipment", { ...input, serialNumber: "CUST-9", operatingCompanyId: "acme", idempotencyKey: "reg-co" }), 412, ["OPERATING_COMPANY_KEY_NOT_BOUND", "OPERATING_COMPANY_NOT_GOVERNED", "OPERATING_COMPANY_UNKNOWN"], "ungoverned company");
    refused(await call(office, EQ, "createEquipment", { ...input, serialNumber: "CUST-9", equipmentModelId: "ACME--UNIT-OLD", idempotencyKey: "reg-model" }), 412, "MODEL_NOT_ACTIVE", "retired model");
    for (const [who, what] of [[dispatcher, "dispatcher"], [serviceManager, "service manager"], [techA, "technician"], [owner, "owner"], [pa, "parts"], [retail, "retail"], [general, "general"]]) {
      refused(await call(who, EQ, "createEquipment", { ...input, idempotencyKey: `reg-${what}` }), 403, "CAPABILITY_MISSING", `${what} create`);
    }
    assert.deepEqual(await totals(), snap, "no refusal wrote anything");
  });

  await t.test("4. REGISTER UPDATE: versioned, diffed into history; customer / site / company are fixed", async () => {
    const r = ok(await call(office, EQ, "updateEquipment", { equipmentId: registered.id, expectedVersion: 1, changes: { name: "Walk-in Cooler #1", notes: "rear door" }, reason: "survey" }), "update");
    assert.equal(r.equipment.version, 2);
    assert.equal(r.equipment.name, "Walk-in Cooler #1");
    const upd = r.events.find((e) => e.eventType === "UPDATED");
    assert.deepEqual(upd.changes, { name: { from: "Walk-in Cooler", to: "Walk-in Cooler #1" }, notes: { from: null, to: "rear door" } });
    assert.equal(upd.reason, "survey");
    refused(await call(office, EQ, "updateEquipment", { equipmentId: registered.id, expectedVersion: 1, changes: { name: "stale" } }), 409, "VERSION_CONFLICT", "stale version");
    refused(await call(office, EQ, "updateEquipment", { equipmentId: registered.id, expectedVersion: 2, changes: { accountId: "acct-n" } }), 400, "FIELD_NOT_EDITABLE", "customer is fixed");
    refused(await call(serviceManager, EQ, "updateEquipment", { equipmentId: registered.id, expectedVersion: 2, changes: { name: "x" } }), 403, "CAPABILITY_MISSING", "SM update");
    await assert.rejects(q(`UPDATE eos_ops.equipment_events SET reason = 'rewritten' WHERE tenant_id = $1`, [TENANT]), /EQUIPMENT_EVENTS_APPEND_ONLY/);
  });

  await t.test("5. READ AUTHORITY: operational readers see the register; sellers only their channel's customers; others nothing", async () => {
    // A National Accounts machine too, so the channel split is observable.
    const nat = ok(await call(office, EQ, "createEquipment", { operatingCompanyId: "taylor", accountId: "acct-n", customerLocationId: "loc-n", name: "Ice Machine", idempotencyKey: "reg-nat" }), "nat").equipment;
    for (const [who, what] of [[serviceManager, "SM"], [dispatcher, "dispatcher"], [office, "office"], [owner, "owner"], [pa, "PA"], [pm, "PM"]]) {
      const ids = ok(await call(who, EQ, "listEquipment", {}), what).equipment.map((e) => e.id).sort();
      assert.deepEqual(ids, [registered.id, nat.id].sort(), `${what} reads the register`);
    }
    const retailList = ok(await call(retail, EQ, "listEquipment", {}), "retail");
    assert.deepEqual([retailList.reach, retailList.equipment.map((e) => e.id)], ["SALES_CHANNEL", [registered.id]]);
    assert.deepEqual(ok(await call(national, EQ, "listEquipment", {}), "national").equipment.map((e) => e.id), [nat.id]);
    refused(await call(retail, EQ, "readEquipment", { equipmentId: nat.id }), 404, "EQUIPMENT_NOT_FOUND", "outside the channel reads as absent");
    ok(await call(national, EQ, "readEquipment", { equipmentId: nat.id }), "national reads its own");
    for (const [who, what] of [[wa, "WA"], [wm, "WM"], [techA, "technician"], [general, "general"]]) {
      refused(await call(who, EQ, "listEquipment", {}), 403, "CAPABILITY_MISSING", `${what} list`);
      refused(await call(who, EQ, "readEquipment", { equipmentId: registered.id }), 403, "CAPABILITY_MISSING", `${what} read`);
    }
    // search, by customer, by site, by serial -- the filters narrow inside the reach, never widen it.
    assert.deepEqual(ok(await call(dispatcher, EQ, "listEquipment", { search: "cooler" })).equipment.map((e) => e.id), [registered.id]);
    assert.deepEqual(ok(await call(dispatcher, EQ, "listEquipment", { accountId: "acct-n" })).equipment.map((e) => e.id), [nat.id]);
    assert.deepEqual(ok(await call(dispatcher, EQ, "listEquipment", { customerLocationId: "loc-r2" })).equipment.map((e) => e.id), [registered.id]);
    assert.deepEqual(ok(await call(dispatcher, EQ, "listEquipment", { serialNumber: "CUST-1" })).equipment.map((e) => e.id), [registered.id]);
    assert.deepEqual(ok(await call(retail, EQ, "listEquipment", { accountId: "acct-n" })).equipment, [], "a seller's filter cannot widen the reach");
    const detail = ok(await call(dispatcher, EQ, "readEquipment", { equipmentId: registered.id }));
    assert.deepEqual([detail.equipment.accountName, detail.equipment.customerLocationName, detail.installedUnit], ["acct-r", "loc-r2", null]);
    const page1 = ok(await call(dispatcher, EQ, "listEquipment", { limit: 1 }));
    const page2 = ok(await call(dispatcher, EQ, "listEquipment", { limit: 1, cursor: page1.nextCursor }));
    assert.equal(page1.equipment.length + page2.equipment.length, 2);
    assert.notEqual(page1.equipment[0].id, page2.equipment[0].id);
  });

  await t.test("6. WORK ORDER INTEGRITY: a referenced Equipment is proven -- exists, ACTIVE, same company, customer, site", async () => {
    const mk = (over) => call(dispatcher, WO, "createWorkOrder", { operatingCompanyId: "taylor", customerId: "acct-r", locationId: "loc-r2", workOrderType: "SERVICE_CALL", priority: 2, ...over });
    const snap = await totals();
    const woCount = async () => Number((await one(`SELECT count(*)::int n FROM eos_ops.work_orders WHERE tenant_id = $1`, [TENANT])).n);
    const n0 = await woCount();
    refused(await mk({ equipmentId: "eq_nonexistent" }), 404, "EQUIPMENT_NOT_FOUND", "unknown");
    refused(await mk({ equipmentId: registered.id, customerId: "acct-n", locationId: "loc-n" }), 412, "EQUIPMENT_CUSTOMER_MISMATCH", "wrong customer");
    refused(await mk({ equipmentId: registered.id, locationId: "loc-r1" }), 412, "EQUIPMENT_SITE_MISMATCH", "wrong site");
    refused(await mk({ equipmentId: registered.id, operatingCompanyId: "ventana" }), 412, "EQUIPMENT_COMPANY_MISMATCH", "wrong company");
    const retired = ok(await call(office, EQ, "createEquipment", { operatingCompanyId: "taylor", accountId: "acct-r", customerLocationId: "loc-r2", name: "Old Fryer", idempotencyKey: "reg-old" })).equipment;
    ok(await call(office, EQ, "updateEquipment", { equipmentId: retired.id, expectedVersion: 1, changes: { status: "RETIRED" } }), "retire");
    refused(await mk({ equipmentId: retired.id }), 412, "EQUIPMENT_NOT_ACTIVE", "retired");
    assert.equal(await woCount(), n0, "no refused create left a Work Order");
    const good = ok(await mk({ equipmentId: registered.id }), "valid reference");
    const woRow = await one(`SELECT equipment_id FROM eos_ops.work_orders WHERE tenant_id = $1 AND id = $2`, [TENANT, good.workOrderId]);
    assert.equal(woRow.equipment_id, registered.id);
    assert.equal((await totals()).movements, snap.movements);
  });

  let installWo, installed;
  await t.test("7. INSTALL: one transaction -- ledger out of the source, EQUIPMENT custody, the record, the Work Order link, the event", async () => {
    installWo = await workOrder();
    const list = ok(await call(techA, WO, "listInstallableEquipmentForWorkOrder", { workOrderId: installWo }), "installable");
    assert.deepEqual(list.units.map((u) => u.serialNumber), ["SN-1", "SN-2", "SN-5", "SN-6"],
      "taylor whole units in WAREHOUSE / BIN only -- not the truck unit, the Ventana unit or the component");
    const before = await totals();
    const r = ok(await call(techA, WO, "recordWorkOrderEquipmentInstall", { workOrderId: installWo, partId: "PRT-UNIT", serialNumber: "SN-1",
      idempotencyKey: "install-1", equipmentName: "Reach-in Freezer", notes: "set on the line" }), "install");
    installed = r;
    assert.equal(r.outcome, "installed");
    // the ledger consequence: the unit LEFT company-held stock at its source
    const mvRow = await one(`SELECT movement_type::text AS t, quantity_delta AS d, location_type::text AS lt, location_id AS l, source_kind, source_id, serial_number, operating_company_key
        FROM eos_ops.inventory_movements WHERE tenant_id = $1 AND id = $2`, [TENANT, r.movementId]);
    assert.deepEqual(mvRow, { t: "WORK_ORDER_CONSUMPTION", d: -1, lt: "WAREHOUSE", l: WH, source_kind: "WORK_ORDER_EQUIPMENT_INSTALL", source_id: installWo, serial_number: "SN-1", operating_company_key: "taylor" });
    assert.equal(await net("SN-1", "WAREHOUSE", WH), 0, "on-hand at the source decreased");
    assert.deepEqual(await custodyOf("SN-1"), { status: "INSTALLED", location_type: "EQUIPMENT", location_id: r.equipment.id });
    assert.deepEqual([r.equipment.accountId, r.equipment.customerLocation.id, r.equipment.operatingCompanyKey, r.equipment.equipmentModelId, r.equipment.serialNumber, r.equipment.installedFrom],
      ["acct-r", "loc-r1", "taylor", MODEL, "SN-1", { namespace: "OPS_LOCATION", type: "WAREHOUSE", id: WH }], "customer / site / company from the Work Order; model from the catalog Part");
    assert.equal((await one(`SELECT equipment_id FROM eos_ops.work_orders WHERE tenant_id = $1 AND id = $2`, [TENANT, installWo])).equipment_id, r.equipment.id);
    const ev = await one(`SELECT event_type, work_order_id, part_id, serial_number, ledger_movement_id, source, actor_principal_id, account_id, customer_location_id, operating_company_key
        FROM eos_ops.equipment_events WHERE tenant_id = $1 AND id = $2`, [TENANT, r.eventId]);
    assert.deepEqual(ev, { event_type: "INSTALLED", work_order_id: installWo, part_id: "PRT-UNIT", serial_number: "SN-1", ledger_movement_id: r.movementId,
      source: "WORK_ORDER_INSTALL", actor_principal_id: techA.principalId, account_id: "acct-r", customer_location_id: "loc-r1", operating_company_key: "taylor" });
    const after = await totals();
    assert.deepEqual(after, { movements: before.movements + 1, equipment: before.equipment + 1, events: before.events + 1, installed: before.installed + 1, linked: before.linked + 1 });

    // REPLAY returns the ORIGINAL result and writes nothing
    const again = ok(await call(techA, WO, "recordWorkOrderEquipmentInstall", { workOrderId: installWo, partId: "PRT-UNIT", serialNumber: "SN-1",
      idempotencyKey: "install-1", equipmentName: "Reach-in Freezer", notes: "set on the line" }), "replay");
    assert.deepEqual([again.outcome, again.equipment.id, again.movementId, again.eventId], ["replayed", r.equipment.id, r.movementId, r.eventId]);
    assert.deepEqual(await totals(), after, "a replay duplicates nothing");
    // CONFLICTING replay, a second unit on the same Work Order, and the Technician's own read of THIS Work Order's Equipment
    refused(await call(techA, WO, "recordWorkOrderEquipmentInstall", { workOrderId: installWo, partId: "PRT-UNIT", serialNumber: "SN-6", idempotencyKey: "install-1", equipmentName: "x" }),
      409, "IDEMPOTENCY_CONFLICT", "same key, different unit");
    refused(await call(techA, WO, "recordWorkOrderEquipmentInstall", { workOrderId: installWo, partId: "PRT-UNIT", serialNumber: "SN-6", idempotencyKey: "install-2", equipmentName: "x" }),
      412, "WORK_ORDER_ALREADY_HAS_EQUIPMENT", "one installation per INSTALL Work Order");
    await assertUntouched(after, "after the install refusals");
    const mine = ok(await call(techA, EQ, "readWorkOrderEquipment", { workOrderId: installWo }), "technician reads its Work Order's Equipment");
    assert.deepEqual([mine.equipment.id, mine.installedUnit.serialNumber, mine.events.map((e) => e.eventType)], [r.equipment.id, "SN-1", ["INSTALLED"]]);
    refused(await call(techB, EQ, "readWorkOrderEquipment", { workOrderId: installWo }), 403, "NOT_ASSIGNED", "another technician");
    refused(await call(wa, EQ, "readWorkOrderEquipment", { workOrderId: installWo }), 403, "CAPABILITY_MISSING", "warehouse");
    const desk = ok(await call(serviceManager, EQ, "readEquipment", { equipmentId: r.equipment.id }), "SM reads the installed record");
    assert.deepEqual([desk.installedUnit.partId, desk.events.map((e) => e.eventType)], ["PRT-UNIT", ["INSTALLED"]]);
    await complete(installWo);  // install first, then complete -- and the installation stands
    assert.equal((await one(`SELECT status::text AS s, equipment_id FROM eos_ops.work_orders WHERE tenant_id = $1 AND id = $2`, [TENANT, installWo])).equipment_id, r.equipment.id);
  });

  await t.test("8. NEGATIVES: every ruled refusal, and source stock / custody coherent after each", async () => {
    const assigned = await workOrder();
    const snap = await totals();
    const attempt = (who, wo, serial, k, extra = {}) => call(who, WO, "recordWorkOrderEquipmentInstall",
      { workOrderId: wo, partId: extra.partId ?? "PRT-UNIT", serialNumber: serial, idempotencyKey: k, equipmentName: "Unit" });
    refused(await attempt(techB, assigned, "SN-6", "neg-unassigned"), 403, "NOT_ASSIGNED", "unassigned installer");
    refused(await attempt(owner, assigned, "SN-6", "neg-owner"), 403, "CAPABILITY_MISSING", "owner cannot install");
    refused(await attempt(office, assigned, "SN-6", "neg-office"), 403, "CAPABILITY_MISSING", "register manager cannot install");
    refused(await attempt(dispatcher, assigned, "SN-6", "neg-dispatch"), 403, "CAPABILITY_MISSING", "dispatcher");
    refused(await attempt(wa, assigned, "SN-6", "neg-wa"), 403, "CAPABILITY_MISSING", "warehouse");
    refused(await attempt(techA, assigned, "SN-3", "neg-truck"), 403, "OUTSIDE_OPERATIONAL_SCOPE", "MOBILE source without the truck path (Package F: eligibility + MOBILE scope)");
    refused(await attempt(techA, assigned, "SN-4", "neg-company"), 412, "OPERATING_COMPANY_MISMATCH", "Ventana unit on a Taylor Work Order");
    refused(await attempt(techA, assigned, "SN-C1", "neg-comp", { partId: "PRT-COMP" }), 412, "PART_NOT_WHOLE_UNIT", "component");
    refused(await attempt(techA, assigned, "SN-5", "neg-ledger"), 412, "LEDGER_INTEGRITY", "custody without its ledger");
    refused(await attempt(techA, assigned, "SN-1", "neg-dup"), 412, "ALREADY_INSTALLED_ELSEWHERE", "duplicate install of an installed unit");
    refused(await attempt(techA, assigned, "SN-404", "neg-missing"), 412, "UNIT_NOT_FOUND", "unknown serial");
    await assertUntouched(snap, "persona / source / unit negatives");
    await cancel(assigned);

    const plain = await workOrder({ tech: techPlain, emp: "e-tech-c" });
    refused(await attempt(techPlain, plain, "SN-6", "neg-plain"), 403, "CAPABILITY_MISSING", "assigned technician without equipmentInstaller");
    await cancel(plain);
    const service = await workOrder({ type: "SERVICE_CALL" });
    refused(await attempt(techA, service, "SN-6", "neg-type"), 412, "WORK_ORDER_NOT_INSTALL", "wrong Work Order type");
    await cancel(service);
    const scheduled = await workOrder({ to: "SCHEDULED" });
    refused(await attempt(techA, scheduled, "SN-6", "neg-state"), 412, "WORK_ORDER_STATE_INVALID", "wrong Work Order state");
    await cancel(scheduled, "SCHEDULED");
    const wrongSite = await workOrder({ locationId: "loc-n" });
    refused(await attempt(techA, wrongSite, "SN-6", "neg-site"), 412, "CUSTOMER_SITE_MISMATCH", "site is another customer's");
    await cancel(wrongSite);
    const inactive = await workOrder({ customerId: "acct-x", locationId: "loc-x" });
    refused(await attempt(techA, inactive, "SN-6", "neg-inactive"), 412, "CUSTOMER_NOT_ACTIVE", "inactive customer");
    await cancel(inactive);
    const linkedSnap = await totals();
    await assertUntouched(linkedSnap, "Work Order negatives");
    assert.deepEqual({ ...linkedSnap }, { ...snap }, "no Work Order negative wrote ledger, custody, Equipment, link or event");
  });

  await t.test("9. CONCURRENCY: two Work Orders racing for one unit -- exactly one installs; a same-key race installs once", async () => {
    const [w1, w2] = [await workOrder(), await workOrder({ tech: techB, emp: "e-tech-b" })];
    const snap = await totals();
    const race = await Promise.all([[w1, techA], [w2, techB]].map(([wo, tech], i) => call(tech, WO, "recordWorkOrderEquipmentInstall",
      { workOrderId: wo, partId: "PRT-UNIT", serialNumber: "SN-2", idempotencyKey: `race-${i}`, equipmentName: "Raced Unit" })));
    assert.deepEqual(race.map((r) => r.status).sort(), [200, 412], JSON.stringify(race.map((r) => r.body)));
    assert.equal(race.find((r) => r.status === 412).body.code, "ALREADY_INSTALLED_ELSEWHERE");
    assert.equal(await net("SN-2", "BIN", BIN), 0, "exactly one -1 at the source");
    assert.equal(Number((await one(`SELECT count(*)::int n FROM eos_ops.inventory_movements WHERE tenant_id = $1 AND serial_number = 'SN-2' AND quantity_delta = -1`, [TENANT])).n), 1);
    const afterRace = await totals();
    assert.deepEqual(afterRace, { movements: snap.movements + 1, equipment: snap.equipment + 1, events: snap.events + 1, installed: snap.installed + 1, linked: snap.linked + 1 });
    const won = race[0].status === 200 ? 0 : 1;
    await complete([w1, w2][won], [techA, techB][won]);
    await cancel([w1, w2][1 - won]);

    const w3 = await workOrder();
    const same = await Promise.all([0, 1].map(() => call(techA, WO, "recordWorkOrderEquipmentInstall",
      { workOrderId: w3, partId: "PRT-UNIT", serialNumber: "SN-6", idempotencyKey: "same-key", equipmentName: "Twice-sent" })));
    assert.deepEqual(same.map((r) => r.status), [200, 200], JSON.stringify(same.map((r) => r.body)));
    assert.deepEqual(same.map((r) => r.body.result.outcome).sort(), ["installed", "replayed"]);
    assert.equal(same[0].body.result.movementId, same[1].body.result.movementId);
    assert.deepEqual(await totals(), { movements: afterRace.movements + 1, equipment: afterRace.equipment + 1, events: afterRace.events + 1,
      installed: afterRace.installed + 1, linked: afterRace.linked + 1 });
    await complete(w3);
  });

  await t.test("10. SERVICE AFTERWARDS: a Service Work Order references the installed Equipment; the register shows its history", async () => {
    const svc = ok(await call(dispatcher, WO, "createWorkOrder", { operatingCompanyId: "taylor", customerId: "acct-r", locationId: "loc-r1",
      workOrderType: "SERVICE_CALL", priority: 2, equipmentId: installed.equipment.id }), "service call on the installed machine");
    const detail = ok(await call(dispatcher, WO, "readWorkOrder", { workOrderId: svc.workOrderId }), "read");
    assert.equal(JSON.stringify(detail).includes(installed.equipment.id), true, "the Work Order carries the Equipment");
    const avail = ok(await call(pa, EQ, "listAvailableEquipmentUnits", {}), "available units");
    assert.deepEqual(avail.units.map((u) => u.serialNumber).sort(), ["SN-4", "SN-5"],
      "installed units left the available list; the truck unit and the component never appear");
    assert.deepEqual(avail.units.find((u) => u.serialNumber === "SN-5").warehouseName, "Taylor Main");
    refused(await call(dispatcher, EQ, "listAvailableEquipmentUnits", {}), 403, "CAPABILITY_MISSING", "available units need inventory.serializedAsset.read");
  });
});
