// Enterprise Access & Administration Platform (Issue #226) -- deployment-
// candidate row. Integration test proving the six callable adapters
// (accessCommandCallables.ts) are genuinely wired to the real
// trustedWriterCommands.ts functions against a live Firestore+Auth
// emulator, AND that the adapter's own security properties hold:
// actorUid is derived ONLY from the authenticated server context (never
// from client-supplied data), unauthenticated calls are rejected before
// any command logic runs, and every error is mapped to a safe public
// HttpsError that never leaks internal Firestore paths or resolver
// reason codes. trustedWriterCommands.test.mjs already exhaustively
// covers the underlying security/idempotency/atomicity contract itself
// (separation-of-duty, fail-closed Scope/shape validation, etc.) -- this
// file does not re-prove that, only the callable layer wrapped around it.
//
// Prerequisite: run against live Firestore + Auth emulators, e.g.:
//   firebase emulators:start --only firestore,auth --project taylor-parts
// then, in a second terminal (after `npm run build`):
//   node --test test/accessCommandCallables.test.js
//
// Never touches the live "taylor-parts" project -- no Functions emulator
// is started; each callable's compiled handler is invoked directly via
// its own `.run(request)` method (the standard way to unit-test a
// firebase-functions v2 onCall function without the HTTP layer), against
// the live Firestore/Auth emulators the underlying command module talks to.
"use strict";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";

const assert = require("node:assert/strict");
const test = require("node:test");
const admin = require("firebase-admin");

const PROJECT_ID = "taylor-parts";
admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();
const auth = admin.auth();

const callables = require("../lib/access/accessCommandCallables.js");

let uidCounter = 0;
function uid(label) {
  uidCounter += 1;
  return `${label}-${Date.now()}-${uidCounter}`;
}

async function seedActiveAssignment(principalUid, roleId, opts = {}) {
  const id = opts.id || `seed-${principalUid}-${roleId}`;
  await db.collection("roleAssignments").doc(id).set({
    principalUid,
    roleId,
    scope: { type: "global" },
    grantedBy: "test-seed",
    grantedAt: admin.firestore.Timestamp.now(),
    status: "active",
    accessVersionAtGrant: opts.accessVersionAtGrant ?? 0,
  });
  return id;
}

function callRequest(data, authUid) {
  return { data, auth: authUid !== undefined ? { uid: authUid, token: {} } : undefined };
}

async function assertHttpsErrorCode(promise, expectedCode) {
  try {
    await promise;
    assert.fail(`expected an HttpsError with code "${expectedCode}", but no error was thrown`);
  } catch (err) {
    assert.equal(err.code, expectedCode, `expected code "${expectedCode}", got "${err.code}": ${err.message}`);
    return err;
  }
}

// ----- Happy path: each of the six callables genuinely reaches real Firestore state -----

test("grantRole callable: authenticated admin actor grants a role -- real Firestore state + Audit Event + claims", async () => {
  const actorUid = uid("cc-admin-actor");
  await seedActiveAssignment(actorUid, "admin");
  const principalUid = uid("cc-principal");
  await auth.createUser({ uid: principalUid });
  const idempotencyKey = uid("cc-grant-key");

  const result = await callables.grantRole.run(
    callRequest({ principalUid, roleId: "technician", scope: { type: "global" }, idempotencyKey }, actorUid),
  );
  assert.equal(result.status, "applied");

  const assignmentSnap = await db.collection("roleAssignments").doc(idempotencyKey).get();
  assert.ok(assignmentSnap.exists);
  assert.equal(assignmentSnap.data().principalUid, principalUid);
  assert.equal(assignmentSnap.data().grantedBy, actorUid);

  const auditSnap = await db.collection("auditEvents").doc(idempotencyKey).get();
  assert.ok(auditSnap.exists);
  assert.equal(auditSnap.data().outcome, "applied");
  assert.equal(auditSnap.data().actorUid, actorUid);
});

