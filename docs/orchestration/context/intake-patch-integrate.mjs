// Explicitly-approved patch integration. This is separate from Claude completion and never invokes a model.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyPatchManifest } from "../lib/intakePatch.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : null; };
function git(args, allow = false) { const out = spawnSync("git", args, { cwd: REPO, encoding: "utf8", windowsHide: true }); if (!allow && out.status !== 0) throw new Error(out.stderr.trim() || `git ${args.join(" ")} failed`); return out; }

export function integrationRecordLocation(requestId, patchSha256) {
  return `docs/orchestration/work-intake/results/${requestId}/integration/${patchSha256}.json`;
}

export function focusedChecks(paths) {
  const modules = paths.filter((path) => path.endsWith(".mjs")).map((path) => ["node", "--check", path]);
  const tests = paths.filter((path) => /(?:^|\/)\w[^/]*\.test\.mjs$/.test(path)).map((path) => ["node", "--test", path]);
  return [...modules, ...tests];
}

export function assessBaseCompatibility({ isAncestor, changedSinceBase, patchPaths }) {
  if (!isAncestor) return Object.freeze({ ok: false, reason: "patch base is not an ancestor of current main" });
  const targets = new Set(patchPaths);
  const overlap = [...new Set(changedSinceBase)].filter((path) => targets.has(path)).sort();
  return Object.freeze({ ok: overlap.length === 0, reason: overlap.length ? `patch targets changed since base: ${overlap.join(", ")}` : null });
}

function repoFile(path) {
  const absolute = resolve(REPO, path);
  const within = relative(REPO, absolute);
  if (!within || within.startsWith("..") || resolve(REPO, within) !== absolute) throw new Error(`unsafe repository path: ${path}`);
  return absolute;
}

function main() {
  const requestId = arg("request-id"), manifestPath = arg("manifest"), expectedPatchSha = arg("patch-sha"), approval = arg("approval");
  if (approval !== "APPROVE") throw new Error("explicit --approval APPROVE is required");
  const expectedRoot = `docs/orchestration/work-intake/results/${requestId}/`;
  if (!manifestPath?.startsWith(expectedRoot) || !manifestPath.endsWith(".patch.json")) throw new Error("manifest must be in the request results directory");
  const manifest = JSON.parse(readFileSync(repoFile(manifestPath), "utf8"));
  const recordPath = integrationRecordLocation(requestId, manifest.patchSha256);
  if (existsSync(repoFile(recordPath))) { process.stdout.write(`${JSON.stringify({ disposition: "ALREADY_INTEGRATED", recordPath })}\n`); return; }
  if (manifest.patchSha256 !== expectedPatchSha) throw new Error("approved patch hash does not match manifest");
  if (!manifest.patchLocation?.startsWith(expectedRoot) || !manifest.patchLocation.endsWith(".patch")) throw new Error("patch must be in the request results directory");
  const patch = readFileSync(repoFile(manifest.patchLocation));
  const base = git(["rev-parse", "HEAD"]).stdout.trim();
  const verification = verifyPatchManifest(manifest, patch, { requestId });
  if (!verification.ok) throw new Error(`patch verification failed: ${verification.errors.join("; ")}`);
  if (git(["status", "--porcelain"]).stdout.trim()) throw new Error("integration checkout must start clean");
  const ancestor = git(["merge-base", "--is-ancestor", manifest.baseCommit, base], true).status === 0;
  const changedSinceBase = ancestor ? git(["diff", "--name-only", "-z", `${manifest.baseCommit}..${base}`, "--", ...manifest.paths]).stdout.split("\0").filter(Boolean) : [];
  const compatibility = assessBaseCompatibility({ isAncestor: ancestor, changedSinceBase, patchPaths: manifest.paths });
  if (!compatibility.ok) throw new Error(compatibility.reason);
  git(["apply", "--check", "--index", manifest.patchLocation]);
  git(["apply", "--index", manifest.patchLocation]);
  const staged = git(["diff", "--cached", "--name-only", "-z"]).stdout.split("\0").filter(Boolean).sort();
  if (JSON.stringify(staged) !== JSON.stringify([...manifest.paths].sort())) throw new Error("applied paths do not exactly match manifest");
  for (const command of focusedChecks(staged)) {
    const out = spawnSync(command[0], command.slice(1), { cwd: REPO, encoding: "utf8", windowsHide: true });
    process.stdout.write(out.stdout || ""); process.stderr.write(out.stderr || "");
    if (out.status !== 0) throw new Error(`focused check failed: ${command.join(" ")}`);
  }
  const record = { schema: "eos.intake.patch-integration/1", requestId, patchSha256: manifest.patchSha256, baseCommit: base, paths: manifest.paths, state: "INTEGRATED", integratedAt: new Date().toISOString() };
  mkdirSync(dirname(repoFile(recordPath)), { recursive: true });
  writeFileSync(repoFile(recordPath), `${JSON.stringify(record, null, 2)}\n`);
  git(["add", "--", recordPath]);
  process.stdout.write(`${JSON.stringify({ disposition: "APPLIED_AND_VERIFIED", recordPath, paths: staged }, null, 2)}\n`);
}
if (fileURLToPath(import.meta.url) === process.argv[1]) main();
