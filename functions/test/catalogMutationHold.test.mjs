// DQ-034 (Controller ruling, CLOSED, option A): PostgreSQL is the Catalog READ authority at activation, and EVERY
// PostgreSQL Catalog MUTATION stays HELD while any active release journey still reads the frozen Firebase catalog.
//
// The invariant the hold protects:   PostgreSQL Catalog == frozen legacy Catalog.
//
// Every claim here is DERIVED from the transport's own operation table and source, never from a hand-kept list: an
// operation added to CATALOG_MUTATION_OPERATIONS is held the moment it exists, and an operation that writes but is
// filed as a read fails the classification test below.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = join(REPO, "functions/src");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
const code = (p) => strip(readFileSync(join(REPO, p), "utf8"));
const rel = (f) => relative(REPO, f).split("\\").join("/");

const HTTP = await import("../lib/catalogMaster/catalogHttp.js");
const STATE = await import("../lib/catalogMaster/catalogWriterState.js");
const { CATALOG_READ_OPERATIONS, CATALOG_MUTATION_OPERATIONS, executeCatalogOperation, handleCatalogRequest, CATALOG_ROUTE } = HTTP;

const CALLER = Object.freeze({ externalSubject: "x", identityProvider: "firebase", requestedTenantId: null });
// Any touch of the reader or the pool is a failure: a held mutation must be refused before identity resolution and
// before a connection is taken, let alone a write.
const untouchable = () => new Proxy({}, { get: (_t, k) => { throw new Error(`DEPS_TOUCHED:${String(k)}`); } });
// The hold sits ON TOP of an ACTIVE PostgreSQL Catalog. The reconciled package ships the committed authority INACTIVE
// (activation is its own separate change), so the hold's behaviour is proven under the ACTIVE state INJECTED through the
// transport's existing writerAuthority test seam -- never by assuming the committed constant.
const ACTIVE = Object.freeze({ firestore: "FROZEN", postgres: "ACTIVE" });

// ═══════════════════════════════════════════ the committed hold

// LIFTED 2026-10-01 by the reviewed change the procedure requires (catalog-cutover-plan.md §5.4 STATUS: (a) no deployed
// release-journey client reaches a Firebase Catalog reader; (b) fresh VERIFY --sample all == the activation digest).
// The MECHANISM stays proven below with an explicit held state, so re-imposing the hold remains one reviewed edit.
const HELD = Object.freeze({ held: true, ruling: "DQ-034", reason: STATE.CATALOG_MUTATION_HOLD_REASON });

test("the committed hold is LIFTED, still names DQ-034, and keeps its reason for the record", () => {
  assert.equal(STATE.CATALOG_MUTATION_HOLD.held, false);
  assert.equal(STATE.CATALOG_MUTATION_HOLD.ruling, "DQ-034");
  assert.equal(STATE.CATALOG_MUTATION_HOLD.reason, "DQ-034: active release-journey readers still read the frozen Firebase catalog");
  assert.ok(Object.isFrozen(STATE.CATALOG_MUTATION_HOLD), "the hold is a frozen code constant");
  // The hold sits ON TOP of an ACTIVE PostgreSQL read authority; it is not the INACTIVE gate under another name.
  assert.equal(STATE.CATALOG_WRITER_AUTHORITY.postgres, "ACTIVE");
});

test("assertCatalogMutationNotHeld refuses while held, passes only on an explicit held:false, and fails closed otherwise", () => {
  assert.doesNotThrow(() => STATE.assertCatalogMutationNotHeld("x"), "the committed (lifted) hold passes");
  assert.throws(() => STATE.assertCatalogMutationNotHeld("x", HELD), (e) => e instanceof STATE.CatalogMutationHeldError && e.code === "CATALOG_MUTATION_HELD");
  assert.doesNotThrow(() => STATE.assertCatalogMutationNotHeld("x", { held: false, ruling: "DQ-034", reason: "lifted" }));
  for (const malformed of [null, {}, { held: "false" }, { held: 0 }]) { // (undefined now means the committed, lifted hold)
    assert.throws(() => STATE.assertCatalogMutationNotHeld("x", malformed), /paused during the migration/, JSON.stringify(malformed));
  }
});

// ═══════════════════════════════════════════ every mutation in the TABLE is held

