#!/usr/bin/env node
/**
 * Environment-targeted Hosting deploy with fail-closed target identity.
 *
 * WHY THIS EXISTS (Gate 1 finding). `npm run build:firebase` resolves its
 * environment from VITE_ENVIRONMENT_ID, and when that is unset the registry's
 * defaultEnvironmentId applies — which is production. A sandbox deploy that
 * forgets the variable therefore produces an artifact whose own version.json
 * says `environmentId: taylor-parts-production, role: production`, and ships it
 * to the sandbox. Nothing production is touched, but the deployed manifest is
 * lying about which environment it is, which defeats D1/D2: the whole point of
 * the manifest is that a deployed surface can identify itself truthfully.
 *
 * That default is NOT changed here. Changing it would alter production build
 * behaviour, and the Owner scoped this to preventing misidentified artifacts.
 * Instead this script makes environment identity an explicit, required input
 * for the deploy path, and refuses to ship an artifact whose baked-in identity
 * does not match the target it is being deployed to.
 *
 * Fail-closed rules:
 *   - --environment is REQUIRED. There is no default target.
 *   - The id must exist in config/environments.json and be provisioned.
 *   - The build is run with VITE_ENVIRONMENT_ID set from that same id, so the
 *     artifact cannot disagree with the target by construction.
 *   - After the build, dist/version.json is re-read and its environmentId and
 *     role are asserted against the resolved target. A mismatch aborts BEFORE
 *     any deploy — this is the check that would have caught the Gate 1 slip.
 *   - A production-role target additionally requires --allow-production, so
 *     production can never be reached by a typo in an environment id.
 *
 * Usage:
 *   node scripts/deployHosting.mjs --environment platform-sandbox
 *   node scripts/deployHosting.mjs --environment taylor-parts-production --allow-production
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";

import { resolveEnvironment } from "./resolveEnvironment.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolvePath(HERE, "..");
const APP = resolvePath(REPO, "field-ops-app-vite");

function parseArgs(argv) {
  const out = { environment: null, allowProduction: false, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--environment" || a === "--env") out.environment = argv[++i] ?? null;
    else if (a === "--allow-production") out.allowProduction = true;
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return out;
}

const USAGE = `Usage: node scripts/deployHosting.mjs --environment <id> [--allow-production] [--dry-run]

  --environment <id>   REQUIRED. An id from config/environments.json.
                       There is no default target: an omitted id is an error,
                       never an implicit production deploy.
  --allow-production   Required in addition when the target's role is
                       'production'.
  --dry-run            Build and verify identity, then stop before deploying.`;

/** Resolve the target, refusing anything ambiguous, unknown or unprovisioned. */
export function resolveDeployTarget(registry, environmentId, { allowProduction = false } = {}) {
  if (!environmentId) {
    throw new Error(
      "REFUSING: --environment is required. There is no default deploy target — " +
        "an omitted environment must never resolve to production.",
    );
  }
  // Pass the id explicitly so the registry's defaultEnvironmentId can never apply.
  const env = resolveEnvironment(registry, environmentId);
  if (!env) throw new Error(`REFUSING: '${environmentId}' is not a known environment.`);
  const projectId = env.firebase?.projectId ?? null;
  if (!projectId || env.status !== "live") {
    throw new Error(
      `REFUSING: environment '${env.id}' is not provisioned for deploy ` +
        `(status=${env.status}, projectId=${projectId ?? "none"}).`,
    );
  }
  if (env.role === "production" && !allowProduction) {
    throw new Error(
      `REFUSING: '${env.id}' has role 'production'. Pass --allow-production to ` +
        "confirm this is intended.",
    );
  }
  return { id: env.id, role: env.role, projectId };
}

/**
 * The artifact must identify itself as the environment it is being shipped to.
 * This is the assertion that turns a silent misidentification into a stop.
 */
export function assertManifestMatchesTarget(manifest, target) {
  if (manifest.environmentId !== target.id || manifest.environmentRole !== target.role) {
    throw new Error(
      "REFUSING: built artifact does not identify as the deploy target.\n" +
        `  target:   ${target.id} (role=${target.role})\n` +
        `  artifact: ${manifest.environmentId} (role=${manifest.environmentRole})\n` +
        "Deploying this would publish a surface that misreports its own environment.",
    );
  }
  return true;
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }
  if (args.help) {
    console.log(USAGE);
    return;
  }

  let target;
  try {
    const registry = JSON.parse(readFileSync(resolvePath(REPO, "config/environments.json"), "utf8"));
    target = resolveDeployTarget(registry, args.environment, { allowProduction: args.allowProduction });
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
    return;
  }

  console.log(`Target: ${target.id}  role=${target.role}  project=${target.projectId}`);

  // Build with the target's identity injected explicitly. The artifact cannot
  // disagree with the target by construction -- the assertion below then proves
  // it, rather than trusting it.
  console.log("Building with VITE_ENVIRONMENT_ID=" + target.id);
  execFileSync("npm", ["run", "build:firebase"], {
    cwd: APP,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, VITE_ENVIRONMENT_ID: target.id },
  });

  const manifest = JSON.parse(readFileSync(resolvePath(APP, "dist/version.json"), "utf8"));
  try {
    assertManifestMatchesTarget(manifest, target);
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
    return;
  }
  console.log(`Artifact identity verified: ${manifest.environmentId} @ ${manifest.commit}`);

  if (args.dryRun) {
    console.log("--dry-run: verified, stopping before deploy.");
    return;
  }

  execFileSync(
    "npx",
    ["firebase-tools", "deploy", "--only", "hosting", "--project", target.projectId],
    { cwd: REPO, stdio: "inherit", shell: process.platform === "win32" },
  );
  console.log(`\nDeployed ${manifest.commit} to ${target.id}. Verify with:`);
  console.log(`  node scripts/checkDeployedVersions.mjs --env ${target.id} --expected ${manifest.commit}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolvePath(process.argv[1])) {
  main();
}
