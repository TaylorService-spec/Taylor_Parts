// Inventory Operational Queue A0 (docs/specifications/inventory-operational-
// queue.md; docs/implementation-plans/inventory-operational-queue.md), PR
// #164 Final Review correction: Case D (UPDATE_SECURITY_ROLE)'s transaction
// must re-read BOTH employees/{employeeId} and users/{uid} and validate the
// reciprocal link (employee.userId === plan.userId AND user.employeeId ===
// plan.employeeId) before writing either document -- the same guard
// GRANT_ACCESS already has. buildPlan()'s pure plan-shape logic has its own
// separate node:test unit tests (provisionEmployeeAccessSecurityRole.test.js,
// unchanged by this correction); this file exercises applyPlan()'s actual
// Firestore transaction against a live emulator -- the behavioral coverage
// the prior REQUEST CHANGES round found missing (missing User document,
// reciprocal-link mismatch, concurrent relink/atomic abort).
//
// Prerequisite: run against a live Firestore emulator, e.g.:
//   firebase emulators:start --only firestore,auth --project taylor-parts
// then, in a second terminal:
//   node functions/test/provisionEmployeeAccessCaseDTransaction.test.js
//
// Read/write only against the emulator (FIRESTORE_EMULATOR_HOST below) --
// never touches the live "taylor-parts" project.
//
// Isolation note: this file seeds a document under employees/cd-emp-missing-
// user with a userId that has no matching users/{uid} document -- a
// deliberate broken link, fixture-scoped to this file only. auditSecurity-
// RoleMirror.test.js scans the WHOLE employees collection, so running both
// files back-to-back in the same emulator session without clearing data
// between them will make that file's exact-finding-count assertions fail on
// this file's leftover fixture (confirmed while writing this file -- not a
// real regression, just cross-file fixture pollution). Clear emulator data
// between test files if running more than one in the same session, e.g.:
//   curl -X DELETE "http://127.0.0.1:8080/emulator/v1/projects/taylor-parts/databases/(default)/documents"
"use strict";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";

const admin = require("firebase-admin");
const { applyPlan, EMPLOYEES_COLLECTION, USERS_COLLECTION } = require("../scripts/provisionEmployeeAccess.js");

const PROJECT_ID = "taylor-parts";

admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

let passed = 0;
let failed = 0;

function report(name, ok, detail) {
  if (ok) {
    passed += 1;
    console.log(`PASS -- ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL -- ${name}${detail ? ` -- ${detail}` : ""}`);
  }
}

function updateSecurityRolePlan({ employeeId, userId, role }) {
  return {
    operation: "UPDATE_SECURITY_ROLE",
    employeeId,
    userId,
    userUpdates: { role },
    employeeUpdates: { securityRole: role },
  };
}

