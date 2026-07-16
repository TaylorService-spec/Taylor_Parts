// Firestore Rules Regression runner (Issue #221). Runs the NINE permanent
// Firestore Rules emulator suites SEQUENTIALLY, each against a FRESHLY started
// Firestore+Auth emulator, and reports a concise per-suite + total summary.
//
// Design goals (see the module's exported, injectable pieces + rulesRegression
// Runner.test.mjs):
//   - Deterministic + cross-platform (local Windows AND the GitHub Actions Linux
//     runner). No test framework, no new heavyweight deps.
//   - Every path resolves from THIS FILE's location (import.meta.url), never from
//     the caller's process.cwd().
//   - Uses ONLY the local Firestore/Auth emulators for project "taylor-parts"
//     with an explicit ABSOLUTE root firebase.json. It never contacts or writes
//     production, needs no credentials / service-account / API key / secret, and
//     never prints tokens, passwords, or fixture document contents (it only
//     surfaces each suite's own "N passed, M failed" summary line).
//   - One suite at a time, each with an explicit timeout, stop on the first
//     failed/timed-out suite.
//   - Tears down ONLY the exact owned emulator child process TREE (by PID) --
//     never a broad process-name or command-line match.
//   - Returns a nonzero exit code on Rules-file mismatch, emulator startup/
//     readiness failure, suite timeout, assertion failure, or teardown failure.

import { spawn, spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import net from "node:net";

const RUNNER_DIR = dirname(fileURLToPath(import.meta.url));

// Emulator identity. Must match the root firebase.json emulator ports. The suites
// themselves also pin these exact hosts.
export const EMULATOR = Object.freeze({
  host: "127.0.0.1",
  firestorePort: 8080,
  authPort: 9099,
  projectId: "taylor-parts",
});

// The canonical, ORDERED suite list with expected pass counts. Order matters.
export const SUITES = Object.freeze([
  { file: "employeesRules.test.js", expected: 20 },
  { file: "reorderRequestsRules.test.js", expected: 82 },
  { file: "accountsGovernedFieldsRules.test.js", expected: 18 },
  { file: "issue100PartsManagerRules.test.js", expected: 40 },
  { file: "issue100WarehouseManagerRules.test.js", expected: 11 },
  { file: "issue100PartsAssociateRules.test.js", expected: 23 },
  { file: "enterpriseAccessFoundationRules.test.js", expected: 62 },
  { file: "equipmentRules.test.js", expected: 109 },
  { file: "workOrderEngineRules.test.js", expected: 20 },
  { file: "warehouseManagerScopedAccessRules.test.js", expected: 25 },
]);
export const EXPECTED_TOTAL = SUITES.reduce((n, s) => n + s.expected, 0); // 410 (PR #236: issue100PartsManager 34->40; PR #237 tightening: employees 10->20; Issue #226 Row 3: +62 enterpriseAccessFoundationRules; Issue #232 E3: +109 equipmentRules; Issue #15 readiness closeout part 2: +20 workOrderEngineRules; Issue #226 WAREHOUSE_MANAGER scoped access Row B: +25 warehouseManagerScopedAccessRules)

export const SUITE_TIMEOUT_MS = 180_000;
export const EMULATOR_STARTUP_TIMEOUT_MS = 120_000;
export const EMULATOR_TEARDOWN_TIMEOUT_MS = 30_000;

// Resolve every path from the RUNNER's own directory. Runner lives at
// <repo>/functions/scripts/, so repo root is two levels up -- independent of the
// caller's process.cwd().
export function resolvePaths(runnerDir = RUNNER_DIR) {
  const repoRoot = resolve(runnerDir, "..", "..");
  return {
    repoRoot,
    rootFirebaseJson: join(repoRoot, "firebase.json"),
    rootRules: join(repoRoot, "firestore.rules"),
    viteRules: join(repoRoot, "field-ops-app-vite", "firestore.rules"),
    testDir: join(repoRoot, "functions", "test"),
  };
}

// Byte-identical comparison of the root vs Vite Rules files.
export function checkRulesIdentical(rootRulesPath, viteRulesPath) {
  if (!existsSync(rootRulesPath)) return { ok: false, reason: `missing root Rules file: ${rootRulesPath}` };
  if (!existsSync(viteRulesPath)) return { ok: false, reason: `missing Vite Rules file: ${viteRulesPath}` };
  if (readFileSync(rootRulesPath).equals(readFileSync(viteRulesPath))) return { ok: true };
  return { ok: false, reason: "root firestore.rules and field-ops-app-vite/firestore.rules are NOT byte-identical" };
}

// Parse a suite's "N passed, M failed" summary and compare to the expected count.
export function parseSuiteResult(stdout, expected) {
  const m = /(\d+)\s+passed,\s+(\d+)\s+failed/.exec(stdout || "");
  if (!m) return { ok: false, passed: 0, failed: 0, reason: "no 'N passed, M failed' summary found" };
  const passed = Number(m[1]);
  const failed = Number(m[2]);
  if (failed > 0) return { ok: false, passed, failed, reason: `${failed} assertion(s) failed` };
  if (passed !== expected) return { ok: false, passed, failed, reason: `expected ${expected} passed, got ${passed}` };
  return { ok: true, passed, failed };
}

// The pinned firebase CLI bin from functions/node_modules (never a global).
export function firebaseBin(repoRoot) {
  return join(repoRoot, "functions", "node_modules", "firebase-tools", "lib", "bin", "firebase.js");
}

// Env for the firebase CLI child. firebase-tools treats a set VSCODE_CWD as its
// bundled IDE-extension build and then looks for templates under lib/templates/,
// which a normal npm install does not ship (they live at the package root). A
// VSCode integrated terminal exports VSCODE_CWD, which would break emulator
// startup locally; CI never sets it. Strip only that one var -- everything else
// (PATH, JAVA_HOME, etc.) is preserved. No credentials are added or referenced.
export function firebaseChildEnv(env = process.env) {
  const clean = { ...env };
  delete clean.VSCODE_CWD;
  return clean;
}

// The owned emulator's descendant PIDs, discovered from the process table via
// parent->child (ppid) links ONLY. Every process is selected by its numeric PID
// as a descendant of the owned root -- never by process name or command line.
// We walk the descendant tree (not the process group) because firebase-tools
// places the emulator's Java child in its OWN process group, so a group-kill of
// the node parent would leave that Java process -- and its port -- alive.
export function descendantPids(rootPid, psRunner = defaultPsRunner) {
  const table = psRunner(); // [{ pid, ppid }, ...] snapshot of all processes
  const childrenByParent = new Map();
  for (const { pid, ppid } of table) {
    if (!childrenByParent.has(ppid)) childrenByParent.set(ppid, []);
    childrenByParent.get(ppid).push(pid);
  }
  const out = [];
  const stack = [rootPid];
  while (stack.length) {
    for (const c of childrenByParent.get(stack.pop()) || []) { out.push(c); stack.push(c); }
  }
  return out;
}

function defaultPsRunner() {
  const res = spawnSync("ps", ["-eo", "pid=,ppid="], { encoding: "utf8" });
  if (res.status !== 0 || !res.stdout) return [];
  const rows = [];
  for (const line of res.stdout.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)/.exec(line);
    if (m) rows.push({ pid: Number(m[1]), ppid: Number(m[2]) });
  }
  return rows;
}

