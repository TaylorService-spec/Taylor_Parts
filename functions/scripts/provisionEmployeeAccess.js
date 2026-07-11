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
// also owns Employee record creation.
//
// Covers all four provisioning cases from the specification, via one
// idempotent flow, not four separate scripts:
//   A. Create Employee without access       (no --email, no --securityRole)
//   B. Grant application access               (--email, links/creates Auth user)
//   C. Update operationalRoles                (--operationalRoles, Employee-side only)
//   D. Update security role                    (--securityRole, no --email, users/{uid}-side only)
//
// --email is an EXECUTION INPUT ONLY. It is used to call
// getUserByEmail()/createUser() to locate or create the Firebase Auth
// account -- it is NEVER written to employees/{employeeId}. Firebase
// Authentication owns credential/account email; Employee owns
// workforce identity and never duplicates it.
//
// No companyId input -- a tenancy/security-relevant parameter must be
// fully implemented and enforced or entirely absent, never accepted-
// and-ignored. Not accepted here.
//
// ARCHITECTURE (five explicit phases, per architecture review -- no
// mutation happens until every applicable conflict across the WHOLE
// requested operation has been checked, not just the final link
// fields):
//   A. Parse and validate input shape (no reads, no writes).
//   B. Read current Employee/User/Auth state (reads only).
//   C. Detect every applicable conflict from A+B (pure, throws on any
//      conflict -- nothing has been written yet at this point, ever).
//   D. Build the complete intended mutation as a plain plan object
//      (pure, no I/O).
//   E. Apply the plan. Firestore documents that must change together
//      (the Employee<->User link) are written inside a single
//      db.runTransaction() that RE-READS both documents and RE-
//      VALIDATES the same conflict conditions against that fresh
//      state before writing anything -- protects against a concurrent
//      modification landing between phase B's reads and this write.
//      Single-document operations (create/update Employee only,
//      update security role only) are plain atomic single-doc writes
//      -- a transaction adds no safety for a write that only ever
//      touches one document.
//
// Firebase Authentication account creation CANNOT participate in a
// Firestore transaction -- Auth and Firestore are different services
// with no shared commit protocol. When a new Auth account must be
// created (case B, no existing account found in phase B), it is
// created as the LAST step before the Firestore transaction, not
// earlier -- minimizing, but not eliminating, the window in which a
// concurrent modification could land between Auth creation and the
// Firestore link committing. If the transaction's re-validation then
// fails (a genuine race, not a conflict already caught in phase C),
// the newly created Auth account is left in place, unlinked -- the
// same residual, documented risk this comment describes, resolved by
// re-running the script (which will then correctly detect the account
// via getUserByEmail() in phase B and proceed to link it), not by any
// further code-level guard.
//
// Idempotent: re-running with identical inputs is a safe no-op repeat
// (matching values are not rewritten, no error, no duplicate Auth
// account). Re-running with a changed displayName/operationalRoles/
// securityRole updates exactly that field.
//
// Conflict detection (fails loudly, writes NOTHING for the whole
// requested operation, not just the final link fields):
//   - employees/{employeeId} does not exist and no --displayName was
//     given to create it.
//   - --securityRole given with no --email and no existing linked
//     userId.
//   - employees/{employeeId} already linked to a DIFFERENT account
//     than --email resolves to (checked against the CURRENTLY linked
//     account's real email, never by creating/resolving the new email
//     first -- a conflict here creates zero Auth side effects).
//   - The target account (resolved from --email) is already linked to
//     a DIFFERENT employeeId.
//   - Any --operationalRoles value outside the governance-approved
//     set (see VALID_OPERATIONAL_ROLES).
//
// PROJECT TARGET: no hard-coded default. --projectId is required and
// fails before any Firebase SDK call. Running against the production
// project ("taylor-parts") additionally requires
// --confirmProduction taylor-parts, matching --projectId exactly --
// this is a deliberate, per-invocation confirmation, not a one-time
// setting. Missing/mismatched confirmation fails before initializeApp()
// -- before any Auth or Firestore operation of any kind. This makes
// merge approval alone incapable of triggering a production mutation:
// there is no default that reaches "taylor-parts" without the operator
// explicitly typing it twice, once as the target and once as
// confirmation. For emulator/non-production testing, use any other
// --projectId value (e.g. a fixture id) to skip the confirmation
// entirely, or pass both flags with the real id if testing against the
// emulator under the real project id specifically.
//
// PASSWORDLESS PROVISIONING -- no credential of any kind is ever
// generated, printed, logged, returned, stored, or committed by this
// script. A newly created Firebase Auth account is created WITHOUT a
// password. A terminal is itself an observable log surface (shell
// history, session recording, CI output, screen sharing, support
// transcripts) -- "printed once, not persisted" is not sufficient, per
// the approved specification, which permits no credential disclosure
// at all, one-time or otherwise.
//
// Provisioning establishes IDENTITY and ACCESS RECORDS only:
// employees/{employeeId}, users/{uid}, and the Auth account itself.
// Provisioning does NOT deliver credentials. A newly created account
// cannot sign in with a password until a separately approved password-
// setup/activation process (outside this script -- e.g. an admin-
// initiated password reset flow) is completed by the operator. This
// script's console output is limited to non-secret operational
// confirmation: email, uid, employeeId, and an explicit reminder that
// activation is still required. No reset link is generated or printed
// here either -- credential delivery of any form is out of scope for
// this script.
//
// Run locally, per provisioning event:
//   cd functions
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json node scripts/provisionEmployeeAccess.js \
//     --projectId taylor-parts --confirmProduction taylor-parts \
//     --employeeId emp-001 --displayName "Jane Doe" \
//     [--email jane@example.com] [--securityRole dispatcher] [--operationalRoles PARTS_ASSOCIATE,PARTS_MANAGER] \
//     [--requireExistingAuthUser]
// (or `gcloud auth application-default login` first, then omit the
//  env var -- either way you need real credentials for the target
//  project.)
//
// --requireExistingAuthUser -- existing-account-only linkage mode.
// Valid only alongside --email. Case B (GRANT_ACCESS)'s default
// behavior, below, silently creates a new passwordless Auth account
// when --email resolves to nothing -- correct for onboarding a
// genuinely new hire, but wrong when linking an account the operator
// already created out-of-band (e.g. Firebase Console) and has
// independently verified exists: a typo'd email or an account deleted
// after that verification should fail loudly, not silently provision a
// new one. With this flag, phase C (detectConflicts) throws if
// getUserByEmail() found nothing -- before auth.createUser(), before
// any Firestore transaction, before any Employee or User write. Without
// it, behavior is byte-for-byte unchanged from before this flag
// existed. Never bypasses --projectId/--confirmProduction, conflict
// detection, or idempotency -- it only removes the auto-create fallback
// for a missing target account.
//
// A live-project run is NOT authorized by this script's existence, by
// this PR's merge, or by any code review alone -- running this against
// production is a separately, explicitly project-owner-authorized
// operational step, gated by --confirmProduction as described above.
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");

