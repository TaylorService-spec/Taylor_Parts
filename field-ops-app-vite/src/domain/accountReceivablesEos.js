// ACCOUNT RECEIVABLES FROM EOS -- PURE adapter (no React, no Firebase, no network; node-testable).
// Firebase exit F7c (DECISIONS #245).
//
// WHERE AN EOS API IS DECLARED, the Account page's receivables (the Accounts Receivable section, the health strip's
// Outstanding AR and the Attention section's overdue rows) are the Finance register's RECEIVABLE obligations of that one
// CRM Account, read through `listObligations` (POST /operations/finance, finance.payment.read + the caller's explicit
// operating-company assignment). This module turns those rows into the SAME envelope the Firebase callable
// `listAccountInvoiceAr` returned -- `{ status, invoices[], summary }` -- so `domain/accountArView.js` and every screen over it
// are unchanged. Everywhere else the Firebase callable is the sole source and this module is not consulted.
//
// WHAT THE ROWS ARE, AND ARE NOT. An EOS receivable is EOS operational truth that money is owed (DECISIONS #197): NOT the
// accounting invoice. It has no invoice number and no issue date, so those fields are absent (null), never invented. The
// Sales Order reference IS carried where the receivable was billed from a Sales Order (F-2: listObligations' sourceSalesOrder,
// obligation -> billing package -> Sales Order); otherwise it too is null. The result carries `recordNoun: "Receivable"` so the
// screen words the record truthfully.
//
// NO AUTHORITY HERE. The server decided which companies and rows this caller may see before a row reached this file. This
// module classifies and totals the rows it was given, per currency, and nothing else:
//   * Position is CLASSIFIED from the server's own facts: status VOID/SETTLED, the server's `overdue` flag (its due date
//     against the company's business date), and whether a due date is governed at all. The client never compares a date.
//   * The totals mirror functions/src/finance/financeReadProjection.ts summarizeAccountAr, except VOID rows are excluded from open, partitioned by the row's own
//     governed operating company, and never blended across currencies.
//   * A page the server may have truncated, or an amount that is not a safe integer, is UNAVAILABLE -- never a confident
//     partial total (the same rule the Firebase read applied with its limit+1 probe).

/** The server's cap on one `listObligations` page (financeOperations.ts obligationRows(..., 200)). */
export const OBLIGATION_PAGE_LIMIT = 200;

/** What an EOS receivable is called on screen. The Firebase source says "Invoice" (the default in accountArView.js). */
export const EOS_RECORD_NOUN = "Receivable";

const UNAVAILABLE = Object.freeze({ status: "unavailable", invoices: Object.freeze([]), summary: null });

const safeMinor = (v) => {
  const n = typeof v === "number" ? v : typeof v === "string" && /^-?\d+$/.test(v) ? Number(v) : NaN;
  return Number.isSafeInteger(n) ? n : null;
};

/** The AR position of one obligation row, from the server's own facts. Mirrors deriveArPosition in financeReadProjection.ts. */
export function receivablePosition(row, outstandingMinor) {
  if (row.status === "VOID") return "VOID";
  if (row.status === "SETTLED" || outstandingMinor <= 0) return "SETTLED";
  if (row.overdue === true) return "OVERDUE";
  return typeof row.dueOn === "string" && row.dueOn.length > 0 ? "CURRENT" : "UNKNOWN";
}

const add = (map, key, n) => {
  map[key] = (map[key] ?? 0) + n;
};

/**
 * One envelope from the receivable rows of ONE account across the companies the caller reaches.
 *
 * `pages` is an array of `{ items, truncated }` -- one per company read (items are `listObligations` rows). Any truncated page,
 * a malformed row or an unsafe amount makes the whole answer "unavailable".
 */
export function accountArFromObligations(pages) {
  if (!Array.isArray(pages)) return UNAVAILABLE;
  const invoices = [];
  for (const page of pages) {
    if (!page || !Array.isArray(page.items) || page.truncated === true) return UNAVAILABLE;
    for (const row of page.items) {
      if (!row || typeof row.id !== "string" || typeof row.currency !== "string") return UNAVAILABLE;
      const total = safeMinor(row.originatedMinor);
      const applied = safeMinor(row.settledMinor);
      const outstanding = safeMinor(row.outstandingMinor);
      if (total === null || applied === null || outstanding === null) return UNAVAILABLE;
      const position = receivablePosition(row, outstanding);
      invoices.push({
        invoiceId: row.id,
        // The Finance register's own reference is the obligation id (the Financials workspace shows it as "Record").
        invoiceNumber: null,
        accountId: row.counterparty?.crmAccountId ?? null,
        companyId: typeof row.operatingCompanyId === "string" ? row.operatingCompanyId : null,
        salesOrderId: row.sourceSalesOrder?.id ?? null,
        salesOrderNumber: row.sourceSalesOrder?.salesOrderNumber ?? null,
        currency: row.currency,
        state: row.status ?? null,
        totalMinor: total,
        appliedMinor: applied,
        outstandingMinor: outstanding,
        dueDate: null,
        arPosition: position,
        // listObligations supplies the overdue FLAG, not a day count; a day count is never computed from a date here.
        daysOverdue: null,
      });
    }
  }
  return Object.freeze({ status: "ready", invoices, summary: summarizeReceivables(invoices), recordNoun: EOS_RECORD_NOUN });
}

