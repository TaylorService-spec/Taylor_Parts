// EOS Administration policy — the FIREBASE REGRESSION GUARD.
//
// The target architecture reduces Firebase to identity. Firestore must never become the persistence
// layer for anything this subsystem creates: no Object, Field, Role, permission, Role assignment,
// access version or Workflow definition.
//
// This is a STATIC check over the source, deliberately. A runtime test proves the code did not call
// Firestore on the paths it happened to exercise; this proves the import is not there to call, on
// every path, including the ones nobody wrote a test for yet.
//
// If a migration adapter is ever needed -- reading Firestore to move existing policy across -- it
// goes in its own file, is marked transitional, and is added to the allowlist below with a reason.
// The allowlist is empty today.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const POLICY_DIR = "src/adminPolicy";

/**
 * Files permitted to read Firestore for MIGRATION only. Each needs a reason, and today there are none.
 *
 * The former entry, migration/firestorePolicyParityHarness.ts, was replaced by migration/roleAssignmentCensus.ts,
 * which reaches BOTH stores through injected readers and imports no Firebase module at all. The one legacy read
 * lives in functions/scripts/roleAssignmentCensusCli.js (FIREBASE_EXIT_MIGRATION_ONLY), outside this subsystem.
 */
const TRANSITIONAL_ADAPTERS = Object.freeze({});

