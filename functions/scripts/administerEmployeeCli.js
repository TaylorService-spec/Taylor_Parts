// GOVERNED EMPLOYEE ADMINISTRATION -- the operator entry point for the governed PostgreSQL Employee
// commands. DRY RUN BY DEFAULT.
//
// ============================ WHY THIS EXISTS, AND WHAT IT IS NOT ============================
//
// It is NOT a second implementation and NOT a seed. Every write goes through exactly one of the
// governed commands in functions/src/eosWorkforce/commands, which own the capability gate, the
// transaction, the locks, the conflict taxonomy and the ONE audit event:
//
//   createEmployee           lib/eosWorkforce/commands/employeeCreationCommand.js
//   updateEmployeeProfile    lib/eosWorkforce/commands/employeeProfileCommand.js
//   linkEmployeePrincipal    lib/eosWorkforce/commands/employeePrincipalLinkCommands.js
//   unlinkEmployeePrincipal  lib/eosWorkforce/commands/employeePrincipalLinkCommands.js
//   relinkEmployeePrincipal  lib/eosWorkforce/commands/employeePrincipalLinkCommands.js
//
// THERE IS NO RAW SQL ESCAPE HATCH. This file contains no INSERT, no UPDATE and no DELETE. Its only
// query is the tenant lookup by key, and the authority resolution's SELECTs inside
// lib/eosWorkforce/commands/employeeAdministrationAuthority.js. A tool that could also write directly would
// make every guarantee above optional.
//
// JOB ROLES ARE NOT ADMINISTERED HERE. `assignEmployeeJobRole` has its own capability
// (admin.employeeJobRole.write) and its own operator surface; creating an Employee assigns no Job Role
// and this wrapper offers no flag that would.
//
// ============================ THE AUTHORITY IS READ, NEVER ARGUED ============================
//
// --adminPrincipalId NAMES the administering Principal. Its ACTIVE membership, its ACTIVE Role
// assignments, its Role capabilities (eos_policy.role_capabilities) and its DIRECT capability grants
// (eos_policy.principal_capabilities) are READ from PostgreSQL by
// resolveEmployeeAdministrationActor. This script never constructs a capability set: a fabricated one
// would make the command's own capability gate decorative, which is the one thing a tool must never
// do to a guard it is standing in front of.
//
// --heldRoleKeys, --capabilities, --roles, --grants and every sibling are REFUSED BY NAME
// (AUTHORITY_ARGUMENT_REFUSED), following scripts/rebindPrincipalIdentity.js. An unknown flag is
// refused too, because an argument that widens authority must be unrepresentable rather than ignored.
//
// --performedBy names the HUMAN running the tool and appears in the report. It is NOT audit identity:
// eos_policy.audit_events.actor_uid is the EOS Principal the command resolved, never an operator
// string, and this script has no way to make it anything else.
//
// ============================ THE FENCE (before `pg` or lib/ loads) ============================
//
//   NAMED TARGET   --environment must match an id in config/environments.json; nothing is inferred.
//   PRODUCTION     refused twice over -- by declared role and by the customer project id.
//   CERTIFICATION  the frozen Certification world refused by id.
//   POSITIVELY     EOS_ENVIRONMENT must read exactly 'nonprod' in this process.
//   NONPROD
//   REQUIRED       --tenantKey, --performedBy, --adminPrincipalId, --command, --employeeId, --reason.
//   DRY RUN        the default. --apply is required to write, and a dry run writes nothing at all.
//
// Usage (Render Shell on eos-api-nonprod):
//   node scripts/administerEmployeeCli.js --environment platform-sandbox --databaseUrlEnv DATABASE_URL \
//     --tenantKey taylor-nonprod --performedBy <operator> --adminPrincipalId <principal> \
//     --command createEmployee --employeeId emp-jane-doe --employmentStatus ACTIVE \
//     --operatingCompanyId taylor --displayName "Jane Doe" --reason "new hire, per signed offer 2026-09-25" [--apply]
//
// Exit 0 when the run is clean (PLANNED, or the command's own outcome); 2 when refused or failed.
"use strict";

const { assertMeasurementTarget, parseArgs } = require("./measureEmployeeReferenceIntegrity.js");
const { assertNonprodRuntime } = require("./measureWorkforceActivation.js");

