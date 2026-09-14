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
//
// =====================================================================================
// RPT-FIX CORRECTION (baseline: post/eng-e-report-scope @ 92db1d19, parent main
// @ 64008d5ae0bdd9532909671b15a91122400accf1). READ THIS BEFORE TRUSTING THIS FILE.
//
// At 92db1d19 this file asserted that production was FAIL-CLOSED for all 39 report.*
// capabilities, AND IT PASSED -- while 25 of them were actually LIVE in production.
//
// The cause was the RESOLVER CHOICE, not any assertion. Activation has TWO authorities:
//
//   resolveCapabilityOverrides()            the NON-PRODUCTION authority. It HARD-BLOCKS on
//                                           role === "production" and therefore returns EMPTY
//                                           for taylor-parts, always, by design.
//   resolveProductionCapabilityActivations() the PRODUCTION authority, reading
//                                           `productionCapabilityActivations`.
//   resolveRuntimeCapabilityOverrides()      the RUNTIME authority: the single place the two are
//                                           composed (`production.size > 0 ? production :
//                                           nonProduction`), and what all eleven runtime consumers
//                                           actually read -- reporting execution and saved
//                                           definitions among them, by that function's own comment.
//
// This file asked a PRODUCTION question of the NON-PRODUCTION authority. Its answer -- an empty
// set -- is correct for what it asked and useless for what it claimed. Every "production denies"
// assertion below was then tautologically true.
//
// Measured here, independently, by executing the resolvers rather than reading them:
//   resolveCapabilityOverrides(REGISTRY, "taylor-parts").size            == 0
//   resolveProductionCapabilityActivations(REGISTRY, "taylor-parts").size == 25
//   resolveRuntimeCapabilityOverrides() under GCLOUD_PROJECT=taylor-parts == 25
//   report.* in the catalog                                              == 39   -> 25 live / 14 not
//
// A GREEN TEST ASSERTING A FALSE SAFETY PROPERTY IS WORSE THAN NO TEST, because it spends the
// reader's trust. The assertions below now state the TRUE posture, pinned to the exact id lists, so
// a future activation change FAILS this test instead of silently widening.
//
// WHAT THIS CORRECTION DOES NOT DO: it changes NO activation. Whether 25 ids should be live in
// production is an Owner decision with a scoped recommendation already pending; it is not this
// file's to make, and this file is now the instrument that would show such a decision landing.
// =====================================================================================
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const { PERMISSION_CATALOG } = require("../lib/access/permissionCatalog.js");
const { COMPATIBILITY_ROLES } = require("../lib/access/compatibilityRoles.js");
const { GOVERNED_BUSINESS_ROLES } = require("../lib/access/governedBusinessRoles.js");
const { resolveEffectivePermission } = require("../lib/access/resolveEffectivePermission.js");
const {
  resolveCapabilityOverrides,
  resolveProductionCapabilityActivations,
  resolveRuntimeCapabilityOverrides,
  __resetRuntimeCapabilityOverridesCacheForTest,
  ENVIRONMENT_ACTIVATION_REGISTRY,
  SPINE_OVERRIDE_ELIGIBLE_IDS,
} = require("../lib/access/environmentCapabilityOverrides.js");
const { readFileSync, readdirSync } = require("node:fs");
const { join } = require("node:path");
const THIS_FILE = join(import.meta.dirname, "reportingActivationBoundary.test.mjs");
const SRC_DIR = join(import.meta.dirname, "..", "src");

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
// RPT-FIX: renamed from REPORTING_NOT_LIVE, which was false -- taylor-parts IS partly live. These
// are simply the non-sandbox environments; what each activates is asserted per environment below.
const REPORTING_OTHER_ENVIRONMENTS = ["taylor-parts", "eos-platform-certification", "demo-certworld"];

