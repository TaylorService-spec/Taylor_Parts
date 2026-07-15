// Enterprise Access & Administration Platform (Issue #226) -- Row 4
// (Task 9) acceptance tests: Spec sec21 P1 (100% match required to
// advance a domain), P2 (Issue #100 operational-role decisions match
// exactly), plus the harness's own non-authoritative/no-raw-internals
// contract (Spec sec18).
//
// Dependency-free: plain Node assert against the compiled harness +
// fixtures, no test runner, matching this repo's existing pure-logic
// test convention.
//
// Prerequisite: `npm run build` in functions/ first (imports the
// compiled lib/ output, not the TypeScript source).
import assert from "node:assert/strict";
import {
  compareShadowDecision,
  runShadowParitySuite,
} from "../lib/access/shadowParityHarness.js";
import { PARITY_FIXTURES } from "../lib/access/parityFixtures.js";

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS: ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL: ${name}`);
    console.error(err);
  }
}

check("fixture set is non-empty", () => {
  assert.ok(PARITY_FIXTURES.length > 0);
});

// --- P1/P2: 100% parity against the seeded-compatibility oracle ---
check("P1/P2: every parity fixture's resolved decision matches its recorded legacy decision", () => {
  const report = runShadowParitySuite(PARITY_FIXTURES);
  if (!report.fullParity) {
    console.error("Parity mismatches:", JSON.stringify(report.mismatches, null, 2));
  }
  assert.equal(report.fullParity, true);
  assert.equal(report.matched, report.total);
  assert.equal(report.mismatches.length, 0);
});

check("P1: report totals are internally consistent", () => {
  const report = runShadowParitySuite(PARITY_FIXTURES);
  assert.equal(report.total, PARITY_FIXTURES.length);
  assert.equal(report.matched + report.mismatches.length, report.total);
});

// --- Spec sec18: shadow mode enforces nothing, is a pure comparison ---
check("compareShadowDecision is a pure comparison record (same inputs -> same output)", () => {
  const [fixture] = PARITY_FIXTURES;
  const first = compareShadowDecision(fixture);
  const second = compareShadowDecision(fixture);
  assert.deepEqual(first, second);
});

check("a deliberately mismatched legacyDecision is reported as a genuine mismatch (harness actually detects drift)", () => {
  const [fixture] = PARITY_FIXTURES;
  const flipped = {
    ...fixture,
    legacyDecision: fixture.legacyDecision === "ALLOW" ? "DENY" : "ALLOW",
  };
  const result = compareShadowDecision(flipped);
  assert.equal(result.match, false);
  assert.equal(result.legacyDecision, flipped.legacyDecision);
});

check("comparison result exposes no assignment/target internals beyond the caller-supplied fixtureLabel", () => {
  const [fixture] = PARITY_FIXTURES;
  const result = compareShadowDecision(fixture);
  const keys = Object.keys(result).sort();
  assert.deepEqual(keys, [
    "fixtureLabel",
    "legacyDecision",
    "match",
    "permissionId",
    "resolvedDecision",
  ]);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