const EMPLOYEES_COLLECTION = "employees";
const USERS_COLLECTION = "users";
const EMPLOYMENT_STATUS_ACTIVE = "ACTIVE";
const VALID_SECURITY_ROLES = ["admin", "dispatcher", "technician"];

// Governance-approved operational roles (docs/BusinessEntityModel.md
// Section 8a / docs/PROJECT_ARCHITECTURE.md's Person Assignment
// Platform Service Standard). These are eligibility markers for
// assignment, never security roles -- never merged with
// VALID_SECURITY_ROLES above.
const VALID_OPERATIONAL_ROLES = [
  "PARTS_MANAGER",
  "PARTS_ASSOCIATE",
  "TECHNICIAN",
  "WAREHOUSE_MANAGER",
  "WAREHOUSE_ASSOCIATE",
  "SERVICE_MANAGER",
  "SALES_MANAGER",
  "SALES_ASSOCIATE",
];

const PRODUCTION_PROJECT_ID = "taylor-parts";

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

// Trims whitespace, drops empties, and de-duplicates while preserving
// first-occurrence order -- a stable, predictable result regardless of
// how the caller formatted --operationalRoles.
function normalizeOperationalRoles(raw) {
  if (!raw) return undefined;
  const seen = new Set();
  const normalized = [];
  for (const value of raw.split(",").map((r) => r.trim()).filter(Boolean)) {
    if (!VALID_OPERATIONAL_ROLES.includes(value)) {
      throw new Error(
        `Invalid operational role "${value}". Must be one of: ${VALID_OPERATIONAL_ROLES.join(", ")}.`
      );
    }
    if (!seen.has(value)) {
      seen.add(value);
      normalized.push(value);
    }
  }
  return normalized;
}

