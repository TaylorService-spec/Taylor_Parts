"use strict";

// EI Truck Registry — GATE E4 READ-ONLY BACKEND VERIFIER — OFFLINE unit tests. Pure `node --test`
// with INJECTED FAKES only: NO network, NO production, NO emulator, NO gcloud/firebase/credentials.
// Covers the core (all six check groups, every fail-closed branch, category distinctions, sanitized
// report) AND the CLI adapter logic (arg/config validation, emulator + service-account-key
// rejection, checkout pin, atomic evidence publication success/failure, existing-dir refusal, and a
// spy proving no write API is reachable).

const { test } = require("node:test");
const assert = require("node:assert/strict");
const nodePath = require("node:path");

const core = require("../scripts/verifyTruckBackend");
const cli = require("../scripts/truckBackendVerifierCli");
const { assertEvidenceSecretFree } = require("../scripts/firestoreDeploymentVerificationShared");

const COMMIT = "a".repeat(40);
const ts = (ms) => ({ toMillis: () => ms });

function healthyStore() {
  return {
    trucks: {
      "1": {
        truckId: "1", locationId: "MLOC-1", homeWarehouseId: "wh-main", status: "IDLE",
        assignedDriverEmployeeId: null, displayLabel: "10", vehicleNumber: "10",
        active: true, version: 3, createdAt: ts(1000), updatedAt: ts(3000), createdBy: "sys", updatedBy: "sys",
      },
    },
    mobile_locations: {
      "MLOC-1": { locationId: "MLOC-1", type: "MOBILE", displayLabel: "10", active: true, version: 1, createdAt: ts(1000), updatedAt: ts(1000), createdBy: "sys", updatedBy: "sys" },
    },
    location_truck_claims: {
      "MLOC-1": { locationId: "MLOC-1", truckId: "1", version: 1, createdAt: ts(1000), createdBy: "sys" },
    },
    auditEvents: [
      { id: "tr_a", data: { targetType: "truck", targetId: "1", action: "createTruck", outcome: "applied", at: ts(1000) } },
      { id: "tr_b", data: { targetType: "truck", targetId: "1", action: "unassignTruckDriver", outcome: "applied", at: ts(2000) } },
      { id: "tr_c", data: { targetType: "truck", targetId: "1", action: "changeTruckStatus", outcome: "applied", at: ts(3000) } },
    ],
  };
}

function goodConfig() {
  return {
    projectId: "taylor-parts", confirmProject: "taylor-parts", governedCommit: COMMIT,
    truckId: "1",
    expected: { displayLabel: "10", vehicleNumber: "10", status: "IDLE", homeWarehouseId: "wh-main", assignedDriverEmployeeId: null },
  };
}

function makeReads(store, opts = {}) {
  return {
    async getDoc(collection, id) {
      if (opts.throwOn && opts.throwOn({ collection, id, kind: "get" })) throw new Error("permission-denied");
      const coll = store[collection] || {};
      const data = coll[id];
      return data === undefined ? null : { id, data };
    },
    async queryByField(collection, field, value, limit) {
      if (opts.throwOn && opts.throwOn({ collection, field, kind: "query" })) throw new Error("permission-denied");
      if (collection === "auditEvents") {
        return (store.auditEvents || []).filter((e) => e.data[field] === value).slice(0, limit).map((e) => ({ id: e.id, data: e.data }));
      }
      const coll = store[collection] || {};
      return Object.entries(coll).filter(([, d]) => d[field] === value).slice(0, limit).map(([id, d]) => ({ id, data: d }));
    },
  };
}

async function run(store, { config = goodConfig(), reads, opts } = {}) {
  const published = {};
  const publish = async (files) => { published.files = files; return "/evidence/verify-2026-08-02"; };
  const r = await core.runVerification({
    config, targetProject: "taylor-parts", targetCommit: COMMIT,
    reads: reads || makeReads(store, opts || {}), publish, verifyDate: "2026-08-02", log: () => {},
  });
  return { ...r, published };
}

