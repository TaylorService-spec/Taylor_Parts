// SYNTHETIC TAYLOR ACCEPTANCE WAREHOUSE -- the operator run of functions/src/eosOps/syntheticAcceptanceWarehouse.ts
// (Controller ruling 2026-09-30, Option 2(a)). ONE pinned, unmistakably synthetic nonprod warehouse under the bound
// operating company key `taylor`, for the synthetic Reorder lifecycle proof. Not Taylor master data; not a
// warehouse-copy operator; not wh-main / wh-north / SC-WH-MAIN / SC-WH-SERVICE.
//
// DRY RUN BY DEFAULT. `--apply` creates it through the governed writer (warehouseBinRepository.createWarehouse) with
// one audit event, in one transaction, after proving the id is unused and unreferenced and that `taylor` resolves to
// exactly one ACTIVE binding. Idempotent: a rerun is ALREADY_PRESENT and writes nothing.
//
// THE FENCE (before `pg` or lib/ loads; operatorScriptEnvironmentFence.test.mjs): a registry --environment that is not
// production by role or project id, a --databaseUrlEnv naming the variable that holds the connection string,
// EOS_ENVIRONMENT exactly `nonprod`, the frozen Certification world refused, --tenantKey exactly `taylor-nonprod`,
// --principalId required, --apply a bare flag.
//
// Usage (Render one-off job on eos-api-nonprod):
//   node scripts/syntheticAcceptanceWarehouseCli.js --environment platform-sandbox --databaseUrlEnv DATABASE_URL \
//     --tenantKey taylor-nonprod --principalId <EOS principal id> [--apply]
//
// Exit: 0 dry run / created / already present; 2 refused or failed. Output: one JSON document; no connection string.
"use strict";

const { assertMeasurementTarget, parseArgs } = require("./measureEmployeeReferenceIntegrity.js");
const { assertNonprodRuntime } = require("./measureWorkforceActivation.js");

const FROZEN_ENVIRONMENTS = Object.freeze(["platform-certification"]);
const ACCEPTANCE_TENANT_KEY = "taylor-nonprod";

function assertSyntheticWarehouseInvocation(args, env) {
  const { environmentId, connectionString } = assertMeasurementTarget(args, env);
  assertNonprodRuntime(env);
  if (FROZEN_ENVIRONMENTS.includes(environmentId)) {
    throw new Error(`--environment '${environmentId}' is the Certification world, which is frozen.`);
  }
  if (args.tenantKey !== ACCEPTANCE_TENANT_KEY) {
    throw new Error(`--tenantKey must be exactly '${ACCEPTANCE_TENANT_KEY}': the synthetic acceptance warehouse exists only in the nonprod Taylor tenant.`);
  }
  if (!args.principalId || args.principalId === "true") throw new Error("--principalId <EOS principal id> is required: the warehouse is created as an EOS Principal.");
  if (args.apply !== undefined && args.apply !== true && args.apply !== "true") throw new Error("--apply is a bare flag.");
  return { environmentId, connectionString, tenantKey: args.tenantKey, principalId: args.principalId, apply: args.apply !== undefined };
}

async function main(argv, env) {
  const options = assertSyntheticWarehouseInvocation(parseArgs(argv), env);
  const pg = require("pg");
  const { resolvePolicyDatabaseConfig } = require("../lib/adminPolicy/policyDatabase.js");
  const { establishSyntheticAcceptanceWarehouse, SYNTHETIC_ACCEPTANCE_WAREHOUSE } = require("../lib/eosOps/syntheticAcceptanceWarehouse.js");
  const pool = new pg.Pool({ ...resolvePolicyDatabaseConfig({ connectionString: options.connectionString }), max: 2 });
  pool.on("error", () => undefined);
  try {
    const tenant = await pool.query("SELECT id FROM eos_policy.tenants WHERE key = $1", [options.tenantKey]);
    if (tenant.rows.length !== 1) throw new Error(`no tenant with key ${options.tenantKey}; this tool never creates one`);
    const result = await establishSyntheticAcceptanceWarehouse(pool, { tenantId: tenant.rows[0].id, actorPrincipalId: options.principalId, apply: options.apply });
    console.log(JSON.stringify({ environment: options.environmentId, tenantKey: options.tenantKey, apply: options.apply,
      warehouse: SYNTHETIC_ACCEPTANCE_WAREHOUSE, ...result }, null, 2));
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main(process.argv.slice(2), process.env).catch((err) => {
    const message = String(err && err.message ? err.message : err).replace(/postgres(ql)?:\/\/\S+/g, "<redacted>");
    console.error(JSON.stringify({ outcome: "REFUSED_OR_FAILED", code: err && err.code ? err.code : null, message }, null, 2));
    process.exit(2);
  });
}

module.exports = { assertSyntheticWarehouseInvocation };
