// 2C.6F -- the DISTINCT production adoption authority, and the older absolute it deliberately did
// not touch.
//
// The problem this solves: `active: false` meant "inactive unless a NON-PRODUCTION environment
// adopts it", because capabilityActivationOverrides carries a triple production hard-block. That is
// a correct security boundary, not a bug -- but it left production with no way to adopt a governed
// capability at all, short of flipping the catalog globally and re-creating the unreviewed-widening
// problem 2C.6C had just fixed.
//
// So a SECOND field answers a DIFFERENT question. The two are mirror images and each refuses the
// other's role, which is what these tests pin:
//
//   capabilityActivationOverrides      non-production adoption   REFUSED in production
//   productionCapabilityActivations    production adoption       INERT outside production
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const {
  resolveCapabilityOverrides,
  resolveProductionCapabilityActivations,
  ENVIRONMENT_ACTIVATION_REGISTRY,
  PRODUCTION_ACTIVATION_ELIGIBLE_IDS,
  SPINE_OVERRIDE_ELIGIBLE_IDS,
} = require("../lib/access/environmentCapabilityOverrides.js");
const { PERMISSION_CATALOG } = require("../lib/access/permissionCatalog.js");
const { COMPATIBILITY_ROLES } = require("../lib/access/compatibilityRoles.js");
const { GOVERNED_BUSINESS_ROLES } = require("../lib/access/governedBusinessRoles.js");
const { resolveEffectivePermission } = require("../lib/access/resolveEffectivePermission.js");

const ROLES = { ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES };
const catalog = Array.isArray(PERMISSION_CATALOG) ? PERMISSION_CATALOG : Object.values(PERMISSION_CATALOG);
const REPORT = catalog.filter((p) => p.id.startsWith("report."));
const PRODUCTION = "taylor-parts";

const prodAdoptions = () => resolveProductionCapabilityActivations(ENVIRONMENT_ACTIVATION_REGISTRY, PRODUCTION);
const grantedAt = { toMillis: () => 0 };
const assign = (roleId) => [{
  id: `a-${roleId}`, principalUid: "p", roleId, scope: { type: "global" },
  grantedBy: "test", grantedAt, status: "active", accessVersionAtGrant: 1,
}];
const decide = (permissionId, roleId, overrides = prodAdoptions()) => resolveEffectivePermission({
  permissionId, assignments: assign(roleId), roles: ROLES, currentAccessVersion: 1,
  target: { scope: { type: "global" }, condition: {} }, activationOverrides: overrides,
});

// ---------------------------------------------------------------------------
// The OLD invariant, untouched. These duplicate assertions that already exist
// elsewhere ON PURPOSE -- this file is where the new mechanism is introduced, so it
// is also where "the new one did not quietly widen the old one" belongs.
// ---------------------------------------------------------------------------
test("A: production still resolves EMPTY through capabilityActivationOverrides", () => {
  assert.equal(resolveCapabilityOverrides(ENVIRONMENT_ACTIVATION_REGISTRY, PRODUCTION).size, 0);
});

test("B: POISONED production capabilityActivationOverrides still confer nothing", () => {
  const poisoned = {
    environments: [{
      role: "production",
      firebase: { projectId: PRODUCTION },
      capabilityActivationOverrides: ["report.customer.read", "opportunity.write", "salesOrder.write"],
    }],
  };
  assert.equal(resolveCapabilityOverrides(poisoned, PRODUCTION).size, 0,
    "the role-keyed block must ignore registry data entirely");
});

// ---------------------------------------------------------------------------
// The NEW mechanism, and its own refusals
// ---------------------------------------------------------------------------
test("C: productionCapabilityActivations are INERT outside production", () => {
  for (const role of ["sandbox", "integration", "development"]) {
    const registry = {
      environments: [{
        role,
        firebase: { projectId: "eos-platform-sandbox" },
        productionCapabilityActivations: ["report.customer.read"],
      }],
    };
    assert.equal(resolveProductionCapabilityActivations(registry, "eos-platform-sandbox").size, 0, role);
  }
});

test("D: only production-ELIGIBLE ids are accepted; the deferred 14 cannot slip in", () => {
  const deferred = REPORT.map((p) => p.id).filter((id) => !PRODUCTION_ACTIVATION_ELIGIBLE_IDS.has(id));
  assert.equal(deferred.length, 14, "exactly 14 report.* capabilities are deferred");
  const registry = {
    environments: [{
      role: "production",
      firebase: { projectId: PRODUCTION },
      productionCapabilityActivations: [...deferred, "not.a.real.permission", "", null, 42],
    }],
  };
  assert.equal(resolveProductionCapabilityActivations(registry, PRODUCTION).size, 0,
    "ineligible, unknown and malformed entries all fail closed");
});

test("D: eligibility is exact-id, with no prefix family and no wildcard", () => {
  // Every eligible id is a real catalog id...
  const catalogIds = new Set(catalog.map((p) => p.id));
  for (const id of PRODUCTION_ACTIVATION_ELIGIBLE_IDS) {
    assert.ok(catalogIds.has(id), `${id} must exist in the catalog`);
  }
  // ...and sharing the report.* prefix confers nothing.
  assert.equal(PRODUCTION_ACTIVATION_ELIGIBLE_IDS.has("report.definition.create"), false);
  assert.equal(PRODUCTION_ACTIVATION_ELIGIBLE_IDS.has("report.customer.field.notes.read"), false);
  // The two eligibility lists are separate authorities, not one derived from the other.
  assert.notEqual(PRODUCTION_ACTIVATION_ELIGIBLE_IDS.size, SPINE_OVERRIDE_ELIGIBLE_IDS.size);
});

