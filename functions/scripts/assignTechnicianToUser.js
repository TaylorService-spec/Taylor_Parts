// PT-001 -- Technician Identity Mapping.
//
// Problem this fixes: firestore.rules' isOwnTechnician() helper reads
// users/{uid}.technicianId, but no code anywhere in this repo populates
// that field. `users/{userId}` has `allow write: if false`
// unconditionally (see firestore.rules -- "Role docs are provisioned
// by an admin (console or Admin SDK), never by the client") -- so this
// CANNOT be a client-side function; it must run with Admin SDK
// credentials, same as functions/scripts/seedOperationsDemoData.js.
//
// No automatic mapping exists (and none is invented here): there is no
// existing signal anywhere in this system that says "this Firebase Auth
// user corresponds to that technician document" -- linking the two is
// an inherently manual, admin-made decision (e.g. onboarding a new
// technician's login). This script is that minimal, explicit,
// manual-safe utility.
//
// TARGET SELECTION IS EXPLICIT AND FAIL-CLOSED. --projectId is REQUIRED (there is
// no default), and production additionally requires a matching
// --confirmProduction, exactly as provisionEmployeeAccess.js has always required.
// This used to hardcode `initializeApp({ projectId: "taylor-parts" })`, so a run
// that merely typo'd a uid wrote to the customer's live data with no per-run
// confirmation of any kind. The projectId is also passed to initializeApp AND
// re-checked against the SDK's own resolved value, so ambient credentials (an
// `authorized_user` ADC's quota_project_id, GCLOUD_PROJECT, a gcloud/firebase
// default) cannot silently bind a different project than the one confirmed.
//
// Run once, locally, per technician:
//   cd functions
//   node scripts/assignTechnicianToUser.js --projectId eos-platform-sandbox <uid> <technicianId>
//   node scripts/assignTechnicianToUser.js --projectId taylor-parts --confirmProduction taylor-parts <uid> <technicianId>
// (Credentials come from GOOGLE_APPLICATION_CREDENTIALS or
//  `gcloud auth application-default login`; they authenticate the caller, they do
//  NOT choose the target -- --projectId does, and only --projectId.)
//
// Validates both docs exist before writing (fails loudly rather than
// silently creating a dangling reference). Idempotent: merge:true, so
// re-running with the same args is a safe no-op repeat, and re-running
// with a different technicianId simply updates the mapping (a
// technician changing which account they use, or a data-entry
// correction) -- it does not touch role, or any other field on the
// users/{uid} doc.
const { initializeApp, getApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const {
  assertProjectTarget,
  assertResolvedProjectId,
} = require("./environmentTargetShared.js");

const USERS_COLLECTION = "users";
const TECHNICIANS_COLLECTION = "fieldops_technicians";

async function assignTechnicianToUser(uid, technicianId, projectId) {
  if (!projectId) {
    throw new Error("assignTechnicianToUser requires an explicit projectId -- there is no default target.");
  }
  initializeApp({ projectId });
  assertResolvedProjectId(getApp().options.projectId, projectId);
  const db = getFirestore();

  const [userSnap, techSnap] = await Promise.all([
    db.collection(USERS_COLLECTION).doc(uid).get(),
    db.collection(TECHNICIANS_COLLECTION).doc(technicianId).get(),
  ]);

  if (!userSnap.exists) {
    throw new Error(`No users/${uid} document exists. Create the user's role doc first (console or Admin SDK) before linking a technician.`);
  }
  if (!techSnap.exists) {
    throw new Error(`No ${TECHNICIANS_COLLECTION}/${technicianId} document exists. Check the technician doc id (see the Technicians tab / Firestore console).`);
  }

  const userData = userSnap.data();
  if (userData.role !== "technician") {
    console.warn(
      `Warning: users/${uid} has role "${userData.role ?? "(none)"}", not "technician". ` +
        `isOwnTechnician() is only ever checked for technician-role callers, so this mapping will be written but will have no effect unless the role is also "technician".`
    );
  }

  await db.collection(USERS_COLLECTION).doc(uid).set({ technicianId }, { merge: true });
  console.log(`OK: users/${uid}.technicianId = "${technicianId}"`);
}

/**
 * Split `--flag value` pairs out of argv, leaving the positional arguments.
 * Deliberately tiny and local -- it only has to recognise the two target flags.
 */
function parseArgs(argv) {
  const flags = {};
  const positionals = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : "true";
      flags[key] = value;
      if (value !== "true") i += 1;
    } else {
      positionals.push(argv[i]);
    }
  }
  return { flags, positionals };
}

const USAGE =
  "Usage: node scripts/assignTechnicianToUser.js --projectId <id> [--confirmProduction taylor-parts] <uid> <technicianId>";

if (require.main === module) {
  const { flags, positionals } = parseArgs(process.argv.slice(2));
  const [uid, technicianId] = positionals;

  // The target is decided BEFORE any Firebase SDK call. A missing/unconfirmed
  // target must fail here, loudly, not partway through a write.
  let projectId;
  try {
    projectId = assertProjectTarget(flags);
  } catch (err) {
    console.error(`REFUSING TO RUN: ${err.message}`);
    console.error(USAGE);
    process.exitCode = 1;
  }

  if (projectId) {
    if (!uid || !technicianId) {
      console.error(USAGE);
      process.exitCode = 1;
    } else {
      assignTechnicianToUser(uid, technicianId, projectId).catch((err) => {
        console.error("Failed:", err.message);
        process.exitCode = 1;
      });
    }
  }
}

module.exports = { assignTechnicianToUser, parseArgs };
