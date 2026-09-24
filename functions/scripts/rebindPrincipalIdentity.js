// RE-POINTING ANY GOVERNED PRINCIPAL AT A NEW AUTHENTICATION IDENTITY -- the generic operator entry
// point for the `rebindPrincipalIdentity` governed command.
//
// ============================ THE GAP THIS CLOSES ============================
//
// `rebindPrincipalIdentity` in src/adminPolicy/policyCommands.ts is GENERAL: it takes a principalId
// and moves that Principal's (identity_provider, external_subject, display_name) and nothing else.
// It is absent from ADMIN_MUTATION_OPERATIONS, so no HTTP admin operation reaches it -- an operator
// script is the ONLY entry point it has.
//
// The only operator script that existed was scripts/bindOwnerPersonaIdentity.js, which is hard-coded
// to the Owner persona: it has no --principalId at all and finds its target by the `owner` Security
// Role. So when a NON-Owner Principal's live authentication uid drifted from its EOS binding (the
// Dispatcher persona), the governed command had to be driven through an uncommitted local one-off
// driver. A governed command whose only reviewed caller covers one Principal is, for every other
// Principal, an ungoverned command.
//
// This is that entry point, for any Principal, with the fences and the measurements committed.
//
// ============================ WHAT IT DOES AND DOES NOT DO ============================
//
//   MOVES      identity_provider, external_subject, display_name on ONE named Principal, and the
//              access version, exactly as the governed command already bumps it.
//   PRESERVES  the Principal id, its tenant membership, its Employee link, its Security Role
//              assignments, its Work Eligibility, its Operational Scope and its direct capability
//              grants -- each MEASURED before and after rather than asserted, because "the authority
//              did not move" is the entire promise of a re-bind.
//   NEVER      creates a Principal, a membership, an Employee, a Role, an assignment, a capability
//              or a grant. Never changes a status. Never touches Firestore -- there is no Firestore
//              client in this process. Never creates, rotates, fetches or prints an authentication
//              credential: the new external subject is an IDENTIFIER the operator already has, and
//              this tool contacts no identity provider at all.
//
// ============================ THE AUTHORITY IS READ, NEVER ARGUED ============================
//
// The administering Principal is NAMED on the command line and its Roles are then READ FROM
// PostgreSQL -- active assignments, mapped roleId -> role key through the tenant's Role catalog --
// and put through hasAdministrationAuthority(heldRoleKeys, "assignRole"), the same gate the governed
// command applies to the actor it is handed. There is no flag that supplies a Role, a Role key, a
// capability or an entitlement, and a flag this tool does not know is REFUSED rather than ignored:
// an argument that widens authority must be unrepresentable, not merely unused.
//
// A Firebase ID token, uid or custom claim is not business authority anywhere in this file. The uid
// is what a verifier can produce; every question about what that login may DO is answered by
// PostgreSQL.
//
// ============================ NO RAW SQL MUTATION ============================
//
// Every write goes through the governed command, which carries the authority gate, the transaction,
// the version bump and the ONE audit event holding BOTH bindings in before/after. The SQL in this
// file is SELECT-only, and it exists to MEASURE: to read the before state, to read the after state,
// and to compare them. A manual UPDATE of external_subject is the act this tool exists to replace.
//
// ============================ THE FENCES ============================
//
//   NAMED TARGET     --environment must match an id in config/environments.json. Nothing is inferred
//                    from cwd, .firebaserc, gcloud, ambient credentials or process.env.
//   PRODUCTION       refused twice over -- by declared role and by the customer project id.
//   CERTIFICATION    the frozen Certification world refused by id.
//   POSITIVELY       EOS_ENVIRONMENT must read exactly 'nonprod' in this process. Refusing
//   NONPROD          production is not the same as knowing the target is nonprod.
//   COMPARE-AND-SWAP --expectedOldSubject, when given, must equal the subject on the Principal RIGHT
//                    NOW. It is how an operator says "the row I read is the row I am changing".
//   SELF             the administering Principal may not be the target. An administrator re-pointing
//                    their own login is an account takeover with a reason field.
//   DRY RUN          the default. --apply is required to write, and a dry run writes nothing.
//
// Usage:
//   node scripts/rebindPrincipalIdentity.js \
//     --environment platform-sandbox --databaseUrlEnv DATABASE_URL --tenantKey taylor-nonprod \
//     --adminPrincipalId <ADMIN_PRINCIPAL_ID> --principalId <TARGET_PRINCIPAL_ID> \
//     --newExternalSubject <AUTH_UID> --reason "<specific reason naming the target Principal id>" \
//     [--expectedOldSubject <CURRENT_SUBJECT>] [--identityProvider firebase] \
//     [--displayName "..."] [--apply]
//
// THE REASON IS MANDATORY AND MUST BE SPECIFIC: at least 40 characters and it must NAME THE TARGET
// PRINCIPAL ID. "specific" has to be checkable or it is decoration, and the one thing a reader of
// this audit row will need is which Principal the sentence is about.
//
// Exit 0 when the run is clean (PLANNED, REBOUND or NO_CHANGE); 2 when refused, when a preserved
// dimension moved, or when more than one audit event was appended.
"use strict";

