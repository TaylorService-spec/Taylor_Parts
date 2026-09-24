// BINDING THE NONPROD OWNER PERSONA TO A REAL AUTHENTICATION IDENTITY -- Owner ruling, Wave 12.
//
// ============================ THE MEASUREMENT THIS EXISTS TO CLOSE ============================
//
// scripts/provisionOwnerPersona.js gave the `owner` Security Role its one holder: Principal
// dca03ad1-9278-49e6-b4f9-d09d3f587dc4, bound to `("eos-synthetic-nonprod",
// "synthetic-np-principal-owner")`. That provider is recognized by NO verifier, deliberately, so the
// Owner persona is an authority nobody can sign in as. Every statement about what an Owner SEES is
// therefore still a statement nobody has ever exercised through a browser.
//
// This attaches a real login to that same Principal, and changes nothing else about it.
//
// ============================ THE IDENTITY MODEL, AND WHY THIS IS AN UPDATE ============================
//
// `eos_policy.principals` carries `(identity_provider, external_subject)` under
// `principals_provider_subject_unique`, and there is NO separate identity-binding table -- the
// related tables are employee_principal_links, principal_access_versions, principal_capabilities and
// workflow_role_bindings, none of which binds an external subject. THE MODEL IS ONE EXTERNAL
// IDENTITY PER PRINCIPAL.
//
// So a Firebase binding cannot be ADDED to the Owner Principal. Three shapes exist and only one is
// available here:
//
//   (a) RE-BIND the existing Principal          <- this script
//   (b) extend the schema to hold two bindings  -- a migration, which this lane may not write
//   (c) create a second Principal and move the  -- contradicts "the current Principal remains
//       `owner` Role onto it                       canonical"; orphans dca03ad1 and its assignment
//
// (a) is the shape that keeps the ruling's own premise true. The Principal id does not move, and the
// id is what the `owner` assignment, the tenant membership, every employee link, every direct grant
// and every audit row references. The authority is untouched; only the question "which token
// resolves to it" gets a new answer.
//
// ============================ WHY A GOVERNED COMMAND, NOT A SUBSTITUTION ============================
//
// The prohibition is on MANUALLY SUBSTITUTING the subject -- an UPDATE typed into a database client,
// which is unauthorized, unaudited, unreviewable, and indistinguishable afterwards from an attacker
// doing the same thing. `rebindPrincipalIdentity` is a different act in every respect that
// prohibition is about:
//
//   AUTHORIZED   it runs through requireAdministrationAuthority against the Roles a NAMED
//                administering Principal actually holds, read from the database, never asserted here
//   BOUNDED      it writes identity_provider, external_subject and display_name. There is no
//                parameter for a Role, a capability, a status or a tenant, so widening is not
//                expressible rather than merely refused
//   AUDITED      one event carrying BOTH bindings -- who could sign in as this authority before, and
//                who can now -- with a per-step reason
//   RECONCILABLE a second run reports NO_CHANGE and writes nothing, including no audit event
//   FENCED       production refused twice over, the frozen Certification world refused by id, the
//                administering Principal refused as a target
//
// ============================ WHAT FIREBASE MAY AND MAY NOT SUPPLY ============================
//
//   MAY      login, an ID token, and an external subject (the uid). That is all a verifier reads:
//            createFirebaseTokenVerifier returns `{externalSubject: decoded.uid, identityProvider}`
//            and deliberately ignores custom claims.
//   MAY NOT  the `owner` Role, any business permission, Work Eligibility, Operational Scope or
//            navigation authority. Those live in PostgreSQL and this script writes none of them.
//            It makes no Firestore call of any kind -- there is no Firestore client in this process.
//
// ============================ THE AUTHENTICATION IDENTITY ============================
//
// Created through the PUBLIC Identity Toolkit endpoint with the environment's PUBLIC Firebase Web
// apiKey, which config/environments.json declares is a project identifier and not a credential. That
// is a deliberate choice over the Admin SDK: it needs no ambient Application Default Credentials and
// NO SERVICE-ACCOUNT KEY, so running this tool cannot leave a long-lived credential behind.
//
// THE PASSWORD IS NEVER AN ARGUMENT. It is read from the environment variable named by
// --authPasswordEnv, because argv appears in ps, in shell history and in CI logs. It is never
// printed, never written to a file, never returned, and never compared in a message. The report
// carries the uid and the email, which are identifiers, and nothing else.
//
// Only `@sandbox.invalid` accounts are touched. The TLD is RFC 6761 reserved, so no mail can ever be
// delivered to one -- which is the point for a fixture, and is also why password recovery for these
// accounts is a console act rather than an email one.
//
// DRY RUN BY DEFAULT. `--apply` writes. A dry run makes NO network call and NO database write.
//
// Usage:
//   node scripts/bindOwnerPersonaIdentity.js --environment platform-sandbox \
//     --projectId eos-platform-sandbox --databaseUrlEnv DATABASE_URL \
//     --tenantKey taylor-nonprod --performedBy <operator> --adminPrincipalId <principal> \
//     --authIdentityEmail eos-owner@sandbox.invalid --authPasswordEnv EOS_OWNER_PERSONA_PASSWORD \
//     [--apply]
//
// Exit 0 bound or already bound; 2 refused or failed. Output: deterministic JSON, no secrets.
"use strict";

