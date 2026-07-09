import { REORDER_REQUESTS_COLLECTION, REORDER_REQUEST_STATUS } from "./constants";
import { makeCollectionStore } from "../firebase/collectionStore";
import { auth } from "../firebase/firebase";

// Sprint 2.1.3 -- Reorder Request & Notification Foundation
// (docs/BusinessEntityModel.md's Reorder Request entry; Inventory
// Management capability). This is the ONLY writer of reorder_requests --
// no component calls addDoc/setDoc directly, same single-write-path
// discipline as domain/accounts.js/locations.js/contacts.js. Reuses
// makeCollectionStore (firebase/collectionStore.js) rather than a
// hand-rolled Firestore call, so writes go through lib/firebaseSafe.js's
// demo/panic-mode write-blocking the same way every other client-
// direct-write collection already does. No Cloud Function -- not
// required for this sprint's scope (a single, unconditional create,
// no cross-document invariant to protect).
//
// A Reorder Request is: { id, partId, urgency, recommendedQty, status,
// requestedBy, createdAt, reviewedBy, reviewedAt, reviewDecision,
// reviewNotes }. `createdAt` (stamped automatically by
// makeCollectionStore.add()) IS this record's "Reorder Requested"
// Platform Event timestamp -- an immutable fact of when the request
// was made, never rewritten.
export const reorderRequestsStore = makeCollectionStore(REORDER_REQUESTS_COLLECTION);

export function createReorderRequest({ partId, urgency, recommendedQty }) {
  return reorderRequestsStore.add({
    partId,
    urgency,
    recommendedQty,
    status: REORDER_REQUEST_STATUS.PENDING_REVIEW,
    requestedBy: auth.currentUser?.uid ?? null,
    reviewedBy: null,
    reviewedAt: null,
    reviewDecision: null,
    reviewNotes: null,
  });
}

// Sprint 2.1.4 -- Reorder Review & Decision. The only writer of a
// Reorder Request's review outcome. `status` and `reviewDecision` are
// set to the same value today (both APPROVED or both REJECTED) but are
// deliberately separate fields: `status` is this object's general
// lifecycle position (a future stage, e.g. a Procurement hand-off,
// could advance it further without touching history); `reviewDecision`
// is a permanent historical fact of what was decided during review and
// is never overwritten once set -- the Workflow History foundation
// Sprint 2.1.3 reserved these fields for.
//
// Notes are required when rejecting (validated here, not just in the
// UI, since this is the sole write path) and optional when approving.
export function reviewReorderRequest(requestId, { decision, notes }) {
  if (decision !== REORDER_REQUEST_STATUS.APPROVED && decision !== REORDER_REQUEST_STATUS.REJECTED) {
    throw new Error(`Invalid review decision: ${decision}`);
  }
  const trimmedNotes = notes?.trim() || "";
  if (decision === REORDER_REQUEST_STATUS.REJECTED && !trimmedNotes) {
    throw new Error("Review notes are required when rejecting a Reorder Request.");
  }

  return reorderRequestsStore.update(requestId, {
    status: decision,
    reviewDecision: decision,
    reviewedBy: auth.currentUser?.uid ?? null,
    reviewedAt: Date.now(),
    reviewNotes: trimmedNotes || null,
  });
}
