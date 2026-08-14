// P1.1 (Sales->Cash fulfillment spine) -- OFFLINE tests for the PURE applyFulfillmentAcceptance core, imported
// from compiled lib. Proves: fulfilledQty is ADDITIVE across partial calls (never inferred, never
// decremented); matching is by (ref,kind) not bare ref (the P1.7 find()-by-ref bug class); overage FAILS
// CLOSED (throws, never silently caps/clamps); an acceptance with no matching (ref,kind) line is not applied
// (and does not throw).
//
// Run: npm run build && node --test test/salesOrderFulfillmentWriteBack.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import {
  applyFulfillmentAcceptance,
  FulfillmentWriteBackError,
} from "../lib/salesOrder/salesOrderFulfillmentWriteBack.js";

const line = (kind, ref, orderedQty, fulfilledQty = 0) => ({ kind, ref, orderedQty, fulfilledQty });

test("partial accumulation across two calls: fulfilledQty is additive, never overwritten", () => {
  const lines = [line("PART", "P-1", 10)];
  const first = applyFulfillmentAcceptance(lines, [{ ref: "P-1", kind: "PART", qty: 3 }]);
  assert.equal(first.nextLines[0].fulfilledQty, 3);
  assert.deepEqual(first.appliedByRef, { "PART:P-1": 3 });

  const second = applyFulfillmentAcceptance(first.nextLines, [{ ref: "P-1", kind: "PART", qty: 4 }]);
  assert.equal(second.nextLines[0].fulfilledQty, 7); // 3 + 4, additive
  assert.deepEqual(second.appliedByRef, { "PART:P-1": 4 });

  // original input untouched (pure)
  assert.equal(lines[0].fulfilledQty, 0);
});

test("over-remaining acceptance FAILS CLOSED -- never fulfilledQty > orderedQty", () => {
  const lines = [line("PART", "P-1", 5, 4)]; // remaining = 1
  assert.throws(
    () => applyFulfillmentAcceptance(lines, [{ ref: "P-1", kind: "PART", qty: 2 }]),
    (e) => e instanceof FulfillmentWriteBackError && e.code === "OVERAGE"
  );
  // the throw must not have mutated the input
  assert.equal(lines[0].fulfilledQty, 4);
});

test("acceptance qty exactly equal to remainingQty is allowed (boundary, not overage)", () => {
  const lines = [line("PART", "P-1", 5, 4)]; // remaining = 1
  const { nextLines } = applyFulfillmentAcceptance(lines, [{ ref: "P-1", kind: "PART", qty: 1 }]);
  assert.equal(nextLines[0].fulfilledQty, 5);
});

test("no (ref,kind) match -> NOT applied to any line, not an error", () => {
  const lines = [line("PART", "P-1", 5, 0), line("EQUIPMENT_MODEL", "C713", 2, 0)];
  const { nextLines, appliedByRef, unmatched } = applyFulfillmentAcceptance(lines, [
    { ref: "P-999", kind: "PART", qty: 1 },
  ]);
  assert.deepEqual(nextLines, lines); // untouched
  assert.deepEqual(appliedByRef, {});
  assert.deepEqual(unmatched, [{ ref: "P-999", kind: "PART", qty: 1 }]);
});

test("matching is by (ref,kind), NOT bare ref -- same ref, different kind, must not collide", () => {
  // Two lines happen to share the same ref string but differ in kind.
  const lines = [line("PART", "SVC-1", 5, 0), line("SERVICE", "SVC-1", 2, 0)];
  const { nextLines } = applyFulfillmentAcceptance(lines, [{ ref: "SVC-1", kind: "SERVICE", qty: 2 }]);
  const part = nextLines.find((l) => l.kind === "PART");
  const service = nextLines.find((l) => l.kind === "SERVICE");
  assert.equal(part.fulfilledQty, 0); // untouched -- the PART line must NOT have absorbed this acceptance
  assert.equal(service.fulfilledQty, 2);
});

test("an explicit fulfillmentAccepted-style qty=0 or negative is rejected (QTY_INVALID)", () => {
  const lines = [line("SERVICE", "SVC-1", 2, 0)];
  for (const bad of [0, -1, NaN]) {
    assert.throws(
      () => applyFulfillmentAcceptance(lines, [{ ref: "SVC-1", kind: "SERVICE", qty: bad }]),
      (e) => e instanceof FulfillmentWriteBackError && e.code === "QTY_INVALID"
    );
  }
});

test("multiple acceptances in one call apply independently to their own matched lines", () => {
  const lines = [line("PART", "P-1", 10, 0), line("SERVICE", "SVC-1", 1, 0)];
  const { nextLines } = applyFulfillmentAcceptance(lines, [
    { ref: "P-1", kind: "PART", qty: 6 },
    { ref: "SVC-1", kind: "SERVICE", qty: 1 },
  ]);
  assert.equal(nextLines.find((l) => l.kind === "PART").fulfilledQty, 6);
  assert.equal(nextLines.find((l) => l.kind === "SERVICE").fulfilledQty, 1);
});
