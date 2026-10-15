"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeResolveAcquirePermissionThroughTxn = makeResolveAcquirePermissionThroughTxn;
exports.resolveAcquirePartThroughTxn = resolveAcquirePartThroughTxn;
exports.makeResolveAcquireLocationActive = makeResolveAcquireLocationActive;
exports.stageAcquireAuditEvent = stageAcquireAuditEvent;
const resolveEffectivePermission_js_1 = require("../access/resolveEffectivePermission.js");
const compatibilityRoles_js_1 = require("../access/compatibilityRoles.js");
const governedBusinessRoles_js_1 = require("../access/governedBusinessRoles.js");
const environmentCapabilityOverrides_js_1 = require("../access/environmentCapabilityOverrides.js");
const compactClaims_js_1 = require("../access/compactClaims.js");
const auditEventWriter_js_1 = require("../access/auditEventWriter.js");
const receivingLocationResolver_js_1 = require("../inventoryReceiving/receivingLocationResolver.js");
const receivingCallableWiring_js_1 = require("../inventoryReceiving/receivingCallableWiring.js");
const USERS_COLLECTION = "users";
const ROLE_ASSIGNMENTS_COLLECTION = "roleAssignments";
const GLOBAL_TARGET = { scope: { type: "global" }, condition: {} };
const ACQUIRE_ROLE_CATALOG = { ...compatibilityRoles_js_1.COMPATIBILITY_ROLES, ...governedBusinessRoles_js_1.GOVERNED_BUSINESS_ROLES };
function makeResolveAcquirePermissionThroughTxn(capability) {
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
            roles: ACQUIRE_ROLE_CATALOG,
            currentAccessVersion: accessVersion,
            target: GLOBAL_TARGET,
            activationOverrides: (0, environmentCapabilityOverrides_js_1.resolveRuntimeCapabilityOverrides)(),
        });
        return result.decision === "ALLOW";
    };
}
// The Part authority receiving already uses, adapted to this command's shape. Reusing it is what
// guarantees "SERIAL" means the same thing on both paths.
async function resolveAcquirePartThroughTxn(txn, db, partId) {
    return (0, receivingCallableWiring_js_1.resolveReceivePartThroughTxn)(txn, db, partId);
}
// A company location, resolved by the governed-warehouse validator receiving uses. A customer's
// location can never satisfy it, which is the property that matters here: a unit is not installed
// merely by being acquired.
function makeResolveAcquireLocationActive(db) {
    const resolveWarehouse = (0, receivingLocationResolver_js_1.makeResolveWarehouseLocationActive)(db);
    return async function resolveLocationActive(txn, locationId) {
        return resolveWarehouse(txn, { type: "WAREHOUSE", locationId });
    };
}
// Distinguishable from a receipt at a glance, and in a query.
function stageAcquireAuditEvent(txn, a) {
    const note = a.provenanceNote ? ` -- ${a.provenanceNote}` : "";
    const summary = `acquireSerializedAsset ${a.serialNo} (part ${a.partId}) into ${a.locationId} `
        + `as ${a.reason}, no purchase order${note}`;
    (0, auditEventWriter_js_1.stageAuditEvent)(txn, {
        actorUid: a.actorId,
        action: "acquireSerializedAsset",
        targetType: "serializedAsset",
        targetId: a.serializedAssetId,
        outcome: "applied",
        summary: summary.slice(0, 500),
    });
}
//# sourceMappingURL=acquireCallableWiring.js.map