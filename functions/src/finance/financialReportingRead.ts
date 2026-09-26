// Finance — the governed REPORTING read seam.
//
// ════════════════════ WHY THIS EXISTS ════════════════════
//
// `listAccountInvoiceAr` answers one question — "what does THIS account owe" — and Customer
// Financials consumes it. Every other Financials North Star page needs the SAME governed facts
// sliced a different way (by company, by business unit, by credited salesperson, by period), and
// there was no read that could do it. This is that read, and nothing more.
//
// IT CREATES NO FINANCIAL TRUTH. It queries the same Admin-SDK-only collections, filters them
// through the SAME FIN-004 authority, and derives with the SAME canonical helpers
// (financeReadProjection.ts) that the account-scoped read already uses. There is no second
// outstanding formula, no second aging rule, no second visibility predicate here.
//
// ════════════════════ FILTERS ARE NOT AUTHORIZATION ════════════════════
//
// THE ORDER OF OPERATIONS IS THE WHOLE SECURITY ARGUMENT, so it is structural rather than
// documented: `visibleDocs` is computed from the authority predicate BEFORE any caller filter is
// consulted, and the requested filters are applied to that already-authorized set. A caller
// filter can therefore only ever remove rows. It is not possible to express "widen" in this code
// path — a companyId the principal cannot reach simply matches nothing, and asking for another
// person's creditedSalespersonId under SELF reach returns empty rather than their numbers.
//
// ════════════════════ WHAT IT DELIBERATELY DOES NOT DO ════════════════════
//
//   · no GOAL / BUDGET / FORECAST / COST / MARGIN fact types — none of those are persisted, and
//     synthesizing them here is exactly the fabrication the family forbids;
//   · no external reconciliation and no IN_SYNC/DRIFT — FIN-010 has no results surface;
//   · no cross-currency summation — balances stay per currency, as the account read already does;
//   · no client Firestore access — the collections remain deny-all to clients.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldPath, getFirestore, type Firestore, type Query, type DocumentSnapshot } from "firebase-admin/firestore";
import {
  INVOICES_COLLECTION,
  PAYMENTS_COLLECTION,
  PAYMENT_APPLICATIONS_COLLECTION,
} from "../constants/collections";
import {
  projectInvoiceAr,
  summarizeAccountAr,
  summarizeArAging,
  summarizeArAgingByCompany,
  type InvoiceArRead,
  type ArAgingBucket,
} from "./financeReadProjection";
import { invoiceVisibilityFacts, type FinancialVisibilityAuthority } from "./financialVisibility";
import { loadFinancialVisibilityAuthority } from "./financeReadCallables";

/** The fact families this read can serve — each backed by a persisted collection, no synthesis. */
export const REPORTING_FACT_TYPES = ["INVOICE", "PAYMENT_RECEIPT", "PAYMENT_APPLICATION"] as const;
export type ReportingFactType = (typeof REPORTING_FACT_TYPES)[number];

/**
 * PAGE SIZE bound. `limit` used to be the whole answer: a collection with one row more than it made
 * the read `unavailable` — at 201 invoices under the client's default — so every Financials page
 * went dark the moment the business grew past a few hundred facts. It is now the size of ONE cursor
 * page of a complete read; the read keeps paging until the collection is exhausted.
 */
export const MAX_REPORTING_LIMIT = 500;
export const DEFAULT_REPORTING_LIMIT = MAX_REPORTING_LIMIT;

/**
 * HARD CEILING on documents read per fact collection in ONE call. Past it the read does not guess:
 * it stops, returns NO rows and NO figures, and says PARTIAL with the counts. Bounded so one call
 * stays inside the callable's memory, time and 10 MB response budget.
 */
export const REPORTING_SCAN_CEILING = 5_000;

