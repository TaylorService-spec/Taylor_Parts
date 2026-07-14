// Issue #219 -- emulator rules-source provenance (worktree-anchored, fail-closed).
//
// The Firebase emulator loads `firestore.rules` from the `firebase.json` in
// whatever directory it is launched from. The old run-skill guidance ("start the
// emulator from the repo root") let the emulator enforce the WRONG rules whenever
// the repo root was checked out on a stale feature branch -- the code/seed/driver
// came from one worktree while the emulator loaded another worktree's Rules. That
// produced a false "governed-field Rules gap" diagnosis twice.
//
// These pure helpers resolve the tested worktree from the SKILL's OWN filesystem
// location (never the caller's cwd), and fail CLOSED on any missing/ambiguous
// config or Rules mismatch BEFORE the emulator is started. Every side-effecting
// dependency (git, fs, kill) is injectable so the behavior is unit-testable
// without launching an emulator.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Absolute path of THIS skill directory, resolved from the module's own URL --
// this is the anchor: everything is resolved relative to where the skill lives,
// not process.cwd().
export const SKILL_DIR = dirname(fileURLToPath(import.meta.url));

export const EMULATOR_PROJECT = "taylor-parts";
// The app keeps a second, byte-identical copy of the Rules under the Vite app so
// the app bundle and the deployed root Rules never drift; provenance asserts they
// match.
const VITE_RULES_RELATIVE = join("field-ops-app-vite", "firestore.rules");

export class EmulatorProvenanceError extends Error {
  constructor(message) {
    super(message);
    this.name = "EmulatorProvenanceError";
  }
}

// --- injectable defaults ------------------------------------------------
function defaultGit(args) {
  return execFileSync("git", args, { encoding: "utf8" });
}
function defaultResolveHead(worktreeRoot, { git = defaultGit } = {}) {
  return git(["-C", worktreeRoot, "rev-parse", "HEAD"]).trim();
}

// Resolve the git worktree that ENCLOSES the skill, from the skill's own path --
// independent of process.cwd(). A caller launched from a different repo/worktree
// still resolves THIS skill's worktree. Never falls back to cwd.
export function resolveWorktreeRoot(skillDir = SKILL_DIR, { git = defaultGit } = {}) {
  let top;
  try {
    top = git(["-C", skillDir, "rev-parse", "--show-toplevel"]).trim();
  } catch (err) {
    throw new EmulatorProvenanceError(
      `could not resolve the git worktree enclosing the skill at ${skillDir}: ${err.message}`
    );
  }
  if (!top) {
    throw new EmulatorProvenanceError(`git returned no worktree top-level for skill dir ${skillDir}`);
  }
  return top;
}

// Read + validate firebase.json at the worktree root, returning the resolved
// absolute Firestore Rules path. Fails closed on a missing/invalid config or a
// missing/absent rules target.
export function readFirebaseConfig(worktreeRoot) {
  const configPath = join(worktreeRoot, "firebase.json");
  if (!existsSync(configPath)) {
    throw new EmulatorProvenanceError(`firebase.json not found at ${configPath}`);
  }
  let config;
  try {
    config = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (err) {
    throw new EmulatorProvenanceError(`firebase.json at ${configPath} is not valid JSON: ${err.message}`);
  }
  const rulesRel = config && config.firestore && config.firestore.rules;
  if (typeof rulesRel !== "string" || rulesRel.length === 0) {
    throw new EmulatorProvenanceError(`firebase.json at ${configPath} has no firestore.rules target`);
  }
  const rulesPath = resolve(worktreeRoot, rulesRel);
  if (!existsSync(rulesPath)) {
    throw new EmulatorProvenanceError(`firestore.rules target does not exist at ${rulesPath}`);
  }
  return { configPath, rulesPath };
}

// Compute the full provenance record for the tested worktree, failing CLOSED if
// the root and Vite Rules copies are not byte-identical. Never launches anything.
export function computeProvenance(worktreeRoot, { resolveHead = defaultResolveHead } = {}) {
  const { configPath, rulesPath } = readFirebaseConfig(worktreeRoot);

  const rootRules = readFileSync(rulesPath);
  const viteRulesPath = join(worktreeRoot, VITE_RULES_RELATIVE);
  if (!existsSync(viteRulesPath)) {
    throw new EmulatorProvenanceError(`Vite Rules copy not found at ${viteRulesPath}`);
  }
  const viteRules = readFileSync(viteRulesPath);
  if (!rootRules.equals(viteRules)) {
    throw new EmulatorProvenanceError(
      `root and Vite firestore.rules differ (byte mismatch) between ${rulesPath} and ${viteRulesPath} -- refusing to start the emulator against ambiguous Rules`
    );
  }

  const rulesHash = createHash("sha256").update(rootRules).digest("hex");
  let head;
  try {
    head = resolveHead(worktreeRoot);
  } catch (err) {
    throw new EmulatorProvenanceError(`could not resolve HEAD for worktree ${worktreeRoot}: ${err.message}`);
  }

  return {
    worktreeRoot,
    head,
    project: EMULATOR_PROJECT,
    configPath,
    rulesPath,
    viteRulesPath,
    rulesHash,
    rulesBytes: rootRules.length,
  };
}

// Convenience: resolve the worktree from the skill dir AND compute provenance.
export function resolveProvenance(skillDir = SKILL_DIR, deps = {}) {
  const worktreeRoot = resolveWorktreeRoot(skillDir, deps);
  return computeProvenance(worktreeRoot, deps);
}

// A human-readable, secret-free provenance report (only worktree paths, a commit
// hash, and a rules digest -- no tokens, keys, or credentials).
export function formatProvenance(prov) {
  return [
    "Emulator rules-source provenance:",
    `  worktree : ${prov.worktreeRoot}`,
    `  HEAD     : ${prov.head}`,
    `  project  : ${prov.project}`,
    `  config   : ${prov.configPath}`,
    `  rules    : ${prov.rulesPath}`,
    `  rulesSha : sha256:${prov.rulesHash}`,
    `  rulesLen : ${prov.rulesBytes} bytes`,
  ].join("\n");
}

// --- owned-PID teardown -------------------------------------------------
// Where the launcher records the exact PIDs it owns.
export function ownedPidsPath(skillDir = SKILL_DIR) {
  return join(skillDir, ".emulator-pids.json");
}

function defaultKill(pid) {
  if (process.platform === "win32") {
    // Kill the exact PID and its child tree (firebase CLI -> java/node) by PID.
    execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    // Negative pid targets the process group the launcher created (detached).
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      process.kill(pid, "SIGTERM");
    }
  }
}

// Stop ONLY the exact PIDs passed in (the launcher's own children). Never
// pattern-matches command lines, so foreign emulator/dev processes are untouched.
export function stopOwnedPids(pids, { kill = defaultKill } = {}) {
  const results = [];
  for (const pid of pids) {
    try {
      kill(pid);
      results.push({ pid, stopped: true });
    } catch (err) {
      results.push({ pid, stopped: false, error: err.message });
    }
  }
  return results;
}
