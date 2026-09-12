// ENVIRONMENT-SELECTION FAIL-CLOSED GATE.
//
// The rule this file enforces: NO EXPLICIT ENVIRONMENT = REFUSE. An operator
// command that can reach real business data must be told its target, per run, by
// the human who invoked it. None of these may ever pick it: the active gcloud
// project, the active firebase project (.firebaserc "default" is taylor-parts),
// Application Default Credentials (the machine ADC in this program is an
// `authorized_user` whose quota_project_id is `taylor-parts` -- production), the
// working directory, or a default baked into the script.
//
// Three layers, deliberately:
//   1. UNIT      -- the shared helper's refusals are exactly what they claim.
//   2. RATCHET   -- a static sweep of functions/scripts/** and scripts/** that
//                   fails when a NEW ambiently-targetable entry point appears.
//                   This is the part that survives everyone forgetting this doc.
//   3. BEHAVIOUR -- the converted CLIs are actually spawned with no arguments and
//                   must refuse. A guard that is present in the source but never
//                   reached proves nothing.
//
// Registration (an unrun gate proves nothing):
//   npm script : functions/package.json -> "test:environmentSelection"
//   workflow   : .github/workflows/environment-selection-fail-closed-tests.yml
//
// Run: node --test test/environmentSelectionFailClosed.test.mjs   (from functions/)
// Pure: no emulator, no network, no credentials. Every spawned command is one
// that refuses BEFORE it constructs any SDK client.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

import shared from "../scripts/environmentTargetShared.js";

const {
  PRODUCTION_PROJECT_ID,
  EnvironmentTargetError,
  assertProjectTarget,
  assertNonProductionTarget,
  assertResolvedProjectId,
  assertCapabilityActivationProject,
  loadEnvironmentRegistry,
} = shared;

const HERE = dirname(fileURLToPath(import.meta.url));
const FUNCTIONS_DIR = resolve(HERE, "..");
const REPO_ROOT = resolve(FUNCTIONS_DIR, "..");

// ───────────────────────────────── 1. UNIT ─────────────────────────────────

test("assertProjectTarget: refuses when --projectId is absent", () => {
  assert.throws(() => assertProjectTarget({}), /--projectId is required/);
  assert.throws(() => assertProjectTarget({ projectId: "" }), /--projectId is required/);
  // "true" is what the repo's flag parsers store for a valueless `--projectId`.
  assert.throws(() => assertProjectTarget({ projectId: "true" }), /--projectId is required/);
  assert.throws(() => assertProjectTarget(undefined), /--projectId is required/);
});

test("assertProjectTarget: production requires an explicit, matching confirmation", () => {
  assert.throws(
    () => assertProjectTarget({ projectId: PRODUCTION_PROJECT_ID }),
    /requires an explicit, matching --confirmProduction/
  );
  assert.throws(
    () => assertProjectTarget({ projectId: PRODUCTION_PROJECT_ID, confirmProduction: "yes" }),
    /requires an explicit, matching --confirmProduction/
  );
  assert.throws(
    () => assertProjectTarget({ projectId: PRODUCTION_PROJECT_ID, confirmProduction: "TAYLOR-PARTS" }),
    /requires an explicit, matching --confirmProduction/,
    "confirmation must be case-sensitive"
  );
  assert.equal(
    assertProjectTarget({ projectId: PRODUCTION_PROJECT_ID, confirmProduction: PRODUCTION_PROJECT_ID }),
    PRODUCTION_PROJECT_ID
  );
});

test("assertProjectTarget: a non-production project needs no confirmation flag", () => {
  assert.equal(assertProjectTarget({ projectId: "eos-platform-sandbox" }), "eos-platform-sandbox");
});

test("assertNonProductionTarget: refuses production by name, by role, and refuses the unknown", () => {
  assert.throws(() => assertNonProductionTarget(undefined), /--projectId is required/);
  assert.throws(() => assertNonProductionTarget(PRODUCTION_PROJECT_ID), /REFUSING: taylor-parts/);
  assert.throws(() => assertNonProductionTarget("not-a-real-project"), /Unknown projects fail closed/);

  // Role, not name, is the authority: a production environment under any other
  // project id must still be refused.
  const registry = {
    environments: [{ id: "somewhere-else", role: "production", firebase: { projectId: "some-other-id" } }],
  };
  assert.throws(
    () => assertNonProductionTarget("some-other-id", { registry }),
    /has role 'production'/
  );

  const env = assertNonProductionTarget("eos-platform-sandbox");
  assert.equal(env.role, "sandbox");
});

