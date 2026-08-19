#!/usr/bin/env node
// SHELL-PROOF ENVIRONMENT SELECTION FOR THE BUILD.
//
// WHY THIS EXISTS. The deploy runbook used the shell idiom:
//
//     VITE_ENVIRONMENT_ID=platform-sandbox npm run build:firebase
//
// which works in a plain bash shell and SILENTLY DOES NOT WORK when the same
// script is invoked from PowerShell through Git Bash on Windows -- the variable is
// lost somewhere in the PowerShell -> bash.exe -> npm.cmd -> vite chain. On
// 2026-08-19 that produced a build stamped `taylor-parts-production`, which was
// then published to the sandbox: the sandbox URL served a client configured for
// the production Firebase project.
//
// The failure was invisible at every step. The build succeeded. The base-path check
// passed. `firebase deploy` targeted the correct project. Only the environment
// stamp inside the artifact was wrong, and nothing looked at it.
//
// It was also NOT REPRODUCIBLE in a bash shell, which is the worst property a build
// bug can have: the machine that verifies disagrees with the machine that deploys.
//
// So the environment is no longer passed through the shell at all. It is an
// ARGUMENT to this script, set directly on process.env of the child, where no shell
// can drop it.
//
// Usage:
//   node scripts/buildForEnvironment.mjs platform-sandbox
//   node scripts/buildForEnvironment.mjs taylor-parts-production

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_DIR = resolvePath(HERE, "..");
const REGISTRY = resolvePath(APP_DIR, "../config/environments.json");

const environmentId = process.argv[2];
if (!environmentId) {
  console.error(
    "buildForEnvironment: an environment id is required. There is no default.\n" +
      "  node scripts/buildForEnvironment.mjs <platform-sandbox|taylor-parts-production|...>",
  );
  process.exit(1);
}

// Fail before building on an id the registry does not know. The registry's
// defaultEnvironmentId is PRODUCTION, so a typo that fell through to the default
// would produce a production artifact -- exactly the incident this replaces.
const registry = JSON.parse(readFileSync(REGISTRY, "utf8"));
const known = registry.environments.map((e) => e.id);
if (!known.includes(environmentId)) {
  console.error(
    `buildForEnvironment: '${environmentId}' is not in config/environments.json.\n` +
      `  known: ${known.join(", ")}`,
  );
  process.exit(1);
}

console.log(`buildForEnvironment: building for '${environmentId}'`);

const result = spawnSync(
  process.execPath,
  [resolvePath(APP_DIR, "node_modules/vite/bin/vite.js"), "build", "--base=/"],
  {
    cwd: APP_DIR,
    stdio: "inherit",
    // The whole point: set on the child's environment directly, never via a shell.
    env: { ...process.env, VITE_ENVIRONMENT_ID: environmentId },
  },
);

if (result.status !== 0) {
  console.error(`buildForEnvironment: vite build failed (status ${result.status})`);
  process.exit(result.status ?? 1);
}

// Prove what was actually produced rather than trusting that the intent took
// effect. This is the check whose absence let the incident ship.
const manifest = JSON.parse(readFileSync(resolvePath(APP_DIR, "dist/version.json"), "utf8"));
if (manifest.environmentId !== environmentId) {
  console.error(
    `buildForEnvironment: REFUSING -- asked for '${environmentId}' but the artifact says ` +
      `'${manifest.environmentId}'. The environment did not reach the build.`,
  );
  process.exit(1);
}

console.log(
  `buildForEnvironment OK: env='${manifest.environmentId}' role='${manifest.environmentRole}' ` +
    `base='${manifest.base}' commit='${manifest.commit}'`,
);
