// Account Commercial Profile -- PR 2. Deterministic unit test for the
// GOVERNED enum fields' pure logic in src/domain/commercialProfile.js:
// the paymentTerms/taxStatus enum validators, the taxStatus safe-default
// resolver (absent => UNKNOWN, NEVER TAXABLE), and the payment-term
// due-date semantics (Net-N net-days from issue; COD resolves against the
// delivery/fulfillment event, never invoiceDate + 0; a pre-delivery COD
// invoice is due-date-pending; an issued-invoice snapshot is unchanged by
// a later Account-term change -- no retroactive change).
//
// Run: node test/commercialProfileGoverned.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import {
  isValidPaymentTerms,
  isValidTaxStatus,
  resolveTaxStatus,
  paymentTermNetDays,
  dueDateBasis,
  DUE_DATE_BASIS,
  issueInvoiceTermsSnapshot,
  resolveCodDueDateOnDelivery,
} from "../src/domain/commercialProfile.js";
import { PAYMENT_TERMS, TAX_STATUS } from "../src/domain/constants.js";

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }

const DAY_MS = 24 * 60 * 60 * 1000;
// A fixed, deterministic issue date (2026-01-01T00:00:00Z) -- arbitrary but
// stable so the +N*day arithmetic below is exact.
const ISSUE = Date.UTC(2026, 0, 1);

// --- Governed enum validators -----------------------------------------
ok("paymentTerms: the four enum values accepted, others rejected", () => {
  assert.equal(isValidPaymentTerms("COD"), true);
  assert.equal(isValidPaymentTerms("NET_30"), true);
  assert.equal(isValidPaymentTerms("NET_60"), true);
  assert.equal(isValidPaymentTerms("NET_90"), true);
  assert.equal(isValidPaymentTerms("NET_45"), false); // not a supported term
  assert.equal(isValidPaymentTerms("CUSTOM"), false); // deferred future initiative
  assert.equal(isValidPaymentTerms(""), false);
  assert.equal(isValidPaymentTerms(null), false);
  assert.equal(isValidPaymentTerms(undefined), false);
});

ok("taxStatus: the four enum values accepted, others rejected", () => {
  assert.equal(isValidTaxStatus("UNKNOWN"), true);
  assert.equal(isValidTaxStatus("TAXABLE"), true);
  assert.equal(isValidTaxStatus("EXEMPT"), true);
  assert.equal(isValidTaxStatus("RESELLER"), true);
  assert.equal(isValidTaxStatus("taxable"), false); // case-sensitive
  assert.equal(isValidTaxStatus("NONE"), false);
  assert.equal(isValidTaxStatus(null), false);
});

// --- taxStatus SAFE DEFAULT (absent => UNKNOWN, never TAXABLE) ---------
ok("taxStatus safe default: absent resolves to UNKNOWN, never TAXABLE", () => {
  assert.equal(resolveTaxStatus(undefined), TAX_STATUS.UNKNOWN);
  assert.equal(resolveTaxStatus(null), TAX_STATUS.UNKNOWN);
  assert.equal(resolveTaxStatus(""), TAX_STATUS.UNKNOWN);
  // The invariant, stated as an assertion: absence is NEVER TAXABLE.
  assert.notEqual(resolveTaxStatus(undefined), TAX_STATUS.TAXABLE);
});
ok("taxStatus safe default: a stored valid value is returned unchanged", () => {
  assert.equal(resolveTaxStatus("TAXABLE"), "TAXABLE");
  assert.equal(resolveTaxStatus("EXEMPT"), "EXEMPT");
  assert.equal(resolveTaxStatus("RESELLER"), "RESELLER");
  assert.equal(resolveTaxStatus("UNKNOWN"), "UNKNOWN");
});
ok("taxStatus safe default: a stored MALFORMED value is surfaced (not coerced to TAXABLE)", () => {
  // Never silently masks a bad value as TAXABLE -- it returns it so the form
  // flags it; the only thing that becomes UNKNOWN is genuine absence.
  assert.equal(resolveTaxStatus("garbage"), "garbage");
  assert.notEqual(resolveTaxStatus("garbage"), TAX_STATUS.TAXABLE);
});