test("LIFTED: EVERY operation in CATALOG_MUTATION_OPERATIONS passes the hold and reaches identity resolution (its own gates follow)", async () => {
  assert.ok(CATALOG_MUTATION_OPERATIONS.length > 0, "non-vacuous: the transport's mutation table is not empty");
  for (const operation of CATALOG_MUTATION_OPERATIONS) {
    const r = await executeCatalogOperation({ reader: untouchable(), pool: untouchable(), writerAuthority: ACTIVE }, { caller: CALLER, operation, input: { partId: "P-1", part: {} } }).catch((e) => e);
    assert.notEqual(r?.code, "CATALOG_MUTATION_HELD", operation);
    assert.match(String(r?.message ?? r), /DEPS_TOUCHED|could not be completed/, operation);
  }
});

test("over HTTP a mutation is no longer refused 412 CATALOG_MUTATION_HELD", async () => {
  const opts = { reader: untouchable(), pool: untouchable(), writerAuthority: ACTIVE, verifyToken: async () => ({ externalSubject: "x", identityProvider: "firebase" }) };
  for (const operation of CATALOG_MUTATION_OPERATIONS) {
    const res = await handleCatalogRequest(opts, {
      method: "POST", url: CATALOG_ROUTE, headers: { authorization: "Bearer t" }, body: JSON.stringify({ operation, input: {} }),
    });
    assert.notEqual(JSON.parse(res.body).code, "CATALOG_MUTATION_HELD", operation);
  }
});

test("READS are not held: every read op passes the hold and reaches identity resolution (the DQ-031 gate follows)", async () => {
  for (const operation of CATALOG_READ_OPERATIONS) {
    const r = await executeCatalogOperation({ reader: untouchable(), pool: untouchable(), writerAuthority: ACTIVE }, { caller: CALLER, operation, input: {} }).catch((e) => e);
    assert.notEqual(r?.code, "CATALOG_MUTATION_HELD", operation);
    // Reaching the reader/pool is the proof the hold did not stop it (the transport turns the throw into INTERNAL).
    assert.match(String(r?.message ?? r), /DEPS_TOUCHED|could not be completed/, operation);
  }
});

// ═══════════════════════════════════════════ the table is the truth: nothing that writes escapes it

