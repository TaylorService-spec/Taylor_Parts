"use strict";

// EI Truck Registry — governed smoke-verifier unit tests. All logic is exercised with INJECTED
// fakes: no emulator, no live project, no production access. Run: node --test functions/test/verifyTruckRegistryDeployment.test.js
const assert = require("node:assert/strict");
const test = require("node:test");
const crypto = require("node:crypto");

const matrix = require("../scripts/truckRegistryVerificationMatrix");
const {
  PERSONAS,
  OPERATIONS,
  COLLECTIONS,
  expectedOutcome,
  deniedStatuses,
  buildMatrix,
  buildCrosswalk,
} = matrix;
const {
  interpretRow,
  buildSmokeResults,
  assertRunSecretFree,
  cleanup,
  residualCheck,
  runVerification,
} = require("../scripts/verifyTruckRegistryDeployment");

const sha256 = (v) => crypto.createHash("sha256").update(v).digest("hex");
const PREFIX = "trc_gatectest_deadbeefcafef00d";
const GOVERNED_SOURCE = "rules_version = '2';\n// governed truck-registry rules under test\n";
const GOVERNED_SHA = sha256(GOVERNED_SOURCE);

// ---------- (a) matrix completeness, cardinality, uniqueness (non-tautological) ----------
test("a. collections/personas/operations definitions are exactly the governed sets", () => {
  const names = COLLECTIONS.map((c) => c.name);
  assert.equal(names.length, 8);
  assert.equal(new Set(names).size, 8, "collections must be unique");
  assert.deepEqual([...names].sort(), [
    "equipment_compatibility_operations", "equipment_compatibility_sources", "equipment_model_aliases",
    "equipment_models", "equipment_part_compatibility", "location_truck_claims", "mobile_locations", "trucks",
  ]);
  assert.deepEqual([...PERSONAS].sort(), ["admin", "dispatcher", "technician", "unauthenticated"]);
  assert.deepEqual([...OPERATIONS].sort(), ["create", "delete", "get", "update"]);
});

test("a. buildMatrix yields exactly one row per (collection,persona,operation), total 128, no extras/dupes", () => {
  const rows = buildMatrix();
  assert.equal(rows.length, 128);
  const keys = rows.map((r) => `${r.collection}::${r.persona}::${r.operation}`);
  assert.equal(new Set(keys).size, 128, "every key must be unique");
  // every expected key exists exactly once (independent cross-product, not a compare-to-self)
  const seen = new Map();
  for (const k of keys) seen.set(k, (seen.get(k) || 0) + 1);
  for (const c of COLLECTIONS) for (const p of PERSONAS) for (const o of OPERATIONS) {
    assert.equal(seen.get(`${c.name}::${p}::${o}`), 1, `missing/dup ${c.name}/${p}/${o}`);
  }
  // no extra keys beyond the cross product
  assert.equal(seen.size, 8 * 4 * 4);
  // per-axis cardinality
  for (const c of COLLECTIONS) assert.equal(rows.filter((r) => r.collection === c.name).length, 16);
  for (const p of PERSONAS) assert.equal(rows.filter((r) => r.persona === p).length, 32);
  for (const o of OPERATIONS) assert.equal(rows.filter((r) => r.operation === o).length, 32);
});

test("a. decisions total exactly 4 ALLOW / 124 DENY, and the 4 ALLOW cells are the governed ones", () => {
  const rows = buildMatrix();
  assert.equal(rows.filter((r) => r.decision === "ALLOW").length, 4);
  assert.equal(rows.filter((r) => r.decision === "DENY").length, 124);
  const allowLabels = rows.filter((r) => r.decision === "ALLOW").map((r) => r.label).sort();
  assert.deepEqual(allowLabels, [
    "admin/mobile_locations/get", "admin/trucks/get", "dispatcher/mobile_locations/get", "dispatcher/trucks/get",
  ]);
});

