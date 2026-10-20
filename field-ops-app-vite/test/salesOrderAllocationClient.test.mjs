// SALES ORDER ALLOCATION CLIENT (S1c; DECISIONS #S1c): the browser's route to allocateSalesOrderLine / releaseSalesOrderAllocation / readSalesOrderAllocations.
//
//   * it names no capability and decides nothing; it states the line, the company and the warehouse the CALLER chose, and carries the idempotencyKey verbatim;
//   * a call missing any stated field is refused here (invalid-argument) WITHOUT a request -- company and warehouse are never defaulted or derived;
//   * a GOVERNED refusal carries the server's own sentence; any other failure is a bounded status with NO server text;
//   * a malformed read answer is UNAVAILABLE, never a partially trusted list.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { allocateSalesOrder, releaseSalesOrderAllocation, readSalesOrderAllocations, createServiceForSalesOrder, salesOrderCommandClient } from "../src/services/salesOrderCommandClient.js";

const fake = (answer) => {
  const calls = [];
  const call = async (operation, input) => { calls.push({ operation, input }); return typeof answer === "function" ? answer(operation, input) : answer; };
  return { call, calls };
};
const line = { salesOrderId: "so-1", lineNumber: 2, operatingCompanyId: "co-a-id", warehouseId: "wh-a1", partId: "P-1", quantity: 3, idempotencyKey: "soalloc-1" };

