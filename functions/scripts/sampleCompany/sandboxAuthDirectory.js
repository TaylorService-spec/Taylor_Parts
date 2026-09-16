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
/**
 * The ONE environment the Sample Company exists in. Its Firebase project is RESOLVED from
 * config/environments.json rather than written here a second time, so the business target
 * (PostgreSQL: platform-sandbox / taylor-nonprod) and the credential target cannot drift apart.
 */
const REQUIRED_ENVIRONMENT = "platform-sandbox";
const DEFAULT_REGISTRY_PATH = path.resolve(__dirname, "..", "..", "..", "config", "environments.json");

class SandboxAuthError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "SandboxAuthError";
    this.code = code;
  }
}

/** The Firebase project id config/environments.json registers for the Sample Company's environment. */
function expectedSampleCompanyProjectId(registryPath = DEFAULT_REGISTRY_PATH) {
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  const environment = (registry.environments || []).find((e) => e.id === REQUIRED_ENVIRONMENT);
  const projectId = environment && environment.firebase && environment.firebase.projectId;
  if (!projectId) {
    throw new SandboxAuthError("REGISTRY_INVALID", `config/environments.json declares no Firebase project for '${REQUIRED_ENVIRONMENT}'`);
  }
  return projectId;
}

/**
 * Refuse any Auth target that is not EXACTLY the Sample Company environment's own Firebase project.
 *
 * THE BUSINESS TARGET AND THE CREDENTIAL TARGET MUST BE THE SAME PLACE. The PostgreSQL side is positively
 * restricted to platform-sandbox / taylor-nonprod; accepting merely "some other registered non-production
 * project" here would allow a run whose Principals were written into one environment's database while the
 * credentials those Principals are keyed to lived in a different project's Auth. Every Principal would
 * resolve to a uid nobody in that environment can present, and the failure would surface much later as
 * personas that inexplicably cannot sign in. So the accepted project is RESOLVED FROM THE REGISTRY for
 * REQUIRED_ENVIRONMENT and must match exactly -- one source of truth, not a second hard-coded copy.
 *
 * The three independent refusals stay, so a mislabelled or edited registry entry cannot defeat this alone:
 * production by name, production by role, and the Certification world by name.
 *
 * Runs BEFORE firebase-admin is required, so a refusal happens with no SDK in the process -- the same
 * property every operator script in this repository holds.
 */
function assertSandboxAuthTarget(projectId, registryPath = DEFAULT_REGISTRY_PATH) {
  if (!projectId || projectId === "true") throw new SandboxAuthError("PROJECT_REQUIRED", "--firebaseProjectId is required; there is no default target");
  if (projectId === PRODUCTION_PROJECT_ID) throw new SandboxAuthError("PROJECT_REFUSED", `${PRODUCTION_PROJECT_ID} is the customer production project`);
  if (projectId === CERTIFICATION_PROJECT_ID) throw new SandboxAuthError("PROJECT_REFUSED", `${CERTIFICATION_PROJECT_ID} is the Certification world, which is frozen and must never be mutated`);
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  const environment = (registry.environments || []).find((e) => e.firebase && e.firebase.projectId === projectId);
  if (!environment) throw new SandboxAuthError("PROJECT_REFUSED", `'${projectId}' is not a Firebase project declared in config/environments.json; unknown projects fail closed`);
  if (environment.role === "production") throw new SandboxAuthError("PROJECT_REFUSED", `environment '${environment.id}' has role 'production'`);
  const expected = expectedSampleCompanyProjectId(registryPath);
  if (projectId !== expected) {
    throw new SandboxAuthError(
      "PROJECT_REFUSED",
      `the Sample Company lives in '${REQUIRED_ENVIRONMENT}', whose registered Firebase project is '${expected}'; ` +
        `refusing '${projectId}' (environment '${environment.id}'). Not-production is not the same as the one project ` +
        "this Sample Company's own Principals are keyed to, and a split target would key every Principal to a uid " +
        "nobody in that environment can present.",
    );
  }
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
    /**
     * The Auth handle, exposed ONLY so the credential phase can hand it to the existing proven
     * `activateMissingSandboxPasswords` implementation rather than reimplementing password activation here.
     * Nothing in this module calls a write method on it.
     */
    auth,
    /** Every @sandbox.invalid persona in the project, as the existing activation tool lists them. */
    async listSandboxPersonas() {
      const list = await auth.listUsers(1000);
      return list.users.filter((u) => u.email && u.email.endsWith(SANDBOX_EMAIL_SUFFIX));
    },
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
     * READ ONLY, BY UID. The reused real Administrator has no @sandbox.invalid address and is never created,
     * renamed or re-credentialed by this workstream -- but its login readiness still has to be PROVED rather
     * than assumed, and the only handle we legitimately hold for it is its EOS Principal's external subject.
     * This reads; it cannot write. There is no updateUser, no createUser and no password anywhere near it.
     */
    async findByUid(uid) {
      if (typeof uid !== "string" || uid.trim() === "") return null;
      try {
        const user = await auth.getUser(uid);
        return {
          uid: user.uid,
          email: user.email ?? null,
          disabled: user.disabled === true,
          hasPassword: Boolean(user.passwordHash) || (user.providerData || []).some((p) => p.providerId === "password"),
          providerIds: (user.providerData || []).map((p) => p.providerId),
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
  expectedSampleCompanyProjectId,
  REQUIRED_ENVIRONMENT,
  assertSandboxEmail,
  SandboxAuthError,
  SANDBOX_EMAIL_SUFFIX,
};
