// FIREBASE_EXIT_MIGRATION_ONLY
//
// WORK ORDER SNAPSHOT EXPORT -- the one READ-ONLY Firestore step of the Work Order domain cutover (Controller
// "WORK ORDER DOMAIN CUTOVER AUTHORIZATION", DQ-S2, 2026-09-30). Operator-run; never by CI, a schedule or the runtime.
//
// The same bounded migration-only exception as scripts/exportCrmSnapshot.js, held to the same terms:
//   READ ONLY, EXPORT ONLY   the only Firestore calls are `collection(name).get()`; no write of any kind.
//   EXACT ALLOWLIST          fieldops_wos (the legacy Work Orders) and fieldops_technicians (the legacy technician roster,
//                            needed only to INTERPRET a Work Order's assignment). Nothing else is read -- not employees,
//                            not accounts, not sales orders: customers and people are resolved against EOS/PostgreSQL.
//   NOT RUNTIME              no runtime module imports this file; it exports no callable/handler; it is not scheduled.
//   ENVIRONMENT-FENCED       --environment from config/environments.json; EOS_ENVIRONMENT exactly `nonprod`.
//   PRODUCTION-FENCED        refused by role and by the literal production project id; no confirmation path.
//   CERTIFICATION-FENCED     the frozen Certification world is refused.
//   CHECKSUMMED, IMMUTABLE   --out and <out>.sha256 are created exclusively (0600); never overwritten.
//   QUIESCENCE-PROVABLE      sourceDataSha256 hashes only the two collection payloads; --expectSourceDataSha256 re-proves it.
//
// Usage: EOS_ENVIRONMENT=nonprod node scripts/exportWorkOrderSnapshot.js --environment platform-sandbox --out ./wo-snapshot.json
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { hash } = require("node:crypto");
const { parseArgs, PRODUCTION_PROJECT_ID } = require("./projectTargetGuard.js");

const MIGRATION_ONLY_MARKER = "FIREBASE_EXIT_MIGRATION_ONLY";
/** The exact allowlist. Snapshot key === Firestore collection name. */
const COLLECTIONS = Object.freeze(["fieldops_wos", "fieldops_technicians"]);
const FROZEN_ENVIRONMENTS = Object.freeze(["platform-certification"]);
const FROZEN_PROJECTS = Object.freeze(["eos-platform-certification"]);
const NONPROD_LABEL = "nonprod";
const SHA256_HEX = /^[0-9a-f]{64}$/i;

function assertExportInvocation(args, env) {
  const environmentId = args.environment;
  if (!environmentId || environmentId === "true") {
    throw new Error("--environment is required (e.g. --environment platform-sandbox). The source is named from config/environments.json, never inferred.");
  }
  if (args.projectId !== undefined) {
    throw new Error("--projectId is not accepted: the Firebase project is the one config/environments.json declares for --environment.");
  }
  if (env.EOS_ENVIRONMENT !== NONPROD_LABEL) {
    throw new Error(`EOS_ENVIRONMENT must read exactly '${NONPROD_LABEL}' (it reads ${env.EOS_ENVIRONMENT ? `'${env.EOS_ENVIRONMENT}'` : "nothing"}). The Work Order snapshot export runs only where nonprod is positively identified.`);
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

  const expectedSourceDataSha256 = args.expectSourceDataSha256;
  if (expectedSourceDataSha256 !== undefined
    && (expectedSourceDataSha256 === "true" || !SHA256_HEX.test(expectedSourceDataSha256))) {
    throw new Error("--expectSourceDataSha256 must be exactly 64 hexadecimal characters.");
  }

  return {
    environmentId,
    projectId,
    out,
    expectedSourceDataSha256: expectedSourceDataSha256 ? expectedSourceDataSha256.toLowerCase() : null,
  };
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

/**
 * Digest only the bounded Work Order source payload. export timestamp / output path are intentionally excluded so repeated
 * reads of an unchanged source produce the same digest. The exporter already sorts documents by id and stored map keys
 * in encodeValue, making this deterministic for snapshots produced by this tool.
 */
function sourceDataDigest(snapshot) {
  const payload = {};
  for (const name of COLLECTIONS) {
    if (!Array.isArray(snapshot[name])) throw new Error(`sourceDataDigest requires snapshot.${name} to be a list`);
    payload[name] = snapshot[name];
  }
  return hash("sha256", JSON.stringify(payload));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // THE FENCE FIRST, before firebase-admin exists in this process.
  const { environmentId, projectId, out, expectedSourceDataSha256 } = assertExportInvocation(args, process.env);

  const { initializeApp, applicationDefault } = require("firebase-admin/app");
  const { getFirestore, Timestamp } = require("firebase-admin/firestore");
  const app = initializeApp({ credential: applicationDefault(), projectId }, "work-order-snapshot-export");
  const db = getFirestore(app);

  const snapshot = {
    format: "EOS_WORK_ORDER_SNAPSHOT",
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

  const sourceDataSha256 = sourceDataDigest(snapshot);
  if (expectedSourceDataSha256 && sourceDataSha256 !== expectedSourceDataSha256) {
    throw new Error(`SOURCE_DRIFT: live Work Order source digest ${sourceDataSha256} does not match expected ${expectedSourceDataSha256}; no snapshot file was written.`);
  }

  const text = JSON.stringify(snapshot, null, 2) + "\n";
  const sha256 = hash("sha256", text);
  fs.writeFileSync(out, text, { encoding: "utf8", flag: "wx", mode: 0o600 });
  fs.writeFileSync(`${out}.sha256`, `${sha256}  ${path.basename(out)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({
    marker: MIGRATION_ONLY_MARKER, environmentId, projectId, out,
    workOrders: snapshot.fieldops_wos.length, technicians: snapshot.fieldops_technicians.length,
    sha256, sourceDataSha256, quiescence: expectedSourceDataSha256 ? "MATCH" : "BASELINE",
  }, null, 2));
}

module.exports = { assertExportInvocation, encodeValue, sourceDataDigest, COLLECTIONS, MIGRATION_ONLY_MARKER };

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 2;
  });
}
