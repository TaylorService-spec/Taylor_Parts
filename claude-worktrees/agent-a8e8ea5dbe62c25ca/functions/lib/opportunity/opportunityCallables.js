"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.transitionOpportunity = exports.createOpportunity = exports.OPPORTUNITY_WRITE_CAPABILITY = void 0;
exports.persistCreatedOpportunity = persistCreatedOpportunity;
exports.persistTransitionedOpportunity = persistTransitionedOpportunity;
// Sales Opportunity — governed WRITE callables (Cycle 3). Thin onCall adapters over the PURE command core
// (opportunityCommands.ts) + lifecycle authority (opportunityLifecycle.ts). They supply ONLY I/O + auth:
//
//   • actor identity comes from request.auth.uid (never trusted from the payload);
//   • authorization is the governed capability `opportunity.write`, resolved fail-closed through the trusted
//     effective-access feed — NOT a role/UI/device check. The capability is registered active:false in the
//     permission catalog, so it is a hard DENY for every principal until a SEPARATE Owner grant;
//   • writes go to the `opportunities` collection via the Admin SDK; firestore.rules denies ALL direct client
//     access to that collection (Admin-SDK-only), so the trusted command is the only write path.
//
// EXPORT != DEPLOY, REGISTER != GRANT. These are exported for build/test only; nothing runs in production
// until a separate deploy + capability grant, each its own Owner-authorized action. Opportunity is
// PRE-COMMITMENT: these commands never create inventory movement, Work Orders, or invoices.
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const node_crypto_1 = require("node:crypto");
const effectiveAccessFeed_1 = require("../access/effectiveAccessFeed");
const auditEventWriter_1 = require("../access/auditEventWriter");
const collections_1 = require("../constants/collections");
const opportunityCommands_1 = require("./opportunityCommands");
const opportunityLifecycle_1 = require("./opportunityLifecycle");
exports.OPPORTUNITY_WRITE_CAPABILITY = "opportunity.write";
// Shared deterministic Audit Event id builder (same shape as coverageCallables.ts's mkAuditId): a retried
// call with the same actorUid + idempotencyKey resolves to the SAME Audit Event document id, so the
// transactional existence check below is the single source of truth for "was this exact call already applied."
const mkAuditId = (action, actorUid, key) => `${action}_${(0, node_crypto_1.createHash)("sha256").update(`${actorUid}|${key}`).digest("hex").slice(0, 40)}`;
// Map the pure command's error code onto the right HttpsError. Bad payloads are invalid-argument; governed
// precondition failures (already closed / illegal transition / outcome gate) are failed-precondition.
function mapCommandError(err) {
    if (err instanceof https_1.HttpsError)
        return err;
    if (err instanceof opportunityCommands_1.OpportunityCommandError) {
        switch (err.code) {
            case "ALREADY_CLOSED":
            case "ILLEGAL_TRANSITION":
            case "OUTCOME_REQUIRES_DECISION":
            case "NO_LINES":
            case "LINE_QTY_REQUIRED_FOR_WON":
                return new https_1.HttpsError("failed-precondition", err.message);
            default:
                return new https_1.HttpsError("invalid-argument", err.message);
        }
    }
    return new https_1.HttpsError("internal", "Opportunity command failed.");
}
async function persistCreatedOpportunity(db, tx, built, actorUid, idempotencyKey) {
    const aid = idempotencyKey ? mkAuditId("createOpportunity", actorUid, idempotencyKey) : null;
    const { createdAtMillis: _c, updatedAtMillis: _u, ...fields } = built;
    if (aid) {
        const prior = await tx.get((0, auditEventWriter_1.auditEventDocRef)(aid));
        if (prior.exists)
            return { success: true, replayed: true, opportunityId: (prior.data() ?? {}).targetId ?? null, stage: built.stage };
    }
    const ref = db.collection(collections_1.OPPORTUNITIES_COLLECTION).doc();
    tx.set(ref, { ...fields, createdAt: firestore_1.FieldValue.serverTimestamp(), updatedAt: firestore_1.FieldValue.serverTimestamp() });
    if (aid)
        (0, auditEventWriter_1.stageAuditEventWithId)(tx, aid, { actorUid, action: "createOpportunity", targetType: "opportunity", targetId: ref.id, outcome: "applied", summary: `created opportunity for account ${built.accountId}` });
    return { success: true, replayed: false, opportunityId: ref.id, stage: built.stage };
}
// Transactional core of transitionOpportunity, exported so tests can exercise the idempotency invariant
// directly (below the capability gate — opportunity.write is registered active:false, a hard deny for
// everyone until a separate Owner grant), exactly the pattern persistCreatedOpportunity already established.
async function persistTransitionedOpportunity(db, tx, ref, opportunityId, intent, actorUid, idempotencyKey) {
    const aid = mkAuditId("transitionOpportunity", actorUid, idempotencyKey);
    const prior = await tx.get((0, auditEventWriter_1.auditEventDocRef)(aid));
    const snap = await tx.get(ref);
    if (!snap.exists)
        throw new https_1.HttpsError("not-found", `No Opportunity with id ${opportunityId}`);
    const current = snap.data();
    if (prior.exists) {
        return { success: true, replayed: true, opportunityId, stage: current.stage, outcome: current.outcome };
    }
    const patch = (0, opportunityCommands_1.buildTransitionPatch)(current, intent, { actorUid, nowMillis: Date.now() });
    const { updatedAtMillis: _u, closedAtMillis, ...rest } = patch;
    tx.update(ref, {
        ...rest,
        ...(closedAtMillis != null ? { closedAt: firestore_1.FieldValue.serverTimestamp() } : {}),
        updatedAt: firestore_1.FieldValue.serverTimestamp(),
    });
    (0, auditEventWriter_1.stageAuditEventWithId)(tx, aid, {
        actorUid,
        action: "transitionOpportunity",
        targetType: "opportunity",
        targetId: opportunityId,
        outcome: "applied",
        summary: `transitioned opportunity ${opportunityId} to stage ${patch.stage}`,
    });
    return { success: true, replayed: false, opportunityId, stage: patch.stage, outcome: patch.outcome };
}
async function requireOpportunityWrite(uid) {
    let allowed = false;
    try {
        const { decisions } = await (0, effectiveAccessFeed_1.resolveEffectiveAccess)({
            principalUid: uid,
            permissionIds: [exports.OPPORTUNITY_WRITE_CAPABILITY],
        });
        allowed = decisions[exports.OPPORTUNITY_WRITE_CAPABILITY] === true;
    }
    catch {
        allowed = false; // a throwing resolver is a denial, never an allow
    }
    if (!allowed)
        throw new https_1.HttpsError("permission-denied", "You are not authorized to write Opportunities.");
}
// Create a new Opportunity (always starts IDENTIFIED, open). Product-level lines only; a serialized-asset
// line is rejected by the pure builder.
exports.createOpportunity = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    await requireOpportunityWrite(request.auth.uid);
    const data = (request.data ?? {});
    if (data.idempotencyKey !== undefined && (typeof data.idempotencyKey !== "string" || data.idempotencyKey.trim().length === 0)) {
        throw new https_1.HttpsError("invalid-argument", "idempotencyKey, when provided, must be a non-empty string.");
    }
    let built;
    try {
        built = (0, opportunityCommands_1.buildCreateOpportunity)(data, {
            actorUid: request.auth.uid,
            nowMillis: Date.now(),
        });
    }
    catch (err) {
        throw mapCommandError(err);
    }
    const db = (0, firestore_1.getFirestore)();
    return db.runTransaction((tx) => persistCreatedOpportunity(db, tx, built, request.auth.uid, data.idempotencyKey));
});
// Advance an Opportunity one stage, or set its outcome (WON from DECISION, LOST from any open stage). Legality
// is enforced by the pure transition authority; illegal transitions fail closed.
//
// Idempotency (site-work r3 item G): a retried ADVANCE/OUTCOME call — client timeout retry, double-tap — must
// never apply twice. Mirrors createOpportunity's guard precisely: a REQUIRED idempotencyKey resolves to a
// deterministic Audit Event id (mkAuditId), staged atomically with the state mutation in the SAME transaction.
// A duplicate call finds that Audit Event already exists and returns `replayed:true` with the Opportunity's
// CURRENT stage/outcome instead of recomputing and reapplying the transition.
exports.transitionOpportunity = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    await requireOpportunityWrite(request.auth.uid);
    const data = (request.data ?? {});
    if (typeof data.opportunityId !== "string" || data.opportunityId.trim().length === 0) {
        throw new https_1.HttpsError("invalid-argument", "opportunityId is required.");
    }
    if (typeof data.idempotencyKey !== "string" || data.idempotencyKey.trim().length === 0) {
        throw new https_1.HttpsError("invalid-argument", "idempotencyKey is required.");
    }
    // Exactly one intent: advance to a stage, OR set an outcome.
    const hasStage = data.toStage !== undefined;
    const hasOutcome = data.outcome !== undefined;
    if (hasStage === hasOutcome) {
        throw new https_1.HttpsError("invalid-argument", "Provide exactly one of toStage or outcome.");
    }
    let intent;
    if (hasStage) {
        if (!(0, opportunityLifecycle_1.isStage)(data.toStage))
            throw new https_1.HttpsError("invalid-argument", "toStage is not a valid stage.");
        intent = { kind: "ADVANCE", toStage: data.toStage };
    }
    else {
        if (!(0, opportunityLifecycle_1.isOutcome)(data.outcome))
            throw new https_1.HttpsError("invalid-argument", "outcome must be WON or LOST.");
        intent = { kind: "OUTCOME", outcome: data.outcome };
    }
    const actorUid = request.auth.uid;
    const db = (0, firestore_1.getFirestore)();
    const ref = db.collection(collections_1.OPPORTUNITIES_COLLECTION).doc(data.opportunityId);
    try {
        return await db.runTransaction((tx) => persistTransitionedOpportunity(db, tx, ref, data.opportunityId, intent, actorUid, data.idempotencyKey));
    }
    catch (err) {
        throw mapCommandError(err);
    }
});
//# sourceMappingURL=opportunityCallables.js.map