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
const PROD = init.PRODUCTION_PROJECT_ID; // "taylor-parts"
const REAL_ROOT = gate.resolveRepoRoot();
const SCRIPT = path.join(REAL_ROOT, "functions/scripts/authPr4InitProgression.js");
let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }
function throws(fn, re) { assert.throws(fn, re); }
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), "authpr4-init-")); }

// Throwaway git repo with a GRANTED authorization + copies of ALL governed files
// (now 3, including the initializer). Uses the PRODUCTION projectId so the
// production-only guard is satisfied. mutateArtifact(a) tweaks it for negatives.
function buildGrantedRepo(projectId = PROD, mutateArtifact) {
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
    projectId: PROD, confirmProduction: PROD, authorizedCommit: g.authorizedCommit,
    executionModeConfirmation: g.executionModeToken, executor: g.executor,
    stateKeyFile: keyFile, progressionOut: path.join(dir, "progression.json"), ...over,
  };
}

// fs proxy that fails exactly one op on paths matching `matchFn`; everything else is real.
function failingFsOn(matchFn, opName) {
  return {
    ...fs,
    openSync: (p, ...r) => { if (opName === "openSync" && typeof p === "string" && matchFn(p)) throw new Error("injected openSync failure"); return fs.openSync(p, ...r); },
    unlinkSync: (p, ...r) => { if (opName === "unlinkSync" && typeof p === "string" && matchFn(p)) throw new Error("injected unlinkSync failure"); return fs.unlinkSync(p, ...r); },
  };
}

// Reconciliation setup: a dir + key + the binding this repo's authorization expects.
function setup(g) {
  const dir = tmp();
  const keyFile = path.join(dir, "state.key");
  const key = crypto.randomBytes(48); fs.writeFileSync(keyFile, key, { mode: 0o600 });
  const progOut = path.join(dir, "progression.json");
  const idHash = gate.workflowIdentityHash(gate.governedHashesAtCommit(g.root, g.authorizedCommit));
  const expected = { authorizationId: "AUTHPR4-PROD-TEST", projectId: PROD, workflowIdentityHash: idHash, personaOrder: ORDER };
  const rargs = (over = {}) => ({ projectId: PROD, confirmProduction: PROD, authorizedCommit: g.authorizedCommit, executionModeConfirmation: g.executionModeToken, executor: g.executor, stateKeyFile: keyFile, progressionOut: progOut, ...over });
  return { dir, key, keyFile, progOut, idHash, expected, rargs };
}
function writeGenesisState(progOut, key, expected) {
  const genesis = gate.genesisState({ authorizationId: expected.authorizationId, projectId: expected.projectId, workflowIdentityHash: expected.workflowIdentityHash, personaOrder: expected.personaOrder });
  fs.writeFileSync(progOut, JSON.stringify({ ...genesis, signature: gate.signProgression(genesis, key) }), { mode: 0o600 });
  return genesis;
}
function writeAnchorFor(progOut, key, genesis, expected) {
  gate.writeAnchor(progOut, { authorizationId: expected.authorizationId, highWaterRevision: genesis.revision, stateHash: gate.progressionHash(genesis) }, key);
}
// Default: a VALID canonical marker (token exactly 32 lowercase hex, as the initializer emits).
function writeMarker(progOut, tok = crypto.randomBytes(16).toString("hex")) {
  fs.writeFileSync(gate.initMarkerPath(progOut), JSON.stringify({ version: gate.INIT_MARKER_VERSION, token: tok, at: new Date().toISOString() }));
}
// A VALID canonical reconciliation mutex (simulating a crash-left one) at a given fence generation.
function writeReconcileMutex(progOut, { at = new Date().toISOString(), tok = crypto.randomBytes(16).toString("hex"), generation = 0 } = {}) {
  fs.writeFileSync(gate.reconcilePath(progOut), JSON.stringify({ version: gate.RECONCILE_MUTEX_VERSION, token: tok, generation, at }));
}
const OWNER_STOPPED = "prior-cleanup-stopped";
const RDEPS = (g) => ({ repoRoot: g.root, personaOrder: ORDER });
const CONFIRM = init.RECONCILE_CONFIRM;

// Advance the fencing generation the PRODUCTION way: hold the shared fence lock (generation-advance)
// and thread its owner token into the now lock-owned claimGeneration primitive. `key` is the raw
// protected state-key bytes (the fence lock is signed/verified with it).
function genAdvance(prog, key, owner = "o") {
  const next = init.currentGeneration(prog) + 1;
  const l = init.acquireFenceLock(prog, "generation-advance", key, {});
  try { init.claimGeneration(prog, next, owner, { stateKey: key, fenceToken: l.token }); }
  finally { init.releaseFenceLock(prog, l.token, {}); }
}
// Simulate an OUT-OF-BAND / adversarial generation-head advance (a directly written, chain-valid
// gen.N claim) -- the governed genAdvance is REFUSED while a fence lock is held, so tests that model
// a concurrent advance vs a held lock use this to move the ledger head behind the fence lock's back.
function writeGenClaimDirect(prog, n, prevDigest = gate.GEN_CHAIN_ROOT, owner = "out-of-band") {
  fs.writeFileSync(gate.genClaimPath(prog, n), JSON.stringify({ version: gate.GEN_LEDGER_VERSION, generation: n, previousDigest: prevDigest, owner, at: new Date().toISOString() }));
}

ok("GOVERNED_FILES now includes the initializer (bound)", () => {
  assert.ok(gate.GOVERNED_FILES.includes("functions/scripts/authPr4InitProgression.js"));
  assert.equal(gate.GOVERNED_FILES.length, 3);
});

ok("SUCCESS: creates a canonical revision-0 eligible/position-1 genesis + anchor, verified through the gate", () => {
  const g = buildGrantedRepo();
  const dir = tmp();
  const args = baseArgs(g, dir);
  const res = init.initGenesis(args, { repoRoot: g.root, personaOrder: ORDER });
  assert.equal(res.ok, true);
  assert.equal(res.status, "eligible");
  assert.equal(res.revision, 0);
  assert.equal(res.completedCount, 0);
  assert.equal(res.nextPersona, "emp-rudy-driver");
  assert.equal(res.nextPosition, 1);
  assert.equal(res.markerCleared, true);
  assert.ok(fs.existsSync(args.progressionOut) && fs.existsSync(gate.anchorPath(args.progressionOut)));
  assert.ok(!fs.existsSync(gate.initMarkerPath(args.progressionOut)), "marker removed on success");
  // Independently re-verify through the gate with the same key.
  const key = fs.readFileSync(args.stateKeyFile);
  const st = gate.readState(args.progressionOut, key, { authorizationId: "AUTHPR4-PROD-TEST", projectId: PROD, workflowIdentityHash: gate.workflowIdentityHash(gate.governedHashesAtCommit(g.root, g.authorizedCommit)), personaOrder: ORDER });
  gate.verifyStateFreshness(args.progressionOut, st, key);
  assert.equal(st.status, "eligible"); assert.equal(st.revision, 0);
  // The gate proceeds (no marker present).
  gate.assertNoInitMarker(args.progressionOut);
  // Protected perms on POSIX.
  if (process.platform !== "win32") assert.equal(fs.statSync(args.progressionOut).mode & 0o777, 0o600);
  fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(g.root, { recursive: true, force: true });
});

ok("PRODUCTION GUARD: refuses non-production projectId / missing / mismatched confirmProduction BEFORE any artifact", () => {
  const g = buildGrantedRepo();
  const dir = tmp();
  throws(() => init.initGenesis(baseArgs(g, dir, { projectId: "demo-authpr4", progressionOut: path.join(dir, "a.json") }), { repoRoot: g.root, personaOrder: ORDER }), /requires --projectId taylor-parts/);
  throws(() => init.initGenesis(baseArgs(g, dir, { confirmProduction: undefined, progressionOut: path.join(dir, "b.json") }), { repoRoot: g.root, personaOrder: ORDER }), /matching --confirmProduction taylor-parts/);
  throws(() => init.initGenesis(baseArgs(g, dir, { confirmProduction: "nope", progressionOut: path.join(dir, "c.json") }), { repoRoot: g.root, personaOrder: ORDER }), /matching --confirmProduction taylor-parts/);
  // No artifact of any kind was created on a guard refusal.
  for (const f of ["a.json", "b.json", "c.json"]) {
    assert.ok(!fs.existsSync(path.join(dir, f)), "no state");
    assert.ok(!fs.existsSync(gate.anchorPath(path.join(dir, f))), "no anchor");
    assert.ok(!fs.existsSync(gate.initMarkerPath(path.join(dir, f))), "no marker");
  }
  fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(g.root, { recursive: true, force: true });
});

ok("OVERWRITE REFUSAL: refuses if progression / anchor / lock / txn / init marker already exists", () => {
  const g = buildGrantedRepo();
  const dir = tmp();
  const args = baseArgs(g, dir);
  init.initGenesis(args, { repoRoot: g.root, personaOrder: ORDER }); // first: OK
  throws(() => init.initGenesis(args, { repoRoot: g.root, personaOrder: ORDER }), /Refusing to overwrite/); // second: refuse (state exists)
  // A stray lock/txn/anchor/init marker also blocks a fresh init.
  for (const stray of [gate.lockPath, gate.txnPath, gate.anchorPath, gate.initMarkerPath]) {
    const d2 = tmp();
    const a2 = baseArgs(g, d2);
    fs.writeFileSync(stray(a2.progressionOut), "{}");
    throws(() => init.initGenesis(a2, { repoRoot: g.root, personaOrder: ORDER }), /Refusing to overwrite/);
    fs.rmSync(d2, { recursive: true, force: true });
  }
  fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(g.root, { recursive: true, force: true });
});

ok("WRONG KEY: a genesis signed with one key does not verify under another; short key refused", () => {
  const g = buildGrantedRepo();
  const dir = tmp();
  const args = baseArgs(g, dir);
  init.initGenesis(args, { repoRoot: g.root, personaOrder: ORDER });
  const expected = { authorizationId: "AUTHPR4-PROD-TEST", projectId: PROD, workflowIdentityHash: gate.workflowIdentityHash(gate.governedHashesAtCommit(g.root, g.authorizedCommit)), personaOrder: ORDER };
  throws(() => gate.readState(args.progressionOut, crypto.randomBytes(48), expected), /integrity verification/);
  // Short/too-weak key file is refused at load (marker cleaned? no -- guard/load is before marker).
  const d2 = tmp();
  const shortKey = path.join(d2, "k"); fs.writeFileSync(shortKey, crypto.randomBytes(16));
  const a2 = baseArgs(g, d2, { stateKeyFile: shortKey, progressionOut: path.join(d2, "p.json") });
  throws(() => init.initGenesis(a2, { repoRoot: g.root, personaOrder: ORDER }), /at least 32 bytes/);
  assert.ok(!fs.existsSync(a2.progressionOut) && !fs.existsSync(gate.initMarkerPath(a2.progressionOut)), "nothing created before key load");
  fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(d2, { recursive: true, force: true }); fs.rmSync(g.root, { recursive: true, force: true });
});

