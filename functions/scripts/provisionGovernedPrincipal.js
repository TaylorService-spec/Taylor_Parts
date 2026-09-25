// ADMITTING ONE GOVERNED PRINCIPAL TO ONE TENANT -- the generic operator entry point for the
// existing governed command `ensureTenantPrincipal`.
//
// ============================ THE MEASUREMENT THAT DECIDED THIS FILE'S SHAPE ============================
//
// A governed Principal creation command ALREADY EXISTS: `ensureTenantPrincipal`
// (src/adminPolicy/tenantBootstrap.ts). It creates the Principal, binds
// (identity_provider, external_subject), creates or re-activates an ACTIVE tenant membership, assigns
// NO Security Role, creates NO Employee, runs in ONE transaction scoped to ONE tenant, and appends
// ONE `tenant.addPrincipal` audit event carrying a per-step reason.
//
// SO NOTHING HERE CREATES A PRINCIPAL. A second writable Principal creation path is the exact defect
// class this wave is closing elsewhere, and `ensureTenantPrincipal` remains the only writer in this
// repository. What was missing was never the write -- it was the GUARDS around it, and each of them
// is missing for a reason that makes it unfixable inside the command itself:
//
//   THE AUTHORITY WAS ARGUED, NOT READ. `ensureTenantPrincipal` takes `actorRoleKeys` from its
//   caller and gates on ROLE KEYS via hasAdministrationAuthority(..., "assignRole"). Role keys
//   cannot see a direct `eos_policy.principal_capabilities` grant, and a caller-supplied set makes
//   the gate decorative. The fix is to RESOLVE the acting Principal's capabilities LIVE from
//   PostgreSQL -- `capabilitiesForRoleKeys` over `eos_policy.role_capabilities`, UNIONED with
//   `principalCapabilityGrants` over `eos_policy.principal_capabilities` -- and that resolution
//   CANNOT live in src/adminPolicy: adminPolicyNoFirebase.test.mjs pins the DAL to exactly two files
//   permitted to import `pg`, and `capabilitiesForRoleKeys` lives in src/eosOps, which already
//   depends on src/adminPolicy. Putting the read in the command would invert that dependency and
//   widen the pinned allowlist for a table the command does not own. It belongs at the operator
//   layer, exactly where scripts/rebindPrincipalIdentity.js puts the same derivation.
//
//   A DUPLICATE SUBJECT WAS ADOPTED, NOT REFUSED. `ensureTenantPrincipal` is IDEMPOTENT by contract:
//   handed a subject that already exists it returns that Principal, and handed one whose membership
//   was RETIRED it re-activates the membership (seedSampleCompany.js:888 documents avoiding exactly
//   that). Five callers and eight suites depend on that idempotence, so turning the adopt into a
//   refusal inside the command would break the contract those callers were written against. A
//   CREATION command needs the refusal; the shared primitive needs the adopt. The refusal therefore
//   sits here, ahead of the call, and this tool never reaches the adopt branch.
//
//   THERE WAS NO NOTION OF A CANONICAL PRINCIPAL. One human with two Principals has their authority
//   split across two rows, which is worse than being unable to sign in. `display_name` is the only
//   canonical-name column the measured schema carries, so that is what this tool collides on.
//
// ============================ WHAT IT DOES AND DOES NOT DO ============================
//
//   CREATES   through `ensureTenantPrincipal` and nothing else: one Principal bound to
//             (identity_provider, external_subject), and one ACTIVE membership in ONE named tenant.
//   NEVER     assigns a Security Role, creates an Employee or an employee_principal_link, writes a
//             direct `principal_capabilities` grant, creates or widens a Role or a capability,
//             creates a tenant, re-activates a retired membership, edits an existing Principal's
//             binding (that is `rebindPrincipalIdentity`), or touches Firestore -- there is no
//             Firebase client in this process and no Firebase authorization anywhere in this file.
//   NEVER     creates, rotates, fetches or prints an authentication credential. The external subject
//             is an IDENTIFIER the operator already holds; this tool contacts no identity provider.
//   NEVER     invents a placeholder external subject. There is no flag that generates one and no
//             default: an unknown authentication uid means the Principal is not created yet.
//
// ============================ THE AUTHORITY IS READ, NEVER ARGUED ============================
//
// The administering Principal is NAMED on the command line. Its Roles are READ from PostgreSQL
// (active assignments, mapped roleId -> role key through the tenant's own Role catalog), its
// capabilities are then resolved LIVE through `capabilitiesForRoleKeys` over
// `eos_policy.role_capabilities` and UNIONED with its direct grants from
// `eos_policy.principal_capabilities`, and the run is refused unless that union holds
// `admin.roleAssignment.write`.
//
// WHY THAT CAPABILITY, AND WHY NO NEW ONE. The capability catalog is not changed by this lane:
// nonprod stays at capabilities 79 / role_capabilities 413. `admin.roleAssignment.write` is the
// canonical ADMIN_ACTION registered on object `rolesPermissions` for action `assignRole`
// (migration 1761609600000), held by `admin` and `owner`. `ensureTenantPrincipal` already declares
// that admitting a Principal to a tenant is assignment-shaped by gating on the `assignRole`
// administration action, so this is the capability-model expression of the gate that is already
// there rather than a new authority. It is deliberately NARROWER than the role-key gate it sits in
// front of: `generalManager` satisfies hasAdministrationAuthority("assignRole") but holds no
// `admin.roleAssignment.write` row, so nothing here widens anything.
//
// A Firebase ID token, uid or custom claim is not business authority anywhere in this file.
//
// ============================ NO RAW SQL MUTATION ============================
//
// Every write goes through `ensureTenantPrincipal`, which carries the transaction, the membership
// and the ONE audit event. The SQL in this file is SELECT-only and exists to MEASURE: the authority
// it derives, the collisions it refuses, and the invariants the run is accountable for afterwards.
//
// ============================ THE FENCES ============================
//
//   NAMED TARGET     --environment must match an id in config/environments.json. Nothing is inferred
//                    from cwd, .firebaserc, gcloud, ambient credentials or process.env.
//   PRODUCTION       refused twice over -- by declared role and by the customer project id.
//   CERTIFICATION    the frozen Certification world refused by id.
//   POSITIVELY       EOS_ENVIRONMENT must read exactly 'nonprod' in this process.
//   NONPROD
//   UNKNOWN FLAG     refused, not ignored: a misspelled fence is a missing fence. A flag that would
//                    SUPPLY authority or a credential is refused by its own named code.
//   DRY RUN          the default. --apply is required to write, and a dry run writes nothing.
//
// Usage:
//   node scripts/provisionGovernedPrincipal.js \
//     --environment platform-sandbox --databaseUrlEnv DATABASE_URL --tenantKey taylor-nonprod \
//     --adminPrincipalId <ADMIN_PRINCIPAL_ID> --identityProvider eos-synthetic-nonprod \
//     --externalSubject <SUBJECT> --displayName "<CANONICAL NAME>" \
//     --reason "<specific reason naming the external subject>" [--apply]
//
// THE REASON IS MANDATORY AND MUST BE SPECIFIC: at least 40 characters, and it must NAME THE
// EXTERNAL SUBJECT. `ensureTenantPrincipal` writes `reason: null` when handed nothing, which is how
// the one act that admits a Principal to a tenant became the one act nobody had to explain.
//
// Exit 0 when the run is clean (PLANNED, PROVISIONED or NO_CHANGE); 2 when refused or when the run
// broke its own terms.
"use strict";

