"use strict";
// MEASURE FIRST -- the read-only census of existing PERSON references against the canonical Employee
// authority (eos_workforce.employees, functions/migrations/1759104000000_employee-business-authority.sql).
//
// ============================ WHY THIS SCRIPT EXISTS ============================
//
// Owner ruling #189 (`MI-λ`, "declare and quarantine") says, in capitals, **MEASURE FIRST**: the legal
// disposition of a person reference that does not resolve to a canonical governed Employee is decided
// from evidence, and the reference must not be fabricated into an Employee, silently mapped by id
// coincidence, silently mapped through a Firebase UID, deleted from immutable history, rewritten merely
// to satisfy a foreign key, or counted as a valid resolved Employee reference.
//
// Every one of those six prohibitions is about a WRITE. This script therefore performs none: it counts
// and classifies, and that is the whole of it. It is what turns "measure first" from an intention in a
// ruling into an artifact somebody can run, and it is the precondition-checker for
// functions/migrations/deferred/1759190400000_employee-principal-link-employee-fk.sql, which stays
// unapplied until this report comes back clean.
//
// ============================ READ ONLY, BY CONSTRUCTION ============================
//
// Every statement is a SELECT. There is no INSERT, UPDATE, DELETE, ALTER, CREATE, DROP, TRUNCATE,
// COPY or MERGE anywhere in this file, and the connection is opened with a read-only transaction
// (`SET TRANSACTION READ ONLY`) so the DATABASE refuses a write even if a future edit to this file
// tried one. functions/test/employeeReferenceIntegrityMeasurement.test.mjs asserts the absence of the
// write verbs statically, so the claim is guarded rather than merely asserted in this comment.
//
// It also never contacts Firestore, `users`, `fieldops_technicians` or Firebase Auth. It cannot: it
// loads no Firebase module. A measurement that reached for a legacy collection to "resolve" an
// unresolved reference would be performing the very inference #189 forbids, dressed as a count.
//
// ============================ THE ENVIRONMENT FENCE ============================
//
// The same rule functions/scripts/projectTargetGuard.js and functions/scripts/sandboxTargetGuard.js
// hold, adapted to the target this tool actually has -- a DATABASE rather than a Firebase project:
//
//     NO EXPLICIT ENVIRONMENT = REFUSE. NO EXPLICIT DATABASE = REFUSE.
//
//   * `--environment <id>` is REQUIRED and must be byte-identical to an environment id declared in
//     config/environments.json. Nothing is inferred from the working directory, .firebaserc, ambient
//     credentials or a process.env fallback -- each of those is a property of the machine rather than
//     a statement of intent, and a fence the environment can satisfy on the operator's behalf is not
//     a fence.
//   * PRODUCTION IS REFUSED TWICE OVER: by `role === "production"` in the registry, AND by the
//     project id `taylor-parts` named literally here. sandboxTargetGuard.js's own header names
//     "refuse the customer production project by NAME as well as by role" as a recommended follow-up,
//     because deriving the refusal from one field in one file trusts that field absolutely; a
//     mislabelled entry would defeat it and nothing else would notice. This tool takes the follow-up,
//     because it is new and owes no existing assertion a stable message. Read-only is not a licence:
//     a SELECT against production is still an unauthorized read of customer data.
//   * `--databaseUrlEnv <VAR>` is REQUIRED and names the ENVIRONMENT VARIABLE holding the connection
//     string. The string itself is never an argument, because argv appears in `ps`, in shell history
//     and in CI logs, and a connection string carries a password that outlives every rotation. There
//     is deliberately NO fallback to an ambient `DATABASE_URL`: an ambient variable is exactly the
//     implicit target the fence exists to refuse.
//
// AND THE REFUSAL PRECEDES ANY CLIENT. `pg` and the compiled `lib/` are require()d INSIDE main(),
// after the fence has passed -- never at module top level. That is projectTargetGuard.js's stated
// discipline (`:26-34`): a script whose safety property is refusing before any client exists cannot
// demonstrate it if merely reaching the guard has already loaded the driver. The fence preload in
// functions/test/operatorScriptEnvironmentFence.test.mjs treats resolving `pg` as a violation, which
// is the mechanism that makes this checkable rather than aspirational.
//
// ============================ WHAT IT MEASURES, AND WHAT IT REFUSES TO ============================
//
// IN SCOPE: the FOURTEEN columns in the migration set that hold a business EMPLOYEE id. They are listed in
// EMPLOYEE_REFERENCE_COLUMNS below, each with the migration and line it was read from.
//
// OUT OF SCOPE, and this is the more important half: the ~60 `created_by` / `updated_by` / `actor_uid`
// / `granted_by` / `recorded_by` / `claimed_by` / `submitted_by` columns. NONE of them is an Employee
// reference. They hold the CREDENTIAL/PRINCIPAL-side actor id, and #185's resolution chain runs
// CREDENTIAL -> PRINCIPAL -> EMPLOYEE LINK -> EMPLOYEE in that direction only. Measuring them against
// `employees` would be inferring an Employee identity from a credential id -- which #185 lists among
// the things "insufficient as proof that an Employee exists" (a non-empty string, a Firebase uid, a
// technician id, Principal existence alone) and which #189 forbids outright. So they are declared
// OUT_OF_SCOPE by name, not silently skipped: an operator reading this report must be able to see that
// the omission was a decision.
//
// ============================ THE CLASSIFICATION ============================
//
// Per column, and never collapsed into one number:
//
//   TOTAL          rows holding a non-NULL reference
//   NULL_REFERENCE rows where the column is NULL -- legitimately absent where the column is nullable,
//                  and NOT a defect on its own (#182 state D, "only where the family legitimately
//                  permits no person reference")
//   RESOLVED       resolves to an employees row IN THE SAME TENANT -- the only class that may be
//                  counted as a valid canonical Employee reference (#189)
//   CROSS_TENANT   resolves to an employees row in a DIFFERENT tenant. Reported separately because it
//                  is not "resolved": migration 003's Ruling B calls this a cross-tenant identity leak
//                  rather than a dangling row, and a key onto `employees(id)` alone would have let it
//                  through
//   UNRESOLVED     no employees row carries this id in any tenant -- #189's "HISTORICAL / LEGACY
//                  UNRESOLVED PERSON REFERENCE", to be preserved and quarantined, never fabricated
//                  into an Employee and never counted as resolved
//   MALFORMED      fails the shape the Employee id must have (empty, untrimmed, or path-shaped) and so
//                  could never resolve to any conforming employees row
//
// APPEND-ONLY columns are flagged. `ownership_handoffs` is protected by
// `refuse_ownership_history_mutation` (016:295-305), which raises on UPDATE and DELETE, so an
// unresolvable id already written there is PERMANENT BY DESIGN -- #189's finding, and the reason a
// naive foreign key is the wrong instrument for those two columns. The report says so per column
// rather than leaving a reader to know it.
//
// EXIT CODE: 0 when every in-scope column reports UNRESOLVED = 0, CROSS_TENANT = 0 and MALFORMED = 0.
// 1 otherwise -- and a 1 is NOT an error in this tool, it is the measurement saying the deferred
// foreign key's precondition is not met. 2 is a real failure (fence refusal, unreachable database).
//
// AUTHORITY_UNAVAILABLE IS REPORTED, NOT PAPERED OVER. If a table cannot be read, that column's class
// is AUTHORITY_UNAVAILABLE and the run fails; it is never recorded as "0 unresolved". #187 rules the
// distinction and this tool keeps it: an absent answer and an answer of zero are different facts, and
// conflating them here would manufacture exactly the false clean bill of health that would authorize
// moving the deferred migration.
//
// Usage:
//   node scripts/measureEmployeeReferenceIntegrity.js --environment platform-sandbox \
//       --databaseUrlEnv POLICY_TEST_DATABASE_URL [--json] [--evidence-dir <dir>]