ok("STALE / MISMATCHED BINDING: wrong token, wrong executor, or tampered governed hashes refused (nothing created)", () => {
  const g = buildGrantedRepo();
  const dir = tmp();
  throws(() => init.initGenesis(baseArgs(g, dir, { executionModeConfirmation: "WRONG", progressionOut: path.join(dir, "a.json") }), { repoRoot: g.root, personaOrder: ORDER }), /execution-mode token/);
  throws(() => init.initGenesis(baseArgs(g, dir, { executor: "someone", progressionOut: path.join(dir, "b.json") }), { repoRoot: g.root, personaOrder: ORDER }), /authorized executor/);
  // Tampered governed hashes in the artifact (stale binding).
  const gBad = buildGrantedRepo(PROD, (a) => { a.governedFileHashes[gate.GOVERNED_FILES[0]] = "0".repeat(64); return a; });
  const d2 = tmp();
  throws(() => init.initGenesis(baseArgs(gBad, d2), { repoRoot: gBad.root, personaOrder: ORDER }), /hash mismatch/);
  for (const p of [path.join(dir, "a.json"), path.join(dir, "b.json"), path.join(d2, "progression.json")]) {
    assert.ok(!fs.existsSync(p) && !fs.existsSync(gate.initMarkerPath(p)), "no state/marker created on refusal");
  }
  fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(d2, { recursive: true, force: true });
  fs.rmSync(g.root, { recursive: true, force: true }); fs.rmSync(gBad.root, { recursive: true, force: true });
});

ok("MALFORMED ARTIFACT: PENDING status / unknown field refused (nothing created)", () => {
  const gP = buildGrantedRepo(PROD, (a) => ({ ...a, authorizationStatus: "PENDING" }));
  const gU = buildGrantedRepo(PROD, (a) => ({ ...a, evil: 1 }));
  for (const g of [gP, gU]) {
    const dir = tmp();
    const args = baseArgs(g, dir);
    throws(() => init.initGenesis(args, { repoRoot: g.root, personaOrder: ORDER }), /not GRANTED|schema mismatch/);
    assert.ok(!fs.existsSync(args.progressionOut) && !fs.existsSync(gate.initMarkerPath(args.progressionOut)));
    fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(g.root, { recursive: true, force: true });
  }
});

ok("CRASH SAFETY: a crash at ANY boundary leaves the init marker (never auto-deleted); the gate then refuses", () => {
  const g = buildGrantedRepo();

  // (a) crash creating the STATE (marker already published): marker remains, no state/anchor.
  {
    const dir = tmp();
    const args = baseArgs(g, dir);
    const dfs = failingFsOn((p) => p === args.progressionOut, "openSync");
    throws(() => init.initGenesis(args, { repoRoot: g.root, personaOrder: ORDER, fs: dfs }), /Failed to create a protected artifact/);
    assert.ok(fs.existsSync(gate.initMarkerPath(args.progressionOut)), "marker left in place (not auto-deleted)");
    assert.ok(!fs.existsSync(args.progressionOut), "no state");
    assert.ok(!fs.existsSync(gate.anchorPath(args.progressionOut)), "no anchor");
    throws(() => gate.assertNoInitMarker(args.progressionOut), /initialization marker is present/i);
    fs.rmSync(dir, { recursive: true, force: true });
  }
  // (b) crash creating the ANCHOR (marker + partial state present): both retained, NOT auto-deleted.
  {
    const dir = tmp();
    const args = baseArgs(g, dir);
    const dfs = failingFsOn((p) => p === gate.anchorPath(args.progressionOut), "openSync");
    throws(() => init.initGenesis(args, { repoRoot: g.root, personaOrder: ORDER, fs: dfs }), /Failed to create a protected artifact/);
    assert.ok(fs.existsSync(gate.initMarkerPath(args.progressionOut)), "marker retained");
    assert.ok(fs.existsSync(args.progressionOut), "partial state retained, NOT auto-deleted");
    assert.ok(!fs.existsSync(gate.anchorPath(args.progressionOut)), "no anchor");
    throws(() => gate.assertNoInitMarker(args.progressionOut), /initialization marker is present/i);
    fs.rmSync(dir, { recursive: true, force: true });
  }
  // (c) crash REMOVING the marker (state + anchor both verified): all three retained, gate blocks.
  {
    const dir = tmp();
    const args = baseArgs(g, dir);
    const dfs = failingFsOn((p) => p === gate.initMarkerPath(args.progressionOut), "unlinkSync");
    throws(() => init.initGenesis(args, { repoRoot: g.root, personaOrder: ORDER, fs: dfs }), /finalise initialization/i);
    assert.ok(fs.existsSync(gate.initMarkerPath(args.progressionOut)), "marker retained on removal crash");
    assert.ok(fs.existsSync(args.progressionOut) && fs.existsSync(gate.anchorPath(args.progressionOut)), "state + anchor present");
    throws(() => gate.assertNoInitMarker(args.progressionOut), /initialization marker is present/i);
    fs.rmSync(dir, { recursive: true, force: true });
  }
  fs.rmSync(g.root, { recursive: true, force: true });
});

ok("FOREIGN MARKER: a marker owned by another attempt is never removed (governed reconciliation)", () => {
  // Directly exercise the owner-bound removal contract: initGenesis refuses to start
  // when a marker already exists (overwrite refusal), so a foreign marker always blocks.
  const g = buildGrantedRepo();
  const dir = tmp();
  const args = baseArgs(g, dir);
  fs.writeFileSync(gate.initMarkerPath(args.progressionOut), JSON.stringify({ version: gate.INIT_MARKER_VERSION, token: "someone-else", at: new Date().toISOString() }));
  throws(() => init.initGenesis(args, { repoRoot: g.root, personaOrder: ORDER }), /Refusing to overwrite/);
  assert.ok(fs.existsSync(gate.initMarkerPath(args.progressionOut)), "foreign marker untouched");
  fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(g.root, { recursive: true, force: true });
});

ok("SECRET OUTPUT (in-process): the sanitized result exposes no key, signature, or raw state", () => {
  const g = buildGrantedRepo();
  const dir = tmp();
  const res = init.initGenesis(baseArgs(g, dir), { repoRoot: g.root, personaOrder: ORDER });
  const blob = JSON.stringify(res);
  assert.ok(!/signature|stateKey|priorAddress|privateKey/i.test(blob), "no secret fields in result");
  assert.match(res.workflowIdentityRef, /^ref:[0-9a-f]{16}$/); // truncated ref, not the full hash/secret
  fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(g.root, { recursive: true, force: true });
});

ok("SECRET OUTPUT (CLI): stdout/stderr carry no state key, execution token, or protected paths", () => {
  const g = buildGrantedRepo();
  // Run the temp repo's OWN committed copy of the initializer, so resolveRepoRoot
  // (which derives from __dirname) targets the temp repo, not this worktree.
  const scriptInRepo = path.join(g.root, "functions/scripts/authPr4InitProgression.js");
  // Keep key + outputs OUTSIDE the repo tree (so the governed tree stays clean).
  const io = tmp();
  const keyFile = path.join(io, "state.key");
  fs.writeFileSync(keyFile, crypto.randomBytes(48), { mode: 0o600 });
  const progOut = path.join(io, "progression.json");
  const cli = (over) => execFileSync("node", [scriptInRepo,
    "--projectId", PROD, "--confirmProduction", PROD,
    "--authorizedCommit", g.authorizedCommit, "--executionModeConfirmation", over.token ?? g.executionModeToken,
    "--executor", g.executor, "--stateKeyFile", over.keyFile ?? keyFile, "--progressionOut", over.progOut ?? progOut,
  ], { cwd: g.root, encoding: "utf8" });

  // SUCCESS run.
  const stdout = cli({});
  assert.match(stdout, /GENESIS initialised/);
  assert.ok(!stdout.includes(g.executionModeToken), "execution token absent from stdout");
  assert.ok(!stdout.includes(keyFile) && !stdout.includes(progOut) && !stdout.includes(io), "no protected paths in stdout");
  assert.ok(!stdout.includes(fs.readFileSync(keyFile).toString("hex").slice(0, 16)), "no key bytes in stdout");
  assert.ok(fs.existsSync(progOut) && !fs.existsSync(gate.initMarkerPath(progOut)), "state created, marker cleared");

  // FAILURE run whose RAW error would embed a protected path (missing state-key file).
  const io2 = tmp();
  const missingKey = path.join(io2, "does-not-exist.key");
  const progOut2 = path.join(io2, "p.json");
  let combined = "";
  try { cli({ keyFile: missingKey, progOut: progOut2 }); assert.fail("should have failed"); }
  catch (e) { combined = String(e.stdout || "") + String(e.stderr || ""); }
  assert.match(combined, /Failed:/);
  assert.ok(!combined.includes(io2) && !combined.includes(missingKey), "protected path sanitized from stderr");

  fs.rmSync(io, { recursive: true, force: true }); fs.rmSync(io2, { recursive: true, force: true }); fs.rmSync(g.root, { recursive: true, force: true });
});

ok("SANITIZER: strips Windows + POSIX absolute paths, SPACED paths, and echoed secrets", () => {
  assert.equal(init.sanitizeForOutput("open 'C:\\secure\\state.key' failed"), "open '<path>' failed");
  assert.equal(init.sanitizeForOutput("ENOENT /secure/vault/progression.json"), "ENOENT <path>");
  assert.equal(init.sanitizeForOutput("token EMT-XYZ leaked", ["EMT-XYZ"]), "token <redacted> leaked");
  // Codex reproduction: paths WITH SPACES must be fully redacted, not partially.
  // (a) exact known value -> whole path redacted regardless of spaces.
  assert.equal(init.sanitizeForOutput("open C:\\Secure Folder\\state.key now", ["C:\\Secure Folder\\state.key"]), "open <redacted> now");
  assert.equal(init.sanitizeForOutput("ENOENT /secure/vault folder/state.key", ["/secure/vault folder/state.key"]), "ENOENT <redacted>");
  // (b) quoted spaced path (as Node's fs errors emit) -> quote-aware generic redaction.
  assert.equal(init.sanitizeForOutput("open 'C:\\Secure Folder\\state.key' failed"), "open '<path>' failed");
  assert.equal(init.sanitizeForOutput("open '/secure/vault folder/state.key' failed"), "open '<path>' failed");
  // No leftover distinctive segment.
  const red = init.sanitizeForOutput("open 'C:\\Secure Folder\\state.key' x", ["C:\\Secure Folder\\state.key"]);
  assert.ok(!/Secure Folder|state\.key/.test(red), "no distinctive segment survives");
});

