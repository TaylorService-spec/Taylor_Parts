// THE GOVERNED INVENTORY BASELINE CUTOVER -- CENSUS, COPY ONCE, VERIFY, CERTIFY -- for the legacy Firestore inventory ledger and
// serialized custody into eos_ops (Controller INVENTORY / WAREHOUSE COMPLETION RULINGS, 2026-10-01).
//
// The operator tool that carries src/eosOps/migration/inventoryBaselineCutover.ts to the one place that holds the nonprod
// DATABASE_URL. It decides NOTHING itself: every classification, refusal and write belongs to that module; this file reads
// the snapshot and the manifest, applies the fence, and prints evidence.
//
//   --mode census    READ ONLY. The plan against the target: per-record dispositions and codes, counts, blocking total.
//   --mode copy      COPY ONCE, one transaction: every PLANNED movement and custody unit (replay-safe; a rerun is NO_CHANGES).
//   --mode verify    READ ONLY. Every planned movement / unit present, zero blocking refusals -> VERIFIED, else NOT_VERIFIED.
//   --mode certify   Writes the tenant's LEDGER + CUSTODY certification ONLY on a VERIFIED baseline. That certification is
//                    what opens the EOS Inventory writers for the tenant (src/eosOps/inventoryBaselineGate.ts).
//
// THE SOURCE IS A FILE: an EOS_INVENTORY_SNAPSHOT (the fenced migration-only exporter) with its immutable `<file>.sha256`,
// naming the Firebase project the --environment declares -- never production, never Certification. The MANIFEST is an
// EOS_INVENTORY_BASELINE_MANIFEST with its `.sha256`: explicit warehouse identity (with evidence) and fixture exclusions.
// THIS TOOL LOADS NO FIREBASE MODULE AND CANNOT WRITE FIRESTORE. Output: ids, dispositions, codes, counts -- never a field
// value, never a connection string. Exit 0 success / VERIFIED / CERTIFIED; 3 NOT_VERIFIED; 2 refused or failed.
"use strict";

const { assertMeasurementTarget, parseArgs } = require("./measureEmployeeReferenceIntegrity.js");
const { assertNonprodRuntime } = require("./measureWorkforceActivation.js");
const { verifySnapshotChecksum, assertSnapshotSource } = require("./catalogCutover.js");

const MODES = Object.freeze(["census", "copy", "verify", "certify"]);
const FROZEN_ENVIRONMENTS = Object.freeze(["platform-certification"]);
const SNAPSHOT_KEYS = Object.freeze(["inventoryTransactions", "serializedAssets", "warehouses", "cycleCounts", "transferOrders"]);

/** Every refusal decidable from argv and the environment alone. No client, no lib/. */
function assertInventoryCutoverInvocation(args, env) {
  if (!MODES.includes(args.mode)) throw new Error(`--mode must be one of ${MODES.join(" | ")} (got ${args.mode === undefined ? "nothing" : `'${args.mode}'`}).`);
  const { environmentId, connectionString } = assertMeasurementTarget(args, env);
  assertNonprodRuntime(env);
  if (FROZEN_ENVIRONMENTS.includes(environmentId)) throw new Error(`--environment '${environmentId}' is the Certification world, which is frozen.`);
  if (!args.tenantKey || args.tenantKey === "true") throw new Error("--tenantKey is required: the tenant is named, never inferred.");
  if (!args.snapshot || args.snapshot === "true") throw new Error("--snapshot <file> is required: the copy consumes an exported snapshot, never a live Firestore read.");
  if (!args.manifest || args.manifest === "true") throw new Error("--manifest <file> is required: the declared warehouse identity + fixture exclusion manifest.");
  if ((args.mode === "copy" || args.mode === "certify") && (!args.principalId || args.principalId === "true")) {
    throw new Error("--principalId <EOS principal id> is required for copy and certify: the cutover is executed as an EOS Principal.");
  }
  return { mode: args.mode, environmentId, connectionString, tenantKey: args.tenantKey, snapshotPath: args.snapshot, manifestPath: args.manifest, principalId: args.principalId };
}

/** Firestore Timestamp tags -> epoch millis (the mapper's occurredAt contract). Everything else unchanged. */
function decodeTimestamps(value) {
  if (Array.isArray(value)) return value.map(decodeTimestamps);
  if (value && typeof value === "object") {
    const ts = value.$timestamp;
    if (ts && typeof ts === "object" && Object.keys(value).length === 1) return Number(ts.seconds) * 1000 + Math.floor(Number(ts.nanoseconds) / 1e6);
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, decodeTimestamps(v)]));
  }
  return value;
}

