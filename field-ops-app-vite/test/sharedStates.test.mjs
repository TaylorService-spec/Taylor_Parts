// Issue #214 PR-4 -- unit tests for the shared application-state contract's pure
// piece: loadErrorMessage, the safe categorized copy FailureState renders for a
// page/collection load or subscription failure. It must never leak a raw Firebase
// code, path, document id, or stack. (The LoadingState / EmptyState / FailureState
// components themselves are JSX and are verified in a real browser by the driver's
// verify-shared-application-states.)
//
// Run: node test/sharedStates.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import { loadErrorMessage } from "../src/domain/loadErrorMessage.js";

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }

const RAW_LEAKS = /permission-denied|firestore\/|FirebaseError|code:|Missing or insufficient|apiKey|AIza|documents\/|stack/i;

ok("permission-denied -> authorization copy naming the entity, no raw code", () => {
  for (const code of ["permission-denied", "firestore/permission-denied"]) {
    const m = loadErrorMessage({ code }, { entity: "customers" });
    assert.match(m, /permission/i);
    assert.match(m, /customers/);
    assert.doesNotMatch(m, RAW_LEAKS);
  }
});
ok("unavailable -> connection/retry copy, no raw code", () => {
  for (const code of ["unavailable", "firestore/unavailable"]) {
    const m = loadErrorMessage({ code }, { entity: "work orders" });
    assert.match(m, /connection|reach the server|try again/i);
    assert.doesNotMatch(m, RAW_LEAKS);
  }
});
ok("unknown error -> generic retry copy naming the entity, no raw detail", () => {
  const m = loadErrorMessage(new Error("Missing or insufficient permissions. code: internal at documents/accounts/abc123"), { entity: "customers" });
  assert.match(m, /couldn.t load customers/i);
  assert.match(m, /try again/i);
  assert.doesNotMatch(m, RAW_LEAKS);
});
ok("no entity -> falls back to a safe generic noun", () => {
  const m = loadErrorMessage({ code: "internal" });
  assert.match(m, /couldn.t load data/i);
  assert.doesNotMatch(m, RAW_LEAKS);
});
ok("null / undefined error -> safe generic copy", () => {
  assert.doesNotMatch(loadErrorMessage(null, { entity: "customers" }), RAW_LEAKS);
  assert.doesNotMatch(loadErrorMessage(undefined), RAW_LEAKS);
});

console.log(`\n${passed} passed, 0 failed`);
