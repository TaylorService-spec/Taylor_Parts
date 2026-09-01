// Finance — payment command core. Pure tests (node:test; no emulator). Prereq: npm run build. Proves the
// receipt/application separation, the DERIVED outstanding projection (total − applied − credits + charges −
// writeoffs), one-invoice→many-applications accumulation, and fail-closed guards (over-application, currency,
// closed invoice). Nothing here stores an independently editable outstanding.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApplyPayment, deriveOutstandingMinor, deriveInvoiceStateFromFacts, PaymentCommandError } from "../lib/finance/paymentCommands.js";

const inv = (over = {}) => ({
  currency: "USD",
  state: "ISSUED",
  totalMinor: 10000,
  companyId: "taylor",
  accountId: "A1",
  attribution: { businessUnitId: null, creditedSalespersonId: "emp-sales-1", responsibleEmployeeId: null },
  ...over,
});
const input = (over = {}) => ({ companyId: "taylor", accountId: "A1", invoiceId: "INVID", currency: "USD", amountMinor: 4000, receivedAtMillis: 1_700_000_000_000, ...over });
const DEPS = { nowMillis: 1_700_000_100_000 };

test("deriveOutstandingMinor = total − applied − credits + charges − writeoffs (facts, forward-compatible)", () => {
  assert.equal(deriveOutstandingMinor({ totalMinor: 10000, appliedMinor: 2000, creditsMinor: 1000, chargesMinor: 500, writeOffMinor: 500 }), 7000);
  assert.equal(deriveOutstandingMinor({ totalMinor: 10000 }), 10000); // defaults 0
});

test("deriveInvoiceStateFromFacts: fully settled ⇒ PAID; partial ⇒ PARTIALLY_PAID; none ⇒ unchanged; VOID terminal", () => {
  assert.equal(deriveInvoiceStateFromFacts({ state: "ISSUED", totalMinor: 100, appliedMinor: 100 }), "PAID");
  assert.equal(deriveInvoiceStateFromFacts({ state: "ISSUED", totalMinor: 100, appliedMinor: 40 }), "PARTIALLY_PAID");
  assert.equal(deriveInvoiceStateFromFacts({ state: "ISSUED", totalMinor: 100, appliedMinor: 0 }), "ISSUED");
  assert.equal(deriveInvoiceStateFromFacts({ state: "VOID", totalMinor: 100 }), "VOID");
});

test("partial application: receipt + application separated; invoice projection derived (PARTIALLY_PAID)", () => {
  const r = buildApplyPayment(input({ amountMinor: 4000 }), inv(), DEPS);
  // cash receipt = money received (its own record)
  assert.equal(r.receipt.amountMinor, 4000);
  assert.equal(r.receipt.appliedMinor, 4000);
  assert.equal(r.receipt.unappliedMinor, 0);
  // application = how it is applied (separate fact, no paymentId yet — the callable assigns it)
  assert.equal(r.application.invoiceId, "INVID");
  assert.equal(r.application.appliedAmountMinor, 4000);
  assert.equal("paymentId" in r.application, false);
  // invoice projection is DERIVED from the application fact
  assert.deepEqual(r.invoicePatch, { appliedMinor: 4000, outstandingMinor: 6000, state: "PARTIALLY_PAID" });
});

test("full application ⇒ PAID, outstanding 0", () => {
  const r = buildApplyPayment(input({ amountMinor: 10000 }), inv(), DEPS);
  assert.deepEqual(r.invoicePatch, { appliedMinor: 10000, outstandingMinor: 0, state: "PAID" });
});

test("one invoice → MANY applications: a second application accumulates onto prior appliedMinor", () => {
  // invoice already PARTIALLY_PAID with 4000 applied; apply the remaining 6000
  const r = buildApplyPayment(input({ amountMinor: 6000 }), inv({ state: "PARTIALLY_PAID", appliedMinor: 4000 }), DEPS);
  assert.deepEqual(r.invoicePatch, { appliedMinor: 10000, outstandingMinor: 0, state: "PAID" });
});

