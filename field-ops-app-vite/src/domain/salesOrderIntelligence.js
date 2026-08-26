// NORTH STAR SALES ORDER INTELLIGENCE CONTRACT — the first slice.
//
// Same architecture as domain/workOrderIntelligence.js, deliberately, because the boundary it draws
// is the point and a second shape would be a second set of rules to get wrong:
//
//   EOS owns truth, authority and actions.  Keystone may reason about what EOS already established.
//   The server verifier decides what may be returned.
//
// This module produces a DETERMINISTIC signal. It must never be labelled AI in the UI. A model may
// later interpret the same contract, but it can only restate an EOS-selected conclusion after
// functions/src/ai/salesOrderModelInterpretation.ts accepts it.
//
// ════════════ WHAT THIS SLICE DOES NOT DO ════════════
//
// It adds NO read. The trusted `getSalesOrderContext` projection already exists and is already
// capability-gated on salesOrder.read; this builds on what a caller was already allowed to see.
// It adds NO write path — the only action it can name is the existing allocate command.
// It computes no price, quantity, currency, conversion rate, customer term, inventory availability
// or fulfilment state, and it repeats none of those to a model.
import {
  deriveGovernedSalesOrderAllocationRecommendation,
  SALES_ORDER_RECOMMENDATION_REASON,
} from "./salesOrderGovernedRecommendation.js";

export const INTELLIGENCE_ORIGIN = Object.freeze({
  DETERMINISTIC: "DETERMINISTIC",
  MODEL: "MODEL",
});

export const CONFIDENCE = Object.freeze({ HIGH: "HIGH", MEDIUM: "MEDIUM", LOW: "LOW" });

export const AUTHORITY_STATE = Object.freeze({
  NOT_APPLICABLE: "NOT_APPLICABLE",
  ALLOWED: "ALLOWED",
  DENIED: "DENIED",
  UNKNOWN: "UNKNOWN",
});

export const NO_INSIGHT_REASON = Object.freeze({
  NO_PROJECTION: "NO_PROJECTION",
  NOT_IN_FULFILMENT: "NOT_IN_FULFILMENT",
  FULLY_ALLOCATED: "FULLY_ALLOCATED",
  ALLOCATION_CANNOT_RESOLVE: "ALLOCATION_CANNOT_RESOLVE",
  ORDER_STATE_DEGRADED: "ORDER_STATE_DEGRADED",
});

const SILENT = Object.freeze({
  NOT_APPLICABLE: Object.freeze({ state: AUTHORITY_STATE.NOT_APPLICABLE, action: null, reason: null }),
});

/**
 * The deterministic Sales Order signal, or silence.
 *
 * @param salesOrder     the governed read projection
 * @param canAllocate    the caller's REAL salesOrder.fulfill decision from the trusted access feed
 */
export function deriveSalesOrderIntelligence(salesOrder, { canAllocate = false } = {}) {
  const governed = deriveGovernedSalesOrderAllocationRecommendation(salesOrder, { canAllocate });

  if (!governed.speak) return silence(governed.reason, governed.authority);

  const { outstandingLineCount, outstandingKinds } = governed.evidence;
  const detail = describeOutstanding(outstandingLineCount, outstandingKinds);

  return Object.freeze({
    speak: true,
    origin: INTELLIGENCE_ORIGIN.DETERMINISTIC,
    key: "sales-order-allocation-outstanding",
    // THE OBSERVED FACT IS A COMPARISON, NOT A JUDGEMENT. Both numbers are recorded on the Sales
    // Order; nothing here decides whether the stock to satisfy them exists. The allocate command
    // is the authority on that and may legitimately answer UNKNOWN.
    observedFact: `The Sales Order records ${detail} not fully allocated.`,
    interpretation: "Allocation has not been completed for every line this order can currently allocate.",
    businessConsequence: "Fulfilment cannot be treated as ready for these lines until the governed allocation has run against current availability.",
    confidence: Object.freeze({
      level: CONFIDENCE.HIGH,
      basis: "The signal compares two quantities the Sales Order already records. It does not read, infer or predict inventory availability.",
    }),
    recommendedAction: governed.recommendation,
    authority: Object.freeze({
      state: AUTHORITY_STATE.ALLOWED,
      action: governed.recommendation.actionId,
      reason: "EOS mapped outstanding allocation to the existing allocate command. The command re-resolves salesOrder.fulfill and re-checks its state precondition independently when a human accepts.",
    }),
    evidence: Object.freeze([
      Object.freeze({
        key: "sales-order-outstanding-allocation",
        kind: "SALES_ORDER_OUTSTANDING_ALLOCATION",
        summary: `${detail} where the allocated quantity is below the ordered quantity.`,
      }),
    ]),
    // EOS-ONLY. Deliberately not part of the model payload builder below.
    execution: governed.execution,
    outcome: null,
  });
}

