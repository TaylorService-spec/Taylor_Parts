// FIREBASE_EXIT_MIGRATION_ONLY
//
// SECURITY ROLE ASSIGNMENT CENSUS -- the READ-ONLY first step of converging Security Role assignment authority on
// PostgreSQL eos_policy.user_role_assignments. Operator-run; never by CI, never by a schedule, never by the runtime.
//
// ============================ WHAT IT DOES ============================
//
// Reads the legacy Firestore `roleAssignments`, `users` (role + accessVersion only) and `privilegedRoleRequests`
// collections of the Firebase project the registry declares for --environment, reads the named PostgreSQL tenant's
// Roles, members, Principals and assignments, and writes ONE deterministic census evidence file
// (functions/src/adminPolicy/migration/roleAssignmentCensus.ts): legacy assignments by roleId / scope type / status,
// subjects with no Principal, Principals with no active membership, legacy roleIds with no tenant Role key,
// MIGRATION_REFUSED_UNTIL_EVALUATOR_PARITY (scoped or conditioned-role grants), the diff in both directions by
// principal + Role key + scope, each store's own qualification verdict, LEGACY_USERS_ROLE reported separately, and
// the pending privileged-role request count. It migrates nothing, repairs nothing and infers nothing.
//
// ============================ THE OWNER'S MIGRATION-ONLY EXCEPTION ============================
//
//   READ ONLY, BOTH STORES  the only Firestore call is `collection(name).get()` over the exact allowlist below. No
//                           set/add/update/delete/create/batch/transaction/bulkWriter appears in this file
//                           (roleAssignmentCensusCli.test.mjs asserts it statically). PostgreSQL is opened with
//                           default_transaction_read_only=on, so the DATABASE refuses a write, and the census core
//                           takes only the policy READ port.
//   EXACT ALLOWLIST         roleAssignments, users, privilegedRoleRequests. Nothing else is read.
//   NOT RUNTIME             nothing under functions/src, field-ops-app-vite/src or integrations imports this file.
//   ENVIRONMENT-FENCED      --environment must be declared in config/environments.json; EOS_ENVIRONMENT must read
//                           exactly `nonprod`; the Firebase project is the registry's -- never argv, ADC, gcloud,
//                           .firebaserc or env; --databaseUrlEnv names the variable holding the connection string.
//   PRODUCTION-FENCED       refused by role and by the literal production project id, with no confirmation path.
//   CERTIFICATION-FENCED    platform-certification / eos-platform-certification refused: that world is frozen.
//   EMULATOR-FENCED         FIRESTORE_EMULATOR_HOST set is refused: evidence naming a real project must not be read
//                           from an emulator.
//   CHECKSUMMED, IMMUTABLE  --out and <out>.sha256 are created exclusively (flag "wx", mode 0600); never overwritten.
//   NO SECRETS              no connection string or credential is printed or written.
//
// Every refusal happens BEFORE firebase-admin, pg or lib/ is loaded (operatorScriptEnvironmentFence.test.mjs).
//
// Usage (operator workstation or Render Shell with EOS_ENVIRONMENT=nonprod, nonprod ADC and the nonprod database):
//   EOS_ENVIRONMENT=nonprod node scripts/roleAssignmentCensusCli.js --environment platform-sandbox \
//     --databaseUrlEnv DATABASE_URL --tenantKey taylor-nonprod --out ./role-assignment-census.json
//
// Exit: 0 census written (a census is evidence, not a gate -- read its summary); 2 refused or failed.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { assertMeasurementTarget, parseArgs, PRODUCTION_PROJECT_ID } = require("./measureEmployeeReferenceIntegrity.js");
const { assertNonprodRuntime } = require("./measureWorkforceActivation.js");

const MIGRATION_ONLY_MARKER = "FIREBASE_EXIT_MIGRATION_ONLY";
/** The exact Firestore allowlist. */
const LEGACY_COLLECTIONS = Object.freeze(["privilegedRoleRequests", "roleAssignments", "users"]);
const FROZEN_ENVIRONMENTS = Object.freeze(["platform-certification"]);
const FROZEN_PROJECTS = Object.freeze(["eos-platform-certification"]);
const EVIDENCE_FORMAT = "EOS_ROLE_ASSIGNMENT_CENSUS_EVIDENCE";