async function main() {
  // --- Case 1: happy path, reciprocal link intact on both sides ---
  await db.doc(`${EMPLOYEES_COLLECTION}/cd-emp-happy`).set({
    employeeId: "cd-emp-happy",
    userId: "cd-user-happy",
    securityRole: "technician",
    employmentStatus: "ACTIVE",
    operationalRoles: [],
  });
  await db.doc(`${USERS_COLLECTION}/cd-user-happy`).set({
    employeeId: "cd-emp-happy",
    role: "technician",
  });

  await applyPlan(db, null, updateSecurityRolePlan({ employeeId: "cd-emp-happy", userId: "cd-user-happy", role: "dispatcher" }));

  const happyEmp = await db.doc(`${EMPLOYEES_COLLECTION}/cd-emp-happy`).get();
  const happyUser = await db.doc(`${USERS_COLLECTION}/cd-user-happy`).get();
  report(
    "Happy path: both sides write when the reciprocal link holds",
    happyEmp.data().securityRole === "dispatcher" && happyUser.data().role === "dispatcher"
  );

  // --- Case 2: missing User document -- users/{uid} does not exist at all ---
  await db.doc(`${EMPLOYEES_COLLECTION}/cd-emp-missing-user`).set({
    employeeId: "cd-emp-missing-user",
    userId: "cd-user-does-not-exist",
    securityRole: "technician",
    employmentStatus: "ACTIVE",
    operationalRoles: [],
  });
  // Deliberately no users/cd-user-does-not-exist document created.

  let missingUserThrew = false;
  let missingUserMessage = "";
  try {
    await applyPlan(
      db,
      null,
      updateSecurityRolePlan({ employeeId: "cd-emp-missing-user", userId: "cd-user-does-not-exist", role: "dispatcher" })
    );
  } catch (err) {
    missingUserThrew = true;
    missingUserMessage = err.message;
  }
  report(
    "Missing User document: transaction throws and aborts with no writes",
    missingUserThrew && /no longer exists/.test(missingUserMessage),
    missingUserMessage
  );
  const empAfterMissingUser = await db.doc(`${EMPLOYEES_COLLECTION}/cd-emp-missing-user`).get();
  report(
    "Missing User document: Employee's securityRole is left untouched (no partial write)",
    empAfterMissingUser.data().securityRole === "technician"
  );

  // --- Case 3: reciprocal-link mismatch -- User exists but points at a
  // DIFFERENT Employee than the plan expects (a concurrent relink) ---
  await db.doc(`${EMPLOYEES_COLLECTION}/cd-emp-mismatch`).set({
    employeeId: "cd-emp-mismatch",
    userId: "cd-user-mismatch",
    securityRole: "technician",
    employmentStatus: "ACTIVE",
    operationalRoles: [],
  });
  await db.doc(`${USERS_COLLECTION}/cd-user-mismatch`).set({
    employeeId: "cd-emp-SOME-OTHER-EMPLOYEE",
    role: "technician",
  });

  let mismatchThrew = false;
  let mismatchMessage = "";
  try {
    await applyPlan(db, null, updateSecurityRolePlan({ employeeId: "cd-emp-mismatch", userId: "cd-user-mismatch", role: "dispatcher" }));
  } catch (err) {
    mismatchThrew = true;
    mismatchMessage = err.message;
  }
  report(
    "Reciprocal-link mismatch: transaction throws and aborts with no writes",
    mismatchThrew && /no longer linked to/.test(mismatchMessage),
    mismatchMessage
  );
  const empAfterMismatch = await db.doc(`${EMPLOYEES_COLLECTION}/cd-emp-mismatch`).get();
  const userAfterMismatch = await db.doc(`${USERS_COLLECTION}/cd-user-mismatch`).get();
  report(
    "Reciprocal-link mismatch: neither Employee nor User is written",
    empAfterMismatch.data().securityRole === "technician" && userAfterMismatch.data().role === "technician"
  );

  // --- Case 4: concurrent relink -- Employee's own userId changed to a
  // DIFFERENT user between phase B's read and applyPlan()'s transaction
  // (the pre-existing Employee-side guard; re-asserted here alongside the
  // new User-side guard to confirm both fire independently) ---
  await db.doc(`${EMPLOYEES_COLLECTION}/cd-emp-relinked`).set({
    employeeId: "cd-emp-relinked",
    userId: "cd-user-relinked-NEW",
    securityRole: "technician",
    employmentStatus: "ACTIVE",
    operationalRoles: [],
  });
  await db.doc(`${USERS_COLLECTION}/cd-user-relinked-NEW`).set({
    employeeId: "cd-emp-relinked",
    role: "technician",
  });

  // Plan was built against the OLD userId (as if read in phase B before the
  // concurrent relink above landed).
  let relinkThrew = false;
  let relinkMessage = "";
  try {
    await applyPlan(
      db,
      null,
      updateSecurityRolePlan({ employeeId: "cd-emp-relinked", userId: "cd-user-relinked-OLD", role: "dispatcher" })
    );
  } catch (err) {
    relinkThrew = true;
    relinkMessage = err.message;
  }
  report(
    "Concurrent relink (Employee-side): transaction throws and aborts atomically -- no partial write",
    relinkThrew && /no longer linked to/.test(relinkMessage),
    relinkMessage
  );
  const empAfterRelink = await db.doc(`${EMPLOYEES_COLLECTION}/cd-emp-relinked`).get();
  const userAfterRelink = await db.doc(`${USERS_COLLECTION}/cd-user-relinked-NEW`).get();
  report(
    "Concurrent relink (Employee-side): the real linked User's role is never touched by the stale plan",
    empAfterRelink.data().securityRole === "technician" && userAfterRelink.data().role === "technician"
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error("Test run failed:", err);
  process.exitCode = 1;
});
