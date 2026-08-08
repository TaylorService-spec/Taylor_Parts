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

// Summarize a set of AR reads for an account view — honest counts + the total open balance (all same currency;
// mixed currencies are surfaced, never summed blindly).
export function summarizeAccountAr(reads: InvoiceArRead[]): { count: number; openCount: number; overdueCount: number; outstandingByCurrency: Record<string, number> } {
  const list = Array.isArray(reads) ? reads : [];
  const outstandingByCurrency: Record<string, number> = {};
  let openCount = 0;
  let overdueCount = 0;
  for (const r of list) {
    if (r.outstandingMinor > 0) openCount += 1;
    if (r.arPosition === "OVERDUE") overdueCount += 1;
    if (r.outstandingMinor > 0 && r.currency) outstandingByCurrency[r.currency] = (outstandingByCurrency[r.currency] ?? 0) + r.outstandingMinor;
  }
  return { count: list.length, openCount, overdueCount, outstandingByCurrency };
}
