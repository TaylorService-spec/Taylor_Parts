// AUTH-PR-4 -- Genesis progression-state initializer (governed operator command).
//
// Governing docs:
//   docs/deployment/auth-pr-4-production-authorization-GRANTED.md
//   functions/scripts/authPr4ProductionGate.js  (the gate this state feeds)
//
// WHAT THIS IS
// The single reviewed, credential-free operator command that CREATES the signed
// revision-0 genesis progression state (and its matching high-water anchor) that
// the production gate requires before position 1. It replaces ad-hoc `node -e`
// assembly of production execution-control state.
//
// This file is part of the gate's GOVERNED_FILES set: it creates production
// execution-control state, so the Owner's authorization is bound to its exact
// reviewed hash.
//
// SAFETY POSTURE
//   - Production-only guard: requires --projectId taylor-parts AND matching
//     --confirmProduction taylor-parts before loading the key or creating anything.
//   - CRASH-SAFE INITIALIZATION TRANSACTION: an owner-token `.init` MARKER is
//     published (create-only, fsync) BEFORE either the state or the anchor, and is
//     removed ONLY after both are fsynced and independently verified through the
//     gate. A crash at ANY boundary leaves the marker (and any partial artifact) on
//     disk; the production gate refuses every step while a marker is present. The
//     marker is NEVER auto-broken -- a leftover is a governed reconciliation
//     condition (§ runbook). On any error, this command leaves the marker/partials
//     in place (it does not auto-delete an ambiguous initialization).
//   - CREATE, never overwrite: refuses if the progression / anchor / lock / txn /
//     init marker already exists.
//   - Loads the state key WITHOUT printing it; emits NO key, token, or protected
//     filesystem path on stdout/stderr (sanitized output only).
//   - Reads the GRANTED authorization + governed-file hashes FROM the exact
//     --authorizedCommit, verifies through the gate, requires no drift vs HEAD and a
//     clean checkout.
//   - Credential-free: NO Firebase initialization, NO network access.

const fs = require("fs");
const gate = require("./authPr4ProductionGate.js");

const PRODUCTION_PROJECT_ID = "taylor-parts";
const MIGRATION_PERSONA_ORDER = Object.freeze([
  "emp-rudy-driver",
  "emp-rudy-parts-associate",
  "emp-rudy-warehouse-manager",
  "emp-rudy-parts-manager",
  "emp-rudy-owner",
]);

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    switch (t) {
      case "--projectId": args.projectId = argv[++i]; break;
      case "--confirmProduction": args.confirmProduction = argv[++i]; break;
      case "--authorizedCommit": args.authorizedCommit = argv[++i]; break;
      case "--executionModeConfirmation": args.executionModeConfirmation = argv[++i]; break;
      case "--executor": args.executor = argv[++i]; break;
      case "--stateKeyFile": args.stateKeyFile = argv[++i]; break;
      case "--progressionOut": args.progressionOut = argv[++i]; break;
      default: throw new Error(`Unknown argument: ${t}`);
    }
  }
  return args;
}

// Create-only write (O_EXCL), fsync, 0600. Errors are SANITIZED (no path leak).
function createOnly(file, contents, deps = {}) {
  const _fs = deps.fs || fs;
  let fd;
  try {
    fd = _fs.openSync(file, "wx", 0o600);
  } catch (err) {
    if (err && err.code === "EEXIST") throw new Error("Refusing to overwrite an existing protected artifact (governed reconciliation required).");
    throw new Error("Failed to create a protected artifact (I/O error).");
  }
  try { _fs.writeSync(fd, contents); _fs.fsyncSync(fd); } finally { _fs.closeSync(fd); }
  try { _fs.chmodSync(file, 0o600); } catch { /* Windows ACLs operator-managed */ }
}

const crypto = require("crypto");

