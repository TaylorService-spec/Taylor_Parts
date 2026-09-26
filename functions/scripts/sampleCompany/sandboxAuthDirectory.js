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
//
// ============================ THE OPERATOR CREDENTIAL ============================
//
// Verifying a Firebase ID token needs only the project id and Google's public certificates, which is why the
// deployed eos-api-nonprod runtime holds NO Google credential (render.yaml). ADMINISTERING Auth -- reading an
// account by email, creating one, activating a password -- needs a real Google OAuth2 access token. On Render,
// `applicationDefault()` has nothing to find and falls through to the Compute Engine metadata server, which
// does not exist there (`getaddrinfo ENOTFOUND metadata.google.internal`).
//
// So the credential is supplied BY THE OPERATOR, FOR ONE SHELL, and never by the runtime:
//
//   EOS_FIREBASE_OPERATOR_ACCESS_TOKEN   a short-lived OAuth2 access token the operator minted outside the
//                                        application (e.g. `gcloud auth print-access-token`). Read from the
//                                        environment only -- never argv, which process listings and shell
//                                        history expose. Never persisted, logged, serialized or echoed in an
//                                        error; every message leaving this module is scrubbed of it.
//   (absent)                             Application Default Credentials, for an environment that genuinely
//                                        has them.
//
// A SUPPLIED TOKEN IS NEVER DOWNGRADED. If it is present it is the credential, full stop: a blank value is
// refused, and a token Google rejects fails the preflight -- there is no retry with ADC. `preflight()` proves
// the credential works with one Admin Auth READ before any caller does any PostgreSQL or Auth write.
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const SANDBOX_EMAIL_SUFFIX = "@sandbox.invalid";
/** OPERATOR ONLY. The one place a Google OAuth2 access token for Auth administration may come from. */
const OPERATOR_ACCESS_TOKEN_ENV = "EOS_FIREBASE_OPERATOR_ACCESS_TOKEN";
/**
 * The lifetime the SDK is told the operator token has. The real expiry is Google's and unknown here; a token
 * that has actually expired is rejected by Google and surfaces as a failed call, not a silent refresh.
 */
const OPERATOR_TOKEN_ASSUMED_LIFETIME_SECONDS = 3000;
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

/** The operator token from the environment, or null when none was supplied. A blank value is refused. */
function readOperatorAccessToken(env = process.env) {
  if (!Object.prototype.hasOwnProperty.call(env, OPERATOR_ACCESS_TOKEN_ENV)) return null;
  const raw = env[OPERATOR_ACCESS_TOKEN_ENV];
  const token = typeof raw === "string" ? raw.trim() : "";
  if (token === "" || /\s/.test(token)) {
    throw new SandboxAuthError("OPERATOR_TOKEN_INVALID", `${OPERATOR_ACCESS_TOKEN_ENV} is set but is not a single non-blank token; refusing rather than falling back to Application Default Credentials`);
  }
  return token;
}

/** Replace every occurrence of the operator token in a message. Safe to call when none was supplied. */
function scrubOperatorSecret(text, env = process.env) {
  const message = String(text);
  let token = null;
  try {
    token = readOperatorAccessToken(env);
  } catch {
    return message;
  }
  return token ? message.split(token).join(`[${OPERATOR_ACCESS_TOKEN_ENV} redacted]`) : message;
}

/**
 * OPERATOR ONLY. A firebase-admin `Credential` backed by a short-lived access token the operator supplied.
 * The token lives only in this closure: the returned object has no enumerable state, so serializing or
 * inspecting it reveals nothing.
 */
function createOperatorAccessTokenCredential(token) {
  if (typeof token !== "string" || token.trim() === "") {
    throw new SandboxAuthError("OPERATOR_TOKEN_INVALID", "an operator access token must be a non-blank string");
  }
  return Object.freeze({
    getAccessToken: async () => ({ access_token: token, expires_in: OPERATOR_TOKEN_ASSUMED_LIFETIME_SECONDS }),
  });
}

/**
 * The ONE credential decision for Auth administration: the operator token when supplied, otherwise ADC.
 * `source` is safe to report; the credential itself is not.
 */
