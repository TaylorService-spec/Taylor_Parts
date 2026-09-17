// THE ENVIRONMENT FENCE, PROVED BY SUBPROCESS.
//
// ============================ THE RULE UNDER TEST ============================
//
// NO EXPLICIT ENVIRONMENT = REFUSE. An operator script's target project must be NAMED on the command
// line being run. It is never inferred from the working directory, gcloud's configured default, the
// Firebase default project, .firebaserc, ambient Application Default Credentials (including the
// well-known ADC file on a Windows host, which carries its own quota project), or a process.env
// fallback. Each of those is a property of the machine rather than a statement of intent, and a fence
// that the environment can satisfy on the operator's behalf is not a fence.
//
// Reaching PRODUCTION requires naming it a SECOND time as an explicit per-run confirmation. There is
// no stored setting, env var or prior act that makes a later invocation production-capable.
//
// ============================ WHY THESE ARE SUBPROCESS TESTS ============================
//
// The property is not "the function throws". It is "the process refused BEFORE it was capable of
// contacting anything". That is a statement about a whole process's history, so it is tested by
// running the real CLI as a real child process and inspecting what it did -- not by importing a
// helper and asserting on a return value, which proves nothing about load order.
//
// EACH REFUSAL IS ALSO PROVED TO PRECEDE SDK CONSTRUCTION, by a mechanism that cannot be satisfied
// accidentally: a --require preload installs a hook on Module._load that FAILS THE TEST if the child
// ever resolves firebase-admin (or google-auth-library / pg) at all. So the assertion is not merely
// "initializeApp was not called" -- it is "the SDK was never even loaded, therefore no client of any
// kind existed in that process". A script that moved its guard below its imports would fail here even
// though its refusal message and exit code were unchanged.
//
// NOTHING HERE CONTACTS ANY PROJECT. Every case asserts a REFUSAL; no test supplies a complete,
// confirmed invocation, so no code path that could construct a client is ever reached. These tests
// are safe to run anywhere, including a machine holding live production credentials -- which is
// precisely the machine on which a fence regression matters most.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * A preload that turns "loaded a client library" into a hard, visible failure.
 *
 * Hooking Module._load rather than checking for a marker after the fact matters: it fires on
 * RESOLUTION, so it catches the attempt even when the package is not installed, and it cannot be
 * defeated by a script that loads the SDK and simply never calls initializeApp.
 */
const SENTINEL = "FENCE_VIOLATION_CLIENT_LIBRARY_LOADED";
const PRELOAD = `
const Module = require("node:module");
const BANNED = [/^firebase-admin(\\/|$)/, /^google-auth-library(\\/|$)/, /^pg(\\/|$)/, /^@google-cloud\\//];
const original = Module._load;
Module._load = function (request, parent, isMain) {
  if (BANNED.some((re) => re.test(request))) {
    process.stderr.write("${SENTINEL}:" + request + "\\n");
  }
  return original.apply(this, arguments);
};
`;

const preloadPath = (() => {
  const dir = mkdtempSync(join(tmpdir(), "eos-fence-preload-"));
  const p = join(dir, "banClientLibraries.cjs");
  writeFileSync(p, PRELOAD, "utf8");
  return p;
})();

/**
 * Run an operator CLI as a real child process, with the fence hook preloaded, and with the
 * environment deliberately STACKED to look like a machine that would happily resolve production:
 * ambient project env vars set, a Firebase default project available via .firebaserc in cwd. If a
 * script infers its target from any of that, these tests are how we find out.
 */
function runCli(scriptRelPath, args, extraEnv = {}) {
  return spawnSync(process.execPath, ["--require", preloadPath, scriptRelPath, ...args], {
    cwd: FUNCTIONS_DIR,
    encoding: "utf8",
    env: {
      ...process.env,
      // Ambient identity that MUST NOT be accepted as an environment selection.
      GOOGLE_CLOUD_PROJECT: "taylor-parts",
      GCLOUD_PROJECT: "taylor-parts",
      CLOUDSDK_CORE_PROJECT: "taylor-parts",
      ...extraEnv,
    },
  });
}

/** Every refusal must: exit non-zero, say something, and never have loaded a client library. */
function assertRefusedBeforeAnySdk(res, label) {
  const output = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  assert.notEqual(res.status, 0, `${label}: expected a non-zero exit (a refusal), got ${res.status}`);
  assert.doesNotMatch(
    output,
    new RegExp(SENTINEL),
    `${label}: a client library was LOADED before the refusal -- the guard runs below an import. ` +
      `The refusal must precede every require of firebase-admin/google-auth-library/pg.\n${output}`,
  );
  // A refusal the operator cannot read is a refusal they will work around.
  assert.ok(output.trim().length > 0, `${label}: refused silently -- say why`);
  return output;
}

// ============================ THE CREDENTIAL-EQUIVALENT ONE ============================
//
// generatePasswordResetLink.js mints a password-reset URL. Whoever holds that URL can take over the
// account, so its output is credential-equivalent and it is the highest-consequence script on this
// surface. It previously hardcoded projectId "taylor-parts" and took ONE documented argument: a single
// copied command line minted a live production account-takeover link with production named nowhere.
test("reset link: refuses with no environment named (the old one-argument form)", () => {
  const res = runCli("scripts/generatePasswordResetLink.js", ["someone@example.com"]);
  const out = assertRefusedBeforeAnySdk(res, "reset link, no --projectId");
  assert.match(out, /--projectId is required/);
});

test("reset link: ambient credentials and env project NEVER select the target", () => {
  // Every ambient signal points at production. The script must still refuse: intent is not inherited.
  const res = runCli("scripts/generatePasswordResetLink.js", ["someone@example.com"], {
    GOOGLE_APPLICATION_CREDENTIALS: "/nonexistent/adc.json",
  });
  const out = assertRefusedBeforeAnySdk(res, "reset link, ambient only");
  assert.match(out, /--projectId is required/);
});

test("reset link: production named ONCE is refused -- confirmation is separate", () => {
  const res = runCli("scripts/generatePasswordResetLink.js", [
    "--projectId", "taylor-parts", "someone@example.com",
  ]);
  const out = assertRefusedBeforeAnySdk(res, "reset link, unconfirmed production");
  assert.match(out, /--confirmProduction/);
});

test("reset link: a MISMATCHED production confirmation is refused", () => {
  // Confirming a different project than the one targeted must not count as "some confirmation given".
  const res = runCli("scripts/generatePasswordResetLink.js", [
    "--projectId", "taylor-parts", "--confirmProduction", "eos-platform-sandbox", "someone@example.com",
  ]);
  assertRefusedBeforeAnySdk(res, "reset link, mismatched confirmation");
});

