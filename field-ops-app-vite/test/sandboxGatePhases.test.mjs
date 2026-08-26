// THE ACCEPTANCE GATE CANNOT REPORT PASS OVER A RUN THAT DID NOT HAPPEN.
//
// ============================ WHY THIS SUITE EXISTS ============================
//
// scripts/_sandboxRegressionGate.sh is the instrument that decides whether a sandbox refresh is
// accepted. Nothing else in this repository is checked by it, so nothing else can catch it being
// wrong -- and the failure mode that matters is not "the gate errors", it is "the gate prints PASS
// having skipped something".
//
// `set -e` answers "did a phase FAIL". It cannot answer "did a phase RUN". A commented-out
// invocation, a phase moved inside a conditional that turns out false, a stray `exit 0`, or an edit
// that shifts the file under a running shell are all ways for a phase to be silently absent, and
// none of them is a non-zero exit.
//
// The last of those is not hypothetical. A real certification run died at exit 127 reporting
// "sweep: command not found" against a BLANK line, because the script was edited while bash was
// executing it -- bash reads a script incrementally by BYTE OFFSET, so inserting lines ahead of the
// cursor makes it resume mid-line and execute a fragment of a comment. On that occasion `set -e`
// did stop the run and no banner printed. It was caught by luck: the fragment happened not to be a
// runnable command. A fragment that parsed would have skipped three phases in silence.
//
// ============================ WHY IT EXECUTES THE SCRIPT ============================
//
// Every assertion below RUNS the real gate against stubs. A source-text check -- "the file contains
// gate_pass_banner" -- passes on a script that defines the function and never calls it, which is
// precisely the class of defect being defended against. The stubs replace the slow, external and
// destructive parts (node, npm, curl, git) so the SHELL LOGIC is what is under test.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");
const GATE = join(REPO_ROOT, "scripts", "_sandboxRegressionGate.sh");

// A BASH THAT SHARES THE WINDOWS PATH. A bare `bash` on Windows usually resolves to the WSL shim,
// which is a different machine without node on PATH -- the same trap the gate's own header warns
// about. On CI (ubuntu) /usr/bin/bash is correct and the candidates below fall through to it.
function findBash() {
  const candidates = ["/usr/bin/bash", "/bin/bash", "D:/Git/usr/bin/bash.exe", "C:/Program Files/Git/usr/bin/bash.exe"];
  for (const c of candidates) if (existsSync(c)) return c;
  return "bash";
}
const BASH = findBash();

const PHASE_ECHOES = {
  identity: "[1/6] deployed identity",
  "repo-guards": "[2/6] repo guards",
  "create-reach": "[3/6] create -> reach",
  sweep: "[4/6] structural",
  dynamic: "[4b/6] dynamic detail",
  "crash-stress": "[4c/6] crash stress",
  reachability: "[5/6] persona reachability",
  scanner: "[6/6] scanner scenarios",
};

/**
 * Run the gate with its external tools stubbed.
 *
 * `mutate` receives the gate source and returns the version to run, so a test can express a defect
 * as a one-line edit rather than maintaining a parallel copy that drifts from the real thing.
 */