// ---------------------------------------------------------------------------
// RECONCILE modes (crash-residue inspection + Owner-confirmed confined cleanup)
// ---------------------------------------------------------------------------

ok("RECONCILE guard: production-only + reconcile modes are credential-free", () => {
  const g = buildGrantedRepo(); const s = setup(g); writeMarker(s.progOut);
  throws(() => init.reconcileInspect(s.rargs({ projectId: "demo-authpr4" }), RDEPS(g)), /requires --projectId taylor-parts/);
  throws(() => init.reconcileCleanup(s.rargs({ confirmProduction: "x", fingerprint: "a".repeat(64), action: "clean-reset", confirmReconciliation: CONFIRM }), RDEPS(g)), /matching --confirmProduction taylor-parts/);
  const src = fs.readFileSync(SCRIPT, "utf8");
  assert.doesNotMatch(src, /initializeApp|getAuth|firebase-admin/);
  fs.rmSync(s.dir, { recursive: true, force: true }); fs.rmSync(g.root, { recursive: true, force: true });
});

ok("RECONCILE: sound genesis + residue marker -> inspect=marker-only; cleanup removes ONLY the marker", () => {
  const g = buildGrantedRepo(); const s = setup(g);
  const gen = writeGenesisState(s.progOut, s.key, s.expected);
  writeAnchorFor(s.progOut, s.key, gen, s.expected);
  writeMarker(s.progOut);
  const rep = init.reconcileInspect(s.rargs(), RDEPS(g));
  assert.equal(rep.recommendation, "marker-only");
  assert.equal(rep.markerValid, true);
  assert.equal(rep.stateCanonicalGenesis, true);
  assert.equal(rep.anchorConsistent, true);
  assert.match(rep.fingerprint, /^[0-9a-f]{64}$/);
  assert.match(rep.workflowIdentityRef, /^ref:[0-9a-f]{16}$/);
  // A mismatched action is refused.
  throws(() => init.reconcileCleanup(s.rargs({ fingerprint: rep.fingerprint, action: "clean-reset", confirmReconciliation: CONFIRM }), RDEPS(g)), /does not match the inspected recommendation/);
  const res = init.reconcileCleanup(s.rargs({ fingerprint: rep.fingerprint, action: "marker-only", confirmReconciliation: CONFIRM }), RDEPS(g));
  assert.deepEqual(res.removedRoles, ["marker"]);
  assert.ok(!fs.existsSync(gate.initMarkerPath(s.progOut)), "marker removed");
  assert.ok(fs.existsSync(s.progOut) && fs.existsSync(gate.anchorPath(s.progOut)), "sound genesis + anchor survive");
  fs.rmSync(s.dir, { recursive: true, force: true }); fs.rmSync(g.root, { recursive: true, force: true });
});

ok("RECONCILE: marker only (no state) -> clean-reset removes the marker; nothing remains", () => {
  const g = buildGrantedRepo(); const s = setup(g); writeMarker(s.progOut);
  const rep = init.reconcileInspect(s.rargs(), RDEPS(g));
  assert.equal(rep.stateClass, "absent");
  assert.equal(rep.recommendation, "clean-reset");
  const res = init.reconcileCleanup(s.rargs({ fingerprint: rep.fingerprint, action: "clean-reset", confirmReconciliation: CONFIRM }), RDEPS(g));
  assert.deepEqual(res.removedRoles, ["marker"]);
  assert.equal(res.artifactsRemaining.length, 0);
  assert.ok(!fs.existsSync(gate.initMarkerPath(s.progOut)));
  fs.rmSync(s.dir, { recursive: true, force: true }); fs.rmSync(g.root, { recursive: true, force: true });
});

ok("RECONCILE: marker + truncated partial state -> clean-reset removes marker + state", () => {
  const g = buildGrantedRepo(); const s = setup(g);
  fs.writeFileSync(s.progOut, '{"version":1,"authorizationId"'); // truncated JSON
  writeMarker(s.progOut);
  const rep = init.reconcileInspect(s.rargs(), RDEPS(g));
  assert.equal(rep.stateClass, "partial");
  assert.equal(rep.recommendation, "clean-reset");
  const res = init.reconcileCleanup(s.rargs({ fingerprint: rep.fingerprint, action: "clean-reset", confirmReconciliation: CONFIRM }), RDEPS(g));
  assert.ok(res.removedRoles.includes("marker") && res.removedRoles.includes("state"));
  assert.ok(!fs.existsSync(s.progOut) && !fs.existsSync(gate.initMarkerPath(s.progOut)));
  fs.rmSync(s.dir, { recursive: true, force: true }); fs.rmSync(g.root, { recursive: true, force: true });
});

ok("RECONCILE: marker + canonical genesis state but MISSING anchor -> clean-reset (incomplete init)", () => {
  const g = buildGrantedRepo(); const s = setup(g);
  writeGenesisState(s.progOut, s.key, s.expected); // no anchor written
  writeMarker(s.progOut);
  const rep = init.reconcileInspect(s.rargs(), RDEPS(g));
  assert.equal(rep.stateCanonicalGenesis, true);
  assert.equal(rep.anchorPresent, false);
  assert.equal(rep.recommendation, "clean-reset");
  fs.rmSync(s.dir, { recursive: true, force: true }); fs.rmSync(g.root, { recursive: true, force: true });
});

ok("RECONCILE: marker + genesis state + INVALID anchor -> blocked; cleanup refused", () => {
  const g = buildGrantedRepo(); const s = setup(g);
  const gen = writeGenesisState(s.progOut, s.key, s.expected);
  fs.writeFileSync(gate.anchorPath(s.progOut), JSON.stringify({ version: gate.ANCHOR_VERSION, authorizationId: s.expected.authorizationId, highWaterRevision: 0, stateHash: gate.progressionHash(gen), updatedAt: new Date().toISOString(), signature: "deadbeef" }));
  writeMarker(s.progOut);
  const rep = init.reconcileInspect(s.rargs(), RDEPS(g));
  assert.equal(rep.anchorPresent, true);
  assert.equal(rep.anchorConsistent, false);
  assert.equal(rep.recommendation, "blocked");
  throws(() => init.reconcileCleanup(s.rargs({ fingerprint: rep.fingerprint, action: "clean-reset", confirmReconciliation: CONFIRM }), RDEPS(g)), /BLOCKED/);
  assert.ok(fs.existsSync(gate.initMarkerPath(s.progOut)), "blocked residue untouched");
  fs.rmSync(s.dir, { recursive: true, force: true }); fs.rmSync(g.root, { recursive: true, force: true });
});

ok("RECONCILE: WRONG state key -> indeterminate -> blocked (never auto-deletes a possibly-real state)", () => {
  const g = buildGrantedRepo(); const s = setup(g);
  const gen = writeGenesisState(s.progOut, s.key, s.expected);
  writeAnchorFor(s.progOut, s.key, gen, s.expected);
  writeMarker(s.progOut);
  const wrongKeyFile = path.join(s.dir, "wrong.key"); fs.writeFileSync(wrongKeyFile, crypto.randomBytes(48));
  const rep = init.reconcileInspect(s.rargs({ stateKeyFile: wrongKeyFile }), RDEPS(g));
  assert.equal(rep.stateClass, "indeterminate");
  assert.equal(rep.recommendation, "blocked");
  throws(() => init.reconcileCleanup(s.rargs({ stateKeyFile: wrongKeyFile, fingerprint: rep.fingerprint, action: "clean-reset", confirmReconciliation: CONFIRM }), RDEPS(g)), /BLOCKED/);
  fs.rmSync(s.dir, { recursive: true, force: true }); fs.rmSync(g.root, { recursive: true, force: true });
});

ok("RECONCILE: malformed (foreign-shaped) marker -> blocked", () => {
  const g = buildGrantedRepo(); const s = setup(g);
  const gen = writeGenesisState(s.progOut, s.key, s.expected); writeAnchorFor(s.progOut, s.key, gen, s.expected);
  fs.writeFileSync(gate.initMarkerPath(s.progOut), JSON.stringify({ version: 99, foreign: true }));
  const rep = init.reconcileInspect(s.rargs(), RDEPS(g));
  assert.equal(rep.markerValid, false);
  assert.equal(rep.recommendation, "blocked");
  fs.rmSync(s.dir, { recursive: true, force: true }); fs.rmSync(g.root, { recursive: true, force: true });
});

ok("RECONCILE: artifact change between inspect and cleanup -> fingerprint mismatch; mutex released (retryable)", () => {
  const g = buildGrantedRepo(); const s = setup(g); writeMarker(s.progOut);
  const rep = init.reconcileInspect(s.rargs(), RDEPS(g));
  writeMarker(s.progOut); // rewrite the marker (valid, different token) AFTER inspection -> fingerprint changes, stays clean-reset
  throws(() => init.reconcileCleanup(s.rargs({ fingerprint: rep.fingerprint, action: "clean-reset", confirmReconciliation: CONFIRM }), RDEPS(g)), /fingerprint mismatch/);
  assert.ok(fs.existsSync(gate.initMarkerPath(s.progOut)), "marker untouched on refusal");
  // A validation refusal releases the mutex (no filesystem mutation) so the operator can retry.
  assert.ok(!fs.existsSync(gate.reconcilePath(s.progOut)), "reconciliation mutex released on validation refusal");
  const rep2 = init.reconcileInspect(s.rargs(), RDEPS(g));
  const res = init.reconcileCleanup(s.rargs({ fingerprint: rep2.fingerprint, action: "clean-reset", confirmReconciliation: CONFIRM }), RDEPS(g));
  assert.deepEqual(res.removedRoles, ["marker"]);
  fs.rmSync(s.dir, { recursive: true, force: true }); fs.rmSync(g.root, { recursive: true, force: true });
});

ok("MARKER VALIDATION: only a 32-hex-token canonical marker is valid; every non-producible marker -> blocked", () => {
  const g = buildGrantedRepo();
  const at = new Date().toISOString(); const V = gate.INIT_MARKER_VERSION;
  const bad = [
    { version: V, token: "", at },                                  // empty
    { version: V, token: "abcd", at },                              // short
    { version: V, token: "a".repeat(64), at },                     // long
    { version: V, token: "A".repeat(32), at },                     // uppercase
    { version: V, token: "g".repeat(32), at },                     // non-hex
    { version: V, token: crypto.randomBytes(16).toString("hex") }, // missing 'at'
    { version: V, token: crypto.randomBytes(16).toString("hex"), at, extra: 1 }, // extra field
    { version: 2, token: crypto.randomBytes(16).toString("hex"), at }, // wrong version
    { version: V, token: crypto.randomBytes(16).toString("hex"), at: "not-a-date" }, // bad timestamp
  ];
  for (const m of bad) {
    const s = setup(g);
    const gen = writeGenesisState(s.progOut, s.key, s.expected); writeAnchorFor(s.progOut, s.key, gen, s.expected);
    fs.writeFileSync(gate.initMarkerPath(s.progOut), JSON.stringify(m));
    const rep = init.reconcileInspect(s.rargs(), RDEPS(g));
    assert.equal(rep.markerValid, false, `marker ${JSON.stringify(m)} should be invalid`);
    assert.equal(rep.recommendation, "blocked");
    // The same canonical validator the gate exports agrees.
    assert.equal(gate.isValidInitMarker(m), false);
    fs.rmSync(s.dir, { recursive: true, force: true });
  }
  // A valid 32-hex marker over a sound genesis is marker-only (control).
  assert.equal(gate.isValidInitMarker({ version: V, token: crypto.randomBytes(16).toString("hex"), at }), true);
  fs.rmSync(g.root, { recursive: true, force: true });
});

