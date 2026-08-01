"use strict";

// EI Truck Registry — governed smoke-verifier + operator-CLI unit tests. All logic is exercised
// with INJECTED fakes: no emulator, no live project, no production access, no credentials.
// Run: node --test functions/test/verifyTruckRegistryDeployment.test.js
const assert = require("node:assert/strict");
const test = require("node:test");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

const matrix = require("../scripts/truckRegistryVerificationMatrix");
const { PERSONAS, OPERATIONS, COLLECTIONS, expectedOutcome, deniedStatuses, buildMatrix, buildCrosswalk } = matrix;
const core = require("../scripts/verifyTruckRegistryDeployment");
const { GOVERNED_RULES_SHA256, EXPECTED_PROJECT, interpretRow, interpretListRow, buildSmokeResults, assertRunSecretFree, assertGovernedPins, cleanup, residualCheck, runVerification } = core;
const cli = require("../scripts/truckRegistryVerifierCli");

const sha256 = (v) => crypto.createHash("sha256").update(v).digest("hex");
const PREFIX = "trc_gatectest_deadbeefcafef00d";
// The REAL governed rules bytes (Git/LF) — hash to the compiled pin. Using them proves the tool
// accepts exactly the governed ruleset and lets the happy-path live-check pass against the pin.
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const GOVERNED_SOURCE = execFileSync("git", ["show", "HEAD:firestore.rules"], { cwd: REPO_ROOT, encoding: "utf8" });

test("fixture sanity: the governed rules bytes hash to the compiled pin", () => {
  assert.equal(sha256(GOVERNED_SOURCE), GOVERNED_RULES_SHA256);
});

// ---------- (a) matrix completeness, cardinality, uniqueness (non-tautological) ----------
test("a. collections/personas/operations are exactly the governed sets", () => {
  const names = COLLECTIONS.map((c) => c.name);
  assert.equal(new Set(names).size, 8);
  assert.deepEqual([...names].sort(), [
    "equipment_compatibility_operations", "equipment_compatibility_sources", "equipment_model_aliases",
    "equipment_models", "equipment_part_compatibility", "location_truck_claims", "mobile_locations", "trucks",
  ]);
  assert.deepEqual([...PERSONAS].sort(), ["admin", "dispatcher", "technician", "unauthenticated"]);
  assert.deepEqual([...OPERATIONS].sort(), ["create", "delete", "get", "update"]);
});
test("a. buildMatrix: 136 rows (128 base + 8 list on readable collections), no extras/dupes; 8 ALLOW/128 DENY", () => {
  const rows = buildMatrix();
  assert.equal(rows.length, 136);
  const seen = new Map();
  for (const r of rows) seen.set(`${r.collection}::${r.persona}::${r.operation}`, (seen.get(`${r.collection}::${r.persona}::${r.operation}`) || 0) + 1);
  // every base op × every collection × every persona exists exactly once (128)
  for (const c of COLLECTIONS) for (const p of PERSONAS) for (const o of OPERATIONS) assert.equal(seen.get(`${c.name}::${p}::${o}`), 1);
  // list exists exactly once for EACH readable collection × persona, and NOWHERE else
  for (const c of COLLECTIONS) for (const p of PERSONAS) {
    const expected = c.readPolicy === "ADMIN_DISPATCHER" ? 1 : undefined;
    assert.equal(seen.get(`${c.name}::${p}::list`), expected, `list on ${c.name}`);
  }
  assert.equal(seen.size, 128 + 8);
  // per-collection: readable = 20 (4 personas × 5 ops), closed = 16
  for (const c of COLLECTIONS) assert.equal(rows.filter((r) => r.collection === c.name).length, c.readPolicy === "ADMIN_DISPATCHER" ? 20 : 16);
  for (const p of PERSONAS) assert.equal(rows.filter((r) => r.persona === p).length, 34); // 32 base + 2 list
  for (const o of OPERATIONS) assert.equal(rows.filter((r) => r.operation === o).length, 32);
  assert.equal(rows.filter((r) => r.operation === "list").length, 8);
  assert.equal(rows.filter((r) => r.decision === "ALLOW").length, 8);
  assert.equal(rows.filter((r) => r.decision === "DENY").length, 128);
  assert.deepEqual(rows.filter((r) => r.decision === "ALLOW").map((r) => r.label).sort(), [
    "admin/mobile_locations/get", "admin/mobile_locations/list", "admin/trucks/get", "admin/trucks/list",
    "dispatcher/mobile_locations/get", "dispatcher/mobile_locations/list", "dispatcher/trucks/get", "dispatcher/trucks/list",
  ]);
});

