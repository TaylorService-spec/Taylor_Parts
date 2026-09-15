// FIREBASE_EXIT_MIGRATION_ONLY
//
// COMMERCIAL SNAPSHOT EXPORT -- the one READ-ONLY Firestore step of Commercial C5 (the one-time Commercial data
// migration). Operator-run; never by CI, never on a schedule, never from the runtime.
//
// ============================ THE MIGRATION-ONLY EXCEPTION (Owner ruling 2026-09-14) ============================
//
// The Firebase exit program admits no new Firebase dependency. This file is the narrow exception, on these conditions,
// each enforced here or by functions/test/commercialC5Migration.test.mjs:
//
//   * READ ONLY. The only Firestore calls are `collection(name).get()`; no write verb appears in the code (static test).
//     No sync, no scheduled job, no handler, no "refresh".
//   * EXACT SOURCE ALLOWLIST: `opportunities`, `sales_agreements`, `sales_orders` -- nothing else. Not the `counters`
//     collection, not `auditEvents`, not `accounts` (SOURCE_COLLECTIONS + assertAllowlisted).
//   * NOT RUNTIME. No module under functions/src, field-ops-app-vite/src or integrations references it; it is not in
//     functions/package.json main/exports/scripts; no workflow runs or schedules it (structural test). It lives in
//     functions/scripts beside the other operator tools, which scripts/firebaseExitGuard.mjs does not scan.
//   * FENCED (before firebase-admin loads): --environment declared in config/environments.json; the project is the
//     registry's, never a --projectId; production (`taylor-parts`, role production) refused outright -- this tool has
//     no production mode and a production census needs separate Owner authorization; the Certification world
//     (`platform-certification` / `eos-platform-certification`) refused, because it is frozen.
//   * IMMUTABLE AND CHECKSUMMED: the snapshot and `<snapshot>.sha256` are created exclusively (`wx`, 0600) and never
//     overwritten; scripts/commercialC5.js refuses a snapshot whose checksum is missing or disagrees.
//   * NO SECRETS IN OUTPUT: the environment id, project id, export timestamp and the documents. Credentials come from
//     Application Default Credentials and are never read into, or written to, the output.
//   * NO FIREBASE WRITES, and it never deletes a source document -- a DISPOSABLE disposition means discard + reseed of
//     nonprod with the census preserved, never a deletion by a tool.
//
// RETIREMENT. Deleted in the same change that removes the legacy Firestore Commercial writers (C7). The exported
// snapshot and checksum are migration evidence kept with the C5 run record, not in the repo.
//
// Usage:
//   node scripts/exportCommercialSnapshot.js --environment platform-sandbox --out ./commercial-snapshot.json
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { hash } = require("node:crypto");
const { parseArgs, PRODUCTION_PROJECT_ID } = require("./projectTargetGuard.js");

/** The literal marker the migration-only exception is identified by. */
const FIREBASE_EXIT_MIGRATION_ONLY = "FIREBASE_EXIT_MIGRATION_ONLY";

/** The exact source collections, snapshot key -> Firestore collection. Nothing else may be read. */
const SOURCE_COLLECTIONS = Object.freeze({ opportunities: "opportunities", salesAgreements: "sales_agreements", salesOrders: "sales_orders" });
const FROZEN_ENVIRONMENTS = Object.freeze(["platform-certification"]);
const FROZEN_PROJECTS = Object.freeze(["eos-platform-certification"]);

function assertAllowlisted(collectionName) {
  if (!Object.values(SOURCE_COLLECTIONS).includes(collectionName)) {
    throw new Error(`REFUSED: '${collectionName}' is not an allowlisted Commercial source collection.`);
  }
  return collectionName;
}

