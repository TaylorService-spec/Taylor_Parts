"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GOVERNED_TECHNICIAN_STATUSES = exports.TECHNICIANS_COLLECTION = void 0;
exports.db = db;
exports.loadTechnician = loadTechnician;
exports.loadWorkingAvailability = loadWorkingAvailability;
exports.loadBlockedTime = loadBlockedTime;
// Dispatch & Scheduler -- transactional reads for the scheduling commands.
//
// Every read here takes the transaction, not the raw Firestore handle. That is the whole point of
// the file: a conflict check performed outside the transaction that later writes is a check against
// a snapshot nobody promised would still be true, and the double-booking guard this domain inherits
// (workOrderAvailability.ts) is only sound because its reads are inside the same transaction as its
// write. Keeping the reads here, all with the same signature, makes it hard to accidentally add one
// that is not.
const firestore_1 = require("firebase-admin/firestore");
const types_1 = require("./types");
exports.TECHNICIANS_COLLECTION = "fieldops_technicians";
// Mirrors field-ops-app-vite/src/domain/constants.js's TECH_STATUS. A technician record carrying
// anything else is malformed, and malformed is not schedulable -- see loadTechnician below.
exports.GOVERNED_TECHNICIAN_STATUSES = new Set(["available", "on_job", "off_shift"]);
function db() {
    return (0, firestore_1.getFirestore)();
}
async function loadTechnician(tx, technicianId) {
    const snap = await tx.get(db().collection(exports.TECHNICIANS_COLLECTION).doc(technicianId));
    if (!snap.exists)
        return null;
    const data = snap.data() ?? {};
    return { id: snap.id, status: typeof data.status === "string" ? data.status : "" };
}
/**
 * A technician's recurring working schedule, or null when none is recorded.
 *
 * Null means UNRECORDED. Callers must not read it as "no working hours" -- see the contract on
 * TechnicianWorkingAvailability and assessWorkingHours(), which turns this into a warning rather
 * than a refusal for exactly that reason.
 */
async function loadWorkingAvailability(tx, technicianId) {
    const snap = await tx.get(db().collection(types_1.TECHNICIAN_WORKING_AVAILABILITY_COLLECTION).doc(technicianId));
    if (!snap.exists)
        return null;
    return snap.data();
}
/**
 * Blocked-time records that could overlap [startMillis, endMillis).
 *
 * Firestore permits a range filter on ONE field per query, so this narrows on `endMillis > start`
 * server-side and completes the half-open overlap test in memory. Narrowing on the other end instead
 * would drop a long block that began before the window and is still running -- the exact record most
 * worth catching. Needs the composite index (technicianId ASC, endMillis ASC) declared in
 * firestore.indexes.json.
 */
async function loadBlockedTime(tx, technicianId, startMillis) {
    const snap = await tx.get(db()
        .collection(types_1.TECHNICIAN_BLOCKED_TIME_COLLECTION)
        .where("technicianId", "==", technicianId)
        .where("endMillis", ">", startMillis));
    return snap.docs.map((d) => ({ ...d.data(), blockId: d.id }));
}
//# sourceMappingURL=schedulingRepository.js.map