// Phase 3 -- Platform Assignment Foundation (docs/specifications/
// employee-foundation.md, docs/implementation-plans/employee-foundation.md
// PR 2). The only writer of employees/{employeeId}.userId and
// users/{uid}.employeeId -- the bidirectional Employee/User link.
//
// Why this MUST be Admin SDK, not a client function: firestore.rules'
// employees/{employeeId} rule denies all client create/update/delete
// unconditionally (no admin exception -- see PR 1, PR #82), and
// users/{userId} has denied all client writes since this project's
// earliest sprints ("Role docs are provisioned by an admin (console or
// Admin SDK), never by the client"). Same category of tool as PT-001's
// assignTechnicianToUser.js, generalized: that script links
// users/{uid}.technicianId one-way; this one links
// employees/{employeeId}.userId <-> users/{uid}.employeeId two-way, and
// also owns Employee record creation (assignTechnicianToUser.js never
// created a technician document, only linked to an existing one).
//
// Covers all four provisioning cases from the specification, via one
// idempotent "ensure" flow, not four separate scripts:
//   A. Create Employee without access       (no --email)
//   B. Grant application access               (--email, links/creates Auth user)
//   C. Update operationalRoles                (--operationalRoles, Employee-side only)
//   D. Update security role                    (--securityRole, users/{uid}-side only)
//
// --email is an EXECUTION INPUT ONLY. It is used to call
// getUserByEmail()/createUser() to locate or create the Firebase Auth
// account -- it is NEVER written to employees/{employeeId}. Firebase
// Authentication owns credential/account email; Employee owns
// workforce identity and never duplicates it (see the specification's
// "Design decision -- no email field on Employee").
//
// No companyId input -- per architecture review, a tenancy/security-
// relevant parameter must be fully implemented and enforced or
// entirely absent, never accepted-and-ignored. Not accepted here.
//
// Idempotent: re-running with identical inputs is a safe no-op repeat
// (matching values are not rewritten, no error). Re-running with a
// changed displayName/operationalRoles/securityRole updates exactly
// that field via merge:true, same discipline as
// assignTechnicianToUser.js.
//
// Conflict detection (fails loudly, writes nothing, rather than
// silently corrupting a link):
//   - employees/{employeeId} already linked to a DIFFERENT uid than
//     the one --email resolves to.
//   - The resolved uid's users/{uid}.employeeId already points to a
//     DIFFERENT employeeId than the one being provisioned.
//   - --securityRole given but the target employeeId has no linked
//     userId yet and no --email was given to establish one.
//
// Never prints, logs, or commits a stored/committed secret. A freshly
// generated temporary password is printed once, to the terminal only,
// for a newly created Auth account -- same one-time-only, not-
// persisted-anywhere pattern as the retired createPartsManagerTestUsers.js
// (see that file's own header comment; this script replaces it).
//
// Run locally, against the live project, per provisioning event:
//   cd functions
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json node scripts/provisionEmployeeAccess.js \
//     --employeeId emp-001 --displayName "Jane Doe" \
//     [--email jane@example.com] [--securityRole dispatcher] [--operationalRoles PARTS_ASSOCIATE,PARTS_MANAGER]
// (or `gcloud auth application-default login` first, then omit the
//  env var -- either way you need real credentials for "taylor-parts".)
//
// A live-project run is NOT authorized by this script's existence or
// by any code review alone -- per the specification's acceptance
// criteria, running this against production is a separately, explicitly
// project-owner-authorized operational step. This script itself has no
// safeguard against being pointed at "taylor-parts" (same as every
// other Admin SDK script in this repo) -- the authorization is a
// process discipline, not a code-level guard.
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");
const crypto = require("crypto");

const EMPLOYEES_COLLECTION = "employees";
const USERS_COLLECTION = "users";
const EMPLOYMENT_STATUS_ACTIVE = "ACTIVE";
const VALID_SECURITY_ROLES = ["admin", "dispatcher", "technician"];

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

function generatePassword() {
  return crypto.randomBytes(9).toString("base64").replace(/[+/=]/g, "x") + "!1";
}

async function ensureAuthUser(auth, email, displayName, password) {
  try {
    const existing = await auth.getUserByEmail(email);
    return { userRecord: existing, created: false };
  } catch (err) {
    if (err.code !== "auth/user-not-found") throw err;
    const created = await auth.createUser({ email, password, displayName });
    return { userRecord: created, created: true };
  }
}

