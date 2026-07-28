// AUTH-PR-4 -- Production-enablement authorization gate (security-hardened).
//
// Governing design:
//   docs/deployment/auth-pr-4-production-enablement-design.md  (merged, PR #455)
//
// This gate is consulted by the operator workflow before any PRODUCTION-shaped
// write (`--executeProduction`). It fails closed on anything missing/invalid/
// tampered/stale/replayed/concurrent/out-of-order. It authorizes nothing by
// itself: authority comes ONLY from a COMMITTED, git-tracked authorization
// artifact whose status is explicitly GRANTED. The committed artifact is PENDING,
// so production is blocked until the Owner records a real granted authorization
// through repository governance.
//
// HARDENING (Codex round 2):
//   C1 Authorization authority is a repository-governed artifact
//      (functions/authpr4/production-authorization.json), read from git AT the
//      authorized commit (not an operator-authored path). Exact bytes must be
//      present in the authorized/attested commit; SHA-256 recorded; status GRANTED;
//      project/order/reviewedHead/governed hashes/authId/executor/execution-mode
//      all exactly match; the operator's execution-mode confirmation must equal the
//      repository-derived token ("nonempty" is not authorization).
//   C2 Attempt-bound state machine: monotonic revision + previous-state-hash chain
//      + high-water anchor (replay detection) + O_EXCL claim lock with a bounded
//      lease (concurrency). Only the claim owner may record completion. Stale
//      takeover is explicit and preserves prior-attempt evidence.
//   C3 Crash-safe two-phase lifecycle: persist a CLAIMED/pending attempt before the
//      Auth call; record a durable outcome tied to the owning attempt; on any
//      uncertainty stay uncertain/recovery_required and block later personas; never
//      auto-revert to eligible. Governed reconciliation is production-disabled here.
//   C4 Strict schemas + temporal controls on every artifact.
//   C5 Requires a clean git checkout; fails closed in non-git contexts.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const PRODUCTION_PROJECT_ID = "taylor-parts";

const GOVERNED_FILES = Object.freeze([
  "functions/scripts/authPr4RecoveryEmailMigration.js",
  "functions/scripts/authPr4ProductionGate.js",
]);
const AUTH_ARTIFACT_PATH = "functions/authpr4/production-authorization.json";
const AUTH_SCHEMA = "authpr4.production-authorization/v1";

const PROGRESSION_VERSION = 2;
const ANCHOR_VERSION = 1;
const LOCK_VERSION = 1;
const BREAKGLASS_VERSION = 1;
const BREAKGLASS_POSITION = 5;

const MAX_STR = 512;
const MAX_LEASE_SEC = 3600;
const MAX_WINDOW_SEC = 3600;
const STATES = Object.freeze(["eligible", "claimed", "completed", "uncertain", "recovery_required", "suspended"]);
const GENESIS_HASH = crypto.createHash("sha256").update("authpr4-genesis").digest("hex");

// ---------------------------------------------------------------------------
// C4 -- strict validation primitives
// ---------------------------------------------------------------------------

const FULL_SHA_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const AUTH_ID_RE = /^[A-Z0-9][A-Z0-9-]{2,63}$/;
const UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

function isFullSha(s) { return typeof s === "string" && FULL_SHA_RE.test(s); }
function isSha256(s) { return typeof s === "string" && SHA256_RE.test(s); }
function isCanonicalAuthId(s) { return typeof s === "string" && AUTH_ID_RE.test(s); }
function isBoundedInt(n, min, max) { return Number.isInteger(n) && n >= min && n <= max; }
function isUtcInstant(s) {
  return typeof s === "string" && s.length <= 40 && UTC_RE.test(s) && Number.isFinite(Date.parse(s));
}
function isBoundedString(s, max = MAX_STR) {
  return typeof s === "string" && s.length > 0 && s.length <= max;
}
// Exact shape: object (not array/null), keys === allowed EXACTLY (no missing/extra).
function assertExactShape(obj, allowed, label) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) throw new Error(`${label}: not an object.`);
  const keys = Object.keys(obj).sort();
  const exp = [...allowed].sort();
  if (keys.length !== exp.length || keys.some((k, i) => k !== exp[i])) {
    throw new Error(`${label}: schema mismatch (missing/extra/unknown fields).`);
  }
}
function sha256Hex(buf) { return crypto.createHash("sha256").update(buf).digest("hex"); }
function hmac(canonical, key) { return crypto.createHmac("sha256", key).update(canonical).digest("hex"); }
function timingSafeHexEqual(a, b) {
  if (!isSha256(a) && !/^[0-9a-f]+$/.test(a || "")) return false;
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  const ab = Buffer.from(a, "hex"); const bb = Buffer.from(b, "hex");
  return ab.length === bb.length && ab.length > 0 && crypto.timingSafeEqual(ab, bb);
}

// ---------------------------------------------------------------------------
// C5 -- git required; fail closed in non-git contexts; clean-tree check
// ---------------------------------------------------------------------------

