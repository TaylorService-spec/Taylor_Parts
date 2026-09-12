// EOS Operational Data Plane — migration 008's STRUCTURAL proofs: the purchasing objects, and the
// five purchasing rulings this schema is required to keep enforcing.
//
// ════════════════════ THESE RUN AGAINST A REAL DATABASE ════════════════════
//
// Same contract as eosOpsPostgres.test.mjs and eosOpsOperatingCompanyCustodyPostgres.test.mjs: set
// POLICY_TEST_DATABASE_URL to run; without it this SKIPS rather than fails. This file resets BOTH
// `eos_policy` and `eos_ops` from clean, so it must be registered in the SAME serialized
// `test:adminPolicyPostgres` command as the other resetters.
//
// The claims are STRUCTURAL on purpose. "The commands will remember that a purchase order is
// immutable" is not a property; "the table has no column an update could be recorded in, and the
// repository exposes no function that could write one" is.
import test from "node:test";
import { declaredSchemas } from "./support/migrationSchema.mjs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import * as po from "../lib/eosOps/purchasingRepository.js";
import { OperatingCompanyAuthorityError } from "../lib/eosOps/operatingCompanyCustody.js";

const URL = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";

const TENANT = "tenant-purchasing";
// OPAQUE, and deliberately not a real company name. Nothing this schema does may depend on which
// operating companies a deployment happens to have.
const CO_A = "oc-alpha";
const CO_B = "oc-beta";

const MIGRATION_FILE = "1758672000000_purchasing-object-authority.sql";
const REPOSITORY_FILE = join("src", "eosOps", "purchasingRepository.ts");

let pool = null;
function repoPool() {
  pool ??= new pg.Pool({ connectionString: URL, max: 4 });
  return pool;
}

function migrate(args) {
  return execFileSync(process.execPath, [
    "node_modules/node-pg-migrate/bin/node-pg-migrate.js", ...args, "--migrations-dir", "migrations",
  ], { env: { ...process.env, DATABASE_URL: URL }, encoding: "utf8", stdio: "pipe" });
}

async function reset() {
  const client = new pg.Client({ connectionString: URL });
  await client.connect();
  // EVERY schema the migrations create, read from functions/migrations rather than listed here.
  //
  // Each of these resetters carried its own hand-written list, and at the W1 integration no two of
  // them agreed: some dropped eos_crm, some eos_commercial, most neither. A schema left standing
  // while `pgmigrations` is dropped makes the next `up` re-run its migration against objects that
  // still exist -- the failure is `type "commercial_handoff_source" already exists`, 48 tests deep in
  // a suite that has nothing to do with the commercial schema. Derived, the list cannot drift again.
  for (const schema of declaredSchemas()) {
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  }
  await client.query("DROP SCHEMA IF EXISTS eos_ops_conversion_probe CASCADE");
  await client.query("DROP TABLE IF EXISTS pgmigrations");
  await client.end();
  migrate(["up"]);
  const seed = new pg.Client({ connectionString: URL });
  await seed.connect();
  await seed.query(
    "INSERT INTO eos_policy.tenants (id, key, name) VALUES ($1, $1, $1) ON CONFLICT DO NOTHING",
    [TENANT],
  );
  await seed.end();
}

async function query(text, values = []) {
  const client = new pg.Client({ connectionString: URL });
  await client.connect();
  try { return await client.query(text, values); } finally { await client.end(); }
}

const columnsOf = (table) => query(
  `SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'eos_ops' AND table_name = $1 ORDER BY column_name`,
  [table],
);

/** A reorder request parked in the state its purchase order may be recorded from. */
async function seedRecordableRequest(suffix, company = CO_A) {
  return po.createReorderRequest(repoPool(), TENANT, "u-1", company, {
    partId: `PRT-00000${suffix}`,
    warehouseId: "wh-1",
    status: po.PO_RECORDABLE_STATUS,
    requestedQuantity: 4,
  });
}

