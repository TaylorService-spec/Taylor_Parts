// Commercial Finance — Billing / AR — PURE lifecycle vocabulary + the operations→Finance candidate projection.
// Design-first / authority-first foundation for the greenfield Finance domain, built from the existing
// fulfillment→Finance seam (functions/src/fulfillment/billingEligibility.ts). No I/O, no persistence, no React.
//
// MONEY CONCEPTS STAY DISTINCT (Owner / billingEligibility): order amount ≠ invoice ≠ payment ≠ revenue. This
// foundation deliberately carries NO amounts, NO tax, NO discount, NO revenue recognition, and NO "when to
// bill" policy — those are MATERIAL Finance decisions (multiple legitimate models) returned for Owner/Finance
// judgment, not invented here. It models only what is unambiguous: the invoice LIFECYCLE, a factual AR
// position, and the CANDIDATE (which committed lines are eligible to bill, and how much quantity) derived from
// billing eligibility. Fail-closed: anything not ELIGIBLE/PARTIALLY_ELIGIBLE yields no candidate.

// ── Invoice lifecycle (authority; amounts-free) ─────────────────────────────────────────────────────────
// A minimal, defensible AR lifecycle. OVERDUE is NOT a stored state — it is DERIVED from a due date + payment
// facts (see deriveArPosition). PARTIALLY_PAID/PAID are set by payment application (a later governed command).
export const INVOICE_STATES = Object.freeze(["DRAFT", "ISSUED", "SENT", "PARTIALLY_PAID", "PAID", "VOID"]);

// Legal forward transitions (minimal): draft → issued → sent → (partially paid ⇄ paid); void from any
// pre-paid state. PAID/VOID are terminal. Payment states are entered by payment application, not free edits.
const INVOICE_TRANSITIONS = Object.freeze({
  DRAFT: ["ISSUED", "VOID"],
  ISSUED: ["SENT", "PARTIALLY_PAID", "PAID", "VOID"],
  SENT: ["PARTIALLY_PAID", "PAID", "VOID"],
  PARTIALLY_PAID: ["PARTIALLY_PAID", "PAID", "VOID"],
  PAID: [],
  VOID: [],
});
export function canTransitionInvoice(from, to) {
  return Array.isArray(INVOICE_TRANSITIONS[from]) && INVOICE_TRANSITIONS[from].includes(to);
}
export const isTerminalInvoiceState = (s) => s === "PAID" || s === "VOID";

// ── AR position (DERIVED, factual — no policy) ──────────────────────────────────────────────────────────
// From an invoice's lifecycle state + due date + a fully-paid fact, derive a factual AR position. daysOverdue
// is factual arithmetic; AGING BUCKETS (0-30/31-60/…) are a POLICY decision and are deliberately NOT computed
// here (returned for Owner/Finance). Missing evidence ⇒ UNKNOWN, never assumed current.
export function deriveArPosition(invoice, now) {
  if (!invoice || typeof invoice !== "object") return { position: "UNKNOWN", daysOverdue: null };
  if (invoice.state === "VOID") return { position: "VOID", daysOverdue: null };
  if (invoice.state === "PAID") return { position: "PAID", daysOverdue: null };
  const dueDate = typeof invoice.dueDate === "number" ? invoice.dueDate : null;
  if (dueDate == null || typeof now !== "number") return { position: "UNKNOWN", daysOverdue: null };
  const overdue = now > dueDate;
  const daysOverdue = overdue ? Math.floor((now - dueDate) / (24 * 60 * 60 * 1000)) : 0;
  // partially paid but past due is still OVERDUE on the open balance; not-yet-due is CURRENT.
  return { position: overdue ? "OVERDUE" : "CURRENT", daysOverdue };
}

// ── Operations → Finance: the invoice CANDIDATE (no amounts) ────────────────────────────────────────────
// Given a billing-eligibility result (from computeBillingEligibility) + the committed lines, produce the
// CANDIDATE billable lines — ref + billableQty (min of ordered, fulfilled). ELIGIBLE ⇒ full billable qty;
// PARTIALLY_ELIGIBLE ⇒ the fulfilled portion is a candidate (Finance still decides what/when — this only says
// what COULD be billed). HELD / NOT_YET / CANCELLED ⇒ NO candidate (fail-closed). Carries NO amount/tax/price.
export function invoiceCandidateFromBillingEligibility(eligibilityResult, lines) {
  const eligibility = eligibilityResult?.eligibility ?? null;
  const billableEligibilities = new Set(["ELIGIBLE", "PARTIALLY_ELIGIBLE"]);
  if (!billableEligibilities.has(eligibility)) {
    return { status: "NONE", eligibility, billable: [], reason: eligibilityReason(eligibility) };
  }
  const list = Array.isArray(lines) ? lines : [];
  const billable = list
    .map((l) => {
      const ordered = num(l?.orderedQty);
      const fulfilled = Math.min(ordered, num(l?.fulfilledQty));
      return { ref: l?.ref ?? null, billableQty: fulfilled };
    })
    .filter((l) => l.ref != null && l.billableQty > 0);
  if (billable.length === 0) {
    return { status: "NONE", eligibility, billable: [], reason: "No fulfilled quantity to bill yet" };
  }
  return {
    status: "CANDIDATE",
    eligibility,
    billable, // { ref, billableQty } — NO amount/price/tax; Finance policy computes those
    // Finance still owns what/when to bill (esp. PARTIALLY_ELIGIBLE); this is a candidate, not an invoice.
    finalityDeferredToFinance: eligibility === "PARTIALLY_ELIGIBLE",
    reason: eligibility === "ELIGIBLE" ? "Fully fulfilled — billable in full" : "Partially fulfilled — fulfilled portion is billable; Finance decides what/when",
  };
}

const num = (v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
function eligibilityReason(e) {
  switch (e) {
    case "HELD": return "Held — resolve the blocker/exception before billing";
    case "NOT_YET": return "Not yet — nothing fulfilled to bill";
    case "CANCELLED": return "Cancelled — not billable";
    default: return "Billing eligibility unknown";
  }
}

// Tone (Wave-0) for an AR position — factual mapping, no severity beyond the fact.
export function arPositionTone(position) {
  switch (position) {
    case "PAID": return "positive";
    case "CURRENT": return "info";
    case "OVERDUE": return "attention";
    case "VOID": return "muted";
    default: return "unknown";
  }
}