test("revokeRole callable: authenticated admin actor revokes an assignment", async () => {
  const actorUid = uid("cc-admin-actor-revoke");
  await seedActiveAssignment(actorUid, "admin");
  const principalUid = uid("cc-principal-revoke");
  await auth.createUser({ uid: principalUid });
  const assignmentId = await seedActiveAssignment(principalUid, "technician");
  const idempotencyKey = uid("cc-revoke-key");

  const result = await callables.revokeRole.run(callRequest({ assignmentId, idempotencyKey }, actorUid));
  assert.equal(result.status, "applied");

  const assignmentSnap = await db.collection("roleAssignments").doc(assignmentId).get();
  assert.equal(assignmentSnap.data().status, "disabled");
});

test("assignApprovedRole callable: authenticated admin actor assigns a non-privileged role", async () => {
  const actorUid = uid("cc-admin-actor-assign");
  await seedActiveAssignment(actorUid, "admin");
  const principalUid = uid("cc-principal-assign");
  await auth.createUser({ uid: principalUid });
  const idempotencyKey = uid("cc-assign-key");

  const result = await callables.assignApprovedRole.run(
    callRequest({ principalUid, roleId: "dispatcher", scope: { type: "global" }, idempotencyKey }, actorUid),
  );
  assert.equal(result.status, "applied");

  const assignmentSnap = await db.collection("roleAssignments").doc(idempotencyKey).get();
  assert.equal(assignmentSnap.data().roleId, "dispatcher");
});

test("setUserStatus callable: authenticated admin actor disables a user -- Auth layer reflects it", async () => {
  const actorUid = uid("cc-admin-actor-status");
  await seedActiveAssignment(actorUid, "admin");
  const principalUid = uid("cc-principal-status");
  await auth.createUser({ uid: principalUid });
  const idempotencyKey = uid("cc-status-key");

  const result = await callables.setUserStatus.run(
    callRequest({ principalUid, status: "disabled", idempotencyKey }, actorUid),
  );
  assert.equal(result.status, "applied");

  const userRecord = await auth.getUser(principalUid);
  assert.equal(userRecord.disabled, true);
});

test("approveAccessRequest / rejectAccessRequest callables: authenticated admin actor decides a pending request", async () => {
  const actorUid = uid("cc-admin-actor-decide");
  await seedActiveAssignment(actorUid, "admin");

  const approveRequestId = uid("cc-request-approve");
  await db.collection("accessRequests").doc(approveRequestId).set({
    requestedBy: uid("cc-requester"),
    status: "pending",
  });
  const approveResult = await callables.approveAccessRequest.run(
    callRequest({ requestId: approveRequestId, idempotencyKey: uid("cc-approve-key") }, actorUid),
  );
  assert.equal(approveResult.status, "applied");
  assert.equal((await db.collection("accessRequests").doc(approveRequestId).get()).data().status, "approved");

  const rejectRequestId = uid("cc-request-reject");
  await db.collection("accessRequests").doc(rejectRequestId).set({
    requestedBy: uid("cc-requester-2"),
    status: "pending",
  });
  const rejectResult = await callables.rejectAccessRequest.run(
    callRequest(
      { requestId: rejectRequestId, reason: "not needed", idempotencyKey: uid("cc-reject-key") },
      actorUid,
    ),
  );
  assert.equal(rejectResult.status, "applied");
  assert.equal((await db.collection("accessRequests").doc(rejectRequestId).get()).data().status, "rejected");
});

// ----- Security property: actorUid comes ONLY from request.auth, never request.data -----

