// Supplier purchase order authoring, from the browser (P-1; DECISIONS #P-1): the transport client is fail-closed and decides nothing.
//   * malformed input is refused CLIENT-SIDE without a call;
//   * a GOVERNED refusal carries the command's own sentence; any other failure is a bounded outcome with NO server text;
//   * a malformed answer is UNAVAILABLE, never a partially trusted result;
//   * the idempotencyKey travels verbatim; the company and the Part are never sent;
//   * the operations are on the client's allow-list, and the client names no capability to decide on.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createSupplierPurchasingClient, newIdempotencyKey, supplierPoFailure, SUPPLIER_PO_OPERATIONS, SUPPLIER_PO_OUTCOME } from "../src/services/eosSupplierPurchasingClient.js";

const recorder = (responses) => {
  const calls = [];
  const call = async (operation, input) => {
    calls.push({ operation, input });
    const r = responses[operation];
    if (r instanceof Error) throw r;
    return typeof r === "function" ? r(input) : r;
  };
  return { call, calls };
};
const failure = (code, message = "server words", reason = null) => ({ ok: false, code, message, reason });

test("the five operations are the server's, and are on the client's allow-list", () => {
  const reorderApi = readFileSync(new URL("../src/services/reorderApiClient.js", import.meta.url), "utf8");
  const names = (list) => reorderApi.slice(reorderApi.indexOf(`export const ${list} =`)).split("]);")[0];
  const reads = names("REORDER_READ_OPERATIONS");
  const writes = names("REORDER_COMMAND_OPERATIONS");
  for (const op of [SUPPLIER_PO_OPERATIONS.list, SUPPLIER_PO_OPERATIONS.read, SUPPLIER_PO_OPERATIONS.purchasable]) assert.ok(reads.includes(`"${op}"`), op);
  for (const op of [SUPPLIER_PO_OPERATIONS.create, SUPPLIER_PO_OPERATIONS.transition]) assert.ok(writes.includes(`"${op}"`), op);
  // And the client names no capability: the gate is the server's (and the screen's, from the shell).
  const src = readFileSync(new URL("../src/services/eosSupplierPurchasingClient.js", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(src, /supplier\.purchaseOrder\./);
});

test("failures: a governed refusal carries its sentence; anything else is a bounded outcome with no text", () => {
  assert.deepEqual(supplierPoFailure(failure("FORBIDDEN", "this requires supplier.purchaseOrder.create", "CAPABILITY_REQUIRED")),
    { ok: false, outcome: SUPPLIER_PO_OUTCOME.DENIED, reason: "CAPABILITY_REQUIRED", message: "this requires supplier.purchaseOrder.create" });
  assert.equal(supplierPoFailure(failure("PRECONDITION_FAILED")).outcome, SUPPLIER_PO_OUTCOME.CONFLICT);
  assert.equal(supplierPoFailure(failure("NOT_FOUND")).outcome, SUPPLIER_PO_OUTCOME.NOT_FOUND);
  assert.equal(supplierPoFailure(failure("NOT_SIGNED_IN")).outcome, SUPPLIER_PO_OUTCOME.UNAUTHENTICATED);
  for (const code of ["INTERNAL", "UNREACHABLE", "NOT_CONFIGURED", "UNKNOWN_OPERATION", undefined]) {
    const f = supplierPoFailure(failure(code, "SELECT * FROM secret_table"));
    assert.equal(f.outcome, SUPPLIER_PO_OUTCOME.UNAVAILABLE);
    assert.equal("message" in f, false, "a failure the platform did not govern never shows server text");
  }
});

test("createOrder sends the supplier, the warehouse, the lines and the caller's key verbatim -- never a company or a Part", async () => {
  const { call, calls } = recorder({ createSupplierPurchaseOrder: { ok: true, result: { outcome: "applied", purchaseOrderId: "spo-1", externalPoNumber: "SPO-2026-000001", status: "DRAFT" } } });
  const client = createSupplierPurchasingClient({ call });
  const lines = [{ reorderRequestId: "rr-1", orderedQuantity: 4, unitPriceMinor: 1250, currency: "USD" }];
  const res = await client.createOrder({ supplierId: "SUP-A", receivingWarehouseId: "wh-1", lines, idempotencyKey: "k-1" });
  assert.deepEqual([res.ok, res.replayed, res.order.externalPoNumber], [true, false, "SPO-2026-000001"]);
  assert.deepEqual(calls, [{ operation: "createSupplierPurchaseOrder", input: { supplierId: "SUP-A", receivingWarehouseId: "wh-1", lines, idempotencyKey: "k-1" } }]);
  // A replay is reported as such.
  const again = createSupplierPurchasingClient({ call: recorder({ createSupplierPurchaseOrder: { ok: true, result: { outcome: "replayed", purchaseOrderId: "spo-1", externalPoNumber: "SPO-2026-000001" } } }).call });
  assert.equal((await again.createOrder({ supplierId: "S", receivingWarehouseId: "w", lines, idempotencyKey: "k-1" })).replayed, true);
});

test("malformed input is refused CLIENT-SIDE without any call", async () => {
  const { call, calls } = recorder({});
  const c = createSupplierPurchasingClient({ call });
  const okLines = [{ reorderRequestId: "rr-1" }];
  for (const bad of [
    { supplierId: "", receivingWarehouseId: "w", lines: okLines, idempotencyKey: "k" },
    { supplierId: "s", receivingWarehouseId: "", lines: okLines, idempotencyKey: "k" },
    { supplierId: "s", receivingWarehouseId: "w", lines: [], idempotencyKey: "k" },
    { supplierId: "s", receivingWarehouseId: "w", lines: okLines, idempotencyKey: "" },
  ]) assert.equal((await c.createOrder(bad)).outcome, SUPPLIER_PO_OUTCOME.INVALID);
  assert.equal((await c.transitionOrder({ purchaseOrderId: "p", action: "ARCHIVE", expectedVersion: 0, idempotencyKey: "k" })).outcome, SUPPLIER_PO_OUTCOME.INVALID);
  assert.equal((await c.transitionOrder({ purchaseOrderId: "p", action: "APPROVE", expectedVersion: "0", idempotencyKey: "k" })).outcome, SUPPLIER_PO_OUTCOME.INVALID);
  assert.equal((await c.transitionOrder({ purchaseOrderId: "p", action: "CANCEL", expectedVersion: 1, idempotencyKey: "k", reason: "  " })).outcome, SUPPLIER_PO_OUTCOME.INVALID);
  assert.equal((await c.readOrder("")).outcome, SUPPLIER_PO_OUTCOME.INVALID);
  assert.deepEqual(calls, []);
});

test("transitionOrder: a cancellation carries its trimmed reason; approve and send carry none; the version and key travel verbatim", async () => {
  const { call, calls } = recorder({ transitionSupplierPurchaseOrder: (input) => ({ ok: true, result: { outcome: "applied", status: input.action === "CANCEL" ? "CANCELLED" : "APPROVED", version: input.expectedVersion + 1 } }) });
  const c = createSupplierPurchasingClient({ call });
  assert.equal((await c.transitionOrder({ purchaseOrderId: "p", action: "APPROVE", expectedVersion: 0, idempotencyKey: "k-a" })).result.version, 1);
  assert.equal((await c.transitionOrder({ purchaseOrderId: "p", action: "CANCEL", expectedVersion: 1, idempotencyKey: "k-c", reason: "  withdrawn  " })).result.status, "CANCELLED");
  assert.deepEqual(calls.map((x) => x.input), [
    { purchaseOrderId: "p", action: "APPROVE", expectedVersion: 0, idempotencyKey: "k-a" },
    { purchaseOrderId: "p", action: "CANCEL", expectedVersion: 1, idempotencyKey: "k-c", reason: "withdrawn" },
  ]);
});

test("reads: a malformed answer is UNAVAILABLE, never a partially trusted result; an empty list is a real answer; a thrown transport is UNAVAILABLE", async () => {
  const c = (responses) => createSupplierPurchasingClient({ call: recorder(responses).call });
  assert.deepEqual((await c({ listSupplierPurchaseOrders: { ok: true, result: { purchaseOrders: [] } } }).listOrders()).purchaseOrders, []);
  assert.equal((await c({ listSupplierPurchaseOrders: { ok: true, result: { nope: 1 } } }).listOrders()).outcome, SUPPLIER_PO_OUTCOME.UNAVAILABLE);
  assert.equal((await c({ readSupplierPurchaseOrder: { ok: true, result: { purchaseOrderId: "p", lines: [] } } }).readOrder("p")).outcome, SUPPLIER_PO_OUTCOME.UNAVAILABLE, "no allowed flags: not trusted");
  assert.equal((await c({ listPurchasableReorderRequests: { ok: true, result: { requests: [] } } }).listPurchasable()).outcome, SUPPLIER_PO_OUTCOME.UNAVAILABLE);
  assert.equal((await c({ listSupplierPurchaseOrders: new Error("boom") }).listOrders()).outcome, SUPPLIER_PO_OUTCOME.UNAVAILABLE);
  assert.equal((await c({ listSupplierPurchaseOrders: failure("FORBIDDEN", "no", "CAPABILITY_REQUIRED") }).listOrders()).outcome, SUPPLIER_PO_OUTCOME.DENIED);
});

test("an idempotency key is unique per attempt and carries its prefix", () => {
  const a = newIdempotencyKey("spo-create");
  const b = newIdempotencyKey("spo-create");
  assert.notEqual(a, b);
  assert.match(a, /^spo-create-/);
});
