"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordInvoiceAdjustment = exports.FINANCE_ADJUSTMENT_RECORD_CAPABILITY = void 0;
// Finance — governed invoice ADJUSTMENT callable (thin onCall over the pure command core). Records an explicit
// linked credit/charge/write-off record and maintains the invoice's derived AR projection — in one
// transaction. Supplies only I/O + auth:
//   • actor identity from request.auth.uid;
//   • authorization = capability `finance.adjustment.record`, fail-closed via the trusted effective-access
//     feed; registered active:false ⇒ hard DENY until a separate Owner grant;
//   • the transaction reads the invoice, writes the adjustment (Admin SDK), updates the invoice's
//     transactionally-maintained AR projection (credits/charges/writeoffs; outstanding re-derived — the
//     invoice is NEVER rewritten to erase history), and stages an append-only AUDIT event;
//   • idempotency via a deterministic audit id.
// `invoice_adjustments` is Admin-SDK-only (deny-all client Rules). EXPORT != DEPLOY, REGISTER != GRANT.
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const node_crypto_1 = require("node:crypto");
const effectiveAccessFeed_1 = require("../access/effectiveAccessFeed");
const collections_1 = require("../constants/collections");
const auditEventWriter_1 = require("../access/auditEventWriter");
const adjustmentCommands_1 = require("./adjustmentCommands");
exports.FINANCE_ADJUSTMENT_RECORD_CAPABILITY = "finance.adjustment.record";
function mapCommandError(err) {
    if (err instanceof https_1.HttpsError)
        return err;
    if (err instanceof adjustmentCommands_1.AdjustmentCommandError) {
        switch (err.code) {
            case "INVOICE_VOID":
            case "EXCEEDS_OUTSTANDING":
            case "CURRENCY_MISMATCH":
                return new https_1.HttpsError("failed-precondition", err.message);
            case "INVOICE_NOT_FOUND":
                return new https_1.HttpsError("not-found", err.message);
            default:
                return new https_1.HttpsError("invalid-argument", err.message);
        }
    }
    return new https_1.HttpsError("internal", "Adjustment failed.");
}
async function requireAdjustmentRecord(uid) {
    let allowed = false;
    try {
        const { decisions } = await (0, effectiveAccessFeed_1.resolveEffectiveAccess)({ principalUid: uid, permissionIds: [exports.FINANCE_ADJUSTMENT_RECORD_CAPABILITY] });
        allowed = decisions[exports.FINANCE_ADJUSTMENT_RECORD_CAPABILITY] === true;
    }
    catch {
        allowed = false;
    }
    if (!allowed)
        throw new https_1.HttpsError("permission-denied", "You are not authorized to record invoice adjustments.");
}
const auditId = (actorUid, invoiceId, idempotencyKey) => `recordInvoiceAdjustment_${(0, node_crypto_1.createHash)("sha256").update(`${actorUid}|${invoiceId}|${idempotencyKey}`).digest("hex").slice(0, 40)}`;
exports.recordInvoiceAdjustment = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    await requireAdjustmentRecord(request.auth.uid);
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
            if (prior.exists) {
                const d = prior.data() ?? {};
                return { success: true, replayed: true, adjustmentId: d.targetId ?? null };
            }
            const invoiceRef = db.collection(collections_1.INVOICES_COLLECTION).doc(data.invoiceId);
            const invSnap = await tx.get(invoiceRef);
            if (!invSnap.exists)
                throw new adjustmentCommands_1.AdjustmentCommandError("INVOICE_NOT_FOUND", `no invoice with id ${data.invoiceId}`);
            const invoice = invSnap.data();
            const { adjustment, invoicePatch } = (0, adjustmentCommands_1.buildAdjustment)(data, invoice, { nowMillis: Date.now() });
            // Explicit linked adjustment record — never a rewrite of the issued invoice.
            const adjRef = db.collection(collections_1.INVOICE_ADJUSTMENTS_COLLECTION).doc();
            tx.set(adjRef, { ...adjustment, recordedBy: actorUid, recordedAt: firestore_1.FieldValue.serverTimestamp() });
            // Invoice AR projection maintained in the SAME transaction (state left unchanged — a credit/write-off is
            // not a payment; only outstanding + the adjustment tallies move).
            const patch = { outstandingMinor: invoicePatch.outstandingMinor, updatedAt: firestore_1.FieldValue.serverTimestamp() };
            if (invoicePatch.creditsMinor !== undefined)
                patch.creditsMinor = invoicePatch.creditsMinor;
            if (invoicePatch.chargesMinor !== undefined)
                patch.chargesMinor = invoicePatch.chargesMinor;
            if (invoicePatch.writeOffMinor !== undefined)
                patch.writeOffMinor = invoicePatch.writeOffMinor;
            tx.update(invoiceRef, patch);
            (0, auditEventWriter_1.stageAuditEventWithId)(tx, aid, {
                actorUid,
                action: "recordInvoiceAdjustment",
                targetType: "invoiceAdjustment",
                targetId: adjRef.id,
                outcome: "applied",
                summary: `${adjustment.type} ${adjustment.amountMinor} ${adjustment.currency} on invoice ${data.invoiceId} (outstanding ${invoicePatch.outstandingMinor}) reason=${adjustment.reason}`,
            });
            return { success: true, replayed: false, adjustmentId: adjRef.id, type: adjustment.type, outstandingMinor: invoicePatch.outstandingMinor };
        });
    }
    catch (err) {
        throw mapCommandError(err);
    }
});
//# sourceMappingURL=adjustmentCallables.js.map