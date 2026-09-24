// LANE D, no database -- the boundary of the PostgreSQL catalog reference authority.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(FUNCTIONS_DIR, "src/catalogAuthority/postgresCatalogReferenceAuthority.ts");
const COMPILED = join(FUNCTIONS_DIR, "lib/catalogAuthority/postgresCatalogReferenceAuthority.js");
const MIGRATION = join(FUNCTIONS_DIR, "migrations/1759795200000_catalog-part-identity-reference-authority.sql");
const require = createRequire(import.meta.url);
const strip = (code) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

test("no Firebase: the source names none, and loading the compiled module resolves no Firebase module", () => {
  const code = strip(readFileSync(SOURCE, "utf8"));
  for (const forbidden of [/firebase/i, /firestore/i, /getFirestore/, /onCall\b/, /HttpsError/, /runTransaction/]) {
    assert.doesNotMatch(code, forbidden, `the catalog authority reaches for ${forbidden}`);
  }
  const sentinel = "CATALOG_LOADED_FIREBASE";
  const preload = join(mkdtempSync(join(tmpdir(), "catalog-")), "preload.cjs");
  writeFileSync(preload, `const M=require("module");const l=M._load;M._load=function(r,...a){if(/firebase/i.test(r)){process.stderr.write("${sentinel}:"+r);process.exit(97);}return l.call(this,r,...a);};`);
  const probe = spawnSync(process.execPath, ["--require", preload, "-e", `require(${JSON.stringify(COMPILED)});`], { cwd: FUNCTIONS_DIR, encoding: "utf8" });
  assert.equal(probe.status, 0, `the catalog authority transitively loaded Firebase: ${probe.stderr}`);
});

test("imports nothing but pg types: no Commercial command layer, no Firestore collection, no other authority", () => {
  const imports = [...strip(readFileSync(SOURCE, "utf8")).matchAll(/\bfrom\s+["']([^"']+)["']|require\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1] ?? m[2]);
  assert.deepEqual(imports, ["pg"]);
  assert.match(readFileSync(SOURCE, "utf8"), /import type \{ PoolClient \} from "pg";/);
});

test("the verdict rules on a fake database: own kind first, then the other kind, else NOT_FOUND; one verdict per reference in order", async () => {
  const { createPostgresCatalogReferenceAuthority } = require(COMPILED);
  const authority = createPostgresCatalogReferenceAuthority();
  const catalog = { parts: new Set(["TST-1", "BOTH--X"]), models: new Set(["ACME--M", "BOTH--X"]) };
  const db = {
    query: async (_text, [, refs]) => ({
      rows: refs.map((ref, i) => ({ ordinal: String(i + 1), is_part: catalog.parts.has(ref), is_equipment_model: catalog.models.has(ref) })),
    }),
  };
  const refs = [
    { kind: "PART", ref: "TST-1" }, { kind: "EQUIPMENT_MODEL", ref: "TST-1" }, { kind: "PART", ref: "ACME--M" },
    { kind: "EQUIPMENT_MODEL", ref: "ACME--M" }, { kind: "PART", ref: "none" }, { kind: "EQUIPMENT_MODEL", ref: "none" },
    { kind: "PART", ref: "BOTH--X" }, { kind: "EQUIPMENT_MODEL", ref: "BOTH--X" },
  ];
  assert.deepEqual(await authority.verifyReferences(db, "t1", refs), ["FOUND", "WRONG_KIND", "WRONG_KIND", "FOUND", "NOT_FOUND", "NOT_FOUND", "FOUND", "FOUND"]);
  const nonBoolean = { query: async () => ({ rows: [{ ordinal: 1, is_part: "t", is_equipment_model: 1 }] }) };
  assert.deepEqual(await authority.verifyReferences(nonBoolean, "t1", [{ kind: "PART", ref: "x" }]), ["NOT_FOUND"], "only a real boolean true is existence");
});