const fs = require("node:fs");
const path = require("node:path");

/** The customer production project. Refused by NAME as well as by role -- see the header. */
const PRODUCTION_PROJECT_ID = "taylor-parts";
const PRODUCTION_ROLE = "production";

/** The canonical Employee authority this census resolves against (migration 019). */
const EMPLOYEE_AUTHORITY = { schema: "eos_workforce", table: "employees", idColumn: "id" };

/**
 * The fourteen columns in the migration set that hold a business EMPLOYEE id. The three credited-salesperson columns
 * (migration 022) joined when the Commercial wave C2 command layer began writing them; the two append-only CRM Account
 * ownership-history columns (migration 1759924800000) when the governed Account ownership-history writer arrived
 * (previous owner is NULL only for an INITIAL_OWNER_ASSIGNMENT).
 *
 * Each carries the migration and line it was read from, because a census whose scope cannot be
 * re-verified at source is a list somebody will trust without checking. `appendOnly` marks a column on
 * a table with a mutation-refusal trigger, where a bad value is permanent by design.
 */
const EMPLOYEE_REFERENCE_COLUMNS = Object.freeze([
  { schema: "eos_policy", table: "employee_principal_links", column: "employee_id", nullable: false, appendOnly: false, source: "1758412800000:120" },
  { schema: "eos_crm", table: "accounts", column: "owner_employee_id", nullable: true, appendOnly: false, source: "1758758400000:176" },
  { schema: "eos_crm", table: "contacts", column: "owner_employee_id", nullable: true, appendOnly: false, source: "1758758400000:219" },
  { schema: "eos_crm", table: "account_locations", column: "owner_employee_id", nullable: true, appendOnly: false, source: "1758758400000:262" },
  { schema: "eos_commercial", table: "opportunities", column: "owner_employee_id", nullable: false, appendOnly: false, source: "1758844800000:184" },
  { schema: "eos_commercial", table: "sales_agreements", column: "owner_employee_id", nullable: false, appendOnly: false, source: "1758844800000:208" },
  { schema: "eos_commercial", table: "sales_orders", column: "owner_employee_id", nullable: false, appendOnly: false, source: "1758844800000:233" },
  { schema: "eos_commercial", table: "ownership_handoffs", column: "previous_owner_employee_id", nullable: true, appendOnly: true, source: "1758844800000:262" },
  { schema: "eos_commercial", table: "ownership_handoffs", column: "new_owner_employee_id", nullable: false, appendOnly: true, source: "1758844800000:263" },
  { schema: "eos_commercial", table: "opportunities", column: "credited_salesperson_employee_id", nullable: true, appendOnly: false, source: "1759449600000:89" },
  { schema: "eos_commercial", table: "sales_agreements", column: "credited_salesperson_employee_id", nullable: true, appendOnly: false, source: "1759449600000:121" },
  { schema: "eos_commercial", table: "sales_orders", column: "credited_salesperson_employee_id", nullable: true, appendOnly: false, source: "1759449600000:181" },
  { schema: "eos_crm", table: "account_ownership_history", column: "previous_owner_employee_id", nullable: true, appendOnly: true, source: "1759924800000:69" },
  { schema: "eos_crm", table: "account_ownership_history", column: "new_owner_employee_id", nullable: false, appendOnly: true, source: "1759924800000:70" },
]);

