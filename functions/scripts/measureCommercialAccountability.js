"use strict";
// MEASURE FIRST -- the read-only census of EXISTING commercial records against the accountable-person
// contract. No backfill, no repair, no write of any kind.
//
// ============================ WHY THIS SCRIPT EXISTS ============================
//
// Migration 1759276800000 added `accountable_employee_id` to `eos_commercial.opportunities`,
// `sales_agreements` and `sales_orders`, NULLABLE, and its header says why: #189 (`MI-λ`) requires
// **MEASURE FIRST**, and a `NOT NULL DEFAULT owner_employee_id` would have fabricated an accountability
// fact for every existing row while making #181's "NOT permanently derived from RECORD OWNER" false in
// the storage itself.
//
// So the column is nullable and this is the artifact that says what is actually there. It is the
// accountability counterpart of functions/scripts/measureEmployeeReferenceIntegrity.js, which #189's
// same clause produced for the PERSON-reference question, and it deliberately shares that script's
// FENCE rather than reimplementing it -- two fences drift, and the one that drifts is the one nobody
// reads.
//
// ANY BACKFILL IS A SEPARATE ARTIFACT. This script cannot perform one and is not a step toward one:
// #182 §10 rules "Backfill is NOT the mechanism for fixing historical inactive or terminated
// references", and #189 permits migration to reconcile a legacy reference "only when governed evidence
// establishes the relationship." A count is evidence about the population; it is not that evidence.
//
// ============================ READ ONLY, BY CONSTRUCTION ============================
//
// Every statement is a SELECT. There is no INSERT, UPDATE, DELETE, ALTER, CREATE, DROP, TRUNCATE, COPY
// or MERGE anywhere in this file, the transaction is opened READ ONLY so the DATABASE refuses a write
// even if a future edit tried one, and functions/test/commercialAccountabilityMeasurement.test.mjs
// asserts the absence of those verbs statically.
//
// It never contacts Firestore, `users`, `fieldops_technicians` or Firebase Auth, and it cannot: it
// loads no Firebase module. #187 §2 forbids falling back to any of them, and a measurement that
// consulted one to "resolve" an unresolved reference would be performing the forbidden inference
// dressed as a count.
//
// ============================ THE ELIGIBILITY POLICY IS AN ARGUMENT, NOT A DEFAULT ============================
//
// `--eligibleStatus <STATUS>` is REQUIRED and repeatable, and `--policyId <ID>` is REQUIRED. There is
// no default, and that is the single most important design decision in this file.
//
// #189 (`MI-ε`): "Do NOT implement this as `status != ACTIVE → refuse` unless the governed eligibility
// policy for that operation explicitly says so... The gate consumes the governed eligibility result and
// must not flatten the six-value vocabulary into a hidden boolean policy."
//
// A measurement with `ELIGIBLE = ['ACTIVE']` baked in would publish a number that LOOKS like a governed
// finding while encoding a policy nobody ruled -- and because a census number is what authorizes
// enforcement, that number would then authorize the unruled policy. So the operator must name the
// policy and its accepted statuses, the report prints both beside every count, and a reader can tell
// which policy produced the number they are looking at.
//
// ============================ THE CLASSIFICATION ============================
//
// Per table, and never collapsed into one number. The states are #182 §3's, composed with #189's:
//
//   presentValidEligible          accountable set · resolves to a governed Employee · ELIGIBLE under
//                                 the stated policy. #182 state A.
//   presentValidNotEligible       accountable set · resolves · NOT eligible under the stated policy.
//                                 #182 state B / #186 case B+C. NOT an invalid reference, and #186 §7
//                                 keeps it valid as history.
//   presentInvalid                accountable set · NO governed Employee resolves it. #182 state C,
//                                 #189 `MI-λ`'s quarantine population. Never counted as resolved.
//   presentCrossTenant            accountable set · an Employee with that id exists in ANOTHER tenant
//                                 and not in this one. Reported separately because migration 003's
//                                 Ruling B calls this an identity leak rather than a dangling row.
//   missingOwnerDerivable         accountable NULL · the CURRENT record owner resolves and IS eligible,
//                                 so #181's rung 2 could establish one. The recoverable population.
//   missingOwnerInvalid           accountable NULL · the record owner does not resolve to a governed
//                                 Employee, so rung 2 cannot run. #181's REFUSE case.
//   missingOwnerNotEligible       accountable NULL · the owner resolves but is NOT eligible. Also
//                                 rung 2 refused -- #182 §5 forbids inheriting an ineligible person.
//   governedException             an explicit governed accountability exception is recorded. #180
//                                 permits exactly this and nothing in EOS writes one yet, so this
//                                 count is expected to be 0 and exists so a future one is visible.
//
// EVERY ROW LANDS IN EXACTLY ONE BUCKET and the buckets sum to `scanned`. The script asserts that.
//
// ============================ WHAT IT REFUSES TO REPORT ============================
//
//   * AUTHORITY_UNAVAILABLE IS NEVER A COUNT. #187 §2 rules it distinct from INVALID / MISSING: it
//     means "EOS could not obtain an authoritative answer". For this tool, if the query ran then the
//     authority answered, so an unobtainable answer can only appear as a FAILURE TO MEASURE -- a
//     missing table, a missing column, or a thrown read. Those are reported in `unmeasured` and as a
//     non-zero exit, NEVER folded into `presentInvalid` or `missing*`. A report that showed
//     "0 invalid" for a table it could not read would be a false clean bill of health, and the clean
//     bill is what a backfill decision would be taken on.
//   * ACTIONABLE vs HISTORICAL IS NOT MEASURED HERE, and the reason is a property of the store rather
//     than a scoping choice. `eos_commercial` carries no lifecycle state: migration 1758844800000's own
//     header says so of the Sales Agreement -- "this schema does not hold a lifecycle state to know
//     which one a row is in". #186 §7/§8 make that distinction decisive (history is preserved; current
//     actionable work becomes a defect), so it MUST be measured where the lifecycle lives -- the
//     document projection -- and `accountabilityCensus.ts` is what measures it there. Claiming it here
//     from a store that cannot see it would be a guess with a number's clothes on.
//   * NO FAMILY OUTSIDE THE THREE IS SCANNED, and #189 `OD-16` is why: accountability is NOT APPLICABLE
//     to every other family, "not MISSING, not OWNERLESS, not DEFECTIVE". Scanning `suppliers` to
//     report zero accountable persons would manufacture exactly the backlog the ruling forbids.

