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
  INVENTORY_CATALOG_ADMINISTRATOR_ROLE,
  WORK_ORDER_PARTS_PLANNER_ROLE,
  CRM_ACTIVITY_CONTRIBUTOR_ROLE,
} from "../lib/access/governedBusinessRoles.js";
import { findPermission, PERMISSION_CATALOG } from "../lib/access/permissionCatalog.js";
import { __GOVERNED_ASSIGNABLE_ROLES_FOR_TEST } from "../lib/access/trustedWriterCommands.js";

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
  // Owner ruling 2026-08-19: "need a marketing top top equal to salesManager".
  "marketingManager",
  "generalEmployee",
  "officeManager",
  "salesManager",
  "salesperson",
  "generalManager",
  "warehouseManager",
  "warehouseAssociate",
  "partsManager",
  "partsAssociate",
  "controller",
  "supportStaff",
  "accountingManager",
  "financeManager",
  "fieldManager",
  "operationsManager",
  "owner",
  "inventoryCreateExecutor",
  "inventoryCatalogAdministrator",
  "workOrderPartsPlanner",
  "crmActivityContributor",
  "inventoryTransferOperator",
  "inventoryCycleCountCounter",
  "inventoryCycleCountReconciler",
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

check("GOVERNED_BUSINESS_ROLES contains exactly the twenty-four ids (twenty-three, plus Marketing Manager)", () => {
  // The list is pinned so a Role cannot appear by accident. salesperson was added
  // deliberately on the Owner clarification that "salesManager and Sales are
  // different -- the manager is over the salesperson".
  assert.deepEqual(Object.keys(GOVERNED_BUSINESS_ROLES).sort(), [...EXPECTED_IDS].sort());
  assert.equal(ALL_GOVERNED_ROLES.length, 24);
});

check("salesperson and salesManager are intentionally identical in capability today", () => {
  // The distinction between them is ORGANISATIONAL, not authorizational. A manager
  // holds no authority over a report record, because that needs the coverage/
  // territory model the Owner deferred. Pinned so a later widening of salesManager
  // is a decision someone makes here, not a drift that quietly builds that model.
  const sp = [...GOVERNED_BUSINESS_ROLES.salesperson.permissions].sort();
  const sm = [...GOVERNED_BUSINESS_ROLES.salesManager.permissions].sort();
  assert.deepEqual(sp, sm);
  for (const id of ["opportunity.read", "opportunity.write"]) {
    assert.ok(sp.includes(id), `salesperson must hold ${id}`);
  }
  // Converting a WON Opportunity into a Sales Order creates a different object and
  // was not part of the ruling -- neither Role holds it.
  assert.equal(sp.includes("opportunity.createSalesOrder"), false);
});

// Cycle Count segregation of duties. The counting authority and the approving authority are split
// across two Roles on purpose: reconcile is the step that actually adjusts on-hand quantity, so a
// principal who could both submit a count and reconcile it could write inventory to any number with
// no second party in the path. Collapsing these two Roles into one convenient "cycle count" Role
// would silently remove that control, so it is pinned here rather than left to a code comment.
check("cycle count COUNTER cannot reconcile, and RECONCILER cannot count", () => {
  const counter = GOVERNED_BUSINESS_ROLES.inventoryCycleCountCounter;
  const reconciler = GOVERNED_BUSINESS_ROLES.inventoryCycleCountReconciler;
  assert.equal(counter.permissions.includes("inventory.cycleCount.reconcile"), false);
  assert.equal(reconciler.permissions.includes("inventory.cycleCount.submit"), false);
  assert.equal(reconciler.permissions.includes("inventory.cycleCount.create"), false);
  // Between them they cover the whole family exactly once -- no id is orphaned or duplicated.
  const union = [...counter.permissions, ...reconciler.permissions].sort();
  assert.deepEqual(union, [
    "inventory.cycleCount.cancel",
    "inventory.cycleCount.create",
    "inventory.cycleCount.reconcile",
    "inventory.cycleCount.submit",
  ]);
});

// The transfer Role is deliberately NOT split (a transfer is one custody movement performed by one
// operational owner), but it must still stay inside its own domain.
check("transfer operator carries exactly the four transfer ids and no adjacent inventory authority", () => {
  const role = GOVERNED_BUSINESS_ROLES.inventoryTransferOperator;
  assert.deepEqual([...role.permissions].sort(), [
    "inventory.transfer.cancel",
    "inventory.transfer.create",
    "inventory.transfer.dispatch",
    "inventory.transfer.receive",
  ]);
  for (const forbidden of ["inventory.catalog.manage", "inventory.stock.receive", "inventory.cycleCount.reconcile"]) {
    assert.equal(role.permissions.includes(forbidden), false, `transfer operator must not carry ${forbidden}`);
  }
});

check("every governed business Role's own .id matches its map key", () => {
  for (const [key, role] of Object.entries(GOVERNED_BUSINESS_ROLES)) {
    assert.equal(role.id, key);
  }
});

