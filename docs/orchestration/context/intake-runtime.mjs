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
import { dirname, join, resolve, relative, sep } from "node:path";
import { resolveWorkIntake } from "../lib/workIntake.mjs";
import { runIntakeExecution } from "../lib/intakeExecute.mjs";
import { reviewReadyLocation, statusLocation } from "../lib/intakeStatus.mjs";
import { decideIntakeDispatch } from "../lib/agentManager.mjs";
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
  const abs = safeRepoPath(location);
  const bytes = (deps.readFile || readFileSync)(abs);
  // Normalize the caller-supplied location to the canonical repo-relative POSIX form before the
  // artifact-location equality check in resolveWorkIntake. A Windows self-hosted runner passes an
  // absolute, backslash path (e.g. C:\actions-runner\...\X.work.json), while the artifact stores a
  // repo-relative forward-slash artifactLocation — a raw string compare of the two always fails.
  // Relativizing against REPO and forcing forward slashes makes the check OS/separator-agnostic
  // (a no-op when the caller already passes the canonical form, as the tests do).
  const canonicalLocation = relative(REPO, abs).split(sep).join("/");
  const artifact = resolveWorkIntake({ requestId, location: canonicalLocation, sha256, bytes });

  // Agent Manager DEDUPE_REUSE: do NOT re-dispatch a worker for work that already reached a COMPLETE status
  // for this exact authorized artifact (same sha). This is what stops the execute loop from re-running every
  // finished job on each pass. Non-terminal / FAILED / changed-sha items still DISPATCH (so a re-authorized or
  // previously-failed item self-heals). Reads the committed status (injectable for tests).
  const committedStatus = deps.readStatus
    ? deps.readStatus(requestId)
    : (() => { try { return JSON.parse(readFileSync(safeRepoPath(statusLocation(requestId)), "utf8")); } catch { return null; } })();
  const dispatch = decideIntakeDispatch({ requestId, workSha256: sha256, committedStatus });
  if (dispatch.decision === "DEDUPE_REUSE") {
    return Object.freeze({ disposition: "SKIPPED_ALREADY_COMPLETE", requestId, written: [], resultPointer: committedStatus.result, statusPointer: committedStatus.pointer, dedupe: dispatch.reason });
  }

  const now = deps.now || new Date().toISOString();
  // The MERGED #790 Secret Broker (availability only here — the actual key resolves inside withCredential at
  // the paid call). Off-Windows or unprovisioned ⇒ credentialAvailable false ⇒ the paid path stays BLOCKED,
  // fail-closed. Injected in tests.
  const capabilityBroker = deps.capabilityBroker ?? (() => { try { return createSecretBroker(); } catch { return null; } })();
  const claudeBin = deps.claudeBin || resolveClaudeBin({ env: process.env });
  const processRunner = deps.processRunner || makeRealClaudeRunner(claudeBin.bin);
  const lease = deps.lease || makeLease({
    dir: join(process.env.LOCALAPPDATA || REPO, "EOS", "intake-runtime.lock"),
    fs: { readFileSync, writeFileSync, mkdirSync }, host: "local", pid: process.pid, now: () => Date.now(), leaseMs: 900000,
    // Reclaim a stale lock left by a crashed/killed prior run: signal-0 probes pid liveness on THIS
    // host (ESRCH ⇒ gone ⇒ reclaimable once expired; EPERM ⇒ still alive). Without this a holder that
    // died before release() would pin the single execution lease until manual cleanup.
    isPidAlive: (p) => { if (!Number.isInteger(p) || p <= 0) return false; try { process.kill(p, 0); return true; } catch (e) { return e.code === "EPERM"; } },
  });
  const contextPackageFn = deps.contextPackageFn || ((a) => contextPackageFor({ ...a }));
  const wakeCtx = deps.wakeCtx || { governor: { remoteAiUsed: 0, remoteAiMax: 1 }, network: "NORMAL", providerCapacityUsage: { concurrency: { used: 0, limit: 1 }, shortWindow: "UNKNOWN", weekly: "UNKNOWN", ownerReserve: "UNKNOWN" }, sourceFreshness: "CURRENT" };

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
    // Emit the durable REVIEW_READY signal (deterministic path from workId) so ChatGPT can pick the result
    // up from GitHub without polling — the repo is the payload, this file is only the signal.
    if (out.reviewReady) {
      written.push(write(reviewReadyLocation(requestId), `${JSON.stringify(out.reviewReady, null, 2)}\n`));
    }
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
    // Clean, non-crash terminal/held dispositions exit 0; genuinely-failed / needs-rerun states exit non-zero.
    // BLOCKED_EXECUTION / AWAITING_ARTIFACTIZATION are held-for-action (not a crash) but NOT success, so they
    // exit non-zero — a runner must never read them as a completed cycle (the #834/#835 fail-closed contract).
    const CLEAN_EXIT = new Set(["COMPLETE", "STAGED", "READY", "BLOCKED", "OWNER_REQUIRED", "OWNER_ACTION_REQUIRED", "SKIPPED_ALREADY_COMPLETE"]);
    process.exit(CLEAN_EXIT.has(out.disposition) ? 0 : 1);
  }
  process.stderr.write("usage: intake-runtime.mjs execute ...  (writeback is handled by intake-ingest-ci.mjs --write)\n");
  process.exit(2);
}

if (fileURLToPath(import.meta.url) === process.argv[1]) main();
