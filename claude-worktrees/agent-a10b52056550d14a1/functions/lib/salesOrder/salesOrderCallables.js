"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.transitionSalesOrder = exports.createSalesOrder = exports.SALES_ORDER_WRITE_CAPABILITY = void 0;
exports.persistCreatedSalesOrder = persistCreatedSalesOrder;
// Sales Order — governed WRITE callables (Cycle 4). Thin onCall adapters over the PURE command core
// (salesOrderCommands.ts) + lifecycle authority (salesOrderLifecycle.ts). They supply only I/O + auth:
//   • actor identity from request.auth.uid (never trusted from the payload);
//   • authorization = capability `salesOrder.write`, resolved fail-closed via the trusted effective-access
//     feed; registered active:false ⇒ hard DENY for everyone until a separate Owner grant;
//   • writes go to the `sales_orders` collection via the Admin SDK; firestore.rules denies ALL direct client
//     access to that collection, so the trusted command is the only write path.
// EXPORT != DEPLOY, REGISTER != GRANT. Sales Order is the committed commercial order; it does NOT assign
// serialized assets (fulfillment does) and does NOT write Work Orders/inventory (later governed seams do).
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const node_crypto_1 = require("node:crypto");
const effectiveAccessFeed_1 = require("../access/effectiveAccessFeed");
const auditEventWriter_1 = require("../access/auditEventWriter");
const collections_1 = require("../constants/collections");
const salesOrderCommands_1 = require("./salesOrderCommands");
exports.SALES_ORDER_WRITE_CAPABILITY = "salesOrder.write";
const createAuditId = (actorUid, key) => `createSalesOrder_${(0, node_crypto_1.createHash)("sha256").update(`${actorUid}|${key}`).digest("hex").slice(0, 40)}`;
function mapCommandError(err) {
    if (err instanceof https_1.HttpsError)
        return err;
    if (err instanceof salesOrderCommands_1.SalesOrderCommandError) {
        switch (err.code) {
            case "TERMINAL":
            case "ILLEGAL_TRANSITION":
            case "NOT_FULFILLABLE":
                return new https_1.HttpsError("failed-precondition", err.message);
            default:
                return new https_1.HttpsError("invalid-argument", err.message);
        }
    }
    return new https_1.HttpsError("internal", "Sales Order command failed.");
}
async function persistCreatedSalesOrder(db, tx, built, actorUid, idempotencyKey) {
    const aid = idempotencyKey ? createAuditId(actorUid, idempotencyKey) : null;
    const { createdAtMillis: _c, updatedAtMillis: _u, ...fields } = built;
    if (aid) {
        const prior = await tx.get((0, auditEventWriter_1.auditEventDocRef)(aid));
        if (prior.exists)
            return { success: true, replayed: true, salesOrderId: (prior.data() ?? {}).targetId ?? null, state: built.state };
    }
    const ref = db.collection(collections_1.SALES_ORDERS_COLLECTION).doc();
    tx.set(ref, { ...fields, createdAt: firestore_1.FieldValue.serverTimestamp(), updatedAt: firestore_1.FieldValue.serverTimestamp() });
    if (aid)
        (0, auditEventWriter_1.stageAuditEventWithId)(tx, aid, { actorUid, action: "createSalesOrder", targetType: "salesOrder", targetId: ref.id, outcome: "applied", summary: `created sales order for account ${built.accountId}` });
    return { success: true, replayed: false, salesOrderId: ref.id, state: built.state };
}
async function requireSalesOrderWrite(uid) {
    let allowed = false;
    try {
        const { decisions } = await (0, effectiveAccessFeed_1.resolveEffectiveAccess)({ principalUid: uid, permissionIds: [exports.SALES_ORDER_WRITE_CAPABILITY] });
        allowed = decisions[exports.SALES_ORDER_WRITE_CAPABILITY] === true;
    }
    catch {
        allowed = false;
    }
    if (!allowed)
        throw new https_1.HttpsError("permission-denied", "You are not authorized to write Sales Orders.");
}
// Create a committed Sales Order (CONFIRMED) from commercial inputs (typically a WON Opportunity). Product-
// level lines only; a serialized-asset line is rejected by the pure builder.
exports.createSalesOrder = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    await requireSalesOrderWrite(request.auth.uid);
    const data = (request.data ?? {});
    if (data.idempotencyKey !== undefined && (typeof data.idempotencyKey !== "string" || data.idempotencyKey.trim().length === 0)) {
        throw new https_1.HttpsError("invalid-argument", "idempotencyKey, when provided, must be a non-empty string.");
    }
    let built;
    try {
        built = (0, salesOrderCommands_1.buildCreateSalesOrder)(data, { actorUid: request.auth.uid, nowMillis: Date.now() });
    }
    catch (err) {
        throw mapCommandError(err);
    }
    const db = (0, firestore_1.getFirestore)();
    return db.runTransaction((tx) => persistCreatedSalesOrder(db, tx, built, request.auth.uid, data.idempotencyKey));
});
// Advance a Sales Order along its lifecycle, or cancel it (before FULFILLED). Legality is enforced by the
// pure authority; FULFILLED requires every line fully fulfilled.
exports.transitionSalesOrder = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    await requireSalesOrderWrite(request.auth.uid);
    const data = (request.data ?? {});
    if (typeof data.salesOrderId !== "string" || data.salesOrderId.trim().length === 0) {
        throw new https_1.HttpsError("invalid-argument", "salesOrderId is required.");
    }
    if (data.transition !== "ADVANCE" && data.transition !== "CANCEL") {
        throw new https_1.HttpsError("invalid-argument", "transition must be ADVANCE or CANCEL.");
    }
    const db = (0, firestore_1.getFirestore)();
    const ref = db.collection(collections_1.SALES_ORDERS_COLLECTION).doc(data.salesOrderId);
    try {
        const result = await db.runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            if (!snap.exists)
                throw new https_1.HttpsError("not-found", `No Sales Order with id ${data.salesOrderId}`);
            const current = snap.data();
            const patch = (0, salesOrderCommands_1.buildTransitionPatch)(current, data.transition, { actorUid: request.auth.uid, nowMillis: Date.now() });
            const { updatedAtMillis: _u, ...rest } = patch;
            tx.update(ref, { ...rest, updatedAt: firestore_1.FieldValue.serverTimestamp() });
            return { state: patch.state };
        });
        return { success: true, salesOrderId: data.salesOrderId, ...result };
    }
    catch (err) {
        throw mapCommandError(err);
    }
});
//# sourceMappingURL=salesOrderCallables.js.map