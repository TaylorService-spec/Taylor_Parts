// AUTH-PR-4 -- tests for the genesis progression-state initializer
// (functions/scripts/authPr4InitProgression.js). Pure, credential-free, no emulator:
// the initializer does no Firebase init or network access.
//
// Run:  node test/authPr4InitProgression.test.mjs

import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const gate = require("../scripts/authPr4ProductionGate.js");
const init = require("../scripts/authPr4InitProgression.js");

const ORDER = init.MIGRATION_PERSONA_ORDER;
const REAL_ROOT = gate.resolveRepoRoot();
let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }
function throws(fn, re) { assert.throws(fn, re); }

// Throwaway git repo with a GRANTED authorization + copies of ALL governed files
// (now 3, including the initializer). mutateArtifact(a) tweaks it for negatives.
function buildGrantedRepo(projectId, mutateArtifact) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "authpr4-init-repo-"));
  execFileSync("git", ["-C", root, "init", "-q"]);
  execFileSync("git", ["-C", root, "config", "user.email", "t@example.com"]);
  execFileSync("git", ["-C", root, "config", "user.name", "t"]);
  for (const rel of gate.GOVERNED_FILES) {
    fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), fs.readFileSync(path.join(REAL_ROOT, rel)));
  }
  execFileSync("git", ["-C", root, "add", "-A"]);
  execFileSync("git", ["-C", root, "commit", "-q", "-m", "governed files"]);
  const reviewedHead = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const hashes = gate.governedHashesAtCommit(root, reviewedHead);
  let artifact = {
    schema: gate.AUTH_SCHEMA, authorizationId: "AUTHPR4-PROD-TEST", authorizationStatus: "GRANTED",
    projectId, personaOrder: ORDER, reviewedHead, governedFileHashes: hashes,
    executionModeToken: "EMT-TOKEN", executor: { name: "rudy-digiorgio" },
    breakGlassContract: { validityWindowSeconds: 600, requiredConfirmer: "rudy-digiorgio" },
  };
  if (mutateArtifact) artifact = mutateArtifact(artifact) || artifact;
  fs.mkdirSync(path.join(root, "functions", "authpr4"), { recursive: true });
  fs.writeFileSync(path.join(root, gate.AUTH_ARTIFACT_PATH), JSON.stringify(artifact, null, 2));
  execFileSync("git", ["-C", root, "add", "-A"]);
  execFileSync("git", ["-C", root, "commit", "-q", "-m", "authorization"]);
  const authorizedCommit = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  return { root, authorizedCommit, executionModeToken: "EMT-TOKEN", executor: "rudy-digiorgio" };
}

function baseArgs(g, dir, over = {}) {
  const keyFile = path.join(dir, "state.key");
  if (!fs.existsSync(keyFile)) fs.writeFileSync(keyFile, crypto.randomBytes(48), { mode: 0o600 });
  return {
    projectId: "demo-authpr4", authorizedCommit: g.authorizedCommit,
    executionModeConfirmation: g.executionModeToken, executor: g.executor,
    stateKeyFile: keyFile, progressionOut: path.join(dir, "progression.json"), ...over,
  };
}

ok("GOVERNED_FILES now includes the initializer (bound)", () => {
  assert.ok(gate.GOVERNED_FILES.includes("functions/scripts/authPr4InitProgression.js"));
  assert.equal(gate.GOVERNED_FILES.length, 3);
});

ok("SUCCESS: creates a canonical revision-0 eligible/position-1 genesis + anchor, verified through the gate", () => {
  const g = buildGrantedRepo("demo-authpr4");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "authpr4-init-"));
  const args = baseArgs(g, dir);
  const res = init.initGenesis(args, { repoRoot: g.root, personaOrder: ORDER });
  assert.equal(res.ok, true);
  assert.equal(res.status, "eligible");
  assert.equal(res.revision, 0);
  assert.equal(res.completedCount, 0);
  assert.equal(res.nextPersona, "emp-rudy-driver");
  assert.equal(res.nextPosition, 1);
  assert.ok(fs.existsSync(args.progressionOut) && fs.existsSync(gate.anchorPath(args.progressionOut)));
  // Independently re-verify through the gate with the same key.
  const key = fs.readFileSync(args.stateKeyFile);
  const st = gate.readState(args.progressionOut, key, { authorizationId: "AUTHPR4-PROD-TEST", projectId: "demo-authpr4", workflowIdentityHash: gate.workflowIdentityHash(gate.governedHashesAtCommit(g.root, g.authorizedCommit)), personaOrder: ORDER });
  gate.verifyStateFreshness(args.progressionOut, st, key);
  assert.equal(st.status, "eligible"); assert.equal(st.revision, 0);
  // Protected perms on POSIX.
  if (process.platform !== "win32") assert.equal(fs.statSync(args.progressionOut).mode & 0o777, 0o600);
  fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(g.root, { recursive: true, force: true });
});

ok("OVERWRITE REFUSAL: refuses if progression / anchor / lock / txn already exists", () => {
  const g = buildGrantedRepo("demo-authpr4");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "authpr4-init-"));
  const args = baseArgs(g, dir);
  init.initGenesis(args, { repoRoot: g.root, personaOrder: ORDER }); // first: OK
  throws(() => init.initGenesis(args, { repoRoot: g.root, personaOrder: ORDER }), /Refusing to overwrite/); // second: refuse (state exists)
  // A stray lock/txn/anchor also blocks a fresh init.
  for (const stray of [gate.lockPath, gate.txnPath, gate.anchorPath]) {
    const d2 = fs.mkdtempSync(path.join(os.tmpdir(), "authpr4-init-"));
    const a2 = baseArgs(g, d2);
    fs.writeFileSync(stray(a2.progressionOut), "{}");
    throws(() => init.initGenesis(a2, { repoRoot: g.root, personaOrder: ORDER }), /Refusing to overwrite/);
    fs.rmSync(d2, { recursive: true, force: true });
  }
  fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(g.root, { recursive: true, force: true });
});