const orderInput = (over = {}) => ({
  supplierName: "Acme Supply",
  externalPoNumber: "PO-9911",
  orderedQuantity: 4,
  orderedDate: "2026-03-04",
  ...over,
});

test.after(async () => {
  if (pool) await pool.end();
});

// ============================ RULING 1: the purchase order is IMMUTABLE ============================

/**
 * Reverse every migration that sorts STRICTLY NEWER than this lane's own, so that a single
 * `node-pg-migrate down` once again reverses THIS migration.
 *
 * A lane suite proving "my down refuses while my tables still hold data" runs one `down` step. That
 * reverses whichever migration is newest -- this lane's own only while this lane's own is last. It
 * was last on the branch and is not last on main: eleven migrations landed together at the W1
 * integration, and this test was reversing a stranger's migration and reporting
 * "Missing expected exception" while the refusal it checks worked perfectly.
 *
 * Driven by what is APPLIED (pgmigrations) rather than by a file count, so calling it twice in one
 * test is a no-op the second time instead of digging past the migration under test.
 */
async function peelMigrationsNewerThan(prefix) {
  for (;;) {
    const applied = await query("SELECT name FROM pgmigrations ORDER BY id DESC LIMIT 1");
    const newest = applied.rows[0]?.name;
    if (!newest || newest.startsWith(prefix) || newest < prefix) return;
    migrate(["down"]);
  }
}

test("purchase_orders has no column an update could be recorded in", { skip: SKIP }, async () => {
  await reset();
  const names = (await columnsOf("purchase_orders")).rows.map((r) => r.column_name);
  assert.ok(names.includes("created_by"), "a purchase order records who placed it");
  assert.ok(names.includes("created_at"), "a purchase order records when it was placed");
  // The structural half of immutability: a modified row would have no author and no time.
  assert.equal(names.includes("updated_by"), false, "an immutable purchase order has no updated_by");
  assert.equal(names.includes("updated_at"), false, "an immutable purchase order has no updated_at");
});

test("purchase_orders stores no status -- lifecycle state is DERIVED", { skip: SKIP }, async () => {
  await reset();
  const names = (await columnsOf("purchase_orders")).rows.map((r) => r.column_name);
  // A stored status on a row nothing may update is a number nothing may correct: the moment a
  // receipt or a void lands it is stale, and there is no legal write that would fix it.
  assert.equal(names.includes("status"), false, "purchase order state is derived from receipts and voids");
  const voidNames = (await columnsOf("purchase_order_voids")).rows.map((r) => r.column_name);
  assert.equal(voidNames.includes("updated_at"), false, "an append-only void record is never updated");
  assert.equal(voidNames.includes("status"), false, "there is no 'unvoid'");
});

/**
 * The repository source with comments removed.
 *
 * Prose is not code, and a rule that tripped on its own explanation would be a rule nobody could
 * document — this module's header names `updatePurchaseOrder` precisely to say it does not exist.
 * Statements are what is checked.
 */
