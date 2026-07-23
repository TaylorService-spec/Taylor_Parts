// Enterprise Access & Administration Platform (Issue #226) -- Row 1a
// acceptance tests for the eight governed business Roles added per
// Owner direction (docs/specifications/enterprise-access-and-
// administration-platform.md §26, docs/implementation-plans/
// enterprise-access-and-administration-platform.md §21).
//
// Dependency-free: plain Node assert against the compiled catalog/
// resolver/Role definitions, no test runner, matching this repo's
// existing pure-logic test convention.
//
// Prerequisite: `npm run build` in functions/ first (imports the
// compiled lib/ output, not the TypeScript source).
import assert from "node:assert/strict";
import { resolveEffectivePermission } from "../lib/access/resolveEffectivePermission.js";
import { COMPATIBILITY_ROLES, ADMIN_ROLE, DISPATCHER_ROLE, TECHNICIAN_ROLE } from "../lib/access/compatibilityRoles.js";
import {
  GOVERNED_BUSINESS_ROLES,
  GENERAL_EMPLOYEE_ROLE,
  OFFICE_MANAGER_ROLE,
  SALES_MANAGER_ROLE,
  ACCOUNTING_MANAGER_ROLE,
  FINANCE_MANAGER_ROLE,
  FIELD_MANAGER_ROLE,
  OPERATIONS_MANAGER_ROLE,
  OWNER_ROLE,
  INVENTORY_CREATE_EXECUTOR_ROLE,
} from "../lib/access/governedBusinessRoles.js";
import { findPermission, PERMISSION_CATALOG } from "../lib/access/permissionCatalog.js";

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS: ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL: ${name}`);
    console.error(err);
  }
}

const ALL_GOVERNED_ROLES = Object.values(GOVERNED_BUSINESS_ROLES);
const EXPECTED_IDS = [
  "generalEmployee",
  "officeManager",
  "salesManager",
  "accountingManager",
  "financeManager",
  "fieldManager",
  "operationsManager",
  "owner",
  "inventoryCreateExecutor",
];

function grant(roleId, roles) {
  return {
    id: `test-${roleId}`,
    principalUid: "test-principal",
    roleId,
    scope: { type: "global" },
    grantedBy: "test",
    grantedAt: { toMillis: () => 0 },
    status: "active",
    accessVersionAtGrant: 1,
  };
}

function resolve(permissionId, roleId, roles) {
  return resolveEffectivePermission({
    permissionId,
    assignments: [grant(roleId, roles)],
    roles,
    currentAccessVersion: 1,
    target: { scope: { type: "global" }, condition: {} },
  });
}

// === Catalog membership: exactly the eight named Roles, no more, no fewer ===

check("GOVERNED_BUSINESS_ROLES contains exactly the nine ids (the eight Owner-directed business Roles + the temporary INV-1 CREATE executor)", () => {
  assert.deepEqual(Object.keys(GOVERNED_BUSINESS_ROLES).sort(), [...EXPECTED_IDS].sort());
  assert.equal(ALL_GOVERNED_ROLES.length, 9);
});

check("every governed business Role's own .id matches its map key", () => {
  for (const [key, role] of Object.entries(GOVERNED_BUSINESS_ROLES)) {
    assert.equal(role.id, key);
  }
});

// === Shape / classification invariants (Spec §26.1) ===

check("every governed business Role is systemSeed:true, compatibility:false", () => {
  for (const role of ALL_GOVERNED_ROLES) {
    assert.equal(role.systemSeed, true, `${role.id} must be systemSeed`);
    assert.equal(role.compatibility, false, `${role.id} must not be a compatibility Role`);
  }
});

check("none of the eight ids collides with a compatibility Role id", () => {
  for (const role of ALL_GOVERNED_ROLES) {
    assert.equal(role.id in COMPATIBILITY_ROLES, false, `${role.id} must not shadow a compatibility Role`);
  }
});

check("every governed business Role has a non-empty name and description", () => {
  for (const role of ALL_GOVERNED_ROLES) {
    assert.ok(role.name && role.name.length > 0, `${role.id} needs a name`);
    assert.ok(role.description && role.description.length > 0, `${role.id} needs a description`);
  }
});

// === Every cited PermissionId is real (Spec §26.2's "existing ids only" rule) ===

check("every Permission id referenced by any governed business Role exists in the catalog", () => {
  for (const role of ALL_GOVERNED_ROLES) {
    for (const permissionId of role.permissions) {
      assert.ok(findPermission(permissionId), `${role.id} references unknown PermissionId "${permissionId}"`);
    }
    for (const permissionId of Object.keys(role.conditionsByPermission ?? {})) {
      assert.ok(role.permissions.includes(permissionId), `${role.id} has a Condition for "${permissionId}" it doesn't grant`);
    }
  }
});

