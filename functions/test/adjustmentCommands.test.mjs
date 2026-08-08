// Finance — invoice adjustment core (Owner §7). Pure tests. Proves credit/charge/write-off are explicit linked
// records feeding the DERIVED outstanding (never rewriting the invoice), that write-off/credit cannot exceed
// outstanding, that the invoice STATE is not changed (a write-off is not "PAID"), and fail-closed guards.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAdjustment, ADJUSTMENT_TYPES, AdjustmentCommandError } from "../lib/finance/adjustmentCommands.js";

const inv = (over = {}) => ({ currency: "USD", state: "ISSUED", totalMinor: 10000, ...over });
const input = (over = {}) => ({ type: "CREDIT_MEMO", invoiceId: "INVID", companyId: "taylor", accountId: "A1", currency: "USD", amountMinor: 3000, reason: "goodwill", effectiveDate: "2026-08-08", ...over });
const DEPS = { nowMillis: 1_700_000_100_000 };

test("recognized types (REFUND is intentionally not here — it is payment-side)", () => {
  assert.deepEqual([...ADJUSTMENT_TYPES], ["CREDIT_MEMO", "DEBIT_CHARGE", "WRITE_OFF"]);
});

test("CREDIT_MEMO reduces owed via credits; explicit linked record; invoice state UNCHANGED", () => {
  const r = buildAdjustment(input({ type: "CREDIT_MEMO", amountMinor: 3000 }), inv(), DEPS);
  assert.equal(r.adjustment.type, "CREDIT_MEMO");
  assert.equal(r.adjustment.reason, "goodwill");
  assert.equal(r.adjustment.effectiveDate, "2026-08-08");
  assert.equal(r.invoicePatch.creditsMinor, 3000);
  assert.equal(r.invoicePatch.outstandingMinor, 7000); // 10000 - 3000
  assert.equal("state" in r.invoicePatch, false); // a credit is not a payment — invoice state not changed
});

test("DEBIT_CHARGE increases owed via charges (no cap)", () => {
  const r = buildAdjustment(input({ type: "DEBIT_CHARGE", amountMinor: 5000 }), inv(), DEPS);
  assert.equal(r.invoicePatch.chargesMinor, 5000);
  assert.equal(r.invoicePatch.outstandingMinor, 15000); // 10000 + 5000
});

test("WRITE_OFF settles owed without payment: outstanding 0, but NOT marked PAID", () => {
  const r = buildAdjustment(input({ type: "WRITE_OFF", amountMinor: 10000 }), inv(), DEPS);
  assert.equal(r.invoicePatch.writeOffMinor, 10000);
  assert.equal(r.invoicePatch.outstandingMinor, 0);
  assert.equal("state" in r.invoicePatch, false); // written off, not paid
});

test("credits accumulate onto existing credit facts", () => {
  const r = buildAdjustment(input({ type: "CREDIT_MEMO", amountMinor: 2000 }), inv({ creditsMinor: 1000 }), DEPS);
  assert.equal(r.invoicePatch.creditsMinor, 3000);
  assert.equal(r.invoicePatch.outstandingMinor, 7000);
});

test("credit / write-off cannot exceed current outstanding (excess ⇒ future credit balance, not built)", () => {
  assert.throws(() => buildAdjustment(input({ type: "CREDIT_MEMO", amountMinor: 12000 }), inv(), DEPS), (e) => e instanceof AdjustmentCommandError && e.code === "EXCEEDS_OUTSTANDING");
  assert.throws(() => buildAdjustment(input({ type: "WRITE_OFF", amountMinor: 12000 }), inv(), DEPS), (e) => e.code === "EXCEEDS_OUTSTANDING");
  // outstanding already reduced by applied payments is respected
  assert.throws(() => buildAdjustment(input({ type: "WRITE_OFF", amountMinor: 7000 }), inv({ appliedMinor: 4000 }), DEPS), (e) => e.code === "EXCEEDS_OUTSTANDING");
});

test("fail-closed: bad type / missing reason / bad date / bad amount / currency / void / missing ids", () => {
  assert.throws(() => buildAdjustment(input({ type: "REFUND" }), inv(), DEPS), (e) => e.code === "TYPE_INVALID");
  assert.throws(() => buildAdjustment(input({ reason: "" }), inv(), DEPS), (e) => e.code === "REASON_REQUIRED");
  assert.throws(() => buildAdjustment(input({ effectiveDate: "08/08/2026" }), inv(), DEPS), (e) => e.code === "EFFECTIVE_DATE_INVALID");
  assert.throws(() => buildAdjustment(input({ amountMinor: 0 }), inv(), DEPS), (e) => e.code === "AMOUNT_INVALID");
  assert.throws(() => buildAdjustment(input({ currency: "EUR" }), inv(), DEPS), (e) => e.code === "CURRENCY_MISMATCH");
  assert.throws(() => buildAdjustment(input(), inv({ state: "VOID" }), DEPS), (e) => e.code === "INVOICE_VOID");
  assert.throws(() => buildAdjustment(input({ invoiceId: "" }), inv(), DEPS), (e) => e.code === "REQUIRED");
});
