// F0 -- an unqualified or accidental Firebase deploy cannot silently target production.
//
// Four layers are proven here:
//   1. the pure decision (decideFirebaseDeploy) over every project class;
//   2. the wiring: every deployable target in firebase.json runs the guard FIRST, .firebaserc names no real
//      project, and no package.json script, workflow or runbook deploys without an explicit --project;
//   3. the governed procedures still pass: the production runbook and deployHosting --allow-production
//      carry the commit-bound confirmation, and only for production;
//   4. END TO END through firebase-tools' OWN predeploy runner (lib/deploy/lifecycleHooks.js, offline): a
//      production deploy of every target -- including `--only firestore:rules` and a single
//      `functions:<name>` -- is rejected before prepare, and the deploy pipeline still runs predeploy
//      hooks before any prepare/deploy/release step.
// No test here contacts Google: the hook runner is invoked directly, never `firebase deploy`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONFIRMATION_ENV, DEPLOY_TARGETS, PRODUCTION_FLOOR, decideFirebaseDeploy, productionConfirmation, projectClasses,
} from "./firebaseDeployGuard.mjs";
import { deployEnvironment } from "./deployHosting.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(REPO, p), "utf8");
const registry = JSON.parse(read("config/environments.json"));
const firebaseJson = JSON.parse(read("firebase.json"));
const SHA = "0123456789abcdef0123456789abcdef01234567";
const decide = (over) => decideFirebaseDeploy({ target: "functions", headSha: SHA, registry, ...over });

// ---------------------------------------------------------------- 1. decision
test("production is refused without the commit-bound confirmation, for every target", () => {
  for (const target of DEPLOY_TARGETS) {
    const d = decide({ projectId: "taylor-parts", target });
    assert.equal(d.allowed, false, target);
    assert.equal(d.code, "PRODUCTION_UNCONFIRMED");
  }
});

test("a confirmation for another commit, another project, another target, no target, or a bare yes is refused", () => {
  for (const confirmation of [`taylor-parts@${"f".repeat(40)}:functions`, `eos-platform-sandbox@${SHA}:functions`,
    `taylor-parts@${SHA}:hosting`, `taylor-parts@${SHA}`, `taylor-parts@${SHA}:functions,hosting`, `taylor-parts@${SHA}:*`,
    "taylor-parts", "yes", "1"]) {
    const d = decide({ projectId: "taylor-parts", confirmation });
    assert.equal(d.allowed, false, confirmation);
    assert.equal(d.code, "PRODUCTION_CONFIRMATION_MISMATCH");
  }
});

test("production with the exact confirmation for this commit is the governed path", () => {
  const d = decide({ projectId: "taylor-parts", confirmation: productionConfirmation("taylor-parts", SHA, "functions") });
  assert.deepEqual([d.allowed, d.code], [true, "PRODUCTION_CONFIRMED"]);
});

test("production refuses when the deployed commit cannot be identified", () => {
  for (const headSha of [null, "", "HEAD", "abc123"]) {
    const d = decide({ projectId: "taylor-parts", confirmation: `taylor-parts@${headSha}:functions`, headSha });
    assert.deepEqual([d.allowed, d.code], [false, "PRODUCTION_NO_COMMIT"], String(headSha));
  }
});

test("no project, the demo default and undeclared projects are refused", () => {
  assert.equal(decide({ projectId: undefined }).code, "NO_PROJECT");
  assert.equal(decide({ projectId: "  " }).code, "NO_PROJECT");
  assert.equal(decide({ projectId: "demo-eos-no-default-project" }).code, "DEMO_PROJECT");
  assert.equal(decide({ projectId: "taylor-parts-staging" }).code, "UNDECLARED_PROJECT");
  for (const projectId of [undefined, "demo-eos-no-default-project", "taylor-parts-staging"]) {
    assert.equal(decide({ projectId }).allowed, false);
  }
});

test("declared non-production projects deploy without any confirmation (sandbox refresh unchanged)", () => {
  for (const projectId of ["eos-platform-sandbox", "eos-platform-certification"]) {
    assert.deepEqual([decide({ projectId }).allowed, decide({ projectId }).code], [true, "NON_PRODUCTION"]);
  }
});

test("the production floor holds even if the registry were misread", () => {
  assert.ok(PRODUCTION_FLOOR.includes("taylor-parts"));
  const empty = decideFirebaseDeploy({ projectId: "taylor-parts", target: "hosting", headSha: SHA, registry: {} });
  assert.equal(empty.code, "PRODUCTION_UNCONFIRMED");
  const relabelled = { environments: [{ role: "sandbox", firebase: { projectId: "taylor-parts" } }] };
  assert.equal(projectClasses(relabelled).nonProduction.has("taylor-parts"), false);
  assert.equal(decideFirebaseDeploy({ projectId: "taylor-parts", target: "hosting", headSha: SHA, registry: relabelled }).allowed, false);
});

