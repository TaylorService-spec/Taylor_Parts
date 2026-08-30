// CRM/Sales top-level area (Issue #208). Deterministic unit tests for the
// top-level Customer -> CRM/Sales nav rename: exactly one top-level entry named
// "CRM/Sales" (never both Customer and CRM/Sales), the domain key/path/route
// mapping preserved, admin/dispatcher visible + technician fail-closed, the
// customer-list subnav + entity terms retained, and no retired top-level or
// Customer-subnav links reintroduced.
//
// Run: node test/crmSalesNav.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import { NAV_DOMAINS, isDomainVisible, isNavItemVisible } from "../src/navigation/navConfig.js";
import { ROLES, ROLE_NAV_ACCESS } from "../src/domain/constants.js";

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }

const customersDomain = NAV_DOMAINS.find((d) => d.key === "customers");
const allowed = (role) => ROLE_NAV_ACCESS[role] ?? [];

// ----- Exactly one top-level entry, named CRM/Sales -----
ok("the top-level Customer area is now labeled 'CRM/Sales'", () => {
  assert.ok(customersDomain, "customers domain must still exist (key preserved)");
  assert.equal(customersDomain.label, "CRM/Sales");
});
ok("exactly one top-level domain carries key 'customers'", () => {
  assert.equal(NAV_DOMAINS.filter((d) => d.key === "customers").length, 1);
});
ok("no top-level domain is still labeled 'Customers' (never both)", () => {
  assert.equal(NAV_DOMAINS.filter((d) => d.label === "Customers").length, 0);
});
ok("exactly one top-level domain is labeled 'CRM/Sales'", () => {
  assert.equal(NAV_DOMAINS.filter((d) => d.label === "CRM/Sales").length, 1);
});

// ----- Route / key / path preserved -----
ok("domain key and path are unchanged (routes preserved)", () => {
  assert.equal(customersDomain.key, "customers");
  assert.equal(customersDomain.path, "customers");
});
ok("the customer-list subnav entry is retained (route '' under /customers)", () => {
  const list = customersDomain.subnav.find((i) => i.key === "customers");
  assert.ok(list, "customer-list subnav item present");
  assert.equal(list.path, "");
  assert.equal(list.label, "Customers"); // entity/records term retained
});

// ----- Permissions: admin/dispatcher visible, technician + unknown fail-closed -----
ok("admin sees the CRM/Sales area", () => {
  assert.equal(isDomainVisible(customersDomain, ROLES.ADMIN, allowed(ROLES.ADMIN)), true);
});
ok("dispatcher sees the CRM/Sales area", () => {
  assert.equal(isDomainVisible(customersDomain, ROLES.DISPATCHER, allowed(ROLES.DISPATCHER)), true);
});
ok("technician does NOT see the CRM/Sales area (fail-closed)", () => {
  assert.equal(isDomainVisible(customersDomain, ROLES.TECHNICIAN, allowed(ROLES.TECHNICIAN)), false);
});
ok("an unknown/unauthorized role does NOT see the CRM/Sales area (fail-closed)", () => {
  assert.equal(isDomainVisible(customersDomain, "not_a_real_role", []), false);
  assert.equal(isDomainVisible(customersDomain, undefined, undefined), false);
});
ok("the customer-list item itself is admin/dispatcher-only, technician-denied", () => {
  const list = customersDomain.subnav.find((i) => i.key === "customers");
  assert.equal(isNavItemVisible(list, ROLES.ADMIN, allowed(ROLES.ADMIN)), true);
  assert.equal(isNavItemVisible(list, ROLES.DISPATCHER, allowed(ROLES.DISPATCHER)), true);
  assert.equal(isNavItemVisible(list, ROLES.TECHNICIAN, allowed(ROLES.TECHNICIAN)), false);
});

