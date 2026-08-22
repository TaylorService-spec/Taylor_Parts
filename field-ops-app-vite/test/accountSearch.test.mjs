// Bounded Account name search — offline tests.
//
// The defect this replaces: /customers' old search box filtered an in-memory array
// supplied by a whole-collection subscription. Removing that subscription (the metadata
// list migration) would have left the box silently searching only the current page and
// reporting "no results" for a customer that exists. These tests assert the INTENDED
// behaviour of the replacement: no unbounded read path exists, a bounded result discloses
// its bound, prefix semantics are never described as substring/full-text search, and
// denied/unavailable/empty/idle stay four different facts.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  accountSearchQueryShape,
  interpretAccountSearchRead,
  ACCOUNT_SEARCH_CAP,
  ACCOUNT_SEARCH_STATE,
} from "../src/domain/accountSearch.js";
import { normalizeNameForSearch, withSearchableName } from "../src/domain/nameNormalization.js";

const docs = (n, from = 0) => Array.from({ length: n }, (_, i) => ({ id: `acct-${from + i}`, name: `Acme ${from + i}` }));

test("ACCOUNT_SEARCH_STATE is frozen and keeps every outcome distinct", () => {
  assert.ok(Object.isFrozen(ACCOUNT_SEARCH_STATE));
  for (const s of ["IDLE", "LOADING", "READY", "TRUNCATED", "EMPTY", "DENIED", "UNAVAILABLE"]) {
    assert.ok(ACCOUNT_SEARCH_STATE.includes(s));
  }
});

// --- no unbounded read path exists -------------------------------------------

test("a blank term produces NO query shape — a search box before typing does not read the whole collection", () => {
  assert.equal(accountSearchQueryShape({ term: "" }), null);
  assert.equal(accountSearchQueryShape({ term: "   " }), null);
  assert.equal(accountSearchQueryShape({}), null);
});

test("every non-blank query shape carries a limit — there is no argument that removes it", () => {
  const shape = accountSearchQueryShape({ term: "acme" });
  assert.ok(Number.isInteger(shape.limit));
  assert.ok(shape.limit > 0);
});

test("the limit is cap + 1, mirroring the truncation-probe convention used everywhere else", () => {
  const shape = accountSearchQueryShape({ term: "acme" });
  assert.equal(shape.cap, ACCOUNT_SEARCH_CAP);
  assert.equal(shape.limit, ACCOUNT_SEARCH_CAP + 1);
});

test("a caller may lower the cap, and the shape still carries cap + 1", () => {
  const shape = accountSearchQueryShape({ term: "acme", cap: 5 });
  assert.equal(shape.cap, 5);
  assert.equal(shape.limit, 6);
});

test("a search shape has no cursor, offset, or page — it narrows, it does not page", () => {
  const shape = accountSearchQueryShape({ term: "acme" });
  for (const k of ["cursor", "startAfter", "offset", "page"]) {
    assert.equal(k in shape, false, `${k} must not exist on a search read`);
  }
});

// --- prefix semantics, never described as substring/full-text ---------------

test("the range is a PREFIX bound on the typed term — start is the term itself", () => {
  const shape = accountSearchQueryShape({ term: "acme" });
  // The range runs over the NORMALIZED copy, not the display name. Firestore compares UTF-16 code
  // units, so a query against `name` could never match a differently-cased record.
  assert.equal(shape.fieldPath, "nameLower");
  assert.equal(shape.start, "acme");
});

test("the range end is the term plus the private-use sentinel, not a wildcard or substring marker", () => {
  const shape = accountSearchQueryShape({ term: "acme" });
  assert.ok(shape.end.startsWith("acme"));
  assert.equal(shape.end.length, "acme".length + 1);
  assert.equal(shape.end.codePointAt(shape.end.length - 1), 0xf8ff);
});

