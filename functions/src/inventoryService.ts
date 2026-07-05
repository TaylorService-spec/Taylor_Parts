// Epic 2D Inventory Trigger System (see docs/architecture/ADR-003).
//
// Backend-only, ledger-based inventory side effects driven by Work
// Order state transitions. No mutable "current stock" document exists
// anywhere -- availability is always computed by summing the
// append-only inventory_transactions ledger against
// data/partsCatalog.ts's static warehouseQty baseline (see
// getAvailableQuantity() below), consistent with this project's
// existing "derive aggregates on read, never cache a second mutable
// total" default (see docs/architecture/ADR-001-retired-operational-core-branch.md).
//
// This file NEVER writes to fieldops_wos and NEVER touches Work Order
// state -- it is called strictly AFTER a Work Order transition has
// already committed (see transitionWorkOrder.ts's post-commit call to
// triggerInventoryEffects()), and a failure here never rolls back or
// blocks that already-successful transition.
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import type { Transaction } from "firebase-admin/firestore";
import {
  WORK_ORDERS_COLLECTION,
  INVENTORY_TRANSACTIONS_COLLECTION,
  INVENTORY_SYNC_STATUS_COLLECTION,
} from "./constants/collections";
import { getCatalogItem } from "./data/partsCatalog";
import type { WorkOrder, WorkOrderStatus } from "./types/workOrder";
import type { InventoryTransaction, InventorySyncStatus } from "./types/inventoryTransaction";

const db = () => getFirestore();

// available = warehouseQty - (grossReserved - released). CONSUMED is
// deliberately NOT subtracted again here: consuming a part converts an
// existing reservation into a permanent removal without changing
// total availability -- that quantity was already excluded from
// availability the moment it was reserved. Only RESERVED (removes
// availability) and RELEASED (restores it) move the number; CONSUMED
// just finalizes what RESERVED already accounted for.
async function getAvailableQuantity(tx: Transaction, partId: string): Promise<number> {
  const catalogItem = getCatalogItem(partId);
  const warehouseQty = catalogItem?.warehouseQty ?? 0;

  const snap = await tx.get(db().collection(INVENTORY_TRANSACTIONS_COLLECTION).where("partId", "==", partId));
  let grossReserved = 0;
  let released = 0;
  snap.forEach((doc) => {
    const t = doc.data() as InventoryTransaction;
    if (t.type === "RESERVED") grossReserved += t.quantity;
    else if (t.type === "RELEASED") released += t.quantity;
  });

  return warehouseQty - (grossReserved - released);
}

// Outstanding (still-active) reservation for one Work Order + part --
// grossReserved - released - consumed, scoped to this WO only. Used by
// releaseReservedParts()/consumeParts() to know how much is left to
// act on for this specific WO (as opposed to getAvailableQuantity(),
// which is warehouse-wide across all Work Orders).
async function getOutstandingReservation(
  tx: Transaction,
  workOrderId: string,
  partId: string
): Promise<number> {
  const snap = await tx.get(
    db()
      .collection(INVENTORY_TRANSACTIONS_COLLECTION)
      .where("workOrderId", "==", workOrderId)
      .where("partId", "==", partId)
  );
  let reserved = 0;
  let released = 0;
  let consumed = 0;
  snap.forEach((doc) => {
    const t = doc.data() as InventoryTransaction;
    if (t.type === "RESERVED") reserved += t.quantity;
    else if (t.type === "RELEASED") released += t.quantity;
    else if (t.type === "CONSUMED") consumed += t.quantity;
  });
  return reserved - released - consumed;
}

function writeLedgerEntry(
  tx: Transaction,
  entry: Omit<InventoryTransaction, "id" | "timestamp">
): void {
  const ref = db().collection(INVENTORY_TRANSACTIONS_COLLECTION).doc();
  tx.set(ref, { ...entry, timestamp: FieldValue.serverTimestamp() });
}