/**
 * ════════ THE COMPLETENESS CONTRACT ════════
 *
 *   COMPLETE  every document in every scanned collection was read. Only then is `status` "ready",
 *             and only then does the payload carry rows, summaries, aging and rollups.
 *   PARTIAL   some documents were read but not all (the scan ceiling was reached, or a page failed
 *             after earlier pages succeeded). NOTHING derived from the partial set is returned —
 *             a partial total is never presented as a total, not even labelled.
 *   NOT_READ  nothing was read (no reach, a missing index, or the first page failed).
 *
 * A non-COMPLETE answer always names its `reason` and carries the per-collection counts, so a page
 * can say "5,000 of more than 5,000 invoices were read; nothing is shown" instead of an empty page.
 */
export type ReportingCompletenessStatus = "COMPLETE" | "PARTIAL" | "NOT_READ";
export type ReportingIncompleteReason =
  | "NO_REACH"
  | "SCAN_CEILING_REACHED"
  | "INDEX_MISSING"
  | "READ_FAILED";

export interface ReportingCollectionScan {
  collection: string;
  /** Documents actually read from this collection by this call. */
  documentsRead: number;
  pages: number;
  /** True only when the collection (or its account-narrowed query) was read to exhaustion. */
  exhausted: boolean;
}

export interface FinancialFactsCompleteness {
  status: ReportingCompletenessStatus;
  reason: ReportingIncompleteReason | null;
  pageSize: number;
  scanCeiling: number;
  scans: ReportingCollectionScan[];
}

export interface FinancialFactsFilters {
  companyId?: string | null;
  businessUnitId?: string | null;
  creditedSalespersonId?: string | null;
  accountId?: string | null;
  periodStartMillis?: number | null;
  periodEndMillis?: number | null;
  factTypes?: ReportingFactType[] | null;
}

/**
 * One invoice, projected for reporting: the canonical AR read PLUS its frozen attribution dimensions.
 *
 * `companyId` is NOT redeclared here any more. It used to be, back when the canonical AR projection
 * dropped the governed operating company entirely and this interface had to add it back — which
 * meant the account-scoped read served company-blind figures while this one did not. The company is
 * now part of `InvoiceArRead` itself, so both reads carry the same governed fact from the same place.
 */
export interface InvoiceReportRead extends InvoiceArRead {
  creditedSalespersonId: string | null;
  businessUnitIds: string[];
  issuedAtMillis: number | null;
}

export interface PaymentReportRead {
  paymentId: string;
  invoiceId: string | null;
  accountId: string | null;
  companyId: string | null;
  currency: string | null;
  amountMinor: number;
  appliedMinor: number;
  receivedAtMillis: number | null;
  method: string | null;
  /** The operator's own reference for this receipt (cheque number, ACH id). Persisted, often null. */
  externalRef: string | null;
}

export interface PaymentApplicationReportRead {
  applicationId: string;
  invoiceId: string | null;
  paymentId: string | null;
  companyId: string | null;
  currency: string | null;
  appliedAmountMinor: number;
  appliedAtMillis: number | null;
}

export interface FinancialFactsResult {
  /** "ready" if and only if `completeness.status` is COMPLETE. Kept for deployed clients. */
  status: "ready" | "unavailable";
  completeness: FinancialFactsCompleteness;
  invoices: InvoiceReportRead[];
  payments: PaymentReportRead[];
  applications: PaymentApplicationReportRead[];
  summary: ReturnType<typeof summarizeAccountAr>;
  /** Server-derived A/R aging, per currency. The client never buckets outstanding balances. */
  agingByCurrency: Record<string, ArAgingBucket>;
  /**
   * The SAME aging, partitioned by governed operating company (UNATTRIBUTED_COMPANY for facts with
   * none). `agingByCurrency` above is a consolidated row: for a principal who reaches both governed
   * companies and has selected no company filter, it blends them, and nothing in the payload said
   * so. This is the company dimension that blend was missing — the same buckets, from the same rule,
   * per company.
   */
  agingByCompany: Record<string, Record<string, ArAgingBucket>>;
  /** Per-dimension rollups, derived HERE (server-side) so React never totals authoritative money. */
  byCompany: DimensionRollup[];
  byBusinessUnit: DimensionRollup[];
  byCreditedSalesperson: DimensionRollup[];
  /** The scopes that actually conferred reach — so a surface can explain what it is showing. */
  grantedScopes: string[];
  /** Dimensions present on NO visible fact, so a page can say "not attributed" instead of "zero". */
  unattributed: { businessUnit: number; creditedSalesperson: number };
}

