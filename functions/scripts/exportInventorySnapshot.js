// FIREBASE_EXIT_MIGRATION_ONLY
//
// INVENTORY SNAPSHOT EXPORT -- the one READ-ONLY Firestore step the Cycle Count and Transfer cutovers need
// (Controller ruling DQ-025, 2026-09-28). Operator-run; never by CI, never on a schedule, never from the runtime.
// PREPARED LOCALLY ONLY: running it against any project is a separate, authorized execution step.
//
// ============================ THE MIGRATION-ONLY EXCEPTION (DQ-025) ============================
//
// The same fenced READ pattern as scripts/exportCatalogSnapshot.js, for the EXACT legacy inventory collections the
// census and reconciliation tooling consumes -- enumerated, with the consumer of each, in
// docs/architecture/inventory-snapshot-export-evidence.json BEFORE any execution:
//
//   cycle_counts            -> scripts/cycleCountActivationCensus.js   (Cycle Count activation gate 1: zero population)
//   inventory_transactions  -> scripts/inventoryLedgerCensus.js        (DQ-019 malformed-row census; baseline/ledger COPY input)
//   transfer_orders         -> scripts/transferCopyCensus.js           (Transfer COPY-lane census; IN_TRANSIT ledger agreement)
//   serialized_assets       -> scripts/inventoryCutover.js             (baseline custody COPY; INVENTORY COMPLETION RULINGS 2026-10-01)
//   warehouses              -> scripts/inventoryCutover.js             (location identity proof for the baseline COPY)
//   equipment               -> scripts/equipmentSampleSeed.js          (Equipment register SAMPLE_DATA_SEED; EQUIPMENT ACTIVATION 2026-10-01)
//
// Conditions, each enforced here or by functions/test/inventorySnapshotExport.test.mjs and
// functions/test/operatorScriptEnvironmentFence.test.mjs:
//
//   * READ ONLY. The only Firestore calls are `collection(name).get()`; no write verb appears in the code (static
//     test). One-time: no sync, no schedule, no refresh. No Rules, Functions, config or runtime change.
//   * EXACT SOURCE ALLOWLIST: the six collections above and nothing else (SOURCE_COLLECTIONS + assertAllowlisted).
//     Top-level documents only -- a v2 cycle-count sheet's `lines` subcollection is deliberately NOT read: any v2
//     sheet is already a STOP at gate 1, and reading its lines would widen the exception.
//   * NOT RUNTIME. No module under functions/src, field-ops-app-vite/src or integrations references it; not in
//     package.json main/exports/scripts; a workflow may name it only as a path filter (structural test).
//   * FENCED before firebase-admin loads: project named explicitly and declared in config/environments.json;
//     production (`taylor-parts`, or any role:production project) refused outright -- this tool has no production
//     mode; the frozen Certification world refused.
//   * IMMUTABLE AND CHECKSUMMED: snapshot + `<snapshot>.sha256` created exclusively (`wx`, 0600), never overwritten;
//     the census tools refuse a snapshot whose checksum disagrees.
//   * NO SECRETS IN OUTPUT: source project id, export time, documents. Credentials come from Application Default
//     Credentials and are never read into, or written to, the output.
//
// RETIREMENT. Deleted in the change that retires the legacy Firestore inventory writers for the last of these
// collections; the snapshots are cutover evidence, kept outside the repo.
//
// Usage:
//   node scripts/exportInventorySnapshot.js --projectId eos-platform-sandbox --out <file outside the repo>
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { hash } = require("node:crypto");
const { parseArgs, PRODUCTION_PROJECT_ID } = require("./projectTargetGuard.js");

/** The literal marker the migration-only exception is identified by. */
const FIREBASE_EXIT_MIGRATION_ONLY = "FIREBASE_EXIT_MIGRATION_ONLY";

/** The exact source collections, snapshot key -> Firestore collection. Nothing else may be read. */
const SOURCE_COLLECTIONS = Object.freeze({
  cycleCounts: "cycle_counts",
  inventoryTransactions: "inventory_transactions",
  transferOrders: "transfer_orders",
  // Widened by the Controller INVENTORY / WAREHOUSE COMPLETION RULINGS (2026-10-01) for the governed baseline COPY
  // (src/eosOps/migration/inventoryBaselineCutover.ts): serialized custody, and the warehouse masters the location
  // identity proof reads (a legacy warehouse's operatingCompanyId must equal the mapped EOS warehouse's company).
  serializedAssets: "serialized_assets",
  warehouses: "warehouses",
  equipment: "equipment",
});
const FROZEN_PROJECTS = Object.freeze(["eos-platform-certification"]);
const SNAPSHOT_FORMAT = "EOS_INVENTORY_SNAPSHOT";

