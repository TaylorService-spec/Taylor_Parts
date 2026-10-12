// ADMIN POLICY LANE RELEVANCE -- does this change need the Admin policy jobs? (Owner ruling M3, 2026-10-12)
//
// ============================ WHY THIS EXISTS ============================
//
// "Admin policy engine -- authorization, workflow, tenancy, schema, seed" is to become a REQUIRED check
// on main. Its workflow used to start only through `paths:` trigger filters, and a required check whose
// workflow never starts never reports: every pull request that did not touch those paths would wait on
// it forever. So the workflow now starts on EVERY pull request, and the `changes` job asks this script
// whether the heavy jobs are relevant. When they are not, they are skipped by a job-level `if:`, which
// GitHub reports as a SKIPPED check run under the unchanged name -- and a skipped required check passes.
//
// ONE LIST. The globs live in .github/ci/eos-admin-policy-paths.txt and nowhere else; the two former
// trigger lists had already drifted apart from each other.
//
// FAIL-CLOSED. Anything this script cannot decide -- an unreadable list, a diff git refuses, an empty
// base -- answers `relevant=true`. The workflow's `if:` is written as `!= 'false'` for the same reason: a
// crashed `changes` job runs the lane rather than letting the required check skip itself green.
//
// Usage (CI):  node scripts/adminPolicyCiRelevance.mjs --base <sha|""> --head <sha>   >> "$GITHUB_OUTPUT"
// Prints `relevant=true|false` on stdout; the evidence goes to stderr.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { globMatches } from "./ciTriggerCoverage.lib.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const PATHS_FILE = ".github/ci/eos-admin-policy-paths.txt";

/** The globs in the list file, in file order (comments and blank lines dropped). */
export function parsePathsFile(source) {
  const globs = [];
  for (const [i, raw] of source.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    // The matcher implements `*`, `**` and `?` only. Refuse the rest rather than silently mis-match:
    // a pattern that matches nothing would quietly take a subject out of the required gate.
    if (/[!{}[\]\s"']/.test(line)) throw new Error(`${PATHS_FILE}:${i + 1}: unsupported glob syntax: ${raw}`);
    globs.push(line);
  }
  return globs;
}

export function loadGlobs(root = REPO_ROOT) {
  return parsePathsFile(readFileSync(resolve(root, PATHS_FILE), "utf8"));
}

/** The changed paths that some glob selects (empty -> irrelevant). */
export function matchingChanges(changedFiles, globs) {
  return changedFiles.filter((f) => globs.some((g) => globMatches(g, f)));
}

/**
 * The changed paths between base and head. Three-dot: the change the branch itself made since it left
 * base, which is what GitHub's own `paths:` filter evaluates for a pull request. --no-renames so that a
 * rename reports BOTH the old and the new path (moving a watched file away is a change to it).
 */
export function changedFiles(base, head, cwd = REPO_ROOT) {
  // -z: NUL-separated and never C-quoted, so a non-ASCII or space-bearing path arrives as its real
  // bytes (the default core.quotePath would hand the matcher "\303\251"-escaped, double-quoted names).
  const out = execFileSync("git", ["-c", "core.quotePath=false", "diff", "--name-only", "-z", "--no-renames", `${base}...${head}`], {
    cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024,
  });
  return out.split("\0").filter(Boolean);
}

function main(argv) {
  const arg = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? (argv[i + 1] ?? "") : undefined;
  };
  const base = arg("--base");
  const head = arg("--head") || "HEAD";
  let relevant = true;
  try {
    const globs = loadGlobs();
    if (globs.length === 0) throw new Error(`${PATHS_FILE} names no paths`);
    if (!base) {
      console.error("No base to diff against (dispatch, branch creation, or root commit): the lane runs.");
    } else {
      const files = changedFiles(base, head);
      const hits = matchingChanges(files, globs);
      console.error(`${files.length} changed path(s) between ${base} and ${head}; ${hits.length} relevant to the Admin policy lane.`);
      for (const f of hits.slice(0, 50)) console.error(`  relevant: ${f}`);
      relevant = hits.length > 0;
    }
  } catch (err) {
    console.error(`::warning::Admin policy relevance could not be decided (${err.message}); failing closed -- the lane runs.`);
    relevant = true;
  }
  process.stdout.write(`relevant=${relevant}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
