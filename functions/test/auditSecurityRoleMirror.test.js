// Inventory Operational Queue A0 (docs/specifications/inventory-operational-
// queue.md; docs/implementation-plans/inventory-operational-queue.md).
// Emulator-fixture test for scripts/auditSecurityRoleMirror.js's run() --
// same standalone-script-against-a-live-emulator convention as
// employeesRules.test.js/reorderRequestsRules.test.js (firebase-admin only,
// no test framework, no @firebase/rules-unit-testing), since this script's
// I/O (two-collection read, conditional write) is exactly what those files
// already established a pattern for. buildPlan()'s pure securityRole-mirror
// logic has its own separate node:test unit tests
// (provisionEmployeeAccessSecurityRole.test.js) -- this file exercises the
// actual Firestore reads/writes findDrift()'s pure logic is fed by, not the
// comparison logic itself again.
//
// Prerequisite: run against a live Firestore emulator, e.g.:
//   firebase emulators:start --only firestore,auth --project taylor-parts
// then, in a second terminal:
//   node functions/test/auditSecurityRoleMirror.test.js
//
// Read/write only against the emulator (FIRESTORE_EMULATOR_HOST below) --
// never touches the live "taylor-parts" project.
"use strict";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";

const admin = require("firebase-admin");
const { run } = require("../scripts/auditSecurityRoleMirror.js");

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

async function seedFixtures() {
  // (a) Correct: securityRole already agrees with the linked user's role.
  await db.doc("users/audit-user-correct").set({ role: "dispatcher" });
  await db.doc("employees/audit-emp-correct").set({
    employeeId: "audit-emp-correct",
    displayName: "Correct Mirror",
    userId: "audit-user-correct",
    securityRole: "dispatcher",
    employmentStatus: "ACTIVE",
    operationalRoles: [],
  });

  // (b) Missing: securityRole field genuinely absent -- the pre-A0 legacy
  // shape every Employee document had before this sprint.
  await db.doc("users/audit-user-missing").set({ role: "admin" });
  await db.doc("employees/audit-emp-missing").set({
    employeeId: "audit-emp-missing",
    displayName: "Missing Mirror",
    userId: "audit-user-missing",
    employmentStatus: "ACTIVE",
    operationalRoles: [],
    // securityRole deliberately omitted entirely.
  });

  // (c) Mismatched: securityRole is present but disagrees with the real
  // users/{uid}.role -- the exact case a client-side picker can never
  // detect on its own (no read access to another user's users/{uid}).
  await db.doc("users/audit-user-mismatched").set({ role: "technician" });
  await db.doc("employees/audit-emp-mismatched").set({
    employeeId: "audit-emp-mismatched",
    displayName: "Mismatched Mirror",
    userId: "audit-user-mismatched",
    securityRole: "dispatcher",
    employmentStatus: "ACTIVE",
    operationalRoles: [],
  });

  // Unlinked Employee (no userId) -- must never appear in findings; there
  // is nothing to mirror yet.
  await db.doc("employees/audit-emp-unlinked").set({
    employeeId: "audit-emp-unlinked",
    displayName: "No Access Yet",
    userId: null,
    employmentStatus: "ACTIVE",
    operationalRoles: [],
  });
}

async function main() {
  await seedFixtures();

  // --- Read-only pass: all three drift cases correctly identified ---
  const { findings: readOnlyFindings, repaired: readOnlyRepaired } = await run(db, { repair: false });

  const correctFinding = readOnlyFindings.find((f) => f.employeeId === "audit-emp-correct");
  report("Correct entry (audit-emp-correct) produces no finding", correctFinding === undefined);

  const missingFinding = readOnlyFindings.find((f) => f.employeeId === "audit-emp-missing");
  report(
    "Missing entry (audit-emp-missing) is reported with status 'missing' and the expected after-value",
    !!missingFinding && missingFinding.status === "missing" && missingFinding.before === null && missingFinding.after === "admin",
    JSON.stringify(missingFinding)
  );

  const mismatchedFinding = readOnlyFindings.find((f) => f.employeeId === "audit-emp-mismatched");
  report(
    "Mismatched entry (audit-emp-mismatched) is reported with status 'mismatched' and the expected before/after values",
    !!mismatchedFinding &&
      mismatchedFinding.status === "mismatched" &&
      mismatchedFinding.before === "dispatcher" &&
      mismatchedFinding.after === "technician",
    JSON.stringify(mismatchedFinding)
  );

  const unlinkedFinding = readOnlyFindings.find((f) => f.employeeId === "audit-emp-unlinked");
  report("Unlinked entry (no userId) never appears in findings", unlinkedFinding === undefined);

  report("Read-only pass performs zero repairs", readOnlyRepaired === 0);

  const stillMissing = await db.doc("employees/audit-emp-missing").get();
  report(
    "Read-only pass writes nothing -- audit-emp-missing still has no securityRole field",
    !("securityRole" in stillMissing.data())
  );
  const stillMismatched = await db.doc("employees/audit-emp-mismatched").get();
  report(
    "Read-only pass writes nothing -- audit-emp-mismatched's securityRole is unchanged",
    stillMismatched.data().securityRole === "dispatcher"
  );

  // --- Repair pass: both drifted entries corrected, in place ---
  const { findings: repairFindings, repaired } = await run(db, { repair: true });
  report("Repair pass reports the same two findings as the read-only pass", repairFindings.length === 2, `found ${repairFindings.length}`);
  report("Repair pass repairs exactly 2 entries", repaired === 2, `repaired ${repaired}`);

  const repairedMissing = await db.doc("employees/audit-emp-missing").get();
  report(
    "After repair, audit-emp-missing.securityRole now matches its linked user's real role",
    repairedMissing.data().securityRole === "admin"
  );
  const repairedMismatched = await db.doc("employees/audit-emp-mismatched").get();
  report(
    "After repair, audit-emp-mismatched.securityRole now matches its linked user's real role",
    repairedMismatched.data().securityRole === "technician"
  );

  // --- Re-verification: a second read-only pass after repair reports zero drift ---
  const { findings: postRepairFindings } = await run(db, { repair: false });
  report(
    "A fresh read-only pass after repair reports zero drift (excluding the untouched, still-correct fixture)",
    postRepairFindings.length === 0,
    JSON.stringify(postRepairFindings)
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error("Test run failed:", err);
  process.exitCode = 1;
});
