// THE MANUFACTURER COPY -- DRY RUN (the default), COPY ONCE, VERIFY -- Firestore `manufacturers` -> eos_ops.manufacturers.
//
// ============================ WHY ============================
//
// Firebase exit F5 (PR #2132) moves the Manufacturers screen and every Part form's manufacturer names onto
// eos_ops.manufacturers, which was measured EMPTY on nonprod. This is the operator tool that fills it from the legacy
// source, once, before F5 merges. The pure core is eosOps/migration/manufacturerMigration.ts (classify, dry run, copy
// plan, verify); this file is only its fence, its I/O and its one transaction.
//
// ============================ MODES ============================
//
//   --mode dryrun   (THE DEFAULT; READ ONLY.) Classifies every snapshot record against the tenant's current rows:
//                   COPYABLE / ALREADY_PRESENT_EQUIVALENT / CONFLICT / BLOCKED, plus duplicate-name findings. Prints the
//                   record checksum the copy must be given back. Writes nothing.
//   --mode copy     INSERT ONLY, in ONE transaction, as the EOS Principal named by --principalId (an active member of the
//                   tenant). Requires --reviewedChecksum: the checksum the reviewed dry run printed. Refuses, writing
//                   nothing, on checksum drift, any CONFLICT (a tenant row that differs is NEVER overwritten) or any
//                   BLOCKED record. An identical rerun inserts nothing. Rows are written MIGRATED.
//   --mode verify   READ ONLY. Source count vs target count, missing, differing and extra ids. Repairs nothing.
//
// NON-DESTRUCTIVE BY CONSTRUCTION: no UPDATE, no DELETE, no TRUNCATE (static test). It loads no Firebase module and
// cannot touch Firestore: the source is an EOS_CATALOG_SNAPSHOT file (scripts/exportCatalogSnapshot.js, which reads
// `manufacturers` read-only), checked against its immutable `<snapshot>.sha256`.
//
// ============================ THE FENCE (catalogCutover.js's, reused) ============================
//
// Before `pg` or lib/ is loaded: a declared non-production --environment and --databaseUrlEnv; EOS_ENVIRONMENT exactly
// `nonprod`; never platform-certification; --tenantKey and --snapshot named; the snapshot exported from the project the
// environment declares, never production. The tenant is resolved by key and never created.
//
// Usage (Render Shell on eos-api-nonprod; operator-run, never by CI or on a schedule):
//   node scripts/manufacturerCopy.js --environment platform-sandbox --databaseUrlEnv DATABASE_URL \
//     --tenantKey taylor-nonprod --snapshot ./catalog-snapshot.json                       # dry run
//   ... --mode copy --principalId <EOS principal id> --reviewedChecksum <from the dry run>
//   ... --mode verify
//
// Exit: 0 dry run applyable / copy applied or no-op / verify passed; 1 dry run not applyable or verify failed;
// 2 refused or failed. Output: one JSON document; no connection string, no secrets.
"use strict";

const crypto = require("node:crypto");
const { assertMeasurementTarget, parseArgs } = require("./measureEmployeeReferenceIntegrity.js");
const { assertNonprodRuntime } = require("./measureWorkforceActivation.js");
const { verifySnapshotChecksum, assertSnapshotSource } = require("./catalogCutover.js");

const MODES = Object.freeze(["dryrun", "copy", "verify"]);
const named = (v) => typeof v === "string" && v !== "true" && v.trim() !== "";

/** Every refusal decidable from argv and the environment alone. No client, no lib/. */
function assertCopyInvocation(args, env) {
  const mode = args.mode === undefined ? "dryrun" : args.mode;
  if (!MODES.includes(mode)) throw new Error(`--mode must be one of ${MODES.join(" | ")} (got '${mode}').`);
  const { environmentId, connectionString } = assertMeasurementTarget(args, env);
  assertNonprodRuntime(env);
  if (environmentId === "platform-certification") throw new Error("--environment 'platform-certification' is the Certification world, which is frozen.");
  if (!named(args.tenantKey)) throw new Error("--tenantKey is required: the tenant is named, never inferred.");
  if (!named(args.snapshot)) throw new Error("--snapshot <file> is required: the copy consumes an exported snapshot, never a live Firestore read.");
  if (mode === "copy") {
    if (!named(args.principalId)) throw new Error("--principalId <EOS principal id> is required for copy: rows are written as an EOS Principal.");
    if (!named(args.reviewedChecksum)) throw new Error("--reviewedChecksum is required for copy: the record checksum the reviewed dry run printed.");
  }
  return { mode, environmentId, connectionString, tenantKey: args.tenantKey, snapshotPath: args.snapshot,
    principalId: args.principalId, reviewedChecksum: args.reviewedChecksum };
}

/** The snapshot's `manufacturers` section as the migration core's SourceManufacturer records (document id = id). */
function manufacturerRecords(raw) {
  if (!raw || raw.format !== "EOS_CATALOG_SNAPSHOT") throw new Error("not an EOS_CATALOG_SNAPSHOT file.");
  if (!Array.isArray(raw.manufacturers)) {
    throw new Error("the snapshot has no `manufacturers` section; export it with the current scripts/exportCatalogSnapshot.js.");
  }
  return raw.manufacturers.map((d) => ({ id: d.id, name: d.data ? d.data.name : undefined, status: d.data ? d.data.status : undefined }));
}

