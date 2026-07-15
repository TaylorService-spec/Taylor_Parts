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
import { STATUS_FILTERS, statusFilterValue } from "../src/modules/equipment/equipmentStatusFilters.js";

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
// These assert the REGISTER'S OWN table, imported from the module the component uses.
// An earlier version asserted only searchEquipment's behaviour and merely *described*
// the register's -- independent review mutation-proved it worthless: flipping
// `value: null` to `value: ""`, the exact bug it claimed to guard, left all 10
// assertions green.
ok("the register's 'All statuses' entry carries null -- literally, not \"\" or undefined", () => {
  const all = STATUS_FILTERS.find((s) => s.key === "all");
  assert.ok(all, "the table has an All entry");
  assert.equal(all.value, null);
  assert.notEqual(all.value, "", "\"\" is an explicitly supplied UNKNOWN status -- it matches nothing");
  assert.equal(statusFilterValue("all"), null, "and the accessor the component calls returns it");
});

ok("every register status entry is either null or a real EQUIPMENT_STATUS", () => {
  for (const s of STATUS_FILTERS) {
    const valid = s.value === null || Object.values(EQUIPMENT_STATUS).includes(s.value);
    assert.ok(valid, `filter '${s.key}' carries ${JSON.stringify(s.value)}, which is neither null nor a real status`);
  }
  assert.deepEqual(STATUS_FILTERS.map((s) => s.key), ["all", "active", "inactive", "retired"]);
});

ok("feeding each register filter to searchEquipment gives the intended set -- All means ALL", () => {
  // The end-to-end contract, through the component's real values.
  //
  // Assert IDENTITIES, not counts. The fixture holds exactly one record per status, so
  // a `.length === 1` check cannot tell ACTIVE from INACTIVE -- review proved it by
  // swapping the `active` entry to EQUIPMENT_STATUS.INACTIVE (clicking "Active" would
  // list INACTIVE equipment) and watching the whole suite stay green. Counts are the
  // weakest thing a filter test can assert.
  assert.deepEqual(searchEquipment(FIXTURE, { status: statusFilterValue("all") }).map((e) => e.id), ["c", "a", "b"],
    "All must return every record -- this is what breaks if the table regresses to \"\"");
  assert.deepEqual(searchEquipment(FIXTURE, { status: statusFilterValue("active") }).map((e) => e.id), ["b"]);
  assert.deepEqual(searchEquipment(FIXTURE, { status: statusFilterValue("inactive") }).map((e) => e.id), ["a"]);
  assert.deepEqual(searchEquipment(FIXTURE, { status: statusFilterValue("retired") }).map((e) => e.id), ["c"]);
  // ...and the precondition that makes the null spelling necessary in the first place.
  assert.equal(searchEquipment(FIXTURE, { status: "" }).length, 0,
    "\"\" really does return nothing -- which is exactly why All must be null");
});

ok("an unrecognized filter key falls back to 'no filter', never to a bogus status", () => {
  assert.equal(statusFilterValue("nope"), null);
  assert.equal(statusFilterValue(undefined), null);
  assert.equal(searchEquipment(FIXTURE, { status: statusFilterValue("nope") }).length, 3);
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
