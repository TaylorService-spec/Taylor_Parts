// The Financials reporting view model — pure contract tests. Run: node --test test/financialFactsView.test.mjs
//
// The claims that matter here are all about REFUSAL: the client must not compute money, must not
// print a zero where the server said nothing, and must not turn an unattributed fact into somebody's
// row. Each of those is easy to regress with a well-meaning one-line "improvement", so each has a case.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  FACTS_STATE,
  financialFactsState,
  formatByCurrency,
  invoiceRow,
  outstandingRows,
  rollupRow,
  unattributedNote,
  scopeSentence,
} from "../src/domain/financialFactsView.js";

const READY = {
  status: "ready",
  invoices: [
    {
      invoiceId: "inv-a",
      invoiceNumber: "INV-1001",
      accountId: "acct-1",
      currency: "USD",
      state: "ISSUED",
      totalMinor: 125_000,
      appliedMinor: 25_000,
      outstandingMinor: 100_000,
      dueDate: 1,
      arPosition: "OVERDUE",
      daysOverdue: 12,
      companyId: "taylor",
      creditedSalespersonId: "cw-emp-034",
      businessUnitIds: ["PARTS"],
      issuedAtMillis: 0,
    },
    {
      invoiceId: "inv-b",
      invoiceNumber: "INV-1002",
      accountId: "acct-2",
      currency: "USD",
      state: "PAID",
      totalMinor: 50_000,
      appliedMinor: 50_000,
      outstandingMinor: 0,
      dueDate: 2,
      arPosition: "SETTLED",
      daysOverdue: null,
      companyId: "taylor",
      creditedSalespersonId: null,
      businessUnitIds: ["PARTS", "SERVICE"],
      issuedAtMillis: 0,
    },
  ],
  payments: [],
  applications: [],
  byCreditedSalesperson: [
    { key: "cw-emp-034", invoiceCount: 1, billedByCurrency: { USD: 125_000 }, collectedByCurrency: { USD: 25_000 }, outstandingByCurrency: { USD: 100_000 } },
  ],
  grantedScopes: ["OPERATING_COMPANY"],
  unattributed: { businessUnit: 0, creditedSalesperson: 1 },
};

test("a truncated server result is UNAVAILABLE, never a ready empty page", () => {
  assert.equal(financialFactsState({ loading: false, result: { status: "unavailable", invoices: [] } }).state, FACTS_STATE.UNAVAILABLE);
});

test("denial, failure, emptiness and readiness are four distinct states", () => {
  assert.equal(financialFactsState({ loading: true }).state, FACTS_STATE.LOADING);
  assert.equal(financialFactsState({ loading: false, errorStatus: "denied" }).state, FACTS_STATE.DENIED);
  assert.equal(financialFactsState({ loading: false, errorStatus: "unavailable" }).state, FACTS_STATE.UNAVAILABLE);
  assert.equal(financialFactsState({ loading: false, result: { status: "ready", invoices: [] } }).state, FACTS_STATE.EMPTY);
  assert.equal(financialFactsState({ loading: false, result: READY }).state, FACTS_STATE.READY);
});

test("a payments-only read is READY — emptiness is about the whole answer, not about invoices", () => {
  // Page 05 asks for factTypes ["PAYMENT_RECEIPT","PAYMENT_APPLICATION"], so the server correctly
  // returns an EMPTY invoices array beside real payments. Testing invoices alone declared the page
  // empty while it held the very records it was asked to show.
  const paymentsOnly = {
    status: "ready",
    invoices: [],
    payments: [{ paymentId: "pay-1", amountMinor: 100000, appliedMinor: 100000, currency: "USD" }],
    applications: [{ applicationId: "app-1", appliedAmountMinor: 100000, currency: "USD" }],
  };
  assert.equal(financialFactsState({ loading: false, result: paymentsOnly }).state, FACTS_STATE.READY);
  const applicationsOnly = { status: "ready", invoices: [], payments: [], applications: paymentsOnly.applications };
  assert.equal(financialFactsState({ loading: false, result: applicationsOnly }).state, FACTS_STATE.READY);
  // A genuinely empty answer is still EMPTY.
  assert.equal(
    financialFactsState({ loading: false, result: { status: "ready", invoices: [], payments: [], applications: [] } }).state,
    FACTS_STATE.EMPTY,
  );
});

test("an absent per-currency figure is a dash, never a fabricated zero", () => {
  assert.equal(formatByCurrency({}), "—");
  assert.equal(formatByCurrency(undefined), "—");
  assert.equal(formatByCurrency(null), "—");
});

test("multiple currencies are listed separately and never combined", () => {
  const out = formatByCurrency({ USD: 100_000, CAD: 50_000 });
  assert.ok(out.includes("·"), "two currencies must render as two amounts");
  assert.ok(!/150/.test(out), "the two currencies must never be added together");
});

test("a cross-unit invoice reads Mixed; an unstamped one reads Not attributed", () => {
  assert.equal(invoiceRow(READY.invoices[0]).businessUnit, "PARTS");
  assert.equal(invoiceRow(READY.invoices[1]).businessUnit, "Mixed");
  assert.equal(invoiceRow({ ...READY.invoices[0], businessUnitIds: [] }).businessUnit, "Not attributed");
});

test("an AR position renders as a word, never as the stored token", () => {
  assert.equal(invoiceRow(READY.invoices[0]).position, "Overdue");
  assert.equal(invoiceRow({ ...READY.invoices[0], arPosition: "WHAT" }).position, "Position not recorded");
});

test("open exposure selects owed invoices without recomputing what is owed", () => {
  const rows = outstandingRows(READY);
  assert.deepEqual(rows.map((r) => r.invoiceId), ["inv-a"]);
  assert.equal(rows[0].outstanding, invoiceRow(READY.invoices[0]).outstanding);
});

test("an unattributed fact is named and counted, never given a row of its own", () => {
  const note = unattributedNote(READY, "creditedSalesperson");
  assert.match(note, /1 visible invoice carries no credited salesperson/);
  assert.equal(unattributedNote(READY, "businessUnit"), null, "no note when everything is attributed");
  // The rollup the page renders must contain only real people.
  assert.deepEqual(READY.byCreditedSalesperson.map((r) => rollupRow(r).key), ["cw-emp-034"]);
});

test("the scope sentence reports the server's answer, and says nothing when there is none", () => {
  assert.match(scopeSentence(READY), /OPERATING_COMPANY/);
  assert.equal(scopeSentence({ grantedScopes: [] }), null);
  assert.equal(scopeSentence(null), null);
});

test("the view model contains no money arithmetic over authoritative facts", () => {
  const src = readFileSync(new URL("../src/domain/financialFactsView.js", import.meta.url), "utf8");
  const code = src
    .split("\n")
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*") && !l.trim().startsWith("/*"))
    .join("\n");
  // A reduce/+= over a *Minor field is the exact shape of the defect: a total assembled client-side
  // from a page of rows, presented as if it described the whole book.
  assert.ok(!/Minor\s*[+\-*/]/.test(code), "no arithmetic on a minor-unit value");
  assert.ok(!/[+\-*/]\s*\w*Minor/.test(code), "no minor-unit value used as an operand");
  assert.ok(!/\.reduce\(/.test(code), "no client-side aggregation of server figures");
});
