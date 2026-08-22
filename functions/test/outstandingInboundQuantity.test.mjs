// OUTSTANDING INBOUND — what is still expected to arrive, not what was ordered.
//
// ============================ THE CONTRACT ============================
//
//   ordered 18, received 0   ->  onOrder 18
//   ordered 18, received 5   ->  onOrder 13
//   ordered 18, received 18  ->  onOrder 0, contributes no inbound
//
// ============================ WHY IT NEEDED FIXING ============================
//
// A canonical purchase order stores no receivedQuantity. The receipt command writes only
// version/updatedAt/status, and progress is DERIVED from committed receipts so it cannot drift from
// them. Reading `quantity` alone therefore reported the full order as still inbound forever.
//
// After a partial receipt that overstates supply — and an overstated inbound figure is the one that
// makes a live shortage look handled. A part with 13 units still coming and a part with 18 read
// identically, so the number that decides whether to expedite was the number that could not.
//
// A LEGACY order is different and stays different: it carries receivedQuantity ON the document and
// is one-shot by validation. Applying canonical receipt semantics to it would answer a question its
// shape never asked.
//
// The arithmetic is deriveReceiptState's, not re-implemented here. A second copy of a rule that
// already has an owner is free to disagree with it.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REPO = path.resolve(import.meta.dirname, "../..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;
const { sumOpenOrderedQuantity } = await import(L("functions/lib/inventory/partBalanceReadService.js"));

/** A realistic STORED canonical purchase order — keys as Firestore holds them. */
const CANON = Object.freeze({
  id: "po-1",
  supplierId: "cw-sup-001",
  status: "SENT",
  items: [{ lineId: "L1", partId: "CW-P-0003", quantity: 18 }],
  version: 3,
});

/** Committed receipts against po-1, one entry per arrival. */
const receipts = (...quantities) => new Map([[
  "po-1",
  quantities.map((q, i) => ({ receivingId: `r${i}`, lines: [{ lineId: "L1", receivedQuantity: q }] })),
]]);

test("partial receipt reduces outstanding; completion removes it entirely", () => {
  assert.equal(sumOpenOrderedQuantity([CANON], "CW-P-0003"), 18, "nothing received yet");
  assert.equal(sumOpenOrderedQuantity([CANON], "CW-P-0003", receipts(5)), 13, "18 ordered, 5 received");
  assert.equal(sumOpenOrderedQuantity([CANON], "CW-P-0003", receipts(18)), 0, "fully received contributes nothing");
});

test("the stored status is untouched -- outstanding shrinks by derivation, not by a status change", () => {
  // A partial receipt deliberately leaves the order SENT. If outstanding depended on a persisted
  // PARTIALLY_RECEIVED the order would drop out of the receivable set and could never be completed.
  assert.equal(CANON.status, "SENT");
  assert.ok(sumOpenOrderedQuantity([CANON], "CW-P-0003", receipts(5)) < 18);
});

test("multiple committed receipts against one line all count", () => {
  // Goods arrive in whatever batches the supplier sends; one receipt per line is an assumption, not
  // a rule.
  assert.equal(sumOpenOrderedQuantity([CANON], "CW-P-0003", receipts(4, 3, 5)), 6, "18 - (4+3+5)");
});

test("receiving one line does not reduce another line's outstanding", () => {
  const twoLines = {
    id: "po-2", supplierId: "s", status: "SENT",
    items: [{ lineId: "L1", partId: "PART-A", quantity: 10 }, { lineId: "L2", partId: "PART-B", quantity: 7 }],
  };
  const onlyA = new Map([["po-2", [{ receivingId: "r1", lines: [{ lineId: "L1", receivedQuantity: 10 }] }]]]);
  assert.equal(sumOpenOrderedQuantity([twoLines], "PART-A", onlyA), 0);
  assert.equal(sumOpenOrderedQuantity([twoLines], "PART-B", onlyA), 7, "receiving PART-A must not touch PART-B");
});

test("two open orders for one part aggregate, never collapse to the first", () => {
  const a = { id: "po-a", status: "SENT", items: [{ lineId: "L1", partId: "CW-P-0003", quantity: 10 }] };
  const b = { id: "po-b", status: "SENT", items: [{ lineId: "L1", partId: "CW-P-0003", quantity: 4 }] };
  const partial = new Map([["po-a", [{ receivingId: "r1", lines: [{ lineId: "L1", receivedQuantity: 3 }] }]]]);
  assert.equal(sumOpenOrderedQuantity([a, b], "CW-P-0003", partial), 11, "(10-3) + 4");
});

test("a replay nets once, and a refused attempt nets not at all", () => {
  // Receipts are keyed by receivingId, so an idempotent retry is the SAME committed record and
  // appears once however many times it was attempted. Netting it twice would invent supply that
  // never arrived.
  const once = new Map([["po-1", [{ receivingId: "r-same", lines: [{ lineId: "L1", receivedQuantity: 5 }] }]]]);
  assert.equal(sumOpenOrderedQuantity([CANON], "CW-P-0003", once), 13);
  // A refused or over-receipt attempt commits nothing.
  assert.equal(sumOpenOrderedQuantity([CANON], "CW-P-0003", new Map([["po-1", []]])), 18,
    "a refused attempt must leave inbound unchanged");
});

test("outstanding is clamped: 0 <= outstanding <= ordered", () => {
  // Over-receipt is rejected before any write, so a negative remainder could only come from
  // historical data -- and a negative amount "still owed" reads as the opposite of what it means.
  assert.equal(sumOpenOrderedQuantity([CANON], "CW-P-0003", receipts(999)), 0);
  const v = sumOpenOrderedQuantity([CANON], "CW-P-0003", receipts(1));
  assert.ok(v >= 0 && v <= 18, `outstanding ${v} fell outside [0, 18]`);
});

test("LEGACY orders keep netting from the document, not from receipts", () => {
  const legacy = { partId: "CW-P-0003", quantity: 18, receivedQuantity: 9 };
  assert.equal(sumOpenOrderedQuantity([legacy], "CW-P-0003"), 9);
  // Receipts belonging to a different order must not touch it.
  assert.equal(sumOpenOrderedQuantity([legacy], "CW-P-0003", receipts(5)), 9);
});

test("UNKNOWN survives: an unreadable order never becomes a measured zero", () => {
  // A canonical order that fails normalization contributes nothing AND does not mark the part as
  // seen. Otherwise "we could not read the order" would be reported as "nothing is on order", and
  // those are opposite facts.
  assert.equal(sumOpenOrderedQuantity([{ id: "bad", status: "SENT", items: [{}] }], "CW-P-0003"), null);
  assert.equal(sumOpenOrderedQuantity([], "CW-P-0003"), null);
});

test("MUTATION: without netting, a partially received order still claims its full quantity", () => {
  // Reconstructs the defect. If this ever equals 18 again with receipts supplied, netting is gone.
  const netted = sumOpenOrderedQuantity([CANON], "CW-P-0003", receipts(5));
  const unnetted = sumOpenOrderedQuantity([CANON], "CW-P-0003");
  assert.notEqual(netted, unnetted, "receipts are not being netted -- outstanding ignores what arrived");
  assert.equal(unnetted - netted, 5, "the difference must be exactly what was received");
});
