// Finance — PURE invoice command core (governed issuance). Given a validated issuance input, it RE-COMPUTES
// the authoritative invoice amounts server-side (exact integer minor units, never float — Owner §8) from the
// committed Sales Order unitPrice snapshot (§3) and the INJECTED tax determination (§2), and produces the
// immutable invoice record. The trusted layer is the money authority: it does not blindly persist client
// arithmetic; it derives subtotals/totals itself and fails closed on any inconsistency, missing price, or
// missing tax. No Firestore here — the callable owns the transaction (numbering + write + audit).
//
// Ratified semantics preserved: SO unitPrice snapshot = basis (no re-pricing / no price book); tax injected,
// missing ⇒ REQUIRES_REVIEW (reject issuance); invoice lifecycle (ISSUED) separate from AR; AR age begins at
// dueDate (carried, not computed here); an issued invoice is immutable (this only CREATES the issued record).

export class InvoiceCommandError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.name = "InvoiceCommandError"; this.code = code; }
}

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);
const isPosInt = (v: unknown): v is number => isInt(v) && v > 0;
const isNonNegInt = (v: unknown): v is number => isInt(v) && v >= 0;

export interface IssueInvoiceLineInput {
  ref: string;
  billableQty: number; // positive integer
  unitPriceMinor: number; // committed SO unitPrice snapshot, integer minor units
  discountMinor?: number; // explicit governed line discount, integer minor units (>=0)
  taxMinor?: number; // injected tax determination for this line, integer minor units (>=0); absent ⇒ review
}

export interface IssueInvoiceInput {
  companyId: string;
  accountId: string;
  salesOrderId: string;
  currency: string;
  dueDate: number; // ms epoch — AR aging begins here (Owner §4)
  billingAction: string; // must be BILL_NOW (or an explicit authorized Finance decision) — never auto-partial
  lines: IssueInvoiceLineInput[];
  taxProvenance?: string | null; // provenance of the injected tax determination (audit/evidence)
}

export interface InvoiceLineRecord {
  ref: string;
  billableQty: number;
  unitPriceMinor: number;
  subtotalMinor: number;
  discountMinor: number;
  taxableBaseMinor: number;
  taxMinor: number;
  lineTotalMinor: number;
}

export interface InvoiceRecord {
  invoiceNumber: string;
  sequence: number;
  companyId: string;
  accountId: string;
  salesOrderId: string;
  currency: string;
  state: "ISSUED";
  issuedAtMillis: number;
  dueDate: number;
  lines: InvoiceLineRecord[];
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  outstandingMinor: number; // = totalMinor at issuance (no payments/adjustments yet)
  taxProvenance: string | null;
}

// Build the immutable ISSUED invoice record. `deps` carries the trusted sequence/number (from the counter, in
// the caller's transaction) + now. Pure + fail-closed. Recomputes every amount with exact integer arithmetic.
export function buildInvoiceRecord(
  input: IssueInvoiceInput,
  deps: { invoiceNumber: string; sequence: number; nowMillis: number },
): InvoiceRecord {
  if (!input || typeof input !== "object") throw new InvoiceCommandError("INVALID_INPUT", "invoice input required");
  for (const [field, v] of [["companyId", input.companyId], ["accountId", input.accountId], ["salesOrderId", input.salesOrderId], ["currency", input.currency]] as const) {
    if (typeof v !== "string" || v.trim().length === 0) throw new InvoiceCommandError("REQUIRED", `${field} is required`);
  }
  if (!isInt(input.dueDate)) throw new InvoiceCommandError("DUE_DATE_INVALID", "dueDate (ms epoch) is required for AR aging");
  // Eligibility ≠ policy: only an explicit BILL_NOW decision may be issued here (§5). PARTIALLY_ELIGIBLE that
  // was merely eligible (HOLD_FOR_POLICY) must NOT auto-issue.
  if (input.billingAction !== "BILL_NOW") throw new InvoiceCommandError("NOT_BILLABLE", "invoice issuance requires an explicit BILL_NOW billing decision");
  const lines = Array.isArray(input.lines) ? input.lines : [];
  if (lines.length === 0) throw new InvoiceCommandError("NO_LINES", "an invoice must have at least one line");

  const out: InvoiceLineRecord[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (typeof l?.ref !== "string" || l.ref.trim().length === 0) throw new InvoiceCommandError("LINE_INVALID", `line ${i} ref required`);
    if (!isPosInt(l.billableQty)) throw new InvoiceCommandError("LINE_INVALID", `line ${i} billableQty must be a positive integer`);
    if (!isNonNegInt(l.unitPriceMinor)) throw new InvoiceCommandError("UNPRICED", `line ${i} has no committed unit price (unitPriceMinor)`);
    const discountMinor = l.discountMinor === undefined ? 0 : l.discountMinor;
    if (!isNonNegInt(discountMinor)) throw new InvoiceCommandError("LINE_INVALID", `line ${i} discountMinor must be a non-negative integer`);
    // Tax is the INJECTED determination (§2). Absent ⇒ cannot issue (REQUIRES_REVIEW), never invented.
    if (!isNonNegInt(l.taxMinor)) throw new InvoiceCommandError("TAX_REQUIRES_REVIEW", `line ${i} has no tax determination`);
    const subtotalMinor = l.unitPriceMinor * l.billableQty; // authoritative — recomputed, not trusted from client
    const taxableBaseMinor = subtotalMinor - discountMinor;
    if (taxableBaseMinor < 0) throw new InvoiceCommandError("LINE_INVALID", `line ${i} discount exceeds subtotal`);
    const lineTotalMinor = taxableBaseMinor + l.taxMinor;
    out.push({ ref: l.ref, billableQty: l.billableQty, unitPriceMinor: l.unitPriceMinor, subtotalMinor, discountMinor, taxableBaseMinor, taxMinor: l.taxMinor, lineTotalMinor });
  }

  const subtotalMinor = out.reduce((s, l) => s + l.subtotalMinor, 0);
  const discountMinor = out.reduce((s, l) => s + l.discountMinor, 0);
  const taxMinor = out.reduce((s, l) => s + l.taxMinor, 0);
  const totalMinor = out.reduce((s, l) => s + l.lineTotalMinor, 0);

  return {
    invoiceNumber: deps.invoiceNumber,
    sequence: deps.sequence,
    companyId: input.companyId,
    accountId: input.accountId,
    salesOrderId: input.salesOrderId,
    currency: input.currency,
    state: "ISSUED",
    issuedAtMillis: deps.nowMillis,
    dueDate: input.dueDate,
    lines: out,
    subtotalMinor,
    discountMinor,
    taxMinor,
    totalMinor,
    outstandingMinor: totalMinor, // AR open balance at issuance; payments/adjustments reduce it later
    taxProvenance: typeof input.taxProvenance === "string" ? input.taxProvenance : null,
  };
}
