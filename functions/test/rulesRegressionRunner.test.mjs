// Self-tests for the Firestore Rules Regression runner (Issue #221). These prove
// the runner's behavior WITHOUT starting a real emulator, by injecting fakes for
// every side-effecting dependency. Run: node functions/test/rulesRegressionRunner.test.mjs
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  runAll,
  resolvePaths,
  checkRulesIdentical,
  parseSuiteResult,
  firebaseChildEnv,
  descendantPids,
  SUITES,
  EXPECTED_TOTAL,
} from "../scripts/rulesRegressionRunner.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNNER_SRC = readFileSync(join(HERE, "..", "scripts", "rulesRegressionRunner.mjs"), "utf8");
// Comment-stripped source: the "no credential / no name-based kill" proofs are about
// what the CODE does, not what the documentation mentions (the runner's own comments
// legitimately say it needs "no service-account/secret").
const RUNNER_CODE = RUNNER_SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }
async function okAsync(name, fn) { await fn(); passed += 1; console.log("PASS -- " + name); }

// Helpers to build injected deps that never touch a real emulator/filesystem.
const okIdentity = () => ({ ok: true });
function fakeEmu(spy) { return { async stop() { if (spy) spy.stopped += 1; return true; } }; }
const silent = () => {};

// ===== 1. Caller cwd does not control the selected firebase.json or Rules =====
await okAsync("1. path resolution is anchored to the runner, not the caller cwd", async () => {
  const original = process.cwd();
  const tmp = mkdtempSync(join(tmpdir(), "rr-cwd-"));
  try {
    process.chdir(tmp);
    const p = resolvePaths(); // default runnerDir = the module's own dir
    // Anchored to the repo (…/functions/scripts -> repoRoot), never to the tmp cwd.
    assert.ok(p.rootFirebaseJson.endsWith(join("firebase.json")));
    assert.ok(p.rootRules.endsWith(join("firestore.rules")));
    assert.ok(p.viteRules.includes(join("field-ops-app-vite", "firestore.rules")));
    assert.ok(p.testDir.includes(join("functions", "test")));
    assert.ok(!p.rootFirebaseJson.startsWith(tmp), "must not resolve under the caller cwd");
    // Explicitly passing a different runnerDir changes the anchor -> proves it is
    // the runner location, not cwd, that drives resolution.
    const other = resolvePaths(join("X", "functions", "scripts"));
    assert.notEqual(other.repoRoot, p.repoRoot);
  } finally {
    process.chdir(original);
  }
});

// ===== 2. Root/Vite Rules mismatch fails BEFORE emulator startup =====
await okAsync("2. Rules mismatch fails before any emulator is started", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rr-rules-"));
  const a = join(dir, "root.rules"); const b = join(dir, "vite.rules");
  writeFileSync(a, "rules_version='2';\nA\n"); writeFileSync(b, "rules_version='2';\nB\n"); // different
  let started = 0;
  const r = await runAll({
    resolvePaths: () => ({ repoRoot: dir, rootFirebaseJson: "x", rootRules: a, viteRules: b, testDir: dir }),
    startEmulator: () => { started += 1; return fakeEmu(); },
    runSuite: async () => ({ code: 0, stdout: "1 passed, 0 failed", timedOut: false }),
    log: silent,
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, 1);
  assert.equal(r.reason, "rules-mismatch");
  assert.equal(started, 0, "emulator must NOT start on a Rules mismatch");
  // And identical files pass the check.
  writeFileSync(b, "rules_version='2';\nA\n");
  assert.equal(checkRulesIdentical(a, b).ok, true);
});

// ===== 3. Suites execute in the declared order =====
await okAsync("3. suites run in the declared order", async () => {
  const byFile = new Map(SUITES.map((s) => [s.file, s.expected]));
  const order = [];
  const r = await runAll({
    resolvePaths: () => ({ repoRoot: "/", rootRules: "r", viteRules: "v", testDir: "/t" }),
    checkRulesIdentical: okIdentity,
    startEmulator: () => fakeEmu(),
    runSuite: async (suitePath) => {
      const file = suitePath.split(/[\\/]/).pop();
      order.push(file);
      return { code: 0, stdout: `${byFile.get(file)} passed, 0 failed`, timedOut: false };
    },
    log: silent,
  });
  assert.equal(r.ok, true);
  assert.deepEqual(order, SUITES.map((s) => s.file));
});

