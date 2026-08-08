// Sales Order Cycle 4 — OFFLINE tests for the PURE write core (lifecycle + command builders), from compiled
// lib. Proves: commercial↔physical cardinality (one line qty, serialized asset forbidden), the quantity model,
// canonical-ref requirements, and the fulfillment-gated lifecycle.
import test from "node:test";
import assert from "node:assert/strict";
import {
  SALES_ORDER_STATES,
  checkTransition,
  remainingQty,
  allLinesFulfilled,
} from "../lib/salesOrder/salesOrderLifecycle.js";
import {
  buildCreateSalesOrder,
  buildTransitionPatch,
  SalesOrderCommandError,
} from "../lib/salesOrder/salesOrderCommands.js";

const CTX = { actorUid: "uid-1", nowMillis: 1_754_600_000_000 };

test("states are the ratified set", () => {
  assert.deepEqual([...SALES_ORDER_STATES], ["CONFIRMED", "IN_FULFILLMENT", "FULFILLED", "CLOSED", "CANCELLED"]);
});

test("create: one product-level line with qty (C713 x5), starts CONFIRMED, qtys initialized", () => {
  const so = buildCreateSalesOrder(
    { accountId: "ACCT-1", ownerEmployeeId: "EMP-9", salesChannel: "NATIONAL_ACCOUNTS", lines: [{ kind: "EQUIPMENT_MODEL", ref: "C713", orderedQty: 5, unitPrice: 12000 }] },
    CTX
  );
  assert.equal(so.state, "CONFIRMED");
  assert.equal(so.lines.length, 1);
  assert.deepEqual(
    { ordered: so.lines[0].orderedQty, allocated: so.lines[0].allocatedQty, fulfilled: so.lines[0].fulfilledQty, price: so.lines[0].unitPrice },
    { ordered: 5, allocated: 0, fulfilled: 0, price: 12000 }
  );
});

test("create: a serialized-asset line is FORBIDDEN (commercial != physical)", () => {
  for (const bad of [
    { kind: "EQUIPMENT_MODEL", ref: "C713", orderedQty: 1, serial: "SN-1" },
    { kind: "EQUIPMENT_MODEL", ref: "C713", orderedQty: 1, serializedAssetId: "SA-1" },
    { kind: "EQUIPMENT_MODEL", ref: "C713", orderedQty: 1, equipmentId: "EQ-1" },
  ]) {
    assert.throws(
      () => buildCreateSalesOrder({ accountId: "A", ownerEmployeeId: "E", salesChannel: "RETAIL", lines: [bad] }, CTX),
      (e) => e instanceof SalesOrderCommandError && e.code === "SERIALIZED_LINE_FORBIDDEN"
    );
  }
});

test("create: fails closed on missing account/owner/channel/lines and bad qty", () => {
  assert.throws(() => buildCreateSalesOrder({ ownerEmployeeId: "E", salesChannel: "RETAIL", lines: [{ kind: "PART", ref: "p", orderedQty: 1 }] }, CTX), (e) => e.code === "ACCOUNT_REQUIRED");
  assert.throws(() => buildCreateSalesOrder({ accountId: "A", salesChannel: "RETAIL", lines: [{ kind: "PART", ref: "p", orderedQty: 1 }] }, CTX), (e) => e.code === "OWNER_REQUIRED");
  assert.throws(() => buildCreateSalesOrder({ accountId: "A", ownerEmployeeId: "E", salesChannel: "X", lines: [{ kind: "PART", ref: "p", orderedQty: 1 }] }, CTX), (e) => e.code === "CHANNEL_INVALID");
  assert.throws(() => buildCreateSalesOrder({ accountId: "A", ownerEmployeeId: "E", salesChannel: "RETAIL", lines: [] }, CTX), (e) => e.code === "NO_LINES");
  assert.throws(() => buildCreateSalesOrder({ accountId: "A", ownerEmployeeId: "E", salesChannel: "RETAIL", lines: [{ kind: "PART", ref: "p", orderedQty: 0 }] }, CTX), (e) => e.code === "QTY_INVALID");
  assert.throws(() => buildCreateSalesOrder({ accountId: "A", ownerEmployeeId: "E", salesChannel: "RETAIL", lines: [{ kind: "PART", ref: "p", orderedQty: 1.5 }] }, CTX), (e) => e.code === "QTY_INVALID");
});

test("quantity helpers: remaining + allLinesFulfilled", () => {
  assert.equal(remainingQty({ orderedQty: 5, fulfilledQty: 2 }), 3);
  assert.equal(remainingQty({ orderedQty: 5 }), 5);
  assert.equal(allLinesFulfilled([{ orderedQty: 2, fulfilledQty: 2 }, { orderedQty: 1, fulfilledQty: 1 }]), true);
  assert.equal(allLinesFulfilled([{ orderedQty: 2, fulfilledQty: 1 }]), false);
  assert.equal(allLinesFulfilled([]), false);
});

test("lifecycle: forward advance; FULFILLED gated on all lines fulfilled; terminal states reject", () => {
  assert.deepEqual(checkTransition("CONFIRMED", "ADVANCE"), { ok: true, to: "IN_FULFILLMENT" });
  // IN_FULFILLMENT -> FULFILLED only when all lines fulfilled
  assert.equal(checkTransition("IN_FULFILLMENT", "ADVANCE", { allLinesFulfilled: false }).code, "NOT_FULFILLABLE");
  assert.deepEqual(checkTransition("IN_FULFILLMENT", "ADVANCE", { allLinesFulfilled: true }), { ok: true, to: "FULFILLED" });
  assert.deepEqual(checkTransition("FULFILLED", "ADVANCE"), { ok: true, to: "CLOSED" });
  assert.equal(checkTransition("CLOSED", "ADVANCE").code, "TERMINAL");
});

test("lifecycle: CANCEL allowed pre-FULFILLED, rejected at FULFILLED/terminal", () => {
  assert.deepEqual(checkTransition("CONFIRMED", "CANCEL"), { ok: true, to: "CANCELLED" });
  assert.deepEqual(checkTransition("IN_FULFILLMENT", "CANCEL"), { ok: true, to: "CANCELLED" });
  assert.equal(checkTransition("FULFILLED", "CANCEL").code, "ILLEGAL_TRANSITION");
  assert.equal(checkTransition("CANCELLED", "CANCEL").code, "TERMINAL");
});

test("buildTransitionPatch: advances and fails closed on illegal transition", () => {
  const patch = buildTransitionPatch({ state: "CONFIRMED", lines: [{ orderedQty: 1, fulfilledQty: 0 }] }, "ADVANCE", CTX);
  assert.equal(patch.state, "IN_FULFILLMENT");
  assert.throws(() => buildTransitionPatch({ state: "IN_FULFILLMENT", lines: [{ orderedQty: 2, fulfilledQty: 1 }] }, "ADVANCE", CTX), (e) => e.code === "NOT_FULFILLABLE");
  assert.throws(() => buildTransitionPatch({ state: "CLOSED", lines: [] }, "ADVANCE", CTX), (e) => e.code === "TERMINAL");
});
