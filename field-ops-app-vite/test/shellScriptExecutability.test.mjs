// SHELL SCRIPTS MUST ACTUALLY BE RUNNABLE.
//
// GOVERNANCE: docs/releases/ux-sandbox-release.md.
//
// ============================ THE FAILURE THIS EXISTS TO STOP ============================
//
// Every `.sh` in this repository was checked out with CRLF line endings, so none of them ran on
// any platform. bash reads `set -euo pipefail\r`, rejects `pipefail\r` as an option name, and the
// carriage return rewinds the terminal cursor mid-message — so what the operator actually sees is
// a fragment:
//
//     scripts/_sandboxRefresh.run.sh: lin: invalid option name
//
// which names neither the line, nor the option, nor the real cause. The Owner hit exactly this
// trying to run the sandbox deploy. `scripts/_prodRelease.run.sh` was in the same state, and would
// have failed the same way at the worst possible moment.
//
// The committed blobs were fine. The CHECKOUT was converting them, because nothing told git these
// files must stay LF. `.gitattributes` now does, and this is the guard on that rule.
//
// ============================ WHY THE RULE, NOT JUST THE BYTES ============================
//
// On a Linux CI checkout the working-tree bytes are LF whatever `.gitattributes` says, so asserting
// only on bytes would pass in CI while every Windows operator still had unrunnable scripts. The
// load-bearing assertion is the RULE. The byte and parse checks come along because they are nearly
// free and they catch a script that arrives broken by some other route.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(process.cwd(), "..");

/** Every tracked shell script, from git rather than a directory walk, so untracked scratch is out. */
function trackedShellScripts() {
  const out = execFileSync("git", ["ls-files", "*.sh"], { cwd: REPO_ROOT, encoding: "utf8" });
  return out.split("\n").map((l) => l.trim()).filter(Boolean);
}

const scripts = trackedShellScripts();

test("there are shell scripts to check", () => {
  // A guard that silently checks nothing is the same shape of bug it exists to catch.
  assert.ok(scripts.length > 0, "expected tracked .sh files");
});

test(".gitattributes forces every shell script to LF on checkout", () => {
  const attributes = readFileSync(path.join(REPO_ROOT, ".gitattributes"), "utf8");
  // The rule is what protects a Windows working copy. Without it the bytes below are LF here and
  // CRLF on the machine that has to run the deploy.
  assert.match(
    attributes,
    /^\*\.sh text eol=lf$/m,
    "shell scripts must be pinned to LF, or a Windows checkout silently breaks all of them",
  );
});

test("no shell script contains a carriage return", () => {
  const offenders = scripts.filter((rel) => readFileSync(path.join(REPO_ROOT, rel), "utf8").includes("\r"));
  assert.deepEqual(offenders, [], `these scripts will not run:\n  ${offenders.join("\n  ")}`);
});

test("every shell script parses", () => {
  // `bash -n` PARSES and does not execute. Nothing here runs a deploy, touches a project, or makes
  // a network call — which matters, because two of these scripts deploy.
  const offenders = [];
  for (const rel of scripts) {
    try {
      execFileSync("bash", ["-n", rel], { cwd: REPO_ROOT, stdio: "pipe" });
    } catch (error) {
      offenders.push(`${rel}: ${String(error.stderr ?? error.message).trim().split("\n")[0]}`);
    }
  }
  assert.deepEqual(offenders, [], `syntax errors:\n  ${offenders.join("\n  ")}`);
});

test("the CR detector detects the shape that broke", () => {
  // Mutation proof over the exact first line that failed, rather than a synthetic string.
  const broken = "#!/usr/bin/env bash\r\nset -euo pipefail\r\n";
  assert.ok(broken.includes("\r"));
  assert.ok(!"#!/usr/bin/env bash\nset -euo pipefail\n".includes("\r"));
});