// === Per-role least-privilege assertions (Spec §26.2 matrix) ===

check("General Employee grants nothing", () => {
  assert.deepEqual(GENERAL_EMPLOYEE_ROLE.permissions, []);
  for (const permissionId of ["account.record.read", "workOrder.create", "admin.userStatus.write"]) {
    assert.equal(resolve(permissionId, "generalEmployee", GOVERNED_BUSINESS_ROLES).decision, "DENY");
  }
});

check("Office Manager: Customer read/create/update + Work Order create; no governed-field write, no lifecycle execution, no admin authority", () => {
  for (const id of ["account.record.read", "account.record.create", "account.record.update", "workOrder.create"]) {
    assert.equal(resolve(id, "officeManager", GOVERNED_BUSINESS_ROLES).decision, "ALLOW", id);
  }
  for (const id of ["account.governedField.write", "workOrder.transition", "workOrder.cancel", "admin.roleAssignment.write"]) {
    assert.equal(resolve(id, "officeManager", GOVERNED_BUSINESS_ROLES).decision, "DENY", id);
  }
});

check("Sales Manager: Customer read/create/update only", () => {
  for (const id of ["account.record.read", "account.record.create", "account.record.update"]) {
    assert.equal(resolve(id, "salesManager", GOVERNED_BUSINESS_ROLES).decision, "ALLOW", id);
  }
  assert.equal(resolve("account.governedField.write", "salesManager", GOVERNED_BUSINESS_ROLES).decision, "DENY");
});

check("Accounting Manager: Customer read-only, no governed-field write", () => {
  assert.equal(resolve("account.record.read", "accountingManager", GOVERNED_BUSINESS_ROLES).decision, "ALLOW");
  for (const id of ["account.record.create", "account.record.update", "account.governedField.write"]) {
    assert.equal(resolve(id, "accountingManager", GOVERNED_BUSINESS_ROLES).decision, "DENY", id);
  }
});

check("Finance Manager: Customer read + governed-field write; no ordinary Customer create/update", () => {
  for (const id of ["account.record.read", "account.governedField.write"]) {
    assert.equal(resolve(id, "financeManager", GOVERNED_BUSINESS_ROLES).decision, "ALLOW", id);
  }
  for (const id of ["account.record.create", "account.record.update"]) {
    assert.equal(resolve(id, "financeManager", GOVERNED_BUSINESS_ROLES).decision, "DENY", id);
  }
});

check("Accounting Manager and Finance Manager remain distinct (Owner's explicit requirement)", () => {
  const accountingSet = new Set(ACCOUNTING_MANAGER_ROLE.permissions);
  const financeSet = new Set(FINANCE_MANAGER_ROLE.permissions);
  assert.equal(accountingSet.has("account.governedField.write"), false, "Accounting Manager must not hold the Finance-distinguishing permission");
  assert.equal(financeSet.has("account.governedField.write"), true, "Finance Manager must hold its distinguishing permission");
  assert.notDeepEqual([...accountingSet].sort(), [...financeSet].sort(), "the two Roles' grant sets must not be identical");
});

