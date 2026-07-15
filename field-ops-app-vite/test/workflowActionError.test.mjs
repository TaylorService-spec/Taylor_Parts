// Issue #214 PR-3 -- unit tests for the safe categorized copy shown when a
// workflow action (Work Order transition / reorder cancel / PO void / reject)
// fails. It must map to one of four safe categories, always say "Nothing was
// changed", and NEVER leak a raw message, Firebase/Functions code, stack, UID, or
// document id.
//
// Run: node test/workflowActionError.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import { workflowActionErrorMessage } from "../src/domain/workflowActionError.js";

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }

// Raw-leak indicators: hyphenated Firebase/Functions error CODES, namespaced
// codes, provider class names, stack frames, long opaque ids, doc paths. (Plain
// English words like "unavailable" in the safe copy are NOT leaks.)
const RAW = /permission-denied|invalid-argument|failed-precondition|deadline-exceeded|functions\/|firestore\/|FirebaseError|HttpsError|code:|documents\/|[A-Za-z0-9]{20,}|at .+\.(ts|js):\d+/;

function noLeak(m) { assert.doesNotMatch(m, RAW, `leaked raw detail: ${m}`); assert.match(m, /nothing was changed/i); }

ok("invalid-argument / failed-precondition -> validation copy, no leak", () => {
  for (const code of ["invalid-argument", "failed-precondition", "functions/invalid-argument"]) {
    const m = workflowActionErrorMessage({ code });
    assert.match(m, /isn't valid/i); noLeak(m);
  }
});
ok("permission-denied / unauthenticated -> authorization copy, no leak", () => {
  for (const code of ["permission-denied", "functions/permission-denied", "unauthenticated"]) {
    const m = workflowActionErrorMessage({ code });
    assert.match(m, /not allowed/i); noLeak(m);
  }
});
ok("unavailable / deadline-exceeded -> service copy, no leak", () => {
  for (const code of ["unavailable", "firestore/unavailable", "deadline-exceeded"]) {
    const m = workflowActionErrorMessage({ code });
    assert.match(m, /unavailable/i); noLeak(m);
  }
});
ok("unknown / internal -> generic copy, no leak", () => {
  for (const code of ["internal", "functions/internal", "weird-code", ""]) {
    const m = workflowActionErrorMessage({ code });
    assert.match(m, /something went wrong/i); noLeak(m);
  }
});
ok("a raw Error with a leaky message never leaks it", () => {
  const m = workflowActionErrorMessage(new Error("FirebaseError: permission-denied at documents/fieldops_wos/abc123XYZ456uid789"));
  noLeak(m);
});
ok("blocked (demo mode) -> disabled copy, no leak", () => {
  const m = workflowActionErrorMessage({ blocked: true });
  assert.match(m, /disabled/i); noLeak(m);
});
ok("null / undefined -> safe generic copy", () => {
  noLeak(workflowActionErrorMessage(null));
  noLeak(workflowActionErrorMessage(undefined));
});

console.log(`\n${passed} passed, 0 failed`);