/**
 * Column-name suffixes that hold a CREDENTIAL/PRINCIPAL actor id, never an Employee id.
 *
 * Declared so the report can SAY they were excluded and why. See the header: keying or counting any of
 * these against `employees` would infer an Employee identity from a credential id, which #185 calls
 * insufficient proof and #189 forbids.
 */
const OUT_OF_SCOPE_ACTOR_COLUMNS = Object.freeze([
  "created_by", "updated_by", "granted_by", "published_by", "actor_uid", "recorded_by",
  "claimed_by", "closed_by", "submitted_by", "reconciled_by", "requested_by", "voided_by",
  "issued_by", "performed_by", "principal_id", "principal_uid", "external_subject",
]);

function registryPath() {
  return path.resolve(__dirname, "..", "..", "config", "environments.json");
}

function loadEnvironmentRegistry() {
  const p = registryPath();
  let raw;
  try {
    raw = fs.readFileSync(p, "utf8");
  } catch (err) {
    throw new Error(`--environment requires config/environments.json to be readable at ${p}: ${err.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`config/environments.json is not valid JSON: ${err.message}`);
  }
}

/** `--flag value` pairs plus bare `--flag`, the shape projectTargetGuard.js's parseArgs produces. */
function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith("--")) throw new Error(`unexpected argument '${argv[i]}': every option is --flag or --flag value`);
    const key = argv[i].slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : "true";
    args[key] = value;
    if (value !== "true") i += 1;
  }
  return args;
}

/**
 * Refuse unless the target is NAMED, and refuse production twice over.
 *
 * Returns the resolved connection string. Throws BEFORE any caller has loaded a driver -- which is the
 * property, not merely that it throws.
 *
 * @param {Record<string,string>} args parsed argv
 * @param {Record<string,string|undefined>} env the process environment, injected so this is testable
 */
function assertMeasurementTarget(args, env) {
  if (!args.environment) {
    throw new Error(
      "--environment is required (e.g. --environment platform-sandbox). There is no default and " +
        "nothing is inferred from the working directory, .firebaserc, ambient credentials or process.env."
    );
  }
  const registry = loadEnvironmentRegistry();
  const declared = ((registry && registry.environments) || []).filter((e) => e && typeof e.id === "string");
  const match = declared.find((e) => e.id === args.environment);
  if (!match) {
    throw new Error(
      `--environment must be byte-identical to an environment id declared in config/environments.json ` +
        `(${JSON.stringify(declared.map((e) => e.id))}); refusing '${args.environment}'. Aliases, ` +
        "near-misses and unknown ids are refused rather than resolved."
    );
  }
  // Refusal 1, by role. Refusal 2, by project id named literally -- so a mislabelled registry entry
  // does not silently become a production-capable target.
  if (match.role === PRODUCTION_ROLE) {
    throw new Error(
      `--environment '${args.environment}' has role "${PRODUCTION_ROLE}" in config/environments.json. ` +
        "This tool refuses production. It reads no data it is not authorized to read, and read-only is " +
        "not a licence: a SELECT against production is still an unauthorized read of customer data."
    );
  }
  const projectId = match.firebase && match.firebase.projectId;
  if (projectId === PRODUCTION_PROJECT_ID) {
    throw new Error(
      `--environment '${args.environment}' names the customer production project '${PRODUCTION_PROJECT_ID}' ` +
        "in config/environments.json, whatever its declared role says. Refused."
    );
  }

  if (!args.databaseUrlEnv) {
    throw new Error(
      "--databaseUrlEnv <VAR> is required: it names the ENVIRONMENT VARIABLE holding the connection " +
        "string. The connection string is never passed as an argument, because argv appears in ps, in " +
        "shell history and in CI logs, and it carries a password. There is no fallback to an ambient " +
        "DATABASE_URL -- an ambient variable is the implicit target this fence exists to refuse."
    );
  }
  const connectionString = env[args.databaseUrlEnv];
  if (!connectionString) {
    throw new Error(
      `--databaseUrlEnv named '${args.databaseUrlEnv}' but that environment variable is empty or unset. ` +
        "Refusing rather than falling back to another variable."
    );
  }
  return { environmentId: match.id, connectionString };
}

/** Does this column exist in the connected database? A missing table is not a zero. */
async function columnExists(client, ref) {
  const res = await client.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`,
    [ref.schema, ref.table, ref.column],
  );
  return res.rows.length > 0;
}

/**
 * Classify one column's references against the Employee authority. ONE SELECT, no writes.
 *
 * The join is on the bare id AND on the tenant, separately, because "resolves" and "resolves in my own
 * tenant" are different answers and collapsing them would hide the cross-tenant leak that migration
 * 003's Ruling B exists to prevent.
 */
async function classifyColumn(client, ref) {
  const { schema, table, column } = ref;
  const A = `${EMPLOYEE_AUTHORITY.schema}.${EMPLOYEE_AUTHORITY.table}`;
  const res = await client.query(
    `SELECT
        count(*)                                                        AS row_count,
        count(*) FILTER (WHERE r.${column} IS NULL)                     AS null_reference,
        count(*) FILTER (WHERE r.${column} IS NOT NULL AND NOT (
              r.${column} <> ''
          AND btrim(r.${column}) = r.${column}
          AND position('/' in r.${column}) = 0))                        AS malformed,
        count(*) FILTER (WHERE r.${column} IS NOT NULL AND same.id IS NOT NULL)                       AS resolved,
        count(*) FILTER (WHERE r.${column} IS NOT NULL AND same.id IS NULL AND any_t.id IS NOT NULL)  AS cross_tenant,
        count(*) FILTER (WHERE r.${column} IS NOT NULL AND any_t.id IS NULL)                          AS unresolved
      FROM ${schema}.${table} r
      LEFT JOIN ${A} same
             ON same.id = r.${column} AND same.tenant_id = r.tenant_id
      LEFT JOIN LATERAL (
           SELECT e.id FROM ${A} e WHERE e.id = r.${column} LIMIT 1
      ) any_t ON TRUE`,
  );
  const row = res.rows[0];
  const n = (v) => Number(v);
  return {
    ...ref,
    status: "MEASURED",
    rows: n(row.row_count),
    nullReference: n(row.null_reference),
    resolved: n(row.resolved),
    crossTenant: n(row.cross_tenant),
    unresolved: n(row.unresolved),
    malformed: n(row.malformed),
  };
}

/**
 * The census. Read-only from the first statement to the last.
 *
 * @param {{query: Function}} client an already-connected pg client
 */
async function measureEmployeeReferenceIntegrity(client) {
  // The database's own refusal, not only this file's discipline. If a future edit here tried a write,
  // Postgres would reject it rather than this comment.
  await client.query("SET TRANSACTION READ ONLY");

  const authorityPresent = await columnExists(client, {
    schema: EMPLOYEE_AUTHORITY.schema,
    table: EMPLOYEE_AUTHORITY.table,
    column: EMPLOYEE_AUTHORITY.idColumn,
  });

  const columns = [];
  for (const ref of EMPLOYEE_REFERENCE_COLUMNS) {
    if (!authorityPresent) {
      // The authority itself is absent -- migration 019 has not been applied here. Every reference is
      // then UNCLASSIFIABLE, and reporting each as "0 unresolved" would be the false clean bill of
      // health #187 forbids.
      columns.push({ ...ref, status: "AUTHORITY_UNAVAILABLE", reason: `${EMPLOYEE_AUTHORITY.schema}.${EMPLOYEE_AUTHORITY.table} is not present -- migration 019 has not been applied to this database` });
      continue;
    }
    if (!(await columnExists(client, ref))) {
      columns.push({ ...ref, status: "COLUMN_ABSENT", reason: `${ref.schema}.${ref.table}.${ref.column} is not present -- its migration has not been applied to this database` });
      continue;
    }
    try {
      columns.push(await classifyColumn(client, ref));
    } catch (err) {
      columns.push({ ...ref, status: "AUTHORITY_UNAVAILABLE", reason: err instanceof Error ? err.message : String(err) });
    }
  }

  const measured = columns.filter((c) => c.status === "MEASURED");
  const unavailable = columns.filter((c) => c.status === "AUTHORITY_UNAVAILABLE");
  return {
    authorityPresent,
    columns,
    outOfScopeActorColumns: [...OUT_OF_SCOPE_ACTOR_COLUMNS],
    totals: {
      resolved: measured.reduce((s, c) => s + c.resolved, 0),
      crossTenant: measured.reduce((s, c) => s + c.crossTenant, 0),
      unresolved: measured.reduce((s, c) => s + c.unresolved, 0),
      malformed: measured.reduce((s, c) => s + c.malformed, 0),
      nullReference: measured.reduce((s, c) => s + c.nullReference, 0),
    },
    // The precondition the deferred foreign key waits on -- and it is FALSE whenever anything could
    // not be measured, never merely when the counts happen to be zero.
    deferredForeignKeyPrecondition: (() => {
      const link = columns.find((c) => c.table === "employee_principal_links");
      if (!link || link.status !== "MEASURED") return { met: false, reason: "employee_principal_links.employee_id could not be measured" };
      if (link.unresolved > 0) return { met: false, reason: `${link.unresolved} employee_principal_links rows hold an employee_id that resolves to no Employee` };
      if (link.crossTenant > 0) return { met: false, reason: `${link.crossTenant} employee_principal_links rows resolve to an Employee in a DIFFERENT tenant` };
      if (link.malformed > 0) return { met: false, reason: `${link.malformed} employee_principal_links rows hold a malformed employee_id` };
      return { met: true, reason: "every employee_principal_links.employee_id resolves within its own tenant" };
    })(),
    unmeasured: unavailable.length,
  };
}

/** The report, as a human reads it. */
function describeReport(report, environmentId) {
  const lines = [];
  lines.push(`EMPLOYEE REFERENCE INTEGRITY -- environment ${environmentId}`);
  lines.push(`Employee authority: ${EMPLOYEE_AUTHORITY.schema}.${EMPLOYEE_AUTHORITY.table} ${report.authorityPresent ? "PRESENT" : "ABSENT"}`);
  lines.push("READ ONLY: this run wrote nothing.");
  lines.push("");
  for (const c of report.columns) {
    const where = `${c.schema}.${c.table}.${c.column}`;
    const flags = [c.appendOnly ? "APPEND-ONLY (a bad value here is permanent by design)" : null, c.nullable ? "nullable" : "NOT NULL"].filter(Boolean).join(", ");
    if (c.status !== "MEASURED") {
      lines.push(`  ${c.status.padEnd(22)} ${where}  [${flags}]  (${c.source})`);
      lines.push(`      ${c.reason}`);
      continue;
    }
    lines.push(`  MEASURED               ${where}  [${flags}]  (${c.source})`);
    lines.push(
      `      rows=${c.rows} null=${c.nullReference} RESOLVED=${c.resolved} ` +
        `CROSS_TENANT=${c.crossTenant} UNRESOLVED=${c.unresolved} MALFORMED=${c.malformed}`,
    );
  }
  lines.push("");
  lines.push("OUT OF SCOPE, deliberately -- these hold a CREDENTIAL/PRINCIPAL actor id, never an Employee id.");
  lines.push("Measuring them against the Employee authority would infer Employee identity from a credential,");
  lines.push("which ruling #185 calls insufficient proof and #189 forbids:");
  lines.push(`      ${report.outOfScopeActorColumns.join(", ")}`);
  lines.push("");
  const t = report.totals;
  lines.push(`TOTALS (measured columns only): RESOLVED=${t.resolved} CROSS_TENANT=${t.crossTenant} UNRESOLVED=${t.unresolved} MALFORMED=${t.malformed} NULL=${t.nullReference}`);
  if (report.unmeasured > 0) {
    lines.push(`AUTHORITY_UNAVAILABLE for ${report.unmeasured} column(s) -- these are NOT zeroes. The census is incomplete.`);
  }
  lines.push("");
  lines.push(`DEFERRED FOREIGN KEY PRECONDITION: ${report.deferredForeignKeyPrecondition.met ? "MET" : "NOT MET"} -- ${report.deferredForeignKeyPrecondition.reason}`);
  if (!report.deferredForeignKeyPrecondition.met) {
    lines.push("  Do NOT move functions/migrations/deferred/1759190400000_employee-principal-link-employee-fk.sql");
    lines.push("  into functions/migrations/. Ruling #189 (MI-l): preserve and quarantine. Never fabricate an");
    lines.push("  Employee to make a constraint pass, and never delete immutable history.");
  }
  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // THE FENCE, BEFORE ANY DRIVER IS LOADED. Everything above this line is fs + JSON.
  const { environmentId, connectionString } = assertMeasurementTarget(args, process.env);

  // Only now may a client exist.
  const pg = require("pg");
  const { resolvePolicyDatabaseConfig } = require("../lib/adminPolicy/policyDatabase.js");

  const client = new pg.Client(resolvePolicyDatabaseConfig({ connectionString }));
  await client.connect();
  let report;
  try {
    report = await measureEmployeeReferenceIntegrity(client);
  } finally {
    await client.end();
  }

  // eslint-disable-next-line no-console
  console.log(args.json === "true" ? JSON.stringify(report, null, 2) : describeReport(report, environmentId));

  if (args["evidence-dir"]) {
    fs.mkdirSync(args["evidence-dir"], { recursive: true });
    const out = path.join(args["evidence-dir"], `employee-reference-integrity-${environmentId}.json`);
    fs.writeFileSync(out, JSON.stringify(report, null, 2) + "\n", "utf8");
    // eslint-disable-next-line no-console
    console.log(`evidence written: ${out}`);
  }

  const clean =
    report.unmeasured === 0 &&
    report.totals.unresolved === 0 &&
    report.totals.crossTenant === 0 &&
    report.totals.malformed === 0;
  process.exitCode = clean ? 0 : 1;
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err instanceof Error ? err.message : err);
    // 2, not 1: a fence refusal or an unreachable database is a FAILURE TO MEASURE, and must never be
    // mistaken for the measurement having found something.
    process.exitCode = 2;
  });
}

module.exports = {
  parseArgs,
  assertMeasurementTarget,
  measureEmployeeReferenceIntegrity,
  describeReport,
  EMPLOYEE_REFERENCE_COLUMNS,
  OUT_OF_SCOPE_ACTOR_COLUMNS,
  EMPLOYEE_AUTHORITY,
  PRODUCTION_PROJECT_ID,
};
