// THE CLIENT SIDE OF THE EOS NAVIGATION SOURCE -- pure, no DOM, no network, no Firebase.
//
// The server proof (functions/test/experienceAuthority.test.mjs) shows that governed authority
// produces the right surfaces and that the right doors open. This suite covers what only the client
// can get wrong:
//
//   1. the projection function refusing a payload it cannot read, instead of reading it as "empty"
//   2. the three not-READY states all granting nothing, with NO degrade to users/{uid}.role
//   3. every downstream consumer of isNavItemVisible -- the rail, the drawer, the phone tab bar and
//      the "Go To" grid -- inheriting the EOS answer rather than keeping a legacy one
//
// The TRANSPORT (services/operationsApiClient.js) is proved separately in
// test/operationsApiClient.test.jsx: it reaches firebase/firebase.js for the ID token, which
// initializes Firebase at import time and so cannot be imported by this plain-node runner.
//
// Run: node --test test/navigationExperienceProjection.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

import {
  EXPERIENCE_STATE,
  EXPERIENCE_SURFACE_KEYS,
  EXPERIENCE_UNAVAILABLE_REASON,
  buildNavigationAuthority,
  experienceContextFrom,
  isNavigationAuthority,
} from "../src/access/experienceContext.js";
import {
  NAV_DOMAINS,
  NAV_SURFACE_ACCESS,
  NAV_SURFACE_GAPS,
  deniedDomainIndexItem,
  isDomainVisible,
  isNavItemVisible,
  navigationSurfaceMapViolations,
} from "../src/navigation/navConfig.js";
import { buildMobileNav } from "../src/navigation/mobilePrimaryNav.js";

const WELL_FORMED = Object.freeze({
  tenantId: "taylor-nonprod",
  principalId: "prn-0001",
  securityRoleKeys: ["partsAssociate", "inventoryReceivingClerk"],
  employeeId: "synthetic-np-emp-parts-associate",
  workEligibility: ["PARTS_OPERATIONS"],
  operationalScopes: [{ scopeType: "REORDER_QUEUE", scopeId: "sample-co-synthetic" }],
  surfaces: ["inventory.catalog", "receiving.checkIn"],
});

const authorityFor = (surfaces, state = EXPERIENCE_STATE.READY) =>
  buildNavigationAuthority({ state, context: { ...WELL_FORMED, surfaces } });

const contextWith = (authority, extra = {}) => ({
  operationalRoles: [],
  employmentStatus: "ACTIVE",
  eosNavigationAuthority: authority,
  ...extra,
});

const itemAt = (domainKey, itemKey) =>
  NAV_DOMAINS.find((d) => d.key === domainKey).subnav.find((i) => i.key === itemKey);

// ════════════════════ 1. MALFORMED IS NOT EMPTY ════════════════════

test("a well-formed result projects, and drops a surface key this bundle does not know", () => {
  const projected = experienceContextFrom({ ...WELL_FORMED, surfaces: ["crm.accounts", "surface.from.the.future"] });
  assert.deepEqual(projected.surfaces, ["crm.accounts"]);
  assert.deepEqual(projected.unrecognisedSurfaces, ["surface.from.the.future"]);
  assert.equal(projected.employeeId, WELL_FORMED.employeeId);
  assert.deepEqual(projected.workEligibility, ["PARTS_OPERATIONS"]);
});

test("every shape this bundle cannot read returns null -- never an empty grant", () => {
  // Reading a broken payload as "you hold nothing" would report a transport fault as an
  // authorization outcome, and would look identical to a correct refusal.
  const bad = [
    null,
    undefined,
    "surfaces",
    {},
    { ...WELL_FORMED, tenantId: "" },
    { ...WELL_FORMED, principalId: undefined },
    { ...WELL_FORMED, surfaces: "crm.accounts" },
    { ...WELL_FORMED, surfaces: ["crm.accounts", 7] },
    { ...WELL_FORMED, securityRoleKeys: null },
    { ...WELL_FORMED, workEligibility: null },
    { ...WELL_FORMED, operationalScopes: undefined },
    { ...WELL_FORMED, employeeId: 12 },
  ];
  for (const payload of bad) {
    assert.equal(experienceContextFrom(payload), null, `should not have projected: ${JSON.stringify(payload)}`);
  }
});

