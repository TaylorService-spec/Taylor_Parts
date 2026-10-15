"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.REORDER_WAREHOUSE_AUTHORITY_REASON = void 0;
exports.reorderWarehouseOptionLabel = reorderWarehouseOptionLabel;
exports.loadReorderWarehouseAuthority = loadReorderWarehouseAuthority;
const compatibilityRoles_1 = require("../access/compatibilityRoles");
const governedBusinessRoles_1 = require("../access/governedBusinessRoles");
const resolveEffectivePermission_1 = require("../access/resolveEffectivePermission");
const environmentCapabilityOverrides_1 = require("../access/environmentCapabilityOverrides");
const compactClaims_1 = require("../access/compactClaims");
const operationalRoleContext_1 = require("../access/operationalRoleContext");
const USERS = "users";
const ROLE_ASSIGNMENTS = "roleAssignments";
/** Label resolution, with the document id as the last resort -- the same fallback the Receiving
 *  option service and the client's warehouses view already use. A blank or non-string name is not an
 *  error; it is a warehouse nobody has named yet. */
function reorderWarehouseOptionLabel(name, warehouseId) {
    return typeof name === "string" && name.trim().length > 0 ? name.trim() : warehouseId;
}
/** Why a principal's list came back empty. Reported to the caller, never used to decide anything --
 *  the decision is `allows`. "You may not do this" and "you may, but no warehouse is governed to
 *  you" are different sentences and a UI should be able to tell them apart. */
exports.REORDER_WAREHOUSE_AUTHORITY_REASON = {
    /** At least one warehouse resolved ALLOW. */
    GOVERNED_ASSIGNMENT: "GOVERNED_ASSIGNMENT",
    /** The principal's state loaded, but no warehouse resolved ALLOW. */
    NO_GOVERNED_WAREHOUSE_AUTHORITY: "NO_GOVERNED_WAREHOUSE_AUTHORITY",
    /** A read failed. Fail-closed, and distinguishable from a genuine empty scope. */
    AUTHORITY_UNRESOLVED: "AUTHORITY_UNRESOLVED",
};
const DENY_ALL = Object.freeze({
    allows: () => false,
    reason: exports.REORDER_WAREHOUSE_AUTHORITY_REASON.AUTHORITY_UNRESOLVED,
});
/** Every Role the resolver may match. The same union the effective-access feed resolves against --
 *  compatibility Roles carry admin/dispatcher's global authority, governed Roles carry the
 *  manager authority R-32 moved onto them. */
function allRoles() {
    return { ...compatibilityRoles_1.COMPATIBILITY_ROLES, ...governedBusinessRoles_1.GOVERNED_BUSINESS_ROLES };
}
/**
 * Load the principal's governed state ONCE, and return the predicate both consumers share.
 *
 * Reads: `users/{uid}` (authoritative accessVersion + employee link), the principal's ACTIVE
 * `roleAssignments`, and -- only when a candidate employee link exists -- one `employees/{id}` for
 * the operational-role condition resolver. Deliberately OUTSIDE any transaction: warehouse status
 * is read transactionally by the create because a concurrent deactivation must conflict the commit,
 * but a principal's own role assignment changing mid-command is not that kind of hazard, and paying
 * for it in every transaction would be cost without a failure mode to prevent.
 *
 * The operational-role resolver is supplied even though no Role conditions
 * `reorder.request.create.manual` after R-32 moved the manager grants onto unconditioned governed
 * Roles. Supplying it costs one read that is already being made for the employee link and means a
 * future Condition on this binding resolves correctly instead of silently denying -- the exact
 * defect Wave 7 PART 4 had to correct in the effective-access feed.
 */
async function loadReorderWarehouseAuthority(db, uid, capabilityId) {
    try {
        const [userSnap, assignmentsSnap] = await Promise.all([
            db.collection(USERS).doc(uid).get(),
            db.collection(ROLE_ASSIGNMENTS).where("principalUid", "==", uid).where("status", "==", "active").get(),
        ]);
        const userData = userSnap.exists ? userSnap.data() : undefined;
        const rawVersion = userData?.accessVersion;
        let accessVersion = 0;
        if (rawVersion !== undefined && rawVersion !== null) {
            // Malformed access data is a denial, never a default -- treating it as 0 would silently
            // qualify assignments that the real version would have aged out.
            if (!(0, compactClaims_1.isValidAccessVersionValue)(rawVersion))
                return DENY_ALL;
            accessVersion = rawVersion;
        }
        const assignments = assignmentsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const operationalRoleActive = await (0, operationalRoleContext_1.buildOperationalRoleActiveResolverFromEmployeeId)(db, uid, userData?.employeeId);
        const roles = allRoles();
        const activationOverrides = (0, environmentCapabilityOverrides_1.resolveRuntimeCapabilityOverrides)();
        const allows = (warehouseId) => {
            if (typeof warehouseId !== "string" || warehouseId.trim().length === 0)
                return false;
            return ((0, resolveEffectivePermission_1.resolveEffectivePermission)({
                permissionId: capabilityId,
                assignments,
                roles,
                currentAccessVersion: accessVersion,
                target: {
                    scope: { type: "location", value: warehouseId.trim() },
                    condition: { operationalRoleActive },
                },
                activationOverrides,
            }).decision === "ALLOW");
        };
        return { allows, reason: exports.REORDER_WAREHOUSE_AUTHORITY_REASON.NO_GOVERNED_WAREHOUSE_AUTHORITY };
    }
    catch (err) {
        console.error("[reorder] warehouse authority resolution failed", err);
        return DENY_ALL;
    }
}
//# sourceMappingURL=reorderWarehouseAuthority.js.map