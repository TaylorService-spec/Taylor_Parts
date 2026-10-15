"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reorderRequestCounterDocId = reorderRequestCounterDocId;
exports.formatReorderRequestNumber = formatReorderRequestNumber;
exports.allocateReorderRequestNumber = allocateReorderRequestNumber;
const firestore_1 = require("firebase-admin/firestore");
const collections_js_1 = require("../constants/collections.js");
const businessNumber_js_1 = require("../numbering/businessNumber.js");
/** Counter doc id. Distinct from every other family's counter so no sequence ever interacts with another's. */
function reorderRequestCounterDocId(year) {
    return `reorder_requests_${year}`;
}
function counterRef(year) {
    return (0, firestore_1.getFirestore)().collection(collections_js_1.COUNTERS_COLLECTION).doc(reorderRequestCounterDocId(year));
}
/**
 * Pure formatter, exported separately so the format can be tested — and changed — without a Firestore
 * transaction anywhere near it.
 */
function formatReorderRequestNumber(year, sequence) {
    return `RR-${year}-${String(sequence).padStart(6, "0")}`;
}
/**
 * Allocate the next reference for `year`.
 *
 * Must be called with a transaction the caller already opened: this performs exactly one read and one
 * write against the counter doc, both inside that transaction, and commits nothing itself.
 */
async function allocateReorderRequestNumber(tx, year) {
    const allocated = await (0, businessNumber_js_1.allocateBusinessNumber)(tx, {
        counterRef: counterRef(year),
        format: (sequence) => formatReorderRequestNumber(year, sequence),
        counterFields: { year },
    });
    (0, businessNumber_js_1.applyPendingWrites)(tx, allocated.pendingWrites);
    return { reorderRequestNumber: allocated.number, sequence: allocated.sequence };
}
//# sourceMappingURL=reorderRequestNumbering.js.map