// WAVE C4, offline -- the governed Commercial HTTP transport's shape, identity and error boundaries, and the migration 023
// vocabulary text. The real-database proof is functions/test/commercialTransportPostgres.test.mjs.
//
// The offline requests run the REAL resolveOperationalContext over a fake PolicyReader and a fake pool, so the transport is
// never exercised through a shortcut resolver.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = resolve(FUNCTIONS_DIR, "..");
const SRC = join(FUNCTIONS_DIR, "src");
const HTTP_SOURCE = join(SRC, "eosCommercial", "commercialHttp.ts");
const MIGRATION = join(FUNCTIONS_DIR, "migrations", "1759536000000_commercial-capability-vocabulary.sql");
const require = createRequire(import.meta.url);
const http = require("../lib/eosCommercial/commercialHttp.js");
const { eosApiDomainFor } = require("../lib/eosApi/server.js");
const { COMMERCIAL_CAPABILITIES } = require("../lib/eosCommercial/commands/commercialCommandKernel.js");
const { COMMERCIAL_READ_CAPABILITIES } = require("../lib/eosCommercial/reads/commercialReadKernel.js");

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
function walk(dir, exts) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry === "node_modules" || entry === "lib" || entry === "dist") continue;
    if (statSync(full).isDirectory()) out.push(...walk(full, exts));
    else if (exts.some((e) => full.endsWith(e))) out.push(full);
  }
  return out;
}
const rel = (f) => relative(REPO, f).split("\\").join("/");

const ALL_CAPS = [...Object.values(COMMERCIAL_CAPABILITIES), ...Object.values(COMMERCIAL_READ_CAPABILITIES)];
const EXPECTED_READS = ["getOpportunityDetail", "listOpportunities", "getSalesAgreementDetail", "listSalesAgreements", "getSalesOrderDetail", "listSalesOrders", "getAccountCommercialProjection"];
const EXPECTED_MUTATIONS = ["createOpportunity", "updateOpportunity", "transitionOpportunity", "closeOpportunityAsWon", "createSalesAgreement", "updateSalesAgreementDraft",
  "acceptSalesAgreement", "createSalesOrder", "createSalesOrderFromOpportunity", "transitionSalesOrder"];

/** A PolicyReader that knows one principal, recording every subject lookup it is asked for. */
function fakeWorld({ capabilities = ALL_CAPS, clientQuery } = {}) {
  const lookups = [];
  const reader = {
    async getPrincipalBySubject(provider, subject) {
      lookups.push({ provider, subject });
      return provider === "firebase" && subject === "subj-alice" ? { id: "p-eos-alice", status: "active" } : null;
    },
    async listMembershipsForPrincipal() { return [{ tenantId: "t1", status: "active" }]; },
    async getTenant(id) { return { id, status: "active" }; },
    async listAssignmentsForPrincipal() { return [{ roleId: "r1", status: "active", accessVersionAtGrant: 0 }]; },
    async getAccessVersion() { return { accessVersion: 0 }; },
    async listObjects() { return []; },
    async listObjectPermissions() { return []; },
    async listFieldOverrides() { return []; },
    async listRoles() { return [{ id: "r1", key: "sales" }]; },
  };
  const actors = [];
  const pool = {
    async query(text) {
      if (/role_capabilities/.test(text)) return { rows: capabilities.map((key) => ({ key })) };
      throw new Error(`unexpected pool query ${text}`);
    },
    async connect() {
      return {
        async query(text, values) {
          if (/tenant_memberships/.test(text)) { actors.push(values); return { rows: [{ ok: 1 }] }; }
          if (clientQuery) return clientQuery(text, values);
          return { rows: [] };
        },
        release() {},
      };
    },
  };
  const verifyToken = async (token) => {
    if (token !== "tok-alice") throw new Error("firebase: auth/argument-error for project secret-project with key AIza-SECRET");
    return { externalSubject: "subj-alice", identityProvider: "firebase" };
  };
  return { reader, pool, verifyToken, lookups, actors, allowedOrigins: ["https://eos.example"] };
}

