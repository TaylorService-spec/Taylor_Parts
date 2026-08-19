#!/usr/bin/env node
// DEPLOY-TIME ARTIFACT GUARD -- does the thing about to be published actually
// belong to the project it is being published to?
//
// WHY THIS EXISTS. On 2026-08-19 a sandbox refresh published an artifact stamped
// `taylor-parts-production` to eos-platform-sandbox, so the sandbox URL served a
// client configured for the production Firebase project. Nothing caught it: the
// build succeeded, the base-path check passed, `firebase deploy` targeted the right
// project, and every guard in the chain was looking at something else.
//
// The root cause does not matter to this script, and that is the point. The
// artifact can be wrong because an environment variable did not propagate, because
// a concurrent process overwrote dist/, because someone deployed from the wrong
// branch, or because the registry default is production and something fell back to
// it. All of those produce the SAME observable failure -- a version.json whose
// environment disagrees with the deploy target -- so one check at the last moment
// catches every one of them.
//
// Run this immediately before `firebase deploy --only hosting`. It reads the built
// artifact, not the source, because the artifact is what ships.
//
// Usage:
//   node scripts/verifyDeployArtifact.mjs --projectId eos-platform-sandbox
//   node scripts/verifyDeployArtifact.mjs --projectId taylor-parts --confirmProduction taylor-parts

import { readFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolvePath(HERE, "..");
const ARTIFACT = resolvePath(REPO_ROOT, "field-ops-app-vite/dist/version.json");
const REGISTRY = resolvePath(REPO_ROOT, "config/environments.json");

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

function fail(message, detail) {
  console.error(`DEPLOY ARTIFACT GUARD: REFUSING\n  ${message}`);
  if (detail) console.error(`  ${detail}`);
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));
const projectId = args.projectId;
if (!projectId || projectId === "true") {
  fail("--projectId is required. There is no default deploy target.");
}

let artifact;
try {
  artifact = JSON.parse(readFileSync(ARTIFACT, "utf8"));
} catch (err) {
  fail(
    `Could not read the built artifact at field-ops-app-vite/dist/version.json`,
    `${err.message}. Build before deploying -- an absent artifact must never be treated as a passing check.`,
  );
}

const registry = JSON.parse(readFileSync(REGISTRY, "utf8"));
const target = registry.environments.find((e) => e.firebase && e.firebase.projectId === projectId);
if (!target) {
  fail(
    `'${projectId}' is not a provisioned environment in config/environments.json.`,
    "Unknown projects fail closed rather than being deployed to on trust.",
  );
}

// THE CHECK. The artifact says which environment it was built for; the target says
// which environment this project IS. They must be the same environment.
if (artifact.environmentId !== target.id) {
  fail(
    `The built artifact does not belong to this deploy target.`,
    `artifact was built for '${artifact.environmentId}' (role '${artifact.environmentRole}'), ` +
      `but --projectId '${projectId}' is environment '${target.id}' (role '${target.role}'). ` +
      `Rebuild with VITE_ENVIRONMENT_ID=${target.id} before deploying.`,
  );
}

// Publishing a production-role artifact requires saying so out loud, matching the
// posture every other production-touching script in this repo uses. A sandbox
// refresh that silently starts shipping production would otherwise look identical
// to a correct one right up until it landed.
if (target.role === "production" && args.confirmProduction !== projectId) {
  fail(
    `This artifact is for the PRODUCTION environment '${target.id}'.`,
    `Re-run with --confirmProduction ${projectId} to acknowledge that deliberately.`,
  );
}

// Base path is checked separately by verify:build-base, but a mismatch here is worth
// catching too: Hosting serves at the domain root, and an artifact built for the
// GitHub Pages mount would 404 every asset.
if (artifact.base !== "/") {
  fail(
    `The artifact's asset base is '${artifact.base}', not '/'.`,
    "Firebase Hosting serves at the domain root; every asset would 404. Build with npm run build:firebase.",
  );
}

console.log(
  `DEPLOY ARTIFACT GUARD OK: artifact env='${artifact.environmentId}' role='${artifact.environmentRole}' ` +
    `base='${artifact.base}' commit='${artifact.commit}' -> project '${projectId}'`,
);
