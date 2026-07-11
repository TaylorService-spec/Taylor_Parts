import { doc, runTransaction } from "firebase/firestore";
import { db, auth } from "../firebase/firebase";
import { isWriteBlocked } from "../config/env";
import {
  PURCHASE_ORDERS_COLLECTION,
  PURCHASE_ORDER_STATUS,
  REORDER_PURCHASE_ORDER_VOIDS_COLLECTION,
  REORDER_REQUESTS_COLLECTION,
  REORDER_REQUEST_STATUS,
} from "./constants";

// Sprint 2.1.10 -- Purchase Order Foundation. The ONLY writer of
// reorder_purchase_orders, and the only place that ever transitions a
// Reorder Request to ORDERED. Both writes happen inside a single
// Firestore client-side transaction (runTransaction()) -- NOT two
// separate calls -- so the two documents can never drift out of sync:
// either both writes commit together, or neither does. This is a
// standard Firestore Web SDK feature (reads-then-writes, atomic,
// automatic retry on conflicting concurrent transactions) and does
// NOT require a Cloud Function or Admin SDK -- both target
// collections (reorder_requests, reorder_purchase_orders) are already
// client-direct-write-with-rules collections, unlike Sprint 2.1.9's
// inventory_transactions blocker (which needed a trusted server write
// specifically because that collection is Admin-SDK-only).
//
// Duplicate-Purchase-Order prevention is enforced by Firestore itself,
// not just this check: the Purchase Order's document ID IS the
// reorderRequestId (see constants.js), so a second attempt at the
// same ID is evaluated by firestore.rules as an `update` (since the
// document already exists), which that collection's rule denies
// unconditionally. The transaction's own existence check below is a
// fast, friendly client-side error -- the rule is what actually makes
// this safe against a race between two concurrent attempts.
//
// Every field here is validated before the transaction starts, not
// just relied on for the rule to reject -- same "validated here, not
// just in the UI" discipline as every other domain write function in
// this app.
export function recordPurchaseOrder(
  reorderRequestId,
  { partId, supplierName, externalPoNumber, orderedQuantity, orderedDate, expectedArrivalDate }
) {
  if (isWriteBlocked()) {
    console.warn("WRITE BLOCKED (recordPurchaseOrder)", reorderRequestId);
    return Promise.resolve({ blocked: true });
  }

  const trimmedSupplier = supplierName?.trim() || "";
  const trimmedPoNumber = externalPoNumber?.trim() || "";
  const numericQty = Number(orderedQuantity);

  if (!trimmedSupplier) {
    throw new Error("Supplier name is required.");
  }
  if (!trimmedPoNumber) {
    throw new Error("External PO/reference number is required.");
  }
  if (!Number.isFinite(numericQty) || numericQty <= 0) {
    throw new Error("Ordered quantity must be a positive number.");
  }
  if (!orderedDate) {
    throw new Error("Ordered date is required.");
  }

  const reorderRequestRef = doc(db, REORDER_REQUESTS_COLLECTION, reorderRequestId);
  const purchaseOrderRef = doc(db, PURCHASE_ORDERS_COLLECTION, reorderRequestId);

  return runTransaction(db, async (transaction) => {
    // Firestore transactions require all reads before any writes.
    const [reorderRequestSnap, purchaseOrderSnap] = await Promise.all([
      transaction.get(reorderRequestRef),
      transaction.get(purchaseOrderRef),
    ]);

    if (!reorderRequestSnap.exists()) {
      throw new Error("Reorder Request not found.");
    }
    if (purchaseOrderSnap.exists()) {
      throw new Error("A Purchase Order is already recorded for this Reorder Request.");
    }

    const reorderRequest = reorderRequestSnap.data();
    if (reorderRequest.status !== REORDER_REQUEST_STATUS.PURCHASING_IN_PROGRESS) {
      throw new Error("This Reorder Request is not currently in progress.");
    }
    if (reorderRequest.assignedToUserId !== (auth.currentUser?.uid ?? null)) {
      throw new Error("Only the assigned Parts Associate can record a Purchase Order for this request.");
    }

    const now = Date.now();
    const createdBy = auth.currentUser?.uid ?? null;

    transaction.set(purchaseOrderRef, {
      reorderRequestId,
      partId,
      supplierName: trimmedSupplier,
      externalPoNumber: trimmedPoNumber,
      orderedQuantity: numericQty,
      orderedDate,
      expectedArrivalDate: expectedArrivalDate || null,
      status: PURCHASE_ORDER_STATUS.ORDERED,
      createdBy,
      createdAt: now,
    });

    transaction.update(reorderRequestRef, {
      status: REORDER_REQUEST_STATUS.ORDERED,
      purchaseOrderId: reorderRequestId,
      orderedBy: createdBy,
      orderedAt: now,
    });
  });
}

