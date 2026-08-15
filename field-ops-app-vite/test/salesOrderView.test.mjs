import { test } from "node:test";
import assert from "node:assert/strict";
import { salesOrderView, salesOrderStateTone, SALES_ORDER_VIEW_STATE } from "../src/domain/salesOrderView.js";

test("loading takes priority over everything else", () => {
  assert.equal(salesOrderView({ loading: true, errorStatus: "denied" }).kind, SALES_ORDER_VIEW_STATE.LOADING);
});

test("errorStatus surfaces denied distinctly from unavailable -- DENIED never renders as EMPTY", () => {
  assert.equal(salesOrderView({ errorStatus: "denied" }).kind, "denied");
  assert.equal(salesOrderView({ errorStatus: "unavailable" }).kind, "unavailable");
});

test("a genuinely missing Sales Order (not-found) is distinct from a read failure (unavailable)", () => {
  assert.equal(salesOrderView({ result: { status: "not-found", salesOrder: null } }).kind, SALES_ORDER_VIEW_STATE.NOT_FOUND);
  assert.equal(salesOrderView({ result: null }).kind, SALES_ORDER_VIEW_STATE.UNAVAILABLE);
  assert.equal(salesOrderView({ result: { status: "ready", salesOrder: null } }).kind, SALES_ORDER_VIEW_STATE.UNAVAILABLE);
});

test("ready projects identity, account, opportunity lineage, and lines with the full quantity model", () => {
  const view = salesOrderView({
    result: {
      status: "ready",
      salesOrder: {
        id: "SO-1",
        accountId: "ACCT-1",
        sourceOpportunityId: "OPP-1",
        ownerEmployeeId: "EMP-1",
        salesChannel: "RETAIL",
        state: "IN_FULFILLMENT",
        customerPO: "PO-9",
        notes: "handle with care",
        lines: [{ lineId: "line-1", kind: "PART", ref: "PRT-1", orderedQty: 5, allocatedQty: 3, fulfilledQty: 2, billedQty: 1 }],
        serviceWorkOrderIds: ["WO-1"],
      },
    },
  });
  assert.equal(view.kind, SALES_ORDER_VIEW_STATE.READY);
  assert.equal(view.id, "SO-1");
  assert.equal(view.sourceOpportunityId, "OPP-1");
  assert.equal(view.tone, "attention"); // IN_FULFILLMENT tone
  assert.equal(view.lines[0].remainingQty, 3);
  assert.equal(view.lines[0].fullyFulfilled, false);
  assert.equal(view.allLinesFulfilled, false);
  assert.deepEqual(view.serviceWorkOrderIds, ["WO-1"]);
});

test("allLinesFulfilled is true only when every line's remaining quantity is zero", () => {
  const view = salesOrderView({
    result: {
      status: "ready",
      salesOrder: {
        id: "SO-2",
        lines: [
          { lineId: "line-1", kind: "PART", ref: "A", orderedQty: 2, fulfilledQty: 2 },
          { lineId: "line-2", kind: "PART", ref: "B", orderedQty: 3, fulfilledQty: 3 },
        ],
      },
    },
  });
  assert.equal(view.allLinesFulfilled, true);
  assert.ok(view.lines.every((l) => l.fullyFulfilled));
});

test("salesOrderStateTone covers every lifecycle state and fails closed to unknown", () => {
  assert.equal(salesOrderStateTone("CONFIRMED"), "info");
  assert.equal(salesOrderStateTone("IN_FULFILLMENT"), "attention");
  assert.equal(salesOrderStateTone("FULFILLED"), "positive");
  assert.equal(salesOrderStateTone("CLOSED"), "muted");
  assert.equal(salesOrderStateTone("CANCELLED"), "critical");
  assert.equal(salesOrderStateTone("garbage"), "unknown");
  assert.equal(salesOrderStateTone(undefined), "unknown");
});

test("an empty lines array yields allLinesFulfilled false, never a false-positive on zero lines", () => {
  const view = salesOrderView({ result: { status: "ready", salesOrder: { id: "SO-3", lines: [] } } });
  assert.equal(view.allLinesFulfilled, false);
  assert.deepEqual(view.lines, []);
});
