// FIREBASE SHIM BOUNDARY. What the ratchet must catch, and -- more importantly -- what it must
// NEVER catch.
//
// Derived against main at 64008d5ae0bdd9532909671b15a91122400accf1.
//
// ============================ WHAT IS BEING PROVEN ============================
//
//   * the committed census matches the live tree exactly -- no new consumer, no stale entry, no
//     registry drift;
//
//   * a NEW consumer of a shim's authority export FAILS. That is the whole purpose: growth;
//
//   * an EXISTING consumer does NOT fail. The Owner ruling permits the transitional shims and
//     forbids marking their existing consumers recursively, so a passing run over the real tree
//     with five recorded consumers is a load-bearing assertion, not a smoke test;
//
//   * a consumer that ALSO imports the fenced dependency directly is NOT censused here -- it is a
//     firebaseExitGuard baseline entry and that ratchet already governs it. The two fences compose
//     and must not double-govern one file;
//
//   * INSULATION IS NOT A SHIM. A read hook, a query service, or a domain command that uses
//     Firestore internally and returns DATA does not hand authority across its boundary, and its
//     callers are not consumers. Three earlier rules failed this and the counts they produced are
//     asserted here as regression floors: 190 shims / 146 consumers (body-touches-Firestore), 65
//     shims (method-call `.doc(id)` mistaken for a ref pass-through), 21 shims (unanchored
//     `getFirestore(` inside a DocumentReference expression). The current rule set yields 4 and 5;
//
//   * a shim is DISCOVERED, never hand-listed, and it stops being discovered the moment it stops
//     carrying a guard-fenced Firestore dependency -- which is what ties retirement to the Firebase
//     exit rather than to a separate schedule;
//
//   * Firebase Auth is outside this boundary exactly as it is outside the guard's: `export const
//     auth = getAuth(app)` is not a shim export.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  authorityExports,
  returnedObjectLiteral,
  valueImportsFrom,
  discoverShims,
  censusConsumers,
  resolveLocalSpecifier,
  scanFiles,
  buildCensus,
  evaluateCensus,
  evaluateGrowthRatchet,
  loadCensusFromPath,
  parseFlag,
  CENSUS_RELATIVE_PATH,
} from "./firebaseShimBoundary.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(HERE, "..");

// ------------------------------------ authorityExports -------------------------------------------

test("R1: a const initialized to a Firestore or Functions handle is an authority export", () => {
  assert.deepEqual(authorityExports("export const db = getFirestore(app);").map((e) => e.name), ["db"]);
  assert.deepEqual(
    authorityExports("export const functions = getFunctions(app, region);").map((e) => e.name),
    ["functions"]);
  assert.deepEqual(authorityExports("export const d = admin.firestore();").map((e) => e.name), ["d"]);
});

test("R1: a function whose declared return type or return expression IS a handle", () => {
  assert.deepEqual(
    authorityExports("export function db(): Firestore {\n  return getFirestore();\n}").map((e) => e.name),
    ["db"]);
  assert.deepEqual(
    authorityExports("export function handle() {\n  return getFirestore();\n}").map((e) => e.name),
    ["handle"]);
});

test("R1 is ANCHORED: an expression that merely CONTAINS a handle producer but evaluates to a " +
  "DocumentReference is not a handle -- one document wide is not the database", () => {
  assert.deepEqual(
    authorityExports('export function counterDocId(kind) {\n' +
      '  return getFirestore().collection("counters").doc(kind);\n}'),
    [],
    "an unanchored test here discovered every xCounterDocId helper in functions/src as a shim");
});

test("R1 does not fire on a handle RECEIVED as a default parameter value -- that is the module " +
  "taking a handle with a fallback, not handing one onward", () => {
  assert.deepEqual(
    authorityExports("export function store(db: Firestore = getFirestore()): ImportJobStore {\n" +
      "  return buildStore(db);\n}"),
    []);
});