// ============================ THE PRODUCTION WRITER ============================
//
// assignTechnicianToUser.js writes users/{uid}.technicianId, which firestore.rules' isOwnTechnician()
// reads -- so a mis-targeted run changes who can see what. It also hardcoded "taylor-parts" and took
// two arguments, neither naming an environment.
test("technician mapping: refuses with no environment named (the old two-argument form)", () => {
  const res = runCli("scripts/assignTechnicianToUser.js", ["some-uid", "tech-1"]);
  const out = assertRefusedBeforeAnySdk(res, "technician mapping, no --projectId");
  assert.match(out, /--projectId is required/);
});

test("technician mapping: production named once is refused", () => {
  const res = runCli("scripts/assignTechnicianToUser.js", [
    "--projectId", "taylor-parts", "some-uid", "tech-1",
  ]);
  const out = assertRefusedBeforeAnySdk(res, "technician mapping, unconfirmed production");
  assert.match(out, /--confirmProduction/);
});

// ============================ THE MODULE-LOAD-TIME CLIENTS ============================
//
// The D1/D2/D3 gate smokes are production-bound BY DESIGN -- verifying what is deployed there is their
// purpose. The defect was that each constructed a production Admin SDK client at MODULE LOAD, so
// merely invoking the file, or mistyping its mode, created that client with production named nowhere
// on the line typed. Production is now confirmed per run, above the SDK import.
for (const [script, mode] of [
  ["scripts/d1SmokeCompleteAssignedJob.js", "run"],
  ["scripts/d2SmokeRulesVerification.js", "seed"],
  ["scripts/d3SmokeUiVerification.js", "verify"],
]) {
  test(`${script}: refuses without an explicit per-run production confirmation`, () => {
    const res = runCli(script, [mode]);
    const out = assertRefusedBeforeAnySdk(res, script);
    assert.match(out, /REFUSED/);
  });

  test(`${script}: refuses a confirmation naming a DIFFERENT project`, () => {
    const res = runCli(script, [mode, "--confirm-production", "eos-platform-sandbox"]);
    assertRefusedBeforeAnySdk(res, `${script}, wrong project confirmed`);
  });

  test(`${script}: bare invocation with no mode still constructs no client`, () => {
    // The original failure mode exactly: the client was built before argv was even looked at.
    const res = runCli(script, []);
    assertRefusedBeforeAnySdk(res, `${script}, no arguments`);
  });
}

// ============================ THE CRM CUTOVER ============================
//
// scripts/crmCutover.js writes eos_crm (copy) and scripts/exportCrmSnapshot.js is the Owner's FIREBASE_EXIT_MIGRATION_ONLY
// Firestore read. Both must refuse before `pg` / firebase-admin is even resolved, and neither has a production mode.
const CRM_CUTOVER = "scripts/crmCutover.js";
const CRM_ARGS = ["--environment", "platform-sandbox", "--databaseUrlEnv", "CRM_FENCE_DB", "--tenantKey", "taylor-nonprod", "--snapshot", "/nonexistent/crm-snapshot.json"];
const CRM_ENV = { EOS_ENVIRONMENT: "nonprod", CRM_FENCE_DB: "postgres://fence:fence@127.0.0.1:1/never" };
const onEnv = (args, id) => args.map((a) => (a === "platform-sandbox" ? id : a));

for (const [label, args, env, pattern] of [
  ["no mode", CRM_ARGS, CRM_ENV, /--mode must be one of/],
  ["no environment", ["--mode", "census"], CRM_ENV, /--environment is required/],
  ["production environment", ["--mode", "copy", ...onEnv(CRM_ARGS, "taylor-parts-production")], CRM_ENV, /production/],
  ["EOS_ENVIRONMENT not nonprod", ["--mode", "copy", ...CRM_ARGS, "--performedByPrincipalId", "p1", "--evidenceOut", "/nonexistent/e.json"], { ...CRM_ENV, EOS_ENVIRONMENT: "production" }, /EOS_ENVIRONMENT must read exactly 'nonprod'/],
  ["EOS_ENVIRONMENT absent", ["--mode", "verify", ...CRM_ARGS], { CRM_FENCE_DB: CRM_ENV.CRM_FENCE_DB, EOS_ENVIRONMENT: "" }, /EOS_ENVIRONMENT must read exactly 'nonprod'/],
  ["frozen Certification world", ["--mode", "census", ...onEnv(CRM_ARGS, "platform-certification")], CRM_ENV, /Certification world, which is frozen/],
  ["no tenant key", ["--mode", "census", "--environment", "platform-sandbox", "--databaseUrlEnv", "CRM_FENCE_DB", "--snapshot", "x.json"], CRM_ENV, /--tenantKey is required/],
  ["no snapshot", ["--mode", "census", "--environment", "platform-sandbox", "--databaseUrlEnv", "CRM_FENCE_DB", "--tenantKey", "taylor-nonprod"], CRM_ENV, /--snapshot <file> is required/],
  ["copy without an EOS Principal", ["--mode", "copy", ...CRM_ARGS, "--evidenceOut", "/nonexistent/e.json"], CRM_ENV, /--performedByPrincipalId <EOS Principal id> is required/],
  ["copy without an evidence file", ["--mode", "copy", ...CRM_ARGS, "--performedByPrincipalId", "p1"], CRM_ENV, /--evidenceOut <file> is required/],
  ["synthetic-row flag against production (ruling 5)", ["--mode", "copy", ...onEnv(CRM_ARGS, "taylor-parts-production"), "--performedByPrincipalId", "p1", "--evidenceOut", "/nonexistent/e.json", "--retainDeclaredSyntheticSeedRows"], CRM_ENV, /nonprod-only/],
]) {
  test(`crm cutover: refuses (${label}) before any client library loads`, () => {
    const res = runCli(CRM_CUTOVER, args, env);
    const out = assertRefusedBeforeAnySdk(res, `crm cutover, ${label}`);
    assert.match(out, pattern);
  });
}