// Cancel/Void schema deployment sequence, PR 5 of 6 (docs/specifications/
// reorder-request-cancellation.md). The ONLY writer of a
// reorder_purchase_order_voids record. Atomically creates the void
// record AND transitions the linked Reorder Request to VOIDED, in a
// single Firestore transaction -- same atomicity pattern
// recordPurchaseOrder() above already established for the ORDERED
// transition. The original reorder_purchase_orders document is read
// (to confirm it exists, confirm its status is ORDERED, and copy
// partId) but NEVER written -- Void never modifies or deletes it.
// Stamps Date.now() into a local `now` variable exactly once and
// writes that same value as both reorder_requests.voidedAt and
// reorder_purchase_order_voids.createdAt -- never two separate
// Date.now() calls for one void event (see firestore.rules' cross-
// document invariant requiring these two values to agree).
//
// Authorization: Rules enforce isAdminOrDispatcher() AND
// request.auth.uid == the request's own assignedToUserId -- BOTH
// conditions. This function only checks assignee identity
// client-side (the security role isn't loaded here, same posture as
// recordPurchaseOrder() above and cancelReorderRequest() in
// domain/inventoryReorderRequests.js) -- Rules are the actual
// enforcement, not this check.
export function voidPurchaseOrder(reorderRequestId, { reason }) {
  if (isWriteBlocked()) {
    console.warn("WRITE BLOCKED (voidPurchaseOrder)", reorderRequestId);
    return Promise.resolve({ blocked: true });
  }

  const trimmedReason = reason?.trim() || "";
  if (!trimmedReason) {
    throw new Error("A reason is required to void this Purchase Order.");
  }

  const reorderRequestRef = doc(db, REORDER_REQUESTS_COLLECTION, reorderRequestId);
  const purchaseOrderRef = doc(db, PURCHASE_ORDERS_COLLECTION, reorderRequestId);
  const voidRef = doc(db, REORDER_PURCHASE_ORDER_VOIDS_COLLECTION, reorderRequestId);

  return runTransaction(db, async (transaction) => {
    // Firestore transactions require all reads before any writes.
    const [reorderRequestSnap, purchaseOrderSnap, voidSnap] = await Promise.all([
      transaction.get(reorderRequestRef),
      transaction.get(purchaseOrderRef),
      transaction.get(voidRef),
    ]);

    if (!reorderRequestSnap.exists()) {
      throw new Error("Reorder Request not found.");
    }
    if (!purchaseOrderSnap.exists()) {
      throw new Error("No Purchase Order is recorded for this Reorder Request.");
    }
    if (voidSnap.exists()) {
      throw new Error("This Purchase Order has already been voided.");
    }

    const reorderRequest = reorderRequestSnap.data();
    const purchaseOrder = purchaseOrderSnap.data();

    if (reorderRequest.status !== REORDER_REQUEST_STATUS.ORDERED) {
      throw new Error("This Reorder Request is not currently ORDERED.");
    }
    if (purchaseOrder.status !== PURCHASE_ORDER_STATUS.ORDERED) {
      throw new Error("This Purchase Order is not currently ORDERED.");
    }
    if (reorderRequest.assignedToUserId !== (auth.currentUser?.uid ?? null)) {
      throw new Error("Only the assigned Parts Associate can void this Purchase Order.");
    }

    const now = Date.now();
    const voidedBy = auth.currentUser?.uid ?? null;

    transaction.set(voidRef, {
      reorderPurchaseOrderId: reorderRequestId,
      reorderRequestId,
      partId: purchaseOrder.partId,
      voidedBy,
      reason: trimmedReason,
      createdAt: now,
    });

    transaction.update(reorderRequestRef, {
      status: REORDER_REQUEST_STATUS.VOIDED,
      voidedBy,
      voidedAt: now,
      voidReason: trimmedReason,
    });
  });
}
