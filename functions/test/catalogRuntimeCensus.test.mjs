// THE CATALOG RUNTIME CENSUS, derived from the repository rather than asserted.
//
// The census is a claim about what still reaches Firestore for a Part. A claim nobody checks is how
// the Reorder gate once read ZERO while a live Firestore writer sat in the receiving path, so this
// suite re-derives the consumer set from the source and asserts the two correspond in BOTH
// directions: nothing in the code is missing from the census, and nothing in the census has quietly
// stopped being a consumer.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const C = await import("../lib/catalogMaster/catalogRuntimeCensus.js");
const HTTP = await import("../lib/catalogMaster/catalogHttp.js");

/** Executable text only: a collection named in a comment reaches nothing. */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
const walk = (d, o = []) => {
  try {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      statSync(p).isDirectory() ? walk(p, o) : /\.(ts|tsx|js|jsx|mjs)$/.test(e) && o.push(p);
    }
  } catch { /* a missing root is not a consumer */ }
  return o;
};
const rel = (f) => relative(REPO, f).split("\\").join("/");

const COLLECTION_OBJECT = Object.freeze({
  parts: "PART",
  part_aliases: "PART_ALIAS",
  equipment_models: "EQUIPMENT_MODEL",
});
const SELF = "functions/src/catalogMaster/catalogRuntimeCensus.ts";

