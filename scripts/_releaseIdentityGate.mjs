// THE RELEASE IDENTITY INVARIANT, CHECKED WHERE IT CAN STILL STOP SOMETHING.
//
//   the commit the guard approved
//     = the commit HEAD is at when the artifact is built
//     = the commit origin/main is at
//     = the commit written into the artifact's version.json
//     = the commit serving from the deployed origin
//
// No content-equivalence exception. No "same tree" exception. Any inequality FAILS CLOSED.
//
// ============================ WHY THE EXISTING CHECKS WERE NOT ENOUGH ============================
//
// _releaseProvenanceGuard.mjs runs at step 0 and is correct: pointed at the commit that reached
// sandbox in the incident it refuses with UNMERGED_COMMIT, exit 3. But between it and the Hosting
// deploy the runbook builds Functions, deploys Functions, and builds the frontend. Nothing looked
// again. A HEAD that moved in that window -- a branch switch, a rebase, a stray commit, an agent
// working in the same checkout -- would have been shipped with the guard's approval still standing.
//
// And the final step verified nothing. It printed the deployed version.json next to an expected
// commit and told the reader to "compare", explicitly noting that "a clean exit does not mean the
// artifact is live". A post-deploy check that cannot fail is documentation, not a gate.
//
// Usage:
//   node scripts/_releaseIdentityGate.mjs --root <path> --approved <sha> [--artifact <version.json>]
//   node scripts/_releaseIdentityGate.mjs --root <path> --approved <sha> --remote <origin>
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const argv = process.argv.slice(2);
const arg = (name) => {
  const at = argv.indexOf(name);
  return at >= 0 && at + 1 < argv.length ? argv[at + 1] : null;
};

const root = resolve(arg("--root") ?? ".");
const approved = (arg("--approved") ?? "").trim();
const artifactArg = arg("--artifact");
const remote = arg("--remote");

if (!approved) {
  console.error("ABORT: --approved <sha> is required. The gate cannot verify an identity it was not given.");
  process.exit(5);
}

const failures = [];
const detail = [];

/** Compare on the SHORTER of the two, so a short version.json sha and a full git sha still match. */
function sameCommit(a, b) {
  if (!a || !b) return false;
  const n = Math.min(a.length, b.length, 40);
  return a.slice(0, n).toLowerCase() === b.slice(0, n).toLowerCase();
}

function git(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

// ── 1. The tree that is about to ship is still at the approved commit.
let head = null;
try { head = git(["rev-parse", "HEAD"]); } catch { /* reported below */ }
if (!sameCommit(head, approved)) {
  failures.push("HEAD_MOVED");
  detail.push(`HEAD is ${head ?? "unreadable"}, approved was ${approved}`);
} else {
  detail.push(`HEAD ${head.slice(0, 8)} matches the approved commit`);
}

// ── 2. And it is still what origin/main points at.
let originMain = null;
try { originMain = git(["rev-parse", "origin/main"]); } catch { /* reported below */ }
if (!sameCommit(originMain, approved)) {
  failures.push("ORIGIN_MAIN_MOVED");
  detail.push(`origin/main is ${originMain ?? "unreadable"}, approved was ${approved}`);
} else {
  detail.push(`origin/main ${originMain.slice(0, 8)} matches the approved commit`);
}

// ── 3. Nothing uncommitted can have crept into the artifact.
let dirty = "";
try { dirty = git(["status", "--porcelain"]); } catch { dirty = ""; }
if (dirty.length > 0) {
  failures.push("DIRTY_TREE");
  detail.push(`the release tree has uncommitted or untracked changes:\n${dirty.split("\n").slice(0, 6).join("\n")}`);
}

// ── 4. The artifact itself says the same thing. This is the one that catches a build that ran
//      against a different tree than the one being verified here.
if (artifactArg !== null) {
  const artifactPath = artifactArg
    ? resolve(artifactArg)
    : join(root, "field-ops-app-vite", "dist", "version.json");
  if (!existsSync(artifactPath)) {
    failures.push("ARTIFACT_MISSING");
    detail.push(`no built artifact at ${artifactPath}`);
  } else {
    try {
      const stamped = JSON.parse(readFileSync(artifactPath, "utf8"));
      if (!sameCommit(stamped.commit, approved)) {
        failures.push("ARTIFACT_COMMIT_MISMATCH");
        detail.push(`version.json says ${stamped.commit}, approved was ${approved}`);
      } else {
        detail.push(`artifact version.json ${stamped.commit} matches the approved commit`);
      }
    } catch (err) {
      failures.push("ARTIFACT_UNREADABLE");
      detail.push(`${artifactPath}: ${err.message}`);
    }
  }
}

// ── 5. And after a deploy, what the environment is actually serving. THE ENVIRONMENT IS THE
//      AUTHORITY: a clean exit from firebase is not evidence of what is live.
if (remote) {
  const res = await fetch(`${remote.replace(/\/$/, "")}/version.json`, { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  if (!res) {
    failures.push("REMOTE_UNREADABLE");
    detail.push(`could not read ${remote}/version.json`);
  } else {
    if (!sameCommit(res.commit, approved)) {
      failures.push("REMOTE_COMMIT_MISMATCH");
      detail.push(`deployed commit is ${res.commit}, approved was ${approved}`);
    } else {
      detail.push(`deployed commit ${res.commit} matches the approved commit`);
    }
    if (res.environmentId !== "platform-sandbox" || res.environmentRole !== "sandbox") {
      failures.push("REMOTE_ENVIRONMENT_MISMATCH");
      detail.push(`deployed environment is ${res.environmentId}/${res.environmentRole}, expected platform-sandbox/sandbox`);
    } else {
      detail.push(`deployed environment ${res.environmentId}/${res.environmentRole}`);
    }
  }
}

for (const d of detail) console.log(`  ${d}`);
if (failures.length > 0) {
  console.error(`ABORT: release identity refused — ${failures.join(", ")}`);
  process.exit(6);
}
console.log(`RELEASE IDENTITY OK: ${approved.slice(0, 8)}`);
