"use strict";
// Enterprise Inventory Phase 4 -- the REAL production seams the transfer callables wire into the
// merged services. Mirrors receivingCallableWiring.ts. Nothing here is granted: every
// inventory.transfer.* capability is registered-but-UNGRANTED (active: false, no compatibility Role
// holds it), so the governed resolver denies every principal until a separate grant + activation gate.
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeResolveTransferPermissionThroughTxn = makeResolveTransferPermissionThroughTxn;
exports.resolveTransferPartThroughTxn = resolveTransferPartThroughTxn;
exports.stageTransferAuditEvent = stageTransferAuditEvent;
const resolveEffectivePermission_js_1 = require("../access/resolveEffectivePermission.js");
const compatibilityRoles_js_1 = require("../access/compatibilityRoles.js");
const compactClaims_js_1 = require("../access/compactClaims.js");
const governedBusinessRoles_js_1 = require("../access/governedBusinessRoles.js");
const auditEventWriter_js_1 = require("../access/auditEventWriter.js");
const partMasterRepository_js_1 = require("../partMaster/partMasterRepository.js");
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
        });
        return result.decision === "ALLOW";
    };
}
function controlTypeToTrackingMode(controlType) {
    switch (controlType) {
        case "STANDARD":
            return "NONE";
        case "SERIALIZED":
            return "SERIAL";
        case "LOT":
            return "LOT";
        default:
            return "LOT";
    }
}
async function resolveTransferPartThroughTxn(txn, db, partId) {
    const stored = await (0, partMasterRepository_js_1.buildFirestorePartRepository)(db).getById(txn, partId);
    if (!stored)
        return null;
    return {
        partId: stored.part.partId,
        trackingMode: controlTypeToTrackingMode(stored.part.controlType),
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