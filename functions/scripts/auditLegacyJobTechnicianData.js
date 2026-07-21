// F-RULES-1 PR-0 -- READ-ONLY compatibility audit for the legacy
// fieldops_jobs / fieldops_technicians authorization hardening.
//
// PURPOSE: determine whether existing data is compatible with the
// approved F-RULES-1 hardened Rules contract BEFORE any Rules deploy.
// It inspects fieldops_jobs, fieldops_technicians, and users/{uid}.
// technicianId and emits a GO / NO-GO deployment gate. It performs NO
// writes of any kind.
//
// READ-ONLY PROOF: the only Firestore calls this script makes are
// initializeApp(), getFirestore(), db.collection(name).get(), and
// reading snapshot.docs / doc.id / doc.data(). It imports and uses NO
// write API -- no set/add/update/delete/batch/runTransaction/
// BulkWriter/FieldValue-mutation -- see loadCollections() below and the
// FIRESTORE_METHODS_USED export. NO-GO never authorizes any correction;
// correction is a separately governed task (Owner authorization + a
// reviewed plan). The `--output <path>` option writes an audit-report
// FILE on the local filesystem only; it never writes Firestore.
//
// PROJECT TARGET: no hard-coded default (same guard convention as
// scripts/provisionEmployeeAccess.js). --projectId is required; the
// production project ("taylor-parts") additionally requires an exact,
// matching --confirmProduction taylor-parts as a deliberate per-run
// confirmation, checked BEFORE initializeApp() is ever called. Any
// other --projectId (e.g. an emulator/fixture id) skips the
// confirmation. Executing this audit against production is a separate
// step that still requires explicit Owner authorization; merging this
// tool does not authorize running it against production.
//
// Usage:
//   node scripts/auditLegacyJobTechnicianData.js --projectId <id> \
//     [--confirmProduction taylor-parts] [--json] [--output <path>]
//   GO   -> exit 0 (no BLOCKER findings)
//   NO-GO-> exit 3 (>=1 BLOCKER finding; REVIEW findings never cause NO-GO on their own)
//   invalid invocation -> exit 1 ; technical read failure -> exit 2
//
// The pure analyzer (analyzeLegacyData) takes plain arrays so it is
// fully unit-testable without any credentials or emulator.

const PRODUCTION_PROJECT_ID = "taylor-parts";

// Approved observed enums (domain/constants.js: JOB_STATUS / TECH_STATUS).
const JOB_STATUSES = ["open", "assigned", "in_progress", "complete"];
const TECH_STATUSES = ["available", "on_job", "off_shift"];

// Known persisted technician-document fields (domain/jobActions.js
// createTechnician + firebase/collectionStore.js's createdAt stamp).
const KNOWN_TECHNICIAN_FIELDS = ["name", "phone", "status", "createdAt"];

// The exact, complete Firestore method surface this script touches --
// all read-only. Exported so a test can assert it and a reviewer can
// verify it against the source without a fragile text grep alone.
const FIRESTORE_METHODS_USED = Object.freeze([
  "initializeApp",
  "getFirestore",
  "collection().get()",
  "QuerySnapshot.docs",
  "QueryDocumentSnapshot.id",
  "QueryDocumentSnapshot.data()",
]);

// Ordered check catalog -- drives deterministic output ordering.
const CHECK_ORDER = [
  "A1", "A2", "A3", "A4",
  "B1", "B2", "B3", "B4", "B5", "B6",
  "C1", "C1_createdAt", "C2", "C3", "C4",
  "D1",
];

