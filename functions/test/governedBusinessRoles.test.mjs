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
  // Owner roster 2026-08-20: Tom holds Purchasing, Erik holds Purchasing Manager as a
  // second role alongside Accounting Manager; Willie holds Shop Manager.
  "purchasingManager",
  "shopManager",
  "shopAssociate",
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
  // SCANNER PROMOTION 2026-08-20. Four functional Roles that make the scanner reachable by warehouse
  // and parts staff. Added as FUNCTIONS rather than as permissions on the warehouse/parts POSITIONS
  // above, which carry none by design -- a job title must never be what makes somebody an inventory
  // writer. Each Role's exact contents are pinned in test/scannerReleaseReadiness.test.mjs.
  "inventoryPutAwayOperator",
  "inventoryBinAdministrator",
  "inventoryReturnsIntakeClerk",
  "inventoryLookupReader",
  // Owner decisions 2026-08-21. Reporting became three TIERED functional Roles rather than 39
  // capability ids copied into ten business titles; Equipment model administration became a
  // standalone Role mirroring inventoryCatalogAdministrator; and Receiving became a named station
  // after the capacity report found it had ZERO assigned workers and 32 operable ones.
  "reportViewer",
  "reportFinanceViewer",
  "reportAuthor",
  "equipmentCatalogAdministrator",
  "inventoryReceivingClerk",
  // Owner decision 2026-08-23. Serialized acquisition and equipment install are SEPARATE stations,
  // and both appear here for the same reason Receiving did: authority that exists with nobody
  // accountable for it. Two ids rather than one because a single "equipment lifecycle" Role would
  // let one person take a machine from non-existence to a customer's premises with no second party
  // in the chain -- non-PO acquisition has no supplier document to check it against, and install is
  // irreversible.
  "inventorySerializedAssetAcquirer",
  "equipmentInstaller",
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

check("GOVERNED_BUSINESS_ROLES contains exactly the thirty-eight ids (thirty-one, three reporting tiers, equipment catalog, receiving, two serialized-equipment stations)", () => {
  // The list is pinned so a Role cannot appear by accident. salesperson was added
  // deliberately on the Owner clarification that "salesManager and Sales are
  // different -- the manager is over the salesperson".
  //
  // shopAssociate added 2026-08-21 during the CRUD-matrix reconciliation. The canonical
  // Detailed CRUD sheet declares 24 Role x Object rows for Shop Associate, and this registry
  // had no such Role -- so the business had defined a position the platform could not
  // represent, let alone grant. This pin failing on that addition is the guard working.
  assert.deepEqual(Object.keys(GOVERNED_BUSINESS_ROLES).sort(), [...EXPECTED_IDS].sort());
  assert.equal(ALL_GOVERNED_ROLES.length, 38);
});

check("salesperson and salesManager differ ONLY by audit read, which the canonical matrix declares", () => {
  // Reconciliation 2026-08-21. These were byte-identical, and the comment below explains why that was
  // correct. The canonical Detailed CRUD sheet now differentiates them in exactly one place:
  // Sales Manager / Audit Log = R, Salesperson / Audit Log = blank. That is a real business
  // distinction the Owner's matrix makes, not a manufactured one -- everything else stays identical,
  // and the INTENTIONAL_OVERLAP reasoning below still governs the rest.
  const mgr = new Set(GOVERNED_BUSINESS_ROLES.salesManager.permissions);
  const rep = new Set(GOVERNED_BUSINESS_ROLES.salesperson.permissions);
  const mgrOnly = [...mgr].filter((p) => !rep.has(p)).sort();
  const repOnly = [...rep].filter((p) => !mgr.has(p)).sort();
  assert.deepEqual(mgrOnly, ["audit.event.read"], "the only manager-side difference is audit visibility");
  assert.deepEqual(repOnly, [], "the salesperson holds nothing the manager lacks");
});