const { assertMeasurementTarget, parseArgs } = require("./measureEmployeeReferenceIntegrity.js");
const { assertNonprodRuntime } = require("./measureWorkforceActivation.js");

const FROZEN_ENVIRONMENTS = Object.freeze(["platform-certification"]);

/** Every flag this tool understands. Anything else is refused, not ignored. */
const KNOWN_FLAGS = Object.freeze([
  "environment", "databaseUrlEnv", "tenantKey", "adminPrincipalId", "principalId",
  "newExternalSubject", "reason", "expectedOldSubject", "identityProvider", "displayName", "apply",
]);

/**
 * Flag names that would be an attempt to SUPPLY authority (or a credential) rather than name a
 * target. They are already covered by the unknown-flag refusal; they are named separately so the
 * refusal says WHY, and so a reader of this file can see the boundary rather than infer it.
 */
const AUTHORITY_BEARING_FLAGS = Object.freeze([
  "heldRoleKeys", "heldRoles", "roleKeys", "roles", "role", "capabilities", "capability",
  "entitlements", "grant", "grants", "permissions",
]);
const CREDENTIAL_BEARING_FLAGS = Object.freeze([
  "password", "authPassword", "authPasswordEnv", "token", "idToken", "secret", "credential",
  "credentials", "serviceAccount", "serviceAccountKey", "apiKey", "databaseUrl", "connectionString",
]);

/** The one provider string any verifier in this platform can produce. */
const DEFAULT_IDENTITY_PROVIDER = "firebase";
const MIN_REASON_LENGTH = 40;
/** Mirrors the audit reason column and optionalReason(). */
const MAX_REASON_LENGTH = 500;
const MAX_DISPLAY_NAME_LENGTH = 200;

class PrincipalRebindError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "PrincipalRebindError";
    this.code = code;
  }
}
const refuse = (code, message) => {
  throw new PrincipalRebindError(code, message);
};

/**
 * THE PROHIBITION, AS A GUARD. An administrator who can re-point their OWN binding can hand their
 * own authority to any uid they like, and the audit row would read as an ordinary maintenance act.
 */
function assertNotTheAdministrator(principalId, adminPrincipalId) {
  if (principalId === adminPrincipalId) {
    refuse("ADMIN_PRINCIPAL_SELF_REBIND_REFUSED",
      "--principalId names the administering Principal itself. This run never re-binds the identity of "
      + "the authority it is running as: that is not a governed re-bind, it is an account takeover with "
      + "a reason field attached.");
  }
}

