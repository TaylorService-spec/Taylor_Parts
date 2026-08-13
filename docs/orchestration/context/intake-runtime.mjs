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
import { resolveWorkIntake, intakeToWorkItem, buildContentAddressedResult } from "../lib/workIntake.mjs";
import { runIntakeExecution } from "../lib/intakeExecute.mjs";
import { reviewReadyLocation, statusLocation, buildIntakeStatus, buildResultIndex, buildReviewReady } from "../lib/intakeStatus.mjs";
import { childSpecsFromArtifact } from "../lib/governedOrchestration.mjs";
import { runGovernedParentMission, toExecutableChildArtifact } from "../lib/governedRuntime.mjs";
import { decideIntakeDispatch, detectThrottle } from "../lib/agentManager.mjs";
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
export function executeIntakeItem({ requestId, location, sha256, sourceCommit = null, requiresCapabilities = [], emitReviewReady = true, deps = {} } = {}) {
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
  const write = deps.write || writeRepo;

  // GOVERNED PARENT: an intake that carries a decomposition (childSpecs) runs the full multi-child mission
  // in-process — decompose into the exact constrained child set, run each child through the SAME guarded worker
  // path, then consolidate + reconcile into ONE REVIEW_READY parent result. Fail-closed everywhere (a widening
  // child rejects the mission; a missing/extraction-invalid child blocks the parent — never a partial pass).
  if (childSpecsFromArtifact(artifact).length > 0) {
    return executeParentMission({ artifact, requestId, sourceCommit, now, capabilityBroker, processRunner, lease, contextPackageFn, wakeCtx, write, readRegister: deps.readRegister });
  }

  const out = runIntakeExecution({ artifact, sourceCommit, now, requiresCapabilities, capabilityBroker, processRunner, lease, contextPackageFn, wakeCtx });

  // Always persist the status (deterministic path). On COMPLETE, persist the content-addressed result + index.
  const written = [];
  written.push(write(out.status.artifactLocation, `${JSON.stringify(out.status, null, 2)}\n`));
  if (out.disposition === "COMPLETE" && out.result) {
    write(out.result.contentLocation, out.result.content); // immutable content-addressed bytes
    written.push(out.result.contentLocation);
    write(out.result.manifestLocation, `${JSON.stringify(out.result.manifest, null, 2)}\n`);
    written.push(out.result.manifestLocation);
    write(out.result.index.artifactLocation, `${JSON.stringify(out.result.index, null, 2)}\n`);
    written.push(out.result.index.artifactLocation);
    // Emit the durable REVIEW_READY signal (deterministic path from workId) so ChatGPT can pick the result
    // up from GitHub without polling — the repo is the payload, this file is only the signal. Suppressed for a
    // governed CHILD run (emitReviewReady:false) so only the consolidated PARENT emits the ChatGPT signal.
    if (out.reviewReady && emitReviewReady) {
      written.push(write(reviewReadyLocation(requestId), `${JSON.stringify(out.reviewReady, null, 2)}\n`));
    }
  }
  // Manager reads for system throttling on the wake outcome (additive — surfaces a signal a concurrency
  // controller / adaptConcurrency can back off on; does NOT change the single-worker control flow here).
  const throttle = detectThrottle(out.wake || {});
  // `content` (the worker's raw output, carrying any eos-findings block) is surfaced ONLY on COMPLETE so a
  // governed parent can consolidate its children's results without re-reading the landed content file.
  const content = out.disposition === "COMPLETE" && out.result ? out.result.content : null;
  return Object.freeze({ disposition: out.disposition, requestId, written, content, resultPointer: out.status.result, statusPointer: out.status.pointer, throttled: throttle.throttled, retryAfterSec: throttle.retryAfterSec });
}

// Land ONE execution's durable artifacts (status always; content-addressed result on COMPLETE). Review-ready is
// emitted only when emitReviewReady is true (parent yes, child no). Returns the repo paths written.
function landOne(out, requestId, { write, emitReviewReady }) {
  const written = [write(out.status.artifactLocation, `${JSON.stringify(out.status, null, 2)}\n`)];
  if (out.disposition === "COMPLETE" && out.result) {
    write(out.result.contentLocation, out.result.content);
    written.push(out.result.contentLocation);
    written.push(write(out.result.manifestLocation, `${JSON.stringify(out.result.manifest, null, 2)}\n`));
    written.push(write(out.result.index.artifactLocation, `${JSON.stringify(out.result.index, null, 2)}\n`));
    if (out.reviewReady && emitReviewReady) written.push(write(reviewReadyLocation(requestId), `${JSON.stringify(out.reviewReady, null, 2)}\n`));
  }
  return written;
}

// Load the findings register (reconcile memory). Absent/malformed ⇒ empty (a fresh register), never a throw.
function loadRegister() {
  try {
    const raw = JSON.parse(readFileSync(safeRepoPath("docs/orchestration/findings/register.json"), "utf8"));
    return Array.isArray(raw?.findings) ? raw.findings : Array.isArray(raw) ? raw : [];
  } catch { return []; }
}

