// FINANCIALS FROM EOS -- PURE adapters (no React, no Firebase, no network; node-testable). Firebase exit B1 (DECISIONS #B1).
//
// WHERE AN EOS API IS DECLARED, the Financials pages read the Finance register (POST /operations/finance: readFinanceOverview,
// listObligations, readObligation, listSettlements, readSettlement). The SERVER decides every company and every row (the
// company boundary AND the credited-person / team reach, eosFinance/financeVisibility.ts); this module only reshapes what the
// server answered. It adds nothing up: every total is the server's, per currency, never blended.
//
// WHAT AN EOS RECEIVABLE IS, AND IS NOT (DECISIONS #197, #191). It is EOS operational truth that money is owed. It is NOT the
// accounting invoice. Fields the Finance register does not carry are NOT SUPPLIED, and each is NAMED as a model decision rather
// than invented or silently dropped:
//   MD-B1-1  invoice number   F-1a: EOS issues the invoice (INV-YYYY-######) against a receivable, 1:1; the number is supplied once one is issued
//                             (the row's `invoice`), and is not supplied while none has been
//   MD-B1-2  issue date       the same: the invoice's issue date once issued; the register's own recorded-at is never passed off as one
//   MD-B1-3  business unit    obligations carry none; line-level business unit lives on Sales Order / billing lines and no
//                             roll-up rule has been decided
// The credited salesperson IS supplied, for attributed rows only (derived from the source Sales Order; never the Account owner).

import { summarizeReceivables } from "./accountReceivablesEos.js";

/** The fact families `listFinancialFacts` served, each backed by a persisted record. In EOS: INVOICE <- receivable obligations; PAYMENT_RECEIPT <- customer-payment settlements; PAYMENT_APPLICATION <- their applications. */
export const FACT_TYPES = Object.freeze(["INVOICE", "PAYMENT_RECEIPT", "PAYMENT_APPLICATION"]);

/** The server's cap on one `listSettlements` page (financeOperations.ts listSettlements ... LIMIT 100). */
export const SETTLEMENT_PAGE_LIMIT = 100;

/** What an EOS receivable is called on screen (the Firebase source says "Invoice"). */
export const EOS_RECEIVABLE_NOUN = "Receivable";
export const EOS_SETTLEMENT_NOUN = "Settlement";

/** The named model decisions behind a field the register does not supply. */
export const NOT_SUPPLIED = Object.freeze({
  invoiceNumber: Object.freeze({ id: "MD-B1-1", words: "Not supplied (model decision MD-B1-1: no invoice has been issued for this receivable yet)" }),
  issueDate: Object.freeze({ id: "MD-B1-2", words: "Not supplied (model decision MD-B1-2: no invoice has been issued, so there is no issue date)" }),
  businessUnit: Object.freeze({ id: "MD-B1-3", words: "Not supplied (model decision MD-B1-3: receivables carry no business unit)" }),
});

const safeInt = (v) => {
  const n = typeof v === "number" ? v : typeof v === "string" && /^-?\d+$/.test(v) ? Number(v) : NaN;
  return Number.isSafeInteger(n) ? n : null;
};

/** `YYYY-MM-DD` -> the local-midnight instant the pages already format with toLocaleDateString (a format change, not a computation). */
export const dayMillis = (day) => {
  const m = typeof day === "string" ? /^(\d{4})-(\d{2})-(\d{2})/.exec(day) : null;
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() : null;
};

/** The invoice's issue instant in ms, or null when there is no invoice (or an unreadable instant). */
const invoiceIssuedAtMillis = (invoice) => {
  const ms = typeof invoice?.issuedAt === "string" ? Date.parse(invoice.issuedAt) : Number.NaN;
  return Number.isFinite(ms) ? ms : null;
};

/** The AR position of one obligation row, from the server's own facts (mirrors receivablePosition in accountReceivablesEos.js). */
export function receivablePosition(row) {
  if (row.status === "VOID") return "VOID";
  if (row.status === "SETTLED" || Number(row.outstandingMinor) <= 0) return "SETTLED";
  if (row.overdue === true) return "OVERDUE";
  return typeof row.dueOn === "string" && row.dueOn.length > 0 ? "CURRENT" : "UNKNOWN";
}