/** A reason a later reader can act on: long enough to be a sentence, and it names its own target. */
function assertSpecificReason(reason, principalId) {
  const trimmed = reason.trim();
  if (trimmed.length < MIN_REASON_LENGTH) {
    refuse("REASON_NOT_SPECIFIC",
      `--reason is ${trimmed.length} characters; at least ${MIN_REASON_LENGTH} are required. A re-bind `
      + "moves which login resolves to a standing authority, and 'fix' is not an account of that.");
  }
  if (trimmed.length > MAX_REASON_LENGTH) {
    refuse("REASON_TOO_LONG", `--reason is ${trimmed.length} characters; the audit column holds ${MAX_REASON_LENGTH}`);
  }
  if (!trimmed.includes(principalId)) {
    refuse("REASON_NOT_SPECIFIC",
      "--reason must NAME THE TARGET PRINCIPAL ID. A reason that does not say which Principal it is "
      + "about is not specific, and it is the first thing a reader of the audit row will need.");
  }
}

/**
 * Refuse before anything is loaded that could contact anything.
 *
 * Order matters and is the property under test: the target is named, production is refused, the
 * runtime is positively identified as nonprod, and only then is any argument shaped. Throws BEFORE
 * the caller has required `pg`.
 */
function assertInvocation(args, env) {
  for (const flag of Object.keys(args)) {
    if (KNOWN_FLAGS.includes(flag)) continue;
    if (AUTHORITY_BEARING_FLAGS.includes(flag)) {
      refuse("AUTHORITY_ARGUMENT_REFUSED",
        `--${flag} would SUPPLY authority. The administering Principal's Roles are READ FROM PostgreSQL `
        + "from its active assignments; no Role, capability, entitlement or grant is ever accepted as an "
        + "argument, because an asserted capability set makes the governed command's own gate decorative.");
    }
    if (CREDENTIAL_BEARING_FLAGS.includes(flag)) {
      refuse("CREDENTIAL_ARGUMENT_REFUSED",
        `--${flag} would put a credential on a command line. argv appears in ps, in shell history and in `
        + "CI logs. This tool creates, rotates, fetches and prints no credential of any kind, and the "
        + "connection string is named by --databaseUrlEnv rather than passed.");
    }
    refuse("UNKNOWN_FLAG_REFUSED",
      `--${flag} is not a flag this tool understands. An unrecognized flag is REFUSED rather than `
      + `ignored: a misspelled fence is a missing fence. Known flags: ${KNOWN_FLAGS.map((f) => `--${f}`).join(" ")}`);
  }

  const { environmentId, connectionString } = assertMeasurementTarget(args, env);
  assertNonprodRuntime(env);
  if (FROZEN_ENVIRONMENTS.includes(environmentId)) {
    refuse("ENVIRONMENT_FROZEN",
      `--environment '${environmentId}' is the Certification world, which is frozen. Its authority genesis `
      + "is a recorded fact and a re-bind would rewrite it.");
  }

  for (const flag of ["tenantKey", "adminPrincipalId", "principalId", "newExternalSubject", "reason"]) {
    if (typeof args[flag] !== "string" || args[flag].trim() === "" || args[flag] === "true") {
      refuse("ARGUMENT_REQUIRED", `--${flag} is required and has no default`);
    }
  }
  const principalId = args.principalId.trim();
  const adminPrincipalId = args.adminPrincipalId.trim();
  const newExternalSubject = args.newExternalSubject.trim();
  assertNotTheAdministrator(principalId, adminPrincipalId);
  assertSpecificReason(args.reason, principalId);

  if (newExternalSubject.length > 255 || /\s/.test(newExternalSubject)) {
    refuse("SUBJECT_MALFORMED",
      "--newExternalSubject must be a single whitespace-free identifier of at most 255 characters. It is "
      + "the uid a verifier produces, never a token.");
  }
  const identityProvider = args.identityProvider === undefined
    ? DEFAULT_IDENTITY_PROVIDER
    : String(args.identityProvider).trim();
  if (args.identityProvider === "true" || identityProvider === "" || !/^[a-z][a-z0-9_-]{0,31}$/.test(identityProvider)) {
    refuse("IDENTITY_PROVIDER_MALFORMED",
      "--identityProvider must be a lowercase provider key such as 'firebase'; it defaults to "
      + `'${DEFAULT_IDENTITY_PROVIDER}', which is the one string this platform's verifiers produce.`);
  }

  let displayName;
  if (args.displayName !== undefined) {
    if (args.displayName === "true" || String(args.displayName).trim() === "") {
      refuse("ARGUMENT_REQUIRED",
        "--displayName was given with no value. Omit the flag entirely to KEEP the Principal's current "
        + "display name; there is no way to blank it here.");
    }
    displayName = String(args.displayName).trim();
    if (displayName.length > MAX_DISPLAY_NAME_LENGTH) {
      refuse("DISPLAY_NAME_TOO_LONG", `--displayName is ${displayName.length} characters; at most ${MAX_DISPLAY_NAME_LENGTH}`);
    }
  }

  let expectedOldSubject;
  if (args.expectedOldSubject !== undefined) {
    if (args.expectedOldSubject === "true" || String(args.expectedOldSubject).trim() === "") {
      refuse("ARGUMENT_REQUIRED",
        "--expectedOldSubject was given with no value. It is the compare-and-swap guard, so an empty one "
        + "is a guard that cannot fail; omit the flag if you are deliberately not asserting the old subject.");
    }
    expectedOldSubject = String(args.expectedOldSubject).trim();
  }

  return {
    environmentId,
    connectionString,
    tenantKey: args.tenantKey.trim(),
    adminPrincipalId,
    principalId,
    identityProvider,
    newExternalSubject,
    expectedOldSubject,
    displayName,
    reason: args.reason.trim(),
    apply: args.apply === "true",
  };
}

