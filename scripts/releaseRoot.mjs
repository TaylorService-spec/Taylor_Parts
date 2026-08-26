// WHICH CHECKOUT IS BEING RELEASED — decided explicitly, never by where somebody happened to stand.
//
// ============================ THE INCIDENT THIS EXISTS FOR ============================
//
// platform-sandbox was deployed from `e068beb0`, a commit that existed on exactly one ref:
// an unmerged feature branch. It was proven by artifact, not inference — the emitted
// field-ops-app-vite/dist/version.json carrying that commit and buildTime was found in a Claude
// worktree, while the designated operator checkout still held the previous release and its HEAD
// reflog showed no movement.
//
// The provenance guard was not at fault: run against that commit it refuses with UNMERGED_COMMIT
// and exit 3. The hole was upstream of it. Every one of this repository's 125 worktrees carries a
// copy of `sandbox-refresh.ps1` and `scripts/_sandboxRefresh.run.sh`, each script derives the
// release root from its OWN location, and the PowerShell launcher then invoked bash as
// `-lc './scripts/_sandboxRefresh.run.sh'` — a relative path resolved by a LOGIN shell whose
// profile is free to change directory. So "which repository is being released" was answered by a
// combination of which copy was clicked and what a shell profile did, and the only thing standing
// between that and a deploy was a single check inside the script that was itself copied.
//
// ============================ WHAT THIS ENFORCES ============================
//
// The root is resolved from ONE explicit source, validated to be a real EOS checkout, and returned
// as an absolute path that every later step is given rather than re-deriving. Resolution order:
//
//   1. --release-root <path>      an argument, for a caller that knows
//   2. EOS_RELEASE_ROOT           an environment variable, for an operator machine
//   3. the script's own location  the historical behaviour, kept as the last resort
//
// A root that is not a checkout, or is a nested agent/tool worktree, is REFUSED. Agent worktrees
// are where feature branches live; a release must never come from one, and naming that rule is
// better than relying on nobody ever running the wrong copy.
import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Directories whose presence proves this is an EOS checkout rather than any old folder. */
const REQUIRED_MARKERS = Object.freeze([
  "scripts/_sandboxRefresh.run.sh",
  "field-ops-app-vite",
  "functions",
  "firebase.json",
]);

/**
 * Path segments that mark a working copy created FOR AN AGENT OR TOOL, not for releasing.
 * These are where feature branches live, and the incident's release root was one of them.
 */
const FORBIDDEN_SEGMENTS = Object.freeze([
  join(".claude", "worktrees"),
  join(".codex", "worktrees"),
]);

export const RELEASE_ROOT_FAILURE = Object.freeze({
  NOT_A_DIRECTORY: "NOT_A_DIRECTORY",
  NOT_A_CHECKOUT: "NOT_A_CHECKOUT",
  MISSING_MARKER: "MISSING_MARKER",
  AGENT_WORKTREE: "AGENT_WORKTREE",
});

/**
 * Decide the release root and prove it is one. Pure apart from filesystem reads, so the rules can
 * be asserted directly.
 *
 * @param argv           process argv tail, scanned for `--release-root <path>`
 * @param env            process env, scanned for EOS_RELEASE_ROOT
 * @param fallback       the script-location root, used only when neither is supplied
 * @param allowAgentRoot escape hatch for the TEST SUITE ONLY, which must build fixture roots under
 *                       a temp path. Never set by the shipped scripts.
 */
export function resolveReleaseRoot({ argv = [], env = {}, fallback = join(HERE, ".."), allowAgentRoot = false } = {}) {
  const valueAfter = (flag) => {
    const at = argv.indexOf(flag);
    return at >= 0 && at + 1 < argv.length ? argv[at + 1] : null;
  };
  const fromArg = valueAfter("--release-root");
  // The shell caller passes its own script-derived root as --fallback so this module never has to
  // guess where it was copied to.
  const fromFallbackArg = valueAfter("--fallback");
  const chosen = fromArg || env.EOS_RELEASE_ROOT || fromFallbackArg || fallback;
  const source = fromArg
    ? "--release-root"
    : env.EOS_RELEASE_ROOT
      ? "EOS_RELEASE_ROOT"
      : fromFallbackArg
        ? "caller script location"
        : "script location";
  const root = resolve(chosen);

  const failures = [];
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    failures.push(RELEASE_ROOT_FAILURE.NOT_A_DIRECTORY);
    return verdict(root, source, failures);
  }
  // A linked worktree has a `.git` FILE, a primary checkout a `.git` directory. Both are legitimate
  // release roots -- the designated operator checkout on this machine is itself a linked worktree --
  // so this only asserts that one of them is present.
  if (!existsSync(join(root, ".git"))) failures.push(RELEASE_ROOT_FAILURE.NOT_A_CHECKOUT);
  for (const marker of REQUIRED_MARKERS) {
    if (!existsSync(join(root, marker))) {
      failures.push(`${RELEASE_ROOT_FAILURE.MISSING_MARKER}:${marker}`);
    }
  }
  if (!allowAgentRoot) {
    const normalised = root.split("/").join(sep);
    for (const segment of FORBIDDEN_SEGMENTS) {
      if (normalised.includes(sep + segment) || normalised.includes(segment + sep)) {
        failures.push(RELEASE_ROOT_FAILURE.AGENT_WORKTREE);
      }
    }
  }
  return verdict(root, source, failures);
}

function verdict(root, source, failures) {
  return { ok: failures.length === 0, root, source, failures };
}

/** HEAD and origin/main as this root sees them. Separate from resolution so tests can stub either. */
export function readRootCommits(root) {
  const git = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  let head = null;
  let originMain = null;
  let dirty = null;
  try { head = git(["rev-parse", "HEAD"]); } catch { head = null; }
  try { originMain = git(["rev-parse", "origin/main"]); } catch { originMain = null; }
  try { dirty = git(["status", "--porcelain"]); } catch { dirty = null; }
  return { head, originMain, dirty };
}

/** CLI: print the resolved root, or refuse loudly. Used by the shell scripts. */
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const v = resolveReleaseRoot({ argv: process.argv.slice(2), env: process.env });
  if (!v.ok) {
    console.error(`ABORT: release root refused (${v.source}: ${v.root})`);
    for (const f of v.failures) console.error(`       ${f}`);
    if (v.failures.includes(RELEASE_ROOT_FAILURE.AGENT_WORKTREE)) {
      console.error("       A release may not be built from an agent worktree. Run the operator checkout's own copy,");
      console.error("       or set EOS_RELEASE_ROOT to the designated release checkout.");
    }
    process.exit(4);
  }
  process.stdout.write(v.root);
}
