// Role hierarchy -- the organisation tree, and the isolation it has to guarantee.
//
// The Owner's model: anyone above sees what is below them, and people at the same
// level in DIFFERENT branches see nothing of each other. The second half is the
// part worth testing hardest, because getting it wrong leaks a whole branch's work
// to a peer who should never see it, and nothing in the UI would look broken.
//
// Prerequisite: npm run build in functions/ (imports from ../lib/).
import assert from "node:assert/strict";
import {
  ROLE_HIERARCHY,
  NON_HIERARCHICAL_ROLES,
  PLACEMENT_GAPS,
  ancestorsOf,
  descendantsOf,
  canSeeAcrossHierarchy,
} from "../lib/access/roleHierarchy.js";
import { GOVERNED_BUSINESS_ROLES } from "../lib/access/governedBusinessRoles.js";
import { COMPATIBILITY_ROLES } from "../lib/access/compatibilityRoles.js";

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok - ${name}`);
  } catch (err) {
    console.error(`  FAIL - ${name}`);
    throw err;
  }
}

console.log("roleHierarchy.test.mjs");

check("the tree has exactly one root and no cycles", () => {
  const roots = Object.values(ROLE_HIERARCHY).filter((n) => n.parent === null);
  assert.deepEqual(roots.map((r) => r.roleId), ["owner"]);
  // ancestorsOf is cycle-safe by construction; this proves the DATA is acyclic too,
  // since a cycle would make a Role its own ancestor.
  for (const id of Object.keys(ROLE_HIERARCHY)) {
    assert.equal(ancestorsOf(id).includes(id), false, `${id} is its own ancestor`);
  }
});

check("every parent named in the tree is itself a placed Role", () => {
  for (const node of Object.values(ROLE_HIERARCHY)) {
    if (node.parent === null) continue;
    assert.ok(ROLE_HIERARCHY[node.parent], `${node.roleId} names unplaced parent ${node.parent}`);
  }
});

check("every placed Role actually exists", () => {
  const known = { ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES };
  for (const id of Object.keys(ROLE_HIERARCHY)) {
    assert.ok(known[id], `${id} is placed in the tree but is not a defined Role`);
  }
});

check("visibility flows DOWN only -- never up, never sideways, never to a peer", () => {
  assert.equal(canSeeAcrossHierarchy("salesManager", "salesperson"), true);
  assert.equal(canSeeAcrossHierarchy("salesperson", "salesManager"), false, "upward");
  assert.equal(canSeeAcrossHierarchy("salesperson", "salesperson"), false, "same Role");
});

check("BRANCH ISOLATION: peers in different branches see nothing of each other", () => {
  // The Owner's example, verbatim: a Sales Manager sees their salespeople; a
  // Warehouse Manager at the same level sees warehouse people; neither sees the
  // other's side.
  assert.equal(canSeeAcrossHierarchy("salesManager", "warehouseAssociate"), false);
  assert.equal(canSeeAcrossHierarchy("warehouseManager", "salesperson"), false);
  // And siblings WITHIN a branch are isolated from each other too.
  assert.equal(canSeeAcrossHierarchy("warehouseManager", "partsAssociate"), false);
  assert.equal(canSeeAcrossHierarchy("partsManager", "warehouseAssociate"), false);
  assert.equal(canSeeAcrossHierarchy("partsManager", "technician"), false);
});

check("the three branch heads are SIBLINGS, not nested", () => {
  // Corrected 2026-08-19 against the Owner's org chart: an earlier version put
  // salesManager beneath operationsManager, which let operational oversight see the
  // entire sales pipeline. Pinned so it cannot regress.
  assert.equal(ROLE_HIERARCHY.salesManager.parent, ROLE_HIERARCHY.operationsManager.parent);
  assert.equal(ROLE_HIERARCHY.financeManager.parent, ROLE_HIERARCHY.operationsManager.parent);
  assert.equal(canSeeAcrossHierarchy("operationsManager", "salesperson"), false);
  assert.equal(canSeeAcrossHierarchy("financeManager", "salesperson"), false);
  assert.equal(canSeeAcrossHierarchy("salesManager", "technician"), false);
});

check("the service chain is Service Manager -> Dispatcher -> Technician", () => {
  // Owner clarification 2026-08-19: a dispatcher is ABOVE technicians but NOT above
  // the Service Manager. The chart lists Dispatcher and Technicians in one column,
  // which reads as siblings; the order is what makes a dispatcher able to see the
  // work they assign.
  assert.equal(canSeeAcrossHierarchy("dispatcher", "technician"), true);
  assert.equal(canSeeAcrossHierarchy("dispatcher", "fieldManager"), false, "never upward");
  assert.equal(canSeeAcrossHierarchy("technician", "dispatcher"), false, "never upward");
  // The Service Manager reaches technicians transitively -- no direct edge needed.
  assert.equal(canSeeAcrossHierarchy("fieldManager", "technician"), true);
  assert.equal(canSeeAcrossHierarchy("operationsManager", "technician"), true);
});

check("there are FOUR branch heads under admin, and each is blind to the others", () => {
  // Sales, Operations, Finance and Office. Office was the last placement the Owner
  // stated (2026-08-19); before that it sat at admin as an inference.
  const heads = ["salesManager", "operationsManager", "financeManager", "officeManager"];
  for (const head of heads) assert.equal(ROLE_HIERARCHY[head].parent, "admin", head);
  // Exhaustive: no head may see anyone beneath any other head. This is the whole
  // point of the model, so it is checked across every pair rather than sampled.
  for (const viewer of heads) {
    for (const other of heads) {
      if (viewer === other) continue;
      for (const subject of descendantsOf(other)) {
        assert.equal(
          canSeeAcrossHierarchy(viewer, subject),
          false,
          `${viewer} must not see ${subject}`,
        );
      }
    }
  }
});

check("EVERY placement in the tree is Owner-stated, not inferred", () => {
  // The tree started with six inferred placements; all were replaced by the org
  // chart and the clarifications that followed. An inferred placement silently
  // grants or denies visibility, so none should remain -- and a future addition
  // that is guessed rather than stated fails here until someone confirms it.
  const inferred = Object.values(ROLE_HIERARCHY)
    .filter((n) => !n.stated)
    .map((n) => n.roleId);
  assert.deepEqual(inferred, []);
});

check("each branch head sees its own branch, whole", () => {
  assert.deepEqual([...descendantsOf("salesManager")].sort(), ["salesperson"]);
  assert.deepEqual(
    [...descendantsOf("operationsManager")].sort(),
    // shopManager joined 2026-08-20 (Owner roster, Willie): a Service-organization position
    // under the Service Manager, which sits under Operations -- so it is an Operations
    // descendant transitively. It holds no capabilities; hierarchy is visibility, not authority.
    ["dispatcher", "fieldManager", "partsAssociate", "partsManager", "shopManager", "technician", "warehouseAssociate", "warehouseManager"],
  );
  // purchasingManager joined 2026-08-20 under Finance, following the ruling that purchasing
  // falls under accounting. The roster gives Erik both Accounting Manager and Purchasing
  // Manager, so the reporting line is real rather than nominal.
  assert.deepEqual([...descendantsOf("financeManager")].sort(), ["accountingManager", "controller", "purchasingManager", "supportStaff"]);
});

check("the top of the chart sees every branch", () => {
  for (const id of ["salesperson", "technician", "warehouseAssociate", "partsAssociate", "supportStaff", "controller"]) {
    assert.equal(canSeeAcrossHierarchy("owner", id), true, `owner must see ${id}`);
    assert.equal(canSeeAcrossHierarchy("generalManager", id), true, `generalManager must see ${id}`);
  }
});

check("capability-specific Roles are outside the tree and confer no visibility", () => {
  // These are grants like "may reconcile a cycle count" -- not rungs. Holding one
  // must not let anyone see anyone.
  for (const id of NON_HIERARCHICAL_ROLES) {
    assert.equal(ROLE_HIERARCHY[id], undefined, `${id} must not be placed in the tree`);
    assert.equal(canSeeAcrossHierarchy(id, "salesperson"), false);
    assert.equal(canSeeAcrossHierarchy("owner", id), false, `${id} is not a position, so nobody sees it as one`);
  }
});

check("an unknown or unplaced Role is fail-closed in both directions", () => {
  // Adding a Role without placing it must not silently widen anything.
  assert.equal(canSeeAcrossHierarchy("nobodySuchRole", "salesperson"), false);
  assert.equal(canSeeAcrossHierarchy("owner", "nobodySuchRole"), false);
  assert.equal(canSeeAcrossHierarchy("", "salesperson"), false);
  assert.equal(canSeeAcrossHierarchy("owner", ""), false);
});

check("the org-chart positions carry NO permissions", () => {
  // Position and authority are separate systems. These Roles exist to place people
  // in the tree; granting them capability is a separate Owner decision, and doing
  // it by accident here would be seven live authority changes at once.
  for (const id of [
    "generalManager",
    "warehouseManager",
    "warehouseAssociate",
    "partsManager",
    "partsAssociate",
    "controller",
    "supportStaff",
  ]) {
    assert.deepEqual(GOVERNED_BUSINESS_ROLES[id].permissions, [], `${id} must carry no permissions yet`);
  }
});

check("remaining placement gaps are declared rather than silently resolved", () => {
  // Only the sales-channel question should remain: National Accounts vs Retail is a
  // property of the DEAL, not a Role, and resolving it is the deferred coverage model.
  assert.equal(PLACEMENT_GAPS.length, 1);
  assert.match(PLACEMENT_GAPS[0], /National Accounts/);
});

console.log(`\n${passed} passed, 0 failed`);
