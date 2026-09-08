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

/** Files permitted to read Firestore for MIGRATION only. Each needs a reason, and today there are none. */
const TRANSITIONAL_ADAPTERS = Object.freeze({
  "src\\adminPolicy\\migration\\firestorePolicyParityHarness.ts":
    "MIGRATION PARITY ONLY, and READ ONLY. It compares the legacy Firestore roleAssignments and " +
    "users/{uid}.accessVersion against the PostgreSQL policy so a cutover can be proved rather than " +
    "assumed. Nothing in the running system calls it, it returns no Firestore data as policy, and " +
    "it has no write path. DELETE it -- and this entry -- once every tenant reports IN_PARITY and " +
    "the legacy collection is unread.",
});

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

test("the policy modules name no Firestore collection as their persistence", () => {
  // The collections this subsystem REPLACES. Naming one in code would mean the policy model had
  // quietly gone back to living in Firestore under a different function name.
  //
  // `accessVersion` is deliberately NOT in this list, and the distinction matters: it is this
  // subsystem's own field name (`principal_access_versions.access_version`, and
  // `accessVersionAtGrant` on an assignment). What is banned is the Firestore LOCATION --
  // `users/{uid}.accessVersion` -- not the concept, which EOS now owns.
  const COLLECTIONS = ["roleAssignments", "users/", '"users"'];
  const offences = [];
  for (const file of sourceFiles(POLICY_DIR)) {
    // The parity harness NAMES these collections on purpose -- reading them is its entire job, and
    // it is the one file allowed to. Its allowlist entry carries the reason and the condition under
    // which it gets deleted.
    if (isTransitional(file)) continue;
    const source = readFileSync(file, "utf8");
    // Comments are where these SHOULD appear -- explaining what was replaced and why. Strip them and
    // check the code, so the reasoning stays and the coupling cannot come back.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    for (const name of COLLECTIONS) {
      if (code.includes(name)) offences.push(`${file}: references "${name}" outside a comment`);
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
  const roots = ["src", "../field-ops-app-vite/src"];
  const offenders = [];
  const walk = (dir) => {
    let entries = [];
    try { entries = readdirSync(dir); } catch { return; }
    for (const entry of entries) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) { walk(path); continue; }
      if (!/\.(ts|tsx|js|jsx|mjs)$/.test(entry)) continue;
      if (path.includes("firestorePolicyParityHarness")) continue;
      if (/firestorePolicyParityHarness/.test(readFileSync(path, "utf8"))) offenders.push(path);
    }
  };
  for (const root of roots) walk(root);
  assert.deepEqual(offenders, [], "the parity harness is run by a person, never by the product");
});
