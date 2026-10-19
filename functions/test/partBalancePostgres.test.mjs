// THE PART BALANCE, ON POSTGRESQL -- against a real postgres:16 (Firebase exit B3-x; DECISIONS #B3-x).
//
// readPartBalance is the EOS replacement for the Firebase getPartBalance: on-hand / reserved / available / on-order of ONE Part, with the
// Firebase three-valued figures (KNOWN / UNKNOWN / NOT_COUNTED_BY_QUANTITY) and the ratified arithmetic. It proves: capability first then
// company; the figures; UNKNOWN is never 0; reserved is company-wide Work Order commitments; available floors at 0 and is UNKNOWN when on-hand
// is; on-order nets receipts; serial parts are not counted by quantity; and COMPANY + WAREHOUSE ISOLATION (an out-of-scope row is absent
// from every figure, not merely hidden). A read writes nothing.
import { endPoolAndDrain } from "./support/poolTeardown.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import pg from "pg";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const reads = require("../lib/eosOps/partsReads.js");
const spo = require("../lib/eosOps/supplierPurchaseOrderReceiving.js");
const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");

const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

const READ = "inventory.transaction.read";
const RECEIVE = "inventory.stock.receive";

test("Part balance on PostgreSQL: three-valued figures, scoped to the caller's companies and warehouses", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `bal_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let pool;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => {
    await endPoolAndDrain(pool);
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations"], { maxBuffer: 256 * 1024 * 1024,
    cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrlFor(name) }, stdio: "pipe",
  });
  pool = new pg.Pool({ connectionString: dbUrlFor(name), max: 8 });
  const q = (text, values = []) => pool.query(text, values);
  const repo = new PostgresPolicyRepository(pool);

  await q(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ('t1','t1','T1')`);
  const principal = async (subject) => repo.transact({ tenantId: "t1", uid: "uid-fixture" }, async (tx) => {
    const p = await tx.createPrincipal({ externalSubject: subject, identityProvider: "firebase" });
    await tx.createTenantMembership(p.id);
    return p.id;
  });
  const receiver = await principal("uid-receiver");
  const receiver2 = await principal("uid-receiver-2");
  const ventanaReceiver = await principal("uid-ventana");
  const nobody = await principal("uid-no-employee");
  const crossReader = await principal("uid-cross-company");

  await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id, operating_company_id, status, source, established_by, updated_by)
           VALUES ('t1','taylor','ACTIVE','fixture','f','f'), ('t1','ventana','ACTIVE','fixture','f','f')`);
  await q(`INSERT INTO eos_policy.tenant_operating_company_keys
             (tenant_id, operating_company_id, operating_company_key, status, provenance, source, established_by, updated_by)
           VALUES ('t1','taylor','sample-co','ACTIVE','NATIVE','fixture','f','f'), ('t1','ventana','ventana-co','ACTIVE','NATIVE','fixture','f','f')`);
  const warehouse = (id, key, status = "ACTIVE") => q(
    `INSERT INTO eos_ops.warehouses (id, tenant_id, operating_company_key, name, site_label, status, provenance, created_by, updated_by)
     VALUES ($1,'t1',$2,$1,'Sampleton',$3,'NATIVE','fixture','fixture')`, [id, key, status]);
  await warehouse("wh-1", "sample-co");
  await warehouse("wh-2", "sample-co");
  await warehouse("wh-closed", "sample-co", "INACTIVE");
  await warehouse("wh-v", "ventana-co");
  await q(`INSERT INTO eos_ops.bins (id, tenant_id, warehouse_id, area, aisle, bay, position, code, status, idempotency_key, created_by, updated_by)
           VALUES ('bin_1111111111111111111111111111111111111111','t1','wh-1','MAIN','A',1,1,'MAIN-A-1-1','ACTIVE','bin-fixture','fixture','fixture')`);

  await q(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id, updated_at)
           VALUES ('e-r','t1','ACTIVE','taylor','2020-01-01T00:00:00Z'), ('e-r2','t1','ACTIVE','taylor','2020-01-01T00:00:00Z'),
                  ('e-v','t1','ACTIVE','ventana','2020-01-01T00:00:00Z'), ('e-x','t1','ACTIVE','taylor','2020-01-01T00:00:00Z')`);
  await q(`INSERT INTO eos_policy.employee_principal_links (id, tenant_id, principal_id, employee_id, operating_company_id, link_source, asserted_by, assertion_reason, status)
           VALUES ('epl-r','t1',$1,'e-r','taylor','OPERATOR_ASSERTED','f','test','active'),
                  ('epl-r2','t1',$2,'e-r2','taylor','OPERATOR_ASSERTED','f','test','active'),
                  ('epl-v','t1',$3,'e-v','ventana','OPERATOR_ASSERTED','f','test','active'),
                  ('epl-x','t1',$4,'e-x','taylor','OPERATOR_ASSERTED','f','test','active')`, [receiver, receiver2, ventanaReceiver, crossReader]);
  {
    const gc = await pool.connect();
    try {
      await gc.query("BEGIN");
      await gc.query(`SELECT set_config('eos_policy.administration_command', 'on', true)`);
      await gc.query(`INSERT INTO eos_policy.employee_company_authority_grants (id, tenant_id, employee_id, operating_company_id, reason, granted_by)
                      VALUES ('ecag-x-v','t1','e-x','ventana','fixture: reach both companies','f')`);
      await gc.query("COMMIT");
    } catch (e) { await gc.query("ROLLBACK"); throw e; } finally { gc.release(); }
  }
  // receiver: wh-1 + wh-closed; receiver2: wh-1 + wh-2; ventana receiver: wh-v; the cross reader: wh-1 + wh-v.
  await q(`INSERT INTO eos_workforce.employee_operational_scopes (id, tenant_id, employee_id, scope_type, scope_id, effective_from, assigned_by)
           VALUES ('os-r-1','t1','e-r','WAREHOUSE','wh-1', now(),'fixture'), ('os-r-c','t1','e-r','WAREHOUSE','wh-closed', now(),'fixture'),
                  ('os-r2-1','t1','e-r2','WAREHOUSE','wh-1', now(),'fixture'), ('os-r2-2','t1','e-r2','WAREHOUSE','wh-2', now(),'fixture'),
                  ('os-v-v','t1','e-v','WAREHOUSE','wh-v', now(),'fixture'),
                  ('os-x-1','t1','e-x','WAREHOUSE','wh-1', now(),'fixture'), ('os-x-v','t1','e-x','WAREHOUSE','wh-v', now(),'fixture')`);

  const part = (id, controlType) => q(
    `INSERT INTO eos_ops.parts (id, tenant_id, created_by, internal_part_number, name, status, stocking_unit,
                                control_type, stocking_class, expiry_tracked, consumable, returnable_core,
                                whole_unit, version, updated_by)
     VALUES ($1,'t1','fixture',$1,$1,'ACTIVE','EACH',$2,'STOCKED',false,false,false,false,1,'fixture')`, [id, controlType]);
  for (const id of ["PART-A", "PART-B", "PART-C", "PART-D"]) await part(id, "STANDARD");
  await part("PART-S", "SERIALIZED");

  let seq = 0;
  const move = (partId, locationType, locationId, delta, companyKey = "sample-co", type = "RECEIVED") => q(
    `INSERT INTO eos_ops.inventory_movements (id, tenant_id, operating_company_key, part_id, tracking_mode, location_type, location_id,
                                              movement_type, quantity_delta, source_kind, source_id, created_by)
     VALUES ($1,'t1',$2,$3,'NONE',$4,$5,$6,$7,'FIXTURE','fixture','fixture')`, [`mov-bal-${++seq}`, companyKey, partId, locationType, locationId, type, delta]);
  const commit = (partId, eventType, quantity, companyKey = "sample-co") => q(
    `INSERT INTO eos_ops.inventory_commitments (id, tenant_id, operating_company_key, work_order_id, part_id, event_type, quantity, idempotency_key, created_by)
     VALUES ($1,'t1',$2,'wo-fixture',$3,$4,$5,$1,'fixture')`, [`cmt-bal-${++seq}`, companyKey, partId, eventType, quantity]);
  const reorder = async (partId, warehouseId, status, quantity, companyKey = "sample-co") => {
    const id = `rr-bal-${++seq}`;
    await q(`INSERT INTO eos_ops.reorder_requests (id, tenant_id, operating_company_key, part_id, warehouse_id, status, requested_quantity, updated_by, provenance, requested_by)
             VALUES ($1,'t1',$2,$3,$4,$5,$6,$7,'NATIVE',$7)`, [id, companyKey, partId, warehouseId, status, quantity, receiver]);
    await q(`INSERT INTO eos_ops.purchase_orders (id, tenant_id, operating_company_key, part_id, supplier_name, external_po_number, ordered_quantity, ordered_date, created_by)
             VALUES ($1,'t1',$2,$3,'Acme',$1,$4,'2026-01-01',$5)`, [id, companyKey, partId, quantity, receiver]);
    return id;
  };
  const supplierOrder = async (id, companyKey, status, lines) => {
    await q(`INSERT INTO eos_ops.supplier_purchase_orders (id, tenant_id, operating_company_key, supplier_id, external_po_number, status, version, created_by, updated_by)
             VALUES ($1,'t1',$2,NULL,$3,$4,0,'fixture','fixture')`, [id, companyKey, `EXT-${id}`, status]);
    for (const [lineId, partId, quantity] of lines) {
      await q(`INSERT INTO eos_ops.supplier_purchase_order_lines (tenant_id, purchase_order_id, line_id, part_id, ordered_quantity) VALUES ('t1',$1,$2,$3,$4)`,
        [id, lineId, partId, quantity]);
    }
  };

  const actor = (principalId = receiver, caps = [READ]) => ({ tenantId: "t1", principalId, capabilities: new Set(caps) });
  const balance = (partId, a = actor()) => reads.readPartBalance({ pool }, a, { partId });
  const refusal = async (fn) => { try { await fn(); } catch (err) { return err; } assert.fail("expected a refusal"); };
  const fig = (f) => [f.state, f.value];
  const snapshot = async () => (await q(
    `SELECT (SELECT count(*) FROM eos_ops.inventory_movements)::int AS m, (SELECT count(*) FROM eos_ops.inventory_commitments)::int AS c,
            (SELECT count(*) FROM eos_ops.receiving_orders)::int AS r, (SELECT count(*) FROM eos_policy.audit_events)::int AS a`)).rows[0];

  await t.test("capability first, then company; an unknown Part and a stray field are refused", async () => {
    assert.equal((await refusal(() => balance("PART-A", actor(receiver, [])))).code, "CAPABILITY_MISSING");
    const noCompany = await refusal(() => balance("PART-A", actor(nobody)));
    assert.deepEqual([noCompany.code, noCompany.category], ["COMPANY_AUTHORITY_REQUIRED", "FORBIDDEN"]);
    assert.equal((await refusal(() => balance("PART-NOPE"))).code, "PART_NOT_FOUND");
    assert.equal((await refusal(() => reads.readPartBalance({ pool }, actor(), { partId: "PART-A", warehouseId: "wh-1" }))).code, "FIELD_NOT_ACCEPTED");
    assert.equal((await refusal(() => reads.readPartBalance({ pool }, actor(), {}))).code, "PART_ID_REQUIRED");
  });

  await t.test("a Part with no evidence at all is UNKNOWN, never 0 -- except reserved, which is a known 0", async () => {
    const b = await balance("PART-D");
    assert.deepEqual([fig(b.onHand), fig(b.reserved), fig(b.available), fig(b.onOrder)],
      [["UNKNOWN", null], ["KNOWN", 0], ["UNKNOWN", null], ["UNKNOWN", null]]);
    assert.deepEqual([b.trackingMode, b.byLocation], ["NONE", []]);
  });

  await t.test("on hand: bins roll up to their warehouse, an INACTIVE warehouse is excluded, and each caller sees only their own scope and companies", async () => {
    await move("PART-A", "WAREHOUSE", "wh-1", 10);
    await move("PART-A", "BIN", "bin_1111111111111111111111111111111111111111", 5);
    await move("PART-A", "WAREHOUSE", "wh-1", -2, "sample-co", "ADJUSTED");
    await move("PART-A", "WAREHOUSE", "wh-2", 3);
    await move("PART-A", "WAREHOUSE", "wh-closed", 4);
    await move("PART-A", "WAREHOUSE", "wh-v", 100, "ventana-co");
    const mine = await balance("PART-A");
    assert.deepEqual(fig(mine.onHand), ["KNOWN", 13], "wh-1 holds 10 + 5 (bin) - 2; wh-closed is inactive; wh-2 and wh-v are out of scope");
    assert.deepEqual(mine.byLocation, [{ warehouseId: "wh-1", quantity: 13 }]);
    assert.deepEqual(fig(mine.available), ["KNOWN", 13]);
    const two = await balance("PART-A", actor(receiver2));
    assert.deepEqual(fig(two.onHand), ["KNOWN", 16]);
    assert.deepEqual(two.byLocation, [{ warehouseId: "wh-1", quantity: 13 }, { warehouseId: "wh-2", quantity: 3 }], "largest first");
    const ventana = await balance("PART-A", actor(ventanaReceiver));
    assert.deepEqual(fig(ventana.onHand), ["KNOWN", 100], "another company's reader sees only its own stock");
    const both = await balance("PART-A", actor(crossReader));
    assert.deepEqual(fig(both.onHand), ["KNOWN", 113]);
    // A truck is not warehouse stock: a MOBILE movement never counts.
    await move("PART-A", "MOBILE", "truck-9", 50);
    assert.deepEqual(fig((await balance("PART-A")).onHand), ["KNOWN", 13]);
  });

  await t.test("reserved is the company's open Work Order commitments (RESERVED - RELEASED - CONSUMED); available floors at 0", async () => {
    await commit("PART-A", "RESERVED", 6);
    await commit("PART-A", "RELEASED", 1);
    await commit("PART-A", "CONSUMED", 2);
    await commit("PART-A", "RESERVED", 50, "ventana-co");
    const mine = await balance("PART-A");
    assert.deepEqual([fig(mine.reserved), fig(mine.available)], [["KNOWN", 3], ["KNOWN", 10]]);
    assert.deepEqual(fig((await balance("PART-A", actor(ventanaReceiver))).reserved), ["KNOWN", 50], "the other company's commitment is its own");
    await move("PART-C", "WAREHOUSE", "wh-1", 5);
    await commit("PART-C", "RESERVED", 9);
    const c = await balance("PART-C");
    assert.deepEqual([fig(c.onHand), fig(c.reserved), fig(c.available)], [["KNOWN", 5], ["KNOWN", 9], ["KNOWN", 0]]);
  });

  await t.test("on order: Reorder POs still ORDERED in the caller's warehouse scope; a received one is evidence but not outstanding", async () => {
    await reorder("PART-A", "wh-1", "ORDERED", 7);
    await reorder("PART-A", "wh-2", "ORDERED", 2);
    await reorder("PART-A", "wh-1", "RECEIVED", 50);
    await reorder("PART-A", "wh-v", "ORDERED", 900, "ventana-co");
    assert.deepEqual(fig((await balance("PART-A")).onOrder), ["KNOWN", 7]);
    assert.deepEqual(fig((await balance("PART-A", actor(receiver2))).onOrder), ["KNOWN", 9], "wh-2 is in this receiver's scope");
    assert.deepEqual(fig((await balance("PART-A", actor(ventanaReceiver))).onOrder), ["KNOWN", 900]);
    // Only a RECEIVED order: the Part is mentioned, nothing is outstanding -- a known 0, not UNKNOWN.
    await reorder("PART-D", "wh-1", "RECEIVED", 4);
    assert.deepEqual(fig((await balance("PART-D")).onOrder), ["KNOWN", 0]);
  });

  await t.test("on order: a supplier purchase order's REMAINING quantity (receipts netted), receivable statuses only, own company only", async () => {
    await supplierOrder("po-sent", "sample-co", "SENT", [["L1", "PART-B", 10]]);
    await supplierOrder("po-draft", "sample-co", "DRAFT", [["L1", "PART-B", 40]]);
    await supplierOrder("po-foreign", "ventana-co", "SENT", [["L1", "PART-B", 5]]);
    assert.deepEqual(fig((await balance("PART-B")).onOrder), ["KNOWN", 10], "the draft is not receivable; the foreign order is not this company's");
    const received = await spo.receiveSupplierPurchaseOrder({ pool, now: () => new Date("2026-10-18T15:00:00.000Z") }, actor(receiver, [RECEIVE]), {
      source: { type: "PURCHASE_ORDER", purchaseOrderId: "po-sent" },
      receivingLocation: { type: "WAREHOUSE", locationId: "wh-1" },
      lines: [{ lineId: "L1", partId: "PART-B", receivedQuantity: 4 }],
      idempotencyKey: "bal-k1",
    });
    assert.equal(received.outcome, "applied");
    const b = await balance("PART-B");
    assert.deepEqual([fig(b.onOrder), fig(b.onHand)], [["KNOWN", 6], ["KNOWN", 4]], "10 ordered - 4 received = 6 still inbound; the 4 are on hand");
    assert.deepEqual(fig((await balance("PART-B", actor(ventanaReceiver))).onOrder), ["KNOWN", 5]);
  });

  await t.test("a serial-tracked Part is NOT counted by quantity; its inbound quantity still is", async () => {
    await supplierOrder("po-serial", "sample-co", "SENT", [["L1", "PART-S", 2]]);
    const b = await balance("PART-S");
    assert.deepEqual([fig(b.onHand), fig(b.reserved), fig(b.available), fig(b.onOrder), b.trackingMode],
      [["NOT_COUNTED_BY_QUANTITY", null], ["NOT_COUNTED_BY_QUANTITY", null], ["NOT_COUNTED_BY_QUANTITY", null], ["KNOWN", 2], "SERIAL"]);
    assert.deepEqual(b.byLocation, []);
  });

  await t.test("a read writes nothing", async () => {
    const before = await snapshot();
    for (const id of ["PART-A", "PART-B", "PART-C", "PART-D", "PART-S"]) await balance(id);
    assert.deepEqual(await snapshot(), before);
  });
});
