// Multi-line purchase order — PURE normalization + derivation. No emulator, no I/O.
//
// Phase B is design work; these tests are what make the design verifiable before any live contract
// moves. They exercise the PROPOSED compatibility layer only — nothing here is wired to a command,
// a callable, or a document.
//
// Run: node --test test/purchaseOrderNormalization.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeLegacyPurchaseOrder,
  normalizeCanonicalPurchaseOrder,
  deriveReceiptState,
  validateProposedReceipt,
  PurchaseOrderNormalizationError,
  LEGACY_LINE_ID,
  PO_LINE_STATE,
} from "../lib/purchasing/purchaseOrderNormalization.js";

const legacyDoc = (over = {}) => ({
  reorderRequestId: "REQ-1",
  partId: "PRT-1001",
  supplierName: "Acme Supply",
  externalPoNumber: "PO-9",
  orderedQuantity: 5,
  orderedDate: "2026-08-01",
  expectedArrivalDate: null,
  status: "ORDERED",
  createdBy: "u1",
  createdAt: 1,
  ...over,
});

const canonicalDoc = (over = {}) => ({
  supplierId: "SUP-1",
  status: "SENT",
  items: [
    { lineId: "L1", partId: "PRT-1", quantity: 4 },
    { lineId: "L2", partId: "PRT-2", quantity: 2 },
  ],
  ...over,
});

const throwsCode = (fn, code) =>
  assert.throws(fn, (e) => e instanceof PurchaseOrderNormalizationError && e.code === code, `expected ${code}`);

// ─────────────────────────────────────────────── legacy → one canonical line

test("a legacy purchase order normalizes to exactly one canonical line", () => {
  const po = normalizeLegacyPurchaseOrder("REQ-1", legacyDoc());
  assert.equal(po.purchaseOrderId, "REQ-1");
  assert.equal(po.origin, "LEGACY_REORDER");
  assert.equal(po.lines.length, 1);
  // FIN-BLOCK-003A: a legacy purchase order carrying no money normalizes to an UNPRICED line. The
  // nulls are the point of this assertion, not incidental to it — an unpriced line must not arrive
  // downstream as a zero-cost one.
  assert.deepEqual(
    { ...po.lines[0] },
    { lineId: LEGACY_LINE_ID, partId: "PRT-1001", quantity: 5, unitPriceMinor: null, currency: null },
  );
});

test("the legacy line id is DETERMINISTIC — the same for every document, every read", () => {
  // A receipt addresses (purchaseOrderId, lineId). If the line id varied, a receipt recorded today
  // would reference a line that no longer resolves tomorrow.
  const a = normalizeLegacyPurchaseOrder("REQ-1", legacyDoc());
  const b = normalizeLegacyPurchaseOrder("REQ-1", legacyDoc());
  const c = normalizeLegacyPurchaseOrder("REQ-2", legacyDoc({ partId: "PRT-9", orderedQuantity: 1 }));
  assert.equal(a.lines[0].lineId, b.lines[0].lineId);
  assert.equal(a.lines[0].lineId, c.lines[0].lineId, "the id is per-line, and a legacy PO has exactly one");
});

test("a legacy purchase order has NO supplierId, and says so rather than guessing", () => {
  // It carries supplierName (a string), not a Supplier Master id. A name is not an id.
  const po = normalizeLegacyPurchaseOrder("REQ-1", legacyDoc());
  assert.equal(po.supplierId, null);
  assert.equal(po.supplierName, "Acme Supply");
});

test("legacy normalization rejects an unusable document rather than inventing a line", () => {
  throwsCode(() => normalizeLegacyPurchaseOrder("", legacyDoc()), "PO_ID_INVALID");
  throwsCode(() => normalizeLegacyPurchaseOrder("REQ-1", undefined), "PO_MALFORMED");
  throwsCode(() => normalizeLegacyPurchaseOrder("REQ-1", legacyDoc({ partId: "" })), "PO_PART_INVALID");
  for (const bad of [0, -1, 1.5 * 0, "5", null, NaN]) {
    throwsCode(() => normalizeLegacyPurchaseOrder("REQ-1", legacyDoc({ orderedQuantity: bad })), "PO_QUANTITY_INVALID");
  }
});

