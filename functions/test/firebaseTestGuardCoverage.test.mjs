// REGRESSION (static): no functions test can load a Google/Firebase SDK without the test-safety guard.
//
// (d) Every file under functions/test that imports firebase-admin, any @google-cloud/* package, or the
//     compiled entry lib/index.js must load a guard entry (test/support/firebaseEmulatorGuard.cjs or
//     firebaseOfflineGuard.cjs) as its FIRST module-loading statement. A new test that forgets fails here.
// Plus the things that would quietly defeat the guard even when it is present:
//   - an emulator-mode file that ASSIGNS the emulator address itself (it would override, or stand in
//     for, the caller's explicit configuration the guard exists to require);
//   - an SDK initialized with a literal governed project id;
//   - a CI job that starts an emulator without naming it in the environment, or for a real project.
// Plain node: reads files, loads nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sdkImportsOf, firstGuardOf, firstLoadedSpecifierOf, GUARD_ENTRIES } from "./support/firebaseTestGuardCoverage.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const require = createRequire(import.meta.url);
const { governedProjectIds } = require("./support/firebaseTestGuard.cjs");
const GOVERNED = [...governedProjectIds()];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (name === "node_modules") continue;
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(mjs|cjs|js)$/.test(name)) out.push(full);
  }
  return out;
}
const rel = (f) => path.relative(REPO_ROOT, f).split(path.sep).join("/");
const FILES = walk(HERE).map((file) => ({ file, source: readFileSync(file, "utf8") }));
const SDK_FILES = FILES.filter(({ source }) => sdkImportsOf(source).length > 0);

// ════════════════════ the scanner, proven on controls first ════════════════════

test("scanner: detects every loading form", () => {
  // Controls are written with a placeholder and expanded at runtime, so THIS file is not itself an importer.
  const x = (src) => src.replaceAll("@SDK@", "firebase-admin").replaceAll("@GC@", "@google-cloud");
  const cases = [
    ['import admin from "@SDK@";', ["firebase-admin"]],
    ["import {\n  getFirestore,\n  Timestamp,\n} from '@SDK@/firestore';", ["firebase-admin/firestore"]],
    ['import * as m from "@GC@/secret-manager";', ["@google-cloud/secret-manager"]],
    ['import "@SDK@/app";', ["firebase-admin/app"]],
    ['const { FieldValue } = await import("@SDK@/firestore");', ["firebase-admin/firestore"]],
    ['const admin = require("@SDK@");', ["firebase-admin"]],
    ['import * as indexMod from "../lib/index.js";', ["../lib/index.js"]],
  ];
  for (const [src, expected] of cases) assert.deepEqual(sdkImportsOf(x(src)), expected, src);
});

test("scanner: a fence that only MENTIONS the SDK in strings, regexes or comments is not an importer", () => {
  const x = (src) => src.replaceAll("@SDK@", "firebase-admin");
  const mentions = [
    String.raw`{ pattern: /from\s+["']@SDK@["']/, what: 'import from "@SDK@"' },`,
    `  'import { getFirestore } from "@SDK@/firestore";',`,
    `assert.ok(body.indexOf("x") < body.indexOf('require("@SDK@'));`,
    `// import admin from "@SDK@";`,
    ` * const admin = require("@SDK@");`,
    `const text = "await import(\\"@SDK@\\")";`,
  ];
  for (const src of mentions) assert.deepEqual(sdkImportsOf(x(src)), [], x(src));
});

test("scanner: the guard must be FIRST, not merely present", () => {
  const entry = "./support/firebaseEmulatorGuard.cjs";
  const sdk = ["firebase", "admin"].join("-");
  assert.equal(firstGuardOf(`import "${entry}";\nimport admin from "${sdk}";`), "firebaseEmulatorGuard.cjs");
  assert.equal(firstGuardOf(`require("./support/firebaseOfflineGuard.cjs");\nconst a = require("${sdk}");`), "firebaseOfflineGuard.cjs");
  assert.equal(firstGuardOf(`import admin from "${sdk}";\nimport "${entry}";`), null);
  assert.equal(firstGuardOf(`import assert from "node:assert";\nimport "${entry}";\nimport admin from "${sdk}";`), null);
  assert.equal(firstLoadedSpecifierOf(`// import x from "y";\nimport "${entry}";`), entry);
});

// ════════════════════ (d) coverage of the real fleet ════════════════════

test("(d) the fleet is non-trivial: the scan finds the Firebase-dependent tests", () => {
  // A scanner that silently matched nothing would make every check below vacuous.
  assert.ok(SDK_FILES.length >= 150, `only ${SDK_FILES.length} SDK-loading test files found`);
  const names = SDK_FILES.map(({ file }) => rel(file));
  for (const expected of [
    "functions/test/bootstrapCompatibilityAdmin.test.mjs",
    "functions/test/financialPolicyProfileCommand.test.mjs",
    "functions/test/completeAssignedJob.test.js",
    "functions/test/claimsWriter.test.mjs",
    "functions/test/e2e/lib/testKit.mjs",
  ]) assert.ok(names.includes(expected), expected);
});

test("(d) EVERY test file that loads firebase-admin / @google-cloud / lib/index.js loads the guard FIRST", () => {
  const unguarded = SDK_FILES
    .filter(({ source }) => firstGuardOf(source) === null)
    .map(({ file, source }) => `${rel(file)} (first load: ${firstLoadedSpecifierOf(source)}; loads ${sdkImportsOf(source).join(", ")})`);
  assert.deepEqual(unguarded, [], "add `import \"./support/firebaseEmulatorGuard.cjs\";` (or the offline entry) as the file's first import");
});

