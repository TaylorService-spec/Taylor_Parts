// Sales Order — OFFLINE tests for the PURE read-projection core, imported from compiled lib.
// No emulator/Firebase/network. Proves the minimal projection (no raw UID beyond audit fields, no
// Customer PII copy; accountId only), invalid-field/line dropping, and the not-found-vs-unavailable
// distinction stays a caller concern (this module only builds the projection).
import test from "node:test";
import assert from "node:assert/strict";
import { projectSalesOrder, resolveServiceWorkOrders, MAX_RESOLVED_SERVICE_WORK_ORDERS } from "../lib/salesOrder/salesOrderReadService.js";

function baseDoc(overrides = {}) {
  return {
    salesOrderNumber: "SO-2026-000001",
    accountId: "ACCT-1",
    ownerEmployeeId: "EMP-9",
    salesChannel: "RETAIL",
    currency: "USD",
    locationId: "LOC-1",
    sourceOpportunityId: "OPP-1",
    sourceAgreementId: "AGR-1",
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
    "ownerEmployeeId", "salesChannel", "salesOrderNumber", "serviceWorkOrderIds", "serviceWorkOrders", "sourceOpportunityId",
    "sourceAgreementId", "sourceOpportunityNumber", "state", "updatedAtMillis", "currency",
    "totalMinor", "pricingState", "unpricedLineCount",
  ].sort());
  assert.equal(p.accountId, "ACCT-1");
  assert.equal(p.sourceOpportunityId, "OPP-1");
  // Which accepted commitment this order fulfils. The key-set assertion above proves the field is
  // projected; this proves the VALUE crosses, which is the only thing a screen can use.
  assert.equal(p.sourceAgreementId, "AGR-1");
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

// ════════════════════ WORK ORDER LINEAGE CARRIES A READABLE REFERENCE ════════════════════
//
// SalesOrderDetail rendered the stored Work Order document id as visible content
// (`<li key={woId}>{woId}</li>`) -- observed live on SO-2026-000007 as FkA7SbwObO2tkORMgpCl.
// DECISIONS #106: a document id is a routing key, not a name. The Sales Order stores only ids, so
// the surface had nothing else to show; this read resolves the governed WO-YYYY-###### reference.

test("projectSalesOrder stays PURE -- the list paths pay for no lineage read", () => {
  const p = projectSalesOrder("so-1", baseDoc({ serviceWorkOrderIds: ["wo-a", "wo-b"] }));
  assert.deepEqual(p.serviceWorkOrderIds, ["wo-a", "wo-b"], "the ids still project");
  assert.deepEqual(p.serviceWorkOrders, [], "resolved lineage stays empty until the single-record read fills it");
});

/** A Firestore double: only the two methods the resolver actually uses. */
const fakeDb = (onGetAll) => ({
  collection: () => ({ doc: (id) => ({ id }) }),
  getAll: onGetAll,
});

test("resolveServiceWorkOrders returns the GOVERNED REFERENCE for each linked Work Order", async () => {
  const db = fakeDb(async (...refs) => refs.map((r) => ({
    exists: r.id !== "wo-missing",
    data: () => (r.id === "wo-unnumbered" ? {} : { woNumber: "WO-2026-000042" }),
  })));
  const out = await resolveServiceWorkOrders(db, ["wo-000042", "wo-unnumbered", "wo-missing"]);
  assert.equal(out.length, 3, "every link is listed -- silently omitting one says the Work Order is gone");
  assert.equal(out[0].workOrderNumber, "WO-2026-000042");
  // NULL, never the id. A Work Order predating numbering and one this read could not fetch are both
  // "no reference to show", and neither is permission to show the key instead.
  assert.equal(out[1].workOrderNumber, null, "unnumbered resolves to null");
  assert.equal(out[2].workOrderNumber, null, "missing resolves to null");
  for (const e of out) assert.notEqual(e.workOrderNumber, e.workOrderId);
  assert.deepEqual(out.map((e) => e.workOrderId), ["wo-000042", "wo-unnumbered", "wo-missing"], "order follows the stored ids");
});

test("THE LINEAGE READ IS BOUNDED -- one pathological record cannot decide this read's cost", async () => {
  let fetched = 0;
  const db = fakeDb(async (...refs) => {
    fetched += refs.length;
    return refs.map(() => ({ exists: true, data: () => ({ woNumber: "WO-2026-000001" }) }));
  });
  const ids = Array.from({ length: MAX_RESOLVED_SERVICE_WORK_ORDERS + 5 }, (_, i) => `wo-${i}`);
  const out = await resolveServiceWorkOrders(db, ids);
  assert.equal(fetched, MAX_RESOLVED_SERVICE_WORK_ORDERS, "never reads beyond the cap");
  // Beyond the cap the entries still APPEAR, unresolved. A silently shortened list would be a
  // lineage that lies about how many Work Orders exist.
  assert.equal(out.length, ids.length);
  assert.equal(out[MAX_RESOLVED_SERVICE_WORK_ORDERS].workOrderNumber, null);
});

test("a FAILED lineage read does not take the whole Sales Order down with it", async () => {
  // A display enrichment on top of an already-successful read. Throwing would turn a readable order
  // into an unavailable page over a label.
  const db = fakeDb(async () => { throw new Error("boom"); });
  assert.deepEqual(await resolveServiceWorkOrders(db, ["wo-a", "wo-b"]), [
    { workOrderId: "wo-a", workOrderNumber: null },
    { workOrderId: "wo-b", workOrderNumber: null },
  ]);
});

test("no linked Work Orders performs NO read at all", async () => {
  let called = false;
  const db = fakeDb(async () => { called = true; return []; });
  assert.deepEqual(await resolveServiceWorkOrders(db, []), []);
  assert.deepEqual(await resolveServiceWorkOrders(db, ["", "   "]), [], "blank ids are not links");
  assert.equal(called, false);
});