test("normalization NEVER mutates the source document", () => {
  // A read that repairs what it reads is how a legacy document silently becomes a new one.
  const doc = legacyDoc();
  const before = JSON.stringify(doc);
  normalizeLegacyPurchaseOrder("REQ-1", doc);
  assert.equal(JSON.stringify(doc), before);
});

// ─────────────────────────────────────────────── canonical multi-line

test("a canonical purchase order normalizes every line, in order", () => {
  const po = normalizeCanonicalPurchaseOrder("PO-1", canonicalDoc());
  assert.equal(po.origin, "CANONICAL");
  assert.equal(po.supplierId, "SUP-1");
  assert.deepEqual(po.lines.map((l) => l.lineId), ["L1", "L2"]);
  assert.deepEqual(po.lines.map((l) => l.quantity), [4, 2]);
});

test("a canonical line with no lineId falls back to a deterministic ordinal", () => {
  // procurementService's existing items carry no lineId. They must normalize without first being
  // rewritten, or zero-backfill is not actually zero.
  const po = normalizeCanonicalPurchaseOrder("PO-1", canonicalDoc({
    items: [{ partId: "PRT-1", quantity: 1 }, { partId: "PRT-2", quantity: 2 }],
  }));
  assert.deepEqual(po.lines.map((l) => l.lineId), ["L1", "L2"]);
});

test("DUPLICATE line ids are rejected, never de-duplicated", () => {
  // A receipt says "3 against L2". Two lines called L2 make that ambiguous, and silently collapsing
  // them picks an answer nobody asked for.
  throwsCode(
    () => normalizeCanonicalPurchaseOrder("PO-1", canonicalDoc({
      items: [{ lineId: "L1", partId: "PRT-1", quantity: 1 }, { lineId: "L1", partId: "PRT-2", quantity: 2 }],
    })),
    "PO_LINE_DUPLICATE"
  );
});

test("a canonical order with no lines is rejected", () => {
  throwsCode(() => normalizeCanonicalPurchaseOrder("PO-1", canonicalDoc({ items: [] })), "PO_NO_LINES");
  throwsCode(() => normalizeCanonicalPurchaseOrder("PO-1", canonicalDoc({ items: undefined })), "PO_NO_LINES");
});

test("an invalid quantity on ANY line rejects the whole order", () => {
  throwsCode(
    () => normalizeCanonicalPurchaseOrder("PO-1", canonicalDoc({
      items: [{ lineId: "L1", partId: "PRT-1", quantity: 4 }, { lineId: "L2", partId: "PRT-2", quantity: 0 }],
    })),
    "PO_QUANTITY_INVALID"
  );
});

// ─────────────────────────────────────────────── cumulative + remaining

const po2 = () => normalizeCanonicalPurchaseOrder("PO-1", canonicalDoc());

test("with no receipts, everything is NOT_RECEIVED and remaining equals ordered", () => {
  const d = deriveReceiptState(po2(), []);
  assert.equal(d.state, PO_LINE_STATE.NOT_RECEIVED);
  assert.equal(d.fullyReceived, false);
  assert.deepEqual(d.lines.map((l) => l.remainingQuantity), [4, 2]);
  assert.deepEqual(d.lines.map((l) => l.receivedQuantity), [0, 0]);
});

test("receipts ACCUMULATE across separate events", () => {
  // The whole point of deriving rather than storing: two receipts at different times, no counter to
  // lose an update on.
  const d = deriveReceiptState(po2(), [
    { receivingId: "rcv_a", lines: [{ lineId: "L1", receivedQuantity: 1 }] },
    { receivingId: "rcv_b", lines: [{ lineId: "L1", receivedQuantity: 2 }] },
  ]);
  assert.equal(d.lines[0].receivedQuantity, 3);
  assert.equal(d.lines[0].remainingQuantity, 1);
  assert.equal(d.lines[0].state, PO_LINE_STATE.PARTIALLY_RECEIVED);
});

