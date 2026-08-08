// Finance — BILLING POLICY (Owner §5). Separates BILLING ELIGIBILITY (a fact — computeBillingEligibility /
// invoiceCandidate) from BILLING POLICY (a decision — whether/when to actually invoice). Partial billing is a
// first-class capability, but a PARTIALLY_ELIGIBLE result NEVER auto-invoices. A Sales Order / customer /
// commercial arrangement carries the policy; Taylor's initial default is BILL_ON_COMPLETE (their process
// normally reaches Accounting after Service completion). PARTIALLY_ELIGIBLE stays VISIBLE so an authorized
// Finance user can see what portion is eligible and act where policy permits — but the system never bills it
// automatically. Pure; no amounts, no persistence.

export const BILLING_POLICIES = Object.freeze(["BILL_ON_COMPLETE", "BILL_AS_FULFILLED", "MILESTONE", "DEPOSIT"]);
export const DEFAULT_BILLING_POLICY = "BILL_ON_COMPLETE";

// A billing DECISION over an eligibility result under a policy:
//   action: BILL_NOW | HOLD_FOR_POLICY | NOT_BILLABLE
//   scope:  FULL | FULFILLED_PORTION | NONE   (what MAY be billed if acted on)
// HOLD_FOR_POLICY means "eligible portion exists but policy does not auto-bill it — an authorized Finance user
// decides." NOT_BILLABLE means nothing can be billed (held/nothing fulfilled/cancelled). Fail-closed by default.
export function resolveBillingDecision(eligibilityResult, policy = DEFAULT_BILLING_POLICY) {
  const eligibility = eligibilityResult?.eligibility ?? null;
  const p = BILLING_POLICIES.includes(policy) ? policy : DEFAULT_BILLING_POLICY;

  // Non-billable eligibilities never bill under any policy.
  if (eligibility === "HELD") return decision("NOT_BILLABLE", "NONE", "Held — resolve the blocker/exception before billing", p, eligibility);
  if (eligibility === "NOT_YET") return decision("NOT_BILLABLE", "NONE", "Nothing fulfilled to bill yet", p, eligibility);
  if (eligibility === "CANCELLED") return decision("NOT_BILLABLE", "NONE", "Cancelled — not billable", p, eligibility);
  if (eligibility !== "ELIGIBLE" && eligibility !== "PARTIALLY_ELIGIBLE") {
    return decision("NOT_BILLABLE", "NONE", "Billing eligibility unknown", p, eligibility);
  }

  // Fully eligible: every policy bills in full when complete.
  if (eligibility === "ELIGIBLE") {
    return decision("BILL_NOW", "FULL", "Fully fulfilled — billable in full", p, eligibility);
  }

  // PARTIALLY_ELIGIBLE — policy decides:
  switch (p) {
    case "BILL_AS_FULFILLED":
      return decision("BILL_NOW", "FULFILLED_PORTION", "Policy bills the fulfilled portion as fulfilled", p, eligibility);
    case "MILESTONE":
    case "DEPOSIT":
      // Recognized arrangements whose schedule is not configured here — fail closed to a policy hold, never
      // an automatic invoice.
      return decision("HOLD_FOR_POLICY", "FULFILLED_PORTION", `${p} arrangement is not configured — Finance decides`, p, eligibility);
    case "BILL_ON_COMPLETE":
    default:
      // Taylor default: the fulfilled portion is ELIGIBLE and VISIBLE, but not auto-billed — an authorized
      // Finance user may bill it where the arrangement permits.
      return decision("HOLD_FOR_POLICY", "FULFILLED_PORTION", "Partially fulfilled — bill-on-complete holds; Finance may bill the eligible portion", p, eligibility);
  }
}

function decision(action, scope, reason, policy, eligibility) {
  return {
    action, // BILL_NOW | HOLD_FOR_POLICY | NOT_BILLABLE
    scope, // FULL | FULFILLED_PORTION | NONE
    policy,
    eligibility,
    autoBillable: action === "BILL_NOW", // the system may auto-create a candidate ONLY here
    reason,
  };
}

// Tone (Wave-0) for a billing decision — factual, no invented severity.
export function billingDecisionTone(action) {
  switch (action) {
    case "BILL_NOW": return "positive";
    case "HOLD_FOR_POLICY": return "info";
    case "NOT_BILLABLE": return "muted";
    default: return "unknown";
  }
}
