// Runs one group of the admin-policy suites named by functions/test/adminPolicySuites.json (the registry).
//
//   node scripts/runAdminPolicySuites.mjs offline    test:adminPolicy          no database; runs in parallel
//   node scripts/runAdminPolicySuites.mjs postgres   test:adminPolicyPostgres  --test-concurrency=1: several of these suites
//                                                                              reset the one shared schema and must not race
//   node scripts/runAdminPolicySuites.mjs postgres --partition N   one CI partition (.github/ci/eos-admin-policy-postgres-partitions.json):
//                                                                  the same serialized run over that partition's files, on ITS OWN database
//
// With ADMIN_POLICY_MANIFEST_OUT=<path> the run also writes a per-file manifest (scripts/adminPolicyManifestReporter.mjs) and is then
// checked by scripts/adminPolicyPartitions.mjs: a suite that never ran, ran empty, failed, or was skipped unnamed fails the run.
//
// WHY A REGISTRY. The two suite lists used to be two very long lines of functions/package.json, which every other script of
// that file shares with 79 workflows' path filters: registering one suite fired all of them (measured: 84-95 workflow runs per
// push, most from that one file). The lists now live in the registry; package.json names only this runner, so a new suite
// changes the registry and the lane's relevance list (.github/ci/eos-admin-policy-paths.txt), never package.json.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FLAGS = Object.freeze({ offline: [], postgres: ["--test-concurrency=1"] });

const group = process.argv[2];
if (!Object.prototype.hasOwnProperty.call(FLAGS, group)) {
  console.error(`usage: node scripts/runAdminPolicySuites.mjs ${Object.keys(FLAGS).join("|")}`);
  process.exit(2);
}
const partitionAt = process.argv.indexOf("--partition");
const partition = partitionAt > 0 ? process.argv[partitionAt + 1] : null;
if (partitionAt > 0 && (group !== "postgres" || !/^[1-9]\d?$/.test(partition ?? ""))) {
  console.error("--partition <n> is only valid for the postgres group");
  process.exit(2);
}
const registry = JSON.parse(readFileSync(resolve(FUNCTIONS_DIR, "test/adminPolicySuites.json"), "utf8"));
let suites = registry[group];
if (!Array.isArray(suites) || suites.length === 0 || new Set(suites).size !== suites.length
  || !suites.every((s) => /^test\/[A-Za-z0-9_.-]+\.test\.mjs$/.test(s))) {
  console.error(`test/adminPolicySuites.json: "${group}" must be a non-empty list of distinct test/*.test.mjs files`);
  process.exit(2);
}
const map = loadMap();
if (partition) {
  // Refuse to run a partition of a map that is not a lossless partition of the registry: a suite missing from every
  // partition would otherwise run nowhere and pass.
  const problems = mapProblems(map, registry);
  if (problems.length > 0 || !map.assignments[partition]) {
    for (const p of problems) console.error(`::error::${p}`);
    console.error(`partition ${partition} cannot run: the partition map does not cover the registry exactly once`);
    process.exit(1);
  }
  suites = map.assignments[partition];
}
const manifestOut = process.env.ADMIN_POLICY_MANIFEST_OUT || null;
const reporters = manifestOut
  ? ["--test-reporter=tap", "--test-reporter-destination=stdout",
    `--test-reporter=${pathToFileURL(resolve(FUNCTIONS_DIR, "scripts/adminPolicyManifestReporter.mjs")).href}`, `--test-reporter-destination=${manifestOut}`]
  : [];
const run = spawnSync(process.execPath, ["--test", ...FLAGS[group], ...reporters, ...suites], { cwd: FUNCTIONS_DIR, stdio: "inherit" });
if (run.status !== 0 || !manifestOut) process.exit(run.status ?? 1);
const manifest = JSON.parse(readFileSync(resolve(FUNCTIONS_DIR, manifestOut), "utf8"));
const problems = manifestProblems(map, group, suites, manifest);
const t = totals(manifest);
console.log(`manifest ${group}${partition ? ` partition ${partition}` : ""}: ${t.files} files, ${t.tests} tests, ${t.pass} pass, ${t.fail} fail, ${t.skipped} skipped, ${t.todo} todo, ${t.cancelled} cancelled`);
for (const p of problems) console.error(`::error::${p}`);
process.exit(problems.length > 0 ? 1 : 0);
