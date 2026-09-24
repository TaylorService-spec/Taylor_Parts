// WHY ADMINISTRATION STILL CANNOT BE NAVIGATED TO -- the client half of the readiness record.
//
// Pure: no DOM, no network, no Firebase. Run: node --test test/administrationNavigationReadiness.test.mjs
//
// ════════════════════ THE THING THIS FILE EXISTS TO STOP ════════════════════
//
// Lane AA registered `admin.securityPolicy.read` and granted it to admin and owner. That closes the
// reason Administration > Roles & Permissions and > Objects were declared gaps -- there IS a read
// capability now -- and it closes NOTHING about whether the navigation offers them. Between the
// capability and the door there are three separate mechanisms, and none of the three has been moved:
//
//   1. NAV_SURFACE_ACCESS has no row for these destinations, so `eosGrantsSurface` finds no
//      surfaceAccess and returns false for every principal, however much authority they hold.
//   2. The destinations declare no `capabilityAccess`, so the LEGACY source still answers them from
//      PLACEHOLDER_DEFAULT_ROLES -- a Firebase-era role literal, `["admin", "dispatcher"]`.
//   3. Even if (2) were declared, GOVERNED_SURFACE_CAPABILITY_IDS does not list the ids, so the
//      shell never asks for a decision on them -- and an id nobody asks for is indistinguishable
//      from a denied one (governedSurfaceCapabilities.js says so in its own words, twice).
//
// Each is pinned below. A readiness flag flipped while any of them stands makes Administration
// unreachable for everyone, which is the exact blocker the Lane V navigation report raised.
import test from "node:test";
import assert from "node:assert/strict";

import {
  EXPERIENCE_STATE,
  EXPERIENCE_SURFACE_KEYS,
  buildNavigationAuthority,
} from "../src/access/experienceContext.js";
import {
  NAV_DOMAINS,
  NAV_SURFACE_ACCESS,
  NAV_SURFACE_GAPS,
  PLACEHOLDER_DEFAULT_ROLES,
  isDomainVisible,
  isNavItemVisible,
} from "../src/navigation/navConfig.js";
import { GOVERNED_SURFACE_CAPABILITY_IDS } from "../src/access/governedSurfaceCapabilities.js";

/** The five AG2 asks about. `users` and `auditLogs` are deliberately NOT here -- they are mapped. */
const POLICY_DESTINATIONS = Object.freeze([
  "overview", "rolesPermissions", "objects", "workflows", "permissionPreview",
]);

const administration = () => NAV_DOMAINS.find((d) => d.key === "administration");
const itemFor = (itemKey) => {
  // The Administration index ("overview") is the domain's own path-"" destination.
  const found = administration().subnav.find((i) => i.key === itemKey);
  return found ?? administration().subnav.find((i) => i.path === "");
};

// EVERY surface this bundle knows, granted at once. If a destination stays hidden under THIS
// authority it is not hidden because the principal lacks authority -- there is nothing left to lack.
const OMNIPOTENT = buildNavigationAuthority({
  state: EXPERIENCE_STATE.READY,
  context: {
    tenantId: "taylor-nonprod",
    principalId: "prn-admin",
    securityRoleKeys: ["admin"],
    employeeId: null,
    workEligibility: [],
    operationalScopes: [],
    surfaces: [...EXPERIENCE_SURFACE_KEYS],
  },
});

const eosContext = (authority = OMNIPOTENT, extra = {}) => ({
  operationalRoles: [], employmentStatus: "ACTIVE", eosNavigationAuthority: authority, ...extra,
});

// ════════════════════ 1. THE PROJECTION OFFERS NONE OF THE FIVE ════════════════════

test("under the EOS source the five policy destinations are invisible to EVERYONE", () => {
  for (const key of POLICY_DESTINATIONS) {
    const item = itemFor(key);
    assert.ok(item, `Administration has no destination "${key}"`);
    // No surfaceAccess was attached, because NAV_SURFACE_ACCESS names no surface for it.
    assert.equal(item.surfaceAccess, undefined,
      `${key} now has a surface -- the readiness matrix must be re-run`);
    assert.equal(isNavItemVisible(item, "admin", ["inventory"], eosContext()), false,
      `${key} became visible to admin -- re-run the readiness matrix`);
    assert.equal(isNavItemVisible(item, "owner", [], eosContext()), false);
  }
});

