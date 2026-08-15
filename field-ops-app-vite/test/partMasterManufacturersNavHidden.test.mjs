import test from "node:test";
import assert from "node:assert/strict";

import { NAV_DOMAINS, isNavItemVisible } from "../src/navigation/navConfig.js";
import { ROLE_NAV_ACCESS } from "../src/domain/constants.js";

// Wave 6 nav-convergence gate (2026-08-15): Part Master and Manufacturers are
// demoted out of normal primary navigation via `navHidden: true` -- same
// mechanism as Cycle Counts/Back Orders (test/cycleCountsBackOrdersNavHidden.
// test.mjs), but a different reason: Part Master's individual-part CRUD is now
// reachable from inside Parts (New Part / Edit Part Details / Change Status,
// via the SAME governed commands -- see partsMasterDataEntryPoints.test.jsx),
// and Manufacturers is Rules-closed to every persona today, so no one can use
// it regardless of nav placement. Neither route/component/command/Rules/audit
// is touched -- both stay reachable by direct URL.

const inventory = NAV_DOMAINS.find((d) => d.key === "inventory");
const partMaster = inventory.subnav.find((i) => i.key === "partMaster");
const manufacturers = inventory.subnav.find((i) => i.key === "manufacturers");

test("Part Master and Manufacturers are flagged navHidden", () => {
  assert.equal(partMaster.navHidden, true);
  assert.equal(manufacturers.navHidden, true);
});

test("navHidden items remain route-eligible (isNavItemVisible alone, unaffected) for admin/dispatcher", () => {
  for (const role of ["admin", "dispatcher"]) {
    const allowed = ROLE_NAV_ACCESS[role];
    assert.equal(isNavItemVisible(partMaster, role, allowed), true, `partMaster route should stay reachable for ${role}`);
    assert.equal(isNavItemVisible(manufacturers, role, allowed), true, `manufacturers route should stay reachable for ${role}`);
  }
});

test("the rail's presentation filter (isNavItemVisible && !navHidden) excludes them", () => {
  const allowed = ROLE_NAV_ACCESS.admin;
  const railFilter = (item) => isNavItemVisible(item, "admin", allowed) && !item.navHidden;
  assert.equal(railFilter(partMaster), false);
  assert.equal(railFilter(manufacturers), false);
  // Parts itself (the replacement path) is unaffected.
  const parts = inventory.subnav.find((i) => i.key === "parts");
  assert.equal(railFilter(parts), true);
});