check("neither sales Role may convert an Opportunity into a Sales Order... until the matrix says so", () => {
  // Retained from the pre-reconciliation assertion, because two of its three claims still hold and
  // are worth keeping pinned. What changed: the canonical Detailed CRUD sheet grants BOTH sales
  // Roles Opportunities CRE, which maps to opportunity.createSalesOrder -- converting a won
  // opportunity is exactly the business action that cell describes, so it is now granted.
  //
  // The coverage/territory point below is UNCHANGED and still deferred: neither Role has scope
  // authority, because that model does not exist. Recorded as COVERAGE_TERRITORY_AUTHORITY_GAP.
  const sp = [...GOVERNED_BUSINESS_ROLES.salesperson.permissions].sort();
  for (const id of ["opportunity.read", "opportunity.write"]) {
    assert.ok(sp.includes(id), `salesperson must hold ${id}`);
  }
  assert.ok(sp.includes("opportunity.createSalesOrder"), "granted by the canonical Opportunities CRE row");
  // No scope/territory capability is smuggled in alongside it.
  for (const scoped of ["coverage.read", "coverage.write"]) {
    assert.equal(sp.includes(scoped), false, `salesperson must not hold ${scoped} -- territory model is deferred`);
  }
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
check("all thirty-eight governed business Roles are governed-assignable (no UnknownRoleError for any of them)", () => {
  // A Role defined but missing from the allowlist is the worst kind of gap: it appears in the
  // catalog, shows up in every admin surface, and throws UnknownRoleError the moment anyone tries to
  // actually grant it. The two lists are asserted equal in both directions so neither can drift.
  for (const id of EXPECTED_IDS) {
    assert.ok(__GOVERNED_ASSIGNABLE_ROLES_FOR_TEST[id], `${id} must be governed-assignable`);
  }
  assert.equal(
    Object.keys(__GOVERNED_ASSIGNABLE_ROLES_FOR_TEST).length,
    38,
    "the governed allowlist must contain exactly the 38 declared governed business Roles",
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
  for (const permissionId of ["customer.record.read", "workOrder.create", "admin.userStatus.write"]) {
    assert.equal(resolve(permissionId, "generalEmployee", GOVERNED_BUSINESS_ROLES).decision, "DENY");
  }
});

check("Office Manager: Customer read/create/update + Work Order create; no governed-field write, no lifecycle execution, no admin authority", () => {
  for (const id of ["customer.record.read", "customer.record.create", "customer.record.update", "workOrder.create"]) {
    assert.equal(resolve(id, "officeManager", GOVERNED_BUSINESS_ROLES).decision, "ALLOW", id);
  }
  for (const id of ["customer.governedField.write", "workOrder.transition", "workOrder.cancel", "admin.roleAssignment.write"]) {
    assert.equal(resolve(id, "officeManager", GOVERNED_BUSINESS_ROLES).decision, "DENY", id);
  }
});

check("Sales Manager: Customer read/create/update + inventory visibility; still no governed-field write", () => {
  for (const id of ["customer.record.read", "customer.record.create", "customer.record.update", "inventory.transaction.read"]) {
    assert.equal(resolve(id, "salesManager", GOVERNED_BUSINESS_ROLES).decision, "ALLOW", id);
  }
  assert.equal(resolve("customer.governedField.write", "salesManager", GOVERNED_BUSINESS_ROLES).decision, "DENY");
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
  for (const id of ["customer.record.read", "customer.governedField.write", "reorder.purchaseOrder.read"]) {
    assert.equal(resolve(id, "accountingManager", GOVERNED_BUSINESS_ROLES).decision, "ALLOW", id);
  }
  for (const id of ["customer.record.create", "customer.record.update"]) {
    assert.equal(resolve(id, "accountingManager", GOVERNED_BUSINESS_ROLES).decision, "DENY", id);
  }
});

check("Finance Manager: Customer read + governed-field write + PO read; no ordinary Customer create/update", () => {
  for (const id of ["customer.record.read", "customer.governedField.write", "reorder.purchaseOrder.read"]) {
    assert.equal(resolve(id, "financeManager", GOVERNED_BUSINESS_ROLES).decision, "ALLOW", id);
  }
  for (const id of ["customer.record.create", "customer.record.update"]) {
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

// PURCHASING LIVES ON PURCHASING MANAGER, not on Accounting Manager.
//
// The 2026-08-19 ruling "Purchasing falls under accounting" was first implemented by
// granting the workflow to Accounting Manager, because no Purchasing role existed to
// receive it. The Owner's 2026-08-20 roster named Purchasing Manager AND gave Erik BOTH
// roles, which honors the ruling through the PERSON rather than by merging the bundles --
// and keeps a pure Accounting Manager from silently acquiring buying power.
check("Purchasing Manager holds the purchasing workflow; Accounting and Finance Manager do NOT", () => {
  const PURCHASING = [
    "reorder.purchaseOrder.create",
    "reorder.request.read.queue",
    "reorder.request.startPurchasing",
    "reorder.request.recordPurchaseOrder",
    "reorder.request.postPurchasingUpdate",
  ];
  const purchasing = GOVERNED_BUSINESS_ROLES.purchasingManager;
  assert.ok(purchasing, "purchasingManager must exist");
  for (const id of PURCHASING) {
    assert.ok(purchasing.permissions.includes(id), `purchasingManager must hold ${id}`);
    assert.equal(
      ACCOUNTING_MANAGER_ROLE.permissions.includes(id),
      false,
      `accountingManager must NOT hold ${id} -- it moved to purchasingManager on 2026-08-20`,
    );
    assert.equal(
      FINANCE_MANAGER_ROLE.permissions.includes(id),
      false,
      `financeManager must NOT hold ${id}`,
    );
  }
});

check("Purchasing Manager cannot approve, reject or void what it raises", () => {
  // Segregation of duties on the role that actually raises orders.
  const purchasing = GOVERNED_BUSINESS_ROLES.purchasingManager;
  for (const id of ["reorder.request.approve", "reorder.request.reject", "reorder.purchaseOrder.void"]) {
    assert.equal(purchasing.permissions.includes(id), false, `purchasingManager must NOT hold ${id}`);
  }
});

check("Shop Manager exists, is assignable, and deliberately holds nothing", () => {
  // The roster names the position; the CRUD matrix declares no Role x Object row for it.
  // An empty Role is the honest encoding -- copying Service Manager's grants on the
  // strength of a similar job description would invent authority the business never stated,
  // and an invented grant is indistinguishable from a decided one once it is in the file.
  const shop = GOVERNED_BUSINESS_ROLES.shopManager;
  assert.ok(shop, "shopManager must exist");
  // The matrix HAS declared its rows. This assertion previously required an empty grant "until the
  // matrix declares a row" -- the canonical Detailed CRUD sheet declares all 24, and the authority
  // below is derived from those rows alone. Deliberately service-shaped: Work Orders CRE, dispatch
  // schedule, technician time, equipment; and deliberately NOT warehouse-shaped -- no receiving, no
  // transfers, no inventory adjustment. The stale Summary sheet had those, copied from Warehouse.
  assert.ok(shop.permissions.includes("workOrder.create"), "Shop Manager runs the shop floor");
  assert.ok(shop.permissions.includes("workOrder.transition"));
  for (const warehouseOnly of ["inventory.stock.receive", "inventory.transfer.create", "inventory.cycleCount.reconcile"]) {
    assert.equal(shop.permissions.includes(warehouseOnly), false,
      `Shop is a service role: ${warehouseOnly} belongs to Parts/Warehouse`);
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
    accountingSet.has("customer.governedField.write"),
    "parity was reached by RAISING Accounting to Finance, not by lowering Finance",
  );
  // The 2026-08-19 purchasing grant briefly made Accounting exceed Finance. The 2026-08-20
  // roster moved purchasing to its own Role, so the two are identical again -- which is the
  // 2026-08-18 parity ruling, restored rather than broken. Asserted as "at least", so a
  // future Accounting-only grant is still permitted without editing this back.
  assert.ok(
    ACCOUNTING_MANAGER_ROLE.permissions.length >= FINANCE_MANAGER_ROLE.permissions.length,
    "Accounting must never fall below Finance -- the 2026-08-18 parity ruling raised it to match",
  );
});

// Owner ruling 2026-08-19: "need a marketing top top equal to salesManager".
check("Marketing Manager exists, is a peer of Sales Manager, and holds only reads", () => {
  const marketing = GOVERNED_BUSINESS_ROLES.marketingManager;
  assert.ok(marketing, "marketingManager must exist");
  assert.equal(marketing.compatibility, false);
  for (const id of ["customer.record.read", "opportunity.read", "salesOrder.read"]) {
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
  for (const id of ["customer.record.read", "workOrder.create", "workOrder.transition", "workOrder.cancel", "inventory.transaction.read"]) {
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
    "customer.record.read",
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
  assert.equal(resolve("customer.record.create", "operationsManager", GOVERNED_BUSINESS_ROLES).decision, "ALLOW");
  for (const id of [
    "customer.record.update",
    "customer.governedField.write",
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
    "customer.record.read", "customer.record.create", "customer.governedField.write",
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
    "customer.record.create", "customer.record.update", "customer.governedField.write",
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
  // WIDENED 2026-08-21 by the CRUD-matrix reconciliation, each addition traced to an exact canonical
  // row granting "Parts Catalog CRE" -- writing the parts catalog, which is precisely what
  // inventory.catalog.manage governs. Semantic equivalence, not adjacency:
  //
  //   generalManager     Parts Catalog CRE, scope Enterprise
  //   warehouseManager   Parts Catalog CRE, scope Warehouse / enterprise inventory
  //   partsManager       Parts Catalog CRE, scope Service organization
  //
  // fieldManager is retained on a DIFFERENT basis: the canonical row says Parts Catalog = R, which
  // conflicts with a specific recorded Owner ruling granting it manage. Owner precedence rule
  // 2026-08-21 keeps the recorded decision and logs the conflict as MATRIX_OWNER_DECISION_CONFLICT
  // rather than letting a spreadsheet silently revoke it.
  //
  // ACTIVATE is deliberately NOT widened -- see below.
  const EXPECTED_MANAGE = [
    "fieldManager",
    "generalManager",
    "inventoryCatalogAdministrator",
    "inventoryCreateExecutor",
    "operationsManager",
    "owner",
    "partsManager",
    "warehouseManager",
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
    "customer.record.read", "customer.record.create", "customer.governedField.write",
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

check("warehouse RECORD and STOCK-LOCATION read stay confined; transferOrder read follows the canonical matrix (Spec 27.4)", () => {
  // SPLIT 2026-08-21. This check previously treated all three warehouse ids as one confined set. The
  // canonical Detailed CRUD sheet grants Transfer Orders R or CRE to seven roles, so they are no
  // longer one thing, and the reasoning the purchasingManager branch already recorded -- "a buyer who
  // cannot see stock movements is buying blind" -- generalises to the others.
  //
  // The claim worth protecting is the NARROW one, and it is unchanged: warehouse.record.read and
  // warehouse.stockLocation.read remain confined to Operations Manager and owner. Seeing that a
  // transfer happened is not the same authority as reading the warehouse register or its bins.
  //
  // Note CRE rows grant READ ONLY here. Transfer EXECUTION is inventoryTransferOperator, a functional
  // Role assigned per employee -- a CRUD cell does not confer it.
  const CONFINED = ["warehouse.record.read", "warehouse.stockLocation.read"];
  for (const role of Object.values(GOVERNED_BUSINESS_ROLES)) {
    if (role.id === "operationsManager") {
      for (const id of CONFINED) assert.ok(role.permissions.includes(id), `operationsManager must hold ${id}`);
      continue;
    }
    if (role.id === "owner") continue; // mirrors admin; pinned by its own dedicated check
    for (const id of CONFINED) {
      assert.equal(role.permissions.includes(id), false, `${role.id} must not hold ${id}`);
    }
  }

  // transferOrder.read is granted, and only to roles whose canonical row declares it.
  const EXPECTED_TRANSFER_READ = [
    "accountingManager", "controller", "generalManager", "operationsManager", "owner",
    "purchasingManager", "warehouseAssociate", "warehouseManager",
  ];
  const actual = Object.values(GOVERNED_BUSINESS_ROLES)
    .filter((r) => r.permissions.includes("warehouse.transferOrder.read"))
    .map((r) => r.id).sort();
  assert.deepEqual(actual, EXPECTED_TRANSFER_READ, "exactly the roles the canonical matrix grants Transfer Orders read");
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

check("definition-CRUD splits: Owner holds all five, reportAuthor holds the three non-destructive, delete stays Owner-only", () => {
  // REWRITTEN 2026-08-21 for the Owner's Reporting decision. This previously asserted that Owner
  // was the ONLY Role holding any definition id. The approved model creates `reportAuthor`, so that
  // exact sentence is no longer the invariant -- but the reason it existed is, and it splits in two:
  //
  //   AUTHORING is delegable      -- create, rename and duplicate go to reportAuthor.
  //   DELETING is not             -- destroying a shared definition removes something other people
  //                                  depend on, and there is no per-definition ownership model to
  //                                  scope it. The Owner kept it Owner/Admin-only, explicitly.
  //
  // So the check gets STRONGER rather than looser: it now pins which three ids may be delegated and
  // asserts the fourth is held by nobody else, where before it only asserted "not owner, not held".
  const AUTHORABLE = ["report.definition.create", "report.definition.rename", "report.definition.duplicate"];
  const OWNER_ONLY = ["report.definition.delete"];

  for (const id of DEFINITION_CRUD_IDS) {
    assert.ok(OWNER_ROLE.permissions.includes(id), `owner must still hold ${id}`);
  }
  for (const role of Object.values(COMPATIBILITY_ROLES)) {
    // admin is exempted, not overlooked: the 2026-08-19 Owner ruling ("Admin and Owner have full
    // access to all possible features and permissions") gives admin the ENTIRE catalog.
    if (role.id === "admin") continue;
    assert.equal(
      role.permissions.some((id) => DEFINITION_CRUD_IDS.includes(id)), false,
      `compatibility Role "${role.id}" must not hold a definition-CRUD id`,
    );
  }
  // reportAuthor holds EXACTLY the authorable three -- not a subset, not a superset.
  assert.deepEqual(
    [...GOVERNED_BUSINESS_ROLES.reportAuthor.permissions].sort(), [...AUTHORABLE].sort(),
    "reportAuthor must carry exactly create/rename/duplicate",
  );
  // reportViewer holds the definition READ and nothing else from that family.
  assert.deepEqual(
    GOVERNED_BUSINESS_ROLES.reportViewer.permissions.filter((id) => DEFINITION_CRUD_IDS.includes(id)),
    ["report.definition.read"],
    "reportViewer may open a saved definition and must not author or delete one",
  );
  // Nobody but owner holds delete. This is the half of the old assertion that must never weaken.
  for (const role of ALL_GOVERNED_ROLES) {
    if (role.id === "owner") continue;
    for (const id of OWNER_ONLY) {
      assert.equal(
        role.permissions.includes(id), false,
        `governed business Role "${role.id}" must not hold ${id} -- destroying a shared report `
        + `definition stays Owner/Admin-only by Owner decision 2026-08-21`,
      );
    }
    // The split is THREE-way, not two. report.definition.read is a READ: opening a saved
    // definition is not authoring one, so it belongs to reportViewer. Lumping it in with
    // create/rename/duplicate would force every report reader to hold authoring rights,
    // which is the over-grant the tiering exists to prevent.
    if (role.id === "reportAuthor" || role.id === "reportViewer") continue;
    assert.equal(
      role.permissions.some((id) => DEFINITION_CRUD_IDS.includes(id)), false,
      `governed business Role "${role.id}" must not hold a definition-CRUD id -- only owner, `
      + `reportViewer (read) and reportAuthor (create/rename/duplicate) do`,
    );
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

// The three approved Reporting tiers. Owner decision 2026-08-21.
const REPORTING_ROLE_IDS = ["reportViewer", "reportFinanceViewer", "reportAuthor"];

check("report.* is confined to owner and the three approved Reporting tiers -- NO business title holds one", () => {
  // REWRITTEN 2026-08-21. This previously asserted Owner was the only Role holding any report.* id.
  // The Owner approved a tiered functional-role model, so that literal sentence is gone -- but the
  // invariant underneath it is not only intact, it is now SHARPER.
  //
  // The old check protected "reporting is not yet distributed". The real risk was never that a
  // reporting Role would exist; it was that 39 ids would end up copied into ten business titles,
  // so that inheriting a manager's list silently granted payment terms. The Owner's decision was
  // explicit that report grants stay CAPABILITY-DRIVEN, NOT JOB-TITLE HARDCODED.
  //
  // So this now asserts exactly that: a report.* id may live on owner or on one of the three
  // reporting tiers, and on NOTHING ELSE -- not on generalManager, not on controller, not on any
  // position. That is a claim the old assertion could not make, because it had no vocabulary for a
  // legitimate reporting Role.
  for (const role of Object.values(COMPATIBILITY_ROLES)) {
    // admin is exempted, not overlooked: the 2026-08-19 Owner ruling gives admin the ENTIRE catalog.
    if (role.id === "admin") continue;
    assert.equal(
      role.permissions.some((id) => id.startsWith("report.")), false,
      `compatibility Role "${role.id}" must not hold a report.* id`,
    );
  }
  for (const role of ALL_GOVERNED_ROLES) {
    const holdsReport = role.permissions.some((id) => id.startsWith("report."));
    if (role.id === "owner") {
      assert.equal(holdsReport, true, "owner must still hold reporting");
    } else if (REPORTING_ROLE_IDS.includes(role.id)) {
      assert.equal(holdsReport, true, `${role.id} is a Reporting tier and must carry report.* ids`);
    } else {
      assert.equal(
        holdsReport, false,
        `governed business Role "${role.id}" must not hold a report.* id. Reporting is granted `
        + `through reportViewer / reportFinanceViewer / reportAuthor, per the Owner decision that `
        + `report grants stay capability-driven rather than hardcoded onto job titles.`,
      );
    }
  }
  // The finance-sensitive fields must not leak into the ordinary tier. This is the whole reason
  // there are two read tiers instead of one.
  const FINANCE_SENSITIVE = [
    "report.customer.field.paymentTerms.read", "report.customer.field.taxStatus.read",
    "report.customer.field.commercialProfile.read", "report.customer.field.billingContact.read",
    "report.customer.field.billingAddress.read",
  ];
  for (const id of FINANCE_SENSITIVE) {
    assert.equal(
      GOVERNED_BUSINESS_ROLES.reportViewer.permissions.includes(id), false,
      `reportViewer must not carry the finance-sensitive field ${id} -- that is reportFinanceViewer`,
    );
    assert.ok(
      GOVERNED_BUSINESS_ROLES.reportFinanceViewer.permissions.includes(id),
      `reportFinanceViewer must carry ${id}`,
    );
  }
});

check("no compatibility Role and no BUSINESS-TITLE governed Role can resolve a report.* capability", () => {
  const sampleIds = ["report.customer.read", "report.customer.field.name.read", "report.equipment.field.location.read"];
  for (const id of sampleIds) {
    // admin is NOT asserted here -- it holds the full catalog by the 2026-08-19 ruling and correctly
    // ALLOWs. dispatcher and technician are the Roles this check exists to protect.
    assert.equal(resolve(id, "dispatcher", COMPATIBILITY_ROLES).decision, "DENY", `dispatcher + ${id}`);
    assert.equal(resolve(id, "technician", COMPATIBILITY_ROLES).decision, "DENY", `technician + ${id}`);
    for (const role of ALL_GOVERNED_ROLES) {
      if (role.id === "owner" || REPORTING_ROLE_IDS.includes(role.id)) continue;
      assert.equal(
        resolve(id, role.id, GOVERNED_BUSINESS_ROLES).decision, "DENY",
        `${role.id} + ${id} -- a business title must not resolve reporting`,
      );
    }
  }
  // And the positive half, resolver-verified: the tier that SHOULD read it does. Asserting only
  // denials would let the tiers be defined as empty and still pass.
  assert.equal(
    resolve("report.customer.field.name.read", "reportViewer", GOVERNED_BUSINESS_ROLES).decision,
    "ALLOW", "reportViewer must actually resolve an ordinary report field",
  );
  assert.equal(
    resolve("report.customer.field.paymentTerms.read", "reportFinanceViewer", GOVERNED_BUSINESS_ROLES).decision,
    "ALLOW", "reportFinanceViewer must actually resolve a finance-sensitive field",
  );
  // The separation, resolver-verified rather than asserted from the permission list.
  assert.equal(
    resolve("report.customer.field.paymentTerms.read", "reportViewer", GOVERNED_BUSINESS_ROLES).decision,
    "DENY", "reportViewer must be DENIED the finance-sensitive fields",
  );
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
  assert.ok(ADMIN_ROLE.permissions.includes("customer.governedField.write"));
  assert.ok(ADMIN_ROLE.permissions.includes("admin.roleAssignment.write"));
});

check("resolving against COMPATIBILITY_ROLES alone (no governed business Roles mixed in) is unaffected by this file existing", () => {
  assert.equal(resolve("customer.record.read", "admin", COMPATIBILITY_ROLES).decision, "ALLOW");
  assert.equal(resolve("customer.record.read", "technician", COMPATIBILITY_ROLES).decision, "DENY");
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