// ---------- (b) expected allow/deny mapping (independent) ----------
test("b. expectedOutcome derives ALLOW only for admin/dispatcher single-doc reads of readable collections", () => {
  assert.equal(expectedOutcome("admin", "trucks", "get").decision, "ALLOW");
  assert.deepEqual(expectedOutcome("admin", "trucks", "get").expected, [200]);
  assert.equal(expectedOutcome("dispatcher", "mobile_locations", "get").decision, "ALLOW");
  assert.equal(expectedOutcome("technician", "trucks", "get").decision, "DENY");
  assert.equal(expectedOutcome("unauthenticated", "trucks", "get").decision, "DENY");
  assert.equal(expectedOutcome("admin", "trucks", "create").decision, "DENY"); // writes always deny
  assert.equal(expectedOutcome("admin", "location_truck_claims", "get").decision, "DENY"); // closed read
  assert.equal(expectedOutcome("admin", "equipment_models", "get").decision, "DENY"); // D4 closed
});

test("b. denial statuses: unauthenticated accepts 401 or 403; authenticated strictly 403", () => {
  assert.deepEqual([...deniedStatuses("unauthenticated")], [401, 403]);
  assert.deepEqual([...deniedStatuses("technician")], [403]);
  assert.deepEqual([...expectedOutcome("unauthenticated", "trucks", "get").expected], [401, 403]);
});

// ---------- (c) fail-closed status interpretation ----------
test("c. interpretRow fails closed on any status not in the expected set", () => {
  const rows = buildMatrix();
  const allowRow = rows.find((r) => r.label === "admin/trucks/get");
  assert.equal(interpretRow(allowRow, 200).pass, true);
  assert.equal(interpretRow(allowRow, 403).pass, false, "allowed read returning 403 must fail");
  assert.equal(interpretRow(allowRow, 404).pass, false, "a missing doc (404) is NOT acceptable for an allowed read");
  const denyWrite = rows.find((r) => r.label === "admin/trucks/create");
  assert.equal(interpretRow(denyWrite, 403).pass, true);
  assert.equal(interpretRow(denyWrite, 200).pass, false, "a forbidden write returning 200 must fail");
  assert.equal(interpretRow(denyWrite, 500).pass, false);
});

// ---------- fakes for the full lifecycle ----------
function makeFakeAdmin({ preexisting = [], residualDocs = {}, residualUsers = [] } = {}) {
  const docs = new Set(preexisting);
  const seeded = []; const deletedDocs = []; const deletedUsers = [];
  return {
    docs, seeded, deletedDocs, deletedUsers,
    async docExists(path) { return docs.has(path); },
    async seedDoc(col, id) { docs.add(`${col}/${id}`); seeded.push(`${col}/${id}`); },
    async deleteDoc(path) { docs.delete(path); deletedDocs.push(path); },
    async deleteUser(uid) { deletedUsers.push(uid); },
    async listUsersByPrefix() { return [...residualUsers]; },
    async listDocIdsByPrefix(col) { return [...(residualDocs[col] || [])]; },
  };
}
function makeDeps(overrides = {}) {
  const admin = overrides.admin || makeFakeAdmin();
  const evidenceFiles = {};
  const probe = overrides.probe || (async ({ persona, method, target }) => {
    const op = method === "GET" ? "get" : method === "POST" ? "create" : method === "PATCH" ? "update" : "delete";
    const collection = target.split(/[/?]/)[0];
    const eo = expectedOutcome(persona, collection, op);
    return eo.decision === "ALLOW" ? 200 : (persona === "unauthenticated" ? 401 : 403);
  });
  return {
    admin, evidenceFiles,
    deps: {
      config: { projectId: "taylor-parts", governedCommit: "a".repeat(40), governedRulesSha256: overrides.sha || GOVERNED_SHA },
      rules: { async fetchLiveSource() { return { source: { files: [{ name: "firestore.rules", content: overrides.liveSource || GOVERNED_SOURCE }] } }; } },
      auth: { async provisionPersona(persona) { return { uid: `${PREFIX}_uid_${persona}`, token: `eyJ${persona}.${"a".repeat(20)}.${"b".repeat(20)}` }; } },
      probe,
      admin,
      evidence: { async write(files) { Object.assign(evidenceFiles, files); } },
      prefix: PREFIX,
      recaptureDate: "2026-08-01",
      log: () => {},
      ...overrides.depOverrides,
    },
  };
}

