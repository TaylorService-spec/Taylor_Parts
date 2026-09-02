// Finance — PURE trusted-read projection (Billing/AR). Projects a stored invoice into the MINIMAL AR read the
// UI needs, DERIVING the AR position from the durable facts (never trusting a possibly-stale stored balance):
// outstanding = total − applied − credits + charges − writeoffs; AR position from outstanding + due date + now.
// No PII: accountId only, no raw UID. Distinct honest states are the caller's job (denied/empty/unavailable);
// this is the per-invoice shape. No I/O.

const nn = (v: unknown): number => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : 0);
const DAY = 24 * 60 * 60 * 1000;

export interface StoredInvoiceLike {
  invoiceNumber?: string;
  accountId?: string;
  salesOrderId?: string;
  currency?: string;
  state?: string;
  totalMinor?: number;
  appliedMinor?: number;
  creditsMinor?: number;
  chargesMinor?: number;
  writeOffMinor?: number;
  dueDate?: number;
}

// AR OUTSTANDING derived from facts (reconcilable; the same formula the payment/adjustment commands maintain).
export function deriveOutstandingMinor(inv: StoredInvoiceLike): number {
  return nn(inv.totalMinor) - nn(inv.appliedMinor) - nn(inv.creditsMinor) + nn(inv.chargesMinor) - nn(inv.writeOffMinor);
}

export type ArPosition = "CURRENT" | "OVERDUE" | "SETTLED" | "VOID" | "UNKNOWN";

// Factual AR position (what is OWED — distinct from the invoice's payment STATE). SETTLED = nothing owed
// (by payment AND/OR credit/write-off — the read exposes the invoice state separately so a written-off invoice
// is not misread as "paid"). daysOverdue is factual; NO aging buckets (deployment policy).
export function deriveArPosition(inv: StoredInvoiceLike, nowMillis: number): { position: ArPosition; daysOverdue: number | null } {
  if (inv?.state === "VOID") return { position: "VOID", daysOverdue: null };
  if (deriveOutstandingMinor(inv) <= 0) return { position: "SETTLED", daysOverdue: null };
  const due = typeof inv?.dueDate === "number" ? inv.dueDate : null;
  if (due == null || typeof nowMillis !== "number") return { position: "UNKNOWN", daysOverdue: null };
  if (nowMillis > due) return { position: "OVERDUE", daysOverdue: Math.floor((nowMillis - due) / DAY) };
  return { position: "CURRENT", daysOverdue: 0 };
}

export interface InvoiceArRead {
  invoiceId: string;
  invoiceNumber: string | null;
  accountId: string | null;
  salesOrderId: string | null;
  currency: string | null;
  state: string | null; // payment lifecycle (ISSUED/PARTIALLY_PAID/PAID/VOID)
  totalMinor: number;
  appliedMinor: number;
  creditsMinor: number;
  chargesMinor: number;
  writeOffMinor: number;
  outstandingMinor: number; // derived
  dueDate: number | null;
  arPosition: ArPosition; // derived (what is owed)
  daysOverdue: number | null;
}

// Project one stored invoice (by id) into the minimal AR read. Amounts as integer minor units.
export function projectInvoiceAr(invoiceId: string, inv: StoredInvoiceLike, nowMillis: number): InvoiceArRead {
  const { position, daysOverdue } = deriveArPosition(inv ?? {}, nowMillis);
  return {
    invoiceId,
    invoiceNumber: typeof inv?.invoiceNumber === "string" ? inv.invoiceNumber : null,
    accountId: typeof inv?.accountId === "string" ? inv.accountId : null,
    salesOrderId: typeof inv?.salesOrderId === "string" ? inv.salesOrderId : null,
    currency: typeof inv?.currency === "string" ? inv.currency : null,
    state: typeof inv?.state === "string" ? inv.state : null,
    totalMinor: nn(inv?.totalMinor),
    appliedMinor: nn(inv?.appliedMinor),
    creditsMinor: nn(inv?.creditsMinor),
    chargesMinor: nn(inv?.chargesMinor),
    writeOffMinor: nn(inv?.writeOffMinor),
    outstandingMinor: deriveOutstandingMinor(inv ?? {}),
    dueDate: typeof inv?.dueDate === "number" ? inv.dueDate : null,
    arPosition: position,
    daysOverdue,
  };
}

