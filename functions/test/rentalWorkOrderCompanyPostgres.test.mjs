// A10 (follow-ups to DWO-company, #2200): Rental's Work Order reads and the Employee record's assigned work, over real PostgreSQL.
//   RETURN   a foreign, a nonexistent and a wrong-agreement returnWorkOrderId on a DEPLOYED assignment give ONE deep-equal RETURN_WORK_ORDER_MISMATCH and leave the
//            assignment DEPLOYED; the same-agreement in-reach Work Order succeeds.
//   REACH    a caller with Rental reach but no reach to the agreement's INSTALL Work Order gets the agreement with empty workOrders, and the going-out unit with an
//            empty Work Order column (never the foreign number or status).
//   ASSIGNED listAssignedWorkForEmployee agrees with My Work: a foreign-company Work Order the CALLER is assigned to is listed; one it is not assigned to is not.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { serviceBaselineTenant, HOUR } from "./support/serviceBaselineTenant.mjs";
import { certifyInventoryBaselineFixture } from "./support/inventoryBaselineCertified.mjs";

const require = createRequire(import.meta.url);
const assignedWork = require("../lib/eosWorkforce/reads/assignedWorkReads.js");
const equipmentDelta = require("../lib/adminPolicy/equipmentActivationDelta.js");

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const TENANT = "t-rental-wo";
const RNT = "/operations/rental", WO = "/operations/work-orders";
const WH = "taylor-main", MODEL = "ACME--RENT-100";
const day = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

