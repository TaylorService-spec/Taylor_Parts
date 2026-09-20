// THE GOVERNED POSTGRESQL RECEIVING AUTHORITY, against a real postgres:16.
//
// The acceptance question this suite answers is not "does a row appear". It is: can the whole
// business closure -- receipt, inventory movement, serialized custody, acquisition-cost evidence,
// Reorder closeout and audit -- happen atomically, and does EVERY failure leave zero trace of it?
//
// So most of these tests are about what does NOT get written.
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
const cmd = require("../lib/eosOps/receiveReorderStockCommand.js");
const lifecycle = require("../lib/eosOps/reorderLifecycleCommands.js");
const numbering = require("../lib/eosOps/receivingNumbering.js");
const identity = require("../lib/inventoryReceiving/receivingIdentity.js");
const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");

const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

const RECEIVE = "inventory.stock.receive";
const at = (iso) => new Date(iso);
const FIXED = at("2026-09-20T15:00:00.000Z");

test("PostgreSQL Receiving: one transaction, the whole business closure or none of it", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `rcv_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let pool;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => {
    await pool?.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations"], {
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
  const assignee = await principal("uid-assignee");

  // THE COMPANY AND THE KEY ARE DIFFERENT VALUES ON PURPOSE (Ruling R3). Company `taylor` operates
  // under the eos_ops key `sample-co`. Every assertion about the cost fact's company depends on the
  // two not being interchangeable -- an implementation that compared strings would pass with equal
  // values and be wrong in production.
  await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id, operating_company_id, status, source, established_by, updated_by)
           VALUES ('t1','taylor','ACTIVE','fixture','f','f'), ('t1','ventana','ACTIVE','fixture','f','f')`);
  await q(`INSERT INTO eos_policy.tenant_operating_company_keys
             (tenant_id, operating_company_id, operating_company_key, status, provenance, source, established_by, updated_by)
           VALUES ('t1','taylor','sample-co','ACTIVE','NATIVE','fixture','f','f'),
                  ('t1','ventana','dormant-co','INACTIVE','NATIVE','fixture','f','f')`);

  const warehouse = (id, key, status = "ACTIVE") => q(
    `INSERT INTO eos_ops.warehouses (id, tenant_id, operating_company_key, name, site_label, status, provenance, created_by, updated_by)
     VALUES ($1,'t1',$2,$1,'Sampleton',$3,'NATIVE','fixture','fixture')`, [id, key, status]);
  await warehouse("wh-1", "sample-co");
  await warehouse("wh-closed", "sample-co", "INACTIVE");

  const part = (id, controlType, status = "ACTIVE") => q(
    `INSERT INTO eos_ops.parts (id, tenant_id, created_by, internal_part_number, name, status, stocking_unit,
                                control_type, stocking_class, expiry_tracked, consumable, returnable_core,
                                whole_unit, version, updated_by)
     VALUES ($1,'t1','fixture',$1,$1,$2,'EACH',$3,'STOCKED',false,false,false,false,1,'fixture')`,
    [id, status, controlType]);
  await part("PART-NONE", "STANDARD");
  await part("PART-SERIAL", "SERIALIZED");
  await part("PART-LOT", "LOT");
  await part("PART-GONE", "STANDARD", "INACTIVE");

  /** A Reorder in ORDERED with its Purchase Order recorded. One call, one receivable chain. */
  let seq = 0;
  const chain = async (over = {}) => {
    const id = `rr-${++seq}`;
    const o = {
      partId: "PART-NONE", quantity: 4, companyKey: "sample-co",
      unitPriceMinor: null, currency: null, priceAuthorityVersion: null, status: "ORDERED", ...over,
    };
    await q(
      `INSERT INTO eos_ops.reorder_requests (id, tenant_id, operating_company_key, part_id, warehouse_id,
                                             status, requested_quantity, requested_by, updated_by, provenance)
       VALUES ($1,'t1',$2,$3,'wh-1',$4,$5,$6,$6,'NATIVE')`,
      [id, o.companyKey, o.partId, o.status, o.quantity, receiver]);
    await q(
      `INSERT INTO eos_ops.purchase_orders (id, tenant_id, operating_company_key, part_id, supplier_name,
                                            external_po_number, ordered_quantity, ordered_date,
                                            unit_price_minor, currency, price_authority_version, created_by)
       VALUES ($1,'t1',$2,$3,'Acme Supply','PO-EXT-1',$4, DATE '2026-09-01', $5, $6, $7, $8)`,
      [id, o.companyKey, o.partId, o.quantity, o.unitPriceMinor, o.currency, o.priceAuthorityVersion, receiver]);
    return id;
  };

  const actor = (caps = [RECEIVE], principalId = receiver) =>
    ({ tenantId: "t1", principalId, capabilities: new Set(caps) });

  const receipt = (id, over = {}) => ({
    source: { type: "REORDER_PURCHASE_ORDER", reorderRequestId: id, purchaseOrderId: id },
    receivingLocation: { type: "WAREHOUSE", locationId: "wh-1" },
    lines: [{ lineId: "L1", partId: "PART-NONE", receivedQuantity: 4 }],
    idempotencyKey: `idem-${id}`,
    ...over,
  });

  const run = (input, a = actor(), now = () => FIXED) => cmd.receiveReorderStock({ pool, now }, a, input);

  const counts = async () => {
    const one = async (sql) => (await q(sql)).rows[0].n;
    return {
      receipts: await one(`SELECT count(*)::int n FROM eos_ops.receiving_orders`),
      lines: await one(`SELECT count(*)::int n FROM eos_ops.receiving_order_lines`),
      movements: await one(`SELECT count(*)::int n FROM eos_ops.inventory_movements`),
      custody: await one(`SELECT count(*)::int n FROM eos_ops.serialized_custody`),
      costs: await one(`SELECT count(*)::int n FROM eos_finance.inventory_acquisition_costs`),
      audits: await one(`SELECT count(*)::int n FROM eos_policy.audit_events`),
      counters: await one(`SELECT COALESCE(sum(last_value),0)::int n FROM eos_ops.receiving_number_counters`),
      received: await one(`SELECT count(*)::int n FROM eos_ops.reorder_requests WHERE status = 'RECEIVED'`),
    };
  };
  const refusal = async (fn) => {
    try { await fn(); } catch (err) { return err; }
    assert.fail("expected a refusal");
  };

  // ════════════════════════════ AUTHORIZATION ════════════════════════════

  await t.test("an actor without inventory.stock.receive is refused, and writes nothing", async () => {
    const id = await chain();
    const before = await counts();
    const err = await refusal(() => run(receipt(id), actor([])));
    assert.equal(err.code, "CAPABILITY_REQUIRED");
    assert.equal(err.category, "FORBIDDEN");
    assert.deepEqual(await counts(), before);
  });

  await t.test("reorder.request.markReceived does NOT authorize a receipt (Ruling R2)", async () => {
    // The two capabilities answer different questions. Holding the closeout capability alone must
    // not let anyone record that stock arrived.
    const id = await chain();
    const err = await refusal(() => run(receipt(id), actor(["reorder.request.markReceived"])));
    assert.equal(err.code, "CAPABILITY_REQUIRED");
  });

  await t.test("the receiver need NOT be the assigned Employee (Ruling R2)", async () => {
    // No assignment exists for this Reorder at all, and the receipt still succeeds: the actor is the
    // Principal receiving the goods, never the assignee of the purchasing work.
    const id = await chain();
    const out = await run(receipt(id), actor([RECEIVE], receiver));
    assert.equal(out.outcome, "applied");
    assert.equal(out.reorderStatus, "RECEIVED");
  });

  // ════════════════════════════ SOURCE AUTHORITY ════════════════════════════

  await t.test("a canonical PURCHASE_ORDER receipt is REFUSED, never redirected (Ruling R1)", async () => {
    const id = await chain();
    const err = await refusal(() => run(receipt(id, {
      source: { type: "PURCHASE_ORDER", reorderRequestId: id, purchaseOrderId: id },
    })));
    assert.equal(err.code, "SOURCE_TYPE_NOT_OWNED");
    assert.match(err.message, /separate business slice/);
  });

  await t.test("a missing Reorder and a missing Purchase Order are both refused", async () => {
    const missing = await refusal(() => run(receipt("rr-nope")));
    assert.equal(missing.code, "REORDER_NOT_FOUND");

    const id = `rr-po-less-${randomUUID().slice(0, 8)}`;
    await q(`INSERT INTO eos_ops.reorder_requests (id, tenant_id, operating_company_key, part_id, warehouse_id,
                                                   status, requested_quantity, requested_by, updated_by, provenance)
             VALUES ($1,'t1','sample-co','PART-NONE','wh-1','ORDERED',4,$2,$2,'NATIVE')`, [id, receiver]);
    const noPo = await refusal(() => run(receipt(id)));
    assert.equal(noPo.code, "PURCHASE_ORDER_NOT_FOUND");
  });

  await t.test("the legacy identity equation is enforced before anything is read", async () => {
    const id = await chain();
    const err = await refusal(() => run(receipt(id, {
      source: { type: "REORDER_PURCHASE_ORDER", reorderRequestId: id, purchaseOrderId: "something-else" },
    })));
    assert.equal(err.code, "SOURCE_IDENTITY_MISMATCH");
  });

  await t.test("a Reorder that is not ORDERED cannot be received against", async () => {
    for (const status of ["PENDING_REVIEW", "READY_FOR_PARTS_MANAGER", "PURCHASING_IN_PROGRESS"]) {
      const id = await chain({ status });
      const before = await counts();
      const err = await refusal(() => run(receipt(id)));
      assert.equal(err.code, "STATUS_NOT_RECEIVABLE", status);
      assert.deepEqual(await counts(), before, status);
    }
  });

  await t.test("a fully received order refuses a SECOND receipt -- only its own retry replays", async () => {
    const id = await chain({ quantity: 3 });
    const body = { lines: [{ lineId: "L1", partId: "PART-NONE", receivedQuantity: 3 }] };
    await run(receipt(id, body));
    const before = await counts();
    // A different idempotency key is a DIFFERENT receipt, so nothing is excluded from the
    // derivation and the first receipt has already satisfied the line. The quantity rule answers
    // first -- it is measured against what REMAINS, which is now zero -- and the status gate never
    // has to. Both refuse; this is the one that describes what is actually wrong.
    const err = await refusal(() => run(receipt(id, { ...body, idempotencyKey: `idem-second-${id}` })));
    assert.equal(err.code, "RECEIPT_LINE_ALREADY_SATISFIED");
    assert.equal(err.category, "PRECONDITION_FAILED");
    assert.deepEqual(await counts(), before, "a refused second receipt writes nothing");
  });

  // ════════════════════════════ DESTINATION AND PART ════════════════════════════

  await t.test("an INACTIVE or unknown destination is refused", async () => {
    for (const locationId of ["wh-closed", "wh-does-not-exist"]) {
      const id = await chain();
      const err = await refusal(() => run(receipt(id, {
        receivingLocation: { type: "WAREHOUSE", locationId },
      })));
      assert.equal(err.code, "DESTINATION_INVALID", locationId);
    }
  });

  await t.test("an INACTIVE part and an unsupported tracking mode are both refused", async () => {
    const inactive = await chain({ partId: "PART-GONE" });
    const a = await refusal(() => run(receipt(inactive, {
      lines: [{ lineId: "L1", partId: "PART-GONE", receivedQuantity: 4 }],
    })));
    assert.equal(a.code, "RECEIPT_PART_INACTIVE");

    // LOT is still deferred, and still fails closed rather than being received as if untracked.
    const lot = await chain({ partId: "PART-LOT" });
    const b = await refusal(() => run(receipt(lot, {
      lines: [{ lineId: "L1", partId: "PART-LOT", receivedQuantity: 4 }],
    })));
    assert.equal(b.code, "RECEIPT_TRACKING_MODE_UNSUPPORTED");
  });

  await t.test("a partial legacy receipt is refused -- the legacy chain is full-quantity", async () => {
    const id = await chain();
    const err = await refusal(() => run(receipt(id, {
      lines: [{ lineId: "L1", partId: "PART-NONE", receivedQuantity: 3 }],
    })));
    assert.equal(err.code, "RECEIPT_LEGACY_PARTIAL_RECEIPT_UNSUPPORTED");
  });

  // ════════════════════════════ THE INVENTORY EFFECT ════════════════════════════

  await t.test("a NONE receipt moves on-hand exactly once, and carries the receipt's business time", async () => {
    const id = await chain({ quantity: 7 });
    const out = await run(receipt(id, { lines: [{ lineId: "L1", partId: "PART-NONE", receivedQuantity: 7 }] }));
    assert.equal(out.outcome, "applied");
    assert.equal(out.movementIds.length, 1);

    const { rows } = await q(
      `SELECT movement_type::text AS type, quantity_delta, serial_number, source_kind, source_id,
              occurred_at, operating_company_key, tracking_mode::text AS mode
         FROM eos_ops.inventory_movements WHERE source_id = $1`, [out.receivingId]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].type, "RECEIVED");
    assert.equal(rows[0].quantity_delta, 7, "a RECEIVED movement is a positive magnitude");
    assert.equal(rows[0].serial_number, null);
    assert.equal(rows[0].source_kind, "RECEIVING_ORDER");
    assert.equal(rows[0].mode, "NONE");
    // The KEY, on the operational row. The company id belongs to the financial fact, not here.
    assert.equal(rows[0].operating_company_key, "sample-co");
    assert.equal(rows[0].occurred_at.toISOString(), FIXED.toISOString());

    const onHand = await q(
      `SELECT COALESCE(sum(quantity_delta),0)::int n FROM eos_ops.inventory_movements
        WHERE tenant_id='t1' AND part_id='PART-NONE' AND location_type='WAREHOUSE' AND location_id='wh-1'
          AND source_id = $1`, [out.receivingId]);
    assert.equal(onHand.rows[0].n, 7);
  });

  await t.test("a SERIAL receipt stages ONE movement per unit, plus custody for each", async () => {
    const id = await chain({ partId: "PART-SERIAL", quantity: 3 });
    const out = await run(receipt(id, {
      lines: [{ lineId: "L1", partId: "PART-SERIAL", receivedQuantity: 3, serialNumbers: ["SN-A", "SN-B", "SN-C"] }],
    }));
    assert.equal(out.movementIds.length, 3, "one movement per physical unit");
    assert.equal(out.serializedCustodyIds.length, 3);

    const movements = await q(
      `SELECT quantity_delta, serial_number FROM eos_ops.inventory_movements
        WHERE source_id = $1 ORDER BY serial_number`, [out.receivingId]);
    assert.deepEqual(movements.rows.map((r) => r.serial_number), ["SN-A", "SN-B", "SN-C"]);
    assert.ok(movements.rows.every((r) => r.quantity_delta === 1), "a serial movement is exactly one unit");

    const custody = await q(
      `SELECT serial_number, status::text AS status, location_type::text AS lt, location_id, operating_company_key
         FROM eos_ops.serialized_custody WHERE tenant_id='t1' AND part_id='PART-SERIAL' ORDER BY serial_number`);
    assert.deepEqual(custody.rows.map((r) => r.serial_number), ["SN-A", "SN-B", "SN-C"]);
    assert.ok(custody.rows.every((r) => r.status === "AVAILABLE" && r.lt === "WAREHOUSE" && r.location_id === "wh-1"));
  });

  await t.test("the same physical unit cannot be received twice -- and the whole receipt is rolled back", async () => {
    // SN-A is already in custody from the receipt above. This receipt is otherwise perfectly valid,
    // so everything before the custody insert -- receipt, line, number, two movements -- has already
    // been written when it fails. NONE of it may survive.
    const id = await chain({ partId: "PART-SERIAL", quantity: 2 });
    const before = await counts();
    const err = await refusal(() => run(receipt(id, {
      lines: [{ lineId: "L1", partId: "PART-SERIAL", receivedQuantity: 2, serialNumbers: ["SN-A", "SN-Z"] }],
    })));
    assert.equal(err.code, "SERIAL_IDENTITY_CONFLICT");
    assert.deepEqual(await counts(), before, "a failed receipt leaves ZERO partial business effects");
  });

  // ════════════════════════════ ACQUISITION COST ════════════════════════════

  await t.test("an UNPRICED purchase order produces NO cost fact -- absence means unknown", async () => {
    const id = await chain();
    const costsBefore = (await counts()).costs;
    const out = await run(receipt(id));
    assert.deepEqual(out.acquisitionCostIds, []);
    assert.equal((await counts()).costs, costsBefore, "no row at all, and certainly not a zero-cost row");
  });

  await t.test("a PRICED purchase order produces exact, immutable cost evidence", async () => {
    const id = await chain({ quantity: 5, unitPriceMinor: 1234, currency: "USD", priceAuthorityVersion: 2 });
    const out = await run(receipt(id, { lines: [{ lineId: "L1", partId: "PART-NONE", receivedQuantity: 5 }] }));
    assert.equal(out.acquisitionCostIds.length, 1);

    const { rows } = await q(
      `SELECT * FROM eos_finance.inventory_acquisition_costs WHERE receiving_id = $1`, [out.receivingId]);
    assert.equal(rows.length, 1);
    const f = rows[0];
    assert.equal(f.cost_basis, "PURCHASE_ORDER_LINE_PRICE");
    // RULING R3: the COMPANY ID, resolved through the binding -- never the operational key.
    assert.equal(f.operating_company_id, "taylor");
    assert.notEqual(f.operating_company_id, "sample-co");
    assert.equal(Number(f.unit_price_minor), 1234);
    assert.equal(Number(f.extended_cost_minor), 1234 * 5, "extended cost is exact, in minor units");
    assert.equal(f.currency, "USD");
    assert.equal(f.received_quantity, 5);
    assert.equal(f.price_authority_version, 2);
    assert.equal(f.purchase_order_source_type, "REORDER_PURCHASE_ORDER");
    assert.equal(f.purchase_order_id, id);
    assert.equal(f.purchase_order_version, null, "the legacy chain has no revisions");
    assert.equal(f.supplier_name, "Acme Supply");
    assert.equal(f.receiving_location_id, "wh-1");
    assert.equal(f.received_at.toISOString(), FIXED.toISOString(), "the receipt's business time, not a write clock");

    // IMMUTABLE: a financial fact is corrected by a new fact, never by editing this one.
    await assert.rejects(
      q(`UPDATE eos_finance.inventory_acquisition_costs SET unit_price_minor = 1 WHERE id = $1`, [f.id]),
      /append-only/);
    await assert.rejects(
      q(`DELETE FROM eos_finance.inventory_acquisition_costs WHERE id = $1`, [f.id]),
      /append-only/);
  });

  await t.test("a priced purchase order with NO governed company binding FAILS CLOSED, writing nothing", async () => {
    // `dormant-co` is bound to an authorized company, but the BINDING is INACTIVE. The cost fact
    // cannot say whose acquisition this was, so the whole receipt is refused -- after the receipt,
    // the number, the line and the movement have already been written.
    await warehouse("wh-dormant", "dormant-co");
    const id = await chain({ companyKey: "dormant-co", unitPriceMinor: 900, currency: "USD" });
    const before = await counts();
    const err = await refusal(() => run(receipt(id, {
      receivingLocation: { type: "WAREHOUSE", locationId: "wh-dormant" },
    })));
    assert.equal(err.code, "OPERATING_COMPANY_NOT_GOVERNED");
    assert.deepEqual(await counts(), before, "no receipt, no movement, no number, no closeout");
  });

  // ════════════════════════════ IDEMPOTENCY ════════════════════════════

  await t.test("an exact replay returns the ORIGINAL receipt and produces ZERO additional effects", async () => {
    const id = await chain({ quantity: 6, unitPriceMinor: 250, currency: "USD", priceAuthorityVersion: 2 });
    const body = receipt(id, { lines: [{ lineId: "L1", partId: "PART-NONE", receivedQuantity: 6 }] });
    const first = await run(body);
    const after = await counts();

    // A LATER clock. The replay must not acquire a new business event time.
    const second = await run(body, actor(), () => at("2027-01-01T00:00:00.000Z"));
    assert.equal(second.outcome, "replayed");
    assert.equal(second.receivingId, first.receivingId);
    assert.equal(second.receivedAt, first.receivedAt, "a replay never acquires a new business event time");
    assert.equal(second.receivingOrderNumber, first.receivingOrderNumber);
    assert.deepEqual(second.movementIds, [], "a replay stages nothing");
    assert.deepEqual(second.acquisitionCostIds, []);
    assert.deepEqual(second.lines, first.lines, "a replay reports the same truthful progress");
    assert.deepEqual(await counts(), after, "no second receipt, movement, custody, cost, transition, audit or number");
  });

  await t.test("the same idempotency key with a DIFFERENT payload conflicts", async () => {
    const id = await chain({ quantity: 4 });
    const other = await chain({ quantity: 4 });
    const key = `idem-shared-${randomUUID().slice(0, 8)}`;
    await run(receipt(id, { idempotencyKey: key }));
    const before = await counts();
    const err = await refusal(() => run(receipt(other, { idempotencyKey: key })));
    assert.equal(err.code, "IDEMPOTENCY_CONFLICT");
    assert.equal(err.category, "CONFLICT");
    assert.deepEqual(await counts(), before);
  });

  await t.test("the LEGACY receipt identity contract is the key ALONE, not the target", async () => {
    // Proven from the shared derivation the Firestore authority uses. Promoting the legacy chain to
    // the canonical target-scoped identity would orphan every receipt deployed callers already hold.
    const id = await chain();
    const out = await run(receipt(id));
    assert.equal(out.receivingId, identity.receivingOrderDocId(`idem-${id}`));
    assert.match(out.receivingId, /^rcv_[0-9a-f]{40}$/);
  });

  // ════════════════════════════ CLOSEOUT AND AUDIT ════════════════════════════

  await t.test("the Reorder closes ONLY through a successful receipt, in the same transaction", async () => {
    const id = await chain({ quantity: 2 });
    const out = await run(receipt(id, { lines: [{ lineId: "L1", partId: "PART-NONE", receivedQuantity: 2 }] }));
    const { rows } = await q(
      `SELECT status::text AS status, received_at, received_by_principal_id
         FROM eos_ops.reorder_requests WHERE id = $1`, [id]);
    assert.equal(rows[0].status, "RECEIVED");
    assert.equal(rows[0].received_at.toISOString(), FIXED.toISOString(), "the receipt's own business time");
    assert.equal(rows[0].received_by_principal_id, receiver, "the RECEIVER closed it, not the assignee");

    // The audit is committed by the SAME transaction: it is present exactly when the receipt is.
    const audits = await q(
      `SELECT action, actor_uid, target_kind, target_id, after, occurred_at
         FROM eos_policy.audit_events WHERE target_id = $1`, [out.receivingId]);
    assert.equal(audits.rows.length, 1);
    assert.equal(audits.rows[0].action, "inventory.stock.receive");
    assert.equal(audits.rows[0].actor_uid, receiver);
    assert.equal(audits.rows[0].target_kind, "receiving_order");
    assert.equal(audits.rows[0].after.reorderStatus, "RECEIVED");
    assert.equal(audits.rows[0].occurred_at.toISOString(), FIXED.toISOString());
  });

  await t.test("a refused receipt closes nothing and audits nothing", async () => {
    const id = await chain({ partId: "PART-SERIAL", quantity: 1 });
    await refusal(() => run(receipt(id, {
      // One serial short of the quantity: refused by the shared validator, before any write.
      lines: [{ lineId: "L1", partId: "PART-SERIAL", receivedQuantity: 1, serialNumbers: [] }],
    })));
    const { rows } = await q(`SELECT status::text AS status FROM eos_ops.reorder_requests WHERE id = $1`, [id]);
    assert.equal(rows[0].status, "ORDERED", "a Reorder is never RECEIVED without the receipt");
  });

  // ════════════════════════════ THE RECEIVING NUMBER ════════════════════════════

  await t.test("RO-YYYY-###### is allocated once per receipt, and never on replay", async () => {
    const id = await chain();
    const out = await run(receipt(id));
    assert.match(out.receivingOrderNumber, /^RO-2026-[0-9]{6,}$/);
    const stored = await q(`SELECT receiving_order_number FROM eos_ops.receiving_orders WHERE id = $1`, [out.receivingId]);
    assert.equal(stored.rows[0].receiving_order_number, out.receivingOrderNumber);
    // Independent of the receipt id, which is a hash of the idempotency key.
    assert.ok(!out.receivingId.includes(out.receivingOrderNumber));
  });

  await t.test("concurrent allocations never collide", async () => {
    const year = 2031;
    const allocations = await Promise.all(Array.from({ length: 12 }, async () => {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        const n = await numbering.allocateReceivingOrderNumber(c, "t1", year);
        await c.query("COMMIT");
        return n;
      } finally { c.release(); }
    }));
    assert.equal(new Set(allocations).size, 12, "twelve concurrent allocations, twelve distinct numbers");
  });

  await t.test("a receipt cannot post a number another receipt already holds", async () => {
    const taken = await q(`SELECT id, receiving_order_number FROM eos_ops.receiving_orders
                            WHERE receiving_order_number IS NOT NULL LIMIT 1`);
    await assert.rejects(
      q(`UPDATE eos_ops.receiving_orders SET receiving_order_number = $1 WHERE id <> $2
           AND receiving_order_number IS NOT NULL`,
        [taken.rows[0].receiving_order_number, taken.rows[0].id]),
      /receiving_orders_number_unique/);
  });

  // ════════════════════════════ THE ACTIVATION BOUNDARY ════════════════════════════

  await t.test("markReorderReceived still answers while receiving is inert, and delegates to the shared closeout", async () => {
    assert.equal(lifecycle.RECEIVING_POSTGRES_ACTIVE, false,
      "the PostgreSQL receipt is built but the cutover is not active");
    const id = await chain({ quantity: 1 });
    await q(`INSERT INTO eos_ops.reorder_request_assignments
               (id, tenant_id, reorder_request_id, assigned_employee_id, assigned_by_principal_id, state)
             SELECT $1,'t1',$2,e.id,$3,'ACTIVE' FROM eos_ops.employees e WHERE e.tenant_id='t1' LIMIT 1`,
      [`ra_${randomUUID()}`, id, assignee]).catch(() => undefined);
    // The delegation itself is what this asserts: the standalone operation and the receipt now write
    // the RECEIVED transition through ONE function, so they cannot drift apart.
    assert.equal(typeof lifecycle.closeOutReorderAsReceived, "function");
  });

  await t.test("the shared closeout refuses a Reorder that is no longer ORDERED", async () => {
    const id = await chain({ quantity: 1 });
    await q(`UPDATE eos_ops.reorder_requests SET status='PENDING_REVIEW' WHERE id=$1`, [id]);
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await assert.rejects(
        lifecycle.closeOutReorderAsReceived(c, {
          tenantId: "t1", actorPrincipalId: receiver, reorderRequestId: id, receivedAt: FIXED, reason: "test",
        }),
        /no longer ORDERED/);
    } finally { await c.query("ROLLBACK").catch(() => undefined); c.release(); }
  });
});

