// A CREATED RECORD MUST BE REACHABLE. Run: node --test test/createdRecordIsReachable.test.mjs
//
// ============================ THE FAILURE THIS EXISTS TO STOP ============================
//
// A newly created Prospect could not be found. It satisfied every filter on the Customers list and
// was still absent from it -- while remaining findable by name search.
//
// The cause is a rule of Firestore that has no error attached to it: ORDERBY SILENTLY EXCLUDES ANY
// DOCUMENT MISSING THE ORDERED FIELD. The Customers index sorts by `updatedAt DESC` server-side, and
// `collectionStore.add` stamped only `createdAt`. So the record existed, matched, and was invisible.
// Nothing threw. The list was not empty -- it was simply missing the one row the user had just made.
//
// Search kept working because it orders by `name`, which every account has. That asymmetry is
// exactly what the report described.
//
// Introduced by bd576a92 (#1137), which moved ordering from an in-memory subscription to a
// server-ordered metadata list. The write path never changed; the field-existence requirement
// became load-bearing and nothing said so.
//
// ============================ WHY THIS TEST IS SHAPED THIS WAY ============================
//
// It does not test Firestore. It tests the INVARIANT that makes Firestore's behaviour safe:
//
//   every field a list sorts on by default must be present the moment a record is created.
//
// That is checkable statically, cheaply, and for every collection at once -- which matters, because
// the next instance of this bug will be a new list with a new default sort, not accounts again.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, "../src");

const store = readFileSync(path.join(SRC, "firebase/collectionStore.js"), "utf8");

test("the shared writer stamps updatedAt on CREATE, not only on update", () => {
  // The fix, pinned at its source. Stamping in the shared writer covers every collection that goes
  // through it, rather than patching accounts alone and waiting for the next list to repeat it.
  const addBody = store.slice(store.indexOf("add(data)"), store.indexOf("update(id, data)"));
  assert.match(addBody, /updatedAt/, "add() must stamp updatedAt");
  assert.match(addBody, /createdAt/, "add() must still stamp createdAt");
});

test("caller-supplied timestamps still win — the stamp is a floor, not an override", () => {
  // `{ createdAt: now, updatedAt: now, ...data }` puts the spread LAST on purpose: a caller that
  // supplies its own timestamps (a migration, a fixture, a backdated import) keeps them.
  const addBody = store.slice(store.indexOf("add(data)"), store.indexOf("update(id, data)"));
  assert.match(
    addBody,
    /\{\s*createdAt:\s*now,\s*updatedAt:\s*now,\s*\.\.\.data\s*\}/,
    "the data spread must come after the defaults so a caller can override them",
  );
});

// ═══════════════════════════════════════════ the general invariant

/** Every list definition's default sort field, by definition file. */
function defaultSortFields() {
  const dir = path.join(SRC, "metadata/definitions");
  const out = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".js"))) {
    const src = readFileSync(path.join(dir, file), "utf8");
    for (const m of src.matchAll(/defaultSort:\s*\[\s*makeSort\(\{\s*fieldId:\s*"([^"]+)"/g)) {
      out.push({ file, field: m[1] });
    }
  }
  return out;
}

/**
 * Fields the shared writer guarantees on every created document, plus fields that are part of a
 * record's identity and therefore always supplied by the caller that creates it.
 *
 * A sort on anything NOT in this set is the bug this file exists to catch: the list will silently
 * omit newly created records.
 */
const ALWAYS_PRESENT = new Set([
  "createdAt", "updatedAt",          // stamped by collectionStore.add

  // Identity fields: a record cannot be created without them.
  "name", "displayName", "displayLabel", "internalPartNumber", "partId", "id",
  "binCode",                         // stockLocation identity

  // PRESENT IS NOT THE SAME AS NON-NULL, and that distinction is the whole point.
  //
  // Firestore's orderBy drops a document whose field is ABSENT. A field explicitly written as
  // `null` is present and sorts normally (nulls first, ascending). So a nullable field is safe here
  // as long as the writer ALWAYS writes the key.
  //
  // Both of these are written unconditionally by the server on create:
  //   expectedCloseAt   opportunityCommands.ts:146 -- `finiteNum(x) ? x : null`, never omitted
  //   salesOrderNumber  server-assigned at creation
  // Each was flagged by this test and each was checked against its writer before being listed. If
  // either writer ever starts omitting the key instead of nulling it, the row vanishes from its list
  // with no error -- so these entries are claims about the WRITE PATH, not conveniences.
  "expectedCloseAt",
  "salesOrderNumber",
]);

test("NO list sorts by default on a field a new record might not have", () => {
  // The generalisation. Today only the Customers list was affected; the value of this assertion is
  // entirely in the list that has not been written yet.
  const offenders = defaultSortFields()
    .filter(({ field }) => !ALWAYS_PRESENT.has(field))
    .map(({ file, field }) => `${file} sorts by "${field}"`);

  assert.deepEqual(
    offenders,
    [],
    "Firestore's orderBy silently drops documents missing the sorted field, so a list sorting on a\n" +
    "field that is not set at creation will omit newly created records with no error at all.\n" +
    "Either stamp the field on create, or sort on one that is always present:\n  " +
    offenders.join("\n  "),
  );
});

test("the hazard is documented where somebody will meet it", () => {
  // inventoryTransaction.js already explained this trap in prose and the Customers list fell into it
  // anyway. Prose is necessary and demonstrably not sufficient -- so the note stays AND the
  // assertions above exist. This test simply keeps the explanation from being deleted as clutter.
  const note = readFileSync(path.join(SRC, "metadata/definitions/inventoryTransaction.js"), "utf8");
  assert.match(note, /silently excludes any\s*\n?\/\/ document missing the ordered field/i);
});