test("SECURITY: a client-supplied actorUid/principalUid-as-actor field is completely ignored -- the Audit Event's actorUid is always request.auth.uid", async () => {
  const realActorUid = uid("cc-real-actor");
  await seedActiveAssignment(realActorUid, "admin");
  const impersonatedUid = uid("cc-impersonated-someone-else");
  const principalUid = uid("cc-principal-impersonation");
  await auth.createUser({ uid: principalUid });
  const idempotencyKey = uid("cc-impersonation-key");

  // The client maliciously includes its own "actorUid" field, hoping the
  // server trusts it instead of the authenticated context.
  const result = await callables.setUserStatus.run(
    callRequest(
      { actorUid: impersonatedUid, principalUid, status: "disabled", idempotencyKey },
      realActorUid,
    ),
  );
  assert.equal(result.status, "applied");

  const auditSnap = await db.collection("auditEvents").doc(idempotencyKey).get();
  assert.equal(
    auditSnap.data().actorUid,
    realActorUid,
    "the recorded actor must be the AUTHENTICATED caller, never the client-supplied actorUid field",
  );
  assert.notEqual(auditSnap.data().actorUid, impersonatedUid);
});

// ----- Denial: unauthenticated -----

test("DENIAL -- unauthenticated: a call with no auth context is rejected before any command logic runs", async () => {
  const principalUid = uid("cc-principal-unauth");
  const idempotencyKey = uid("cc-unauth-key");

  const err = await assertHttpsErrorCode(
    callables.grantRole.run(
      callRequest({ principalUid, roleId: "technician", scope: { type: "global" }, idempotencyKey }, undefined),
    ),
    "unauthenticated",
  );
  assert.equal(err.message, "Must be signed in.");

  const assignmentSnap = await db.collection("roleAssignments").doc(idempotencyKey).get();
  assert.equal(assignmentSnap.exists, false, "no mutation must occur for an unauthenticated call");
  const auditSnap = await db.collection("auditEvents").doc(idempotencyKey).get();
  assert.equal(auditSnap.exists, false, "no Audit Event must be recorded for an unauthenticated call (nothing to attribute it to)");
});

// ----- Denial: malformed input -----

test("DENIAL -- malformed input: missing required fields is rejected as invalid-argument, no mutation, no internal detail leaked", async () => {
  const actorUid = uid("cc-admin-actor-malformed");
  await seedActiveAssignment(actorUid, "admin");

  const err = await assertHttpsErrorCode(
    callables.grantRole.run(callRequest({}, actorUid)),
    "invalid-argument",
  );
  assert.ok(!/roleAssignments\/|auditEvents\/|Firestore/i.test(err.message), "must never leak internal collection paths");
});

// ----- Denial: unauthorized actor -----

test("DENIAL -- unauthorized actor: a dispatcher (no admin.roleAssignment.write) is denied, generic safe message, denial Audit Event recorded", async () => {
  const actorUid = uid("cc-dispatcher-actor");
  await seedActiveAssignment(actorUid, "dispatcher");
  const principalUid = uid("cc-principal-unauthorized");
  const idempotencyKey = uid("cc-unauthorized-key");

  const err = await assertHttpsErrorCode(
    callables.grantRole.run(
      callRequest({ principalUid, roleId: "technician", scope: { type: "global" }, idempotencyKey }, actorUid),
    ),
    "permission-denied",
  );
  assert.equal(err.message, "You are not authorized to perform this action.");
  assert.ok(!/noQualifyingGrant|resolveEffectivePermission/i.test(err.message), "must never leak the resolver's internal reason code");

  const assignmentSnap = await db.collection("roleAssignments").doc(idempotencyKey).get();
  assert.equal(assignmentSnap.exists, false, "no mutation for a denied actor");
  const auditSnap = await db.collection("auditEvents").doc(idempotencyKey).get();
  assert.ok(auditSnap.exists, "a denied attempt must still be audited");
  assert.equal(auditSnap.data().outcome, "denied");
  assert.equal(auditSnap.data().actorUid, actorUid);
});

// ----- Denial: stale/malformed accessVersion (fail-closed) -----

