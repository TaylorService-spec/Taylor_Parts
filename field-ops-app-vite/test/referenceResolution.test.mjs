// REFERENCE RESOLUTION — the states, and the plumbing that carries them.
// Run: node --test test/referenceResolution.test.mjs
//
// ============================ THE DEFECT ============================
//
// Every row of the Sales Orders list rendered "Unresolved reference" under Customer. All 14 Sales
// Orders carried a valid accountId resolving to a real customer -- the data was perfect. The list
// runtime simply never received a resolver, so cellValue had nothing to resolve with and correctly
// refused to print a raw document id.
//
// The uniformity was the tell: a dangling reference is sporadic, missing plumbing is total.
//
// Two things are guarded here. The STATES, because collapsing "you may not see this" into "this
// does not exist" reports a data defect that is not there and states a conclusion about a record
// the viewer was never entitled to observe. And the PLUMBING, because that is what actually broke.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  REFERENCE_STATE, REFERENCE_STATE_LABEL, UNRESOLVED_REFERENCE_LABEL,
  normalizeReferenceResult, isResolved,
} from "../src/metadata/referenceResolution.js";
import { cellValue } from "../src/metadata/listPresentation.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const REFERENCE_COLUMN = { fieldId: "accountId", type: "REFERENCE", label: "Customer" };
const ROW = { id: "SO-1", accountId: "acct-harbor" };

// --- the states --------------------------------------------------------------

test("a resolved name renders as itself", () => {
  const out = cellValue(REFERENCE_COLUMN, ROW, { resolveReference: () => "Harbor Grill Restaurant Group" });
  assert.equal(out, "Harbor Grill Restaurant Group");
});

test("DENIED never leaks the name, the id, or whether the record exists", () => {
  // The single most important assertion in this file. A viewer who cannot read accounts must not
  // learn anything about the referenced one -- including that it is missing.
  const out = cellValue(REFERENCE_COLUMN, ROW, { resolveReference: () => ({ state: REFERENCE_STATE.DENIED }) });
  assert.equal(out, "Not available to your role");
  assert.equal(out.includes("acct-harbor"), false, "the id leaked");
  assert.equal(/harbor|grill/i.test(out), false, "the entity name leaked");
  assert.notEqual(out, REFERENCE_STATE_LABEL[REFERENCE_STATE.NOT_FOUND], "DENIED must not read as NOT_FOUND");
});

test("a caller cannot substitute its own label for DENIED", () => {
  // Otherwise a well-meaning resolver could pass the name it just fetched as the 'denied' text.
  const out = normalizeReferenceResult({ state: REFERENCE_STATE.DENIED, label: "Harbor Grill" });
  assert.equal(out.label, "Not available to your role");
  assert.equal(out.state, REFERENCE_STATE.DENIED);
});

test("NOT_FOUND, LOADING and ERROR stay distinct from each other and from UNRESOLVED", () => {
  const labels = [
    REFERENCE_STATE.NOT_FOUND, REFERENCE_STATE.LOADING,
    REFERENCE_STATE.ERROR, REFERENCE_STATE.LEGACY_UNSUPPORTED, REFERENCE_STATE.UNRESOLVED,
  ].map((state) => cellValue(REFERENCE_COLUMN, ROW, { resolveReference: () => ({ state }) }));
  assert.equal(new Set(labels).size, labels.length, `states collapsed into the same text: ${JSON.stringify(labels)}`);
  // LOADING in particular must not read as a failure -- nothing is wrong yet.
  assert.equal(labels[1], "Loading…");
});

test("the pre-existing resolver contract is unchanged", () => {
  // CustomerEquipment.jsx returns a string or undefined and was the ONLY screen resolving
  // references correctly. Breaking it to introduce a richer contract would trade a fix for a
  // regression.
  assert.equal(cellValue(REFERENCE_COLUMN, ROW, { resolveReference: () => undefined }), UNRESOLVED_REFERENCE_LABEL);
  assert.equal(cellValue(REFERENCE_COLUMN, ROW, { resolveReference: () => null }), UNRESOLVED_REFERENCE_LABEL);
  assert.equal(cellValue(REFERENCE_COLUMN, ROW, { resolveReference: () => "" }), UNRESOLVED_REFERENCE_LABEL);
  assert.equal(cellValue(REFERENCE_COLUMN, ROW, { resolveReference: () => "  Harbor  " }), "Harbor");
});

test("FOUND with no label is not FOUND", () => {
  // Trusting the state over the payload would render a blank cell and call it a resolved reference
  // -- indistinguishable from a field that is genuinely unset.
  const out = normalizeReferenceResult({ state: REFERENCE_STATE.FOUND, label: "   " });
  assert.equal(out.state, REFERENCE_STATE.UNRESOLVED);
  assert.equal(isResolved(out), false);
});

