// FIREBASE_EXIT_MIGRATION_ONLY
//
// CATALOG SNAPSHOT EXPORT -- the one READ-ONLY Firestore step of the catalog cutover. Operator-run; never by CI,
// never on a schedule, never from the runtime.
//
// ============================ THE MIGRATION-ONLY EXCEPTION (Owner ruling 2026-09-14) ============================
//
// The Firebase exit program admits no new Firebase dependency. This file is the one exception, and only on these
// conditions, each enforced here or by functions/test/catalogMaster.test.mjs:
//
//   * READ ONLY, SOURCE-EXPORT PURPOSE ONLY. The only Firestore calls are `collection(name).get()`; no write verb
//     appears in the code (static test). No sync, no scheduled job, no second run that "refreshes" anything.
//   * EXACT SOURCE ALLOWLIST: `parts` and `equipment_models`, nothing else (SOURCE_COLLECTIONS + assertAllowlisted).
//   * NOT RUNTIME. No module under functions/src, field-ops-app-vite/src or integrations references it; it is not in
//     functions/package.json main/exports/scripts; no workflow runs it or schedules it (structural test). It lives in
//     functions/scripts beside the other operator tools, which scripts/firebaseExitGuard.mjs does not scan.
//   * FENCED: environment named and declared in config/environments.json; production (`taylor-parts`) refused
//     outright -- a production export needs separate Owner authorization and this tool has no production mode;
//     the Certification world (`eos-platform-certification`) refused, because it is frozen.
//   * IMMUTABLE AND CHECKSUMMED: the snapshot and `<snapshot>.sha256` are created exclusively (`wx`, 0600) and never
//     overwritten; scripts/catalogCutover.js refuses a snapshot whose checksum disagrees.
//   * NO SECRETS IN OUTPUT: the file carries the source project id, an export timestamp and the documents. Credentials
//     come from Application Default Credentials and are never read into, or written to, the output.
//
// RETIREMENT. docs/architecture/firebase-exit-manifest.json defines the end states: migrationState CUTOVER ("the
// Firebase path is inert in the live runtime") then RETIRED ("removed from source"), and disposition RETIRE ("no
// ongoing purpose and is deleted rather than migrated"). This exporter is deleted in the same change that removes
// the legacy Firestore catalog writers (catalog-cutover-plan.md §5 step 10). The exported snapshot and its checksum
// are the ARCHIVE ("captured as read-only evidence/history") and are kept with the cutover evidence, not in the repo.
//
// WHY A SEPARATE FILE. No existing export fits: extractProductionFixtures.mjs is production-only, bounded and
// SANITIZING (it rewrites values), and a copy must be exact. Keeping the Firestore read here keeps
// scripts/catalogCutover.js free of every Firebase module.
//
// Usage:
//   node scripts/exportCatalogSnapshot.js --projectId eos-platform-sandbox --out ./catalog-snapshot.json
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { hash } = require("node:crypto");
const { parseArgs, PRODUCTION_PROJECT_ID } = require("./projectTargetGuard.js");

/** The literal marker the migration-only exception is identified by. */
const FIREBASE_EXIT_MIGRATION_ONLY = "FIREBASE_EXIT_MIGRATION_ONLY";

/** The exact source collections, snapshot key -> Firestore collection. Nothing else may be read. */
const SOURCE_COLLECTIONS = Object.freeze({ parts: "parts", equipmentModels: "equipment_models" });
const FROZEN_PROJECTS = Object.freeze(["eos-platform-certification"]);

function assertAllowlisted(collectionName) {
  if (!Object.values(SOURCE_COLLECTIONS).includes(collectionName)) {
    throw new Error(`REFUSED: '${collectionName}' is not an allowlisted catalog source collection.`);
  }
  return collectionName;
}

function assertExportInvocation(args) {
  const projectId = args.projectId;
  if (!projectId || projectId === "true") {
    throw new Error("--projectId is required. The source project is named, never inferred from ADC, gcloud, .firebaserc or the environment.");
  }
  if (projectId === PRODUCTION_PROJECT_ID) {
    throw new Error(`REFUSED: '${PRODUCTION_PROJECT_ID}' is production. A production catalog export requires separate authorization; this tool has no production mode.`);
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
  const app = initializeApp({ credential: applicationDefault(), projectId }, "catalog-snapshot-export");
  const db = getFirestore(app);

  const snapshot = { format: "EOS_CATALOG_SNAPSHOT", version: 1, source: { firebaseProjectId: projectId, exportedAt: new Date().toISOString() } };
  for (const [key, name] of Object.entries(SOURCE_COLLECTIONS)) {
    const docs = (await db.collection(assertAllowlisted(name)).get()).docs;
    snapshot[key] = docs
      .map((d) => ({ id: d.id, data: encodeValue(d.data(), Timestamp, `${name}/${d.id}`) }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
  const sha256 = writeSnapshotFiles(out, JSON.stringify(snapshot, null, 2) + "\n");
  console.log(JSON.stringify({ projectId, out, parts: snapshot.parts.length, equipmentModels: snapshot.equipmentModels.length, sha256 }, null, 2));
}

module.exports = { FIREBASE_EXIT_MIGRATION_ONLY, SOURCE_COLLECTIONS, assertAllowlisted, assertExportInvocation, encodeValue, writeSnapshotFiles };

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 2;
  });
}
