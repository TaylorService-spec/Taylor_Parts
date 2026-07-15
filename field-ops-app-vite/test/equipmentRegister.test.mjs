// Issue #232 unit E5 -- pure unit tests for the Equipment register's behaviour
// (Spec §7): the exact filter contract the screen relies on, the "All statuses"
// spelling, deterministic ordering, and the nav/route integration.
//
// Pure: no firebase, no emulator, no browser -- runs under plain node. The screen's
// rendering is proven separately by the browser gate (verify-equipment-register).
//
// Run: node test/equipmentRegister.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import { EQUIPMENT_STATUS } from "../src/domain/constants.js";
import { searchEquipment, equipmentDisplayName, equipmentSummary } from "../src/domain/equipment.js";
import { NAV_DOMAINS, isNavItemVisible } from "../src/navigation/navConfig.js";
import { ROLES, ROLE_NAV_ACCESS } from "../src/domain/constants.js";

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }
const allowed = (role) => ROLE_NAV_ACCESS[role];

// The register's own fixture: duplicate names at different Locations (legal, §8),
// manufacturer/model/serial variety, and all three statuses.
const FIXTURE = [
  { id: "b", accountId: "a1", locationId: "l1", name: "Rooftop Unit", manufacturer: "Trane", model: "XR14", serialNumber: "SN-200", assetTag: "T-2", status: "ACTIVE" },
  { id: "a", accountId: "a1", locationId: "l2", name: "Rooftop Unit", manufacturer: "Carrier", model: "48TC", serialNumber: "SN-100", assetTag: "T-1", status: "INACTIVE" },
  { id: "c", accountId: "a1", locationId: "l2", name: "Boiler 1", manufacturer: "Lochinvar", model: "L9", serialNumber: "SN-300", assetTag: "T-3", status: "RETIRED" },
];

// ---- the "All statuses" contract (the trap this screen must not fall into) ----
ok("'All statuses' passes null and returns every record -- it never passes \"\"", () => {
  // The register builds its status from a table whose "All" entry is `value: null`.
  // If it ever used the conventional <option value=""> sentinel, searchEquipment would
  // treat "" as an explicitly supplied UNKNOWN status and return ZERO rows -- the
  // screen would look empty for the default selection.
  assert.equal(searchEquipment(FIXTURE, { term: "", locationId: null, status: null }).length, 3);
  assert.equal(searchEquipment(FIXTURE, { term: "", locationId: null, status: "" }).length, 0,
    "precondition: \"\" really does return nothing -- which is why All must be null");
});

ok("each concrete status filter narrows to exactly its own records", () => {
  assert.deepEqual(searchEquipment(FIXTURE, { status: EQUIPMENT_STATUS.ACTIVE }).map((e) => e.id), ["b"]);
  assert.deepEqual(searchEquipment(FIXTURE, { status: EQUIPMENT_STATUS.INACTIVE }).map((e) => e.id), ["a"]);
  assert.deepEqual(searchEquipment(FIXTURE, { status: EQUIPMENT_STATUS.RETIRED }).map((e) => e.id), ["c"]);
});

// ---- search over the §7 fields --------------------------------------------
ok("search covers name / assetTag / serial / manufacturer / model (§7)", () => {
  assert.deepEqual(searchEquipment(FIXTURE, { term: "rooftop" }).map((e) => e.id), ["a", "b"]);
  assert.deepEqual(searchEquipment(FIXTURE, { term: "T-3" }).map((e) => e.id), ["c"]);
  assert.deepEqual(searchEquipment(FIXTURE, { term: "sn-100" }).map((e) => e.id), ["a"]);
  assert.deepEqual(searchEquipment(FIXTURE, { term: "carrier" }).map((e) => e.id), ["a"]);
  assert.deepEqual(searchEquipment(FIXTURE, { term: "xr14" }).map((e) => e.id), ["b"]);
});

ok("an empty or blank search term is 'no search applied', not 'match nothing'", () => {
  assert.equal(searchEquipment(FIXTURE, { term: "" }).length, 3);
  assert.equal(searchEquipment(FIXTURE, { term: "   " }).length, 3);
});

