// TENANT <-> OPERATING COMPANY -- the operator reconciliation that links a named tenant to the operating companies the
// named environment's GOVERNED EVIDENCE lists (EMP-RT-W2, Owner ruling option b).
//
// DRY RUN BY DEFAULT; `--apply` adds ACTIVE eos_policy.tenant_operating_companies rows for evidence companies the tenant
// lacks (functions/src/eosWorkforce/migration/tenantOperatingCompanies.ts). Never deletes, deactivates, reactivates or
// links anything the evidence does not name. Idempotent.
//
// EVIDENCE. Only environments with an Owner-ruled evidence file may be reconciled; every other environment refuses.
// The file must declare the SAME Firebase project the registry declares for the environment (a mislabelled file never
// applies to another world). Today: platform-sandbox -> config/ownership/operating-company-roots.sandbox.json (R-1).
//
// THE FENCE (before `pg` or lib/ loads): a registry --environment that is not production by role or project id, a
// --databaseUrlEnv, EOS_ENVIRONMENT exactly `nonprod`, the frozen Certification world refused, --tenantKey and
// --performedBy required. The tenant is resolved by key and never created.
//
// Usage (Render Shell on eos-api-nonprod):
//   node scripts/tenantOperatingCompanyReconcileCli.js --environment platform-sandbox --databaseUrlEnv DATABASE_URL \
//     --tenantKey taylor-nonprod --performedBy <operator> [--apply]
"use strict";

const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { assertMeasurementTarget, parseArgs } = require("./measureEmployeeReferenceIntegrity.js");
const { assertNonprodRuntime } = require("./measureWorkforceActivation.js");

const REPO_ROOT = join(__dirname, "..", "..");
const FROZEN_ENVIRONMENTS = Object.freeze(["platform-certification"]);
const GOVERNED_EVIDENCE = Object.freeze({
  "platform-sandbox": "config/ownership/operating-company-roots.sandbox.json",
});

function loadEvidence(environmentId, repoRoot = REPO_ROOT) {
  const file = GOVERNED_EVIDENCE[environmentId];
  if (!file) throw new Error(`--environment '${environmentId}' has no governed operating-company evidence; no link is fabricated.`);
  const registry = JSON.parse(readFileSync(join(repoRoot, "config", "environments.json"), "utf8"));
  const envs = registry.environments ?? registry;
  const entry = Array.isArray(envs) ? envs.find((e) => e.id === environmentId) : envs[environmentId];
  const projectId = entry?.firebase?.projectId;
  const evidence = JSON.parse(readFileSync(join(repoRoot, file), "utf8"));
  if (!projectId || evidence.environment !== projectId) {
    throw new Error(`the evidence file ${file} names '${evidence.environment}', not the environment's project '${projectId}'.`);
  }
  const ids = evidence.governedCompanyIds;
  if (!Array.isArray(ids) || ids.length === 0) throw new Error(`the evidence file ${file} declares no governedCompanyIds.`);
  return { file, companyIds: ids };
}

function assertReconcileInvocation(args, env) {
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
  const options = assertReconcileInvocation(parseArgs(process.argv.slice(2)), process.env);
  const evidence = loadEvidence(options.environmentId);
  const pg = require("pg");
  const { resolvePolicyDatabaseConfig } = require("../lib/adminPolicy/policyDatabase.js");
  const { reconcileTenantOperatingCompanies } = require("../lib/eosWorkforce/migration/tenantOperatingCompanies.js");
  const pool = new pg.Pool(resolvePolicyDatabaseConfig({ connectionString: options.connectionString }));
  try {
    const tenant = await pool.query("SELECT id FROM eos_policy.tenants WHERE key = $1", [options.tenantKey]);
    if (tenant.rows.length !== 1) throw new Error(`no tenant with key ${options.tenantKey}; the reconciliation never creates one`);
    const report = await reconcileTenantOperatingCompanies(pool, {
      tenantId: tenant.rows[0].id, companyIds: evidence.companyIds, apply: options.apply,
      source: `governed-evidence:${evidence.file}`, actor: `tenant-operating-companies:${options.performedBy}`,
    });
    console.log(JSON.stringify({ environment: options.environmentId, tenantKey: options.tenantKey, evidence: evidence.file, report }, null, 2));
    process.exitCode = 0;
  } finally {
    await pool.end();
  }
}

module.exports = { assertReconcileInvocation, loadEvidence, GOVERNED_EVIDENCE };

if (require.main === module) {
  main().catch((err) => {
    const governed = !err || !err.code;
    console.error(JSON.stringify({ outcome: "REFUSED_OR_FAILED", message: governed ? (err instanceof Error ? err.message : String(err)) : "the run could not be completed" }, null, 2));
    process.exitCode = 2;
  });
}
