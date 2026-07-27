// AUTH-PR-4 -- Governed test-persona recovery-email migration operator workflow.
//
// Governing readiness package:
//   docs/deployment/auth-pr-4-readiness-authorization-package.md  (merged, PR #451)
//
// WHAT THIS IS
// A single, guard-railed operator command that changes ONE test persona's
// Firebase Auth recovery/auth email to an Owner-supplied Gmail "+alias", one
// identity at a time, with exact rollback. It is the "governed operator
// workflow" the readiness package calls for (§4 Execution model).
//
// WHAT THIS BUILD DOES **NOT** AUTHORIZE (per the AUTH-PR-4 build/test gate)
//   - production execution (writes against the production project are BLOCKED
//     here -- a separate, not-yet-granted Production Identity-Mutation
//     Authorization gate is required; see PRODUCTION EXECUTION below and
//     readiness §11/§12);
//   - sending any reset or verification email (this workflow NEVER calls
//     sendPasswordResetEmail / generatePasswordResetLink);
//   - any explicit session revocation (this workflow NEVER calls
//     revokeRefreshTokens);
//   - changing password / UID / role / claim / accessVersion / Employee-link /
//     any Firestore data (this workflow only sets Auth email + emailVerified);
//   - configuring an email provider or deploying anything;
//   - using or committing real emails, UIDs, tokens, passwords, or credentials.
//
// SAFETY POSTURE (all enforced below, before any SDK write)
//   - DRY-RUN BY DEFAULT: no write occurs unless --execute is passed.
//   - EXACT PROJECT GUARD: --projectId is required; the production project id
//     additionally requires a matching --confirmProduction (same convention as
//     provisionEmployeeAccess.js). Production EXECUTE is refused outright here.
//   - EXACT ORDERED-PERSONA GUARD: the target must be the persona at the given
//     --position in MIGRATION_PERSONA_ORDER; excluded personas are rejected; the
//     primary admin (last) requires break-glass verification + lower-risk
//     completion confirmation.
//   - PROTECTED OUT-OF-BAND INPUT: the persona->alias/uid mapping is read from a
//     file the Owner supplies out-of-band; it is never committed and never
//     written into evidence.
//   - ONE IDENTITY AT A TIME: exactly one persona per invocation.
//   - FAIL CLOSED: a disabled / missing / UID-mismatched / colliding account
//     halts (throws) -- never skipped, never enabled as a side effect.
//   - EXACT ROLLBACK: preflight captures the exact prior address AND its exact
//     prior emailVerified boolean; forward always writes emailVerified=false on
//     the new alias; rollback restores the exact prior address + captured prior
//     boolean; a prior `true` is never applied to the new alias; if the exact
//     prior address cannot be restored, rollback halts and never re-asserts
//     verified status on another address.
//   - SANITIZED EVIDENCE: evidence records booleans / patterns only -- never a
//     real address, UID, or the address-linked prior emailVerified value.
//   - SECRET LIFECYCLE: dry runs create no rollback artifact; a failure PROVEN to
//     be pre-mutation (before updateUser was invoked) cleans it; once a mutation is
//     attempted, an uncertain/failed outcome (including a read-back failure after a
//     successful updateUser) RETAINS the signed, protected artifact -- cleanup then
//     happens only after a confirmed successful rollback or explicit operator
//     closure. A read-back failure never destroys recovery state.
//   - EMULATOR / NON-PRODUCTION ONLY for testing: see
//     functions/test/authPr4RecoveryEmailMigration.test.mjs.
//
// Same tool category as provisionEmployeeAccess.js / assignTechnicianToUser.js:
// Admin SDK, run locally, no Cloud Functions deployment. Does not touch the
// React app, firebase.js, AuthContext.jsx, or firestore.rules.
//
// Usage (dry-run plan, emulator project):
//   FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
//     node scripts/authPr4RecoveryEmailMigration.js \
//     --projectId demo-authpr4 --employeeId emp-rudy-driver --position 1 \
//     --mappingFile /secure/out-of-band/mapping.json
//
// Usage (execute against a NON-production project, e.g. emulator, for testing):
//   ...as above... --execute
//
// PRODUCTION EXECUTION is intentionally NOT runnable from this build: passing
// --execute with --projectId taylor-parts throws. Enabling it is a separate PR
// under a separate Owner Production Identity-Mutation Authorization.

