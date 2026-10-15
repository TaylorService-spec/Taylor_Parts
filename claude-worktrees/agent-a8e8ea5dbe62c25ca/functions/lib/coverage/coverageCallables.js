"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCoverageAssignment = exports.createSalesTerritory = exports.COVERAGE_WRITE_CAPABILITY = void 0;
// Commercial Coverage & Territory — governed WRITE callables (capability #15 persistence). Thin onCall adapters
// over the pure command core. Supply only I/O + auth:
//   • actor identity from request.auth.uid;
//   • authorization = capability `coverage.write`, fail-closed via the trusted effective-access feed;
//     registered active:false ⇒ hard DENY until a separate Owner grant;
//   • writes go to `sales_territories` / `commercial_coverage_assignments` via the Admin SDK; firestore.rules
//     denies ALL direct client access; idempotent via a deterministic audit id + append-only AUDIT event.
// Records only — NO precedence/credit/commission. EXPORT != DEPLOY, REGISTER != GRANT, MERGE != ACTIVATION.
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const node_crypto_1 = require("node:crypto");
const effectiveAccessFeed_1 = require("../access/effectiveAccessFeed");
const collections_1 = require("../constants/collections");
const auditEventWriter_1 = require("../access/auditEventWriter");
const coverageCommands_1 = require("./coverageCommands");
exports.COVERAGE_WRITE_CAPABILITY = "coverage.write";
function mapCommandError(err) {
    if (err instanceof https_1.HttpsError)
        return err;
    if (err instanceof coverageCommands_1.CoverageCommandError)
        return new https_1.HttpsError("invalid-argument", err.message);
    return new https_1.HttpsError("internal", "Coverage command failed.");
}
async function requireCoverageWrite(uid) {
    let allowed = false;
    try {
        const { decisions } = await (0, effectiveAccessFeed_1.resolveEffectiveAccess)({ principalUid: uid, permissionIds: [exports.COVERAGE_WRITE_CAPABILITY] });
        allowed = decisions[exports.COVERAGE_WRITE_CAPABILITY] === true;
    }
    catch {
        allowed = false;
    }
    if (!allowed)
        throw new https_1.HttpsError("permission-denied", "You are not authorized to write commercial coverage.");
}
const mkAuditId = (action, actorUid, key) => `${action}_${(0, node_crypto_1.createHash)("sha256").update(`${actorUid}|${key}`).digest("hex").slice(0, 40)}`;
// Create a durable Sales Territory (a coverage object independent of any salesperson).
exports.createSalesTerritory = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    await requireCoverageWrite(request.auth.uid);
    const data = (request.data ?? {});
    if (typeof data.idempotencyKey !== "string" || data.idempotencyKey.trim().length === 0)
        throw new https_1.HttpsError("invalid-argument", "idempotencyKey is required.");
    const actorUid = request.auth.uid;
    const aid = mkAuditId("createSalesTerritory", actorUid, data.idempotencyKey);
    const db = (0, firestore_1.getFirestore)();
    try {
        let record;
        try {
            record = (0, coverageCommands_1.buildTerritory)(data, { nowMillis: Date.now() });
        }
        catch (err) {
            throw mapCommandError(err);
        }
        return await db.runTransaction(async (tx) => {
            const prior = await tx.get((0, auditEventWriter_1.auditEventDocRef)(aid));
            if (prior.exists)
                return { success: true, replayed: true, territoryId: (prior.data() ?? {}).targetId ?? null };
            const ref = db.collection(collections_1.SALES_TERRITORIES_COLLECTION).doc();
            tx.set(ref, { ...record, createdBy: actorUid, createdAt: firestore_1.FieldValue.serverTimestamp() });
            (0, auditEventWriter_1.stageAuditEventWithId)(tx, aid, { actorUid, action: "createSalesTerritory", targetType: "salesTerritory", targetId: ref.id, outcome: "applied", summary: `created ${record.kind} territory ${record.name}` });
            return { success: true, replayed: false, territoryId: ref.id };
        });
    }
    catch (err) {
        throw mapCommandError(err);
    }
});
// Create a Coverage Assignment (a person assigned to a scope, effective-dated). Overlapping/split coverage is
// expected — this never replaces an existing assignment.
exports.createCoverageAssignment = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    await requireCoverageWrite(request.auth.uid);
    const data = (request.data ?? {});
    if (typeof data.idempotencyKey !== "string" || data.idempotencyKey.trim().length === 0)
        throw new https_1.HttpsError("invalid-argument", "idempotencyKey is required.");
    const actorUid = request.auth.uid;
    const aid = mkAuditId("createCoverageAssignment", actorUid, data.idempotencyKey);
    const db = (0, firestore_1.getFirestore)();
    try {
        let record;
        try {
            record = (0, coverageCommands_1.buildCoverageAssignment)(data, { nowMillis: Date.now() });
        }
        catch (err) {
            throw mapCommandError(err);
        }
        return await db.runTransaction(async (tx) => {
            const prior = await tx.get((0, auditEventWriter_1.auditEventDocRef)(aid));
            if (prior.exists)
                return { success: true, replayed: true, assignmentId: (prior.data() ?? {}).targetId ?? null };
            const ref = db.collection(collections_1.COMMERCIAL_COVERAGE_ASSIGNMENTS_COLLECTION).doc();
            tx.set(ref, { ...record, createdBy: actorUid, createdAt: firestore_1.FieldValue.serverTimestamp() });
            (0, auditEventWriter_1.stageAuditEventWithId)(tx, aid, { actorUid, action: "createCoverageAssignment", targetType: "coverageAssignment", targetId: ref.id, outcome: "applied", summary: `assigned ${record.assignee.assignedToEmployeeId} to ${record.scope.kind} coverage (company ${record.companyId})` });
            return { success: true, replayed: false, assignmentId: ref.id };
        });
    }
    catch (err) {
        throw mapCommandError(err);
    }
});
//# sourceMappingURL=coverageCallables.js.map