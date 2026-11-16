// THE PARTITION MANIFEST GUARD for the admin-policy PostgreSQL suites (lane CIP, 2026-10-21).
//
// The PostgreSQL group of functions/test/adminPolicySuites.json used to run as ONE serialized `node --test` in ONE job (about 25
// minutes). It now runs as N jobs, each with its OWN postgres service container, each running the files the committed map
// .github/ci/eos-admin-policy-postgres-partitions.json assigns to it. Splitting a gate is only safe if the split is provably
// lossless, so this module is the proof, in two places:
//
//   BEFORE any database is touched   (mapProblems)       the map covers the registry EXACTLY: every registered postgres suite
//                                                         is in exactly one partition; none unassigned, none duplicated, none
//                                                         unknown to the registry, no empty partition.
//   AFTER each partition has run     (manifestProblems)  the run itself produced a result for every assigned file, no file ran
//                                                         zero tests, nothing failed or was cancelled, and the only skips are
//                                                         the ones the map names (expectedSkips).
//   IN THE GATE JOB                  (aggregateProblems) every partition reported exactly once, and together they cover the
//                                                         registry exactly once. A missing partition cannot read as green.
//
// CLI (all read-only):
//   node scripts/adminPolicyPartitions.mjs check-map                                  map vs registry, exit 1 on a problem
//   node scripts/adminPolicyPartitions.mjs files <n>                                  print partition n's files, one per line
//   node scripts/adminPolicyPartitions.mjs check-manifest <postgres|offline> <file> [n]  one run's manifest vs its assignment
//   node scripts/adminPolicyPartitions.mjs aggregate <dir>                            every partition manifest in <dir> + offline
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const MAP_PATH = resolve(FUNCTIONS_DIR, "../.github/ci/eos-admin-policy-postgres-partitions.json");
export const REGISTRY_PATH = resolve(FUNCTIONS_DIR, "test/adminPolicySuites.json");

// A partition may carry at most this multiple of the mean MEASURED load. Files with no measurement count as 0, so a new
// suite never trips this; it only fails when a re-balance is genuinely overdue for the files that were measured.
export const MAX_IMBALANCE = 1.25;

export const loadMap = () => JSON.parse(readFileSync(MAP_PATH, "utf8"));
export const loadRegistry = () => JSON.parse(readFileSync(REGISTRY_PATH, "utf8"));

const seconds = (map, file) => map.measuredSeconds?.[file] ?? 0;
const partitionKeys = (map) => Array.from({ length: map.partitions }, (_, i) => String(i + 1));

/** Problems with the map against the registry's postgres group. Pure. [] means the map is a lossless partition of it. */
export function mapProblems(map, registry) {
  const problems = [];
  if (!Number.isInteger(map.partitions) || map.partitions < 2) return ["map.partitions must be an integer >= 2"];
  const keys = partitionKeys(map);
  for (const k of Object.keys(map.assignments ?? {})) {
    if (!keys.includes(k)) problems.push(`assignments has partition "${k}" but map.partitions is ${map.partitions}`);
  }
  const owner = new Map();
  for (const k of keys) {
    const files = map.assignments?.[k];
    if (!Array.isArray(files) || files.length === 0) { problems.push(`partition ${k} is missing or empty`); continue; }
    for (const f of files) {
      if (owner.has(f)) problems.push(`DUPLICATE: ${f} is assigned to partition ${owner.get(f)} and partition ${k}`);
      else owner.set(f, k);
    }
  }
  const registered = new Set(registry.postgres);
  const lightest = suggestPartition(map);
  for (const f of registry.postgres) {
    if (!owner.has(f)) problems.push(`UNASSIGNED: ${f} is registered in adminPolicySuites.json "postgres" but in no partition. Add it to .github/ci/eos-admin-policy-postgres-partitions.json (partition ${lightest} is the lightest).`);
  }
  for (const f of owner.keys()) {
    if (!registered.has(f)) problems.push(`UNKNOWN: ${f} is assigned to partition ${owner.get(f)} but is not in adminPolicySuites.json "postgres"`);
  }
  const loads = keys.map((k) => (map.assignments?.[k] ?? []).reduce((a, f) => a + seconds(map, f), 0));
  const mean = loads.reduce((a, b) => a + b, 0) / loads.length;
  if (mean > 0 && Math.max(...loads) > mean * MAX_IMBALANCE) {
    problems.push(`IMBALANCE: heaviest measured partition is ${Math.max(...loads)}s against a mean of ${mean.toFixed(0)}s (limit x${MAX_IMBALANCE}); re-balance the map`);
  }
  for (const group of ["offline", "postgres"]) {
    for (const s of map.expectedSkips?.[group] ?? []) {
      if (typeof s !== "string" || s.length < 10) problems.push(`expectedSkips.${group} entries must be test-name prefixes of at least 10 characters`);
    }
  }
  return problems;
}

