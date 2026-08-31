import { doc, runTransaction } from "firebase/firestore";
import { submitCreateReorderRequest } from "../services/reorderCallableClient.js";
import { REORDER_REQUESTS_COLLECTION, REORDER_REQUEST_STATUS, REORDER_REQUEST_OWNER, QUANTITY_SOURCE } from "./constants";
import { makeCollectionStore } from "../firebase/collectionStore";
import { auth, db } from "../firebase/firebase";
import { isWriteBlocked } from "../config/env";
// buildReorderRequestFields is no longer imported here: the canonical 35-field payload is now built
// server-side by the trusted createReorderRequest command, which is the only writer. The pure
// builder and its tests remain in domain/reorderRequestPayload.js -- retiring them is a separate
// cleanup, and deleting a tested module as a side effect of an authority migration would be scope
// this change has no business taking.
import { isCancellableReorderRequestStatus } from "./reorderRequestCancelGuard";

// Sprint 2.1.3 -- Reorder Request & Notification Foundation
// (docs/BusinessEntityModel.md's Reorder Request entry; Inventory
// Management capability). This is the ONLY writer of reorder_requests --
// no component calls addDoc/setDoc directly, same single-write-path
// discipline as domain/accounts.js/locations.js/contacts.js. Reuses
// makeCollectionStore (firebase/collectionStore.js) rather than a
// hand-rolled Firestore call, so writes go through lib/firebaseSafe.js's
// demo/panic-mode write-blocking the same way every other client-
// direct-write collection already does.
//
// WORKSTREAM 2B CORRECTION (2026-08-30). This header used to end "No Cloud Function -- not required
// for this sprint's scope (a single, unconditional create, no cross-document invariant to protect)."
// That stopped being true: creation now authors a governed ownership fact (warehouseId, and the
// operatingCompanyId derived from it), which a client cannot be the authority for.
//
// So createReorderRequest() below is a TRUSTED CALLABLE adapter, and firestore.rules retires the
// direct create. The other seven transitions in this file are unchanged and remain client-direct
// under unchanged Rules -- they author no company fact, and moving them would be rebuilding a
// working state machine rather than migrating the authority the new facts require.
//
// A Reorder Request is: { id, partId, recommendationStatus, urgency,
// quantitySource, recommendedQty, requestedQty, status, currentOwner,
// requestedBy, createdAt, reviewedBy, reviewedAt, reviewDecision,
// reviewNotes, assignedToUserId, assignedBy, assignedAt,
// purchasingStartedAt, purchasingStartedBy, purchasingNotes,
// vendorContacted, expectedAvailabilityDate, lastPurchasingUpdateAt,
// lastPurchasingUpdateBy, purchaseOrderId, orderedBy, orderedAt,
// receivedBy, receivedAt, cancelledBy, cancelledAt, cancellationReason,
// voidedBy, voidedAt, voidReason }. (The eight receiving/cancel/void
// fields were added by later sprints and are all written null here by
// createReorderRequest() -- verified against the write object below,
// 2026-08-05, W0; the enumeration previously stopped at orderedAt.)
// `createdAt` (stamped automatically by makeCollectionStore.add()) IS
// this record's "Reorder Requested" Platform Event timestamp -- an
// immutable fact of when the request was made, never rewritten.
//
// Sprint 2.1.10 -- Purchase Order Foundation. `purchaseOrderId`/
// `orderedBy`/`orderedAt` are reserved as `null` here, same as every
// other future-stage field, but are NOT written by any function in
// this file -- they're set exclusively by
// domain/reorderPurchaseOrders.js's recordPurchaseOrder(), atomically
// together with creating the linked Reorder Purchase Order record.
export const reorderRequestsStore = makeCollectionStore(REORDER_REQUESTS_COLLECTION);

