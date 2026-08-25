// THE MONEY HAS TO ARRIVE, NOT JUST EXIST.
//
// GOVERNANCE: sandbox review, 2026-08-24.
//
// ============================ THE DEFECT THIS EXISTS TO STOP ============================
//
// The Sales Order Dollars column shipped, was deployed, and rendered an em dash on orders that
// carry a real committed price. Every layer was correct in isolation:
//
//   · the stored document        lines[0].unitPrice = 5000
//   · the server projection      returned totalMinor / currency / pricingState
//   · the deployed callable      updated in the same deploy
//   · the UI                     called formatMinor(view.totalMinor, view.currency)
//
// and `salesOrderView()` — the client view model sitting between the callable and the UI — did not
// carry ANY of them through. `view.totalMinor` was undefined on every order that has ever existed.
//
// THE TEST THAT WOULD HAVE CAUGHT IT is not "does the UI reference totalMinor" — that assertion
// passed while the value was undefined. It is this one: feed the view model a PROJECTION-SHAPED
// input and prove the value comes out the other side. An assertion about source text proves a
// reference was written; only an assertion about a value proves it arrives.

import test from "node:test";
import assert from "node:assert/strict";

import { salesOrderView, SALES_ORDER_VIEW_STATE } from "../src/domain/salesOrderView.js";
import { salesOrderDollars, PRICING_STATE_TEXT } from "../src/domain/salesOrderMoneyDisplay.js";

/** Exactly the shape functions/src/salesOrder/salesOrderReadService.ts returns. */
function projection(overrides = {}) {
  return {
    status: "ready",
    salesOrder: {
      id: "so-1",
      salesOrderNumber: "SO-2026-000001",
      accountId: "acct-1",
      ownerEmployeeId: "emp-1",
      salesChannel: "RETAIL",
      currency: "USD",
      locationId: "loc-1",
      sourceOpportunityId: null,
      sourceAgreementId: null,
      sourceOpportunityNumber: null,
      customerPO: null,
      notes: null,
      state: "CONFIRMED",
      lines: [{ lineId: "l1", kind: "PART", ref: "P1", orderedQty: 1, allocatedQty: 0, fulfilledQty: 0, billedQty: 0, unitPriceMinor: 5000, extendedMinor: 5000 }],
      serviceWorkOrderIds: [],
      totalMinor: 5000,
      pricingState: "PRICED",
      unpricedLineCount: 0,
      createdAtMillis: null,
      updatedAtMillis: null,
      ...overrides,
    },
  };
}

const view = (o) => salesOrderView({ result: projection(o), loading: false, errorStatus: null });

// ═════════════════════════════════════════ the value crosses the boundary

test("a priced order's total reaches the view model", () => {
  const v = view();
  assert.equal(v.kind, SALES_ORDER_VIEW_STATE.READY);
  // The assertion that was missing. `undefined` here is the shipped defect.
  assert.equal(v.totalMinor, 5000);
  assert.equal(v.currency, "USD");
  assert.equal(v.pricingState, "PRICED");
});

test("currency and location cross too — both were being dropped the same way", () => {
  const v = view();
  assert.equal(v.currency, "USD");
  assert.equal(v.locationId, "loc-1");
});

test("an order with no stored currency keeps its total and reports no currency", () => {
  // Six of fourteen sandbox orders store no `currency`. The amount still renders; it simply
  // carries no symbol, because a field must never claim a currency its record does not have.
  const v = view({ currency: undefined });
  assert.equal(v.totalMinor, 5000);
  assert.equal(v.currency, null);
  assert.equal(salesOrderDollars(v).text, "50.00");
});

// ═════════════════════════════════════════ a blank is not an answer

