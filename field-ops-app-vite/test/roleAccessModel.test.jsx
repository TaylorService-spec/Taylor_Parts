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
  operableCapabilityIds,
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

// ------------------------------------------------- activation is PER ENVIRONMENT

// THE DEFECT THIS SECTION EXISTS FOR.
//
// `active: false` in the catalog does not mean "inert everywhere". It means "inert unless the
// environment activates it" -- and that second half is how every capability shipped under the
// activation programme reaches anybody at all. This model read only the catalog, so it reported
// a capability as denied while the backend resolver, reading the same override set, allowed it.
//
// Data Import made it visible: admin.dataImport.stage/.execute are registered active:false, held
// by Administrator through the derived catalogue grant, and ACTIVATED in platform-sandbox. The
// inspector called them inert while the product ran them.
const DATA_IMPORT_IDS = ["admin.dataImport.stage", "admin.dataImport.execute"];

test("the Data Import capabilities are catalogue-inert and held by Administrator -- the preconditions", () => {
  // Asserted rather than assumed, so a change to either half fails HERE with a clear reason
  // instead of quietly making the tests below vacuous.
  for (const id of DATA_IMPORT_IDS) {
    const def = PERMISSION_CATALOG.find((p) => p.id === id);
    assert.ok(def, `${id} must be registered in the catalog`);
    assert.equal(def.active, false, `${id} must stay catalogue-inactive`);
    assert.ok(COMPATIBILITY_ROLES.admin.permissions.includes(id), `admin must hold ${id} by derivation`);
  }
});

test("a capability the CURRENT ENVIRONMENT activates appears under 'Can actually do'", () => {
  const access = resolveRoleAccess(COMPATIBILITY_ROLES.admin, {
    activationOverrides: new Set(DATA_IMPORT_IDS),
  });
  const effective = new Set(access.effective.map((c) => c.id));
  const inert = new Set(access.inert.map((c) => c.id));

  for (const id of DATA_IMPORT_IDS) {
    assert.ok(effective.has(id), `${id} must be effective where the environment activates it`);
    assert.ok(!inert.has(id), `${id} must not also appear as inert`);
  }
});

test("the SAME capability WITHOUT the environment override stays inert -- production's answer", () => {
  // A production bundle bakes [] (resolveEnvironment.mjs is role-keyed), so this is literally the
  // production reading of the same role. Nothing about the catalog changed to make the sandbox
  // answer true, which is the property that keeps production safe.
  const access = resolveRoleAccess(COMPATIBILITY_ROLES.admin, { activationOverrides: new Set() });
  const effective = new Set(access.effective.map((c) => c.id));
  const inert = new Set(access.inert.map((c) => c.id));

  for (const id of DATA_IMPORT_IDS) {
    assert.ok(inert.has(id), `${id} must be inert with no environment activation`);
    assert.ok(!effective.has(id), `${id} must not be reported as operable in production`);
  }
});

test("omitting the overrides entirely reads as production, never as 'everything is on'", () => {
  // The conservative default. A caller that forgets under-reports, which is a visible wrong
  // answer somebody chases; the opposite default would tell an administrator authority exists
  // where it does not, which is the failure this whole model was built to prevent.
  const access = resolveRoleAccess(COMPATIBILITY_ROLES.admin);
  const inert = new Set(access.inert.map((c) => c.id));
  for (const id of DATA_IMPORT_IDS) assert.ok(inert.has(id), `${id} must be inert when no set is passed`);
});

test("an environment-activated capability is LABELLED as such, not silently promoted", () => {
  const access = resolveRoleAccess(COMPATIBILITY_ROLES.admin, {
    activationOverrides: new Set(DATA_IMPORT_IDS),
  });
  const row = access.effective.find((c) => c.id === DATA_IMPORT_IDS[0]);

  // Operable here, and the catalog still says inactive. Both facts survive, because "active" and
  // "active BECAUSE THIS ENVIRONMENT SAYS SO" are different, and an administrator planning
  // production needs the difference.
  assert.equal(row.operable, true);
  assert.equal(row.active, false, "the catalogue flag must not be rewritten");
  assert.equal(row.activatedByEnvironment, true);
  assert.deepEqual(
    access.environmentActivated.map((c) => c.id).sort(),
    [...DATA_IMPORT_IDS].sort(),
  );
});

