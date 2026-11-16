// Runs one group of the admin-policy suites named by functions/test/adminPolicySuites.json (the registry).
//
//   node scripts/runAdminPolicySuites.mjs offline    test:adminPolicy          no database; runs in parallel
//   node scripts/runAdminPolicySuites.mjs postgres   test:adminPolicyPostgres  --test-concurrency=1: several of these suites
//                                                                              reset the one shared schema and must not race
//   node scripts/runAdminPolicySuites.mjs postgres --partition N [--isolate-databases]
//                                                                  one CI partition (.github/ci/eos-admin-policy-postgres-partitions.json):
//                                                                  the same serialized run over that partition's files, on ITS OWN postgres.
//                                                                  --isolate-databases drops and re-creates POLICY_TEST_DATABASE_URL's database,
//                                                                  EMPTY, before each file (localhost and a dedicated database only; CI uses it).
//
// With ADMIN_POLICY_MANIFEST_OUT=<path> the run also writes a per-file manifest (scripts/adminPolicyManifestReporter.mjs) and is then
// checked by scripts/adminPolicyPartitions.mjs: a suite that never ran, ran empty, failed, or was skipped unnamed fails the run.
//
// WHY A REGISTRY. The two suite lists used to be two very long lines of functions/package.json, which every other script of
// that file shares with 79 workflows' path filters: registering one suite fired all of them (measured: 84-95 workflow runs per
// push, most from that one file). The lists now live in the registry; package.json names only this runner, so a new suite
// changes the registry and the lane's relevance list (.github/ci/eos-admin-policy-paths.txt), never package.json.
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadMap, manifestProblems, mapProblems, totals } from "./adminPolicyPartitions.mjs";

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FLAGS = Object.freeze({ offline: [], postgres: ["--test-concurrency=1"] });

const group = process.argv[2];
if (!Object.prototype.hasOwnProperty.call(FLAGS, group)) {
  console.error(`usage: node scripts/runAdminPolicySuites.mjs ${Object.keys(FLAGS).join("|")}`);
  process.exit(2);
}
const isolate = process.argv.includes("--isolate-databases");
if (isolate && group !== "postgres") {
  console.error("--isolate-databases is only valid for the postgres group");
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
const reporterArgs = (dest) => ["--test-reporter=tap", "--test-reporter-destination=stdout",
  `--test-reporter=${pathToFileURL(resolve(FUNCTIONS_DIR, "scripts/adminPolicyManifestReporter.mjs")).href}`, `--test-reporter-destination=${dest}`];
const testArgs = (files, dest) => ["--test", ...FLAGS[group], ...(dest ? reporterArgs(dest) : []), ...files];

let status = 0;
let manifest = null;
if (!isolate) {
  const run = spawnSync(process.execPath, testArgs(suites, manifestOut), { cwd: FUNCTIONS_DIR, stdio: "inherit" });
  status = run.status ?? 1;
  if (manifestOut && status === 0) manifest = JSON.parse(readFileSync(resolve(FUNCTIONS_DIR, manifestOut), "utf8"));
} else {
  // ONE DATABASE PER FILE. In the old single serialized run, 190 files shared one database and some of them quietly depended on
  // what an EARLIER file had left in it (eosOpsCashApplicationPostgres and truckFleetPostgres run `up` against whatever the
  // previous file left, and fail when a different file precedes them). Splitting the run exposed that. Every file now starts on a
  // database that has never seen another file's data: dropped and re-created EMPTY before each file, which is also the state the
  // first file of a partition always had. The stronger isolation cannot make a zero-trace or tenancy assertion pass that
  // would otherwise fail; it removes leftover state as a source of either result.
  const url = process.env.POLICY_TEST_DATABASE_URL;
  const target = url ? new URL(url) : null;
  const dbName = target ? decodeURIComponent(target.pathname.slice(1)) : "";
  if (!target || !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) || !/^[a-z][a-z0-9_]*$/.test(dbName)
    || ["postgres", "template0", "template1"].includes(dbName)) {
    // The isolation drops and re-creates this database. Never a remote server, never a shared database.
    console.error("--isolate-databases needs POLICY_TEST_DATABASE_URL on localhost naming a dedicated, non-shared database");
    process.exit(2);
  }
  const { default: pg } = await import("pg");
  const maintenance = new URL(url);
  maintenance.pathname = "/postgres";
  const merged = { files: {} };
  for (const [i, file] of suites.entries()) {
    const admin = new pg.Client({ connectionString: maintenance.toString() });
    await admin.connect();
    try {
      await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
      await admin.query(`CREATE DATABASE "${dbName}"`);
    } finally {
      await admin.end();
    }
    const part = manifestOut ? `${manifestOut}.part-${i}.json` : null;
    console.log(`# ---- file ${i + 1} of ${suites.length}: ${file} (database ${dbName} re-created empty)`);
    const run = spawnSync(process.execPath, testArgs([file], part), { cwd: FUNCTIONS_DIR, stdio: "inherit" });
    if (run.status !== 0) status = 1;
    if (part && existsSync(resolve(FUNCTIONS_DIR, part))) {
      Object.assign(merged.files, JSON.parse(readFileSync(resolve(FUNCTIONS_DIR, part), "utf8")).files);
      rmSync(resolve(FUNCTIONS_DIR, part));
    }
  }
  if (manifestOut) {
    writeFileSync(resolve(FUNCTIONS_DIR, manifestOut), JSON.stringify(merged, null, 1) + "\n");
    manifest = merged;
  }
}

if (!manifestOut) process.exit(status);
// Even a failing run leaves its manifest for the gate; the problems below are only reported when every test passed, so they are
// never a second copy of a failure the log already shows.
if (status !== 0) process.exit(status);
const problems = manifestProblems(map, group, suites, manifest);
const t = totals(manifest);
console.log(`manifest ${group}${partition ? ` partition ${partition}` : ""}: ${t.files} files, ${t.tests} tests, ${t.pass} pass, ${t.fail} fail, ${t.skipped} skipped, ${t.todo} todo, ${t.cancelled} cancelled`);
for (const p of problems) console.error(`::error::${p}`);
process.exit(problems.length > 0 ? 1 : 0);
