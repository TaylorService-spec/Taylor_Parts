// Epic 2D Inventory Trigger System (see docs/architecture/ADR-003).
//
// Backend-only, ledger-based inventory side effects driven by Work
// Order state transitions -- a deterministic ledger mutation layer
// tied to Work Orders, not a workflow/staging system. Exactly 3
// primitives exist: reserveParts/releaseParts/consumeParts. No
// intermediate "confirmed on site"/"prepared for consumption" stages
// -- those aren't part of system truth (see STATE_TRIGGERS below).
//
// Truth boundary (load-bearing, don't blur this):
// - data/partsCatalog.ts is METADATA ONLY -- name/category/cost/unit,
//   plus a static warehouseQty baseline. It has NO stock authority and
//   is never written to.
// - inventory_transactions (this file's ledger) is the ONLY source of
//   truth for stock movement. No mutable "current stock" document
//   exists anywhere -- availability is always computed by summing this
//   append-only ledger against partsCatalog.ts's warehouseQty baseline
//   (see getAvailableQuantity() below), consistent with this project's
//   existing "derive aggregates on read, never cache a second mutable
//   total" default (see docs/architecture/ADR-001-retired-operational-core-branch.md).
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
const RESERVATION_LOCKS_COLLECTION = "inventory_reservation_locks";

// A per-part transaction sentinel serializes reservation attempts for that
// part. The ledger remains the stock authority: this document contains no
// quantity and is never read for availability. It is deliberately read and
// written in the same transaction so a competing reserve invalidates the
// transaction's ledger query result and forces Firestore to retry it.
const reservationLockRef = (partId: string) => db().collection(RESERVATION_LOCKS_COLLECTION).doc(partId);

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
  // GOVERNED MOVEMENT. Receiving, Transfer and reconciled Cycle Counts write to this SAME
  // append-only ledger, and this function used to ignore all of them -- it read only the legacy
  // Work-Order reservation types on top of the STATIC catalog baseline. A governed Part has no
  // static row, so its baseline is 0 and its real stock was invisible: PRT-1001 held 3 units across
  // two warehouses and a truck and reserveParts() saw 0, refusing the reservation as
  // "Insufficient stock". Governed stock could be received but never planned against.
  //
  // Summed across ALL locations, matching this function's warehouse-wide contract (a transfer
  // between two locations nets to zero here, which is correct -- it moved stock, it did not
  // create or destroy it). ADJUSTED already carries its sign.
  let governed = 0;
  snap.forEach((doc) => {
    const t = doc.data() as InventoryTransaction;
    if (t.type === "RESERVED") grossReserved += t.quantity;
    else if (t.type === "RELEASED") released += t.quantity;
    else if (t.type === "RECEIVED" || t.type === "TRANSFER_IN") governed += t.quantity;
    else if (t.type === "TRANSFER_OUT") governed -= t.quantity;
    else if (t.type === "ADJUSTED") governed += t.quantity;
  });

  // CONSUMED remains deliberately absent, exactly as before: consuming converts an existing
  // reservation into a permanent removal, and that quantity left availability when it was RESERVED.
  return warehouseQty + governed - (grossReserved - released);
}

// Outstanding (still-active) reservation for one Work Order + part --
// grossReserved - released - consumed, scoped to this WO only. Used by
// releaseParts()/consumeParts() to know how much is left to act on for
// this specific WO (as opposed to getAvailableQuantity(), which is
// warehouse-wide across all Work Orders).
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
): Promise<Array<{ sku: string; qtyPlanned: number; qtyUsed?: number }>> {
  const snap = await tx.get(db().collection(WORK_ORDERS_COLLECTION).doc(workOrderId));
  if (!snap.exists) throw new Error(`No Work Order with id ${workOrderId}`);
  const wo = snap.data() as WorkOrder;
  return (wo.inventorySnapshot ?? [])
    .filter((item) => (item.qtyPlanned ?? 0) > 0)
    .map((item) => ({ sku: item.sku, qtyPlanned: item.qtyPlanned as number, qtyUsed: item.qtyUsed }));
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

    // A WO's inventorySnapshot can carry more than one row for the same sku
    // (e.g. two duplicate-ref PART SO lines) -- a supported scenario. Sum
    // qtyPlanned per sku FIRST so the availability/insufficiency check and
    // the resulting ledger write are sized against the sku's TOTAL demand,
    // not evaluated per-row against the same un-decremented availability
    // figure (which would let each row separately pass and together
    // over-reserve past what's actually on hand).
    const plannedBySku = new Map<string, number>();
    for (const item of items) {
      plannedBySku.set(item.sku, (plannedBySku.get(item.sku) ?? 0) + item.qtyPlanned);
    }

    const availabilityByPart = new Map<string, number>();
    for (const sku of plannedBySku.keys()) {
      availabilityByPart.set(sku, await getAvailableQuantity(tx, sku));
    }
    // Firestore requires every transaction read before its first write.
    const locks = [...plannedBySku.keys()].map(reservationLockRef);
    await Promise.all(locks.map((ref) => tx.get(ref)));
    for (const ref of locks) tx.set(ref, { partId: ref.id, touchedAt: FieldValue.serverTimestamp() }, { merge: true });

    const insufficient: string[] = [];
    for (const [sku, totalPlanned] of plannedBySku) {
      const available = availabilityByPart.get(sku) ?? 0;
      if (totalPlanned > available) {
        insufficient.push(`${sku} (need ${totalPlanned}, ${available} available)`);
      }
    }
    if (insufficient.length > 0) {
      throw new Error(`Insufficient stock: ${insufficient.join("; ")}`);
    }

    for (const [sku, totalPlanned] of plannedBySku) {
      writeLedgerEntry(tx, { workOrderId, partId: sku, type: "RESERVED", quantity: totalPlanned });
    }
  });
}