// ---------- (b) expected allow/deny mapping ----------
test("b. expectedOutcome + denial statuses", () => {
  assert.equal(expectedOutcome("admin", "trucks", "get").decision, "ALLOW");
  assert.equal(expectedOutcome("technician", "trucks", "get").decision, "DENY");
  assert.equal(expectedOutcome("admin", "trucks", "create").decision, "DENY");
  assert.equal(expectedOutcome("admin", "location_truck_claims", "get").decision, "DENY");
  assert.equal(expectedOutcome("admin", "equipment_models", "get").decision, "DENY");
  // list mirrors the read policy for the readable collections
  assert.equal(expectedOutcome("admin", "trucks", "list").decision, "ALLOW");
  assert.equal(expectedOutcome("dispatcher", "mobile_locations", "list").decision, "ALLOW");
  assert.equal(expectedOutcome("technician", "trucks", "list").decision, "DENY");
  assert.equal(expectedOutcome("unauthenticated", "mobile_locations", "list").decision, "DENY");
  assert.deepEqual([...deniedStatuses("unauthenticated")], [401, 403]);
  assert.deepEqual([...deniedStatuses("technician")], [403]);
});

// ---------- (c) fail-closed interpretation ----------
test("c. interpretRow fails closed; a seeded ALLOW read must be 200 (404 not accepted)", () => {
  const rows = buildMatrix();
  const allowRow = rows.find((r) => r.label === "admin/trucks/get");
  assert.equal(interpretRow(allowRow, 200).pass, true);
  assert.equal(interpretRow(allowRow, 403).pass, false);
  assert.equal(interpretRow(allowRow, 404).pass, false);
  const denyWrite = rows.find((r) => r.label === "admin/trucks/create");
  assert.equal(interpretRow(denyWrite, 403).pass, true);
  assert.equal(interpretRow(denyWrite, 200).pass, false);
});

// ---------- shared world / deps fakes ----------
function makeWorld() {
  const docs = new Set();
  const users = new Set();
  const admin = {
    _failDeleteDoc: null,
    async docExists(p) { return docs.has(p); },
    async seedDoc(c, id) { docs.add(`${c}/${id}`); },
    async deleteDoc(p) { if (admin._failDeleteDoc && p === admin._failDeleteDoc) throw new Error("delete boom"); docs.delete(p); },
    async deleteUser(u) { users.delete(u); },
    async userExists(u) { return users.has(u); },
    async listUsersByPrefix(pfx) { return [...users].filter((u) => u.includes(pfx)); },
    async listDocIdsByPrefix(c, pfx) { return [...docs].filter((p) => p.startsWith(`${c}/`) && p.includes(pfx)).map((p) => p.slice(c.length + 1)); },
  };
  const auth = {
    // The adapter records the USER + the users/{uid} role DOC (durable) BEFORE returning.
    async provisionPersona(persona, pfx, record) {
      const uid = `${pfx}_uid_${persona}`;
      users.add(uid); await record({ kind: "USER", ref: uid });
      docs.add(`users/${uid}`); await record({ kind: "DOC", ref: `users/${uid}` });
      return { uid, token: `eyJ${persona}.${"a".repeat(20)}.${"b".repeat(20)}` };
    },
  };
  return { docs, users, admin, auth };
}
function makeManifestStore() {
  const appended = []; const calls = [];
  return { appended, calls,
    async append(e) { appended.push(e); calls.push("append"); },
    async retain() { calls.push("retain"); },
    async complete() { calls.push("complete"); } };
}
function happyProbe({ persona, method, target }) {
  const op = method === "GET" ? "get" : method === "POST" ? "create" : method === "PATCH" ? "update" : "delete";
  const collection = target.split(/[/?]/)[0];
  const eo = expectedOutcome(persona, collection, op);
  return eo.decision === "ALLOW" ? 200 : (persona === "unauthenticated" ? 401 : 403);
}
function happyListProbe({ persona, collection }) {
  const eo = expectedOutcome(persona, collection, "list");
  if (eo.decision === "ALLOW") return { status: 200, ids: [`${PREFIX}_seed_${collection}`] }; // seeded record present
  return { status: persona === "unauthenticated" ? 401 : 403, ids: [] }; // denial, no records
}
function makeDeps(overrides = {}) {
  const world = overrides.world || makeWorld();
  const manifestStore = overrides.manifestStore || makeManifestStore();
  const evidenceFiles = {};
  return {
    world, manifestStore, evidenceFiles,
    deps: {
      config: { projectId: EXPECTED_PROJECT, confirmProject: EXPECTED_PROJECT, governedCommit: "a".repeat(40), governedRulesSha256: GOVERNED_RULES_SHA256, ...overrides.config },
      targetProject: overrides.targetProject || EXPECTED_PROJECT,
      rules: { async fetchLiveSource() { return { source: { files: [{ name: "firestore.rules", content: overrides.liveSource || GOVERNED_SOURCE }] } }; } },
      auth: world.auth,
      probe: overrides.probe || (async (req) => happyProbe(req)),
      listProbe: overrides.listProbe || (async (req) => happyListProbe(req)),
      admin: world.admin,
      evidence: { async write(files) { Object.assign(evidenceFiles, files); } },
      manifestStore,
      prefix: PREFIX,
      recaptureDate: "2026-08-01",
      log: () => {},
    },
  };
}

