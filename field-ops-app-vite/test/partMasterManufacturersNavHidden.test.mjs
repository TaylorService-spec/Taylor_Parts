import test from "node:test";
import assert from "node:assert/strict";

import { NAV_DOMAINS, isNavItemVisible } from "../src/navigation/navConfig.js";
import { ROLE_NAV_ACCESS } from "../src/domain/constants.js";

// Wave 6's nav-convergence gate (2026-08-15) demoted BOTH Part Master and Manufacturers out of
// primary navigation with `navHidden: true`, for two different reasons.
//
// ---------------------------------------------------------------------------------------------
// PART MASTER'S REASON HAS BEEN ANSWERED, so it is promoted back. Superseded deliberately, not
// quietly: Wave 6 hid it because its individual-part CRUD had moved into Parts and its one remaining
// unique workflow -- browse every Part by master-data status / tracking / stocking class -- had no way
// to work at catalogue scale, so promoting a screen that fetched the whole collection and sorted it in
// the browser would have been promoting a liability. Its own comment said to re-promote if that
// judgment changed.
//
// It has. The Parts structured-list migration gave that screen metadata-driven Add Filter / Sort /
// active filters, an ordered-limited-cursored Firestore query, and URL-backed list state. The
// workflow Wave 6 was protecting is now the workflow the screen does well, and continuing to hide the
// only door to it would be keeping the workflow while hiding the way in.
//
// MANUFACTURERS STAYS OFF THE RAIL, for a different reason now: since Firebase exit F5 its list reads EOS
// (eos_ops.manufacturers), and R-1 Option A gave it the `inventory.catalog` surface, but it is reached from
// Catalog rather than added to the rail.
//
// Unchanged either way: routes, components, commands, Rules and audit. Both stay route-eligible.
// ---------------------------------------------------------------------------------------------

const inventory = NAV_DOMAINS.find((d) => d.key === "inventory");
const partMaster = inventory.subnav.find((i) => i.key === "partMaster");
const manufacturers = inventory.subnav.find((i) => i.key === "manufacturers");

test("Part Master is no longer navHidden -- it is the structured Part list", () => {
  assert.equal(partMaster.navHidden, undefined);
});

test("Manufacturers stays navHidden (reached from Catalog, not the rail)", () => {
  assert.equal(manufacturers.navHidden, true);
});

// WAVE 16 / LANE BQ SPLIT THESE TWO AND LANE BR PUT THEM BACK TOGETHER, under the legacy source.
// The criterion Lane BQ used is real and is recorded below -- `inventory/partMaster` is MAPPED to
// the governed surface `inventory.catalogAdmin` and `inventory/manufacturers` had none at the time (R-1
// Option A has since mapped it to `inventory.catalog`) -- but the conclusion it drew, that the
// mapped one loses its legacy row everywhere, closed the door in the four environments that have no
// EOS source to answer it. Both keep their legacy answer; only Part Master ALSO has a governed one.
//
// NEITHER DECISION IS ABOUT navHidden, which is what the two tests above own and what is unchanged.
test("both remain route-eligible (isNavItemVisible alone, unaffected) for admin/dispatcher", () => {
  for (const role of ["admin", "dispatcher"]) {
    const allowed = ROLE_NAV_ACCESS[role];
    assert.equal(isNavItemVisible(partMaster, role, allowed), true, `partMaster route should stay reachable for ${role}`);
    assert.equal(isNavItemVisible(manufacturers, role, allowed), true, `manufacturers route should stay reachable for ${role}`);
  }
  // Both now have somewhere to go when their environment flips the flag: Part Master to Catalog Admin, and
  // Manufacturers (R-1 Option A) to the `inventory.catalog` surface its read's capability earns.
  assert.deepEqual(partMaster.surfaceAccess, ["inventory.catalogAdmin"]);
  assert.equal(partMaster.legacyPlaceholder, true);
  assert.deepEqual(manufacturers.surfaceAccess, ["inventory.catalog"]);
  assert.equal(manufacturers.legacyPlaceholder, true);
});

test("the rail's presentation filter (isNavItemVisible && !navHidden) shows Part Master, hides Manufacturers", () => {
  const allowed = ROLE_NAV_ACCESS.admin;
  const railFilter = (item) => isNavItemVisible(item, "admin", allowed) && !item.navHidden;
  assert.equal(railFilter(partMaster), true);
  assert.equal(railFilter(manufacturers), false);
  // Parts itself -- the catalog operating surface -- is unaffected by either decision.
  const parts = inventory.subnav.find((i) => i.key === "parts");
  assert.equal(railFilter(parts), true);
});
