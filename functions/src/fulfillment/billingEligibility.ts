// Fulfillment → Finance SEAM — PURE billing-eligibility projection (Cycle 9; framework-independent,
// unit-tested). The minimum truthful handoff from operations to Finance: combines commercial commitment (the
// Sales Order) + fulfillment evidence (per-line fulfilled vs ordered) + operational completion (the coordinated
// field mission) into a BILLING-ELIGIBILITY read. No Firestore imports.
//
// AUTHORITY BOUNDARY (Owner): neither the Work Order nor the Sales Order is the accounting authority. This
// projection states ONLY whether — and how much of — the commitment is eligible to be billed. It invents NO
// invoice, NO amount, NO tax/discount, NO "when to bill", and NO invoice policy — the Finance domain (greenfield)
// owns financial processing. Money concepts stay distinct: order amount ≠ invoice ≠ payment ≠ revenue.
//
// Honest states, each explicit (Owner): fully fulfilled → ELIGIBLE; partially fulfilled → PARTIALLY_ELIGIBLE
// (Finance decides what/when); blocked or additional-work/exception → HELD (needs resolution before billing);
// cancelled → CANCELLED; nothing fulfilled yet → NOT_YET. Missing evidence is surfaced, never assumed billable.

export const BILLING_ELIGIBILITY = ["NOT_YET", "PARTIALLY_ELIGIBLE", "ELIGIBLE", "HELD", "CANCELLED"] as const;
export type BillingEligibility = (typeof BILLING_ELIGIBILITY)[number];

export interface EligibilityLine {
  ref: string;
  orderedQty: number;
  fulfilledQty?: number;
}

export interface BillingEligibilityInput {
  salesOrderState?: string; // CONFIRMED | IN_FULFILLMENT | FULFILLED | CLOSED | CANCELLED
  lines: EligibilityLine[];
  operationalBlocked?: boolean; // any coordinated-mission unit blocked
  additionalWorkPending?: boolean; // exception / additional-work not yet resolved
}

export interface BillingEligibilityResult {
  eligibility: BillingEligibility;
  orderedTotal: number;
  fulfilledTotal: number;
  fulfilledFraction: number; // 0..1
  reasons: string[];
}

const q = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

// Derive billing eligibility from commitment + fulfillment evidence + operational completion. Pure + honest;
// it decides eligibility only, never billing policy.
export function computeBillingEligibility(input: BillingEligibilityInput): BillingEligibilityResult {
  const lines = Array.isArray(input?.lines) ? input.lines : [];
  const orderedTotal = lines.reduce((n, l) => n + q(l.orderedQty), 0);
  const fulfilledTotal = lines.reduce((n, l) => n + Math.min(q(l.orderedQty), q(l.fulfilledQty)), 0);
  const fulfilledFraction = orderedTotal > 0 ? fulfilledTotal / orderedTotal : 0;
  const reasons: string[] = [];

  if (input.salesOrderState === "CANCELLED") {
    return { eligibility: "CANCELLED", orderedTotal, fulfilledTotal, fulfilledFraction, reasons: ["Sales Order is cancelled"] };
  }
  // A blocker or unresolved additional work HOLDS eligibility until resolved (do not bill through a blocker).
  if (input.operationalBlocked) reasons.push("An operational unit is blocked");
  if (input.additionalWorkPending) reasons.push("Additional work / exception is unresolved");
  if (reasons.length > 0) {
    return { eligibility: "HELD", orderedTotal, fulfilledTotal, fulfilledFraction, reasons };
  }
  if (orderedTotal === 0) {
    return { eligibility: "NOT_YET", orderedTotal, fulfilledTotal, fulfilledFraction, reasons: ["No ordered quantity"] };
  }
  if (fulfilledTotal === 0) {
    return { eligibility: "NOT_YET", orderedTotal, fulfilledTotal, fulfilledFraction, reasons: ["Nothing fulfilled yet"] };
  }
  if (fulfilledTotal >= orderedTotal) {
    return { eligibility: "ELIGIBLE", orderedTotal, fulfilledTotal, fulfilledFraction, reasons: ["Fully fulfilled"] };
  }
  return {
    eligibility: "PARTIALLY_ELIGIBLE",
    orderedTotal,
    fulfilledTotal,
    fulfilledFraction,
    reasons: [`Partially fulfilled (${fulfilledTotal}/${orderedTotal}); Finance decides what/when to bill`],
  };
}
