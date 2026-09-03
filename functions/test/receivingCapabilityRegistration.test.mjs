// EI Phase-2 Receiving -- Capability Grant Gate: OFFLINE proof that inventory.stock.receive is registered
// AND granted to EXACTLY the governed admin + dispatcher compatibility Roles, with NO superuser/wildcard,
// no operational-role, and no PARTS_ASSOCIATE bypass. Pure `node`: NO emulator, NO network, NO production.
// Runs the compiled ../lib output. Importing these registries writes NOTHING.
// Prerequisite: npm run build. Run: node test/receivingCapabilityRegistration.test.mjs
import assert from "node:assert/strict";
import { PERMISSION_CATALOG, isActivePermission } from "../lib/access/permissionCatalog.js";
import { COMPATIBILITY_ROLES } from "../lib/access/compatibilityRoles.js";
import { GOVERNED_BUSINESS_ROLES } from "../lib/access/governedBusinessRoles.js";

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`PASS: ${name}`); }
  catch (err) { failed += 1; console.error(`FAIL: ${name}`); console.error(err); }
}

const CAP = "inventory.stock.receive";
// Every role object that can hold capability grants (the resolver's authoritative grant sources).
const ALL_ROLES = { ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES };

check("catalog resolves the EXACT tuple exactly once", () => {
  const matches = PERMISSION_CATALOG.filter((p) => p.id === CAP);
  assert.equal(matches.length, 1, "exactly one inventory.stock.receive entry");
  const e = matches[0];
  assert.equal(e.id, "inventory.stock.receive");
  assert.equal(e.resource, "inventory.stock");
  assert.equal(e.action, "receive");
  assert.equal(Object.isFrozen(e), true);
  assert.equal("active" in e, false); // grantable (not the inactive equipment.* posture)
});

// The direct grant targets admin + dispatcher; the governed OWNER role is defined as a SUPERSET of admin
// (OWNER_PERMISSIONS = [...ADMIN_ROLE.permissions, ...reports]), so it necessarily inherits this capability
// by explicit role composition -- NOT a wildcard/claim/users.role bypass, and it cannot be excluded without
// breaking the owner>=admin invariant. Flagged for Owner/Codex ratification.
// AMENDED 2026-08-21 by Owner decision. inventoryReceivingClerk joins this set -- and only it.
//
// The capacity report found Receiving had ZERO assigned workers and 32 operable ones, every one of
// them through legacy compatibility authority: everybody able to receive, nobody accountable for it.
// The Owner directed a NARROW STANDALONE receiving Role rather than composition into an associate
// title, so receiving became a named station granted per employee.
//
// WHAT THIS AMENDMENT DOES NOT DO, which is the part worth checking on every future edit:
//   - it grants receiving to NO business title. warehouseAssociate, partsAssociate, partsManager
//     and warehouseManager still do not hold it, and the checks below still prove that.
//   - it does not resolve the PARTS_ASSOCIATE deferral recorded in compatibilityRoles.ts. That
//     deferral waits on "a separately ratified scoped model or an explicit Owner acceptance of
//     global Receiving authority", and a standalone per-employee Role is neither.
//   - it does not touch the compatibility Roles, whose definitions the Owner ruled stay unchanged.
//
// The first-slice deferral this file was written to protect is therefore intact: what changed is
// that receiving now has a NAME to grant, instead of being reachable only by holding a legacy role
// that happens to include it.
const RECEIVE_HOLDERS = ["admin", "dispatcher", "inventoryReceivingClerk", "owner"];
check("inventory.stock.receive is granted by EXACTLY admin + dispatcher + inventoryReceivingClerk (+ owner, which inherits admin)", () => {
  const grantingRoles = Object.entries(ALL_ROLES)
    .filter(([, r]) => Array.isArray(r.permissions) && r.permissions.includes(CAP))
    .map(([n]) => n).sort();
  assert.deepEqual(grantingRoles, [...RECEIVE_HOLDERS].sort(), "held by exactly admin, dispatcher, inventoryReceivingClerk, owner");
});

check("admin + dispatcher DO hold it; technician + operational roles do NOT", () => {
  assert.equal(ALL_ROLES.admin.permissions.includes(CAP), true, "admin holds it");
  assert.equal(ALL_ROLES.dispatcher.permissions.includes(CAP), true, "dispatcher holds it");
  for (const name of ["technician", "PARTS_MANAGER", "WAREHOUSE_MANAGER", "PARTS_ASSOCIATE"]) {
    const role = ALL_ROLES[name];
    if (role) assert.equal(role.permissions.includes(CAP), false, `${name} must not grant ${CAP}`);
    else assert.equal(role, undefined, `${name} is not a capability grant-holder (holds no catalog capability)`);
  }
});