test("R2: an export that forwards its OWN parameter into a Firestore API as that API's Firebase " +
  "object is a ref pass-through", () => {
  const found = authorityExports(
    "export const safeAddDoc = async (ref, data) => {\n  return addDoc(ref, data);\n};");
  assert.deepEqual(found, [{ name: "safeAddDoc", reason: "ref-pass-through" }]);
});

test("R2 does NOT fire when argument zero is the module's own handle -- that is a read hook or a " +
  "query service, which returns data and hands over nothing", () => {
  assert.deepEqual(
    authorityExports('export function useAccount(id) {\n' +
      '  const ref = doc(db, "accounts", id);\n  const [state] = useDoc(ref);\n  return { state };\n}'),
    []);
});

test("R2 does NOT fire on the admin SDK's METHOD style, whose argument zero is an id string -- " +
  "the missing lookbehind that produced 65 false shims across functions/src", () => {
  assert.deepEqual(
    authorityExports("export async function loadTech(tx, technicianId) {\n" +
      "  return tx.get(col.doc(technicianId));\n}"),
    []);
});

test("R3: an export that binds a collection off the module handle and returns a literal of " +
  "FUNCTIONS containing writes is a bound-collection factory", () => {
  const found = authorityExports(
    "export function makeCollectionStore(name) {\n" +
    "  const colRef = collection(db, name);\n" +
    "  return {\n" +
    "    add: (d) => safeAddDoc(colRef, d),\n" +
    "    remove: (id) => safeDeleteDoc(doc(colRef, id)),\n" +
    "  };\n}");
  assert.deepEqual(found, [{ name: "makeCollectionStore", reason: "bound-collection-factory" }]);
});

test("R3 does NOT fire on a domain command that writes and returns a literal of COUNTS -- a " +
  "result is not a capability", () => {
  assert.deepEqual(
    authorityExports("export async function importContacts(rows) {\n" +
      "  let created = 0;\n" +
      '  for (const r of rows) { await safeAddDoc(collection(db, "contacts"), r); created += 1; }\n' +
      "  return { created, skipped: 0, errors: [] };\n}"),
    []);
});

test("R3 does NOT fire on a read hook that returns state -- no write inside the returned literal", () => {
  assert.deepEqual(
    authorityExports("export function useAccounts() {\n" +
      '  const q = query(collection(db, "accounts"));\n' +
      "  const [rows, loading] = useSnap(q);\n" +
      "  return { rows, loading, refresh: () => getDocs(q) };\n}"),
    [],
    "refresh() is a READ; governing reads here readmits roughly fifty hooks and query services");
});

test("Firebase Auth is outside this boundary: getAuth is not a handle producer", () => {
  assert.deepEqual(authorityExports("export const auth = getAuth(app);"), []);
});

test("every top-level export form terminates the previous binding's body, so a pure function " +
  "cannot absorb unrelated Firestore code that happens to follow it", () => {
  const source = [
    "export function pureFacts(input) {",
    "  return { ok: input.a === input.b };",
    "}",
    "",
    "export interface Deps {",
    "  readonly x: string;",
    "}",
    "",
    "export async function writer(db, id) {",
    '  await db.collection("x").doc(id).set({});',
    "}",
  ].join("\n");
  assert.deepEqual(authorityExports(source), [],
    "an `export interface` that is not a boundary made resolveEmployeeLinkFacts absorb four " +
    "hundred lines of Firestore code and be discovered as a shim");
});

// ----------------------------------- returnedObjectLiteral ---------------------------------------

test("returnedObjectLiteral brace-matches and stops at the literal's close", () => {
  assert.equal(returnedObjectLiteral("f() { return { a: 1 }; } g() { addDoc(x); }"), "{ a: 1 }");
  assert.equal(returnedObjectLiteral("return { a: { b: 1 } };"), "{ a: { b: 1 } }");
  assert.equal(returnedObjectLiteral("return 5;"), "");
});

// ------------------------------------- import analysis -------------------------------------------