async function provisionEmployeeAccess({ employeeId, displayName, email, securityRole, operationalRoles }) {
  if (!employeeId) {
    throw new Error("--employeeId is required.");
  }
  if (securityRole && !VALID_SECURITY_ROLES.includes(securityRole)) {
    throw new Error(`--securityRole must be one of: ${VALID_SECURITY_ROLES.join(", ")}.`);
  }

  const db = getFirestore();
  const auth = getAuth();
  const employeeRef = db.collection(EMPLOYEES_COLLECTION).doc(employeeId);
  const employeeSnap = await employeeRef.get();
  const now = Date.now();

  const parsedOperationalRoles = operationalRoles
    ? operationalRoles
        .split(",")
        .map((r) => r.trim())
        .filter(Boolean)
    : undefined;

  // --- A/C: Employee-side create-or-update (always runs; this is the
  // only writer of the Employee record's own fields). ---
  if (!employeeSnap.exists) {
    if (!displayName) {
      throw new Error(`employees/${employeeId} does not exist yet -- --displayName is required to create it.`);
    }
    await employeeRef.set({
      employeeId,
      displayName,
      firstName: null,
      lastName: null,
      employmentStatus: EMPLOYMENT_STATUS_ACTIVE,
      operationalRoles: parsedOperationalRoles ?? [],
      companyId: null,
      departmentId: null,
      locationId: null,
      userId: null,
      createdAt: now,
      updatedAt: now,
    });
    console.log(`OK: created employees/${employeeId}`);
  } else {
    const updates = { updatedAt: now };
    if (displayName) updates.displayName = displayName;
    if (parsedOperationalRoles) updates.operationalRoles = parsedOperationalRoles;
    if (Object.keys(updates).length > 1) {
      await employeeRef.set(updates, { merge: true });
      console.log(`OK: updated employees/${employeeId} (${Object.keys(updates).filter((k) => k !== "updatedAt").join(", ")})`);
    } else {
      console.log(`OK: employees/${employeeId} already up to date, no Employee-side change.`);
    }
  }

  // Re-read after create/update so downstream logic sees the current
  // userId (needed for case D, and for conflict detection below).
  const currentEmployee = (await employeeRef.get()).data();

  // --- D: security-role-only update, no --email given. Requires an
  // existing link -- this script never invents one implicitly. ---
  if (securityRole && !email) {
    if (!currentEmployee.userId) {
      throw new Error(
        `employees/${employeeId} has no linked userId yet -- provide --email to grant access and link a user first.`
      );
    }
    await db.collection(USERS_COLLECTION).doc(currentEmployee.userId).set({ role: securityRole }, { merge: true });
    console.log(`OK: users/${currentEmployee.userId}.role = "${securityRole}"`);
    return;
  }

  // --- B: grant access (--email given) -- locate/create the Auth
  // user, then establish or verify the two-way link. ---
  if (email) {
    // Conflict check BEFORE touching Auth for the new email: if this
    // Employee is already linked to a uid, compare that uid's actual
    // email against the requested one directly -- avoids ever calling
    // getUserByEmail()/createUser() for a conflicting email, so a
    // detected conflict never leaves a dangling, unlinked Auth account
    // behind (an earlier version of this check resolved/created the
    // new email's Auth user first, which could orphan an account on
    // conflict -- fixed here).
    if (currentEmployee.userId) {
      const linkedUserRecord = await auth.getUser(currentEmployee.userId).catch(() => null);
      if (linkedUserRecord && linkedUserRecord.email !== email) {
        throw new Error(
          `employees/${employeeId} is already linked to userId "${currentEmployee.userId}" ` +
            `(${linkedUserRecord.email}), not an account for "${email}". Refusing to create or link a ` +
            `second account -- resolve the conflict manually before re-running.`
        );
      }
    }

    const password = generatePassword();
    const { userRecord, created } = await ensureAuthUser(auth, email, currentEmployee.displayName, password);
    const uid = userRecord.uid;

    // Conflict: target user already linked to a DIFFERENT Employee.
    const userSnap = await db.collection(USERS_COLLECTION).doc(uid).get();
    const existingLinkedEmployeeId = userSnap.exists ? userSnap.data().employeeId : null;
    if (existingLinkedEmployeeId && existingLinkedEmployeeId !== employeeId) {
      throw new Error(
        `users/${uid} is already linked to employees/${existingLinkedEmployeeId}, not "${employeeId}". ` +
          `Refusing to overwrite an existing link -- resolve the conflict manually before re-running.`
      );
    }

    const userUpdates = { employeeId };
    if (securityRole) userUpdates.role = securityRole;
    await db.collection(USERS_COLLECTION).doc(uid).set(userUpdates, { merge: true });

    if (currentEmployee.userId !== uid) {
      await employeeRef.set({ userId: uid, updatedAt: Date.now() }, { merge: true });
      console.log(`OK: employees/${employeeId}.userId = "${uid}"`);
    }
    console.log(
      `OK: ${email} -> uid ${uid}, employees/${employeeId} <-> users/${uid} linked${created ? " (Auth account created)" : " (existing Auth account reused)"}`
    );

    if (created) {
      console.log("\nTemporary password for the newly created account (save this now, it is not stored anywhere):");
      console.log(`  ${password}`);
      console.log(`  ${email}`);
    }
  }
}

async function main() {
  initializeApp({ projectId: "taylor-parts" });
  const args = parseArgs(process.argv.slice(2));

  if (!args.employeeId) {
    console.error(
      "Usage: node scripts/provisionEmployeeAccess.js --employeeId <id> [--displayName <name>] " +
        "[--email <email>] [--securityRole admin|dispatcher|technician] [--operationalRoles ROLE1,ROLE2]"
    );
    process.exitCode = 1;
    return;
  }

  await provisionEmployeeAccess({
    employeeId: args.employeeId,
    displayName: args.displayName,
    email: args.email,
    securityRole: args.securityRole,
    operationalRoles: args.operationalRoles,
  });
}

main().catch((err) => {
  console.error("Failed:", err.message);
  process.exitCode = 1;
});

module.exports = { provisionEmployeeAccess, parseArgs };
