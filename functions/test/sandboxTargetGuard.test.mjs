// X-BACKFILL-ENVIRONMENT-GUARD -- tests for functions/scripts/sandboxTargetGuard.js, the ONE
// implementation of the governed operator-CLI target guard shared by salesOrderNumberBackfillCli.js,
// phantomSalesOrderLinkRepairCli.js and warehouseAssignmentProvisioningCli.js.
//
// PURE + OFFLINE. Nothing here requires firebase-admin in-process, opens a connection, or touches any
// Firestore -- emulator or otherwise. The subprocess section runs each CLI as a REAL process with a
// refused target and proves the refusal happens before any SDK client could be constructed, by asserting
// on the process's own exit status and stderr rather than on an in-process mock.
//
// WHY THIS FILE EXISTS: the guard used to be copy-pasted verbatim into three CLIs and required the
// registry to declare EXACTLY ONE sandbox project id. Registering platform-certification (55041a07,
// 2026-08-30) made that two, and all three CLIs began throwing on every `--environment sandbox`
// invocation -- including the documented, correct one. The uniqueness requirement was an assumption that
// expired; the safety property (production and anything not explicitly declared is refused, nothing is
// ever inferred, and the tool never CHOOSES among qualifying projects) is preserved and asserted below.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.resolve(HERE, "..", "scripts");
const guard = require(path.join(SCRIPTS, "sandboxTargetGuard.js"));

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`  ok - ${name}`); }
  catch (err) { failed += 1; console.log(`  FAIL - ${name}: ${(err && err.stack) || err}`); }
}

// ---- resolveSandboxProjectIds: the SET, not a unique winner -------------------------------------
check("resolveSandboxProjectIds: returns every role:sandbox environment that has a real firebase.projectId", () => {
  const ids = guard.resolveSandboxProjectIds({ environments: [
    { id: "local-emulator", role: "sandbox", firebase: null },
    { id: "platform-sandbox", role: "sandbox", firebase: { projectId: "sb" } },
    { id: "platform-certification", role: "sandbox", firebase: { projectId: "cert" } },
    { id: "platform-integration", role: "integration", firebase: null },
    { id: "prod", role: "production", firebase: { projectId: "taylor-parts" } },
  ] });
  assert.deepEqual(ids, ["sb", "cert"]);
});

check("resolveSandboxProjectIds: TWO (or four) declared sandboxes is NOT an error -- the old 'exactly one' rule is gone", () => {
  const four = { environments: ["a", "b", "c", "d"].map((k) => ({ id: k, role: "sandbox", firebase: { projectId: `sb-${k}` } })) };
  assert.deepEqual(guard.resolveSandboxProjectIds(four), ["sb-a", "sb-b", "sb-c", "sb-d"]);
});

check("resolveSandboxProjectIds: role:sandbox with a null/blank/non-string projectId contributes nothing", () => {
  const r = { environments: [
    { id: "a", role: "sandbox", firebase: null },
    { id: "b", role: "sandbox", firebase: {} },
    { id: "c", role: "sandbox", firebase: { projectId: "" } },
    { id: "d", role: "sandbox", firebase: { projectId: 123 } },
    { id: "e", role: "sandbox", firebase: { projectId: "real" } },
  ] };
  assert.deepEqual(guard.resolveSandboxProjectIds(r), ["real"]);
});

check("resolveSandboxProjectIds: duplicate project ids are deduped", () => {
  const r = { environments: [
    { id: "a", role: "sandbox", firebase: { projectId: "same" } },
    { id: "b", role: "sandbox", firebase: { projectId: "same" } },
  ] };
  assert.deepEqual(guard.resolveSandboxProjectIds(r), ["same"]);
});

check("resolveSandboxProjectIds: NO declared sandbox is refused outright -- never inferred, never defaulted", () => {
  assert.throws(() => guard.resolveSandboxProjectIds({ environments: [] }), /found none/);
  assert.throws(() => guard.resolveSandboxProjectIds({ environments: [{ id: "p", role: "production", firebase: { projectId: "taylor-parts" } }] }), /found none/);
  assert.throws(() => guard.resolveSandboxProjectIds({}), /found none/);
  assert.throws(() => guard.resolveSandboxProjectIds(null), /found none/);
});