test("valueImportsFrom ignores type-only imports, which carry no runtime authority", () => {
  assert.deepEqual([...valueImportsFrom('import type { db } from "./x";', "./x")], []);
  assert.deepEqual([...valueImportsFrom('import { type Firestore, db } from "./x";', "./x")], ["db"]);
  assert.deepEqual([...valueImportsFrom('import { db } from "./x";', "./x")], ["db"]);
  assert.deepEqual([...valueImportsFrom('import * as repo from "./x";', "./x")], ["*"]);
});

test("resolveLocalSpecifier honours extensionless, .js-meaning-.ts, and index resolution, and " +
  "returns null for a bare package specifier", () => {
  const files = new Map([
    ["a/b/target.ts", ""], ["a/b/dir/index.ts", ""],
  ]);
  assert.equal(resolveLocalSpecifier("a/from.ts", "./b/target", files), "a/b/target.ts");
  assert.equal(resolveLocalSpecifier("a/from.ts", "./b/target.js", files), "a/b/target.ts");
  assert.equal(resolveLocalSpecifier("a/from.ts", "./b/dir", files), "a/b/dir/index.ts");
  assert.equal(resolveLocalSpecifier("a/from.ts", "firebase-admin/firestore", files), null);
});

// ------------------------------- the two ratchet evaluations -------------------------------------

const census = (shim, consumers) => ({ shims: [{ shim, authorityExports: ["db"], consumers }] });

test("a NEW consumer fails: this is the whole purpose of the artifact", () => {
  const result = evaluateCensus(census("s.ts", ["old.ts"]), census("s.ts", ["old.ts", "new.ts"]));
  assert.deepEqual(result.newConsumers, [{ shim: "s.ts", path: "new.ts" }]);
  assert.deepEqual(result.staleEntries, []);
});

test("an EXISTING consumer does not fail -- the Owner ruling tolerates the current set", () => {
  const result = evaluateCensus(census("s.ts", ["old.ts"]), census("s.ts", ["old.ts"]));
  assert.deepEqual(result, { newConsumers: [], staleEntries: [], unregistered: [] });
});

test("a REMOVED consumer is the ratchet working, and the census must shrink with it -- a stale " +
  "entry fails for the same reason the guard's does", () => {
  const result = evaluateCensus(census("s.ts", ["gone.ts"]), census("s.ts", []));
  assert.deepEqual(result.staleEntries, [{ shim: "s.ts", path: "gone.ts" }]);
});

test("a shim present in the tree but absent from the census fails -- an out-of-date registry " +
  "cannot be trusted to cover anything", () => {
  const result = evaluateCensus({ shims: [] }, census("s.ts", []));
  assert.deepEqual(result.unregistered, [{ shim: "s.ts", kind: "shim missing from census" }]);
});

test("a census section for a module that is no longer a shim fails -- that is how retirement is " +
  "forced to happen WITH the Firebase exit rather than being left behind", () => {
  const result = evaluateCensus(census("s.ts", []), { shims: [] });
  assert.deepEqual(result.unregistered,
    [{ shim: "s.ts", kind: "census names a module that is no longer a shim" }]);
});

test("the growth ratchet blocks adding a consumer and widening the census in ONE change -- the " +
  "hole the exact-match check alone cannot close, because the census was expanded to match", () => {
  const result = evaluateGrowthRatchet(census("s.ts", ["old.ts"]), census("s.ts", ["old.ts", "new.ts"]));
  assert.deepEqual(result.additions, [{ shim: "s.ts", path: "new.ts" }]);
  assert.equal(result.bootstrap, false);
});

test("the growth ratchet allows a census DELETION", () => {
  const result = evaluateGrowthRatchet(census("s.ts", ["a.ts", "b.ts"]), census("s.ts", ["a.ts"]));
  assert.deepEqual(result.additions, []);
});

test("no --previous-census means the growth ratchet is not evaluated, and says so -- it NEVER " +
  "means the committed census is skipped", () => {
  assert.deepEqual(evaluateGrowthRatchet(null, census("s.ts", ["x.ts"])),
    { additions: [], bootstrap: true });
});

