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
// reviewed hash (a tampered initializer would change the hash and fail the gate's
// governed-file binding, and its genesis would fail the gate's read-back).
//
// SAFETY POSTURE
//   - CREATE, never overwrite: refuses if the progression file, its anchor, its
//     lock, or its transition mutex already exists (create-only `wx`).
//   - Loads the state key WITHOUT printing it; emits no key or private state.
//   - Reads the GRANTED authorization + governed-file hashes FROM the exact
//     --authorizedCommit (git blob), verifies them through the same gate helpers,
//     and requires no drift between the authorized commit and HEAD.
//   - Binds the genesis to the exact authorizationId, projectId, persona order, and
//     workflow identity hash.
//   - Writes signed state + matching anchor atomically, protected (0600).
//   - Reads back and verifies BOTH artifacts through the production gate.
//   - Credential-free: NO Firebase initialization, NO network access. Only git,
//     filesystem, and crypto.
//   - Sanitized output only (booleans / counts / a workflow-identity ref).
//
// Usage (credentialed operator environment not required -- this is repo-only):
//   node scripts/authPr4InitProgression.js \
//     --projectId taylor-parts --confirmProduction taylor-parts \
//     --authorizedCommit <merged authorization head> \
//     --executionModeConfirmation <token> --executor <name> \
//     --stateKeyFile /secure/state.key --progressionOut /secure/progression.json

const fs = require("fs");
const gate = require("./authPr4ProductionGate.js");

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

// Create-only write (fails closed if the path already exists), fsync, 0600.
function createOnly(file, contents, deps = {}) {
  const _fs = deps.fs || fs;
  const fd = _fs.openSync(file, "wx", 0o600); // O_EXCL: EEXIST if present
  try { _fs.writeSync(fd, contents); _fs.fsyncSync(fd); } finally { _fs.closeSync(fd); }
  try { _fs.chmodSync(file, 0o600); } catch { /* Windows ACLs operator-managed */ }
}

// Pure, testable core. deps allows injecting fs / now / repoRoot / execFileSync.
function initGenesis(args, deps = {}) {
  const _fs = deps.fs || fs;
  const now = deps.now || (() => new Date());
  const personaOrder = deps.personaOrder || MIGRATION_PERSONA_ORDER;

  // Required, well-formed inputs (fail closed before touching state).
  if (!args.projectId) throw new Error("--projectId is required.");
  if (!gate.isFullSha(args.authorizedCommit || "")) throw new Error("--authorizedCommit (canonical full 40-hex SHA) is required.");
  if (!gate.isBoundedString(args.executionModeConfirmation || "", 128)) throw new Error("--executionModeConfirmation is required.");
  if (!gate.isBoundedString(args.executor || "", 128)) throw new Error("--executor is required.");
  if (!args.progressionOut) throw new Error("--progressionOut <path> is required.");

  const stateKey = gate.loadStateKey(args.stateKeyFile, deps); // never printed

  // CREATE, never overwrite: none of the four runtime artifacts may pre-exist.
  const anchor = gate.anchorPath(args.progressionOut);
  const lock = gate.lockPath(args.progressionOut);
  const txn = gate.txnPath(args.progressionOut);
  for (const p of [args.progressionOut, anchor, lock, txn]) {
    if (_fs.existsSync(p)) throw new Error(`Refusing to overwrite existing progression/anchor/lock/txn file: ${p}. Genesis creates only.`);
  }

  // Repository authority: clean checkout, governed hashes at the authorized commit,
  // no drift vs HEAD, and the GRANTED authorization verified through the gate.
  const repoRoot = gate.resolveRepoRoot(deps);
  gate.assertCleanGovernedTree(repoRoot, deps);
  const repoIdentity = gate.deriveRepositoryIdentity(repoRoot, deps);
  const reviewedHashes = gate.governedHashesAtCommit(repoRoot, args.authorizedCommit, deps);
  const headHashes = gate.governedHashesAtCommit(repoRoot, repoIdentity.head, deps);
  for (const rel of gate.GOVERNED_FILES) {
    if (reviewedHashes[rel] !== headHashes[rel]) {
      throw new Error(`Governed file ${rel} changed between the authorized commit and HEAD -- authorization invalid.`);
    }
  }
  const idHash = gate.workflowIdentityHash(reviewedHashes);
  const { artifact } = gate.loadGovernedAuthorization({ repoRoot, authorizedCommit: args.authorizedCommit }, deps);
  const authorization = gate.verifyGovernedAuthorization(artifact, {
    projectId: args.projectId, personaOrder, derivedHashes: reviewedHashes, repoIdentity,
    authorizedCommit: args.authorizedCommit, executionModeConfirmation: args.executionModeConfirmation, executor: args.executor,
  });

  // Canonical revision-0 eligible genesis for position 1.
  const genesis = gate.genesisState({
    authorizationId: authorization.authorizationId, projectId: args.projectId,
    workflowIdentityHash: idHash, personaOrder,
  }, { now });

  // Atomically create signed state + matching anchor (create-only, protected).
  const signedState = JSON.stringify({ ...genesis, signature: gate.signProgression(genesis, stateKey) });
  const anchorPayload = { version: gate.ANCHOR_VERSION, authorizationId: authorization.authorizationId, highWaterRevision: genesis.revision, stateHash: gate.progressionHash(genesis), updatedAt: now().toISOString() };
  const signedAnchor = JSON.stringify({ ...anchorPayload, signature: gate.signAnchor(anchorPayload, stateKey) });
  createOnly(args.progressionOut, signedState, deps);
  try {
    createOnly(anchor, signedAnchor, deps);
  } catch (err) {
    // Anchor create failed after the state was created: remove the partial state so
    // the operator re-runs cleanly (no half-initialised, unverifiable state remains).
    try { _fs.unlinkSync(args.progressionOut); } catch { /* best effort */ }
    throw err;
  }

  // Read back + verify BOTH artifacts through the production gate.
  const expected = { authorizationId: authorization.authorizationId, projectId: args.projectId, workflowIdentityHash: idHash, personaOrder };
  const readBack = gate.readState(args.progressionOut, stateKey, expected, deps);
  gate.verifyStateFreshness(args.progressionOut, readBack, stateKey, deps);
  const next = gate.nextEligiblePersona(readBack, personaOrder);
  if (readBack.status !== "eligible" || readBack.revision !== 0 || readBack.completed.length !== 0 ||
      readBack.attempt !== null || !next || next.position !== 1 || next.employeeId !== personaOrder[0]) {
    throw new Error("Post-write verification failed: the genesis is not a canonical revision-0 eligible position-1 state.");
  }

  // Sanitized result -- no key, no signature, no raw state.
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
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = initGenesis(args);
  console.log("GENESIS initialised:", `${args.progressionOut} (eligible, revision 0, next=${result.nextPersona} position ${result.nextPosition}).`);
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main().catch((err) => { console.error("Failed:", err.message); process.exitCode = 1; });
}

module.exports = { parseArgs, createOnly, initGenesis, MIGRATION_PERSONA_ORDER };