const CHECK_META = Object.freeze({
  A1: { classification: "BLOCKER", description: "Technician-role users missing technicianId" },
  A2: { classification: "BLOCKER", description: "Users whose technicianId points to a missing technician document" },
  A3: { classification: "REVIEW", description: "technicianId shared by multiple user documents" },
  A4: { classification: "REVIEW", description: "Technician documents not referenced by any user" },
  B1: { classification: "BLOCKER", description: "Jobs missing status" },
  B2: { classification: "BLOCKER", description: "Jobs with status outside the approved enum" },
  B3: { classification: "BLOCKER", description: "assigned/in_progress jobs with missing/blank/non-string technicianId" },
  B4: { classification: "REVIEW", description: "open jobs with a populated technicianId" },
  B5: { classification: "REVIEW", description: "Jobs whose technicianId points to a missing technician document" },
  B6: { classification: "REVIEW", description: "complete jobs with missing/non-string technicianId (structural)" },
  C1: { classification: "BLOCKER", description: "Technician documents missing name/phone/status" },
  C1_createdAt: { classification: "REVIEW", description: "Technician documents missing createdAt (legacy-uncertain)" },
  C2: { classification: "BLOCKER", description: "Technician status outside the approved enum" },
  C3: { classification: "BLOCKER", description: "Technician documents with malformed field types" },
  C4: { classification: "REVIEW", description: "Technician documents with unknown/compatibility fields" },
  D1: { classification: "BLOCKER", description: "Technician-role users whose scoped Field Mode read would fail" },
});

function isNonEmptyString(v) {
  return typeof v === "string" && v.length > 0;
}

// A valid PERSISTED identifier (technicianId): a non-empty string with
// NO surrounding whitespace. The future F-RULES-1 Rules identity contract
// compares EXACT document ids and must fail closed on malformed persisted
// data, so a whitespace-only id ("   ", "\t") is invalid and a padded id
// (" T1 ") is malformed -- it must NEVER be silently trimmed/normalized
// into "T1" for document matching. (PR-0 review correction.)
function isValidIdentifier(v) {
  return typeof v === "string" && v.length > 0 && v === v.trim();
}

function sortedUnique(ids) {
  return Array.from(new Set(ids)).sort();
}

