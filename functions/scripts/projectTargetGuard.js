// THE PROJECT-TARGET FENCE, IN A MODULE THAT IMPORTS NO SDK.
//
// ============================ THE RULE ============================
//
// NO EXPLICIT ENVIRONMENT = REFUSE. An operator script's target project must be NAMED on the
// command line. It is never inferred from the working directory, gcloud's configured default, the
// Firebase default project, .firebaserc, ambient Application Default Credentials, or a process.env
// fallback. Every one of those is a property of the machine the script happens to run on rather
// than a statement of intent by the person running it, and a fence that can be satisfied by the
// environment is not a fence.
//
// Reaching the PRODUCTION project additionally requires typing it a second time, as
// --confirmProduction. That is a deliberate per-invocation confirmation, not a stored setting: there
// is no state anywhere that makes a later run production-capable, so no amount of prior setup --
// and no code review or merge approval -- can cause a production mutation without an operator
// explicitly naming production twice on the line they are executing.
//
// ============================ WHY THIS FILE EXISTS SEPARATELY ============================
//
// This rule already existed and was already shared: assertProjectTarget() lived in
// provisionEmployeeAccess.js, and auditSecurityRoleMirror.js, onboardEmployeePreflight.js and
// onboardEmployeeVerify.js all require() it from there. It was NOT rewritten here -- it was MOVED,
// unchanged, and provisionEmployeeAccess.js re-exports it so every existing caller is untouched.
//
// It moved because provisionEmployeeAccess.js require()s firebase-admin at its top level. That made
// "import the guard" and "load the Admin SDK" the same act, so a script whose whole safety property
// is REFUSING BEFORE ANY SDK CLIENT EXISTS could not actually demonstrate it: merely reaching the
// guard had already pulled the SDK into the process.
//
// So the guard lives where it can be imported by anything, in any order, without loading a single
// line of firebase-admin. THIS FILE MUST NEVER require() firebase-admin, google-auth-library, pg, or
// any other client library -- a test asserts that. Its only job is to decide, from argv alone,
// whether this invocation is allowed to proceed, and that decision must be reachable before the
// process is capable of contacting anything.
/** The customer production project. Refused unless named twice. */
const PRODUCTION_PROJECT_ID = "taylor-parts";

/**
 * `--flag value` pairs, plus bare `--flag` as the string "true".
 *
 * Moved verbatim from provisionEmployeeAccess.js, which still re-exports it: several scripts parse
 * their argv with this exact shape and assertProjectTarget() reads the object it produces, so the
 * parser and the guard that consumes it belong in the same SDK-free module.
 */
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

/**
 * Require an explicitly named project, and a separate explicit confirmation for production.
 *
 * @param {Record<string,string>} args  parsed argv (see parseArgs)
 * @returns {string} the confirmed target project id
 * @throws {Error} before any caller has constructed an SDK client
 */
function assertProjectTarget(args) {
  if (!args.projectId) {
    throw new Error(
      "--projectId is required (no default target -- e.g. --projectId taylor-parts, or a non-production id for testing)."
    );
  }
  if (args.projectId === PRODUCTION_PROJECT_ID && args.confirmProduction !== PRODUCTION_PROJECT_ID) {
    throw new Error(
      `--projectId "${PRODUCTION_PROJECT_ID}" targets the production project -- this requires an explicit, ` +
        `matching --confirmProduction ${PRODUCTION_PROJECT_ID} flag as a deliberate, per-run confirmation. ` +
        `Use a different --projectId for emulator/non-production testing to skip this requirement.`
    );
  }
  return args.projectId;
}

module.exports = { parseArgs, assertProjectTarget, PRODUCTION_PROJECT_ID };
