"use strict";
// P1A-3 -- operator CLI for the inventory capability GRANT migration tool
// (functions/src/eosOps/migration/inventoryCapabilityGrantMigration.ts).
//
// NONPROD ONLY. DEFAULT = DRY RUN (no argument writes anything). Pass --apply to write.
// Reconciles the LEGACY role -> capability grant fact (a Role's declared `permissions` array, in
// compatibilityRoles.ts / governedBusinessRoles.ts -- code, never Firestore) into
// `eos_policy.role_capabilities`, for one tenant at a time.
//
// Usage:
//   node scripts/inventoryCapabilityGrantMigrationCli.js --tenant <id> --actor <uid> [--apply]
//   node scripts/inventoryCapabilityGrantMigrationCli.js --tenant <id> --actor <uid> --evidence-dir <dir>
//
// Requires `npm run build` first (reads compiled lib/) and a PostgreSQL connection through the
// standard policyDatabase config (POLICY_DATABASE_URL / equivalent). No Firestore involved.
const { writeFileSync, mkdirSync } = require("node:fs");
const { join } = require("node:path");

function parseArgs(argv) {
  const args = { apply: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--apply") args.apply = true;
    else if (a === "--tenant") args.tenantId = argv[++i];
    else if (a === "--actor") args.actor = argv[++i];
    else if (a === "--evidence-dir") args.evidenceDir = argv[++i];
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!args.tenantId) throw new Error("--tenant <id> is required");
  if (!args.actor) throw new Error("--actor <uid> is required (recorded as granted_by/created_by/updated_by)");
  return args;
}

/**
 * The production refusal this file's own banner already declares.
 *
 * P2-C1 correction. Every OTHER operator entry point that writes to `eos_policy` enforces
 * "NONPROD ONLY" in the process rather than in a convention somebody has to remember --
 * scripts/bootstrapEosTenant.mjs (EOS_ENVIRONMENT production check, same shape, same exit code 2)
 * and src/eosApi/server.ts (the service refuses to start). This CLI declared the same rule in
 * prose and enforced nothing: the ONLY writer of `eos_policy.role_capabilities` was the one
 * writer with no environment guard at all. The omission is an oversight, not a decision -- nothing
 * in the packet that introduced this file records a reason for it to be the exception.
 *
 * DEFENSE IN DEPTH, NOT A PROOF. This is a LABEL check, exactly as strong as its siblings and no
 * stronger: an unset EOS_ENVIRONMENT reads as "local", and the operator still chooses which
 * database `DATABASE_URL` names. It can only ever REFUSE a run; it can never widen one, grant a
 * capability, or reach a database it would not otherwise have reached.
 */
function refuseProductionEnvironment() {
  const environment = (process.env.EOS_ENVIRONMENT ?? "local").trim().toLowerCase();
  if (environment === "production" || environment === "prod") {
    // eslint-disable-next-line no-console
    console.error("REFUSED: EOS_ENVIRONMENT names production. This migration tool is non-production only.");
    process.exit(2);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  refuseProductionEnvironment();
  const { getPolicyDatabasePool } = require("../lib/adminPolicy/policyDatabase.js");
  const { reconcileInventoryCapabilityGrants, describeReconcileReport } = require("../lib/eosOps/migration/inventoryCapabilityGrantMigration.js");

  const pool = getPolicyDatabasePool();
  const report = await reconcileInventoryCapabilityGrants(pool, {
    tenantId: args.tenantId,
    apply: args.apply,
    actor: args.actor,
  });

  // eslint-disable-next-line no-console
  console.log(describeReconcileReport(report));

  if (args.evidenceDir) {
    mkdirSync(args.evidenceDir, { recursive: true });
    const path = join(args.evidenceDir, `inventory-capability-grants-${args.tenantId}-${args.apply ? "apply" : "dryrun"}.json`);
    writeFileSync(path, JSON.stringify(report, null, 2) + "\n", "utf8");
    // eslint-disable-next-line no-console
    console.log(`evidence written: ${path}`);
  }

  process.exitCode = report.unresolved.length > 0 ? 1 : 0;
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, refuseProductionEnvironment };