// ---------------------------------------------------------------
// Phase A -- parse and validate input shape. No reads, no writes.
// ---------------------------------------------------------------
function validateInput(rawArgs) {
  const { employeeId, displayName, email, securityRole, operationalRoles: rawOperationalRoles } = rawArgs;
  const requireExistingAuthUser = rawArgs.requireExistingAuthUser === "true";

  if (!employeeId) {
    throw new Error("--employeeId is required.");
  }
  if (securityRole && !VALID_SECURITY_ROLES.includes(securityRole)) {
    throw new Error(`--securityRole must be one of: ${VALID_SECURITY_ROLES.join(", ")}.`);
  }
  // --requireExistingAuthUser only means anything alongside --email (it
  // gates whether a *missing* target account may be created) -- reject
  // the nonsensical combination up front rather than silently ignoring
  // the flag. main() re-checks this same condition before
  // initializeApp() is ever called; this copy exists so direct callers
  // of provisionEmployeeAccess() (e.g. tests) get the same guarantee.
  if (requireExistingAuthUser && !email) {
    throw new Error("--requireExistingAuthUser requires --email to also be supplied.");
  }

  // Throws on any invalid role -- the entire command is rejected
  // before any read or write if operationalRoles is malformed.
  const operationalRoles = normalizeOperationalRoles(rawOperationalRoles);

  return { employeeId, displayName, email, securityRole, operationalRoles, requireExistingAuthUser };
}

// ---------------------------------------------------------------
// Phase B -- read current state. Reads only, no mutation.
// ---------------------------------------------------------------
async function readCurrentState(db, auth, { employeeId, email }) {
  const employeeRef = db.collection(EMPLOYEES_COLLECTION).doc(employeeId);
  const employeeSnap = await employeeRef.get();
  const employee = employeeSnap.exists ? employeeSnap.data() : null;

  // The account CURRENTLY linked to this Employee, if any -- read by
  // uid, not by the requested email, so phase C can compare against
  // its real email without ever touching Auth for the new address.
  let linkedUserRecord = null;
  if (employee && employee.userId) {
    linkedUserRecord = await auth.getUser(employee.userId).catch(() => null);
  }

  // The account the requested --email resolves to, if it already
  // exists. Read-only (getUserByEmail never creates) -- creation, if
  // needed, happens only in phase E, after every conflict check below
  // has passed.
  let targetAuthUser = null;
  if (email) {
    targetAuthUser = await auth.getUserByEmail(email).catch((err) => {
      if (err.code === "auth/user-not-found") return null;
      throw err;
    });
  }

  let targetUserDoc = null;
  if (targetAuthUser) {
    const snap = await db.collection(USERS_COLLECTION).doc(targetAuthUser.uid).get();
    targetUserDoc = snap.exists ? snap.data() : null;
  }

  return { employeeRef, employee, linkedUserRecord, targetAuthUser, targetUserDoc };
}

