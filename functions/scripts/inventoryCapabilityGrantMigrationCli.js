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

async function main() {
  const args = parseArgs(process.argv.slice(2));
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

module.exports = { parseArgs };