// ---------------------------------------------------------------- the measured dimensions
//
// EVERY QUERY HERE IS A SELECT. The only write in this file goes through the governed command.

/**
 * Read every authority dimension that a re-bind must leave alone, keyed on the Principal.
 *
 * Work Eligibility and Operational Scope are Employee-keyed, so they are reached through the
 * Principal's Employee links -- which is also why the links themselves are part of the measurement:
 * if a link moved, the eligibility comparison would be comparing two different Employees and would
 * pass while the authority had in fact changed.
 */
async function readAuthorityDimensions(pool, tenantId, principalId) {
  const principal = (await pool.query(
    "SELECT id, identity_provider, external_subject, display_name, status FROM eos_policy.principals WHERE id = $1",
    [principalId])).rows[0] || null;
  const memberships = (await pool.query(
    "SELECT id, tenant_id, status FROM eos_policy.tenant_memberships WHERE principal_id = $1 ORDER BY tenant_id, id",
    [principalId])).rows;
  const securityRoles = (await pool.query(
    `SELECT a.id, r.key AS role_key, a.scope_type, a.scope_value, a.status
       FROM eos_policy.user_role_assignments a
       JOIN eos_policy.roles r ON r.id = a.role_id
      WHERE a.principal_id = $1 ORDER BY r.key, a.scope_type, a.id`,
    [principalId])).rows;
  const employeeLinks = (await pool.query(
    `SELECT id, tenant_id, employee_id, operating_company_id, link_source, status
       FROM eos_policy.employee_principal_links WHERE principal_id = $1 ORDER BY id`,
    [principalId])).rows;
  const employeeIds = employeeLinks.map((l) => l.employee_id);
  const workEligibility = (await pool.query(
    `SELECT id, employee_id, qualification_code, effective_from, effective_to
       FROM eos_workforce.employee_work_eligibility
      WHERE tenant_id = $1 AND employee_id = ANY($2::text[]) ORDER BY employee_id, qualification_code, id`,
    [tenantId, employeeIds])).rows;
  const operationalScope = (await pool.query(
    `SELECT id, employee_id, scope_type, scope_id, effective_from, effective_to
       FROM eos_workforce.employee_operational_scopes
      WHERE tenant_id = $1 AND employee_id = ANY($2::text[]) ORDER BY employee_id, scope_type, scope_id, id`,
    [tenantId, employeeIds])).rows;
  const directGrants = (await pool.query(
    `SELECT c.key FROM eos_policy.principal_capabilities pc
       JOIN eos_policy.capabilities c ON c.id = pc.capability_id
      WHERE pc.principal_id = $1 ORDER BY c.key`,
    [principalId])).rows.map((r) => r.key);

  return {
    principalId: principal ? principal.id : null,
    status: principal ? principal.status : null,
    identityProvider: principal ? principal.identity_provider : null,
    externalSubject: principal ? principal.external_subject : null,
    displayName: principal ? principal.display_name : null,
    memberships,
    securityRoles,
    employeeLinks,
    workEligibility,
    operationalScope,
    directGrants,
    directGrantCount: directGrants.length,
  };
}

