// The partition manifest guard for the admin-policy PostgreSQL suites (lane CIP). Offline: reads files, spawns plain `node --test`
// on a throwaway fixture, touches no database. See scripts/adminPolicyPartitions.mjs for what each check is for.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  aggregateProblems, loadMap, loadRegistry, manifestProblems, mapProblems, suggestPartition, totals, FUNCTIONS_DIR,
} from "../scripts/adminPolicyPartitions.mjs";

const map = loadMap();
const registry = loadRegistry();
const clone = (x) => JSON.parse(JSON.stringify(x));

test("THE COMMITTED MAP is a lossless partition of the registry: every postgres suite in exactly one partition", () => {
  assert.deepEqual(mapProblems(map, registry), []);
  const all = Object.values(map.assignments).flat();
  assert.equal(all.length, registry.postgres.length);
  assert.equal(new Set(all).size, registry.postgres.length);
  assert.ok(map.partitions >= 4 && map.partitions <= 6, "Phase 1 is a 4-6 way split");
});

test("an unassigned registry suite is refused, and the message names the lightest partition to put it in", () => {
  const m = clone(map);
  const dropped = m.assignments["2"].pop();
  const problems = mapProblems(m, registry);
  assert.equal(problems.length, 1);
  assert.match(problems[0], new RegExp(`UNASSIGNED: ${dropped.replace(/[.]/g, "\\.")}`));
  assert.match(problems[0], /partition \d is the lightest/);
});

test("a suite assigned to two partitions is refused", () => {
  const m = clone(map);
  m.assignments["3"].push(m.assignments["1"][0]);
  assert.match(mapProblems(m, registry).join("\n"), /DUPLICATE: .* is assigned to partition 1 and partition 3/);
});

test("a suite the registry does not name, and an empty partition, are refused", () => {
  const m = clone(map);
  m.assignments["1"].push("test/notRegisteredPostgres.test.mjs");
  assert.match(mapProblems(m, registry).join("\n"), /UNKNOWN: test\/notRegisteredPostgres\.test\.mjs/);
  const e = clone(map);
  e.assignments["4"] = [];
  assert.match(mapProblems(e, registry).join("\n"), /partition 4 is missing or empty/);
});

test("a map that has drifted out of balance is refused, so the split cannot quietly regress to one long pole", () => {
  const m = clone(map);
  for (const k of ["2", "3", "4", "5"]) { m.assignments["1"].push(...m.assignments[k]); m.assignments[k] = [m.assignments["1"].pop()]; }
  assert.match(mapProblems(m, registry).join("\n"), /IMBALANCE/);
});

test("suggestPartition picks the lightest measured partition", () => {
  const m = { partitions: 3, assignments: { 1: ["a"], 2: ["b"], 3: ["c"] }, measuredSeconds: { a: 50, b: 10, c: 30 } };
  assert.equal(suggestPartition(m), "2");
});

const ok = (tests = 3) => ({ tests, pass: tests, fail: 0, skipped: 0, todo: 0, cancelled: 0, skippedNames: [] });

test("a run is refused when an assigned file produced no result, ran empty, failed, or ran something unassigned", () => {
  const files = ["test/a.test.mjs", "test/b.test.mjs", "test/c.test.mjs"];
  assert.deepEqual(manifestProblems(map, "postgres", files, { files: Object.fromEntries(files.map((f) => [f, ok()])) }), []);
  const bad = {
    files: {
      "test/a.test.mjs": { ...ok(0) },
      "test/b.test.mjs": { ...ok(2), fail: 1, pass: 1 },
      "test/z.test.mjs": ok(),
    },
  };
  const text = manifestProblems(map, "postgres", files, bad).join("\n");
  assert.match(text, /EMPTY: test\/a\.test\.mjs/);
  assert.match(text, /FAILED: test\/b\.test\.mjs/);
  assert.match(text, /MISSING: test\/c\.test\.mjs/);
  assert.match(text, /UNASSIGNED RESULT: test\/z\.test\.mjs/);
});

