// Read-only post-execution verification for the onboard-employee skill
// (.claude/skills/onboard-employee/SKILL.md). Makes zero mutations --
// every call in this file is a Firestore/Auth read. Exists to check,
// after functions/scripts/provisionEmployeeAccess.js has actually run,
// that each entry landed exactly as authorized: correct Employee
// state, correct bidirectional Employee<->User link (or correctly NO
// link for an Employee-only entry), correct securityRole and
// operationalRoles.
//
// Usage (from functions/):
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json node scripts/onboardEmployeeVerify.js \
//     --projectId taylor-parts --confirmProduction taylor-parts \
//     --plan path/to/onboarding-plan.json
//
// --plan is the same JSON array shape used by onboardEmployeePreflight.js,
// but every field the operator authorized matters here (not just
// employeeId/email):
//   [
//     {
//       "employeeId": "emp-x",
//       "linked": true,
//       "email": "x@example.com",         // used only to resolve the expected uid via getUserByEmail -- never printed
//       "securityRole": "dispatcher",
//       "operationalRoles": ["PARTS_ASSOCIATE"]
//     },
//     {
//       "employeeId": "emp-y",
//       "linked": false                    // Employee-only -- expects userId null, no users/ doc
//     }
//   ]
//
// Output is PASS/FAIL per employeeId plus, on FAIL only, the specific
// field(s) that mismatched -- never a raw uid unless a mismatch
// specifically requires naming which account was found instead of the
// expected one. No password, token, email-content, or other secret is
// ever printed -- these calls only ever return Firestore document data
// and Auth account metadata (uid, existence), and this script's own
// console output additionally never echoes the --plan file's email
// field back out.
const fs = require("fs");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");

const {
  assertProjectTarget,
  VALID_OPERATIONAL_ROLES,
  VALID_SECURITY_ROLES,
} = require("./provisionEmployeeAccess.js");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : "true";
      args[key] = value;
      if (value !== "true") i += 1;
    }
  }
  return args;
}

function arraysEqualAsSets(a, b) {
  const setA = new Set(a ?? []);
  const setB = new Set(b ?? []);
  if (setA.size !== setB.size) return false;
  for (const v of setA) if (!setB.has(v)) return false;
  return true;
}

function validatePlan(plan) {
  if (!Array.isArray(plan) || plan.length === 0) {
    throw new Error("Verification plan must be a non-empty array.");
  }

  const employeeIds = new Set();
  for (const [index, entry] of plan.entries()) {
    const label = `Verification plan entry ${index + 1}`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`${label} must be an object.`);
    }
    if (typeof entry.employeeId !== "string" || entry.employeeId.trim() === "") {
      throw new Error(`${label}.employeeId must be a non-empty string.`);
    }
    if (employeeIds.has(entry.employeeId)) {
      throw new Error(`${label}.employeeId duplicates "${entry.employeeId}".`);
    }
    employeeIds.add(entry.employeeId);

    if (typeof entry.linked !== "boolean") {
      throw new Error(`${label}.linked must be explicitly true or false.`);
    }
    if (!Array.isArray(entry.operationalRoles ?? [])) {
      throw new Error(`${label}.operationalRoles must be an array when provided.`);
    }
    for (const role of entry.operationalRoles ?? []) {
      if (!VALID_OPERATIONAL_ROLES.includes(role)) {
        throw new Error(`${label}.operationalRoles contains invalid role "${role}".`);
      }
    }

    if (entry.linked) {
      if (typeof entry.email !== "string" || entry.email.trim() === "") {
        throw new Error(`${label}.email must be a non-empty string for a linked entry.`);
      }
      if (!VALID_SECURITY_ROLES.includes(entry.securityRole)) {
        throw new Error(`${label}.securityRole must be one of: ${VALID_SECURITY_ROLES.join(", ")}.`);
      }
    } else if (Object.prototype.hasOwnProperty.call(entry, "email") ||
               Object.prototype.hasOwnProperty.call(entry, "securityRole")) {
      throw new Error(`${label} is Employee-only and must not carry email or securityRole.`);
    }
  }

  return plan;
}

