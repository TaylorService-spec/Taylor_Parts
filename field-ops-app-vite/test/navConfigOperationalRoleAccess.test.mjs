// Issue #100 (docs/specifications/inventory-nav-access-alignment.md,
// docs/implementation-plans/inventory-nav-access-alignment.md, PR 0).
// Deterministic unit test for navConfig.js's operationalRoleAccess/
// operationalContext extension to isNavItemVisible()/isDomainVisible().
//
// Two concerns, kept separate:
// 1. Regression -- every EXISTING NAV_DOMAINS item (legacyKey,
//    PLACEHOLDER_DEFAULT_ROLES, alwaysVisible) renders identically
//    whether or not operationalContext is passed at all, for every
//    existing role. PR 0 itself added no operationalRoleAccess item to
//    NAV_DOMAINS -- PR 1b/2b (WAREHOUSE_MANAGER, PARTS_MANAGER) later
//    did -- so this suite proves the extension is genuinely additive
//    against the real, current tree. Items/domains that themselves
//    declare (or are composed entirely of) operationalRoleAccess are
//    correctly EXCLUDED from this specific "never changes" invariant --
//    those are the intentionally-reactive ones this whole feature
//    exists to add; asserting they never change with operationalContext
//    would contradict their own design, not protect against a
//    regression. The invariant still applies in full to every
//    legacyKey/PLACEHOLDER_DEFAULT_ROLES/alwaysVisible item, unchanged.
// 2. Fail-closed -- a synthetic item declaring operationalRoleAccess
//    is denied for every edge case (wrong role, missing/null
//    operationalContext, inactive employment, ineligible/empty
//    operationalRoles, invalid/unrecognized role strings) and granted
//    only for the one case that should succeed.
//
// Run: node test/navConfigOperationalRoleAccess.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import { NAV_DOMAINS, isNavItemVisible, isDomainVisible } from "../src/navigation/navConfig.js";
import { ROLES, ROLE_NAV_ACCESS } from "../src/domain/constants.js";

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }

// --- Regression: every real NAV_DOMAINS item, every real role, with and without operationalContext ---
const REAL_ROLES = [ROLES.ADMIN, ROLES.DISPATCHER, ROLES.TECHNICIAN];
const SOME_OPERATIONAL_CONTEXTS = [
  undefined,
  null,
  { operationalRoles: [], employmentStatus: null },
  { operationalRoles: ["PARTS_MANAGER"], employmentStatus: "ACTIVE" },
];

ok("regression: every existing NAV_DOMAINS item's visibility is identical regardless of operationalContext", () => {
  for (const role of REAL_ROLES) {
    const allowedLegacyKeys = ROLE_NAV_ACCESS[role] ?? [];
    for (const domain of NAV_DOMAINS) {
      // A domain composed entirely of operationalRoleAccess items (e.g.
      // "inventoryRole") has no legacyKey/PLACEHOLDER baseline to
      // protect -- its own isDomainVisible() is BY DESIGN a function of
      // operationalContext, not a regression if it changes. Domains that
      // mix such items with ordinary ones (none currently do) would
      // still need per-item exclusion below; the domain-level check here
      // only skips wholesale-reactive domains.
      const domainIsWhollyOperationalRoleGated =
        !domain.future && domain.subnav.length > 0 && domain.subnav.every((item) => item.operationalRoleAccess);
      if (!domainIsWhollyOperationalRoleGated) {
        const baseline = isDomainVisible(domain, role, allowedLegacyKeys);
        for (const operationalContext of SOME_OPERATIONAL_CONTEXTS) {
          assert.equal(
            isDomainVisible(domain, role, allowedLegacyKeys, operationalContext),
            baseline,
            `domain "${domain.key}" for role "${role}" changed with operationalContext=${JSON.stringify(operationalContext)}`
          );
        }
      }
      if (domain.future) continue;
      for (const item of domain.subnav) {
        // operationalRoleAccess items are intentionally reactive to
        // operationalContext -- excluded from this "never changes"
        // invariant; covered instead by the dedicated
        // operationalRoleAccess assertions below.
        if (item.operationalRoleAccess) continue;
        const itemBaseline = isNavItemVisible(item, role, allowedLegacyKeys);
        for (const operationalContext of SOME_OPERATIONAL_CONTEXTS) {
          assert.equal(
            isNavItemVisible(item, role, allowedLegacyKeys, operationalContext),
            itemBaseline,
            `item "${domain.key}.${item.key}" for role "${role}" changed with operationalContext=${JSON.stringify(operationalContext)}`
          );
        }
      }
    }
  }
});

