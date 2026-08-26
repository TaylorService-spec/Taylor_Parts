// FIRST GOVERNED SALES ORDER RECOMMENDATION.
//
// Same shape as domain/workOrderGovernedRecommendation.js, and for the same reason: this module
// does not create an AI action. It maps one already-governed deterministic condition to the
// EXISTING human allocate seam (client.allocateSalesOrder in hooks/useSalesOrderActions.js →
// functions/src/fulfillment/allocateSalesOrder.ts, capability salesOrder.fulfill). The
// model-visible descriptor carries no Firestore ids, no quantities and no money. Acceptance calls
// the existing command, whose authorization and state preconditions are re-checked server-side.
//
// ════════════ WHY ALLOCATE, AND NOT ONE OF THE OTHER THREE ════════════
//
// The Sales Order has four governed write actions. Three were rejected for a first slice:
//
//   transitionSalesOrder CANCEL   destructive, and irreversible from the UI.
//   transitionSalesOrder ADVANCE  moves lifecycle state; a wrong recommendation moves the
//                                 commercial record, not a reversible working value.
//   createServiceForSalesOrder    crosses the Sales Order → Service/Work Order lineage boundary
//                                 AND carries a documented gap: the read projection does not
//                                 expose `allocatedAt`, so the client cannot mirror the command's
//                                 "PART lines require allocation" precondition. Recommending an
//                                 action whose precondition EOS cannot see from here is exactly
//                                 the fabrication this contract forbids.
//
// allocateSalesOrder is the safest and the most useful: it computes availability itself from
// canonical sources, records allocation ENTIRELY on the Sales Order, creates no new entity, moves
// no lifecycle state, and is re-runnable. The recommendation says "run the governed allocation" —
// it never claims stock exists, because the command is the authority on that and may legitimately
// answer UNKNOWN.
//
// ════════════ WHAT IS DELIBERATELY NOT INFERRED ════════════
//
// No price, quantity, currency, conversion rate, customer term, inventory availability or
// fulfilment state is computed, predicted or repeated here. The trigger is a comparison of two
// numbers the Sales Order already records — orderedQty and allocatedQty — and nothing else.

export const SALES_ORDER_ALLOCATE_ACTION_ID = "allocateSalesOrder";

/** Kinds `allocateSalesOrder` can actually resolve today. */
const ALLOCATABLE_KINDS = Object.freeze(["PART", "SERVICE"]);

/** States the command itself accepts (mirrors its `so.state` guard, and canAllocate()). */
const ACTIVE_FULFILL_STATES = Object.freeze(["CONFIRMED", "IN_FULFILLMENT"]);

export const SALES_ORDER_RECOMMENDATION_REASON = Object.freeze({
  READY: "READY",
  NO_PROJECTION: "NO_PROJECTION",
  STATE_NOT_ELIGIBLE: "STATE_NOT_ELIGIBLE",
  FULLY_ALLOCATED: "FULLY_ALLOCATED",
  ONLY_EQUIPMENT_OUTSTANDING: "ONLY_EQUIPMENT_OUTSTANDING",
  LINE_DATA_UNUSABLE: "LINE_DATA_UNUSABLE",
  ALLOCATE_NOT_ELIGIBLE: "ALLOCATE_NOT_ELIGIBLE",
});

/**
 * Decide whether the existing allocate action may be offered to the model for this Sales Order.
 *
 * @param salesOrder  the governed read projection (getSalesOrderContext shape)
 * @param canAllocate the caller's REAL salesOrder.fulfill decision from the trusted access feed.
 *                    Defaults to false: absent evidence of authority is not authority.
 */
