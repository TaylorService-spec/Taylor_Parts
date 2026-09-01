// Finance — PURE internal reconciliation core (F11 / FIN-010). The payment/adjustment cores promise that
// every stored AR projection (appliedMinor / creditsMinor / chargesMinor / writeOffMinor /
// outstandingMinor / state) is ONLY a cache of the durable fact records. This module makes that promise
// CHECKABLE: recompute the projection from the facts and diff it against what is stored. IN_SYNC or
// DRIFT with named differences — a drifted projection is a defect to investigate, never silently
// "fixed" here (this module writes nothing and proposes nothing; invariant C).
//
// EXTERNAL reconciliation (EOS vs the accounting authority of record) is intentionally absent: the
// authority of record is NOT YET SELECTED (DECISIONS #145) — there is nothing to reconcile against, and
// building a speculative matcher would guess an interface. The Reconciliation & Exceptions surface gets
// internal drift detection now; external reconciliation arrives with the authority-of-record selection.
// Integer minor units; pure; no I/O.
import { deriveOutstandingMinor, deriveInvoiceStateFromFacts } from "./paymentCommands";

export class ReconciliationError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.name = "ReconciliationError"; this.code = code; }
}

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);
const nn = (v: unknown): number => (isInt(v) && v >= 0 ? v : 0);

export interface StoredInvoiceProjection {
  invoiceId: string;
  currency: string;
  state: string;
  totalMinor: number;
  appliedMinor?: number;
  creditsMinor?: number;
  chargesMinor?: number;
  writeOffMinor?: number;
  outstandingMinor?: number;
}

export interface ApplicationFactRow { invoiceId: string; appliedAmountMinor: number }
export interface AdjustmentFactRow { invoiceId: string; type: string; amountMinor: number }
export interface RefundFactRow { invoiceId: string; amountMinor: number }

export interface Difference {
  field: string;
  storedValue: number | string | null;
  derivedValue: number | string;
}

export interface ReconciliationResult {
  recordId: string; // the invoice or payment the reconciliation ran over
  status: "IN_SYNC" | "DRIFT";
  differences: Difference[];
}

// Recompute the invoice AR projection from its durable facts and diff against the stored projection.
// Facts for OTHER invoices are a caller defect (thrown) — a reconciliation over the wrong fact set would
// report false drift or false sync.
export function reconcileInvoiceProjection(
  stored: StoredInvoiceProjection,
  facts: { applications: ApplicationFactRow[]; adjustments: AdjustmentFactRow[]; refunds: RefundFactRow[] },
): ReconciliationResult {
  if (!stored || typeof stored.invoiceId !== "string" || stored.invoiceId.length === 0) {
    throw new ReconciliationError("INVOICE_REQUIRED", "a stored invoice projection with invoiceId is required");
  }
  if (!isInt(stored.totalMinor)) throw new ReconciliationError("PROJECTION_INVALID", "stored totalMinor must be an integer");
  const applications = Array.isArray(facts?.applications) ? facts.applications : [];
  const adjustments = Array.isArray(facts?.adjustments) ? facts.adjustments : [];
  const refunds = Array.isArray(facts?.refunds) ? facts.refunds : [];
  for (const rows of [applications, adjustments, refunds] as { invoiceId: string }[][]) {
    for (const r of rows) {
      if (r?.invoiceId !== stored.invoiceId) {
        throw new ReconciliationError("FOREIGN_FACT", `fact for invoice ${r?.invoiceId} offered to reconcile ${stored.invoiceId}`);
      }
    }
  }
  const sum = (rows: { amountMinor?: number; appliedAmountMinor?: number }[], key: "amountMinor" | "appliedAmountMinor"): number =>
    rows.reduce((n, r) => {
      const v = r[key];
      if (!isInt(v) || v < 0) throw new ReconciliationError("FACT_INVALID", `${key} must be a non-negative integer on every fact`);
      return n + v;
    }, 0);

  // Derived truth: applied = applications − refunds; credits/charges/write-offs from adjustment facts.
  const appliedFromFacts = sum(applications, "appliedAmountMinor") - sum(refunds, "amountMinor");
  const creditsFromFacts = sum(adjustments.filter((a) => a.type === "CREDIT_MEMO"), "amountMinor");
  const chargesFromFacts = sum(adjustments.filter((a) => a.type === "DEBIT_CHARGE"), "amountMinor");
  const writeOffFromFacts = sum(adjustments.filter((a) => a.type === "WRITE_OFF"), "amountMinor");
  const unknownTypes = adjustments.filter((a) => !["CREDIT_MEMO", "DEBIT_CHARGE", "WRITE_OFF"].includes(a.type));
  if (unknownTypes.length > 0) {
    throw new ReconciliationError("FACT_INVALID", `unknown adjustment type "${unknownTypes[0].type}" — the fact set is not reconcilable`);
  }

  const derivedFacts = {
    currency: stored.currency,
    state: stored.state,
    totalMinor: stored.totalMinor,
    appliedMinor: appliedFromFacts,
    creditsMinor: creditsFromFacts,
    chargesMinor: chargesFromFacts,
    writeOffMinor: writeOffFromFacts,
  };
  const derivedOutstanding = deriveOutstandingMinor(derivedFacts);
  // State drift check: VOID is terminal and never re-derived; otherwise the state implied by the facts.
  const derivedState = stored.state === "VOID" ? "VOID" : deriveInvoiceStateFromFacts(derivedFacts);

  const differences: Difference[] = [];
  const diff = (field: string, storedValue: number | string | null, derivedValue: number | string): void => {
    if (storedValue !== derivedValue) differences.push({ field, storedValue, derivedValue });
  };
  diff("appliedMinor", nn(stored.appliedMinor), appliedFromFacts);
  diff("creditsMinor", nn(stored.creditsMinor), creditsFromFacts);
  diff("chargesMinor", nn(stored.chargesMinor), chargesFromFacts);
  diff("writeOffMinor", nn(stored.writeOffMinor), writeOffFromFacts);
  diff("outstandingMinor", isInt(stored.outstandingMinor) ? (stored.outstandingMinor as number) : null, derivedOutstanding);
  diff("state", stored.state, derivedState);

  return { recordId: stored.invoiceId, status: differences.length === 0 ? "IN_SYNC" : "DRIFT", differences };
}

