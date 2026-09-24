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
// WHEN THIS FILE WAS WRITTEN, EOS_NAVIGATION_AUTHORITY_READY WAS FALSE EVERYWHERE and Section 1 was
// reachable only under a source nothing turned on. Wave 11 / Lane AS turned it on in
// platform-sandbox -- and ONLY there; production stays false and declares no EOS API. So Section 1
// now describes what non-production actually does, and Section 2 describes what every other
// environment still does. Section 2 also carries the one answer the activation deliberately changed:
// Administration > Overview is a container and no longer has a legacy answer at all.
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
  NAV_CONTAINERS,
  NAV_DERIVED_SURFACE_CHILDREN,
  NAV_DERIVED_SURFACE_KEYS,
  NAV_DOMAINS,
  NAV_LEGACY_PLACEHOLDER_CEILING,
  NAV_LEGACY_PLACEHOLDER_DESTINATIONS,
  NAV_SURFACE_ACCESS,
  NAV_SURFACE_GAPS,
  PLACEHOLDER_DEFAULT_ROLES,
  containerRegisterViolations,
  isDomainVisible,
  isNavItemVisible,
  legacyPlaceholderRegisterViolations,
  navigationSurfaceMapViolations,
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

  // WAVE 12 / LANE AV -- THIS PAIR IS INVERTED, AND THE INVERSION IS A NARROWING.
  //
  // It used to assert that a principal the SERVER granted the bare container surface to reached the
  // menu, "the client neither re-derives the disjunction nor second-guesses it". Under the Owner's
  // Wave 12 ruling the container rule is ONE rule answering under BOTH sources, so the client DOES
  // ask the same question -- of the same six children, mirrored from `containerOf` -- and a menu
  // with nothing on it does not open, whoever says otherwise.
  //
  // NOTHING REACHABLE IS LOST, because this state is one the server cannot produce:
  // experienceAuthority.ts adds `administration.overview` to `granted` only after a child is already
  // in it (the `containerOf.some(childKey => granted.has(childKey))` line, pinned in
  // functions/test/administrationNavigationReadiness.test.mjs). So the two ends agree on every state
  // that exists, and on the one that does not they now agree that it is empty.
  const withOverviewOnly = eosContext(buildNavigationAuthority({
    state: EXPERIENCE_STATE.READY,
    context: { tenantId: "t", principalId: "p", securityRoleKeys: [], employeeId: null,
      workEligibility: [], operationalScopes: [], surfaces: ["administration.overview"] },
  }));
  assert.equal(isNavItemVisible(itemFor("overview"), "technician", [], withOverviewOnly), false,
    "a container opened on a principal who can open none of its children");
  assert.equal(isNavItemVisible(itemFor("rolesPermissions"), "technician", [], withOverviewOnly), false);

  // ...and ONE governed child is enough, with or without the server's own container grant. That is
  // the disjunction, measured from every one of its six sides.
  for (const childSurface of ["administration.auditLogs", "administration.users",
    "administration.rolesPermissions", "administration.objects", "administration.workflows",
    "administration.permissionPreview"]) {
    const withOneChild = eosContext(buildNavigationAuthority({
      state: EXPERIENCE_STATE.READY,
      context: { tenantId: "t", principalId: "p", securityRoleKeys: [], employeeId: null,
        workEligibility: [], operationalScopes: [], surfaces: [childSurface] },
    }));
    assert.equal(isNavItemVisible(itemFor("overview"), "technician", [], withOneChild), true,
      `${childSurface} is a governed Administration child and did not open the menu`);
  }

  // DATA IMPORT IS NOT A CHILD, on this side either. The server excludes it deliberately -- import
  // authority must not open the policy menu -- and the client's scope IS that list, joined through
  // NAV_SURFACE_ACCESS, so it cannot widen it. The Data Import TAB is unaffected.
  const importOnly = eosContext(buildNavigationAuthority({
    state: EXPERIENCE_STATE.READY,
    context: { tenantId: "t", principalId: "p", securityRoleKeys: [], employeeId: null,
      workEligibility: [], operationalScopes: [], surfaces: ["administration.dataImport"] },
  }));
  assert.equal(isNavItemVisible(itemFor("overview"), "admin", [], importOnly), false,
    "a data-import grant opened the policy-administration index");
  assert.equal(isNavItemVisible(itemFor("dataImport"), "admin", [], importOnly), true,
    "the Data Import destination itself lost its own governed answer");

  // WAVE 10 / LANE AR, ported from Lane AM's client-side container test when Lane AH's
  // server-side `containerOf` was kept as the single mechanism: a principal granted ONLY a
  // non-Administration surface does not get the Administration menu. The container's scope is
  // Administration, not "any permission at all", and that scope now lives in the server
  // catalog rather than in NAV_CONTAINERS.
  const elsewhere = eosContext(buildNavigationAuthority({
    state: EXPERIENCE_STATE.READY,
    context: { tenantId: "t", principalId: "p", securityRoleKeys: [], employeeId: null,
      workEligibility: [], operationalScopes: [], surfaces: ["crm.accounts"] },
  }));
  assert.equal(isNavItemVisible(itemFor("overview"), "admin", [], elsewhere), false);
  assert.equal(isDomainVisible(administration(), "admin", [], elsewhere), false);
  assert.equal(isNavItemVisible(itemFor("auditLogs"), "admin", [], elsewhere), false);
});