// ONE FENCE, SHARED. `assertMeasurementTarget` refuses without an explicitly named environment and an
// explicitly named database variable, and refuses production twice over -- by role AND by project id.
// Requiring it here is safe for the property that matters: that sibling loads `pg` inside its own
// `main()`, never at module scope, so this require does not make the process capable of connecting.
const { assertMeasurementTarget, parseArgs } = require("./measureEmployeeReferenceIntegrity.js");

/** The canonical Employee authority every reference below is measured against. Migration 019. */
const EMPLOYEE_AUTHORITY = Object.freeze({ schema: "eos_workforce", table: "employees" });

/**
 * The THREE families #189 `OD-16` admits, and their two person columns. Nothing else is scanned.
 *
 * `owner` is read here NOT to validate ownership -- that is `ownershipCensus`'s job and #182 §1 forbids
 * using one person's validation as another's -- but to answer one specific question this measurement
 * has to answer: for a row with NO accountable person, could #181's rung 2 establish one? That
 * question is about the OWNER's resolvability, so the owner must be resolved to answer it.
 */
const ACCOUNTABILITY_TABLES = Object.freeze([
  Object.freeze({
    family: "opportunity",
    schema: "eos_commercial",
    table: "opportunities",
    accountableColumn: "accountable_employee_id",
    ownerColumn: "owner_employee_id",
    migration: "1759276800000_commercial-accountability-authority.sql",
  }),
  Object.freeze({
    family: "salesAgreement",
    schema: "eos_commercial",
    table: "sales_agreements",
    accountableColumn: "accountable_employee_id",
    ownerColumn: "owner_employee_id",
    migration: "1759276800000_commercial-accountability-authority.sql",
  }),
  Object.freeze({
    family: "salesOrder",
    schema: "eos_commercial",
    table: "sales_orders",
    accountableColumn: "accountable_employee_id",
    ownerColumn: "owner_employee_id",
    migration: "1759276800000_commercial-accountability-authority.sql",
  }),
]);

/**
 * The governed Employee lifecycle vocabulary, mirrored by literal from
 * functions/src/employeeIdentity/employeeAuthority.ts's EMPLOYMENT_STATUS_VALUES (whose canonical home
 * is field-ops-app-vite/src/domain/constants.js's EMPLOYMENT_STATUS). Used ONLY to refuse an
 * `--eligibleStatus` that is not a governed status -- a typo'd policy must not silently accept nothing.
 *
 * functions/test/commercialAccountabilityMeasurement.test.mjs asserts this list against that export.
 */
const EMPLOYMENT_STATUS_VALUES = Object.freeze([
  "ACTIVE",
  "ON_LEAVE",
  "INACTIVE",
  "TERMINATED",
  "RETIRED",
  "CONTRACTOR",
]);

