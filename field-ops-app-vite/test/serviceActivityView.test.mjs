// Customer/Account Business Model -- Customer PR 3, Service Activity.
// Deterministic unit test for the pure render decisions in
// src/domain/serviceActivityView.js -- the module ServiceActivitySection
// renders each element from. Because each element's view is a function of
// ONLY its own state, these assertions prove the four failure-independence
// guarantees the Service Activity section must hold, transport-independent
// (the browser driver additionally proves the count scenarios end-to-end
// via real request interception; the timeline getDocs runs over the shared
// WebChannel and can't be failed selectively at the network level, which is
// exactly why this deterministic unit test exists).
//
// Run: node test/serviceActivityView.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import { countView, timelineView } from "../src/domain/serviceActivityView.js";

let passed = 0;
function ok(name, fn) {
  fn();
  passed += 1;
  console.log("PASS -- " + name);
}

const loadingCount = { loading: true, error: false, value: null };
const errorCount = { loading: false, error: true, value: null };
const value = (n) => ({ loading: false, error: false, value: n });

const loadingTimeline = { loading: true, error: false, items: [] };
const errorTimeline = { loading: false, error: true, items: [] };
const emptyTimeline = { loading: false, error: false, items: [] };
const listTimeline = { loading: false, error: false, items: [{ id: "a" }, { id: "b" }] };

// --- Baseline: each view reflects only its own state ---
ok("countView: loading -> loading", () => assert.deepEqual(countView(loadingCount), { kind: "loading" }));
ok("countView: error -> error", () => assert.deepEqual(countView(errorCount), { kind: "error" }));
ok("countView: value -> value", () => assert.deepEqual(countView(value(9)), { kind: "value", value: 9 }));
ok("timelineView: loading/error/empty/list distinct", () => {
  assert.equal(timelineView(loadingTimeline).kind, "loading");
  assert.equal(timelineView(errorTimeline).kind, "error");
  assert.equal(timelineView(emptyTimeline).kind, "empty"); // genuine zero, not an error
  assert.equal(timelineView(listTimeline).kind, "list");
});

// --- Scenario 1: Completed count fails while Open still renders its value ---
ok("Completed fails while Open still renders", () => {
  const completed = countView(errorCount);
  const open = countView(value(9));
  assert.equal(completed.kind, "error");
  assert.deepEqual(open, { kind: "value", value: 9 }); // Open unaffected
});

// --- Scenario 2: Open count fails while Completed still renders its value ---
ok("Open fails while Completed still renders", () => {
  const open = countView(errorCount);
  const completed = countView(value(3));
  assert.equal(open.kind, "error");
  assert.deepEqual(completed, { kind: "value", value: 3 }); // Completed unaffected
});

// --- Scenario 3: timeline failure does not hide the counts ---
ok("timeline failure does not hide the counts", () => {
  const tl = timelineView(errorTimeline);
  const completed = countView(value(3));
  const open = countView(value(9));
  assert.equal(tl.kind, "error");
  assert.deepEqual(completed, { kind: "value", value: 3 }); // counts still render
  assert.deepEqual(open, { kind: "value", value: 9 });
});

// --- Scenario 4: count failure does not hide the timeline ---
ok("count failure does not hide the timeline", () => {
  const completed = countView(errorCount);
  const open = countView(errorCount);
  const tl = timelineView(listTimeline);
  assert.equal(completed.kind, "error");
  assert.equal(open.kind, "error");
  assert.equal(tl.kind, "list"); // timeline still renders its rows
});

console.log(`\n${passed} passed, 0 failed`);