check("Field Manager: full Work Order lifecycle + field-inventory read; no reorder/purchasing execution", () => {
  for (const id of ["workOrder.create", "workOrder.transition", "workOrder.cancel", "inventory.transaction.read"]) {
    assert.equal(resolve(id, "fieldManager", GOVERNED_BUSINESS_ROLES).decision, "ALLOW", id);
  }
  for (const id of ["reorder.request.assign", "reorder.purchaseOrder.create", "inventory.action.create"]) {
    assert.equal(resolve(id, "fieldManager", GOVERNED_BUSINESS_ROLES).decision, "DENY", id);
  }
});

check("Operations Manager: cross-domain oversight reads + Work Order lifecycle; no role administration, no reorder decisions", () => {
  for (const id of [
    "account.record.read",
    "workOrder.create",
    "workOrder.transition",
    "workOrder.cancel",
    "inventory.transaction.read",
    "inventory.action.read",
    "reorder.request.read.queue",
    "reorder.purchaseOrder.read",
    "warehouse.record.read",
    "warehouse.stockLocation.read",
    "warehouse.transferOrder.read",
  ]) {
    assert.equal(resolve(id, "operationsManager", GOVERNED_BUSINESS_ROLES).decision, "ALLOW", id);
  }
  for (const id of [
    "account.record.create",
    "account.record.update",
    "account.governedField.write",
    "admin.userStatus.write",
    "admin.roleAssignment.write",
    "reorder.request.assign",
    "reorder.request.approve",
    "reorder.request.reject",
    "reorder.request.cancel",
  ]) {
    assert.equal(resolve(id, "operationsManager", GOVERNED_BUSINESS_ROLES).decision, "DENY", id);
  }
});

// === INV-1: temporary CREATE execution capability Role ===

check("Inventory CREATE Executor: grants ONLY inventory.catalog.manage", () => {
  assert.deepEqual(INVENTORY_CREATE_EXECUTOR_ROLE.permissions, ["inventory.catalog.manage"]);
  assert.equal(resolve("inventory.catalog.manage", "inventoryCreateExecutor", GOVERNED_BUSINESS_ROLES).decision, "ALLOW");
});

check("Inventory CREATE Executor: inherits NO other capability (activate, admin, customer, work order, reorder, warehouse)", () => {
  for (const id of [
    "inventory.catalog.activate", // deliberately withheld -- lifecycle is a separate step
    "account.record.read", "account.record.create", "account.governedField.write",
    "workOrder.create", "workOrder.transition", "workOrder.cancel",
    "admin.roleAssignment.write", "admin.userStatus.write",
    "reorder.request.assign", "warehouse.record.read", "inventory.transaction.read",
  ]) {
    assert.equal(resolve(id, "inventoryCreateExecutor", GOVERNED_BUSINESS_ROLES).decision, "DENY", id);
  }
});

check("Inventory CREATE Executor: is privileged (two-approver grant/revoke), systemSeed, non-compatibility", () => {
  assert.equal(INVENTORY_CREATE_EXECUTOR_ROLE.privileged, true);
  assert.equal(INVENTORY_CREATE_EXECUTOR_ROLE.systemSeed, true);
  assert.equal(INVENTORY_CREATE_EXECUTOR_ROLE.compatibility, false);
});

check("without any assignment, inventory.catalog.manage remains DENIED (grant removes access on revoke)", () => {
  const denied = resolveEffectivePermission({
    permissionId: "inventory.catalog.manage",
    assignments: [], // revoked / never granted
    roles: GOVERNED_BUSINESS_ROLES,
    currentAccessVersion: 1,
    target: { scope: { type: "global" }, condition: {} },
  });
  assert.equal(denied.decision, "DENY");
});

check("no OTHER governed business Role grants inventory.catalog.manage (only the temporary executor)", () => {
  for (const [id, role] of Object.entries(GOVERNED_BUSINESS_ROLES)) {
    if (id === "inventoryCreateExecutor") continue;
    assert.equal(resolve("inventory.catalog.manage", id, GOVERNED_BUSINESS_ROLES).decision, "DENY", id);
  }
});

