"use strict";

// EI Truck Registry — GATE D functions-verifier OFFLINE unit tests. Pure `node --test` with INJECTED
// FAKES only: NO network, NO production, NO emulator, NO gcloud/firebase/credentials. Covers the
// core (discovery, denial, governed success sequence, expected fail-closed deactivate, malformed /
// partial / contradictory results, cleanup-on-failure, cleanup failure, residual detection,
// sanitizer, pins) AND the CLI adapter logic (arg/config validation, checkout resolution, status
// mapping, discovery/callable/persona adapters via a fake env).
const { test } = require("node:test");
const assert = require("node:assert/strict");

const core = require("../scripts/verifyTruckFunctionsDeployment");
const cli = require("../scripts/truckFunctionsVerifierCli");
const matrix = require("../scripts/truckFunctionsVerificationMatrix");

const COMMIT = "a".repeat(40);
const goodConfig = () => ({ projectId: "taylor-parts", confirmProject: "taylor-parts", governedCommit: COMMIT });

// ---- in-memory store + fake deps ------------------------------------------------------------

function makeStore() {
  return { docs: new Map(), users: new Map(), tokenToUid: new Map() };
}

// A healthy fake dependency set; `opts` overrides pieces to inject failures.
function makeDeps(store, opts = {}) {
  const calls = { seed: 0, invokes: [], completed: false, retained: false };
  const manifest = [];
  const manifestStore = {
    file: "/recovery/x.jsonl",
    async append(e) { manifest.push(e); },
    async retain() { calls.retained = true; },
    async complete() { calls.completed = true; },
  };
  const discovery = {
    async listFunctions() {
      if (opts.discovery) return opts.discovery;
      return matrix.CALLABLES.map((name) => ({ name, region: "us-central1" }));
    },
  };
  const auth = {
    async provisionPersona(persona, prefix, record) {
      const uid = `${prefix}_uid_${persona}`;
      store.users.set(uid, { displayName: `${prefix}_${persona}`, email: `${prefix}.${persona}@x.invalid` });
      await record({ kind: "USER", ref: uid });
      store.docs.set(`users/${uid}`, { role: matrix.PERSONA_ROLE[persona] });
      await record({ kind: "DOC", ref: `users/${uid}` });
      const token = `tok_${persona}`;
      store.tokenToUid.set(token, uid);
      return { uid, token };
    },
  };
  let auditSeq = 0;
  const callable = {
    async invoke(req) {
      calls.invokes.push({ name: req.name, token: req.token });
      if (opts.invoke) { const forced = opts.invoke(req); if (forced) return forced; }
      // Unauthenticated: no token.
      if (req.token === null || req.token === undefined) return { ok: false, code: "unauthenticated" };
      // Unauthorized authenticated (technician): permission-denied + a standalone denied audit event.
      if (req.token === "tok_technician") {
        store.docs.set(`auditEvents/den_${auditSeq++}`, { actorUid: store.tokenToUid.get(req.token), outcome: "denied" });
        return { ok: false, code: "permission-denied" };
      }
      // Authorized admin: drive the success sequence.
      if (req.token === "tok_admin") {
        const uid = store.tokenToUid.get(req.token);
        if (req.name === "deactivateTruckCallable") return { ok: false, code: "failed-precondition" }; // fail-closed, no audit
        if (req.name === "createTruckCallable") {
          store.docs.set(`trucks/${req.data.truckId}`, { version: 1 });
          store.docs.set(`mobile_locations/${req.data.locationId}`, { version: 1 });
          store.docs.set(`location_truck_claims/${req.data.locationId}`, { version: 1 });
          store.docs.set(`auditEvents/ap_${auditSeq++}`, { actorUid: uid, outcome: "applied" });
          return { ok: true, data: { outcome: "applied", version: 1 } };
        }
        store.docs.set(`auditEvents/ap_${auditSeq++}`, { actorUid: uid, outcome: "applied" });
        return { ok: true, data: { outcome: "applied", version: req.data.expectedVersion + 1 } };
      }
      return { ok: false, code: "internal" };
    },
  };
  const admin = {
    async seedDoc(col, id, fields) { calls.seed += 1; store.docs.set(`${col}/${id}`, { ...fields }); },
    async docExists(path) { return store.docs.has(path); },
    async deleteDoc(path) { if (opts.deleteDocFails && opts.deleteDocFails(path)) throw Object.assign(new Error("x"), { code: "delete-failed" }); store.docs.delete(path); },
    async deleteUser(uid) { store.users.delete(uid); },
    async userExists(uid) { return store.users.has(uid); },
    async listUsersByPrefix(prefix) { return [...store.users].filter(([, u]) => (u.displayName || "").includes(prefix)).map(([uid]) => uid); },
    async listDocIdsByPrefix(col, prefix) { return [...store.docs.keys()].filter((k) => k.startsWith(`${col}/${prefix}`)).map((k) => k.slice(col.length + 1)); },
    async listAuditIdsByActor(uid) { return [...store.docs].filter(([k, v]) => k.startsWith("auditEvents/") && v.actorUid === uid).map(([k]) => k.slice("auditEvents/".length)); },
  };
  const written = {};
  const evidence = { async write(files) { if (opts.evidenceThrows) throw new Error("evidence"); Object.assign(written, files); } };
  return {
    deps: {
      config: goodConfig(), targetProject: "taylor-parts", targetCommit: COMMIT,
      discovery, auth, callable, admin, evidence, manifestStore,
      prefix: "trf_test_0123456789ab", verifyDate: "2026-08-02", log: () => {},
    },
    calls, manifest, written, store,
  };
}

