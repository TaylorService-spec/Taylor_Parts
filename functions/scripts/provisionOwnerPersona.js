// THE GOVERNED NONPROD OWNER PERSONA -- Owner ruling, Wave 9.
//
// ============================ THE MEASUREMENT THIS EXISTS TO CLOSE ============================
//
// `owner` is a registered, privileged, system-seed Security Role holding 47 capabilities in nonprod,
// and it had ZERO active role assignments and ZERO principals. So nothing in this platform could
// exercise owner authority, and -- the half that matters more -- nothing could be REFUSED it. Every
// statement about what an Owner may see was a statement about a Role nobody held.
//
// This provisions exactly one holder of it.
//
// ============================ WHAT IT WRITES, AND WHAT IT REFUSES TO ============================
//
//   Principal + membership   ensureTenantPrincipal (governed, audited, idempotent). Identity
//                            provider `eos-synthetic-nonprod`, which NO verifier recognizes, so this
//                            persona can never authenticate. It is a governed authority fixture, not
//                            an account.
//   Security Role            assignRole (governed, audited, access-version bump, idempotent).
//                            Exactly `owner`, global scope, and nothing else.
//
//   NO EMPLOYEE.             Deliberate, and it is the ruling read literally: "a synthetic/nonprod
//                            Employee WHERE THE PERSONA MODEL REQUIRES ONE." It does not require
//                            one here. `assignRole` reads no Employee -- it requires an ACTIVE
//                            tenant membership and nothing else -- and the Administration surfaces
//                            this persona exists to exercise (`administration.rolesPermissions`,
//                            `.objects`, `.workflows`, `.permissionPreview`, `.overview`) carry no
//                            WORK_ELIGIBILITY and no OPERATIONAL_SCOPE predicate, so
//                            `authorizeObjectAction` never asks for an Employee link.
//                            experienceAuthorityPostgres.test.mjs proves that against a real
//                            database: the owner persona resolves every Administration surface with
//                            `employeeId: null`.
//                            Writing an Employee anyway would not be thoroughness. There is no
//                            governed Employee writer in this repository, so it would be a direct
//                            INSERT of a person who does not exist, to satisfy a shape nothing asks
//                            for.
//   NO REUSE OF THE ADMIN PRINCIPAL. The ruling forbids it in terms -- "Do NOT reuse the admin
//                            Principal merely to populate owner" -- and `assertNotTheAdministrator`
//                            below refuses the run if the subject resolves to the administering
//                            Principal, so the prohibition is a guard rather than a convention.
//   NO CAPABILITY, NO GRANT, NO ROLE WIDENING. `owner`'s 47 capabilities are whatever
//                            role_capabilities already says. This run touches that table never, and
//                            eos_policy.principal_capabilities never -- there is no direct Principal
//                            grant here and no code path that could make one.
//
// ============================ PER-STEP AUDIT REASONS ============================
//
// Owner ruling: "Every governed persona provisioning mutation must carry a specific per-step reason.
// Do not use one broad reason for the entire provisioning run."
//
// There are two mutations and they carry two DIFFERENT reasons, composed per step from the step's
// own subject and target. There is no run-level reason, no `--reason` flag, and nowhere to put one:
// the reasons are constants of the step, not inputs, so a caller cannot supply one broad sentence.
// `assertDistinctStepReasons` refuses the file itself if the two ever become the same string.
//
// ============================ IDEMPOTENCE IS MEASURED, NOT ASSUMED ============================
//
// Both governed commands are already idempotent, and neither returns an outcome discriminator. So
// this script READS the state before each step and reports CREATED or NO_CHANGE from the difference.
// A second run reports NO_CHANGE twice and writes nothing -- including no audit event, because both
// commands return early before opening a transaction.
//
// ============================ THE FENCE ============================
//
// Refuses, before any client exists: no registry --environment, production by role or project id
// (shared fence), no --databaseUrlEnv, EOS_ENVIRONMENT not exactly `nonprod`, the frozen
// Certification world refused by id, and missing --tenantKey / --performedBy / --adminPrincipalId.
// The administering authority is NOT asserted by this script: it is read from the named
// administrator Principal's own ACTIVE Role assignments, so the command's capability gate is
// evaluated against real authority rather than a set this file made up.
//
// DRY RUN BY DEFAULT. `--apply` writes.
//
// Usage:
//   node scripts/provisionOwnerPersona.js --environment platform-sandbox \
//     --databaseUrlEnv DATABASE_URL --tenantKey taylor-nonprod --performedBy <operator> \
//     --adminPrincipalId <principal> [--apply]
//
// Exit 0 provisioned or already provisioned; 2 refused or failed. Output: deterministic JSON, no secrets.
"use strict";