// ---------- happy path + (d) manifest recording ----------
test("full run: 128/128 pass; evidence emitted; fixtures seeded+recorded; cleanup+residual zero", async () => {
  const { admin, evidenceFiles, deps } = makeDeps();
  const out = await runVerification(deps);
  assert.equal(out.matrixTotal, 128);
  const sr = evidenceFiles["smoke-results.json"];
  assert.equal(sr.recaptured, true);
  assert.equal(sr.recapture_date, "2026-08-01");
  assert.match(sr.note, /post-deployment recapture/i);
  assert.equal(sr.governed_rules_sha256, GOVERNED_SHA);
  assert.equal(sr.matrix_total, 128);
  assert.equal(sr.passed, 128);
  assert.equal(sr.failed, 0);
  assert.equal(sr.results.length, 128);
  for (const r of sr.results) assert.deepEqual(Object.keys(r).sort(), ["expected", "label", "pass", "status"]);
  // (d) manifest: 8 seed docs + 32 create-probe docs deleted; 3 persona users deleted.
  assert.equal(admin.seeded.length, 8);
  assert.equal(admin.deletedDocs.length, 40, "8 seeds + 32 create-probes");
  assert.equal(admin.deletedUsers.length, 3);
  assert.equal(out.residual.residualDocs, 0);
  assert.equal(out.residual.residualUsers, 0);
});

// ---------- (4) live-rules precondition ----------
test("precondition: live != governed aborts BEFORE any fixture creation", async () => {
  const { admin, deps } = makeDeps({ liveSource: "rules_version = '2';\n// DIFFERENT live rules\n" });
  await assert.rejects(runVerification(deps), /LIVE-EXTRACTED-SOURCE != GOVERNED/);
  assert.equal(admin.seeded.length, 0, "no docs seeded on precondition failure");
  assert.equal(admin.deletedUsers.length, 0);
});

// ---------- (c)+(5) fail-closed run still cleans up ----------
test("a forbidden success fails the run immediately AND cleanup still runs (finally)", async () => {
  // probe: a denied create returns 200 (rule regression) -> mismatch -> throw.
  const admin = makeFakeAdmin();
  const probe = async ({ persona, method, target }) => {
    const op = method === "GET" ? "get" : method === "POST" ? "create" : method === "PATCH" ? "update" : "delete";
    if (op === "create") return 200; // forbidden success
    const eo = expectedOutcome(persona, target.split(/[/?]/)[0], op);
    return eo.decision === "ALLOW" ? 200 : 403;
  };
  const { deps } = makeDeps({ admin, probe });
  await assert.rejects(runVerification(deps), /Matrix mismatch/);
  assert.ok(admin.deletedUsers.length >= 1 || admin.deletedDocs.length >= 1, "cleanup ran via finally");
});

// ---------- (1) fixture collision guard ----------
test("fixture collision (pre-existing seed doc) fails closed", async () => {
  const admin = makeFakeAdmin({ preexisting: [`trucks/${PREFIX}_seed_trucks`] });
  const { deps } = makeDeps({ admin });
  await assert.rejects(runVerification(deps), /fixture collision/);
});

// ---------- (e) cleanup idempotent ----------
test("e. cleanup deletes every manifest entry and is safe on an empty manifest", async () => {
  const admin = makeFakeAdmin();
  const manifest = [{ kind: "DOC", ref: "trucks/x" }, { kind: "DOC", ref: "trucks/y" }, { kind: "USER", ref: "u1" }];
  const r = await cleanup({ admin, manifest, prefix: PREFIX });
  assert.equal(admin.deletedDocs.length, 2);
  assert.equal(admin.deletedUsers.length, 1);
  assert.match(r.marker, /CLEANUP-DONE for trc_/);
  const empty = await cleanup({ admin: makeFakeAdmin(), manifest: [], prefix: PREFIX });
  assert.match(empty.marker, /CLEANUP-DONE/);
});

