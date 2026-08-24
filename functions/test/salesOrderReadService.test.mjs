// Sales Order — OFFLINE tests for the PURE read-projection core, imported from compiled lib.
// No emulator/Firebase/network. Proves the minimal projection (no raw UID beyond audit fields, no
// Customer PII copy; accountId only), invalid-field/line dropping, and the not-found-vs-unavailable
// distinction stays a caller concern (this module only builds the projection).
import test from "node:test";
import assert from "node:assert/strict";
import { projectSalesOrder } from "../lib/salesOrder/salesOrderReadService.js";

function baseDoc(overrides = {}) {
  return {
    salesOrderNumber: "SO-2026-000001",
    accountId: "ACCT-1",
    ownerEmployeeId: "EMP-9",
    salesChannel: "RETAIL",
    currency: "USD",
    locationId: "LOC-1",
    sourceOpportunityId: "OPP-1",
    customerPO: "PO-123",
    notes: "some notes",
    state: "IN_FULFILLMENT",
    lines: [
      { lineId: "line-1", kind: "PART", ref: "PRT-1", orderedQty: 5, allocatedQty: 3, fulfilledQty: 2, billedQty: 1, unitPrice: 12.5 },
    ], // unitPrice included in the RAW doc on purpose -- proves the projection strips it, not just that it's absent from a fixture that never had it
    serviceWorkOrderIds: ["WO-1", "WO-2"],
    createdAtMillis: 1000,
    updatedAtMillis: 2000,
    ...overrides,
  };
}

test("projectSalesOrder returns only the minimal Sales-Order-UX fields", () => {
  const p = projectSalesOrder("SO-1", baseDoc({
    // fields that must NOT leak into the projection:
    createdByUid: "uid-abc",
    updatedByUid: "uid-def",
    customerName: "Should Not Copy Co",
    internalMargin: 999,
  }));
  // The allow-list grew by exactly one, deliberately (#1099), and this assertion failing on
  // it is the guard WORKING: this projection is minimal by design -- it is the same test
  // that keeps unitPrice out -- so an addition has to be argued for rather than slide in.
  //
  // sourceOpportunityNumber is the originating Opportunity's IMMUTABLE reference, copied
  // onto the Sales Order at creation by the command that was already authorized to read it.
  // It is here precisely so this read does NOT have to fetch the Opportunity: doing that
  // would return opportunity.read-governed data through a salesOrder.read-gated callable.
  // The field is identity, not commercial content, and it is what stops the lineage link
  // being labelled with a document id.
  //
  // salesOrderNumber grew the allow-list by one more (X-SALES-ORDER-HEADER, DECISIONS #106):
  // the Sales Order's OWN governed business reference, allocated server-side at creation
  // (salesOrderNumbering.ts). It is here so the detail page can render the reference instead
  // of the Firestore document id -- the id (`p.id`) stays available for routing but is never
  // this projection's stand-in for identity.
  // THE ALLOW-LIST GREW BY THREE, ARGUED FOR RATHER THAN SLID IN — totalMinor, pricingState and
  // unpricedLineCount. A Sales Order is the entry point of a sale, so it carries the sale's money
  // (Owner ruling, 2026-08-24), and that money was already authoritative before this projection
  // returned it: finance/invoiceCommands.ts snapshots each line's unitPrice as unitPriceMinor,
  // refuses to bill a line without one (UNPRICED), and refuses any invoice price that disagrees
  // with it (PRICE_MISMATCH). The invoice is DERIVED from the order and forbidden from
  // contradicting it. Returning the number the whole billing chain already depends on is not a
  // widening of this projection's authority; withholding it was the anomaly.
  assert.deepEqual(Object.keys(p).sort(), [
    "accountId", "createdAtMillis", "customerPO", "id", "lines", "locationId", "notes",
    "ownerEmployeeId", "salesChannel", "salesOrderNumber", "serviceWorkOrderIds", "sourceOpportunityId",
    "sourceOpportunityNumber", "state", "updatedAtMillis", "currency",
    "totalMinor", "pricingState", "unpricedLineCount",
  ].sort());
  assert.equal(p.accountId, "ACCT-1");
  assert.equal(p.sourceOpportunityId, "OPP-1");
  assert.equal(p.salesOrderNumber, "SO-2026-000001");
  assert.equal("createdByUid" in p, false);
  assert.equal("customerName" in p, false);
  assert.equal("internalMargin" in p, false);
});

test("projectSalesOrder projects lines with the full ordered/allocated/fulfilled/billed quantity model", () => {
  const p = projectSalesOrder("SO-1", baseDoc());
  // The four quantities are unchanged; the two money fields are additions, and are null here
  // because this fixture's line carries no unitPrice. NULL, not 0 — an unpriced line has no
  // amount, and zero would state that it is free.
  assert.deepEqual(p.lines, [
    {
      lineId: "line-1", kind: "PART", ref: "PRT-1",
      orderedQty: 5, allocatedQty: 3, fulfilledQty: 2, billedQty: 1,
      unitPriceMinor: null, extendedMinor: null,
    },
  ]);
});

test("projectSalesOrder exposes the COMMITTED price and still no pricing policy", () => {
  // THE BOUNDARY MOVED, AND IT DID NOT DISAPPEAR.
  //
  // This test used to assert no price field of any kind. The distinction its own title drew is the
  // one that survives: a committed unit price is a STORED FACT, and a pricing POLICY is a decision.
  // The projection now returns the fact — the same integer minor-unit value invoicing snapshots and
  // refuses to contradict — and still computes no discount, no tax, no quote state and no margin.
  const p = projectSalesOrder("SO-1", baseDoc());
  assert.deepEqual(
    Object.keys(p.lines[0]).sort(),
    ["allocatedQty", "billedQty", "extendedMinor", "fulfilledQty", "kind", "lineId", "orderedQty", "ref", "unitPriceMinor"],
  );
  // Still absent, and still deliberately: these are policy, not stored line facts.
  for (const forbidden of ["discount", "discountMinor", "taxMinor", "margin", "quoteState", "pricingPolicy"]) {
    assert.equal(forbidden in p.lines[0], false, `${forbidden} is pricing policy and does not belong in this projection`);
  }
});

