// EVERY SHARED-WRITER COLLECTION STAMPS THE TIMESTAMP TYPE ITS METADATA GOVERNS.
// Run: node --test test/collectionStoreTimestampContract.test.mjs
//
// ════════════════════ THE DEFECT THIS CLOSES ════════════════════
//
// makeCollectionStore.add stamped `Date.now()` -- an epoch NUMBER -- for every collection.
// metadata/definitions/account.js governs createdAt/updatedAt as TIMESTAMP, and the existing
// population stores Firestore Timestamps.
//
// Firestore orders across types by TYPE FIRST (number sorts below timestamp), so a newly created
// Customer sorted BELOW every existing one under `updatedAt DESC`. Not excluded -- LAST. On the
// 106-row sandbox list with a 50-row page, last and invisible are the same thing, and the header
// still counted it. Observed live: under ASCENDING date order the new records were rows 1-3.
//
// ════════════════════ WHY THIS IS A STRUCTURAL TEST ════════════════════
//
// The risk is not the five call sites that exist today -- it is the sixth, added by somebody who
// never learns this field has a governed type. So the expectation is COMPUTED FROM THE ENTITY
// DEFINITIONS rather than restated here: add a store for a TIMESTAMP-governed collection without
// declaring the policy and this fails, naming the collection.
//
// Same class of guard as accountWriteContract.test.mjs, and for the same reason: the failure is
// silent, and by the time it is visible the data is already written.
import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, "../src");
const read = (p) => readFileSync(p, "utf8");

// Collection names reach BOTH the entity definitions and the stores as constants, so both sides
// resolve through domain/constants.js rather than assuming a string literal.
const constants = read(path.join(src, "domain", "constants.js"));
function collectionFor(token) {
  if (!token) return null;
  if (/^"/.test(token)) return token.slice(1, -1);
  return constants.match(new RegExp(`\\b${token}\\s*=\\s*"([^"]+)"`))?.[1] ?? null;
}

// ── the governed truth: collection -> declared type of createdAt/updatedAt ──────────────────────
const defsDir = path.join(src, "metadata", "definitions");
const governed = new Map(); // collectionName -> { file, types: Set<string> }
for (const file of readdirSync(defsDir).filter((f) => f.endsWith(".js"))) {
  const text = read(path.join(defsDir, file));
  const collection = collectionFor(text.match(/^\s*collection:\s*([A-Z_"][A-Za-z_"]*)/m)?.[1]);
  if (!collection) continue;
  const types = new Set();
  for (const field of ["createdAt", "updatedAt"]) {
    // The `type:` that follows this field's own `id:`, within its makeFieldDefinition block.
    const m = text.match(new RegExp(`id:\\s*"${field}"[\\s\\S]{0,400}?type:\\s*"([A-Z_]+)"`));
    if (m) types.add(m[1]);
  }
  if (types.size) governed.set(collection, { file, types });
}

test("the governed types were actually found -- this test is worthless if the parse silently failed", () => {
  // A regex that stops matching turns every assertion below into a vacuous pass. Anchor on the two
  // collections whose types are known and DIFFERENT, so a parse failure cannot look like agreement.
  assert.ok(governed.size >= 4, `expected several governed collections, found ${governed.size}`);
  assert.deepEqual([...(governed.get("accounts")?.types ?? [])], ["TIMESTAMP"]);
  assert.ok(governed.get("equipment")?.types.has("NUMBER"), "equipment governs NUMBER");
});

test("NO ENTITY MIXES the two timestamp types on one collection", () => {
  // createdAt TIMESTAMP beside updatedAt NUMBER would make the collection unorderable by one of
  // them against its own history, and no single store policy could satisfy it.
  for (const [collection, { file, types }] of governed) {
    assert.equal(types.size, 1, `${collection} (${file}) declares mixed timestamp types: ${[...types]}`);
  }
});

// ── every store, and the policy it declares ────────────────────────────────────────────────────
function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else if (/\.(js|jsx)$/.test(e.name)) out.push(full);
  }
  return out;
}
const files = walk(src);


const stores = [];
for (const file of files) {
  if (file.endsWith(path.join("firebase", "collectionStore.js"))) continue;
  const text = read(file);
  for (const m of text.matchAll(/makeCollectionStore\(\s*([A-Z_"][A-Za-z_"]*)\s*(,[\s\S]{0,220}?)?\)/g)) {
    const collection = collectionFor(m[1]);
    const declaresServerTimestamp = /TIMESTAMP_SHAPE\.SERVER_TIMESTAMP/.test(m[2] ?? "");
    stores.push({ file: path.relative(src, file), collection, declaresServerTimestamp });
  }
}

