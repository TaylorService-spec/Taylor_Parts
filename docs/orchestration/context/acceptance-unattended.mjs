#!/usr/bin/env node
// Unattended EOS acceptance -- the POSITIVE path, proven by execution.
//
// eos-operational-authorization.md §10: "Owner authorization, EOS configuration, and the
// execution harness are three separate layers. A capability is not usable because configuration
// says it is allowed." So this does not read settings.json and conclude anything. It performs
// each operation and records what actually happened.
//
//   node docs/orchestration/context/acceptance-unattended.mjs --run
//   node docs/orchestration/context/acceptance-unattended.mjs --run --keep   (skip cleanup)
//
// WHAT IT PROVES: branch -> edit -> add -> commit -> push -> PR, end to end.
//
// WHAT IT DELIBERATELY DOES NOT DO (§10.1): it never attempts a push to main, a force push, a
// reset --hard, a deploy, or a secret read. `main` is currently unprotected, so an attempt to
// prove "cannot push to main" could SUCCEED -- which would not be a failed test, it would be the
// incident the control exists to prevent. Those assertions are reported UNPROVEN, never passing.
//
// Cleans up after itself: closes the PR and deletes the remote branch unless --keep.
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const KEEP = process.argv.includes("--keep");
const RUN = process.argv.includes("--run");
const STAMP = process.env.EOS_ACCEPTANCE_STAMP || String(process.hrtime.bigint()).slice(-10);
const BRANCH = `eos/acceptance-${STAMP}`;
const PROBE = `docs/orchestration/work-intake/acceptance/${STAMP}.probe.md`;

const steps = [];
function step(name, fn, { fatal = true, cleanup = false } = {}) {
  try {
    const out = fn();
    steps.push({ step: name, ok: true, cleanup, evidence: String(out ?? "").trim().slice(0, 400) });
    return out;
  } catch (err) {
    const detail = [err?.stdout?.toString?.(), err?.stderr?.toString?.(), err?.message]
      .filter(Boolean).join("\n").trim().slice(0, 600);
    steps.push({ step: name, ok: false, cleanup, evidence: detail });
    if (fatal) throw err;
    return null;
  }
}

const git = (...args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const gh = (...args) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

function run() {
  const baseBranch = step("read current branch", () => git("rev-parse", "--abbrev-ref", "HEAD"));

  step("create non-main branch", () => git("checkout", "-b", BRANCH));

  step("edit an authorized file", () => {
    mkdirSync(dirname(PROBE), { recursive: true });
    writeFileSync(
      PROBE,
      `# Unattended acceptance probe ${STAMP}\n\n` +
        `Written by \`acceptance-unattended.mjs\` to prove the unattended write path by execution.\n` +
        `Safe to delete. Branch: \`${BRANCH}\`.\n`,
    );
    return PROBE;
  });

  step("git add", () => git("add", PROBE));
  step("git commit", () => git("commit", "-m", `test(eos): unattended acceptance probe ${STAMP}`));
  step("push non-main branch", () => git("push", "-u", "origin", `HEAD:${BRANCH}`));

  const prUrl = step("create PR", () =>
    gh("pr", "create", "--base", "main", "--head", BRANCH,
       "--title", `test(eos): unattended acceptance probe ${STAMP}`,
       "--body", "Automated acceptance probe proving the unattended path by execution. Closed automatically."),
  );

  if (!KEEP) {
    // --delete-branch also prunes the LOCAL branch, which needs a checkout of main -- and main is
    // often held by another worktree. Close the PR and delete the REMOTE ref explicitly instead.
    step("close PR", () => gh("pr", "close", BRANCH), { fatal: false, cleanup: true });
    step("delete remote branch", () => git("push", "origin", "--delete", BRANCH), { fatal: false, cleanup: true });
    step("return to base branch", () => git("checkout", baseBranch.trim()), { fatal: false, cleanup: true });
  }
  return prUrl;
}

const UNPROVEN = [
  { assertion: "cannot push directly to main", reason: "main is unprotected (§2.1); attempting this could succeed and cause the incident it tests for" },
  { assertion: "cannot force push", reason: "gated with the above — not attempted against an unprotected main" },
  { assertion: "cannot reset --hard", reason: "destructive; not attempted against a live tree" },
  { assertion: "cannot deploy", reason: "protected boundary; not attempted" },
  { assertion: "cannot read secrets", reason: "must never be attempted, proven or not" },
  { assertion: "cannot modify .github/workflows as an ordinary worker", reason: "requires a runner identity to test meaningfully" },
];

if (!RUN) {
  process.stdout.write("acceptance-unattended: pass --run to execute. Nothing done.\n");
  process.exit(0);
}

let failed = false;
try { run(); } catch { failed = true; }

const report = {
  schema: "eos.acceptance.unattended/1",
  stamp: STAMP,
  branch: BRANCH,
  positivePath: steps,
  // Cleanup is hygiene, NOT an acceptance criterion. A tidy-up that fails for an environmental
  // reason (another worktree holding a branch) must not report the acceptance itself as failed.
  passed: steps.filter((s) => !s.cleanup).every((s) => s.ok),
  cleanupClean: steps.filter((s) => s.cleanup).every((s) => s.ok),
  unprovenNegatives: UNPROVEN,
  note: "Positive path proven by execution. Negative assertions are UNPROVEN, not passing (§10.1).",
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exit(failed || !report.passed ? 1 : 0);
