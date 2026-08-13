// EOS Wake Supervisor — GUARDED live execution path (build+test only; the live pilot is separate).
//
// Orchestrates ONE bounded, guarded Claude run when — and only when — the existing readiness gate
// returns TRIGGER. It reuses the built pieces, adds NO second execution mechanism, and PROVABLY
// spawns zero on any refusal:
//
//   assessReadiness → provenance check → C-7 context package → resolveDispatchModel →
//   execution lease → guardrailed buildClaudeInvocation → INJECTED processRunner → result capture →
//   truthful wake lifecycle + evidence → lease release.
//
// The processRunner and lease are INJECTED so this whole path is unit-tested with a mock (no real
// AI). The runner script binds the real child_process spawn behind --execute; that real spawn is not
// exercised in tests. A process spawn alone NEVER proves ACKNOWLEDGED/COMPLETED — states are set only
// from real evidence, and failures are captured distinctly, never reinterpreted as completed work.

import { assessReadiness, buildClaudeInvocation, DEFAULT_GUARDRAILS } from "./wakeSupervisor.mjs";
import { resolveDispatchModel } from "./modelPolicy.mjs";
import { createCostCapacityTelemetry, UNKNOWN_COST } from "./costCapacity.mjs";

export const WAKE_EXECUTION_OUTCOMES = Object.freeze(["SPAWNED_COMPLETED", "SPAWNED_FAILED", "HELD", "CHECKPOINT"]);
export const WAKE_FAILURE_KINDS = Object.freeze([
  "SPAWN_FAILURE", "TIMEOUT", "NONZERO_EXIT", "MALFORMED_OUTPUT", "MISSING_RESULT",
  "RESULT_PERSIST_FAILURE", "LEASE_RELEASE_FAILURE", "INSUFFICIENT_CONTEXT",
  "PROVENANCE_UNACCEPTABLE", "MODEL_RESOLUTION_FAILURE", "LEASE_UNAVAILABLE",
  "MAX_TURNS_EXHAUSTED",
]);

// Map a wake failure kind to the runtimeTermination signal the completion-semantic gate consumes.
function terminationForFailure(failureKind) {
  if (failureKind === "MAX_TURNS_EXHAUSTED") return "MAX_TURNS_EXHAUSTED";
  if (failureKind === "TIMEOUT") return "TIMEOUT";
  if (failureKind === "SPAWN_FAILURE") return "SPAWN_FAILURE";
  return "PROCESS_ERROR";
}

const refuse = (outcome, reason, extra = {}) => Object.freeze({ outcome, spawned: false, reason, ...extra });

/**
 * Execute (or refuse) one guarded wake. Pure of real I/O: processRunner + lease + contextPackageFn +
 * persistResult are injected. Returns a durable, truthful outcome/evidence record.
 *
 * @param {object} o
 * @param {object} o.item                the selector's work item { id, status, authorized, protectedBoundary, scope, sha, modelTier, workstream }
 * @param {object} o.ctx                 assessReadiness ctx { governor, network, budgetRemainingUsd, triggerKind, lastRun, overnight }
 * @param {function} o.contextPackageFn  the SHARED C-7 package builder (contextPackageFor)
 * @param {object}  o.processRunner      { run({bin,argv,wallClockSec}) -> {spawnError?, timedOut?, exitCode, stdout} }  (injected; mock in tests)
 * @param {object}  o.lease              { acquire() -> {acquired:boolean}, release() -> void }                          (injected)
 * @param {function} [o.resolveModel]    defaults to resolveDispatchModel
 * @param {function} [o.persistResult]   optional durable-evidence sink; a throw → RESULT_PERSIST_FAILURE
 * @param {string|null} [o.sourceCommit]
 * @param {string|null} [o.sourceFreshness]  reviewProvenance state; must be "CURRENT" to run live
 */