async function runWith(opts = {}) {
  const store = makeStore();
  const h = makeDeps(store, opts);
  let result = null;
  let error = null;
  try { result = await core.runVerification(h.deps); } catch (e) { error = e; }
  return { result, error, ...h };
}

// ---- happy path -----------------------------------------------------------------------------

test("happy path: discovery + denial + governed sequence all pass; cleanup + zero residual; manifest completed", async () => {
  const { result, error, store, calls, written } = await runWith();
  assert.equal(error, null);
  assert.equal(result.matrixTotal, matrix.MATRIX_TOTAL);
  assert.equal(result.report.passed, matrix.MATRIX_TOTAL); // 8 + 16 + 8
  assert.equal(result.report.discovery.passed, 8);
  assert.equal(result.report.denial.passed, 16);
  assert.equal(result.report.sequence.passed, 8);
  assert.equal(result.cleanup.ok, true);
  assert.equal(result.residual.residualDocs, 0);
  assert.equal(result.residual.residualUsers, 0);
  assert.equal(calls.completed, true);
  assert.equal(calls.retained, false);
  // Every fixture/user/created doc was removed.
  assert.equal(store.docs.size, 0);
  assert.equal(store.users.size, 0);
  // Evidence is written ONLY after cleanup + residual pass, and carries the zero-residual lifecycle
  // fields (P2-1).
  const report = written["verification-report.json"];
  assert.ok(report);
  assert.equal(report.verified, true);
  assert.equal(report.cleanup_complete, true);
  assert.equal(report.residual_documents, 0);
  assert.equal(report.residual_auth_users, 0);
});

test("evidence is sanitized: no token/uid/email/prefix leaks into the report", async () => {
  const { written, deps } = await (async () => { const store = makeStore(); const h = makeDeps(store); await core.runVerification(h.deps); return { written: h.written, deps: h.deps }; })();
  const text = JSON.stringify(written["verification-report.json"]);
  assert.ok(!text.includes("tok_admin"));
  assert.ok(!text.includes(deps.prefix));
  assert.ok(!text.includes("uid_admin"));
  assert.ok(!/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(text)); // no real email (governed "applied@v1" is fine)
});

// ---- discovery ------------------------------------------------------------------------------

test("discovery: a missing callable fails closed before any fixture is seeded", async () => {
  const partial = matrix.CALLABLES.slice(1).map((name) => ({ name, region: "us-central1" }));
  const { result, error, calls } = await runWith({ discovery: partial });
  assert.equal(result, null);
  assert.match(error.message, /discovery mismatch createTruckCallable/);
  assert.equal(calls.seed, 0); // no fixtures created
});

test("discovery: a wrong-region callable fails closed", async () => {
  const wrong = matrix.CALLABLES.map((name, i) => ({ name, region: i === 3 ? "us-east1" : "us-central1" }));
  const { error } = await runWith({ discovery: wrong });
  assert.match(error.message, /discovery mismatch/);
});

test("discovery: a malformed (non-array) listing fails closed", async () => {
  const { error } = await runWith({ discovery: { not: "an array" } });
  assert.match(error.message, /non-array/);
});

// ---- denial ---------------------------------------------------------------------------------

test("denial: an unexpected authenticated success fails closed", async () => {
  const { error } = await runWith({ invoke: (req) => (req.token === "tok_technician" && req.name === "createTruckCallable" ? { ok: true, data: { outcome: "applied", version: 1 } } : null) });
  assert.match(error.message, /Denial mismatch .*UNEXPECTED_SUCCESS/);
});

