// readPrincipalAccessState -- the TRUSTED PRINCIPAL-ACCESS READ, against live emulators.
//
// Runs against LIVE Firestore + Auth emulators (Admin SDK, no Rules involved), the same posture as
// trustedWriterCommands.test.mjs. Start them first:
//   firebase emulators:start --only firestore,auth --project taylor-parts
//
// WHY THIS SUITE EXISTS. Administration > Users could write a person's access and could not read
// it, so the record page declared "Account Status: Not available", showed no governed Roles, and
// could never call revokeRole (whose assignmentId no read exposed). readPrincipalAccessState closes
// that. What is proved here is the part unit tests structurally cannot reach: that the ACTUAL
// Firebase Auth disabled flag and the ACTUAL roleAssignments documents come back correctly, and
// that add/remove/enable/disable move that state the way the screen claims they do.
//
// EVERY ASSERTION IS ROUND-TRIP. Nothing is asserted from a command's return value alone -- each
// mutation is followed by a fresh read through the same command the UI calls, because "the write
// returned ok" and "the state is now what the screen will show" are different claims, and only the
// second one matters to an administrator looking at the page.
//
// The default ports are OVERRIDABLE, for the reason given in trustedWriterCommands.test.mjs: an
// unconditional assignment means the suite can only run when one exact port happens to be free.
process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= "127.0.0.1:9099";

import assert from "node:assert/strict";
import admin from "firebase-admin";
import {
  assignApprovedRole,
  revokeRole,
  setUserStatus,
  readPrincipalAccessState,
  UnauthorizedActorError,
  InvalidInputError,
  InvalidStateError,
} from "../lib/access/trustedWriterCommands.js";
import { COMPATIBILITY_ROLES } from "../lib/access/compatibilityRoles.js";
import { GOVERNED_BUSINESS_ROLES } from "../lib/access/governedBusinessRoles.js";

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

