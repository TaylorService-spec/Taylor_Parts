#!/usr/bin/env node
// READ-ONLY. Ask the live authorization path what one Principal may do to one Work Order edge.
//
// ════════════════════ WHY A PROBE AND NOT JUST A TEST ════════════════════
//
// The test suite proves the RULES. This proves the DEPLOYED CONFIGURATION: that the five activated
// grant rows, the real Role assignments, the real employee_principal_links and the real assignment
// interval in a given environment compose into the decision the ruling describes. A rule that is
// right and a tenant that is misconfigured look identical until something asks the database.
//
// It writes NOTHING. No transition is performed, no row is touched; `authorizeLifecycleEdge` is the
// decision function and it has no write path.
//
// THE COUNTING READER IS THE POINT. Every reader call is counted, so the output states -- as a
// measurement, not a claim -- how many record reads each decision cost. An unauthorized caller must
// show ZERO: "that Work Order is not yours" told to somebody with no Work Order authority discloses
// that the record exists, that they guessed a real id, and that it belongs to somebody.
//
//   node scripts/workOrderLifecycleAuthorizationProbeCli.js --subject <externalSubject> \
//        --work-order <id> [--from WORK_IN_PROGRESS] [--to COMPLETED]
"use strict";

const pg = require("pg");
const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository");
const { resolvePolicyDatabaseConfig, redactConnectionString } = require("../lib/adminPolicy/policyDatabase");
const { resolveOperationalContext } = require("../lib/eosOps/capabilityAuthority");
const { postgresContextualReader } = require("../lib/eosOps/contextualAuthorization");
const {
  authorizeLifecycleEdge, lifecycleContextPredicates, transitionRuleFor,
} = require("../lib/eosOps/workOrderLifecycle");

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

/** Wraps the governed reader and counts every call. Adds no behaviour of its own. */
function countingReader(inner) {
  const counts = { linkedEmployeeId: 0, hasWorkEligibility: 0, hasOperationalScope: 0, isAssignedEmployee: 0 };
  const wrapped = {};
  for (const key of Object.keys(counts)) {
    wrapped[key] = (...a) => { counts[key] += 1; return inner[key](...a); };
  }
  return { reader: wrapped, counts };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const subject = typeof args.subject === "string" ? args.subject : null;
  const workOrderId = typeof args["work-order"] === "string" ? args["work-order"] : null;
  if (!subject || !workOrderId) {
    console.error("usage: workOrderLifecycleAuthorizationProbeCli.js --subject <externalSubject> --work-order <id>");
    console.error("                                                  [--from <status>] [--to <status>]");
    process.exit(2);
  }
  const expectedStatus = typeof args.from === "string" ? args.from : "WORK_IN_PROGRESS";
  const toStatus = typeof args.to === "string" ? args.to : "COMPLETED";

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("REFUSED: DATABASE_URL is not set. No credential is guessed and none is committed.");
    process.exit(2);
  }

  const pool = new pg.Pool(resolvePolicyDatabaseConfig({ connectionString, max: 4 }));
  const repo = new PostgresPolicyRepository(pool);

  try {
    console.log(`database   : ${redactConnectionString(connectionString)}`);
    const resolved = await resolveOperationalContext(repo, pool, { externalSubject: subject });
    const actor = {
      tenantId: resolved.principalContext.tenantId,
      principalId: resolved.principalContext.uid,
      capabilities: resolved.capabilities,
    };
    const edgeRule = transitionRuleFor(expectedStatus, toStatus);
    const predicates = lifecycleContextPredicates(edgeRule.capability);

    console.log(`principal  : ${actor.principalId}`);
    console.log(`roles      : [${resolved.principalContext.heldRoleKeys.join(", ")}]`);
    console.log(`edge       : ${expectedStatus} -> ${toStatus} (${edgeRule.action})`);
    console.log(`capability : ${edgeRule.capability} -- ${actor.capabilities.has(edgeRule.capability) ? "HELD" : "NOT HELD"}`);
    console.log(`predicates : ${predicates.length === 0 ? "(none)" : predicates.map((p) => p.kind).join(", ")}`);

    const { reader, counts } = countingReader(postgresContextualReader(pool));
    const decision = await authorizeLifecycleEdge(reader, actor, { workOrderId, expectedStatus, toStatus });

    console.log(`DECISION   : ${decision.allowed ? "ALLOWED" : "DENIED"} -- ${decision.reason}`);
    console.log(`refused by : ${decision.predicate ?? "(no predicate ran)"}`);
    console.log(`record reads: linkedEmployeeId=${counts.linkedEmployeeId} isAssignedEmployee=${counts.isAssignedEmployee}`
      + ` hasWorkEligibility=${counts.hasWorkEligibility} hasOperationalScope=${counts.hasOperationalScope}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(`FAILED: ${err && err.message ? err.message : String(err)}`);
  process.exit(1);
});