test("denial: a wrong denial code fails closed", async () => {
  const { error } = await runWith({ invoke: (req) => (req.token === null && req.name === "unassignTruckDriverCallable" ? { ok: false, code: "internal" } : null) });
  assert.match(error.message, /Denial mismatch .*WRONG_CODE/);
});

// ---- success sequence + fail-closed deactivate ---------------------------------------------

test("sequence: a wrong applied version fails closed", async () => {
  const { error } = await runWith({ invoke: (req) => (req.token === "tok_admin" && req.name === "changeTruckStatusCallable" ? { ok: true, data: { outcome: "applied", version: 99 } } : null) });
  assert.match(error.message, /Sequence mismatch status/);
});

test("deactivate: an unexpected SUCCESS fails closed (must stay fail-closed)", async () => {
  const { error } = await runWith({ invoke: (req) => (req.name === "deactivateTruckCallable" && req.token === "tok_admin" ? { ok: true, data: { outcome: "applied", version: 7 } } : null) });
  assert.match(error.message, /Sequence mismatch deactivate/);
});

test("deactivate: the WRONG failure code fails closed (only failed-precondition is expected)", async () => {
  const { error } = await runWith({ invoke: (req) => (req.name === "deactivateTruckCallable" && req.token === "tok_admin" ? { ok: false, code: "permission-denied" } : null) });
  assert.match(error.message, /Sequence mismatch deactivate/);
});

// ---- malformed / contradictory --------------------------------------------------------------

test("malformed result (missing ok) fails closed", () => {
  assert.throws(() => core.normalizeInvokeResult({ data: {} }), /missing ok boolean/);
});
test("contradictory result (ok:true with a code) fails closed", () => {
  assert.throws(() => core.normalizeInvokeResult({ ok: true, code: "x", data: {} }), /contradictory/);
});
test("contradictory result (ok:false with data) fails closed", () => {
  assert.throws(() => core.normalizeInvokeResult({ ok: false, code: "x", data: {} }), /contradictory/);
});

// ---- lifecycle: partial execution, cleanup-on-failure, cleanup failure, residual ------------

test("partial execution: a mid-sequence failure cleans up, preserves the primary error, and writes NO verified evidence", async () => {
  // Force the reassign step (v3) to fail; earlier create already wrote docs.
  const { error, result, store, calls, written } = await runWith({ invoke: (req) => (req.name === "reassignTruckDriverCallable" && req.token === "tok_admin" ? { ok: false, code: "internal" } : null) });
  assert.equal(result, null);
  assert.match(error.message, /Sequence mismatch reassign/);
  assert.equal(store.docs.size, 0);
  assert.equal(store.users.size, 0);
  assert.equal(calls.completed, true); // fixtures gone -> manifest completed even though the primary error is rethrown
  assert.equal(written["verification-report.json"], undefined); // matrix failure -> no verified:true report (P2-1)
});

test("P2-1: a cleanup failure writes NO successful evidence and retains recovery", async () => {
  const { error, calls, written } = await runWith({ deleteDocFails: (path) => path.startsWith("trucks/") });
  assert.ok(error);
  assert.equal(calls.retained, true);
  assert.equal(calls.completed, false);
  assert.equal(written["verification-report.json"], undefined); // no verified report despite a passing matrix
});

test("P2-1: nonzero residual writes NO successful evidence", async () => {
  const store = makeStore();
  const h = makeDeps(store);
  const realDelete = h.deps.admin.deleteDoc;
  h.deps.admin.deleteDoc = async (path) => { if (path.endsWith("_wh1")) return; await realDelete(path); }; // wh1 survives
  let error = null;
  try { await core.runVerification(h.deps); } catch (e) { error = e; }
  assert.ok(error);
  assert.ok(error.lifecycleFailure.residualDocs >= 1);
  assert.equal(h.written["verification-report.json"], undefined);
  assert.equal(h.calls.completed, false);
});

test("P2-1: an evidence-write failure keeps the run FAILED without concealing the (successful) lifecycle", async () => {
  const { error, store, calls, written } = await runWith({ evidenceThrows: true });
  assert.ok(error); // the run fails at evidence finalization
  assert.equal(written["verification-report.json"], undefined); // no verified report persisted
  assert.equal(store.docs.size, 0); // cleanup still ran (lifecycle not concealed)
  assert.equal(store.users.size, 0);
  assert.equal(calls.completed, true); // cleanup+residual succeeded -> manifest reflects that true state
});