for (const kind of ["lock", "txn", "both"]) {
  ok(`RECONCILE: marker + ${kind} (foreign runtime artifact) -> blocked; cleanup refused, all bytes intact`, () => {
    const g = buildGrantedRepo(); const s = setup(g); writeMarker(s.progOut);
    if (kind === "lock" || kind === "both") fs.writeFileSync(gate.lockPath(s.progOut), "LOCK");
    if (kind === "txn" || kind === "both") fs.writeFileSync(gate.txnPath(s.progOut), "TXN");
    const before = init.perRoleDigests(s.progOut, RDEPS(g));
    const rep = init.reconcileInspect(s.rargs(), RDEPS(g));
    assert.equal(rep.lockPresent, kind === "lock" || kind === "both");
    assert.equal(rep.txnPresent, kind === "txn" || kind === "both");
    assert.equal(rep.recommendation, "blocked");
    throws(() => init.reconcileCleanup(s.rargs({ fingerprint: rep.fingerprint, action: "clean-reset", confirmReconciliation: CONFIRM }), RDEPS(g)), /BLOCKED/);
    // Every artifact is byte-identical; the reconciliation mutex was released (validation refusal).
    assert.deepEqual(init.perRoleDigests(s.progOut, RDEPS(g)), before, "no artifact mutated");
    assert.ok(!fs.existsSync(gate.reconcilePath(s.progOut)), "mutex released on blocked refusal");
    fs.rmSync(s.dir, { recursive: true, force: true }); fs.rmSync(g.root, { recursive: true, force: true });
  });
}

ok("RECONCILE TOCTOU: replacement BEFORE the first deletion -> per-file digest recheck aborts; nothing deleted; mutex retained (blocking)", () => {
  const g = buildGrantedRepo(); const s = setup(g); writeMarker(s.progOut);
  const rep = init.reconcileInspect(s.rargs(), RDEPS(g));
  // Replace the marker's bytes at the recheck boundary for the FIRST target (marker).
  const hook = (role) => { if (role === "marker") writeMarker(s.progOut, crypto.randomBytes(16).toString("hex")); };
  throws(() => init.reconcileCleanup(s.rargs({ fingerprint: rep.fingerprint, action: "clean-reset", confirmReconciliation: CONFIRM }), { ...RDEPS(g), beforeTargetRecheck: hook }), /changed between inspection and deletion/);
  assert.ok(fs.existsSync(gate.initMarkerPath(s.progOut)), "marker NOT deleted (recheck caught the change)");
  assert.ok(fs.existsSync(gate.reconcilePath(s.progOut)), "mutex RETAINED (fail-closed, blocking)");
  // The gate now blocks on the retained reconciliation mutex.
  throws(() => gate.assertNoReconcileMutex(s.progOut), /reconciliation mutex is present/i);
  fs.rmSync(s.dir, { recursive: true, force: true }); fs.rmSync(g.root, { recursive: true, force: true });
});

ok("RECONCILE TOCTOU: replacement BETWEEN deletions -> first target gone, second aborts; mutex retained (partial, blocking)", () => {
  const g = buildGrantedRepo(); const s = setup(g);
  fs.writeFileSync(s.progOut, '{"version":1,'); // truncated partial state -> clean-reset targets state+marker (marker LAST)
  writeMarker(s.progOut);
  const rep = init.reconcileInspect(s.rargs(), RDEPS(g));
  assert.equal(rep.recommendation, "clean-reset");
  // Deletion order is state, then marker (marker last). After state is deleted, replace the
  // MARKER's bytes just before its recheck.
  const hook = (role) => { if (role === "marker") writeMarker(s.progOut, crypto.randomBytes(16).toString("hex")); };
  throws(() => init.reconcileCleanup(s.rargs({ fingerprint: rep.fingerprint, action: "clean-reset", confirmReconciliation: CONFIRM }), { ...RDEPS(g), beforeTargetRecheck: hook }), /changed between inspection and deletion/);
  assert.ok(!fs.existsSync(s.progOut), "first target (state) was deleted");
  assert.ok(fs.existsSync(gate.initMarkerPath(s.progOut)), "marker (last, signal) NOT deleted (recheck caught the change)");
  assert.ok(fs.existsSync(gate.reconcilePath(s.progOut)), "mutex RETAINED after partial cleanup (blocking)");
  fs.rmSync(s.dir, { recursive: true, force: true }); fs.rmSync(g.root, { recursive: true, force: true });
});

ok("RECONCILE TOCTOU: concurrent cleanup -> a pre-existing reconciliation mutex refuses the second attempt", () => {
  const g = buildGrantedRepo(); const s = setup(g); writeMarker(s.progOut);
  const rep = init.reconcileInspect(s.rargs(), RDEPS(g));
  fs.writeFileSync(gate.reconcilePath(s.progOut), JSON.stringify({ version: gate.RECONCILE_MUTEX_VERSION, token: "aa".repeat(16), at: new Date().toISOString() }));
  throws(() => init.reconcileCleanup(s.rargs({ fingerprint: rep.fingerprint, action: "clean-reset", confirmReconciliation: CONFIRM }), RDEPS(g)), /reconciliation mutex is already present/);
  assert.ok(fs.existsSync(gate.initMarkerPath(s.progOut)), "residue untouched");
  fs.rmSync(s.dir, { recursive: true, force: true }); fs.rmSync(g.root, { recursive: true, force: true });
});

ok("RECONCILE TOCTOU: an unlink failure aborts mid-cleanup; mutex retained (fail-closed)", () => {
  const g = buildGrantedRepo(); const s = setup(g);
  fs.writeFileSync(s.progOut, '{"version":1,'); // partial state -> clean-reset state then marker (marker last)
  writeMarker(s.progOut);
  const rep = init.reconcileInspect(s.rargs(), RDEPS(g));
  // fs whose unlinkSync fails for the MARKER path (last target) only.
  const markerPath = gate.initMarkerPath(s.progOut);
  const dfs = { ...fs, unlinkSync: (p, ...r) => { if (typeof p === "string" && p === markerPath) throw new Error("injected unlink failure"); return fs.unlinkSync(p, ...r); } };
  throws(() => init.reconcileCleanup(s.rargs({ fingerprint: rep.fingerprint, action: "clean-reset", confirmReconciliation: CONFIRM }), { ...RDEPS(g), fs: dfs }), /injected unlink failure/);
  assert.ok(!fs.existsSync(s.progOut), "state removed");
  assert.ok(fs.existsSync(markerPath), "marker not removed (unlink failed)");
  assert.ok(fs.existsSync(gate.reconcilePath(s.progOut)), "mutex RETAINED (fail-closed)");
  fs.rmSync(s.dir, { recursive: true, force: true }); fs.rmSync(g.root, { recursive: true, force: true });
});

ok("RECONCILE TOCTOU: a foreign-token reconciliation mutex is detected at the ownership recheck -> nothing deleted, mutex left", () => {
  const g = buildGrantedRepo(); const s = setup(g); writeMarker(s.progOut);
  const rep = init.reconcileInspect(s.rargs(), RDEPS(g));
  // fs whose reconcile-mutex reads return a FOREIGN token (simulated takeover) while all
  // other reads/writes are real. The per-step ownership recheck catches it before deleting.
  const reconFile = gate.reconcilePath(s.progOut);
  const dfs = { ...fs, readFileSync: (p, ...r) => (typeof p === "string" && p === reconFile ? JSON.stringify({ version: gate.RECONCILE_MUTEX_VERSION, token: "ff".repeat(16), generation: 0, at: new Date().toISOString() }) : fs.readFileSync(p, ...r)) };
  throws(() => init.reconcileCleanup(s.rargs({ fingerprint: rep.fingerprint, action: "clean-reset", confirmReconciliation: CONFIRM }), { ...RDEPS(g), fs: dfs }), /no longer owns the reconciliation mutex/);
  assert.ok(fs.existsSync(gate.initMarkerPath(s.progOut)), "nothing deleted (fenced at the ownership recheck)");
  assert.ok(fs.existsSync(reconFile), "foreign-owned mutex left in place");
  fs.rmSync(s.dir, { recursive: true, force: true }); fs.rmSync(g.root, { recursive: true, force: true });
});

ok("ATOMIC PUBLICATION: exclusive create writes complete content in one step and fails closed (EEXIST) on conflict", () => {
  const dir = tmp();
  const p = path.join(dir, "art");
  init.atomicExclusiveCreate(p, "COMPLETE-CANONICAL-CONTENT", {});
  assert.equal(fs.readFileSync(p, "utf8"), "COMPLETE-CANONICAL-CONTENT"); // never a truncated in-progress view
  // No leftover temp files (the in-progress publication is never visible under the final name).
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f !== "art"), []);
  let code = null; try { init.atomicExclusiveCreate(p, "X", {}); } catch (e) { code = e.code; }
  assert.equal(code, "EEXIST", "second exclusive create fails closed");
  fs.rmSync(dir, { recursive: true, force: true });
});

ok("RECOVER: Owner-stopped attestation clears a crash-left mutex, advances the fence, preserves residue", () => {
  const g = buildGrantedRepo(); const s = setup(g);
  const gen = writeGenesisState(s.progOut, s.key, s.expected); writeAnchorFor(s.progOut, s.key, gen, s.expected);
  writeMarker(s.progOut);          // sound genesis + residue marker
  writeReconcileMutex(s.progOut);  // crash-left mutex (generation 0)
  throws(() => gate.assertNoReconcileMutex(s.progOut), /reconciliation mutex is present/i); // gate blocked
  const rep = init.reconcileInspect(s.rargs(), RDEPS(g));
  assert.equal(rep.reconcileMutexPresent, true);
  assert.equal(rep.reconcileMutexValid, true);
  const res = init.reconcileRecover(s.rargs({ fingerprint: rep.fingerprint, confirmReconciliation: init.RECOVER_CONFIRM, confirmOwnerStopped: OWNER_STOPPED }), RDEPS(g));
  assert.equal(res.mutexCleared, true);
  assert.equal(res.fencedFromGeneration, 0);
  assert.equal(res.fencedToGeneration, 1);
  assert.equal(res.residualRecommendation, "marker-only");
  assert.ok(!fs.existsSync(gate.reconcilePath(s.progOut)), "mutex cleared");
  assert.equal(init.currentGeneration(s.progOut), 1, "fence advanced (persistent)");
  assert.ok(fs.existsSync(s.progOut) && fs.existsSync(gate.anchorPath(s.progOut)) && fs.existsSync(gate.initMarkerPath(s.progOut)), "residue preserved");
  gate.assertNoReconcileMutex(s.progOut); // no longer blocked by the mutex
  fs.rmSync(s.dir, { recursive: true, force: true }); fs.rmSync(g.root, { recursive: true, force: true });
});