// ----- Retired links NOT reintroduced -----
ok("no retired Contacts/Locations/Equipment/Service History entry in the CRM/Sales subnav", () => {
  const retired = ["contacts", "locations", "equipment", "serviceHistory", "service-history"];
  for (const key of retired) {
    assert.equal(customersDomain.subnav.some((i) => i.key === key), false, `retired subnav key '${key}' must be absent`);
    assert.equal(customersDomain.subnav.some((i) => (i.path ?? "") === key), false, `retired subnav path '${key}' must be absent`);
  }
});
// Issue #232 unit E5 narrowed this list from four labels to three. "Equipment" was on
// it because, per navConfig's own cleanup comment, Equipment "is not built" -- the
// assertion existed to stop an unbuilt PLACEHOLDER area reappearing, which is exactly
// what #208's header calls it: "no retired top-level ... links reintroduced". Equipment
// is now built (#232: domain module #280, data access #282, Rules #289, fixtures #283),
// and its approved Implementation Plan specifies route `/equipment` + navConfig. The
// other three remain unbuilt as areas -- Contacts and Locations belong to an individual
// Account on Account Detail -- so they stay listed.
//
// Everything else #208 protects is unchanged and still asserted: the retired
// customers/equipment SUBNAV entry stays absent (test above), its redirect to
// /customers stays in App.jsx, and the new area is a real screen rather than a
// placeholder (asserted below).
ok("no retired area is reintroduced as its own top-level domain", () => {
  const retiredLabels = ["Contacts", "Locations", "Service History"];
  for (const label of retiredLabels) {
    assert.equal(NAV_DOMAINS.some((d) => d.label === label), false, `retired top-level '${label}' must be absent`);
  }
});

ok("the Equipment top-level area is a real built screen, not a reintroduced placeholder", () => {
  const equipment = NAV_DOMAINS.find((d) => d.key === "equipment");
  assert.ok(equipment, "Issue #232 E5 adds the Equipment area");
  assert.equal(equipment.label, "Equipment");
  assert.equal(equipment.path, "equipment");
  assert.equal(equipment.future, undefined, "not a 'future' placeholder -- it is built and routed");
  assert.deepEqual(equipment.subnav.map((i) => i.path), [""], "an index route at /equipment");
  // No legacyKey: admin/dispatcher only, technician fail-closed -- mirroring E3's Rules
  // (#289), where a technician has no Equipment authority at all (E17 owns self-scope).
  const item = equipment.subnav[0];
  assert.equal(item.legacyKey, undefined);
  assert.equal(isNavItemVisible(item, ROLES.ADMIN, allowed(ROLES.ADMIN)), true);
  assert.equal(isNavItemVisible(item, ROLES.DISPATCHER, allowed(ROLES.DISPATCHER)), true);
  assert.equal(isNavItemVisible(item, ROLES.TECHNICIAN, allowed(ROLES.TECHNICIAN)), false);
});

ok("the CRM/Sales area is untouched by the Equipment addition (preserved by union)", () => {
  // The Equipment register spans customers; it must not have been carved out of the
  // Customer area. CRM/Sales keeps its key, path, label and its customer-list subnav.
  assert.equal(customersDomain.key, "customers");
  assert.equal(customersDomain.path, "customers");
  assert.equal(customersDomain.label, "CRM/Sales");
  // Sales Cycle 2 adds the Opportunities workspace as a second subnav item under this same CRM/Sales area
  // (rather than a second top-level "Sales" domain -- Issue #288's one-area rule, below).
  // Sales Orders joins them as the third: it is the stage that FOLLOWS Opportunity
  // (Opportunity -> WON -> Sales Order), so the one-area rule this assertion protects puts
  // it here rather than in a new top-level domain. Asserted as an exact ordered list on
  // purpose -- a fourth item appearing here should have to be a decision, not a surprise.
  assert.deepEqual(customersDomain.subnav.map((i) => i.key), ["customers", "opportunities", "salesOrders"]);
});

ok("Sales Cycle 2: the Opportunities item is admin/dispatcher-only (no legacyKey), technician fail-closed", () => {
  const opportunities = customersDomain.subnav.find((i) => i.key === "opportunities");
  assert.ok(opportunities, "the Opportunity Operating Workspace item exists under CRM/Sales");
  assert.equal(opportunities.label, "Opportunities");
  assert.equal(opportunities.path, "opportunities");
  // No legacyKey -> PLACEHOLDER_DEFAULT_ROLES (admin/dispatcher); same brand-new-screen posture as the
  // customer-list item and Part Master. Read-first; no governed write path is wired here yet.
  assert.equal(opportunities.legacyKey, undefined);
  assert.equal(isNavItemVisible(opportunities, ROLES.ADMIN, allowed(ROLES.ADMIN)), true);
  assert.equal(isNavItemVisible(opportunities, ROLES.DISPATCHER, allowed(ROLES.DISPATCHER)), true);
  assert.equal(isNavItemVisible(opportunities, ROLES.TECHNICIAN, allowed(ROLES.TECHNICIAN)), false);
});

