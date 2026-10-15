"use strict";
// Enterprise Inventory -- Cycle Count operating authority: the REAL production seams the callables wire
// into the merged services. Mirrors transferCallableWiring.ts. Nothing here is granted: every
// inventory.cycleCount.* capability is registered-but-UNGRANTED (active: false, no compatibility Role
// holds it), so the governed resolver denies every principal until a separate grant + activation gate.
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeResolveCycleCountPermissionThroughTxn = makeResolveCycleCountPermissionThroughTxn;
exports.resolveCycleCountPartThroughTxn = resolveCycleCountPartThroughTxn;
exports.stageCycleCountAuditEvent = stageCycleCountAuditEvent;
const resolveEffectivePermission_js_1 = require("../access/resolveEffectivePermission.js");
const environmentCapabilityOverrides_js_1 = require("../access/environmentCapabilityOverrides.js");
const compatibilityRoles_js_1 = require("../access/compatibilityRoles.js");
const compactClaims_js_1 = require("../access/compactClaims.js");
const governedBusinessRoles_js_1 = require("../access/governedBusinessRoles.js");
const auditEventWriter_js_1 = require("../access/auditEventWriter.js");
const partMasterRepository_js_1 = require("../partMaster/partMasterRepository.js");
// THE ONE controlType -> trackingMode mapping. This file carried a byte-identical private copy of it,
// which is exactly the shape that module exists to prevent: two answers to "is this Part counted by
// quantity or by serial", and a Cycle Count line's whole tracking path -- blind serial snapshot versus
// quantity snapshot -- hangs on that answer.
const controlTypeTrackingMode_js_1 = require("../partMaster/controlTypeTrackingMode.js");
const USERS_COLLECTION = "users";
const ROLE_ASSIGNMENTS_COLLECTION = "roleAssignments";
const GLOBAL_TARGET = { scope: { type: "global" }, condition: {} };
const CYCLE_COUNT_ROLE_CATALOG = { ...compatibilityRoles_js_1.COMPATIBILITY_ROLES, ...governedBusinessRoles_js_1.GOVERNED_BUSINESS_ROLES };
function makeResolveCycleCountPermissionThroughTxn(capability) {
    return async function resolve(txn, db, actorId) {
        if (typeof actorId !== "string" || actorId.trim() === "")
            return false;
        const userSnap = await txn.get(db.collection(USERS_COLLECTION).doc(actorId));
        const assignmentsSnap = await txn.get(db.collection(ROLE_ASSIGNMENTS_COLLECTION).where("principalUid", "==", actorId).where("status", "==", "active"));
        let accessVersion = 0;
        if (userSnap.exists) {
            const av = (userSnap.data() ?? {}).accessVersion;
            if (av !== undefined && av !== null) {
                if (!(0, compactClaims_js_1.isValidAccessVersionValue)(av))
                    return false;
                accessVersion = av;
            }
        }
        const assignments = assignmentsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const result = (0, resolveEffectivePermission_js_1.resolveEffectivePermission)({
            permissionId: capability,
            assignments,
            roles: CYCLE_COUNT_ROLE_CATALOG,
            currentAccessVersion: accessVersion,
            target: GLOBAL_TARGET,
            // PER-ENVIRONMENT ACTIVATION. Every inventory.cycleCount.* id is registered active:false, which the
            // resolver treats as an unconditional DENY *ahead of* any Role grant. Without this argument the
            // whole command family was permanently unreachable: a principal could hold the governed Role,
            // the environment could activate the capability, and the resolver would still answer
            // inactivePermission -- authority that could never be exercised by anyone, anywhere.
            //
            // Derived from the runtime's own trusted project identity (GCLOUD_PROJECT), never from client
            // input, and production remains triple-hard-blocked inside resolveCapabilityOverrides().
            activationOverrides: (0, environmentCapabilityOverrides_js_1.resolveRuntimeCapabilityOverrides)(),
        });
        return result.decision === "ALLOW";
    };
}
async function resolveCycleCountPartThroughTxn(txn, db, partId) {
    const stored = await (0, partMasterRepository_js_1.buildFirestorePartRepository)(db).getById(txn, partId);
    if (!stored)
        return null;
    return {
        partId: stored.part.partId,
        trackingMode: (0, controlTypeTrackingMode_js_1.controlTypeToTrackingMode)(stored.part.controlType),
        active: stored.part.status === "ACTIVE",
    };
}
function stageCycleCountAuditEvent(txn, a) {
    const varianceText = a.variance !== undefined
        ? ` variance ${a.variance}`
        : a.serialVariance !== undefined
            ? ` missing ${a.serialVariance.missing.length}, unexpected ${a.serialVariance.unexpected.length}`
            : "";
    const summary = `${a.action} part ${a.partId} at ${a.location.type}:${a.location.locationId}${varianceText}`.slice(0, 500);
    (0, auditEventWriter_js_1.stageAuditEvent)(txn, {
        actorUid: a.actorId,
        action: a.action,
        targetType: "cycleCount",
        targetId: a.cycleCountId,
        outcome: "applied",
        summary,
    });
}
//# sourceMappingURL=cycleCountCallableWiring.js.map