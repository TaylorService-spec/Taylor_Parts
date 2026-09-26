/**
 * Sandbox persona credential activation — repeatable, sandbox-only.
 *
 * The governed `provisionEmployeeAccess.js` deliberately creates PASSWORDLESS
 * accounts and never issues a credential of any kind, because a terminal is
 * itself an observable log surface. That is correct for production. But a hosted
 * sandbox needs personas that can actually sign in — for Owner experience review
 * and for deterministic persona agents — so credential activation is a separate,
 * explicitly sandbox-scoped step (finding F-7).
 *
 * SAFETY:
 *   - refuses any project whose registry role is `production`;
 *   - refuses `taylor-parts` explicitly;
 *   - only touches accounts whose email ends `@sandbox.invalid`;
 *   - passwords are randomly generated at runtime, never derived from anything
 *     guessable, and never committed — the output file is gitignored;
 *
 * ROTATION IS NOT THE DEFAULT, AND MUST NEVER BE (Owner direction, "Sandbox
 * credentials -- single source of truth"). This script used to rotate every
 * persona password on every run and describe that as "safe and expected for a
 * disposable environment". It is not. It silently invalidated the Owner's saved
 * copy and every agent's working credentials, and the resulting failure surfaces
 * as "invalid password" -- which sends you debugging the wrong thing entirely.
 * It did exactly that twice in one day, the second time to the author of this
 * comment, who ran it believing a patch had applied when it had not.
 *
 * AUTH PERSONAS ARE NOT BUSINESS FIXTURE DATA. Resetting scenario data must never
 * touch a persona account. An existing persona is REUSED; a missing one is
 * REPORTED as CREDENTIAL_ACCESS_FAILED, never silently manufactured with a new
 * password. Rotation now requires --rotate, stated out loud by someone who means
 * it. Read credentials through scripts/sandboxCredentials.mjs; never parse the
 * file yourself.
 *
 * ACTIVATING A NEW PERSONA MUST NOT COST THE EXISTING ONES. --rotate is
 * all-or-nothing by design, which is right when you mean it and wrong as the only
 * way to give a newly provisioned account a password: it would invalidate every
 * working persona in order to fix the one that never worked. --activate-missing
 * is the narrow tool for that case. It sets a password ONLY on personas that have
 * none, leaves every usable persona untouched, and MERGES into the existing
 * credential file rather than replacing it -- so the Owner's saved copy and any
 * running mission survive. A persona that already works is never a candidate.
 *
 * Usage:
 *   cd functions
 *   node scripts/activateSandboxPersonas.js --projectId eos-platform-sandbox \
 *     --out ../.sandbox-credentials.local.json
 *
 *   # give newly provisioned accounts a password without disturbing the rest:
 *   node scripts/activateSandboxPersonas.js --projectId eos-platform-sandbox \
 *     --activate-missing --out <the operator's credential file>
 */
const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const SANDBOX_EMAIL_SUFFIX = "@sandbox.invalid";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith("--")) {
      const k = argv[i].slice(2);
      out[k] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : "true";
    }
  }
  return out;
}

/**
 * THE ONE PASSWORD GENERATOR IN THIS REPOSITORY.
 *
 * Exported so the RESET_EXISTING_SANDBOX_PASSWORD path uses this exact function rather than growing a
 * second generator. Two generators are two things to keep honest about entropy and shape, and the
 * first time they drift nobody can tell which one produced a given credential.
 *
 * Returns a value. It is never logged here and must never be logged by a caller.
 */
function generateSandboxPassword() {
  return `Sbx!${crypto.randomBytes(12).toString("base64url")}`;
}

function assertNonProductionTarget(projectId) {
  if (!projectId || projectId === "true") throw new Error("--projectId is required. No default target.");
  if (projectId === "taylor-parts") throw new Error("REFUSING: taylor-parts is the customer production project.");
  const registry = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../config/environments.json"), "utf8"));
  const env = registry.environments.find((e) => e.firebase && e.firebase.projectId === projectId);
  if (!env) throw new Error(`REFUSING: '${projectId}' is not a known provisioned environment. Unknown projects fail closed.`);
  if (env.role === "production") throw new Error(`REFUSING: environment '${env.id}' has role 'production'.`);
  return env;
}


