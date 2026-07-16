// Issue #226 Row 10 -- Admin Portal foundation. Deterministic unit tests for the
// two net-new Administration subnav items (Overview, Permission Preview) and
// the preserved behavior of every existing Administration item (Spec sec16 MVP
// surfaces: Overview, Users, Roles & Permissions, Permission Preview, Audit
// Logs). Per docs/implementation-plans/enterprise-access-prototype-
// reconciliation.md sec2/sec3: Employees keeps its route/legacyKey/index
// position untouched, and no existing item's gating changes.
//
// Run: node test/administrationPortalNav.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import { NAV_DOMAINS, isDomainVisible, isNavItemVisible } from "../src/navigation/navConfig.js";
import { ROLES, ROLE_NAV_ACCESS } from "../src/domain/constants.js";

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }

const adminDomain = NAV_DOMAINS.find((d) => d.key === "administration");
const allowed = (role) => ROLE_NAV_ACCESS[role] ?? [];
const byKey = (key) => adminDomain.subnav.find((i) => i.key === key);

// ----- Overview: net-new, reachable, admin/dispatcher-only, does not steal the index route -----
ok("Overview subnav item exists at a named path (not the index)", () => {
  const overview = byKey("overview");
  assert.ok(overview, "overview subnav item present");
  assert.equal(overview.path, "overview");
  assert.equal(overview.legacyKey, undefined);
});
ok("Overview is admin/dispatcher visible, technician fail-closed", () => {
  const overview = byKey("overview");
  assert.equal(isNavItemVisible(overview, ROLES.ADMIN, allowed(ROLES.ADMIN)), true);
  assert.equal(isNavItemVisible(overview, ROLES.DISPATCHER, allowed(ROLES.DISPATCHER)), true);
  assert.equal(isNavItemVisible(overview, ROLES.TECHNICIAN, allowed(ROLES.TECHNICIAN)), false);
});

// ----- Permission Preview: net-new, reachable, admin/dispatcher-only -----
ok("Permission Preview subnav item exists at a named path", () => {
  const preview = byKey("permissionPreview");
  assert.ok(preview, "permissionPreview subnav item present");
  assert.equal(preview.path, "permission-preview");
  assert.equal(preview.legacyKey, undefined);
});
ok("Permission Preview is admin/dispatcher visible, technician fail-closed", () => {
  const preview = byKey("permissionPreview");
  assert.equal(isNavItemVisible(preview, ROLES.ADMIN, allowed(ROLES.ADMIN)), true);
  assert.equal(isNavItemVisible(preview, ROLES.DISPATCHER, allowed(ROLES.DISPATCHER)), true);
  assert.equal(isNavItemVisible(preview, ROLES.TECHNICIAN, allowed(ROLES.TECHNICIAN)), false);
});

// ----- Employees: route/legacyKey/index position untouched -----
ok("Employees keeps its index route and legacyKey byte-for-byte (never touched by #226)", () => {
  const employees = byKey("employees");
  assert.ok(employees, "employees subnav item present");
  assert.equal(employees.path, "");
  assert.equal(employees.legacyKey, "technicians");
});
ok("Employees is still the only item with path '' -- the bare /administration URL still resolves there", () => {
  const indexItems = adminDomain.subnav.filter((i) => i.path === "");
  assert.deepEqual(indexItems.map((i) => i.key), ["employees"]);
});

// ----- Every pre-existing item's gating is unchanged -----
ok("existing Users/Roles & Permissions/Vehicles/Regions/Company Settings/Integrations/Audit Logs items are untouched", () => {
  const untouchedKeys = ["users", "rolesPermissions", "vehicles", "regions", "companySettings", "integrations", "auditLogs"];
  for (const key of untouchedKeys) {
    const item = byKey(key);
    assert.ok(item, `${key} subnav item must still be present`);
    assert.equal(item.legacyKey, undefined, `${key} must remain legacyKey-less (still a PlaceholderPage/deferred surface)`);
    assert.equal(isNavItemVisible(item, ROLES.ADMIN, allowed(ROLES.ADMIN)), true);
    assert.equal(isNavItemVisible(item, ROLES.DISPATCHER, allowed(ROLES.DISPATCHER)), true);
    assert.equal(isNavItemVisible(item, ROLES.TECHNICIAN, allowed(ROLES.TECHNICIAN)), false);
  }
});

// ----- Domain-level visibility/label/path unchanged -----
ok("the Administration domain itself is still admin/dispatcher visible, technician fail-closed", () => {
  assert.equal(isDomainVisible(adminDomain, ROLES.ADMIN, allowed(ROLES.ADMIN)), true);
  assert.equal(isDomainVisible(adminDomain, ROLES.DISPATCHER, allowed(ROLES.DISPATCHER)), true);
  assert.equal(isDomainVisible(adminDomain, ROLES.TECHNICIAN, allowed(ROLES.TECHNICIAN)), false);
});
ok("the Administration domain's key/path/label are unchanged", () => {
  assert.equal(adminDomain.key, "administration");
  assert.equal(adminDomain.path, "administration");
  assert.equal(adminDomain.label, "Administration");
});
ok("exactly ten Administration subnav items now exist (eight original + Overview + Permission Preview)", () => {
  assert.equal(adminDomain.subnav.length, 10);
});

console.log(`\n${passed} passed, 0 failed`);
