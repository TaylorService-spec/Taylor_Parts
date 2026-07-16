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

console.log(`\n${passed} passed, 0 failed`);