const CRM_EXPORT = "scripts/exportCrmSnapshot.js";
const CRM_EXPORT_ENV = { EOS_ENVIRONMENT: "nonprod" };
for (const [label, args, env, pattern] of [
  ["no environment", ["--out", "/nonexistent/x.json"], CRM_EXPORT_ENV, /--environment is required/],
  ["a --projectId instead of a registry environment", ["--environment", "platform-sandbox", "--projectId", "eos-platform-sandbox", "--out", "/nonexistent/x.json"], CRM_EXPORT_ENV, /--projectId is not accepted/],
  ["EOS_ENVIRONMENT not nonprod", ["--environment", "platform-sandbox", "--out", "/nonexistent/x.json"], { EOS_ENVIRONMENT: "production" }, /EOS_ENVIRONMENT must read exactly 'nonprod'/],
  ["EOS_ENVIRONMENT absent", ["--environment", "platform-sandbox", "--out", "/nonexistent/x.json"], { EOS_ENVIRONMENT: "" }, /EOS_ENVIRONMENT must read exactly 'nonprod'/],
  ["production, even confirmed", ["--environment", "taylor-parts-production", "--confirmProduction", "taylor-parts", "--out", "/nonexistent/x.json"], CRM_EXPORT_ENV, /production/],
  ["frozen Certification world", ["--environment", "platform-certification", "--out", "/nonexistent/x.json"], CRM_EXPORT_ENV, /frozen/],
  ["undeclared environment", ["--environment", "someone-elses-env", "--out", "/nonexistent/x.json"], CRM_EXPORT_ENV, /not an environment declared/],
  ["environment with no Firebase project", ["--environment", "local-emulator", "--out", "/nonexistent/x.json"], CRM_EXPORT_ENV, /declares no Firebase project/],
  ["no out file", ["--environment", "platform-sandbox"], CRM_EXPORT_ENV, /--out <file> is required/],
  ["an existing out file", ["--environment", "platform-sandbox", "--out", "scripts/exportCrmSnapshot.js"], CRM_EXPORT_ENV, /never overwritten/],
]) {
  test(`crm snapshot export (FIREBASE_EXIT_MIGRATION_ONLY): refuses (${label}) before firebase-admin loads`, () => {
    const res = runCli(CRM_EXPORT, args, env);
    const out = assertRefusedBeforeAnySdk(res, `crm snapshot export, ${label}`);
    assert.match(out, pattern);
  });
}

// ============================ THE GUARD ITSELF STAYS SDK-FREE ============================
//
// projectTargetGuard.js exists so that "import the fence" and "load the Admin SDK" are different acts.
// If it ever acquires a client-library import, every refusal above silently stops proving what it
// claims: the guard would run, but only after the SDK was already in the process. That regression is
// invisible in exit codes and refusal messages, so it is asserted directly.
test("the shared project-target guard imports no client library", () => {
  const res = spawnSync(
    process.execPath,
    ["--require", preloadPath, "-e", 'require("./scripts/projectTargetGuard.js");'],
    { cwd: FUNCTIONS_DIR, encoding: "utf8", env: { ...process.env } },
  );
  const output = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  assert.equal(res.status, 0, `guard module failed to load standalone: ${output}`);
  assert.doesNotMatch(
    output,
    new RegExp(SENTINEL),
    "projectTargetGuard.js pulled in a client library -- it MUST stay importable without loading any SDK",
  );
});

test("the shared guard requires a project and confirms production, as pure logic", async () => {
  const { parseArgs, assertProjectTarget, PRODUCTION_PROJECT_ID } = await import(
    "../scripts/projectTargetGuard.js"
  );
  assert.equal(PRODUCTION_PROJECT_ID, "taylor-parts");
  assert.throws(() => assertProjectTarget(parseArgs([])), /--projectId is required/);
  assert.throws(
    () => assertProjectTarget(parseArgs(["--projectId", "taylor-parts"])),
    /--confirmProduction/,
    "production must not be reachable from a single mention",
  );
  // A non-production project needs no confirmation -- the fence is about production, not about friction.
  assert.equal(assertProjectTarget(parseArgs(["--projectId", "eos-platform-sandbox"])), "eos-platform-sandbox");
  // Confirmation must MATCH, not merely be present.
  assert.throws(
    () => assertProjectTarget(parseArgs(["--projectId", "taylor-parts", "--confirmProduction", "nope"])),
    /--confirmProduction/,
  );
  assert.equal(
    assertProjectTarget(parseArgs(["--projectId", "taylor-parts", "--confirmProduction", "taylor-parts"])),
    "taylor-parts",
  );
});

// ============================ THE EMPLOYEE PROFILE MIGRATION AND CAPABILITY GRANTS ============================
//
// scripts/employeeProfileCutover.js writes eos_workforce (copy), scripts/employeeCapabilityGrantMigrationCli.js writes
// eos_policy.role_capabilities (--apply), and scripts/exportEmployeeProfileSnapshot.js (FIREBASE_EXIT_MIGRATION_ONLY)
// reads one Firebase collection. All three refuse before `pg` / firebase-admin is resolved; none has a production mode.
const EMP_CUTOVER = "scripts/employeeProfileCutover.js";
const EMP_ARGS = ["--environment", "platform-sandbox", "--databaseUrlEnv", "EMP_FENCE_DB", "--tenantKey", "taylor-nonprod", "--snapshot", "/nonexistent/snapshot.json"];
const EMP_ENV = { EOS_ENVIRONMENT: "nonprod", EMP_FENCE_DB: "postgres://fence:fence@127.0.0.1:1/never" };
const swapEnv = (args, to) => args.map((a) => (a === "platform-sandbox" ? to : a));

for (const [label, args, env, pattern] of [
  ["no mode", EMP_ARGS, EMP_ENV, /--mode must be one of/],
  ["no environment", ["--mode", "census"], EMP_ENV, /--environment is required/],
  ["production environment", ["--mode", "copy", ...swapEnv(EMP_ARGS, "taylor-parts-production"), "--performedBy", "op"], EMP_ENV, /production/],
  ["EOS_ENVIRONMENT not nonprod", ["--mode", "copy", ...EMP_ARGS, "--performedBy", "op"], { ...EMP_ENV, EOS_ENVIRONMENT: "production" }, /EOS_ENVIRONMENT must read exactly 'nonprod'/],
  ["frozen Certification world", ["--mode", "census", ...swapEnv(EMP_ARGS, "platform-certification")], EMP_ENV, /Certification world, which is frozen/],
  ["no tenant key", ["--mode", "census", "--environment", "platform-sandbox", "--databaseUrlEnv", "EMP_FENCE_DB", "--snapshot", "x.json"], EMP_ENV, /--tenantKey is required/],
  ["no snapshot", ["--mode", "verify", "--environment", "platform-sandbox", "--databaseUrlEnv", "EMP_FENCE_DB", "--tenantKey", "taylor-nonprod"], EMP_ENV, /--snapshot <file> is required/],
  ["copy without performedBy", ["--mode", "copy", ...EMP_ARGS], EMP_ENV, /--performedBy <operator> is required/],
]) {
  test(`employee profile cutover: refuses (${label}) before any client library loads`, () => {
    const res = runCli(EMP_CUTOVER, args, env);
    const out = assertRefusedBeforeAnySdk(res, `employee profile cutover, ${label}`);
    assert.match(out, pattern);
  });
}

