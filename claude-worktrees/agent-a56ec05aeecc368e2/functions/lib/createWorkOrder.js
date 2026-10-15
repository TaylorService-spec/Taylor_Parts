"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createWorkOrder = void 0;
exports.createWorkOrderRecord = createWorkOrderRecord;
// Work Order Engine v1.2 -- createWorkOrder callable.
//
// Only admin/dispatcher may call this (see the Create row of the
// permissions matrix, functions/src/transitionEngine.ts's
// ACTION_PERMISSIONS). This is the first of exactly two ways
// fieldops_wos is ever written -- firestore.rules denies all direct
// client writes to that collection unconditionally.
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const callerContext_1 = require("./callerContext");
const woNumbering_1 = require("./woNumbering");
const auditEventWriter_1 = require("./access/auditEventWriter");
const workOrderCreateMath_1 = require("./workOrderCreateMath");
const collections_1 = require("./constants/collections");
// The governed Work Order creation CORE, factored out so the callable AND other trusted server commands (e.g.
// the Sales Order → Service seam) create Work Orders through the SAME authority instead of duplicating it.
// `salesOrderId` is an optional DEMAND-LINEAGE link: a Work Order created to fulfill a Sales Order carries it
// so the same underlying parts demand is never double-counted (ATP counts SO-origin demand via the Sales
// Order allocation, not again via this Work Order's reservation). Must be called inside a transaction.
async function createWorkOrderRecord(db, tx, 
// `type` is optional here (a Work Order is valid with EITHER a type OR a complaint — see assertValidInput);
// callers that omit both must supply a complaint. `salesOrderId`/`salesOrderLineRefs` are the demand-lineage link.
input, nowYear) {
    const { woNumber } = await (0, woNumbering_1.allocateWorkOrderNumber)(tx, nowYear);
    const woRef = db.collection(collections_1.WORK_ORDERS_COLLECTION).doc();
    tx.set(woRef, {
        woNumber,
        status: "CREATED",
        priority: input.priority,
        ...(input.severity ? { severity: input.severity } : {}),
        ...(input.type ? { type: input.type } : {}),
        customerId: input.customerId,
        locationId: input.locationId,
        ...(input.complaint ? { complaint: input.complaint } : {}),
        ...(input.salesOrderId ? { salesOrderId: input.salesOrderId } : {}),
        ...(Array.isArray(input.salesOrderLineRefs) && input.salesOrderLineRefs.length ? { salesOrderLineRefs: input.salesOrderLineRefs } : {}),
        createdAt: firestore_1.FieldValue.serverTimestamp(),
        updatedAt: firestore_1.FieldValue.serverTimestamp(),
    });
    return { id: woRef.id, woNumber };
}
function assertValidInput(data) {
    const input = data;
    if (!input || typeof input !== "object") {
        throw new https_1.HttpsError("invalid-argument", "Request data must be an object.");
    }
    if (!input.customerId) {
        throw new https_1.HttpsError("invalid-argument", "customerId is required.");
    }
    if (!input.locationId) {
        throw new https_1.HttpsError("invalid-argument", "locationId is required.");
    }
    if (![1, 2, 3, 4].includes(input.priority)) {
        throw new https_1.HttpsError("invalid-argument", "priority is required and must be 1-4.");
    }
    if (!input.type && !input.complaint) {
        throw new https_1.HttpsError("invalid-argument", "Either complaint or type (service classification) is required.");
    }
    if (input.idempotencyKey !== undefined) {
        if (typeof input.idempotencyKey !== "string" || input.idempotencyKey.trim().length === 0) {
            throw new https_1.HttpsError("invalid-argument", "idempotencyKey, when provided, must be a non-empty string.");
        }
    }
}
exports.createWorkOrder = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    }
    const caller = await (0, callerContext_1.getCallerContext)(request.auth.uid);
    if (caller.role !== "admin" && caller.role !== "dispatcher") {
        throw new https_1.HttpsError("permission-denied", "Only admin/dispatcher may create Work Orders.");
    }
    assertValidInput(request.data);
    const { customerId, locationId, priority, severity, type, complaint, idempotencyKey } = request.data;
    const actorUid = request.auth.uid;
    const aid = idempotencyKey ? (0, workOrderCreateMath_1.createWorkOrderAuditId)(actorUid, `${customerId}|${locationId}`, idempotencyKey) : null;
    const db = (0, firestore_1.getFirestore)();
    const year = new Date().getFullYear();
    return db.runTransaction(async (tx) => {
        // Idempotency / replay: read the deterministic marker up front (before any write). If a prior create with
        // this key already applied, return the SAME Work Order -- never mint a second one or burn a WO number.
        if (aid) {
            const prior = await tx.get((0, auditEventWriter_1.auditEventDocRef)(aid));
            if (prior.exists) {
                const targetId = prior.data()?.targetId ?? "";
                const woSnap = targetId ? await tx.get(db.collection(collections_1.WORK_ORDERS_COLLECTION).doc(targetId)) : null;
                return { id: targetId, woNumber: woSnap?.data()?.woNumber ?? null, replayed: true };
            }
        }
        const created = await createWorkOrderRecord(db, tx, { customerId, locationId, priority, severity, type, complaint }, year);
        // Stage the marker in the SAME transaction so the WO and its idempotency record commit atomically.
        if (aid) {
            (0, auditEventWriter_1.stageAuditEventWithId)(tx, aid, {
                actorUid,
                action: "createWorkOrder",
                targetType: "workOrder",
                targetId: created.id,
                outcome: "applied",
                summary: `created work order ${created.woNumber}`,
            });
        }
        return { ...created, replayed: false };
    });
});
//# sourceMappingURL=createWorkOrder.js.map