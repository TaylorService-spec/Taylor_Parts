// Enterprise Access & Administration Platform (Issue #226) -- Row 8
// (Task 13) integration test proving operatorAccessCommand.js's
// --execute path is genuinely wired to the real trustedWriterCommands.ts
// functions (compiled to functions/lib), against a live Firestore+Auth
// emulator. Row 7's own trustedWriterCommands.test.mjs already
// exhaustively covers the underlying security/idempotency/atomicity
// contract -- this file only needs to prove the CLI wrapper's wiring
// is correct (one representative command is enough for that), not
// re-prove the whole contract.
//
// Prerequisite: run against live Firestore + Auth emulators, e.g.:
//   firebase emulators:start --only firestore,auth --project taylor-parts
// then, in a second terminal (after `npm run build`):
//   node --test test/operatorAccessCommandExecute.test.js
//
// Never touches the live "taylor-parts" project.
"use strict";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("fs");
const os = require("os");
const path = require("path");
const admin = require("firebase-admin");

const { runOperatorAccessCommand, OWNER_AUTHORIZATION_PHRASE } = require("../scripts/operatorAccessCommand.js");

const PROJECT_ID = "taylor-parts";
admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();
const auth = admin.auth();

let uidCounter = 0;
function uid(label) {
  uidCounter += 1;
  return `${label}-${Date.now()}-${uidCounter}`;
}

async function seedActiveAdminAssignment(principalUid) {
  await db.collection("roleAssignments").doc(`seed-${principalUid}-admin`).set({
    principalUid,
    roleId: "admin",
    scope: { type: "global" },
    grantedBy: "test-seed",
    grantedAt: admin.firestore.Timestamp.now(),
    status: "active",
    accessVersionAtGrant: 0,
  });
}

test("operatorAccessCommand --execute genuinely calls the real grantRole() -- Firestore state + Audit Event + claims all reflect the real trusted-writer contract", async () => {
  const actorUid = uid("operator-admin-actor");
  await seedActiveAdminAssignment(actorUid);
  const principalUid = uid("operator-principal");
  await auth.createUser({ uid: principalUid });
  const idempotencyKey = uid("operator-grant-key");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "operator-access-execute-"));

  const outcome = await runOperatorAccessCommand(
    {
      ownerAuthorization: OWNER_AUTHORIZATION_PHRASE,
      command: "grantRole",
      actorUid,
      principalUid,
      roleId: "technician",
      scopeType: "global",
      idempotencyKey,
      execute: true,
    },
    { intentDir: tmpDir }
  );

  assert.equal(outcome.dryRun, false);
  assert.equal(outcome.result.status, "applied");

  const assignmentSnap = await db.collection("roleAssignments").doc(idempotencyKey).get();
  assert.ok(assignmentSnap.exists, "the real grantRole() must have created the roleAssignment doc");
  assert.equal(assignmentSnap.data().principalUid, principalUid);

  const auditSnap = await db.collection("auditEvents").doc(idempotencyKey).get();
  assert.ok(auditSnap.exists, "the real grantRole() must have emitted an Audit Event");
  assert.equal(auditSnap.data().outcome, "applied");

  const userRecord = await auth.getUser(principalUid);
  assert.equal(userRecord.customClaims.accessVersion, 1, "the real grantRole() must have synced claims");

  const intentRecord = JSON.parse(fs.readFileSync(path.join(tmpDir, `${idempotencyKey}.json`), "utf8"));
  assert.equal(intentRecord.status, "succeeded");
  assert.equal(intentRecord.result.status, "applied");
});

test("operatorAccessCommand --execute: an unauthorized actor is denied by the real grantRole() -- no bypass through the operator wrapper", async () => {
  const dispatcherActorUid = uid("operator-dispatcher-actor");
  await db.collection("roleAssignments").doc(`seed-${dispatcherActorUid}-dispatcher`).set({
    principalUid: dispatcherActorUid,
    roleId: "dispatcher",
    scope: { type: "global" },
    grantedBy: "test-seed",
    grantedAt: admin.firestore.Timestamp.now(),
    status: "active",
    accessVersionAtGrant: 0,
  });
  const principalUid = uid("operator-principal-denied");
  const idempotencyKey = uid("operator-grant-denied-key");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "operator-access-execute-denied-"));

  await assert.rejects(() =>
    runOperatorAccessCommand(
      {
        ownerAuthorization: OWNER_AUTHORIZATION_PHRASE,
        command: "grantRole",
        actorUid: dispatcherActorUid,
        principalUid,
        roleId: "technician",
        scopeType: "global",
        idempotencyKey,
        execute: true,
      },
      { intentDir: tmpDir }
    )
  );

  const assignmentSnap = await db.collection("roleAssignments").doc(idempotencyKey).get();
  assert.equal(assignmentSnap.exists, false, "the operator wrapper must not bypass the real actor-authorization check");

  const intentRecord = JSON.parse(fs.readFileSync(path.join(tmpDir, `${idempotencyKey}.json`), "utf8"));
  assert.equal(intentRecord.status, "failed");
});
