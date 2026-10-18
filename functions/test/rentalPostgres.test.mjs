// RENTAL (EOS CONTROLLER -- NEXT 3 MAJOR ROADMAP BLOCKS, Package B, 2026-10-03; DECISIONS #207; migration 1764520000000).
// End-to-end proofs over real PostgreSQL, through the governed transports (/operations/rental, /operations/work-orders,
// /operations/finance):
//   AUTH     the six rental capabilities, separated; held by their ruled analog roles; never admin / Sales / Technicians.
//   FLEET    designation (owner fixed from custody), UNAVAILABLE / restore.
//   LIFE     AVAILABLE -> RESERVED -> DEPLOYED (INSTALL Work Order) -> service while rented -> extension -> exchange ->
//            return -> inspection -> SERVICE_HOLD -> AVAILABLE; close.
//   REFUSE   double booking, unavailable / inspection units, wrong company, wrong site, sale + rental, rental unit by sale,
//            unauthorized personas, partial periods, overlapping periods, beyond-term periods, the wrong return warehouse.
//   MONEY    PERIOD + DELIVERY charges -> RENTAL billing packages -> receivables -> handoffs (contract v3) -> settlement ->
//            SETTLED; NOT_DETERMINED tax HOLDS, a later determination supersedes.
//   NO SALE  no Sales Order, no financing arrangement, no fulfillment, no ownership change -- ever.
//   FACTS    the fleet-unit event log Analysis consumes; the exception-first workspace.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { serviceBaselineTenant, HOUR } from "./support/serviceBaselineTenant.mjs";
import { certifyInventoryBaselineFixture } from "./support/inventoryBaselineCertified.mjs";
import { deterministicAccountingAdapter, TEST_ADAPTER_KEY } from "./support/deterministicAccountingAdapter.mjs";
import { assignFinanceCompanies } from "./support/financeCompanyAccess.mjs";
import { grantSyntheticCompanyAuthority } from "./support/syntheticAvailability.mjs";

const require = createRequire(import.meta.url);
const fin = require("../lib/eosFinance/financeFoundation.js");
const delivery = require("../lib/eosFinance/accountingDelivery.js");
const rental = require("../lib/eosRental/rental.js");
const equipmentDelta = require("../lib/adminPolicy/equipmentActivationDelta.js");

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const TENANT = "t-rental";
const RNT = "/operations/rental", WO = "/operations/work-orders", FIN = "/operations/finance";
const WH = "taylor-main", VWH = "ventana-wh", MODEL = "ACME--RENT-100";
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const day = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