test("a CATALOGUE-ACTIVE capability is never marked as environment-activated", () => {
  const access = resolveRoleAccess(COMPATIBILITY_ROLES.admin, {
    activationOverrides: new Set([anActiveId, ...DATA_IMPORT_IDS]),
  });
  const row = access.effective.find((c) => c.id === anActiveId);
  // It was already operable everywhere; crediting the environment for it would misreport what
  // would change if the override were removed.
  assert.equal(row.activatedByEnvironment, false);
});

test("an override naming an id the catalog does not define conjures NOTHING", () => {
  // Eligibility and production-blocking are enforced upstream, at build time. This is the last
  // guard: an override set must not be able to invent a capability that does not exist.
  const before = operableCapabilityIds(new Set());
  const after = operableCapabilityIds(new Set(["totally.made.up.capability"]));
  assert.equal(after.size, before.size);
  assert.ok(!after.has("totally.made.up.capability"));
});

test("diagnostics ask the SAME question, so the counts cannot contradict the lists", () => {
  // A diagnostics panel counting catalogue-inert while the list beside it counts
  // environment-operable would put two numbers on one screen that disagree, with no way for the
  // reader to know which answers theirs.
  const roles = [COMPATIBILITY_ROLES.admin];
  const withOverride = accessDiagnostics(roles, { activationOverrides: new Set(DATA_IMPORT_IDS) });
  const without = accessDiagnostics(roles, { activationOverrides: new Set() });

  const inertIds = (d) => new Set(d.inertGrants.map((g) => g.id));
  for (const id of DATA_IMPORT_IDS) {
    assert.ok(!inertIds(withOverride).has(id), `${id} must not be an inert grant where it is activated`);
    assert.ok(inertIds(without).has(id), `${id} must be an inert grant where it is not`);
  }
});

test("the catalogue counts stay CATALOGUE counts -- an environment cannot inflate them", () => {
  const d = accessDiagnostics([COMPATIBILITY_ROLES.admin], { activationOverrides: new Set(DATA_IMPORT_IDS) });
  // "Active in catalog" describes the catalog, and must keep meaning that however many
  // capabilities this environment activates on top.
  assert.equal(d.activeCount, PERMISSION_CATALOG.filter((p) => p.active !== false).length);
  assert.equal(d.catalogSize, PERMISSION_CATALOG.length);
});

test("against the REAL registry: sandbox Administrator can do Data Import, production cannot", async () => {
  // The requirement, asserted end to end against the ONE registry rather than a hand-made set --
  // so this fails if the sandbox declaration is removed, if eligibility is withdrawn, or if the
  // production role-keying that bakes [] is ever weakened.
  const fs = await import("node:fs");
  const { resolveEnvironment } = await import("../../scripts/resolveEnvironment.mjs");
  const path = await import("node:path");
  const url = await import("node:url");
  // fileURLToPath, not the URL object: vitest resolves import.meta.url to a non-file scheme, and
  // readFileSync then rejects it. A path string works in both runtimes.
  const here = path.dirname(url.fileURLToPath(new URL(import.meta.url)));
  const registry = JSON.parse(fs.readFileSync(path.resolve(here, "../../config/environments.json"), "utf8"));

  const overridesFor = (id) =>
    new Set(resolveEnvironment(registry, id)?.capabilityActivationOverrides ?? []);

  const sandbox = resolveRoleAccess(COMPATIBILITY_ROLES.admin, {
    activationOverrides: overridesFor("platform-sandbox"),
  });
  const production = resolveRoleAccess(COMPATIBILITY_ROLES.admin, {
    activationOverrides: overridesFor("taylor-parts-production"),
  });

  const ids = (list) => new Set(list.map((c) => c.id));
  for (const id of DATA_IMPORT_IDS) {
    assert.ok(ids(sandbox.effective).has(id), `${id} must be operable for Administrator in platform-sandbox`);
    assert.ok(ids(production.inert).has(id), `${id} must stay inert in production`);
    assert.ok(!ids(production.effective).has(id), `${id} must never be operable in production`);
  }

  // And production activates NOTHING at all through this path -- the role-keyed hard block.
  assert.equal(overridesFor("taylor-parts-production").size, 0);
});
