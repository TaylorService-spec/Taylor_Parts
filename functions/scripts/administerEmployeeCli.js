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
//   assignEmployeeJobRole    lib/eosWorkforce/commands/employeeJobRoleCommands.js
//
// THERE IS NO RAW SQL ESCAPE HATCH. This file contains no INSERT, no UPDATE and no DELETE. Its only
// query is the tenant lookup by key, and the authority resolution's SELECTs inside
// lib/eosWorkforce/commands/employeeAdministrationAuthority.js. A tool that could also write directly would
// make every guarantee above optional.
//
// ---------------------------------------------------------------------------------------------------
// JOB ROLES WERE NOT ADMINISTERED HERE, AND NOW ARE -- BY ONE COMMAND ONLY (Owner ruling 2026-09-25).
//
// This file used to say: "JOB ROLES ARE NOT ADMINISTERED HERE. `assignEmployeeJobRole` has its own
// capability (admin.employeeJobRole.write) and its own operator surface". That sentence is kept above
// rather than deleted because the REASONING in it is still true and still enforced -- only its
// conclusion changed, and the record of why is worth more than a tidy paragraph.
//
// WHAT CHANGED. The "own operator surface" it pointed at was scripts/seedPersonaAuthorityDimensionsCli.js,
// and that CLI cannot assign a Job Role: its planner emits createJobRole / assignEmployeeJobRole steps
// that its executor does not wire, so an apply throws `commands[step.command] is not a function` before
// any write (see that file's KNOWN DEFECT header). The Owner ruled that it is NOT repaired in this wave
// -- it also plans redundant catalog creations and assignments for noncanonical Employees, both outside
// the approved scope -- and that governed Job Role ASSIGNMENT is added here instead.
//
// WHAT DID NOT CHANGE, and is asserted by the suite:
//
//   THE CAPABILITY IS STILL ITS OWN. assignEmployeeJobRole gates on admin.employeeJobRole.write, NOT on
//   admin.employeeProfile.write. A Principal that may create and edit Employees here still may not
//   assign a position unless it separately holds the Job Role capability. No capability, role_capabilities
//   row, grant or migration is added by this change: nonprod stays at 79 capabilities / 413 role_capabilities.
//
//   CREATING AN EMPLOYEE STILL ASSIGNS NO JOB ROLE. `--jobRoleId` is accepted by --command
//   assignEmployeeJobRole and by NOTHING ELSE; on any other command it is refused
//   (ARGUMENT_NOT_ACCEPTED) exactly as --employmentStatus is refused on a link.
//
//   THE ASSIGNMENT IS ONE BOUNDED OPERATION. It sets the Employee's one current primary Job Role and
//   ends the prior one. It creates no Employee, links no Principal, grants no Security Role, and writes
//   no Work Eligibility and no Operational Scope -- there is no flag here that could ask for any of
//   those, and the suite snapshots every one of those relations across a real assignment.
// ---------------------------------------------------------------------------------------------------
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
//   REQUIRED       --tenantKey, --performedBy, --adminPrincipalId, --command, --employeeId, --reason,
//                  and --jobRoleId for --command assignEmployeeJobRole (refused for every other command).
//   DRY RUN        the default. --apply is required to write, and a dry run writes nothing at all.
//
// Usage (Render Shell on eos-api-nonprod):
//   node scripts/administerEmployeeCli.js --environment platform-sandbox --databaseUrlEnv DATABASE_URL \
//     --tenantKey taylor-nonprod --performedBy <operator> --adminPrincipalId <principal> \
//     --command createEmployee --employeeId emp-jane-doe --employmentStatus ACTIVE \
//     --operatingCompanyId taylor --displayName "Jane Doe" --reason "new hire, per signed offer 2026-09-25" [--apply]
//
//   node scripts/administerEmployeeCli.js --environment platform-sandbox --databaseUrlEnv DATABASE_URL \
//     --tenantKey taylor-nonprod --performedBy <operator> --adminPrincipalId <principal> \
//     --command assignEmployeeJobRole --employeeId emp-jane-doe --jobRoleId service-technician \
//     --reason "business position per the Owner-ruled catalog" [--apply]
//
// Exit 0 when the run is clean (PLANNED, or the command's own outcome); 2 when refused or failed.
"use strict";

const { assertMeasurementTarget, parseArgs } = require("./measureEmployeeReferenceIntegrity.js");
const { assertNonprodRuntime } = require("./measureWorkforceActivation.js");

const FROZEN_ENVIRONMENTS = Object.freeze(["platform-certification"]);

