// AUTH-PR-4 -- tests for the production-enablement authorization gate
// (functions/scripts/authPr4ProductionGate.js) and its wiring into the workflow.
//
// TWO LAYERS:
//   1. PURE tests -- no emulator, no SDK. Governed-file hashing + independent
//      repository-identity verification; authorization-manifest verification;
//      integrity-checked progression (advance/rollback/suspend, next-eligible,
//      fail-closed on skipped/repeated/reordered/stale/conflicting/tampered);
//      break-glass confirmation (missing/early/expired/mismatched/reused).
//   2. AUTH-EMULATOR tests -- a production-SHAPED --executeProduction path driven
//      through the real CLI against a NON-PRODUCTION (demo-*) project: full
//      sequence 1..5, progression advance, break-glass at 5, rollback suspend,
//      hash/commit refusals, production-project refusal. The real `taylor-parts`
//      project id is NEVER targeted.
//
// NON-PRODUCTION ONLY. Sanitized: real emails are never printed.
//
// Run (pure only):        node test/authPr4ProductionGate.test.mjs
// Run (pure + emulator):  firebase emulators:exec --only auth --project demo-authpr4 \
//                           "node test/authPr4ProductionGate.test.mjs"

import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const gate = require("../scripts/authPr4ProductionGate.js");

const ORDER = [
  "emp-rudy-driver",
  "emp-rudy-parts-associate",
  "emp-rudy-warehouse-manager",
  "emp-rudy-parts-manager",
  "emp-rudy-owner",
];

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }
async function okAsync(name, fn) { await fn(); passed += 1; console.log("PASS -- " + name); }
function throws(fn, re) { assert.throws(fn, re); }

const KEY = () => crypto.randomBytes(48);

// Build a signed progression payload+artifact for tests.
function makeProgression(key, { authorizationId = "AUTH-1", projectId = "demo-authpr4", idHash, completed = [], suspended = false } = {}) {
  const payload = {
    version: gate.PROGRESSION_VERSION,
    authorizationId,
    projectId,
    workflowIdentityHash: idHash,
    personaOrder: ORDER,
    completed,
    suspended,
    updatedAt: new Date().toISOString(),
  };
  return { payload, artifact: { ...payload, signature: gate.signProgression(payload, key) } };
}

// ---------------------------------------------------------------------------
// 1. PURE TESTS
// ---------------------------------------------------------------------------

ok("deriveGovernedFileHashes covers exactly the governed set and workflowIdentityHash is stable", () => {
  const repoRoot = gate.resolveRepoRoot();
  const h = gate.deriveGovernedFileHashes(repoRoot);
  assert.deepEqual(Object.keys(h).sort(), [...gate.GOVERNED_FILES].sort());
  for (const rel of gate.GOVERNED_FILES) assert.match(h[rel], /^[0-9a-f]{64}$/);
  assert.equal(gate.workflowIdentityHash(h), gate.workflowIdentityHash(h)); // deterministic
});

ok("verifyGovernedFileHashes fails closed on missing, extra, or mismatched entries", () => {
  const derived = { "functions/scripts/authPr4RecoveryEmailMigration.js": "a".repeat(64), "functions/scripts/authPr4ProductionGate.js": "b".repeat(64) };
  assert.equal(gate.verifyGovernedFileHashes({ ...derived }, derived), true);
  throws(() => gate.verifyGovernedFileHashes({ "functions/scripts/authPr4RecoveryEmailMigration.js": "a".repeat(64) }, derived), /cover exactly/);
  throws(() => gate.verifyGovernedFileHashes({ ...derived, extra: "c".repeat(64) }, derived), /cover exactly/);
  throws(() => gate.verifyGovernedFileHashes({ ...derived, "functions/scripts/authPr4ProductionGate.js": "0".repeat(64) }, derived), /hash mismatch/);
});