test("an unknown state degrades to UNRESOLVED rather than rendering the state name", () => {
  const out = normalizeReferenceResult({ state: "SOMETHING_NEW" });
  assert.equal(out.state, REFERENCE_STATE.UNRESOLVED);
  assert.equal(out.label, UNRESOLVED_REFERENCE_LABEL);
});

test("NO state ever renders a raw document id", () => {
  // The defect this whole path exists to prevent: an id is a routing key, not content.
  for (const state of Object.values(REFERENCE_STATE)) {
    const label = cellValue(REFERENCE_COLUMN, ROW, { resolveReference: () => ({ state }) });
    assert.equal(String(label).includes("acct-harbor"), false, `${state} rendered the raw id`);
  }
  // And with no resolver at all -- the exact Sales Orders situation.
  assert.equal(cellValue(REFERENCE_COLUMN, ROW, {}), UNRESOLVED_REFERENCE_LABEL);
});

test("an absent reference is still blank, not 'unresolved'", () => {
  // A field that is genuinely unset is a different fact from one that could not be shown.
  for (const raw of [null, undefined, ""]) {
    assert.equal(cellValue(REFERENCE_COLUMN, { id: "SO-1", accountId: raw }, {}), null);
  }
});

// --- the plumbing ------------------------------------------------------------
//
// Asserted against the source, because the failure was structural: the hook did not pass a value
// it was never given. A behavioural test of cellValue passes whether or not the hook threads it,
// which is precisely why the defect survived.

const readSrc = (rel) => readFileSync(path.resolve(here, "../src", rel), "utf8");

/**
 * Source with COMMENTS REMOVED.
 *
 * A guard that greps for a symbol will otherwise match the prose EXPLAINING why that symbol must
 * not appear -- reporting a defect that is not there. This file's own subject discusses `getDocs`
 * by name in a comment, and the first version of the check below failed on exactly that.
 */
// LINE-ENDING SAFE, the hard way. A first version split on "\n" and stripped with /\/\/.*$/, which
// works on LF and silently fails on CRLF: `.` does not match the trailing \r, so `$` never reaches
// the end of the line and the comment survives. The guard then matched its own subject inside a
// comment and reported a defect that was not there -- on Windows only. Checked out with
// autocrlf, that is a test that passes or fails depending on the machine.
const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\/\/[^\r\n]*/, ""))
    .join("\n");

test("useMetadataList ACCEPTS a resolver and PASSES it to the presentation builder", () => {
  const src = readSrc("hooks/useMetadataList.js");
  assert.match(src, /export function useMetadataList\([^)]*resolveReference/s,
    "the hook does not accept a resolver -- every REFERENCE column will render as unresolved");
  const call = src.match(/buildListPresentation\(\{[\s\S]*?\}\)/);
  assert.ok(call, "buildListPresentation call not found");
  assert.match(call[0], /resolveReference/,
    "the hook accepts a resolver but does not pass it on -- this is the original defect");
});

test("the resolver is a memo dependency, so arriving names actually re-render", () => {
  // Threading it but omitting it from the dependency list would resolve nothing on the render that
  // matters: names arrive asynchronously, after the first presentation is built.
  const src = readSrc("hooks/useMetadataList.js");
  const deps = src.match(/\[def, entity, rows[^\]]*\]/);
  assert.ok(deps, "presentation memo dependency list not found");
  assert.match(deps[0], /resolveReference/, "resolver changes would not rebuild the presentation");
});

test("the hook exposes rows, so references can be resolved in ONE batched read", () => {
  // Without rows, a caller wanting to resolve would re-read the list or resolve per cell -- the
  // N+1 pattern the presentation contract rules out by name.
  assert.match(readSrc("hooks/useMetadataList.js"), /^\s{4}rows,$/m, "useMetadataList does not expose rows");
});

test("the generic hook does not read Firestore itself", () => {
  // It is generic across 27 definitions and cannot know which governed read backs a reference, so
  // resolving here would mean a Firestore read from generic code -- and one read per row.
  //
  // COMMENTS ARE STRIPPED FIRST. This file's own prose discusses getDocs by name, and a guard that
  // matches its own explanation reports a defect that is not there -- the same false-positive shape
  // as a grep-based check that finds the word in a doc block and calls it a call site.
  const src = stripComments(readSrc("hooks/useMetadataList.js"));
  for (const banned of ["getDocs", "onSnapshot", "firebase/firestore"]) {
    assert.equal(src.includes(banned), false, `the generic list hook reached for Firestore (${banned})`);
  }
});

test("SalesOrdersList supplies a resolver through the SHARED hook, not a local copy", () => {
  const src = readSrc("modules/sales/SalesOrdersList.jsx");
  assert.match(src, /useAccountReferenceResolver/, "Sales Orders builds its own resolver instead of sharing one");
  assert.match(src, /resolveReference/, "Sales Orders does not pass a resolver to the list");
});