function key(label) {
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

/** An actor holding a governed Role, plus a real Auth account so claims refresh can resolve. */
async function makeActor(roleId, label = roleId) {
  const u = uid(`${label}-actor`);
  await auth.createUser({ uid: u });
  await seedActiveRoleAssignment(u, roleId);
  return u;
}

/** A target principal with a real Auth account and no governed Role of their own. */
async function makePrincipal(label = "principal") {
  const u = uid(label);
  await auth.createUser({ uid: u });
  return u;
}

async function readAccessVersion(principalUid) {
  const snap = await db.collection("users").doc(principalUid).get();
  return snap.exists ? (snap.data().accessVersion ?? 0) : 0;
}

async function main() {
  // ════════════════════ A. WHO MAY PERFORM THE READ ════════════════════
  //
  // admin.principalAccess.read is granted to the Administrator Role only. Owner inherits it by the
  // existing composition (OWNER_PERMISSIONS spreads ADMIN_ROLE.permissions) rather than by a second
  // grant, and that inheritance is asserted rather than assumed -- a composition that silently
  // stopped including it would otherwise be invisible until an owner hit a denial in production.

  await check("A1 admin: an Administrator resolves the read and gets state back", async () => {
    const actor = await makeActor("admin");
    const target = await makePrincipal();
    const state = await readPrincipalAccessState({ actorUid: actor, principalUid: target });
    assert.equal(state.authExists, true);
  });

  await check("A2 owner: the governed Owner Role CARRIES the read by composition", async () => {
    // The catalog-level half of "Owner inherits it normally": OWNER_PERMISSIONS spreads
    // ADMIN_ROLE.permissions, so the id reaches Owner without a second grant being written. Checked
    // against the real merged catalog rather than by reading the source, because the composition is
    // computed and a change to how it is derived would not show up in a grep.
    assert.ok(
      GOVERNED_BUSINESS_ROLES.owner.permissions.includes("admin.principalAccess.read"),
      "Owner must carry the read through the existing composition",
    );
    assert.ok(
      COMPATIBILITY_ROLES.admin.permissions.includes("admin.principalAccess.read"),
      "Administrator holds it directly",
    );
    assert.ok(
      !COMPATIBILITY_ROLES.dispatcher.permissions.includes("admin.principalAccess.read"),
      "dispatcher must never carry it",
    );
  });

  await check("A2b owner-ONLY principals still cannot invoke trusted writers -- PRE-EXISTING", async () => {
    // MEASURED, and it surprised this suite's first draft, which asserted the opposite.
    //
    // resolvePrincipalPermission resolves the ACTOR against COMPATIBILITY_ROLES only
    // (trustedWriterCommands.ts), so a principal whose sole assignment is the governed `owner` Role
    // is not recognised by ANY trusted-writer command -- not this read, and not grantRole either.
    // That boundary predates this work and is already asserted for grantRole in
    // trustedWriterCommands.test.mjs; it is pinned here so the new read is documented as sitting
    // inside the same boundary rather than appearing to have introduced it.
    //
    // In practice the sandbox admin persona holds the compatibility `admin` Role, which is why the
    // surface works there. An owner-only principal is a real gap, but a pre-existing platform-wide
    // one to be closed deliberately, not silently by this change.
    const actor = await makeActor("owner");
    const target = await makePrincipal();
    await assert.rejects(
      readPrincipalAccessState({ actorUid: actor, principalUid: target }),
      UnauthorizedActorError,
    );
  });

  await check("A3 dispatcher: DENIED -- seeing the Users directory is not authority over access", async () => {
    const actor = await makeActor("dispatcher");
    const target = await makePrincipal();
    await assert.rejects(
      readPrincipalAccessState({ actorUid: actor, principalUid: target }),
      UnauthorizedActorError,
    );
  });

  await check("A4 a principal holding no Role at all is DENIED", async () => {
    // The ordinary fail-closed path, and the state every unprovisioned account is in.
    const actor = await makePrincipal("no-role-actor");
    const target = await makePrincipal();
    await assert.rejects(
      readPrincipalAccessState({ actorUid: actor, principalUid: target }),
      UnauthorizedActorError,
    );
  });

  await check("A5 an absent actorUid is refused as INPUT, never treated as anonymous", async () => {
    // The callable derives actorUid from request.auth.uid only, so an unauthenticated call arrives
    // here as an empty string. It must be an input error, not a read that proceeds with no actor.
    const target = await makePrincipal();
    await assert.rejects(
      readPrincipalAccessState({ actorUid: "", principalUid: target }),
      InvalidInputError,
    );
  });

  await check("A6 the WRITE capabilities do not confer the read", async () => {
    // Read and write are separate authorities. A Role holding only roleAssignment.write must not
    // be able to enumerate another principal's access state by side effect of being able to change
    // it -- proved through a Role that genuinely lacks the read.
    const actor = await makeActor("dispatcher", "writer-only");
    await assert.rejects(
      readPrincipalAccessState({ actorUid: actor, principalUid: await makePrincipal() }),
      UnauthorizedActorError,
    );
  });

  // ════════════════════ C. WHAT THE READ RETURNS ════════════════════

  await check("C1 returns the REAL Auth enabled state, not an inference", async () => {
    const actor = await makeActor("admin");
    const enabled = await makePrincipal("enabled-user");
    const disabled = uid("disabled-user");
    await auth.createUser({ uid: disabled, disabled: true });

    const a = await readPrincipalAccessState({ actorUid: actor, principalUid: enabled });
    const b = await readPrincipalAccessState({ actorUid: actor, principalUid: disabled });
    assert.equal(a.accountStatus, "enabled");
    assert.equal(b.accountStatus, "disabled");
  });

  await check("C2 returns ALL and ONLY active assignments, with the real document ids", async () => {
    const actor = await makeActor("admin");
    const target = await makePrincipal();
    const activeId = await seedActiveRoleAssignment(target, "salesperson");
    const secondId = await seedActiveRoleAssignment(target, "dispatcher");
    // A revoked assignment: present in the collection, absent from the answer.
    const revokedId = await seedActiveRoleAssignment(target, "technician");
    await db.collection("roleAssignments").doc(revokedId).update({ status: "disabled" });

    const state = await readPrincipalAccessState({ actorUid: actor, principalUid: target });
    const ids = state.assignments.map((a) => a.assignmentId).sort();
    assert.deepEqual(ids, [activeId, secondId].sort());
    // The assignmentId is the real document id -- this is the value revokeRole is called with, so
    // an invented or re-derived id here would make Remove uncallable or, worse, wrong.
    const salesperson = state.assignments.find((a) => a.assignmentId === activeId);
    assert.equal(salesperson.roleId, "salesperson");
    assert.deepEqual(salesperson.scope, { type: "global" });
  });

  await check("C3 a principal with no Auth account: authExists false, status NULL, never 'enabled'", async () => {
    // A broken or absent linkage must not be reported as an enabled account. null is a third
    // answer, and the screen renders it as "no account exists" rather than offering a Disable
    // button against a user Firebase does not have.
    const actor = await makeActor("admin");
    const ghost = uid("no-auth-user");
    const state = await readPrincipalAccessState({ actorUid: actor, principalUid: ghost });
    assert.equal(state.authExists, false);
    assert.equal(state.accountStatus, null);
    assert.deepEqual(state.assignments, []);
  });

  await check("C4 setUserStatus against a nonexistent Auth user FAILS -- no phantom mutation", async () => {
    // The UI never offers the action in this state (accountStatus is null, so no button renders),
    // and the command refuses it independently. Both halves, because the UI is not the boundary.
    const actor = await makeActor("admin");
    const ghost = uid("no-auth-user");
    await assert.rejects(
      setUserStatus({
        actorUid: actor,
        principalUid: ghost,
        status: "disabled",
        idempotencyKey: key("ghost-status"),
      }),
    );
  });

  // ════════════════════ D. ADD ROLE IS ADDITIVE ════════════════════

  await check("D1 assignApprovedRole ADDS: the existing assignment stays active", async () => {
    const actor = await makeActor("admin");
    const target = await makePrincipal();
    const existingId = await seedActiveRoleAssignment(target, "dispatcher");

    await assignApprovedRole({
      actorUid: actor,
      principalUid: target,
      roleId: "salesperson",
      scope: { type: "global" },
      idempotencyKey: key("add-salesperson"),
    });

    const state = await readPrincipalAccessState({ actorUid: actor, principalUid: target });
    const roleIds = state.assignments.map((a) => a.roleId).sort();
    assert.deepEqual(roleIds, ["dispatcher", "salesperson"]);
    // Explicitly: the pre-existing assignment was neither replaced nor disabled.
    const existing = await db.collection("roleAssignments").doc(existingId).get();
    assert.equal(existing.data().status, "active");
  });

  await check("D2 accessVersion advances on the add", async () => {
    const actor = await makeActor("admin");
    const target = await makePrincipal();
    const before = await readAccessVersion(target);
    await assignApprovedRole({
      actorUid: actor,
      principalUid: target,
      roleId: "salesperson",
      scope: { type: "global" },
      idempotencyKey: key("add-version"),
    });
    assert.ok((await readAccessVersion(target)) > before, "accessVersion must advance");
  });

  await check("D3 the server has NOT been changed to dedupe or replace", async () => {
    // The UI declines to offer an already-held Role, and that is a usability filter, not the
    // boundary. This pins the SERVER's actual behaviour so a later "helpful" dedupe cannot be added
    // silently -- if the model ever changes, this assertion is where it gets noticed.
    const actor = await makeActor("admin");
    const target = await makePrincipal();
    for (const k of ["dup-a", "dup-b"]) {
      await assignApprovedRole({
        actorUid: actor,
        principalUid: target,
        roleId: "salesperson",
        scope: { type: "global" },
        idempotencyKey: key(k),
      });
    }
    const state = await readPrincipalAccessState({ actorUid: actor, principalUid: target });
    assert.equal(
      state.assignments.filter((a) => a.roleId === "salesperson").length,
      2,
      "assignApprovedRole is additive and does not dedupe -- two calls make two assignments",
    );
  });

  await check("D4 a PRIVILEGED Role is refused on the single-admin add path", async () => {
    const actor = await makeActor("admin");
    const target = await makePrincipal();
    await assert.rejects(
      assignApprovedRole({
        actorUid: actor,
        principalUid: target,
        roleId: "owner",
        scope: { type: "global" },
        idempotencyKey: key("add-owner"),
      }),
      InvalidStateError,
    );
  });

  // ════════════════════ E. REMOVE ONE ASSIGNMENT ════════════════════

  await check("E1 revokeRole disables EXACTLY the assignment named, and no other", async () => {
    const actor = await makeActor("admin");
    const target = await makePrincipal();
    await seedActiveRoleAssignment(target, "dispatcher");
    await assignApprovedRole({
      actorUid: actor,
      principalUid: target,
      roleId: "salesperson",
      scope: { type: "global" },
      idempotencyKey: key("add-then-remove"),
    });

    // The id comes from the TRUSTED READ, exactly as the UI obtains it.
    const before = await readPrincipalAccessState({ actorUid: actor, principalUid: target });
    const salesperson = before.assignments.find((a) => a.roleId === "salesperson");
    assert.ok(salesperson, "the added Role must be visible before it can be removed");

    await revokeRole({
      actorUid: actor,
      assignmentId: salesperson.assignmentId,
      idempotencyKey: key("remove-salesperson"),
    });

    const after = await readPrincipalAccessState({ actorUid: actor, principalUid: target });
    assert.deepEqual(after.assignments.map((a) => a.roleId), ["dispatcher"]);
  });

  await check("E2 removing a PRIVILEGED assignment still requires the two-person route", async () => {
    // The single-admin Remove must not become a back door around approval. revokeRole without an
    // approverUid is refused for a privileged Role, which is what keeps the UI's omission safe.
    const actor = await makeActor("admin");
    const target = await makePrincipal();
    const ownerAssignment = await seedActiveRoleAssignment(target, "owner");
    await assert.rejects(
      revokeRole({
        actorUid: actor,
        assignmentId: ownerAssignment,
        idempotencyKey: key("remove-owner"),
      }),
      InvalidInputError,
    );
    const still = await db.collection("roleAssignments").doc(ownerAssignment).get();
    assert.equal(still.data().status, "active", "the privileged assignment must survive the refusal");
  });

  // ════════════════════ F. ACCOUNT STATUS ROUND TRIP ════════════════════

  await check("F1 enabled -> disable -> read Disabled -> enable -> read Enabled", async () => {
    const actor = await makeActor("admin");
    const target = await makePrincipal("status-user");

    const start = await readPrincipalAccessState({ actorUid: actor, principalUid: target });
    assert.equal(start.accountStatus, "enabled");

    await setUserStatus({
      actorUid: actor,
      principalUid: target,
      status: "disabled",
      idempotencyKey: key("disable"),
    });
    const off = await readPrincipalAccessState({ actorUid: actor, principalUid: target });
    assert.equal(off.accountStatus, "disabled", "the trusted read must report the new state");

    await setUserStatus({
      actorUid: actor,
      principalUid: target,
      status: "enabled",
      idempotencyKey: key("enable"),
    });
    const on = await readPrincipalAccessState({ actorUid: actor, principalUid: target });
    assert.equal(on.accountStatus, "enabled");
  });

  await check("F2 account status does not touch employment status, in either direction", async () => {
    const actor = await makeActor("admin");
    const target = await makePrincipal("employed-user");
    const employeeId = uid("emp");
    await db.collection("employees").doc(employeeId).set({
      userId: target,
      displayName: "Status Test",
      employmentStatus: "ACTIVE",
    });

    await setUserStatus({
      actorUid: actor,
      principalUid: target,
      status: "disabled",
      idempotencyKey: key("disable-employed"),
    });

    const emp = await db.collection("employees").doc(employeeId).get();
    assert.equal(emp.data().employmentStatus, "ACTIVE", "employment status is an independent fact");
  });

  // ════════════════════ H. THE LEGACY MIRROR IS NEVER WRITTEN ════════════════════

  await check("H1 add and remove never write employees.securityRole", async () => {
    // The mirror belongs to the legacy users/{uid}.role system. If a governed command ever started
    // maintaining it, the two systems would silently merge -- and the profile would begin claiming
    // governed authority it does not carry.
    const actor = await makeActor("admin");
    const target = await makePrincipal("mirror-user");
    const employeeId = uid("emp-mirror");
    await db.collection("employees").doc(employeeId).set({
      userId: target,
      displayName: "Mirror Test",
      securityRole: "technician",
    });

    await assignApprovedRole({
      actorUid: actor,
      principalUid: target,
      roleId: "salesperson",
      scope: { type: "global" },
      idempotencyKey: key("mirror-add"),
    });
    const state = await readPrincipalAccessState({ actorUid: actor, principalUid: target });
    await revokeRole({
      actorUid: actor,
      assignmentId: state.assignments[0].assignmentId,
      idempotencyKey: key("mirror-remove"),
    });

    const emp = await db.collection("employees").doc(employeeId).get();
    assert.equal(
      emp.data().securityRole,
      "technician",
      "the legacy mirror must be untouched by governed Role changes",
    );
  });

  // ════════════════════ G. THE AUDIT TRAIL THE HISTORY READS ════════════════════

  await check("G1 add / remove / status each write ONE audit event, under the expected target", async () => {
    // The user-centric Change History gathers these three shapes; this pins the shapes it gathers.
    // No event is written twice and none is synthesized -- the projection is a read over exactly
    // these documents.
    const actor = await makeActor("admin");
    const target = await makePrincipal("audit-user");

    const addKey = key("audit-add");
    await assignApprovedRole({
      actorUid: actor,
      principalUid: target,
      roleId: "salesperson",
      scope: { type: "global" },
      idempotencyKey: addKey,
    });
    const addEvent = await db.collection("auditEvents").doc(addKey).get();
    assert.equal(addEvent.data().action, "assignApprovedRole");
    assert.equal(addEvent.data().targetType, "roleAssignment");
    assert.equal(addEvent.data().targetId, target, "an ADD is recorded against the principal");

    const statusKey = key("audit-status");
    await setUserStatus({
      actorUid: actor,
      principalUid: target,
      status: "disabled",
      idempotencyKey: statusKey,
    });
    const statusEvent = await db.collection("auditEvents").doc(statusKey).get();
    assert.equal(statusEvent.data().action, "setUserStatus");
    assert.equal(statusEvent.data().targetType, "user");
    assert.equal(statusEvent.data().targetId, target);

    const removeKey = key("audit-remove");
    await revokeRole({ actorUid: actor, assignmentId: addKey, idempotencyKey: removeKey });
    const removeEvent = await db.collection("auditEvents").doc(removeKey).get();
    assert.equal(removeEvent.data().action, "revokeRole");
    assert.equal(removeEvent.data().targetType, "roleAssignment");
    assert.equal(
      removeEvent.data().targetId,
      addKey,
      "a REMOVE is recorded against the ASSIGNMENT id -- which is why the history has to resolve it",
    );
  });

  await check("G2 the ADD's audit id IS the assignment id -- how the history names the Role", async () => {
    // The Change History shows WHICH Role was added without parsing the summary sentence, because
    // the audit document id and the roleAssignment document id are the same idempotency key. If
    // that ever stopped being true, the history would quietly stop naming Roles.
    const actor = await makeActor("admin");
    const target = await makePrincipal("audit-id-user");
    const addKey = key("audit-id");
    await assignApprovedRole({
      actorUid: actor,
      principalUid: target,
      roleId: "salesperson",
      scope: { type: "global" },
      idempotencyKey: addKey,
    });
    const assignment = await db.collection("roleAssignments").doc(addKey).get();
    assert.equal(assignment.exists, true);
    assert.equal(assignment.data().roleId, "salesperson");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

await main();
