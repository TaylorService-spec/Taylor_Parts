// 2C.6C -- the two authority axes for Reporting, pinned so neither can be "fixed" by damaging the
// other.
//
//   ELIGIBILITY  who may exercise a capability   -> admin holds the ENTIRE report.* family
//   ACTIVATION   is the family live HERE          -> sandbox: yes; production AND both
//                                                   certification worlds: no
//
// The failure this guards against is specific and was measured, not imagined: 36 of the 39 report.*
// capabilities were catalog `active: true`, which in this architecture means live in EVERY
// environment, because an environment override set can only ADD activation and never remove it.
// `runReportDefinitionCallable` is ALREADY DEPLOYED IN PRODUCTION. So a generic current-main
// Functions publish would have taken production admin from 0 report capabilities to 39 -- including
// 30 field-level reads over customer/contact/equipment/location, among them billingAddress,
// externalIds, paymentTerms, taxStatus -- with no production activation review.
//
// The tempting "fix" is to delete report.* from admin. That is forbidden: it answers an ACTIVATION
// question by damaging ELIGIBILITY, and it would break the standing "Admin can do all things"
// invariant. Hence the first test.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const { PERMISSION_CATALOG } = require("../lib/access/permissionCatalog.js");
const { COMPATIBILITY_ROLES } = require("../lib/access/compatibilityRoles.js");
const { GOVERNED_BUSINESS_ROLES } = require("../lib/access/governedBusinessRoles.js");
const { resolveEffectivePermission } = require("../lib/access/resolveEffectivePermission.js");
const { resolveCapabilityOverrides, ENVIRONMENT_ACTIVATION_REGISTRY, SPINE_OVERRIDE_ELIGIBLE_IDS } =
  require("../lib/access/environmentCapabilityOverrides.js");

const ROLES = { ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES };
const catalog = Array.isArray(PERMISSION_CATALOG) ? PERMISSION_CATALOG : Object.values(PERMISSION_CATALOG);
const REPORT = catalog.filter((p) => p.id.startsWith("report."));
const PRODUCTION = "taylor-parts";
// SANDBOX is the only environment that keeps Reporting live, and that is deliberate.
//
// The two certification environments pin their activation sets with EXACT-SET assertions whose own
// comment says "an activation list is not a wish list" and warns that a subset check would let a
// future edit quietly widen the certification emulator. Spreading 36 reporting ids into them would
// have broken exactly the control those assertions exist to enforce, so they are not spread there.
//
// Certification does name report.definition.read, in certificationWorld/authorityMatrix.mjs. That
// matrix asserts ROLE ELIGIBILITY -- which Role must hold the capability -- and not environment
// activation. Role membership is untouched here: admin, owner, reportViewer and reportAuthor all
// still hold it. So certification loses nothing it was actually asserting.
const REPORTING_LIVE = ["eos-platform-sandbox"];
const REPORTING_NOT_LIVE = ["taylor-parts", "eos-platform-certification", "demo-certworld"];

const grantedAt = { toMillis: () => 0 };
const adminAssignment = [{
  id: "a", principalUid: "p", roleId: "admin", scope: { type: "global" },
  grantedBy: "test", grantedAt, status: "active", accessVersionAtGrant: 1,
}];
const decide = (permissionId, overrides) => resolveEffectivePermission({
  permissionId, assignments: adminAssignment, roles: ROLES, currentAccessVersion: 1,
  target: { scope: { type: "global" }, condition: {} }, activationOverrides: overrides,
});
const overridesFor = (projectId) => resolveCapabilityOverrides(ENVIRONMENT_ACTIVATION_REGISTRY, projectId);

// ---------------------------------------------------------------------------
// ELIGIBILITY -- must survive any future activation work
// ---------------------------------------------------------------------------
test("ADMIN_ALL_PERMISSIONS contains EVERY registered report.* capability", () => {
  const adminPerms = new Set(ROLES.admin.permissions);
  const missing = REPORT.map((p) => p.id).filter((id) => !adminPerms.has(id));
  assert.deepEqual(
    missing, [],
    "admin must remain eligible for the whole reporting family -- an activation problem is never " +
    "solved by removing capabilities from admin",
  );
  assert.ok(REPORT.length >= 39, `expected at least 39 report.* capabilities, found ${REPORT.length}`);
});