/** The dimensions a re-bind must not move. The identity fields are deliberately NOT in this list. */
const PRESERVED_KEYS = Object.freeze([
  "principalId", "status", "memberships", "securityRoles", "employeeLinks",
  "workEligibility", "operationalScope", "directGrants",
]);

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** The stored access version, or null when no row exists yet. Never a record, so it compares. */
const accessVersionOf = async (repo, tenantId, principalId) => {
  const row = await repo.getAccessVersion(tenantId, principalId);
  return row ? row.accessVersion : null;
};

const countRebindAudits = async (pool, principalId) => (await pool.query(
  `SELECT count(*)::int AS n FROM eos_policy.audit_events
    WHERE action = 'rebindPrincipalIdentity' AND target_id = $1`, [principalId])).rows[0].n;

/**
 * Re-bind (or plan, or reconcile) one Principal's authentication identity. `pool` is a pg Pool.
 *
 * `deps` carries the governed command and the repository so this is provable against a real database
 * without a process boundary, exactly as the Owner-persona binding is.
 */
async function rebindPrincipalIdentityRun(pool, options, deps) {
  const { PostgresPolicyRepository, rebindPrincipalIdentity, hasAdministrationAuthority } = deps;
  const repo = new PostgresPolicyRepository(pool);

  const tenant = await repo.getTenantByKey(options.tenantKey);
  if (!tenant) {
    refuse("TENANT_NOT_FOUND", `no tenant with key '${options.tenantKey}'; this run never creates one`);
  }
  const tenantId = tenant.id;

  // ---- THE ADMINISTERING AUTHORITY, READ FROM POSTGRESQL. Never accepted from argv.
  const admin = await repo.getPrincipal(options.adminPrincipalId);
  const adminMembership = admin ? await repo.getMembership(tenantId, admin.id) : null;
  if (!admin || admin.status !== "active" || !adminMembership || adminMembership.status !== "active") {
    refuse("ADMINISTRATOR_INVALID",
      "--adminPrincipalId must name an active Principal with an active membership in this tenant");
  }
  const roles = await repo.listRoles(tenantId);
  const roleKeyById = new Map(roles.map((r) => [r.id, r.key]));
  // listAssignmentsForPrincipal returns roleId, NOT roleKey -- the catalog is what turns one into the
  // other, and skipping the map yields [null] and a refusal. That refusal is the gate working.
  const heldRoleKeys = (await repo.listAssignmentsForPrincipal(tenantId, admin.id))
    .filter((a) => a.status === "active").map((a) => roleKeyById.get(a.roleId)).filter(Boolean);
  if (!hasAdministrationAuthority(heldRoleKeys, "assignRole")) {
    refuse("ADMINISTRATOR_UNAUTHORIZED",
      "the named administering Principal holds no active Role that may assign Roles (owner, generalManager "
      + "or admin). Naming who a Principal IS is assignment-shaped authority, and this run asserts no "
      + "authority of its own.");
  }

  // ---- THE TARGET. Refused here as well as in the command, so a DRY RUN reports the refusal.
  assertNotTheAdministrator(options.principalId, admin.id);
  const before = await readAuthorityDimensions(pool, tenantId, options.principalId);
  if (before.principalId === null) {
    refuse("TARGET_PRINCIPAL_NOT_FOUND",
      `no Principal '${options.principalId}'; this run never creates one, so it can never introduce an authority holder`);
  }
  const targetMembership = await repo.getMembership(tenantId, options.principalId);
  if (!targetMembership || targetMembership.status !== "active") {
    refuse("TARGET_MEMBERSHIP_INACTIVE",
      `Principal '${options.principalId}' is not an ACTIVE member of tenant '${options.tenantKey}'. A binding on a `
      + "Principal that resolves to no context in this tenant confers nothing and is not this tool's business.");
  }

  // ---- COMPARE-AND-SWAP. "The row I read is the row I am changing."
  if (options.expectedOldSubject !== undefined && before.externalSubject !== options.expectedOldSubject) {
    refuse("EXPECTED_SUBJECT_MISMATCH",
      `--expectedOldSubject does not match the subject Principal '${options.principalId}' holds right now. `
      + "Refusing rather than proceeding: the state you read is not the state you are about to change.");
  }

  // ---- THE CLASH CHECK, pre-flighted so a dry run reports it. The command enforces it again on write.
  const clash = await repo.getPrincipalBySubject(options.identityProvider, options.newExternalSubject);
  if (clash && clash.id !== options.principalId) {
    refuse("IDENTITY_ALREADY_HELD",
      `another Principal already holds ('${options.identityProvider}', that subject). Two Principals for one `
      + "login would split one human's Roles, and folding them together silently would be worse. Refused.");
  }

  const effectiveDisplayName = options.displayName === undefined ? before.displayName : options.displayName;
  const alreadyBound = before.identityProvider === options.identityProvider
    && before.externalSubject === options.newExternalSubject
    && before.displayName === effectiveDisplayName;

  const accessVersionBefore = await accessVersionOf(repo, tenantId, options.principalId);
  const auditsBefore = await countRebindAudits(pool, options.principalId);

  let outcome;
  if (!options.apply) {
    // A DRY RUN WRITES NOTHING. Not a row, not a version bump, not an audit event.
    outcome = alreadyBound ? "NO_CHANGE" : "PLANNED";
  } else {
    // The governed command, always. When the binding is already what was asked for, the command's own
    // silent no-op is what produces NO_CHANGE -- measured from the audit count, not assumed.
    await rebindPrincipalIdentity(
      repo,
      { tenantId, uid: admin.id, heldRoleKeys },
      {
        principalId: options.principalId,
        identityProvider: options.identityProvider,
        externalSubject: options.newExternalSubject,
        // undefined means KEEP, which is the command's own contract for this field.
        displayName: options.displayName,
        reason: options.reason,
      },
    );
    outcome = alreadyBound ? "NO_CHANGE" : "REBOUND";
  }

  const after = await readAuthorityDimensions(pool, tenantId, options.principalId);
  const accessVersionAfter = await accessVersionOf(repo, tenantId, options.principalId);
  const auditsAfter = await countRebindAudits(pool, options.principalId);

  const preserved = {};
  for (const key of PRESERVED_KEYS) preserved[key] = same(before[key], after[key]);

  return {
    tool: "rebindPrincipalIdentity",
    environment: options.environmentId,
    tenantKey: options.tenantKey,
    tenantId,
    apply: options.apply,
    outcome,
    adminPrincipalId: admin.id,
    // The DERIVED keys, printed so the derivation is visible in the receipt rather than trusted.
    adminHeldRoleKeys: [...heldRoleKeys].sort(),
    adminAuthoritySource: "postgresql:eos_policy.user_role_assignments",
    principalId: options.principalId,
    expectedOldSubjectAsserted: options.expectedOldSubject !== undefined,
    identityProviderBefore: before.identityProvider,
    externalSubjectBefore: before.externalSubject,
    displayNameBefore: before.displayName,
    identityProviderAfter: after.identityProvider,
    externalSubjectAfter: after.externalSubject,
    displayNameAfter: after.displayName,
    accessVersionBefore,
    accessVersionAfter,
    auditEvents: {
      rebindEventsBefore: auditsBefore,
      rebindEventsAfter: auditsAfter,
      appended: auditsAfter - auditsBefore,
    },
    preserved,
    dimensions: { before, after },
  };
}