// Zero-history reorder behavior sprint, PR 3 (docs/specifications/
// inventory-zero-history-reorder-behavior.md). recommendationStatus/
// requestedQty/quantitySource are now required, per the approved
// per-path contract: READY -> requestedQty is the analytics-computed
// recommendedOrderQty (0 is legitimate), quantitySource ANALYTICS;
// NEEDS_PLANNING -> requestedQty is a manager-entered positive whole
// number, recommendedQty is null, quantitySource MANUAL_ZERO_HISTORY.
// This validation mirrors (does not replace) firestore.rules' own
// server-side enforcement (PR 2) -- fails fast client-side, exactly
// the same "validated here, not just in the UI, since this is the
// sole write path" posture reviewReorderRequest() already uses below.
export function createReorderRequest({ partId, warehouseId, urgency, recommendedQty, recommendationStatus, requestedQty, quantitySource, workOrderId = null }) {
  if (recommendationStatus !== "READY" && recommendationStatus !== "NEEDS_PLANNING") {
    throw new Error(`Invalid recommendationStatus: ${recommendationStatus}`);
  }
  // WO Parts Planning Phase 3 -- optional Work Order provenance back-link. When present it must be a
  // non-empty governed Work Order id (mirrors firestore.rules' create validation). Back-link/provenance
  // only: it confers no Work Order lifecycle authority here and no procurement authority on the Work Order.
  if (workOrderId != null && (typeof workOrderId !== "string" || workOrderId.length === 0)) {
    throw new Error("workOrderId, when provided, must be a non-empty Work Order id.");
  }
  if (!Number.isInteger(requestedQty)) {
    throw new Error("requestedQty must be a whole number.");
  }
  if (recommendationStatus === "NEEDS_PLANNING" && requestedQty <= 0) {
    throw new Error("A manually entered quantity must be greater than zero.");
  }
  if (recommendationStatus === "READY" && requestedQty < 0) {
    throw new Error("requestedQty must not be negative.");
  }

  // WORKSTREAM 2B -- THIS NOW GOES THROUGH THE TRUSTED COMMAND, not Firestore.
  //
  // Creating a reorder request authors a governed ownership fact: the warehouse being replenished,
  // and the operatingCompanyId DERIVED from it. A client cannot be the authority for a derived
  // company, so firestore.rules retires the direct create in the same change that adds this call.
  //
  // NO FALLBACK. If the callable fails, the failure surfaces. Retrying into the old
  // reorderRequestsStore.add() would recreate two write authorities for one command, which is
  // exactly what the Rules retirement exists to prevent.
  //
  // requestedBy is the AUTHENTICATED actor, taken server-side from the callable context, and is
  // deliberately not sent -- a client-asserted actor is not an actor. operatingCompanyId is never
  // sent either: the server derives it and REFUSES a caller that supplies one.
  return submitCreateReorderRequest({
    partId,
    warehouseId,
    recommendationStatus,
    urgency,
    quantitySource,
    recommendedQty,
    requestedQty,
    workOrderId,
  });
}

// Shared "Request Reorder" orchestrator -- builds the correct
// per-path payload from a ReplenishmentRecommendation
// (domain/inventoryAnalyticsEngine.ts) and calls createReorderRequest()
// above, the sole writer. Used by both PartsList.jsx's queue action and
// PartDetail.jsx's Stock Position card so the READY-vs-NEEDS_PLANNING
// branching (per the Specification's per-path contract table) is
// implemented once, not duplicated between the two call sites.
// `workOrderId` (optional) threads a Work Order shortage's provenance through the SAME governed reorder
// creation seam -- no parallel procurement path. It is HUMAN-triggered (a dispatcher/parts operator raising
// a reorder for a shortage), exactly like today's manual reorder creation; there is no automatic
// shortage-to-request behavior (which would require a deduplication key the repository does not yet own), so
// readiness recompute / rerender / retry can never mint duplicate requests.
export function requestReorderForRecommendation({ partId, warehouseId, recommendation, manualQty, workOrderId = null }) {
  if (recommendation.recommendationStatus === "READY") {
    const qty = Math.ceil(recommendation.recommendedOrderQty);
    return createReorderRequest({
      partId,
      warehouseId,
      recommendationStatus: "READY",
      urgency: recommendation.urgency,
      quantitySource: QUANTITY_SOURCE.ANALYTICS,
      recommendedQty: qty,
      requestedQty: qty,
      workOrderId,
    });
  }

  return createReorderRequest({
    partId,
    warehouseId,
    recommendationStatus: "NEEDS_PLANNING",
    urgency: null,
    quantitySource: QUANTITY_SOURCE.MANUAL_ZERO_HISTORY,
    recommendedQty: null,
    requestedQty: manualQty,
    workOrderId,
  });
}

// ChatGPT REQUEST CHANGES on PR #92's Final Review: any Reorder
// Request created before this PR's writer change -- including every
// document the still-live transitional legacy branch (PR #91) accepts
// -- has no requestedQty field at all (undefined, not null; the old
// writer never set it). Reading request.requestedQty unconditionally
// would display a blank quantity for every such legacy/transitional
// document. This is the single, shared fallback every persisted-
// request quantity display must use: the new field when present,
// the historical recommendedQty for a legacy/transitional document.
// recommendedQty stays a required field on every document shape ever
// written (legacy, transitional-legacy-branch, and new), so it's
// always a safe fallback -- never itself undefined.
export function getDisplayQty(request) {
  return request.requestedQty ?? request.recommendedQty;
}