const summary = (report) => ({
  recordCount: report.snapshot.recordCount, checksum: report.snapshot.checksum, applyable: report.applyable,
  copyable: report.copyable, alreadyPresentEquivalent: report.alreadyPresentEquivalent, conflict: report.conflict, blocked: report.blocked,
  conflictIds: report.rows.filter((r) => r.disposition === "CONFLICT").map((r) => r.id),
  blockedRecords: report.rows.filter((r) => r.disposition === "BLOCKED").map((r) => ({ id: r.id, blockers: r.blockers })),
  duplicateNameGroups: report.duplicateNameGroups, caseOnlyDuplicateGroups: report.caseOnlyDuplicateGroups,
});

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // THE FENCE FIRST, before any client or lib/ module exists.
  const options = assertCopyInvocation(args, process.env);
  const { bytes, sha256 } = verifySnapshotChecksum(options.snapshotPath);
  const raw = JSON.parse(bytes.toString("utf8"));
  assertSnapshotSource(raw, options.environmentId);

  const M = require("../lib/eosOps/migration/manufacturerMigration.js");
  const snapshot = M.buildSnapshot({
    sourceProject: raw.source.firebaseProjectId, sourceCollection: "manufacturers", records: manufacturerRecords(raw),
    now: raw.source.exportedAt, hash: (s) => crypto.hash("sha256", s),
  });
  const pg = require("pg");
  const { resolvePolicyDatabaseConfig } = require("../lib/adminPolicy/policyDatabase.js");
  const { INSERT_MANUFACTURER_SQL, insertManufacturerValues, isoMicros } = require("../lib/catalogMaster/catalogRows.js");
  const client = new pg.Client(resolvePolicyDatabaseConfig({ connectionString: options.connectionString }));
  await client.connect();
  try {
    const tenant = await client.query("SELECT id FROM eos_policy.tenants WHERE key = $1", [options.tenantKey]);
    if (tenant.rows.length !== 1) throw new Error(`no tenant with key ${options.tenantKey}; the copy never creates one.`);
    const tenantId = tenant.rows[0].id;
    const header = { mode: options.mode, environment: options.environmentId, tenantKey: options.tenantKey, tenantId, snapshotSha256: sha256 };
    const readTarget = async () => (await client.query(
      "SELECT id, name, status FROM eos_ops.manufacturers WHERE tenant_id = $1 ORDER BY id", [tenantId])).rows;

    if (options.mode !== "copy") {
      await client.query("BEGIN READ ONLY");
      const target = await readTarget();
      await client.query("COMMIT");
      if (options.mode === "dryrun") {
        const report = summary(M.runDryRun(snapshot, target));
        console.log(JSON.stringify({ ...header, readOnly: true, report }, null, 2));
        process.exitCode = report.applyable ? 0 : 1;
      } else {
        const report = M.verifyCopy(snapshot, target);
        console.log(JSON.stringify({ ...header, readOnly: true, report }, null, 2));
        process.exitCode = report.pass ? 0 : 1;
      }
      return;
    }

    await client.query("BEGIN");
    try {
      const member = await client.query(
        `SELECT 1 FROM eos_policy.tenant_memberships m JOIN eos_policy.principals p ON p.id = m.principal_id
          WHERE m.tenant_id = $1 AND m.principal_id = $2 AND m.status = 'active' AND p.status = 'active'`,
        [tenantId, options.principalId]);
      if (member.rows.length === 0) throw new Error("the copy Principal is not an active member of the target tenant.");
      // No writer may move a row between the plan and the inserts; readers are not blocked.
      await client.query("LOCK TABLE eos_ops.manufacturers IN SHARE ROW EXCLUSIVE MODE");
      const plan = M.buildCopyPlan(snapshot, await readTarget(), options.reviewedChecksum);
      const at = isoMicros(new Date());
      for (const t of plan.inserts) {
        const record = { id: t.id, name: t.name, normalizedName: M.normalizeName(t.name), status: t.status,
          provenance: "MIGRATED", createdAt: at, updatedAt: at };
        await client.query(INSERT_MANUFACTURER_SQL, insertManufacturerValues(tenantId, record, options.principalId, options.principalId));
      }
      await client.query("COMMIT");
      console.log(JSON.stringify({ ...header, checksum: plan.checksum, inserted: plan.inserts.length,
        insertedIds: plan.inserts.map((t) => t.id), outcome: plan.inserts.length === 0 ? "NO_CHANGE" : "APPLIED" }, null, 2));
      process.exitCode = 0;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
  } finally {
    await client.end();
  }
}

module.exports = { assertCopyInvocation, manufacturerRecords, MODES };

if (require.main === module) {
  main().catch((err) => {
    // A governed refusal speaks for itself; a driver error is reduced to its code (its message can carry a host).
    const governed = !err || !err.code || err.name === "ManufacturerCopyError" || err.name === "Error";
    console.error(JSON.stringify({ outcome: "REFUSED_OR_FAILED", code: err && err.code ? err.code : null,
      message: governed ? (err instanceof Error ? err.message : String(err)) : "the run could not be completed" }, null, 2));
    process.exitCode = 2;
  });
}
