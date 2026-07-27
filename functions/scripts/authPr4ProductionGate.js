// AUTH-PR-4 -- Production-enablement authorization gate.
//
// Governing design:
//   docs/deployment/auth-pr-4-production-enablement-design.md  (merged, PR #455)
//
// WHAT THIS IS
// The narrow, authorization-bound gate that the operator workflow
// (authPr4RecoveryEmailMigration.js) consults before any PRODUCTION-shaped write
// (`--executeProduction`). It replaces the previous *unconditional* production
// refusal with a *conditional* one: a production write is permitted only when a
// complete, integrity-checked authorization is presented, and it FAILS CLOSED on
// anything missing/invalid/tampered/stale/out-of-order.
//
// It authorizes nothing by itself and enables no execution: in production, no
// recorded Owner authorization / manifest exists, so the gate refuses. In tests,
// a production-shaped path is exercised only against a NON-PRODUCTION project with
// fixture manifests -- the real `taylor-parts` project id is never targeted.
//
// PROPERTIES ENFORCED (design §5.1-§5.6, §5.4a):
//   - Independent repository identity + deterministic SHA-256 of every governed
//     file, derived before SDK init; a user-supplied commit is never sufficient.
//   - A protected, integrity-checked PROGRESSION record enforces cross-invocation
//     order: only the exact next persona proceeds; skipped/repeated/reordered/
//     stale/conflicting/tampered/suspended -> refuse; advance only after a
//     confirmed write+read-back; uncertain outcomes do not advance; a successful
//     rollback reverses + suspends and blocks later personas; 1-4 durable before 5.
//   - Break-glass confirmation for position 5: a separate protected artifact bound
//     to the authorization + the exact progression state + position 5, time-valid,
//     invalidated by any progression change (early/expired/mismatched/reused fail).
//   - No private address/UID/token/credential/mapping/rollback-state/break-glass
//     identity is committed; artifacts are protected operator inputs only.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const PRODUCTION_PROJECT_ID = "taylor-parts";

// The exact, deterministic governed-file set whose SHA-256 hashes the Owner
// records at authorization and the gate independently re-derives + verifies.
// Relative to the repository root.
const GOVERNED_FILES = Object.freeze([
  "functions/scripts/authPr4RecoveryEmailMigration.js",
  "functions/scripts/authPr4ProductionGate.js",
]);

const AUTH_MANIFEST_VERSION = 1;
const PROGRESSION_VERSION = 1;
const BREAKGLASS_VERSION = 1;
const BREAKGLASS_POSITION = 5;

// ---------------------------------------------------------------------------
// Governed-file hashing + repository identity (independently derived)
// ---------------------------------------------------------------------------

