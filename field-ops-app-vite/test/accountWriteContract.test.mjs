// EVERY WRITER OF A CUSTOMER NAME MAINTAINS THE DERIVED SEARCH NAME.
// Run: node --test test/accountWriteContract.test.mjs
//
// ============================ WHY A STRUCTURAL TEST ============================
//
// `nameLower` is a derived field: customer search queries it because Firestore cannot compare
// case-insensitively. A derived field is only as good as its WEAKEST writer -- one path that sets
// `name` without setting `nameLower` makes that customer permanently unfindable by search, and the
// symptom ("search sometimes misses things") points nowhere near the cause.
//
// Testing the two current writers behave correctly is necessary and not sufficient: the real risk
// is the writer added next year by someone who never learns this field exists. So this asserts the
// SHAPE of the code -- that the accounts collection is written from one module, and that module
// derives the field -- rather than only the behaviour of the writers that happen to exist today.
//
// This is the same class of guard as the query-contract check: the failure it prevents is silent,
// and by the time it is visible the data is already wrong.
import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { normalizeNameForSearch, withSearchableName, SEARCH_NAME_FIELD } from "../src/domain/nameNormalization.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(here, "../src");

/** The one module permitted to write the accounts collection. */
const CANONICAL_WRITER = path.join("domain", "accounts.js");

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.(js|jsx)$/.test(entry)) out.push(p);
  }
  return out;
}

// --- the normalization itself ------------------------------------------------

test("normalization is deterministic, case-folding, and whitespace-trimming", () => {
  for (const v of ["Mesquite Soda Works", "MESQUITE SODA WORKS", "  Mesquite Soda Works  "]) {
    assert.equal(normalizeNameForSearch(v), "mesquite soda works");
  }
  // Internal spacing and punctuation are PRESERVED: folding them would widen what "starts with"
  // means, and the search contract is a prefix range, not a fuzzy match.
  assert.equal(normalizeNameForSearch("Handel's Homemade"), "handel's homemade");
  assert.equal(normalizeNameForSearch("A  B"), "a  b");
});

test("absent or non-string names normalize to an empty string, never to undefined", () => {
  // The value is written to a field that queries ORDER BY, and Firestore silently excludes
  // documents missing the ordered field. Returning undefined would let a caller skip the write and
  // reintroduce the exact invisibility this field exists to prevent.
  for (const v of [undefined, null, 42, {}, ""]) assert.equal(normalizeNameForSearch(v), "");
});

test("withSearchableName pairs the display name with its derived copy, unchanged", () => {
  const out = withSearchableName("Mesquite Soda Works");
  assert.equal(out.name, "Mesquite Soda Works", "the DISPLAY name must never be normalized");
  assert.equal(out[SEARCH_NAME_FIELD], "mesquite soda works");
});

// --- the writers -------------------------------------------------------------

test("both canonical writers derive the field, and neither does it at the call site", () => {
  // Derivation lives IN the writer so a caller cannot forget what it never had to remember.
  const src = readFileSync(path.join(srcDir, CANONICAL_WRITER), "utf8");
  const create = src.match(/export function createAccount[\s\S]*?\n\}/);
  const update = src.match(/export function updateAccount[\s\S]*?\n\}/);
  assert.ok(create, "createAccount not found -- this guard's premise has expired");
  assert.ok(update, "updateAccount not found -- this guard's premise has expired");
  assert.match(create[0], /withDerivedSearchName/, "createAccount writes a name without deriving nameLower");
  assert.match(update[0], /withDerivedSearchName/, "updateAccount writes a name without deriving nameLower");
});

test("a partial update that does not touch the name must not clobber the derived field", () => {
  // Deriving unconditionally would write nameLower:"" for any status-only edit, silently removing
  // that customer from search. The writer must skip derivation when `name` is absent -- asserted
  // here against the source, since the branch is what matters.
  const src = readFileSync(path.join(srcDir, CANONICAL_WRITER), "utf8");
  const fn = src.match(/function withDerivedSearchName[\s\S]*?\n\}/);
  assert.ok(fn, "withDerivedSearchName not found");
  assert.match(fn[0], /"name" in data/, "the derivation must be conditional on the payload carrying a name");
});

// --- the structural invariant ------------------------------------------------

test("no module outside the canonical writer writes the accounts collection", () => {
  // The guard that survives new code: a second writer is how the derived field goes stale.
  const offenders = [];
  const WRITE = /\b(addDoc|setDoc|updateDoc)\s*\(/;

  for (const file of sourceFiles(srcDir)) {
    const rel = path.relative(srcDir, file);
    if (rel === CANONICAL_WRITER) continue;
    const text = readFileSync(file, "utf8");
    if (!WRITE.test(text)) continue;
    // Only flag a writer that also references the accounts collection.
    if (!/ACCOUNTS_COLLECTION|["'`]accounts["'`]/.test(text)) continue;
    offenders.push(rel);
  }

  assert.deepEqual(
    offenders,
    [],
    "These modules write Firestore and reference the accounts collection. If any of them writes a "
      + "customer NAME it must derive nameLower, or that customer becomes unfindable by search. "
      + "Route the write through domain/accounts.js:\n  " + offenders.join("\n  "),
  );
});

test("MUTATION: the structural sweep can actually fail", () => {
  // Proves the sweep is looking at real files with a real pattern, rather than passing because it
  // silently matched nothing -- the failure mode of every allowlist-shaped guard.
  const files = sourceFiles(srcDir);
  assert.ok(files.length > 50, `the sweep found only ${files.length} source files -- it is not reading the tree`);
  const anyWriter = files.filter((f) => /\b(addDoc|setDoc|updateDoc)\s*\(/.test(readFileSync(f, "utf8")));
  assert.ok(anyWriter.length > 0, "the write pattern matches nothing anywhere -- the regex has gone stale");
});
