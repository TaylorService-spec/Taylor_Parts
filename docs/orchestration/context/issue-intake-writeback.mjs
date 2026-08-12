// Fail-closed path guard for the GitHub Issue -> EOS write-back workflow.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export function allowedWritebackPath(requestId, path) {
  const normalized = String(path || "").replaceAll("\\", "/");
  const root = "docs/orchestration/work-intake";
  return normalized === `${root}/${requestId}.work.json`
    || normalized === `${root}/status/${requestId}.status.json`
    || normalized === `${root}/review-ready/${requestId}.json`
    || normalized.startsWith(`${root}/results/${requestId}/`);
}

export function unexpectedWritebackPaths(requestId, paths) {
  return [...new Set(paths.filter((path) => !allowedWritebackPath(requestId, path)))].sort();
}

function gitPaths(source) {
  const args = source === "index" ? ["diff", "--cached", "--name-only", "-z"] : ["status", "--porcelain=v1", "-z", "--untracked-files=all"];
  const out = spawnSync("git", args, { encoding: "utf8" });
  if (out.status !== 0) throw new Error(out.stderr.trim() || `git ${args[0]} failed`);
  const records = out.stdout.split("\0").filter(Boolean);
  if (source === "index") return records;
  return records.map((record) => record.slice(3)).map((path) => path.includes(" -> ") ? path.split(" -> ").at(-1) : path);
}

function arg(name, fallback = null) { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback; }

function main() {
  const requestId = arg("request-id"), source = arg("source", "worktree");
  if (!requestId || !/^EOS-ISSUE-[1-9][0-9]*$/.test(requestId)) throw new Error("--request-id must be EOS-ISSUE-<number>");
  if (!new Set(["worktree", "index"]).has(source)) throw new Error("--source must be worktree or index");
  const paths = gitPaths(source), unexpected = unexpectedWritebackPaths(requestId, paths);
  process.stdout.write(`${JSON.stringify({ requestId, source, paths, unexpected }, null, 2)}\n`);
  if (unexpected.length) { process.stderr.write(`EOS write-back refused unexpected ${source} path(s): ${unexpected.join(", ")}\n`); process.exit(1); }
}

if (fileURLToPath(import.meta.url) === process.argv[1]) main();