const { assertMeasurementTarget, parseArgs } = require("./measureEmployeeReferenceIntegrity.js");
const { assertNonprodRuntime } = require("./measureWorkforceActivation.js");

const FROZEN_ENVIRONMENTS = Object.freeze(["platform-certification"]);

/** No verifier recognizes this provider, so the persona cannot authenticate. */
const SYNTHETIC_IDENTITY_PROVIDER = "eos-synthetic-nonprod";
const OWNER_EXTERNAL_SUBJECT = "synthetic-np-principal-owner";
const OWNER_DISPLAY_NAME = "SYNTHETIC NONPROD Owner (fixture, cannot sign in)";
const OWNER_ROLE_KEY = "owner";

/**
 * THE TWO PER-STEP REASONS. Two steps, two reasons, each naming its own subject and its own target.
 *
 * They are constants of the STEP rather than parameters, which is what makes a run-level reason
 * unrepresentable: there is no flag to pass one and no variable to put one in.
 */
const PRINCIPAL_STEP_REASON =
  `OWNER PERSONA: ${OWNER_EXTERNAL_SUBJECT} TENANT_MEMBERSHIP -- admitting a non-authenticating `
  + "governed Principal so the owner Security Role has a holder that is NOT the administrator "
  + "Principal (Owner ruling, Wave 9)";
const ROLE_STEP_REASON =
  `OWNER PERSONA: ${OWNER_EXTERNAL_SUBJECT} SECURITY_ROLE ${OWNER_ROLE_KEY} -- nonprod measured ZERO `
  + "active owner assignments and ZERO owner principals, so no persona could exercise or be refused "
  + "owner authority; this assigns exactly owner, global scope, and nothing else";

class OwnerPersonaError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "OwnerPersonaError";
    this.code = code;
  }
}
const refuse = (code, message) => {
  throw new OwnerPersonaError(code, message);
};

/**
 * The two reasons must differ, and each must actually name its own step.
 *
 * A file-level check rather than a runtime one, because the failure it guards against is an EDIT:
 * somebody collapsing two reasons into one shared constant re-creates exactly the run-level reason
 * the ruling forbids, and would otherwise do it silently.
 */
function assertDistinctStepReasons() {
  if (PRINCIPAL_STEP_REASON === ROLE_STEP_REASON) {
    refuse("RUN_LEVEL_REASON_REFUSED", "the two steps share one reason, which is a run-level reason");
  }
  for (const [what, reason, target] of [
    ["principal", PRINCIPAL_STEP_REASON, "TENANT_MEMBERSHIP"],
    ["role", ROLE_STEP_REASON, `SECURITY_ROLE ${OWNER_ROLE_KEY}`],
  ]) {
    if (!reason.includes(target) || !reason.includes(OWNER_EXTERNAL_SUBJECT)) {
      refuse("REASON_NOT_SPECIFIC", `the ${what} reason does not name its own subject and target`);
    }
    // Mirrors the 500-character audit column and optionalReason().
    if (reason.length > 500) refuse("REASON_TOO_LONG", `the ${what} reason is ${reason.length} characters`);
  }
}