// A/R AGING, derived on the SERVER from the same governed facts as everything else.
//
// The client must never compute this. A bucket summed in the browser from one page of rows reads
// as a claim about the whole book, and the browser cannot know whether it holds the whole book.
//
// THE BUCKETS ARE THE APPROVED COMPOSITION — Current / 1–30 / 31–60 / 61+ — and are deliberately
// NOT split further. No repository authority distinguishes a 61–90 from a 91+ treatment, so
// inventing that split here would be a policy this system has not made.
//
// Aging is measured from each invoice's own governed dueDate against `nowMillis`, reusing
// deriveArPosition rather than re-deciding what "overdue" means. Only invoices that still OWE
// something are aged: a settled invoice has no exposure to age.
//
// AN INVOICE WITH NO DUE DATE IS NOT "CURRENT". It cannot be placed on the aging axis at all, so
// it is counted in `unagedMinor` beside the buckets rather than folded into the nearest one —
// the same rule the reporting read applies to unattributed facts. The buckets plus unaged
// therefore reconcile exactly to the total, which is what makes the row trustworthy.
export interface ArAgingBucket {
  totalOutstandingMinor: number;
  currentMinor: number;
  days1to30Minor: number;
  days31to60Minor: number;
  days61PlusMinor: number;
  unagedMinor: number;
}

export function summarizeArAging(reads: InvoiceArRead[], nowMillis: number): Record<string, ArAgingBucket> {
  const out: Record<string, ArAgingBucket> = {};
  for (const r of Array.isArray(reads) ? reads : []) {
    if (!(r.outstandingMinor > 0)) continue; // nothing owed, nothing to age
    const currency = r.currency ?? "UNSPECIFIED";
    const b = (out[currency] ??= {
      totalOutstandingMinor: 0, currentMinor: 0, days1to30Minor: 0,
      days31to60Minor: 0, days61PlusMinor: 0, unagedMinor: 0,
    });
    b.totalOutstandingMinor += r.outstandingMinor;
    // Recomputed from the invoice's own facts, not read off the projection, so the bucket and the
    // row can never disagree about the same invoice.
    const { position, daysOverdue } = deriveArPosition(
      { state: r.state ?? undefined, totalMinor: r.totalMinor, appliedMinor: r.appliedMinor,
        creditsMinor: r.creditsMinor, chargesMinor: r.chargesMinor, writeOffMinor: r.writeOffMinor,
        dueDate: r.dueDate ?? undefined },
      nowMillis,
    );
    if (position === "UNKNOWN") b.unagedMinor += r.outstandingMinor;
    else if (position === "CURRENT" || daysOverdue === null || daysOverdue <= 0) b.currentMinor += r.outstandingMinor;
    else if (daysOverdue <= 30) b.days1to30Minor += r.outstandingMinor;
    else if (daysOverdue <= 60) b.days31to60Minor += r.outstandingMinor;
    else b.days61PlusMinor += r.outstandingMinor;
  }
  return out;
}

// Summarize a set of AR reads — honest counts plus the lifecycle totals, EACH PER CURRENCY.
//
// THE CONSOLIDATED TOTALS LIVE HERE, in the one canonical summary, for a specific reason: a client
// given only per-company rollups must either add them up itself — presenting a scoped slice as a
// book-wide figure — or refuse to show the number at all. Summing the already-authorized atomic
// facts is the server's job, because the server is what knows which facts the caller may see.
//
// BILLED is the invoice total; COLLECTED is the maintained appliedMinor projection of the payment
// applications — the SAME meaning the per-company/per-salesperson rollups use, so one word cannot
// mean two things on two pages. OUTSTANDING counts only invoices that still owe something, which is
// why it is not simply billed − collected.
//
// Currencies are never blended: each is its own key, and a caller that wants one number must first
// decide an FX policy this system does not have.
export function summarizeAccountAr(reads: InvoiceArRead[]): {
  count: number;
  openCount: number;
  overdueCount: number;
  billedByCurrency: Record<string, number>;
  collectedByCurrency: Record<string, number>;
  outstandingByCurrency: Record<string, number>;
} {
  const list = Array.isArray(reads) ? reads : [];
  const billedByCurrency: Record<string, number> = {};
  const collectedByCurrency: Record<string, number> = {};
  const outstandingByCurrency: Record<string, number> = {};
  let openCount = 0;
  let overdueCount = 0;
  for (const r of list) {
    const currency = r.currency ?? "UNSPECIFIED";
    billedByCurrency[currency] = (billedByCurrency[currency] ?? 0) + nn(r.totalMinor);
    collectedByCurrency[currency] = (collectedByCurrency[currency] ?? 0) + nn(r.appliedMinor);
    if (r.outstandingMinor > 0) {
      openCount += 1;
      outstandingByCurrency[currency] = (outstandingByCurrency[currency] ?? 0) + r.outstandingMinor;
    }
    if (r.arPosition === "OVERDUE") overdueCount += 1;
  }
  return { count: list.length, openCount, overdueCount, billedByCurrency, collectedByCurrency, outstandingByCurrency };
}
