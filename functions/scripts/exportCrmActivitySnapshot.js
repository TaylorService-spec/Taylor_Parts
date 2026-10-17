// FIREBASE_EXIT_MIGRATION_ONLY
//
// CRM ACTIVITY SNAPSHOT EXPORT -- the one READ-ONLY Firestore step of the CRM-activity copy (Firebase exit F7b, DECISIONS
// #243). Operator-run; never by CI, never on a schedule, never from the runtime. Prepared under the Controller's F7b decision
// (Owner preserve-functionality rule: "a read-only census script and a copy script, the copy only on the Owner's go-ahead"):
//
//   * READ ONLY. The only Firestore call is `collection("crm_activities").get()`. No write verb (static test).
//   * EXACT SOURCE: `crm_activities`, nothing else.
//   * FENCED: the project is named and declared in config/environments.json; production and the frozen Certification world are
//     refused (scripts/exportCatalogSnapshot.js assertExportInvocation, reused).
//   * IMMUTABLE AND CHECKSUMMED (exportCatalogSnapshot.js writeSnapshotFiles, reused); scripts/crmActivityCopy.js refuses a
//     snapshot that disagrees with its `.sha256`.
//
// Usage:
//   node scripts/exportCrmActivitySnapshot.js --projectId eos-platform-sandbox --out ./crm-activity-snapshot.json
"use strict";

const { parseArgs } = require("./projectTargetGuard.js");
const { assertExportInvocation, encodeValue, writeSnapshotFiles } = require("./exportCatalogSnapshot.js");

const FIREBASE_EXIT_MIGRATION_ONLY = "FIREBASE_EXIT_MIGRATION_ONLY";
const SOURCE_COLLECTION = "crm_activities";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // THE FENCE FIRST, before firebase-admin exists in this process.
  const { projectId, out } = assertExportInvocation(args);
  const { initializeApp, applicationDefault } = require("firebase-admin/app");
  const { getFirestore, Timestamp } = require("firebase-admin/firestore");
  const db = getFirestore(initializeApp({ credential: applicationDefault(), projectId }, "crm-activity-snapshot-export"));
  const docs = (await db.collection(SOURCE_COLLECTION).get()).docs;
  const snapshot = {
    format: "EOS_CRM_ACTIVITY_SNAPSHOT", version: 1,
    source: { firebaseProjectId: projectId, exportedAt: new Date().toISOString() },
    crmActivities: docs
      .map((d) => ({ id: d.id, data: encodeValue(d.data(), Timestamp, `${SOURCE_COLLECTION}/${d.id}`) }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  };
  const sha256 = writeSnapshotFiles(out, JSON.stringify(snapshot, null, 2) + "\n");
  console.log(JSON.stringify({ projectId, out, crmActivities: snapshot.crmActivities.length, sha256 }, null, 2));
}

module.exports = { FIREBASE_EXIT_MIGRATION_ONLY, SOURCE_COLLECTION };

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 2;
  });
}