test("the surface map still has no row for them, and the gap register still names them", () => {
  for (const key of POLICY_DESTINATIONS) {
    assert.equal(Object.prototype.hasOwnProperty.call(NAV_SURFACE_ACCESS, `administration/${key}`), false);
    assert.ok(Object.prototype.hasOwnProperty.call(NAV_SURFACE_GAPS, `administration/${key}`),
      `administration/${key} is neither mapped nor declared a gap`);
  }
  // THE GAP REASONS ARE NOW STALE, and the staleness is the finding. Three of them say a READ
  // capability does not exist; `admin.securityPolicy.read` exists and is granted to admin and owner
  // in nonprod (migration 1762041600000). Rewriting them is a deliberate act with an Owner ruling
  // behind it, not a side effect of this lane -- so the old text is pinned, not edited.
  assert.match(NAV_SURFACE_GAPS["administration/rolesPermissions"], /No READ capability governs/);
  assert.match(NAV_SURFACE_GAPS["administration/objects"], /Same gap as rolesPermissions/);
  assert.match(NAV_SURFACE_GAPS["administration/workflows"], /Same gap as rolesPermissions/);
  assert.match(NAV_SURFACE_GAPS["administration/permissionPreview"], /Same gap as rolesPermissions/);

  // The two that ARE mapped, so the contrast is explicit rather than inferred.
  assert.deepEqual(NAV_SURFACE_ACCESS["administration/users"], ["administration.users"]);
  assert.deepEqual(NAV_SURFACE_ACCESS["administration/auditLogs"], ["administration.auditLogs"]);
  assert.equal(isNavItemVisible(itemFor("users"), "admin", [], eosContext()), true);
  assert.equal(isNavItemVisible(itemFor("auditLogs"), "admin", [], eosContext()), true);
});

// ════════════════════ 2. THE LEGACY SOURCE IS WHAT STILL ANSWERS THEM ════════════════════

test("today, dispatcher reaches all five through a Firebase role literal and no grant at all", () => {
  // No EOS authority in context -> the legacy branch. `dispatcher` holds ZERO capabilities on the
  // rolesPermissions, principal, workflowDefinition and auditLog Objects in nonprod (measured
  // read-only 2026-09-24), and reaches every one of these screens anyway.
  const legacy = { operationalRoles: [], employmentStatus: "ACTIVE" };
  assert.deepEqual(PLACEHOLDER_DEFAULT_ROLES, ["admin", "dispatcher"]);
  for (const key of POLICY_DESTINATIONS) {
    const item = itemFor(key);
    assert.equal(item.capabilityAccess, undefined,
      `${key} now declares capabilityAccess -- step 1 of the wiring has been done`);
    assert.equal(item.legacyKey, undefined);
    assert.equal(isNavItemVisible(item, "dispatcher", [], legacy), true,
      `${key} no longer falls to PLACEHOLDER_DEFAULT_ROLES -- re-run the readiness matrix`);
  }
});

test("the negative FALLS THROUGH only when a compatibility path is also declared -- measured, not assumed", () => {
  // Lane AA flagged that `capabilityAccess` "grants outright and falls through on a negative", so
  // declaring capability ids alone would preserve dispatcher's legacy access until the
  // legacyKey/placeholder fallback is deliberately retired. Driven through the real predicate, that
  // is TRUE OF ONE SHAPE AND FALSE OF THE OTHER, and the five Administration destinations are the
  // second shape. isNavItemVisible's branch order is what decides it:
  //
  //     capabilityAccess && held      -> true        (grants outright: the flagged half, correct)
  //     operationalRoleAccess         -> that answer
  //     legacyKey                     -> allowedLegacyKeys.includes(...)      <- the fall-through
  //     capabilityAccess (no path)    -> FALSE, fail-closed                   <- never reaches
  //     PLACEHOLDER_DEFAULT_ROLES                                                 the placeholder
  //
  const dispatcherHoldsNothing = {
    operationalRoles: [], employmentStatus: "ACTIVE", hasCapability: () => false,
  };

  // THE ADMINISTRATION SHAPE. These five carry no legacyKey and no operationalRoleAccess, so adding
  // capabilityAccess lands them on the fail-closed branch: dispatcher is refused by that edit ALONE,
  // with no second edit retiring anything. The placeholder is skipped, not overridden.
  const asAdministrationWouldBe = { key: "rolesPermissions", label: "Roles & Permissions",
    path: "roles-permissions", capabilityAccess: ["admin.securityPolicy.read"] };
  assert.equal(isNavItemVisible(asAdministrationWouldBe, "dispatcher", [], dispatcherHoldsNothing), false,
    "the fail-closed branch has moved -- re-check the cutover plan");
  assert.equal(isNavItemVisible(asAdministrationWouldBe, "admin", [], dispatcherHoldsNothing), false,
    "PLACEHOLDER_DEFAULT_ROLES was reached past a declared capabilityAccess");
  // ...and a positive decision still opens it, so the fail-closed branch is a denial and not a wall.
  assert.equal(isNavItemVisible(asAdministrationWouldBe, "dispatcher", [], {
    ...dispatcherHoldsNothing, hasCapability: (c) => c === "admin.securityPolicy.read",
  }), true);

  // THE SHAPE THE WARNING IS TRUE OF, kept so the distinction is recorded rather than lost: an item
  // that declares BOTH is admitted by the compatibility path on a negative decision. Inventory >
  // Parts is a real one (legacyKey "inventory"), and there the second edit genuinely is required.
  const withCompatibilityPath = { ...asAdministrationWouldBe, legacyKey: "inventory" };
  assert.equal(isNavItemVisible(withCompatibilityPath, "dispatcher", ["inventory"], dispatcherHoldsNothing), true,
    "the compatibility fall-through has changed -- re-check the cutover plan");
  const parts = NAV_DOMAINS.find((d) => d.key === "inventory").subnav.find((i) => i.key === "parts");
  assert.equal(parts.legacyKey, "inventory");
  assert.ok(Array.isArray(parts.capabilityAccess));
});