const EMP_GRANTS = "scripts/employeeCapabilityGrantMigrationCli.js";
const GRANT_ARGS = ["--environment", "platform-sandbox", "--databaseUrlEnv", "EMP_FENCE_DB", "--tenantKey", "taylor-nonprod", "--performedBy", "op", "--apply"];
for (const [label, args, env, pattern] of [
  ["no environment", ["--tenantKey", "taylor-nonprod", "--performedBy", "op"], EMP_ENV, /--environment is required/],
  ["production environment", swapEnv(GRANT_ARGS, "taylor-parts-production"), EMP_ENV, /production/],
  ["EOS_ENVIRONMENT not nonprod", GRANT_ARGS, { ...EMP_ENV, EOS_ENVIRONMENT: "local" }, /EOS_ENVIRONMENT must read exactly 'nonprod'/],
  ["frozen Certification world", swapEnv(GRANT_ARGS, "platform-certification"), EMP_ENV, /Certification world, which is frozen/],
  ["no performedBy", GRANT_ARGS.filter((a) => a !== "--performedBy" && a !== "op"), EMP_ENV, /--performedBy <operator> is required/],
]) {
  test(`employee capability grants: refuses (${label}) before any client library loads`, () => {
    const res = runCli(EMP_GRANTS, args, env);
    const out = assertRefusedBeforeAnySdk(res, `employee capability grants, ${label}`);
    assert.match(out, pattern);
  });
}

// ============================ SECURITY ROLE AUTHORITY CONVERGENCE ============================
//
// scripts/roleAssignmentCensusCli.js is a FIREBASE_EXIT_MIGRATION_ONLY read of the legacy Security Role assignment
// collections plus a read-only PostgreSQL census; scripts/policyRoleCatalogReconcileCli.js adds missing catalog Roles
// to ONE existing tenant (--apply). Both must refuse before firebase-admin / pg / lib/ is resolved.
const ROLE_CENSUS = "scripts/roleAssignmentCensusCli.js";
const ROLE_ENV = { EOS_ENVIRONMENT: "nonprod", ROLE_FENCE_DB: "postgres://fence:fence@127.0.0.1:1/never" };
const ROLE_CENSUS_ARGS = ["--environment", "platform-sandbox", "--databaseUrlEnv", "ROLE_FENCE_DB", "--tenantKey", "taylor-nonprod", "--out", "/nonexistent/census.json"];
const roleEnvSwap = (args, to) => args.map((a) => (a === "platform-sandbox" ? to : a));
for (const [label, args, env, pattern] of [
  ["no environment", ["--databaseUrlEnv", "ROLE_FENCE_DB", "--tenantKey", "taylor-nonprod", "--out", "/nonexistent/c.json"], ROLE_ENV, /--environment is required/],
  ["a --projectId instead of a registry environment", [...ROLE_CENSUS_ARGS, "--projectId", "eos-platform-sandbox"], ROLE_ENV, /--projectId is not accepted/],
  ["production environment", roleEnvSwap(ROLE_CENSUS_ARGS, "taylor-parts-production"), ROLE_ENV, /production/],
  ["production, even confirmed", [...roleEnvSwap(ROLE_CENSUS_ARGS, "taylor-parts-production"), "--confirmProduction", "taylor-parts"], ROLE_ENV, /production/],
  ["frozen Certification world", roleEnvSwap(ROLE_CENSUS_ARGS, "platform-certification"), ROLE_ENV, /Certification world, which is frozen/],
  ["undeclared environment", roleEnvSwap(ROLE_CENSUS_ARGS, "someone-elses-env"), ROLE_ENV, /byte-identical to an environment id/],
  ["environment with no Firebase project", roleEnvSwap(ROLE_CENSUS_ARGS, "local-emulator"), ROLE_ENV, /declares no Firebase project/],
  ["EOS_ENVIRONMENT not nonprod", ROLE_CENSUS_ARGS, { ...ROLE_ENV, EOS_ENVIRONMENT: "production" }, /EOS_ENVIRONMENT must read exactly 'nonprod'/],
  ["EOS_ENVIRONMENT absent", ROLE_CENSUS_ARGS, { ...ROLE_ENV, EOS_ENVIRONMENT: "" }, /EOS_ENVIRONMENT must read exactly 'nonprod'/],
  ["no databaseUrlEnv", ROLE_CENSUS_ARGS.filter((a) => a !== "--databaseUrlEnv" && a !== "ROLE_FENCE_DB"), ROLE_ENV, /--databaseUrlEnv <VAR> is required/],
  ["a Firestore emulator host", ROLE_CENSUS_ARGS, { ...ROLE_ENV, FIRESTORE_EMULATOR_HOST: "127.0.0.1:8182" }, /FIRESTORE_EMULATOR_HOST/],
  ["no tenant key", ROLE_CENSUS_ARGS.filter((a) => a !== "--tenantKey" && a !== "taylor-nonprod"), ROLE_ENV, /--tenantKey is required/],
  ["no out file", ROLE_CENSUS_ARGS.slice(0, 6), ROLE_ENV, /--out <file> is required/],
  ["an existing out file", [...ROLE_CENSUS_ARGS.slice(0, 6), "--out", ROLE_CENSUS], ROLE_ENV, /never overwritten/],
]) {
  test(`role assignment census (FIREBASE_EXIT_MIGRATION_ONLY): refuses (${label}) before any client library loads`, () => {
    const res = runCli(ROLE_CENSUS, args, env);
    const out = assertRefusedBeforeAnySdk(res, `role assignment census, ${label}`);
    assert.match(out, pattern);
  });
}

