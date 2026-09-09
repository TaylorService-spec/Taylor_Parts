#!/usr/bin/env node
// Stand up a non-production EOS tenant, and optionally its first administrator.
//
// ════════════════════ AN OPERATOR RUNS THIS. NOTHING ELSE DOES. ════════════════════
//
// Creating the first administrator is creating authority out of nothing, which is exactly the shape
// of a backdoor. Every property that stops it being one lives in `bootstrapAdministrator`; this
// script's job is to make sure it is a DELIBERATE ACT: a person, at a terminal, naming the tenant
// and the subject, with a database URL they had to supply.
//
// It is not reachable from a browser, not exported from the API's operation list, and not called by
// any deploy, migration or first-login path.
//
//   node scripts/bootstrapEosTenant.mjs --key taylor-nonprod --name "Taylor Freezer of Arizona"
//   node scripts/bootstrapEosTenant.mjs --key taylor-nonprod --admin-subject <uid> --performed-by <you>
//
// Requires DATABASE_URL. Refuses to run when EOS_ENVIRONMENT names production.
import process from "node:process";
import pg from "pg";
import { PostgresPolicyRepository } from "../lib/adminPolicy/postgresPolicyRepository.js";
import { resolvePolicyDatabaseConfig, redactConnectionString } from "../lib/adminPolicy/policyDatabase.js";
import { bootstrapAdministrator, bootstrapTenant } from "../lib/adminPolicy/tenantBootstrap.js";

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

const args = parseArgs(process.argv.slice(2));

const environment = (process.env.EOS_ENVIRONMENT ?? "local").trim().toLowerCase();
if (environment === "production" || environment === "prod") {
  console.error("REFUSED: EOS_ENVIRONMENT names production. This tranche is non-production only.");
  process.exit(2);
}

const key = typeof args.key === "string" ? args.key : null;
if (!key) {
  console.error("usage: bootstrapEosTenant.mjs --key <tenant-key> [--name <display name>]");
  console.error("                              [--admin-subject <external subject> --performed-by <operator>]");
  console.error("                              [--admin-name <display name>] [--reason <why>]");
  process.exit(2);
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("REFUSED: DATABASE_URL is not set. No credential is guessed and none is committed.");
  process.exit(2);
}

const pool = new pg.Pool(resolvePolicyDatabaseConfig({ connectionString, max: 4 }));
const repo = new PostgresPolicyRepository(pool);
const operator = typeof args["performed-by"] === "string" ? args["performed-by"] : "operator";

try {
  console.log(`database : ${redactConnectionString(connectionString)}`);
  console.log(`environment: ${environment}`);

  const result = await bootstrapTenant(repo, {
    key,
    name: typeof args.name === "string" ? args.name : key,
    actorUid: operator,
  });

  console.log(`tenant   : ${result.tenant.id} (${result.tenant.key}) ${result.created ? "CREATED" : "already existed"}`);
  console.log(`seed     : v${result.seed.seedVersion} ${result.seed.alreadySeeded ? "already applied" : "applied"}`);
  console.log(
    `           objects=${result.seed.created.objects} fields=${result.seed.created.fields} ` +
    `roles=${result.seed.created.roles} objectPermissions=${result.seed.created.objectPermissions}`,
  );
  console.log(
    `           workflows=${result.seed.created.workflows} versions=${result.seed.created.workflowVersions} ` +
    `steps=${result.seed.created.workflowSteps} actions=${result.seed.created.workflowActions} ` +
    `bindings=${result.seed.created.workflowRoleBindings}`,
  );
  if (result.seed.missingRoleKeys.length > 0) {
    console.log(`           missing role keys: ${result.seed.missingRoleKeys.join(", ")}`);
  }

  const adminSubject = typeof args["admin-subject"] === "string" ? args["admin-subject"] : null;
  if (adminSubject) {
    const admin = await bootstrapAdministrator(repo, {
      tenantId: result.tenant.id,
      externalSubject: adminSubject,
      displayName: typeof args["admin-name"] === "string" ? args["admin-name"] : null,
      performedBy: operator,
      reason: typeof args.reason === "string" ? args.reason : null,
    });
    console.log(`admin    : principal ${admin.principal.id} holds the Admin Role (assignment ${admin.assignmentId})`);
    console.log(`           access version ${admin.accessVersion}, bootstrapped by ${admin.bootstrap.performedBy}`);
  } else {
    console.log("admin    : not bootstrapped (pass --admin-subject and --performed-by to create the first one)");
  }
} catch (err) {
  console.error(`FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