/** Did this run break its own terms? Reported as a non-zero exit, not buried in a field. */
function violations(report) {
  const out = [];
  for (const key of PRESERVED_KEYS) {
    if (!report.preserved[key]) out.push(`preserved dimension moved: ${key}`);
  }
  const { appended } = report.auditEvents;
  if (!report.apply && appended !== 0) out.push(`a dry run appended ${appended} audit event(s)`);
  if (report.apply && report.outcome === "NO_CHANGE" && appended !== 0) {
    out.push(`a NO_CHANGE run appended ${appended} audit event(s)`);
  }
  if (report.apply && report.outcome === "REBOUND" && appended !== 1) {
    out.push(`a re-bind appended ${appended} audit event(s); exactly one is the contract`);
  }
  if (!report.apply && report.accessVersionAfter !== report.accessVersionBefore) {
    out.push("a dry run moved the access version");
  }
  return out;
}

async function main() {
  const options = assertInvocation(parseArgs(process.argv.slice(2)), process.env);
  const pg = require("pg");
  const { resolvePolicyDatabaseConfig } = require("../lib/adminPolicy/policyDatabase.js");
  const deps = {
    PostgresPolicyRepository: require("../lib/adminPolicy/postgresPolicyRepository.js").PostgresPolicyRepository,
    rebindPrincipalIdentity: require("../lib/adminPolicy/policyCommands.js").rebindPrincipalIdentity,
    hasAdministrationAuthority: require("../lib/adminPolicy/administrationAuthority.js").hasAdministrationAuthority,
  };
  const pool = new pg.Pool(resolvePolicyDatabaseConfig({ connectionString: options.connectionString }));
  try {
    const report = await rebindPrincipalIdentityRun(pool, options, deps);
    console.log(JSON.stringify(report, null, 2));
    const broke = violations(report);
    if (broke.length > 0) console.error(JSON.stringify({ outcome: "TERMS_VIOLATED", violations: broke }, null, 2));
    process.exitCode = broke.length > 0 ? 2 : 0;
  } finally {
    await pool.end();
  }
}

module.exports = {
  assertInvocation,
  assertNotTheAdministrator,
  assertSpecificReason,
  readAuthorityDimensions,
  rebindPrincipalIdentityRun,
  violations,
  AUTHORITY_BEARING_FLAGS,
  CREDENTIAL_BEARING_FLAGS,
  DEFAULT_IDENTITY_PROVIDER,
  KNOWN_FLAGS,
  MIN_REASON_LENGTH,
  PRESERVED_KEYS,
};

if (require.main === module) {
  main().catch((err) => {
    const governed = err instanceof PrincipalRebindError;
    console.error(JSON.stringify({
      outcome: "REFUSED_OR_FAILED",
      message: governed || (err && typeof err.message === "string")
        ? (err instanceof Error ? err.message : String(err))
        : "the run could not be completed",
    }, null, 2));
    process.exitCode = 2;
  });
}