// Sprint 2.1.4 -- Reorder Review & Decision. The only writer of a
// Reorder Request's review outcome. `reviewDecision` is a permanent
// historical fact of what was decided during review and is never
// overwritten once set -- the Workflow History foundation Sprint 2.1.3
// reserved this field for.
//
// Notes are required when rejecting (validated here, not just in the
// UI, since this is the sole write path) and optional when approving.
//
// Sprint 2.1.5 -- Inventory -> Parts Manager Handoff. `status` no
// longer settles at APPROVED -- an approval now advances `status` to
// READY_FOR_PARTS_MANAGER and hands `currentOwner` to PARTS_MANAGER,
// while `reviewDecision` still permanently records APPROVED. A
// rejection is terminal (`status` = REJECTED, `reviewDecision` =
// REJECTED) and leaves `currentOwner` with Inventory -- there's no
// further hand-off for a rejected request.
export function reviewReorderRequest(requestId, { decision, notes }) {
  if (decision !== REORDER_REQUEST_STATUS.APPROVED && decision !== REORDER_REQUEST_STATUS.REJECTED) {
    throw new Error(`Invalid review decision: ${decision}`);
  }
  const trimmedNotes = notes?.trim() || "";
  if (decision === REORDER_REQUEST_STATUS.REJECTED && !trimmedNotes) {
    throw new Error("Review notes are required when rejecting a Reorder Request.");
  }

  const isApproved = decision === REORDER_REQUEST_STATUS.APPROVED;

  return reorderRequestsStore.update(requestId, {
    status: isApproved ? REORDER_REQUEST_STATUS.READY_FOR_PARTS_MANAGER : REORDER_REQUEST_STATUS.REJECTED,
    reviewDecision: decision,
    reviewedBy: auth.currentUser?.uid ?? null,
    reviewedAt: Date.now(),
    reviewNotes: trimmedNotes || null,
    currentOwner: isApproved ? REORDER_REQUEST_OWNER.PARTS_MANAGER : REORDER_REQUEST_OWNER.INVENTORY,
  });
}

// Sprint 2.1.6 -- Parts Manager -> Parts Associate Assignment. The only
// writer of an assignment. `assignedToUserId` is a manually-entered
// Firebase Auth uid -- there is no client-side way to list users
// (firestore.rules' users/{userId} read is self-only), so this mirrors
// PT-001's assignTechnicianToUser.js: an admin/dispatcher-known uid,
// not a picker. This is the platform's first per-user workflow
// ownership field -- `currentOwner` stays role-level (PARTS_ASSOCIATE),
// while `assignedToUserId` carries the individual identity.
export function assignReorderRequest(requestId, { assignedToUserId }) {
  const trimmedUserId = assignedToUserId?.trim() || "";
  if (!trimmedUserId) {
    throw new Error("A Parts Associate user ID is required to assign this Reorder Request.");
  }

  return reorderRequestsStore.update(requestId, {
    status: REORDER_REQUEST_STATUS.ASSIGNED_TO_PARTS_ASSOCIATE,
    currentOwner: REORDER_REQUEST_OWNER.PARTS_ASSOCIATE,
    assignedToUserId: trimmedUserId,
    assignedBy: auth.currentUser?.uid ?? null,
    assignedAt: Date.now(),
  });
}

// Sprint 2.1.7 -- Purchase Execution Foundation. The only writer of a
// "purchasing started" event. Unlike every prior transition on this
// object, this one is restricted to a single specific person -- the
// assigned Parts Associate -- not just admin/dispatcher generally;
// firestore.rules enforces request.auth.uid == the request's
// assignedToUserId, so this write fails for anyone else even though
// they can still read the request. currentOwner and the assignment
// fields are untouched -- this is the same person's work moving from
// waiting to in-progress, not a hand-off.
export function startPurchasing(requestId) {
  return reorderRequestsStore.update(requestId, {
    status: REORDER_REQUEST_STATUS.PURCHASING_IN_PROGRESS,
    purchasingStartedAt: Date.now(),
    purchasingStartedBy: auth.currentUser?.uid ?? null,
  });
}

// Sprint 2.1.8 -- Purchasing Progress Update. The only writer of a
// purchasing progress update. Unlike startPurchasing(), this does NOT
// transition status -- a request stays PURCHASING_IN_PROGRESS across
// any number of updates, the same way reviewReorderRequest()/
// assignReorderRequest() each fire once but this can repeat. Same
// per-user restriction as startPurchasing(): only the assigned Parts
// Associate can call this successfully, enforced in firestore.rules
// (request.auth.uid == the request's own assignedToUserId), not just
// application code. Deliberately does not create a Purchase Order or
// any Vendor Management record -- purchasingNotes/vendorContacted/
// expectedAvailabilityDate are informal progress fields on the
// existing Reorder Request, not a new object.
export function updatePurchasingProgress(requestId, { purchasingNotes, vendorContacted, expectedAvailabilityDate }) {
  return reorderRequestsStore.update(requestId, {
    purchasingNotes: purchasingNotes?.trim() || null,
    vendorContacted: !!vendorContacted,
    expectedAvailabilityDate: expectedAvailabilityDate || null,
    lastPurchasingUpdateAt: Date.now(),
    lastPurchasingUpdateBy: auth.currentUser?.uid ?? null,
  });
}

