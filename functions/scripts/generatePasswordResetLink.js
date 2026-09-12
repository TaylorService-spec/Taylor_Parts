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
// TARGET SELECTION IS EXPLICIT AND FAIL-CLOSED. This mints a working credential-
// recovery link for a real account, so which directory it reads matters more here
// than almost anywhere else in this tree. --projectId is REQUIRED (no default) and
// production additionally requires a matching --confirmProduction, the same fence
// provisionEmployeeAccess.js has always applied. It used to hardcode
// `initializeApp({ projectId: "taylor-parts" })`, i.e. one mistyped email away
// from a production reset link with no per-run confirmation at all. The projectId
// is also re-checked against the SDK's own resolved value, so ambient credentials
// (an `authorized_user` ADC's quota_project_id, GCLOUD_PROJECT, a gcloud/firebase
// default) cannot silently bind a different directory than the one confirmed.
//
// Run locally, per test account:
//   cd functions
//   node scripts/generatePasswordResetLink.js --projectId eos-platform-sandbox <email>
//   node scripts/generatePasswordResetLink.js --projectId taylor-parts --confirmProduction taylor-parts <email>
// (Credentials come from GOOGLE_APPLICATION_CREDENTIALS or
//  `gcloud auth application-default login`; they authenticate the caller, they do
//  NOT choose the target -- --projectId does, and only --projectId.)
//
// See docs/DevelopmentSetup.md's "Testing multiple roles" section for
// the full walkthrough.
const { initializeApp, getApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const {
  assertProjectTarget,
  assertResolvedProjectId,
} = require("./environmentTargetShared.js");

async function generatePasswordResetLink(email, projectId) {
  if (!projectId) {
    throw new Error("generatePasswordResetLink requires an explicit projectId -- there is no default target.");
  }
  initializeApp({ projectId });
  assertResolvedProjectId(getApp().options.projectId, projectId);
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
  "Usage: node scripts/generatePasswordResetLink.js --projectId <id> [--confirmProduction taylor-parts] <email>";

if (require.main === module) {
  const { flags, positionals } = parseArgs(process.argv.slice(2));
  const [email] = positionals;

  // The target is decided BEFORE any Firebase SDK call, so a missing/unconfirmed
  // target can never reach getUserByEmail() against whatever ADC happens to name.
  let projectId;
  try {
    projectId = assertProjectTarget(flags);
  } catch (err) {
    console.error(`REFUSING TO RUN: ${err.message}`);
    console.error(USAGE);
    process.exitCode = 1;
  }

  if (projectId) {
    if (!email) {
      console.error(USAGE);
      process.exitCode = 1;
    } else {
      generatePasswordResetLink(email, projectId).catch((err) => {
        console.error("Failed:", err.message);
        process.exitCode = 1;
      });
    }
  }
}

module.exports = { generatePasswordResetLink, parseArgs };