// ---------------------------------------------------------------- happy path
test("healthy quarantined truck: all checks pass, sanitized report published", async () => {
  const { published, report } = await run(healthyStore());
  assert.equal(report.verified, true);
  assert.equal(report.passed, report.matrix_total);
  assert.ok(report.matrix_total >= 20);
  const doc = published.files["verification-report.json"];
  assert.equal(doc.stored.status, "IDLE");
  assert.equal(doc.stored.driverAssigned, false);
  assert.equal(doc.stored.version, 3);
  assert.equal(doc.audit_summary.appliedCreateTruck, 1);
  assert.equal(doc.audit_summary.appliedUnassignTruckDriver, 1);
  assert.equal(doc.audit_summary.appliedChangeTruckStatus, 1);
  assert.equal(doc.audit_summary.versionEqualsAppliedCount, true);
  assert.equal(doc.audit_summary.creationPrecedesContainment, true);
  // sanitized: no raw locationId, no actorUid, no summaries
  const text = JSON.stringify(doc);
  assert.ok(!text.includes("MLOC-1"), "raw locationId must not appear");
  assert.match(doc.locationIdSha256, /^[0-9a-f]{64}$/);
  assert.ok(!text.includes("actorUid"));
});

// ---------------------------------------------------------------- missing records
test("missing truck fails closed and publishes nothing", async () => {
  const s = healthyStore(); s.trucks = {};
  const published = {};
  await assert.rejects(core.runVerification({
    config: goodConfig(), targetProject: "taylor-parts", targetCommit: COMMIT,
    reads: makeReads(s), publish: async (f) => { published.files = f; return "/x"; }, verifyDate: "2026-08-02", log: () => {},
  }), /verification FAILED/);
  assert.equal(published.files, undefined, "no evidence on failure");
});

test("missing mobile_location fails closed", async () => {
  const s = healthyStore(); s.mobile_locations = {};
  await assert.rejects(run(s), /verification FAILED/);
});

test("missing claim fails closed", async () => {
  const s = healthyStore(); s.location_truck_claims = {};
  await assert.rejects(run(s), /verification FAILED/);
});

// ---------------------------------------------------------------- malformed identity / version
test("malformed stored truck identity (truckId != docId) fails closed", async () => {
  const s = healthyStore(); s.trucks["1"].truckId = "2";
  await assert.rejects(run(s), /verification FAILED/);
});

test("nonpositive / non-integer version fails closed", async () => {
  const s = healthyStore(); s.trucks["1"].version = 0;
  await assert.rejects(run(s), /verification FAILED/);
  const s2 = healthyStore(); s2.trucks["1"].version = 2.5;
  await assert.rejects(run(s2), /verification FAILED/);
});

// ---------------------------------------------------------------- reciprocity conflicts
test("claim pointing at a different truck fails closed", async () => {
  const s = healthyStore(); s.location_truck_claims["MLOC-1"].truckId = "2";
  await assert.rejects(run(s), /verification FAILED/);
});

test("location with mismatched stored id fails closed", async () => {
  const s = healthyStore(); s.mobile_locations["MLOC-1"].locationId = "OTHER";
  await assert.rejects(run(s), /verification FAILED/);
});

test("location not typed MOBILE fails closed", async () => {
  const s = healthyStore(); s.mobile_locations["MLOC-1"].type = "WAREHOUSE";
  await assert.rejects(run(s), /verification FAILED/);
});

// ---------------------------------------------------------------- duplicates
test("second truck referencing the same location is detected (duplicate) and fails closed", async () => {
  const s = healthyStore();
  s.trucks["1-dup"] = { ...s.trucks["1"], truckId: "1-dup" };
  await assert.rejects(run(s), /verification FAILED/);
});

