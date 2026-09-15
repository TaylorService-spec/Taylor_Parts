// THE GOVERNED CATALOG CUTOVER -- COPY ONCE, VERIFY, RECONCILE -- for Part Master and Equipment Model.
//
// ============================ WHAT THIS IS ============================
//
// The operator tool for the first three steps of docs/architecture/catalog-cutover-plan.md:
//
//   --mode census   READ ONLY. The snapshot's counts, id validity, duplicate canonical identities, missing
//                   Part -> Equipment Model references, lifecycle distribution, non-master fields, and the target
//                   tenant's current catalog row counts. Writes nothing anywhere.
//   --mode copy     COPY ONCE into eos_ops.equipment_models and eos_ops.parts for ONE tenant, in ONE transaction.
//                   Refuses unless the census is copy-ready. Identical rerun: no change. A source that changed after
//                   the copy, or a tenant row the snapshot does not contain: REFUSED, nothing written, never
//                   overwritten.
//   --mode verify   READ ONLY. Counts, identity reconciliation, exact field reconciliation over a deterministic
//                   sample (--sample N | all), duplicate identity, dangling references, reference verdict spot-checks.
//
// ============================ THE SOURCE IS A FILE ============================
//
// --snapshot names an EOS_CATALOG_SNAPSHOT file written by scripts/exportCatalogSnapshot.js (functions/src/
// catalogMaster/catalogSnapshot.ts documents the format). THIS TOOL LOADS NO FIREBASE MODULE AND CANNOT WRITE
// FIRESTORE: it never deletes, marks or touches the legacy source. The snapshot must name the Firebase project the
// --environment declares, and never the production project.
//
// ============================ THE FENCE ============================
//
// Refuses, BEFORE `pg` or lib/ is loaded (functions/test/operatorScriptEnvironmentFence.test.mjs proves the order):
//   * no --environment declared in config/environments.json; production by role or by project id; no
//     --databaseUrlEnv (shared: measureEmployeeReferenceIntegrity.js assertMeasurementTarget)
//   * EOS_ENVIRONMENT not exactly `nonprod` (shared: measureWorkforceActivation.js assertNonprodRuntime)
//   * --environment platform-certification (the Certification world is frozen)
//   * missing --mode / --tenantKey / --snapshot, or --performedBy for copy
// The tenant is resolved by --tenantKey from eos_policy.tenants and never created or inferred.
//
// Usage (Render Shell on eos-api-nonprod):
//   node scripts/catalogCutover.js --mode census --environment platform-sandbox --databaseUrlEnv DATABASE_URL \
//     --tenantKey taylor-nonprod --snapshot ./catalog-snapshot.json [--certificationMarked include|exclude]
//   ... --mode copy   ... --performedBy <operator>
//   ... --mode verify ... [--sample 50|all]
//
// Exit: 0 census copy-ready / copy applied or no-op / verify reconciled; 1 census not copy-ready or verify not
// reconciled; 2 refused or failed. Output: one deterministic JSON document; no connection string, no secrets.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { assertMeasurementTarget, parseArgs, PRODUCTION_PROJECT_ID } = require("./measureEmployeeReferenceIntegrity.js");
const { assertNonprodRuntime } = require("./measureWorkforceActivation.js");

const MODES = Object.freeze(["census", "copy", "verify"]);
const FROZEN_ENVIRONMENTS = Object.freeze(["platform-certification"]);
const DEFAULT_SAMPLE = 50;

/** Every refusal that can be decided from argv and the process environment alone. No client, no lib/. */
function assertCutoverInvocation(args, env) {
  if (!MODES.includes(args.mode)) {
    throw new Error(`--mode must be one of ${MODES.join(" | ")} (got ${args.mode === undefined ? "nothing" : `'${args.mode}'`}).`);
  }
  const { environmentId, connectionString } = assertMeasurementTarget(args, env);
  assertNonprodRuntime(env);
  if (FROZEN_ENVIRONMENTS.includes(environmentId)) {
    throw new Error(`--environment '${environmentId}' is the Certification world, which is frozen. The catalog cutover neither reads it as a source nor writes its tenant.`);
  }
  if (!args.tenantKey || args.tenantKey === "true") throw new Error("--tenantKey is required: the tenant is named, never inferred.");
  if (!args.snapshot || args.snapshot === "true") throw new Error("--snapshot <file> is required: the copy consumes an exported snapshot, never a live Firestore read.");
  if (args.mode === "copy" && (!args.performedBy || args.performedBy === "true")) throw new Error("--performedBy <operator> is required for copy.");
  if (args.certificationMarked !== undefined && !["include", "exclude"].includes(args.certificationMarked)) {
    throw new Error("--certificationMarked must be include or exclude.");
  }
  let sample = DEFAULT_SAMPLE;
  if (args.sample !== undefined) {
    if (args.sample === "all") sample = "all";
    else if (/^[1-9][0-9]{0,6}$/.test(args.sample)) sample = Number(args.sample);
    else throw new Error("--sample must be a positive integer or all.");
  }
  return {
    mode: args.mode,
    environmentId,
    connectionString,
    tenantKey: args.tenantKey,
    snapshotPath: args.snapshot,
    performedBy: args.performedBy,
    certification: args.certificationMarked ?? null,
    sample,
  };
}

