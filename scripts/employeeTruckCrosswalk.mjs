#!/usr/bin/env node
// P1B — EMPLOYEE / TRUCK / MOBILE CROSSWALK. The operator entry point.
//
// Reads legacy Firestore and emits the deterministic crosswalk evidence document produced by
// scripts/employeeTruckCrosswalk.lib.mjs.
//
// ============================ WHY IT LIVES HERE AND NOT IN functions/src ============================
//
// This is MIGRATION EVIDENCE TOOLING with a finite life, and it reads Firestore. Putting it under
// functions/src would add `firebase-admin/firestore` to a new file inside the Firebase Exit Guard's
// `server.firebase_admin_firestore` scan root (scripts/firebaseExitGuard.mjs), which would either
// fail the guard or force a baseline addition — and the baseline may only shrink. Repo-root
// scripts/ is outside every scan root, so the Firebase Exit baseline does not grow by one line for
// a tool that is meant to be deleted.
//
// firebase-admin is resolved from functions/node_modules via createRequire, because the repo root
// deliberately has no package.json and no node_modules. Nothing new is installed anywhere.
//
// ============================ READ-ONLY PROOF ============================
//
// The COMPLETE Firestore surface this script touches is FIRESTORE_METHODS_USED below: app init,
// getFirestore, collection().get(), and reading snapshot.docs / doc.id / doc.data(). No set, add,
// update, delete, batch, BulkWriter, runTransaction or FieldValue mutation is imported or called —
// grep this file for any of them and you will find them only in this sentence. The analyzer it
// calls is pure. `--out` writes ONE local file; it never writes Firestore.
//
// ============================ THE EVIDENCE ARTIFACT IS TENANT DATA ============================
//
// A crosswalk names real employees, real Firebase UIDs and real principals. It is NEVER committed.
// The `--out` path is therefore REQUIRED to end in `.local.json`, which the repo's .gitignore
// already excludes globally (`*.local.json`) — so the artifact cannot be added by accident even
// when an operator writes it into the working tree. No artifact is produced unless an operator runs
// this command; nothing is generated at test time.
//
// ============================ USAGE ============================
//
//   node scripts/employeeTruckCrosswalk.mjs --projectId <id> \
//     [--config config/ownership/operating-company-roots.sandbox.json] \
//     [--principals <path-to-eos_policy.principals-export.json>] \
//     [--out evidence/employee-truck-crosswalk.local.json] [--format json|text]
//
//   The production project additionally requires an exact `--confirmProduction taylor-parts`,
//   checked BEFORE any app is initialized. Merging this tool authorizes no production run.
//
//   exit 0  — crosswalk produced, migrationReadiness PROCEED
//   exit 3  — crosswalk produced, migrationReadiness REFUSE (MISSING_OPERATING_COMPANY_MAPPING
//             and/or CONFLICTING_OPERATING_COMPANY_CONFIGURATION). R5: unknown company refuses.
//   exit 1  — invalid invocation
//   exit 2  — technical read failure

import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import {
  COLLECTIONS,
  buildCrosswalk,
  emptyOperatingCompanyConfig,
  formatCrosswalkText,
  loadOperatingCompanyConfig,
  MIGRATION_READINESS,
  OPERATING_COMPANY_ROOTS_SANDBOX,
} from "./employeeTruckCrosswalk.lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");

export const PRODUCTION_PROJECT_ID = "taylor-parts";

/** The exact, complete Firestore surface. Exported so a test can assert it and a reviewer can
 *  check it against the source without a fragile grep. All read-only. */
export const FIRESTORE_METHODS_USED = Object.freeze([
  "initializeApp",
  "getFirestore",
  "collection().get()",
  "QuerySnapshot.docs",
  "QueryDocumentSnapshot.id",
  "QueryDocumentSnapshot.data()",
]);

/** Read in this order; the analyzer needs all six. */
export const COLLECTIONS_READ = Object.freeze([
  COLLECTIONS.EMPLOYEES,
  COLLECTIONS.USERS,
  COLLECTIONS.TECHNICIANS,
  COLLECTIONS.TRUCKS,
  COLLECTIONS.MOBILE_LOCATIONS,
  COLLECTIONS.LOCATION_TRUCK_CLAIMS,
]);

export const EVIDENCE_SUFFIX = ".local.json";

export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) throw new Error(`unexpected argument ${JSON.stringify(token)}`);
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) throw new Error(`--${key} requires a value`);
    args[key] = next;
    i += 1;
  }
  return args;
}

/**
 * Validate an invocation without performing it. Pure, so the guard rails (production confirmation,
 * evidence-path suffix) are provable in a test with no credentials and no network.
 */
