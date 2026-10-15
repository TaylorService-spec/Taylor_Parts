"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InvoiceNumberingError = void 0;
exports.formatInvoiceNumber = formatInvoiceNumber;
exports.allocateInvoiceNumber = allocateInvoiceNumber;
const firestore_1 = require("firebase-admin/firestore");
const collections_1 = require("../constants/collections");
const businessNumber_1 = require("../numbering/businessNumber");
// One counter document per company (keyed inside the already-Admin-SDK-only `counters` collection). Distinct
// from the Work Order year-counters; the key namespace prevents collision.
function invoiceCounterRef(companyId) {
    return (0, firestore_1.getFirestore)().collection(collections_1.COUNTERS_COLLECTION).doc(`invoices_${companyId}`);
}
class InvoiceNumberingError extends Error {
    constructor(message) { super(message); this.name = "InvoiceNumberingError"; }
}
exports.InvoiceNumberingError = InvoiceNumberingError;
// Default human presentation. Deployment-specific prefix/width can be layered later WITHOUT changing the
// canonical sequence or the immutable doc identity.
function formatInvoiceNumber(sequence, { prefix = "INV-", width = 6 } = {}) {
    return `${prefix}${String(sequence).padStart(width, "0")}`;
}
// Must be called with a transaction the caller already opened: exactly one read + one write on the company's
// counter, inside that transaction; commits nothing itself. Concurrency-safe by Firestore transaction retry.
async function allocateInvoiceNumber(tx, companyId, opts = {}) {
    if (typeof companyId !== "string" || companyId.trim().length === 0) {
        throw new InvoiceNumberingError("companyId is required to allocate a per-company invoice number");
    }
    const allocated = await (0, businessNumber_1.allocateBusinessNumber)(tx, {
        counterRef: invoiceCounterRef(companyId),
        format: (sequence) => formatInvoiceNumber(sequence, opts),
        counterFields: { companyId },
    });
    (0, businessNumber_1.applyPendingWrites)(tx, allocated.pendingWrites);
    return { invoiceNumber: allocated.number, sequence: allocated.sequence };
}
//# sourceMappingURL=invoiceNumbering.js.map