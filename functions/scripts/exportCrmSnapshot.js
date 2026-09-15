// FIREBASE_EXIT_MIGRATION_ONLY
//
// CRM SNAPSHOT EXPORT -- the one READ-ONLY Firestore step of the CRM cutover (docs/architecture/crm-cutover-plan.md).
// Operator-run; never by CI, never by a schedule, never by the runtime.
//
// ============================ THE OWNER'S MIGRATION-ONLY EXCEPTION ============================
//
// The Firebase exit forbids new Firebase dependencies. This file is the Owner's single, bounded exception for the CRM
// cutover, and it is held to every term of that exception:
//
//   READ ONLY, EXPORT ONLY   the only Firestore calls are `collection(name).get()`. No set/add/update/delete/create/
//                            batch/transaction/bulkWriter appears in this file (crmCutover.test.mjs asserts it
//                            statically). The source is never deleted, marked or modified.
//   EXACT ALLOWLIST          accounts, contacts, locations. Nothing else is read, and the snapshot carries nothing else.
//   NOT RUNTIME              nothing under functions/src, field-ops-app-vite/src or integrations imports this file
//                            (structural test), it exports no callable/HTTP handler, and it is not reachable from a
//                            client or the Render API. It is not scheduled and it does not sync.
//   ENVIRONMENT-FENCED       --environment must be declared in config/environments.json, EOS_ENVIRONMENT must read
//                            exactly `nonprod`, and the Firebase project is taken from the registry -- never from
//                            argv, ADC, gcloud, .firebaserc or env.
//   PRODUCTION-FENCED        refused by role and by the literal production project id, with no confirmation path.
//   CERTIFICATION-FENCED     platform-certification / eos-platform-certification refused: that world is frozen.
//   CHECKSUMMED, IMMUTABLE   --out and <out>.sha256 are created exclusively (flag "wx", mode 0600); an existing file is
//                            never overwritten.
//   NO SECRETS               no credential is read from argv or written to output; ADC is used by firebase-admin only.
//
// Every refusal happens BEFORE firebase-admin is loaded (functions/test/operatorScriptEnvironmentFence.test.mjs).
//
// Usage (operator workstation or Render Shell with EOS_ENVIRONMENT=nonprod and nonprod ADC):
//   EOS_ENVIRONMENT=nonprod node scripts/exportCrmSnapshot.js --environment platform-sandbox --out ./crm-snapshot.json
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { hash } = require("node:crypto");
const { parseArgs, PRODUCTION_PROJECT_ID } = require("./projectTargetGuard.js");

const MIGRATION_ONLY_MARKER = "FIREBASE_EXIT_MIGRATION_ONLY";
/** The exact allowlist. Snapshot key === Firestore collection name. */
const COLLECTIONS = Object.freeze(["accounts", "contacts", "locations"]);
const FROZEN_ENVIRONMENTS = Object.freeze(["platform-certification"]);
const FROZEN_PROJECTS = Object.freeze(["eos-platform-certification"]);
const NONPROD_LABEL = "nonprod";

function assertExportInvocation(args, env) {
  const environmentId = args.environment;
  if (!environmentId || environmentId === "true") {
    throw new Error("--environment is required (e.g. --environment platform-sandbox). The source is named from config/environments.json, never inferred.");
  }
  if (args.projectId !== undefined) {
    throw new Error("--projectId is not accepted: the Firebase project is the one config/environments.json declares for --environment.");
  }
  if (env.EOS_ENVIRONMENT !== NONPROD_LABEL) {
    throw new Error(`EOS_ENVIRONMENT must read exactly '${NONPROD_LABEL}' (it reads ${env.EOS_ENVIRONMENT ? `'${env.EOS_ENVIRONMENT}'` : "nothing"}). The CRM snapshot export runs only where nonprod is positively identified.`);
  }
  if (FROZEN_ENVIRONMENTS.includes(environmentId)) {
    throw new Error(`REFUSED: '${environmentId}' is the Certification world, which is frozen.`);
  }
  const registry = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../config/environments.json"), "utf8"));
  const declared = (registry.environments || []).find((e) => e && e.id === environmentId);
  if (!declared) throw new Error(`REFUSED: '${environmentId}' is not an environment declared in config/environments.json.`);
  if (declared.role === "production") throw new Error(`REFUSED: '${environmentId}' has role production. This tool has no production mode.`);
  const projectId = declared.firebase && declared.firebase.projectId;
  if (!projectId) throw new Error(`REFUSED: '${environmentId}' declares no Firebase project.`);
  if (projectId === PRODUCTION_PROJECT_ID) {
    throw new Error(`REFUSED: '${environmentId}' names the production project '${PRODUCTION_PROJECT_ID}'. A production export requires separate Owner authorization; this tool has no production mode.`);
  }
  if (FROZEN_PROJECTS.includes(projectId)) throw new Error(`REFUSED: '${projectId}' is the Certification world, which is frozen.`);
  if (!args.out || args.out === "true") throw new Error("--out <file> is required.");
  const out = path.resolve(args.out);
  if (fs.existsSync(out) || fs.existsSync(`${out}.sha256`)) throw new Error(`REFUSED: ${out} (or its .sha256) already exists; a snapshot is never overwritten.`);
  return { environmentId, projectId, out };
}

/**
 * Firestore value -> snapshot JSON. Timestamps are tagged { $timestamp }; any other non-JSON Firestore type (GeoPoint,
 * DocumentReference, Bytes, ...) is tagged { $unsupported: <type> } so the census reports it against its document
 * rather than the export failing opaquely. A stored map that already uses a tag key is ambiguous and refused.
 */
function encodeValue(value, Timestamp, where) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return { $unsupported: "NonFiniteNumber" };
    return value;
  }
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // THE FENCE FIRST, before firebase-admin exists in this process.
  const { environmentId, projectId, out } = assertExportInvocation(args, process.env);

  const { initializeApp, applicationDefault } = require("firebase-admin/app");
  const { getFirestore, Timestamp } = require("firebase-admin/firestore");
  const app = initializeApp({ credential: applicationDefault(), projectId }, "crm-snapshot-export");
  const db = getFirestore(app);

  const snapshot = {
    format: "EOS_CRM_SNAPSHOT",
    version: 1,
    exporter: MIGRATION_ONLY_MARKER,
    source: { environmentId, firebaseProjectId: projectId, exportedAt: new Date().toISOString() },
  };
  for (const name of COLLECTIONS) {
    const docs = (await db.collection(name).get()).docs;
    snapshot[name] = docs
      .map((d) => ({ id: d.id, data: encodeValue(d.data(), Timestamp, `${name}/${d.id}`) }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
  const text = JSON.stringify(snapshot, null, 2) + "\n";
  const sha256 = hash("sha256", text);
  fs.writeFileSync(out, text, { encoding: "utf8", flag: "wx", mode: 0o600 });
  fs.writeFileSync(`${out}.sha256`, `${sha256}  ${path.basename(out)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({
    marker: MIGRATION_ONLY_MARKER, environmentId, projectId, out,
    accounts: snapshot.accounts.length, contacts: snapshot.contacts.length, locations: snapshot.locations.length, sha256,
  }, null, 2));
}

module.exports = { assertExportInvocation, encodeValue, COLLECTIONS, MIGRATION_ONLY_MARKER };

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 2;
  });
}