/** The partition with the least measured load (ties: fewest files, then lowest number). For the "add it here" message. */
export function suggestPartition(map) {
  const keys = partitionKeys(map);
  const stat = (k) => { const fs = map.assignments?.[k] ?? []; return [fs.reduce((a, f) => a + seconds(map, f), 0), fs.length]; };
  return keys.reduce((best, k) => {
    const [a, b] = [stat(k), stat(best)];
    return a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]) ? k : best;
  });
}

const isExpectedSkip = (map, group, name) => (map.expectedSkips?.[group] ?? []).some((p) => name.startsWith(p));

/**
 * Problems with ONE run's manifest against the files it was supposed to run. Pure.
 * @param {"offline"|"postgres"} group
 * @param {string[]} expected the files the run was assigned
 * @param {{files: Record<string, {tests:number,fail:number,cancelled:number,todo:number,skippedNames:string[]}>}} manifest
 */
export function manifestProblems(map, group, expected, manifest) {
  const problems = [];
  const files = manifest?.files ?? {};
  for (const f of expected) {
    const r = files[f];
    if (!r) { problems.push(`MISSING: ${f} produced no result (never ran, or crashed before reporting)`); continue; }
    if (r.tests === 0) problems.push(`EMPTY: ${f} ran zero tests`);
    if (r.fail > 0 || r.cancelled > 0) problems.push(`FAILED: ${f} has ${r.fail} failed / ${r.cancelled} cancelled`);
    if (r.todo > 0) problems.push(`TODO: ${f} has ${r.todo} test(s) marked todo; a todo is a test that does not assert`);
    for (const name of r.skippedNames ?? []) {
      if (!isExpectedSkip(map, group, name)) problems.push(`UNEXPECTED SKIP: ${f} skipped "${name}". If this skip is intended, name it in expectedSkips.${group} of the partition map.`);
    }
  }
  const want = new Set(expected);
  for (const f of Object.keys(files)) if (!want.has(f)) problems.push(`UNASSIGNED RESULT: ${f} ran but was not assigned to this run`);
  return problems;
}

/** Totals of one manifest. */
export function totals(manifest) {
  const t = { files: 0, tests: 0, pass: 0, fail: 0, skipped: 0, todo: 0, cancelled: 0 };
  for (const r of Object.values(manifest?.files ?? {})) {
    t.files++;
    for (const k of ["tests", "pass", "fail", "skipped", "todo", "cancelled"]) t[k] += r[k];
  }
  return t;
}

/**
 * The gate job's check. `postgres` is { "1": manifest|undefined, ... } for every partition; `offline` is the offline run's
 * manifest. A partition that did not report, or that reported something the per-run check rejects, fails the gate.
 */
