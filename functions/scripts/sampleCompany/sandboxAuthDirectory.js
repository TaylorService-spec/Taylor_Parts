// SAMPLE COMPANY V2 -- the sandbox Auth adapter. CREDENTIAL LAYER ONLY.
//
// ============================ WHAT THIS MAY AND MAY NOT DO ============================
//
// Firebase Auth is TRANSITIONAL IDENTITY AND SESSION ONLY. This file is the one place the Sample Company
// touches it, and its whole surface is four operations: look a sandbox account up by email, create a
// PASSWORDLESS one, read whether an account can sign in, and nothing else.
//
// IT MUST NEVER IMPORT firebase-admin/firestore, AND A TEST ASSERTS THAT. eos_workforce.employees is the
// Employee authority; Firestore is not an Employee authority, not a Role authority, not a capability
// authority, not a profile authority and not an ownership authority. This is also exactly why
// scripts/provisionEmployeeAccess.js is NOT reused here despite doing a similar job: it writes Firestore
// Employee business records (`db.collection(EMPLOYEES_COLLECTION).doc(...).set(...)`), which would put a
// second Employee authority behind the Sample Company.
//
// IT SETS NO PASSWORD AND GENERATES NO SECRET, EVER. There is no `password` anywhere in this file and no
// call that could set one. Password activation is delegated, unchanged, to the existing proven tool
// scripts/activateSandboxPersonas.js --activate-missing, which already implements the required semantics:
// a strong random password ONLY for a persona that has none, every working persona left untouched, merged
// into the gitignored credential file rather than replacing it, an unparseable file refused, and --rotate
// only when somebody says so out loud. Re-implementing that here would have been a second secret-generating
// path to keep honest; delegating means an ordinary Sample Company rerun CANNOT rotate anything.
//
// ============================ THE FENCE ============================
//
// Refuses any project that is production by name or by registry role, and refuses the Certification world
// by name. Only accounts whose email ends `@sandbox.invalid` are ever read or created.
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const SANDBOX_EMAIL_SUFFIX = "@sandbox.invalid";
const PRODUCTION_PROJECT_ID = "taylor-parts";
const CERTIFICATION_PROJECT_ID = "eos-platform-certification";

class SandboxAuthError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "SandboxAuthError";
    this.code = code;
  }
}

/**
 * Refuse any target that is not a declared, non-production, non-Certification sandbox project.
 *
 * Runs BEFORE firebase-admin is required, so a refusal happens with no SDK in the process -- the same
 * property every operator script in this repository holds.
 */
function assertSandboxAuthTarget(projectId) {
  if (!projectId || projectId === "true") throw new SandboxAuthError("PROJECT_REQUIRED", "--firebaseProjectId is required; there is no default target");
  if (projectId === PRODUCTION_PROJECT_ID) throw new SandboxAuthError("PROJECT_REFUSED", `${PRODUCTION_PROJECT_ID} is the customer production project`);
  if (projectId === CERTIFICATION_PROJECT_ID) throw new SandboxAuthError("PROJECT_REFUSED", `${CERTIFICATION_PROJECT_ID} is the Certification world, which is frozen and must never be mutated`);
  const registryPath = path.resolve(__dirname, "..", "..", "..", "config", "environments.json");
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  const environment = (registry.environments || []).find((e) => e.firebase && e.firebase.projectId === projectId);
  if (!environment) throw new SandboxAuthError("PROJECT_REFUSED", `'${projectId}' is not a Firebase project declared in config/environments.json; unknown projects fail closed`);
  if (environment.role === "production") throw new SandboxAuthError("PROJECT_REFUSED", `environment '${environment.id}' has role 'production'`);
  return environment.id;
}

/** Only a sandbox address is ever touched. A real-looking address is refused, not skipped. */
function assertSandboxEmail(email) {
  if (typeof email !== "string" || !email.endsWith(SANDBOX_EMAIL_SUFFIX)) {
    throw new SandboxAuthError("EMAIL_REFUSED", `'${email}' is not a ${SANDBOX_EMAIL_SUFFIX} address; the Sample Company touches no other account`);
  }
  return email;
}

/**
 * The real Firebase-backed directory. `firebase-admin/auth` ONLY -- never firebase-admin/firestore.
 *
 * Returns the small interface the activation phase consumes, so that phase is testable against an
 * in-memory double and never needs Firebase in a test process.
 */
function createFirebaseSandboxAuthDirectory(projectId) {
  const environmentId = assertSandboxAuthTarget(projectId);
  // AFTER the fence, never at module scope.
  const { initializeApp, applicationDefault, getApps } = require("firebase-admin/app");
  const { getAuth } = require("firebase-admin/auth");
  const app = getApps().length > 0 ? getApps()[0] : initializeApp({ credential: applicationDefault(), projectId });
  const auth = getAuth(app);

  return {
    environmentId,
    projectId,
    async findByEmail(email) {
      assertSandboxEmail(email);
      try {
        const user = await auth.getUserByEmail(email);
        return {
          uid: user.uid,
          email: user.email,
          disabled: user.disabled === true,
          // A persona can sign in with a password only if the password provider is actually present.
          hasPassword: Boolean(user.passwordHash) || (user.providerData || []).some((p) => p.providerId === "password"),
        };
      } catch (err) {
        if (err && err.code === "auth/user-not-found") return null;
        throw err;
      }
    },
    /**
     * Create a PASSWORDLESS sandbox account. No password argument exists on this call, so no code path
     * through this module can set one -- activation is the separate, existing tool's job.
     */
    async createPasswordless({ email, displayName }) {
      assertSandboxEmail(email);
      const user = await auth.createUser({ email, displayName, emailVerified: true, disabled: false });
      return { uid: user.uid, email: user.email, disabled: false, hasPassword: false };
    },
  };
}

module.exports = {
  createFirebaseSandboxAuthDirectory,
  assertSandboxAuthTarget,
  assertSandboxEmail,
  SandboxAuthError,
  SANDBOX_EMAIL_SUFFIX,
};
