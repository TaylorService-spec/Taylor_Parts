// Finance — Billing Queue projection (F4). Pure tests. Proves the queue is a READ over two governed
// authorities (eligibility seam + billedQty projection), that unbilled-eligible mirrors issueInvoice's
// billableQty cap formula, that over-billed anomalies surface as reconciliation reasons (never normalized),
// that a missing governed company is surfaced (not hidden), and that no amount/price exists anywhere.
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveBillingQueueEntry, BILLING_QUEUE_STATUSES } from "../lib/finance/billingQueue.js";

const so = (over = {}) => ({
  salesOrderId: "SO-1",
  salesOrderState: "IN_FULFILLMENT",
  operatingCompanyId: "taylor",
  lines: [{ ref: "L1", orderedQty: 10, fulfilledQty: 10, billedQty: 0 }],
  ...over,
});

test("statuses are the closed governed set", () => {
  assert.deepEqual([...BILLING_QUEUE_STATUSES], ["NOT_READY", "READY_TO_BILL", "PARTIALLY_READY", "HELD", "CANCELLED", "FULLY_BILLED"]);
});

test("fully fulfilled + nothing billed ⇒ READY_TO_BILL with the full unbilled quantity", () => {
  const e = deriveBillingQueueEntry(so());
  assert.equal(e.status, "READY_TO_BILL");
  assert.equal(e.unbilledEligibleQty, 10);
  assert.equal(e.billedQty, 0);
  assert.equal(e.operatingCompanyId, "taylor");
});

test("partially fulfilled ⇒ PARTIALLY_READY; unbilled = min(ordered,fulfilled) − billed per line", () => {
  const e = deriveBillingQueueEntry(so({ lines: [{ ref: "L1", orderedQty: 10, fulfilledQty: 4, billedQty: 1 }] }));
  assert.equal(e.status, "PARTIALLY_READY");
  assert.equal(e.unbilledEligibleQty, 3); // min(10,4) − 1
  assert.equal(e.eligibility.eligibility, "PARTIALLY_ELIGIBLE");
});

test("everything eligible already billed ⇒ FULLY_BILLED (not READY, not NOT_READY)", () => {
  const e = deriveBillingQueueEntry(so({ lines: [{ ref: "L1", orderedQty: 10, fulfilledQty: 10, billedQty: 10 }] }));
  assert.equal(e.status, "FULLY_BILLED");
  assert.equal(e.unbilledEligibleQty, 0);
  assert.equal(e.billedQty, 10);
});

test("partially billed remainder stays READY_TO_BILL", () => {
  const e = deriveBillingQueueEntry(so({ lines: [{ ref: "L1", orderedQty: 10, fulfilledQty: 10, billedQty: 6 }] }));
  assert.equal(e.status, "READY_TO_BILL");
  assert.equal(e.unbilledEligibleQty, 4);
});

test("nothing fulfilled ⇒ NOT_READY (never billable by inference)", () => {
  const e = deriveBillingQueueEntry(so({ lines: [{ ref: "L1", orderedQty: 10, fulfilledQty: 0 }] }));
  assert.equal(e.status, "NOT_READY");
  assert.equal(e.unbilledEligibleQty, 0);
});

test("operational blocker / unresolved exception ⇒ HELD even with unbilled eligible quantity", () => {
  const held = deriveBillingQueueEntry(so({ operationalBlocked: true }));
  assert.equal(held.status, "HELD");
  const exception = deriveBillingQueueEntry(so({ additionalWorkPending: true }));
  assert.equal(exception.status, "HELD");
});

test("cancelled order ⇒ CANCELLED regardless of billed position", () => {
  const e = deriveBillingQueueEntry(so({ salesOrderState: "CANCELLED", lines: [{ ref: "L1", orderedQty: 10, fulfilledQty: 10, billedQty: 4 }] }));
  assert.equal(e.status, "CANCELLED");
});

test("over-billed line surfaces a reconciliation reason and is never normalized into negative unbilled", () => {
  const e = deriveBillingQueueEntry(so({
    lines: [
      { ref: "L1", orderedQty: 10, fulfilledQty: 5, billedQty: 8 }, // billed > fulfilled-eligible
      { ref: "L2", orderedQty: 10, fulfilledQty: 10, billedQty: 0 },
    ],
  }));
  assert.equal(e.unbilledEligibleQty, 10); // L1 clamped to 0, not −3
  assert.ok(e.reasons.some((r) => r.includes("L1") && r.includes("reconciliation")));
});

test("missing governed company is SURFACED (queue still shows the order; issuance would refuse)", () => {
  const e = deriveBillingQueueEntry(so({ operatingCompanyId: null }));
  assert.equal(e.operatingCompanyId, null);
  assert.ok(e.reasons.some((r) => r.includes("COMPANY_REQUIRED")));
  assert.equal(e.status, "READY_TO_BILL"); // visibility of the backlog is not suppressed
});

test("no amount or price exists anywhere on a queue entry (quantities and states only)", () => {
  const e = deriveBillingQueueEntry(so());
  const flat = JSON.stringify(e).toLowerCase();
  for (const forbidden of ["amount", "price", "minor", "total", "tax", "discount"]) {
    assert.equal(flat.includes(forbidden), false, `queue entry must not carry "${forbidden}"`);
  }
});