test("an unpriced order says so, rather than rendering an ambiguous blank", () => {
  // Seven of fourteen sandbox orders carry NO unitPrice on any line. The blank was truthful and
  // uninformative: a reader could not tell it apart from a failed load.
  const v = view({ totalMinor: null, pricingState: "UNPRICED", unpricedLineCount: 1 });
  const d = salesOrderDollars(v);
  assert.equal(d.text, PRICING_STATE_TEXT.UNPRICED);
  assert.equal(d.isAmount, false);
  assert.match(d.title, /cannot be invoiced/);
});

test("a PARTLY priced order shows NO NUMBER, and says how many lines are missing", () => {
  // The load-bearing refusal. A sum over the priced lines is a real figure that is not the sale's
  // total, and it is worse than nothing because it is credible.
  const v = view({ totalMinor: null, pricingState: "PARTIALLY_PRICED", unpricedLineCount: 2 });
  const d = salesOrderDollars(v);
  assert.equal(d.text, PRICING_STATE_TEXT.PARTIALLY_PRICED);
  assert.equal(d.isAmount, false);
  assert.match(d.title, /2 lines have no committed price/);
  assert.doesNotMatch(d.text, /\d/, "a partly-priced order must show no figure at all");
});

test("NULL IS NOT ZERO anywhere on this path", () => {
  for (const state of ["UNPRICED", "PARTIALLY_PRICED", "NO_LINES"]) {
    const d = salesOrderDollars(view({ totalMinor: null, pricingState: state }));
    assert.doesNotMatch(d.text, /0\.00|\$0/, `${state} must never render as zero`);
  }
});

test("an unknown or absent pricing state falls back to the em dash, not to a claim", () => {
  // Reporting "Not priced" when the read simply said nothing would state a fact about the order
  // that nobody established.
  assert.equal(salesOrderDollars({ totalMinor: null, pricingState: null }).text, "—");
  assert.equal(salesOrderDollars({}).text, "—");
  assert.equal(salesOrderDollars({ totalMinor: null, pricingState: "SOMETHING_NEW" }).text, "—");
});

test("zero is a real amount and still renders as one", () => {
  // The absent check must never swallow a genuine zero.
  const d = salesOrderDollars(view({ totalMinor: 0, pricingState: "PRICED" }));
  assert.equal(d.isAmount, true);
  assert.match(d.text, /0\.00/);
});

// ═════════════════════════════════════════ the lineage crosses the same boundary

test("sourceAgreementId ARRIVES in the view model, and null stays null", () => {
  // The same failure the money had: the server projection can return a field faithfully forever
  // while the view model drops it, and a test asserting the source text mentions the field would
  // pass the whole time. Feed a value; assert the value.
  assert.equal(view({ sourceAgreementId: "agr-77" }).sourceAgreementId, "agr-77");
  // Null on every order created before Slice 4 D2 and on any created directly — honestly null,
  // never an empty string and never backfilled with the order's own id.
  assert.equal(view({}).sourceAgreementId, null);
  assert.equal(view({ sourceAgreementId: undefined }).sourceAgreementId, null);
});

test("the agreement id NEVER stands in for the order's displayed identity", () => {
  // DECISIONS #106. An order with no allocated number shows no number, even though a lineage id
  // is sitting right there and would look like a plausible thing to render.
  const v = view({ salesOrderNumber: null, sourceAgreementId: "agr-77" });
  assert.equal(v.salesOrderNumber, null);
  assert.equal(v.sourceAgreementId, "agr-77");
  assert.notEqual(v.salesOrderNumber, v.sourceAgreementId);
});

test("the view model carries every lineage field the projection declares", () => {
  // A field added to salesOrderReadService.ts and forgotten here is invisible forever. This fails
  // the moment the projection grows a lineage field the view model does not carry.
  const v = view({ sourceOpportunityId: "opp-1", sourceOpportunityNumber: "OPP-2026-000001", sourceAgreementId: "agr-1" });
  for (const f of ["sourceOpportunityId", "sourceOpportunityNumber", "sourceAgreementId"]) {
    assert.ok(v[f], `${f} must reach the view model`);
  }
});
