// COMPANY ISOLATION FOR THE WAREHOUSE-SCOPED NEIGHBOURS (ISO-2, 2026-10-19; follows ISO #2155; #235 / #237; Owner OD-ISO-2 "admin should have all access") -- against a real postgres:16.
//
// THE FINDING (independent review of #2155): a few commands resolved a warehouse scope WITHOUT the caller's company keys, so a scope on another company's warehouse
// still reached it -- worst, the serialized-unit intake (acquireSerializedAsset) WROTE a unit into a foreign company's warehouse. And several commands read the
// company authority directly, so a protected Administrator could read supplier-PO receipts but not receive or void them.
//
// THE RULE (same as ISO): CAPABILITY, then COMPANY AUTHORITY (resolveInventoryCompanyAuthority; none = COMPANY_AUTHORITY_REQUIRED, before any row is read), then the
// WAREHOUSE scope. A record or location of a company outside the caller's reads EXACTLY as a nonexistent one, every refusal precedes any write, and the protected
// Administrator reaches every governed company with the capability still required and no scope bypass.
//
// Personas: inCo (Taylor, scope WH-T) / foreignScoped (Taylor, scope WH-T + the VENTANA warehouse WH-V, no Ventana authority) / noCompany (no Employee) /
// cross (Taylor + an explicit Ventana authority, scope on both: it makes the Ventana records the others must not reach) / admin (the protected Administrator).
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { serviceBaselineTenant } from "./support/serviceBaselineTenant.mjs";
import { certifyInventoryBaselineFixture } from "./support/inventoryBaselineCertified.mjs";
import { grantSyntheticCompanyAuthority } from "./support/syntheticAvailability.mjs";

const require = createRequire(import.meta.url);
const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const T = "t-iso2n";
const PREFIX = "iso2n";

const ACQUIRE = "inventory.serializedAsset.acquire";
const RECEIVE = "inventory.stock.receive";
const CORRECT = "inventory.receipt.correct";
const SER_READ = "inventory.serializedAsset.read";
const RETURN_INTAKE = "inventory.returns.intake";

