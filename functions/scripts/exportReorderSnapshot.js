// FIREBASE_EXIT_MIGRATION_ONLY
//
// REORDER SNAPSHOT EXPORT -- the one READ-ONLY Firestore step of the Reorder cutover. Operator-run; never by CI, never
// on a schedule, never from the runtime.
//
// ============================ THE MIGRATION-ONLY EXCEPTION (Controller ruling 2026-09-28) ============================
//
// The fenced migration-only Firebase READ exception scripts/exportCatalogSnapshot.js holds (Owner ruling 2026-09-14) is
// EXTENDED to exactly the three legacy Reorder collections, for ONE governed nonprod migration from Firebase to
// PostgreSQL. It permits only: a read-only export of allowlisted collections, in nonprod, as a checksummed snapshot,
// consumed by the governed COPY ONCE tooling (scripts/reorderCutover.js) and its verification. It authorizes NO
// Firebase write, no operational Firebase responsibility, no application or client read, no Rules authority, no
// business logic, no Firebase/EOS bridge and no production migration. Enforced here or by
// functions/test/reorderSnapshot.test.mjs and functions/test/operatorScriptEnvironmentFence.test.mjs:
//
//   * READ ONLY. The only Firestore call is `collection(name).get()`; no write verb appears in the code (static test).
//   * EXACT SOURCE ALLOWLIST: `reorder_requests`, `reorder_purchase_orders`, `reorder_purchase_order_voids`.
//   * NOT RUNTIME. No module under functions/src, field-ops-app-vite/src or integrations references it; it is not in
//     functions/package.json main/exports/scripts; no workflow runs or schedules it.
//   * FENCED BEFORE firebase-admin LOADS: the project is named and declared in config/environments.json; production
//     (`taylor-parts`) and the frozen Certification world are refused; there is no production mode.
//   * IMMUTABLE AND CHECKSUMMED: the snapshot and `<snapshot>.sha256` are created exclusively (`wx`, 0600) by the SAME
//     writer the catalog export uses; scripts/reorderCutover.js refuses a snapshot whose checksum disagrees.
//   * NO SECRETS IN OUTPUT: credentials come from Application Default Credentials and are never written.
//
// It reuses exportCatalogSnapshot.js's value encoder and exclusive writer unchanged -- this is the same pattern, not a
// second framework. Firestore Timestamps are therefore tagged `{"$timestamp":{seconds,nanoseconds}}` exactly as in the
// catalog snapshot; eosOps/migration/reorderSnapshot.ts converts that tag to an instant for the classifiers.
//
// RETIREMENT. Temporary migration tooling: deleted in the same change that retires the legacy Firestore Reorder source.
// The exported snapshot and its checksum are kept with the cutover evidence, never in the repository.
//
// Usage (inside the controlled window; the DQ-032 fixtures are excluded at COPY, never deleted):
//   node scripts/exportReorderSnapshot.js --projectId eos-platform-sandbox --out ./reorder-snapshot.json
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { parseArgs, PRODUCTION_PROJECT_ID } = require("./projectTargetGuard.js");
const { encodeValue, writeSnapshotFiles } = require("./exportCatalogSnapshot.js");

/** The literal marker the migration-only exception is identified by. */
const FIREBASE_EXIT_MIGRATION_ONLY = "FIREBASE_EXIT_MIGRATION_ONLY";

/** The exact source collections. Nothing else may be read. */
const SOURCE_COLLECTIONS = Object.freeze(["reorder_requests", "reorder_purchase_orders", "reorder_purchase_order_voids"]);
const FROZEN_PROJECTS = Object.freeze(["eos-platform-certification"]);

function assertAllowlisted(collectionName) {
  if (!SOURCE_COLLECTIONS.includes(collectionName)) {
    throw new Error(`REFUSED: '${collectionName}' is not an allowlisted Reorder source collection.`);
  }
  return collectionName;
}

function assertExportInvocation(args) {
  const projectId = args.projectId;
  if (!projectId || projectId === "true") {
    throw new Error("--projectId is required. The source project is named, never inferred from ADC, gcloud, .firebaserc or the environment.");
  }
  if (projectId === PRODUCTION_PROJECT_ID) {
    throw new Error(`REFUSED: '${PRODUCTION_PROJECT_ID}' is production. The Reorder export exception is nonprod only; this tool has no production mode.`);
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // THE FENCE FIRST, before firebase-admin exists in this process.
  const { projectId, out } = assertExportInvocation(args);

  const { initializeApp, applicationDefault } = require("firebase-admin/app");
  const { getFirestore, Timestamp } = require("firebase-admin/firestore");
  const app = initializeApp({ credential: applicationDefault(), projectId }, "reorder-snapshot-export");
  const db = getFirestore(app);

  const collections = {};
  const counts = {};
  for (const name of SOURCE_COLLECTIONS) {
    const docs = (await db.collection(assertAllowlisted(name)).get()).docs;
    collections[name] = docs
      .map((d) => ({ id: d.id, data: encodeValue(d.data(), Timestamp, `${name}/${d.id}`) }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    counts[name] = collections[name].length;
  }
  const snapshot = {
    format: "EOS_REORDER_SNAPSHOT", version: 1,
    source: { firebaseProjectId: projectId, exportedAt: new Date().toISOString() },
    counts, collections,
  };
  const sha256 = writeSnapshotFiles(out, JSON.stringify(snapshot, null, 2) + "\n");
  console.log(JSON.stringify({ projectId, out, counts, sha256 }, null, 2));
}

module.exports = { FIREBASE_EXIT_MIGRATION_ONLY, SOURCE_COLLECTIONS, assertAllowlisted, assertExportInvocation };

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 2;
  });
}