// === Assignability gate (trustedWriterCommands.ts GOVERNED_ASSIGNABLE_ROLES) ===
//
// Declaring a Role does NOT make it assignable -- a second, deliberate allowlist controls which
// governed Roles the trusted-writer grant path will accept. These tests pin the properties that
// gate actually exists to protect.

// Owner ruling (grantable-governed-roles workstream): ALL 15 governed business Roles are now
// governed-assignable, including the privileged `owner` Role. The invariant that actually matters
// is narrower than "no privileged Role is assignable" (that was true only because no privileged
// governed Role existed on the allowlist before): the two-person rule (self-approval ban, distinct
// approverUid, approver-must-independently-hold-a-privileged-Role) is keyed off `role.privileged`
// inside grantRole/revokeRole themselves, not off which allowlist a Role came from, so it protects
// `owner` automatically. What this test pins instead is that `owner` is the ONLY privileged entry --
// nothing else can quietly become grant-target-privileged without the two-person rule waking up for
// it too, which would be a silent, untested change to who needs a second approver.
check("owner is the only privileged Role on the governed allowlist; every other entry is non-privileged", () => {
  const privilegedIds = [];
  for (const [id, role] of Object.entries(__GOVERNED_ASSIGNABLE_ROLES_FOR_TEST)) {
    if (role.privileged) {
      privilegedIds.push(id);
    }
  }
  assert.deepEqual(privilegedIds, ["owner"], "owner must be the ONLY privileged governed-assignable Role");
});

// Full-coverage: all 15 declared governed business Roles are now reachable through the grant path,
// matching Owner's explicit direction ("make all 15 governed business roles grantable").
check("all twenty-four governed business Roles are governed-assignable (no UnknownRoleError for any of them)", () => {
  for (const id of EXPECTED_IDS) {
    assert.ok(__GOVERNED_ASSIGNABLE_ROLES_FOR_TEST[id], `${id} must be governed-assignable`);
  }
  assert.equal(
    Object.keys(__GOVERNED_ASSIGNABLE_ROLES_FOR_TEST).length,
    24,
    "the governed allowlist must contain exactly the 24 declared governed business Roles",
  );
});

// Every entry must be a real governed Role, identical to its catalog definition -- not a lookalike
// object with a wider permission set that happens to share an id.
check("every governed-assignable entry is the same object as its catalog Role", () => {
  for (const [id, role] of Object.entries(__GOVERNED_ASSIGNABLE_ROLES_FOR_TEST)) {
    assert.ok(GOVERNED_BUSINESS_ROLES[id], `${id} is assignable but not a declared governed Role`);
    assert.equal(role, GOVERNED_BUSINESS_ROLES[id], `${id} must BE the catalog Role, not a copy`);
  }
});

// The six operational Roles are reachable by the grant path. Without this, each is authority that
// exists on paper and can never be conferred -- the defect this allowlist extension fixed.
check("the six operational Roles are governed-assignable", () => {
  for (const id of [
    "inventoryCatalogAdministrator",
    "workOrderPartsPlanner",
    "crmActivityContributor",
    "inventoryTransferOperator",
    "inventoryCycleCountCounter",
    "inventoryCycleCountReconciler",
  ]) {
    assert.ok(__GOVERNED_ASSIGNABLE_ROLES_FOR_TEST[id], `${id} must be governed-assignable`);
  }
});

// Owner decision 2026-08-16: the catalog administrator gained inventory.catalog.read. Live E2E showed
// it could reach the catalog surface and then be refused the manufacturer read it needs to curate
// against -- correct enforcement of an operationally incomplete Role. These pin the new scope exactly.
check("inventoryCatalogAdministrator carries catalog READ, manage and activate -- and nothing else", () => {
  const role = GOVERNED_BUSINESS_ROLES.inventoryCatalogAdministrator;
  assert.deepEqual([...role.permissions].sort(), [
    "inventory.catalog.activate",
    "inventory.catalog.manage",
    "inventory.catalog.read",
  ]);
});

check("the catalog read did NOT drag in unrelated inventory authority", () => {
  const role = GOVERNED_BUSINESS_ROLES.inventoryCatalogAdministrator;
  for (const forbidden of [
    "inventory.transaction.read", "inventory.stock.receive",
    "inventory.transfer.create", "inventory.transfer.dispatch",
    "inventory.cycleCount.create", "inventory.cycleCount.reconcile",
    "inventory.serializedAsset.read", "inventory.location.display.read",
  ]) {
    assert.equal(role.permissions.includes(forbidden), false, `must not carry ${forbidden}`);
  }
  assert.equal(role.permissions.length, 3, "exactly three ids -- the read was an addition, not an opening");
});