test("A10: Rental Work Order company reach and assigned work, in PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  const { q, admin, person, pool, call } = await serviceBaselineTenant(t, { urlBase: URL_BASE, tenant: TENANT, prefix: "rwo" });
  const one = async (sql, v = []) => (await q(sql, v)).rows[0];
  const ok = (r, what = "") => { assert.equal(r.status, 200, `${what} ${JSON.stringify(r.body).slice(0, 700)}`); return r.body.result; };
  const rn = (who, operation, input) => call(who, RNT, operation, input);
  let k = 0;
  const key = (s) => `${s}-${++k}`;

  for (const { operation, input } of equipmentDelta.equipmentActivationOperations()) assert.equal((await admin(operation, input)).ok, true, operation);
  const gm = await person("uid-gm", ["generalManager"], { id: "e-gm", name: "Gale GM" });
  const dispatcher = await person("uid-dispatch", ["dispatcher"], { id: "e-dispatch", name: "Emerson Dispatch" });
  const techA = await person("uid-tech-a", ["technician", "equipmentInstaller"], { id: "e-tech-a", name: "Finley Tech", technician: true });
  const wm = await person("uid-wm", ["warehouseManager"], { id: "e-wm", name: "Morgan WM" });
  const peer = await person("uid-peer", ["dispatcher"], { id: "e-peer", name: "Pat Peer" });

  await q(`INSERT INTO eos_crm.accounts (id, tenant_id, name, status, created_by, updated_by) VALUES ('acct-r',$1,'Harbor Grill','ACTIVE','f','f')`, [TENANT]);
  await q(`INSERT INTO eos_crm.account_relationship_types (tenant_id, account_id, relationship_type) VALUES ($1,'acct-r','CUSTOMER')`, [TENANT]);
  await q(`INSERT INTO eos_crm.account_locations (id, tenant_id, account_id, name, created_by, updated_by) VALUES ('loc-r1',$1,'acct-r','Downtown','f','f')`, [TENANT]);
  await q(`INSERT INTO eos_ops.warehouses (id, tenant_id, operating_company_key, name, site_label, status, provenance, created_by, updated_by)
           VALUES ($1,$2,'taylor','Taylor Main','Taylor Main','ACTIVE','NATIVE','f','f')`, [WH, TENANT]);
  await q(`INSERT INTO eos_workforce.employee_operational_scopes (id, tenant_id, employee_id, scope_type, scope_id, effective_from, assigned_by)
           VALUES ('os-wm-wh',$1,'e-wm','WAREHOUSE',$2,now(),'f')`, [TENANT, WH]);
  await q(`INSERT INTO eos_ops.equipment_models (id, tenant_id, manufacturer_id, manufacturer_name, model_number, display_name, status, source_authority, version, created_by, updated_by)
           VALUES ($1,$2,'ACME','Acme','RENT-100','Acme Rental Unit','ACTIVE','fixture',1,'f','f')`, [MODEL, TENANT]);
  await q(`INSERT INTO eos_ops.parts (id, tenant_id, created_by, internal_part_number, name, status, stocking_unit, control_type, stocking_class,
             expiry_tracked, consumable, returnable_core, whole_unit, equipment_model_id, version, updated_by)
           VALUES ('PRT-RENT',$1,'f','PRT-RENT','Rental unit','ACTIVE','EACH','SERIALIZED','STOCKED',false,false,false,true,$2,1,'f')`, [TENANT, MODEL]);
  let mv = 0;
  for (const serial of ["RU-1", "RU-2"]) {
    await q(`INSERT INTO eos_ops.serialized_custody (id, tenant_id, part_id, serial_number, status, location_type, location_id, operating_company_key, updated_by)
             VALUES ($1,$2,'PRT-RENT',$3,'AVAILABLE','WAREHOUSE',$4,'taylor','f')`, [`cst-${serial}`, TENANT, serial, WH]);
    await q(`INSERT INTO eos_ops.inventory_movements (id, tenant_id, operating_company_key, part_id, tracking_mode, location_type, location_id, movement_type, quantity_delta,
               serial_number, source_kind, source_id, created_by) VALUES ($1,$2,'taylor','PRT-RENT','SERIAL','WAREHOUSE',$3,'RECEIVED',1,$4,'FIXTURE','fixture','f')`,
      [`mov-r-${++mv}`, TENANT, WH, serial]);
  }
  await certifyInventoryBaselineFixture(q, TENANT);
  const ROUND_THE_CLOCK = Object.fromEntries(["0", "1", "2", "3", "4", "5", "6"].map((d) => [d, [{ start: "00:00", end: "24:00" }]]));
  ok(await call(dispatcher, WO, "setTechnicianWorkingHours", { employeeId: "e-tech-a", timeZone: "UTC", weeklyHours: ROUND_THE_CLOCK, reason: "fixture availability" }), "hours");
  let slot = 0;
  const workOrder = async ({ rentalAgreementId, createOnly = false } = {}) => {
    const id = ok(await call(dispatcher, WO, "createWorkOrder", { operatingCompanyId: "taylor", customerId: "acct-r", locationId: "loc-r1", workOrderType: "INSTALL", priority: 2,
      ...(rentalAgreementId ? { rentalAgreementId } : {}) }), "create").workOrderId;
    if (createOnly) return id; // the one technician can hold only one active Work Order (DOUBLE_BOOKED)
    ok(await call(dispatcher, WO, "markWorkOrderReady", { workOrderId: id }), "ready");
    ok(await call(dispatcher, WO, "setWorkOrderPartsPlan", { workOrderId: id, plan: [] }), "plan");
    const start = Date.now() + 2 * 24 * HOUR + (++slot) * 2 * HOUR;
    ok(await call(dispatcher, WO, "scheduleWorkOrder", { workOrderId: id, employeeId: "e-tech-a", scheduledStart: start, scheduledEnd: start + HOUR }), "schedule");
    ok(await call(dispatcher, WO, "dispatchWorkOrder", { workOrderId: id }), "dispatch");
    ok(await call(techA, WO, "acceptWorkOrder", { workOrderId: id }), "accept");
    for (const op of ["startWorkOrderTravel", "arriveAtWorkOrder", "startWorkOrderWork"]) ok(await call(techA, WO, op, { workOrderId: id }), op);
    return id;
  };
  const unitOf = async (serial) => one(`SELECT * FROM eos_rental.fleet_units WHERE tenant_id = $1 AND serial_number = $2`, [TENANT, serial]);
  /** A Ventana Work Order written by SQL (the cross-company state the commands cannot produce), optionally tied to a Rental Agreement. */
  let seq = 0;
  const ventanaWo = async (over = {}) => {
    const id = `wo-ventana-${++seq}`;
    await q(`INSERT INTO eos_ops.work_orders (id, tenant_id, operating_company_key, work_order_number, status, work_order_type, priority, customer_id, location_id,
               rental_agreement_id, provenance, created_by_principal_id, created_at, updated_at)
             VALUES ($1,$2,'ventana',$3,$4::eos_ops.ops_work_order_status,$5::eos_ops.ops_work_order_type,2,'acct-r','loc-r1',$6,'NATIVE',$7,now(),now())`,
      [id, TENANT, `WO-2031-9${String(seq).padStart(5, "0")}`, over.status ?? "CREATED", over.type ?? "SERVICE_CALL", over.rentalAgreementId ?? null, dispatcher.principalId]);
    return id;
  };
  const newAgreement = async () => {
    const a = ok(await rn(gm, "createRentalAgreement", { operatingCompanyId: "taylor", accountId: "acct-r", customerLocationId: "loc-r1", startDate: day(-3), rateMinor: 70000,
      billingFrequency: "WEEK", expectedEndDate: day(30), idempotencyKey: key("ra") })).agreement;
    return ok(await rn(gm, "activateRentalAgreement", { agreementId: a.id })).agreement;
  };
  for (const s of ["RU-1", "RU-2"]) ok(await rn(wm, "designateFleetUnit", { partId: "PRT-RENT", serialNumber: s, displayName: `Rental ${s}`, reason: "rental fleet" }), s);

  await t.test("RETURN: a foreign, a nonexistent and a wrong-agreement Work Order id are one refusal and change nothing; the agreement's own Work Order succeeds", async () => {
    const agreement = await newAgreement(), other = await newAgreement();
    const assignmentId = ok(await rn(dispatcher, "reserveRentalUnit", { agreementId: agreement.id, fleetUnitId: (await unitOf("RU-1")).id, idempotencyKey: key("rs") })).assignmentId;
    const installWo = await workOrder({ rentalAgreementId: agreement.id });
    ok(await call(techA, WO, "recordWorkOrderEquipmentInstall", { workOrderId: installWo, partId: "PRT-RENT", serialNumber: "RU-1", idempotencyKey: key("inst"), equipmentName: "Rental RU-1" }), "deploy");
    assert.equal((await one(`SELECT status FROM eos_rental.rental_assignments WHERE id = $1`, [assignmentId])).status, "DEPLOYED");
    // each id: a Ventana Work Order that CARRIES this agreement's id (the old check accepted it), a missing id, and a Taylor Work Order of ANOTHER agreement
    const foreign = await ventanaWo({ rentalAgreementId: agreement.id });
    const wrongAgreement = await workOrder({ rentalAgreementId: other.id, createOnly: true });
    const tryReturn = async (returnWorkOrderId) => (await rn(wm, "initiateRentalReturn", { assignmentId, returnWorkOrderId, reason: "pickup" }));
    const refusals = [];
    for (const id of [foreign, "wo-does-not-exist", wrongAgreement]) {
      const r = await tryReturn(id);
      assert.equal(r.status, 412, JSON.stringify(r.body).slice(0, 300));
      assert.equal(r.body.code, "RETURN_WORK_ORDER_MISMATCH");
      refusals.push({ status: r.status, body: r.body });
      assert.equal((await one(`SELECT status FROM eos_rental.rental_assignments WHERE id = $1`, [assignmentId])).status, "DEPLOYED", "a refused return changes nothing");
    }
    assert.deepEqual(refusals[0], refusals[1], "a foreign Work Order is answered exactly like a missing one");
    assert.deepEqual(refusals[0], refusals[2], "...and like a Work Order of another agreement");
    const done = await tryReturn(installWo);
    assert.equal(done.status, 200, JSON.stringify(done.body).slice(0, 300));
    assert.equal((await one(`SELECT status FROM eos_rental.rental_assignments WHERE id = $1`, [assignmentId])).status, "RETURN_PENDING");
  });

  await t.test("REACH: rental reach without Work Order reach -- the agreement with empty workOrders, and the going-out unit with an empty Work Order column", async () => {
    const agreement = await newAgreement();
    const fleetUnitId = (await unitOf("RU-2")).id;
    ok(await rn(dispatcher, "reserveRentalUnit", { agreementId: agreement.id, fleetUnitId, idempotencyKey: key("rs") }));
    const foreignInstall = await ventanaWo({ rentalAgreementId: agreement.id, type: "INSTALL" });
    const read = ok(await rn(dispatcher, "readRentalAgreement", { agreementId: agreement.id }));
    assert.equal(read.id, agreement.id, "the caller reaches the agreement");
    assert.deepEqual(read.workOrders, [], "the foreign Work Order is not listed");
    assert.equal(JSON.stringify(read).includes(foreignInstall), false, "...nor named anywhere");
    const ws = ok(await rn(dispatcher, "readRentalWorkspace", {}));
    const row = ws.goingOut.find((g) => g.fleetUnitId === fleetUnitId);
    assert.ok(row, "the reserved unit still shows as going out");
    assert.deepEqual([row.workOrderId, row.workOrderNumber, row.status], [null, null, null], "with an empty Work Order column");
    assert.ok(ws.counts.goingOut >= 1, "and is counted");
    assert.equal(JSON.stringify(ws).includes(foreignInstall), false);
  });

  await t.test("ASSIGNED: a foreign-company Work Order the caller is assigned to is listed (as My Work does); one it is not assigned to is not", async () => {
    const mine = await ventanaWo(), notMine = await ventanaWo();
    const assign = (workOrderId, employeeId) => q(
      `INSERT INTO eos_ops.work_order_assignments (id,tenant_id,work_order_id,assignee_employee_id,source,effective_from,assigned_by_principal_id,provenance)
       VALUES ($1,$2,$3,$4,'SCHEDULE',now(),$5,'NATIVE')`, [`woa-${workOrderId}-${employeeId}`, TENANT, workOrderId, employeeId, dispatcher.principalId]);
    // A Work Order has ONE current assignment (work_order_assignments_one_current): the caller (peer) holds `mine`; another Employee holds `notMine`.
    await assign(mine, "e-peer");
    await assign(notMine, "e-tech-a");
    const actor = { tenantId: TENANT, principalId: peer.principalId, capabilities: new Set(["employee.record.read", "workOrder.record.read"]) };
    const listFor = async (employeeId) => (await assignedWork.listAssignedWorkForEmployee({ pool }, actor, { employeeId, family: "WORK_ORDER", limit: 100 })).items.map((i) => i.recordId);
    assert.ok((await listFor("e-peer")).includes(mine), "the foreign Work Order the caller is assigned to is listed, as My Work does");
    assert.equal((await listFor("e-tech-a")).includes(notMine), false, "another company's Work Order the caller is not assigned to is not");
  });
});
