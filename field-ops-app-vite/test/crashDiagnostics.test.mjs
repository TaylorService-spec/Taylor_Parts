// THE NEXT CRASH CAN DESCRIBE ITSELF.
// Run: node --test test/crashDiagnostics.test.mjs
//
// ════════════════════ WHY THIS EXISTS ════════════════════
//
// A user reproduced the root error boundary in sandbox twice while the automated harness could not:
// 63 routes, 15 driver accounts, 12 real sandbox personas, an interaction suite and a throttled race
// suite all came back clean. The boundary said only "Something went wrong", so the occurrence that
// DID happen carried no route, no build, no persona and no stack.
//
// A crash nobody can reproduce and nobody can describe is a rumour, not a bug report. These cases
// hold the two halves that turn the next one into evidence: it captures enough to act on, and it
// captures nothing it should not have.

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCrashDiagnostic,
  recordNavigation,
  recordIdentity,
  resetCrashDiagnostics,
  diagnosticsVisible,
  formatCrashSummary,
} from "../src/diagnostics/crashDiagnostics.js";

const location = { pathname: "/customers/opportunities", search: "?view=all", hash: "" };
const anError = Object.assign(new TypeError("Cannot read properties of undefined (reading 'map')"), {
  stack: "TypeError: Cannot read properties of undefined (reading 'map')\n    at SalesWorkspace (index.js:1:1)\n    at renderWithHooks",
});
const build = (opts = {}) => buildCrashDiagnostic(anError, "\n    at SalesWorkspace\n    at Routes", { location, ...opts });

test.beforeEach(() => resetCrashDiagnostics());

// ═════════════════════════════════════════ enough to act on

test("IT CAPTURES THE SIX THINGS NEEDED TO REPRODUCE", () => {
  recordNavigation("/customers");
  recordNavigation("/customers/opportunities?view=all");
  recordIdentity({ signedIn: true, role: "salesperson" });
  const d = build();

  assert.match(d.crashId, /^[A-Z0-9]{5}-[A-Z0-9]{4}$/, "a short id a person can read from a screenshot");
  assert.equal(d.route.pathname, "/customers/opportunities");
  assert.equal(d.route.search, "?view=all");
  assert.equal(d.route.previous, "/customers", "where they came from");
  assert.equal(d.identity.role, "salesperson");
  assert.equal(d.error.name, "TypeError");
  assert.match(d.error.message, /reading 'map'/);
  assert.match(d.error.stack, /at SalesWorkspace/);
  assert.match(d.componentStack, /at SalesWorkspace/);
  assert.ok(d.at, "a timestamp");
  assert.ok(d.commit, "the build it happened on");
});

test("the trail is BOUNDED and free of consecutive duplicates", () => {
  // A re-render must not flood it, and it must never grow into a session recorder.
  for (const r of ["/a", "/a", "/a", "/b", "/c", "/d", "/e", "/f", "/g"]) recordNavigation(r);
  const d = build();
  assert.ok(d.route.trail.length <= 5, `trail must stay bounded, got ${d.route.trail.length}`);
  assert.deepEqual(d.route.trail, ["/c", "/d", "/e", "/f", "/g"], "newest last");
});

test("two crashes never share an id", () => {
  const ids = new Set(Array.from({ length: 200 }, () => build().crashId));
  assert.equal(ids.size, 200);
});

test("THE SUMMARY IS ACTIONABLE ON ITS OWN, so a console screenshot is enough", () => {
  recordNavigation("/customers/opportunities?view=all");
  recordIdentity({ signedIn: true, role: "admin" });
  const d = build();
  const line = formatCrashSummary(d);
  assert.match(line, new RegExp(d.crashId));
  assert.match(line, /TypeError/);
  assert.match(line, /\/customers\/opportunities/);
  assert.match(line, /role=admin/);
});

// ═════════════════════════════════════════ nothing it should not have

