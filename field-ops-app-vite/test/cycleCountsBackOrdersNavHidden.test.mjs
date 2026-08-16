import test from "node:test";
import assert from "node:assert/strict";

import { NAV_DOMAINS, isNavItemVisible } from "../src/navigation/navConfig.js";
import { ROLE_NAV_ACCESS } from "../src/domain/constants.js";

// Wave 6 Owner decision (2026-08-15): Cycle Counts and Back Orders were pure route stubs (no backend
// capability) hidden from normal navigation via `navHidden: true` -- navigation honesty, not capability
// removal. This proves the split: hidden from the rail's presentation filter (which also checks
// `navHidden`, mirroring AppRail.jsx's own predicate) while still route-eligible via isNavItemVisible
// alone (App.jsx's route generator does NOT check navHidden, so direct/deep links keep resolving
// exactly as before -- see App.jsx's Route generation loop).
//
// UPDATED 2026-08-16 (Owner decision closing #1065). CYCLE COUNTS IS NO LONGER HIDDEN. The original
// flag carried its own release condition -- restore the entry "once a real capability exists and is
// ready for user testing" -- and that condition is now met: four governed cycle-count callables are
// deployed and ACTIVE, the capabilities are activated in the sandbox, and two governed Roles
// (inventoryCycleCountCounter / inventoryCycleCountReconciler) carry them. Continuing to hide a
// surface that now has a real backend would be the DISHONEST state, which is the opposite of what the
// flag was for. Back Orders keeps the flag: it still has no backend, so the original reasoning holds
// unchanged for it -- which is exactly why these two are asserted separately below rather than together.

const inventory = NAV_DOMAINS.find((d) => d.key === "inventory");
const cycleCounts = inventory.subnav.find((i) => i.key === "cycleCounts");
const backOrders = inventory.subnav.find((i) => i.key === "backOrders");

test("Back Orders is still navHidden -- it remains a stub with no backend", () => {
  assert.equal(backOrders.navHidden, true);
});

test("Cycle Counts is NO LONGER navHidden -- its backend now exists", () => {
  assert.notEqual(cycleCounts.navHidden, true);
});

test("navHidden items remain route-eligible (isNavItemVisible alone, unaffected) for admin/dispatcher", () => {
  for (const role of ["admin", "dispatcher"]) {
    const allowed = ROLE_NAV_ACCESS[role];
    assert.equal(isNavItemVisible(cycleCounts, role, allowed), true, `cycleCounts route should stay reachable for ${role}`);
    assert.equal(isNavItemVisible(backOrders, role, allowed), true, `backOrders route should stay reachable for ${role}`);
  }
});

test("the rail's presentation filter (isNavItemVisible && !navHidden) excludes Back Orders, and now SHOWS Cycle Counts", () => {
  const allowed = ROLE_NAV_ACCESS.admin;
  const railFilter = (item) => isNavItemVisible(item, "admin", allowed) && !item.navHidden;
  assert.equal(railFilter(backOrders), false);
  // Cycle Counts is now discoverable rather than reachable-only-by-URL: a Role exists that carries its
  // authority, so a holder must be able to FIND the surface, not just deep-link to it.
  assert.equal(railFilter(cycleCounts), true);
  // A sibling item with no navHidden flag is unaffected.
  const receiving = inventory.subnav.find((i) => i.key === "receiving");
  assert.equal(railFilter(receiving), true);
});