test("over-application is rejected (excess would be an unapplied credit balance — not built here)", () => {
  assert.throws(() => buildApplyPayment(input({ amountMinor: 15000 }), inv(), DEPS), (e) => e instanceof PaymentCommandError && e.code === "OVER_APPLICATION");
  // and over-applying against the remaining balance of a partially-paid invoice
  assert.throws(() => buildApplyPayment(input({ amountMinor: 7000 }), inv({ state: "PARTIALLY_PAID", appliedMinor: 4000 }), DEPS), (e) => e.code === "OVER_APPLICATION");
});

test("fail-closed: currency mismatch / already paid / void / not-open / missing fields / bad amount", () => {
  assert.throws(() => buildApplyPayment(input({ currency: "EUR" }), inv(), DEPS), (e) => e.code === "CURRENCY_MISMATCH");
  assert.throws(() => buildApplyPayment(input(), inv({ state: "PAID" }), DEPS), (e) => e.code === "ALREADY_PAID");
  assert.throws(() => buildApplyPayment(input(), inv({ state: "VOID" }), DEPS), (e) => e.code === "INVOICE_VOID");
  assert.throws(() => buildApplyPayment(input(), inv({ state: "DRAFT" }), DEPS), (e) => e.code === "NOT_OPEN");
  assert.throws(() => buildApplyPayment(input({ invoiceId: "" }), inv(), DEPS), (e) => e.code === "REQUIRED");
  assert.throws(() => buildApplyPayment(input({ amountMinor: 0 }), inv(), DEPS), (e) => e.code === "AMOUNT_INVALID");
  assert.throws(() => buildApplyPayment(input({ amountMinor: 1.5 }), inv(), DEPS), (e) => e.code === "AMOUNT_INVALID");
});

test("FIN-002 money-in: company/customer come from the INVOICE; caller ids are assertion-only", () => {
  // The caller need not send companyId/accountId at all — the invoice supplies them.
  const r = buildApplyPayment(input({ companyId: undefined, accountId: undefined }), inv(), DEPS);
  assert.equal(r.receipt.companyId, "taylor");
  assert.equal(r.receipt.accountId, "A1");
  assert.equal(r.application.companyId, "taylor");
  // A supplied assertion that disagrees with the governed invoice is refused.
  assert.throws(() => buildApplyPayment(input({ companyId: "ventana" }), inv(), DEPS), (e) => e instanceof PaymentCommandError && e.code === "COMPANY_MISMATCH");
  assert.throws(() => buildApplyPayment(input({ accountId: "A2" }), inv(), DEPS), (e) => e.code === "ACCOUNT_MISMATCH");
  // An invoice with no governed company cannot take a reportable money event, even if the caller offers one.
  assert.throws(() => buildApplyPayment(input(), inv({ companyId: undefined }), DEPS), (e) => e.code === "COMPANY_REQUIRED");
  assert.throws(() => buildApplyPayment(input(), inv({ accountId: undefined }), DEPS), (e) => e.code === "ACCOUNT_REQUIRED");
});

test("FIN-002 money-in: ONE canonical attribution snapshot, derived from the invoice, on BOTH facts", () => {
  const r = buildApplyPayment(input(), inv(), DEPS);
  assert.deepEqual(r.receipt.attribution, {
    operatingCompanyId: "taylor",
    businessUnitId: null,
    creditedSalespersonId: "emp-sales-1", // the invoice's frozen credit — never the paying actor
    responsibleEmployeeId: null,
    customerId: "A1",
    sourceType: "INVOICE",
    sourceRecordId: "INVID",
    eventAtMillis: DEPS.nowMillis, // server record time, not the caller's receivedAtMillis
    currency: "USD",
  });
  assert.deepEqual(r.application.attribution, r.receipt.attribution);
});
