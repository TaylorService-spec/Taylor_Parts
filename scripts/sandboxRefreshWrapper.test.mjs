// THE OPERATOR WRAPPER MUST LAUNCH THE GOVERNED SCRIPT, AND NOTHING ELSE.
//
// Every behavioural test here runs the REAL wrapper against a STUBBED runbook in a temporary tree.
// No deployment is ever executed: the stub is a bash script that prints and exits with a chosen
// code, which is exactly the surface the wrapper is responsible for.
//
// Run: node --test scripts/sandboxRefreshWrapper.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const WRAPPER = join(REPO, "sandbox-refresh.ps1");
const LAUNCHER = join(REPO, "scripts", "Invoke-SandboxRefresh.ps1");
const wrapperSrc = readFileSync(WRAPPER, "utf8");

/** A throwaway repo-shaped tree with a STUB runbook. Never the real one. */
function stubTree({ exitCode = 0, dirName = "eos-wrapper-", withRunbook = true, withLauncher = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), dirName));
  mkdirSync(join(root, "scripts"), { recursive: true });
  copyFileSync(WRAPPER, join(root, "sandbox-refresh.ps1"));
  if (withLauncher) copyFileSync(LAUNCHER, join(root, "scripts", "Invoke-SandboxRefresh.ps1"));
  if (withRunbook) {
    writeFileSync(
      join(root, "scripts", "_sandboxRefresh.run.sh"),
      `#!/usr/bin/env bash\necho "STUB RUNBOOK RAN"\necho "stub stderr line" >&2\nexit ${exitCode}\n`,
    );
  }
  return root;
}

