// AUTH-PR-4 -- tests for the security-hardened production-enablement gate
// (functions/scripts/authPr4ProductionGate.js).
//
// The authorization AUTHORITY is a COMMITTED, git-tracked artifact read from git
// at the authorized commit. The real committed artifact is PENDING, so the real
// repo always refuses (a negative test). The GRANTED path is exercised via a
// throwaway temporary git repo containing a GRANTED fixture + copies of the
// governed files (so on-disk hashes match). The real `taylor-parts` project is
// never targeted; every emulator init uses a demo-* project.
//
// Run (pure):     node test/authPr4ProductionGate.test.mjs
// Run (emulator): firebase emulators:exec --only auth --project demo-authpr4 \
//                   "node test/authPr4ProductionGate.test.mjs"

import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const gate = require("../scripts/authPr4ProductionGate.js");
const wf = require("../scripts/authPr4RecoveryEmailMigration.js");

const ORDER = [
  "emp-rudy-driver", "emp-rudy-parts-associate", "emp-rudy-warehouse-manager",
  "emp-rudy-parts-manager", "emp-rudy-owner",
];

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }
async function okAsync(name, fn) { await fn(); passed += 1; console.log("PASS -- " + name); }
function throws(fn, re) { assert.throws(fn, re); }

const REAL_ROOT = gate.resolveRepoRoot();
const KEY = () => crypto.randomBytes(48);

// Build a throwaway git repo with a GRANTED authorization + governed-file copies.
// mutateArtifact(a) can tweak the artifact for negative cases.
function buildGrantedRepo(projectId, mutateArtifact) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "authpr4-repo-"));
  execFileSync("git", ["-C", root, "init", "-q"]);
  execFileSync("git", ["-C", root, "config", "user.email", "t@example.com"]);
  execFileSync("git", ["-C", root, "config", "user.name", "t"]);
  for (const rel of gate.GOVERNED_FILES) {
    const bytes = fs.readFileSync(path.join(REAL_ROOT, rel));
    fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), bytes);
  }
  execFileSync("git", ["-C", root, "add", "-A"]);
  execFileSync("git", ["-C", root, "commit", "-q", "-m", "governed files"]);
  const reviewedHead = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  // Record BLOB-based hashes (deterministic, EOL-independent), matching what the gate derives.
  const hashes = gate.governedHashesAtCommit(root, reviewedHead);
  let artifact = {
    schema: gate.AUTH_SCHEMA, authorizationId: "AUTHPR4-PROD-TEST", authorizationStatus: "GRANTED",
    projectId, personaOrder: ORDER, reviewedHead, governedFileHashes: hashes,
    executionModeToken: "EMT-TOKEN", executor: { name: "named-exec" },
    breakGlassContract: { validityWindowSeconds: 600, requiredConfirmer: "named-confirmer" },
  };
  if (mutateArtifact) artifact = mutateArtifact(artifact) || artifact;
  fs.mkdirSync(path.join(root, "functions", "authpr4"), { recursive: true });
  fs.writeFileSync(path.join(root, gate.AUTH_ARTIFACT_PATH), JSON.stringify(artifact, null, 2));
  execFileSync("git", ["-C", root, "add", "-A"]);
  execFileSync("git", ["-C", root, "commit", "-q", "-m", "authorization"]);
  const authorizedCommit = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  return { root, authorizedCommit, reviewedHead, executionModeToken: "EMT-TOKEN", executor: "named-exec", requiredConfirmer: "named-confirmer", windowSeconds: 600, hashes };
}

function writeGenesis(stateFile, key, { authorizationId, projectId, idHash, completed = [], status = "eligible" }) {
  let s = gate.genesisState({ authorizationId, projectId, workflowIdentityHash: idHash, personaOrder: ORDER });
  s = { ...s, completed, status };
  fs.writeFileSync(stateFile, JSON.stringify({ ...s, signature: gate.signProgression(s, key) }), { mode: 0o600 });
  gate.writeAnchor(stateFile, { authorizationId, highWaterRevision: s.revision, stateHash: gate.progressionHash(s) }, key);
  return s;
}

// ---------------------------------------------------------------------------
// 1. PURE TESTS -- validation primitives (C4)
// ---------------------------------------------------------------------------

ok("strict validators reject non-canonical values", () => {
  assert.equal(gate.isFullSha("a".repeat(40)), true);
  assert.equal(gate.isFullSha("A".repeat(40)), false); // uppercase
  assert.equal(gate.isFullSha("a".repeat(39)), false);
  assert.equal(gate.isSha256("b".repeat(64)), true);
  assert.equal(gate.isSha256("b".repeat(63)), false);
  assert.equal(gate.isCanonicalAuthId("AUTHPR4-PROD-0001"), true);
  assert.equal(gate.isCanonicalAuthId("lower-case"), false);
  assert.equal(gate.isUtcInstant("2026-07-27T10:00:00Z"), true);
  assert.equal(gate.isUtcInstant("2026-07-27 10:00:00"), false);
  assert.equal(gate.isBoundedInt(5, 1, 10), true);
  assert.equal(gate.isBoundedInt(0, 1, 10), false);
  throws(() => gate.assertExactShape({ a: 1, b: 2, c: 3 }, ["a", "b"], "x"), /schema mismatch/);
});

// ---------------------------------------------------------------------------
// 2. C1 -- repository-governed authorization artifact
// ---------------------------------------------------------------------------

ok("REAL repo authorization artifact is PENDING -> refused (fail closed)", () => {
  const head = gate.deriveRepositoryIdentity(REAL_ROOT).head;
  const { artifact } = gate.loadGovernedAuthorization({ repoRoot: REAL_ROOT, authorizedCommit: head });
  assert.equal(artifact.authorizationStatus, "PENDING");
  const derived = gate.deriveGovernedFileHashes(REAL_ROOT);
  throws(() => gate.verifyGovernedAuthorization(artifact, {
    projectId: "taylor-parts", personaOrder: ORDER, derivedHashes: derived,
    repoIdentity: gate.deriveRepositoryIdentity(REAL_ROOT), authorizedCommit: head,
    executionModeConfirmation: "x", executor: "x",
  }), /not GRANTED/);
});