function assertAllowlisted(collectionName) {
  if (!Object.values(SOURCE_COLLECTIONS).includes(collectionName)) {
    throw new Error(`REFUSED: '${collectionName}' is not an allowlisted inventory source collection.`);
  }
  return collectionName;
}

function assertExportInvocation(args) {
  const projectId = args.projectId;
  if (!projectId || projectId === "true") {
    throw new Error("--projectId is required. The source project is named, never inferred from ADC, gcloud, .firebaserc or the environment.");
  }
  if (projectId === PRODUCTION_PROJECT_ID) {
    throw new Error(`REFUSED: '${PRODUCTION_PROJECT_ID}' is production. This tool has no production mode.`);
  }
  if (FROZEN_PROJECTS.includes(projectId)) {
    throw new Error(`REFUSED: '${projectId}' is the Certification world, which is frozen.`);
  }
  const registry = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../config/environments.json"), "utf8"));
  const env = (registry.environments || []).find((e) => e && e.firebase && e.firebase.projectId === projectId);
  if (!env) throw new Error(`REFUSED: '${projectId}' is not a Firebase project declared in config/environments.json.`);
  if (env.role === "production") throw new Error(`REFUSED: '${projectId}' has role production.`);
  if (!args.out || args.out === "true") throw new Error("--out <file> is required.");
  const out = path.resolve(args.out);
  if (fs.existsSync(out) || fs.existsSync(`${out}.sha256`)) throw new Error(`REFUSED: ${out} or its .sha256 already exists; a snapshot is never overwritten.`);
  return { projectId, out };
}

/** Firestore value -> snapshot JSON. Timestamps are tagged; any other non-JSON type is refused. */
function encodeValue(value, Timestamp, where) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`UNSUPPORTED_VALUE at ${where}: non-finite number`);
    return value;
  }
  if (value instanceof Timestamp) return { $timestamp: { seconds: value.seconds, nanoseconds: value.nanoseconds } };
  if (Array.isArray(value)) return value.map((v, i) => encodeValue(v, Timestamp, `${where}[${i}]`));
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    if (Object.prototype.hasOwnProperty.call(value, "$timestamp")) throw new Error(`UNSUPPORTED_VALUE at ${where}: a stored field named $timestamp is ambiguous`);
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = encodeValue(value[key], Timestamp, `${where}.${key}`);
    return out;
  }
  throw new Error(`UNSUPPORTED_VALUE at ${where}: ${Object.prototype.toString.call(value)}`);
}

/** Write the snapshot and its checksum EXCLUSIVELY. Refuses if either already exists. Returns the sha256. */
function writeSnapshotFiles(out, text) {
  const sha256 = hash("sha256", text);
  fs.writeFileSync(out, text, { encoding: "utf8", flag: "wx", mode: 0o600 });
  fs.writeFileSync(`${out}.sha256`, `${sha256}  ${path.basename(out)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  return sha256;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // THE FENCE FIRST, before firebase-admin exists in this process.
  const { projectId, out } = assertExportInvocation(args);

  const { initializeApp, applicationDefault } = require("firebase-admin/app");
  const { getFirestore, Timestamp } = require("firebase-admin/firestore");
  const app = initializeApp({ credential: applicationDefault(), projectId }, "inventory-snapshot-export");
  const db = getFirestore(app);

  const snapshot = { format: SNAPSHOT_FORMAT, version: 1, source: { firebaseProjectId: projectId, exportedAt: new Date().toISOString() } };
  const counts = {};
  for (const [key, name] of Object.entries(SOURCE_COLLECTIONS)) {
    const docs = (await db.collection(assertAllowlisted(name)).get()).docs;
    snapshot[key] = docs
      .map((d) => ({ id: d.id, data: encodeValue(d.data(), Timestamp, `${name}/${d.id}`) }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    counts[key] = snapshot[key].length;
  }
  const sha256 = writeSnapshotFiles(out, JSON.stringify(snapshot, null, 2) + "\n");
  console.log(JSON.stringify({ projectId, out, ...counts, sha256 }, null, 2));
}

module.exports = { FIREBASE_EXIT_MIGRATION_ONLY, SOURCE_COLLECTIONS, SNAPSHOT_FORMAT, assertAllowlisted, assertExportInvocation, encodeValue, writeSnapshotFiles };

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 2;
  });
}
