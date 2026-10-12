// Contract tests for the Admin policy lane's relevance gate (Owner ruling M3, 2026-10-12).
// Run: node --test scripts/adminPolicyCiRelevance.test.mjs   (plain node, no install; needs git for the CLI cases)
//
// What must stay true for "Admin policy engine -- authorization, workflow, tenancy, schema, seed" to be a
// REQUIRED check without stranding unrelated pull requests:
//   1. the workflow starts on every pull request -- no `paths:` / `paths-ignore:` trigger filter anywhere;
//   2. the heavy jobs are gated at JOB level (a skipped job is a passing required check; a skipped STEP
//      inside a running job is not what the rule turns on), under their unchanged names;
//   3. the gate fails closed -- only a positive `relevant=false` skips them;
//   4. the relevance list is the one source of truth, well-formed, and registers its own machinery.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PATHS_FILE, changedFiles, loadGlobs, matchingChanges, parsePathsFile } from "./adminPolicyCiRelevance.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW = ".github/workflows/eos-admin-policy-tests.yml";
const YML = readFileSync(resolve(ROOT, WORKFLOW), "utf8").replace(/\r\n/g, "\n");
const POLICY_NAME = "Admin policy engine -- authorization, workflow, tenancy, schema, seed";
const SURFACES_NAME = "Admin policy surfaces -- view model, entity registry, rendered grid";
const GATE = "if: ${{ !cancelled() && needs.changes.outputs.relevant != 'false' }}";

/** The text of one top-level job block (from `  <id>:` to the next two-space key or EOF). */
const jobBlock = (id) => {
  const start = YML.search(new RegExp(`^  ${id}:\\s*$`, "m"));
  assert.ok(start >= 0, `${WORKFLOW} has no job '${id}'`);
  const rest = YML.slice(start + 1);
  const next = rest.search(/^  [A-Za-z0-9_-]+:\s*$/m);
  return next >= 0 ? rest.slice(0, next) : rest;
};

test("the workflow starts on EVERY pull request: no paths filter of any kind", () => {
  assert.doesNotMatch(YML, /^\s*paths(-ignore)?:/m, "a paths filter would strand unrelated PRs on a required check");
  assert.match(YML, /^on:\n  pull_request:\n  push:\n    branches: \[main\]\n  workflow_dispatch:\n/m);
});