export interface StoredReceipt {
  paymentId: string;
  amountMinor: number;
  appliedMinor?: number;
  unappliedMinor?: number;
}

// A receipt's own invariant: amount = applied + unapplied, and applied must equal the sum of its
// application facts. Same IN_SYNC/DRIFT honesty.
export function reconcileReceipt(stored: StoredReceipt, applications: { paymentId: string; appliedAmountMinor: number }[]): ReconciliationResult {
  if (!stored || typeof stored.paymentId !== "string" || stored.paymentId.length === 0) {
    throw new ReconciliationError("RECEIPT_REQUIRED", "a stored receipt with paymentId is required");
  }
  if (!isInt(stored.amountMinor)) throw new ReconciliationError("PROJECTION_INVALID", "stored amountMinor must be an integer");
  const rows = Array.isArray(applications) ? applications : [];
  for (const r of rows) {
    if (r?.paymentId !== stored.paymentId) throw new ReconciliationError("FOREIGN_FACT", `application for payment ${r?.paymentId} offered to reconcile ${stored.paymentId}`);
    if (!isInt(r.appliedAmountMinor) || r.appliedAmountMinor < 0) throw new ReconciliationError("FACT_INVALID", "appliedAmountMinor must be a non-negative integer");
  }
  const appliedFromFacts = rows.reduce((n, r) => n + r.appliedAmountMinor, 0);
  const differences: Difference[] = [];
  if (nn(stored.appliedMinor) !== appliedFromFacts) {
    differences.push({ field: "appliedMinor", storedValue: nn(stored.appliedMinor), derivedValue: appliedFromFacts });
  }
  const derivedUnapplied = stored.amountMinor - appliedFromFacts;
  if (nn(stored.unappliedMinor) !== derivedUnapplied) {
    differences.push({ field: "unappliedMinor", storedValue: nn(stored.unappliedMinor), derivedValue: derivedUnapplied });
  }
  if (derivedUnapplied < 0) {
    differences.push({ field: "amountMinor", storedValue: stored.amountMinor, derivedValue: appliedFromFacts });
  }
  return { recordId: stored.paymentId, status: differences.length === 0 ? "IN_SYNC" : "DRIFT", differences };
}
