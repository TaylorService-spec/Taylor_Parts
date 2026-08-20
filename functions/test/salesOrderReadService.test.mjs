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
  assert.deepEqual(Object.keys(p).sort(), [
    "accountId", "createdAtMillis", "customerPO", "id", "lines", "locationId", "notes",
    "ownerEmployeeId", "salesChannel", "salesOrderNumber", "serviceWorkOrderIds", "sourceOpportunityId",
    "sourceOpportunityNumber", "state", "updatedAtMillis", "currency",
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
  assert.deepEqual(p.lines, [
    { lineId: "line-1", kind: "PART", ref: "PRT-1", orderedQty: 5, allocatedQty: 3, fulfilledQty: 2, billedQty: 1 },
  ]);
});

test("projectSalesOrder never exposes unitPrice or any other price field -- no pricing policy in this projection", () => {
  const p = projectSalesOrder("SO-1", baseDoc());
  assert.deepEqual(Object.keys(p.lines[0]).sort(), ["allocatedQty", "billedQty", "fulfilledQty", "kind", "lineId", "orderedQty", "ref"]);
  assert.equal("unitPrice" in p.lines[0], false);
  assert.equal("price" in p.lines[0], false);
  assert.equal("amount" in p.lines[0], false);
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
    { lineId: "line-1", kind: "PART", ref: "ok", orderedQty: 1, allocatedQty: 0, fulfilledQty: 0, billedQty: 0 },
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
