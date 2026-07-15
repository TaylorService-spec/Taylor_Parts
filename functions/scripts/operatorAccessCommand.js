// Enterprise Access & Administration Platform (Issue #226) -- the
// Owner-authorized operator-script path for the six trusted-writer
// commands. Fixed by docs/specifications/enterprise-access-and-
// administration-platform.md sec17 and sequenced by docs/
// implementation-plans/enterprise-access-and-administration-platform.md
// (Row 8 / Task 13).
//
// WHY THIS SCRIPT EXISTS: per ADR-005 sec2.6/Spec sec17, trusted-writer
// ACTIVATION (a deployed, client-callable Cloud Function) is blocked
// until Issue #15's Cloud Functions are deployed and verified. Until
// then, "governed access changes run only through the separately-
// authorized Admin-SDK operator path" -- the SAME trust class as
// provisionEmployeeAccess.js. This script is that path for grantRole/
// revokeRole/assignApprovedRole/setUserStatus/approveAccessRequest/
// rejectAccessRequest: it calls the IDENTICAL functions/src/access/
// trustedWriterCommands.ts functions Row 7 already built and tested --
// no separate reimplementation of the security/idempotency/atomicity
// contract, just an Owner-run CLI wrapper around it with the extra
// guards an interactive, human-run operator tool needs that a future
// deployed Function's own caller-auth model would otherwise provide.
//
// One bounded CLI, six commands via --command, following this repo's
// established operator-script conventions (see provisionEmployeeAccess.js):
// --projectId required (no default), --confirmProduction exact-match
// gate for production, CommonJS require.main===module guard, exported
// pure helpers for testability.
//
// ADDITIONAL guards this Row requires beyond the established pattern
// (Task 13):
//   - Explicit Owner authorization guard: --ownerAuthorization must
//     match an exact, non-guessable confirmation phrase -- a deliberate
//     per-run human confirmation, distinct from --confirmProduction
//     (which only guards the PROJECT target, not the decision to make
//     this specific access change at all).
//   - Dry-run default: the script computes and PRINTS what it would do
//     and exits 0 WITHOUT calling the trusted-writer command, unless
//     --execute is also passed. A human must explicitly opt into the
//     mutating path every time.
//   - Deterministic identity: --idempotencyKey is REQUIRED (never
//     auto-generated) -- the operator supplies it, exactly matching
//     Row 7's own idempotency contract, so a re-run of the same
//     invocation (e.g. after a crash) is safe by construction.
//   - Write-ahead/recovery: before executing, an intent record is
//     written to a local file (never Firestore -- this is purely local
//     operator-side evidence, not a governed object); after
//     execution, the SAME file is updated with the outcome. A crash
//     mid-run leaves the intent file as evidence of exactly what was
//     attempted, so a human can inspect it and safely retry (the
//     trusted-writer's own idempotencyKey mechanism makes that retry
//     safe) rather than guessing at what happened.
//   - No credential discovery/logging: this script never reads,
//     resolves, or prints a credential file path, service-account key,
//     or token -- it relies entirely on firebase-admin's own Application
//     Default Credentials resolution (initializeApp({ projectId })),
//     identical to every other script in this directory. No env var is
//     ever dumped to stdout/stderr/the intent file.
//   - Secure output files: the intent/result file is written with mode
//     0o600 (owner read/write only).
//   - Fail-closed cleanup: on any error, the intent file is updated to
//     record the failure explicitly (status: "failed", the error
//     message) -- it is NEVER deleted and NEVER silently left showing a
//     stale "pending" status that could be misread as "maybe it
//     succeeded."
"use strict";

const fs = require("fs");
const path = require("path");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");

const PRODUCTION_PROJECT_ID = "taylor-parts";
const OWNER_AUTHORIZATION_PHRASE = "I CONFIRM OWNER AUTHORIZATION FOR THIS ACCESS CHANGE";
const DEFAULT_INTENT_DIR = ".operator-access-intents";

const VALID_COMMANDS = [
  "grantRole",
  "revokeRole",
  "assignApprovedRole",
  "setUserStatus",
  "approveAccessRequest",
  "rejectAccessRequest",
];

// --- Argument parsing (matches provisionEmployeeAccess.js's own style:
// simple `--flag value` pairs; a small fixed set of boolean flags that
// take no value). ---
const BOOLEAN_FLAGS = new Set(["execute"]);

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const flag = token.slice(2);
    if (BOOLEAN_FLAGS.has(flag)) {
      args[flag] = true;
      continue;
    }
    const value = argv[i + 1];
    args[flag] = value;
    i += 1;
  }
  return args;
}

