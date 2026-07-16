// Issue #232 unit E7 -- pure unit tests for the Equipment detail page's derived data
// (Spec §8/§10). Pure: no firebase, no emulator, no browser -- plain node. The page's
// rendering is proven separately by the browser gate (verify-equipment-detail).
//
// Run: node test/equipmentDetail.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import {
  equipmentServiceHistory,
  groupServiceHistoryByYear,
  equipmentDisplayName,
  equipmentSummary,
  isRetired,
} from "../src/domain/equipment.js";

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }

// Mid-year dates: getFullYear() is LOCAL, so a Jan-1 UTC instant lands in the previous
// year at any negative offset -- the same trap E4's fixtures avoid. Not the behaviour
// under test; don't let it decide the result.
const at = (y, m = 5, d = 15) => Date.UTC(y, m, d, 12);

const WOS = [
  { id: "w-new", equipmentId: "e1", woNumber: "WO-003", status: "COMPLETED", type: "PM", createdAt: at(2026) },
  { id: "w-mid", equipmentId: "e1", woNumber: "WO-002", status: "COMPLETED", type: "SERVICE_CALL", createdAt: at(2025) },
  { id: "w-old", equipmentId: "e1", woNumber: "WO-001", status: "CANCELLED", type: "SERVICE_CALL", createdAt: at(2024) },
  { id: "w-other", equipmentId: "OTHER", woNumber: "WO-999", status: "COMPLETED", type: "PM", createdAt: at(2026) },
];

// ---- Service History is DERIVED and BOUNDED to this equipment (§10) ----------
ok("history contains only THIS equipment's work orders -- never another asset's", () => {
  const h = equipmentServiceHistory(WOS, "e1");
  assert.deepEqual(h.map((e) => e.workOrderId), ["w-new", "w-mid", "w-old"]);
  assert.equal(h.some((e) => e.workOrderId === "w-other"), false,
    "a WO for another asset must never appear in this asset's service record");
});

ok("history is ordered newest first", () => {
  const h = equipmentServiceHistory(WOS, "e1");
  assert.ok(h[0].at > h[1].at && h[1].at > h[2].at);
  // Delivery order must not leak into the rendering.
  const shuffled = [WOS[2], WOS[0], WOS[3], WOS[1]];
  assert.deepEqual(
    equipmentServiceHistory(shuffled, "e1").map((e) => e.workOrderId),
    ["w-new", "w-mid", "w-old"]
  );
});

ok("history entries carry the WO NUMBER as the human reference (§8)", () => {
  const [first] = equipmentServiceHistory(WOS, "e1");
  assert.equal(first.woNumber, "WO-003");
  // There is no `id` on an entry -- the detail page keys and links on workOrderId.
  assert.equal(Object.hasOwn(first, "id"), false);
  assert.equal(first.workOrderId, "w-new");
});

ok("an equipment with no linked work orders yields an EMPTY history, not an error", () => {
  assert.deepEqual(equipmentServiceHistory(WOS, "e-none"), []);
  assert.deepEqual(groupServiceHistoryByYear(equipmentServiceHistory(WOS, "e-none")), []);
});

// ---- year grouping (what the page renders) -----------------------------------
ok("history groups by year, newest year first", () => {
  const groups = groupServiceHistoryByYear(equipmentServiceHistory(WOS, "e1"));
  assert.deepEqual(groups.map((g) => g.year), [2026, 2025, 2024]);
  assert.deepEqual(groups[0].entries.map((e) => e.woNumber), ["WO-003"]);
});

ok("a work order with no usable date groups under Unknown, sorted last", () => {
  const withUndated = [...WOS, { id: "w-undated", equipmentId: "e1", woNumber: "WO-004", createdAt: null }];
  const groups = groupServiceHistoryByYear(equipmentServiceHistory(withUndated, "e1"));
  assert.deepEqual(groups.map((g) => g.year), [2026, 2025, 2024, "Unknown"]);
  assert.deepEqual(groups[3].entries.map((e) => e.woNumber), ["WO-004"],
    "an undated work order is still part of the record -- it is not dropped");
});

ok("a malformed work-order collection yields no history rather than fabricating one", () => {
  for (const bad of ["notarray", 42, null, {}]) {
    assert.deepEqual(equipmentServiceHistory(bad, "e1"), []);
  }
});

// ---- identity + status (§8) ---------------------------------------------------
ok("the detail header uses the display name and never the raw id (§8)", () => {
  const e = { id: "equip-abc123", name: "Rooftop Unit", manufacturer: "Carrier", model: "48TC", serialNumber: "SN-1" };
  assert.equal(equipmentDisplayName(e), "Rooftop Unit");
  assert.doesNotMatch(equipmentSummary(e), /equip-abc123/);
  // An unnamed record still renders something human rather than an id.
  assert.equal(equipmentDisplayName({ id: "equip-x" }), "Unnamed equipment");
});

ok("isRetired decides which lifecycle action the page offers", () => {
  assert.equal(isRetired({ status: "RETIRED" }), true, "a retired asset offers Reactivate");
  assert.equal(isRetired({ status: "ACTIVE" }), false, "an active asset offers Retire");
  assert.equal(isRetired({ status: "INACTIVE" }), false);
  // Fails closed: an unknown/absent status is not treated as retired.
  assert.equal(isRetired({}), false);
  assert.equal(isRetired({ status: "BOGUS" }), false);
});

console.log(`\n${passed} passed, 0 failed`);
