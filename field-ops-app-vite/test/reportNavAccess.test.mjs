// Issue #325 / ADR-007 W1 -- deterministic unit test for navConfig.js's capabilityAccess branch
// of isNavItemVisible(), the gate for the Report Builder nav item. Pure node.
//
// Run: node test/reportNavAccess.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import { NAV_DOMAINS, isNavItemVisible, isDomainVisible } from "../src/navigation/navConfig.js";
import { REPORT_WAVE1_OBJECT_READ_CAPABILITIES } from "../src/access/reportAccess.js";

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }

// operationalContext.hasCapability stand-ins: an Owner-like session (holds report caps) and a
// non-Owner one (holds none). Mirrors App.jsx binding reportHasPermission(cap, role).
const ownerCtx = { hasCapability: (cap) => REPORT_WAVE1_OBJECT_READ_CAPABILITIES.includes(cap) };
const nonOwnerCtx = { hasCapability: () => false };

const reportingDomain = NAV_DOMAINS.find((d) => d.key === "reporting");
const builderItem = reportingDomain.subnav.find((i) => i.key === "builder");

ok("the Report Builder item is capability-gated on the wave-1 object-read caps", () => {
  assert.ok(builderItem, "reporting domain has a builder item");
  assert.deepEqual([...builderItem.capabilityAccess], [...REPORT_WAVE1_OBJECT_READ_CAPABILITIES]);
});

ok("Owner sees the Report Builder item; a non-Owner does not (nav-level denial)", () => {
  assert.equal(isNavItemVisible(builderItem, "owner", [], ownerCtx), true);
  assert.equal(isNavItemVisible(builderItem, "admin", [], nonOwnerCtx), false);
  assert.equal(isNavItemVisible(builderItem, "dispatcher", [], nonOwnerCtx), false);
  assert.equal(isNavItemVisible(builderItem, "technician", [], nonOwnerCtx), false);
});

ok("the Reporting DOMAIN is visible to Owner (via builder) and to admin (via placeholders)", () => {
  assert.equal(isDomainVisible(reportingDomain, "owner", [], ownerCtx), true);
  // admin: no report caps, but the placeholder items still show under PLACEHOLDER_DEFAULT_ROLES
  assert.equal(isDomainVisible(reportingDomain, "admin", [], nonOwnerCtx), true);
});

ok("a capabilityAccess item fails closed without a previewer or with an empty grant", () => {
  const item = { key: "x", capabilityAccess: ["report.customer.read"] };
  assert.equal(isNavItemVisible(item, "owner", [], undefined), false); // no operationalContext
  assert.equal(isNavItemVisible(item, "owner", [], {}), false);        // no hasCapability fn
  assert.equal(isNavItemVisible(item, "owner", [], { hasCapability: "nope" }), false); // not a function
  assert.equal(isNavItemVisible(item, "owner", [], { hasCapability: () => false }), false); // denies
  assert.equal(isNavItemVisible(item, "owner", [], { hasCapability: () => true }), true);   // grants
});

ok("regression: the placeholder Reporting items ignore capabilityAccess and keep role gating", () => {
  const executive = reportingDomain.subnav.find((i) => i.key === "executive");
  // placeholder (no legacyKey/capabilityAccess) -> PLACEHOLDER_DEFAULT_ROLES (admin/dispatcher)
  assert.equal(isNavItemVisible(executive, "admin", [], ownerCtx), true);
  assert.equal(isNavItemVisible(executive, "owner", [], ownerCtx), false); // owner isn't a placeholder role
});

console.log(`\n${passed} passed, 0 failed`);
