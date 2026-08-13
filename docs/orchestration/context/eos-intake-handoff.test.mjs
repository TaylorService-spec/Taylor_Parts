// Regression for the restored single handoff: Issue intake validates/adapts/authorizes and commits an
// EXECUTION_AUTHORIZED *.work.json WITHOUT suppressing Actions, so the persistent execution workflow
// (eos-intake-execute.yml) is the ONE place a worker is woken. Guards against the #840-adjacent
// suppressed-trigger + duplicate-execution regression.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { buildIssueIntake, authorizeIssueIntake } from "./issue-intake-producer.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const workflow = (name) => readFileSync(resolve(ROOT, ".github/workflows", name), "utf8");
const issueIntakeWf = workflow("eos-issue-intake.yml");
const executeWf = workflow("eos-intake-execute.yml");

const event = {
  action: "labeled",
  label: { name: "eos-intake" },
  sender: { login: "owner" },
  repository: { owner: { login: "owner" } },
  issue: {
    number: 900, state: "open", title: "EOS handoff test",
    body: "## Purpose\nRepair X.\n\n## Scope\n- docs/orchestration/**\n\n## Required work\n- Implement the fix and add a function.\n\n## Completion\nDraft PR.",
    author_association: "OWNER",
    html_url: "https://github.com/TaylorService-spec/Taylor_Parts/issues/900",
    created_at: "2026-08-13T00:00:00Z", updated_at: "2026-08-13T00:00:00Z", user: { login: "owner" }, labels: [],
  },
};

test("issue intake produces an EXECUTION_AUTHORIZED .work.json", () => {
  const authorized = authorizeIssueIntake(buildIssueIntake(event), event);
  assert.equal(authorized.status, "EXECUTION_AUTHORIZED");
  assert.equal(authorized.authority.authorizationState, "AUTHORIZED");
  assert.equal(authorized.artifactLocation, "docs/orchestration/work-intake/EOS-ISSUE-900.work.json");
});

test("the intake write-back push is NOT CI-skipped (no [skip ci] anywhere in the workflow)", () => {
  assert.ok(!/\[skip ci\]|\[ci skip\]|skip-checks/i.test(issueIntakeWf), "intake workflow must not suppress Actions");
  const commitLine = issueIntakeWf.split("\n").find((l) => l.includes("git commit -m") && l.includes("Issue #"));
  assert.ok(commitLine, "the intake write-back commit exists");
  assert.ok(!/skip ci/i.test(commitLine), "the work.json commit must not skip CI");
});

test("the persistent execution workflow is eligible to trigger on the pushed work artifact", () => {
  assert.match(executeWf, /on:/);
  assert.match(executeWf, /push:/);
  assert.match(executeWf, /branches:\s*\[main\]/);
  assert.match(executeWf, /docs\/orchestration\/work-intake\/\*\*\/\*\.work\.json/);
  // and its gates are preserved (EOS_RUNTIME_ENABLED + self-hosted Windows eos-runtime)
  assert.match(executeWf, /EOS_RUNTIME_ENABLED == 'true'/);
  assert.match(executeWf, /self-hosted[\s\S]*eos-runtime/);
});

test("issue intake itself does NOT invoke Claude (execution is handed off, no duplicate path)", () => {
  assert.ok(!/intake-runtime\.mjs\s+execute/.test(issueIntakeWf), "intake must not run the execution runtime");
  assert.ok(!/intake-artifactize/.test(issueIntakeWf), "intake must not artifactize a worker run");
  assert.ok(!/worktree add/.test(issueIntakeWf), "intake must not create a Claude worktree");
  // but it MUST still authorize (write the EXECUTION_AUTHORIZED artifact) before committing
  assert.match(issueIntakeWf, /--authorize/);
});

test("execute workflow wakes via workflow_run on intake completion (GITHUB_TOKEN pushes don't trigger on:push)", () => {
  // github-actions[bot] pushes the work.json with GITHUB_TOKEN, which GitHub excludes from on:push triggers.
  // workflow_run is exempt from that rule, so it is the reliable wake trigger.
  const intakeName = /^name:\s*(.+)$/m.exec(issueIntakeWf)[1].trim();
  assert.match(executeWf, /workflow_run:/);
  assert.ok(executeWf.includes(intakeName), `execute must workflow_run on the intake workflow "${intakeName}"`);
  assert.match(executeWf, /workflow_run\.conclusion == 'success'/, "workflow_run wake must require upstream success");
  // gates preserved
  assert.match(executeWf, /EOS_RUNTIME_ENABLED == 'true'/);
  assert.match(executeWf, /self-hosted[\s\S]*eos-runtime/);
});
