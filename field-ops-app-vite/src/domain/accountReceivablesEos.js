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
// accounting invoice. It has no invoice number, no Sales Order reference and no issue date, so those fields are absent
// (null), never invented; the result carries `recordNoun: "Receivable"` so the screen words the record truthfully.
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
        salesOrderId: null,
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
  return Object.freeze({ status: "ready", invoices, summary: summarize(invoices), recordNoun: EOS_RECORD_NOUN });
}

const UNATTRIBUTED = "UNATTRIBUTED";

/** Mirrors summarizeAccountAr (functions/src/finance/financeReadProjection.ts), except VOID rows are excluded from open: a void record is never owed. */
function summarize(reads) {
  const billedByCurrency = {};
  const collectedByCurrency = {};
  const outstandingByCurrency = {};
  const byCompany = {};
  let openCount = 0;
  let overdueCount = 0;
  for (const r of reads) {
    const key = typeof r.companyId === "string" && r.companyId.trim().length > 0 ? r.companyId : UNATTRIBUTED;
    const company = (byCompany[key] ??= {
      count: 0, openCount: 0, overdueCount: 0, billedByCurrency: {}, collectedByCurrency: {}, outstandingByCurrency: {},
    });
    company.count += 1;
    add(billedByCurrency, r.currency, r.totalMinor);
    add(company.billedByCurrency, r.currency, r.totalMinor);
    add(collectedByCurrency, r.currency, r.appliedMinor);
    add(company.collectedByCurrency, r.currency, r.appliedMinor);
    if (r.outstandingMinor > 0 && r.arPosition !== "VOID") {
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
    count: reads.length, openCount, overdueCount, billedByCurrency, collectedByCurrency, outstandingByCurrency,
    byCompany, companyIds, spansMultipleCompanies: companyIds.length > 1,
  };
}