test("parseFlag reads only its own flag", () => {
  assert.equal(parseFlag(["--previous-census=/tmp/a.json"], "--previous-census"), "/tmp/a.json");
  assert.equal(parseFlag(["--write"], "--previous-census"), undefined);
});

// --------------------------------- against the REAL repository -----------------------------------

test("the committed census matches the live tree exactly -- no new consumer, no stale entry, no " +
  "registry drift", () => {
  const live = buildCensus(REPO_ROOT);
  const committed = loadCensusFromPath(join(REPO_ROOT, CENSUS_RELATIVE_PATH));
  const result = evaluateCensus(committed, live);
  assert.deepEqual(result, { newConsumers: [], staleEntries: [], unregistered: [] });
});

test("the discovered registry is EXACTLY the four transitional shims, with five tolerated " +
  "consumers -- the regression floor against the three rule sets that over-discovered", () => {
  const live = buildCensus(REPO_ROOT);
  assert.deepEqual(live.shims.map((shim) => shim.shim), [
    "field-ops-app-vite/src/firebase/collectionStore.js",
    "field-ops-app-vite/src/firebase/firebase.js",
    "field-ops-app-vite/src/lib/firebaseSafe.js",
    "functions/src/scheduling/schedulingRepository.ts",
  ], "a fifth shim is either a real new re-export or a rule that started over-discovering again");
  assert.equal(live.shims.reduce((sum, shim) => sum + shim.consumers.length, 0), 5);
  assert.ok(live.shims.length < 21,
    "21 / 65 / 190 were the counts of three successive over-wide rules; see this file's header");
});

test("the canonical frontend shim exports the Firestore and Functions HANDLES and not auth", () => {
  const live = buildCensus(REPO_ROOT);
  const shim = live.shims.find((entry) => entry.shim === "field-ops-app-vite/src/firebase/firebase.js");
  assert.deepEqual(shim.authorityExports, ["db", "functions"],
    "auth must never appear here -- Firebase Auth identity is permitted by Owner ruling");
});

test("all 68 importers of the frontend handle shim's db/functions also import the fenced " +
  "dependency DIRECTLY, so the guard's own baseline already governs every one of them -- which " +
  "is why this shim's tolerated consumer set is empty rather than unexamined", () => {
  const live = buildCensus(REPO_ROOT);
  const shim = live.shims.find((entry) => entry.shim === "field-ops-app-vite/src/firebase/firebase.js");
  assert.deepEqual(shim.consumers, []);
  // 71 -> 68: the Reorder Domain Cutover's three modules stopped importing the shim's handles AND
  // the fenced dependency, so they left both sets together. That is the outcome this assertion is
  // watching for -- the failure mode it guards against is the OTHER one, where a file drops the
  // direct import but keeps reaching Firestore through the shim, which would empty this count
  // while filling the tolerated-consumer list asserted above.
  assert.equal(live.observed.alreadyFencedConsumers, 68,
    "if this drops, a former guard baseline entry now reaches Firestore only through the shim and " +
    "must appear as a censused consumer instead");
});

test("every discovered shim is itself a guard baseline entry, which is what makes retirement " +
  "automatic: a module that stops importing Firestore stops being a shim in the same change", () => {
  const files = scanFiles(REPO_ROOT);
  const shims = discoverShims(files);
  const baseline = JSON.parse(
    readFileSync(join(REPO_ROOT, "docs/architecture/firebase-exit-baseline.json"), "utf8"));
  const baselined = new Set(
    Object.values(baseline.baseline).flatMap((section) => Object.values(section).flat()));
  for (const shim of shims) {
    assert.ok(baselined.has(shim.shim),
      `${shim.shim} is discovered as a shim but is not in the Firebase exit baseline`);
  }
  assert.ok(shims.length > 0);
  // And the census is built from the same discovery, so the two cannot drift.
  assert.equal(censusConsumers(files, shims).size, shims.length);
});
