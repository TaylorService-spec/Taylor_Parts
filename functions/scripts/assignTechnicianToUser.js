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
// ============================ PROJECT TARGET: NAMED, NEVER ASSUMED ============================
//
// This script used to hardcode `initializeApp({ projectId: "taylor-parts" })` and take exactly TWO
// documented arguments, neither of which named an environment. A copied command line therefore wrote
// to the customer's live Firestore with production named nowhere on it and no per-run confirmation.
// The write is small but it is a real production mutation to an access-control field that
// firestore.rules' isOwnTechnician() reads, so a mis-targeted run changes who can see what.
//
// The target is now NAMED via --projectId, and production additionally requires
// --confirmProduction taylor-parts, through the SAME shared guard provisionEmployeeAccess.js uses.
// The guard module imports no SDK and the refusal runs BEFORE firebase-admin is even require()d, so
// a refused invocation has no client with which to contact any project.
//
// Run once, locally, per technician, against an explicitly named project:
//   cd functions
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json \
//     node scripts/assignTechnicianToUser.js --projectId <id> <uid> <technicianId>
//
// Against PRODUCTION the project is typed twice -- once as target, once as confirmation:
//   node scripts/assignTechnicianToUser.js \
//     --projectId taylor-parts --confirmProduction taylor-parts <uid> <technicianId>
//
// (or `gcloud auth application-default login` first, then omit the env var -- either way you need
//  real credentials for the target project. Ambient credentials never select it.)
//
// NOTE: docs/DevelopmentSetup.md and docs/BusinessEntityModel.md document the OLD two-argument form.
// The refusal is implemented here as the safety-critical change; updating that runbook prose is an
// Owner decision recorded by the lane that made this change.
//
// Validates both docs exist before writing (fails loudly rather than
// silently creating a dangling reference). Idempotent: merge:true, so
// re-running with the same args is a safe no-op repeat, and re-running
// with a different technicianId simply updates the mapping (a
// technician changing which account they use, or a data-entry
// correction) -- it does not touch role, or any other field on the
// users/{uid} doc.
// firebase-admin is required LAZILY, inside the function, AFTER the guard -- so a refused run never
// loads the Admin SDK at all. The guard itself lives in an SDK-free module for the same reason.
const { parseArgs, assertProjectTarget } = require("./projectTargetGuard.js");

const USERS_COLLECTION = "users";
const TECHNICIANS_COLLECTION = "fieldops_technicians";

/**
 * @param {string} uid
 * @param {string} technicianId
 * @param {string} projectId  REQUIRED. No default, no inference.
 */
async function assignTechnicianToUser(uid, technicianId, projectId) {
  // Re-checked here so a direct require() caller cannot reach the Admin SDK without naming a
  // project either -- the entry condition of the function that performs the write.
  if (typeof projectId !== "string" || projectId.length === 0) {
    throw new Error(
      "projectId is required -- this script writes to a live project and will not infer its target " +
        "from ambient credentials, gcloud defaults, .firebaserc, or the working directory."
    );
  }
  // eslint-disable-next-line global-require
  const { initializeApp, getApps } = require("firebase-admin/app");
  // eslint-disable-next-line global-require
  const { getFirestore } = require("firebase-admin/firestore");
  if (getApps().length === 0) initializeApp({ projectId });
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

// ============================ ENTRY: REFUSE BEFORE ANYTHING CONNECTS ============================
//
// require.main-guarded so a test or another script can require() this module without triggering a
// run against ITS OWN argv -- the same guard provisionEmployeeAccess.js documents.
if (require.main === module) {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  // The two positionals, in order, ignoring --flags and the values they consume.
  const positionals = argv.filter(
    (token, i) => !token.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--"))
  );
  const [uid, technicianId] = positionals;

  // ORDER MATTERS: the target guard runs first, and nothing below it -- and no firebase-admin
  // require() anywhere -- is reached until it has passed.
  let projectId;
  try {
    projectId = assertProjectTarget(args);
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
    return;
  }

  if (!uid || !technicianId) {
    console.error(
      "Usage: node scripts/assignTechnicianToUser.js --projectId <id> " +
        "[--confirmProduction taylor-parts] <uid> <technicianId>"
    );
    process.exitCode = 1;
  } else {
    assignTechnicianToUser(uid, technicianId, projectId).catch((err) => {
      console.error("Failed:", err.message);
      process.exitCode = 1;
    });
  }
}

module.exports = { assignTechnicianToUser };
