// COMMERCIAL C5 -- THE ONE-TIME COMMERCIAL DATA MIGRATION AND RECONCILIATION: census, disposition, copy, verify.
//
// ============================ WHAT THIS IS ============================
//
// The operator tool of docs/architecture/commercial-c5-data-migration-plan.md, over a snapshot of the legacy Firestore
// `opportunities`, `sales_agreements` and `sales_orders` written by scripts/exportCommercialSnapshot.js:
//
//   --mode census   READ ONLY. Counts and exact ids per family; Certification exclusions (ids + reason); fixture
//                   provenance; every source finding; number format / duplicates / series-year maxima; D2 execution
//                   fields present (excluded, counted); owner, credited salesperson and accountable person resolution
//                   against eos_workforce; Account resolution against eos_crm; catalog reference probe; the tenant's
//                   existing rows and counters; the ACCOUNTABILITY PLAN; gating conditions; and the DISPOSITION
//                   DECISION (DISPOSABLE_FIXTURE_ONLY | MIGRATION_REQUIRED_OR_OWNER_REVIEW | STOP_FOR_OWNER_DECISION |
//                   NO_SOURCE_RECORDS). Writes nothing.
//   --mode copy     COPY ONCE into eos_commercial for ONE tenant, in ONE transaction -- only when the disposition is
//                   MIGRATION_REQUIRED_OR_OWNER_REVIEW, every blocker is clear, and the operator restates the snapshot
//                   sha256 in --confirmMigrationRequired. Identical rerun: no change. Drift or unknown tenant rows:
//                   REFUSED, nothing written. No command receipts. No production mode at all.
//   --mode verify   Counts, ids, every field, number continuity, counter seeding with a rolled-back probe allocation,
//                   people, accountability history, Account FKs, lineage, exclusions, attribution. Commits nothing.
//
// A DISPOSABLE disposition's documented path is DISCARD + RESEED with the census preserved as evidence. This tool never
// deletes, marks or touches the Firestore source, and loads no Firebase module.
//
// ============================ THE FENCE ============================
//
// Refuses, BEFORE `pg` or lib/ is loaded (functions/test/operatorScriptEnvironmentFence.test.mjs proves the order):
//   * no --mode; --environment not declared in config/environments.json; production by role or by project id; no
//     --databaseUrlEnv (shared: measureEmployeeReferenceIntegrity.js assertMeasurementTarget)
//   * EOS_ENVIRONMENT not exactly `nonprod` (shared: measureWorkforceActivation.js assertNonprodRuntime)
//   * --environment platform-certification (the Certification world is frozen)
//   * missing --tenantKey / --snapshot; copy without --principalId or without a 64-hex --confirmMigrationRequired
//   * any Certification inclusion option; any --confirmProduction (there is no production mode)
// After the fence: the snapshot checksum must match, and the snapshot must name the environment and the Firebase project
// the registry declares -- never production.
//
// Usage (Render Shell on eos-api-nonprod):
//   node scripts/commercialC5.js --mode census --environment platform-sandbox --databaseUrlEnv DATABASE_URL \
//     --tenantKey taylor-nonprod --snapshot ./commercial-snapshot.json [--retainDeclaredSyntheticSeedRows]
//   ... --mode copy   ... --principalId <EOS principal id> --confirmMigrationRequired <snapshot sha256>
//   ... --mode verify ...
//
// Exit: 0 census decided (copy-ready, or disposable / empty) / copy applied or no-op / verify reconciled; 1 census needs
// review or blocked / verify not reconciled; 2 refused or failed. Output: one JSON document; no connection string.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { assertMeasurementTarget, parseArgs, PRODUCTION_PROJECT_ID } = require("./measureEmployeeReferenceIntegrity.js");
const { assertNonprodRuntime } = require("./measureWorkforceActivation.js");

const MODES = Object.freeze(["census", "copy", "verify"]);
const FROZEN_ENVIRONMENTS = Object.freeze(["platform-certification"]);
const SYNTHETIC_SEED_MANIFEST = path.resolve(__dirname, "fixtures/syntheticNonprodWorkforceSeed.v1.json");

