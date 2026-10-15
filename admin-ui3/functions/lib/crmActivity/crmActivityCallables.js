"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCrmActivity = exports.CRM_ACTIVITY_CREATE_CAPABILITY = void 0;
exports.persistCreatedCrmActivity = persistCreatedCrmActivity;
// CRM Activity / Notes — governed CREATE callable (Taylor EOS Wave 7 extension, PART 1.4). Thin onCall
// adapter over the PURE command core (crmActivityCommands.ts). Follows the #226/#325 established pattern
// used by functions/src/salesOrder/salesOrderCallables.ts exactly:
//   • actor identity from request.auth.uid (NEVER trusted from the payload);
//   • authorization = capability `crm.activity.create`, resolved fail-closed via the trusted
//     effective-access feed; registered active:false (permissionCatalog.ts) => hard DENY for everyone
//     until a separate Owner grant AND per-environment activation;
//   • ONE transaction containing the business write + an Audit Event (createCrmActivity), staged together
//     so a single commit/abort covers both;
//   • idempotency-keyed: a deterministic Audit Event id (same mkAuditId shape as salesOrderCallables.ts's
//     own) is the "already applied" source of truth -- a replayed call returns the PRIOR activityId,
//     never a duplicate write;
//   • writes go to the `crm_activities` collection via the Admin SDK; firestore.rules has NO match block
//     for this collection (default deny), so this trusted command is the only write path.
// EXPORT != DEPLOY, REGISTER != GRANT.
const node_crypto_1 = require("node:crypto");
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const effectiveAccessFeed_1 = require("../access/effectiveAccessFeed");
const auditEventWriter_1 = require("../access/auditEventWriter");
const collections_1 = require("../constants/collections");
const crmActivityCommands_1 = require("./crmActivityCommands");
exports.CRM_ACTIVITY_CREATE_CAPABILITY = "crm.activity.create";
// Same deterministic Audit Event id builder as salesOrderCallables.ts's own mkAuditId -- a retried call
// with the same actorUid + idempotencyKey resolves to the SAME Audit Event document id, so the
// transactional existence check below is the single source of truth for "was this exact call already
// applied." NOT scoped by accountId/targetId on purpose (mirrors the precedent exactly) -- callers
// (hooks/useCrmActivityActions.js) own generating a FRESH key per user intent and must never reuse a
// stale key across a different account/activity, exactly as useSalesOrderActions.js's own header comment
// documents for its transition keys.
const mkAuditId = (action, actorUid, key) => `${action}_${(0, node_crypto_1.createHash)("sha256").update(`${actorUid}|${key}`).digest("hex").slice(0, 40)}`;
function mapCommandError(err) {
    if (err instanceof https_1.HttpsError)
        return err;
    if (err instanceof crmActivityCommands_1.CrmActivityCommandError)
        return new https_1.HttpsError("invalid-argument", err.message);
    return new https_1.HttpsError("internal", "CRM Activity command failed.");
}
// Transactional core of createCrmActivity, exported so tests can exercise the write + idempotency
// invariant directly -- BELOW the capability gate, exactly the established pattern
// (salesOrderCallables.ts's own persistCreatedSalesOrder / persistTransitionedSalesOrder): crm.activity.
// create is registered active:false, a hard deny for everyone until a separate Owner grant, so testing
// the onCall wrapper's happy path would require activating a capability this PR does not authorize.
async function persistCreatedCrmActivity(db, tx, built, actorUid, idempotencyKey) {
    const aid = mkAuditId("createCrmActivity", actorUid, idempotencyKey);
    const prior = await tx.get((0, auditEventWriter_1.auditEventDocRef)(aid));
    if (prior.exists) {
        return { success: true, replayed: true, activityId: (prior.data() ?? {}).targetId ?? null };
    }
    const ref = db.collection(collections_1.CRM_ACTIVITIES_COLLECTION).doc();
    const { createdAtMillis: _createdAtMillis, ...fields } = built;
    // createdAt is the server-authoritative provenance clock (FieldValue.serverTimestamp()) -- distinct
    // from occurredAtMillis (a caller-supplied business fact, carried through in `fields` unchanged). See
    // crmActivityCommands.ts's BuiltCrmActivity doc comment for the full occurredAt-vs-createdAt contract.
    tx.set(ref, { ...fields, createdAt: firestore_1.FieldValue.serverTimestamp() });
    (0, auditEventWriter_1.stageAuditEventWithId)(tx, aid, {
        actorUid,
        action: "createCrmActivity",
        targetType: "crmActivity",
        targetId: ref.id,
        outcome: "applied",
        summary: `created ${built.type} activity for account ${built.accountId}`,
    });
    return { success: true, replayed: false, activityId: ref.id };
}
async function requireCrmActivityCreate(uid) {
    let allowed = false;
    try {
        const { decisions } = await (0, effectiveAccessFeed_1.resolveEffectiveAccess)({ principalUid: uid, permissionIds: [exports.CRM_ACTIVITY_CREATE_CAPABILITY] });
        allowed = decisions[exports.CRM_ACTIVITY_CREATE_CAPABILITY] === true;
    }
    catch (err) {
        console.error(`[requireCrmActivityCreate] capability resolution failed for ${exports.CRM_ACTIVITY_CREATE_CAPABILITY}`, err);
        allowed = false; // fail closed
    }
    if (!allowed)
        throw new https_1.HttpsError("permission-denied", "You are not authorized to create CRM Activities.");
}
exports.createCrmActivity = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    await requireCrmActivityCreate(request.auth.uid);
    const data = (request.data ?? {});
    if (typeof data.idempotencyKey !== "string" || data.idempotencyKey.trim().length === 0) {
        throw new https_1.HttpsError("invalid-argument", "idempotencyKey is required.");
    }
    let built;
    try {
        built = (0, crmActivityCommands_1.buildCreateCrmActivity)(data, { actorUid: request.auth.uid, nowMillis: Date.now() });
    }
    catch (err) {
        throw mapCommandError(err);
    }
    const db = (0, firestore_1.getFirestore)();
    return db.runTransaction((tx) => persistCreatedCrmActivity(db, tx, built, request.auth.uid, data.idempotencyKey));
});
//# sourceMappingURL=crmActivityCallables.js.map