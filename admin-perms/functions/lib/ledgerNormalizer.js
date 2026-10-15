"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeLedgerTransaction = normalizeLedgerTransaction;
exports.normalizeLedgerTransactions = normalizeLedgerTransactions;
// Converts one raw Firestore ledger doc into the analytics engine's
// plain-number representation. This is the ONLY place a Firestore
// Timestamp is converted to epoch ms for analytics purposes --
// centralizing it here is what actually prevents future timestamp
// drift (a second, ad-hoc `.toMillis()` call somewhere else in the
// codebase, possibly handling the missing-timestamp case differently).
function normalizeLedgerTransaction(doc) {
    return {
        id: doc.id,
        workOrderId: doc.workOrderId,
        partId: doc.partId,
        type: doc.type,
        quantity: doc.quantity,
        timestamp: doc.timestamp?.toMillis?.() ?? 0,
    };
}
function normalizeLedgerTransactions(docs) {
    return docs.map(normalizeLedgerTransaction);
}
//# sourceMappingURL=ledgerNormalizer.js.map