const { assertMeasurementTarget, parseArgs } = require("./measureEmployeeReferenceIntegrity.js");
const { assertNonprodRuntime } = require("./measureWorkforceActivation.js");
const {
  OWNER_EXTERNAL_SUBJECT,
  OWNER_ROLE_KEY,
  SYNTHETIC_IDENTITY_PROVIDER,
} = require("./provisionOwnerPersona.js");

const FROZEN_ENVIRONMENTS = Object.freeze(["platform-certification"]);

/** The ONE provider string any verifier can produce. server.ts defaults identityProvider to it. */
const FIREBASE_IDENTITY_PROVIDER = "firebase";
/** RFC 6761 reserved; no mail is deliverable, which is what makes these accounts fixtures. */
const REQUIRED_EMAIL_SUFFIX = "@sandbox.invalid";
const IDENTITY_TOOLKIT = "https://identitytoolkit.googleapis.com/v1/accounts";
/** Below this a "test account" is a real foothold in a real project. */
const MIN_PASSWORD_LENGTH = 16;

const boundDisplayName = (email) =>
  `SYNTHETIC NONPROD Owner (fixture, signs in as ${email}; EOS holds the authority)`;

/**
 * THE TWO PER-STEP REASONS. Two steps, two reasons, each naming its own subject and its own target.
 *
 * Constants of the STEP rather than parameters, which is what makes a run-level reason
 * unrepresentable: there is no flag to pass one and no variable to put one in.
 */
const AUTH_STEP_REASON =
  `OWNER PERSONA IDENTITY: ${OWNER_EXTERNAL_SUBJECT} AUTHENTICATION_ACCOUNT -- provisioning the `
  + "nonprod authentication identity that lets the owner Security Role be exercised through a "
  + "browser; Firebase supplies the login and the external subject and no business authority "
  + "(Owner ruling, Wave 12)";
const BINDING_STEP_REASON =
  `OWNER PERSONA IDENTITY: ${OWNER_EXTERNAL_SUBJECT} EXTERNAL_BINDING -- the identity model is one `
  + "external identity per Principal, so the canonical Owner Principal keeps its id, its owner Role "
  + "and every capability and moves only its authentication binding from the provider no verifier "
  + "recognizes to the one that does";

class OwnerIdentityBindingError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "OwnerIdentityBindingError";
    this.code = code;
  }
}
const refuse = (code, message) => {
  throw new OwnerIdentityBindingError(code, message);
};

/**
 * The two reasons must differ, and each must actually name its own step.
 *
 * A file-level check rather than a runtime one, because the failure it guards against is an EDIT:
 * collapsing two reasons into one shared constant re-creates exactly the run-level reason the ruling
 * forbids, and would otherwise do it silently.
 */
function assertDistinctStepReasons() {
  if (AUTH_STEP_REASON === BINDING_STEP_REASON) {
    refuse("RUN_LEVEL_REASON_REFUSED", "the two steps share one reason, which is a run-level reason");
  }
  for (const [what, reason, target] of [
    ["authentication", AUTH_STEP_REASON, "AUTHENTICATION_ACCOUNT"],
    ["binding", BINDING_STEP_REASON, "EXTERNAL_BINDING"],
  ]) {
    if (!reason.includes(target) || !reason.includes(OWNER_EXTERNAL_SUBJECT)) {
      refuse("REASON_NOT_SPECIFIC", `the ${what} reason does not name its own subject and target`);
    }
    // Mirrors the 500-character audit column and optionalReason().
    if (reason.length > 500) refuse("REASON_TOO_LONG", `the ${what} reason is ${reason.length} characters`);
  }
}

