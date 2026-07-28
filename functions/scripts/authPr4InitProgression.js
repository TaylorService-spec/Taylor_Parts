// AUTH-PR-4 -- Genesis progression-state initializer + reconciliation (governed).
//
// Governing docs:
//   docs/deployment/auth-pr-4-production-authorization-GRANTED.md
//   functions/scripts/authPr4ProductionGate.js  (the gate this state feeds)
//
// WHAT THIS IS
// The single reviewed, credential-free operator command for the genesis life-cycle of
// the production progression state the gate requires before position 1. Three modes:
//   (default)          create the signed revision-0 genesis state + anchor (crash-safe).
//   reconcile-inspect  read-only: classify a crash-left init marker + residue, sanitized.
//   reconcile-cleanup  Owner-confirmed, fingerprint-bound, confined cleanup of that residue.
// It replaces ad-hoc `node -e` assembly OR hand-deletion of production execution-control
// state -- both the happy path and the failure path are governed here.
//
// This file is part of the gate's GOVERNED_FILES set: it creates/removes production
// execution-control state, so the Owner's authorization is bound to its exact reviewed hash.
//
// SAFETY POSTURE (all modes)
//   - Production-only guard: requires --projectId taylor-parts AND matching
//     --confirmProduction taylor-parts before loading the key or touching anything.
//   - Loads the state key WITHOUT printing it; emits NO key, token, or protected
//     filesystem path on stdout/stderr. Output is sanitized against the exact known
//     protected values (state key file, progression/anchor/marker/lock/txn paths, token)
//     AND quote-/space-aware generic path patterns.
//   - Reads the GRANTED authorization + governed-file hashes FROM the exact
//     --authorizedCommit, verifies through the gate, requires no drift vs HEAD + a clean checkout.
//   - Credential-free: NO Firebase initialization, NO network access.
//
// INIT crash-safety: an owner-token `.init` MARKER is published (create-only, fsync)
// BEFORE either the state or the anchor, and removed ONLY after both are fsynced and
// independently verified through the gate. A crash at ANY boundary leaves the marker (and
// any partial artifact) on disk; the gate refuses every step while a marker is present.
// The marker is NEVER auto-broken and this command NEVER auto-deletes an ambiguous
// initialization -- crash residue is resolved only by the Owner-directed reconcile modes.

const fs = require("fs");
const crypto = require("crypto");
const gate = require("./authPr4ProductionGate.js");

const PRODUCTION_PROJECT_ID = "taylor-parts";
const RECONCILE_CONFIRM = "reconcile-genesis";
const RECOVER_CONFIRM = "recover-mutex";
// A VALID reconciliation mutex younger than this may be a live cleanup; recovery refuses
// it (a malformed mutex is recoverable immediately). Overridable via deps for tests.
const RECOVERY_MIN_AGE_SECONDS = 300;
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
      case "--mode": args.mode = argv[++i]; break;
      case "--projectId": args.projectId = argv[++i]; break;
      case "--confirmProduction": args.confirmProduction = argv[++i]; break;
      case "--authorizedCommit": args.authorizedCommit = argv[++i]; break;
      case "--executionModeConfirmation": args.executionModeConfirmation = argv[++i]; break;
      case "--executor": args.executor = argv[++i]; break;
      case "--stateKeyFile": args.stateKeyFile = argv[++i]; break;
      case "--progressionOut": args.progressionOut = argv[++i]; break;
      case "--fingerprint": args.fingerprint = argv[++i]; break;
      case "--action": args.action = argv[++i]; break;
      case "--confirmReconciliation": args.confirmReconciliation = argv[++i]; break;
      default: throw new Error(`Unknown argument: ${t}`);
    }
  }
  return args;
}

