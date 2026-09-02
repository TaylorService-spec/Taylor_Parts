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
  lifecycleScorecard,
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

// ─── Lifecycle scorecard (page 01) ───
//
// Three positions can be populated from what the read returns and three cannot. The cases below
// pin BOTH halves, because the tempting defects are symmetrical: showing a number for a slot with
// no facts, and refusing to show one for a slot that has them.
const SCORECARD_READY = {
  status: "ready",
  invoices: [{ invoiceId: "i1" }],
  payments: [],
  applications: [],
  summary: { count: 10, openCount: 7, overdueCount: 1, outstandingByCurrency: { USD: 5_855_500 } },
  byCompany: [
    { key: "taylor", invoiceCount: 8, billedByCurrency: { USD: 7_014_500 }, collectedByCurrency: { USD: 1_844_500 }, outstandingByCurrency: { USD: 5_170_000 } },
    { key: "ventana", invoiceCount: 2, billedByCurrency: { USD: 930_500 }, collectedByCurrency: { USD: 250_000 }, outstandingByCurrency: { USD: 680_500 } },
  ],
};
const SINGLE_COMPANY = { ...SCORECARD_READY, byCompany: [SCORECARD_READY.byCompany[0]] };

test("A/R outstanding uses the server's own consolidated total in every scope", () => {
  const s = lifecycleScorecard(FACTS_STATE.READY, SCORECARD_READY);
  assert.match(s.arOutstanding.valueText, /58,555\.00/);
  assert.equal(s.arOutstanding.absence, null);
});

test("billed and collected populate from a SINGLE company rollup — a read, not a sum", () => {
  const s = lifecycleScorecard(FACTS_STATE.READY, SINGLE_COMPANY);
  assert.match(s.billed.valueText, /70,145\.00/);
  assert.match(s.collected.valueText, /18,445\.00/);
});

test("across several companies billed and collected stay ABSENT — the page never adds them up", () => {
  const s = lifecycleScorecard(FACTS_STATE.READY, SCORECARD_READY);
  assert.equal(s.billed.valueText, null);
  assert.equal(s.collected.valueText, null);
  assert.match(s.billed.detail, /will not add the companies together/);
  // 7,014,500 + 930,500 = 7,945,000. That number must appear nowhere.
  const rendered = JSON.stringify(s);
  assert.ok(!/79,450\.00|7945000/.test(rendered), "a client-side consolidated total must never appear");
});

test("booked, billable-now and unbilled are never invented", () => {
  for (const result of [SCORECARD_READY, SINGLE_COMPANY]) {
    const s = lifecycleScorecard(FACTS_STATE.READY, result);
    for (const k of ["booked", "billable", "unbilled"]) {
      assert.equal(s[k].valueText, null, `${k} must show no figure`);
      assert.ok(s[k].detail && s[k].detail.length > 0, `${k} must say why`);
    }
    // BILLED IS NOT SUBSTITUTED INTO BOOKED — the single-company case is where that would slip in.
    assert.notEqual(s.booked.valueText, s.billed.valueText === null ? "x" : s.billed.valueText);
    assert.match(s.booked.detail, /Sales Order/);
    assert.match(s.unbilled.detail, /not computed here/);
  }
});

test("a denied or failed read shows no figure at all — never $0.00", () => {
  for (const st of [FACTS_STATE.DENIED, FACTS_STATE.UNAVAILABLE, FACTS_STATE.LOADING]) {
    const s = lifecycleScorecard(st, null);
    for (const k of Object.keys(s)) {
      assert.equal(s[k].valueText, null, `${k} must not render a value in ${st}`);
      assert.ok(!/\$0\.00/.test(JSON.stringify(s[k])), "a withheld figure must never read as zero");
    }
  }
});

test("SOURCE GUARD: the Overview computes no money and derives no unbilled", () => {
  const src = readFileSync(new URL("../src/modules/financials/FinancialsOverview.jsx", import.meta.url), "utf8");
  const code = src.split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*")).join("\n");
  assert.ok(!/Minor\s*[+\-]/.test(code) && !/[+\-]\s*\w*Minor/.test(code), "no money arithmetic on the Overview");
  assert.ok(!/\.reduce\(/.test(code), "no client-side aggregation on the Overview");
  // The page DELEGATES every slot decision to the one resolver, so it cannot quietly grow a
  // per-slot rule of its own — including a Booked-minus-Billed unbilled.
  assert.ok(/lifecycleScorecard\(/.test(code), "the Overview must delegate slot resolution");
  assert.ok(!/\bbooked\b\s*[:=]/.test(code), "the Overview must not assign a booked figure itself");
  assert.ok(!/\bunbilled\b\s*[:=]/.test(code), "the Overview must not assign an unbilled figure itself");
  // And the resolver itself never subtracts one lifecycle figure from another.
  const view = readFileSync(new URL("../src/domain/financialFactsView.js", import.meta.url), "utf8");
  const viewCode = view.split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*")).join("\n");
  assert.ok(!/billed[\w.]*\s*-\s*/i.test(viewCode), "no subtraction between lifecycle figures");
  assert.ok(!/booked:\s*value\(/.test(viewCode), "Billed must never be substituted into Booked");
});
