// Enterprise Access & Administration Platform (Issue #226) -- Row 7
// (Task 12) test for the six trusted-writer commands
// (functions/src/access/trustedWriterCommands.ts): grantRole,
// revokeRole, assignApprovedRole, setUserStatus, approveAccessRequest,
// rejectAccessRequest.
//
// Runs against LIVE Firestore + Auth emulators (Admin SDK, no Rules
// bypass needed to test since Admin SDK always bypasses Rules -- the
// point here is testing the trusted-writer's OWN authorization logic,
// atomicity, idempotency, and cross-service recovery, not Rules).
//
// Prerequisite: run against live Firestore + Auth emulators, e.g.:
//   firebase emulators:start --only firestore,auth --project taylor-parts
// then, in a second terminal (after `npm run build`):
//   node functions/test/trustedWriterCommands.test.mjs
//
// Never touches the live "taylor-parts" project.
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";

import assert from "node:assert/strict";
import admin from "firebase-admin";
import {
  grantRole,
  revokeRole,
  assignApprovedRole,
  setUserStatus,
  approveAccessRequest,
  rejectAccessRequest,
  InvalidInputError,
  UnknownRoleError,
  UnauthorizedActorError,
  SelfApprovalError,
  InsufficientApproverAuthorityError,
  MalformedAccessDataError,
  UnavailableAccessDataError,
  InvalidStateError,
  ClaimsSyncPendingError,
} from "../lib/access/trustedWriterCommands.js";

const PROJECT_ID = "taylor-parts";
admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();
const auth = admin.auth();

let passed = 0;
let failed = 0;
let uidCounter = 0;

function uid(label) {
  uidCounter += 1;
  return `${label}-${Date.now()}-${uidCounter}`;
}

