"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPurchaseOrder = createPurchaseOrder;
exports.updatePurchaseOrderStatus = updatePurchaseOrderStatus;
// Epic 5 Procurement + Supplier Management System -- purchase order
// state management.
//
// Cloud-Function-only writes, same posture as every other write-bearing
// collection in this codebase (Work Orders, ledger, warehouse) --
// firestore.rules denies all direct client access to purchase_orders.
//
// This file NEVER writes inventory_transactions or fieldops_wos, and
// never calls out to a real vendor -- creating/updating a PurchaseOrder
// here is purely internal bookkeeping. The RECEIVED status is a marker
// for a future integration point (Epic 4 stock increase on receipt) --
// not wired up in this epic, per the epic's own "future integration
// point" framing.
const firestore_1 = require("firebase-admin/firestore");
const collections_1 = require("./constants/collections");
const db = () => (0, firestore_1.getFirestore)();
// Only forward transitions are legal, matching the status table's
// listed meanings (DRAFT -> proposal, APPROVED -> human signed off,
// SENT -> marked sent, RECEIVED -> goods recorded, CANCELLED ->
// invalidated from any pre-RECEIVED state). RECEIVED/CANCELLED are
// terminal.
const VALID_TRANSITIONS = {
    DRAFT: ["APPROVED", "CANCELLED"],
    APPROVED: ["SENT", "CANCELLED"],
    SENT: ["RECEIVED", "CANCELLED"],
    RECEIVED: [],
    CANCELLED: [],
};
function sumLineItems(items) {
    return items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
}
// Always creates in DRAFT -- there is no path in this epic that creates
// a PurchaseOrder in any other status. Human approval (updatePurchaseOrderStatus
// to APPROVED) is a separate, later, explicit call.
async function createPurchaseOrder(input) {
    const ref = db().collection(collections_1.PURCHASE_ORDERS_COLLECTION).doc();
    const now = firestore_1.FieldValue.serverTimestamp();
    const order = {
        id: ref.id,
        supplierId: input.supplierId,
        status: "DRAFT",
        items: input.items,
        totalCost: sumLineItems(input.items),
        createdAt: now,
        updatedAt: now,
    };
    await ref.set(order);
    return order;
}
// Idempotent: re-requesting the PO's current status is a no-op (so a
// retried/duplicate call never re-applies anything or throws). A
// genuinely new status must be a legal forward transition from the
// current one -- see VALID_TRANSITIONS -- otherwise this throws rather
// than silently accepting an invalid lifecycle jump (e.g. DRAFT
// straight to RECEIVED).
async function updatePurchaseOrderStatus(purchaseOrderId, status) {
    const ref = db().collection(collections_1.PURCHASE_ORDERS_COLLECTION).doc(purchaseOrderId);
    await db().runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists)
            throw new Error(`No PurchaseOrder with id ${purchaseOrderId}`);
        const order = snap.data();
        if (order.status === status)
            return;
        const allowed = VALID_TRANSITIONS[order.status];
        if (!allowed.includes(status)) {
            throw new Error(`Illegal PurchaseOrder transition: ${order.status} -> ${status}`);
        }
        tx.set(ref, { status, updatedAt: firestore_1.FieldValue.serverTimestamp() }, { merge: true });
    });
}
//# sourceMappingURL=procurementService.js.map