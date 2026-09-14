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
