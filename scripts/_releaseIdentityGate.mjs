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
//
// ════════════════════ WHY THIS POLLS, AND WHAT IT REFUSES TO SOFTEN ════════════════════
//
// THE DEFECT (2026-08-27). This was a SINGLE fetch. Firebase Hosting prints "Deploy complete!"
// when the release is created; the release becomes current, and reaches the edge this gate reads,
// a moment later. On the 34b19c8d refresh the gap was measurable:
//
//     01:32:56.817Z  artifact built
//     01:33:04.311Z  Hosting version created
//     01:33:08.142Z  releaseTime -- and the Last-Modified of the bytes finally served
//
// The gate fetched between "Deploy complete!" and 01:33:08.142Z, was served the PREVIOUS release
// (c45979b7), and refused with REMOTE_COMMIT_MISMATCH, exit 6 -- on a deploy that had entirely
// succeeded. Same project, same site (the project has exactly one, DEFAULT_SITE), same URL, and
// the bytes now serving carry byte-identical buildTime to the local artifact. Nothing was wrong
// except WHEN the question was asked.
//
// `cache: "no-store"` did not and cannot prevent this: it governs THIS process's HTTP cache. It
// has no authority over Firebase's CDN, which was correctly serving the release that was current
// at the moment of the request.
//
// Because it is a race it fires only when the read lands inside the gap, which is why it recurred
// intermittently across refreshes and why a blind retry appeared to "fix" it.
//
// ════════════════════ WHAT IS DELIBERATELY UNCHANGED ════════════════════
//
// The gate still refuses unless the ENVIRONMENT ITSELF serves the approved commit. It has simply
// stopped refusing because it asked before the answer could exist. Specifically NOT done:
//   * the remote check is not removed, and no mismatch is downgraded to a warning;
//   * "Deploy complete!" is never trusted as evidence;
//   * there is no unconditional sleep -- a fixed wait trades one race for a slower one, and still
//     fails whenever propagation takes a second longer than the guess;
//   * commit equality is untouched (sameCommit is unchanged);
//   * a WRONG commit can never become a pass. Only the APPROVED commit ends the poll early;
//     anything else is retried and, if it persists, fails exactly as before.
//   * the environment assertion still runs, on the last response observed.
//
// A persistent mismatch therefore still costs REMOTE_DEADLINE_SECONDS and then fails closed --
// which is the correct trade: a real wrong-commit deploy is not made safe by failing faster.
// The production values. Overridable ONLY through environment variables, and ONLY so the proof
// suite can exercise the timeout branch without taking a real minute per case. NO RUNBOOK SETS
// THEM -- test/releaseIdentityRemoteRetry.test.mjs asserts that, so a future edit cannot quietly
// shorten a live release's deadline by exporting one. A missing or unparseable value falls back
// to the production number rather than to something smaller.
const envMs = (name, fallback) => {
  const raw = process.env[name];
  const n = raw == null ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const REMOTE_DEADLINE_MS = envMs("EOS_RELEASE_REMOTE_DEADLINE_MS", 60_000);
const REMOTE_INTERVAL_MS = envMs("EOS_RELEASE_REMOTE_INTERVAL_MS", 2_000);

/**
 * Read the deployed version.json until it reports the approved commit, or the deadline expires.
 *
 * Cache-busted per attempt: `cache: "no-store"` covers this process, and the query parameter
 * covers anything between here and the origin. Belt and braces, because the whole point of this
 * gate is that it is reading the environment rather than a copy of it.
 *
 * Returns the LAST response observed (or null if none was readable), plus the evidence needed to
 * tell the three outcomes apart in the log.
 */
async function pollRemoteIdentity(origin) {
  const base = `${origin.replace(/\/$/, "")}/version.json`;
  const startedAt = Date.now();
  let attempts = 0;
  let last = null;
  let sawStale = false;

  for (;;) {
    attempts += 1;
    const res = await fetch(`${base}?releaseIdentityCheck=${Date.now()}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    if (res) {
      last = res;
      if (sameCommit(res.commit, approved)) {
        return { res: last, attempts, waitedMs: Date.now() - startedAt, matched: true, sawStale };
      }
      sawStale = true;
    }
    if (Date.now() - startedAt + REMOTE_INTERVAL_MS > REMOTE_DEADLINE_MS) {
      return { res: last, attempts, waitedMs: Date.now() - startedAt, matched: false, sawStale };
    }
    // Reported the FIRST time only. A line every two seconds turns a normal ten-second
    // propagation into a wall of text that hides the one line that matters.
    if (attempts === 1) {
      console.log(`  waiting for the deployed release to become current (up to ${REMOTE_DEADLINE_MS / 1000}s)…`);
    }
    await new Promise((r) => setTimeout(r, REMOTE_INTERVAL_MS));
  }
}

if (remote) {
  const { res, attempts, waitedMs, matched, sawStale } = await pollRemoteIdentity(remote);
  if (!res) {
    // Unreadable is still unreadable. Retrying a DNS failure or a 500 for a minute does not make
    // it a pass, and this branch is reached only when NO attempt ever returned a usable body.
    failures.push("REMOTE_UNREADABLE");
    detail.push(`could not read ${remote}/version.json after ${attempts} attempt(s) over ${Math.round(waitedMs / 1000)}s`);
  } else {
    if (!matched) {
      failures.push("REMOTE_COMMIT_MISMATCH");
      // The last commit actually observed is the diagnostic -- it is what distinguishes "the wrong
      // artifact is live" from "propagation never completed".
      detail.push(
        `deployed commit is ${res.commit}, approved was ${approved} ` +
        `(last of ${attempts} reads over ${Math.round(waitedMs / 1000)}s)`,
      );
    } else if (sawStale) {
      // The race, observed and survived. Worth saying out loud: it is the evidence that this
      // deploy was subject to propagation lag, and the reason the deadline exists.
      detail.push(
        `deployed commit ${res.commit} matches the approved commit ` +
        `(after ${Math.round(waitedMs / 1000)}s / ${attempts} reads — the release was still propagating)`,
      );
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