// ---- Location filter, and the combination the screen actually issues -------
ok("the Location filter bounds to one Location, and composes with term + status", () => {
  assert.deepEqual(searchEquipment(FIXTURE, { locationId: "l2" }).map((e) => e.id), ["c", "a"]);
  // The exact shape EquipmentRegister passes: every key explicit, All == null.
  assert.deepEqual(
    searchEquipment(FIXTURE, { term: "rooftop", locationId: "l2", status: null }).map((e) => e.id),
    ["a"]
  );
  assert.deepEqual(
    searchEquipment(FIXTURE, { term: "rooftop", locationId: "l2", status: EQUIPMENT_STATUS.ACTIVE }).map((e) => e.id),
    [], "a filtered-empty result -- the screen must show the FILTERED empty state, not the database one"
  );
});

// ---- deterministic ordering (§7) ------------------------------------------
ok("ordering is name ascending, tie-broken by id -- a total, stable order (§7)", () => {
  const ids = searchEquipment(FIXTURE, {}).map((e) => e.id);
  assert.deepEqual(ids, ["c", "a", "b"], "Boiler 1 < Rooftop Unit; the two Rooftop Units tie-break a < b");
  // Same input in a different order must produce the same output -- the register's
  // rows must not depend on Firestore's delivery order.
  const shuffled = [FIXTURE[2], FIXTURE[0], FIXTURE[1]];
  assert.deepEqual(searchEquipment(shuffled, {}).map((e) => e.id), ids);
});

// ---- no raw ids as the primary reference (§8) -----------------------------
ok("rows reference equipment by display name + summary, never a raw id (§8)", () => {
  const [dupA, dupB] = FIXTURE.filter((e) => e.name === "Rooftop Unit");
  assert.equal(equipmentDisplayName(dupA), "Rooftop Unit");
  assert.equal(equipmentDisplayName(dupB), "Rooftop Unit");
  // Duplicate names are legal, so the summary is what keeps two identically named
  // rows tellable apart -- without exposing an id.
  assert.notEqual(equipmentSummary(dupA), equipmentSummary(dupB));
  for (const e of FIXTURE) {
    assert.doesNotMatch(equipmentSummary(e), new RegExp(`\\b${e.id}\\b`), "a summary must not contain the document id");
  }
});

// ---- nav + route integration ----------------------------------------------
ok("the Equipment area is routed at /equipment with an index screen", () => {
  const d = NAV_DOMAINS.find((x) => x.key === "equipment");
  assert.ok(d, "Equipment is a top-level area");
  assert.equal(d.path, "equipment");
  assert.equal(d.label, "Equipment");
  assert.equal(d.future, undefined, "built, not a placeholder");
  assert.deepEqual(d.subnav.map((i) => i.path), [""]);
});

ok("Equipment nav is admin/dispatcher only -- technician fails closed, mirroring E3's Rules", () => {
  const item = NAV_DOMAINS.find((x) => x.key === "equipment").subnav[0];
  assert.equal(isNavItemVisible(item, ROLES.ADMIN, allowed(ROLES.ADMIN)), true);
  assert.equal(isNavItemVisible(item, ROLES.DISPATCHER, allowed(ROLES.DISPATCHER)), true);
  // E3 (#289) denies a technician every Equipment operation; nav must not advertise a
  // screen whose every read would be denied. Nav visibility is not the security
  // boundary -- Rules are -- but the two must not disagree.
  assert.equal(isNavItemVisible(item, ROLES.TECHNICIAN, allowed(ROLES.TECHNICIAN)), false);
});

ok("adding Equipment did not disturb the CRM/Sales area (union)", () => {
  const c = NAV_DOMAINS.find((x) => x.key === "customers");
  assert.equal(c.label, "CRM/Sales");
  assert.equal(c.path, "customers");
  assert.deepEqual(c.subnav.map((i) => i.key), ["customers"]);
  // The retired customers/equipment SUBNAV entry stays retired -- the new area is a
  // separate top-level domain, not a resurrection of the old placeholder.
  assert.equal(c.subnav.some((i) => (i.path ?? "") === "equipment"), false);
});

console.log(`\n${passed} passed, 0 failed`);