/** The bucket names, in report order. Exported so the test can assert the sum covers all of them. */
const CLASSIFICATION_BUCKETS = Object.freeze([
  "presentValidEligible",
  "presentValidNotEligible",
  "presentInvalid",
  "presentCrossTenant",
  "missingOwnerDerivable",
  "missingOwnerInvalid",
  "missingOwnerNotEligible",
  "governedException",
]);

const emptyCounts = () => {
  const counts = {};
  for (const bucket of CLASSIFICATION_BUCKETS) counts[bucket] = 0;
  return counts;
};

/**
 * The governed eligibility policy, from argv. REQUIRED, both halves.
 *
 * @param {Record<string,string>} args parsed argv
 */
function assertEligibilityPolicy(args) {
  if (!args.policyId) {
    throw new Error(
      "--policyId <ID> is required: #189 MI-epsilon makes the eligibility answer a governed fact, and " +
        "a governed fact with no stated author cannot be re-examined later. Name the policy this run " +
        "measures against."
    );
  }
  const raw = args.eligibleStatus;
  const requested = raw === undefined ? [] : String(raw).split(",").map((s) => s.trim()).filter(Boolean);
  if (requested.length === 0) {
    throw new Error(
      "--eligibleStatus <STATUS[,STATUS...]> is required and has NO DEFAULT. #189 MI-epsilon forbids a " +
        "hidden boolean policy: name which of the six governed employment statuses this policy accepts " +
        `(${EMPLOYMENT_STATUS_VALUES.join(", ")}). A measurement that assumed ACTIVE would publish an ` +
        "unruled policy as a governed number."
    );
  }
  const unknown = requested.filter((s) => !EMPLOYMENT_STATUS_VALUES.includes(s));
  if (unknown.length > 0) {
    throw new Error(
      `--eligibleStatus named ${JSON.stringify(unknown)}, which are not governed employment statuses. ` +
        `The governed six are ${EMPLOYMENT_STATUS_VALUES.join(", ")}. A typo is refused rather than ` +
        "treated as a policy that accepts nothing."
    );
  }
  return { policyId: String(args.policyId), eligibleStatuses: Object.freeze([...new Set(requested)]) };
}

