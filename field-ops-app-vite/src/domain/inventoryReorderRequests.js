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
// requestedBy, createdAt, reviewedBy, reviewedAt, reviewNotes }.
// `createdAt` (stamped automatically by makeCollectionStore.add()) IS
// this record's "Reorder Requested" Platform Event timestamp -- an
// immutable fact of when the request was made, never rewritten.
// reviewedBy/reviewedAt/reviewNotes are reserved, always null this
// sprint (Workflow history foundation) -- populated only by the future
// Review & Approval sprint, not built or read here.
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
    reviewNotes: null,
  });
}
