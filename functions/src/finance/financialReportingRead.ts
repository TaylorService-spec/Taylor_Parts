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
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import {
  INVOICES_COLLECTION,
  PAYMENTS_COLLECTION,
  PAYMENT_APPLICATIONS_COLLECTION,
} from "../constants/collections";
import { projectInvoiceAr, summarizeAccountAr, type InvoiceArRead } from "./financeReadProjection";
import { invoiceVisibilityFacts, type FinancialVisibilityAuthority } from "./financialVisibility";
import { loadFinancialVisibilityAuthority } from "./financeReadCallables";

/** The fact families this read can serve — each backed by a persisted collection, no synthesis. */
export const REPORTING_FACT_TYPES = ["INVOICE", "PAYMENT_RECEIPT", "PAYMENT_APPLICATION"] as const;
export type ReportingFactType = (typeof REPORTING_FACT_TYPES)[number];

export const MAX_REPORTING_LIMIT = 500;
export const DEFAULT_REPORTING_LIMIT = 200;

export interface FinancialFactsFilters {
  companyId?: string | null;
  businessUnitId?: string | null;
  creditedSalespersonId?: string | null;
  accountId?: string | null;
  periodStartMillis?: number | null;
  periodEndMillis?: number | null;
  factTypes?: ReportingFactType[] | null;
}

/** One invoice, projected for reporting: the canonical AR read PLUS its frozen attribution dimensions. */
export interface InvoiceReportRead extends InvoiceArRead {
  companyId: string | null;
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
  status: "ready" | "unavailable";
  invoices: InvoiceReportRead[];
  payments: PaymentReportRead[];
  applications: PaymentApplicationReportRead[];
  summary: ReturnType<typeof summarizeAccountAr>;
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

/**
 * The bounded reporting read. Exported so tests exercise it with an injected Firestore and an
 * injected authority — no live grant needed to prove the scope rules.
 */
export async function readFinancialFacts(
  db: Firestore,
  authority: FinancialVisibilityAuthority,
  filters: FinancialFactsFilters,
  limit: number,
): Promise<FinancialFactsResult> {
  const now = Date.now();
  const empty: FinancialFactsResult = {
    status: "unavailable",
    invoices: [],
    payments: [],
    applications: [],
    summary: summarizeAccountAr([]),
    byCompany: [],
    byBusinessUnit: [],
    byCreditedSalesperson: [],
    grantedScopes: [...authority.grantedScopes],
    unattributed: { businessUnit: 0, creditedSalesperson: 0 },
  };
  const wants = (t: ReportingFactType): boolean =>
    !Array.isArray(filters.factTypes) || filters.factTypes.length === 0 || filters.factTypes.includes(t);

  // Fail closed HERE too, not only at the callable. A principal with no reach must never receive a
  // "ready" empty page — "ready, nothing outstanding" and "you cannot see this" are different facts,
  // and only the second one is true.
  if (!authority.anyReach) return empty;

  try {
    // An accountId narrowing is pushed into the query so a single-account view stays cheap; every
    // other narrowing happens after authorization, in memory, on the bounded page.
    const base = db.collection(INVOICES_COLLECTION);
    const query = nonEmpty(filters.accountId) ? base.where("accountId", "==", filters.accountId) : base;
    const snap = await query.limit(limit + 1).get();
    // BOUNDED-READ HONESTY, same rule as the account read: a truncated page is never "ready",
    // because a partial set summarized confidently is worse than no set. The check runs on the
    // UNFILTERED page — completeness is a fact about the query, not about what survived scope.
    if (snap.size > limit) return empty;

    // ── AUTHORIZATION FIRST. Requested filters are not consulted until after this line. ──
    const visibleDocs = snap.docs.filter((d) => authority.isInvoiceVisible(invoiceVisibilityFacts(d.data() ?? {})));

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
      const appSnap = await db.collection(PAYMENT_APPLICATIONS_COLLECTION).limit(MAX_REPORTING_LIMIT + 1).get();
      if (appSnap.size > MAX_REPORTING_LIMIT) return empty;
      const visibleApps = appSnap.docs.filter((d) => visibleInvoiceIds.has(String((d.data() ?? {}).invoiceId ?? "")));
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
        // date rather than judged on its own received date.
        const paymentIds = new Set(allVisibleApplicationPaymentIds);
        if (paymentIds.size > 0) {
          const paySnap = await db.collection(PAYMENTS_COLLECTION).limit(MAX_REPORTING_LIMIT + 1).get();
          if (paySnap.size > MAX_REPORTING_LIMIT) return empty;
          payments = paySnap.docs
            .filter((d) => paymentIds.has(d.id))
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
      invoices: wants("INVOICE") ? invoices : [],
      payments,
      applications: wants("PAYMENT_APPLICATION") ? applications : [],
      summary: summarizeAccountAr(invoices),
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
    console.error("[readFinancialFacts] read failed", err);
    return empty;
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
      throw new HttpsError("invalid-argument", `limit must be a positive integer no greater than ${MAX_REPORTING_LIMIT}.`);
    }
    limit = data.limit as number;
  }

  return readFinancialFacts(db, authority, filters, limit);
});