/**
 * THE PROHIBITION, AS A GUARD -- the same one provisionOwnerPersona.js carries, restated here
 * because this script could otherwise give the administering Principal a second login and call it
 * an Owner persona. Stated in this file's own refusal vocabulary so the message survives.
 */
function assertNotTheAdministrator(principalId, adminPrincipalId) {
  if (principalId === adminPrincipalId) {
    refuse("ADMIN_PRINCIPAL_REUSE_REFUSED",
      "the owner Principal resolved to the administering Principal; owner must be held by a Principal "
      + "of its own and this run never re-binds the identity of the authority it is running as");
  }
}

/**
 * Read the environment's PUBLIC Firebase Web configuration out of the registry.
 *
 * The project is NAMED on the command line and then CHECKED against the registry, rather than
 * derived from it. A derived project is a property of a file; a named one that must match is a
 * statement of intent that the file can refuse.
 */
function assertFirebaseTarget(args, environmentId) {
  const fs = require("node:fs");
  const path = require("node:path");
  const registry = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../../config/environments.json"), "utf8"),
  );
  const match = (registry.environments || []).find((e) => e && e.id === environmentId);
  const firebase = match && match.firebase;
  if (!firebase || !firebase.projectId) {
    refuse("ENVIRONMENT_HAS_NO_FIREBASE_PROJECT",
      `environment '${environmentId}' declares no Firebase project, so it has no identity provider to bind to`);
  }
  if (typeof args.projectId !== "string" || args.projectId.trim() === "" || args.projectId === "true") {
    refuse("ARGUMENT_REQUIRED",
      "--projectId <id> is required and is never inferred. The Firebase project must be named on the "
      + "command line being run, and it must match the one the named environment declares.");
  }
  if (args.projectId !== firebase.projectId) {
    refuse("PROJECT_MISMATCH",
      `--projectId '${args.projectId}' is not the project environment '${environmentId}' declares `
      + `('${firebase.projectId}'). Refusing rather than preferring either one.`);
  }
  if (!firebase.apiKey) {
    refuse("ENVIRONMENT_HAS_NO_WEB_CONFIG",
      `environment '${environmentId}' declares no Firebase Web apiKey, so no identity can be provisioned without a service-account key`);
  }
  return { projectId: firebase.projectId, apiKey: firebase.apiKey };
}

function assertInvocation(args, env) {
  const { environmentId, connectionString } = assertMeasurementTarget(args, env);
  assertNonprodRuntime(env);
  if (FROZEN_ENVIRONMENTS.includes(environmentId)) {
    refuse("ENVIRONMENT_FROZEN", `--environment '${environmentId}' is the Certification world, which is frozen.`);
  }
  for (const flag of ["tenantKey", "performedBy", "adminPrincipalId", "authIdentityEmail", "authPasswordEnv"]) {
    if (typeof args[flag] !== "string" || args[flag].trim() === "" || args[flag] === "true") {
      refuse("ARGUMENT_REQUIRED", `--${flag} is required and has no default`);
    }
  }
  if (!/^[A-Za-z0-9._@-]{1,100}$/.test(args.performedBy)) {
    refuse("ARGUMENT_REQUIRED", "--performedBy <operator> must be [A-Za-z0-9._@-], at most 100");
  }
  const email = args.authIdentityEmail.trim().toLowerCase();
  if (!email.endsWith(REQUIRED_EMAIL_SUFFIX)) {
    refuse("EMAIL_NOT_A_FIXTURE",
      `--authIdentityEmail must end '${REQUIRED_EMAIL_SUFFIX}'; refusing '${email}'. A deliverable address `
      + "is a person's mailbox, and this tool sets passwords on accounts.");
  }
  const firebaseTarget = assertFirebaseTarget(args, environmentId);

  // The password is read from the environment, never from argv, and its VALUE never leaves this
  // function -- only its adequacy is reported, and only as a refusal.
  const password = env[args.authPasswordEnv];
  if (typeof password !== "string" || password.length === 0) {
    refuse("PASSWORD_ENV_EMPTY",
      `--authPasswordEnv named '${args.authPasswordEnv}' but that environment variable is empty or unset. `
      + "The password is never an argument: argv appears in ps, in shell history and in CI logs.");
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    refuse("PASSWORD_TOO_SHORT",
      `the password in '${args.authPasswordEnv}' is shorter than ${MIN_PASSWORD_LENGTH} characters. `
      + "A short password on a real project is a real foothold, sandbox or not.");
  }

  return {
    environmentId,
    connectionString,
    projectId: firebaseTarget.projectId,
    apiKey: firebaseTarget.apiKey,
    tenantKey: args.tenantKey,
    performedBy: args.performedBy,
    adminPrincipalId: args.adminPrincipalId,
    authIdentityEmail: email,
    authPassword: password,
    apply: args.apply === "true",
  };
}