/** The governed commands this wrapper may drive. A name not in this list is not administered here. */
const COMMANDS = Object.freeze([
  "createEmployee", "updateEmployeeProfile", "linkEmployeePrincipal", "unlinkEmployeePrincipal", "relinkEmployeePrincipal",
  "assignEmployeeJobRole",
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
  // A BUSINESS POSITION, NOT AUTHORITY. `jobRoleId` was in AUTHORITY_BEARING_FLAGS below while no command
  // here took one; it is moved rather than duplicated, because a flag that is both "known" and "refused as
  // authority" would be a lie in one of the two lists (KNOWN_FLAGS is tested first, so the refusal was
  // already unreachable the moment the flag became real). A Job Role grants no capability, implies no Work
  // Eligibility and no Operational Scope and is never inferred from a Security Role -- see
  // src/eosWorkforce/jobRoleVocabulary.ts. `jobRole`, `securityRole` and every other authority term below
  // stay refused, and `--jobRoleId` itself stays refused on every command but assignEmployeeJobRole.
  "jobRoleId",
]);
const KNOWN_FLAGS = Object.freeze([...FENCE_FLAGS, ...OPERATION_FLAGS, ...Object.keys(PROFILE_FLAGS)]);

/** Flags that would SUPPLY authority. Already covered by the unknown-flag refusal; named so the refusal says WHY. */
const AUTHORITY_BEARING_FLAGS = Object.freeze([
  "heldRoleKeys", "heldRoles", "roleKeys", "roles", "role", "capabilities", "capability",
  "entitlements", "grant", "grants", "permissions", "securityRole", "jobRole",
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
  // A BUSINESS POSITION IS NOT A SIDE EFFECT OF ANYTHING ELSE. Every other command refuses --jobRoleId,
  // the way a link refuses --employmentStatus: the governed commands themselves refuse an unknown input
  // field, and a wrapper that let one through would only move the refusal later and make the operator's
  // report wrong about what it was going to do.
  if (command !== "assignEmployeeJobRole") forbidden(args, ["jobRoleId"], command);
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
  } else if (command === "assignEmployeeJobRole") {
    /**
     * THE EMPLOYEE'S ONE CURRENT PRIMARY JOB ROLE. Three inputs, which are exactly the three the governed
     * command accepts (employeeJobRoleCommands.assignEmployeeJobRole -> acceptOnly(["employeeId",
     * "jobRoleId", "reason"])); this wrapper composes no fourth.
     *
     * NO EXPECTED-CURRENT PROTECTION, BECAUSE THE COMMAND HAS NONE. The link commands' revoke and move
     * take a MANDATORY --expectedCurrentPrincipalId because unlinkEmployeePrincipal and
     * relinkEmployeePrincipal require one. assignEmployeeJobRole does not: it locks the Employee, locks
     * the current assignment row FOR UPDATE and ends it inside the same transaction, and a concurrent
     * change is caught by employee_job_role_one_current_per_employee as JOB_ROLE_CONCURRENT_CHANGE.
     * Inventing --expectedCurrentJobRoleId here would be a compare-and-swap the command cannot honour --
     * the wrapper would have to read the current row itself, outside the command's transaction, which is
     * a check that is worth less than nothing because it looks like a guarantee.
     *
     * REASON IS MANDATORY HERE AND OPTIONAL THERE. The command takes optionalReason; this tool requires
     * --reason of every operation it drives (10-500 characters, checked above) and passes it through, so
     * an operator-driven assignment always records why. That is a wrapper tightening its own input, not
     * a wrapper changing what the command enforces.
     */
    forbidden(args, ["employmentStatus", "operatingCompanyId", "linkedPrincipalId", "expectedCurrentPrincipalId",
      "newPrincipalId", ...Object.keys(PROFILE_FLAGS)], command);
    input.jobRoleId = required(args, "jobRoleId");
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
  // The EXISTING governed Job Role writer, under the EXISTING admin.employeeJobRole.write. Imported, not
  // reimplemented: there is no Job Role SQL in this file and no second gate in front of the command's.
  const jobRoles = require("../lib/eosWorkforce/commands/employeeJobRoleCommands.js");
  const commands = {
    createEmployee: creation.createEmployee,
    updateEmployeeProfile: profile.updateEmployeeProfile,
    linkEmployeePrincipal: links.linkEmployeePrincipal,
    unlinkEmployeePrincipal: links.unlinkEmployeePrincipal,
    relinkEmployeePrincipal: links.relinkEmployeePrincipal,
    assignEmployeeJobRole: jobRoles.assignEmployeeJobRole,
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
