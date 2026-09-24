// EOS Operational Data Plane -- the FIREBASE REGRESSION GUARD for src/eosOps, mirroring
// test/adminPolicyNoFirebase.test.mjs's guard over src/adminPolicy.
//
// Runtime target: ZERO operational Firestore access from the Render process. This is a STATIC check
// over the source, deliberately -- it proves the import is not there to call, on every path,
// including ones nobody wrote a runtime test for yet.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { namesFirestoreCollection, opaqueFirestoreAccess, stripComments } from "./support/firestoreCollectionFence.mjs";

const OPS_DIR = "src/eosOps";

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) { out.push(...sourceFiles(path)); continue; }
    if (entry.endsWith(".ts")) out.push(path);
  }
  return out;
}

const FORBIDDEN = [
  { pattern: /from\s+["']firebase\/firestore["']/, what: 'import from "firebase/firestore"' },
  { pattern: /from\s+["']firebase-admin\/firestore["']/, what: 'import from "firebase-admin/firestore"' },
  { pattern: /from\s+["']firebase-admin["']/, what: 'import from "firebase-admin"' },
  { pattern: /from\s+["']firebase-functions/, what: 'import from "firebase-functions"' },
  { pattern: /\bgetFirestore\s*\(/, what: "a getFirestore() call" },
  { pattern: /\bFieldValue\b/, what: "a Firestore FieldValue" },
  { pattern: /\bFieldPath\b/, what: "a Firestore FieldPath" },
];

test("no eos_ops module imports Firebase or Firestore", () => {
  const offences = [];
  for (const file of sourceFiles(OPS_DIR)) {
    const source = readFileSync(file, "utf8");
    for (const { pattern, what } of FORBIDDEN) {
      if (pattern.test(source)) offences.push(`${file}: ${what}`);
    }
  }
  assert.deepEqual(offences, [], "the operational data plane must not be coupled to Firebase");
});

// ════════════════════ the reference-data probe ════════════════════
//
// The relations this migration deliberately does NOT read or write: Firestore-authoritative reference
// data this tranche explicitly leaves alone. Held as BARE names, because the probe is now anchored to
// what RECEIVES the name rather than to how it is spelled.
//
// The old form was `source.includes('"warehouses"')` over a list of pre-quoted names, and it was a
// latent false-positive generator: `"bins"` and `"warehouses"` are short enough that the first
// legitimate EOS location-vocabulary literal, display label or union-type member spelling one of them
// would have gone red, with renaming real code as the only way to appease it. That is the defect
// test/adminPolicyNoFirebase.test.mjs already fixed for `"users"`, and the fence it built is shared.
//
// It was also WEAKER than what replaces it. The old form saw only double quotes -- it missed
// `db.collection('bins')`, a backtick path, and a name held in a constant. All are refused now.
const REFERENCE_RELATIONS = ["cycle_counts", "warehouses", "bins", "inventory_transactions", "serialized_assets"];

/** The schemas eos_ops legitimately owns or may read. A qualified relation in one of them is not an offence. */
const EOS_SCHEMA = "(?:eos_ops|eos_policy|eos_workforce|eos_commercial|information_schema)";

/**
 * The name in a SQL RELATION position, unqualified or in a foreign schema.
 *
 * The Firestore clauses alone would not be enough here, and dropping this would be the false negative
 * that makes the fix worse than the bug: eos_ops is a Postgres subsystem, so the realistic way it
 * "quietly reaches into" this reference data is `SELECT ... FROM warehouses`, not a Firestore handle.
 * Every statement eos_ops actually writes is schema-qualified, which is what makes this cheap.
 */
const namesForeignSqlRelation = (code, name) =>
  new RegExp(`\\b(?:FROM|JOIN|INTO|UPDATE)\\s+(?!${EOS_SCHEMA}\\.)["'\`]?(?:[A-Za-z_][\\w$]*\\.)?${name}\\b`, "i").test(code);

/**
 * The whole reference-data fence as ONE predicate -- the three Firestore clauses plus the SQL one --
 * so the controls below are stated against exactly what the guard applies and no shape can pass by
 * slipping between two assertions.
 */
const reachesReferenceData = (code) =>
  opaqueFirestoreAccess(code) ||
  REFERENCE_RELATIONS.some((name) => namesFirestoreCollection(code, name) || namesForeignSqlRelation(code, name));

test("eos_ops names no Firestore collection as its persistence", () => {
  const offences = [];
  for (const file of sourceFiles(OPS_DIR)) {
    // Comments are where these names SHOULD appear -- explaining what this tranche leaves alone and
    // why. Strip them and check the code, so the reasoning stays and the coupling cannot come back.
    const code = stripComments(readFileSync(file, "utf8"));
    if (opaqueFirestoreAccess(code)) offences.push(`${file}: a Firestore collection/document accessor`);
    for (const name of REFERENCE_RELATIONS) {
      if (namesFirestoreCollection(code, name)) offences.push(`${file}: hands "${name}" to a Firestore accessor`);
      if (namesForeignSqlRelation(code, name)) offences.push(`${file}: queries "${name}" as an unqualified SQL relation`);
    }
  }
  assert.deepEqual(offences, [], "eos_ops reads and writes only eos_ops / eos_policy Postgres tables");
});

test("the reference-data fence refuses every route, and passes legitimate EOS vocabulary", () => {
  // ════════ POSITIVE CONTROL: real prohibited access, by both routes ════════
  const PROHIBITED = [
    ['const ref = db.collection("warehouses");', "db.collection(literal)"],
    ["const ref = db.collection('bins');", "the single-quoted spelling the old probe missed"],
    ['const snap = await admin.firestore().collection("cycle_counts").get();', "admin.firestore().collection()"],
    ['const col = collection(db, "serialized_assets");', "the modular collection(db, name)"],
    ['const ref = doc(db, "inventory_transactions", id);', "the modular doc(db, name, id)"],
    ["const ref = db.doc(`warehouses/${id}`);", "a template-literal path the old probe missed"],
    ['const ref = db.doc("warehouses/" + id);', "a concatenated path"],
    ['const C = "bins";\nconst ref = store.collection(C);', "a name held in a constant, which the old probe missed"],
    ["const col = collection(db, table);", "a Firestore handle with the name in a variable"],
    ['await client.query("SELECT * FROM warehouses WHERE id = $1", [id]);', "an unqualified SQL read"],
    ['await client.query("INSERT INTO bins (id) VALUES ($1)", [id]);', "an unqualified SQL write"],
    ['await client.query("UPDATE cycle_counts SET status = $1", [s]);', "an unqualified SQL update"],
    ['await client.query("SELECT * FROM legacy.serialized_assets");', "a foreign-schema read"],
  ];
  for (const [source, what] of PROHIBITED) {
    assert.equal(reachesReferenceData(stripComments(source)), true, `the fence must refuse ${what} -- ${JSON.stringify(source)}`);
  }

  // ════════ REGRESSION: every true positive the OLD bare-substring probe caught ════════
  //
  // The old probe was `source.includes(name)` over the five pre-quoted names. Each real access it
  // would have caught -- one per list member, in the double-quoted spelling that made it match -- is
  // still refused. Trading a false positive for a false negative would be worse than the bug.
  const OLD_PROBE_TRUE_POSITIVES = [
    'const ref = db.collection("cycle_counts");',
    'const ref = db.collection("warehouses");',
    'const ref = db.collection("bins");',
    'const ref = db.collection("inventory_transactions");',
    'const ref = db.collection("serialized_assets");',
    'await client.query("SELECT * FROM cycle_counts");',
    'await client.query("SELECT * FROM inventory_transactions");',
  ];
  for (const source of OLD_PROBE_TRUE_POSITIVES) {
    assert.equal(reachesReferenceData(stripComments(source)), true, `the old probe caught this and the new one must too -- ${JSON.stringify(source)}`);
  }

  // ════════ NEGATIVE CONTROL: legitimate EOS code that must PASS ════════
  //
  // These are the shapes the old probe would have gone red on the moment one appeared. None of them
  // is an access to the reference data, and none may be made to look like one by a probe.
  const LEGITIMATE = [
    ['export const LOCATION_LABELS = Object.freeze({ BIN: "bins", WAREHOUSE: "warehouses" });', "a display-label map"],
    ['type LocationKind = "bins" | "warehouses" | "mobile";', "a union type spelling both short names"],
    ['const bins = rows.filter((r) => r.kind === "BIN");', "a local variable named bins"],
    ['await client.query("SELECT * FROM eos_ops.parts WHERE id = $1", [id]);', "a schema-qualified eos_ops read"],
    ['await client.query("SELECT w.id FROM eos_ops.work_orders w JOIN eos_policy.principals p ON p.id = w.actor");', "a qualified join"],
    ["const serialized_assets_migrated = census.count;", "an EOS identifier containing a banned name"],
    ['const summary = { warehouses: rows.length, bins: binRows.length };', "an object key reporting counts"],
  ];
  for (const [source, what] of LEGITIMATE) {
    assert.equal(reachesReferenceData(stripComments(source)), false, `the fence must not fire on ${what} -- ${JSON.stringify(source)}`);
  }
});

test("eos_ops reuses the ONE existing Postgres connection -- it does not construct its own client or read DATABASE_URL", () => {
  const offences = [];
  for (const file of sourceFiles(OPS_DIR)) {
    const source = readFileSync(file, "utf8");
    if (/\bnew\s+(?:Pool|Client)\s*\(/.test(source)) offences.push(`${file}: constructs a database client`);
    if (/process\.env\.DATABASE_URL/.test(source)) offences.push(`${file}: reads DATABASE_URL directly`);
  }
  assert.deepEqual(offences, [], "eos_ops receives a Pool; it never opens a second connection");
});

test("the operational capability resolver reads no Firebase claim, job title or scanner/truck ownership as authority", () => {
  const source = readFileSync("src/eosOps/capabilityAuthority.ts", "utf8");
  const FORBIDDEN_AUTHORITY = [/customClaims/i, /jobTitle/i, /scannerOwner/i, /truckAssignment/i, /\.role\b/i];
  const offences = FORBIDDEN_AUTHORITY.filter((p) => p.test(source)).map((p) => p.toString());
  assert.deepEqual(offences, [], "the only inputs are the verified subject and eos_policy Role/capability rows");
});

test("the guard would actually catch an offence", () => {
  const sample = [
    'import { getFirestore } from "firebase-admin/firestore";',
    "const db = getFirestore();",
  ].join("\n");
  const hits = FORBIDDEN.filter(({ pattern }) => pattern.test(sample)).map((f) => f.what);
  assert.ok(hits.includes('import from "firebase-admin/firestore"'));
  assert.ok(hits.includes("a getFirestore() call"));
});