/**
 * Ensure the authentication identity exists, and return its REAL external subject.
 *
 * Two outcomes, and both are reconcilable:
 *   CREATED    the account did not exist; signUp minted it and returned its uid
 *   NO_CHANGE  the account existed and the supplied password signs in, which is how a re-run proves
 *              it is looking at the SAME account rather than assuming it
 *
 * An account that exists but does not accept the supplied password is REFUSED, never rotated. A tool
 * that silently reset a password would invalidate whatever the operator already had, and the failure
 * surfaces later as "invalid password", which sends you debugging the wrong thing entirely.
 *
 * Nothing here logs, returns or compares a password value.
 */
async function ensureAuthenticationIdentity(options, deps) {
  const post = deps.post;
  const signUp = await post("signUp", options.apiKey, {
    email: options.authIdentityEmail,
    password: options.authPassword,
    returnSecureToken: true,
  });
  if (signUp.ok) {
    return { outcome: "CREATED", externalSubject: signUp.body.localId, idToken: signUp.body.idToken };
  }
  const code = (signUp.body && signUp.body.error && signUp.body.error.message) || "UNKNOWN";
  if (!String(code).startsWith("EMAIL_EXISTS")) {
    refuse("AUTH_PROVISIONING_REFUSED",
      `the identity provider refused to create ${options.authIdentityEmail}: ${code}`);
  }
  const signIn = await post("signInWithPassword", options.apiKey, {
    email: options.authIdentityEmail,
    password: options.authPassword,
    returnSecureToken: true,
  });
  if (!signIn.ok) {
    const why = (signIn.body && signIn.body.error && signIn.body.error.message) || "UNKNOWN";
    refuse("CREDENTIAL_ACCESS_FAILED",
      `${options.authIdentityEmail} already exists in ${options.projectId} and the password in the named `
      + `environment variable does not sign in (${why}). This tool never rotates a password it did not set. `
      + "Set the password for that account in the Firebase Console for this project, put the same value in "
      + "the environment variable, and re-run.");
  }
  return { outcome: "NO_CHANGE", externalSubject: signIn.body.localId, idToken: signIn.body.idToken };
}

/**
 * Bind (or reconcile) the Owner persona's authentication identity. `pool` is a pg Pool.
 *
 * Returns a per-step report. Every step says CREATED, REBOUND, NO_CHANGE or PLANNED, measured by
 * reading the state before the step rather than by trusting a command's return value.
 */