async function getWorkOrderInventorySnapshot(
  tx: Transaction,
  workOrderId: string
): Promise<Array<{ sku: string; qtyPlanned: number }>> {
  const snap = await tx.get(db().collection(WORK_ORDERS_COLLECTION).doc(workOrderId));
  if (!snap.exists) throw new Error(`No Work Order with id ${workOrderId}`);
  const wo = snap.data() as WorkOrder;
  return (wo.inventorySnapshot ?? [])
    .filter((item) => (item.qtyPlanned ?? 0) > 0)
    .map((item) => ({ sku: item.sku, qtyPlanned: item.qtyPlanned as number }));
}

// DISPATCHED trigger. All-or-nothing: if ANY planned part lacks enough
// available quantity, the whole transaction aborts (atomic -- no
// partial reservations ever land), and the caller (triggerInventoryEffects)
// records this as a failure for later retry rather than a Work Order
// state rollback (the Work Order stays DISPATCHED regardless -- see
// this epic's failure model).
export async function reserveParts(workOrderId: string): Promise<void> {
  await db().runTransaction(async (tx) => {
    const items = await getWorkOrderInventorySnapshot(tx, workOrderId);
    if (items.length === 0) return;

    const insufficient: string[] = [];
    for (const item of items) {
      const available = await getAvailableQuantity(tx, item.sku);
      if (item.qtyPlanned > available) {
        insufficient.push(`${item.sku} (need ${item.qtyPlanned}, ${available} available)`);
      }
    }
    if (insufficient.length > 0) {
      throw new Error(`Insufficient stock: ${insufficient.join("; ")}`);
    }

    for (const item of items) {
      writeLedgerEntry(tx, { workOrderId, partId: item.sku, type: "RESERVED", quantity: item.qtyPlanned });
    }
  });
}

// CANCELLED trigger. Releases whatever's still outstanding for this WO
// (per part) -- safe to call even if nothing was ever reserved (e.g. a
// WO cancelled before ever reaching DISPATCHED), since
// getOutstandingReservation() simply returns 0 in that case and no
// ledger entry is written.
export async function releaseReservedParts(workOrderId: string): Promise<void> {
  await db().runTransaction(async (tx) => {
    const items = await getWorkOrderInventorySnapshot(tx, workOrderId);
    for (const item of items) {
      const outstanding = await getOutstandingReservation(tx, workOrderId, item.sku);
      if (outstanding > 0) {
        writeLedgerEntry(tx, { workOrderId, partId: item.sku, type: "RELEASED", quantity: outstanding });
      }
    }
  });
}

// COMPLETED trigger. Consumes qtyPlanned, not qtyUsed -- qtyUsed
// (InventorySnapshotItem's "actual usage" field, see
// types/workOrder.ts) has no populate path anywhere in this app yet
// (Epic 1.1 explicitly deferred it, and UI inventory integration is
// out of scope for this epic too) -- there is nothing else to consume
// from. Validates each part's outstanding reservation actually covers
// what's being consumed; throws (whole transaction aborts) rather than
// silently over-consuming if not.
export async function consumeParts(workOrderId: string): Promise<void> {
  await db().runTransaction(async (tx) => {
    const items = await getWorkOrderInventorySnapshot(tx, workOrderId);
    if (items.length === 0) return;

    const shortfalls: string[] = [];
    const outstandingByPart = new Map<string, number>();
    for (const item of items) {
      const outstanding = await getOutstandingReservation(tx, workOrderId, item.sku);
      outstandingByPart.set(item.sku, outstanding);
      if (outstanding < item.qtyPlanned) {
        shortfalls.push(`${item.sku} (need ${item.qtyPlanned} reserved, only ${outstanding} outstanding)`);
      }
    }
    if (shortfalls.length > 0) {
      throw new Error(`Cannot consume, reservation shortfall: ${shortfalls.join("; ")}`);
    }

    for (const item of items) {
      writeLedgerEntry(tx, { workOrderId, partId: item.sku, type: "CONSUMED", quantity: item.qtyPlanned });
    }
  });
}

