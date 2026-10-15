"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyPayment = exports.FINANCE_PAYMENT_APPLY_CAPABILITY = void 0;
// Finance — governed payment APPLICATION callable (thin onCall over the pure command core). Records a CASH
// RECEIPT and its PAYMENT APPLICATION to one invoice, and maintains the invoice's AR projection — all in one
// transaction. Supplies only I/O + auth + the trusted transaction:
//   • actor identity from request.auth.uid;
//   • authorization = capability `finance.payment.apply`, fail-closed via the trusted effective-access feed;
//     registered active:false ⇒ hard DENY until a separate Owner grant;
//   • the transaction reads the invoice, writes the receipt + the application (Admin SDK), updates the
//     invoice's transactionally-maintained AR projection (outstanding/state derived from the application
//     fact — NOT an independent authority), and stages an append-only AUDIT event;
//   • idempotency: a deterministic audit id makes a retried apply a no-op replay (no double receipt / no
//     double application / no drift).
// `payments` and `payment_applications` are Admin-SDK-only (deny-all client Rules). EXPORT != DEPLOY,
// REGISTER != GRANT, MERGE != ACTIVATION.
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const node_crypto_1 = require("node:crypto");
const effectiveAccessFeed_1 = require("../access/effectiveAccessFeed");
const collections_1 = require("../constants/collections");
const auditEventWriter_1 = require("../access/auditEventWriter");
const paymentCommands_1 = require("./paymentCommands");
exports.FINANCE_PAYMENT_APPLY_CAPABILITY = "finance.payment.apply";
function mapCommandError(err) {
    if (err instanceof https_1.HttpsError)
        return err;
    if (err instanceof paymentCommands_1.PaymentCommandError) {
        switch (err.code) {
            case "ALREADY_PAID":
            case "INVOICE_VOID":
            case "NOT_OPEN":
            case "OVER_APPLICATION":
            case "CURRENCY_MISMATCH":
                return new https_1.HttpsError("failed-precondition", err.message);
            case "INVOICE_NOT_FOUND":
                return new https_1.HttpsError("not-found", err.message);
            default:
                return new https_1.HttpsError("invalid-argument", err.message);
        }
    }
    return new https_1.HttpsError("internal", "Payment application failed.");
}
async function requirePaymentApply(uid) {
    let allowed = false;
    try {
        const { decisions } = await (0, effectiveAccessFeed_1.resolveEffectiveAccess)({ principalUid: uid, permissionIds: [exports.FINANCE_PAYMENT_APPLY_CAPABILITY] });
        allowed = decisions[exports.FINANCE_PAYMENT_APPLY_CAPABILITY] === true;
    }
    catch {
        allowed = false;
    }
    if (!allowed)
        throw new https_1.HttpsError("permission-denied", "You are not authorized to apply payments.");
}
const auditId = (actorUid, invoiceId, idempotencyKey) => `applyPayment_${(0, node_crypto_1.createHash)("sha256").update(`${actorUid}|${invoiceId}|${idempotencyKey}`).digest("hex").slice(0, 40)}`;
exports.applyPayment = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    await requirePaymentApply(request.auth.uid);
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
            // Idempotency / replay.
            const prior = await tx.get((0, auditEventWriter_1.auditEventDocRef)(aid));
            if (prior.exists) {
                const d = prior.data() ?? {};
                return { success: true, replayed: true, paymentId: d.targetId ?? null };
            }
            const invoiceRef = db.collection(collections_1.INVOICES_COLLECTION).doc(data.invoiceId);
            const invSnap = await tx.get(invoiceRef);
            if (!invSnap.exists)
                throw new paymentCommands_1.PaymentCommandError("INVOICE_NOT_FOUND", `no invoice with id ${data.invoiceId}`);
            const invoice = invSnap.data();
            const { receipt, application, invoicePatch } = (0, paymentCommands_1.buildApplyPayment)(data, invoice, { nowMillis: Date.now() });
            // Cash receipt (money received) — its own record.
            const paymentRef = db.collection(collections_1.PAYMENTS_COLLECTION).doc();
            tx.set(paymentRef, { ...receipt, receivedAt: firestore_1.FieldValue.serverTimestamp(), createdAt: firestore_1.FieldValue.serverTimestamp() });
            // Payment application (how it is applied) — a separate fact referencing the receipt + invoice.
            const applicationRef = db.collection(collections_1.PAYMENT_APPLICATIONS_COLLECTION).doc();
            tx.set(applicationRef, { ...application, paymentId: paymentRef.id, createdAt: firestore_1.FieldValue.serverTimestamp() });
            // Invoice AR projection maintained in the SAME transaction as the application fact (no drift).
            tx.update(invoiceRef, { appliedMinor: invoicePatch.appliedMinor, outstandingMinor: invoicePatch.outstandingMinor, state: invoicePatch.state, updatedAt: firestore_1.FieldValue.serverTimestamp() });
            (0, auditEventWriter_1.stageAuditEventWithId)(tx, aid, {
                actorUid,
                action: "applyPayment",
                targetType: "payment",
                targetId: paymentRef.id,
                outcome: "applied",
                summary: `applied ${application.appliedAmountMinor} ${application.currency} to invoice ${data.invoiceId} (state ${invoicePatch.state}, outstanding ${invoicePatch.outstandingMinor})`,
            });
            return {
                success: true,
                replayed: false,
                paymentId: paymentRef.id,
                applicationId: applicationRef.id,
                invoiceState: invoicePatch.state,
                outstandingMinor: invoicePatch.outstandingMinor,
            };
        });
    }
    catch (err) {
        throw mapCommandError(err);
    }
});
//# sourceMappingURL=paymentCallables.js.map