test("and the shell would never ask for the two new ids anyway", () => {
  // Step 3. `holdsDeclaredCapability` answers from the feed, and the feed only decides the ids it is
  // ASKED for; an unrequested id resolves false for every principal, including one who holds it.
  const requested = new Set(GOVERNED_SURFACE_CAPABILITY_IDS);
  assert.equal(requested.has("admin.securityPolicy.read"), false,
    "the id is now requested -- step 3 of the wiring has been done");
  assert.equal(requested.has("workflowDefinition.read"), false,
    "the id is now requested -- step 3 of the wiring has been done");
  // The two Administration reads that ARE requested, so the omission is visibly an omission.
  assert.equal(requested.has("admin.principalAccess.read"), true);
  assert.equal(requested.has("audit.event.read"), true);
});

// ════════════════════ 3. THE TWO BLOCKERS THIS LANE DID NOT TOUCH ════════════════════

test("inventory.reorderQueue is still an earnable surface with no door", () => {
  assert.ok(EXPERIENCE_SURFACE_KEYS.includes("inventory.reorderQueue"));
  const doors = Object.entries(NAV_SURFACE_ACCESS)
    .filter(([, surfaces]) => surfaces.includes("inventory.reorderQueue"));
  assert.deepEqual(doors, [], "a Reorder queue destination exists now -- re-run the readiness matrix");
  assert.match(NAV_SURFACE_GAPS["inventory.reorderQueue"], /NO DOOR EXISTS/);
});

test("hasAnyAccess is still true for a principal the EOS source refuses entirely", () => {
  // App.jsx:1200 computes hasAnyAccess as NAV_DOMAINS.some(isDomainVisible). The Dashboard index is
  // `alwaysVisible`, and `alwaysVisible` is checked BEFORE the EOS branch -- so a principal granted
  // nothing at all still makes the Dashboard domain visible, and lands on an empty dashboard rather
  // than on a refusal. Pre-existing on both sources; unchanged by this lane.
  const refused = eosContext(buildNavigationAuthority({
    state: EXPERIENCE_STATE.READY,
    context: { tenantId: "t", principalId: "p", securityRoleKeys: [], employeeId: null,
      workEligibility: [], operationalScopes: [], surfaces: [] },
  }));
  const dashboard = NAV_DOMAINS.find((d) => d.key === "dashboard");
  const index = dashboard.subnav.find((i) => i.path === "");
  assert.equal(index.alwaysVisible, true);
  assert.equal(isNavItemVisible(index, "technician", [], refused), true);
  assert.equal(isDomainVisible(dashboard, "technician", [], refused), true);
  const hasAnyAccess = NAV_DOMAINS.some((d) => isDomainVisible(d, "technician", [], refused));
  assert.equal(hasAnyAccess, true, "a refused principal now gets a refusal -- blocker 7 has moved");
  // Administration itself is correctly dark for that principal, which is the contrast: the domain
  // refuses, and the shell still reports access because of one unrelated index item.
  assert.equal(isDomainVisible(administration(), "technician", [], refused), false);
});