test("cleanup failure: a delete error surfaces a lifecycle failure and retains recovery", async () => {
  const { error, calls } = await runWith({ deleteDocFails: (path) => path.startsWith("trucks/") });
  assert.ok(error);
  assert.equal(calls.retained, true);
  assert.equal(calls.completed, false);
  assert.ok(error.lifecycleFailure);
});

test("residual detection: a surviving doc fails the run", async () => {
  // deleteDoc silently no-ops for the seeded wh1 fixture so it survives cleanup -> residual > 0.
  const store = makeStore();
  const h = makeDeps(store);
  const realDelete = h.deps.admin.deleteDoc;
  h.deps.admin.deleteDoc = async (path) => { if (path.endsWith("_wh1")) return; await realDelete(path); };
  let error = null;
  try { await core.runVerification(h.deps); } catch (e) { error = e; }
  assert.ok(error);
  assert.equal(h.calls.retained, true);
  assert.ok(error.lifecycleFailure.residualDocs >= 1);
});

// ---- pins -----------------------------------------------------------------------------------

test("pins: wrong project / wrong commit / mismatched confirmProject fail closed", () => {
  assert.throws(() => core.assertGovernedPins({ projectId: "other", confirmProject: "other", governedCommit: COMMIT }, "other", COMMIT), /projectId must be/);
  assert.throws(() => core.assertGovernedPins(goodConfig(), "taylor-parts", "b".repeat(40)), /clean exact-head/);
  assert.throws(() => core.assertGovernedPins({ projectId: "taylor-parts", confirmProject: "x", governedCommit: COMMIT }, "taylor-parts", COMMIT), /confirmProject/);
  assert.throws(() => core.assertGovernedPins({ projectId: "taylor-parts", confirmProject: "taylor-parts", governedCommit: "short" }, "taylor-parts", "short"), /40-hex/);
});

// ---- sanitizer ------------------------------------------------------------------------------

test("assertRunSecretFree rejects tokens, emails and run secrets; allows governed labels", () => {
  assert.throws(() => core.assertRunSecretFree({ x: `eyJ${"a".repeat(12)}.${"b".repeat(12)}` }), /sensitive-value shape/);
  assert.throws(() => core.assertRunSecretFree({ x: "a@b.com" }), /sensitive-value shape/);
  assert.throws(() => core.assertRunSecretFree({ x: "trf_test_0123456789ab" }, ["trf_test_0123456789ab"]), /run-specific/);
  assert.doesNotThrow(() => core.assertRunSecretFree({ label: "discovery:createTruckCallable", pass: true }));
});

// ---- CLI adapter logic ----------------------------------------------------------------------

test("CLI parseArgs requires all confirmation flags", () => {
  assert.throws(() => cli.parseArgs(["--config", "c"]), /missing required/);
  const a = cli.parseArgs(["--config", "c", "--evidence-dir", "e", "--recovery-dir", "r", "--verify-date", "2026-08-02", "--confirm-project", "taylor-parts"]);
  assert.equal(a["confirm-project"], "taylor-parts");
});

test("CLI validateCliInputs enforces project pins, governed commit and the web-api-key env", () => {
  const args = { "confirm-project": "taylor-parts", "verify-date": "2026-08-02" };
  const base = { projectId: "taylor-parts", confirmProject: "taylor-parts", governedCommit: COMMIT, webApiKeyEnv: "WEB_API_KEY" };
  assert.doesNotThrow(() => cli.validateCliInputs({ ...base }, args));
  assert.throws(() => cli.validateCliInputs({ ...base, projectId: "other" }, args), /projectId must be/);
  assert.throws(() => cli.validateCliInputs({ ...base, governedCommit: "nope" }, args), /40-hex/);
  assert.throws(() => cli.validateCliInputs({ ...base, webApiKeyEnv: "" }, args), /webApiKeyEnv/);
  assert.throws(() => cli.validateCliInputs({ ...base }, { ...args, "verify-date": "nope" }), /verify-date/);
});

test("CLI resolveCheckout reports commit + cleanliness via injected git", () => {
  const clean = cli.resolveCheckout({ git: (a) => (a[0] === "rev-parse" ? `${COMMIT}\n` : "\n") });
  assert.deepEqual(clean, { commit: COMMIT, clean: true });
  const dirty = cli.resolveCheckout({ git: (a) => (a[0] === "rev-parse" ? `${COMMIT}\n` : " M file\n") });
  assert.equal(dirty.clean, false);
});