// ===== Issue #288: the stale "Sales / CRM" future placeholder is removed =====
ok("Issue #288: the stale salesCrm / 'Sales / CRM' / /sales-crm future placeholder is gone", () => {
  assert.equal(NAV_DOMAINS.some((d) => d.key === "salesCrm"), false, "no salesCrm domain");
  assert.equal(NAV_DOMAINS.some((d) => d.label === "Sales / CRM"), false, "no 'Sales / CRM' label");
  assert.equal(NAV_DOMAINS.some((d) => d.path === "sales-crm"), false, "no /sales-crm path");
});

ok("Issue #288: exactly ONE CRM/Sales domain remains -- the real, routed `customers` domain", () => {
  // The whole CRM/Sales family (matched by any of label/key/path) collapses to the one real domain.
  const crmFamily = NAV_DOMAINS.filter((d) => /crm/i.test(d.label) || /crm/i.test(d.key) || /crm/i.test(d.path ?? ""));
  assert.deepEqual(crmFamily.map((d) => d.key), ["customers"]);
  assert.equal(customersDomain.future, undefined, "the real CRM/Sales domain is NOT a future placeholder");
});

ok("Issue #288: no future domain generates a /sales-crm route; the real CRM/Sales routes still generate", () => {
  // Future routes are generated from NAV_DOMAINS.filter(d => d.future) (App.jsx); none is /sales-crm, so
  // a hit on the retired /sales-crm URL matches no route and falls through to the catch-all (Navigate to
  // /dashboard). The real CRM/Sales domain lives in the NON-future set, so its routes still generate.
  assert.equal(NAV_DOMAINS.filter((d) => d.future).some((d) => d.path === "sales-crm"), false);
  assert.equal(NAV_DOMAINS.filter((d) => !d.future).some((d) => d.key === "customers"), true);
});

ok("Issue #288 follow-up: the `financials` future placeholder was PROMOTED, not lost", () => {
  // The original #288 assertion pinned that only salesCrm was removed and the financials future
  // stub survived. Financials Frame 0 then deliberately retired that stub by promoting it to a
  // real first-class domain (see test/financialsNavStructure.test.mjs for its full contract).
  // What this test still owns: the domain EXISTS and is no longer a hidden future stub.
  const financials = NAV_DOMAINS.find((d) => d.key === "financials");
  assert.ok(financials, "the financials domain must exist");
  assert.notEqual(financials.future, true, "no longer a future placeholder");
  assert.notEqual(financials.navHidden, true, "no longer hidden from normal navigation");
});

ok("Issue #288: role visibility of the real CRM/Sales domain is unchanged after the removal", () => {
  // admin/dispatcher visible, technician + unknown fail-closed -- identical to the #208 assertions above,
  // re-asserted here to prove the salesCrm removal did not perturb the real domain's access behavior.
  assert.equal(isDomainVisible(customersDomain, ROLES.ADMIN, allowed(ROLES.ADMIN)), true);
  assert.equal(isDomainVisible(customersDomain, ROLES.DISPATCHER, allowed(ROLES.DISPATCHER)), true);
  assert.equal(isDomainVisible(customersDomain, ROLES.TECHNICIAN, allowed(ROLES.TECHNICIAN)), false);
  assert.equal(isDomainVisible(customersDomain, "not_a_real_role", []), false);
});

console.log(`\n${passed} passed, 0 failed`);

