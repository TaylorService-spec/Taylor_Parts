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
ok("no retired area is reintroduced as its own top-level domain", () => {
  const retiredLabels = ["Contacts", "Locations", "Equipment", "Service History"];
  for (const label of retiredLabels) {
    assert.equal(NAV_DOMAINS.some((d) => d.label === label), false, `retired top-level '${label}' must be absent`);
  }
});

console.log(`\n${passed} passed, 0 failed`);