function assertInvocation(args, env) {
  const { environmentId, connectionString } = assertMeasurementTarget(args, env);
  assertNonprodRuntime(env);
  if (FROZEN_ENVIRONMENTS.includes(environmentId)) {
    refuse("ENVIRONMENT_FROZEN", `--environment '${environmentId}' is the Certification world, which is frozen.`);
  }
  for (const flag of ["tenantKey", "performedBy", "adminPrincipalId"]) {
    if (typeof args[flag] !== "string" || args[flag].trim() === "" || args[flag] === "true") {
      refuse("ARGUMENT_REQUIRED", `--${flag} is required and has no default`);
    }
  }
  if (!/^[A-Za-z0-9._@-]{1,100}$/.test(args.performedBy)) {
    refuse("ARGUMENT_REQUIRED", "--performedBy <operator> must be [A-Za-z0-9._@-], at most 100");
  }
  return {
    environmentId, connectionString, tenantKey: args.tenantKey, performedBy: args.performedBy,
    adminPrincipalId: args.adminPrincipalId, apply: args.apply === "true",
  };
}

/**
 * THE PROHIBITION, AS A GUARD.
 *
 * "Do NOT reuse the admin Principal merely to populate owner." If the owner subject ever resolved to
 * the administering Principal -- through an edit to the subject constant, or an administrator that
 * happens to carry it -- this run would be doing precisely that, so it refuses instead.
 */
function assertNotTheAdministrator(principalId, adminPrincipalId) {
  if (principalId === adminPrincipalId) {
    refuse("ADMIN_PRINCIPAL_REUSE_REFUSED",
      "the owner persona resolved to the administering Principal; owner must be held by a Principal "
      + "of its own and the administrator keeps exactly its own assignments");
  }
}

/**
 * Provision (or reconcile) the persona. `pool` is a pg Pool; libraries load in main(), after the fence.
 *
 * Returns a per-step report. Every step says CREATED, NO_CHANGE or PLANNED, measured by reading the
 * state before the step rather than by trusting the command's return value.
 */
async function provisionOwnerPersona(pool, options, deps) {
  assertDistinctStepReasons();
  const { PostgresPolicyRepository, ensureTenantPrincipal, assignRole, hasAdministrationAuthority } = deps;
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

  const ownerRole = roles.find((r) => r.key === OWNER_ROLE_KEY);
  if (!ownerRole) {
    refuse("ROLE_NOT_DEFINED",
      `Security Role ${OWNER_ROLE_KEY} is not defined in this tenant; this run never creates a Role`);
  }

  const steps = [];

  // ---- STEP 1. Principal + ACTIVE membership.
  const principalBefore = await repo.getPrincipalBySubject(SYNTHETIC_IDENTITY_PROVIDER, OWNER_EXTERNAL_SUBJECT);
  const membershipBefore = principalBefore ? await repo.getMembership(tenantId, principalBefore.id) : null;
  const principalPresent = Boolean(principalBefore && membershipBefore && membershipBefore.status === "active");
  if (principalBefore) assertNotTheAdministrator(principalBefore.id, admin.id);

  let principal = principalBefore;
  if (!options.apply) {
    steps.push({ step: "principal", outcome: principalPresent ? "NO_CHANGE" : "PLANNED", reason: PRINCIPAL_STEP_REASON });
  } else {
    principal = await ensureTenantPrincipal(repo, {
      tenantId,
      externalSubject: OWNER_EXTERNAL_SUBJECT,
      identityProvider: SYNTHETIC_IDENTITY_PROVIDER,
      displayName: OWNER_DISPLAY_NAME,
      actorUid: options.performedBy,
      actorRoleKeys: heldRoleKeys,
      reason: PRINCIPAL_STEP_REASON,
    });
    assertNotTheAdministrator(principal.id, admin.id);
    steps.push({ step: "principal", outcome: principalPresent ? "NO_CHANGE" : "CREATED", reason: PRINCIPAL_STEP_REASON });
  }

  // ---- STEP 2. The owner Security Role, global scope.
  let rolePresent = false;
  if (principal) {
    rolePresent = (await repo.listAssignmentsForPrincipal(tenantId, principal.id)).some(
      (a) => a.status === "active" && a.roleId === ownerRole.id && (a.scopeType ?? "global") === "global",
    );
  }
  if (!options.apply) {
    steps.push({ step: "roleAssignment", outcome: rolePresent ? "NO_CHANGE" : "PLANNED", reason: ROLE_STEP_REASON });
  } else {
    await assignRole(repo, { tenantId, uid: options.performedBy, heldRoleKeys }, {
      principalId: principal.id, roleId: ownerRole.id, reason: ROLE_STEP_REASON,
    });
    steps.push({ step: "roleAssignment", outcome: rolePresent ? "NO_CHANGE" : "CREATED", reason: ROLE_STEP_REASON });
  }

  // ---- The invariants this run is accountable for, MEASURED after the fact rather than claimed.
  const directGrants = (await pool.query(
    "SELECT count(*)::int AS n FROM eos_policy.principal_capabilities")).rows[0].n;
  const ownerHolders = (await pool.query(
    `SELECT p.id, p.external_subject, p.identity_provider
       FROM eos_policy.user_role_assignments a
       JOIN eos_policy.roles r ON r.id = a.role_id
       JOIN eos_policy.principals p ON p.id = a.principal_id
      WHERE a.tenant_id = $1 AND r.key = $2 AND a.status = 'active'
      ORDER BY p.external_subject`,
    [tenantId, OWNER_ROLE_KEY])).rows;
  const adminRoleKeys = (await repo.listAssignmentsForPrincipal(tenantId, admin.id))
    .filter((a) => a.status === "active").map((a) => roleKeyById.get(a.roleId)).filter(Boolean).sort();

  return {
    environment: options.environmentId,
    tenantKey: options.tenantKey,
    tenantId,
    apply: options.apply,
    identityProvider: SYNTHETIC_IDENTITY_PROVIDER,
    externalSubject: OWNER_EXTERNAL_SUBJECT,
    principalId: principal ? principal.id : null,
    employeeLinked: false,
    employeeRationale:
      "NO Employee: assignRole reads none, and the Administration surfaces this persona exercises "
      + "declare no WORK_ELIGIBILITY and no OPERATIONAL_SCOPE predicate, so none is required.",
    adminPrincipalId: admin.id,
    adminRoleKeys,
    steps,
    invariants: {
      principalCapabilities: directGrants,
      ownerHolders,
      adminPrincipalReused: ownerHolders.some((r) => r.id === admin.id),
    },
  };
}