async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS: ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL: ${name}`);
    console.error(err);
  }
}

async function assertRejectsWith(promise, ErrorClass, label) {
  await assert.rejects(promise, ErrorClass, label);
}

async function seedActiveRoleAssignment(principalUid, roleId, scope = { type: "global" }) {
  const id = `seed-${principalUid}-${roleId}`;
  await db.collection("roleAssignments").doc(id).set({
    principalUid,
    roleId,
    scope,
    grantedBy: "test-seed",
    grantedAt: admin.firestore.Timestamp.now(),
    status: "active",
    accessVersionAtGrant: 0,
  });
  return id;
}

async function countDocs(collection, field, value) {
  const snap = await db.collection(collection).where(field, "==", value).get();
  return snap.size;
}

async function getAuditEvent(id) {
  const snap = await db.collection("auditEvents").doc(id).get();
  return snap.exists ? snap.data() : null;
}

async function makeAdminActor() {
  const u = uid("admin-actor");
  await seedActiveRoleAssignment(u, "admin");
  return u;
}

// A principal WITH a real Auth account -- required for the post-commit
// claims-refresh step to succeed (getAuth().getUser(uid) must resolve).
// The dedicated "claims-sync failure" test further down deliberately
// uses a principal WITHOUT one, to exercise that failure path on
// purpose -- every other "successful path" test needs this instead.
async function makePrincipal(label = "principal") {
  const u = uid(label);
  await auth.createUser({ uid: u });
  return u;
}

async function makeDispatcherActor() {
  const u = uid("dispatcher-actor");
  await seedActiveRoleAssignment(u, "dispatcher");
  return u;
}

async function main() {
  // =====================================================================
  // Successful path for every command
  // =====================================================================

  await check("grantRole: successful non-privileged grant (applied, exactly one assignment + one audit event, accessVersion bumped)", async () => {
    const actor = await makeAdminActor();
    const principal = await makePrincipal();
    const key = `grant-ok-${uid("k")}`;
    const result = await grantRole({
      actorUid: actor,
      principalUid: principal,
      roleId: "technician",
      scope: { type: "global" },
      idempotencyKey: key,
    });
    assert.equal(result.status, "applied");
    assert.equal(result.accessVersionAfter, 1);
    const assignmentSnap = await db.collection("roleAssignments").doc(key).get();
    assert.ok(assignmentSnap.exists);
    assert.equal(assignmentSnap.data().status, "active");
    const userSnap = await db.collection("users").doc(principal).get();
    assert.equal(userSnap.data().accessVersion, 1);
    assert.equal(userSnap.data().pendingClaimsSyncAccessVersion, null);
    const audit = await getAuditEvent(key);
    assert.ok(audit);
    assert.equal(audit.outcome, "applied");
    assert.equal(audit.action, "grantRole");
    const userRecord = await auth.getUser(principal);
    assert.equal(userRecord.customClaims.accessVersion, 1);
  });

  let revokableAssignmentId;
  let revokePrincipal;
  await check("revokeRole: successful revoke (applied, status disabled, accessVersion bumped again)", async () => {
    const actor = await makeAdminActor();
    revokePrincipal = await makePrincipal();
    const grantKey = `grant-for-revoke-${uid("k")}`;
    await grantRole({
      actorUid: actor,
      principalUid: revokePrincipal,
      roleId: "technician",
      scope: { type: "global" },
      idempotencyKey: grantKey,
    });
    revokableAssignmentId = grantKey;
    const revokeKey = `revoke-ok-${uid("k")}`;
    const result = await revokeRole({
      actorUid: actor,
      assignmentId: revokableAssignmentId,
      idempotencyKey: revokeKey,
    });
    assert.equal(result.status, "applied");
    assert.equal(result.accessVersionAfter, 2);
    const assignmentSnap = await db.collection("roleAssignments").doc(revokableAssignmentId).get();
    assert.equal(assignmentSnap.data().status, "disabled");
  });

  await check("assignApprovedRole: successful single-admin assignment of a non-privileged Role", async () => {
    const actor = await makeAdminActor();
    const principal = await makePrincipal();
    const key = `assign-approved-ok-${uid("k")}`;
    const result = await assignApprovedRole({
      actorUid: actor,
      principalUid: principal,
      roleId: "dispatcher",
      scope: { type: "global" },
      idempotencyKey: key,
    });
    assert.equal(result.status, "applied");
    const assignmentSnap = await db.collection("roleAssignments").doc(key).get();
    assert.ok(assignmentSnap.exists);
  });

  await check("setUserStatus: successful disable (Auth user actually disabled, accessVersion bumped)", async () => {
    const actor = await makeAdminActor();
    const principal = uid("principal");
    await auth.createUser({ uid: principal });
    const key = `status-ok-${uid("k")}`;
    const result = await setUserStatus({
      actorUid: actor,
      principalUid: principal,
      status: "disabled",
      idempotencyKey: key,
    });
    assert.equal(result.status, "applied");
    const userRecord = await auth.getUser(principal);
    assert.equal(userRecord.disabled, true);
  });

  let approveRequestId;
  await check("approveAccessRequest: successful decision (pending -> approved, no accessVersion involved)", async () => {
    const actor = await makeAdminActor();
    const requester = uid("requester");
    approveRequestId = uid("request");
    await db.collection("accessRequests").doc(approveRequestId).set({
      requestedBy: requester,
      requestedChange: "grant dispatcher",
      requestedScope: { type: "global" },
      status: "pending",
    });
    const key = `approve-ok-${uid("k")}`;
    const result = await approveAccessRequest({ actorUid: actor, requestId: approveRequestId, idempotencyKey: key });
    assert.equal(result.status, "applied");
    assert.equal(result.accessVersionAfter, undefined);
    const requestSnap = await db.collection("accessRequests").doc(approveRequestId).get();
    assert.equal(requestSnap.data().status, "approved");
    assert.equal(requestSnap.data().decidedBy, actor);
  });

  await check("rejectAccessRequest: successful decision with reason recorded", async () => {
    const actor = await makeAdminActor();
    const requester = uid("requester");
    const requestId = uid("request");
    await db.collection("accessRequests").doc(requestId).set({
      requestedBy: requester,
      requestedChange: "grant admin",
      requestedScope: { type: "global" },
      status: "pending",
    });
    const key = `reject-ok-${uid("k")}`;
    const result = await rejectAccessRequest({ actorUid: actor, requestId, reason: "not justified", idempotencyKey: key });
    assert.equal(result.status, "applied");
    const requestSnap = await db.collection("accessRequests").doc(requestId).get();
    assert.equal(requestSnap.data().status, "rejected");
    assert.equal(requestSnap.data().reason, "not justified");
  });

  // =====================================================================
  // Unauthorized actor / missing actor / stale token / malformed input /
  // unavailable dependency
  // =====================================================================

  await check("grantRole: unauthorized actor (dispatcher lacks admin.roleAssignment.write) is DENIED, with a denied Audit Event", async () => {
    const actor = await makeDispatcherActor();
    const principal = uid("principal");
    const key = `grant-unauthorized-${uid("k")}`;
    await assertRejectsWith(
      grantRole({ actorUid: actor, principalUid: principal, roleId: "technician", scope: { type: "global" }, idempotencyKey: key }),
      UnauthorizedActorError,
    );
    const audit = await getAuditEvent(key);
    assert.ok(audit, "a denied Audit Event must exist");
    assert.equal(audit.outcome, "denied");
    const assignmentSnap = await db.collection("roleAssignments").doc(key).get();
    assert.equal(assignmentSnap.exists, false, "no assignment may be created for a denied grant");
  });

  await check("grantRole: missing actor (no roleAssignments at all) is DENIED (fail-closed, not default-allow)", async () => {
    const actor = uid("unprovisioned-actor");
    const principal = uid("principal");
    const key = `grant-noactor-${uid("k")}`;
    await assertRejectsWith(
      grantRole({ actorUid: actor, principalUid: principal, roleId: "technician", scope: { type: "global" }, idempotencyKey: key }),
      UnauthorizedActorError,
    );
  });

  await check("grantRole: stale actor accessVersion (malformed users/{uid}.accessVersion) fails closed", async () => {
    const actor = await makeAdminActor();
    await db.collection("users").doc(actor).set({ accessVersion: "not-a-number" });
    const principal = uid("principal");
    const key = `grant-staleactor-${uid("k")}`;
    await assertRejectsWith(
      grantRole({ actorUid: actor, principalUid: principal, roleId: "technician", scope: { type: "global" }, idempotencyKey: key }),
      MalformedAccessDataError,
    );
  });

  await check("grantRole: malformed input (unknown roleId) is rejected before any write", async () => {
    const actor = await makeAdminActor();
    const principal = uid("principal");
    const key = `grant-badrole-${uid("k")}`;
    await assertRejectsWith(
      grantRole({ actorUid: actor, principalUid: principal, roleId: "not-a-real-role", scope: { type: "global" }, idempotencyKey: key }),
      UnknownRoleError,
    );
  });

  await check("grantRole: malformed input (invalid scope shape) is rejected", async () => {
    const actor = await makeAdminActor();
    const principal = uid("principal");
    const key = `grant-badscope-${uid("k")}`;
    await assertRejectsWith(
      grantRole({ actorUid: actor, principalUid: principal, roleId: "technician", scope: { type: "not-a-real-type" }, idempotencyKey: key }),
      InvalidInputError,
    );
  });

  await check("grantRole: malformed input (idempotencyKey too short) is rejected", async () => {
    const actor = await makeAdminActor();
    const principal = uid("principal");
    await assertRejectsWith(
      grantRole({ actorUid: actor, principalUid: principal, roleId: "technician", scope: { type: "global" }, idempotencyKey: "short" }),
      InvalidInputError,
    );
  });

  await check("revokeRole: unavailable dependency (assignmentId does not exist) fails closed", async () => {
    const actor = await makeAdminActor();
    const key = `revoke-unavailable-${uid("k")}`;
    await assertRejectsWith(
      revokeRole({ actorUid: actor, assignmentId: "does-not-exist", idempotencyKey: key }),
      UnavailableAccessDataError,
    );
  });

  await check("approveAccessRequest: unavailable dependency (requestId does not exist) fails closed", async () => {
    const actor = await makeAdminActor();
    const key = `approve-unavailable-${uid("k")}`;
    await assertRejectsWith(
      approveAccessRequest({ actorUid: actor, requestId: "does-not-exist", idempotencyKey: key }),
      UnavailableAccessDataError,
    );
  });

  // =====================================================================
  // Self-approval and single-actor privileged-grant denial
  // =====================================================================

  await check("grantRole: privileged Role (admin) without an approverUid is denied", async () => {
    const actor = await makeAdminActor();
    const principal = uid("principal");
    const key = `grant-priv-noapprover-${uid("k")}`;
    await assertRejectsWith(
      grantRole({ actorUid: actor, principalUid: principal, roleId: "admin", scope: { type: "global" }, idempotencyKey: key }),
      InvalidInputError,
    );
  });

  await check("grantRole: privileged Role granted to self is denied even with a distinct approver present", async () => {
    const actor = await makeAdminActor();
    const approver = await makeAdminActor();
    const key = `grant-priv-self-${uid("k")}`;
    await assertRejectsWith(
      grantRole({ actorUid: actor, principalUid: actor, roleId: "admin", scope: { type: "global" }, approverUid: approver, idempotencyKey: key }),
      SelfApprovalError,
    );
  });

  await check("grantRole: privileged Role with approverUid === actorUid (self-approval) is denied", async () => {
    const actor = await makeAdminActor();
    const principal = uid("principal");
    const key = `grant-priv-selfapprove-${uid("k")}`;
    await assertRejectsWith(
      grantRole({ actorUid: actor, principalUid: principal, roleId: "admin", scope: { type: "global" }, approverUid: actor, idempotencyKey: key }),
      SelfApprovalError,
    );
  });

  await check("grantRole: privileged Role with an approver who is NOT themselves privileged is denied (single-actor privileged-grant denial)", async () => {
    const actor = await makeAdminActor();
    const principal = uid("principal");
    const nonPrivilegedApprover = await makeDispatcherActor();
    const key = `grant-priv-badapprover-${uid("k")}`;
    await assertRejectsWith(
      grantRole({
        actorUid: actor,
        principalUid: principal,
        roleId: "admin",
        scope: { type: "global" },
        approverUid: nonPrivilegedApprover,
        idempotencyKey: key,
      }),
      InsufficientApproverAuthorityError,
    );
  });

  await check("grantRole: privileged Role with a genuinely distinct, privileged approver SUCCEEDS", async () => {
    const actor = await makeAdminActor();
    const principal = await makePrincipal();
    const approver = await makeAdminActor();
    const key = `grant-priv-ok-${uid("k")}`;
    const result = await grantRole({
      actorUid: actor,
      principalUid: principal,
      roleId: "admin",
      scope: { type: "global" },
      approverUid: approver,
      idempotencyKey: key,
    });
    assert.equal(result.status, "applied");
    const assignmentSnap = await db.collection("roleAssignments").doc(key).get();
    assert.equal(assignmentSnap.data().approvedBy, approver);
  });

  await check("approveAccessRequest: self-approval (actor === requestedBy) is denied", async () => {
    const actor = await makeAdminActor();
    const requestId = uid("request");
    await db.collection("accessRequests").doc(requestId).set({
      requestedBy: actor,
      requestedChange: "grant admin",
      requestedScope: { type: "global" },
      status: "pending",
    });
    const key = `approve-self-${uid("k")}`;
    await assertRejectsWith(
      approveAccessRequest({ actorUid: actor, requestId, idempotencyKey: key }),
      SelfApprovalError,
    );
  });

  // =====================================================================
  // Non-privileged single-admin assignment allowed
  // (assignApprovedRole ok-path already covered above; also confirm the
  // privileged Role is REJECTED via assignApprovedRole specifically)
  // =====================================================================

  await check("assignApprovedRole: rejects a privileged Role outright (must use grantRole with an approver instead)", async () => {
    const actor = await makeAdminActor();
    const principal = uid("principal");
    const key = `assign-priv-reject-${uid("k")}`;
    await assertRejectsWith(
      assignApprovedRole({ actorUid: actor, principalUid: principal, roleId: "admin", scope: { type: "global" }, idempotencyKey: key }),
      InvalidStateError,
    );
  });

  // =====================================================================
  // Duplicate retry and concurrent-call idempotency
  // =====================================================================

  await check("grantRole: duplicate retry (same idempotencyKey) is a no-op -- exactly one assignment, one audit event, one version bump", async () => {
    const actor = await makeAdminActor();
    const principal = await makePrincipal();
    const key = `grant-retry-${uid("k")}`;
    const first = await grantRole({ actorUid: actor, principalUid: principal, roleId: "technician", scope: { type: "global" }, idempotencyKey: key });
    const second = await grantRole({ actorUid: actor, principalUid: principal, roleId: "technician", scope: { type: "global" }, idempotencyKey: key });
    assert.equal(first.status, "applied");
    assert.equal(second.status, "alreadyApplied");
    assert.equal(first.accessVersionAfter, second.accessVersionAfter);
    const userSnap = await db.collection("users").doc(principal).get();
    assert.equal(userSnap.data().accessVersion, 1, "accessVersion must be bumped exactly once, not twice");
  });

  await check("grantRole: concurrent identical calls (same idempotencyKey, real concurrency via Promise.all) never double-process", async () => {
    const actor = await makeAdminActor();
    const principal = await makePrincipal();
    const key = `grant-concurrent-${uid("k")}`;
    const args = { actorUid: actor, principalUid: principal, roleId: "technician", scope: { type: "global" }, idempotencyKey: key };
    const [a, b] = await Promise.all([grantRole(args), grantRole(args)]);
    assert.equal(a.accessVersionAfter, b.accessVersionAfter);
    const userSnap = await db.collection("users").doc(principal).get();
    assert.equal(userSnap.data().accessVersion, 1, "concurrent duplicate calls must still only bump accessVersion once");
    const assignmentsCount = await countDocs("roleAssignments", "principalUid", principal);
    assert.equal(assignmentsCount, 1, "concurrent duplicate calls must not create two assignments");
  });

  // =====================================================================
  // Transaction failure produces no state change, no version bump, no
  // Audit Event
  // =====================================================================

  await check("grantRole: a transaction that fails mid-flight (malformed accessVersion discovered inside the transaction) leaves no assignment, no version bump, no audit event", async () => {
    const actor = await makeAdminActor();
    const principal = uid("principal");
    await db.collection("users").doc(principal).set({ accessVersion: { nested: "not-a-number" } });
    const key = `grant-txnfail-${uid("k")}`;
    await assertRejectsWith(
      grantRole({ actorUid: actor, principalUid: principal, roleId: "technician", scope: { type: "global" }, idempotencyKey: key }),
      MalformedAccessDataError,
    );
    const assignmentSnap = await db.collection("roleAssignments").doc(key).get();
    assert.equal(assignmentSnap.exists, false);
    const audit = await getAuditEvent(key);
    assert.equal(audit, null, "no Audit Event may exist for an aborted transaction");
    const userSnap = await db.collection("users").doc(principal).get();
    assert.deepEqual(userSnap.data().accessVersion, { nested: "not-a-number" }, "the malformed field itself must remain untouched -- no partial write");
  });

  // =====================================================================
  // Claims-sync failure leaves access fail-closed and recovers cleanly
  // on retry
  // =====================================================================

  await check("grantRole: claims-sync failure (principal has no Auth user) commits Firestore state but rejects with ClaimsSyncPendingError; a clean retry (after creating the Auth user) resynchronizes without repeating the mutation", async () => {
    const actor = await makeAdminActor();
    const principal = uid("principal-no-auth");
    const key = `grant-claimsfail-${uid("k")}`;

    await assertRejectsWith(
      grantRole({ actorUid: actor, principalUid: principal, roleId: "technician", scope: { type: "global" }, idempotencyKey: key }),
      ClaimsSyncPendingError,
    );

    // Firestore state IS already committed -- this is correct, not a bug:
    // the bumped accessVersion is what makes any pre-existing token for
    // this principal fail closed, even though claims sync hasn't happened.
    const assignmentSnap = await db.collection("roleAssignments").doc(key).get();
    assert.ok(assignmentSnap.exists, "the business mutation IS committed");
    const userSnapAfterFailure = await db.collection("users").doc(principal).get();
    assert.equal(userSnapAfterFailure.data().accessVersion, 1);
    assert.equal(userSnapAfterFailure.data().pendingClaimsSyncAccessVersion, 1, "the pending marker must remain set");
    const auditAfterFailure = await getAuditEvent(key);
    assert.ok(auditAfterFailure, "the Audit Event IS committed (part of the same transaction as the mutation)");

    // Fix the underlying unavailable dependency, then retry with the
    // SAME idempotencyKey.
    await auth.createUser({ uid: principal });
    const retryResult = await grantRole({ actorUid: actor, principalUid: principal, roleId: "technician", scope: { type: "global" }, idempotencyKey: key });
    assert.equal(retryResult.status, "alreadyApplied", "the retry must recognize the state mutation as already done");

    const userSnapAfterRetry = await db.collection("users").doc(principal).get();
    assert.equal(userSnapAfterRetry.data().pendingClaimsSyncAccessVersion, null, "the pending marker must now be cleared");
    const assignmentsCount = await countDocs("roleAssignments", "principalUid", principal);
    assert.equal(assignmentsCount, 1, "the retry must not have created a second assignment");
    const auditCount = await countDocs("auditEvents", "targetId", key);
    assert.equal(auditCount, 1, "the retry must not have created a second Audit Event");
    const userRecord = await auth.getUser(principal);
    assert.equal(userRecord.customClaims.accessVersion, 1, "claims are now correctly synced");
  });

  // =====================================================================
  // Exactly one immutable Audit Event per applied or denied command
  // (spot-checked across several commands; the "applied" cases above
  // each already assert exactly one Audit Event too)
  // =====================================================================

  await check("setUserStatus: unauthorized actor produces a denied Audit Event, not an applied one, and no Auth-layer side effect", async () => {
    const actor = await makeDispatcherActor();
    const principal = uid("principal");
    await auth.createUser({ uid: principal });
    const key = `status-denied-${uid("k")}`;
    await assertRejectsWith(
      setUserStatus({ actorUid: actor, principalUid: principal, status: "disabled", idempotencyKey: key }),
      UnauthorizedActorError,
    );
    const audit = await getAuditEvent(key);
    assert.ok(audit);
    assert.equal(audit.outcome, "denied");
    const userRecord = await auth.getUser(principal);
    assert.equal(userRecord.disabled, false, "no Auth-layer side effect may occur for a denied command");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Test run failed:", err);
  process.exit(1);
});