function repositoryCode() {
  return readFileSync(REPOSITORY_FILE, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

test("the repository offers no update or delete for the immutable tables", { skip: SKIP }, () => {
  // Migration 005's precedent, applied to migration 008: the invariant is enforced above the SQL
  // boundary and a STATIC test proves the surface, so a future caller cannot reach for a method that
  // does not exist. Migration 008 adds the structural half the ledger could not have.
  const code = repositoryCode();
  for (const table of ["purchase_orders", "purchase_order_voids"]) {
    const write = new RegExp(String.raw`(UPDATE|DELETE\s+FROM)\s+(eos_ops|\$\{SCHEMA\})\.${table}\b`, "i");
    assert.equal(write.test(code), false, `purchasingRepository.ts must issue no UPDATE/DELETE against ${table}`);
  }
  // And no exported entry point that would mean one.
  for (const forbidden of ["updatePurchaseOrder", "deletePurchaseOrder", "unvoidPurchaseOrder"]) {
    assert.equal(
      new RegExp(String.raw`export\s+(async\s+)?function\s+${forbidden}\b`).test(code), false,
      `purchasingRepository.ts must not export ${forbidden}`,
    );
    assert.equal(typeof po[forbidden], "undefined", `the built module must not expose ${forbidden}`);
  }
});

// ============================ RULING 2: PO id == REQUEST id ============================

test("a purchase order's id IS its reorder request's id -- one column, PK and FK", { skip: SKIP }, async () => {
  await reset();
  const request = await seedRecordableRequest(1);
  const order = await po.recordPurchaseOrder(repoPool(), TENANT, "u-2", request.id, orderInput());
  assert.equal(order.purchaseOrderId, request.id);

  // There is no second identity column that could disagree.
  const names = (await columnsOf("purchase_orders")).rows.map((r) => r.column_name);
  assert.equal(names.includes("reorder_request_id"), false, "the id IS the reorder request id");

  // The request moved to ORDERED in the same transaction (R-16: neither half without the other).
  const after = await po.readReorderRequest(repoPool(), TENANT, request.id);
  assert.equal(after.status, "ORDERED");
});

test("a purchase order cannot name a reorder request that does not exist", { skip: SKIP }, async () => {
  await reset();
  await assert.rejects(
    () => query(
      `INSERT INTO eos_ops.purchase_orders
         (id, tenant_id, operating_company_key, part_id, supplier_name, external_po_number,
          ordered_quantity, ordered_date, created_by)
       VALUES ('ghost', $1, $2, 'PRT-000001', 's', 'PO-1', 1, '2026-01-01', 'u')`,
      [TENANT, CO_A],
    ),
    /foreign key|violates/i,
  );
});

test("a reorder request has AT MOST ONE purchase order -- the PO_ALREADY_EXISTS guard is the primary key", { skip: SKIP }, async () => {
  await reset();
  const request = await seedRecordableRequest(2);
  await po.recordPurchaseOrder(repoPool(), TENANT, "u-2", request.id, orderInput());
  // The request is now ORDERED, so the domain refusal names the state first...
  await assert.rejects(
    () => po.recordPurchaseOrder(repoPool(), TENANT, "u-2", request.id, orderInput()),
    (err) => err.code === "REQUEST_STATE_INVALID",
  );
  // ...and the schema refuses the duplicate outright, regardless of any command's state check.
  await assert.rejects(
    () => query(
      `INSERT INTO eos_ops.purchase_orders
         (id, tenant_id, operating_company_key, part_id, supplier_name, external_po_number,
          ordered_quantity, ordered_date, created_by)
       VALUES ($3, $1, $2, 'PRT-000002', 's', 'PO-2', 1, '2026-01-01', 'u')`,
      [TENANT, CO_A, request.id],
    ),
    /duplicate key|violates/i,
  );
});

test("a purchase order cannot be recorded from a state that is not PURCHASING_IN_PROGRESS", { skip: SKIP }, async () => {
  await reset();
  const request = await po.createReorderRequest(repoPool(), TENANT, "u-1", CO_A, {
    partId: "PRT-000003", warehouseId: "wh-1", status: "PENDING_REVIEW", requestedQuantity: 1,
  });
  await assert.rejects(
    () => po.recordPurchaseOrder(repoPool(), TENANT, "u-2", request.id, orderInput()),
    (err) => err.code === "REQUEST_STATE_INVALID",
  );
  // FAIL CLOSED: the refusal happened before any write.
  assert.equal(await po.readPurchaseOrder(repoPool(), TENANT, request.id), null);
});

// ============================ RULING 3: void WRITES A VOID RECORD ============================

test("voiding appends a record and never touches the purchase order", { skip: SKIP }, async () => {
  await reset();
  const request = await seedRecordableRequest(4);
  const order = await po.recordPurchaseOrder(repoPool(), TENANT, "u-2", request.id, orderInput());
  const before = await po.readPurchaseOrder(repoPool(), TENANT, order.purchaseOrderId);

  const record = await po.voidPurchaseOrder(repoPool(), TENANT, "u-3", order.purchaseOrderId, "supplier cancelled");
  assert.equal(record.purchaseOrderId, order.purchaseOrderId);
  assert.equal(record.voidedBy, "u-3");
  // The void record inherits the purchase order's company and part -- not supplied, not re-derived.
  assert.equal(record.operatingCompanyKey, CO_A);
  assert.equal(record.partId, before.partId);

  // The purchase order is byte-for-byte what it was. It was not deleted and it was not mutated.
  const after = await po.readPurchaseOrder(repoPool(), TENANT, order.purchaseOrderId);
  assert.deepEqual(after, before);
  // And the request moved to VOIDED in the SAME transaction -- the atomic pairing Rules enforced
  // with existsAfter()/getAfter() across the two documents.
  assert.equal((await po.readReorderRequest(repoPool(), TENANT, request.id)).status, "VOIDED");
});

test("a void is reachable only from ORDERED, and writes nothing when refused", { skip: SKIP }, async () => {
  await reset();
  const request = await seedRecordableRequest(5);
  await assert.rejects(
    () => po.voidPurchaseOrder(repoPool(), TENANT, "u-3", request.id, "too early"),
    (err) => err.code === "REQUEST_STATE_INVALID",
  );
  assert.equal(await po.readPurchaseOrderVoid(repoPool(), TENANT, request.id), null);
  assert.equal((await po.readReorderRequest(repoPool(), TENANT, request.id)).status, po.PO_RECORDABLE_STATUS);
});

test("a void with no stated reason records nothing and is refused", { skip: SKIP }, async () => {
  await reset();
  const request = await seedRecordableRequest(6);
  const order = await po.recordPurchaseOrder(repoPool(), TENANT, "u-2", request.id, orderInput());
  await assert.rejects(
    () => po.voidPurchaseOrder(repoPool(), TENANT, "u-3", order.purchaseOrderId, "   "),
    (err) => err.code === "VOID_REASON_REQUIRED",
  );
  // The column refuses it too, so no other writer can slip a blank reason past.
  await assert.rejects(
    () => query(
      `INSERT INTO eos_ops.purchase_order_voids
         (purchase_order_id, tenant_id, operating_company_key, part_id, reason, voided_by)
       VALUES ($3, $1, $2, 'PRT-000006', '   ', 'u')`,
      [TENANT, CO_A, order.purchaseOrderId],
    ),
    /check constraint|violates/i,
  );
});

test("a void record cannot exist without the purchase order it voids", { skip: SKIP }, async () => {
  await reset();
  await assert.rejects(
    () => query(
      `INSERT INTO eos_ops.purchase_order_voids
         (purchase_order_id, tenant_id, operating_company_key, part_id, reason, voided_by)
       VALUES ('ghost', $1, $2, 'PRT-000001', 'because', 'u')`,
      [TENANT, CO_A],
    ),
    /foreign key|violates/i,
  );
});

// ============================ RULING 4: no client operating-company authority ============================

test("every purchasing table refuses a row with no operating company", { skip: SKIP }, async () => {
  await reset();
  for (const table of ["reorder_requests", "purchase_orders", "purchase_order_voids", "receiving_orders"]) {
    const { rows } = await query(
      `SELECT is_nullable, column_default FROM information_schema.columns
        WHERE table_schema = 'eos_ops' AND table_name = $1 AND column_name = 'operating_company_key'`,
      [table],
    );
    assert.equal(rows.length, 1, `${table} carries an operating company key`);
    assert.equal(rows[0].is_nullable, "NO", `${table}.operating_company_key is NOT NULL`);
    // A DEFAULT would let a writer that never decided a company still produce a row claiming one.
    assert.equal(rows[0].column_default, null, `${table}.operating_company_key has NO DEFAULT`);
  }
});

test("the repository refuses a missing company before SQL ever sees it", { skip: SKIP }, async () => {
  await reset();
  await assert.rejects(
    () => po.createReorderRequest(repoPool(), TENANT, "u-1", "", {
      partId: "PRT-000007", warehouseId: "wh-1", status: "PENDING_REVIEW", requestedQuantity: 1,
    }),
    OperatingCompanyAuthorityError,
  );
});

test("a purchase order INHERITS its company from the request and cannot be told a different one", { skip: SKIP }, async () => {
  await reset();
  const request = await seedRecordableRequest(8, CO_B);
  const order = await po.recordPurchaseOrder(repoPool(), TENANT, "u-2", request.id, orderInput());
  assert.equal(order.operatingCompanyKey, CO_B);
  // There is no parameter through which a caller could have supplied one: the arity of the call is
  // the boundary.
  assert.equal(po.recordPurchaseOrder.length, 5, "recordPurchaseOrder takes (pool, tenant, actor, requestId, input)");
  const source = readFileSync(REPOSITORY_FILE, "utf8");
  const signature = source.slice(source.indexOf("export async function recordPurchaseOrder"));
  assert.equal(signature.slice(0, signature.indexOf("{")).includes("operatingCompanyKey"), false);
});

// ============================ the transfer order's directional pair ============================

test("a transfer order carries BOTH company keys, with no scalar owner column", { skip: SKIP }, async () => {
  await reset();
  const names = (await columnsOf("transfer_orders")).rows.map((r) => r.column_name);
  assert.ok(names.includes("source_operating_company_key"));
  assert.ok(names.includes("destination_operating_company_key"));
  assert.equal(names.includes("operating_company_key"), false, "a transfer has participants, not an owner");

  for (const column of ["source_operating_company_key", "destination_operating_company_key"]) {
    const { rows } = await query(
      `SELECT is_nullable, column_default FROM information_schema.columns
        WHERE table_schema = 'eos_ops' AND table_name = 'transfer_orders' AND column_name = $1`,
      [column],
    );
    assert.equal(rows[0].is_nullable, "NO", `${column} is NOT NULL -- a half-pair is not a pair`);
    assert.equal(rows[0].column_default, null, `${column} has NO DEFAULT`);
  }
});

test("is_cross_company is DERIVED by the database and cannot be written", { skip: SKIP }, async () => {
  await reset();
  const same = await po.createTransferOrder(repoPool(), TENANT, "u-4", { source: CO_A, destination: CO_A }, {
    partId: "PRT-000010", trackingMode: "NONE", quantity: 2,
    origin: { type: "WAREHOUSE", id: "wh-1" }, destination: { type: "WAREHOUSE", id: "wh-2" },
    status: "REQUESTED", idempotencyKey: "idem-same",
  });
  assert.equal(same.isCrossCompany, false);

  const cross = await po.createTransferOrder(repoPool(), TENANT, "u-4", { source: CO_A, destination: CO_B }, {
    partId: "PRT-000011", trackingMode: "NONE", quantity: 1,
    origin: { type: "WAREHOUSE", id: "wh-1" }, destination: { type: "MOBILE", id: "truck-7" },
    status: "IN_TRANSIT", idempotencyKey: "idem-cross",
  });
  assert.equal(cross.isCrossCompany, true);

  // A writer cannot assert a flag that contradicts the pair beside it.
  await assert.rejects(
    () => query(
      `INSERT INTO eos_ops.transfer_orders
         (id, tenant_id, source_operating_company_key, destination_operating_company_key, is_cross_company,
          part_id, tracking_mode, quantity, origin_location_type, origin_location_id,
          destination_location_type, destination_location_id, status, idempotency_key, created_by, updated_by)
       VALUES ('lie', $1, $2, $3, false, 'PRT-000012', 'NONE', 1, 'WAREHOUSE', 'wh-1', 'WAREHOUSE', 'wh-2',
               'REQUESTED', 'idem-lie', 'u', 'u')`,
      [TENANT, CO_A, CO_B],
    ),
    /generated|cannot insert/i,
  );

  const counts = await po.countTransferOrdersByCompanyDirection(repoPool(), TENANT);
  assert.deepEqual(counts, { total: 2, crossCompany: 1, sameCompany: 1 });
});

test("the pair projects onto the per-leg scalar an inventory_movements row carries", { skip: SKIP }, () => {
  const companies = { source: CO_A, destination: CO_B };
  // TRANSFER_OUT is staged at the ORIGIN; TRANSFER_IN at the DESTINATION. One row, one endpoint,
  // one company -- which is why migration 007's scalar column is correct and is not widened.
  assert.equal(po.transferLegOperatingCompanyKey(companies, "OUT"), CO_A);
  assert.equal(po.transferLegOperatingCompanyKey(companies, "IN"), CO_B);
  // A same-company transfer resolves both legs to the same key. Not a special case.
  assert.equal(po.transferLegOperatingCompanyKey({ source: CO_A, destination: CO_A }, "IN"), CO_A);
  // A half-pair is refused on EITHER leg -- letting OUT succeed would import a transfer whose IN
  // leg can never be written.
  assert.throws(() => po.transferLegOperatingCompanyKey({ source: CO_A, destination: "" }, "OUT"),
    OperatingCompanyAuthorityError);
  assert.throws(() => po.transferLegOperatingCompanyKey({ source: "", destination: CO_B }, "IN"),
    OperatingCompanyAuthorityError);
});

test("the legacy warehouse scalars are RETIRED -- there is no column for them", { skip: SKIP }, async () => {
  await reset();
  const names = (await columnsOf("transfer_orders")).rows.map((r) => r.column_name);
  assert.equal(names.includes("from_warehouse_id"), false);
  assert.equal(names.includes("to_warehouse_id"), false);
  // The typed refs are the only representation left, and they are total over every endpoint type.
  for (const column of [
    "origin_location_type", "origin_location_id",
    "destination_location_type", "destination_location_id",
  ]) {
    assert.ok(names.includes(column), `${column} is the surviving representation`);
  }
});

test("a transfer between one place and itself is refused by the schema", { skip: SKIP }, async () => {
  await reset();
  await assert.rejects(
    () => po.createTransferOrder(repoPool(), TENANT, "u-4", { source: CO_A, destination: CO_A }, {
      partId: "PRT-000013", trackingMode: "NONE", quantity: 1,
      origin: { type: "WAREHOUSE", id: "wh-1" }, destination: { type: "WAREHOUSE", id: "wh-1" },
      status: "REQUESTED", idempotencyKey: "idem-self",
    }),
    /transfer_order_endpoints_differ/,
  );
});

// ============================ receiving: identity, and DERIVED progress ============================

test("the legacy receipt's identity equation is enforced by the schema in both directions", { skip: SKIP }, async () => {
  await reset();
  // reorder request id present but not equal to the purchase order id
  await assert.rejects(
    () => query(
      `INSERT INTO eos_ops.receiving_orders
         (id, tenant_id, operating_company_key, source_kind, source_purchase_order_id,
          source_reorder_request_id, receiving_location_type, receiving_location_id,
          status, idempotency_key, created_by, updated_by)
       VALUES ('r1', $1, $2, 'REORDER_PURCHASE_ORDER', 'po-1', 'rr-9', 'WAREHOUSE', 'wh-1',
               'PUTAWAY_COMPLETE', 'i1', 'u', 'u')`,
      [TENANT, CO_A],
    ),
    /receiving_order_source_identity/,
  );
  // a canonical receipt carrying a reorder request it cannot have
  await assert.rejects(
    () => query(
      `INSERT INTO eos_ops.receiving_orders
         (id, tenant_id, operating_company_key, source_kind, source_purchase_order_id,
          source_reorder_request_id, receiving_location_type, receiving_location_id,
          status, idempotency_key, created_by, updated_by)
       VALUES ('r2', $1, $2, 'PURCHASE_ORDER', 'po-1', 'po-1', 'WAREHOUSE', 'wh-1',
               'PUTAWAY_COMPLETE', 'i2', 'u', 'u')`,
      [TENANT, CO_A],
    ),
    /receiving_order_source_identity/,
  );
});

test("received quantity is the SUM OF COMMITTED RECEIPTS, and cancelled receipts do not count", { skip: SKIP }, async () => {
  await reset();
  const request = await seedRecordableRequest(9);
  const order = await po.recordPurchaseOrder(repoPool(), TENANT, "u-2", request.id, orderInput({ orderedQuantity: 10 }));
  const legacyReceipt = (idem, qty, status = "PUTAWAY_COMPLETE") => po.createReceivingOrder(
    repoPool(), TENANT, "u-5", CO_A, {
      sourceKind: "REORDER_PURCHASE_ORDER",
      purchaseOrderId: order.purchaseOrderId,
      reorderRequestId: order.purchaseOrderId,
      receivingLocation: { type: "WAREHOUSE", id: "wh-1" },
      status,
      idempotencyKey: idem,
      lines: [{ lineId: "L1", partId: "PRT-000009", trackingMode: "NONE", expectedQuantity: 10, receivedQuantity: qty }],
    },
  );
  await legacyReceipt("i-a", 4);
  await legacyReceipt("i-b", 3);
  await legacyReceipt("i-c", 99, "CANCELLED");

  const received = await po.readReceivedQuantities(
    repoPool(), TENANT, "REORDER_PURCHASE_ORDER", order.purchaseOrderId,
  );
  // 4 + 3. The cancelled receipt is a receipt that did not happen.
  assert.deepEqual(received, [{ lineId: "L1", receivedQuantity: 7 }]);

  // And the purchase order itself was never written to record any of it.
  const after = await po.readPurchaseOrder(repoPool(), TENANT, order.purchaseOrderId);
  assert.equal(after.orderedQuantity, 10);
});

test("a receiving order and its lines commit together, or not at all", { skip: SKIP }, async () => {
  await reset();
  await assert.rejects(
    () => po.createReceivingOrder(repoPool(), TENANT, "u-5", CO_A, {
      sourceKind: "PURCHASE_ORDER",
      purchaseOrderId: "po-canonical",
      receivingLocation: { type: "WAREHOUSE", id: "wh-1" },
      status: "PUTAWAY_COMPLETE",
      idempotencyKey: "i-rollback",
      // A NONE line carrying a serial: refused by receiving_line_serials_match_tracking, AFTER the
      // order row has already been inserted in this transaction.
      lines: [{
        lineId: "L1", partId: "PRT-000014", trackingMode: "NONE",
        expectedQuantity: 1, receivedQuantity: 1, serialNumbers: ["S1"],
      }],
    }),
    /receiving_line_serials_match_tracking/,
  );
  const { rows } = await query(
    "SELECT count(*)::int AS n FROM eos_ops.receiving_orders WHERE tenant_id = $1", [TENANT],
  );
  assert.equal(rows[0].n, 0, "the order row was rolled back with its failed line");
});

test("a retried receipt cannot post twice for one physical event", { skip: SKIP }, async () => {
  await reset();
  const receipt = (idem) => po.createReceivingOrder(repoPool(), TENANT, "u-5", CO_A, {
    sourceKind: "PURCHASE_ORDER",
    purchaseOrderId: "po-canonical",
    receivingLocation: { type: "WAREHOUSE", id: "wh-1" },
    status: "PUTAWAY_COMPLETE",
    idempotencyKey: idem,
    lines: [{ lineId: "L1", partId: "PRT-000015", trackingMode: "NONE", expectedQuantity: 2, receivedQuantity: 2 }],
  });
  await receipt("i-dup");
  await assert.rejects(() => receipt("i-dup"), /receiving_orders_idempotency|duplicate key/);
});

// ============================ the price authority, structurally ============================

test("an amount and its currency move together, and a stamp implies a price", { skip: SKIP }, async () => {
  await reset();
  const request = await seedRecordableRequest(16);
  // amount without currency
  await assert.rejects(
    () => po.recordPurchaseOrder(repoPool(), TENANT, "u-2", request.id, orderInput({ unitPriceMinor: 1250 })),
    /purchase_order_price_pairs/,
  );
  // a stamp with no price is incoherent -- the command that stamps is the one that requires
  await assert.rejects(
    () => po.recordPurchaseOrder(repoPool(), TENANT, "u-2", request.id, orderInput({ priceAuthorityVersion: 2 })),
    /purchase_order_stamp_implies_price/,
  );
  // a pre-authority purchase order -- no stamp, no price -- is legal and stays receivable
  const legacy = await po.recordPurchaseOrder(repoPool(), TENANT, "u-2", request.id, orderInput());
  assert.equal(legacy.unitPriceMinor, null);
  assert.equal(legacy.priceAuthorityVersion, null);
});

test("explicit zero is a committed price and survives the round trip as a number", { skip: SKIP }, async () => {
  await reset();
  const request = await seedRecordableRequest(17);
  await po.recordPurchaseOrder(repoPool(), TENANT, "u-2", request.id, orderInput({
    unitPriceMinor: 0, currency: "USD", priceAuthorityVersion: 2,
  }));
  const read = await po.readPurchaseOrder(repoPool(), TENANT, request.id);
  // NULL IS NOT ZERO, and a BIGINT must not come back as a string that would sum and compare wrongly.
  assert.strictEqual(read.unitPriceMinor, 0);
  assert.equal(read.currency, "USD");
  assert.equal(read.orderedDate, "2026-03-04");
});

// ============================ the migration itself ============================

test("migration 008 touches no table migration 005 or 007 created", { skip: SKIP }, () => {
  const sql = readFileSync(join("migrations", MIGRATION_FILE), "utf8");
  // Additive only. The cycle-count / ledger / custody tables are another lane's authority and this
  // migration must not ALTER them -- widening inventory_movements' company column in particular is
  // the change this schema deliberately does not make.
  for (const table of ["inventory_movements", "serialized_custody", "cycle_count_sheets", "cycle_count_lines"]) {
    assert.equal(
      new RegExp(`ALTER TABLE\\s+(eos_ops\\.)?${table}\\b`, "i").test(sql), false,
      `migration 008 must not ALTER ${table}`,
    );
  }
  assert.equal(/DROP\s+SCHEMA/i.test(sql.split("-- Down Migration")[0]), false, "the up migration drops no schema");
});

test("the whole migration set is reversible from a populated purchasing schema", { skip: SKIP }, async () => {
  await reset();
  const request = await seedRecordableRequest(18);
  const order = await po.recordPurchaseOrder(repoPool(), TENANT, "u-2", request.id, orderInput());
  await po.voidPurchaseOrder(repoPool(), TENANT, "u-3", order.purchaseOrderId, "supplier cancelled");
  // Down then up: the purchasing tables are the migration's own and carry no pre-cutover rows it
  // would have to refuse to invent an authority for.
  await peelMigrationsNewerThan("1758672000000_");
  migrate(["down"]);
  const { rows } = await query(
    `SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_schema = 'eos_ops' AND table_name IN
        ('reorder_requests','purchase_orders','purchase_order_voids','receiving_orders',
         'receiving_order_lines','transfer_orders')`,
  );
  assert.equal(rows[0].n, 0, "every purchasing table is dropped by the down migration");
  migrate(["up"]);
  const back = await columnsOf("purchase_orders");
  assert.ok(back.rows.length > 0, "the up migration rebuilds them");
});