// Pure, testable core. deps allows injecting fs / now / repoRoot / execFileSync.
function initGenesis(args, deps = {}) {
  const _fs = deps.fs || fs;
  const now = deps.now || (() => new Date());
  const personaOrder = deps.personaOrder || MIGRATION_PERSONA_ORDER;

  // Production-only guard -- before the state key or any artifact.
  if (args.projectId !== PRODUCTION_PROJECT_ID) throw new Error(`This production initializer requires --projectId ${PRODUCTION_PROJECT_ID}.`);
  if (args.confirmProduction !== PRODUCTION_PROJECT_ID) throw new Error(`Production initialization requires an explicit matching --confirmProduction ${PRODUCTION_PROJECT_ID}.`);
  if (!gate.isFullSha(args.authorizedCommit || "")) throw new Error("--authorizedCommit (canonical full 40-hex SHA) is required.");
  if (!gate.isBoundedString(args.executionModeConfirmation || "", 128)) throw new Error("--executionModeConfirmation is required.");
  if (!gate.isBoundedString(args.executor || "", 128)) throw new Error("--executor is required.");
  if (!args.progressionOut) throw new Error("--progressionOut <path> is required.");

  const marker = gate.initMarkerPath(args.progressionOut);
  const anchor = gate.anchorPath(args.progressionOut);
  const lock = gate.lockPath(args.progressionOut);
  const txn = gate.txnPath(args.progressionOut);
  // CREATE, never overwrite: none of the five runtime artifacts may pre-exist.
  for (const p of [args.progressionOut, anchor, lock, txn, marker]) {
    if (_fs.existsSync(p)) throw new Error("Refusing to overwrite an existing progression/anchor/lock/txn/init artifact. Genesis creates only; a present init marker requires governed reconciliation.");
  }

  const stateKey = gate.loadStateKey(args.stateKeyFile, deps); // never printed

  // Repository authority: clean checkout, governed hashes at the authorized commit,
  // no drift vs HEAD, and the GRANTED authorization verified through the gate.
  const repoRoot = gate.resolveRepoRoot(deps);
  gate.assertCleanGovernedTree(repoRoot, deps);
  const repoIdentity = gate.deriveRepositoryIdentity(repoRoot, deps);
  const reviewedHashes = gate.governedHashesAtCommit(repoRoot, args.authorizedCommit, deps);
  const headHashes = gate.governedHashesAtCommit(repoRoot, repoIdentity.head, deps);
  for (const rel of gate.GOVERNED_FILES) {
    if (reviewedHashes[rel] !== headHashes[rel]) throw new Error(`Governed file ${rel} changed between the authorized commit and HEAD -- authorization invalid.`);
  }
  const idHash = gate.workflowIdentityHash(reviewedHashes);
  const { artifact } = gate.loadGovernedAuthorization({ repoRoot, authorizedCommit: args.authorizedCommit }, deps);
  const authorization = gate.verifyGovernedAuthorization(artifact, {
    projectId: args.projectId, personaOrder, derivedHashes: reviewedHashes, repoIdentity,
    authorizedCommit: args.authorizedCommit, executionModeConfirmation: args.executionModeConfirmation, executor: args.executor,
  });

  // Canonical revision-0 eligible genesis for position 1.
  const genesis = gate.genesisState({ authorizationId: authorization.authorizationId, projectId: args.projectId, workflowIdentityHash: idHash, personaOrder }, { now });
  const signedState = JSON.stringify({ ...genesis, signature: gate.signProgression(genesis, stateKey) });
  const anchorPayload = { version: gate.ANCHOR_VERSION, authorizationId: authorization.authorizationId, highWaterRevision: genesis.revision, stateHash: gate.progressionHash(genesis), updatedAt: now().toISOString() };
  const signedAnchor = JSON.stringify({ ...anchorPayload, signature: gate.signAnchor(anchorPayload, stateKey) });

  // --- CRASH-SAFE INITIALIZATION TRANSACTION ---
  // 1. Publish the owner-token marker FIRST. A crash after this (before/after state,
  //    before anchor, or before marker removal) leaves the marker -> the gate blocks.
  //    On ANY error below we do NOT delete the marker or partials (never auto-delete
  //    an ambiguous initialization); the operator runs governed reconciliation.
  const markerToken = crypto.randomBytes(16).toString("hex");
  createOnly(marker, JSON.stringify({ version: gate.INIT_MARKER_VERSION, token: markerToken, at: now().toISOString() }), deps);
  // 2. Publish state, then anchor (each create-only + fsynced).
  createOnly(args.progressionOut, signedState, deps);
  createOnly(anchor, signedAnchor, deps);
  // 3. Independently verify BOTH through the gate before removing the marker.
  const expected = { authorizationId: authorization.authorizationId, projectId: args.projectId, workflowIdentityHash: idHash, personaOrder };
  const readBack = gate.readState(args.progressionOut, stateKey, expected, deps);
  gate.verifyStateFreshness(args.progressionOut, readBack, stateKey, deps);
  const next = gate.nextEligiblePersona(readBack, personaOrder);
  if (readBack.status !== "eligible" || readBack.revision !== 0 || readBack.completed.length !== 0 ||
      readBack.attempt !== null || !next || next.position !== 1 || next.employeeId !== personaOrder[0]) {
    throw new Error("Post-write verification failed: the genesis is not a canonical revision-0 eligible position-1 state.");
  }
  // 4. Remove the marker ONLY after both artifacts are verified, and ONLY if it still
  //    carries OUR token (owner-bound; never delete a foreign marker).
  try {
    const held = JSON.parse(_fs.readFileSync(marker, "utf8"));
    if (held && held.token === markerToken) _fs.unlinkSync(marker);
    else throw new Error("Initialization marker is owned by another attempt; leaving it for governed reconciliation.");
  } catch (err) {
    if (/another attempt/.test(err.message)) throw err;
    throw new Error("Failed to finalise initialization (marker); governed reconciliation required.");
  }

  // Sanitized result -- no key, no signature, no raw state, no protected path.
  return {
    ok: true,
    authorizationId: authorization.authorizationId,
    projectId: args.projectId,
    workflowIdentityRef: `ref:${idHash.slice(0, 16)}`,
    revision: readBack.revision,
    status: readBack.status,
    completedCount: readBack.completed.length,
    nextPersona: next.employeeId,
    nextPosition: next.position,
    stateCreated: true,
    anchorCreated: true,
    markerCleared: true,
  };
}

// Strip protected filesystem paths and echoed secrets from operator-facing output.
function sanitizeForOutput(msg, secrets = []) {
  let s = String(msg);
  s = s.replace(/[A-Za-z]:\\[^\s'"]+/g, "<path>");            // Windows absolute paths
  s = s.replace(/(?:\/[^\s'":]+){2,}/g, "<path>");             // POSIX multi-segment paths
  for (const sec of secrets) if (sec && s.includes(sec)) s = s.split(sec).join("<redacted>");
  return s;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  try {
    const result = initGenesis(args);
    // No protected path is printed -- only the sanitized result (no path fields).
    console.log(`GENESIS initialised (eligible, revision 0, next=${result.nextPersona} position ${result.nextPosition}).`);
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error("Failed:", sanitizeForOutput(err.message, [args.executionModeConfirmation]));
    process.exitCode = 1;
  }
}

if (require.main === module) { main(); }

module.exports = { parseArgs, createOnly, initGenesis, sanitizeForOutput, PRODUCTION_PROJECT_ID, MIGRATION_PERSONA_ORDER };