test("a Principal with no Employee link still projects -- that is a legitimate shape, not a fault", () => {
  const projected = experienceContextFrom({ ...WELL_FORMED, employeeId: null, workEligibility: [], operationalScopes: [] });
  assert.notEqual(projected, null);
  assert.equal(projected.employeeId, null);
});

// ════════════════════ 2. FAIL CLOSED, AND NO DEGRADE ════════════════════

test("only READY grants, and only what the server listed", () => {
  const ready = authorityFor(["crm.accounts"]);
  assert.equal(isNavigationAuthority(ready), true);
  assert.equal(ready.grants("crm.accounts"), true);
  assert.equal(ready.grants("service.dispatch"), false);
  assert.equal(ready.grants(undefined), false);

  for (const state of [EXPERIENCE_STATE.LOADING, EXPERIENCE_STATE.REFUSED, EXPERIENCE_STATE.UNAVAILABLE]) {
    const closed = buildNavigationAuthority({ state, context: { ...WELL_FORMED, surfaces: ["crm.accounts"] } });
    assert.equal(closed.grants("crm.accounts"), false, `${state} must grant nothing`);
    assert.deepEqual(closed.grantedSurfaces, []);
    assert.equal(closed.context, null, `${state} must not expose a context that is not current`);
  }
});

test("a READY authority with no context grants nothing rather than throwing", () => {
  const authority = buildNavigationAuthority({ state: EXPERIENCE_STATE.READY, context: null });
  assert.equal(authority.grants("crm.accounts"), false);
});

test("junk in the eosNavigationAuthority slot is NOT an authority, so the legacy path still answers", () => {
  // An object that merely looks present must not switch the source: a half-built value would
  // silently blank the whole product. `isNavigationAuthority` is the discriminator.
  for (const junk of [{}, { grants: true }, { source: "EOS" }, "EOS", 1]) {
    assert.equal(isNavigationAuthority(junk), false);
    const parts = itemAt("inventory", "parts");
    assert.equal(
      isNavItemVisible(parts, "admin", ["inventory"], { operationalRoles: [], eosNavigationAuthority: junk }),
      true,
      "a non-authority must leave the legacy answer untouched",
    );
  }
});

test("under the EOS source, the widest legacy role opens nothing it was not granted", () => {
  const ADMIN_KEYS = ["controlTower", "jobs", "technicians", "dispatch", "fieldMode", "inventory", "operations", "dispatcherBoard"];
  const authority = authorityFor(["crm.accounts"]);
  const context = contextWith(authority, { operationalRoles: ["PARTS_MANAGER", "WAREHOUSE_MANAGER", "PARTS_ASSOCIATE"] });
  const visible = [];
  for (const domain of NAV_DOMAINS) {
    for (const item of domain.subnav ?? []) {
      // Containers are excluded here because they are DERIVED, not granted: they answer from the
      // list being built. They get their own test below.
      if (item.containerScope) continue;
      if (isNavItemVisible(item, "admin", ADMIN_KEYS, context)) visible.push(`${domain.key}/${item.key}`);
    }
  }
  assert.deepEqual(visible, ["customers/customers"]);
});

test("the legacy inventoryRole domain is invisible under the EOS source, by design", () => {
  // That domain reads employees/{id}.operationalRoles directly -- it IS the Firebase business
  // authority the decomposition retires. Reproducing it as a governed surface would reproduce the
  // thing being removed, so it has no surface and it is declared a gap.
  const domain = NAV_DOMAINS.find((d) => d.key === "inventoryRole");
  const context = contextWith(authorityFor(EXPERIENCE_SURFACE_KEYS), {
    operationalRoles: ["PARTS_MANAGER", "WAREHOUSE_MANAGER", "PARTS_ASSOCIATE"],
  });
  assert.equal(isDomainVisible(domain, "technician", ["fieldMode", "jobs", "technicianDashboard"], context), false);
  for (const item of domain.subnav) {
    assert.ok(NAV_SURFACE_GAPS[`inventoryRole/${item.key}`], `inventoryRole/${item.key} must be a declared gap`);
  }
});