function resolveAdminCredential(env, applicationDefault) {
  const token = readOperatorAccessToken(env);
  if (token !== null) return { source: "OPERATOR_ACCESS_TOKEN", credential: createOperatorAccessTokenCredential(token) };
  return { source: "APPLICATION_DEFAULT", credential: applicationDefault() };
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
function createFirebaseSandboxAuthDirectory(projectId, { env = process.env, sdk = null } = {}) {
  const environmentId = assertSandboxAuthTarget(projectId);
  // The credential decision is made before the SDK is loaded, so a blank operator token is refused with no
  // firebase-admin in the process either.
  readOperatorAccessToken(env);
  // AFTER the fence, never at module scope. `sdk` is a test seam only.
  const { initializeApp, applicationDefault, getApps } = sdk ?? require("firebase-admin/app");
  const { getAuth } = sdk ?? require("firebase-admin/auth");
  if (getApps().length > 0) {
    // An app initialized elsewhere carries a credential this module did not choose; refuse rather than guess.
    throw new SandboxAuthError("AUTH_APP_ALREADY_INITIALIZED", "a Firebase app already exists in this process; the sandbox Auth adapter must be the one that initializes it");
  }
  let resolved;
  try {
    resolved = resolveAdminCredential(env, applicationDefault);
  } catch (err) {
    if (err instanceof SandboxAuthError) throw err;
    throw new SandboxAuthError(
      "OPERATOR_CREDENTIAL_UNAVAILABLE",
      `no Google credential could be loaded for Firebase Auth administration of '${projectId}'. ` +
        `Supply a short-lived Google OAuth2 access token in ${OPERATOR_ACCESS_TOKEN_ENV} for this shell (never as an argument). ` +
        `Nothing was written. Cause: ${scrubOperatorSecret(err && err.message ? err.message : String(err), env)}`,
    );
  }
  const { source: credentialSource, credential } = resolved;
  const app = initializeApp({ credential, projectId });
  const auth = getAuth(app);

  return {
    environmentId,
    projectId,
    /** OPERATOR_ACCESS_TOKEN or APPLICATION_DEFAULT. Names where the credential came from, never what it is. */
    credentialSource,
    /**
     * PROVE THE CREDENTIAL BEFORE ANYTHING IS WRITTEN. One Admin Auth read against this project: if no token
     * can be obtained, or Google rejects it, this refuses here rather than midway through persona processing.
     */
    async preflight() {
      try {
        await auth.listUsers(1);
      } catch (err) {
        const detail = scrubOperatorSecret(err && err.message ? err.message : String(err), env);
        throw new SandboxAuthError(
          "OPERATOR_CREDENTIAL_UNAVAILABLE",
          `Firebase Auth administration of '${projectId}' could not be authorized using ${credentialSource}. ` +
            `Supply a short-lived Google OAuth2 access token in ${OPERATOR_ACCESS_TOKEN_ENV} for this shell (never as an argument), ` +
            `or run where Application Default Credentials exist. Nothing was written. Cause: ${detail}`,
        );
      }
      return { projectId, credentialSource };
    },
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
    /**
     * RESET_EXISTING_SANDBOX_PASSWORD -- authorized by Owner ruling 2026-09-25.
     *
     * This is NOT "activate a missing password", and the distinction is the whole point. The ten
     * accounts this serves ALREADY HAVE passwords; those passwords are simply in no canonical source,
     * so nothing can sign in as them. `activateMissingSandboxPasswords` acts only where there is no
     * password and would therefore have acted on ZERO of them while a plan claimed ten -- which is
     * exactly how a wrong expectation survived contact with reality. So this is a different Admin SDK
     * call with a different name: it UPDATES an existing user.
     *
     * IT LIVES HERE, BEHIND THE FENCE. The caller never touches firebase-admin: this module already
     * refuses production by name and by registry role, refuses the frozen Certification world, and
     * refuses any address that is not @sandbox.invalid. Reaching for the SDK directly would put a
     * password write outside every one of those.
     *
     * THE UID IS ASSERTED ON BOTH SIDES. A reset must change a secret and NOTHING else. Firebase will
     * happily let you hold an email while the account behind it is not the one you measured, so the
     * expected uid is checked BEFORE the write (refusing if it disagrees) and re-read AFTER it. A
     * reset that migrated an identity would silently repoint a persona at another account, which is
     * the defect class this whole registry exists to end.
     *
     * NOTHING HERE READS, RETURNS OR LOGS THE PASSWORD. It is a write-only argument; the result
     * carries the uid, the address and a boolean.
     */
    async resetExistingSandboxPassword({ email, expectedUid, password }) {
      assertSandboxEmail(email);
      if (typeof expectedUid !== "string" || expectedUid.trim() === "") {
        throw new SandboxAuthError("EXPECTED_UID_REQUIRED", `a reset of ${email} must state the uid it expects; an unguarded reset can migrate an identity`);
      }
      if (typeof password !== "string" || password.length < 16) {
        throw new SandboxAuthError("WEAK_PASSWORD_REFUSED", `the password supplied for ${email} is too short to be a generated secret`);
      }

      let before;
      try {
        before = await auth.getUserByEmail(email);
      } catch (err) {
        if (err && err.code === "auth/user-not-found") {
          // A reset may never create. An absent account is CREATE_AUTH_ACCOUNT, a different disposition.
          throw new SandboxAuthError("RESET_TARGET_NOT_FOUND", `${email} has no Auth account; a reset never creates one`);
        }
        throw err;
      }
      if (before.uid !== expectedUid) {
        throw new SandboxAuthError(
          "RESET_UID_MISMATCH",
          `${email} resolves to a different account than expected; refusing to reset. Nothing was written.`,
        );
      }
      if (before.disabled === true) {
        throw new SandboxAuthError("RESET_TARGET_DISABLED", `${email} is disabled; enabling it is a separate, unauthorized decision`);
      }

      await auth.updateUser(before.uid, { password, emailVerified: true });

      // Re-read, so identity stability is MEASURED rather than assumed. A uid that no longer resolves
      // is the same finding as one that moved: the account we wrote to is not the account that is
      // there now, and that must stop everything rather than be reported as a successful reset.
      let after;
      try {
        after = await auth.getUser(before.uid);
      } catch (err) {
        if (err && err.code === "auth/user-not-found") {
          throw new SandboxAuthError(
            "RESET_IDENTITY_MIGRATED",
            `${email} no longer resolves to the uid that was just written. This must be investigated before any further persona work.`,
          );
        }
        throw err;
      }
      if (after.uid !== expectedUid || after.email !== before.email) {
        throw new SandboxAuthError(
          "RESET_IDENTITY_MIGRATED",
          `${email} changed identity during the reset (uid or address moved). This must be investigated before any further persona work.`,
        );
      }
      return { uid: after.uid, email: after.email, reset: true, uidStable: true };
    },
  };
}

module.exports = {
  createFirebaseSandboxAuthDirectory,
  createOperatorAccessTokenCredential,
  resolveAdminCredential,
  readOperatorAccessToken,
  scrubOperatorSecret,
  OPERATOR_ACCESS_TOKEN_ENV,
  assertSandboxAuthTarget,
  expectedSampleCompanyProjectId,
  REQUIRED_ENVIRONMENT,
  assertSandboxEmail,
  SandboxAuthError,
  SANDBOX_EMAIL_SUFFIX,
};