test("IT COLLECTS NO CREDENTIAL, TOKEN, BODY OR FORM CONTENT — by construction", () => {
  // Not "filtered out" -- never gathered. A diagnostic that scraped the page would leak exactly the
  // commercial data the governed read boundaries exist to protect, into a clipboard and a console.
  recordNavigation("/customers/opportunities");
  recordIdentity({ signedIn: true, role: "salesperson" });
  const keys = Object.keys(build()).sort();
  assert.deepEqual(keys, [
    "at", "commit", "componentStack", "crashId", "environment", "error", "identity", "phase", "route", "viewport",
  ]);
  for (const forbidden of ["token", "idToken", "accessToken", "password", "uid", "body", "request", "response", "formValues", "payload", "headers"]) {
    assert.equal(forbidden in build(), false, `${forbidden} must never be collected`);
  }
});

test("IDENTITY IS THE ROLE, NEVER THE PERSON", () => {
  // A role reproduces a crash; a uid identifies a human and reproduces nothing extra.
  recordIdentity({ signedIn: true, role: "dispatcher", uid: "abc123", email: "someone@example.com" });
  const d = build();
  assert.deepEqual(Object.keys(d.identity).sort(), ["role", "signedIn"]);
  assert.equal(JSON.stringify(d).includes("abc123"), false, "a uid must not survive into the payload");
  assert.equal(JSON.stringify(d).includes("example.com"), false, "an email must not survive into the payload");
});

test("a non-string role or an odd identity cannot smuggle an object in", () => {
  recordIdentity({ signedIn: "yes", role: { name: "admin", secret: "x" } });
  const d = build();
  assert.equal(d.identity.signedIn, false, "only a real boolean counts as signed in");
  assert.equal(d.identity.role, null, "a non-string role is dropped, not stringified");
  assert.equal(JSON.stringify(d).includes("secret"), false);
});

test("the message and stack are BOUNDED", () => {
  const huge = Object.assign(new Error("x".repeat(5000)), { stack: Array.from({ length: 200 }, (_, i) => `    at frame${i}`).join("\n") });
  const d = buildCrashDiagnostic(huge, Array.from({ length: 200 }, (_, i) => `    at Component${i}`).join("\n"), { location });
  assert.ok(d.error.message.length <= 500, "a runaway message cannot become the payload");
  assert.ok(d.error.stack.split("\n").length <= 20, "enough frames to locate the throw, not the whole bundle");
  assert.ok(d.componentStack.split("\n").length <= 20);
});

// ═════════════════════════════════════════ where it may be shown

test("PRODUCTION SHOWS NO INTERNALS", () => {
  // A stack on a production screen is an invitation to paste internals into a support channel, and
  // nothing in this repository permits that. The console output is unchanged either way.
  assert.equal(diagnosticsVisible({ role: "production" }), false);
  assert.equal(diagnosticsVisible({ role: "sandbox" }), true);
  assert.equal(diagnosticsVisible({ role: "integration" }), true);
  // Fail CLOSED on an unknown or missing environment: a build that cannot say what it is does not
  // get to show internals.
  assert.equal(diagnosticsVisible(null), false);
  assert.equal(diagnosticsVisible({}), false);
});

test("IT NEVER THROWS while describing a crash", () => {
  // The diagnostic must never become the reason a crash screen cannot render.
  assert.doesNotThrow(() => buildCrashDiagnostic(undefined, undefined, { location: undefined }));
  assert.doesNotThrow(() => buildCrashDiagnostic(null, null, { location: null }));
  assert.doesNotThrow(() => buildCrashDiagnostic("a string, not an Error", 42, { location }));
  const d = buildCrashDiagnostic(null, null, { location: null });
  assert.equal(d.error.name, "Error");
  assert.equal(d.route.pathname, null);
  assert.ok(d.crashId, "an id is still issued, so the occurrence is still matchable");
});

test("the boundary renders the id and the copy control, and only outside production", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/components/ErrorBoundary.jsx", import.meta.url), "utf8");
  assert.match(src, /Crash ID:/);
  assert.match(src, /Copy diagnostic/);
  assert.match(src, /diagnosticsVisible\(\)/, "the control is gated on the environment");
  // The original developer channel must survive — it is what every existing report relies on.
  assert.match(src, /console\.error\("UI Crash:", error/);
  // And the boundary must not put the stack itself on screen.
  assert.doesNotMatch(src, /\{diagnostic\.error\.stack\}/);
  assert.doesNotMatch(src, /\{diagnostic\.componentStack\}/);
});
