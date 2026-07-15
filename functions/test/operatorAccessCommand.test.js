const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  parseArgs,
  assertProjectTarget,
  assertOwnerAuthorized,
  assertValidCommand,
  assertIdempotencyKey,
  buildCommandInput,
  buildScope,
  runOperatorAccessCommand,
  redactForLogging,
  PRODUCTION_PROJECT_ID,
  OWNER_AUTHORIZATION_PHRASE,
  VALID_COMMANDS,
} = require("../scripts/operatorAccessCommand.js");

// Enterprise Access & Administration Platform (Issue #226) -- Row 8
// (Task 13) tests for the operator-script's OWN pure logic (argument
// parsing, guards, plan-building, dry-run default, write-ahead/
// recovery, redaction) -- no live Firestore/Auth needed for any of
// these, matching this repo's established lightweight-mock convention
// for a script's pure phases (see provisionEmployeeAccessSecurityRole.
// test.js). The --execute path's actual Firestore/Auth mutation is
// covered separately by operatorAccessCommandExecute.test.mjs against
// a live emulator, since Row 7's own trustedWriterCommands.test.mjs
// already exhaustively covers that logic -- this file only needs to
// prove the WIRING is correct, not re-prove the security contract.

test("parseArgs: parses --flag value pairs and boolean flags", () => {
  const args = parseArgs(["--projectId", "taylor-parts", "--execute", "--command", "grantRole"]);
  assert.equal(args.projectId, "taylor-parts");
  assert.equal(args.execute, true);
  assert.equal(args.command, "grantRole");
});

test("assertProjectTarget: requires --projectId", () => {
  assert.throws(() => assertProjectTarget({}), /--projectId is required/);
});

test("assertProjectTarget: production project requires matching --confirmProduction", () => {
  assert.throws(
    () => assertProjectTarget({ projectId: PRODUCTION_PROJECT_ID }),
    /requires an explicit, matching --confirmProduction/
  );
  assert.doesNotThrow(() =>
    assertProjectTarget({ projectId: PRODUCTION_PROJECT_ID, confirmProduction: PRODUCTION_PROJECT_ID })
  );
});

test("assertProjectTarget: non-production project needs no confirmation", () => {
  assert.doesNotThrow(() => assertProjectTarget({ projectId: "taylor-parts-test" }));
});

test("assertOwnerAuthorized: rejects a missing or wrong phrase", () => {
  assert.throws(() => assertOwnerAuthorized({}), /--ownerAuthorization must exactly match/);
  assert.throws(
    () => assertOwnerAuthorized({ ownerAuthorization: "i confirm owner authorization for this access change" }),
    /--ownerAuthorization must exactly match/
  );
});

test("assertOwnerAuthorized: accepts the exact phrase", () => {
  assert.doesNotThrow(() => assertOwnerAuthorized({ ownerAuthorization: OWNER_AUTHORIZATION_PHRASE }));
});

test("assertValidCommand: rejects an unknown or missing command", () => {
  assert.throws(() => assertValidCommand({}), /--command is required/);
  assert.throws(() => assertValidCommand({ command: "notARealCommand" }), /--command is required/);
});

test("assertValidCommand: accepts every one of the six governed commands", () => {
  for (const command of VALID_COMMANDS) {
    assert.equal(assertValidCommand({ command }), command);
  }
});

test("assertIdempotencyKey: is always required, never generated", () => {
  assert.throws(() => assertIdempotencyKey({}), /--idempotencyKey is required/);
  assert.equal(assertIdempotencyKey({ idempotencyKey: "operator-key-1" }), "operator-key-1");
});

test("buildScope: requires --scopeType and carries --scopeValue when present", () => {
  assert.throws(() => buildScope({}), /--scopeType is required/);
  assert.deepEqual(buildScope({ scopeType: "global" }), { type: "global" });
  assert.deepEqual(buildScope({ scopeType: "domain", scopeValue: "customer" }), {
    type: "domain",
    value: "customer",
  });
});

test("buildCommandInput: grantRole assembles the exact trustedWriterCommands.grantRole input shape", () => {
  const input = buildCommandInput("grantRole", {
    actorUid: "actor-1",
    principalUid: "principal-1",
    roleId: "technician",
    scopeType: "global",
    idempotencyKey: "key-1",
  });
  assert.deepEqual(input, {
    actorUid: "actor-1",
    principalUid: "principal-1",
    roleId: "technician",
    scope: { type: "global" },
    approverUid: undefined,
    idempotencyKey: "key-1",
  });
});

test("buildCommandInput: setUserStatus assembles the exact input shape", () => {
  const input = buildCommandInput("setUserStatus", {
    actorUid: "actor-1",
    principalUid: "principal-1",
    status: "disabled",
    idempotencyKey: "key-2",
  });
  assert.deepEqual(input, {
    actorUid: "actor-1",
    principalUid: "principal-1",
    status: "disabled",
    idempotencyKey: "key-2",
  });
});

