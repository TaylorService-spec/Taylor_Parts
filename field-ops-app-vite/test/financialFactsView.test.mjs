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
  agingSlots,
  unagedNote,
  paymentIdentity,
  paymentContext,
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
  summary: {
    count: 10,
    openCount: 7,
    overdueCount: 1,
    billedByCurrency: { USD: 7_945_000 },
    collectedByCurrency: { USD: 2_094_500 },
    outstandingByCurrency: { USD: 5_855_500 },
  },
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

test("billed and collected come from the SERVER summary, including across companies", () => {
  // These used to be absent in a multi-company view, because the read returned them per company
  // only and adding the rows here would have presented a scoped slice as a book-wide figure. The
  // total moved to the server; this reads it.
  const s = lifecycleScorecard(FACTS_STATE.READY, SCORECARD_READY);
  assert.match(s.billed.valueText, /79,450\.00/);
  assert.match(s.collected.valueText, /20,945\.00/);
  assert.equal(s.billed.absence, null);
});

test("the figures are READ from the summary, never assembled from the company rows", () => {
  // A summary that DISAGREES with the company rows proves which one is being read. If this ever
  // renders the sum of the rows instead, the client has started doing the arithmetic again.
  const disagreeing = {
    ...SCORECARD_READY,
    summary: { ...SCORECARD_READY.summary, billedByCurrency: { USD: 111 } },
  };
  assert.match(lifecycleScorecard(FACTS_STATE.READY, disagreeing).billed.valueText, /1\.11/);
});

test("a single-company view reads the same summary field", () => {
  const s = lifecycleScorecard(FACTS_STATE.READY, {
    ...SINGLE_COMPANY,
    summary: { ...SINGLE_COMPANY.summary, billedByCurrency: { USD: 7_014_500 }, collectedByCurrency: { USD: 1_844_500 } },
  });
  assert.match(s.billed.valueText, /70,145\.00/);
  assert.match(s.collected.valueText, /18,445\.00/);
});