// ARRIVED / WORK_IN_PROGRESS triggers. The ledger's type enum
// (RESERVED/RELEASED/CONSUMED only, see types/inventoryTransaction.ts)
// has no entry for "confirmed on site" or "prepared for consumption" --
// inventing a 4th/5th transaction type not in that schema was avoided
// deliberately. These are placeholders: idempotency-tracked (so they
// still show up as "processed" in inventory_sync_status) but write no
// ledger entry, pending a future epic actually defining what, if
// anything, they should record.
export async function confirmPartsOnSite(_workOrderId: string): Promise<void> {
  // Deliberately no-op -- see header comment.
}

export async function prepareConsumption(_workOrderId: string): Promise<void> {
  // Deliberately no-op -- see header comment. Matches this epic's own
  // spec note for WORK_IN_PROGRESS: "(no final deduction yet)".
}

// COMPLETED trigger, second step (after consumeParts). Not a ledger
// write -- just marks this Work Order's inventory processing as fully
// wrapped up in inventory_sync_status, for anything that might later
// want to know "is this WO's inventory story fully closed out."
export async function finalizeInventoryTransaction(workOrderId: string): Promise<void> {
  const ref = db().collection(INVENTORY_SYNC_STATUS_COLLECTION).doc(workOrderId);
  await ref.set({ workOrderId, finalized: true }, { merge: true });
}

const STATE_TRIGGERS: Partial<Record<WorkOrderStatus, (workOrderId: string) => Promise<void>>> = {
  DISPATCHED: reserveParts,
  ARRIVED: confirmPartsOnSite,
  WORK_IN_PROGRESS: prepareConsumption,
  COMPLETED: async (workOrderId) => {
    await consumeParts(workOrderId);
    await finalizeInventoryTransaction(workOrderId);
  },
  CANCELLED: releaseReservedParts,
};

async function isStateProcessed(workOrderId: string, state: WorkOrderStatus): Promise<boolean> {
  const snap = await db().collection(INVENTORY_SYNC_STATUS_COLLECTION).doc(workOrderId).get();
  const status = snap.data() as InventorySyncStatus | undefined;
  return status?.processedStates?.[state] === true;
}

async function markStateProcessed(workOrderId: string, state: WorkOrderStatus): Promise<void> {
  const ref = db().collection(INVENTORY_SYNC_STATUS_COLLECTION).doc(workOrderId);
  await ref.set(
    {
      workOrderId,
      processedStates: { [state]: true },
      // Clear any prior failure for this state now that it succeeded --
      // Firestore's merge:true keeps sibling fields (other states'
      // failures) untouched, only this state's failure key is removed.
      failures: { [state]: FieldValue.delete() },
    },
    { merge: true }
  );
}

async function recordFailure(workOrderId: string, state: WorkOrderStatus, error: unknown): Promise<void> {
  const ref = db().collection(INVENTORY_SYNC_STATUS_COLLECTION).doc(workOrderId);
  const message = error instanceof Error ? error.message : String(error);
  await ref.set(
    {
      workOrderId,
      failures: { [state]: { error: message, at: Timestamp.now(), retryNeeded: true } },
    },
    { merge: true }
  );
}

// The single entry point transitionWorkOrder.ts calls after a Work
// Order transition has already committed. Idempotent (skips if this
// state was already processed for this WO) and never throws -- a
// failure is caught, recorded via recordFailure() (retryNeeded: true),
// and swallowed, since the Work Order's own state is already committed
// and must never be affected by an inventory-side failure (see this
// epic's failure model, section 10).
//
// Retrying is simply calling this function again for the same
// (workOrderId, state) -- isStateProcessed() will correctly see it
// hasn't succeeded yet (recordFailure() never marks it processed) and
// re-attempt the trigger. No cron/background system exists or is
// needed for this (per section 11's "No continuous background system
// required") -- a future manual/admin retry action would just call
// this same function.
export async function triggerInventoryEffects(workOrderId: string, newState: WorkOrderStatus): Promise<void> {
  const trigger = STATE_TRIGGERS[newState];
  if (!trigger) return;

  if (await isStateProcessed(workOrderId, newState)) return;

  try {
    await trigger(workOrderId);
    await markStateProcessed(workOrderId, newState);
  } catch (err) {
    await recordFailure(workOrderId, newState, err);
  }
}