test("every shared-writer store was found", () => {
  assert.ok(stores.length >= 6, `expected the known stores, found ${stores.length}`);
  assert.ok(stores.every((s) => s.collection), `a store's collection could not be resolved: ${JSON.stringify(stores.filter((s) => !s.collection))}`);
});

test("A STORE'S TIMESTAMP POLICY MATCHES ITS COLLECTION'S GOVERNED TYPE", () => {
  // THE INVARIANT. Not "accounts uses server timestamps" -- that would still pass if a new
  // TIMESTAMP-governed collection were added with the wrong default. The expectation is read from
  // the entity definition, so the metadata stays the authority and this is only the agreement.
  for (const store of stores) {
    const g = governed.get(store.collection);
    if (!g) continue; // a collection with no governed timestamp field has nothing to disagree with
    const expectsServer = g.types.has("TIMESTAMP");
    assert.equal(
      store.declaresServerTimestamp,
      expectsServer,
      expectsServer
        ? `${store.collection} (${store.file}) is governed TIMESTAMP by ${g.file} but the store stamps epoch millis. ` +
          "Firestore sorts numbers below timestamps, so new records sink to the bottom of every date-ordered list."
        : `${store.collection} (${store.file}) is governed NUMBER by ${g.file} but the store declares SERVER_TIMESTAMP.`,
    );
  }
});

test("accounts is the ONE server-timestamp store, and the default stays epoch millis", () => {
  const server = stores.filter((s) => s.declaresServerTimestamp).map((s) => s.collection);
  assert.deepEqual(server, ["accounts"]);
  // Every other store passes no options at all, so this change is byte-identical for them.
  const storeSrc = read(path.join(src, "firebase", "collectionStore.js"));
  assert.match(storeSrc, /timestamps = TIMESTAMP_SHAPE\.EPOCH_MILLIS/, "the default must remain epoch millis");
});

// ── the edit path, which re-broke a correctly created record ────────────────────────────────────

test("NO ACCOUNT WRITER HARDCODES Date.now()", () => {
  // updateAccount stamped `updatedAt: Date.now()` directly, so a record created with the right type
  // sank the moment anybody edited it. Asking the store for its own governed stamp means the create
  // and edit paths can never drift apart.
  const accounts = read(path.join(src, "domain", "accounts.js"));
  assert.doesNotMatch(accounts, /updatedAt:\s*Date\.now\(\)/, "the edit path must not stamp its own epoch millis");
  assert.match(accounts, /updatedAt:\s*accountsStore\.timestampValue\(\)/, "the edit path asks the store for the governed shape");
  assert.match(accounts, /TIMESTAMP_SHAPE\.SERVER_TIMESTAMP/, "the store declares the governed policy");
});

test("the NUMBER-governed collections keep writing numbers", () => {
  // inventoryAction.js states it outright -- "never FieldValue.serverTimestamp(), never a Firestore
  // Timestamp" -- so a global switch would have broken four collections to fix one.
  for (const collection of ["equipment", "locations", "inventory_actions", "reorder_requests"]) {
    const store = stores.find((s) => s.collection === collection);
    if (!store) continue;
    assert.equal(store.declaresServerTimestamp, false, `${collection} must keep epoch millis`);
  }
});

// ── the list message that hid the symptom ───────────────────────────────────────────────────────

test("THE LIST TELLS PAGING AND EXCLUSION APART", () => {
  // The shortfall warning required !hasMore, so on a 106-row list with a 50-row page it never
  // rendered -- the count disagreed with the rows and the screen said nothing. "More pages exist"
  // and "these records can never appear" have different remedies and must not share a sentence.
  const list = read(path.join(src, "modules", "accounts", "AccountsList.jsx"));
  assert.match(list, /presentation\.hasMore \? \(/, "the two shortfalls branch on hasMore");
  assert.match(list, /Load more to\s*\n?\s*see the rest/, "the paging case points at Load more");
  assert.match(list, /cannot appear here/, "the exclusion case still names the missing sort field");
  // The exclusion claim must stay on the !hasMore side: attributing a page boundary to a missing
  // field would be a confident wrong diagnosis.
  const exclusionIdx = list.indexOf("cannot appear here");
  const branchIdx = list.indexOf("presentation.hasMore ? (");
  assert.ok(branchIdx > 0 && exclusionIdx > branchIdx, "the exclusion message belongs to the else branch");
});
