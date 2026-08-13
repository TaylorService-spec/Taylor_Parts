// site-work round-2 #7 -- domain/inventoryReorderRequests.js's cancelReorderRequest() status guard.
// OFFLINE test for the pure predicate isCancellableReorderRequestStatus()
// (domain/reorderRequestCancelGuard.js). cancelReorderRequest() itself touches Firestore (a
// runTransaction read-then-write, same shape as domain/reorderPurchaseOrders.js's
// recordPurchaseOrder()/voidPurchaseOrder()) and imports firebase/firebase.js (build-time-injected
// config, `window`), so it cannot be imported under this project's plain `node test/*.test.mjs` runner --
// same reason reorderRequestPayload.test.mjs tests the separate pure buildReorderRequestFields() rather
// than a writer in inventoryReorderRequests.js directly. This proves the allow/reject DECISION the
// transaction now guards its write with.
//
// firestore.rules' own Cancel branch (the resource.data.status disjunction) allows a Cancel ONLY from
// READY_FOR_PARTS_MANAGER, ASSIGNED_TO_PARTS_ASSOCIATE, or PURCHASING_IN_PROGRESS -- every other status,
// including the terminal ones (RECEIVED, CANCELLED, VOIDED, REJECTED) and PENDING_REVIEW/ORDERED, must be
// rejected client-side too, so a stray call can never even reach the network for those cases.
import assert from "node:assert/strict";
import { isCancellableReorderRequestStatus } from "../src/domain/reorderRequestCancelGuard.js";
import { REORDER_REQUEST_STATUS } from "../src/domain/constants.js";

let passed = 0;
function check(name, fn) { fn(); passed += 1; console.log(`  ok - ${name}`); }
console.log("inventoryReorderRequestsCancelGuard.test.mjs");

check("allowed: the three pre-ORDERED active statuses firestore.rules' Cancel branch permits", () => {
  assert.equal(isCancellableReorderRequestStatus(REORDER_REQUEST_STATUS.READY_FOR_PARTS_MANAGER), true);
  assert.equal(isCancellableReorderRequestStatus(REORDER_REQUEST_STATUS.ASSIGNED_TO_PARTS_ASSOCIATE), true);
  assert.equal(isCancellableReorderRequestStatus(REORDER_REQUEST_STATUS.PURCHASING_IN_PROGRESS), true);
});

check("rejected: terminal/received statuses -- a stray or already-closed cancel must not proceed", () => {
  assert.equal(isCancellableReorderRequestStatus(REORDER_REQUEST_STATUS.RECEIVED), false);
  assert.equal(isCancellableReorderRequestStatus(REORDER_REQUEST_STATUS.CANCELLED), false);
  assert.equal(isCancellableReorderRequestStatus(REORDER_REQUEST_STATUS.VOIDED), false);
  assert.equal(isCancellableReorderRequestStatus(REORDER_REQUEST_STATUS.REJECTED), false);
});

check("rejected: pre-hand-off and post-cancel-window statuses (PENDING_REVIEW, ORDERED)", () => {
  assert.equal(isCancellableReorderRequestStatus(REORDER_REQUEST_STATUS.PENDING_REVIEW), false);
  assert.equal(isCancellableReorderRequestStatus(REORDER_REQUEST_STATUS.ORDERED), false);
});

check("rejected: unknown/missing status values (undefined, null, garbage) never fail open", () => {
  assert.equal(isCancellableReorderRequestStatus(undefined), false);
  assert.equal(isCancellableReorderRequestStatus(null), false);
  assert.equal(isCancellableReorderRequestStatus("bogus"), false);
});

console.log(`\n${passed} passed, 0 failed`);