const ROLE_RECONCILE = "scripts/policyRoleCatalogReconcileCli.js";
const ROLE_RECONCILE_ARGS = ["--environment", "platform-sandbox", "--databaseUrlEnv", "ROLE_FENCE_DB", "--tenantKey", "taylor-nonprod", "--performedBy", "op", "--apply"];
for (const [label, args, env, pattern] of [
  ["no environment", ["--tenantKey", "taylor-nonprod", "--performedBy", "op", "--apply"], ROLE_ENV, /--environment is required/],
  ["production environment", roleEnvSwap(ROLE_RECONCILE_ARGS, "taylor-parts-production"), ROLE_ENV, /production/],
  ["frozen Certification world", roleEnvSwap(ROLE_RECONCILE_ARGS, "platform-certification"), ROLE_ENV, /Certification world, which is frozen/],
  ["EOS_ENVIRONMENT not nonprod", ROLE_RECONCILE_ARGS, { ...ROLE_ENV, EOS_ENVIRONMENT: "local" }, /EOS_ENVIRONMENT must read exactly 'nonprod'/],
  ["no databaseUrlEnv", ROLE_RECONCILE_ARGS.filter((a) => a !== "--databaseUrlEnv" && a !== "ROLE_FENCE_DB"), ROLE_ENV, /--databaseUrlEnv <VAR> is required/],
  ["no tenant key", ROLE_RECONCILE_ARGS.filter((a) => a !== "--tenantKey" && a !== "taylor-nonprod"), ROLE_ENV, /--tenantKey is required/],
  ["no performedBy", ROLE_RECONCILE_ARGS.filter((a) => a !== "--performedBy" && a !== "op"), ROLE_ENV, /--performedBy <operator> is required/],
  ["an existing out file", [...ROLE_RECONCILE_ARGS, "--out", ROLE_RECONCILE], ROLE_ENV, /never overwritten/],
]) {
  test(`policy role catalog reconcile: refuses (${label}) before any client library loads`, () => {
    const res = runCli(ROLE_RECONCILE, args, env);
    const out = assertRefusedBeforeAnySdk(res, `policy role catalog reconcile, ${label}`);
    assert.match(out, pattern);
  });
}

const EMP_EXPORT = "scripts/exportEmployeeProfileSnapshot.js";
for (const [label, args, pattern] of [
  ["no project", ["--out", "/nonexistent/x.json"], /--projectId is required/],
  ["production, even confirmed", ["--projectId", "taylor-parts", "--confirmProduction", "taylor-parts", "--out", "/nonexistent/x.json"], /is production/],
  ["frozen Certification world", ["--projectId", "eos-platform-certification", "--out", "/nonexistent/x.json"], /frozen/],
  ["undeclared project", ["--projectId", "someone-elses-project", "--out", "/nonexistent/x.json"], /not a Firebase project declared/],
  ["no out file", ["--projectId", "eos-platform-sandbox"], /--out <file> is required/],
]) {
  test(`employee profile snapshot export: refuses (${label}) before firebase-admin loads`, () => {
    const res = runCli(EMP_EXPORT, args);
    const out = assertRefusedBeforeAnySdk(res, `employee profile snapshot export, ${label}`);
    assert.match(out, pattern);
  });
}

// ============================ THE CATALOG CUTOVER ============================
//
// scripts/catalogCutover.js writes eos_ops catalog tables (copy) and scripts/exportCatalogSnapshot.js reads a
// Firebase project. Both must refuse before `pg` / firebase-admin is even resolved, and neither has a production mode.
const CUTOVER = "scripts/catalogCutover.js";
const CUTOVER_ARGS = ["--environment", "platform-sandbox", "--databaseUrlEnv", "CATALOG_FENCE_DB", "--tenantKey", "taylor-nonprod", "--snapshot", "/nonexistent/snapshot.json"];
const CUTOVER_ENV = { EOS_ENVIRONMENT: "nonprod", CATALOG_FENCE_DB: "postgres://fence:fence@127.0.0.1:1/never" };

for (const [label, args, env, pattern] of [
  ["no mode", CUTOVER_ARGS, CUTOVER_ENV, /--mode must be one of/],
  ["no environment", ["--mode", "census"], CUTOVER_ENV, /--environment is required/],
  ["production environment", ["--mode", "copy", ...CUTOVER_ARGS.map((a) => (a === "platform-sandbox" ? "taylor-parts-production" : a))], CUTOVER_ENV, /production/],
  ["EOS_ENVIRONMENT not nonprod", ["--mode", "copy", ...CUTOVER_ARGS, "--principalId", "p"], { ...CUTOVER_ENV, EOS_ENVIRONMENT: "production" }, /EOS_ENVIRONMENT must read exactly 'nonprod'/],
  ["EOS_ENVIRONMENT absent", ["--mode", "verify", ...CUTOVER_ARGS], { CATALOG_FENCE_DB: CUTOVER_ENV.CATALOG_FENCE_DB, EOS_ENVIRONMENT: "" }, /EOS_ENVIRONMENT must read exactly 'nonprod'/],
  ["frozen Certification world", ["--mode", "census", ...CUTOVER_ARGS.map((a) => (a === "platform-sandbox" ? "platform-certification" : a))], CUTOVER_ENV, /Certification world, which is frozen/],
  ["no tenant key", ["--mode", "census", "--environment", "platform-sandbox", "--databaseUrlEnv", "CATALOG_FENCE_DB", "--snapshot", "x.json"], CUTOVER_ENV, /--tenantKey is required/],
  ["copy without an EOS principal", ["--mode", "copy", ...CUTOVER_ARGS], CUTOVER_ENV, /--principalId <EOS principal id> is required/],
  ["any Certification inclusion option", ["--mode", "copy", ...CUTOVER_ARGS, "--principalId", "p", "--certificationMarked", "include"], CUTOVER_ENV, /not an option/],
]) {
  test(`catalog cutover: refuses (${label}) before any client library loads`, () => {
    const res = runCli(CUTOVER, args, env);
    const out = assertRefusedBeforeAnySdk(res, `catalog cutover, ${label}`);
    assert.match(out, pattern);
  });
}

const EXPORT = "scripts/exportCatalogSnapshot.js";
for (const [label, args, pattern] of [
  ["no project", ["--out", "/nonexistent/x.json"], /--projectId is required/],
  ["production, even confirmed", ["--projectId", "taylor-parts", "--confirmProduction", "taylor-parts", "--out", "/nonexistent/x.json"], /is production/],
  ["frozen Certification world", ["--projectId", "eos-platform-certification", "--out", "/nonexistent/x.json"], /frozen/],
  ["undeclared project", ["--projectId", "someone-elses-project", "--out", "/nonexistent/x.json"], /not a Firebase project declared/],
  ["no out file", ["--projectId", "eos-platform-sandbox"], /--out <file> is required/],
]) {
  test(`catalog snapshot export: refuses (${label}) before firebase-admin loads`, () => {
    const res = runCli(EXPORT, args);
    const out = assertRefusedBeforeAnySdk(res, `catalog snapshot export, ${label}`);
    assert.match(out, pattern);
  });
}