ok("regression: technician's existing Inventory (parts) access is still denied, unchanged", () => {
  const inventoryDomain = NAV_DOMAINS.find((d) => d.key === "inventory");
  const allowedLegacyKeys = ROLE_NAV_ACCESS[ROLES.TECHNICIAN] ?? [];
  assert.equal(isDomainVisible(inventoryDomain, ROLES.TECHNICIAN, allowedLegacyKeys), false);
  assert.equal(
    isDomainVisible(inventoryDomain, ROLES.TECHNICIAN, allowedLegacyKeys, { operationalRoles: [], employmentStatus: null }),
    false
  );
});

ok("regression: admin/dispatcher's existing full access is unaffected by any operationalContext value", () => {
  const inventoryDomain = NAV_DOMAINS.find((d) => d.key === "inventory");
  for (const role of [ROLES.ADMIN, ROLES.DISPATCHER]) {
    const allowedLegacyKeys = ROLE_NAV_ACCESS[role] ?? [];
    for (const operationalContext of SOME_OPERATIONAL_CONTEXTS) {
      assert.equal(isDomainVisible(inventoryDomain, role, allowedLegacyKeys, operationalContext), true);
    }
  }
});

// --- Fail-closed: a synthetic operationalRoleAccess item ---
const eligibleItem = { key: "synthetic", label: "Synthetic", path: "synthetic", operationalRoleAccess: ["PARTS_MANAGER", "WAREHOUSE_MANAGER"] };

ok("operationalRoleAccess: granted for the one case that should succeed -- technician, ACTIVE, eligible role present", () => {
  const granted = isNavItemVisible(eligibleItem, ROLES.TECHNICIAN, [], { operationalRoles: ["PARTS_MANAGER"], employmentStatus: "ACTIVE" });
  assert.equal(granted, true);
});

ok("operationalRoleAccess: admin/dispatcher never satisfy it, regardless of operationalRoles/employmentStatus", () => {
  for (const role of [ROLES.ADMIN, ROLES.DISPATCHER]) {
    assert.equal(
      isNavItemVisible(eligibleItem, role, [], { operationalRoles: ["PARTS_MANAGER"], employmentStatus: "ACTIVE" }),
      false
    );
  }
});

ok("operationalRoleAccess: fails closed when operationalContext is missing entirely", () => {
  assert.equal(isNavItemVisible(eligibleItem, ROLES.TECHNICIAN, []), false);
  assert.equal(isNavItemVisible(eligibleItem, ROLES.TECHNICIAN, [], undefined), false);
  assert.equal(isNavItemVisible(eligibleItem, ROLES.TECHNICIAN, [], null), false);
});

ok("operationalRoleAccess: fails closed on empty operationalRoles (unresolved or broken linkage)", () => {
  assert.equal(
    isNavItemVisible(eligibleItem, ROLES.TECHNICIAN, [], { operationalRoles: [], employmentStatus: "ACTIVE" }),
    false
  );
});

ok("operationalRoleAccess: fails closed on inactive employment despite an otherwise-eligible role", () => {
  for (const employmentStatus of ["INACTIVE", "TERMINATED", "ON_LEAVE", "RETIRED", "CONTRACTOR", null, undefined]) {
    assert.equal(
      isNavItemVisible(eligibleItem, ROLES.TECHNICIAN, [], { operationalRoles: ["PARTS_MANAGER"], employmentStatus }),
      false,
      `expected denial for employmentStatus=${employmentStatus}`
    );
  }
});

ok("operationalRoleAccess: fails closed on an ineligible (non-overlapping) operationalRoles array", () => {
  assert.equal(
    isNavItemVisible(eligibleItem, ROLES.TECHNICIAN, [], { operationalRoles: ["PARTS_ASSOCIATE"], employmentStatus: "ACTIVE" }),
    false
  );
});

ok("operationalRoleAccess: an invalid/unrecognized operationalRoles entry never matches, no crash", () => {
  assert.equal(
    isNavItemVisible(eligibleItem, ROLES.TECHNICIAN, [], { operationalRoles: ["NOT_A_REAL_ROLE"], employmentStatus: "ACTIVE" }),
    false
  );
});

ok("operationalRoleAccess: a domain whose only visible subnav item requires it follows the same rules via isDomainVisible", () => {
  const syntheticDomain = { key: "syntheticDomain", label: "Synthetic Domain", path: "synthetic-domain", subnav: [eligibleItem] };
  assert.equal(isDomainVisible(syntheticDomain, ROLES.TECHNICIAN, [], { operationalRoles: [], employmentStatus: "ACTIVE" }), false);
  assert.equal(
    isDomainVisible(syntheticDomain, ROLES.TECHNICIAN, [], { operationalRoles: ["WAREHOUSE_MANAGER"], employmentStatus: "ACTIVE" }),
    true
  );
});

console.log(`\n${passed} passed, 0 failed`);
