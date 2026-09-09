import { submitRecordReorderPurchaseOrder, submitVoidPurchaseOrder } from "../services/reorderCallableClient.js";
import { fromMajorString } from "./money.js";
import { isWriteBlocked } from "../config/env";
// No collection names and no status constants are imported here any more. Both writers go through
// the trusted transport, and the server names its own collections and its own target statuses --
// a client-side copy of either would be a second answer to a question it no longer asks.

// Sprint 2.1.10 -- Purchase Order Foundation. The entry point for recording a purchase
// order and transitioning its Reorder Request to ORDERED.
//
// THIS HEADER USED TO DESCRIBE A CLIENT-SIDE runTransaction() and argued at length that no
// Cloud Function was needed because both collections accepted client-direct writes under
// Rules. Every sentence of that is now historical: Workstream 2B moved the write to the
// trusted recordReorderPurchaseOrder command, and nothing in this file touches Firestore.
// It is rewritten rather than annotated because a header whose first claim is false is
// worse than no header -- the correction used to sit ten lines below the claim.
//
// Both documents still commit together or not at all; the atomicity moved to an Admin-SDK
// transaction on the server. Duplicate prevention is likewise the server's: the purchase
// order's document id IS the reorderRequestId, and the command refuses a second one rather
// than relying on a Rules `update` denial to catch it.
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
// reorder-request-cancellation.md). The ONLY writer of a reorder_purchase_order_voids record.
// Creates the void record AND transitions the linked Reorder Request to VOIDED, atomically.
//
// NOW A TRUSTED COMMAND, like recordPurchaseOrder() above. The earlier note here argued Void
// could stay client-direct because it authors no operating-company fact -- true, and no longer
// the criterion: the browser was still the one composing a two-document write and asserting its
// own identity, with Rules as the only thing standing between the two. The atomicity did not move
// to the client, it moved to the server; the cross-document invariant and the assignee scope moved
// with it.
//
// The reorder_purchase_orders document is still read (to confirm it exists, confirm its status is
// ORDERED, and copy partId) and still NEVER written -- Void never modifies or deletes it.
export function voidPurchaseOrder(reorderRequestId, { reason }) {
  if (isWriteBlocked()) {
    console.warn("WRITE BLOCKED (voidPurchaseOrder)", reorderRequestId);
    return Promise.resolve({ blocked: true });
  }

  const trimmedReason = reason?.trim() || "";
  if (!trimmedReason) {
    throw new Error("A reason is required to void this Purchase Order.");
  }

  // THROUGH THE TRUSTED COMMAND, not a client transaction.
  //
  // Every condition survives, enforced where it can no longer be bypassed: the request must exist
  // and be ORDERED, the purchase order must exist and be ORDERED, the void must not already exist,
  // and the actor must be the request's own assignedToUserId. That last one used to be checked here
  // against `auth.currentUser` with the comment "Rules are the actual enforcement, not this check";
  // the server now compares request.auth.uid against the value it reads from the request document,
  // so there is no client-side check left to be advisory about.
  //
  // The cross-document invariant survives too: one server-side `nowMillis` is written as both
  // reorder_requests.voidedAt and reorder_purchase_order_voids.createdAt, in one transaction. The
  // purchase order itself is still read and never written.
  //
  // NO FALLBACK to the transaction on failure -- two write authorities for one command is the thing
  // being removed.
  return submitVoidPurchaseOrder({ reorderRequestId, reason: trimmedReason });
}