ok("GRANTED temp-repo artifact verifies; wrong token / wrong executor / unknown field / hash drift all refuse", () => {
  const g = buildGrantedRepo("demo-authpr4");
  const derived = gate.governedHashesAtCommit(g.root, g.authorizedCommit);
  const repoIdentity = gate.deriveRepositoryIdentity(g.root);
  const { artifact } = gate.loadGovernedAuthorization({ repoRoot: g.root, authorizedCommit: g.authorizedCommit });
  const base = { projectId: "demo-authpr4", personaOrder: ORDER, derivedHashes: derived, repoIdentity, authorizedCommit: g.authorizedCommit, executionModeConfirmation: g.executionModeToken, executor: g.executor };
  assert.equal(gate.verifyGovernedAuthorization(artifact, base).authorizationStatus, "GRANTED");
  throws(() => gate.verifyGovernedAuthorization(artifact, { ...base, executionModeConfirmation: "WRONG" }), /execution-mode token/);
  throws(() => gate.verifyGovernedAuthorization(artifact, { ...base, executor: "someone-else" }), /authorized executor/);
  throws(() => gate.verifyGovernedAuthorization(artifact, { ...base, projectId: "other" }), /projectId does not match/);
  throws(() => gate.verifyGovernedAuthorization(artifact, { ...base, derivedHashes: { ...derived, [gate.GOVERNED_FILES[0]]: "0".repeat(64) } }), /hash mismatch/);
  fs.rmSync(g.root, { recursive: true, force: true });
});

ok("unknown field / PENDING status in the committed artifact are refused", () => {
  const gUnknown = buildGrantedRepo("demo-authpr4", (a) => ({ ...a, evil: 1 }));
  const dU = gate.governedHashesAtCommit(gUnknown.root, gUnknown.authorizedCommit);
  throws(() => gate.verifyGovernedAuthorization(gate.loadGovernedAuthorization({ repoRoot: gUnknown.root, authorizedCommit: gUnknown.authorizedCommit }).artifact,
    { projectId: "demo-authpr4", personaOrder: ORDER, derivedHashes: dU, repoIdentity: gate.deriveRepositoryIdentity(gUnknown.root), authorizedCommit: gUnknown.authorizedCommit, executionModeConfirmation: "EMT-TOKEN", executor: "named-exec" }),
    /schema mismatch/);
  fs.rmSync(gUnknown.root, { recursive: true, force: true });
  const gPending = buildGrantedRepo("demo-authpr4", (a) => ({ ...a, authorizationStatus: "PENDING" }));
  const dP = gate.governedHashesAtCommit(gPending.root, gPending.authorizedCommit);
  throws(() => gate.verifyGovernedAuthorization(gate.loadGovernedAuthorization({ repoRoot: gPending.root, authorizedCommit: gPending.authorizedCommit }).artifact,
    { projectId: "demo-authpr4", personaOrder: ORDER, derivedHashes: dP, repoIdentity: gate.deriveRepositoryIdentity(gPending.root), authorizedCommit: gPending.authorizedCommit, executionModeConfirmation: "EMT-TOKEN", executor: "named-exec" }),
    /not GRANTED/);
  fs.rmSync(gPending.root, { recursive: true, force: true });
});

ok("modified tracked artifact (dirty working tree) fails the clean-checkout guard", () => {
  const g = buildGrantedRepo("demo-authpr4");
  // Tamper the on-disk committed artifact to GRANTED-with-different content.
  fs.writeFileSync(path.join(g.root, gate.AUTH_ARTIFACT_PATH), JSON.stringify({ hacked: true }));
  throws(() => gate.assertCleanGovernedTree(g.root), /clean checkout/);
  fs.rmSync(g.root, { recursive: true, force: true });
});

ok("wrong/absent authorized commit or untracked artifact path is not readable from git", () => {
  const g = buildGrantedRepo("demo-authpr4");
  throws(() => gate.loadGovernedAuthorization({ repoRoot: g.root, authorizedCommit: "0".repeat(40) }), /not present\/tracked in commit/);
  fs.rmSync(g.root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 3. C5 -- non-git fails closed
// ---------------------------------------------------------------------------

ok("non-git context fails closed (no path fallback)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "authpr4-nogit-"));
  throws(() => gate.resolveRepoRoot({ repoRoot: dir }), /requires a clean git checkout/);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 4. C2 -- state machine: chain, anchor/replay, claim/concurrency, ownership
// ---------------------------------------------------------------------------

ok("readState verifies signature + strict schema + binding; tamper/wrong-key/unknown-field refuse", () => {
  const key = KEY(); const idHash = "d".repeat(64);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "authpr4-st-"));
  const f = path.join(dir, "state.json");
  writeGenesis(f, key, { authorizationId: "AUTHPR4-PROD-TEST", projectId: "demo-authpr4", idHash });
  const expected = { authorizationId: "AUTHPR4-PROD-TEST", projectId: "demo-authpr4", workflowIdentityHash: idHash, personaOrder: ORDER };
  assert.equal(gate.readState(f, key, expected).status, "eligible");
  throws(() => gate.readState(f, KEY(), expected), /integrity verification/); // wrong key
  const t = JSON.parse(fs.readFileSync(f, "utf8")); t.completed = ["emp-rudy-driver"]; fs.writeFileSync(f, JSON.stringify(t));
  throws(() => gate.readState(f, key, expected), /integrity verification|in-order prefix/);
  const u = JSON.parse(fs.readFileSync(f, "utf8")); u.evil = 1; fs.writeFileSync(f, JSON.stringify(u));
  throws(() => gate.readState(f, key, expected), /schema mismatch/);
  fs.rmSync(dir, { recursive: true, force: true });
});

ok("anchor detects restoration of an older signed state (replay) and fails closed", () => {
  const key = KEY(); const idHash = "e".repeat(64);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "authpr4-replay-"));
  const f = path.join(dir, "state.json");
  const g = writeGenesis(f, key, { authorizationId: "AUTHPR4-PROD-TEST", projectId: "demo-authpr4", idHash });
  const oldBytes = fs.readFileSync(f); // snapshot of revision-0 state
  // Advance to revision 1 (updates anchor to high-water 1).
  gate.commitState(f, g, { status: "claimed", attempt: { attemptId: "att-x", mode: "forward", targetPersona: "emp-rudy-driver", claimedAt: new Date().toISOString(), leaseExpiresAt: new Date(Date.now() + 60000).toISOString() } }, key);
  // Restore the OLD revision-0 state file (still correctly signed).
  fs.writeFileSync(f, oldBytes);
  const restored = gate.readState(f, key, { authorizationId: "AUTHPR4-PROD-TEST", projectId: "demo-authpr4", workflowIdentityHash: idHash, personaOrder: ORDER });
  throws(() => gate.verifyStateFreshness(f, restored, key), /stale\/replayed|does not match the high-water anchor/);
  fs.rmSync(dir, { recursive: true, force: true });
});