export function executeWake({ item, ctx = {}, contextPackageFn, processRunner, lease, resolveModel = resolveDispatchModel, persistResult = null, sourceCommit = null, sourceFreshness = null, executionProfile = "READ_ONLY_ANALYSIS" } = {}) {
  if (typeof contextPackageFn !== "function") throw new Error("executeWake: contextPackageFn (shared C-7 builder) is required");
  if (!processRunner || typeof processRunner.run !== "function") throw new Error("executeWake: processRunner must be injected");
  if (!lease || typeof lease.acquire !== "function") throw new Error("executeWake: lease must be injected");

  // 1. Readiness gate — the ONLY thing that permits a spawn. HOLD/CHECKPOINT spawn zero.
  const decision = assessReadiness(item, ctx);
  if (decision.decision !== "TRIGGER") {
    return refuse(decision.decision === "HOLD" ? "HELD" : "CHECKPOINT", decision.reason, { wakeState: "WAITING_FOR_TRIGGER", triggerMechanism: decision.triggerMechanism, budgetStopReason: decision.budgetStopReason || null });
  }

  // 2. Source provenance must be acceptable (CURRENT) for a live run against source.
  if (sourceFreshness != null && sourceFreshness !== "CURRENT") {
    return refuse("HELD", `source provenance ${sourceFreshness} — not CURRENT`, { failureKind: "PROVENANCE_UNACCEPTABLE", wakeState: "AUTHORIZED" });
  }

  // 3. C-7 context package via the SHARED mechanism; insufficient → refuse (spawn zero), no guess.
  const contextPackage = contextPackageFn({ id: item.id, scope: item.scope || [], role: item.workstream, objective: item.purpose, sourceCommit });
  if (contextPackage.sufficiency !== "SUFFICIENT") {
    return refuse("HELD", "context package insufficient (EVIDENCE_REQUIRED)", { failureKind: "INSUFFICIENT_CONTEXT", wakeState: "AUTHORIZED", contextPackage });
  }

  // 4. Model via the SHARED resolver (delegated → SONNET).
  let model;
  try { model = resolveModel({ modelTier: item.modelTier, workstream: item.workstream, delegated: true }); }
  catch (e) { return refuse("HELD", `model resolution failed: ${e.message}`, { failureKind: "MODEL_RESOLUTION_FAILURE", wakeState: "AUTHORIZED" }); }
  if (!model || !model.selectedModel) return refuse("HELD", "model resolution produced no model", { failureKind: "MODEL_RESOLUTION_FAILURE", wakeState: "AUTHORIZED" });

  // 5. Execution lease — duplicate/active → refuse (spawn zero).
  const acq = lease.acquire();
  if (!acq || acq.acquired !== true) {
    return refuse("HELD", "duplicate/active lease — another run holds it", { failureKind: "LEASE_UNAVAILABLE", wakeState: "AUTHORIZED" });
  }

  const triggerMechanism = decision.triggerKind === "MANUAL_RUNTIME_TRIGGER" ? "MANUAL_RUNTIME_TRIGGER" : "AUTOMATIC_TRIGGER";
  // The capability profile is GOVERNED and resolved by the caller (runIntakeExecution) — least-privilege
  // READ_ONLY_ANALYSIS unless a governed authorization granted more. It is never taken from worker/request
  // self-declaration here, so a worker cannot widen its own authority.
  const invocation = buildClaudeInvocation({ contextPackage, guardrails: Object.freeze({ ...DEFAULT_GUARDRAILS, model: model.selectedModel, maxBudgetUsd: ctx.costCapacity?.explicitEconomicCostCapUsd ?? null }), profile: executionProfile || "READ_ONLY_ANALYSIS" });
  let leaseReleased = false;
  const releaseLease = () => { if (leaseReleased) return true; try { lease.release(); leaseReleased = true; return true; } catch { return false; } };

  try {
    // 6. Spawn EXACTLY once. wakeState = TRIGGERED (a spawn attempt is not ACKNOWLEDGED/COMPLETED).
    let run;
    try { run = processRunner.run({ bin: invocation.bin, argv: invocation.argv, wallClockSec: invocation.wallClockSec }); }
    catch (e) { run = { spawnError: e.message }; }

    const base = { spawned: true, wakeState: "TRIGGERED", triggerMechanism, selectedModel: model.selectedModel, contextPackage, invocation };

    if (run && run.spawnError) return fail("SPAWN_FAILURE", run.spawnError, base, releaseLease);
    // Spawn succeeded → the OS process ran → ACTIVE (still not COMPLETED).
    base.wakeState = "ACTIVE";
    // Diagnostic capture (sanitized): a process failure MUST carry the exit code + a stderr/stdout tail
    // so NONZERO_EXIT/TIMEOUT/MALFORMED are DIAGNOSABLE without re-running (the observed instrumentation gap).
    const stderrTail = sanitizeDiagnostic(run && run.stderr);
    const stdoutTail = sanitizeDiagnostic(run && run.stdout);
    const exitCode = run && Number.isFinite(run.exitCode) ? run.exitCode : null;
    if (run && run.timedOut) return fail("TIMEOUT", `wall-clock ${invocation.wallClockSec}s exceeded${stderrTail ? ` — ${stderrTail}` : ""}`, base, releaseLease, { exitCode, diagnostic: stderrTail });
    if (!run || run.exitCode !== 0) return fail("NONZERO_EXIT", `exit ${exitCode ?? "unknown"}${stderrTail ? ` — stderr: ${stderrTail}` : (stdoutTail ? ` — stdout: ${stdoutTail}` : "")}`, base, releaseLease, { exitCode, diagnostic: stderrTail || stdoutTail });

    let parsed;
    try { parsed = JSON.parse(run.stdout || ""); }
    catch { return fail("MALFORMED_OUTPUT", `stdout is not valid JSON${stdoutTail ? ` — stdout: ${stdoutTail}` : ""}${stderrTail ? ` — stderr: ${stderrTail}` : ""}`, base, releaseLease, { exitCode, diagnostic: stdoutTail || stderrTail }); }
    if (!parsed || parsed.result == null) return fail("MISSING_RESULT", `no \`result\` in worker output${stdoutTail ? ` — stdout: ${stdoutTail}` : ""}`, base, releaseLease, { exitCode, diagnostic: stdoutTail });

    // Max-turn exhaustion is NOT completed work (the #834/#835-adjacent #836/#837 regression): the `claude -p`
    // JSON marks a truncated run with subtype "error_max_turns"/is_error even though a partial `result` is
    // present. Fail closed with a distinct termination signal — never reinterpret truncation as completion.
    const subtype = String(parsed.subtype || "");
    if (subtype === "error_max_turns" || (parsed.is_error === true && /max.?turn/i.test(subtype))) {
      return fail("MAX_TURNS_EXHAUSTED", `worker hit the configured ${invocation.turnCeiling ?? "bounded"}-turn ceiling`, base, releaseLease, { exitCode });
    }

    // Only NOW is COMPLETED provable (clean exit + parseable result + not truncated at the turn ceiling).
    base.wakeState = "COMPLETED";
    if (persistResult) {
      try { persistResult({ item, wake: base, result: parsed, estimatedExecutionCostUsd: parsed.total_cost_usd ?? null, model: model.selectedModel }); }
      catch (e) { return fail("RESULT_PERSIST_FAILURE", e.message, base, releaseLease); }
    }
    const releasedOk = releaseLease();
    return Object.freeze({
      outcome: "SPAWNED_COMPLETED", spawned: true, wakeState: "COMPLETED", triggerMechanism, runtimeTermination: "NORMAL",
      turnCeiling: invocation.turnCeiling ?? null, profile: invocation.profile ?? null,
      selectedModel: model.selectedModel, contextPackage, estimatedExecutionCostUsd: parsed.total_cost_usd ?? null,
      costCapacity: createCostCapacityTelemetry({ actualProviderCostUsd: UNKNOWN_COST, estimatedExecutionCostUsd: parsed.total_cost_usd ?? null, providerCapacityUsage: ctx.providerCapacityUsage || {}, budgetStopReason: null, costProvenance: { actual: "UNAVAILABLE", estimated: parsed.total_cost_usd == null ? "UNAVAILABLE" : "CLAUDE_CLI_MODELED" }, freshness: parsed.total_cost_usd == null ? "UNKNOWN" : "CURRENT" }),
      result: parsed.result, leaseReleased: releasedOk,
      failureKind: releasedOk ? null : "LEASE_RELEASE_FAILURE",
    });
  } finally {
    releaseLease(); // belt-and-suspenders; idempotent
  }
}

