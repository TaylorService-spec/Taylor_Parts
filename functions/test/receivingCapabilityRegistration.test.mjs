// EI Phase-2 Receiving (Phase C) -- OFFLINE proof that inventory.stock.receive is registered but
// UNGRANTED, and that no superuser/wildcard bypass grants it. Pure `node`: NO emulator, NO network, NO
// production. Runs the compiled ../lib output. Importing these registries writes NOTHING.
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
  // No `active` flag (grantable-in-principle but ungranted; not the inactive equipment.* posture).
  assert.equal("active" in e, false);
});

check("no role in any grant catalog holds inventory.stock.receive", () => {
  for (const [roleName, role] of Object.entries(ALL_ROLES)) {
    assert.equal(Array.isArray(role.permissions), true, `${roleName} has a permissions array`);
    assert.equal(role.permissions.includes(CAP), false, `${roleName} must NOT grant ${CAP}`);
  }
});

check("the named security + operational roles do not receive it", () => {
  // admin/dispatcher/technician are compatibility grant-holders; PARTS_MANAGER / WAREHOUSE_MANAGER /
  // PARTS_ASSOCIATE are Issue-100 operational roles that are not even grant-holders in these capability
  // catalogs (so they hold NO catalog capability at all). Either way they do not receive it.
  for (const name of ["admin", "dispatcher", "technician", "PARTS_MANAGER", "WAREHOUSE_MANAGER", "PARTS_ASSOCIATE"]) {
    const role = ALL_ROLES[name];
    if (role) assert.equal(role.permissions.includes(CAP), false, `${name} must not grant ${CAP}`);
    else assert.equal(role, undefined, `${name} is not a capability grant-holder (holds no catalog capability)`);
  }
});

check("NO superuser / wildcard bypass exists (no role grants '*' or the id via wildcard)", () => {
  for (const [roleName, role] of Object.entries(ALL_ROLES)) {
    for (const p of role.permissions) {
      assert.notEqual(p, "*", `${roleName} must not hold a wildcard '*' grant`);
      assert.equal(/[*]/.test(p), false, `${roleName} grant "${p}" must not contain a wildcard`);
    }
  }
});

check("no initializer/fixture mints it: it is granted by exactly ZERO roles", () => {
  const grantingRoles = Object.entries(ALL_ROLES).filter(([, r]) => r.permissions.includes(CAP)).map(([n]) => n);
  assert.deepEqual(grantingRoles, [], "inventory.stock.receive is held by zero roles");
});

check("existing capabilities are unchanged (a spot-check of known granted ids still resolves)", () => {
  const ids = new Set(PERMISSION_CATALOG.map((p) => p.id));
  for (const known of ["reorder.request.markReceived", "reorder.request.recordPurchaseOrder", "inventory.catalog.manage"]) {
    assert.equal(ids.has(known), true, `existing capability ${known} still present`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