test("MULTI-CURRENCY consolidated totals are listed separately, never blended", () => {
  const multi = {
    ...SCORECARD_READY,
    summary: { ...SCORECARD_READY.summary, billedByCurrency: { USD: 100_000, CAD: 50_000 } },
  };
  const out = lifecycleScorecard(FACTS_STATE.READY, multi).billed.valueText;
  assert.ok(out.includes("·"), "two currencies render as two amounts");
  assert.ok(!/1,500\.00/.test(out), "the currencies must never be added together");
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

test("a summary field the deployed function does not send is ABSENT, not a dash or a zero", () => {
  // The bundle and the function ship separately, so the client can legitimately be newer. A page
  // that rendered "—" for a total the server never sent would be reporting a balance it has no
  // basis for; the named absence is the truthful fallback.
  const older = { ...SCORECARD_READY, summary: { count: 10, openCount: 7, overdueCount: 1, outstandingByCurrency: { USD: 5_855_500 } } };
  const s = lifecycleScorecard(FACTS_STATE.READY, older);
  assert.equal(s.billed.valueText, null);
  assert.ok(s.billed.absence && s.billed.detail, "an unsent total must name itself as absent");
  assert.match(s.arOutstanding.valueText, /58,555\.00/, "fields the older function DOES send still render");
});

test("A/R states its period contract VISIBLY, not only in an empty state or a tooltip", () => {
  // Two readings of "Period" are possible on A/R and they mean different things: "invoices issued
  // in the window" versus "the balance as it stood at the end of it". Only the first is supported.
  // Stating that solely in the filtered empty state left it invisible in the very case where it
  // misleads — a populated table under a selected period.
  const src = readFileSync(new URL("../src/modules/financials/FinancialsAccountsReceivable.jsx", import.meta.url), "utf8");
  // The sentence must live in rendered body copy, OUTSIDE the honest-state detail and the tooltip.
  const beforeSection = src.slice(0, src.indexOf("<FinancialsHonestSection"));
  assert.ok(/Period filters by invoice issue date/.test(beforeSection), "the period basis must be visible with rows on screen");
  assert.ok(/not an as-of-period balance/.test(beforeSection), "the as-of disclaimer must be visible too");
  // It must not be a FinAnnotation-only claim.
  assert.ok(!/FinAnnotation[^>]*Period filters by invoice issue date/.test(src), "the statement must not be tooltip-only");
});

// ─── A/R aging (page 04) ───
const AGING_READY = {
  status: "ready",
  invoices: [{ invoiceId: "i1" }],
  payments: [],
  applications: [],
  summary: { count: 1, openCount: 1, overdueCount: 1, billedByCurrency: {}, collectedByCurrency: {}, outstandingByCurrency: { USD: 100_000 } },
  agingByCurrency: {
    USD: { totalOutstandingMinor: 100_000, currentMinor: 10_000, days1to30Minor: 20_000, days31to60Minor: 30_000, days61PlusMinor: 35_000, unagedMinor: 5_000 },
  },
};

test("aging slots READ the server's buckets — the client buckets nothing", () => {
  const s = agingSlots(FACTS_STATE.READY, AGING_READY);
  assert.match(s.total, /1,000\.00/);
  assert.match(s.current, /100\.00/);
  assert.match(s.b1_30, /200\.00/);
  assert.match(s.b31_60, /300\.00/);
  assert.match(s.b61_plus, /350\.00/);
});

test("unaged money is NAMED, never folded into Current", () => {
  const note = unagedNote(AGING_READY);
  assert.match(note, /no governed due date/);
  assert.match(note, /\$50\.00/);
  // Current must show ONLY the server's current bucket, not current + unaged.
  assert.match(agingSlots(FACTS_STATE.READY, AGING_READY).current, /\$100\.00/);
  // Nothing unaged => no note at all.
  const clean = { ...AGING_READY, agingByCurrency: { USD: { ...AGING_READY.agingByCurrency.USD, unagedMinor: 0 } } };
  assert.equal(unagedNote(clean), null);
});

test("a non-answered read shows NO aging figure — never a zero bucket", () => {
  for (const st of [FACTS_STATE.DENIED, FACTS_STATE.UNAVAILABLE, FACTS_STATE.LOADING]) {
    const s = agingSlots(st, null);
    // `supplied` is a flag about the RESPONSE, not a figure. The FIGURES are what must be absent.
    assert.equal(s.supplied, false, `supplied must be false in ${st}`);
    for (const k of ["total", "current", "b1_30", "b31_60", "b61_plus"]) {
      assert.equal(s[k], null, `${k} must be absent in ${st}`);
    }
  }
});

test("SOURCE GUARD: page 04 does not bucket, age or total anything itself", () => {
  const src = readFileSync(new URL("../src/modules/financials/FinancialsAccountsReceivable.jsx", import.meta.url), "utf8");
  const code = src.split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*")).join("\n");
  assert.ok(!/Minor\s*[+\-]/.test(code) && !/[+\-]\s*\w*Minor/.test(code), "no money arithmetic on page 04");
  assert.ok(!/\.reduce\(/.test(code), "no client-side aggregation");
  // Per-ROW display of the server's own daysOverdue is factual and fine — "12 days overdue" is that
  // invoice's own number. What must never happen is ACCUMULATION across rows into age bands, which
  // is what a bucket is. The guard therefore targets aggregation, not comparison.
  assert.ok(!/(days1to30|days31to60|days61Plus|currentMinor)\s*\+?=/.test(code), "page 04 must not accumulate its own buckets");
  assert.ok(/agingSlots\(/.test(code), "buckets must come from the server via the view model");
});

test("an aging response the deployed function did not send is UNSUPPLIED, never 'nothing owed'", () => {
  // The bundle and the function ship separately. A response with no agingByCurrency means the read
  // does not supply aging — which is emphatically NOT "no money is owed". Printing a reassuring
  // absence over real outstanding balances is the worst failure this page could have.
  const older = { ...AGING_READY, agingByCurrency: undefined };
  const s = agingSlots(FACTS_STATE.READY, older);
  assert.equal(s.supplied, false);
  for (const k of ["total", "current", "b1_30", "b31_60", "b61_plus"]) assert.equal(s[k], null);
  // And when the server DOES answer, supplied is true even where a band is legitimately zero.
  const zeroed = { ...AGING_READY, agingByCurrency: { USD: { totalOutstandingMinor: 0, currentMinor: 0, days1to30Minor: 0, days31to60Minor: 0, days61PlusMinor: 0, unagedMinor: 0 } } };
  const z = agingSlots(FACTS_STATE.READY, zeroed);
  assert.equal(z.supplied, true);
  assert.match(z.b61_plus, /\$0\.00/, "a computed zero band is a real answer and is shown");
});

test("SOURCE GUARD: page 04 never says 'Nothing owed' for a read that supplied no aging", () => {
  const src = readFileSync(new URL("../src/modules/financials/FinancialsAccountsReceivable.jsx", import.meta.url), "utf8");
  assert.ok(/aging\.supplied/.test(src), "the page must branch on whether aging was supplied");
  assert.ok(/Not supplied by this read/.test(src), "an unsupplied read must say so");
});

// ─── Payment identity (F3) ───
//
// A cash receipt has NO governed number: CashReceiptRecord carries company, account, currency,
// amount, method, receivedAtMillis, externalRef and the applied projection — and no sequence. The
// identity is therefore COMPOSED from facts the record holds, and must never become a number.
const RECEIPT = {
  paymentId: "94tpLflR0v43mdvbwfRD",
  accountId: "cw-acct-0002",
  companyId: "taylor",
  currency: "USD",
  amountMinor: 250_000,
  appliedMinor: 250_000,
  receivedAtMillis: Date.UTC(2026, 7, 30, 12),
  method: "ACH",
  externalRef: "ACH-83921",
};

test("a payment's identity is composed from its own facts — never the document id", () => {
  const id = paymentIdentity(RECEIPT, "Churn");
  assert.match(id, /Churn/);
  assert.match(id, /\$2,500\.00/);
  assert.match(id, /2026/);
  assert.ok(!id.includes(RECEIPT.paymentId), "the raw record id must never appear in the identity");
});

test("a missing customer name or date degrades truthfully, and never breaks the identity", () => {
  assert.match(paymentIdentity(RECEIPT, null), /Customer not resolved/);
  assert.match(paymentIdentity({ ...RECEIPT, receivedAtMillis: null }, "Churn"), /Date not recorded/);
  assert.match(paymentIdentity({ ...RECEIPT, currency: null }, "Churn"), /Amount not recorded/);
  // Still no document id in any degraded form.
  for (const variant of [null, undefined]) {
    assert.ok(!paymentIdentity({ ...RECEIPT, receivedAtMillis: variant }, null).includes(RECEIPT.paymentId));
  }
});

test("context names the invoices a receipt settled, and omits an absent external ref", () => {
  const apps = [
    { paymentId: RECEIPT.paymentId, invoiceNumber: "INV-000003" },
    { paymentId: RECEIPT.paymentId, invoiceNumber: "INV-000004" },
    { paymentId: "other", invoiceNumber: "INV-999999" },
  ];
  const ctx = paymentContext(RECEIPT, apps);
  assert.match(ctx, /Applied to INV-000003, INV-000004/);
  assert.ok(!ctx.includes("INV-999999"), "another receipt's applications must not appear");
  assert.match(ctx, /External ref ACH-83921/);
  // An absent externalRef is ORDINARY — omitted, not rendered as a gap or a placeholder.
  const noRef = paymentContext({ ...RECEIPT, externalRef: null }, apps);
  assert.ok(!/External ref/.test(noRef));
  assert.match(noRef, /Applied to/);
  // A receipt with neither yields null rather than an empty fragment.
  assert.equal(paymentContext({ ...RECEIPT, externalRef: null }, []), null);
});

test("SOURCE GUARD: no Financials surface renders a raw record id as its primary label", () => {
  for (const name of ["FinancialsPayments", "FinancialsInvoices", "FinancialsAccountsReceivable"]) {
    const src = readFileSync(new URL(`../src/modules/financials/${name}.jsx`, import.meta.url), "utf8");
    // The first cell of a row must not print a bare id. These were the exact regressions:
    assert.ok(!/<td>\{p\.paymentId\}<\/td>/.test(src), `${name} must not label a row with paymentId`);
    assert.ok(!/<td>\{row\.accountId \?\? "—"\}<\/td>/.test(src), `${name} must not label a customer with accountId`);
  }
  const detail = readFileSync(new URL("../src/modules/financials/FinancialsPaymentDetail.jsx", import.meta.url), "utf8");
  assert.ok(/paymentIdentity\(/.test(detail), "payment detail must title itself with the composed identity");
  assert.ok(/Technical details/.test(detail), "the raw id must live in a technical block");
  // And no direct status control anywhere on the payment surfaces.
  for (const src of [detail, readFileSync(new URL("../src/modules/financials/FinancialsPayments.jsx", import.meta.url), "utf8")]) {
    assert.ok(!/<select[^>]*status/i.test(src), "no direct payment status control may exist");
  }
});