// ════════════════════ 2. THE LEGACY SOURCE IS WHAT STILL ANSWERS THEM ════════════════════

/** The four that are genuine SURFACES of their own. Overview is the container, and is separate. */
const POLICY_SURFACE_DESTINATIONS = Object.freeze([
  "rolesPermissions", "objects", "workflows", "permissionPreview",
]);

test("today, dispatcher reaches the four policy SURFACES through a Firebase role literal and no grant", () => {
  // No EOS authority in context -> the legacy branch. `dispatcher` holds ZERO capabilities on the
  // rolesPermissions, principal, workflowDefinition and auditLog Objects in nonprod (measured
  // read-only 2026-09-24), and reaches every one of these screens anyway.
  const legacy = { operationalRoles: [], employmentStatus: "ACTIVE" };
  assert.deepEqual(PLACEHOLDER_DEFAULT_ROLES, ["admin", "dispatcher"]);
  for (const key of POLICY_SURFACE_DESTINATIONS) {
    const item = itemFor(key);
    assert.equal(item.capabilityAccess, undefined,
      `${key} now declares capabilityAccess -- step 1 of the wiring has been done`);
    assert.equal(item.legacyKey, undefined);
    assert.equal(isNavItemVisible(item, "dispatcher", [], legacy), true,
      `${key} no longer falls to PLACEHOLDER_DEFAULT_ROLES -- re-run the readiness matrix`);
  }
});

// ═════ WAVE 12 / LANE AV: THE LEGACY-SOURCE ANSWER IS RESTORED, AS A CONTAINER ═════
//
// THIS TEST IS INVERTED BACK, and the history is the point rather than an embarrassment. Lane AS
// asserted here that "under the LEGACY source the Administration index is now refused -- the named
// cost of the shrink": Overview had no legacyKey, no capabilityAccess, no operationalRoleAccess and
// no placeholder row, so `isNavItemVisible()` answered FALSE for every role, admin and dispatcher
// included, and /administration/overview rendered App.jsx's "isn't available to your role" empty
// state everywhere the EOS source is off -- production included.
//
// The Owner refused that regression AND refused the placeholder row that would have papered over it.
// Both refusals stand together because the destination is a PURE CONTAINER, and a container needs no
// authority of its own: it is visible iff at least one of its children is. That rule already existed
// (Lane AM's NAV_CONTAINERS) and already answered under BOTH sources, because
// `containerHasReachableChild` asks the ORDINARY predicate about each child. Wave 12 simply points
// it at the children the server's `containerOf` names, computed rather than typed.
//
// SO NOTHING WAS ASSERTED TO RESTORE THIS. The register is still 62, `alwaysVisible` is still at
// zero declarations, no legacy key was invented, and admin/dispatcher reach the menu for the only
// legitimate reason: the six destinations it is a menu over are ones they can already open.
test("under the LEGACY source the Administration index follows its children -- restored, and asserted nothing", () => {
  const legacy = { operationalRoles: [], employmentStatus: "ACTIVE" };
  const overview = itemFor("overview");

  // IT ASSERTS NO AUTHORITY OF ANY KIND. This is the half of Lane AS that survives untouched, and it
  // is what makes the visibility below derived rather than granted.
  assert.equal(overview.capabilityAccess, undefined);
  assert.equal(overview.legacyKey, undefined);
  assert.equal(overview.operationalRoleAccess, undefined);
  assert.equal(overview.alwaysVisible, undefined, "the blanket grant must never come back");
  assert.equal(overview.legacyPlaceholder, undefined,
    "administration/overview is back in NAV_LEGACY_PLACEHOLDER_DESTINATIONS -- the register may only shrink");
  assert.deepEqual([...overview.containerScope], [
    "administration/rolesPermissions", "administration/objects", "administration/workflows",
    "administration/permissionPreview", "administration/users", "administration/auditLogs",
  ], "the container's client scope has drifted from the server catalog's containerOf children");
  assert.equal(overview.containerScope.includes("administration/dataImport"), false,
    "import authority must not open the policy menu, on either side");

  // ADMIN AND DISPATCHER: visible, and visible BECAUSE the children are. PLACEHOLDER_DEFAULT_ROLES
  // reaches all six of them, so the menu has six things on it.
  assert.deepEqual(PLACEHOLDER_DEFAULT_ROLES, ["admin", "dispatcher"]);
  for (const role of ["admin", "dispatcher"]) {
    const reachable = overview.containerScope
      .filter((d) => isNavItemVisible(itemFor(d.split("/")[1]), role, [], legacy));
    assert.equal(reachable.length, 6, `${role} reaches ${reachable.length} of the six, not six`);
    assert.equal(isNavItemVisible(overview, role, ["inventory"], legacy), true,
      `${role} cannot reach the Administration index it has six open children under`);
  }

  // AN ORDINARY PERSONA WITH NO ADMINISTRATION CHILDREN GETS NO MENU. Nobody was granted a child to
  // make the container appear -- technician and owner hold no legacy Administration answer, so they
  // hold no Administration index either, under this source exactly as under the governed one.
  for (const role of ["technician", "owner", "", null]) {
    const reachable = overview.containerScope
      .filter((d) => isNavItemVisible(itemFor(d.split("/")[1]), role, [], legacy));
    assert.deepEqual(reachable, [], `${role} unexpectedly reaches an Administration child`);
    assert.equal(isNavItemVisible(overview, role, ["inventory"], legacy), false,
      `${role} reached an Administration index with nothing on it`);
  }

  // AND THE BLAST RADIUS IS STILL EXACTLY ONE TAB, measured the other way now: the other thirteen
  // Administration destinations keep their own rows and their own answers, unchanged by any of this.
  assert.equal(isDomainVisible(administration(), "admin", [], legacy), true);
  assert.equal(isDomainVisible(administration(), "dispatcher", [], legacy), true);
  for (const key of POLICY_SURFACE_DESTINATIONS.concat(["users", "auditLogs"])) {
    assert.equal(isNavItemVisible(itemFor(key), "dispatcher", [], legacy), true,
      `${key} lost its legacy answer -- the container was supposed to change one destination`);
  }
});

