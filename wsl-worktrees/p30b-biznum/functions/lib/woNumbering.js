"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.workOrderCounterDocId = workOrderCounterDocId;
exports.formatWorkOrderNumber = formatWorkOrderNumber;
exports.allocateWorkOrderNumber = allocateWorkOrderNumber;
const firestore_1 = require("firebase-admin/firestore");
const collections_1 = require("./constants/collections");
const businessNumber_1 = require("./numbering/businessNumber");
/** Counter doc id. Distinct from every other family's so no sequence ever interacts with another's. */
function workOrderCounterDocId(year) {
    return `work_orders_${year}`;
}
function counterRef(year) {
    return (0, firestore_1.getFirestore)().collection(collections_1.COUNTERS_COLLECTION).doc(workOrderCounterDocId(year));
}
/**
 * Pure formatter, exported separately so the format can be tested -- and the backfill tool can reuse
 * the ONE format authority -- without a Firestore transaction anywhere near it. The shape
 * `WO-YYYY-######` is what operators read, speak and file by; it must not change.
 */
function formatWorkOrderNumber(year, sequence) {
    return `WO-${year}-${String(sequence).padStart(6, "0")}`;
}
// Must be called with a transaction the caller already opened -- this
// function performs exactly one read and one write against the counter
// doc, both inside that transaction, and does not commit anything
// itself.
async function allocateWorkOrderNumber(tx, year) {
    const allocated = await (0, businessNumber_1.allocateBusinessNumber)(tx, {
        counterRef: counterRef(year),
        format: (sequence) => formatWorkOrderNumber(year, sequence),
        counterFields: { year },
    });
    (0, businessNumber_1.applyPendingWrites)(tx, allocated.pendingWrites);
    return { woNumber: allocated.number, sequence: allocated.sequence };
}
//# sourceMappingURL=woNumbering.js.map