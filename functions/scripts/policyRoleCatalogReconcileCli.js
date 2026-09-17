// POLICY ROLE CATALOG RECONCILE -- the operator run of role-key completeness for ONE existing tenant
// (functions/src/adminPolicy/seed/roleCatalogReconcile.ts).
//
// DRY RUN BY DEFAULT. `--apply` creates the declared catalog Roles the tenant lacks, with the baseline Object CRED the
// policy seed writes for a Role it creates, in one transaction with one audit event. It never alters or deletes an
// existing Role, never grants a capability, never creates an assignment, membership, Principal, Object, Field or
// tenant. Idempotent: a second apply adds zero and writes no audit event.
//
// THE FENCE (before `pg` or lib/ loads; operatorScriptEnvironmentFence.test.mjs): a registry --environment that is not
// production by role or project id, a --databaseUrlEnv naming the variable that holds the connection string,
// EOS_ENVIRONMENT exactly `nonprod`, the frozen Certification world refused, --tenantKey / --performedBy required, and
// --apply a bare flag. The tenant is resolved by key and never created. With --out the report is written exclusively
// (0600, never overwritten) with a <out>.sha256 sidecar.
//
// Usage (Render Shell on eos-api-nonprod):
//   node scripts/policyRoleCatalogReconcileCli.js --environment platform-sandbox --databaseUrlEnv DATABASE_URL \
//     --tenantKey taylor-nonprod --performedBy <operator> [--apply] [--out ./role-catalog-reconcile.json]
//
// Exit: 0 dry run / applied / nothing to reconcile; 1 REFUSED_SEED_OBJECTS_MISSING; 2 refused or failed.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { assertMeasurementTarget, parseArgs } = require("./measureEmployeeReferenceIntegrity.js");
const { assertNonprodRuntime } = require("./measureWorkforceActivation.js");

const FROZEN_ENVIRONMENTS = Object.freeze(["platform-certification"]);

function assertReconcileInvocation(args, env) {
  if (FROZEN_ENVIRONMENTS.includes(args.environment)) {
    throw new Error(`--environment '${args.environment}' is the Certification world, which is frozen.`);
  }
  const { environmentId, connectionString } = assertMeasurementTarget(args, env);
  assertNonprodRuntime(env);
  if (!args.tenantKey || args.tenantKey === "true") throw new Error("--tenantKey is required: the tenant is named, never inferred.");
  if (!args.performedBy || args.performedBy === "true" || !/^[A-Za-z0-9._@-]{1,100}$/.test(args.performedBy)) {
    throw new Error("--performedBy <operator> is required ([A-Za-z0-9._@-], at most 100).");
  }
  if (args.apply !== undefined && args.apply !== "true") throw new Error("--apply is a bare flag.");
  let out = null;
  if (args.out !== undefined) {
    if (args.out === "true") throw new Error("--out requires a file path.");
    out = path.resolve(args.out);
    if (fs.existsSync(out) || fs.existsSync(`${out}.sha256`)) throw new Error(`REFUSED: ${out} (or its .sha256) already exists; a report is never overwritten.`);
  }
  return { environmentId, connectionString, tenantKey: args.tenantKey, performedBy: args.performedBy, apply: args.apply === "true", out };
}

async function main() {
  const options = assertReconcileInvocation(parseArgs(process.argv.slice(2)), process.env);
  const pg = require("pg");
  const { resolvePolicyDatabaseConfig } = require("../lib/adminPolicy/policyDatabase.js");
  const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");
  const { reconcileTenantRoleCatalog } = require("../lib/adminPolicy/seed/roleCatalogReconcile.js");
  const pool = new pg.Pool(resolvePolicyDatabaseConfig({ connectionString: options.connectionString, max: 2 }));
  try {
    const report = await reconcileTenantRoleCatalog(new PostgresPolicyRepository(pool), options.tenantKey, {
      apply: options.apply, actorUid: `role-catalog-reconcile:${options.performedBy}`,
    });
    const document = { environment: options.environmentId, tenantKey: options.tenantKey, performedBy: options.performedBy, report };
    const text = JSON.stringify(document, null, 2) + "\n";
    if (options.out) {
      fs.writeFileSync(options.out, text, { encoding: "utf8", flag: "wx", mode: 0o600 });
      const sha256 = createHash("sha256").update(text).digest("hex");
      fs.writeFileSync(`${options.out}.sha256`, `${sha256}  ${path.basename(options.out)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    }
    process.stdout.write(text);
    process.exitCode = report.outcome === "REFUSED_SEED_OBJECTS_MISSING" ? 1 : 0;
  } finally {
    await pool.end();
  }
}

module.exports = { assertReconcileInvocation };

if (require.main === module) {
  main().catch((err) => {
    const governed = !err || !err.code;
    console.error(JSON.stringify({ outcome: "REFUSED_OR_FAILED", message: governed ? (err instanceof Error ? err.message : String(err)) : "the run could not be completed" }, null, 2));
    process.exitCode = 2;
  });
}