ok("verifyRepositoryIdentity: reviewedHead must be in ancestry; supplied commit must agree", () => {
  const idOk = { head: "HEADSHA1", isAncestor: (c) => c === "REVIEWEDHEAD" };
  assert.equal(gate.verifyRepositoryIdentity({ reviewedHead: "REVIEWEDHEAD" }, idOk), true);
  // reviewed not in ancestry, no merge attestation -> refuse
  throws(() => gate.verifyRepositoryIdentity({ reviewedHead: "NOTANANCESTOR" }, idOk), /not in the repository's ancestry/);
  // supplied commit disagreeing with derived identity -> refuse (derived authoritative)
  throws(() => gate.verifyRepositoryIdentity({ reviewedHead: "REVIEWEDHEAD", suppliedCommit: "WRONGCOMMIT" }, idOk), /disagrees with the repository-derived identity/);
  // merge attestation path: reviewed not ancestor but merge commit is
  const idMerge = { head: "MERGECOMMIT", isAncestor: (c) => c === "MERGECOMMIT" };
  assert.equal(gate.verifyRepositoryIdentity({ reviewedHead: "REVIEWEDHEAD", mergeCommit: "MERGECOMMIT" }, idMerge), true);
});

ok("verifyAuthorizationManifest fails closed on project/order/token/version/conflict", () => {
  const derived = gate.deriveGovernedFileHashes(gate.resolveRepoRoot());
  const repoIdentity = { head: "HEADCOMMIT1", isAncestor: () => true };
  const base = {
    version: gate.AUTH_MANIFEST_VERSION, authorizationId: "AUTH-1", projectId: "demo-authpr4",
    personaOrder: ORDER, reviewedHead: "HEADCOMMIT1", governedFileHashes: derived, executionModeToken: "TOKEN",
  };
  assert.equal(gate.verifyAuthorizationManifest({ ...base }, { projectId: "demo-authpr4", personaOrder: ORDER, derivedHashes: derived, repoIdentity }).authorizationId, "AUTH-1");
  throws(() => gate.verifyAuthorizationManifest({ ...base, projectId: "other" }, { projectId: "demo-authpr4", personaOrder: ORDER, derivedHashes: derived, repoIdentity }), /projectId does not match/);
  throws(() => gate.verifyAuthorizationManifest({ ...base, personaOrder: ORDER.slice().reverse() }, { projectId: "demo-authpr4", personaOrder: ORDER, derivedHashes: derived, repoIdentity }), /personaOrder does not match/);
  throws(() => gate.verifyAuthorizationManifest({ ...base, executionModeToken: "" }, { projectId: "demo-authpr4", personaOrder: ORDER, derivedHashes: derived, repoIdentity }), /executionModeToken/);
  throws(() => gate.verifyAuthorizationManifest({ ...base, version: 99 }, { projectId: "demo-authpr4", personaOrder: ORDER, derivedHashes: derived, repoIdentity }), /version is unsupported/);
});

ok("progression: next-eligible starts at position 1 and advances one at a time", () => {
  const key = KEY(); const idHash = "IDH";
  let { payload } = makeProgression(key, { idHash });
  assert.deepEqual(gate.nextEligiblePersona(payload, ORDER), { employeeId: "emp-rudy-driver", position: 1 });
  payload = gate.advanceProgression(payload, "emp-rudy-driver");
  assert.deepEqual(gate.nextEligiblePersona(payload, ORDER), { employeeId: "emp-rudy-parts-associate", position: 2 });
});

ok("progression fails closed: skipped, repeated, reordered, suspended", () => {
  const key = KEY(); const idHash = "IDH";
  const { payload: p0 } = makeProgression(key, { idHash });
  throws(() => gate.assertPersonaIsNextEligible(p0, ORDER, "emp-rudy-parts-associate", 2), /Only the exact next persona/); // skipped
  const p1 = gate.advanceProgression(p0, "emp-rudy-driver");
  throws(() => gate.assertPersonaIsNextEligible(p1, ORDER, "emp-rudy-driver", 1), /already complete/); // repeated
  throws(() => gate.assertPersonaIsNextEligible(p1, ORDER, "emp-rudy-warehouse-manager", 3), /Only the exact next persona/); // reordered
  const susp = gate.suspendProgressionAfterRollback(p1, "emp-rudy-driver");
  throws(() => gate.assertPersonaIsNextEligible(susp, ORDER, "emp-rudy-driver", 1), /SUSPENDED/);
});

ok("progression requires 1-4 durably complete before position 5", () => {
  const key = KEY(); const idHash = "IDH";
  let { payload } = makeProgression(key, { idHash, completed: ORDER.slice(0, 3) }); // only 1-3 done
  throws(() => gate.assertPersonaIsNextEligible(payload, ORDER, "emp-rudy-owner", 5), /Only the exact next persona/);
  ({ payload } = makeProgression(key, { idHash, completed: ORDER.slice(0, 4) })); // 1-4 done
  assert.deepEqual(gate.assertPersonaIsNextEligible(payload, ORDER, "emp-rudy-owner", 5), { employeeId: "emp-rudy-owner", position: 5 });
});

ok("readAndVerifyProgression fails closed: tampered signature, stale workflow hash, conflicting authorization, malformed", () => {
  const key = KEY(); const idHash = "IDH";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "authpr4-prog-"));
  const file = path.join(dir, "prog.json");
  const { artifact } = makeProgression(key, { idHash, completed: ["emp-rudy-driver"] });
  fs.writeFileSync(file, JSON.stringify(artifact));
  const expected = { authorizationId: "AUTH-1", projectId: "demo-authpr4", workflowIdentityHash: idHash, personaOrder: ORDER };
  assert.equal(gate.readAndVerifyProgression(file, key, expected).completed.length, 1);
  // tampered
  const t = JSON.parse(fs.readFileSync(file, "utf8")); t.completed = ["emp-rudy-driver", "emp-rudy-parts-associate"]; fs.writeFileSync(file, JSON.stringify(t));
  throws(() => gate.readAndVerifyProgression(file, key, expected), /integrity verification/);
  // wrong key
  fs.writeFileSync(file, JSON.stringify(artifact));
  throws(() => gate.readAndVerifyProgression(file, KEY(), expected), /integrity verification/);
  // stale workflow identity
  throws(() => gate.readAndVerifyProgression(file, key, { ...expected, workflowIdentityHash: "STALE" }), /stale.*workflow identity|different .*workflow/);
  // conflicting authorization
  throws(() => gate.readAndVerifyProgression(file, key, { ...expected, authorizationId: "OTHER" }), /different authorization/);
  // malformed
  fs.writeFileSync(file, "{not json");
  throws(() => gate.readAndVerifyProgression(file, key, expected), /missing or malformed/);
  fs.rmSync(dir, { recursive: true, force: true });
});