const grantedAt = { toMillis: () => 0 };
const adminAssignment = [{
  id: "a", principalUid: "p", roleId: "admin", scope: { type: "global" },
  grantedBy: "test", grantedAt, status: "active", accessVersionAtGrant: 1,
}];
const decide = (permissionId, overrides) => resolveEffectivePermission({
  permissionId, assignments: adminAssignment, roles: ROLES, currentAccessVersion: 1,
  target: { scope: { type: "global" }, condition: {} }, activationOverrides: overrides,
});
// THE RUNTIME AUTHORITY -- the only resolver that can answer an activation question for ANY
// environment, production included. Its result is memoized at cold start, so the cache is reset per
// project (the module exports a test-only reset for exactly this).
const overridesFor = (projectId) => {
  process.env.GCLOUD_PROJECT = projectId;
  __resetRuntimeCapabilityOverridesCacheForTest();
  return resolveRuntimeCapabilityOverrides();
};
// Kept ONLY to assert the blind spot itself, never as an activation authority.
const nonProductionAuthorityFor = (projectId) =>
  resolveCapabilityOverrides(ENVIRONMENT_ACTIVATION_REGISTRY, projectId);

// The TRUE production posture, pinned id by id. Not a count -- a count would let one id be swapped
// for another without a failure.
const PRODUCTION_ACTIVE_REPORT_IDS = Object.freeze([
  "report.customer.read",
  "report.customer.field.name.read",
  "report.customer.field.status.read",
  "report.customer.field.relationshipTypes.read",
  "report.customer.field.tags.read",
  "report.customer.field.createdAt.read",
  "report.customer.field.commercialProfile.read",
  "report.customer.field.billingContact.read",
  "report.contact.read",
  "report.contact.field.name.read",
  "report.contact.field.role.read",
  "report.contact.field.customer.read",
  "report.location.read",
  "report.location.field.name.read",
  "report.location.field.address.read",
  "report.location.field.customer.read",
  "report.equipment.read",
  "report.equipment.field.name.read",
  "report.equipment.field.status.read",
  "report.equipment.field.identity.read",
  "report.equipment.field.dates.read",
  "report.equipment.field.customer.read",
  "report.equipment.field.location.read",
  "report.equipment.field.createdAt.read",
  "report.definition.read",
]);
const PRODUCTION_INACTIVE_REPORT_IDS = Object.freeze([
  "report.customer.field.billingAddress.read",
  "report.customer.field.externalIds.read",
  "report.customer.field.notes.read",
  "report.customer.field.paymentTerms.read",
  "report.customer.field.taxStatus.read",
  "report.customer.field.accountOwner.read",
  "report.contact.field.email.read",
  "report.contact.field.phone.read",
  "report.location.field.accessNotes.read",
  "report.equipment.field.notes.read",
  "report.definition.create",
  "report.definition.rename",
  "report.definition.duplicate",
  "report.definition.delete",
]);
const CERTIFICATION_WORLDS = ["eos-platform-certification", "demo-certworld"];

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
test("PRODUCTION: 25 named report.* ids are ACTIVE and the other 14 are not -- exact sets", () => {
  // The assertion this replaces claimed all 39 were inactive, resolved through the
  // NON-PRODUCTION authority, and passed. This is the true posture.
  const overrides = overridesFor(PRODUCTION);
  assert.equal(overrides.size, 25, "the production activation set is 25 ids");

  const catalogIds = REPORT.map((p) => p.id);
  assert.equal(
    PRODUCTION_ACTIVE_REPORT_IDS.length + PRODUCTION_INACTIVE_REPORT_IDS.length,
    catalogIds.length,
    "the two pinned lists must partition the whole report.* family",
  );
  assert.deepEqual(
    catalogIds.filter((id) => overrides.has(id)).sort(),
    [...PRODUCTION_ACTIVE_REPORT_IDS].sort(),
    "the set of PRODUCTION-ACTIVE report.* ids changed. This is a production activation change: " +
      "confirm it was an Owner decision before updating this list.",
  );
  assert.deepEqual(
    catalogIds.filter((id) => !overrides.has(id)).sort(),
    [...PRODUCTION_INACTIVE_REPORT_IDS].sort(),
    "the set of production-INACTIVE report.* ids changed",
  );

  // Every id is still registered inactive in the CATALOG -- activation comes only from the
  // environment, which is what makes the 25 an environment decision rather than a code default.
  for (const p of REPORT) {
    assert.equal(p.active, false, `${p.id} must be registered catalog-inactive`);
  }

  // And the resolution itself, per id, for a global-scoped admin.
  for (const id of PRODUCTION_ACTIVE_REPORT_IDS) {
    assert.equal(decide(id, overrides).decision, "ALLOW", `${id} is LIVE in production`);
  }
  for (const id of PRODUCTION_INACTIVE_REPORT_IDS) {
    const r = decide(id, overrides);
    assert.equal(r.decision, "DENY", `${id} must DENY in production`);
    // The reason still matters: the denial has to come from ACTIVATION, before Role eligibility is
    // ever considered. A `noQualifyingGrant` here would mean we had accidentally "fixed" this by
    // taking the capability away from admin.
    assert.equal(r.reason, "inactivePermission", `${id} must deny for ACTIVATION, not eligibility`);
  }
});