test("policy and surfaces are gated at JOB level, under their unchanged check names", () => {
  for (const [id, name] of [["policy", POLICY_NAME], ["surfaces", SURFACES_NAME]]) {
    const block = jobBlock(id);
    assert.match(block, new RegExp(`^    name: ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"), `${id} check name changed`);
    assert.match(block, /^    needs: changes$/m, `${id} must depend on the changes job`);
    const lines = block.split("\n").filter((l) => /^    if:/.test(l));
    assert.deepEqual(lines, [`    ${GATE}`], `${id} must carry exactly the fail-closed job-level gate`);
  }
});

test("the changes job is cheap and decides from the committed list", () => {
  const block = jobBlock("changes");
  assert.doesNotMatch(block, /services:|npm ci|npm install/, "the changes job must not install or start services");
  assert.match(block, /node --test scripts\/adminPolicyCiRelevance\.test\.mjs/);
  assert.match(block, /node scripts\/adminPolicyCiRelevance\.mjs --base "\$BASE" --head "\$HEAD"/);
  assert.match(block, /relevant: \$\{\{ steps\.decide\.outputs\.relevant \}\}/);
  assert.match(block, /fetch-depth: 0/);
});

test("the list is well formed, non-empty, and registers the lane's own machinery", () => {
  const globs = loadGlobs(ROOT);
  assert.ok(globs.length > 400, `expected the full former union, found ${globs.length}`);
  for (const self of [PATHS_FILE, WORKFLOW, "scripts/adminPolicyCiRelevance.mjs", "scripts/adminPolicyCiRelevance.test.mjs",
    "scripts/ciTriggerCoverage.lib.mjs"]) {
    assert.ok(matchingChanges([self], globs).length === 1, `${self} must be selected by ${PATHS_FILE}`);
  }
});

test("unsupported glob syntax is refused rather than silently matching nothing", () => {
  assert.deepEqual(parsePathsFile("# c\n\n a/**\nb/*.js\n"), ["a/**", "b/*.js"]);
  for (const bad of ["!a/**", "a/{b,c}.js", "a/[ab].js", "\"a/b.js\"", "a b"]) {
    assert.throws(() => parsePathsFile(`${bad}\n`), /unsupported glob syntax/, bad);
  }
});

test("matching follows the paths-filter semantics: ** crosses /, * does not", () => {
  const globs = ["functions/src/adminPolicy/**", "field-ops-app-vite/src/modules/administration/Workflow*.jsx", "a/b.js"];
  assert.deepEqual(matchingChanges(["functions/src/adminPolicy/x/y.ts"], globs), ["functions/src/adminPolicy/x/y.ts"]);
  assert.deepEqual(matchingChanges(["field-ops-app-vite/src/modules/administration/WorkflowBuilder.jsx"], globs).length, 1);
  assert.deepEqual(matchingChanges(["field-ops-app-vite/src/modules/administration/sub/Workflow.jsx"], globs), []);
  assert.deepEqual(matchingChanges(["a/b.jsx", "README.md", "docs/x.md"], globs), []);
});

test("an irrelevant real path set is irrelevant against the real list", () => {
  const globs = loadGlobs(ROOT);
  assert.deepEqual(matchingChanges(["README.md", "docs/DECISIONS.md", "sb-evidence/x.txt"], globs), []);
});

// The CLI against this repository's own git. Skipped only where there is no git checkout at all.
const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
let HEAD = null;
try { HEAD = git("rev-parse", "HEAD"); } catch { HEAD = null; }
const cli = (...args) => execFileSync(process.execPath, [resolve(ROOT, "scripts/adminPolicyCiRelevance.mjs"), ...args],
  { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

test("CLI: no base (dispatch / branch creation) -> the lane runs", { skip: HEAD ? false : "no git checkout" }, () => {
  assert.equal(cli("--base", "", "--head", "HEAD"), "relevant=true");
});

test("CLI: an undiffable base fails CLOSED -> the lane runs", { skip: HEAD ? false : "no git checkout" }, () => {
  assert.equal(cli("--base", "0123456789abcdef0123456789abcdef01234567", "--head", "HEAD"), "relevant=true");
});

test("CLI: an empty diff -> relevant=false (the only way the lane skips)", { skip: HEAD ? false : "no git checkout" }, () => {
  assert.equal(cli("--base", HEAD, "--head", HEAD), "relevant=false");
});

test("changedFiles: a non-ASCII or space-bearing path arrives as its real name, not git's C-quoted form", () => {
  const dir = mkdtempSync(join(tmpdir(), "admin-policy-relevance-"));
  try {
    const g = (...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid",
      "-c", "commit.gpgsign=false", "-c", "core.quotePath=true", ...args], { cwd: dir, encoding: "utf8" }).trim();
    g("init", "-q");
    writeFileSync(join(dir, "seed.txt"), "x");
    g("add", "-A"); g("commit", "-q", "-m", "base");
    const base = g("rev-parse", "HEAD");
    mkdirSync(join(dir, "functions", "src", "adminPolicy"), { recursive: true });
    writeFileSync(join(dir, "functions", "src", "adminPolicy", "café policy.ts"), "x");
    g("add", "-A"); g("commit", "-q", "-m", "head");
    const files = changedFiles(base, "HEAD", dir);
    assert.deepEqual(files, ["functions/src/adminPolicy/café policy.ts"]);
    assert.deepEqual(matchingChanges(files, ["functions/src/adminPolicy/**"]), files);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ============================ COMPLETENESS ============================
//
// Everything the gated jobs EXECUTE must be selected by the list, or an edit to that file alone would skip
// the required check green. Pinned: every suite named by functions' test:adminPolicy and
// test:adminPolicyPostgres, every client suite the `surfaces` job runs, and every root script the
// `policy` job runs directly. Coverage by glob counts (the list is what the gate reads).
test("COMPLETENESS: every suite and script the gated jobs run is selected by the list", () => {
  const globs = loadGlobs(ROOT);
  const pkg = JSON.parse(readFileSync(resolve(ROOT, "functions/package.json"), "utf8"));
  const executed = new Set();
  for (const script of ["test:adminPolicy", "test:adminPolicyPostgres"]) {
    const command = pkg.scripts[script];
    assert.ok(command, `functions/package.json has no ${script}`);
    const suites = command.split(/\s+/).filter((t) => /\.test\.[cm]?[jt]sx?$/.test(t));
    assert.ok(suites.length > 50, `${script} names suspiciously few suites (${suites.length})`);
    for (const s of suites) executed.add(`functions/${s}`);
  }
  for (const line of jobBlock("surfaces").split("\n")) {
    if (!/^\s*run:\s*(node --test|npx vitest run)\s/.test(line)) continue;
    for (const t of line.split(/\s+/).filter((x) => /^test\/.+\.test\.[cm]?[jt]sx?$/.test(x))) {
      executed.add(`field-ops-app-vite/${t}`);
    }
  }
  for (const m of jobBlock("policy").matchAll(/run: node (scripts\/\S+\.mjs)/g)) executed.add(m[1]);
  assert.ok(executed.size > 150, `parsed too few executed files (${executed.size}); the parser is broken`);
  const unmatched = [...executed].filter((f) => matchingChanges([f], globs).length === 0).sort();
  assert.deepEqual(unmatched, [], `run by a gated job but not selected by ${PATHS_FILE} -- add them there`);
});