test("assertResolvedProjectId: refuses when the SDK bound to a different project", () => {
  // Validating the typed string is only half a fence -- ambient credentials decide
  // what the SDK actually binds to.
  assert.throws(
    () => assertResolvedProjectId(PRODUCTION_PROJECT_ID, "eos-platform-sandbox"),
    /does not match the confirmed target/
  );
  assert.throws(
    () => assertResolvedProjectId(undefined, "eos-platform-sandbox"),
    /does not match the confirmed target/
  );
  assert.equal(assertResolvedProjectId("eos-platform-sandbox", "eos-platform-sandbox"), "eos-platform-sandbox");
});

test("assertCapabilityActivationProject: refuses an unstated activation environment", () => {
  assert.throws(() => assertCapabilityActivationProject({}), /neither GCLOUD_PROJECT nor GOOGLE_CLOUD_PROJECT is set/);
  assert.equal(assertCapabilityActivationProject({ GCLOUD_PROJECT: "eos-platform-sandbox" }), "eos-platform-sandbox");
  assert.equal(
    assertCapabilityActivationProject({ GOOGLE_CLOUD_PROJECT: "eos-platform-sandbox" }),
    "eos-platform-sandbox"
  );
  // Activation rules and data must come from the SAME environment, or the verdict
  // is meaningless.
  assert.throws(
    () => assertCapabilityActivationProject({ GCLOUD_PROJECT: "taylor-parts" }, "eos-platform-sandbox"),
    /Comparing one environment's activation rules against another environment's data/
  );
});

test("every refusal is an EnvironmentTargetError, not a bare Error", () => {
  assert.throws(() => assertProjectTarget({}), EnvironmentTargetError);
  assert.throws(() => assertNonProductionTarget(PRODUCTION_PROJECT_ID), EnvironmentTargetError);
});

test("the registry still declares taylor-parts as the one production environment", () => {
  // If this ever changes, every refusal above is keyed on a stale assumption.
  const registry = loadEnvironmentRegistry();
  const production = registry.environments.filter((e) => e.role === "production");
  assert.equal(production.length, 1);
  assert.equal(production[0].firebase.projectId, PRODUCTION_PROJECT_ID);
});

// ──────────────────────────────── 2. RATCHET ────────────────────────────────

const SCAN_ROOTS = [join(FUNCTIONS_DIR, "scripts"), join(REPO_ROOT, "scripts")];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules") continue;
      walk(full, out);
    } else if (/\.(js|mjs)$/.test(entry) && !/\.test\.(js|mjs)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Source with comments removed -- prose about initializeApp() is not a call to it. */
function codeOf(file) {
  const raw = readFileSync(file, "utf8");
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/(^|\s)\/\/.*$/, "$1"))
    .join("\n");
}

const SCRIPTS = SCAN_ROOTS.flatMap((root) => walk(root)).map((file) => ({
  path: relative(REPO_ROOT, file),
  code: codeOf(file),
}));

test("ratchet: no script initializes firebase-admin with no target at all", () => {
  // `initializeApp()` lets google-auth-library resolve the project from
  // GCLOUD_PROJECT, then from the ADC file's own quota_project_id, then from the
  // GCE metadata server. On this program's machines that chain lands on
  // production. There are currently ZERO of these and there must stay zero.
  const offenders = SCRIPTS.filter(({ code }) => /\binitializeApp\s*\(\s*\)/.test(code)).map((s) => s.path);
  assert.deepEqual(
    offenders,
    [],
    "bare initializeApp() lets ambient credentials pick the project. Pass an explicit, " +
      "operator-supplied projectId and assert the SDK's resolved value (see " +
      "functions/scripts/environmentTargetShared.js assertResolvedProjectId)."
  );
});

// Any evidence that a run must name its target out loud. Deliberately broad: the
// point is to catch a script with NO fence at all, not to mandate one spelling.
const TARGET_FENCES = [
  "assertProjectTarget",
  "assertNonProductionTarget",
  "confirmProduction",
  "confirmProject",
  "confirm-project",
  "PRODUCTION_DATA_AUTHORIZED",
  "ownerAuthorization",
  "owner-rollback-authorization",
  "FIRESTORE_EMULATOR_HOST",
  "resolveEnvironment",
  "--projectId is required",
];