test("second claim pointing at the truck is detected and fails closed", async () => {
  const s = healthyStore();
  s.location_truck_claims["MLOC-2"] = { locationId: "MLOC-2", truckId: "1", version: 1, createdAt: ts(1000), createdBy: "sys" };
  await assert.rejects(run(s), /verification FAILED/);
});

test("duplicate-query overflow (>= limit) fails closed", async () => {
  const s = healthyStore();
  for (let i = 0; i < core.DUP_QUERY_LIMIT + 2; i += 1) s.trucks[`d${i}`] = { ...s.trucks["1"], truckId: `d${i}` };
  await assert.rejects(run(s), /verification FAILED/);
});

// ---------------------------------------------------------------- expected-value mismatches
for (const [field, mutate] of [
  ["status", (s) => { s.trucks["1"].status = "ACTIVE"; }],
  ["warehouse", (s) => { s.trucks["1"].homeWarehouseId = "wh-other"; }],
  ["label", (s) => { s.trucks["1"].displayLabel = "99"; }],
  ["vehicle", (s) => { s.trucks["1"].vehicleNumber = "99"; }],
  ["driver", (s) => { s.trucks["1"].assignedDriverEmployeeId = "emp-1"; }],
]) {
  test(`wrong ${field} fails closed`, async () => {
    const s = healthyStore(); mutate(s);
    await assert.rejects(run(s), /verification FAILED/);
  });
}

// ---------------------------------------------------------------- audit checks
test("absent createTruck audit fails closed", async () => {
  const s = healthyStore(); s.auditEvents = s.auditEvents.filter((e) => e.data.action !== "createTruck");
  await assert.rejects(run(s), /verification FAILED/);
});

test("duplicate applied createTruck audit fails closed", async () => {
  const s = healthyStore();
  s.auditEvents.push({ id: "tr_a2", data: { targetType: "truck", targetId: "1", action: "createTruck", outcome: "applied", at: ts(1000) } });
  // version stays 3 but 4 applied -> also consistency mismatch; either way fails closed
  await assert.rejects(run(s), /verification FAILED/);
});

test("uncertain audit outcome fails closed", async () => {
  const s = healthyStore();
  s.auditEvents.push({ id: "tr_u", data: { targetType: "truck", targetId: "1", action: "changeTruckHomeWarehouse", outcome: "uncertain", at: ts(2500) } });
  await assert.rejects(run(s), /verification FAILED/);
});

test("malformed audit (unknown action) fails closed", async () => {
  const s = healthyStore();
  s.auditEvents.push({ id: "tr_m", data: { targetType: "truck", targetId: "1", action: "frobnicate", outcome: "applied", at: ts(2500) } });
  await assert.rejects(run(s), /verification FAILED/);
});

test("extra applied action (unexpected) fails closed", async () => {
  const s = healthyStore();
  s.auditEvents.push({ id: "tr_x", data: { targetType: "truck", targetId: "1", action: "changeTruckHomeWarehouse", outcome: "applied", at: ts(2500) } });
  s.trucks["1"].version = 4;
  await assert.rejects(run(s), /verification FAILED/);
});

test("denied audit events are tolerated (counted, not failed)", async () => {
  const s = healthyStore();
  s.auditEvents.push({ id: "tr_d", data: { targetType: "truck", targetId: "1", action: "deleteTruckCreatedInError", outcome: "denied", at: ts(2500) } });
  const { report } = await run(s);
  assert.equal(report.verified, true);
  assert.equal(report.audit_summary.deniedCount, 1);
});

test("required applied event with MISSING targetType fails closed (P2)", async () => {
  const s = healthyStore();
  delete s.auditEvents.find((e) => e.data.action === "createTruck").data.targetType;
  const published = {};
  await assert.rejects(core.runVerification({
    config: goodConfig(), targetProject: "taylor-parts", targetCommit: COMMIT,
    reads: makeReads(s), publish: async (f) => { published.files = f; return "/x"; }, verifyDate: "2026-08-02", log: () => {},
  }), /verification FAILED/);
  assert.equal(published.files, undefined, "no evidence published for malformed targetType");
});

