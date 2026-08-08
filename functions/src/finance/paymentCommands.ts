// Finance — PURE payment command core (cash receipt + application + AR projection). Owner guardrails:
//   (1) OUTSTANDING is not a second accounting authority — it is DERIVED from durable facts (invoice total,
//       payment APPLICATIONS, credits, charges, write-offs) and, where stored on the invoice for query, is a
//       TRANSACTIONALLY-MAINTAINED PROJECTION of those facts, never independently editable.
//   (2) PAYMENT / CASH RECEIPT (money received) is DISTINCT from PAYMENT APPLICATION (how received money is
//       applied to an invoice/AR obligation). The schema keeps them separate so that later — WITHOUT a
//       redesign — one payment may apply across many invoices, be partially applied, or leave an unapplied
//       credit balance; and one invoice may receive many applications. This increment implements the current
//       minimum (a receipt applied to one invoice) without foreclosing any of that.
// Integer minor units only (never float); pure; no I/O (the callable owns the transaction).

export class PaymentCommandError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.name = "PaymentCommandError"; this.code = code; }
}

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);
const isPosInt = (v: unknown): v is number => isInt(v) && v > 0;
const nn = (v: unknown): number => (isInt(v) && v >= 0 ? v : 0);

// A CASH RECEIPT — money received, independent of how it is applied. `unappliedMinor` is the receipt's own
// running balance of money not yet applied to any invoice (forward-compat for credit balances / multi-invoice
// application); in this increment it is amountMinor minus what is applied here.
export interface CashReceiptRecord {
  companyId: string;
  accountId: string;
  currency: string;
  amountMinor: number;
  method: string | null;
  receivedAtMillis: number;
  externalRef: string | null;
  appliedMinor: number; // sum of this receipt's applications
  unappliedMinor: number; // amountMinor - appliedMinor (>= 0)
}

// A PAYMENT APPLICATION — one fact linking a receipt to an invoice for an applied amount. Many-per-payment and
// many-per-invoice are both allowed by construction (a flat fact list keyed by paymentId + invoiceId).
export interface PaymentApplicationRecord {
  paymentId: string;
  invoiceId: string;
  companyId: string;
  currency: string;
  appliedAmountMinor: number;
  appliedAtMillis: number;
}

// The minimal invoice fields the AR projection reads/maintains.
export interface InvoiceProjectionState {
  currency: string;
  state: string; // ISSUED | PARTIALLY_PAID | PAID | VOID | ...
  totalMinor: number;
  appliedMinor?: number; // running sum of applications (maintained projection)
  creditsMinor?: number; // future credit-memo facts (0 today)
  chargesMinor?: number; // future debit/charge facts (0 today)
  writeOffMinor?: number; // future write-off facts (0 today)
}

// DERIVE the AR position from facts. outstanding = total − applied − credits + charges − writeoffs. Pure and
// reconcilable: the same result can be recomputed from the durable application/adjustment records, so a stored
// invoice.outstandingMinor is only ever a cache of THIS.
export function deriveOutstandingMinor(inv: InvoiceProjectionState): number {
  return inv.totalMinor - nn(inv.appliedMinor) - nn(inv.creditsMinor) + nn(inv.chargesMinor) - nn(inv.writeOffMinor);
}

// The invoice lifecycle state implied by the facts: fully settled ⇒ PAID; some applied but open ⇒
// PARTIALLY_PAID; nothing applied ⇒ unchanged (ISSUED). VOID is terminal and never re-derived here.
export function deriveInvoiceStateFromFacts(inv: InvoiceProjectionState): string {
  if (inv.state === "VOID") return "VOID";
  const outstanding = deriveOutstandingMinor(inv);
  const applied = nn(inv.appliedMinor);
  if (outstanding <= 0) return "PAID";
  if (applied > 0) return "PARTIALLY_PAID";
  return inv.state; // no applications yet — keep the issued state
}

export interface ApplyPaymentInput {
  companyId: string;
  accountId: string;
  invoiceId: string;
  currency: string;
  amountMinor: number;
  method?: string | null;
  receivedAtMillis: number;
  externalRef?: string | null;
}