function assertExportInvocation(args) {
  const environmentId = args.environment;
  if (!environmentId || environmentId === "true") {
    throw new Error("--environment is required (e.g. --environment platform-sandbox). The source is named from config/environments.json, never inferred from ADC, gcloud, .firebaserc or the process environment.");
  }
  if (args.projectId !== undefined) {
    throw new Error("--projectId is not accepted: the Firebase project is the one config/environments.json declares for --environment.");
  }
  if (args.confirmProduction !== undefined) {
    throw new Error("REFUSED: this tool has no production mode. A production Commercial census requires separate Owner authorization.");
  }
  if (FROZEN_ENVIRONMENTS.includes(environmentId)) throw new Error(`REFUSED: '${environmentId}' is the Certification world, which is frozen.`);
  const registry = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../config/environments.json"), "utf8"));
  const declared = (registry.environments || []).find((e) => e && e.id === environmentId);
  if (!declared) throw new Error(`REFUSED: '${environmentId}' is not an environment declared in config/environments.json.`);
  if (declared.role === "production") throw new Error(`REFUSED: '${environmentId}' has role production. This tool has no production mode.`);
  const projectId = declared.firebase && declared.firebase.projectId;
  if (!projectId) throw new Error(`REFUSED: '${environmentId}' declares no Firebase project.`);
  if (projectId === PRODUCTION_PROJECT_ID) throw new Error(`REFUSED: '${environmentId}' names the production project '${PRODUCTION_PROJECT_ID}'. This tool has no production mode.`);
  if (FROZEN_PROJECTS.includes(projectId)) throw new Error(`REFUSED: '${projectId}' is the Certification world, which is frozen.`);
  if (!args.out || args.out === "true") throw new Error("--out <file> is required.");
  const out = path.resolve(args.out);
  if (fs.existsSync(out) || fs.existsSync(`${out}.sha256`)) throw new Error(`REFUSED: ${out} or its .sha256 already exists; a snapshot is never overwritten.`);
  return { environmentId, projectId, out };
}

/** Firestore value -> snapshot JSON. Timestamps are tagged; any other non-JSON type is tagged $unsupported (the census blocks it). */
function encodeValue(value, Timestamp, where) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : { $unsupported: "NonFiniteNumber" };
  if (value instanceof Timestamp) return { $timestamp: { seconds: value.seconds, nanoseconds: value.nanoseconds } };
  if (Array.isArray(value)) return value.map((v, i) => encodeValue(v, Timestamp, `${where}[${i}]`));
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    if (Object.prototype.hasOwnProperty.call(value, "$timestamp") || Object.prototype.hasOwnProperty.call(value, "$unsupported")) {
      throw new Error(`UNSUPPORTED_VALUE at ${where}: a stored field named $timestamp or $unsupported is ambiguous`);
    }
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = encodeValue(value[key], Timestamp, `${where}.${key}`);
    return out;
  }
  const ctor = value && value.constructor && typeof value.constructor.name === "string" ? value.constructor.name : typeof value;
  return { $unsupported: ctor };
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
  const { environmentId, projectId, out } = assertExportInvocation(args);

  const { initializeApp, applicationDefault } = require("firebase-admin/app");
  const { getFirestore, Timestamp } = require("firebase-admin/firestore");
  const app = initializeApp({ credential: applicationDefault(), projectId }, "commercial-snapshot-export");
  const db = getFirestore(app);

  const snapshot = { format: "EOS_COMMERCIAL_SNAPSHOT", version: 1, source: { environmentId, firebaseProjectId: projectId, exportedAt: new Date().toISOString() } };
  for (const [key, name] of Object.entries(SOURCE_COLLECTIONS)) {
    const docs = (await db.collection(assertAllowlisted(name)).get()).docs;
    snapshot[key] = docs
      .map((d) => ({ id: d.id, data: encodeValue(d.data(), Timestamp, `${name}/${d.id}`) }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
  const sha256 = writeSnapshotFiles(out, JSON.stringify(snapshot, null, 2) + "\n");
  console.log(JSON.stringify({
    environmentId, projectId, out, sha256,
    opportunities: snapshot.opportunities.length, salesAgreements: snapshot.salesAgreements.length, salesOrders: snapshot.salesOrders.length,
  }, null, 2));
}

module.exports = { FIREBASE_EXIT_MIGRATION_ONLY, SOURCE_COLLECTIONS, assertAllowlisted, assertExportInvocation, encodeValue, writeSnapshotFiles };

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 2;
  });
}
