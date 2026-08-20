// Navigation convergence onto governed capabilities (Owner decision 2026-08-16, closing #1065).
//
// THE RULE UNDER TEST: governed capability authority is the FINAL access authority for governed
// surfaces. A principal holding a legitimate governed Role whose capability resolves ALLOW must reach
// the surface that capability is for -- and a principal without it must not.
//
// Run: node --test field-ops-app-vite/test/navCapabilityConvergence.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { NAV_DOMAINS, isNavItemVisible, isDomainVisible } from "../src/navigation/navConfig.js";
import { ROLE_NAV_ACCESS } from "../src/domain/constants.js";
import {
  TRANSFER_SURFACE_CAPABILITIES,
  CYCLE_COUNT_SURFACE_CAPABILITIES,
  CATALOG_SURFACE_CAPABILITIES,
  GOVERNED_SURFACE_CAPABILITY_IDS,
} from "../src/access/governedSurfaceCapabilities.js";
import { REPORT_CAPABILITY_REQUEST } from "../src/access/reportCapabilityAccess.js";

const inventory = NAV_DOMAINS.find((d) => d.key === "inventory");
const item = (key) => inventory.subnav.find((i) => i.key === key);

// A principal holding EXACTLY the given capabilities and no compatibility nav access at all --
// i.e. someone whose only authority is a governed business Role.
const governedOnly = (...caps) => ({ hasCapability: (c) => caps.includes(c) });
const NO_LEGACY = [];

// ---- 1. governed Role + ALLOW capability -> surface reachable -------------------------------
test("transfer authority alone makes Transfers reachable", () => {
  for (const cap of TRANSFER_SURFACE_CAPABILITIES) {
    assert.equal(isNavItemVisible(item("transfers"), "generalEmployee", NO_LEGACY, governedOnly(cap)), true, cap);
  }
});

test("cycle-count authority alone makes Cycle Counts reachable -- BOTH halves of the split", () => {
  const counter = governedOnly("inventory.cycleCount.create", "inventory.cycleCount.submit", "inventory.cycleCount.cancel");
  const reconciler = governedOnly("inventory.cycleCount.reconcile");
  assert.equal(isNavItemVisible(item("cycleCounts"), "generalEmployee", NO_LEGACY, counter), true);
  assert.equal(isNavItemVisible(item("cycleCounts"), "generalEmployee", NO_LEGACY, reconciler), true);
});

test("catalog authority alone makes the catalog surface reachable", () => {
  for (const cap of CATALOG_SURFACE_CAPABILITIES) {
    assert.equal(isNavItemVisible(item("parts"), "generalEmployee", NO_LEGACY, governedOnly(cap)), true, cap);
  }
});

test("a governed-only principal sees the Inventory domain at all (it was previously empty)", () => {
  const op = governedOnly("inventory.transfer.create");
  assert.equal(isDomainVisible(inventory, "generalEmployee", NO_LEGACY, op), true);
});

// ---- 2. no qualifying capability -> route denied --------------------------------------------
test("a principal with NO qualifying capability and no compatibility access is denied", () => {
  const none = governedOnly();
  for (const key of ["transfers", "cycleCounts", "parts"]) {
    assert.equal(isNavItemVisible(item(key), "generalEmployee", NO_LEGACY, none), false, key);
  }
});

// The anti-super-gate assertion: one inventory capability must NOT open every inventory surface.
test("capability sets do not bleed across surfaces -- no blanket inventory gate", () => {
  const transferOnly = governedOnly("inventory.transfer.create");
  assert.equal(isNavItemVisible(item("cycleCounts"), "generalEmployee", NO_LEGACY, transferOnly), false);
  assert.equal(isNavItemVisible(item("parts"), "generalEmployee", NO_LEGACY, transferOnly), false);

  const countOnly = governedOnly("inventory.cycleCount.submit");
  assert.equal(isNavItemVisible(item("transfers"), "generalEmployee", NO_LEGACY, countOnly), false);
  assert.equal(isNavItemVisible(item("parts"), "generalEmployee", NO_LEGACY, countOnly), false);
});

