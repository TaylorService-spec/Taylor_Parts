// EOS work-intake runner — file I/O adapter only. It resolves one exact hash-pinned artifact,
// projects it into the existing selector, and emits the existing Wake Supervisor state shape.
// It never invokes a model and never creates a second queue/selector/orchestrator.

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveWorkIntake, intakeToWorkItem, workPointer, statusPointer, buildContentAddressedResult } from "../lib/workIntake.mjs";
import { selectNextWork } from "../lib/selectNextWork.mjs";

function safeRepoPath(repoRoot, location) {
  const root = resolve(repoRoot);
  const target = resolve(root, location);
  if (target !== root && !target.startsWith(`${root}${sep}`)) throw new Error("work-intake: location escapes repo root");
  return target;
}

export function consumeWorkPointer({ repoRoot, requestId, location, sha256, sourceCommit = null, readFile = readFileSync }) {
  const bytes = readFile(safeRepoPath(repoRoot, location));
  const artifact = resolveWorkIntake({ requestId, location, sha256, bytes });
  const item = intakeToWorkItem(artifact, { sourceCommit });
  const selection = selectNextWork([item]);
  return Object.freeze({
    submit: workPointer(requestId),
    status: statusPointer(requestId),
    resolved: Object.freeze({ requestId, location, sha256 }),
    selection,
    supervisorState: Object.freeze({ item, sourceCommit: sourceCommit ?? item.sha, sourceFreshness: "CURRENT" }),
  });
}

export function persistResult({ repoRoot, result, mkdir = mkdirSync, writeFile = writeFileSync }) {
  const contentPath = safeRepoPath(repoRoot, result.contentLocation);
  const manifestPath = safeRepoPath(repoRoot, result.manifestLocation);
  mkdir(resolve(contentPath, ".."), { recursive: true });
  writeFile(contentPath, result.content, { flag: "wx" });
  writeFile(manifestPath, `${JSON.stringify(result.manifest, null, 2)}\n`, { flag: "wx" });
  return Object.freeze({ pointer: result.manifest.pointer, location: result.manifestLocation, sha256: result.manifest.sha256 });
}

function arg(argv, name, fallback = null) {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[index + 1] : fallback;
}

export function runCli(argv, { repoRoot = process.cwd() } = {}) {
  const requestId = arg(argv, "id");
  const location = arg(argv, "location");
  const sha256 = arg(argv, "sha256");
  if (!requestId || !location || !sha256) throw new Error("usage: work-intake.mjs --id <id> --location <repo-path> --sha256 <hash> [--source-commit <sha>]");
  return consumeWorkPointer({ repoRoot, requestId, location, sha256, sourceCommit: arg(argv, "source-commit") });
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  try { process.stdout.write(`${JSON.stringify(runCli(process.argv.slice(2)), null, 2)}\n`); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exit(2); }
}

export { buildContentAddressedResult };