check("NO business title holds receiving -- it is a named station, not a property of a job", () => {
  // Stated separately from the exact-set check because it must survive the set being extended
  // again. If a future decision adds another receiving Role, that is a decision; a business title
  // acquiring receiving is the drift this whole design exists to prevent.
  for (const name of ["PARTS_ASSOCIATE", "PARTS_MANAGER", "WAREHOUSE_MANAGER", "warehouseAssociate",
                      "partsAssociate", "partsManager", "warehouseManager", "generalManager",
                      "shopManager", "shopAssociate", "technician"]) {
    const role = ALL_ROLES[name];
    if (!role) continue;
    assert.equal(
      role.permissions.includes(CAP), false,
      `${name} must not grant ${CAP} -- receiving is granted through inventoryReceivingClerk, per `
      + `employee, so that accepting custody of goods has a named accountable person`,
    );
  }
});

check("PARTS_ASSOCIATE + every role except the receive-holders is NOT granted it (first-slice deferral)", () => {
  const holders = new Set(RECEIVE_HOLDERS);
  for (const [n, r] of Object.entries(ALL_ROLES)) {
    if (holders.has(n)) continue;
    assert.equal(Array.isArray(r.permissions), true, `${n} has a permissions array`);
    assert.equal(r.permissions.includes(CAP), false, `${n} must not grant ${CAP}`);
  }
  assert.equal(ALL_ROLES.PARTS_ASSOCIATE, undefined, "PARTS_ASSOCIATE is an operational role, not a grant-holder");
});

check("NO superuser / wildcard bypass exists (no role grants '*' or the id via wildcard)", () => {
  for (const [roleName, role] of Object.entries(ALL_ROLES)) {
    for (const p of role.permissions) {
      assert.notEqual(p, "*", `${roleName} must not hold a wildcard '*' grant`);
      assert.equal(/[*]/.test(p), false, `${roleName} grant "${p}" must not contain a wildcard`);
    }
  }
});

check("no unrelated capability changed: inventory.stock.receive is the only ACTIVE stock grant", () => {
  // admin/dispatcher share one base. This guard exists to catch an unintended real grant, and it
  // still does -- but it now has to account for how this catalog actually works.
  //
  // A compatibility role DERIVES its permission array from the catalog, so registering a new id
  // makes it appear here automatically, with no explicit grant written anywhere. BIN-P6 /
  // DECISIONS #169 registered inventory.stock.relocate that way.
  //
  // So the assertion is STRENGTHENED rather than relaxed: membership alone is no longer the
  // interesting fact, and what matters is that exactly one of these ids is ACTIVE. An inert id
  // denies for every role (reason: inactivePermission); an active one is a real authority. If a
  // future capability lands active, or relocate is ever flipped on without BIN-P4's activation
  // gate, this fails -- which is the thing the original check was protecting.
  for (const name of ["admin", "dispatcher"]) {
    const stockIds = ALL_ROLES[name].permissions.filter((p) => p.startsWith("inventory.stock.")).sort();
    // Every id present must be one of the two reviewed ones. admin derives both; dispatcher carries
    // an explicit narrower list and holds only receive -- so membership is asserted as a SUBSET
    // rather than an exact list that would be wrong for one of the two roles.
    for (const id of stockIds) {
      assert.ok(["inventory.stock.receive", "inventory.stock.relocate"].includes(id), `${name} holds an unreviewed ${id}`);
    }
    assert.ok(stockIds.includes("inventory.stock.receive"), `${name} still holds inventory.stock.receive`);
    // The real invariant: exactly one of them confers authority. The rest are inert.
    const active = stockIds.filter((id) => isActivePermission(id));
    assert.deepEqual(active, ["inventory.stock.receive"], `${name}: inventory.stock.receive is the only ACTIVE stock capability`);
  }
  // dispatcher gained nothing admin-only; the admin-only extras are unchanged and NOT on dispatcher.
  for (const adminOnly of ["customer.governedField.write", "admin.roleAssignment.write"]) {
    assert.equal(ALL_ROLES.admin.permissions.includes(adminOnly), true);
    assert.equal(ALL_ROLES.dispatcher.permissions.includes(adminOnly), false);
  }
});

check("existing capabilities are unchanged (a spot-check of known granted ids still resolves)", () => {
  const ids = new Set(PERMISSION_CATALOG.map((p) => p.id));
  for (const known of ["reorder.request.markReceived", "reorder.request.recordPurchaseOrder", "inventory.catalog.manage"]) {
    assert.equal(ids.has(known), true, `existing capability ${known} still present`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
