// Sales Order timestamp projection — PURE, no emulator required.
//
// THE DEFECT THIS PINS. projectSalesOrder used to read `data.createdAtMillis` and
// `data.updatedAtMillis` — field names no writer has ever produced.
// createSalesOrderFromOpportunity writes `createdAt` and `updatedAt` as server Timestamps,
// so the projection was handed `undefined` and returned null every time.
//
// Nothing broke visibly, which is precisely why it survived: the read dutifully reported
// "this order has no creation date" for all 14 sandbox orders, and no consumer existed to
// notice. It would have surfaced as a column of em dashes the first time a timestamp was
// displayed — data that looks absent rather than wrong, which is the harder kind to catch.
//
// These are pure projection assertions on purpose. The emulator-backed index tests
// (salesOrderIndexRead.test.mjs) are a separate, required gate before promotion; a
// conversion bug in a pure function should not need a database to catch, and needing one is
// how it went unnoticed in the first place.
//
// Run: node --test test/salesOrderTimestampProjection.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { projectSalesOrder } from "../lib/salesOrder/salesOrderReadService.js";

// A stand-in for a Firestore Timestamp: the projection duck-types on `toMillis`, because a
// callable has to serialize and cannot return a Timestamp over the wire.
const timestamp = (millis) => ({ toMillis: () => millis });

const doc = (overrides = {}) => ({
  salesOrderNumber: "SO-2026-000001",
  accountId: "acct-1",
  state: "CONFIRMED",
  lines: [],
  ...overrides,
});

test("createdAt / updatedAt Timestamps project to epoch millis", () => {
  const p = projectSalesOrder("so-1", doc({
    createdAt: timestamp(1_755_000_000_000),
    updatedAt: timestamp(1_755_000_900_000),
  }));
  assert.equal(p.createdAtMillis, 1_755_000_000_000);
  assert.equal(p.updatedAtMillis, 1_755_000_900_000);
});

test("the OLD field names are not read — a doc carrying only *Millis projects null", () => {
  // Directly pins the regression: if someone re-points the projection at `createdAtMillis`,
  // this passes silently for real documents (which lack it) and fails here.
  const p = projectSalesOrder("so-2", doc({
    createdAtMillis: 1_755_000_000_000,
    updatedAtMillis: 1_755_000_900_000,
  }));
  assert.equal(p.createdAtMillis, null, "createdAtMillis is not a stored field; nothing writes it");
  assert.equal(p.updatedAtMillis, null, "updatedAtMillis is not a stored field; nothing writes it");
});

test("a document with no timestamps projects null rather than throwing or fabricating", () => {
  const p = projectSalesOrder("so-3", doc());
  assert.equal(p.createdAtMillis, null);
  assert.equal(p.updatedAtMillis, null);
});

test("a malformed timestamp projects null — never NaN, never a fabricated date", () => {
  // A string, a number, and an object without toMillis are all things a legacy or
  // hand-edited document could hold. None may become a plausible-looking date.
  for (const bad of ["2026-08-20", 1_755_000_000_000, {}, null, undefined, { toMillis: "nope" }]) {
    const p = projectSalesOrder("so-4", doc({ createdAt: bad, updatedAt: bad }));
    assert.equal(p.createdAtMillis, null, `createdAt=${JSON.stringify(bad)} must project null`);
    assert.equal(p.updatedAtMillis, null, `updatedAt=${JSON.stringify(bad)} must project null`);
  }
});

test("correcting the timestamps did not disturb the rest of the projection", () => {
  const p = projectSalesOrder("so-5", doc({
    customerPO: "PO-77",
    sourceOpportunityNumber: "OPP-2026-000009",
    createdAt: timestamp(42),
  }));
  assert.equal(p.id, "so-5");
  assert.equal(p.salesOrderNumber, "SO-2026-000001");
  assert.equal(p.customerPO, "PO-77");
  assert.equal(p.sourceOpportunityNumber, "OPP-2026-000009");
  assert.equal(p.state, "CONFIRMED");
  assert.equal(p.createdAtMillis, 42);
});