test("My Dashboard is a CONTAINER under both sources -- it opens only onto somewhere", () => {
  // REPLACES "My Dashboard survives both sources". It used to carry `alwaysVisible: true`, which was
  // checked BEFORE the EOS branch, so a principal a READY authority granted `surfaces: []` still made
  // the Dashboard domain visible, App.jsx's hasAnyAccess was true, and they landed on an empty
  // dashboard instead of the refusal that describes them (Wave 9 / Lane AM, navigation blocker #7).
  const my = itemAt("dashboard", "my");
  assert.equal(my.alwaysVisible, undefined, "the blanket grant is gone and must not come back");
  assert.equal(my.containerScope, "*", "the dashboard index composes the whole reachable product");

  // GRANTED NOTHING -> the menu is empty, and an empty menu is not a destination. Both sources.
  assert.equal(isNavItemVisible(my, null, [], contextWith(authorityFor([]), {})), false);
  assert.equal(isNavItemVisible(my, null, [], { operationalRoles: [] }), false);

  // GRANTED ONE THING -> the menu has something on it, so the index opens. It still grants nothing:
  // the only destination reachable underneath is the one that was earned.
  const oneSurface = contextWith(authorityFor(["crm.accounts"]), {});
  assert.equal(isNavItemVisible(my, null, [], oneSurface), true);
  assert.equal(isDomainVisible(NAV_DOMAINS.find((d) => d.key === "dashboard"), null, [], oneSurface), true);
  assert.equal(isNavItemVisible(itemAt("dashboard", "operationsDashboard"), null, [], oneSurface), false);

  // ...and the legacy source answers the same way from legacy authority alone.
  assert.equal(isNavItemVisible(my, "admin", [], { operationalRoles: [] }), true);
  assert.equal(isNavItemVisible(my, "technician", ["fieldMode", "jobs", "technicianDashboard"], { operationalRoles: [] }), true);
});

test("hasAnyAccess is FALSE for a principal the EOS source refuses entirely", () => {
  // The blocker itself, stated as the shell states it: App.jsx computes
  // `NAV_DOMAINS.some(isDomainVisible)` and renders "No access" when it is false. Before Lane AM one
  // unrelated index item made this true for everyone, so the refusal could never be shown.
  const refused = contextWith(authorityFor([]), {});
  for (const domain of NAV_DOMAINS) {
    assert.equal(isDomainVisible(domain, "technician", [], refused), false, `${domain.key} is still lit`);
  }
  assert.equal(NAV_DOMAINS.some((d) => isDomainVisible(d, "technician", [], refused)), false);
});

// ════════════════════ 3. EVERY CONSUMER INHERITS THE ANSWER ════════════════════

test("the map is coherent: every destination is mapped or declared a gap, and names known surfaces", () => {
  assert.deepEqual(navigationSurfaceMapViolations(EXPERIENCE_SURFACE_KEYS), []);
  assert.ok(Object.keys(NAV_SURFACE_ACCESS).length >= 25);
});

