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

  assert.match(d.crashId, /^[A-Z0-9]{5}-[A-Z0-9]{6}$/, "a short id a person can read from a screenshot");
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

// THIS TEST USED TO FAIL ABOUT ONE CI RUN IN NINETY-FOUR, and it was right to.
//
// The id tail was four base-36 characters from Math.random() -- about 1.68 million values, which
// is a birthday problem 200 draws is enough to lose: 1.06% of 200-draw runs collided, measured
// over 20,000 simulations. The flake was the visible half; the real defect was that the invariant
// above was never held, and this id exists so ONE screenshot names ONE occurrence.
//
// A larger sample would only have made the flake likelier, so the guard is on the ENTROPY itself.
//
// ════════════════════ AND FOR A WHILE IT SAID THAT WHILE STILL SAMPLING ════════════════════
//
// The widened tail was guarded by drawing 5000 REAL ids and asserting 5000 distinct tails. That is
// the same birthday problem one keyspace further out, not a check on entropy: six base-36
// characters is 36^6 = 2,176,782,336 values, C(5000,2) = 12,497,500 pairs, so ~0.0058 expected
// collisions and P(at least one) = 0.58% -- one run in 174. Measured by replaying that exact
// assertion 4000 times: 30 failures, 0.75%, every one of them "expected 5000, actual 4999".
//
// A check that fails 0.6% of legitimate runs from position 31 of a 290-suite manifest is a
// reliability defect on its own terms, and raising the tolerance to "at most one collision" would
// only move the cliff. So the guard below is on the entropy, and it is DETERMINISTIC: the random
// source is injected, a known sequence is driven through it, and distinctness is asserted exactly.
// There is no randomness left in it to be unlucky with, and it proves strictly more than the
// sampled version did --
//   * the tail is six wide for EVERY value the source can return, including 0, where the sampled
//     loop could only ever fail to notice a short draw;
//   * the generator consumes crypto.getRandomValues and NOT Math.random -- the claim the module
//     makes in prose, which nothing used to check;
//   * distinct draws give distinct tails: injectivity, rather than an absence of observed
//     collisions;
//   * all 36 symbols are reachable in every position, so the keyspace really is 36^6.
//
// The residual real-world risk is then arithmetic instead of sampling. At 200 crashes being
// compared, P(two share an id) = 9.2e-6 -- one in 108,655, against one in 94 before.
//
// ════════════════════ ONE CORRECTION, found while making this deterministic ════════════════════
//
// randomTail draws 32 bits and encodes them `.padStart(6,"0").slice(-6)`, and 2^32 > 36^6, so any
// draw at or above 36^6 silently loses its leading base-36 character. The effective keyspace is
// 36^6 and not 2^32, and the fold is slightly non-uniform: 2,118,184,960 tails are twice as likely
// as the remaining 58,597,376, a 0.67% excess pair-collision rate over uniform. So the module's own
// "under one in ten million at 200 draws" is wrong -- the true figure is the one in 108,655 above.
// Both numbers are far beyond practical concern and the module is left alone, but the keyspace
// below is asserted from the generator's behaviour rather than taken from the comment.

/** The alphabet, width and keyspace the tail actually has. Asserted below, not assumed. */
const TAIL_WIDTH = 6;
const TAIL_SYMBOLS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const TAIL_KEYSPACE = TAIL_SYMBOLS.length ** TAIL_WIDTH; // 36^6 = 2,176,782,336

const realCryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
function restoreCrypto() {
  if (realCryptoDescriptor) Object.defineProperty(globalThis, "crypto", realCryptoDescriptor);
  else delete globalThis.crypto;
}

/**
 * Run `body` with the id generator's entropy source replaced by a known one.
 *
 * This is the whole reason the check below can be deterministic: randomTail reads
 * `globalThis.crypto` at call time, so the source is injectable from the outside and the module
 * needs no test seam of its own.
 */
function withRandomSource(getRandomValues, body) {
  Object.defineProperty(globalThis, "crypto", { value: { getRandomValues }, configurable: true, writable: true });
  try {
    return body();
  } finally {
    restoreCrypto();
  }
}

/** The tails the generator produces for a known sequence of 32-bit draws, in order. */
function tailsFrom(values) {
  let i = 0;
  return withRandomSource(
    (buf) => {
      buf[0] = values[i++];
      return buf;
    },
    () => values.map(() => build().crashId.split("-")[1]),
  );
}
const tailFor = (value) => tailsFrom([value])[0];

test("the tail is a FIXED SIX CHARACTERS for every value the source can return", () => {
  // The sampled version asserted the width 5000 times and still could not reach the value that
  // would break it. These are the boundaries of the encoding, driven directly.
  const edges = [0, 1, 35, 36, 1295, 1296, 36 ** 4 - 1, 36 ** 5, TAIL_KEYSPACE - 1, TAIL_KEYSPACE, 2 ** 32 - 1];
  const tails = tailsFrom(edges);
  for (let i = 0; i < edges.length; i += 1) {
    assert.equal(tails[i].length, TAIL_WIDTH, `draw ${edges[i]} gave a ${tails[i].length}-character tail`);
    assert.match(tails[i], /^[A-Z0-9]{6}$/, `draw ${edges[i]} left the alphabet: "${tails[i]}"`);
  }
  assert.equal(tailFor(0), "000000", "a zero draw must pad, never shorten the id a person reads out");
  assert.equal(tailFor(TAIL_KEYSPACE - 1), "ZZZZZZ", "and the top of the keyspace is the top of the alphabet");
});