/**
 * ACTIVATE-MISSING, as a callable. THE ONE IMPLEMENTATION, used by this CLI and by the Sample Company
 * orchestrator -- never copied, because a second password-generating path is a second thing to keep honest.
 *
 * The semantics are unchanged and are the reason this mode exists: a strong random password ONLY for a
 * persona that has none; every working persona left untouched; the credential file MERGED rather than
 * replaced, so the Owner's saved copy and any running mission survive; an unparseable file refused rather
 * than overwritten. Nothing here logs, returns or compares a password value.
 *
 * `emailAllowlist` is the ONLY addition, and it is OPTIONAL. Absent -- which is how this CLI calls it -- the
 * behaviour is byte-for-byte what it has always been: every @sandbox.invalid persona in the project is
 * considered. Present, the call is narrowed to exactly those addresses, which is what lets the Sample
 * Company activate its own fifteen personas without touching anybody else's sandbox account. An allowlisted
 * address with NO account is REPORTED as missing, never silently skipped: a persona somebody expects to be
 * able to log in as, whose account does not exist, is a finding rather than a no-op.
 *
 * @param auth           a firebase-admin Auth instance
 * @param personas       the @sandbox.invalid users already listed from that project
 * @param outPath        the gitignored credential file to merge into
 * @param emailAllowlist optional iterable of addresses to confine this call to
 * @returns { scope, considered, activated: string[], unchanged: string[], missing: string[] } -- EMAILS ONLY
 */