/** Every refusal that can be decided from argv and the process environment alone. No client, no lib/. */
function assertC5Invocation(args, env) {
  if (!MODES.includes(args.mode)) {
    throw new Error(`--mode must be one of ${MODES.join(" | ")} (got ${args.mode === undefined ? "nothing" : `'${args.mode}'`}).`);
  }
  if (args.confirmProduction !== undefined) {
    throw new Error("--confirmProduction is not an option: Commercial C5 has no production mode in this tool (production needs an authorized census and an Owner decision first).");
  }
  const { environmentId, connectionString } = assertMeasurementTarget(args, env);
  assertNonprodRuntime(env);
  if (FROZEN_ENVIRONMENTS.includes(environmentId)) {
    throw new Error(`--environment '${environmentId}' is the Certification world, which is frozen. C5 neither reads it as a source nor writes its tenant.`);
  }
  if (!args.tenantKey || args.tenantKey === "true") throw new Error("--tenantKey is required: the tenant is named, never inferred.");
  if (!args.snapshot || args.snapshot === "true") throw new Error("--snapshot <file> is required: C5 consumes an exported snapshot, never a live Firestore read.");
  for (const option of ["certificationMarked", "includeCertification", "includeFixtures"]) {
    if (args[option] !== undefined) throw new Error(`--${option} is not an option: identified Certification fixtures are always excluded (Owner ruling).`);
  }
  if (args.mode === "copy") {
    if (!args.principalId || args.principalId === "true") throw new Error("--principalId <EOS principal id> is required for copy: rows are written as an EOS Principal, never a Firebase uid.");
    if (!/^[0-9a-f]{64}$/.test(args.confirmMigrationRequired || "")) {
      throw new Error("--confirmMigrationRequired <snapshot sha256> is required for copy: the operator restates which snapshot is being migrated.");
    }
  }
  return {
    mode: args.mode,
    environmentId,
    connectionString,
    tenantKey: args.tenantKey,
    snapshotPath: args.snapshot,
    principalId: args.principalId,
    confirmMigrationRequired: args.confirmMigrationRequired,
    retainDeclaredSyntheticSeedRows: args.retainDeclaredSyntheticSeedRows === "true",
  };
}

function declaredEnvironment(environmentId) {
  const registry = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../config/environments.json"), "utf8"));
  return (registry.environments || []).find((e) => e && e.id === environmentId) || null;
}

/** The snapshot bytes must match the immutable `<snapshot>.sha256` the export wrote. */
function verifySnapshotChecksum(snapshotPath) {
  const file = path.resolve(snapshotPath);
  let recorded;
  try {
    recorded = fs.readFileSync(`${file}.sha256`, "utf8").trim().split(/\s+/)[0];
  } catch {
    throw new Error(`${file}.sha256 is missing: a snapshot without its export checksum is refused.`);
  }
  const bytes = fs.readFileSync(file);
  const actual = crypto.hash("sha256", bytes);
  if (recorded !== actual) throw new Error(`the snapshot does not match ${file}.sha256; it changed after export and is refused.`);
  return { bytes, sha256: actual };
}

/** The snapshot must come from the environment being migrated, and never from production. */
function assertSnapshotSource(snapshot, environmentId) {
  const { firebaseProjectId, environmentId: snapshotEnvironment } = snapshot.source;
  if (firebaseProjectId === PRODUCTION_PROJECT_ID) {
    throw new Error(`the snapshot was exported from the production project '${PRODUCTION_PROJECT_ID}'. C5 has no production mode; refused.`);
  }
  const declared = declaredEnvironment(environmentId);
  const project = declared && declared.firebase ? declared.firebase.projectId : null;
  if (snapshotEnvironment !== environmentId || project === null || firebaseProjectId !== project) {
    throw new Error(`the snapshot names environment '${snapshotEnvironment}' / project '${firebaseProjectId}', but --environment '${environmentId}' declares '${project}'. Refused.`);
  }
}

/** The commercial numbers the governed synthetic nonprod seed declares -- the only target rows copy may leave in place. */
function declaredSyntheticSeedNumbers() {
  const manifest = JSON.parse(fs.readFileSync(SYNTHETIC_SEED_MANIFEST, "utf8"));
  return (manifest.commercial || []).map((r) => r.number);
}