function switchCases(src) {
  const body = src.slice(src.indexOf("switch (request.operation)"));
  const end = body.indexOf("default:");
  const cases = [...body.slice(0, end).matchAll(/case "(\w+)":([\s\S]*?)(?=case "|$)/g)];
  return new Map(cases.map((m) => [m[1], m[2]]));
}

test("the dispatch switch handles exactly READS + MUTATIONS, and they do not overlap", () => {
  const cases = switchCases(code("functions/src/catalogMaster/catalogHttp.ts"));
  assert.deepEqual([...cases.keys()].sort(), [...CATALOG_READ_OPERATIONS, ...CATALOG_MUTATION_OPERATIONS].sort());
  assert.deepEqual(CATALOG_READ_OPERATIONS.filter((o) => CATALOG_MUTATION_OPERATIONS.includes(o)), []);
});

test("no READ case calls a writer mutation: a write filed as a read would escape the hold", () => {
  const src = code("functions/src/catalogMaster/catalogHttp.ts");
  // The writer functions the transport imports, DERIVED from its imports of the PostgreSQL writer modules.
  const imported = new Set();
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*"\.\/(postgres\w+Writer)\.js"/g)) {
    for (const n of m[1].split(",").map((s) => s.trim().replace(/^type\s+/, "")).filter(Boolean)) imported.add(n);
  }
  assert.ok(imported.size > 0, "non-vacuous: the transport imports PostgreSQL writer functions");
  const cases = switchCases(src);
  const calledByMutations = new Set();
  for (const op of CATALOG_MUTATION_OPERATIONS) for (const n of imported) if (new RegExp(`\\b${n}\\(`).test(cases.get(op))) calledByMutations.add(n);
  assert.ok(calledByMutations.size >= CATALOG_MUTATION_OPERATIONS.length, "every mutation case dispatches a writer function");
  for (const op of CATALOG_READ_OPERATIONS) {
    for (const n of calledByMutations) {
      assert.equal(new RegExp(`\\b${n}\\(`).test(cases.get(op)), false, `read ${op} calls the mutation ${n}`);
    }
  }
});

test("the hold is applied to the MUTATIONS table, first, before identity resolution", () => {
  const src = code("functions/src/catalogMaster/catalogHttp.ts");
  const hold = src.indexOf("if (MUTATIONS.has(request.operation)) assertCatalogMutationNotHeld(");
  assert.ok(hold > 0, "the hold is keyed on the MUTATIONS set derived from CATALOG_MUTATION_OPERATIONS");
  assert.match(src, /const MUTATIONS = new Set<string>\(CATALOG_MUTATION_OPERATIONS\)/);
  assert.ok(hold < src.indexOf("await resolveOperationalContext("), "held before identity resolution");
  assert.ok(hold < src.indexOf("switch (request.operation)"), "held before dispatch");
});

// ═══════════════════════════════════════════ no override exists

test("there is no runtime flag, env override, dep or input that lifts the hold", () => {
  const http = code("functions/src/catalogMaster/catalogHttp.ts");
  const state = code("functions/src/catalogMaster/catalogWriterState.ts");
  // Called with the operation ONLY: the committed constant is the one answer.
  const calls = [...http.matchAll(/assertCatalogMutationNotHeld\(([^;]*)\);/g)].map((m) => m[1]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].includes(","), false, "the transport passes no hold of its own");
  for (const [name, src] of [["catalogHttp.ts", http], ["catalogWriterState.ts", state]]) {
    assert.equal(/process\.env|import\.meta\.env/.test(src), false, `${name} reads no environment`);
  }
  assert.match(state, /CATALOG_MUTATION_HOLD: CatalogMutationHold = Object\.freeze\(\{\s*held: false,/);
  assert.equal(/mutationHold|CATALOG_MUTATION_HOLD/.test(code("functions/src/eosApi/server.ts")), false, "the server composes no hold");
  assert.equal(/mutationHold/.test(http), false, "CatalogApiDeps carries no hold seam");
});

// ═══════════════════════════════════════════ the governed COPY coexists with the hold

const files = [];
(function walk(d) { for (const e of readdirSync(d)) { const p = join(d, e); statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(e) && files.push(p); } })(SRC);

test("the COPY never goes through the transport or the hold, so it still populates PostgreSQL under the hold", () => {
  const cutover = code("functions/src/catalogMaster/catalogCutover.ts");
  assert.equal(/catalogHttp|catalogWriterState|assertCatalogMutationNotHeld/.test(cutover), false);
  // It can only make PostgreSQL EQUAL to the frozen source: drift and unknown target rows refuse.
  assert.match(cutover, /DRIFT_DETECTED/);
  assert.match(cutover, /TARGET_HAS_UNKNOWN_RECORDS/);
  const cli = strip(readFileSync(join(REPO, "functions/scripts/catalogCutover.js"), "utf8"));
  assert.equal(/catalogHttp|assertCatalogMutationNotHeld/.test(cli), false);
});

test("nothing but the transport composes a PostgreSQL Catalog MUTATION: the hold covers every runtime writer", () => {
  const MUTATORS = {
    postgresPartMasterWriter: ["createPart", "updatePart", "changePartStatus"],
    postgresPartAliasWriter: ["createPartAlias", "deactivatePartAlias", "reactivatePartAlias"],
  };
  const offenders = [];
  for (const f of files) {
    const r = rel(f);
    if (r === "functions/src/catalogMaster/catalogHttp.ts") continue;
    const src = strip(readFileSync(f, "utf8"));
    for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*["'][^"']*\/(postgres\w+Writer)(?:\.js)?["']/g)) {
      const names = m[1].split(",").map((s) => s.trim().split(/\s+as\s+/)[0].replace(/^type\s+/, "")).filter(Boolean);
      const mutators = MUTATORS[m[2]];
      // The manufacturer and equipment-model writers have NO runtime composition at all.
      if (!mutators) { offenders.push(`${r} imports ${m[2]}`); continue; }
      for (const n of names) if (mutators.includes(n)) offenders.push(`${r} imports ${m[2]}.${n}`);
    }
    if (/require\(\s*["'][^"']*postgres\w+Writer/.test(src) || /import\s*\(\s*["'][^"']*postgres\w+Writer/.test(src)) offenders.push(`${r} loads a writer dynamically`);
  }
  assert.deepEqual(offenders, []);
});
