import test from "node:test";
import assert from "node:assert/strict";
import { artifactizeWorkspace, parsePorcelainZ, recoverReport } from "./intake-artifactize.mjs";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeRealClaudeRunner } from "./reciprocal-pilot.mjs";
import { readFileSync as readText } from "node:fs";

test("porcelain parser returns normalized dirty paths", () => {
  assert.deepEqual(parsePorcelainZ(Buffer.from(" M docs\\a.mjs\0?? docs/b.mjs\0")), ["docs/a.mjs", "docs/b.mjs"]);
  assert.deepEqual(parsePorcelainZ(Buffer.from("R  docs/new.mjs\0docs/old.mjs\0")), ["docs/new.mjs"]);
});

test("real Claude runner honors the isolated execution directory", () => {
  const dir = mkdtempSync(join(tmpdir(), "eos-cwd-"));
  const prior = process.env.EOS_EXECUTION_CWD;
  process.env.EOS_EXECUTION_CWD = dir;
  try {
    const out = makeRealClaudeRunner(process.execPath).run({ argv: ["-e", "process.stdout.write(process.cwd())"], wallClockSec: 5 });
    assert.equal(out.exitCode, 0);
    assert.equal(out.stdout.toLowerCase(), dir.toLowerCase());
  } finally {
    if (prior == null) delete process.env.EOS_EXECUTION_CWD; else process.env.EOS_EXECUTION_CWD = prior;
  }
});

test("same-target integrations are serialized and never force-push", () => {
  const workflow = readText(new URL("../../../.github/workflows/eos-patch-integrate.yml", import.meta.url), "utf8");
  assert.match(workflow, /group: eos-patch-integration-\$\{\{ github\.repository \}\}-main/);
  assert.doesNotMatch(workflow, /git push[^\r\n]*--force(?:-with-lease)?/);
  assert.match(workflow, /inputs\.approval == 'APPROVE'/);
  assert.doesNotMatch(workflow, /--(?:request-id|manifest|patch-sha|approval)[^\r\n]*\$\{\{ inputs\./, "dispatch inputs must enter PowerShell through env, not script interpolation");
});

test("recovered report is governed under the request results directory", () => {
  const dir = mkdtempSync(join(tmpdir(), "eos-report-"));
  const out = recoverReport({ reportBytes: Buffer.from("report\n"), outputRepo: dir, workArtifact: { requestId: "EOS-ISSUE-818", sha256: "a".repeat(64) }, createdAt: "2026-08-12T22:00:00Z", recovery: "preserved transcript" });
  assert.match(out.reportLocation, /^docs\/orchestration\/work-intake\/results\/EOS-ISSUE-818\/[0-9a-f]{64}\.report\.md$/);
  assert.equal(readFileSync(join(dir, out.reportLocation), "utf8"), "report\n");
});

test("report and source edits are artifactized outside the isolated checkout", () => {
  const workspace = mkdtempSync(join(tmpdir(), "eos-isolated-"));
  const outputRepo = mkdtempSync(join(tmpdir(), "eos-output-"));
  const run = (...args) => {
    const out = spawnSync("git", args, { cwd: workspace, encoding: "utf8", windowsHide: true });
    assert.equal(out.status, 0, out.stderr); return out.stdout.trim();
  };
  run("init"); run("config", "user.email", "eos@test.invalid"); run("config", "user.name", "EOS test");
  mkdirSync(join(workspace, "docs", "orchestration", "work-intake"), { recursive: true });
  mkdirSync(join(workspace, "src"), { recursive: true });
  writeFileSync(join(workspace, "src", "a.mjs"), "export const a = 1;\n");
  run("add", "."); run("commit", "-m", "base");
  const baseCommit = run("rev-parse", "HEAD");
  writeFileSync(join(workspace, "src", "a.mjs"), "export const a = 2;\n");
  writeFileSync(join(workspace, "docs", "orchestration", "work-intake", "EOS-TEST.report.md"), "report\n");
  const result = artifactizeWorkspace({ workspace, outputRepo, baseCommit, createdAt: "2026-08-12T22:00:00Z", workArtifact: { requestId: "EOS-TEST", sha256: "a".repeat(64), scope: ["src/a.mjs"] } });
  assert.equal(result.reportCaptured, true);
  assert.equal(result.manifest.scopeValidation, "PASS");
  assert.deepEqual(result.manifest.paths, ["src/a.mjs"]);
  assert.match(readFileSync(join(outputRepo, result.manifest.patchLocation), "utf8"), /\+export const a = 2;/);
  assert.equal(run("status", "--porcelain").includes("results/EOS-TEST"), false, "governed outputs must not enter Claude's checkout");
});
