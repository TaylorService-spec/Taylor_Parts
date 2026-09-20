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

// CATALOG_CUTOVER_TAIL, RELEASED BY THE CATALOG CUTOVER LANE -- which is the condition the previous
// ratchet named for its own removal ("Only that cutover may compose this adapter and relax this
// ratchet"). The authority is now composed, ONCE, in eosApi/server.ts.
//
// THE REASON THE OLD RATCHET GAVE HAS NOT EXPIRED, and is now an ORDERING CONSTRAINT rather than a
// ban: eos_ops.parts is still empty in every environment, so the composed authority answers
// NOT_FOUND for every real product until the Catalog COPY runs. That turns an honest
// CATALOG_AUTHORITY_UNAVAILABLE into a false REFERENCE_NOT_FOUND -- for anything that CALLS the
// PostgreSQL Commercial commands. Nothing does: the browser still invokes the Firebase Sales
// Agreement callables. So the constraint is:
//
//   the Commercial CLIENT cutover must not ship before Catalog reconciliation.
//
// Both halves are asserted below, so the constraint cannot be lost by someone reading only the code.
test("the catalog authority is composed EXACTLY ONCE, as a repository, and never as an HTTP client", () => {
  const SRC = join(FUNCTIONS_DIR, "src");
  const server = strip(readFileSync(join(SRC, "eosApi/server.ts"), "utf8"));
  assert.equal((server.match(/createPostgresCatalogReferenceAuthority\(\)/g) ?? []).length, 1,
    "one authority, shared -- a second would be a second answer to the same question");
  const handlerCall = server.match(/createCommercialHttpHandler\(\{([\s\S]*?)\}\)/);
  assert.ok(handlerCall, "server.ts still composes the Commercial handler");
  assert.match(handlerCall[1], /catalog: catalogReferenceAuthority/, "and hands it the authority");

  // A REPOSITORY, never a URL. Commercial calling /operations/catalog would validate a reference in
  // one transaction and commit the agreement in another.
  assert.doesNotMatch(server, /fetch\(/, "the server composition makes no HTTP call");
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
  const importers = walk(SRC)
    .filter((f) => /\.(ts|js|mjs|cjs)$/.test(f) && !f.startsWith(join(SRC, "catalogAuthority")))
    .filter((f) => /catalogAuthority\b|postgresCatalogReferenceAuthority/.test(strip(readFileSync(f, "utf8"))))
    .map((f) => f.slice(FUNCTIONS_DIR.length + 1).split("\\").join("/"));
  assert.deepEqual(importers, ["src/eosApi/server.ts"],
    "only the server composition imports the authority; no command constructs its own");
});

test("ORDERING CONSTRAINT: the Commercial client has NOT been cut over, and must not be before reconciliation", () => {
  // While eos_ops.parts is empty, a composed authority answers NOT_FOUND for every real product. That
  // is only reachable by something that CALLS the PostgreSQL Commercial commands -- and the browser
  // still calls the Firebase callables. This test fails the moment that stops being true, which is
  // exactly when a person needs to re-read the constraint above.
  const client = join(FUNCTIONS_DIR, "..", "field-ops-app-vite", "src", "services", "salesAgreementCommandClient.js");
  const src = strip(readFileSync(client, "utf8"));
  assert.match(src, /httpsCallable/,
    "the Commercial client moved to Render: Catalog reconciliation must have happened first");
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
