// HOSTING-ONLY SANDBOX RELEASE MODE -- what it deploys, and what it must never deploy.
//
// ════════════════════ WHY THIS EXISTS ════════════════════
//
// The 7b7b15cd release had Hosting changes and zero changed files under functions/, firestore.rules
// and firestore.indexes.json -- and the only governed path to ship it redeployed the ENTIRE Functions
// estate first, because the runbook had no mode. That is authority the release did not need, and this
// repository has already recorded what it costs: a large batch exits non-zero after some functions
// have updated, leaving the estate half-new.
//
// `--hosting-only` is that mode. The danger of adding it is not that it deploys too little -- it is
// that it silently deploys too much (a typo falling through to the full path), or that it buys its
// narrower scope by skipping a guard. Both are asserted against here.
//
// ════════════════════ HOW THESE TESTS WORK ════════════════════
//
// The REAL runbook runs, in a throwaway repo-shaped tree, with `node`, `npm`, `firebase`, `git` and
// `curl` replaced by STUBS on PATH that append their argv to a log and exit 0. NOTHING IS EVER
// DEPLOYED: no network call, no Firebase CLI, no real project. What the tests read is the command
// log -- the exact list of things the runbook tried to do.
//
// That is deliberately stronger than reading the script's source. A source-level assertion ("the file
// does not contain --only functions") would pass while the branch that reaches it was still live.
//
// Run: node --test scripts/sandboxHostingOnlyMode.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const RUNBOOK = join(REPO, "scripts", "_sandboxRefresh.run.sh");
const runbookSrc = readFileSync(RUNBOOK, "utf8");

const FAKE_SHA = "1111111111111111111111111111111111111111";

