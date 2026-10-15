"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordRefund = exports.FINANCE_REFUND_RECORD_CAPABILITY = void 0;
// Finance — governed REFUND callable (thin onCall over the pure core). Records an explicit refund (money
// returned after payment) and reverses the applied payment on the invoice — in one transaction:
//   • actor identity from request.auth.uid;
//   • authorization = capability `finance.refund.record`, fail-closed via the trusted effective-access feed;
//     registered active:false ⇒ hard DENY until a separate Owner grant;
//   • the transaction reads the invoice, writes the refund record (Admin SDK), updates the invoice's
//     transactionally-maintained AR projection (applied reduced, outstanding/state re-derived — the invoice's
//     issued facts are never rewritten), and stages an append-only AUDIT event;
//   • idempotent via a deterministic audit id.
// `refunds` is Admin-SDK-only (deny-all client Rules). EXPORT != DEPLOY, REGISTER != GRANT.
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const node_crypto_1 = require("node:crypto");
const effectiveAccessFeed_1 = require("../access/effectiveAccessFeed");
const collections_1 = require("../constants/collections");
const auditEventWriter_1 = require("../access/auditEventWriter");
const refundCommands_1 = require("./refundCommands");
exports.FINANCE_REFUND_RECORD_CAPABILITY = "finance.refund.record";
function mapCommandError(err) {
    if (err instanceof https_1.HttpsError)
        return err;
    if (err instanceof refundCommands_1.RefundCommandError) {
        switch (err.code) {
            case "INVOICE_VOID":
            case "EXCEEDS_APPLIED":
            case "CURRENCY_MISMATCH":
                return new https_1.HttpsError("failed-precondition", err.message);
            case "INVOICE_NOT_FOUND":
                return new https_1.HttpsError("not-found", err.message);
            default:
                return new https_1.HttpsError("invalid-argument", err.message);
        }
    }
    return new https_1.HttpsError("internal", "Refund failed.");
}
async function requireRefundRecord(uid) {
    let allowed = false;
    try {
        const { decisions } = await (0, effectiveAccessFeed_1.resolveEffectiveAccess)({ principalUid: uid, permissionIds: [exports.FINANCE_REFUND_RECORD_CAPABILITY] });
        allowed = decisions[exports.FINANCE_REFUND_RECORD_CAPABILITY] === true;
    }
    catch (err) {
        console.error(`[requireRefundRecord] capability resolution failed for ${exports.FINANCE_REFUND_RECORD_CAPABILITY}`, err);
        allowed = false;
    }
    if (!allowed)
        throw new https_1.HttpsError("permission-denied", "You are not authorized to record refunds.");
}
const auditId = (actorUid, invoiceId, idempotencyKey) => `recordRefund_${(0, node_crypto_1.createHash)("sha256").update(`${actorUid}|${invoiceId}|${idempotencyKey}`).digest("hex").slice(0, 40)}`;
exports.recordRefund = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    await requireRefundRecord(request.auth.uid);
    const data = (request.data ?? {});
    if (typeof data.idempotencyKey !== "string" || data.idempotencyKey.trim().length === 0)
        throw new https_1.HttpsError("invalid-argument", "idempotencyKey is required.");
    if (typeof data.invoiceId !== "string" || data.invoiceId.trim().length === 0)
        throw new https_1.HttpsError("invalid-argument", "invoiceId is required.");
    const actorUid = request.auth.uid;
    const aid = auditId(actorUid, data.invoiceId, data.idempotencyKey);
    const db = (0, firestore_1.getFirestore)();
    try {
        return await db.runTransaction(async (tx) => {
            const prior = await tx.get((0, auditEventWriter_1.auditEventDocRef)(aid));
            if (prior.exists)
                return { success: true, replayed: true, refundId: (prior.data() ?? {}).targetId ?? null };
            const invoiceRef = db.collection(collections_1.INVOICES_COLLECTION).doc(data.invoiceId);
            const invSnap = await tx.get(invoiceRef);
            if (!invSnap.exists)
                throw new refundCommands_1.RefundCommandError("INVOICE_NOT_FOUND", `no invoice with id ${data.invoiceId}`);
            const invoice = invSnap.data();
            const { refund, invoicePatch } = (0, refundCommands_1.buildRefund)(data, invoice, { nowMillis: Date.now() });
            const refundRef = db.collection(collections_1.REFUNDS_COLLECTION).doc();
            tx.set(refundRef, { ...refund, recordedBy: actorUid, recordedAt: firestore_1.FieldValue.serverTimestamp() });
            tx.update(invoiceRef, { appliedMinor: invoicePatch.appliedMinor, outstandingMinor: invoicePatch.outstandingMinor, state: invoicePatch.state, updatedAt: firestore_1.FieldValue.serverTimestamp() });
            (0, auditEventWriter_1.stageAuditEventWithId)(tx, aid, {
                actorUid,
                action: "recordRefund",
                targetType: "refund",
                targetId: refundRef.id,
                outcome: "applied",
                summary: `refunded ${refund.amountMinor} ${refund.currency} on invoice ${data.invoiceId} (state ${invoicePatch.state}, outstanding ${invoicePatch.outstandingMinor}) reason=${refund.reason}`,
            });
            return { success: true, replayed: false, refundId: refundRef.id, invoiceState: invoicePatch.state, outstandingMinor: invoicePatch.outstandingMinor };
        });
    }
    catch (err) {
        throw mapCommandError(err);
    }
});
//# sourceMappingURL=refundCallables.js.map