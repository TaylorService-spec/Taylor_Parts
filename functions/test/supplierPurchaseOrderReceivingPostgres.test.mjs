// THE CANONICAL SUPPLIER PURCHASE ORDER, RECEIVED ON EOS -- against a real postgres:16 (Firebase exit B3, DECISIONS #B3; Owner ruling 4).
//
// It proves the complete receiving behaviour the Firebase receiveInventoryStock / getPurchaseOrderReceivingProgress /
// listReceivablePurchaseOrders / listReceivingLocationOptions callables had, on PostgreSQL: multi-line partial receipts over time with
// DERIVED received / remaining, over-receipt measured against REMAINING, serials, idempotent retry (replay writes nothing; a different
// request under a used key is refused), atomicity (every refusal leaves ZERO trace), the concurrency anchor, the stored lifecycle moving to
// RECEIVED only when every line is satisfied, and COMPANY ISOLATION (capability first, then company; out-of-company == nonexistent).
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
const cmd = require("../lib/eosOps/supplierPurchaseOrderReceiving.js");
const notes = require("../lib/eosOps/legacyInventoryActionNotes.js");
const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");

const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

const RECEIVE = "inventory.stock.receive";
const FIXED = new Date("2026-10-18T15:00:00.000Z");

test("Supplier purchase order receiving on PostgreSQL: the whole closure or none of it", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `spo_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
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

  // Two companies, two DIFFERENT keys (the key is not the company id).
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

  await q(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id, updated_at)
           VALUES ('e-r','t1','ACTIVE','taylor','2020-01-01T00:00:00Z'), ('e-r2','t1','ACTIVE','taylor','2020-01-01T00:00:00Z'),
                  ('e-v','t1','ACTIVE','ventana','2020-01-01T00:00:00Z')`);
  await q(`INSERT INTO eos_policy.employee_principal_links (id, tenant_id, principal_id, employee_id, operating_company_id, link_source, asserted_by, assertion_reason, status)
           VALUES ('epl-r','t1',$1,'e-r','taylor','OPERATOR_ASSERTED','f','test','active'),
                  ('epl-r2','t1',$2,'e-r2','taylor','OPERATOR_ASSERTED','f','test','active'),
                  ('epl-v','t1',$3,'e-v','ventana','OPERATOR_ASSERTED','f','test','active')`, [receiver, receiver2, ventanaReceiver]);
  // The receiver holds the WAREHOUSE scope over wh-1 and wh-closed, NOT wh-2; receiver2 holds wh-1 and wh-2; the Ventana receiver holds wh-v.
  await q(`INSERT INTO eos_workforce.employee_operational_scopes (id, tenant_id, employee_id, scope_type, scope_id, effective_from, assigned_by)
           VALUES ('os-r-1','t1','e-r','WAREHOUSE','wh-1', now(),'fixture'), ('os-r-c','t1','e-r','WAREHOUSE','wh-closed', now(),'fixture'),
                  ('os-r2-1','t1','e-r2','WAREHOUSE','wh-1', now(),'fixture'), ('os-r2-2','t1','e-r2','WAREHOUSE','wh-2', now(),'fixture'),
                  ('os-v-v','t1','e-v','WAREHOUSE','wh-v', now(),'fixture')`);

  const part = (id, controlType, status = "ACTIVE") => q(
    `INSERT INTO eos_ops.parts (id, tenant_id, created_by, internal_part_number, name, status, stocking_unit,
                                control_type, stocking_class, expiry_tracked, consumable, returnable_core,
                                whole_unit, version, updated_by)
     VALUES ($1,'t1','fixture',$1,$1,$2,'EACH',$3,'STOCKED',false,false,false,false,1,'fixture')`, [id, status, controlType]);
  await part("PART-A", "STANDARD");
  await part("PART-B", "STANDARD");
  await part("PART-S", "SERIALIZED");
  await part("PART-LOT", "LOT");

  let seq = 0;
  /** A canonical purchase order with its lines. `lines` = [[lineId, partId, quantity], ...]. */
  const order = async (over = {}) => {
    const id = over.id ?? `po-${++seq}`;
    const o = { companyKey: "sample-co", status: "SENT", version: 0, supplierId: null, lines: [["L1", "PART-A", 10], ["L2", "PART-S", 2]], ...over };
    await q(`INSERT INTO eos_ops.supplier_purchase_orders (id, tenant_id, operating_company_key, supplier_id, external_po_number, status, version, created_by, updated_by)
             VALUES ($1,'t1',$2,$3,$4,$5,$6,'fixture','fixture')`, [id, o.companyKey, o.supplierId, o.externalPoNumber ?? null, o.status, o.version]);
    for (const [lineId, partId, quantity] of o.lines) {
      await q(`INSERT INTO eos_ops.supplier_purchase_order_lines (tenant_id, purchase_order_id, line_id, part_id, ordered_quantity) VALUES ('t1',$1,$2,$3,$4)`,
        [id, lineId, partId, quantity]);
    }
    return id;
  };

  const actor = (caps = [RECEIVE], principalId = receiver) => ({ tenantId: "t1", principalId, capabilities: new Set(caps) });
  const request = (poId, over = {}) => ({
    source: { type: "PURCHASE_ORDER", purchaseOrderId: poId },
    receivingLocation: { type: "WAREHOUSE", locationId: "wh-1" },
    lines: [{ lineId: "L1", partId: "PART-A", receivedQuantity: 4 }],
    idempotencyKey: `idem-${poId}-${randomUUID().slice(0, 6)}`,
    ...over,
  });
  const run = (input, a = actor(), now = () => FIXED) => cmd.receiveSupplierPurchaseOrder({ pool, now }, a, input);
  const refusal = async (fn) => { try { await fn(); } catch (err) { return err; } assert.fail("expected a refusal"); };
  const counts = async () => {
    const one = async (sql) => (await q(sql)).rows[0].n;
    return {
      receipts: await one(`SELECT count(*)::int n FROM eos_ops.receiving_orders`),
      lines: await one(`SELECT count(*)::int n FROM eos_ops.receiving_order_lines`),
      movements: await one(`SELECT count(*)::int n FROM eos_ops.inventory_movements`),
      custody: await one(`SELECT count(*)::int n FROM eos_ops.serialized_custody`),
      audits: await one(`SELECT count(*)::int n FROM eos_policy.audit_events`),
      counters: await one(`SELECT COALESCE(sum(last_value),0)::int n FROM eos_ops.receiving_number_counters`),
      exceptions: await one(`SELECT count(*)::int n FROM eos_finance.cost_evidence_exceptions`),
      versions: await one(`SELECT COALESCE(sum(version),0)::int n FROM eos_ops.supplier_purchase_orders`),
    };
  };

  // ════════════════════════════ AUTHORITY: capability first, then company ════════════════════════════

  await t.test("an actor without inventory.stock.receive is refused on every operation, and writes nothing", async () => {
    const id = await order();
    const before = await counts();
    for (const fn of [
      () => run(request(id), actor([])),
      () => cmd.listReceivableSupplierPurchaseOrders({ pool }, actor([]), {}),
      () => cmd.readSupplierPurchaseOrderProgress({ pool }, actor([]), { purchaseOrderId: id }),
      () => cmd.listSupplierReceivingLocationOptions({ pool }, actor([]), { purchaseOrderId: id }),
    ]) {
      const err = await refusal(fn);
      assert.equal(err.code, "CAPABILITY_REQUIRED");
      assert.equal(err.category, "FORBIDDEN");
    }
    assert.deepEqual(await counts(), before);
  });

  await t.test("a principal with NO operating-company authority is refused COMPANY_AUTHORITY_REQUIRED before any row is read", async () => {
    const id = await order();
    const before = await counts();
    for (const fn of [
      () => run(request(id), actor([RECEIVE], nobody)),
      () => cmd.listReceivableSupplierPurchaseOrders({ pool }, actor([RECEIVE], nobody), {}),
      () => cmd.readSupplierPurchaseOrderProgress({ pool }, actor([RECEIVE], nobody), { purchaseOrderId: id }),
    ]) {
      const err = await refusal(fn);
      assert.equal(err.code, "COMPANY_AUTHORITY_REQUIRED");
      assert.equal(err.category, "FORBIDDEN");
    }
    assert.deepEqual(await counts(), before);
  });

  await t.test("COMPANY ISOLATION: an order of another company reads EXACTLY as a nonexistent one, on every operation", async () => {
    const taylorOrder = await order();
    const ventanaOrder = await order({ companyKey: "ventana-co", lines: [["L1", "PART-A", 5]] });
    const before = await counts();
    const missing = await refusal(() => run(request("po-does-not-exist"), actor([RECEIVE], ventanaReceiver)));
    const hidden = await refusal(() => run(request(taylorOrder), actor([RECEIVE], ventanaReceiver)));
    assert.deepEqual([hidden.code, hidden.category, hidden.message], [missing.code, missing.category, missing.message]);
    assert.equal(hidden.code, "PURCHASE_ORDER_NOT_FOUND");
    const hiddenProgress = await refusal(() => cmd.readSupplierPurchaseOrderProgress({ pool }, actor([RECEIVE], ventanaReceiver), { purchaseOrderId: taylorOrder }));
    assert.equal(hiddenProgress.code, "PURCHASE_ORDER_NOT_FOUND");
    const hiddenOptions = await refusal(() => cmd.listSupplierReceivingLocationOptions({ pool }, actor([RECEIVE], ventanaReceiver), { purchaseOrderId: taylorOrder }));
    assert.equal(hiddenOptions.code, "PURCHASE_ORDER_NOT_FOUND");
    assert.deepEqual(await counts(), before, "a refusal precedes every write");
    // The lists are company-scoped too: each receiver sees only its own company's orders.
    const mine = (await cmd.listReceivableSupplierPurchaseOrders({ pool }, actor([RECEIVE], receiver), {})).purchaseOrders.map((p) => p.purchaseOrderId);
    const theirs = (await cmd.listReceivableSupplierPurchaseOrders({ pool }, actor([RECEIVE], ventanaReceiver), {})).purchaseOrders.map((p) => p.purchaseOrderId);
    assert.ok(mine.includes(taylorOrder) && !mine.includes(ventanaOrder));
    assert.ok(theirs.includes(ventanaOrder) && !theirs.includes(taylorOrder));
  });

  // ════════════════════════════ THE LIST, PROGRESS AND DESTINATION READS ════════════════════════════

  await t.test("the receivable list holds only APPROVED / SENT orders; progress is DERIVED and names an unresolved part UNKNOWN", async () => {
    const sent = await order({ status: "SENT" });
    const approved = await order({ status: "APPROVED", lines: [["L1", "PART-B", 3]] });
    const draft = await order({ status: "DRAFT" });
    const done = await order({ status: "RECEIVED" });
    const cancelled = await order({ status: "CANCELLED" });
    const ids = (await cmd.listReceivableSupplierPurchaseOrders({ pool }, actor(), {})).purchaseOrders;
    const byId = new Map(ids.map((p) => [p.purchaseOrderId, p]));
    assert.ok(byId.has(sent) && byId.has(approved));
    for (const id of [draft, done, cancelled]) assert.equal(byId.has(id), false);
    assert.deepEqual([byId.get(sent).storedStatus, byId.get(sent).lineCount, byId.get(approved).lineCount], ["SENT", 2, 1]);

    const progress = await cmd.readSupplierPurchaseOrderProgress({ pool }, actor(), { purchaseOrderId: sent });
    assert.deepEqual([progress.receivable, progress.version, progress.derivedState], [true, 0, "NOT_RECEIVED"]);
    assert.deepEqual(progress.lines.map((l) => [l.lineId, l.trackingMode, l.orderedQuantity, l.receivedQuantity, l.remainingQuantity]),
      [["L1", "NONE", 10, 0, 10], ["L2", "SERIAL", 2, 0, 2]]);
    const gone = await order({ lines: [["L1", "PART-MISSING", 1]] });
    assert.equal((await cmd.readSupplierPurchaseOrderProgress({ pool }, actor(), { purchaseOrderId: gone })).lines[0].trackingMode, "UNKNOWN");
    assert.equal((await cmd.readSupplierPurchaseOrderProgress({ pool }, actor(), { purchaseOrderId: draft })).receivable, false);
  });

  await t.test("destinations: only ACTIVE warehouses of the ORDER'S company in the receiver's scope, in the DTO the client validates", async () => {
    const id = await order();
    const one = await cmd.listSupplierReceivingLocationOptions({ pool }, actor(), { purchaseOrderId: id });
    assert.deepEqual(one.options.map((o) => [o.value, o.type, Object.keys(o).sort().join(",")]), [["wh-1", "WAREHOUSE", "label,type,value"]]);
    const two = await cmd.listSupplierReceivingLocationOptions({ pool }, actor([RECEIVE], receiver2), { purchaseOrderId: id });
    assert.deepEqual(two.options.map((o) => o.value), ["wh-1", "wh-2"]);
    // wh-closed is inactive and wh-v belongs to another company: neither is offered to anyone.
    assert.equal(two.options.some((o) => o.value === "wh-closed" || o.value === "wh-v"), false);
  });

  // ════════════════════════════ THE RECEIPT: partial, multi-line, derived, lifecycle ════════════════════════════

  await t.test("partial receipts over time: stored status stays SENT while partial, RECEIVED only when every line is satisfied; version counts receipts", async () => {
    const id = await order();
    const first = await run(request(id, { idempotencyKey: "k-first" }));
    assert.equal(first.outcome, "applied");
    assert.equal(first.derivedState, "PARTIALLY_RECEIVED");
    assert.deepEqual([first.storedStatus, first.version], ["SENT", 1]);
    assert.match(first.receivingOrderNumber, /^RO-2026-\d{6,}$/);
    assert.equal(first.ledgerEventId, first.movementIds[0]);
    assert.deepEqual(first.lines.map((l) => [l.lineId, l.previouslyReceived, l.receivedNow, l.remainingQuantity, l.state]),
      [["L1", 0, 4, 6, "PARTIALLY_RECEIVED"], ["L2", 0, 0, 2, "NOT_RECEIVED"]]);
    const afterFirst = await q(`SELECT status, version FROM eos_ops.supplier_purchase_orders WHERE id = $1`, [id]);
    assert.deepEqual([afterFirst.rows[0].status, afterFirst.rows[0].version], ["SENT", 1]);

    const second = await run(request(id, {
      idempotencyKey: "k-second",
      lines: [{ lineId: "L1", partId: "PART-A", receivedQuantity: 6 }, { lineId: "L2", partId: "PART-S", receivedQuantity: 2, serialNumbers: ["SN-1", "SN-2"] }],
    }));
    assert.equal(second.derivedState, "RECEIVED");
    assert.deepEqual([second.storedStatus, second.version], ["RECEIVED", 2]);
    assert.equal(second.movementIds.length, 3, "one movement for the NONE line, one per serialized unit");
    assert.equal(second.serializedCustodyIds.length, 2);
    // Every movement is a RECEIVED increase at the destination, stamped with the receipt's business time.
    const m = await q(`SELECT movement_type::text AS t, quantity_delta, location_type::text AS lt, location_id, occurred_at, source_id FROM eos_ops.inventory_movements WHERE source_id = $1 ORDER BY quantity_delta DESC`, [second.receivingId]);
    assert.deepEqual(m.rows.map((r) => [r.t, r.quantity_delta, r.lt, r.location_id]), [["RECEIVED", 6, "WAREHOUSE", "wh-1"], ["RECEIVED", 1, "WAREHOUSE", "wh-1"], ["RECEIVED", 1, "WAREHOUSE", "wh-1"]]);
    assert.equal(m.rows[0].occurred_at.toISOString(), FIXED.toISOString());
    // The order is now closed: a further NEW receipt is refused (every line is already satisfied; the status gate itself is proved on a CANCELLED order below). A replay of an applied one is not -- see below.
    const closed = await refusal(() => run(request(id, { idempotencyKey: "k-late" })));
    assert.equal(closed.code, "RECEIPT_LINE_ALREADY_SATISFIED");
    const progress = await cmd.readSupplierPurchaseOrderProgress({ pool }, actor(), { purchaseOrderId: id });
    assert.deepEqual([progress.derivedState, progress.storedStatus, progress.receivable, progress.version], ["RECEIVED", "RECEIVED", false, 2]);
    // Cost is UNKNOWN, never zero: no cost evidence, a visible COST_EVIDENCE_MISSING exception for every received line, and no payable.
    const ex = await q(`SELECT receiving_line_id, condition FROM eos_finance.cost_evidence_exceptions WHERE receiving_id = ANY($1) ORDER BY receiving_line_id`, [[first.receivingId, second.receivingId]]);
    assert.equal(ex.rows.length, 3);
    assert.equal((await q(`SELECT count(*)::int n FROM eos_finance.inventory_acquisition_costs WHERE receiving_id = ANY($1)`, [[first.receivingId, second.receivingId]])).rows[0].n, 0);
    // One audit event per receipt, naming no secret.
    const audit = await q(`SELECT action, actor_uid, target_id FROM eos_policy.audit_events WHERE target_id = ANY($1) ORDER BY occurred_at`, [[first.receivingId, second.receivingId]]);
    assert.deepEqual(audit.rows.map((r) => [r.action, r.actor_uid]), [["inventory.stock.receive", receiver], ["inventory.stock.receive", receiver]]);
  });

  await t.test("over-receipt is measured against REMAINING, not ordered; the refusal leaves ZERO trace", async () => {
    const id = await order({ lines: [["L1", "PART-A", 10]] });
    await run(request(id, { idempotencyKey: "k-7", lines: [{ lineId: "L1", partId: "PART-A", receivedQuantity: 7 }] }));
    const before = await counts();
    const err = await refusal(() => run(request(id, { idempotencyKey: "k-5", lines: [{ lineId: "L1", partId: "PART-A", receivedQuantity: 5 }] })));
    assert.equal(err.code, "RECEIPT_OVER_RECEIPT");
    assert.equal(err.category, "PRECONDITION_FAILED");
    assert.deepEqual(await counts(), before);
  });

  await t.test("a mid-transaction failure rolls EVERYTHING back (a serial already in custody)", async () => {
    const a = await order({ lines: [["L1", "PART-S", 1]] });
    await run(request(a, { idempotencyKey: "k-sn-a", lines: [{ lineId: "L1", partId: "PART-S", receivedQuantity: 1, serialNumbers: ["SN-DUP"] }] }));
    const b = await order({ lines: [["L1", "PART-A", 2], ["L2", "PART-S", 1]] });
    const before = await counts();
    const err = await refusal(() => run(request(b, {
      idempotencyKey: "k-sn-b",
      lines: [{ lineId: "L1", partId: "PART-A", receivedQuantity: 2 }, { lineId: "L2", partId: "PART-S", receivedQuantity: 1, serialNumbers: ["SN-DUP"] }],
    })));
    assert.equal(err.code, "SERIAL_IDENTITY_CONFLICT");
    assert.deepEqual(await counts(), before, "the NONE line's movement, the receipt, its number, the exceptions and the version all rolled back");
  });

  await t.test("validation: unknown line, part mismatch, LOT, serial cardinality, serials on a NONE line, caller's stale expectedQuantity", async () => {
    const id = await order({ lines: [["L1", "PART-A", 5], ["L2", "PART-S", 2], ["L3", "PART-LOT", 1]] });
    const before = await counts();
    const cases = [
      [{ lines: [{ lineId: "L9", partId: "PART-A", receivedQuantity: 1 }] }, "RECEIPT_LINE_UNKNOWN"],
      [{ lines: [{ lineId: "L1", partId: "PART-B", receivedQuantity: 1 }] }, "RECEIPT_PART_MISMATCH"],
      [{ lines: [{ lineId: "L3", partId: "PART-LOT", receivedQuantity: 1 }] }, "RECEIPT_TRACKING_MODE_UNSUPPORTED"],
      [{ lines: [{ lineId: "L2", partId: "PART-S", receivedQuantity: 2, serialNumbers: ["ONLY-ONE"] }] }, "RECEIPT_SERIAL_COUNT_MISMATCH"],
      [{ lines: [{ lineId: "L2", partId: "PART-S", receivedQuantity: 2, serialNumbers: ["X", "X"] }] }, "RECEIPT_SERIAL_NUMBERS_DUPLICATED"],
      [{ lines: [{ lineId: "L1", partId: "PART-A", receivedQuantity: 1, serialNumbers: ["S"] }] }, "RECEIPT_SERIAL_NUMBERS_NOT_ALLOWED"],
      [{ lines: [{ lineId: "L1", partId: "PART-A", receivedQuantity: 1, expectedQuantity: 99 }] }, "RECEIPT_EXPECTED_QUANTITY_MISMATCH"],
      [{ lines: [{ lineId: "L1", partId: "PART-A", receivedQuantity: 0 }] }, "RECEIPT_QUANTITY_INVALID"],
      [{ lines: [{ lineId: "L1", partId: "PART-A", receivedQuantity: 1 }, { lineId: "L1", partId: "PART-A", receivedQuantity: 1 }] }, "RECEIPT_LINE_DUPLICATE"],
      [{ expectedVersion: 7 }, "RECEIPT_VERSION_CONFLICT"],
    ];
    for (const [over, code] of cases) {
      const err = await refusal(() => run(request(id, over)));
      assert.equal(err.code, code, JSON.stringify(over));
    }
    assert.deepEqual(await counts(), before);
    // An expectedVersion that IS current is accepted.
    const ok = await run(request(id, { expectedVersion: 0, lines: [{ lineId: "L1", partId: "PART-A", receivedQuantity: 1 }] }));
    assert.equal(ok.outcome, "applied");
  });

  await t.test("source authority: a Reorder source type is NOT owned here; a canonical source never carries a reorderRequestId; the status gate holds", async () => {
    const id = await order();
    const reorder = await refusal(() => run(request(id, { source: { type: "REORDER_PURCHASE_ORDER", reorderRequestId: id, purchaseOrderId: id } })));
    assert.equal(reorder.code, "SOURCE_TYPE_NOT_OWNED");
    const contradictory = await refusal(() => run(request(id, { source: { type: "PURCHASE_ORDER", reorderRequestId: id, purchaseOrderId: id } })));
    assert.equal(contradictory.code, "SOURCE_IDENTITY_MISMATCH");
    const unknownField = await refusal(() => run(request(id, { operatingCompanyKey: "ventana-co" })));
    assert.equal(unknownField.code, "INPUT_FIELD_NOT_ACCEPTED");
    const draft = await order({ status: "DRAFT" });
    assert.equal((await refusal(() => run(request(draft)))).code, "STATUS_NOT_RECEIVABLE");
    const cancelled = await order({ status: "CANCELLED" });
    assert.equal((await refusal(() => run(request(cancelled)))).code, "STATUS_NOT_RECEIVABLE");
  });

  await t.test("destination: scope, company, active, and never a truck", async () => {
    const id = await order({ lines: [["L1", "PART-A", 50]] });
    const before = await counts();
    const noScope = await refusal(() => run(request(id, { receivingLocation: { type: "WAREHOUSE", locationId: "wh-2" } })));
    assert.equal(noScope.code, "OUTSIDE_OPERATIONAL_SCOPE");
    assert.equal(noScope.category, "FORBIDDEN");
    const wrongCompany = await refusal(() => run(request(id, { receivingLocation: { type: "WAREHOUSE", locationId: "wh-v" } }), actor([RECEIVE], receiver)));
    assert.equal(wrongCompany.code, "DESTINATION_COMPANY_MISMATCH");
    const inactive = await refusal(() => run(request(id, { receivingLocation: { type: "WAREHOUSE", locationId: "wh-closed" } })));
    assert.equal(inactive.code, "DESTINATION_INVALID");
    const unknown = await refusal(() => run(request(id, { receivingLocation: { type: "WAREHOUSE", locationId: "wh-nope" } })));
    assert.equal(unknown.code, "DESTINATION_INVALID");
    const truck = await refusal(() => run(request(id, { receivingLocation: { type: "MOBILE", locationId: "truck-1" } })));
    assert.equal(truck.code, "RECEIPT_TO_MOBILE_REFUSED");
    assert.deepEqual(await counts(), before);
    // A receiver with scope over BOTH of the company's warehouses may choose either.
    const elsewhere = await run(request(id, { receivingLocation: { type: "WAREHOUSE", locationId: "wh-2" } }), actor([RECEIVE], receiver2));
    assert.equal(elsewhere.outcome, "applied");
  });

  // ════════════════════════════ IDEMPOTENT RETRY ════════════════════════════

  await t.test("replay: the same key and request writes NOTHING and returns the original receipt, even after the order is complete", async () => {
    const id = await order({ lines: [["L1", "PART-A", 3]] });
    const req = request(id, { idempotencyKey: "k-replay", lines: [{ lineId: "L1", partId: "PART-A", receivedQuantity: 3 }] });
    const original = await run(req);
    assert.equal(original.storedStatus, "RECEIVED");
    const before = await counts();
    const replay = await run(req, actor(), () => new Date("2027-01-01T00:00:00Z"));
    assert.equal(replay.outcome, "replayed");
    assert.equal(replay.receivingId, original.receivingId);
    assert.equal(replay.receivingOrderNumber, original.receivingOrderNumber);
    assert.equal(replay.receivedAt, original.receivedAt, "the ORIGINAL business time, not the retry's clock");
    assert.equal(replay.ledgerEventId, original.ledgerEventId);
    assert.deepEqual(replay.lines, original.lines, "equal by construction, not by compensating arithmetic");
    assert.deepEqual(await counts(), before, "no receipt, movement, number, audit, exception or version");
  });

  await t.test("a DIFFERENT request under a used key is refused (IDEMPOTENCY_CONFLICT); the key cannot be borrowed by another actor or order", async () => {
    const id = await order({ lines: [["L1", "PART-A", 9]] });
    await run(request(id, { idempotencyKey: "k-shared", lines: [{ lineId: "L1", partId: "PART-A", receivedQuantity: 3 }] }));
    const before = await counts();
    const different = await refusal(() => run(request(id, { idempotencyKey: "k-shared", lines: [{ lineId: "L1", partId: "PART-A", receivedQuantity: 2 }] })));
    assert.equal(different.code, "IDEMPOTENCY_CONFLICT");
    assert.equal(different.category, "CONFLICT");
    const otherActor = await refusal(() => run(request(id, { idempotencyKey: "k-shared", lines: [{ lineId: "L1", partId: "PART-A", receivedQuantity: 3 }] }), actor([RECEIVE], receiver2)));
    assert.equal(otherActor.code, "IDEMPOTENCY_CONFLICT");
    const otherOrder = await order({ lines: [["L1", "PART-A", 9]] });
    const crossOrder = await refusal(() => run(request(otherOrder, { idempotencyKey: "k-shared", lines: [{ lineId: "L1", partId: "PART-A", receivedQuantity: 3 }] })));
    assert.equal(crossOrder.code, "IDEMPOTENCY_CONFLICT");
    assert.deepEqual(await counts(), before);
  });

  await t.test("CONCURRENCY: two receipts racing for the last units serialize on the order -- exactly one applies, the other sees the first's receipt", async () => {
    const id = await order({ lines: [["L1", "PART-A", 5]] });
    const results = await Promise.allSettled([
      run(request(id, { idempotencyKey: "race-a", lines: [{ lineId: "L1", partId: "PART-A", receivedQuantity: 5 }] })),
      run(request(id, { idempotencyKey: "race-b", lines: [{ lineId: "L1", partId: "PART-A", receivedQuantity: 5 }] }), actor([RECEIVE], receiver2)),
    ]);
    const applied = results.filter((r) => r.status === "fulfilled");
    const refused = results.filter((r) => r.status === "rejected");
    assert.equal(applied.length, 1);
    assert.equal(refused.length, 1);
    assert.match(refused[0].reason.code, /^(STATUS_NOT_RECEIVABLE|RECEIPT_OVER_RECEIPT|RECEIPT_LINE_ALREADY_SATISFIED)$/);
    const row = await q(`SELECT status, version FROM eos_ops.supplier_purchase_orders WHERE id = $1`, [id]);
    assert.deepEqual([row.rows[0].status, row.rows[0].version], ["RECEIVED", 1]);
    assert.equal((await q(`SELECT sum(quantity_delta)::int n FROM eos_ops.inventory_movements WHERE source_id IN (SELECT id FROM eos_ops.receiving_orders WHERE source_purchase_order_id = $1)`, [id])).rows[0].n, 5);
  });

  // ════════════════════════════ THE ARCHIVED LEGACY NOTES (ruling 8) ════════════════════════════

  await t.test("the archived legacy notes: read-only, inventory.action.read, and an unloaded archive says so", async () => {
    const denied = await notes.listLegacyInventoryActionNotes({ pool }, actor([RECEIVE]), { partId: "PART-A" }).then(() => null, (e) => e);
    assert.equal(denied.code, "CAPABILITY_REQUIRED");
    const empty = await notes.listLegacyInventoryActionNotes({ pool }, actor(["inventory.action.read"]), { partId: "PART-A" });
    assert.deepEqual([empty.archiveLoaded, empty.items], [false, []]);
    await q(`INSERT INTO eos_ops.legacy_inventory_action_notes (tenant_id, id, part_id, transaction_type, quantity_delta, reason, created_by_ref, created_at_ms, archived_by)
             VALUES ('t1','n-1','PART-B','ADJUST_STOCK',-2,'cycle fix','firebase-uid-9',1000,'operator'), ('t1','n-2','PART-B','RECEIVE_STOCK',5,NULL,NULL,2000,'operator')`);
    const loaded = await notes.listLegacyInventoryActionNotes({ pool }, actor(["inventory.action.read"]), { partId: "PART-A" });
    assert.deepEqual([loaded.archiveLoaded, loaded.items], [true, []], "loaded archive, no notes for THIS part");
    const forB = await notes.listLegacyInventoryActionNotes({ pool }, actor(["inventory.action.read"]), { partId: "PART-B" });
    assert.deepEqual(forB.items.map((n) => [n.id, n.transactionType, n.quantityDelta, n.createdBy, n.createdAt]), [["n-2", "RECEIVE_STOCK", 5, null, 2000], ["n-1", "ADJUST_STOCK", -2, "firebase-uid-9", 1000]]);
    // Never stock authority: archiving a note moved no stock.
    assert.equal((await q(`SELECT count(*)::int n FROM eos_ops.inventory_movements WHERE part_id = 'PART-B'`)).rows[0].n, 0);
    const extra = await notes.listLegacyInventoryActionNotes({ pool }, actor(["inventory.action.read"]), { partId: "PART-B", limit: 5 }).then(() => null, (e) => e);
    assert.equal(extra.code, "INPUT_FIELD_NOT_ACCEPTED");
  });
});