test("PRODUCTION: the four representative surfaces named in the ruling -- TWO allow, two deny", () => {
  // The assertion this replaces said all four denied. Two of them are live. Naming which, and why
  // the split falls where it does, is the whole point: ordinary object/definition READS are
  // activated; SENSITIVE field reads and definition MUTATIONS are not.
  const overrides = overridesFor(PRODUCTION);
  const expected = [
    ["report.customer.read", "ALLOW"],                      // object read -- LIVE
    ["report.definition.read", "ALLOW"],                    // definition read -- LIVE
    ["report.customer.field.billingAddress.read", "DENY"],   // sensitive field read -- not activated
    ["report.definition.create", "DENY"],                   // definition mutation -- not activated
  ];
  for (const [id, decision] of expected) {
    const r = decide(id, overrides);
    assert.equal(r.decision, decision, id);
    if (decision === "DENY") assert.equal(r.reason, "inactivePermission", id);
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

test("BOTH CERTIFICATION WORLDS are fail-closed for reporting -- and production is NOT", () => {
  // Split out of a single assertion that lumped production in with the certification worlds and
  // claimed all three were fail-closed. The certification half was and remains true.
  for (const projectId of CERTIFICATION_WORLDS) {
    const overrides = overridesFor(projectId);
    assert.equal(REPORT.filter((p) => overrides.has(p.id)).length, 0, projectId);
    assert.equal(decide("report.customer.read", overrides).reason, "inactivePermission", projectId);
  }
  const prod = overridesFor(PRODUCTION);
  assert.equal(
    REPORT.filter((p) => prod.has(p.id)).length,
    25,
    "production is NOT fail-closed for reporting. Asserting that it is was the defect this file " +
      "shipped at 92db1d19.",
  );
});

test("the three capabilities that were already inactive stay inactive everywhere", () => {
  const previouslyInactive = REPORT.filter((p) => !overridesFor("eos-platform-sandbox").has(p.id));
  assert.equal(previouslyInactive.length, 3);
  for (const projectId of [...REPORTING_LIVE, ...REPORTING_OTHER_ENVIRONMENTS]) {
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

// ---------------------------------------------------------------------------
// RPT-FIX RATCHET -- on the RESOLVER CHOICE itself, which is the bug class.
// ---------------------------------------------------------------------------
test("RATCHET: the two authorities DISAGREE for production -- so the resolver choice is load-bearing", () => {
  // This is the defect stated as a live fact rather than as a comment. The non-production authority
  // returns EMPTY for a production project id BY DESIGN (it hard-blocks on role "production"), so
  // any production question asked of it answers "nothing is active" no matter what is active. A
  // guard built on it cannot fail, which is exactly how this file passed while being wrong.
  const nonProduction = nonProductionAuthorityFor(PRODUCTION);
  const production = resolveProductionCapabilityActivations(ENVIRONMENT_ACTIVATION_REGISTRY, PRODUCTION);
  const runtime = overridesFor(PRODUCTION);

  assert.equal(nonProduction.size, 0, "the NON-PRODUCTION authority is empty for a production project");
  assert.equal(production.size, 25, "the PRODUCTION authority carries the real activation set");
  assert.equal(runtime.size, 25, "the RUNTIME authority composes them and yields the production set");
  assert.notEqual(
    nonProduction.size,
    runtime.size,
    "if these ever agree for production, this ratchet has stopped proving anything -- re-derive it",
  );
});

test("RATCHET: this file answers every production activation question through the RUNTIME authority", () => {
  const src = readFileSync(THIS_FILE, "utf8");
  const helper = src.slice(src.indexOf("const overridesFor ="), src.indexOf("// Kept ONLY to assert"));
  assert.match(
    helper,
    /resolveRuntimeCapabilityOverrides\(\)/,
    "overridesFor() must resolve through resolveRuntimeCapabilityOverrides() -- resolving through " +
      "resolveCapabilityOverrides() alone is what made this guard assert a falsehood",
  );
  assert.ok(
    !/resolveCapabilityOverrides\(/.test(helper),
    "overridesFor() must not reach for the non-production authority",
  );
  // resolveCapabilityOverrides may be CALLED in this file exactly once -- as the named contrast.
  // The pattern requires an ARGUMENT, so prose mentions of "resolveCapabilityOverrides()" in the
  // header and in assertion messages are not counted as calls.
  const callLines = [...src.matchAll(/(?<![A-Za-z])resolveCapabilityOverrides\(\s*[A-Za-z]/g)]
    .map((m) => {
      const start = src.lastIndexOf("\n", m.index) + 1;
      return src.slice(start, src.indexOf("\n", m.index)).trim();
    })
    // Drop comment lines, and drop lines where the name appears inside a STRING (including this
    // assertion's own expected value, which would otherwise match itself).
    .filter((line) => {
      if (line.startsWith("//")) return false;
      const prefix = line.slice(0, line.indexOf("resolveCapabilityOverrides"));
      return !/["'`]/.test(prefix);
    });
  assert.deepEqual(
    callLines,
    ["resolveCapabilityOverrides(ENVIRONMENT_ACTIVATION_REGISTRY, projectId);"],
    "the non-production authority may be CALLED exactly once in this file (inside " +
      "nonProductionAuthorityFor, the blind-spot contrast) and never to answer a real question",
  );
});

test("RATCHET: no runtime module under src/ answers an activation question with the non-production authority", () => {
  // Verified true at this baseline: every one of the runtime consumers resolves through
  // resolveRuntimeCapabilityOverrides(). This pins it, because a single src/ module reaching for
  // resolveCapabilityOverrides() would be silently fail-OPEN-looking in production the same way
  // this test file was.
  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith(".ts")) continue;
      // The resolver module itself is where both authorities legitimately live.
      if (full.endsWith(join("access", "environmentCapabilityOverrides.ts"))) continue;
      const text = readFileSync(full, "utf8");
      for (const m of text.matchAll(/(?<![A-Za-z])resolveCapabilityOverrides\s*\(/g)) {
        const lineStart = text.lastIndexOf("\n", m.index) + 1;
        const line = text.slice(lineStart, text.indexOf("\n", m.index));
        if (/^\s*(\/\/|\*)/.test(line)) continue; // a comment mentioning it is fine
        offenders.push(`${full.slice(full.indexOf("/src/") + 1)}: ${line.trim()}`);
      }
    }
  };
  walk(SRC_DIR);
  assert.deepEqual(
    offenders,
    [],
    "these runtime modules resolve activation through the NON-PRODUCTION authority, which returns " +
      "EMPTY for production by design:\n  " + offenders.join("\n  "),
  );
});