async function activateMissingSandboxPasswords({ auth, personas, outPath, emailAllowlist }) {
  const allowlist = emailAllowlist ? new Set(emailAllowlist) : null;
  for (const email of allowlist ?? []) {
    if (!String(email).endsWith(SANDBOX_EMAIL_SUFFIX)) {
      throw new Error(`REFUSING: '${email}' is not a ${SANDBOX_EMAIL_SUFFIX} address.`);
    }
  }
  const considered = allowlist ? personas.filter((u) => allowlist.has(u.email)) : personas;
  const missing = allowlist
    ? [...allowlist].filter((email) => !personas.some((u) => u.email === email))
    : [];
  const needingPassword = considered.filter((u) => !u.passwordHash);
  const unchanged = considered.filter((u) => u.passwordHash).map((u) => u.email);

  if (needingPassword.length === 0) {
    return { scope: allowlist ? "ALLOWLIST" : "EVERY_SANDBOX_PERSONA", considered: considered.length, activated: [], unchanged, missing };
  }

  // MERGE, never replace. Reading the existing file here is deliberate and is
  // the one place this script reads it: writing a fresh file would silently drop
  // the working personas' passwords, which is the exact harm this mode exists to
  // avoid. Values are copied, never inspected, compared or logged.
  let existing = {};
  if (fs.existsSync(outPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(outPath, "utf8"));
    } catch {
      throw new Error(`REFUSING: '${outPath}' exists but is not parseable JSON. Refusing to overwrite a file whose contents cannot be preserved.`);
    }
  }

  const activated = [];
  for (const u of needingPassword) {
    const password = generateSandboxPassword();
    await auth.updateUser(u.uid, { password, emailVerified: true });
    existing[u.email] = password;
    activated.push(u.email);
  }
  fs.writeFileSync(outPath, `${JSON.stringify(existing, null, 2)}\n`);

  return { scope: allowlist ? "ALLOWLIST" : "EVERY_SANDBOX_PERSONA", considered: considered.length, activated, unchanged, missing };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let env;
  try { env = assertNonProductionTarget(args.projectId); }
  catch (err) { console.error(err.message); process.exitCode = 1; return; }

  const rotate = args.rotate === "true";
  const activateMissing = args["activate-missing"] === "true";
  if (rotate && activateMissing) {
    console.error("REFUSING: --rotate and --activate-missing mean opposite things. Pick one.");
    process.exitCode = 1;
    return;
  }
  const outPath = args.out && args.out !== "true"
    ? path.resolve(process.cwd(), args.out)
    : path.resolve(__dirname, "../../sandbox-credentials.local.json");
  if (!/credentials\.local\.json$/.test(outPath)) {
    console.error("REFUSING: --out must end with 'credentials.local.json' so it matches the gitignore rule.");
    process.exitCode = 1;
    return;
  }

  initializeApp({ credential: applicationDefault(), projectId: args.projectId });
  const auth = getAuth();
  const list = await auth.listUsers(1000);
  const personas = list.users.filter((u) => u.email && u.email.endsWith(SANDBOX_EMAIL_SUFFIX));

  if (activateMissing) {
    let result;
    try {
      result = await activateMissingSandboxPasswords({ auth, personas, outPath });
    } catch (err) {
      console.error(err.message);
      process.exitCode = 1;
      return;
    }
    if (result.activated.length === 0 && result.missing.length === 0 && result.considered === result.unchanged.length) {
      console.log(`Every one of the ${personas.length} personas in '${env.id}' already has a password. Nothing to do.`);
      return;
    }

    console.log(`Activated ${result.activated.length} persona(s) in '${env.id}' that previously had no password:`);
    for (const email of result.activated) console.log(`  ${email}`);
    console.log(`\nEvery other persona's password is UNCHANGED -- ${personas.length - result.activated.length} left alone.`);
    console.log(`Credential file merged in place: ${outPath}`);
    console.log("Gitignored. Never commit or share it outside the sandbox.");
    return;
  }

  if (!rotate) {
    // THE DEFAULT CHANGES NOTHING. Anyone reaching for this script during an
    // ordinary scenario reset wants exactly this: tell me what exists.
    console.log(`Found ${personas.length} sandbox personas in '${env.id}'. Nothing was read, written or changed.`);
    for (const u of personas) {
      console.log(`  ${u.email}${u.passwordHash ? "" : "   <-- NO PASSWORD SET, cannot sign in"}`);
    }
    const unusable = personas.filter((u) => !u.passwordHash);
    if (unusable.length > 0) {
      console.error(`\nCREDENTIAL_ACCESS_FAILED: ${unusable.length} persona(s) cannot sign in.`);
      console.error("Re-run with --rotate ONLY if you intend to invalidate every saved copy.");
      process.exitCode = 1;
      return;
    }
    console.log("\nAll personas are usable. Read them through scripts/sandboxCredentials.mjs (loadSandboxPersona).");
    return;
  }

  console.log("--rotate given: every previously saved credential is about to become invalid.");
  const creds = {};
  for (const u of personas) {
    const password = generateSandboxPassword();
    await auth.updateUser(u.uid, { password, emailVerified: true });
    creds[u.email] = password;
  }
  fs.writeFileSync(outPath, `${JSON.stringify(creds, null, 2)}\n`);
  console.log(`ROTATED ${Object.keys(creds).length} sandbox persona passwords in '${env.id}'.`);
  console.log(`Credentials written to: ${outPath}`);
  console.log("Every previously saved copy is now invalid -- the Owner's included, and any running mission's.");
  console.log("This file is gitignored and must never be committed or shared outside the sandbox.");
}

module.exports = { activateMissingSandboxPasswords, generateSandboxPassword, assertNonProductionTarget, SANDBOX_EMAIL_SUFFIX };

// STANDALONE CLI BEHAVIOUR IS UNCHANGED, and only runs when this file is the entry point -- so the Sample
// Company can require() the activation function without the CLI executing.
if (require.main === module) {
  main().catch((err) => { console.error("Activation failed:", err && err.message ? err.message : err); process.exitCode = 1; });
}
