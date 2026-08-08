// Commercial Finance — Billing / AR — PURE foundation tests (node:test). Proves the amounts-free invoice
// lifecycle, the factual (policy-free) AR position, and the fail-closed operations→Finance candidate. Nothing
// here computes an amount / tax / revenue / aging bucket — those are deferred material decisions.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  INVOICE_STATES, canTransitionInvoice, isTerminalInvoiceState,
  deriveArPosition, invoiceCandidateFromBillingEligibility, arPositionTone,
} from "../src/domain/commercialFinance.js";

const DAY = 24 * 60 * 60 * 1000;

test("invoice lifecycle: legal transitions; PAID/VOID terminal", () => {
  assert.deepEqual([...INVOICE_STATES], ["DRAFT", "ISSUED", "SENT", "PARTIALLY_PAID", "PAID", "VOID"]);
  assert.equal(canTransitionInvoice("DRAFT", "ISSUED"), true);
  assert.equal(canTransitionInvoice("ISSUED", "SENT"), true);
  assert.equal(canTransitionInvoice("SENT", "PAID"), true);
  assert.equal(canTransitionInvoice("DRAFT", "PAID"), false); // must be issued first
  assert.equal(canTransitionInvoice("PAID", "SENT"), false); // terminal
  assert.equal(isTerminalInvoiceState("PAID"), true);
  assert.equal(isTerminalInvoiceState("VOID"), true);
  assert.equal(isTerminalInvoiceState("SENT"), false);
});

test("AR position is factual: CURRENT before due, OVERDUE (+daysOverdue) after, PAID/VOID/UNKNOWN honest", () => {
  const now = 10 * DAY;
  assert.deepEqual(deriveArPosition({ state: "SENT", dueDate: 12 * DAY }, now), { position: "CURRENT", daysOverdue: 0 });
  assert.deepEqual(deriveArPosition({ state: "SENT", dueDate: 7 * DAY }, now), { position: "OVERDUE", daysOverdue: 3 });
  assert.deepEqual(deriveArPosition({ state: "PARTIALLY_PAID", dueDate: 5 * DAY }, now), { position: "OVERDUE", daysOverdue: 5 });
  assert.equal(deriveArPosition({ state: "PAID", dueDate: 1 * DAY }, now).position, "PAID");
  assert.equal(deriveArPosition({ state: "VOID" }, now).position, "VOID");
  // missing due date ⇒ UNKNOWN, never assumed current
  assert.equal(deriveArPosition({ state: "SENT" }, now).position, "UNKNOWN");
  assert.equal(deriveArPosition(null, now).position, "UNKNOWN");
});

test("AR position does NOT compute aging buckets (policy) — only the factual daysOverdue", () => {
  const r = deriveArPosition({ state: "SENT", dueDate: 0 }, 45 * DAY);
  assert.equal(r.position, "OVERDUE");
  assert.equal(r.daysOverdue, 45);
  assert.equal("agingBucket" in r, false); // buckets are a deferred Finance policy decision
});

const LINES = [{ ref: "L1", orderedQty: 5, fulfilledQty: 5 }, { ref: "L2", orderedQty: 3, fulfilledQty: 1 }];

test("ELIGIBLE ⇒ candidate with fulfilled billable quantities, NO amounts", () => {
  const c = invoiceCandidateFromBillingEligibility({ eligibility: "ELIGIBLE" }, LINES);
  assert.equal(c.status, "CANDIDATE");
  assert.deepEqual(c.billable, [{ ref: "L1", billableQty: 5 }, { ref: "L2", billableQty: 1 }]);
  // no amount/price/tax fields anywhere
  for (const l of c.billable) assert.equal("amount" in l || "price" in l || "tax" in l, false);
});

test("PARTIALLY_ELIGIBLE ⇒ candidate over the fulfilled portion; finality deferred to Finance", () => {
  const c = invoiceCandidateFromBillingEligibility({ eligibility: "PARTIALLY_ELIGIBLE" }, LINES);
  assert.equal(c.status, "CANDIDATE");
  assert.equal(c.finalityDeferredToFinance, true);
  assert.deepEqual(c.billable, [{ ref: "L1", billableQty: 5 }, { ref: "L2", billableQty: 1 }]);
});

test("HELD / NOT_YET / CANCELLED ⇒ NO candidate (fail-closed)", () => {
  for (const e of ["HELD", "NOT_YET", "CANCELLED", "UNKNOWN", undefined]) {
    const c = invoiceCandidateFromBillingEligibility({ eligibility: e }, LINES);
    assert.equal(c.status, "NONE");
    assert.deepEqual(c.billable, []);
  }
});

test("candidate with nothing fulfilled ⇒ NONE (no zero-qty billable rows)", () => {
  const c = invoiceCandidateFromBillingEligibility({ eligibility: "ELIGIBLE" }, [{ ref: "L1", orderedQty: 5, fulfilledQty: 0 }]);
  assert.equal(c.status, "NONE");
});

test("tones are factual", () => {
  assert.equal(arPositionTone("PAID"), "positive");
  assert.equal(arPositionTone("OVERDUE"), "attention");
  assert.equal(arPositionTone("CURRENT"), "info");
  assert.equal(arPositionTone("UNKNOWN"), "unknown");
});