// Shared production-arg guard (init + both reconcile modes).
function assertProductionArgs(args) {
  if (args.projectId !== PRODUCTION_PROJECT_ID) throw new Error(`This production command requires --projectId ${PRODUCTION_PROJECT_ID}.`);
  if (args.confirmProduction !== PRODUCTION_PROJECT_ID) throw new Error(`Production commands require an explicit matching --confirmProduction ${PRODUCTION_PROJECT_ID}.`);
  if (!gate.isFullSha(args.authorizedCommit || "")) throw new Error("--authorizedCommit (canonical full 40-hex SHA) is required.");
  if (!gate.isBoundedString(args.executionModeConfirmation || "", 128)) throw new Error("--executionModeConfirmation is required.");
  if (!gate.isBoundedString(args.executor || "", 128)) throw new Error("--executor is required.");
  if (!args.progressionOut) throw new Error("--progressionOut <path> is required.");
}

// The exact, confined set of runtime artifacts derived from a progression path.
function artifactRoles(progressionOut) {
  return {
    state: progressionOut,
    anchor: gate.anchorPath(progressionOut),
    marker: gate.initMarkerPath(progressionOut),
    lock: gate.lockPath(progressionOut),
    txn: gate.txnPath(progressionOut),
  };
}
// Read + canonically validate the reconciliation mutex (present/valid/parsed).
function readReconcileMutex(progressionOut, deps = {}) {
  const _fs = deps.fs || fs;
  const p = gate.reconcilePath(progressionOut);
  if (!_fs.existsSync(p)) return { present: false, valid: false, mutex: null };
  let m = null, valid = false;
  try { m = JSON.parse(_fs.readFileSync(p, "utf8")); valid = gate.isValidReconcileMutex(m); } catch { valid = false; }
  return { present: true, valid, mutex: valid ? m : null };
}

// Per-role content digests over the confined artifact set (digest hex or null-if-absent).
function perRoleDigests(progressionOut, deps = {}) {
  const _fs = deps.fs || fs;
  const roles = artifactRoles(progressionOut);
  const out = {};
  for (const role of Object.keys(roles).sort()) {
    const p = roles[role];
    out[role] = _fs.existsSync(p) ? crypto.createHash("sha256").update(_fs.readFileSync(p)).digest("hex") : null;
  }
  return out;
}

// Content fingerprint over the confined artifact set (digests only -- reveals no path or
// content). Binds a reconcile-inspect snapshot so cleanup can detect any change.
function fingerprintArtifacts(progressionOut, deps = {}) {
  const digests = perRoleDigests(progressionOut, deps);
  const parts = Object.keys(digests).sort().map((role) => [role, digests[role]]);
  return {
    digests,
    fingerprint: crypto.createHash("sha256").update(JSON.stringify(parts)).digest("hex"),
    present: parts.filter(([, h]) => h).map(([r]) => r),
  };
}