/** One `listObligations` row -> the invoice-shaped record the Financials pages render. null when a field is unsafe (the read is then unavailable). */
export function receivableRecord(row) {
  if (!row || typeof row.id !== "string" || typeof row.currency !== "string") return null;
  const totalMinor = safeInt(row.originatedMinor), appliedMinor = safeInt(row.settledMinor), outstandingMinor = safeInt(row.outstandingMinor);
  if (totalMinor === null || appliedMinor === null || outstandingMinor === null) return null;
  return {
    invoiceId: row.id,
    // F-1a: the number of the invoice issued against this receivable (1:1); null while none has been (NOT_SUPPLIED.invoiceNumber then states why).
    invoiceNumber: row.invoice?.invoiceNumber ?? null,
    accountId: row.counterparty?.crmAccountId ?? null,
    counterpartyName: row.counterparty?.name ?? null,
    companyId: typeof row.operatingCompanyId === "string" ? row.operatingCompanyId : null,
    // F-2: the Sales Order the receivable was billed from, where the register carries one (listObligations' sourceSalesOrder); null otherwise.
    salesOrderId: row.sourceSalesOrder?.id ?? null,
    salesOrderNumber: row.sourceSalesOrder?.salesOrderNumber ?? null,
    currency: row.currency,
    state: row.status ?? null,
    totalMinor, appliedMinor, outstandingMinor,
    issuedAtMillis: invoiceIssuedAtMillis(row.invoice),
    dueDate: dayMillis(row.dueOn),
    arPosition: receivablePosition(row),
    daysOverdue: null,
    businessUnitIds: [],
    creditedSalespersonId: null,
    creditsMinor: null, chargesMinor: null, writeOffMinor: null,
  };
}

/** The server's `readFinanceOverview` currency row -> the summary / aging shapes financialFactsView.js reads. Numbers only when safe. */
function currencyRow(r) {
  const billed = safeInt(r.billedMinor), collected = safeInt(r.collectedMinor), outstanding = safeInt(r.outstandingMinor);
  const a = r.aging ?? {};
  const aging = {
    totalOutstandingMinor: outstanding, currentMinor: safeInt(a.currentMinor), days1to30Minor: safeInt(a.days1to30Minor),
    days31to60Minor: safeInt(a.days31to60Minor), days61PlusMinor: safeInt(a.days61PlusMinor), unagedMinor: safeInt(a.unagedMinor),
  };
  if ([billed, collected, outstanding, ...Object.values(aging)].some((v) => v === null)) return null;
  return { currency: String(r.currency), billed, collected, outstanding, aging, count: Number(r.count) || 0, openCount: Number(r.openCount) || 0, overdueCount: Number(r.overdueCount) || 0 };
}

/**
 * One envelope (the shape `listFinancialFacts` answered, so every page over it is unchanged) from the SERVER's overview answers
 * and receivable rows.
 *
 *   overview   a `readFinanceOverview` result for the scope shown (consolidated, or one company), or null when the scope has no
 *              single server total (a principal that reaches only SOME companies): totals are then ABSENT, never added here.
 *   pages      `[{ items, truncated }]` -- the `listObligations` rows read, one page per company read.
 *   accountScoped  the rows were narrowed to ONE account, so no company total answers for them: the summary is the mirror of the account read's
 *              (accountReceivablesEos.js summarizeReceivables) over the rows, and a truncated page is then unavailable, never a partial total.
 *   restricted the access answer's own flag: the principal reaches only the receivables credited to it / its team. An account-scoped read asks for no
 *              overview (the overview is where `restricted` used to come from), so the flag travels from the access answer and the screen can say the
 *              figures cover only what the reader may see.
 */