const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const productionGate = require("./authPr4ProductionGate.js");

const PRODUCTION_PROJECT_ID = "taylor-parts";

// The exact, ordered persona allowlist (readiness §2/§4): lowest-risk first,
// primary admin last. Nothing outside this list may be migrated.
const MIGRATION_PERSONA_ORDER = [
  "emp-rudy-driver", // 1 -- technician, no ops role, lowest blast radius
  "emp-rudy-parts-associate", // 2 -- dispatcher, PARTS_ASSOCIATE
  "emp-rudy-warehouse-manager", // 3 -- dispatcher, WAREHOUSE_MANAGER
  "emp-rudy-parts-manager", // 4 -- dispatcher, PARTS_MANAGER
  "emp-rudy-owner", // 5 -- PRIMARY ADMIN, last
];
const PRIMARY_ADMIN_EMPLOYEE_ID = "emp-rudy-owner";
const PRIMARY_ADMIN_POSITION = MIGRATION_PERSONA_ORDER.indexOf(PRIMARY_ADMIN_EMPLOYEE_ID) + 1;

// Explicitly out of scope (readiness §2): sales-manager has no Auth account,
// break-glass is the untouched safety net.
const EXCLUDED_EMPLOYEE_IDS = ["emp-rudy-sales-manager", "break-glass", "break-glass-admin"];

