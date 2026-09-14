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
// ============================ PROJECT TARGET: NAMED, NEVER ASSUMED ============================
//
// This script used to hardcode `initializeApp({ projectId: "taylor-parts" })` and take exactly ONE
// documented argument -- the email. That meant a single copied command line minted a live
// PRODUCTION password-reset link with no environment named anywhere on it and no per-run
// confirmation of any kind. The output of this tool is CREDENTIAL-EQUIVALENT: whoever holds the
// link can take over the account. A tool that hands out account access must not be able to reach
// the customer's live project because that is what it happened to be compiled against.
//
// So the target is now NAMED, and production is CONFIRMED SEPARATELY. Both checks run through the
// SAME shared guard that provisionEmployeeAccess.js uses -- assertProjectTarget() -- rather than a
// second hand-written copy of the rule. That script is this one's counterpart: it establishes an
// identity WITHOUT delivering a credential and says so explicitly ("No reset link is generated or
// printed here either -- credential delivery of any form is out of scope for this script"). This
// script IS that credential-delivery step, so it is held to at least the same gate, not a weaker one.
//
// The refusal fires BEFORE initializeApp() -- before any Firebase SDK client exists, before any
// Auth call, before any network access. A malformed or unconfirmed invocation therefore cannot
// contact any project at all, rather than failing partway through one.
//
// Run locally, per test account, against an explicitly named project:
//   cd functions
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json \
//     node scripts/generatePasswordResetLink.js --projectId <id> <email>
//
// Against PRODUCTION, the project must be typed TWICE -- once as the target, once as the
// confirmation -- exactly as provisionEmployeeAccess.js requires:
//   node scripts/generatePasswordResetLink.js \
//     --projectId taylor-parts --confirmProduction taylor-parts <email>
//
// (or `gcloud auth application-default login` first, then omit the env var -- either way you need
//  real credentials for the target project. Ambient credentials NEVER choose the project: an
//  unnamed --projectId is refused, never inferred from ADC, gcloud defaults, .firebaserc or cwd.)
//
// See docs/DevelopmentSetup.md's "Testing multiple roles" section for the full walkthrough.
// NOTE: that walkthrough documents the OLD one-argument form. The refusal is implemented here as
// the safety-critical change; updating the runbook prose is an Owner decision recorded by the lane
// that made this change, not something this script can do for itself.
// firebase-admin is required LAZILY, INSIDE the function, AFTER the guard -- the same placement
// truckBackendVerifierCli.js uses and for the same reason. A top-level require would load the
// Admin SDK while merely parsing a refused invocation. Loading it is not yet constructing a client,
// but keeping the import behind the guard makes the property provable rather than argued: on a
// refused run the firebase-admin module is never even resolved, so there is nothing present that
// could have contacted a project.
// THE shared project-target guard, not a second copy of the rule. Requiring --projectId and
// demanding a matching --confirmProduction for the production project is one safety posture; it
// lives in one place so a change to it happens once or not at all. The guard module deliberately
// imports NO SDK, so reaching the decision cannot itself load firebase-admin.
const { parseArgs, assertProjectTarget } = require("./projectTargetGuard.js");

/**
 * @param {string} email   the account whose reset link to mint
 * @param {string} projectId  REQUIRED. There is no default and no inference.
 */
async function generatePasswordResetLink(email, projectId) {
  // Re-checked here, not only in main(), so a direct require() caller cannot reach the Admin SDK
  // without naming a project either. The guard is the entry condition of the function that mints
  // the credential, which is the only placement that cannot be bypassed.
  if (typeof projectId !== "string" || projectId.length === 0) {
    throw new Error(
      "projectId is required -- this tool mints a credential-equivalent reset link and will not " +
        "infer its target from ambient credentials, gcloud defaults, .firebaserc, or the working directory."
    );
  }
  // eslint-disable-next-line global-require
  const { initializeApp, getApps } = require("firebase-admin/app");
  // eslint-disable-next-line global-require
  const { getAuth } = require("firebase-admin/auth");
  if (getApps().length === 0) initializeApp({ projectId });
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

// ============================ ENTRY: REFUSE BEFORE ANYTHING CONNECTS ============================
//
// require.main-guarded for the same reason provisionEmployeeAccess.js is: another script (or a
// test) that require()s this module to reuse a helper must not trigger a run against ITS OWN argv.
if (require.main === module) {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  // The email is the one positional argument -- everything else is a --flag with a value.
  const email = argv.find((token, i) => !token.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--")));

  // ORDER MATTERS. assertProjectTarget() runs first and throws for a missing --projectId or an
  // unconfirmed production target. Nothing below it, and no Firebase SDK call anywhere, is reached
  // until it has passed.
  let projectId;
  try {
    projectId = assertProjectTarget(args);
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
    return;
  }

  if (!email) {
    console.error(
      "Usage: node scripts/generatePasswordResetLink.js --projectId <id> " +
        "[--confirmProduction taylor-parts] <email>"
    );
    process.exitCode = 1;
  } else {
    generatePasswordResetLink(email, projectId).catch((err) => {
      console.error("Failed:", err.message);
      process.exitCode = 1;
    });
  }
}

module.exports = { generatePasswordResetLink };