// ---------------------------------------------------------------
// Phase C -- detect every applicable conflict. Pure (no I/O). Throws
// on the first conflict found; every case below leaves the caller
// having made zero Firestore or Auth writes, because phases D/E never
// run when this phase throws.
// ---------------------------------------------------------------
function detectConflicts({ employeeId, displayName, email, securityRole, requireExistingAuthUser }, state) {
  const { employee, linkedUserRecord, targetAuthUser, targetUserDoc } = state;

  if (!employee && !displayName) {
    throw new Error(`employees/${employeeId} does not exist yet -- --displayName is required to create it.`);
  }

  // --requireExistingAuthUser's entire purpose: this project's default
  // GRANT_ACCESS behavior (see buildPlan/applyPlan below) silently
  // creates a new passwordless Auth account when --email resolves to
  // nothing. That's the right default for genuinely new hires, but
  // wrong for linking accounts the operator has already created
  // out-of-band and verified exist -- a typo'd or since-deleted email
  // should fail loudly, not quietly provision a new account. This
  // check runs in phase C, so it throws before buildPlan (phase D) or
  // applyPlan (phase E) ever run -- zero Auth or Firestore mutation
  // occurs when this fires.
  if (requireExistingAuthUser && !targetAuthUser) {
    throw new Error(
      `--requireExistingAuthUser was set but no existing Firebase Auth account was found for "${email}". ` +
        "Refusing to create one -- verify the email and that the account exists, then re-run."
    );
  }

  if (securityRole && !email && !(employee && employee.userId)) {
    throw new Error(
      `employees/${employeeId} has no linked userId yet -- provide --email to grant access and link a user first.`
    );
  }

  if (email && employee && employee.userId) {
    if (linkedUserRecord && linkedUserRecord.email !== email) {
      throw new Error(
        `employees/${employeeId} is already linked to userId "${employee.userId}" (${linkedUserRecord.email}), ` +
          `not an account for "${email}". Refusing to create or link a second account -- resolve the conflict ` +
          `manually before re-running.`
      );
    }
  }

  if (email && targetAuthUser && targetUserDoc && targetUserDoc.employeeId && targetUserDoc.employeeId !== employeeId) {
    throw new Error(
      `users/${targetAuthUser.uid} is already linked to employees/${targetUserDoc.employeeId}, not "${employeeId}". ` +
        `Refusing to overwrite an existing link -- resolve the conflict manually before re-running.`
    );
  }
}

// ---------------------------------------------------------------
// Phase D -- build the complete intended mutation as a plain plan
// object. Pure (no I/O) -- classifies the operation explicitly rather
// than re-deriving intent from ambiguous state during phase E.
// ---------------------------------------------------------------
function buildPlan({ employeeId, displayName, email, securityRole, operationalRoles }, state) {
  const { employee, targetAuthUser } = state;
  const now = Date.now();

  if (email) {
    // Case B: grant access -- always writes both documents together.
    const employeeDoc = !employee
      ? {
          employeeId,
          displayName,
          firstName: null,
          lastName: null,
          employmentStatus: EMPLOYMENT_STATUS_ACTIVE,
          operationalRoles: operationalRoles ?? [],
          companyId: null,
          departmentId: null,
          locationId: null,
          userId: null,
          createdAt: now,
          updatedAt: now,
        }
      : null;

    const employeeUpdates = employee
      ? (() => {
          const updates = {};
          if (displayName && displayName !== employee.displayName) updates.displayName = displayName;
          if (operationalRoles && JSON.stringify(operationalRoles) !== JSON.stringify(employee.operationalRoles)) {
            updates.operationalRoles = operationalRoles;
          }
          return updates;
        })()
      : null;

    const userUpdates = { employeeId };
    if (securityRole) userUpdates.role = securityRole;

    return {
      operation: "GRANT_ACCESS",
      employeeId,
      createEmployee: !employee,
      employeeDoc,
      employeeUpdates,
      needsNewAuthUser: !targetAuthUser,
      userId: targetAuthUser ? targetAuthUser.uid : null,
      authCreateInput: { email, displayName: displayName ?? employee?.displayName ?? null },
      userUpdates,
    };
  }

  if (securityRole) {
    // Case D: security-role-only update -- users/{uid} only, no
    // Employee-side write, per the specification.
    return {
      operation: "UPDATE_SECURITY_ROLE_ONLY",
      employeeId,
      userId: employee.userId,
      userUpdates: { role: securityRole },
    };
  }

  // Cases A/C: Employee-only create or update, no Auth/User involvement.
  if (!employee) {
    return {
      operation: "CREATE_EMPLOYEE_ONLY",
      employeeId,
      employeeDoc: {
        employeeId,
        displayName,
        firstName: null,
        lastName: null,
        employmentStatus: EMPLOYMENT_STATUS_ACTIVE,
        operationalRoles: operationalRoles ?? [],
        companyId: null,
        departmentId: null,
        locationId: null,
        userId: null,
        createdAt: now,
        updatedAt: now,
      },
    };
  }

  const updates = {};
  if (displayName && displayName !== employee.displayName) updates.displayName = displayName;
  if (operationalRoles && JSON.stringify(operationalRoles) !== JSON.stringify(employee.operationalRoles)) {
    updates.operationalRoles = operationalRoles;
  }
  return {
    operation: "UPDATE_EMPLOYEE_ONLY",
    employeeId,
    employeeUpdates: Object.keys(updates).length ? { ...updates, updatedAt: now } : null,
  };
}

