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
const auditEventWriter_1 = require("./access/auditEventWriter");
const workOrderExecutionMath_1 = require("./workOrderExecutionMath");
const transitionEngine_1 = require("./transitionEngine");
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
            if (!Number.isFinite(entry.delta)) {
                throw new https_1.HttpsError("invalid-argument", "Each qtyUsedUpdates entry's delta must be a finite number (NaN/Infinity are rejected).");
            }
        }
    }
    // idempotencyKey is optional (deploy-safe), but when present it must be a usable non-empty string --
    // an empty/whitespace key would collapse every distinct call to the same marker.
    if (input.idempotencyKey !== undefined) {
        if (typeof input.idempotencyKey !== "string" || input.idempotencyKey.trim().length === 0) {
            throw new https_1.HttpsError("invalid-argument", "idempotencyKey, when provided, must be a non-empty string.");
        }
    }
}
exports.updateWorkOrderExecutionData = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    }
    assertValidInput(request.data);
    const { workOrderId, qtyUsedUpdates, executionNote, idempotencyKey } = request.data;
    const actorUid = request.auth.uid;
    const aid = idempotencyKey ? (0, workOrderExecutionMath_1.executionDataAuditId)(actorUid, workOrderId, idempotencyKey) : null;
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
    const outcome = await db.runTransaction(async (tx) => {
        // Firestore requires all reads before any write. Read the WO and (when an idempotency key was supplied)
        // the deterministic Audit Event marker up front.
        const snap = await tx.get(woRef);
        // Idempotency / replay: a prior Audit Event at this id means this exact update already applied. Return a
        // no-op replay -- never re-apply the additive qtyUsed delta or re-append the execution-log entry.
        if (aid) {
            const prior = await tx.get((0, auditEventWriter_1.auditEventDocRef)(aid));
            if (prior.exists) {
                return { replayed: true, fields: [] };
            }
        }
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
        // Completed, closed, and cancelled records are final. The assignment remains on the document after a
        // transition, so ownership alone must not keep this mutable execution-write path open indefinitely.
        if (transitionEngine_1.TERMINAL_STATUSES.has(wo.status)) {
            throw new https_1.HttpsError("failed-precondition", "Execution data cannot be changed on a terminal Work Order.");
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
            const base = wo.inventorySnapshot ? wo.inventorySnapshot : [];
            const merged = (0, workOrderExecutionMath_1.mergeQtyUsed)(base, qtyUsedUpdates);
            if (!merged.ok) {
                throw new https_1.HttpsError("invalid-argument", `No planned part with sku "${merged.unknownSku}" on this Work Order.`);
            }
            payload.inventorySnapshot = merged.snapshot;
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
        // Stage the deterministic Audit Event marker IN THE SAME transaction so the update and its idempotency
        // record commit atomically -- the marker's existence is what makes a later retry a no-op replay. Only when
        // a key was supplied (deploy-safe: keyless legacy calls still apply, just without replay protection).
        if (aid) {
            (0, auditEventWriter_1.stageAuditEventWithId)(tx, aid, {
                actorUid,
                action: "updateWorkOrderExecutionData",
                targetType: "workOrder",
                targetId: workOrderId,
                outcome: "applied",
                summary: `execution-data update applied (${fields.join(", ")})`,
            });
        }
        return { replayed: false, fields };
    });
    const result = {
        success: true,
        workOrderId,
        updatedFields: outcome.fields,
        ...(outcome.replayed ? { replayed: true } : {}),
    };
    return result;
});
//# sourceMappingURL=updateWorkOrderExecutionData.js.map