const post = (world, body, headers = {}) => http.handleCommercialRequest(world, {
  method: "POST", url: "/commercial/sales", headers: { authorization: "Bearer tok-alice", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body),
});
const parsed = (res) => JSON.parse(res.body);

// ════════════════════ closed surface ════════════════════

test("(1)(23) the operation list is closed: exactly the 17 approved C2/C3 operations, no D2", () => {
  assert.deepEqual([...http.COMMERCIAL_READ_OPERATIONS], EXPECTED_READS);
  assert.deepEqual([...http.COMMERCIAL_MUTATION_OPERATIONS], EXPECTED_MUTATIONS);
  for (const name of [...EXPECTED_READS, ...EXPECTED_MUTATIONS]) assert.equal(http.isCommercialOperation(name), true);
  for (const name of ["allocateSalesOrder", "createServiceForSalesOrder", "issueInvoice", "applySalesOrderFulfillment", "transitionWorkOrder",
    "createCommercialRecord", "stageSalesOrderFromAgreement", "runSQL", "toString", "constructor", "__proto__"]) {
    assert.equal(http.isCommercialOperation(name), false, `${name} is exposed`);
  }
  assert.doesNotMatch(strip(readFileSync(HTTP_SOURCE, "utf8")), /allocat|fulfil|invoice|workOrder|serializedAsset|inventory|createServiceForSalesOrder/i);
});

test("(2)(3)(4) unknown operation 404, wrong method 405, wrong path 404", async () => {
  const w = fakeWorld();
  assert.equal((await post(w, { operation: "allocateSalesOrder", input: {} })).status, 404);
  assert.equal((await http.handleCommercialRequest(w, { method: "GET", url: "/commercial/sales", headers: {} })).status, 405);
  assert.equal((await http.handleCommercialRequest(w, { method: "POST", url: "/commercial/opportunities", headers: {}, body: "{}" })).status, 404);
  assert.equal((await http.handleCommercialRequest(w, { method: "POST", url: "/commercial/sales/extra", headers: {}, body: "{}" })).status, 404);
  assert.deepEqual([eosApiDomainFor("/commercial/sales"), eosApiDomainFor("/commercial/sales?x=1"), eosApiDomainFor("/operations/inventory"), eosApiDomainFor("/admin/policy"), eosApiDomainFor("/commercialsales")],
    ["commercial", "commercial", "operations", "administration", "administration"]);
});