ok("RECOVER: ELAPSED AGE ALONE never authorizes -- without the Owner-stopped attestation, even an ancient mutex refuses", () => {
  const g = buildGrantedRepo(); const s = setup(g); writeMarker(s.progOut);
  // A mutex with a very old timestamp -- age is NOT proof the owner is dead.
  writeReconcileMutex(s.progOut, { at: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString() });
  const rep = init.reconcileInspect(s.rargs(), RDEPS(g));
  throws(() => init.reconcileRecover(s.rargs({ fingerprint: rep.fingerprint, confirmReconciliation: init.RECOVER_CONFIRM }), RDEPS(g)), /--confirmOwnerStopped prior-cleanup-stopped/);
  assert.ok(fs.existsSync(gate.reconcilePath(s.progOut)), "mutex retained without attestation");
  assert.equal(init.currentGeneration(s.progOut), 0, "fence NOT advanced on refusal");
  fs.rmSync(s.dir, { recursive: true, force: true }); fs.rmSync(g.root, { recursive: true, force: true });
});

ok("RECOVER: a MALFORMED mutex is NOT auto-recovered -- it still requires the Owner-stopped attestation", () => {
  const g = buildGrantedRepo(); const s = setup(g); writeMarker(s.progOut);
  fs.writeFileSync(gate.reconcilePath(s.progOut), JSON.stringify({ version: 9, junk: true })); // malformed / foreign
  const rep = init.reconcileInspect(s.rargs(), RDEPS(g));
  assert.equal(rep.reconcileMutexValid, false);
  // Malformed is NOT proof of an inactive owner: without attestation, refuse.
  throws(() => init.reconcileRecover(s.rargs({ fingerprint: rep.fingerprint, confirmReconciliation: init.RECOVER_CONFIRM }), RDEPS(g)), /--confirmOwnerStopped/);
  assert.ok(fs.existsSync(gate.reconcilePath(s.progOut)), "malformed mutex retained without attestation");
  // With the governed owner-death attestation, recovery proceeds (and still fences).
  const res = init.reconcileRecover(s.rargs({ fingerprint: rep.fingerprint, confirmReconciliation: init.RECOVER_CONFIRM, confirmOwnerStopped: OWNER_STOPPED }), RDEPS(g));
  assert.equal(res.mutexWasValid, false);
  assert.equal(res.fencedToGeneration, 1);
  assert.ok(!fs.existsSync(gate.reconcilePath(s.progOut)), "malformed mutex cleared under attestation");
  fs.rmSync(s.dir, { recursive: true, force: true }); fs.rmSync(g.root, { recursive: true, force: true });
});

ok("RECOVER: requires recover confirmation, Owner-stopped attestation, a real fingerprint, and a present mutex", () => {
  const g = buildGrantedRepo(); const s = setup(g); writeMarker(s.progOut); writeReconcileMutex(s.progOut);
  const rep = init.reconcileInspect(s.rargs(), RDEPS(g));
  throws(() => init.reconcileRecover(s.rargs({ fingerprint: rep.fingerprint, confirmReconciliation: "reconcile-genesis", confirmOwnerStopped: OWNER_STOPPED }), RDEPS(g)), /--confirmReconciliation recover-mutex/);
  throws(() => init.reconcileRecover(s.rargs({ confirmReconciliation: init.RECOVER_CONFIRM, confirmOwnerStopped: OWNER_STOPPED }), RDEPS(g)), /--fingerprint/);
  assert.ok(fs.existsSync(gate.reconcilePath(s.progOut)), "mutex untouched on invalid recover args");
  fs.unlinkSync(gate.reconcilePath(s.progOut));
  throws(() => init.reconcileRecover(s.rargs({ fingerprint: rep.fingerprint, confirmReconciliation: init.RECOVER_CONFIRM, confirmOwnerStopped: OWNER_STOPPED }), RDEPS(g)), /nothing to recover/);
  fs.rmSync(s.dir, { recursive: true, force: true }); fs.rmSync(g.root, { recursive: true, force: true });
});

ok("RECOVER: fingerprint mismatch refuses BEFORE advancing the fence; mutex retained", () => {
  const g = buildGrantedRepo(); const s = setup(g); writeMarker(s.progOut); writeReconcileMutex(s.progOut);
  const rep = init.reconcileInspect(s.rargs(), RDEPS(g));
  writeMarker(s.progOut, crypto.randomBytes(16).toString("hex")); // change a governed artifact after inspection
  throws(() => init.reconcileRecover(s.rargs({ fingerprint: rep.fingerprint, confirmReconciliation: init.RECOVER_CONFIRM, confirmOwnerStopped: OWNER_STOPPED }), RDEPS(g)), /fingerprint mismatch/);
  assert.ok(fs.existsSync(gate.reconcilePath(s.progOut)), "mutex retained on mismatch");
  assert.equal(init.currentGeneration(s.progOut), 0, "fence NOT advanced on refusal");
  fs.rmSync(s.dir, { recursive: true, force: true }); fs.rmSync(g.root, { recursive: true, force: true });
});

ok("RECOVER: two recovery attempts SERIALIZE -- only the one that clears the mutex obtains authority", () => {
  const g = buildGrantedRepo(); const s = setup(g); writeMarker(s.progOut); writeReconcileMutex(s.progOut);
  const rep = init.reconcileInspect(s.rargs(), RDEPS(g));
  const first = init.reconcileRecover(s.rargs({ fingerprint: rep.fingerprint, confirmReconciliation: init.RECOVER_CONFIRM, confirmOwnerStopped: OWNER_STOPPED }), RDEPS(g));
  assert.equal(first.mutexCleared, true);
  // The second attempt finds the mutex already gone -> it did not obtain authority.
  throws(() => init.reconcileRecover(s.rargs({ fingerprint: rep.fingerprint, confirmReconciliation: init.RECOVER_CONFIRM, confirmOwnerStopped: OWNER_STOPPED }), RDEPS(g)), /nothing to recover/);
  fs.rmSync(s.dir, { recursive: true, force: true }); fs.rmSync(g.root, { recursive: true, force: true });
});

// ---- FENCING: a superseded (but still-live) cleanup cannot resume destructive work ----

function runFencedCleanup(g, s, { residue, hookRole, atFinalize } = {}) {
  // Build residue, run inspect, then run a cleanup whose test seam advances the fence
  // mid-flight (simulating a concurrent recovery). The cleanup must abort (fenced).
  const rep = init.reconcileInspect(s.rargs(), RDEPS(g));
  const advanceFence = () => genAdvance(s.progOut, s.key, "recover-test");
  const deps = { ...RDEPS(g) };
  if (hookRole) deps.beforeTargetRecheck = (role) => { if (role === hookRole) advanceFence(); };
  if (atFinalize) deps.beforeFinalize = advanceFence;
  const action = rep.recommendation;
  throws(() => init.reconcileCleanup(s.rargs({ fingerprint: rep.fingerprint, action, confirmReconciliation: CONFIRM }), deps), /fenced by a newer reconciliation generation/);
  return rep;
}

ok("FENCING: a live cleanup superseded BEFORE its first deletion deletes nothing (fenced)", () => {
  const g = buildGrantedRepo(); const s = setup(g); writeMarker(s.progOut); // marker-only residue, clean-reset
  const before = init.perRoleDigests(s.progOut, RDEPS(g));
  runFencedCleanup(g, s, { hookRole: "marker" }); // fence advances right before the (only) deletion
  assert.deepEqual(init.perRoleDigests(s.progOut, RDEPS(g)), before, "nothing deleted after being fenced");
  assert.ok(fs.existsSync(gate.reconcilePath(s.progOut)), "mutex retained (fail-closed)");
  throws(() => gate.assertNoReconcileMutex(s.progOut), /reconciliation mutex is present/i); // gate stays blocked
  fs.rmSync(s.dir, { recursive: true, force: true }); fs.rmSync(g.root, { recursive: true, force: true });
});

ok("FENCING: a live cleanup superseded BETWEEN deletions stops immediately (no further deletion)", () => {
  const g = buildGrantedRepo(); const s = setup(g);
  fs.writeFileSync(s.progOut, '{"version":1,'); // partial state -> clean-reset order [state, marker]
  writeMarker(s.progOut);
  runFencedCleanup(g, s, { hookRole: "marker" }); // state deleted, fence advances before the marker deletion
  assert.ok(!fs.existsSync(s.progOut), "first target (state) deleted");
  assert.ok(fs.existsSync(gate.initMarkerPath(s.progOut)), "marker NOT deleted after being fenced");
  assert.ok(fs.existsSync(gate.reconcilePath(s.progOut)), "mutex retained (fail-closed)");
  fs.rmSync(s.dir, { recursive: true, force: true }); fs.rmSync(g.root, { recursive: true, force: true });
});

ok("FENCING: a live cleanup superseded at FINALIZATION does not remove the mutex (recovery owns supersession)", () => {
  const g = buildGrantedRepo(); const s = setup(g); writeMarker(s.progOut); // marker-only residue
  runFencedCleanup(g, s, { atFinalize: true }); // deletions happen, then fence advances before finalization
  assert.ok(!fs.existsSync(gate.initMarkerPath(s.progOut)), "marker was deleted before the fence advanced");
  assert.ok(fs.existsSync(gate.reconcilePath(s.progOut)), "mutex NOT removed by the superseded cleanup");
  throws(() => gate.assertNoReconcileMutex(s.progOut), /reconciliation mutex is present/i); // gate stays blocked
  fs.rmSync(s.dir, { recursive: true, force: true }); fs.rmSync(g.root, { recursive: true, force: true });
});

ok("FENCING: a malformed generation-ledger claim blocks a cleanup (anomaly -> fail closed, not proceed)", () => {
  const g = buildGrantedRepo(); const s = setup(g); writeMarker(s.progOut);
  const rep = init.reconcileInspect(s.rargs(), RDEPS(g));
  // Drop a malformed generation-claim file (non-integer suffix) before cleanup revalidates.
  const deps = { ...RDEPS(g), beforeTargetRecheck: () => fs.writeFileSync(`${s.progOut}.gen.NOTANINT`, "{}") };
  throws(() => init.reconcileCleanup(s.rargs({ fingerprint: rep.fingerprint, action: "clean-reset", confirmReconciliation: CONFIRM }), deps), /malformed claim/);
  assert.ok(fs.existsSync(gate.initMarkerPath(s.progOut)), "nothing deleted under a ledger anomaly");
  fs.rmSync(s.dir, { recursive: true, force: true }); fs.rmSync(g.root, { recursive: true, force: true });
});