test("E: an inactive permission absent from the adoption list resolves inactivePermission", () => {
  const r = decide("report.customer.field.billingAddress.read", "admin");
  assert.equal(r.decision, "DENY");
  assert.equal(r.reason, "inactivePermission");
});

// ---------------------------------------------------------------------------
// Adoption is not eligibility -- the two axes stay independent
// ---------------------------------------------------------------------------
test("F/H: adoption does NOT bypass Role eligibility", () => {
  // technician holds no report.* capability at all. The capability IS production-adopted.
  const r = decide("report.customer.read", "technician");
  assert.equal(r.decision, "DENY");
  assert.equal(r.reason, "noQualifyingGrant",
    "an adopted capability must still fail on ELIGIBILITY, not silently pass");
});

test("G: eligible Role + production-adopted capability => ALLOW", () => {
  for (const id of ["report.customer.read", "report.definition.read", "report.customer.field.name.read"]) {
    assert.equal(decide(id, "admin").decision, "ALLOW", id);
  }
});

// ---------------------------------------------------------------------------
// The exact approved set -- an EXACT-SET assertion, never "contains"
// ---------------------------------------------------------------------------
test("EXACT SET: production adopts exactly the approved 25 report capabilities", () => {
  const adopted = [...prodAdoptions()].filter((id) => id.startsWith("report.")).sort();
  assert.deepEqual(adopted, [
    "report.contact.field.customer.read",
    "report.contact.field.name.read",
    "report.contact.field.role.read",
    "report.contact.read",
    "report.customer.field.billingContact.read",
    "report.customer.field.commercialProfile.read",
    "report.customer.field.createdAt.read",
    "report.customer.field.name.read",
    "report.customer.field.relationshipTypes.read",
    "report.customer.field.status.read",
    "report.customer.field.tags.read",
    "report.customer.read",
    "report.definition.read",
    "report.equipment.field.createdAt.read",
    "report.equipment.field.customer.read",
    "report.equipment.field.dates.read",
    "report.equipment.field.identity.read",
    "report.equipment.field.location.read",
    "report.equipment.field.name.read",
    "report.equipment.field.status.read",
    "report.equipment.read",
    "report.location.field.address.read",
    "report.location.field.customer.read",
    "report.location.field.name.read",
    "report.location.read",
  ]);
  assert.equal(adopted.length, 25);
});

test("EXACT SET: none of the 14 deferred capabilities is adopted, and each denies for ACTIVATION", () => {
  const adopted = prodAdoptions();
  const deferred = [
    "report.definition.create", "report.definition.rename",
    "report.definition.duplicate", "report.definition.delete",
    "report.customer.field.billingAddress.read", "report.customer.field.externalIds.read",
    "report.customer.field.notes.read", "report.customer.field.paymentTerms.read",
    "report.customer.field.taxStatus.read", "report.customer.field.accountOwner.read",
    "report.contact.field.email.read", "report.contact.field.phone.read",
    "report.location.field.accessNotes.read", "report.equipment.field.notes.read",
  ];
  assert.equal(deferred.length, 14);
  for (const id of deferred) {
    assert.equal(adopted.has(id), false, `${id} must not be adopted`);
    const r = decide(id, "admin");
    assert.equal(r.decision, "DENY", id);
    // ACTIVATION, not eligibility -- a noQualifyingGrant here would mean admin lost the capability.
    assert.equal(r.reason, "inactivePermission", id);
  }
});

test("ELIGIBILITY 39 vs ACTIVATION 25 -- the two axes, asserted together", () => {
  assert.equal(ROLES.admin.permissions.filter((p) => p.startsWith("report.")).length, 39);
  assert.equal([...prodAdoptions()].filter((id) => id.startsWith("report.")).length, 25);
});

// ---------------------------------------------------------------------------
// Non-production postures are untouched by this tranche
// ---------------------------------------------------------------------------
test("non-production postures are unchanged by the new authority", () => {
  const sandbox = resolveCapabilityOverrides(ENVIRONMENT_ACTIVATION_REGISTRY, "eos-platform-sandbox");
  assert.equal(REPORT.filter((p) => sandbox.has(p.id)).length, 36);
  for (const projectId of ["eos-platform-certification", "demo-certworld"]) {
    const ov = resolveCapabilityOverrides(ENVIRONMENT_ACTIVATION_REGISTRY, projectId);
    assert.equal(REPORT.filter((p) => ov.has(p.id)).length, 0, projectId);
    assert.equal(resolveProductionCapabilityActivations(ENVIRONMENT_ACTIVATION_REGISTRY, projectId).size, 0,
      `${projectId} must not be routed through the production mechanism`);
  }
});

// ---------------------------------------------------------------------------
// GROUP B deployment dependency, kept visible without hard-coding an inventory
// ---------------------------------------------------------------------------
test("GROUP B guard: definition mutation stays unadopted while its callables are undeployed", () => {
  // Deliberately NOT asserted against a snapshot of production's function list -- that would bake a
  // point-in-time deployment inventory into the access suite. What is pinned is the DECISION: these
  // four are not adopted. If a future Functions bundle ships the saved-definition callables, this
  // test still passes, and the re-review obligation lives in the decision record beside it.
  for (const id of ["report.definition.create", "report.definition.rename",
                    "report.definition.duplicate", "report.definition.delete"]) {
    assert.equal(PRODUCTION_ACTIVATION_ELIGIBLE_IDS.has(id), false,
      `${id} must not even be production-ELIGIBLE until Group B is re-reviewed`);
  }
});
