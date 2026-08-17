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

// #1099 — the Originating Opportunity link must not be labelled with a document id.
//
// The reference is DENORMALIZED onto the Sales Order at creation rather than joined at
// read time, and that is an authorization decision rather than a performance one:
// getSalesOrderContext is gated on salesOrder.read, so returning Opportunity data through
// it would hand a caller fields governed by opportunity.read. A read must not become a
// side door around the capability guarding what it returns.
test("#1099 — the Opportunity reference is carried through for the lineage link", () => {
  const view = salesOrderView({
    loading: false,
    errorStatus: null,
    result: {
      status: "ready",
      salesOrder: {
        id: "so-doc-id", accountId: "acct-1", state: "CONFIRMED", lines: [],
        sourceOpportunityId: "opp-doc-id", sourceOpportunityNumber: "OPP-2026-000042",
      },
    },
  });
  assert.equal(view.sourceOpportunityNumber, "OPP-2026-000042");
  assert.notEqual(view.sourceOpportunityNumber, view.sourceOpportunityId, "the reference is not the document id");
});

test("#1099 — a Sales Order predating Opportunity identity reports null, not a guess", () => {
  // Honest absence. The UI renders "Originating opportunity" for these — a true statement
  // that a link exists — rather than backfilling a value nobody allocated.
  const view = salesOrderView({
    loading: false,
    errorStatus: null,
    result: {
      status: "ready",
      salesOrder: {
        id: "so-doc-id", accountId: "acct-1", state: "CONFIRMED", lines: [],
        sourceOpportunityId: "opp-doc-id",
      },
    },
  });
  assert.equal(view.sourceOpportunityNumber, null);
  assert.equal(view.sourceOpportunityId, "opp-doc-id", "the id is still available for routing, just never as a label");
});
