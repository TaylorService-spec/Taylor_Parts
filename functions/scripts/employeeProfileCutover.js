// THE GOVERNED EMPLOYEE PROFILE MIGRATION -- COPY ONCE, VERIFY, RECONCILE (Owner ruling F). No dual write, no sync.
//
//   --mode census   READ ONLY. Snapshot counts, invalid values, duplicate employee numbers, manager candidates,
//                   legacy account pointers (provenance only) and operationalRoles not migrated; plus the tenant's
//                   current Employee count. Writes nothing anywhere.
//   --mode copy     COPY ONCE into eos_workforce.employees profile columns and employee_reporting_relationships for ONE
//                   tenant, in ONE transaction. Refuses unless the census is copy-ready. Identical rerun: no change.
//                   Drift: REFUSED, nothing written, never overwritten.
//   --mode verify   READ ONLY. Field-by-field profile and current-manager reconciliation.
//
// THE SOURCE IS A FILE written by scripts/exportEmployeeProfileSnapshot.js. THIS TOOL LOADS NO FIREBASE MODULE and never
// touches Firestore. The snapshot must name the Firebase project the --environment declares, and never production.
//
// THE FENCE (before `pg` or lib/ loads; operatorScriptEnvironmentFence.test.mjs): a registry --environment that is not
// production by role or project id + --databaseUrlEnv (assertMeasurementTarget), EOS_ENVIRONMENT exactly `nonprod`
// (assertNonprodRuntime), the frozen Certification world refused, --mode / --tenantKey / --snapshot required, and
// --performedBy for copy. The tenant is resolved by --tenantKey and never created.
//
// Usage (Render Shell on eos-api-nonprod):
//   node scripts/employeeProfileCutover.js --mode census --environment platform-sandbox --databaseUrlEnv DATABASE_URL \
//     --tenantKey taylor-nonprod --snapshot ./employee-profile-snapshot.json
//   ... --mode copy ... --performedBy <operator>
//   ... --mode verify ...
//
// Exit: 0 census copy-ready / copy applied or no-op / verify reconciled; 1 not copy-ready / not reconciled; 2 refused.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { assertMeasurementTarget, parseArgs, PRODUCTION_PROJECT_ID } = require("./measureEmployeeReferenceIntegrity.js");
const { assertNonprodRuntime } = require("./measureWorkforceActivation.js");

const MODES = Object.freeze(["census", "copy", "verify"]);
const FROZEN_ENVIRONMENTS = Object.freeze(["platform-certification"]);

function assertProfileCutoverInvocation(args, env) {
  if (!MODES.includes(args.mode)) {
    throw new Error(`--mode must be one of ${MODES.join(" | ")} (got ${args.mode === undefined ? "nothing" : `'${args.mode}'`}).`);
  }
  const { environmentId, connectionString } = assertMeasurementTarget(args, env);
  assertNonprodRuntime(env);
  if (FROZEN_ENVIRONMENTS.includes(environmentId)) {
    throw new Error(`--environment '${environmentId}' is the Certification world, which is frozen. The profile migration neither reads nor writes it.`);
  }
  if (!args.tenantKey || args.tenantKey === "true") throw new Error("--tenantKey is required: the tenant is named, never inferred.");
  if (!args.snapshot || args.snapshot === "true") throw new Error("--snapshot <file> is required: the copy consumes an exported snapshot, never a live Firestore read.");
  if (args.mode === "copy" && (!args.performedBy || args.performedBy === "true")) throw new Error("--performedBy <operator> is required for copy.");
  return { mode: args.mode, environmentId, connectionString, tenantKey: args.tenantKey, snapshotPath: args.snapshot, performedBy: args.performedBy };
}

function declaredProjectId(environmentId) {
  const registry = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../config/environments.json"), "utf8"));
  const env = (registry.environments || []).find((e) => e && e.id === environmentId);
  return env && env.firebase ? env.firebase.projectId : null;
}

