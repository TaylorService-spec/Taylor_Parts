"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.allocateWorkOrderNumber = allocateWorkOrderNumber;
const firestore_1 = require("firebase-admin/firestore");
const collections_1 = require("./constants/collections");
function counterRef(year) {
    return (0, firestore_1.getFirestore)().collection(collections_1.COUNTERS_COLLECTION).doc(`work_orders_${year}`);
}
// Must be called with a transaction the caller already opened -- this
// function performs exactly one read and one write against the counter
// doc, both inside that transaction, and does not commit anything
// itself.
async function allocateWorkOrderNumber(tx, year) {
    const ref = counterRef(year);
    const snap = await tx.get(ref);
    const sequence = snap.exists ? snap.data().sequence + 1 : 1;
    tx.set(ref, {
        year,
        sequence,
        updatedAt: firestore_1.FieldValue.serverTimestamp(),
    });
    const woNumber = `WO-${year}-${String(sequence).padStart(6, "0")}`;
    return { woNumber, sequence };
}
//# sourceMappingURL=woNumbering.js.map