// === Spec §27: the Warehouse permission-catalog gap closure ===

check("the three warehouse.*.read ids exist and are read-only (no create/update/delete id for any of the three collections)", () => {
  for (const id of ["warehouse.record.read", "warehouse.stockLocation.read", "warehouse.transferOrder.read"]) {
    const permission = findPermission(id);
    assert.ok(permission, id);
    assert.equal(permission.action, "read", id);
  }
  for (const resource of ["warehouse.record", "warehouse.stockLocation", "warehouse.transferOrder"]) {
    for (const action of ["create", "update", "delete", "write"]) {
      assert.equal(findPermission(`${resource}.${action}`), undefined, `${resource}.${action} must not exist -- no client-reachable write path`);
    }
  }
});

check("admin and dispatcher both gain the three warehouse ids (additive-only, reproduces their already-existing Rules grant)", () => {
  for (const id of ["warehouse.record.read", "warehouse.stockLocation.read", "warehouse.transferOrder.read"]) {
    for (const roleId of ["admin", "dispatcher"]) {
      assert.equal(resolve(id, roleId, COMPATIBILITY_ROLES).decision, "ALLOW", `${roleId}: ${id}`);
    }
  }
});

check("technician gains none of the three warehouse ids (no operational-role Rules branch exists for this domain -- Spec §27.3/§27.5)", () => {
  for (const id of ["warehouse.record.read", "warehouse.stockLocation.read", "warehouse.transferOrder.read"]) {
    assert.equal(resolve(id, "technician", COMPATIBILITY_ROLES).decision, "DENY", id);
  }
  assert.equal(
    TECHNICIAN_ROLE.permissions.some((id) => id.startsWith("warehouse.")),
    false
  );
});

check("only Operations Manager, among the eight governed business Roles, holds any warehouse.*.read id (Spec §27.4)", () => {
  const warehouseIds = new Set(["warehouse.record.read", "warehouse.stockLocation.read", "warehouse.transferOrder.read"]);
  for (const role of Object.values(GOVERNED_BUSINESS_ROLES)) {
    const holdsAny = role.permissions.some((id) => warehouseIds.has(id));
    if (role.id === "operationsManager") {
      assert.equal(holdsAny, true, "Operations Manager must hold all three");
      for (const id of warehouseIds) assert.ok(role.permissions.includes(id), id);
    } else if (role.id === "owner") {
      // Owner mirrors admin, which (as of this addendum) DOES hold these -- see the dedicated Owner check below.
      continue;
    } else {
      assert.equal(holdsAny, false, `${role.id} must not hold a warehouse id`);
    }
  }
});

check("Owner mirrors admin's warehouse grant too, since Owner always includes every ADMIN_ROLE id", () => {
  for (const id of ["warehouse.record.read", "warehouse.stockLocation.read", "warehouse.transferOrder.read"]) {
    assert.ok(OWNER_ROLE.permissions.includes(id), id);
    assert.equal(resolve(id, "owner", GOVERNED_BUSINESS_ROLES).decision, "ALLOW", id);
  }
});