// ---------------------------------------------------------------
// Phase E -- apply the plan.
// ---------------------------------------------------------------
async function applyPlan(db, auth, plan) {
  if (plan.operation === "UPDATE_SECURITY_ROLE_ONLY") {
    await db.collection(USERS_COLLECTION).doc(plan.userId).set(plan.userUpdates, { merge: true });
    console.log(`OK: users/${plan.userId}.role = "${plan.userUpdates.role}"`);
    return { created: false };
  }

  if (plan.operation === "CREATE_EMPLOYEE_ONLY") {
    await db.collection(EMPLOYEES_COLLECTION).doc(plan.employeeId).set(plan.employeeDoc);
    console.log(`OK: created employees/${plan.employeeId}`);
    return { created: false };
  }

  if (plan.operation === "UPDATE_EMPLOYEE_ONLY") {
    if (plan.employeeUpdates) {
      await db.collection(EMPLOYEES_COLLECTION).doc(plan.employeeId).set(plan.employeeUpdates, { merge: true });
      console.log(
        `OK: updated employees/${plan.employeeId} (${Object.keys(plan.employeeUpdates)
          .filter((k) => k !== "updatedAt")
          .join(", ")})`
      );
    } else {
      console.log(`OK: employees/${plan.employeeId} already up to date, no Employee-side change.`);
    }
    return { created: false };
  }

  // GRANT_ACCESS -- the only operation touching both documents.
  let created = false;

  // Auth creation cannot be transactional with Firestore -- performed
  // here, as the last step before the atomic Firestore write, per the
  // documented boundary at the top of this file. No password is set --
  // passwordless provisioning, per the approved specification. The
  // account exists and is linked, but cannot sign in with a password
  // until a separately approved activation/password-setup process is
  // completed outside this script.
  if (plan.needsNewAuthUser) {
    const userRecord = await auth.createUser({
      email: plan.authCreateInput.email,
      displayName: plan.authCreateInput.displayName,
    });
    plan.userId = userRecord.uid;
    created = true;
  }

  const employeeRef = db.collection(EMPLOYEES_COLLECTION).doc(plan.employeeId);
  const userRef = db.collection(USERS_COLLECTION).doc(plan.userId);

  await db.runTransaction(async (tx) => {
    // Re-read both documents fresh, inside the transaction, and
    // re-validate the same conflict conditions against that fresh
    // state -- protects against a concurrent modification landing
    // between phase B's reads and this write.
    const [employeeSnap, userSnap] = await Promise.all([tx.get(employeeRef), tx.get(userRef)]);
    const freshEmployee = employeeSnap.exists ? employeeSnap.data() : null;
    const freshUser = userSnap.exists ? userSnap.data() : null;

    if (freshEmployee && freshEmployee.userId && freshEmployee.userId !== plan.userId) {
      throw new Error(
        `Concurrent modification detected: employees/${plan.employeeId} became linked to a different userId ` +
          `during this operation. Aborting with no writes -- re-run to re-evaluate.`
      );
    }
    if (freshUser && freshUser.employeeId && freshUser.employeeId !== plan.employeeId) {
      throw new Error(
        `Concurrent modification detected: users/${plan.userId} became linked to a different employeeId ` +
          `during this operation. Aborting with no writes -- re-run to re-evaluate.`
      );
    }

    const now = Date.now();
    if (plan.createEmployee) {
      tx.set(employeeRef, { ...plan.employeeDoc, userId: plan.userId, updatedAt: now });
    } else {
      const employeeWrite = { ...(plan.employeeUpdates ?? {}) };
      if (!freshEmployee || freshEmployee.userId !== plan.userId) {
        employeeWrite.userId = plan.userId;
      }
      if (Object.keys(employeeWrite).length) {
        tx.set(employeeRef, { ...employeeWrite, updatedAt: now }, { merge: true });
      }
    }

    tx.set(userRef, plan.userUpdates, { merge: true });
  });

  console.log(
    `OK: ${plan.authCreateInput.email} -> uid ${plan.userId}, employees/${plan.employeeId} <-> users/${plan.userId} ` +
      `linked${created ? " (Auth account created)" : " (existing Auth account reused)"}`
  );

  return { created };
}

