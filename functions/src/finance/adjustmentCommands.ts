// Finance — PURE invoice-adjustment command core (Owner §7). Credits / charges / write-offs are EXPLICIT
// LINKED financial records — they NEVER rewrite an issued invoice. Each references its originating invoice +
// reason + amount + effective date + actor (the callable/audit carry actor + history). An adjustment changes
// the AR POSITION (it feeds the derived outstanding formula: outstanding = total − applied − credits + charges
// − writeoffs) but does NOT change the invoice's PAYMENT-lifecycle state (state stays what payments set it to —
// a written-off invoice is not mislabeled "PAID"). Distinct concepts, not one generic negative payment.
// REFUND (money returned after a payment) is payment-side (a receipt reversal) and is intentionally NOT part of
// this increment — it is a distinct follow, not folded in here. Integer minor units, never float. No I/O.

export const ADJUSTMENT_TYPES = Object.freeze(["CREDIT_MEMO", "DEBIT_CHARGE", "WRITE_OFF"]);

export class AdjustmentCommandError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.name = "AdjustmentCommandError"; this.code = code; }
}

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);
const isPosInt = (v: unknown): v is number => isInt(v) && v > 0;
const nn = (v: unknown): number => (isInt(v) && v >= 0 ? v : 0);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Reuse the AR outstanding formula (kept identical to paymentCommands): facts only, reconcilable.
function outstandingOf(inv: InvoiceAdjustState): number {
  return inv.totalMinor - nn(inv.appliedMinor) - nn(inv.creditsMinor) + nn(inv.chargesMinor) - nn(inv.writeOffMinor);
}

export interface InvoiceAdjustState {
  currency: string;
  state: string;
  totalMinor: number;
  appliedMinor?: number;
  creditsMinor?: number;
  chargesMinor?: number;
  writeOffMinor?: number;
}

export interface AdjustmentRecord {
  type: string; // CREDIT_MEMO | DEBIT_CHARGE | WRITE_OFF
  invoiceId: string;
  companyId: string;
  accountId: string;
  currency: string;
  amountMinor: number;
  reason: string;
  effectiveDate: string; // YYYY-MM-DD
  recordedAtMillis: number;
}

export interface RecordAdjustmentInput {
  type: string;
  invoiceId: string;
  companyId: string;
  accountId: string;
  currency: string;
  amountMinor: number;
  reason: string;
  effectiveDate: string;
}

// Validate + build the adjustment record + the invoice AR-projection patch (a transactionally-maintained
// projection of the new adjustment fact — creditsMinor/chargesMinor/writeOffMinor accumulate; outstanding is
// re-derived; the invoice STATE is left unchanged, since credits/write-offs are not payments).
export function buildAdjustment(
  input: RecordAdjustmentInput,
  invoice: InvoiceAdjustState,
  deps: { nowMillis: number },
): { adjustment: AdjustmentRecord; invoicePatch: { creditsMinor?: number; chargesMinor?: number; writeOffMinor?: number; outstandingMinor: number } } {
  if (!ADJUSTMENT_TYPES.includes(input?.type)) throw new AdjustmentCommandError("TYPE_INVALID", `type must be one of ${ADJUSTMENT_TYPES.join("/")}`);
  for (const [f, v] of [["invoiceId", input.invoiceId], ["companyId", input.companyId], ["accountId", input.accountId], ["currency", input.currency]] as const) {
    if (typeof v !== "string" || v.trim().length === 0) throw new AdjustmentCommandError("REQUIRED", `${f} is required`);
  }
  if (typeof input.reason !== "string" || input.reason.trim().length === 0) throw new AdjustmentCommandError("REASON_REQUIRED", "reason is required for an adjustment");
  if (typeof input.effectiveDate !== "string" || !ISO_DATE.test(input.effectiveDate)) throw new AdjustmentCommandError("EFFECTIVE_DATE_INVALID", "effectiveDate must be an ISO date (YYYY-MM-DD)");
  if (!isPosInt(input.amountMinor)) throw new AdjustmentCommandError("AMOUNT_INVALID", "amountMinor must be a positive integer (minor units)");
  if (!invoice || typeof invoice !== "object") throw new AdjustmentCommandError("INVOICE_NOT_FOUND", "invoice required");
  if (invoice.currency !== input.currency) throw new AdjustmentCommandError("CURRENCY_MISMATCH", `adjustment ${input.currency} != invoice ${invoice.currency}`);
  if (invoice.state === "VOID") throw new AdjustmentCommandError("INVOICE_VOID", "invoice is void");

  const outstanding = outstandingOf(invoice);
  const patch: { creditsMinor?: number; chargesMinor?: number; writeOffMinor?: number; outstandingMinor: number } = { outstandingMinor: outstanding };

  if (input.type === "CREDIT_MEMO") {
    // A credit reduces what is owed. Do not drive owed below zero (the excess would be a customer credit
    // balance — a forward-compat feature, not built here).
    if (input.amountMinor > outstanding) throw new AdjustmentCommandError("EXCEEDS_OUTSTANDING", `credit ${input.amountMinor} exceeds outstanding ${outstanding}; credit balances are not yet supported`);
    patch.creditsMinor = nn(invoice.creditsMinor) + input.amountMinor;
  } else if (input.type === "WRITE_OFF") {
    // A write-off records an authorized decision not to collect an outstanding amount. It cannot exceed what
    // is owed. It does NOT mark the invoice "PAID" — it settles the AR balance without payment.
    if (input.amountMinor > outstanding) throw new AdjustmentCommandError("EXCEEDS_OUTSTANDING", `write-off ${input.amountMinor} exceeds outstanding ${outstanding}`);
    patch.writeOffMinor = nn(invoice.writeOffMinor) + input.amountMinor;
  } else {
    // DEBIT_CHARGE increases what is owed (an added charge/adjustment). No cap.
    patch.chargesMinor = nn(invoice.chargesMinor) + input.amountMinor;
  }

  // Re-derive outstanding from the patched facts.
  patch.outstandingMinor = outstandingOf({ ...invoice, ...patch });

  const adjustment: AdjustmentRecord = {
    type: input.type,
    invoiceId: input.invoiceId,
    companyId: input.companyId,
    accountId: input.accountId,
    currency: input.currency,
    amountMinor: input.amountMinor,
    reason: input.reason.trim(),
    effectiveDate: input.effectiveDate,
    recordedAtMillis: deps.nowMillis,
  };
  return { adjustment, invoicePatch: patch };
}
