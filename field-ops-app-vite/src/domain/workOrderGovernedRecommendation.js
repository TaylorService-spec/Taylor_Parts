// FIRST GOVERNED WORK ORDER RECOMMENDATION.
//
// This module does not create an AI action. It maps one already-governed deterministic readiness
// condition to the EXISTING human reorder seam in inventoryReorderRequests.js. The model-visible
// descriptor contains no Firestore ids and no quantity. Acceptance must supply the CURRENT inventory
// analytics recommendation to the existing requestReorderForRecommendation() path, whose Firestore
// write is independently re-authorized by firestore.rules.

export const WORK_ORDER_REORDER_ACTION_ID = "requestReorderForRecommendation";

export const GOVERNED_RECOMMENDATION_REASON = Object.freeze({
  NO_CONFIRMED_SHORTAGE: "NO_CONFIRMED_SHORTAGE",
  MULTIPLE_CONFIRMED_SHORTAGES: "MULTIPLE_CONFIRMED_SHORTAGES",
  REORDER_NOT_ELIGIBLE: "REORDER_NOT_ELIGIBLE",
  READY: "READY",
});

export function deriveGovernedWorkOrderPartsRecommendation(partsReadiness) {
  const rows = Array.isArray(partsReadiness?.rows) ? partsReadiness.rows : [];
  const confirmedShortages = rows.filter((row) =>
    row?.readiness === "ATTENTION" &&
    row?.reason === "SHORT" &&
    Number.isFinite(row?.knownShortfall) &&
    row.knownShortfall > 0,
  );

  if (confirmedShortages.length === 0) {
    return noRecommendation(GOVERNED_RECOMMENDATION_REASON.NO_CONFIRMED_SHORTAGE);
  }
  if (confirmedShortages.length > 1) {
    // The current model contract permits at most one governed action. Choosing one shortage for the
    // user would be an AI prioritization decision EOS has not authorized. Fail closed instead.
    return noRecommendation(GOVERNED_RECOMMENDATION_REASON.MULTIPLE_CONFIRMED_SHORTAGES);
  }
  if (partsReadiness?.actionEligibility?.requestReorder !== true) {
    return noRecommendation(GOVERNED_RECOMMENDATION_REASON.REORDER_NOT_ELIGIBLE, "DENIED");
  }

  const row = confirmedShortages[0];
  const partId = cleanId(row.partId);
  const workOrderId = cleanId(partsReadiness?.workOrderId);
  if (!partId || !workOrderId) {
    return noRecommendation(GOVERNED_RECOMMENDATION_REASON.NO_CONFIRMED_SHORTAGE);
  }

  return Object.freeze({
    speak: true,
    reason: GOVERNED_RECOMMENDATION_REASON.READY,
    // This exact object is safe to expose to the model. No execution identifiers or quantity cross
    // the interpretation boundary.
    recommendation: Object.freeze({
      actionId: WORK_ORDER_REORDER_ACTION_ID,
      label: "Request reorder",
      authority: "ALLOWED",
    }),
    // EOS-only execution context. Never include this object in a Keystone request.
    execution: Object.freeze({
      actionId: WORK_ORDER_REORDER_ACTION_ID,
      partId,
      workOrderId,
      expectedReadinessReason: "SHORT",
    }),
    evidence: Object.freeze({
      readiness: "ATTENTION",
      reason: "SHORT",
      knownShortfall: row.knownShortfall,
    }),
  });
}

/**
 * Human acceptance adapter. It deliberately does NOT calculate quantity. The existing reorder seam
 * receives the CURRENT analytics recommendation/manual quantity and remains the only place that
 * chooses READY vs NEEDS_PLANNING payload shape. Its Firestore create is then independently checked
 * by the existing Rules; this adapter grants nothing.
 */
export function acceptGovernedWorkOrderPartsRecommendation({
  governedRecommendation,
  currentInventoryRecommendation,
  manualQty = null,
  requestReorder,
}) {
  if (governedRecommendation?.recommendation?.actionId !== WORK_ORDER_REORDER_ACTION_ID ||
      governedRecommendation?.execution?.actionId !== WORK_ORDER_REORDER_ACTION_ID) {
    throw new Error("Unsupported Work Order recommendation action.");
  }
  if (typeof requestReorder !== "function") {
    throw new Error("Existing reorder action is required.");
  }
  const partId = cleanId(governedRecommendation.execution.partId);
  const workOrderId = cleanId(governedRecommendation.execution.workOrderId);
  if (!partId || !workOrderId) {
    throw new Error("Governed Work Order recommendation is missing execution identity.");
  }
  if (!currentInventoryRecommendation || typeof currentInventoryRecommendation !== "object") {
    throw new Error("Current inventory recommendation is required; AI may not invent reorder quantity.");
  }

  return requestReorder({
    partId,
    recommendation: currentInventoryRecommendation,
    manualQty,
    workOrderId,
  });
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
