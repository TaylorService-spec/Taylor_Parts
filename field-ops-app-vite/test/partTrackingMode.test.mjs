// Enterprise Inventory -- EI-P1a. Deterministic pure unit tests for the Part
// tracking-mode contract (src/domain/partTrackingMode.js). Proves the fail-closed
// posture: missing/unknown values are rejected and NEVER implicitly become SERIAL.
//
// Run: node test/partTrackingMode.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import {
  PART_TRACKING_MODES,
  isTrackingMode,
  normalizeTrackingMode,
  validateTrackingMode,
  isSerialTracked,
  isLotTracked,
  isUntracked,
} from "../src/domain/partTrackingMode.js";

let passed = 0;
function ok(name, fn) {
  fn();
  passed += 1;
  console.log("PASS -- " + name);
}

// Values that are NOT canonical tracking modes -- every one must fail closed.
const UNKNOWN = [
  undefined, null, "", " ", "serial", "SERIAL ", " SERIAL", "Serial",
  "SERIALIZED", "lot", "none", "UNKNOWN", 0, 1, {}, [], true, false,
  "NONE,SERIAL",
];

ok("exactly three canonical modes, frozen", () => {
  assert.deepEqual(PART_TRACKING_MODES, ["NONE", "SERIAL", "LOT"]);
  assert.equal(Object.isFrozen(PART_TRACKING_MODES), true);
});

ok("isTrackingMode: accepts exact canonical tokens only", () => {
  for (const m of PART_TRACKING_MODES) assert.equal(isTrackingMode(m), true);
});

ok("isTrackingMode: rejects every unknown/missing/mis-cased value", () => {
  for (const v of UNKNOWN) assert.equal(isTrackingMode(v), false, `expected reject: ${String(v)}`);
});

ok("normalizeTrackingMode: returns exact token, no coercion", () => {
  assert.equal(normalizeTrackingMode("SERIAL"), "SERIAL");
  assert.equal(normalizeTrackingMode("LOT"), "LOT");
  assert.equal(normalizeTrackingMode("NONE"), "NONE");
  // No trim/upper-case coercion -- a near-miss stays null, never normalized into validity.
  assert.equal(normalizeTrackingMode(" SERIAL "), null);
  assert.equal(normalizeTrackingMode("serial"), null);
});

ok("normalizeTrackingMode: missing/unknown -> null (never SERIAL)", () => {
  for (const v of UNKNOWN) assert.equal(normalizeTrackingMode(v), null, `expected null: ${String(v)}`);
});

ok("validateTrackingMode: structured result, distinguishes missing vs unknown", () => {
  assert.deepEqual(validateTrackingMode("SERIAL"), { valid: true, value: "SERIAL", reason: null });
  assert.deepEqual(validateTrackingMode(undefined), { valid: false, value: null, reason: "missing" });
  assert.deepEqual(validateTrackingMode(null), { valid: false, value: null, reason: "missing" });
  assert.deepEqual(validateTrackingMode("serial"), { valid: false, value: null, reason: "unknown" });
  assert.deepEqual(validateTrackingMode(42), { valid: false, value: null, reason: "unknown" });
});

ok("isSerialTracked: true ONLY for exact SERIAL", () => {
  assert.equal(isSerialTracked("SERIAL"), true);
  assert.equal(isSerialTracked("LOT"), false);
  assert.equal(isSerialTracked("NONE"), false);
});

ok("isSerialTracked: missing/unknown never assumed serial", () => {
  for (const v of UNKNOWN) assert.equal(isSerialTracked(v), false, `must not assume SERIAL: ${String(v)}`);
});

ok("isLotTracked / isUntracked: exact-only, unknown is neither", () => {
  assert.equal(isLotTracked("LOT"), true);
  assert.equal(isLotTracked("SERIAL"), false);
  assert.equal(isUntracked("NONE"), true);
  assert.equal(isUntracked("SERIAL"), false);
  for (const v of UNKNOWN) {
    assert.equal(isLotTracked(v), false, `lot: ${String(v)}`);
    assert.equal(isUntracked(v), false, `untracked (unknown is NOT none): ${String(v)}`);
  }
});

console.log(`\n${passed} passed`);
