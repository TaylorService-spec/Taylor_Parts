import { REORDER_REQUEST_STATUS, REORDER_REQUEST_OWNER } from "./constants.js";

// PURE builder for a reorder_requests create payload (no Firebase/I/O; unit-tested). It produces the exact
// canonical field shape firestore.rules' hasCanonicalReorderRequestKeys()/...CreationBaseline() require
// (the collection store injects createdAt), plus the WO Parts Planning Phase 3 OPTIONAL `workOrderId`
// provenance back-link. inventoryReorderRequests.js's createReorderRequest() calls this with an
// already-validated field set + the caller uid, then hands the result to reorderRequestsStore.add().
//
// workOrderId is a BACK-LINK / provenance reference only: it is included ONLY when this reorder originated
// from a Work Order shortage, and omitted entirely otherwise so the non-WO create shape is byte-for-byte
// unchanged (absent is Rules-valid; no historical migration). It confers no Work Order lifecycle authority
// and no procurement authority on the Work Order; it copies no Work Order state or customer identity.
export function buildReorderRequestFields({
  partId,
  recommendationStatus,
  urgency,
  quantitySource,
  recommendedQty,
  requestedQty,
  requestedByUid,
  workOrderId = null,
}) {
  const base = {
    partId,
    recommendationStatus,
    urgency,
    quantitySource,
    recommendedQty,
    requestedQty,
    status: REORDER_REQUEST_STATUS.PENDING_REVIEW,
    currentOwner: REORDER_REQUEST_OWNER.INVENTORY,
    requestedBy: requestedByUid ?? null,
    reviewedBy: null,
    reviewedAt: null,
    reviewDecision: null,
    reviewNotes: null,
    assignedToUserId: null,
    assignedBy: null,
    assignedAt: null,
    purchasingStartedAt: null,
    purchasingStartedBy: null,
    purchasingNotes: null,
    vendorContacted: null,
    expectedAvailabilityDate: null,
    lastPurchasingUpdateAt: null,
    lastPurchasingUpdateBy: null,
    purchaseOrderId: null,
    orderedBy: null,
    orderedAt: null,
    receivedBy: null,
    receivedAt: null,
    cancelledBy: null,
    cancelledAt: null,
    cancellationReason: null,
    voidedBy: null,
    voidedAt: null,
    voidReason: null,
  };
  return workOrderId != null ? { ...base, workOrderId } : base;
}
