// OWNER RULING OD-ISO-2 (2026-10-19, "admin should have all access") -- against a real postgres:16.
//
// A PROTECTED ADMINISTRATOR (the standing #223/#224/#227 already decide) holds company authority over EVERY governed company of the tenant for the inventory
// domains, through ONE named resolver branch (inventoryCompanyAuthority.ts, reason ADMINISTRATOR_ALL_COMPANIES). It supersedes #235 rule 4 for those domains only.
// It is not "any admin-ish holder": a NON-protected holder of the admin Role (here, one assigned only at an operating company) has no standing and, with no company
// authority of its own, is still refused COMPANY_AUTHORITY_REQUIRED. The capability checks are unchanged, and no command gains a warehouse-scope bypass.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { serviceBaselineTenant } from "./support/serviceBaselineTenant.mjs";
import { applyStockReservationMigration } from "./support/stockReservationMigration.mjs";
import { certifyInventoryBaselineFixture } from "./support/inventoryBaselineCertified.mjs";
import { grantSyntheticCompanyAuthority } from "./support/syntheticAvailability.mjs";

const require = createRequire(import.meta.url);
const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const T = "t-isoadm";
const PREFIX = "isoadm";
const ADMIN_SUBJECT = `uid-${PREFIX}-admin`;

test("A protected Administrator holds every governed company for the inventory domains; a non-protected admin-role holder does not", { skip: SKIP, concurrency: 1 }, async (t) => {
  const { q, repo, person, pool } = await serviceBaselineTenant(t, { urlBase: URL_BASE, tenant: T, prefix: PREFIX });
  await applyStockReservationMigration(pool);
  const reads = require("../lib/eosOps/partsReads.js");
  const cc = require("../lib/eosOps/cycleCountOperations.js");
  const rcv = require("../lib/eosOps/receiveReorderStockCommand.js");
  const { resolveInventoryCompanyAuthority } = require("../lib/eosOps/inventoryCompanyAuthority.js");
  const { createBin } = require("../lib/eosOps/warehouseBinRepository.js");

  await certifyInventoryBaselineFixture(q, T);
  const wh = (id, key) => q(`INSERT INTO eos_ops.warehouses (id, tenant_id, operating_company_key, name, site_label, status, provenance, created_by, updated_by)
                             VALUES ($1,$2,$3,$1,'Sampleton','ACTIVE','NATIVE','fixture','fixture')`, [id, T, key]);
  await wh("WH-T", "taylor");
  await wh("WH-V", "ventana");
  const binT = (await createBin(pool, T, "fixture", { warehouseId: "WH-T", area: "MAIN", aisle: "A", bay: 1, position: 1, idempotencyKey: "bin-t" })).id;
  const binV = (await createBin(pool, T, "fixture", { warehouseId: "WH-V", area: "MAIN", aisle: "A", bay: 1, position: 1, idempotencyKey: "bin-v" })).id;
  await q(`INSERT INTO eos_ops.parts (id, tenant_id, created_by, internal_part_number, name, status, stocking_unit, control_type, stocking_class,
             expiry_tracked, consumable, returnable_core, whole_unit, version, updated_by)
           VALUES ('PART-A',$1,'fixture','PART-A','PART-A','ACTIVE','EACH','STANDARD','STOCKED',false,false,false,false,1,'fixture')`, [T]);
  for (const [id, key, loc] of [["mv-t", "taylor", "WH-T"], ["mv-v", "ventana", "WH-V"]]) {
    await q(`INSERT INTO eos_ops.inventory_movements (id, tenant_id, operating_company_key, part_id, tracking_mode, location_type, location_id, movement_type, quantity_delta, source_kind, source_id, created_by)
             VALUES ($1,$2,$3,'PART-A','NONE','WAREHOUSE',$4,'RECEIVED',10,'TEST',$1,'fixture')`, [id, T, key, loc]);
  }

  // A receiver who works in BOTH companies makes one Reorder receipt in each (so the receipt history has both).
  const receiver = await person("uid-isoadm-recv", [], { id: "e-isoadm-recv", name: "Rae Receiver", company: "taylor" });
  await grantSyntheticCompanyAuthority(pool, T, receiver.principalId, ["taylor", "ventana"]);
  for (const w of ["WH-T", "WH-V"]) {
    await q(`INSERT INTO eos_workforce.employee_operational_scopes (id, tenant_id, employee_id, scope_type, scope_id, effective_from, assigned_by)
             VALUES ($1,$2,'e-isoadm-recv','WAREHOUSE',$3, now(), 'fixture')`, [`os-isoadm-${w}`, T, w]);
  }
  const receiptOf = async (rr, key, warehouse) => {
    await q(`INSERT INTO eos_ops.reorder_requests (id, tenant_id, operating_company_key, part_id, warehouse_id, status, requested_quantity, requested_by, updated_by, provenance)
             VALUES ($1,$2,$3,'PART-A',$4,'ORDERED',4,$5,$5,'NATIVE')`, [rr, T, key, warehouse, receiver.principalId]);
    await q(`INSERT INTO eos_ops.purchase_orders (id, tenant_id, operating_company_key, part_id, supplier_name, external_po_number, ordered_quantity, ordered_date, created_by)
             VALUES ($1,$2,$3,'PART-A','Acme Supply','PO-EXT-1',4, DATE '2026-09-01',$4)`, [rr, T, key, receiver.principalId]);
    return (await rcv.receiveReorderStock({ pool }, { tenantId: T, principalId: receiver.principalId, capabilities: new Set(["inventory.stock.receive"]) }, {
      source: { type: "REORDER_PURCHASE_ORDER", reorderRequestId: rr, purchaseOrderId: rr }, receivingLocation: { type: "WAREHOUSE", locationId: warehouse },
      lines: [{ lineId: "L1", partId: "PART-A", receivedQuantity: 4 }], idempotencyKey: `idem-${rr}` })).receivingId;
  };
  const receiptT = await receiptOf("rr-isoadm-t", "taylor", "WH-T");
  const receiptV = await receiptOf("rr-isoadm-v", "ventana", "WH-V");

  const adminId = (await q(`SELECT id FROM eos_policy.principals WHERE external_subject = $1`, [ADMIN_SUBJECT])).rows[0].id;
  // A NON-protected holder of the admin Role: assigned only at an operating company, never globally -- no standing, and (no Employee) no company authority.
  const scopedAdmin = await person("uid-isoadm-scoped", [], null);
  await repo.transact({ tenantId: T, uid: "fixture" }, async (tx) => {
    const v = await tx.bumpAccessVersion(scopedAdmin.principalId);
    return tx.createAssignment({ principalId: scopedAdmin.principalId, roleId: (await repo.getRoleByKey(T, "admin")).id, scopeType: "operatingCompany", scopeValue: "taylor",
      status: "active", grantedBy: "fixture", grantedAt: new Date().toISOString(), accessVersionAtGrant: v });
  });

  const READ = ["inventory.transaction.read", "warehouse.record.read", "receivingOrder.record.read"];
  const as = (principalId, caps = READ) => ({ tenantId: T, principalId, capabilities: new Set(caps) });
  const refusal = async (fn) => { try { await fn(); } catch (err) { return err; } assert.fail("expected a refusal"); };

  await t.test("the resolver: one named branch for the protected Administrator, the caller's own authority for everyone else", async () => {
    const admin = await resolveInventoryCompanyAuthority(pool, T, adminId);
    assert.deepEqual([admin.reason, [...admin.companyKeys].sort()], ["ADMINISTRATOR_ALL_COMPANIES", ["taylor", "ventana"]]);
    const scoped = await resolveInventoryCompanyAuthority(pool, T, scopedAdmin.principalId);
    assert.deepEqual([scoped.reason, [...scoped.companyKeys]], ["OWN", []], "an admin-role assignment at a company is not standing");
    const rec = await resolveInventoryCompanyAuthority(pool, T, receiver.principalId);
    assert.deepEqual([rec.reason, [...rec.companyKeys].sort()], ["OWN", ["taylor", "ventana"]]);
  });

  await t.test("a protected Administrator with NO Employee reads on-hand, movements, receipts and locations across Taylor AND Ventana", async () => {
    const a = as(adminId);
    const onHand = await reads.readInventoryOnHand({ pool }, a, {});
    assert.deepEqual(onHand.scopedWarehouseIds, ["WH-T", "WH-V"]);
    assert.deepEqual([...new Set(onHand.rows.map((r) => r.warehouseId))].sort(), ["WH-T", "WH-V"]);
    const movements = await reads.readInventoryMovements({ pool }, a, {});
    assert.deepEqual([...new Set(movements.items.map((m) => m.warehouseId))].sort(), ["WH-T", "WH-V"]);
    const receipts = await reads.listReceipts({ pool }, a, {});
    assert.deepEqual(receipts.items.map((r) => r.receiptId).sort(), [receiptT, receiptV].sort());
    assert.equal((await reads.readReceipt({ pool }, a, { receiptId: receiptV })).receiptId, receiptV);
    const locations = await reads.listInventoryLocations({ pool }, a, {});
    assert.deepEqual(locations.items.filter((l) => l.type === "WAREHOUSE").map((l) => l.locationId).sort(), ["WH-T", "WH-V"]);
    assert.deepEqual(locations.items.filter((l) => l.type === "BIN").map((l) => l.locationId).sort(), [binT, binV].sort());
    assert.deepEqual((await reads.listInventoryWarehouses({ pool }, a, {})).items.map((w) => w.warehouseId).sort(), ["WH-T", "WH-V"]);
    assert.equal((await reads.readPartBalance({ pool }, a, { partId: "PART-A" })).onHand.state, "KNOWN");
  });

  await t.test("the capability check is unchanged (the Administrator still needs it) and no command gains a warehouse-scope bypass", async () => {
    assert.equal((await refusal(() => reads.readInventoryOnHand({ pool }, as(adminId, []), {}))).code, "CAPABILITY_MISSING");
    const CC = { pool, postgresState: "ACTIVE" };
    const err = await refusal(() => cc.createEosCycleCountSheet(CC, as(adminId, ["inventory.cycleCount.create"]),
      { location: { type: "WAREHOUSE", locationId: "WH-V" }, idempotencyKey: "isoadm-cc" }));
    // Company authority is satisfied; the Employee/scope rule that applied before this change still refuses -- nothing narrower, nothing wider.
    assert.notEqual(err.code, "COMPANY_AUTHORITY_REQUIRED");
    assert.ok(["EMPLOYEE_LINK_REQUIRED", "WORK_ELIGIBILITY_MISSING", "OUTSIDE_OPERATIONAL_SCOPE"].includes(err.code), err.code);
    assert.equal((await q(`SELECT count(*)::int n FROM eos_ops.cycle_count_sheets`)).rows[0].n, 0);
  });

  await t.test("a NON-protected admin-role holder with no company authority is still refused COMPANY_AUTHORITY_REQUIRED", async () => {
    const s = as(scopedAdmin.principalId, [...READ, "inventory.cycleCount.create"]);
    for (const [what, fn] of [
      ["readInventoryOnHand", () => reads.readInventoryOnHand({ pool }, s, {})], ["readInventoryMovements", () => reads.readInventoryMovements({ pool }, s, {})],
      ["listReceipts", () => reads.listReceipts({ pool }, s, {})], ["readReceipt", () => reads.readReceipt({ pool }, s, { receiptId: receiptT })],
      ["listInventoryLocations", () => reads.listInventoryLocations({ pool }, s, {})],
      ["createCycleCountSheet", () => cc.createEosCycleCountSheet({ pool, postgresState: "ACTIVE" }, s, { location: { type: "WAREHOUSE", locationId: "WH-T" }, idempotencyKey: "isoadm-cc2" })],
    ]) assert.equal((await refusal(fn)).code, "COMPANY_AUTHORITY_REQUIRED", what);
  });
});
