"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EMPLOYEE_CAPABILITY_GRANT_KEYS = void 0;
exports.reconcileEmployeeCapabilityGrants = reconcileEmployeeCapabilityGrants;
const inventoryCapabilityGrantMigration_1 = require("../../eosOps/migration/inventoryCapabilityGrantMigration");
exports.EMPLOYEE_CAPABILITY_GRANT_KEYS = Object.freeze([
    "employee.record.read",
    "admin.principalAccess.read",
    "admin.employeeProfile.write",
    "admin.employeeJobRole.write",
    // The operationalRoles decomposition's two narrow Administration capabilities (Owner ruling 2026-09-17). Listing a
    // key here does NOT decide who holds it: the holders are DERIVED from the Role catalog, and the derivation yields
    // admin and owner only -- never a manager, never an operational Role, and never a Job Role.
    "admin.employeeWorkEligibility.write",
    "admin.employeeOperationalScope.write",
]);
function reconcileEmployeeCapabilityGrants(pool, options) {
    return (0, inventoryCapabilityGrantMigration_1.reconcileInventoryCapabilityGrants)(pool, { ...options, capabilityKeys: exports.EMPLOYEE_CAPABILITY_GRANT_KEYS });
}
//# sourceMappingURL=employeeCapabilityGrants.js.map