ok("WRONG KEY: a genesis signed with one key does not verify under another; short key refused", () => {
  const g = buildGrantedRepo("demo-authpr4");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "authpr4-init-"));
  const args = baseArgs(g, dir);
  init.initGenesis(args, { repoRoot: g.root, personaOrder: ORDER });
  const expected = { authorizationId: "AUTHPR4-PROD-TEST", projectId: "demo-authpr4", workflowIdentityHash: gate.workflowIdentityHash(gate.governedHashesAtCommit(g.root, g.authorizedCommit)), personaOrder: ORDER };
  throws(() => gate.readState(args.progressionOut, crypto.randomBytes(48), expected), /integrity verification/);
  // Short/too-weak key file is refused at load.
  const d2 = fs.mkdtempSync(path.join(os.tmpdir(), "authpr4-init-"));
  const shortKey = path.join(d2, "k"); fs.writeFileSync(shortKey, crypto.randomBytes(16));
  throws(() => init.initGenesis(baseArgs(g, d2, { stateKeyFile: shortKey, progressionOut: path.join(d2, "p.json") }), { repoRoot: g.root, personaOrder: ORDER }), /at least 32 bytes/);
  fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(d2, { recursive: true, force: true }); fs.rmSync(g.root, { recursive: true, force: true });
});

ok("STALE / MISMATCHED BINDING: wrong token, wrong executor, or tampered governed hashes are refused (no state created)", () => {
  const g = buildGrantedRepo("demo-authpr4");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "authpr4-init-"));
  throws(() => init.initGenesis(baseArgs(g, dir, { executionModeConfirmation: "WRONG", progressionOut: path.join(dir, "a.json") }), { repoRoot: g.root, personaOrder: ORDER }), /execution-mode token/);
  throws(() => init.initGenesis(baseArgs(g, dir, { executor: "someone", progressionOut: path.join(dir, "b.json") }), { repoRoot: g.root, personaOrder: ORDER }), /authorized executor/);
  // Tampered governed hashes in the artifact (stale binding).
  const gBad = buildGrantedRepo("demo-authpr4", (a) => { a.governedFileHashes[gate.GOVERNED_FILES[0]] = "0".repeat(64); return a; });
  const d2 = fs.mkdtempSync(path.join(os.tmpdir(), "authpr4-init-"));
  throws(() => init.initGenesis(baseArgs(gBad, d2), { repoRoot: gBad.root, personaOrder: ORDER }), /hash mismatch/);
  assert.ok(!fs.existsSync(path.join(d2, "progression.json")), "no state created on refusal");
  fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(d2, { recursive: true, force: true });
  fs.rmSync(g.root, { recursive: true, force: true }); fs.rmSync(gBad.root, { recursive: true, force: true });
});

ok("MALFORMED ARTIFACT: PENDING status / unknown field refused (no state created)", () => {
  const gP = buildGrantedRepo("demo-authpr4", (a) => ({ ...a, authorizationStatus: "PENDING" }));
  const gU = buildGrantedRepo("demo-authpr4", (a) => ({ ...a, evil: 1 }));
  for (const g of [gP, gU]) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "authpr4-init-"));
    throws(() => init.initGenesis(baseArgs(g, dir), { repoRoot: g.root, personaOrder: ORDER }), /not GRANTED|schema mismatch/);
    assert.ok(!fs.existsSync(path.join(dir, "progression.json")));
    fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(g.root, { recursive: true, force: true });
  }
});

ok("PARTIAL-WRITE RECOVERY: if the anchor create fails after the state create, the partial state is removed", () => {
  const g = buildGrantedRepo("demo-authpr4");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "authpr4-init-"));
  const args = baseArgs(g, dir);
  // Inject an fs whose openSync fails ONLY for the anchor path (the second create).
  let opened = 0;
  const realOpen = fs.openSync;
  const failingFs = { ...fs, existsSync: fs.existsSync, openSync: (p, ...rest) => {
    if (typeof p === "string" && p.endsWith(".anchor")) { const e = new Error("injected anchor failure"); throw e; }
    opened += 1; return realOpen(p, ...rest);
  } };
  throws(() => init.initGenesis(args, { repoRoot: g.root, personaOrder: ORDER, fs: failingFs }), /injected anchor failure/);
  assert.ok(!fs.existsSync(args.progressionOut), "partial state removed after anchor-create failure");
  assert.ok(!fs.existsSync(gate.anchorPath(args.progressionOut)));
  assert.ok(opened >= 1);
  fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(g.root, { recursive: true, force: true });
});

ok("SECRET OUTPUT: the sanitized result exposes no key, signature, or raw state", () => {
  const g = buildGrantedRepo("demo-authpr4");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "authpr4-init-"));
  const res = init.initGenesis(baseArgs(g, dir), { repoRoot: g.root, personaOrder: ORDER });
  const blob = JSON.stringify(res);
  assert.ok(!/signature|stateKey|priorAddress|privateKey/i.test(blob), "no secret fields in result");
  assert.match(res.workflowIdentityRef, /^ref:[0-9a-f]{16}$/); // truncated ref, not the full hash/secret
  fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(g.root, { recursive: true, force: true });
});

ok("CREDENTIAL-FREE: the initializer performs no Firebase initialization", () => {
  const src = fs.readFileSync(path.join(REAL_ROOT, "functions/scripts/authPr4InitProgression.js"), "utf8");
  assert.doesNotMatch(src, /initializeApp|getAuth|firebase-admin/);
});

console.log(`\n${passed} passed`);
process.exit(0);