/** The Firebase project the environment registry declares for this environment. */
function declaredProjectId(environmentId) {
  const registry = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../config/environments.json"), "utf8"));
  const env = (registry.environments || []).find((e) => e && e.id === environmentId);
  return env && env.firebase ? env.firebase.projectId : null;
}

/** The snapshot must come from the environment being cut over, and never from production. */
function assertSnapshotSource(snapshot, environmentId) {
  const projectId = snapshot.source.firebaseProjectId;
  if (projectId === PRODUCTION_PROJECT_ID) {
    throw new Error(`the snapshot was exported from the production project '${PRODUCTION_PROJECT_ID}'. A production census or copy requires separate authorization; refused.`);
  }
  const declared = declaredProjectId(environmentId);
  if (declared === null || projectId !== declared) {
    throw new Error(`the snapshot names Firebase project '${projectId}', but --environment '${environmentId}' declares '${declared}'. Refused.`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // THE FENCE FIRST, before any client or lib/ module exists.
  const options = assertCutoverInvocation(args, process.env);

  const raw = JSON.parse(fs.readFileSync(path.resolve(options.snapshotPath), "utf8"));
  // AFTER the fence, never at module scope.
  const { parseCatalogSnapshot, censusCatalogSnapshot } = require("../lib/catalogMaster/catalogSnapshot.js");
  const snapshot = parseCatalogSnapshot(raw);
  assertSnapshotSource(snapshot, options.environmentId);
  const { census, catalog } = censusCatalogSnapshot(snapshot, options.certification);

  if (options.mode === "copy" && !census.copyReady) {
    console.log(JSON.stringify({ mode: "copy", outcome: "REFUSED", reason: "CENSUS_NOT_COPY_READY", blockers: census.blockers, census }, null, 2));
    process.exitCode = 2;
    return;
  }

  const pg = require("pg");
  const { resolvePolicyDatabaseConfig } = require("../lib/adminPolicy/policyDatabase.js");
  const { copyCatalog, verifyCatalog, partMasterSchemaPresent } = require("../lib/catalogMaster/catalogCutover.js");
  const client = new pg.Client(resolvePolicyDatabaseConfig({ connectionString: options.connectionString }));
  await client.connect();
  try {
    const tenant = await client.query("SELECT id FROM eos_policy.tenants WHERE key = $1", [options.tenantKey]);
    if (tenant.rows.length !== 1) throw new Error(`no tenant with key ${options.tenantKey}; the cutover never creates one`);
    const tenantId = tenant.rows[0].id;
    const header = { mode: options.mode, environment: options.environmentId, tenantKey: options.tenantKey, tenantId };

    if (options.mode === "census") {
      await client.query("BEGIN READ ONLY");
      const partSchema = await partMasterSchemaPresent(client);
      const models = await client.query("SELECT count(*)::int AS n FROM eos_ops.equipment_models WHERE tenant_id = $1", [tenantId]);
      const parts = partSchema ? await client.query("SELECT count(*)::int AS n FROM eos_ops.parts WHERE tenant_id = $1", [tenantId]) : null;
      await client.query("COMMIT");
      const target = { equipmentModels: models.rows[0].n, parts: parts ? parts.rows[0].n : null, partMasterSchemaPresent: partSchema };
      console.log(JSON.stringify({ ...header, readOnly: true, census, target }, null, 2));
      process.exitCode = census.copyReady ? 0 : 1;
    } else if (options.mode === "copy") {
      const report = await copyCatalog(client, { tenantId, performedBy: options.performedBy, catalog, canonicalDigest: census.canonicalDigest });
      console.log(JSON.stringify({ ...header, report }, null, 2));
      process.exitCode = 0;
    } else {
      const report = await verifyCatalog(client, { tenantId, catalog, sample: options.sample });
      console.log(JSON.stringify({ ...header, canonicalDigest: census.canonicalDigest, report }, null, 2));
      process.exitCode = report.reconciled ? 0 : 1;
    }
  } finally {
    await client.end();
  }
}

module.exports = { assertCutoverInvocation, assertSnapshotSource, MODES, FROZEN_ENVIRONMENTS };

if (require.main === module) {
  main().catch((err) => {
    // Governed refusals speak for themselves; a driver or connection error is reduced to its code, because its
    // message can carry a host or user.
    const governed = !err || !err.code || ["CatalogCutoverError", "CatalogSnapshotError"].includes(err.name);
    const details = err && err.details ? { details: err.details } : {};
    const message = governed ? (err instanceof Error ? err.message : String(err)) : "the run could not be completed";
    console.error(JSON.stringify({ outcome: "REFUSED_OR_FAILED", code: err && err.code ? err.code : null, message, ...details }, null, 2));
    process.exitCode = 2;
  });
}