test("a line completes when its ordered quantity is satisfied", () => {
  const d = deriveReceiptState(po2(), [
    { receivingId: "rcv_a", lines: [{ lineId: "L1", receivedQuantity: 4 }] },
  ]);
  assert.equal(d.lines[0].state, PO_LINE_STATE.RECEIVED);
  assert.equal(d.lines[0].remainingQuantity, 0);
});

test("remaining is CLAMPED at zero — a negative remainder would read as an amount still owed", () => {
  const d = deriveReceiptState(po2(), [
    { receivingId: "rcv_a", lines: [{ lineId: "L1", receivedQuantity: 99 }] },
  ]);
  assert.equal(d.lines[0].remainingQuantity, 0);
  assert.equal(d.lines[0].state, PO_LINE_STATE.RECEIVED);
});

test("a receipt naming an unknown line does not break the derivation", () => {
  // A stored receipt is a fact that already happened. Throwing here would make an unrelated PO
  // unreadable because of one bad historical record; rejecting an unknown line is the WRITE path's
  // job, where refusing it still prevents something.
  const d = deriveReceiptState(po2(), [
    { receivingId: "rcv_a", lines: [{ lineId: "GHOST", receivedQuantity: 5 }, { lineId: "L1", receivedQuantity: 1 }] },
  ]);
  assert.equal(d.lines[0].receivedQuantity, 1);
  assert.equal(d.state, PO_LINE_STATE.PARTIALLY_RECEIVED);
});

// ─────────────────────────────────────────────── aggregate PO state

test("PO state is NOT_RECEIVED only when EVERY line is untouched", () => {
  const d = deriveReceiptState(po2(), [{ receivingId: "r", lines: [{ lineId: "L2", receivedQuantity: 1 }] }]);
  assert.equal(d.state, PO_LINE_STATE.PARTIALLY_RECEIVED, "one touched line makes the PO partial");
});

test("PO state is RECEIVED only when EVERY line is satisfied", () => {
  const partial = deriveReceiptState(po2(), [
    { receivingId: "r", lines: [{ lineId: "L1", receivedQuantity: 4 }] },
  ]);
  assert.equal(partial.state, PO_LINE_STATE.PARTIALLY_RECEIVED, "one complete line is not a complete PO");
  assert.equal(partial.fullyReceived, false);

  const full = deriveReceiptState(po2(), [
    { receivingId: "r", lines: [{ lineId: "L1", receivedQuantity: 4 }, { lineId: "L2", receivedQuantity: 2 }] },
  ]);
  assert.equal(full.state, PO_LINE_STATE.RECEIVED);
  assert.equal(full.fullyReceived, true);
});

test("fullyReceived is what may close the source — and it is false until it is true", () => {
  // This flag replaces the unconditional ORDERED -> RECEIVED transition. If it were ever true early,
  // a partially-received PO would close with stock still owed.
  const steps = [
    [[{ lineId: "L1", receivedQuantity: 1 }], false],
    [[{ lineId: "L1", receivedQuantity: 3 }], false],
    [[{ lineId: "L2", receivedQuantity: 1 }], false],
    [[{ lineId: "L2", receivedQuantity: 1 }], true],
  ];
  const receipts = [];
  steps.forEach(([lines, expected], i) => {
    receipts.push({ receivingId: `rcv_${i}`, lines });
    assert.equal(deriveReceiptState(po2(), receipts).fullyReceived, expected, `after receipt ${i}`);
  });
});

test("a LEGACY purchase order derives exactly like a one-line canonical one", () => {
  // The legacy case is not a special path — it is the one-line case of the general one.
  const legacy = normalizeLegacyPurchaseOrder("REQ-1", legacyDoc({ orderedQuantity: 2 }));
  const partial = deriveReceiptState(legacy, [
    { receivingId: "r", lines: [{ lineId: LEGACY_LINE_ID, receivedQuantity: 1 }] },
  ]);
  assert.equal(partial.state, PO_LINE_STATE.PARTIALLY_RECEIVED);
  const full = deriveReceiptState(legacy, [
    { receivingId: "r", lines: [{ lineId: LEGACY_LINE_ID, receivedQuantity: 2 }] },
  ]);
  assert.equal(full.fullyReceived, true, "today's full single-line receipt still completes exactly as it does now");
});