// ---------- happy path + (d) durable manifest recording ----------
test("full run: 128/128 pass; sanitized evidence; durable manifest appended + completed; cleanup+residual 0/0", async () => {
  const { world, manifestStore, evidenceFiles, deps } = makeDeps();
  const out = await runVerification(deps);
  assert.equal(out.matrixTotal, 136);
  const sr = evidenceFiles["smoke-results.json"];
  assert.equal(sr.recaptured, true);
  assert.equal(sr.governed_rules_sha256, GOVERNED_RULES_SHA256);
  assert.equal(sr.matrix_total, 136); assert.equal(sr.passed, 136); assert.equal(sr.failed, 0);
  for (const r of sr.results) assert.deepEqual(Object.keys(r).sort(), ["expected", "label", "pass", "status"]);
  // list rows produce no fixtures, so durable manifest is unchanged: 3 users + 3 role docs + 8 seeds + 32 create-probes = 46
  assert.equal(manifestStore.appended.length, 46);
  assert.equal(manifestStore.appended.filter((e) => e.kind === "USER").length, 3);
  assert.equal(manifestStore.appended.filter((e) => e.kind === "DOC").length, 43);
  assert.ok(manifestStore.calls.includes("complete"));
  assert.ok(!manifestStore.calls.includes("retain"));
  assert.equal(out.residual.residualDocs, 0);
  assert.equal(out.residual.residualUsers, 0);
  assert.equal(world.docs.size, 0);
  assert.equal(world.users.size, 0);
});

// ---------- (1) pinned hash + project fail-closed BEFORE mutation ----------
test("config governedRulesSha256 drift fails BEFORE any fixture creation", async () => {
  const { world, manifestStore, deps } = makeDeps({ config: { governedRulesSha256: "b".repeat(64) } });
  await assert.rejects(runVerification(deps), /compiled governed pin/);
  assert.equal(world.docs.size, 0); assert.equal(world.users.size, 0);
  assert.equal(manifestStore.appended.length, 0);
});
test("live-source drift fails BEFORE any fixture creation", async () => {
  const { world, deps } = makeDeps({ liveSource: "rules_version = '2';\n// a DIFFERENT live ruleset\n" });
  await assert.rejects(runVerification(deps), /LIVE-EXTRACTED-SOURCE != GOVERNED/);
  assert.equal(world.docs.size, 0); assert.equal(world.users.size, 0);
});
test("wrong project / confirmation fails BEFORE any mutation", async () => {
  await assert.rejects(runVerification(makeDeps({ config: { projectId: "other" } }).deps), /projectId must be/);
  await assert.rejects(runVerification(makeDeps({ config: { confirmProject: "mismatch" } }).deps), /confirmProject/);
  await assert.rejects(runVerification(makeDeps({ targetProject: "other" }).deps), /dependency target project/);
});
test("assertGovernedPins is enforced directly", () => {
  assert.doesNotThrow(() => assertGovernedPins({ projectId: EXPECTED_PROJECT, confirmProject: EXPECTED_PROJECT, governedRulesSha256: GOVERNED_RULES_SHA256 }, EXPECTED_PROJECT));
  assert.throws(() => assertGovernedPins({ projectId: EXPECTED_PROJECT, confirmProject: EXPECTED_PROJECT, governedRulesSha256: "x" }, EXPECTED_PROJECT), /compiled governed pin/);
});