async function provisionEmployeeAccess(db, auth, rawArgs) {
  const input = validateInput(rawArgs); // Phase A
  const state = await readCurrentState(db, auth, input); // Phase B
  detectConflicts(input, state); // Phase C -- throws before any write
  const plan = buildPlan(input, state); // Phase D
  const result = await applyPlan(db, auth, plan); // Phase E

  if (result.created) {
    console.log(
      `\nAccount created (no password set): email=${plan.authCreateInput.email} uid=${plan.userId} ` +
        `employeeId=${plan.employeeId}`
    );
    console.log(
      "This account cannot sign in yet -- password setup/activation is a separate, approved process outside this script."
    );
  }
}

function assertProjectTarget(args) {
  if (!args.projectId) {
    throw new Error(
      "--projectId is required (no default target -- e.g. --projectId taylor-parts, or a non-production id for testing)."
    );
  }
  if (args.projectId === PRODUCTION_PROJECT_ID && args.confirmProduction !== PRODUCTION_PROJECT_ID) {
    throw new Error(
      `--projectId "${PRODUCTION_PROJECT_ID}" targets the production project -- this requires an explicit, ` +
        `matching --confirmProduction ${PRODUCTION_PROJECT_ID} flag as a deliberate, per-run confirmation. ` +
        `Use a different --projectId for emulator/non-production testing to skip this requirement.`
    );
  }
  return args.projectId;
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

  if (!args.employeeId) {
    console.error(
      "Usage: node scripts/provisionEmployeeAccess.js --projectId <id> [--confirmProduction taylor-parts] " +
        "--employeeId <id> [--displayName <name>] [--email <email>] " +
        "[--securityRole admin|dispatcher|technician] [--operationalRoles ROLE1,ROLE2] " +
        "[--requireExistingAuthUser]"
    );
    process.exitCode = 1;
    return;
  }

  // Checked here, before initializeApp(), for the same reason
  // assertProjectTarget() is: a malformed invocation of a flag whose
  // entire point is refusing to create an Auth account should itself
  // fail before any Firebase SDK call, not partway through one.
  // validateInput() (phase A, inside provisionEmployeeAccess() below)
  // re-checks this same condition for direct callers that skip main().
  if (args.requireExistingAuthUser && !args.email) {
    console.error("--requireExistingAuthUser requires --email to also be supplied.");
    process.exitCode = 1;
    return;
  }

  // initializeApp() -- and every subsequent Auth/Firestore call -- only
  // ever runs after assertProjectTarget() has passed.
  initializeApp({ projectId });
  const db = getFirestore();
  const auth = getAuth();

  await provisionEmployeeAccess(db, auth, {
    employeeId: args.employeeId,
    displayName: args.displayName,
    email: args.email,
    securityRole: args.securityRole,
    operationalRoles: args.operationalRoles,
    requireExistingAuthUser: args.requireExistingAuthUser,
  });
}

main().catch((err) => {
  console.error("Failed:", err.message);
  process.exitCode = 1;
});

module.exports = {
  provisionEmployeeAccess,
  parseArgs,
  validateInput,
  detectConflicts,
  buildPlan,
  normalizeOperationalRoles,
  assertProjectTarget,
  VALID_OPERATIONAL_ROLES,
  PRODUCTION_PROJECT_ID,
};
