"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.transitionSalesOrder = exports.createSalesOrder = exports.SALES_ORDER_WRITE_CAPABILITY = void 0;
exports.persistCreatedSalesOrder = persistCreatedSalesOrder;
exports.persistTransitionedSalesOrder = persistTransitionedSalesOrder;
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
const salesOrderNumbering_1 = require("./salesOrderNumbering");
exports.SALES_ORDER_WRITE_CAPABILITY = "salesOrder.write";
// Shared deterministic Audit Event id builder (same shape as coverageCallables.ts's mkAuditId): a retried
// call with the same actorUid + idempotencyKey resolves to the SAME Audit Event document id, so the
// transactional existence check below is the single source of truth for "was this exact call already applied."
const mkAuditId = (action, actorUid, key) => `${action}_${(0, node_crypto_1.createHash)("sha256").update(`${actorUid}|${key}`).digest("hex").slice(0, 40)}`;
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
// When built.sourceOpportunityId is set, verify + reserve the source Opportunity INSIDE the same transaction
// as the create (P1.4-1.6, Sales->Cash lifecycle build plan): the Opportunity must exist, be WON, and belong
// to the same account as the new Sales Order; and no other Sales Order may already carry that
// sourceOpportunityId (one WON Opportunity mints at most one SO via this path). All reads happen here, before
// any write in persistCreatedSalesOrder, to respect Firestore's transaction read-before-write ordering.
async function verifySourceOpportunity(db, tx, sourceOpportunityId, accountId, salesOrderLines) {
    const oppRef = db.collection(collections_1.OPPORTUNITIES_COLLECTION).doc(sourceOpportunityId);
    const oppSnap = await tx.get(oppRef);
    if (!oppSnap.exists) {
        throw new https_1.HttpsError("invalid-argument", `No Opportunity with id ${sourceOpportunityId}`);
    }
    const opp = oppSnap.data();
    if (opp.outcome !== "WON") {
        throw new https_1.HttpsError("failed-precondition", `Opportunity ${sourceOpportunityId} is not WON`);
    }
    if (opp.accountId !== accountId) {
        throw new https_1.HttpsError("failed-precondition", `Opportunity ${sourceOpportunityId} does not belong to account ${accountId}`);
    }
    const countLines = (lines) => {
        const counts = new Map();
        for (const line of lines) {
            const qty = line.qty ?? line.orderedQty;
            if (typeof line.kind !== "string" || typeof line.ref !== "string" || typeof qty !== "number")
                return null;
            const key = `${line.kind}:${line.ref}:${qty}`;
            counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        return counts;
    };
    const opportunityCounts = countLines(Array.isArray(opp.lines) ? opp.lines : []);
    const salesOrderCounts = countLines(salesOrderLines);
    if (!opportunityCounts || !salesOrderCounts || opportunityCounts.size !== salesOrderCounts.size || [...opportunityCounts].some(([key, count]) => salesOrderCounts.get(key) !== count)) {
        throw new https_1.HttpsError("failed-precondition", `Sales Order lines must exactly match Opportunity ${sourceOpportunityId} lines`);
    }
    const dupQuery = db.collection(collections_1.SALES_ORDERS_COLLECTION).where("sourceOpportunityId", "==", sourceOpportunityId).limit(1);
    const dup = await tx.get(dupQuery);
    if (!dup.empty) {
        throw new https_1.HttpsError("failed-precondition", `Opportunity ${sourceOpportunityId} already has a Sales Order`);
    }
    return oppRef;
}
async function persistCreatedSalesOrder(db, tx, built, actorUid, idempotencyKey) {
    const aid = idempotencyKey ? mkAuditId("createSalesOrder", actorUid, idempotencyKey) : null;
    const { createdAtMillis: _c, updatedAtMillis: _u, ...fields } = built;
    if (aid) {
        const prior = await tx.get((0, auditEventWriter_1.auditEventDocRef)(aid));
        if (prior.exists)
            return { success: true, replayed: true, salesOrderId: (prior.data() ?? {}).targetId ?? null, state: built.state };
    }
    const oppRef = built.sourceOpportunityId
        ? await verifySourceOpportunity(db, tx, built.sourceOpportunityId, built.accountId, built.lines)
        : null;
    // HUMAN IDENTITY. Allocated inside the caller's transaction, alongside the document write, so a
    // reference is never issued without its Sales Order appearing and a Sales Order never appears
    // without one. Server-authoritative: `built` (from the pure `buildCreateSalesOrder`) never carries
    // a salesOrderNumber, so there is nothing here for a client-supplied value to override.
    //
    // Immutable by construction: set here at creation and no transition path writes it.
    const { salesOrderNumber } = await (0, salesOrderNumbering_1.allocateSalesOrderNumber)(tx, new Date().getUTCFullYear());
    const ref = db.collection(collections_1.SALES_ORDERS_COLLECTION).doc();
    tx.set(ref, { ...fields, salesOrderNumber, createdAt: firestore_1.FieldValue.serverTimestamp(), updatedAt: firestore_1.FieldValue.serverTimestamp() });
    if (aid)
        (0, auditEventWriter_1.stageAuditEventWithId)(tx, aid, { actorUid, action: "createSalesOrder", targetType: "salesOrder", targetId: ref.id, outcome: "applied", summary: `created sales order for account ${built.accountId}` });
    if (oppRef)
        tx.update(oppRef, { salesOrderId: ref.id });
    return { success: true, replayed: false, salesOrderId: ref.id, state: built.state };
}
// Transactional core of transitionSalesOrder, exported so tests can exercise the idempotency invariant
// directly (below the capability gate — salesOrder.write is registered active:false, a hard deny for
// everyone until a separate Owner grant), exactly the pattern persistCreatedSalesOrder already established.
async function persistTransitionedSalesOrder(db, tx, ref, salesOrderId, transition, actorUid, idempotencyKey) {
    // TARGET-SCOPED IDEMPOTENCY, with the legacy id still honoured.
    //
    // THE DEFECT. mkAuditId hashes actorUid|key with NO target. One actor reusing an
    // idempotency key across two DIFFERENT Sales Orders therefore collides: the second call
    // finds the first call's audit event, returns "replayed", and SKIPS EVERY VALIDATION
    // without applying anything. The caller is told it succeeded.
    //
    // THE FIX. Compose the id with the salesOrderId so each record has its own replay space --
    // the shape createSalesOrderFromOpportunity and updateOpportunity already use.
    //
    // BACKWARD COMPATIBILITY, EXPLICITLY. Changing the derivation orphans every id already
    // written: a genuine retry of an in-flight pre-change call would hash to a NEW id, find
    // nothing, and RE-APPLY -- turning a safety mechanism into a double-apply during the
    // rollout window. So the legacy id is still read. If either exists, this is a replay.
    // Only the NEW id is ever written, so the legacy lookup ages out on its own and no
    // existing audit record becomes unsafe or unreachable.
    const aid = mkAuditId("transitionSalesOrder", actorUid, `${salesOrderId}|${idempotencyKey}`);
    const legacyAid = mkAuditId("transitionSalesOrder", actorUid, idempotencyKey);
    const prior = await tx.get((0, auditEventWriter_1.auditEventDocRef)(aid));
    const legacyPrior = aid === legacyAid ? prior : await tx.get((0, auditEventWriter_1.auditEventDocRef)(legacyAid));
    const snap = await tx.get(ref);
    if (!snap.exists)
        throw new https_1.HttpsError("not-found", `No Sales Order with id ${salesOrderId}`);
    const current = snap.data();
    if (prior.exists) {
        return { success: true, replayed: true, salesOrderId, state: current.state };
    }
    const patch = (0, salesOrderCommands_1.buildTransitionPatch)(current, transition, { actorUid, nowMillis: Date.now() });
    const { updatedAtMillis: _u, ...rest } = patch;
    tx.update(ref, { ...rest, updatedAt: firestore_1.FieldValue.serverTimestamp() });
    (0, auditEventWriter_1.stageAuditEventWithId)(tx, aid, {
        actorUid,
        action: "transitionSalesOrder",
        targetType: "salesOrder",
        targetId: salesOrderId,
        outcome: "applied",
        summary: `transitioned sales order ${salesOrderId} to state ${patch.state}`,
    });
    return { success: true, replayed: false, salesOrderId, state: patch.state };
}
async function requireSalesOrderWrite(uid) {
    let allowed = false;
    try {
        const { decisions } = await (0, effectiveAccessFeed_1.resolveEffectiveAccess)({ principalUid: uid, permissionIds: [exports.SALES_ORDER_WRITE_CAPABILITY] });
        allowed = decisions[exports.SALES_ORDER_WRITE_CAPABILITY] === true;
    }
    catch (err) {
        console.error(`[requireSalesOrderWrite] capability resolution failed for ${exports.SALES_ORDER_WRITE_CAPABILITY}`, err);
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
//
// Idempotency (site-work r3 item G): a retried ADVANCE/CANCEL call — client timeout retry, double-tap — must
// never apply twice. Mirrors createSalesOrder's guard precisely: a REQUIRED idempotencyKey resolves to a
// deterministic Audit Event id (mkAuditId), staged atomically with the state mutation in the SAME transaction.
// A duplicate call finds that Audit Event already exists and returns `replayed:true` with the Sales Order's
// CURRENT state instead of recomputing and reapplying the transition.
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
    if (typeof data.idempotencyKey !== "string" || data.idempotencyKey.trim().length === 0) {
        throw new https_1.HttpsError("invalid-argument", "idempotencyKey is required.");
    }
    const actorUid = request.auth.uid;
    const db = (0, firestore_1.getFirestore)();
    const ref = db.collection(collections_1.SALES_ORDERS_COLLECTION).doc(data.salesOrderId);
    try {
        return await db.runTransaction((tx) => persistTransitionedSalesOrder(db, tx, ref, data.salesOrderId, data.transition, actorUid, data.idempotencyKey));
    }
    catch (err) {
        throw mapCommandError(err);
    }
});
//# sourceMappingURL=salesOrderCallables.js.map