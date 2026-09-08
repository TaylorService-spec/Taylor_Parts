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
const TRANSITIONAL_ADAPTERS = Object.freeze({});

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
    if (Object.prototype.hasOwnProperty.call(TRANSITIONAL_ADAPTERS, file)) continue;
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
    if (Object.prototype.hasOwnProperty.call(TRANSITIONAL_ADAPTERS, file)) continue;
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

test("the DAL port is the only way the policy modules reach storage", () => {
  // Nothing in this subsystem may construct its own client, open its own connection, or read an
  // environment variable that would let it. The adapter behind the port is the single seam.
  const offences = [];
  for (const file of sourceFiles(POLICY_DIR)) {
    const source = readFileSync(file, "utf8");
    if (/\bnew\s+(?:Pool|Client)\s*\(/.test(source)) offences.push(`${file}: constructs a database client`);
    if (/process\.env\./.test(source)) offences.push(`${file}: reads process.env`);
    if (/\bfetch\s*\(/.test(source)) offences.push(`${file}: makes a network call`);
  }
  assert.deepEqual(offences, [], "storage is reached only through the injected repository");
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