const FROZEN_ENVIRONMENTS = Object.freeze(["platform-certification"]);

/** The governed commands this wrapper may drive. A name not in this list is not administered here. */
const COMMANDS = Object.freeze([
  "createEmployee", "updateEmployeeProfile", "linkEmployeePrincipal", "unlinkEmployeePrincipal", "relinkEmployeePrincipal",
]);

/**
 * Flag name -> governed profile FIELD KEY, closed and explicit.
 *
 * The keys are employeeProfileVocabulary.PROFILE_FIELD_MAP's, dots and all. A closed map is what keeps
 * an operator from reaching a column the profile vocabulary does not name: there is no `--field k=v`
 * here, so `--employmentStatus` can never arrive as a profile "change" and `--operationalRoles`,
 * `--securityRole` and `--userId` are simply unknown flags.
 */
const PROFILE_FLAGS = Object.freeze({
  employeeNumber: "employeeNumber",
  displayName: "displayName",
  firstName: "firstName",
  middleName: "middleName",
  lastName: "lastName",
  preferredName: "preferredName",
  jobTitle: "jobTitle",
  workEmail: "workEmail",
  workPhone: "workPhone",
  mobilePhone: "mobilePhone",
  addressStreet: "address.street",
  addressUnit: "address.unit",
  addressCity: "address.city",
  addressState: "address.state",
  addressPostalCode: "address.postalCode",
  hireDate: "hireDate",
  separationDate: "separationDate",
});

const FENCE_FLAGS = Object.freeze(["environment", "databaseUrlEnv", "tenantKey", "performedBy", "adminPrincipalId", "apply"]);
const OPERATION_FLAGS = Object.freeze([
  "command", "employeeId", "employmentStatus", "operatingCompanyId",
  "linkedPrincipalId", "expectedCurrentPrincipalId", "newPrincipalId", "reason",
]);
const KNOWN_FLAGS = Object.freeze([...FENCE_FLAGS, ...OPERATION_FLAGS, ...Object.keys(PROFILE_FLAGS)]);

/** Flags that would SUPPLY authority. Already covered by the unknown-flag refusal; named so the refusal says WHY. */
const AUTHORITY_BEARING_FLAGS = Object.freeze([
  "heldRoleKeys", "heldRoles", "roleKeys", "roles", "role", "capabilities", "capability",
  "entitlements", "grant", "grants", "permissions", "securityRole", "jobRole", "jobRoleId",
  "tenantId", "principalId", "uid", "externalSubject",
]);
const CREDENTIAL_BEARING_FLAGS = Object.freeze([
  "password", "authPassword", "authPasswordEnv", "token", "idToken", "secret", "credential",
  "credentials", "serviceAccount", "serviceAccountKey", "apiKey", "databaseUrl", "connectionString",
]);

/** Mirrors commands/employeeAdministrationInput.ts, so a refusal happens before a connection is opened. */
const MIN_REASON_LENGTH = 10;
const MAX_REASON_LENGTH = 500;

class EmployeeAdministrationCliError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "EmployeeAdministrationCliError";
    this.code = code;
  }
}
const refuse = (code, message) => {
  throw new EmployeeAdministrationCliError(code, message);
};

const given = (args, flag) => typeof args[flag] === "string" && args[flag] !== "true" && args[flag].trim() !== "";
function required(args, flag) {
  if (!given(args, flag)) refuse("ARGUMENT_REQUIRED", `--${flag} is required and has no default`);
  return args[flag].trim();
}
function forbidden(args, flags, command) {
  for (const flag of flags) {
    if (args[flag] !== undefined) {
      refuse("ARGUMENT_NOT_ACCEPTED", `--${flag} is not accepted by --command ${command}; this wrapper never sends a field the command would refuse`);
    }
  }
}

/**
 * Refuse before anything is loaded that could contact anything.
 *
 * Order is the property under test: the target is named, production is refused, the runtime is
 * positively identified as nonprod, and only then is any argument shaped. Throws BEFORE the caller has
 * required `pg` or anything from lib/.
 */
