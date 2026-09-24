// PERSONA SUITE REGISTRATION -- the smallest deterministic proof that the two material persona
// suites cannot silently disappear from execution.
//
// WHY THIS EXISTS. personaAuthorityDimensions.test.mjs and personaE2EHarness.test.mjs are the
// governance/E2E evidence for the persona authority model, and both were named by ZERO npm
// scripts. personaAuthorityDimensions.v1.json was already a workflow path filter, but the filter
// triggered no job that ran either test -- so the manifest's own governance proof sat FAILING,
// unseen, on a stale expectation. field-ops-app-vite/test/ciSuiteCoverage.test.mjs is the
// equivalent census for that package and covers field-ops-app-vite/test/ ONLY; functions/test/ is
// outside it, which is the structural reason registration-blind suites keep being found here.
//
// This is deliberately NOT a general framework. It pins exactly three suites -- the two persona
// suites and itself -- to an npm script that a workflow actually invokes, and to a path filter in
// BOTH of that workflow's trigger blocks. A suite registered where it silently skips is worse than
// unregistered, because it looks green.
//
// Pure: reads package.json and the workflow as files. No database, no Firebase, no network.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FUNCTIONS_DIR = resolve(HERE, "..");
const REPO_ROOT = resolve(FUNCTIONS_DIR, "..");
const WORKFLOW = join(REPO_ROOT, ".github/workflows/eos-admin-policy-tests.yml");

const PACKAGE = JSON.parse(readFileSync(join(FUNCTIONS_DIR, "package.json"), "utf8"));
const YML = readFileSync(WORKFLOW, "utf8").replace(/\r\n/g, "\n");

// The suites this guard refuses to let go dark, and the group each must execute in. Both persona
// suites are OFFLINE -- no database, no emulator -- so test:adminPolicy (which runs with
// POLICY_TEST_DATABASE_URL deliberately unset) is where they actually run rather than skip.
const GUARDED = {
  "test/personaAuthorityDimensions.test.mjs": "test:adminPolicy",
  "test/personaE2EHarness.test.mjs": "test:adminPolicy",
  "test/personaSuiteRegistration.test.mjs": "test:adminPolicy", // this file: the guard guards itself
};

// Parse every `paths:` block in the workflow into its own list, the way the role-governance guard
// does. A registration on pull_request alone would still let a direct push to main go untriggered.
const pathsBlocks = () => {
  const blocks = [];
  let current = null;
  for (const line of YML.split("\n")) {
    if (/^\s*paths:\s*$/.test(line)) {
      current = [];
      blocks.push(current);
      continue;
    }
    if (!current) continue;
    const entry = /^\s*- "(.+)"\s*$/.exec(line);
    if (entry) current.push(entry[1]);
    else if (line.trim() && !line.trim().startsWith("#")) current = null;
  }
  return blocks;
};

test("every guarded persona suite exists on disk", () => {
  for (const suite of Object.keys(GUARDED)) {
    assert.ok(existsSync(join(FUNCTIONS_DIR, suite)), `${suite} is guarded but does not exist`);
  }
});

test("every guarded persona suite is NAMED by the npm script that is supposed to run it", () => {
  for (const [suite, script] of Object.entries(GUARDED)) {
    const command = PACKAGE.scripts[script];
    assert.ok(command, `package.json has no script ${script}`);
    const named = command.split(/\s+/).filter((t) => t === suite);
    assert.equal(named.length, 1,
      `${suite} must appear exactly once in ${script}; found ${named.length}. A suite named by no npm script runs nowhere, and one named twice hides a dropped entry.`);
  }
});

test("the npm script that runs them is INVOKED by the workflow -- registration in a script nothing calls is not registration", () => {
  for (const script of new Set(Object.values(GUARDED))) {
    assert.ok(YML.includes(`npm run ${script}`),
      `${script} is not invoked by ${WORKFLOW}; the suites registered in it would never execute in CI`);
  }
});

test("every guarded persona suite is named by a path filter in EVERY trigger block, not just pull_request", () => {
  const blocks = pathsBlocks();
  assert.equal(blocks.length, 2, "expected a pull_request and a push paths block");
  for (const [i, block] of blocks.entries()) {
    for (const suite of Object.keys(GUARDED)) {
      assert.ok(block.includes(`functions/${suite}`),
        `paths block ${i + 1} does not name functions/${suite}; an edit to that suite alone would trigger no job`);
    }
    // The fixtures these suites read are their real inputs: a fixture-only edit is exactly how the
    // PARTS_OPERATIONS expectation went stale, so the fixtures must trigger the gate too.
    for (const fixture of [
      "functions/scripts/fixtures/personaAuthorityDimensions.v1.json",
      "functions/scripts/fixtures/personaE2EScenarios.v1.json",
      "functions/scripts/fixtures/sampleCompany.v2.json",
      "functions/scripts/fixtures/syntheticNonprodWorkforceSeed.v1.json",
    ]) {
      assert.ok(block.includes(fixture),
        `paths block ${i + 1} does not name ${fixture}; a fixture-only edit would leave these suites untriggered`);
    }
  }
});

test("the guarded suites cannot SILENTLY SKIP in the offline group they are registered in", () => {
  // A suite registered where it silently skips is worse than unregistered, because it looks green.
  // test:adminPolicy runs with POLICY_TEST_DATABASE_URL deliberately unset, so a database-bound or
  // emulator-bound suite placed there would skip and prove nothing.
  //
  // MEASURED, NOT GREPPED FOR TOKENS. A substring scan for "POLICY_TEST_DATABASE_URL" would fire on
  // personaE2EHarness.test.mjs, which NAMES that class of token inside a static guard in order to
  // forbid it -- the same false positive that put the PARTS_OPERATIONS expectation out of date. The
  // real property is narrower and exact: a suite can only skip conditionally if it reads the
  // environment, and can only skip at all if it asks to. Neither suite does either.
  const offline = Object.keys(GUARDED).filter((s) => s !== "test/personaSuiteRegistration.test.mjs");
  assert.equal(offline.length, 2);
  for (const suite of offline) {
    const source = readFileSync(join(FUNCTIONS_DIR, suite), "utf8");
    assert.ok(!/process\s*\.\s*env/.test(source),
      `${suite} reads process.env; it is registered in the OFFLINE group ${GUARDED[suite]} and could become environment-conditional there`);
    assert.ok(!/\bskip\s*:/.test(source) && !/\.skip\s*\(/.test(source) && !/\btodo\s*:/.test(source),
      `${suite} can skip or is marked todo; a skipped suite in ${GUARDED[suite]} looks green while proving nothing`);
  }
});