// ═════ WAVE 11 / LANE AS: THE REGISTER MAY ONLY SHRINK, AND THE GUARD IS PROVED TO BITE ═════
test("the placeholder register is at its ceiling and the shrink-only rules refuse Lane AR's edit", () => {
  assert.equal(NAV_LEGACY_PLACEHOLDER_DESTINATIONS.length, 62,
    "the shrink-only register changed size -- if it GREW, that needs an Owner ruling, not a ceiling edit");
  assert.equal(NAV_LEGACY_PLACEHOLDER_CEILING, 62);
  assert.ok(NAV_LEGACY_PLACEHOLDER_DESTINATIONS.length <= NAV_LEGACY_PLACEHOLDER_CEILING);
  assert.equal(NAV_LEGACY_PLACEHOLDER_DESTINATIONS.includes("administration/overview"), false);
  assert.equal(new Set(NAV_LEGACY_PLACEHOLDER_DESTINATIONS).size, 62, "the register holds a duplicate");

  // The real registers are clean.
  assert.deepEqual(legacyPlaceholderRegisterViolations(), []);

  // A GUARD NOBODY HAS SEEN FAIL IS NOT A GUARD. Lane AR's exact edit, replayed:
  const asAr = ["administration/overview", ...NAV_LEGACY_PLACEHOLDER_DESTINATIONS];
  const arProblems = legacyPlaceholderRegisterViolations({ register: asAr });
  assert.equal(arProblems.length, 2, "Lane AR's register no longer trips both rules");
  assert.ok(arProblems.some((p) => p.includes("above the shrink-only ceiling")));
  assert.ok(arProblems.some((p) => p.includes("DERIVED surface")));

  // ...and the swap that keeps the COUNT at 62 is still refused, which is why rule 2 exists. A
  // ceiling alone would have let this through.
  const swapped = [...NAV_LEGACY_PLACEHOLDER_DESTINATIONS.slice(1), "administration/overview"];
  const swapProblems = legacyPlaceholderRegisterViolations({ register: swapped });
  assert.equal(swapProblems.length, 1);
  assert.ok(swapProblems[0].includes("DERIVED surface"));

  // The derived mirror names the container and nothing else; parity with the server catalog's
  // `containerOf` is asserted in functions/test/administrationNavigationReadiness.test.mjs.
  assert.deepEqual([...NAV_DERIVED_SURFACE_KEYS], ["administration.overview"]);
  assert.deepEqual(NAV_SURFACE_ACCESS["administration/overview"], ["administration.overview"]);

  // WAVE 12 / LANE AV: THE CONTAINER ANSWER DID NOT MAKE THE PLACEHOLDER ROW ACCEPTABLE. Rule 2 is
  // asserted above against exactly the two registers it was written for -- Lane AR's 63 rows and the
  // count-preserving swap -- and both are still refused now that the destination is a container
  // again. The container row makes the placeholder row UNNECESSARY, never permissible.
  assert.ok(NAV_CONTAINERS["administration/overview"], "the Administration container row is missing");
  assert.equal(
    legacyPlaceholderRegisterViolations({ register: ["administration/overview"] })
      .some((p) => p.includes("DERIVED surface")),
    true,
    "rule 2 stopped refusing a placeholder row on the container once the container came back",
  );
});