test("a skip is refused unless the map names it; a todo is always refused", () => {
  const one = ["test/a.test.mjs"];
  const named = map.expectedSkips.postgres[0];
  const skipped = (name) => ({ files: { "test/a.test.mjs": { ...ok(2), pass: 1, skipped: 1, skippedNames: [name] } } });
  assert.deepEqual(manifestProblems(map, "postgres", one, skipped(`${named} -- emulator not set`)), []);
  assert.match(manifestProblems(map, "postgres", one, skipped("some other proof")).join("\n"), /UNEXPECTED SKIP: test\/a\.test\.mjs skipped "some other proof"/);
  // The same name is not an expected skip in the OTHER group: expectations are per group.
  assert.match(manifestProblems(map, "offline", one, skipped(named)).join("\n"), /UNEXPECTED SKIP/);
  assert.match(manifestProblems(map, "postgres", one, { files: { "test/a.test.mjs": { ...ok(2), todo: 1, pass: 1 } } }).join("\n"), /TODO/);
});

test("the gate aggregation fails on a missing partition, a duplicated result, a suite nobody ran, and a missing offline run", () => {
  const manifests = {};
  for (const [k, files] of Object.entries(map.assignments)) manifests[k] = { files: Object.fromEntries(files.map((f) => [f, ok()])) };
  const offline = { files: Object.fromEntries(registry.offline.map((f) => [f, ok()])) };
  assert.deepEqual(aggregateProblems(map, registry, manifests, offline), []);

  const missing = { ...manifests }; delete missing["3"];
  const text = aggregateProblems(map, registry, missing, offline).join("\n");
  assert.match(text, /MISSING PARTITION: partition 3/);
  assert.match(text, /NOT RUN: /);

  const dup = clone(manifests);
  const stray = map.assignments["1"][0];
  dup["2"].files[stray] = ok();
  assert.match(aggregateProblems(map, registry, dup, offline).join("\n"), /DUPLICATE RESULT: /);

  assert.match(aggregateProblems(map, registry, manifests, null).join("\n"), /the offline run left no manifest/);
});

test("the manifest reporter counts the way node does: suites are not tests, skips and failures are attributed to their file", () => {
  const dir = mkdtempSync(join(tmpdir(), "admin-policy-manifest-"));
  try {
    writeFileSync(join(dir, "fixture.test.mjs"), [
      'import test, { describe } from "node:test";',
      'test("passes", () => {});',
      'test("skipped by design", { skip: "no database" }, () => {});',
      'describe("a suite", () => { test("inside", () => {}); test("inside two", () => {}); });',
      'test("fails", () => { throw new Error("x"); });',
    ].join("\n"));
    const out = join(dir, "manifest.json");
    const env = { ...process.env }; delete env.NODE_TEST_CONTEXT; // a nested `node --test` would otherwise run as a child of this one
    const run = spawnSync(process.execPath, ["--test", "--test-reporter=tap", "--test-reporter-destination=stdout",
      `--test-reporter=${pathToFileURL(resolve(FUNCTIONS_DIR, "scripts/adminPolicyManifestReporter.mjs")).href}`, `--test-reporter-destination=${out}`,
      "fixture.test.mjs"], { cwd: dir, encoding: "utf8", env });
    assert.equal(run.status, 1, "the fixture has one failing test");
    assert.match(run.stdout, /# tests 5\b/, "node's own summary: 5 tests (the describe is not one)");
    const manifest = JSON.parse(readFileSync(out, "utf8"));
    assert.deepEqual(totals(manifest), { files: 1, tests: 5, pass: 3, fail: 1, skipped: 1, todo: 0, cancelled: 0 });
    assert.deepEqual(manifest.files["fixture.test.mjs"].skippedNames, ["skipped by design"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