// ---------- (c)+(5) fail-closed run still cleans up; original error preserved ----------
test("a forbidden success aborts, cleanup still runs, ORIGINAL error is preserved", async () => {
  const world = makeWorld();
  const probe = async (req) => (req.method === "POST" ? 200 : happyProbe(req)); // forbidden create returns 200
  const { manifestStore, deps } = makeDeps({ world, probe });
  await assert.rejects(runVerification(deps), /Matrix mismatch/); // the ORIGINAL error, not a lifecycle error
  assert.equal(world.docs.size, 0, "cleanup ran"); assert.equal(world.users.size, 0);
  assert.ok(manifestStore.calls.includes("complete"), "cleanup+residual succeeded -> manifest completed, but the matrix error is still thrown");
});

// ---------- cleanup error is surfaced, not silent success; recovery retained ----------
test("a cleanup delete failure is surfaced (not silent) and the manifest is RETAINED", async () => {
  const world = makeWorld();
  const { manifestStore, deps } = makeDeps({ world });
  world.admin._failDeleteDoc = `trucks/${PREFIX}_seed_trucks`; // one delete throws -> cleanup.ok=false
  await assert.rejects(runVerification(deps), /LIFECYCLE FAILURE|RESIDUAL/);
  assert.ok(manifestStore.calls.includes("retain"), "manifest retained for recovery");
  assert.ok(!manifestStore.calls.includes("complete"), "not completed on cleanup failure");
});
test("residual non-zero after cleanup fails the run and retains the manifest", async () => {
  const world = makeWorld();
  // leave a stray prefixed user that cleanup won't see (not in manifest, not swept because we override)
  const admin = { ...world.admin, async listUsersByPrefix() { return [`${PREFIX}_uid_ghost`]; } };
  const { manifestStore, deps } = makeDeps({ world: { ...world, admin, auth: world.auth } });
  await assert.rejects(runVerification(deps), /LIFECYCLE FAILURE|RESIDUAL/);
  assert.ok(manifestStore.calls.includes("retain"));
  assert.ok(!manifestStore.calls.includes("complete"));
});

// ---------- fixture collision ----------
test("fixture collision (pre-existing seed doc) fails closed", async () => {
  const world = makeWorld();
  world.docs.add(`trucks/${PREFIX}_seed_trucks`);
  await assert.rejects(runVerification(makeDeps({ world }).deps), /fixture collision/);
});

// ---------- (e) cleanup idempotence + (f)(g) residual detection ----------
test("e. cleanup deletes manifest + is idempotent on empty; surfaces per-entry errors", async () => {
  const world = makeWorld();
  world.users.add("u1"); world.docs.add("trucks/x");
  const r = await cleanup({ admin: world.admin, manifest: [{ kind: "DOC", ref: "trucks/x" }, { kind: "USER", ref: "u1" }], prefix: PREFIX });
  assert.equal(r.ok, true); assert.equal(r.deletedDocs, 1); assert.equal(r.deletedUsers, 1);
  const empty = await cleanup({ admin: makeWorld().admin, manifest: [], prefix: PREFIX });
  assert.equal(empty.ok, true);
});
test("f/g. residualCheck fails on a lingering prefixed doc or Auth user (manifest + independent sweep)", async () => {
  const world = makeWorld();
  world.docs.add(`trucks/${PREFIX}_seed_trucks`);
  const r1 = await residualCheck({ admin: world.admin, manifest: [{ kind: "DOC", ref: `trucks/${PREFIX}_seed_trucks` }], prefix: PREFIX });
  assert.equal(r1.ok, false); assert.ok(r1.residualDocs >= 1);
  const world2 = makeWorld(); world2.users.add(`${PREFIX}_uid_admin`);
  const r2 = await residualCheck({ admin: world2.admin, manifest: [{ kind: "USER", ref: `${PREFIX}_uid_admin` }], prefix: PREFIX });
  assert.equal(r2.ok, false); assert.ok(r2.residualUsers >= 1);
});