const { assertMeasurementTarget, parseArgs } = require("./measureEmployeeReferenceIntegrity.js");
const { assertNonprodRuntime } = require("./measureWorkforceActivation.js");

const FROZEN_ENVIRONMENTS = Object.freeze(["platform-certification"]);

/**
 * THE CAPABILITY THIS RUN IS GATED ON. An EXISTING catalog key -- this lane registers none.
 * See "WHY THAT CAPABILITY, AND WHY NO NEW ONE" above.
 */
const REQUIRED_CAPABILITY = "admin.roleAssignment.write";

/** The audit action `ensureTenantPrincipal` appends. Named here so the measurement can count it. */
const AUDIT_ACTION = "tenant.addPrincipal";

/** Every flag this tool understands. Anything else is refused, not ignored. */
const KNOWN_FLAGS = Object.freeze([
  "environment", "databaseUrlEnv", "tenantKey", "adminPrincipalId", "performedBy",
  "identityProvider", "externalSubject", "displayName", "reason", "apply",
]);

/**
 * Flag names that would SUPPLY authority rather than name a target. Already covered by the
 * unknown-flag refusal; named separately so the refusal says WHY, and so the boundary is readable
 * rather than inferred.
 */
const AUTHORITY_BEARING_FLAGS = Object.freeze([
  "heldRoleKeys", "heldRoles", "roleKeys", "roles", "role", "capabilities", "capability",
  "entitlements", "grant", "grants", "permissions", "actorRoleKeys", "assignRole", "securityRole",
]);
const CREDENTIAL_BEARING_FLAGS = Object.freeze([
  "password", "authPassword", "authPasswordEnv", "token", "idToken", "secret", "credential",
  "credentials", "serviceAccount", "serviceAccountKey", "apiKey", "databaseUrl", "connectionString",
]);

