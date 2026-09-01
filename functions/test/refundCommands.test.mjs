// Finance — refund core (Owner §7/§10). Pure tests. Proves a refund REVERSES applied payment (reopening AR),
// is a distinct record (not a negative payment / not a credit), cannot exceed applied, and re-derives state.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRefund, RefundCommandError } from "../lib/finance/refundCommands.js";

const inv = (over = {}) => ({
  currency: "USD",
  state: "PAID",
  totalMinor: 10000,
  appliedMinor: 10000,
  companyId: "taylor",
  accountId: "A1",
  attribution: { businessUnitId: null, creditedSalespersonId: "emp-sales-1", responsibleEmployeeId: null },
  ...over,
});
const input = (over = {}) => ({ invoiceId: "INVID", companyId: "taylor", accountId: "A1", currency: "USD", amountMinor: 3000, reason: "returned goods", effectiveDate: "2026-08-08", ...over });
const DEPS = { nowMillis: 1_700_000_100_000 };

test("full refund of a PAID invoice reopens it to ISSUED (outstanding back to total)", () => {
  const r = buildRefund(input({ amountMinor: 10000 }), inv(), DEPS);
  assert.deepEqual(r.invoicePatch, { appliedMinor: 0, outstandingMinor: 10000, state: "ISSUED" });
  assert.equal(r.refund.amountMinor, 10000);
  assert.equal(r.refund.reason, "returned goods");
});

test("partial refund reduces applied → PARTIALLY_PAID, outstanding increases", () => {
  const r = buildRefund(input({ amountMinor: 3000 }), inv(), DEPS);
  assert.deepEqual(r.invoicePatch, { appliedMinor: 7000, outstandingMinor: 3000, state: "PARTIALLY_PAID" });
});

test("refund reduces APPLIED (not credits) — distinct from a credit memo", () => {
  const r = buildRefund(input({ amountMinor: 1000 }), inv({ creditsMinor: 500 }), DEPS);
  assert.equal(r.invoicePatch.appliedMinor, 9000); // applied moved
  // outstanding = total - applied - credits = 10000 - 9000 - 500 = 500
  assert.equal(r.invoicePatch.outstandingMinor, 500);
});

test("refund cannot exceed applied payment", () => {
  assert.throws(() => buildRefund(input({ amountMinor: 12000 }), inv(), DEPS), (e) => e instanceof RefundCommandError && e.code === "EXCEEDS_APPLIED");
  assert.throws(() => buildRefund(input({ amountMinor: 5000 }), inv({ appliedMinor: 4000 }), DEPS), (e) => e.code === "EXCEEDS_APPLIED");
});

test("paymentId reference is optional; carried when provided", () => {
  assert.equal(buildRefund(input(), inv(), DEPS).refund.paymentId, null);
  assert.equal(buildRefund(input({ paymentId: "PAY-1" }), inv(), DEPS).refund.paymentId, "PAY-1");
});

test("fail-closed: currency / void / missing reason / bad date / bad amount / missing ids", () => {
  assert.throws(() => buildRefund(input({ currency: "EUR" }), inv(), DEPS), (e) => e.code === "CURRENCY_MISMATCH");
  assert.throws(() => buildRefund(input(), inv({ state: "VOID" }), DEPS), (e) => e.code === "INVOICE_VOID");
  assert.throws(() => buildRefund(input({ reason: "" }), inv(), DEPS), (e) => e.code === "REASON_REQUIRED");
  assert.throws(() => buildRefund(input({ effectiveDate: "2026/08/08" }), inv(), DEPS), (e) => e.code === "EFFECTIVE_DATE_INVALID");
  assert.throws(() => buildRefund(input({ amountMinor: 0 }), inv(), DEPS), (e) => e.code === "AMOUNT_INVALID");
  assert.throws(() => buildRefund(input({ invoiceId: "" }), inv(), DEPS), (e) => e.code === "REQUIRED");
});

test("FIN-002: company/customer come from the INVOICE; caller ids assertion-only; canonical attribution stamped", () => {
  const r = buildRefund(input({ companyId: undefined, accountId: undefined }), inv(), DEPS);
  assert.equal(r.refund.companyId, "taylor");
  assert.equal(r.refund.accountId, "A1");
  assert.deepEqual(r.refund.attribution, {
    operatingCompanyId: "taylor",
    businessUnitId: null,
    creditedSalespersonId: "emp-sales-1", // the invoice's frozen credit — never the refunding actor
    responsibleEmployeeId: null,
    customerId: "A1",
    sourceType: "INVOICE",
    sourceRecordId: "INVID",
    eventAtMillis: DEPS.nowMillis,
    currency: "USD",
  });
  assert.throws(() => buildRefund(input({ companyId: "ventana" }), inv(), DEPS), (e) => e.code === "COMPANY_MISMATCH");
  assert.throws(() => buildRefund(input({ accountId: "A2" }), inv(), DEPS), (e) => e.code === "ACCOUNT_MISMATCH");
  assert.throws(() => buildRefund(input(), inv({ companyId: undefined }), DEPS), (e) => e.code === "COMPANY_REQUIRED");
  assert.throws(() => buildRefund(input(), inv({ accountId: undefined }), DEPS), (e) => e.code === "ACCOUNT_REQUIRED");
});
