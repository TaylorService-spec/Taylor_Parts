// Issue #325 / ADR-007 W1 correction -- deterministic unit test for navConfig.js's capabilityAccess
// branch (the Report Builder gate) and, critically, the compatibility-boundary regression: a raw
// `role` string never confers a governed capability, and with no trusted effective-access feed the
// item is hidden for EVERY role. Pure node.
//
// Run: node test/reportNavAccess.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import { NAV_DOMAINS, isNavItemVisible, isDomainVisible } from "../src/navigation/navConfig.js";
import { REPORT_WAVE1_OBJECT_READ_CAPABILITIES } from "../src/access/reportAccess.js";

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }

// The real App today supplies NO hasCapability (no trusted effective-access feed). This mirrors
// that: operationalContext carries only operationalRoles/employmentStatus.
const realCtx = { operationalRoles: [], employmentStatus: null };

const reportingDomain = NAV_DOMAINS.find((d) => d.key === "reporting");
const builderItem = reportingDomain.subnav.find((i) => i.key === "builder");

ok("the Report Builder item is capability-gated on the wave-1 object-read caps", () => {
  assert.ok(builderItem, "reporting domain has a builder item");
  assert.deepEqual([...builderItem.capabilityAccess], [...REPORT_WAVE1_OBJECT_READ_CAPABILITIES]);
});

// -- the correction's core regression --------------------------------------------------------
ok("REGRESSION: a raw `role` grants nothing -- the builder is hidden for every role, incl. `owner`", () => {
  for (const role of ["owner", "admin", "dispatcher", "technician", "generalEmployee"]) {
    assert.equal(
      isNavItemVisible(builderItem, role, [], realCtx), false,
      `raw role ${role} must not see the Report Builder (no trusted effective-access feed)`,
    );
  }
});

ok("REGRESSION: a raw `owner` role gets no Reporting domain at all (governed role != nav grant)", () => {
  // `owner` is not a PLACEHOLDER_DEFAULT_ROLES value and holds no legacyKey, and the builder is
  // capability-hidden -> the whole Reporting domain is invisible to a raw `owner`. The ONLY way a
  // governed role grants access is a RoleAssignment resolved server-side (D-FN), never this string.
  assert.equal(isDomainVisible(reportingDomain, "owner", [], realCtx), false);
  // admin still sees Reporting via its placeholder items (unchanged) -- but NOT the builder item.
  assert.equal(isDomainVisible(reportingDomain, "admin", [], realCtx), true);
  assert.equal(isNavItemVisible(builderItem, "admin", [], realCtx), false);
});

ok("the capabilityAccess mechanism is capability-fed, not role-based: fails closed, grants only on a feed", () => {
  const item = { key: "x", capabilityAccess: ["report.customer.read"] };
  assert.equal(isNavItemVisible(item, "owner", [], undefined), false); // no operationalContext
  assert.equal(isNavItemVisible(item, "owner", [], {}), false);        // no hasCapability fn (today's reality)
  assert.equal(isNavItemVisible(item, "owner", [], { hasCapability: "nope" }), false); // not a function
  assert.equal(isNavItemVisible(item, "owner", [], { hasCapability: () => false }), false); // denies
  // Only a real feed that AFFIRMATIVELY reports the capability grants it -- and it is keyed on the
  // capability id, never the role string. A FUTURE trusted effective-access feed wires this.
  assert.equal(isNavItemVisible(item, "admin", [], { hasCapability: (c) => c === "report.customer.read" }), true);
});

ok("regression: the placeholder Reporting items ignore capabilityAccess and keep role gating", () => {
  const executive = reportingDomain.subnav.find((i) => i.key === "executive");
  // placeholder (no legacyKey/capabilityAccess) -> PLACEHOLDER_DEFAULT_ROLES (admin/dispatcher)
  assert.equal(isNavItemVisible(executive, "admin", [], realCtx), true);
  assert.equal(isNavItemVisible(executive, "owner", [], realCtx), false); // owner isn't a placeholder role
});

console.log(`\n${passed} passed, 0 failed`);