const MIN_REASON_LENGTH = 40;
/** Mirrors the audit reason column and optionalReason(). */
const MAX_REASON_LENGTH = 500;
const MAX_DISPLAY_NAME_LENGTH = 200;
const MAX_SUBJECT_LENGTH = 255;

class PrincipalProvisionError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "PrincipalProvisionError";
    this.code = code;
  }
}
const refuse = (code, message) => {
  throw new PrincipalProvisionError(code, message);
};

/** A reason a later reader can act on: long enough to be a sentence, and it names its own subject. */
function assertSpecificReason(reason, externalSubject) {
  const trimmed = String(reason).trim();
  if (trimmed.length < MIN_REASON_LENGTH) {
    refuse("REASON_NOT_SPECIFIC",
      `--reason is ${trimmed.length} characters; at least ${MIN_REASON_LENGTH} are required. Admitting a `
      + "Principal to a tenant creates a standing identity inside it, and 'setup' is not an account of that.");
  }
  if (trimmed.length > MAX_REASON_LENGTH) {
    refuse("REASON_TOO_LONG", `--reason is ${trimmed.length} characters; the audit column holds ${MAX_REASON_LENGTH}`);
  }
  if (!trimmed.includes(externalSubject)) {
    refuse("REASON_NOT_SPECIFIC",
      "--reason must NAME THE EXTERNAL SUBJECT it admits. A reason that does not say which identity it is "
      + "about is not specific, and it is the first thing a reader of the audit row will need.");
  }
}

/**
 * Refuse before anything is loaded that could contact anything.
 *
 * Order matters and is the property under test: authority-bearing arguments are refused, the target
 * is named, production is refused, the runtime is positively identified as nonprod, and only then is
 * any argument shaped. Throws BEFORE the caller has required `pg`.
 */
