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
// Run once, locally, per technician, against the live project:
//   cd functions
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json node scripts/assignTechnicianToUser.js <uid> <technicianId>
// (or `gcloud auth application-default login` first, then just
//  `node scripts/assignTechnicianToUser.js <uid> <technicianId>` with no env var --
//  either way you need real credentials for the "taylor-parts" project.)
//
// Validates both docs exist before writing (fails loudly rather than
// silently creating a dangling reference). Idempotent: merge:true, so
// re-running with the same args is a safe no-op repeat, and re-running
// with a different technicianId simply updates the mapping (a
// technician changing which account they use, or a data-entry
// correction) -- it does not touch role, or any other field on the
// users/{uid} doc.
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const USERS_COLLECTION = "users";
const TECHNICIANS_COLLECTION = "fieldops_technicians";

async function assignTechnicianToUser(uid, technicianId) {
  initializeApp({ projectId: "taylor-parts" });
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

const [, , uid, technicianId] = process.argv;
if (!uid || !technicianId) {
  console.error("Usage: node scripts/assignTechnicianToUser.js <uid> <technicianId>");
  process.exitCode = 1;
} else {
  assignTechnicianToUser(uid, technicianId).catch((err) => {
    console.error("Failed:", err.message);
    process.exitCode = 1;
  });
}

module.exports = { assignTechnicianToUser };
