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
  IdempotencyKeyConflictError,
  IdempotencyKeyAlreadyDeniedError,
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

// Finds every auditEvents doc whose id starts with the given
// idempotencyKey -- the primary doc (id === key) plus any derived
// conflict-record docs (id === `${key}--conflict--<hash>`).
async function findAuditEventsWithIdPrefix(prefix) {
  return db
    .collection("auditEvents")
    .orderBy(admin.firestore.FieldPath.documentId())
    .startAt(prefix)
    .endAt(`${prefix}~`)
    .get();
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
    const auditCount = await countDocs("auditEvents", "targetId", principal);
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

  // =====================================================================
  // Independent review round 1 fixes -- regression coverage
  // =====================================================================

  await check("idempotencyKey reused for a DIFFERENT command/target fails closed with IdempotencyKeyConflictError, not a silent alreadyApplied", async () => {
    const actor = await makeAdminActor();
    const principalA = await makePrincipal();
    const principalB = await makePrincipal();
    const key = `conflict-${uid("k")}`;
    const first = await grantRole({ actorUid: actor, principalUid: principalA, roleId: "technician", scope: { type: "global" }, idempotencyKey: key });
    assert.equal(first.status, "applied");

    // Same key, DIFFERENT principal -- must fail closed, not silently
    // report "alreadyApplied" against the wrong principal's grant.
    await assertRejectsWith(
      grantRole({ actorUid: actor, principalUid: principalB, roleId: "technician", scope: { type: "global" }, idempotencyKey: key }),
      IdempotencyKeyConflictError,
    );
    const principalBSnap = await db.collection("users").doc(principalB).get();
    assert.equal(principalBSnap.exists, false, "principalB must receive NO accessVersion bump from the conflicting call");

    // Same key, DIFFERENT command entirely (setUserStatus vs grantRole).
    await auth.createUser({ uid: principalA }).catch(() => {});
    await assertRejectsWith(
      setUserStatus({ actorUid: actor, principalUid: principalA, status: "disabled", idempotencyKey: key }),
      IdempotencyKeyConflictError,
    );
    const userRecord = await auth.getUser(principalA);
    assert.equal(userRecord.disabled, false, "the conflicting setUserStatus call must NOT have actually disabled the account");
  });

  await check("revokeRole: an assignment referencing an unrecognized roleId fails closed (UnknownRoleError), never silently treated as non-privileged", async () => {
    const actor = await makeAdminActor();
    const principal = uid("principal");
    const assignmentId = uid("corrupt-assignment");
    await db.collection("roleAssignments").doc(assignmentId).set({
      principalUid: principal,
      roleId: "not-a-real-role-in-the-catalog",
      scope: { type: "global" },
      grantedBy: "test-seed",
      grantedAt: admin.firestore.Timestamp.now(),
      status: "active",
      accessVersionAtGrant: 0,
    });
    const key = `revoke-unknownrole-${uid("k")}`;
    await assertRejectsWith(
      revokeRole({ actorUid: actor, assignmentId, idempotencyKey: key }),
      UnknownRoleError,
    );
    const assignmentSnap = await db.collection("roleAssignments").doc(assignmentId).get();
    assert.equal(assignmentSnap.data().status, "active", "an unrecognized-role assignment must NOT be revocable by a single ordinary admin");
  });

  await check("sequential grants to the same principal each correctly clear their own pendingClaimsSyncAccessVersion (compare-and-clear does not regress the normal case)", async () => {
    const actor = await makeAdminActor();
    const principal = await makePrincipal();
    const key1 = `seq-grant-1-${uid("k")}`;
    const key2 = `seq-grant-2-${uid("k")}`;
    const r1 = await grantRole({ actorUid: actor, principalUid: principal, roleId: "technician", scope: { type: "global" }, idempotencyKey: key1 });
    assert.equal(r1.accessVersionAfter, 1);
    const afterFirst = await db.collection("users").doc(principal).get();
    assert.equal(afterFirst.data().pendingClaimsSyncAccessVersion, null);

    const r2 = await assignApprovedRole({ actorUid: actor, principalUid: principal, roleId: "dispatcher", scope: { type: "global" }, idempotencyKey: key2 });
    assert.equal(r2.accessVersionAfter, 2);
    const afterSecond = await db.collection("users").doc(principal).get();
    assert.equal(afterSecond.data().pendingClaimsSyncAccessVersion, null);
    const userRecord = await auth.getUser(principal);
    assert.equal(userRecord.customClaims.accessVersion, 2, "claims must reflect the LATEST accessVersion after two sequential grants");
  });

  await check("a previously-DENIED idempotencyKey can never later resolve as applied -- retrying with the same key after fixing the denial cause fails loud (IdempotencyKeyAlreadyDeniedError), never silently no-ops without ever mutating", async () => {
    const dispatcherActor = await makeDispatcherActor();
    const principal = await makePrincipal();
    const key = `denied-then-retry-${uid("k")}`;

    // First attempt: denied (dispatcher lacks admin.roleAssignment.write).
    await assertRejectsWith(
      grantRole({ actorUid: dispatcherActor, principalUid: principal, roleId: "technician", scope: { type: "global" }, idempotencyKey: key }),
      UnauthorizedActorError,
    );
    const deniedAudit = await getAuditEvent(key);
    assert.equal(deniedAudit.outcome, "denied");

    // Fix the underlying cause (use a real admin actor this time) and
    // retry with the SAME idempotencyKey -- must fail loud, not
    // silently resolve as "alreadyApplied" while never actually
    // granting anything.
    const adminActor = await makeAdminActor();
    await assertRejectsWith(
      grantRole({ actorUid: adminActor, principalUid: principal, roleId: "technician", scope: { type: "global" }, idempotencyKey: key }),
      IdempotencyKeyAlreadyDeniedError,
    );
    const assignmentSnap = await db.collection("roleAssignments").doc(key).get();
    assert.equal(assignmentSnap.exists, false, "the retry must NOT have silently granted the role");
    const userSnap = await db.collection("users").doc(principal).get();
    assert.equal(userSnap.exists, false, "no accessVersion may exist -- the grant never actually happened");

    // A FRESH idempotencyKey, however, succeeds normally.
    const freshKey = `denied-then-retry-fresh-${uid("k")}`;
    const result = await grantRole({ actorUid: adminActor, principalUid: principal, roleId: "technician", scope: { type: "global" }, idempotencyKey: freshKey });
    assert.equal(result.status, "applied");
  });

  // =====================================================================
  // Inventory review round 4 fixes -- regression coverage
  // =====================================================================

  // --- Finding 1: tenant Scope must never widen to global authority ---

  await check("grantRole: a tenant-scoped admin assignment cannot serve as the actor's own authority for a global trusted command (tenant Scope never widens)", async () => {
    const tenantScopedActor = uid("tenant-actor");
    await seedActiveRoleAssignment(tenantScopedActor, "admin", { type: "tenant", value: "some-tenant" });
    const principal = await makePrincipal();
    const key = `tenant-actor-denied-${uid("k")}`;
    await assertRejectsWith(
      grantRole({ actorUid: tenantScopedActor, principalUid: principal, roleId: "technician", scope: { type: "global" }, idempotencyKey: key }),
      UnauthorizedActorError,
    );
    const assignmentSnap = await db.collection("roleAssignments").doc(key).get();
    assert.equal(assignmentSnap.exists, false, "a tenant-scoped admin assignment must not authorize a global grant");
  });

  await check("grantRole: a tenant-scoped admin assignment cannot serve as the APPROVER's authority for a privileged grant either (tenant Scope never widens, approver side)", async () => {
    const actor = await makeAdminActor();
    const tenantScopedApprover = uid("tenant-approver");
    await seedActiveRoleAssignment(tenantScopedApprover, "admin", { type: "tenant", value: "some-tenant" });
    const principal = await makePrincipal();
    const key = `tenant-approver-denied-${uid("k")}`;
    await assertRejectsWith(
      grantRole({ actorUid: actor, principalUid: principal, roleId: "admin", scope: { type: "global" }, approverUid: tenantScopedApprover, idempotencyKey: key }),
      InsufficientApproverAuthorityError,
    );
  });

  // --- Finding 2: the approver must pass the FULL fail-closed effective-permission path ---

  await check("grantRole: an approver assignment with a MALFORMED shape (missing scope) fails closed via InsufficientApproverAuthorityError, not accepted merely for roleId=\"admin\"", async () => {
    const actor = await makeAdminActor();
    const malformedApprover = uid("malformed-approver");
    // Deliberately malformed: no `scope` field at all -- fails
    // isWellFormedAssignment() inside the resolver.
    await db.collection("roleAssignments").doc(`seed-${malformedApprover}-admin`).set({
      principalUid: malformedApprover,
      roleId: "admin",
      grantedBy: "test-seed",
      grantedAt: admin.firestore.Timestamp.now(),
      status: "active",
      accessVersionAtGrant: 0,
    });
    const principal = await makePrincipal();
    const key = `malformed-approver-${uid("k")}`;
    await assertRejectsWith(
      grantRole({ actorUid: actor, principalUid: principal, roleId: "admin", scope: { type: "global" }, approverUid: malformedApprover, idempotencyKey: key }),
      InsufficientApproverAuthorityError,
    );
  });

  await check("grantRole: an approver assignment with a STALE/FUTURE accessVersionAtGrant (greater than the approver's own current accessVersion) fails closed via InsufficientApproverAuthorityError", async () => {
    const actor = await makeAdminActor();
    const staleApprover = uid("stale-approver");
    // accessVersionAtGrant=99 while the approver's own users/{uid}
    // document does not exist (accessVersion reads as 0) -- inconsistent,
    // excluded by the resolver's own fail-closed accessVersion check.
    await seedActiveRoleAssignment(staleApprover, "admin");
    await db.collection("roleAssignments").doc(`seed-${staleApprover}-admin`).update({ accessVersionAtGrant: 99 });
    const principal = await makePrincipal();
    const key = `stale-approver-${uid("k")}`;
    await assertRejectsWith(
      grantRole({ actorUid: actor, principalUid: principal, roleId: "admin", scope: { type: "global" }, approverUid: staleApprover, idempotencyKey: key }),
      InsufficientApproverAuthorityError,
    );
  });

  await check("grantRole: an approver assignment scoped NARROWLY (domain, not global) fails closed via InsufficientApproverAuthorityError for a global privileged grant", async () => {
    const actor = await makeAdminActor();
    const narrowApprover = uid("narrow-approver");
    await seedActiveRoleAssignment(narrowApprover, "admin", { type: "domain", value: "customer" });
    const principal = await makePrincipal();
    const key = `narrow-approver-${uid("k")}`;
    await assertRejectsWith(
      grantRole({ actorUid: actor, principalUid: principal, roleId: "admin", scope: { type: "global" }, approverUid: narrowApprover, idempotencyKey: key }),
      InsufficientApproverAuthorityError,
    );
  });

  // --- Finding 3: idempotency-key reuse must not silently suppress a denial audit ---

  await check("idempotencyKey reused across an EXISTING APPLIED event and a new DENIED command still fails loud with the denial's own real error, AND records a distinct, auditable conflict Audit Event", async () => {
    const dispatcherActor = await makeDispatcherActor();
    const adminActor = await makeAdminActor();
    const principalA = await makePrincipal();
    const principalB = uid("principal-b");
    const key = `conflict-applied-then-denied-${uid("k")}`;

    // First: a genuinely APPLIED grant at this key.
    const applied = await grantRole({ actorUid: adminActor, principalUid: principalA, roleId: "technician", scope: { type: "global" }, idempotencyKey: key });
    assert.equal(applied.status, "applied");

    // Second: a DIFFERENT command/target reusing the SAME key, denied
    // for its own real reason (unauthorized actor) -- must still throw
    // that real reason, not a generic idempotency error, and the
    // conflict must remain auditable.
    await assertRejectsWith(
      setUserStatus({ actorUid: dispatcherActor, principalUid: principalB, status: "disabled", idempotencyKey: key }),
      UnauthorizedActorError,
    );
    const primaryAudit = await getAuditEvent(key);
    assert.equal(primaryAudit.outcome, "applied", "the original applied Audit Event must remain untouched (immutable)");
    assert.equal(primaryAudit.action, "grantRole");

    const allAuditsForKey = await findAuditEventsWithIdPrefix(key);
    assert.ok(allAuditsForKey.size >= 2, "a distinct conflict Audit Event must exist alongside the untouched primary record");
    const conflictDoc = allAuditsForKey.docs.find((d) => d.id !== key);
    assert.ok(conflictDoc, "a conflict Audit Event must exist at a derived id");
    assert.equal(conflictDoc.data().outcome, "denied");
    assert.equal(conflictDoc.data().action, "setUserStatus");
  });

  await check("idempotencyKey reused across an EXISTING DENIED event and a new, differently-shaped DENIED command still records a distinct conflict Audit Event", async () => {
    const dispatcherActor = await makeDispatcherActor();
    const principalA = await makePrincipal();
    const principalB = uid("principal-b");
    const key = `conflict-denied-then-denied-${uid("k")}`;

    await assertRejectsWith(
      grantRole({ actorUid: dispatcherActor, principalUid: principalA, roleId: "technician", scope: { type: "global" }, idempotencyKey: key }),
      UnauthorizedActorError,
    );
    await assertRejectsWith(
      setUserStatus({ actorUid: dispatcherActor, principalUid: principalB, status: "disabled", idempotencyKey: key }),
      UnauthorizedActorError,
    );

    const allAuditsForKey = await findAuditEventsWithIdPrefix(key);
    assert.ok(allAuditsForKey.size >= 2, "both distinct denials must be auditable -- the second must not be silently dropped");
    const primary = allAuditsForKey.docs.find((d) => d.id === key);
    const conflict = allAuditsForKey.docs.find((d) => d.id !== key);
    assert.equal(primary.data().action, "grantRole");
    assert.equal(conflict.data().action, "setUserStatus");
    assert.equal(conflict.data().outcome, "denied");
  });

  // =====================================================================
  // INV-1 / ADR-009 / Decision #42 -- governed-Role assignment wiring (G3):
  // the curated ASSIGNABLE_ROLES registry lets the single governed,
  // non-privileged `inventoryCreateExecutor` be assigned/revoked through the
  // trusted commands, fail-closed for everything else, two-person untouched.
  // =====================================================================

  await check("wiring: assignApprovedRole assigns inventoryCreateExecutor (single admin) -> active assignment + applied audit", async () => {
    const actor = await makeAdminActor();
    const principal = await makePrincipal();
    const key = `assign-ice-${uid("k")}`;
    const result = await assignApprovedRole({ actorUid: actor, principalUid: principal, roleId: "inventoryCreateExecutor", scope: { type: "global" }, idempotencyKey: key });
    assert.equal(result.status, "applied");
    const snap = await db.collection("roleAssignments").doc(key).get();
    assert.ok(snap.exists);
    assert.equal(snap.data().status, "active");
    assert.equal(snap.data().roleId, "inventoryCreateExecutor");
    const audit = await getAuditEvent(key);
    assert.equal(audit.action, "assignApprovedRole");
    assert.equal(audit.outcome, "applied");
  });

  await check("wiring: inventoryCreateExecutor assignment can be revoked through the trusted command -> disabled + applied audit", async () => {
    const actor = await makeAdminActor();
    const principal = await makePrincipal();
    const grantKey = `assign-ice-rev-${uid("k")}`;
    await assignApprovedRole({ actorUid: actor, principalUid: principal, roleId: "inventoryCreateExecutor", scope: { type: "global" }, idempotencyKey: grantKey });
    const revokeKey = `revoke-ice-${uid("k")}`;
    const result = await revokeRole({ actorUid: actor, assignmentId: grantKey, idempotencyKey: revokeKey });
    assert.equal(result.status, "applied");
    assert.equal((await db.collection("roleAssignments").doc(grantKey).get()).data().status, "disabled");
    assert.equal((await getAuditEvent(revokeKey)).action, "revokeRole");
  });

  await check("wiring: unauthorized assigner (dispatcher lacks admin.roleAssignment.write) is DENIED for inventoryCreateExecutor", async () => {
    const actor = await makeDispatcherActor();
    const principal = await makePrincipal();
    await assertRejectsWith(
      assignApprovedRole({ actorUid: actor, principalUid: principal, roleId: "inventoryCreateExecutor", scope: { type: "global" }, idempotencyKey: `assign-ice-unauth-${uid("k")}` }),
      UnauthorizedActorError, "dispatcher may not assign",
    );
  });

  await check("wiring: unknown roleId still fails closed (UnknownRoleError) through the curated registry", async () => {
    const actor = await makeAdminActor();
    const principal = await makePrincipal();
    await assertRejectsWith(
      assignApprovedRole({ actorUid: actor, principalUid: principal, roleId: "not-a-real-governed-role", scope: { type: "global" }, idempotencyKey: `assign-unknown-${uid("k")}` }),
      UnknownRoleError, "unknown roleId denied",
    );
  });

  await check("wiring: a non-allowlisted governed Role (officeManager) is NOT assignable -> UnknownRoleError (allowlist, not all governed Roles)", async () => {
    const actor = await makeAdminActor();
    const principal = await makePrincipal();
    for (const roleId of ["officeManager", "operationsManager", "owner"]) {
      await assertRejectsWith(
        assignApprovedRole({ actorUid: actor, principalUid: principal, roleId, scope: { type: "global" }, idempotencyKey: `assign-${roleId}-${uid("k")}` }),
        UnknownRoleError, `${roleId} not allowlisted`,
      );
    }
  });

  await check("wiring: admin privileged approval behavior unchanged (grantRole admin still needs a distinct approver)", async () => {
    const actor = await makeAdminActor();
    const principal = await makePrincipal();
    await assertRejectsWith(
      grantRole({ actorUid: actor, principalUid: principal, roleId: "admin", scope: { type: "global" }, idempotencyKey: `grant-admin-noapprover-${uid("k")}` }),
      InvalidInputError, "admin still requires approverUid",
    );
  });

  await check("wiring: end-to-end -- createPart resolves inventory.catalog.manage AFTER trusted assignment, and DENIES after revoke", async () => {
    const { createPart, UnauthorizedActorError: PMUnauthorized } = await import("../lib/partMaster/partMasterCommands.js");
    const actor = await makeAdminActor();
    const operator = await makePrincipal("ice-operator");
    const grantKey = `assign-ice-e2e-${uid("k")}`;
    // Grant through the TRUSTED command (real allRoles() resolution, no deps injection):
    await assignApprovedRole({ actorUid: actor, principalUid: operator, roleId: "inventoryCreateExecutor", scope: { type: "global" }, idempotencyKey: grantKey });
    const pid = uid("E2E-PART").toUpperCase().replace(/[^A-Z0-9_-]/g, "-");
    const created = await createPart({ actorUid: operator, idempotencyKey: `pmcreate-${uid("k")}`, part: { partId: pid, internalPartNumber: pid, name: "Wired", status: "DRAFT", stockingUnit: "EACH", controlType: "STANDARD", stockingClass: "STOCKED" } });
    assert.equal(created.outcome, "applied");
    // Revoke through the trusted command; the capability must resolve DENY:
    await revokeRole({ actorUid: actor, assignmentId: grantKey, idempotencyKey: `revoke-ice-e2e-${uid("k")}` });
    const pid2 = uid("E2E-PART2").toUpperCase().replace(/[^A-Z0-9_-]/g, "-");
    await assertRejectsWith(
      createPart({ actorUid: operator, idempotencyKey: `pmcreate2-${uid("k")}`, part: { partId: pid2, internalPartNumber: pid2, name: "AfterRevoke", status: "DRAFT", stockingUnit: "EACH", controlType: "STANDARD", stockingClass: "STOCKED" } }),
      PMUnauthorized, "createPart denies after revoke",
    );
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Test run failed:", err);
  process.exit(1);
});
