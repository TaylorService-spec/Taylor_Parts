/**
 * EOS Ownership Model v1 — seed the `operating_companies` governed authority (Owner ruling D-2,
 * 2026-08-30).
 *
 * Writes the two records the ruling specified, with the stable governed ids it named:
 *
 *     operating_companies/taylor    { id: "taylor",  code: "TAYLOR",  displayName: "Taylor Freezer of Arizona", active: true }
 *     operating_companies/ventana   { id: "ventana", code: "VENTANA", displayName: "Ventana",                   active: true }
 *
 * DETERMINISTIC AND IDEMPOTENT. Document ids ARE the governed ids, and the payload is a constant
 * read from the authority module's own mirror rather than retyped here -- so a re-run converges on
 * the same two documents instead of minting new ones, and the seed cannot drift from the authority
 * it is seeding. `--dry-run` prints exactly what would be written and touches nothing.
 *
 * NOT RUN BY THIS CHANGE. It ships alongside the inert authority so that activating the model is a
 * separate, deliberate, target-named action. Nothing in the application reads
 * `operating_companies` yet, so an unseeded collection breaks nothing.
 *
 * SAFETY — the same posture as scripts/seedSandboxBaseline.js, and for the same reason:
 *   - refuses any project whose registry role is `production`
 *   - refuses `taylor-parts` explicitly, belt and braces
 *   - `--projectId` is required, no default
 *   - an unknown project fails closed rather than being treated as safe
 *
 * A production seed is an Owner-authorized action against a named target and is deliberately NOT
 * reachable from this script.
 *
 * Usage:
 *   cd functions
 *   node scripts/seedOperatingCompanies.js --projectId eos-platform-sandbox --dry-run
 *   node scripts/seedOperatingCompanies.js --projectId eos-platform-sandbox
 */
const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const fs = require("node:fs");
const path = require("node:path");

// The payload comes from the compiled authority module, never from a second hand-typed copy here.
// A seed script that restates its own records is how a "governed authority" acquires a second,
// divergent definition -- which is exactly what ruling D-2 forbids.
const {
  OPERATING_COMPANIES,
  OPERATING_COMPANIES_COLLECTION,
} = require("../lib/ownership/operatingCompanyAuthority.js");

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
  if (!projectId || projectId === "true") {
    throw new Error("--projectId is required. There is no default target.");
  }
  if (projectId === "taylor-parts") {
    throw new Error("REFUSING: taylor-parts is the customer production project.");
  }
  const registryPath = path.resolve(__dirname, "../../config/environments.json");
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  const env = registry.environments.find((e) => e.firebase && e.firebase.projectId === projectId);
  if (!env) {
    throw new Error(
      `REFUSING: '${projectId}' is not a known provisioned environment in config/environments.json. ` +
        "Unknown projects fail closed.",
    );
  }
  if (env.role === "production") {
    throw new Error(`REFUSING: environment '${env.id}' has role 'production'.`);
  }
  return env;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = assertNonProductionTarget(args.projectId);
  const dryRun = args["dry-run"] === "true";

  console.log(`Target: ${env.id} (${args.projectId}), role=${env.role}`);
  console.log(`Collection: ${OPERATING_COMPANIES_COLLECTION}`);
  for (const company of OPERATING_COMPANIES) {
    console.log(`  ${company.id} -> ${JSON.stringify(company)}`);
  }

  if (dryRun) {
    console.log(`\nDRY RUN — nothing was written. ${OPERATING_COMPANIES.length} documents would be set.`);
    return;
  }

  initializeApp({ credential: applicationDefault(), projectId: args.projectId });
  const db = getFirestore();
  const batch = db.batch();
  for (const company of OPERATING_COMPANIES) {
    // `set` without merge: the authority module is the whole truth for these documents, so a
    // re-seed restores them exactly rather than layering onto whatever is there.
    batch.set(db.collection(OPERATING_COMPANIES_COLLECTION).doc(company.id), { ...company });
  }
  await batch.commit();
  console.log(`\nSeeded ${OPERATING_COMPANIES.length} operating companies.`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
