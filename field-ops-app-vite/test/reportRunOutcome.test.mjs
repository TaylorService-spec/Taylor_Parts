// Issue #325 / ADR-007 W1 -- pure tests for the D-FN <-> client outcome mappers.
// Pure: no firebase, no browser -- runs under plain node.
//
// Run: node test/reportRunOutcome.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import {
  mapServiceOutcome, mapCallableError, reportRunUnavailable,
  REPORT_RUN_UNAVAILABLE_REASON,
} from "../src/domain/reporting/reportRunOutcome.js";

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }

// no raw Firebase code/path/id leaks into user-facing copy (Spec §12)
const RAW_LEAKS = /permission-denied|firestore\/|FirebaseError|functions\/|code:|apiKey|AIza|documents\/|runReportDefinitionCallable|stack/i;

// ---- successful service outcomes -------------------------------------------
ok("a `results` payload maps through with rows, aggregates, caps, and safe dropped labels", () => {
  const out = mapServiceOutcome({
    kind: "results", objectId: "customer",
    rows: [{ "customer.name": "Acme" }], aggregates: null,
    rowCount: 1, rowCap: 10000, truncated: false, widened: false,
    droppedColumnLabels: ["Payment terms"], droppedFieldIds: ["customer.paymentTerms"],
    droppedPredicateFieldIds: [], droppedPredicateCount: 0,
  });
  assert.equal(out.ok, true);
  assert.equal(out.kind, "results");
  assert.deepEqual(out.rows, [{ "customer.name": "Acme" }]);
  assert.equal(out.rowCap, 10000);
  assert.deepEqual(out.droppedColumnLabels, ["Payment terms"]);
  // audit-facing raw ids are NOT carried into the client outcome
  assert.equal(out.droppedFieldIds, undefined);
  assert.equal(out.droppedPredicateFieldIds, undefined);
});

ok("partially-authorized carries dropped columns + predicate count; frozen; ok=true", () => {
  const out = mapServiceOutcome({
    kind: "partially-authorized", objectId: "customer", rows: [], aggregates: null,
    rowCount: 0, rowCap: 10000, truncated: false, widened: true,
    droppedColumnLabels: ["Tax status"], droppedPredicateCount: 2,
  });
  assert.equal(out.kind, "partially-authorized");
  assert.equal(out.ok, true);
  assert.equal(out.widened, true);
  assert.equal(out.droppedPredicateCount, 2);
  assert.throws(() => { out.kind = "results"; }); // frozen
});

ok("permission-denied maps to ok=false with null rows", () => {
  const out = mapServiceOutcome({ kind: "permission-denied", rows: null });
  assert.equal(out.ok, false);
  assert.equal(out.kind, "permission-denied");
  assert.equal(out.rows, null);
});

ok("a malformed / unknown-kind payload fails closed to a safe failure", () => {
  for (const junk of [null, undefined, {}, { kind: "nonsense" }, 42, { kind: "results" /* no rows */ }]) {
    const out = mapServiceOutcome(junk);
    assert.ok(["failure", "results"].includes(out.kind));
    if (out.kind === "failure") assert.equal(out.ok, false);
  }
  // a non-array rows on `results` is normalized to null, not thrown
  const out = mapServiceOutcome({ kind: "results", rows: "oops" });
  assert.equal(out.rows, null);
});

ok("dropped labels are string-filtered so a malformed label can't inject", () => {
  const out = mapServiceOutcome({ kind: "partially-authorized", droppedColumnLabels: ["OK", { evil: 1 }, "", 5] });
  assert.deepEqual(out.droppedColumnLabels, ["OK"]);
});

