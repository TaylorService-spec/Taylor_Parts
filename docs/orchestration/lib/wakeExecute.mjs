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

export const WAKE_EXECUTION_OUTCOMES = Object.freeze(["SPAWNED_COMPLETED", "SPAWNED_FAILED", "HELD", "CHECKPOINT"]);
export const WAKE_FAILURE_KINDS = Object.freeze([
  "SPAWN_FAILURE", "TIMEOUT", "NONZERO_EXIT", "MALFORMED_OUTPUT", "MISSING_RESULT",
  "RESULT_PERSIST_FAILURE", "LEASE_RELEASE_FAILURE", "INSUFFICIENT_CONTEXT",
  "PROVENANCE_UNACCEPTABLE", "MODEL_RESOLUTION_FAILURE", "LEASE_UNAVAILABLE",
]);

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
export function executeWake({ item, ctx = {}, contextPackageFn, processRunner, lease, resolveModel = resolveDispatchModel, persistResult = null, sourceCommit = null, sourceFreshness = null } = {}) {
  if (typeof contextPackageFn !== "function") throw new Error("executeWake: contextPackageFn (shared C-7 builder) is required");
  if (!processRunner || typeof processRunner.run !== "function") throw new Error("executeWake: processRunner must be injected");
  if (!lease || typeof lease.acquire !== "function") throw new Error("executeWake: lease must be injected");

  // 1. Readiness gate — the ONLY thing that permits a spawn. HOLD/CHECKPOINT spawn zero.
  const decision = assessReadiness(item, ctx);
  if (decision.decision !== "TRIGGER") {
    return refuse(decision.decision === "HOLD" ? "HELD" : "CHECKPOINT", decision.reason, { wakeState: "WAITING_FOR_TRIGGER", triggerMechanism: decision.triggerMechanism });
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
  const invocation = buildClaudeInvocation({ contextPackage, guardrails: Object.freeze({ ...DEFAULT_GUARDRAILS, model: model.selectedModel }) });
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
    if (run && run.timedOut) return fail("TIMEOUT", `wall-clock ${invocation.wallClockSec}s exceeded`, base, releaseLease);
    if (!run || run.exitCode !== 0) return fail("NONZERO_EXIT", `exit ${run ? run.exitCode : "unknown"}`, base, releaseLease);

    let parsed;
    try { parsed = JSON.parse(run.stdout || ""); }
    catch { return fail("MALFORMED_OUTPUT", "stdout is not valid JSON", base, releaseLease); }
    if (!parsed || parsed.result == null) return fail("MISSING_RESULT", "no `result` in worker output", base, releaseLease);

    // Only NOW is COMPLETED provable (clean exit + parseable result).
    base.wakeState = "COMPLETED";
    if (persistResult) {
      try { persistResult({ item, wake: base, result: parsed, cost: parsed.total_cost_usd ?? null, model: model.selectedModel }); }
      catch (e) { return fail("RESULT_PERSIST_FAILURE", e.message, base, releaseLease); }
    }
    const releasedOk = releaseLease();
    return Object.freeze({
      outcome: "SPAWNED_COMPLETED", spawned: true, wakeState: "COMPLETED", triggerMechanism,
      selectedModel: model.selectedModel, contextPackage, cost: parsed.total_cost_usd ?? null,
      result: parsed.result, leaseReleased: releasedOk,
      failureKind: releasedOk ? null : "LEASE_RELEASE_FAILURE",
    });
  } finally {
    releaseLease(); // belt-and-suspenders; idempotent
  }
}

// A failed process is NEVER completed work. Capture the distinct failure kind + release the lease.
function fail(failureKind, detail, base, releaseLease) {
  const releasedOk = releaseLease();
  return Object.freeze({
    outcome: "SPAWNED_FAILED", spawned: true, wakeState: base.wakeState, triggerMechanism: base.triggerMechanism,
    selectedModel: base.selectedModel, failureKind, failureDetail: detail,
    leaseReleased: releasedOk,
  });
}