// ---- ADVERSARIAL INTERLEAVINGS (single-winner CAS acquisition + exact-mutex binding) ----

ok("INTERLEAVE: delayed Recovery A (bound to gen 0) cannot advance or touch a replacement mutex M1 after Recovery B + a new cleanup", () => {
  const g = buildGrantedRepo(); const s = setup(g); writeMarker(s.progOut); writeReconcileMutex(s.progOut);
  const rep = init.reconcileInspect(s.rargs(), RDEPS(g)); // A's inspection (gen 0)
  // Between A's generation read and A's CAS: Recovery B advances 0->1 and clears M0; then a
  // NEW cleanup publishes a different mutex M1 (recorded at generation 1).
  const m1token = crypto.randomBytes(16).toString("hex");
  const deps = { ...RDEPS(g), beforeGenerationClaim: () => {
    writeGenClaimDirect(s.progOut, 1, gate.GEN_CHAIN_ROOT, "recover-B"); // out-of-band advance to gen 1 (a real recovery could not -- A holds the fence lock)
    fs.unlinkSync(gate.reconcilePath(s.progOut));           // B clears M0
    writeReconcileMutex(s.progOut, { tok: m1token, generation: 1 }); // new cleanup publishes M1
  } };
  // A resumes: the ledger head advanced since A acquired its fence lock -> A's lock-owned claim is
  // stale and A did NOT obtain authority.
  throws(() => init.reconcileRecover(s.rargs({ fingerprint: rep.fingerprint, confirmReconciliation: init.RECOVER_CONFIRM, confirmOwnerStopped: OWNER_STOPPED }), deps), /stale|ledger head|already advanced/);
  // M1 is untouched and the generation is exactly 1 (A did not leapfrog to 2).
  assert.equal(init.currentGeneration(s.progOut), 1, "A did not advance the generation");
  assert.equal(JSON.parse(fs.readFileSync(gate.reconcilePath(s.progOut), "utf8")).token, m1token, "M1 untouched by A");
  fs.rmSync(s.dir, { recursive: true, force: true }); fs.rmSync(g.root, { recursive: true, force: true });
});

ok("INTERLEAVE: two recoveries read the same generation -> exactly one wins the CAS advance", () => {
  const g = buildGrantedRepo(); const s = setup(g); writeMarker(s.progOut); writeReconcileMutex(s.progOut);
  const rep = init.reconcileInspect(s.rargs(), RDEPS(g));
  const deps = { ...RDEPS(g), beforeGenerationClaim: () => writeGenClaimDirect(s.progOut, 1, gate.GEN_CHAIN_ROOT, "recover-other") };
  throws(() => init.reconcileRecover(s.rargs({ fingerprint: rep.fingerprint, confirmReconciliation: init.RECOVER_CONFIRM, confirmOwnerStopped: OWNER_STOPPED }), deps), /stale|ledger head|already advanced/);
  assert.ok(fs.existsSync(gate.reconcilePath(s.progOut)), "loser removed no mutex");
  fs.rmSync(s.dir, { recursive: true, force: true }); fs.rmSync(g.root, { recursive: true, force: true });
});

ok("INTERLEAVE: mutex replaced with a different valid token immediately before recovery's unlink -> refuse, replacement retained", () => {
  const g = buildGrantedRepo(); const s = setup(g); writeMarker(s.progOut); writeReconcileMutex(s.progOut);
  const rep = init.reconcileInspect(s.rargs(), RDEPS(g));
  const m1token = crypto.randomBytes(16).toString("hex");
  const deps = { ...RDEPS(g), beforeRecoveryUnlink: () => { fs.unlinkSync(gate.reconcilePath(s.progOut)); writeReconcileMutex(s.progOut, { tok: m1token, generation: 1 }); } };
  throws(() => init.reconcileRecover(s.rargs({ fingerprint: rep.fingerprint, confirmReconciliation: init.RECOVER_CONFIRM, confirmOwnerStopped: OWNER_STOPPED }), deps), /replaced during recovery/);
  assert.equal(JSON.parse(fs.readFileSync(gate.reconcilePath(s.progOut), "utf8")).token, m1token, "replacement mutex NOT removed");
  fs.rmSync(s.dir, { recursive: true, force: true }); fs.rmSync(g.root, { recursive: true, force: true });
});

ok("INTERLEAVE: mutex disappears immediately before recovery's unlink -> refuse (fail-closed; generation already fenced)", () => {
  const g = buildGrantedRepo(); const s = setup(g); writeMarker(s.progOut); writeReconcileMutex(s.progOut);
  const rep = init.reconcileInspect(s.rargs(), RDEPS(g));
  const deps = { ...RDEPS(g), beforeRecoveryUnlink: () => fs.unlinkSync(gate.reconcilePath(s.progOut)) };
  throws(() => init.reconcileRecover(s.rargs({ fingerprint: rep.fingerprint, confirmReconciliation: init.RECOVER_CONFIRM, confirmOwnerStopped: OWNER_STOPPED }), deps), /disappeared during recovery/);
  fs.rmSync(s.dir, { recursive: true, force: true }); fs.rmSync(g.root, { recursive: true, force: true });
});

ok("INTERLEAVE: no new cleanup can begin inside the recovery critical section (the mutex it will remove is still present)", () => {
  const g = buildGrantedRepo(); const s = setup(g); writeMarker(s.progOut); writeReconcileMutex(s.progOut);
  const rep = init.reconcileInspect(s.rargs(), RDEPS(g));
  let cleanupOutcome = "not-run";
  const deps = { ...RDEPS(g), beforeRecoveryUnlink: () => {
    // Simulate a new cleanup trying to start mid-recovery: the mutex is still present -> refuse.
    try { init.reconcileCleanup(s.rargs({ fingerprint: rep.fingerprint, action: "clean-reset", confirmReconciliation: CONFIRM }), RDEPS(g)); cleanupOutcome = "started"; }
    catch (e) { cleanupOutcome = /already present/.test(e.message) ? "refused-present" : `other:${e.message}`; }
  } };
  const res = init.reconcileRecover(s.rargs({ fingerprint: rep.fingerprint, confirmReconciliation: init.RECOVER_CONFIRM, confirmOwnerStopped: OWNER_STOPPED }), deps);
  assert.equal(res.mutexCleared, true);
  assert.equal(cleanupOutcome, "refused-present", "a new cleanup could not begin during the recovery critical section");
  fs.rmSync(s.dir, { recursive: true, force: true }); fs.rmSync(g.root, { recursive: true, force: true });
});

ok("BOUNDARY (documented guarantee): supersession AFTER a cleanup's ownership check but before its unlink -- digest binding forbids deleting a REPLACED artifact", () => {
  // 7b: the target is replaced (newer bytes) in the post-check window -> the digest recheck
  // (immediately before unlink) aborts. A superseded cleanup can NEVER delete a newer/
  // replacement artifact; the generation fence is defense in depth, the digest binding is
  // the hard guarantee, and the Owner-stopped attestation is the primary operational exclusion.
  const g = buildGrantedRepo(); const s = setup(g); writeMarker(s.progOut);
  const rep = init.reconcileInspect(s.rargs(), RDEPS(g));
  const deps = { ...RDEPS(g), afterOwnerCheck: (role) => { if (role === "marker") writeMarker(s.progOut, crypto.randomBytes(16).toString("hex")); } };
  throws(() => init.reconcileCleanup(s.rargs({ fingerprint: rep.fingerprint, action: "clean-reset", confirmReconciliation: CONFIRM }), deps), /changed between inspection and deletion/);
  assert.ok(fs.existsSync(gate.initMarkerPath(s.progOut)), "the replaced (newer) marker was NOT deleted");
  fs.rmSync(s.dir, { recursive: true, force: true }); fs.rmSync(g.root, { recursive: true, force: true });
});

ok("BOUNDARY (documented guarantee): supersession AFTER the ownership check with an UNCHANGED target -- the exact inspected artifact may be removed in the residual window, then the cleanup fails closed at the next checkpoint", () => {
  // 7a: the fence advances AFTER the marker's ownership check but the target is byte-identical
  // to what was inspected -> the digest recheck (immediately before unlink) passes and this one
  // already-inspected target is removed. That is the precise, documented residual window: only
  // the exact inspected artifact, never a newer one. The cleanup then re-checks ownership at
  // finalization, detects the advanced generation, and FAILS CLOSED (mutex retained). In
  // production the Owner-stopped attestation is what excludes a live owner from reaching here.
  const g = buildGrantedRepo(); const s = setup(g); writeMarker(s.progOut);
  const deps = { ...RDEPS(g), afterOwnerCheck: (role) => { if (role === "marker") genAdvance(s.progOut, s.key, "recover-race"); } };
  const rep = init.reconcileInspect(s.rargs(), RDEPS(g));
  throws(() => init.reconcileCleanup(s.rargs({ fingerprint: rep.fingerprint, action: "clean-reset", confirmReconciliation: CONFIRM }), deps), /fenced by a newer reconciliation generation/);
  assert.ok(!fs.existsSync(gate.initMarkerPath(s.progOut)), "the exact inspected marker was removed in the residual window");
  assert.ok(fs.existsSync(gate.reconcilePath(s.progOut)), "cleanup then failed closed at finalization; mutex retained");
  fs.rmSync(s.dir, { recursive: true, force: true }); fs.rmSync(g.root, { recursive: true, force: true });
});

