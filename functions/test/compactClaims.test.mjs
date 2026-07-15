// Enterprise Access & Administration Platform (Issue #226) -- Row 6
// (Task 11) acceptance tests for the compact-claims shape validator +
// accessVersion freshness comparison (functions/src/access/
// compactClaims.ts). Covers Spec sec11 (the four-field cap, rejecting
// any extra key) and sec13 (stale-token fail-closed).
//
// Dependency-free: plain Node assert against the compiled module, no
// test runner, matching this repo's existing pure-logic test
// convention.
//
// Prerequisite: `npm run build` in functions/ first (imports the
// compiled lib/ output, not the TypeScript source).
import assert from "node:assert/strict";
import {
  buildCompactClaims,
  isAccessVersionStale,
  assertFreshAccessVersion,
  isValidAccessVersionValue,
  CompactClaimsValidationError,
  StaleAccessVersionError,
} from "../lib/access/compactClaims.js";

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

check("buildCompactClaims accepts accessVersion alone", () => {
  const claims = buildCompactClaims({ accessVersion: 1 });
  assert.deepEqual(claims, { accessVersion: 1 });
});

check("buildCompactClaims accepts all four permitted fields", () => {
  const claims = buildCompactClaims({
    companyId: "company-1",
    platformAdmin: true,
    companyAdmin: false,
    accessVersion: 3,
  });
  assert.deepEqual(claims, {
    companyId: "company-1",
    platformAdmin: true,
    companyAdmin: false,
    accessVersion: 3,
  });
});

check("buildCompactClaims rejects any key outside the four permitted ones (Spec sec11 hard prohibition)", () => {
  for (const bogusKey of ["permissions", "scope", "conditions", "role", "territory"]) {
    assert.throws(
      () => buildCompactClaims({ accessVersion: 1, [bogusKey]: "leaked" }),
      CompactClaimsValidationError,
      `expected rejection for extra key "${bogusKey}"`,
    );
  }
});

check("buildCompactClaims rejects a non-object input", () => {
  for (const bad of [null, undefined, "string", 42, []]) {
    assert.throws(() => buildCompactClaims(bad), CompactClaimsValidationError);
  }
});

check("buildCompactClaims requires accessVersion", () => {
  assert.throws(() => buildCompactClaims({}), CompactClaimsValidationError);
});

for (const bad of [-1, 1.5, "3", NaN, true]) {
  check(`buildCompactClaims rejects an invalid accessVersion (${JSON.stringify(bad)})`, () => {
    assert.throws(() => buildCompactClaims({ accessVersion: bad }), CompactClaimsValidationError);
  });
}

check("buildCompactClaims accepts accessVersion 0", () => {
  assert.doesNotThrow(() => buildCompactClaims({ accessVersion: 0 }));
});

for (const [field, bad] of [
  ["companyId", 123],
  ["platformAdmin", "yes"],
  ["companyAdmin", 1],
]) {
  check(`buildCompactClaims rejects a wrong-typed ${field}`, () => {
    assert.throws(
      () => buildCompactClaims({ accessVersion: 1, [field]: bad }),
      CompactClaimsValidationError,
    );
  });
}

check("buildCompactClaims never includes an omitted optional field, not even as undefined", () => {
  const claims = buildCompactClaims({ accessVersion: 1 });
  assert.deepEqual(Object.keys(claims), ["accessVersion"]);
});

// --- Spec sec13: stale-token fail-closed ---
check("isAccessVersionStale: matching versions are NOT stale", () => {
  assert.equal(isAccessVersionStale(5, 5), false);
});
check("isAccessVersionStale: a lower token version is stale", () => {
  assert.equal(isAccessVersionStale(4, 5), true);
});
check("isAccessVersionStale: a HIGHER token version is also stale (never more-trusted-than-authoritative)", () => {
  assert.equal(isAccessVersionStale(6, 5), true);
});

check("assertFreshAccessVersion does not throw when versions match", () => {
  assert.doesNotThrow(() => assertFreshAccessVersion(2, 2));
});
check("assertFreshAccessVersion throws StaleAccessVersionError on mismatch (fail-closed)", () => {
  assert.throws(() => assertFreshAccessVersion(1, 2), StaleAccessVersionError);
});

// --- Customer review round 3: malformed/untrusted values must fail
// closed, even when IDENTICAL on both sides (Spec sec13). Prior to
// this correction, isAccessVersionStale(-1, -1) or
// isAccessVersionStale("1", "1") returned false (treated as fresh) --
// a strict `!==` comparison never validated either side's shape. ---
const MALFORMED_VALUES = [undefined, null, "1", -1, 1.5, NaN, Infinity, -Infinity, {}, [], {}, ["1"]];

check("isValidAccessVersionValue rejects every malformed shape", () => {
  for (const bad of MALFORMED_VALUES) {
    assert.equal(isValidAccessVersionValue(bad), false, `expected ${JSON.stringify(bad)} to be invalid`);
  }
});
check("isValidAccessVersionValue accepts 0 and ordinary positive integers", () => {
  assert.equal(isValidAccessVersionValue(0), true);
  assert.equal(isValidAccessVersionValue(7), true);
});

check("isAccessVersionStale: an IDENTICAL malformed pair is still stale (fail-closed, not accepted as fresh)", () => {
  for (const bad of MALFORMED_VALUES) {
    assert.equal(
      isAccessVersionStale(bad, bad),
      true,
      `expected identical malformed pair ${JSON.stringify(bad)}/${JSON.stringify(bad)} to be stale`,
    );
  }
  // The two specific cases the review named explicitly.
  assert.equal(isAccessVersionStale(-1, -1), true);
  assert.equal(isAccessVersionStale("1", "1"), true);
});

check("isAccessVersionStale: a malformed value on EITHER side (even paired with a valid one) is stale", () => {
  assert.equal(isAccessVersionStale(undefined, 5), true);
  assert.equal(isAccessVersionStale(5, undefined), true);
  assert.equal(isAccessVersionStale(null, 5), true);
  assert.equal(isAccessVersionStale("5", 5), true);
  assert.equal(isAccessVersionStale(NaN, 5), true);
  assert.equal(isAccessVersionStale(Infinity, 5), true);
  assert.equal(isAccessVersionStale({}, 5), true);
  assert.equal(isAccessVersionStale([5], 5), true);
});

check("assertFreshAccessVersion throws (fail-closed) for every malformed value, on either side, including identical malformed pairs", () => {
  for (const bad of MALFORMED_VALUES) {
    assert.throws(() => assertFreshAccessVersion(bad, 5), StaleAccessVersionError);
    assert.throws(() => assertFreshAccessVersion(5, bad), StaleAccessVersionError);
    assert.throws(() => assertFreshAccessVersion(bad, bad), StaleAccessVersionError);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