function assertSnapshotSource(snapshot, environmentId) {
  const projectId = snapshot.source.firebaseProjectId;
  if (projectId === PRODUCTION_PROJECT_ID) {
    throw new Error(`the snapshot was exported from the production project '${PRODUCTION_PROJECT_ID}'. Refused.`);
  }
  const declared = declaredProjectId(environmentId);
  if (declared === null || projectId !== declared) {
    throw new Error(`the snapshot names Firebase project '${projectId}', but --environment '${environmentId}' declares '${declared}'. Refused.`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const options = assertProfileCutoverInvocation(args, process.env);

  const raw = JSON.parse(fs.readFileSync(path.resolve(options.snapshotPath), "utf8"));
  const { parseEmployeeProfileSnapshot, censusEmployeeProfileSnapshot } = require("../lib/eosWorkforce/migration/employeeProfileSnapshot.js");
  const snapshot = parseEmployeeProfileSnapshot(raw);
  assertSnapshotSource(snapshot, options.environmentId);
  const { census, canonical } = censusEmployeeProfileSnapshot(snapshot);

  if (options.mode === "copy" && !census.copyReady) {
    console.log(JSON.stringify({ mode: "copy", outcome: "REFUSED", reason: "CENSUS_NOT_COPY_READY", blockers: census.blockers, census }, null, 2));
    process.exitCode = 2;
    return;
  }

  const pg = require("pg");
  const { resolvePolicyDatabaseConfig } = require("../lib/adminPolicy/policyDatabase.js");
  const { copyEmployeeProfiles, verifyEmployeeProfiles } = require("../lib/eosWorkforce/migration/employeeProfileCutover.js");
  const client = new pg.Client(resolvePolicyDatabaseConfig({ connectionString: options.connectionString }));
  await client.connect();
  try {
    const tenant = await client.query("SELECT id FROM eos_policy.tenants WHERE key = $1", [options.tenantKey]);
    if (tenant.rows.length !== 1) throw new Error(`no tenant with key ${options.tenantKey}; the migration never creates one`);
    const tenantId = tenant.rows[0].id;
    const header = { mode: options.mode, environment: options.environmentId, tenantKey: options.tenantKey, tenantId };
    if (options.mode === "census") {
      await client.query("BEGIN READ ONLY");
      const employees = await client.query("SELECT count(*)::int AS n FROM eos_workforce.employees WHERE tenant_id = $1", [tenantId]);
      await client.query("COMMIT");
      console.log(JSON.stringify({ ...header, readOnly: true, census, target: { employees: employees.rows[0].n } }, null, 2));
      process.exitCode = census.copyReady ? 0 : 1;
    } else if (options.mode === "copy") {
      const report = await copyEmployeeProfiles(client, { tenantId, performedBy: options.performedBy, canonical, canonicalDigest: census.canonicalDigest });
      console.log(JSON.stringify({ ...header, report }, null, 2));
      process.exitCode = 0;
    } else {
      const report = await verifyEmployeeProfiles(client, { tenantId, canonical });
      console.log(JSON.stringify({ ...header, canonicalDigest: census.canonicalDigest, report }, null, 2));
      process.exitCode = report.reconciled ? 0 : 1;
    }
  } finally {
    await client.end();
  }
}

module.exports = { assertProfileCutoverInvocation, assertSnapshotSource, MODES, FROZEN_ENVIRONMENTS };

if (require.main === module) {
  main().catch((err) => {
    const governed = !err || !err.code || ["EmployeeProfileCutoverError", "EmployeeProfileSnapshotError"].includes(err.name);
    const details = err && err.details ? { details: err.details } : {};
    const message = governed ? (err instanceof Error ? err.message : String(err)) : "the run could not be completed";
    console.error(JSON.stringify({ outcome: "REFUSED_OR_FAILED", code: err && err.code ? err.code : null, message, ...details }, null, 2));
    process.exitCode = 2;
  });
}