/** Does this column exist in the connected database? A missing table is NOT a zero. */
async function columnExists(client, ref, column) {
  const res = await client.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`,
    [ref.schema, ref.table, column]
  );
  return res.rows.length > 0;
}

/**
 * Classify one table's rows. ONE query, so every row is classified against one snapshot.
 *
 * The classification is expressed in SQL rather than in JavaScript over fetched rows for one reason
 * that matters at scale: a table with 400,000 commercial records must not be pulled into this process
 * to be counted. The CASE expression below is the whole classification and it is readable in one screen.
 */
async function classifyTable(client, ref, policy) {
  const accountablePresent = await columnExists(client, ref, ref.accountableColumn);
  if (!accountablePresent) {
    return {
      family: ref.family,
      relation: `${ref.schema}.${ref.table}`,
      measured: false,
      error:
        `${ref.schema}.${ref.table}.${ref.accountableColumn} does not exist in the connected database. ` +
        `Migration ${ref.migration} has not been applied here. This is a FAILURE TO MEASURE, not a ` +
        "finding of zero.",
    };
  }
  const res = await client.query(
    `WITH classified AS (
       SELECT
         r.${ref.accountableColumn}                     AS accountable_id,
         acc.id                                         AS acc_resolved,
         acc.employment_status::text                    AS acc_status,
         acc_any.id                                     AS acc_any_tenant,
         own.id                                         AS own_resolved,
         own.employment_status::text                    AS own_status
       FROM ${ref.schema}.${ref.table} r
       LEFT JOIN ${EMPLOYEE_AUTHORITY.schema}.${EMPLOYEE_AUTHORITY.table} acc
              ON acc.id = r.${ref.accountableColumn} AND acc.tenant_id = r.tenant_id
       LEFT JOIN ${EMPLOYEE_AUTHORITY.schema}.${EMPLOYEE_AUTHORITY.table} acc_any
              ON acc_any.id = r.${ref.accountableColumn}
       LEFT JOIN ${EMPLOYEE_AUTHORITY.schema}.${EMPLOYEE_AUTHORITY.table} own
              ON own.id = r.${ref.ownerColumn} AND own.tenant_id = r.tenant_id
     )
     SELECT
       count(*)::bigint AS scanned,
       count(*) FILTER (WHERE accountable_id IS NOT NULL AND acc_resolved IS NOT NULL
                          AND acc_status = ANY($1::text[]))::bigint AS present_valid_eligible,
       count(*) FILTER (WHERE accountable_id IS NOT NULL AND acc_resolved IS NOT NULL
                          AND NOT (acc_status = ANY($1::text[])))::bigint AS present_valid_not_eligible,
       count(*) FILTER (WHERE accountable_id IS NOT NULL AND acc_resolved IS NULL
                          AND acc_any_tenant IS NOT NULL)::bigint AS present_cross_tenant,
       count(*) FILTER (WHERE accountable_id IS NOT NULL AND acc_resolved IS NULL
                          AND acc_any_tenant IS NULL)::bigint AS present_invalid,
       count(*) FILTER (WHERE accountable_id IS NULL AND own_resolved IS NOT NULL
                          AND own_status = ANY($1::text[]))::bigint AS missing_owner_derivable,
       count(*) FILTER (WHERE accountable_id IS NULL AND own_resolved IS NOT NULL
                          AND NOT (own_status = ANY($1::text[])))::bigint AS missing_owner_not_eligible,
       count(*) FILTER (WHERE accountable_id IS NULL AND own_resolved IS NULL)::bigint AS missing_owner_invalid
     FROM classified`,
    [[...policy.eligibleStatuses]]
  );
  const row = res.rows[0] || {};
  const n = (v) => Number(v || 0);
  const counts = emptyCounts();
  counts.presentValidEligible = n(row.present_valid_eligible);
  counts.presentValidNotEligible = n(row.present_valid_not_eligible);
  counts.presentInvalid = n(row.present_invalid);
  counts.presentCrossTenant = n(row.present_cross_tenant);
  counts.missingOwnerDerivable = n(row.missing_owner_derivable);
  counts.missingOwnerInvalid = n(row.missing_owner_invalid);
  counts.missingOwnerNotEligible = n(row.missing_owner_not_eligible);
  // #180 permits an explicit Owner-approved exception. NOTHING in EOS writes one, so there is no
  // column to read: the count is 0 BECAUSE THE MECHANISM DOES NOT EXIST, which the report says in
  // words rather than leaving as an ambiguous zero.
  counts.governedException = 0;

  const scanned = n(row.scanned);
  const summed = CLASSIFICATION_BUCKETS.reduce((acc, k) => acc + counts[k], 0);
  if (summed !== scanned) {
    return {
      family: ref.family,
      relation: `${ref.schema}.${ref.table}`,
      measured: false,
      error:
        `classification does not partition the population: ${summed} classified of ${scanned} scanned. ` +
        "A row in no bucket, or in two, means this report cannot be trusted -- refusing to print it as " +
        "a finding.",
    };
  }
  return { family: ref.family, relation: `${ref.schema}.${ref.table}`, measured: true, scanned, counts };
}

/**
 * Measure every admitted family. Injected `client`, so the whole classification is testable with a
 * double and no database.
 */
async function measureCommercialAccountability(client, policy) {
  const tables = [];
  let unmeasured = 0;
  const totals = emptyCounts();
  let scanned = 0;

  const authorityPresent = await columnExists(client, EMPLOYEE_AUTHORITY, "employment_status");
  for (const ref of ACCOUNTABILITY_TABLES) {
    if (!authorityPresent) {
      // #187 §2, and it is the whole point of this branch: with no Employee authority present there is
      // no authoritative answer to be had about anybody. That is AUTHORITY_UNAVAILABLE. It is NOT
      // "every reference is invalid", so nothing is counted.
      tables.push({
        family: ref.family,
        relation: `${ref.schema}.${ref.table}`,
        measured: false,
        error:
          `${EMPLOYEE_AUTHORITY.schema}.${EMPLOYEE_AUTHORITY.table} is not present in the connected ` +
          "database, so NO authoritative Employee answer can be obtained. This is AUTHORITY_UNAVAILABLE " +
          "(#187 s2) -- a failure to measure, and explicitly NOT a finding that these references are " +
          "invalid or missing.",
      });
      unmeasured += 1;
      continue;
    }
    let report;
    try {
      report = await classifyTable(client, ref, policy);
    } catch (err) {
      report = {
        family: ref.family,
        relation: `${ref.schema}.${ref.table}`,
        measured: false,
        error: `read failed: ${err && err.message ? err.message : String(err)}`,
      };
    }
    tables.push(report);
    if (!report.measured) {
      unmeasured += 1;
      continue;
    }
    scanned += report.scanned;
    for (const bucket of CLASSIFICATION_BUCKETS) totals[bucket] += report.counts[bucket];
  }
  return { policy, tables, unmeasured, scanned, totals };
}

/** The printable report. Says what it measured, what it could not, and which policy it used. */
function describeReport(report, environmentId) {
  const lines = [];
  lines.push("COMMERCIAL ACCOUNTABILITY MEASUREMENT -- read only, no backfill");
  lines.push(`environment: ${environmentId}`);
  lines.push(`eligibility policy: ${report.policy.policyId}`);
  lines.push(`  accepts employment status: ${report.policy.eligibleStatuses.join(", ")}`);
  lines.push("  (#189 MI-epsilon: stated, never assumed. Another policy would produce other numbers.)");
  lines.push("");
  lines.push("scope: OPPORTUNITY, SALES AGREEMENT, SALES ORDER only (#189 OD-16).");
  lines.push("  Every other family: accountability NOT APPLICABLE -- not MISSING, not OWNERLESS,");
  lines.push("  not DEFECTIVE. No other family was scanned, and none should be.");
  lines.push("");
  for (const t of report.tables) {
    if (!t.measured) {
      lines.push(`${t.relation}  NOT MEASURED`);
      lines.push(`  ${t.error}`);
      lines.push("");
      continue;
    }
    lines.push(`${t.relation}  scanned ${t.scanned}`);
    for (const bucket of CLASSIFICATION_BUCKETS) {
      lines.push(`  ${bucket.padEnd(26)} ${t.counts[bucket]}`);
    }
    lines.push("");
  }
  lines.push(`TOTAL scanned ${report.scanned}`);
  for (const bucket of CLASSIFICATION_BUCKETS) {
    lines.push(`  ${bucket.padEnd(26)} ${report.totals[bucket]}`);
  }
  lines.push("");
  lines.push("NOT MEASURED BY THIS TOOL, and it is a property of the store rather than a choice:");
  lines.push("  ACTIONABLE vs HISTORICAL. eos_commercial holds no lifecycle state (migration");
  lines.push("  1758844800000's own header says so), and #186 s7/s8 make that distinction decisive.");
  lines.push("  It is measured where the lifecycle lives, by responsibility/accountabilityCensus.ts.");
  lines.push("  governedException is 0 because NOTHING IN EOS WRITES ONE -- #180 permits an explicit");
  lines.push("  Owner-approved exception and no mechanism to record one has been authorized.");
  if (report.unmeasured > 0) {
    lines.push("");
    lines.push(`${report.unmeasured} of ${ACCOUNTABILITY_TABLES.length} families COULD NOT BE MEASURED.`);
    lines.push("  This report is NOT a clean bill of health and must not be read as one.");
  }
  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // THE FENCE FIRST, before any client exists. Shared with measureEmployeeReferenceIntegrity.js.
  const { environmentId, connectionString } = assertMeasurementTarget(args, process.env);
  const policy = assertEligibilityPolicy(args);

  // AFTER the fence, never at module scope.
  const pg = require("pg");
  const client = new pg.Client({ connectionString });
  await client.connect();
  let report;
  try {
    // The DATABASE refuses a write, not merely this file. A future edit that added an UPDATE would
    // fail at runtime rather than succeed quietly.
    await client.query("BEGIN");
    await client.query("SET TRANSACTION READ ONLY");
    report = await measureCommercialAccountability(client, policy);
    await client.query("COMMIT");
  } finally {
    await client.end();
  }

  // eslint-disable-next-line no-console
  console.log(describeReport(report, environmentId));

  // CLEAN means: every family measured, and no row in a state that cannot satisfy current
  // responsibility integrity. A row with a valid, currently-eligible accountable person is clean;
  // everything else is work. `presentValidNotEligible` is INCLUDED as work, per #189 MI-epsilon's
  // "the actionable record may become RESPONSIBILITY DEFECT" -- while remaining a valid reference.
  const outstanding =
    report.totals.presentValidNotEligible +
    report.totals.presentInvalid +
    report.totals.presentCrossTenant +
    report.totals.missingOwnerDerivable +
    report.totals.missingOwnerInvalid +
    report.totals.missingOwnerNotEligible;
  process.exitCode = report.unmeasured === 0 && outstanding === 0 ? 0 : 1;
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err instanceof Error ? err.message : err);
    // 2, not 1: a fence refusal or an unreachable database is a FAILURE TO MEASURE and must never be
    // mistaken for the measurement having found nothing.
    process.exitCode = 2;
  });
}

module.exports = {
  assertEligibilityPolicy,
  measureCommercialAccountability,
  describeReport,
  ACCOUNTABILITY_TABLES,
  CLASSIFICATION_BUCKETS,
  EMPLOYEE_AUTHORITY,
  EMPLOYMENT_STATUS_VALUES,
};