// --- Exact project guard (identical convention to provisionEmployeeAccess.js) ---
function assertProjectTarget(args) {
  if (!args.projectId) {
    throw new Error(
      "--projectId is required (no default target -- e.g. --projectId taylor-parts, or a non-production id for testing)."
    );
  }
  if (args.projectId === PRODUCTION_PROJECT_ID && args.confirmProduction !== PRODUCTION_PROJECT_ID) {
    throw new Error(
      `--projectId "${PRODUCTION_PROJECT_ID}" targets the production project -- this requires an explicit, ` +
        `matching --confirmProduction ${PRODUCTION_PROJECT_ID} flag as a deliberate, per-run confirmation. ` +
        `Use a different --projectId for emulator/non-production testing to skip this requirement.`
    );
  }
  return args.projectId;
}

// --- Explicit Owner authorization guard (Task 13, additional to the
// project guard above -- this confirms the DECISION, not the TARGET). ---
function assertOwnerAuthorized(args) {
  if (args.ownerAuthorization !== OWNER_AUTHORIZATION_PHRASE) {
    throw new Error(
      `--ownerAuthorization must exactly match the required confirmation phrase: "${OWNER_AUTHORIZATION_PHRASE}"`
    );
  }
}

function assertValidCommand(args) {
  if (!args.command || !VALID_COMMANDS.includes(args.command)) {
    throw new Error(`--command is required and must be one of: ${VALID_COMMANDS.join(", ")}`);
  }
  return args.command;
}

// --- Deterministic identity: --idempotencyKey is always required, never generated. ---
function assertIdempotencyKey(args) {
  if (!args.idempotencyKey || typeof args.idempotencyKey !== "string") {
    throw new Error("--idempotencyKey is required (supply your own deterministic value -- never auto-generated).");
  }
  return args.idempotencyKey;
}

// Builds the exact input object the corresponding trustedWriterCommands.ts
// function expects, from CLI args -- pure, no I/O, so it is fully unit-
// testable without Firestore/Auth.
function buildCommandInput(command, args) {
  const idempotencyKey = assertIdempotencyKey(args);
  switch (command) {
    case "grantRole":
      return {
        actorUid: requireArg(args, "actorUid"),
        principalUid: requireArg(args, "principalUid"),
        roleId: requireArg(args, "roleId"),
        scope: buildScope(args),
        approverUid: args.approverUid,
        idempotencyKey,
      };
    case "revokeRole":
      return {
        actorUid: requireArg(args, "actorUid"),
        assignmentId: requireArg(args, "assignmentId"),
        approverUid: args.approverUid,
        idempotencyKey,
      };
    case "assignApprovedRole":
      return {
        actorUid: requireArg(args, "actorUid"),
        principalUid: requireArg(args, "principalUid"),
        roleId: requireArg(args, "roleId"),
        scope: buildScope(args),
        idempotencyKey,
      };
    case "setUserStatus":
      return {
        actorUid: requireArg(args, "actorUid"),
        principalUid: requireArg(args, "principalUid"),
        status: requireArg(args, "status"),
        idempotencyKey,
      };
    case "approveAccessRequest":
      return {
        actorUid: requireArg(args, "actorUid"),
        requestId: requireArg(args, "requestId"),
        idempotencyKey,
      };
    case "rejectAccessRequest":
      return {
        actorUid: requireArg(args, "actorUid"),
        requestId: requireArg(args, "requestId"),
        reason: requireArg(args, "reason"),
        idempotencyKey,
      };
    default:
      throw new Error(`Unhandled command: ${command}`);
  }
}

function requireArg(args, name) {
  if (!args[name]) {
    throw new Error(`--${name} is required for this command.`);
  }
  return args[name];
}

function buildScope(args) {
  if (!args.scopeType) {
    throw new Error("--scopeType is required (global|tenant|domain|location|ownAssignment).");
  }
  const scope = { type: args.scopeType };
  if (args.scopeValue !== undefined) scope.value = args.scopeValue;
  return scope;
}

// --- Write-ahead / recovery: a local, secure (0o600) JSON file recording
// the intent BEFORE execution and the outcome AFTER -- never deleted on
// failure, so a human always has evidence of exactly what was attempted. ---
function intentFilePath(intentDir, idempotencyKey) {
  return path.join(intentDir, `${idempotencyKey}.json`);
}

function writeIntentRecord(intentDir, record) {
  fs.mkdirSync(intentDir, { recursive: true, mode: 0o700 });
  const filePath = intentFilePath(intentDir, record.idempotencyKey);
  fs.writeFileSync(filePath, JSON.stringify(record, null, 2), { mode: 0o600 });
  return filePath;
}

