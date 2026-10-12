// TRACKED TREE HYGIENE. Refuses two things a checkout must never receive from the repository:
//
//   * anything under a `node_modules` path segment -- dependencies are installed per checkout, never committed;
//   * a symbolic link whose target is ABSOLUTE or leaves the repository.
//
// It exists because `functions/node_modules` was committed as a symlink to ANOTHER worktree's dependencies (f32bc0a1):
// every checkout of main then ran its tests against whatever that other worktree had installed, and the ignore pattern
// `node_modules/` (directories only) let the symlink -- a file -- through. A relative link inside the repository is
// still allowed: that is an ordinary, portable use.
import { execFileSync } from "node:child_process";
import { isAbsolute, normalize, posix } from "node:path";

/**
 * The violations among tracked entries. Pure.
 * @param {{ mode: string, path: string }[]} entries  `git ls-files -s` rows
 * @param {(path: string) => string} linkTarget       the stored target of a tracked symlink
 */
export function trackedTreeViolations(entries, linkTarget) {
  const out = [];
  for (const { mode, path } of entries) {
    if (path.split("/").includes("node_modules")) out.push({ path, reason: "tracked under node_modules" });
    if (mode !== "120000") continue;
    const target = linkTarget(path);
    if (isAbsolute(target) || /^[A-Za-z]:[\\/]/.test(target)) {
      out.push({ path, reason: `symlink to an absolute path (${target})` });
      continue;
    }
    const resolved = normalize(posix.join(posix.dirname(path), target.replace(/\\/g, "/")));
    if (resolved === ".." || resolved.startsWith("../") || resolved.startsWith("..\\")) {
      out.push({ path, reason: `symlink leaving the repository (${target})` });
    }
  }
  return out;
}

export function scanTrackedTree(cwd = process.cwd()) {
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  const entries = git("ls-files", "-s", "-z").split("\0").filter(Boolean).map((row) => {
    const [meta, path] = row.split("\t");
    return { mode: meta.split(" ")[0], path };
  });
  const linkTarget = (path) => git("cat-file", "blob", `:${path}`);
  return trackedTreeViolations(entries, linkTarget);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const violations = scanTrackedTree();
  for (const v of violations) console.error(`REFUSED ${v.path}: ${v.reason}`);
  if (violations.length) {
    console.error(`\n${violations.length} tracked path(s) refused. Untrack with \`git rm --cached <path>\` (the working copy is kept).`);
    process.exit(1);
  }
  console.log("tracked tree hygiene: clean");
}
