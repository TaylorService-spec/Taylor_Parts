// HOW ADMINISTRATION BECOMES NAVIGABLE -- the client half of the readiness record.
//
// Pure: no DOM, no network, no Firebase. Run: node --test test/administrationNavigationReadiness.test.mjs
//
// ════════════════════ WHAT THIS FILE RECORDS ════════════════════
//
// Lane AA registered `admin.securityPolicy.read` and granted it to admin and owner. That closed the
// reason Roles & Permissions and Objects were declared gaps -- there IS a read capability -- and it
// closed NOTHING about whether the navigation offers them. Between the capability and the door there
// were three separate mechanisms. Under an explicit Owner ruling (Wave 9 / Lane AH) two of the three
// have now been moved, and the third deliberately has not:
//
//   1. NAV_SURFACE_ACCESS had no row for these destinations.          MOVED. All five are mapped,
//                                                                     each to its own surface key.
//   2. The destinations declare no `capabilityAccess`, so the LEGACY  NOT MOVED, ON PURPOSE. Adding
//      source answers them from PLACEHOLDER_DEFAULT_ROLES -- a        it would change what deployed
//      Firebase-era role literal, `["admin", "dispatcher"]`.          environments show TODAY, and
//                                                                     this lane proves readiness
//                                                                     rather than performing the
//                                                                     cutover. Section 2 pins the
//                                                                     legacy behaviour UNCHANGED.
//   3. GOVERNED_SURFACE_CAPABILITY_IDS did not list the ids, so the   MOVED. Both are requested, and
//      shell never asked for a decision on them.                      the request is DERIVED from the
//                                                                     gate declaration rather than
//                                                                     kept equal by remembering.
//
// EOS_NAVIGATION_AUTHORITY_READY IS STILL FALSE IN EVERY ENVIRONMENT, production included. Section 1
// is reachable only under the EOS source, which nothing turns on yet.
//
// NAVIGATION IS NOT THE SECURITY AUTHORITY, and none of this makes it one. A surface decides whether
// a destination is OFFERED; every read and command behind it re-authorizes server-side on the same
// capability. Section 1's proofs are about doors, not about permission.
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
import {
  ADMINISTRATION_POLICY_SURFACE_CAPABILITIES,
  GOVERNED_SURFACE_CAPABILITY_IDS,
} from "../src/access/governedSurfaceCapabilities.js";
import { SHELL_GATED_CAPABILITY_IDS } from "../src/access/shellCapabilityGates.js";

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

// ════════════════════ 1. THE PROJECTION NOW OFFERS ALL FIVE ════════════════════

test("under the EOS source the five policy destinations are offered to a principal that earns them", () => {
  for (const key of POLICY_DESTINATIONS) {
    const item = itemFor(key);
    assert.ok(item, `Administration has no destination "${key}"`);
    // Step 1 of the wiring: NAV_SURFACE_ACCESS now names a surface for each, and the attachment loop
    // in navConfig.js puts it on the item the predicate actually receives.
    assert.deepEqual(item.surfaceAccess, [`administration.${key}`],
      `${key} is mapped to something other than its own surface`);
    assert.equal(isNavItemVisible(item, "admin", ["inventory"], eosContext()), true);
    assert.equal(isNavItemVisible(item, "owner", [], eosContext()), true);
  }
});

test("the surface map names all five and the gap register names none of them", () => {
  for (const key of POLICY_DESTINATIONS) {
    assert.deepEqual(NAV_SURFACE_ACCESS[`administration/${key}`], [`administration.${key}`]);
    assert.equal(Object.prototype.hasOwnProperty.call(NAV_SURFACE_GAPS, `administration/${key}`), false,
      `administration/${key} is declared BOTH mapped and a gap`);
  }
  // The two that were already mapped before this lane, unchanged.
  assert.deepEqual(NAV_SURFACE_ACCESS["administration/users"], ["administration.users"]);
  assert.deepEqual(NAV_SURFACE_ACCESS["administration/auditLogs"], ["administration.auditLogs"]);
  assert.equal(isNavItemVisible(itemFor("users"), "admin", [], eosContext()), true);
  assert.equal(isNavItemVisible(itemFor("auditLogs"), "admin", [], eosContext()), true);

  // Every surface named is one this bundle knows. A destination pointed at a key the client does not
  // recognise would be silently invisible forever, which is a worse failure than a declared gap.
  for (const key of POLICY_DESTINATIONS) {
    assert.ok(EXPERIENCE_SURFACE_KEYS.includes(`administration.${key}`),
      `administration.${key} is mapped but is not a known surface`);
  }
});

