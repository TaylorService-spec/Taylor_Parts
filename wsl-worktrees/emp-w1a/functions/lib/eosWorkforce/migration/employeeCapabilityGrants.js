"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EMPLOYEE_CAPABILITY_GRANT_KEYS = void 0;
exports.reconcileEmployeeCapabilityGrants = reconcileEmployeeCapabilityGrants;
const inventoryCapabilityGrantMigration_1 = require("../../eosOps/migration/inventoryCapabilityGrantMigration");
exports.EMPLOYEE_CAPABILITY_GRANT_KEYS = Object.freeze([
    "employee.record.read",
    "admin.principalAccess.read",
    "admin.employeeProfile.write",
]);
function reconcileEmployeeCapabilityGrants(pool, options) {
    return (0, inventoryCapabilityGrantMigration_1.reconcileInventoryCapabilityGrants)(pool, { ...options, capabilityKeys: exports.EMPLOYEE_CAPABILITY_GRANT_KEYS });
}
//# sourceMappingURL=employeeCapabilityGrants.js.map