/**
 * Execute a governed PARENT mission end-to-end (single pass) and persist its durable artifacts. Each child runs
 * through the SAME guarded worker path (runIntakeExecution) with the parent's injected deps and lands its own
 * status+result (no per-child review-ready). The consolidated+reconciled parent result is written with the ONE
 * REVIEW_READY signal on a genuine 2/2 (N/N) completion; any fail-closed outcome writes a held/blocked status
 * only. Pure orchestration lives in governedRuntime.runGovernedParentMission; this supplies the real I/O.
 */
export function executeParentMission({ artifact, requestId, sourceCommit = null, now, capabilityBroker, processRunner, lease, contextPackageFn, wakeCtx, write, readRegister } = {}) {
  const register = readRegister ? readRegister() : loadRegister();
  const written = [];

  const runChild = (childItem, spec) => {
    // Children VERIFY (test/inspect); with the #868 seam a child requesting VERIFY but inheriting only ANALYSIS
    // runs read-only and still COMPLETEs. The grant is the inherited constrained profile — never widened here.
    const childArtifact = toExecutableChildArtifact(childItem, { taskClass: "READ_ONLY_VERIFY" });
    written.push(write(childArtifact.artifactLocation, `${JSON.stringify(childArtifact, null, 2)}\n`));
    const out = runIntakeExecution({ artifact: childArtifact, sourceCommit, now, requiresCapabilities: [], capabilityBroker, processRunner, lease, contextPackageFn, wakeCtx });
    written.push(...landOne(out, childArtifact.requestId, { write, emitReviewReady: false }));
    // The content-addressed result's `content` is a Buffer; consolidation's findings extractor needs the raw
    // TEXT (the worker's output, carrying the eos-findings block), so decode it before handing it upward.
    const content = out.disposition === "COMPLETE" && out.result
      ? (Buffer.isBuffer(out.result.content) ? out.result.content.toString("utf8") : String(out.result.content))
      : null;
    return { disposition: out.disposition, sector: spec?.sector ?? null, content };
  };

  const mission = runGovernedParentMission({ parentArtifact: artifact, register, runChild });
  const provenance = { producer: artifact.source.producer, provenance: artifact.source.provenance };
  const workArtifact = { location: artifact.artifactLocation, sha256: artifact.sha256 };

  if (mission.action === "COMPLETE") {
    const summary = `governed ${mission.childRuns.length}-child mission: consolidated + reconciled (${mission.reconciled.reconciled.surfaced.length} surfaced, ${mission.reconciled.reconciled.alreadyOpen.length} already-open)`.slice(0, 1200);
    const outputBytes = Buffer.from(`${JSON.stringify(mission.reconciled, null, 2)}\n`, "utf8");
    const result = buildContentAddressedResult({ request: artifact, outputBytes, status: "COMPLETE", summary, createdAt: now });
    const index = buildResultIndex({ requestId, manifestLocation: result.manifestLocation, manifestSha256: result.manifest.sha256, contentLocation: result.contentLocation, updatedAt: now });
    const status = buildIntakeStatus({ requestId, state: "COMPLETE", currentWork: "governed mission complete", activeWorker: "AgentManager", updatedAt: now, workArtifact, resultRef: { location: result.manifestLocation, sha256: result.manifest.sha256 }, provenance });
    written.push(write(status.artifactLocation, `${JSON.stringify(status, null, 2)}\n`));
    write(result.contentLocation, result.content); written.push(result.contentLocation);
    written.push(write(result.manifestLocation, `${JSON.stringify(result.manifest, null, 2)}\n`));
    written.push(write(index.artifactLocation, `${JSON.stringify(index, null, 2)}\n`));
    const reviewReady = buildReviewReady({ requestId, artifact: result.contentLocation, commit: null });
    written.push(write(reviewReadyLocation(requestId), `${JSON.stringify(reviewReady, null, 2)}\n`));
    return Object.freeze({ disposition: "COMPLETE", requestId, written, resultPointer: status.result, statusPointer: status.pointer, mission: mission.action, children: mission.childRuns.length });
  }

  // Fail-closed: no consolidated result. Map the governed outcome to a held/blocked/failed intake status.
  const state = mission.action === "REJECT" ? "FAILED" : "BLOCKED_EXECUTION";
  const currentWork = mission.action === "REJECT" ? "decomposition rejected: a child would widen authority (fail-closed)"
    : mission.action === "AWAIT" ? "governed children incomplete — parent cannot complete on a partial set"
      : "governed consolidation blocked: a child result was missing or extraction-invalid (fail-closed)";
  const status = buildIntakeStatus({ requestId, state, currentWork, updatedAt: now, workArtifact, provenance });
  written.push(write(status.artifactLocation, `${JSON.stringify(status, null, 2)}\n`));
  return Object.freeze({ disposition: state, requestId, written, resultPointer: null, statusPointer: status.pointer, mission: mission.action, children: mission.childRuns.length });
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
