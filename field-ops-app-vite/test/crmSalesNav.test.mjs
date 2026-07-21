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
  assert.deepEqual(customersDomain.subnav.map((i) => i.key), ["customers"]);
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

ok("Issue #288: ONLY salesCrm was removed -- the `financials` future placeholder is preserved", () => {
  assert.equal(NAV_DOMAINS.some((d) => d.key === "financials" && d.future === true), true);
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