test("required applied event with NULL / non-string targetType fails closed (P2)", async () => {
  for (const bad of [null, 42, {}]) {
    const s = healthyStore();
    s.auditEvents.find((e) => e.data.action === "unassignTruckDriver").data.targetType = bad;
    const published = {};
    await assert.rejects(core.runVerification({
      config: goodConfig(), targetProject: "taylor-parts", targetCommit: COMMIT,
      reads: makeReads(s), publish: async (f) => { published.files = f; return "/x"; }, verifyDate: "2026-08-02", log: () => {},
    }), /verification FAILED/);
    assert.equal(published.files, undefined, "no evidence published for malformed targetType");
  }
});

test("valid event for another targetType sharing targetId is ignored; truck sequence still passes (P2)", async () => {
  const s = healthyStore();
  // A legitimate non-truck governed event that happens to share targetId "1".
  s.auditEvents.push({ id: "wo_1", data: { targetType: "workOrder", targetId: "1", action: "createWorkOrder", outcome: "applied", at: ts(2500) } });
  const { report } = await run(s);
  assert.equal(report.verified, true);
  assert.equal(report.audit_summary.appliedCreateTruck, 1);
  assert.equal(report.audit_summary.otherAppliedCount, 0, "the non-truck event must not count as a truck action");
});

test("audit query failure fails closed", async () => {
  const s = healthyStore();
  await assert.rejects(run(s, { opts: { throwOn: ({ collection }) => collection === "auditEvents" } }), /verification FAILED/);
});

// ---------------------------------------------------------------- denied read
test("denied truck read fails closed (query-failure category)", async () => {
  const s = healthyStore();
  await assert.rejects(run(s, { opts: { throwOn: ({ collection, kind }) => collection === "trucks" && kind === "get" } }), /verification FAILED/);
});

// ---------------------------------------------------------------- cross-record consistency
test("version not equal to applied audit count fails closed", async () => {
  const s = healthyStore(); s.trucks["1"].version = 2; // only 3 applied -> mismatch
  await assert.rejects(run(s), /verification FAILED/);
});

test("creation not preceding containment fails closed", async () => {
  const s = healthyStore();
  s.auditEvents.find((e) => e.data.action === "createTruck").data.at = ts(9999); // after containment
  await assert.rejects(run(s), /verification FAILED/);
});

test("unextractable audit timestamp fails ordering closed", async () => {
  const s = healthyStore();
  s.auditEvents.find((e) => e.data.action === "createTruck").data.at = { bogus: true };
  await assert.rejects(run(s), /verification FAILED/);
});

// ---------------------------------------------------------------- no-write guarantee
test("read surface exposing a non-read method is rejected", async () => {
  assert.throws(() => core.assertReadOnlySurface({ getDoc() {}, queryByField() {}, set() {} }), /non-read method/);
  assert.throws(() => core.assertReadOnlySurface({ getDoc() {} }), /missing queryByField/);
});

