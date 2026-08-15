import test from "node:test";
import assert from "node:assert/strict";

import { NAV_DOMAINS, isNavItemVisible } from "../src/navigation/navConfig.js";
import { ROLE_NAV_ACCESS } from "../src/domain/constants.js";

// Wave 6 Owner decision (2026-08-15): Cycle Counts and Back Orders are pure
// route stubs (no backend capability) hidden from normal navigation via
// `navHidden: true` -- navigation honesty, not capability removal. This
// proves the split: hidden from the rail's presentation filter (which also
// checks `navHidden`, mirroring AppRail.jsx's own predicate) while still
// route-eligible via isNavItemVisible alone (App.jsx's route generator does
// NOT check navHidden, so direct/deep links keep resolving exactly as
// before -- see App.jsx's Route generation loop).

const inventory = NAV_DOMAINS.find((d) => d.key === "inventory");
const cycleCounts = inventory.subnav.find((i) => i.key === "cycleCounts");
const backOrders = inventory.subnav.find((i) => i.key === "backOrders");

test("Cycle Counts and Back Orders are flagged navHidden", () => {
  assert.equal(cycleCounts.navHidden, true);
  assert.equal(backOrders.navHidden, true);
});

test("navHidden items remain route-eligible (isNavItemVisible alone, unaffected) for admin/dispatcher", () => {
  for (const role of ["admin", "dispatcher"]) {
    const allowed = ROLE_NAV_ACCESS[role];
    assert.equal(isNavItemVisible(cycleCounts, role, allowed), true, `cycleCounts route should stay reachable for ${role}`);
    assert.equal(isNavItemVisible(backOrders, role, allowed), true, `backOrders route should stay reachable for ${role}`);
  }
});

test("the rail's presentation filter (isNavItemVisible && !navHidden) excludes them", () => {
  const allowed = ROLE_NAV_ACCESS.admin;
  const railFilter = (item) => isNavItemVisible(item, "admin", allowed) && !item.navHidden;
  assert.equal(railFilter(cycleCounts), false);
  assert.equal(railFilter(backOrders), false);
  // A sibling item with no navHidden flag is unaffected.
  const receiving = inventory.subnav.find((i) => i.key === "receiving");
  assert.equal(railFilter(receiving), true);
});