// Sprint 2.1.11 -- Receiving (Reorder Request closeout). The only
// writer of a receipt. Terminal ORDERED -> RECEIVED transition, same
// per-user restriction as every write on this object since Sprint
// 2.1.7: only the assigned Parts Associate, enforced in
// firestore.rules (request.auth.uid == the request's own
// assignedToUserId), not just application code.
//
// Deliberately a status-closeout note only -- does NOT call
// recordInventoryAction() (domain/inventoryActions.js) or touch
// inventory_transactions (Admin-SDK-only, Work-Order-driven ledger,
// ADR-003) in any way. Reconciling this against real stock counts is
// a separate, already-tracked backlog item (apply logged actions to
// the ledger via a Cloud-Function-mediated path once Firebase Blaze
// is enabled), genuinely blocked on Blaze (issue #15), not solved by
// this function.
export function receiveReorderRequest(requestId) {
  return reorderRequestsStore.update(requestId, {
    status: REORDER_REQUEST_STATUS.RECEIVED,
    receivedAt: Date.now(),
    receivedBy: auth.currentUser?.uid ?? null,
  });
}

// Cancel/Void schema deployment sequence, PR 4 of 6 (docs/specifications/
// reorder-request-cancellation.md). The only writer of a cancellation.
// Reachable from READY_FOR_PARTS_MANAGER, ASSIGNED_TO_PARTS_ASSOCIATE, or
// PURCHASING_IN_PROGRESS -- i.e. any pre-ORDERED active status. Terminal.
// Requires a genuinely non-blank reason, trimmed here before the write
// (firestore.rules independently rejects a whitespace-only value
// server-side too -- see the Specification's "Reason validation"), same
// posture as reviewReorderRequest()'s REJECTED-requires-reviewNotes
// check above. Authorization is isAdminOrDispatcher() alone -- no
// per-user restriction, matching every other hand-off-type action on
// this object (review, assign) -- enforced in firestore.rules, not
// here; this function does not itself check the caller's role.
//
// site-work round-2 #7 -- status guard. This was previously the one
// writer on this object with no client-side check of the request's
// CURRENT status before writing CANCELLED, unlike its transactional
// siblings in domain/reorderPurchaseOrders.js (recordPurchaseOrder()'s
// PURCHASING_IN_PROGRESS check, voidPurchaseOrder()'s ORDERED check) --
// a stray call or a Rules regression could otherwise cancel an
// already-terminal/received request. Now reads the request inside a
// transaction (same "all reads before any writes" Firestore
// transaction shape those two functions use) and only proceeds when
// the current status is one of the three pre-ORDERED active statuses
// firestore.rules itself allows a Cancel from (see the rule's
// resource.data.status disjunction). Rules remain the actual
// enforcement -- this is defense-in-depth, not a replacement.
//
// The allow/reject decision itself is isCancellableReorderRequestStatus()
// (domain/reorderRequestCancelGuard.js) -- a PURE, separately unit-tested
// predicate, split out the same way buildReorderRequestFields() (used by
// createReorderRequest() above) already lives in reorderRequestPayload.js:
// this file imports Firebase (auth/db), so nothing in it is directly
// importable under this project's plain-Node test runner.
export function cancelReorderRequest(requestId, { reason }) {
  if (isWriteBlocked()) {
    console.warn("WRITE BLOCKED (cancelReorderRequest)", requestId);
    return Promise.resolve({ blocked: true });
  }

  const trimmedReason = reason?.trim() || "";
  if (!trimmedReason) {
    throw new Error("A reason is required to cancel this Reorder Request.");
  }

  const reorderRequestRef = doc(db, REORDER_REQUESTS_COLLECTION, requestId);

  return runTransaction(db, async (transaction) => {
    // Firestore transactions require all reads before any writes.
    const reorderRequestSnap = await transaction.get(reorderRequestRef);

    if (!reorderRequestSnap.exists()) {
      throw new Error("Reorder Request not found.");
    }
    if (!isCancellableReorderRequestStatus(reorderRequestSnap.data().status)) {
      throw new Error("This Reorder Request can no longer be cancelled from its current status.");
    }

    transaction.update(reorderRequestRef, {
      status: REORDER_REQUEST_STATUS.CANCELLED,
      cancelledBy: auth.currentUser?.uid ?? null,
      cancelledAt: Date.now(),
      cancellationReason: trimmedReason,
    });
  });
}