test("(5)(6) OPTIONS is a bounded preflight; an unlisted origin, and a wildcard, are never granted", async () => {
  const w = fakeWorld();
  const res = await http.handleCommercialRequest(w, { method: "OPTIONS", url: "/commercial/sales", headers: { origin: "https://eos.example" } });
  assert.equal(res.status, 204);
  assert.equal(res.headers["access-control-allow-origin"], "https://eos.example");
  assert.equal(res.headers["access-control-allow-methods"], "POST, OPTIONS");
  assert.equal(res.headers["access-control-allow-headers"], "authorization, content-type, x-eos-tenant");
  const evil = await http.handleCommercialRequest(w, { method: "OPTIONS", url: "/commercial/sales", headers: { origin: "https://evil.example" } });
  assert.equal(evil.headers["access-control-allow-origin"], undefined);
  const wild = await http.handleCommercialRequest({ ...w, allowedOrigins: ["*"] }, { method: "OPTIONS", url: "/commercial/sales", headers: { origin: "*" } });
  assert.equal(wild.headers["access-control-allow-origin"], undefined, "a wildcard origin was granted");
  assert.doesNotMatch(readFileSync(HTTP_SOURCE, "utf8"), /allow-origin["']?\s*:\s*["']\*/);
});

test("(7)(8) a missing or invalid bearer is 401 and leaks nothing from the identity provider", async () => {
  const w = fakeWorld();
  const missing = await http.handleCommercialRequest(w, { method: "POST", url: "/commercial/sales", headers: {}, body: JSON.stringify({ operation: "listOpportunities" }) });
  assert.deepEqual([missing.status, parsed(missing).code], [401, "UNAUTHENTICATED"]);
  const invalid = await post(w, { operation: "listOpportunities" }, { authorization: "Bearer tok-mallory" });
  assert.deepEqual([invalid.status, parsed(invalid).code], [401, "UNAUTHENTICATED"]);
  assert.doesNotMatch(invalid.body, /secret-project|AIza|argument-error/);
  assert.equal(w.lookups.length, 0, "an unverified caller reached EOS context resolution");
});

test("(9)(10)(11)(12) only the verified subject reaches EOS resolution; authority fields in the body refuse; the tenant comes from x-eos-tenant", async () => {
  const w = fakeWorld();
  const ok = await post(w, { operation: "listOpportunities", input: {} });
  assert.equal(ok.status, 200);
  assert.deepEqual(w.lookups, [{ provider: "firebase", subject: "subj-alice" }]);
  assert.deepEqual(w.actors.at(-1), ["t1", "p-eos-alice"], "the domain received something other than the EOS Principal id and resolved tenant");
  const PINNED = ["tenantId", "principalId", "capabilities", "externalSubject", "identityProvider", "uid", "heldRoleKeys", "roles", "securityRole", "jobRole"];
  assert.deepEqual([...http.AUTHORITY_BEARING_FIELDS], PINNED, "the authority-bearing field list changed");
  for (const field of PINNED) {
    const res = await post(w, { operation: "listOpportunities", input: { [field]: field === "capabilities" ? ["opportunity.read"] : "t2" } });
    assert.deepEqual([res.status, parsed(res).code], [400, "AUTHORITY_FIELD_NOT_ACCEPTED"], field);
  }
  assert.equal((await post(w, { operation: "listOpportunities", tenantId: "t2" })).status, 400, "an envelope-level tenant was accepted");
  const foreign = await post(w, { operation: "listOpportunities" }, { "x-eos-tenant": "t2" });
  assert.deepEqual([foreign.status, parsed(foreign).code, parsed(foreign).message], [403, "FORBIDDEN", "TENANT_NOT_A_MEMBERSHIP"]);
  const own = await post(w, { operation: "listOpportunities" }, { "x-eos-tenant": "t1" });
  assert.equal(own.status, 200);
});

test("(13)(14)(15) malformed, array and non-object input envelopes are 400; oversize is refused", async () => {
  const w = fakeWorld();
  for (const body of ["{not json", "[]", JSON.stringify([{ operation: "listOpportunities" }]), "", "null", "42"]) {
    assert.equal((await post(w, body)).status, 400, body);
  }
  for (const input of [[], "x", 7, null]) {
    const res = await post(w, { operation: "listOpportunities", input });
    assert.deepEqual([res.status, parsed(res).code], [400, "INVALID_INPUT"], JSON.stringify(input));
  }
  const huge = await post(w, JSON.stringify({ operation: "listOpportunities", input: { pad: "x".repeat(http.MAX_COMMERCIAL_BODY_BYTES) } }));
  assert.equal(huge.status, 413);
  assert.equal(w.lookups.length, 0);
});

test("(16) each governed category maps to its exact HTTP status", async () => {
  assert.deepEqual({ ...http.STATUS_BY_CATEGORY }, { INVALID_INPUT: 400, NOT_FOUND: 404, PRECONDITION_FAILED: 412, CONFLICT: 409, FORBIDDEN: 403, UNAVAILABLE: 503, FAILED: 500 });
  const invalid = await post(fakeWorld(), { operation: "listOpportunities", input: { limit: 5000 } });
  assert.deepEqual([invalid.status, parsed(invalid).code], [400, "PAGE_SIZE_INVALID"]);
  const missing = await post(fakeWorld(), { operation: "getOpportunityDetail", input: { opportunityId: "opp_x" } });
  assert.deepEqual([missing.status, parsed(missing).code], [404, "RECORD_NOT_FOUND"]);
  const denied = await post(fakeWorld({ capabilities: ["opportunity.write"] }), { operation: "listOpportunities" });
  assert.deepEqual([denied.status, parsed(denied).code], [403, "CAPABILITY_REQUIRED"]);
  const unknownPrincipal = await post({ ...fakeWorld(), verifyToken: async () => ({ externalSubject: "subj-nobody", identityProvider: "firebase" }) }, { operation: "listOpportunities" });
  assert.deepEqual([unknownPrincipal.status, parsed(unknownPrincipal).code, parsed(unknownPrincipal).message], [403, "FORBIDDEN", "UNKNOWN_PRINCIPAL"]);
  const idem = await post(fakeWorld(), { operation: "createOpportunity", input: { accountId: "a" } });
  assert.deepEqual([idem.status, parsed(idem).code], [400, "IDEMPOTENCY_KEY_REQUIRED"]);
});

test("(17)(18) a raw failure is a generic 500 that leaks no SQL, driver or connection detail", async () => {
  const raw = Object.assign(new Error('relation "eos_commercial.opportunities" failed at postgres://eos_app:S3cr3t@db.internal:5432/eos'), { code: "XX000", constraint: "opportunities_pkey" });
  const w = fakeWorld({ clientQuery: (text) => { if (/eos_commercial\.opportunities/.test(text)) throw raw; return { rows: [] }; } });
  const res = await post(w, { operation: "listOpportunities" });
  assert.equal(res.status, 500);
  assert.deepEqual(Object.keys(parsed(res)).sort(), ["code", "message", "ok", "operation"]);
  assert.doesNotMatch(res.body, /S3cr3t|db\.internal|postgres:|eos_commercial|pkey|stack/);
  const reader = { ...fakeWorld().reader, getPrincipalBySubject: async () => { throw raw; } };
  const broken = await post({ ...fakeWorld(), reader }, { operation: "listOpportunities" });
  assert.deepEqual([broken.status, parsed(broken).code, parsed(broken).message], [500, "INTERNAL", "the request could not be completed"]);
  assert.doesNotMatch(broken.body, /S3cr3t|db\.internal|postgres:/);
});

// ════════════════════ static ratchets ════════════════════

test("(19)(20) the transport imports no Firebase or Firestore, contains no SQL, and resolves context only through resolveOperationalContext", () => {
  const code = strip(readFileSync(HTTP_SOURCE, "utf8"));
  for (const forbidden of [/firebase/i, /firestore/i, /getFirestore/, /verifyIdToken/, /customClaims|claims\./]) assert.doesNotMatch(code, forbidden);
  for (const sql of [/\bSELECT\b/, /\bINSERT\b/, /\bUPDATE\b/, /\bDELETE\b/, /\.query\(/, /eos_(policy|commercial|crm|workforce)/, /role_capabilities/]) assert.doesNotMatch(code, sql);
  assert.match(code, /import \{ resolveOperationalContext \} from "\.\.\/eosOps\/capabilityAuthority"/);
  assert.match(code, /principalId: ctx\.principalContext\.uid/);
  assert.match(code, /tenantId: ctx\.principalContext\.tenantId/);
  assert.match(code, /capabilities: ctx\.capabilities/);
  assert.doesNotMatch(code, /principalId:\s*(identity|request\.caller)\./, "the domain actor is built from the external identity");
  assert.doesNotMatch(code, /resolvePrincipalContext|capabilitiesForRoleKeys/, "the transport grew its own resolver");
});

test("only the server identity seam imports firebase-admin; server composes one pool, one verifier, and no catalog", () => {
  const importers = walk(SRC, [".ts"]).filter((f) => /["']firebase-admin["']/.test(strip(readFileSync(f, "utf8")))).map(rel);
  assert.ok(importers.includes("functions/src/eosApi/server.ts"));
  const server = strip(readFileSync(join(SRC, "eosApi", "server.ts"), "utf8"));
  assert.equal((server.match(/getPolicyDatabasePool\(\)/g) ?? []).length, 1, "a second pool was composed");
  assert.equal((server.match(/createFirebaseTokenVerifier\(config\.identityProvider\)/g) ?? []).length, 1, "the verifier is composed more than once");
  assert.match(server, /createCommercialHttpHandler\(\{\s*reader: repo,\s*pool,\s*verifyToken,\s*allowedOrigins: config\.allowedOrigins,\s*\}\)/);
  assert.doesNotMatch(server, /catalog/i, "the deployed server composes a catalog authority");
  assert.doesNotMatch(server, /createServer\([\s\S]*createServer\(/, "a second HTTP server");
  assert.doesNotMatch(server, /NOT DEPLOYED/);
});

test("(21) the client never references the Commercial transport", () => {
  const client = walk(join(REPO, "field-ops-app-vite", "src"), [".js", ".jsx", ".ts", ".tsx"]);
  const offenders = client.filter((f) => /\/commercial\/sales|commercialHttp|COMMERCIAL_ROUTE/.test(readFileSync(f, "utf8"))).map(rel);
  assert.deepEqual(offenders, []);
});

test("(22) Firestore callables, Rules and the legacy Commercial services are untouched by this change", () => {
  const changed = execFileSync("git", ["diff", "--name-only", "799bccbafa5855893f3a7745ef51cf15a608f9e8", "--", "."], { cwd: REPO, encoding: "utf8" }).split("\n").filter(Boolean);
  const forbidden = changed.filter((f) => /^firestore\.rules$|^field-ops-app-vite\/|^functions\/src\/(index\.ts|opportunity\/|salesAgreement\/|salesOrder\/|account\/|access\/)/.test(f));
  assert.deepEqual(forbidden, []);
  const index = strip(readFileSync(join(SRC, "index.ts"), "utf8"));
  for (const callable of ["listOpportunityContext", "getOpportunityContext", "getSalesAgreementContext", "getSalesOrderContext", "listSalesOrderIndex"]) assert.match(index, new RegExp(callable));
  assert.doesNotMatch(index, /eosCommercial|commercialHttp/);
});

test("(24) no Commercial permission becomes active", () => {
  const catalog = readFileSync(join(SRC, "access", "permissionCatalog.ts"), "utf8");
  for (const id of [...ALL_CAPS, "salesOrder.fulfill", "salesOrder.service"]) {
    const at = catalog.indexOf(`id: "${id}"`);
    assert.ok(at > 0, `${id} is not registered`);
    assert.match(catalog.slice(at, catalog.indexOf("}", at)), /active:\s*false/, `${id} became active`);
  }
});

// ════════════════════ migration 023 text ════════════════════

const up = () => readFileSync(MIGRATION, "utf8").split("-- Down Migration")[0];
const down = () => readFileSync(MIGRATION, "utf8").split("-- Down Migration")[1];

test("(46) migration 023 registers exactly the nine keys the C2 and C3 layers require", () => {
  const rows = [...strip(up()).matchAll(/\(\s*'([^']+)',\s*'([^']+)',/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(rows.map(([, key]) => key).sort(), [...ALL_CAPS].sort());
  for (const [id, key] of rows) assert.equal(id, `cap_${key.replace(/\./g, "_")}`, `${key} does not follow the cap_ id convention`);
  assert.equal(rows.length, 9);
});

test("(47) migration 023 is vocabulary only: no grant, Role, assignment or catalog activation", () => {
  const sql = up().replace(/^\s*--.*$/gm, "");
  for (const forbidden of [/role_capabilities/i, /\broles\b/i, /user_role_assignments|assignments/i, /UPDATE\s/i, /DELETE\s/i, /DROP\s/i, /ALTER\s/i, /job_role/i, /salesOrder\.(fulfill|service)/]) {
    assert.doesNotMatch(sql, forbidden);
  }
  assert.equal((sql.match(/INSERT INTO/g) ?? []).length, 1);
  assert.match(sql, /INSERT INTO capabilities \(id, key, description\)/);
  const d = down();
  assert.match(d, /RAISE EXCEPTION/);
  assert.doesNotMatch(d, /CASCADE/i);
  assert.doesNotMatch(d.replace(/^\s*--.*$/gm, ""), /DELETE FROM (eos_policy\.)?role_capabilities/i, "the rollback deletes grants");
});

test("migration 023 is the next monotonic migration after 022", () => {
  const files = readdirSync(join(FUNCTIONS_DIR, "migrations")).filter((f) => f.endsWith(".sql")).sort();
  assert.deepEqual(files.slice(-2), ["1759449600000_commercial-schema-parity-numbering-receipts.sql", "1759536000000_commercial-capability-vocabulary.sql"]);
});
