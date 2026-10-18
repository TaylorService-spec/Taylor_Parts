// FIREBASE_EXIT_MIGRATION_ONLY
//
// WAREHOUSE RACKING BIN SNAPSHOT EXPORT -- the one READ-ONLY Firestore step of the Firebase bin CENSUS (Firebase exit B3, DECISIONS #B3).
// Operator-run; never by CI, never on a schedule, never from the runtime. Authorized by the Owner's ruling 6 (2026-10-17): "a read-only census
// reconciled against PostgreSQL and warehouse references ... the copy stays held." Same conditions as the other exporters:
//
//   * READ ONLY. The only Firestore calls are `collection(name).get()`. No write verb (static test). NOTHING IS COPIED anywhere: the
//     snapshot is evidence for scripts/binCensus.js, not a migration source.
//   * EXACT SOURCE: `warehouses`, `bins`, `bin_code_claims`, nothing else.
//   * FENCED: the project is named and declared in config/environments.json; production and the frozen Certification world are
//     refused (scripts/exportCatalogSnapshot.js assertExportInvocation, reused). A production export needs its own authorization.
//   * IMMUTABLE AND CHECKSUMMED: the snapshot and `<snapshot>.sha256` are created exclusively and never overwritten
//     (exportCatalogSnapshot.js writeSnapshotFiles, reused).
//   * NO SECRETS IN OUTPUT. Credentials come from Application Default Credentials and are never read into the file.
//
// RETIREMENT: deleted with the Firebase bin callables once the Owner has ruled on the census (the ledger's B3 section).
//
// Usage:
//   node scripts/exportBinSnapshot.js --projectId eos-platform-sandbox --out ./bins-snapshot.json
"use strict";

const { parseArgs } = require("./projectTargetGuard.js");
const { assertExportInvocation, encodeValue, writeSnapshotFiles } = require("./exportCatalogSnapshot.js");

const FIREBASE_EXIT_MIGRATION_ONLY = "FIREBASE_EXIT_MIGRATION_ONLY";
const SOURCE_COLLECTIONS = Object.freeze({ warehouses: "warehouses", bins: "bins", binCodeClaims: "bin_code_claims" });

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // THE FENCE FIRST, before firebase-admin exists in this process.
  const { projectId, out } = assertExportInvocation(args);
  const { initializeApp, applicationDefault } = require("firebase-admin/app");
  const { getFirestore, Timestamp } = require("firebase-admin/firestore");
  const db = getFirestore(initializeApp({ credential: applicationDefault(), projectId }, "bins-snapshot-export"));
  const snapshot = {
    format: "EOS_BIN_SNAPSHOT", version: 1,
    source: { firebaseProjectId: projectId, exportedAt: new Date().toISOString() },
  };
  for (const [key, name] of Object.entries(SOURCE_COLLECTIONS)) {
    const docs = (await db.collection(name).get()).docs;
    snapshot[key] = docs
      .map((d) => ({ id: d.id, data: encodeValue(d.data(), Timestamp, `${name}/${d.id}`) }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
  const sha256 = writeSnapshotFiles(out, JSON.stringify(snapshot, null, 2) + "\n");
  console.log(JSON.stringify({ projectId, out, warehouses: snapshot.warehouses.length, bins: snapshot.bins.length, binCodeClaims: snapshot.binCodeClaims.length, sha256 }, null, 2));
}

module.exports = { FIREBASE_EXIT_MIGRATION_ONLY, SOURCE_COLLECTIONS };

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 2;
  });
}
