// Emulator E2E harness -- orchestrator.
//
// Starts the Firestore + Auth emulators via `firebase emulators:exec` (which blocks until the
// emulators are genuinely ready before running the given command, and tears them down afterward
// regardless of outcome) and, inside that, runs functions/test/e2e/runAll.mjs -- every
// *Emulator.test.mjs file in functions/test/e2e/.
//
// Three repo-specific gotchas this script exists to defuse (see functions/test/e2e/README.md for the
// full writeup):
//  1. The emulator loads firestore.rules from the CWD's branch. This script always spawns
//     `firebase emulators:exec` with cwd = the repo root computed from THIS file's own path (never
//     `process.cwd()`, which could be a stale checkout if invoked oddly) -- so it enforces whatever
//     firestore.rules is checked out in the SAME worktree this script lives in.
//  2. Port 8080 is frequently already taken on this machine. The Firestore/Auth emulator ports are
//     read from E2E_FIRESTORE_PORT / E2E_AUTH_PORT (defaulting to firebase.json's own 8080/9099) and
//     projected into a generated, gitignored config file (not firebase.json itself, which stays the
//     single source of truth for every OTHER firebase.json consumer in this repo).
//  3. `firebase emulators:exec` runs its command through a shell, and on Windows that shell is
//     cmd.exe -- which chokes on inline `VAR=value node script` syntax. This script never uses that
//     syntax: env vars (GCLOUD_PROJECT via --project, ports via the generated config) are passed
//     through emulators:exec's own --project flag and the generated config, never inline shell
//     assignment. The inner command is a bare `node <path>` with no shell-specific syntax at all.
//
// Exit status is this script's own process exit code -- the SAME exit code `firebase emulators:exec`
// itself returns for the inner command, which is itself runAll.mjs's own pass/fail aggregation. No log
// grepping anywhere in this path.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FUNCTIONS_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO_ROOT = path.dirname(FUNCTIONS_DIR);

const FIRESTORE_PORT = process.env.E2E_FIRESTORE_PORT ?? "8080";
const AUTH_PORT = process.env.E2E_AUTH_PORT ?? "9099";
// The emulator hub + logging emulator also bind fixed ports (4400/4500) even though this repo's
// firebase.json never mentions them -- and, same as 8080, they are frequently already taken by
// another emulator instance on this machine. Configurable for the same reason as the two above.
const HUB_PORT = process.env.E2E_HUB_PORT ?? "4400";
const LOGGING_PORT = process.env.E2E_LOGGING_PORT ?? "4500";
// Deliberately the SANDBOX project id, not "taylor-parts" (which the embedded
// environmentCapabilityOverrides.ts registry maps to role:"production" -> an unconditional empty
// per-environment capability-activation set). This is still 100% local emulator data -- the project id
// is only ever used to pick a row out of that in-process registry and to namespace the emulator's
// in-memory Firestore instance. Never touches any live Firebase project.
const PROJECT_ID = process.env.E2E_PROJECT_ID ?? "eos-platform-sandbox";

const baseConfig = JSON.parse(readFileSync(path.join(REPO_ROOT, "firebase.json"), "utf8"));
const genConfig = {
  ...baseConfig,
  emulators: {
    ...baseConfig.emulators,
    firestore: { ...baseConfig.emulators.firestore, port: Number(FIRESTORE_PORT) },
    auth: { ...baseConfig.emulators.auth, port: Number(AUTH_PORT) },
    hub: { port: Number(HUB_PORT) },
    logging: { port: Number(LOGGING_PORT) },
  },
};
const genConfigPath = path.join(REPO_ROOT, ".e2e-emulator-firebase.json");
writeFileSync(genConfigPath, JSON.stringify(genConfig, null, 2));
console.log(`Generated emulator config: ${genConfigPath} (firestore:${FIRESTORE_PORT}, auth:${AUTH_PORT}, project:${PROJECT_ID})`);

const firebaseBin = path.join(FUNCTIONS_DIR, "node_modules", "firebase-tools", "lib", "bin", "firebase.js");
const runAllScript = path.join("functions", "test", "e2e", "runAll.mjs").split(path.sep).join("/");

const args = [
  firebaseBin,
  "emulators:exec",
  "--only",
  "firestore,auth",
  "--project",
  PROJECT_ID,
  "--config",
  path.basename(genConfigPath),
  `node ${runAllScript}`,
];

console.log(`Running: node ${args.join(" ")}\n(cwd: ${REPO_ROOT})`);
const result = spawnSync(process.execPath, args, {
  cwd: REPO_ROOT,
  stdio: "inherit",
  env: { ...process.env, E2E_FIRESTORE_PORT: FIRESTORE_PORT },
});

if (result.error) {
  console.error("Failed to launch firebase emulators:exec:", result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
