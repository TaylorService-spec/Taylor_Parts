"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createServiceForSalesOrder = exports.SALES_ORDER_SERVICE_CAPABILITY = void 0;
// Sales Order → Service/Dispatch seam (Cycle 7). Creates governed Service demand for a committed Sales Order
// by producing a Work Order through the EXISTING governed Work Order authority (createWorkOrderRecord, ADR-009)
// — the Sales Order NEVER authors Work Order state, technician/truck assignment, or the dispatch schedule
// directly. Dispatch/Scheduling then pick the Work Order up through their own governed surfaces.
//
// DEMAND LINEAGE (Owner C7 invariant): the created Work Order carries `salesOrderId` (+ line refs). Its parts
// reservations are therefore counted via the Sales Order's allocation, not double-counted (allocateSalesOrder
// excludes SO-linked WO reservations). The Sales Order records the resulting workOrderIds so the trace is
// bidirectional: SO line → allocation → Work Order → reservation/consumption.
//
// Authorization = capability `salesOrder.service`, resolved fail-closed via the trusted effective-access feed;
// registered active:false ⇒ DENY for everyone until a separate Owner grant. EXPORT != DEPLOY, REGISTER != GRANT.
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const effectiveAccessFeed_1 = require("../access/effectiveAccessFeed");
const collections_1 = require("../constants/collections");
const createWorkOrder_1 = require("../createWorkOrder");
exports.SALES_ORDER_SERVICE_CAPABILITY = "salesOrder.service";
exports.createServiceForSalesOrder = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    let allowed = false;
    try {
        const { decisions } = await (0, effectiveAccessFeed_1.resolveEffectiveAccess)({ principalUid: request.auth.uid, permissionIds: [exports.SALES_ORDER_SERVICE_CAPABILITY] });
        allowed = decisions[exports.SALES_ORDER_SERVICE_CAPABILITY] === true;
    }
    catch {
        allowed = false;
    }
    if (!allowed)
        throw new https_1.HttpsError("permission-denied", "You are not authorized to create Service for Sales Orders.");
    const salesOrderId = request.data?.salesOrderId;
    if (typeof salesOrderId !== "string" || salesOrderId.trim().length === 0) {
        throw new https_1.HttpsError("invalid-argument", "salesOrderId is required.");
    }
    const db = (0, firestore_1.getFirestore)();
    const soRef = db.collection(collections_1.SALES_ORDERS_COLLECTION).doc(salesOrderId);
    const year = new Date().getFullYear();
    try {
        const result = await db.runTransaction(async (tx) => {
            const snap = await tx.get(soRef);
            if (!snap.exists)
                throw new https_1.HttpsError("not-found", `No Sales Order with id ${salesOrderId}`);
            const so = snap.data();
            if (so.state !== "CONFIRMED" && so.state !== "IN_FULFILLMENT") {
                throw new https_1.HttpsError("failed-precondition", `Sales Order is ${so.state}; only CONFIRMED/IN_FULFILLMENT can create Service.`);
            }
            if (!so.accountId)
                throw new https_1.HttpsError("failed-precondition", "Sales Order has no accountId (customer) to route Service to.");
            if (!so.locationId)
                throw new https_1.HttpsError("failed-precondition", "Sales Order has no delivery/service locationId; set one before creating Service.");
            // Idempotency: don't re-create Service if this SO already has a linked Work Order (C7 = one coordinated
            // Work Order per SO; C8 will assess per-equipment coordination).
            if (Array.isArray(so.serviceWorkOrderIds) && so.serviceWorkOrderIds.length > 0) {
                throw new https_1.HttpsError("failed-precondition", "Sales Order already has Service Work Order(s).");
            }
            const lineRefs = (Array.isArray(so.lines) ? so.lines : []).map((l) => l.ref);
            const wo = await (0, createWorkOrder_1.createWorkOrderRecord)(db, tx, {
                customerId: so.accountId,
                locationId: so.locationId,
                priority: 3,
                complaint: `Sales Order fulfillment ${salesOrderId}: deliver/install ordered items`,
                salesOrderId,
                salesOrderLineRefs: lineRefs,
            }, year);
            tx.update(soRef, {
                state: "IN_FULFILLMENT",
                serviceWorkOrderIds: firestore_1.FieldValue.arrayUnion(wo.id),
                updatedAt: firestore_1.FieldValue.serverTimestamp(),
            });
            return { workOrderId: wo.id, woNumber: wo.woNumber };
        });
        return { success: true, salesOrderId, ...result };
    }
    catch (err) {
        if (err instanceof https_1.HttpsError)
            throw err;
        throw new https_1.HttpsError("internal", "Create Service for Sales Order failed.");
    }
});
//# sourceMappingURL=createServiceForSalesOrder.js.map