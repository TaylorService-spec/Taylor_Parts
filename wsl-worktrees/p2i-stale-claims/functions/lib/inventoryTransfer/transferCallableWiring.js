"use strict";
// Enterprise Inventory Phase 4 -- the REAL production seams the transfer callables wire into the
// merged services. Mirrors receivingCallableWiring.ts. Nothing here is granted -- this module wires
// seams, it does not confer authority. The capabilities themselves are registered `active: false` and,
// measured 2026-09-12, ARE granted: inventoryTransferOperator holds all four ids and
// inventoryTransferReceiver holds `inventory.transfer.receive` (../access/governedBusinessRoles.ts),
// and all four are ACTIVATED in platform-sandbox (config/environments.json). Production neither
// activates nor grants them; where the capability is not activated the governed resolver denies every
// principal regardless of grant.
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeResolveTransferPermissionThroughTxn = makeResolveTransferPermissionThroughTxn;
exports.resolveTransferPartThroughTxn = resolveTransferPartThroughTxn;
exports.stageTransferAuditEvent = stageTransferAuditEvent;
const resolveEffectivePermission_js_1 = require("../access/resolveEffectivePermission.js");
const environmentCapabilityOverrides_js_1 = require("../access/environmentCapabilityOverrides.js");
const compatibilityRoles_js_1 = require("../access/compatibilityRoles.js");
const compactClaims_js_1 = require("../access/compactClaims.js");
const governedBusinessRoles_js_1 = require("../access/governedBusinessRoles.js");
const auditEventWriter_js_1 = require("../access/auditEventWriter.js");
const partMasterRepository_js_1 = require("../partMaster/partMasterRepository.js");
const controlTypeTrackingMode_js_1 = require("../partMaster/controlTypeTrackingMode.js");
const USERS_COLLECTION = "users";
const ROLE_ASSIGNMENTS_COLLECTION = "roleAssignments";
const GLOBAL_TARGET = { scope: { type: "global" }, condition: {} };
const TRANSFER_ROLE_CATALOG = { ...compatibilityRoles_js_1.COMPATIBILITY_ROLES, ...governedBusinessRoles_js_1.GOVERNED_BUSINESS_ROLES };
function makeResolveTransferPermissionThroughTxn(capability) {
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
            roles: TRANSFER_ROLE_CATALOG,
            currentAccessVersion: accessVersion,
            target: GLOBAL_TARGET,
            // PER-ENVIRONMENT ACTIVATION. Every inventory.transfer.* id is registered active:false, which the
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
async function resolveTransferPartThroughTxn(txn, db, partId) {
    const stored = await (0, partMasterRepository_js_1.buildFirestorePartRepository)(db).getById(txn, partId);
    if (!stored)
        return null;
    return {
        partId: stored.part.partId,
        trackingMode: (0, controlTypeTrackingMode_js_1.controlTypeToTrackingMode)(stored.part.controlType),
        active: stored.part.status === "ACTIVE",
    };
}
function stageTransferAuditEvent(txn, a) {
    const serials = typeof a.serialCount === "number" ? `, ${a.serialCount} serial(s)` : "";
    const summary = `${a.action} qty ${a.quantity} of part ${a.partId}: ${a.origin.type}:${a.origin.locationId} -> ${a.destination.type}:${a.destination.locationId}${serials}`.slice(0, 500);
    (0, auditEventWriter_js_1.stageAuditEvent)(txn, {
        actorUid: a.actorId,
        action: a.action,
        targetType: "transferOrder",
        targetId: a.transferOrderId,
        outcome: "applied",
        summary,
    });
}
//# sourceMappingURL=transferCallableWiring.js.map