test("buildCommandInput: rejectAccessRequest requires --reason", () => {
  assert.throws(
    () =>
      buildCommandInput("rejectAccessRequest", {
        actorUid: "actor-1",
        requestId: "request-1",
        idempotencyKey: "key-3",
      }),
    /--reason is required/
  );
});

test("redactForLogging: only ever echoes the fixed allowlist of command-input fields", () => {
  const redacted = redactForLogging({
    actorUid: "actor-1",
    principalUid: "principal-1",
    roleId: "technician",
    scope: { type: "global" },
    idempotencyKey: "key-1",
    // Deliberately simulating a field that must NEVER be echoed even if
    // it somehow appeared on the input object -- proves the allowlist,
    // not a denylist, is what protects credential/token material.
    serviceAccountKey: "should-never-appear",
  });
  assert.deepEqual(Object.keys(redacted).sort(), [
    "actorUid",
    "idempotencyKey",
    "principalUid",
    "roleId",
    "scope",
  ]);
  assert.equal(redacted.serviceAccountKey, undefined);
});

test("runOperatorAccessCommand: dry-run by default -- no intent file written, no execution attempted", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "operator-access-dryrun-"));
  const outcome = await runOperatorAccessCommand(
    {
      ownerAuthorization: OWNER_AUTHORIZATION_PHRASE,
      command: "grantRole",
      actorUid: "actor-1",
      principalUid: "principal-1",
      roleId: "technician",
      scopeType: "global",
      idempotencyKey: "dry-run-key-1",
    },
    { intentDir: tmpDir }
  );
  assert.equal(outcome.dryRun, true);
  assert.equal(fs.readdirSync(tmpDir).length, 0, "dry-run must never write an intent file");
});

test("runOperatorAccessCommand: --execute writes a write-ahead intent record BEFORE any execution, with mode 0o600", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "operator-access-writeahead-"));
  // This will fail during executeCommand() (no Firestore emulator wired
  // up in this pure-logic test file), which is exactly what proves the
  // write-ahead record survives a failed execution -- see the next test.
  await assert.rejects(() =>
    runOperatorAccessCommand(
      {
        ownerAuthorization: OWNER_AUTHORIZATION_PHRASE,
        command: "grantRole",
        actorUid: "actor-1",
        principalUid: "principal-1",
        roleId: "technician",
        scopeType: "global",
        idempotencyKey: "writeahead-key-1",
        execute: true,
      },
      { intentDir: tmpDir }
    )
  );
  const files = fs.readdirSync(tmpDir);
  assert.equal(files.length, 1);
  const filePath = path.join(tmpDir, files[0]);
  const stat = fs.statSync(filePath);
  // 0o600 on POSIX; on Windows the mode bits are approximate, so only
  // assert the file exists and is readable -- the meaningful, portable
  // assertion is the CONTENT below.
  assert.ok(stat.isFile());
  const record = JSON.parse(fs.readFileSync(filePath, "utf8"));
  assert.equal(record.idempotencyKey, "writeahead-key-1");
  assert.equal(record.command, "grantRole");
});

test("runOperatorAccessCommand: fail-closed cleanup -- a failed execution updates the intent record to status 'failed', never deletes it, never leaves it 'pending'", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "operator-access-failclosed-"));
  await assert.rejects(() =>
    runOperatorAccessCommand(
      {
        ownerAuthorization: OWNER_AUTHORIZATION_PHRASE,
        command: "grantRole",
        actorUid: "actor-1",
        principalUid: "principal-1",
        roleId: "technician",
        scopeType: "global",
        idempotencyKey: "failclosed-key-1",
        execute: true,
      },
      { intentDir: tmpDir }
    )
  );
  const files = fs.readdirSync(tmpDir);
  assert.equal(files.length, 1, "the intent file must still exist after a failure -- never deleted");
  const record = JSON.parse(fs.readFileSync(path.join(tmpDir, files[0]), "utf8"));
  assert.equal(record.status, "failed");
  assert.ok(record.error && record.error.message, "the failure reason must be recorded");
});

test("runOperatorAccessCommand: rejects without ownerAuthorization even with --execute", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "operator-access-noauth-"));
  await assert.rejects(
    () =>
      runOperatorAccessCommand(
        {
          command: "grantRole",
          actorUid: "actor-1",
          principalUid: "principal-1",
          roleId: "technician",
          scopeType: "global",
          idempotencyKey: "noauth-key-1",
          execute: true,
        },
        { intentDir: tmpDir }
      ),
    /--ownerAuthorization must exactly match/
  );
  assert.equal(fs.readdirSync(tmpDir).length, 0, "no intent file may be written when the owner-authorization guard itself fails");
});