function parseInventorySnapshot(raw, sha256) {
  if (!raw || raw.format !== "EOS_INVENTORY_SNAPSHOT" || raw.version !== 1 || !raw.source) throw new Error("not an EOS_INVENTORY_SNAPSHOT v1; refused.");
  for (const k of SNAPSHOT_KEYS) if (!Array.isArray(raw[k])) throw new Error(`the snapshot has no '${k}' collection; re-export with the current allowlist. Refused.`);
  const docs = (k) => raw[k].map((d) => ({ id: String(d.id), data: decodeTimestamps(d.data) }));
  return { source: raw.source, snapshot: { sha256, ...Object.fromEntries(SNAPSHOT_KEYS.map((k) => [k, docs(k)])) } };
}

function summarize(plan) {
  return {
    snapshotSha256: plan.snapshotSha256, manifestSha256: plan.manifestSha256, blocking: plan.blocking, counts: plan.counts,
    plannedMovements: plan.movements.length, plannedCustody: plan.custody.length,
    findings: plan.findings.filter((f) => f.disposition !== "PLANNED").map((f) => ({ kind: f.kind, id: f.id, disposition: f.disposition, code: f.code })),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const options = assertInventoryCutoverInvocation(args, process.env);
  const snap = verifySnapshotChecksum(options.snapshotPath);
  let raw;
  try { raw = JSON.parse(snap.bytes.toString("utf8")); } catch { throw new Error("the snapshot is not valid JSON; refused."); }
  const { source, snapshot } = parseInventorySnapshot(raw, snap.sha256);
  assertSnapshotSource({ source }, options.environmentId);
  const manifestFile = verifySnapshotChecksum(options.manifestPath);
  const cutover = require("../lib/eosOps/migration/inventoryBaselineCutover.js");
  const manifest = cutover.validateManifest(JSON.parse(manifestFile.bytes.toString("utf8")));

  const pg = require("pg");
  const { resolvePolicyDatabaseConfig } = require("../lib/adminPolicy/policyDatabase.js");
  const pool = new pg.Pool({ ...resolvePolicyDatabaseConfig({ connectionString: options.connectionString }), max: 2 });
  pool.on("error", () => undefined);
  try {
    const tenant = await pool.query("SELECT id FROM eos_policy.tenants WHERE key = $1", [options.tenantKey]);
    if (tenant.rows.length !== 1) throw new Error(`no tenant with key ${options.tenantKey}; the cutover never creates one`);
    const input = { tenantId: tenant.rows[0].id, snapshot, manifest, performedBy: options.principalId ?? "census" };
    const header = { mode: options.mode, environment: options.environmentId, tenantKey: options.tenantKey, tenantId: input.tenantId, source };
    if (options.mode === "census") {
      console.log(JSON.stringify({ ...header, ...summarize(await cutover.censusInventoryBaseline(pool, input)) }, null, 2));
    } else if (options.mode === "copy") {
      const r = await cutover.copyInventoryBaselineOnce(pool, input);
      console.log(JSON.stringify({ ...header, outcome: r.outcome, movementsInserted: r.movementsInserted, movementsPresent: r.movementsPresent, custodyInserted: r.custodyInserted, ...summarize(r.plan) }, null, 2));
    } else if (options.mode === "verify") {
      const v = await cutover.verifyInventoryBaseline(pool, input);
      console.log(JSON.stringify({ ...header, verdict: v.verdict, movementsExpected: v.movementsExpected, movementsFound: v.movementsFound, custodyMissing: v.custodyMissing, ...summarize(v.plan) }, null, 2));
      if (v.verdict !== "VERIFIED") process.exitCode = 3;
    } else {
      console.log(JSON.stringify({ ...header, ...(await cutover.certifyInventoryBaseline(pool, input)) }, null, 2));
    }
  } finally {
    await pool.end();
  }
}

module.exports = { MODES, assertInventoryCutoverInvocation, decodeTimestamps, parseInventorySnapshot };

if (require.main === module) {
  main().catch((err) => {
    console.error(String(err instanceof Error ? err.message : err).replace(/postgres(ql)?:\/\/\S+/g, "<redacted>"));
    process.exitCode = 2;
  });
}