// ============================ COMMERCIAL C5 ============================
//
// scripts/commercialC5.js writes eos_commercial (copy) and scripts/exportCommercialSnapshot.js reads a Firebase project
// (the FIREBASE_EXIT_MIGRATION_ONLY exception). Both must refuse before `pg` / firebase-admin is even resolved, and
// neither has a production mode.
const C5 = "scripts/commercialC5.js";
const C5_ARGS = ["--environment", "platform-sandbox", "--databaseUrlEnv", "C5_FENCE_DB", "--tenantKey", "taylor-nonprod", "--snapshot", "/nonexistent/snapshot.json"];
const C5_ENV = { EOS_ENVIRONMENT: "nonprod", C5_FENCE_DB: "postgres://fence:fence@127.0.0.1:1/never" };
const C5_CONFIRM = ["--confirmMigrationRequired", "a".repeat(64)];

for (const [label, args, env, pattern] of [
  ["no mode", C5_ARGS, C5_ENV, /--mode must be one of/],
  ["no environment", ["--mode", "census"], C5_ENV, /--environment is required/],
  ["production environment", ["--mode", "copy", ...C5_ARGS.map((a) => (a === "platform-sandbox" ? "taylor-parts-production" : a)), "--principalId", "p", ...C5_CONFIRM], C5_ENV, /production/],
  ["any production confirmation", ["--mode", "copy", ...C5_ARGS, "--principalId", "p", ...C5_CONFIRM, "--confirmProduction", "taylor-parts"], C5_ENV, /no production mode/],
  ["EOS_ENVIRONMENT not nonprod", ["--mode", "copy", ...C5_ARGS, "--principalId", "p", ...C5_CONFIRM], { ...C5_ENV, EOS_ENVIRONMENT: "production" }, /EOS_ENVIRONMENT must read exactly 'nonprod'/],
  ["EOS_ENVIRONMENT absent", ["--mode", "verify", ...C5_ARGS], { C5_FENCE_DB: C5_ENV.C5_FENCE_DB, EOS_ENVIRONMENT: "" }, /EOS_ENVIRONMENT must read exactly 'nonprod'/],
  ["frozen Certification world", ["--mode", "census", ...C5_ARGS.map((a) => (a === "platform-sandbox" ? "platform-certification" : a))], C5_ENV, /Certification world, which is frozen/],
  ["no tenant key", ["--mode", "census", "--environment", "platform-sandbox", "--databaseUrlEnv", "C5_FENCE_DB", "--snapshot", "x.json"], C5_ENV, /--tenantKey is required/],
  ["no snapshot", ["--mode", "census", "--environment", "platform-sandbox", "--databaseUrlEnv", "C5_FENCE_DB", "--tenantKey", "t"], C5_ENV, /--snapshot <file> is required/],
  ["copy without an EOS principal", ["--mode", "copy", ...C5_ARGS, ...C5_CONFIRM], C5_ENV, /--principalId <EOS principal id> is required/],
  ["copy without the explicit migration confirmation", ["--mode", "copy", ...C5_ARGS, "--principalId", "p"], C5_ENV, /--confirmMigrationRequired <snapshot sha256> is required/],
  ["any Certification inclusion option", ["--mode", "copy", ...C5_ARGS, "--principalId", "p", ...C5_CONFIRM, "--includeCertification", "yes"], C5_ENV, /not an option/],
  ["any option tolerating synthetic target rows", ["--mode", "copy", ...C5_ARGS, "--principalId", "p", ...C5_CONFIRM, "--retainDeclaredSyntheticSeedRows"], C5_ENV, /--retainDeclaredSyntheticSeedRows is not an option/],
]) {
  test(`commercial C5: refuses (${label}) before any client library loads`, () => {
    const res = runCli(C5, args, env);
    const out = assertRefusedBeforeAnySdk(res, `commercial C5, ${label}`);
    assert.match(out, pattern);
  });
}

const C5_EXPORT = "scripts/exportCommercialSnapshot.js";
for (const [label, args, pattern] of [
  ["no environment", ["--out", "/nonexistent/x.json"], /--environment is required/],
  ["a project id instead of an environment", ["--environment", "platform-sandbox", "--projectId", "taylor-parts", "--out", "/nonexistent/x.json"], /--projectId is not accepted/],
  ["production, even confirmed", ["--environment", "taylor-parts-production", "--confirmProduction", "taylor-parts", "--out", "/nonexistent/x.json"], /no production mode/],
  ["production environment", ["--environment", "taylor-parts-production", "--out", "/nonexistent/x.json"], /production/],
  ["frozen Certification world", ["--environment", "platform-certification", "--out", "/nonexistent/x.json"], /frozen/],
  ["undeclared environment", ["--environment", "someone-elses-env", "--out", "/nonexistent/x.json"], /not an environment declared/],
  ["no out file", ["--environment", "platform-sandbox"], /--out <file> is required/],
]) {
  test(`commercial snapshot export: refuses (${label}) before firebase-admin loads`, () => {
    const res = runCli(C5_EXPORT, args);
    const out = assertRefusedBeforeAnySdk(res, `commercial snapshot export, ${label}`);
    assert.match(out, pattern);
  });
}

// ============================ THE SAMPLE COMPANY V2 SEED AND VERIFIER ============================
//
// scripts/seedSampleCompany.js writes eos_workforce, eos_policy, eos_crm, eos_commercial and eos_ops
// (--mode apply --apply) and scripts/verifySampleCompany.js reads all of them. Both must refuse before `pg`
// is even resolved. Neither has a production mode, and BOTH refuse the Certification world by NAME -- it
// carries role "sandbox" in config/environments.json, so a role-only fence would let it through.
const SAMPLE_SEED = "scripts/seedSampleCompany.js";
const SAMPLE_VERIFY = "scripts/verifySampleCompany.js";
const SAMPLE_ENV = { EOS_ENVIRONMENT: "nonprod", SAMPLE_FENCE_DB: "postgres://fence:fence@127.0.0.1:1/never" };
const SAMPLE_ARGS = [
  "--environment", "platform-sandbox", "--databaseUrlEnv", "SAMPLE_FENCE_DB",
  "--tenantKey", "taylor-nonprod", "--existingAdminPrincipalId", "p", "--performedBy", "op",
];
const sampleEnvSwap = (args, environment) => args.map((a) => (a === "platform-sandbox" ? environment : a));

