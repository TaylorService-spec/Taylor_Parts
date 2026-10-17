// FIREBASE_EXIT_MIGRATION_ONLY
//
// RETURNS INTAKE SNAPSHOT EXPORT -- the one READ-ONLY Firestore step of the returns-intake copy (Firebase exit F7a, DECISIONS
// #242). Operator-run; never by CI, never on a schedule, never from the runtime. Authorized by the Owner's F7a ruling
// (2026-10-17, item 4: "prepare a READ-ONLY census ... and the copy script"), on the same conditions as the other exporters:
//
//   * READ ONLY. The only Firestore call is `collection("inventory_returns").get()`. No write verb (static test).
//   * EXACT SOURCE: `inventory_returns`, nothing else.
//   * FENCED: the project is named and declared in config/environments.json; production and the frozen Certification world are
//     refused (scripts/exportCatalogSnapshot.js assertExportInvocation, reused). A production export needs its own authorization.
//   * IMMUTABLE AND CHECKSUMMED: the snapshot and `<snapshot>.sha256` are created exclusively and never overwritten
//     (exportCatalogSnapshot.js writeSnapshotFiles, reused); scripts/returnIntakeCopy.js refuses a snapshot that disagrees.
//   * NO SECRETS IN OUTPUT. Credentials come from Application Default Credentials and are never read into the file.
//
// RETIREMENT: deleted with the Firestore returns-intake callable once the copy is verified (the ledger's F7a section).
//
// Usage:
//   node scripts/exportReturnIntakeSnapshot.js --projectId eos-platform-sandbox --out ./returns-snapshot.json
"use strict";

const { parseArgs } = require("./projectTargetGuard.js");
const { assertExportInvocation, encodeValue, writeSnapshotFiles } = require("./exportCatalogSnapshot.js");

const FIREBASE_EXIT_MIGRATION_ONLY = "FIREBASE_EXIT_MIGRATION_ONLY";
const SOURCE_COLLECTION = "inventory_returns";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // THE FENCE FIRST, before firebase-admin exists in this process.
  const { projectId, out } = assertExportInvocation(args);
  const { initializeApp, applicationDefault } = require("firebase-admin/app");
  const { getFirestore, Timestamp } = require("firebase-admin/firestore");
  const db = getFirestore(initializeApp({ credential: applicationDefault(), projectId }, "returns-snapshot-export"));
  const docs = (await db.collection(SOURCE_COLLECTION).get()).docs;
  const snapshot = {
    format: "EOS_RETURNS_SNAPSHOT", version: 1,
    source: { firebaseProjectId: projectId, exportedAt: new Date().toISOString() },
    inventoryReturns: docs
      .map((d) => ({ id: d.id, data: encodeValue(d.data(), Timestamp, `${SOURCE_COLLECTION}/${d.id}`) }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  };
  const sha256 = writeSnapshotFiles(out, JSON.stringify(snapshot, null, 2) + "\n");
  console.log(JSON.stringify({ projectId, out, inventoryReturns: snapshot.inventoryReturns.length, sha256 }, null, 2));
}

module.exports = { FIREBASE_EXIT_MIGRATION_ONLY, SOURCE_COLLECTION };

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 2;
  });
}
