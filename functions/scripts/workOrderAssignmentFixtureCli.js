#!/usr/bin/env node
// Create ONE governed Work Order assignment in a non-production tenant.
//
// ════════════════════ WHY THIS EXISTS AT ALL ════════════════════
//
// `assignWorkOrderToEmployee` is the governed writer, and until now nothing outside a test called it:
// there is no transport, so a nonprod assignment had no way to be made except by hand-written SQL --
// which would have skipped the capability check, the tenant-membership check, the assignable-status
// precondition, the SERVICE_TECHNICIAN eligibility check and the interval discipline, all at once.
// This script is the operator's door to the SAME command, and it adds nothing to it.
//
// THE ACTOR'S CAPABILITIES ARE RESOLVED, NEVER STATED. They come from
// `resolveOperationalContext` -- EOS Principal -> ACTIVE tenant membership -> qualifying Roles ->
// eos_policy.role_capabilities -- exactly the path a Render request takes. A --capabilities flag
// would let the operator hand themselves the authority the command is about to check.
//
// DRY RUN BY DEFAULT. Refuses when EOS_ENVIRONMENT names production. Requires DATABASE_URL, which is
// never printed; only its redacted form is.
//
//   node scripts/workOrderAssignmentFixtureCli.js --subject <external subject> \
//        --work-order <id> --employee <employee id> [--source SCHEDULE] [--reason <why>] [--apply]
"use strict";

const pg = require("pg");
const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository");
const { resolvePolicyDatabaseConfig, redactConnectionString } = require("../lib/adminPolicy/policyDatabase");
const { resolveOperationalContext } = require("../lib/eosOps/capabilityAuthority");
const { assignWorkOrderToEmployee, WORK_ORDER_ASSIGN } = require("../lib/eosOps/workOrderAssignmentAuthority");

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
    console.error("REFUSED: EOS_ENVIRONMENT names production. This fixture is NONPROD-only.");
    process.exit(2);
  }

  const subject = typeof args.subject === "string" ? args.subject : null;
  const workOrderId = typeof args["work-order"] === "string" ? args["work-order"] : null;
  const employeeId = typeof args.employee === "string" ? args.employee : null;
  if (!subject || !workOrderId || !employeeId) {
    console.error("usage: workOrderAssignmentFixtureCli.js --subject <externalSubject> --work-order <id> --employee <id>");
    console.error("                                        [--source SCHEDULE|DISPATCH_REASSIGN|RESCHEDULE|REASSIGN_SCHEDULED]");
    console.error("                                        [--reason <why>] [--apply]");
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

    const resolved = await resolveOperationalContext(repo, pool, { externalSubject: subject });
    const actor = {
      tenantId: resolved.principalContext.tenantId,
      principalId: resolved.principalContext.uid,
      capabilities: resolved.capabilities,
    };
    console.log(`actor      : ${actor.principalId} in ${actor.tenantId}`);
    console.log(`roles      : [${resolved.principalContext.heldRoleKeys.join(", ")}]`);
    console.log(`${WORK_ORDER_ASSIGN}: ${resolved.capabilities.has(WORK_ORDER_ASSIGN) ? "HELD" : "NOT HELD"}`);

    if (args.apply !== true) {
      console.log("DRY RUN -- nothing written. Re-run with --apply to create the assignment.");
      return;
    }

    const source = typeof args.source === "string" ? args.source : "SCHEDULE";
    const input = { workOrderId, employeeId, source };
    if (typeof args.reason === "string") input.reason = args.reason;

    const result = await assignWorkOrderToEmployee({ pool }, actor, input);
    console.log(`outcome    : ${result.outcome}`);
    console.log(`assignment : ${result.assignmentId}`);
    console.log(`assignee   : ${result.assigneeEmployeeId}`);
    console.log(`ended      : ${result.endedAssignmentId ?? "(none -- this Work Order had no open assignment)"}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(`FAILED: ${err && err.code ? `${err.code} ` : ""}${err && err.message ? err.message : String(err)}`);
  process.exit(1);
});