ok("exclusive claim: concurrent unexpired claim refused; only the owner may release/complete", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "authpr4-lock-"));
  const f = path.join(dir, "state.json");
  const a = gate.acquireClaim(f, { authorizationId: "AUTHPR4-PROD-TEST", attemptId: "att-A", mode: "forward", targetPersona: "emp-rudy-driver", revision: 0, leaseSeconds: 300 });
  assert.ok(a.lock && !a.tookOver);
  // Worker B attempts concurrently -> unexpired lease -> refuse.
  throws(() => gate.acquireClaim(f, { authorizationId: "AUTHPR4-PROD-TEST", attemptId: "att-B", mode: "forward", targetPersona: "emp-rudy-driver", revision: 0, leaseSeconds: 300 }), /concurrent claim is held/);
  // A non-owner cannot release; the owner can.
  throws(() => gate.releaseClaim(f, "att-B"), /different attempt/);
  throws(() => gate.assertOwnsClaim(f, "att-B"), /no longer owns the claim/);
  gate.assertOwnsClaim(f, "att-A");
  gate.releaseClaim(f, "att-A");
  fs.rmSync(dir, { recursive: true, force: true });
});

ok("stale takeover: an expired claim is taken over (not silently reused)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "authpr4-stale-"));
  const f = path.join(dir, "state.json");
  const past = () => new Date(Date.now() - 10 * 1000);
  // A claims with a lease that is already expired (claimedAt in the past, 1s lease).
  gate.acquireClaim(f, { authorizationId: "AUTHPR4-PROD-TEST", attemptId: "att-A", mode: "forward", targetPersona: "emp-rudy-driver", revision: 0, leaseSeconds: 1 }, { now: past });
  // B attempts now -> A's lease expired -> takeover signalled (tookOver set, lock null).
  const b = gate.acquireClaim(f, { authorizationId: "AUTHPR4-PROD-TEST", attemptId: "att-B", mode: "forward", targetPersona: "emp-rudy-driver", revision: 0, leaseSeconds: 300 });
  assert.equal(b.lock, null);
  assert.equal(b.tookOver.attemptId, "att-A");
  fs.rmSync(dir, { recursive: true, force: true });
});

// Build a claimed state + matching lock for live-ownership tests.
function makeClaimed(dir, key, { authorizationId = "AUTHPR4-PROD-TEST", projectId = "demo-authpr4", idHash, attemptId = "att-A", mode = "forward", targetPersona = "emp-rudy-driver", leaseSeconds = 300, now = new Date() } = {}) {
  const stateFile = path.join(dir, "state.json");
  const g0 = writeGenesis(stateFile, key, { authorizationId, projectId, idHash });
  const claimedAt = now.toISOString();
  const leaseExpiresAt = new Date(now.getTime() + leaseSeconds * 1000).toISOString();
  const claimed = gate.commitState(stateFile, g0, { status: "claimed", attempt: { attemptId, mode, targetPersona, claimedAt, leaseExpiresAt } }, key);
  fs.writeFileSync(gate.lockPath(stateFile), JSON.stringify({ version: gate.LOCK_VERSION, authorizationId, attemptId, mode, targetPersona, revision: 0, claimedAt, leaseExpiresAt }), { mode: 0o600 });
  const expected = { authorizationId, projectId, workflowIdentityHash: idHash, personaOrder: ORDER };
  const ownership = { authorizationId, attemptId, mode, targetPersona, predecessorRevision: 0, claimedRevision: claimed.revision, claimedHash: gate.progressionHash(claimed), expected };
  return { stateFile, claimed, ownership, claimedAt, leaseExpiresAt };
}

ok("live-ownership: completion/uncertain AFTER lease expiry are refused", () => {
  const key = KEY(); const idHash = "a".repeat(64);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "authpr4-lease-"));
  const past = new Date(Date.now() - 10000);
  const { stateFile, ownership } = makeClaimed(dir, key, { idHash, leaseSeconds: 1, now: past }); // already-expired lease
  throws(() => gate.assertLiveOwnership(stateFile, key, ownership), /lease has EXPIRED/i);
  fs.rmSync(dir, { recursive: true, force: true });
});

ok("live-ownership: non-owner attemptId / mismatched mode/target/revision are refused", () => {
  const key = KEY(); const idHash = "b".repeat(64);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "authpr4-own-"));
  const { stateFile, ownership } = makeClaimed(dir, key, { idHash });
  gate.assertLiveOwnership(stateFile, key, ownership); // owner OK
  throws(() => gate.assertLiveOwnership(stateFile, key, { ...ownership, attemptId: "att-INTRUDER" }), /different attempt/);
  throws(() => gate.assertLiveOwnership(stateFile, key, { ...ownership, mode: "rollback" }), /mode\/target mismatch/);
  throws(() => gate.assertLiveOwnership(stateFile, key, { ...ownership, targetPersona: "emp-rudy-owner" }), /mode\/target mismatch/);
  throws(() => gate.assertLiveOwnership(stateFile, key, { ...ownership, predecessorRevision: 99 }), /predecessor revision mismatch/);
  throws(() => gate.assertLiveOwnership(stateFile, key, { ...ownership, claimedRevision: 99 }), /revision changed/);
  fs.rmSync(dir, { recursive: true, force: true });
});

