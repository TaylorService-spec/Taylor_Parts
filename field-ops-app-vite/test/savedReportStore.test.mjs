// Issue #325 / ADR-007 W-SAVE-UI -- pure tests for the in-memory saved-report store.
// Pure: no firebase, no browser -- runs under plain node.
//
// Run: node test/savedReportStore.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import {
  createInStore, renameInStore, duplicateInStore, deleteFromStore,
  reportsForOwner, getSavedReport, ownerHasReportNamed,
} from "../src/domain/reporting/savedReportStore.js";

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }

const def = () => ({ objectId: "customer", fields: ["customer.name"] });

ok("create/rename/duplicate/delete are non-mutating and behave correctly", () => {
  let store = [];
  const s1 = createInStore(store, { id: "a", name: "Alpha", ownerUid: "u1", definition: def(), now: 100 });
  assert.equal(store.length, 0, "input not mutated");
  assert.equal(s1.length, 1);
  assert.equal(s1[0].name, "Alpha");

  const s2 = createInStore(s1, { id: "b", name: "Beta", ownerUid: "u1", definition: def(), now: 200 });
  assert.equal(s2.length, 2);

  // rename
  const s3 = renameInStore(s2, "a", "u1", "Alpha renamed", 300);
  assert.equal(getSavedReport(s3, "a", "u1").name, "Alpha renamed");
  assert.equal(getSavedReport(s3, "a", "u1").updatedAt, 300);
  assert.equal(getSavedReport(s2, "a", "u1").name, "Alpha", "rename did not mutate the prior store");

  // duplicate
  const s4 = duplicateInStore(s3, "b", "u1", { newId: "b-copy", now: 400 });
  assert.equal(s4.length, 3);
  const copy = getSavedReport(s4, "b-copy", "u1");
  assert.equal(copy.name, "Copy of Beta");
  assert.deepEqual(copy.definition, def());
  assert.equal(copy.id, "b-copy");

  // delete
  const s5 = deleteFromStore(s4, "a", "u1");
  assert.equal(getSavedReport(s5, "a", "u1"), null);
  assert.equal(s5.length, 2);
  assert.equal(s4.length, 3, "delete did not mutate the prior store");
});

ok("reads and writes are owner-scoped -- one owner never sees or edits another's reports", () => {
  let store = [];
  store = createInStore(store, { id: "a", name: "Mine", ownerUid: "u1", definition: def(), now: 1 });
  store = createInStore(store, { id: "b", name: "Theirs", ownerUid: "u2", definition: def(), now: 2 });

  assert.deepEqual(reportsForOwner(store, "u1").map((r) => r.id), ["a"]);
  assert.deepEqual(reportsForOwner(store, "u2").map((r) => r.id), ["b"]);
  assert.equal(getSavedReport(store, "b", "u1"), null, "u1 cannot fetch u2's report");

  // u1 cannot rename/duplicate/delete u2's report -> no-op
  assert.equal(getSavedReport(renameInStore(store, "b", "u1", "hacked", 9), "b", "u2").name, "Theirs");
  assert.equal(duplicateInStore(store, "b", "u1", { newId: "x", now: 9 }).length, store.length);
  assert.equal(deleteFromStore(store, "b", "u1").length, store.length);
});

ok("reportsForOwner returns newest-updated first", () => {
  let store = [];
  store = createInStore(store, { id: "a", name: "A", ownerUid: "u1", definition: def(), now: 100 });
  store = createInStore(store, { id: "b", name: "B", ownerUid: "u1", definition: def(), now: 300 });
  store = createInStore(store, { id: "c", name: "C", ownerUid: "u1", definition: def(), now: 200 });
  assert.deepEqual(reportsForOwner(store, "u1").map((r) => r.id), ["b", "c", "a"]);
});

ok("ownerHasReportNamed powers a soft duplicate-name check within an owner's set", () => {
  let store = createInStore([], { id: "a", name: "Q3 Accounts", ownerUid: "u1", definition: def(), now: 1 });
  assert.equal(ownerHasReportNamed(store, "u1", "Q3 Accounts"), true);
  assert.equal(ownerHasReportNamed(store, "u1", "  Q3 Accounts  "), true); // trims
  assert.equal(ownerHasReportNamed(store, "u2", "Q3 Accounts"), false); // scoped to owner
  assert.equal(ownerHasReportNamed(store, "u1", ""), false);
});

ok("operations tolerate a malformed/undefined store without throwing", () => {
  assert.deepEqual(reportsForOwner(undefined, "u1"), []);
  assert.deepEqual(deleteFromStore(null, "a", "u1"), []);
  assert.equal(getSavedReport(null, "a", "u1"), null);
});

console.log(`\n${passed} passed, 0 failed`);