test("every registry production project is refused, not only the floor", () => {
  const { production } = projectClasses(registry);
  for (const env of registry.environments) if (env.role === "production" && env.firebase?.projectId) assert.ok(production.has(env.firebase.projectId));
});

test("an unguarded target name is refused rather than waved through", () => {
  assert.equal(decide({ projectId: "eos-platform-sandbox", target: "database" }).code, "UNKNOWN_TARGET");
});

test("ONE confirmation authorizes ONE target: a confirmed functions deploy that forgot --only is refused everywhere else", () => {
  const confirmation = productionConfirmation("taylor-parts", SHA, "functions");
  for (const target of DEPLOY_TARGETS) {
    assert.equal(decide({ projectId: "taylor-parts", target, confirmation }).allowed, target === "functions", target);
  }
});

// ---------------------------------------------------------------- 2. wiring
test("every deployable firebase.json target runs the guard as its FIRST predeploy command", () => {
  const targets = Object.keys(firebaseJson).filter((k) => k !== "emulators");
  assert.deepEqual([...targets].sort(), [...DEPLOY_TARGETS].sort(),
    "a new firebase.json target must be added to DEPLOY_TARGETS and guarded in the same change");
  for (const target of targets) {
    for (const config of [].concat(firebaseJson[target])) {
      const hooks = [].concat(config.predeploy ?? []);
      assert.equal(hooks[0], `node scripts/firebaseDeployGuard.mjs ${target}`, target);
    }
  }
});

test(".firebaserc names no real project: the default is an emulator-only demo project", () => {
  const rc = JSON.parse(read(".firebaserc"));
  const { production, nonProduction } = projectClasses(registry);
  assert.match(rc.projects.default, /^demo-/);
  for (const id of Object.values(rc.projects)) {
    assert.match(id, /^demo-/, `alias -> ${id}`);
    assert.ok(!production.has(id) && !nonProduction.has(id), id);
  }
  assert.equal(rc.targets, undefined, "deploy targets would bind a real project");
});

const SKIP_DIRS = new Set(["node_modules", ".git", ".claude", "dist", "lib", "archive"]);
function walk(dir, pick, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, pick, out);
    else if (pick(entry.name)) out.push(p);
  }
  return out;
}
const DEPLOY = /\bfirebase(?:-tools|\.js)?["']?\s*,?\s*["']?deploy\b/;

test("no package.json script deploys to Firebase (functions' npm run deploy is retired)", () => {
  for (const file of walk(REPO, (n) => n === "package.json")) {
    const scripts = JSON.parse(readFileSync(file, "utf8")).scripts ?? {};
    for (const [name, body] of Object.entries(scripts)) {
      assert.ok(!DEPLOY.test(body), `${relative(REPO, file)} "${name}": ${body}`);
    }
  }
  const fnDeploy = JSON.parse(read("functions/package.json")).scripts.deploy;
  assert.match(fnDeploy, /REFUSED/);
  assert.match(fnDeploy, /exit 1/);
});

test("no CI workflow runs a Firebase deploy", () => {
  for (const file of walk(join(REPO, ".github", "workflows"), (n) => /\.ya?ml$/.test(n))) {
    const lines = readFileSync(file, "utf8").split("\n").filter((l) => !/^\s*#/.test(l));
    for (const line of lines) assert.ok(!DEPLOY.test(line), `${relative(REPO, file)}: ${line.trim()}`);
  }
});

test("every runbook that deploys names its project explicitly, and production carries the commit-bound confirmation", () => {
  const runbooks = walk(join(REPO, "scripts"), (n) => /\.(sh|mjs|ps1)$/.test(n) && !/\.test\./.test(n));
  let deploys = 0;
  for (const file of runbooks) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      const code = line.trim();
      if (/^(#|\/\/|\*|echo\b|console\.|['"])/.test(code) || !DEPLOY.test(code)) return; // comments, echoes, quoted data
      deploys += 1;
      const window = lines.slice(i, i + 3).join(" ");
      assert.match(window, /--project/, `${relative(REPO, file)}:${i + 1} deploys without --project`);
      if (/taylor-parts|\$PROJECT_ID/.test(window) && /_prodRelease/.test(file)) {
        assert.match(code, new RegExp(`^${CONFIRMATION_ENV}="\\$PROJECT_ID@\\$\\(git rev-parse HEAD\\):(\\w+)" firebase deploy --only \\1 `),
          `${relative(REPO, file)}:${i + 1} production deploy without the scoped confirmation`);
      }
    });
  }
  assert.ok(deploys >= 4, `expected the governed deploy commands to be found, saw ${deploys}`);
  assert.doesNotMatch(read("scripts/_prodRelease.run.sh"), new RegExp(`export\\s+${CONFIRMATION_ENV}`));
});

// ---------------------------------------------------------------- 3. governed procedures
test("deployHosting carries the confirmation for production only, and strips an inherited one otherwise", () => {
  const inherited = { [CONFIRMATION_ENV]: `taylor-parts@${SHA}:firestore`, PATH: "/bin" };
  const prod = deployEnvironment({ role: "production", projectId: "taylor-parts" }, inherited, SHA);
  assert.equal(prod[CONFIRMATION_ENV], `taylor-parts@${SHA}:hosting`, "an inherited firestore confirmation must not survive into a hosting deploy");
  const sandbox = deployEnvironment({ role: "sandbox", projectId: "eos-platform-sandbox" }, inherited, SHA);
  assert.equal(sandbox[CONFIRMATION_ENV], undefined);
  assert.equal(sandbox.PATH, "/bin");
});

// ---------------------------------------------------------------- 4. end to end via firebase-tools
const require = createRequire(join(REPO, "functions", "package.json"));
let lifecycleHooks = null;
let deployIndexSource = null;
try {
  lifecycleHooks = require("firebase-tools/lib/deploy/lifecycleHooks.js").lifecycleHooks;
  deployIndexSource = readFileSync(require.resolve("firebase-tools/lib/deploy/index.js"), "utf8");
} catch { /* functions/node_modules absent */ }
const e2e = lifecycleHooks ? test : (name, fn) => test(name, { skip: process.env.CI ? false : "functions/node_modules not installed" },
  () => assert.fail("firebase-tools must be installed in CI (npm ci in functions/) to prove the hook wiring"));

function runHook(target, { project, only, env = {} }) {
  const options = {
    project, only, projectRoot: REPO,
    config: { projectDir: REPO, get: (k) => firebaseJson[k], path: (p) => join(REPO, p) },
  };
  const saved = { ...process.env };
  delete process.env[CONFIRMATION_ENV];
  Object.assign(process.env, env);
  return lifecycleHooks(target, "predeploy")({}, options).finally(() => {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  });
}
const HEAD = (() => { try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO, encoding: "utf8" }).trim(); } catch { return null; } })();