ok("RECOVER end-to-end: partial cleanup strands a mutex; attested recovery fences + clears; normal cleanup then completes (marker-last self-heal)", () => {
  const g = buildGrantedRepo(); const s = setup(g);
  fs.writeFileSync(s.progOut, '{"version":1,'); // partial state -> clean-reset (state, then marker LAST)
  writeMarker(s.progOut);
  const rep0 = init.reconcileInspect(s.rargs(), RDEPS(g));
  const markerPath = gate.initMarkerPath(s.progOut);
  const dfs = { ...fs, unlinkSync: (p, ...r) => { if (typeof p === "string" && p === markerPath) throw new Error("injected unlink failure"); return fs.unlinkSync(p, ...r); } };
  throws(() => init.reconcileCleanup(s.rargs({ fingerprint: rep0.fingerprint, action: "clean-reset", confirmReconciliation: CONFIRM }), { ...RDEPS(g), fs: dfs }), /injected unlink failure/);
  assert.ok(!fs.existsSync(s.progOut) && fs.existsSync(markerPath) && fs.existsSync(gate.reconcilePath(s.progOut)), "partial: state gone; marker + mutex retained");
  throws(() => gate.assertNoReconcileMutex(s.progOut), /reconciliation mutex is present/i); // gate blocked
  // Attested recovery advances the fence + clears the mutex; the surviving marker keeps the residue reconcilable.
  const insp = init.reconcileInspect(s.rargs(), RDEPS(g));
  const rec = init.reconcileRecover(s.rargs({ fingerprint: insp.fingerprint, confirmReconciliation: init.RECOVER_CONFIRM, confirmOwnerStopped: OWNER_STOPPED }), RDEPS(g));
  assert.equal(rec.mutexCleared, true);
  assert.equal(rec.residualRecommendation, "clean-reset");
  assert.equal(init.currentGeneration(s.progOut), 1, "fence advanced by recovery");
  // A normal re-run now completes (its mutex records generation 1; it is not fenced).
  const rep1 = init.reconcileInspect(s.rargs(), RDEPS(g));
  const res = init.reconcileCleanup(s.rargs({ fingerprint: rep1.fingerprint, action: "clean-reset", confirmReconciliation: CONFIRM }), RDEPS(g));
  assert.deepEqual(res.removedRoles, ["marker"]);
  assert.equal(res.artifactsRemaining.length, 0);
  assert.ok(!fs.existsSync(gate.reconcilePath(s.progOut)), "no residue mutex");
  fs.rmSync(s.dir, { recursive: true, force: true }); fs.rmSync(g.root, { recursive: true, force: true });
});

ok("RECONCILE: cleanup requires confirmation, a real fingerprint, and a valid action (nothing removed otherwise)", () => {
  const g = buildGrantedRepo(); const s = setup(g); writeMarker(s.progOut);
  const rep = init.reconcileInspect(s.rargs(), RDEPS(g));
  throws(() => init.reconcileCleanup(s.rargs({ fingerprint: rep.fingerprint, action: "clean-reset" }), RDEPS(g)), /--confirmReconciliation reconcile-genesis/);
  throws(() => init.reconcileCleanup(s.rargs({ action: "clean-reset", confirmReconciliation: CONFIRM }), RDEPS(g)), /--fingerprint/);
  throws(() => init.reconcileCleanup(s.rargs({ fingerprint: rep.fingerprint, action: "bogus", confirmReconciliation: CONFIRM }), RDEPS(g)), /--action must be/);
  assert.ok(fs.existsSync(gate.initMarkerPath(s.progOut)), "nothing removed on invalid cleanup args");
  fs.rmSync(s.dir, { recursive: true, force: true }); fs.rmSync(g.root, { recursive: true, force: true });
});

ok("RECONCILE: cleanup confinement -> only derived artifact paths are removed; sibling files untouched", () => {
  const g = buildGrantedRepo(); const s = setup(g); writeMarker(s.progOut);
  const sibling = path.join(s.dir, "UNRELATED.txt"); fs.writeFileSync(sibling, "keep me");
  const rep = init.reconcileInspect(s.rargs(), RDEPS(g));
  init.reconcileCleanup(s.rargs({ fingerprint: rep.fingerprint, action: "clean-reset", confirmReconciliation: CONFIRM }), RDEPS(g));
  assert.ok(fs.existsSync(sibling) && fs.readFileSync(sibling, "utf8") === "keep me", "sibling file untouched");
  fs.rmSync(s.dir, { recursive: true, force: true }); fs.rmSync(g.root, { recursive: true, force: true });
});

ok("RECONCILE: no marker present -> reconciliationNeeded=false; cleanup refuses (nothing to reconcile)", () => {
  const g = buildGrantedRepo(); const s = setup(g);
  const gen = writeGenesisState(s.progOut, s.key, s.expected); writeAnchorFor(s.progOut, s.key, gen, s.expected);
  const rep = init.reconcileInspect(s.rargs(), RDEPS(g));
  assert.equal(rep.reconciliationNeeded, false);
  assert.equal(rep.recommendation, "none");
  throws(() => init.reconcileCleanup(s.rargs({ fingerprint: rep.fingerprint, action: "clean-reset", confirmReconciliation: CONFIRM }), RDEPS(g)), /nothing to reconcile/);
  fs.rmSync(s.dir, { recursive: true, force: true }); fs.rmSync(g.root, { recursive: true, force: true });
});

ok("SECRET OUTPUT (CLI, SPACED PATHS): protected paths containing spaces are fully redacted", () => {
  const g = buildGrantedRepo();
  const scriptInRepo = path.join(g.root, "functions/scripts/authPr4InitProgression.js");
  const io = fs.mkdtempSync(path.join(os.tmpdir(), "authpr4 space-"));
  const spaced = path.join(io, "Secure Folder"); fs.mkdirSync(spaced);
  const keyFile = path.join(spaced, "state key.key"); fs.writeFileSync(keyFile, crypto.randomBytes(48), { mode: 0o600 });
  const progOut = path.join(spaced, "progression file.json");
  const args = (over) => [scriptInRepo, "--projectId", PROD, "--confirmProduction", PROD, "--authorizedCommit", g.authorizedCommit, "--executionModeConfirmation", g.executionModeToken, "--executor", g.executor, "--stateKeyFile", over.keyFile ?? keyFile, "--progressionOut", over.progOut ?? progOut];
  const segs = (extra) => ["Secure Folder", "state key.key", "progression file.json", keyFile, progOut, io, ...extra];
  // SUCCESS with spaced paths.
  const stdout = execFileSync("node", args({}), { cwd: g.root, encoding: "utf8" });
  assert.match(stdout, /GENESIS initialised/);
  for (const seg of segs([])) assert.ok(!stdout.includes(seg), `stdout leaks "${seg}"`);
  // FAILURE whose raw error embeds a spaced protected path (missing key in a spaced dir).
  const io2 = fs.mkdtempSync(path.join(os.tmpdir(), "authpr4 space2-"));
  const badKey = path.join(io2, "No Such Folder", "missing key.key"); // dir intentionally absent
  const prog2 = path.join(io2, "p file.json");
  let combined = "";
  try { execFileSync("node", args({ keyFile: badKey, progOut: prog2 }), { cwd: g.root, encoding: "utf8" }); assert.fail("should have failed"); }
  catch (e) { combined = String(e.stdout || "") + String(e.stderr || ""); }
  assert.match(combined, /Failed:/);
  for (const seg of ["No Such Folder", "missing key.key", "p file.json", badKey, prog2, io2]) assert.ok(!combined.includes(seg), `stderr leaks "${seg}"`);
  fs.rmSync(io, { recursive: true, force: true }); fs.rmSync(io2, { recursive: true, force: true }); fs.rmSync(g.root, { recursive: true, force: true });
});

// ---- GENERATION LEDGER (gate-owned authority: content + contiguity + hash chain) --------

function claimObj(n, previousDigest, over = {}) {
  return { version: gate.GEN_LEDGER_VERSION, generation: n, previousDigest, owner: "recover-x", at: new Date().toISOString(), ...over };
}
function writeClaim(prog, n, obj) { fs.writeFileSync(gate.genClaimPath(prog, n), typeof obj === "string" ? obj : JSON.stringify(obj)); }

ok("LEDGER: a valid contiguous hash-chained ledger is accepted; currentGeneration = highest (initializer + gate agree)", () => {
  const dir = tmp(); const prog = path.join(dir, "progression.json"); const key = crypto.randomBytes(48);
  genAdvance(prog, key, "recover-a");
  genAdvance(prog, key, "recover-b");
  genAdvance(prog, key, "recover-c");
  assert.equal(gate.readGenerationLedger(prog), 3);
  assert.equal(init.currentGeneration(prog), 3);
  fs.rmSync(dir, { recursive: true, force: true });
});

