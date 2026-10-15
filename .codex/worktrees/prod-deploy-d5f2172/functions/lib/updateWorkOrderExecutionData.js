"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateWorkOrderExecutionData = void 0;
// Epic 6 Phase 6.3 -- Field Execution Capture. A deliberately narrow,
// separate callable from transitionWorkOrder() -- never touches
// status, assignedTechId, or any of transitionEngine.ts's lifecycle
// timestamp fields. This is the ONLY write path for qtyUsed/
// executionLog/lastUpdated; firestore.rules denies all direct client
// writes to fieldops_wos unconditionally (see that file's comment --
// "no future path for an admin UI to grow a direct-write shortcut
// around the Cloud Functions"), so this had to be a Cloud Function,
// not a client-side write, exactly like createWorkOrder/
// transitionWorkOrder already are.
//
// Same structural pattern as transitionWorkOrder.ts: onCall + HttpsError
// + getCallerContext + a single runTransaction doing read-verify-write.
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const callerContext_1 = require("./callerContext");
const collections_1 = require("./constants/collections");
function assertValidInput(data) {
    const input = data;
    if (!input || typeof input !== "object") {
        throw new https_1.HttpsError("invalid-argument", "Request data must be an object.");
    }
    if (!input.workOrderId) {
        throw new https_1.HttpsError("invalid-argument", "workOrderId is required.");
    }
    const hasQtyUpdates = Array.isArray(input.qtyUsedUpdates) && input.qtyUsedUpdates.length > 0;
    const hasNote = typeof input.executionNote === "string" && input.executionNote.trim().length > 0;
    if (!hasQtyUpdates && !hasNote) {
        throw new https_1.HttpsError("invalid-argument", "At least one of qtyUsedUpdates or executionNote is required.");
    }
    if (hasQtyUpdates) {
        for (const item of input.qtyUsedUpdates) {
            const entry = item;
            if (!entry || typeof entry.sku !== "string" || typeof entry.delta !== "number") {
                throw new https_1.HttpsError("invalid-argument", "Each qtyUsedUpdates entry requires { sku: string, delta: number }.");
            }
        }
    }
}
exports.updateWorkOrderExecutionData = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    }
    assertValidInput(request.data);
    const { workOrderId, qtyUsedUpdates, executionNote } = request.data;
    // Rule 2: role must be exactly "technician" -- admin/dispatcher are
    // rejected too, not just anonymous/unauthenticated callers. Rule 3:
    // technicianId must be resolvable (PT-001's mapping).
    const caller = await (0, callerContext_1.getCallerContext)(request.auth.uid);
    if (caller.role !== "technician") {
        throw new https_1.HttpsError("permission-denied", "Only technicians may record execution data.");
    }
    if (!caller.technicianId) {
        throw new https_1.HttpsError("failed-precondition", "This account has no technicianId mapping yet (see PT-001's assignTechnicianToUser.js).");
    }
    const db = (0, firestore_1.getFirestore)();
    const woRef = db.collection(collections_1.WORK_ORDERS_COLLECTION).doc(workOrderId);
    const updatedFields = await db.runTransaction(async (tx) => {
        const snap = await tx.get(woRef);
        if (!snap.exists) {
            throw new https_1.HttpsError("not-found", `No Work Order with id ${workOrderId}`);
        }
        const wo = snap.data();
        // Rule 4: ownership -- assignedTechId must match the caller's own
        // technicianId. Never assignedTechId itself; only ever compared,
        // never written by this function.
        if (wo.assignedTechId !== caller.technicianId) {
            throw new https_1.HttpsError("permission-denied", "This Work Order is not assigned to you.");
        }
        const fields = [];
        const payload = { lastUpdated: firestore_1.FieldValue.serverTimestamp() };
        fields.push("lastUpdated");
        // qtyUsed lives per-item inside inventorySnapshot[], not as a
        // top-level scalar field -- Firestore has no "update array element
        // matching a key" primitive, so this reads the whole array,
        // replaces only the matching sku's qtyUsed (additive delta, floored
        // at 0), and writes the whole array back -- still only touching
        // the inventorySnapshot field, nothing else on the document. Doing
        // this inside the same transaction as the ownership check above
        // is what makes it concurrency-safe (Step 6): a second concurrent
        // call re-reads the post-first-write array, never clobbers it.
        if (qtyUsedUpdates && qtyUsedUpdates.length > 0) {
            const snapshot = wo.inventorySnapshot ? [...wo.inventorySnapshot] : [];
            for (const { sku, delta } of qtyUsedUpdates) {
                const index = snapshot.findIndex((item) => item.sku === sku);
                if (index === -1) {
                    throw new https_1.HttpsError("invalid-argument", `No planned part with sku "${sku}" on this Work Order.`);
                }
                const current = snapshot[index].qtyUsed ?? 0;
                snapshot[index] = { ...snapshot[index], qtyUsed: Math.max(0, current + delta) };
            }
            payload.inventorySnapshot = snapshot;
            fields.push("inventorySnapshot");
        }
        // executionLog is append-only via arrayUnion -- chosen over a
        // single overwritable executionNotes string specifically because
        // it's safe for concurrent edits (Step 6) with no read-modify-write
        // needed at all (arrayUnion is its own atomic merge). `at` uses
        // Timestamp.now(), not FieldValue.serverTimestamp() -- Firestore
        // does not support serverTimestamp() sentinels nested inside
        // arrayUnion() elements. Still server-computed (Admin SDK), not
        // client-supplied.
        if (executionNote && executionNote.trim().length > 0) {
            payload.executionLog = firestore_1.FieldValue.arrayUnion({
                note: executionNote.trim(),
                at: firestore_1.Timestamp.now(),
                byTechnicianId: caller.technicianId,
            });
            fields.push("executionLog");
        }
        tx.update(woRef, payload);
        return fields;
    });
    const result = { success: true, workOrderId, updatedFields };
    return result;
});
//# sourceMappingURL=updateWorkOrderExecutionData.js.map