// THE TWO GUARDS that keep the legacy Firebase permission world and the canonical EOS capability
// world from blurring into each other.
//
// Both exist because the naive fix to "the database grants `workOrder.lifecycle.dispatch` to admin
// and dispatcher but no code says so" is to add that key to `ADMIN_ROLE.permissions`, and that fix
// is wrong twice: the key is not a Firebase permission id (so `findPermission()` returns undefined
// and the legacy resolver DENIES), and `OWNER_PERMISSIONS = [...ADMIN_ROLE.permissions, ...]`
// (governedBusinessRoles.ts:83) would spread it to `owner`, turning a five-row Owner ruling into
// seven rows.
//
// GUARD (i)  an EOS capability key cannot sit in a legacy Firebase permission array.
// GUARD (ii) legacy inherited Role permissions cannot manufacture a canonical EOS capability grant.
//
// PURE. No PostgreSQL, no emulator, no network.
import test from "node:test";
import assert from "node:assert/strict";

import { PERMISSION_CATALOG, findPermission } from "../lib/access/permissionCatalog.js";
import { COMPATIBILITY_ROLES, ADMIN_ROLE } from "../lib/access/compatibilityRoles.js";
import { GOVERNED_BUSINESS_ROLES, OWNER_ROLE } from "../lib/access/governedBusinessRoles.js";
import {
  CANONICAL_EOS_CAPABILITY_GRANTS,
  RULING_AUTHORIZED_CAPABILITY_GRANTS,
  MIGRATION_ESTABLISHED_CAPABILITY_GRANTS,
  CanonicalCapabilityCatalogError,
  assertCanonicalKeysAreNotLegacyPermissionIds,
  assertNoCanonicalKeyInLegacyGrants,
  canonicalCapabilityKeys,
  deriveCanonicalCapabilityGrants,
  deriveGrantsFromDeclarations,
  isCanonicalCapabilityKey,
} from "../lib/adminPolicy/canonicalRoleCapabilityCatalog.js";
import {
  deriveGovernedRoleGrants,
  deriveLegacyRoleGrants,
} from "../lib/eosOps/migration/inventoryCapabilityGrantMigration.js";

const ALL_ROLES = Object.values({ ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES });
const pair = (g) => `${g.roleKey}|${g.capabilityKey}`;

// ════════════════════ THE RULING ════════════════════

test("the Owner ruling is declared exactly: five pairs, three Roles, owner absent", () => {
  assert.deepEqual(
    deriveCanonicalCapabilityGrants(Object.keys(RULING_AUTHORIZED_CAPABILITY_GRANTS)).map(pair),
    [
      "admin|workOrder.lifecycle.cancel",
      "admin|workOrder.lifecycle.dispatch",
      "dispatcher|workOrder.lifecycle.cancel",
      "dispatcher|workOrder.lifecycle.dispatch",
      "technician|workOrder.lifecycle.complete",
    ],
    "workOrder.lifecycle.* must be exactly the five rows the Owner authorized",
  );
});

test("the migration-established declarations reproduce their migrations' own VALUES lists", () => {
  assert.equal(MIGRATION_ESTABLISHED_CAPABILITY_GRANTS["finance.invoice.read"].length, 14);
  assert.equal(MIGRATION_ESTABLISHED_CAPABILITY_GRANTS["finance.payment.read"].length, 14);
  assert.equal(MIGRATION_ESTABLISHED_CAPABILITY_GRANTS["reorder.request.read"].length, 7);
  assert.equal(MIGRATION_ESTABLISHED_CAPABILITY_GRANTS["inventory.manufacturer.read"].length, 19);
  // 5 ruling-authorized + 54 migration-established = the 59 live eos_policy.role_capabilities rows
  // whose capability key has no Firebase permission id (measured in taylor-nonprod, 2026-09-23).
  assert.equal(deriveCanonicalCapabilityGrants().length, 59);
});

test("no capability key is declared by both sections", () => {
  const ruling = Object.keys(RULING_AUTHORIZED_CAPABILITY_GRANTS);
  const migration = Object.keys(MIGRATION_ESTABLISHED_CAPABILITY_GRANTS);
  assert.deepEqual(ruling.filter((k) => migration.includes(k)), []);
  assert.equal(canonicalCapabilityKeys().length, ruling.length + migration.length);
});

// ════════════════════ GUARD (i) ════════════════════
// An EOS capability key cannot be accidentally inserted into the legacy Firebase permission array.

test("GUARD (i): no canonical EOS capability key is registered as a Firebase permission id", () => {
  const legacy = new Set(PERMISSION_CATALOG.map((p) => p.id));
  for (const key of canonicalCapabilityKeys()) {
    assert.equal(legacy.has(key), false, `${key} must not be in permissionCatalog.ts`);
    assert.equal(findPermission(key), undefined, `findPermission("${key}") must stay undefined`);
  }
  // and the runtime assertion the reconcile tool calls before it derives anything agrees
  assertCanonicalKeysAreNotLegacyPermissionIds();
});

test("GUARD (i): no Role's legacy permissions array contains a canonical EOS capability key", () => {
  const offences = [];
  for (const role of ALL_ROLES) {
    for (const id of role.permissions ?? []) {
      if (isCanonicalCapabilityKey(id)) offences.push(`${role.id} declares canonical EOS key ${id}`);
    }
  }
  assert.deepEqual(offences, []);
});

