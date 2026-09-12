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

// ════════════════════ THE OPERATING-COMPANY DIMENSION (lane C26) ════════════════════
//
// An account is not company-partitioned: `issueInvoice` stamps an invoice's `companyId` from its
// Sales Order's governed operatingCompanyId, so one account can genuinely hold both Taylor and
// Ventana receivables. This view had no company dimension at all, so a consolidated outstanding
// figure looked exactly like a single-company one.
//
// The three claims below are the ones that must never regress, and the middle one is the
// sequencing claim: the governed function and this bundle ship separately, so a response that
// predates the dimension must render as it always did and must NOT imply a breakdown.

const arResult = (invoices, summary) => ({ status: "ready", invoices, summary });

test("a read WITHOUT the company dimension supplies no breakdown and claims none", () => {
  const view = accountArView({
    result: arResult(
      [{ invoiceId: "i1", invoiceNumber: "INV-1", currency: "USD", outstandingMinor: 100, arPosition: "CURRENT" }],
      { count: 1, openCount: 1, overdueCount: 0, outstandingByCurrency: { USD: 100 } },
    ),
  });
  assert.equal(view.company.supplied, false);
  assert.equal(view.company.spansMultipleCompanies, false);
  assert.deepEqual(view.company.rows, []);
  assert.equal(view.company.spanNote, null);
  assert.equal(view.company.spanLabel, null);
  // The row carries UNDEFINED, not null: "the read did not send a company" and "this invoice has
  // no company" are different facts and only the second is unattributed.
  assert.equal(view.rows[0].companyId, undefined);
  assert.equal(view.rows[0].companyLabel, null);
});

test("a single-company read adds nothing — one company is not a disclosure", () => {
  const view = accountArView({
    result: arResult(
      [{ invoiceId: "i1", invoiceNumber: "INV-1", companyId: "taylor", currency: "USD", outstandingMinor: 100, arPosition: "CURRENT" }],
      {
        count: 1, openCount: 1, overdueCount: 0, outstandingByCurrency: { USD: 100 },
        byCompany: { taylor: { count: 1, openCount: 1, overdueCount: 0, billedByCurrency: { USD: 100 }, collectedByCurrency: {}, outstandingByCurrency: { USD: 100 } } },
        companyIds: ["taylor"],
        spansMultipleCompanies: false,
      },
    ),
  });
  assert.equal(view.company.supplied, true);
  assert.equal(view.company.spansMultipleCompanies, false);
  assert.equal(view.company.spanNote, null);
  // The row still carries its company, so a surface that wants it has it; the SECTION just has
  // nothing to disclose.
  assert.equal(view.rows[0].companyId, "taylor");
  assert.equal(view.rows[0].companyLabel, "Taylor Freezer of Arizona");
});

test("a blended read discloses both companies and never guesses the unattributed one", () => {
  const view = accountArView({
    result: arResult(
      [
        { invoiceId: "i1", invoiceNumber: "INV-1", companyId: "taylor", currency: "USD", outstandingMinor: 100, arPosition: "OVERDUE", daysOverdue: 9 },
        { invoiceId: "i2", invoiceNumber: "INV-2", companyId: "ventana", currency: "USD", outstandingMinor: 250, arPosition: "CURRENT" },
        { invoiceId: "i3", invoiceNumber: "INV-3", companyId: null, currency: "USD", outstandingMinor: 75, arPosition: "CURRENT" },
      ],
      {
        count: 3, openCount: 3, overdueCount: 1, outstandingByCurrency: { USD: 425 },
        byCompany: {
          taylor: { count: 1, openCount: 1, overdueCount: 1, billedByCurrency: { USD: 100 }, collectedByCurrency: {}, outstandingByCurrency: { USD: 100 } },
          ventana: { count: 1, openCount: 1, overdueCount: 0, billedByCurrency: { USD: 250 }, collectedByCurrency: {}, outstandingByCurrency: { USD: 250 } },
          UNATTRIBUTED: { count: 1, openCount: 1, overdueCount: 0, billedByCurrency: { USD: 75 }, collectedByCurrency: {}, outstandingByCurrency: { USD: 75 } },
        },
        companyIds: ["UNATTRIBUTED", "taylor", "ventana"],
        spansMultipleCompanies: true,
      },
    ),
  });
  assert.equal(view.company.supplied, true);
  assert.equal(view.company.spansMultipleCompanies, true);
  assert.equal(view.company.unattributedPresent, true);
  // UNATTRIBUTED is not counted as a company. "3 companies" would invent one.
  assert.equal(view.company.spanLabel, "2 companies + unattributed");
  assert.match(view.company.spanNote, /Taylor Freezer of Arizona/);
  assert.match(view.company.spanNote, /Ventana/);
  assert.match(view.company.spanNote, /never\s+inferred/);
  // A null companyId is UNATTRIBUTED in words, never resolved onto Taylor or Ventana.
  assert.equal(view.rows[2].companyId, null);
  assert.equal(view.rows[2].companyLabel, "Not attributed to a company");
  assert.equal(view.rows[0].companyLabel, "Taylor Freezer of Arizona");
  assert.equal(view.rows[1].companyLabel, "Ventana");
  // The consolidated figure this page has always shown is UNCHANGED — the disclosure is additive,
  // and the per-company rows reconcile to it exactly (the server's own single-pass property).
  assert.deepEqual(view.outstandingLines.map((l) => l.currency), ["USD"]);
});

test("the section reads the SERVER'S span flag, not a recomputed companyIds.length", () => {
  // A server that reports several keys but does not set the flag must not be second-guessed here:
  // the flag is the authority, and re-deriving it is how two surfaces come to disagree.
  const view = accountArView({
    result: arResult(
      [{ invoiceId: "i1", invoiceNumber: "INV-1", companyId: "taylor", currency: "USD", outstandingMinor: 10, arPosition: "CURRENT" }],
      {
        count: 1, openCount: 1, overdueCount: 0, outstandingByCurrency: { USD: 10 },
        byCompany: { taylor: {}, ventana: {} },
        companyIds: ["taylor", "ventana"],
        // deliberately absent: spansMultipleCompanies
      },
    ),
  });
  assert.equal(view.company.supplied, true);
  assert.equal(view.company.spansMultipleCompanies, false);
});
