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

test("eos_ops names no Firestore collection as its persistence", () => {
  // The collections this migration deliberately does NOT read or write. Naming one here would mean
  // an operational command quietly reached into the Firestore-authoritative reference data this
  // tranche explicitly leaves alone (warehouses, bins, trucks, cycle_counts).
  const COLLECTIONS = ['"cycle_counts"', '"warehouses"', '"bins"', '"inventory_transactions"', '"serialized_assets"'];
  const offences = [];
  for (const file of sourceFiles(OPS_DIR)) {
    const source = readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    for (const name of COLLECTIONS) {
      if (source.includes(name)) offences.push(`${file}: references ${name} outside a comment`);
    }
  }
  assert.deepEqual(offences, [], "eos_ops reads and writes only eos_ops / eos_policy Postgres tables");
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
