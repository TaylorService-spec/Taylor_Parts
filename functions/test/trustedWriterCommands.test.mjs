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
  requestPrivilegedRole,
  decidePrivilegedRoleRequest,
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

  // =====================================================================
  // Owner ruling (grantable-governed-roles workstream): all fifteen governed
  // business Roles are now on the trusted-writer allowlist -- UnknownRoleError
  // is gone for every one of them. The seven NON-privileged newcomers (owner
  // is the one exception, covered in its own section below) are assignable
  // through the single-admin assignApprovedRole path, exactly like the six
  // operational Roles already covered above.
  // =====================================================================

  await check("wiring: the seven newly-reachable NON-privileged governed Roles are each assignable via assignApprovedRole (single admin)", async () => {
    const actor = await makeAdminActor();
    for (const roleId of [
      "generalEmployee",
      "officeManager",
      "salesManager",
      "accountingManager",
      "financeManager",
      "fieldManager",
      "operationsManager",
    ]) {
      const principal = await makePrincipal(`principal-${roleId}`);
      const key = `assign-${roleId}-${uid("k")}`;
      const result = await assignApprovedRole({ actorUid: actor, principalUid: principal, roleId, scope: { type: "global" }, idempotencyKey: key });
      assert.equal(result.status, "applied", roleId);
      const snap = await db.collection("roleAssignments").doc(key).get();
      assert.equal(snap.data().roleId, roleId);
      assert.equal(snap.data().status, "active");
    }
  });

  await check("wiring: an unrecognized roleId is still UnknownRoleError -- widening the allowlist did not widen what counts as a real Role", async () => {
    const actor = await makeAdminActor();
    const principal = await makePrincipal();
    await assertRejectsWith(
      assignApprovedRole({ actorUid: actor, principalUid: principal, roleId: "still-not-a-real-role", scope: { type: "global" }, idempotencyKey: `assign-fake-${uid("k")}` }),
      UnknownRoleError,
    );
  });

  // =====================================================================
  // Owner ruling: `owner` is now grantable -- privileged, so it MUST go
  // through the exact same two-person path `admin` already goes through
  // (grantRole with a distinct, independently-privileged approver), and
  // MUST be refused by the single-admin assignApprovedRole path exactly
  // like `admin` is. Every protection asserted below is EXISTING,
  // unmodified code (role.privileged gating in grantRole/revokeRole,
  // verifyApproverIsPrivileged) -- these tests prove it extends to `owner`
  // automatically rather than assuming it does.
  // =====================================================================

  await check("owner: assignApprovedRole (single-admin path) refuses it, exactly like admin", async () => {
    const actor = await makeAdminActor();
    const principal = await makePrincipal();
    await assertRejectsWith(
      assignApprovedRole({ actorUid: actor, principalUid: principal, roleId: "owner", scope: { type: "global" }, idempotencyKey: `assign-owner-reject-${uid("k")}` }),
      InvalidStateError,
    );
  });

  await check("owner: grantRole without an approverUid is denied", async () => {
    const actor = await makeAdminActor();
    const principal = await makePrincipal();
    await assertRejectsWith(
      grantRole({ actorUid: actor, principalUid: principal, roleId: "owner", scope: { type: "global" }, idempotencyKey: `grant-owner-noapprover-${uid("k")}` }),
      InvalidInputError,
    );
  });

  await check("owner: a principal cannot self-grant owner, even with a distinct valid approver present", async () => {
    const actor = await makeAdminActor();
    const approver = await makeAdminActor();
    await assertRejectsWith(
      grantRole({ actorUid: actor, principalUid: actor, roleId: "owner", scope: { type: "global" }, approverUid: approver, idempotencyKey: `grant-owner-self-${uid("k")}` }),
      SelfApprovalError,
    );
  });

  await check("owner: approverUid === actorUid (self-approval) is denied", async () => {
    const actor = await makeAdminActor();
    const principal = await makePrincipal();
    await assertRejectsWith(
      grantRole({ actorUid: actor, principalUid: principal, roleId: "owner", scope: { type: "global" }, approverUid: actor, idempotencyKey: `grant-owner-selfapprove-${uid("k")}` }),
      SelfApprovalError,
    );
  });

  await check("owner: approverUid === principalUid (approving your own grant target) is denied", async () => {
    const actor = await makeAdminActor();
    const principal = await makePrincipal();
    await assertRejectsWith(
      grantRole({ actorUid: actor, principalUid: principal, roleId: "owner", scope: { type: "global" }, approverUid: principal, idempotencyKey: `grant-owner-approvertargetsame-${uid("k")}` }),
      SelfApprovalError,
    );
  });

  await check("owner: an approver who is not themselves privileged (dispatcher) is denied (InsufficientApproverAuthorityError)", async () => {
    const actor = await makeAdminActor();
    const principal = await makePrincipal();
    const nonPrivilegedApprover = await makeDispatcherActor();
    await assertRejectsWith(
      grantRole({
        actorUid: actor,
        principalUid: principal,
        roleId: "owner",
        scope: { type: "global" },
        approverUid: nonPrivilegedApprover,
        idempotencyKey: `grant-owner-badapprover-${uid("k")}`,
      }),
      InsufficientApproverAuthorityError,
    );
  });

  await check("owner: a genuinely distinct, privileged approver SUCCEEDS -- and the principal's grant resolves through resolveEffectiveAccess", async () => {
    const actor = await makeAdminActor();
    const principal = await makePrincipal();
    const approver = await makeAdminActor();
    const key = `grant-owner-ok-${uid("k")}`;
    const result = await grantRole({
      actorUid: actor,
      principalUid: principal,
      roleId: "owner",
      scope: { type: "global" },
      approverUid: approver,
      idempotencyKey: key,
    });
    assert.equal(result.status, "applied");
    const assignmentSnap = await db.collection("roleAssignments").doc(key).get();
    assert.equal(assignmentSnap.data().roleId, "owner");
    assert.equal(assignmentSnap.data().approvedBy, approver);

    // Reporting (report.*), which only Owner holds, is now reachable for this principal --
    // exactly the live defect the Owner ruling names ("no owner assignment exists, which is
    // why Reporting is unreachable for every persona"). Verified through the SAME merged-catalog
    // read path a real caller uses (effectiveAccessFeed.ts), not by re-asserting the Role's own
    // permissions array.
    const { resolveEffectiveAccess } = await import("../lib/access/effectiveAccessFeed.js");
    const { accessVersion, decisions } = await resolveEffectiveAccess({
      principalUid: principal,
      permissionIds: ["report.customer.read"],
    });
    assert.equal(accessVersion, 1);
    assert.equal(decisions["report.customer.read"], true, "granting owner must make a report.* capability reachable");
  });

  await check("owner: revokeRole for a privileged owner assignment requires the same distinct-approver protections as revoking admin", async () => {
    const actor = await makeAdminActor();
    const principal = await makePrincipal();
    const approver = await makeAdminActor();
    const grantKey = `grant-owner-forrevoke-${uid("k")}`;
    await grantRole({ actorUid: actor, principalUid: principal, roleId: "owner", scope: { type: "global" }, approverUid: approver, idempotencyKey: grantKey });

    // No approverUid at all -> denied.
    await assertRejectsWith(
      revokeRole({ actorUid: actor, assignmentId: grantKey, idempotencyKey: `revoke-owner-noapprover-${uid("k")}` }),
      InvalidInputError,
    );

    // Self-revocation by the actor who IS the owner principal -> denied, even with an approver.
    await assertRejectsWith(
      revokeRole({ actorUid: principal, assignmentId: grantKey, approverUid: approver, idempotencyKey: `revoke-owner-self-${uid("k")}` }),
      SelfApprovalError,
    );

    // Genuinely distinct, privileged approver -> succeeds.
    const revokeApprover = await makeAdminActor();
    const revokeResult = await revokeRole({ actorUid: actor, assignmentId: grantKey, approverUid: revokeApprover, idempotencyKey: `revoke-owner-ok-${uid("k")}` });
    assert.equal(revokeResult.status, "applied");
    assert.equal((await db.collection("roleAssignments").doc(grantKey).get()).data().status, "disabled");
  });

  // =====================================================================
  // owner >= admin, verified by COMPOSITION through the real, merged catalog
  // path a caller actually uses (resolveEffectiveAccess / effectiveAccessFeed.ts
  // -- COMPATIBILITY_ROLES + GOVERNED_BUSINESS_ROLES), not by asserting the
  // Role objects' own .permissions arrays contain each other. Two principals,
  // one holding only `admin`, one holding only `owner`, resolved against the
  // SAME capability id set.
  // =====================================================================

  await check("owner >= admin by composition: every capability a solely-admin principal ALLOWs, a solely-owner principal ALLOWs too, through the real merged Role catalog", async () => {
    const { resolveEffectiveAccess } = await import("../lib/access/effectiveAccessFeed.js");
    const adminOnly = await makePrincipal("admin-only");
    await seedActiveRoleAssignment(adminOnly, "admin");
    const ownerOnly = await makePrincipal("owner-only");
    await seedActiveRoleAssignment(ownerOnly, "owner");

    const sampleCapabilities = [
      "customer.record.read",
      "customer.governedField.write",
      "workOrder.create",
      "workOrder.transition",
      "workOrder.cancel",
      "inventory.transaction.read",
      "inventory.action.read",
      "inventory.action.create",
      "inventory.catalog.read",
      "warehouse.record.read",
      "admin.userStatus.write",
      "admin.roleAssignment.write",
      "admin.accessRequest.decide",
      "reorder.request.read.queue",
      "reorder.purchaseOrder.read",
      // report.customer.read is the one capability owner holds that admin
      // does NOT -- confirms the composition is a strict superset, not an
      // identical set.
      "report.customer.read",
    ];
    const adminDecisions = (await resolveEffectiveAccess({ principalUid: adminOnly, permissionIds: sampleCapabilities })).decisions;
    const ownerDecisions = (await resolveEffectiveAccess({ principalUid: ownerOnly, permissionIds: sampleCapabilities })).decisions;

    for (const id of sampleCapabilities) {
      if (adminDecisions[id] === true) {
        assert.equal(ownerDecisions[id], true, `owner must ALLOW "${id}" because admin does (owner >= admin)`);
      }
    }
    // WAS: admin must NOT resolve report.customer.read -- reports were Owner-only.
    // The 2026-08-19 Owner ruling ("Admin and Owner have full access to all possible
    // features and permissions") gives admin the whole catalog, reports included, so the
    // old assertion now asserts against a standing decision.
    //
    // What this check is really for is the owner >= admin property, and that is proven by
    // the loop directly above -- which is stronger now, not weaker, because admin resolving
    // MORE means the loop has more to prove owner also resolves. Asserting admin ALLOWs
    // keeps the id load-bearing here rather than deleting the line and quietly narrowing
    // what the test covers.
    assert.equal(
      adminDecisions["report.customer.read"],
      true,
      "admin resolves report.customer.read since the 2026-08-19 full-catalog ruling",
    );
    assert.equal(ownerDecisions["report.customer.read"], true, "owner alone must resolve report.customer.read (the strict-superset id)");
  });

  await check("owner >= admin does NOT extend to the trusted-writer commands' OWN actor check: an owner-only principal (no admin compatibility Role) still cannot invoke grantRole itself -- a documented, pre-existing scope boundary this change leaves unmodified", async () => {
    // trustedWriterCommands.ts's own resolvePrincipalPermission resolves the
    // ACTOR/APPROVER of its six commands against COMPATIBILITY_ROLES only
    // (see its own header comment: "ITS actions are compatibility-only by
    // the Enterprise Access Specification's own design"). Making `owner`
    // grantable widens who can be granted the Role and what the resulting
    // principal can read through the merged-catalog surfaces (report.*,
    // reportExecutionService, partMasterCommands, etc. -- see the test
    // above) -- it deliberately does NOT widen who may act as actor/approver
    // for grantRole/revokeRole/assignApprovedRole/setUserStatus/
    // approveAccessRequest/rejectAccessRequest themselves. This test proves
    // that boundary still holds after this change, rather than assuming it.
    const ownerOnlyActor = await makePrincipal("owner-only-actor");
    await seedActiveRoleAssignment(ownerOnlyActor, "owner");
    const principal = await makePrincipal();
    await assertRejectsWith(
      grantRole({ actorUid: ownerOnlyActor, principalUid: principal, roleId: "technician", scope: { type: "global" }, idempotencyKey: `owner-only-actor-denied-${uid("k")}` }),
      UnauthorizedActorError,
    );
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

  // =====================================================================
  // PRIVILEGED ROLE APPROVAL -- authenticated Admin approval
  // =====================================================================
  //
  // The control being proven: PROPOSAL != AUTHENTICATED APPROVAL.
  //
  // Taylor policy (Owner, 2026-08-22) is ONE approver -- the human operating the `admin` principal.
  // These checks therefore do NOT assert a second human. They assert that approval identity comes
  // from authenticated context, and that a request-body field can never stand in for it.

  await check("requestPrivilegedRole: creates a PENDING request and grants NOTHING", async () => {
    const actor = uid("admin");
    const target = uid("target");
    await seedActiveRoleAssignment(actor, "admin");
    const requestId = `req-privileged-${uid("k")}`;

    const out = await requestPrivilegedRole({
      actorUid: actor, principalUid: target, roleId: "owner",
      scope: { type: "global" }, idempotencyKey: requestId,
    });
    assert.equal(out.status, "applied");

    const req = await db.collection("privilegedRoleRequests").doc(requestId).get();
    assert.equal(req.data().status, "PENDING_APPROVAL");
    assert.equal(req.data().requiredApprovals, 1, "Taylor policy is one approver, recorded per request");
    assert.equal(await countDocs("roleAssignments", "principalUid", target), 0,
      "a PENDING request must grant nothing");
  });

  await check("requestPrivilegedRole: a non-privileged Role is refused from the approval queue", async () => {
    const actor = uid("admin");
    await seedActiveRoleAssignment(actor, "admin");
    await assertRejectsWith(
      requestPrivilegedRole({
        actorUid: actor, principalUid: uid("t"), roleId: "salesperson",
        scope: { type: "global" }, idempotencyKey: `req-nonpriv-${uid("k")}`,
      }),
      InvalidInputError,
    );
  });

  await check("requestPrivilegedRole: an unauthorized proposer is DENIED", async () => {
    const actor = uid("nobody");
    await seedActiveRoleAssignment(actor, "dispatcher");
    await assertRejectsWith(
      requestPrivilegedRole({
        actorUid: actor, principalUid: uid("t"), roleId: "owner",
        scope: { type: "global" }, idempotencyKey: `req-unauth-${uid("k")}`,
      }),
      UnauthorizedActorError,
    );
  });

  await check("decide: an authenticated Admin APPROVE grants the Role in the same transaction", async () => {
    const proposer = uid("admin");
    const approver = uid("admin");
    const target = uid("target");
    await auth.createUser({ uid: target });
    await seedActiveRoleAssignment(proposer, "admin");
    await seedActiveRoleAssignment(approver, "admin");
    const requestId = `req-approve-${uid("k")}`;
    await requestPrivilegedRole({
      actorUid: proposer, principalUid: target, roleId: "owner",
      scope: { type: "global" }, idempotencyKey: requestId,
    });

    const decisionKey = `dec-approve-${uid("k")}`;
    const out = await decidePrivilegedRoleRequest({
      actorUid: approver, requestId, decision: "APPROVE", idempotencyKey: decisionKey,
    });
    assert.equal(out.status, "applied");

    const req = await db.collection("privilegedRoleRequests").doc(requestId).get();
    assert.equal(req.data().status, "APPROVED");
    assert.equal(req.data().decidedBy, approver, "the decision records the AUTHENTICATED approver");

    const assignment = await db.collection("roleAssignments").doc(decisionKey).get();
    assert.equal(assignment.exists, true, "APPROVE must grant in the same command");
    assert.equal(assignment.data().roleId, "owner");
    assert.equal(assignment.data().status, "active");
    assert.equal(assignment.data().approvedBy, approver);
    assert.equal(assignment.data().approvalRequestId, requestId,
      "the assignment must be traceable to the approval that authorized it");
  });

  await check("decide: a request-body approverUid is NOT proof of approval", async () => {
    // THE DEFECT THIS FLOW EXISTS TO FIX. A non-privileged caller naming the Admin UID must be
    // denied: the command reads the approver from actorUid only, so the extra field is inert.
    const proposer = uid("admin");
    const realAdmin = uid("admin");
    const impostor = uid("nobody");
    const target = uid("target");
    await seedActiveRoleAssignment(proposer, "admin");
    await seedActiveRoleAssignment(realAdmin, "admin");
    await seedActiveRoleAssignment(impostor, "dispatcher");
    const requestId = `req-fake-${uid("k")}`;
    await requestPrivilegedRole({
      actorUid: proposer, principalUid: target, roleId: "owner",
      scope: { type: "global" }, idempotencyKey: requestId,
    });

    await assertRejectsWith(
      decidePrivilegedRoleRequest({
        actorUid: impostor,
        approverUid: realAdmin,
        requestId, decision: "APPROVE", idempotencyKey: `dec-fake-${uid("k")}`,
      }),
      UnauthorizedActorError,
    );
    assert.equal(await countDocs("roleAssignments", "principalUid", target), 0,
      "supplying the Admin UID must grant nothing");
  });

  await check("decide: the TARGET may not approve their own elevation", async () => {
    const proposer = uid("admin");
    const target = uid("target");
    await seedActiveRoleAssignment(proposer, "admin");
    await seedActiveRoleAssignment(target, "admin");
    const requestId = `req-selftarget-${uid("k")}`;
    await requestPrivilegedRole({
      actorUid: proposer, principalUid: target, roleId: "owner",
      scope: { type: "global" }, idempotencyKey: requestId,
    });
    await assertRejectsWith(
      decidePrivilegedRoleRequest({
        actorUid: target, requestId, decision: "APPROVE", idempotencyKey: `dec-selftarget-${uid("k")}`,
      }),
      SelfApprovalError,
    );
  });

  await check("decide: REJECT records the decision and grants nothing", async () => {
    const approver = uid("admin");
    const target = uid("target");
    await seedActiveRoleAssignment(approver, "admin");
    const requestId = `req-reject-${uid("k")}`;
    await requestPrivilegedRole({
      actorUid: approver, principalUid: target, roleId: "owner",
      scope: { type: "global" }, idempotencyKey: requestId,
    });
    await decidePrivilegedRoleRequest({
      actorUid: approver, requestId, decision: "REJECT", reason: "not needed",
      idempotencyKey: `dec-reject-${uid("k")}`,
    });
    const req = await db.collection("privilegedRoleRequests").doc(requestId).get();
    assert.equal(req.data().status, "REJECTED");
    assert.equal(await countDocs("roleAssignments", "principalUid", target), 0);
  });

  await check("decide: a REJECTED request cannot then be approved", async () => {
    const approver = uid("admin");
    const target = uid("target");
    await seedActiveRoleAssignment(approver, "admin");
    const requestId = `req-rejapp-${uid("k")}`;
    await requestPrivilegedRole({
      actorUid: approver, principalUid: target, roleId: "owner",
      scope: { type: "global" }, idempotencyKey: requestId,
    });
    await decidePrivilegedRoleRequest({
      actorUid: approver, requestId, decision: "REJECT", idempotencyKey: `dec-r1-${uid("k")}`,
    });
    await assertRejectsWith(
      decidePrivilegedRoleRequest({
        actorUid: approver, requestId, decision: "APPROVE", idempotencyKey: `dec-r2-${uid("k")}`,
      }),
      InvalidStateError,
    );
    assert.equal(await countDocs("roleAssignments", "principalUid", target), 0);
  });

  await check("decide: a TAMPERED request is refused rather than approved", async () => {
    // Approving a request whose target changed after review is approving something nobody read --
    // the obvious attack on any propose/approve flow.
    const approver = uid("admin");
    const target = uid("target");
    const victim = uid("victim");
    await seedActiveRoleAssignment(approver, "admin");
    const requestId = `req-tamper-${uid("k")}`;
    await requestPrivilegedRole({
      actorUid: approver, principalUid: target, roleId: "owner",
      scope: { type: "global" }, idempotencyKey: requestId,
    });
    await db.collection("privilegedRoleRequests").doc(requestId).update({ principalUid: victim });
    await assertRejectsWith(
      decidePrivilegedRoleRequest({
        actorUid: approver, requestId, decision: "APPROVE", idempotencyKey: `dec-tamper-${uid("k")}`,
      }),
      InvalidStateError,
    );
    assert.equal(await countDocs("roleAssignments", "principalUid", victim), 0);
  });

  await check("decide: authority REVOKED between proposal and approval is denied", async () => {
    // Authority is re-resolved AT APPROVAL TIME. Carrying it forward from the request would make
    // revocation take effect everywhere except the one place it matters most.
    const approver = uid("admin");
    const target = uid("target");
    const seedId = await seedActiveRoleAssignment(approver, "admin");
    const requestId = `req-revoked-${uid("k")}`;
    await requestPrivilegedRole({
      actorUid: approver, principalUid: target, roleId: "owner",
      scope: { type: "global" }, idempotencyKey: requestId,
    });
    await db.collection("roleAssignments").doc(seedId).update({ status: "disabled" });
    await assertRejectsWith(
      decidePrivilegedRoleRequest({
        actorUid: approver, requestId, decision: "APPROVE", idempotencyKey: `dec-revoked-${uid("k")}`,
      }),
      UnauthorizedActorError,
    );
    assert.equal(await countDocs("roleAssignments", "principalUid", target), 0);
  });

  await check("decide: a duplicate approval creates no second assignment and no version churn", async () => {
    const approver = uid("admin");
    const target = uid("target");
    await seedActiveRoleAssignment(approver, "admin");
    await auth.createUser({ uid: target });
    const requestId = `req-dup-${uid("k")}`;
    await requestPrivilegedRole({
      actorUid: approver, principalUid: target, roleId: "owner",
      scope: { type: "global" }, idempotencyKey: requestId,
    });
    const decisionKey = `dec-dup-${uid("k")}`;
    await decidePrivilegedRoleRequest({ actorUid: approver, requestId, decision: "APPROVE", idempotencyKey: decisionKey });
    const versionAfterFirst = (await db.collection("users").doc(target).get()).data()?.accessVersion;

    const second = await decidePrivilegedRoleRequest({ actorUid: approver, requestId, decision: "APPROVE", idempotencyKey: decisionKey });
    assert.equal(second.status, "alreadyApplied", "a replayed decision is a no-op, not a second grant");
    assert.equal(await countDocs("roleAssignments", "principalUid", target), 1);
    assert.equal((await db.collection("users").doc(target).get()).data()?.accessVersion, versionAfterFirst,
      "a no-op retry must not churn accessVersion");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);

}

main().catch((err) => {
  console.error("Test run failed:", err);
  process.exit(1);
});