test("the Administration index is NOT an unconditional door -- it follows its children", () => {
  // The whole point of `administration.overview` being a CONTAINER server-side: a principal the EOS
  // source grants nothing must not land on the Administration menu. Here the surface set is the
  // independent variable, because the client projects what the server listed and decides nothing.
  const withNothing = eosContext(buildNavigationAuthority({
    state: EXPERIENCE_STATE.READY,
    context: { tenantId: "t", principalId: "p", securityRoleKeys: [], employeeId: null,
      workEligibility: [], operationalScopes: [], surfaces: [] },
  }));
  assert.equal(isNavItemVisible(itemFor("overview"), "admin", [], withNothing), false,
    "the Administration index opened for a principal granted nothing");
  assert.equal(isDomainVisible(administration(), "admin", [], withNothing), false);

  // And a principal the SERVER granted the container to reaches it -- the client neither re-derives
  // the disjunction nor second-guesses it.
  const withOverviewOnly = eosContext(buildNavigationAuthority({
    state: EXPERIENCE_STATE.READY,
    context: { tenantId: "t", principalId: "p", securityRoleKeys: [], employeeId: null,
      workEligibility: [], operationalScopes: [], surfaces: ["administration.overview"] },
  }));
  assert.equal(isNavItemVisible(itemFor("overview"), "technician", [], withOverviewOnly), true);
  assert.equal(isNavItemVisible(itemFor("rolesPermissions"), "technician", [], withOverviewOnly), false);
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

test("and the shell now DOES ask for both ids -- step 3 of the wiring, closed", () => {
  // Step 3. `holdsDeclaredCapability` answers from the feed, and the feed only decides the ids it is
  // ASKED for; an unrequested id resolves false for every principal, including one who holds it.
  const requested = new Set(GOVERNED_SURFACE_CAPABILITY_IDS);
  assert.equal(requested.has("admin.securityPolicy.read"), true);
  assert.equal(requested.has("workflowDefinition.read"), true);
  // The two Administration reads that were already requested, unchanged.
  assert.equal(requested.has("admin.principalAccess.read"), true);
  assert.equal(requested.has("audit.event.read"), true);

  // PERMISSION PREVIEW'S AUTHORITY IS ALREADY IN THE REQUEST SET, which is the whole of what the
  // Wave 10 Owner ruling needed from this file. The surface moved from `admin.securityPolicy.read`
  // to `admin.principalAccess.read` -- it reads and evaluates a PRINCIPAL'S EFFECTIVE ACCESS, not
  // the policy configuration -- and that id was already asked for on Administration > Users's
  // behalf, in the same single call and against the same accessVersion. So the ruling adds NO id and
  // widens NO request: it points an existing surface at an id the shell already resolves. This
  // assertion is what says so, and is the reason ADMINISTRATION_POLICY_SURFACE_CAPABILITIES below is
  // still exactly the two ids Lane AH contributed rather than three.
  assert.equal(requested.has("admin.principalAccess.read"), true,
    "Permission Preview's authority is not in the shell's request set -- it would resolve false for "
    + "every principal, including one who holds it");

  // THE REQUEST IS DERIVED, NOT A SECOND LIST. `SHELL_GATED_CAPABILITY_IDS` is the union of
  // SHELL_CAPABILITY_GATES, which takes `governedSurfaces: GOVERNED_SURFACE_CAPABILITY_IDS`
  // wholesale -- so asking is a property of the declaration rather than of somebody remembering.
  // This is what makes "the principal-context request actually asks for them" true by construction.
  const shellAsks = new Set(SHELL_GATED_CAPABILITY_IDS);
  assert.equal(shellAsks.has("admin.securityPolicy.read"), true);
  assert.equal(shellAsks.has("workflowDefinition.read"), true);
  for (const id of GOVERNED_SURFACE_CAPABILITY_IDS) {
    assert.equal(shellAsks.has(id), true, `${id} is a governed surface id the shell never asks about`);
  }

  // ASKING IS NOT GRANTING, and this is the line that says so. Both ids are now in the request set
  // and a principal holding neither still resolves false -- from a decision, not from an absence.
  const holdsNothing = { operationalRoles: [], employmentStatus: "ACTIVE", hasCapability: () => false };
  const asItWouldBe = { key: "rolesPermissions", label: "Roles & Permissions",
    path: "roles-permissions", capabilityAccess: ["admin.securityPolicy.read"] };
  assert.equal(isNavItemVisible(asItWouldBe, "dispatcher", [], holdsNothing), false);

  // AND NO WRITE WAS ADDED BY THIS LANE. Requesting a decision on a read must not smuggle in the
  // write beside it, so the set this lane contributed is asserted to be exactly the two reads.
  assert.deepEqual([...ADMINISTRATION_POLICY_SURFACE_CAPABILITIES],
    ["admin.securityPolicy.read", "workflowDefinition.read"]);

  // NOT ONE `workflowDefinition` MUTATION IS REQUESTED. Every one of them stands at zero grants by
  // standing decision -- the Workflow Definition decisions are the Owner's -- and asking about one
  // would be the first step toward a screen that offers it.
  for (const write of ["workflowDefinition.publish", "workflowDefinition.create",
    "workflowDefinition.edit", "workflowDefinition.version", "workflowDefinition.bindRole"]) {
    assert.equal(requested.has(write), false, `${write} is a WRITE and the shell now asks for it`);
  }

  // THE ONE ADMINISTRATION WRITE THAT *IS* REQUESTED, named rather than hidden behind a narrower
  // loop. `admin.roleAssignment.write` has been in ADMINISTRATION_USERS_SURFACE_CAPABILITIES since
  // decisions #173/#174 and this lane did not add it. It is an ACTION gate on the Users screen's Add
  // Role control, not a surface-read gate, and no surface in the catalog is earned by it -- the
  // server-side readiness record asserts that half directly.
  assert.equal(requested.has("admin.roleAssignment.write"), true);
  assert.equal(ADMINISTRATION_POLICY_SURFACE_CAPABILITIES.includes("admin.roleAssignment.write"), false);
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