export function validateInvocation(args) {
  const problems = [];
  if (!args.projectId) problems.push("--projectId is required (no default; there is no implicit target)");
  if (args.projectId === PRODUCTION_PROJECT_ID && args.confirmProduction !== PRODUCTION_PROJECT_ID) {
    problems.push(
      `--projectId ${PRODUCTION_PROJECT_ID} additionally requires --confirmProduction ${PRODUCTION_PROJECT_ID}`,
    );
  }
  if (args.out !== undefined && !args.out.endsWith(EVIDENCE_SUFFIX)) {
    problems.push(
      `--out must end in ${EVIDENCE_SUFFIX}: the crosswalk names real employees, UIDs and principals, ` +
        "and that suffix is what .gitignore excludes so it can never be committed",
    );
  }
  if (args.format !== undefined && args.format !== "json" && args.format !== "text") {
    problems.push("--format must be json or text");
  }
  return problems;
}

/** Resolve firebase-admin out of functions/node_modules. The repo root has no package.json. */
function requireFirebaseAdmin(moduleId) {
  const require = createRequire(join(REPO_ROOT, "functions", "package.json"));
  try {
    return require(moduleId);
  } catch (cause) {
    throw new Error(
      `cannot resolve ${moduleId} from functions/node_modules — run \`cd functions && npm ci\` first`,
      { cause },
    );
  }
}

/** READ-ONLY. The only Firestore access in this file. */
async function readCollections(db, names) {
  const out = {};
  for (const name of names) {
    const snapshot = await db.collection(name).get();
    out[name] = snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
  }
  return out;
}

function loadPrincipals(path) {
  if (!path) return [];
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  // Accept either a bare array or a { principals: [...] } wrapper, which is what a psql
  // `\copy ... to ... json` style export typically produces.
  const rows = Array.isArray(parsed) ? parsed : (parsed?.principals ?? []);
  if (!Array.isArray(rows)) throw new Error(`${path} does not contain a principals array`);
  return rows;
}

export async function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(`invalid invocation: ${err.message}`);
    return 1;
  }

  const problems = validateInvocation(args);
  if (problems.length > 0) {
    for (const problem of problems) console.error(`invalid invocation: ${problem}`);
    return 1;
  }

  let config;
  let principals;
  try {
    const configPath = args.config === undefined ? OPERATING_COMPANY_ROOTS_SANDBOX : resolve(args.config);
    config = args.config === "none" ? emptyOperatingCompanyConfig() : loadOperatingCompanyConfig(configPath);
    principals = loadPrincipals(args.principals && resolve(args.principals));
  } catch (err) {
    console.error(`failed to load authored configuration: ${err.message}`);
    return 1;
  }

  let collections;
  try {
    const { initializeApp, applicationDefault, getApps } = requireFirebaseAdmin("firebase-admin/app");
    const { getFirestore } = requireFirebaseAdmin("firebase-admin/firestore");
    if (getApps().length === 0) initializeApp({ credential: applicationDefault(), projectId: args.projectId });
    collections = await readCollections(getFirestore(), COLLECTIONS_READ);
  } catch (err) {
    console.error(`firestore read failed: ${err.message}`);
    return 2;
  }

  const document = buildCrosswalk({
    employees: collections[COLLECTIONS.EMPLOYEES],
    users: collections[COLLECTIONS.USERS],
    technicians: collections[COLLECTIONS.TECHNICIANS],
    trucks: collections[COLLECTIONS.TRUCKS],
    mobileLocations: collections[COLLECTIONS.MOBILE_LOCATIONS],
    locationTruckClaims: collections[COLLECTIONS.LOCATION_TRUCK_CLAIMS],
    principals,
    operatingCompanyConfig: config,
    generatedAt: new Date().toISOString(),
    sourceLabel: `firestore:${args.projectId}`,
  });

  const rendered =
    args.format === "text" ? formatCrosswalkText(document) : `${JSON.stringify(document, null, 2)}`;

  if (args.out) {
    writeFileSync(resolve(args.out), `${rendered}\n`, "utf8");
    console.error(`wrote ${resolve(args.out)} — ${document.counts.rows} rows`);
  } else {
    console.log(rendered);
  }

  for (const refusal of document.refusals) console.error(`REFUSAL ${refusal.rowType} ${refusal.key}: ${refusal.reason}`);
  for (const conflict of document.conflicts) console.error(`REFUSAL ${conflict.rowType} ${conflict.key}: ${conflict.reason}`);

  return document.migrationReadiness === MIGRATION_READINESS.REFUSE ? 3 : 0;
}

// Only run when invoked directly; importing this module for its exports must have no side effect.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().then((code) => {
    process.exitCode = code;
  });
}
