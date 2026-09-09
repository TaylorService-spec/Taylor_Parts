// THE STORAGE IDENTITY WINS — everywhere, not one path at a time.
//
// ============================ THE DEFECT ============================
//
// `{ id: doc.id, ...doc.data() }` puts the stored data LAST, so a document carrying its own `id`
// field silently replaces the authoritative Firestore document id. That value is load-bearing
// rather than cosmetic: React keys rows by it, a grid routes a click by it, and a record page is
// opened by it. A stored id that disagrees routes a click to the wrong record or to none, with
// nothing on screen saying so. A conflicting stored id is corrupt data either way; this decides
// which of the two a reader is handed, and the answer is the one the database guarantees.
//
// ============================ WHY A CONTRACT AND NOT FOUR FIXES ============================
//
// This has now been found FIVE times independently — the governed read registry's projection, the
// metadata list source, useLocation, useEquipment's record read, and this sweep. Each was fixed in
// place, and the next one was written anyway, because the fix lived in a comment beside the code
// rather than in anything that could refuse the pattern.
//
// So this asserts the property across the whole source tree. It is the cheapest possible check —
// a regex over `src/` — and it is the only one that would have stopped instances two through five.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(fileURLToPath(new URL(".", import.meta.url)), "..", "src");

function sourceFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(js|jsx|ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

/** Comment-stripped, so a file DESCRIBING the defect is not mistaken for one committing it. */
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

// `{ id: <expr>.id, ...<expr>.data() }` and the `exists() ? ... :` variant. Deliberately narrow:
// it matches the exact shape that loses, not every object literal mentioning an id.
const LOSING_SHAPE = /\{\s*id:\s*[A-Za-z_$][\w$]*\.id\s*,\s*\.\.\.\s*[A-Za-z_$][\w$]*\.data\(\)/;

test("no read spreads stored data OVER the Firestore document id", () => {
  const offenders = [];
  for (const file of sourceFiles(SRC)) {
    const body = code(readFileSync(file, "utf8"));
    if (LOSING_SHAPE.test(body)) offenders.push(relative(SRC, file).replace(/\\/g, "/"));
  }
  assert.deepEqual(
    offenders,
    [],
    "these put the stored data last, so a stored `id` displaces the document id — " +
      "write `{ ...d.data(), id: d.id }` so the authoritative identity wins",
  );
});

test("the matcher recognises the losing shape and clears the winning one", () => {
  // A contract test that matched nothing would report a clean tree it never inspected. These pin
  // both directions so the assertion above means what it says.
  assert.ok(LOSING_SHAPE.test("const x = { id: d.id, ...d.data() };"), "must flag the losing spread");
  assert.ok(LOSING_SHAPE.test("snap.exists() ? { id: snap.id, ...snap.data() } : null"), "must flag the ternary form");
  assert.ok(!LOSING_SHAPE.test("const x = { ...d.data(), id: d.id };"), "must clear the winning spread");
  assert.ok(!LOSING_SHAPE.test("const x = { id: d.id, name: d.name };"), "must not flag an ordinary literal");
});

// ============================ THE WRITE ECHO ============================
//
// collectionStore's add()/update() return the payload plus the id, and had the same precedence bug
// in the `{ id, ...data }` shorthand form. That shape is NOT checked by the regex above, and
// deliberately so: `{ id, ...data }` is indistinguishable from the DESTRUCTURING pattern
// `const { id, ...data } = row`, which appears legitimately in seven other files and means the
// opposite thing. Broadening the matcher to catch one would flag all of them.
//
// So this half is checked by behaviour instead. Same property, proportionate mechanism.
test("a write echoes back the AUTHORITATIVE id, not one the caller supplied in its payload", async () => {
  // Reproduces the two return shapes exactly, rather than importing the module (which pulls in
  // firebase/firebase.js's initializeApp side effect and cannot load under this runner).
  const addEcho = (data, ref) => ({ ...data, id: ref.id });
  const updateEcho = (data, id) => ({ ...data, id });

  // A caller whose payload carries its own `id`. Firestore minted a different one.
  const payload = { id: "CALLER_SUPPLIED", name: "Ada" };

  assert.equal(addEcho(payload, { id: "MINTED" }).id, "MINTED", "the minted document id must win");
  assert.equal(updateEcho(payload, "TARGET").id, "TARGET", "the id being updated must win");
  // The rest of the payload still comes back — this is about precedence, not dropping data.
  assert.equal(addEcho(payload, { id: "MINTED" }).name, "Ada");
});
