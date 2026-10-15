"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.transitionWorkOrder = void 0;
// Work Order Engine v1.2 -- transitionWorkOrder callable.
//
// Input is { workOrderId, action } -- action-based, never a raw target
// status -- so a client can never smuggle an arbitrary transition by
// naming a status directly; the server alone resolves action -> status
// via transitionEngine.ts's ACTION_TO_STATUS.
//
// Epic 2D (see docs/architecture/ADR-003): after the transaction below
// commits successfully, triggerInventoryEffects() runs as a strictly
// post-commit side effect -- it never runs inside the transaction,
// never blocks or delays the response beyond its own execution, and a
// failure inside it is caught and logged (inventoryService.ts's own
// job) rather than ever surfacing as a transitionWorkOrder failure.
// The Work Order transition itself has already succeeded by the time
// this runs; nothing about the state machine changes here.
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const callerContext_1 = require("./callerContext");
const transitionEngine_1 = require("./transitionEngine");
const collections_1 = require("./constants/collections");
const inventoryService_1 = require("./inventoryService");
const workOrderAvailability_1 = require("./workOrderAvailability");
// Same-technician concurrency guard (site-work r3 item M). The Schedule/Dispatch branches below read the
// technician's OTHER Work Orders inside this transaction, then write only THIS Work Order doc -- Firestore only
// conflict-detects on documents actually in a transaction's read/write set, so two concurrent transitions that
// target two DIFFERENT Work Order docs for the SAME technician each see a pre-commit snapshot with no conflict
// and both can commit, bypassing the double-booking/overlap guard entirely. A per-technician sentinel document,
// deliberately read AND written inside the same transaction (mirrors inventoryService.ts's
// reservationLockRef/RESERVATION_LOCKS_COLLECTION pattern), forces write-write contention: a second concurrent
// transition for the same technician now collides on this doc and Firestore retries it, so it re-reads the
// first transition's already-committed result instead of a stale snapshot. The doc carries no scheduling data
// and is never read for availability -- it exists purely to serialize same-technician transitions.
const TECH_LOCKS_COLLECTION = "work_order_tech_locks";
const techLockRef = (db, technicianId) => db.collection(TECH_LOCKS_COLLECTION).doc(technicianId);
function assertValidInput(data) {
    const input = data;
    if (!input || typeof input !== "object") {
        throw new https_1.HttpsError("invalid-argument", "Request data must be an object.");
    }
    if (!input.workOrderId) {
        throw new https_1.HttpsError("invalid-argument", "workOrderId is required.");
    }
    if (!input.action || !(input.action in transitionEngine_1.ACTION_TO_STATUS)) {
        throw new https_1.HttpsError("invalid-argument", `Unknown action: ${String(input.action)}`);
    }
    if (input.action === "Schedule") {
        if (!input.scheduledStart || !input.scheduledEnd || !input.scheduledTechId) {
            throw new https_1.HttpsError("invalid-argument", "Schedule requires scheduledStart, scheduledEnd, and scheduledTechId.");
        }
        if (input.scheduledEnd <= input.scheduledStart) {
            throw new https_1.HttpsError("invalid-argument", "scheduledEnd must be after scheduledStart.");
        }
    }
    if (input.action === "Dispatch" && !input.assignedTechId) {
        throw new https_1.HttpsError("invalid-argument", "Dispatch requires assignedTechId.");
    }
}
exports.transitionWorkOrder = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    }
    assertValidInput(request.data);
    const { workOrderId, action, scheduledStart, scheduledEnd, scheduledTechId, assignedTechId } = request.data;
    const caller = await (0, callerContext_1.getCallerContext)(request.auth.uid);
    const db = (0, firestore_1.getFirestore)();
    const woRef = db.collection(collections_1.WORK_ORDERS_COLLECTION).doc(workOrderId);
    const result = await db.runTransaction(async (tx) => {
        const snap = await tx.get(woRef);
        if (!snap.exists) {
            throw new https_1.HttpsError("not-found", `No Work Order with id ${workOrderId}`);
        }
        const wo = snap.data();
        const nextStatus = transitionEngine_1.ACTION_TO_STATUS[action];
        if (!(0, transitionEngine_1.canTransition)(wo.status, nextStatus)) {
            throw new https_1.HttpsError("failed-precondition", `Invalid transition: ${wo.status} -> ${nextStatus} (action ${action})`);
        }
        const isOwnAssignment = caller.role === "technician" && !!wo.assignedTechId && wo.assignedTechId === caller.technicianId;
        const allowed = (0, transitionEngine_1.getAllowedActions)(wo.status, caller.role, isOwnAssignment);
        if (!allowed.includes(action)) {
            throw new https_1.HttpsError("permission-denied", `Role "${caller.role}" may not perform action "${action}" on this Work Order.`);
        }
        const payload = {
            status: nextStatus,
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        };
        // See this file's header comment on TECH_LOCKS_COLLECTION: read the same-technician sentinel doc up front
        // (Firestore requires all reads before any write in a transaction) for Schedule/Dispatch so the write below
        // puts it in this transaction's write set too, forcing contention with any other concurrent transition for
        // this same technician.
        let lockRef = null;
        if (action === "Schedule") {
            lockRef = techLockRef(db, scheduledTechId);
            await tx.get(lockRef);
        }
        else if (action === "Dispatch") {
            lockRef = techLockRef(db, assignedTechId);
            await tx.get(lockRef);
        }
        if (action === "Schedule") {
            const otherSnap = await tx.get(db.collection(collections_1.WORK_ORDERS_COLLECTION).where("scheduledTechId", "==", scheduledTechId));
            const others = otherSnap.docs.map((d) => {
                const data = d.data();
                return { id: d.id, scheduledTechId: data.scheduledTechId, scheduledStart: data.scheduledStart, scheduledEnd: data.scheduledEnd, status: data.status };
            });
            const conflict = (0, workOrderAvailability_1.findScheduleConflict)(scheduledTechId, workOrderId, scheduledStart, scheduledEnd, others);
            if (conflict)
                throw new https_1.HttpsError("failed-precondition", `Technician ${scheduledTechId} is already scheduled for overlapping Work Order ${conflict}.`);
            payload.scheduledStart = firestore_1.Timestamp.fromMillis(scheduledStart);
            payload.scheduledEnd = firestore_1.Timestamp.fromMillis(scheduledEnd);
            payload.scheduledTechId = scheduledTechId;
        }
        else if (action === "Dispatch") {
            // Double-booking guard: a technician actively assigned to another Work Order cannot be dispatched to this
            // one. Read (inside the transaction, before the write) the technician's other Work Orders and reject if any
            // is in an occupying status. This closes the availability gap the legacy dispatch path enforced.
            const otherSnap = await tx.get(db.collection(collections_1.WORK_ORDERS_COLLECTION).where("assignedTechId", "==", assignedTechId));
            const others = otherSnap.docs.map((d) => {
                const data = d.data();
                return { id: d.id, assignedTechId: data.assignedTechId, status: data.status };
            });
            const conflict = (0, workOrderAvailability_1.findDoubleBookingConflict)(assignedTechId, workOrderId, others);
            if (conflict) {
                throw new https_1.HttpsError("failed-precondition", `Technician ${assignedTechId} is already assigned to active Work Order ${conflict}; cannot double-book.`);
            }
            payload.assignedTechId = assignedTechId;
            payload.dispatchedAt = firestore_1.FieldValue.serverTimestamp();
        }
        else {
            const timestampField = transitionEngine_1.ACTION_TIMESTAMP_FIELD[action];
            if (timestampField) {
                payload[timestampField] = firestore_1.FieldValue.serverTimestamp();
            }
        }
        if (lockRef) {
            tx.set(lockRef, { technicianId: lockRef.id, touchedAt: firestore_1.FieldValue.serverTimestamp() }, { merge: true });
        }
        tx.update(woRef, payload);
        return { id: workOrderId, status: nextStatus };
    });
    // Post-commit only -- see header comment. Never throws: a failure
    // here is inventoryService.ts's own concern (logged in
    // inventory_sync_status for later retry), not this callable's.
    await (0, inventoryService_1.triggerInventoryEffects)(result.id, result.status);
    return result;
});
//# sourceMappingURL=transitionWorkOrder.js.map