// ---- 3. route visibility is NOT action authorization -----------------------------------------
test("route visibility never implies action authority", () => {
  // The counter reaches Cycle Counts, but the capability it lacks is still absent from its own
  // decision function -- route admission does not manufacture authority for the action.
  const counter = governedOnly("inventory.cycleCount.create", "inventory.cycleCount.submit");
  assert.equal(isNavItemVisible(item("cycleCounts"), "generalEmployee", NO_LEGACY, counter), true);
  assert.equal(counter.hasCapability("inventory.cycleCount.reconcile"), false);
});

// ---- 4. Cycle Count SoD survives navigation convergence ---------------------------------------
test("SoD survives: counter cannot reconcile, reconciler cannot create/submit -- both still reach the page", () => {
  const counter = governedOnly("inventory.cycleCount.create", "inventory.cycleCount.submit", "inventory.cycleCount.cancel");
  const reconciler = governedOnly("inventory.cycleCount.reconcile");

  assert.equal(counter.hasCapability("inventory.cycleCount.reconcile"), false, "counter must not reconcile");
  assert.equal(reconciler.hasCapability("inventory.cycleCount.create"), false, "reconciler must not create");
  assert.equal(reconciler.hasCapability("inventory.cycleCount.submit"), false, "reconciler must not submit");

  // Convergence gave them the same door and left their authority different, which is the point.
  assert.equal(isNavItemVisible(item("cycleCounts"), "generalEmployee", NO_LEGACY, counter), true);
  assert.equal(isNavItemVisible(item("cycleCounts"), "generalEmployee", NO_LEGACY, reconciler), true);
});

// ---- 5. compatibility-role users do not regress ----------------------------------------------
test("admin and dispatcher keep every inventory surface with NO capability at all", () => {
  const noCaps = { hasCapability: () => false };
  for (const role of ["admin", "dispatcher"]) {
    const legacy = ROLE_NAV_ACCESS[role];
    for (const key of ["transfers", "cycleCounts", "parts"]) {
      assert.equal(isNavItemVisible(item(key), role, legacy, noCaps), true, `${role}/${key}`);
    }
  }
});

test("technician stays denied these surfaces -- it holds neither the capability nor the legacy key", () => {
  const noCaps = { hasCapability: () => false };
  const legacy = ROLE_NAV_ACCESS.technician;
  for (const key of ["transfers", "cycleCounts", "parts"]) {
    assert.equal(isNavItemVisible(item(key), "technician", legacy, noCaps), false, key);
  }
});

test("capability-only items (Report Builder / Saved Reports) still fail closed for admin", () => {
  // These declare NO compatibility path. Convergence must not have made them fall back to the
  // default admin/dispatcher role list -- that would silently widen report access.
  const reporting = NAV_DOMAINS.find((d) => d.key === "reporting");
  const noCaps = { hasCapability: () => false };
  for (const key of ["builder", "savedReports"]) {
    const it = reporting.subnav.find((i) => i.key === key);
    assert.equal(isNavItemVisible(it, "admin", ROLE_NAV_ACCESS.admin, noCaps), false, key);
  }
});

// ---- 6. UNKNOWN / loading access must not become permissive -----------------------------------
test("loading, errored, absent and malformed access states all deny", () => {
  const governedSurfaces = ["transfers", "cycleCounts", "parts"];
  const hostile = [
    undefined,                          // no operational context at all
    {},                                 // context without a previewer
    { hasCapability: null },            // malformed previewer
    { hasCapability: undefined },
    { hasCapability: () => undefined }, // feed loading -> not a positive decision
    { hasCapability: () => null },
    { hasCapability: () => "true" },    // truthy but not the required strict true
    { hasCapability: () => 1 },
  ];
  for (const ctx of hostile) {
    for (const key of governedSurfaces) {
      // No compatibility access either, so the ONLY thing that could admit is a capability decision.
      assert.equal(isNavItemVisible(item(key), "generalEmployee", NO_LEGACY, ctx), false, key);
    }
  }
});

// ---- feed wiring: a declared capability nobody asks about can never be positive ---------------
test("every governed surface capability is actually requested from the effective-access feed", () => {
  for (const id of GOVERNED_SURFACE_CAPABILITY_IDS) {
    assert.ok(REPORT_CAPABILITY_REQUEST.includes(id), `${id} is gated on but never requested`);
  }
});
