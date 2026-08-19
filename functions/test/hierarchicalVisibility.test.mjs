// Hierarchical visibility -- who can see whose records.
//
// roleHierarchy.test.mjs proves the TREE is shaped correctly. This proves the thing
// built on it resolves real principals to real employees, and -- more importantly --
// that it fails closed in every direction it can be wrong.
//
// The dangerous failure here is silent: leaking one branch to another shows nothing
// broken on screen, it just quietly shows someone work that is not theirs. So the
// negative cases carry more weight than the positive ones.
//
// Prerequisite: npm run build in functions/ (imports from ../lib/).
import assert from "node:assert/strict";
import {
  visibleRoleIdsFor,
  visibleEmployeeIdsFor,
  canSeeEmployeeRecords,
} from "../lib/access/hierarchicalVisibility.js";

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

// A population shaped like the real sandbox: one person per position.
const POP = [
  { principalUid: "u-gm", employeeId: "e-gm", roleIds: ["generalManager"] },
  { principalUid: "u-admin", employeeId: "e-admin", roleIds: ["admin"] },
  { principalUid: "u-salesmgr", employeeId: "e-salesmgr", roleIds: ["salesManager"] },
  { principalUid: "u-sales1", employeeId: "e-sales1", roleIds: ["salesperson"] },
  { principalUid: "u-sales2", employeeId: "e-sales2", roleIds: ["salesperson"] },
  { principalUid: "u-opsmgr", employeeId: "e-opsmgr", roleIds: ["operationsManager"] },
  { principalUid: "u-svcmgr", employeeId: "e-svcmgr", roleIds: ["fieldManager"] },
  { principalUid: "u-disp", employeeId: "e-disp", roleIds: ["dispatcher"] },
  { principalUid: "u-tech", employeeId: "e-tech", roleIds: ["technician"] },
  { principalUid: "u-whmgr", employeeId: "e-whmgr", roleIds: ["warehouseManager"] },
  { principalUid: "u-wh1", employeeId: "e-wh1", roleIds: ["warehouseAssociate"] },
  { principalUid: "u-finmgr", employeeId: "e-finmgr", roleIds: ["financeManager"] },
  { principalUid: "u-catalog", employeeId: "e-catalog", roleIds: ["inventoryCatalogAdministrator"] },
  { principalUid: "u-noroles", employeeId: "e-noroles", roleIds: [] },
];

const sees = (uid) => [...visibleEmployeeIdsFor(uid, POP)].sort();

console.log("hierarchicalVisibility.test.mjs");

check("a manager sees their own branch and themselves", () => {
  assert.deepEqual(sees("u-salesmgr"), ["e-sales1", "e-sales2", "e-salesmgr"]);
});

check("BRANCH ISOLATION: a manager sees nothing from a sibling branch", () => {
  // The failure this whole module exists to prevent.
  const salesView = sees("u-salesmgr");
  for (const outsider of ["e-tech", "e-disp", "e-whmgr", "e-wh1", "e-finmgr", "e-svcmgr", "e-opsmgr"]) {
    assert.equal(salesView.includes(outsider), false, `sales manager must not see ${outsider}`);
  }
  const opsView = sees("u-opsmgr");
  for (const outsider of ["e-sales1", "e-sales2", "e-salesmgr", "e-finmgr"]) {
    assert.equal(opsView.includes(outsider), false, `operations manager must not see ${outsider}`);
  }
});

check("visibility is transitive down a branch", () => {
  // Operations sees Service, and through it Dispatcher and Technician, without any
  // direct edge to either.
  const opsView = sees("u-opsmgr");
  for (const beneath of ["e-svcmgr", "e-disp", "e-tech", "e-whmgr", "e-wh1"]) {
    assert.ok(opsView.includes(beneath), `operations manager must see ${beneath}`);
  }
});

check("PEERS DO NOT SEE EACH OTHER", () => {
  // Two salespeople under one manager see only themselves. Peer visibility is a
  // decision nobody has made, and defaulting it ON is the expensive direction.
  assert.deepEqual(sees("u-sales1"), ["e-sales1"]);
  assert.deepEqual(sees("u-sales2"), ["e-sales2"]);
});

check("visibility never flows upward", () => {
  assert.equal(sees("u-tech").includes("e-svcmgr"), false);
  assert.equal(sees("u-disp").includes("e-svcmgr"), false);
  assert.equal(sees("u-sales1").includes("e-salesmgr"), false);
});

check("a leaf still sees their own records", () => {
  // A Role with nobody beneath it resolves to an empty descendant set; without the
  // explicit self-inclusion the viewer would be hidden from themselves.
  assert.deepEqual(sees("u-tech"), ["e-tech"]);
  assert.deepEqual(sees("u-wh1"), ["e-wh1"]);
});

check("capability-specific Roles confer NO visibility, in either direction", () => {
  // Holding "may administer the catalog" is a grant, not a position.
  assert.deepEqual(sees("u-catalog"), ["e-catalog"]);
  // And nobody sees the catalog administrator BY that Role -- they would only be
  // visible through a position they also hold, which this principal does not have.
  assert.equal(sees("u-gm").includes("e-catalog"), false);
});

check("a principal with no Roles at all sees only themselves", () => {
  assert.deepEqual(sees("u-noroles"), ["e-noroles"]);
});

check("an unknown principal sees NOTHING -- not everything", () => {
  // The fail-open bug this guards: an unrecognised viewer resolving to an
  // unfiltered result set.
  assert.deepEqual(sees("u-does-not-exist"), []);
  assert.deepEqual(sees(""), []);
  assert.deepEqual([...visibleEmployeeIdsFor("u-gm", [])], []);
});

check("the top of the tree sees every branch", () => {
  const gmView = sees("u-gm");
  for (const anyone of ["e-sales1", "e-tech", "e-wh1", "e-finmgr", "e-disp", "e-salesmgr"]) {
    assert.ok(gmView.includes(anyone), `general manager must see ${anyone}`);
  }
});

check("canSeeEmployeeRecords treats an UNOWNED record as not visible", () => {
  // An unowned record must not be "visible to everyone" by default -- that turns an
  // ownership rule into an open door.
  assert.equal(canSeeEmployeeRecords("u-salesmgr", "e-sales1", POP), true);
  assert.equal(canSeeEmployeeRecords("u-salesmgr", "e-tech", POP), false);
  assert.equal(canSeeEmployeeRecords("u-gm", null, POP), false);
  assert.equal(canSeeEmployeeRecords("u-gm", undefined, POP), false);
  assert.equal(canSeeEmployeeRecords("u-gm", "", POP), false);
});

check("visibleRoleIdsFor excludes the viewer's own Role", () => {
  const roles = visibleRoleIdsFor(["salesManager"]);
  assert.equal(roles.has("salesperson"), true);
  assert.equal(roles.has("salesManager"), false, "own Role must not be included");
});

check("holding several Roles unions their branches", () => {
  const both = visibleRoleIdsFor(["salesManager", "financeManager"]);
  assert.equal(both.has("salesperson"), true);
  assert.equal(both.has("accountingManager"), true);
  assert.equal(both.has("technician"), false, "still nothing from a branch neither Role heads");
});

console.log(`\n${passed} passed, 0 failed`);