test("CLI statusToCode maps canonical statuses to sanitized suffixes", () => {
  assert.equal(cli.statusToCode("UNAUTHENTICATED"), "unauthenticated");
  assert.equal(cli.statusToCode("PERMISSION_DENIED"), "permission-denied");
  assert.equal(cli.statusToCode("FAILED_PRECONDITION"), "failed-precondition");
  assert.equal(cli.statusToCode(null), "internal");
});

test("CLI buildProductionDeps constructs adapters with NO production I/O; callable.invoke maps + hides the token", async () => {
  const fetchCalls = [];
  const env = {
    doFetch: async (url, init) => {
      fetchCalls.push({ url, init });
      if (String(url).includes("createTruckCallable")) return { status: 200, async json() { return { result: { outcome: "applied", version: 1 } }; } };
      return { status: 403, async json() { return { error: { status: "PERMISSION_DENIED" } }; } };
    },
    gcloudJson: () => matrix.CALLABLES.map((name) => ({ name: `projects/taylor-parts/locations/us-central1/functions/${name}` })),
  };
  const deps = cli.buildProductionDeps({ projectId: "taylor-parts", webApiKeyEnv: "WEB_API_KEY", personas: [] }, { prefix: "trf_gated_00", evidenceDir: "/e", env });
  const fns = await deps.discovery.listFunctions();
  assert.equal(fns.length, 8);
  assert.equal(fns[0].region, "us-central1");
  const ok = await deps.callable.invoke({ name: "createTruckCallable", token: "SECRET_TOKEN", data: {} });
  assert.deepEqual(ok, { ok: true, data: { outcome: "applied", version: 1 } });
  const denied = await deps.callable.invoke({ name: "assignTruckDriverCallable", token: null, data: {} });
  assert.deepEqual(denied, { ok: false, code: "permission-denied" });
  // The token is sent as an Authorization header but never returned in the mapped result.
  assert.ok(!JSON.stringify(ok).includes("SECRET_TOKEN"));
});

// ---- P2-2: provisionPersona records the uid-keyed role DOC BEFORE writing it -----------------

function provisionEnv(opts = {}) {
  const order = [];
  const fakeAdmin = {
    auth: () => ({ createUser: async () => { order.push("createUser"); return { uid: "UID1" }; } }),
    firestore: () => ({ collection: () => ({ doc: () => ({ set: async () => { order.push("set"); if (opts.failSet) throw new Error("set-failed"); } }) }) }),
  };
  const env = {
    getAdmin: () => fakeAdmin,
    doFetch: async () => ({ async json() { return { idToken: "tok" }; } }),
    readEnv: () => "APIKEY",
    crypto: { randomBytes: () => ({ toString: () => "pw" }) },
  };
  const deps = cli.buildProductionDeps({ projectId: "taylor-parts", webApiKeyEnv: "WEB" }, { prefix: "trf_gated_ab", evidenceDir: "/e", env });
  return { deps, order };
}

test("P2-2: the uid-keyed role DOC is recorded BEFORE the Firestore write", async () => {
  const { deps, order } = provisionEnv();
  const recorded = [];
  const record = async (e) => { recorded.push(e); };
  const res = await deps.auth.provisionPersona("admin", "trf_gated_ab", record);
  assert.deepEqual(res, { uid: "UID1", token: "tok" });
  // record order: USER then DOC users/UID1; and the DOC record precedes the set() write.
  assert.deepEqual(recorded.map((e) => `${e.kind}:${e.ref}`), ["USER:UID1", "DOC:users/UID1"]);
  assert.ok(order.indexOf("set") > order.indexOf("createUser"));
});

test("P2-2: a role-doc write failure cannot orphan the uid-keyed doc (already recorded for cleanup)", async () => {
  const { deps } = provisionEnv({ failSet: true });
  const recorded = [];
  const record = async (e) => { recorded.push(e); };
  await assert.rejects(deps.auth.provisionPersona("admin", "trf_gated_ab", record), /set-failed/);
  // Even though the write failed, the cleanup entry for users/UID1 was already durably recorded.
  assert.ok(recorded.some((e) => e.kind === "DOC" && e.ref === "users/UID1"));
});

test("P2-2: a manifest-append failure at the DOC boundary prevents the role-doc write (no orphan)", async () => {
  const { deps, order } = provisionEnv();
  const record = async (e) => { if (e.kind === "DOC") throw new Error("append-failed"); };
  await assert.rejects(deps.auth.provisionPersona("admin", "trf_gated_ab", record), /append-failed/);
  assert.ok(!order.includes("set")); // the role doc was never written -> nothing to orphan
});