check("Owner holds every ADMIN_ROLE permission, through the same governed resolver -- never a bypass", () => {
  assert.equal(OWNER_ROLE.privileged, true);
  for (const id of ADMIN_ROLE.permissions) {
    // reorder.purchaseOrder.void carries an isOwnAssignment Condition
    // (both admin's and Owner's) -- resolve() below always targets an
    // empty condition context, so this one id legitimately DENIES here,
    // exactly matching resolveEffectivePermission.test.mjs's own "admin:
    // reorder.purchaseOrder.void DENY when not the request's own
    // assignee" assertion. The Condition itself is checked separately,
    // right below.
    if (id === "reorder.purchaseOrder.void") continue;
    assert.equal(resolve(id, "owner", GOVERNED_BUSINESS_ROLES).decision, "ALLOW", id);
  }
  assert.equal(
    resolveEffectivePermission({
      permissionId: "reorder.purchaseOrder.void",
      assignments: [grant("owner", GOVERNED_BUSINESS_ROLES)],
      roles: GOVERNED_BUSINESS_ROLES,
      currentAccessVersion: 1,
      target: { scope: { type: "global" }, condition: { isOwnAssignment: true } },
    }).decision,
    "ALLOW",
    "reorder.purchaseOrder.void must ALLOW when Owner IS the request's own assignee"
  );
  // Every non-admin id Owner holds must be an active wave-1 report.* id
  // (Issue #325 W1) -- Owner never gains any OTHER capability admin
  // itself doesn't have.
  const adminSet = new Set(ADMIN_ROLE.permissions);
  for (const id of OWNER_ROLE.permissions) {
    if (adminSet.has(id)) continue;
    assert.ok(id.startsWith("report."), `Owner has "${id}" that admin does not, and it isn't a report.* id -- not a mirror plus the documented W1 addition`);
  }
});

// === Issue #325 / ADR-007 W1 + W-SAVE -- Owner's active report.* grant ===

const ACTIVE_REPORT_IDS = PERMISSION_CATALOG.filter(
  (p) => p.id.startsWith("report.") && p.active !== false,
).map((p) => p.id);
const INACTIVE_REPORT_IDS = PERMISSION_CATALOG.filter(
  (p) => p.id.startsWith("report.") && p.active === false,
).map((p) => p.id);
const DEFINITION_CRUD_IDS = [
  "report.definition.create",
  "report.definition.read",
  "report.definition.rename",
  "report.definition.duplicate",
  "report.definition.delete",
];

check("ACTIVE_REPORT_IDS is exactly 36 ids (31 wave-1 object/field + 5 W-SAVE definition-CRUD) -- the catalog's own count minus the 3 inactive wave-1 ids", () => {
  assert.equal(ACTIVE_REPORT_IDS.length, 36);
  assert.equal(INACTIVE_REPORT_IDS.length, 3);
  for (const id of DEFINITION_CRUD_IDS) assert.ok(ACTIVE_REPORT_IDS.includes(id), id);
});

check("Owner holds every ACTIVE report.* id (wave-1 + W-SAVE), resolving ALLOW", () => {
  for (const id of ACTIVE_REPORT_IDS) {
    assert.ok(OWNER_ROLE.permissions.includes(id), `Owner is missing "${id}"`);
    assert.equal(resolve(id, "owner", GOVERNED_BUSINESS_ROLES).decision, "ALLOW", id);
  }
});

check("Owner holds exactly the five W-SAVE definition-CRUD ids, and only Owner among all eleven Roles holds any of them", () => {
  for (const id of DEFINITION_CRUD_IDS) {
    assert.ok(OWNER_ROLE.permissions.includes(id), id);
  }
  for (const role of Object.values(COMPATIBILITY_ROLES)) {
    assert.equal(role.permissions.some((id) => DEFINITION_CRUD_IDS.includes(id)), false, `compatibility Role "${role.id}" must not hold a definition-CRUD id`);
  }
  for (const role of ALL_GOVERNED_ROLES) {
    if (role.id === "owner") continue;
    assert.equal(role.permissions.some((id) => DEFINITION_CRUD_IDS.includes(id)), false, `governed business Role "${role.id}" must not hold a definition-CRUD id -- only the approved W-SAVE role (Owner) does`);
  }
});

check("Owner does NOT hold any inactive report.* id, and resolving any of them still DENIES (active:false overrides any grant)", () => {
  for (const id of INACTIVE_REPORT_IDS) {
    assert.equal(OWNER_ROLE.permissions.includes(id), false, `Owner must not list "${id}" -- it is registered active:false`);
    const result = resolve(id, "owner", GOVERNED_BUSINESS_ROLES);
    assert.equal(result.decision, "DENY", id);
    assert.equal(result.reason, "inactivePermission", id);
  }
});