export function aggregateProblems(map, registry, postgres, offline) {
  const problems = [...mapProblems(map, registry)];
  const seen = new Map();
  for (const k of partitionKeys(map)) {
    const m = postgres[k];
    if (!m) { problems.push(`MISSING PARTITION: partition ${k} left no manifest`); continue; }
    problems.push(...manifestProblems(map, "postgres", map.assignments[k] ?? [], m).map((p) => `partition ${k}: ${p}`));
    for (const f of Object.keys(m.files ?? {})) {
      if (seen.has(f)) problems.push(`DUPLICATE RESULT: ${f} ran in partition ${seen.get(f)} and partition ${k}`);
      else seen.set(f, k);
    }
  }
  for (const f of registry.postgres) if (!seen.has(f)) problems.push(`NOT RUN: ${f} is registered but no partition ran it`);
  if (!offline) problems.push("MISSING: the offline run left no manifest");
  else problems.push(...manifestProblems(map, "offline", registry.offline, offline).map((p) => `offline: ${p}`));
  return problems;
}

const readManifest = (p) => JSON.parse(readFileSync(p, "utf8"));

function main(argv) {
  const [cmd, ...rest] = argv;
  const map = loadMap();
  const registry = loadRegistry();
  const fail = (problems) => {
    for (const p of problems) console.error(`::error::${p}`);
    console.error(`${problems.length} problem(s)`);
    process.exit(1);
  };
  if (cmd === "check-map") {
    const problems = mapProblems(map, registry);
    if (problems.length) fail(problems);
    console.log(`partition map: ${registry.postgres.length} postgres suites in ${map.partitions} partitions, each exactly once`);
  } else if (cmd === "files") {
    const files = map.assignments?.[rest[0]];
    if (!files) { console.error(`no partition "${rest[0]}"`); process.exit(2); }
    console.log(files.join("\n"));
  } else if (cmd === "check-manifest") {
    const [group, file, n] = rest;
    const expected = group === "postgres" ? map.assignments?.[n] : registry.offline;
    if (!expected) { console.error("usage: check-manifest <postgres|offline> <manifest.json> [partition]"); process.exit(2); }
    const m = readManifest(file);
    const problems = manifestProblems(map, group, expected, m);
    const t = totals(m);
    console.log(`${group}${n ? ` partition ${n}` : ""}: ${t.files} files, ${t.tests} tests, ${t.pass} pass, ${t.fail} fail, ${t.skipped} skipped, ${t.todo} todo, ${t.cancelled} cancelled`);
    if (problems.length) fail(problems);
  } else if (cmd === "aggregate") {
    const dir = rest[0];
    const postgres = {};
    for (const k of partitionKeys(map)) {
      const p = join(dir, `manifest-postgres-${k}.json`);
      if (existsSync(p)) postgres[k] = readManifest(p);
    }
    const op = join(dir, "manifest-offline.json");
    const offline = existsSync(op) ? readManifest(op) : null;
    const problems = aggregateProblems(map, registry, postgres, offline);
    const sum = { files: 0, tests: 0, pass: 0, fail: 0, skipped: 0 };
    for (const m of Object.values(postgres)) for (const [k, v] of Object.entries(totals(m))) if (k in sum) sum[k] += v;
    const o = totals(offline);
    console.log(`postgres (all partitions): ${sum.files} files, ${sum.tests} tests, ${sum.pass} pass, ${sum.fail} fail, ${sum.skipped} skipped`);
    console.log(`offline: ${o.files} files, ${o.tests} tests, ${o.pass} pass, ${o.fail} fail, ${o.skipped} skipped`);
    console.log(`TOTAL: ${sum.tests + o.tests} tests executed, ${sum.skipped + o.skipped} skipped (all named in expectedSkips)`);
    if (problems.length) fail(problems);
    console.log("aggregate: every registered suite ran exactly once, none empty, none failed, no unexpected skip");
  } else {
    console.error("usage: adminPolicyPartitions.mjs check-map | files <n> | check-manifest <group> <file> [n] | aggregate <dir>");
    process.exit(2);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