// CANCELLED trigger. Releases whatever's still outstanding for this WO
// (per part) -- safe to call even if nothing was ever reserved (e.g. a
// WO cancelled before ever reaching DISPATCHED), since
// getOutstandingReservation() simply returns 0 in that case and no
// ledger entry is written.
export async function releaseParts(workOrderId: string): Promise<void> {
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

// COMPLETED trigger. Consumes the governed ACTUAL usage (qtyUsed --
// InventorySnapshotItem's field, see types/workOrder.ts), populated by
// updateWorkOrderExecutionData() (PartsScanner/ExecutionCapture) via
// mergeQtyUsed(), which clamps it to [0, qtyPlanned]. Falls back to
// qtyPlanned only when qtyUsed hasn't been recorded yet (preserves the
// pre-actuals behavior for WOs with no field usage data). The repair
// step still tops up the reservation to qtyPlanned first (so
// getOutstandingReservation() ends up exactly qtyPlanned per item),
// then consumes actual usage and RELEASES the remainder
// (qtyPlanned - actual) so no reservation is left stranded -- see
// Sales->Cash Lifecycle Build Plan P0.1. Because mergeQtyUsed() clamps
// qtyUsed <= qtyPlanned, actual usage can never exceed qtyPlanned here;
// the governed overage/additional-part path (used > planned) is a
// separate build (P1), not handled by this function. Validates each
// part's outstanding reservation actually covers qtyPlanned; throws
// (whole transaction aborts) rather than silently over-consuming if not.
export async function consumeParts(workOrderId: string): Promise<void> {
  await db().runTransaction(async (tx) => {
    const items = await getWorkOrderInventorySnapshot(tx, workOrderId);
    if (items.length === 0) return;

    const outstandingByPart = new Map<string, number>();
    for (const item of items) {
      outstandingByPart.set(item.sku, await getOutstandingReservation(tx, workOrderId, item.sku));
    }
    const availableByPart = new Map<string, number>();
    for (const item of items) {
      availableByPart.set(item.sku, await getAvailableQuantity(tx, item.sku));
    }
    const locks = [...new Set(items.map((item) => item.sku))].map(reservationLockRef);
    await Promise.all(locks.map((ref) => tx.get(ref)));

    const shortfalls: string[] = [];
    for (const item of items) {
      const missing = item.qtyPlanned - (outstandingByPart.get(item.sku) ?? 0);
      if (missing > (availableByPart.get(item.sku) ?? 0)) {
        shortfalls.push(`${item.sku} (need ${missing} additional, ${availableByPart.get(item.sku) ?? 0} available)`);
      }
    }
    if (shortfalls.length > 0) throw new Error(`Cannot consume, reservation shortfall: ${shortfalls.join("; ")}`);

    for (const ref of locks) tx.set(ref, { partId: ref.id, touchedAt: FieldValue.serverTimestamp() }, { merge: true });
    for (const item of items) {
      const missing = item.qtyPlanned - (outstandingByPart.get(item.sku) ?? 0);
      if (missing > 0) writeLedgerEntry(tx, { workOrderId, partId: item.sku, type: "RESERVED", quantity: missing });
    }

    for (const item of items) {
      // Governed actual usage: qtyUsed when recorded (mergeQtyUsed() already
      // clamped it to [0, qtyPlanned]), else fall back to qtyPlanned so a WO
      // with no field-usage data yet behaves exactly as before.
      const actual = item.qtyUsed ?? item.qtyPlanned;
      writeLedgerEntry(tx, { workOrderId, partId: item.sku, type: "CONSUMED", quantity: actual });

      // Release whatever of the (now-repaired-to-qtyPlanned) reservation
      // wasn't actually used, so the unused remainder isn't stranded and
      // available stock reflects real consumption.
      const remainder = item.qtyPlanned - actual;
      if (remainder > 0) {
        writeLedgerEntry(tx, { workOrderId, partId: item.sku, type: "RELEASED", quantity: remainder });
      }
    }
  });
}

// COMPLETED trigger, second step (after consumeParts). Not a ledger
// write -- just marks this Work Order's inventory processing as fully
// wrapped up in inventory_sync_status, for anything that might later
// want to know "is this WO's inventory story fully closed out."
export async function finalizeInventoryTransaction(workOrderId: string): Promise<void> {
  const ref = db().collection(INVENTORY_SYNC_STATUS_COLLECTION).doc(workOrderId);
  await ref.set({ workOrderId, finalized: true }, { merge: true });
}

// Strict mapping, exactly 3 real operations -- no ARRIVED/
// WORK_IN_PROGRESS entries. Those states have no ledger-writeable
// meaning yet (the ledger's type enum is RESERVED/RELEASED/CONSUMED
// only); rather than tracking phantom "confirmed on site"/"prepared
// for consumption" stages with no operational effect,
// triggerInventoryEffects() simply no-ops for any state not listed
// here (see its `if (!trigger) return;` below) -- so ARRIVED/
// WORK_IN_PROGRESS never appear in inventory_sync_status at all,
// rather than appearing as a no-op "processed" entry.
const STATE_TRIGGERS: Partial<Record<WorkOrderStatus, (workOrderId: string) => Promise<void>>> = {
  DISPATCHED: reserveParts,
  COMPLETED: async (workOrderId) => {
    await consumeParts(workOrderId);
    await finalizeInventoryTransaction(workOrderId);
  },
  CANCELLED: releaseParts,
};

// Atomically claims (workOrderId, state) for processing so a state can
// only ever be claimed by one in-flight caller at a time. Mirrors the
// reservationLockRef pattern above: the claim is read and (conditionally)
// written in the same transaction, so a second concurrent call racing the
// first is forced by Firestore to retry its transaction and re-observe
// the first call's write -- it then correctly sees processedStates[state]
// or claims[state] already set and returns false without ever invoking
// the underlying trigger. This is what closes the check-then-act gap
// a plain "read processedStates, later write processedStates" guard
// would otherwise have.
async function claimStateForProcessing(workOrderId: string, state: WorkOrderStatus): Promise<boolean> {
  const ref = db().collection(INVENTORY_SYNC_STATUS_COLLECTION).doc(workOrderId);
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const status = snap.data() as InventorySyncStatus | undefined;
    if (status?.processedStates?.[state] === true) return false;
    if (status?.claims?.[state] === true) return false;
    tx.set(ref, { workOrderId, claims: { [state]: true } }, { merge: true });
    return true;
  });
}