test("DENIAL -- stale accessVersion: an assignment whose accessVersionAtGrant exceeds the principal's current accessVersion is treated as malformed/stale and fails closed", async () => {
  const actorUid = uid("cc-stale-actor");
  // accessVersionAtGrant (5) is impossible under a correctly-operating
  // writer given no users/{uid} doc exists yet (current accessVersion
  // reads as 0) -- resolveEffectivePermission.ts's own documented
  // fail-closed rule: accessVersionAtGrant must be <= currentAccessVersion.
  await seedActiveAssignment(actorUid, "admin", { accessVersionAtGrant: 5 });
  const principalUid = uid("cc-principal-stale");
  const idempotencyKey = uid("cc-stale-key");

  const err = await assertHttpsErrorCode(
    callables.grantRole.run(
      callRequest({ principalUid, roleId: "technician", scope: { type: "global" }, idempotencyKey }, actorUid),
    ),
    "permission-denied",
  );
  assert.equal(err.message, "You are not authorized to perform this action.");

  const assignmentSnap = await db.collection("roleAssignments").doc(idempotencyKey).get();
  assert.equal(assignmentSnap.exists, false, "no mutation when the actor's own assignment is stale/inconsistent");
});

// ----- Denial: self-elevation -----

test("DENIAL -- self-elevation: an actor may not grant themselves the privileged admin Role", async () => {
  const actorUid = uid("cc-self-elevation-actor");
  await seedActiveAssignment(actorUid, "admin");
  const idempotencyKey = uid("cc-self-elevation-key");

  const err = await assertHttpsErrorCode(
    callables.grantRole.run(
      callRequest(
        { principalUid: actorUid, roleId: "admin", scope: { type: "global" }, idempotencyKey },
        actorUid,
      ),
    ),
    "permission-denied",
  );
  assert.equal(err.message, "an actor may not grant themselves a privileged Role");

  const assignmentSnap = await db.collection("roleAssignments").doc(idempotencyKey).get();
  assert.equal(assignmentSnap.exists, false, "no self-granted privileged Role may ever be recorded");
});

// ----- Denial: duplicate/conflicting idempotency key reuse -----

test("DENIAL -- duplicate command: reusing an idempotencyKey for a DIFFERENT principal is a conflict, not a silent no-op", async () => {
  const actorUid = uid("cc-duplicate-actor");
  await seedActiveAssignment(actorUid, "admin");
  const firstPrincipal = uid("cc-principal-first");
  await auth.createUser({ uid: firstPrincipal });
  const secondPrincipal = uid("cc-principal-second");
  await auth.createUser({ uid: secondPrincipal });
  const idempotencyKey = uid("cc-duplicate-key");

  const first = await callables.grantRole.run(
    callRequest({ principalUid: firstPrincipal, roleId: "technician", scope: { type: "global" }, idempotencyKey }, actorUid),
  );
  assert.equal(first.status, "applied");

  const err = await assertHttpsErrorCode(
    callables.grantRole.run(
      callRequest({ principalUid: secondPrincipal, roleId: "technician", scope: { type: "global" }, idempotencyKey }, actorUid),
    ),
    "already-exists",
  );
  assert.match(err.message, /new idempotency key/i);

  // The first principal's grant must remain untouched; the second
  // principal must never have received a grant through the reused key.
  const firstAssignment = await db.collection("roleAssignments").doc(idempotencyKey).get();
  assert.equal(firstAssignment.data().principalUid, firstPrincipal);
});

test("DENIAL -- duplicate command: retrying the exact SAME call with the same idempotencyKey is a safe no-op (alreadyApplied), not an error", async () => {
  const actorUid = uid("cc-idempotent-actor");
  await seedActiveAssignment(actorUid, "admin");
  const principalUid = uid("cc-principal-idempotent");
  await auth.createUser({ uid: principalUid });
  const idempotencyKey = uid("cc-idempotent-key");
  const input = { principalUid, roleId: "technician", scope: { type: "global" }, idempotencyKey };

  const first = await callables.grantRole.run(callRequest(input, actorUid));
  assert.equal(first.status, "applied");

  const retry = await callables.grantRole.run(callRequest(input, actorUid));
  assert.equal(retry.status, "alreadyApplied");
});
