// Read-only preflight for the onboard-employee skill
// (.claude/skills/onboard-employee/SKILL.md). Makes zero Firestore or
// Auth mutations -- getUserByEmail() never creates, and this script
// calls nothing else. Exists to give an early, non-mutating signal
// before running functions/scripts/provisionEmployeeAccess.js for
// real; it does NOT replace that script's own --requireExistingAuthUser
// guard (PR #114), which remains the actual enforcement point.
//
// Usage (from functions/):
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json node scripts/onboardEmployeePreflight.js \
//     --projectId taylor-parts --confirmProduction taylor-parts \
//     --plan path/to/onboarding-plan.json
// (or `gcloud auth application-default login` first, then omit the env var.)
//
// --plan points at a JSON file (not committed, not printed in full --
// see below) shaped as an array of entries:
//   [
//     { "employeeId": "emp-x", "email": "x@example.com" },   // linked
//     { "employeeId": "emp-y" }                                // Employee-only, no email
//   ]
// Only employeeId/email are read from each entry -- displayName,
// securityRole, operationalRoles are irrelevant to this read-only
// check and are ignored even if present.
//
// This script prints, per entry: employeeId, whether an Employee
// document already exists, and (for entries with an email) whether an
// existing Firebase Auth account was found -- FOUND or NOT FOUND, no
// uid, no email echoed back beyond what the operator already put in
// the plan file, no other account detail. Never prints a password,
// token, or credential of any kind -- there is nothing in this script
// that could produce one; getUserByEmail() returns account metadata
// only.
const fs = require("fs");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");

const {
  assertProjectTarget,
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
    console.error("Usage: node scripts/onboardEmployeePreflight.js --projectId <id> [--confirmProduction taylor-parts] --plan <path-to-plan.json>");
    process.exitCode = 1;
    return;
  }

  let plan;
  try {
    plan = JSON.parse(fs.readFileSync(args.plan, "utf8"));
  } catch (err) {
    console.error(`Failed to read/parse --plan file: ${err.message}`);
    process.exitCode = 1;
    return;
  }
  if (!Array.isArray(plan) || plan.length === 0) {
    console.error("--plan file must contain a non-empty JSON array of { employeeId, email? } entries.");
    process.exitCode = 1;
    return;
  }
  for (const entry of plan) {
    if (!entry.employeeId) {
      console.error("Every plan entry requires employeeId.");
      process.exitCode = 1;
      return;
    }
  }

  initializeApp({ projectId });
  const db = getFirestore();
  const auth = getAuth();

  let allOk = true;
  for (const entry of plan) {
    const employeeSnap = await db.collection("employees").doc(entry.employeeId).get();
    const employeeExists = employeeSnap.exists;

    let authStatus = "N/A (Employee-only, no email in plan)";
    if (entry.email) {
      const targetAuthUser = await auth.getUserByEmail(entry.email).catch((err) => {
        if (err.code === "auth/user-not-found") return null;
        throw err;
      });
      authStatus = targetAuthUser ? "FOUND" : "NOT FOUND";
      if (!targetAuthUser) allOk = false;
    }

    console.log(`${entry.employeeId}: Employee ${employeeExists ? "already exists" : "does not exist yet"} -- Auth account: ${authStatus}`);
  }

  if (!allOk) {
    console.error("\nOne or more linked entries have NO existing Auth account. Do not run provisionEmployeeAccess.js for those entries without resolving this first -- with --requireExistingAuthUser it will refuse them anyway (zero mutation), but this preflight exists to catch it before you even try.");
    process.exitCode = 1;
    return;
  }

  console.log("\nAll linked entries have an existing Auth account. Employee-only entries need no Auth check.");
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Failed:", err.message);
    process.exitCode = 1;
  });
}