test("the term is trimmed before it becomes the range bound", () => {
  const shape = accountSearchQueryShape({ term: "  acme  " });
  assert.equal(shape.start, "acme");
  assert.ok(shape.end.startsWith("acme"));
});

test("the shape is ordered by the same field the range filters — no composite index is required", () => {
  const shape = accountSearchQueryShape({ term: "acme" });
  assert.deepEqual(shape.orderBy, [{ fieldPath: "nameLower", direction: "ASC" }]);
});

// --- bounded results, disclosed truncation -----------------------------------

test("IDLE: no term means no query and no claim about results", () => {
  const r = interpretAccountSearchRead({ term: "" });
  assert.equal(r.state, "IDLE");
  assert.deepEqual(r.results, []);
  assert.equal(r.message, null);
});

test("LOADING offers no results while a query is in flight", () => {
  const r = interpretAccountSearchRead({ term: "acme", loading: true, docs: docs(3) });
  assert.equal(r.state, "LOADING");
  assert.deepEqual(r.results, []);
});

test("a read under the cap is READY — this is the common case and must be invisible", () => {
  const r = interpretAccountSearchRead({ term: "acme", docs: docs(3) });
  assert.equal(r.state, "READY");
  assert.equal(r.results.length, 3);
  assert.equal(r.truncated, false);
  assert.equal(r.message, null);
});

test("a read exactly AT the cap is not truncated", () => {
  const r = interpretAccountSearchRead({ term: "acme", docs: docs(ACCOUNT_SEARCH_CAP) });
  assert.equal(r.state, "READY");
  assert.equal(r.results.length, ACCOUNT_SEARCH_CAP);
  assert.equal(r.truncated, false);
});

test("the probe row is dropped, never offered as a result", () => {
  const r = interpretAccountSearchRead({ term: "acme", docs: docs(ACCOUNT_SEARCH_CAP + 1) });
  assert.equal(r.results.length, ACCOUNT_SEARCH_CAP);
  assert.equal(r.results.at(-1).id, `acct-${ACCOUNT_SEARCH_CAP - 1}`);
});

test("truncation is DISCLOSED, not hidden behind a plain result list", () => {
  const r = interpretAccountSearchRead({ term: "acme", docs: docs(ACCOUNT_SEARCH_CAP + 40) });
  assert.equal(r.state, "TRUNCATED");
  assert.equal(r.truncated, true);
  assert.match(r.message, new RegExp(`first ${ACCOUNT_SEARCH_CAP}`));
});

test("the truncation message says what to do, not only what happened", () => {
  const r = interpretAccountSearchRead({ term: "acme", docs: docs(ACCOUNT_SEARCH_CAP + 1) });
  assert.match(r.message, /narrow/i);
});

test("EMPTY is a genuine zero-result search, and is distinct from IDLE and TRUNCATED", () => {
  const empty = interpretAccountSearchRead({ term: "zzz-no-such-prefix", docs: [] });
  assert.equal(empty.state, "EMPTY");
  assert.match(empty.message, /no customer/i);

  const idle = interpretAccountSearchRead({ term: "" });
  assert.notEqual(idle.state, empty.state);

  const truncated = interpretAccountSearchRead({ term: "acme", docs: docs(ACCOUNT_SEARCH_CAP + 1) });
  assert.notEqual(truncated.state, empty.state);
});

test("the EMPTY message names the searched term, never implies a broader search happened", () => {
  const r = interpretAccountSearchRead({ term: "zephyr", docs: [] });
  assert.match(r.message, /zephyr/);
  assert.doesNotMatch(r.message, /contain/i);
});

// --- denied, unavailable, and empty stay distinct facts ----------------------

test("a permission-denied read is DENIED, not UNAVAILABLE, and never reads as EMPTY", () => {
  const err = new Error("permission denied");
  err.code = "permission-denied";
  const r = interpretAccountSearchRead({ term: "acme", error: err });
  assert.equal(r.state, "DENIED");
  assert.deepEqual(r.results, []);
  assert.doesNotMatch(r.message, /no customer/i);
});