// ---- callable error mapping ------------------------------------------------
ok("error codes map to safe outcomes; any unreachable/not-deployed error -> unavailable", () => {
  const cases = {
    // authorization + definition errors carry real meaning -> their own states
    "unauthenticated": "permission-denied",
    "permission-denied": "permission-denied",
    "invalid-argument": "unsupported",
    "failed-precondition": "unsupported",
    // not deployed / unreachable, however it surfaces -> unavailable-safe (indistinguishable codes)
    "not-found": "unavailable",           // missing production endpoint
    "functions/not-found": "unavailable", // code may be prefixed
    "internal": "unavailable",            // emulator down / transport failure / CORS
    "unavailable": "unavailable",
    "deadline-exceeded": "unavailable",
    "cancelled": "unavailable",
    "unknown": "unavailable",
    "": "unavailable",
  };
  for (const [code, kind] of Object.entries(cases)) {
    const out = mapCallableError({ code, message: "raw internal detail" });
    assert.equal(out.kind, kind, `${code} -> ${kind}`);
    assert.equal(out.ok, false);
  }
});

ok("the unavailable outcome is safe, frozen, and self-consistent", () => {
  const u = reportRunUnavailable();
  assert.equal(u.kind, "unavailable");
  assert.equal(u.reason, REPORT_RUN_UNAVAILABLE_REASON);
  assert.equal(u.rows, null);
  assert.doesNotMatch(u.message, RAW_LEAKS);
  assert.throws(() => { u.ok = true; });
  assert.deepEqual(mapCallableError({ code: "not-found" }), u);
});


// ============================================================================
// RPT-CLIENT -- the three outcome-honesty defects. Baseline:
// rpt/false-empty-and-audit @ 8521cd88 (chain 92db1d19 -> 64008d5a).
//
// Every expectation below is taken from the SERVER source in this same
// checkout, not from a description of it:
//   functions/src/reporting/reportExecutionService.ts   (RunReportOutcomeKind,
//     ScanCompleteness, UnprovenAbsenceError, judgeAbsenceProvenance)
//   functions/src/reporting/runReportDefinitionCallable.ts  (HttpsError codes)
// ============================================================================

// ---- Defect 1: SERVICE_KINDS was behind the server's closed kind set -------
//
// ENG-E added "company-unresolved": a TENANCY refusal deliberately DISTINCT
// from "permission-denied" so an operator cannot mistake it for a missing
// grant and go and grant a Role. At baseline it was absent from SERVICE_KINDS,
// so mapServiceOutcome() fell through to reportRunFailure() and the tenancy
// refusal rendered as a generic "something went wrong".
ok("a `company-unresolved` payload is RECOGNISED, not failed-closed into a generic failure", () => {
  const out = mapServiceOutcome({
    kind: "company-unresolved", objectId: "customer", rows: null, aggregates: null,
    rowCount: 0, rowCap: 10000, truncated: false,
    completeness: "not-attempted", scanTruncated: false, widened: false,
    droppedColumnLabels: [], droppedPredicateCount: 0,
    companyReach: [], rowScopeKind: "unresolved",
    companyBoundRefusal: "the runner holds the object read capability, but no operatingCompany-scoped binding resolves",
  });
  assert.equal(out.kind, "company-unresolved",
    "a kind the server can emit must not be swallowed as `failure` -- that loses the tenancy explanation");
  assert.equal(out.ok, false, "a refusal is not ok");
  assert.equal(out.rows, null);
});

ok("the server's refusal PROSE is never carried into the client outcome", () => {
  // companyBoundRefusal is audit-facing server prose (it names Firestore's `in`
  // limit, reach counts, binding vocabulary). It is not UI copy and must not
  // travel to a renderer that would print it.
  const out = mapServiceOutcome({
    kind: "company-unresolved", rows: null,
    companyBoundRefusal: "reach of 31 operating companies exceeds Firestore's 30-value `in` limit",
  });
  assert.equal(out.companyBoundRefusal, undefined);
  assert.doesNotMatch(JSON.stringify(out), /Firestore/i);
});

