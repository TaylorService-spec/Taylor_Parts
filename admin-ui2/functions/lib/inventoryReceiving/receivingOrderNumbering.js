"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.receivingOrderCounterDocId = receivingOrderCounterDocId;
exports.formatReceivingOrderNumber = formatReceivingOrderNumber;
exports.allocateReceivingOrderNumber = allocateReceivingOrderNumber;
const firestore_1 = require("firebase-admin/firestore");
const collections_js_1 = require("../constants/collections.js");
/** Counter doc id. Distinct from opportunities_YYYY / work_orders_YYYY / sales_orders_YYYY / transfer_orders_YYYY so no sequence ever interacts with another family's. */
function receivingOrderCounterDocId(year) {
    return `receiving_orders_${year}`;
}
function counterRef(year) {
    return (0, firestore_1.getFirestore)().collection(collections_js_1.COUNTERS_COLLECTION).doc(receivingOrderCounterDocId(year));
}
/**
 * Pure formatter, exported separately so the format can be tested — and changed — without a Firestore
 * transaction anywhere near it.
 */
function formatReceivingOrderNumber(year, sequence) {
    return `RO-${year}-${String(sequence).padStart(6, "0")}`;
}
/**
 * Read the counter for `year` and compute the next sequence, INSIDE the caller's transaction (one read,
 * no write). Returns the formatted reference and the counter document's pending write for the caller to
 * commit later in the SAME transaction (see the module header for why this command needs that split).
 *
 * The caller MUST push `counterWrite` onto its own write buffer and flush it before the transaction
 * commits — an allocated number whose counter write is dropped would be reissued on the next allocation
 * for the same year, defeating the whole "never reused" guarantee. receiveInventoryStockCommand.ts does
 * this immediately, as part of the same buffered-write flush as the Receiving Order document itself.
 */
async function allocateReceivingOrderNumber(tx, year) {
    const ref = counterRef(year);
    const snap = await tx.get(ref);
    const sequence = snap.exists ? snap.data().sequence + 1 : 1;
    return {
        receivingOrderNumber: formatReceivingOrderNumber(year, sequence),
        sequence,
        counterWrite: {
            ref,
            data: { year, sequence, updatedAt: firestore_1.FieldValue.serverTimestamp() },
        },
    };
}
//# sourceMappingURL=receivingOrderNumbering.js.map