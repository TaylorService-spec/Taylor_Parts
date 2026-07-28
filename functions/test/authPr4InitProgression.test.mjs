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
const RDEPS = (g) => ({ repoRoot: g.root, personaOrder: ORDER });
const CONFIRM = init.RECONCILE_CONFIRM;

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
  fs.writeFileSync(s.progOut, '{"version":1,'); // truncated partial state -> clean-reset targets marker+state
  writeMarker(s.progOut);
  const rep = init.reconcileInspect(s.rargs(), RDEPS(g));
  assert.equal(rep.recommendation, "clean-reset");
  // After marker (first) is deleted, replace the state's bytes just before its recheck.
  const hook = (role) => { if (role === "state") fs.writeFileSync(s.progOut, '{"version":1,"x":2'); };
  throws(() => init.reconcileCleanup(s.rargs({ fingerprint: rep.fingerprint, action: "clean-reset", confirmReconciliation: CONFIRM }), { ...RDEPS(g), beforeTargetRecheck: hook }), /changed between inspection and deletion/);
  assert.ok(!fs.existsSync(gate.initMarkerPath(s.progOut)), "first target (marker) was deleted");
  assert.ok(fs.existsSync(s.progOut), "second target (state) NOT deleted (recheck caught the change)");
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
  fs.writeFileSync(s.progOut, '{"version":1,'); // partial state -> clean-reset marker+state
  writeMarker(s.progOut);
  const rep = init.reconcileInspect(s.rargs(), RDEPS(g));
  // fs whose unlinkSync fails for the STATE path (second target) only.
  const dfs = { ...fs, unlinkSync: (p, ...r) => { if (typeof p === "string" && p === s.progOut) throw new Error("injected unlink failure"); return fs.unlinkSync(p, ...r); } };
  throws(() => init.reconcileCleanup(s.rargs({ fingerprint: rep.fingerprint, action: "clean-reset", confirmReconciliation: CONFIRM }), { ...RDEPS(g), fs: dfs }), /injected unlink failure/);
  assert.ok(!fs.existsSync(gate.initMarkerPath(s.progOut)), "first target removed");
  assert.ok(fs.existsSync(s.progOut), "state not removed (unlink failed)");
  assert.ok(fs.existsSync(gate.reconcilePath(s.progOut)), "mutex RETAINED (fail-closed)");
  fs.rmSync(s.dir, { recursive: true, force: true }); fs.rmSync(g.root, { recursive: true, force: true });
});

ok("RECONCILE TOCTOU: a foreign reconciliation mutex at finalization is NOT removed (owner-bound)", () => {
  const g = buildGrantedRepo(); const s = setup(g); writeMarker(s.progOut);
  const rep = init.reconcileInspect(s.rargs(), RDEPS(g));
  // fs whose reconcile-mutex read at finalization returns a FOREIGN token (simulated takeover),
  // while all other reads/writes are real. Deletions still occur; finalization must refuse.
  const reconFile = gate.reconcilePath(s.progOut);
  const dfs = { ...fs, readFileSync: (p, ...r) => (typeof p === "string" && p === reconFile ? JSON.stringify({ version: gate.RECONCILE_MUTEX_VERSION, token: "ff".repeat(16), at: new Date().toISOString() }) : fs.readFileSync(p, ...r)) };
  throws(() => init.reconcileCleanup(s.rargs({ fingerprint: rep.fingerprint, action: "clean-reset", confirmReconciliation: CONFIRM }), { ...RDEPS(g), fs: dfs }), /owned by another attempt at finalization/);
  assert.ok(fs.existsSync(reconFile), "foreign-owned mutex left in place");
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

ok("CREDENTIAL-FREE: the initializer performs no Firebase initialization", () => {
  const src = fs.readFileSync(SCRIPT, "utf8");
  assert.doesNotMatch(src, /initializeApp|getAuth|firebase-admin/);
});

console.log(`\n${passed} passed`);
process.exit(0);