// Releases a claim without marking the state processed -- used when the
// trigger fails, so a later retry (a fresh claimStateForProcessing() call)
// is able to claim the state again.
async function clearClaim(workOrderId: string, state: WorkOrderStatus): Promise<void> {
  const ref = db().collection(INVENTORY_SYNC_STATUS_COLLECTION).doc(workOrderId);
  await ref.set({ workOrderId, claims: { [state]: FieldValue.delete() } }, { merge: true });
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
      // The claim served its purpose (serializing concurrent attempts);
      // once processed, processedStates[state] alone is authoritative.
      claims: { [state]: FieldValue.delete() },
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
// (workOrderId, state) -- claimStateForProcessing() will correctly see
// it hasn't succeeded yet (recordFailure() never marks it processed,
// and a failed attempt's own clearClaim() releases the claim) and
// re-attempt the trigger. No cron/background system exists or is
// needed for this (per section 11's "No continuous background system
// required") -- a future manual/admin retry action would just call
// this same function.
//
// The processed-state guard is claimed atomically via
// claimStateForProcessing() (a transactional create-if-absent against
// inventory_sync_status, same pattern as reservationLockRef elsewhere in
// this file) rather than a plain isStateProcessed() read followed by a
// separate markStateProcessed() write. Two concurrent calls for the same
// (workOrderId, state) -- e.g. a live transition-driven call racing an
// operator retry tool -- can no longer both observe "unprocessed" and
// both run the underlying trigger: only one claims it, the loser returns
// immediately without touching the ledger.
export async function triggerInventoryEffects(workOrderId: string, newState: WorkOrderStatus): Promise<void> {
  const trigger = STATE_TRIGGERS[newState];
  if (!trigger) return;

  const claimed = await claimStateForProcessing(workOrderId, newState);
  if (!claimed) return;

  try {
    await trigger(workOrderId);
    await markStateProcessed(workOrderId, newState);
  } catch (err) {
    await recordFailure(workOrderId, newState, err);
    await clearClaim(workOrderId, newState);
  }
}