export interface DimensionRollup {
  key: string;
  invoiceCount: number;
  /** Per currency — never summed across currencies. */
  billedByCurrency: Record<string, number>;
  /** Cash APPLIED to these invoices — a persisted fact, not a payments-side re-derivation. */
  collectedByCurrency: Record<string, number>;
  outstandingByCurrency: Record<string, number>;
}

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const nn = (v: unknown): number => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : 0);

/** Attribution dimensions off a stored invoice — the SAME extraction the visibility predicate uses. */
export function invoiceReportDimensions(doc: Record<string, unknown>): {
  companyId: string | null;
  creditedSalespersonId: string | null;
  businessUnitIds: string[];
  issuedAtMillis: number | null;
} {
  const facts = invoiceVisibilityFacts(doc);
  const units = (facts.lineBusinessUnitIds ?? []).filter(nonEmpty);
  return {
    companyId: facts.companyId ?? null,
    creditedSalespersonId: facts.creditedSalespersonId ?? null,
    businessUnitIds: Array.from(new Set(units)),
    issuedAtMillis: typeof doc.issuedAtMillis === "number" ? doc.issuedAtMillis : null,
  };
}

/**
 * Does this already-AUTHORIZED invoice match the caller's requested narrowing?
 *
 * Every clause can only remove rows. A requested dimension that the invoice does not carry is a
 * non-match — never a pass-through — so asking for a business unit the facts cannot attribute
 * returns nothing rather than everything.
 */
export function matchesRequestedFilters(
  read: Pick<InvoiceReportRead, "companyId" | "creditedSalespersonId" | "businessUnitIds" | "accountId" | "issuedAtMillis">,
  f: FinancialFactsFilters,
): boolean {
  if (nonEmpty(f.companyId) && read.companyId !== f.companyId) return false;
  if (nonEmpty(f.accountId) && read.accountId !== f.accountId) return false;
  if (nonEmpty(f.creditedSalespersonId) && read.creditedSalespersonId !== f.creditedSalespersonId) return false;
  if (nonEmpty(f.businessUnitId) && !read.businessUnitIds.includes(f.businessUnitId)) return false;
  // The invoice's own canonical event date. Period is applied through withinPeriod so every fact
  // type is judged by ITS OWN persisted date — see CANONICAL EVENT DATES above.
  if (!withinPeriod(read.issuedAtMillis, f)) return false;
  return true;
}

/**
 * ════════ CANONICAL EVENT DATES, one per fact type ════════
 *
 * A period means "when did this happen", and each fact type records that differently:
 *
 *   INVOICE             issuedAtMillis   — stamped when the invoice was issued
 *   PAYMENT_RECEIPT     receivedAtMillis — the caller-asserted, command-validated date the CASH
 *                                          was received. A business fact, not a write timestamp.
 *   PAYMENT_APPLICATION appliedAtMillis  — when the application was recorded against the invoice
 *
 * All three are PERSISTED by the governed commands. None is invented, and an invoice date is never
 * copied onto a payment: filtering receipts by the issue date of the invoice they settle answers a
 * question nobody asked ("cash against invoices raised in March") in place of the one they did
 * ("cash received in March").
 *
 * A fact with no date is EXCLUDED whenever a period is requested. It cannot be shown to fall inside
 * the window, and assuming it does would put an undated record into a dated answer.
 */
export function withinPeriod(eventMillis: number | null, f: FinancialFactsFilters): boolean {
  const hasStart = typeof f.periodStartMillis === "number";
  const hasEnd = typeof f.periodEndMillis === "number";
  if (!hasStart && !hasEnd) return true;
  if (eventMillis === null) return false;
  if (hasStart && eventMillis < (f.periodStartMillis as number)) return false;
  if (hasEnd && eventMillis > (f.periodEndMillis as number)) return false;
  return true;
}