function assertInvocation(args, env) {
  for (const flag of Object.keys(args)) {
    if (KNOWN_FLAGS.includes(flag)) continue;
    if (AUTHORITY_BEARING_FLAGS.includes(flag)) {
      refuse("AUTHORITY_ARGUMENT_REFUSED",
        `--${flag} would SUPPLY authority. The administering Principal's Roles are READ FROM PostgreSQL from `
        + "its active assignments, and its capabilities from eos_policy.role_capabilities and "
        + "eos_policy.principal_capabilities; no tenant, Principal, Role, capability, entitlement or grant is "
        + "ever accepted as an argument, because an asserted capability set makes the governed command's own "
        + "gate decorative.");
    }
    if (CREDENTIAL_BEARING_FLAGS.includes(flag)) {
      refuse("CREDENTIAL_ARGUMENT_REFUSED",
        `--${flag} would put a credential on a command line. argv appears in ps, in shell history and in CI `
        + "logs. This tool creates, rotates, fetches and prints no credential, and the connection string is "
        + "named by --databaseUrlEnv rather than passed.");
    }
    refuse("UNKNOWN_FLAG_REFUSED",
      `--${flag} is not a flag this tool understands. An unrecognized flag is REFUSED rather than ignored: `
      + "a silently dropped argument is how an operator believes they constrained a run that they did not.");
  }

  const { environmentId, connectionString } = assertMeasurementTarget(args, env);
  assertNonprodRuntime(env);
  if (FROZEN_ENVIRONMENTS.includes(environmentId)) {
    refuse("ENVIRONMENT_FROZEN", `--environment '${environmentId}' is the Certification world, which is frozen.`);
  }

  const tenantKey = required(args, "tenantKey");
  const performedBy = required(args, "performedBy");
  if (!/^[A-Za-z0-9._@-]{1,100}$/.test(performedBy)) {
    refuse("ARGUMENT_REQUIRED", "--performedBy <operator> is required ([A-Za-z0-9._@-], at most 100).");
  }
  const adminPrincipalId = required(args, "adminPrincipalId");
  const command = required(args, "command");
  if (!COMMANDS.includes(command)) {
    refuse("COMMAND_UNKNOWN", `--command must be one of ${COMMANDS.join(", ")}; this wrapper administers nothing else.`);
  }
  const employeeId = required(args, "employeeId");
  const reason = required(args, "reason");
  if (reason.length < MIN_REASON_LENGTH || reason.length > MAX_REASON_LENGTH) {
    refuse("REASON_REQUIRED",
      `--reason is ${reason.length} characters; ${MIN_REASON_LENGTH}-${MAX_REASON_LENGTH} are required. Every `
      + "governed Employee administration change records why it was made.");
  }

  const profile = {};
  for (const [flag, key] of Object.entries(PROFILE_FLAGS)) {
    if (args[flag] === undefined) continue;
    if (!given(args, flag)) {
      refuse("ARGUMENT_REQUIRED",
        `--${flag} was given with no value. There is no way to CLEAR a profile fact here: omit the flag to leave `
        + "it alone, and clear it through the governed updateEmployeeProfile operation, which takes an explicit null.");
    }
    profile[key] = args[flag].trim();
  }

  const input = { employeeId, reason };
  if (command === "createEmployee") {
    forbidden(args, ["linkedPrincipalId", "expectedCurrentPrincipalId", "newPrincipalId"], command);
    input.employmentStatus = required(args, "employmentStatus");
    input.operatingCompanyId = required(args, "operatingCompanyId");
    // Absent is an Employee with no profile fact, which the command accepts. Nothing is fabricated.
    if (Object.keys(profile).length > 0) input.profile = profile;
  } else if (command === "updateEmployeeProfile") {
    forbidden(args, ["employmentStatus", "operatingCompanyId", "linkedPrincipalId", "expectedCurrentPrincipalId", "newPrincipalId"], command);
    if (Object.keys(profile).length === 0) {
      refuse("ARGUMENT_REQUIRED", "--command updateEmployeeProfile requires at least one profile flag; there is no empty edit.");
    }
    input.changes = profile;
  } else {
    forbidden(args, ["employmentStatus", "operatingCompanyId", ...Object.keys(PROFILE_FLAGS)], command);
    if (command === "linkEmployeePrincipal") {
      forbidden(args, ["expectedCurrentPrincipalId", "newPrincipalId"], command);
      input.linkedPrincipalId = required(args, "linkedPrincipalId");
    } else {
      forbidden(args, ["linkedPrincipalId"], command);
      // THE COMPARE-AND-SWAP, mandatory in the command and therefore mandatory here.
      input.expectedCurrentPrincipalId = required(args, "expectedCurrentPrincipalId");
      if (command === "relinkEmployeePrincipal") input.newPrincipalId = required(args, "newPrincipalId");
      else forbidden(args, ["newPrincipalId"], command);
    }
  }

  return {
    environmentId, connectionString, tenantKey, performedBy, adminPrincipalId, command, input,
    apply: args.apply === "true",
  };
}