/**
 * The model-safe interpretation input.
 *
 * WHAT IS ABSENT IS THE CONTRACT: no salesOrderId, no line ids, no SKUs or part references, no
 * quantities, no unit prices, no extended amounts, no currency, no customer terms. The subject is
 * the governed business reference (SO-YYYY-######) or nothing at all — never the document id.
 */
export function buildSalesOrderInterpretationInput(intelligence, { salesOrderNumber = null } = {}) {
  if (!intelligence?.speak) return null;
  return Object.freeze({
    schemaVersion: 1,
    subjectReference: businessReference(salesOrderNumber),
    observedFact: intelligence.observedFact,
    deterministicInterpretation: intelligence.interpretation,
    deterministicBusinessConsequence: intelligence.businessConsequence,
    evidence: intelligence.evidence,
    allowedRecommendation: intelligence.recommendedAction,
  });
}

/** A count and its kinds, in business words. Never a quantity, never a reference. */
function describeOutstanding(count, kinds) {
  const noun = count === 1 ? "1 line" : `${count} lines`;
  const words = kinds.map((k) => (k === "PART" ? "part" : k === "SERVICE" ? "service" : k.toLowerCase()));
  if (words.length === 0) return noun;
  const list = words.length === 1 ? words[0] : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
  return `${noun} (${list})`;
}

/**
 * Only a governed reference may identify the subject to a model. `SO-2026-000141` is the string a
 * person says out loud; a Firestore id is not, and DECISIONS #106 has no escape clause. A Sales
 * Order created before numbering existed has no reference, and gets none rather than a substitute.
 */
function businessReference(value) {
  return typeof value === "string" && /^SO-\d{4}-\d{6}$/.test(value.trim()) ? value.trim() : null;
}

function silence(reason, authority) {
  return Object.freeze({
    speak: false,
    origin: INTELLIGENCE_ORIGIN.DETERMINISTIC,
    reason: mapReason(reason),
    recommendedAction: null,
    authority: authority === "DENIED"
      ? Object.freeze({
          state: AUTHORITY_STATE.DENIED,
          action: null,
          reason: "The existing allocate command is not available to this caller; no recommendation is exposed to the model.",
        })
      : SILENT.NOT_APPLICABLE,
    evidence: null,
    execution: null,
  });
}

function mapReason(reason) {
  switch (reason) {
    case SALES_ORDER_RECOMMENDATION_REASON.NO_PROJECTION:
      return NO_INSIGHT_REASON.NO_PROJECTION;
    case SALES_ORDER_RECOMMENDATION_REASON.STATE_NOT_ELIGIBLE:
      return NO_INSIGHT_REASON.NOT_IN_FULFILMENT;
    case SALES_ORDER_RECOMMENDATION_REASON.FULLY_ALLOCATED:
      return NO_INSIGHT_REASON.FULLY_ALLOCATED;
    case SALES_ORDER_RECOMMENDATION_REASON.ONLY_EQUIPMENT_OUTSTANDING:
      return NO_INSIGHT_REASON.ALLOCATION_CANNOT_RESOLVE;
    case SALES_ORDER_RECOMMENDATION_REASON.LINE_DATA_UNUSABLE:
      return NO_INSIGHT_REASON.ORDER_STATE_DEGRADED;
    default:
      // ALLOCATE_NOT_ELIGIBLE and anything unmapped: the caller may not act, which is an authority
      // fact, not an insight. The DENIED authority above already carries it.
      return NO_INSIGHT_REASON.NOT_IN_FULFILMENT;
  }
}
