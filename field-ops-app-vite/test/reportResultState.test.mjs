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


// ============================================================================
// RPT-CLIENT. Baseline: rpt/false-empty-and-audit @ 8521cd88.
//
// The completeness vocabulary below is read from the server's own
// `ScanCompleteness` union (functions/src/reporting/reportExecutionService.ts):
//   "proven-complete" | "bounded-page" | "not-attempted"
// and "not-attempted" means INAPPLICABLE (a refusal that returned before any
// collection read), NOT "complete".
// ============================================================================

// ---- Defect 3: the `empty` branch read no completeness flag ----------------
//
// VERBATIM baseline copy for every `empty` outcome, whatever its completeness:
const BASELINE_EMPTY_COPY = "This report ran successfully but no records matched.";

ok("a PROVEN absence keeps the plain \"no records matched\" reading", () => {
  const d = describeRunOutcome({
    kind: "empty", rows: [], rowCount: 0,
    completeness: "proven-complete", scanTruncated: false, truncated: false,
  });
  assert.equal(d.kind, "empty");
  assert.equal(d.tone, "info");
  assert.equal(d.message, BASELINE_EMPTY_COPY,
    "a proven absence is the one case where this sentence is true");
});

ok("an UNPROVEN absence must not be rendered as a proven one", () => {
  // The live server now refuses this (UnprovenAbsenceError), but this branch is
  // FIXTURE-driven (Spec sec12), so a fixture can still assert an absence that
  // was never proven.
  const d = describeRunOutcome({
    kind: "empty", rows: [], rowCount: 0,
    completeness: "bounded-page", scanTruncated: true, truncated: true, rowCap: 500,
  });
  assert.notEqual(d.message, BASELINE_EMPTY_COPY,
    "\"ran successfully but no records matched\" claims a proven absence that was never proven");
  // textually distinguishable
  const text = [d.title, d.message, ...d.notes].filter(Boolean).join(" | ");
  assert.match(text, /read/i, "must state that records WERE read");
  assert.match(text, /not|isn't|couldn't|cannot/i, "must withhold the absence claim");
  assert.match(text, /narrow|filter/i, "must say what the reader can do about it");
  // visually distinguishable: a different display state and a warning tone, so
  // ReportBuilder's ResultArea cannot route it down the plain EmptyState path.
  assert.notEqual(d.kind, "empty", "must not render as the same display state as a proven absence");
  assert.equal(d.tone, "warning");
});

ok("a truncated `empty` with NO completeness field is still not read as proven", () => {
  // An older/partial payload states no completeness. Falling back to
  // "proven-complete" would assert something the server never said.
  const d = describeRunOutcome({ kind: "empty", rows: [], rowCount: 0, truncated: true, rowCap: 500 });
  assert.notEqual(d.message, BASELINE_EMPTY_COPY);
  assert.equal(d.tone, "warning");
});

ok("an `empty` with completeness \"not-attempted\" is rendered as NEITHER proven nor unproven absence", () => {
  // not-attempted == no scan was issued at all. An outcome claiming "empty"
  // while stating that nothing was read is incoherent; it is not an absence
  // claim of any kind, so it fails closed to the generic failure state (this
  // file's standing convention for an incoherent outcome).
  const d = describeRunOutcome({ kind: "empty", rows: null, rowCount: 0, completeness: "not-attempted", scanTruncated: false });
  assert.equal(d.kind, "failure");
  assert.equal(d.tone, "error");
  assert.notEqual(d.message, BASELINE_EMPTY_COPY);
  const text = [d.title, d.message, ...d.notes].filter(Boolean).join(" | ");
  assert.doesNotMatch(text, /no records matched|no matching records/i,
    "it must not claim an absence, proven or otherwise");
});

// ---- Defect 1, at the render layer ----------------------------------------
ok("`company-unresolved` reads as a TENANCY refusal and never implies a missing permission", () => {
  const d = describeRunOutcome({ kind: "company-unresolved", rows: null, completeness: "not-attempted" });
  assert.equal(d.kind, "company-unresolved",
    "an unrecognised kind fell through to `failure`, losing the tenancy explanation");
  const text = [d.title, d.message, ...d.notes].filter(Boolean).join(" | ");
  assert.match(text, /operating compan/i, "must name the thing that could not be established");
  // permission-denied's own copy, which this must NOT borrow -- granting a Role
  // does not fix a valueless binding and may over-grant while trying to.
  const denied = describeRunOutcome({ kind: "permission-denied" });
  assert.notEqual(d.title, denied.title);
  assert.notEqual(d.message, denied.message);
  assert.doesNotMatch(text, /don't have access|doesn't allow|need access|permission/i,
    "must not read as a missing grant");
});

// ---- Defect 2, at the render layer ----------------------------------------
ok("the scan-refusal state never says \"Nothing was read\" and never leaks a code", () => {
  const d = describeRunOutcome({
    kind: "incomplete-scan", rows: null, aggregates: null,
    // A deliberately impoverished message: this state must NOT echo it, because a
    // fixture-supplied message can drop the action, the "records were read" fact,
    // or both. The descriptor's copy is fixed.
    message: "The report read records, but not all of them.",
  });
  assert.equal(d.kind, "incomplete-scan");
  assert.notEqual(d.message, "The report read records, but not all of them.");
  const text = [d.title, d.message, ...d.notes].filter(Boolean).join(" | ");
  assert.doesNotMatch(text, /Nothing was read/i);
  assert.doesNotMatch(text, /aren't available yet|isn't available yet/i);
  assert.match(text, /read/i);
  assert.match(text, /narrow|filter/i);
  assert.doesNotMatch(text, /resource-exhausted|functions\/|HttpsError/i);
});

// ---- the completeness axis must not be lost behind a winning kind ---------
ok("a scan-bounded `partially-authorized` surfaces the population cut even if `truncated` is unset", () => {
  // truncated is an OR of three bounds; only SCAN truncation cuts the
  // population. The orthogonal axis must be read, not inferred from the winner.
  const d = describeRunOutcome({
    kind: "partially-authorized", droppedColumnLabels: ["Tax status"], droppedPredicateCount: 0,
    truncated: false, widened: false, completeness: "bounded-page", scanTruncated: true, rowCap: null,
  });
  const joined = d.notes.join(" | ");
  assert.match(joined, /Tax status/);
  assert.match(joined, /complete/i, "the population cut must be surfaced alongside the winning kind");
});


ok("\"empty-unproven\" is OUTPUT-only -- it is not an accepted input kind", () => {
  // The asymmetry is deliberate and is asserted so it cannot be "tidied up" into
  // KINDS later: no OUTCOME ever carries this kind, only a descriptor does.
  const d = describeRunOutcome({ kind: "empty-unproven" });
  assert.equal(d.kind, "failure", "an outcome cannot arrive with an output-only display kind");
});

console.log(`\n${passed} passed`);
