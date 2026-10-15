"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.salesOrderCounterDocId = salesOrderCounterDocId;
exports.formatSalesOrderNumber = formatSalesOrderNumber;
exports.allocateSalesOrderNumber = allocateSalesOrderNumber;
const firestore_1 = require("firebase-admin/firestore");
const collections_1 = require("../constants/collections");
const businessNumber_1 = require("../numbering/businessNumber");
/** Counter doc id. Distinct from opportunities_YYYY / work_orders_YYYY so the sequences never interact. */
function salesOrderCounterDocId(year) {
    return `sales_orders_${year}`;
}
function counterRef(year) {
    return (0, firestore_1.getFirestore)().collection(collections_1.COUNTERS_COLLECTION).doc(salesOrderCounterDocId(year));
}
/**
 * Pure formatter, exported separately so the format can be tested — and changed —
 * without a Firestore transaction anywhere near it.
 */
function formatSalesOrderNumber(year, sequence) {
    return `SO-${year}-${String(sequence).padStart(6, "0")}`;
}
/**
 * Allocate the next reference for `year`.
 *
 * Must be called with a transaction the caller already opened: this performs exactly
 * one read and one write against the counter doc, both inside that transaction, and
 * commits nothing itself.
 */
async function allocateSalesOrderNumber(tx, year) {
    const allocated = await (0, businessNumber_1.allocateBusinessNumber)(tx, {
        counterRef: counterRef(year),
        format: (sequence) => formatSalesOrderNumber(year, sequence),
        counterFields: { year },
    });
    (0, businessNumber_1.applyPendingWrites)(tx, allocated.pendingWrites);
    return { salesOrderNumber: allocated.number, sequence: allocated.sequence };
}
//# sourceMappingURL=salesOrderNumbering.js.map