// X-ANALYTICS-WIRE-ENCODING -- the payload getInventoryAnalytics returns must survive the callable
// protocol's encoder.
//
// This is the coverage whose absence let a 500 reach the live sandbox. The existing
// inventoryAnalyticsCallables.test.mjs asserts what the numbers ARE; nothing asserted that the
// result could be TRANSMITTED. The analytics engine models "no usage history, so it never runs out"
// as `daysRemaining: Infinity`, which is correct in process and unrepresentable in JSON, so
// firebase-functions threw `Data cannot be encoded in JSON: Infinity` after the handler returned and
// the caller saw a bare 500 with no indication of the offending field.
//
// The encoder is imported by RELATIVE PATH because firebase-functions' package `exports` map does
// not expose the subpath. That is deliberate: this test asserts against the REAL encoder that
// actually rejected the payload in production, not a local re-implementation of what it might do.
// A hand-written "is it finite" check would pass happily against a re-implementation that was wrong.
//
// Note that JSON.stringify is NOT a substitute: it silently converts Infinity to null, so a local
// "it serialized fine" check is not evidence a payload is wire-safe.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const { encode } = require("../node_modules/firebase-functions/lib/common/providers/https.js");
const { projectHealthForWire, assertWireEncodable } = require("../lib/inventoryAnalyticsCallables.js");
const { generateInventoryHealthDashboard, generateReplenishmentRecommendation } = require("../lib/inventoryAnalyticsService.js");

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`PASS: ${name}`); }
  catch (err) { failed += 1; console.error(`FAIL: ${name}`); console.error(err); }
}

// A part with stock and no usage history at all -- the exact live condition (4 of 5 sandbox parts).
const NO_USAGE = { partId: "PRT-1005", avgDailyUsage: 0, totalUsed: 0, periodDays: 30 };
const SOME_USAGE = { partId: "PRT-1001", avgDailyUsage: 2, totalUsed: 60, periodDays: 30 };

check("the engine still returns Infinity for a zero-usage part (domain semantics unchanged)", () => {
  const rec = generateReplenishmentRecommendation("PRT-1005", 40, NO_USAGE);
  assert.equal(rec.daysRemaining, Infinity);
});

check("the RAW engine payload is rejected by the real encoder -- the defect, reproduced", () => {
  const raw = generateInventoryHealthDashboard(
    [],
    [{ partId: "PRT-1005", availableStock: 40 }],
  );
  assert.throws(() => encode({ health: raw }), /cannot be encoded in JSON/i);
});

check("the PROJECTED payload is accepted by the real encoder", () => {
  const raw = generateInventoryHealthDashboard(
    [],
    [{ partId: "PRT-1005", availableStock: 40 }, { partId: "PRT-1001", availableStock: 3 }],
  );
  const wire = projectHealthForWire(raw);
  assert.doesNotThrow(() => encode({ health: wire }));
});

check("Infinity becomes null -- the same value estimatedStockoutDate already uses for this case", () => {
  const raw = generateInventoryHealthDashboard([], [{ partId: "PRT-1005", availableStock: 40 }]);
  const [entry] = projectHealthForWire(raw);
  assert.equal(entry.recommendation.daysRemaining, null);
  // The rest of the entry is carried through untouched.
  assert.equal(entry.partId, "PRT-1005");
  assert.equal(entry.recommendation.availableStock, 40);
  assert.equal(entry.recommendation.recommendationStatus, "NEEDS_PLANNING");
});

check("a finite daysRemaining is left exactly as computed", () => {
  const rec = generateReplenishmentRecommendation("PRT-1001", 10, SOME_USAGE);
  assert.equal(rec.daysRemaining, 5);
  const [entry] = projectHealthForWire([{ partId: "PRT-1001", recommendation: rec }]);
  assert.equal(entry.recommendation.daysRemaining, 5);
});

check("an entry without a recommendation passes through unchanged", () => {
  const [entry] = projectHealthForWire([{ partId: "PRT-9999", usage: NO_USAGE }]);
  assert.equal(entry.partId, "PRT-9999");
  assert.equal(entry.recommendation, undefined);
});

// NaN and -Infinity are real computation bugs, not the modelled "never runs out" case, so they must
// NOT be quietly mapped to null -- they must stop the response with a locatable path.
check("assertWireEncodable names the exact path of a NaN", () => {
  assert.throws(
    () => assertWireEncodable({ health: [{ recommendation: { reorderPoint: NaN } }] }),
    /result\.health\[0\]\.recommendation\.reorderPoint: NaN/,
  );
});

check("assertWireEncodable rejects -Infinity too", () => {
  assert.throws(() => assertWireEncodable({ a: -Infinity }), /result\.a: -Infinity/);
});

check("assertWireEncodable accepts an all-finite payload, nulls and dates included", () => {
  assert.doesNotThrow(() =>
    assertWireEncodable({ health: [{ n: 0, s: "x", nul: null, d: new Date(0), arr: [1, 2] }] }),
  );
});

console.log(`\n# ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
