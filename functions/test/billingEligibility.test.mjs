// Fulfillment → Finance seam — OFFLINE tests for the PURE billing-eligibility projection. Proves the honest
// states (NOT_YET / PARTIALLY_ELIGIBLE / ELIGIBLE / HELD / CANCELLED) and that it invents no billing policy.
import test from "node:test";
import assert from "node:assert/strict";
import { computeBillingEligibility } from "../lib/fulfillment/billingEligibility.js";

const line = (ref, orderedQty, fulfilledQty = 0) => ({ ref, orderedQty, fulfilledQty });

test("fully fulfilled ⇒ ELIGIBLE", () => {
  const r = computeBillingEligibility({ salesOrderState: "FULFILLED", lines: [line("C713", 5, 5)] });
  assert.equal(r.eligibility, "ELIGIBLE");
  assert.equal(r.fulfilledFraction, 1);
});

test("partially fulfilled ⇒ PARTIALLY_ELIGIBLE (Finance decides what/when)", () => {
  const r = computeBillingEligibility({ salesOrderState: "IN_FULFILLMENT", lines: [line("C713", 5, 4)] });
  assert.equal(r.eligibility, "PARTIALLY_ELIGIBLE");
  assert.equal(r.fulfilledTotal, 4);
  assert.equal(r.orderedTotal, 5);
});

test("nothing fulfilled ⇒ NOT_YET", () => {
  assert.equal(computeBillingEligibility({ salesOrderState: "CONFIRMED", lines: [line("C713", 5, 0)] }).eligibility, "NOT_YET");
});

test("blocked or additional-work ⇒ HELD (do not bill through a blocker)", () => {
  const blocked = computeBillingEligibility({ salesOrderState: "IN_FULFILLMENT", lines: [line("C713", 5, 5)], operationalBlocked: true });
  assert.equal(blocked.eligibility, "HELD");
  const extra = computeBillingEligibility({ salesOrderState: "IN_FULFILLMENT", lines: [line("C713", 5, 5)], additionalWorkPending: true });
  assert.equal(extra.eligibility, "HELD");
});

test("cancelled ⇒ CANCELLED regardless of fulfillment", () => {
  assert.equal(computeBillingEligibility({ salesOrderState: "CANCELLED", lines: [line("C713", 5, 5)] }).eligibility, "CANCELLED");
});

test("fulfilledQty is clamped to orderedQty (no over-fulfillment inflates eligibility)", () => {
  const r = computeBillingEligibility({ salesOrderState: "FULFILLED", lines: [line("C713", 5, 99)] });
  assert.equal(r.fulfilledTotal, 5);
  assert.equal(r.eligibility, "ELIGIBLE");
});