// --------------------------------------------------------------------
// PURE ANALYZER -- no Firestore, no I/O. Inputs are plain arrays of
// { id, ...fields } objects (the id is the Firestore document id).
// Returns a deterministic, sensitive-value-free result.
// --------------------------------------------------------------------
function analyzeLegacyData({ users = [], jobs = [], technicians = [] } = {}) {
  const techIdSet = new Set(technicians.map((t) => t.id));

  // user.technicianId occurrences (for A3 shared-mapping detection).
  const techIdToUserIds = new Map();
  for (const u of users) {
    if (isValidIdentifier(u.technicianId)) {
      if (!techIdToUserIds.has(u.technicianId)) techIdToUserIds.set(u.technicianId, []);
      techIdToUserIds.get(u.technicianId).push(u.id);
    }
  }
  const referencedTechIds = new Set(techIdToUserIds.keys());

  const findings = {};
  for (const id of CHECK_ORDER) findings[id] = [];

  // A. user <-> technician mapping ------------------------------------
  for (const u of users) {
    const isTechRole = u.role === "technician";
    const hasValidId = isValidIdentifier(u.technicianId);
    if (isTechRole && !hasValidId) findings.A1.push(u.id);                 // BLOCKER
    if (hasValidId && !techIdSet.has(u.technicianId)) findings.A2.push(u.id); // BLOCKER (dangling)
    // D1: a technician-role user whose scoped Field Mode read cannot
    // resolve (no valid mapping, or mapping to a missing technician).
    if (isTechRole && (!hasValidId || !techIdSet.has(u.technicianId))) findings.D1.push(u.id);
  }
  for (const [techId, userIds] of techIdToUserIds) {
    if (userIds.length > 1) findings.A3.push(techId);                      // REVIEW (shared)
  }
  for (const t of technicians) {
    if (!referencedTechIds.has(t.id)) findings.A4.push(t.id);              // REVIEW (unreferenced)
  }

  // B. job status & assignment ----------------------------------------
  for (const j of jobs) {
    const status = j.status;
    const statusMissing = status === undefined || status === null;
    if (statusMissing) {
      findings.B1.push(j.id);                                             // BLOCKER
    } else if (!JOB_STATUSES.includes(status)) {
      findings.B2.push(j.id);                                             // BLOCKER (unknown)
    }
    const techIdValid = isValidIdentifier(j.technicianId);
    if ((status === "assigned" || status === "in_progress") && !techIdValid) {
      findings.B3.push(j.id);                                             // BLOCKER
    }
    if (status === "open" && techIdValid) findings.B4.push(j.id);         // REVIEW
    if (techIdValid && !techIdSet.has(j.technicianId)) findings.B5.push(j.id); // REVIEW (dangling)
    if (status === "complete" && !techIdValid) findings.B6.push(j.id);    // REVIEW (structural)
  }

  // C. technician document shape --------------------------------------
  for (const t of technicians) {
    const missingCore =
      t.name === undefined || t.phone === undefined || t.status === undefined;
    if (missingCore) findings.C1.push(t.id);                             // BLOCKER
    if (t.createdAt === undefined) findings.C1_createdAt.push(t.id);      // REVIEW (legacy-uncertain)
    if (t.status !== undefined && !TECH_STATUSES.includes(t.status)) findings.C2.push(t.id); // BLOCKER
    const malformedTypes =
      (t.name !== undefined && typeof t.name !== "string") ||
      (t.phone !== undefined && typeof t.phone !== "string") ||
      (t.status !== undefined && typeof t.status !== "string") ||
      (t.createdAt !== undefined && typeof t.createdAt !== "number");
    if (malformedTypes) findings.C3.push(t.id);                          // BLOCKER
    const unknownKeys = Object.keys(t).filter(
      (k) => k !== "id" && !KNOWN_TECHNICIAN_FIELDS.includes(k),
    );
    if (unknownKeys.length > 0) findings.C4.push(t.id);                  // REVIEW (compat data)
  }

  const checkResults = CHECK_ORDER.map((id) => ({
    id,
    classification: CHECK_META[id].classification,
    description: CHECK_META[id].description,
    count: findings[id].length,
    documentIds: sortedUnique(findings[id]),
  }));

  const firedBlockers = checkResults.filter((c) => c.classification === "BLOCKER" && c.count > 0);
  const firedReviews = checkResults.filter((c) => c.classification === "REVIEW" && c.count > 0);

  return {
    readOnly: true,
    inspected: { users: users.length, fieldops_jobs: jobs.length, fieldops_technicians: technicians.length },
    // blockerCount / reviewCount = number of FIRED categories (count>0);
    // per-document counts live on each checkResult. NO-GO iff any
    // BLOCKER category fired.
    blockerCount: firedBlockers.length,
    reviewCount: firedReviews.length,
    checkResults,
    finalDecision: firedBlockers.length > 0 ? "NO-GO" : "GO",
  };
}

// --------------------------------------------------------------------
// Formatting -- sensitive-value-free (only ids, counts, categories).
// --------------------------------------------------------------------
function formatSummary(result, projectId) {
  const lines = [];
  lines.push("Legacy Job & Technician Authorization Audit");
  lines.push(`Project: ${projectId}`);
  lines.push("Mode: READ-ONLY -- NO WRITES");
  lines.push(`Decision: ${result.finalDecision}`);
  lines.push("");
  const blockers = result.checkResults.filter((c) => c.classification === "BLOCKER" && c.count > 0);
  const reviews = result.checkResults.filter((c) => c.classification === "REVIEW" && c.count > 0);
  lines.push(`BLOCKERS (${result.blockerCount}):`);
  if (blockers.length === 0) lines.push("- none");
  for (const c of blockers) lines.push(`- ${c.id} ${c.description}: ${c.count}`);
  lines.push("");
  lines.push(`REVIEW (${result.reviewCount}):`);
  if (reviews.length === 0) lines.push("- none");
  for (const c of reviews) lines.push(`- ${c.id} ${c.description}: ${c.count}`);
  lines.push("");
  lines.push("Documents inspected:");
  lines.push(`- users: ${result.inspected.users}`);
  lines.push(`- fieldops_jobs: ${result.inspected.fieldops_jobs}`);
  lines.push(`- fieldops_technicians: ${result.inspected.fieldops_technicians}`);
  return lines.join("\n");
}

// --------------------------------------------------------------------
// CLI plumbing (kept thin; the analyzer above holds all real logic).
// --------------------------------------------------------------------
function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : "true";
      args[key] = value;
      if (value !== "true") i += 1;
    }
  }
  return args;
}