ok("live-ownership: superseded worker cannot overwrite a recovery_required / non-claimed state", () => {
  const key = KEY(); const idHash = "c".repeat(64);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "authpr4-super-"));
  const { stateFile, claimed, ownership } = makeClaimed(dir, key, { idHash });
  // Simulate B's takeover: commit recovery_required (revision advances, anchor bumps).
  gate.commitState(stateFile, claimed, { status: "recovery_required", attempt: null, lastOutcome: { attemptId: "att-A", mode: "forward", targetPersona: "emp-rudy-driver", result: "uncertain-stale-takeover", at: new Date().toISOString() } }, key);
  // A's stale lock (att-A) is still on disk, but the state is no longer claimed.
  throws(() => gate.assertLiveOwnership(stateFile, key, ownership), /no longer "claimed"|revision changed/);
  fs.rmSync(dir, { recursive: true, force: true });
});

ok("strict readLock: malformed lock values fail closed", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "authpr4-mlock-"));
  const f = path.join(dir, "state.json");
  const good = { version: gate.LOCK_VERSION, authorizationId: "AUTHPR4-PROD-TEST", attemptId: "att-A", mode: "forward", targetPersona: "emp-rudy-driver", revision: 0, claimedAt: new Date().toISOString(), leaseExpiresAt: new Date(Date.now() + 60000).toISOString() };
  const write = (o) => fs.writeFileSync(gate.lockPath(f), JSON.stringify(o));
  write(good); assert.equal(gate.readLock(f).attemptId, "att-A");
  write({ ...good, mode: "sideways" }); throws(() => gate.readLock(f), /mode invalid/);
  write({ ...good, revision: -1 }); throws(() => gate.readLock(f), /revision out of bounds/);
  write({ ...good, authorizationId: "lower" }); throws(() => gate.readLock(f), /authorizationId not canonical/);
  write({ ...good, claimedAt: "not-a-date" }); throws(() => gate.readLock(f), /valid UTC/);
  write({ ...good, leaseExpiresAt: good.claimedAt }); throws(() => gate.readLock(f), /strictly later/);
  write({ ...good, extra: 1 }); throws(() => gate.readLock(f), /schema mismatch/);
  fs.rmSync(dir, { recursive: true, force: true });
});

ok("state invariants: impossible signed status/attempt combinations fail closed", () => {
  const key = KEY(); const idHash = "d".repeat(64);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "authpr4-inv-"));
  const f = path.join(dir, "state.json");
  const base = gate.genesisState({ authorizationId: "AUTHPR4-PROD-TEST", projectId: "demo-authpr4", workflowIdentityHash: idHash, personaOrder: ORDER });
  const expected = { authorizationId: "AUTHPR4-PROD-TEST", projectId: "demo-authpr4", workflowIdentityHash: idHash, personaOrder: ORDER };
  const writeSigned = (p) => fs.writeFileSync(f, JSON.stringify({ ...p, signature: gate.signProgression(p, key) }));
  const att = { attemptId: "att-A", mode: "forward", targetPersona: "emp-rudy-driver", claimedAt: new Date().toISOString(), leaseExpiresAt: new Date(Date.now() + 60000).toISOString() };
  // eligible must have attempt=null
  writeSigned({ ...base, status: "eligible", attempt: att, revision: 1, previousStateHash: gate.progressionHash(base) });
  throws(() => gate.readState(f, key, expected), /eligible state must have attempt=null/);
  // claimed must have an attempt
  writeSigned({ ...base, status: "claimed", attempt: null, revision: 1, previousStateHash: gate.progressionHash(base) });
  throws(() => gate.readState(f, key, expected), /claimed state must have an attempt/);
  // suspended must be a rollback outcome
  writeSigned({ ...base, status: "suspended", attempt: null, lastOutcome: { attemptId: "att-A", mode: "forward", targetPersona: "emp-rudy-driver", result: "completed", at: new Date().toISOString() }, revision: 1, previousStateHash: gate.progressionHash(base) });
  throws(() => gate.readState(f, key, expected), /suspended must represent a governed rollback/);
  // uncertain must preserve affected attempt in lastOutcome
  writeSigned({ ...base, status: "uncertain", attempt: att, lastOutcome: null, revision: 1, previousStateHash: gate.progressionHash(base) });
  throws(() => gate.readState(f, key, expected), /must preserve the affected attempt/);
  fs.rmSync(dir, { recursive: true, force: true });
});

ok("INTERLEAVING: A claims, lease expires, B records recovery_required; A's later completion AND uncertain both refused; recovery_required intact", () => {
  const g = buildGrantedRepo("demo-authpr4");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "authpr4-inter-"));
  const keyFile = path.join(dir, "k"); const key = crypto.randomBytes(48); fs.writeFileSync(keyFile, key, { mode: 0o600 });
  const stateFile = path.join(dir, "state.json"); const mappingFile = path.join(dir, "map.json");
  fs.writeFileSync(mappingFile, JSON.stringify({ "emp-rudy-driver": { uid: "u1", newAlias: "base+driver@gmail.com" } }));
  const idHash = gate.workflowIdentityHash(gate.governedHashesAtCommit(g.root, g.authorizedCommit));
  writeGenesis(stateFile, key, { authorizationId: "AUTHPR4-PROD-TEST", projectId: "demo-authpr4", idHash });
  const T0 = new Date();
  const baseArgs = { projectId: "demo-authpr4", executeProduction: true, mappingFile, progressionFile: stateFile, stateKeyFile: keyFile, authorizedCommit: g.authorizedCommit, executionModeConfirmation: g.executionModeToken, executor: g.executor, capturedStateOut: path.join(dir, "c.json") };
  // A claims with a 1s lease at T0.
  const ctxA = gate.assertProductionAuthorization(baseArgs, { repoRoot: g.root, personaOrder: ORDER, now: () => T0, leaseSeconds: 1 });
  assert.equal(ctxA.effective.employeeId, "emp-rudy-driver");
  // 10s later B runs -> A's lease expired -> B takes over into recovery_required (throws).
  const tLater = () => new Date(T0.getTime() + 10000);
  throws(() => gate.assertProductionAuthorization(baseArgs, { repoRoot: g.root, personaOrder: ORDER, now: tLater, leaseSeconds: 300 }), /Stale claim taken over|recovery_required/);
  let st = gate.readState(stateFile, key, { authorizationId: "AUTHPR4-PROD-TEST", projectId: "demo-authpr4", workflowIdentityHash: idHash, personaOrder: ORDER });
  assert.equal(st.status, "recovery_required");
  assert.equal(st.lastOutcome.result, "uncertain-stale-takeover");
  // A resumes: BOTH completion and uncertain are refused (lease expired / state changed).
  throws(() => ctxA.recordCompletion({ personaOrder: ORDER, now: tLater }), /EXPIRED|no longer "claimed"|revision changed/);
  throws(() => ctxA.recordUncertain("late", { personaOrder: ORDER, now: tLater }), /EXPIRED|no longer "claimed"|revision changed/);
  st = gate.readState(stateFile, key, { authorizationId: "AUTHPR4-PROD-TEST", projectId: "demo-authpr4", workflowIdentityHash: idHash, personaOrder: ORDER });
  assert.equal(st.status, "recovery_required", "B's recovery_required + evidence remain intact");
  assert.equal(st.lastOutcome.result, "uncertain-stale-takeover");
  fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(g.root, { recursive: true, force: true });
});