// --- Dispatch to the real trustedWriterCommands.ts implementation
// (compiled to functions/lib at build time) -- no reimplementation of
// the security/idempotency/atomicity contract here. ---
function loadTrustedWriterCommands() {
  // eslint-disable-next-line global-require
  return require("../lib/access/trustedWriterCommands.js");
}

async function executeCommand(command, input) {
  const commands = loadTrustedWriterCommands();
  switch (command) {
    case "grantRole":
      return commands.grantRole(input);
    case "revokeRole":
      return commands.revokeRole(input);
    case "assignApprovedRole":
      return commands.assignApprovedRole(input);
    case "setUserStatus":
      return commands.setUserStatus(input);
    case "approveAccessRequest":
      return commands.approveAccessRequest(input);
    case "rejectAccessRequest":
      return commands.rejectAccessRequest(input);
    default:
      throw new Error(`Unhandled command: ${command}`);
  }
}

async function runOperatorAccessCommand(args, { intentDir = DEFAULT_INTENT_DIR } = {}) {
  assertOwnerAuthorized(args);
  const command = assertValidCommand(args);
  const input = buildCommandInput(command, args);

  // Dry-run by default: print the plan, write nothing to Firestore/Auth,
  // touch no intent file (there is no execution to record evidence of).
  if (!args.execute) {
    return {
      dryRun: true,
      command,
      input: redactForLogging(input),
    };
  }

  const startedAt = new Date().toISOString();
  const intentPath = writeIntentRecord(intentDir, {
    idempotencyKey: input.idempotencyKey,
    command,
    input: redactForLogging(input),
    status: "pending",
    startedAt,
  });

  try {
    const result = await executeCommand(command, input);
    writeIntentRecord(intentDir, {
      idempotencyKey: input.idempotencyKey,
      command,
      input: redactForLogging(input),
      status: "succeeded",
      startedAt,
      finishedAt: new Date().toISOString(),
      result,
    });
    return { dryRun: false, command, input: redactForLogging(input), result, intentPath };
  } catch (err) {
    // Fail-closed cleanup: the intent file is updated to explicitly show
    // failure -- never deleted, never left at a stale "pending" status.
    writeIntentRecord(intentDir, {
      idempotencyKey: input.idempotencyKey,
      command,
      input: redactForLogging(input),
      status: "failed",
      startedAt,
      finishedAt: new Date().toISOString(),
      error: { name: err.name, message: err.message },
    });
    throw err;
  }
}

// No credential discovery/logging: this only ever echoes the COMMAND
// INPUT fields (uids, role ids, scope, idempotency key) -- never an env
// var, credential path, or token. There is no field in any command's
// input shape that could carry one, by construction (trustedWriterCommands.ts's
// own input types), but this redaction stays a single, explicit
// allowlist rather than "log the whole object" so a future field
// addition is never silently echoed without review.
function redactForLogging(input) {
  const allowedKeys = [
    "actorUid",
    "principalUid",
    "roleId",
    "scope",
    "approverUid",
    "assignmentId",
    "status",
    "requestId",
    "reason",
    "idempotencyKey",
  ];
  const redacted = {};
  for (const key of allowedKeys) {
    if (input[key] !== undefined) redacted[key] = input[key];
  }
  return redacted;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  let projectId;
  try {
    projectId = assertProjectTarget(args);
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
    return;
  }

  if (!args.command) {
    console.error(
      "Usage: node scripts/operatorAccessCommand.js --projectId <id> [--confirmProduction taylor-parts] " +
        '--ownerAuthorization "<exact confirmation phrase>" --command <grantRole|revokeRole|assignApprovedRole|' +
        "setUserStatus|approveAccessRequest|rejectAccessRequest> --idempotencyKey <key> [--execute] " +
        "[command-specific args...]"
    );
    process.exitCode = 1;
    return;
  }

  initializeApp({ projectId });
  getFirestore();
  getAuth();

  try {
    const outcome = await runOperatorAccessCommand(args);
    if (outcome.dryRun) {
      console.log("DRY RUN -- no Firestore/Auth mutation performed. Re-run with --execute to apply.");
      console.log(JSON.stringify(outcome, null, 2));
    } else {
      console.log(`OK: ${outcome.command} -> ${JSON.stringify(outcome.result)}`);
      console.log(`Intent/result record: ${outcome.intentPath}`);
    }
  } catch (err) {
    console.error("Failed:", err.message);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  parseArgs,
  assertProjectTarget,
  assertOwnerAuthorized,
  assertValidCommand,
  assertIdempotencyKey,
  buildCommandInput,
  buildScope,
  runOperatorAccessCommand,
  redactForLogging,
  intentFilePath,
  PRODUCTION_PROJECT_ID,
  OWNER_AUTHORIZATION_PHRASE,
  VALID_COMMANDS,
  DEFAULT_INTENT_DIR,
};