// ---------- (f)+(g)+(6) residual detection independent of manifest ----------
test("f. residualCheck fails when a prefixed document lingers", async () => {
  const admin = makeFakeAdmin({ residualDocs: { trucks: [`${PREFIX}_seed_trucks`] } });
  const r = await residualCheck({ admin, prefix: PREFIX });
  assert.equal(r.ok, false);
  assert.equal(r.residualDocs, 1);
});
test("g. residualCheck fails when a prefixed Auth user lingers", async () => {
  const admin = makeFakeAdmin({ residualUsers: [`${PREFIX}_uid_admin`] });
  const r = await residualCheck({ admin, prefix: PREFIX });
  assert.equal(r.ok, false);
  assert.equal(r.residualUsers, 1);
});
test("g. residual non-zero after cleanup makes the whole run fail (manifest retained for recovery)", async () => {
  const admin = makeFakeAdmin({ residualUsers: [`${PREFIX}_uid_admin`] });
  const { deps } = makeDeps({ admin });
  await assert.rejects(runVerification(deps), /RESIDUAL NON-ZERO/);
});

// ---------- (h) sanitized output ----------
test("h. assertRunSecretFree catches real secrets but permits governed labels", () => {
  const secrets = [PREFIX, "eyJabc.def.ghi", `${PREFIX}_uid_admin`];
  assert.throws(() => assertRunSecretFree({ x: `token eyJabc.def.ghi` }, secrets), /sensitive/i);
  assert.throws(() => assertRunSecretFree({ x: PREFIX }, secrets), /sensitive/i);
  assert.throws(() => assertRunSecretFree("user@example.com", secrets), /sensitive/i);
  assert.throws(() => assertRunSecretFree("/home/operator/trc/evidence", secrets), /sensitive/i);
  assert.throws(() => assertRunSecretFree("password=hunter2", secrets), /sensitive/i);
  // governed labels/collection names are safe even though they look path-like
  assert.doesNotThrow(() => assertRunSecretFree({ results: buildMatrix().map((r) => ({ label: r.label, status: 403, expected: r.expected, pass: true })) }, secrets));
  assert.doesNotThrow(() => assertRunSecretFree(buildCrosswalk(), secrets));
});

test("h. buildSmokeResults validates provenance and emits only label/status/expected/pass rows", () => {
  const rows = buildMatrix().map((r) => interpretRow(r, r.decision === "ALLOW" ? 200 : 403));
  const sr = buildSmokeResults({ rows, governedCommit: "a".repeat(40), governedRulesSha256: GOVERNED_SHA, recaptureDate: "2026-08-01" });
  assert.equal(sr.results.length, 128);
  for (const r of sr.results) assert.deepEqual(Object.keys(r).sort(), ["expected", "label", "pass", "status"]);
  assert.throws(() => buildSmokeResults({ rows, governedCommit: "a".repeat(40), governedRulesSha256: GOVERNED_SHA, recaptureDate: "bad" }), /recaptureDate/);
  assert.throws(() => buildSmokeResults({ rows, governedCommit: "a".repeat(40), governedRulesSha256: "short", recaptureDate: "2026-08-01" }), /SHA-256/);
});

// ---------- crosswalk authority (distinct from the generator) ----------
test("crosswalk maps all 8 rule blocks, each to its 16 checks, decisions consistent with expectedOutcome", () => {
  const xwalk = buildCrosswalk();
  assert.equal(xwalk.length, 8);
  let total = 0;
  for (const block of xwalk) {
    assert.equal(block.checks.length, 16);
    total += block.checks.length;
    for (const chk of block.checks) {
      const [persona, collection, operation] = chk.label.split("/");
      assert.equal(chk.decision, expectedOutcome(persona, collection, operation).decision);
      assert.equal(collection, block.collection);
    }
  }
  assert.equal(total, 128);
});
