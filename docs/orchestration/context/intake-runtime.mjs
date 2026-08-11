// EOS intake EXECUTION runtime — the persistent-trigger entrypoint that carries ONE eligible
// EXECUTION_AUTHORIZED intake through the guarded Wake Supervisor to durable result + COMPLETE status,
// WITHOUT Owner PowerShell or a Claude GUI. A hosted EOS runtime (or a self-hosted CI runner with the
// `claude` CLI) calls this per eligible item; the pure driver (intakeExecute.runIntakeExecution) is the
// same code the acceptance test exercises with an injected fake worker.
//
// It spawns ZERO unless the item is EXECUTION_AUTHORIZED + independently AUTHORIZED + no protected boundary
// AND every required paid capability is AVAILABLE from the injected Secret Broker. No broker is wired yet
// (Codex/#790 owns that boundary), so any capability-requiring item resolves to BLOCKED — never a fabricated
// result. The API key is never read here; only the broker (once it exists) supplies credentials to workers.
//
// Modes:
//   writeback            → derive + write every intake's status artifact (delegates to intake-ingest-ci --write)
//   execute --id .. --location .. --sha256 .. [--requires OPENAI_REVIEW]  → run one item through the wake

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, sep } from "node:path";
import { resolveWorkIntake } from "../lib/workIntake.mjs";
import { runIntakeExecution } from "../lib/intakeExecute.mjs";
import { resolveClaudeBin } from "../lib/reviewInputSafety.mjs";
import { makeLease } from "../lib/wakeLease.mjs";
import { contextPackageFor } from "./build-package.mjs";
import { makeRealClaudeRunner } from "./reciprocal-pilot.mjs";
import { createSecretBroker } from "../lib/secretProvider.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const arg = (n, fb = null) => { const i = process.argv.indexOf(`--${n}`); return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : fb; };

function safeRepoPath(location) {
  const target = resolve(REPO, location);
  if (target !== REPO && !target.startsWith(`${REPO}${sep}`)) throw new Error("intake-runtime: location escapes repo root");
  return target;
}
function writeRepo(location, text) {
  const p = safeRepoPath(location);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
  return location;
}

/**
 * Execute one intake item with a real (or injected) worker and persist its artifacts. `deps` is injected in
 * tests (processRunner/lease/contextPackageFn/capabilityBroker/now); in production it defaults to the
 * guarded real Claude spawn + a file lease + the shared C-7 package + no broker.
 * @returns the driver disposition plus the repo paths written.
 */
export function executeIntakeItem({ requestId, location, sha256, sourceCommit = null, requiresCapabilities = [], deps = {} } = {}) {
  const bytes = (deps.readFile || readFileSync)(safeRepoPath(location));
  const artifact = resolveWorkIntake({ requestId, location, sha256, bytes });

  const now = deps.now || new Date().toISOString();
  // The MERGED #790 Secret Broker (availability only here — the actual key resolves inside withCredential at
  // the paid call). Off-Windows or unprovisioned ⇒ credentialAvailable false ⇒ the paid path stays BLOCKED,
  // fail-closed. Injected in tests.
  const capabilityBroker = deps.capabilityBroker ?? (() => { try { return createSecretBroker(); } catch { return null; } })();
  const claudeBin = deps.claudeBin || resolveClaudeBin({ env: process.env });
  const processRunner = deps.processRunner || makeRealClaudeRunner(claudeBin.bin);
  const lease = deps.lease || makeLease({ dir: join(process.env.LOCALAPPDATA || REPO, "EOS", "intake-runtime.lock"), fs: { readFileSync, writeFileSync, mkdirSync }, host: "local", pid: process.pid, now: () => Date.now(), leaseMs: 900000 });
  const contextPackageFn = deps.contextPackageFn || ((a) => contextPackageFor({ ...a }));
  const wakeCtx = deps.wakeCtx || { governor: { remoteAiUsed: 0, remoteAiMax: 1 }, network: "NORMAL", budgetRemainingUsd: 5, sourceFreshness: (sourceCommit ? "CURRENT" : "CURRENT") };

  const out = runIntakeExecution({ artifact, sourceCommit, now, requiresCapabilities, capabilityBroker, processRunner, lease, contextPackageFn, wakeCtx });

  // Always persist the status (deterministic path). On COMPLETE, persist the content-addressed result + index.
  const written = [];
  const write = deps.write || writeRepo;
  written.push(write(out.status.artifactLocation, `${JSON.stringify(out.status, null, 2)}\n`));
  if (out.disposition === "COMPLETE" && out.result) {
    write(out.result.contentLocation, out.result.content); // immutable content-addressed bytes
    written.push(out.result.contentLocation);
    write(out.result.manifestLocation, `${JSON.stringify(out.result.manifest, null, 2)}\n`);
    written.push(out.result.manifestLocation);
    write(out.result.index.artifactLocation, `${JSON.stringify(out.result.index, null, 2)}\n`);
    written.push(out.result.index.artifactLocation);
  }
  return Object.freeze({ disposition: out.disposition, requestId, written, resultPointer: out.status.result, statusPointer: out.status.pointer });
}

function main() {
  const mode = process.argv[2];
  if (mode === "execute") {
    const requestId = arg("id"), location = arg("location"), sha256 = arg("sha256");
    if (!requestId || !location || !sha256) { process.stderr.write("usage: intake-runtime.mjs execute --id <id> --location <path> --sha256 <hash> [--source-commit <sha>] [--requires <cap>]\n"); process.exit(2); }
    const requires = arg("requires") ? [arg("requires")] : [];
    const out = executeIntakeItem({ requestId, location, sha256, sourceCommit: arg("source-commit"), requiresCapabilities: requires });
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
    process.exit(out.disposition === "COMPLETE" || out.disposition === "STAGED" || out.disposition === "READY" || out.disposition === "BLOCKED" || out.disposition === "OWNER_REQUIRED" ? 0 : 1);
  }
  process.stderr.write("usage: intake-runtime.mjs execute ...  (writeback is handled by intake-ingest-ci.mjs --write)\n");
  process.exit(2);
}

if (fileURLToPath(import.meta.url) === process.argv[1]) main();