class InvalidInvocationError extends Error {}

// Throws InvalidInvocationError (never initializes anything) when the
// project target is missing or a production target lacks the exact
// matching confirmation. Pure -- safe to unit-test with fake argv.
function assertProjectTarget(args) {
  if (!args.projectId || args.projectId === "true") {
    throw new InvalidInvocationError(
      "--projectId is required (no default target -- e.g. --projectId taylor-parts, or a non-production id for testing).",
    );
  }
  if (args.projectId === PRODUCTION_PROJECT_ID && args.confirmProduction !== PRODUCTION_PROJECT_ID) {
    throw new InvalidInvocationError(
      `--projectId "${PRODUCTION_PROJECT_ID}" targets the production project -- this requires an explicit, ` +
        `matching --confirmProduction ${PRODUCTION_PROJECT_ID} flag as a deliberate, per-run confirmation. ` +
        `Use a different --projectId for emulator/non-production testing to skip this requirement.`,
    );
  }
  return args.projectId;
}

// Reads the three collections with ONLY collection().get(). No writer
// API is imported or used anywhere in this function or file.
async function loadCollections(db) {
  const [usersSnap, jobsSnap, techsSnap] = await Promise.all([
    db.collection("users").get(),
    db.collection("fieldops_jobs").get(),
    db.collection("fieldops_technicians").get(),
  ]);
  const toDocs = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return { users: toDocs(usersSnap), jobs: toDocs(jobsSnap), technicians: toDocs(techsSnap) };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(
      "Usage: node scripts/auditLegacyJobTechnicianData.js --projectId <id> " +
        "[--confirmProduction taylor-parts] [--json] [--output <path>]",
    );
    return 0;
  }

  let projectId;
  try {
    projectId = assertProjectTarget(args);
  } catch (err) {
    console.error(`INVALID INVOCATION: ${err.message}`);
    return 1;
  }

  console.log("READ-ONLY AUDIT -- NO WRITES");
  console.log(`Target project: ${projectId}`);

  // Lazy-require the Admin SDK so the guard above runs (and can reject)
  // before any Firebase initialization -- mirrors provisionEmployeeAccess.js.
  const { initializeApp } = require("firebase-admin/app");
  const { getFirestore } = require("firebase-admin/firestore");

  let collections;
  try {
    initializeApp({ projectId });
    const db = getFirestore();
    collections = await loadCollections(db);
  } catch (err) {
    // Technical execution failure -- explicitly NOT a GO or a normal
    // NO-GO. Never returns GO when a required read failed.
    console.error(`AUDIT EXECUTION FAILURE (technical, not a GO/NO-GO result): ${err.message}`);
    return 2;
  }

  const result = {
    generatedAt: new Date().toISOString(),
    projectId,
    ...analyzeLegacyData(collections),
  };

  console.log("");
  console.log(formatSummary(result, projectId));

  if (args.json) {
    console.log("");
    console.log(JSON.stringify(result, null, 2));
  }
  if (isNonEmptyString(args.output)) {
    // Local filesystem write of the audit report ONLY -- never Firestore.
    require("fs").writeFileSync(args.output, JSON.stringify(result, null, 2));
    console.log(`\nAudit report written to ${args.output}`);
  }

  return result.finalDecision === "GO" ? 0 : 3;
}

// Only run the CLI when invoked directly; requiring the module (tests)
// executes nothing.
if (require.main === module) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      console.error(`AUDIT EXECUTION FAILURE (technical, not a GO/NO-GO result): ${err.message}`);
      process.exitCode = 2;
    });
}

module.exports = {
  analyzeLegacyData,
  formatSummary,
  parseArgs,
  assertProjectTarget,
  isValidIdentifier,
  InvalidInvocationError,
  PRODUCTION_PROJECT_ID,
  JOB_STATUSES,
  TECH_STATUSES,
  KNOWN_TECHNICIAN_FIELDS,
  FIRESTORE_METHODS_USED,
  CHECK_ORDER,
  CHECK_META,
};