test("ISO-2: the warehouse-scoped neighbours decide capability, then company, then warehouse scope", { skip: SKIP, concurrency: 1 }, async (t) => {
  const { q, person, pool } = await serviceBaselineTenant(t, { urlBase: URL_BASE, tenant: T, prefix: PREFIX });
  const acq = require("../lib/eosOps/serializedAssetAcquireOperations.js");
  const spo = require("../lib/eosOps/supplierPurchaseOrderReceiving.js");
  const spc = require("../lib/eosOps/supplierReceiptCorrection.js");
  const cev = require("../lib/eosOps/costEvidenceSupplyCommand.js");
  const rets = require("../lib/eosOps/returnIntake.js");
  const { EOS_EQUIPMENT_OPERATIONS } = require("../lib/eosOps/equipmentOperations.js");
  const { createWarehouseBinAdministration } = require("../lib/eosOps/warehouseBinAdministration.js");
  const { scopedWarehouseIds } = require("../lib/eosOps/partsReads.js");
  const { resolveInventoryCompanyAuthority } = require("../lib/eosOps/inventoryCompanyAuthority.js");

  await certifyInventoryBaselineFixture(q, T);
  const warehouse = (id, key) => q(
    `INSERT INTO eos_ops.warehouses (id, tenant_id, operating_company_key, name, site_label, status, provenance, created_by, updated_by)
     VALUES ($1,$2,$3,$1,'Sampleton','ACTIVE','NATIVE','fixture','fixture')`, [id, T, key]);
  await warehouse("WH-T", "taylor");
  await warehouse("WH-V", "ventana");
  const part = (id, control, wholeUnit = false) => q(
    `INSERT INTO eos_ops.parts (id, tenant_id, created_by, internal_part_number, name, status, stocking_unit, control_type, stocking_class,
       expiry_tracked, consumable, returnable_core, whole_unit, version, updated_by)
     VALUES ($1,$2,'fixture',$1,$1,'ACTIVE','EACH',$3,'STOCKED',false,false,false,$4,1,'fixture')`, [id, T, control, wholeUnit]);
  await part("P-SER", "SERIALIZED");
  await part("P-QTY", "STANDARD");
  await part("P-UNIT", "SERIALIZED", true);

  // ── the people ──
  const staff = async (label, { scopes = [], employee = true } = {}) => {
    const subject = `uid-${PREFIX}-${label}`;
    const p = await person(subject, [], employee ? { id: `e-${PREFIX}-${label}`, name: label, company: "taylor" } : null);
    for (const wh of scopes) {
      await q(`INSERT INTO eos_workforce.employee_operational_scopes (id, tenant_id, employee_id, scope_type, scope_id, effective_from, assigned_by)
               VALUES ($1,$2,$3,'WAREHOUSE',$4, now(), 'fixture')`, [`os-${PREFIX}-${label}-${wh}`, T, `e-${PREFIX}-${label}`, wh]);
    }
    return p.principalId;
  };
  const inCo = await staff("inco", { scopes: ["WH-T"] });
  const foreignScoped = await staff("foreign", { scopes: ["WH-T", "WH-V"] }); // Noor: Taylor, scoped at a Ventana warehouse, no Ventana authority
  const noCompany = await staff("nocompany", { employee: false });
  const cross = await staff("cross", { scopes: ["WH-T", "WH-V"] });
  await grantSyntheticCompanyAuthority(pool, T, cross, ["taylor", "ventana"]);
  const adminId = (await q(`SELECT id FROM eos_policy.principals WHERE external_subject = $1`, [`uid-${PREFIX}-admin`])).rows[0].id;

  const as = (principalId, caps) => ({ tenantId: T, principalId, capabilities: new Set(caps) });
  const refusal = async (fn) => { try { await fn(); } catch (err) { return err; } return assert.fail("expected a refusal"); };
  /** [code, category, message] with the named ids masked, for "refused EXACTLY as the nonexistent twin is". */
  const shapeOf = (e, ...ids) => [e.code, e.category, ids.reduce((m, id) => m.split(id).join("<id>"), e.message)];
  const counts = async () => {
    const one = async (sql) => (await q(sql)).rows[0].n;
    return {
      custody: await one(`SELECT count(*)::int n FROM eos_ops.serialized_custody`),
      acquisitions: await one(`SELECT count(*)::int n FROM eos_ops.serialized_asset_acquisitions`),
      movements: await one(`SELECT count(*)::int n FROM eos_ops.inventory_movements`),
      receipts: await one(`SELECT count(*)::int n FROM eos_ops.receiving_orders`),
      corrections: await one(`SELECT count(*)::int n FROM eos_ops.receiving_corrections`),
      returns: await one(`SELECT count(*)::int n FROM eos_ops.inventory_returns`),
      bins: await one(`SELECT count(*)::int n FROM eos_ops.bins`),
      supplies: await one(`SELECT count(*)::int n FROM eos_finance.cost_evidence_supplies`),
      audits: await one(`SELECT count(*)::int n FROM eos_policy.audit_events`),
    };
  };
  const noWrite = async (fn) => { const before = await counts(); const out = await fn(); assert.deepEqual(await counts(), before, "a refusal precedes every write"); return out; };

  // ════════════════════ 1. SERIALIZED-UNIT INTAKE -- the cross-company WRITE ════════════════════
  const ACQ = { pool, postgresState: "ACTIVE" };
  const acquire = (principalId, input, caps = [ACQUIRE]) => acq.acquireEosSerializedAsset(ACQ, as(principalId, caps),
    { partId: "P-SER", reason: "OPENING_BALANCE", ...input });

  await t.test("intake: a same-company in-scope actor acquires a unit; the cross-company actor makes the Ventana unit the others must not reach", async () => {
    const mine = await acquire(inCo, { serialNo: "SN-T1", locationId: "WH-T", idempotencyKey: "iso2-acq-t1" });
    assert.deepEqual([mine.outcome, mine.locationId, mine.state], ["acquired", "WH-T", "AVAILABLE"]);
    const theirs = await acquire(cross, { serialNo: "SN-V1", locationId: "WH-V", idempotencyKey: "iso2-acq-v1" });
    assert.deepEqual([theirs.outcome, theirs.locationId], ["acquired", "WH-V"]);
  });

  await t.test("intake: a scope on ANOTHER company's warehouse is not company authority -- refused as an unknown warehouse, and NOTHING is written", async () => {
    const foreign = await noWrite(() => refusal(() => acquire(foreignScoped, { serialNo: "SN-X1", locationId: "WH-V", idempotencyKey: "iso2-acq-x1" })));
    assert.deepEqual([foreign.code, foreign.category], ["LOCATION_INVALID", "PRECONDITION_FAILED"]);
    const unknown = await refusal(() => acquire(foreignScoped, { serialNo: "SN-X2", locationId: "WH-NOPE", idempotencyKey: "iso2-acq-x2" }));
    assert.deepEqual(shapeOf(foreign, "WH-V"), shapeOf(unknown, "WH-NOPE"), "foreign == nonexistent");
    // Zero custody corruption: no custody row, acquisition, ledger movement or audit event for the refused unit, and the Ventana warehouse holds only its own unit.
    for (const sql of [
      `SELECT count(*)::int n FROM eos_ops.serialized_custody WHERE serial_number = 'SN-X1'`,
      `SELECT count(*)::int n FROM eos_ops.serialized_asset_acquisitions WHERE serial_number = 'SN-X1'`,
      `SELECT count(*)::int n FROM eos_ops.inventory_movements WHERE serial_number = 'SN-X1'`,
      `SELECT count(*)::int n FROM eos_policy.audit_events WHERE target_id LIKE '%SN-X1%'`,
    ]) assert.equal((await q(sql)).rows[0].n, 0, sql);
    assert.deepEqual((await q(`SELECT serial_number FROM eos_ops.serialized_custody WHERE location_id = 'WH-V'`)).rows.map((r) => r.serial_number), ["SN-V1"]);
  });

  await t.test("intake: the Ventana unit is never read back, replayed or locked for a caller outside Ventana", async () => {
    // The EXACT request that made the Ventana unit, replayed by an actor with only a Ventana scope: an unknown warehouse, not "replayed", not a disclosure.
    const replay = await noWrite(() => refusal(() => acquire(foreignScoped, { serialNo: "SN-V1", locationId: "WH-V", idempotencyKey: "iso2-acq-v1" })));
    assert.equal(replay.code, "LOCATION_INVALID");
    // A Taylor actor naming the same part and serial at its OWN warehouse gets the ordinary conflict: nothing of the Ventana unit (place, reason, note) is disclosed.
    const clash = await noWrite(() => refusal(() => acquire(inCo, { serialNo: "SN-V1", locationId: "WH-T", idempotencyKey: "iso2-acq-clash" })));
    assert.deepEqual([clash.code, clash.category], ["ALREADY_EXISTS_CONFLICT", "CONFLICT"]);
    assert.doesNotMatch(clash.message, /WH-V|OPENING_BALANCE|receipt/);
    // The Ventana unit is untouched: one custody row, one ledger fact, still at WH-V.
    assert.deepEqual((await q(`SELECT location_id, operating_company_key FROM eos_ops.serialized_custody WHERE serial_number = 'SN-V1'`)).rows.map((r) => [r.location_id, r.operating_company_key]), [["WH-V", "ventana"]]);
    assert.equal((await q(`SELECT count(*)::int n FROM eos_ops.inventory_movements WHERE serial_number = 'SN-V1'`)).rows[0].n, 1);
    // The owner company's own replay is still a replay (no regression).
    assert.equal((await acquire(cross, { serialNo: "SN-V1", locationId: "WH-V", idempotencyKey: "iso2-acq-v1" })).outcome, "replayed");
  });

  await t.test("intake: capability first, then company authority", async () => {
    const noCap = await noWrite(() => refusal(() => acquire(noCompany, { serialNo: "SN-N0", locationId: "WH-T", idempotencyKey: "iso2-acq-n0" }, [])));
    assert.equal(noCap.code, "PERMISSION_DENIED");
    const none = await noWrite(() => refusal(() => acquire(noCompany, { serialNo: "SN-N1", locationId: "WH-T", idempotencyKey: "iso2-acq-n1" })));
    assert.deepEqual([none.code, none.category], ["COMPANY_AUTHORITY_REQUIRED", "FORBIDDEN"]);
  });

  // ════════════════════ 2. SUPPLIER PURCHASE ORDER RECEIVING, VOID AND COST EVIDENCE ════════════════════
  let seq = 0;
  const order = async (companyKey) => {
    const id = `po-${PREFIX}-${++seq}`;
    await q(`INSERT INTO eos_ops.supplier_purchase_orders (id, tenant_id, operating_company_key, supplier_id, external_po_number, status, version, created_by, updated_by)
             VALUES ($1,$2,$3,NULL,NULL,'SENT',0,'fixture','fixture')`, [id, T, companyKey]);
    await q(`INSERT INTO eos_ops.supplier_purchase_order_lines (tenant_id, purchase_order_id, line_id, part_id, ordered_quantity) VALUES ($1,$2,'L1','P-QTY',10)`, [T, id]);
    return id;
  };
  const receiveReq = (poId, locationId, over = {}) => ({
    source: { type: "PURCHASE_ORDER", purchaseOrderId: poId }, receivingLocation: { type: "WAREHOUSE", locationId },
    lines: [{ lineId: "L1", partId: "P-QTY", receivedQuantity: 4 }], idempotencyKey: `idem-${poId}-${locationId}`, ...over,
  });
  const receive = (principalId, input, caps = [RECEIVE]) => spo.receiveSupplierPurchaseOrder({ pool }, as(principalId, caps), input);
  const poT = await order("taylor");
  const poV = await order("ventana");
  const poV2 = await order("ventana");
  const poV3 = await order("ventana");
  let receiptT, receiptV, receiptV2;

  await t.test("supplier receipt: same-company success; the cross-company actor makes the Ventana receipts", async () => {
    receiptT = (await receive(inCo, receiveReq(poT, "WH-T"))).receivingId;
    receiptV = (await receive(cross, receiveReq(poV, "WH-V"))).receivingId;
    receiptV2 = (await receive(cross, receiveReq(poV2, "WH-V"))).receivingId;
    assert.ok(receiptT && receiptV && receiptV2);
  });

  await t.test("supplier receipt: a scope on another company's warehouse reaches neither the order nor the warehouse -- both read as nonexistent, nothing is written", async () => {
    const foreignOrder = await noWrite(() => refusal(() => receive(foreignScoped, receiveReq(poV, "WH-V", { idempotencyKey: "iso2-x-1" }))));
    const missingOrder = await refusal(() => receive(foreignScoped, receiveReq("po-does-not-exist", "WH-V", { idempotencyKey: "iso2-x-2" })));
    assert.deepEqual(shapeOf(foreignOrder), shapeOf(missingOrder));
    assert.equal(foreignOrder.code, "PURCHASE_ORDER_NOT_FOUND");
    // Its OWN company's order into the foreign warehouse: the destination reads as an unknown one.
    const foreignWh = await noWrite(() => refusal(() => receive(foreignScoped, receiveReq(poT, "WH-V", { idempotencyKey: "iso2-x-3" }))));
    const unknownWh = await refusal(() => receive(foreignScoped, receiveReq(poT, "WH-NOPE", { idempotencyKey: "iso2-x-4" })));
    assert.deepEqual(shapeOf(foreignWh, "WH-V"), shapeOf(unknownWh, "WH-NOPE"));
    // The reads: the Ventana order and its destinations are absent.
    assert.equal((await refusal(() => spo.readSupplierPurchaseOrderProgress({ pool }, as(foreignScoped, [RECEIVE]), { purchaseOrderId: poV }))).code, "PURCHASE_ORDER_NOT_FOUND");
    assert.equal((await refusal(() => spo.listSupplierReceivingLocationOptions({ pool }, as(foreignScoped, [RECEIVE]), { purchaseOrderId: poV }))).code, "PURCHASE_ORDER_NOT_FOUND");
    const listed = (await spo.listReceivableSupplierPurchaseOrders({ pool }, as(foreignScoped, [RECEIVE]), {})).purchaseOrders.map((o) => o.purchaseOrderId);
    assert.ok(listed.includes(poT) && !listed.includes(poV), "only the caller's companies' orders are listed");
    const noCo = await noWrite(() => refusal(() => receive(noCompany, receiveReq(poT, "WH-T", { idempotencyKey: "iso2-x-5" }))));
    assert.deepEqual([noCo.code, noCo.category], ["COMPANY_AUTHORITY_REQUIRED", "FORBIDDEN"]);
  });

  const correct = (principalId, receivingId, key, caps = [CORRECT]) => spc.correctSupplierPurchaseOrderReceipt({ pool }, as(principalId, caps),
    { receivingId, reason: "recorded in error", idempotencyKey: key });

  await t.test("supplier receipt void: a foreign-scoped actor sees the Ventana receipt as nonexistent; no authority at all is COMPANY_AUTHORITY_REQUIRED; same-company success", async () => {
    const foreign = await noWrite(() => refusal(() => correct(foreignScoped, receiptV, "iso2-void-x")));
    const missing = await refusal(() => correct(foreignScoped, "rcv_does_not_exist", "iso2-void-y"));
    assert.deepEqual(shapeOf(foreign, receiptV), shapeOf(missing, "rcv_does_not_exist"));
    assert.equal(foreign.code, "RECEIPT_NOT_FOUND");
    assert.equal((await noWrite(() => refusal(() => correct(noCompany, receiptT, "iso2-void-n")))).code, "COMPANY_AUTHORITY_REQUIRED");
    assert.equal((await correct(inCo, receiptT, "iso2-void-t")).outcome, "applied");
  });

  await t.test("cost evidence: a foreign-scoped actor supplies nothing for a Ventana receipt (nonexistent, no write); no authority is COMPANY_AUTHORITY_REQUIRED", async () => {
    const supply = (principalId, receivingId) => cev.supplyReceiptCostEvidence({ pool }, as(principalId, [CORRECT]),
      { receivingId, receivingLineId: "L1", unitPriceMinor: 1500, currency: "USD", reason: "vendor invoice" });
    const foreign = await noWrite(() => refusal(() => supply(foreignScoped, receiptV)));
    const missing = await refusal(() => supply(foreignScoped, "rcv_does_not_exist"));
    assert.deepEqual([foreign.code, foreign.category, foreign.message], [missing.code, missing.category, missing.message]);
    assert.equal(foreign.code, "RECEIPT_NOT_FOUND");
    const noCo = await noWrite(() => refusal(() => supply(noCompany, receiptV)));
    assert.deepEqual([noCo.code, noCo.category], ["COMPANY_AUTHORITY_REQUIRED", "FORBIDDEN"]);
    // Its OWN company's receipt gets past the company filter (the refusal, if any, is a later one).
    const own = await refusal(() => supply(cross, receiptV2).then(() => { throw Object.assign(new Error("supplied"), { code: "SUPPLIED" }); }));
    assert.notEqual(own.code, "RECEIPT_NOT_FOUND");
  });

  // ════════════════════ 3. RETURNS INTAKE, EQUIPMENT UNITS, RACKING ════════════════════
  const returnReq = (over) => ({ operatingCompanyId: "taylor", warehouseId: null, partId: "P-QTY", source: "CUSTOMER", condition: "OPENED", quantity: 1, idempotencyKey: `ret-${++seq}`, ...over });
  const intake = (principalId, input) => rets.recordReturnIntake({ pool }, as(principalId, [RETURN_INTAKE]), input);

  await t.test("returns intake: a Ventana warehouse is not reachable through a Ventana scope alone; same-company success", async () => {
    assert.equal((await intake(inCo, returnReq({ warehouseId: "WH-T" }))).outcome, "recorded");
    const foreignWh = await noWrite(() => refusal(() => intake(foreignScoped, returnReq({ warehouseId: "WH-V" }))));
    assert.equal(foreignWh.code, "WAREHOUSE_NOT_FOUND");
    const foreignCo = await noWrite(() => refusal(() => intake(foreignScoped, returnReq({ operatingCompanyId: "ventana", warehouseId: "WH-V" }))));
    assert.equal(foreignCo.code, "OPERATING_COMPANY_NOT_GOVERNED");
    const none = await noWrite(() => refusal(() => intake(noCompany, returnReq({}))));
    assert.equal(none.code, "COMPANY_AUTHORITY_REQUIRED");
    const options = await rets.listReturnIntakeOptions({ pool }, as(foreignScoped, [RETURN_INTAKE]), {});
    assert.deepEqual(options.warehouses.map((w) => w.warehouseId), ["WH-T"]);
  });

  await t.test("available equipment units: a Ventana unit is absent from a foreign-scoped actor's list and lookup", async () => {
    await q(`INSERT INTO eos_ops.serialized_custody (id, tenant_id, operating_company_key, part_id, serial_number, status, location_type, location_id, updated_by)
             VALUES ('ser-iso2-t',$1,'taylor','P-UNIT','EU-T','AVAILABLE','WAREHOUSE','WH-T','fixture'), ('ser-iso2-v',$1,'ventana','P-UNIT','EU-V','AVAILABLE','WAREHOUSE','WH-V','fixture')`, [T]);
    const list = (principalId, input = {}, caps = [SER_READ]) => EOS_EQUIPMENT_OPERATIONS.listAvailableEquipmentUnits({ pool, equipmentPostgresState: "ACTIVE" },
      { actor: as(principalId, caps), operational: {} }, input);
    assert.deepEqual((await list(inCo)).units.map((u) => u.serialNumber), ["EU-T"]);
    assert.deepEqual((await list(foreignScoped)).units.map((u) => u.serialNumber), ["EU-T"]);
    assert.deepEqual((await list(foreignScoped, { serialNumber: "EU-V" })).units, [], "a serial lookup reaches nothing of another company");
    assert.deepEqual((await list(cross)).units.map((u) => u.serialNumber).sort(), ["EU-T", "EU-V"]);
    assert.equal((await refusal(() => list(noCompany))).code, "COMPANY_AUTHORITY_REQUIRED");
  });

  const bins = createWarehouseBinAdministration(pool);
  const rackCall = (op, principalId, input) => bins(op, { tenantId: T, principalId }, { ...input, reason: "racking layout" }, "racking layout");

  await t.test("racking: warehouses and bins of another company read as nonexistent; no authority is COMPANY_AUTHORITY_REQUIRED", async () => {
    assert.deepEqual((await rackCall("listRackingWarehouses", foreignScoped, {})).items.map((w) => w.warehouseId), ["WH-T"]);
    const foreignBins = await refusal(() => rackCall("listRackingBins", foreignScoped, { warehouseId: "WH-V" }));
    const missingBins = await refusal(() => rackCall("listRackingBins", foreignScoped, { warehouseId: "WH-NOPE" }));
    assert.deepEqual([foreignBins.code, foreignBins.category], [missingBins.code, missingBins.category]);
    assert.equal((await refusal(() => rackCall("listRackingWarehouses", noCompany, {}))).code, "COMPANY_AUTHORITY_REQUIRED");
  });

  // ════════════════════ 4. THE SHARED LOOKUP BOUNDARY ════════════════════
  await t.test("scopedWarehouseIds: company keys are required; a scope on another company's warehouse is dropped", async () => {
    const actor = as(foreignScoped, []);
    assert.deepEqual(await scopedWarehouseIds(pool, actor, { companyKeys: ["taylor"] }), ["WH-T"]);
    assert.deepEqual(await scopedWarehouseIds(pool, actor, { companyKeys: ["taylor", "ventana"] }), ["WH-T", "WH-V"]);
    assert.deepEqual(await scopedWarehouseIds(pool, actor, { companyKeys: [] }), []);
    await assert.rejects(scopedWarehouseIds(pool, actor), TypeError, "omitting the keys fails closed");
    await assert.rejects(scopedWarehouseIds(pool, actor, {}), TypeError);
  });

  // ════════════════════ 5. OWNER RULING OD-ISO-2: THE PROTECTED ADMINISTRATOR ════════════════════
  await t.test("the protected Administrator holds every governed company here too: it reads, and (with its Employee scope) writes in Taylor AND Ventana; the capability is still required and no scope is bypassed", async () => {
    assert.deepEqual((await resolveInventoryCompanyAuthority(pool, T, adminId)).reason, "ADMINISTRATOR_ALL_COMPANIES");

    // READS: the supplier-PO order list, available units, racking and return options cover both companies (no Employee at all).
    const listed = (await spo.listReceivableSupplierPurchaseOrders({ pool }, as(adminId, [RECEIVE]), {})).purchaseOrders.map((o) => o.purchaseOrderId);
    assert.ok(listed.includes(poT) && listed.includes(poV3), "the Administrator lists the orders of both companies");
    const units = (await EOS_EQUIPMENT_OPERATIONS.listAvailableEquipmentUnits({ pool, equipmentPostgresState: "ACTIVE" },
      { actor: as(adminId, [SER_READ]), operational: {} }, {})).units.map((u) => u.serialNumber).sort();
    assert.deepEqual(units, ["EU-T", "EU-V"]);
    assert.deepEqual((await rackCall("listRackingWarehouses", adminId, {})).items.map((w) => w.warehouseId).sort(), ["WH-T", "WH-V"]);
    const options = await rets.listReturnIntakeOptions({ pool }, as(adminId, [RETURN_INTAKE]), {});
    assert.deepEqual(options.warehouses.map((w) => w.warehouseId).sort(), ["WH-T", "WH-V"]);
    assert.equal((await intake(adminId, returnReq({ operatingCompanyId: "ventana", warehouseId: "WH-V" }))).outcome, "recorded");

    // The CAPABILITY is still required, and company authority does not replace the Employee / warehouse-scope rule: no scope bypass.
    assert.equal((await noWrite(() => refusal(() => receive(adminId, receiveReq(poV3, "WH-V", { idempotencyKey: "iso2-adm-1" }), [])))).code, "CAPABILITY_REQUIRED");
    for (const [what, fn, code] of [
      ["receive", () => receive(adminId, receiveReq(poV3, "WH-V", { idempotencyKey: "iso2-adm-2" })), "EMPLOYEE_LINK_REQUIRED"],
      ["void", () => correct(adminId, receiptV, "iso2-adm-void"), "EMPLOYEE_LINK_REQUIRED"],
      ["acquire", () => acquire(adminId, { serialNo: "SN-A1", locationId: "WH-V", idempotencyKey: "iso2-adm-acq" }), "EMPLOYEE_LINK_REQUIRED"],
    ]) assert.equal((await noWrite(() => refusal(fn))).code, code, what);

    // An Employee with a Taylor-only scope still cannot write into Ventana's warehouse; with the Ventana scope it can -- reach is the Administrator's, scope is unchanged.
    await q(`INSERT INTO eos_workforce.employees (id,tenant_id,employment_status,operating_company_id,display_name) VALUES ('e-iso2n-adm',$1,'ACTIVE','taylor','Admin Person')`, [T]);
    await q(`INSERT INTO eos_policy.employee_principal_links (id,tenant_id,principal_id,employee_id,operating_company_id,link_source,status,asserted_by,assertion_reason)
             VALUES ('lnk-iso2n-adm',$1,$2,'e-iso2n-adm','taylor','OPERATOR_ASSERTED','active','fixture','fixture')`, [T, adminId]);
    await q(`INSERT INTO eos_workforce.employee_operational_scopes (id, tenant_id, employee_id, scope_type, scope_id, effective_from, assigned_by)
             VALUES ('os-iso2n-adm-t',$1,'e-iso2n-adm','WAREHOUSE','WH-T', now(), 'fixture')`, [T]);
    assert.equal((await noWrite(() => refusal(() => receive(adminId, receiveReq(poV3, "WH-V", { idempotencyKey: "iso2-adm-3" }))))).code, "OUTSIDE_OPERATIONAL_SCOPE");
    assert.equal((await noWrite(() => refusal(() => acquire(adminId, { serialNo: "SN-A1", locationId: "WH-V", idempotencyKey: "iso2-adm-acq" })))).code, "OUTSIDE_OPERATIONAL_SCOPE");
    await q(`INSERT INTO eos_workforce.employee_operational_scopes (id, tenant_id, employee_id, scope_type, scope_id, effective_from, assigned_by)
             VALUES ('os-iso2n-adm-v',$1,'e-iso2n-adm','WAREHOUSE','WH-V', now(), 'fixture')`, [T]);
    assert.equal((await receive(adminId, receiveReq(poV3, "WH-V", { idempotencyKey: "iso2-adm-4" }))).outcome, "applied");
    assert.equal((await correct(adminId, receiptV2, "iso2-adm-void-2")).outcome, "applied");
    assert.equal((await acquire(adminId, { serialNo: "SN-A1", locationId: "WH-V", idempotencyKey: "iso2-adm-acq" })).outcome, "acquired");
  });
});