async function bindOwnerPersonaIdentity(pool, options, deps) {
  assertDistinctStepReasons();
  const { PostgresPolicyRepository, rebindPrincipalIdentity, hasAdministrationAuthority } = deps;
  const repo = new PostgresPolicyRepository(pool);

  const tenant = await repo.getTenantByKey(options.tenantKey);
  if (!tenant) refuse("TENANT_NOT_FOUND", `no tenant with key ${options.tenantKey}; this run never creates one`);
  const tenantId = tenant.id;

  // The administering authority is READ, never asserted. A fabricated capability set would make the
  // governed command's own gate decorative, which is the one thing a provisioning run must never do
  // to the guard it is standing in front of.
  const admin = await repo.getPrincipal(options.adminPrincipalId);
  const adminMembership = admin ? await repo.getMembership(tenantId, admin.id) : null;
  if (!admin || admin.status !== "active" || !adminMembership || adminMembership.status !== "active") {
    refuse("ADMINISTRATOR_INVALID",
      "--adminPrincipalId must name an active Principal with an active membership in this tenant");
  }
  const roles = await repo.listRoles(tenantId);
  const roleKeyById = new Map(roles.map((r) => [r.id, r.key]));
  const heldRoleKeys = (await repo.listAssignmentsForPrincipal(tenantId, admin.id))
    .filter((a) => a.status === "active").map((a) => roleKeyById.get(a.roleId)).filter(Boolean);
  if (!hasAdministrationAuthority(heldRoleKeys, "assignRole")) {
    refuse("ADMINISTRATOR_INVALID",
      "the named administrator Principal holds no Role that may assign Roles; this run asserts no authority of its own");
  }

  // THE TARGET IS FOUND BY ITS AUTHORITY, not by an id typed on the command line: the Principal that
  // actually holds `owner` today. An id could be mistyped into pointing at somebody else, and this
  // script's whole promise is that it moves a login and not an authority.
  const ownerRole = roles.find((r) => r.key === OWNER_ROLE_KEY);
  if (!ownerRole) {
    refuse("ROLE_NOT_DEFINED", `Security Role ${OWNER_ROLE_KEY} is not defined in this tenant`);
  }
  const ownerHoldersBefore = (await pool.query(
    `SELECT a.id AS assignment_id, p.id, p.external_subject, p.identity_provider, p.display_name, p.status
       FROM eos_policy.user_role_assignments a
       JOIN eos_policy.principals p ON p.id = a.principal_id
      WHERE a.tenant_id = $1 AND a.role_id = $2 AND a.status = 'active'
      ORDER BY p.external_subject`,
    [tenantId, ownerRole.id])).rows;
  if (ownerHoldersBefore.length !== 1) {
    refuse("OWNER_HOLDER_NOT_UNIQUE",
      `${OWNER_ROLE_KEY} has ${ownerHoldersBefore.length} active holders; this run binds exactly one canonical `
      + "Owner Principal and refuses to choose between several");
  }
  const target = ownerHoldersBefore[0];
  assertNotTheAdministrator(target.id, admin.id);
  if (target.status !== "active") {
    refuse("OWNER_PRINCIPAL_INACTIVE", "the owner Principal is not active; this run never changes a status");
  }

  const displayName = boundDisplayName(options.authIdentityEmail);
  const alreadyBound = target.identity_provider === FIREBASE_IDENTITY_PROVIDER
    && target.display_name === displayName;

  const steps = [];
  let externalSubject = null;

  // ---- STEP 1. The authentication identity. NO NETWORK CALL IN A DRY RUN.
  if (!options.apply) {
    steps.push({ step: "authenticationIdentity", outcome: "PLANNED", reason: AUTH_STEP_REASON });
  } else {
    const auth = await ensureAuthenticationIdentity(options, deps);
    externalSubject = auth.externalSubject;
    if (typeof externalSubject !== "string" || externalSubject.length === 0) {
      refuse("AUTH_SUBJECT_MISSING", "the identity provider returned no subject for that account");
    }
    steps.push({ step: "authenticationIdentity", outcome: auth.outcome, reason: AUTH_STEP_REASON });
  }

  // ---- STEP 2. The external binding on the canonical Owner Principal.
  const bindingPresent = alreadyBound && externalSubject !== null
    && target.external_subject === externalSubject;
  if (!options.apply) {
    steps.push({ step: "principalIdentityBinding", outcome: "PLANNED", reason: BINDING_STEP_REASON });
  } else if (bindingPresent) {
    steps.push({ step: "principalIdentityBinding", outcome: "NO_CHANGE", reason: BINDING_STEP_REASON });
  } else {
    await rebindPrincipalIdentity(repo, { tenantId, uid: options.performedBy, heldRoleKeys }, {
      principalId: target.id,
      identityProvider: FIREBASE_IDENTITY_PROVIDER,
      externalSubject,
      displayName,
      reason: BINDING_STEP_REASON,
    });
    steps.push({ step: "principalIdentityBinding", outcome: "REBOUND", reason: BINDING_STEP_REASON });
  }

  // ---- The invariants this run is accountable for, MEASURED after the fact rather than claimed.
  const after = await repo.getPrincipal(target.id);
  const directGrants = (await pool.query(
    "SELECT count(*)::int AS n FROM eos_policy.principal_capabilities")).rows[0].n;
  const roleGrants = (await pool.query(
    "SELECT count(*)::int AS n FROM eos_policy.role_capabilities")).rows[0].n;
  const ownerHoldersAfter = (await pool.query(
    `SELECT a.id AS assignment_id, p.id, p.external_subject, p.identity_provider
       FROM eos_policy.user_role_assignments a
       JOIN eos_policy.principals p ON p.id = a.principal_id
      WHERE a.tenant_id = $1 AND a.role_id = $2 AND a.status = 'active'
      ORDER BY p.external_subject`,
    [tenantId, ownerRole.id])).rows;
  const syntheticStillBound = (await pool.query(
    "SELECT count(*)::int AS n FROM eos_policy.principals WHERE identity_provider = $1 AND external_subject = $2",
    [SYNTHETIC_IDENTITY_PROVIDER, OWNER_EXTERNAL_SUBJECT])).rows[0].n;

  return {
    environment: options.environmentId,
    projectId: options.projectId,
    tenantKey: options.tenantKey,
    tenantId,
    apply: options.apply,
    authIdentityEmail: options.authIdentityEmail,
    ownerPrincipalId: target.id,
    ownerRoleAssignmentId: target.assignment_id,
    identityProviderBefore: target.identity_provider,
    externalSubjectBefore: target.external_subject,
    identityProviderAfter: after ? after.identityProvider : null,
    externalSubjectAfter: after ? after.externalSubject : null,
    adminPrincipalId: admin.id,
    steps,
    invariants: {
      principalCapabilities: directGrants,
      roleCapabilities: roleGrants,
      // THE POINT OF SHAPE (a), measured: one holder, the SAME Principal id, the SAME assignment id.
      ownerHolders: ownerHoldersAfter,
      ownerPrincipalIdUnchanged: ownerHoldersAfter.length === 1 && ownerHoldersAfter[0].id === target.id,
      ownerAssignmentIdUnchanged:
        ownerHoldersAfter.length === 1 && ownerHoldersAfter[0].assignment_id === target.assignment_id,
      adminPrincipalReused: ownerHoldersAfter.some((r) => r.id === admin.id),
      syntheticSubjectStillPresent: syntheticStillBound,
    },
  };
}

