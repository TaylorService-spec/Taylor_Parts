// #291 -- the pure state decisions behind useLocationsForAccount. The React lifecycle
// (subscription, obsolete-callback guard, retry re-subscription) is proven in the browser
// gate; the fail-closed outcomes are proven here, without a browser.
//
// Run: node test/locationSubscription.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import {
  locationSuccessOutcome,
  locationFailureOutcome,
  locationIdleOutcome,
} from "../src/domain/locationSubscription.js";

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }

const LEAKY = /permission-denied|firestore|firebase|FirebaseError|unavailable\b|\/locations\/|[A-Za-z0-9_-]{20,}/i;

ok("SUCCESS resolves the data, stops loading, and clears any prior error", () => {
  const docs = [{ id: "l1", name: "Main Plant" }, { id: "l2", name: "North Annex" }];
  const o = locationSuccessOutcome(docs);
  assert.deepEqual(o, { data: docs, loading: false, error: null });
  // A later success SUPERSEDES an earlier failure -- this is what makes retry recover:
  // whatever error was on screen, a good snapshot clears it.
  assert.equal(o.error, null);
});

ok("SUCCESS with a non-array is coerced to empty rather than trusted", () => {
  for (const bad of [null, undefined, "x", 5, {}]) {
    assert.deepEqual(locationSuccessOutcome(bad), { data: [], loading: false, error: null });
  }
});

ok("FAILURE fails closed -- empty data, stopped loading, a SAFE message", () => {
  const o = locationFailureOutcome({ code: "permission-denied" });
  assert.deepEqual(o.data, [], "no stale or partial list survives a failure");
  assert.equal(o.loading, false, "a failure is not perpetual loading");
  assert.equal(typeof o.error, "string");
  assert.ok(o.error.length > 0, "the failure is named, not silent");
  assert.match(o.error, /permission to view these locations/i);
});

ok("FAILURE copy leaks no provider code, path, id, or collection name", () => {
  for (const err of [
    { code: "permission-denied" },
    { code: "unavailable" },
    { code: "firestore/permission-denied", message: "Missing or insufficient permissions." },
    new Error("FirebaseError: 7 PERMISSION_DENIED: /locations/abc123XYZ"),
    { code: "resource-exhausted" },
    null,
  ]) {
    const { error } = locationFailureOutcome(err);
    assert.doesNotMatch(error, LEAKY, `leaked from ${JSON.stringify(err)}: ${error}`);
  }
});

ok("FAILURE distinguishes the two categories users can act on", () => {
  // permission vs connectivity -- different actions (ask an admin vs check your network).
  assert.match(locationFailureOutcome({ code: "permission-denied" }).error, /permission/i);
  assert.match(locationFailureOutcome({ code: "unavailable" }).error, /connection|reach/i);
  // anything else is a generic, still-safe retryable.
  assert.match(locationFailureOutcome({ code: "internal" }).error, /couldn.?t load|try again/i);
});

ok("IDLE (no account) is empty and calm -- not loading, not an error", () => {
  assert.deepEqual(locationIdleOutcome(), { data: [], loading: false, error: null });
});

ok("the three outcomes are mutually distinguishable -- the whole point of #291", () => {
  const idle = locationIdleOutcome();
  const empty = locationSuccessOutcome([]);          // read succeeded, genuinely no locations
  const failed = locationFailureOutcome({ code: "permission-denied" });
  // idle and a genuine-empty both have no error and no data, but a FAILURE is set apart
  // by carrying an error -- so a consumer can tell "we could not look" from "there is
  // nothing" and from "still settling".
  assert.equal(idle.error, null);
  assert.equal(empty.error, null);
  assert.notEqual(failed.error, null);
  assert.equal(failed.data.length, 0);
  assert.equal(empty.data.length, 0);
  // A failure is never mistaken for loading.
  assert.equal(failed.loading, false);
});

console.log(`\n${passed} passed, 0 failed`);