function exitCodeForCensus(final, disposition) {
  if (final.copyReady) return 0;
  const decidedWithoutCopy = ["DISPOSABLE_FIXTURE_ONLY", "NO_SOURCE_RECORDS"].includes(disposition);
  return decidedWithoutCopy ? 0 : 1;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // THE FENCE FIRST, before any client or lib/ module exists.
  const options = assertC5Invocation(args, process.env);

  const { bytes, sha256 } = verifySnapshotChecksum(options.snapshotPath);
  const raw = JSON.parse(bytes.toString("utf8"));
  // AFTER the fence, never at module scope.
  const { parseCommercialSnapshot, censusCommercialSnapshot } = require("../lib/commercialMigration/commercialC5Snapshot.js");
  const snapshot = parseCommercialSnapshot(raw);
  assertSnapshotSource(snapshot, options.environmentId);
  const { census, canonical, legacyActorProvenance } = censusCommercialSnapshot(snapshot);
  const retainedSyntheticNumbers = options.retainDeclaredSyntheticSeedRows ? declaredSyntheticSeedNumbers() : [];
  // Migration evidence only: checksum, Certification exclusions, legacy uids (never a column).
  const evidence = { snapshotSha256: sha256, certificationExcluded: census.certificationExcluded, legacyActorProvenance };

  if (options.mode === "copy" && options.confirmMigrationRequired !== sha256) {
    console.log(JSON.stringify({ mode: "copy", outcome: "REFUSED", reason: "MIGRATION_CONFIRMATION_DOES_NOT_NAME_THIS_SNAPSHOT", evidence }, null, 2));
    process.exitCode = 2;
    return;
  }
  if (options.mode === "copy" && census.disposition.disposition !== "MIGRATION_REQUIRED_OR_OWNER_REVIEW") {
    console.log(JSON.stringify({ mode: "copy", outcome: "REFUSED", reason: `DISPOSITION_${census.disposition.disposition}`, disposition: census.disposition, census, evidence }, null, 2));
    process.exitCode = 2;
    return;
  }

  const pg = require("pg");
  const { resolvePolicyDatabaseConfig } = require("../lib/adminPolicy/policyDatabase.js");
  const target = require("../lib/commercialMigration/commercialC5Target.js");
  const client = new pg.Client(resolvePolicyDatabaseConfig({ connectionString: options.connectionString }));
  await client.connect();
  try {
    const tenant = await client.query("SELECT id FROM eos_policy.tenants WHERE key = $1", [options.tenantKey]);
    if (tenant.rows.length !== 1) throw new Error(`no tenant with key ${options.tenantKey}; C5 never creates one`);
    const tenantId = tenant.rows[0].id;
    const header = { mode: options.mode, environment: options.environmentId, tenantKey: options.tenantKey, tenantId };

    if (options.mode === "census") {
      await client.query("BEGIN READ ONLY");
      let facts;
      try {
        facts = await target.measureC5Target(client, tenantId, census, canonical);
      } finally {
        await client.query("COMMIT");
      }
      const final = target.finalizeC5Census(census, canonical, facts, { retainedSyntheticNumbers });
      console.log(JSON.stringify({ ...header, readOnly: true, disposition: census.disposition, census, final, evidence }, null, 2));
      process.exitCode = exitCodeForCensus(final, census.disposition.disposition);
    } else if (options.mode === "copy") {
      const report = await target.copyCommercial(client, {
        tenantId, principalId: options.principalId, census, canonical, snapshotSha256: sha256,
        confirmedSnapshotSha256: options.confirmMigrationRequired, retainedSyntheticNumbers,
      });
      console.log(JSON.stringify({ ...header, report, evidence }, null, 2));
      process.exitCode = 0;
    } else {
      const report = await target.verifyCommercial(client, { tenantId, census, canonical, legacyActorProvenance, retainedSyntheticNumbers });
      console.log(JSON.stringify({ ...header, canonicalDigest: census.canonicalDigest, report, evidence }, null, 2));
      process.exitCode = report.reconciled ? 0 : 1;
    }
  } finally {
    await client.end();
  }
}

module.exports = { assertC5Invocation, assertSnapshotSource, verifySnapshotChecksum, exitCodeForCensus, MODES, FROZEN_ENVIRONMENTS };

if (require.main === module) {
  main().catch((err) => {
    // Governed refusals speak for themselves; a driver or connection error is reduced to its code, because its
    // message can carry a host or user.
    const governed = !err || !err.code || ["CommercialC5Error", "CommercialSnapshotError"].includes(err.name);
    const details = err && err.details ? { details: err.details } : {};
    const message = governed ? (err instanceof Error ? err.message : String(err)) : "the run could not be completed";
    console.error(JSON.stringify({ outcome: "REFUSED_OR_FAILED", code: err && err.code ? err.code : null, message, ...details }, null, 2));
    process.exitCode = 2;
  });
}