// ─────────────────────────────────────────────── proposed receipt validation

const derived = () => deriveReceiptState(po2(), []);

test("a partial receipt is PERMITTED", () => {
  assert.deepEqual(validateProposedReceipt(derived(), [{ lineId: "L1", receivedQuantity: 1 }]), { valid: true });
});

test("OVER-RECEIPT is rejected by default", () => {
  const r = validateProposedReceipt(derived(), [{ lineId: "L1", receivedQuantity: 5 }]);
  assert.equal(r.valid, false);
  assert.equal(r.code, "RECEIPT_OVER_RECEIPT");
  assert.equal(r.lineId, "L1");
});

test("over-receipt is measured against REMAINING, not ordered", () => {
  const afterOne = deriveReceiptState(po2(), [{ receivingId: "r", lines: [{ lineId: "L1", receivedQuantity: 3 }] }]);
  assert.equal(validateProposedReceipt(afterOne, [{ lineId: "L1", receivedQuantity: 1 }]).valid, true);
  assert.equal(validateProposedReceipt(afterOne, [{ lineId: "L1", receivedQuantity: 2 }]).code, "RECEIPT_OVER_RECEIPT");
});

test("an UNKNOWN line is rejected on the write path", () => {
  assert.equal(validateProposedReceipt(derived(), [{ lineId: "GHOST", receivedQuantity: 1 }]).code, "RECEIPT_LINE_UNKNOWN");
});

test("the SAME line twice in ONE receipt is rejected", () => {
  const r = validateProposedReceipt(derived(), [
    { lineId: "L1", receivedQuantity: 1 },
    { lineId: "L1", receivedQuantity: 1 },
  ]);
  assert.equal(r.code, "RECEIPT_LINE_DUPLICATE");
});

test("an empty or invalid receipt is rejected", () => {
  assert.equal(validateProposedReceipt(derived(), []).code, "RECEIPT_NO_LINES");
  assert.equal(validateProposedReceipt(derived(), [{ lineId: "L1", receivedQuantity: 0 }]).code, "RECEIPT_QUANTITY_INVALID");
  assert.equal(validateProposedReceipt(derived(), [{ lineId: "", receivedQuantity: 1 }]).code, "RECEIPT_LINE_INVALID");
});

test("SERIAL observations must match the quantity exactly, and be distinct", () => {
  // One physical unit, one serial, one serialized asset — the invariant receivingValidation.ts
  // already enforces for the single-line case, carried into the multi-line one.
  const ok = validateProposedReceipt(derived(), [{ lineId: "L1", receivedQuantity: 2, serialNumbers: ["A", "B"] }]);
  assert.deepEqual(ok, { valid: true });

  assert.equal(
    validateProposedReceipt(derived(), [{ lineId: "L1", receivedQuantity: 2, serialNumbers: ["A"] }]).code,
    "RECEIPT_SERIAL_COUNT_MISMATCH"
  );
  assert.equal(
    validateProposedReceipt(derived(), [{ lineId: "L1", receivedQuantity: 2, serialNumbers: ["A", "A"] }]).code,
    "RECEIPT_SERIAL_DUPLICATE"
  );
});

test("a multi-line receipt validates every line, and one bad line fails the batch", () => {
  const r = validateProposedReceipt(derived(), [
    { lineId: "L1", receivedQuantity: 1 },
    { lineId: "L2", receivedQuantity: 99 },
  ]);
  assert.equal(r.valid, false);
  assert.equal(r.lineId, "L2", "the blocked line is NAMED, never silently dropped");
});

test("derivation returns frozen values — a caller cannot mutate the result into a lie", () => {
  const d = derived();
  assert.throws(() => { d.lines[0].receivedQuantity = 99; }, TypeError);
  assert.throws(() => { d.lines.push({}); }, TypeError);
});
