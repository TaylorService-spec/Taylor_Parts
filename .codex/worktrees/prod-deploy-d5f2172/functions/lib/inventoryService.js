"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reserveParts = reserveParts;
exports.releaseParts = releaseParts;
exports.consumeParts = consumeParts;
exports.finalizeInventoryTransaction = finalizeInventoryTransaction;
exports.triggerInventoryEffects = triggerInventoryEffects;
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
const firestore_1 = require("firebase-admin/firestore");
const collections_1 = require("./constants/collections");
const partsCatalog_1 = require("./data/partsCatalog");
const db = () => (0, firestore_1.getFirestore)();
// available = warehouseQty - (grossReserved - released). CONSUMED is
// deliberately NOT subtracted again here: consuming a part converts an
// existing reservation into a permanent removal without changing
// total availability -- that quantity was already excluded from
// availability the moment it was reserved. Only RESERVED (removes
// availability) and RELEASED (restores it) move the number; CONSUMED
// just finalizes what RESERVED already accounted for.
async function getAvailableQuantity(tx, partId) {
    const catalogItem = (0, partsCatalog_1.getCatalogItem)(partId);
    const warehouseQty = catalogItem?.warehouseQty ?? 0;
    const snap = await tx.get(db().collection(collections_1.INVENTORY_TRANSACTIONS_COLLECTION).where("partId", "==", partId));
    let grossReserved = 0;
    let released = 0;
    snap.forEach((doc) => {
        const t = doc.data();
        if (t.type === "RESERVED")
            grossReserved += t.quantity;
        else if (t.type === "RELEASED")
            released += t.quantity;
    });
    return warehouseQty - (grossReserved - released);
}
// Outstanding (still-active) reservation for one Work Order + part --
// grossReserved - released - consumed, scoped to this WO only. Used by
// releaseParts()/consumeParts() to know how much is left to act on for
// this specific WO (as opposed to getAvailableQuantity(), which is
// warehouse-wide across all Work Orders).
async function getOutstandingReservation(tx, workOrderId, partId) {
    const snap = await tx.get(db()
        .collection(collections_1.INVENTORY_TRANSACTIONS_COLLECTION)
        .where("workOrderId", "==", workOrderId)
        .where("partId", "==", partId));
    let reserved = 0;
    let released = 0;
    let consumed = 0;
    snap.forEach((doc) => {
        const t = doc.data();
        if (t.type === "RESERVED")
            reserved += t.quantity;
        else if (t.type === "RELEASED")
            released += t.quantity;
        else if (t.type === "CONSUMED")
            consumed += t.quantity;
    });
    return reserved - released - consumed;
}
function writeLedgerEntry(tx, entry) {
    const ref = db().collection(collections_1.INVENTORY_TRANSACTIONS_COLLECTION).doc();
    tx.set(ref, { ...entry, timestamp: firestore_1.FieldValue.serverTimestamp() });
}
async function getWorkOrderInventorySnapshot(tx, workOrderId) {
    const snap = await tx.get(db().collection(collections_1.WORK_ORDERS_COLLECTION).doc(workOrderId));
    if (!snap.exists)
        throw new Error(`No Work Order with id ${workOrderId}`);
    const wo = snap.data();
    return (wo.inventorySnapshot ?? [])
        .filter((item) => (item.qtyPlanned ?? 0) > 0)
        .map((item) => ({ sku: item.sku, qtyPlanned: item.qtyPlanned }));
}
// DISPATCHED trigger. All-or-nothing: if ANY planned part lacks enough
// available quantity, the whole transaction aborts (atomic -- no
// partial reservations ever land), and the caller (triggerInventoryEffects)
// records this as a failure for later retry rather than a Work Order
// state rollback (the Work Order stays DISPATCHED regardless -- see
// this epic's failure model).
async function reserveParts(workOrderId) {
    await db().runTransaction(async (tx) => {
        const items = await getWorkOrderInventorySnapshot(tx, workOrderId);
        if (items.length === 0)
            return;
        const insufficient = [];
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
async function releaseParts(workOrderId) {
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
async function consumeParts(workOrderId) {
    await db().runTransaction(async (tx) => {
        const items = await getWorkOrderInventorySnapshot(tx, workOrderId);
        if (items.length === 0)
            return;
        const shortfalls = [];
        const outstandingByPart = new Map();
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
// COMPLETED trigger, second step (after consumeParts). Not a ledger
// write -- just marks this Work Order's inventory processing as fully
// wrapped up in inventory_sync_status, for anything that might later
// want to know "is this WO's inventory story fully closed out."
async function finalizeInventoryTransaction(workOrderId) {
    const ref = db().collection(collections_1.INVENTORY_SYNC_STATUS_COLLECTION).doc(workOrderId);
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
const STATE_TRIGGERS = {
    DISPATCHED: reserveParts,
    COMPLETED: async (workOrderId) => {
        await consumeParts(workOrderId);
        await finalizeInventoryTransaction(workOrderId);
    },
    CANCELLED: releaseParts,
};
async function isStateProcessed(workOrderId, state) {
    const snap = await db().collection(collections_1.INVENTORY_SYNC_STATUS_COLLECTION).doc(workOrderId).get();
    const status = snap.data();
    return status?.processedStates?.[state] === true;
}
async function markStateProcessed(workOrderId, state) {
    const ref = db().collection(collections_1.INVENTORY_SYNC_STATUS_COLLECTION).doc(workOrderId);
    await ref.set({
        workOrderId,
        processedStates: { [state]: true },
        // Clear any prior failure for this state now that it succeeded --
        // Firestore's merge:true keeps sibling fields (other states'
        // failures) untouched, only this state's failure key is removed.
        failures: { [state]: firestore_1.FieldValue.delete() },
    }, { merge: true });
}
async function recordFailure(workOrderId, state, error) {
    const ref = db().collection(collections_1.INVENTORY_SYNC_STATUS_COLLECTION).doc(workOrderId);
    const message = error instanceof Error ? error.message : String(error);
    await ref.set({
        workOrderId,
        failures: { [state]: { error: message, at: firestore_1.Timestamp.now(), retryNeeded: true } },
    }, { merge: true });
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
async function triggerInventoryEffects(workOrderId, newState) {
    const trigger = STATE_TRIGGERS[newState];
    if (!trigger)
        return;
    if (await isStateProcessed(workOrderId, newState))
        return;
    try {
        await trigger(workOrderId);
        await markStateProcessed(workOrderId, newState);
    }
    catch (err) {
        await recordFailure(workOrderId, newState, err);
    }
}
//# sourceMappingURL=inventoryService.js.map