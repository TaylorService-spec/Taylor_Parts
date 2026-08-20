// ROLE ACCESS MODEL — pure. No emulator, no React.
// Run: npx vitest run test/roleAccessModel.test.jsx
//
// A vitest suite rather than node:test because it imports the .ts access mirrors
// (permissionCatalog.ts, governedBusinessRoles.ts) directly, which plain node cannot resolve.
import assert from "node:assert/strict";
import { test } from "vitest";
import {
  resolveRoleAccess,
  accessDiagnostics,
  groupByDomain,
  domainOf,
  activeCapabilityIds,
  roleObjectMatrix,
} from "../src/access/roleAccessModel.js";
import { PERMISSION_CATALOG } from "../src/access/permissionCatalog.ts";
import { GOVERNED_BUSINESS_ROLES } from "../src/access/governedBusinessRoles.ts";
import { COMPATIBILITY_ROLES } from "../src/access/compatibilityRoles.ts";

const ALL = Object.values({ ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES });
const anInertId = PERMISSION_CATALOG.find((p) => p.active === false)?.id;
const anActiveId = PERMISSION_CATALOG.find((p) => p.active !== false)?.id;

// ------------------------------------------------- grant is not activation

test("a GRANTED but INERT capability is not reported as effective", () => {
  // The most expensive mistake this model could make. A capability registered active:false
  // DENIES FOR EVERYONE regardless of who holds it, so rendering it as plain access tells an
  // administrator access exists when it does not — and sends them to debug the wrong layer.
  assert.ok(anInertId, "the catalog must contain at least one inert capability for this to mean anything");
  const r = resolveRoleAccess({ id: "t", permissions: [anInertId] });
  assert.equal(r.granted.length, 1, "it IS granted");
  assert.equal(r.effective.length, 0, "and it is NOT effective");
  assert.equal(r.inert[0].id, anInertId);
});

test("an ACTIVE granted capability is effective", () => {
  const r = resolveRoleAccess({ id: "t", permissions: [anActiveId] });
  assert.equal(r.effective.length, 1);
  assert.equal(r.inert.length, 0);
});

test("granted = effective + inert, always", () => {
  for (const role of ALL) {
    const r = resolveRoleAccess(role);
    assert.equal(
      r.effective.length + r.inert.length,
      r.granted.length,
      `${role.id}: every granted capability must be exactly one of effective or inert`
    );
  }
});

// ------------------------------------------------- a grant pointing at nothing

test("an id the catalog does not define is surfaced, not silently dropped", () => {
  // A typo'd id and a deleted one are indistinguishable once you filter both away.
  const r = resolveRoleAccess({ id: "t", permissions: ["not.a.real.capability", anActiveId] });
  assert.deepEqual(r.unknown, ["not.a.real.capability"]);
  assert.equal(r.granted.length, 1, "the unknown id is not counted as a grant");
});

test("no REAL role carries an unknown capability id", () => {
  for (const role of ALL) {
    assert.deepEqual(resolveRoleAccess(role).unknown, [], `${role.id} grants an id the catalog does not define`);
  }
});

// ------------------------------------------------- shape and grouping

test("duplicate ids in a role definition are counted once", () => {
  const r = resolveRoleAccess({ id: "t", permissions: [anActiveId, anActiveId] });
  assert.equal(r.granted.length, 1);
});

test("a role with no permissions resolves to nothing, not to an error", () => {
  const r = resolveRoleAccess({ id: "empty", permissions: [] });
  assert.deepEqual(r.granted, []);
  assert.deepEqual(r.effective, []);
});

test("domainOf takes the id's first segment", () => {
  assert.equal(domainOf("salesOrder.fulfill"), "salesOrder");
  assert.equal(domainOf("nodots"), "nodots");
});

test("groupByDomain returns sorted groups with every capability kept", () => {
  const { granted } = resolveRoleAccess(COMPATIBILITY_ROLES.admin);
  const groups = groupByDomain(granted);
  assert.deepEqual(groups.map((g) => g.domain), [...groups.map((g) => g.domain)].sort());
  assert.equal(groups.reduce((n, g) => n + g.capabilities.length, 0), granted.length, "no capability may be lost in grouping");
});

// ------------------------------------------------- diagnostics

test("diagnostics find granted-but-inert capabilities across all roles", () => {
  const d = accessDiagnostics(ALL);
  for (const { id } of d.inertGrants) {
    assert.equal(PERMISSION_CATALOG.find((p) => p.id === id)?.active, false, `${id} reported inert but is active`);
  }
});

test("an UNREACHABLE capability is one no supplied role grants", () => {
  const d = accessDiagnostics(ALL);
  const grantedAnywhere = new Set(ALL.flatMap((r) => r.permissions ?? []));
  for (const { id } of d.unreachable) {
    assert.equal(grantedAnywhere.has(id), false, `${id} is reported unreachable but some role grants it`);
  }
  // and the reverse: nothing granted is reported unreachable
  const unreachableIds = new Set(d.unreachable.map((u) => u.id));
  for (const id of grantedAnywhere) assert.equal(unreachableIds.has(id), false);
});

test("unreachable entries say whether they are ALSO inert", () => {
  // Otherwise someone 'fixes' an unreachable capability by granting it, and it still denies.
  const d = accessDiagnostics(ALL);
  for (const u of d.unreachable) {
    assert.equal(typeof u.active, "boolean");
    assert.equal(u.active, PERMISSION_CATALOG.find((p) => p.id === u.id).active !== false);
  }
});

test("every catalog capability is either granted somewhere or reported unreachable", () => {
  const d = accessDiagnostics(ALL);
  const grantedAnywhere = new Set(ALL.flatMap((r) => r.permissions ?? []));
  const unreachable = new Set(d.unreachable.map((u) => u.id));
  for (const p of PERMISSION_CATALOG) {
    assert.ok(grantedAnywhere.has(p.id) || unreachable.has(p.id), `${p.id} is accounted for by neither`);
  }
  assert.equal(d.catalogSize, PERMISSION_CATALOG.length);
});

test("a role granting nothing is reported, because sometimes that is a mistake", () => {
  const d = accessDiagnostics([{ id: "hollow", permissions: [] }, { id: "real", permissions: [anActiveId] }]);
  assert.deepEqual(d.rolesWithNothing, ["hollow"]);
});

// ------------------------------------------------- the shared object mapping

test("the object matrix uses the SAME mapping the Objects grid renders", () => {
  const rows = roleObjectMatrix(COMPATIBILITY_ROLES.admin);
  assert.ok(rows.length > 0);
  for (const r of rows) {
    for (const state of Object.values(r.verbs)) {
      assert.ok(["granted", "notGranted", "noCapability"].includes(state), `unexpected cell state ${state}`);
    }
  }
});

test("a verb no capability governs reads as noCapability, never as a plain denial", () => {
  // Rendering "nobody can ever hold this" the same as "you were not granted it" invites an
  // administrator to request access that cannot be granted to any role in the system.
  const rows = roleObjectMatrix(COMPATIBILITY_ROLES.admin);
  const withNoCapability = rows.filter((r) => Object.values(r.verbs).includes("noCapability"));
  assert.ok(withNoCapability.length > 0, "the matrix is expected to contain ungoverned object/verb pairs");
});

test("activeCapabilityIds treats a missing `active` as active", () => {
  const ids = activeCapabilityIds();
  const implicit = PERMISSION_CATALOG.find((p) => p.active === undefined);
  if (implicit) assert.ok(ids.has(implicit.id), "only active:false is inert; absent means active");
});