// A refusal in any casing ("REFUSING:", "Refusing to read ...", "REFUSED:").
const REFUSAL_PATTERN = /\brefus(e|es|ed|ing)\b/i;

test("ratchet: every production-naming, admin-initializing script carries a target fence", () => {
  const offenders = SCRIPTS.filter(({ code }) => {
    if (!code.includes(PRODUCTION_PROJECT_ID)) return false;
    if (!/\binitializeApp\s*\(/.test(code)) return false;
    if (REFUSAL_PATTERN.test(code)) return false;
    return !TARGET_FENCES.some((fence) => code.includes(fence));
  }).map((s) => s.path);

  assert.deepEqual(
    offenders,
    [],
    "A script that can reach the production project must refuse to run without an explicit, " +
      "per-run target confirmation. Add one (functions/scripts/environmentTargetShared.js) rather " +
      "than widening this test. See docs/architecture/environment-selection-fail-closed.md."
  );
});

test("ratchet: the shared helper is the single home of the target contract", () => {
  // Five scripts each carried their own copy of assertProjectTarget. Three were
  // byte-identical and now delegate. A NEW private copy is how the contract drifts.
  const privateCopies = SCRIPTS.filter(({ path, code }) =>
    !path.endsWith("environmentTargetShared.js") && /^function assertProjectTarget\s*\(/m.test(code)
  ).map((s) => s.path);

  assert.deepEqual(
    privateCopies.sort(),
    [
      // Both differ from the canonical contract on purpose and are left in place
      // rather than silently normalised: this one throws its own
      // InvalidInvocationError subclass, which its CLI's exit-code mapping depends on.
      "functions/scripts/auditLegacyJobTechnicianData.js",
      // This one names a script-specific non-production example in its message.
      "functions/scripts/authPr4RecoveryEmailMigration.js",
    ],
    "Do not add a new private copy of assertProjectTarget -- require it from " +
      "functions/scripts/environmentTargetShared.js so the contract cannot drift."
  );
});

// ─────────────────────────────── 3. BEHAVIOUR ───────────────────────────────
//
// Each command below refuses BEFORE constructing any SDK client, so running them
// here contacts nothing.

function runScript(scriptRelPath, args = [], env = {}) {
  return spawnSync(process.execPath, [scriptRelPath, ...args], {
    cwd: FUNCTIONS_DIR,
    encoding: "utf8",
    // A clean environment: the point is that an ambient GCLOUD_PROJECT/ADC must
    // not be able to supply the target these commands refuse to guess.
    env: { ...process.env, GCLOUD_PROJECT: undefined, GOOGLE_CLOUD_PROJECT: undefined, ...env },
    timeout: 60_000,
  });
}

const NO_ARG_REFUSALS = [
  ["scripts/assignTechnicianToUser.js", [], /--projectId is required/],
  ["scripts/assignTechnicianToUser.js", ["some-uid", "some-tech"], /--projectId is required/],
  ["scripts/generatePasswordResetLink.js", [], /--projectId is required/],
  ["scripts/generatePasswordResetLink.js", ["someone@example.invalid"], /--projectId is required/],
  ["scripts/d1SmokeCompleteAssignedJob.js", [], /REFUSING TO RUN/],
  ["scripts/d1SmokeCompleteAssignedJob.js", ["seed"], /REFUSING TO RUN/],
  ["scripts/d2SmokeRulesVerification.js", ["seed"], /REFUSING TO RUN/],
  ["scripts/d3SmokeUiVerification.js", ["seed"], /REFUSING TO RUN/],
  ["scripts/inventoryCapabilityParityHarness.js", [], /--projectId is required/],
];

for (const [script, args, expected] of NO_ARG_REFUSALS) {
  test(`behaviour: ${script} ${args.join(" ")} refuses without an explicit target`, () => {
    const result = runScript(script, args);
    assert.notEqual(result.status, 0, `${script} must exit non-zero: ${result.stdout}`);
    assert.match(`${result.stdout}${result.stderr}`, expected);
  });
}

test("behaviour: a production target without confirmation is refused", () => {
  const result = runScript("scripts/assignTechnicianToUser.js", [
    "--projectId",
    PRODUCTION_PROJECT_ID,
    "some-uid",
    "some-tech",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /requires an explicit, matching --confirmProduction/);
});

test("behaviour: the parity harness refuses an unstated capability-activation environment", () => {
  // This is the trap this suite exists to pin down: with GCLOUD_PROJECT unset the
  // harness previously ran happily and reported EXTRA_POSTGRES_GRANT for 12 of its
  // 18 operations -- grants that are legitimate in the sandbox being examined.
  const result = runScript("scripts/inventoryCapabilityParityHarness.js", [
    "--projectId",
    "eos-platform-sandbox",
    "--tenant",
    "t",
    "--subject",
    "s",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /neither GCLOUD_PROJECT nor GOOGLE_CLOUD_PROJECT is set/);
});

test("behaviour: the parity harness refuses activation rules from a different environment", () => {
  const result = runScript(
    "scripts/inventoryCapabilityParityHarness.js",
    ["--projectId", "eos-platform-sandbox", "--tenant", "t", "--subject", "s"],
    { GCLOUD_PROJECT: PRODUCTION_PROJECT_ID }
  );
  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}${result.stderr}`,
    /Comparing one environment's activation rules against another environment's data/
  );
});

// ───────────────────── 4. THE OVERRIDE TRAP, PINNED DOWN ─────────────────────

// A CJS module reached through the ESM bridge is cached by resolved path, so a
// `?query` re-import would hand back the SAME instance (and its cold-start
// override cache). require + the module's own test-only cache reset is what
// actually re-resolves it.
const requireFromTest = createRequire(import.meta.url);

function overridesFor(projectId) {
  const mod = requireFromTest("../lib/access/environmentCapabilityOverrides.js");
  const before = { g: process.env.GCLOUD_PROJECT, gc: process.env.GOOGLE_CLOUD_PROJECT };
  try {
    delete process.env.GCLOUD_PROJECT;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    if (projectId) process.env.GCLOUD_PROJECT = projectId;
    mod.__resetRuntimeCapabilityOverridesCacheForTest();
    return mod.resolveRuntimeCapabilityOverrides();
  } finally {
    if (before.g === undefined) delete process.env.GCLOUD_PROJECT;
    else process.env.GCLOUD_PROJECT = before.g;
    if (before.gc === undefined) delete process.env.GOOGLE_CLOUD_PROJECT;
    else process.env.GOOGLE_CLOUD_PROJECT = before.gc;
    mod.__resetRuntimeCapabilityOverridesCacheForTest();
  }
}

test("trap: capability activation really is empty when GCLOUD_PROJECT is unset", () => {
  // Pinning the mechanism, not just the fence. If resolveRuntimeCapabilityOverrides
  // ever grows a default, this test says so loudly -- because a default here would
  // be a silent, machine-dependent change to an authorization answer.
  assert.equal(overridesFor(null).size, 0, "unset must yield an EMPTY override set");
  assert.ok(
    overridesFor("eos-platform-sandbox").size > 0,
    "the sandbox environment must activate a non-empty override set -- the whole reason unset is dangerous"
  );
});

test("trap: the affected census operations are exactly the ones documented", () => {
  // The number that matters: with GCLOUD_PROJECT unset, these operations flip from
  // ALLOW to DENY on the legacy side and are then reported as EXTRA_POSTGRES_GRANT
  // for principals whose sandbox grants are entirely legitimate. If this list moves,
  // the remedy in the doc must move with it.
  const sandboxOverrides = overridesFor("eos-platform-sandbox");
  const { findPermission } = requireFromTest("../lib/access/permissionCatalog.js");
  const { WRITER_CAPABILITY_CENSUS } = requireFromTest(
    "../lib/eosOps/migration/inventoryWriterCapabilityCensus.js"
  );

  const affected = WRITER_CAPABILITY_CENSUS.filter((op) => {
    if (op.kind === "HARDCODED_ROLE") return false;
    const id = op.legacyCapabilityKey || op.capabilityKey;
    const permission = findPermission(id);
    // `active: false` in the catalog + activated by the sandbox override set =
    // a decision that depends entirely on GCLOUD_PROJECT.
    return Boolean(permission) && permission.active === false && sandboxOverrides.has(id);
  }).map((op) => op.operationKey);

  assert.deepEqual(affected.sort(), [
    "cycleCount.cancel",
    "cycleCount.create",
    "cycleCount.reconcile",
    "cycleCount.submit",
    "dataImport.openingBalance",
    "relocation.recordPlacement",
    "relocation.relocate",
    "serializedInstall.install",
    "transfer.cancel",
    "transfer.create",
    "transfer.dispatch",
    "transfer.receive",
  ]);
  assert.equal(WRITER_CAPABILITY_CENSUS.length, 18);
});
