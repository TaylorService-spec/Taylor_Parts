"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getWarehouseStock = getWarehouseStock;
exports.updateStockLocation = updateStockLocation;
exports.createTransferOrder = createTransferOrder;
exports.completeTransferOrder = completeTransferOrder;
// Epic 4 Warehouse + Fulfillment System.
//
// Physical stock-location state management: bin-level quantities and
// transfer orders between warehouses. This file NEVER writes
// inventory_transactions and NEVER touches fieldops_wos -- moving
// physical stock between bins/warehouses has no bearing on the
// ledger's RESERVED/RELEASED/CONSUMED accounting, and vice versa. See
// docs/CLAUDE_CONTEXT.md's Epic 4 section for the full boundary.
const firestore_1 = require("firebase-admin/firestore");
const collections_1 = require("./constants/collections");
const db = () => (0, firestore_1.getFirestore)();
// Deterministic doc id from the composite key -- makes
// updateStockLocation's read-modify-write a single-doc transaction
// instead of a query, and gives callers a stable id to re-derive
// without needing to look one up first.
function stockLocationDocId(warehouseId, partId, binCode) {
    return `${warehouseId}__${partId}__${binCode}`;
}
async function getWarehouseStock(warehouseId) {
    const snap = await db()
        .collection(collections_1.STOCK_LOCATIONS_COLLECTION)
        .where("warehouseId", "==", warehouseId)
        .get();
    return snap.docs.map((doc) => doc.data());
}
async function applyStockDelta(tx, warehouseId, partId, binCode, deltaQuantity) {
    const ref = db().collection(collections_1.STOCK_LOCATIONS_COLLECTION).doc(stockLocationDocId(warehouseId, partId, binCode));
    const snap = await tx.get(ref);
    const current = snap.exists ? snap.data().quantity : 0;
    if (current + deltaQuantity < 0) {
        throw new Error(`Insufficient stock in ${warehouseId}/${partId}/${binCode}: requested ${Math.abs(deltaQuantity)}, available ${current}`);
    }
    const next = {
        id: ref.id,
        warehouseId,
        partId,
        binCode,
        quantity: current + deltaQuantity,
        updatedAt: firestore_1.FieldValue.serverTimestamp(),
    };
    tx.set(ref, next);
}
function stockRef(warehouseId, partId, binCode) {
    return db().collection(collections_1.STOCK_LOCATIONS_COLLECTION).doc(stockLocationDocId(warehouseId, partId, binCode));
}
function applyLoadedStockDelta(tx, ref, warehouseId, partId, binCode, current, delta) {
    if (current + delta < 0)
        throw new Error(`Insufficient stock in ${warehouseId}/${partId}/${binCode}: requested ${Math.abs(delta)}, available ${current}`);
    tx.set(ref, { id: ref.id, warehouseId, partId, binCode, quantity: current + delta, updatedAt: firestore_1.FieldValue.serverTimestamp() });
}
// Applies a delta to one bin's quantity, creating the StockLocation
// doc on first write. NOTE on idempotency: this primitive takes a
// relative delta with no idempotency key, so calling it twice with the
// same arguments applies the delta twice -- it cannot be idempotent on
// its own. Callers that need retry-safety (e.g. completeTransferOrder
// below) get it by guarding on the caller's own status inside a
// transaction, not by making this primitive idempotent.
async function updateStockLocation(warehouseId, partId, binCode, deltaQuantity) {
    await db().runTransaction((tx) => applyStockDelta(tx, warehouseId, partId, binCode, deltaQuantity));
}
async function createTransferOrder(input) {
    if (!Number.isFinite(input.quantity) || input.quantity <= 0)
        throw new Error("Transfer quantity must be positive");
    if (!input.fromWarehouseId || !input.toWarehouseId || !input.fromBinCode || !input.toBinCode)
        throw new Error("Transfer warehouse and bin are required");
    // A transfer whose source and destination resolve to the same stock
    // location doc (same warehouse AND same bin) is a no-op that must not
    // be accepted: completeTransferOrder would apply -qty then +qty to the
    // SAME doc in one transaction, the last write wins, and stock is
    // fabricated from nothing. Reject at creation rather than let it reach
    // completion.
    if (input.fromWarehouseId === input.toWarehouseId && input.fromBinCode === input.toBinCode) {
        throw new Error("Transfer source and destination must differ");
    }
    const ref = db().collection(collections_1.TRANSFER_ORDERS_COLLECTION).doc();
    const now = firestore_1.FieldValue.serverTimestamp();
    const order = {
        id: ref.id,
        partId: input.partId,
        quantity: input.quantity,
        fromWarehouseId: input.fromWarehouseId,
        toWarehouseId: input.toWarehouseId,
        fromBinCode: input.fromBinCode,
        toBinCode: input.toBinCode,
        status: "REQUESTED",
        createdAt: now,
        updatedAt: now,
    };
    await ref.set(order);
    return order;
}
// Idempotent: guards on the TransferOrder's own status inside the same
// transaction that applies the stock deltas, so a retried/duplicate
// call for an already-COMPLETED transfer is a no-op rather than a
// double-move.
async function completeTransferOrder(transferOrderId) {
    const ref = db().collection(collections_1.TRANSFER_ORDERS_COLLECTION).doc(transferOrderId);
    await db().runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists)
            throw new Error(`No TransferOrder with id ${transferOrderId}`);
        const order = snap.data();
        if (order.status === "COMPLETED")
            return;
        if (order.status === "CANCELLED")
            throw new Error(`TransferOrder ${transferOrderId} is CANCELLED, cannot complete`);
        // Both bins are explicit and persisted on the order. Never synthesize a
        // TRANSFER bin: completion moves physical units from the actual source
        // location to the actual destination location in this single transaction.
        const sourceRef = stockRef(order.fromWarehouseId, order.partId, order.fromBinCode);
        const destinationRef = stockRef(order.toWarehouseId, order.partId, order.toBinCode);
        const [sourceSnap, destinationSnap] = await Promise.all([tx.get(sourceRef), tx.get(destinationRef)]);
        applyLoadedStockDelta(tx, sourceRef, order.fromWarehouseId, order.partId, order.fromBinCode, sourceSnap.exists ? sourceSnap.data().quantity : 0, -order.quantity);
        applyLoadedStockDelta(tx, destinationRef, order.toWarehouseId, order.partId, order.toBinCode, destinationSnap.exists ? destinationSnap.data().quantity : 0, order.quantity);
        tx.set(ref, { status: "COMPLETED", updatedAt: firestore_1.FieldValue.serverTimestamp() }, { merge: true });
    });
}
//# sourceMappingURL=warehouseService.js.map