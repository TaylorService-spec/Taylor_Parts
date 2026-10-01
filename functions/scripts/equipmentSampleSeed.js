// THE EQUIPMENT REGISTER SAMPLE_DATA_SEED -- CENSUS, COPY ONCE, VERIFY -- for the Firebase `equipment` collection into
// eos_ops.equipment (Controller EQUIPMENT ACTIVATION AUTHORIZED, 2026-10-01; GLOBAL OWNER RULING 2026-10-01).
//
// The operator tool that carries src/eosOps/migration/equipmentSampleSeed.ts to the one place that holds the nonprod
// DATABASE_URL. It decides NOTHING itself: every classification, exclusion and write belongs to that module.
//
//   --mode census    READ ONLY. Per-document dispositions and codes, counts.
//   --mode copy      COPY ONCE, one transaction: every PLANNED record + its SAMPLE_DATA_SEED event (a rerun is NO_CHANGES).
//   --mode verify    READ ONLY. Every resolvable document present with its lineage -> VERIFIED, else NOT_VERIFIED.
//
// THE SOURCE IS A FILE: an EOS_INVENTORY_SNAPSHOT (the fenced migration-only exporter, key `equipment`) with its
// immutable `<file>.sha256`, naming the Firebase project the --environment declares -- never production, never
// Certification. The MANIFEST is an EOS_EQUIPMENT_SAMPLE_SEED_MANIFEST with its `.sha256`: the ruling, the operating
// company the sample register is held under, and explicit exclusions. THIS TOOL LOADS NO FIREBASE MODULE AND CANNOT WRITE
// FIRESTORE. Output: ids, dispositions, codes, counts -- never a field value, never a connection string.
// Exit 0 success / VERIFIED; 3 NOT_VERIFIED; 2 refused or failed.
"use strict";

const { assertMeasurementTarget, parseArgs } = require("./measureEmployeeReferenceIntegrity.js");
const { assertNonprodRuntime } = require("./measureWorkforceActivation.js");
const { verifySnapshotChecksum, assertSnapshotSource } = require("./catalogCutover.js");
const { decodeTimestamps } = require("./inventoryCutover.js");

const MODES = Object.freeze(["census", "copy", "verify"]);
const FROZEN_ENVIRONMENTS = Object.freeze(["platform-certification"]);

/** Every refusal decidable from argv and the environment alone. No client, no lib/. */
function assertEquipmentSeedInvocation(args, env) {
  if (!MODES.includes(args.mode)) throw new Error(`--mode must be one of ${MODES.join(" | ")} (got ${args.mode === undefined ? "nothing" : `'${args.mode}'`}).`);
  const { environmentId, connectionString } = assertMeasurementTarget(args, env);
  assertNonprodRuntime(env);
  if (FROZEN_ENVIRONMENTS.includes(environmentId)) throw new Error(`--environment '${environmentId}' is the Certification world, which is frozen.`);
  if (!args.tenantKey || args.tenantKey === "true") throw new Error("--tenantKey is required: the tenant is named, never inferred.");
  if (!args.snapshot || args.snapshot === "true") throw new Error("--snapshot <file> is required: the seed consumes an exported snapshot, never a live Firestore read.");
  if (!args.manifest || args.manifest === "true") throw new Error("--manifest <file> is required: the declared operating company + exclusion manifest.");
  if (args.mode === "copy" && (!args.principalId || args.principalId === "true")) {
    throw new Error("--principalId <EOS principal id> is required for copy: the seed is executed as an EOS Principal.");
  }
  return { mode: args.mode, environmentId, connectionString, tenantKey: args.tenantKey, snapshotPath: args.snapshot, manifestPath: args.manifest, principalId: args.principalId };
}

function parseEquipmentSnapshot(raw) {
  if (!raw || raw.format !== "EOS_INVENTORY_SNAPSHOT" || raw.version !== 1 || !raw.source) throw new Error("not an EOS_INVENTORY_SNAPSHOT v1; refused.");
  if (!Array.isArray(raw.equipment)) throw new Error("the snapshot has no 'equipment' collection; re-export with the current allowlist. Refused.");
  return { source: raw.source, docs: raw.equipment.map((d) => ({ id: String(d.id), data: decodeTimestamps(d.data) })) };
}

function summarize(plan) {
  return {
    seedKind: plan.seedKind, snapshotSha256: plan.snapshotSha256, manifestSha256: plan.manifestSha256, counts: plan.counts,
    planned: plan.rows.length,
    findings: plan.findings.filter((f) => f.disposition !== "PLANNED" && f.disposition !== "PRESENT")
      .map((f) => ({ legacyId: f.legacyId, disposition: f.disposition, code: f.code })),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const options = assertEquipmentSeedInvocation(args, process.env);
  const snap = verifySnapshotChecksum(options.snapshotPath);
  let raw;
  try { raw = JSON.parse(snap.bytes.toString("utf8")); } catch { throw new Error("the snapshot is not valid JSON; refused."); }
  const { source, docs } = parseEquipmentSnapshot(raw);
  assertSnapshotSource({ source }, options.environmentId);
  const manifestFile = verifySnapshotChecksum(options.manifestPath);
  const seed = require("../lib/eosOps/migration/equipmentSampleSeed.js");
  const manifest = seed.validateEquipmentSeedManifest(JSON.parse(manifestFile.bytes.toString("utf8")));

  const pg = require("pg");
  const { resolvePolicyDatabaseConfig } = require("../lib/adminPolicy/policyDatabase.js");
  const pool = new pg.Pool({ ...resolvePolicyDatabaseConfig({ connectionString: options.connectionString }), max: 2 });
  pool.on("error", () => undefined);
  try {
    const tenant = await pool.query("SELECT id FROM eos_policy.tenants WHERE key = $1", [options.tenantKey]);
    if (tenant.rows.length !== 1) throw new Error(`no tenant with key ${options.tenantKey}; the seed never creates one`);
    const input = { tenantId: tenant.rows[0].id, snapshotSha256: snap.sha256, manifestSha256: manifestFile.sha256, manifest, docs,
      performedBy: options.principalId ?? "census" };
    const header = { mode: options.mode, environment: options.environmentId, tenantKey: options.tenantKey, tenantId: input.tenantId, source };
    if (options.mode === "census") {
      console.log(JSON.stringify({ ...header, ...summarize(await seed.censusEquipmentSeed(pool, input)) }, null, 2));
    } else if (options.mode === "copy") {
      const r = await seed.copyEquipmentSeedOnce(pool, input);
      console.log(JSON.stringify({ ...header, outcome: r.outcome, inserted: r.inserted, ...summarize(r.plan) }, null, 2));
    } else {
      const v = await seed.verifyEquipmentSeed(pool, input);
      console.log(JSON.stringify({ ...header, verdict: v.verdict, expected: v.expected, found: v.found, missingEvents: v.missingEvents, ...summarize(v.plan) }, null, 2));
      if (v.verdict !== "VERIFIED") process.exitCode = 3;
    }
  } finally {
    await pool.end();
  }
}

module.exports = { MODES, assertEquipmentSeedInvocation, parseEquipmentSnapshot };

if (require.main === module) {
  main().catch((err) => {
    console.error(String(err instanceof Error ? err.message : err).replace(/postgres(ql)?:\/\/\S+/g, "<redacted>"));
    process.exitCode = 2;
  });
}