test("any other failed read is UNAVAILABLE, distinct from DENIED", () => {
  const r = interpretAccountSearchRead({ term: "acme", error: new Error("offline") });
  assert.equal(r.state, "UNAVAILABLE");
  assert.notEqual(r.state, "DENIED");
});

test("a missing result (docs null/undefined, no error, not loading) is UNAVAILABLE, not EMPTY", () => {
  assert.equal(interpretAccountSearchRead({ term: "acme", docs: null }).state, "UNAVAILABLE");
  assert.equal(interpretAccountSearchRead({ term: "acme" }).state, "UNAVAILABLE");
});

test("no state except READY and TRUNCATED ever offers results", () => {
  const err = new Error("x");
  const cases = [
    { term: "acme", loading: true, docs: docs(5) },
    { term: "acme", error: err },
    { term: "acme", docs: [] },
    { term: "acme", docs: null },
    { term: "" },
  ];
  for (const args of cases) {
    const r = interpretAccountSearchRead(args);
    assert.deepEqual(r.results, [], `${r.state} must offer nothing`);
  }
});

test("the four failure/absence facts are pairwise distinct states", () => {
  const err = new Error("permission denied");
  err.code = "permission-denied";
  const denied = interpretAccountSearchRead({ term: "acme", error: err }).state;
  const unavailable = interpretAccountSearchRead({ term: "acme", error: new Error("x") }).state;
  const empty = interpretAccountSearchRead({ term: "acme", docs: [] }).state;
  const idle = interpretAccountSearchRead({ term: "" }).state;
  const states = new Set([denied, unavailable, empty, idle]);
  assert.equal(states.size, 4, `expected 4 distinct states, got ${[...states].join(", ")}`);
});

// --- case-insensitivity ------------------------------------------------------
//
// The defect: typing "mesquite" reported "No customer names start with mesquite" while Mesquite
// Soda Works was visible on the same screen. Firestore has no case-insensitive comparison, so this
// is a property of what gets STORED and what the term is folded to -- both through one function.

test("every casing of a term produces the SAME range bound", () => {
  const bounds = ["mesquite", "MESQUITE", "Mesquite", "MeSqUiTe"].map((t) => accountSearchQueryShape({ term: t }));
  for (const b of bounds) {
    assert.equal(b.start, "mesquite", "the term must be folded to match the stored normalized name");
    assert.equal(b.fieldPath, "nameLower");
  }
});

test("the folded term is what the WRITER would have stored", () => {
  // Ties the read contract to the write contract. Two sides folding consistently but differently
  // from the writer is the silent-failure mode this guards against, and it would not show up in
  // any test that only compares the read path to itself.
  const stored = withSearchableName("Mesquite Soda Works");
  const shape = accountSearchQueryShape({ term: "MESQUITE" });
  assert.ok(
    stored.nameLower.startsWith(shape.start),
    `stored ${JSON.stringify(stored.nameLower)} must fall inside the range starting at ${JSON.stringify(shape.start)}`,
  );
  assert.equal(stored.name, "Mesquite Soda Works", "the DISPLAY name must be untouched by normalization");
  assert.equal(normalizeNameForSearch("  Mesquite  "), "mesquite", "surrounding whitespace is not meaningful");
});

test("prefix semantics are unchanged -- this is a casing fix, not a widening", () => {
  // "starts with" must not quietly start meaning "contains" as a side effect.
  const shape = accountSearchQueryShape({ term: "soda" });
  assert.equal(shape.start, "soda");
  assert.equal(shape.end.codePointAt(shape.end.length - 1), 0xf8ff);
  assert.equal(shape.end.length, "soda".length + 1);
});

test("a whitespace-only term still issues no query", () => {
  assert.equal(accountSearchQueryShape({ term: "   " }), null);
});