function sha256Hex(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function resolveRepoRoot(deps = {}) {
  const exec = deps.execFileSync || execFileSync;
  const start = deps.repoRoot || path.resolve(__dirname, "..", "..");
  try {
    return exec("git", ["-C", start, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  } catch {
    // Fallback for non-git contexts: two levels up from functions/scripts.
    return start;
  }
}

// Deterministic SHA-256 of each governed file, read from disk. Missing file =>
// fail closed (throws).
function deriveGovernedFileHashes(repoRoot, deps = {}) {
  const readFileSync = deps.readFileSync || fs.readFileSync;
  const out = {};
  for (const rel of GOVERNED_FILES) {
    const abs = path.join(repoRoot, rel);
    let bytes;
    try {
      bytes = readFileSync(abs);
    } catch (err) {
      throw new Error(`Governed file missing or unreadable: ${rel} (${err.message}).`);
    }
    out[rel] = sha256Hex(bytes);
  }
  return out;
}

// A single identity hash binding the entire governed set (order-independent).
function workflowIdentityHash(governedFileHashes) {
  const canonical = JSON.stringify(
    Object.keys(governedFileHashes)
      .sort()
      .map((k) => [k, governedFileHashes[k]]),
  );
  return sha256Hex(canonical);
}

// recorded (from the manifest) MUST cover EXACTLY the governed set and match the
// independently derived hashes -- no missing, extra, or mismatched entries.
function verifyGovernedFileHashes(recorded, derived) {
  if (!recorded || typeof recorded !== "object" || Array.isArray(recorded)) {
    throw new Error("Authorization manifest is missing governedFileHashes.");
  }
  const recordedKeys = Object.keys(recorded).sort();
  const expectedKeys = [...GOVERNED_FILES].sort();
  if (recordedKeys.length !== expectedKeys.length || recordedKeys.some((k, i) => k !== expectedKeys[i])) {
    throw new Error("Authorization manifest governedFileHashes does not cover exactly the governed file set.");
  }
  for (const rel of GOVERNED_FILES) {
    if (typeof recorded[rel] !== "string" || recorded[rel] !== derived[rel]) {
      throw new Error(
        `Governed-file hash mismatch for ${rel} -- the on-disk workflow/gate code does not match the recorded ` +
          "reviewed hashes. Any post-review change invalidates the authorization (design §5.4).",
      );
    }
  }
  return true;
}

// Repository identity is derived by the gate (git), never taken on trust from a
// user-supplied string. reviewedHead must be in ancestry (or equal HEAD); a
// supplied commit that disagrees with the derived identity fails closed.
function deriveRepositoryIdentity(repoRoot, deps = {}) {
  const exec = deps.execFileSync || execFileSync;
  const head = exec("git", ["-C", repoRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const isAncestor = (commit) => {
    try {
      exec("git", ["-C", repoRoot, "merge-base", "--is-ancestor", commit, "HEAD"], { encoding: "utf8" });
      return true;
    } catch {
      return false;
    }
  };
  return { head, isAncestor };
}

function verifyRepositoryIdentity({ reviewedHead, suppliedCommit, mergeCommit }, repoIdentity) {
  if (typeof reviewedHead !== "string" || reviewedHead.length < 7) {
    throw new Error("Authorization manifest is missing a valid reviewedHead.");
  }
  const inAncestry = repoIdentity.head === reviewedHead || repoIdentity.isAncestor(reviewedHead);
  const mergeMatches =
    typeof mergeCommit === "string" &&
    (repoIdentity.head === mergeCommit || repoIdentity.isAncestor(mergeCommit));
  if (!inAncestry && !mergeMatches) {
    throw new Error(
      "Reviewed enablement head is not in the repository's ancestry, and no matching merge attestation applies " +
        "(design §5.4a). Refusing; governed-file hash equality is verified separately.",
    );
  }
  // A user-supplied commit value is never sufficient by itself; if provided it
  // must agree with the derived identity, else fail closed.
  if (suppliedCommit && suppliedCommit !== repoIdentity.head && suppliedCommit !== reviewedHead) {
    throw new Error(
      "User-supplied commit disagrees with the repository-derived identity; derived identity is authoritative (design §5.4).",
    );
  }
  return true;
}

// ---------------------------------------------------------------------------
// HMAC-signed artifact helpers (state-key protected; never committed)
// ---------------------------------------------------------------------------

function loadStateKey(stateKeyFile, deps = {}) {
  const readFileSync = deps.readFileSync || fs.readFileSync;
  if (!stateKeyFile) throw new Error("A protected --stateKeyFile is required for production authorization.");
  const key = readFileSync(stateKeyFile);
  if (key.length < 32) throw new Error("--stateKeyFile must contain at least 32 bytes of protected random key material.");
  return key;
}

function hmac(canonical, key) {
  return crypto.createHmac("sha256", key).update(canonical).digest("hex");
}

function timingSafeHexEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

// ---------------------------------------------------------------------------
// Authorization manifest (mirrors the recorded, append-only DECISIONS entry)
// ---------------------------------------------------------------------------

const MANIFEST_FIELDS = Object.freeze([
  "version", "authorizationId", "projectId", "personaOrder", "reviewedHead",
  "governedFileHashes", "executionModeToken",
]);

function loadAuthorizationManifest(file, deps = {}) {
  const readFileSync = deps.readFileSync || fs.readFileSync;
  if (!file) throw new Error("--authorizationManifest <path> is required for a production write.");
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    throw new Error(`--authorizationManifest is not valid JSON: ${err.message}`);
  }
  return parsed;
}

function verifyAuthorizationManifest(manifest, { projectId, personaOrder, derivedHashes, repoIdentity, suppliedCommit }) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("Authorization manifest has an invalid shape.");
  }
  if (manifest.version !== AUTH_MANIFEST_VERSION) throw new Error("Authorization manifest version is unsupported.");
  for (const f of MANIFEST_FIELDS) {
    if (!(f in manifest)) throw new Error(`Authorization manifest is missing "${f}".`);
  }
  if (typeof manifest.authorizationId !== "string" || !manifest.authorizationId) {
    throw new Error("Authorization manifest is missing a valid authorizationId.");
  }
  if (manifest.projectId !== projectId) {
    throw new Error("Authorization manifest projectId does not match the target project (conflicting authorization).");
  }
  if (
    !Array.isArray(manifest.personaOrder) ||
    manifest.personaOrder.length !== personaOrder.length ||
    manifest.personaOrder.some((p, i) => p !== personaOrder[i])
  ) {
    throw new Error("Authorization manifest personaOrder does not match the governed migration sequence.");
  }
  if (typeof manifest.executionModeToken !== "string" || !manifest.executionModeToken) {
    throw new Error("Authorization manifest is missing the explicit executionModeToken.");
  }
  verifyGovernedFileHashes(manifest.governedFileHashes, derivedHashes);
  verifyRepositoryIdentity(
    { reviewedHead: manifest.reviewedHead, suppliedCommit, mergeCommit: manifest.mergeCommit },
    repoIdentity,
  );
  return manifest;
}

// ---------------------------------------------------------------------------
// Progression record (integrity-checked cross-invocation order)
// ---------------------------------------------------------------------------

const PROGRESSION_FIELDS = Object.freeze([
  "version", "authorizationId", "projectId", "workflowIdentityHash", "personaOrder",
  "completed", "suspended", "updatedAt",
]);

function progressionCanonical(p) {
  return JSON.stringify(PROGRESSION_FIELDS.map((f) => [f, p[f]]));
}

function signProgression(payload, key) {
  return hmac(progressionCanonical(payload), key);
}

// The progression's identity hash -- break-glass binds to this exact value, so
// any progression change (advance/rollback/suspend) invalidates a confirmation.
function progressionHash(payload) {
  return sha256Hex(progressionCanonical(payload));
}

function writeProgression(file, payload, key, deps = {}) {
  const writeFileSync = deps.writeFileSync || fs.writeFileSync;
  const artifact = { ...payload, signature: signProgression(payload, key) };
  writeFileSync(file, JSON.stringify(artifact), { mode: 0o600 });
  return file;
}

function readAndVerifyProgression(file, key, expected, deps = {}) {
  const readFileSync = deps.readFileSync || fs.readFileSync;
  let artifact;
  try {
    artifact = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    throw new Error(`Progression record is missing or malformed: ${err.message}`);
  }
  const allowed = new Set([...PROGRESSION_FIELDS, "signature"]);
  if (
    !artifact || typeof artifact !== "object" || Array.isArray(artifact) ||
    Object.keys(artifact).some((k) => !allowed.has(k)) ||
    PROGRESSION_FIELDS.some((f) => !(f in artifact)) ||
    artifact.version !== PROGRESSION_VERSION ||
    typeof artifact.signature !== "string" ||
    !Array.isArray(artifact.completed) ||
    typeof artifact.suspended !== "boolean"
  ) {
    throw new Error("Progression record has an invalid or malformed schema.");
  }
  const { signature, ...payload } = artifact;
  if (!timingSafeHexEqual(signature, signProgression(payload, key))) {
    throw new Error("Progression record failed integrity verification (tampered or wrong key).");
  }
  // Conflicting binding: must match this authorization / project / workflow / order.
  if (payload.authorizationId !== expected.authorizationId) {
    throw new Error("Progression record is bound to a different authorization (conflicting state).");
  }
  if (payload.projectId !== expected.projectId) {
    throw new Error("Progression record is bound to a different project (conflicting state).");
  }
  if (payload.workflowIdentityHash !== expected.workflowIdentityHash) {
    throw new Error("Progression record is bound to a different (stale) workflow identity.");
  }
  if (
    payload.personaOrder.length !== expected.personaOrder.length ||
    payload.personaOrder.some((p, i) => p !== expected.personaOrder[i])
  ) {
    throw new Error("Progression record persona order does not match the governed sequence.");
  }
  // Completed must be a valid, in-order, duplicate-free prefix of the sequence.
  payload.completed.forEach((id, i) => {
    if (id !== expected.personaOrder[i]) {
      throw new Error("Progression record completed list is not a valid in-order prefix (reordered/forged).");
    }
  });
  return payload;
}

function nextEligiblePersona(progression, personaOrder) {
  if (progression.suspended) return null;
  if (progression.completed.length >= personaOrder.length) return null;
  return { employeeId: personaOrder[progression.completed.length], position: progression.completed.length + 1 };
}

// Fail closed on skipped / repeated / reordered / suspended / already-complete.
// The progression is the AUTHORITY: it supplies the next eligible persona. If the
// operator additionally supplies --employeeId / --position, they must EXACTLY
// match the next eligible one (they can never select a different or later persona
// -- that is what makes --position non-bypassing).
function assertPersonaIsNextEligible(progression, personaOrder, employeeId, position) {
  if (progression.suspended) {
    throw new Error("Progression is SUSPENDED (e.g. after a rollback); no persona may proceed until it is re-established.");
  }
  const next = nextEligiblePersona(progression, personaOrder);
  if (!next) throw new Error("Progression is already complete; no further persona may proceed.");
  if (employeeId !== undefined && progression.completed.includes(employeeId)) {
    throw new Error(`Persona "${employeeId}" is already complete -- no repeat (progression enforced).`);
  }
  if (
    (employeeId !== undefined && employeeId !== next.employeeId) ||
    (position !== undefined && position !== next.position)
  ) {
    throw new Error(
      `Only the exact next persona may proceed: expected ${next.employeeId} (position ${next.position}), ` +
        `requested ${employeeId} (position ${position}). Skipped/reordered execution is refused.`,
    );
  }
  // Position 5 requires positions 1-4 durably complete.
  if (next.position === BREAKGLASS_POSITION && progression.completed.length !== BREAKGLASS_POSITION - 1) {
    throw new Error("Positions 1-4 must be durably complete before position 5.");
  }
  return next;
}

function advanceProgression(progression, employeeId, deps = {}) {
  const now = deps.now ? deps.now() : new Date();
  return { ...progression, completed: [...progression.completed, employeeId], suspended: false, updatedAt: now.toISOString() };
}

// A successful rollback REVERSES the persona and SUSPENDS progression, blocking
// later personas until it is governed-reestablished.
function suspendProgressionAfterRollback(progression, employeeId, deps = {}) {
  const now = deps.now ? deps.now() : new Date();
  const completed = progression.completed.filter((id) => id !== employeeId);
  return { ...progression, completed, suspended: true, updatedAt: now.toISOString() };
}

// ---------------------------------------------------------------------------
// Break-glass confirmation (position 5 only)
// ---------------------------------------------------------------------------

const BREAKGLASS_FIELDS = Object.freeze([
  "version", "authorizationId", "progressionHash", "position", "confirmer",
  "createdAt", "validityWindowSeconds", "sanitizedResult",
]);

function breakGlassCanonical(p) {
  return JSON.stringify(BREAKGLASS_FIELDS.map((f) => [f, p[f]]));
}

function signBreakGlass(payload, key) {
  return hmac(breakGlassCanonical(payload), key);
}

function readAndVerifyBreakGlass(file, key, { authorizationId, currentProgressionHash, now }, deps = {}) {
  const readFileSync = deps.readFileSync || fs.readFileSync;
  let artifact;
  try {
    artifact = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    throw new Error(`Break-glass confirmation is missing or malformed: ${err.message}`);
  }
  const allowed = new Set([...BREAKGLASS_FIELDS, "signature"]);
  if (
    !artifact || typeof artifact !== "object" || Array.isArray(artifact) ||
    Object.keys(artifact).some((k) => !allowed.has(k)) ||
    BREAKGLASS_FIELDS.some((f) => !(f in artifact)) ||
    artifact.version !== BREAKGLASS_VERSION ||
    typeof artifact.signature !== "string"
  ) {
    throw new Error("Break-glass confirmation has an invalid or malformed schema.");
  }
  const { signature, ...payload } = artifact;
  if (!timingSafeHexEqual(signature, signBreakGlass(payload, key))) {
    throw new Error("Break-glass confirmation failed integrity verification (tampered or wrong key).");
  }
  if (payload.position !== BREAKGLASS_POSITION) {
    throw new Error("Break-glass confirmation is not bound to position 5.");
  }
  if (payload.authorizationId !== authorizationId) {
    throw new Error("Break-glass confirmation is bound to a different authorization.");
  }
  // Bound to the EXACT progression state (1-4 complete). Any change -- including a
  // rollback, or creation before 1-4 completed -- yields a different hash => reject.
  // This also blocks reuse after a progression change.
  if (payload.progressionHash !== currentProgressionHash) {
    throw new Error(
      "Break-glass confirmation is not bound to the current progression state " +
        "(created too early, reused after a change, or mismatched).",
    );
  }
  if (typeof payload.confirmer !== "string" || !payload.confirmer) {
    throw new Error("Break-glass confirmation is missing the named confirmer/executor.");
  }
  const createdMs = Date.parse(payload.createdAt);
  if (!Number.isFinite(createdMs)) throw new Error("Break-glass confirmation has an invalid createdAt.");
  const windowSec = payload.validityWindowSeconds;
  if (!Number.isFinite(windowSec) || windowSec <= 0) {
    throw new Error("Break-glass confirmation is missing a positive validityWindowSeconds.");
  }
  const nowMs = (now || new Date()).getTime();
  if (nowMs < createdMs) throw new Error("Break-glass confirmation createdAt is in the future.");
  if (nowMs - createdMs > windowSec * 1000) {
    throw new Error("Break-glass confirmation is EXPIRED (outside its validity window).");
  }
  const r = payload.sanitizedResult;
  if (!r || r.recoverable !== true || r.loginVerified !== true) {
    throw new Error("Break-glass confirmation does not sanitize-attest recoverable + login-verified.");
  }
  return payload;
}

// ---------------------------------------------------------------------------
// Master check -- called by the workflow BEFORE any SDK write when
// --executeProduction is requested. Fails closed on anything invalid.
// ---------------------------------------------------------------------------

// mode: "forward" | "rollback". Returns a context the caller uses to advance/
// suspend progression after a confirmed outcome (never before).
function assertProductionAuthorization(args, deps = {}) {
  const now = deps.now || (() => new Date());
  if (!args.projectId) throw new Error("--projectId is required.");

  // Protected inputs required (never committed).
  if (!args.mappingFile) throw new Error("--mappingFile <path> (protected, out-of-band) is required.");
  if (!args.authorizationManifest) throw new Error("--authorizationManifest <path> is required.");
  if (!args.progressionFile) throw new Error("--progressionFile <path> is required.");
  const stateKey = loadStateKey(args.stateKeyFile, deps);

  const repoRoot = resolveRepoRoot(deps);
  const derivedHashes = deriveGovernedFileHashes(repoRoot, deps);
  const idHash = workflowIdentityHash(derivedHashes);
  const repoIdentity = deriveRepositoryIdentity(repoRoot, deps);

  const manifest = verifyAuthorizationManifest(loadAuthorizationManifest(args.authorizationManifest, deps), {
    projectId: args.projectId,
    personaOrder: deps.personaOrder,
    derivedHashes,
    repoIdentity,
    suppliedCommit: args.authorizedCommit,
  });

  const progression = readAndVerifyProgression(args.progressionFile, stateKey, {
    authorizationId: manifest.authorizationId,
    projectId: args.projectId,
    workflowIdentityHash: idHash,
    personaOrder: deps.personaOrder,
  }, deps);

  const mode = args.rollback ? "rollback" : "forward";

  if (mode === "forward") {
    const next = assertPersonaIsNextEligible(progression, deps.personaOrder, args.employeeId, args.position);
    if (!args.capturedStateOut) throw new Error("--capturedStateOut <path> is required for a forward production write.");
    if (next.position === BREAKGLASS_POSITION) {
      if (!args.breakGlassConfirmationFile) {
        throw new Error("Position 5 requires --breakGlassConfirmationFile (created after positions 1-4, time-valid).");
      }
      readAndVerifyBreakGlass(args.breakGlassConfirmationFile, stateKey, {
        authorizationId: manifest.authorizationId,
        currentProgressionHash: progressionHash(progression),
        now: now(),
      }, deps);
    }
    return { mode, manifest, progression, workflowIdentityHash: idHash, stateKey, effective: next };
  }

  // rollback: the persona being rolled back must be the most recently completed.
  if (!args.capturedStateFile) throw new Error("--rollback requires --capturedStateFile.");
  const last = progression.completed[progression.completed.length - 1];
  if (!last || (args.employeeId && args.employeeId !== last)) {
    throw new Error("Production rollback may only target the most recently completed persona.");
  }
  return { mode, manifest, progression, workflowIdentityHash: idHash, stateKey, effective: { employeeId: last } };
}

module.exports = {
  PRODUCTION_PROJECT_ID,
  GOVERNED_FILES,
  AUTH_MANIFEST_VERSION,
  PROGRESSION_VERSION,
  BREAKGLASS_VERSION,
  BREAKGLASS_POSITION,
  sha256Hex,
  resolveRepoRoot,
  deriveGovernedFileHashes,
  workflowIdentityHash,
  verifyGovernedFileHashes,
  deriveRepositoryIdentity,
  verifyRepositoryIdentity,
  loadStateKey,
  loadAuthorizationManifest,
  verifyAuthorizationManifest,
  progressionCanonical,
  signProgression,
  progressionHash,
  writeProgression,
  readAndVerifyProgression,
  nextEligiblePersona,
  assertPersonaIsNextEligible,
  advanceProgression,
  suspendProgressionAfterRollback,
  signBreakGlass,
  readAndVerifyBreakGlass,
  assertProductionAuthorization,
};
