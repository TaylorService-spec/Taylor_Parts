// EMP-RT-08 LAUNCH JOB ROLE CATALOG -- the operator seed of the Owner-ruled launch Job Roles for the Taylor nonprod tenant.
//
// DRY RUN BY DEFAULT; `--apply` adds the missing launch catalog entries (functions/src/eosWorkforce/migration/
// jobRoleCatalogSeed.ts). Never renames, deactivates, deletes or reactivates an entry and never assigns a Job Role to
// an Employee. Idempotent.
//
// SCOPE (Owner ruling): the launch catalog is ruled for the TAYLOR NONPROD tenant only -- `--environment platform-sandbox`
// with `--tenantKey taylor-nonprod`. Any other environment or tenant refuses; no catalog is fabricated elsewhere.
//
// THE FENCE (before `pg` or lib/ loads): a registry --environment that is not production by role or project id, a
// --databaseUrlEnv, EOS_ENVIRONMENT exactly `nonprod`, the frozen Certification world refused, --performedBy required.
//
// Usage (Render Shell on eos-api-nonprod):
//   node scripts/jobRoleCatalogSeedCli.js --environment platform-sandbox --databaseUrlEnv DATABASE_URL \
//     --tenantKey taylor-nonprod --performedBy <operator> [--apply]
"use strict";

const { assertMeasurementTarget, parseArgs } = require("./measureEmployeeReferenceIntegrity.js");
const { assertNonprodRuntime } = require("./measureWorkforceActivation.js");

const RULED_SCOPE = Object.freeze({ environment: "platform-sandbox", tenantKey: "taylor-nonprod" });

function assertSeedInvocation(args, env) {
  const { environmentId, connectionString } = assertMeasurementTarget(args, env);
  assertNonprodRuntime(env);
  if (environmentId !== RULED_SCOPE.environment) {
    throw new Error(`--environment '${environmentId}' has no ruled launch Job Role catalog; only ${RULED_SCOPE.environment} does.`);
  }
  if (args.tenantKey !== RULED_SCOPE.tenantKey) {
    throw new Error(`--tenantKey must be ${RULED_SCOPE.tenantKey}: the launch Job Role catalog is ruled for that tenant only.`);
  }
  if (!args.performedBy || args.performedBy === "true" || !/^[A-Za-z0-9._@-]{1,100}$/.test(args.performedBy)) {
    throw new Error("--performedBy <operator> is required ([A-Za-z0-9._@-], at most 100).");
  }
  return { environmentId, connectionString, tenantKey: args.tenantKey, performedBy: args.performedBy, apply: args.apply === "true" };
}

async function main() {
  const options = assertSeedInvocation(parseArgs(process.argv.slice(2)), process.env);
  const pg = require("pg");
  const { resolvePolicyDatabaseConfig } = require("../lib/adminPolicy/policyDatabase.js");
  const { seedJobRoleCatalog } = require("../lib/eosWorkforce/migration/jobRoleCatalogSeed.js");
  const pool = new pg.Pool(resolvePolicyDatabaseConfig({ connectionString: options.connectionString }));
  try {
    const tenant = await pool.query("SELECT id FROM eos_policy.tenants WHERE key = $1", [options.tenantKey]);
    if (tenant.rows.length !== 1) throw new Error(`no tenant with key ${options.tenantKey}; the seed never creates one`);
    const report = await seedJobRoleCatalog(pool, { tenantId: tenant.rows[0].id, apply: options.apply, actor: `job-role-catalog-seed:${options.performedBy}` });
    console.log(JSON.stringify({ environment: options.environmentId, tenantKey: options.tenantKey, report }, null, 2));
    process.exitCode = 0;
  } finally {
    await pool.end();
  }
}

module.exports = { assertSeedInvocation, RULED_SCOPE };

if (require.main === module) {
  main().catch((err) => {
    const governed = !err || !err.code;
    console.error(JSON.stringify({ outcome: "REFUSED_OR_FAILED", message: governed ? (err instanceof Error ? err.message : String(err)) : "the run could not be completed" }, null, 2));
    process.exitCode = 2;
  });
}