// ---- the live registry --------------------------------------------------------------------------
const LIVE_IDS = guard.resolveSandboxProjectIds(guard.loadEnvironmentRegistry());

check("live config/environments.json: declares at least one sandbox target and includes eos-platform-sandbox", () => {
  assert.ok(LIVE_IDS.length >= 1, `expected >= 1 sandbox target, got ${JSON.stringify(LIVE_IDS)}`);
  assert.ok(LIVE_IDS.includes("eos-platform-sandbox"));
});

check("live config/environments.json: NO production project id can ever appear in the sandbox target set", () => {
  const registry = guard.loadEnvironmentRegistry();
  const productionIds = registry.environments
    .filter((e) => e.role === "production" && e.firebase && e.firebase.projectId)
    .map((e) => e.firebase.projectId);
  assert.ok(productionIds.includes("taylor-parts"), "precondition: taylor-parts is declared role:production");
  for (const p of productionIds) assert.ok(!LIVE_IDS.includes(p), `production project ${p} leaked into the sandbox target set`);
});

check("live config/environments.json: local-emulator is role:sandbox but contributes NO target (firebase is null by design)", () => {
  const registry = guard.loadEnvironmentRegistry();
  const emu = registry.environments.find((e) => e.id === "local-emulator");
  assert.ok(emu, "local-emulator must still be declared");
  assert.equal(emu.role, "sandbox", "local-emulator's role is correct -- it IS a sandbox");
  assert.equal(emu.firebase, null, "...and it has no Firebase identity, which is why it is not a target");
});

// ---- assertSandboxTarget: validates what the operator named; never chooses ------------------------
check("assertSandboxTarget: --environment is required (absent / empty are both hard refusals)", () => {
  assert.throws(() => guard.assertSandboxTarget({ projectId: "eos-platform-sandbox" }), /--environment is required/);
  assert.throws(() => guard.assertSandboxTarget({ environment: "", projectId: "eos-platform-sandbox" }), /--environment is required/);
});

check("assertSandboxTarget: production and every typo/case variant of the role are refused", () => {
  for (const bad of ["production", "prod", "PRODUCTION", "Sandbox", "sandbox ", "staging", "integration", "certification"]) {
    assert.throws(() => guard.assertSandboxTarget({ environment: bad, projectId: "eos-platform-sandbox" }),
      /--environment must be exactly "sandbox"/, `expected '${bad}' to be refused`);
  }
});

check("assertSandboxTarget: every declared sandbox id is accepted ONLY when named explicitly", () => {
  for (const id of LIVE_IDS) assert.equal(guard.assertSandboxTarget({ environment: "sandbox", projectId: id }), id);
});

check("assertSandboxTarget: taylor-parts, aliases, near-misses, and a missing --project are all refused", () => {
  for (const bad of ["taylor-parts", "eos-platform-sandbox ", " eos-platform-sandbox", "eos-platform-sandboxx",
                     "x-eos-platform-sandbox", "eos-platform-sandbox-alias", "EOS-PLATFORM-SANDBOX", undefined, null, ""]) {
    assert.throws(() => guard.assertSandboxTarget({ environment: "sandbox", projectId: bad }),
      /only accepts --project/, `expected ${JSON.stringify(bad)} to be refused`);
  }
});

check("assertSandboxTarget: the refusal message NAMES the declared alternatives, so an operator can act on it", () => {
  try {
    guard.assertSandboxTarget({ environment: "sandbox", projectId: "taylor-parts" });
    assert.fail("expected a refusal");
  } catch (err) {
    for (const id of LIVE_IDS) assert.ok(err.message.includes(id), `refusal must name ${id}`);
    assert.ok(/refuses to choose/.test(err.message), "refusal must say the tool will not choose");
  }
});