// A failed process is NEVER completed work. Capture the distinct failure kind + release the lease.
function fail(failureKind, detail, base, releaseLease, meta = {}) {
  const releasedOk = releaseLease();
  return Object.freeze({
    outcome: "SPAWNED_FAILED", spawned: true, wakeState: base.wakeState, triggerMechanism: base.triggerMechanism,
    selectedModel: base.selectedModel, failureKind, failureDetail: detail,
    runtimeTermination: meta.runtimeTermination ?? terminationForFailure(failureKind),
    exitCode: meta.exitCode ?? null, diagnostic: meta.diagnostic ?? null,
    leaseReleased: releasedOk,
  });
}

// Sanitize a child-process stderr/stdout tail for evidence: keep the last chars, collapse whitespace,
// and redact anything that looks like a secret, absolute path, or long id/token/hex — a diagnostic
// must be safe to log without leaking credentials or machine paths.
export function sanitizeDiagnostic(s, max = 400) {
  if (!s || typeof s !== "string") return "";
  let t = s.replace(/\r/g, "").trim();
  t = t
    .replace(/(sk-[A-Za-z0-9_-]{4})[A-Za-z0-9_-]+/g, "$1…")          // OpenAI-style
    .replace(/(AIza[A-Za-z0-9_-]{4})[A-Za-z0-9_-]+/g, "$1…")         // Google-style
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer …")
    .replace(/[A-Za-z]:\\[^\s"']+/g, "<path>")                        // Windows abs path
    .replace(/(?:\/[\w.-]+){3,}/g, "<path>")                          // POSIX abs path
    .replace(/\b[0-9a-f]{16,}\b/gi, "<hex>")
    .replace(/\b[A-Za-z0-9_-]{20,}\b/g, "<token>");
  const tail = t.length > max ? "…" + t.slice(-max) : t;
  return tail.replace(/\s+/g, " ").trim();
}