/** Every refusal decidable from argv, the registry and the process environment. No client, no lib/. */
function assertCensusInvocation(args, env) {
  if (args.projectId !== undefined) {
    throw new Error("--projectId is not accepted: the Firebase project is the one config/environments.json declares for --environment.");
  }
  if (FROZEN_ENVIRONMENTS.includes(args.environment)) {
    throw new Error(`REFUSED: --environment '${args.environment}' is the Certification world, which is frozen.`);
  }
  const { environmentId, connectionString } = assertMeasurementTarget(args, env);
  assertNonprodRuntime(env);
  const registry = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../config/environments.json"), "utf8"));
  const declared = (registry.environments || []).find((e) => e && e.id === environmentId);
  const projectId = declared && declared.firebase && declared.firebase.projectId;
  if (!projectId) throw new Error(`REFUSED: '${environmentId}' declares no Firebase project.`);
  if (projectId === PRODUCTION_PROJECT_ID) throw new Error(`REFUSED: '${environmentId}' names the production project. This tool has no production mode.`);
  if (FROZEN_PROJECTS.includes(projectId)) throw new Error(`REFUSED: '${projectId}' is the Certification world, which is frozen.`);
  if (env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("REFUSED: FIRESTORE_EMULATOR_HOST is set. Census evidence naming a real project is never read from an emulator.");
  }
  if (!args.tenantKey || args.tenantKey === "true") throw new Error("--tenantKey is required: the tenant is named, never inferred.");
  if (!args.out || args.out === "true") throw new Error("--out <file> is required.");
  const out = path.resolve(args.out);
  if (fs.existsSync(out) || fs.existsSync(`${out}.sha256`)) {
    throw new Error(`REFUSED: ${out} (or its .sha256) already exists; census evidence is never overwritten.`);
  }
  return { environmentId, projectId, connectionString, tenantKey: args.tenantKey, out };
}

/** One allowlisted collection, read once. The only Firestore call in this file. */
async function readCollection(db, name) {
  if (!LEGACY_COLLECTIONS.includes(name)) throw new Error(`${name} is not in the census allowlist`);
  const snapshot = await db.collection(name).get();
  return snapshot.docs;
}

/**
 * The legacy reader over a Firestore handle. Only the fields the census consults leave this function: a user
 * profile contributes `role` and `accessVersion`, a privileged request its `status`, and nothing else.
 */
function createFirestoreLegacyReader(db) {
  const pick = (data, keys) => {
    const out = {};
    for (const key of keys) if (Object.prototype.hasOwnProperty.call(data, key)) out[key] = data[key];
    return out;
  };
  const plain = (docs, keys) => docs.map((d) => ({ id: d.id, data: keys ? pick(d.data(), keys) : d.data() }));
  return {
    listRoleAssignmentDocuments: async () =>
      plain(await readCollection(db, "roleAssignments"), ["principalUid", "roleId", "scope", "status", "accessVersionAtGrant"]),
    listUserProfileDocuments: async () => plain(await readCollection(db, "users"), ["role", "accessVersion"]),
    listPrivilegedRoleRequestDocuments: async () => plain(await readCollection(db, "privilegedRoleRequests"), ["status"]),
  };
}

/** A PostgreSQL pool whose every transaction is READ ONLY at the database. Loaded after the fence. */
function openReadOnlyPolicyPool(connectionString) {
  const pg = require("pg");
  const { resolvePolicyDatabaseConfig } = require("../lib/adminPolicy/policyDatabase.js");
  return new pg.Pool({ ...resolvePolicyDatabaseConfig({ connectionString, max: 2 }), options: "-c default_transaction_read_only=on" });
}

function writeEvidence(out, document) {
  const text = JSON.stringify(document, null, 2) + "\n";
  const sha256 = createHash("sha256").update(text).digest("hex");
  fs.writeFileSync(out, text, { encoding: "utf8", flag: "wx", mode: 0o600 });
  fs.writeFileSync(`${out}.sha256`, `${sha256}  ${path.basename(out)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  return sha256;
}

async function main() {
  // THE FENCE FIRST, before firebase-admin, pg or lib/ exists in this process.
  const options = assertCensusInvocation(parseArgs(process.argv.slice(2)), process.env);

  const { initializeApp, applicationDefault } = require("firebase-admin/app");
  const { getFirestore } = require("firebase-admin/firestore");
  const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");
  const { buildRoleAssignmentCensus, describeRoleAssignmentCensus } = require("../lib/adminPolicy/migration/roleAssignmentCensus.js");

  const app = initializeApp({ credential: applicationDefault(), projectId: options.projectId }, "role-assignment-census");
  const pool = openReadOnlyPolicyPool(options.connectionString);
  try {
    const census = await buildRoleAssignmentCensus({
      legacy: createFirestoreLegacyReader(getFirestore(app)),
      policy: new PostgresPolicyRepository(pool),
      tenantKey: options.tenantKey,
    });
    const evidenceSha256 = writeEvidence(options.out, {
      format: EVIDENCE_FORMAT,
      version: 1,
      marker: MIGRATION_ONLY_MARKER,
      source: { environmentId: options.environmentId, firebaseProjectId: options.projectId, tenantKey: options.tenantKey },
      generatedAt: new Date().toISOString(),
      census,
    });
    console.error(describeRoleAssignmentCensus(census));
    console.log(JSON.stringify({
      marker: MIGRATION_ONLY_MARKER, environmentId: options.environmentId, projectId: options.projectId,
      tenantKey: options.tenantKey, out: options.out, reportSha256: census.reportSha256, evidenceSha256, summary: census.summary,
    }, null, 2));
  } finally {
    await pool.end();
  }
}

module.exports = {
  assertCensusInvocation, createFirestoreLegacyReader, openReadOnlyPolicyPool, LEGACY_COLLECTIONS, MIGRATION_ONLY_MARKER,
};

if (require.main === module) {
  main().catch((err) => {
    console.error(JSON.stringify({ outcome: "REFUSED_OR_FAILED", message: err instanceof Error ? err.message : String(err) }, null, 2));
    process.exitCode = 2;
  });
}
