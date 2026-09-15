// CATALOG SNAPSHOT EXPORT -- the one READ-ONLY Firestore step of the catalog cutover. Operator-run; never by CI.
//
// ============================ WHAT THIS IS ============================
//
// Reads every document of the two legacy catalog collections, `parts` and `equipment_models`, from ONE named
// non-production Firebase project, and writes them verbatim to an EOS_CATALOG_SNAPSHOT file
// (functions/src/catalogMaster/catalogSnapshot.ts documents the format). scripts/catalogCutover.js consumes that
// file; it never reads Firestore itself, so the PostgreSQL half of the cutover loads no Firebase module at all.
//
// WHY A NEW SCRIPT READS FIRESTORE. The Firebase exit guard (scripts/firebaseExitGuard.mjs) fences the business
// runtime roots -- functions/src, field-ops-app-vite/src, integrations -- and not functions/scripts, where every
// existing Firestore operator tool lives (extractProductionFixtures.mjs, _releaseStateSnapshot.mjs, ...). Reading the
// legacy source ONCE to retire it is the exit, not a new runtime dependency; it is still kept to one small file
// that nothing in the runtime imports. No existing export path fits: extractProductionFixtures.mjs is
// production-only, bounded and SANITIZING (it rewrites values), and a copy must be exact.
//
// ============================ READ ONLY, NARROWLY ============================
//
// The only Firestore calls are `collection(name).get()` for the two names above. No set/add/update/delete/create/
// batch/transaction/bulkWriter appears in this file; functions/test/catalogCutover.test.mjs asserts that statically.
// The source is never deleted, marked or modified.
//
// ============================ THE FENCE ============================
//
// Refuses, BEFORE firebase-admin is loaded (operatorScriptEnvironmentFence.test.mjs):
//   * no --projectId (never inferred from ADC, gcloud, .firebaserc or env)
//   * the production project `taylor-parts` -- ALWAYS, confirmation or not. A production catalog export is a
//     production data read that requires separate authorization (catalog-cutover-plan.md §6); this tool has no
//     production mode.
//   * eos-platform-certification (the Certification world is frozen)
//   * a project not declared in config/environments.json
//   * no --out, or an --out file that already exists (a snapshot is never overwritten)
//
// Usage:
//   node scripts/exportCatalogSnapshot.js --projectId eos-platform-sandbox --out ./catalog-snapshot.json
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { hash } = require("node:crypto");
const { parseArgs, PRODUCTION_PROJECT_ID } = require("./projectTargetGuard.js");

const COLLECTIONS = Object.freeze({ parts: "parts", equipmentModels: "equipment_models" });
const FROZEN_PROJECTS = Object.freeze(["eos-platform-certification"]);

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
  if (fs.existsSync(out)) throw new Error(`REFUSED: ${out} already exists; a snapshot is never overwritten.`);
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // THE FENCE FIRST, before firebase-admin exists in this process.
  const { projectId, out } = assertExportInvocation(args);

  const { initializeApp, applicationDefault } = require("firebase-admin/app");
  const { getFirestore, Timestamp } = require("firebase-admin/firestore");
  const app = initializeApp({ credential: applicationDefault(), projectId }, "catalog-snapshot-export");
  const db = getFirestore(app);

  const snapshot = { format: "EOS_CATALOG_SNAPSHOT", version: 1, source: { firebaseProjectId: projectId, exportedAt: new Date().toISOString() } };
  for (const [key, name] of Object.entries(COLLECTIONS)) {
    const docs = (await db.collection(name).get()).docs;
    snapshot[key] = docs
      .map((d) => ({ id: d.id, data: encodeValue(d.data(), Timestamp, `${name}/${d.id}`) }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
  const text = JSON.stringify(snapshot, null, 2) + "\n";
  fs.writeFileSync(out, text, { encoding: "utf8", flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({
    projectId, out, parts: snapshot.parts.length, equipmentModels: snapshot.equipmentModels.length,
    sha256: hash("sha256", text),
  }, null, 2));
}

module.exports = { assertExportInvocation, encodeValue, COLLECTIONS };

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 2;
  });
}