test("GUARD (i): every id in every Role's legacy permissions array IS a registered Firebase permission id", () => {
  // This is what makes the previous assertion load-bearing rather than incidental: the legacy array
  // may hold catalog ids and nothing else, so a key that is not one cannot be smuggled in by any
  // Role -- compatibility Roles (admin/dispatcher/technician) included, which the existing
  // governedBusinessRoles.test.mjs check does not cover.
  const offences = [];
  for (const role of ALL_ROLES) {
    for (const id of role.permissions ?? []) {
      if (!findPermission(id)) offences.push(`${role.id} references unknown permission id "${id}"`);
    }
  }
  assert.deepEqual(offences, []);
});

// ════════════════════ GUARD (ii) ════════════════════
// Legacy inherited Role permissions cannot silently manufacture canonical EOS capability grants.

test("GUARD (ii): the admin -> owner inheritance this guard defends against is real", () => {
  // Stated as a measurement, not an assumption: every ADMIN_ROLE id is an OWNER_ROLE id. That is
  // why declaring on admin would declare on owner, and why the canonical source cannot be the Role
  // catalog.
  const ownerIds = new Set(OWNER_ROLE.permissions);
  for (const id of ADMIN_ROLE.permissions) assert.ok(ownerIds.has(id), `owner must spread admin's ${id}`);
  assert.ok(ADMIN_ROLE.permissions.length >= 151);
});

test("GUARD (ii): the legacy derivation yields NOTHING for any canonical EOS capability key", () => {
  assert.deepEqual(deriveLegacyRoleGrants(canonicalCapabilityKeys()), []);
});

test("GUARD (ii): the canonical expansion has no inheritance branch at all", () => {
  // Proven against a SYNTHETIC declaration, so the property holds for any future key, not merely
  // for today's data: declaring `admin` alone yields `admin` alone -- owner is not spread in.
  const synthetic = { "synthetic.capability.key": ["admin"] };
  assert.deepEqual(deriveGrantsFromDeclarations(synthetic).map(pair), ["admin|synthetic.capability.key"]);
  // and a declaration that DOES name owner yields owner, explicitly and only then
  const withOwner = { "synthetic.capability.key": ["admin", "owner"] };
  assert.deepEqual(deriveGrantsFromDeclarations(withOwner).map(pair),
    ["admin|synthetic.capability.key", "owner|synthetic.capability.key"]);
});

test("GUARD (ii): owner holds a canonical key only where the declaration writes owner out", () => {
  const ownerHeld = deriveCanonicalCapabilityGrants(undefined, ["owner"]).map((g) => g.capabilityKey).sort();
  assert.deepEqual(ownerHeld, [
    "finance.invoice.read",
    "finance.payment.read",
    "inventory.manufacturer.read",
    "reorder.request.read",
  ]);
  for (const key of Object.keys(RULING_AUTHORIZED_CAPABILITY_GRANTS)) {
    assert.equal(ownerHeld.includes(key), false, `owner must not hold ${key}`);
  }
});

// ════════════════════ THE COMBINED RECONCILER DERIVATION ════════════════════

test("deriveGovernedRoleGrants routes each key to exactly one source", () => {
  // a canonical key -> the canonical declaration (five rows, no owner)
  assert.deepEqual(deriveGovernedRoleGrants(["workOrder.lifecycle.dispatch"]).map(pair),
    ["admin|workOrder.lifecycle.dispatch", "dispatcher|workOrder.lifecycle.dispatch"]);
  // a legacy key -> unchanged legacy behaviour, byte for byte
  assert.deepEqual(deriveGovernedRoleGrants(["inventory.stock.receive"]), deriveLegacyRoleGrants(["inventory.stock.receive"]));
  // a mixed request -> the union, and nothing else
  const mixed = deriveGovernedRoleGrants(["workOrder.lifecycle.complete", "inventory.stock.receive"]).map(pair);
  assert.ok(mixed.includes("technician|workOrder.lifecycle.complete"));
  assert.equal(mixed.length, deriveLegacyRoleGrants(["inventory.stock.receive"]).length + 1);
  // a key neither source governs derives nothing -- it does not throw, it surfaces as EXTRA_GRANT
  assert.deepEqual(deriveGovernedRoleGrants(["no.such.capability"]), []);
});

test("deriveGovernedRoleGrants honours roleKeys scoping on the canonical side too", () => {
  assert.deepEqual(deriveGovernedRoleGrants(["workOrder.lifecycle.cancel"], ["dispatcher"]).map(pair),
    ["dispatcher|workOrder.lifecycle.cancel"]);
  assert.deepEqual(deriveGovernedRoleGrants(["workOrder.lifecycle.cancel"], ["technician"]), []);
});

test("GUARD (ii): the refusal fires on exactly the shape a leak would produce", () => {
  // The Role catalog is frozen, so the leak is presented to the guard directly, in the form
  // deriveLegacyRoleGrants would have produced had `workOrder.lifecycle.dispatch` been added to
  // ADMIN_ROLE.permissions -- admin, plus the owner row the inheritance would have manufactured.
  assert.throws(
    () => assertNoCanonicalKeyInLegacyGrants([
      { roleKey: "admin", capabilityKey: "workOrder.lifecycle.dispatch" },
      { roleKey: "owner", capabilityKey: "workOrder.lifecycle.dispatch" },
    ]),
    (err) => err instanceof CanonicalCapabilityCatalogError
      && /owner\/workOrder\.lifecycle\.dispatch/.test(err.message)
      && /must never manufacture/.test(err.message),
  );
  // a purely legacy grant set passes untouched
  assert.doesNotThrow(() => assertNoCanonicalKeyInLegacyGrants(deriveLegacyRoleGrants(["inventory.stock.receive"])));
  // and today's real catalog passes -- which is what makes the guard quiet rather than absent
  assert.doesNotThrow(() => assertNoCanonicalKeyInLegacyGrants(deriveLegacyRoleGrants(canonicalCapabilityKeys())));
});
