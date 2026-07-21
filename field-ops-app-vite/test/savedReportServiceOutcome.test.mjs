// Issue #325 W-SAVE -- pure tests for the saved-definition callable outcome mappers. Pure node.
//
// Run: node test/savedReportServiceOutcome.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import {
  SAVED_DEFINITION_OUTCOME, mapSavedDefinitionError, toMillis, normalizeRecord, normalizeList,
} from "../src/domain/reporting/savedReportServiceOutcome.js";

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }

const RAW_LEAKS = /permission-denied|firestore\/|FirebaseError|functions\/|code:|reportDefinitions|ownerUid|AIza/i;

ok("error codes map to safe outcome kinds with safe copy", () => {
  const cases = {
    "permission-denied": SAVED_DEFINITION_OUTCOME.DENIED,
    "unauthenticated": SAVED_DEFINITION_OUTCOME.DENIED,
    "functions/permission-denied": SAVED_DEFINITION_OUTCOME.DENIED,
    "not-found": SAVED_DEFINITION_OUTCOME.NOT_FOUND,
    "invalid-argument": SAVED_DEFINITION_OUTCOME.INVALID,
    "unavailable": SAVED_DEFINITION_OUTCOME.UNAVAILABLE,
    "deadline-exceeded": SAVED_DEFINITION_OUTCOME.UNAVAILABLE,
    "internal": SAVED_DEFINITION_OUTCOME.FAILURE,
    "unknown": SAVED_DEFINITION_OUTCOME.FAILURE,
    "": SAVED_DEFINITION_OUTCOME.FAILURE,
  };
  for (const [code, kind] of Object.entries(cases)) {
    const out = mapSavedDefinitionError({ code, message: "raw server detail naming reportDefinitions/ownerUid" });
    assert.equal(out.kind, kind, `${code} -> ${kind}`);
    assert.doesNotMatch(out.message, RAW_LEAKS, `${code} copy must be safe`);
  }
});

ok("NotOwner and NotFound are indistinguishable to the client (both -> not-found)", () => {
  // The service maps both to the `not-found` HttpsError; the client can't tell them apart.
  assert.equal(mapSavedDefinitionError({ code: "not-found" }).kind, SAVED_DEFINITION_OUTCOME.NOT_FOUND);
});

ok("toMillis handles serialized Timestamp / number / ISO string / nullish", () => {
  assert.equal(toMillis({ _seconds: 1700000000, _nanoseconds: 0 }), 1700000000000);
  assert.equal(toMillis({ seconds: 1700000000 }), 1700000000000);
  assert.equal(toMillis(1700000000000), 1700000000000);
  assert.equal(toMillis("2023-11-14T00:00:00.000Z"), Date.parse("2023-11-14T00:00:00.000Z"));
  assert.equal(toMillis(null), null);
  assert.equal(toMillis(undefined), null);
  assert.equal(toMillis("not-a-date"), null);
  assert.equal(toMillis(NaN), null);
});

ok("normalizeRecord keeps well-formed records and drops malformed ones (fail closed)", () => {
  const good = normalizeRecord({ id: "a", name: "R", ownerUid: "u1", definition: { objectId: "customer" }, updatedAt: { _seconds: 1700000000 } });
  assert.equal(good.id, "a");
  assert.equal(good.name, "R");
  assert.equal(good.updatedAtMillis, 1700000000000);
  assert.deepEqual(good.definition, { objectId: "customer" });
  for (const bad of [null, undefined, {}, { id: "a" }, { id: "", name: "R" }, { id: 1, name: "R" }, { name: "R" }]) {
    assert.equal(normalizeRecord(bad), null, `should drop ${JSON.stringify(bad)}`);
  }
});

ok("normalizeList drops malformed records and sorts newest-updated first", () => {
  const list = normalizeList([
    { id: "a", name: "A", updatedAt: { _seconds: 100 } },
    { id: "b", name: "B", updatedAt: { _seconds: 300 } },
    null,
    { id: "c", name: "C", updatedAt: { _seconds: 200 } },
    { id: "", name: "bad" },
  ]);
  assert.deepEqual(list.map((r) => r.id), ["b", "c", "a"]);
  assert.deepEqual(normalizeList("nope"), []);
});

console.log(`\n${passed} passed, 0 failed`);
