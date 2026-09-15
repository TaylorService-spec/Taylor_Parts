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
const MIGRATION = join(FUNCTIONS_DIR, "migrations/1759708800000_catalog-part-identity-reference-authority.sql");
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
test("ratchet: nothing composes the catalog authority -- server.ts supplies no catalog, and no runtime module imports catalogAuthority/**", () => {
  const SRC = join(FUNCTIONS_DIR, "src");
  const server = strip(readFileSync(join(SRC, "eosApi/server.ts"), "utf8"));
  assert.doesNotMatch(server, /catalogAuthority|CatalogReferenceAuthority|createPostgresCatalog/, "server.ts composes the catalog authority");
  const handlerCall = server.match(/createCommercialHttpHandler\(\{([\s\S]*?)\}\)/);
  assert.ok(handlerCall, "server.ts no longer composes the Commercial handler where this ratchet expects it");
  assert.doesNotMatch(handlerCall[1], /\bcatalog\b/, "server.ts hands the Commercial handler a catalog");
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
  const importers = walk(SRC)
    .filter((f) => /\.(ts|js|mjs|cjs)$/.test(f) && !f.startsWith(join(SRC, "catalogAuthority")))
    .filter((f) => /catalogAuthority\b|postgresCatalogReferenceAuthority/.test(strip(readFileSync(f, "utf8"))));
  assert.deepEqual(importers, [], "a runtime module imports the catalog authority");
});

test("migration 025 is additive, standalone and carries no data, writer or cross-schema dependency beyond tenants", () => {
  const sql = readFileSync(MIGRATION, "utf8");
  const [up, down] = sql.split("-- Down Migration");
  const upCode = up.replace(/--.*$/gm, "");
  assert.match(upCode, /CREATE TABLE parts \(/);
  assert.doesNotMatch(upCode, /\b(ALTER|DROP|INSERT|UPDATE|DELETE|COPY|TRIGGER|FUNCTION)\b/i, "the up migration only creates");
  assert.deepEqual([...upCode.matchAll(/REFERENCES\s+([a-z_.]+)/g)].map((m) => m[1]), ["eos_policy.tenants"]);
  assert.doesNotMatch(sql, /1759536000000|1759622400000/, "does not depend on migrations 023 or 024");
  assert.match(down, /RAISE EXCEPTION/, "the down migration refuses to delete identities");
});
