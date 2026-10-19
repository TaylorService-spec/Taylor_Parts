// SUPPLIER PURCHASE ORDER AUTHORING -- the parts that need no database (P-1; DECISIONS #P-1): the SPO number format, the capability keys, the
// lifecycle table, and every refusal that precedes the first query (capability first, then the shape). The transactional behaviour --
// company / warehouse isolation, replay, numbering under concurrency, the link to the requests and receiving -- is
// supplierPurchaseOrderAuthoringPostgres.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const auth = require("../lib/eosOps/supplierPurchaseOrderAuthoring.js");
const numbering = require("../lib/eosOps/supplierPoNumbering.js");
const http = require("../lib/eosOps/eosOpsHttp.js");

// A pool that must never be touched: every refusal asserted below happens before the first query.
const untouchable = { connect() { throw new Error("the database must not be reached"); }, query() { throw new Error("the database must not be reached"); } };
const actor = (caps) => ({ tenantId: "t1", principalId: "p1", capabilities: new Set(caps) });
const refusal = async (fn) => { try { await fn(); } catch (err) { return err; } assert.fail("expected a refusal"); };

test("the SPO number is SPO-YYYY-######: six digits is a FLOOR, the year is four digits, the sequence starts at 1", () => {
  assert.equal(numbering.formatSupplierPoNumber(2026, 1), "SPO-2026-000001");
  assert.equal(numbering.formatSupplierPoNumber(2026, 999999), "SPO-2026-999999");
  assert.equal(numbering.formatSupplierPoNumber(2026, 1000000), "SPO-2026-1000000", "a seventh digit is never truncated or wrapped");
  for (const n of ["SPO-2026-000001", "SPO-2026-1000000"]) assert.match(n, numbering.SUPPLIER_PO_NUMBER_PATTERN);
  for (const n of ["SPO-26-000001", "SPO-2026-1", "RO-2026-000001", "spo-2026-000001"]) assert.doesNotMatch(n, numbering.SUPPLIER_PO_NUMBER_PATTERN);
  assert.throws(() => numbering.formatSupplierPoNumber(1969, 1), /four-digit/);
  assert.throws(() => numbering.formatSupplierPoNumber(2026, 0), /starts at 1/);
});

test("the capability keys are the five the Owner ruled, and the transitions are exactly the ruled lifecycle", () => {
  assert.deepEqual([auth.SUPPLIER_PO_CREATE, auth.SUPPLIER_PO_APPROVE, auth.SUPPLIER_PO_SEND, auth.SUPPLIER_PO_CANCEL, auth.SUPPLIER_PO_READ],
    ["supplier.purchaseOrder.create", "supplier.purchaseOrder.approve", "supplier.purchaseOrder.send", "supplier.purchaseOrder.cancel", "supplier.purchaseOrder.read"]);
  const t = auth.SUPPLIER_PO_TRANSITIONS;
  assert.deepEqual([t.APPROVE.from, t.APPROVE.to, t.APPROVE.capability], [["DRAFT"], "APPROVED", auth.SUPPLIER_PO_APPROVE]);
  assert.deepEqual([t.SEND.from, t.SEND.to, t.SEND.capability], [["APPROVED"], "SENT", auth.SUPPLIER_PO_SEND]);
  assert.deepEqual([t.CANCEL.from, t.CANCEL.to, t.CANCEL.capability], [["DRAFT", "APPROVED", "SENT"], "CANCELLED", auth.SUPPLIER_PO_CANCEL]);
  // RECEIVED is set only by the receipt; nothing here moves an order to it, or out of it.
  for (const rule of Object.values(t)) assert.ok(!rule.from.includes("RECEIVED") && !rule.from.includes("CANCELLED") && rule.to !== "RECEIVED");
  assert.equal(auth.SOURCE_REQUEST_STATUS, "PURCHASING_IN_PROGRESS", "Owner ruling C: the source request is in purchasing");
});

test("the five operations are served on /operations/inventory, behind the Reorder activation boundary", () => {
  for (const op of ["listSupplierPurchaseOrders", "readSupplierPurchaseOrder", "listPurchasableReorderRequests"]) assert.ok(http.OPERATIONS_READ_OPERATIONS.includes(op), op);
  for (const op of ["createSupplierPurchaseOrder", "transitionSupplierPurchaseOrder"]) assert.ok(http.OPERATIONS_MUTATION_OPERATIONS.includes(op), op);
});