for (const [label, args, env, pattern] of [
  ["no environment", ["--tenantKey", "taylor-nonprod", "--performedBy", "op", "--existingAdminPrincipalId", "p"], SAMPLE_ENV, /--environment is required/],
  ["production environment", [...sampleEnvSwap(SAMPLE_ARGS, "taylor-parts-production"), "--mode", "apply", "--apply"], SAMPLE_ENV, /production/],
  ["frozen Certification world", [...sampleEnvSwap(SAMPLE_ARGS, "platform-certification"), "--mode", "apply", "--apply"], SAMPLE_ENV, /Certification world, which is frozen/],
  ["any other non-production environment", [...sampleEnvSwap(SAMPLE_ARGS, "platform-integration")], SAMPLE_ENV, /exists only in 'platform-sandbox'/],
  ["EOS_ENVIRONMENT not nonprod", [...SAMPLE_ARGS, "--mode", "apply", "--apply"], { ...SAMPLE_ENV, EOS_ENVIRONMENT: "production" }, /EOS_ENVIRONMENT must read exactly 'nonprod'/],
  ["EOS_ENVIRONMENT absent", SAMPLE_ARGS, { SAMPLE_FENCE_DB: SAMPLE_ENV.SAMPLE_FENCE_DB, EOS_ENVIRONMENT: "" }, /EOS_ENVIRONMENT must read exactly 'nonprod'/],
  ["no databaseUrlEnv", ["--environment", "platform-sandbox", "--tenantKey", "taylor-nonprod", "--performedBy", "op", "--existingAdminPrincipalId", "p"], SAMPLE_ENV, /--databaseUrlEnv <VAR> is required/],
  ["the wrong tenant", [...SAMPLE_ARGS.map((a) => (a === "taylor-nonprod" ? "some-other-tenant" : a))], SAMPLE_ENV, /--tenantKey taylor-nonprod is required/],
  ["no performedBy", SAMPLE_ARGS.filter((a) => a !== "--performedBy" && a !== "op"), SAMPLE_ENV, /--performedBy <operator> is required/],
  ["no administering principal", SAMPLE_ARGS.filter((a) => a !== "--existingAdminPrincipalId" && a !== "p"), SAMPLE_ENV, /--existingAdminPrincipalId is required/],
  ["an unknown mode", [...SAMPLE_ARGS, "--mode", "destroy"], SAMPLE_ENV, /--mode must be one of plan, apply, activate-logins, activate-credentials, verify/],
  ["apply mode without the explicit --apply", [...SAMPLE_ARGS, "--mode", "apply"], SAMPLE_ENV, /--mode apply additionally requires the explicit --apply/],
  ["--apply without a writing mode", [...SAMPLE_ARGS, "--apply"], SAMPLE_ENV, /--apply was given without a writing mode/],
  // CREDENTIAL-LAYER WORK IS SEPARATELY EXPLICIT and names its own target. Each refusal still precedes
  // firebase-admin resolving, which is what the preload proves.
  ["activate-logins without the explicit --apply", [...SAMPLE_ARGS, "--mode", "activate-logins"], SAMPLE_ENV, /--mode activate-logins additionally requires the explicit --apply/],
  ["activate-logins without a named Firebase project", [...SAMPLE_ARGS, "--mode", "activate-logins", "--apply"], SAMPLE_ENV, /--mode activate-logins requires --firebaseProjectId/],
  ["activate-logins against production", [...sampleEnvSwap(SAMPLE_ARGS, "taylor-parts-production"), "--mode", "activate-logins", "--apply", "--firebaseProjectId", "eos-platform-sandbox"], SAMPLE_ENV, /production/],
  ["activate-logins against the Certification world", [...sampleEnvSwap(SAMPLE_ARGS, "platform-certification"), "--mode", "activate-logins", "--apply", "--firebaseProjectId", "eos-platform-sandbox"], SAMPLE_ENV, /Certification world, which is frozen/],
  ["activate-logins naming the production Firebase project", [...SAMPLE_ARGS, "--mode", "activate-logins", "--apply", "--firebaseProjectId", "taylor-parts"], SAMPLE_ENV, /customer production project/],
  ["activate-logins naming the Certification Firebase project", [...SAMPLE_ARGS, "--mode", "activate-logins", "--apply", "--firebaseProjectId", "eos-platform-certification"], SAMPLE_ENV, /Certification world, which is frozen/],
  ["activate-logins naming an undeclared Firebase project", [...SAMPLE_ARGS, "--mode", "activate-logins", "--apply", "--firebaseProjectId", "someone-elses-project"], SAMPLE_ENV, /not a Firebase project declared/],
  ["a Firebase project on a non-credential mode", [...SAMPLE_ARGS, "--firebaseProjectId", "eos-platform-sandbox"], SAMPLE_ENV, /--firebaseProjectId belongs only to the credential-layer modes/],
  // THE CREDENTIAL PHASE. Separately authorized, names its target and its output file, and --rotate cannot
  // be reached through this script at all.
  ["activate-credentials without --apply", [...SAMPLE_ARGS, "--mode", "activate-credentials"], SAMPLE_ENV, /--mode activate-credentials additionally requires the explicit --apply/],
  ["activate-credentials without a named Firebase project", [...SAMPLE_ARGS, "--mode", "activate-credentials", "--apply"], SAMPLE_ENV, /--mode activate-credentials requires --firebaseProjectId/],
  ["activate-credentials without a credential file", [...SAMPLE_ARGS, "--mode", "activate-credentials", "--apply", "--firebaseProjectId", "eos-platform-sandbox"], SAMPLE_ENV, /--mode activate-credentials requires --credentialFile/],
  ["activate-credentials with a credential file outside the gitignore rule", [...SAMPLE_ARGS, "--mode", "activate-credentials", "--apply", "--firebaseProjectId", "eos-platform-sandbox", "--credentialFile", "/tmp/passwords.json"], SAMPLE_ENV, /--credentialFile <path ending credentials.local.json>/],
  ["activate-credentials against the production Firebase project", [...SAMPLE_ARGS, "--mode", "activate-credentials", "--apply", "--firebaseProjectId", "taylor-parts", "--credentialFile", "/tmp/x-credentials.local.json"], SAMPLE_ENV, /customer production project/],
  ["activate-credentials against the Certification Firebase project", [...SAMPLE_ARGS, "--mode", "activate-credentials", "--apply", "--firebaseProjectId", "eos-platform-certification", "--credentialFile", "/tmp/x-credentials.local.json"], SAMPLE_ENV, /Certification world, which is frozen/],
  ["a credential file on a non-credential mode", [...SAMPLE_ARGS, "--credentialFile", "/tmp/x-credentials.local.json"], SAMPLE_ENV, /--credentialFile belongs only to --mode activate-credentials/],
  ["--rotate, anywhere", [...SAMPLE_ARGS, "--rotate"], SAMPLE_ENV, /--rotate is not a Sample Company operation/],
  ["--rotate on the credential phase", [...SAMPLE_ARGS, "--mode", "activate-credentials", "--apply", "--firebaseProjectId", "eos-platform-sandbox", "--credentialFile", "/tmp/x-credentials.local.json", "--rotate"], SAMPLE_ENV, /--rotate is not a Sample Company operation/],
  // THE AUTH TARGET MUST BE THE SAMPLE COMPANY'S OWN PROJECT. platform-integration declares no Firebase
  // project, so the un-registered case is what a mistyped sandbox looks like in practice.
  ["a Firebase project that is not platform-sandbox's", [...SAMPLE_ARGS, "--mode", "activate-logins", "--apply", "--firebaseProjectId", "eos-platform-staging"], SAMPLE_ENV, /not a Firebase project declared/],
  // THE OPERATOR CREDENTIAL. Never an argument; a blank environment value is refused rather than downgraded to
  // ADC; and verify, which probes Auth, keeps the exact project fence.
  ["an operator token on the command line", [...SAMPLE_ARGS, "--mode", "activate-logins", "--apply", "--firebaseProjectId", "eos-platform-sandbox", "--operatorAccessToken", "operator-token-fixture-argv"], SAMPLE_ENV, /only through the EOS_FIREBASE_OPERATOR_ACCESS_TOKEN environment variable/],
  ["a blank operator token", [...SAMPLE_ARGS, "--mode", "activate-logins", "--apply", "--firebaseProjectId", "eos-platform-sandbox"], { ...SAMPLE_ENV, EOS_FIREBASE_OPERATOR_ACCESS_TOKEN: "   " }, /OPERATOR_TOKEN_INVALID/],
  ["a blank operator token on the credential phase", [...SAMPLE_ARGS, "--mode", "activate-credentials", "--apply", "--firebaseProjectId", "eos-platform-sandbox", "--credentialFile", "/tmp/x-credentials.local.json"], { ...SAMPLE_ENV, EOS_FIREBASE_OPERATOR_ACCESS_TOKEN: "" }, /OPERATOR_TOKEN_INVALID/],
  ["verify naming the production Firebase project", [...SAMPLE_ARGS, "--mode", "verify", "--firebaseProjectId", "taylor-parts"], SAMPLE_ENV, /customer production project/],
  ["verify naming no Firebase project", [...SAMPLE_ARGS, "--mode", "verify"], SAMPLE_ENV, /--firebaseProjectId is required/],
]) {
  test(`sample company v2 seed: refuses (${label}) before any client library loads`, () => {
    const res = runCli(SAMPLE_SEED, args, env);
    const out = assertRefusedBeforeAnySdk(res, `sample company v2 seed, ${label}`);
    assert.match(out, pattern);
  });
}