// ═════ WAVE 12 / LANE AV: THE RECONCILED CONTAINER CHECK REFUSES WHAT IT WAS WRITTEN TO REFUSE ═════
//
// Lane AM wrote "a destination may not be BOTH a container and mapped to a surface", and Lane AR
// relied on it to rule out a client-side Administration container row. That sentence pre-dates the
// DERIVED surface, so it refused the legitimate case along with the defect. It is re-stated, not
// relaxed -- and the difference is measured here by driving BOTH sides through the real predicate.
test("a container may be mapped to its DERIVED surface and to no grant surface -- proved both ways", () => {
  // The real registers are clean, and the whole surface map is clean with them.
  assert.deepEqual(containerRegisterViolations(), []);
  assert.deepEqual(navigationSurfaceMapViolations(), []);

  // THE THING IT ALWAYS REFUSED, still refused: a menu that is ALSO a door somebody can hold. Such a
  // destination would open while every child stayed shut -- "holds the Overview and can open
  // nothing", the exact state the server catalog calls unrepresentable.
  const alsoAGrant = containerRegisterViolations({
    surfaceAccess: { ...NAV_SURFACE_ACCESS, "administration/overview": ["administration.overview", "administration.users"] },
  });
  assert.equal(alsoAGrant.length, 1);
  assert.ok(alsoAGrant[0].includes('mapped to the GRANT surface "administration.users"'));

  // A container mapped to a grant surface ONLY -- Lane AM's original case, with no derived surface in
  // sight -- is refused exactly as it always was.
  const grantOnly = containerRegisterViolations({
    containers: { "administration/users": ["administration/objects"] },
  });
  assert.ok(grantOnly.some((p) => p.includes('mapped to the GRANT surface "administration.users"')));

  // CONTAINERS MUST NOT NEST, MUST NOT NAME THEMSELVES, AND MUST NAME REAL DESTINATIONS.
  assert.ok(containerRegisterViolations({
    containers: { "administration/overview": ["administration/overview"] },
  }).some((p) => p.includes("is a container over itself")));
  assert.ok(containerRegisterViolations({
    containers: { "dashboard/my": ["administration/overview"], "administration/overview": [] },
  }).some((p) => p.includes("containers must not nest")));
  assert.ok(containerRegisterViolations({
    containers: { "administration/overview": ["administration/nope"] },
  }).some((p) => p.includes('unknown destination "administration/nope"')));
  assert.ok(containerRegisterViolations({
    containers: { "administration/overview": ["nosuchdomain"] },
  }).some((p) => p.includes('unknown domain "nosuchdomain"')));

  // AND A MIRROR THAT DRIFTS IS REPORTED RATHER THAN SILENTLY DARKENING THE MENU: a child surface no
  // destination is mapped to could never open the container.
  assert.ok(containerRegisterViolations({
    derivedSurfaceChildren: { "administration.overview": ["administration.ghost"] },
  }).some((p) => p.includes('child surface "administration.ghost"')));

  // THE SCOPE IS COMPUTED FROM THE MIRROR, not typed beside it. This is what "agree by construction"
  // buys: there is no second list to keep equal.
  assert.deepEqual([...NAV_CONTAINERS["administration/overview"]],
    NAV_DERIVED_SURFACE_CHILDREN["administration.overview"]
      .map((surfaceKey) => Object.entries(NAV_SURFACE_ACCESS)
        .find(([, keys]) => keys.includes(surfaceKey))[0]));
  assert.equal(NAV_CONTAINERS["dashboard/my"], "*", "the whole-product container is unchanged");
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
//
// One of the two has since been closed by its own lane (the Reorder queue door). The record of what
// this lane did and did not do is kept exact rather than rewritten: the first test below now states
// the closure, and the second still states the blocker it found.

test("inventory.reorderQueue now HAS a door -- blocker #4 is closed, and the Administration ones are not", () => {
  // This assertion used to read "still an earnable surface with no door", and it carried the
  // instruction "a Reorder queue destination exists now -- re-run the readiness matrix". One does:
  // Inventory > Reorder Queue, earned by reorder.request.read plus the governed REORDER_QUEUE
  // Operational Scope. The readiness record is updated rather than deleted, because the contrast is
  // the point -- the Administration blockers in this file are NOT closed by that, and a reader
  // arriving at this file must not infer one from the other.
  assert.ok(EXPERIENCE_SURFACE_KEYS.includes("inventory.reorderQueue"));
  const doors = Object.entries(NAV_SURFACE_ACCESS)
    .filter(([, surfaces]) => surfaces.includes("inventory.reorderQueue"));
  assert.deepEqual(doors, [["inventory/reorderQueue", ["inventory.reorderQueue"]]]);
  // Declared as a gap by SURFACE key -- the shape that made the blocker invisible to every check in
  // navConfig.js, since the gap register is keyed by DESTINATION everywhere else. Gone, and
  // navigationSurfaceMapViolations() now refuses a gap key that is not a destination.
  assert.equal(Object.prototype.hasOwnProperty.call(NAV_SURFACE_GAPS, "inventory.reorderQueue"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(NAV_SURFACE_GAPS, "inventory/reorderQueue"), false);
});

test("BLOCKER #7 CLOSED: hasAnyAccess is false for a principal the EOS source refuses entirely", () => {
  // WHAT THIS TEST USED TO RECORD (Lane AG, 2026-09-24): App.jsx:1200 computes hasAnyAccess as
  // NAV_DOMAINS.some(isDomainVisible); the Dashboard index was `alwaysVisible`; `alwaysVisible` was
  // checked BEFORE the EOS branch -- so a principal granted nothing at all still made the Dashboard
  // domain visible and landed on an empty dashboard rather than on a refusal.
  //
  // WHAT IT RECORDS NOW (Wave 9 / Lane AM): `alwaysVisible` is gone from this file. The dashboard
  // index is a CONTAINER whose visibility is derived from the destinations this principal can
  // actually reach, so a principal who can reach nothing is told so. The refusal is App.jsx's
  // existing "No access" panel -- no new UI, and the panel's own copy ("your account isn't assigned
  // a role with access yet") is finally true when it shows.
  const refused = eosContext(buildNavigationAuthority({
    state: EXPERIENCE_STATE.READY,
    context: { tenantId: "t", principalId: "p", securityRoleKeys: [], employeeId: null,
      workEligibility: [], operationalScopes: [], surfaces: [] },
  }));
  const dashboard = NAV_DOMAINS.find((d) => d.key === "dashboard");
  const index = dashboard.subnav.find((i) => i.path === "");
  assert.equal(index.alwaysVisible, undefined, "the blanket grant must not come back");
  assert.equal(index.containerScope, "*");
  assert.equal(isNavItemVisible(index, "technician", [], refused), false);
  assert.equal(isDomainVisible(dashboard, "technician", [], refused), false);
  const hasAnyAccess = NAV_DOMAINS.some((d) => isDomainVisible(d, "technician", [], refused));
  assert.equal(hasAnyAccess, false, "blocker #7 has reopened -- an unrelated index item lit the shell");
  assert.equal(isDomainVisible(administration(), "technician", [], refused), false);

  // THE SAME HOLE ON THE LEGACY SOURCE, also closed. An authenticated account with no role at all
  // ("", null, or a role nobody defined) got the empty dashboard for exactly the same reason.
  for (const role of [null, undefined, "", "some-role-nobody-defined"]) {
    assert.equal(NAV_DOMAINS.some((d) => isDomainVisible(d, role, [], { operationalRoles: [] })), false,
      `role ${JSON.stringify(role)} still lights the shell`);
  }
  // ...and a principal who DOES hold something still passes, on both sources. This closes a door;
  // it must not close the product.
  assert.equal(NAV_DOMAINS.some((d) => isDomainVisible(d, "admin", [], { operationalRoles: [] })), true);
  assert.equal(NAV_DOMAINS.some((d) => isDomainVisible(d, "technician", ["fieldMode", "jobs", "technicianDashboard"], { operationalRoles: [] })), true);
  assert.equal(NAV_DOMAINS.some((d) => isDomainVisible(d, "technician", [], eosContext())), true);
});