function runGate({ mutate = (s) => s, failing = null, env = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "gate-"));
  const bin = join(dir, "bin");
  mkdirSync(bin, { recursive: true });

  // The stub toolchain. `node` answers the two JSON probes the identity phase makes and otherwise
  // succeeds; `failing` names one argv substring that must exit non-zero, which is how a test says
  // "this phase fails".
  const failMatch = failing ? failing.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : "__never__";
  // DRAIN STDIN FIRST, ALWAYS.
  //
  // The gate pipes curl into `node -e` for the identity probes. A stub that exits without reading
  // its input closes the pipe while curl is still writing, curl takes SIGPIPE, and `pipefail` turns
  // that into a gate exit of 141 -- intermittently, because it is a race. That flaked roughly one
  // run in five and looked exactly like the gate failing at random.
  //
  // The real `node -e` scripts read to 'end' before writing, so the gate never had this; the stub
  // did. A harness that fails differently from the thing it models tests the harness.
  writeFileSync(join(bin, "node"), `#!/usr/bin/env bash
cat >/dev/null 2>&1 || true
case "$*" in
  *${failMatch}*) echo "[stub] deliberate failure in: $*" >&2; exit 1 ;;
esac
case "$*" in
  *"JSON.parse(d).base"*) printf '' ;;
  *"JSON.parse(d).commit"*) printf 'deadbeef' ;;
  *) echo "[stub node] $*" ;;
esac
exit 0
`);
  writeFileSync(join(bin, "npm"), `#!/usr/bin/env bash
case "$*" in *${failMatch}*) echo "[stub] deliberate npm failure" >&2; exit 1 ;; esac
echo "[stub npm] $*"; exit 0
`);
  writeFileSync(join(bin, "curl"), `#!/usr/bin/env bash
echo '{"commit":"deadbeef","base":"/","environmentId":"platform-sandbox","environmentRole":"sandbox"}'
exit 0
`);
  // git: ancestry and drift both clean, so the identity phase passes without a real repository.
  writeFileSync(join(bin, "git"), `#!/usr/bin/env bash
case "$1 $2" in
  "merge-base --is-ancestor") exit 0 ;;
  "rev-parse --short=8") echo "deadbeef"; exit 0 ;;
  "diff --name-only") exit 0 ;;
esac
case "$1" in
  rev-parse) echo "deadbeef" ;;
  diff) : ;;
  *) : ;;
esac
exit 0
`);
  for (const f of ["node", "npm", "curl", "git"]) chmodSync(join(bin, f), 0o755);

  const scriptDir = join(dir, "scripts");
  mkdirSync(scriptDir, { recursive: true });
  writeFileSync(join(scriptDir, "_sandboxRegressionGate.sh"), mutate(readFileSync(GATE, "utf8")));
  // The gate cds to its own parent and runs things from there; give it the shape it expects.
  mkdirSync(join(dir, "field-ops-app-vite"), { recursive: true });

  let stdout = "";
  let status = 0;
  try {
    stdout = execFileSync(BASH, [join(scriptDir, "_sandboxRegressionGate.sh")], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    stdout = `${err.stdout ?? ""}${err.stderr ?? ""}`;
    status = err.status ?? 1;
  }
  rmSync(dir, { recursive: true, force: true });
  return { stdout, status };
}

const banners = (out) => (out.match(/SANDBOX REGRESSION GATE: PASS/g) ?? []).length;

// ═════════════════════════════════════ 4. THE CLEAN RUN

test("ALL PHASES SUCCEED -> exit 0, and the PASS banner appears EXACTLY ONCE", () => {
  const { stdout, status } = runGate();
  assert.equal(status, 0, `gate should pass with every stub green:\n${stdout}`);
  assert.equal(banners(stdout), 1, "the banner must print once, not zero times and not twice");
  for (const [phase, echoText] of Object.entries(PHASE_ECHOES)) {
    assert.ok(stdout.includes(echoText), `phase ${phase} never announced itself`);
  }
  assert.match(stdout, /phases completed:.*scanner/, "the banner must list what it is vouching for");
});

// ═════════════════════════════════════ 1. A MISSING COMMAND IN A REQUIRED PHASE

test("A MISSING COMMAND IN A REQUIRED PHASE -> non-zero, and NO banner", () => {
  // Exactly the shape of the real incident: a phase's invocation becomes an unrunnable word.
  const { stdout, status } = runGate({
    mutate: (s) => s.replace(
      `node scripts/runSandboxScannerScenarios.mjs`,
      `sweep scripts/runSandboxScannerScenarios.mjs`,
    ),
  });
  assert.notEqual(status, 0, "an unrunnable command must fail the gate");
  assert.equal(banners(stdout), 0, "no PASS banner may print over a missing command");
  assert.match(stdout, /SANDBOX REGRESSION GATE: FAILED/, "the failure must be stated, not merely implied");
});

// ═════════════════════════════════════ 2. A REQUIRED PHASE RETURNS NON-ZERO

test("A REQUIRED PHASE FAILS -> the gate fails, and later phases cannot overwrite that", () => {
  const { stdout, status } = runGate({ failing: "certify.mjs" });
  assert.notEqual(status, 0, "a failing sweep must fail the gate");
  assert.equal(banners(stdout), 0, "no PASS banner may print over a failed phase");
  // And the phases AFTER the failure must not have run -- a gate that carries on can be talked
  // into a later success overwriting an earlier failure.
  assert.ok(!stdout.includes(PHASE_ECHOES.scanner), "phases after a failure must not run");
});