ok("TRANSITION MUTEX (TOCTOU): a held .txn serializes transitions; loser re-reads terminal state and does not overwrite", () => {
  const key = KEY(); const idHash = "ab".repeat(32);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "authpr4-txn-"));
  const { stateFile, claimed, ownership } = makeClaimed(dir, key, { idHash });
  // Simulate worker A holding the transition mutex (paused before its commit).
  fs.writeFileSync(gate.txnPath(stateFile), JSON.stringify({ at: new Date().toISOString(), pid: 1 }));
  // Worker B's outcome write must fail to acquire the mutex (contended) -> no write.
  const ctxB = { recordCompletion: () => gate.withTransition(stateFile, { now: () => new Date() }, () => { throw new Error("should not run"); }) };
  throws(() => ctxB.recordCompletion(), /mutex is held \(contended\)/);
  // A now finishes: transition state to recovery_required, then release the mutex.
  gate.commitState(stateFile, claimed, { status: "recovery_required", attempt: null, lastOutcome: { attemptId: "att-A", mode: "forward", targetPersona: "emp-rudy-driver", result: "uncertain-stale-takeover", at: new Date().toISOString() } }, key);
  fs.unlinkSync(gate.txnPath(stateFile));
  // B retries under the (now free) mutex: assertLiveOwnership sees a non-claimed
  // terminal state and refuses -> B does NOT overwrite recovery_required.
  throws(() => gate.withTransition(stateFile, { now: () => new Date() }, () => gate.assertLiveOwnership(stateFile, key, ownership, {})), /no longer "claimed"|revision changed/);
  const st = gate.readState(stateFile, key, { authorizationId: "AUTHPR4-PROD-TEST", projectId: "demo-authpr4", workflowIdentityHash: idHash, personaOrder: ORDER });
  assert.equal(st.status, "recovery_required");
  fs.rmSync(dir, { recursive: true, force: true });
});

