// GOVERNED SUPPLIER PURCHASE ORDER AUTHORING, against a real postgres:16 (P-1; Owner direction 2026-10-19; DECISIONS #P-1; resolves OD-B3-1).
//
// It proves: create from the buyer's own PURCHASING_IN_PROGRESS requests (one line each, one supplier, one receiving warehouse) -> approve -> send ->
// receive through receiveSupplierPurchaseOrder, partial receipts included, with the linked requests CLOSING per line; gap-safe unique SPO numbering;
// idempotent replay (writes nothing); capability first, then company, then warehouse scope (a foreign company's request / warehouse / order reads EXACTLY
// as a nonexistent one); every refusal leaves ZERO trace; one audit row per command; segregation of duties; cancel releasing the requests;
// a request on at most ONE active PO of EITHER kind; and On Order never double counting.
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
const auth = require("../lib/eosOps/supplierPurchaseOrderAuthoring.js");
const spo = require("../lib/eosOps/supplierPurchaseOrderReceiving.js");
const fix = require("../lib/eosOps/supplierReceiptCorrection.js");
const lifecycle = require("../lib/eosOps/reorderLifecycleCommands.js");
const reads = require("../lib/eosOps/partsReads.js");
const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");

const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

const CREATE = "supplier.purchaseOrder.create";
const APPROVE = "supplier.purchaseOrder.approve";
const SEND = "supplier.purchaseOrder.send";
const CANCEL = "supplier.purchaseOrder.cancel";
const READ = "supplier.purchaseOrder.read";
const RECEIVE = "inventory.stock.receive";
const CORRECT = "inventory.receipt.correct";
const RECORD_PO = "reorder.request.recordPurchaseOrder";
const BALANCE_READ = "inventory.transaction.read";
const TERMS_READ = ["inventory.supplierTerms.read", "inventory.catalog.read", "inventory.catalog.cost.read"];
const FIXED = new Date("2026-10-19T15:00:00.000Z");