/** Roll visible invoices up by one dimension. Money stays per currency — never summed across. */
export function rollup(reads: InvoiceReportRead[], keyOf: (r: InvoiceReportRead) => string[]): DimensionRollup[] {
  const byKey = new Map<string, DimensionRollup>();
  for (const r of reads) {
    for (const key of keyOf(r)) {
      const row = byKey.get(key) ?? { key, invoiceCount: 0, billedByCurrency: {}, collectedByCurrency: {}, outstandingByCurrency: {} };
      row.invoiceCount += 1;
      const currency = r.currency ?? "UNSPECIFIED";
      row.billedByCurrency[currency] = (row.billedByCurrency[currency] ?? 0) + r.totalMinor;
      row.collectedByCurrency[currency] = (row.collectedByCurrency[currency] ?? 0) + r.appliedMinor;
      if (r.outstandingMinor > 0) {
        row.outstandingByCurrency[currency] = (row.outstandingByCurrency[currency] ?? 0) + r.outstandingMinor;
      }
      byKey.set(key, row);
    }
  }
  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
}

class IncompleteRead extends Error {
  constructor(readonly reason: ReportingIncompleteReason, readonly cause?: unknown) {
    super(reason);
  }
}

/** A Firestore "requires an index" refusal (FAILED_PRECONDITION), named — never folded into a generic failure. */
function isMissingIndexError(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown } | null;
  if (!e) return false;
  if (e.code === 9 || e.code === "failed-precondition" || e.code === "FAILED_PRECONDITION") return true;
  return typeof e.message === "string" && /requires an index|FAILED_PRECONDITION/i.test(e.message);
}

/**
 * Read a query to EXHAUSTION in document-id order, one bounded cursor page at a time.
 *
 * The cursor is the document id (`orderBy(__name__)` + `startAfter(lastId)`): unique, immutable and
 * already indexed, so a page boundary can never skip or repeat a fact, and no composite index is
 * needed (an equality filter plus `__name__` ordering is served by the automatic single-field index).
 * Throws IncompleteRead — never returns a short list as if it were the whole collection.
 */
async function scanToExhaustion(
  query: Query,
  scan: ReportingCollectionScan,
  pageSize: number,
  ceiling: number,
): Promise<DocumentSnapshot[]> {
  const docs: DocumentSnapshot[] = [];
  let cursor: string | null = null;
  for (;;) {
    // One row past the ceiling is requested on the final page, so "exactly the ceiling" (complete)
    // and "more than the ceiling" (partial) are distinguishable without a second query.
    const take = Math.min(pageSize, ceiling - docs.length + 1);
    let page = query.orderBy(FieldPath.documentId());
    if (cursor !== null) page = page.startAfter(cursor);
    let snap;
    try {
      snap = await page.limit(take).get();
    } catch (err) {
      throw new IncompleteRead(isMissingIndexError(err) ? "INDEX_MISSING" : "READ_FAILED", err);
    }
    scan.pages += 1;
    scan.documentsRead += snap.size;
    if (docs.length + snap.size > ceiling) throw new IncompleteRead("SCAN_CEILING_REACHED");
    docs.push(...snap.docs);
    if (snap.size < take) {
      scan.exhausted = true;
      return docs;
    }
    cursor = snap.docs[snap.docs.length - 1].id;
  }
}

/** Fetch exactly the named documents, in bounded batches. Absent ids are simply not returned. */
async function readByIds(
  db: Firestore,
  collection: string,
  ids: string[],
  scan: ReportingCollectionScan,
  pageSize: number,
  ceiling: number,
): Promise<DocumentSnapshot[]> {
  if (ids.length > ceiling) throw new IncompleteRead("SCAN_CEILING_REACHED");
  const out: DocumentSnapshot[] = [];
  for (let i = 0; i < ids.length; i += pageSize) {
    const refs = ids.slice(i, i + pageSize).map((id) => db.collection(collection).doc(id));
    let snaps: DocumentSnapshot[];
    try {
      snaps = await db.getAll(...refs);
    } catch (err) {
      throw new IncompleteRead(isMissingIndexError(err) ? "INDEX_MISSING" : "READ_FAILED", err);
    }
    scan.pages += 1;
    for (const d of snaps) {
      if (!d.exists) continue;
      scan.documentsRead += 1;
      out.push(d);
    }
  }
  scan.exhausted = true;
  return out;
}