ok("LEDGER: authority is CONTENT, not filename -- empty / malformed / wrong-version / gen-mismatch / bad-owner / bad-at / extra / missing all fail closed", () => {
  const bad = [
    "",                                                                    // empty bytes
    "{ not json",                                                          // malformed JSON
    JSON.stringify(claimObj(1, gate.GEN_CHAIN_ROOT, { version: 2 })),      // wrong version
    JSON.stringify(claimObj(1, gate.GEN_CHAIN_ROOT, { generation: 2 })),   // embedded gen != filename
    JSON.stringify(claimObj(1, "not-a-sha256")),                           // invalid previousDigest
    JSON.stringify(claimObj(1, gate.GEN_CHAIN_ROOT, { owner: "x".repeat(200) })), // owner too long
    JSON.stringify(claimObj(1, gate.GEN_CHAIN_ROOT, { at: "not-a-date" })),// invalid timestamp
    JSON.stringify(claimObj(1, gate.GEN_CHAIN_ROOT, { extra: 1 })),        // extra field
    JSON.stringify({ version: 1, generation: 1, previousDigest: gate.GEN_CHAIN_ROOT, at: new Date().toISOString() }), // missing owner
  ];
  for (const c of bad) {
    const dir = tmp(); const prog = path.join(dir, "progression.json");
    writeClaim(prog, 1, c);
    throws(() => gate.readGenerationLedger(prog), /malformed|invalid content|breaks the hash chain/i);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

ok("LEDGER: a malformed CLAIM NAME (non-integer suffix) fails closed", () => {
  const dir = tmp(); const prog = path.join(dir, "progression.json");
  fs.writeFileSync(`${prog}.gen.NOTANINT`, "{}");
  throws(() => gate.readGenerationLedger(prog), /malformed claim name/);
  fs.rmSync(dir, { recursive: true, force: true });
});

ok("LEDGER: gaps / missing-middle / foreign-high-number / chain-break / middle-recreation all fail closed", () => {
  // gen.2 without gen.1
  { const dir = tmp(); const prog = path.join(dir, "p.json"); writeClaim(prog, 2, claimObj(2, gate.GEN_CHAIN_ROOT)); throws(() => gate.readGenerationLedger(prog), /contiguous \(missing generation 1\)/); fs.rmSync(dir, { recursive: true, force: true }); }
  // missing middle: gen.1 + gen.3 (no gen.2)
  { const dir = tmp(); const prog = path.join(dir, "p.json"); const key = crypto.randomBytes(48); genAdvance(prog, key, "o"); writeClaim(prog, 3, claimObj(3, gate.GEN_CHAIN_ROOT)); throws(() => gate.readGenerationLedger(prog), /contiguous \(missing generation 2\)/); fs.rmSync(dir, { recursive: true, force: true }); }
  // foreign high-number claim jumps the ledger (valid 1..2, foreign gen.9)
  { const dir = tmp(); const prog = path.join(dir, "p.json"); const key = crypto.randomBytes(48); genAdvance(prog, key, "o"); genAdvance(prog, key, "o"); writeClaim(prog, 9, claimObj(9, gate.GEN_CHAIN_ROOT)); throws(() => gate.readGenerationLedger(prog), /contiguous \(missing generation 3\)/); fs.rmSync(dir, { recursive: true, force: true }); }
  // chain break: gen.2.previousDigest does not match gen.1's content digest
  { const dir = tmp(); const prog = path.join(dir, "p.json"); const key = crypto.randomBytes(48); genAdvance(prog, key, "o"); writeClaim(prog, 2, claimObj(2, gate.GEN_CHAIN_ROOT)); throws(() => gate.readGenerationLedger(prog), /claim 2 breaks the hash chain/); fs.rmSync(dir, { recursive: true, force: true }); }
  // recreation of a consumed MIDDLE generation with different content breaks the successor's chain
  { const dir = tmp(); const prog = path.join(dir, "p.json"); const key = crypto.randomBytes(48); genAdvance(prog, key, "o"); genAdvance(prog, key, "o");
    fs.unlinkSync(gate.genClaimPath(prog, 1)); writeClaim(prog, 1, claimObj(1, gate.GEN_CHAIN_ROOT, { owner: "different" })); // recreate gen.1 with different content
    throws(() => gate.readGenerationLedger(prog), /claim 2 breaks the hash chain/); fs.rmSync(dir, { recursive: true, force: true }); }
});

ok("LEDGER: staging temp files are OUTSIDE the ledger namespace and never poison the scan (in-progress / crash-left publication)", () => {
  const dir = tmp(); const prog = path.join(dir, "progression.json"); const key = crypto.randomBytes(48);
  genAdvance(prog, key, "o");
  fs.writeFileSync(`${prog}.genstage-abc123`, "partial in-progress bytes");       // crash-left staging temp (outside `.gen.` namespace)
  assert.ok(!`${path.basename(prog)}.genstage-abc123`.startsWith(`${path.basename(prog)}.gen.`), "staging name is outside the ledger namespace");
  assert.equal(gate.readGenerationLedger(prog), 1, "staging temp ignored; ledger still valid");
  // A subsequent real claim still publishes and validates.
  genAdvance(prog, key, "o");
  assert.equal(gate.readGenerationLedger(prog), 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

ok("LEDGER: crash after staging but before link leaves an inert temp; the generation is unclaimed and re-claimable", () => {
  const dir = tmp(); const prog = path.join(dir, "progression.json"); const key = crypto.randomBytes(48);
  const l = init.acquireFenceLock(prog, "generation-advance", key, {}); // held (normal fs) so the gen-claim link is what crashes
  // fs whose linkSync throws (simulate crash between stage-write and link) for the gen.1 target.
  const dfs = { ...fs, linkSync: (a, b, ...r) => { if (typeof b === "string" && b === gate.genClaimPath(prog, 1)) throw new Error("injected link crash"); return fs.linkSync(a, b, ...r); } };
  throws(() => init.claimGeneration(prog, 1, "o", { fs: dfs, stateKey: key, fenceToken: l.token }), /Failed to publish a generation claim|injected link crash/);
  init.releaseFenceLock(prog, l.token, {});
  assert.equal(gate.readGenerationLedger(prog), 0, "generation 1 was never claimed");
  genAdvance(prog, key, "o"); // re-claimable
  assert.equal(gate.readGenerationLedger(prog), 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

ok("LEDGER: directory-read failures FAIL CLOSED -- only ENOENT (absent dir) is a clean-start zero", () => {
  const dir = tmp(); const prog = path.join(dir, "progression.json");
  // (a) legitimate empty existing directory -> generation 0.
  assert.equal(gate.readGenerationLedger(prog), 0, "empty existing dir -> 0");
  // (b) accepted clean-start: containing directory absent (ENOENT) -> 0.
  const goneProg = path.join(dir, "no-such-subdir", "progression.json");
  assert.equal(gate.readGenerationLedger(goneProg), 0, "absent dir (ENOENT) -> 0");
  // (c) EACCES / EPERM / generic I/O readdir failures -> throw (never fail open as 0).
  const err = (code) => { const e = new Error(code); e.code = code; return e; };
  for (const code of ["EACCES", "EPERM", "EIO", "SOMETHINGELSE"]) {
    const dfs = { ...fs, readdirSync: () => { throw err(code); } };
    throws(() => gate.readGenerationLedger("D:/protected/secure/progression.json", { fs: dfs }), /ledger directory could not be read/);
    // The sanitized error must not leak the protected path.
    let msg = ""; try { gate.readGenerationLedger("D:/protected/secure/progression.json", { fs: dfs }); } catch (e) { msg = e.message; }
    assert.ok(!msg.includes("protected") && !msg.includes("secure") && !msg.includes(code), `no protected path/code in error for ${code}`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

ok("LEDGER: a directory-read failure blocks assertProductionAuthorization BEFORE any progression claim / Auth access", () => {
  const g = buildGrantedRepo(); const s = setup(g);
  const gen = writeGenesisState(s.progOut, s.key, s.expected); writeAnchorFor(s.progOut, s.key, gen, s.expected);
  // A gate call that would otherwise proceed; inject an EACCES on the ledger directory read.
  const dfs = { ...fs, readdirSync: (p, ...r) => { if (typeof p === "string" && p === path.dirname(s.progOut)) { const e = new Error("EACCES"); e.code = "EACCES"; throw e; } return fs.readdirSync(p, ...r); } };
  const args = { projectId: PROD, executeProduction: true, mappingFile: path.join(s.dir, "map.json"), progressionFile: s.progOut, stateKeyFile: s.keyFile, authorizedCommit: g.authorizedCommit, executionModeConfirmation: g.executionModeToken, executor: g.executor, capturedStateOut: path.join(s.dir, "c.json") };
  fs.writeFileSync(args.mappingFile, JSON.stringify({ "emp-rudy-driver": { uid: "u1", newAlias: "base+driver@gmail.com" } }));
  throws(() => gate.assertProductionAuthorization(args, { repoRoot: g.root, personaOrder: ORDER, now: () => new Date(), leaseSeconds: 1, fs: dfs }), /ledger directory could not be read/);
  assert.ok(!fs.existsSync(gate.lockPath(s.progOut)), "no progression claim was taken");
  fs.rmSync(s.dir, { recursive: true, force: true }); fs.rmSync(g.root, { recursive: true, force: true });
});

ok("LEDGER REGRESSION: an in-flight cleanup whose recorded generation exceeds the current ledger fails closed", () => {
  const g = buildGrantedRepo(); const s = setup(g);
  genAdvance(s.progOut, s.key, "o"); // ledger at generation 1
  writeMarker(s.progOut);
  const rep = init.reconcileInspect(s.rargs(), RDEPS(g));
  // The cleanup starts at myGen=1; a regression (top claim deleted) drops the ledger to 0.
  const deps = { ...RDEPS(g), beforeTargetRecheck: () => fs.unlinkSync(gate.genClaimPath(s.progOut, 1)) };
  throws(() => init.reconcileCleanup(s.rargs({ fingerprint: rep.fingerprint, action: "clean-reset", confirmReconciliation: CONFIRM }), deps), /fenced by a newer reconciliation generation/);
  assert.ok(fs.existsSync(gate.initMarkerPath(s.progOut)), "nothing deleted under a ledger regression");
  fs.rmSync(s.dir, { recursive: true, force: true }); fs.rmSync(g.root, { recursive: true, force: true });
});

ok("LOCK-OWNED claimGeneration: refuses without a held fence lock, and for a wrong-holder / wrong-token / malformed / stale-generation lock", () => {
  const dir = tmp(); const prog = path.join(dir, "progression.json"); const key = crypto.randomBytes(48);
  // No fence lock present at all -> readFenceLock fails closed.
  throws(() => init.claimGeneration(prog, 1, "o", { stateKey: key, fenceToken: "ab".repeat(16) }), /Fence lock missing|malformed/i);
  const l = init.acquireFenceLock(prog, "generation-advance", key, {});
  // Missing token / missing state key -> refuse (lock-owned).
  throws(() => init.claimGeneration(prog, 1, "o", { stateKey: key }), /fence-lock token|lock-owned/i);
  throws(() => init.claimGeneration(prog, 1, "o", { fenceToken: l.token }), /stateKey|lock-owned/i);
  // Wrong token -> refuse.
  throws(() => init.claimGeneration(prog, 1, "o", { stateKey: key, fenceToken: "cd".repeat(16) }), /different token/);
  init.releaseFenceLock(prog, l.token, {});
  // Wrong HOLDER (an identity-transition lock cannot authorize a generation claim) -> refuse.
  const lt = init.acquireFenceLock(prog, "identity-transition", key, {});
  throws(() => init.claimGeneration(prog, 1, "o", { stateKey: key, fenceToken: lt.token }), /not a generation-advance lock|holder/);
  init.releaseFenceLock(prog, lt.token, {});
  // Malformed / foreign lock -> fail closed at signature/schema.
  fs.writeFileSync(gate.fenceLockPath(prog), '{"not":"a-lock"}');
  throws(() => init.claimGeneration(prog, 1, "o", { stateKey: key, fenceToken: "ab".repeat(16) }), /malformed|schema|integrity/i);
  fs.unlinkSync(gate.fenceLockPath(prog));
  // STALE captured generation/head: acquire at gen 0, advance the ledger head out-of-band, then the
  // held lock's captured generation no longer equals the current validated head -> refuse.
  const l0 = init.acquireFenceLock(prog, "generation-advance", key, {}); // records gen 0
  writeGenClaimDirect(prog, 1, gate.GEN_CHAIN_ROOT, "out-of-band");
  throws(() => init.claimGeneration(prog, 2, "o", { stateKey: key, fenceToken: l0.token }), /stale|captured generation|ledger head/);
  init.releaseFenceLock(prog, l0.token, {});
  fs.rmSync(dir, { recursive: true, force: true });
});

ok("CALL-GRAPH GUARD: the only production claimGeneration call site threads a fence-lock token (no lock-free generation publication)", () => {
  const src = fs.readFileSync(SCRIPT, "utf8");
  assert.equal((src.match(/function claimGeneration\(/g) || []).length, 1, "single definition");
  // Count invocations WITH arguments (`claimGeneration(<arg>`), which excludes prose mentions
  // written as `claimGeneration()`; subtract the one definition to get real call sites.
  const total = (src.match(/claimGeneration\([^)]/g) || []).length;
  const defs = (src.match(/function claimGeneration\(/g) || []).length;
  assert.equal(total - defs, 1, "exactly one production call site (reconcile-recover)");
  assert.match(src, /claimGeneration\(args\.progressionOut, fromGen \+ 1,[\s\S]{0,180}fenceToken: fence\.token/, "the call site threads the held fence-lock token");
});

ok("CREDENTIAL-FREE: the initializer performs no Firebase initialization", () => {
  const src = fs.readFileSync(SCRIPT, "utf8");
  assert.doesNotMatch(src, /initializeApp|getAuth|firebase-admin/);
});

console.log(`\n${passed} passed`);
process.exit(0);
