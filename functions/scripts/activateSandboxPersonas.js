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
 * Usage:
 *   cd functions
 *   node scripts/activateSandboxPersonas.js --projectId eos-platform-sandbox \
 *     --out ../.sandbox-credentials.local.json
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

function assertNonProductionTarget(projectId) {
  if (!projectId || projectId === "true") throw new Error("--projectId is required. No default target.");
  if (projectId === "taylor-parts") throw new Error("REFUSING: taylor-parts is the customer production project.");
  const registry = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../config/environments.json"), "utf8"));
  const env = registry.environments.find((e) => e.firebase && e.firebase.projectId === projectId);
  if (!env) throw new Error(`REFUSING: '${projectId}' is not a known provisioned environment. Unknown projects fail closed.`);
  if (env.role === "production") throw new Error(`REFUSING: environment '${env.id}' has role 'production'.`);
  return env;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let env;
  try { env = assertNonProductionTarget(args.projectId); }
  catch (err) { console.error(err.message); process.exitCode = 1; return; }

  const rotate = args.rotate === "true";
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
    const password = `Sbx!${crypto.randomBytes(12).toString("base64url")}`;
    await auth.updateUser(u.uid, { password, emailVerified: true });
    creds[u.email] = password;
  }
  fs.writeFileSync(outPath, `${JSON.stringify(creds, null, 2)}\n`);
  console.log(`ROTATED ${Object.keys(creds).length} sandbox persona passwords in '${env.id}'.`);
  console.log(`Credentials written to: ${outPath}`);
  console.log("Every previously saved copy is now invalid -- the Owner's included, and any running mission's.");
  console.log("This file is gitignored and must never be committed or shared outside the sandbox.");
}

main().catch((err) => { console.error("Activation failed:", err && err.message ? err.message : err); process.exitCode = 1; });