// ---- The orthogonal completeness axis must survive the mapper --------------
//
// completeness + scanTruncated are present on EVERY server outcome and are
// deliberately NOT kinds (the client ladder is single-winner and has already
// collapsed once). A mapper that drops them makes it impossible for any
// renderer to read them, which is the same collapse by another route.
ok("the completeness axis (completeness + scanTruncated) is carried through, never inferred", () => {
  const bounded = mapServiceOutcome({
    kind: "results", rows: [{ a: 1 }], rowCount: 1, rowCap: 10000,
    truncated: true, completeness: "bounded-page", scanTruncated: true,
  });
  assert.equal(bounded.completeness, "bounded-page");
  assert.equal(bounded.scanTruncated, true);

  const complete = mapServiceOutcome({
    kind: "results", rows: [{ a: 1 }], rowCount: 1, completeness: "proven-complete", scanTruncated: false,
  });
  assert.equal(complete.completeness, "proven-complete");
  assert.equal(complete.scanTruncated, false);

  // "not-attempted" means INAPPLICABLE -- a refusal that returned before any
  // collection read. It must survive verbatim; it must never become "complete".
  const refused = mapServiceOutcome({ kind: "company-unresolved", rows: null, completeness: "not-attempted" });
  assert.equal(refused.completeness, "not-attempted");
});

ok("a missing or unrecognised completeness is reported as UNKNOWN (null), never as proven-complete", () => {
  // Asserting completeness we were never told is the exact sin this lane exists
  // to remove. `null` is "the server did not say", which the renderer then
  // resolves conservatively from the truncation flags.
  const silent = mapServiceOutcome({ kind: "results", rows: [], rowCount: 0 });
  assert.equal(silent.completeness, null);
  const junk = mapServiceOutcome({ kind: "results", rows: [], completeness: "totally-fine" });
  assert.equal(junk.completeness, null);
});

// ---- Defect 2: the FACTUALLY FALSE one ------------------------------------
//
// runReportDefinitionCallable.ts maps BOTH server refusals --
// IncompleteAggregateScanError (the aggregate refusal that already shipped) and
// UnprovenAbsenceError (RPT-FIX) -- to HttpsError("resource-exhausted").
// At baseline mapCallableError() had no branch for it, so both landed in
// `default:` and produced reportRunUnavailable(), whose copy is, VERBATIM:
const BASELINE_FALSE_COPY = "Running reports isn't available yet. Nothing was read or changed.";
// For an unproven-absence refusal that sentence is FALSE: documents WERE read
// (the scan exceeded maxScanDocs, which is why the answer could not be proven).
// It also hides the one actionable instruction the server supplied: narrow the
// report.
ok("a `resource-exhausted` refusal must NOT claim \"Nothing was read or changed\" -- documents WERE read", () => {
  const out = mapCallableError({ code: "resource-exhausted", message: "raw server prose with \"customer\" in it" });
  assert.notEqual(out.kind, "unavailable",
    "the engine was reachable and it ran -- rendering this as \"not available yet\" is false");
  assert.notEqual(out.message, BASELINE_FALSE_COPY,
    "this is the baseline copy and it is factually wrong for a refusal: documents were read");
  assert.equal(out.ok, false);
  assert.equal(out.rows, null);
});

ok("the refusal outcome says what happened and what to do, without a raw code or server prose", () => {
  const out = mapCallableError({ code: "functions/resource-exhausted", message: "Aggregates for \"customer\" cannot be computed: the scan exceeded 20000 documents" });
  assert.equal(typeof out.message, "string");
  assert.ok(out.message.length > 0);
  // the two facts the user needs
  assert.match(out.message, /read/i, "must state that records WERE read");
  assert.match(out.message, /complete/i, "must state the answer could not be proven complete");
  // the one action the user can take
  assert.match(out.message, /narrow|filter/i, "must carry the actionable instruction");
  // and nothing from the wire
  assert.doesNotMatch(out.message, RAW_LEAKS);
  assert.doesNotMatch(out.message, /resource-exhausted/);
  assert.doesNotMatch(out.message, /20000|maxScanDocs|customer/);
});

ok("both server refusals share one code, so they share one client outcome", () => {
  // IncompleteAggregateScanError and UnprovenAbsenceError both throw
  // resource-exhausted (runReportDefinitionCallable.ts:95 and :106) and the
  // client cannot tell them apart -- so the copy must be true of BOTH.
  const a = mapCallableError({ code: "resource-exhausted" });
  const b = mapCallableError({ code: "functions/resource-exhausted" });
  assert.deepEqual(a, b);
});

console.log(`\n${passed} passed, 0 failed`);
