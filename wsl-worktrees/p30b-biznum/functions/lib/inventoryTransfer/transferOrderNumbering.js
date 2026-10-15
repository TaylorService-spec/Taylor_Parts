"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.transferOrderCounterDocId = transferOrderCounterDocId;
exports.formatTransferOrderNumber = formatTransferOrderNumber;
exports.allocateTransferOrderNumber = allocateTransferOrderNumber;
const firestore_1 = require("firebase-admin/firestore");
const collections_js_1 = require("../constants/collections.js");
const businessNumber_js_1 = require("../numbering/businessNumber.js");
/** Counter doc id. Distinct from opportunities_YYYY / work_orders_YYYY / sales_orders_YYYY / receiving_orders_YYYY so no sequence ever interacts with another family's. */
function transferOrderCounterDocId(year) {
    return `transfer_orders_${year}`;
}
function counterRef(year) {
    return (0, firestore_1.getFirestore)().collection(collections_js_1.COUNTERS_COLLECTION).doc(transferOrderCounterDocId(year));
}
/**
 * Pure formatter, exported separately so the format can be tested — and changed — without a Firestore
 * transaction anywhere near it.
 */
function formatTransferOrderNumber(year, sequence) {
    return `TO-${year}-${String(sequence).padStart(6, "0")}`;
}
/**
 * Allocate the next reference for `year`.
 *
 * Must be called with a transaction the caller already opened: this performs exactly one read and one
 * write against the counter doc, both inside that transaction, and commits nothing itself.
 *
 * Callers must call this only AFTER every other read the surrounding transaction needs has already
 * happened — Firestore requires all reads before any writes in a transaction, and this function's own
 * `tx.set` is a real write. transferOrderCommand.ts's createTransferOrder calls this immediately before
 * staging the create (its last read — origin stock sufficiency — has already completed by that point).
 */
async function allocateTransferOrderNumber(tx, year) {
    const allocated = await (0, businessNumber_js_1.allocateBusinessNumber)(tx, {
        counterRef: counterRef(year),
        format: (sequence) => formatTransferOrderNumber(year, sequence),
        counterFields: { year },
    });
    (0, businessNumber_js_1.applyPendingWrites)(tx, allocated.pendingWrites);
    return { transferOrderNumber: allocated.number, sequence: allocated.sequence };
}
//# sourceMappingURL=transferOrderNumbering.js.map