function parseArgs(argv) {
  const args = {
    execute: false,
    breakGlassVerified: false,
    confirmLowerRiskComplete: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    switch (token) {
      case "--execute":
        args.execute = true;
        break;
      case "--executeProduction":
        // The explicit, deliberate production-execution flag. It routes the run
        // through the full authorization gate (authPr4ProductionGate); without a
        // complete valid authorization the gate fails closed.
        args.executeProduction = true;
        break;
      case "--rollback":
        args.rollback = true;
        break;
      case "--authorizationManifest":
        args.authorizationManifest = argv[++i];
        break;
      case "--progressionFile":
        args.progressionFile = argv[++i];
        break;
      case "--breakGlassConfirmationFile":
        args.breakGlassConfirmationFile = argv[++i];
        break;
      case "--authorizedCommit":
        // An OPTIONAL operator input; never sufficient by itself -- the gate
        // independently derives repository identity and treats it as authoritative.
        args.authorizedCommit = argv[++i];
        break;
      case "--breakGlassVerified":
        args.breakGlassVerified = true;
        break;
      case "--confirmLowerRiskComplete":
        args.confirmLowerRiskComplete = true;
        break;
      case "--projectId":
        args.projectId = argv[++i];
        break;
      case "--confirmProduction":
        args.confirmProduction = argv[++i];
        break;
      case "--employeeId":
        args.employeeId = argv[++i];
        break;
      case "--position":
        args.position = Number(argv[++i]);
        break;
      case "--mappingFile":
        args.mappingFile = argv[++i];
        break;
      case "--capturedStateFile":
        // Rollback input: the protected, signed artifact written by the forward run.
        args.capturedStateFile = argv[++i];
        break;
      case "--capturedStateOut":
        args.capturedStateOut = argv[++i];
        break;
      case "--stateKeyFile":
        args.stateKeyFile = argv[++i];
        break;
      case "--evidenceOut":
        args.evidenceOut = argv[++i];
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }
  return args;
}

// EXACT PROJECT GUARD -- identical convention to provisionEmployeeAccess.js.
function assertProjectTarget(args) {
  if (!args.projectId) {
    throw new Error(
      "--projectId is required (no default target -- e.g. --projectId taylor-parts, or a non-production id such as demo-authpr4 for testing).",
    );
  }
  if (
    args.projectId === PRODUCTION_PROJECT_ID &&
    args.confirmProduction !== PRODUCTION_PROJECT_ID
  ) {
    throw new Error(
      `--projectId "${PRODUCTION_PROJECT_ID}" targets the production project -- this requires an explicit, ` +
        `matching --confirmProduction ${PRODUCTION_PROJECT_ID} flag as a deliberate, per-run confirmation. ` +
        `Use a different --projectId for emulator/non-production testing to skip this requirement.`,
    );
  }
  return args.projectId;
}

// PRODUCTION-EXECUTION AUTHORIZATION -- a production-project write is permitted
// ONLY through the explicit --executeProduction flag, which routes the run
// through the full authorization gate (assertProductionAuthorization, called in
// main() before any SDK init). Plain --execute / --rollback against the
// production project remain UNCONDITIONALLY refused here. The gate itself fails
// closed unless a complete, valid, recorded Owner authorization is presented, so
// production stays effectively blocked until that authorization exists.
function assertExecutionAuthorization(args) {
  const wantsSimpleWrite = Boolean(args.execute || args.rollback);
  const wantsProductionGatedWrite = Boolean(args.executeProduction);
  if (args.projectId === PRODUCTION_PROJECT_ID && wantsSimpleWrite && !wantsProductionGatedWrite) {
    throw new Error(
      "Refusing to write against the production project. Plain --execute / --rollback are DRY-RUN only " +
        "against production and EXECUTE only against non-production (emulator/fixture) projects. A production " +
        "identity mutation requires --executeProduction under a complete, valid recorded Owner authorization " +
        "(docs/deployment/auth-pr-4-production-enablement-design.md §5; authPr4ProductionGate).",
    );
  }
  return wantsSimpleWrite || wantsProductionGatedWrite ? "write" : "dry-run";
}

// EXACT ORDERED-PERSONA GUARD (readiness §4).
function assertPersonaOrder(args) {
  if (!args.employeeId) {
    throw new Error("--employeeId is required.");
  }
  if (EXCLUDED_EMPLOYEE_IDS.includes(args.employeeId)) {
    throw new Error(
      `Employee "${args.employeeId}" is explicitly EXCLUDED from AUTH-PR-4 migration ` +
        "(no Auth account / break-glass safety net -- readiness §2). Refusing.",
    );
  }
  const expectedIndex = MIGRATION_PERSONA_ORDER.indexOf(args.employeeId);
  if (expectedIndex === -1) {
    throw new Error(
      `Employee "${args.employeeId}" is not in the ordered persona allowlist. ` +
        `Allowed, in order: ${MIGRATION_PERSONA_ORDER.join(", ")}.`,
    );
  }
  if (!Number.isInteger(args.position)) {
    throw new Error("--position <1..5> is required and must match the persona's place in the order.");
  }
  if (args.position !== expectedIndex + 1) {
    throw new Error(
      `Order violation: "${args.employeeId}" is position ${expectedIndex + 1} in the migration order, ` +
        `but --position ${args.position} was given. One identity at a time, in order.`,
    );
  }
  // Primary admin is LAST and gated on break-glass + lower-risk completion.
  if (args.position === PRIMARY_ADMIN_POSITION) {
    if (!args.breakGlassVerified) {
      throw new Error(
        "Primary-admin migration (last) requires --breakGlassVerified: the independent break-glass " +
          "admin must be login-verified and recoverable first (readiness §4/§8, D-TWO-ADMIN).",
      );
    }
    if (!args.confirmLowerRiskComplete) {
      throw new Error(
        "Primary-admin migration (last) requires --confirmLowerRiskComplete: all four lower-risk " +
          "personas must have passed before the primary admin is migrated (readiness §4).",
      );
    }
  }
  return expectedIndex + 1;
}

// Read the protected out-of-band mapping (never committed). Shape:
//   { "emp-rudy-driver": { "uid": "<uid>", "newAlias": "base+driver@gmail.com" }, ... }
function loadMappingEntry(mappingFile, employeeId) {
  if (!mappingFile) {
    throw new Error("--mappingFile <path> is required (protected out-of-band persona->alias/uid mapping).");
  }
  let raw;
  try {
    raw = fs.readFileSync(mappingFile, "utf8");
  } catch (err) {
    throw new Error(`Cannot read --mappingFile "${mappingFile}": ${err.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`--mappingFile is not valid JSON: ${err.message}`);
  }
  const entry = parsed[employeeId];
  if (!entry || typeof entry.newAlias !== "string" || entry.newAlias.length === 0) {
    throw new Error(`--mappingFile has no { uid, newAlias } entry for "${employeeId}".`);
  }
  return { uid: entry.uid, newAlias: entry.newAlias };
}

// A non-identifying reference for an address -- used ONLY for evidence and
// operator display. Never emits the address itself. A short salted hash lets an
// operator correlate "same address" across a run without exposing it.
function addressRef(address, runSalt) {
  if (typeof address !== "string" || address.length === 0) return "(none)";
  if (!Buffer.isBuffer(runSalt) || runSalt.length < 32) {
    throw new Error("A cryptographically random per-run evidence salt is required.");
  }
  return `ref:${crypto.createHmac("sha256", runSalt).update(address).digest("hex").slice(0, 16)}`;
}

// FORWARD plan: new alias, emailVerified ALWAYS false (readiness §3). The
// captured prior `true` is NEVER applied to the new alias.
function buildForwardPlan({ employeeId, uid, priorAddress, priorEmailVerified, newAlias }) {
  return {
    kind: "forward",
    employeeId,
    uid,
    update: { email: newAlias, emailVerified: false },
    captured: { priorAddress, priorEmailVerified },
  };
}

// ROLLBACK plan: restore the EXACT prior address AND the EXACT captured prior
// emailVerified boolean (an exact reversal, not a coerced false).
function buildRollbackPlan({ employeeId, uid, priorAddress, priorEmailVerified }) {
  if (typeof priorAddress !== "string" || priorAddress.length === 0) {
    throw new Error("Rollback requires a captured exact prior address; none present. Halting.");
  }
  if (typeof priorEmailVerified !== "boolean") {
    throw new Error("Rollback requires the captured exact prior emailVerified boolean; none present. Halting.");
  }
  return {
    kind: "rollback",
    employeeId,
    uid,
    update: { email: priorAddress, emailVerified: priorEmailVerified },
  };
}

// A sanitized evidence record: booleans / patterns only. NEVER a real address,
// UID, or the address-linked prior emailVerified value.
function sanitizeEvidence(record) {
  return {
    workflow: "auth-pr-4-recovery-email-migration",
    employeeId: record.employeeId,
    position: record.position,
    mode: record.mode, // "dry-run" | "execute" | "rollback"
    projectClass: record.projectClass, // "production" | "non-production"
    aliasPattern: "<owner-inbox>+<persona-tag>",
    newAliasRef: record.newAliasRef, // salted-hash ref, not the address
    priorAddressRef: record.priorAddressRef, // salted-hash ref, not the address
    checks: {
      uidUnchanged: record.checks?.uidUnchanged ?? null,
      newAliasEmailVerifiedFalse: record.checks?.newAliasEmailVerifiedFalse ?? null,
      priorAddressUnclaimed: record.checks?.priorAddressUnclaimed ?? null,
      accountEnabled: record.checks?.accountEnabled ?? null,
    },
    // Observation only (readiness §5) -- never a continuity guarantee.
    operatorRevocationPerformed: false,
    resetOrVerificationEmailSent: false,
    sessionBehaviorObserved: record.sessionBehaviorObserved ?? "not-observed-in-this-mode",
    outcome: record.outcome, // "planned" | "applied" | "halted"
    timestamp: new Date().toISOString(),
  };
}

const CAPTURE_VERSION = 1;
const CAPTURE_FIELDS = Object.freeze([
  "version", "projectId", "employeeId", "position", "uid", "priorAddress",
  "priorEmailVerified", "newAlias", "createdAt",
]);

function loadStateKey(stateKeyFile) {
  if (!stateKeyFile) throw new Error("--stateKeyFile <path> is required for execute and rollback.");
  const key = fs.readFileSync(stateKeyFile);
  if (key.length < 32) throw new Error("--stateKeyFile must contain at least 32 bytes of protected random key material.");
  return key;
}

function canonicalCapture(payload) {
  return JSON.stringify(Object.fromEntries(CAPTURE_FIELDS.map((field) => [field, payload[field]])));
}

function signCapture(payload, key) {
  return crypto.createHmac("sha256", key).update(canonicalCapture(payload)).digest("hex");
}

function writeCapturedState(file, payload, key) {
  if (!file) throw new Error("--capturedStateOut <path> is required for execute.");
  if (fs.existsSync(file)) throw new Error("--capturedStateOut already exists; refusing to overwrite rollback state.");
  const artifact = { ...payload, signature: signCapture(payload, key) };
  const temp = `${file}.tmp-${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
  try {
    fs.writeFileSync(temp, JSON.stringify(artifact), { mode: 0o600, flag: "wx" });
    fs.renameSync(temp, file);
    try { fs.chmodSync(file, 0o600); } catch { /* Windows ACLs are operator-managed. */ }
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
  return file;
}

function readAndVerifyCapturedState(file, key, expected) {
  const artifact = JSON.parse(fs.readFileSync(file, "utf8"));
  const allowed = new Set([...CAPTURE_FIELDS, "signature"]);
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact) ||
      Object.keys(artifact).some((field) => !allowed.has(field)) ||
      CAPTURE_FIELDS.some((field) => !(field in artifact)) ||
      artifact.version !== CAPTURE_VERSION ||
      typeof artifact.signature !== "string") {
    throw new Error("Captured rollback state has an invalid schema.");
  }
  const expectedSignature = signCapture(artifact, key);
  const supplied = Buffer.from(artifact.signature, "hex");
  const calculated = Buffer.from(expectedSignature, "hex");
  if (supplied.length !== calculated.length || !crypto.timingSafeEqual(supplied, calculated)) {
    throw new Error("Captured rollback state failed integrity verification.");
  }
  for (const field of ["projectId", "employeeId", "position", "uid", "newAlias"]) {
    if (artifact[field] !== expected[field]) {
      throw new Error(`Captured rollback state does not match the governed ${field}.`);
    }
  }
  if (typeof artifact.priorAddress !== "string" || !artifact.priorAddress ||
      typeof artifact.priorEmailVerified !== "boolean" ||
      typeof artifact.createdAt !== "string" || !Number.isFinite(Date.parse(artifact.createdAt))) {
    throw new Error("Captured rollback state contains invalid values.");
  }
  return artifact;
}

function secureUnlink(file) {
  if (!file) return;
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file);
    const dir = path.dirname(file);
    if (dir.includes("authpr4-") && fs.existsSync(dir)) fs.rmdirSync(dir);
  } catch {
    // best-effort cleanup; never throw from cleanup
  }
}

// PREFLIGHT (read-only): fail-closed on disabled / missing / UID-mismatch /
// alias-collision, and capture the exact prior address + prior emailVerified.
async function preflight(auth, { employeeId, uid, newAlias }) {
  let user;
  try {
    user = await auth.getUser(uid);
  } catch (err) {
    throw new Error(`Halt (${employeeId}): account for the mapped uid was not found (${err.code || err.message}).`);
  }
  if (user.disabled) {
    throw new Error(
      `Halt (${employeeId}): account is DISABLED. Do not enable as a side effect; a disabled persona ` +
        "halts the entire sequence (readiness §7).",
    );
  }
  // Alias-collision: the new alias must not already belong to a DIFFERENT uid.
  let collision = false;
  try {
    const existing = await auth.getUserByEmail(newAlias);
    if (existing && existing.uid !== uid) collision = true;
  } catch (err) {
    if (err.code !== "auth/user-not-found") throw err; // not-found = unclaimed = good
  }
  if (collision) {
    throw new Error(
      `Halt (${employeeId}): the new alias is already bound to a different account (collision). ` +
        "Never overwrite/merge/reassign a UID; the Owner selects an alternate tag (readiness §7).",
    );
  }
  return {
    uid: user.uid,
    priorAddress: user.email || "",
    priorEmailVerified: Boolean(user.emailVerified),
    accountEnabled: !user.disabled,
    newAliasUnclaimed: !collision,
  };
}

// Apply a plan. Dry-run prints the plan and writes nothing. Execute performs a
// SINGLE auth.updateUser (email + emailVerified only) then reads back.
//
// MUTATION-ATTEMPT BOUNDARY: from the instant updateUser is invoked, the outcome
// is no longer provably "no mutation" -- a thrown updateUser (network/timeout) or
// a thrown read-back may still have committed the change server-side. We therefore
// mark `mutationAttempted` at that boundary and attach it to any thrown error, so
// callers RETAIN the exact-rollback artifact for every error past this point and
// only clean up when it is PROVEN no mutation occurred.
async function applyPlan(auth, plan, { execute }) {
  if (!execute) {
    return { applied: false, mode: "dry-run", mutationAttempted: false };
  }
  let mutationAttempted = false;
  try {
    mutationAttempted = true; // about to mutate -- outcome is now uncertain on any throw
    await auth.updateUser(plan.uid, plan.update);
    const after = await auth.getUser(plan.uid);
    return {
      applied: true,
      mode: plan.kind === "rollback" ? "rollback" : "execute",
      mutationAttempted: true,
      readback: {
        uid: after.uid,
        email: after.email || "",
        emailVerified: Boolean(after.emailVerified),
        disabled: Boolean(after.disabled),
      },
    };
  } catch (err) {
    // A read-back (getUser) failure after a successful updateUser lands here with
    // mutationAttempted === true: the identity is (or may be) changed and the
    // recovery artifact MUST survive.
    err.mutationAttempted = mutationAttempted;
    throw err;
  }
}

// Cleanup of the exact-rollback artifact after an apply error is only safe when
// it is PROVEN no mutation occurred (the error happened strictly before updateUser
// was invoked). Any attempted mutation -> retain.
function retainArtifactOnError(err) {
  return Boolean(err && err.mutationAttempted);
}

// Operator-facing message for an uncertain outcome: the identity may already be
// changed and the recovery artifact must be preserved for a governed rollback.
function uncertainOutcomeMessage(employeeId, capturedStatePath) {
  return (
    `UNCERTAIN OUTCOME for ${employeeId}: an Auth mutation was ATTEMPTED and its success ` +
    `was not confirmed (write or read-back error). The identity MAY already be changed. The ` +
    `signed exact-rollback artifact${capturedStatePath ? ` at "${capturedStatePath}"` : ""} has ` +
    `been PRESERVED -- do NOT delete it. Recover with a governed --rollback using this artifact ` +
    `to restore the exact prior address + emailVerified, or follow operator closure (readiness §6/§8).`
  );
}

function projectClass(projectId) {
  return projectId === PRODUCTION_PROJECT_ID ? "production" : "non-production";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // Guards, in order, BEFORE initializeApp() -- a malformed/unauthorized
  // invocation must fail before any Firebase SDK call.
  const projectId = assertProjectTarget(args);
  assertExecutionAuthorization(args);

  // Production-gated path: the full authorization gate runs BEFORE SDK init and
  // fails closed on anything invalid. It independently verifies repository
  // identity + governed-file hashes, the integrity-checked progression record
  // (only the exact next persona proceeds), and -- for position 5 -- a time-valid
  // break-glass confirmation. The effective persona comes from the progression,
  // so --position / --confirmLowerRiskComplete cannot bypass ordering.
  let gateCtx = null;
  let position;
  if (args.executeProduction) {
    gateCtx = productionGate.assertProductionAuthorization(args, {
      personaOrder: MIGRATION_PERSONA_ORDER,
    });
    args.employeeId = gateCtx.effective.employeeId;
    position = MIGRATION_PERSONA_ORDER.indexOf(args.employeeId) + 1;
    if (!args.rollback) args.execute = true; // a production forward write
  } else {
    position = assertPersonaOrder(args);
  }

  initializeApp({ projectId });
  const auth = getAuth();

  const evidence = {
    employeeId: args.employeeId,
    position,
    projectClass: projectClass(projectId),
    checks: {},
  };
  const runSalt = crypto.randomBytes(32);

  try {
    if (args.rollback) {
      // ROLLBACK path: restore exact prior address + captured prior boolean.
      if (!args.capturedStateFile) {
        throw new Error("--rollback requires --capturedStateFile <path> (protected temp file from the forward run).");
      }
      const mapping = loadMappingEntry(args.mappingFile, args.employeeId);
      const stateKey = loadStateKey(args.stateKeyFile);
      const captured = readAndVerifyCapturedState(args.capturedStateFile, stateKey, {
        projectId,
        employeeId: args.employeeId,
        position,
        uid: mapping.uid,
        newAlias: mapping.newAlias,
      });
      const current = await auth.getUser(captured.uid);
      if (current.disabled || current.email !== captured.newAlias) {
        throw new Error("Rollback halted: current account state does not match the governed migrated alias.");
      }
      // Rollback preflight: the exact prior address must still be unclaimed.
      let priorUnclaimed = true;
      try {
        const holder = await auth.getUserByEmail(captured.priorAddress);
        if (holder && holder.uid !== captured.uid) priorUnclaimed = false;
      } catch (err) {
        if (err.code !== "auth/user-not-found") throw err;
      }
      evidence.checks.priorAddressUnclaimed = priorUnclaimed;
      if (!priorUnclaimed) {
        throw new Error(
          `Halt rollback (${args.employeeId}): the exact prior address is now claimed by another account. ` +
            "Never re-assert verified status on another address (readiness §8).",
        );
      }
      const plan = buildRollbackPlan({
        employeeId: args.employeeId,
        uid: captured.uid,
        priorAddress: captured.priorAddress,
        priorEmailVerified: captured.priorEmailVerified,
      });
      let result;
      try {
        result = await applyPlan(auth, plan, { execute: true });
      } catch (err) {
        // A rollback whose success was not confirmed must also RETAIN the artifact
        // so recovery can be re-attempted -- never delete it on an uncertain rollback.
        if (retainArtifactOnError(err)) {
          console.error(uncertainOutcomeMessage(args.employeeId, args.capturedStateFile));
        }
        throw err;
      }
      evidence.mode = "rollback";
      evidence.priorAddressRef = addressRef(captured.priorAddress, runSalt);
      evidence.newAliasRef = addressRef(captured.newAlias, runSalt);
      evidence.checks.uidUnchanged = result.readback?.uid === captured.uid;
      evidence.outcome = "applied";
      // Only a CONFIRMED successful rollback removes the recovery artifact.
      secureUnlink(args.capturedStateFile);
      // A confirmed production rollback REVERSES + SUSPENDS progression, blocking
      // later personas until the sequence is governed-reestablished (design §5.1).
      if (args.executeProduction) {
        productionGate.writeProgression(
          args.progressionFile,
          productionGate.suspendProgressionAfterRollback(gateCtx.progression, args.employeeId),
          gateCtx.stateKey,
        );
      }
      console.log(`ROLLBACK applied for ${args.employeeId}: restored exact prior address + prior emailVerified.`);
    } else {
      // FORWARD path (dry-run default; execute only against non-production).
      const { uid: mappedUid, newAlias } = loadMappingEntry(args.mappingFile, args.employeeId);
      if (!mappedUid) {
        throw new Error(`--mappingFile entry for "${args.employeeId}" is missing its uid.`);
      }
      const pre = await preflight(auth, { employeeId: args.employeeId, uid: mappedUid, newAlias });
      evidence.checks.accountEnabled = pre.accountEnabled;
      evidence.checks.priorAddressUnclaimed = true; // n/a on forward; alias-collision handled in preflight
      evidence.newAliasRef = addressRef(newAlias, runSalt);
      evidence.priorAddressRef = addressRef(pre.priorAddress, runSalt);

      const plan = buildForwardPlan({
        employeeId: args.employeeId,
        uid: pre.uid,
        priorAddress: pre.priorAddress,
        priorEmailVerified: pre.priorEmailVerified,
        newAlias,
      });

      // Write the signed rollback artifact BEFORE the Auth mutation so a crash after
      // updateUser cannot strand the identity without exact recovery state. Remove it
      // if the write itself fails; retain it after success until rollback/closure.
      if (args.execute) {
        const stateKey = loadStateKey(args.stateKeyFile);
        writeCapturedState(args.capturedStateOut, {
          version: CAPTURE_VERSION,
          projectId,
          employeeId: args.employeeId,
          position,
          uid: pre.uid,
          priorAddress: pre.priorAddress,
          priorEmailVerified: pre.priorEmailVerified,
          newAlias,
          createdAt: new Date().toISOString(),
        }, stateKey);
      }
      let result;
      try {
        result = await applyPlan(auth, plan, { execute: args.execute });
      } catch (err) {
        if (args.execute && retainArtifactOnError(err)) {
          // Mutation was attempted -- the identity may already be changed. NEVER
          // destroy recovery state here; tell the operator the outcome is uncertain.
          console.error(uncertainOutcomeMessage(args.employeeId, args.capturedStateOut));
        } else if (args.execute) {
          // Proven pre-mutation failure (error before updateUser was invoked): no
          // change occurred, so the just-written artifact is safe to remove.
          secureUnlink(args.capturedStateOut);
        }
        throw err;
      }
      evidence.mode = args.execute ? "execute" : "dry-run";
      if (result.applied) {
        evidence.checks.uidUnchanged = result.readback.uid === pre.uid;
        evidence.checks.newAliasEmailVerifiedFalse = result.readback.emailVerified === false;
        evidence.outcome = "applied";
        // Fail-closed read-back verification.
        if (!evidence.checks.uidUnchanged) throw new Error("Post-write UID changed -- halting.");
        if (!evidence.checks.newAliasEmailVerifiedFalse) {
          throw new Error("Post-write emailVerified is not false on the new alias -- halting.");
        }
        // Progression advances ONLY after a fully verified write + read-back (the
        // fail-closed checks above throw before this). An uncertain outcome never
        // reaches here, so it never advances (design §5.1).
        if (args.executeProduction) {
          productionGate.writeProgression(
            args.progressionFile,
            productionGate.advanceProgression(gateCtx.progression, args.employeeId),
            gateCtx.stateKey,
          );
        }
        console.log(
          `FORWARD executed for ${args.employeeId} (position ${position}, ${evidence.projectClass}): ` +
            "new alias set, emailVerified=false, UID unchanged. Captured-prior state written for rollback.",
        );
      } else {
        evidence.outcome = "planned";
        console.log(
          `DRY-RUN plan for ${args.employeeId} (position ${position}, ${evidence.projectClass}): ` +
            "would set new alias with emailVerified=false; UID preserved; no write performed.",
        );
      }
    }

    const sanitized = sanitizeEvidence(evidence);
    if (args.evidenceOut) {
      fs.writeFileSync(args.evidenceOut, JSON.stringify(sanitized, null, 2));
    }
    console.log(JSON.stringify(sanitized, null, 2));
  } finally {
    runSalt.fill(0);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Failed:", err.message);
    process.exitCode = 1;
  });
}

module.exports = {
  parseArgs,
  assertProjectTarget,
  assertExecutionAuthorization,
  assertPersonaOrder,
  loadMappingEntry,
  addressRef,
  buildForwardPlan,
  buildRollbackPlan,
  sanitizeEvidence,
  writeCapturedState,
  readAndVerifyCapturedState,
  loadStateKey,
  secureUnlink,
  preflight,
  applyPlan,
  retainArtifactOnError,
  uncertainOutcomeMessage,
  projectClass,
  MIGRATION_PERSONA_ORDER,
  PRIMARY_ADMIN_EMPLOYEE_ID,
  PRIMARY_ADMIN_POSITION,
  EXCLUDED_EMPLOYEE_IDS,
  PRODUCTION_PROJECT_ID,
};