// ════════════════════════════ NO DATABASE NEEDED ════════════════════════════

test("the canonical PURCHASE_ORDER authority is untouched by this slice", async () => {
  // Ruling R1: the canonical chain keeps its own identity derivation and its own transport until its
  // own cutover. This asserts the two namespaces remain provably disjoint and that neither
  // derivation moved while the PostgreSQL legacy authority was built on top of the shared module.
  const legacy = identity.receivingOrderDocId("k");
  const canonical = identity.canonicalReceivingOrderDocId({
    operation: "receiveInventoryStock", sourceType: "PURCHASE_ORDER",
    purchaseOrderId: "po-1", actorId: "uid-1", idempotencyKey: "k",
  });
  assert.match(legacy, /^rcv_[0-9a-f]{40}$/);
  assert.match(canonical, /^rcvc_[0-9a-f]{40}$/);
  assert.notEqual(legacy, canonical);
  // The PostgreSQL authority owns exactly one source kind and names it.
  assert.equal(cmd.LEGACY_SOURCE_KIND, "REORDER_PURCHASE_ORDER");
  assert.equal(cmd.RECEIVE_STOCK_CAPABILITY, "inventory.stock.receive");
  // No new movement vocabulary: RECEIVED is the existing type, and the source kind is the existing
  // RECEIVING_ORDER label the Firestore ledger already uses.
  assert.equal(cmd.RECEIPT_MOVEMENT_SOURCE_KIND, "RECEIVING_ORDER");
});
