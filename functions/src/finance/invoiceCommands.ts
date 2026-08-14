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
//
// P1.8 (lifecycle-audit `issueinvoice-unverified-so-pricing-and-qty`): issuance must be checked against the
// GOVERNED Sales Order, never trusted from the client. `verifySalesOrderMatch` is the pure cross-check the
// callable runs (inside its transaction, against a tx.get'd SO doc) before recomputing amounts: commercial
// facts (accountId/currency/per-line committed unitPrice/billing-eligible qty) must match the SO or issuance
// is rejected. It reuses computeBillingEligibility (billingEligibility.ts) — the fulfillment→finance seam —
// rather than re-deriving eligibility rules here.
import { computeBillingEligibility, type BillingEligibilityInput } from "../fulfillment/billingEligibility";

export class InvoiceCommandError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.name = "InvoiceCommandError"; this.code = code; }
}

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);
const isPosInt = (v: unknown): v is number => isInt(v) && v > 0;
const isNonNegInt = (v: unknown): v is number => isInt(v) && v >= 0;

export interface IssueInvoiceLineInput {
  kind: string;
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

// The GOVERNED Sales Order facts the callable reads via tx.get (sales_orders/{salesOrderId}) — only the
// fields this cross-check needs, never the client's own claims.
export interface SalesOrderSnapshotLine {
  kind: string;
  ref: string;
  unitPrice?: number; // committed SO pricing snapshot; absent ⇒ no basis to bill against
  orderedQty: number;
  fulfilledQty?: number;
  billedQty?: number;
}

export interface SalesOrderSnapshot {
  accountId: string;
  currency: string;
  state?: string; // CONFIRMED | IN_FULFILLMENT | FULFILLED | CLOSED | CANCELLED
  operationalBlocked?: boolean;
  additionalWorkPending?: boolean;
  lines: SalesOrderSnapshotLine[];
}

const billingEligibleQty = (l: SalesOrderSnapshotLine): number => {
  const ordered = typeof l.orderedQty === "number" && Number.isFinite(l.orderedQty) && l.orderedQty > 0 ? l.orderedQty : 0;
  const fulfilled = typeof l.fulfilledQty === "number" && Number.isFinite(l.fulfilledQty) && l.fulfilledQty > 0 ? l.fulfilledQty : 0;
  return Math.min(ordered, fulfilled);
};
const lineKey = (kind: string, ref: string): string => `${kind}:${ref}`;

// Cross-check the client-supplied issuance input against the GOVERNED Sales Order — fail closed on any
// mismatch rather than trusting the client. Basis: SO unitPrice snapshot (no re-pricing); billable qty capped
// at the billing-eligible qty per line (min(orderedQty, fulfilledQty), same rule computeBillingEligibility
// applies); accountId/currency must match the SO's committed values.
export function verifySalesOrderMatch(input: IssueInvoiceInput, so: SalesOrderSnapshot): void {
  if (!so || typeof so !== "object") throw new InvoiceCommandError("SALES_ORDER_NOT_FOUND", "sales order not found");
  if (input.accountId !== so.accountId) {
    throw new InvoiceCommandError("ACCOUNT_MISMATCH", "accountId does not match the sales order's committed account");
  }
  if (input.currency !== so.currency) {
    throw new InvoiceCommandError("CURRENCY_MISMATCH", "currency does not match the sales order's committed currency");
  }
  const eligibilityInput: BillingEligibilityInput = {
    salesOrderState: so.state,
    operationalBlocked: so.operationalBlocked,
    additionalWorkPending: so.additionalWorkPending,
    lines: (Array.isArray(so.lines) ? so.lines : []).map((l) => ({ ref: l.ref, orderedQty: l.orderedQty, fulfilledQty: l.fulfilledQty })),
  };
  const eligibility = computeBillingEligibility(eligibilityInput);
  if (eligibility.eligibility !== "ELIGIBLE" && eligibility.eligibility !== "PARTIALLY_ELIGIBLE") {
    throw new InvoiceCommandError("NOT_BILLABLE", `sales order is not billing-eligible (${eligibility.eligibility}: ${eligibility.reasons.join("; ")})`);
  }
  const soLinesByKey = new Map((Array.isArray(so.lines) ? so.lines : []).map((l) => [lineKey(l.kind, l.ref), l] as const));
  const requestedByKey = new Map<string, number>();
  const lines = Array.isArray(input.lines) ? input.lines : [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (typeof line?.kind !== "string" || line.kind.trim().length === 0) throw new InvoiceCommandError("LINE_INVALID", `line ${i} kind required`);
    const key = lineKey(line.kind, line.ref);
    const soLine = soLinesByKey.get(key);
    if (!soLine) throw new InvoiceCommandError("SALES_ORDER_LINE_NOT_FOUND", `line ${i} (${line?.ref}) has no matching sales order line`);
    if (typeof soLine.unitPrice !== "number" || !Number.isFinite(soLine.unitPrice)) {
      throw new InvoiceCommandError("UNPRICED", `sales order line ${line?.ref} has no committed unit price`);
    }
    if (line.unitPriceMinor !== soLine.unitPrice) {
      throw new InvoiceCommandError("PRICE_MISMATCH", `line ${i} (${line?.ref}) unitPriceMinor does not match the sales order's committed unit price`);
    }
    const requested = (requestedByKey.get(key) ?? 0) + line.billableQty;
    requestedByKey.set(key, requested);
    const billedQty = typeof soLine.billedQty === "number" && Number.isFinite(soLine.billedQty) && soLine.billedQty >= 0 ? soLine.billedQty : 0;
    const availableQty = billingEligibleQty(soLine) - billedQty;
    if (requested > availableQty) {
      throw new InvoiceCommandError("QTY_EXCEEDS_ELIGIBLE", `line ${i} (${line?.ref}) cumulative billableQty ${requested} exceeds remaining billing-eligible qty ${availableQty}`);
    }
  }
}

export function applyBilledQuantities(input: IssueInvoiceInput, so: SalesOrderSnapshot): SalesOrderSnapshotLine[] {
  verifySalesOrderMatch(input, so);
  const increments = new Map<string, number>();
  for (const line of input.lines) {
    const key = lineKey(line.kind, line.ref);
    increments.set(key, (increments.get(key) ?? 0) + line.billableQty);
  }
  return so.lines.map((line) => {
    const increment = increments.get(lineKey(line.kind, line.ref)) ?? 0;
    return increment === 0 ? line : { ...line, billedQty: (line.billedQty ?? 0) + increment };
  });
}

export interface InvoiceLineRecord {
  kind: string;
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
    if (typeof l?.kind !== "string" || l.kind.trim().length === 0) throw new InvoiceCommandError("LINE_INVALID", `line ${i} kind required`);
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
    out.push({ kind: l.kind, ref: l.ref, billableQty: l.billableQty, unitPriceMinor: l.unitPriceMinor, subtotalMinor, discountMinor, taxableBaseMinor, taxMinor: l.taxMinor, lineTotalMinor });
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
