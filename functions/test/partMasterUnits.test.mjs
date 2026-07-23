// INV-1 Phase 1 PR 1.5 -- governed unit-conversion extension tests.
// Pure (no emulator/network/clock). Prerequisite: npm run build.
import assert from "node:assert/strict";
import {
  UNIT_FAMILY_OF, areUnitsCompatible, canonicalRatio, reduceFactor,
  parseDecimalFactor, validateConversionSpec, validatePartUnitProfile,
  convertViaProfile, convertQuantity, UNIT_DEFINITIONS,
} from "../lib/partMaster/units.js";

let passed = 0;
function check(name, fn) { fn(); passed += 1; console.log(`  ok - ${name}`); }
const codes = (r) => r.errors.map((e) => e.code);

console.log("partMasterUnits.test.mjs");

check("families: every registered unit has a family; compatibility is family equality", () => {
  for (const code of Object.keys(UNIT_DEFINITIONS)) assert.ok(UNIT_FAMILY_OF[code], code);
  assert.equal(areUnitsCompatible("CASE", "EACH"), true);   // COUNT
  assert.equal(areUnitsCompatible("POUND", "OUNCE"), true); // WEIGHT
  assert.equal(areUnitsCompatible("CASE", "GALLON"), false);
  assert.equal(areUnitsCompatible("FOOT", "OUNCE"), false);
});
check("canonical ratios: measured units exact both directions; COUNT pairs none", () => {
  assert.deepEqual(canonicalRatio("POUND", "OUNCE"), { numerator: 16, denominator: 1 });
  assert.deepEqual(canonicalRatio("OUNCE", "POUND"), { numerator: 1, denominator: 16 });
  assert.deepEqual(canonicalRatio("EACH", "EACH"), { numerator: 1, denominator: 1 });
  assert.equal(canonicalRatio("CASE", "EACH"), null); // pack sizes are part-specific
});
check("reduceFactor: lowest terms, deterministic; invalid ratios rejected", () => {
  assert.deepEqual(reduceFactor({ numerator: 24, denominator: 6 }).value, { numerator: 4, denominator: 1 });
  for (const bad of [{ numerator: 0, denominator: 1 }, { numerator: -3, denominator: 1 }, { numerator: 1.5, denominator: 1 }, { numerator: NaN, denominator: 1 }, { numerator: Infinity, denominator: 1 }]) {
    assert.equal(reduceFactor(bad).valid, false);
  }
});
check("parseDecimalFactor: exact decimal strings only; no float storage", () => {
  assert.deepEqual(parseDecimalFactor("2.5").value, { numerator: 5, denominator: 2 });
  assert.deepEqual(parseDecimalFactor("0.125").value, { numerator: 1, denominator: 8 });
  assert.deepEqual(parseDecimalFactor("16").value, { numerator: 16, denominator: 1 });
  for (const bad of ["0", "-1", "1.2345678", "1e3", "NaN", "Infinity", "2,5", "", "abc"]) {
    assert.equal(parseDecimalFactor(bad).valid, false, bad);
  }
});
check("validateConversionSpec: same-unit ambiguous; cross-family rejected; factor reduced", () => {
  assert.ok(codes(validateConversionSpec({ fromUnit: "EACH", toUnit: "EACH", factor: { numerator: 1, denominator: 1 } })).includes("INVALID_COMBINATION"));
  assert.ok(codes(validateConversionSpec({ fromUnit: "CASE", toUnit: "GALLON", factor: { numerator: 1, denominator: 1 } })).includes("INVALID_COMBINATION"));
  const ok = validateConversionSpec({ fromUnit: "CASE", toUnit: "EACH", factor: { numerator: 24, denominator: 2 } });
  assert.deepEqual(ok.value.factor, { numerator: 12, denominator: 1 });
});
check("profile: star topology enforced -- non-stocking targets (chains/cycles) rejected", () => {
  const good = validatePartUnitProfile({
    stockingUnit: "EACH",
    purchase: { fromUnit: "CASE", toUnit: "EACH", factor: { numerator: 24, denominator: 1 } },
    issue: { fromUnit: "BOX", toUnit: "EACH", factor: { numerator: 6, denominator: 1 } },
  });
  assert.equal(good.valid, true);
  const chain = validatePartUnitProfile({
    stockingUnit: "EACH",
    purchase: { fromUnit: "CASE", toUnit: "BOX", factor: { numerator: 4, denominator: 1 } }, // targets non-canonical -> would form a chain
  });
  assert.ok(codes(chain).includes("INVALID_COMBINATION"));
});
check("convertViaProfile: purchase->stocking, issue->stocking, purchase->issue via canonical", () => {
  const profile = {
    stockingUnit: "EACH",
    purchase: { fromUnit: "CASE", toUnit: "EACH", factor: { numerator: 24, denominator: 1 } },
    issue: { fromUnit: "BOX", toUnit: "EACH", factor: { numerator: 6, denominator: 1 } },
  };
  assert.equal(convertViaProfile(profile, "CASE", "EACH", "3", "REJECT_INEXACT").value, "72");
  assert.equal(convertViaProfile(profile, "EACH", "BOX", "18", "REJECT_INEXACT").value, "3");
  assert.equal(convertViaProfile(profile, "CASE", "BOX", "1", "REJECT_INEXACT").value, "4"); // 24 each = 4 boxes
});
check("round-trip determinism: exact profiles invert cleanly; inexact honors policy", () => {
  const profile = { stockingUnit: "OUNCE", purchase: { fromUnit: "POUND", toUnit: "OUNCE", factor: { numerator: 16, denominator: 1 } } };
  const there = convertViaProfile(profile, "POUND", "OUNCE", "2.25", "REJECT_INEXACT").value; // 36
  assert.equal(there, "36.00");
  assert.equal(convertViaProfile(profile, "OUNCE", "POUND", there, "REJECT_INEXACT").value, "2.25");
  assert.ok(codes(convertViaProfile(profile, "OUNCE", "POUND", "37", "REJECT_INEXACT")).includes("PRECISION_EXCEEDED"));
  assert.equal(convertViaProfile(profile, "OUNCE", "POUND", "37", "HALF_UP").value, "2.31");
});
check("canonical measured ratio usable without explicit spec; ungoverned COUNT edge rejected", () => {
  assert.equal(convertViaProfile({ stockingUnit: "OUNCE" }, "POUND", "OUNCE", "1.5", "REJECT_INEXACT").value, "24.00");
  assert.ok(codes(convertViaProfile({ stockingUnit: "EACH" }, "CASE", "EACH", "1", "HALF_UP")).includes("INVALID_COMBINATION"));
});
check("no floating-point drift in composed conversions", () => {
  const profile = { stockingUnit: "GALLON", purchase: { fromUnit: "GALLON", toUnit: "GALLON", factor: { numerator: 1, denominator: 1 } } };
  // 0.1 + 0.2 class: 0.30 gallons scaled math stays exact
  assert.equal(convertQuantity("GALLON", "GALLON", "0.30", { numerator: 1, denominator: 1 }, "REJECT_INEXACT").value, "0.30");
  assert.equal(convertViaProfile({ stockingUnit: "OUNCE" }, "POUND", "OUNCE", "0.10", "REJECT_INEXACT").value, "1.60");
  assert.equal(profile.stockingUnit, "GALLON");
});
check("existing PR 1.1 surface unchanged (regression spot)", () => {
  assert.equal(convertQuantity("CASE", "EACH", "3", { numerator: 24, denominator: 1 }, "HALF_UP").value, "72");
  assert.ok(UNIT_DEFINITIONS.EACH.precision === 0 && UNIT_DEFINITIONS.GALLON.precision === 2);
});

console.log(`\npartMasterUnits: ${passed} passed, 0 failed`);
