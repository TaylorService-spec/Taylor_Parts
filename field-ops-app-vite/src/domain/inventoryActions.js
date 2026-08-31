// INVENTORY ACTIONS — the write side, retired. Owner ruling, 2026-08-30.
//
// Sprint 2.1.9 built this as the ONLY writer of `inventory_actions`: a client-direct create through
// makeCollectionStore, deliberately separate from the Work-Order-driven `inventory_transactions`
// ledger, recording a person's own Receive Stock / Adjust Stock / Correct Mistake note.
//
// ============================ WHY THE WRITE SIDE IS GONE ============================
//
// `inventory_actions` is not stock authority and was never reconciled with the governed ledger —
// the entity register states it outright: "the two collections are never joined or reconciled by
// any code in this repository." Each note was therefore a second, parallel assertion that stock had
// moved, standing beside a ledger that said otherwise, with no mechanism that could ever make the
// two agree.
//
// Its vocabulary had been overtaken besides. Receiving owns receiving, Transfers own transfers, and
// the Cycle Count / governed adjustment paths own their movement. A note here could only shadow
// them.
//
// ============================ WHAT SURVIVES, AND WHAT DOES NOT ============================
//
// READS ARE UNTOUCHED. hooks/useInventoryActions.js still queries the collection directly, the Part
// record still shows the history, and every existing document keeps its actor and its timestamp.
// Nothing was deleted and nothing was migrated into the ledger.
//
// THE STORE HANDLE IS GONE. `inventoryActionsStore` used to be exported here — a live, `.add()`-
// capable handle on the collection. Retiring recordInventoryAction() while leaving that export
// standing would have closed the front door and left the side one open: a second write path,
// quieter than the first, and used by nothing. An unused writable handle is an invitation, so it
// was removed rather than commented.
//
// WHAT THIS FILE CANNOT CLOSE. firestore.rules still carries
// `allow create: if isAdminOrDispatcher()` on this collection, with no field validation and a
// `createdBy` that Rules never bind to request.auth.uid. With the product's paths shut, THAT RULE
// IS NOW THE ONLY REMAINING WAY TO CREATE A DOCUMENT. Closing it is a Tier-2 change, tracked
// separately, and deliberately not attempted from here.

/**
 * RETIRED — always throws. Owner ruling, 2026-08-30.
 *
 * Kept, and kept exported, rather than deleted: deleting it would take the REASON with it, and the
 * next person wanting an inventory note on the Part record would simply write another writer. This
 * refuses instead, and says why — so a re-wiring fails loudly at the first call rather than quietly
 * resuming the creation of parallel assertions about stock.
 *
 * @throws always.
 */
export function recordInventoryAction() {
  throw new Error(
    "inventory_actions no longer accepts new entries (Owner ruling, 2026-08-30). It is not stock " +
      "authority and is never reconciled with the governed ledger. Receiving, Transfers and the " +
      "Cycle Count / governed adjustment paths own their movements; record it there. Existing " +
      "history remains readable.",
  );
}