test("(d) an emulator-mode file never assigns the emulator address itself (the CALLER must name it)", () => {
  const ASSIGN = /^\s*process\.env\.(FIRESTORE_EMULATOR_HOST|FIREBASE_AUTH_EMULATOR_HOST)\s*(=|\?\?=|\|\|=)/m;
  const offenders = SDK_FILES
    .filter(({ source }) => firstGuardOf(source) === "firebaseEmulatorGuard.cjs" && ASSIGN.test(source))
    .map(({ file }) => rel(file));
  assert.deepEqual(offenders, []);
});

test("(d) an emulator-mode file never hard-codes an emulator port (it reaches the CALLER's emulator)", () => {
  const PORT = /["'`]https?:\/\/(127\.0\.0\.1|localhost):\d+|["'`](127\.0\.0\.1|localhost):\d+["'`]/;
  const offenders = SDK_FILES
    .filter(({ source }) => firstGuardOf(source) === "firebaseEmulatorGuard.cjs")
    .flatMap(({ file, source }) => source.split("\n").filter((l) => !/^\s*(\/\/|\*)/.test(l) && PORT.test(l)).map((l) => `${rel(file)}: ${l.trim()}`));
  assert.deepEqual(offenders, []);
});

test("(d) no guarded test initializes the SDK with a literal governed project id", () => {
  const offenders = [];
  for (const { file, source } of SDK_FILES) {
    for (const m of source.matchAll(/initializeApp\(\s*\{\s*projectId:\s*["']([^"']+)["']/g)) {
      if (GOVERNED.includes(m[1]) || !m[1].startsWith("demo-")) offenders.push(`${rel(file)}: ${m[1]}`);
    }
    for (const m of source.matchAll(/^const (PROJECT_ID|PROJECT) = ["']([^"']+)["']/gm)) {
      if (new RegExp(`initializeApp\\(\\s*\\{\\s*projectId:\\s*${m[1]}\\b`).test(source) && !m[2].startsWith("demo-")) {
        offenders.push(`${rel(file)}: ${m[1]}=${m[2]}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test("(d) the guard entries named by the rule exist", () => {
  for (const entry of GUARD_ENTRIES) assert.ok(statSync(path.join(HERE, "support", entry)).isFile(), entry);
});

// ════════════════════ CI stays emulator-only ════════════════════

const WORKFLOWS = path.join(REPO_ROOT, ".github", "workflows");
const workflowFiles = readdirSync(WORKFLOWS).filter((n) => /\.ya?ml$/.test(n));

/** Split a workflow into its jobs (two-space-indented keys under `jobs:`), by text. */
function jobsOf(text) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.trimEnd() === "jobs:");
  if (start < 0) return [];
  const heads = [];
  for (let i = start + 1; i < lines.length; i += 1) if (/^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[i])) heads.push(i);
  heads.push(lines.length);
  return heads.slice(0, -1).map((h, k) => ({ name: lines[h].trim().replace(/:$/, ""), body: lines.slice(h, heads[k + 1]).join("\n") }));
}

test("CI: every emulator started in a workflow is for a demo- project, never a governed one", () => {
  const offenders = [];
  for (const wf of workflowFiles) {
    const text = readFileSync(path.join(WORKFLOWS, wf), "utf8");
    for (const m of text.matchAll(/emulators:(?:start|exec)[\s\S]*?--project\s+(\S+)/g)) {
      if (!m[1].startsWith("demo-")) offenders.push(`${wf}: --project ${m[1]}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("CI: every job that starts an emulator names it in the job environment (loopback)", () => {
  const offenders = [];
  let jobs = 0;
  for (const wf of workflowFiles) {
    for (const job of jobsOf(readFileSync(path.join(WORKFLOWS, wf), "utf8"))) {
      const only = [...job.body.matchAll(/emulators:start --only ([a-z,]+)/g)].flatMap((m) => m[1].split(","));
      if (only.length === 0) continue;
      jobs += 1;
      const envBlock = /\n {4}env:\n((?: {6}.*\n| *#.*\n)+)/.exec(job.body)?.[1] ?? "";
      if (only.includes("firestore") && !/FIRESTORE_EMULATOR_HOST: 127\.0\.0\.1:\d+/.test(envBlock)) offenders.push(`${wf}#${job.name}: FIRESTORE_EMULATOR_HOST`);
      if (only.includes("auth") && !/FIREBASE_AUTH_EMULATOR_HOST: 127\.0\.0\.1:\d+/.test(envBlock)) offenders.push(`${wf}#${job.name}: FIREBASE_AUTH_EMULATOR_HOST`);
    }
  }
  assert.ok(jobs >= 40, `only ${jobs} emulator jobs found -- the job scan is broken`);
  assert.deepEqual(offenders, []);
});

test("CI: the emulator runners the npm scripts drive use a demo- project", () => {
  for (const script of ["functions/scripts/rulesRegressionRunner.mjs", "functions/scripts/runE2eEmulatorSuite.mjs"]) {
    const text = readFileSync(path.join(REPO_ROOT, script), "utf8");
    for (const id of GOVERNED) assert.doesNotMatch(text, new RegExp(`(projectId:|PROJECT_ID =[^;]*)\\s*"${id}"`), `${script} names ${id} as its project`);
  }
});