function runWrapper(root) {
  try {
    const stdout = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(root, "sandbox-refresh.ps1")],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return { code: 0, out: stdout };
  } catch (err) {
    return { code: err.status ?? -1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

const powershellAvailable = (() => {
  try { execFileSync("powershell.exe", ["-NoProfile", "-Command", "exit 0"], { stdio: "ignore" }); return true; }
  catch { return false; }
})();

// ═════════════════════════════════════════ the contract, statically

test("THE WRAPPER CONTAINS NO DEPLOYMENT OF ITS OWN", () => {
  // The single most important property. A second implementation of the deploy ordering would be
  // free to drift from the governed one, and the 2026-08-19 incident came from that ordering.
  assert.doesNotMatch(wrapperSrc, /firebase\s+deploy/i, "the wrapper must never invoke firebase");
  assert.doesNotMatch(wrapperSrc, /firebase-tools/i);
  assert.doesNotMatch(wrapperSrc, /--only\s+(functions|hosting|firestore)/i);
  assert.doesNotMatch(wrapperSrc, /gcloud/i);
});

test("it bypasses no guard", () => {
  // It must not reach past the governed script to any control the governed script runs.
  for (const guard of ["_sandboxDeployGuard", "_releaseProvenanceGuard"]) {
    assert.doesNotMatch(wrapperSrc, new RegExp(`${guard}[^\\n]*--?(skip|force|no)`, "i"));
  }
  assert.doesNotMatch(wrapperSrc, /--force/i, "the wrapper passes no force flag of its own");
});

test("the repository is resolved from the FILE, never the caller's directory", () => {
  // "It resolved against the wrong root and cd succeeded anyway" is one of the failures this exists
  // to remove, so the resolution may not read the caller's cwd.
  assert.match(wrapperSrc, /\$repoRoot\s*=\s*\$PSScriptRoot/);
  assert.doesNotMatch(wrapperSrc, /Get-Location|\$PWD/, "the caller's cwd must not decide the target");
});

test("IT IS PURE ASCII", () => {
  // Windows PowerShell 5.1 reads a .ps1 as CP1252 without a BOM, so one em dash in a COMMENT breaks
  // string parsing further down the file. That is how the first launcher failed.
  const nonAscii = [...wrapperSrc].map((c, i) => [c, i]).filter(([c]) => c.codePointAt(0) > 127);
  assert.equal(nonAscii.length, 0, `non-ASCII at ${JSON.stringify(nonAscii.slice(0, 5))}`);
});

test("it prints the three required banners", () => {
  assert.match(wrapperSrc, /EOS SANDBOX REFRESH/);
  assert.match(wrapperSrc, /SANDBOX REFRESH COMPLETE/);
  assert.match(wrapperSrc, /SANDBOX REFRESH FAILED/);
  assert.match(wrapperSrc, /Exit code: \$code/);
});

test("success is printed only on exit 0", () => {
  // "Never print success after a nonzero exit." The COMPLETE banner must sit after the failure
  // branch has already exited.
  const failIdx = wrapperSrc.indexOf("SANDBOX REFRESH FAILED\"");
  const okIdx = wrapperSrc.lastIndexOf("SANDBOX REFRESH COMPLETE");
  assert.ok(failIdx < okIdx, "the failure branch must precede the success banner");
  assert.match(wrapperSrc, /if \(\$code -ne 0\)[\s\S]{0,600}?exit \$code/, "a nonzero code must exit before success");
});

// ═════════════════════════════════════════ behaviour, against a STUB

test("EXIT 0 PROPAGATES AS SUCCESS, and the child's output is visible", { skip: !powershellAvailable }, () => {
  const root = stubTree({ exitCode: 0 });
  try {
    const { code, out } = runWrapper(root);
    assert.equal(code, 0, out.slice(-400));
    assert.match(out, /EOS SANDBOX REFRESH/);
    assert.match(out, /SANDBOX REFRESH COMPLETE/);
    // Not swallowed: the governed script's own stdout reaches the operator, because the deployed
    // version.json it prints is the only real evidence.
    assert.match(out, /STUB RUNBOOK RAN/, "the child's stdout must not be captured away");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("A NONZERO CHILD EXIT FAILS THE COMMAND, with the real code", { skip: !powershellAvailable }, () => {
  const root = stubTree({ exitCode: 37 });
  try {
    const { code, out } = runWrapper(root);
    assert.equal(code, 37, `expected the child's own code to survive; got ${code}`);
    assert.match(out, /SANDBOX REFRESH FAILED/);
    assert.match(out, /Exit code: 37/);
    assert.doesNotMatch(out, /SANDBOX REFRESH COMPLETE/, "success must never print after a failure");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("A REPOSITORY PATH WITH SPACES WORKS", { skip: !powershellAvailable }, () => {
  // The classic Windows quoting failure, and the reason an operator ends up hand-editing a command.
  const root = stubTree({ exitCode: 0, dirName: "eos wrapper with spaces " });
  try {
    const { code, out } = runWrapper(root);
    assert.equal(code, 0, out.slice(-400));
    assert.match(out, /STUB RUNBOOK RAN/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a MISSING RUNBOOK is named, not surfaced as a bash error", { skip: !powershellAvailable }, () => {
  const root = stubTree({ withRunbook: false });
  try {
    const { code, out } = runWrapper(root);
    assert.notEqual(code, 0);
    assert.match(out, /SANDBOX REFRESH FAILED/);
    assert.match(out, /runbook is missing/i);
    assert.match(out, /_sandboxRefresh\.run\.sh/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a MISSING LAUNCHER is named", { skip: !powershellAvailable }, () => {
  const root = stubTree({ withLauncher: false });
  try {
    const { code, out } = runWrapper(root);
    assert.notEqual(code, 0);
    assert.match(out, /launcher is missing/i);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("THE WRAPPER RUNS FROM ANOTHER DIRECTORY and still targets its own repo", { skip: !powershellAvailable }, () => {
  const root = stubTree({ exitCode: 0 });
  try {
    const out = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command",
       `Set-Location $env:TEMP; & '${join(root, "sandbox-refresh.ps1").replace(/'/g, "''")}'`],
      { encoding: "utf8" },
    );
    assert.match(out, /STUB RUNBOOK RAN/, "cwd must not decide which repository is refreshed");
    assert.match(out, new RegExp(`Repository: ${root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ═════════════════════════════════════════ the launcher still owns bash resolution

test("bash resolution stays in the launcher, with real fallbacks", () => {
  // The wrapper must not duplicate this -- two copies drift, and this one already handles the
  // Git-on-PATH fallback.
  const launcher = readFileSync(LAUNCHER, "utf8");
  assert.match(launcher, /Program Files\\Git\\bin\\bash\.exe/);
  assert.match(launcher, /Get-Command git/, "a machine without Git at a known path must still resolve");
  assert.doesNotMatch(wrapperSrc, /bash\.exe/, "the wrapper must not locate bash itself");
});