test("Supplier purchase order authoring on PostgreSQL: raise, approve, send, receive -- the whole closure or none of it", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `spa_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
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
  const buyer = await principal("uid-buyer");        // Taylor Employee, WAREHOUSE scope wh-1 and wh-2
  const buyer2 = await principal("uid-buyer-2");     // Taylor Employee, WAREHOUSE scope wh-1
  const approver = await principal("uid-approver");  // Taylor Employee, NO warehouse scope (a manager)
  const ventana = await principal("uid-ventana");    // Ventana Employee, scope wh-v
  const nobody = await principal("uid-nobody");      // no Employee link, no company authority

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
  await warehouse("wh-v", "ventana-co");
  await q(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id, updated_at)
           VALUES ('e-b','t1','ACTIVE','taylor','2020-01-01T00:00:00Z'), ('e-b2','t1','ACTIVE','taylor','2020-01-01T00:00:00Z'),
                  ('e-a','t1','ACTIVE','taylor','2020-01-01T00:00:00Z'), ('e-v','t1','ACTIVE','ventana','2020-01-01T00:00:00Z')`);
  await q(`INSERT INTO eos_policy.employee_principal_links (id, tenant_id, principal_id, employee_id, operating_company_id, link_source, asserted_by, assertion_reason, status)
           VALUES ('epl-b','t1',$1,'e-b','taylor','OPERATOR_ASSERTED','f','test','active'),
                  ('epl-b2','t1',$2,'e-b2','taylor','OPERATOR_ASSERTED','f','test','active'),
                  ('epl-a','t1',$3,'e-a','taylor','OPERATOR_ASSERTED','f','test','active'),
                  ('epl-v','t1',$4,'e-v','ventana','OPERATOR_ASSERTED','f','test','active')`, [buyer, buyer2, approver, ventana]);
  await q(`INSERT INTO eos_workforce.employee_operational_scopes (id, tenant_id, employee_id, scope_type, scope_id, effective_from, assigned_by)
           VALUES ('os-b-1','t1','e-b','WAREHOUSE','wh-1', now(),'fixture'), ('os-b-2','t1','e-b','WAREHOUSE','wh-2', now(),'fixture'),
                  ('os-b2-1','t1','e-b2','WAREHOUSE','wh-1', now(),'fixture'), ('os-v-v','t1','e-v','WAREHOUSE','wh-v', now(),'fixture')`);

  const part = (id, controlType = "STANDARD") => q(
    `INSERT INTO eos_ops.parts (id, tenant_id, created_by, internal_part_number, name, status, stocking_unit,
                                control_type, stocking_class, expiry_tracked, consumable, returnable_core,
                                whole_unit, version, updated_by)
     VALUES ($1,'t1','fixture',$1,$1,'ACTIVE','EACH',$2,'STOCKED',false,false,false,false,1,'fixture')`, [id, controlType]);
  await part("PART-A");
  await part("PART-B");
  await part("PART-C");
  const supplier = (id, status = "ACTIVE") => q(
    `INSERT INTO eos_ops.suppliers (tenant_id, supplier_id, name, normalized_key, status, version, created_by, updated_by)
     VALUES ('t1',$1,$2,lower($2),$3,1,'fixture','fixture')`, [id, `Supplier ${id}`, status]);
  await supplier("SUP-ACME");
  await supplier("SUP-OFF", "INACTIVE");
  await q(`INSERT INTO eos_ops.supplier_catalog_items (tenant_id, part_id, supplier_id, supplier_sku, cost, currency, lead_time_days, availability,
             status, version, created_by, updated_by)
           VALUES ('t1','PART-A','SUP-ACME','A-1', 12.3456, 'USD', 4, 'AVAILABLE', 'ACTIVE', 1, 'fixture', 'fixture')`);

  let seq = 0;
  /** A Reorder Request (plus its active assignment). Defaults: the buyer's own, PURCHASING_IN_PROGRESS, 10 x PART-A for wh-1. */
  const request = async (over = {}) => {
    const id = over.id ?? `rr-${++seq}`;
    const r = { warehouseId: "wh-1", companyKey: "sample-co", status: "PURCHASING_IN_PROGRESS", partId: "PART-A", quantity: 10, assignee: "e-b", ...over };
    await q(`INSERT INTO eos_ops.reorder_requests (id, tenant_id, operating_company_key, part_id, warehouse_id, status, requested_quantity, requested_by, updated_by, provenance)
             VALUES ($1,'t1',$2,$3,$4,$5,$6,$7,$7,'NATIVE')`, [id, r.companyKey, r.partId, r.warehouseId, r.status, r.quantity, buyer]);
    if (r.assignee) {
      await q(`INSERT INTO eos_ops.reorder_request_assignments (id, tenant_id, reorder_request_id, assigned_employee_id, effective_from, provenance, assigned_by_principal_id)
               VALUES ($1,'t1',$2,$3,now(),'NATIVE',$4)`, [`asg-${id}`, id, r.assignee, buyer]);
    }
    return id;
  };

  const actor = (caps, principalId = buyer) => ({ tenantId: "t1", principalId, capabilities: new Set(caps) });
  const BUY = [CREATE, SEND, READ];
  const key = () => `k-${randomUUID().slice(0, 10)}`;
  const create = (lines, over = {}, a = actor(BUY), now = () => FIXED) => auth.createSupplierPurchaseOrder({ pool, now }, a,
    { supplierId: "SUP-ACME", receivingWarehouseId: "wh-1", lines, idempotencyKey: key(), ...over });
  const transition = (purchaseOrderId, action, over = {}, a = actor([APPROVE, SEND, CANCEL, READ], approver)) =>
    auth.transitionSupplierPurchaseOrder({ pool, now: () => FIXED }, a,
      { purchaseOrderId, action, expectedVersion: 0, idempotencyKey: key(), ...(action === "CANCEL" ? { reason: "supplier withdrew the quote" } : {}), ...over });
  const refusal = async (fn) => { try { await fn(); } catch (err) { return err; } assert.fail("expected a refusal"); };
  const one = async (sql, v = []) => (await q(sql, v)).rows[0];
  const counts = async () => (await one(
    `SELECT (SELECT count(*) FROM eos_ops.supplier_purchase_orders)::int AS pos, (SELECT count(*) FROM eos_ops.supplier_purchase_order_lines)::int AS lines,
            (SELECT count(*) FROM eos_ops.supplier_po_commands)::int AS commands,
            (SELECT COALESCE(sum(last_value),0) FROM eos_ops.supplier_po_number_counters)::int AS counters,
            (SELECT count(*) FROM eos_policy.audit_events)::int AS audits,
            (SELECT count(*) FROM eos_ops.reorder_requests WHERE status::text = 'ORDERED')::int AS ordered,
            (SELECT COALESCE(sum(version),0) FROM eos_ops.supplier_purchase_orders)::int AS versions,
            (SELECT count(*) FROM eos_ops.receiving_orders)::int AS receipts`));
  const status = async (id) => (await one(`SELECT status::text AS s FROM eos_ops.reorder_requests WHERE id = $1`, [id])).s;
  const poOf = async (id) => one(`SELECT * FROM eos_ops.supplier_purchase_orders WHERE id = $1`, [id]);
  const receive = (poId, lines, principalId = buyer, k = key()) => spo.receiveSupplierPurchaseOrder({ pool, now: () => FIXED }, actor([RECEIVE], principalId), {
    source: { type: "PURCHASE_ORDER", purchaseOrderId: poId }, receivingLocation: { type: "WAREHOUSE", locationId: "wh-1" }, lines, idempotencyKey: k,
  });

  // ════════════════════════════ AUTHORITY: capability first, then company ════════════════════════════

  await t.test("capability first: every operation refuses a caller without ITS capability, and writes nothing", async () => {
    const r = await request();
    const spare = await request();
    const created = await create([{ reorderRequestId: r }]);
    const before = await counts();
    for (const [fn, code] of [
      [() => create([{ reorderRequestId: spare }], {}, actor([])), "CAPABILITY_REQUIRED"],
      [() => create([{ reorderRequestId: r }], {}, actor([SEND, READ])), "CAPABILITY_REQUIRED"],
      [() => transition(created.purchaseOrderId, "APPROVE", {}, actor([SEND, CANCEL], approver)), "CAPABILITY_REQUIRED"],
      [() => transition(created.purchaseOrderId, "SEND", {}, actor([APPROVE, CANCEL], approver)), "CAPABILITY_REQUIRED"],
      [() => transition(created.purchaseOrderId, "CANCEL", {}, actor([APPROVE, SEND], approver)), "CAPABILITY_REQUIRED"],
      [() => auth.listSupplierPurchaseOrders({ pool }, actor([CREATE]), {}), "CAPABILITY_REQUIRED"],
      [() => auth.readSupplierPurchaseOrder({ pool }, actor([CREATE]), { purchaseOrderId: created.purchaseOrderId }), "CAPABILITY_REQUIRED"],
      [() => auth.listPurchasableReorderRequests({ pool }, actor([READ]), {}), "CAPABILITY_REQUIRED"],
    ]) {
      const err = await refusal(fn);
      assert.equal(err.code, code);
      assert.equal(err.category, "FORBIDDEN");
    }
    assert.deepEqual(await counts(), before);
  });

  await t.test("a principal with NO operating-company authority is refused COMPANY_AUTHORITY_REQUIRED before any row is read", async () => {
    const r = await request();
    const created = await create([{ reorderRequestId: r }]);
    const before = await counts();
    for (const fn of [
      () => create([{ reorderRequestId: r }], {}, actor(BUY, nobody)),
      () => transition(created.purchaseOrderId, "CANCEL", {}, actor([CANCEL], nobody)),
      () => auth.listSupplierPurchaseOrders({ pool }, actor([READ], nobody), {}),
      () => auth.readSupplierPurchaseOrder({ pool }, actor([READ], nobody), { purchaseOrderId: created.purchaseOrderId }),
      () => auth.listPurchasableReorderRequests({ pool }, actor([CREATE], nobody), {}),
    ]) {
      const err = await refusal(fn);
      assert.equal(err.code, "COMPANY_AUTHORITY_REQUIRED");
      assert.equal(err.category, "FORBIDDEN");
    }
    assert.deepEqual(await counts(), before);
  });

  // ════════════════════════════ CREATE ════════════════════════════

  let spoA; // the two-line order the lifecycle tests run on
  let reqA1; let reqA2;
  await t.test("CREATE: one line per source request, one supplier, one receiving warehouse; the requests go ORDERED; the number is allocated; ONE audit row", async () => {
    reqA1 = await request({ partId: "PART-A", quantity: 10 });
    reqA2 = await request({ partId: "PART-B", quantity: 6 });
    const before = await counts();
    const res = await create([{ reorderRequestId: reqA1 }, { reorderRequestId: reqA2, orderedQuantity: 6, unitPriceMinor: 2500, currency: "USD" }]);
    spoA = res.purchaseOrderId;
    assert.equal(res.outcome, "applied");
    assert.match(res.externalPoNumber, /^SPO-2026-\d{6}$/);
    assert.deepEqual([res.status, res.version, res.operatingCompanyKey, res.supplierId, res.receivingWarehouseId], ["DRAFT", 0, "sample-co", "SUP-ACME", "wh-1"]);
    assert.deepEqual(res.lines.map((l) => [l.lineId, l.reorderRequestId, l.partId, l.orderedQuantity, l.unitPriceMinor, l.currency]),
      // L1: this caller holds no supplier-terms read capability, so the terms default is NOT applied (UNKNOWN); L2 states its own price.
      [["L1", reqA1, "PART-A", 10, null, null], ["L2", reqA2, "PART-B", 6, 2500, "USD"]]);
    const lines = (await q(`SELECT line_id, unit_price_minor, currency FROM eos_ops.supplier_purchase_order_lines WHERE purchase_order_id = $1 ORDER BY line_id`, [spoA])).rows;
    assert.deepEqual(lines.map((l) => [l.line_id, l.unit_price_minor, l.currency]), [["L1", null, null], ["L2", "2500", "USD"]]);
    assert.equal(await status(reqA1), "ORDERED");
    assert.equal(await status(reqA2), "ORDERED");
    const after = await counts();
    assert.deepEqual([after.pos, after.lines, after.commands, after.audits, after.ordered], [before.pos + 1, before.lines + 2, before.commands + 1, before.audits + 1, before.ordered + 2]);
    const audit = await one(`SELECT action, actor_uid, target_kind, target_id, before, after FROM eos_policy.audit_events WHERE target_id = $1`, [spoA]);
    assert.deepEqual([audit.action, audit.actor_uid, audit.target_kind, audit.before], ["supplier.purchaseOrder.create", buyer, "supplier_purchase_order", null]);
    assert.equal(audit.after.status, "DRAFT");
    assert.equal(audit.after.lines.length, 2);
    const row = await poOf(spoA);
    assert.deepEqual([row.status, row.version, row.provenance, row.created_by, row.receiving_warehouse_id, row.supplier_id], ["DRAFT", 0, "NATIVE", buyer, "wh-1", "SUP-ACME"]);
  });

  await t.test("price: the supplier terms are the DEFAULT only for a caller who may read them; an explicit price always wins; no terms is UNKNOWN (null), never zero", async () => {
    const withTerms = await request({ partId: "PART-A", quantity: 3 });
    const res = await create([{ reorderRequestId: withTerms }], {}, actor([...BUY, ...TERMS_READ]));
    assert.deepEqual([res.lines[0].unitPriceMinor, res.lines[0].currency], [1235, "USD"], "default from terms (12.3456 USD, rounded to the minor unit)");
    const noTerms = await request({ partId: "PART-C", quantity: 2 });
    const unknown = await create([{ reorderRequestId: noTerms }], {}, actor([...BUY, ...TERMS_READ]));
    assert.deepEqual([unknown.lines[0].unitPriceMinor, unknown.lines[0].currency], [null, null], "no terms: UNKNOWN, not zero");
    const explicit = await request({ partId: "PART-A", quantity: 3 });
    const mine = await create([{ reorderRequestId: explicit, unitPriceMinor: 999, currency: "CAD" }], {}, actor([...BUY, ...TERMS_READ]));
    assert.deepEqual([mine.lines[0].unitPriceMinor, mine.lines[0].currency], [999, "CAD"]);
    // A price is an amount AND a currency, whole minor units, never negative: refused before any write.
    const r = await request();
    const before = await counts();
    for (const bad of [{ unitPriceMinor: 10 }, { currency: "USD" }, { unitPriceMinor: 1.5, currency: "USD" }, { unitPriceMinor: -1, currency: "USD" }, { unitPriceMinor: 5, currency: "usd" }]) {
      assert.equal((await refusal(() => create([{ reorderRequestId: r, ...bad }]))).code, "PRICE_INVALID");
    }
    assert.deepEqual(await counts(), before);
    // The database says it too: a half-stated price cannot be stored.
    await assert.rejects(q(`UPDATE eos_ops.supplier_purchase_order_lines SET unit_price_minor = 5 WHERE purchase_order_id = $1 AND line_id = 'L1'`, [spoA]), /price_pairs|check/i);
  });

  await t.test("NUMBERING: SPO-YYYY-###### is allocated in sequence, unique per tenant, gap-safe, and never consumed by a refusal or a replay", async () => {
    const counterBefore = (await counts()).counters;
    const a = await create([{ reorderRequestId: await request() }]);
    const b = await create([{ reorderRequestId: await request() }]);
    const nA = Number(a.externalPoNumber.slice(-6)); const nB = Number(b.externalPoNumber.slice(-6));
    assert.equal(nB, nA + 1);
    assert.equal((await counts()).counters, counterBefore + 2);
    // A refusal (before the number is drawn) consumes none.
    const fresh = await request({ status: "PENDING_REVIEW" });
    await refusal(() => create([{ reorderRequestId: fresh }]));
    assert.equal((await counts()).counters, counterBefore + 2, "a refused create consumes no number");
    // Concurrent creates draw distinct numbers.
    const [c1, c2, c3] = await Promise.all([request(), request(), request()].map(async (p) => create([{ reorderRequestId: await p }])));
    assert.equal(new Set([c1, c2, c3].map((x) => x.externalPoNumber)).size, 3);
    // The structural proof: even a direct insert cannot reuse an allocated number, nor hand-type a malformed one in the SPO- series.
    await assert.rejects(q(`INSERT INTO eos_ops.supplier_purchase_orders (tenant_id, id, operating_company_key, external_po_number, status, created_by, updated_by)
                            VALUES ('t1','dup-1','sample-co',$1,'DRAFT','x','x')`, [a.externalPoNumber]), /unique/i);
    await assert.rejects(q(`INSERT INTO eos_ops.supplier_purchase_orders (tenant_id, id, operating_company_key, external_po_number, status, created_by, updated_by)
                            VALUES ('t1','dup-2','sample-co','SPO-26-1','DRAFT','x','x')`), /spo_number_format|check/i);
    // A fixture / migrated order with free text (and the same text twice) is still insertable: only the allocated series is constrained.
    await q(`INSERT INTO eos_ops.supplier_purchase_orders (tenant_id, id, operating_company_key, external_po_number, status, created_by, updated_by)
             VALUES ('t1','fx-1','sample-co','EXT-SAME','SENT','x','x'), ('t1','fx-2','sample-co','EXT-SAME','SENT','x','x')`);
  });

  // ════════════════════════════ IDEMPOTENCY ════════════════════════════

  await t.test("REPLAY: the same key and request returns the stored answer and writes NOTHING; the same key with a different request is IDEMPOTENCY_CONFLICT", async () => {
    const r = await request({ partId: "PART-C" });
    const k = key();
    const first = await create([{ reorderRequestId: r }], { idempotencyKey: k });
    const before = await counts();
    const again = await create([{ reorderRequestId: r }], { idempotencyKey: k });
    assert.equal(again.outcome, "replayed");
    assert.deepEqual([again.purchaseOrderId, again.externalPoNumber], [first.purchaseOrderId, first.externalPoNumber]);
    assert.deepEqual(await counts(), before, "a replay writes nothing, not even a number");
    const other = await request({ partId: "PART-C" });
    const err = await refusal(() => create([{ reorderRequestId: other }], { idempotencyKey: k }));
    assert.deepEqual([err.code, err.category], ["IDEMPOTENCY_CONFLICT", "CONFLICT"]);
    assert.deepEqual(await counts(), before);
    // A transition replays the same way.
    const tk = key();
    const approved = await transition(first.purchaseOrderId, "APPROVE", { idempotencyKey: tk });
    const mid = await counts();
    const replayed = await transition(first.purchaseOrderId, "APPROVE", { idempotencyKey: tk });
    assert.deepEqual([approved.outcome, replayed.outcome, replayed.status, replayed.version], ["applied", "replayed", "APPROVED", 1]);
    assert.deepEqual(await counts(), mid);
    const conflict = await refusal(() => transition(first.purchaseOrderId, "SEND", { idempotencyKey: tk, expectedVersion: 1 }));
    assert.equal(conflict.code, "IDEMPOTENCY_CONFLICT");
  });

  // ════════════════════════════ CREATE REFUSALS (each leaves zero trace) ════════════════════════════

  await t.test("every refusal precedes any write: foreign company, scope, status, assignee, other PO, reorder PO, supplier, shape", async () => {
    const ok = await request();
    const ventanaReq = await request({ warehouseId: "wh-v", companyKey: "ventana-co", assignee: "e-v" });
    const wh2 = await request({ warehouseId: "wh-2" });
    const pending = await request({ status: "PENDING_REVIEW" });
    const approved = await request({ status: "READY_FOR_PARTS_MANAGER", assignee: null });
    const notMine = await request({ assignee: "e-b2" });
    const onOther = await create([{ reorderRequestId: await request() }]);
    const onOtherReq = (await one(`SELECT source_request_id AS r FROM eos_ops.supplier_purchase_order_lines WHERE purchase_order_id = $1`, [onOther.purchaseOrderId])).r;
    const withReorderPo = await request();
    await q(`INSERT INTO eos_ops.purchase_orders (id, tenant_id, operating_company_key, part_id, supplier_name, external_po_number, ordered_quantity, ordered_date, created_by)
             VALUES ($1,'t1','sample-co','PART-A','Legacy','PO-9',10,'2026-10-01',$2)`, [withReorderPo, buyer]);
    const before = await counts();
    const expect = async (fn, code, category) => {
      const err = await refusal(fn);
      assert.deepEqual([err.code, err.category], [code, category], err.message);
      assert.deepEqual(await counts(), before, `${code} left a trace`);
      return err;
    };
    // Another company's request and warehouse read EXACTLY as nonexistent ones.
    const missingReq = await expect(() => create([{ reorderRequestId: "rr-does-not-exist" }]), "REORDER_NOT_FOUND", "NOT_FOUND");
    const foreignReq = await expect(() => create([{ reorderRequestId: ventanaReq }]), "REORDER_NOT_FOUND", "NOT_FOUND");
    assert.equal(foreignReq.message, missingReq.message);
    const missingWh = await expect(() => create([{ reorderRequestId: ok }], { receivingWarehouseId: "wh-nope" }), "WAREHOUSE_NOT_FOUND", "NOT_FOUND");
    const foreignWh = await expect(() => create([{ reorderRequestId: ok }], { receivingWarehouseId: "wh-v" }), "WAREHOUSE_NOT_FOUND", "NOT_FOUND");
    assert.equal(foreignWh.message, missingWh.message);
    // The warehouse scope: buyer2 holds wh-1 only.
    await expect(() => create([{ reorderRequestId: wh2 }], { receivingWarehouseId: "wh-2" }, actor(BUY, buyer2)), "OUTSIDE_OPERATIONAL_SCOPE", "FORBIDDEN");
    await warehouse("wh-closed", "sample-co", "INACTIVE");
    await expect(() => create([{ reorderRequestId: ok }], { receivingWarehouseId: "wh-closed" }), "WAREHOUSE_NOT_ACTIVE", "PRECONDITION_FAILED");
    // Request state, assignment, and the one-active-PO rule.
    await expect(() => create([{ reorderRequestId: pending }]), "REQUEST_NOT_ORDERABLE", "PRECONDITION_FAILED");
    await expect(() => create([{ reorderRequestId: approved }]), "REQUEST_NOT_ORDERABLE", "PRECONDITION_FAILED");
    await expect(() => create([{ reorderRequestId: notMine }]), "NOT_THE_ASSIGNEE", "FORBIDDEN");
    await expect(() => create([{ reorderRequestId: onOtherReq }]), "REQUEST_ALREADY_ON_PURCHASE_ORDER", "CONFLICT");
    await expect(() => create([{ reorderRequestId: withReorderPo }]), "REQUEST_HAS_REORDER_PURCHASE_ORDER", "CONFLICT");
    await expect(() => create([{ reorderRequestId: wh2 }]), "REQUEST_WAREHOUSE_MISMATCH", "PRECONDITION_FAILED");
    // One bad line refuses the WHOLE order (no partial order).
    await expect(() => create([{ reorderRequestId: ok }, { reorderRequestId: pending }]), "REQUEST_NOT_ORDERABLE", "PRECONDITION_FAILED");
    // Supplier.
    await expect(() => create([{ reorderRequestId: ok }], { supplierId: "SUP-NOPE" }), "SUPPLIER_NOT_FOUND", "NOT_FOUND");
    await expect(() => create([{ reorderRequestId: ok }], { supplierId: "SUP-OFF" }), "SUPPLIER_INACTIVE", "PRECONDITION_FAILED");
    // Shape.
    await expect(() => create([]), "LINES_REQUIRED", "INVALID_INPUT");
    await expect(() => create([{ reorderRequestId: ok }, { reorderRequestId: ok }]), "DUPLICATE_REQUEST", "INVALID_INPUT");
    await expect(() => create([{ reorderRequestId: ok, orderedQuantity: 0 }]), "QUANTITY_INVALID", "INVALID_INPUT");
    await expect(() => create([{ reorderRequestId: ok, partId: "PART-A" }]), "INPUT_FIELD_NOT_ACCEPTED", "INVALID_INPUT");
    await expect(() => create([{ reorderRequestId: ok }], { operatingCompanyKey: "ventana-co" }), "INPUT_FIELD_NOT_ACCEPTED", "INVALID_INPUT");
    await expect(() => create([{ reorderRequestId: ok }], { idempotencyKey: "" }), "IDEMPOTENCY_KEY_REQUIRED", "INVALID_INPUT");
    // A request that carries no quantity needs one stated.
    const zero = await request({ quantity: 0 });
    await expect(() => create([{ reorderRequestId: zero }]), "QUANTITY_REQUIRED", "INVALID_INPUT");
  });

  // ════════════════════════════ LIFECYCLE ════════════════════════════

  await t.test("APPROVE / SEND: the lifecycle allows only DRAFT -> APPROVED -> SENT; the creator cannot approve their own order; version guards a stale caller", async () => {
    const before = await counts();
    // SEGREGATION OF DUTIES: the creator holds .approve here and is still refused.
    const self = await refusal(() => transition(spoA, "APPROVE", {}, actor([APPROVE, SEND, CANCEL], buyer)));
    assert.deepEqual([self.code, self.category], ["SELF_APPROVAL_FORBIDDEN", "FORBIDDEN"]);
    // SEND needs APPROVED first; a stale version is refused; an unknown action is refused.
    assert.equal((await refusal(() => transition(spoA, "SEND"))).code, "STATUS_TRANSITION_NOT_ALLOWED");
    assert.equal((await refusal(() => transition(spoA, "APPROVE", { expectedVersion: 7 }))).code, "PURCHASE_ORDER_VERSION_CONFLICT");
    assert.equal((await refusal(() => transition(spoA, "ARCHIVE"))).code, "ACTION_INVALID");
    assert.equal((await refusal(() => transition(spoA, "CANCEL", { reason: undefined }))).code, "CANCELLATION_REASON_REQUIRED");
    assert.deepEqual(await counts(), before);
    // A DRAFT is not receivable.
    const draftReceipt = await refusal(() => receive(spoA, [{ lineId: "L1", partId: "PART-A", receivedQuantity: 1 }]));
    assert.equal(draftReceipt.code, "STATUS_NOT_RECEIVABLE");

    const approved = await transition(spoA, "APPROVE");
    assert.deepEqual([approved.status, approved.version, approved.statusBefore], ["APPROVED", 1, "DRAFT"]);
    let row = await poOf(spoA);
    assert.deepEqual([row.status, row.version, row.approved_by, row.updated_by], ["APPROVED", 1, approver, approver]);
    assert.ok(row.approved_at instanceof Date);
    assert.equal((await refusal(() => transition(spoA, "APPROVE", { expectedVersion: 1 }))).code, "STATUS_TRANSITION_NOT_ALLOWED");
    // The buyer (holding .send) sends it.
    const sent = await transition(spoA, "SEND", { expectedVersion: 1 }, actor(BUY));
    assert.deepEqual([sent.status, sent.version], ["SENT", 2]);
    row = await poOf(spoA);
    assert.deepEqual([row.status, row.sent_by], ["SENT", buyer]);
    // One audit row per command, with the actor and the before / after.
    const audits = (await q(`SELECT action, actor_uid, before, after FROM eos_policy.audit_events WHERE target_id = $1 ORDER BY occurred_at, id`, [spoA])).rows;
    assert.deepEqual(audits.map((a) => a.action).sort(), ["supplier.purchaseOrder.approve", "supplier.purchaseOrder.create", "supplier.purchaseOrder.send"]);
    const approveAudit = audits.find((a) => a.action === "supplier.purchaseOrder.approve");
    assert.deepEqual([approveAudit.actor_uid, approveAudit.before.status, approveAudit.after.status], [approver, "DRAFT", "APPROVED"]);
  });

  await t.test("COMPANY ISOLATION: another company's order reads EXACTLY as a nonexistent one on every operation, and the lists are company-scoped", async () => {
    const before = await counts();
    const ventanaActor = actor([APPROVE, SEND, CANCEL, READ, CREATE], ventana);
    const missing = await refusal(() => transition("spo-does-not-exist", "CANCEL", {}, ventanaActor));
    const hidden = await refusal(() => transition(spoA, "CANCEL", {}, ventanaActor));
    assert.deepEqual([hidden.code, hidden.category, hidden.message], [missing.code, missing.category, missing.message]);
    assert.equal(hidden.code, "PURCHASE_ORDER_NOT_FOUND");
    const hiddenRead = await refusal(() => auth.readSupplierPurchaseOrder({ pool }, ventanaActor, { purchaseOrderId: spoA }));
    assert.equal(hiddenRead.code, "PURCHASE_ORDER_NOT_FOUND");
    assert.deepEqual(await counts(), before);
    assert.equal((await auth.listSupplierPurchaseOrders({ pool }, ventanaActor, {})).purchaseOrders.length, 0);
    const mine = (await auth.listSupplierPurchaseOrders({ pool }, actor([READ], approver), {})).purchaseOrders;
    assert.ok(mine.length > 0 && mine.every((p) => p.operatingCompanyKey === "sample-co"));
    assert.ok(mine.some((p) => p.purchaseOrderId === spoA));
    const sentOnly = (await auth.listSupplierPurchaseOrders({ pool }, actor([READ], approver), { statuses: ["SENT"] })).purchaseOrders;
    assert.ok(sentOnly.length >= 1 && sentOnly.every((p) => p.status === "SENT"));
    assert.equal((await refusal(() => auth.listSupplierPurchaseOrders({ pool }, actor([READ], approver), { statuses: ["BOGUS"] }))).code, "STATUSES_INVALID");
  });

  await t.test("READ: the order with its lines, derived progress, and exactly the actions THIS caller may take now", async () => {
    const asApprover = await auth.readSupplierPurchaseOrder({ pool }, actor([READ, APPROVE, SEND, CANCEL], approver), { purchaseOrderId: spoA });
    assert.deepEqual([asApprover.status, asApprover.version, asApprover.receivable, asApprover.supplierName], ["SENT", 2, true, "Supplier SUP-ACME"]);
    assert.deepEqual(asApprover.lines.map((l) => [l.lineId, l.reorderRequestId, l.orderedQuantity, l.receivedQuantity, l.linkReleased]),
      [["L1", reqA1, 10, 0, false], ["L2", reqA2, 6, 0, false]]);
    assert.deepEqual(asApprover.allowed, { approve: false, send: false, cancel: true }, "SENT: only cancel remains");
    // Display batch: the order carries its receiving warehouse's NAME (this fixture names each warehouse by its id), so no screen prints the key as a name.
    assert.deepEqual([asApprover.receivingWarehouseId, asApprover.receivingWarehouseName], ["wh-1", "wh-1"]);
    const listed = (await auth.listSupplierPurchaseOrders({ pool }, actor([READ], approver), {})).purchaseOrders.find((o) => o.purchaseOrderId === spoA);
    assert.equal(listed.receivingWarehouseName, "wh-1");
    // A fresh DRAFT: its creator is NOT offered approve even holding the capability.
    const draft = await create([{ reorderRequestId: await request() }]);
    const asCreator = await auth.readSupplierPurchaseOrder({ pool }, actor([READ, APPROVE, SEND, CANCEL], buyer), { purchaseOrderId: draft.purchaseOrderId });
    assert.deepEqual(asCreator.allowed, { approve: false, send: false, cancel: true });
    const asOther = await auth.readSupplierPurchaseOrder({ pool }, actor([READ, APPROVE], approver), { purchaseOrderId: draft.purchaseOrderId });
    assert.deepEqual(asOther.allowed, { approve: true, send: false, cancel: false });
    // The warehouse NAME is joined within the order's own tenant AND operating company: a warehouse of another company, or none at all, is not named
    // (the id is still stated; the screen says "Warehouse name unavailable"). The column carries no foreign key, so both states can be stored.
    const read = async () => ({
      one: await auth.readSupplierPurchaseOrder({ pool }, actor([READ], approver), { purchaseOrderId: draft.purchaseOrderId }),
      listed: (await auth.listSupplierPurchaseOrders({ pool }, actor([READ], approver), {})).purchaseOrders.find((o) => o.purchaseOrderId === draft.purchaseOrderId),
    });
    for (const [what, warehouseId] of [["a warehouse of ANOTHER operating company", "wh-v"], ["a warehouse that does not exist", "wh-gone"]]) {
      await q(`UPDATE eos_ops.supplier_purchase_orders SET receiving_warehouse_id = $1 WHERE id = $2`, [warehouseId, draft.purchaseOrderId]);
      const { one, listed } = await read();
      assert.deepEqual([one.receivingWarehouseId, one.receivingWarehouseName, listed.receivingWarehouseName], [warehouseId, null, null], what);
    }
    await q(`UPDATE eos_ops.supplier_purchase_orders SET receiving_warehouse_id = 'wh-1' WHERE id = $1`, [draft.purchaseOrderId]);
    assert.equal((await read()).one.receivingWarehouseName, "wh-1", "its own company's warehouse is named");
  });

  await t.test("THE PICKER lists only the caller's own orderable requests, and the active suppliers; a request on a PO leaves it", async () => {
    const mine = await request({ partId: "PART-A", quantity: 4 });
    const theirs = await request({ assignee: "e-b2" });
    const elsewhere = await request({ warehouseId: "wh-2" });
    const asBuyer = await auth.listPurchasableReorderRequests({ pool }, actor([CREATE]), { supplierId: "SUP-ACME" });
    const ids = asBuyer.requests.map((r) => r.reorderRequestId);
    assert.ok(ids.includes(mine) && ids.includes(elsewhere));
    assert.ok(!ids.includes(theirs), "another Employee's request is not offered");
    assert.ok(!ids.includes(reqA1) && !ids.includes(reqA2), "a request already on a purchase order is not offered");
    assert.ok(asBuyer.suppliers.some((s) => s.supplierId === "SUP-ACME") && !asBuyer.suppliers.some((s) => s.supplierId === "SUP-OFF"));
    // No terms-read capability: no default price offered.
    assert.equal(asBuyer.requests.find((r) => r.reorderRequestId === mine).defaultUnitPriceMinor, null);
    const withTerms = await auth.listPurchasableReorderRequests({ pool }, actor([CREATE, ...TERMS_READ]), { supplierId: "SUP-ACME" });
    assert.deepEqual([withTerms.requests.find((r) => r.reorderRequestId === mine).defaultUnitPriceMinor, withTerms.requests.find((r) => r.reorderRequestId === mine).defaultCurrency], [1235, "USD"]);
    // buyer2 holds wh-1 only: wh-2 requests are out of its scope.
    const b2 = await auth.listPurchasableReorderRequests({ pool }, actor([CREATE], buyer2), {});
    assert.ok(b2.requests.every((r) => r.warehouseId === "wh-1") && !b2.requests.some((r) => r.reorderRequestId === elsewhere));
  });

  // ════════════════════════════ ON ORDER NEVER DOUBLE COUNTS ════════════════════════════

  await t.test("ON ORDER counts the supplier order's REMAINING quantity once; the linked request adds nothing; recordReorderPurchaseOrder refuses a request on a PO", async () => {
    const balance = (partId) => reads.readPartBalance({ pool }, actor([BALANCE_READ], buyer), { partId });
    assert.equal((await balance("PART-A")).onOrder.value, 10, "the SENT order's 10 x PART-A, once");
    // The guard in recordReorderPurchaseOrder: a request on a supplier PO is refused with the real reason -- also if its status were forced back.
    const err = await refusal(() => lifecycle.recordReorderPurchaseOrder({ pool }, actor([RECORD_PO]), {
      reorderRequestId: reqA1, supplier: { kind: "EXTERNAL_ORGANIZATION", supplierId: "SUP-ACME" }, externalPoNumber: "PO-DOUBLE", orderedQuantity: 10, orderedDate: "2026-10-19" }));
    assert.deepEqual([err.code, err.category], ["REQUEST_ON_SUPPLIER_PO", "CONFLICT"]);
    await q(`UPDATE eos_ops.reorder_requests SET status = 'PURCHASING_IN_PROGRESS' WHERE id = $1`, [reqA1]);
    const forced = await refusal(() => lifecycle.recordReorderPurchaseOrder({ pool }, actor([RECORD_PO]), {
      reorderRequestId: reqA1, supplier: { kind: "EXTERNAL_ORGANIZATION", supplierId: "SUP-ACME" }, externalPoNumber: "PO-DOUBLE", orderedQuantity: 10, orderedDate: "2026-10-19" }));
    assert.equal(forced.code, "REQUEST_ON_SUPPLIER_PO", "the guard holds even when the status gate would have let it through");
    await q(`UPDATE eos_ops.reorder_requests SET status = 'ORDERED' WHERE id = $1`, [reqA1]);
    assert.equal((await one(`SELECT count(*)::int n FROM eos_ops.purchase_orders WHERE id = $1`, [reqA1])).n, 0, "no reorder purchase order was written");
    assert.equal((await balance("PART-A")).onOrder.value, 10, "still 10: never double counted");
  });

  // ════════════════════════════ RECEIVE: the link closes the requests, per line ════════════════════════════

  await t.test("RECEIVE end to end: partial receipts leave the requests ORDERED; a line fully received closes ITS request in the receipt's transaction; the order completes", async () => {
    const auditsBefore = (await counts()).audits;
    // 4 of 10 on L1: nothing closes.
    const r1 = await receive(spoA, [{ lineId: "L1", partId: "PART-A", receivedQuantity: 4 }]);
    assert.equal(r1.outcome, "applied");
    assert.equal(await status(reqA1), "ORDERED");
    assert.equal(await status(reqA2), "ORDERED");
    assert.equal((await reads.readPartBalance({ pool }, actor([BALANCE_READ]), { partId: "PART-A" })).onOrder.value, 6, "remaining after the partial receipt");
    // A replay of that receipt closes nothing and writes nothing.
    // The remaining 6 on L1 completes ITS line: request 1 closes, request 2 (L2 untouched) stays ORDERED.
    const r2 = await receive(spoA, [{ lineId: "L1", partId: "PART-A", receivedQuantity: 6 }]);
    assert.equal(r2.storedStatus, "SENT");
    assert.equal(await status(reqA1), "RECEIVED");
    assert.equal(await status(reqA2), "ORDERED");
    const closed = await one(`SELECT received_at, received_by_principal_id FROM eos_ops.reorder_requests WHERE id = $1`, [reqA1]);
    assert.deepEqual([closed.received_at.toISOString(), closed.received_by_principal_id], [FIXED.toISOString(), buyer]);
    // L2 in two steps: 2 then 4 completes the order and its request.
    await receive(spoA, [{ lineId: "L2", partId: "PART-B", receivedQuantity: 2 }]);
    assert.equal(await status(reqA2), "ORDERED");
    const r4 = await receive(spoA, [{ lineId: "L2", partId: "PART-B", receivedQuantity: 4 }]);
    assert.deepEqual([r4.storedStatus, r4.derivedState], ["RECEIVED", "RECEIVED"]);
    assert.equal(await status(reqA2), "RECEIVED");
    assert.equal((await poOf(spoA)).status, "RECEIVED");
    // The receipt audit names the requests it closed.
    const receiptAudit = await one(`SELECT after FROM eos_policy.audit_events WHERE action = 'inventory.stock.receive' AND target_id = $1`, [r2.receivingId]);
    assert.deepEqual(receiptAudit.after.closedRequestIds, [reqA1]);
    assert.ok((await counts()).audits > auditsBefore);
    // A received order can be neither cancelled nor approved again.
    assert.equal((await refusal(() => transition(spoA, "CANCEL", { expectedVersion: 6 }))).code, "STATUS_TRANSITION_NOT_ALLOWED");
  });

  await t.test("RECEIVE of an APPROVED (not yet sent) order is allowed; a receipt VOID reopens the request its receipt had closed", async () => {
    const r = await request({ partId: "PART-A", quantity: 5 });
    const po = (await create([{ reorderRequestId: r }])).purchaseOrderId;
    await transition(po, "APPROVE");
    const rcv = await receive(po, [{ lineId: "L1", partId: "PART-A", receivedQuantity: 5 }]);
    assert.equal(await status(r), "RECEIVED");
    const voided = await fix.correctSupplierPurchaseOrderReceipt({ pool, now: () => FIXED }, actor([CORRECT]),
      { receivingId: rcv.receivingId, reason: "counted wrong", idempotencyKey: key() });
    assert.equal(voided.outcome, "applied");
    assert.equal(await status(r), "ORDERED", "the line is no longer fully received: the request is owed a correct receipt");
    assert.equal((await one(`SELECT received_at FROM eos_ops.reorder_requests WHERE id = $1`, [r])).received_at, null);
    assert.equal((await poOf(po)).status, "SENT", "a completing receipt that is gone returns the order to a receivable status");
  });

  await t.test("DESTINATION: an order authored here is received into ITS receiving warehouse; anything else is refused before any write; a fixture order (no warehouse) keeps the company-wide rule", async () => {
    const r = await request({ partId: "PART-A", quantity: 5 });
    const po = (await create([{ reorderRequestId: r }])).purchaseOrderId; // receiving warehouse wh-1
    await transition(po, "APPROVE");
    const to = (locationId, poId, k = key()) => spo.receiveSupplierPurchaseOrder({ pool, now: () => FIXED }, actor([RECEIVE], buyer), {
      source: { type: "PURCHASE_ORDER", purchaseOrderId: poId }, receivingLocation: { type: "WAREHOUSE", locationId },
      lines: [{ lineId: "L1", partId: "PART-A", receivedQuantity: 5 }], idempotencyKey: k });
    const before = await counts();
    // wh-2 is an ACTIVE warehouse of the same company inside the buyer's scope -- valid for a fixture order, NOT for this one.
    const err = await refusal(() => to("wh-2", po));
    assert.deepEqual([err.code, err.category], ["DESTINATION_NOT_ORDER_WAREHOUSE", "PRECONDITION_FAILED"]);
    assert.deepEqual(await counts(), before, "the refusal left no trace");
    assert.equal(await status(r), "ORDERED");
    // The picker offers only the order's warehouse.
    const opts = await spo.listSupplierReceivingLocationOptions({ pool }, actor([RECEIVE], buyer), { purchaseOrderId: po });
    assert.deepEqual(opts.options.map((o) => o.value), ["wh-1"]);
    // Its own warehouse is accepted, and (the same key, the same request) replays.
    const k = key();
    assert.equal((await to("wh-1", po, k)).outcome, "applied");
    assert.equal((await to("wh-1", po, k)).outcome, "replayed");
    // A fixture / migrated order names no warehouse: today's behaviour, any warehouse of its company in the receiver's scope.
    const fixture = await q(`INSERT INTO eos_ops.supplier_purchase_orders (tenant_id, id, operating_company_key, status, created_by, updated_by)
                             VALUES ('t1','fx-dest','sample-co','SENT','x','x') RETURNING id`);
    await q(`INSERT INTO eos_ops.supplier_purchase_order_lines (tenant_id, purchase_order_id, line_id, part_id, ordered_quantity) VALUES ('t1','fx-dest','L1','PART-A',5)`);
    assert.equal((await to("wh-2", fixture.rows[0].id)).outcome, "applied");
  });

  // ════════════════════════════ CANCEL ════════════════════════════

  await t.test("CANCEL releases the lines and returns the requests to purchasing; they can go on a NEW order; a receipt blocks the cancel", async () => {
    const r1 = await request(); const r2 = await request({ partId: "PART-B", quantity: 2 });
    const po = (await create([{ reorderRequestId: r1 }, { reorderRequestId: r2 }])).purchaseOrderId;
    await transition(po, "APPROVE");
    const before = await counts();
    const cancelled = await transition(po, "CANCEL", { expectedVersion: 1 });
    assert.deepEqual([cancelled.status, cancelled.version, [...cancelled.releasedRequestIds].sort()], ["CANCELLED", 2, [r1, r2].sort()]);
    assert.equal(await status(r1), "PURCHASING_IN_PROGRESS");
    assert.equal(await status(r2), "PURCHASING_IN_PROGRESS");
    const row = await poOf(po);
    assert.deepEqual([row.status, row.cancelled_by, row.cancellation_reason], ["CANCELLED", approver, "supplier withdrew the quote"]);
    assert.equal((await one(`SELECT count(*)::int n FROM eos_ops.supplier_purchase_order_lines WHERE purchase_order_id = $1 AND link_released_at IS NOT NULL`, [po])).n, 2);
    assert.equal((await counts()).audits, before.audits + 1, "one audit row for the cancel");
    // The same requests can be raised again on a new order.
    const again = await create([{ reorderRequestId: r1 }, { reorderRequestId: r2 }]);
    assert.notEqual(again.purchaseOrderId, po);
    assert.equal(await status(r1), "ORDERED");
    // Once stock is received, the cancel is refused until the receipt is corrected.
    await transition(again.purchaseOrderId, "APPROVE");
    await receive(again.purchaseOrderId, [{ lineId: "L1", partId: "PART-A", receivedQuantity: 1 }]);
    const blocked = await refusal(() => transition(again.purchaseOrderId, "CANCEL", { expectedVersion: 2 }));
    assert.deepEqual([blocked.code, blocked.category], ["PURCHASE_ORDER_HAS_RECEIPTS", "PRECONDITION_FAILED"]);
  });

  await t.test("THE DATABASE says it too: a request cannot be on two ACTIVE order lines", async () => {
    const r = await request();
    const a = (await create([{ reorderRequestId: r }])).purchaseOrderId;
    await q(`INSERT INTO eos_ops.supplier_purchase_orders (tenant_id, id, operating_company_key, status, created_by, updated_by) VALUES ('t1','raw-po','sample-co','DRAFT','x','x')`);
    await assert.rejects(q(`INSERT INTO eos_ops.supplier_purchase_order_lines (tenant_id, purchase_order_id, line_id, part_id, ordered_quantity, source_request_id)
                            VALUES ('t1','raw-po','L1','PART-A',1,$1)`, [r]), /one_active_request|unique/i);
    // Releasing the first line frees the request for the second.
    await q(`UPDATE eos_ops.supplier_purchase_order_lines SET link_released_at = now() WHERE purchase_order_id = $1`, [a]);
    await q(`INSERT INTO eos_ops.supplier_purchase_order_lines (tenant_id, purchase_order_id, line_id, part_id, ordered_quantity, source_request_id)
             VALUES ('t1','raw-po','L1','PART-A',1,$1)`, [r]);
  });
});
