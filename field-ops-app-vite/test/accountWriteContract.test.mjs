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

// ════════════════════ THE DERIVATION MOVED TO THE SERVER ════════════════════
//
// The client no longer writes accounts at all: both paths are trusted commands, and the search
// name is derived in `buildAccountCreate` / `buildAccountUpdate`. So the guard follows the
// derivation rather than staying where it used to live -- a structural test asserting a client
// function still derives a field it no longer writes would pass or fail for reasons that have
// nothing to do with whether customers are findable.
//
// The BEHAVIOUR is proven server-side in functions/test/crmWriteCommands.test.mjs ("the create
// paths derive the search name, trimmed and lowercased" and "an account update touches the
// search name ONLY when the patch touches the name"). What is asserted HERE is the shape that
// behaviour depends on, and the two client-side properties that still matter.

test("the client writer submits to the command and derives nothing itself", () => {
  const src = readFileSync(path.join(srcDir, CANONICAL_WRITER), "utf8");
  const create = src.match(/export function createAccount[\s\S]*?\n\}/);
  const update = src.match(/export function updateAccount[\s\S]*?\n\}/);
  assert.ok(create, "createAccount not found -- this guard's premise has expired");
  assert.ok(update, "updateAccount not found -- this guard's premise has expired");
  // Submits, rather than writes. A client that derived the field would be a SECOND writer of a
  // derived value, which is the exact failure this file exists to prevent -- now in the form of
  // two implementations that can disagree instead of one caller that forgets.
  for (const [name, fn] of [["createAccount", create[0]], ["updateAccount", update[0]]]) {
    assert.match(fn, /submit(Create|Update)Account/, `${name} must go through the trusted command`);
    assert.doesNotMatch(fn, /nameLower|normalizeNameForSearch|withSearchableName/, `${name} must not derive the search name client-side`);
  }
});

test("the SERVER command derives it, and only when the patch carries a name", () => {
  // Deriving unconditionally would write nameLower:"" for any status-only edit, silently removing
  // that customer from search. The conditional branch is the whole contract, so it is asserted
  // where it now lives.
  const command = readFileSync(
    path.resolve(here, "../../functions/src/crm/crmWriteCommands.ts"),
    "utf8",
  );
  assert.match(command, /normalizeAccountSearchName/, "the command must derive the search name");
  const update = command.match(/export function buildAccountUpdate[\s\S]*?\n\}/);
  assert.ok(update, "buildAccountUpdate not found -- this guard's premise has expired");
  assert.match(update[0], /"name" in clean/, "the derivation must be conditional on the patch carrying a name");
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
  //
  // ITS PREMISE CHANGED, in the best possible way. This used to prove the regex was live by
  // finding at least one real Firestore writer in the tree. There are now ZERO: every business
  // write is a trusted command, and `field-ops-app-vite/test/clientFirestoreCensus.test.jsx`
  // asserts that count outright. Requiring a real offender to exist would mean this guard could
  // only pass while the thing it guards against was still happening.
  //
  // So the two halves are proven separately: the sweep reads a real tree, and the pattern matches
  // a fabricated writer. Both must hold for the sweep above to mean anything.
  const files = sourceFiles(srcDir);
  assert.ok(files.length > 50, `the sweep found only ${files.length} source files -- it is not reading the tree`);

  const WRITE = /\b(addDoc|setDoc|updateDoc)\s*\(/;
  const fabricatedOffender = 'import { addDoc } from "firebase/firestore";\naddDoc(collection(db, ACCOUNTS_COLLECTION), { name: "x" });';
  assert.ok(WRITE.test(fabricatedOffender), "the write pattern has gone stale -- it no longer matches a writer");
  assert.ok(
    /ACCOUNTS_COLLECTION|["'`]accounts["'`]/.test(fabricatedOffender),
    "the collection pattern has gone stale -- it no longer matches an accounts reference",
  );

  // And the sweep genuinely finds nothing today, which is the closure this file now records.
  const realWriters = files.filter((file) => WRITE.test(readFileSync(file, "utf8")));
  assert.deepEqual(
    realWriters.map((file) => path.relative(srcDir, file)),
    [],
    "a client-direct Firestore write reappeared -- every business write belongs in a trusted command",
  );
});
