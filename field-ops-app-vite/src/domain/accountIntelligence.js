// NORTH STAR ACCOUNT / CUSTOMER INTELLIGENCE — first bounded slice.
//
// EOS owns the facts. This module consumes ONLY the already-normalized Account Attention Projection:
//   - AR overdue, established by accountArView.js
//   - Work Order past due, established by workOrderAttentionProjection.js
//
// There is deliberately NO recommendation in this slice. The repository has no established
// AR/collections resolving role or governed customer-follow-up command. Turning a deep link, a
// generic edit action, or an imagined "contact customer" action into AI authority would cross the
// exact boundary North Star AI is designed to preserve.
//
// The model-visible contract contains no Firestore/account/work-order/invoice identifiers, no deep
// links, no balances, no dates and no quantities. It says only which EOS-established conditions are
// present. Keystone may explain those conditions; it may not create another one or propose an action.

import { ACCOUNT_ATTENTION_SOURCE_STATUS } from "./accountAttentionProjection.js";

export const ACCOUNT_INTELLIGENCE_ORIGIN = Object.freeze({
  DETERMINISTIC: "DETERMINISTIC",
  MODEL: "MODEL",
});

export const ACCOUNT_INTELLIGENCE_REASON = Object.freeze({
  READY: "READY",
  NO_ATTENTION: "NO_ATTENTION",
  SOURCE_DEGRADED: "SOURCE_DEGRADED",
  INPUT_INVALID: "INPUT_INVALID",
});

const SUPPORTED_FACTS = Object.freeze({
  ar: Object.freeze({ key: "AR_OVERDUE", kind: "AR_OVERDUE", summary: "Accounts receivable is overdue." }),
  workOrder: Object.freeze({ key: "WORK_ORDER_PAST_DUE", kind: "WORK_ORDER_PAST_DUE", summary: "Service work is past due." }),
});

/**
 * Build the deterministic North Star Account intelligence contract from accountAttentionItems().
 *
 * Fail closed if either source is not READY. A partial Account story presented as a complete one is
 * not intelligence; it is missing context with confident wording.
 */
export function deriveAccountIntelligence(attentionProjection) {
  if (!attentionProjection || typeof attentionProjection !== "object" ||
      !Array.isArray(attentionProjection.items) ||
      !attentionProjection.sourceStatus || typeof attentionProjection.sourceStatus !== "object") {
    return silent(ACCOUNT_INTELLIGENCE_REASON.INPUT_INVALID);
  }

  const { ar, workOrder } = attentionProjection.sourceStatus;
  if (ar !== ACCOUNT_ATTENTION_SOURCE_STATUS.READY ||
      workOrder !== ACCOUNT_ATTENTION_SOURCE_STATUS.READY) {
    return silent(ACCOUNT_INTELLIGENCE_REASON.SOURCE_DEGRADED);
  }

  let hasArOverdue = false;
  let hasWorkOrderPastDue = false;

  for (const item of attentionProjection.items) {
    if (!item || typeof item !== "object") return silent(ACCOUNT_INTELLIGENCE_REASON.INPUT_INVALID);
    if (item.domain === "ar" && item.reason === "OVERDUE") hasArOverdue = true;
    if (item.domain === "workOrder" && item.reason === "PAST_DUE") hasWorkOrderPastDue = true;
  }

  const evidence = [];
  if (hasArOverdue) evidence.push(SUPPORTED_FACTS.ar);
  if (hasWorkOrderPastDue) evidence.push(SUPPORTED_FACTS.workOrder);

  if (evidence.length === 0) return silent(ACCOUNT_INTELLIGENCE_REASON.NO_ATTENTION);

  const observedFact = hasArOverdue && hasWorkOrderPastDue
    ? "This customer has both overdue receivables and past-due service work."
    : hasArOverdue
      ? "This customer has overdue receivables."
      : "This customer has past-due service work.";

  return Object.freeze({
    speak: true,
    origin: ACCOUNT_INTELLIGENCE_ORIGIN.DETERMINISTIC,
    reason: ACCOUNT_INTELLIGENCE_REASON.READY,
    observedFact,
    evidence: Object.freeze(evidence.map((item) => Object.freeze({ ...item }))),
    // Explicit absence is part of the contract: Account has no legitimate governed action yet.
    allowedRecommendation: null,
  });
}

/** Only this shape may leave EOS for model interpretation. */
export function toAccountModelInput(intelligence) {
  if (!intelligence?.speak || intelligence.reason !== ACCOUNT_INTELLIGENCE_REASON.READY) return null;
  if (intelligence.allowedRecommendation !== null) return null;
  if (!Array.isArray(intelligence.evidence) || intelligence.evidence.length === 0) return null;

  return Object.freeze({
    schemaVersion: 1,
    observedFact: intelligence.observedFact,
    evidence: Object.freeze(intelligence.evidence.map(({ key, kind, summary }) =>
      Object.freeze({ key, kind, summary }))),
    allowedRecommendation: null,
  });
}

function silent(reason) {
  return Object.freeze({
    speak: false,
    origin: ACCOUNT_INTELLIGENCE_ORIGIN.DETERMINISTIC,
    reason,
    observedFact: null,
    evidence: Object.freeze([]),
    allowedRecommendation: null,
  });
}