test("static: Rental never writes a sale, a financing arrangement or a Firebase record", () => {
  for (const f of ["eosRental/rental.ts", "eosRental/rentalBilling.ts", "eosRental/rentalDeployment.ts", "eosRental/rentalOperations.ts"]) {
    const s = strip(readFileSync(join(SRC, f), "utf8"));
    assert.doesNotMatch(s, /firebase|firestore/i, `${f}: no Firebase`);
    assert.doesNotMatch(s, /INSERT INTO eos_commercial\.(sales_orders|sales_agreements|financing_arrangements|sales_order_fulfillments)/, `${f}: no sale / financing written`);
    assert.doesNotMatch(s, /UPDATE eos_rental\.fleet_units SET[^`]*owner_operating_company_key/, `${f}: the owner is never rewritten`);
  }
  assert.match(strip(readFileSync(join(SRC, "eosRental/rental.ts"), "utf8")), /RENTAL_PARTIAL_PERIOD_UNRULED/, "a partial period is refused, never prorated");
});

test("wholePeriods: whole DAY / WEEK / MONTH spans only", () => {
  assert.equal(rental.wholePeriods("2026-01-01", "2026-01-08", "WEEK"), 1);
  assert.equal(rental.wholePeriods("2026-01-01", "2026-01-10", "WEEK"), null);
  assert.equal(rental.wholePeriods("2026-01-31", "2026-03-31", "MONTH"), 2);
  assert.equal(rental.wholePeriods("2026-01-31", "2026-02-28", "MONTH"), null);
  assert.equal(rental.wholePeriods("2026-03-01", "2026-03-04", "DAY"), 3);
  assert.equal(rental.wholePeriods("2026-03-04", "2026-03-04", "DAY"), null);
});

test("rental over PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  const { q, admin, person, pool, call } = await serviceBaselineTenant(t, { urlBase: URL_BASE, tenant: TENANT, prefix: "rnt" });
  const one = async (sql, v = []) => (await q(sql, v)).rows[0];
  const count = async (sql, v = []) => Number((await one(sql, v)).n);
  const ok = (r, what = "") => { assert.equal(r.status, 200, `${what} ${JSON.stringify(r.body).slice(0, 700)}`); return r.body.result; };
  const refused = (r, status, code, what = "") => { assert.deepEqual([r.status, r.body.code], [status, code], `${what} ${JSON.stringify(r.body).slice(0, 500)}`); return r.body; };
  const holders = async (key) => (await q(`SELECT r.key FROM eos_policy.role_capabilities rc JOIN eos_policy.roles r ON r.id = rc.role_id
      JOIN eos_policy.capabilities c ON c.id = rc.capability_id WHERE rc.tenant_id = $1 AND c.key = $2`, [TENANT, key])).rows.map((r) => r.key).sort();
  const rn = (who, operation, input) => call(who, RNT, operation, input);
  let k = 0;
  const key = (s) => `${s}-${++k}`;

  // ── authority for the install path (the Equipment activation delta, as issued through Administration) ──
  for (const { operation, input } of equipmentDelta.equipmentActivationOperations()) assert.equal((await admin(operation, input)).ok, true, operation);
  const gm = await person("uid-gm", ["generalManager"], { id: "e-gm", name: "Gale GM" });
  const dispatcher = await person("uid-dispatch", ["dispatcher"], { id: "e-dispatch", name: "Emerson Dispatch" });
  const techA = await person("uid-tech-a", ["technician", "equipmentInstaller"], { id: "e-tech-a", name: "Finley Tech", technician: true });
  const wm = await person("uid-wm", ["warehouseManager"], { id: "e-wm", name: "Morgan WM" });
  const ctrl = await person("uid-ctrl", ["controller"], { id: "e-ctrl", name: "Sage Controller" });
  const salesP = await person("uid-sales", ["salesperson"], { id: "e-sales", name: "Riley Retail" });
  const sysAdmin = await person("uid-sysadmin", ["admin"], { id: "e-sysadmin", name: "Rowan Administrator" });
  // Company assignment is mandatory for Finance (Financials Workspace P0 correction): the settling Controller is assigned.
  await assignFinanceCompanies({ admin, q, tenant: TENANT }, [ctrl]);
  // P0 RENTAL COMPANY SECURITY (DECISIONS #236): SYNTHETIC personas only -- no existing Taylor-only persona is widened.
  //   wmV / gmV   Ventana-home warehouse manager / general manager: operate Ventana's fleet and agreements
  //   dispX       Taylor-home dispatcher with an explicit Ventana operatingCompany assignment (reach both companies)
  //   ctrlT       Taylor-home controller with NO Financials assignment (company authority Taylor; no Finance reach)
  //   unlinkedGm  every rental capability (generalManager) but no linked Employee -> no company authority at all
  const wmV = await person("uid-wm-v", ["warehouseManager"], { id: "e-wm-v", name: "Val Ventana-WM", company: "ventana" });
  const gmV = await person("uid-gm-v", ["generalManager"], { id: "e-gm-v", name: "Vic Ventana-GM", company: "ventana" });
  const dispX = await person("uid-dispatch-x", ["dispatcher"], { id: "e-dispatch-x", name: "Xan Cross-Dispatch" });
  await assignFinanceCompanies({ admin, q, tenant: TENANT }, [dispX], ["ventana"]);
  const ctrlT = await person("uid-ctrl-t", ["controller"], { id: "e-ctrl-t", name: "Tia Taylor-Controller" });
  const unlinkedGm = await person("uid-gm-unlinked", ["generalManager"]);

  // ── masters ──
  await q(`INSERT INTO eos_crm.accounts (id, tenant_id, name, status, created_by, updated_by) VALUES ('acct-r',$1,'Harbor Grill','ACTIVE','f','f'), ('acct-o',$1,'Other Diner','ACTIVE','f','f')`, [TENANT]);
  await q(`INSERT INTO eos_crm.account_relationship_types (tenant_id, account_id, relationship_type) VALUES ($1,'acct-r','CUSTOMER'), ($1,'acct-o','CUSTOMER')`, [TENANT]);
  await q(`INSERT INTO eos_crm.account_locations (id, tenant_id, account_id, name, created_by, updated_by) VALUES ('loc-r1',$1,'acct-r','Downtown','f','f'),
           ('loc-r2',$1,'acct-r','Harbor','f','f'), ('loc-o',$1,'acct-o','Uptown','f','f')`, [TENANT]);
  await q(`INSERT INTO eos_ops.warehouses (id, tenant_id, operating_company_key, name, site_label, status, provenance, created_by, updated_by)
           VALUES ($1,$2,'taylor','Taylor Main','Taylor Main','ACTIVE','NATIVE','f','f'), ($3,$2,'ventana','Ventana Depot','Ventana Depot','ACTIVE','NATIVE','f','f')`, [WH, TENANT, VWH]);
  await q(`INSERT INTO eos_workforce.employee_operational_scopes (id, tenant_id, employee_id, scope_type, scope_id, effective_from, assigned_by)
           VALUES ('os-wm-wh',$1,'e-wm','WAREHOUSE',$2,now(),'f')`, [TENANT, WH]);
  await q(`INSERT INTO eos_ops.equipment_models (id, tenant_id, manufacturer_id, manufacturer_name, model_number, display_name, status, source_authority, version, created_by, updated_by)
           VALUES ($1,$2,'ACME','Acme','RENT-100','Acme Rental Unit','ACTIVE','fixture',1,'f','f')`, [MODEL, TENANT]);
  await q(`INSERT INTO eos_ops.parts (id, tenant_id, created_by, internal_part_number, name, status, stocking_unit, control_type, stocking_class,
             expiry_tracked, consumable, returnable_core, whole_unit, equipment_model_id, version, updated_by)
           VALUES ('PRT-RENT',$1,'f','PRT-RENT','Rental unit','ACTIVE','EACH','SERIALIZED','STOCKED',false,false,false,true,$2,1,'f')`, [TENANT, MODEL]);
  let mv = 0;
  for (const [serial, location, company] of [["RU-1", WH, "taylor"], ["RU-2", WH, "taylor"], ["RU-V", VWH, "ventana"], ["SALE-1", WH, "taylor"]]) {
    await q(`INSERT INTO eos_ops.serialized_custody (id, tenant_id, part_id, serial_number, status, location_type, location_id, operating_company_key, updated_by)
             VALUES ($1,$2,'PRT-RENT',$3,'AVAILABLE','WAREHOUSE',$4,$5,'f')`, [`cst-${serial}`, TENANT, serial, location, company]);
    await q(`INSERT INTO eos_ops.inventory_movements (id, tenant_id, operating_company_key, part_id, tracking_mode, location_type, location_id, movement_type, quantity_delta,
               serial_number, source_kind, source_id, created_by) VALUES ($1,$2,$3,'PRT-RENT','SERIAL','WAREHOUSE',$4,'RECEIVED',1,$5,'FIXTURE','fixture','f')`,
      [`mov-r-${++mv}`, TENANT, company, location, serial]);
  }
  await certifyInventoryBaselineFixture(q, TENANT);
  const sys = { tenantId: TENANT, principalId: "rental-system" };
  await fin.configureAccountingDestination(pool, sys, { operatingCompanyId: "taylor", displayName: "Taylor Ledger", providerKey: TEST_ADAPTER_KEY, activate: true });
  const ROUND_THE_CLOCK = Object.fromEntries(["0", "1", "2", "3", "4", "5", "6"].map((d) => [d, [{ start: "00:00", end: "24:00" }]]));
  ok(await call(dispatcher, WO, "setTechnicianWorkingHours", { employeeId: "e-tech-a", timeZone: "UTC", weeklyHours: ROUND_THE_CLOCK, reason: "fixture availability" }), "hours");
  let slot = 0;
  const workOrder = async ({ type = "INSTALL", locationId = "loc-r1", rentalAgreementId, equipmentId } = {}) => {
    const id = ok(await call(dispatcher, WO, "createWorkOrder", { operatingCompanyId: "taylor", customerId: "acct-r", locationId, workOrderType: type, priority: 2,
      ...(rentalAgreementId ? { rentalAgreementId } : {}), ...(equipmentId ? { equipmentId } : {}) }), "create").workOrderId;
    ok(await call(dispatcher, WO, "markWorkOrderReady", { workOrderId: id }), "ready");
    ok(await call(dispatcher, WO, "setWorkOrderPartsPlan", { workOrderId: id, plan: [] }), "plan");
    const start = Date.now() + 2 * 24 * HOUR + (++slot) * 2 * HOUR;
    ok(await call(dispatcher, WO, "scheduleWorkOrder", { workOrderId: id, employeeId: "e-tech-a", scheduledStart: start, scheduledEnd: start + HOUR }), "schedule");
    ok(await call(dispatcher, WO, "dispatchWorkOrder", { workOrderId: id }), "dispatch");
    ok(await call(techA, WO, "acceptWorkOrder", { workOrderId: id }), "accept");
    for (const op of ["startWorkOrderTravel", "arriveAtWorkOrder", "startWorkOrderWork"]) ok(await call(techA, WO, op, { workOrderId: id }), op);
    return id;
  };
  const complete = async (id) => ok(await call(techA, WO, "completeWorkOrder", { workOrderId: id }), "complete");
  const cancel = async (id) => ok(await call(dispatcher, WO, "cancelWorkOrder", { workOrderId: id, expectedStatus: "WORK_IN_PROGRESS", note: "case done" }), "cancel");
  const install = (wo, serial, idem) => call(techA, WO, "recordWorkOrderEquipmentInstall", { workOrderId: wo, partId: "PRT-RENT", serialNumber: serial, idempotencyKey: idem, equipmentName: `Rental ${serial}` });
  const unitOf = async (serial) => one(`SELECT * FROM eos_rental.fleet_units WHERE tenant_id = $1 AND serial_number = $2`, [TENANT, serial]);

  await t.test("AUTH: six separated capabilities, held by their ruled analog roles; never granted to admin; Sales / Technicians refused; admin never writes an agreement", async () => {
    assert.deepEqual(await holders("rental.agreement.manage"), ["generalManager", "owner", "salesManager"]);
    assert.deepEqual(await holders("rental.unit.assign"), ["dispatcher", "generalManager", "owner", "salesManager"]);
    assert.deepEqual(await holders("rental.unit.return"), ["fieldManager", "generalManager", "owner", "warehouseAssociate", "warehouseManager"]);
    assert.deepEqual(await holders("rental.fleet.manage"), ["generalManager", "owner", "warehouseManager"]);
    assert.deepEqual(await holders("rental.charge.record"), ["accountingManager", "controller", "financeManager", "generalManager", "owner"]);
    for (const k2 of rental.RENTAL_CAPABILITIES) {
      const h = await holders(k2);
      assert.ok(!h.includes("admin") && !h.includes("salesperson") && !h.includes("technician"), `${k2}: never admin / Sales / Technician (${h})`);
    }
    refused(await rn(salesP, "createRentalAgreement", { operatingCompanyId: "taylor", accountId: "acct-r", customerLocationId: "loc-r1", startDate: day(-30),
      rateMinor: 70000, billingFrequency: "WEEK", expectedEndDate: day(5), idempotencyKey: key("ra") }), 403, "CAPABILITY_REQUIRED");
    // The protected Administrator manages the fleet by STANDING (O1, DECISIONS #227) -- never by a grant row (above) -- and
    // still never writes an agreement (rental.agreement.manage is O1 KEEP).
    refused(await rn(sysAdmin, "createRentalAgreement", { operatingCompanyId: "taylor", accountId: "acct-r", customerLocationId: "loc-r1", startDate: day(-30),
      rateMinor: 70000, billingFrequency: "WEEK", expectedEndDate: day(5), idempotencyKey: key("ra-adm") }), 403, "CAPABILITY_REQUIRED");
    refused(await rn(techA, "readRentalWorkspace", {}), 403, "CAPABILITY_REQUIRED");
  });

  let agreement, ag2;
  await t.test("FLEET + AGREEMENT: designation fixes the owner from custody; RA numbering; versioned terms; activation", async () => {
    // A unit is designated by someone with authority over the company that holds it in custody: Taylor's by the Taylor WM,
    // Ventana's by the Ventana WM. The Taylor WM is answered about Ventana's unit exactly as about one that does not exist.
    assert.deepEqual(refused(await rn(wm, "designateFleetUnit", { partId: "PRT-RENT", serialNumber: "RU-V", displayName: "x", reason: "x" }), 404, "UNIT_NOT_FOUND").message,
      refused(await rn(wm, "designateFleetUnit", { partId: "PRT-RENT", serialNumber: "NO-SUCH", displayName: "x", reason: "x" }), 404, "UNIT_NOT_FOUND").message.replace("NO-SUCH", "RU-V"));
    for (const s of ["RU-1", "RU-2", "RU-V"]) {
      const r = ok(await rn(s === "RU-V" ? wmV : wm, "designateFleetUnit", { partId: "PRT-RENT", serialNumber: s, displayName: `Rental ${s}`, reason: "rental fleet" }), s);
      assert.deepEqual([r.fleetUnit.availability, r.fleetUnit.ownerOperatingCompanyKey, r.fleetUnit.custodian.kind], ["AVAILABLE", s === "RU-V" ? "ventana" : "taylor", "OWNER"]);
    }
    assert.equal(ok(await rn(wm, "designateFleetUnit", { partId: "PRT-RENT", serialNumber: "RU-1", displayName: "again", reason: "x" })).outcome, "replayed");
    const created = ok(await rn(gm, "createRentalAgreement", { operatingCompanyId: "taylor", accountId: "acct-r", customerLocationId: "loc-r1", startDate: day(-30),
      rateMinor: 70000, billingFrequency: "WEEK", expectedEndDate: day(5), deliveryChargeMinor: 15000, deliveryRequirements: "dock delivery, 7am",
      returnExpectations: "pickup at the dock", idempotencyKey: key("ra") }));
    agreement = created.agreement;
    assert.match(agreement.number, rental.RENTAL_NUMBER_PATTERN);
    assert.deepEqual([agreement.status, agreement.disposition, agreement.ownershipTransfers, agreement.currentTerms.version, agreement.currentTerms.changeKind],
      ["DRAFT", "RENTAL", false, 1, "ORIGINAL"]);
    refused(await rn(gm, "createRentalAgreement", { operatingCompanyId: "taylor", accountId: "acct-r", customerLocationId: "loc-o", startDate: day(-1), rateMinor: 1,
      billingFrequency: "DAY", expectedEndDate: day(3), idempotencyKey: key("ra") }), 412, "CUSTOMER_SITE_MISMATCH");
    refused(await rn(gm, "createRentalAgreement", { operatingCompanyId: "consolidated", accountId: "acct-r", customerLocationId: "loc-r1", startDate: day(-1), rateMinor: 1,
      billingFrequency: "DAY", expectedEndDate: day(3), idempotencyKey: key("ra") }), 400, "CONSOLIDATED_NOT_A_COMPANY");
    agreement = ok(await rn(gm, "activateRentalAgreement", { agreementId: agreement.id })).agreement;
    assert.equal(agreement.status, "ACTIVE");
    ag2 = ok(await rn(gm, "createRentalAgreement", { operatingCompanyId: "taylor", accountId: "acct-o", customerLocationId: "loc-o", startDate: day(0), rateMinor: 5000,
      billingFrequency: "DAY", expectedEndDate: day(10), idempotencyKey: key("ra") })).agreement;
  });

  let a1, wo1, eq1;
  await t.test("RESERVE + DEPLOY: AVAILABLE -> RESERVED -> ON_RENT through the INSTALL Work Order; double booking / unavailable / wrong company refused", async () => {
    a1 = ok(await rn(dispatcher, "reserveRentalUnit", { agreementId: agreement.id, fleetUnitId: (await unitOf("RU-1")).id, idempotencyKey: key("rs") })).assignmentId;
    assert.equal((await unitOf("RU-1")).availability, "RESERVED");
    refused(await rn(dispatcher, "reserveRentalUnit", { agreementId: ag2.id, fleetUnitId: (await unitOf("RU-1")).id, idempotencyKey: key("rs") }), 409, "RENTAL_UNIT_NOT_AVAILABLE", "double booking");
    // A caller with BOTH companies still cannot cross-rent; a Taylor-only caller never learns Ventana's unit exists.
    refused(await rn(dispX, "reserveRentalUnit", { agreementId: agreement.id, fleetUnitId: (await unitOf("RU-V")).id, idempotencyKey: key("rs") }), 412, "RENTAL_COMPANY_MISMATCH", "Ventana's unit");
    refused(await rn(dispatcher, "reserveRentalUnit", { agreementId: agreement.id, fleetUnitId: (await unitOf("RU-V")).id, idempotencyKey: key("rs") }), 404, "FLEET_UNIT_NOT_FOUND", "outside the caller's companies");
    ok(await rn(wm, "setFleetUnitAvailability", { fleetUnitId: (await unitOf("RU-2")).id, availability: "UNAVAILABLE", reason: "awaiting a part" }));
    refused(await rn(dispatcher, "reserveRentalUnit", { agreementId: agreement.id, fleetUnitId: (await unitOf("RU-2")).id, idempotencyKey: key("rs") }), 409, "RENTAL_UNIT_NOT_AVAILABLE", "unavailable");
    ok(await rn(wm, "setFleetUnitAvailability", { fleetUnitId: (await unitOf("RU-2")).id, availability: "AVAILABLE", reason: "part fitted" }));
    // The Work Order is proven against the agreement.
    refused(await call(dispatcher, WO, "createWorkOrder", { operatingCompanyId: "taylor", customerId: "acct-r", locationId: "loc-r2", workOrderType: "INSTALL", priority: 2,
      rentalAgreementId: agreement.id }), 412, "RENTAL_SITE_MISMATCH");
    refused(await call(dispatcher, WO, "createWorkOrder", { operatingCompanyId: "taylor", customerId: "acct-r", locationId: "loc-r1", workOrderType: "INSTALL", priority: 2,
      rentalAgreementId: agreement.id, salesOrderId: "so-x" }), 400, "RENTAL_AND_SALE_EXCLUSIVE");
    // D-248-1: a Work Order is created only for a company the caller is authorized for, so the agreement's company-mismatch proof
    // is made by a dispatcher with explicit authority over Ventana as well.
    const bothCompanies = await person("uid-dispatch-both", ["dispatcher"], { id: "e-dispatch-both", name: "Bo Both" });
    await grantSyntheticCompanyAuthority(pool, TENANT, bothCompanies.principalId, ["taylor", "ventana"]);
    refused(await call(bothCompanies, WO, "createWorkOrder", { operatingCompanyId: "ventana", customerId: "acct-r", locationId: "loc-r1", workOrderType: "INSTALL", priority: 2,
      rentalAgreementId: agreement.id }), 412, "RENTAL_COMPANY_MISMATCH");
    // A sale / service INSTALL Work Order can never take a fleet unit.
    const saleWo = await workOrder();
    const listed = ok(await call(techA, WO, "listInstallableEquipmentForWorkOrder", { workOrderId: saleWo })).units.map((u) => u.serialNumber);
    assert.deepEqual(listed, ["SALE-1"], "fleet units never appear on a non-rental install");
    refused(await install(saleWo, "RU-2", key("inst")), 412, "RENTAL_FLEET_UNIT_NOT_INSTALLABLE");
    await cancel(saleWo);
    wo1 = await workOrder({ rentalAgreementId: agreement.id });
    assert.deepEqual(ok(await call(techA, WO, "listInstallableEquipmentForWorkOrder", { workOrderId: wo1 })).units.map((u) => u.serialNumber), ["RU-1"]);
    refused(await install(wo1, "RU-2", key("inst")), 412, "RENTAL_UNIT_NOT_RESERVED");
    const r = ok(await install(wo1, "RU-1", key("inst")), "deploy");
    eq1 = r.equipment.id;
    assert.deepEqual([r.equipment.operatingCompanyKey, r.equipment.accountId, r.equipment.customerLocation.id], ["taylor", "acct-r", "loc-r1"],
      "the Equipment is Taylor's; the customer is its custodian / site user");
    const mov = await one(`SELECT movement_type::text AS t, quantity_delta AS d FROM eos_ops.inventory_movements WHERE tenant_id = $1 AND id = $2`, [TENANT, r.movementId]);
    assert.deepEqual([mov.t, mov.d], ["RENTAL_DEPLOYMENT", -1], "a deployment is not a consumption");
    const u = await unitOf("RU-1");
    assert.deepEqual([u.availability, u.owner_operating_company_key, u.current_assignment_id], ["ON_RENT", "taylor", a1]);
    await complete(wo1);
    const fu = ok(await rn(dispatcher, "readFleetUnit", { fleetUnitId: u.id }));
    assert.deepEqual([fu.custodian.kind, fu.custodian.accountId, fu.custodian.siteId, fu.ownerOperatingCompanyKey, fu.location.type], ["CUSTOMER", "acct-r", "loc-r1", "taylor", "EQUIPMENT"]);
    await assert.rejects(q(`UPDATE eos_rental.fleet_units SET owner_operating_company_key = 'acct-r' WHERE tenant_id = $1 AND id = $2`, [TENANT, u.id]), /RENTAL_OWNERSHIP_FIXED/);
  });

  await t.test("SERVICE while rented: a Work Order on Taylor's rental Equipment completes; ownership unchanged", async () => {
    const svc = await workOrder({ type: "SERVICE_CALL", rentalAgreementId: agreement.id, equipmentId: eq1 });
    await complete(svc);
    const e = await one(`SELECT status::text AS s, operating_company_key k, account_id a FROM eos_ops.equipment WHERE tenant_id = $1 AND id = $2`, [TENANT, eq1]);
    assert.deepEqual([e.s, e.k, e.a], ["ACTIVE", "taylor", "acct-r"]);
    assert.equal((await unitOf("RU-1")).owner_operating_company_key, "taylor");
  });

  await t.test("EXTENSION + AMENDMENT: new terms versions; history never rewritten", async () => {
    refused(await rn(gm, "amendRentalAgreementTerms", { agreementId: agreement.id, changeKind: "EXTENSION", expectedEndDate: day(40), rateMinor: 1, reason: "x" }),
      400, "EXTENSION_CHANGES_TERMS");
    const ext = ok(await rn(gm, "amendRentalAgreementTerms", { agreementId: agreement.id, changeKind: "EXTENSION", expectedEndDate: day(40), reason: "customer extended" }));
    assert.equal(ext.termsVersion, 2);
    assert.deepEqual(ext.agreement.termsHistory.map((x) => [x.version, x.changeKind, x.expectedEndDate]), [[1, "ORIGINAL", day(5)], [2, "EXTENSION", day(40)]]);
    await assert.rejects(q(`UPDATE eos_rental.rental_agreement_terms SET rate_minor = 1 WHERE agreement_id = $1`, [agreement.id]), /RENTAL_HISTORY_APPEND_ONLY/);
  });

  let periodPkg, receivable;
  await t.test("CHARGES -> RENTAL billing package -> receivable -> handoff (v3) -> settlement; partial / overlap / beyond-term refused; HELD tax superseded", async () => {
    const charge = (who, input) => rn(who, "recordRentalCharge", { agreementId: agreement.id, idempotencyKey: key("ch"), ...input });
    refused(await charge(salesP, { kind: "PERIOD", periodStart: day(-30), periodEnd: day(-23), taxEvidence: { status: "DETERMINED", amountMinor: 0 } }), 403, "CAPABILITY_REQUIRED");
    refused(await charge(ctrl, { kind: "PERIOD", periodStart: day(-30), periodEnd: day(-20), taxEvidence: { status: "DETERMINED", amountMinor: 0 } }), 412, "RENTAL_PARTIAL_PERIOD_UNRULED");
    refused(await charge(ctrl, { kind: "PERIOD", periodStart: day(-30), periodEnd: day(-23) }), 400, "TAX_EVIDENCE_REQUIRED");
    const p = ok(await charge(ctrl, { kind: "PERIOD", periodStart: day(-30), periodEnd: day(-16), taxEvidence: { status: "DETERMINED", amountMinor: 11200 } }), "two weeks");
    periodPkg = p.billingPackage;
    assert.deepEqual([periodPkg.status, periodPkg.totalMinor], ["READY", "151200"], "2 x 70000 + 11200 tax");
    const row = await one(`SELECT * FROM eos_finance.billing_packages WHERE tenant_id = $1 AND id = $2`, [TENANT, periodPkg.packageId]);
    assert.deepEqual([row.source_kind, row.commercial_disposition, row.obligor_basis, row.sales_order_id, row.sales_agreement_id, row.financing_arrangement_id, row.rental_agreement_id],
      ["RENTAL_CHARGE", "RENTAL", "RENTAL_CUSTOMER", null, null, null, agreement.id]);
    const line = await one(`SELECT * FROM eos_finance.billing_package_lines WHERE tenant_id = $1 AND package_id = $2`, [TENANT, periodPkg.packageId]);
    assert.deepEqual([line.kind, line.billable_qty, line.unit_price_minor, line.price_source, line.serial_numbers], ["RENTAL_PERIOD", 2, "70000", "RENTAL_AGREEMENT_TERMS", ["RU-1"]]);
    receivable = periodPkg.consequence.receivable.obligationId;
    const ob = await one(`SELECT o.kind, o.source_domain, b.originated_minor, cp.crm_account_id FROM eos_finance.obligations o JOIN eos_finance.obligation_balances b ON b.obligation_id = o.id
      JOIN eos_finance.financial_counterparties cp ON cp.id = o.counterparty_id WHERE o.tenant_id = $1 AND o.id = $2`, [TENANT, receivable]);
    assert.deepEqual([ob.kind, ob.source_domain, ob.originated_minor, ob.crm_account_id], ["RECEIVABLE", "BILLING_PACKAGE", "151200", "acct-r"]);
    assert.equal(periodPkg.consequence.handoff.status, "READY_FOR_DELIVERY");
    const built = await delivery.buildAccountingPayload(pool, TENANT, periodPkg.consequence.handoff.id);
    assert.deepEqual([built.payload.contract.version, built.payload.billingPackage.salesOrderId, built.payload.rental.agreementNumber, built.payload.rental.ownershipTransfers,
      built.payload.rental.periodStart, built.payload.receivable.amountMinor], [3, null, agreement.number, false, day(-30), "151200"]);
    refused(await charge(ctrl, { kind: "PERIOD", periodStart: day(-23), periodEnd: day(-16), taxEvidence: { status: "DETERMINED", amountMinor: 0 } }), 409, "RENTAL_PERIOD_ALREADY_CHARGED");
    refused(await charge(ctrl, { kind: "PERIOD", periodStart: day(-2), periodEnd: day(54), taxEvidence: { status: "DETERMINED", amountMinor: 0 } }), 412, "RENTAL_PERIOD_BEYOND_TERM");
    // DELIVERY: the agreed amount, once; NOT_DETERMINED tax HOLDS, a later determination supersedes.
    const d = ok(await charge(ctrl, { kind: "DELIVERY", taxEvidence: { status: "NOT_DETERMINED" } }), "delivery").billingPackage;
    assert.deepEqual([d.status, d.readinessExceptions, d.consequence], ["HELD", ["TAX_NOT_DETERMINED"], null]);
    const chargeId = (await one(`SELECT id FROM eos_rental.rental_charges WHERE tenant_id = $1 AND kind = 'DELIVERY'`, [TENANT])).id;
    refused(await charge(ctrl, { kind: "DELIVERY", taxEvidence: { status: "DETERMINED", amountMinor: 0 } }), 409, "RENTAL_CHARGE_ALREADY_RECORDED");
    const d2 = ok(await rn(ctrl, "determineRentalChargeTax", { chargeId, taxEvidence: { status: "DETERMINED", amountMinor: 1200 } })).billingPackage;
    assert.deepEqual([d2.outcome, d2.version, d2.status, d2.totalMinor], ["superseded", 2, "READY", "16200"]);
    // Settlement through the frozen Finance Closure path.
    const s = ok(await call(ctrl, FIN, "recordSettlement", { operatingCompanyId: "taylor", counterparty: { kind: "EXTERNAL_ORGANIZATION", crmAccountId: "acct-r" },
      kind: "CUSTOMER_PAYMENT", amountMinor: 151200, currency: "USD", sourceReference: "CHK-RENT-1", idempotencyKey: key("stl") })).settlement;
    const a = ok(await call(ctrl, FIN, "applySettlement", { settlementId: s.id, applications: [{ obligationId: receivable, amountMinor: 151200 }], idempotencyKey: key("app") }));
    assert.equal(a.obligations[0].status, "SETTLED");
  });

  let a2, wo2;
  await t.test("EXCHANGE: a replacement unit deploys under the same agreement; the replaced one returns; histories kept", async () => {
    a2 = ok(await rn(dispatcher, "reserveRentalUnit", { agreementId: agreement.id, fleetUnitId: (await unitOf("RU-2")).id, replacesAssignmentId: a1, idempotencyKey: key("rs") })).assignmentId;
    wo2 = await workOrder({ rentalAgreementId: agreement.id });
    ok(await install(wo2, "RU-2", key("inst")), "exchange deploy");
    await complete(wo2);
    ok(await rn(wm, "initiateRentalReturn", { assignmentId: a1, expectedPickupDate: day(1), reason: "exchanged" }));
    assert.equal((await unitOf("RU-1")).availability, "RETURN_PENDING");
    const view = ok(await rn(gm, "readRentalAgreement", { agreementId: agreement.id }));
    assert.deepEqual(view.assignments.map((x) => [x.serialNumber, x.status, x.replacesAssignmentId]), [["RU-1", "RETURN_PENDING", null], ["RU-2", "DEPLOYED", a1]]);
  });

  await t.test("RETURN + INSPECTION: Taylor custody restored in the OWNER's warehouse; INSPECTION, never automatically AVAILABLE", async () => {
    refused(await rn(wm, "receiveRentalReturn", { assignmentId: a1, warehouseId: VWH, conditionNotes: "x", idempotencyKey: key("rcv") }), 412, "RETURN_WAREHOUSE_NOT_OWNERS");
    const r = ok(await rn(wm, "receiveRentalReturn", { assignmentId: a1, warehouseId: WH, conditionNotes: "scuffed panel", idempotencyKey: key("rcv") }));
    const c = await one(`SELECT status::text AS s, location_type::text AS lt, location_id, operating_company_key FROM eos_ops.serialized_custody WHERE tenant_id = $1 AND serial_number = 'RU-1'`, [TENANT]);
    assert.deepEqual([c.s, c.lt, c.location_id, c.operating_company_key], ["AVAILABLE", "WAREHOUSE", WH, "taylor"]);
    assert.equal((await one(`SELECT movement_type::text t FROM eos_ops.inventory_movements WHERE tenant_id = $1 AND id = $2`, [TENANT, r.movementId])).t, "RENTAL_RETURN");
    assert.equal(await count(`SELECT COALESCE(SUM(quantity_delta),0)::int n FROM eos_ops.inventory_movements WHERE tenant_id = $1 AND serial_number = 'RU-1' AND location_type = 'WAREHOUSE' AND location_id = $2`, [TENANT, WH]), 1,
      "the ledger agrees with custody again");
    const e = await one(`SELECT status::text s FROM eos_ops.equipment WHERE tenant_id = $1 AND id = $2`, [TENANT, eq1]);
    assert.equal(e.s, "INACTIVE");
    assert.equal(await count(`SELECT count(*)::int n FROM eos_ops.equipment_events WHERE tenant_id = $1 AND equipment_id = $2 AND event_type = 'RENTAL_RETURNED'`, [TENANT, eq1]), 1);
    assert.equal((await unitOf("RU-1")).availability, "INSPECTION");
    refused(await rn(dispatcher, "reserveRentalUnit", { agreementId: ag2.id, fleetUnitId: (await unitOf("RU-1")).id, idempotencyKey: key("rs") }), 409, "RENTAL_UNIT_NOT_AVAILABLE", "not before inspection");
    ok(await rn(wm, "inspectRentalUnit", { fleetUnitId: (await unitOf("RU-1")).id, outcome: "NEEDS_SERVICE", conditionNotes: "panel needs replacing", idempotencyKey: key("ins") }));
    assert.equal((await unitOf("RU-1")).availability, "SERVICE_HOLD");
    ok(await rn(wm, "setFleetUnitAvailability", { fleetUnitId: (await unitOf("RU-1")).id, availability: "AVAILABLE", reason: "panel replaced" }));
    assert.equal((await unitOf("RU-1")).availability, "AVAILABLE");
  });

  await t.test("WORKSPACE: available / on rent / due back / billing exceptions answered from governed records", async () => {
    const ws = ok(await rn(dispatcher, "readRentalWorkspace", {}));
    // The Taylor-only dispatcher's workspace is Taylor's fleet (RU-1 available, RU-2 on rent); Ventana's RU-V is not in it.
    assert.deepEqual([ws.counts.AVAILABLE, ws.counts.ON_RENT, ws.counts.fleet], [1, 1, 2]);
    assert.equal([...ws.available, ...ws.onRent].some((u) => u.serialNumber === "RU-V"), false);
    assert.equal(ws.onRent[0].serialNumber, "RU-2");
    assert.equal(ws.onRent[0].custodian.kind, "CUSTOMER");
    assert.ok(ws.billingExceptions.some((x) => x.kind === "DEPLOYED_WITHOUT_CURRENT_CHARGE" && x.agreementId === agreement.id), "charged through 16 days ago, still out");
    const due = ok(await rn(dispatcher, "readRentalWorkspace", { dueWithinDays: 60 })).dueBack;
    assert.ok(due.some((x) => x.agreementId === agreement.id && x.unitsOut === 1));
  });

  await t.test("CLOSE + NO SALE + FACTS: closed only after every unit is back; nothing sold, financed or transferred; the event log is the analytic fact", async () => {
    refused(await rn(gm, "endRentalAgreement", { agreementId: agreement.id, outcome: "CLOSED", reason: "done" }), 412, "RENTAL_UNITS_STILL_ASSIGNED");
    ok(await rn(wm, "receiveRentalReturn", { assignmentId: a2, warehouseId: WH, conditionNotes: "good", idempotencyKey: key("rcv") }));
    ok(await rn(wm, "inspectRentalUnit", { fleetUnitId: (await unitOf("RU-2")).id, outcome: "READY", conditionNotes: "clean", idempotencyKey: key("ins") }));
    refused(await rn(gm, "endRentalAgreement", { agreementId: agreement.id, outcome: "CANCELLED", reason: "x" }), 412, "RENTAL_AGREEMENT_WAS_DEPLOYED");
    assert.equal(ok(await rn(gm, "endRentalAgreement", { agreementId: agreement.id, outcome: "CLOSED", reason: "returned in full" })).agreement.status, "CLOSED");
    for (const table of ["sales_orders", "sales_agreements", "financing_arrangements", "sales_order_fulfillments"]) {
      assert.equal(await count(`SELECT count(*)::int n FROM eos_commercial.${table} WHERE tenant_id = $1`, [TENANT]), 0, `no ${table}`);
    }
    assert.deepEqual((await q(`SELECT DISTINCT owner_operating_company_key k FROM eos_rental.fleet_unit_events WHERE tenant_id = $1 AND fleet_unit_id = $2`, [TENANT, (await unitOf("RU-1")).id])).rows.map((r) => r.k), ["taylor"]);
    const events = (await q(`SELECT event_type FROM eos_rental.fleet_unit_events WHERE tenant_id = $1 AND fleet_unit_id = $2 ORDER BY occurred_at, id`, [TENANT, (await unitOf("RU-1")).id])).rows.map((r) => r.event_type);
    assert.deepEqual(events, ["DESIGNATED", "RESERVED", "DEPLOYED", "RETURN_INITIATED", "RETURN_RECEIVED", "INSPECTED", "SERVICE_HOLD_RELEASED"]);
    await assert.rejects(q(`DELETE FROM eos_rental.fleet_unit_events WHERE tenant_id = $1`, [TENANT]), /RENTAL_HISTORY_APPEND_ONLY/);
    void deterministicAccountingAdapter;
  });

  // ── P0 RENTAL COMPANY SECURITY (Owner rulings D1-D8, 2026-10-15; DECISIONS #236) ──
  await t.test("COMPANY SECURITY: all 18 operations -- capability then company authority; out-of-company == missing; no cross-company write; replays re-authorized; Finance fields", async () => {
    const WS_ROUTE = "/operations/workspace";
    const respond = (r) => [r.status, r.body.code, r.body.message];
    // Ventana's own agreement, reservation and charge, operated by Ventana-authorized personas.
    const vAg = ok(await rn(gmV, "createRentalAgreement", { operatingCompanyId: "ventana", accountId: "acct-r", customerLocationId: "loc-r1", startDate: day(-10),
      rateMinor: 9000, billingFrequency: "DAY", expectedEndDate: day(20), deliveryChargeMinor: 2500, idempotencyKey: key("ra-v") }), "ventana agreement").agreement;
    ok(await rn(gmV, "activateRentalAgreement", { agreementId: vAg.id }));
    const ruV = (await unitOf("RU-V")).id;
    const vAsg = ok(await rn(gmV, "reserveRentalUnit", { agreementId: vAg.id, fleetUnitId: ruV, idempotencyKey: key("rs-v") })).assignmentId;
    const vChargeKey = key("ch-v");
    ok(await rn(ctrl, "recordRentalCharge", { agreementId: vAg.id, kind: "DELIVERY", taxEvidence: { status: "NOT_DETERMINED" }, idempotencyKey: vChargeKey }), "ventana charge");
    const vCharge = (await one(`SELECT id FROM eos_rental.rental_charges WHERE tenant_id = $1 AND agreement_id = $2`, [TENANT, vAg.id])).id;
    const snapshot = async () => JSON.stringify(await Promise.all([
      one(`SELECT status, version FROM eos_rental.rental_agreements WHERE id = $1`, [vAg.id]),
      one(`SELECT availability, version, current_assignment_id FROM eos_rental.fleet_units WHERE id = $1`, [ruV]),
      one(`SELECT status FROM eos_rental.rental_assignments WHERE id = $1`, [vAsg]),
      count(`SELECT count(*)::int n FROM eos_rental.rental_agreement_terms WHERE agreement_id = $1`, [vAg.id]),
      count(`SELECT count(*)::int n FROM eos_rental.rental_charges WHERE agreement_id = $1`, [vAg.id]),
      count(`SELECT count(*)::int n FROM eos_rental.rental_charge_tax_evidence WHERE charge_id = $1`, [vCharge]),
      count(`SELECT count(*)::int n FROM eos_rental.fleet_unit_events WHERE fleet_unit_id = $1`, [ruV]),
      count(`SELECT count(*)::int n FROM eos_rental.rental_inspections WHERE fleet_unit_id = $1`, [ruV]),
    ]));
    const before = await snapshot();

    // D2/D3: every by-id operation on a Ventana record, by a Taylor-only holder of EVERY rental capability (the Taylor GM), is
    // answered exactly like the same operation on a record that does not exist -- status, code AND message.
    const byId = [
      ["readRentalAgreement", (id) => ({ agreementId: id }), vAg.id],
      ["readFleetUnit", (id) => ({ fleetUnitId: id }), ruV],
      ["activateRentalAgreement", (id) => ({ agreementId: id }), vAg.id],
      ["amendRentalAgreementTerms", (id) => ({ agreementId: id, changeKind: "EXTENSION", expectedEndDate: day(60), reason: "x" }), vAg.id],
      ["endRentalAgreement", (id) => ({ agreementId: id, outcome: "CANCELLED", reason: "x" }), vAg.id],
      ["reserveRentalUnit", (id) => ({ agreementId: id, fleetUnitId: ruV, idempotencyKey: key("x") }), vAg.id],
      ["releaseRentalReservation", (id) => ({ assignmentId: id, reason: "x" }), vAsg],
      ["initiateRentalReturn", (id) => ({ assignmentId: id }), vAsg],
      ["receiveRentalReturn", (id) => ({ assignmentId: id, warehouseId: VWH, conditionNotes: "x", idempotencyKey: key("x") }), vAsg],
      ["inspectRentalUnit", (id) => ({ fleetUnitId: id, outcome: "READY", conditionNotes: "x", idempotencyKey: key("x") }), ruV],
      ["setFleetUnitAvailability", (id) => ({ fleetUnitId: id, availability: "UNAVAILABLE", reason: "x" }), ruV],
      ["recordRentalCharge", (id) => ({ agreementId: id, kind: "DELIVERY", taxEvidence: { status: "NOT_DETERMINED" }, idempotencyKey: key("x") }), vAg.id],
      ["determineRentalChargeTax", (id) => ({ chargeId: id, taxEvidence: { status: "DETERMINED", amountMinor: 1 } }), vCharge],
    ];
    for (const [op, input, ventanaId] of byId) {
      const outside = await rn(gm, op, input(ventanaId));
      const missing = await rn(gm, op, input(`nope-${op}`));
      assert.equal(outside.status, 404, `${op}: ${JSON.stringify(outside.body).slice(0, 300)}`);
      assert.deepEqual(respond(outside), respond(missing), `${op}: out-of-company == nonexistent`);
      assert.equal("result" in outside.body, false, `${op}: no record content`);
    }
    // A create naming another company is answered like an unknown company.
    const create = (company) => rn(gm, "createRentalAgreement", { operatingCompanyId: company, accountId: "acct-r", customerLocationId: "loc-r1", startDate: day(0),
      rateMinor: 1, billingFrequency: "DAY", expectedEndDate: day(3), idempotencyKey: key("ra-x") });
    assert.deepEqual(respond(await create("ventana")).slice(0, 2), [400, "OPERATING_COMPANY_UNKNOWN"]);
    assert.deepEqual(respond(await create("ventana")), respond(await create("acme")));
    // Nothing above wrote anything.
    assert.equal(await snapshot(), before, "no cross-company mutation, partial or otherwise");

    // Lists and the workspace: each caller's companies only (D3).
    assert.equal(ok(await rn(gm, "listRentalAgreements", {})).items.some((a) => a.id === vAg.id), false);
    assert.equal(ok(await rn(gm, "listFleetUnits", {})).items.some((u) => u.id === ruV), false);
    assert.deepEqual(ok(await rn(gmV, "listRentalAgreements", {})).items.map((a) => a.operatingCompanyKey), ["ventana"]);
    assert.deepEqual(ok(await rn(gmV, "listFleetUnits", {})).items.map((u) => u.serialNumber), ["RU-V"]);
    assert.equal(ok(await rn(gmV, "readRentalWorkspace", {})).counts.fleet, 1);
    assert.equal(ok(await rn(dispX, "listFleetUnits", {})).items.length, 3, "explicit cross-company authority reaches both companies");

    // D1: no company authority -> every one of the 18 operations refuses AFTER its capability check.
    for (const op of ["readRentalWorkspace", "listRentalAgreements", "readRentalAgreement", "listFleetUnits", "readFleetUnit", "designateFleetUnit", "setFleetUnitAvailability",
      "createRentalAgreement", "activateRentalAgreement", "amendRentalAgreementTerms", "endRentalAgreement", "reserveRentalUnit", "releaseRentalReservation",
      "initiateRentalReturn", "receiveRentalReturn", "inspectRentalUnit", "recordRentalCharge", "determineRentalChargeTax"]) {
      refused(await rn(unlinkedGm, op, {}), 403, "COMPANY_AUTHORITY_REQUIRED", op);
      refused(await rn(salesP, op, {}), 403, "CAPABILITY_REQUIRED", `${op}: capability first`);
    }

    // REPLAYS are re-authorized before anything stored is returned.
    const replayV = await rn(ctrlT, "recordRentalCharge", { agreementId: vAg.id, kind: "DELIVERY", taxEvidence: { status: "NOT_DETERMINED" }, idempotencyKey: vChargeKey });
    assert.deepEqual(respond(replayV).slice(0, 2), [409, "IDEMPOTENCY_KEY_REUSED"], "another company's charge key returns no package");
    assert.equal(JSON.stringify(replayV.body).includes("billingPackage"), false);
    assert.equal(ok(await rn(ctrl, "recordRentalCharge", { agreementId: vAg.id, kind: "DELIVERY", taxEvidence: { status: "NOT_DETERMINED" }, idempotencyKey: vChargeKey })).outcome,
      "replayed", "the authorized caller's replay still works");
    const usedKey = (await one(`SELECT i.idempotency_key k FROM eos_rental.rental_inspections i JOIN eos_rental.fleet_units f ON f.id = i.fleet_unit_id
      WHERE i.tenant_id = $1 AND f.serial_number = 'RU-1' LIMIT 1`, [TENANT])).k;
    refused(await rn(wm, "inspectRentalUnit", { fleetUnitId: (await unitOf("RU-2")).id, outcome: "READY", conditionNotes: "x", idempotencyKey: usedKey }), 409, "IDEMPOTENCY_KEY_REUSED",
      "an inspection key never returns another unit");
    refused(await rn(wm, "designateFleetUnit", { partId: "PRT-RENT", serialNumber: "RU-V", displayName: "again", reason: "x" }), 404, "UNIT_NOT_FOUND",
      "the designation replay of another company's unit returns nothing");

    // D8: receivables and balances need Finance's per-company authority; otherwise omitted and financeWithheld.
    const withReach = ok(await rn(ctrl, "readRentalAgreement", { agreementId: agreement.id }));
    assert.equal(withReach.financeWithheld, false);
    assert.ok(withReach.charges.some((c) => c.receivable && c.receivable.outstandingMinor !== undefined), "the assigned Controller sees the receivable");
    for (const who of [gm, ctrlT]) {
      const w = ok(await rn(who, "readRentalAgreement", { agreementId: agreement.id }));
      assert.equal(w.financeWithheld, true);
      assert.equal(w.charges.some((c) => "receivable" in c), false, "no receivable or balance without Finance reach");
      assert.ok(w.charges.length > 0 && w.charges.every((c) => c.amountMinor), "the charges themselves stay visible");
    }
    assert.equal(ok(await rn(gmV, "amendRentalAgreementTerms", { agreementId: vAg.id, changeKind: "EXTENSION", expectedEndDate: day(30), reason: "longer" })).agreement.financeWithheld, true,
      "command responses follow the same rule");

    // CROSS-TENANT: the same company key from another tenant reaches nothing (keys and ids are tenant-scoped).
    const otherTenant = { tenantId: "t-rental-other", principalId: "p-other", capabilities: new Set(rental.RENTAL_CAPABILITIES), companyKeys: ["taylor", "ventana"], companyIds: ["taylor", "ventana"] };
    await assert.rejects(rental.readRentalAgreement(pool, otherTenant, { agreementId: agreement.id }), (e) => e.code === "RENTAL_AGREEMENT_NOT_FOUND");
    await assert.rejects(rental.readFleetUnit(pool, otherTenant, { fleetUnitId: ruV }), (e) => e.code === "FLEET_UNIT_NOT_FOUND");
    assert.deepEqual((await rental.listRentalAgreements(pool, otherTenant, {})).items, []);

    // D6: the caller's own company options, from EOS Core.
    assert.deepEqual(ok(await call(gm, WS_ROUTE, "readMyCompanyAuthority", {})).companies, [{ operatingCompanyId: "taylor", operatingCompanyKey: "taylor", businessTimeZone: "UTC" }]); // the governed zone (column default UTC here)
    assert.deepEqual(ok(await call(dispX, WS_ROUTE, "readMyCompanyAuthority", {})).companies.map((c) => c.operatingCompanyId), ["taylor", "ventana"]);
    assert.deepEqual(ok(await call(unlinkedGm, WS_ROUTE, "readMyCompanyAuthority", {})).companies, []);
    refused(await call(gm, WS_ROUTE, "readMyCompanyAuthority", { operatingCompanyId: "ventana" }), 400, "FIELD_NOT_ACCEPTED");
  });
});