test("the rail's domain filter and the phone tab bar both follow the EOS answer", () => {
  const authority = authorityFor(["field.myWorkOrders", "service.workOrders"]);
  const context = contextWith(authority);

  // AppRail filters domains with isDomainVisible. Only the two Service areas are EARNED; Dashboard
  // survives because its index is a CONTAINER and those earned Service destinations are on its menu
  // -- derived from the grant, not a grant of its own (a principal granted nothing loses it; see the
  // container test above). `role` is null on purpose -- there is no legacy role to lean on and the
  // answer is complete without one.
  const domains = NAV_DOMAINS.filter((d) => isDomainVisible(d, null, [], context)).map((d) => d.key);
  assert.deepEqual(domains, ["dashboard", "serviceOperations", "service"]);

  const visibleServiceItems = NAV_DOMAINS.find((d) => d.key === "service").subnav
    .filter((item) => isNavItemVisible(item, null, [], context))
    .map((item) => item.key)
    .sort();
  assert.deepEqual(visibleServiceItems, ["coordinatedMission", "jobAssignments", "scan", "technicianWorkspace", "workOrders"]);

  // The phone tab bar runs its candidates through the SAME isVisible seam the rail uses, AND -- when
  // the EOS source is on -- chooses its shell from the surfaces rather than from `role`.
  const isVisible = (to) => {
    const [, domainPath, itemPath = ""] = to.split("/");
    const domain = NAV_DOMAINS.find((d) => d.path === domainPath);
    const item = domain?.subnav?.find((i) => i.path === itemPath);
    return item ? isNavItemVisible(item, null, [], context) : false;
  };
  const bar = buildMobileNav({ role: null, hasCapability: () => false, isVisible, eosNavigationAuthority: authority });
  // `role` is null and `hasCapability` answers false for everything: the field shell is earned by
  // `field.myWorkOrders` alone, which is the capability AND the SERVICE_TECHNICIAN eligibility.
  assert.equal(bar.shell, "TECHNICIAN");
  const tabs = bar.destinations.map((d) => d.key);
  assert.deepEqual(tabs, ["home", "scan", "more"], "Jobs is /service/dispatch, which this persona was not granted");
});

test("the phone shell is chosen by surface, not by users/{uid}.role", () => {
  const isVisible = () => true;
  const shellFor = (surfaces) =>
    buildMobileNav({
      role: "admin", // the widest legacy role, present and deliberately ignored
      hasCapability: () => true, // every legacy scanner capability, also ignored
      isVisible,
      eosNavigationAuthority: authorityFor(surfaces),
    }).shell;

  assert.equal(shellFor(["field.myWorkOrders"]), "TECHNICIAN");
  assert.equal(shellFor(["warehouse.picking"]), "WAREHOUSE");
  assert.equal(shellFor(["receiving.checkIn"]), "WAREHOUSE");
  assert.equal(shellFor(["inventory.cycleCount.count"]), "WAREHOUSE");
  // Neither shell is earned: NO phone shell, and specifically not the legacy answer that `admin`
  // plus a true `hasCapability` would have produced (WAREHOUSE).
  assert.equal(shellFor(["crm.accounts"]), "NONE");

  // And with no EOS authority the legacy rule is untouched.
  assert.equal(
    buildMobileNav({ role: "technician", hasCapability: () => false, isVisible }).shell,
    "TECHNICIAN",
  );
});

test("the Go To grid and the rail DELEGATE rather than keeping an answer of their own", async () => {
  // LandingPage.jsx and AppRail.jsx are .jsx and cannot be imported by this runner, so the property
  // asserted is the one that matters and is checkable: neither keeps a second visibility rule. They
  // call isNavItemVisible/isDomainVisible, which the tests above have just driven through the EOS
  // source -- so whatever those answer is what those surfaces render.
  const { readFileSync } = await import("node:fs");
  for (const file of ["../src/navigation/LandingPage.jsx", "../src/navigation/AppRail.jsx", "../src/navigation/AppShell.jsx"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.match(source, /isNavItemVisible/, `${file} must derive visibility from navConfig`);
    assert.equal(/ROLE_NAV_ACCESS/.test(source), false, `${file} must not read the legacy nav table itself`);
  }
});

test("a denied domain index is DENIED, not empty -- the refusal still has somewhere to be stated", () => {
  // App.jsx renders "<label> isn't available to your role" for a hidden item, and
  // deniedDomainIndexItem decides where a refusal must be shown rather than a blank body. The EOS
  // source must not quietly turn a refusal into an empty page.
  const inventory = NAV_DOMAINS.find((d) => d.key === "inventory");
  const deniedContext = contextWith(authorityFor(["service.workOrders"]));
  const denied = deniedDomainIndexItem(inventory, null, [], deniedContext);
  assert.equal(denied?.key, "parts");

  const grantedContext = contextWith(authorityFor(["inventory.catalog"]));
  assert.equal(deniedDomainIndexItem(inventory, null, [], grantedContext), null);
});
