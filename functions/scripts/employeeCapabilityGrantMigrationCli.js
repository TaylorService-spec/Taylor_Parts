// EMPLOYEE CAPABILITY GRANTS -- the operator run of the existing Role-catalog grant reconciliation for the Employee keys
// (employee.record.read, admin.principalAccess.read, admin.employeeProfile.write).
//
// DRY RUN BY DEFAULT; `--apply` writes eos_policy.role_capabilities rows for what the Role catalog declares and nothing
// else (functions/src/eosWorkforce/migration/employeeCapabilityGrants.ts). Idempotent: a second apply adds zero.
//
// THE FENCE (before `pg` or lib/ loads; operatorScriptEnvironmentFence.test.mjs): a registry --environment that is not
// production by role or project id, a --databaseUrlEnv, EOS_ENVIRONMENT exactly `nonprod`, the frozen Certification
// world refused, and --tenantKey / --performedBy required. The tenant is resolved by key and never created.
//
// Usage (Render Shell on eos-api-nonprod):
//   node scripts/employeeCapabilityGrantMigrationCli.js --environment platform-sandbox --databaseUrlEnv DATABASE_URL \
//     --tenantKey taylor-nonprod --performedBy <operator> [--apply]
"use strict";

const { assertMeasurementTarget, parseArgs } = require("./measureEmployeeReferenceIntegrity.js");
const { assertNonprodRuntime } = require("./measureWorkforceActivation.js");

const FROZEN_ENVIRONMENTS = Object.freeze(["platform-certification"]);

function assertGrantInvocation(args, env) {
  const { environmentId, connectionString } = assertMeasurementTarget(args, env);
  assertNonprodRuntime(env);
  if (FROZEN_ENVIRONMENTS.includes(environmentId)) throw new Error(`--environment '${environmentId}' is the Certification world, which is frozen.`);
  if (!args.tenantKey || args.tenantKey === "true") throw new Error("--tenantKey is required: the tenant is named, never inferred.");
  if (!args.performedBy || args.performedBy === "true" || !/^[A-Za-z0-9._@-]{1,100}$/.test(args.performedBy)) {
    throw new Error("--performedBy <operator> is required ([A-Za-z0-9._@-], at most 100).");
  }
  return { environmentId, connectionString, tenantKey: args.tenantKey, performedBy: args.performedBy, apply: args.apply === "true" };
}

async function main() {
  const options = assertGrantInvocation(parseArgs(process.argv.slice(2)), process.env);
  const pg = require("pg");
  const { resolvePolicyDatabaseConfig } = require("../lib/adminPolicy/policyDatabase.js");
  const { reconcileEmployeeCapabilityGrants } = require("../lib/eosWorkforce/migration/employeeCapabilityGrants.js");
  const pool = new pg.Pool(resolvePolicyDatabaseConfig({ connectionString: options.connectionString }));
  try {
    const tenant = await pool.query("SELECT id FROM eos_policy.tenants WHERE key = $1", [options.tenantKey]);
    if (tenant.rows.length !== 1) throw new Error(`no tenant with key ${options.tenantKey}; the grant run never creates one`);
    const report = await reconcileEmployeeCapabilityGrants(pool, {
      tenantId: tenant.rows[0].id, apply: options.apply, actor: `employee-capability-grants:${options.performedBy}`,
    });
    console.log(JSON.stringify({ environment: options.environmentId, tenantKey: options.tenantKey, report }, null, 2));
    process.exitCode = report.unresolved.length > 0 ? 1 : 0;
  } finally {
    await pool.end();
  }
}

module.exports = { assertGrantInvocation };

if (require.main === module) {
  main().catch((err) => {
    const governed = !err || !err.code;
    console.error(JSON.stringify({ outcome: "REFUSED_OR_FAILED", message: governed ? (err instanceof Error ? err.message : String(err)) : "the run could not be completed" }, null, 2));
    process.exitCode = 2;
  });
}