test("capability first: every operation refuses a caller without ITS key before the database is touched", async () => {
  const none = actor([]);
  const input = { supplierId: "S", receivingWarehouseId: "W", lines: [{ reorderRequestId: "r" }], idempotencyKey: "k" };
  for (const fn of [
    () => auth.createSupplierPurchaseOrder({ pool: untouchable }, none, input),
    () => auth.transitionSupplierPurchaseOrder({ pool: untouchable }, none, { purchaseOrderId: "p", action: "APPROVE", expectedVersion: 0, idempotencyKey: "k" }),
    () => auth.transitionSupplierPurchaseOrder({ pool: untouchable }, none, { purchaseOrderId: "p", action: "SEND", expectedVersion: 0, idempotencyKey: "k" }),
    () => auth.transitionSupplierPurchaseOrder({ pool: untouchable }, none, { purchaseOrderId: "p", action: "CANCEL", expectedVersion: 0, reason: "x", idempotencyKey: "k" }),
    () => auth.listSupplierPurchaseOrders({ pool: untouchable }, none, {}),
    () => auth.readSupplierPurchaseOrder({ pool: untouchable }, none, { purchaseOrderId: "p" }),
    () => auth.listPurchasableReorderRequests({ pool: untouchable }, none, {}),
  ]) {
    const err = await refusal(fn);
    assert.deepEqual([err.code, err.category], ["CAPABILITY_REQUIRED", "FORBIDDEN"]);
  }
  // Holding one action's key is not holding another's.
  const approveOnly = actor([auth.SUPPLIER_PO_APPROVE]);
  assert.equal((await refusal(() => auth.transitionSupplierPurchaseOrder({ pool: untouchable }, approveOnly,
    { purchaseOrderId: "p", action: "SEND", expectedVersion: 0, idempotencyKey: "k" }))).code, "CAPABILITY_REQUIRED");
});

test("shape: every malformed create or transition is refused before the database, with its own code", async () => {
  const create = actor([auth.SUPPLIER_PO_CREATE]);
  const ok = { supplierId: "S", receivingWarehouseId: "W", lines: [{ reorderRequestId: "r1" }], idempotencyKey: "k" };
  const code = async (over, who = create) => (await refusal(() => auth.createSupplierPurchaseOrder({ pool: untouchable }, who, { ...ok, ...over }))).code;
  assert.equal(await code({ supplierId: undefined }), "SUPPLIER_ID_REQUIRED");
  assert.equal(await code({ receivingWarehouseId: "" }), "WAREHOUSE_ID_REQUIRED");
  assert.equal(await code({ lines: [] }), "LINES_REQUIRED");
  assert.equal(await code({ lines: [{ reorderRequestId: "a" }, { reorderRequestId: "a" }] }), "DUPLICATE_REQUEST");
  assert.equal(await code({ lines: [{ reorderRequestId: "a", orderedQuantity: 0 }] }), "QUANTITY_INVALID");
  assert.equal(await code({ lines: [{ reorderRequestId: "a", unitPriceMinor: 5 }] }), "PRICE_INVALID", "an amount without a currency is not a price");
  assert.equal(await code({ lines: [{ reorderRequestId: "a", unitPriceMinor: 5, currency: "usd" }] }), "PRICE_INVALID");
  assert.equal(await code({ lines: [{ reorderRequestId: "a", partId: "P" }] }), "INPUT_FIELD_NOT_ACCEPTED", "the part comes from the request, never the client");
  assert.equal(await code({ operatingCompanyKey: "x" }), "INPUT_FIELD_NOT_ACCEPTED", "the company is the warehouse's, never the client's");
  assert.equal(await code({ idempotencyKey: undefined }), "IDEMPOTENCY_KEY_REQUIRED");
  assert.equal(await code({ lines: Array.from({ length: auth.SUPPLIER_PO_MAX_LINES + 1 }, (_, i) => ({ reorderRequestId: `r${i}` })) }), "TOO_MANY_LINES");

  const approve = actor([auth.SUPPLIER_PO_APPROVE, auth.SUPPLIER_PO_CANCEL]);
  const tcode = async (input) => (await refusal(() => auth.transitionSupplierPurchaseOrder({ pool: untouchable }, approve, input))).code;
  const base = { purchaseOrderId: "p", action: "APPROVE", expectedVersion: 0, idempotencyKey: "k" };
  assert.equal(await tcode({ ...base, action: "ARCHIVE" }), "ACTION_INVALID");
  assert.equal(await tcode({ ...base, purchaseOrderId: undefined }), "PURCHASE_ORDER_ID_REQUIRED");
  assert.equal(await tcode({ ...base, expectedVersion: undefined }), "EXPECTED_VERSION_REQUIRED");
  assert.equal(await tcode({ ...base, action: "CANCEL" }), "CANCELLATION_REASON_REQUIRED");
  assert.equal(await tcode({ ...base, reason: "because" }), "INPUT_FIELD_NOT_ACCEPTED", "only a cancellation carries a reason");
  assert.equal(await tcode({ ...base, idempotencyKey: undefined }), "IDEMPOTENCY_KEY_REQUIRED");
});
