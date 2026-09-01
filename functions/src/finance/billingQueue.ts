// Finance — PURE Billing Queue projection (F4, Service Billing Model). The Billing Queue answers ONE
// operational question: "which commercial commitments have billable work that is NOT yet billed?" It is a
// READ-side composition of two already-governed authorities — nothing here mints billing policy:
//   • ELIGIBILITY: computeBillingEligibility (fulfillment→finance seam) — whether/how much of the commitment
//     is eligible to be billed (fulfillment evidence + operational completion + holds).
//   • BILLED POSITION: the Sales Order lines' billedQty projection maintained by issueInvoice — what has
//     already been billed. Unbilled-eligible per line = max(0, min(ordered, fulfilled) − billed), the SAME
//     formula issueInvoice enforces as its billableQty cap (invoiceCommands.ts) — the queue can never show
//     as billable what issuance would refuse.
// SERVICE WORK: deliberately NOT an input. Work Orders carry no monetary or billable facts (FIN-GAP-014);
// what makes service work billable, its price source, and its relation to SO-anchored billing is an
// UNDECIDED Owner decision (FIN-BLOCK-002). Until decided, service work cannot enter the queue AT ALL —
// fail-closed by absence, never inferred from WO status. Amounts are likewise absent: the queue reports
// quantities and states, never invents a price. No I/O.
import {
  computeBillingEligibility,
  type BillingEligibilityResult,
} from "../fulfillment/billingEligibility";

export const BILLING_QUEUE_STATUSES = Object.freeze([
  "NOT_READY", // nothing eligible-and-unbilled yet
  "READY_TO_BILL", // fully fulfilled, unbilled eligible quantity remains
  "PARTIALLY_READY", // partially fulfilled, unbilled eligible quantity remains
  "HELD", // operational blocker / unresolved exception — do not bill through it
  "CANCELLED",
  "FULLY_BILLED", // everything eligible so far has been billed (terminal only if nothing more fulfills)
] as const);
export type BillingQueueStatus = (typeof BILLING_QUEUE_STATUSES)[number];

export interface BillingQueueLine {
  ref: string;
  orderedQty: number;
  fulfilledQty?: number;
  billedQty?: number; // issueInvoice-maintained projection
}

export interface BillingQueueInput {
  salesOrderId: string;
  salesOrderState?: string;
  /** FIN-002: the SO's governed company. Surfaced honestly when absent — issuance will refuse. */
  operatingCompanyId?: string | null;
  lines: BillingQueueLine[];
  operationalBlocked?: boolean;
  additionalWorkPending?: boolean;
}

export interface BillingQueueEntry {
  salesOrderId: string;
  status: BillingQueueStatus;
  eligibility: BillingEligibilityResult;
  /** Σ per line max(0, min(ordered, fulfilled) − billed) — what issuance would actually accept today. */
  unbilledEligibleQty: number;
  billedQty: number;
  operatingCompanyId: string | null;
  reasons: string[];
}

const q = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

// Derive one queue entry for one Sales Order. Pure and honest: state + quantity only, no amounts, no
// billing policy ("what/when to bill" stays a Finance decision), no service-work inference.
export function deriveBillingQueueEntry(input: BillingQueueInput): BillingQueueEntry {
  const lines = Array.isArray(input?.lines) ? input.lines : [];
  const eligibility = computeBillingEligibility({
    salesOrderState: input.salesOrderState,
    lines,
    operationalBlocked: input.operationalBlocked,
    additionalWorkPending: input.additionalWorkPending,
  });

  let unbilledEligibleQty = 0;
  let billedQty = 0;
  const reasons: string[] = [...eligibility.reasons];
  for (const line of lines) {
    const eligible = Math.min(q(line.orderedQty), q(line.fulfilledQty));
    const billed = q(line.billedQty);
    billedQty += billed;
    if (billed > eligible) {
      // Never silently normalized: billed exceeding fulfilled evidence is a reconciliation fact.
      reasons.push(`Line ${line.ref}: billed ${billed} exceeds fulfilled-eligible ${eligible} — needs reconciliation`);
    }
    unbilledEligibleQty += Math.max(0, eligible - billed);
  }

  const operatingCompanyId =
    typeof input.operatingCompanyId === "string" && input.operatingCompanyId.trim().length > 0
      ? input.operatingCompanyId.trim()
      : null;
  if (operatingCompanyId === null) {
    // The queue still SHOWS the order (hiding it would misreport the operational backlog), but says
    // plainly that issuance will refuse until the company is resolved upstream (DECISIONS #154).
    reasons.push("No governed operatingCompanyId — invoice issuance will refuse (COMPANY_REQUIRED)");
  }

  let status: BillingQueueStatus;
  if (eligibility.eligibility === "CANCELLED") status = "CANCELLED";
  else if (eligibility.eligibility === "HELD") status = "HELD";
  else if (unbilledEligibleQty > 0) status = eligibility.eligibility === "ELIGIBLE" ? "READY_TO_BILL" : "PARTIALLY_READY";
  else if (billedQty > 0) status = "FULLY_BILLED";
  else status = "NOT_READY";

  return { salesOrderId: input.salesOrderId, status, eligibility, unbilledEligibleQty, billedQty, operatingCompanyId, reasons };
}