test("the entropy IS crypto.getRandomValues — one 32-bit draw per id, and never Math.random", () => {
  // The module's stated reason for existing is that Math.random was too narrow. Nothing checked
  // that the replacement is what actually gets consumed.
  const draws = [];
  const realRandom = Math.random;
  let mathRandomCalls = 0;
  Math.random = () => {
    mathRandomCalls += 1;
    return realRandom();
  };
  try {
    const tails = withRandomSource(
      (buf) => {
        draws.push(`${buf.constructor.name}:${buf.length}`);
        buf[0] = 7;
        return buf;
      },
      () => [build().crashId.split("-")[1], build().crashId.split("-")[1]],
    );
    assert.deepEqual(draws, ["Uint32Array:1", "Uint32Array:1"], "one 32-bit CSPRNG draw per crash id");
    assert.deepEqual(tails, ["000007", "000007"], "and the tail is that draw encoded, not something else");
    assert.equal(mathRandomCalls, 0, "Math.random is the crypto-less fallback only, never the source");
  } finally {
    Math.random = realRandom;
  }
});

test("10000 distinct draws give 10000 distinct tails — injectivity, not luck", () => {
  // This replaces "5000 real ids, hope none collide". Same statement about the product, zero
  // chance of failing on a legitimate run: the draws are distinct by construction, so a duplicate
  // tail can only mean the generator folded two occurrences onto one id.
  const sequential = Array.from({ length: 5000 }, (_, i) => i);
  const step = Math.floor((TAIL_KEYSPACE - 5000) / 5000);
  const spread = Array.from({ length: 5000 }, (_, i) => 5000 + i * step);
  const draws = [...sequential, ...spread];
  assert.equal(new Set(draws).size, draws.length, "the driven draws are themselves distinct");
  const tails = tailsFrom(draws);
  assert.equal(tails.length, 10000);
  assert.equal(new Set(tails).size, 10000, "two different occurrences must never be named the same id");
});

test("THE KEYSPACE IS 36^6 AND EVERY SYMBOL OF IT IS REACHABLE", () => {
  // "The generator draws across the full alphabet", proved by construction instead of by watching
  // 30000 real characters and trusting that a missing symbol would have shown up.
  const lowDigits = tailsFrom(Array.from({ length: 36 }, (_, s) => s)).map((t) => t[TAIL_WIDTH - 1]);
  assert.equal(lowDigits.join(""), TAIL_SYMBOLS, "the low digit walks the whole alphabet, in order");
  const highDigits = tailsFrom(Array.from({ length: 36 }, (_, s) => s * 36 ** (TAIL_WIDTH - 1))).map((t) => t[0]);
  assert.equal(highDigits.join(""), TAIL_SYMBOLS, "and so does the high digit");
  assert.equal(TAIL_SYMBOLS.length ** TAIL_WIDTH, 2176782336);
  assert.ok(
    TAIL_KEYSPACE >= 2 ** 31,
    `one screenshot must name one occurrence out of at least 2^31; the tail offers ${TAIL_KEYSPACE}`,
  );
});

test("the encoding is the low six base-36 digits, which is WHY the keyspace is 36^6 and not 2^32", () => {
  // 32 bits go in and 36^6 come out, because `.slice(-6)` drops the leading character of any draw
  // at or above 36^6. Pinned here so the keyspace above is a measured property of this generator
  // and not a claim: widening the tail must break this and force the arithmetic to be redone.
  const encode = (v) => (v % TAIL_KEYSPACE).toString(36).toUpperCase().padStart(TAIL_WIDTH, "0");
  const probes = [0, 7, 12345, TAIL_KEYSPACE - 1, TAIL_KEYSPACE, TAIL_KEYSPACE + 7, 2 ** 32 - 1];
  assert.deepEqual(tailsFrom(probes), probes.map(encode));
  assert.equal(tailFor(2 ** 32 - 1), "Z141Z3", "the widest draw folds to its low six digits");
});

test("with no crypto at all the id is still well formed, so the crash handler cannot become the crash", () => {
  // The fallback is weaker entropy on purpose: a runtime without crypto would otherwise throw
  // INSIDE the crash handler and turn a reported crash into a silent one. What must still hold is
  // the SHAPE, or the id stops being something a person can read off a screenshot.
  const realRandom = Math.random;
  try {
    delete globalThis.crypto;
    for (const r of [0, 0.5, 0.999999999, 1 / 36 ** 7]) {
      Math.random = () => r;
      const id = build().crashId;
      assert.match(id, /^[A-Z0-9]{5}-[A-Z0-9]{6}$/, `Math.random()=${r} produced "${id}"`);
    }
  } finally {
    Math.random = realRandom;
    restoreCrypto();
  }
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

  // THE BOUNDARY MUST ACTUALLY BUILD THE DIAGNOSTIC, not merely import the builder.
  //
  // It did exactly that for one deploy: the import and the render branch shipped while the
  // componentDidCatch edit silently failed to apply, so `diagnostic` was always null, the crash id
  // never rendered, and the copy control never appeared. Importing a function is not calling it —
  // and the assertions here passed throughout, because they only asked whether the file MENTIONED
  // the right things.
  assert.match(src, /componentDidCatch\([\s\S]*?buildCrashDiagnostic\(/, "componentDidCatch must build the diagnostic");
  assert.match(src, /componentDidCatch\([\s\S]*?this\.setState\(\{ diagnostic \}\)/, "and store it, or nothing can render it");
  assert.match(src, /diagnostic: null, copied: false/, "the constructor must seed both fields");
  assert.match(src, /this\.handleCopy = this\.handleCopy\.bind\(this\)/, "the copy handler must be bound");
  assert.match(src, /async handleCopy\(\)/, "and must exist");
  // And the boundary must not put the stack itself on screen.
  assert.doesNotMatch(src, /\{diagnostic\.error\.stack\}/);
  assert.doesNotMatch(src, /\{diagnostic\.componentStack\}/);
});