function git(repoRoot, argsArr, deps = {}) {
  const exec = deps.execFileSync || execFileSync;
  return exec("git", ["-C", repoRoot, ...argsArr], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
}
function gitBytes(repoRoot, argsArr, deps = {}) {
  const exec = deps.execFileSync || execFileSync;
  return exec("git", ["-C", repoRoot, ...argsArr], { maxBuffer: 8 * 1024 * 1024 });
}

// Requires a real git checkout. Non-git contexts fail CLOSED (no path fallback).
function resolveRepoRoot(deps = {}) {
  const start = deps.repoRoot || path.resolve(__dirname, "..", "..");
  try {
    return git(start, ["rev-parse", "--show-toplevel"], deps).trim();
  } catch (err) {
    throw new Error(
      "Production authorization requires a clean git checkout; this is not a git context, so it fails closed " +
        `(design §5.4/C5). ${err.message}`,
    );
  }
}

// The governed files (and the authorization artifact) must be tracked and
// unmodified vs HEAD -- a dirty working tree fails closed.
function assertCleanGovernedTree(repoRoot, deps = {}) {
  const targets = [...GOVERNED_FILES, AUTH_ARTIFACT_PATH];
  const out = git(repoRoot, ["status", "--porcelain", "--", ...targets], deps).trim();
  if (out) throw new Error("Refusing: governed files or the authorization artifact are modified/untracked in the working tree (not a clean checkout).");
}

// On-disk hashing (retained for callers that want the working-tree bytes).
function deriveGovernedFileHashes(repoRoot, deps = {}) {
  const readFileSync = deps.readFileSync || fs.readFileSync;
  const out = {};
  for (const rel of GOVERNED_FILES) {
    let bytes;
    try { bytes = readFileSync(path.join(repoRoot, rel)); }
    catch (err) { throw new Error(`Governed file missing/unreadable: ${rel} (${err.message}).`); }
    out[rel] = sha256Hex(bytes);
  }
  return out;
}

// Blob-based governed-file hashes at a specific commit -- DETERMINISTIC across
// platforms/EOL settings (the git blob is normalized content, unlike a Windows
// CRLF working copy). This is the authoritative source for authorization hashes.
function governedHashesAtCommit(repoRoot, commit, deps = {}) {
  const out = {};
  for (const rel of GOVERNED_FILES) {
    out[rel] = sha256Hex(gitFileBytesAtCommit(repoRoot, commit, rel, deps));
  }
  return out;
}
function workflowIdentityHash(governedFileHashes) {
  return sha256Hex(JSON.stringify(Object.keys(governedFileHashes).sort().map((k) => [k, governedFileHashes[k]])));
}

// Bytes of a repository file AT a specific commit (proves tracked + present in
// that commit; external/untracked/path-substituted files are not readable here).
function gitFileBytesAtCommit(repoRoot, commit, relPath, deps = {}) {
  try {
    return gitBytes(repoRoot, ["cat-file", "-p", `${commit}:${relPath}`], deps);
  } catch (err) {
    throw new Error(`"${relPath}" is not present/tracked in commit ${commit} (untracked/external/wrong path). ${err.message}`);
  }
}

function deriveRepositoryIdentity(repoRoot, deps = {}) {
  const head = git(repoRoot, ["rev-parse", "HEAD"], deps).trim();
  const isAncestor = (commit) => {
    if (!isFullSha(commit)) return false;
    try { git(repoRoot, ["merge-base", "--is-ancestor", commit, "HEAD"], deps); return true; }
    catch { return false; }
  };
  return { head, isAncestor };
}
function verifyRepositoryIdentity({ reviewedHead, authorizedCommit }, repoIdentity) {
  if (!isFullSha(reviewedHead)) throw new Error("Authorization reviewedHead is not a canonical full commit SHA.");
  if (!isFullSha(authorizedCommit)) throw new Error("--authorizedCommit must be a canonical full 40-hex commit SHA.");
  if (!(repoIdentity.head === authorizedCommit || repoIdentity.isAncestor(authorizedCommit))) {
    throw new Error("--authorizedCommit is not the current HEAD nor an ancestor of it (design §5.4a).");
  }
  if (!(repoIdentity.head === reviewedHead || repoIdentity.isAncestor(reviewedHead))) {
    throw new Error("Authorization reviewedHead is not in the repository ancestry.");
  }
  return true;
}

// ---------------------------------------------------------------------------
// C1 -- repository-governed authorization artifact (read from git @ commit)
// ---------------------------------------------------------------------------

const AUTH_FIELDS = Object.freeze([
  "schema", "authorizationId", "authorizationStatus", "projectId", "personaOrder",
  "reviewedHead", "governedFileHashes", "executionModeToken", "executor", "breakGlassContract",
]);

function loadGovernedAuthorization({ repoRoot, authorizedCommit }, deps = {}) {
  if (!isFullSha(authorizedCommit)) throw new Error("--authorizedCommit is required (canonical full 40-hex commit SHA).");
  const bytes = gitFileBytesAtCommit(repoRoot, authorizedCommit, AUTH_ARTIFACT_PATH, deps);
  const artifactSha = sha256Hex(bytes);
  let artifact;
  try { artifact = JSON.parse(bytes.toString("utf8")); }
  catch (err) { throw new Error(`Authorization artifact is not valid JSON: ${err.message}`); }
  return { artifact, artifactSha };
}

// Fails closed unless status is explicitly GRANTED and every field exactly
// matches the target project, built-in order, reviewed hashes, and the operator's
// execution-mode confirmation / executor value.
function verifyGovernedAuthorization(artifact, { projectId, personaOrder, derivedHashes, repoIdentity, authorizedCommit, executionModeConfirmation, executor }) {
  assertExactShape(artifact, AUTH_FIELDS, "authorization artifact");
  if (artifact.schema !== AUTH_SCHEMA) throw new Error("Authorization artifact has an unexpected schema.");
  if (artifact.authorizationStatus !== "GRANTED") {
    throw new Error(`Authorization is not GRANTED (status="${artifact.authorizationStatus}") -- production execution fails closed.`);
  }
  if (!isCanonicalAuthId(artifact.authorizationId)) throw new Error("Authorization artifact authorizationId is not canonical.");
  if (artifact.projectId !== projectId) throw new Error("Authorization artifact projectId does not match the target project.");
  if (!Array.isArray(artifact.personaOrder) || artifact.personaOrder.length !== personaOrder.length ||
      artifact.personaOrder.some((p, i) => p !== personaOrder[i])) {
    throw new Error("Authorization artifact personaOrder does not match the governed sequence.");
  }
  verifyRepositoryIdentity({ reviewedHead: artifact.reviewedHead, authorizedCommit }, repoIdentity);
  // Governed-file hashes: exact keys, lowercase sha256, and equal to the on-disk
  // (reviewed) code -- any post-review change invalidates.
  assertExactShape(artifact.governedFileHashes, GOVERNED_FILES, "governedFileHashes");
  for (const rel of GOVERNED_FILES) {
    if (!isSha256(artifact.governedFileHashes[rel])) throw new Error(`governedFileHashes[${rel}] is not a canonical lowercase sha256.`);
    if (artifact.governedFileHashes[rel] !== derivedHashes[rel]) {
      throw new Error(`Governed-file hash mismatch for ${rel} -- running code differs from the reviewed authorization (design §5.4).`);
    }
  }
  // Execution-mode confirmation: must MATCH the repository-derived token; nonempty is not authorization.
  if (!isBoundedString(artifact.executionModeToken, 128)) throw new Error("Authorization artifact executionModeToken is missing/oversized.");
  if (executionModeConfirmation !== artifact.executionModeToken) {
    throw new Error("--executionModeConfirmation does not match the repository-derived authorized execution-mode token.");
  }
  // Executor contract.
  assertExactShape(artifact.executor, ["name"], "authorization executor");
  if (!isBoundedString(artifact.executor.name, 128)) throw new Error("Authorization executor.name is missing/oversized.");
  if (executor !== artifact.executor.name) throw new Error("--executor does not match the repository-governed authorized executor.");
  // Break-glass contract.
  assertExactShape(artifact.breakGlassContract, ["validityWindowSeconds", "requiredConfirmer"], "breakGlassContract");
  if (!isBoundedInt(artifact.breakGlassContract.validityWindowSeconds, 1, MAX_WINDOW_SEC)) {
    throw new Error("breakGlassContract.validityWindowSeconds is out of bounds.");
  }
  if (!isBoundedString(artifact.breakGlassContract.requiredConfirmer, 128)) throw new Error("breakGlassContract.requiredConfirmer is missing/oversized.");
  return artifact;
}

// ---------------------------------------------------------------------------
// C4 -- state-key + atomic protected writes
// ---------------------------------------------------------------------------

function loadStateKey(stateKeyFile, deps = {}) {
  const readFileSync = deps.readFileSync || fs.readFileSync;
  if (!stateKeyFile) throw new Error("A protected --stateKeyFile is required for production authorization.");
  const key = readFileSync(stateKeyFile);
  if (key.length < 32) throw new Error("--stateKeyFile must contain at least 32 bytes of protected key material.");
  return key;
}
function atomicWrite(file, contents, deps = {}) {
  const _fs = deps.fs || fs;
  const tmp = `${file}.tmp-${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
  const fd = _fs.openSync(tmp, "wx", 0o600);
  try {
    _fs.writeSync(fd, contents);
    _fs.fsyncSync(fd);
  } finally {
    _fs.closeSync(fd);
  }
  _fs.renameSync(tmp, file);
  try { _fs.chmodSync(file, 0o600); } catch { /* Windows ACLs operator-managed */ }
}

// ---------------------------------------------------------------------------
// C2/C3 -- attempt-bound progression state machine (state + anchor + lock)
// ---------------------------------------------------------------------------

const PROGRESSION_FIELDS = Object.freeze([
  "version", "authorizationId", "projectId", "workflowIdentityHash", "personaOrder",
  "revision", "previousStateHash", "status", "completed", "attempt", "lastOutcome", "updatedAt",
]);
const ATTEMPT_FIELDS = Object.freeze(["attemptId", "mode", "targetPersona", "claimedAt", "leaseExpiresAt"]);
const OUTCOME_FIELDS = Object.freeze(["attemptId", "mode", "targetPersona", "result", "at"]);

function progressionCanonical(p) { return JSON.stringify(PROGRESSION_FIELDS.map((f) => [f, p[f]])); }
function signProgression(p, key) { return hmac(progressionCanonical(p), key); }
function progressionHash(p) { return sha256Hex(progressionCanonical(p)); }

function genesisState({ authorizationId, projectId, workflowIdentityHash, personaOrder }, deps = {}) {
  const now = (deps.now ? deps.now() : new Date()).toISOString();
  return {
    version: PROGRESSION_VERSION, authorizationId, projectId, workflowIdentityHash, personaOrder,
    revision: 0, previousStateHash: GENESIS_HASH, status: "eligible", completed: [],
    attempt: null, lastOutcome: null, updatedAt: now,
  };
}

function validateStatePayload(p, expected) {
  assertExactShape(p, [...PROGRESSION_FIELDS, "signature"], "progression");
  if (p.version !== PROGRESSION_VERSION) throw new Error("Progression version unsupported.");
  if (!isCanonicalAuthId(p.authorizationId)) throw new Error("Progression authorizationId not canonical.");
  if (typeof p.projectId !== "string") throw new Error("Progression projectId invalid.");
  if (!isSha256(p.workflowIdentityHash)) throw new Error("Progression workflowIdentityHash invalid.");
  if (!Array.isArray(p.personaOrder)) throw new Error("Progression personaOrder invalid.");
  if (!isBoundedInt(p.revision, 0, 1e9)) throw new Error("Progression revision out of bounds.");
  if (!isSha256(p.previousStateHash)) throw new Error("Progression previousStateHash invalid.");
  if (!STATES.includes(p.status)) throw new Error("Progression status invalid.");
  if (!Array.isArray(p.completed)) throw new Error("Progression completed invalid.");
  if (!isUtcInstant(p.updatedAt)) throw new Error("Progression updatedAt is not a valid UTC instant.");
  if (p.attempt !== null) {
    assertExactShape(p.attempt, ATTEMPT_FIELDS, "progression.attempt");
    if (!isBoundedString(p.attempt.attemptId, 128) || !["forward", "rollback"].includes(p.attempt.mode) ||
        !isBoundedString(p.attempt.targetPersona, 128) || !isUtcInstant(p.attempt.claimedAt) || !isUtcInstant(p.attempt.leaseExpiresAt)) {
      throw new Error("Progression.attempt has invalid fields.");
    }
    // Attempt lease expiry must be strictly later than claim time.
    if (Date.parse(p.attempt.leaseExpiresAt) <= Date.parse(p.attempt.claimedAt)) {
      throw new Error("Progression.attempt leaseExpiresAt is not later than claimedAt.");
    }
  }
  if (p.lastOutcome !== null) {
    assertExactShape(p.lastOutcome, OUTCOME_FIELDS, "progression.lastOutcome");
    if (!isBoundedString(p.lastOutcome.attemptId, 128) || !["forward", "rollback"].includes(p.lastOutcome.mode) ||
        !isBoundedString(p.lastOutcome.targetPersona, 128) || !isBoundedString(p.lastOutcome.result, 128) ||
        !isUtcInstant(p.lastOutcome.at)) {
      throw new Error("Progression.lastOutcome has invalid/bounded/UTC fields.");
    }
  }
  // Binding.
  if (p.authorizationId !== expected.authorizationId) throw new Error("Progression bound to a different authorization (conflicting).");
  if (p.projectId !== expected.projectId) throw new Error("Progression bound to a different project (conflicting).");
  if (p.workflowIdentityHash !== expected.workflowIdentityHash) throw new Error("Progression bound to a different (stale) workflow identity.");
  if (p.personaOrder.length !== expected.personaOrder.length || p.personaOrder.some((x, i) => x !== expected.personaOrder[i])) {
    throw new Error("Progression persona order does not match the governed sequence.");
  }
  // completed must be a valid, in-order, duplicate-free prefix of the sequence.
  if (p.completed.length > expected.personaOrder.length) throw new Error("Progression completed longer than the sequence.");
  p.completed.forEach((id, i) => { if (id !== expected.personaOrder[i]) throw new Error("Progression completed list is not a valid in-order prefix (dup/out-of-order)."); });
  // Status invariants (reject impossible combinations even with a valid HMAC).
  if (p.status === "eligible" && p.attempt !== null) throw new Error("Invariant: eligible state must have attempt=null.");
  if (p.status === "claimed" && p.attempt === null) throw new Error("Invariant: claimed state must have an attempt.");
  if ((p.status === "uncertain" || p.status === "recovery_required") && p.lastOutcome === null) {
    throw new Error("Invariant: uncertain/recovery_required must preserve the affected attempt in lastOutcome.");
  }
  if (p.status === "suspended" && (p.lastOutcome === null || p.lastOutcome.mode !== "rollback")) {
    throw new Error("Invariant: suspended must represent a governed rollback outcome.");
  }
}

function readState(file, key, expected, deps = {}) {
  const _fs = deps.fs || fs;
  let artifact;
  try { artifact = JSON.parse(_fs.readFileSync(file, "utf8")); }
  catch (err) { throw new Error(`Progression state missing/malformed: ${err.message}`); }
  if (!artifact || typeof artifact !== "object" || typeof artifact.signature !== "string") throw new Error("Progression state malformed.");
  const { signature, ...payload } = artifact;
  validateStatePayload({ ...payload, signature }, expected); // shape incl. signature
  if (!timingSafeHexEqual(signature, signProgression(payload, key))) throw new Error("Progression state failed integrity verification (tampered/wrong key).");
  return payload;
}

// Anchor: signed high-water mark -> detects restoration of an older signed state.
const ANCHOR_FIELDS = Object.freeze(["version", "authorizationId", "highWaterRevision", "stateHash", "updatedAt"]);
function anchorPath(stateFile) { return `${stateFile}.anchor`; }
function anchorCanonical(a) { return JSON.stringify(ANCHOR_FIELDS.map((f) => [f, a[f]])); }
function signAnchor(a, key) { return hmac(anchorCanonical(a), key); }
function writeAnchor(stateFile, { authorizationId, highWaterRevision, stateHash }, key, deps = {}) {
  const now = (deps.now ? deps.now() : new Date()).toISOString();
  const payload = { version: ANCHOR_VERSION, authorizationId, highWaterRevision, stateHash, updatedAt: now };
  atomicWrite(anchorPath(stateFile), JSON.stringify({ ...payload, signature: signAnchor(payload, key) }), deps);
}
function readAnchor(stateFile, key, deps = {}) {
  const _fs = deps.fs || fs;
  const p = anchorPath(stateFile);
  if (!_fs.existsSync(p)) return null;
  let art;
  try { art = JSON.parse(_fs.readFileSync(p, "utf8")); } catch (err) { throw new Error(`Anchor malformed: ${err.message}`); }
  assertExactShape(art, [...ANCHOR_FIELDS, "signature"], "anchor");
  const { signature, ...payload } = art;
  if (!isBoundedInt(payload.highWaterRevision, 0, 1e9) || !isSha256(payload.stateHash) || !isUtcInstant(payload.updatedAt)) {
    throw new Error("Anchor has invalid fields.");
  }
  if (!timingSafeHexEqual(signature, signAnchor(payload, key))) throw new Error("Anchor failed integrity verification.");
  return payload;
}
// Fresh state must be at the anchor's high-water revision + hash. A restored older
// state (lower revision / different hash) fails closed.
function verifyStateFreshness(stateFile, state, key, deps = {}) {
  const anchor = readAnchor(stateFile, key, deps);
  if (!anchor) {
    if (state.revision !== 0) throw new Error("Missing anchor for a non-genesis progression state (possible replay).");
    return;
  }
  if (anchor.authorizationId !== state.authorizationId) throw new Error("Anchor bound to a different authorization.");
  if (state.revision !== anchor.highWaterRevision || progressionHash(state) !== anchor.stateHash) {
    throw new Error("Progression state is stale/replayed: it does not match the high-water anchor. Fail closed.");
  }
}

// Lock: exclusive O_EXCL claim with a bounded lease.
const LOCK_FIELDS = Object.freeze(["version", "authorizationId", "attemptId", "mode", "targetPersona", "revision", "claimedAt", "leaseExpiresAt"]);
function lockPath(stateFile) { return `${stateFile}.lock`; }
// Strict lock validation: rejects malformed values (not only unknown/missing
// fields). Uses the injected fs consistently.
function readLock(stateFile, deps = {}) {
  const _fs = deps.fs || fs;
  const p = lockPath(stateFile);
  if (!_fs.existsSync(p)) return null;
  let art;
  try { art = JSON.parse(_fs.readFileSync(p, "utf8")); } catch (err) { throw new Error(`Lock malformed: ${err.message}`); }
  assertExactShape(art, LOCK_FIELDS, "lock");
  if (art.version !== LOCK_VERSION) throw new Error("Lock version unsupported.");
  if (!isCanonicalAuthId(art.authorizationId)) throw new Error("Lock authorizationId not canonical.");
  if (!isBoundedString(art.attemptId, 128)) throw new Error("Lock attemptId invalid.");
  if (!["forward", "rollback"].includes(art.mode)) throw new Error("Lock mode invalid.");
  if (!isBoundedString(art.targetPersona, 128)) throw new Error("Lock targetPersona invalid.");
  if (!isBoundedInt(art.revision, 0, 1e9)) throw new Error("Lock revision out of bounds.");
  if (!isUtcInstant(art.claimedAt) || !isUtcInstant(art.leaseExpiresAt)) throw new Error("Lock timestamps are not valid UTC instants.");
  const claimed = Date.parse(art.claimedAt); const lease = Date.parse(art.leaseExpiresAt);
  if (!(lease > claimed)) throw new Error("Lock leaseExpiresAt is not strictly later than claimedAt.");
  if (lease - claimed > MAX_LEASE_SEC * 1000) throw new Error("Lock lease duration exceeds the bound.");
  return art;
}
function leaseExpired(lock, now) { return Date.parse(lock.leaseExpiresAt) <= now.getTime(); }

// Acquire an exclusive claim. Returns the lock. Concurrent unexpired lock -> refuse.
// An expired lock is an explicit STALE takeover: it records the prior attempt as
// uncertain (evidence preserved) and BLOCKS via recovery_required rather than
// silently proceeding.
function acquireClaim(stateFile, { authorizationId, attemptId, mode, targetPersona, revision, leaseSeconds }, deps = {}) {
  const _fs = deps.fs || fs;
  const now = deps.now ? deps.now() : new Date();
  const p = lockPath(stateFile);
  const lock = {
    version: LOCK_VERSION, authorizationId, attemptId, mode, targetPersona, revision,
    claimedAt: now.toISOString(), leaseExpiresAt: new Date(now.getTime() + leaseSeconds * 1000).toISOString(),
  };
  try {
    const fd = _fs.openSync(p, "wx", 0o600); // O_EXCL: fails if a claim is held
    try { _fs.writeSync(fd, JSON.stringify(lock)); _fs.fsyncSync(fd); } finally { _fs.closeSync(fd); }
    return { lock, tookOver: null };
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
    const existing = readLock(stateFile, deps);
    if (!leaseExpired(existing, now)) {
      throw new Error("A concurrent claim is held (unexpired lease); refusing to run two workers on the same identity.");
    }
    // Explicit stale takeover -- caller records prior-attempt uncertainty + recovery_required.
    return { lock: null, tookOver: existing };
  }
}
function releaseClaim(stateFile, attemptId, deps = {}) {
  const _fs = deps.fs || fs;
  const existing = readLock(stateFile, deps);
  if (existing && existing.attemptId !== attemptId) {
    throw new Error("Refusing to release a claim owned by a different attempt (stale worker).");
  }
  try { _fs.unlinkSync(lockPath(stateFile)); } catch { /* already gone */ }
}
function assertOwnsClaim(stateFile, attemptId, deps = {}) {
  const existing = readLock(stateFile, deps);
  if (!existing || existing.attemptId !== attemptId) {
    throw new Error("This attempt no longer owns the claim (taken over / released); refusing to record state.");
  }
}

// LIVE ATTEMPT OWNERSHIP -- verified immediately before every outcome write. A
// stale/expired/superseded worker must never modify progression state. Returns the
// re-read current CLAIMED state to use as the commit predecessor.
function assertLiveOwnership(stateFile, key, ctx, deps = {}) {
  const now = deps.now ? deps.now() : new Date();
  const lock = readLock(stateFile, deps); // strict-validated (throws on malformed)
  if (!lock) throw new Error("No claim lock present; refusing to record outcome (stale/released).");
  if (lock.version !== LOCK_VERSION) throw new Error("Lock version unsupported.");
  if (lock.authorizationId !== ctx.authorizationId) throw new Error("Lock authorization mismatch.");
  if (lock.attemptId !== ctx.attemptId) throw new Error("Lock is owned by a different attempt (superseded/stale).");
  if (lock.mode !== ctx.mode || lock.targetPersona !== ctx.targetPersona) throw new Error("Lock mode/target mismatch.");
  if (lock.revision !== ctx.predecessorRevision) throw new Error("Lock predecessor revision mismatch.");
  if (leaseExpired(lock, now)) throw new Error("Claim lease has EXPIRED; refusing to record outcome.");
  const cur = readState(stateFile, key, ctx.expected, deps);
  verifyStateFreshness(stateFile, cur, key, deps); // high-water anchor
  if (cur.status !== "claimed") throw new Error(`Progression is no longer "claimed" (status="${cur.status}"); refusing outcome (superseded/recovered).`);
  if (cur.revision !== ctx.claimedRevision) throw new Error("Progression revision changed since the claim; refusing outcome.");
  if (progressionHash(cur) !== ctx.claimedHash) throw new Error("Progression state hash changed since the claim; refusing outcome.");
  const a = cur.attempt;
  if (!a || a.attemptId !== ctx.attemptId || a.mode !== ctx.mode || a.targetPersona !== ctx.targetPersona ||
      a.claimedAt !== lock.claimedAt || a.leaseExpiresAt !== lock.leaseExpiresAt) {
    throw new Error("Progression.attempt does not exactly match the live lock and caller; refusing outcome.");
  }
  return cur;
}

// STATE-TRANSITION MUTEX -- an exclusive, short-lived local lock (`.txn`) that
// SERIALIZES every progression state mutation, closing the TOCTOU window between
// an ownership/freshness re-check and the commit. The re-read + revalidate + commit
// of state and the high-water anchor all happen while holding it. It is purely
// local and MUST NOT be held across any Auth/network side effect.
//
// FAIL-CLOSED OWNERSHIP (round 5): the mutex is NEVER auto-broken. A held `.txn`
// causes a fail-closed refusal -- a leftover mutex from a crashed step is a governed
// reconciliation condition requiring inspected cleanup, not an automatic takeover
// (which could let a third writer in). Cleanup is OWNER-BOUND: each holder writes a
// cryptographically random token and, in finally, removes the mutex ONLY if the
// on-disk token still equals its own -- so a former holder can never delete a
// different owner's mutex.
const TXN_MUTEX_VERSION = 1;
const TXN_MUTEX_FIELDS = Object.freeze(["version", "token", "at"]);
const TXN_TOKEN_RE = /^[0-9a-f]{32}$/;
function txnPath(stateFile) { return `${stateFile}.txn`; }

// Verify the on-disk transition mutex is present, well-formed, and owned by the
// caller-provided token (safe comparison). Mutex existence alone is NOT authority.
function assertMutexOwner(stateFile, ownerToken, deps = {}) {
  const _fs = deps.fs || fs;
  let raw;
  try { raw = _fs.readFileSync(txnPath(stateFile), "utf8"); }
  catch { throw new Error("commitState() requires a held transition mutex (absent/unreadable)."); }
  let m;
  try { m = JSON.parse(raw); } catch { throw new Error("Transition mutex is malformed (unparseable)."); }
  assertExactShape(m, TXN_MUTEX_FIELDS, "transition mutex");
  if (m.version !== TXN_MUTEX_VERSION) throw new Error("Transition mutex version unsupported.");
  if (typeof m.token !== "string" || !TXN_TOKEN_RE.test(m.token)) throw new Error("Transition mutex token is not canonical.");
  if (!isUtcInstant(m.at)) throw new Error("Transition mutex timestamp is not a valid UTC instant.");
  if (typeof ownerToken !== "string" || !TXN_TOKEN_RE.test(ownerToken) || !timingSafeHexEqual(m.token, ownerToken)) {
    throw new Error("commitState() token does not match the held transition-mutex owner (foreign/absent mutex).");
  }
}
function withTransition(stateFile, deps, fn) {
  const _fs = deps.fs || fs;
  const now = deps.now ? deps.now() : new Date();
  const p = txnPath(stateFile);
  const token = crypto.randomBytes(16).toString("hex");
  let fd;
  try {
    fd = _fs.openSync(p, "wx", 0o600); // O_EXCL: fail closed if held (never auto-break)
  } catch (err) {
    if (err.code === "EEXIST") {
      throw new Error("State-transition mutex is held: a prior step is in progress or left a leftover mutex; governed reconciliation / inspected cleanup is required before another production step.");
    }
    throw err;
  }
  try { _fs.writeSync(fd, JSON.stringify({ version: TXN_MUTEX_VERSION, token, at: now.toISOString() })); _fs.fsyncSync(fd); } finally { _fs.closeSync(fd); }
  try {
    // The callback receives the owner token; every commitState() it performs must
    // present it, so "file exists" alone is never sufficient authority.
    return fn(token);
  } finally {
    // Owner-bound cleanup: remove ONLY a mutex that still carries our token.
    try {
      const held = JSON.parse(_fs.readFileSync(p, "utf8"));
      if (held && typeof held === "object" && held.token === token) _fs.unlinkSync(p);
    } catch { /* gone/unreadable/foreign -> leave for governed reconciliation */ }
  }
}

function nextEligiblePersona(state, personaOrder) {
  if (state.status !== "eligible") return null;
  if (state.completed.length >= personaOrder.length) return null;
  return { employeeId: personaOrder[state.completed.length], position: state.completed.length + 1 };
}

// Build a signed successor state (revision+1, chained) and return {payload, signed}.
function nextState(prev, changes, key, deps = {}) {
  const now = (deps.now ? deps.now() : new Date()).toISOString();
  const payload = {
    ...prev, ...changes,
    revision: prev.revision + 1,
    previousStateHash: progressionHash(prev),
    updatedAt: now,
  };
  return { payload, signed: JSON.stringify({ ...payload, signature: signProgression(payload, key) }) };
}
// ARCHITECTURAL GUARD (round 5): every RUNTIME progression transition must run
// inside withTransition() (which creates the `.txn` mutex first). commitState
// therefore refuses unless the transition mutex is currently held -- so a newly
// introduced unprotected commitState() call fails closed at runtime (caught by
// tests). Genesis creation is separate (it does not call commitState).
function commitState(stateFile, prev, changes, key, deps = {}, ownerToken) {
  // Token-bound: the caller must present the owner token issued by withTransition()
  // and matching the on-disk mutex. Mere existence is never sufficient authority --
  // a foreign-owned or malformed mutex fails closed.
  assertMutexOwner(stateFile, ownerToken, deps);
  const { payload, signed } = nextState(prev, changes, key, deps);
  atomicWrite(stateFile, signed, deps);
  writeAnchor(stateFile, { authorizationId: payload.authorizationId, highWaterRevision: payload.revision, stateHash: progressionHash(payload) }, key, deps);
  return payload;
}

// ---------------------------------------------------------------------------
// Break-glass confirmation (position 5) -- strict + temporal (C4)
// ---------------------------------------------------------------------------

const BREAKGLASS_FIELDS = Object.freeze([
  "version", "authorizationId", "progressionHash", "position", "confirmer", "createdAt", "validityWindowSeconds", "sanitizedResult",
]);
function breakGlassCanonical(p) { return JSON.stringify(BREAKGLASS_FIELDS.map((f) => [f, p[f]])); }
function signBreakGlass(p, key) { return hmac(breakGlassCanonical(p), key); }
function readAndVerifyBreakGlass(file, key, { authorizationId, currentProgressionHash, requiredConfirmer, contractWindowSeconds, now }, deps = {}) {
  const readFileSync = deps.readFileSync || fs.readFileSync;
  let art;
  try { art = JSON.parse(readFileSync(file, "utf8")); } catch (err) { throw new Error(`Break-glass confirmation missing/malformed: ${err.message}`); }
  assertExactShape(art, [...BREAKGLASS_FIELDS, "signature"], "break-glass");
  const { signature, ...p } = art;
  if (p.version !== BREAKGLASS_VERSION) throw new Error("Break-glass version unsupported.");
  if (!timingSafeHexEqual(signature, signBreakGlass(p, key))) throw new Error("Break-glass confirmation failed integrity verification.");
  if (p.position !== BREAKGLASS_POSITION) throw new Error("Break-glass confirmation not bound to position 5.");
  if (!isCanonicalAuthId(p.authorizationId) || p.authorizationId !== authorizationId) throw new Error("Break-glass bound to a different authorization.");
  if (!isSha256(p.progressionHash) || p.progressionHash !== currentProgressionHash) {
    throw new Error("Break-glass not bound to the current progression state (created too early, reused after a change, or mismatched).");
  }
  if (!isBoundedString(p.confirmer, 128) || p.confirmer !== requiredConfirmer) throw new Error("Break-glass confirmer does not match the repository-governed contract.");
  if (!isUtcInstant(p.createdAt)) throw new Error("Break-glass createdAt is not a valid UTC instant.");
  if (!isBoundedInt(p.validityWindowSeconds, 1, MAX_WINDOW_SEC) || p.validityWindowSeconds !== contractWindowSeconds) {
    throw new Error("Break-glass validityWindowSeconds does not match the contract / is out of bounds.");
  }
  const created = Date.parse(p.createdAt); const nowMs = (now || new Date()).getTime();
  if (nowMs < created) throw new Error("Break-glass createdAt is in the future.");
  if (nowMs - created > p.validityWindowSeconds * 1000) throw new Error("Break-glass confirmation is EXPIRED.");
  assertExactShape(p.sanitizedResult, ["recoverable", "loginVerified"], "break-glass sanitizedResult");
  if (p.sanitizedResult.recoverable !== true || p.sanitizedResult.loginVerified !== true) throw new Error("Break-glass does not attest recoverable + login-verified.");
  return p;
}

// ---------------------------------------------------------------------------
// Master authorization check + claim (C1-C5). Runs BEFORE any SDK write.
// Returns a context; the workflow drives the two-phase lifecycle with the
// recordCompletion / recordUncertain helpers below.
// ---------------------------------------------------------------------------

function assertProductionAuthorization(args, deps = {}) {
  const now = deps.now || (() => new Date());
  if (!args.projectId) throw new Error("--projectId is required.");
  if (!args.mappingFile) throw new Error("--mappingFile (protected, out-of-band) is required.");
  if (!args.progressionFile) throw new Error("--progressionFile is required.");
  if (!isFullSha(args.authorizedCommit || "")) throw new Error("--authorizedCommit (canonical full 40-hex SHA) is required for a production write.");
  if (!isBoundedString(args.executionModeConfirmation || "", 128)) throw new Error("--executionModeConfirmation is required.");
  if (!isBoundedString(args.executor || "", 128)) throw new Error("--executor is required.");
  const stateKey = loadStateKey(args.stateKeyFile, deps);

  const repoRoot = resolveRepoRoot(deps);
  assertCleanGovernedTree(repoRoot, deps);
  const repoIdentity = deriveRepositoryIdentity(repoRoot, deps);

  // Governed-file hashes are BLOB-based and deterministic. The reviewed hashes
  // (at the authorized commit) must equal HEAD's (no post-review drift between the
  // authorized commit and the running checkout); assertCleanGovernedTree ensures
  // the working tree equals HEAD.
  const reviewedHashes = governedHashesAtCommit(repoRoot, args.authorizedCommit, deps);
  const headHashes = governedHashesAtCommit(repoRoot, repoIdentity.head, deps);
  for (const rel of GOVERNED_FILES) {
    if (reviewedHashes[rel] !== headHashes[rel]) {
      throw new Error(`Governed file ${rel} changed between the authorized commit and HEAD -- authorization invalid (design §5.4).`);
    }
  }
  const idHash = workflowIdentityHash(reviewedHashes);

  const { artifact } = loadGovernedAuthorization({ repoRoot, authorizedCommit: args.authorizedCommit }, deps);
  const authorization = verifyGovernedAuthorization(artifact, {
    projectId: args.projectId, personaOrder: deps.personaOrder, derivedHashes: reviewedHashes, repoIdentity,
    authorizedCommit: args.authorizedCommit, executionModeConfirmation: args.executionModeConfirmation, executor: args.executor,
  });

  const expected = { authorizationId: authorization.authorizationId, projectId: args.projectId, workflowIdentityHash: idHash, personaOrder: deps.personaOrder };
  const state = readState(args.progressionFile, stateKey, expected, deps);
  verifyStateFreshness(args.progressionFile, state, stateKey, deps);

  // Blocking states never proceed (crash-safe: never auto-revert to eligible).
  if (["uncertain", "recovery_required"].includes(state.status)) {
    throw new Error(`Progression is in a blocking state ("${state.status}") -- governed reconciliation required before any further production step.`);
  }
  if (state.status === "suspended") throw new Error("Progression is SUSPENDED (post-rollback); later personas are blocked.");
  if (state.status === "claimed") {
    // A prior attempt is mid-flight. A LIVE lease => concurrent worker => refuse.
    // An EXPIRED lease => the prior worker likely crashed mid-attempt (Auth outcome
    // unknown): perform an EXPLICIT takeover into recovery_required, preserving the
    // prior attempt's evidence, and STOP. It never auto-proceeds to a fresh mutation.
    const lock = readLock(args.progressionFile, deps);
    if (lock && !leaseExpired(lock, now())) {
      throw new Error("A concurrent claim is held (unexpired lease); refusing to run two workers on the same identity.");
    }
    // The takeover uses the SAME serialized transition path; re-read + revalidate
    // under the mutex so two concurrent takeovers cannot race the state/anchor
    // writes (the loser sees a non-claimed state and does not double-write).
    withTransition(args.progressionFile, deps, (txnToken) => {
      const cur = readState(args.progressionFile, stateKey, expected, deps);
      verifyStateFreshness(args.progressionFile, cur, stateKey, deps);
      if (cur.status !== "claimed") throw new Error(`Progression already transitioned to "${cur.status}"; no double-takeover.`);
      const lk = readLock(args.progressionFile, deps);
      if (lk && !leaseExpired(lk, now())) throw new Error("A concurrent claim is held (unexpired lease); refusing.");
      const prior = cur.attempt || (lk
        ? { attemptId: lk.attemptId, mode: lk.mode, targetPersona: lk.targetPersona }
        : { attemptId: "unknown", mode: "forward", targetPersona: cur.personaOrder[cur.completed.length] || cur.personaOrder[0] });
      commitState(args.progressionFile, cur, {
        status: "recovery_required", attempt: null,
        lastOutcome: { attemptId: prior.attemptId, mode: prior.mode, targetPersona: prior.targetPersona, result: "uncertain-stale-takeover", at: now().toISOString() },
      }, stateKey, deps, txnToken);
    });
    throw new Error("Stale claim taken over: prior attempt recorded recovery_required (governed reconciliation needed).");
  }

  const mode = args.rollback ? "rollback" : "forward";
  const leaseSeconds = isBoundedInt(deps.leaseSeconds, 1, MAX_LEASE_SEC) ? deps.leaseSeconds : 300;

  if (mode === "forward") {
    const next = nextEligiblePersona(state, deps.personaOrder);
    if (!next) throw new Error("No eligible next persona (progression complete or not eligible).");
    if (args.employeeId !== undefined && (args.employeeId !== next.employeeId || (args.position !== undefined && args.position !== next.position))) {
      throw new Error(`Only the exact next persona may proceed: expected ${next.employeeId} (position ${next.position}).`);
    }
    if (next.position === BREAKGLASS_POSITION && state.completed.length !== BREAKGLASS_POSITION - 1) {
      throw new Error("Positions 1-4 must be durably complete before position 5.");
    }
    if (!args.capturedStateOut) throw new Error("--capturedStateOut is required for a forward production write.");
    if (next.position === BREAKGLASS_POSITION) {
      if (!args.breakGlassConfirmationFile) throw new Error("Position 5 requires --breakGlassConfirmationFile.");
      readAndVerifyBreakGlass(args.breakGlassConfirmationFile, stateKey, {
        authorizationId: authorization.authorizationId, currentProgressionHash: progressionHash(state),
        requiredConfirmer: authorization.breakGlassContract.requiredConfirmer,
        contractWindowSeconds: authorization.breakGlassContract.validityWindowSeconds, now: now(),
      }, deps);
    }
    return acquireAndClaim({ args, state, stateKey, authorization, idHash, mode, targetPersona: next.employeeId, position: next.position, leaseSeconds, deps });
  }

  // rollback of the most recently completed persona
  if (!args.capturedStateFile) throw new Error("--rollback requires --capturedStateFile.");
  const last = state.completed[state.completed.length - 1];
  if (!last) throw new Error("Nothing to roll back (no completed persona).");
  if (args.employeeId !== undefined && args.employeeId !== last) throw new Error("Production rollback may only target the most recently completed persona.");
  return acquireAndClaim({ args, state, stateKey, authorization, idHash, mode, targetPersona: last, position: state.completed.length, leaseSeconds, deps });
}

// Acquire the exclusive claim and persist the CLAIMED (pending) state BEFORE the
// Auth call (C3). On a stale takeover, record recovery_required and fail closed.
function acquireAndClaim({ args, state, stateKey, authorization, idHash, mode, targetPersona, position, leaseSeconds, deps }) {
  const attemptId = `att-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
  const { lock, tookOver } = acquireClaim(args.progressionFile, {
    authorizationId: authorization.authorizationId, attemptId, mode, targetPersona, revision: state.revision, leaseSeconds,
  }, deps);
  if (tookOver) {
    // ORPHANED claim lock (a prior worker created the lock then crashed before
    // persisting "claimed", so state is still eligible). Route the recovery_required
    // transition through the SAME serialized mutex path: re-read + revalidate state,
    // anchor, and the stale lock under the mutex, confirm it is expired and bound to
    // the expected authorization context, commit recovery_required ONCE. A second
    // worker re-reads a non-eligible state and refuses without writing.
    const now = deps.now ? deps.now() : new Date();
    const expectedBinding = { authorizationId: authorization.authorizationId, projectId: args.projectId, workflowIdentityHash: idHash, personaOrder: deps.personaOrder };
    withTransition(args.progressionFile, deps, (txnToken) => {
      const cur = readState(args.progressionFile, stateKey, expectedBinding, deps);
      verifyStateFreshness(args.progressionFile, cur, stateKey, deps);
      if (cur.status !== "eligible") throw new Error(`Progression already transitioned to "${cur.status}"; no double recovery write.`);
      const lk = readLock(args.progressionFile, deps);
      if (!lk) throw new Error("Orphaned lock disappeared; re-run the governed step.");
      if (!leaseExpired(lk, now)) throw new Error("A concurrent claim is held (unexpired lease); refusing.");
      if (lk.authorizationId !== authorization.authorizationId) throw new Error("Orphaned lock is bound to a different authorization.");
      commitState(args.progressionFile, cur, {
        status: "recovery_required", attempt: null,
        lastOutcome: { attemptId: lk.attemptId, mode: lk.mode, targetPersona: lk.targetPersona, result: "uncertain-orphaned-lock", at: now.toISOString() },
      }, stateKey, deps, txnToken);
    });
    throw new Error("Orphaned stale claim lock: progression recorded recovery_required (governed reconciliation needed).");
  }
  // Persist CLAIMED (pending) before any Auth mutation, inside the transition mutex
  // (re-read + re-validate "eligible" + freshness under the mutex).
  const claimedState = withTransition(args.progressionFile, deps, (txnToken) => {
    const cur = readState(args.progressionFile, stateKey, {
      authorizationId: authorization.authorizationId, projectId: args.projectId, workflowIdentityHash: idHash, personaOrder: deps.personaOrder,
    }, deps);
    verifyStateFreshness(args.progressionFile, cur, stateKey, deps);
    if (cur.status !== "eligible" || cur.revision !== state.revision) throw new Error("Progression changed between claim and commit; refusing.");
    return commitState(args.progressionFile, cur, {
      status: "claimed",
      attempt: { attemptId, mode, targetPersona, claimedAt: lock.claimedAt, leaseExpiresAt: lock.leaseExpiresAt },
    }, stateKey, deps, txnToken);
  });
  const expected = { authorizationId: authorization.authorizationId, projectId: args.projectId, workflowIdentityHash: idHash, personaOrder: deps.personaOrder };
  // Context checked live before EVERY outcome write (defeats stale/superseded workers).
  const ownership = {
    authorizationId: authorization.authorizationId, attemptId, mode, targetPersona,
    predecessorRevision: state.revision, claimedRevision: claimedState.revision,
    claimedHash: progressionHash(claimedState), expected,
  };
  return {
    mode, authorization, workflowIdentityHash: idHash, stateKey, attemptId,
    effective: { employeeId: targetPersona, position }, claimedState,
    progressionFile: args.progressionFile,
    // Callbacks the workflow invokes after the Auth side effect (two-phase, C3).
    // assertLiveOwnership re-verifies lock+lease+exact-claimed-state immediately
    // before committing -- a stale/expired/superseded worker is refused and can
    // never mutate completed/uncertain/recovery_required/suspended state.
    recordCompletion(deps2 = {}) {
      const d = { ...deps, ...deps2 };
      const own = { ...ownership, expected: { ...expected, personaOrder: d.personaOrder || deps.personaOrder } };
      // Ownership re-check AND commit happen INSIDE the transition mutex -- no
      // TOCTOU window in which a takeover could interleave.
      return withTransition(args.progressionFile, d, (txnToken) => {
        const cur = assertLiveOwnership(args.progressionFile, stateKey, own, d);
        const changes = mode === "forward"
          ? { status: "eligible", completed: [...cur.completed, targetPersona], attempt: null, lastOutcome: { attemptId, mode, targetPersona, result: "completed", at: (d.now ? d.now() : new Date()).toISOString() } }
          : { status: "suspended", completed: cur.completed.filter((x) => x !== targetPersona), attempt: null, lastOutcome: { attemptId, mode, targetPersona, result: "rolled-back-suspended", at: (d.now ? d.now() : new Date()).toISOString() } };
        const done = commitState(args.progressionFile, cur, changes, stateKey, d, txnToken);
        releaseClaim(args.progressionFile, attemptId, d);
        return done;
      });
    },
    recordUncertain(result, deps2 = {}) {
      const d = { ...deps, ...deps2 };
      const own = { ...ownership, expected: { ...expected, personaOrder: d.personaOrder || deps.personaOrder } };
      // Live-ownership + commit under the mutex: a superseded worker must not
      // overwrite a recovery_required/terminal state (keeps takeover evidence
      // intact). Never reverts to eligible.
      return withTransition(args.progressionFile, d, (txnToken) => {
        const cur = assertLiveOwnership(args.progressionFile, stateKey, own, d);
        return commitState(args.progressionFile, cur, {
          status: "uncertain",
          lastOutcome: { attemptId, mode, targetPersona, result: result || "uncertain", at: (d.now ? d.now() : new Date()).toISOString() },
        }, stateKey, d, txnToken);
      });
    },
  };
}

module.exports = {
  PRODUCTION_PROJECT_ID, GOVERNED_FILES, AUTH_ARTIFACT_PATH, AUTH_SCHEMA,
  PROGRESSION_VERSION, ANCHOR_VERSION, LOCK_VERSION, BREAKGLASS_VERSION, BREAKGLASS_POSITION, STATES, GENESIS_HASH,
  isFullSha, isSha256, isCanonicalAuthId, isUtcInstant, isBoundedInt, isBoundedString, assertExactShape, sha256Hex,
  resolveRepoRoot, assertCleanGovernedTree, deriveGovernedFileHashes, governedHashesAtCommit, workflowIdentityHash, gitFileBytesAtCommit,
  deriveRepositoryIdentity, verifyRepositoryIdentity,
  loadGovernedAuthorization, verifyGovernedAuthorization,
  loadStateKey, atomicWrite,
  progressionCanonical, signProgression, progressionHash, genesisState, readState, commitState, nextState,
  anchorPath, signAnchor, writeAnchor, readAnchor, verifyStateFreshness,
  lockPath, readLock, acquireClaim, releaseClaim, assertOwnsClaim, assertLiveOwnership, leaseExpired,
  txnPath, withTransition, assertMutexOwner,
  nextEligiblePersona,
  signBreakGlass, readAndVerifyBreakGlass,
  assertProductionAuthorization,
};