/**
 * Run (or plan) ONE governed command. `deps` carries the commands and the authority resolver so this is
 * provable against a real database without a process boundary.
 */
async function administerEmployeeRun(pool, options, deps) {
  const { commands, resolveEmployeeAdministrationActor } = deps;
  const tenant = await pool.query("SELECT id FROM eos_policy.tenants WHERE key = $1", [options.tenantKey]);
  if (tenant.rows.length !== 1) {
    refuse("TENANT_NOT_FOUND", `no tenant with key '${options.tenantKey}'; this run never creates one`);
  }
  const tenantId = tenant.rows[0].id;

  // THE AUTHORITY, READ. A dry run resolves it too: "would this Principal be allowed" is most of what a
  // dry run is for, and resolving it writes nothing.
  const actor = await resolveEmployeeAdministrationActor(pool, { tenantId, principalId: options.adminPrincipalId });

  const report = {
    tool: "administerEmployee",
    environment: options.environmentId,
    tenantKey: options.tenantKey,
    tenantId,
    performedBy: options.performedBy,
    adminPrincipalId: options.adminPrincipalId,
    adminRoleKeys: [...actor.heldRoleKeys],
    adminDirectCapabilityKeys: [...actor.directCapabilityKeys],
    command: options.command,
    input: options.input,
    apply: options.apply,
  };
  if (!options.apply) {
    // A DRY RUN WRITES NOTHING. Not a row, not an audit event.
    return { ...report, outcome: "PLANNED", result: null };
  }
  const result = await commands[options.command]({ pool }, actor, options.input);
  return { ...report, outcome: result.outcome, result };
}

async function main() {
  const options = assertInvocation(parseArgs(process.argv.slice(2)), process.env);
  const pg = require("pg");
  const { resolvePolicyDatabaseConfig } = require("../lib/adminPolicy/policyDatabase.js");
  const { resolveEmployeeAdministrationActor } = require("../lib/eosWorkforce/commands/employeeAdministrationAuthority.js");
  const creation = require("../lib/eosWorkforce/commands/employeeCreationCommand.js");
  const profile = require("../lib/eosWorkforce/commands/employeeProfileCommand.js");
  const links = require("../lib/eosWorkforce/commands/employeePrincipalLinkCommands.js");
  const commands = {
    createEmployee: creation.createEmployee,
    updateEmployeeProfile: profile.updateEmployeeProfile,
    linkEmployeePrincipal: links.linkEmployeePrincipal,
    unlinkEmployeePrincipal: links.unlinkEmployeePrincipal,
    relinkEmployeePrincipal: links.relinkEmployeePrincipal,
  };
  const pool = new pg.Pool(resolvePolicyDatabaseConfig({ connectionString: options.connectionString }));
  try {
    const report = await administerEmployeeRun(pool, options, { commands, resolveEmployeeAdministrationActor });
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = 0;
  } finally {
    await pool.end();
  }
}

module.exports = {
  assertInvocation, administerEmployeeRun, COMMANDS, PROFILE_FLAGS, KNOWN_FLAGS,
  AUTHORITY_BEARING_FLAGS, CREDENTIAL_BEARING_FLAGS,
};

if (require.main === module) {
  main().catch((err) => {
    const governed = err instanceof EmployeeAdministrationCliError || !err || !err.code || typeof err.code === "string";
    console.error(JSON.stringify({
      outcome: "REFUSED_OR_FAILED",
      code: err && typeof err.code === "string" ? err.code : null,
      message: governed ? (err instanceof Error ? err.message : String(err)) : "the run could not be completed",
    }, null, 2));
    process.exitCode = 2;
  });
}