ok("DUAL TAKEOVER: two stale-takeover workers serialize; the second sees recovery_required and does not double-write", () => {
  const g = buildGrantedRepo("demo-authpr4");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "authpr4-dual-"));
  const keyFile = path.join(dir, "k"); const key = crypto.randomBytes(48); fs.writeFileSync(keyFile, key, { mode: 0o600 });
  const stateFile = path.join(dir, "state.json"); const mappingFile = path.join(dir, "map.json");
  fs.writeFileSync(mappingFile, JSON.stringify({ "emp-rudy-driver": { uid: "u1", newAlias: "base+d@gmail.com" } }));
  const idHash = gate.workflowIdentityHash(gate.governedHashesAtCommit(g.root, g.authorizedCommit));
  writeGenesis(stateFile, key, { authorizationId: "AUTHPR4-PROD-TEST", projectId: "demo-authpr4", idHash });
  const T0 = new Date();
  const argsA = { projectId: "demo-authpr4", executeProduction: true, mappingFile, progressionFile: stateFile, stateKeyFile: keyFile, authorizedCommit: g.authorizedCommit, executionModeConfirmation: g.executionModeToken, executor: g.executor, capturedStateOut: path.join(dir, "c.json") };
  gate.assertProductionAuthorization(argsA, { repoRoot: g.root, personaOrder: ORDER, now: () => T0, leaseSeconds: 1 }); // A claims
  const tLater = () => new Date(T0.getTime() + 10000);
  // Two takeover workers B and C run after A's lease expires. Each throws (takeover),
  // but the state is written exactly once and remains recovery_required.
  throws(() => gate.assertProductionAuthorization(argsA, { repoRoot: g.root, personaOrder: ORDER, now: tLater, leaseSeconds: 300 }), /Stale claim taken over|recovery_required/);
  throws(() => gate.assertProductionAuthorization(argsA, { repoRoot: g.root, personaOrder: ORDER, now: tLater, leaseSeconds: 300 }), /blocking state|already transitioned|recovery_required/);
  const st = gate.readState(stateFile, key, { authorizationId: "AUTHPR4-PROD-TEST", projectId: "demo-authpr4", workflowIdentityHash: idHash, personaOrder: ORDER });
  assert.equal(st.status, "recovery_required");
  assert.equal(st.lastOutcome.result, "uncertain-stale-takeover");
  // Anchor is consistent with the single committed terminal state.
  gate.verifyStateFreshness(stateFile, st, key);
  fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(g.root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 5. Break-glass strict (C4)
// ---------------------------------------------------------------------------

ok("break-glass strict: valid passes; wrong confirmer / window / unknown field / expired refuse", () => {
  const key = KEY();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "authpr4-bg-"));
  const f = path.join(dir, "bg.json");
  const progHash = "f".repeat(64);
  const mk = (over = {}) => {
    const p = { version: gate.BREAKGLASS_VERSION, authorizationId: "AUTHPR4-PROD-TEST", progressionHash: progHash, position: 5, confirmer: "named-confirmer", createdAt: new Date().toISOString(), validityWindowSeconds: 600, sanitizedResult: { recoverable: true, loginVerified: true }, ...over };
    fs.writeFileSync(f, JSON.stringify({ ...p, signature: gate.signBreakGlass(p, key) }));
  };
  const ctx = { authorizationId: "AUTHPR4-PROD-TEST", currentProgressionHash: progHash, requiredConfirmer: "named-confirmer", contractWindowSeconds: 600, now: new Date() };
  mk(); assert.equal(gate.readAndVerifyBreakGlass(f, key, ctx).position, 5);
  mk({ confirmer: "intruder" }); throws(() => gate.readAndVerifyBreakGlass(f, key, ctx), /confirmer does not match/);
  mk({ validityWindowSeconds: 30 }); throws(() => gate.readAndVerifyBreakGlass(f, key, ctx), /validityWindowSeconds/);
  mk({ createdAt: new Date(Date.now() - 601000).toISOString() }); throws(() => gate.readAndVerifyBreakGlass(f, key, ctx), /EXPIRED/);
  const p = { version: 1, authorizationId: "AUTHPR4-PROD-TEST", progressionHash: progHash, position: 5, confirmer: "named-confirmer", createdAt: new Date().toISOString(), validityWindowSeconds: 600, sanitizedResult: { recoverable: true, loginVerified: true }, evil: 1 };
  fs.writeFileSync(f, JSON.stringify({ ...p, signature: gate.signBreakGlass(p, key) }));
  throws(() => gate.readAndVerifyBreakGlass(f, key, ctx), /schema mismatch/);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 6. AUTH-EMULATOR -- full production-shaped lifecycle via the granted temp repo
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

async function seed(mappingFile, employeeId) {
  const prior = `prod_${employeeId}_${uniq()}@example.com`;
  const newAlias = `base+${employeeId}_${uniq()}@gmail.com`;
  const user = await auth.createUser({ email: prior, emailVerified: true, password: "Passw0rd!23" });
  const map = fs.existsSync(mappingFile) ? JSON.parse(fs.readFileSync(mappingFile, "utf8")) : {};
  map[employeeId] = { uid: user.uid, newAlias };
  fs.writeFileSync(mappingFile, JSON.stringify(map), { mode: 0o600 });
  return { uid: user.uid, prior, newAlias };
}

// Drive main()'s production two-phase lifecycle at module level (auth injectable).
async function runProductionForward({ g, key, keyFile, stateFile, mappingFile, employeeId, authObj, bgFile }) {
  const dir = path.dirname(stateFile);
  const capturedOut = path.join(dir, `${employeeId}.rollback.json`);
  const ctx = gate.assertProductionAuthorization(
    { projectId: PROJECT, executeProduction: true, mappingFile, progressionFile: stateFile, stateKeyFile: keyFile,
      authorizedCommit: g.authorizedCommit, executionModeConfirmation: g.executionModeToken, executor: g.executor,
      capturedStateOut: capturedOut, breakGlassConfirmationFile: bgFile },
    { repoRoot: g.root, personaOrder: ORDER },
  );
  const map = JSON.parse(fs.readFileSync(mappingFile, "utf8"))[employeeId];
  const pre = await wf.preflight(auth, { employeeId, uid: map.uid, newAlias: map.newAlias });
  wf.writeCapturedState(capturedOut, { version: 1, projectId: PROJECT, employeeId, position: ctx.effective.position, uid: pre.uid, priorAddress: pre.priorAddress, priorEmailVerified: pre.priorEmailVerified, newAlias: map.newAlias, createdAt: new Date().toISOString() }, key);
  const plan = wf.buildForwardPlan({ employeeId, uid: pre.uid, priorAddress: pre.priorAddress, priorEmailVerified: pre.priorEmailVerified, newAlias: map.newAlias });
  try {
    await wf.applyPlan(authObj || auth, plan, { execute: true });
  } catch (err) {
    ctx.recordUncertain("forward-uncertain", { personaOrder: ORDER });
    throw err;
  }
  ctx.recordCompletion({ personaOrder: ORDER });
  return { ctx, capturedOut, map, pre };
}

await okAsync("GRANTED production-shaped path advances the full sequence 1..5 (break-glass at 5) against the emulator", async () => {
  const g = buildGrantedRepo(PROJECT);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "authpr4-run-"));
  const keyFile = path.join(dir, "k"); const key = crypto.randomBytes(48); fs.writeFileSync(keyFile, key, { mode: 0o600 });
  const stateFile = path.join(dir, "state.json"); const mappingFile = path.join(dir, "map.json");
  const idHash = gate.workflowIdentityHash(gate.governedHashesAtCommit(g.root, g.authorizedCommit));
  writeGenesis(stateFile, key, { authorizationId: "AUTHPR4-PROD-TEST", projectId: PROJECT, idHash });
  const seeded = {};
  for (const id of ORDER) seeded[id] = await seed(mappingFile, id);
  for (let i = 0; i < ORDER.length; i += 1) {
    const id = ORDER[i];
    let bgFile;
    if (i === 4) {
      const st = gate.readState(stateFile, key, { authorizationId: "AUTHPR4-PROD-TEST", projectId: PROJECT, workflowIdentityHash: idHash, personaOrder: ORDER });
      assert.equal(st.completed.length, 4);
      bgFile = path.join(dir, "bg.json");
      const bg = { version: 1, authorizationId: "AUTHPR4-PROD-TEST", progressionHash: gate.progressionHash(st), position: 5, confirmer: g.requiredConfirmer, createdAt: new Date().toISOString(), validityWindowSeconds: g.windowSeconds, sanitizedResult: { recoverable: true, loginVerified: true } };
      fs.writeFileSync(bgFile, JSON.stringify({ ...bg, signature: gate.signBreakGlass(bg, key) }), { mode: 0o600 });
    }
    await runProductionForward({ g, key, keyFile, stateFile, mappingFile, employeeId: id, bgFile });
    assert.equal((await auth.getUser(seeded[id].uid)).email, seeded[id].newAlias);
    assert.equal((await auth.getUser(seeded[id].uid)).emailVerified, false);
  }
  const fin = gate.readState(stateFile, key, { authorizationId: "AUTHPR4-PROD-TEST", projectId: PROJECT, workflowIdentityHash: idHash, personaOrder: ORDER });
  assert.deepEqual(fin.completed, ORDER);
  fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(g.root, { recursive: true, force: true });
});

