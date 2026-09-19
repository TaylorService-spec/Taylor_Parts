// Steps D/E: the operator's LEGACY WORK ELIGIBILITY / OPERATIONAL SCOPE evidence census and dry-run migration plan.
//
// READ ONLY. There is deliberately NO `--apply` flag: this lane produces evidence, never a mutation. The plan it
// prints names the governed step C commands a person may then issue, each of which re-checks its own capability
// (admin.employeeWorkEligibility.write / admin.employeeOperationalScope.write). Adding an apply path here would put
// a migration outside the governed command layer, which is the thing the decomposition exists to prevent.
//
// INPUT: the one-time Firestore Employee export (EOS_EMPLOYEE_PROFILE_SNAPSHOT, produced by
// scripts/exportEmployeeProfileSnapshot.js) named with --snapshot, plus the governed PostgreSQL database for
// resolution. The snapshot is READ FROM DISK; nothing here talks to Firebase.
//
// THE FENCE (before `pg` or lib/ loads): a registry --environment that is not production by role or project id, a
// --databaseUrlEnv, EOS_ENVIRONMENT exactly `nonprod`, the frozen Certification world refused. `--performedBy` is
// NOT required and no actor is recorded, because nothing is written and there is no action to attribute.
//
// Usage (Render Shell on eos-api-nonprod):
//   node scripts/legacyWorkforceEvidenceCli.js --environment platform-sandbox --databaseUrlEnv DATABASE_URL \
//     --tenantKey taylor-nonprod --snapshot ./employee-snapshot.json [--findings]
//
// By default it prints counts, the remediation set and the plan. `--findings` adds every individual finding, which is
// large; the counts are what a reviewer reads first.
"use strict";

const { assertMeasurementTarget, parseArgs } = require("./measureEmployeeReferenceIntegrity.js");
const { assertNonprodRuntime } = require("./measureWorkforceActivation.js");

function assertCensusInvocation(args, env) {
  const { environmentId, connectionString } = assertMeasurementTarget(args, env);
  assertNonprodRuntime(env);
  if (!args.tenantKey || args.tenantKey === "true" || !/^[a-z][a-z0-9-]{1,62}$/.test(args.tenantKey)) {
    throw new Error("--tenantKey <key> is required: the census is read for exactly one tenant.");
  }
  if (!args.snapshot || args.snapshot === "true") {
    throw new Error("--snapshot <path> is required: the legacy evidence comes from the one-time Firestore export.");
  }
  // A typo that reads as an instruction to write must not be silently ignored.
  if (args.apply !== undefined) {
    throw new Error("--apply is not a flag of this command: the evidence lane never mutates. Issue the governed step C commands instead.");
  }
  return { environmentId, connectionString, tenantKey: args.tenantKey, snapshot: args.snapshot, findings: args.findings === "true" };
}

async function main() {
  const options = assertCensusInvocation(parseArgs(process.argv.slice(2)), process.env);
  const { readFileSync } = require("node:fs");
  const pg = require("pg");
  const { resolvePolicyDatabaseConfig } = require("../lib/adminPolicy/policyDatabase.js");
  const { parseEmployeeProfileSnapshot } = require("../lib/eosWorkforce/migration/employeeProfileSnapshot.js");
  const { reportLegacyWorkforceEvidence } = require("../lib/eosWorkforce/migration/legacyWorkforceEvidenceReport.js");

  const snapshot = parseEmployeeProfileSnapshot(JSON.parse(readFileSync(options.snapshot, "utf8")));
  const pool = new pg.Pool(resolvePolicyDatabaseConfig({ connectionString: options.connectionString }));
  try {
    const tenant = await pool.query("SELECT id FROM eos_policy.tenants WHERE key = $1", [options.tenantKey]);
    if (tenant.rows.length !== 1) throw new Error(`no tenant with key ${options.tenantKey}; the census never creates one`);
    const census = await reportLegacyWorkforceEvidence(pool, { tenantId: tenant.rows[0].id, snapshot });
    const { qualificationFindings, scopeFindings, ...summary } = census;
    console.log(JSON.stringify({
      environment: options.environmentId,
      tenantKey: options.tenantKey,
      census: options.findings ? census : summary,
    }, null, 2));
    process.exitCode = 0;
  } finally {
    await pool.end();
  }
}

module.exports = { assertCensusInvocation };

if (require.main === module) {
  main().catch((err) => {
    const governed = !err || !err.code;
    console.error(JSON.stringify({ outcome: "REFUSED_OR_FAILED", message: governed ? (err instanceof Error ? err.message : String(err)) : "the run could not be completed" }, null, 2));
    process.exitCode = 2;
  });
}
