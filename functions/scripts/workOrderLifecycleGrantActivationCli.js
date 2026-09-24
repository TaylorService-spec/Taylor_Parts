#!/usr/bin/env node
// Activate the five authorized Work Order lifecycle capability grants -- Owner ruling B, NONPROD.
//
// ════════════════════ AN OPERATOR RUNS THIS. NOTHING ELSE DOES. ════════════════════
//
// DRY RUN BY DEFAULT. Without --apply it reports what an apply run would write and touches nothing.
// It refuses outright when EOS_ENVIRONMENT names production: the ruling says "Production remains
// untouched", and a flag the operator forgot must not be the only thing standing between them and it.
//
//   node scripts/workOrderLifecycleGrantActivationCli.js --tenant <id> --actor <principal-id>
//   node scripts/workOrderLifecycleGrantActivationCli.js --tenant <id> --actor <principal-id> --apply
//
// The actor must hold the `admin` Role in that tenant: "what a Role may do" is ADMIN-ONLY authority
// (adminPolicy/administrationAuthority.ts), and this script asserts nothing on the actor's behalf --
// `grantObjectActionToRole` re-checks it and would refuse.
//
// Requires DATABASE_URL, which is never printed; only its redacted form is.
"use strict";

const pg = require("pg");
const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository");
const { resolvePolicyDatabaseConfig, redactConnectionString } = require("../lib/adminPolicy/policyDatabase");
const {
  activateWorkOrderLifecycleGrants,
  describeActivationReport,
  WORK_ORDER_LIFECYCLE_ACTIVATION_GRANTS,
} = require("../lib/adminPolicy/workOrderLifecycleGrantActivation");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const name = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) { args[name] = true; continue; }
    args[name] = next;
    i += 1;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const environment = String(process.env.EOS_ENVIRONMENT ?? "local").trim().toLowerCase();
  if (environment === "production" || environment === "prod") {
    console.error("REFUSED: EOS_ENVIRONMENT names production. This activation is NONPROD-only by ruling.");
    process.exit(2);
  }

  const tenantId = typeof args.tenant === "string" ? args.tenant : null;
  const actorUid = typeof args.actor === "string" ? args.actor : null;
  if (!tenantId || !actorUid) {
    console.error("usage: workOrderLifecycleGrantActivationCli.js --tenant <tenantId> --actor <principalId> [--apply] [--reason <why>]");
    process.exit(2);
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("REFUSED: DATABASE_URL is not set. No credential is guessed and none is committed.");
    process.exit(2);
  }

  const pool = new pg.Pool(resolvePolicyDatabaseConfig({ connectionString, max: 4 }));
  const repo = new PostgresPolicyRepository(pool);

  try {
    console.log(`database   : ${redactConnectionString(connectionString)}`);
    console.log(`environment: ${environment}`);
    console.log(`authorized : ${WORK_ORDER_LIFECYCLE_ACTIVATION_GRANTS.length} grants (Owner ruling B)`);

    // THE ACTOR'S ROLES ARE READ, NEVER STATED. A --roles flag would let the operator assert the very
    // authority the command is about to check, which is not an authority check at all.
    const assignments = await repo.listAssignmentsForPrincipal(tenantId, actorUid);
    const roles = await repo.listRoles(tenantId);
    const roleKeyById = new Map(roles.map((r) => [r.id, r.key]));
    const heldRoleKeys = assignments
      .filter((a) => a.status === "active")
      .map((a) => roleKeyById.get(a.roleId))
      .filter((k) => typeof k === "string");
    console.log(`actor      : ${actorUid} holding [${heldRoleKeys.join(", ")}]`);

    const report = await activateWorkOrderLifecycleGrants(
      repo,
      { tenantId, uid: actorUid, heldRoleKeys },
      {
        apply: args.apply === true,
        reason: typeof args.reason === "string"
          ? args.reason
          : "Owner ruling B -- NONPROD Work Order lifecycle activation",
      },
    );
    console.log(describeActivationReport(report));
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(`FAILED: ${err && err.message ? err.message : String(err)}`);
  process.exit(1);
});