/**
 * A6: the same envelope from the customer-balance SUMMARY (`readAccountBalanceSummary`, finance.accountBalance.read), for a caller who holds no
 * Finance workspace. There are NO rows -- the server returns five numbers per company and currency and nothing else -- so `invoices` is empty and
 * `summaryOnly` tells accountArView to render the totals instead of reading an empty list as "nothing owed". Money is only ever added within one
 * currency. A non-READY answer (the server's UNAVAILABLE) or an unsafe amount is "unavailable", never a confident partial figure.
 */
export function accountArFromBalanceSummary(answer) {
  if (!answer || answer.status !== "READY" || !Array.isArray(answer.summaries)) return UNAVAILABLE;
  const summaryRows = [];
  const outstandingByCurrency = {};
  let openCount = 0;
  let overdueCount = 0;
  for (const s of answer.summaries) {
    const outstanding = safeMinor(s?.outstandingMinor);
    const overdue = safeMinor(s?.overdueMinor);
    if (typeof s?.operatingCompanyId !== "string" || typeof s.currency !== "string" || outstanding === null || overdue === null
      || !Number.isSafeInteger(s.openReceivableCount) || !Number.isSafeInteger(s.overdueCount)) return UNAVAILABLE;
    summaryRows.push({ companyId: s.operatingCompanyId, currency: s.currency, openCount: s.openReceivableCount, outstandingMinor: outstanding,
      overdueCount: s.overdueCount, overdueMinor: overdue });
    openCount += s.openReceivableCount;
    overdueCount += s.overdueCount;
    add(outstandingByCurrency, s.currency, outstanding);
  }
  return Object.freeze({
    status: "ready", invoices: [], summaryOnly: true, summaryRows, recordNoun: EOS_RECORD_NOUN,
    summary: { count: openCount, openCount, overdueCount, outstandingByCurrency },
    ...(answer.restricted === true ? { restricted: true } : {}),
  });
}

const UNATTRIBUTED = "UNATTRIBUTED";

/**
 * Mirrors the server overview (financeOperations.ts readFinanceOverview): a VOID record counts in NOTHING -- not the count, not billed, not collected,
 * not open, and it opens no company row. The rows themselves still list (a void receivable is shown as void); only the totals leave it out.
 */
export function summarizeReceivables(reads) {
  const billedByCurrency = {};
  const collectedByCurrency = {};
  const outstandingByCurrency = {};
  const byCompany = {};
  let openCount = 0;
  let overdueCount = 0;
  let count = 0;
  for (const r of reads) {
    if (r.arPosition === "VOID") continue;
    count += 1;
    const key = typeof r.companyId === "string" && r.companyId.trim().length > 0 ? r.companyId : UNATTRIBUTED;
    const company = (byCompany[key] ??= {
      count: 0, openCount: 0, overdueCount: 0, billedByCurrency: {}, collectedByCurrency: {}, outstandingByCurrency: {},
    });
    company.count += 1;
    add(billedByCurrency, r.currency, r.totalMinor);
    add(company.billedByCurrency, r.currency, r.totalMinor);
    add(collectedByCurrency, r.currency, r.appliedMinor);
    add(company.collectedByCurrency, r.currency, r.appliedMinor);
    if (r.outstandingMinor > 0) {
      openCount += 1;
      company.openCount += 1;
      add(outstandingByCurrency, r.currency, r.outstandingMinor);
      add(company.outstandingByCurrency, r.currency, r.outstandingMinor);
    }
    if (r.arPosition === "OVERDUE") {
      overdueCount += 1;
      company.overdueCount += 1;
    }
  }
  const companyIds = Object.keys(byCompany).sort();
  return {
    count, openCount, overdueCount, billedByCurrency, collectedByCurrency, outstandingByCurrency,
    byCompany, companyIds, spansMultipleCompanies: companyIds.length > 1,
  };
}