// ---------------------------------------------------------------------------
// ACTIVATION -- production is fail-closed
// ---------------------------------------------------------------------------
test("PRODUCTION: every report.* capability is inactive, so admin resolves DENY", () => {
  const overrides = overridesFor(PRODUCTION);
  assert.equal(overrides.size, 0, "production carries no activation overrides");
  for (const p of REPORT) {
    assert.equal(p.active, false, `${p.id} must be registered inactive`);
    const r = decide(p.id, overrides);
    assert.equal(r.decision, "DENY", `${p.id} must DENY in production`);
    // The reason matters as much as the decision: the denial has to come from ACTIVATION, before
    // Role eligibility is ever considered. A `noQualifyingGrant` here would mean we had accidentally
    // fixed this by taking the capability away from admin.
    assert.equal(r.reason, "inactivePermission", `${p.id} must deny for ACTIVATION, not eligibility`);
  }
});

test("PRODUCTION: the four representative surfaces named in the ruling all deny", () => {
  const overrides = overridesFor(PRODUCTION);
  for (const id of [
    "report.customer.read",                       // object read
    "report.definition.read",                     // definition read
    "report.customer.field.billingAddress.read",  // sensitive field read
    "report.definition.create",                   // definition mutation
  ]) {
    const r = decide(id, overrides);
    assert.equal(r.decision, "DENY", id);
    assert.equal(r.reason, "inactivePermission", id);
  }
});

// ---------------------------------------------------------------------------
// NON-REGRESSION -- the correction changes exactly one environment
// ---------------------------------------------------------------------------
test("SANDBOX keeps the exact Reporting posture it already had -- 36 of 39", () => {
  for (const projectId of REPORTING_LIVE) {
    const overrides = overridesFor(projectId);
    assert.equal(REPORT.filter((p) => overrides.has(p.id)).length, 36, projectId);
    assert.equal(decide("report.customer.read", overrides).decision, "ALLOW", projectId);
  }
});

test("every other environment -- production AND both certification worlds -- is fail-closed", () => {
  for (const projectId of REPORTING_NOT_LIVE) {
    const overrides = overridesFor(projectId);
    assert.equal(REPORT.filter((p) => overrides.has(p.id)).length, 0, projectId);
    assert.equal(decide("report.customer.read", overrides).reason, "inactivePermission", projectId);
  }
});

test("the three capabilities that were already inactive stay inactive everywhere", () => {
  const previouslyInactive = REPORT.filter((p) => !overridesFor("eos-platform-sandbox").has(p.id));
  assert.equal(previouslyInactive.length, 3);
  for (const projectId of [...REPORTING_LIVE, ...REPORTING_NOT_LIVE]) {
    for (const p of previouslyInactive) {
      assert.equal(decide(p.id, overridesFor(projectId)).decision, "DENY", `${p.id} @ ${projectId}`);
    }
  }
});

test("report.* is override-eligible, or the environment entries would be silently inert", () => {
  const live = REPORT.filter((p) => overridesFor("eos-platform-sandbox").has(p.id));
  for (const p of live) {
    assert.ok(SPINE_OVERRIDE_ELIGIBLE_IDS.has(p.id), `${p.id} must be override-eligible`);
  }
});

// ---------------------------------------------------------------------------
// THE DISTINCTION, asserted directly
// ---------------------------------------------------------------------------
test("admin is ELIGIBLE for reporting everywhere and ACTIVE for it only where the environment says so", () => {
  const id = "report.customer.field.paymentTerms.read";
  assert.ok(ROLES.admin.permissions.includes(id), "eligibility is global");
  assert.equal(decide(id, overridesFor(PRODUCTION)).decision, "DENY");
  assert.equal(decide(id, overridesFor("eos-platform-sandbox")).decision, "ALLOW");
});