export function deriveGovernedSalesOrderAllocationRecommendation(salesOrder, { canAllocate = false } = {}) {
  if (!salesOrder || typeof salesOrder !== "object") {
    return noRecommendation(SALES_ORDER_RECOMMENDATION_REASON.NO_PROJECTION);
  }

  const lines = Array.isArray(salesOrder.lines) ? salesOrder.lines : null;
  if (lines === null) {
    return noRecommendation(SALES_ORDER_RECOMMENDATION_REASON.NO_PROJECTION);
  }
  if (!ACTIVE_FULFILL_STATES.includes(salesOrder.state)) {
    return noRecommendation(SALES_ORDER_RECOMMENDATION_REASON.STATE_NOT_ELIGIBLE);
  }

  // A LINE THIS BUILD CANNOT READ STOPS THE WHOLE RECOMMENDATION.
  //
  // Not "skip the bad line and recommend on the rest": a projection carrying a non-finite,
  // negative, or over-allocated quantity is a degraded read, and a recommendation built on the
  // remainder would be confidently derived from a document EOS does not fully understand. Fail
  // closed on the ORDER, which is the unit the action operates on anyway.
  for (const line of lines) {
    if (!line || typeof line !== "object") {
      return noRecommendation(SALES_ORDER_RECOMMENDATION_REASON.LINE_DATA_UNUSABLE);
    }
    const ordered = line.orderedQty;
    const allocated = line.allocatedQty;
    if (!Number.isFinite(ordered) || !Number.isFinite(allocated) || ordered < 0 || allocated < 0) {
      return noRecommendation(SALES_ORDER_RECOMMENDATION_REASON.LINE_DATA_UNUSABLE);
    }
    // Allocated beyond ordered is a CONFLICTING state, not a rounding artefact. EOS does not
    // silently normalise it and the model is not told about the order at all.
    if (allocated > ordered) {
      return noRecommendation(SALES_ORDER_RECOMMENDATION_REASON.LINE_DATA_UNUSABLE);
    }
    if (typeof line.kind !== "string" || line.kind.length === 0) {
      return noRecommendation(SALES_ORDER_RECOMMENDATION_REASON.LINE_DATA_UNUSABLE);
    }
  }

  const outstanding = lines.filter((line) => line.allocatedQty < line.orderedQty);
  if (outstanding.length === 0) {
    return noRecommendation(SALES_ORDER_RECOMMENDATION_REASON.FULLY_ALLOCATED);
  }

  const actionable = outstanding.filter((line) => ALLOCATABLE_KINDS.includes(line.kind));
  if (actionable.length === 0) {
    // EQUIPMENT_MODEL availability is deliberately UNKNOWN and fail-closed inside
    // allocateSalesOrder until the equipment-availability contract exists. Recommending an action
    // EOS knows cannot resolve the outstanding work would be honest about the action and
    // misleading about the outcome.
    return noRecommendation(SALES_ORDER_RECOMMENDATION_REASON.ONLY_EQUIPMENT_OUTSTANDING);
  }

  if (canAllocate !== true) {
    return noRecommendation(SALES_ORDER_RECOMMENDATION_REASON.ALLOCATE_NOT_ELIGIBLE, "DENIED");
  }

  const salesOrderId = cleanId(salesOrder.id);
  if (!salesOrderId) {
    return noRecommendation(SALES_ORDER_RECOMMENDATION_REASON.NO_PROJECTION);
  }

  // ONE ACTION, ONE TARGET — and note this is where the Sales Order differs from the Work Order.
  //
  // The Work Order recommendation fails closed on MULTIPLE confirmed shortages, because choosing
  // WHICH part to reorder would be an AI prioritisation decision EOS never authorised. Allocation
  // is ORDER-scoped: allocateSalesOrder(salesOrderId) addresses every outstanding line at once.
  // Several outstanding lines is therefore not ambiguity and there is nothing to prioritise, so
  // failing closed on it would refuse the commonest legitimate case for no safety gain.
  return Object.freeze({
    speak: true,
    reason: SALES_ORDER_RECOMMENDATION_REASON.READY,
    // Safe to expose to the model. No identifier, no quantity, no money.
    recommendation: Object.freeze({
      actionId: SALES_ORDER_ALLOCATE_ACTION_ID,
      label: "Allocate",
      authority: "ALLOWED",
    }),
    // EOS-only. Never include this in a Keystone request.
    execution: Object.freeze({
      actionId: SALES_ORDER_ALLOCATE_ACTION_ID,
      salesOrderId,
    }),
    evidence: Object.freeze({
      outstandingLineCount: actionable.length,
      outstandingKinds: Object.freeze([...new Set(actionable.map((line) => line.kind))].sort()),
    }),
  });
}

/**
 * Human acceptance adapter.
 *
 * It calculates nothing and grants nothing. The existing allocate seam is passed through untouched
 * and remains the sole authority: it resolves salesOrder.fulfill against the trusted feed, re-checks
 * the state precondition, and computes availability itself. A stale recommendation therefore fails
 * server-side exactly as a stale button click already does.
 */
export function acceptGovernedSalesOrderAllocationRecommendation({
  governedRecommendation,
  runAllocate,
}) {
  if (governedRecommendation?.recommendation?.actionId !== SALES_ORDER_ALLOCATE_ACTION_ID ||
      governedRecommendation?.execution?.actionId !== SALES_ORDER_ALLOCATE_ACTION_ID) {
    throw new Error("Unsupported Sales Order recommendation action.");
  }
  if (typeof runAllocate !== "function") {
    throw new Error("Existing allocate action is required.");
  }
  const salesOrderId = cleanId(governedRecommendation.execution.salesOrderId);
  if (!salesOrderId) {
    throw new Error("Governed Sales Order recommendation is missing execution identity.");
  }
  return runAllocate({ salesOrderId });
}

function noRecommendation(reason, authority = "NOT_APPLICABLE") {
  return Object.freeze({
    speak: false,
    reason,
    recommendation: null,
    execution: null,
    evidence: null,
    authority,
  });
}

function cleanId(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