export interface ReadFinancialFactsOptions {
  /** Override the per-collection hard ceiling (tests only; the callable always uses the constant). */
  scanCeiling?: number;
}

/**
 * The complete, cursor-paged reporting read. Exported so tests exercise it with an injected
 * Firestore and an injected authority — no live grant needed to prove the scope rules.
 *
 * `pageSize` bounds each page; it no longer bounds the answer. The answer is COMPLETE or it carries
 * nothing (see THE COMPLETENESS CONTRACT).
 */
export async function readFinancialFacts(
  db: Firestore,
  authority: FinancialVisibilityAuthority,
  filters: FinancialFactsFilters,
  pageSize: number,
  options: ReadFinancialFactsOptions = {},
): Promise<FinancialFactsResult> {
  const now = Date.now();
  const size = Number.isSafeInteger(pageSize) && pageSize > 0 ? Math.min(pageSize, MAX_REPORTING_LIMIT) : DEFAULT_REPORTING_LIMIT;
  const ceiling =
    Number.isSafeInteger(options.scanCeiling) && (options.scanCeiling as number) > 0
      ? (options.scanCeiling as number)
      : REPORTING_SCAN_CEILING;
  const scans: ReportingCollectionScan[] = [];
  const newScan = (collection: string): ReportingCollectionScan => {
    const s = { collection, documentsRead: 0, pages: 0, exhausted: false };
    scans.push(s);
    return s;
  };
  const withheld = (reason: ReportingIncompleteReason): FinancialFactsResult => ({
    status: "unavailable",
    completeness: {
      status: scans.some((s) => s.documentsRead > 0) ? "PARTIAL" : "NOT_READ",
      reason,
      pageSize: size,
      scanCeiling: ceiling,
      scans: scans.map((s) => ({ ...s })),
    },
    invoices: [],
    payments: [],
    applications: [],
    summary: summarizeAccountAr([]),
    agingByCurrency: {},
    agingByCompany: {},
    byCompany: [],
    byBusinessUnit: [],
    byCreditedSalesperson: [],
    grantedScopes: [...authority.grantedScopes],
    unattributed: { businessUnit: 0, creditedSalesperson: 0 },
  });
  const wants = (t: ReportingFactType): boolean =>
    !Array.isArray(filters.factTypes) || filters.factTypes.length === 0 || filters.factTypes.includes(t);

  // Fail closed HERE too, not only at the callable. A principal with no reach must never receive a
  // "ready" empty page — "ready, nothing outstanding" and "you cannot see this" are different facts,
  // and only the second one is true.
  if (!authority.anyReach) return withheld("NO_REACH");

  try {
    // An accountId narrowing is pushed into the query so a single-account view stays cheap; every
    // other narrowing happens after authorization, in memory, on the COMPLETE set.
    const base = db.collection(INVOICES_COLLECTION);
    const query = nonEmpty(filters.accountId) ? base.where("accountId", "==", filters.accountId) : base;
    // COMPLETENESS IS JUDGED ON THE UNFILTERED QUERY — a fact about what was read, not about what
    // survived scope — so a narrow scope can never mask an incomplete read.
    const invoiceDocs = await scanToExhaustion(query, newScan(INVOICES_COLLECTION), size, ceiling);

    // ── AUTHORIZATION FIRST. Requested filters are not consulted until after this line. ──
    const visibleDocs = invoiceDocs.filter((d) => authority.isInvoiceVisible(invoiceVisibilityFacts(d.data() ?? {})));

    // ── Then the caller's narrowing, over the already-authorized set. ──
    const invoices: InvoiceReportRead[] = [];
    // AUTHORIZATION and NARROWING are tracked separately for a reason. Payments inherit their
    // invoice's AUTHORIZATION, which the caller's filters must not shrink: a payment received in
    // March against an invoice issued in February is still a March payment, and narrowing the
    // authorizing set by the invoice period would hide it from a March payments view.
    const authorizedInvoiceIds = new Set<string>();
    for (const d of visibleDocs) {
      const raw = d.data() ?? {};
      const dims = invoiceReportDimensions(raw);
      const read: InvoiceReportRead = { ...projectInvoiceAr(d.id, raw, now), ...dims };
      authorizedInvoiceIds.add(read.invoiceId);
      if (!matchesRequestedFilters(read, filters)) continue;
      invoices.push(read);
    }

    const visibleInvoiceIds = authorizedInvoiceIds;

    // Payments and applications inherit their invoice's authorization — a payment is visible
    // exactly when the invoice it settles is. That composes the existing predicate rather than
    // inventing a second visibility rule for a second collection.
    let payments: PaymentReportRead[] = [];
    let applications: PaymentApplicationReportRead[] = [];
    if (visibleInvoiceIds.size > 0 && (wants("PAYMENT_APPLICATION") || wants("PAYMENT_RECEIPT"))) {
      const appDocs = await scanToExhaustion(
        db.collection(PAYMENT_APPLICATIONS_COLLECTION),
        newScan(PAYMENT_APPLICATIONS_COLLECTION),
        size,
        ceiling,
      );
      const visibleApps = appDocs.filter((d) => visibleInvoiceIds.has(String((d.data() ?? {}).invoiceId ?? "")));
      // Every application the caller may see, before any period narrowing — this is what authorizes
      // a receipt, so a receipt stays judged on its own received date.
      const allVisibleApplicationPaymentIds = visibleApps
        .map((d) => String((d.data() ?? {}).paymentId ?? ""))
        .filter((x) => x.length > 0);
      applications = visibleApps.map((d) => {
        const x = d.data() ?? {};
        return {
          applicationId: d.id,
          invoiceId: nonEmpty(x.invoiceId) ? x.invoiceId : null,
          paymentId: nonEmpty(x.paymentId) ? x.paymentId : null,
          companyId: nonEmpty(x.companyId) ? x.companyId : null,
          currency: nonEmpty(x.currency) ? x.currency : null,
          appliedAmountMinor: nn(x.appliedAmountMinor),
          appliedAtMillis: typeof x.appliedAtMillis === "number" ? x.appliedAtMillis : null,
        };
      })
      // An application is judged by ITS OWN recorded date, and by the same company narrowing the
      // caller requested. Both can only remove rows.
      .filter((a) => withinPeriod(a.appliedAtMillis, filters))
      .filter((a) => !nonEmpty(filters.companyId) || a.companyId === filters.companyId);

      if (wants("PAYMENT_RECEIPT")) {
        // Receipt visibility follows the applications over ALL authorized invoices — not the
        // period-filtered applications above, or a receipt would be hidden by the application
        // date rather than judged on its own received date. Receipts are fetched BY ID: only the
        // receipts an authorized application names are read, so the size of the payments
        // collection as a whole can neither truncate nor widen this answer.
        const paymentIds = [...new Set(allVisibleApplicationPaymentIds)].sort();
        if (paymentIds.length > 0) {
          const payDocs = await readByIds(db, PAYMENTS_COLLECTION, paymentIds, newScan(PAYMENTS_COLLECTION), size, ceiling);
          payments = payDocs
            .map((d) => {
              const x = d.data() ?? {};
              return {
                paymentId: d.id,
                invoiceId: null,
                accountId: nonEmpty(x.accountId) ? x.accountId : null,
                companyId: nonEmpty(x.companyId) ? x.companyId : null,
                currency: nonEmpty(x.currency) ? x.currency : null,
                amountMinor: nn(x.amountMinor),
                appliedMinor: nn(x.appliedMinor),
                receivedAtMillis: typeof x.receivedAtMillis === "number" ? x.receivedAtMillis : null,
                method: nonEmpty(x.method) ? x.method : null,
                externalRef: nonEmpty(x.externalRef) ? x.externalRef : null,
              };
            })
            // The receipt's OWN canonical event date — when the cash was received — plus the same
            // company narrowing. Never the issue date of the invoice it settles.
            .filter((r) => withinPeriod(r.receivedAtMillis, filters))
            .filter((r) => !nonEmpty(filters.companyId) || r.companyId === filters.companyId);
        }
      }
    }

    return {
      status: "ready",
      completeness: { status: "COMPLETE", reason: null, pageSize: size, scanCeiling: ceiling, scans },
      invoices: wants("INVOICE") ? invoices : [],
      payments,
      applications: wants("PAYMENT_APPLICATION") ? applications : [],
      summary: summarizeAccountAr(invoices),
      agingByCurrency: summarizeArAging(invoices, now),
      agingByCompany: summarizeArAgingByCompany(invoices, now),
      byCompany: rollup(invoices, (r) => (nonEmpty(r.companyId) ? [r.companyId] : [])),
      byBusinessUnit: rollup(invoices, (r) => r.businessUnitIds),
      byCreditedSalesperson: rollup(invoices, (r) => (nonEmpty(r.creditedSalespersonId) ? [r.creditedSalespersonId] : [])),
      grantedScopes: [...authority.grantedScopes],
      // NOT ZERO — UNATTRIBUTED. A fact whose dimension was never stamped is counted here so a
      // page can say so, instead of quietly dropping it out of a rollup and reporting a total
      // that does not reconcile to the invoice list beside it.
      unattributed: {
        businessUnit: invoices.filter((r) => r.businessUnitIds.length === 0).length,
        creditedSalesperson: invoices.filter((r) => !nonEmpty(r.creditedSalespersonId)).length,
      },
    };
  } catch (err) {
    if (err instanceof IncompleteRead) {
      if (err.reason !== "SCAN_CEILING_REACHED") console.error(`[readFinancialFacts] ${err.reason}`, err.cause);
      return withheld(err.reason);
    }
    console.error("[readFinancialFacts] read failed", err);
    return withheld("READ_FAILED");
  }
}

