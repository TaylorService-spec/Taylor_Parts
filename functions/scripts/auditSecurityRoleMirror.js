// Inventory Operational Queue A0 (docs/specifications/inventory-operational-
// queue.md; docs/implementation-plans/inventory-operational-queue.md).
// Drift-detection/repair tool for employees/{employeeId}.securityRole, the
// denormalized mirror of users/{uid}.role written exclusively by
// provisionEmployeeAccess.js (see that file's "SECURITY-ROLE MIRROR" comment
// for the full invariant this script verifies -- both documents are always
// meant to be written together, by that script alone).
//
// Why this must be Admin SDK, not a client tool: comparing
// employees/{employeeId}.securityRole against the linked users/{uid}.role
// requires reading OTHER users' users/{uid} documents, which
// firestore.rules denies unconditionally to every client (self-read-only,
// no admin exception -- confirmed directly against the rules file during
// this initiative's Specification stage). This is precisely why the client-
// side assignment picker can only ever detect a MISSING/null/invalid-enum
// securityRole (readable on the Employee document it already has) and can
// NEVER detect a valid-but-wrong mirror -- only this script, with real
// Admin SDK credentials, can compare both sides.
//
// Read-only by default -- reports drift, writes nothing. --repair
// additionally corrects every drifted/missing entry by writing the exact
// users/{uid}.role value onto the matching Employee's securityRole field --
// the same field/value shape provisionEmployeeAccess.js's own
// UPDATE_SECURITY_ROLE case writes, just applied here to backfill/correct
// existing documents rather than a single just-provisioned one.
//
// AUDIT OUTPUT IS DELIBERATELY MINIMAL: exact employeeId, linked userId, and
// before/after securityRole values only ("audit exact document IDs/results
// without exposing unnecessary user data," per the approved Specification).
// No other field of either document (displayName, email, operationalRoles,
// employmentStatus, etc.) is read, logged, or exported by this script -- it
// exists to verify one specific invariant, not to dump personnel data.
//
// PROJECT TARGET: same --projectId/--confirmProduction contract as
// provisionEmployeeAccess.js (reused directly, not re-implemented) -- no
// default target, production requires an explicit, matching
// --confirmProduction flag. See that file's own header comment for the full
// rationale; not re-explained here.
//
// RE-VERIFICATION CADENCE (docs/specifications/inventory-operational-queue.md's
// "Open questions"): this script must be re-run, read-only, every time
// provisionEmployeeAccess.js (or any future writer inheriting its
// securityRole-mirror invariant) runs against production -- i.e. on every
// role-provisioning event, not on an arbitrary schedule. Whether that
// becomes a manual habit or an automated hook is an Implementation Plan-
// level detail, not fixed by this script itself.
//
// A live-project run is NOT authorized by this script's existence, by any
// PR merging it, or by any code review alone -- running this against
// production (read-only OR --repair) is a separately, explicitly
// project-owner-authorized operational step, gated by --confirmProduction
// as described above. --repair specifically requires the Owner's Production
// Data Authorization, per this project's standing discipline for any
// production write.
//
// Run:
//   cd functions
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json node scripts/auditSecurityRoleMirror.js \
//     --projectId taylor-parts --confirmProduction taylor-parts [--repair]
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { assertProjectTarget } = require("./provisionEmployeeAccess.js");

const EMPLOYEES_COLLECTION = "employees";
const USERS_COLLECTION = "users";

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

// ---------------------------------------------------------------
// Pure -- given linked-userId Employee summaries and a uid->role map,
// returns exactly the findings this script reports/repairs. No I/O, no
// other document field read or referenced -- exactly the minimal shape
// the approved Specification requires this script's output to be.
// ---------------------------------------------------------------
function findDrift(employees, roleByUserId) {
  const findings = [];
  for (const employee of employees) {
    if (!employee.userId) continue; // no linked user -- nothing to mirror yet, not drift
    const actualRole = roleByUserId.has(employee.userId) ? (roleByUserId.get(employee.userId) ?? null) : null;
    const storedSecurityRole = employee.securityRole; // undefined if the field is genuinely absent (pre-A0 legacy document)
    const mirrored = storedSecurityRole ?? null;
    if (mirrored === actualRole) continue;
    findings.push({
      employeeId: employee.employeeId,
      userId: employee.userId,
      before: mirrored,
      after: actualRole,
      // "missing" -- the field is absent or explicitly null (nothing to
      // disagree with, just nothing recorded yet). "mismatched" -- a real,
      // present value that disagrees with the actual users/{uid}.role --
      // the case a client can never detect on its own (see header comment).
      status: storedSecurityRole === undefined || storedSecurityRole === null ? "missing" : "mismatched",
    });
  }
  return findings;
}

// ---------------------------------------------------------------
// I/O: reads every employees/{employeeId} with a non-null userId, reads
// each linked users/{uid}.role (and nothing else from either document),
// reports findDrift()'s output, and -- only when repair is true -- writes
// the corrected securityRole onto each drifted/missing Employee document.
// ---------------------------------------------------------------
async function run(db, { repair }) {
  const employeesSnap = await db.collection(EMPLOYEES_COLLECTION).get();
  const employees = employeesSnap.docs
    .map((d) => ({ employeeId: d.id, userId: d.data().userId ?? null, securityRole: d.data().securityRole }))
    .filter((e) => e.userId);

  const roleByUserId = new Map();
  await Promise.all(
    employees.map(async (e) => {
      const userSnap = await db.collection(USERS_COLLECTION).doc(e.userId).get();
      roleByUserId.set(e.userId, userSnap.exists ? (userSnap.data().role ?? null) : null);
    })
  );

  const findings = findDrift(employees, roleByUserId);

  if (findings.length === 0) {
    console.log(`OK: zero drift across ${employees.length} linked Employee document(s).`);
    return { findings, repaired: 0 };
  }

  console.log(`Found ${findings.length} drifted/missing securityRole entr${findings.length === 1 ? "y" : "ies"}:`);
  for (const f of findings) {
    console.log(
      `  employees/${f.employeeId} (userId ${f.userId}): securityRole ${JSON.stringify(f.before)} -> expected ${JSON.stringify(f.after)} [${f.status}]`
    );
  }

  if (!repair) {
    console.log("\nRead-only pass -- no writes performed. Re-run with --repair (under Owner Production Data Authorization) to correct.");
    return { findings, repaired: 0 };
  }

  for (const f of findings) {
    await db.collection(EMPLOYEES_COLLECTION).doc(f.employeeId).set({ securityRole: f.after }, { merge: true });
  }
  console.log(`\nRepaired ${findings.length} entr${findings.length === 1 ? "y" : "ies"}.`);
  return { findings, repaired: findings.length };
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

  initializeApp({ projectId });
  const db = getFirestore();
  const { findings } = await run(db, { repair: args.repair === "true" });

  // Non-zero exit on detected-but-unrepaired drift -- makes a read-only
  // pass usable as a scriptable re-verification check (per the
  // re-verification cadence documented above), not just a human-read log.
  if (findings.length > 0 && args.repair !== "true") {
    process.exitCode = 1;
  }
}

// CommonJS "run only when executed directly" guard -- same require.main
// === module pattern provisionEmployeeAccess.js already uses, for the
// identical reason documented there (a require()-ing caller, e.g. this
// script's own tests, must never trigger main() against its own argv).
if (require.main === module) {
  main().catch((err) => {
    console.error("Failed:", err.message);
    process.exitCode = 1;
  });
}

module.exports = { findDrift, run, parseArgs };