/** (path, OBJECT) -> unqualified occurrences. A schema-qualified name is PostgreSQL, not Firestore. */
function derive() {
  const files = [];
  for (const r of ["functions/src", "field-ops-app-vite/src"]) walk(join(REPO, r), files);
  const found = new Map();
  for (const f of files) {
    const path = rel(f);
    if (path === SELF) continue;
    const src = strip(readFileSync(f, "utf8"));
    for (const [collection, object] of Object.entries(COLLECTION_OBJECT)) {
      // A QUOTED collection name, not the bare word. `parts` is an extremely common English word and
      // an object key; matching it bare measured prose and property names rather than Firestore
      // access. A quoted literal is what a collection reference actually looks like.
      //
      // A SCHEMA QUALIFIER MEANS POSTGRESQL, and it takes three forms, not one: the literal
      // `eos_ops.` prefix, the `${SCHEMA}.` the repositories interpolate, and a SEPARATE QUOTED
      // ARGUMENT -- `has("eos_ops", "parts", ...)` names a PostgreSQL column and no Firestore
      // collection at all. Missing the third form made a PostgreSQL schema probe look like a
      // Firestore consumer.
      const re = new RegExp(`(eos_ops\\.|\\$\\{SCHEMA\\}\\.)?["']${collection}["']`, "g");
      let n = 0, m;
      while ((m = re.exec(src))) {
        if (m[1]) continue;
        const line = src.slice(src.lastIndexOf("\n", m.index) + 1, src.indexOf("\n", m.index));
        if (/["'](eos_ops|eos_policy|eos_finance|eos_crm|eos_commercial|eos_workforce)["']/.test(line)) continue;
        n += 1;
      }
      if (n > 0) found.set(`${path}|${object}`, n);
    }
  }
  return found;
}

test("the census key is (path, OBJECT), never path alone", () => {
  // The defect this inherits from the Reorder census: a file touching two objects got ONE row, and
  // the second object vanished. partMasterCommands.ts writes a Part AND an alias.
  // ownershipMatrix.ts names all three catalog objects, and salesAgreementLineReferences.ts resolves
  // both a Part and an Equipment Model. Under a one-row-per-file census the second and third object
  // would vanish, which is exactly how a live consumer once went unrecorded.
  const matrix = C.CATALOG_RUNTIME_CENSUS
    .filter((c) => c.path === "functions/src/ownership/ownershipMatrix.ts")
    .map((c) => c.object).sort();
  assert.deepEqual(matrix, ["EQUIPMENT_MODEL", "PART", "PART_ALIAS"]);
  const refs = C.CATALOG_RUNTIME_CENSUS
    .filter((c) => c.path === "functions/src/salesAgreement/salesAgreementLineReferences.ts")
    .map((c) => c.object).sort();
  assert.deepEqual(refs, ["EQUIPMENT_MODEL", "PART"]);
});

test("every census entry is classified from the closed vocabulary and names its object", () => {
  for (const c of C.CATALOG_RUNTIME_CENSUS) {
    assert.ok(C.CATALOG_RUNTIME_CLASSIFICATIONS.includes(c.classification), `${c.path}: ${c.classification}`);
    assert.ok(C.CATALOG_OBJECTS.includes(c.object), `${c.path}: ${c.object}`);
    assert.ok(typeof c.consumer === "string" && c.consumer.length > 20, `${c.path}: say what it does`);
  }
  const keys = C.CATALOG_RUNTIME_CENSUS.map((c) => `${c.path}|${c.object}`);
  assert.equal(new Set(keys).size, keys.length, "one entry per (path, object)");
});

test("every BLOCKING census entry is a real consumer in the repository", () => {
  // The direction that catches a census claiming something is still a consumer when it is not --
  // which would hold the gate shut forever for no reason.
  const derived = derive();
  for (const c of C.CATALOG_RUNTIME_CENSUS) {
    if (!C.CATALOG_ACTIVATION_BLOCKING.includes(c.classification)) continue;
    if (c.path === "firestore.rules") continue;
    assert.ok(derived.has(`${c.path}|${c.object}`),
      `${c.path} is censused as a ${c.object} consumer but names no unqualified collection`);
  }
});

test("NOTHING in the repository reaches a Catalog collection without being censused", () => {
  // The direction that matters most. A new consumer added anywhere fails this until it is
  // classified, which is the only thing that keeps the gate honest as the code changes.
  const derived = derive();
  const censused = new Set(C.CATALOG_RUNTIME_CENSUS.map((c) => `${c.path}|${c.object}`));
  const missing = [...derived.keys()].filter((k) => !censused.has(k));
  assert.deepEqual(missing, [],
    "classify each of these in catalogRuntimeCensus.ts, or stop reaching the collection");
});

test("the gate is OPEN only at ZERO runtime consumers, and a fallback always blocks", () => {
  const readiness = C.catalogActivationReadiness();
  assert.equal(readiness.ready, false, "nothing has been cut over yet; the honest answer is not ready");
  assert.ok(readiness.runtimeConsumerCount > 0);
  assert.deepEqual(readiness.fallbackConsumers, [], "no module falls back to Firestore today");

  // The gate opens ONLY at zero -- not at "only diagnostics", not at "only one".
  assert.equal(C.catalogActivationReadiness([
    { path: "x", object: "PART", classification: "MIGRATION_EVIDENCE", consumer: "evidence, never authority" },
  ]).ready, true);
  assert.equal(C.catalogActivationReadiness([
    { path: "x", object: "PART", classification: "FIRESTORE_RUNTIME_READ", consumer: "one live read is still a live read" },
  ]).ready, false);
});

test("a Render module that FALLS BACK to Firestore is activation-blocking", () => {
  // The failure mode that hides itself: green in every test, and in production it keeps the retired
  // authority answering for exactly the requests that failed.
  assert.ok(C.CATALOG_ACTIVATION_BLOCKING.includes("RENDER_WITH_FIRESTORE_FALLBACK"));
  const withFallback = C.catalogActivationReadiness([
    { path: "client/x.js", object: "PART", classification: "RENDER_WITH_FIRESTORE_FALLBACK", consumer: "tries Render, reads Firestore on error" },
  ]);
  assert.equal(withFallback.ready, false);
  assert.deepEqual(withFallback.fallbackConsumers, ["client/x.js"]);
});

test("activation and Firebase RETIREMENT are different questions", () => {
  // A deployed callable with no repository callers is not dead: it is externally invokable.
  const deployedOnly = [
    { path: "functions/src/partMaster/partMasterCallables.ts", object: "PART", classification: "DEPLOYED_LEGACY_AUTHORITY", consumer: "deployed and externally invokable" },
  ];
  const r = C.catalogActivationReadiness(deployedOnly);
  assert.equal(r.ready, true, "a deployed callable does not block ACTIVATION");
  assert.equal(r.firebaseRetired, false, "but it does block RETIREMENT");
});

test("the Render Catalog API exposes bounded operations, and no 'all parts'", () => {
  assert.deepEqual([...HTTP.CATALOG_READ_OPERATIONS],
    ["readPart", "readPartsByIds", "searchParts", "countParts", "listPartAliases", "probePartAlias", "lookupScannedPart", "listEquipmentModels"]);
  assert.deepEqual([...HTTP.CATALOG_MUTATION_OPERATIONS],
    ["createPart", "updatePart", "changePartStatus", "createPartAlias", "deactivatePartAlias", "reactivatePartAlias"]);
  // There is deliberately no operation that returns the whole catalogue.
  for (const op of [...HTTP.CATALOG_READ_OPERATIONS, ...HTTP.CATALOG_MUTATION_OPERATIONS]) {
    assert.equal(/^(listParts|allParts|getAllParts|fetchPartMasterList)$/.test(op), false, `${op} would re-create the whole-collection read`);
  }
  assert.equal(HTTP.isCatalogOperation("readPart"), true);
  assert.equal(HTTP.isCatalogOperation("runSQL"), false);
  assert.equal(HTTP.isCatalogOperation("listAllParts"), false);
  // Reads and writes do not overlap: an operation is one or the other, never quietly both.
  const reads = new Set(HTTP.CATALOG_READ_OPERATIONS);
  assert.ok(!HTTP.CATALOG_MUTATION_OPERATIONS.some((m) => reads.has(m)));
});

test("the Catalog API resolves an EOS Principal, and never treats a uid as the actor", () => {
  const src = strip(readFileSync(join(REPO, "functions/src/catalogMaster/catalogHttp.ts"), "utf8"));
  assert.ok(src.includes("resolveOperationalContext"), "identity resolves through the governed context");
  assert.ok(/principalId:\s*ctx\.principalContext\.uid/.test(src), "the actor is the EOS Principal id");
});

test("the Render Catalog transport reaches no Firebase package", async () => {
  const src = strip(readFileSync(join(REPO, "functions/src/catalogMaster/catalogHttp.ts"), "utf8"));
  for (const banned of ["firebase-admin", "getFirestore", "firebase-functions"]) {
    assert.equal(src.includes(banned), false, `the Render Catalog transport must not reach ${banned}`);
  }
});

test("the Part Master administration screen is censused as the LIVE Render consumer it is", () => {
  // It was DEAD here while it read Firestore two hops away (partMasterPageQuery -> firestoreListSource,
  // and useListViewChrome's getCountFromServer) -- a name census cannot see a generic reader. The
  // classification now follows its real read path, and that path is checked to be Render-only.
  const entry = C.CATALOG_RUNTIME_CENSUS.find((c) => c.path === "field-ops-app-vite/src/modules/inventory/PartMasterList.jsx");
  assert.equal(entry?.classification, "RENDER_RUNTIME");
  const pageQuery = strip(readFileSync(join(REPO, "field-ops-app-vite/src/services/partMasterPageQuery.js"), "utf8"));
  for (const banned of ["firestoreListSource", "firebase/", "getCountFromServer"]) {
    assert.equal(pageQuery.includes(banned), false, `the Part Master read path must not reach ${banned}`);
  }
  assert.ok(pageQuery.includes("./partMasterQueries.js"), "it reads through the governed Catalog seam");
});