// --- Net-days mapping + basis -----------------------------------------
ok("net-days: NET_30/60/90 map to 30/60/90; COD is not a net-days term (null)", () => {
  assert.equal(paymentTermNetDays("NET_30"), 30);
  assert.equal(paymentTermNetDays("NET_60"), 60);
  assert.equal(paymentTermNetDays("NET_90"), 90);
  assert.equal(paymentTermNetDays("COD"), null);
  assert.equal(paymentTermNetDays("NET_45"), null); // unknown term
});
ok("due-date basis: NET_* measure from invoice issue; COD from the delivery event", () => {
  assert.equal(dueDateBasis("NET_30"), DUE_DATE_BASIS.INVOICE_ISSUE);
  assert.equal(dueDateBasis("NET_90"), DUE_DATE_BASIS.INVOICE_ISSUE);
  assert.equal(dueDateBasis("COD"), DUE_DATE_BASIS.DELIVERY_EVENT);
});

// --- Net-N due date = issueDate + netDays -----------------------------
ok("Net-N: dueDate = invoiceIssueDate + netDays, computable at issue, never pending", () => {
  const s30 = issueInvoiceTermsSnapshot({ paymentTerms: PAYMENT_TERMS.NET_30, invoiceIssueDate: ISSUE });
  assert.equal(s30.dueDate, ISSUE + 30 * DAY_MS);
  assert.equal(s30.dueDatePending, false);
  assert.equal(s30.basisEvent, DUE_DATE_BASIS.INVOICE_ISSUE);
  assert.equal(s30.netDays, 30);

  const s90 = issueInvoiceTermsSnapshot({ paymentTerms: PAYMENT_TERMS.NET_90, invoiceIssueDate: ISSUE });
  assert.equal(s90.dueDate, ISSUE + 90 * DAY_MS);
  assert.equal(s90.dueDatePending, false);
});

// --- COD resolves against delivery, NEVER invoiceDate + 0 -------------
ok("COD with a delivery already at issue: dueDate = the delivery date (NOT invoiceDate + 0)", () => {
  const delivery = ISSUE + 3 * DAY_MS; // delivered 3 days after invoice issued
  const s = issueInvoiceTermsSnapshot({ paymentTerms: PAYMENT_TERMS.COD, invoiceIssueDate: ISSUE, deliveryDate: delivery });
  assert.equal(s.dueDate, delivery);
  assert.notEqual(s.dueDate, ISSUE); // the bug this guards against: invoiceDate + 0
  assert.equal(s.dueDatePending, false);
  assert.equal(s.basisEvent, DUE_DATE_BASIS.DELIVERY_EVENT);
  assert.equal(s.netDays, null);
});
ok("COD issued BEFORE delivery: due date is PENDING (null), not due 'now'", () => {
  const s = issueInvoiceTermsSnapshot({ paymentTerms: PAYMENT_TERMS.COD, invoiceIssueDate: ISSUE });
  assert.equal(s.dueDate, null);
  assert.equal(s.dueDatePending, true);
  // NOT every COD invoice has a computed due date at issue.
  assert.notEqual(s.dueDate, ISSUE);
});
ok("COD pending -> resolved once the delivery event occurs, then immutable", () => {
  const pending = issueInvoiceTermsSnapshot({ paymentTerms: PAYMENT_TERMS.COD, invoiceIssueDate: ISSUE });
  const delivery = ISSUE + 5 * DAY_MS;
  const resolved = resolveCodDueDateOnDelivery(pending, delivery);
  assert.equal(resolved.dueDate, delivery);
  assert.equal(resolved.dueDatePending, false);
  // Original pending snapshot is NOT mutated (a NEW snapshot is returned).
  assert.equal(pending.dueDate, null);
  assert.equal(pending.dueDatePending, true);

  // A second delivery event does NOT retroactively change an already-resolved
  // (immutable) COD due date.
  const again = resolveCodDueDateOnDelivery(resolved, ISSUE + 99 * DAY_MS);
  assert.equal(again.dueDate, delivery);
});

// --- Issued-invoice snapshot is unchanged by a later Account-term change
ok("no retroactive change: a later Account paymentTerms change does not alter an issued invoice's due date", () => {
  // Invoice issued while the Account default term was NET_30.
  const account = { paymentTerms: PAYMENT_TERMS.NET_30 };
  const snapshot = issueInvoiceTermsSnapshot({ paymentTerms: account.paymentTerms, invoiceIssueDate: ISSUE });
  const originalDue = snapshot.dueDate;
  assert.equal(originalDue, ISSUE + 30 * DAY_MS);

  // The Account's default term is later changed to NET_90. The already-issued
  // invoice's snapshot has no back-reference to the Account, so its recorded
  // due date is untouched.
  account.paymentTerms = PAYMENT_TERMS.NET_90;
  assert.equal(snapshot.dueDate, originalDue);
  assert.equal(snapshot.termsCode, PAYMENT_TERMS.NET_30);
  assert.equal(snapshot.netDays, 30);
});

console.log(`\n${passed} passed`);
