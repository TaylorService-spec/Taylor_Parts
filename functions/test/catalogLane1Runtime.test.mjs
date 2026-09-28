// LANE 1: the Catalog runtime is MOUNTED, Commercial's Catalog authority is COMPOSED, and neither is
// a cross-runtime bridge.
//
// Every claim here is derived from the server composition and the import graph. "The tests call the
// target directly" proves nothing about a deployed entrypoint, so nothing in this file calls a
// command: it reads what the server actually wires and what the Firebase bundle can actually reach.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = join(REPO, "functions/src");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
const rel = (f) => relative(REPO, f).split("\\").join("/");
const code = (p) => strip(readFileSync(join(REPO, p), "utf8"));
const SERVER = "functions/src/eosApi/server.ts";

const files = [];
(function walk(d) { for (const e of readdirSync(d)) { const p = join(d, e); statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(e) && files.push(p); } })(SRC);
function resolveSpec(fromFile, spec) {
  if (!spec.startsWith(".")) return null;
  const base = resolve(dirname(fromFile), spec.replace(/\.js$/, ""));
  for (const c of [base + ".ts", base + ".tsx", join(base, "index.ts")]) {
    try { if (statSync(c).isFile()) return c; } catch { /* not this one */ }
  }
  return null;
}
function graph() {
  const g = new Map();
  for (const f of files) {
    const src = strip(readFileSync(f, "utf8"));
    const out = new Set();
    for (const m of src.matchAll(/(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g)) {
      const r = resolveSpec(f, m[1]);
      if (r) out.add(rel(r));
    }
    g.set(rel(f), [...out]);
  }
  return g;
}
function reachableFrom(entry) {
  const g = graph();
  const seen = new Set([entry]); const st = [entry];
  while (st.length) { const f = st.pop(); for (const d of g.get(f) ?? []) if (!seen.has(d)) { seen.add(d); st.push(d); } }
  return seen;
}

// ════════════════════════════ CATALOG_HTTP_MOUNTED ════════════════════════════

test("CATALOG_HTTP_MOUNTED: the Render server composes and routes the Catalog handler", () => {
  const server = code(SERVER);
  assert.ok(server.includes("createCatalogHttpHandler"), "the handler is composed");
  assert.ok(/const catalogHandler = createCatalogHttpHandler\(\{/.test(server), "with the same options shape as its siblings");
  assert.ok(/domain === "catalog"/.test(server), "and the router dispatches to it");
  // Same verifier, same pool, same repository, same origins as every other transport.
  const block = server.slice(server.indexOf("const catalogHandler"), server.indexOf("const server = createServer"));
  for (const shared of ["reader: repo", "pool", "verifyToken", "allowedOrigins: config.allowedOrigins"]) {
    assert.ok(block.includes(shared), `the Catalog handler must share ${shared}`);
  }
});

test("CATALOG ROUTE REACHABILITY: /operations/catalog is not swallowed by /operations/", async () => {
  // The bug this guards is a mounted route that is unreachable: `/operations/catalog` begins with
  // `/operations/`, so the broader test would send it to the Operations handler, which would answer
  // UNKNOWN_OPERATION -- indistinguishable from "the Catalog API does not work".
  const { eosApiDomainFor } = await import("../lib/eosApi/server.js");
  assert.equal(eosApiDomainFor("/operations/catalog"), "catalog");
  assert.equal(eosApiDomainFor("/operations/catalog?x=1"), "catalog");
  assert.equal(eosApiDomainFor("/operations/inventory"), "operations");
  assert.equal(eosApiDomainFor("/commercial/records"), "commercial");
  assert.equal(eosApiDomainFor("/admin/policy"), "administration");

  // And the catalog test precedes the operations test in the source, which is what makes it hold.
  const server = code(SERVER);
  assert.ok(server.indexOf('=== "catalog"') !== -1 || server.indexOf('return "catalog"') !== -1);
  assert.ok(server.indexOf('return "catalog"') < server.indexOf('return "operations"'),
    "the catalog test must be evaluated BEFORE the broader /operations/ test");
});

test("the Catalog route requires authentication, a tenant context and a governed capability", async () => {
  const { handleCatalogRequest, CATALOG_ROUTE } = await import("../lib/catalogMaster/catalogHttp.js");
  const opts = { reader: {}, pool: {}, verifyToken: async () => { throw new Error("must not be called"); } };

  // No token: refused BEFORE the verifier runs and before any pool connection is taken.
  const anon = await handleCatalogRequest(opts, {
    method: "POST", url: CATALOG_ROUTE, headers: {}, body: JSON.stringify({ operation: "readPart" }),
  });
  assert.equal(anon.status, 401);
  assert.match(anon.body, /UNAUTHENTICATED/);

  // An unknown operation is 404 whether or not a token is present.
  const unknown = await handleCatalogRequest(opts, {
    method: "POST", url: CATALOG_ROUTE, headers: {}, body: JSON.stringify({ operation: "runSQL" }),
  });
  assert.equal(unknown.status, 404);

  // A wrong route is 404, not a silent success.
  const wrongRoute = await handleCatalogRequest(opts, {
    method: "POST", url: "/operations/inventory", headers: {}, body: JSON.stringify({ operation: "readPart" }),
  });
  assert.equal(wrongRoute.status, 404);

  // The capability itself is checked by the COMMAND, not the transport: one place decides.
  const kernel = code("functions/src/catalogMaster/catalogMasterKernel.ts");
  assert.ok(kernel.includes("ACTOR_NOT_TENANT_MEMBER"), "membership is proved in the command");
  const http = code("functions/src/catalogMaster/catalogHttp.ts");
  assert.ok(http.includes("resolveOperationalContext"), "identity resolves to an EOS Principal");
  assert.ok(/principalId:\s*ctx\.principalContext\.uid/.test(http), "and the actor IS that Principal");
});

test("the Catalog transport reaches no Firebase package", () => {
  const http = code("functions/src/catalogMaster/catalogHttp.ts");
  for (const banned of ["firebase-admin", "getFirestore", "firebase-functions"]) {
    assert.equal(http.includes(banned), false, `the Catalog transport must not reach ${banned}`);
  }
});

// ════════════════════════════ COMMERCIAL COMPOSITION ════════════════════════════

test("COMMERCIAL: the PostgreSQL catalog authority is composed, as a REPOSITORY not an HTTP client", () => {
  const server = code(SERVER);
  assert.ok(server.includes("createPostgresCatalogReferenceAuthority"), "the authority is constructed");
  assert.ok(/catalog: catalogReferenceAuthority/.test(server), "and passed to the Commercial handler");

  // NO Render -> Render HTTP. Commercial must not call the Catalog route over the network: that
  // would validate in one transaction and commit in another.
  const commercialFiles = files.filter((f) => rel(f).startsWith("functions/src/eosCommercial/"));
  for (const f of commercialFiles) {
    const src = strip(readFileSync(f, "utf8"));
    assert.equal(/\/operations\/catalog/.test(src), false, `${rel(f)} must not call the Catalog route`);
    assert.equal(/fetch\(/.test(src), false, `${rel(f)} must not make an HTTP call`);
  }
});

test("COMMERCIAL: the Catalog lookup runs on the command's own connection", async () => {
  // `requireCatalogReferences` is handed the SAME `db` the command is writing through, so the
  // reference check and the write share one transaction by construction.
  const kernel = code("functions/src/eosCommercial/commands/commercialCommandKernel.ts");
  assert.ok(/verifyReferences\(db, tenantId, references\)/.test(kernel),
    "the authority is called with the command's own client, never a new pool or a URL");
  const agreement = code("functions/src/eosCommercial/commands/salesAgreementCommandService.ts");
  assert.ok(/requireCatalogReferences\(deps, db,/.test(agreement));
});

test("COMMERCIAL: CATALOG_AUTHORITY_UNAVAILABLE stays reachable, and stays correct", () => {
  // Removing the refusal would be wrong: a composition that omits the authority must still refuse
  // rather than skip the check. It fires less often now; it has not been deleted.
  const kernel = code("functions/src/eosCommercial/commands/commercialCommandKernel.ts");
  assert.ok(kernel.includes("CATALOG_AUTHORITY_UNAVAILABLE"));
  assert.ok(kernel.includes("CATALOG_AUTHORITY_CONTRACT_VIOLATION"),
    "a short, long or unrecognised answer must never read as FOUND");
  // And Commercial does NOT restate Part/Equipment Model validation of its own.
  const commercialFiles = files.filter((f) => rel(f).startsWith("functions/src/eosCommercial/"));
  for (const f of commercialFiles) {
    const src = strip(readFileSync(f, "utf8"));
    assert.equal(/SELECT[\s\S]{0,80}FROM\s+eos_ops\.parts/.test(src), false,
      `${rel(f)} must not query the catalog itself -- the Catalog authority owns that answer`);
  }
});

// ════════════════════════════ NO BRIDGE, EITHER DIRECTION ════════════════════════════

test("NO Firebase -> Render and NO Firebase -> PostgreSQL bridge, after Lane 1", () => {
  const reachable = reachableFrom("functions/src/index.ts");
  for (const m of [
    "functions/src/catalogMaster/catalogHttp.ts",
    "functions/src/catalogMaster/postgresPartMasterWriter.ts",
    "functions/src/catalogMaster/postgresPartAliasWriter.ts",
    "functions/src/catalogMaster/postgresCatalogReads.ts",
    "functions/src/catalogAuthority/postgresCatalogReferenceAuthority.ts",
    "functions/src/eosApi/server.ts",
  ]) {
    assert.equal(reachable.has(m), false, `${m} is reachable from the Firebase entry point: that is a bridge`);
  }
  for (const f of files) {
    const p = rel(f);
    if (!reachable.has(p)) continue;
    const src = strip(readFileSync(f, "utf8"));
    assert.equal(/\/operations\/catalog/.test(src), false, `${p} calls the Catalog route from Firebase`);
  }
});

// ════════════════════════════ DATA IMPORT ════════════════════════════

test("DATA_IMPORT: it does NOT bypass the Part authority, and has no Render runtime to move to", () => {
  // It calls the governed createPart rather than writing `parts` itself -- which is why it cannot
  // simply be repointed: the command it calls is the Firestore one.
  const adapter = code("functions/src/dataImport/firestoreDataImportAdapters.ts");
  assert.ok(adapter.includes("createPart"), "Part creation goes through the governed command");
  assert.equal(/collection\(PARTS_COLLECTION\)[\s\S]{0,60}\.(set|create|update)\(/.test(adapter), false,
    "Data Import must never write the parts collection directly");

  // And there is no Render Data Import runtime: no transport operation names it.
  for (const transport of [
    "functions/src/eosOps/eosOpsHttp.ts",
    "functions/src/eosCommercial/commercialHttp.ts",
    "functions/src/catalogMaster/catalogHttp.ts",
  ]) {
    const src = code(transport);
    assert.equal(/executeDataImport|stageDataImport/.test(src), false,
      `${transport} must not have grown a Data Import operation in this lane`);
  }
});

// ════════════════ the PostgreSQL Catalog activation boundary (Controller ruling 2026-09-28, window step 18) ════════════════
test("until the ACTIVATE_POSTGRES transition, the Catalog transport refuses every operation before any database work", async () => {
  const { executeCatalogOperation, CATALOG_READ_OPERATIONS, CATALOG_MUTATION_OPERATIONS } = await import("../lib/catalogMaster/catalogHttp.js");
  const writerState = await import("../lib/catalogMaster/catalogWriterState.js");
  assert.equal(writerState.CATALOG_WRITER_AUTHORITY.postgres, "INACTIVE");
  const untouchable = new Proxy({}, { get: () => { throw new Error("DEPS_TOUCHED"); } });
  for (const operation of [...CATALOG_READ_OPERATIONS, ...CATALOG_MUTATION_OPERATIONS]) {
    const r = await executeCatalogOperation({ reader: untouchable, pool: untouchable },
      { caller: { externalSubject: "x", identityProvider: "firebase", requestedTenantId: null }, operation, input: {} });
    assert.deepEqual([r.ok, r.code], [false, "PRECONDITION_FAILED"], operation);
    assert.match(r.message, /not active yet/);
  }
  // ACTIVE is what opens it: with the transition injected, the gate passes and identity resolution is reached.
  const r = await executeCatalogOperation({ reader: untouchable, pool: untouchable, writerAuthority: { firestore: "FROZEN", postgres: "ACTIVE" } },
    { caller: { externalSubject: "x", identityProvider: "firebase", requestedTenantId: null }, operation: "readPart", input: {} }).catch((e) => e);
  assert.match(String(r && (r.message ?? r)), /DEPS_TOUCHED|could not be completed/);
});
