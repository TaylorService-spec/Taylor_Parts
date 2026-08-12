// Convert an isolated Claude checkout into governed EOS result artifacts. Never applies source changes.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPatchManifest, patchSha256 } from "../lib/intakePatch.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : null; };

function git(cwd, args, { allow = false } = {}) {
  const out = spawnSync("git", args, { cwd, encoding: "buffer", windowsHide: true });
  if (!allow && out.status !== 0) throw new Error((out.stderr || Buffer.alloc(0)).toString("utf8").trim() || `git ${args.join(" ")} failed`);
  return out;
}

export function parsePorcelainZ(bytes) {
  const records = bytes.toString("utf8").split("\0").filter(Boolean);
  const paths = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    paths.push(record.slice(3).replaceAll("\\", "/"));
    if (record[0] === "R" || record[0] === "C" || record[1] === "R" || record[1] === "C") index += 1;
  }
  return paths;
}

export function recoverReport({ reportBytes, outputRepo = REPO, workArtifact, createdAt, recovery }) {
  const sha = patchSha256(reportBytes);
  const root = `docs/orchestration/work-intake/results/${workArtifact.requestId}`;
  const reportLocation = `${root}/${sha}.report.md`;
  const record = { schema: "eos.intake.report-recovery/1", requestId: workArtifact.requestId, sourceWorkSha256: workArtifact.sha256, reportLocation, reportSha256: sha, createdAt, recovery };
  const recordSha = patchSha256(Buffer.from(JSON.stringify(record, null, 2) + "\n"));
  const recordLocation = `${root}/${recordSha}.recovery.json`;
  mkdirSync(join(outputRepo, root), { recursive: true });
  writeFileSync(join(outputRepo, reportLocation), reportBytes);
  writeFileSync(join(outputRepo, recordLocation), `${JSON.stringify({ ...record, artifactLocation: recordLocation, sha256: recordSha }, null, 2)}\n`);
  return Object.freeze({ reportLocation, recordLocation, reportSha256: sha });
}

export function artifactizeWorkspace({ workspace, outputRepo = REPO, workArtifact, baseCommit, createdAt, recovery = null }) {
  const requestId = workArtifact.requestId;
  const reportPath = `docs/orchestration/work-intake/${requestId}.report.md`;
  const dirty = parsePorcelainZ(git(workspace, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]).stdout);
  const sourcePaths = [...new Set(dirty.filter((path) => path !== reportPath))].sort();
  const resultRoot = join(outputRepo, "docs", "orchestration", "work-intake", "results", requestId);
  mkdirSync(resultRoot, { recursive: true });
  const written = [];

  if (existsSync(join(workspace, reportPath))) {
    const report = readFileSync(join(workspace, reportPath));
    const sha = patchSha256(report);
    const location = `docs/orchestration/work-intake/results/${requestId}/${sha}.report.md`;
    writeFileSync(join(outputRepo, location), report);
    written.push(location);
  }

  let manifest = null;
  if (sourcePaths.length) {
    git(workspace, ["add", "-N", "--", ...sourcePaths]);
    const patch = git(workspace, ["diff", "--binary", "--no-ext-diff", baseCommit, "--", ...sourcePaths]).stdout;
    if (!patch.length) throw new Error("dirty source paths produced an empty patch");
    manifest = buildPatchManifest({ requestId, sourceWorkSha256: workArtifact.sha256, baseCommit, scope: workArtifact.scope, paths: sourcePaths, patchBytes: patch, createdAt, recovery });
    writeFileSync(join(outputRepo, manifest.patchLocation), patch);
    writeFileSync(join(outputRepo, manifest.artifactLocation), `${JSON.stringify(manifest, null, 2)}\n`);
    written.push(manifest.patchLocation, manifest.artifactLocation);
  }
  return Object.freeze({ requestId, sourcePaths, reportCaptured: written.some((p) => p.endsWith(".report.md")), manifest, written });
}

function main() {
  const workspace = arg("workspace"), work = arg("work"), baseCommit = arg("base-commit"), createdAt = arg("created-at") || new Date().toISOString(), recovery = arg("recovery");
  if (!work) throw new Error("--work is required");
  const workArtifact = JSON.parse(readFileSync(resolve(work), "utf8"));
  const reportSource = arg("report-source");
  if (reportSource) {
    const result = recoverReport({ reportBytes: readFileSync(resolve(reportSource)), workArtifact, createdAt, recovery });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); return;
  }
  if (!workspace || !baseCommit) throw new Error("--workspace and --base-commit are required");
  const result = artifactizeWorkspace({ workspace: resolve(workspace), workArtifact, baseCommit, createdAt, recovery });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (fileURLToPath(import.meta.url) === process.argv[1]) main();