test("the three operations are on the Operations client's closed lists, and the client names no capability", () => {
  // Read as text: importing reorderApiClient.js would initialize the Firebase-era token seam, which a node:test suite must not.
  const reorderApi = readFileSync(new URL("../src/services/reorderApiClient.js", import.meta.url), "utf8");
  const names = (list) => reorderApi.slice(reorderApi.indexOf(`export const ${list} =`)).split("]);")[0];
  assert.ok(names("REORDER_COMMAND_OPERATIONS").includes('"allocateSalesOrderLine"'));
  assert.ok(names("REORDER_COMMAND_OPERATIONS").includes('"releaseSalesOrderAllocation"'));
  assert.ok(names("REORDER_READ_OPERATIONS").includes('"readSalesOrderAllocations"'));
  const src = readFileSync(new URL("../src/services/salesOrderCommandClient.js", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(src, /salesOrder\.fulfill/, "the gate is the server's");
  assert.match(src, /const callOperationsApi = async \(\.\.\.args\) => \(await import\("\.\/reorderApiClient\.js"\)\)\.callReorderApi\(\.\.\.args\);/, "the transport is imported lazily");
});

test("allocate states the line, company, warehouse, Part, quantity and the caller's key, verbatim", async () => {
  const { call, calls } = fake({ ok: true, result: { outcome: "allocated" } });
  assert.deepEqual(await allocateSalesOrder(line, { call }), { result: { outcome: "allocated" } });
  assert.deepEqual(calls, [{ operation: "allocateSalesOrderLine", input: line }]);
});

test("allocate refuses an unstated company, warehouse, line, Part, quantity or key WITHOUT a request", async () => {
  const { call, calls } = fake({ ok: true, result: {} });
  for (const over of [
    { operatingCompanyId: undefined }, { operatingCompanyId: " " }, { warehouseId: undefined }, { warehouseId: "" }, { lineNumber: undefined }, { lineNumber: 1.5 },
    { partId: undefined }, { quantity: 0 }, { quantity: -1 }, { quantity: 1.5 }, { quantity: "3" }, { idempotencyKey: undefined }, { idempotencyKey: "" }, { salesOrderId: undefined },
  ]) {
    assert.deepEqual(await allocateSalesOrder({ ...line, ...over }, { call }), { errorStatus: "invalid-argument" }, JSON.stringify(over));
  }
  assert.deepEqual(await allocateSalesOrder({ salesOrderId: "so-1" }, { call }), { errorStatus: "invalid-argument" }, "the legacy whole-order call states no line");
  assert.deepEqual(await allocateSalesOrder(undefined, { call }), { errorStatus: "invalid-argument" });
  assert.deepEqual(calls, [], "nothing was sent");
});

test("release needs a reason and the same stated company and warehouse; an omitted quantity releases everything and is not sent", async () => {
  const { call, calls } = fake({ ok: true, result: { outcome: "released" } });
  const base = { salesOrderId: "so-1", lineNumber: 2, operatingCompanyId: "co-a-id", warehouseId: "wh-a1", reason: "  customer changed it ", idempotencyKey: "k" };
  await releaseSalesOrderAllocation(base, { call });
  await releaseSalesOrderAllocation({ ...base, quantity: 2 }, { call });
  assert.deepEqual(calls.map((c) => c.input), [
    { salesOrderId: "so-1", lineNumber: 2, operatingCompanyId: "co-a-id", warehouseId: "wh-a1", reason: "customer changed it", idempotencyKey: "k" },
    { salesOrderId: "so-1", lineNumber: 2, operatingCompanyId: "co-a-id", warehouseId: "wh-a1", reason: "customer changed it", idempotencyKey: "k", quantity: 2 },
  ]);
  for (const over of [{ reason: "" }, { reason: "  " }, { reason: undefined }, { warehouseId: undefined }, { operatingCompanyId: undefined }, { quantity: 0 }, { quantity: 1.5 }]) {
    assert.deepEqual(await releaseSalesOrderAllocation({ ...base, ...over }, { call }), { errorStatus: "invalid-argument" }, JSON.stringify(over));
  }
  assert.equal(calls.length, 2);
});

test("a GOVERNED refusal carries the server's own words; any other failure carries none", async () => {
  for (const [code, status] of [["FORBIDDEN", "permission-denied"], ["NOT_FOUND", "not-found"], ["INVALID_INPUT", "invalid-argument"], ["CONFLICT", "already-exists"], ["PRECONDITION_FAILED", "failed-precondition"]]) {
    const { call } = fake({ ok: false, code, message: `server words for ${code}` });
    assert.deepEqual(await allocateSalesOrder(line, { call }), { errorStatus: status, message: `server words for ${code}` }, code);
  }
  for (const failure of [{ code: "INTERNAL", message: "stack trace at db.js:12" }, { code: "UNREACHABLE", message: "ECONNREFUSED 10.0.0.1" }, { code: "NOT_CONFIGURED", message: "no base url" }, { code: "UNAUTHENTICATED", message: "token expired" }]) {
    const { call } = fake({ ok: false, ...failure });
    const answer = await allocateSalesOrder(line, { call });
    assert.ok(answer.errorStatus);
    assert.equal(answer.message, undefined, `${failure.code} must not leak server text`);
  }
  // A governed refusal with no words has none to show.
  assert.deepEqual(await allocateSalesOrder(line, { call: async () => ({ ok: false, code: "FORBIDDEN", message: "" }) }), { errorStatus: "permission-denied" });
  // A transport that throws is unavailable, never a thrown error.
  assert.deepEqual(await allocateSalesOrder(line, { call: async () => { throw new Error("boom: secret host"); } }), { errorStatus: "unavailable" });
});

test("the read: needs the order, returns the server's answer, and treats a malformed answer as unavailable", async () => {
  const good = { salesOrderId: "so-1", lines: [], warehouses: [], canAllocate: false, canRelease: false };
  const { call, calls } = fake({ ok: true, result: good });
  assert.deepEqual(await readSalesOrderAllocations({ salesOrderId: "so-1" }, { call }), { result: good });
  assert.deepEqual(calls, [{ operation: "readSalesOrderAllocations", input: { salesOrderId: "so-1" } }]);
  assert.deepEqual(await readSalesOrderAllocations({}, { call }), { errorStatus: "invalid-argument" });
  assert.equal(calls.length, 1);
  for (const result of [null, {}, { lines: "x" }, "x"]) {
    assert.deepEqual(await readSalesOrderAllocations({ salesOrderId: "so-1" }, { call: async () => ({ ok: true, result }) }), { errorStatus: "unavailable" }, JSON.stringify(result));
  }
});

test("create-service is still the held boundary; the client object exposes the allocation operations", async () => {
  assert.deepEqual(await createServiceForSalesOrder({ salesOrderId: "so-1" }), { errorStatus: "failed-precondition" });
  for (const fn of ["transitionSalesOrder", "allocateSalesOrder", "releaseSalesOrderAllocation", "readSalesOrderAllocations", "createServiceForSalesOrder"]) {
    assert.equal(typeof salesOrderCommandClient[fn], "function", fn);
  }
  assert.ok(Object.isFrozen(salesOrderCommandClient));
});
