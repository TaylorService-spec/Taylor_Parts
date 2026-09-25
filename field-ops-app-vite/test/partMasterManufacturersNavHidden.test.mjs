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
// MANUFACTURERS' REASON STILL HOLDS: the `manufacturers` collection read is Rules-closed to every
// persona, so nobody can use the screen regardless of where it sits in the rail.
//
// Unchanged either way: routes, components, commands, Rules and audit. Both stay route-eligible.
// ---------------------------------------------------------------------------------------------

const inventory = NAV_DOMAINS.find((d) => d.key === "inventory");
const partMaster = inventory.subnav.find((i) => i.key === "partMaster");
const manufacturers = inventory.subnav.find((i) => i.key === "manufacturers");

test("Part Master is no longer navHidden -- it is the structured Part list", () => {
  assert.equal(partMaster.navHidden, undefined);
});

test("Manufacturers stays navHidden while its read is Rules-closed", () => {
  assert.equal(manufacturers.navHidden, true);
});

// WAVE 16 / LANE BQ SPLIT THESE TWO, and the split is the cutover's own criterion rather than
// anything about navHidden. `inventory/partMaster` is MAPPED to the governed surface
// `inventory.catalogAdmin`, so it was one of the twenty destinations whose ungoverned placeholder
// row Owner ruling F removed: under the legacy source it is now fail-closed for every role, and
// under the EOS source it opens on inventory.catalog.manage/.activate. `inventory/manufacturers` has
// NO governed surface (its read is Rules-closed for every persona; NAV_SURFACE_GAPS says so), so it
// kept its row and its legacy answer is untouched.
//
// NEITHER DECISION IS ABOUT navHidden, which is what the two tests above own and what is unchanged.
test("route eligibility now follows the cutover: Part Master is governed-source-only, Manufacturers is not", () => {
  for (const role of ["admin", "dispatcher"]) {
    const allowed = ROLE_NAV_ACCESS[role];
    assert.equal(isNavItemVisible(partMaster, role, allowed), false,
      `partMaster still answers to the legacy role ${role} -- its placeholder row came back`);
    assert.equal(isNavItemVisible(manufacturers, role, allowed), true, `manufacturers route should stay reachable for ${role}`);
  }
  assert.deepEqual(partMaster.surfaceAccess, ["inventory.catalogAdmin"]);
  assert.equal(partMaster.legacyPlaceholder, undefined);
  assert.equal(manufacturers.surfaceAccess, undefined, "Manufacturers earned a surface -- then its row must go too");
  assert.equal(manufacturers.legacyPlaceholder, true);
});

test("the rail's presentation filter (isNavItemVisible && !navHidden) hides Manufacturers for its own reason", () => {
  const allowed = ROLE_NAV_ACCESS.admin;
  const railFilter = (item) => isNavItemVisible(item, "admin", allowed) && !item.navHidden;
  // TWO DIFFERENT FALSES, and keeping them apart is the point of this file. Manufacturers is hidden
  // by navHidden; Part Master is not hidden at all -- it simply has no legacy authority any more.
  assert.equal(railFilter(manufacturers), false);
  assert.equal(partMaster.navHidden, undefined);
  assert.equal(railFilter(partMaster), false);
  // Parts itself -- the catalog operating surface, gated by legacyKey "inventory" -- is unaffected
  // by either decision and by the cutover.
  const parts = inventory.subnav.find((i) => i.key === "parts");
  assert.equal(railFilter(parts), true);
});
