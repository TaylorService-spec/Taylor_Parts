// INV-EQ-P1b -- tests for the pure Available Equipment catalog-filter view-model.
// Proves availability gating (only genuinely-available serials become rows), field
// composition with fallbacks, distinct option building, combined AND filters + term
// search over governed fields, the absence of any customer filter, and fail-closed
// state derivation.
//
// Run: node test/availableEquipmentCatalogView.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import {
  AVAILABLE_FILTER_NOTE,
  AVAILABLE_FILTER_KEYS,
  AVAILABLE_STATE,
  composeAvailableRows,
  buildAvailableFilterOptions,
  applyAvailableFilters,
  anyAvailableFilterActive,
  deriveAvailableState,
} from "../src/domain/availableEquipmentCatalogView.js";

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }

const A = { serialNo: "S1", partId: "P1", internalPartNumber: "IPN-1", category: "Valve", manufacturer: "Acme", model: "M1", status: "NEW", locationLabel: "WH-A", currentEquipmentId: null, availableForAssignment: true };
const B = { serialNo: "S2", partId: "P2", type: "Pump", manufacturer: "Beta", model: "M2", condition: "REFURB", location: "Truck-7", currentEquipmentId: null, availableForAssignment: true };
const INSTALLED = { serialNo: "S3", partId: "P1", currentEquipmentId: "EQ-9", availableForAssignment: false };
const NOT_AVAIL = { serialNo: "S4", partId: "P1", currentEquipmentId: null, availableForAssignment: false };
const ALL = [A, B, INSTALLED, NOT_AVAIL, null, {}];

ok("filter note states there is NO customer filter; keys exclude any customer/account", () => {
  assert.match(AVAILABLE_FILTER_NOTE, /no customer filter/i);
  assert.ok(!AVAILABLE_FILTER_KEYS.some((k) => /account|customer/i.test(k)));
});

ok("composeAvailableRows gates on availability (P1a) and composes with fallbacks", () => {
  const rows = composeAvailableRows(ALL);
  assert.deepStrictEqual(rows.map((r) => r.serialNo), ["S1", "S2"]); // installed + not-available excluded
  const a = rows[0], b = rows[1];
  assert.strictEqual(a.internalIdentifier, "IPN-1");
  assert.strictEqual(b.internalIdentifier, "P2"); // falls back to partId
  assert.strictEqual(b.category, "Pump"); // from `type`
  assert.strictEqual(b.status, "REFURB"); // from `condition`
  assert.strictEqual(b.location, "Truck-7"); // from `location`
  assert.strictEqual(a.location, "WH-A"); // from `locationLabel`
});

ok("buildAvailableFilterOptions returns distinct sorted values", () => {
  const o = buildAvailableFilterOptions(ALL);
  assert.deepStrictEqual(o.categories, ["Pump", "Valve"]);
  assert.deepStrictEqual(o.manufacturers, ["Acme", "Beta"]);
  assert.deepStrictEqual(o.statuses, ["NEW", "REFURB"]);
  assert.deepStrictEqual(o.locations, ["Truck-7", "WH-A"]);
});

ok("applyAvailableFilters: equality filters + term search + combined AND; unknown key ignored", () => {
  const ids = (filters) => applyAvailableFilters(ALL, filters).map((r) => r.serialNo);
  assert.deepStrictEqual(ids({ category: "Valve" }), ["S1"]);
  assert.deepStrictEqual(ids({ manufacturer: "Beta" }), ["S2"]);
  assert.deepStrictEqual(ids({ status: "REFURB" }), ["S2"]);
  assert.deepStrictEqual(ids({ location: "Truck-7" }), ["S2"]);
  assert.deepStrictEqual(ids({ term: "m1" }), ["S1"]); // model
  assert.deepStrictEqual(ids({ term: "acme" }), ["S1"]); // manufacturer
  assert.deepStrictEqual(ids({ term: "ipn" }), ["S1"]); // internal identifier
  assert.deepStrictEqual(ids({ category: "Valve", term: "acme" }), ["S1"]); // combined
  assert.deepStrictEqual(ids({ category: "Valve", term: "beta" }), []); // combined no match
  assert.deepStrictEqual(ids({ accountId: "anything" }), ["S1", "S2"]); // NO customer filter -> ignored
  assert.deepStrictEqual(ids({}), ["S1", "S2"]);
});

ok("anyAvailableFilterActive detects active filters", () => {
  assert.strictEqual(anyAvailableFilterActive({}), false);
  assert.strictEqual(anyAvailableFilterActive({ term: "  " }), false);
  assert.strictEqual(anyAvailableFilterActive({ category: "Valve" }), true);
  assert.strictEqual(anyAvailableFilterActive({ term: "x" }), true);
});

ok("deriveAvailableState fail-closed order", () => {
  assert.strictEqual(deriveAvailableState({ sourceStatus: AVAILABLE_STATE.LOADING }), AVAILABLE_STATE.LOADING);
  assert.strictEqual(deriveAvailableState({ sourceStatus: AVAILABLE_STATE.DENIED }), AVAILABLE_STATE.DENIED);
  assert.strictEqual(deriveAvailableState({ sourceStatus: AVAILABLE_STATE.UNAVAILABLE }), AVAILABLE_STATE.UNAVAILABLE);
  assert.strictEqual(deriveAvailableState({ sourceStatus: "ready", totalAvailable: 0 }), AVAILABLE_STATE.EMPTY);
  assert.strictEqual(deriveAvailableState({ sourceStatus: "ready", totalAvailable: 2, filteredCount: 0 }), AVAILABLE_STATE.EMPTY);
  assert.strictEqual(deriveAvailableState({ sourceStatus: "ready", totalAvailable: 2, filteredCount: 2 }), AVAILABLE_STATE.READY);
});

console.log(`\n${passed} passed`);
