// THE CLIENT CATALOG CUTOVER -- every Part read and write reaches Render, and nothing falls back.
//
// Most of this suite is derived from the source rather than asserted, because "no fallback" is a
// claim about code that does not exist. A comment promising it is worth nothing; a test that reads
// the modules and fails when a Firestore import reappears is the only form of that promise that
// survives the next change.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
const rel = (f) => relative(SRC, f).split("\\").join("/");
const files = [];
(function walk(d) { for (const e of readdirSync(d)) { const p = join(d, e); statSync(p).isDirectory() ? walk(p) : /\.(js|jsx|ts|tsx)$/.test(e) && files.push(p); } })(SRC);
const code = (p) => strip(readFileSync(join(SRC, p), "utf8"));

/** A Firestore READ of a Catalog collection, as it actually looks in this codebase. */
function firestoreCatalogReaders() {
  const out = [];
  for (const f of files) {
    const src = strip(readFileSync(f, "utf8"));
    if (!/["'](parts|part_aliases|equipment_models)["']/.test(src)) continue;
    if (!/getDocs|onSnapshot|collection\(db|doc\(db/.test(src)) continue;
    out.push(rel(f));
  }
  return out.sort();
}

test("ZERO client modules read a Catalog collection from Firestore", () => {
  assert.deepEqual(firestoreCatalogReaders(), [],
    "each of these must ask the Render Catalog API the question it actually has");
});

test("the Catalog client has NO fallback of any kind", () => {
  const src = code("services/catalogApiClient.js");
  for (const banned of ["firebase/firestore", "firebase/functions", "getDocs", "httpsCallable", "collection("]) {
    assert.equal(src.includes(banned), false, `the Catalog client must not reach ${banned}`);
  }
  // A failed fetch returns a value; it does not consult a second source.
  assert.match(src, /catch \(err\) \{[\s\S]*?return failure\("UNREACHABLE"/,
    "an unreachable service is a returned failure, never a redirect to Firestore");
});

test("the Part read seam reaches Render only, and no longer offers a whole-collection read", () => {
  const src = code("services/partMasterQueries.js");
  for (const banned of ["firebase/firestore", "getDocs", "collection(", "../firebase/firebase"]) {
    assert.equal(src.includes(banned), false, `partMasterQueries must not reach ${banned}`);
  }
  assert.ok(src.includes("catalogApiClient"), "it reaches the governed Catalog client");
  // The fetch-all is GONE rather than reimplemented behind the same name.
  assert.equal(/export\s+(async\s+)?function\s+fetchPartMasterList/.test(src), false,
    "a paged API behind the old name would either lie about completeness or loop until it had everything");
  for (const op of ["readPart", "readPartsByIds", "searchParts", "countParts"]) {
    assert.ok(src.includes(op), `${op} is one of the bounded questions this seam now asks`);
  }
});

test("the Part WRITE seam reaches Render, not the Firebase callables", () => {
  const src = code("services/partMasterCommandClient.js");
  for (const banned of ["firebase/functions", "httpsCallable", "../firebase/firebase"]) {
    assert.equal(src.includes(banned), false, `the Part write seam must not reach ${banned}`);
  }
  assert.ok(src.includes("catalogApiClient"));
});

test("the ALIAS seam reaches Render, including the scanner lookup", () => {
  const src = code("services/partAliasCallableClient.js");
  for (const banned of ["firebase/functions", "httpsCallable", "../firebase/firebase.js"]) {
    assert.equal(src.includes(banned), false, `the alias seam must not reach ${banned}`);
  }
  assert.ok(src.includes("catalogApiClient"));
  // Every alias operation, and the scanner, still exist under their frozen names.
  for (const op of ["listPartAliases", "createPartAlias", "deactivatePartAlias", "reactivatePartAlias",
    "probePartAlias", "lookupScannedPart"]) {
    assert.ok(src.includes(op), `${op} must still be offered`);
  }
});

test("the pickers use the GOVERNED query vocabulary, not browser-side filtering", () => {
  // Extending the server contract was the alternative to fetching the catalogue and narrowing it
  // here. These two hooks are why the contract gained controlType and wholeUnit.
  const whole = code("hooks/useWholeUnitParts.js");
  assert.ok(/searchParts\(\{\s*wholeUnit:\s*true/.test(whole), "the whole-unit picker asks the server");
  assert.equal(whole.includes("firebase/firestore"), false);

  const serial = code("hooks/useSerialTrackedParts.js");
  assert.ok(/searchParts\(\{\s*controlType:/.test(serial), "the serial picker asks the server");
  assert.equal(serial.includes("firebase/firestore"), false);

  // And neither filters an unbounded result in the browser.
  for (const src of [whole, serial]) {
    assert.equal(/\.filter\([^)]*wholeUnit/.test(src), false, "a governed filter belongs in the query");
  }
});

test("every surface that used to read the whole catalogue now names its bounded replacement", () => {
  const src = code("services/partMasterQueries.js");
  assert.ok(src.includes("PART_CATALOGUE_WHOLE_COLLECTION_READ_RETIRED"),
    "the list this cutover had to answer is kept, with the replacement for each");
  for (const surface of ["useCanonicalPartNames", "ReceiveAgainstPurchaseOrder", "WorkOrderPartsPlanEditor",
    "WarehouseManagerHome", "PartsList", "PartDetail"]) {
    assert.ok(src.includes(surface), `${surface} must name what it asks now`);
  }
});

test("NOTHING in the client tries Render and then falls back to Firestore", () => {
  // The shape that hides itself: green in every test, and in production it keeps the retired
  // authority answering for exactly the requests that failed.
  for (const f of files) {
    const src = strip(readFileSync(f, "utf8"));
    if (!/catalogApiClient|searchParts|readPartsByIds/.test(src)) continue;
    const suspicious = /catch[\s\S]{0,400}?(getDocs|collection\(db|httpsCallable)/.test(src);
    assert.equal(suspicious, false, `${rel(f)} appears to fall back to another authority on failure`);
  }
});

// ═══════════════════ THE PART MASTER ADMINISTRATION SCREEN'S READ PATH ═══════════════════
//
// PartMasterList.jsx passed "ZERO client modules read a Catalog collection from Firestore" above for
// the whole life of its Firestore read, because the read was GENERIC: the screen handed a metadata
// descriptor to metadata/firestoreListSource, and counted through useListViewChrome's
// getCountFromServer, and neither file names `parts`. A name-matching census cannot see that. So this
// walks the screen's actual IMPORT GRAPH.
//
// ONE SANCTIONED STOP: services/adminPolicyApiClient.js, the shared identity seam every Render client
// takes its bearer token from (transitional Firebase AUTH identity, IDENTITY_ONLY in the Firebase exit
// guard). It is where the walk ends, and the test pins that catalogApiClient reaches it for the token
// and nothing else.
const IMPORT_RE = /(?:^|[\s;])(?:import|export)\s[^'"]*?from\s*["']([^"']+)["']|^\s*import\s*["']([^"']+)["']/gm;
const DYNAMIC_IMPORT_RE = /\bimport\(\s*["']([^"']+)["']\s*\)/g;
const IDENTITY_SEAM = "services/adminPolicyApiClient.js";
function resolveLocal(from, spec) {
  for (const ext of ["", ".js", ".jsx", ".ts", ".tsx", "/index.js", "/index.jsx"]) {
    const p = resolve(dirname(from), spec + ext);
    try { if (statSync(p).isFile()) return p; } catch { /* next */ }
  }
  return null;
}
/** Every module the screen LOADS (static imports), and every package specifier any of them imports. */
function staticImportGraph(entry) {
  const seen = new Set();
  const packages = [];
  const stack = [join(SRC, entry)];
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    if (rel(f) === IDENTITY_SEAM) continue;
    const src = strip(readFileSync(f, "utf8"));
    for (const m of src.matchAll(IMPORT_RE)) {
      const spec = m[1] ?? m[2];
      if (spec.startsWith(".")) { const r = resolveLocal(f, spec); if (r) stack.push(r); }
      else packages.push({ from: rel(f), spec });
    }
  }
  return { modules: [...seen].map(rel).sort(), packages };
}

test("PartMasterList's read path loads NOTHING from Firebase and no Firestore list source", () => {
  const { modules, packages } = staticImportGraph("modules/inventory/PartMasterList.jsx");
  // The read path is really on the graph -- this is not a vacuous walk.
  for (const m of ["services/partMasterPageQuery.js", "services/partMasterQueries.js", "services/catalogApiClient.js", "hooks/useListViewChrome.js"]) {
    assert.ok(modules.includes(m), `${m} should be on PartMasterList's import graph`);
  }
  const firebase = packages.filter((p) => /(^|\/)firebase(\/|$)|^firebase/.test(p.spec));
  assert.deepEqual(firebase, [], "no module PartMasterList loads may import a Firebase package");
  for (const m of modules) {
    assert.equal(/(^|\/)firebase\/firebase(\.js)?$/.test(m), false, `${m}: the Firebase app module must not be loaded`);
    assert.notEqual(m, "metadata/firestoreListSource.js", "the Firestore list source must not be loaded");
  }
  // The identity seam is reached only by the Catalog client, for the token.
  const catalogClient = code("services/catalogApiClient.js");
  assert.match(catalogClient, /import \{ currentIdToken, policyApiBaseUrl \} from "\.\/adminPolicyApiClient\.js"/);
});

test("the Part Master page and total reach the Render Catalog API, with no Firestore anywhere in the seam", () => {
  const page = code("services/partMasterPageQuery.js");
  for (const banned of ["firebase", "firestoreListSource", "getDocs", "getCountFromServer", "collection(", "fetchPage("]) {
    assert.equal(page.includes(banned), false, `partMasterPageQuery must not reach ${banned}`);
  }
  assert.ok(page.includes("searchPartsInServerOrder"), "the page is a governed searchParts call");
  assert.ok(page.includes("countParts"), "the total is a governed countParts call");
  // The screen injects the Catalog count; the Firestore aggregate in useListViewChrome is loaded only on
  // the branch that is NOT given one, so it is neither loaded nor run for this screen.
  const screen = code("modules/inventory/PartMasterList.jsx");
  assert.match(screen, /count: countPartMaster/);
  assert.match(screen, /useListViewChrome\(partIndexList, partEntity, criteria, apply, CHROME_OPTIONS\)/);
  const chrome = code("hooks/useListViewChrome.js");
  assert.equal(/^\s*import\s[^;]*["']firebase\//m.test(chrome), false, "no STATIC Firebase import in the shared chrome hook");
  assert.match(chrome, /injectedCount \? await injectedCount\(descriptor\) : await firestoreCount\(entity, descriptor\)/,
    "an injected count is the ONLY count consulted -- no Firestore fallback when it fails");
  // A refusal is the screen's DENIED state, from the Catalog client's own vocabulary.
  assert.match(screen, /isPartMasterReadDenied\(result\.code\) \? "denied" : "error"/);
  assert.equal(screen.includes('"permission-denied"'), false, "the Catalog client never returns Firestore's permission-denied");
});
