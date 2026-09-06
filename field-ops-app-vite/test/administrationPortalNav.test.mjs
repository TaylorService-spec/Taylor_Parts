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

// ----- Employees: CONSOLIDATED INTO USERS -----
//
// These two assertions used to pin the Employees item's index route and legacyKey "byte-for-byte".
// That pin was correct for #226, which promised not to touch it. The ADMINISTRATION USERS
// CONSOLIDATION is the later decision that does: Administration presents ONE people destination,
// and a hidden-or-duplicate Employees item is exactly the two-directories state it exists to end.
//
// So the assertions are INVERTED rather than deleted. The item must be GONE -- not navHidden,
// which would still generate a route -- and the URLs it owned must still resolve, which is a
// routing fact and is asserted in App.jsx's own suite.
ok("the Employees subnav item is gone, not merely hidden", () => {
  assert.equal(byKey("employees"), undefined, "employees must not be a nav item any more");
});
ok("no Administration item claims the index path -- /administration is a redirect, not a page", () => {
  const indexItems = adminDomain.subnav.filter((i) => i.path === "");
  assert.deepEqual(indexItems.map((i) => i.key), []);
});
ok("Users is the one people destination, at its own named path", () => {
  const users = byKey("users");
  assert.ok(users, "users subnav item present");
  assert.equal(users.path, "users");
  assert.equal(users.label, "Users");
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

// ----- Integrations: a real, complete screen (IntegrationsFaq.jsx) -- must be reachable
// from the rail, not left behind navHidden like the genuinely-unbuilt placeholders -----
ok("Integrations is not navHidden -- AppRail (!item.navHidden) renders it, matching the module README's documented 'Administration -> Integrations' journey", () => {
  const integrations = byKey("integrations");
  assert.ok(integrations, "integrations subnav item present");
  assert.equal(integrations.navHidden, undefined, "integrations must not carry navHidden -- IntegrationsFaq.jsx is a built screen, not a placeholder");
});
ok("the still-unbuilt placeholders (Vehicles, Regions, Company Settings) remain navHidden", () => {
  for (const key of ["vehicles", "regions", "companySettings"]) {
    const item = byKey(key);
    assert.equal(item.navHidden, true, `${key} should still be navHidden -- it has no built screen`);
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
ok("exactly fifteen Administration subnav items now exist", () => {
  // The count is pinned so a nav item cannot appear by accident. Duplicate Rules
  // was added deliberately (Owner, 2026-08-19) as its own tab under Administration, and
  // Objects (the Role x Object x CRED grid) deliberately on 2026-08-20. The pin earned its
  // keep immediately: a scripted edit inserted Objects TWICE and this assertion caught it.
  // Warehouse Racking joined them for BIN-P3 (2026-09-02): the physical shape of a warehouse is
  // governed configuration, so it sits with the other configuration surfaces rather than in an
  // Inventory workspace.
  // Financial Policy joined for CERT-FIN-02 (2026-09-03): a company's accounting method is chosen
  // once with its accounting team at deployment and locked at financial activation, which makes it
  // company setup rather than routine financial work. Financials carries a read-only summary that
  // links here; this is the single editing surface.
  // Data Import joined for DATA IMPORT P1 (2026-09-04): loading a customer's existing records is an
  // implementation activity an administrator performs once per data set, which is the same kind of
  // thing as Roles and Racking. It is the first Administration item gated by capabilityAccess rather
  // than by role, because its capabilities are activated per environment.
  // FOURTEEN, not fifteen, since the ADMINISTRATION USERS CONSOLIDATION (2026-09-04): Employees and
  // Users were two destinations over one set of people and are now one. The pin going DOWN is the
  // point -- a consolidation that left the old item in place would show here as an unchanged count.
  // Email & Communications joined for EMAIL CONNECTIONS + INBOUND WORK (2026-09-05): provider
  // connections, operational mailboxes, routing rules, processing and exceptions. ONE item carrying
  // seven sections as tabs, not seven rail items -- the parts of one configuration subject belong
  // under the subject. Capability-gated like Data Import, for the same reason.
  assert.equal(adminDomain.subnav.length, 15);
});

ok("Financial Policy is a visible Administration tab, and the only one", () => {
  const item = adminDomain.subnav.find((i) => i.key === "financialPolicy");
  assert.ok(item, "financialPolicy subnav item must exist");
  assert.equal(item.path, "financial-policy");
  assert.equal(item.label, "Financial Policy");
  assert.notEqual(item.navHidden, true, "a configuration surface nobody can reach is not a surface");
  assert.equal(
    adminDomain.subnav.filter((i) => i.key === "financialPolicy").length,
    1,
    "exactly one nav slot may configure financial policy",
  );
});

ok("Duplicate Rules is a visible Administration tab, not hidden", () => {
  const item = adminDomain.subnav.find((i) => i.key === "duplicateRules");
  assert.ok(item, "duplicateRules subnav item must exist");
  assert.equal(item.path, "duplicate-rules");
  assert.equal(item.label, "Duplicate Rules");
  // navHidden would make it routed-but-unreachable -- the exact defect sweep R1-19
  // found on the Integrations item.
  assert.notEqual(item.navHidden, true);
});

console.log(`\n${passed} passed, 0 failed`);
