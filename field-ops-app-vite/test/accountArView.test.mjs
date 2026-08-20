import { test } from "node:test";
import assert from "node:assert/strict";
import {
  accountArView,
  mapAccountArErrorToStatus,
  arPositionTone,
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
    ["CAD 5.00", "USD 10.00"]
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
  assert.equal(formatMinor(1050, "USD"), "USD 10.50");
  assert.equal(formatMinor(0, "USD"), "USD 0.00");
  assert.equal(formatMinor(NaN, "USD"), "—");
  assert.equal(formatMinor(undefined, "USD"), "—");
  assert.equal(formatMinor(1000, null), "10.00");
});

// X-MONEY-FORMATTER-DISAGREEMENT: formatMinor now delegates to domain/money.js's
// currencyExponent-aware core instead of hardcoding /100, so it renders correctly for a
// currency whose minor unit is not 1/100 (JPY, exponent 0) rather than silently
// disagreeing with money.js's own formatMoneyMajor.
test("formatMinor is exponent-aware for a non-2-exponent currency (JPY) -- no longer a hardcoded /100", () => {
  assert.equal(formatMinor(1000, "JPY"), "JPY 1000");
  assert.equal(formatMinor(0, "JPY"), "JPY 0"); // zero still renders as zero, not blank
  assert.equal(formatMinor(-9, "JPY"), "JPY -9");
});