// ---------- (h) sanitized output ----------
test("h. assertRunSecretFree catches real secrets, permits governed labels; smoke rows minimal", () => {
  const secrets = [PREFIX, "eyJabc.def.ghi", `${PREFIX}_uid_admin`];
  assert.throws(() => assertRunSecretFree({ x: "eyJabc.def.ghi" }, secrets), /sensitive/i);
  assert.throws(() => assertRunSecretFree({ x: PREFIX }, secrets), /sensitive/i);
  assert.throws(() => assertRunSecretFree("user@example.com", secrets), /sensitive/i);
  assert.throws(() => assertRunSecretFree("/home/op/trc/evidence", secrets), /sensitive/i);
  assert.throws(() => assertRunSecretFree("password=hunter2", secrets), /sensitive/i);
  assert.doesNotThrow(() => assertRunSecretFree({ results: buildMatrix().map((r) => ({ label: r.label, status: 403, expected: r.expected, pass: true })) }, secrets));
  assert.doesNotThrow(() => assertRunSecretFree(buildCrosswalk(), secrets));
});
test("h. sanitized durable evidence contains no manifest secrets (uid/prefix live only in the recovery store)", async () => {
  const { manifestStore, evidenceFiles } = makeDeps();
  const { deps } = makeDeps({ manifestStore });
  await runVerification(deps);
  const evidenceText = JSON.stringify(evidenceFiles);
  assert.ok(!evidenceText.includes(PREFIX), "run prefix must not be in sanitized evidence");
  for (const e of manifestStore.appended) assert.ok(!evidenceText.includes(e.ref) || !/_uid_|users\//.test(e.ref), "no uid/role-doc secret in evidence");
});
test("h. buildSmokeResults validates provenance + the compiled pin", () => {
  const rows = buildMatrix().map((r) => interpretRow(r, r.decision === "ALLOW" ? 200 : 403));
  const sr = buildSmokeResults({ rows, governedCommit: "a".repeat(40), governedRulesSha256: GOVERNED_RULES_SHA256, recaptureDate: "2026-08-01" });
  assert.equal(sr.results.length, 136);
  assert.throws(() => buildSmokeResults({ rows, governedCommit: "a".repeat(40), governedRulesSha256: GOVERNED_RULES_SHA256, recaptureDate: "bad" }), /recaptureDate/);
  assert.throws(() => buildSmokeResults({ rows, governedCommit: "a".repeat(40), governedRulesSha256: "b".repeat(64), recaptureDate: "2026-08-01" }), /governed pin/);
});

// ---------- crosswalk authority ----------
test("crosswalk maps 8 rule blocks; readable=20 checks (with list), closed=16; decisions consistent", () => {
  const xwalk = buildCrosswalk();
  assert.equal(xwalk.length, 8);
  let total = 0;
  let listChecks = 0;
  for (const b of xwalk) {
    const col = COLLECTIONS.find((c) => c.name === b.collection);
    assert.equal(b.checks.length, col.readPolicy === "ADMIN_DISPATCHER" ? 20 : 16);
    total += b.checks.length;
    for (const chk of b.checks) {
      const [p, c, o] = chk.label.split("/");
      assert.equal(chk.decision, expectedOutcome(p, c, o).decision);
      assert.equal(c, b.collection);
      if (o === "list") { listChecks += 1; assert.equal(col.readPolicy, "ADMIN_DISPATCHER"); } // list only on readable
    }
  }
  assert.equal(total, 136);
  assert.equal(listChecks, 8);
});

// ---------- operator CLI: config validation + dry dependency boundaries (no production) ----------
test("cli.parseArgs requires the confirmation arguments", () => {
  const ok = cli.parseArgs(["--config", "c.json", "--evidence-dir", "e", "--recovery-dir", "r", "--recapture-date", "2026-08-01", "--confirm-project", "taylor-parts"]);
  assert.equal(ok["confirm-project"], "taylor-parts");
  assert.throws(() => cli.parseArgs(["--config", "c.json"]), /missing required/);
  assert.throws(() => cli.parseArgs(["--config"]), /requires a value/);
});
test("cli.validateCliInputs fails closed on project/confirm/hash drift", () => {
  const base = { projectId: "taylor-parts", confirmProject: "taylor-parts", governedRulesSha256: GOVERNED_RULES_SHA256, webApiKeyEnv: "TRC_WEB_API_KEY", personas: [
    { label: "admin", emailEnv: "A_E", passwordEnv: "A_P" }, { label: "dispatcher", emailEnv: "D_E", passwordEnv: "D_P" }, { label: "technician", emailEnv: "T_E", passwordEnv: "T_P" }] };
  const args = { "confirm-project": "taylor-parts", "recapture-date": "2026-08-01" };
  assert.doesNotThrow(() => cli.validateCliInputs(base, args));
  assert.throws(() => cli.validateCliInputs({ ...base, governedRulesSha256: "b".repeat(64) }, args), /compiled governed pin/);
  assert.throws(() => cli.validateCliInputs({ ...base, projectId: "other" }, args), /projectId/);
  assert.throws(() => cli.validateCliInputs(base, { ...args, "confirm-project": "other" }), /confirm-project must be/);
  assert.throws(() => cli.validateCliInputs(base, { ...args, "recapture-date": "nope" }), /recapture-date/);
});
test("cli.generatePrefix is high-entropy and run-unique", () => {
  const p1 = cli.generatePrefix(); const p2 = cli.generatePrefix();
  assert.match(p1, /^trc_gatec_[0-9a-f]{16}$/);
  assert.notEqual(p1, p2);
});
test("cli.buildDurableManifestStore writes/retains/completes via injected fs (no evidence dir)", async () => {
  const writes = {}; const appends = [];
  const fakeFs = { mkdirSync() {}, writeFileSync(f, c) { writes[f] = c; }, appendFileSync(f, c) { appends.push([f, c]); } };
  const store = cli.buildDurableManifestStore({ recoveryDir: "/rec", prefix: PREFIX, fs: fakeFs, path });
  await store.append({ kind: "USER", ref: "u1" });
  assert.match(appends[0][1], /"u1"/);
  await store.retain(); assert.match(writes[store.statusFile], /RETAINED-FOR-RECOVERY/);
  await store.complete(); assert.match(writes[store.statusFile], /COMPLETE/);
});
test("cli.buildProductionDeps returns the dep shape WITHOUT touching production at construction", () => {
  const deps = cli.buildProductionDeps({ projectId: "taylor-parts", webApiKeyEnv: "TRC_WEB_API_KEY" }, { prefix: PREFIX, evidenceDir: "/ev" });
  for (const k of ["rules", "auth", "probe", "admin", "evidence"]) assert.ok(deps[k], `missing dep ${k}`);
  assert.equal(typeof deps.rules.fetchLiveSource, "function");
  assert.equal(typeof deps.auth.provisionPersona, "function");
  assert.equal(typeof deps.probe, "function");
  for (const m of ["docExists", "seedDoc", "deleteDoc", "deleteUser", "userExists", "listUsersByPrefix", "listDocIdsByPrefix"]) assert.equal(typeof deps.admin[m], "function");
});
test("cli module does not self-execute on import", () => {
  assert.equal(typeof cli.main, "function"); // requiring it above ran no production code
});

// ---------- collection-LIST checks (governed getDocs(collection(...)) verification) ----------
const SEED = (c) => `${PREFIX}_seed_${c}`;
const listRow = (persona, collection) => buildMatrix().find((r) => r.label === `${persona}/${collection}/list`);

test("list: ALLOW requires 200 AND the seeded run-specific record present", () => {
  const row = listRow("admin", "trucks");
  assert.equal(interpretListRow(row, SEED("trucks"), { status: 200, ids: [SEED("trucks"), "OTHER"] }).pass, true);
  assert.equal(interpretListRow(row, SEED("trucks"), { status: 200, ids: ["OTHER"] }).pass, false); // seeded missing
  assert.equal(interpretListRow(row, SEED("trucks"), { status: 403, ids: [] }).pass, false); // allowed but denied
});
test("list: DENY requires a governed denial status AND no records (no leakage)", () => {
  const tech = listRow("technician", "trucks");
  const unauth = listRow("unauthenticated", "mobile_locations");
  assert.equal(interpretListRow(tech, SEED("trucks"), { status: 403, ids: [] }).pass, true);
  assert.equal(interpretListRow(unauth, SEED("mobile_locations"), { status: 401, ids: [] }).pass, true);
  // leakage: a denied list that returns records fails, even with a denial status
  const leaked = interpretListRow(tech, SEED("trucks"), { status: 403, ids: [SEED("trucks")] });
  assert.equal(leaked.pass, false);
  assert.equal(leaked.interpretation, "DENY_LIST_LEAKED_RECORDS");
  // wrong denial status also fails
  assert.equal(interpretListRow(tech, SEED("trucks"), { status: 200, ids: [] }).pass, false);
});
test("list: a malformed response fails closed", () => {
  const row = listRow("admin", "trucks");
  assert.equal(interpretListRow(row, SEED("trucks"), { malformed: true }).pass, false);
  assert.equal(interpretListRow(row, SEED("trucks"), { status: 200 }).pass, false); // 200 with no ids array
  assert.equal(interpretListRow(row, SEED("trucks"), undefined).pass, false);
});
test("full run: list mismatch (allowed list missing the seeded record) aborts AND cleanup still runs", async () => {
  const world = makeWorld();
  const listProbe = async ({ persona, collection }) => {
    const eo = expectedOutcome(persona, collection, "list");
    if (eo.decision === "ALLOW") return { status: 200, ids: [] }; // seeded MISSING -> fail
    return { status: persona === "unauthenticated" ? 401 : 403, ids: [] };
  };
  const { manifestStore, deps } = makeDeps({ world, listProbe });
  await assert.rejects(runVerification(deps), /Matrix mismatch .*\/list/);
  assert.equal(world.docs.size, 0); assert.equal(world.users.size, 0); // cleanup ran
  assert.ok(manifestStore.calls.includes("complete")); // cleanup+residual succeeded; matrix error still thrown
});
test("full run: a denied list that LEAKS records aborts the run", async () => {
  const world = makeWorld();
  const listProbe = async ({ persona, collection }) => {
    const eo = expectedOutcome(persona, collection, "list");
    if (eo.decision === "ALLOW") return { status: 200, ids: [SEED(collection)] };
    return { status: 403, ids: [SEED(collection)] }; // DENY but leaks the record -> fail
  };
  await assert.rejects(runVerification(makeDeps({ world, listProbe }).deps), /Matrix mismatch .*\/list/);
});
test("adapter: real listProbe parses documents on 200, empties on denial, flags malformed", async () => {
  const responses = {
    ok: { status: 200, async json() { return { documents: [{ name: `projects/p/databases/(default)/documents/trucks/${SEED("trucks")}` }, { name: "x/y/trucks/OTHER" }] }; } },
    denied: { status: 403, async json() { return {}; } },
    malformed: { status: 200, async json() { throw new Error("not json"); } },
    baddocs: { status: 200, async json() { return { documents: "not-an-array" }; } },
  };
  const mk = (r) => cli.buildProductionDeps({ projectId: "taylor-parts" }, { prefix: PREFIX, evidenceDir: "/ev", env: { doFetch: async () => r } });
  assert.deepEqual((await mk(responses.ok).listProbe({ collection: "trucks", token: "t" })).ids.sort(), [SEED("trucks"), "OTHER"].sort());
  assert.deepEqual(await mk(responses.denied).listProbe({ collection: "trucks", token: "t" }), { status: 403, ids: [] });
  assert.equal((await mk(responses.malformed).listProbe({ collection: "trucks", token: "t" })).malformed, true);
  assert.equal((await mk(responses.baddocs).listProbe({ collection: "trucks", token: "t" })).malformed, true);
});

// ---------- REAL adapter boundary tests (injected firebase-admin/fetch fakes; no production) ----------
test("adapter: provisionPersona durably records USER then role DOC BEFORE sign-in; sign-in failure orphans nothing", async () => {
  const calls = [];
  const fakeAdmin = {
    auth: () => ({ createUser: async () => ({ uid: "UID1" }) }),
    firestore: () => ({ collection: () => ({ doc: () => ({ set: async () => {} }) }) }),
  };
  const env = { getAdmin: () => fakeAdmin, doFetch: async () => ({ json: async () => ({}) }), readEnv: () => "apikey", crypto: { randomBytes: () => ({ toString: () => "pw" }) } };
  const deps = cli.buildProductionDeps({ projectId: "taylor-parts", webApiKeyEnv: "K" }, { prefix: PREFIX, evidenceDir: "/ev", env });
  await assert.rejects(deps.auth.provisionPersona("admin", PREFIX, async (e) => calls.push(e)), /sign-in failed/);
  assert.deepEqual(calls.map((c) => c.kind), ["USER", "DOC"]); // both recorded before the throw
  assert.equal(calls[0].ref, "UID1");
  assert.equal(calls[1].ref, "users/UID1");
});

test("adapter: listDocIdsByPrefix uses FieldPath.documentId() + startAt/endAt; finds prefixed, excludes unrelated", async () => {
  const captured = {};
  const store = [{ id: `${PREFIX}_seed_trucks` }, { id: "unrelated" }, { id: `${PREFIX}_seed_x` }];
  const q = { orderBy(f) { captured.orderBy = f; return q; }, startAt(v) { captured.startAt = v; return q; }, endAt(v) { captured.endAt = v; return q; },
    async get() { return { docs: store.filter((d) => d.id >= captured.startAt && d.id <= captured.endAt) }; } };
  const firestore = () => ({ collection: () => q });
  firestore.FieldPath = { documentId: () => "__DOCID__" };
  const env = { getAdmin: () => ({ firestore }) };
  const deps = cli.buildProductionDeps({ projectId: "taylor-parts" }, { prefix: PREFIX, evidenceDir: "/ev", env });
  const ids = await deps.admin.listDocIdsByPrefix("trucks", PREFIX);
  assert.equal(captured.orderBy, "__DOCID__");
  assert.equal(captured.startAt, PREFIX);
  assert.equal(captured.endAt, `${PREFIX}`);
  assert.deepEqual(ids.sort(), [`${PREFIX}_seed_trucks`, `${PREFIX}_seed_x`].sort());
  assert.ok(!ids.includes("unrelated"));
});

test("adapter: userExists returns false ONLY for user-not-found; rethrows any other error", async () => {
  const mk = (err) => cli.buildProductionDeps({ projectId: "taylor-parts" }, { prefix: PREFIX, evidenceDir: "/ev", env: { getAdmin: () => ({ auth: () => ({ getUser: async () => { if (err) throw err; } }) }) } });
  const notFound = Object.assign(new Error("no user"), { code: "auth/user-not-found" });
  const backend = Object.assign(new Error("backend error"), { code: "unavailable" });
  assert.equal(await mk(notFound).admin.userExists("u"), false);
  assert.equal(await mk(null).admin.userExists("u"), true);
  await assert.rejects(mk(backend).admin.userExists("u"), /backend error/);
});

test("lifecycle: simultaneous probe failure + cleanup failure preserves the primary error AND surfaces the lifecycle failure + recovery", async () => {
  const world = makeWorld();
  world.admin._failDeleteDoc = `trucks/${PREFIX}_seed_trucks`; // cleanup delete throws
  const probe = async (req) => (req.method === "POST" ? 200 : happyProbe(req)); // forbidden create -> matrix mismatch
  const { manifestStore, deps } = makeDeps({ world, probe });
  let caught;
  await runVerification(deps).catch((e) => { caught = e; });
  assert.match(caught.message, /Matrix mismatch/); // ORIGINAL error preserved
  assert.ok(caught.lifecycleFailure, "lifecycle failure attached");
  assert.equal(caught.recoveryRetained, true);
  assert.ok(caught.recoveryLocation);
  assert.ok(manifestStore.calls.includes("retain"));
  assert.ok(!manifestStore.calls.includes("complete"));
});