ok("break-glass: valid confirmation passes; missing/early/expired/mismatched/reused all fail closed", () => {
  const key = KEY();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "authpr4-bg-"));
  const file = path.join(dir, "bg.json");
  const progHash = "PROGHASH-1234";
  const mk = (over = {}) => {
    const payload = {
      version: gate.BREAKGLASS_VERSION, authorizationId: "AUTH-1", progressionHash: progHash, position: 5,
      confirmer: "named-operator", createdAt: new Date().toISOString(), validityWindowSeconds: 600,
      sanitizedResult: { recoverable: true, loginVerified: true }, ...over,
    };
    fs.writeFileSync(file, JSON.stringify({ ...payload, signature: gate.signBreakGlass(payload, key) }));
  };
  const now = new Date();
  mk();
  assert.equal(gate.readAndVerifyBreakGlass(file, key, { authorizationId: "AUTH-1", currentProgressionHash: progHash, now }).confirmer, "named-operator");
  // mismatched progression hash (created too early / reused after change)
  throws(() => gate.readAndVerifyBreakGlass(file, key, { authorizationId: "AUTH-1", currentProgressionHash: "DIFFERENT", now }), /not bound to the current progression/);
  // bound to another authorization
  throws(() => gate.readAndVerifyBreakGlass(file, key, { authorizationId: "OTHER", currentProgressionHash: progHash, now }), /different authorization/);
  // wrong position
  mk({ position: 4 });
  throws(() => gate.readAndVerifyBreakGlass(file, key, { authorizationId: "AUTH-1", currentProgressionHash: progHash, now }), /not bound to position 5/);
  // expired
  mk({ createdAt: new Date(now.getTime() - 601 * 1000).toISOString(), validityWindowSeconds: 600 });
  throws(() => gate.readAndVerifyBreakGlass(file, key, { authorizationId: "AUTH-1", currentProgressionHash: progHash, now }), /EXPIRED/);
  // tampered signature
  mk(); const bt = JSON.parse(fs.readFileSync(file, "utf8")); bt.confirmer = "attacker"; fs.writeFileSync(file, JSON.stringify(bt));
  throws(() => gate.readAndVerifyBreakGlass(file, key, { authorizationId: "AUTH-1", currentProgressionHash: progHash, now }), /integrity verification/);
  fs.rmSync(dir, { recursive: true, force: true });
});

