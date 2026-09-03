import { doc, runTransaction } from "firebase/firestore";
import { submitRecordReorderPurchaseOrder } from "../services/reorderCallableClient.js";
import { db, auth } from "../firebase/firebase";
import { fromMajorString } from "./money.js";
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
  // `partId` is still ACCEPTED so existing call sites keep working unchanged, and deliberately not
  // used: the server reads the part from the reorder request inside its transaction, so a PO can
  // never be recorded against a part the request never named. A client-supplied part would be a
  // second, forgeable answer to a question the request already answers.
  {
    partId: _partId,
    supplierName,
    externalPoNumber,
    orderedQuantity,
    orderedDate,
    expectedArrivalDate,
    // FIN-BLOCK-003A ACTIVATION -- the committed unit price, as the MAJOR-unit string the purchasing
    // user typed ("19.99"), plus its currency. A string, deliberately: a float has already lost the
    // exactness this conversion exists to preserve by the time it reaches here.
    unitPriceMajor,
    currency,
  }
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

  // ==================== THE COMMITTED PRICE (FIN-BLOCK-003A activation) ====================
  //
  // Converted here, once, through domain/money.js's `fromMajorString` -- the repo's existing exact
  // major-to-minor parser. NOT re-implemented: it already rejects more fractional digits than the
  // currency allows (so "19.999" is refused rather than silently rounded to a price nobody agreed),
  // reads the string digit-by-digit rather than multiplying a float, and range-checks the result.
  //
  // `Number(major) * 100` is the obvious alternative and it is wrong: 19.99 * 100 is 1998.9999...
  // in IEEE-754, and the rounding needed to rescue it is a decision about someone's money.
  //
  // ZERO IS A LEGAL PRICE and must survive every falsy check below -- a no-charge line (warranty
  // replacement, sample, supplier making good) is a real commercial fact. Only an EMPTY field is
  // missing, which is why this tests for empty string rather than for falsiness.
  const trimmedCurrency = (currency ?? "").trim().toUpperCase();
  const priceText = typeof unitPriceMajor === "string" ? unitPriceMajor.trim() : String(unitPriceMajor ?? "").trim();
  if (priceText === "") {
    throw new Error("Unit purchase price is required. Enter 0 for a no-charge line.");
  }
  if (!/^[A-Z]{3}$/.test(trimmedCurrency)) {
    throw new Error("Currency is required (a 3-letter code such as USD).");
  }
  let unitPriceMinor;
  try {
    unitPriceMinor = fromMajorString(priceText, trimmedCurrency).minor;
  } catch {
    // The parser's own message names internals; this one names what the person must change.
    throw new Error(`Enter the unit purchase price as an amount in ${trimmedCurrency}, for example 19.99.`);
  }
  if (unitPriceMinor < 0) {
    throw new Error("Unit purchase price cannot be negative.");
  }

  // WORKSTREAM 2B -- THIS NOW GOES THROUGH THE TRUSTED COMMAND, not a client transaction.
  //
  // Recording a purchase order writes a governed ownership fact: the PO inherits its
  // operatingCompanyId from the reorder request. A client cannot be the authority for that, and it
  // must not be able to supply or override it -- so firestore.rules retires both the PO create and
  // the request's Record-PO transition in the same change that adds this call.
  //
  // THE ATOMICITY DID NOT MOVE TO THE CLIENT, IT MOVED TO THE SERVER. Rules used to cross-pin the
  // two writes with existsAfter/getAfter; recordReorderPurchaseOrder now performs both inside one
  // Admin-SDK transaction. Equal strength, different enforcement point -- and no longer something
  // a browser transaction is trusted to get right.
  //
  // NO FALLBACK to the old runTransaction path on failure: that would recreate two write
  // authorities for one command.
  //
  // partId is deliberately NOT sent. The server reads it from the request inside the transaction,
  // so the PO cannot be recorded against a part the request never named.
  return submitRecordReorderPurchaseOrder({
    reorderRequestId,
    supplierName: trimmedSupplier,
    externalPoNumber: trimmedPoNumber,
    orderedQuantity: numericQty,
    orderedDate,
    expectedArrivalDate: expectedArrivalDate ?? null,
    // MINOR UNITS cross the wire, never the typed string. The exact conversion happened once, above,
    // where the currency that governs the number of decimal places was known.
    unitPriceMinor,
    currency: trimmedCurrency,
  });
}

// Cancel/Void schema deployment sequence, PR 5 of 6 (docs/specifications/
// reorder-request-cancellation.md). The ONLY writer of a
// reorder_purchase_order_voids record. Atomically creates the void
// record AND transitions the linked Reorder Request to VOIDED, in a
// single Firestore transaction.
//
// This USED to say "same atomicity pattern recordPurchaseOrder() above
// already established". It no longer is: Workstream 2B moved that one
// to a trusted callable, because recording a PO authors a governed
// company fact. Void authors none -- it writes a void record and closes
// a request -- so it stays client-direct under unchanged Rules, and its
// atomicity is still this client transaction plus the Rules'
// cross-document invariant.
//
// The original reorder_purchase_orders document is read
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
