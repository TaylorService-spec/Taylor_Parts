// Runs one group of the admin-policy suites named by functions/test/adminPolicySuites.json (the registry).
//
//   node scripts/runAdminPolicySuites.mjs offline    test:adminPolicy          no database; runs in parallel
//   node scripts/runAdminPolicySuites.mjs postgres   test:adminPolicyPostgres  --test-concurrency=1: several of these suites
//                                                                              reset the one shared schema and must not race
//
// WHY A REGISTRY. The two suite lists used to be two very long lines of functions/package.json, which every other script of
// that file shares with 79 workflows' path filters: registering one suite fired all of them (measured: 84-95 workflow runs per
// push, most from that one file). The lists now live in the registry; package.json names only this runner, so a new suite
// changes the registry and the lane's relevance list (.github/ci/eos-admin-policy-paths.txt), never package.json.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FLAGS = Object.freeze({ offline: [], postgres: ["--test-concurrency=1"] });

const group = process.argv[2];
if (!Object.prototype.hasOwnProperty.call(FLAGS, group)) {
  console.error(`usage: node scripts/runAdminPolicySuites.mjs ${Object.keys(FLAGS).join("|")}`);
  process.exit(2);
}
const registry = JSON.parse(readFileSync(resolve(FUNCTIONS_DIR, "test/adminPolicySuites.json"), "utf8"));
const suites = registry[group];
if (!Array.isArray(suites) || suites.length === 0 || new Set(suites).size !== suites.length
  || !suites.every((s) => /^test\/[A-Za-z0-9_.-]+\.test\.mjs$/.test(s))) {
  console.error(`test/adminPolicySuites.json: "${group}" must be a non-empty list of distinct test/*.test.mjs files`);
  process.exit(2);
}
const run = spawnSync(process.execPath, ["--test", ...FLAGS[group], ...suites], { cwd: FUNCTIONS_DIR, stdio: "inherit" });
process.exit(run.status ?? 1);