function assertInvocation(args, env) {
  for (const flag of Object.keys(args)) {
    if (KNOWN_FLAGS.includes(flag)) continue;
    if (AUTHORITY_BEARING_FLAGS.includes(flag)) {
      refuse("AUTHORITY_ARGUMENT_REFUSED",
        `--${flag} would SUPPLY authority. The administering Principal's Roles are READ FROM PostgreSQL from `
        + "its active assignments and its capabilities resolved from role_capabilities UNION "
        + "principal_capabilities; no Role, capability, entitlement or grant is ever accepted as an argument, "
        + "because an asserted capability set makes the governed command's own gate decorative.");
    }
    if (CREDENTIAL_BEARING_FLAGS.includes(flag)) {
      refuse("CREDENTIAL_ARGUMENT_REFUSED",
        `--${flag} would put a credential on a command line. argv appears in ps, in shell history and in CI `
        + "logs. This tool creates, rotates, fetches and prints no credential of any kind, and the connection "
        + "string is named by --databaseUrlEnv rather than passed.");
    }
    refuse("UNKNOWN_FLAG_REFUSED",
      `--${flag} is not a flag this tool understands. An unrecognized flag is REFUSED rather than ignored: `
      + `a misspelled fence is a missing fence. Known flags: ${KNOWN_FLAGS.map((f) => `--${f}`).join(" ")}`);
  }

  const { environmentId, connectionString } = assertMeasurementTarget(args, env);
  assertNonprodRuntime(env);
  if (FROZEN_ENVIRONMENTS.includes(environmentId)) {
    refuse("ENVIRONMENT_FROZEN",
      `--environment '${environmentId}' is the Certification world, which is frozen. Its authority genesis is `
      + "a recorded fact and admitting a new Principal would rewrite it.");
  }

  for (const flag of [
    "tenantKey", "adminPrincipalId", "performedBy", "identityProvider", "externalSubject",
    "displayName", "reason",
  ]) {
    if (typeof args[flag] !== "string" || args[flag].trim() === "" || args[flag] === "true") {
      refuse("ARGUMENT_REQUIRED", `--${flag} is required and has no default`);
    }
  }

  const externalSubject = args.externalSubject.trim();
  if (externalSubject.length > MAX_SUBJECT_LENGTH || /\s/.test(externalSubject)) {
    refuse("SUBJECT_MALFORMED",
      `--externalSubject must be a single whitespace-free identifier of at most ${MAX_SUBJECT_LENGTH} `
      + "characters. It is the uid a verifier produces, never a token, and it is never generated here: an "
      + "unknown authentication uid means the Principal is not created yet.");
  }

  // NO DEFAULT PROVIDER. `rebindPrincipalIdentity` may default to 'firebase' because it is moving a
  // binding that already exists; a CREATION that guessed the provider could silently mint a Principal
  // the platform believes can authenticate.
  const identityProvider = args.identityProvider.trim();
  if (!/^[a-z][a-z0-9_-]{0,31}$/.test(identityProvider)) {
    refuse("IDENTITY_PROVIDER_MALFORMED",
      "--identityProvider must be a lowercase provider key such as 'firebase' or 'eos-synthetic-nonprod'. It "
      + "has no default here, because a creation that guessed the provider would decide whether the new "
      + "Principal can authenticate.");
  }

  const displayName = args.displayName.trim();
  if (displayName.length > MAX_DISPLAY_NAME_LENGTH) {
    refuse("DISPLAY_NAME_TOO_LONG",
      `--displayName is ${displayName.length} characters; at most ${MAX_DISPLAY_NAME_LENGTH}`);
  }

  assertSpecificReason(args.reason, externalSubject);

  return {
    environmentId,
    connectionString,
    tenantKey: args.tenantKey.trim(),
    adminPrincipalId: args.adminPrincipalId.trim(),
    performedBy: args.performedBy.trim(),
    identityProvider,
    externalSubject,
    displayName,
    reason: args.reason.trim(),
    apply: args.apply === "true",
  };
}

// ---------------------------------------------------------------- the derived authority
//
// EVERY QUERY IN THIS SECTION IS A SELECT.

/**
 * What the acting Principal may actually do, resolved LIVE from PostgreSQL.
 *
 * ROLE KEYS ARE NOT THE ANSWER, they are a step on the way to it. The union with
 * `principal_capabilities` is the load-bearing half: a direct grant an administrator made through
 * the governed `grantObjectActionToPrincipal` command carries no Role key at all, so a Role-key gate
 * would silently refuse an authority PostgreSQL says exists. Both halves are reported so the
 * derivation is visible in the receipt rather than trusted.
 */
async function resolveAdministrationAuthority(pool, repo, tenantId, adminPrincipalId, deps) {
  const { capabilitiesForRoleKeys, principalCapabilityGrants } = deps;

  const admin = await repo.getPrincipal(adminPrincipalId);
  const membership = admin ? await repo.getMembership(tenantId, admin.id) : null;
  // FAIL CLOSED on a missing or inactive membership. Tenant-scoped: an administrator of another
  // tenant resolves to no membership HERE and is refused here, whatever it holds there.
  if (!admin || admin.status !== "active" || !membership || membership.status !== "active") {
    refuse("ADMINISTRATOR_INVALID",
      "--adminPrincipalId must name an ACTIVE Principal with an ACTIVE membership in THIS tenant. A "
      + "Principal that resolves to no context in this tenant confers nothing in it, and authority is never "
      + "borrowed across a tenant boundary.");
  }

  // listAssignmentsForPrincipal returns roleId, NOT roleKey -- the tenant's own catalog is what turns
  // one into the other, and skipping the map yields [undefined] and a refusal. That refusal is the
  // gate working.
  const roles = await repo.listRoles(tenantId);
  const roleKeyById = new Map(roles.map((r) => [r.id, r.key]));
  const heldRoleKeys = (await repo.listAssignmentsForPrincipal(tenantId, admin.id))
    .filter((a) => a.status === "active").map((a) => roleKeyById.get(a.roleId)).filter(Boolean);

  const roleCapabilities = [...await capabilitiesForRoleKeys(pool, tenantId, heldRoleKeys)].sort();
  const directCapabilities = (await principalCapabilityGrants(pool, tenantId, admin.id))
    .map((g) => g.capabilityKey).sort();
  const effective = new Set([...roleCapabilities, ...directCapabilities]);

  if (!effective.has(REQUIRED_CAPABILITY)) {
    refuse("ADMINISTRATOR_UNAUTHORIZED",
      `the named administering Principal does not hold '${REQUIRED_CAPABILITY}' in this tenant -- resolved `
      + "from eos_policy.role_capabilities UNION eos_policy.principal_capabilities, live. Admitting a "
      + "Principal to a tenant is assignment-shaped authority, and this run asserts none of its own.");
  }

  return {
    admin,
    heldRoleKeys: [...heldRoleKeys].sort(),
    roleCapabilities,
    directCapabilities,
    effectiveCapabilityCount: effective.size,
  };
}

