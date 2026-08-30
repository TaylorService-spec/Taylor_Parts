import { INVENTORY_ACTIONS_COLLECTION } from "./constants";
import { makeCollectionStore } from "../firebase/collectionStore";

// Sprint 2.1.9 -- Inventory Actions Foundation
// (docs/BusinessEntityModel.md's Reorder Request entry documents the
// same client-direct-write pattern this mirrors). This is the ONLY
// writer of inventory_actions -- no component calls addDoc/setDoc
// directly, same single-write-path discipline as
// domain/inventoryReorderRequests.js/accounts.js/locations.js. Reuses
// makeCollectionStore (firebase/collectionStore.js) rather than a
// hand-rolled Firestore call, so writes go through
// lib/firebaseSafe.js's demo/panic-mode write-blocking the same way
// every other client-direct-write collection already does. No Cloud
// Function -- not required (a single, unconditional create, no
// cross-document invariant to protect, and not part of the Work Order
// -driven inventory_transactions ledger this is deliberately separate
// from).
//
// An Inventory Action is: { id, partId, transactionType, quantityDelta,
// reason, notes, createdBy, createdAt }. `createdAt` (stamped
// automatically by makeCollectionStore.add()) is this record's
// creation timestamp -- an immutable fact, never rewritten. There is
// no update or delete path: correcting a mistake means recording
// ANOTHER action (CORRECT_MISTAKE), never editing history -- this
// collection is append-only, same posture as inventory_transactions,
// just a separate one for human-initiated actions instead of Work
// Order-driven stock movement.
export const inventoryActionsStore = makeCollectionStore(INVENTORY_ACTIONS_COLLECTION);


// The only writer of an Inventory Action. Validated here, not just in
// the UI, since this is the sole write path:
// - Receive Stock requires a positive quantity.
// - Adjust Stock allows a positive or negative (non-zero) quantity.
// - Correct Mistake requires both a reason and notes.
/**
 * RETIRED. Owner ruling, 2026-08-30: retire new inventory_actions writes; keep existing history
 * readable.
 *
 * This function is kept, and kept exported, rather than deleted -- because deleting it would take
 * the REASON with it, and the next person to want an inventory note on the Part record would
 * simply write another one. It now refuses, and says why.
 *
 * WHY IT REFUSES. `inventory_actions` is not stock authority and is never reconciled with the
 * governed ledger. Every entry was a second, parallel assertion that stock had moved, with no
 * mechanism that could ever make the two agree. Its vocabulary was overtaken besides: Receiving
 * owns receiving, Transfers own transfers, and the Cycle Count / governed adjustment paths own
 * their movement.
 *
 * The historical documents are untouched, still read by useInventoryActionsForPart, and still
 * catalogued for reporting. Nothing is deleted and nothing is migrated into the ledger.
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