// ===== 4. A suite failure stops subsequent suites =====
await okAsync("4. a suite failure stops the remaining suites", async () => {
  let calls = 0;
  const r = await runAll({
    resolvePaths: () => ({ repoRoot: "/", rootRules: "r", viteRules: "v", testDir: "/t" }),
    checkRulesIdentical: okIdentity,
    startEmulator: () => fakeEmu(),
    runSuite: async () => { calls += 1; return calls === 2 ? { code: 1, stdout: "5 passed, 1 failed", timedOut: false } : { code: 0, stdout: "10 passed, 0 failed", timedOut: false }; },
    parseSuiteResult: (stdout) => parseSuiteResult(stdout, /1 failed/.test(stdout) ? 6 : 10),
    log: silent,
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, 1);
  assert.equal(calls, 2, "must stop after the 2nd (failing) suite, not run suites 3-6");
});

// ===== 5. A timeout fails and cleans up owned processes =====
await okAsync("5. a suite timeout fails and tears down the owned emulator", async () => {
  const spy = { stopped: 0 };
  let calls = 0;
  const r = await runAll({
    resolvePaths: () => ({ repoRoot: "/", rootRules: "r", viteRules: "v", testDir: "/t" }),
    checkRulesIdentical: okIdentity,
    startEmulator: () => fakeEmu(spy),
    runSuite: async () => { calls += 1; return { code: null, stdout: "", timedOut: true }; },
    log: silent,
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "timeout");
  assert.equal(calls, 1, "must stop on the first timed-out suite");
  assert.equal(spy.stopped, 1, "must tear down the owned emulator on timeout");
});

// ===== 6. Foreign processes are never terminated =====
ok("6. teardown is PID-only -- no name/command-line process termination anywhere", () => {
  // taskkill must target /pid, never /IM (image name); no pkill/killall/wmic by name.
  assert.ok(/taskkill/.test(RUNNER_CODE), "expected a taskkill by PID on win32");
  assert.ok(!/\/IM\b/i.test(RUNNER_CODE), "must not taskkill by image name (/IM)");
  assert.ok(!/pkill|killall|Get-Process\s+-Name|wmic/i.test(RUNNER_CODE), "must not kill by process name");
  // The win32 kill passes /pid + the tracked pid; the POSIX kill sends signals to
  // exact numeric descendant PIDs of the owned root (never a group or a name).
  assert.ok(/\"\/pid\"|'\/pid'/.test(RUNNER_CODE));
  assert.ok(/process\.kill\(p, ?"SIGKILL"\)/.test(RUNNER_CODE), "POSIX kill must target exact descendant PIDs");
  // The descendant set is built from ppid links only -- ps is asked for pid/ppid,
  // never a name/command filter (no -C, no comm=, no grep-by-name).
  assert.ok(/ps",\s*\["-eo",\s*"pid=,ppid="\]/.test(RUNNER_CODE), "ps must read pid/ppid only");
  assert.ok(!/-C\b|comm=|args=|-o\s+command/.test(RUNNER_CODE), "ps must not select by process name/command");
});

// ===== 6b. descendantPids selects ONLY the owned subtree, never siblings =====
ok("6b. descendantPids returns only the owned root's descendants by PID", () => {
  // Fake process table: 100 -> {200 -> 300}, plus an unrelated foreign tree 900 -> 999.
  const table = [
    { pid: 100, ppid: 1 }, { pid: 200, ppid: 100 }, { pid: 300, ppid: 200 },
    { pid: 900, ppid: 1 }, { pid: 999, ppid: 900 }, // foreign -- must NOT be selected
  ];
  const got = descendantPids(100, () => table).sort((a, b) => a - b);
  assert.deepEqual(got, [200, 300], "only owned descendants; never the foreign 900/999 tree");
  assert.deepEqual(descendantPids(555, () => table), [], "unknown root -> no PIDs");
});

// ===== 7. Successful execution reports exactly EXPECTED_TOTAL passed and 0 failed =====
// Issue #100 PR 1b -- EXPECTED_TOTAL grew from 178 to 184 (PR #236) when
// issue100PartsManagerRules.test.js gained 6 new assertions for the scoped
// employees Assign-candidate read grant, then from 184 to 194 (PR #237, the
// least-privilege correction to PR #236) when employeesRules.test.js gained 10
// assertions tightening that read to the full assignment-candidate contract
// (ACTIVE + PARTS_ASSOCIATE-eligible + linked user), then from 194 to 256
// (Issue #226 Row 3 / Task 8) when enterpriseAccessFoundationRules.test.js
// added 62 assertions proving the five new governed-storage collections
// (permissions/roles/roleAssignments/accessRequests/auditEvents) are closed
// to all client read/write, then from 256 to 365 (Issue #232 unit E3) when
// equipmentRules.test.js added 109 assertions for the new `equipment` match
// block: admin/dispatcher authority only, cross-Account/dangling Location
// denial, governed-field immutability on ordinary edit, trusted/audit field
// injection denial, and delete denied for everyone, then from 365 to 385
// (Issue #15 production-readiness closeout, part 2) when
// workOrderEngineRules.test.js added 20 assertions proving fieldops_wos/
// counters/inventory_sync_status are unconditionally closed to direct
// client writes and fieldops_wos reads are role/ownership-scoped, then from
// 385 to 410 (Issue #226 WAREHOUSE_MANAGER scoped access, Implementation
// Plan Row B) when warehouseManagerScopedAccessRules.test.js added 25
// assertions proving the new isAssignedToWarehouse() additive read arms on
// warehouses/stock_locations/transfer_orders: admin/dispatcher unaffected
// across all three collections, a scoped manager reads only their assigned
// warehouse(s) (both transfer_orders endpoints), every fail-closed case
// (missing/inactive/unlinked Employee, wrong operational role, missing/
// empty/malformed assignedWarehouseIds) denies, and write posture
// (Admin-SDK-only) is unchanged for both a scoped manager and admin across
// all three collections, then from 410 to 440 (Issue #325 D-RULES,
// original design) when reportDefinitionsRules.test.js added 30
// assertions proving a client-direct-write, owner-only Rules contract
// for the new reportDefinitions collection, then from 440 to 423 (Issue
// #325, D-RULES CORRECTED before W-SAVE activation) when that same
// suite was REWRITTEN down to 13 assertions proving the opposite: ALL
// direct client read/write on reportDefinitions is now denied
// unconditionally, for every principal including admin -- the trusted
// saved-definition service (functions/src/reporting/
// savedDefinitionCommands.ts) is the only remaining path, matching this
// program's own governed-storage posture (roleAssignments/auditEvents/
// etc.) rather than a bespoke ownership-Rules model. Then from 439 to
// 482 (F-RULES-1 PR-C; INV-1 PR 1.2's partMasterRules +16 landed first,
// 423->439) when legacyJobsTechniciansRules.test.js was registered
// STRICT with 43 assertions: technician direct completion and the
// interim technician own-status write are DENIED (completion is the
// trusted completeAssignedJob callable's sole authority), plus audit-
// forgery and field-smuggling denial coverage -- deploy-order
// D1-before-D2 is documented in that suite's header. This self-test's
// own literal sanity-check is updated to match, same as it must be
// updated any time SUITES' expected counts change -- a deliberate
// hardcoded cross-check that EXPECTED_TOTAL wasn't silently miscomputed,
// not a value that should ever drift unnoticed.
await okAsync("7. a fully-passing run reports exactly 502 passed, 0 failed", async () => {
  const byFile = new Map(SUITES.map((s) => [s.file, s.expected]));
  const lines = [];
  const r = await runAll({
    resolvePaths: () => ({ repoRoot: "/", rootRules: "r", viteRules: "v", testDir: "/t" }),
    checkRulesIdentical: okIdentity,
    startEmulator: () => fakeEmu(),
    runSuite: async (suitePath) => {
      const exp = byFile.get(suitePath.split(/[\\/]/).pop());
      return { code: 0, stdout: `\n${exp} passed, 0 failed`, timedOut: false }; // real counts, real parser
    },
    log: (s) => lines.push(s),
  });
  assert.equal(r.ok, true);
  assert.equal(r.code, 0);
  assert.equal(r.totalPassed, EXPECTED_TOTAL);
  // 423 -> 439: INV-1 Phase 1 PR 1.2 added partMasterRules.test.js (16
  // assertions -- parts + manufacturers fully client-closed). 439 -> 482:
  // F-RULES-1 PR-C registered legacyJobsTechniciansRules.test.js (43
  // assertions, STRICT by default). 482 -> 490: INV-1 PR 1.3 registered
  // partAliasRules.test.js (8 assertions -- part_aliases fully closed).
  assert.equal(EXPECTED_TOTAL, 502); // INV-1 PR 1.9: partMasterRules 16->20 (parts read posture)
  assert.ok(lines.some((l) => /502 passed, 0 failed/.test(l)), "summary must state 502 passed, 0 failed");
  // parseSuiteResult correctness (count-mismatch and failed>0 both fail).
  assert.equal(parseSuiteResult("10 passed, 0 failed", 10).ok, true);
  assert.equal(parseSuiteResult("9 passed, 0 failed", 10).ok, false);
  assert.equal(parseSuiteResult("10 passed, 2 failed", 10).ok, false);
  assert.equal(parseSuiteResult("no summary here", 10).ok, false);
});

// ===== 8. No credential or production prerequisite is used =====
await okAsync("8. no credential/production prerequisite; emulator-only, fixed local project", async () => {
  // Source contains no credential/production access.
  assert.ok(!/GOOGLE_APPLICATION_CREDENTIALS|serviceAccount|service-account|applicationDefault|apiKey|API_KEY|process\.env\.[A-Z_]*SECRET|firebase deploy/i.test(RUNNER_CODE));
  assert.ok(!/firestore\.googleapis\.com|identitytoolkit\.googleapis\.com/.test(RUNNER_CODE), "must not reference production endpoints");
  // Uses the fixed local project + loopback emulator only.
  assert.ok(/projectId:\s*"taylor-parts"/.test(RUNNER_CODE));
  assert.ok(/host:\s*"127\.0\.0\.1"/.test(RUNNER_CODE));
  assert.ok(/--only.*firestore,auth|"firestore,auth"/.test(RUNNER_CODE));
  // Orchestration runs with NO cloud credentials present in the environment.
  const byFile = new Map(SUITES.map((s) => [s.file, s.expected]));
  const saved = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  try {
    const r = await runAll({
      resolvePaths: () => ({ repoRoot: "/", rootRules: "r", viteRules: "v", testDir: "/t" }),
      checkRulesIdentical: okIdentity,
      startEmulator: () => fakeEmu(),
      runSuite: async (suitePath) => ({ code: 0, stdout: `${byFile.get(suitePath.split(/[\\/]/).pop())} passed, 0 failed`, timedOut: false }),
      log: silent,
    });
    assert.equal(r.ok, true, "runner completes with no cloud credentials in the environment");
  } finally {
    if (saved !== undefined) process.env.GOOGLE_APPLICATION_CREDENTIALS = saved;
  }
});

// ===== 9. The firebase CLI child env is sanitized (VSCODE_CWD stripped) =====
ok("9. firebaseChildEnv strips only VSCODE_CWD and preserves everything else", () => {
  // firebase-tools reads VSCODE_CWD to switch to its bundled-extension template
  // path; a VSCode integrated terminal sets it, which breaks a normal install.
  const src = { VSCODE_CWD: "C:/vscode", PATH: "/bin", JAVA_HOME: "/jdk", FOO: "bar" };
  const clean = firebaseChildEnv(src);
  assert.equal(clean.VSCODE_CWD, undefined, "VSCODE_CWD must be removed");
  assert.equal(clean.PATH, "/bin");
  assert.equal(clean.JAVA_HOME, "/jdk");
  assert.equal(clean.FOO, "bar");
  assert.equal(src.VSCODE_CWD, "C:/vscode", "must not mutate the caller's env object");
  // The emulator spawn actually applies it (no raw process.env passed to firebase).
  assert.ok(/env:\s*firebaseChildEnv\(\)/.test(RUNNER_CODE), "emulator spawn must use firebaseChildEnv()");
});

console.log(`\n${passed} passed, 0 failed`);
