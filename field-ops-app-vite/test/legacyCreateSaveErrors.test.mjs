// Issue #214 PR-5 -- unit tests for the safe categorized copy shown inside the
// retained Jobs / Technicians creation modals. Must never leak a raw Firebase
// code, document id, or internal detail, and must always say nothing was added.
//
// Run: node test/legacyCreateSaveErrors.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import { jobSaveErrorMessage, technicianSaveErrorMessage } from "../src/domain/legacyCreateSaveErrors.js";

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }

const RAW = /permission-denied|firestore\/|FirebaseError|code:|documents\/|[A-Za-z0-9]{20,}/;
function noLeak(m) { assert.doesNotMatch(m, RAW, `leaked: ${m}`); assert.match(m, /added/i); }

ok("job: blocked -> disabled copy, no leak", () => {
  const m = jobSaveErrorMessage({ blocked: true });
  assert.match(m, /disabled/i); noLeak(m);
});
ok("job: permission-denied -> authorization copy, no raw code", () => {
  for (const code of ["permission-denied", "firestore/permission-denied"]) {
    const m = jobSaveErrorMessage({ code });
    assert.match(m, /permission/i); noLeak(m);
  }
});
ok("job: unknown / raw Error -> generic copy, no leak", () => {
  noLeak(jobSaveErrorMessage({ code: "internal" }));
  noLeak(jobSaveErrorMessage(new Error("FirebaseError: permission-denied at documents/fieldops_jobs/abc123XYZ456")));
  noLeak(jobSaveErrorMessage(null));
});
ok("technician: blocked / denied / unknown -> safe copy, no leak", () => {
  assert.match(technicianSaveErrorMessage({ blocked: true }), /disabled/i);
  assert.match(technicianSaveErrorMessage({ code: "permission-denied" }), /permission/i);
  for (const e of [{ blocked: true }, { code: "permission-denied" }, { code: "unavailable" }, null, undefined]) {
    noLeak(technicianSaveErrorMessage(e));
  }
});

console.log(`\n${passed} passed, 0 failed`);