// Kill ONLY the given owned process TREE, by PID -- never by name/command-line.
// win32: taskkill /pid /t walks and kills the owned tree by PID. POSIX: SIGKILL
// each owned descendant PID (found via ppid links) plus the root PID.
export function killTree(pid) {
  if (!pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore" });
    return;
  }
  for (const p of [...descendantPids(pid), pid]) {
    try { process.kill(p, "SIGKILL"); } catch { /* already gone */ }
  }
}

function portOpen(host, port, timeoutMs = 1000) {
  return new Promise((res) => {
    const sock = net.connect({ host, port });
    const done = (v) => { sock.destroy(); res(v); };
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
    sock.setTimeout(timeoutMs, () => done(false));
  });
}
async function waitForPort(host, port, wantOpen, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if ((await portOpen(host, port)) === wantOpen) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

// Start a FRESH Firestore+Auth emulator for one suite. Uses the explicit absolute
// root firebase.json and the fixed local project; contacts no production. Returns
// the owned child + a stop() that tears down ONLY that child's tree and waits for
// the emulator ports to free (teardown failure => stop() resolves false).
async function startEmulator(paths) {
  const args = [
    firebaseBin(paths.repoRoot),
    "emulators:start",
    "--only", "firestore,auth",
    "--project", EMULATOR.projectId,
    "--config", paths.rootFirebaseJson,
  ];
  const child = spawn(process.execPath, args, {
    cwd: paths.repoRoot,
    env: firebaseChildEnv(),
    detached: process.platform !== "win32", // own process group on POSIX for tree-kill
    stdio: ["ignore", "pipe", "pipe"],
  });
  let ready = false;
  child.stdout.on("data", (d) => { if (/All emulators ready/.test(String(d))) ready = true; });
  child.stderr.on("data", () => {});

  const start = Date.now();
  while (Date.now() - start < EMULATOR_STARTUP_TIMEOUT_MS) {
    if (child.exitCode !== null) { killTree(child.pid); throw new Error("emulator process exited during startup"); }
    if (ready && (await portOpen(EMULATOR.host, EMULATOR.firestorePort)) && (await portOpen(EMULATOR.host, EMULATOR.authPort))) {
      return {
        child,
        async stop() {
          killTree(child.pid);
          const a = await waitForPort(EMULATOR.host, EMULATOR.firestorePort, false, EMULATOR_TEARDOWN_TIMEOUT_MS);
          const b = await waitForPort(EMULATOR.host, EMULATOR.authPort, false, EMULATOR_TEARDOWN_TIMEOUT_MS);
          return a && b;
        },
      };
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  killTree(child.pid);
  throw new Error("emulator did not become ready within the startup timeout");
}

// Run one suite (node <suite>) against the already-running emulator, with a hard
// timeout. On timeout the suite process tree (owned) is killed.
function runSuiteProcess(suitePath, timeoutMs) {
  return new Promise((res) => {
    const child = spawn(process.execPath, [suitePath], {
      env: {
        ...process.env,
        FIRESTORE_EMULATOR_HOST: `${EMULATOR.host}:${EMULATOR.firestorePort}`,
        FIREBASE_AUTH_EMULATOR_HOST: `${EMULATOR.host}:${EMULATOR.authPort}`,
      },
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let timedOut = false;
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { out += d; });
    const timer = setTimeout(() => { timedOut = true; killTree(child.pid); }, timeoutMs);
    child.on("close", (code) => { clearTimeout(timer); res({ code, stdout: out, timedOut }); });
    child.on("error", (e) => { clearTimeout(timer); res({ code: 1, stdout: out + String(e), timedOut }); });
  });
}

// Orchestration. Every side-effecting dependency is injectable so the behavior
// (order, stop-on-failure, timeout cleanup, totals) is unit-testable WITHOUT
// starting a real emulator.
export async function runAll(deps = {}) {
  const paths = (deps.resolvePaths || resolvePaths)();
  const log = deps.log || ((s) => console.log(s));
  const suites = deps.suites || SUITES;
  const suiteTimeout = deps.suiteTimeout || SUITE_TIMEOUT_MS;
  const startEmu = deps.startEmulator || (() => startEmulator(paths));
  const runSuite = deps.runSuite || runSuiteProcess;
  const parse = deps.parseSuiteResult || parseSuiteResult;
  const rulesIdentical = deps.checkRulesIdentical || checkRulesIdentical;

  // 1. Rules identity check BEFORE any emulator starts.
  const identity = rulesIdentical(paths.rootRules, paths.viteRules);
  if (!identity.ok) {
    log(`FAIL rules-identity: ${identity.reason}`);
    return { ok: false, code: 1, reason: "rules-mismatch", results: [], totalPassed: 0 };
  }
  log("OK   root and field-ops-app-vite firestore.rules are byte-identical");

  const results = [];
  let totalPassed = 0;
  for (const suite of suites) {
    const suitePath = join(paths.testDir, suite.file);

    let emu;
    try {
      emu = await startEmu(suite); // FRESH emulator per suite
    } catch (e) {
      log(`FAIL ${suite.file}: emulator startup -- ${e.message}`);
      results.push({ file: suite.file, ok: false, reason: "emulator-startup" });
      return { ok: false, code: 1, reason: "emulator-startup", results, totalPassed };
    }

    const { code, stdout, timedOut } = await runSuite(suitePath, suiteTimeout);

    // Always tear down the owned emulator, whatever the suite outcome.
    let teardownOk = true;
    try { teardownOk = await emu.stop(); } catch { teardownOk = false; }

    if (timedOut) {
      log(`FAIL ${suite.file}: TIMED OUT after ${suiteTimeout}ms (owned processes cleaned up)`);
      results.push({ file: suite.file, ok: false, reason: "timeout" });
      return { ok: false, code: 1, reason: "timeout", results, totalPassed };
    }
    const parsed = parse(stdout, suite.expected);
    if (!parsed.ok || code !== 0) {
      const reason = parsed.reason || `suite exited ${code}`;
      log(`FAIL ${suite.file}: ${reason}`);
      results.push({ file: suite.file, ok: false, passed: parsed.passed, reason });
      return { ok: false, code: 1, reason, results, totalPassed };
    }
    if (!teardownOk) {
      log(`FAIL ${suite.file}: teardown did not free the emulator ports`);
      results.push({ file: suite.file, ok: false, reason: "teardown" });
      return { ok: false, code: 1, reason: "teardown", results, totalPassed };
    }

    totalPassed += parsed.passed;
    results.push({ file: suite.file, ok: true, passed: parsed.passed });
    log(`PASS ${suite.file}: ${parsed.passed}/${suite.expected}`);
  }

  if (totalPassed !== EXPECTED_TOTAL) {
    log(`\nFAIL total: expected ${EXPECTED_TOTAL} passed, got ${totalPassed}`);
    return { ok: false, code: 1, reason: "total-mismatch", results, totalPassed };
  }
  log(`\n${totalPassed} passed, 0 failed  (${results.length} suites)`);
  return { ok: true, code: 0, results, totalPassed };
}

// Executed only when run directly (`node functions/scripts/rulesRegressionRunner.mjs`).
async function main() {
  const r = await runAll();
  process.exit(r.code);
}
const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((e) => { console.error("rules regression runner failed:", e && e.message); process.exit(1); });
}