export function receivablesEnvelope({ overview, pages, accountScoped = false, restricted = false }) {
  const invoices = [];
  let truncated = false;
  for (const page of pages ?? []) {
    if (!page || !Array.isArray(page.items)) return Object.freeze({ status: "unavailable", invoices: Object.freeze([]), recordNoun: EOS_RECEIVABLE_NOUN });
    truncated = truncated || page.truncated === true;
    for (const row of page.items) {
      const rec = receivableRecord(row);
      if (rec === null) return Object.freeze({ status: "unavailable", invoices: Object.freeze([]), recordNoun: EOS_RECEIVABLE_NOUN });
      invoices.push(rec);
    }
  }
  const out = { status: "ready", recordNoun: EOS_RECEIVABLE_NOUN, source: "EOS", invoices, payments: [], applications: [], truncated };
  out.restricted = restricted === true;
  if (!overview && accountScoped) {
    if (truncated) return Object.freeze({ status: "unavailable", invoices: Object.freeze([]), recordNoun: EOS_RECEIVABLE_NOUN });
    out.summary = summarizeReceivables(invoices);
  }
  if (overview) {
    const rows = (overview.currencies ?? []).map(currencyRow);
    if (rows.some((r) => r === null)) return Object.freeze({ status: "unavailable", invoices: Object.freeze([]), recordNoun: EOS_RECEIVABLE_NOUN });
    const by = (field) => Object.fromEntries(rows.map((r) => [r.currency, r[field]]));
    out.summary = {
      count: rows.reduce((n, r) => n + r.count, 0), openCount: rows.reduce((n, r) => n + r.openCount, 0), overdueCount: rows.reduce((n, r) => n + r.overdueCount, 0),
      billedByCurrency: by("billed"), collectedByCurrency: by("collected"), outstandingByCurrency: by("outstanding"),
    };
    out.agingByCurrency = Object.fromEntries(rows.map((r) => [r.currency, r.aging]));
    out.byCompany = (overview.byCompany ?? []).map((c) => ({ key: String(c.operatingCompanyId), invoiceCount: Number(c.count) || 0,
      billedByCurrency: { [c.currency]: safeInt(c.billedMinor) ?? 0 }, collectedByCurrency: { [c.currency]: safeInt(c.collectedMinor) ?? 0 },
      outstandingByCurrency: { [c.currency]: safeInt(c.outstandingMinor) ?? 0 } }));
    out.restricted = restricted === true || overview.visibility?.restricted === true;
  }
  return Object.freeze(out);
}

// ─── payment facts (F-2) ───

/**
 * The PAYMENT_RECEIPT / PAYMENT_APPLICATION facts from the server's settlements (`listSettlements` items, which carry their applications and
 * counterparty). A receipt is a RECORDED customer-payment settlement; an application is one of its APPLIED applications (a reversed one is no
 * longer an application of cash, a voided settlement is no receipt). Every other settlement kind (provider funding, vendor and intercompany) is not
 * a customer receipt and is not a fact in these families.
 *
 * MD-F2-1  PERIOD. A receipt is placed by its BUSINESS DATE (the date the cash was received). An application is placed with the receipt it applies:
 *          the server windows settlements by business date, so an application recorded later against an earlier receipt belongs to that receipt's
 *          period, not its own (its recorded instant is still carried as appliedAtMillis for display).
 * MD-F2-2  invoiceId. An application's `invoiceId` is the OBLIGATION id, which is the id of the invoice-shaped receivable record (receivableRecord),
 *          so applications join to the receivables of the same answer exactly as they joined to invoices.
 *
 * `accountId` only NARROWS (rows whose counterparty is that CRM Account); a malformed row or unsafe amount makes the whole answer null (unavailable).
 *
 * @param {{ items?: object[] }[]} pages  one `listSettlements` answer per company read
 * @param {{ accountId?: string|null }} [narrow]
 * @returns {{ payments: object[], applications: object[], truncated: boolean }|null}
 */
export function paymentFacts(pages, { accountId = null } = {}) {
  const payments = [];
  const applications = [];
  let truncated = false;
  for (const page of pages ?? []) {
    if (!page || !Array.isArray(page.items)) return null;
    truncated = truncated || page.truncated === true;
    for (const s of page.items) {
      if (!s || typeof s.id !== "string" || typeof s.currency !== "string") return null;
      if (s.kind !== "CUSTOMER_PAYMENT" || s.status === "VOID") continue;
      const crmAccountId = s.counterparty?.crmAccountId ?? null;
      if (accountId !== null && crmAccountId !== accountId) continue;
      const amountMinor = safeInt(s.amountMinor), appliedMinor = safeInt(s.appliedMinor);
      if (amountMinor === null || appliedMinor === null) return null;
      payments.push({
        paymentId: s.id, invoiceId: null, accountId: crmAccountId, companyId: typeof s.operatingCompanyId === "string" ? s.operatingCompanyId : null,
        currency: s.currency, amountMinor, appliedMinor, receivedAtMillis: dayMillis(s.businessDate), method: s.method ?? null,
        externalRef: typeof s.sourceReference === "string" && s.sourceReference.length > 0 ? s.sourceReference : null,
      });
      for (const a of Array.isArray(s.applications) ? s.applications : []) {
        if (!a || a.status !== "APPLIED") continue;
        const appliedAmountMinor = safeInt(a.amountMinor);
        if (typeof a.id !== "string" || typeof a.obligationId !== "string" || appliedAmountMinor === null) return null;
        const at = typeof a.appliedAt === "string" ? Date.parse(a.appliedAt) : Number.NaN;
        applications.push({
          applicationId: a.id, invoiceId: a.obligationId, paymentId: s.id, companyId: typeof s.operatingCompanyId === "string" ? s.operatingCompanyId : null,
          currency: s.currency, appliedAmountMinor, appliedAtMillis: Number.isFinite(at) ? at : null,
        });
      }
    }
  }
  return { payments, applications, truncated };
}

