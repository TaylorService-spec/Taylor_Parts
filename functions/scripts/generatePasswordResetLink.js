// Developer utility -- Forgot Password testing support.
//
// Problem this solves: Firebase Auth's client-side sendPasswordResetEmail()
// always sends the reset email to the account's OWN registered address --
// there is no client or server configuration that redirects it anywhere
// else. During multi-role testing (admin/dispatcher/technician test
// accounts), a developer often doesn't have inbox access for a given test
// account's email. This script does NOT change that behavior and does NOT
// attempt to redirect Firebase's own email -- it uses the Admin SDK's
// generatePasswordResetLink(), which produces the reset URL WITHOUT
// sending any email at all. Delivering that link anywhere (opening it
// yourself, pasting it to a tester, etc.) is a manual, out-of-band step
// the developer running this script decides -- never something this
// script or the app does automatically.
//
// This is why there is no "recipient"/"override email" argument here:
// building one would mean the script itself decides where reset access
// goes, which is exactly the kind of standing routing risk this tool is
// designed to avoid. A human, not code, chooses who sees the link.
//
// Same category of tool as scripts/assignTechnicianToUser.js -- Admin
// SDK, manual, run locally against the live project, no Cloud Functions
// deployment involved (not blocked by issue #15's Blaze-plan decision).
// Does not touch the React app, firebase.js, AuthContext.jsx, or
// firestore.rules in any way.
//
// Run locally, per test account, against the live project:
//   cd functions
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json node scripts/generatePasswordResetLink.js <email>
// (or `gcloud auth application-default login` first, then just
//  `node scripts/generatePasswordResetLink.js <email>` with no env var --
//  either way you need real credentials for the "taylor-parts" project,
//  same as assignTechnicianToUser.js.)
//
// See docs/DevelopmentSetup.md's "Testing multiple roles" section for
// the full walkthrough.
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");

async function generatePasswordResetLink(email) {
  initializeApp({ projectId: "taylor-parts" });
  const auth = getAuth();

  // Fails loudly rather than silently generating a link for a
  // nonexistent account -- same defensive-check spirit as
  // assignTechnicianToUser.js.
  await auth.getUserByEmail(email).catch(() => {
    throw new Error(`No Firebase Auth user found for "${email}". Check the email is exactly right (case/typos).`);
  });

  const link = await auth.generatePasswordResetLink(email);
  console.log(`Reset link for ${email} (valid for a limited time, per Firebase's default expiry):`);
  console.log(link);
  console.log("");
  console.log("This link was NOT emailed anywhere -- open it yourself, or relay it manually to whoever needs it.");
}

const [, , email] = process.argv;
if (!email) {
  console.error("Usage: node scripts/generatePasswordResetLink.js <email>");
  process.exitCode = 1;
} else {
  generatePasswordResetLink(email).catch((err) => {
    console.error("Failed:", err.message);
    process.exitCode = 1;
  });
}

module.exports = { generatePasswordResetLink };
