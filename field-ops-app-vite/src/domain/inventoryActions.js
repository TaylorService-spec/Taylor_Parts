import { INVENTORY_ACTIONS_COLLECTION, INVENTORY_ACTION_TYPE } from "./constants";
import { makeCollectionStore } from "../firebase/collectionStore";
import { auth } from "../firebase/firebase";

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

const VALID_ACTION_TYPES = new Set(Object.values(INVENTORY_ACTION_TYPE));

// The only writer of an Inventory Action. Validated here, not just in
// the UI, since this is the sole write path:
// - Receive Stock requires a positive quantity.
// - Adjust Stock allows a positive or negative (non-zero) quantity.
// - Correct Mistake requires both a reason and notes.
export function recordInventoryAction({ partId, transactionType, quantityDelta, reason, notes }) {
  if (!VALID_ACTION_TYPES.has(transactionType)) {
    throw new Error(`Invalid inventory action type: ${transactionType}`);
  }

  const numericDelta = Number(quantityDelta);
  if (!Number.isFinite(numericDelta) || numericDelta === 0) {
    throw new Error("Quantity must be a non-zero number.");
  }
  if (transactionType === INVENTORY_ACTION_TYPE.RECEIVE_STOCK && numericDelta <= 0) {
    throw new Error("Receive Stock requires a positive quantity.");
  }

  const trimmedReason = reason?.trim() || "";
  const trimmedNotes = notes?.trim() || "";
  if (transactionType === INVENTORY_ACTION_TYPE.CORRECT_MISTAKE && (!trimmedReason || !trimmedNotes)) {
    throw new Error("Correct Mistake requires both a reason and notes.");
  }

  return inventoryActionsStore.add({
    partId,
    transactionType,
    quantityDelta: numericDelta,
    reason: trimmedReason || null,
    notes: trimmedNotes || null,
    createdBy: auth.currentUser?.uid ?? null,
  });
}