test("a partly priced order has NO total, because a partial sum is not the sale", () => {
  // The one real hazard in exposing money here. `unitPrice` is OPTIONAL per line, so summing what
  // happens to be priced yields a real number that is not the sale's total — worse than showing
  // nothing, because somebody would act on it.
  const priced = { lineId: "l1", kind: "PART", ref: "P1", orderedQty: 2, unitPrice: 1500 };
  const unpriced = { lineId: "l2", kind: "PART", ref: "P2", orderedQty: 3 };

  const whole = projectSalesOrder("SO-P", baseDoc({ lines: [priced] }));
  assert.equal(whole.pricingState, "PRICED");
  assert.equal(whole.totalMinor, 3000);
  assert.equal(whole.unpricedLineCount, 0);

  const partial = projectSalesOrder("SO-Q", baseDoc({ lines: [priced, unpriced] }));
  assert.equal(partial.pricingState, "PARTIALLY_PRICED");
  assert.equal(partial.totalMinor, null, "NULL IS NOT ZERO");
  assert.equal(partial.unpricedLineCount, 1);

  const none = projectSalesOrder("SO-R", baseDoc({ lines: [unpriced] }));
  assert.equal(none.pricingState, "UNPRICED");
  assert.equal(none.totalMinor, null);

  const empty = projectSalesOrder("SO-S", baseDoc({ lines: [] }));
  assert.equal(empty.pricingState, "NO_LINES");
  assert.equal(empty.totalMinor, null);
});

test("a malformed stored price is treated as absent, never coerced into a total", () => {
  // A negative or fractional price is not a price this money model accepts anywhere else.
  // Coercing it would build a total out of a number the system rejects.
  for (const bad of [-100, 12.5, "1500", null]) {
    const p = projectSalesOrder("SO-B", baseDoc({
      lines: [{ lineId: "l1", kind: "PART", ref: "P1", orderedQty: 1, unitPrice: bad }],
    }));
    assert.equal(p.lines[0].unitPriceMinor, null, `${bad} must not be accepted as a price`);
    assert.equal(p.totalMinor, null);
    assert.equal(p.pricingState, "UNPRICED");
  }
});

test("projectSalesOrder returns null for an invalid/unrecognized state rather than trusting it", () => {
  assert.equal(projectSalesOrder("SO-2", baseDoc({ state: "BOGUS" })), null);
  assert.equal(projectSalesOrder("SO-3", baseDoc({ state: undefined })), null);
});

test("projectSalesOrder drops malformed lines rather than fabricating them, keeps the valid ones", () => {
  const p = projectSalesOrder("SO-4", baseDoc({
    lines: [
      { kind: "PART", ref: "ok", orderedQty: 1 }, // valid, lineId falls back positionally
      { kind: "PART", ref: "no-qty" }, // missing orderedQty -> dropped
      { kind: "BOGUS_KIND", ref: "x", orderedQty: 1 }, // invalid kind -> dropped
      "not-an-object", // dropped
      { kind: "PART", orderedQty: 1 }, // missing ref -> dropped
    ],
  }));
  assert.deepEqual(p.lines, [
    {
      lineId: "line-1", kind: "PART", ref: "ok",
      orderedQty: 1, allocatedQty: 0, fulfilledQty: 0, billedQty: 0,
      // The surviving line carries no price in this fixture. Null, not 0 — an unpriced line has
      // no amount, and zero would state that it is free.
      unitPriceMinor: null, extendedMinor: null,
    },
  ]);
});

test("projectSalesOrder normalizes negative/malformed quantities to a safe 0, never negative or NaN", () => {
  const p = projectSalesOrder("SO-5", baseDoc({
    lines: [{ kind: "PART", ref: "x", orderedQty: 5, allocatedQty: -3, fulfilledQty: "oops", billedQty: NaN }],
  }));
  assert.deepEqual(p.lines[0].allocatedQty, 0);
  assert.deepEqual(p.lines[0].fulfilledQty, 0);
  assert.deepEqual(p.lines[0].billedQty, 0);
});

test("projectSalesOrder fails to null on missing id or data", () => {
  assert.equal(projectSalesOrder("", baseDoc()), null);
  assert.equal(projectSalesOrder("SO-6", undefined), null);
});

test("projectSalesOrder drops non-string entries from serviceWorkOrderIds rather than trusting them", () => {
  const p = projectSalesOrder("SO-7", baseDoc({ serviceWorkOrderIds: ["WO-1", 42, null, "WO-2", ""] }));
  assert.deepEqual(p.serviceWorkOrderIds, ["WO-1", "WO-2"]);
});

// A Sales Order created before numbering existed never had a salesOrderNumber allocated -- the
// projection reports that honestly as null. It must never fabricate one and must never fall back
// to the document id (DECISIONS #106); `p.id` is a separate field, unaffected by this one.
test("projectSalesOrder reports salesOrderNumber as null for a legacy Sales Order, never falling back to the document id", () => {
  const p = projectSalesOrder("SO-8", baseDoc({ salesOrderNumber: undefined }));
  assert.equal(p.salesOrderNumber, null);
  assert.notEqual(p.salesOrderNumber, p.id);
  assert.equal(p.id, "SO-8");
});