test("sample company v2 seed: the argv operator-token refusal does not echo the value", () => {
  const res = runCli(SAMPLE_SEED, [...SAMPLE_ARGS, "--mode", "activate-logins", "--apply", "--firebaseProjectId", "eos-platform-sandbox", "--operatorAccessToken", "operator-token-fixture-argv"], SAMPLE_ENV);
  assert.ok(!`${res.stdout}${res.stderr}`.includes("operator-token-fixture-argv"));
});

// NO CREDENTIAL = REFUSED BEFORE POSTGRESQL. With no operator token and Application Default Credentials that
// cannot be loaded, activate-logins must stop inside the Auth adapter: firebase-admin is loaded (that is where
// the refusal lives) but `pg` never is, so no pool existed and nothing could have been written. Nothing here
// reaches the network -- a named, missing ADC file fails synchronously, before any token request.
test("sample company v2 seed: activate-logins with no usable credential refuses before pg is loaded", () => {
  const res = runCli(SAMPLE_SEED, [...SAMPLE_ARGS, "--mode", "activate-logins", "--apply", "--firebaseProjectId", "eos-platform-sandbox"],
    { ...SAMPLE_ENV, GOOGLE_APPLICATION_CREDENTIALS: "/nonexistent/eos-operator-adc.json" });
  assert.equal(res.status, 2, `${res.stdout}${res.stderr}`);
  assert.ok(!res.stderr.includes(`${SENTINEL}:pg`), "pg was loaded: the credential failure happened after the database could be reached");
  assert.equal(res.stdout.trim(), "", "a refused run must print no report");
  assert.match(res.stderr, /OPERATOR_CREDENTIAL_UNAVAILABLE: .*EOS_FIREBASE_OPERATOR_ACCESS_TOKEN.*Nothing was written/);
});

for (const [label, args, env, pattern] of [
  ["no environment", ["--tenantKey", "taylor-nonprod", "--performedBy", "op", "--existingAdminPrincipalId", "p", "--skipAuthProbe"], SAMPLE_ENV, /--environment is required/],
  ["production environment", [...sampleEnvSwap(SAMPLE_ARGS, "taylor-parts-production"), "--skipAuthProbe"], SAMPLE_ENV, /production/],
  ["frozen Certification world", [...sampleEnvSwap(SAMPLE_ARGS, "platform-certification"), "--skipAuthProbe"], SAMPLE_ENV, /Certification world, which is frozen/],
  ["EOS_ENVIRONMENT not nonprod", [...SAMPLE_ARGS, "--skipAuthProbe"], { ...SAMPLE_ENV, EOS_ENVIRONMENT: "local" }, /EOS_ENVIRONMENT must read exactly 'nonprod'/],
  ["no tenant key", ["--environment", "platform-sandbox", "--databaseUrlEnv", "SAMPLE_FENCE_DB", "--performedBy", "op", "--existingAdminPrincipalId", "p", "--skipAuthProbe"], SAMPLE_ENV, /--tenantKey taylor-nonprod is required/],
  ["no Firebase project and no explicit database-only opt-out", SAMPLE_ARGS, SAMPLE_ENV, /--firebaseProjectId <sandbox project> is required to prove login readiness/],
  ["a production Firebase project for the Auth probe", [...SAMPLE_ARGS, "--firebaseProjectId", "taylor-parts"], SAMPLE_ENV, /customer production project/],
  ["the Certification Firebase project for the Auth probe", [...SAMPLE_ARGS, "--firebaseProjectId", "eos-platform-certification"], SAMPLE_ENV, /Certification world, which is frozen/],
]) {
  test(`sample company v2 verifier: refuses (${label}) before any client library loads`, () => {
    const res = runCli(SAMPLE_VERIFY, args, env);
    const out = assertRefusedBeforeAnySdk(res, `sample company v2 verifier, ${label}`);
    assert.match(out, pattern);
  });
}