// Git Bash on Windows, /bin/bash elsewhere. If no bash is available the behavioural tests skip
// rather than fail -- a missing shell is an environment fact, not a defect in the runbook.
const BASH = (() => {
  for (const c of ["/bin/bash", "D:/Git/bin/bash.exe", "C:/Program Files/Git/bin/bash.exe"]) {
    if (existsSync(c)) return c;
  }
  try {
    return execFileSync("command", ["-v", "bash"], { encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
})();

/**
 * A repo-shaped temp tree with the REAL runbook and stub tooling on PATH.
 * Every stub logs `argv0 <args>` to CMDLOG so a test can assert on what was attempted.
 */
function stubTree() {
  const root = mkdtempSync(join(tmpdir(), "eos-hosting-only-"));
  const posix = (p) => p.replace(/\\/g, "/");
  mkdirSync(join(root, "scripts"), { recursive: true });
  mkdirSync(join(root, "functions"), { recursive: true });
  mkdirSync(join(root, "field-ops-app-vite"), { recursive: true });
  const bin = join(root, "stubbin");
  mkdirSync(bin, { recursive: true });

  copyFileSync(RUNBOOK, join(root, "scripts", "_sandboxRefresh.run.sh"));
  const log = join(root, "cmd.log");

  const stubNames = [];
  const stub = (name, body) => {
    const p = join(bin, name);
    writeFileSync(p, `#!/usr/bin/env bash\necho "${name} $*" >> "${posix(log)}"\n${body}\n`);
    chmodSync(p, 0o755);
    stubNames.push(name);
  };

  // `node` answers the two questions the runbook needs a real ANSWER to -- where is the release
  // root, and which Functions are deployable. The second is stubbed with a two-batch reply so the
  // tests can prove the runbook iterates the derived batches rather than falling back to an
  // unfiltered `--only functions`. Every other node invocation is a guard: logged, and allowed to
  // pass, so the tests can assert the guard RAN without depending on its internals here.
  stub(
    "node",
    `case "$*" in
       *releaseRoot.mjs*) echo "${posix(root)}" ;;
       *sandboxDeployableFunctions.mjs*) echo "functions:alpha,functions:beta"; echo "functions:gamma" ;;
     esac
     exit 0`,
  );
  stub("npm", "exit 0");
  stub("firebase", "exit 0");
  stub(
    "git",
    `case "$*" in
       "rev-parse HEAD"|"rev-parse origin/main") echo "${FAKE_SHA}" ;;
       *) exit 0 ;;
     esac
     exit 0`,
  );
  stub("curl", `echo '{"commit":"${FAKE_SHA}"}'`);

  // THE EXEC BIT HAS TO BE SET BY THE SHELL THAT WILL RUN THEM. Node's chmodSync on Windows toggles
  // the read-only attribute; it does not set the POSIX bit MSYS/Git Bash checks, so a stub written
  // this way is silently skipped during PATH lookup and the REAL node/git/firebase run instead --
  // which is how this harness first "passed a stub" while actually invoking the real toolchain.
  execFileSync(BASH, ["-c", `chmod 755 ${stubNames.map((n) => `'${posix(join(bin, n))}'`).join(" ")}`]);

  return { root, bin, log, posix };
}

// PATH ENTRIES MUST BE IN MSYS FORM, NOT WINDOWS FORM.
//
// `PATH` is colon-separated, and a Windows path carries a colon after the drive letter -- so
// `export PATH="C:/tmp/stubbin:$PATH"` is read by MSYS as the two entries `C` and `/tmp/stubbin`,
// neither of which exists. The stub directory is then silently absent from PATH and the REAL node,
// git and firebase run instead. That failure is invisible: the script proceeds and the test reports
// something about the real toolchain. Arguments elsewhere stay in `C:/` form, which node accepts.
const msysPath = (p) => p.replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`);

function runRunbook({ args = [] } = {}) {
  const { root, bin, log, posix } = stubTree();
  const argLine = args.map((a) => `'${a}'`).join(" ");
  let code = 0;
  let out = "";
  try {
    out = execFileSync(
      BASH,
      ["-c", `export PATH="${msysPath(bin)}:$PATH"; '${posix(join(root, "scripts", "_sandboxRefresh.run.sh"))}' --release-root '${posix(root)}' ${argLine}`],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (err) {
    code = err.status ?? -1;
    out = `${err.stdout ?? ""}${err.stderr ?? ""}`;
  }
  const commands = existsSync(log) ? readFileSync(log, "utf8") : "";
  return { code, out, commands };
}

const firebaseLines = (commands) =>
  commands.split("\n").filter((l) => l.startsWith("firebase "));

// ═════════════════════════════════════════ the contract, statically

test("the runbook still deploys Rules and indexes NOWHERE, in any mode", () => {
  // Not a mode question -- these are protected actions the runbook has never performed and must not
  // acquire. It only DIFFS them and tells the operator to get a separate authorization.
  assert.doesNotMatch(runbookSrc, /deploy\s+--only\s+["']?firestore:rules/);
  assert.doesNotMatch(runbookSrc, /deploy\s+--only\s+["']?firestore:indexes/);
  assert.match(runbookSrc, /SEPARATE protected action/);
});

test("every firebase invocation in the source names the sandbox project explicitly", () => {
  const invocations = runbookSrc.split("\n").filter((l) => /^\s*firebase\s+deploy/.test(l));
  assert.ok(invocations.length > 0, "expected at least one firebase deploy line");
  for (const line of invocations) {
    assert.match(line, /--project eos-platform-sandbox/, `not pinned: ${line}`);
  }
  assert.doesNotMatch(runbookSrc, /--project\s+taylor-parts/);
});

// ═════════════════════════════════════════ behaviour, against the real script

const behavioural = BASH ? test : test.skip;

behavioural("DEFAULT (no flag) still deploys Functions AND Hosting -- unchanged", () => {
  const { code, commands, out } = runRunbook();
  assert.equal(code, 0, `expected a clean run, got ${code}\n--- output ---\n${out}\n--- commands ---\n${commands}`);
  const fb = firebaseLines(commands);
  assert.ok(
    fb.some((l) => l.includes("--only functions")),
    "the default refresh must still deploy the Functions estate",
  );
  assert.ok(
    fb.some((l) => l.includes("--only hosting")),
    "the default refresh must still deploy Hosting",
  );
  assert.match(commands, /npm run build/, "the default refresh must still build the functions lib");
});

// ═════════════════════════════════════════ the secret-bound function must not block the refresh

behavioural("the default refresh NEVER issues an unfiltered `--only functions`", () => {
  // This is the 2026-09-03 blocker, asserted behaviourally. Unfiltered, that command pulls in
  // interpretWorkOrderReadinessContext and demands five KEYSTONE_* secrets platform-sandbox does
  // not have on purpose -- so the batch failed, Hosting was never reached, and the estate was left
  // half-new. Every Functions deploy must now carry a colon filter.
  const { code, commands } = runRunbook();
  assert.equal(code, 0);
  const functionCalls = firebaseLines(commands).filter((l) => /--only functions/.test(l));
  assert.ok(functionCalls.length > 0, "the default refresh must still deploy Functions");
  for (const line of functionCalls) {
    assert.match(line, /--only functions:/, `unfiltered Functions deploy: ${line}`);
  }
});

behavioural("the default refresh derives its Function set and deploys every derived batch", () => {
  const { commands } = runRunbook();
  assert.match(commands, /sandboxDeployableFunctions\.mjs/, "the deployable set must be derived");
  // Both stubbed batches ship. A loop that ran once would leave most of the estate stale -- the
  // fail-OPEN shape, which is worse than the blocker this replaced.
  const fb = firebaseLines(commands);
  assert.ok(fb.some((l) => l.includes("functions:alpha,functions:beta")), "first derived batch missing");
  assert.ok(fb.some((l) => l.includes("functions:gamma")), "second derived batch missing");
});

behavioural("a failure to derive the set STOPS the release before any remaining-estate deploy", () => {
  // Fail closed. If the manifest is unbuilt or a new secret-bound function appears, the derivation
  // exits non-zero; `set -e` must stop there rather than fall through to Hosting.
  const { root, bin, log, posix } = stubTree();
  writeFileSync(
    join(bin, "node"),
    `#!/usr/bin/env bash\necho "node $*" >> "${posix(log)}"\n` +
      `case "$*" in\n` +
      `  *releaseRoot.mjs*) echo "${posix(root)}" ;;\n` +
      `  *sandboxDeployableFunctions.mjs*) echo "ABORT: ungoverned secret binding" >&2; exit 3 ;;\n` +
      `esac\nexit 0\n`,
  );
  execFileSync(BASH, ["-c", `chmod 755 '${posix(join(bin, "node"))}'`]);

  let code = 0;
  try {
    execFileSync(
      BASH,
      ["-c", `export PATH="${msysPath(bin)}:$PATH"; '${posix(join(root, "scripts", "_sandboxRefresh.run.sh"))}' --release-root '${posix(root)}'`],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (err) {
    code = err.status ?? -1;
  }
  const commands = readFileSync(log, "utf8");
  assert.notEqual(code, 0, "the release must stop when the deployable set cannot be derived");
  assert.ok(
    !firebaseLines(commands).some((l) => l.includes("--only hosting")),
    "Hosting must not deploy after a failed Functions derivation",
  );
});

behavioural("--hosting-only deploys Hosting and NO Functions batch at all", () => {
  const { code, commands } = runRunbook({ args: ["--hosting-only"] });
  assert.equal(code, 0, `expected a clean run, got ${code}`);
  const fb = firebaseLines(commands);

  assert.ok(fb.some((l) => l.includes("--only hosting")), "Hosting must still deploy");

  // The whole point. Not "fewer batches" -- none.
  for (const line of fb) {
    assert.ok(!line.includes("--only functions"), `a Functions deploy ran in hosting-only mode: ${line}`);
    assert.ok(!line.includes("functions:"), `a named Functions batch ran in hosting-only mode: ${line}`);
  }
});

behavioural("--hosting-only never deploys Rules or indexes", () => {
  const { commands } = runRunbook({ args: ["--hosting-only"] });
  for (const line of firebaseLines(commands)) {
    assert.ok(!line.includes("firestore:rules"), `Rules deployed: ${line}`);
    assert.ok(!line.includes("firestore:indexes"), `indexes deployed: ${line}`);
  }
});

behavioural("--hosting-only keeps the sandbox project pinned on every firebase call", () => {
  const { commands } = runRunbook({ args: ["--hosting-only"] });
  const fb = firebaseLines(commands);
  assert.ok(fb.length > 0, "expected at least one firebase invocation");
  for (const line of fb) {
    assert.match(line, /--project eos-platform-sandbox/, `unpinned: ${line}`);
    assert.ok(!line.includes("taylor-parts"), `production named: ${line}`);
  }
});

behavioural("--hosting-only still runs EVERY release guard -- the scope narrows, the protection does not", () => {
  const { commands } = runRunbook({ args: ["--hosting-only"] });
  // Each of these exists because of a specific past failure; none of them is about Functions.
  for (const guard of [
    "releaseRoot.mjs", // agent-worktree / release-root refusal
    "_sandboxDeployGuard.mjs", // role != production, projectId == eos-platform-sandbox
    "_releaseProvenanceGuard.mjs", // HEAD is origin/main's tip, tree clean
    "verifyDeployArtifact.mjs", // the ARTIFACT is sandbox-stamped, not just the target
    "_releaseIdentityGate.mjs", // approved == HEAD == origin/main == artifact, and the live read
    "buildForEnvironment.mjs", // the environment is an argument, re-verified from version.json
  ]) {
    assert.match(commands, new RegExp(guard.replace(".", "\\.")), `guard did not run: ${guard}`);
  }
  // The build-base contract is the 2026-08-19 incident's own check. It must not be traded away.
  assert.match(commands, /verify:build-base/);
});

behavioural("--hosting-only still builds the Hosting artifact for platform-sandbox", () => {
  const { commands } = runRunbook({ args: ["--hosting-only"] });
  assert.match(commands, /buildForEnvironment\.mjs platform-sandbox/);
});

behavioural("--hosting-only skips the functions lib build, and only that build", () => {
  const { commands } = runRunbook({ args: ["--hosting-only"] });
  // No file under field-ops-app-vite/src imports from functions/, so functions/lib is deploy input
  // for the Functions estate alone -- skipping it cannot change the Hosting artifact.
  assert.ok(!/npm run build$/m.test(commands), "the functions lib build should not run");
  assert.match(commands, /verify:build-base/, "the app's own build verification must still run");
});

behavioural("an UNKNOWN flag is refused, and nothing is built or deployed", () => {
  // The dangerous version of this feature is a typo silently falling through to the full deploy.
  const { code, commands, out } = runRunbook({ args: ["--hostingonly"] });
  assert.equal(code, 2, "an unrecognised flag must refuse with exit 2");
  assert.match(out, /unrecognised release flag/i);
  assert.equal(firebaseLines(commands).length, 0, "nothing may be deployed after a refusal");
});

behavioural("a refusal happens BEFORE any guard, build or deploy runs", () => {
  const { commands } = runRunbook({ args: ["--deploy-everything"] });
  assert.equal(commands.trim(), "", "no command may run at all after an unrecognised flag");
});

// ═════════════════════════════════════════ the human/operator boundary is untouched

test("releaseRoot.mjs still refuses an agent worktree", () => {
  // Asserted against the REAL module, not a stub: hosting-only must not become a way around the
  // rule that a release is built from the operator checkout.
  const agentRoot = join(REPO, ".claude", "worktrees", "some-agent-worktree");
  let refused = false;
  try {
    execFileSync(process.execPath, [join(REPO, "scripts", "releaseRoot.mjs"), "--release-root", agentRoot], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    refused = true;
  }
  assert.ok(refused, "an agent worktree must still be refused as a release root");
});

// ═════════════════════════════════════════ the operator entry point

// The operator does not type the runbook's flag -- they type the wrapper's. If the wrapper accepted
// a typo silently, the fail-closed parsing in the runbook would never be reached.
const powershellAvailable = (() => {
  try {
    execFileSync("powershell.exe", ["-NoProfile", "-Command", "exit 0"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();
const psTest = powershellAvailable ? test : test.skip;

/** The real wrapper + launcher over a STUB runbook that only records the arguments it received. */
function wrapperTree() {
  const root = mkdtempSync(join(tmpdir(), "eos-hosting-only-ps-"));
  const posix = (p) => p.replace(/\\/g, "/");
  mkdirSync(join(root, "scripts"), { recursive: true });
  copyFileSync(join(REPO, "sandbox-refresh.ps1"), join(root, "sandbox-refresh.ps1"));
  copyFileSync(join(REPO, "scripts", "Invoke-SandboxRefresh.ps1"), join(root, "scripts", "Invoke-SandboxRefresh.ps1"));
  const argLog = join(root, "runbook-args.log");
  writeFileSync(
    join(root, "scripts", "_sandboxRefresh.run.sh"),
    `#!/usr/bin/env bash\necho "$*" >> "${posix(argLog)}"\nexit 0\n`,
  );
  return { root, argLog };
}

function runWrapper(root, args = []) {
  try {
    execFileSync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(root, "sandbox-refresh.ps1"), ...args],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return { code: 0 };
  } catch (err) {
    return { code: err.status ?? -1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

psTest("the wrapper forwards -HostingOnly to the runbook", () => {
  const { root, argLog } = wrapperTree();
  runWrapper(root, ["-HostingOnly"]);
  assert.match(readFileSync(argLog, "utf8"), /--hosting-only/);
});

psTest("the wrapper sends NO mode flag by default -- existing behaviour is untouched", () => {
  const { root, argLog } = wrapperTree();
  runWrapper(root, []);
  assert.doesNotMatch(readFileSync(argLog, "utf8"), /--hosting-only/);
});

psTest("an unknown wrapper switch is REFUSED, and the runbook is never reached", () => {
  // NOT `-HostingOnl`. PowerShell binds an unambiguous PREFIX of a parameter name, so that spelling
  // resolves to -HostingOnly and is the SAFE outcome -- it cannot fall through to the full deploy.
  // What must be refused is a switch that is not a prefix of anything, including the runbook's own
  // bash-style flag typed at the wrapper by mistake.
  for (const bad of ["-HostingOnlyy", "-Foo", "--hosting-only"]) {
    const { root, argLog } = wrapperTree();
    const { code } = runWrapper(root, [bad]);
    assert.notEqual(code, 0, `${bad} must not succeed`);
    assert.ok(!existsSync(argLog), `the runbook must not run at all after ${bad}`);
  }
});

psTest("a PREFIX of the switch binds to it, and is therefore still hosting-only", () => {
  const { root, argLog } = wrapperTree();
  runWrapper(root, ["-HostingOnl"]);
  assert.match(readFileSync(argLog, "utf8"), /--hosting-only/);
});

test("the runbook still declares itself a human-triggered action", () => {
  // The sentence wraps across two comment lines in the source, so the assertion checks both halves
  // rather than a contiguous phrase a reflow would break.
  assert.match(runbookSrc, /NOT run by/i);
  assert.match(runbookSrc, /any agent session/i);
  assert.match(runbookSrc, /human-triggered action/i);
});