/** Windows and POSIX spell the same path differently; the allowlist should not have to care. */
const isTransitional = (file) =>
  Object.prototype.hasOwnProperty.call(TRANSITIONAL_ADAPTERS, file) ||
  Object.prototype.hasOwnProperty.call(TRANSITIONAL_ADAPTERS, file.replace(/\//g, "\\"));

/**
 * Source with comments removed.
 *
 * Every check here is about CODE. A header explaining why a layer must never touch Firestore is
 * exactly the comment that should survive -- banning the word outright would delete the reasoning
 * along with the coupling, which is how a boundary loses the note saying why it exists.
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

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
  { pattern: /\bdb\s*\.\s*collection\s*\(/, what: "a Firestore collection() call" },
];

test("no Admin policy module imports Firebase or Firestore", () => {
  const offences = [];
  for (const file of sourceFiles(POLICY_DIR)) {
    if (isTransitional(file)) continue;
    const source = readFileSync(file, "utf8");
    for (const { pattern, what } of FORBIDDEN) {
      if (pattern.test(source)) offences.push(`${file}: ${what}`);
    }
  }
  assert.deepEqual(offences, [], "the policy model must not be persisted in, or coupled to, Firebase");
});

test("no Admin policy module writes a Firestore document", () => {
  // The write verbs specifically. An import guard alone would miss a write reached through a handle
  // passed in from elsewhere, which is exactly how a "just for now" write gets added later.
  const WRITES = [/\.\s*set\s*\(/, /\.\s*add\s*\(/, /\.\s*update\s*\(/, /\.\s*delete\s*\(/, /\bwriteBatch\s*\(/, /\brunTransaction\s*\(/];
  const offences = [];
  for (const file of sourceFiles(POLICY_DIR)) {
    if (isTransitional(file)) continue;
    const source = readFileSync(file, "utf8");
    // `tx.set...` on the policy port is this subsystem's own vocabulary and is not a Firestore call,
    // so the check is anchored to a Firestore-shaped receiver rather than to the verb alone.
    const firestoreShaped = /\b(?:doc|collection|docRef|batch|firestore)\s*(?:\([^)]*\))?\s*\./g;
    for (const write of WRITES) {
      const combined = new RegExp(firestoreShaped.source + write.source);
      if (combined.test(source)) offences.push(`${file}: a Firestore-shaped write`);
    }
  }
  assert.deepEqual(offences, [], "no new Firestore business writes");
});

// ════════════════════ the collection-name probe ════════════════════
//
// A collection NAME is only evidence of Firestore persistence when something HANDS IT TO a
// Firestore accessor. The bare-substring form of this check -- `code.includes('"users"')` over a
// literal list -- was a false-positive generator: it failed on `"users"` in ADMINISTRATION_SURFACES,
// a UI surface key with no Firestore receiver anywhere near it, and the only way to appease it was
// to rename a legitimate EOS concept. That is a guard training people to damage the code.
//
// So this check is ANCHORED TO A FIRESTORE-SHAPED RECEIVER, exactly as the sibling check
// "no Admin policy module writes a Firestore document" above anchors its write verbs, and as
// "the transitional harness is READ ONLY against Firestore" below says a bare verb list is too
// broad. The same reasoning applies to a bare NAME list.
//
// This is strictly STRONGER than what it replaces, not weaker: the old probe missed `'users'` in
// single quotes, missed a backtick path, and missed a name held in a variable. All three are
// refused now, and the proof is in "the guard would actually catch an offence" below.

/** The Firestore accessors that take a collection or a document path, in both SDK spellings. */
const FIRESTORE_ACCESSOR = "(?:collection|collectionGroup|doc|docRef)";

/** Receivers and handles that only a Firestore caller holds. */
const FIRESTORE_HANDLE =
  "(?:db|firestore|firestoreDb|docRef|batch|bulkWriter|getFirestore\\s*\\(\\s*\\)|(?:admin\\s*\\.\\s*)?firestore\\s*\\(\\s*\\))";

/**
 * A Firestore accessor reached from a Firestore handle, WHATEVER it was handed.
 *
 * `db.collection(SOME_CONST)` and `collection(db, name)` are the shapes that hide the collection
 * name behind a variable or a computed string. There is no legitimate reason for this subsystem to
 * hold one at all, so the shape alone is the offence and the argument does not have to be readable.
 */
function opaqueFirestoreAccess(code) {
  return (
    new RegExp(`\\b${FIRESTORE_HANDLE}\\s*\\.\\s*${FIRESTORE_ACCESSOR}\\s*\\(`).test(code) ||
    new RegExp(`\\b${FIRESTORE_ACCESSOR}\\s*\\(\\s*${FIRESTORE_HANDLE}\\b`).test(code)
  );
}

/**
 * A banned collection name REACHING a Firestore accessor. Two routes, because a name can arrive
 * directly or through one hop:
 *
 *   direct   db.collection("users") / collection(db, "users") / doc(db, "users", uid) /
 *            db.doc(`users/${uid}`) / .doc("tenants/t1/users/u1") / db.collection('users')
 *   bound    const COLLECTION = "users";  ...  store.collection(COLLECTION)
 *
 * The quote style and the `users/` path form are the anchor's job now, which is why the old
 * '"users"' and "users/" list entries are gone: they were spellings of one name, and spelling them
 * out is exactly what made the probe match a plain string.
 */
function namesFirestoreCollection(code, name) {
  if (new RegExp(`\\b${FIRESTORE_ACCESSOR}\\s*\\(\\s*[^)]*?['"\`][^'"\`]*\\b${name}\\b`).test(code)) return true;
  const bindings = code.matchAll(
    new RegExp(`\\b(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)[^=\\n]*=\\s*['"\`][^'"\`]*\\b${name}\\b`, "g"),
  );
  for (const [, bound] of bindings) {
    if (new RegExp(`\\b${FIRESTORE_ACCESSOR}\\s*\\([^)]*\\b${bound}\\b`).test(code)) return true;
  }
  return false;
}

/**
 * The collections this subsystem REPLACES, as BARE names. Naming one in code would mean the policy
 * model had quietly gone back to living in Firestore under a different function name.
 *
 * `accessVersion` is deliberately NOT in this list, and the distinction matters: it is this
 * subsystem's own field name (`principal_access_versions.access_version`, and
 * `accessVersionAtGrant` on an assignment). What is banned is the Firestore LOCATION --
 * `users/{uid}.accessVersion` -- not the concept, which EOS now owns. `users` is here as a
 * COLLECTION, which is why it is only an offence when a Firestore accessor is holding it.
 */
const COLLECTIONS = ["roleAssignments", "users"];

test("the policy modules name no Firestore collection as their persistence", () => {
  const offences = [];
  for (const file of sourceFiles(POLICY_DIR)) {
    // The parity harness NAMES these collections on purpose -- reading them is its entire job, and
    // it is the one file allowed to. Its allowlist entry carries the reason and the condition under
    // which it gets deleted.
    if (isTransitional(file)) continue;
    // Comments are where these SHOULD appear -- explaining what was replaced and why. Strip them and
    // check the code, so the reasoning stays and the coupling cannot come back.
    const code = stripComments(readFileSync(file, "utf8"));
    if (opaqueFirestoreAccess(code)) offences.push(`${file}: a Firestore collection/document accessor`);
    for (const name of COLLECTIONS) {
      if (namesFirestoreCollection(code, name)) offences.push(`${file}: hands "${name}" to a Firestore accessor`);
    }
  }
  assert.deepEqual(offences, [], "the access version and role assignments live in EOS storage, not Firestore");
});

// The TWO files allowed to know what a database is. Everything else receives a repository and has
// no other way to reach storage. Named individually rather than by a directory, so adding a third
// is a deliberate edit to this list and shows up in review.
const DATABASE_LAYER = Object.freeze([
  "src\\adminPolicy\\policyDatabase.ts",
  "src\\adminPolicy\\postgresPolicyRepository.ts",
]);
const isDatabaseLayer = (file) => DATABASE_LAYER.includes(file) || DATABASE_LAYER.includes(file.replace(/\//g, "\\"));

test("the DAL port is the only way the policy modules reach storage", () => {
  // Nothing outside the database layer may construct a client, open a connection, or read the
  // environment variable that would let it.
  const offences = [];
  for (const file of sourceFiles(POLICY_DIR)) {
    if (isDatabaseLayer(file)) continue;
    const source = readFileSync(file, "utf8");
    if (/\bnew\s+(?:Pool|Client)\s*\(/.test(source)) offences.push(`${file}: constructs a database client`);
    if (/process\.env\./.test(source)) offences.push(`${file}: reads process.env`);
    if (/\bfetch\s*\(/.test(source)) offences.push(`${file}: makes a network call`);
    if (/from\s+["']pg["']/.test(source)) offences.push(`${file}: imports the postgres driver`);
  }
  assert.deepEqual(offences, [], "storage is reached only through the injected repository");
});

test("the database layer is exactly the two files it is meant to be", () => {
  // The allowlist above is only as good as its accuracy. If a third file starts importing pg, this
  // fails -- rather than the allowlist quietly covering it.
  const importers = sourceFiles(POLICY_DIR).filter((file) => /from\s+["']pg["']/.test(readFileSync(file, "utf8")));
  assert.deepEqual(
    importers.map((f) => f.replace(/\//g, "\\")).sort(),
    [...DATABASE_LAYER].sort(),
    "only the pool factory and the Postgres adapter may import the driver",
  );
});

test("no SQL is written outside the Postgres adapter", () => {
  // SQL in a command or a resolver is the database implementation leaking upward -- the exact
  // boundary the DAL exists to hold. The adapter owns every statement.
  const SQL = /\b(?:SELECT|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|CREATE\s+TABLE)\b/;
  const offences = [];
  for (const file of sourceFiles(POLICY_DIR)) {
    if (isDatabaseLayer(file)) continue;
    const source = readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    if (SQL.test(source)) offences.push(`${file}: contains SQL`);
  }
  assert.deepEqual(offences, [], "SQL stops at the adapter");
});

test("POSTGRES PROOF: the database layer persists policy in Postgres and nowhere else", () => {
  // Owner ruling item 11. The adapter is the file most likely to acquire a "just for now" Firestore
  // read during a migration, so it gets its own assertion rather than sharing the general one.
  for (const file of DATABASE_LAYER.map((f) => f.replace(/\\/g, "/"))) {
    const source = readFileSync(file, "utf8");
    for (const { pattern, what } of FORBIDDEN) {
      assert.equal(pattern.test(source), false, `${file} must not contain ${what}`);
    }
    // CODE, not comments. A header explaining why this layer must never touch Firestore is exactly
    // the comment that should survive -- banning the word outright would delete the reasoning along
    // with the coupling, which is how a boundary loses the note saying why it exists.
    assert.equal(/firebase/i.test(stripComments(source)), false, `${file} must not reference firebase in code`);
  }
});

test("the Postgres adapter parameterises every value it sends", () => {
  // A column name is chosen from a literal list in this adapter; a VALUE never is. Template
  // interpolation inside a SQL string is how a caller's data becomes SQL text, so the only
  // interpolation permitted in a query is the schema constant.
  const source = readFileSync("src/adminPolicy/postgresPolicyRepository.ts", "utf8");
  const interpolations = [...source.matchAll(/\$\{([^}]+)\}/g)].map((m) => m[1].trim());
  const allowed = new Set(["SCHEMA", "sets.join(\", \")", "values.length", "values.length - 1", "column", "kind", "table", "row.version", "row.status", "input.key"]);
  const unexpected = interpolations.filter((expr) => !allowed.has(expr));
  assert.deepEqual(unexpected, [], "only the schema name and locally-built fragments may be interpolated");
});

test("the guard would actually catch an offence", () => {
  // A validator that runs on nothing is worse than none. This proves the patterns match what they
  // claim to, so the four passing tests above mean something.
  // A CALL, not merely the import of one: `\bgetFirestore\s*\(` deliberately does not fire on
  // `import { getFirestore }`, since the import pattern already covers that and double-reporting
  // one offence as two would make the count meaningless.
  const sample = [
    'import { getFirestore } from "firebase-admin/firestore";',
    "const db = getFirestore();",
    'const x = db.collection("roleAssignments");',
  ].join("\n");
  const hits = FORBIDDEN.filter(({ pattern }) => pattern.test(sample)).map((f) => f.what);
  assert.ok(hits.includes('import from "firebase-admin/firestore"'), "catches the import");
  assert.ok(hits.includes("a getFirestore() call"), "catches the call");
  assert.ok(hits.includes("a Firestore collection() call"), "catches the collection access");

  // The whole fence as the guards above apply it: the import/call patterns, plus the anchored
  // collection probe. `refused` is the single predicate the controls below are stated against, so a
  // shape cannot pass by slipping between two tests.
  const refused = (source) => {
    const code = stripComments(source);
    return (
      FORBIDDEN.some(({ pattern }) => pattern.test(code)) ||
      opaqueFirestoreAccess(code) ||
      COLLECTIONS.some((name) => namesFirestoreCollection(code, name))
    );
  };

  // ════════ POSITIVE CONTROL: the shapes this fence exists to catch ════════
  //
  // Every line is a REAL prohibited Firestore access and must be refused. Both SDK spellings, both
  // quote styles, the path form, the admin SDK, and -- the ones the old bare-substring probe could
  // never see -- a template literal and a collection name held in a variable.
  const PROHIBITED = [
    ["const db = getFirestore();", "a getFirestore() handle"],
    ['import { getFirestore } from "firebase-admin/firestore";', "the modular admin import"],
    ['import admin from "firebase-admin";', "the admin SDK root import"],
    ['import { getFirestore } from "firebase/firestore";', "the web SDK import"],
    ["await ref.set({ role }, { merge: true, updatedAt: FieldValue.serverTimestamp() });", "a FieldValue"],
    ['const ref = db.collection("users");', "db.collection(literal)"],
    ["const ref = db.collection('users');", "db.collection(single-quoted literal)"],
    ['const ref = db.collection("roleAssignments").doc(id);', "db.collection() on the replaced collection"],
    ['const snap = await firestore().collection("users").get();', "firestore().collection()"],
    ['const snap = await admin.firestore().collection("users").get();', "admin.firestore().collection()"],
    ['const snap = await getFirestore().collection("roleAssignments").get();', "getFirestore().collection()"],
    ['const ref = doc(db, "users", uid);', "the modular doc(db, name, id)"],
    ['const col = collection(db, "users");', "the modular collection(db, name)"],
    ['const col = collectionGroup(db, "roleAssignments");', "a collection group"],
    ["const ref = db.doc(`users/${uid}`);", "a template-literal document path"],
    ['const ref = db.doc("users/" + uid);', "a concatenated document path"],
    ['const ref = db.doc("tenants/t1/users/u1");', "a nested path segment"],
    ['await writeBatch(db).set(doc(db, "roleAssignments", id), row);', "a batched modular write"],
    ['const COLLECTION = "users";\nconst ref = store.collection(COLLECTION);', "a collection name held in a constant"],
    ["const path = `users/${uid}`;\nconst ref = store.doc(path);", "a collection name held in a template literal"],
    // A receiver NOT named `db`/`firestore`, so nothing but the name-in-accessor clause can see it.
    // The first of these is a hole in the OLD probe: single quotes, so `includes('"users"')` missed it.
    ["const ref = store.collection('users');", "an accessor on a differently-named handle"],
    ["const ref = client.collectionGroup('roleAssignments');", "a collection group on a differently-named handle"],
    // No literal ANYWHERE and no `db.` receiver, so only the handle-shape clause can see these. The
    // old probe was blind to both: there is no substring of a collection name to find.
    ["const col = collection(db, tableName);", "the modular SDK with the name in a variable"],
    ["const ref = doc(db, tableName, id);", "a modular document handle with the name in a variable"],
    ["const snap = await firestore().collection(tableName).get();", "a namespaced handle with the name in a variable"],
  ];
  for (const [source, what] of PROHIBITED) {
    assert.ok(refused(source), `the fence must refuse ${what} -- ${JSON.stringify(source)}`);
  }

  // ════════ REGRESSION: every true positive the OLD bare-substring probe caught ════════
  //
  // The old probe was `code.includes(name)` over ["roleAssignments", "users/", '"users"']. It is
  // being REPLACED, not relaxed. Each real Firestore access it would have caught -- one entry per
  // old list member, in the spellings that made it match -- is still refused here. Trading a false
  // positive for a false negative would be worse than the bug being fixed.
  const OLD_PROBE_TRUE_POSITIVES = [
    // ... caught by the old "roleAssignments" entry
    'const x = db.collection("roleAssignments");',
    'await getFirestore().collection("roleAssignments").doc(id).set(row);',
    'const col = collection(db, "roleAssignments");',
    'const ref = doc(db, "roleAssignments", id);',
    // ... caught by the old "users/" entry
    'const ref = db.doc("users/" + uid);',
    "const ref = db.doc(`users/${uid}`);",
    'const ref = db.collection("users/" + uid + "/tokens");',
    'const ref = db.doc("tenants/t1/users/u1");',
    // ... caught by the old '"users"' entry
    'const ref = db.collection("users");',
    'const ref = doc(db, "users", uid);',
    'const ref = admin.firestore().collection("users");',
    'const COLLECTION = "users";\nconst ref = db.collection(COLLECTION);',
  ];
  for (const source of OLD_PROBE_TRUE_POSITIVES) {
    assert.ok(refused(source), `the old probe caught this and the new one must too -- ${JSON.stringify(source)}`);
  }

  // ════════ NEGATIVE CONTROL: legitimate EOS code that must PASS ════════
  //
  // A surface key, a Set, and the policy port's own vocabulary. None of these is a Firestore access
  // and none of them may be made to look like one by a probe.
  const LEGITIMATE = [
    [
      'export const ADMINISTRATION_SURFACES = Object.freeze([\n  "overview",\n  "objects",\n' +
        '  "rolesPermissions",\n  "users",\n  "workflows",\n  "permissionPreview",\n  "auditLogs",\n] as const);',
      "the Administration surface keys",
    ],
    ['const surface: AdministrationSurface = "users";', "a surface-typed constant"],
    ['if (surface === "users") return "admin.users.read";', "a surface comparison"],
    ["const principals = new Set<string>();\nprincipals.add(uid);", "a JavaScript Set"],
    ["await tx.setRoleAssignment(row);", "the policy port's own vocabulary"],
    ["const roleAssignmentsForPrincipal = await repository.listRoleAssignments(principalId);", "the EOS repository read"],
  ];
  for (const [source, what] of LEGITIMATE) {
    assert.equal(refused(source), false, `the fence must not fire on ${what} -- ${JSON.stringify(source)}`);
  }

  // And the real file the bare-substring probe tripped on, verbatim from disk. This is the
  // regression itself: `"users"` is the 4th ADMINISTRATION_SURFACES element, a UI surface key.
  const surfaceAuthority = stripComments(readFileSync("src/adminPolicy/administrationSurfaceAuthority.ts", "utf8"));
  assert.ok(surfaceAuthority.includes('"users"'), "the surface key is still there -- no production code was renamed");
  assert.equal(opaqueFirestoreAccess(surfaceAuthority), false, "and it holds no Firestore accessor");
  for (const name of COLLECTIONS) {
    assert.equal(
      namesFirestoreCollection(surfaceAuthority, name),
      false,
      `administrationSurfaceAuthority.ts hands "${name}" to nothing`,
    );
  }
});

// ════════════════════ the transitional allowlist ════════════════════
//
// An allowlist is a hole in a guard. These keep it the size it was meant to be.

test("every transitional entry names a real file and carries a reason", () => {
  const files = new Set(sourceFiles(POLICY_DIR).map((f) => f.replace(/\//g, "\\")));
  for (const [file, reason] of Object.entries(TRANSITIONAL_ADAPTERS)) {
    assert.ok(files.has(file), `${file} is allowlisted but does not exist -- stale entry`);
    assert.ok(reason.length > 80, `${file}'s reason must explain itself, not just assert`);
    assert.match(reason, /DELETE/, `${file}'s reason must say when it goes away`);
  }
});

test("the transitional harness is READ ONLY against Firestore", () => {
  // The allowlist buys it a READ. It does not buy it a write, and the difference is the whole
  // reason the migration cannot quietly become a dual-write.
  // ANCHORED TO A FIRESTORE-SHAPED RECEIVER, like the sibling check above. A bare verb list is too
  // broad to be useful here: `principals.add(uid)` is a JavaScript Set, and failing on it would
  // train somebody to loosen the guard rather than fix a real write.
  const firestoreShaped = /\b(?:doc|collection|docRef|batch|firestore)\s*(?:\([^)]*\))?\s*\./;
  const WRITE_VERBS = [/set\s*\(/, /add\s*\(/, /update\s*\(/, /delete\s*\(/, /create\s*\(/];
  for (const file of Object.keys(TRANSITIONAL_ADAPTERS)) {
    const code = stripComments(readFileSync(file.replace(/\\/g, "/"), "utf8"));
    for (const verb of WRITE_VERBS) {
      const combined = new RegExp(firestoreShaped.source + verb.source);
      assert.equal(combined.test(code), false, `${file}: a Firestore write appears in a read-only harness`);
    }
    for (const bulk of [/\bwriteBatch\s*\(/, /\brunTransaction\s*\(/, /\bbulkWriter\s*\(/]) {
      assert.equal(bulk.test(code), false, `${file}: a Firestore bulk writer appears in a read-only harness`);
    }
  }
});

test("NOTHING in the running system imports the transitional harness", () => {
  // A dual read is what this becomes if a resolver, a command or a callable starts calling it. The
  // check is repo-wide rather than directory-wide, because the import that would matter most is the
  // one from outside this subsystem.
  //
  // conditionKindInventory.ts and effectiveAccessParity.ts are held to the SAME rule and named in both patterns.
  // The parity comparator in particular must stay out of the product: it decides nothing at request time, and a
  // runtime that imported it would be consulting a migration proof instead of the authority. Both are migration-only
  // (it classifies the live Conditions for the evaluator-parity work and decides no access), so the product
  // must not import it either -- and it is skipped as a SOURCE because its own documentation necessarily
  // names the census it feeds. The match is on text, not on imports, so a module that explains a sibling
  // would otherwise be indistinguishable from one that calls it.
  const roots = ["src", "../field-ops-app-vite/src"];
  const offenders = [];
  const walk = (dir) => {
    let entries = [];
    try { entries = readdirSync(dir); } catch { return; }
    for (const entry of entries) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) { walk(path); continue; }
      if (!/\.(ts|tsx|js|jsx|mjs)$/.test(entry)) continue;
      if (/firestorePolicyParityHarness|roleAssignmentCensus\.ts$|conditionKindInventory\.ts$|legacyConsumerLedger\.ts$|effectiveAccessParity\.ts$/.test(path)) continue;
      if (/firestorePolicyParityHarness|roleAssignmentCensus|conditionKindInventory|legacyConsumerLedger|effectiveAccessParity/.test(readFileSync(path, "utf8"))) offenders.push(path);
    }
  };
  for (const root of roots) walk(root);
  assert.deepEqual(offenders, [], "the parity harness is run by a person, never by the product");
});

test("the role assignment census holds NO write path in either store", () => {
  // It succeeded the parity harness and is Firebase-free, so the general guards above already cover its imports.
  // What they do not cover is the POLICY side: a census holding a transaction handle could "repair" what it finds,
  // destroying the evidence that drift existed.
  const code = stripComments(readFileSync("src/adminPolicy/migration/roleAssignmentCensus.ts", "utf8"));
  for (const verb of [/\btransact\s*\(/, /\bappendAudit\s*\(/, /\bcreate(?!Hash\b)[A-Z]\w*\s*\(/, /\bset[A-Z]\w*\s*\(/, /\bbump[A-Z]\w*\s*\(/, /\bupdate[A-Z]\w*\s*\(/]) {
    assert.equal(verb.test(code), false, `the census must not call ${verb}`);
  }
  assert.doesNotMatch(code, /PolicyRepository\b|PolicyTransaction\b/, "it takes the READ port only");
});