// ═══════════════ OPPORTUNITY ROW NAVIGATION — the declaration must name a REAL route
//
// Added 2026-08-26 with the restoration of the two `rowNavigationTo` declarations in
// metadata/definitions/opportunity.js (design decision O5).
//
// THE DEFECT THIS GUARDS is the one that got them removed in the first place. Both declared
// "/sales/opportunities/:id" — a route App.jsx has never mounted. It was harmless only while
// nothing read `rowNavigationTo`; the moment DefaultRelatedList started consuming it, every
// Opportunity row would have navigated to a 404. Their removal notes both said "Restore this with
// a real per-Opportunity route", and the restoration is only safe if "real" is CHECKED rather than
// asserted in a comment.
//
// So this compares the declaration against the router itself. A future rename of the route that
// misses these definitions fails here rather than in a user's hands.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { opportunityRelatedList, opportunityIndexList } from "../src/metadata/definitions/opportunity.js";
import { buildRowHref } from "../src/metadata/listPresentation.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_JSX = readFileSync(join(HERE, "..", "src", "App.jsx"), "utf8");

const OPPORTUNITY_ROW_ROUTE = "/customers/opportunities/:opportunityId";

for (const [name, listDef] of [
  ["Account related list", opportunityRelatedList],
  ["pipeline index", opportunityIndexList],
]) {
  ok(`${name} declares a per-Opportunity row destination`, () => {
    assert.equal(listDef.rowNavigationTo, OPPORTUNITY_ROW_ROUTE);
  });

  ok(`${name}'s row destination is a route App.jsx actually mounts`, () => {
    // The router declares it relative to the /customers parent: path="opportunities/:opportunityId".
    assert.match(
      APP_JSX,
      /path="opportunities\/:opportunityId"/,
      "App.jsx no longer mounts opportunities/:opportunityId — the declaration would 404",
    );
  });

  ok(`${name} builds a record href, never the list or a sales order`, () => {
    const href = buildRowHref(listDef.rowNavigationTo, "opp_doc_1");
    assert.equal(href, "/customers/opportunities/opp_doc_1");
    // The Sales Order route lives one segment deeper under the same prefix. A row that landed
    // there would be opening the wrong record entirely.
    assert.ok(!href.includes("/sales-order/"));
  });
}

ok("no definition DECLARES the retired 404 destination", () => {
  // Targets a DECLARATION, not a mention. The first version of this check searched the source for
  // the string "/sales/opportunities/:id" and failed on the restoration comment that quotes it --
  // a guard that cannot tell prose from code fails on its own documentation.
  const src = readFileSync(join(HERE, "..", "src", "metadata", "definitions", "opportunity.js"), "utf8");
  assert.ok(
    !/rowNavigationTo:\s*"\/sales\//.test(src),
    "a definition declares /sales/... again -- that route has never existed in App.jsx",
  );
});

// ═══════════════ THE DYNAMIC CERTIFICATION REGISTRY must certify the record page
//
// The Quick Gate reported `RESOLVED opportunity /customers/opportunities?view=all` — the workspace
// — while the record page this release shipped went unvisited, because the registry still declared
// `navigates: false`. A green gate on an adjacent surface is not evidence for this one, and that is
// precisely the failure `.certification/dynamicRoutes.json`'s own header was written about.
const DYNAMIC_ROUTES = JSON.parse(
  readFileSync(join(HERE, "..", ".certification", "dynamicRoutes.json"), "utf8"),
);
const oppEntity = DYNAMIC_ROUTES.entities.find((e) => e.key === "opportunity");

ok("the certifier treats Opportunity as a navigable record entity", () => {
  assert.ok(oppEntity, "the opportunity entity must stay in the registry");
  assert.equal(oppEntity.navigates, true, "navigates:false certifies the workspace, not the record");
  assert.ok(oppEntity.expectRoutePattern, "a navigable entity must assert where it landed");
});

ok("the certifier's expected route accepts a record and REFUSES the list or a sales order", () => {
  const re = new RegExp(oppEntity.expectRoutePattern);
  assert.ok(re.test("/customers/opportunities/opp_doc_1"), "must accept a record page");
  assert.ok(!re.test("/customers/opportunities"), "must refuse the workspace — that was the defect");
  assert.ok(
    !re.test("/customers/opportunities/sales-order/so_doc_1"),
    "must refuse the Sales Order route, which shares the prefix one segment deeper",
  );
});

console.log(`\n${passed} assertions passed`);
