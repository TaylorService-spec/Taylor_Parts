"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.salesAgreementCounterDocId = salesAgreementCounterDocId;
exports.formatSalesAgreementNumber = formatSalesAgreementNumber;
exports.allocateSalesAgreementNumber = allocateSalesAgreementNumber;
const firestore_1 = require("firebase-admin/firestore");
const collections_1 = require("../constants/collections");
/** Counter doc id. Distinct from sales_orders_YYYY / opportunities_YYYY so the sequences never interact. */
function salesAgreementCounterDocId(year) {
    return `sales_agreements_${year}`;
}
function counterRef(year) {
    return (0, firestore_1.getFirestore)().collection(collections_1.COUNTERS_COLLECTION).doc(salesAgreementCounterDocId(year));
}
/**
 * Pure formatter, exported separately so the format can be tested — and changed — without a
 * Firestore transaction anywhere near it.
 */
function formatSalesAgreementNumber(year, sequence) {
    return `SA-${year}-${String(sequence).padStart(6, "0")}`;
}
/**
 * Allocate the next reference for `year`.
 *
 * Must be called with a transaction the caller already opened: this performs exactly one read and
 * one write against the counter doc, both inside that transaction, and commits nothing itself.
 */
async function allocateSalesAgreementNumber(tx, year) {
    const ref = counterRef(year);
    const snap = await tx.get(ref);
    const sequence = snap.exists ? snap.data().sequence + 1 : 1;
    tx.set(ref, {
        year,
        sequence,
        updatedAt: firestore_1.FieldValue.serverTimestamp(),
    });
    return { salesAgreementNumber: formatSalesAgreementNumber(year, sequence), sequence };
}
//# sourceMappingURL=salesAgreementNumbering.js.map