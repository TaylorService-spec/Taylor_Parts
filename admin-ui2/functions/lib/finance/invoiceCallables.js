"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.issueInvoice = exports.FINANCE_INVOICE_ISSUE_CAPABILITY = void 0;
exports.persistIssuedInvoice = persistIssuedInvoice;
// Finance — governed invoice ISSUANCE callable (thin onCall over the pure command core). Supplies only I/O +
// auth + the trusted transaction:
//   • actor identity from request.auth.uid (never trusted from the payload);
//   • authorization = capability `finance.invoice.issue`, resolved fail-closed via the trusted effective-access
//     feed; registered active:false ⇒ hard DENY for everyone until a separate Owner grant;
//   • the transaction allocates a per-company invoice number (concurrency-safe), writes the immutable ISSUED
//     invoice via the Admin SDK, and stages an append-only AUDIT event (Finance is sensitive/audited);
//   • idempotency: a deterministic audit id makes a retried issuance a no-op replay (no duplicate invoice /
//     no burned sequence number).
// firestore.rules denies ALL direct client access to `invoices`, so this trusted command is the only write
// path. EXPORT != DEPLOY, REGISTER != GRANT, MERGE != ACTIVATION.
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const node_crypto_1 = require("node:crypto");
const effectiveAccessFeed_1 = require("../access/effectiveAccessFeed");
const collections_1 = require("../constants/collections");
const auditEventWriter_1 = require("../access/auditEventWriter");
const invoiceNumbering_1 = require("./invoiceNumbering");
const invoiceCommands_1 = require("./invoiceCommands");
exports.FINANCE_INVOICE_ISSUE_CAPABILITY = "finance.invoice.issue";
function mapCommandError(err) {
    if (err instanceof https_1.HttpsError)
        return err;
    if (err instanceof invoiceCommands_1.InvoiceCommandError) {
        switch (err.code) {
            case "NOT_BILLABLE":
            case "TAX_REQUIRES_REVIEW":
            case "UNPRICED":
                return new https_1.HttpsError("failed-precondition", err.message);
            default:
                return new https_1.HttpsError("invalid-argument", err.message);
        }
    }
    return new https_1.HttpsError("internal", "Invoice issuance failed.");
}
async function requireInvoiceIssue(uid) {
    let allowed = false;
    try {
        const { decisions } = await (0, effectiveAccessFeed_1.resolveEffectiveAccess)({ principalUid: uid, permissionIds: [exports.FINANCE_INVOICE_ISSUE_CAPABILITY] });
        allowed = decisions[exports.FINANCE_INVOICE_ISSUE_CAPABILITY] === true;
    }
    catch (err) {
        console.error(`[requireInvoiceIssue] capability resolution failed for ${exports.FINANCE_INVOICE_ISSUE_CAPABILITY}`, err);
        allowed = false;
    }
    if (!allowed)
        throw new https_1.HttpsError("permission-denied", "You are not authorized to issue invoices.");
}
const auditId = (actorUid, salesOrderId, idempotencyKey) => `issueInvoice_${(0, node_crypto_1.createHash)("sha256").update(`${actorUid}|${salesOrderId}|${idempotencyKey}`).digest("hex").slice(0, 40)}`;
// Transactional core of issueInvoice, exported so tests can exercise the SO cross-check + idempotency
// invariant directly (below the capability gate — finance.invoice.issue is registered active:false, a hard
// deny for everyone until a separate Owner grant), exactly the pattern persistTransitionedSalesOrder already
// established in salesOrderCallables.ts. Reads the GOVERNED Sales Order inside the transaction — the client's
// own claims (unitPrice, qty, accountId, currency) are never trusted; they are cross-checked against this
// snapshot via verifySalesOrderMatch before amounts are recomputed.
async function persistIssuedInvoice(db, tx, data, actorUid) {
    const aid = auditId(actorUid, data.salesOrderId, data.idempotencyKey);
    // Idempotency / replay: a prior audit event at this id means this exact issuance already applied.
    const prior = await tx.get((0, auditEventWriter_1.auditEventDocRef)(aid));
    if (prior.exists) {
        const d = prior.data() ?? {};
        // Replay: the invoice was already issued for this idempotency key — return its canonical id, do not
        // re-issue or burn a new sequence number.
        return { success: true, replayed: true, invoiceId: d.targetId ?? null };
    }
    const soSnap = await tx.get(db.collection(collections_1.SALES_ORDERS_COLLECTION).doc(data.salesOrderId));
    if (!soSnap.exists) {
        throw new https_1.HttpsError("failed-precondition", `No Sales Order with id ${data.salesOrderId}`);
    }
    const salesOrder = soSnap.data();
    const nextLines = (0, invoiceCommands_1.applyBilledQuantities)(data, salesOrder);
    // Allocate the per-company number INSIDE the transaction (concurrency-safe; never reused).
    // Keyed by the GOVERNED company — the Sales Order's operatingCompanyId — never the caller's
    // assertion (applyBilledQuantities→verifySalesOrderMatch above already refused presence/mismatch
    // BEFORE this allocation, so a refused call burns no sequence value).
    const allocated = await (0, invoiceNumbering_1.allocateInvoiceNumber)(tx, salesOrder.operatingCompanyId);
    // FIN-002: the SAME governed snapshot verifySalesOrderMatch read supplies line business units
    // and the frozen attribution — the client's payload labels nothing.
    const record = (0, invoiceCommands_1.buildInvoiceRecord)(data, { invoiceNumber: allocated.invoiceNumber, sequence: allocated.sequence, nowMillis: Date.now(), so: salesOrder });
    const invoiceRef = db.collection(collections_1.INVOICES_COLLECTION).doc(); // canonical opaque identity, distinct from the number
    tx.update(soSnap.ref, { lines: nextLines, updatedAt: firestore_1.FieldValue.serverTimestamp() });
    tx.set(invoiceRef, { ...record, issuedAt: firestore_1.FieldValue.serverTimestamp() });
    (0, auditEventWriter_1.stageAuditEventWithId)(tx, aid, {
        actorUid,
        action: "issueInvoice",
        targetType: "invoice",
        targetId: invoiceRef.id,
        outcome: "applied",
        summary: `issued invoice ${record.invoiceNumber} for salesOrder ${record.salesOrderId} total=${record.totalMinor} ${record.currency}`,
    });
    return { success: true, replayed: false, invoiceId: invoiceRef.id, invoiceNumber: record.invoiceNumber, totalMinor: record.totalMinor };
}
// Issue an invoice for a Sales Order's billable lines. The server RE-COMPUTES authoritative amounts (integer
// minor units) from the committed unit-price snapshot + injected tax determination and fails closed on any
// gap; the client never supplies the invoice number, the total, or the tax authority.
exports.issueInvoice = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    await requireInvoiceIssue(request.auth.uid);
    const data = (request.data ?? {});
    if (typeof data.idempotencyKey !== "string" || data.idempotencyKey.trim().length === 0) {
        throw new https_1.HttpsError("invalid-argument", "idempotencyKey is required.");
    }
    if (typeof data.salesOrderId !== "string" || data.salesOrderId.trim().length === 0) {
        throw new https_1.HttpsError("invalid-argument", "salesOrderId is required.");
    }
    const actorUid = request.auth.uid;
    const db = (0, firestore_1.getFirestore)();
    try {
        return await db.runTransaction((tx) => persistIssuedInvoice(db, tx, data, actorUid));
    }
    catch (err) {
        throw mapCommandError(err);
    }
});
//# sourceMappingURL=invoiceCallables.js.map