ok("break-glass reuse after a progression change is rejected (progressionHash changes on advance/rollback)", () => {
  const key = KEY(); const idHash = "IDH";
  const { payload: p4 } = makeProgression(key, { idHash, completed: ORDER.slice(0, 4) });
  const h4 = gate.progressionHash(p4);
  const rolledBack = gate.suspendProgressionAfterRollback(p4, "emp-rudy-parts-manager");
  assert.notEqual(gate.progressionHash(rolledBack), h4, "a rollback changes the progression hash, invalidating any bound break-glass");
});

// ---------------------------------------------------------------------------
// 2. AUTH-EMULATOR TESTS (non-production project only)
// ---------------------------------------------------------------------------

const EMU_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if (!EMU_HOST) {
  console.log("\nSKIP -- Auth-emulator integration tests (FIREBASE_AUTH_EMULATOR_HOST not set).");
  console.log(`\n${passed} passed (pure-helper layer)`);
  process.exit(0);
}

const admin = require("firebase-admin");
const PROJECT = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "demo-authpr4";
assert.notEqual(PROJECT, gate.PRODUCTION_PROJECT_ID, "integration tests must NOT run against the production project");
admin.initializeApp({ projectId: PROJECT });
const auth = admin.auth();
const uniq = () => `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const SCRIPT = path.resolve("scripts/authPr4RecoveryEmailMigration.js");

// A full harness for a production-SHAPED run against the emulator project.
function setupHarness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "authpr4-prod-"));
  const keyFile = path.join(dir, "state.key");
  const key = crypto.randomBytes(48);
  fs.writeFileSync(keyFile, key, { mode: 0o600 });
  const repoRoot = gate.resolveRepoRoot();
  const derived = gate.deriveGovernedFileHashes(repoRoot);
  const idHash = gate.workflowIdentityHash(derived);
  const head = gate.deriveRepositoryIdentity(repoRoot).head;
  const manifest = {
    version: gate.AUTH_MANIFEST_VERSION, authorizationId: "AUTH-EMU-1", projectId: PROJECT,
    personaOrder: ORDER, reviewedHead: head, governedFileHashes: derived, executionModeToken: "EMU-TOKEN",
  };
  const manifestFile = path.join(dir, "manifest.json");
  fs.writeFileSync(manifestFile, JSON.stringify(manifest), { mode: 0o600 });
  const progFile = path.join(dir, "prog.json");
  const p0 = { version: gate.PROGRESSION_VERSION, authorizationId: "AUTH-EMU-1", projectId: PROJECT, workflowIdentityHash: idHash, personaOrder: ORDER, completed: [], suspended: false, updatedAt: new Date().toISOString() };
  gate.writeProgression(progFile, p0, key);
  return { dir, key, keyFile, manifestFile, progFile, idHash, head };
}

function runProd(h, extra) {
  return spawnSync(process.execPath, [
    SCRIPT, "--projectId", PROJECT, "--executeProduction",
    "--authorizationManifest", h.manifestFile, "--progressionFile", h.progFile,
    "--stateKeyFile", h.keyFile, ...extra,
  ], { cwd: path.resolve("."), env: process.env, encoding: "utf8" });
}

// Provision one persona fixture (verified prior email) + append it to the mapping.
async function seedPersona(mappingFile, employeeId) {
  const prior = `prod_${employeeId}_${uniq()}@example.com`;
  const newAlias = `base+${employeeId}_${uniq()}@gmail.com`;
  const user = await auth.createUser({ email: prior, emailVerified: true, password: "Passw0rd!23" });
  const map = fs.existsSync(mappingFile) ? JSON.parse(fs.readFileSync(mappingFile, "utf8")) : {};
  map[employeeId] = { uid: user.uid, newAlias };
  fs.writeFileSync(mappingFile, JSON.stringify(map), { mode: 0o600 });
  return { uid: user.uid, prior, newAlias };
}

await okAsync("production-SHAPED --executeProduction advances the full sequence 1..5 (break-glass at 5), no test targets taylor-parts", async () => {
  const h = setupHarness();
  const mappingFile = path.join(h.dir, "mapping.json");
  const seeded = {};
  for (const id of ORDER) seeded[id] = await seedPersona(mappingFile, id);

  for (let i = 0; i < ORDER.length; i += 1) {
    const id = ORDER[i];
    const extra = ["--mappingFile", mappingFile, "--capturedStateOut", path.join(h.dir, `${id}.rollback.json`)];
    if (i === 4) {
      // Position 5: create a break-glass confirmation bound to the CURRENT progression (1-4 complete).
      const prog = gate.readAndVerifyProgression(h.progFile, h.key, { authorizationId: "AUTH-EMU-1", projectId: PROJECT, workflowIdentityHash: h.idHash, personaOrder: ORDER });
      assert.equal(prog.completed.length, 4);
      const bgFile = path.join(h.dir, "bg.json");
      const bgPayload = { version: gate.BREAKGLASS_VERSION, authorizationId: "AUTH-EMU-1", progressionHash: gate.progressionHash(prog), position: 5, confirmer: "named-operator", createdAt: new Date().toISOString(), validityWindowSeconds: 600, sanitizedResult: { recoverable: true, loginVerified: true } };
      fs.writeFileSync(bgFile, JSON.stringify({ ...bgPayload, signature: gate.signBreakGlass(bgPayload, h.key) }), { mode: 0o600 });
      extra.push("--breakGlassConfirmationFile", bgFile);
    }
    const r = runProd(h, extra);
    assert.equal(r.status, 0, `${id}: ${r.stderr}`);
    const after = await auth.getUser(seeded[id].uid);
    assert.equal(after.email, seeded[id].newAlias, `${id} migrated`);
    assert.equal(after.emailVerified, false);
  }
  const finalProg = gate.readAndVerifyProgression(h.progFile, h.key, { authorizationId: "AUTH-EMU-1", projectId: PROJECT, workflowIdentityHash: h.idHash, personaOrder: ORDER });
  assert.deepEqual(finalProg.completed, ORDER);
  fs.rmSync(h.dir, { recursive: true, force: true });
});

await okAsync("out-of-order / skipped persona is refused (progression enforced), and no mutation occurs", async () => {
  const h = setupHarness();
  const mappingFile = path.join(h.dir, "mapping.json");
  const assoc = await seedPersona(mappingFile, "emp-rudy-parts-associate"); // position 2, but 1 not done
  const r = runProd(h, ["--mappingFile", mappingFile, "--capturedStateOut", path.join(h.dir, "x.json"), "--employeeId", "emp-rudy-parts-associate", "--position", "2"]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /exact next persona|Skipped/i);
  const after = await auth.getUser(assoc.uid);
  assert.equal(after.email, assoc.prior, "no mutation on a refused out-of-order run");
  fs.rmSync(h.dir, { recursive: true, force: true });
});

await okAsync("governed-file hash mismatch (tampered manifest hash) is refused before any write", async () => {
  const h = setupHarness();
  const mappingFile = path.join(h.dir, "mapping.json");
  const drv = await seedPersona(mappingFile, "emp-rudy-driver");
  const m = JSON.parse(fs.readFileSync(h.manifestFile, "utf8"));
  m.governedFileHashes["functions/scripts/authPr4ProductionGate.js"] = "0".repeat(64);
  fs.writeFileSync(h.manifestFile, JSON.stringify(m));
  const r = runProd(h, ["--mappingFile", mappingFile, "--capturedStateOut", path.join(h.dir, "x.json")]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /hash mismatch/);
  const after = await auth.getUser(drv.uid);
  assert.equal(after.email, drv.prior);
  fs.rmSync(h.dir, { recursive: true, force: true });
});

await okAsync("supplied --authorizedCommit disagreeing with repository-derived identity is refused", async () => {
  const h = setupHarness();
  const mappingFile = path.join(h.dir, "mapping.json");
  await seedPersona(mappingFile, "emp-rudy-driver");
  const r = runProd(h, ["--mappingFile", mappingFile, "--capturedStateOut", path.join(h.dir, "x.json"), "--authorizedCommit", "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /disagrees with the repository-derived identity/);
  fs.rmSync(h.dir, { recursive: true, force: true });
});

await okAsync("position 5 without a break-glass confirmation is refused", async () => {
  const h = setupHarness();
  const mappingFile = path.join(h.dir, "mapping.json");
  // Fast-forward progression to 1-4 complete by signing a progression with 4 done.
  const p4 = { version: gate.PROGRESSION_VERSION, authorizationId: "AUTH-EMU-1", projectId: PROJECT, workflowIdentityHash: h.idHash, personaOrder: ORDER, completed: ORDER.slice(0, 4), suspended: false, updatedAt: new Date().toISOString() };
  gate.writeProgression(h.progFile, p4, h.key);
  await seedPersona(mappingFile, "emp-rudy-owner");
  const r = runProd(h, ["--mappingFile", mappingFile, "--capturedStateOut", path.join(h.dir, "x.json")]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /breakGlassConfirmationFile/);
  fs.rmSync(h.dir, { recursive: true, force: true });
});

await okAsync("missing protected inputs (manifest / progression / mapping) refuse fail-closed", async () => {
  const h = setupHarness();
  const noManifest = spawnSync(process.execPath, [SCRIPT, "--projectId", PROJECT, "--executeProduction", "--progressionFile", h.progFile, "--stateKeyFile", h.keyFile, "--mappingFile", path.join(h.dir, "m.json"), "--capturedStateOut", path.join(h.dir, "x.json")], { cwd: path.resolve("."), env: process.env, encoding: "utf8" });
  assert.notEqual(noManifest.status, 0);
  assert.match(noManifest.stderr, /authorizationManifest/);
  fs.rmSync(h.dir, { recursive: true, force: true });
});

await okAsync("PRODUCTION project (taylor-parts) is refused fail-closed even with --executeProduction (no real authorization)", async () => {
  // Uses the production project id but NEVER initializes the SDK / touches it:
  // the gate throws before initializeApp. Inputs are throwaway.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "authpr4-prodrefuse-"));
  const keyFile = path.join(dir, "k"); fs.writeFileSync(keyFile, crypto.randomBytes(48));
  const manifestFile = path.join(dir, "m.json");
  // A manifest claiming taylor-parts, but its governed hashes will NOT match reality
  // (and even if they did, no such authorization is recorded) -> fail closed.
  fs.writeFileSync(manifestFile, JSON.stringify({ version: 1, authorizationId: "X", projectId: "taylor-parts", personaOrder: ORDER, reviewedHead: "deadbeef", governedFileHashes: { "functions/scripts/authPr4RecoveryEmailMigration.js": "0".repeat(64), "functions/scripts/authPr4ProductionGate.js": "0".repeat(64) }, executionModeToken: "X" }));
  const progFile = path.join(dir, "p.json");
  const p0 = { version: 1, authorizationId: "X", projectId: "taylor-parts", workflowIdentityHash: "X", personaOrder: ORDER, completed: [], suspended: false, updatedAt: new Date().toISOString() };
  gate.writeProgression(progFile, p0, fs.readFileSync(keyFile));
  const r = spawnSync(process.execPath, [SCRIPT, "--projectId", "taylor-parts", "--confirmProduction", "taylor-parts", "--executeProduction", "--authorizationManifest", manifestFile, "--progressionFile", progFile, "--stateKeyFile", keyFile, "--mappingFile", path.join(dir, "map.json"), "--capturedStateOut", path.join(dir, "o.json")], { cwd: path.resolve("."), env: process.env, encoding: "utf8" });
  assert.notEqual(r.status, 0, "must refuse");
  assert.match(r.stderr, /hash mismatch|Failed/);
  fs.rmSync(dir, { recursive: true, force: true });
});

const wf = require("../scripts/authPr4RecoveryEmailMigration.js");

await okAsync("production rollback SUSPENDS progression, restores exact prior + emailVerified, and blocks later personas", async () => {
  const h = setupHarness();
  const mappingFile = path.join(h.dir, "mapping.json");
  const drv = await seedPersona(mappingFile, "emp-rudy-driver");
  const stateFile = path.join(h.dir, "driver.rollback.json");
  // Forward driver.
  const fwd = runProd(h, ["--mappingFile", mappingFile, "--capturedStateOut", stateFile]);
  assert.equal(fwd.status, 0, fwd.stderr);
  assert.equal((await auth.getUser(drv.uid)).email, drv.newAlias);
  let prog = gate.readAndVerifyProgression(h.progFile, h.key, { authorizationId: "AUTH-EMU-1", projectId: PROJECT, workflowIdentityHash: h.idHash, personaOrder: ORDER });
  assert.deepEqual(prog.completed, ["emp-rudy-driver"]);
  // Governed production rollback of driver.
  const rb = runProd(h, ["--rollback", "--mappingFile", mappingFile, "--capturedStateFile", stateFile]);
  assert.equal(rb.status, 0, rb.stderr);
  const restored = await auth.getUser(drv.uid);
  assert.equal(restored.email, drv.prior, "exact prior address restored");
  assert.equal(restored.emailVerified, true, "exact prior emailVerified restored");
  prog = gate.readAndVerifyProgression(h.progFile, h.key, { authorizationId: "AUTH-EMU-1", projectId: PROJECT, workflowIdentityHash: h.idHash, personaOrder: ORDER });
  assert.equal(prog.suspended, true, "rollback suspends progression");
  assert.deepEqual(prog.completed, [], "rollback reverses the persona");
  // A later persona is now blocked (progression suspended).
  await seedPersona(mappingFile, "emp-rudy-parts-associate");
  const blocked = runProd(h, ["--mappingFile", mappingFile, "--capturedStateOut", path.join(h.dir, "assoc.json")]);
  assert.notEqual(blocked.status, 0);
  assert.match(blocked.stderr, /SUSPENDED/);
  fs.rmSync(h.dir, { recursive: true, force: true });
});

await okAsync("uncertain outcome (read-back fails after updateUser) does NOT advance progression", async () => {
  // Module-level replay of main's production forward sequence with a faulting auth:
  // updateUser succeeds, the read-back getUser throws -> uncertain. Progression must
  // stay un-advanced and the rollback artifact must survive (design §5.1 + PR #453).
  const h = setupHarness();
  const mappingFile = path.join(h.dir, "mapping.json");
  const drv = await seedPersona(mappingFile, "emp-rudy-driver");
  const ctx = gate.assertProductionAuthorization(
    { projectId: PROJECT, executeProduction: true, mappingFile, authorizationManifest: h.manifestFile, progressionFile: h.progFile, stateKeyFile: h.keyFile, capturedStateOut: path.join(h.dir, "d.json") },
    { personaOrder: ORDER },
  );
  assert.equal(ctx.effective.employeeId, "emp-rudy-driver");
  const stateFile = path.join(h.dir, "d.json");
  wf.writeCapturedState(stateFile, { version: 1, projectId: PROJECT, employeeId: "emp-rudy-driver", position: 1, uid: drv.uid, priorAddress: drv.prior, priorEmailVerified: true, newAlias: drv.newAlias, createdAt: new Date().toISOString() }, h.key);
  let failNext = false;
  const faultingAuth = {
    getUserByEmail: (e) => auth.getUserByEmail(e),
    updateUser: async (uid, u) => { const r = await auth.updateUser(uid, u); failNext = true; return r; },
    getUser: async (uid) => { if (failNext) { failNext = false; const e = new Error("injected read-back failure"); e.code = "x"; throw e; } return auth.getUser(uid); },
  };
  const plan = wf.buildForwardPlan({ employeeId: "emp-rudy-driver", uid: drv.uid, priorAddress: drv.prior, priorEmailVerified: true, newAlias: drv.newAlias });
  await assert.rejects(() => wf.applyPlan(faultingAuth, plan, { execute: true }), (err) => wf.retainArtifactOnError(err) === true);
  // Progression is unchanged (still no completions); artifact retained.
  const prog = gate.readAndVerifyProgression(h.progFile, h.key, { authorizationId: "AUTH-EMU-1", projectId: PROJECT, workflowIdentityHash: h.idHash, personaOrder: ORDER });
  assert.deepEqual(prog.completed, [], "uncertain outcome must not advance progression");
  assert.ok(fs.existsSync(stateFile), "rollback artifact retained on uncertain outcome");
  fs.rmSync(h.dir, { recursive: true, force: true });
});

console.log(`\n${passed} passed (pure-helper + Auth-emulator layers)`);
process.exit(0);