await okAsync("FAULT: read-back failure after updateUser -> UNCERTAIN, no advance, artifact retained, later blocked", async () => {
  const g = buildGrantedRepo(PROJECT);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "authpr4-fault-"));
  const keyFile = path.join(dir, "k"); const key = crypto.randomBytes(48); fs.writeFileSync(keyFile, key, { mode: 0o600 });
  const stateFile = path.join(dir, "state.json"); const mappingFile = path.join(dir, "map.json");
  const idHash = gate.workflowIdentityHash(gate.governedHashesAtCommit(g.root, g.authorizedCommit));
  writeGenesis(stateFile, key, { authorizationId: "AUTHPR4-PROD-TEST", projectId: PROJECT, idHash });
  const drv = await seed(mappingFile, "emp-rudy-driver");
  let failNext = false;
  const faulting = { getUserByEmail: (e) => auth.getUserByEmail(e), updateUser: async (u, x) => { const r = await auth.updateUser(u, x); failNext = true; return r; }, getUser: async (u) => { if (failNext) { failNext = false; const e = new Error("injected"); e.code = "x"; throw e; } return auth.getUser(u); } };
  await assert.rejects(() => runProductionForward({ g, key, keyFile, stateFile, mappingFile, employeeId: "emp-rudy-driver", authObj: faulting }));
  assert.equal((await auth.getUser(drv.uid)).email, drv.newAlias, "mutation landed");
  const st = gate.readState(stateFile, key, { authorizationId: "AUTHPR4-PROD-TEST", projectId: PROJECT, workflowIdentityHash: idHash, personaOrder: ORDER });
  assert.equal(st.status, "uncertain", "uncertain outcome recorded, not advanced");
  assert.deepEqual(st.completed, []);
  assert.ok(fs.existsSync(path.join(dir, "emp-rudy-driver.rollback.json")), "rollback artifact retained");
  // Later attempts are blocked (uncertain is a blocking state).
  await assert.rejects(() => runProductionForward({ g, key, keyFile, stateFile, mappingFile, employeeId: "emp-rudy-driver" }), /blocking state/);
  fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(g.root, { recursive: true, force: true });
});

await okAsync("FAULT: completion-persistence failure leaves progression CLAIMED (blocking); later attempts refused", async () => {
  const g = buildGrantedRepo(PROJECT);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "authpr4-cfault-"));
  const keyFile = path.join(dir, "k"); const key = crypto.randomBytes(48); fs.writeFileSync(keyFile, key, { mode: 0o600 });
  const stateFile = path.join(dir, "state.json"); const mappingFile = path.join(dir, "map.json");
  const idHash = gate.workflowIdentityHash(gate.governedHashesAtCommit(g.root, g.authorizedCommit));
  writeGenesis(stateFile, key, { authorizationId: "AUTHPR4-PROD-TEST", projectId: PROJECT, idHash });
  const drv = await seed(mappingFile, "emp-rudy-driver");
  const capturedOut = path.join(dir, "emp-rudy-driver.rollback.json");
  const ctx = gate.assertProductionAuthorization(
    { projectId: PROJECT, executeProduction: true, mappingFile, progressionFile: stateFile, stateKeyFile: keyFile, authorizedCommit: g.authorizedCommit, executionModeConfirmation: g.executionModeToken, executor: g.executor, capturedStateOut: capturedOut },
    { repoRoot: g.root, personaOrder: ORDER });
  const pre = await wf.preflight(auth, { employeeId: "emp-rudy-driver", uid: drv.uid, newAlias: drv.newAlias });
  wf.writeCapturedState(capturedOut, { version: 1, projectId: PROJECT, employeeId: "emp-rudy-driver", position: 1, uid: pre.uid, priorAddress: pre.priorAddress, priorEmailVerified: true, newAlias: drv.newAlias, createdAt: new Date().toISOString() }, key);
  await wf.applyPlan(auth, wf.buildForwardPlan({ employeeId: "emp-rudy-driver", uid: pre.uid, priorAddress: pre.priorAddress, priorEmailVerified: true, newAlias: drv.newAlias }), { execute: true });
  assert.equal((await auth.getUser(drv.uid)).email, drv.newAlias, "forward mutation landed");
  // Completion persistence FAILS (disk error) -> recordCompletion throws; state stays CLAIMED.
  const failingFs = { ...fs, openSync: () => { const e = new Error("injected disk failure"); throw e; } };
  assert.throws(() => ctx.recordCompletion({ personaOrder: ORDER, fs: failingFs }), /injected disk failure/);
  const st = gate.readState(stateFile, key, { authorizationId: "AUTHPR4-PROD-TEST", projectId: PROJECT, workflowIdentityHash: idHash, personaOrder: ORDER });
  assert.equal(st.status, "claimed", "progression remains CLAIMED (never auto-reverts to eligible)");
  assert.deepEqual(st.completed, []);
  // A later run is blocked: the claim lock is still held with a live lease (the
  // failed completion never released it), so a fresh worker is refused.
  await assert.rejects(() => runProductionForward({ g, key, keyFile, stateFile, mappingFile, employeeId: "emp-rudy-driver" }), /concurrent claim is held|blocking state/);
  fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(g.root, { recursive: true, force: true });
});

await okAsync("GRANTED rollback of the most recent persona SUSPENDS progression + restores exact prior; later blocked", async () => {
  const g = buildGrantedRepo(PROJECT);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "authpr4-rb-"));
  const keyFile = path.join(dir, "k"); const key = crypto.randomBytes(48); fs.writeFileSync(keyFile, key, { mode: 0o600 });
  const stateFile = path.join(dir, "state.json"); const mappingFile = path.join(dir, "map.json");
  const idHash = gate.workflowIdentityHash(gate.governedHashesAtCommit(g.root, g.authorizedCommit));
  writeGenesis(stateFile, key, { authorizationId: "AUTHPR4-PROD-TEST", projectId: PROJECT, idHash });
  const drv = await seed(mappingFile, "emp-rudy-driver");
  const fwd = await runProductionForward({ g, key, keyFile, stateFile, mappingFile, employeeId: "emp-rudy-driver" });
  // Now roll back driver via the gate.
  const rbCtx = gate.assertProductionAuthorization(
    { projectId: PROJECT, executeProduction: true, rollback: true, mappingFile, progressionFile: stateFile, stateKeyFile: keyFile, authorizedCommit: g.authorizedCommit, executionModeConfirmation: g.executionModeToken, executor: g.executor, capturedStateFile: fwd.capturedOut, employeeId: "emp-rudy-driver" },
    { repoRoot: g.root, personaOrder: ORDER });
  const captured = JSON.parse(fs.readFileSync(fwd.capturedOut, "utf8"));
  await wf.applyPlan(auth, wf.buildRollbackPlan({ employeeId: "emp-rudy-driver", uid: captured.uid, priorAddress: captured.priorAddress, priorEmailVerified: captured.priorEmailVerified }), { execute: true });
  rbCtx.recordCompletion({ personaOrder: ORDER });
  const restored = await auth.getUser(drv.uid);
  assert.equal(restored.email, drv.prior, "exact prior address restored");
  assert.equal(restored.emailVerified, true, "exact prior emailVerified restored");
  const st = gate.readState(stateFile, key, { authorizationId: "AUTHPR4-PROD-TEST", projectId: PROJECT, workflowIdentityHash: idHash, personaOrder: ORDER });
  assert.equal(st.status, "suspended");
  assert.deepEqual(st.completed, []);
  fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(g.root, { recursive: true, force: true });
});