check("Owner is the ONLY Role (of all eleven) that holds any report.* id -- compatibility Roles and the other seven governed business Roles are untouched", () => {
  for (const role of Object.values(COMPATIBILITY_ROLES)) {
    assert.equal(role.permissions.some((id) => id.startsWith("report.")), false, `compatibility Role "${role.id}" must not hold a report.* id`);
  }
  for (const role of ALL_GOVERNED_ROLES) {
    const holdsReport = role.permissions.some((id) => id.startsWith("report."));
    if (role.id === "owner") {
      assert.equal(holdsReport, true);
    } else {
      assert.equal(holdsReport, false, `governed business Role "${role.id}" must not hold a report.* id yet`);
    }
  }
});

check("no compatibility Role or non-Owner governed business Role can read any report.* capability, resolver-verified", () => {
  const sampleIds = ["report.customer.read", "report.customer.field.name.read", "report.equipment.field.location.read"];
  for (const id of sampleIds) {
    assert.equal(resolve(id, "admin", COMPATIBILITY_ROLES).decision, "DENY", `admin + ${id}`);
    assert.equal(resolve(id, "dispatcher", COMPATIBILITY_ROLES).decision, "DENY", `dispatcher + ${id}`);
    assert.equal(resolve(id, "technician", COMPATIBILITY_ROLES).decision, "DENY", `technician + ${id}`);
    for (const role of ALL_GOVERNED_ROLES) {
      if (role.id === "owner") continue;
      assert.equal(resolve(id, role.id, GOVERNED_BUSINESS_ROLES).decision, "DENY", `${role.id} + ${id}`);
    }
  }
});

check("Owner's reorder.purchaseOrder.void Condition matches admin's exactly (same audited boundary)", () => {
  assert.deepEqual(
    OWNER_ROLE.conditionsByPermission?.["reorder.purchaseOrder.void"],
    ADMIN_ROLE.conditionsByPermission?.["reorder.purchaseOrder.void"]
  );
});

// === Compatibility Roles are byte-for-byte unaffected (this addendum's hard requirement) ===

check("the three compatibility Roles are unchanged: same ids, same permission sets, same privileged/compatibility flags", () => {
  assert.deepEqual(Object.keys(COMPATIBILITY_ROLES).sort(), ["admin", "dispatcher", "technician"]);
  assert.equal(ADMIN_ROLE.compatibility, true);
  assert.equal(ADMIN_ROLE.systemSeed, true);
  assert.equal(ADMIN_ROLE.privileged, true);
  assert.equal(DISPATCHER_ROLE.compatibility, true);
  assert.equal(DISPATCHER_ROLE.privileged, undefined);
  assert.equal(TECHNICIAN_ROLE.compatibility, true);
  // A spot-check of admin's own long-standing grant, unaffected by this file's import.
  assert.ok(ADMIN_ROLE.permissions.includes("account.governedField.write"));
  assert.ok(ADMIN_ROLE.permissions.includes("admin.roleAssignment.write"));
});

check("resolving against COMPATIBILITY_ROLES alone (no governed business Roles mixed in) is unaffected by this file existing", () => {
  assert.equal(resolve("account.record.read", "admin", COMPATIBILITY_ROLES).decision, "ALLOW");
  assert.equal(resolve("account.record.read", "technician", COMPATIBILITY_ROLES).decision, "DENY");
});

// === Inert-on-merge: the two catalogs are disjoint id spaces, never silently merged ===

check("GOVERNED_BUSINESS_ROLES and COMPATIBILITY_ROLES share no id (no accidental collision/merge)", () => {
  const compatIds = new Set(Object.keys(COMPATIBILITY_ROLES));
  for (const id of Object.keys(GOVERNED_BUSINESS_ROLES)) {
    assert.equal(compatIds.has(id), false, `"${id}" collides with a compatibility Role id`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
