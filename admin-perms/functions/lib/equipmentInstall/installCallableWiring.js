"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeResolveInstallPermissionThroughTxn = makeResolveInstallPermissionThroughTxn;
exports.stageInstallAuditEvent = stageInstallAuditEvent;
const resolveEffectivePermission_js_1 = require("../access/resolveEffectivePermission.js");
const compatibilityRoles_js_1 = require("../access/compatibilityRoles.js");
const governedBusinessRoles_js_1 = require("../access/governedBusinessRoles.js");
const environmentCapabilityOverrides_js_1 = require("../access/environmentCapabilityOverrides.js");
const compactClaims_js_1 = require("../access/compactClaims.js");
const auditEventWriter_js_1 = require("../access/auditEventWriter.js");
const USERS_COLLECTION = "users";
const ROLE_ASSIGNMENTS_COLLECTION = "roleAssignments";
const GLOBAL_TARGET = { scope: { type: "global" }, condition: {} };
const INSTALL_ROLE_CATALOG = { ...compatibilityRoles_js_1.COMPATIBILITY_ROLES, ...governedBusinessRoles_js_1.GOVERNED_BUSINESS_ROLES };
// Read THROUGH the transaction so a concurrent revocation conflicts the commit rather than being
// missed. equipment.install is registered active:false, so this denies for everyone until the
// environment activates it AND a Role grant exists -- both, never either.
function makeResolveInstallPermissionThroughTxn(capability) {
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
            roles: INSTALL_ROLE_CATALOG,
            currentAccessVersion: accessVersion,
            target: GLOBAL_TARGET,
            activationOverrides: (0, environmentCapabilityOverrides_js_1.resolveRuntimeCapabilityOverrides)(),
        });
        return result.decision === "ALLOW";
    };
}
// One audit event per installation, carrying what the act actually did -- including where the unit
// came from, which is the only record of its prior custody once the asset is INSTALLED.
function stageInstallAuditEvent(txn, a) {
    // The origin is named in the summary as well as carried structurally. An audit line somebody reads
    // during an investigation should say which Work Order discharged the installation without their
    // having to join two collections to find out.
    const origin = a.sourceContext?.kind === "WORK_ORDER"
        ? ` discharging work order ${a.sourceContext.workOrderId}`
        : "";
    const summary = `installSerializedAsset ${a.serializedAssetId} (serial ${a.serialNo}) `
        + `from ${a.priorState}@${a.priorLocationId} -> equipment ${a.equipmentId} `
        + `for account ${a.accountId} at ${a.locationId}${origin}`;
    (0, auditEventWriter_js_1.stageAuditEvent)(txn, {
        actorUid: a.actorId,
        action: "installSerializedAsset",
        targetType: "equipment",
        targetId: a.equipmentId,
        outcome: "applied",
        summary: summary.slice(0, 500),
    });
}
//# sourceMappingURL=installCallableWiring.js.map