test("buildReadOnlyDeps reaches ONLY .get() — no write API invoked", async () => {
  const store = healthyStore();
  const spy = { gets: 0, writes: 0 };
  const docApi = (c, id) => ({
    async get() { spy.gets += 1; const d = (store[c] || {})[id]; return { exists: d !== undefined, id, data: () => d }; },
    set() { spy.writes += 1; throw new Error("write"); }, create() { spy.writes += 1; throw new Error("write"); },
    update() { spy.writes += 1; throw new Error("write"); }, delete() { spy.writes += 1; throw new Error("write"); },
  });
  const queryApi = (c) => {
    const q = { _f: null, _v: null, _l: 0,
      where(f, _op, v) { q._f = f; q._v = v; return q; }, limit(n) { q._l = n; return q; },
      async get() { spy.gets += 1; const coll = store[c] || {}; return { docs: Object.entries(coll).filter(([, d]) => d[q._f] === q._v).slice(0, q._l).map(([id, d]) => ({ id, data: () => d })) }; } };
    return q;
  };
  const admin = { apps: [{}], firestore: () => ({ collection: (c) => ({ doc: (id) => docApi(c, id), where: (f, op, v) => queryApi(c).where(f, op, v) }) }) };
  const { reads } = cli.buildReadOnlyDeps(goodConfig(), { evidenceDir: "/e", prefix: "p", env: { getAdmin: () => admin } });
  assert.deepEqual(Object.keys(reads).sort(), ["getDoc", "queryByField"]);
  const t = await reads.getDoc("trucks", "1");
  assert.equal(t.id, "1");
  const q = await reads.queryByField("trucks", "locationId", "MLOC-1", 5);
  assert.equal(q.length, 1);
  assert.equal(spy.writes, 0, "no write API may be invoked");
  assert.ok(spy.gets >= 2);
});

// ---------------------------------------------------------------- sanitizer
test("sanitizer rejects secret-like evidence content", () => {
  assert.throws(() => assertEvidenceSecretFree({ note: "password=hunter2" }), /secret or identity/);
  assert.throws(() => assertEvidenceSecretFree({ contact: "a@b.com email" }), /secret or identity/);
  assert.doesNotThrow(() => assertEvidenceSecretFree({ truckId: "1", version: 3, locationIdSha256: "a".repeat(64) }));
});

// ---------------------------------------------------------------- atomic evidence publication
function makeFakeFs(failOn) {
  const files = new Map();
  const dirs = new Set();
  const sep = "/";
  return {
    files, dirs,
    existsSync: (p) => dirs.has(p) || files.has(p),
    mkdirSync: (p) => { dirs.add(p); },
    rmSync: (p) => { for (const k of Array.from(files.keys())) if (k === p || k.startsWith(p + sep)) files.delete(k); dirs.delete(p); },
    writeFileSync: (p, c) => { if (failOn && String(p).endsWith(failOn)) throw new Error("ENOSPC"); files.set(p, c); },
    readFileSync: (p) => { if (!files.has(p)) throw new Error(`ENOENT ${p}`); return files.get(p); },
    renameSync: (a, b) => { for (const [k, v] of Array.from(files)) if (k === a || k.startsWith(a + sep)) { files.set(b + k.slice(a.length), v); files.delete(k); } dirs.delete(a); dirs.add(b); },
  };
}

test("atomic publish success writes report + SHA256SUMS and materializes only the final dir", () => {
  const fs = makeFakeFs(null);
  const dir = cli.publishEvidenceAtomic("/ev/verify-2026-08-02", { "verification-report.json": { verified: true, truckId: "1" } }, { fs, path: nodePath.posix, prefix: "p1" });
  assert.equal(dir, "/ev/verify-2026-08-02");
  assert.ok(fs.files.has("/ev/verify-2026-08-02/verification-report.json"));
  assert.ok(fs.files.has("/ev/verify-2026-08-02/SHA256SUMS.txt"));
  assert.ok(!Array.from(fs.dirs).some((d) => d.includes(".staging-")), "no staging dir remains");
});

test("atomic publish failure removes staging and leaves NO final dir", () => {
  const fs = makeFakeFs("SHA256SUMS.txt");
  assert.throws(() => cli.publishEvidenceAtomic("/ev/verify-2026-08-02", { "verification-report.json": { verified: true } }, { fs, path: nodePath.posix, prefix: "p2" }), /ENOSPC/);
  assert.ok(!fs.files.has("/ev/verify-2026-08-02/verification-report.json"), "final report must not exist");
  assert.ok(!Array.from(fs.dirs).some((d) => d.includes("verify-2026-08-02")), "no final or staging dir remains");
});