// ---- SUBPROCESS PROOF: the refusal fires before any SDK client can be constructed -----------------
// Each CLI is run as a real process with a refused target. A refusal must: exit non-zero, print the
// guard's message, and NEVER produce any evidence of Firebase/Firestore initialization. The environment
// is stripped of every credential and project hint so that even a guard failure could not authenticate --
// but the point of the assertion is that the process dies in parseArgs, long before that would matter.
// [script, extra required args, the failure exit code that script's own entrypoint sets]. The codes
// differ (2 vs 1) because each CLI was written separately; that predates this lane and is left alone --
// what matters is that a refused target is non-zero and never reaches an SDK client.
const CLIS = [
  ["salesOrderNumberBackfillCli.js", ["--commit", "c", "--evidence-dir", "/ev", "--operator", "t"], 2],
  ["phantomSalesOrderLinkRepairCli.js", ["--commit", "c", "--evidence-dir", "/ev", "--operator", "t"], 2],
  ["warehouseAssignmentProvisioningCli.js", ["--commit", "c", "--evidence-dir", "/ev", "--operator", "t", "--manifest", "/m.json"], 1],
];
const CLEAN_ENV = { PATH: process.env.PATH, HOME: process.env.HOME, NODE_OPTIONS: "" };

function runCli(script, argv) {
  return spawnSync(process.execPath, [path.join(SCRIPTS, script), ...argv], {
    encoding: "utf8", env: CLEAN_ENV, timeout: 30000, cwd: path.resolve(HERE, ".."),
  });
}
// Any of these appearing in output would mean firebase-admin got far enough to talk about itself.
const FIREBASE_CONTACT = /initializeApp|firebase-admin|Could not load the default credentials|GOOGLE_APPLICATION_CREDENTIALS|firestore\.googleapis\.com|UNAUTHENTICATED|DEADLINE_EXCEEDED/i;

for (const [script, tail, FAIL_CODE] of CLIS) {
  check(`subprocess ${script}: --project taylor-parts under --environment sandbox is refused, no SDK client constructed`, () => {
    const r = runCli(script, ["--project", "taylor-parts", "--confirm-project", "taylor-parts", "--environment", "sandbox", ...tail]);
    assert.equal(r.status, FAIL_CODE, `expected exit ${FAIL_CODE}, got ${r.status}; stderr=${r.stderr}`);
    assert.notEqual(r.status, 0, "a refused target must never exit 0");
    assert.match(r.stderr, /only accepts --project/);
    assert.ok(!FIREBASE_CONTACT.test(r.stderr + r.stdout), `firebase-admin appears to have been reached:\n${r.stderr}`);
  });

  check(`subprocess ${script}: --environment production is refused, no SDK client constructed`, () => {
    const r = runCli(script, ["--project", "taylor-parts", "--confirm-project", "taylor-parts", "--environment", "production", ...tail]);
    assert.equal(r.status, FAIL_CODE, `expected exit ${FAIL_CODE}, got ${r.status}; stderr=${r.stderr}`);
    assert.notEqual(r.status, 0, "a refused target must never exit 0");
    assert.match(r.stderr, /--environment must be exactly "sandbox"/);
    assert.ok(!FIREBASE_CONTACT.test(r.stderr + r.stdout), `firebase-admin appears to have been reached:\n${r.stderr}`);
  });

  check(`subprocess ${script}: a missing --environment is refused, no SDK client constructed`, () => {
    const r = runCli(script, ["--project", "eos-platform-sandbox", "--confirm-project", "eos-platform-sandbox", ...tail]);
    assert.equal(r.status, FAIL_CODE, `expected exit ${FAIL_CODE}, got ${r.status}; stderr=${r.stderr}`);
    assert.notEqual(r.status, 0, "a refused target must never exit 0");
    assert.match(r.stderr, /--environment is required/);
    assert.ok(!FIREBASE_CONTACT.test(r.stderr + r.stdout), `firebase-admin appears to have been reached:\n${r.stderr}`);
  });
}

// ---- the three CLIs all share THIS implementation (no copy can drift back in) ---------------------
check("all three CLIs re-export the SAME guard functions from sandboxTargetGuard.js (no re-duplication)", () => {
  for (const [script] of CLIS) {
    const cli = require(path.join(SCRIPTS, script));
    assert.equal(cli.resolveSandboxProjectIds, guard.resolveSandboxProjectIds, `${script} must re-export the shared resolver`);
    assert.equal(cli.loadEnvironmentRegistry, guard.loadEnvironmentRegistry, `${script} must re-export the shared registry loader`);
    assert.equal(typeof cli.resolveSandboxProjectId, "undefined", `${script} must NOT still export the obsolete singular resolver`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