test("A FAILURE IN THE LAST PHASE IS STILL A FAILURE -- nothing follows it to hide behind", () => {
  const { stdout, status } = runGate({ failing: "runSandboxScannerScenarios.mjs" });
  assert.notEqual(status, 0);
  assert.equal(banners(stdout), 0);
});

// ═════════════════════════════════════ 3. A REQUIRED PHASE NEVER EXECUTES

test("A PHASE THAT NEVER RUNS IS CAUGHT BY THE LEDGER, not by luck", () => {
  // The dangerous case: no error, no non-zero exit, the phase simply is not there. `set -e` is
  // blind to this by construction, which is the whole reason the ledger exists.
  const { stdout, status } = runGate({
    mutate: (s) => s
      .replace(`( cd field-ops-app-vite && node ".claude/skills/run-field-ops-app-vite/crashStress.mjs" admin )`, ":")
      .replace(`( cd field-ops-app-vite && node ".claude/skills/run-field-ops-app-vite/crashStress.mjs" admin slow )`, ":")
      .replace("gate_phase_complete crash-stress", ":"),
  });
  assert.notEqual(status, 0, "a silently absent phase must fail the gate");
  assert.equal(banners(stdout), 0, "no PASS banner over a phase that never ran");
  assert.match(stdout, /GATE INCOMPLETE/, "the gate must name the omission");
  assert.match(stdout, /crash-stress/, "and say which phase was missing");
});

test("EVERY required phase is individually load-bearing -- the ledger names all of them", () => {
  // Proves the ledger is not satisfied by a single sentinel: each name has to be earned separately.
  //
  // This asserts over ONE run with every marker dropped rather than one run per phase. Eight
  // subprocesses spawning bash and a stub toolchain flaked at roughly one run in four on Windows,
  // and a proof that reddens CI at random teaches people to re-run it until it is green -- which is
  // exactly the habit that lets a real failure through. One run, and a stronger claim: every
  // required phase must be named as missing, not just one of them.
  const { stdout, status } = runGate({
    mutate: (s) => s.replace(/^gate_phase_complete .*$/gm, ":"),
  });
  assert.notEqual(status, 0, `a run with no phases recorded must fail:\n${stdout}`);
  assert.equal(banners(stdout), 0, "no PASS banner when nothing was recorded");
  assert.match(stdout, /GATE INCOMPLETE/, `expected the ledger to refuse:\n${stdout}`);
  for (const phase of Object.keys(PHASE_ECHOES)) {
    assert.ok(stdout.includes(phase), `the ledger must name ${phase} as missing:\n${stdout}`);
  }
});

test("THE BANNER CANNOT BE REACHED AROUND -- an early exit still reports failure", () => {
  const { stdout, status } = runGate({
    mutate: (s) => s.replace(`echo "== [4c/6] crash stress (interactions + races) =="`, "exit 3"),
  });
  assert.equal(status, 3);
  assert.equal(banners(stdout), 0);
  assert.match(stdout, /SANDBOX REGRESSION GATE: FAILED \(exit 3\)/);
});

// ═════════════════════════════════════ 5. FRESH CHECKOUT

test("FRESH CHECKOUT: the gate derives its own route list rather than needing a hand-made file", () => {
  // .certification/routes.json is gitignored and written by nothing that ships. The gate used to
  // die on ENOENT three phases in; it now generates the list from navConfig before sweeping.
  const gate = readFileSync(GATE, "utf8");
  const generatorCall = gate.indexOf("_certificationRoutes.mjs");
  const sweepCall = gate.indexOf("certify.mjs\" admin 1440,1024,768,375,320");
  assert.ok(generatorCall > 0, "the gate must generate the route list");
  assert.ok(sweepCall > 0, "the sweep must still be there");
  assert.ok(generatorCall < sweepCall, "the list must be generated BEFORE it is swept");
});

test("the route generator writes a usable list from a clean tree, and refuses a collapsed one", () => {
  const gen = join(REPO_ROOT, "scripts", "_certificationRoutes.mjs");
  const out = execFileSync(process.execPath, [gen, "--print"], { cwd: REPO_ROOT, encoding: "utf8" });
  const lines = out.trim().split("\n").filter(Boolean);
  assert.ok(lines.length >= 30, `expected the full nav estate, got ${lines.length}`);
  for (const line of lines) assert.match(line, /^\/\S*\t/, `malformed route row: ${line}`);
});