test("atomic publish refuses to overwrite an existing final dir", () => {
  const fs = makeFakeFs(null);
  fs.dirs.add("/ev/verify-2026-08-02");
  assert.throws(() => cli.publishEvidenceAtomic("/ev/verify-2026-08-02", { "verification-report.json": { verified: true } }, { fs, path: nodePath.posix, prefix: "p3" }), /refusing to overwrite/);
});

test("atomic publish sanitizes: secret content is rejected before rename", () => {
  const fs = makeFakeFs(null);
  assert.throws(() => cli.publishEvidenceAtomic("/ev/v", { "r.json": { email: "a@b.com" } }, { fs, path: nodePath.posix, prefix: "p4" }), /secret or identity/);
  assert.ok(!fs.files.has("/ev/v/r.json"));
});

// ---------------------------------------------------------------- CLI validation + guards
test("parseArgs requires the mandatory flags", () => {
  assert.throws(() => cli.parseArgs(["--config", "c.json"]), /missing required --evidence-dir/);
  assert.throws(() => cli.parseArgs(["--config"]), /--config requires a value/);
});

test("validateCliInputs enforces project confirmation + governed shapes", () => {
  const args = { "confirm-project": "taylor-parts", "verify-date": "2026-08-02" };
  assert.doesNotThrow(() => cli.validateCliInputs(goodConfig(), args));
  assert.throws(() => cli.validateCliInputs(goodConfig(), { ...args, "confirm-project": "other" }), /--confirm-project must be taylor-parts/);
  assert.throws(() => cli.validateCliInputs({ ...goodConfig(), projectId: "other" }, args), /must equal --confirm-project/);
  assert.throws(() => cli.validateCliInputs({ ...goodConfig(), governedCommit: "short" }, args), /40-character Git SHA/);
  assert.throws(() => cli.validateCliInputs(goodConfig(), { ...args, "verify-date": "bad" }), /YYYY-MM-DD/);
  const wrongDriver = goodConfig(); wrongDriver.expected.assignedDriverEmployeeId = "emp-1";
  assert.throws(() => cli.validateCliInputs(wrongDriver, args), /must be null/);
  const badStatus = goodConfig(); badStatus.expected.status = "PARKED";
  assert.throws(() => cli.validateCliInputs(badStatus, args), /status must be one of/);
});

test("assertNotEmulator rejects any emulator target", () => {
  for (const name of cli.EMULATOR_ENV_VARS) {
    assert.throws(() => cli.assertNotEmulator((n) => (n === name ? "127.0.0.1:8080" : undefined)), /emulator target/);
  }
  assert.doesNotThrow(() => cli.assertNotEmulator(() => undefined));
});

test("assertAdcOnly refuses a service-account key file", () => {
  assert.throws(() => cli.assertAdcOnly((n) => (n === "GOOGLE_APPLICATION_CREDENTIALS" ? "/k.json" : undefined), goodConfig()), /service-account key file/);
  assert.throws(() => cli.assertAdcOnly(() => undefined, { ...goodConfig(), keyFile: "/k.json" }), /service-account key file/);
  assert.doesNotThrow(() => cli.assertAdcOnly(() => undefined, goodConfig()));
});

test("resolveCheckout requires a clean tree and returns HEAD", () => {
  const head = cli.resolveCheckout({ git: (a) => (a[0] === "rev-parse" ? `${COMMIT}\n` : "") });
  assert.equal(head, COMMIT);
  assert.throws(() => cli.resolveCheckout({ git: (a) => (a[0] === "rev-parse" ? `${COMMIT}\n` : " M f.js\n") }), /working tree is not clean/);
});

test("governed pin rejects a checkout whose HEAD != governedCommit", () => {
  assert.throws(() => core.assertGovernedPins(goodConfig(), "taylor-parts", "b".repeat(40)), /must exactly equal config.governedCommit/);
  assert.throws(() => core.assertGovernedPins({ ...goodConfig(), projectId: "x" }, "x", COMMIT), /projectId must be exactly/);
});
