import { test } from "node:test";
import assert from "node:assert/strict";
import {
  accountArView,
  mapAccountArErrorToStatus,
  arPositionTone,
  arPositionWords,
  formatMinor,
  ACCOUNT_AR_STATE,
} from "../src/domain/accountArView.js";

test("loading takes priority", () => {
  assert.equal(accountArView({ loading: true, errorStatus: "denied" }).kind, ACCOUNT_AR_STATE.LOADING);
});

test("errorStatus surfaces denied distinctly from unavailable", () => {
  assert.equal(accountArView({ errorStatus: "denied" }).kind, "denied");
  assert.equal(accountArView({ errorStatus: "unavailable" }).kind, "unavailable");
});

test("a non-ready callable result is unavailable, never fabricated empty", () => {
  assert.equal(accountArView({ result: { status: "unavailable", invoices: [], summary: {} } }).kind, ACCOUNT_AR_STATE.UNAVAILABLE);
  assert.equal(accountArView({ result: null }).kind, ACCOUNT_AR_STATE.UNAVAILABLE);
});

test("ready with zero invoices is empty, not a $0 total", () => {
  const view = accountArView({
    result: { status: "ready", invoices: [], summary: { count: 0, openCount: 0, overdueCount: 0, outstandingByCurrency: {} } },
  });
  assert.equal(view.kind, ACCOUNT_AR_STATE.EMPTY);
});

test("ready with invoices summarizes open/overdue counts and per-currency outstanding, never blindly summed across currencies", () => {
  const invoices = [
    { invoiceId: "1", invoiceNumber: "INV-1", currency: "USD", outstandingMinor: 1000, arPosition: "OVERDUE", daysOverdue: 5 },
    { invoiceId: "2", invoiceNumber: "INV-2", currency: "CAD", outstandingMinor: 500, arPosition: "CURRENT", daysOverdue: 0 },
  ];
  const view = accountArView({
    result: {
      status: "ready",
      invoices,
      summary: { count: 2, openCount: 2, overdueCount: 1, outstandingByCurrency: { USD: 1000, CAD: 500 } },
    },
  });
  assert.equal(view.kind, ACCOUNT_AR_STATE.READY);
  assert.equal(view.openCount, 2);
  assert.equal(view.overdueCount, 1);
  assert.deepEqual(
    view.outstandingLines.map((l) => l.text).sort(),
    // X-SALES-ORDER-USD-DISPLAY: the shape is now normal currency presentation. The INTENT is
    // unchanged and still the point of this line -- the two currencies are listed SEPARATELY and
    // never summed, and each carries its own symbol (CA$ vs $) so a reader cannot mistake one for
    // the other.
    ["$10.00", "CA$5.00"].sort()
  );
  assert.equal(view.rows.length, 2);
  assert.equal(view.rows[0].daysOverdueText, "5d overdue");
  assert.equal(view.rows[1].daysOverdueText, null);
});

test("error-code mapper distinguishes permission-denied from every other failure", () => {
  assert.equal(mapAccountArErrorToStatus({ code: "permission-denied" }), "denied");
  assert.equal(mapAccountArErrorToStatus({ code: "functions/permission-denied" }), "denied");
  assert.equal(mapAccountArErrorToStatus({ code: "unavailable" }), "unavailable");
  assert.equal(mapAccountArErrorToStatus({}), "unavailable");
  assert.equal(mapAccountArErrorToStatus(null), "unavailable");
});

test("arPositionTone covers every position and fails closed to unknown", () => {
  assert.equal(arPositionTone("OVERDUE"), "critical");
  assert.equal(arPositionTone("CURRENT"), "info");
  assert.equal(arPositionTone("SETTLED"), "positive");
  assert.equal(arPositionTone("VOID"), "muted");
  assert.equal(arPositionTone("UNKNOWN"), "unknown");
  assert.equal(arPositionTone("garbage"), "unknown");
  assert.equal(arPositionTone(undefined), "unknown");
});

test("formatMinor never divides a non-finite amount", () => {
  assert.equal(formatMinor(1050, "USD"), "$10.50");
  assert.equal(formatMinor(0, "USD"), "$0.00", "zero is a real amount, not an absence");
  assert.equal(formatMinor(NaN, "USD"), "—");
  assert.equal(formatMinor(undefined, "USD"), "—");
  // NO CURRENCY, NO SYMBOL. A missing currency must never silently become USD in reusable domain
  // code -- that would make "unlabelled money is dollars" a system-wide invariant established by a
  // formatter. The Sales Order surface supplies its own, scoped to that object (see
  // domain/salesOrderDisplayCurrency.js).
  assert.equal(formatMinor(1000, null), "10.00");
});

// X-MONEY-FORMATTER-DISAGREEMENT: formatMinor now delegates to domain/money.js's
// currencyExponent-aware core instead of hardcoding /100, so it renders correctly for a
// currency whose minor unit is not 1/100 (JPY, exponent 0) rather than silently
// disagreeing with money.js's own formatMoneyMajor.
test("formatMinor is exponent-aware for a non-2-exponent currency (JPY) -- no longer a hardcoded /100", () => {
  // Exponent 0: no decimal point at all. A hardcoded /100 would render "10.00" here, which is the
  // defect this case has always existed to catch — the shape around the digits changed, the rule did not.
  assert.equal(formatMinor(1000, "JPY"), "¥1,000");
  assert.equal(formatMinor(1000, "JPY").includes("."), false);
  assert.equal(formatMinor(0, "JPY"), "¥0"); // zero still renders as zero, not blank
  assert.equal(formatMinor(-9, "JPY"), "-¥9"); // and a negative stays visibly negative
});

// ═══════════════════════════ AR POSITION IN WORDS (Account North Star P1)

test("every governed AR position has a word, and an unknown one is reported as unplaceable", () => {
  assert.equal(arPositionWords("OVERDUE"), "Overdue");
  assert.equal(arPositionWords("CURRENT"), "Current");
  assert.equal(arPositionWords("SETTLED"), "Settled");
  assert.equal(arPositionWords("VOID"), "Void");
  assert.equal(arPositionWords("UNKNOWN"), "Position not recorded");
  // The mutation this guards: echoing an unrecognised token would show a machine value to a
  // human as though it were the word for the thing.
  assert.equal(arPositionWords("SOMETHING_NEW"), null);
  assert.equal(arPositionWords(undefined), null);
});

test("a row carries the words beside the token it is derived from", () => {
  const view = accountArView({
    result: {
      status: "ready",
      invoices: [{ invoiceId: "i1", invoiceNumber: "INV-1", arPosition: "OVERDUE", outstandingMinor: 100, currency: "USD", daysOverdue: 4 }],
      summary: { count: 1, openCount: 1, overdueCount: 1, outstandingByCurrency: { USD: 100 } },
    },
  });
  // The token stays because accountAttentionProjection filters on it -- it is a discriminant,
  // not display. The WORDS are what a surface renders.
  assert.equal(view.rows[0].position, "OVERDUE");
  assert.equal(view.rows[0].positionWords, "Overdue");
});
