// Issue #214 PR-2 -- unit tests for the safe, categorized save-error copy shown
// inside the Contact/Location creation modals. The copy must never leak a raw
// Firebase code, document id, or credential detail.
//
// Run: node test/contactLocationSaveErrors.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import { contactSaveErrorMessage, locationSaveErrorMessage } from "../src/domain/accountChildSaveErrors.js";

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }

const RAW_LEAKS = /permission-denied|firestore\/|FirebaseError|code:|Missing or insufficient|apiKey|AIza|uid|documents\//i;

ok("contact: blocked (demo mode) -> safe 'no contact added' copy", () => {
  const m = contactSaveErrorMessage({ blocked: true });
  assert.match(m, /disabled/i);
  assert.match(m, /no contact was added/i);
  assert.doesNotMatch(m, RAW_LEAKS);
});
ok("contact: permission-denied -> permission copy, no raw code", () => {
  for (const code of ["permission-denied", "firestore/permission-denied"]) {
    const m = contactSaveErrorMessage({ code });
    assert.match(m, /permission/i);
    assert.doesNotMatch(m, RAW_LEAKS);
  }
});
ok("contact: unknown error -> generic retry copy, nothing persisted, no raw detail", () => {
  const m = contactSaveErrorMessage(new Error("Missing or insufficient permissions. code: internal at documents/contacts/abc123"));
  assert.match(m, /could not add this contact/i);
  assert.match(m, /no contact was added/i);
  assert.doesNotMatch(m, RAW_LEAKS);
});
ok("contact: undefined/null err -> safe generic copy", () => {
  assert.doesNotMatch(contactSaveErrorMessage(undefined), RAW_LEAKS);
  assert.doesNotMatch(contactSaveErrorMessage(null), RAW_LEAKS);
});

ok("location: blocked -> safe 'no location added' copy", () => {
  const m = locationSaveErrorMessage({ blocked: true });
  assert.match(m, /disabled/i);
  assert.match(m, /no location was added/i);
  assert.doesNotMatch(m, RAW_LEAKS);
});
ok("location: permission-denied -> permission copy, no raw code", () => {
  const m = locationSaveErrorMessage({ code: "permission-denied" });
  assert.match(m, /permission/i);
  assert.doesNotMatch(m, RAW_LEAKS);
});
ok("location: unknown error -> generic retry copy, no raw detail", () => {
  const m = locationSaveErrorMessage(new Error("FirebaseError: code: unavailable"));
  assert.match(m, /could not add this location/i);
  assert.doesNotMatch(m, RAW_LEAKS);
});

console.log(`\n${passed} passed, 0 failed`);