// ─── periods ───

const PHOENIX_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Phoenix", year: "numeric", month: "2-digit", day: "2-digit" });
/** An instant -> its calendar day in the governed reporting zone (America/Phoenix, G-05). */
export const reportingDay = (millis) => PHOENIX_DAY.format(new Date(millis));

/**
 * The period selection (periodStartMillis, periodEndMillis INCLUSIVE) -> the EOS request windows. Receivables narrow by the date EOS
 * RECORDED them (`recordedFrom` inclusive, `recordedTo` exclusive instants); settlements by their business date.
 */
export function periodWindows(filters) {
  const start = Number.isFinite(filters?.periodStartMillis) ? filters.periodStartMillis : null;
  const end = Number.isFinite(filters?.periodEndMillis) ? filters.periodEndMillis : null;
  return {
    receivables: { ...(start !== null ? { recordedFrom: new Date(start).toISOString() } : {}), ...(end !== null ? { recordedTo: new Date(end + 1).toISOString() } : {}) },
    settlements: { ...(start !== null ? { businessDateFrom: reportingDay(start) } : {}), ...(end !== null ? { businessDateTo: reportingDay(end + 1) } : {}) },
  };
}

// ─── settlements ───

const KIND_WORDS = Object.freeze({
  CUSTOMER_PAYMENT: "Customer payment", PROVIDER_FUNDING: "Provider funding", VENDOR_PAYMENT: "Vendor payment",
  INTERCOMPANY_PAYMENT: "Intercompany payment", INTERCOMPANY_RECEIPT: "Intercompany receipt",
});
export const settlementKindWords = (kind) => KIND_WORDS[kind] ?? (typeof kind === "string" ? kind : "Not recorded");

/** One server settlement -> the row the Settlements list renders (amounts are the server's; sortable minor units kept beside). */
export function settlementRecord(s) {
  if (!s || typeof s.id !== "string" || typeof s.currency !== "string") return null;
  const amountMinor = safeInt(s.amountMinor), appliedMinor = safeInt(s.appliedMinor), unappliedMinor = safeInt(s.unappliedMinor);
  if (amountMinor === null || appliedMinor === null || unappliedMinor === null) return null;
  return {
    id: s.id, operatingCompanyId: s.operatingCompanyId ?? null, kind: s.kind, direction: s.direction ?? null, currency: s.currency,
    amountMinor, appliedMinor, unappliedMinor, businessDate: s.businessDate ?? null, businessDateMillis: dayMillis(s.businessDate),
    sourceReference: s.sourceReference ?? null, method: s.method ?? null, status: s.status ?? null, reconciliationStatus: s.reconciliationStatus ?? null,
    notes: s.notes ?? null, voidReason: s.voidReason ?? null, replacesSettlementId: s.replacesSettlementId ?? null,
    recordedAt: s.recordedAt ?? null, recordedBy: s.recordedBy ?? null,
    applications: Array.isArray(s.applications) ? s.applications : [], reconciliations: Array.isArray(s.reconciliations) ? s.reconciliations : [],
  };
}

/** Whether the server restricted what this principal reads (a restricted reader sees a part of the book, and the page says so). */
export const isRestrictedView = (accessResult) => accessResult?.restricted === true;

/** The companies a principal can OPEN: reached AND with something visible (a company whose inner reach is empty reads nothing). */
export function readableCompanies(accessResult) {
  const list = Array.isArray(accessResult?.companies) ? accessResult.companies : null;
  if (list === null) return null;
  return list.filter((c) => typeof c?.operatingCompanyId === "string" && c.visibility !== "RESTRICTED_EMPTY");
}
