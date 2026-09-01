// Finance — PURE refund command core (Owner §7/§10). A REFUND is money RETURNED after a payment — a distinct
// concept from a credit (reduces what is owed) and a write-off (authorized non-collection). It is NOT a generic
// negative payment: it is its own explicit linked record. Mechanically it REVERSES applied payment on an
// invoice — reducing appliedMinor and thereby increasing outstanding again and re-deriving the invoice's
// payment state (a fully-refunded PAID invoice reopens). It NEVER rewrites the invoice's issued facts. Integer
// minor units, never float. No I/O.

import {
  buildInvoiceEventAttribution,
  requireInvoiceParty,
  type FinancialAttributionSnapshot,
  type InvoiceAttributionFacts,
} from "./financialAttribution";

export class RefundCommandError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.name = "RefundCommandError"; this.code = code; }
}

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);
const isPosInt = (v: unknown): v is number => isInt(v) && v > 0;
const nn = (v: unknown): number => (isInt(v) && v >= 0 ? v : 0);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface RefundInvoiceState extends InvoiceAttributionFacts {
  currency: string;
  state: string;
  totalMinor: number;
  appliedMinor?: number;
  creditsMinor?: number;
  chargesMinor?: number;
  writeOffMinor?: number;
}

export interface RefundRecord {
  invoiceId: string;
  paymentId: string | null; // the receipt being (partly) returned, when known
  companyId: string;
  accountId: string;
  currency: string;
  amountMinor: number;
  reason: string;
  effectiveDate: string;
  recordedAtMillis: number;
  /** FIN-002: canonical attribution derived from the governed invoice — never caller-chosen. */
  attribution: FinancialAttributionSnapshot;
}

export interface RecordRefundInput {
  invoiceId: string;
  paymentId?: string | null;
  /** Assertion-only: must match the invoice's governed companyId when supplied. Never a choice. */
  companyId?: string;
  /** Assertion-only: must match the invoice's accountId when supplied. Never a choice. */
  accountId?: string;
  currency: string;
  amountMinor: number;
  reason: string;
  effectiveDate: string;
}

// Build the refund record + the invoice patch (appliedMinor reduced; outstanding + state re-derived). A refund
// cannot exceed what has actually been applied (you cannot return money that was never received on this
// invoice). State: nothing owed ⇒ PAID; some payment remains ⇒ PARTIALLY_PAID; all payment returned ⇒ ISSUED
// (reopened).
export function buildRefund(
  input: RecordRefundInput,
  invoice: RefundInvoiceState,
  deps: { nowMillis: number },
): { refund: RefundRecord; invoicePatch: { appliedMinor: number; outstandingMinor: number; state: string } } {
  for (const [f, v] of [["invoiceId", input.invoiceId], ["currency", input.currency]] as const) {
    if (typeof v !== "string" || v.trim().length === 0) throw new RefundCommandError("REQUIRED", `${f} is required`);
  }
  if (typeof input.reason !== "string" || input.reason.trim().length === 0) throw new RefundCommandError("REASON_REQUIRED", "reason is required for a refund");
  if (typeof input.effectiveDate !== "string" || !ISO_DATE.test(input.effectiveDate)) throw new RefundCommandError("EFFECTIVE_DATE_INVALID", "effectiveDate must be an ISO date (YYYY-MM-DD)");
  if (!isPosInt(input.amountMinor)) throw new RefundCommandError("AMOUNT_INVALID", "amountMinor must be a positive integer (minor units)");
  if (!invoice || typeof invoice !== "object") throw new RefundCommandError("INVOICE_NOT_FOUND", "invoice required");
  if (invoice.currency !== input.currency) throw new RefundCommandError("CURRENCY_MISMATCH", `refund ${input.currency} != invoice ${invoice.currency}`);
  if (invoice.state === "VOID") throw new RefundCommandError("INVOICE_VOID", "invoice is void");
  const { companyId, accountId } = requireInvoiceParty(input, invoice, (code, msg) => new RefundCommandError(code, msg));

  const applied = nn(invoice.appliedMinor);
  if (input.amountMinor > applied) throw new RefundCommandError("EXCEEDS_APPLIED", `refund ${input.amountMinor} exceeds applied payment ${applied}`);

  const newApplied = applied - input.amountMinor;
  const outstandingMinor = nn(invoice.totalMinor) - newApplied - nn(invoice.creditsMinor) + nn(invoice.chargesMinor) - nn(invoice.writeOffMinor);
  const state = outstandingMinor <= 0 ? "PAID" : newApplied > 0 ? "PARTIALLY_PAID" : "ISSUED";

  const refund: RefundRecord = {
    invoiceId: input.invoiceId,
    paymentId: typeof input.paymentId === "string" && input.paymentId.length > 0 ? input.paymentId : null,
    companyId,
    accountId,
    currency: input.currency,
    amountMinor: input.amountMinor,
    reason: input.reason.trim(),
    effectiveDate: input.effectiveDate,
    recordedAtMillis: deps.nowMillis,
    attribution: buildInvoiceEventAttribution(input.invoiceId, invoice, deps.nowMillis),
  };
  return { refund, invoicePatch: { appliedMinor: newApplied, outstandingMinor, state } };
}
