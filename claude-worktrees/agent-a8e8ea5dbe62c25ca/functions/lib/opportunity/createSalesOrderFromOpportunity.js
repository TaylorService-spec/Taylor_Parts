"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSalesOrderFromOpportunity = exports.OPPORTUNITY_CREATE_SALES_ORDER_CAPABILITY = void 0;
exports.persistSalesOrderFromOpportunity = persistSalesOrderFromOpportunity;
// Governed WON -> Create Sales Order action (P1.3, decision #3). A HUMAN-INVOKED onCall callable — there is
// deliberately NO Firestore trigger that auto-creates a Sales Order when an Opportunity is set to WON. The
// operator explicitly invokes this action; nothing runs implicitly on the WON write.
//
// Lines/quantities/account are NEVER client-supplied here — they are read from the WON Opportunity doc inside
// the transaction, so the Sales Order can never diverge from the commercial commitment it is sealing.
// `ownerEmployeeId`/`salesChannel`/`locationId`/`customerPO` ARE caller-supplied (the Sales Order's own
// owning/channel/location/PO facts, which may legitimately differ from the Opportunity's).
//
// Reuses `buildCreateSalesOrder` (salesOrder/salesOrderCommands.ts) AS-IS — no changes to that pure builder —
// so a Sales Order created via this path is validated by the exact same invariants (product-level lines only,
// orderedQty a positive integer, etc.) as one created via the direct `createSalesOrder` callable.
//
// Authorization = capability `opportunity.createSalesOrder`, resolved fail-closed via the trusted
// effective-access feed; registered active:false ⇒ hard DENY for everyone until a separate Owner grant.
// EXPORT != DEPLOY, REGISTER != GRANT.
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const node_crypto_1 = require("node:crypto");
const effectiveAccessFeed_1 = require("../access/effectiveAccessFeed");
const auditEventWriter_1 = require("../access/auditEventWriter");
const collections_1 = require("../constants/collections");
const salesOrderCommands_1 = require("../salesOrder/salesOrderCommands");
const opportunityLifecycle_1 = require("./opportunityLifecycle");
exports.OPPORTUNITY_CREATE_SALES_ORDER_CAPABILITY = "opportunity.createSalesOrder";
// Shared deterministic Audit Event id builder (same shape as salesOrderCallables.ts's mkAuditId), but keyed by
// its OWN action string ("createSalesOrderFromOpportunity") so a replay key collides only with a prior call
// through THIS action, never with the direct createSalesOrder callable's own idempotency space.
const mkAuditId = (actorUid, opportunityId, key) => `createSalesOrderFromOpportunity_${(0, node_crypto_1.createHash)("sha256").update(`${actorUid}|${opportunityId}|${key}`).digest("hex").slice(0, 40)}`;
function mapCommandError(err) {
    if (err instanceof https_1.HttpsError)
        return err;
    if (err instanceof salesOrderCommands_1.SalesOrderCommandError)
        return new https_1.HttpsError("invalid-argument", err.message);
    return new https_1.HttpsError("internal", "Create Sales Order from Opportunity failed.");
}
// Translate the Opportunity's PRE-COMMITMENT lines (kind/ref/qty?) into the Sales Order builder's
// SalesOrderLineInput shape. `qty` is OPTIONAL on an Opportunity line but REQUIRED (as orderedQty) on a Sales
// Order line — a missing qty is a fail-closed condition here, never defaulted (e.g. to 1).
function deriveSalesOrderLines(lines) {
    if (!Array.isArray(lines) || lines.length === 0) {
        throw new https_1.HttpsError("failed-precondition", "Opportunity has no lines to seed a Sales Order from.");
    }
    return lines.map((l, i) => {
        if (typeof l.qty !== "number" || !Number.isFinite(l.qty) || l.qty <= 0) {
            throw new https_1.HttpsError("failed-precondition", `Opportunity line ${i} (${l.ref ?? "unknown"}) is missing a qty; refusing to default a Sales Order quantity.`);
        }
        return {
            kind: l.kind,
            ref: l.ref,
            orderedQty: l.qty,
        };
    });
}
// Transactional core, exported so tests can exercise the business rules directly (below the capability gate —
// `opportunity.createSalesOrder` is registered active:false, a hard deny for everyone until a separate Owner
// grant), exactly the pattern the sibling commercial callables already establish
// (persistCreatedSalesOrder / persistTransitionedOpportunity).
async function persistSalesOrderFromOpportunity(db, tx, input, actorUid) {
    const opportunityId = input.opportunityId;
    const opportunityRef = db.collection(collections_1.OPPORTUNITIES_COLLECTION).doc(opportunityId);
    // Idempotency check FIRST (read-phase): a replayed call must never re-derive/re-validate against a
    // possibly-since-changed Opportunity — it returns the prior outcome untouched.
    const aid = mkAuditId(actorUid, opportunityId, input.idempotencyKey);
    const priorAuditSnap = await tx.get((0, auditEventWriter_1.auditEventDocRef)(aid));
    if (priorAuditSnap.exists) {
        return {
            success: true,
            replayed: true,
            salesOrderId: (priorAuditSnap.data() ?? {}).targetId ?? null,
            opportunityId,
        };
    }
    const oppSnap = await tx.get(opportunityRef);
    if (!oppSnap.exists)
        throw new https_1.HttpsError("not-found", `No Opportunity with id ${opportunityId}`);
    const opp = oppSnap.data();
    // [P1.4] Only a WON Opportunity may seed a Sales Order.
    if (opp.outcome !== "WON") {
        throw new https_1.HttpsError("failed-precondition", `Opportunity is not WON (outcome=${opp.outcome ?? "none"}).`);
    }
    // [P1.5] Dedup: no existing Sales Order may already carry this sourceOpportunityId. Queried IN-TRANSACTION
    // so a concurrent duplicate call sees a consistent snapshot (Firestore serializes conflicting transactions).
    const dupQuery = db.collection(collections_1.SALES_ORDERS_COLLECTION).where("sourceOpportunityId", "==", opportunityId).limit(1);
    const dupSnap = await tx.get(dupQuery);
    if (!dupSnap.empty) {
        throw new https_1.HttpsError("failed-precondition", `Opportunity ${opportunityId} already has a Sales Order.`);
    }
    if (!opp.accountId) {
        throw new https_1.HttpsError("failed-precondition", "Opportunity has no accountId; cannot derive Sales Order account.");
    }
    const lines = deriveSalesOrderLines(opp.lines);
    let built;
    try {
        built = (0, salesOrderCommands_1.buildCreateSalesOrder)({
            accountId: opp.accountId,
            ownerEmployeeId: input.ownerEmployeeId,
            salesChannel: input.salesChannel,
            locationId: input.locationId,
            sourceOpportunityId: opportunityId,
            customerPO: input.customerPO,
            lines,
        }, { actorUid, nowMillis: Date.now() });
    }
    catch (err) {
        throw mapCommandError(err);
    }
    // [P1.6] Persist the Sales Order AND the Opportunity back-link atomically — same transaction, same commit.
    const soRef = db.collection(collections_1.SALES_ORDERS_COLLECTION).doc();
    const { createdAtMillis: _c, updatedAtMillis: _u, ...fields } = built;
    tx.set(soRef, { ...fields, createdAt: firestore_1.FieldValue.serverTimestamp(), updatedAt: firestore_1.FieldValue.serverTimestamp() });
    tx.update(opportunityRef, { salesOrderId: soRef.id, updatedAt: firestore_1.FieldValue.serverTimestamp() });
    (0, auditEventWriter_1.stageAuditEventWithId)(tx, aid, {
        actorUid,
        action: "createSalesOrderFromOpportunity",
        targetType: "salesOrder",
        targetId: soRef.id,
        outcome: "applied",
        summary: `created sales order for account ${built.accountId} from WON opportunity ${opportunityId}`,
    });
    return { success: true, replayed: false, salesOrderId: soRef.id, opportunityId };
}
async function requireCreateSalesOrderFromOpportunity(uid) {
    let allowed = false;
    try {
        const { decisions } = await (0, effectiveAccessFeed_1.resolveEffectiveAccess)({
            principalUid: uid,
            permissionIds: [exports.OPPORTUNITY_CREATE_SALES_ORDER_CAPABILITY],
        });
        allowed = decisions[exports.OPPORTUNITY_CREATE_SALES_ORDER_CAPABILITY] === true;
    }
    catch {
        allowed = false; // a throwing resolver is a denial, never an allow
    }
    if (!allowed)
        throw new https_1.HttpsError("permission-denied", "You are not authorized to create a Sales Order from an Opportunity.");
}
// Explicit, human-invoked WON -> Create Sales Order action (decision #3: no Firestore trigger, not
// auto-created on WON). Input carries only opportunityId + the Sales Order's own owner/channel/location/PO —
// account and lines are always server-derived from the WON Opportunity, never trusted from the payload.
exports.createSalesOrderFromOpportunity = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    await requireCreateSalesOrderFromOpportunity(request.auth.uid);
    const data = (request.data ?? {});
    if (typeof data.opportunityId !== "string" || data.opportunityId.trim().length === 0) {
        throw new https_1.HttpsError("invalid-argument", "opportunityId is required.");
    }
    if (typeof data.ownerEmployeeId !== "string" || data.ownerEmployeeId.trim().length === 0) {
        throw new https_1.HttpsError("invalid-argument", "ownerEmployeeId (canonical Employee) is required.");
    }
    if (!(0, opportunityLifecycle_1.isChannel)(data.salesChannel)) {
        throw new https_1.HttpsError("invalid-argument", "salesChannel is invalid.");
    }
    if (typeof data.idempotencyKey !== "string" || data.idempotencyKey.trim().length === 0) {
        throw new https_1.HttpsError("invalid-argument", "idempotencyKey is required.");
    }
    const db = (0, firestore_1.getFirestore)();
    try {
        return await db.runTransaction((tx) => persistSalesOrderFromOpportunity(db, tx, {
            opportunityId: data.opportunityId.trim(),
            ownerEmployeeId: data.ownerEmployeeId.trim(),
            salesChannel: data.salesChannel,
            locationId: data.locationId,
            customerPO: data.customerPO,
            idempotencyKey: data.idempotencyKey,
        }, request.auth.uid));
    }
    catch (err) {
        throw mapCommandError(err);
    }
});
//# sourceMappingURL=createSalesOrderFromOpportunity.js.map