await okAsync("FAULT: rollback Auth succeeds but progression persistence fails -> artifact RETAINED, not suspended, later blocked", async () => {
  const g = buildGrantedRepo(PROJECT);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "authpr4-rbfault-"));
  const keyFile = path.join(dir, "k"); const key = crypto.randomBytes(48); fs.writeFileSync(keyFile, key, { mode: 0o600 });
  const stateFile = path.join(dir, "state.json"); const mappingFile = path.join(dir, "map.json");
  const idHash = gate.workflowIdentityHash(gate.governedHashesAtCommit(g.root, g.authorizedCommit));
  writeGenesis(stateFile, key, { authorizationId: "AUTHPR4-PROD-TEST", projectId: PROJECT, idHash });
  const drv = await seed(mappingFile, "emp-rudy-driver");
  const fwd = await runProductionForward({ g, key, keyFile, stateFile, mappingFile, employeeId: "emp-rudy-driver" });
  // Roll back: gate claims (state -> claimed), Auth rollback succeeds, then progression
  // persistence FAILS (injected disk error) -> recordCompletion throws.
  const rbCtx = gate.assertProductionAuthorization(
    { projectId: PROJECT, executeProduction: true, rollback: true, mappingFile, progressionFile: stateFile, stateKeyFile: keyFile, authorizedCommit: g.authorizedCommit, executionModeConfirmation: g.executionModeToken, executor: g.executor, capturedStateFile: fwd.capturedOut, employeeId: "emp-rudy-driver" },
    { repoRoot: g.root, personaOrder: ORDER });
  const captured = JSON.parse(fs.readFileSync(fwd.capturedOut, "utf8"));
  await wf.applyPlan(auth, wf.buildRollbackPlan({ employeeId: "emp-rudy-driver", uid: captured.uid, priorAddress: captured.priorAddress, priorEmailVerified: captured.priorEmailVerified }), { execute: true });
  assert.equal((await auth.getUser(drv.uid)).email, drv.prior, "Auth rollback succeeded (prior restored)");
  const failingFs = { ...fs, openSync: () => { throw new Error("injected disk failure"); } };
  assert.throws(() => rbCtx.recordCompletion({ personaOrder: ORDER, fs: failingFs }), /injected disk failure/);
  // Progression did NOT become suspended (still claimed); rollback artifact retained;
  // the operator would NOT delete it (main rethrows before secureUnlink).
  const st = gate.readState(stateFile, key, { authorizationId: "AUTHPR4-PROD-TEST", projectId: PROJECT, workflowIdentityHash: idHash, personaOrder: ORDER });
  assert.notEqual(st.status, "suspended");
  assert.equal(st.status, "claimed");
  assert.ok(fs.existsSync(fwd.capturedOut), "rollback artifact retained for governed reconciliation");
  // Later personas blocked (claim lock still held / not suspended).
  await assert.rejects(() => runProductionForward({ g, key, keyFile, stateFile, mappingFile, employeeId: "emp-rudy-parts-associate" }), /concurrent claim is held|blocking state|exact next persona/);
  fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(g.root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 7. CLI -- plain + gated production refusal against the REAL repo (PENDING)
// ---------------------------------------------------------------------------

const SCRIPT = path.resolve("scripts/authPr4RecoveryEmailMigration.js");

await okAsync("plain --execute / --rollback vs taylor-parts still refuse (never initialize SDK)", async () => {
  for (const flag of ["--execute", "--rollback"]) {
    const r = spawnSync(process.execPath, [SCRIPT, "--projectId", "taylor-parts", "--confirmProduction", "taylor-parts", flag, "--employeeId", "emp-rudy-driver", "--position", "1", "--mappingFile", "x", "--capturedStateFile", "y"], { cwd: path.resolve("."), env: process.env, encoding: "utf8" });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /Refusing to write against the production project/);
  }
});

await okAsync("gated --executeProduction vs taylor-parts refuses fail-closed (committed authorization is PENDING)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "authpr4-prodrefuse-"));
  const keyFile = path.join(dir, "k"); fs.writeFileSync(keyFile, crypto.randomBytes(48));
  const head = gate.deriveRepositoryIdentity(REAL_ROOT).head;
  const r = spawnSync(process.execPath, [SCRIPT, "--projectId", "taylor-parts", "--confirmProduction", "taylor-parts", "--executeProduction",
    "--authorizedCommit", head, "--executionModeConfirmation", "x", "--executor", "x",
    "--progressionFile", path.join(dir, "s.json"), "--stateKeyFile", keyFile, "--mappingFile", path.join(dir, "m.json"), "--capturedStateOut", path.join(dir, "o.json")],
    { cwd: path.resolve("."), env: process.env, encoding: "utf8" });
  assert.notEqual(r.status, 0, "must refuse");
  // Fail-closed reason: committed artifact is PENDING ("not GRANTED"); or, in a
  // dirty dev working tree, the clean-checkout guard; or a missing progression.
  assert.match(r.stderr, /not GRANTED|clean checkout|Progression state missing/);
  fs.rmSync(dir, { recursive: true, force: true });
});

console.log(`\n${passed} passed (pure-helper + Auth-emulator layers)`);
process.exit(0);