async function main() {
  const options = assertInvocation(parseArgs(process.argv.slice(2)), process.env);
  const pg = require("pg");
  const { resolvePolicyDatabaseConfig } = require("../lib/adminPolicy/policyDatabase.js");
  const deps = {
    PostgresPolicyRepository: require("../lib/adminPolicy/postgresPolicyRepository.js").PostgresPolicyRepository,
    ensureTenantPrincipal: require("../lib/adminPolicy/tenantBootstrap.js").ensureTenantPrincipal,
    assignRole: require("../lib/adminPolicy/policyCommands.js").assignRole,
    hasAdministrationAuthority: require("../lib/adminPolicy/administrationAuthority.js").hasAdministrationAuthority,
  };
  const pool = new pg.Pool(resolvePolicyDatabaseConfig({ connectionString: options.connectionString }));
  try {
    const report = await provisionOwnerPersona(pool, options, deps);
    console.log(JSON.stringify(report, null, 2));
    // A direct Principal grant, or the administrator holding owner, is a failure of this run's own
    // terms -- reported as a non-zero exit rather than buried in a field nobody reads.
    const violated = report.invariants.principalCapabilities !== 0 || report.invariants.adminPrincipalReused;
    process.exitCode = violated ? 2 : 0;
  } finally {
    await pool.end();
  }
}

module.exports = {
  assertInvocation,
  assertDistinctStepReasons,
  assertNotTheAdministrator,
  provisionOwnerPersona,
  OWNER_EXTERNAL_SUBJECT,
  OWNER_ROLE_KEY,
  SYNTHETIC_IDENTITY_PROVIDER,
  PRINCIPAL_STEP_REASON,
  ROLE_STEP_REASON,
};

if (require.main === module) {
  main().catch((err) => {
    const governed = err instanceof OwnerPersonaError;
    console.error(JSON.stringify({
      outcome: "REFUSED_OR_FAILED",
      message: governed || (err && typeof err.message === "string" && !err.code)
        ? (err instanceof Error ? err.message : String(err))
        : "the run could not be completed",
    }, null, 2));
    process.exitCode = 2;
  });
}
