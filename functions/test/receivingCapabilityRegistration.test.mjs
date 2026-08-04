// EI Phase-2 Receiving -- Capability Grant Gate: OFFLINE proof that inventory.stock.receive is registered
// AND granted to EXACTLY the governed admin + dispatcher compatibility Roles, with NO superuser/wildcard,
// no operational-role, and no PARTS_ASSOCIATE bypass. Pure `node`: NO emulator, NO network, NO production.
// Runs the compiled ../lib output. Importing these registries writes NOTHING.
// Prerequisite: npm run build. Run: node test/receivingCapabilityRegistration.test.mjs
import assert from "node:assert/strict";
import { PERMISSION_CATALOG } from "../lib/access/permissionCatalog.js";
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
const RECEIVE_HOLDERS = ["admin", "dispatcher", "owner"];
check("inventory.stock.receive is granted by EXACTLY admin + dispatcher (+ owner, which inherits admin)", () => {
  const grantingRoles = Object.entries(ALL_ROLES)
    .filter(([, r]) => Array.isArray(r.permissions) && r.permissions.includes(CAP))
    .map(([n]) => n).sort();
  assert.deepEqual(grantingRoles, [...RECEIVE_HOLDERS].sort(), "held by exactly admin, dispatcher, owner");
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

check("no unrelated capability changed: the added grant is inventory.stock.receive ONLY", () => {
  // admin/dispatcher share one base; the ONLY receive-related id either holds is inventory.stock.receive.
  for (const name of ["admin", "dispatcher"]) {
    const receiveish = ALL_ROLES[name].permissions.filter((p) => p.startsWith("inventory.stock."));
    assert.deepEqual(receiveish, ["inventory.stock.receive"], `${name} gained only inventory.stock.receive`);
  }
  // dispatcher gained nothing admin-only; the admin-only extras are unchanged and NOT on dispatcher.
  for (const adminOnly of ["account.governedField.write", "admin.roleAssignment.write"]) {
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
