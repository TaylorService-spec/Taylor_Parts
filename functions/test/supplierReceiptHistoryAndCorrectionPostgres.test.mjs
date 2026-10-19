// RECEIPT HISTORY AND THE SUPPLIER-PO RECEIPT CORRECTION, against a real postgres:16 (Firebase exit B3-x; DECISIONS #B3-x).
//
// listReceipts / readReceipt now carry supplier-PO receipts (order number, size, corrected) under COMPANY ISOLATION -- another company's
// receipt reads EXACTLY as a nonexistent one. correctSupplierPurchaseOrderReceipt voids a wrong supplier receipt: compensating ADJUSTED
// movements, the receipt CANCELLED (never deleted), Finance reversal, a completed order receivable again, replay writes nothing, and every
// refusal leaves ZERO trace.
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
const fix = require("../lib/eosOps/supplierReceiptCorrection.js");
const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");

const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

const RECEIVE = "inventory.stock.receive";
const RECEIPT_READ = "receivingOrder.record.read";
const CORRECT = "inventory.receipt.correct";
const FIXED = new Date("2026-10-18T15:00:00.000Z");

test("Supplier receipt history and VOID correction on PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `rch_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
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
  const receiver = await principal("uid-receiver");        // Taylor, scope wh-1
  const otherScope = await principal("uid-other-scope");   // Taylor, scope wh-2 only
  const ventana = await principal("uid-ventana");          // Ventana, scope wh-v
  const nobody = await principal("uid-no-employee");

  await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id, operating_company_id, status, source, established_by, updated_by)
           VALUES ('t1','taylor','ACTIVE','fixture','f','f'), ('t1','ventana','ACTIVE','fixture','f','f')`);
  await q(`INSERT INTO eos_policy.tenant_operating_company_keys
             (tenant_id, operating_company_id, operating_company_key, status, provenance, source, established_by, updated_by)
           VALUES ('t1','taylor','sample-co','ACTIVE','NATIVE','fixture','f','f'), ('t1','ventana','ventana-co','ACTIVE','NATIVE','fixture','f','f')`);
  const warehouse = (id, key) => q(
    `INSERT INTO eos_ops.warehouses (id, tenant_id, operating_company_key, name, site_label, status, provenance, created_by, updated_by)
     VALUES ($1,'t1',$2,$1,'Sampleton','ACTIVE','NATIVE','fixture','fixture')`, [id, key]);
  await warehouse("wh-1", "sample-co");
  await warehouse("wh-2", "sample-co");
  await warehouse("wh-v", "ventana-co");
  await q(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id, updated_at)
           VALUES ('e-r','t1','ACTIVE','taylor','2020-01-01T00:00:00Z'), ('e-o','t1','ACTIVE','taylor','2020-01-01T00:00:00Z'),
                  ('e-v','t1','ACTIVE','ventana','2020-01-01T00:00:00Z')`);
  await q(`INSERT INTO eos_policy.employee_principal_links (id, tenant_id, principal_id, employee_id, operating_company_id, link_source, asserted_by, assertion_reason, status)
           VALUES ('epl-r','t1',$1,'e-r','taylor','OPERATOR_ASSERTED','f','test','active'),
                  ('epl-o','t1',$2,'e-o','taylor','OPERATOR_ASSERTED','f','test','active'),
                  ('epl-v','t1',$3,'e-v','ventana','OPERATOR_ASSERTED','f','test','active')`, [receiver, otherScope, ventana]);
  await q(`INSERT INTO eos_workforce.employee_operational_scopes (id, tenant_id, employee_id, scope_type, scope_id, effective_from, assigned_by)
           VALUES ('os-r-1','t1','e-r','WAREHOUSE','wh-1', now(),'fixture'), ('os-o-2','t1','e-o','WAREHOUSE','wh-2', now(),'fixture'),
                  ('os-v-v','t1','e-v','WAREHOUSE','wh-v', now(),'fixture')`);

  const part = (id, controlType) => q(
    `INSERT INTO eos_ops.parts (id, tenant_id, created_by, internal_part_number, name, status, stocking_unit,
                                control_type, stocking_class, expiry_tracked, consumable, returnable_core,
                                whole_unit, version, updated_by)
     VALUES ($1,'t1','fixture',$1,$1,'ACTIVE','EACH',$2,'STOCKED',false,false,false,false,1,'fixture')`, [id, controlType]);
  await part("PART-A", "STANDARD");
  await part("PART-S", "SERIALIZED");

  let seq = 0;
  const order = async (over = {}) => {
    const id = over.id ?? `po-${++seq}`;
    const o = { companyKey: "sample-co", status: "SENT", lines: [["L1", "PART-A", 10]], ...over };
    await q(`INSERT INTO eos_ops.supplier_purchase_orders (id, tenant_id, operating_company_key, supplier_id, external_po_number, status, version, created_by, updated_by)
             VALUES ($1,'t1',$2,NULL,$3,$4,0,'fixture','fixture')`, [id, o.companyKey, `EXT-${id}`, o.status]);
    for (const [lineId, partId, quantity] of o.lines) {
      await q(`INSERT INTO eos_ops.supplier_purchase_order_lines (tenant_id, purchase_order_id, line_id, part_id, ordered_quantity) VALUES ('t1',$1,$2,$3,$4)`,
        [id, lineId, partId, quantity]);
    }
    return id;
  };
  const actor = (caps, principalId = receiver) => ({ tenantId: "t1", principalId, capabilities: new Set(caps) });
  const receive = (poId, lines, locationId = "wh-1", principalId = receiver) => spo.receiveSupplierPurchaseOrder({ pool, now: () => FIXED }, actor([RECEIVE], principalId), {
    source: { type: "PURCHASE_ORDER", purchaseOrderId: poId }, receivingLocation: { type: "WAREHOUSE", locationId }, lines, idempotencyKey: `k-${poId}-${randomUUID().slice(0, 6)}`,
  });
  const correct = (receivingId, over = {}, a = actor([CORRECT])) => fix.correctSupplierPurchaseOrderReceipt({ pool, now: () => FIXED }, a,
    { receivingId, reason: "counted wrong", idempotencyKey: `c-${randomUUID().slice(0, 8)}`, ...over });
  const refusal = async (fn) => { try { await fn(); } catch (err) { return err; } assert.fail("expected a refusal"); };
  const snap = async () => (await q(
    `SELECT (SELECT count(*) FROM eos_ops.receiving_orders)::int AS receipts, (SELECT count(*) FROM eos_ops.inventory_movements)::int AS movements,
            (SELECT count(*) FROM eos_ops.receiving_corrections)::int AS corrections, (SELECT count(*) FROM eos_policy.audit_events)::int AS audits,
            (SELECT COALESCE(sum(version),0) FROM eos_ops.supplier_purchase_orders)::int AS versions,
            (SELECT count(*) FROM eos_finance.cost_evidence_exception_resolutions)::int AS resolutions`)).rows[0];
  const onHand = async (partId, locationId) => Number((await q(
    `SELECT COALESCE(sum(quantity_delta),0)::int n FROM eos_ops.inventory_movements WHERE tenant_id='t1' AND part_id=$1 AND location_id=$2`, [partId, locationId])).rows[0].n);
  const progress = (poId, principalId = receiver) => spo.readSupplierPurchaseOrderProgress({ pool }, actor([RECEIVE], principalId), { purchaseOrderId: poId });

  await t.test("HISTORY: a supplier receipt lists with its order number, size and corrected flag -- and another company never sees it", async () => {
    const po = await order();
    const rcv = await receive(po, [{ lineId: "L1", partId: "PART-A", receivedQuantity: 4 }]);
    const list = await reads.listReceipts({ pool }, actor([RECEIPT_READ]), {});
    const row = list.items.find((i) => i.receiptId === rcv.receivingId);
    assert.ok(row, "listed");
    assert.deepEqual([row.sourceKind, row.orderNumber, row.lineCount, row.totalQuantity, row.corrected, row.status, row.purchaseOrderId],
      ["PURCHASE_ORDER", `EXT-${po}`, 1, 4, false, "PUTAWAY_COMPLETE", po]);
    assert.match(row.receivingOrderNumber, /^RO-/);
    const detail = await reads.readReceipt({ pool }, actor([RECEIPT_READ]), { receiptId: rcv.receivingId });
    assert.deepEqual(detail.lines.map((l) => [l.lineId, l.partId, l.receivedQuantity]), [["L1", "PART-A", 4]]);
    // Another company's reader (own warehouse scope, own company): the receipt is absent from the list and reads exactly as missing.
    const theirs = await reads.listReceipts({ pool }, actor([RECEIPT_READ], ventana), {});
    assert.equal(theirs.items.some((i) => i.receiptId === rcv.receivingId), false);
    const hidden = await refusal(() => reads.readReceipt({ pool }, actor([RECEIPT_READ], ventana), { receiptId: rcv.receivingId }));
    const missing = await refusal(() => reads.readReceipt({ pool }, actor([RECEIPT_READ], ventana), { receiptId: "rcvc_does_not_exist" }));
    assert.deepEqual([hidden.code, hidden.category, hidden.message], [missing.code, missing.category, missing.message]);
    // A principal with no company authority sees no supplier receipt at all (and still reads its own warehouse-scoped Reorder receipts).
    assert.equal((await reads.listReceipts({ pool }, actor([RECEIPT_READ], nobody), {})).items.length, 0);
  });

  await t.test("authority: capability first, then company; a foreign-company receipt is nonexistent; scope is required; nothing is written", async () => {
    const po = await order();
    const rcv = await receive(po, [{ lineId: "L1", partId: "PART-A", receivedQuantity: 2 }]);
    const before = await snap();
    assert.equal((await refusal(() => correct(rcv.receivingId, {}, actor([])))).code, "CAPABILITY_REQUIRED");
    const noCompany = await refusal(() => correct(rcv.receivingId, {}, actor([CORRECT], nobody)));
    assert.deepEqual([noCompany.code, noCompany.category], ["COMPANY_AUTHORITY_REQUIRED", "FORBIDDEN"]);
    const hidden = await refusal(() => correct(rcv.receivingId, {}, actor([CORRECT], ventana)));
    const missing = await refusal(() => correct("rcvc_does_not_exist", {}, actor([CORRECT], ventana)));
    assert.deepEqual([hidden.code, hidden.category, hidden.message], [missing.code, missing.category, missing.message], "another company's receipt reads as nonexistent");
    const outside = await refusal(() => correct(rcv.receivingId, {}, actor([CORRECT], otherScope)));
    assert.deepEqual([outside.code, outside.category], ["OUTSIDE_OPERATIONAL_SCOPE", "FORBIDDEN"]);
    assert.equal((await refusal(() => correct(rcv.receivingId, { reason: "  " }))).code, "REASON_REQUIRED");
    assert.equal((await refusal(() => correct(rcv.receivingId, { replacement: {} }))).code, "INPUT_FIELD_NOT_ACCEPTED");
    assert.deepEqual(await snap(), before, "every refusal leaves zero trace");
  });

  await t.test("VOID: compensating ADJUSTED movements, the receipt CANCELLED, the order's remaining quantity restored, the version moved, one audit; replay writes nothing", async () => {
    const po = await order();
    const rcv = await receive(po, [{ lineId: "L1", partId: "PART-A", receivedQuantity: 4 }]);
    const stockBefore = await onHand("PART-A", "wh-1");
    const r = await correct(rcv.receivingId, { idempotencyKey: "void-1" });
    assert.equal(r.outcome, "applied");
    assert.deepEqual([r.receivingId, r.purchaseOrderId, r.correctionKind, r.compensatingMovementIds.length], [rcv.receivingId, po, "VOID", 1]);
    assert.equal(await onHand("PART-A", "wh-1"), stockBefore - 4, "the 4 left through a compensating movement");
    const mv = (await q(`SELECT movement_type::text AS t, quantity_delta AS d, source_kind FROM eos_ops.inventory_movements WHERE id = $1`, [r.compensatingMovementIds[0]])).rows[0];
    assert.deepEqual(mv, { t: "ADJUSTED", d: -4, source_kind: "RECEIVING_CORRECTION" });
    assert.equal((await q(`SELECT status::text s FROM eos_ops.receiving_orders WHERE id = $1`, [rcv.receivingId])).rows[0].s, "CANCELLED");
    assert.equal((await q(`SELECT count(*)::int n FROM eos_ops.receiving_order_lines WHERE receiving_order_id = $1`, [rcv.receivingId])).rows[0].n, 1, "the receipt's lines are never deleted");
    const p = await progress(po);
    assert.deepEqual(p.lines.map((l) => [l.receivedQuantity, l.remainingQuantity]), [[0, 10]], "the order's remaining quantity is derived again without the voided receipt");
    assert.equal(p.version, rcv.version + 1, "the order's version moved (concurrency control only)");
    // The cost exception the receipt raised is resolved (append-only), and the history says corrected.
    assert.equal((await q(`SELECT count(*)::int n FROM eos_finance.cost_evidence_exception_resolutions WHERE receiving_correction_id = $1`, [r.correctionId])).rows[0].n, 1);
    const row = (await reads.listReceipts({ pool }, actor([RECEIPT_READ]), {})).items.find((i) => i.receiptId === rcv.receivingId);
    assert.deepEqual([row.status, row.corrected], ["CANCELLED", true]);
    const audit = (await q(`SELECT count(*)::int n FROM eos_policy.audit_events WHERE action = 'inventory.receipt.correct' AND target_id = $1`, [rcv.receivingId])).rows[0].n;
    assert.equal(audit, 1);

    const afterApply = await snap();
    const again = await correct(rcv.receivingId, { idempotencyKey: "void-1" });
    assert.deepEqual([again.outcome, again.correctionId], ["replayed", r.correctionId]);
    assert.deepEqual(await snap(), afterApply, "a replay writes nothing");
    assert.equal((await refusal(() => correct(rcv.receivingId, { idempotencyKey: "void-1", reason: "a different reason" }))).code, "IDEMPOTENCY_CONFLICT");
    assert.equal((await refusal(() => correct(rcv.receivingId, { idempotencyKey: "void-2" }))).code, "RECEIPT_ALREADY_CORRECTED");
    assert.deepEqual(await snap(), afterApply, "neither refusal wrote anything");

    // The order is receivable again for the right quantity -- the correction of a wrong quantity is a new receipt.
    const redo = await receive(po, [{ lineId: "L1", partId: "PART-A", receivedQuantity: 3 }]);
    assert.equal(redo.outcome, "applied");
    assert.deepEqual(redo.lines.map((l) => [l.previouslyReceived, l.receivedNow, l.remainingQuantity]), [[0, 3, 7]]);
  });

  await t.test("a receipt that COMPLETED the order, once voided, makes the order receivable again (RECEIVED -> SENT)", async () => {
    const po = await order({ lines: [["L1", "PART-A", 3]] });
    const rcv = await receive(po, [{ lineId: "L1", partId: "PART-A", receivedQuantity: 3 }]);
    assert.equal(rcv.storedStatus, "RECEIVED");
    await refusal(() => receive(po, [{ lineId: "L1", partId: "PART-A", receivedQuantity: 1 }])); // nothing is left to receive on a completed order
    await correct(rcv.receivingId);
    assert.equal((await q(`SELECT status FROM eos_ops.supplier_purchase_orders WHERE id = $1`, [po])).rows[0].status, "SENT");
    assert.equal((await receive(po, [{ lineId: "L1", partId: "PART-A", receivedQuantity: 3 }])).storedStatus, "RECEIVED");
  });

  await t.test("the received stock must still be where the receipt put it: consumed or moved stock refuses the correction with zero trace", async () => {
    const po = await order();
    const rcv = await receive(po, [{ lineId: "L1", partId: "PART-A", receivedQuantity: 4 }]);
    const stock = await onHand("PART-A", "wh-1");
    await q(`INSERT INTO eos_ops.inventory_movements (id, tenant_id, operating_company_key, part_id, tracking_mode, location_type, location_id,
               movement_type, quantity_delta, source_kind, source_id, created_by)
             VALUES ($1,'t1','sample-co','PART-A','NONE','WAREHOUSE','wh-1','WORK_ORDER_CONSUMPTION',$2,'FIXTURE','fixture','fixture')`, [`mov-take-${seq++}`, -(stock - 1)]);
    const before = await snap();
    const err = await refusal(() => correct(rcv.receivingId));
    assert.deepEqual([err.code, err.category], ["RECEIPT_STOCK_ALREADY_MOVED", "PRECONDITION_FAILED"]);
    assert.deepEqual(await snap(), before);
  });

  await t.test("two lines of the SAME part into one location: the stock check is against the SUM received -- a partly consumed receipt is refused, never driven negative; the whole receipt voids when the stock is all there", async () => {
    await part("PART-B", "STANDARD");
    const lines = [{ lineId: "L1", partId: "PART-B", receivedQuantity: 4 }, { lineId: "L2", partId: "PART-B", receivedQuantity: 4 }];
    const po = await order({ lines: [["L1", "PART-B", 5], ["L2", "PART-B", 5]] });
    const rcv = await receive(po, lines);
    assert.equal(await onHand("PART-B", "wh-1"), 8);
    await q(`INSERT INTO eos_ops.inventory_movements (id, tenant_id, operating_company_key, part_id, tracking_mode, location_type, location_id,
               movement_type, quantity_delta, source_kind, source_id, created_by)
             VALUES ($1,'t1','sample-co','PART-B','NONE','WAREHOUSE','wh-1','WORK_ORDER_CONSUMPTION',-3,'FIXTURE','fixture','fixture')`, [`mov-take-${seq++}`]);
    // 5 remain: each line (4) passes on its own, the two together (8) do not.
    const before = await snap();
    const err = await refusal(() => correct(rcv.receivingId));
    assert.deepEqual([err.code, err.category], ["RECEIPT_STOCK_ALREADY_MOVED", "PRECONDITION_FAILED"]);
    assert.match(err.message, /only 5 of the 8 received remain/);
    assert.deepEqual(await snap(), before, "zero trace");
    assert.equal(await onHand("PART-B", "wh-1"), 5, "never negative");

    // Happy path: another receipt of the same shape, nothing consumed from it -> the whole receipt is reversed, both lines.
    const po2 = await order({ lines: [["L1", "PART-B", 5], ["L2", "PART-B", 5]] });
    const rcv2 = await receive(po2, lines);
    assert.equal(await onHand("PART-B", "wh-1"), 13);
    const done = await correct(rcv2.receivingId);
    assert.equal(done.compensatingMovementIds.length, 2);
    assert.equal(await onHand("PART-B", "wh-1"), 5);
    assert.equal((await q(`SELECT status FROM eos_ops.receiving_orders WHERE id = $1`, [rcv2.receivingId])).rows[0].status, "CANCELLED");
  });

  await t.test("a RESEND of a receipt that a correction has since VOIDED is refused (RECEIPT_CANCELLED), never answered 'replayed'", async () => {
    const po = await order({ lines: [["L1", "PART-A", 3]] });
    const req = {
      source: { type: "PURCHASE_ORDER", purchaseOrderId: po }, receivingLocation: { type: "WAREHOUSE", locationId: "wh-1" },
      lines: [{ lineId: "L1", partId: "PART-A", receivedQuantity: 3 }], idempotencyKey: "k-resend-after-void",
    };
    const first = await spo.receiveSupplierPurchaseOrder({ pool, now: () => FIXED }, actor([RECEIVE]), req);
    assert.equal((await spo.receiveSupplierPurchaseOrder({ pool, now: () => FIXED }, actor([RECEIVE]), req)).outcome, "replayed", "before the void, a retry is a replay");
    await correct(first.receivingId);
    const before = await snap();
    const err = await refusal(() => spo.receiveSupplierPurchaseOrder({ pool, now: () => FIXED }, actor([RECEIVE]), req));
    assert.deepEqual([err.code, err.category], ["RECEIPT_CANCELLED", "PRECONDITION_FAILED"]);
    assert.deepEqual(await snap(), before, "nothing is received again");
  });

  await t.test("an idempotency key already recorded for ANOTHER company's correction is a clean IDEMPOTENCY_CONFLICT, not a database error; the correction's own replay still works", async () => {
    const po = await order({ lines: [["L1", "PART-A", 3]] });
    const r1 = await receive(po, [{ lineId: "L1", partId: "PART-A", receivedQuantity: 3 }]);
    const poV = await order({ companyKey: "ventana-co", lines: [["L1", "PART-A", 3]] });
    const rV = await receive(poV, [{ lineId: "L1", partId: "PART-A", receivedQuantity: 3 }], "wh-v", ventana);
    const first = await correct(r1.receivingId, { idempotencyKey: "shared-correction-key" });
    const before = await snap();
    const err = await refusal(() => correct(rV.receivingId, { idempotencyKey: "shared-correction-key" }, actor([CORRECT], ventana)));
    assert.deepEqual([err.code, err.category], ["IDEMPOTENCY_CONFLICT", "CONFLICT"]);
    assert.deepEqual(await snap(), before, "the Ventana receipt is untouched");
    assert.equal((await correct(r1.receivingId, { idempotencyKey: "shared-correction-key" })).correctionId, first.correctionId, "the owner's own retry replays");
  });

  await t.test("a serialized receipt cannot be corrected here (custody has no never-arrived state)", async () => {
    const po = await order({ lines: [["L1", "PART-S", 1]] });
    const rcv = await receive(po, [{ lineId: "L1", partId: "PART-S", receivedQuantity: 1, serialNumbers: ["SN-100"] }]);
    const before = await snap();
    assert.equal((await refusal(() => correct(rcv.receivingId))).code, "RECEIPT_CORRECTION_SERIAL_UNSUPPORTED");
    assert.deepEqual(await snap(), before);
  });
});