async function verifyEntry(db, auth, entry) {
  const employeeSnap = await db.collection("employees").doc(entry.employeeId).get();
  if (!employeeSnap.exists) {
    return { pass: false, reason: "employees/{employeeId} does not exist." };
  }
  const employee = employeeSnap.data();
  const failures = [];

  if (employee.employmentStatus !== "ACTIVE") {
    failures.push(`employmentStatus is "${employee.employmentStatus}", expected ACTIVE.`);
  }

  if (entry.linked === false) {
    if (employee.userId !== null) {
      failures.push("expected userId: null for an Employee-only entry, but a userId is set.");
    }
    const expectedOperationalRoles = entry.operationalRoles ?? [];
    if (!arraysEqualAsSets(employee.operationalRoles, expectedOperationalRoles)) {
      failures.push(`operationalRoles [${(employee.operationalRoles ?? []).join(", ")}] does not match expected [${expectedOperationalRoles.join(", ")}].`);
    }
    const linkedUsersSnap = await db.collection("users")
      .where("employeeId", "==", entry.employeeId)
      .get();
    if (!linkedUsersSnap.empty) {
      failures.push("expected no users document to reference this Employee, but at least one was found.");
    }
    return failures.length ? { pass: false, reason: failures.join(" ") } : { pass: true };
  }

  // Linked entry -- resolve the expected uid from the plan's email,
  // read-only, same as provisionEmployeeAccess.js's own phase B.
  const targetAuthUser = await auth.getUserByEmail(entry.email).catch((err) => {
    if (err.code === "auth/user-not-found") return null;
    throw err;
  });
  if (!targetAuthUser) {
    failures.push("no Auth account found for the plan's email -- cannot verify linkage.");
    return { pass: false, reason: failures.join(" ") };
  }

  if (employee.userId !== targetAuthUser.uid) {
    failures.push(`employees/{employeeId}.userId does not match the expected account (found a different or missing uid).`);
  }

  const userSnap = await db.collection("users").doc(targetAuthUser.uid).get();
  if (!userSnap.exists) {
    failures.push("users/{uid} document does not exist.");
  } else {
    const user = userSnap.data();
    if (user.employeeId !== entry.employeeId) {
      failures.push(`users/{uid}.employeeId does not point back to ${entry.employeeId}.`);
    }
    if (user.role !== entry.securityRole) {
      failures.push(`users/{uid}.role is "${user.role}", expected "${entry.securityRole}".`);
    }
  }

  const expectedOperationalRoles = entry.operationalRoles ?? [];
  if (!arraysEqualAsSets(employee.operationalRoles, expectedOperationalRoles)) {
    failures.push(`operationalRoles [${(employee.operationalRoles ?? []).join(", ")}] does not match expected [${expectedOperationalRoles.join(", ")}].`);
  }

  return failures.length ? { pass: false, reason: failures.join(" ") } : { pass: true };
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

  if (!args.plan) {
    console.error("Usage: node scripts/onboardEmployeeVerify.js --projectId <id> [--confirmProduction taylor-parts] --plan <path-to-plan.json>");
    process.exitCode = 1;
    return;
  }

  let plan;
  try {
    plan = JSON.parse(fs.readFileSync(args.plan, "utf8"));
    validatePlan(plan);
  } catch (err) {
    console.error(`Failed to read/validate --plan file: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  initializeApp({ projectId });
  const db = getFirestore();
  const auth = getAuth();

  let allPass = true;
  for (const entry of plan) {
    const result = await verifyEntry(db, auth, entry);
    if (result.pass) {
      console.log(`PASS: ${entry.employeeId}`);
    } else {
      allPass = false;
      console.log(`FAIL: ${entry.employeeId} -- ${result.reason}`);
    }
  }

  process.exitCode = allPass ? 0 : 1;
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Failed:", err.message);
    process.exitCode = 1;
  });
}

module.exports = { verifyEntry, arraysEqualAsSets, validatePlan };
