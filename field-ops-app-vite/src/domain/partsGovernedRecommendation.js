// FIRST GOVERNED PARTS / INVENTORY RECOMMENDATION.
//
// Maps ONE existing authoritative Parts Attention item to ONE existing human action:
//   ASSIGNED_TO_PARTS_ASSOCIATE -> startPurchasing(requestId)
//
// Nothing here creates inventory/procurement authority. The reorder request already owns the
// assignment and workflow state; inventoryReorderRequests.js already owns the write; Firestore Rules
// independently require the signed-in uid to equal the request's assignedToUserId when the write is
// attempted. EOS mirrors that identity check here only so an unauthorized action never reaches the
// model in the first place.
//
// Deliberately NOT selected for this first slice:
//   PENDING_REVIEW            review requires a human approve/reject decision.
//   READY_FOR_PARTS_MANAGER   assignment requires a human choice of assignee.
//   PURCHASING_IN_PROGRESS    progress update requires human-entered vendor/ETA/notes facts.
// AI may not fill those choices merely to complete a recommendation loop.

export const PARTS_START_PURCHASING_ACTION_ID = "startPurchasing";

export const PARTS_RECOMMENDATION_REASON = Object.freeze({
  READY: "READY",
  NO_ITEM: "NO_ITEM",
  NOT_ASSIGNED_PURCHASING_ITEM: "NOT_ASSIGNED_PURCHASING_ITEM",
  CALLER_NOT_ASSIGNEE: "CALLER_NOT_ASSIGNEE",
  EXECUTION_ID_MISSING: "EXECUTION_ID_MISSING",
});

export function deriveGovernedPartsStartPurchasingRecommendation(attentionItem, { currentUserId = null } = {}) {
  if (!attentionItem || typeof attentionItem !== "object") {
    return silent(PARTS_RECOMMENDATION_REASON.NO_ITEM);
  }

  // Consume the established projection semantics exactly; do not infer workflow state from labels
  // or from a generic "requiresAction" bit alone.
  if (attentionItem.domain !== "parts" ||
      attentionItem.objectType !== "reorderRequest" ||
      attentionItem.attentionType !== "ACTION_ITEM" ||
      attentionItem.requiresAction !== true ||
      attentionItem.sectionLabel !== "Assigned to You") {
    return silent(PARTS_RECOMMENDATION_REASON.NOT_ASSIGNED_PURCHASING_ITEM);
  }

  const assignee = cleanId(attentionItem.recipientUserId);
  const caller = cleanId(currentUserId);
  if (!assignee || !caller || assignee !== caller) {
    return silent(PARTS_RECOMMENDATION_REASON.CALLER_NOT_ASSIGNEE, "DENIED");
  }

  const requestId = cleanId(attentionItem.objectId);
  if (!requestId) return silent(PARTS_RECOMMENDATION_REASON.EXECUTION_ID_MISSING);

  return Object.freeze({
    speak: true,
    reason: PARTS_RECOMMENDATION_REASON.READY,
    recommendation: Object.freeze({
      actionId: PARTS_START_PURCHASING_ACTION_ID,
      label: "Start purchasing",
      authority: "ALLOWED",
    }),
    // EOS-only execution identity. Never include in the Keystone/model payload.
    execution: Object.freeze({
      actionId: PARTS_START_PURCHASING_ACTION_ID,
      reorderRequestId: requestId,
    }),
    evidence: Object.freeze({
      kind: "REORDER_ASSIGNED_TO_CALLER",
    }),
  });
}

/** Human acceptance delegates untouched to the existing startPurchasing seam. */
export function acceptGovernedPartsStartPurchasingRecommendation({ governedRecommendation, runStartPurchasing }) {
  if (governedRecommendation?.recommendation?.actionId !== PARTS_START_PURCHASING_ACTION_ID ||
      governedRecommendation?.recommendation?.authority !== "ALLOWED" ||
      governedRecommendation?.execution?.actionId !== PARTS_START_PURCHASING_ACTION_ID) {
    throw new Error("Unsupported Parts recommendation action.");
  }
  if (typeof runStartPurchasing !== "function") {
    throw new Error("Existing startPurchasing action is required.");
  }
  const reorderRequestId = cleanId(governedRecommendation.execution.reorderRequestId);
  if (!reorderRequestId) {
    throw new Error("Governed Parts recommendation is missing execution identity.");
  }
  return runStartPurchasing(reorderRequestId);
}

function silent(reason, authority = "NOT_APPLICABLE") {
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
