"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.opportunityCounterDocId = opportunityCounterDocId;
exports.formatOpportunityNumber = formatOpportunityNumber;
exports.allocateOpportunityNumber = allocateOpportunityNumber;
const firestore_1 = require("firebase-admin/firestore");
const collections_1 = require("../constants/collections");
/** Counter doc id. Distinct from work_orders_YYYY so the two sequences never interact. */
function opportunityCounterDocId(year) {
    return `opportunities_${year}`;
}
function counterRef(year) {
    return (0, firestore_1.getFirestore)().collection(collections_1.COUNTERS_COLLECTION).doc(opportunityCounterDocId(year));
}
/**
 * Pure formatter, exported separately so the format can be tested — and changed —
 * without a Firestore transaction anywhere near it.
 */
function formatOpportunityNumber(year, sequence) {
    return `OPP-${year}-${String(sequence).padStart(6, "0")}`;
}
/**
 * Allocate the next reference for `year`.
 *
 * Must be called with a transaction the caller already opened: this performs exactly
 * one read and one write against the counter doc, both inside that transaction, and
 * commits nothing itself.
 */
async function allocateOpportunityNumber(tx, year) {
    const ref = counterRef(year);
    const snap = await tx.get(ref);
    const sequence = snap.exists ? snap.data().sequence + 1 : 1;
    tx.set(ref, {
        year,
        sequence,
        updatedAt: firestore_1.FieldValue.serverTimestamp(),
    });
    return { opportunityNumber: formatOpportunityNumber(year, sequence), sequence };
}
//# sourceMappingURL=opportunityNumbering.js.map