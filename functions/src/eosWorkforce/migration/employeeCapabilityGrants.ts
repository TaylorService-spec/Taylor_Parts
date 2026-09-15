// The Employee capability GRANT set -- delivered through the EXISTING governed grant mechanism.
//
// Who holds a capability is declared in the Role catalog (access/compatibilityRoles.ts, access/governedBusinessRoles.ts)
// and reconciled into eos_policy.role_capabilities by the operator grant tool
// (eosOps/migration/inventoryCapabilityGrantMigration.ts reconcile, dry run by default). This module names only WHICH
// keys the Employee runtime needs reconciled; it lists no Role. Never a migration INSERT, never a request-time
// inference from a legacy Security Role string.
//
// With the catalog as it stands (Owner ruling A), the derivation yields exactly:
//   employee.record.read          admin (whole-catalog composition), owner (spreads admin), generalManager (declared)
//   admin.principalAccess.read    admin, owner
//   admin.employeeProfile.write   admin, owner
// functions/test/employeeProfileAuthority.test.mjs pins that set, so a Role gaining one of these ids is a reviewed diff.
import type { Pool } from "pg";
import { reconcileInventoryCapabilityGrants, type ReconcileReport } from "../../eosOps/migration/inventoryCapabilityGrantMigration";

export const EMPLOYEE_CAPABILITY_GRANT_KEYS = Object.freeze([
  "employee.record.read",
  "admin.principalAccess.read",
  "admin.employeeProfile.write",
] as const);

export function reconcileEmployeeCapabilityGrants(
  pool: Pool,
  options: { readonly tenantId: string; readonly apply?: boolean; readonly actor: string },
): Promise<ReconcileReport> {
  return reconcileInventoryCapabilityGrants(pool, { ...options, capabilityKeys: EMPLOYEE_CAPABILITY_GRANT_KEYS });
}