/** Everything about the target that the refusals below turn on. SELECT-only. */
async function readTargetState(pool, tenantId, identityProvider, externalSubject, displayName) {
  const existing = (await pool.query(
    `SELECT id, identity_provider, external_subject, display_name, status
       FROM eos_policy.principals WHERE identity_provider = $1 AND external_subject = $2`,
    [identityProvider, externalSubject])).rows[0] || null;

  const membership = existing ? (await pool.query(
    "SELECT id, tenant_id, status FROM eos_policy.tenant_memberships WHERE tenant_id = $1 AND principal_id = $2",
    [tenantId, existing.id])).rows[0] || null : null;

  // THE CANONICAL COLLISION, scoped to this tenant's members. `display_name` is the only
  // canonical-name column the measured schema carries.
  const canonicalHolders = (await pool.query(
    `SELECT p.id, p.identity_provider, p.external_subject, m.status AS membership_status
       FROM eos_policy.principals p
       JOIN eos_policy.tenant_memberships m ON m.principal_id = p.id
      WHERE m.tenant_id = $1 AND p.display_name = $2
      ORDER BY p.id`,
    [tenantId, displayName])).rows;

  return { existing, membership, canonicalHolders };
}

/** The invariants this run is accountable for, measured after the fact rather than claimed. */
async function readInvariants(pool, tenantId, principalId) {
  const count = async (text, values) => (await pool.query(text, values)).rows[0].n;
  return {
    securityRoleAssignments: principalId === null ? 0 : await count(
      "SELECT count(*)::int AS n FROM eos_policy.user_role_assignments WHERE tenant_id = $1 AND principal_id = $2",
      [tenantId, principalId]),
    employeeLinks: principalId === null ? 0 : await count(
      "SELECT count(*)::int AS n FROM eos_policy.employee_principal_links WHERE tenant_id = $1 AND principal_id = $2",
      [tenantId, principalId]),
    directCapabilityGrants: principalId === null ? 0 : await count(
      "SELECT count(*)::int AS n FROM eos_policy.principal_capabilities WHERE tenant_id = $1 AND principal_id = $2",
      [tenantId, principalId]),
    capabilityCatalogRows: await count("SELECT count(*)::int AS n FROM eos_policy.capabilities"),
    roleCapabilityRows: await count(
      "SELECT count(*)::int AS n FROM eos_policy.role_capabilities WHERE tenant_id = $1", [tenantId]),
  };
}

const countAdmissionAudits = async (pool, tenantId, principalId) => (principalId === null ? 0
  : (await pool.query(
    `SELECT count(*)::int AS n FROM eos_policy.audit_events
      WHERE tenant_id = $1 AND action = $2 AND target_id = $3`,
    [tenantId, AUDIT_ACTION, principalId])).rows[0].n);

/**
 * Admit (or plan, or reconcile) ONE Principal in ONE tenant. `pool` is a pg Pool.
 *
 * `deps` carries the governed command, the repository and the two capability resolvers, so this is
 * provable against a real database without a process boundary -- exactly as the identity re-bind is.
 */