/** ONE http shape for every Identity Toolkit call. No credential is ever logged or returned. */
function makePost() {
  return async (method, apiKey, body) => {
    const res = await fetch(`${IDENTITY_TOOLKIT}:${method}?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    let parsed = null;
    try {
      parsed = await res.json();
    } catch {
      parsed = null;
    }
    return { ok: res.ok, body: parsed || {} };
  };
}

async function main() {
  const options = assertInvocation(parseArgs(process.argv.slice(2)), process.env);
  const pg = require("pg");
  const { resolvePolicyDatabaseConfig } = require("../lib/adminPolicy/policyDatabase.js");
  const deps = {
    PostgresPolicyRepository: require("../lib/adminPolicy/postgresPolicyRepository.js").PostgresPolicyRepository,
    rebindPrincipalIdentity: require("../lib/adminPolicy/policyCommands.js").rebindPrincipalIdentity,
    hasAdministrationAuthority: require("../lib/adminPolicy/administrationAuthority.js").hasAdministrationAuthority,
    post: makePost(),
  };
  const pool = new pg.Pool(resolvePolicyDatabaseConfig({ connectionString: options.connectionString }));
  try {
    const report = await bindOwnerPersonaIdentity(pool, options, deps);
    console.log(JSON.stringify(report, null, 2));
    // A direct Principal grant, a widened Role catalog, a moved Principal or a moved assignment is a
    // failure of this run's own terms -- reported as a non-zero exit rather than buried in a field
    // nobody reads.
    const violated = report.invariants.principalCapabilities !== 0
      || report.invariants.adminPrincipalReused
      || (report.apply && !report.invariants.ownerPrincipalIdUnchanged)
      || (report.apply && !report.invariants.ownerAssignmentIdUnchanged);
    process.exitCode = violated ? 2 : 0;
  } finally {
    await pool.end();
  }
}

module.exports = {
  assertInvocation,
  assertDistinctStepReasons,
  assertFirebaseTarget,
  assertNotTheAdministrator,
  bindOwnerPersonaIdentity,
  ensureAuthenticationIdentity,
  boundDisplayName,
  AUTH_STEP_REASON,
  BINDING_STEP_REASON,
  FIREBASE_IDENTITY_PROVIDER,
  REQUIRED_EMAIL_SUFFIX,
  MIN_PASSWORD_LENGTH,
};

if (require.main === module) {
  main().catch((err) => {
    const governed = err instanceof OwnerIdentityBindingError;
    console.error(JSON.stringify({
      outcome: "REFUSED_OR_FAILED",
      message: governed || (err && typeof err.message === "string" && !err.code)
        ? (err instanceof Error ? err.message : String(err))
        : "the run could not be completed",
    }, null, 2));
    process.exitCode = 2;
  });
}
