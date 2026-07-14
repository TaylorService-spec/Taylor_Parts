// Work Order wizard -- Customer picker. Deterministic unit tests for the pure
// helpers in src/domain/customerSearch.js.
// Run: node test/customerSearch.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import {
  rankCustomerMatches,
  customerSecondaryLine,
  summarizeLocations,
  locationCityState,
} from "../src/domain/customerSearch.js";

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }

const accounts = [
  { id: "a-substr", name: "Best Test Services", status: "Active" },
  { id: "a-prefix", name: "Test Plumbing Co", status: "Active", billingAddress: { city: "Denver", state: "CO" } },
  { id: "b-prefix", name: "Test Plumbing Co", status: "Prospect", billingAddress: { city: "Austin", state: "TX" } }, // duplicate name
  { id: "a-exact", name: "Test", status: "Inactive" },
  { id: "a-cnum", name: "Riverside HVAC", status: "Active", customerNumber: "TEST-9001" },
  { id: "a-none", name: "Unrelated Co", status: "Active" },
];

// ===== rankCustomerMatches: match classes + ordering =====
ok("empty query -> no results", () => {
  assert.deepEqual(rankCustomerMatches(accounts, "").results, []);
  assert.deepEqual(rankCustomerMatches(accounts, "   ").results, []);
});
ok("'test' matches name (exact/prefix/substring) + customer number; not unrelated", () => {
  const { results, total } = rankCustomerMatches(accounts, "test", 8);
  const ids = results.map((r) => r.id);
  assert.ok(ids.includes("a-exact") && ids.includes("a-prefix") && ids.includes("b-prefix") && ids.includes("a-substr") && ids.includes("a-cnum"));
  assert.ok(!ids.includes("a-none"));
  assert.equal(total, 5);
});
ok("ranking: exact name first, then prefix, then substring, then customer-number", () => {
  const ids = rankCustomerMatches(accounts, "test", 8).results.map((r) => r.id);
  assert.equal(ids[0], "a-exact"); // exact "Test"
  // both "Test Plumbing Co" prefixes come next, ordered deterministically by id
  assert.deepEqual(ids.slice(1, 3), ["a-prefix", "b-prefix"]);
  assert.equal(ids[3], "a-substr"); // "Best Test Services" substring
  assert.equal(ids[4], "a-cnum"); // customerNumber "TEST-9001"
});
ok("identically named customers are both returned, ordered stably by id", () => {
  const ids = rankCustomerMatches(accounts, "test plumbing", 8).results.map((r) => r.id);
  assert.deepEqual(ids, ["a-prefix", "b-prefix"]);
});
ok("limit bounds results but total reflects all matches (drives '+N more')", () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ id: `x${i}`, name: `Test ${String(i).padStart(2, "0")}` }));
  const { results, total } = rankCustomerMatches(many, "test", 8);
  assert.equal(results.length, 8);
  assert.equal(total, 12);
});

// ===== customerSecondaryLine: billing -> customer number -> nothing; never id =====
ok("secondary: billing city/state preferred", () =>
  assert.equal(customerSecondaryLine({ id: "z", billingAddress: { city: "Denver", state: "CO" } }), "Denver, CO"));
ok("secondary: falls back to external customer number", () =>
  assert.equal(customerSecondaryLine({ id: "z", customerNumber: "TEST-9001" }), "Customer #: TEST-9001"));
ok("secondary: empty when neither present (never the raw id)", () => {
  const line = customerSecondaryLine({ id: "raw-doc-id-should-never-show" });
  assert.equal(line, "");
  assert.ok(!line.includes("raw-doc-id-should-never-show"));
});
ok("locationCityState: drops blanks", () => {
  assert.equal(locationCityState({ city: "Denver", state: "CO" }), "Denver, CO");
  assert.equal(locationCityState({ city: "Denver" }), "Denver");
  assert.equal(locationCityState({}), "");
  assert.equal(locationCityState(null), "");
});

// ===== summarizeLocations: bounded + "+N more" + "No locations" =====
ok("no locations -> total 0 (drives 'No locations')", () => {
  const s = summarizeLocations([], 2);
  assert.equal(s.total, 0);
  assert.deepEqual(s.shown, []);
  assert.equal(s.moreCount, 0);
});
ok("bounded to maxShown with a deterministic '+N more' count", () => {
  const locs = [
    { id: "l3", name: "North Yard", address: { city: "Boulder", state: "CO" } },
    { id: "l1", name: "Main Shop", address: { city: "Denver", state: "CO" } },
    { id: "l2", name: "South Depot", address: { city: "Pueblo", state: "CO" } },
  ];
  const s = summarizeLocations(locs, 2);
  assert.equal(s.total, 3);
  assert.equal(s.moreCount, 1);
  assert.deepEqual(s.shown.map((l) => l.name), ["Main Shop", "North Yard"]); // sorted by name
  assert.equal(s.shown[0].cityState, "Denver, CO");
});
ok("unnamed location + missing address render safely", () => {
  const s = summarizeLocations([{ id: "l", address: null }], 2);
  assert.equal(s.shown[0].name, "Unnamed location");
  assert.equal(s.shown[0].cityState, "");
});

console.log(`\n${passed} passed, 0 failed`);