async function provisionGovernedPrincipalRun(pool, options, deps) {
  const { PostgresPolicyRepository, ensureTenantPrincipal } = deps;
  const repo = new PostgresPolicyRepository(pool);

  const tenant = await repo.getTenantByKey(options.tenantKey);
  if (!tenant) {
    refuse("TENANT_NOT_FOUND", `no tenant with key '${options.tenantKey}'; this run never creates one`);
  }
  const tenantId = tenant.id;

  const authority = await resolveAdministrationAuthority(pool, repo, tenantId, options.adminPrincipalId, deps);

  const before = await readTargetState(
    pool, tenantId, options.identityProvider, options.externalSubject, options.displayName);

  // ---- THE IDEMPOTENT PATH, defined narrowly. Everything else that already exists is a refusal.
  const alreadyAdmitted = Boolean(
    before.existing
    && before.existing.status === "active"
    && before.existing.display_name === options.displayName
    && before.membership
    && before.membership.status === "active",
  );

  if (!alreadyAdmitted) {
    // ---- DUPLICATE EXTERNAL SUBJECT. `ensureTenantPrincipal` would ADOPT this Principal; a creation
    // command must not. Two Principals for one login split one human's Roles, and folding them
    // together silently is worse than refusing.
    if (before.existing) {
      if (before.membership && before.membership.status !== "active") {
        refuse("MEMBERSHIP_RETIRED_REFUSED",
          `('${options.identityProvider}', '${options.externalSubject}') is an existing Principal whose membership `
          + `in tenant '${options.tenantKey}' is '${before.membership.status}'. The governed command would `
          + "RE-ACTIVATE it; this run refuses, because silently restoring a retired membership is a "
          + "re-instatement decision and not a provisioning one.");
      }
      refuse("SUBJECT_ALREADY_HELD",
        `('${options.identityProvider}', '${options.externalSubject}') is already held by Principal `
        + `'${before.existing.id}'. This run creates Principals and never adopts, edits or re-points an `
        + "existing one -- moving a binding is rebindPrincipalIdentity, and admitting an existing Principal "
        + "to a further tenant is not this tool's business.");
    }

    // ---- DUPLICATE CANONICAL PRINCIPAL.
    if (before.canonicalHolders.length > 0) {
      refuse("CANONICAL_PRINCIPAL_EXISTS",
        `tenant '${options.tenantKey}' already has ${before.canonicalHolders.length} Principal(s) whose canonical `
        + `name is '${options.displayName}' (${before.canonicalHolders.map((h) => h.id).join(", ")}). A second `
        + "Principal for one canonical identity splits its authority across two rows, which is worse than "
        + "being unable to sign in.");
    }
  }

  const invariantsBefore = await readInvariants(pool, tenantId, before.existing ? before.existing.id : null);
  const auditsBefore = await countAdmissionAudits(pool, tenantId, before.existing ? before.existing.id : null);

  let principal = before.existing;
  let outcome;
  if (!options.apply) {
    // A DRY RUN WRITES NOTHING. Not a row, not an audit event.
    outcome = alreadyAdmitted ? "NO_CHANGE" : "PLANNED";
  } else {
    // THE GOVERNED COMMAND, ALWAYS. Its `actorRoleKeys` are the keys DERIVED above, so its own
    // role-key invariant is evaluated against real authority; the capability gate that decided this
    // run already fired, over role_capabilities UNION principal_capabilities.
    principal = await ensureTenantPrincipal(repo, {
      tenantId,
      externalSubject: options.externalSubject,
      identityProvider: options.identityProvider,
      displayName: options.displayName,
      actorUid: options.performedBy,
      actorRoleKeys: authority.heldRoleKeys,
      reason: options.reason,
    });
    outcome = alreadyAdmitted ? "NO_CHANGE" : "PROVISIONED";
  }

  const principalId = principal ? principal.id : null;
  const after = await readTargetState(
    pool, tenantId, options.identityProvider, options.externalSubject, options.displayName);
  const invariantsAfter = await readInvariants(pool, tenantId, principalId);
  const auditsAfter = await countAdmissionAudits(pool, tenantId, principalId);

  return {
    tool: "provisionGovernedPrincipal",
    environment: options.environmentId,
    tenantKey: options.tenantKey,
    tenantId,
    apply: options.apply,
    outcome,
    // The DERIVED authority, printed so the derivation is visible in the receipt rather than trusted.
    adminPrincipalId: authority.admin.id,
    adminHeldRoleKeys: authority.heldRoleKeys,
    adminAuthoritySource:
      "postgresql:eos_policy.role_capabilities UNION postgresql:eos_policy.principal_capabilities",
    requiredCapability: REQUIRED_CAPABILITY,
    adminRoleDerivedCapabilityCount: authority.roleCapabilities.length,
    adminDirectCapabilityGrants: authority.directCapabilities,
    identityProvider: options.identityProvider,
    externalSubject: options.externalSubject,
    displayName: options.displayName,
    principalId,
    membershipStatus: after.membership ? after.membership.status : null,
    securityRolesAssigned: invariantsAfter.securityRoleAssignments,
    employeeCreated: false,
    employeeRationale:
      "NO Employee: this run writes only a Principal and its ACTIVE membership. There is no governed "
      + "Employee writer here, and nothing this Principal can yet do asks for one.",
    auditEvents: {
      action: AUDIT_ACTION,
      before: auditsBefore,
      after: auditsAfter,
      appended: auditsAfter - auditsBefore,
    },
    invariants: { before: invariantsBefore, after: invariantsAfter },
  };
}