function parseFilters(data: Record<string, unknown>): FinancialFactsFilters {
  const str = (v: unknown): string | null => (nonEmpty(v) ? v.trim() : null);
  const ms = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) ? v : null);
  let factTypes: ReportingFactType[] | null = null;
  if (data.factTypes !== undefined && data.factTypes !== null) {
    if (!Array.isArray(data.factTypes)) throw new HttpsError("invalid-argument", "factTypes must be an array.");
    for (const t of data.factTypes) {
      if (!REPORTING_FACT_TYPES.includes(t as ReportingFactType)) {
        throw new HttpsError(
          "invalid-argument",
          `Unsupported factType "${String(t)}". This read serves only persisted facts: ${REPORTING_FACT_TYPES.join(", ")}.`,
        );
      }
    }
    factTypes = data.factTypes as ReportingFactType[];
  }
  return {
    companyId: str(data.companyId),
    businessUnitId: str(data.businessUnitId),
    creditedSalespersonId: str(data.creditedSalespersonId),
    accountId: str(data.accountId),
    periodStartMillis: ms(data.periodStartMillis),
    periodEndMillis: ms(data.periodEndMillis),
    factTypes,
  };
}

// The trusted reporting read. Reach is resolved by the ONE canonical FIN-004 loader — the same
// one the account read uses, admin included, with no bypass path.
export const listFinancialFacts = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");

  const db = getFirestore();
  const authority = await loadFinancialVisibilityAuthority(db, request.auth.uid);
  if (!authority.anyReach) {
    throw new HttpsError("permission-denied", "You are not authorized to read financial facts at any visibility scope.");
  }

  const data = (request.data ?? {}) as Record<string, unknown>;
  const filters = parseFilters(data);
  let limit = DEFAULT_REPORTING_LIMIT;
  if (data.limit !== undefined) {
    if (!Number.isSafeInteger(data.limit) || (data.limit as number) <= 0 || (data.limit as number) > MAX_REPORTING_LIMIT) {
      throw new HttpsError("invalid-argument", `limit (the page size) must be a positive integer no greater than ${MAX_REPORTING_LIMIT}.`);
    }
    limit = data.limit as number;
  }

  return readFinancialFacts(db, authority, filters, limit);
});