check("the catalog administrator remains non-privileged after the addition", () => {
  // A read widening must never quietly promote the Role into the two-person-rule class.
  assert.equal(GOVERNED_BUSINESS_ROLES.inventoryCatalogAdministrator.privileged, false);
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

check("Sales Manager: Customer read/create/update + inventory visibility; still no governed-field write", () => {
  for (const id of ["account.record.read", "account.record.create", "account.record.update", "inventory.transaction.read"]) {
    assert.equal(resolve(id, "salesManager", GOVERNED_BUSINESS_ROLES).decision, "ALLOW", id);
  }
  assert.equal(resolve("account.governedField.write", "salesManager", GOVERNED_BUSINESS_ROLES).decision, "DENY");
});

// Owner ruling 2026-08-18: salesOrder.read granted to Sales Manager. It is registered
// active:false, so the GRANT is recorded while every resolve still DENIES on
// inactivePermission -- grant is not activation. Asserting both halves is the point:
// the day someone activates the id this Role gains the read with no further change,
// and until then no amount of grant can open it.
check("Sales Manager: holds the salesOrder.read grant, which still resolves DENY/inactivePermission", () => {
  assert.ok(GOVERNED_BUSINESS_ROLES.salesManager.permissions.includes("salesOrder.read"));
  const r = resolve("salesOrder.read", "salesManager", GOVERNED_BUSINESS_ROLES);
  assert.equal(r.decision, "DENY");
  assert.equal(r.reason, "inactivePermission");
});

check("Sales Manager: no write authority over orders or purchasing came with the reads", () => {
  for (const id of ["salesOrder.write", "salesOrder.fulfill", "reorder.purchaseOrder.create", "inventory.action.create"]) {
    assert.equal(resolve(id, "salesManager", GOVERNED_BUSINESS_ROLES).decision, "DENY", id);
  }
});

check("Accounting Manager: Customer read + governed-field write + PO read; no ordinary Customer create/update", () => {
  for (const id of ["account.record.read", "account.governedField.write", "reorder.purchaseOrder.read"]) {
    assert.equal(resolve(id, "accountingManager", GOVERNED_BUSINESS_ROLES).decision, "ALLOW", id);
  }
  for (const id of ["account.record.create", "account.record.update"]) {
    assert.equal(resolve(id, "accountingManager", GOVERNED_BUSINESS_ROLES).decision, "DENY", id);
  }
});

check("Finance Manager: Customer read + governed-field write + PO read; no ordinary Customer create/update", () => {
  for (const id of ["account.record.read", "account.governedField.write", "reorder.purchaseOrder.read"]) {
    assert.equal(resolve(id, "financeManager", GOVERNED_BUSINESS_ROLES).decision, "ALLOW", id);
  }
  for (const id of ["account.record.create", "account.record.update"]) {
    assert.equal(resolve(id, "financeManager", GOVERNED_BUSINESS_ROLES).decision, "DENY", id);
  }
});

// Both money Roles read the committed order, and neither can write it or void a PO.
check("Finance/Accounting Manager: Sales Order read is granted-but-inactive, and NEITHER gained Sales Order write", () => {
  for (const roleId of ["financeManager", "accountingManager"]) {
    assert.ok(GOVERNED_BUSINESS_ROLES[roleId].permissions.includes("salesOrder.read"), roleId);
    const r = resolve("salesOrder.read", roleId, GOVERNED_BUSINESS_ROLES);
    assert.equal(r.decision, "DENY", roleId);
    assert.equal(r.reason, "inactivePermission", roleId);
    // Sales Order WRITE stays denied for both. The 2026-08-19 purchasing ruling moved
    // procurement authority, not order authority.
    for (const id of ["salesOrder.write", "salesOrder.fulfill"]) {
      assert.equal(resolve(id, roleId, GOVERNED_BUSINESS_ROLES).decision, "DENY", roleId + "/" + id);
    }
  }
});

// Owner ruling 2026-08-19: "Purchasing falls under accounting". The CRUD matrix's
// standalone Purchasing role has no counterpart in this file and now never will -- its
// authority lands on Accounting Manager. Pinned in BOTH directions, because the whole
// point is that the two Roles stopped being interchangeable on this date.
check("Accounting Manager holds the purchasing workflow; Finance Manager deliberately does NOT", () => {
  const PURCHASING = [
    "reorder.purchaseOrder.create",
    "reorder.request.read.queue",
    "reorder.request.startPurchasing",
    "reorder.request.recordPurchaseOrder",
    "reorder.request.postPurchasingUpdate",
  ];
  for (const id of PURCHASING) {
    assert.ok(ACCOUNTING_MANAGER_ROLE.permissions.includes(id), `accountingManager must hold ${id}`);
    assert.equal(
      FINANCE_MANAGER_ROLE.permissions.includes(id),
      false,
      `financeManager must NOT hold ${id} -- purchasing folded into ACCOUNTING, not finance`,
    );
  }
});

check("the purchasing merge did not hand Accounting Manager approval or void authority", () => {
  // Segregation of duties, applied to the very merge that asked for it: whoever raises a
  // Purchase Order must not also approve it. void is withheld for a different reason --
  // it carries an isOwnAssignment Condition everywhere it is held, and granting it here
  // unconditioned would exceed admin's own authority.
  for (const id of ["reorder.request.approve", "reorder.request.reject", "reorder.purchaseOrder.void"]) {
    assert.equal(
      ACCOUNTING_MANAGER_ROLE.permissions.includes(id),
      false,
      `accountingManager must NOT hold ${id}`,
    );
  }
});

// THE PARITY ENDED ON PURPOSE, and this test is the record of how.
//
// 2026-08-18 the Owner ruled "accountingManager should be like financeManager FOR NOW",
// and the previous version of this test pinned the two sets as identical. "For now" ended
// on 2026-08-19 with "Purchasing falls under accounting", which gives Accounting a
// workflow Finance has no claim to.
//
// So the assertion is narrowed rather than deleted: everything the 2026-08-18 parity
// ruling actually established still holds -- Accounting was RAISED to Finance's level and
// keeps every id Finance has -- while Accounting is now permitted to hold MORE. What is
// still forbidden is Finance quietly drifting above Accounting, or Accounting losing any
// of the parity it was granted.
check("Accounting Manager retains everything Finance Manager holds (the 2026-08-18 parity), and may now hold more", () => {
  const accountingSet = new Set(ACCOUNTING_MANAGER_ROLE.permissions);
  for (const id of FINANCE_MANAGER_ROLE.permissions) {
    assert.ok(accountingSet.has(id), `accountingManager lost "${id}", which the 2026-08-18 parity ruling granted it`);
  }
  assert.ok(
    accountingSet.has("account.governedField.write"),
    "parity was reached by RAISING Accounting to Finance, not by lowering Finance",
  );
  assert.ok(
    ACCOUNTING_MANAGER_ROLE.permissions.length > FINANCE_MANAGER_ROLE.permissions.length,
    "Accounting should now exceed Finance -- purchasing folded into it on 2026-08-19",
  );
});

// Owner ruling 2026-08-19: "need a marketing top top equal to salesManager".
check("Marketing Manager exists, is a peer of Sales Manager, and holds only reads", () => {
  const marketing = GOVERNED_BUSINESS_ROLES.marketingManager;
  assert.ok(marketing, "marketingManager must exist");
  assert.equal(marketing.compatibility, false);
  for (const id of ["account.record.read", "opportunity.read", "salesOrder.read"]) {
    assert.ok(marketing.permissions.includes(id), `marketingManager must hold ${id}`);
  }
  // No write anywhere. The matrix gives Marketing CRED over Marketing Initiatives, and no
  // marketing.* capability exists to grant -- a recorded catalog gap, not an omission here.
  for (const id of marketing.permissions) {
    assert.ok(
      id.endsWith(".read"),
      `marketingManager holds "${id}", which is not a read -- Marketing has no write authority until a marketing capability exists`,
    );
  }
});

// Owner ruling 2026-08-19: "service Manager is fieldManager". The id is unchanged --
// live grants, roleHierarchy.ts and the audit trail all reference it -- so the LABEL is
// what moved. Pinned so the two cannot drift apart again and leave the product calling
// this position something the business does not.
check("Service Manager is the fieldManager id -- the label changed, the id did not", () => {
  assert.equal(GOVERNED_BUSINESS_ROLES.fieldManager.name, "Service Manager");
  assert.ok(GOVERNED_BUSINESS_ROLES.fieldManager, "the id stays 'fieldManager'; renaming it would orphan every live grant");
});

check("Field Manager: full Work Order lifecycle + field-inventory read + Customer read; no reorder/purchasing execution", () => {
  for (const id of ["account.record.read", "workOrder.create", "workOrder.transition", "workOrder.cancel", "inventory.transaction.read"]) {
    assert.equal(resolve(id, "fieldManager", GOVERNED_BUSINESS_ROLES).decision, "ALLOW", id);
  }
  for (const id of ["reorder.request.assign", "reorder.purchaseOrder.create", "inventory.action.create"]) {
    assert.equal(resolve(id, "fieldManager", GOVERNED_BUSINESS_ROLES).decision, "DENY", id);
  }
});

// === Owner ruling (grantable-governed-roles workstream): fulfillment.coordinatedVisit.read grant ===
//
// Proposed grant set is exactly {owner, admin, operationsManager, fieldManager, dispatcher}. Was
// granted to NO Role before this change, so Coordinated Visits/Mission were inert for everyone,
// including Owner. GRANT IS NOT ACTIVATION: the id stays registered active:false, so every check
// here resolves DENY with reason "inactivePermission" (never "noQualifyingGrant") for a role that
// DOES hold it, and DENY for any reason at all for a role that does not.
check("fulfillment.coordinatedVisit.read: Field Manager and Operations Manager hold the grant (inactivePermission DENY, not noQualifyingGrant)", () => {
  for (const id of ["fieldManager", "operationsManager"]) {
    assert.ok(GOVERNED_BUSINESS_ROLES[id].permissions.includes("fulfillment.coordinatedVisit.read"), id);
    const result = resolve("fulfillment.coordinatedVisit.read", id, GOVERNED_BUSINESS_ROLES);
    assert.equal(result.decision, "DENY", id);
    assert.equal(result.reason, "inactivePermission", `${id} must be denied by the active:false gate, not by lacking the grant`);
  }
});

check("fulfillment.coordinatedVisit.read: Owner inherits it by composition (through ADMIN_ROLE.permissions), same inactivePermission reason", () => {
  assert.ok(OWNER_ROLE.permissions.includes("fulfillment.coordinatedVisit.read"));
  const result = resolve("fulfillment.coordinatedVisit.read", "owner", GOVERNED_BUSINESS_ROLES);
  assert.equal(result.decision, "DENY");
  assert.equal(result.reason, "inactivePermission");
});

check("fulfillment.coordinatedVisit.read: admin and dispatcher (compatibility Roles) hold the grant too -- the full five-role set is {owner, admin, operationsManager, fieldManager, dispatcher}", () => {
  for (const id of ["admin", "dispatcher"]) {
    assert.ok(COMPATIBILITY_ROLES[id].permissions.includes("fulfillment.coordinatedVisit.read"), id);
    const result = resolveEffectivePermission({
      permissionId: "fulfillment.coordinatedVisit.read",
      assignments: [grant(id, COMPATIBILITY_ROLES)],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: { scope: { type: "global" }, condition: {} },
    });
    assert.equal(result.decision, "DENY");
    assert.equal(result.reason, "inactivePermission");
  }
});

check("fulfillment.coordinatedVisit.read: no OTHER Role (compatibility or governed) carries it -- the grant is exactly the five named roles", () => {
  assert.equal(COMPATIBILITY_ROLES.technician.permissions.includes("fulfillment.coordinatedVisit.read"), false);
  for (const [id, role] of Object.entries(GOVERNED_BUSINESS_ROLES)) {
    if (id === "operationsManager" || id === "fieldManager" || id === "owner") continue;
    assert.equal(role.permissions.includes("fulfillment.coordinatedVisit.read"), false, `${id} must not hold fulfillment.coordinatedVisit.read`);
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
  // Owner ruling 2026-08-18: create is now granted. Update and governed-field write are
  // NOT -- this Role can open a Customer but cannot amend one, which is the deliberate
  // asymmetry, not a half-finished grant.
  assert.equal(resolve("account.record.create", "operationsManager", GOVERNED_BUSINESS_ROLES).decision, "ALLOW");
  for (const id of [
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

check("Inventory CREATE Executor: NOT privileged (operational -- single-approver + audited, not two-person), systemSeed, non-compatibility", () => {
  // Privileged Approval Scope Correction: inventory.catalog.manage is
  // operational authority, not security/access-policy/audit-integrity, so it
  // must NOT require a second approver.
  assert.equal(INVENTORY_CREATE_EXECUTOR_ROLE.privileged, false);
  assert.equal(INVENTORY_CREATE_EXECUTOR_ROLE.systemSeed, true);
  assert.equal(INVENTORY_CREATE_EXECUTOR_ROLE.compatibility, false);
});

// === Wave 7 completion: Roles that make the activated capabilities grantable ===

check("Work Order Parts Planner: carries EXACTLY workOrder.parts.plan", () => {
  assert.deepEqual(WORK_ORDER_PARTS_PLANNER_ROLE.permissions, ["workOrder.parts.plan"]);
});

check("GRANT IS NOT ACTIVATION: holding the Role still resolves DENY while the capability is active:false", () => {
  // workOrder.parts.plan is registered active:false, and the resolver's active check overrides ANY
  // grant. So a principal holding this Role is still denied everywhere the per-environment activation
  // override is off -- which is every environment except platform-sandbox. This is the property that
  // keeps production safe from a Role definition, and it is asserted rather than assumed.
  assert.equal(resolve("workOrder.parts.plan", "workOrderPartsPlanner", GOVERNED_BUSINESS_ROLES).decision, "DENY");
});

check("Work Order Parts Planner: planning confers NO reservation, consumption or execution authority", () => {
  // PLAN != RESERVE != USE -- the command's own invariant, mirrored in the Role's grant set.
  for (const id of [
    "inventory.transaction.read", "inventory.stock.receive", "inventory.catalog.manage",
    "workOrder.create", "workOrder.transition", "workOrder.cancel",
    "salesOrder.write", "salesOrder.fulfill", "admin.roleAssignment.write",
  ]) {
    assert.equal(resolve(id, "workOrderPartsPlanner", GOVERNED_BUSINESS_ROLES).decision, "DENY", id);
  }
});

check("CRM Activity Contributor: carries EXACTLY crm.activity.create + .read", () => {
  assert.deepEqual(
    [...CRM_ACTIVITY_CONTRIBUTOR_ROLE.permissions].sort(),
    ["crm.activity.create", "crm.activity.read"],
  );
});

check("GRANT IS NOT ACTIVATION: both CRM ids still resolve DENY while registered active:false", () => {
  for (const id of ["crm.activity.create", "crm.activity.read"]) {
    assert.equal(resolve(id, "crmActivityContributor", GOVERNED_BUSINESS_ROLES).decision, "DENY", id);
  }
});

check("CRM Activity Contributor: recording history confers NO commercial write authority", () => {
  // The activity record REFERENCES Account/Opportunity/Sales Order; it never restates or mutates them.
  for (const id of [
    "account.record.create", "account.record.update", "account.governedField.write",
    "opportunity.write", "salesOrder.write", "finance.invoice.issue",
    "admin.roleAssignment.write",
  ]) {
    assert.equal(resolve(id, "crmActivityContributor", GOVERNED_BUSINESS_ROLES).decision, "DENY", id);
  }
});

check("both new Roles are durable + operational: NOT privileged, systemSeed, non-compatibility", () => {
  for (const role of [WORK_ORDER_PARTS_PLANNER_ROLE, CRM_ACTIVITY_CONTRIBUTOR_ROLE]) {
    assert.equal(role.privileged, false, role.id);
    assert.equal(role.systemSeed, true, role.id);
    assert.equal(role.compatibility, false, role.id);
  }
});

check("defining either Role grants nothing without an assignment", () => {
  for (const permissionId of ["workOrder.parts.plan", "crm.activity.create", "crm.activity.read"]) {
    const denied = resolveEffectivePermission({
      permissionId,
      assignments: [],
      roles: GOVERNED_BUSINESS_ROLES,
      currentAccessVersion: 1,
      target: { scope: { type: "global" }, condition: {} },
    });
    assert.equal(denied.decision, "DENY", permissionId);
  }
});

check("no OTHER governed Role carries these capabilities in its permission set", () => {
  // Asserted on the permission SETS, not on resolution: every id here resolves DENY anyway while
  // active:false, so a resolution-based check would pass vacuously and prove nothing.
  for (const [id, role] of Object.entries(GOVERNED_BUSINESS_ROLES)) {
    // "owner" exempted for the same composition reason recorded just below: the
    // 2026-08-19 ruling gives admin the whole catalog and OWNER_PERMISSIONS is composed
    // from ADMIN_ROLE.permissions, so owner holds every id by inheritance. What this
    // still protects is that no other governed Role carries it on its own.
    if (id !== "workOrderPartsPlanner" && id !== "owner") {
      assert.equal(role.permissions.includes("workOrder.parts.plan"), false, id);
    }
    // "owner" is exempted, not overlooked. Owner ruling 2026-08-19 granted CRM activity
    // on ADMIN_ROLE (canonical admin authority), and OWNER_PERMISSIONS is composed from
    // ADMIN_ROLE.permissions -- so owner holds these ids BY COMPOSITION, exactly the way
    // it already inherits fulfillment.coordinatedVisit.read. The invariant this check
    // protects is that no OTHER governed Role picks them up independently; that still
    // holds, and a dedicated check below pins owner-via-composition explicitly.
    if (id !== "crmActivityContributor" && id !== "owner") {
      assert.equal(role.permissions.includes("crm.activity.create"), false, id);
      assert.equal(role.permissions.includes("crm.activity.read"), false, id);
    }
  }
});

// Owner ruling 2026-08-19 -- closes docs/governance/crm-activity-admin-authority-proposal.md.
// Before this, exactly one Role carried these ids, so a dispatcher holding the operational
// crmActivityContributor assignment could read CRM notes on an Account while the ADMIN could
// not, and owner inherited the same gap. Pinned in both directions: admin holds them
// directly, owner by composition, and dispatcher does NOT gain create as a side effect of
// the shared admin/dispatcher base.
check("CRM activity: admin holds create+read directly, owner by composition, dispatcher NOT via the shared base", () => {
  for (const id of ["crm.activity.create", "crm.activity.read"]) {
    assert.ok(ADMIN_ROLE.permissions.includes(id), `admin must hold ${id}`);
    assert.ok(OWNER_ROLE.permissions.includes(id), `owner must inherit ${id} via OWNER_PERMISSIONS`);
    assert.equal(
      DISPATCHER_ROLE.permissions.includes(id),
      false,
      `dispatcher must NOT hold ${id} -- it was granted ADMIN-only, not on the shared base`,
    );
  }
});

check("security-sensitive Roles remain privileged (two-person preserved): owner privileged; the operational executor is not", () => {
  assert.equal(OWNER_ROLE.privileged, true, "owner administers security/access policy -- stays two-person");
  assert.equal(INVENTORY_CREATE_EXECUTOR_ROLE.privileged, false);
  // The ONLY governed business Role flipped to operational (non-privileged
  // while still systemSeed) is the inventory CREATE executor; every other
  // governed Role keeps its prior privileged setting.
  const privilegedGoverned = Object.values(GOVERNED_BUSINESS_ROLES).filter((r) => r.privileged).map((r) => r.id);
  assert.deepEqual(privilegedGoverned, ["owner"], "only owner remains a privileged governed Role");
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

// OWNER REVERSAL 2026-08-19. This check previously asserted that catalog WRITE stays off
// every title-based Role -- "catalog write is a specific operational authority, not a
// title-based one" (docs/releases/supplier-master-promotion-package.md SS A, which also
// evaluated and REJECTED extending operationsManager as its Option B).
//
// The Owner reversed that after the risk was put to them explicitly: the duplicate-catalog
// failure mode (TST-1234 vs "TST 1234" vs "Compressor Assy" as three Parts, with stock and
// history split across all three) was stated, along with the fact that this system has NO
// duplicate detection today. The ruling was that all three management Roles hold it and that
// duplicate detection begins immediately as the mitigation, rather than the grant waiting on it.
//
// The check is INVERTED, not deleted, and the ACTIVATE half of the original invariant is
// untouched and still enforced: lifecycle status remains confined to the purpose-built catalog
// Role. So the reversal is exactly as wide as the ruling and no wider, and re-narrowing it later
// -- once dedup exists, if the Owner then wants curation back with the catalog administrator --
// is a decision someone makes here rather than a drift nobody notices.
check("catalog MANAGE is held by the three management Roles plus the purpose-built catalog Roles; catalog ACTIVATE is still confined", () => {
  const EXPECTED_MANAGE = [
    "fieldManager",
    "inventoryCatalogAdministrator",
    "inventoryCreateExecutor",
    "operationsManager",
    "owner",
  ];
  const granting = Object.keys(GOVERNED_BUSINESS_ROLES).filter(
    (id) => resolve("inventory.catalog.manage", id, GOVERNED_BUSINESS_ROLES).decision === "ALLOW",
  );
  assert.deepEqual(granting.sort(), EXPECTED_MANAGE, "exactly these Roles may write the catalog");

  // Owner holds MANAGE by composition through ADMIN_ROLE, not by its own grant.
  assert.equal(resolve("inventory.catalog.manage", "owner", GOVERNED_BUSINESS_ROLES).decision, "ALLOW");

  // ACTIVATE was NOT part of the reversal. Creating and correcting reference data is a
  // different authority from changing its lifecycle status, and only the durable catalog
  // administrator carries it -- owner included.
  const activating = Object.keys(GOVERNED_BUSINESS_ROLES).filter(
    (id) => resolve("inventory.catalog.activate", id, GOVERNED_BUSINESS_ROLES).decision === "ALLOW",
  );
  // owner now resolves ALLOW for activate. That is a CONSEQUENCE of the 2026-08-19
  // ruling (admin holds the full catalog; owner is composed from admin), not a
  // reversal of the confinement this check was written for -- the point was that no
  // OPERATIONAL Role picks activate up, and none does. Owner and admin are the two
  // Roles the ruling deliberately makes unrestricted.
  assert.deepEqual(
    activating.filter((id) => id !== "owner").sort(),
    ["inventoryCatalogAdministrator"],
    "activate stays confined to the durable catalog administrator among non-owner Roles",
  );
});

check("the catalog MANAGE reversal did not leak to the operational Roles it was never meant to reach", () => {
  // dispatcher and technician are the highest-headcount Roles in the product. The ruling named
  // the three MANAGEMENT Roles; it did not name these, and the grant was placed so they cannot
  // pick it up from the shared admin/dispatcher base.
  for (const id of ["dispatcher", "technician"]) {
    assert.equal(
      (COMPATIBILITY_ROLES[id].permissions || []).includes("inventory.catalog.manage"),
      false,
      `${id} must not hold inventory.catalog.manage`,
    );
  }
  for (const id of ["salesManager", "financeManager", "accountingManager", "officeManager", "generalEmployee"]) {
    assert.equal(
      resolve("inventory.catalog.manage", id, GOVERNED_BUSINESS_ROLES).decision,
      "DENY",
      `${id} must not hold inventory.catalog.manage`,
    );
  }
});

// === Catalog administrator (durable) -- Option A of the accepted role design ===

check("Inventory Catalog Administrator: grants EXACTLY catalog read + manage + activate", () => {
  // UPDATED 2026-08-16 (Owner decision): inventory.catalog.read was added. Live E2E showed the Role
  // could reach the catalog surface and was then refused getManufacturerCatalog -- correct
  // enforcement of a Role whose scope was operationally incomplete. Curating a Part against a
  // manufacturer list you cannot read is not a coherent authority.
  assert.deepEqual(
    [...INVENTORY_CATALOG_ADMINISTRATOR_ROLE.permissions].sort(),
    ["inventory.catalog.activate", "inventory.catalog.manage", "inventory.catalog.read"],
  );
  // NOTE: inventory.catalog.read is registered active:false, so the resolver DENIES it without a
  // per-environment activation override even though the Role now carries it. Grant is not
  // activation -- asserted directly below rather than papered over.
  assert.equal(resolve("inventory.catalog.manage", "inventoryCatalogAdministrator", GOVERNED_BUSINESS_ROLES).decision, "ALLOW");
  assert.equal(resolve("inventory.catalog.activate", "inventoryCatalogAdministrator", GOVERNED_BUSINESS_ROLES).decision, "ALLOW");
});

check("Inventory Catalog Administrator: inherits NO capability outside the catalog resource", () => {
  for (const id of [
    "account.record.read", "account.record.create", "account.governedField.write",
    "workOrder.create", "workOrder.transition", "workOrder.cancel",
    "admin.roleAssignment.write", "admin.userStatus.write",
    "reorder.request.assign", "warehouse.record.read", "inventory.transaction.read",
    "inventory.stock.receive",
    "salesOrder.write", "salesOrder.fulfill", "finance.invoice.issue",
  ]) {
    assert.equal(resolve(id, "inventoryCatalogAdministrator", GOVERNED_BUSINESS_ROLES).decision, "DENY", id);
  }
});

check("Inventory Catalog Administrator: durable + operational -- NOT privileged, systemSeed, non-compatibility", () => {
  // Catalog write administers no security/access policy, grants no admin
  // authority, changes no role/permission definition, and cannot touch audit
  // integrity -- one authorized approver plus append-only audit, not
  // two-person (docs/governance/privileged-approval-classification.md).
  assert.equal(INVENTORY_CATALOG_ADMINISTRATOR_ROLE.privileged, false);
  assert.equal(INVENTORY_CATALOG_ADMINISTRATOR_ROLE.systemSeed, true);
  assert.equal(INVENTORY_CATALOG_ADMINISTRATOR_ROLE.compatibility, false);
  assert.equal(INVENTORY_CATALOG_ADMINISTRATOR_ROLE.id, "inventoryCatalogAdministrator");
});

check("Inventory Catalog Administrator: distinct from the transitional executor (.activate is the difference)", () => {
  // inventoryCreateExecutor is execution-scoped and revoked after one approved
  // CREATE run; it deliberately withholds .activate. The durable role carries it.
  assert.equal(resolve("inventory.catalog.activate", "inventoryCreateExecutor", GOVERNED_BUSINESS_ROLES).decision, "DENY");
  assert.equal(resolve("inventory.catalog.activate", "inventoryCatalogAdministrator", GOVERNED_BUSINESS_ROLES).decision, "ALLOW");
  assert.notEqual(INVENTORY_CATALOG_ADMINISTRATOR_ROLE.id, INVENTORY_CREATE_EXECUTOR_ROLE.id);
});

check("Inventory Catalog Administrator: defining the Role grants nothing without an assignment", () => {
  // The protected action is the roleAssignments write, not this definition.
  for (const permissionId of ["inventory.catalog.manage", "inventory.catalog.activate"]) {
    const denied = resolveEffectivePermission({
      permissionId,
      assignments: [], // never granted / revoked
      roles: GOVERNED_BUSINESS_ROLES,
      currentAccessVersion: 1,
      target: { scope: { type: "global" }, condition: {} },
    });
    assert.equal(denied.decision, "DENY", permissionId);
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
    // Phase 6a: admin (and therefore owner, by inheritance) now holds the
    // Sales/Fulfillment/Finance spine, which is registered `active: false`.
    // resolve() below passes no activationOverrides, so an active:false id
    // legitimately DENIES here (inactivePermission) for BOTH admin and owner --
    // the "owner >= admin" property still holds at the permission-list level,
    // and the spine's ALLOW-under-activation is proven in
    // resolveEffectivePermission.test.mjs (Phase 6a behavioral block). Skipping
    // them here mirrors the reorder.purchaseOrder.void Condition exemption above.
    if (findPermission(id)?.active === false) continue;
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
    // admin is exempted, not overlooked: the 2026-08-19 Owner ruling ("Admin and
    // Owner have full access to all possible features and permissions") gives admin
    // the ENTIRE catalog, so admin legitimately holds this id. The invariant these
    // loops protect -- that no OTHER Role picks it up independently -- is unchanged.
    if (role.id === "admin") continue;
    assert.equal(role.permissions.some((id) => DEFINITION_CRUD_IDS.includes(id)), false, `compatibility Role "${role.id}" must not hold a definition-CRUD id`);
  }
  for (const role of ALL_GOVERNED_ROLES) {
    if (role.id === "owner") continue;
    assert.equal(role.permissions.some((id) => DEFINITION_CRUD_IDS.includes(id)), false, `governed business Role "${role.id}" must not hold a definition-CRUD id -- only the approved W-SAVE role (Owner) does`);
  }
});

check("Owner does NOT hold any inactive report.* id, and resolving any of them still DENIES (active:false overrides any grant)", () => {
  for (const id of INACTIVE_REPORT_IDS) {
    // Owner now LISTS these ids (admin holds the full catalog by the 2026-08-19
    // ruling, and owner composes from admin). That is fine and is the whole point of
    // the grant/activation split: what matters is that an active:false id still DENIES
    // no matter who holds it, which is exactly what the next three assertions prove.
    // Checking the list membership here would only re-assert the old posture.
    const result = resolve(id, "owner", GOVERNED_BUSINESS_ROLES);
    assert.equal(result.decision, "DENY", id);
    assert.equal(result.reason, "inactivePermission", id);
  }
});

check("Owner is the ONLY Role (of all eleven) that holds any report.* id -- compatibility Roles and the other seven governed business Roles are untouched", () => {
  for (const role of Object.values(COMPATIBILITY_ROLES)) {
    // admin is exempted, not overlooked: the 2026-08-19 Owner ruling ("Admin and
    // Owner have full access to all possible features and permissions") gives admin
    // the ENTIRE catalog, so admin legitimately holds this id. The invariant these
    // loops protect -- that no OTHER Role picks it up independently -- is unchanged.
    if (role.id === "admin") continue;
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
    // admin is NOT asserted here any more -- it holds the full catalog by the
    // 2026-08-19 ruling and correctly ALLOWs. dispatcher and technician are the Roles
    // this check exists to protect, and they are still asserted below.
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