/** Did this run break its own terms? Reported as a non-zero exit, not buried in a field. */
function violations(report) {
  const out = [];
  const { appended } = report.auditEvents;
  if (!report.apply) {
    if (appended !== 0) out.push(`a dry run appended ${appended} audit event(s)`);
    if (report.outcome === "PLANNED" && report.principalId !== null) {
      out.push("a dry run created a Principal");
    }
  }
  if (report.apply && report.outcome === "PROVISIONED") {
    if (appended !== 1) out.push(`provisioning appended ${appended} audit event(s); exactly one is the contract`);
    if (report.membershipStatus !== "active") out.push("the Principal was admitted without an ACTIVE membership");
  }
  if (report.apply && report.outcome === "NO_CHANGE" && appended !== 0) {
    out.push(`a NO_CHANGE run appended ${appended} audit event(s)`);
  }
  if (report.securityRolesAssigned !== 0) {
    out.push(`the new Principal holds ${report.securityRolesAssigned} Security Role assignment(s); this run assigns none`);
  }
  if (report.invariants.after.employeeLinks !== 0) out.push("an Employee link was created");
  if (report.invariants.after.directCapabilityGrants !== 0) out.push("a direct Principal capability grant was made");
  if (report.invariants.after.capabilityCatalogRows !== report.invariants.before.capabilityCatalogRows) {
    out.push("the capability catalog changed");
  }
  if (report.invariants.after.roleCapabilityRows !== report.invariants.before.roleCapabilityRows) {
    out.push("a Role was widened");
  }
  return out;
}

async function main() {
  const options = assertInvocation(parseArgs(process.argv.slice(2)), process.env);
  const pg = require("pg");
  const { resolvePolicyDatabaseConfig } = require("../lib/adminPolicy/policyDatabase.js");
  const capabilityAuthority = require("../lib/eosOps/capabilityAuthority.js");
  const deps = {
    PostgresPolicyRepository: require("../lib/adminPolicy/postgresPolicyRepository.js").PostgresPolicyRepository,
    ensureTenantPrincipal: require("../lib/adminPolicy/tenantBootstrap.js").ensureTenantPrincipal,
    capabilitiesForRoleKeys: capabilityAuthority.capabilitiesForRoleKeys,
    principalCapabilityGrants: capabilityAuthority.principalCapabilityGrants,
  };
  const pool = new pg.Pool(resolvePolicyDatabaseConfig({ connectionString: options.connectionString }));
  try {
    const report = await provisionGovernedPrincipalRun(pool, options, deps);
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
  assertSpecificReason,
  provisionGovernedPrincipalRun,
  readInvariants,
  readTargetState,
  resolveAdministrationAuthority,
  violations,
  AUDIT_ACTION,
  AUTHORITY_BEARING_FLAGS,
  CREDENTIAL_BEARING_FLAGS,
  KNOWN_FLAGS,
  MIN_REASON_LENGTH,
  REQUIRED_CAPABILITY,
};

if (require.main === module) {
  main().catch((err) => {
    const governed = err instanceof PrincipalProvisionError;
    console.error(JSON.stringify({
      outcome: "REFUSED_OR_FAILED",
      message: governed || (err && typeof err.message === "string")
        ? (err instanceof Error ? err.message : String(err))
        : "the run could not be completed",
    }, null, 2));
    process.exitCode = 2;
  });
}
