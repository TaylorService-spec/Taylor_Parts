// M23 blind-count remediation -- OFFLINE tests for the pure cycle-count-action error/outcome mapping,
// including the new separation-of-duties message pass-through and the approve/reject wording split.
import assert from "node:assert/strict";
import { mapCycleCountActionError, describeCycleCountOutcome } from "../src/domain/cycleCountActionResult.js";

let passed = 0;
function check(name, fn) { fn(); passed += 1; console.log(`  ok - ${name}`); }
console.log("cycleCountActionResult.test.mjs");

check("known HttpsError codes map to honest, bounded messages", () => {
  assert.equal(mapCycleCountActionError({ code: "not-found" }), "That cycle count could not be found.");
  assert.equal(mapCycleCountActionError({ code: "failed-precondition" }).includes("not currently permitted"), true);
  assert.equal(mapCycleCountActionError({ code: "unauthenticated" }), "You must be signed in to do this.");
});

check("unknown/malformed error -> generic bounded message, never raw error text", () => {
  assert.equal(mapCycleCountActionError({ code: "weird-unknown-code" }), "The cycle count action could not be completed.");
  assert.equal(mapCycleCountActionError(new Error("some raw internal detail")), "The cycle count action could not be completed.");
  assert.equal(mapCycleCountActionError(null), "The cycle count action could not be completed.");
});

check("permission-denied WITHOUT a server message -> the generic fixed-table text (fallback still bounded)", () => {
  assert.equal(mapCycleCountActionError({ code: "permission-denied" }), "You are not authorized to perform this cycle count action.");
  assert.equal(mapCycleCountActionError({ code: "permission-denied", message: "" }), "You are not authorized to perform this cycle count action.");
});

check("permission-denied WITH a server message -- e.g. the M23 separation-of-duties refusal -- surfaces the SPECIFIC text, not the generic one", () => {
  const specific = "You submitted this count and cannot approve or reject its own material variance -- a different manager must review it.";
  assert.equal(mapCycleCountActionError({ code: "permission-denied", message: specific }), specific);
  assert.equal(
    mapCycleCountActionError({ code: "functions/permission-denied", message: specific }),
    specific,
    "the functions/ prefix Firebase sometimes adds to err.code must not defeat the lookup",
  );
});

check("a NON-permission-denied code ignores err.message even when present (only permission-denied is disambiguated)", () => {
  assert.equal(mapCycleCountActionError({ code: "not-found", message: "some other server text" }), "That cycle count could not be found.");
});

check("describeCycleCountOutcome: create/submit/cancel keep their pre-M23 wording", () => {
  assert.equal(describeCycleCountOutcome("create", "applied"), "Cycle count created.");
  assert.equal(describeCycleCountOutcome("create", "replayed"), "Already created (no change made).");
  assert.equal(describeCycleCountOutcome("submit", "applied"), "Cycle count recorded.");
  assert.equal(describeCycleCountOutcome("cancel", "applied"), "Cycle count cancelled.");
});

check("describeCycleCountOutcome: reconcile wording now depends on decision (APPROVE vs REJECT), M23 addition", () => {
  assert.equal(describeCycleCountOutcome("reconcile", "applied", "APPROVE"), "Cycle count approved.");
  assert.equal(describeCycleCountOutcome("reconcile", "replayed", "APPROVE"), "Already approved (no change made).");
  assert.equal(describeCycleCountOutcome("reconcile", "applied", "REJECT"), "Cycle count rejected.");
  assert.equal(describeCycleCountOutcome("reconcile", "replayed", "REJECT"), "Already rejected (no change made).");
});

console.log(`${passed} passed`);