e2e("firebase-tools still runs every predeploy hook before any prepare/deploy/release step", () => {
  const pre = deployIndexSource.indexOf("await chain(predeploys");
  const prep = deployIndexSource.indexOf("await chain(prepares");
  assert.ok(pre > 0 && prep > pre, "deploy/index.js ordering changed -- re-verify the guard's position before upgrading firebase-tools");
});

const ACCIDENTS = [
  ["firestore", "firestore:rules"], ["firestore", "firestore:indexes"], ["storage", "storage"],
  ["functions", "functions"], ["functions", "functions:receiveInventoryStock"], ["hosting", "hosting"], ["functions", undefined],
];
for (const [target, only] of ACCIDENTS) {
  e2e(`an unconfirmed production deploy (--only ${only ?? "<all>"}) is rejected by the real hook runner`, async () => {
    await assert.rejects(runHook(target, { project: "taylor-parts", only }), new RegExp(`${target} predeploy error`));
  });
}

e2e("the repository default (demo project) is rejected by the real hook runner", async () => {
  await assert.rejects(runHook("hosting", { project: JSON.parse(read(".firebaserc")).projects.default, only: "hosting" }), /predeploy error/);
});

e2e("a leftover confirmation for another commit is rejected by the real hook runner", async () => {
  await assert.rejects(runHook("firestore", { project: "taylor-parts", only: "firestore:rules", env: { [CONFIRMATION_ENV]: `taylor-parts@${"e".repeat(40)}:firestore` } }), /predeploy error/);
});

e2e("a confirmation LEFT IN THE SHELL for this commit's functions deploy cannot carry Rules, indexes, storage or hosting", async () => {
  if (!HEAD) return;
  const env = { [CONFIRMATION_ENV]: `taylor-parts@${HEAD}:functions` };
  for (const [target, only] of [["firestore", "firestore:rules"], ["firestore", "firestore:indexes"], ["storage", "storage"], ["hosting", "hosting"]]) {
    await assert.rejects(runHook(target, { project: "taylor-parts", only, env }), /predeploy error/, only);
  }
});

e2e("a confirmed production deploy that FORGOT --only is stopped at the first unconfirmed target's hook", async () => {
  if (!HEAD) return;
  const env = { [CONFIRMATION_ENV]: `taylor-parts@${HEAD}:functions` };
  await runHook("functions", { project: "taylor-parts", only: undefined, env });
  await assert.rejects(runHook("firestore", { project: "taylor-parts", only: undefined, env }), /firestore predeploy error/);
});

e2e("the governed paths pass the real hook runner: sandbox, and production confirmed for HEAD", async () => {
  await runHook("functions", { project: "eos-platform-sandbox", only: "functions" });
  await runHook("functions", { project: "eos-platform-certification", only: "functions" });
  if (HEAD) await runHook("hosting", { project: "taylor-parts", only: "hosting", env: { [CONFIRMATION_ENV]: `taylor-parts@${HEAD}:hosting` } });
});

test("the guard file exists where firebase.json points", () => {
  assert.ok(existsSync(join(REPO, "scripts", "firebaseDeployGuard.mjs")));
});