// Load the state key + verify the governed authority (clean tree, no drift, GRANTED).
// Shared by init + reconcile so the failure path uses the SAME governed verification.
function loadProductionAuthority(args, deps = {}) {
  const personaOrder = deps.personaOrder || MIGRATION_PERSONA_ORDER;
  const stateKey = gate.loadStateKey(args.stateKeyFile, deps); // never printed
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
  const expected = { authorizationId: authorization.authorizationId, projectId: args.projectId, workflowIdentityHash: idHash, personaOrder };
  return { stateKey, repoRoot, idHash, authorization, expected };
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

// ---------------------------------------------------------------------------
// MODE: genesis initialization
// ---------------------------------------------------------------------------
function initGenesis(args, deps = {}) {
  const _fs = deps.fs || fs;
  const now = deps.now || (() => new Date());
  const personaOrder = deps.personaOrder || MIGRATION_PERSONA_ORDER;

  assertProductionArgs(args);

  const roles = artifactRoles(args.progressionOut);
  // CREATE, never overwrite: none of the five runtime artifacts may pre-exist.
  for (const p of Object.values(roles)) {
    if (_fs.existsSync(p)) throw new Error("Refusing to overwrite an existing progression/anchor/lock/txn/init artifact. Genesis creates only; a present init marker requires governed reconciliation.");
  }

  const { stateKey, idHash, authorization, expected } = loadProductionAuthority(args, deps);

  // Canonical revision-0 eligible genesis for position 1.
  const genesis = gate.genesisState({ authorizationId: authorization.authorizationId, projectId: args.projectId, workflowIdentityHash: idHash, personaOrder }, { now });
  const signedState = JSON.stringify({ ...genesis, signature: gate.signProgression(genesis, stateKey) });
  const anchorPayload = { version: gate.ANCHOR_VERSION, authorizationId: authorization.authorizationId, highWaterRevision: genesis.revision, stateHash: gate.progressionHash(genesis), updatedAt: now().toISOString() };
  const signedAnchor = JSON.stringify({ ...anchorPayload, signature: gate.signAnchor(anchorPayload, stateKey) });

  // --- CRASH-SAFE INITIALIZATION TRANSACTION ---
  // 1. Publish the owner-token marker FIRST. A crash after this leaves the marker -> gate blocks.
  //    On ANY error below we do NOT delete the marker or partials (never auto-delete an
  //    ambiguous initialization); the residue is resolved only via reconcile-cleanup.
  const markerToken = crypto.randomBytes(16).toString("hex");
  createOnly(roles.marker, JSON.stringify({ version: gate.INIT_MARKER_VERSION, token: markerToken, at: now().toISOString() }), deps);
  // 2. Publish state, then anchor (each create-only + fsynced).
  createOnly(roles.state, signedState, deps);
  createOnly(roles.anchor, signedAnchor, deps);
  // 3. Independently verify BOTH through the gate before removing the marker.
  const readBack = gate.readState(roles.state, stateKey, expected, deps);
  gate.verifyStateFreshness(roles.state, readBack, stateKey, deps);
  const next = gate.nextEligiblePersona(readBack, personaOrder);
  if (readBack.status !== "eligible" || readBack.revision !== 0 || readBack.completed.length !== 0 ||
      readBack.attempt !== null || !next || next.position !== 1 || next.employeeId !== personaOrder[0]) {
    throw new Error("Post-write verification failed: the genesis is not a canonical revision-0 eligible position-1 state.");
  }
  // 4. Remove the marker ONLY after both artifacts verify, and ONLY if it is a valid
  //    canonical marker (gate validator) that still carries OUR token (owner-bound; never
  //    delete a foreign / malformed marker).
  try {
    const held = gate.readInitMarker(roles.state, deps);
    if (held.present && held.valid && held.marker.token === markerToken) _fs.unlinkSync(roles.marker);
    else throw new Error("Initialization marker is owned by another attempt; leaving it for governed reconciliation.");
  } catch (err) {
    if (/another attempt/.test(err.message)) throw err;
    throw new Error("Failed to finalise initialization (marker); governed reconciliation required.");
  }

  return {
    ok: true, mode: "init",
    authorizationId: authorization.authorizationId,
    projectId: args.projectId,
    workflowIdentityRef: `ref:${idHash.slice(0, 16)}`,
    revision: readBack.revision, status: readBack.status, completedCount: readBack.completed.length,
    nextPersona: next.employeeId, nextPosition: next.position,
    stateCreated: true, anchorCreated: true, markerCleared: true,
  };
}

// ---------------------------------------------------------------------------
// MODE: reconcile-inspect  (read-only classification of crash residue)
// ---------------------------------------------------------------------------
function classifyState(progressionOut, stateKey, expected, deps) {
  const _fs = deps.fs || fs;
  const roles = artifactRoles(progressionOut);
  if (!_fs.existsSync(roles.state)) return { stateClass: "absent", canonicalGenesis: false };
  let st;
  try { st = gate.readState(roles.state, stateKey, expected, deps); }
  catch (err) {
    // A truncated / signature-less partial is safe to reset; anything that parsed as a
    // signed progression but failed schema/binding/integrity is indeterminate (could be
    // foreign / tampered / wrong-key) and must NOT be auto-deleted.
    if (/missing\/malformed|state malformed/i.test(err.message)) return { stateClass: "partial", canonicalGenesis: false };
    return { stateClass: "indeterminate", canonicalGenesis: false };
  }
  const next = gate.nextEligiblePersona(st, expected.personaOrder);
  const canonicalGenesis = st.status === "eligible" && st.revision === 0 && st.completed.length === 0 &&
    st.attempt === null && !!next && next.position === 1 && next.employeeId === expected.personaOrder[0];
  return { stateClass: canonicalGenesis ? "valid-genesis" : "valid-noncanonical", canonicalGenesis, state: st };
}

function reconcileInspect(args, deps = {}) {
  assertProductionArgs(args);
  const { stateKey, expected, idHash } = loadProductionAuthority(args, deps);
  const _fs = deps.fs || fs;
  const roles = artifactRoles(args.progressionOut);
  const idRef = `ref:${idHash.slice(0, 16)}`;

  const markerPresent = _fs.existsSync(roles.marker);
  const lockPresent = _fs.existsSync(roles.lock);
  const txnPresent = _fs.existsSync(roles.txn);
  const reconcileMutex = readReconcileMutex(args.progressionOut, deps);

  if (!markerPresent) {
    const fp0 = fingerprintArtifacts(args.progressionOut, deps);
    return { ok: true, mode: "reconcile-inspect", markerPresent: false, lockPresent, txnPresent, reconcileMutexPresent: reconcileMutex.present, reconcileMutexValid: reconcileMutex.valid, reconciliationNeeded: false, recommendation: "none", fingerprint: fp0.fingerprint, artifactsPresent: fp0.present, workflowIdentityRef: idRef };
  }

  // Marker validity via THE canonical gate validator (a token/shape the governed
  // initializer could not have produced is untrusted).
  const markerValid = gate.readInitMarker(roles.state, deps).valid;

  const { stateClass, canonicalGenesis } = classifyState(args.progressionOut, stateKey, expected, deps);
  const anchorPresent = _fs.existsSync(roles.anchor);
  let anchorConsistent = false;
  if (canonicalGenesis) {
    try { const st = gate.readState(roles.state, stateKey, expected, deps); gate.verifyStateFreshness(roles.state, st, stateKey, deps); anchorConsistent = anchorPresent; }
    catch { anchorConsistent = false; }
  }

  // Decision table (fail-closed toward "blocked"). The genesis initializer NEVER creates a
  // runtime claim lock or transition mutex -- their presence during genesis reconciliation
  // is foreign/concurrent/indeterminate, so any lock or txn forces "blocked".
  let recommendation;
  if (!markerValid) recommendation = "blocked";                                   // untrusted marker
  else if (lockPresent || txnPresent) recommendation = "blocked";                 // foreign runtime artifacts
  else if (stateClass === "absent" || stateClass === "partial") recommendation = "clean-reset";
  else if (stateClass === "indeterminate" || stateClass === "valid-noncanonical") recommendation = "blocked";
  else if (canonicalGenesis && anchorPresent && anchorConsistent) recommendation = "marker-only";
  else if (canonicalGenesis && !anchorPresent) recommendation = "clean-reset";    // incomplete init; deterministic re-init
  else recommendation = "blocked";                                                // genesis + bad anchor (possible tamper)

  const fp = fingerprintArtifacts(args.progressionOut, deps);
  return {
    ok: true, mode: "reconcile-inspect",
    markerPresent: true, markerValid, statePresent: stateClass !== "absent", stateClass,
    stateCanonicalGenesis: canonicalGenesis, anchorPresent, anchorConsistent,
    lockPresent, txnPresent, reconcileMutexPresent: reconcileMutex.present, reconcileMutexValid: reconcileMutex.valid,
    reconciliationNeeded: true, recommendation,
    fingerprint: fp.fingerprint, artifactsPresent: fp.present, workflowIdentityRef: idRef,
  };
}

// ---------------------------------------------------------------------------
// MODE: reconcile-cleanup  (Owner-confirmed, fingerprint-bound, confined)
// ---------------------------------------------------------------------------
// Clean-reset targets are STRICTLY the artifacts the genesis initializer can create -- the
// progression state, the anchor, and the marker. A runtime claim lock or transition mutex
// is NEVER a genesis clean-reset target (its presence already forces "blocked"). The MARKER
// is deleted LAST: as long as any genesis residue exists, the "reconciliation needed"
// signal (the marker) survives, so a partial clean-reset is self-healing on a normal re-run.
const CLEAN_RESET_ROLES = Object.freeze(["state", "anchor", "marker"]);

function reconcileCleanup(args, deps = {}) {
  assertProductionArgs(args);
  if (args.confirmReconciliation !== RECONCILE_CONFIRM) throw new Error(`Reconciliation cleanup requires an explicit --confirmReconciliation ${RECONCILE_CONFIRM}.`);
  if (!args.fingerprint || !gate.isSha256(args.fingerprint)) throw new Error("--fingerprint (from a prior reconcile-inspect) is required.");
  if (!["clean-reset", "marker-only"].includes(args.action || "")) throw new Error("--action must be clean-reset or marker-only.");

  const _fs = deps.fs || fs;
  const now = deps.now || (() => new Date());
  const roles = artifactRoles(args.progressionOut);
  const reconFile = gate.reconcilePath(args.progressionOut);

  // 1. EXCLUSIVE reconciliation mutex, created BEFORE the authoritative re-inspection.
  //    A pre-existing mutex means a concurrent cleanup, or a crash-left / interrupted one:
  //    refuse (never auto-broken). createOnly is O_EXCL, so a race resolves to one winner.
  if (_fs.existsSync(reconFile)) throw new Error("A reconciliation mutex is already present (another reconciliation is in progress or was interrupted) -- refusing.");
  const reconToken = crypto.randomBytes(16).toString("hex");
  createOnly(reconFile, JSON.stringify({ version: gate.RECONCILE_MUTEX_VERSION, token: reconToken, at: now().toISOString() }), deps);
  const releaseOwnMutex = () => {
    try { const h = JSON.parse(_fs.readFileSync(reconFile, "utf8")); if (h && h.token === reconToken) _fs.unlinkSync(reconFile); } catch { /* leave it */ }
  };

  // PHASE A -- validation under the mutex. No filesystem mutation yet, so on ANY validation
  // refusal we RELEASE our own mutex and surface the refusal (the operator can re-inspect
  // and retry; a mere "wrong --action" must not brick reconciliation).
  let report, snapshot, targetRoles;
  try {
    // 2. Authoritative re-inspection WHILE holding the mutex.
    report = reconcileInspect(args, deps);
    if (!report.reconciliationNeeded) throw new Error("No init marker present; nothing to reconcile (refusing).");
    if (report.recommendation === "blocked") throw new Error("Inspection classified this residue as BLOCKED (untrusted/indeterminate/foreign lock or txn) -- automatic cleanup refused; escalate to the Owner.");
    if (args.action !== report.recommendation) throw new Error(`Requested --action ${args.action} does not match the inspected recommendation ${report.recommendation} -- refusing.`);
    // Snapshot binding: the artifact set must be byte-identical to the operator's inspection.
    if (report.fingerprint !== args.fingerprint) throw new Error("Artifacts changed since inspection (fingerprint mismatch) -- refusing to reconcile.");
    // 3. Authoritative per-role digest snapshot taken under the mutex.
    snapshot = perRoleDigests(args.progressionOut, deps);
    targetRoles = args.action === "marker-only" ? ["marker"] : CLEAN_RESET_ROLES;
  } catch (err) {
    releaseOwnMutex();
    throw err;
  }

  // PHASE B -- deletions + finalization. From here a concurrent modification is possible,
  // so on ANY failure we FAIL CLOSED: leave the reconciliation mutex (and any residue) in
  // place -- the gate blocks (assertNoReconcileMutex) and a fresh governed inspection is
  // required. We remove the mutex ONLY on fully-verified success with our own token.
  try {
    // 4. Delete each target, re-verifying its CURRENT digest equals the snapshot digest
    //    IMMEDIATELY before unlink. A changed/replaced file aborts WITHOUT deleting it; an
    //    unlink failure aborts too. Either way the mutex is retained (fail-closed).
    const removed = [];
    for (const role of targetRoles) {
      const p = roles[role];
      if (deps.beforeTargetRecheck) deps.beforeTargetRecheck(role, p); // test seam: simulate concurrent replacement
      if (!_fs.existsSync(p)) { if (snapshot[role] !== null) throw new Error(`Target ${role} disappeared during cleanup -- aborting (fail-closed).`); continue; }
      const current = crypto.createHash("sha256").update(_fs.readFileSync(p)).digest("hex");
      if (current !== snapshot[role]) throw new Error(`Target ${role} changed between inspection and deletion -- aborting without deleting it (fail-closed).`);
      _fs.unlinkSync(p); // if this throws, we abort with the mutex retained
      removed.push(role);
    }

    // 5. Post-cleanup verification.
    if (targetRoles.includes("marker") && _fs.existsSync(roles.marker)) throw new Error("Marker still present after cleanup (fail-closed).");
    if (args.action === "clean-reset") { for (const role of CLEAN_RESET_ROLES) if (_fs.existsSync(roles[role])) throw new Error("Residual genesis artifact remains after clean-reset (fail-closed)."); }
    const after = fingerprintArtifacts(args.progressionOut, deps);

    // 6. Remove the reconciliation mutex ONLY now, and ONLY if it still carries OUR token.
    let held;
    try { held = JSON.parse(_fs.readFileSync(reconFile, "utf8")); } catch { held = null; }
    if (!held || held.token !== reconToken) throw new Error("Reconciliation mutex is owned by another attempt at finalization -- leaving it in place (fail-closed).");
    _fs.unlinkSync(reconFile);

    return {
      ok: true, mode: "reconcile-cleanup", action: args.action,
      removedRoles: removed.slice().sort(), reconciliationMutexCleared: true,
      fingerprintBefore: args.fingerprint, fingerprintAfter: after.fingerprint,
      artifactsRemaining: after.present, workflowIdentityRef: report.workflowIdentityRef,
    };
  } catch (err) {
    throw err; // fail closed: reconciliation mutex + residue retained (blocking)
  }
}

// ---------------------------------------------------------------------------
// MODE: reconcile-recover  (governed recovery of a CRASH-LEFT reconciliation mutex)
// ---------------------------------------------------------------------------
// A reconciliation mutex retained by a crashed/partial/aborted cleanup would otherwise
// strand production forever (every reconcile-cleanup refuses while it exists). This is the
// ONLY governed way to clear it -- Owner-confirmed, fingerprint-bound, and staleness-gated
// so it can never clear a still-live cleanup's mutex. It clears ONLY the mutex; all genesis
// residue is left intact for a subsequent normal reconcile-inspect + reconcile-cleanup.
function reconcileRecover(args, deps = {}) {
  assertProductionArgs(args);
  if (args.confirmReconciliation !== RECOVER_CONFIRM) throw new Error(`Reconciliation-mutex recovery requires an explicit --confirmReconciliation ${RECOVER_CONFIRM}.`);
  if (!args.fingerprint || !gate.isSha256(args.fingerprint)) throw new Error("--fingerprint (from a prior reconcile-inspect) is required.");

  const { idHash } = loadProductionAuthority(args, deps); // governed authority verification
  const _fs = deps.fs || fs;
  const now = deps.now || (() => new Date());
  const reconFile = gate.reconcilePath(args.progressionOut);
  if (!_fs.existsSync(reconFile)) throw new Error("No reconciliation mutex present; nothing to recover.");

  const held = readReconcileMutex(args.progressionOut, deps);

  // Snapshot binding: the artifact set must be byte-identical to the operator's inspection.
  const fp = fingerprintArtifacts(args.progressionOut, deps);
  if (fp.fingerprint !== args.fingerprint) throw new Error("Artifacts changed since inspection (fingerprint mismatch) -- refusing to recover.");

  // Staleness gate: a VALID mutex younger than the minimum age may belong to a live cleanup
  // -- refuse. A malformed/foreign mutex (never produced by a live governed cleanup) is
  // recoverable immediately.
  const minAge = Number.isFinite(deps.recoveryMinAgeSeconds) ? deps.recoveryMinAgeSeconds : RECOVERY_MIN_AGE_SECONDS;
  if (held.valid) {
    const ageSec = (now().getTime() - Date.parse(held.mutex.at)) / 1000;
    if (!(ageSec >= minAge)) throw new Error(`The reconciliation mutex is too recent to recover (younger than ${minAge}s) -- it may be a live cleanup. Retry once it has aged out or completed.`);
  }

  // Clear ONLY the mutex (never touch marker/state/anchor/lock/txn).
  _fs.unlinkSync(reconFile);

  // Re-classify the remaining residue so the operator knows the next governed step.
  const after = reconcileInspect(args, deps);
  return {
    ok: true, mode: "reconcile-recover",
    mutexWasValid: held.valid, mutexCleared: true,
    residualReconciliationNeeded: after.reconciliationNeeded, residualRecommendation: after.recommendation,
    fingerprint: args.fingerprint, workflowIdentityRef: `ref:${idHash.slice(0, 16)}`,
  };
}

// ---------------------------------------------------------------------------
// Output sanitizer -- strips exact known protected values (spaces included) then any
// remaining quoted/absolute path patterns.
// ---------------------------------------------------------------------------
function sanitizeForOutput(msg, protectedValues = []) {
  let s = String(msg);
  // 1. Exact known values first, longest-first so a superstring (…json.anchor) redacts
  //    before its prefix (…json). Covers protected paths with spaces verbatim.
  const known = [...new Set(protectedValues.filter(Boolean))].sort((a, b) => b.length - a.length);
  for (const v of known) { while (s.includes(v)) s = s.split(v).join("<redacted>"); }
  // 2. Quote-aware generic: any quoted span containing a path separator (covers spaces).
  s = s.replace(/'[^']*[\\/][^']*'/g, "'<path>'");
  s = s.replace(/"[^"]*[\\/][^"]*"/g, '"<path>"');
  // 3. Unquoted absolute-path fallbacks (best-effort; the exact-value pass above is the
  //    guarantee for our own protected paths).
  s = s.replace(/[A-Za-z]:\\[^\s'"]+/g, "<path>");            // Windows
  s = s.replace(/(?:\/[^\s'":]+){2,}/g, "<path>");             // POSIX multi-segment
  return s;
}

function protectedPathValues(args) {
  const vals = [args.executionModeConfirmation, args.stateKeyFile];
  if (args.progressionOut) { const r = artifactRoles(args.progressionOut); vals.push(r.state, r.anchor, r.marker, r.lock, r.txn, gate.reconcilePath(args.progressionOut)); }
  return vals.filter(Boolean);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const secrets = protectedPathValues(args);
  const emit = (v) => console.log(sanitizeForOutput(typeof v === "string" ? v : JSON.stringify(v, null, 2), secrets));
  try {
    let result, headline;
    if (args.mode === "reconcile-inspect") { result = reconcileInspect(args); headline = `RECONCILE-INSPECT: needed=${result.reconciliationNeeded} recommendation=${result.recommendation}`; }
    else if (args.mode === "reconcile-cleanup") { result = reconcileCleanup(args); headline = `RECONCILE-CLEANUP: action=${result.action} removed=[${result.removedRoles.join(",")}]`; }
    else if (args.mode === "reconcile-recover") { result = reconcileRecover(args); headline = `RECONCILE-RECOVER: mutexCleared=${result.mutexCleared} residual=${result.residualRecommendation}`; }
    else { result = initGenesis(args); headline = `GENESIS initialised (eligible, revision 0, next=${result.nextPersona} position ${result.nextPosition}).`; }
    emit(headline);
    emit(result);
  } catch (err) {
    console.error("Failed:", sanitizeForOutput(err.message, secrets));
    process.exitCode = 1;
  }
}

if (require.main === module) { main(); }

module.exports = {
  parseArgs, createOnly, initGenesis, reconcileInspect, reconcileCleanup, reconcileRecover,
  sanitizeForOutput, artifactRoles, fingerprintArtifacts, perRoleDigests, readReconcileMutex, assertProductionArgs,
  PRODUCTION_PROJECT_ID, RECONCILE_CONFIRM, RECOVER_CONFIRM, RECOVERY_MIN_AGE_SECONDS, MIGRATION_PERSONA_ORDER,
};