// Validate + build the receipt, the application, and the invoice's maintained projection delta for applying
// `amountMinor` of a new receipt to ONE invoice (this increment's minimum). Fails closed: the invoice must be
// open (ISSUED/PARTIALLY_PAID), same currency, and the application must not exceed the current outstanding
// (an over-application would create an unapplied credit balance — a forward-compat feature, not built here).
export function buildApplyPayment(
  input: ApplyPaymentInput,
  invoice: InvoiceProjectionState,
  deps: { nowMillis: number },
): { receipt: CashReceiptRecord; application: Omit<PaymentApplicationRecord, "paymentId">; invoicePatch: { appliedMinor: number; outstandingMinor: number; state: string } } {
  for (const [f, v] of [["companyId", input.companyId], ["accountId", input.accountId], ["invoiceId", input.invoiceId], ["currency", input.currency]] as const) {
    if (typeof v !== "string" || v.trim().length === 0) throw new PaymentCommandError("REQUIRED", `${f} is required`);
  }
  if (!isPosInt(input.amountMinor)) throw new PaymentCommandError("AMOUNT_INVALID", "amountMinor must be a positive integer (minor units)");
  if (!isInt(input.receivedAtMillis)) throw new PaymentCommandError("RECEIVED_AT_INVALID", "receivedAtMillis (ms epoch) is required");
  if (!invoice || typeof invoice !== "object") throw new PaymentCommandError("INVOICE_NOT_FOUND", "invoice required");
  if (invoice.currency !== input.currency) throw new PaymentCommandError("CURRENCY_MISMATCH", `payment ${input.currency} != invoice ${invoice.currency}`);
  if (invoice.state === "PAID") throw new PaymentCommandError("ALREADY_PAID", "invoice is already fully paid");
  if (invoice.state === "VOID") throw new PaymentCommandError("INVOICE_VOID", "invoice is void");
  if (invoice.state !== "ISSUED" && invoice.state !== "PARTIALLY_PAID") throw new PaymentCommandError("NOT_OPEN", `invoice state ${invoice.state} is not open for payment`);

  const currentOutstanding = deriveOutstandingMinor(invoice);
  if (currentOutstanding <= 0) throw new PaymentCommandError("ALREADY_PAID", "invoice has no outstanding balance");
  if (input.amountMinor > currentOutstanding) {
    // Do not over-apply. The excess belongs to an unapplied credit balance (forward-compat), not to this invoice.
    throw new PaymentCommandError("OVER_APPLICATION", `amount ${input.amountMinor} exceeds outstanding ${currentOutstanding}; unapplied balances are not yet supported`);
  }

  const appliedMinor = nn(invoice.appliedMinor) + input.amountMinor;
  const nextState: InvoiceProjectionState = { ...invoice, appliedMinor };
  const outstandingMinor = deriveOutstandingMinor(nextState);
  const state = deriveInvoiceStateFromFacts(nextState);

  const receipt: CashReceiptRecord = {
    companyId: input.companyId,
    accountId: input.accountId,
    currency: input.currency,
    amountMinor: input.amountMinor,
    method: typeof input.method === "string" && input.method.length > 0 ? input.method : null,
    receivedAtMillis: input.receivedAtMillis,
    externalRef: typeof input.externalRef === "string" && input.externalRef.length > 0 ? input.externalRef : null,
    appliedMinor: input.amountMinor, // fully applied to this invoice in the minimum flow
    unappliedMinor: 0, // no unapplied balance in this increment (over-application rejected above)
  };
  const application: Omit<PaymentApplicationRecord, "paymentId"> = {
    invoiceId: input.invoiceId,
    companyId: input.companyId,
    currency: input.currency,
    appliedAmountMinor: input.amountMinor,
    appliedAtMillis: deps.nowMillis,
  };
  // The invoice patch is a TRANSACTIONALLY-MAINTAINED PROJECTION of the application fact (not an independent
  // authority): appliedMinor is the running sum of applications; outstandingMinor/state are derived from it.
  return { receipt, application, invoicePatch: { appliedMinor, outstandingMinor, state } };
}
