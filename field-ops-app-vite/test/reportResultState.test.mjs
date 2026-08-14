// Issue #325 -- pure tests for the report result AREA's state-matrix categorizer
// (src/domain/reporting/reportResultState.js's describeRunOutcome()). Pure: no
// firebase, no browser -- runs under plain node.
//
// Run: node test/reportResultState.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import { describeRunOutcome } from "../src/domain/reporting/reportResultState.js";

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }

// ---- partially-authorized (columns dropped, nothing else) ------------------
ok("partially-authorized with no truncation surfaces only the dropped-columns note", () => {
  const d = describeRunOutcome({
    kind: "partially-authorized",
    droppedColumnLabels: ["Tax status"],
    droppedPredicateCount: 0,
    truncated: false,
    widened: false,
    rowCap: 10000,
  });
  assert.equal(d.kind, "partially-authorized");
  assert.equal(d.tone, "warning");
  assert.equal(d.notes.length, 1);
  assert.match(d.notes[0], /Tax status/);
  assert.ok(!d.notes.some((n) => /cut off/.test(n)));
});

// ---- Fix 2: partially-authorized AND truncated must surface BOTH signals ---
ok("partially-authorized + truncated surfaces BOTH the dropped-columns note and the truncation note", () => {
  const d = describeRunOutcome({
    kind: "partially-authorized",
    droppedColumnLabels: ["Tax status"],
    droppedPredicateCount: 0,
    truncated: true,
    rowCap: 500,
    widened: false,
  });
  assert.equal(d.kind, "partially-authorized");
  const joined = d.notes.join(" | ");
  assert.match(joined, /Tax status/, "dropped-column signal must still be present");
  assert.match(joined, /cut off/, "truncation signal must ALSO be present, not masked by the partially-authorized kind");
  assert.match(joined, /500/, "the row cap must be named when known");
});

ok("partially-authorized + truncated with an unknown row cap still names the truncation generically", () => {
  const d = describeRunOutcome({
    kind: "partially-authorized",
    droppedColumnLabels: ["Tax status"],
    droppedPredicateCount: 0,
    truncated: true,
    rowCap: null,
    widened: false,
  });
  const joined = d.notes.join(" | ");
  assert.match(joined, /cut off and isn't complete/);
});

ok("partially-authorized + dropped predicates + truncated surfaces all three signals without duplicating the widened note", () => {
  const d = describeRunOutcome({
    kind: "partially-authorized",
    droppedColumnLabels: ["Tax status"],
    droppedPredicateCount: 2,
    truncated: true,
    rowCap: 500,
    widened: true,
  });
  const joined = d.notes.join(" | ");
  assert.match(joined, /Tax status/);
  assert.match(joined, /2 filters you can't view/);
  assert.match(joined, /cut off/);
  // The predicate-drop note already says "wider than the saved report" --
  // the generic widened note must not be duplicated alongside it.
  const widerCount = (joined.match(/wider than the saved report/g) || []).length;
  assert.equal(widerCount, 1);
});

ok("partially-authorized + widened (no dropped predicates counted) still surfaces the widened note", () => {
  const d = describeRunOutcome({
    kind: "partially-authorized",
    droppedColumnLabels: ["Tax status"],
    droppedPredicateCount: 0,
    truncated: false,
    rowCap: 10000,
    widened: true,
  });
  const joined = d.notes.join(" | ");
  assert.match(joined, /Tax status/);
  assert.match(joined, /wider than the saved report/);
});

// ---- unaffected kinds keep behaving the same --------------------------------
ok("truncated-widened kind is unaffected by the partially-authorized fix", () => {
  const d = describeRunOutcome({ kind: "truncated-widened", truncated: true, widened: true, rowCap: 100 });
  assert.equal(d.kind, "truncated-widened");
  const joined = d.notes.join(" | ");
  assert.match(joined, /wider than the saved report/);
  assert.match(joined, /cut off/);
});

ok("permission-denied is unaffected", () => {
  const d = describeRunOutcome({ kind: "permission-denied" });
  assert.equal(d.kind, "permission-denied");
  assert.equal(d.role, "alert");
});

ok("an unknown kind fails closed to failure", () => {
  const d = describeRunOutcome({ kind: "nonsense" });
  assert.equal(d.kind, "failure");
});

console.log(`\n${passed} passed`);