// CATALOG_CUTOVER_TAIL. This PR is an INERT FOUNDATION. eos_ops.parts and eos_ops.equipment_models are empty in every
// environment, so a composed PostgreSQL catalog would answer NOT_FOUND for every real product -- a false answer.
// CATALOG_AUTHORITY_UNAVAILABLE is the truthful deployed behaviour until population and reconciliation are PROVEN by
// the governed catalog cutover. Only that cutover may compose this adapter and relax this ratchet.
test("the catalog authority is composed ONLY by the Work Order/ops commands that were ruled to use it", () => {
  // ════════ THIS RATCHET WAS RELEASED DELIBERATELY, AND ONLY HALF OF IT ════════
  //
  // It used to assert that NOTHING composes the catalog authority, because composition was
  // CATALOG_CUTOVER_TAIL: an empty eos_ops.parts answers NOT_FOUND for every real product, so wiring it
  // early would look like "the part does not exist" rather than "the catalog has not been copied yet".
  //
  // THAT REASON HAS NOT EXPIRED. eos_ops.parts is still empty in nonprod. What changed is an Owner ruling
  // (Lane 3) that the Work Order commands must resolve Part facts from the catalog rather than from the
  // caller -- because the alternative is worse: an install that trusts a caller's `wholeUnit`, or a
  // commitment that trusts a caller's tracking mode, is wrong SILENTLY, while an unresolvable Part is
  // wrong loudly. So the importer list is now an enumerated set rather than empty, and the ordering
  // constraint it used to enforce is enforced below instead.
  const SRC = join(FUNCTIONS_DIR, "src");
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
  const importers = walk(SRC)
    .filter((f) => /\.(ts|js|mjs|cjs)$/.test(f) && !f.startsWith(join(SRC, "catalogAuthority")))
    .filter((f) => /catalogAuthority\b|postgresCatalogReferenceAuthority|postgresPartPolicyAuthority/.test(strip(readFileSync(f, "utf8"))))
    .map((f) => f.slice(SRC.length + 1).split("\\").join("/"))
    .sort();
  assert.deepEqual(importers, [
    "eosOps/equipmentCustody.ts",
    "eosOps/inventoryCommitmentRepository.ts",
    "eosOps/serviceFromSalesOrderBoundary.ts",
    "eosOps/workOrderPartsPlanAuthority.ts",
  ], "a NEW module composes the catalog authority -- name it here and say why it may");
});

test("every composer uses it as a REPOSITORY, on its own client, never over HTTP", () => {
  // The forbidden shape is a Render handler calling another Render handler: the Part would be verified in
  // one transaction and acted on in another, with nothing making the two agree.
  const SRC = join(FUNCTIONS_DIR, "src");
  for (const rel of ["eosOps/equipmentCustody.ts", "eosOps/inventoryCommitmentRepository.ts",
                     "eosOps/serviceFromSalesOrderBoundary.ts", "eosOps/workOrderPartsPlanAuthority.ts"]) {
    const src = strip(readFileSync(join(SRC, rel), "utf8"));
    assert.doesNotMatch(src, /fetch\(/, `${rel} calls out over HTTP`);
    assert.doesNotMatch(src, /\/operations\//, `${rel} names a Render route`);
    assert.doesNotMatch(src, /firebase-admin|firebase-functions/, `${rel} reaches Firebase`);
    // It must ask the catalog rather than restate it: no second SELECT against the Part table.
    assert.doesNotMatch(src, /FROM\s+(eos_ops\.|\$\{SCHEMA\}\.)parts\b/,
      `${rel} queries eos_ops.parts directly instead of asking the catalog authority`);
  }
});

test("ORDERING CONSTRAINT: while eos_ops.parts is empty, these commands are wired but NOT activatable", () => {
  // The half of the old ratchet that still holds, kept executable rather than as a comment. The catalog
  // COPY is the gate: until it runs, a composed authority answers NOT_FOUND for every real product, so
  // Install and Consumption would refuse every genuine Part. The Owner's coordinated activation window
  // puts the Catalog COPY/VERIFY before any dependent runtime activation, and this asserts the repository
  // still reflects that -- the Firestore catalog writer is OPEN and PostgreSQL is INACTIVE.
  const state = readFileSync(join(FUNCTIONS_DIR, "src/catalogMaster/catalogWriterState.ts"), "utf8");
  const committed = /CATALOG_WRITER_AUTHORITY[^=]*=\s*Object\.freeze\(\{\s*firestore:\s*"(\w+)",\s*postgres:\s*"(\w+)"/.exec(state);
  assert.ok(committed, "the committed catalog writer state must remain readable");
  assert.deepEqual([committed[1], committed[2]], ["OPEN", "INACTIVE"],
    "PostgreSQL catalog was activated without this constraint being re-reasoned");
});

test("migration 026 is additive, standalone and carries no data, writer or cross-schema dependency beyond tenants", () => {
  const sql = readFileSync(MIGRATION, "utf8");
  const [up, down] = sql.split("-- Down Migration");
  const upCode = up.replace(/--.*$/gm, "");
  assert.match(upCode, /CREATE TABLE parts \(/);
  assert.doesNotMatch(upCode, /\b(ALTER|DROP|INSERT|UPDATE|DELETE|COPY|TRIGGER|FUNCTION)\b/i, "the up migration only creates");
  assert.deepEqual([...upCode.matchAll(/REFERENCES\s+([a-z_.]+)/g)].map((m) => m[1]), ["eos_policy.tenants"]);
  assert.doesNotMatch(sql, /1759536000000|1759622400000|1759708800000/, "does not depend on migrations 023, 024 or 025");
  assert.match(down, /RAISE EXCEPTION/, "the down migration refuses to delete identities");
});
