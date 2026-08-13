import { REORDER_REQUEST_STATUS } from "./constants.js";

// site-work round-2 #7 -- PURE predicate for cancelReorderRequest()'s status guard (no Firebase/I/O;
// unit-tested). Split out the same way reorderRequestPayload.js's buildReorderRequestFields() is split
// out of inventoryReorderRequests.js: that file's writers import Firebase (auth/db), so nothing in it is
// directly importable under this project's plain `node test/*.test.mjs` runner -- the decision logic a
// writer's guard depends on lives here instead, so it stays offline-testable.
//
// Mirrors firestore.rules' own Cancel branch (the resource.data.status disjunction) exactly: a Cancel is
// allowed ONLY from READY_FOR_PARTS_MANAGER, ASSIGNED_TO_PARTS_ASSOCIATE, or PURCHASING_IN_PROGRESS -- i.e.
// any pre-ORDERED active status. Every other status -- PENDING_REVIEW (not yet handed off), ORDERED (past
// the cancel window), or any terminal status (RECEIVED, CANCELLED, VOIDED, REJECTED) -- is rejected, same
// as an unrecognized/missing status (fails closed, never "true" by default).
export function isCancellableReorderRequestStatus(status) {
  return (
    status === REORDER_REQUEST_STATUS.READY_FOR_PARTS_MANAGER ||
    status === REORDER_REQUEST_STATUS.ASSIGNED_TO_PARTS_ASSOCIATE ||
    status === REORDER_REQUEST_STATUS.PURCHASING_IN_PROGRESS
  );
}
