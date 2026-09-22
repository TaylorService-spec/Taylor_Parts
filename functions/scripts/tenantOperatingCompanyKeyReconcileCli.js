// TENANT OPERATING COMPANY -> eos_ops KEY -- the operator reconciliation that binds a tenant's AUTHORIZED
// operating company to the OPAQUE PARTITION KEY its eos_ops rows carry.
//
// DRY RUN BY DEFAULT; `--apply` adds ACTIVE eos_policy.tenant_operating_company_keys rows for bindings the
// named environment's GOVERNED EVIDENCE declares and the tenant does not yet have. It never deletes, never
// overwrites, never rebinds and never reactivates.
//
// ════════════════════ THERE IS NO --key ARGUMENT, DELIBERATELY ════════════════════
//
// The key is EVIDENCE, not an operator guess. It comes from
// config/ownership/operating-company-keys.sandbox.json and nowhere else, so a reconciliation run cannot
// introduce a partition key from a command line. An eos_ops partition key typed by hand at the wrong
// moment makes every operational row written under it unreachable from the company that owns it --
// silently, because the column is opaque TEXT and accepts anything.
//
// THE FENCE (before `pg` or lib/ loads), mirroring tenantOperatingCompanyReconcileCli.js exactly: a
// registry --environment that is not production by role or project id, a --databaseUrlEnv, EOS_ENVIRONMENT
// exactly `nonprod`, the frozen Certification world refused, --tenantKey and --performedBy required. The
// tenant is resolved by key and never created.
//
// Usage (Render Shell on eos-api-nonprod):
//   node scripts/tenantOperatingCompanyKeyReconcileCli.js --environment platform-sandbox \
//     --databaseUrlEnv DATABASE_URL --tenantKey taylor-nonprod --performedBy <operator> [--apply]
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { assertMeasurementTarget, parseArgs } = require("./measureEmployeeReferenceIntegrity.js");
const { assertNonprodRuntime } = require("./measureWorkforceActivation.js");

const REPO_ROOT = join(__dirname, "..", "..");
const FROZEN_ENVIRONMENTS = Object.freeze(["platform-certification"]);
const GOVERNED_EVIDENCE = Object.freeze({
  "platform-sandbox": "config/ownership/operating-company-keys.sandbox.json",
});

function loadKeyEvidence(environmentId, repoRoot = REPO_ROOT) {
  const file = GOVERNED_EVIDENCE[environmentId];
  if (!file) throw new Error(`--environment '${environmentId}' has no governed operating-company KEY evidence; no binding is fabricated.`);
  const registry = JSON.parse(readFileSync(join(repoRoot, "config", "environments.json"), "utf8"));
  const envs = registry.environments ?? registry;
  const entry = Array.isArray(envs) ? envs.find((e) => e.id === environmentId) : envs[environmentId];
  const projectId = entry?.firebase?.projectId;
  const evidence = JSON.parse(readFileSync(join(repoRoot, file), "utf8"));
  // A mislabelled evidence file must never reconcile the wrong environment.
  if (!projectId || evidence.environment !== projectId) {
    throw new Error(`the evidence file ${file} names '${evidence.environment}', not the environment's project '${projectId}'.`);
  }
  const bindings = evidence.bindings;
  if (!Array.isArray(bindings) || bindings.length === 0) throw new Error(`the evidence file ${file} declares no bindings.`);
  return { file, bindings };
}

function assertReconcileInvocation(args, env) {
  const { environmentId, connectionString } = assertMeasurementTarget(args, env);
  assertNonprodRuntime(env);
  if (FROZEN_ENVIRONMENTS.includes(environmentId)) throw new Error(`--environment '${environmentId}' is the Certification world, which is frozen.`);
  if (!args.tenantKey || args.tenantKey === "true") throw new Error("--tenantKey is required: the tenant is named, never inferred.");
  if (!args.performedBy || args.performedBy === "true" || !/^[A-Za-z0-9._@-]{1,100}$/.test(args.performedBy)) {
    throw new Error("--performedBy <operator> is required ([A-Za-z0-9._@-], at most 100).");
  }
  // The key is evidence. Refusing the argument outright is louder than ignoring it.
  for (const forbidden of ["key", "operatingCompanyKey", "companyKey"]) {
    if (args[forbidden] !== undefined) {
      throw new Error(`--${forbidden} is not accepted: the operating company key is governed evidence, not an operator choice.`);
    }
  }
  return { environmentId, connectionString, tenantKey: args.tenantKey, performedBy: args.performedBy, apply: args.apply === "true" };
}

async function main() {
  const options = assertReconcileInvocation(parseArgs(process.argv.slice(2)), process.env);
  const evidence = loadKeyEvidence(options.environmentId);
  const pg = require("pg");
  const { resolvePolicyDatabaseConfig } = require("../lib/adminPolicy/policyDatabase.js");
  const { reconcileTenantOperatingCompanyKeys } = require("../lib/eosWorkforce/migration/tenantOperatingCompanyKeys.js");
  const pool = new pg.Pool(resolvePolicyDatabaseConfig({ connectionString: options.connectionString }));
  try {
    const tenant = await pool.query("SELECT id FROM eos_policy.tenants WHERE key = $1", [options.tenantKey]);
    if (tenant.rows.length !== 1) throw new Error(`no tenant with key ${options.tenantKey}; the reconciliation never creates one`);
    const report = await reconcileTenantOperatingCompanyKeys(pool, {
      tenantId: tenant.rows[0].id, bindings: evidence.bindings, apply: options.apply,
      source: `governed-evidence:${evidence.file}`, actor: `tenant-operating-company-keys:${options.performedBy}`,
    });
    console.log(JSON.stringify({ environment: options.environmentId, tenantKey: options.tenantKey, evidence: evidence.file, report }, null, 2));
    process.exitCode = 0;
  } finally {
    await pool.end();
  }
}

module.exports = { assertReconcileInvocation, loadKeyEvidence, GOVERNED_EVIDENCE };

if (require.main === module) {
  main().catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
}
